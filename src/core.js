// Pure logic: dates, recurrence, status, calendar export.
// No DOM and no storage in here, so test/core.test.mjs can import it under node.

export const DAY = 86400000;
export const SCHEMA = 1;

const pad = (n) => String(n).padStart(2, '0');

/** Today as YYYY-MM-DD in the viewer's own timezone. */
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isISO(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Dates are handled as plain YYYY-MM-DD and compared at UTC midnight, so DST never shifts a due date. */
function utc(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function daysBetween(fromISO, toISO) {
  return Math.round((utc(toISO) - utc(fromISO)) / DAY);
}

export function addDays(iso, n) {
  return fromUTC(utc(iso) + n * DAY);
}

/**
 * Add an interval to a date. Month and year steps use calendar arithmetic and clamp to the
 * end of a short month, so a filter changed on the 31st is due on the 28th, not in March.
 */
export function addInterval(iso, every) {
  if (!every || !Number.isFinite(every.n) || every.n <= 0) return iso;
  const { n, unit } = every;
  if (unit === 'day') return addDays(iso, n);
  if (unit === 'week') return addDays(iso, n * 7);
  const months = unit === 'year' ? n * 12 : n;
  const [y, m, d] = iso.split('-').map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${pad(month + 1)}-${pad(Math.min(d, lastDay))}`;
}

/** Roll a due date forward by whole intervals until it is in the future — skips missed cycles in one step. */
export function nextDue(iso, every, from) {
  let next = addInterval(iso, every);
  let guard = 0;
  while (daysBetween(from, next) <= 0 && guard++ < 500) next = addInterval(next, every);
  return next;
}

export const DEFAULT_LEAD = 14;

export function statusOf(item, today) {
  if (item.archived) return { state: 'archived', days: null };
  if (!isISO(item.due)) return { state: 'nodate', days: null };
  const days = daysBetween(today, item.due);
  const lead = Number.isFinite(item.lead) ? item.lead : DEFAULT_LEAD;
  if (days < 0) return { state: 'overdue', days };
  if (days <= lead) return { state: 'soon', days };
  return { state: 'later', days };
}

export const STATE_ORDER = { overdue: 0, soon: 1, nodate: 2, later: 3, archived: 4 };

export function bySoonest(a, b) {
  const sa = STATE_ORDER[a.state] ?? 9;
  const sb = STATE_ORDER[b.state] ?? 9;
  if (sa !== sb) return sa - sb;
  if (a.item.due && b.item.due && a.item.due !== b.item.due) return a.item.due < b.item.due ? -1 : 1;
  return (a.item.name || '').localeCompare(b.item.name || '');
}

const UNIT_NAMES = { day: 'day', week: 'week', month: 'month', year: 'year' };

export function humanizeInterval(every) {
  if (!every) return '';
  const { n, unit } = every;
  const name = UNIT_NAMES[unit] || unit;
  if (n === 1) return `every ${name}`;
  if (unit === 'month' && n === 12) return 'every year';
  return `every ${n} ${name}s`;
}

function span(days) {
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 60) {
    const w = Math.round(days / 7);
    return `${w} week${w === 1 ? '' : 's'}`;
  }
  if (days < 730) {
    const m = Math.max(2, Math.round(days / 30.44));
    return `${m} month${m === 1 ? '' : 's'}`;
  }
  const y = Math.round(days / 365.25);
  return `${y} year${y === 1 ? '' : 's'}`;
}

/** Short relative phrase for a due date: "5 days late", "today", "in 3 months". */
export function relativeDays(days) {
  if (days === null || days === undefined) return 'no date yet';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days < 0) return `${span(-days)} late`;
  return `in ${span(days)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function prettyDate(iso) {
  if (!isISO(iso)) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// ---------------------------------------------------------------- calendar export

function escapeText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 says content lines are at most 75 octets, continued with a leading space. */
export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let limit = 75;
  for (const ch of line) {
    if (enc.encode(cur + ch).length > limit) {
      out.push(cur);
      cur = ch;
      limit = 74; // continuation lines spend one octet on the leading space
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.join('\r\n ');
}

const FREQ = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' };

function stamp(now) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * One all-day VEVENT per item, with a display alarm `lead` days ahead and an RRULE for
 * repeating upkeep. Importing this into any calendar app turns the list into real reminders.
 */
export function toICS(items, opts = {}) {
  const now = opts.now || new Date();
  const dtstamp = stamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lasts//Expiry and upkeep tracker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Lasts',
  ];
  for (const item of items) {
    if (!isISO(item.due) || item.archived) continue;
    const start = item.due.replace(/-/g, '');
    const end = addDays(item.due, 1).replace(/-/g, '');
    const lead = Number.isFinite(item.lead) ? item.lead : DEFAULT_LEAD;
    const title = item.where ? `${item.name} — ${item.where}` : item.name;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${item.id}@lasts.local`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
    lines.push(`SUMMARY:${escapeText(item.kind === 'expiry' ? `${title} expires` : title)}`);
    const desc = [item.note, item.kind === 'interval' ? humanizeInterval(item.every) : 'Expiry date']
      .filter(Boolean)
      .join(' · ');
    if (desc) lines.push(`DESCRIPTION:${escapeText(desc)}`);
    lines.push('TRANSP:TRANSPARENT');
    if (item.kind === 'interval' && item.every && FREQ[item.every.unit]) {
      lines.push(`RRULE:FREQ=${FREQ[item.every.unit]};INTERVAL=${item.every.n}`);
    }
    if (lead > 0) {
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`TRIGGER:-P${lead}D`);
      lines.push(`DESCRIPTION:${escapeText(title)}`);
      lines.push('END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
