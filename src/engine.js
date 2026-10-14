/*
 * Cron Almanac engine.
 * Parses schedules for eleven schedulers, computes run times in any IANA
 * time zone (DST included), describes them in English, flags common mistakes,
 * and translates between dialects. Pure functions, no DOM; runs in browsers
 * and in Node (see test/engine.test.mjs).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CronEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY = 86400000;
  const DOW_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MON_SHORT = MON_LONG.map(m => m.slice(0, 3));
  const MONTH_NAMES = Object.fromEntries(MON_ABBR.map((m, i) => [m, i + 1]));
  const DOW_SUN0 = Object.fromEntries(DOW_ABBR.map((d, i) => [d, i]));
  const DOW_SUN1 = Object.fromEntries(DOW_ABBR.map((d, i) => [d, i + 1]));
  const DOW_MON1 = Object.fromEntries(DOW_ABBR.map((d, i) => [d, i === 0 ? 7 : i]));
  const DOW_MON0 = Object.fromEntries(DOW_ABBR.map((d, i) => [d, (i + 6) % 7]));

  const MACROS_UNIX = {
    '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *',
    '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *',
  };
  const MACROS_SPRING = {
    '@yearly': '0 0 0 1 1 *', '@annually': '0 0 0 1 1 *', '@monthly': '0 0 0 1 * *',
    '@weekly': '0 0 0 * * 0', '@daily': '0 0 0 * * *', '@midnight': '0 0 0 * * *', '@hourly': '0 0 * * * *',
  };

  /*
   * dayRule says how day-of-month and day-of-week combine:
   *  vixie  - OR, unless either field starts with '*' (then AND). Vixie cron, cronie.
   *  robfig - OR, unless either field is '*' or '?' without a step > 1 (then AND). robfig/cron v3, used by Kubernetes.
   *  star   - OR, unless either field is exactly '*'. fugit (GitLab), saffron (Cloudflare).
   *  quartz - exactly one field must be '?'; the other one decides.
   *  and    - both must match. Spring, NCrontab (Azure), APScheduler, systemd.
   * family groups dialects that share a syntax for rendering. custom marks dialects with
   * their own grammar (systemd calendar events, APScheduler keyword arguments).
   */
  const DIALECTS = {
    unix: {
      id: 'unix', name: 'Linux crontab', short: 'crontab', family: 'unix',
      fields: ['minute', 'hour', 'dom', 'month', 'dow'],
      dow: { min: 0, max: 7, names: DOW_SUN0 }, dayRule: 'vixie',
      specials: {}, question: false, wrap: false,
      macros: MACROS_UNIX, reboot: true, commandTail: true, seconds: false, year: null,
    },
    systemd: {
      id: 'systemd', name: 'systemd timer', short: 'systemd', family: 'systemd', custom: true,
      fields: ['dow', 'year', 'month', 'dom', 'hour', 'minute', 'second'],
      dow: { min: 0, max: 6, names: DOW_SUN0 }, dayRule: 'and',
      specials: { L: true, Loffset: true, fromEnd: true }, question: false, wrap: false,
      macros: null, reboot: false, commandTail: false, seconds: true, year: [1970, 2199],
    },
    github: {
      id: 'github', name: 'GitHub Actions', short: 'GitHub', family: 'unix',
      fields: ['minute', 'hour', 'dom', 'month', 'dow'],
      dow: { min: 0, max: 7, names: DOW_SUN0 }, dayRule: 'vixie',
      specials: {}, question: false, wrap: false,
      macros: null, reboot: false, commandTail: false, seconds: false, year: null,
    },
    gitlab: {
      id: 'gitlab', name: 'GitLab CI', short: 'GitLab', family: 'unix',
      fields: ['minute', 'hour', 'dom', 'month', 'dow'],
      dow: { min: 0, max: 7, names: DOW_SUN0 }, dayRule: 'star',
      specials: { L: true, lastWord: true, negL: true, hash: true, hashLast: true, amp: true },
      question: false, wrap: false,
      macros: MACROS_UNIX, reboot: false, commandTail: false, seconds: false, year: null,
    },
    k8s: {
      id: 'k8s', name: 'Kubernetes CronJob', short: 'Kubernetes', family: 'unix',
      fields: ['minute', 'hour', 'dom', 'month', 'dow'],
      dow: { min: 0, max: 6, names: DOW_SUN0 }, dayRule: 'robfig',
      specials: {}, question: true, wrap: false,
      macros: MACROS_UNIX, reboot: false, commandTail: false, seconds: false, year: null,
    },
    eventbridge: {
      id: 'eventbridge', name: 'AWS EventBridge', short: 'EventBridge', family: 'eb',
      fields: ['minute', 'hour', 'dom', 'month', 'dow', 'year'],
      dow: { min: 1, max: 7, names: DOW_SUN1 }, dayRule: 'quartz',
      specials: { L: true, W: true, dowLBare: true, hash: true }, question: true, wrap: false,
      macros: null, reboot: false, commandTail: false, seconds: false, year: [1970, 2199],
    },
    cloudflare: {
      id: 'cloudflare', name: 'Cloudflare Workers', short: 'Cloudflare', family: 'cf',
      fields: ['minute', 'hour', 'dom', 'month', 'dow'],
      dow: { min: 1, max: 7, names: DOW_SUN1 }, dayRule: 'star',
      specials: { L: true, Loffset: true, LW: true, W: true, dowLBare: true, dowLast: true, hash: true },
      question: false, wrap: true, stepLimit: true, utcOnly: true,
      macros: null, reboot: false, commandTail: false, seconds: false, year: null,
    },
    azure: {
      id: 'azure', name: 'Azure Functions', short: 'Azure', family: 'ncrontab',
      fields: ['second?', 'minute', 'hour', 'dom', 'month', 'dow'],
      dow: { min: 0, max: 6, names: DOW_SUN0 }, dayRule: 'and',
      specials: {}, question: false, wrap: false, swap: true, prefixNames: true,
      macros: null, reboot: false, commandTail: false, seconds: true, year: null,
    },
    quartz: {
      id: 'quartz', name: 'Quartz', short: 'Quartz', family: 'quartz',
      fields: ['second', 'minute', 'hour', 'dom', 'month', 'dow', 'year?'],
      dow: { min: 1, max: 7, names: DOW_SUN1 }, dayRule: 'quartz',
      specials: { L: true, Loffset: true, LW: true, W: true, dowLBare: true, dowLast: true, hash: true },
      question: true, wrap: true, stepLimit: true,
      macros: null, reboot: false, commandTail: false, seconds: true, year: [1970, 2099],
    },
    spring: {
      id: 'spring', name: 'Spring @Scheduled', short: 'Spring', family: 'spring',
      fields: ['second', 'minute', 'hour', 'dom', 'month', 'dow'],
      dow: { min: 0, max: 7, names: DOW_MON1 }, dayRule: 'and',
      specials: { L: true, Loffset: true, LW: true, W: true, dowLast: true, hash: true },
      question: true, wrap: false,
      macros: MACROS_SPRING, reboot: false, commandTail: false, seconds: true, year: null,
    },
    apscheduler: {
      id: 'apscheduler', name: 'APScheduler', short: 'APScheduler', family: 'aps', custom: true,
      fields: ['year', 'month', 'dom', 'week', 'dow', 'hour', 'minute', 'second'],
      dow: { min: 0, max: 6, names: DOW_MON0, monday0: true }, dayRule: 'and',
      specials: { L: true }, question: false, wrap: false,
      macros: null, reboot: false, commandTail: false, seconds: true, year: [1970, 9999],
    },
  };
  const DIALECT_ORDER = ['unix', 'systemd', 'github', 'gitlab', 'k8s', 'eventbridge', 'cloudflare', 'azure', 'quartz', 'spring', 'apscheduler'];

  const FIELD_LABEL = {
    second: 'second', minute: 'minute', hour: 'hour', dom: 'day-of-month',
    month: 'month', dow: 'day-of-week', year: 'year', week: 'week',
  };

  // ---------------------------------------------------------------- utils

  const pad2 = n => String(n).padStart(2, '0');
  const sortNum = a => a.sort((x, y) => x - y);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  function runsOf(vals) {
    const out = [];
    if (!vals.length) return out;
    let s = vals[0], p = vals[0];
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] === p + 1) { p = vals[i]; continue; }
      out.push([s, p]);
      s = p = vals[i];
    }
    out.push([s, p]);
    return out;
  }

  function apStep(vals) {
    if (vals.length < 3) return 0;
    const g = vals[1] - vals[0];
    for (let i = 2; i < vals.length; i++) if (vals[i] - vals[i - 1] !== g) return 0;
    return g;
  }

  function joinList(items, conj) {
    conj = conj || 'and';
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' ' + conj + ' ' + items[items.length - 1];
  }

  function ordinal(n) {
    const t = n % 100;
    if (t >= 11 && t <= 13) return n + 'th';
    return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  }

  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weekday = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

  function lowerBound(arr, x) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
    return lo;
  }

  function boolArr(n, list) { const a = new Array(n).fill(false); for (const v of list) a[v] = true; return a; }

  function fmtClock(sec, withSeconds) {
    const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return pad2(h) + ':' + pad2(m) + (withSeconds ? ':' + pad2(s) : '');
  }

  function fmtDuration(sec) {
    if (sec < 60) return sec + ' s';
    const d = Math.floor(sec / 86400), h = Math.floor(sec / 3600) % 24, m = Math.floor(sec / 60) % 60, s = sec % 60;
    const parts = [];
    if (d) parts.push(d + ' d');
    if (h) parts.push(h + ' h');
    if (m) parts.push(m + ' min');
    if (s && !d) parts.push(s + ' s');
    return parts.slice(0, 3).join(' ');
  }

  function everyUnit(sec) {
    if (sec % 3600 === 0) { const n = sec / 3600; return n === 1 ? 'every hour' : `every ${n} hours`; }
    if (sec % 60 === 0) { const n = sec / 60; return n === 1 ? 'every minute' : `every ${n} minutes`; }
    return sec === 1 ? 'every second' : `every ${sec} seconds`;
  }

  class CronError extends Error {
    constructor(message, field, extra) {
      super(message);
      this.field = field == null ? -1 : field;
      if (extra) Object.assign(this, extra);
    }
  }

  // ---------------------------------------------------------------- parsing

  function bounds(kind, D) {
    switch (kind) {
      case 'second': case 'minute': return { min: 0, max: 59 };
      case 'hour': return { min: 0, max: 23 };
      case 'dom': return { min: 1, max: 31 };
      case 'month': return { min: 1, max: 12, names: MONTH_NAMES };
      case 'dow': return { min: D.dow.min, max: D.dow.max, names: D.dow.names };
      case 'year': return { min: D.year[0], max: D.year[1] };
    }
    throw new Error('unknown field ' + kind);
  }

  const STEP_LIMIT = { second: 59, minute: 59, hour: 23, dom: 31, month: 12, dow: 7, year: Infinity };

  function dowNumberingHint(D) {
    if (D.dow.monday0) return ' (0 = Monday … 6 = Sunday)';
    if (D.dow.min === 1) return ' (1 = Sunday … 7 = Saturday)';
    if (D.dow.max === 7) return ' (0 or 7 = Sunday)';
    return ' (0 = Sunday … 6 = Saturday)';
  }

  function toInternal(kind, v, D) {
    if (kind !== 'dow') return v;
    if (D.dow.monday0) return (v + 1) % 7;
    return D.dow.min === 1 ? v - 1 : v % 7;
  }

  // NCrontab (Azure) accepts any leading part of a full name, case-insensitively: "Mon", "Monday", "Ja".
  const FULL_NAMES = { dow: DOW_LONG.map(n => n.toUpperCase()), month: MON_LONG.map(n => n.toUpperCase()) };

  const RE_ITEM = /^(\*|\d+|[A-Z]+)(?:-(\d+|[A-Z]+))?(?:\/(\d+))?$/;
  const DOW_TOKEN = '(\\d|SUN|MON|TUE|WED|THU|FRI|SAT)';
  const RE_DOW_LAST = new RegExp('^' + DOW_TOKEN + 'L$');
  const RE_DOW_HASH = new RegExp('^' + DOW_TOKEN + '#(\\d+)$');
  const RE_DOW_HASH_LAST = new RegExp('^' + DOW_TOKEN + '#(-1|L|LAST)$');

  /** Offsets from the end of the month, sorted; a single one becomes the classic { type: 'L', offset }. */
  function fromEndSpecial(offsets) {
    const o = sortNum([...new Set(offsets)]);
    return o.length === 1 ? { type: 'L', offset: o[0] } : { type: 'fromEnd', offsets: o };
  }

  function parseField(raw, kind, D, idx) {
    const b = bounds(kind, D);
    const label = FIELD_LABEL[kind];
    const f = {
      kind, raw, index: idx, values: new Set(), question: false, special: null, items: [],
      vixieStar: raw[0] === '*', robfigStar: false,
    };
    const fail = (msg, extra) => { throw new CronError(msg, idx, extra); };
    const up = raw.toUpperCase();
    const parts = up.split(',');
    if (parts.some(p => p === '')) fail(`The ${label} field \`${raw}\` has an empty item. Check the commas.`);

    const val = tok => {
      let v;
      if (/^\d+$/.test(tok)) v = parseInt(tok, 10);
      else if (D.prefixNames && FULL_NAMES[kind] && FULL_NAMES[kind].some(n => n.startsWith(tok))) {
        const i = FULL_NAMES[kind].findIndex(n => n.startsWith(tok));
        v = kind === 'month' ? i + 1 : i;
        if (tok.length < 3) f.shortName = tok;
      } else if (b.names && Object.prototype.hasOwnProperty.call(b.names, tok)) v = b.names[tok];
      else if (b.names) fail(`\`${tok}\` isn't a ${label} name. Use ${kind === 'month' ? 'JAN–DEC' : 'SUN–SAT'} or numbers.`);
      else fail(`\`${tok}\` isn't a number.`);
      if (v < b.min || v > b.max) {
        fail(`${cap(label)} ${v} is out of range. ${D.name} allows ${b.min}–${b.max}${kind === 'dow' ? dowNumberingHint(D) : ''}.`);
      }
      return v;
    };
    const add = v => f.values.add(toInternal(kind, v, D));
    const addAll = () => { for (let v = b.min; v <= b.max; v++) add(v); };
    const unsupported = (what) => fail(
      `\`${raw}\` uses ${what}, which ${D.name} doesn't support.` +
      (D.family === 'unix' && D.id !== 'gitlab' ? ' Quartz, Spring and EventBridge do; see Translations for a crontab workaround.' : ''),
    );
    const mustBeAlone = () => { if (parts.length > 1) fail(`\`${parts.find(p => /[LW#]/.test(p) && !RE_ITEM.test(p)) || raw}\` can't be combined with other values in the ${label} field.`); };

    for (const p of parts) {
      if (p === '?') {
        if (!D.question) fail(`${D.name} doesn't use \`?\`. Use \`*\` for “any”.`);
        if (kind !== 'dom' && kind !== 'dow') fail(`\`?\` only works in the day-of-month and day-of-week fields.`);
        if (parts.length > 1) fail(`\`?\` must stand alone in the ${label} field.`);
        f.question = true;
        f.robfigStar = true;
        addAll();
        continue;
      }
      if (/^H(\/|\(|$)/.test(p)) fail('`H` is Jenkins’ hashed-time syntax. Pick a concrete value instead, e.g. `17` for the minute.');

      let m;
      if (kind === 'dom') {
        if (p === 'L' || (p === 'LAST' && D.specials.lastWord)) {
          if (!D.specials.L) unsupported('`L` (last day of the month)');
          mustBeAlone(); f.special = { type: 'L', offset: 0 }; continue;
        }
        if ((m = p.match(/^-(\d+)-L$/))) {
          if (!D.specials.negL) unsupported('`-n-L` (the last n days of the month)');
          const n = parseInt(m[1], 10);
          if (n < 1 || n > 31) fail(`\`${p}\`: the number of days must be 1–31.`);
          mustBeAlone(); f.special = fromEndSpecial(Array.from({ length: n }, (_, i) => i)); continue;
        }
        if (/^L-\d+W$/.test(p)) fail(`\`${p}\` (the weekday nearest n days before the month's end) isn't something Cron Almanac can chart yet.`);
        if ((m = p.match(/^L-(\d+)$/))) {
          if (!D.specials.Loffset) unsupported('`L-n` (n days before the last day)');
          const n = parseInt(m[1], 10);
          if (n < 1 || n > 30) fail(`\`${p}\`: the offset must be 1–30.`);
          mustBeAlone(); f.special = { type: 'L', offset: n }; continue;
        }
        if (p === 'LW' || p === 'WL') {
          if (!D.specials.LW) unsupported('`LW` (last weekday of the month)');
          mustBeAlone(); f.special = { type: 'LW' }; continue;
        }
        if ((m = p.match(/^(\d+)W$/))) {
          if (!D.specials.W) unsupported('`W` (nearest weekday)');
          const n = parseInt(m[1], 10);
          if (n < 1 || n > 31) fail(`\`${p}\`: the day must be 1–31.`);
          mustBeAlone(); f.special = { type: 'W', day: n }; continue;
        }
      }
      if (kind === 'dow') {
        if (p === 'L') {
          if (!D.specials.dowLBare) unsupported('`L` on its own in day-of-week');
          mustBeAlone(); add(D.dow.min === 1 ? 7 : 6); f.bareL = true; continue;
        }
        if ((m = p.match(RE_DOW_LAST))) {
          if (!D.specials.dowLast) unsupported('`nL` (last given weekday of the month)');
          mustBeAlone();
          f.special = { type: 'lastDow', dow: toInternal('dow', val(m[1]), D) }; continue;
        }
        if ((m = p.match(RE_DOW_HASH))) {
          if (!D.specials.hash) unsupported('`#` (nth weekday of the month)');
          const n = parseInt(m[2], 10);
          if (n < 1 || n > 5) fail(`\`${p}\`: the week number after # must be 1–5.`);
          mustBeAlone();
          f.special = { type: 'nth', dow: toInternal('dow', val(m[1]), D), n }; continue;
        }
        if ((m = p.match(RE_DOW_HASH_LAST))) {
          if (!D.specials.hashLast) unsupported('`#-1` (last given weekday of the month)');
          mustBeAlone();
          f.special = { type: 'lastDow', dow: toInternal('dow', val(m[1]), D) }; continue;
        }
        if (/%/.test(p)) {
          fail(D.id === 'gitlab'
            ? `\`${p}\` is fugit's every-nth-week extension. Which weeks it picks depends on the fugit version GitLab runs, so Cron Almanac can't chart it reliably.`
            : `\`%\` isn't valid in ${D.name}.`);
        }
      }

      m = p.match(RE_ITEM);
      if (!m) {
        if (/[LW#]/.test(p)) {
          if (kind !== 'dom' && kind !== 'dow') fail(`\`${p}\`: L, W and # only work in the day fields.`);
          if (D.family === 'unix') unsupported('`L`, `W` or `#`');
        }
        fail(`Can't read \`${raw}\` as a ${label} field.`);
      }
      const a = m[1], bt = m[2], st = m[3];
      const star = a === '*';
      let lo, hi;
      if (star) {
        if (bt !== undefined) fail(`\`${p}\`: a range can't start with \`*\`.`);
        lo = b.min; hi = b.max;
      } else {
        lo = val(a);
        hi = bt !== undefined ? val(bt) : (st !== undefined ? b.max : lo);
      }
      let step = 1;
      if (st !== undefined) {
        step = parseInt(st, 10);
        if (step < 1) fail(`\`${p}\`: the step after \`/\` must be 1 or more.`);
        if (D.stepLimit && step > STEP_LIMIT[kind]) fail(`\`${p}\`: ${D.name} rejects ${label} steps above ${STEP_LIMIT[kind]}.`);
      }
      const item = {
        raw: p, star, lo, hi, step, hasStep: st !== undefined, hasRange: bt !== undefined,
        bareSlash: !star && bt === undefined && st !== undefined,
      };
      if (star && step <= 1) f.robfigStar = true;
      if (lo <= hi) {
        for (let v = lo; v <= hi; v += step) add(v);
      } else if (D.wrap) {
        const span = b.max - b.min + 1;
        const len = (hi - lo + span) % span;
        for (let k = 0; k <= len; k += step) add(b.min + ((lo - b.min + k) % span));
        item.wraps = true;
      } else if (D.swap) {
        // NCrontab quietly swaps a backwards range, so FRI-MON means Monday to Friday.
        for (let v = hi; v <= lo; v += step) add(v);
        Object.assign(item, { lo: hi, hi: lo, swapped: true });
        f.swapped = item;
      } else {
        fail(`\`${p}\` runs backwards. ${D.name} needs low-high ranges; write \`${lo}-${b.max},${b.min}-${hi}\`.`);
      }
      f.items.push(item);
    }
    f.list = sortNum([...f.values]);
    return f;
  }

  // ---------------------------------------------------------------- systemd calendar events

  const SD_DAYS = [['monday', 'mon'], ['tuesday', 'tue'], ['wednesday', 'wed'], ['thursday', 'thu'], ['friday', 'fri'], ['saturday', 'sat'], ['sunday', 'sun']];
  const SD_SHORTHANDS = {
    minutely: '*-*-* *:*:00', hourly: '*-*-* *:00:00', daily: '*-*-* 00:00:00', monthly: '*-*-01 00:00:00',
    weekly: 'Mon *-*-* 00:00:00', yearly: '*-01-01 00:00:00', annually: '*-01-01 00:00:00', anually: '*-01-01 00:00:00',
    quarterly: '*-01,04,07,10-01 00:00:00', semiannually: '*-01,07-01 00:00:00', 'semi-annually': '*-01,07-01 00:00:00',
    biannually: '*-01,07-01 00:00:00', 'bi-annually': '*-01,07-01 00:00:00',
  };
  const SD_BOUNDS = { year: [1970, 2199], month: [1, 12], dom: [1, 31], hour: [0, 23], minute: [0, 59], second: [0, 59] };
  const SD_LABEL = { dow: 'weekday', year: 'year', month: 'month', dom: 'day', hour: 'hour', minute: 'minute', second: 'second' };

  /** A field object shaped like parseField's, so checks and chips treat every dialect alike. */
  function makeField(kind, raw, index, values, items, special) {
    const list = sortNum([...new Set(values)]);
    return {
      kind, raw, index, values: new Set(list), list, items: items || [], special: special || null, question: false,
      vixieStar: raw[0] === '*', robfigStar: raw === '*',
    };
  }

  /**
   * One systemd component chain: *, or a comma list of start[..stop][/repeat]. Follows systemd's
   * calendarspec.c: values are expanded the way its matcher walks them, and the same chains are refused.
   * With fromEnd (the day after ~), values count back from the month's last day and come back as offsets.
   */
  function sdChain(raw, kind, idx, fromEnd) {
    const [min, max0] = SD_BOUNDS[kind];
    const max = fromEnd ? 28 : max0;
    const label = SD_LABEL[kind];
    const fail = msg => { throw new CronError(msg, idx); };
    if (raw === '*') return { star: true, values: [], items: [{ raw, star: true, lo: min, hi: max0, step: 1, hasStep: false, hasRange: false, bareSlash: false }] };
    if (raw[0] === '*') {
      const ex = kind === 'year' ? '2027/2' : kind === 'month' || kind === 'dom' ? '01/2' : '0/15';
      fail(`systemd doesn't accept \`${raw}\`. A repetition needs a starting value, as in \`${ex}\`.`);
    }
    if (raw === '') fail(`The ${label} is empty.`);
    const values = [], items = [];
    for (const p of raw.split(',')) {
      const m = /^(\d+(?:\.\d+)?)(?:\.\.(\d+(?:\.\d+)?))?(?:\/(\d+(?:\.\d+)?))?$/.exec(p);
      if (!m) fail(`Can't read \`${p}\` as a ${label}. systemd writes ranges as \`a..b\` and repetitions as \`a/n\`.`);
      if ([m[1], m[2], m[3]].some(x => x && x.includes('.'))) {
        if (kind !== 'second') fail(`\`${p}\`: only seconds can have a fraction.`);
        fail(`\`${p}\`: Cron Almanac works in whole seconds.`);
      }
      let a = parseInt(m[1], 10), b = m[2] !== undefined ? parseInt(m[2], 10) : -1;
      let r = m[3] !== undefined ? parseInt(m[3], 10) : (b >= 0 ? 1 : 0);
      if (m[3] !== undefined && r === 0) fail(`\`${p}\`: the repetition must be 1 or more.`);
      if (kind === 'year') {
        const fix = v => (v >= 0 && v < 70 ? v + 2000 : v >= 70 && v < 100 ? v + 1900 : v);
        a = fix(a); if (b >= 0) b = fix(b);
      }
      // calendarspec.c normalize_chain(): trim the range to whole repetitions; drop a repetition that can't fire.
      if (b > a && r > 0) b -= (b - a) % r;
      if ((b > a && r > 0 && a + r > b) || a === b) { r = 0; b = -1; }
      const outOfRange = v => v < min || v > max;
      if (outOfRange(a) || (b >= 0 && outOfRange(b))) {
        fail(fromEnd
          ? `\`${p}\`: after \`~\` systemd counts days back from the month's end and accepts 1–28.`
          : `\`${p}\`: the ${label} must be ${min}–${max}.`);
      }
      if (r > max - min) fail(`\`${p}\`: the repetition is longer than the whole ${label} range.`);
      if (b >= 0) {
        if (a + r > b) fail(`\`${p}\` runs backwards. Write the smaller value first.`);
      } else if (r > 0) {
        if (fromEnd ? a - r < 1 : a + r > max) fail(`\`${p}\`: the repetition never fires a second time, which systemd refuses.`);
      }
      if (fromEnd) {
        // ~a: the a-th last day. ~a..b/r walks up toward the month's end; ~a/r walks down from it.
        if (b >= 0) for (let v = a; v <= b; v += r) values.push(v - 1);
        else if (r > 0) for (let v = a; v >= 1; v -= r) values.push(v - 1);
        else values.push(a - 1);
        continue;
      }
      if (b >= 0) for (let v = a; v <= b; v += r) values.push(v);
      else if (r > 0) for (let v = a; v <= max; v += r) values.push(v);
      else values.push(a);
      items.push({ raw: p, star: false, lo: a, hi: b >= 0 ? b : r > 0 ? max : a, step: r || 1, hasStep: r > 0 && m[3] !== undefined, hasRange: b >= 0, bareSlash: b < 0 && r > 0 });
    }
    return { star: false, values, items };
  }

  function parseSystemd(u, out, D) {
    const base = u.base;
    const chips = [], tokens = [];
    out.chips = chips;
    out.tokens = tokens;
    let text = u.core;
    let lo = 0, hi = text.length;
    while (lo < hi && /\s/.test(text[lo])) lo++;
    while (hi > lo && /\s/.test(text[hi - 1])) hi--;
    if (lo === hi) throw new CronError(`Type a calendar event, for example \`${EXAMPLE_BY_DIALECT.systemd}\`.`);
    // A trailing time zone: UTC or a tz database name.
    const zm = /\s+(\S+)$/.exec(text.slice(lo, hi));
    if (zm && (/^utc$/i.test(zm[1]) || (/[A-Za-z]/.test(zm[1]) && !/[:*]/.test(zm[1]) && !/^[a-z]+(?:\.\.|[-,]|$)/i.test(zm[1]) && isValidZone(zm[1])))) {
      if (!SD_SHORTHANDS[zm[1].toLowerCase()]) {
        out.tz = /^utc$/i.test(zm[1]) ? 'UTC' : zm[1];
        out.tzSource = 'the time zone at the end of the expression';
        out.tzInline = true;
        hi = lo + zm.index;
      }
    }
    let body = text.slice(lo, hi);
    const chip = (kind, raw, start, implied) => {
      chips.push({ kind, label: SD_LABEL[kind] || kind, token: raw, start: start < 0 ? -1 : base + start, end: start < 0 ? -1 : base + start + raw.length, implied: !!implied });
      tokens.push({ text: raw, start: start < 0 ? -1 : base + start, end: start < 0 ? -1 : base + start + raw.length });
      return chips.length - 1;
    };
    let at = lo;
    const short = SD_SHORTHANDS[body.toLowerCase()];
    if (short) {
      out.macro = body;
      out.macroExpansion = short;
      chip('shortcut', body, lo);
      body = short;
      at = -1;
    }
    const pos = off => (at < 0 ? -1 : at + off);

    // Weekdays: names, commas and ranges with .. (or -), Monday first.
    const days = new Set();
    let i = 0, wdRaw = null;
    {
      const low = body.toLowerCase();
      let first = true, from = -1;
      for (;;) {
        let nr = -1, len = 0;
        for (let k = 0; k < 7 && nr < 0; k++) {
          for (const nm of SD_DAYS[k]) if (low.startsWith(nm, i)) { nr = k; len = nm.length; break; }
        }
        if (nr < 0) {
          if (first) break;
          throw new CronError(`Expected a weekday name after \`${body.slice(0, i)}\`.`, chips.length);
        }
        const next = body[i + len];
        if (next !== undefined && !'-., '.includes(next)) {
          if (first) break;
          throw new CronError(`Can't read the weekday \`${body.slice(i).split(/[ ,.]/)[0]}\`.`, chips.length);
        }
        if (from >= 0) {
          if (from > nr) {
            throw new CronError(`\`${body.slice(0, body.indexOf(' ') < 0 ? body.length : body.indexOf(' '))}\`: systemd weeks run Monday to Sunday, so a range can't wrap past Sunday. Write it as two parts, e.g. \`Fri..Sun,Mon\`.`, chips.length);
          }
          for (let k = from; k <= nr; k++) days.add(k);
          from = -1;
        }
        days.add(nr);
        i += len;
        const c = body[i];
        if (c === undefined || c === ' ') break;
        if (c === '.') {
          if (body[i + 1] !== '.' || from >= 0) throw new CronError('Write weekday ranges with two dots, as in `Mon..Fri`.', chips.length);
          from = nr; i += 2;
        } else if (c === '-') { from = nr; i += 1; } else { from = -1; i += 1; }
        if (body[i] === undefined || body[i] === ' ') {
          if (from >= 0) throw new CronError('That weekday range has no end.', chips.length);
          break;
        }
        first = false;
      }
      if (days.size) wdRaw = body.slice(0, i);
    }
    const dowValues = days.size ? [...days].map(k => (k + 1) % 7) : ALL_DOWS;
    const wdIdx = chip('dow', wdRaw || '–', wdRaw ? pos(0) : -1, !wdRaw);
    const by = {};
    by.dow = makeField('dow', wdRaw || '*', wdIdx, dowValues);
    while (body[i] === ' ') i++;

    // Date and time: "[date] [time]"; a part with ':' is the time.
    const rest = body.slice(i);
    const parts = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(rest))) parts.push({ text: m[0], at: i + m.index });
    let date = null, time = null;
    if (parts.length > 2) throw new CronError(`Can't read \`${parts.slice(2).map(x => x.text).join(' ')}\`. A calendar event is [weekdays] [date] [time] [time zone].`, -1);
    if (parts.length === 2) {
      if (parts[0].text.includes(':') || !parts[1].text.includes(':')) {
        throw new CronError(`Can't read \`${rest}\`. Write the date before the time, as in \`*-*-01 09:00\`.`, -1);
      }
      date = parts[0]; time = parts[1];
    } else if (parts.length === 1) {
      if (parts[0].text.includes(':')) time = parts[0]; else date = parts[0];
    }

    // Date: [year-]month-day, with ~ before the day to count from the month's end.
    let year = { raw: '*', at: -1 }, month = { raw: '*', at: -1 }, day = { raw: '*', at: -1 }, fromEnd = false;
    if (date) {
      const segs = [];
      const sr = /[^-~]+|[-~]/g;
      while ((m = sr.exec(date.text))) segs.push({ text: m[0], at: date.at + m.index });
      const vals = segs.filter((_, k) => k % 2 === 0), seps = segs.filter((_, k) => k % 2 === 1).map(x => x.text);
      const okShape = segs.length % 2 === 1 && segs.every((x, k) => (k % 2 === 1) === /^[-~]$/.test(x.text));
      if (!okShape || vals.length < 2 || vals.length > 3) {
        throw new CronError(`Can't read \`${date.text}\` as a date. Write it as \`year-month-day\` or \`month-day\`, with \`*\` for any.`, -1);
      }
      if (vals.length === 3 && seps[0] === '~') throw new CronError('`~` can only come right before the day.', -1);
      fromEnd = seps[seps.length - 1] === '~';
      if (vals.length === 3) [year, month, day] = vals.map(v => ({ raw: v.text, at: v.at }));
      else [month, day] = vals.map(v => ({ raw: v.text, at: v.at }));
    }
    const yIdx = chip('year', year.raw, year.at < 0 ? -1 : pos(year.at), year.at < 0);
    const yc = sdChain(year.raw, 'year', yIdx);
    by.year = makeField('year', year.raw, yIdx, yc.star ? [] : yc.values, yc.items);
    const moIdx = chip('month', month.raw, month.at < 0 ? -1 : pos(month.at), month.at < 0);
    const mc = sdChain(month.raw, 'month', moIdx);
    by.month = makeField('month', month.raw, moIdx, mc.star ? ALL_MONTHS : mc.values, mc.items);
    const dIdx = chip('dom', (fromEnd ? '~' : '') + day.raw, day.at < 0 ? -1 : pos(day.at - (fromEnd ? 1 : 0)), day.at < 0);
    const dc = sdChain(day.raw, 'dom', dIdx, fromEnd && day.raw !== '*');
    if (fromEnd && day.raw !== '*') {
      by.dom = makeField('dom', '~' + day.raw, dIdx, [], [], fromEndSpecial(dc.values));
    } else {
      by.dom = makeField('dom', day.raw, dIdx, dc.star ? ALL_DAYS : dc.values, dc.items);
    }

    // Time: hour:minute[:second]; seconds default to 00, a missing time to 00:00:00.
    let hh = { raw: '00', at: -1 }, mm = { raw: '00', at: -1 }, ss = { raw: '00', at: -1 };
    if (time) {
      const segs = time.text.split(':');
      if (segs.length < 2 || segs.length > 3) throw new CronError(`Can't read \`${time.text}\` as a time. Write \`hour:minute\` or \`hour:minute:second\`.`, -1);
      let off = time.at;
      const at3 = segs.map(x => { const r = { raw: x, at: off }; off += x.length + 1; return r; });
      [hh, mm] = at3;
      if (at3[2]) ss = at3[2];
    }
    for (const [kind, f] of [['hour', hh], ['minute', mm], ['second', ss]]) {
      const idx = chip(kind, f.raw, f.at < 0 ? -1 : pos(f.at), f.at < 0);
      const c = sdChain(f.raw, kind, idx);
      by[kind] = makeField(kind, f.raw, idx, c.star ? Array.from({ length: SD_BOUNDS[kind][1] + 1 }, (_, k) => k) : c.values, c.items);
    }
    out.fields = ['year', 'month', 'dom', 'hour', 'minute', 'second', 'dow'].map(k => by[k]);
    chips.forEach(c => { c.field = c.kind === 'shortcut' ? null : by[c.kind]; });
    return Object.assign(out, modelFromFields(by, 'and'), { ok: true, by });
  }

  // ---------------------------------------------------------------- APScheduler CronTrigger

  const APS_KIND = { year: 'year', month: 'month', day: 'dom', week: 'week', day_of_week: 'dow', hour: 'hour', minute: 'minute', second: 'second' };
  const APS_MIN = { year: 1970, month: 1, day: 1, week: 1, day_of_week: 0, hour: 0, minute: 0, second: 0 };
  const APS_MAX = { year: 9999, month: 12, day: 31, week: 53, day_of_week: 6, hour: 23, minute: 59, second: 59 };
  const APS_WD = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const APS_MO = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const APS_POS = ['1st', '2nd', '3rd', '4th', '5th', 'last'];

  /** One CronTrigger field, following APScheduler 3's expressions.py, including its error messages. */
  function apsField(name, expr, idx, notes) {
    const kind = APS_KIND[name];
    const min = APS_MIN[name], max = APS_MAX[name];
    const fail = msg => { throw new CronError(`\`${name}='${expr}'\`: ${msg}`, idx); };
    const values = [], items = [];
    let special = null, specials = 0;
    const exprs = String(expr).trim().split(/ *, */);
    for (const e of exprs) {
      let m;
      if ((m = /^\*(?:\/(\d+))?$/.exec(e))) {
        const step = m[1] !== undefined ? parseInt(m[1], 10) : 0;
        if (m[1] !== undefined && step === 0) fail('Increment must be higher than 0.');
        if (step > max - min) fail(`the step value (${step}) is higher than the total range of the expression (${max - min}).`);
        for (let v = min; v <= max; v += step || 1) values.push(v);
        items.push({ raw: e, star: true, lo: min, hi: max, step: step || 1, hasStep: step > 0, hasRange: false, bareSlash: false });
        continue;
      }
      if ((m = /^(\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(e))) {
        const a = parseInt(m[1], 10);
        let b = m[2] !== undefined ? parseInt(m[2], 10) : null;
        const step = m[3] !== undefined ? parseInt(m[3], 10) : 0;
        if (m[3] !== undefined && step === 0) fail('Increment must be higher than 0.');
        if (b === null && !step) b = a;
        if (b !== null && a > b) fail('The minimum value in a range must not be higher than the maximum.');
        if (a < min) fail(`the first value (${a}) is lower than the minimum value (${min}).`);
        if (b !== null && b > max) fail(`the last value (${b}) is higher than the maximum value (${max}).`);
        if (step && step > (b || max) - a) fail(`the step value (${step}) is higher than the total range of the expression (${(b || max) - a}).`);
        const hiV = b === null ? max : b;
        for (let v = a; v <= hiV; v += step || 1) values.push(v);
        items.push({ raw: e, star: false, lo: a, hi: hiV, step: step || 1, hasStep: step > 0, hasRange: m[2] !== undefined, bareSlash: b === null && step > 0 });
        continue;
      }
      if (name === 'day') {
        if ((m = /^(1st|2nd|3rd|4th|5th|last) +(\w+)$/i.exec(e))) {
          const d = APS_WD.indexOf(m[2].toLowerCase());
          if (d < 0) fail(`Invalid weekday name "${m[2]}". Use mon, tue, wed, thu, fri, sat or sun.`);
          const n = APS_POS.indexOf(m[1].toLowerCase());
          special = n === 5 ? { type: 'lastDow', dow: (d + 1) % 7 } : { type: 'nth', dow: (d + 1) % 7, n: n + 1 };
          specials++;
          continue;
        }
        if (/^last/i.test(e)) { special = { type: 'L', offset: 0 }; specials++; continue; }
      }
      if ((name === 'month' || name === 'day_of_week') && (m = /^([a-z]+)(?:-([a-z]+))?/i.exec(e))) {
        const names = name === 'month' ? APS_MO : APS_WD;
        const first = names.indexOf(m[1].toLowerCase());
        const last = m[2] !== undefined ? names.indexOf(m[2].toLowerCase()) : first;
        const bad = first < 0 ? m[1] : last < 0 ? m[2] : null;
        if (bad) fail(`Invalid ${name === 'month' ? 'month' : 'weekday'} name "${bad}". Use ${name === 'month' ? 'jan–dec' : 'mon–sun'}.`);
        if (first > last) fail('The minimum value in a range must not be higher than the maximum.');
        if (m[0].length < e.length) notes.push(`APScheduler ignores \`${e.slice(m[0].length)}\` after \`${m[0]}\`, so it reads \`${m[0]}\`.`);
        const off = name === 'month' ? 1 : 0;
        for (let v = first; v <= last; v++) values.push(v + off);
        items.push({ raw: e, star: false, lo: first + off, hi: last + off, step: 1, hasStep: false, hasRange: m[2] !== undefined, bareSlash: false, names: true });
        continue;
      }
      fail(`Unrecognized expression "${e}".`);
    }
    if (specials && (specials > 1 || values.length)) return { split: exprs };
    const internal = kind === 'dow' ? values.map(v => (v + 1) % 7) : values;
    const f = makeField(kind, String(expr), idx, internal, items, special);
    f.vixieStar = f.robfigStar = String(expr).trim() === '*';
    return f;
  }

  function parseAps(u, out, D) {
    const text = u.core, base = u.base;
    const chips = [], tokens = [];
    out.chips = chips;
    out.tokens = tokens;
    const given = {}, pos = {};
    const options = {};
    let m;
    const crontab = /from_crontab\s*\(\s*(?:'([^'\n]*)'|"([^"\n]*)")/d.exec(text);
    const bare = !crontab && !/=/.test(text) && /^\s*\S+(\s+\S+){4}\s*$/.test(text);
    if (crontab || bare) {
      // CronTrigger.from_crontab(): five crontab fields, read with APScheduler's own field rules.
      const gi = crontab ? (crontab[1] !== undefined ? 1 : 2) : 0;
      const str = crontab ? crontab[gi] : text;
      const at = crontab ? crontab.indices[gi][0] : 0;
      const re = /\S+/g;
      const toks = [];
      while ((m = re.exec(str))) toks.push({ text: m[0], at: at + m.index });
      if (toks.length !== 5) throw new CronError(`Wrong number of fields; got ${toks.length}, expected 5. from_crontab() takes minute hour day month day_of_week.`, -1);
      ['minute', 'hour', 'day', 'month', 'day_of_week'].forEach((n, k) => { given[n] = toks[k].text; pos[n] = toks[k].at; });
      out.fromCrontab = true;
      if (bare) out.notes.push('Read as `CronTrigger.from_crontab()`, where day-of-week 0 is Monday.');
    } else {
      const re = /\b([a-z_]+)\s*=(?!=)\s*(?:'([^'\n]*)'|"([^"\n]*)"|(-?\d+(?:\.\d+)?)(?=\s*[,)\n]|\s*$)|([^,)\n]*))/dg;
      while ((m = re.exec(text))) {
        const gi = [2, 3, 4, 5].find(k => m[k] !== undefined);
        const value = m[gi].trim();
        if (APS_KIND[m[1]]) { given[m[1]] = value; pos[m[1]] = m.indices[gi][0]; } else options[m[1]] = value;
      }
      if (!Object.keys(given).length && !/CronTrigger|add_job|scheduled_job|\(/.test(text)) {
        throw new CronError(`Write the CronTrigger fields, for example \`${EXAMPLE_BY_DIALECT.apscheduler}\`, or a crontab line for from_crontab().`, -1);
      }
    }
    out.apsOptions = options;
    if (options.jitter) out.notes.push(`\`jitter=${options.jitter}\` moves each run by up to that many seconds; the times below are before jitter.`);
    // Fields left out: '*' above the last one given, their minimum below it (week and day_of_week stay '*').
    const fields = [], by = {};
    let pending = Object.keys(given).length, defaults = false, seenGiven = false;
    for (const name of APS_FIELDS) {
      let expr, implied = false;
      if (given[name] !== undefined) { expr = given[name]; pending--; defaults = pending === 0; } else {
        expr = defaults ? APS_DEFAULTS[name] : '*';
        implied = true;
      }
      if (name === 'week') {
        if (expr !== '*') throw new CronError('ISO week numbers (`week=`) have no equivalent in other schedulers, so Cron Almanac can’t chart them.', chips.length);
        continue;
      }
      if (name === 'year' && implied) { by.year = makeField('year', '*', -1, []); continue; }
      const start = implied ? -1 : base + pos[name];
      // Leave out '*' fields nobody wrote, except ones between written fields (day=1, minute=20 leaves hour '*').
      const shown = !implied || expr !== '*' || (seenGiven && APS_DEFAULTS[name] !== '*');
      if (!implied) seenGiven = true;
      if (shown) {
        chips.push({ kind: APS_KIND[name], label: name, token: expr, start, end: implied ? -1 : start + expr.length, implied });
        tokens.push({ text: expr, start, end: implied ? -1 : start + expr.length });
      }
      const f = apsField(name, expr, shown ? chips.length - 1 : -1, out.notes);
      if (f.split) {
        const isRule = e => /^(1st|2nd|3rd|4th|5th|last)\b/i.test(e);
        const groups = f.split.filter(isRule);
        const plain = f.split.filter(e => !isRule(e));
        if (plain.length) groups.push(plain.join(','));
        throw new CronError(`\`day='${expr}'\` mixes several day rules. APScheduler accepts that, but Cron Almanac reads one per trigger, so split it into ${groups.length} triggers (combine them with OrTrigger).`,
          chips.length - 1, implied ? {} : { fix: { label: `Split into ${groups.length} triggers`, exprs: groups.map(g => replaceToken(out.input, tokens, chips.length - 1, g)) } });
      }
      if (shown) chips[chips.length - 1].field = f;
      fields.push(f);
      by[f.kind] = f;
    }
    out.fields = fields;
    // day='1st mon' is a weekday rule that lives in the day field; it still has to agree with day_of_week.
    if (by.dom.special && by.dom.special.type !== 'L') {
      const sp = by.dom.special;
      if (!by.dow.list.includes(sp.dow)) {
        throw new CronError(`\`day='${by.dom.raw}'\` picks a ${DOW_LONG[sp.dow]}, but \`day_of_week\` excludes ${DOW_LONG[sp.dow]}s, so this never runs.`, by.dom.index);
      }
      by.dow = Object.assign(makeField('dow', by.dow.raw, by.dow.index, []), { special: sp });
      by.dom = makeField('dom', '*', by.dom.index, ALL_DAYS);
    }
    return Object.assign(out, modelFromFields(by, 'and'), { ok: true, by });
  }

  function looksLikeField(tok) {
    return /^[\d*?/,\-LW#]+$/i.test(tok) || /^(SUN|MON|TUE|WED|THU|FRI|SAT|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)([-,/].*)?$/i.test(tok);
  }

  function countMessage(D, n) {
    const names = D.fields.map(f => f.endsWith('?') ? `[${FIELD_LABEL[f.slice(0, -1)]}]` : FIELD_LABEL[f]).join(' ');
    const max = D.fields.length, min = D.fields.filter(f => !f.endsWith('?')).length;
    const need = min === max ? String(max) : `${min} or ${max}`;
    const five = max === 5;
    let msg = `This has ${n} field${n === 1 ? '' : 's'}; ${D.name} uses ${need}: ${names}.`;
    if (five && n === 6) msg += ' Six fields usually means a seconds field (Quartz, Spring, Azure) or a year field (EventBridge).';
    if (five && n === 7) msg += ' Seven fields is Quartz format.';
    if (!five && min > 5 && n === 5) msg += ' Five fields is crontab format.';
    return msg;
  }

  /*
   * Where an expression sits inside pasted text. The first matching entry wins. `when` must also
   * match the whole text; `call` takes the whole function call (APScheduler keeps its arguments).
   */
  const WRAPPERS = [
    { re: /@Scheduled\s*\(\s*cron\s*=\s*"([^"]*)"/d, dialect: 'spring', note: 'Read the expression from a Spring @Scheduled annotation.' },
    { re: /cronSchedule\s*\(\s*"([^"]*)"/d, dialect: 'quartz', note: 'Read the expression from a Quartz cronSchedule() call.' },
    { re: /--schedule-expression[ \t=]+['"]?((?:cron|rate|at)\([^)]*\))/d, dialect: 'eventbridge', note: 'Read the expression from an AWS CLI command.' },
    { re: /ScheduleExpression['"]?[ \t]*[:=][ \t]*['"]?((?:cron|rate|at)\([^)]*\))/d, dialect: 'eventbridge', note: 'Read the expression from a ScheduleExpression setting.' },
    { re: /(?:^|\n)[ \t]*OnCalendar[ \t]*=[ \t]*(\S[^\n]*?)[ \t]*(?=\r?\n|$)/d, dialect: 'systemd', note: 'Read the expression from an `OnCalendar=` line.' },
    { re: /\[\s*TimerTrigger\s*\(\s*"([^"]*)"/d, dialect: 'azure', note: 'Read the expression from a [TimerTrigger] attribute.' },
    { re: /@TimerTrigger\s*\([^)]*?\bschedule\s*=\s*"([^"]*)"/d, dialect: 'azure', note: 'Read the expression from a @TimerTrigger annotation.' },
    { re: /\.(?:timer_trigger|schedule)\s*\([^)]*?\bschedule\s*=\s*["']([^"']*)["']/d, dialect: 'azure', note: 'Read the expression from a timer trigger decorator.' },
    { re: /\bapp\.timer\s*\([^)]*?\bschedule\s*:\s*['"]([^'"]*)['"]/d, dialect: 'azure', note: 'Read the expression from an app.timer() registration.' },
    { re: /"schedule"\s*:\s*"([^"]*)"/d, when: /timerTrigger/i, dialect: 'azure', note: 'Read the expression from a function.json timer binding.' },
    { re: /\bcrons['"]?\s*[=:]\s*\[\s*["']([^"']*)["']/d, dialect: 'cloudflare', note: 'Read the expression from a Wrangler `crons` list.' },
    { re: /\bcron\s*=\s*"([^"]*)"/d, when: /gitlab_pipeline_schedule/, dialect: 'gitlab', note: 'Read the expression from a gitlab_pipeline_schedule resource.' },
    { re: /"cron"\s*:\s*"([^"]*)"/d, when: /cron_timezone/, dialect: 'gitlab', note: 'Read the expression from a GitLab pipeline schedule.' },
    { re: /--cron[ \t=]+["']([^"']*)["']/d, when: /\bglab\b/, dialect: 'gitlab', note: 'Read the expression from a glab command.' },
    { re: /CronTrigger\s*\.\s*from_crontab\s*\(/d, call: true, dialect: 'apscheduler', note: 'Read the expression from CronTrigger.from_crontab().' },
    { re: /CronTrigger\s*\(/d, call: true, dialect: 'apscheduler', note: 'Read the schedule from a CronTrigger.' },
    { re: /\b(?:add_job|scheduled_job)\s*\((?=[^)]*['"]cron['"])/d, call: true, dialect: 'apscheduler', note: 'Read the schedule from an APScheduler cron job.' },
    { re: /(?:^|\n)[ \t]*-?[ \t]*cron[ \t]*:[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|(\S[^\n#]*?))[ \t]*(?:#[^\n]*)?(?=\n|$)/d, dialect: 'github', note: 'Read the expression from a GitHub Actions `cron:` line.' },
    { re: /(?:^|\n)[ \t]*schedule[ \t]*:[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|(\S[^\n#]*?))[ \t]*(?:#[^\n]*)?(?=\n|$)/d, dialect: 'k8s', note: 'Read the expression from a Kubernetes `schedule:` line.' },
    { re: /^\s*(?:'([^']*)'|"([^"]*)")\s*$/d, dialect: null, note: null },
  ];

  /** Index just past the parenthesis that closes the one opened at `open`, skipping quoted text. */
  function closeParen(text, open) {
    let depth = 0, q = null;
    for (let i = open; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === '(') depth++;
      else if (c === ')' && --depth === 0) return i + 1;
    }
    return text.length;
  }

  // Time zone settings that sit next to the expression in a pasted config block. A `soft` key may
  // hold a name that isn't an IANA zone (Windows or Rails names), which earns a note, not an error.
  const TZ_KEYS = [
    { re: /(?:^|\n)[ \t]*timezone[ \t]*:[ \t]*['"]?([A-Za-z][\w+\-/]*)/d, label: '`timezone:`' },
    { re: /(?:^|\n)[ \t]*timeZone[ \t]*:[ \t]*['"]?([A-Za-z][\w+\-/]*)/d, label: '`timeZone:`' },
    { re: /\bzone[ \t]*=[ \t]*"([^"]+)"/d, label: '`zone =`' },
    { re: /--schedule-expression-timezone[ \t=]+['"]?([^'"\s]+)/d, label: '`--schedule-expression-timezone`' },
    { re: /ScheduleExpressionTimezone['"]?[ \t]*[:=][ \t]*['"]?([^'"\s,}]+)/d, label: '`ScheduleExpressionTimezone`' },
    { re: /inTimeZone\s*\(\s*TimeZone\.getTimeZone\s*\(\s*"([^"]+)"/d, label: '`inTimeZone()`' },
    { re: /\btimezone\s*=\s*(?:(?:pytz\.timezone|ZoneInfo|tz\.gettz|gettz)\s*\(\s*)?['"]([^'"]+)['"]/d, label: '`timezone=`' },
    { re: /WEBSITE_TIME_ZONE['"]?[ \t]*[:=][ \t]*['"]?([^'"\n,}]+?)['"]?[ \t]*(?:[,}\n]|$)/d, label: '`WEBSITE_TIME_ZONE`', soft: true },
    { re: /cron_timezone['"]?\s*[:=]\s*['"]([^'"]+)['"]/d, label: '`cron_timezone`', soft: true },
  ];

  function isValidZone(tz) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
  }

  /**
   * Find the cron expression inside pasted text: a config line, a whole workflow or manifest,
   * an annotation, a CLI command or a crontab file. Returns { core, base, tz, tzSource, tzPrefix,
   * notes, dialect } where core is the expression text, base its offset in the input, and dialect
   * the scheduler the surrounding text implies (or null). Throws CronError for unusable text.
   */
  function unwrap(text) {
    const out = { core: text, base: 0, tz: null, tzSource: null, tzPrefix: null, notes: [], dialect: null, wrapped: false };
    let core = text, base = 0, m;
    const setZone = (zone, source) => {
      if (!isValidZone(zone)) throw new CronError(`\`${zone}\` isn't a time zone this browser knows.`);
      out.tz = zone;
      out.tzSource = source;
    };
    for (const k of TZ_KEYS) {
      m = k.re.exec(text);
      if (!m) continue;
      const zone = m[1].trim();
      if (k.soft && !isValidZone(zone)) out.notes.push(`${k.label} is \`${zone}\`, which isn't a tz database name; pick the matching time zone below.`);
      else setZone(zone, k.label);
      break;
    }
    for (const w of WRAPPERS) {
      if (w.when && !w.when.test(text)) continue;
      m = w.re.exec(core);
      if (!m) continue;
      if (w.note) out.notes.push(w.note);
      out.dialect = w.dialect;
      if (w.call) {
        // Keep the whole call, arguments and line breaks included.
        out.core = core.slice(m.index, closeParen(core, m.index + m[0].length - 1));
        out.base = m.index;
        out.call = true;
        return out;
      }
      const gi = [1, 2, 3].find(i => m[i] !== undefined);
      base += m.indices[gi][0];
      core = m[gi];
      break;
    }
    if (/\n/.test(core.trim())) {
      // A pasted crontab or config: use the first job line, honouring a CRON_TZ line above it.
      let off = 0;
      for (const line of core.split('\n')) {
        const at = off;
        off += line.length + 1;
        const tl = line.trim();
        if (!tl || tl[0] === '#') continue;
        const env = /^([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*['"]?([^'"]*)['"]?$/.exec(tl);
        if (env) {
          if (env[1] === 'CRON_TZ') { setZone(env[2].trim(), '`CRON_TZ`'); out.tzPrefix = 'CRON_TZ=' + env[2].trim(); }
          out.dialect = out.dialect || 'unix';
          continue;
        }
        base += at;
        core = line;
        out.notes.push('Read the first schedule line of the pasted text.');
        break;
      }
    }
    if (/^\s*(rate|at)\(/i.test(core)) {
      throw new CronError(/^\s*rate/i.test(core)
        ? 'That is an EventBridge `rate()` expression, not cron. It repeats at a fixed interval counted from when the schedule starts.'
        : 'That is an EventBridge one-time `at()` schedule, not cron.');
    }
    m = /^\s*cron\(([^)]*)\)\s*$/di.exec(core);
    if (m) { base += m.indices[1][0]; core = m[1]; out.wrapped = true; out.dialect = out.dialect || 'eventbridge'; }
    m = /^\s*(?:CRON_TZ|TZ)=(\S+)\s+/d.exec(core);
    if (m) {
      setZone(m[1], '`' + m[0].trim().split('=')[0] + '`');
      out.tzPrefix = m[0].trim();
      base += m[0].length;
      core = core.slice(m[0].length);
    }
    out.core = core;
    out.base = base;
    return out;
  }

  /** Field kinds for an expression with n fields (an optional field may come first or last). */
  function kindsFor(D, n) {
    const all = D.fields.map(f => f.replace('?', ''));
    if (n >= all.length) return all;
    return D.fields[0].endsWith('?') ? all.slice(all.length - n) : all.slice(0, n);
  }

  function modelFromFields(by, combine) {
    const yf = by.year;
    return buildModel({
      seconds: by.second ? by.second.list : [0],
      minutes: by.minute.list,
      hours: by.hour.list,
      months: by.month.list,
      years: yf && yf.raw !== '*' ? yf.list : null,
      dom: { list: by.dom.list, special: by.dom.special },
      dow: { list: by.dow.list, special: by.dow.special },
      combine,
    });
  }

  /** Parse an expression in the given dialect. Returns a model or { ok:false, error }. */
  function parse(input, dialectId) {
    const D = DIALECTS[dialectId];
    if (!D) throw new Error('Unknown dialect ' + dialectId);
    const text = String(input == null ? '' : input);
    const out = { ok: false, dialect: dialectId, input: text, tokens: [], notes: [], tz: null };
    let tokens = [];
    try {
      const u = unwrap(text);
      const core = u.core, base = u.base;
      out.notes.push(...u.notes);
      if (u.tz) { out.tz = u.tz; out.tzSource = u.tzSource; }
      if (u.tzPrefix) out.tzPrefix = u.tzPrefix;
      if (u.wrapped) out.wrapped = true;
      if (D.custom) return D.family === 'systemd' ? parseSystemd(u, out, D) : parseAps(u, out, D);
      const re = /\S+/g;
      let t;
      while ((t = re.exec(core))) tokens.push({ text: t[0], start: base + t.index, end: base + t.index + t[0].length });
      out.tokens = tokens;
      if (!tokens.length) throw new CronError(`Type an expression, for example \`${EXAMPLE_BY_DIALECT[dialectId]}\`.`);

      let raws;
      if (tokens[0].text[0] === '@') {
        const name = tokens[0].text.toLowerCase();
        if (name === '@reboot') {
          if (!D.reboot) throw new CronError(`${D.name} has no \`@reboot\`.`, 0);
          return Object.assign(out, { ok: true, reboot: true, macro: '@reboot', fields: [], tokens: tokens.slice(0, 1) });
        }
        if (!D.macros) throw new CronError(`${D.name} doesn't accept @ shortcuts. Write the fields out, e.g. \`${EXAMPLE_BY_DIALECT[dialectId]}\`.`, 0);
        const exp = D.macros[name];
        if (!exp) throw new CronError(`Unknown shortcut \`${tokens[0].text}\`. ${D.name} accepts ${Object.keys(D.macros).join(', ')}.`, 0);
        if (tokens.length > 1) {
          if (D.commandTail) out.command = text.slice(tokens[1].start).trim();
          else throw new CronError(`Nothing can follow \`${tokens[0].text}\`.`, 1);
        }
        out.macro = name;
        out.macroExpansion = exp;
        raws = exp.split(' ');
        tokens = tokens.slice(0, 1);
        out.tokens = tokens;
      } else {
        const max = D.fields.length;
        const min = D.fields.filter(f => !f.endsWith('?')).length;
        if (D.commandTail && tokens.length > max && !looksLikeField(tokens[max].text)) {
          out.command = text.slice(tokens[max].start).trim();
          tokens = tokens.slice(0, max);
          out.tokens = tokens;
        }
        if (tokens.length < min || tokens.length > max) throw new CronError(countMessage(D, tokens.length), -1, { countMismatch: true });
        raws = tokens.map(x => x.text);
      }

      const kinds = kindsFor(D, raws.length);
      out.kinds = kinds;
      const di = kinds.indexOf('dom'), wi = kinds.indexOf('dow');
      // GitLab (fugit): a trailing & on a day field makes the two day fields AND instead of OR.
      let amp = false;
      if (D.specials.amp) {
        raws = raws.map((r, i) => {
          if ((i === di || i === wi) && r.length > 1 && r.endsWith('&')) { amp = true; return r.slice(0, -1); }
          return r;
        });
      }
      if (D.specials.hash && D.id === 'gitlab' && !out.macro && raws[wi].includes(',') && raws[wi].includes('#')) {
        const items = raws[wi].split(',');
        const groups = items.filter(x => x.includes('#'));
        const plain = items.filter(x => !x.includes('#'));
        if (plain.length) groups.push(plain.join(','));
        const suffix = tokens[wi].text.endsWith('&') ? '&' : '';
        throw new CronError(
          `\`${raws[wi]}\` lists several \`#\` days. GitLab accepts that, but Cron Almanac reads one \`#\` per schedule, so split it into ${groups.length} schedules that run the same job.`,
          wi, { fix: { label: `Split into ${groups.length} schedules`, exprs: groups.map(g => replaceToken(text, tokens, wi, g + suffix)) } });
      }
      const fields = raws.map((raw, i) => parseField(raw, kinds[i], D, out.macro ? 0 : i));
      const by = {};
      fields.forEach(f => { by[f.kind] = f; });
      out.fields = fields;
      if (amp) out.amp = true;

      if (D.dayRule === 'quartz') {
        const dq = by.dom.question, wq = by.dow.question;
        if (dq && wq) {
          throw new CronError('Only one of day-of-month and day-of-week can be `?`. Put `*` in the other.', di,
            { fix: { label: 'Use * for day-of-month', expr: replaceToken(text, tokens, di, '*') } });
        }
        if (!dq && !wq) {
          let fix = null;
          if (by.dow.raw === '*') fix = { label: 'Use ? for day-of-week', expr: replaceToken(text, tokens, wi, '?') };
          else if (by.dom.raw === '*') fix = { label: 'Use ? for day-of-month', expr: replaceToken(text, tokens, di, '?') };
          throw new CronError(
            `${D.name} needs \`?\` in either day-of-month or day-of-week to know which one to use.` +
            (fix ? '' : ' Both are set here, which takes two separate schedules.'),
            fix ? (fix.label.includes('week') ? wi : di) : wi, { fix },
          );
        }
      }

      let combine;
      if (D.dayRule === 'vixie') combine = (by.dom.vixieStar || by.dow.vixieStar) ? 'and' : 'or';
      else if (D.dayRule === 'robfig') combine = (by.dom.robfigStar || by.dow.robfigStar) ? 'and' : 'or';
      else if (D.dayRule === 'star') combine = (amp || by.dom.raw === '*' || by.dow.raw === '*') ? 'and' : 'or';
      else if (D.dayRule === 'quartz') combine = by.dom.question ? 'dow' : 'dom';
      else combine = 'and';

      return Object.assign(out, modelFromFields(by, combine), { ok: true, by });
    } catch (e) {
      if (!(e instanceof CronError)) throw e;
      out.error = { message: e.message, field: e.field, fix: e.fix || null, countMismatch: !!e.countMismatch };
      if (!out.chips) out.tokens = tokens;
      return out;
    }
  }

  function replaceToken(text, tokens, i, replacement) {
    const t = tokens[i];
    if (!t) return text;
    return text.slice(0, t.start) + replacement + text.slice(t.end);
  }

  const EXAMPLE_BY_DIALECT = {
    unix: '0 9 * * 1-5', systemd: 'Mon..Fri *-*-* 09:00:00', github: '17 9 * * 1-5', gitlab: '0 9 * * 1-5',
    k8s: '0 9 * * 1-5', eventbridge: 'cron(0 9 ? * MON-FRI *)', cloudflare: '0 9 * * MON-FRI', azure: '0 0 9 * * 1-5',
    quartz: '0 0 9 ? * MON-FRI', spring: '0 0 9 * * MON-FRI', apscheduler: "day_of_week='mon-fri', hour=9",
  };

  /** Build the dialect-independent schedule model. */
  function buildModel(s) {
    let dom = { list: s.dom.list.slice(), special: s.dom.special || null };
    if (dom.special && dom.special.type === 'fromEnd') dom.special = fromEndSpecial(dom.special.offsets);
    dom.all = !dom.special && dom.list.length === 31;
    let dow = { list: s.dow.list.slice(), special: s.dow.special || null };
    dow.all = !dow.special && dow.list.length === 7;
    let mode;
    switch (s.combine) {
      case 'dom': mode = dom.all ? 'all' : 'dom'; break;
      case 'dow': mode = dow.all ? 'all' : 'dow'; break;
      case 'or': mode = (dom.all || dow.all) ? 'all' : 'or'; break;
      default: mode = dom.all ? (dow.all ? 'all' : 'dow') : (dow.all ? 'dom' : 'and');
    }
    // A single weekday ANDed with one week of dates is "the nth weekday" (1-7 and Monday = first Monday);
    // with the last seven days it is "the last weekday". Saying so makes it portable to # and L.
    if (mode === 'and' && !dow.special && dow.list.length === 1) {
      const L = dom.list, d = dow.list[0];
      const n = (L[0] + 6) / 7;
      const block = !dom.special && Number.isInteger(n) && n <= 5 && L.length === Math.min(7, 32 - L[0]) && L[L.length - 1] - L[0] === L.length - 1;
      const last7 = !!dom.special && dom.special.type === 'fromEnd' && dom.special.offsets.join() === '0,1,2,3,4,5,6';
      if (block || last7) {
        dom = { list: ALL_DAYS.slice(), special: null, all: true };
        dow = { list: [], special: block ? { type: 'nth', dow: d, n } : { type: 'lastDow', dow: d }, all: false };
        mode = 'dow';
      }
    }
    dom.has = boolArr(32, dom.list);
    dow.has = boolArr(7, dow.list);
    const times = [];
    for (const h of s.hours) for (const m of s.minutes) for (const sec of s.seconds) times.push(h * 3600 + m * 60 + sec);
    return {
      seconds: s.seconds.slice(), minutes: s.minutes.slice(), hours: s.hours.slice(),
      months: s.months.slice(), monthHas: boolArr(13, s.months),
      years: s.years ? s.years.slice() : null, yearSet: s.years ? new Set(s.years) : null,
      dom, dow, combine: s.combine, dayMode: mode, times,
    };
  }

  // ---------------------------------------------------------------- matching days

  function nearestWeekday(y, m, dim, n) {
    if (n > dim) return -1;
    const wd = weekday(y, m, n);
    if (wd === 6) return n === 1 ? 3 : n - 1;
    if (wd === 0) return n === dim ? n - 2 : n + 1;
    return n;
  }

  function lastWeekday(y, m, dim) {
    const wd = weekday(y, m, dim);
    return wd === 6 ? dim - 1 : wd === 0 ? dim - 2 : dim;
  }

  function domMatch(dom, y, m, d, dim) {
    const sp = dom.special;
    if (sp) {
      if (sp.type === 'L') return d === dim - sp.offset;
      if (sp.type === 'fromEnd') return sp.offsets.includes(dim - d);
      if (sp.type === 'LW') return d === lastWeekday(y, m, dim);
      if (sp.type === 'W') return d === nearestWeekday(y, m, dim, sp.day);
    }
    return dom.has[d];
  }

  function dowMatch(dow, d, dim, wd) {
    const sp = dow.special;
    if (sp) {
      if (sp.type === 'nth') return wd === sp.dow && Math.floor((d - 1) / 7) + 1 === sp.n;
      if (sp.type === 'lastDow') return wd === sp.dow && d + 7 > dim;
    }
    return dow.has[wd];
  }

  function dayMatches(M, y, m, d) {
    if (!M.monthHas[m]) return false;
    if (M.yearSet && !M.yearSet.has(y)) return false;
    const dim = daysInMonth(y, m);
    if (d > dim) return false;
    switch (M.dayMode) {
      case 'all': return true;
      case 'dom': return domMatch(M.dom, y, m, d, dim);
      case 'dow': return dowMatch(M.dow, d, dim, weekday(y, m, d));
      case 'or': return domMatch(M.dom, y, m, d, dim) || dowMatch(M.dow, d, dim, weekday(y, m, d));
      case 'and': return domMatch(M.dom, y, m, d, dim) && dowMatch(M.dow, d, dim, weekday(y, m, d));
    }
    return false;
  }

  function horizonYear(M, fromYear) {
    const cap = fromYear + 30;
    if (M.years) return Math.min(Math.max(...M.years), 2199);
    return cap;
  }

  /** Calls fn(dayMs, y, m, d) for matching wall-clock days starting at dayMs, until fn returns false or the horizon. */
  function eachMatchingDay(M, startDay, endYear, fn) {
    let cur = startDay;
    for (;;) {
      const dt = new Date(cur);
      const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
      if (y > endYear) return;
      if (M.yearSet && !M.yearSet.has(y)) { cur = Date.UTC(y + 1, 0, 1); continue; }
      if (!M.monthHas[m]) { cur = Date.UTC(y, m, 1); continue; }
      if (dayMatches(M, y, m, d) && fn(cur, y, m, d) === false) return;
      cur += DAY;
    }
  }

  // ---------------------------------------------------------------- time zones

  const fmtCache = new Map();
  function partsFormatter(tz) {
    let f = fmtCache.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
      });
      fmtCache.set(tz, f);
    }
    return f;
  }

  function wallParts(t, tz) {
    const out = { y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0 };
    for (const p of partsFormatter(tz).formatToParts(new Date(t))) {
      switch (p.type) {
        case 'year': out.y = +p.value; break;
        case 'month': out.mo = +p.value; break;
        case 'day': out.d = +p.value; break;
        case 'hour': out.h = +p.value % 24; break;
        case 'minute': out.mi = +p.value; break;
        case 'second': out.s = +p.value; break;
      }
    }
    return out;
  }

  /** Offset (ms) of local wall time from UTC at instant t. */
  function offsetAt(t, tz) {
    if (tz === 'UTC' || tz === 'Etc/UTC') return 0;
    const ts = Math.floor(t / 1000) * 1000;
    const w = wallParts(ts, tz);
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - ts;
  }

  const zoneCache = new Map();
  /** Offset transitions for a zone during a calendar year (padded by two days each side). */
  function zoneYear(tz, y) {
    const key = tz + '|' + y;
    let z = zoneCache.get(key);
    if (z) return z;
    const start = Date.UTC(y, 0, 1) - 2 * DAY, end = Date.UTC(y + 1, 0, 1) + 2 * DAY;
    let t = start, o = offsetAt(t, tz);
    z = { start, end, startOffset: o, trans: [] };
    while (t < end) {
      const nt = Math.min(t + DAY, end);
      const no = offsetAt(nt, tz);
      if (no !== o) {
        let lo = t, hi = nt;
        while (hi - lo > 1000) {
          const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
          if (offsetAt(mid, tz) === o) lo = mid; else hi = mid;
        }
        z.trans.push({ t: hi, before: o, after: no });
        o = no;
      }
      t = nt;
    }
    zoneCache.set(key, z);
    return z;
  }

  function transitionsBetween(tz, a, b) {
    const ya = new Date(a).getUTCFullYear(), yb = new Date(b).getUTCFullYear();
    const seen = new Set(), out = [];
    for (let y = ya; y <= yb; y++) {
      for (const tr of zoneYear(tz, y).trans) {
        if (tr.t >= a && tr.t < b && !seen.has(tr.t)) { seen.add(tr.t); out.push(tr); }
      }
    }
    return out.sort((x, y) => x.t - y.t);
  }

  function cachedOffset(tz, t) {
    const z = zoneYear(tz, new Date(t).getUTCFullYear());
    let o = z.startOffset;
    for (const tr of z.trans) if (tr.t <= t) o = tr.after;
    return o;
  }

  /** Offset segments that cover every instant belonging to the local day starting at wall time W0. */
  function daySegments(tz, W0) {
    const trs = transitionsBetween(tz, W0 - 16 * 3600000, W0 + 40 * 3600000);
    if (!trs.length) return [{ from: -Infinity, to: Infinity, off: cachedOffset(tz, W0) }];
    const segs = [{ from: -Infinity, to: trs[0].t, off: trs[0].before }];
    trs.forEach((tr, i) => segs.push({ from: tr.t, to: i + 1 < trs.length ? trs[i + 1].t : Infinity, off: tr.after }));
    return segs;
  }

  /** Instants at which wall time w (ms, as if UTC) occurs, given segments. 0 = skipped, 2 = repeated. */
  function wallInstants(w, segs) {
    const out = [];
    for (const s of segs) { const t = w - s.off; if (t >= s.from && t < s.to) out.push(t); }
    return out;
  }

  function gapBoundary(w, segs) {
    for (let i = 0; i + 1 < segs.length; i++) {
      const a = segs[i], b = segs[i + 1];
      if (w - a.off >= a.to && w - b.off < b.from) return { t: a.to, before: a.off, after: b.off };
    }
    return null;
  }

  /**
   * Upcoming runs after fromMs. Wall-clock semantics: a time skipped by a
   * spring-forward is reported as one 'skipped' entry per transition; a time
   * repeated by a fall-back occurs twice (second one has kind 'repeat').
   */
  function upcoming(M, tz, fromMs, count) {
    const runs = [];
    if (M.reboot || !M.times.length) return { runs, exhausted: true };
    const T = M.times;
    const w0 = wallParts(fromMs, tz);
    const startDay = Date.UTC(w0.y, w0.mo - 1, w0.d) - DAY;
    const endYear = horizonYear(M, w0.y);
    let exhausted = true;
    eachMatchingDay(M, startDay, endYear, (W0, y, m, d) => {
      const segs = daySegments(tz, W0);
      if (segs.length === 1) {
        const o = segs[0].off;
        let i = lowerBound(T, Math.floor((fromMs + o - W0) / 1000) + 1);
        for (; i < T.length && runs.length < count; i++) {
          const t = W0 + T[i] * 1000 - o;
          if (t > fromMs) runs.push({ t, y, m, d, sec: T[i], kind: 'run' });
        }
      } else {
        const list = [];
        const skipped = new Map();
        for (const sec of T) {
          const w = W0 + sec * 1000;
          const ts = wallInstants(w, segs);
          if (ts.length === 0) {
            const tr = gapBoundary(w, segs);
            if (!tr) continue;
            const e = skipped.get(tr.t);
            if (e) { e.count++; e.lastSec = sec; } else {
              const entry = { t: tr.t, y, m, d, sec, lastSec: sec, kind: 'skipped', count: 1, tr };
              skipped.set(tr.t, entry);
              list.push(entry);
            }
          } else if (ts.length === 1) {
            list.push({ t: ts[0], y, m, d, sec, kind: 'run' });
          } else {
            const tr = { before: w - ts[0], after: w - ts[1] };
            list.push({ t: ts[0], y, m, d, sec, kind: 'run', repeats: true, tr });
            list.push({ t: ts[1], y, m, d, sec, kind: 'repeat', tr });
          }
        }
        list.sort((a, b) => a.t - b.t);
        for (const e of list) {
          if (runs.length >= count) break;
          if (e.t > fromMs) runs.push(e);
        }
      }
      if (runs.length >= count) { exhausted = false; return false; }
      return true;
    });
    return { runs, exhausted };
  }

  /**
   * What each scheduler is documented to do when a local time is skipped (spring forward)
   * or repeated (fall back). gap: 'after' | 'skip' | null; overlap: 'once' | 'twice' | null.
   * null means the scheduler's documentation doesn't say.
   */
  function dstPolicy(P) {
    switch (P.dialect) {
      case 'unix': {
        // cron(8) on Debian, Ubuntu and cronie: only fixed-time jobs get special handling.
        const wild = !P.reboot && (P.by.minute.vixieStar || P.by.hour.vixieStar);
        return wild ? { gap: 'skip', overlap: 'twice', wild: true } : { gap: 'after', overlap: 'once', wild: false };
      }
      case 'github': return { gap: 'after', overlap: null };
      case 'eventbridge': return { gap: 'skip', overlap: 'once' };
      case 'quartz': return { gap: 'skip', overlap: 'once' };
      // APScheduler's cron trigger docs: a skipped local time doesn't run, a repeated one runs twice.
      case 'apscheduler': return { gap: 'skip', overlap: 'twice' };
      default: return { gap: null, overlap: null };
    }
  }

  /** Runs that fall into DST gaps or overlaps between a and b. */
  function dstImpact(M, tz, a, b) {
    if (M.reboot || !M.times.length) return [];
    const T = M.times;
    return transitionsBetween(tz, a, b).map(tr => {
      const gap = tr.after > tr.before;
      const ws = tr.t + Math.min(tr.before, tr.after), we = tr.t + Math.max(tr.before, tr.after);
      let affected = 0;
      const samples = [];
      for (let day = Math.floor(ws / DAY) * DAY; day < we; day += DAY) {
        const dt = new Date(day);
        const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
        if (!dayMatches(M, y, m, d)) continue;
        const lo = Math.max(0, Math.ceil((ws - day) / 1000)), hi = Math.min(86400, (we - day) / 1000);
        for (let i = lowerBound(T, lo); i < T.length && T[i] < hi; i++) {
          affected++;
          if (samples.length < 4) samples.push({ day, sec: T[i] });
        }
      }
      const wd = new Date(ws);
      return {
        tr, gap, ws, we, affected, samples,
        date: { y: wd.getUTCFullYear(), m: wd.getUTCMonth() + 1, d: wd.getUTCDate() },
      };
    });
  }

  /** Summary numbers: runs per year, runs per active day, shortest and longest gaps (wall clock). */
  function stats(M, tz, fromMs) {
    if (M.reboot || !M.times.length) return null;
    const T = M.times;
    const w0 = wallParts(fromMs, tz);
    const today = Date.UTC(w0.y, w0.mo - 1, w0.d);
    let activeDays = 0;
    const days = [];
    const limit = today + 366 * DAY;
    eachMatchingDay(M, today, horizonYear(M, w0.y), (day) => {
      if (day < today + 365 * DAY) activeDays++;
      days.push(day);
      return !(day >= limit && days.length >= 2);
    });
    let minGap = Infinity, maxGap = 0;
    for (let i = 1; i < T.length; i++) {
      const g = T[i] - T[i - 1];
      if (g < minGap) minGap = g;
      if (g > maxGap) maxGap = g;
    }
    for (let i = 1; i < days.length; i++) {
      const g = (days[i] - days[i - 1]) / 1000 - T[T.length - 1] + T[0];
      if (g < minGap) minGap = g;
      if (g > maxGap) maxGap = g;
    }
    const totalRuns = days.length * T.length;
    return {
      perYear: activeDays * T.length,
      perDay: T.length,
      activeDays,
      minGap: totalRuns >= 2 ? minGap : null,
      maxGap: totalRuns >= 2 ? maxGap : null,
    };
  }

  // ---------------------------------------------------------------- several schedules together

  function mergeSorted(a, b) {
    const out = [];
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      const v = j >= b.length || (i < a.length && a[i] <= b[j]) ? a[i++] : b[j++];
      if (out[out.length - 1] !== v) out.push(v);
    }
    return out;
  }

  /**
   * Upcoming runs of several schedules that make up one job, in time order. Each run lists the
   * schedules that produce it in `which` (indexes into models); a time two schedules share appears once.
   */
  function upcomingSet(models, tz, fromMs, count) {
    const lists = models.map(M => upcoming(M, tz, fromMs, count));
    const all = [];
    lists.forEach((l, i) => l.runs.forEach(r => all.push(Object.assign({}, r, { which: [i] }))));
    all.sort((a, b) => a.t - b.t || a.which[0] - b.which[0]);
    const merged = [];
    for (const r of all) {
      const prev = merged[merged.length - 1];
      if (prev && prev.t === r.t && prev.kind === r.kind && r.kind !== 'skipped') { prev.which.push(r.which[0]); continue; }
      merged.push(r);
    }
    // A list cut off at `count` may hide later runs, so stop at the earliest cut-off.
    let cut = Infinity;
    for (const l of lists) if (!l.exhausted && l.runs.length) cut = Math.min(cut, l.runs[l.runs.length - 1].t);
    const runs = merged.filter(r => r.t <= cut).slice(0, count);
    return { runs, exhausted: lists.every(l => l.exhausted) && runs.length === merged.length };
  }

  /** stats() for several schedules: runs per year, runs per day (min and max), gaps, and coinciding runs. */
  function statsSet(models, tz, fromMs) {
    if (models.some(M => M.reboot || !M.times.length)) return null;
    if (models.length === 1) {
      const st = stats(models[0], tz, fromMs);
      return Object.assign(st, { perDayMin: st.perDay, perDayMax: st.perDay, overlaps: 0 });
    }
    const w0 = wallParts(fromMs, tz);
    const today = Date.UTC(w0.y, w0.mo - 1, w0.d);
    const unions = new Map();
    const unionFor = mask => {
      let u = unions.get(mask);
      if (u) return u;
      const sets = models.filter((_, i) => mask & (1 << i)).map(M => M.times);
      let T = sets[0];
      for (let k = 1; k < sets.length; k++) T = mergeSorted(T, sets[k]);
      let minG = Infinity, maxG = 0;
      for (let i = 1; i < T.length; i++) {
        const g = T[i] - T[i - 1];
        if (g < minG) minG = g;
        if (g > maxG) maxG = g;
      }
      u = { T, minG, maxG, dup: sets.reduce((a, x) => a + x.length, 0) - T.length };
      unions.set(mask, u);
      return u;
    };
    const endYear = Math.max(...models.map(M => horizonYear(M, w0.y)));
    let activeDays = 0, perYear = 0, overlaps = 0, perDayMin = Infinity, perDayMax = 0;
    let minGap = Infinity, maxGap = 0, prev = null, total = 0;
    const yearEnd = today + 365 * DAY;
    for (let day = today; ; day += DAY) {
      const dt = new Date(day);
      const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
      if (y > endYear || (day >= yearEnd + DAY && total >= 2)) break;
      let mask = 0;
      models.forEach((M, i) => { if (dayMatches(M, y, m, d)) mask |= 1 << i; });
      if (!mask) continue;
      const u = unionFor(mask);
      if (day < yearEnd) {
        activeDays++;
        perYear += u.T.length;
        overlaps += u.dup;
        perDayMin = Math.min(perDayMin, u.T.length);
        perDayMax = Math.max(perDayMax, u.T.length);
      }
      minGap = Math.min(minGap, u.minG);
      maxGap = Math.max(maxGap, u.maxG);
      if (prev) {
        const g = (day - prev.day) / 1000 - prev.last + u.T[0];
        minGap = Math.min(minGap, g);
        maxGap = Math.max(maxGap, g);
      }
      prev = { day, last: u.T[u.T.length - 1] };
      total += u.T.length;
    }
    return {
      perYear, activeDays, overlaps,
      perDay: perDayMax, perDayMin: activeDays ? perDayMin : 0, perDayMax,
      minGap: total >= 2 ? minGap : null,
      maxGap: total >= 2 ? maxGap : null,
    };
  }

  /** Checks that only make sense for a set of schedules. */
  function lintSet(models, tz, now) {
    const out = [];
    if (models.length < 2 || models.some(M => M.reboot)) return out;
    const st = statsSet(models, tz, now);
    if (st && st.overlaps) {
      const hit = upcomingSet(models, tz, now, 400).runs.find(r => r.which.length > 1);
      let when = '';
      if (hit) {
        const p = displayParts(hit.t, tz);
        when = ` The next one is ${p.weekday} ${p.day} ${p.month} at ${p.hour}:${p.minute}, from schedules ${joinList(hit.which.map(i => String(i + 1)))}.`;
      }
      out.push({
        level: 'warn', id: 'overlap', title: 'Two schedules fire at the same time', fix: null,
        body: `In the next year, ${st.overlaps} run${st.overlaps === 1 ? '' : 's'} from different schedules land on the same minute.${when} Most schedulers start the job once per schedule, so it runs twice at those times.`,
      });
    }
    return out;
  }

  /** Distinct UTC offsets in effect over [a, b), with their date ranges. */
  function offsetPeriods(tz, a, b) {
    const trs = transitionsBetween(tz, a, b);
    const periods = [];
    let from = a, off = cachedOffset(tz, a);
    for (const tr of trs) { periods.push({ from, to: tr.t, off }); from = tr.t; off = tr.after; }
    periods.push({ from, to: b, off });
    return periods;
  }

  // ---------------------------------------------------------------- English

  function fmtSet(vals, f, maxList) {
    maxList = maxList || 6;
    if (vals.length <= maxList) return joinList(vals.map(f));
    const g = apStep(vals);
    if (g) return `${f(vals[0])}, ${f(vals[1])}, ${f(vals[2])} … ${f(vals[vals.length - 1])}`;
    const runs = runsOf(vals);
    if (runs.length <= maxList) return joinList(runs.map(([a, b]) => a === b ? f(a) : b === a + 1 ? `${f(a)}, ${f(b)}` : `${f(a)}–${f(b)}`));
    return `${vals.slice(0, 4).map(f).join(', ')} … ${f(vals[vals.length - 1])}`;
  }

  function timePhrase(M) {
    const T = M.times;
    const withSec = M.seconds.some(s => s !== 0);
    const clock = s => fmtClock(s, withSec);
    if (T.length <= 6) return 'at ' + joinList(T.map(clock));
    const g = apStep(T);
    if (g) {
      if (86400 % g === 0 && T.length === 86400 / g) {
        if (g === 3600 && T[0] !== 0 && T[0] % 60 === 0) return `every hour at :${pad2(T[0] / 60)}`;
        return everyUnit(g) + (T[0] !== 0 ? `, starting at ${clock(T[0])}` : '');
      }
      return `${everyUnit(g)} from ${clock(T[0])} to ${clock(T[T.length - 1])}`;
    }
    const parts = [];
    let hourPart;
    const S = M.seconds, Mi = M.minutes, H = M.hours;
    if (withSec) {
      const gs = apStep(S);
      if (S.length === 60) parts.push('every second');
      else if (gs && S[0] === 0 && 60 % gs === 0) parts.push(`every ${gs} seconds`);
      else parts.push(`at second${S.length > 1 ? 's' : ''} ${fmtSet(S, v => ':' + pad2(v))}`);
    }
    if (Mi.length === 60) parts.push(withSec ? 'of every minute' : 'every minute');
    else {
      const gm = apStep(Mi);
      const r = runsOf(Mi);
      if (r.length === 1 && Mi.length > 2) parts.push(`${withSec ? 'during' : 'every minute from'} :${pad2(Mi[0])} to :${pad2(Mi[Mi.length - 1])}`);
      else if (gm && Mi.length > 6) parts.push(`at minutes ${fmtSet(Mi, v => ':' + pad2(v))}`);
      else parts.push(`at ${Mi.length > 1 ? 'minutes ' : ''}${fmtSet(Mi, v => ':' + pad2(v))}`);
    }
    if (H.length === 24) hourPart = 'of every hour';
    else {
      const r = runsOf(H);
      if (r.length === 1 && H.length > 1) hourPart = `from ${pad2(H[0])}:00 through ${pad2(H[H.length - 1])}:59`;
      else hourPart = `during hour${H.length > 1 ? 's' : ''} ${fmtSet(H, v => pad2(v))}`;
    }
    return parts.join(', ') + ' ' + hourPart;
  }

  const fromLast = k => (k === 0 ? 'last' : `${ordinal(k + 1)}-to-last`);

  function domPhrase(dom) {
    const sp = dom.special;
    if (sp) {
      if (sp.type === 'L') return `the ${fromLast(sp.offset)} day of the month`;
      if (sp.type === 'fromEnd') {
        const o = sp.offsets, r = runsOf(o);
        if (r.length === 1 && o[0] === 0) return `the last ${o.length} days of the month`;
        if (r.length === 1 && o.length > 2) return `the ${fromLast(o[o.length - 1])} through ${fromLast(o[0])} days of the month`;
        return `the ${joinList(o.map(fromLast))} days of the month`;
      }
      if (sp.type === 'LW') return 'the last weekday (Mon–Fri) of the month';
      if (sp.type === 'W') return `the weekday nearest the ${ordinal(sp.day)} of the month`;
    }
    const L = dom.list;
    const runs = runsOf(L);
    if (runs.length === 1 && L.length >= 3) return `the ${ordinal(L[0])} through ${ordinal(L[L.length - 1])} of the month`;
    if (apStep(L) > 1 && L.length > 6) return `the ${fmtSet(L, ordinal)} of the month`;
    const txt = joinList(runs.map(([a, b]) => a === b ? ordinal(a) : b === a + 1 ? `${ordinal(a)}, ${ordinal(b)}` : `${ordinal(a)} through ${ordinal(b)}`));
    return `the ${txt} of the month`;
  }

  const NTH = ['first', 'second', 'third', 'fourth', 'fifth'];

  function dowPhrase(dow, singular) {
    const sp = dow.special;
    if (sp) {
      if (sp.type === 'nth') return `the ${NTH[sp.n - 1]} ${DOW_LONG[sp.dow]} of the month`;
      if (sp.type === 'lastDow') return `the last ${DOW_LONG[sp.dow]} of the month`;
    }
    const L = dow.list;
    const key = L.join(',');
    if (key === '1,2,3,4,5') return 'weekdays (Monday to Friday)';
    if (key === '0,6') return 'weekends';
    const plural = d => singular ? DOW_LONG[d] : DOW_LONG[d] + 's';
    const runs = runsOf(L);
    if (runs.length === 1 && L.length >= 3) return `${DOW_LONG[L[0]]} through ${DOW_LONG[L[L.length - 1]]}`;
    return joinList(L.map(plural));
  }

  function monthPhrase(M) {
    const L = M.months;
    if (L.length === 12) return '';
    const runs = runsOf(L);
    if (runs.length === 1 && L.length >= 3) return `from ${MON_LONG[L[0] - 1]} through ${MON_LONG[L[L.length - 1] - 1]}`;
    return 'in ' + joinList(L.map(m => MON_LONG[m - 1]));
  }

  function yearPhrase(M) {
    if (!M.years) return '';
    const runs = runsOf(M.years);
    return 'in ' + joinList(runs.map(([a, b]) => a === b ? String(a) : `${a}–${b}`));
  }

  /** One-sentence English description. `**or**` marks the OR in an OR-combined schedule. */
  function describe(M) {
    if (M.reboot) return 'Once, when the cron daemon starts (usually at boot).';
    const time = timePhrase(M);
    let day = null;
    switch (M.dayMode) {
      case 'dom': day = 'on ' + domPhrase(M.dom); break;
      case 'dow': day = 'on ' + dowPhrase(M.dow); break;
      case 'or': day = `on ${domPhrase(M.dom)} **or** on ${dowPhrase(M.dow)}`; break;
      case 'and': day = `on ${dowPhrase(M.dow)}, but only when the date is ${domPhrase(M.dom)}`; break;
    }
    const month = monthPhrase(M), year = yearPhrase(M);
    let s = cap(time);
    if (!day && !month && !year) s += /every/.test(time) ? '' : ' every day';
    else {
      if (day) s += ' ' + day;
      if (month) s += (day ? ', ' : ' ') + month;
      if (year) s += ' ' + year;
    }
    return s + '.';
  }

  // ---------------------------------------------------------------- rendering into a dialect

  function compress(vals, min, max, style, allowStar) {
    if (allowStar === undefined) allowStar = true;
    const n = max - min + 1;
    if (vals.length === n && allowStar) return '*';
    const g = apStep(vals);
    if (g > 1) {
      const a = vals[0], b = vals[vals.length - 1];
      if (b + g > max) {
        if (style === 'unix') return a === min && allowStar ? `*/${g}` : `${a}-${b}/${g}`;
        return `${a}/${g}`;
      }
      return `${a}-${b}/${g}`;
    }
    return runsOf(vals).map(([a, b]) => a === b ? String(a) : b === a + 1 ? `${a},${b}` : `${a}-${b}`).join(',');
  }

  function compressDow(list, targetId) {
    if (list.length === 7) return '*';
    const fam = DIALECTS[targetId].family;
    if (fam === 'unix' || fam === 'ncrontab') {
      return runsOf(list).map(([a, b]) => a === b ? String(a) : b === a + 1 ? `${a},${b}` : `${a}-${b}`).join(',');
    }
    // Names avoid the 0/1-based Sunday confusion. Spring, APScheduler and systemd count weeks
    // from Monday, so order Monday-first there (their ranges can't wrap past Sunday).
    const mondayFirst = targetId === 'spring' || fam === 'aps' || fam === 'systemd';
    const order = mondayFirst ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
    const name = d => (fam === 'aps' ? DOW_ABBR[d].toLowerCase() : fam === 'systemd' ? cap(DOW_ABBR[d].toLowerCase()) : DOW_ABBR[d]);
    const dash = fam === 'systemd' ? '..' : '-';
    const idx = list.map(d => order.indexOf(d)).sort((a, b) => a - b);
    return runsOf(idx).map(([a, b]) => {
      const A = name(order[a]), B = name(order[b]);
      return a === b ? A : b === a + 1 ? `${A},${B}` : `${A}${dash}${B}`;
    }).join(',');
  }

  /** systemd calendar component: * , a..b and a/r, zero-padded. noBareStep avoids a/r (which counts down after ~). */
  function sdComp(vals, min, max, width, noBareStep) {
    width = width || 2;
    if (vals.length === max - min + 1) return '*';
    const p = v => String(v).padStart(width, '0');
    const g = apStep(vals);
    if (g > 1) {
      const a = vals[0], b = vals[vals.length - 1];
      return !noBareStep && b + g > max ? `${p(a)}/${g}` : `${p(a)}..${p(b)}/${g}`;
    }
    return runsOf(vals).map(([a, b]) => a === b ? p(a) : b === a + 1 ? `${p(a)},${p(b)}` : `${p(a)}..${p(b)}`).join(',');
  }

  const isoDow = d => (d === 0 ? 7 : d);

  function weekdayTest(list) {
    const iso = list.map(isoDow).sort((a, b) => a - b);
    if (iso.length === 1) return `[ "$(date +%u)" = ${iso[0]} ]`;
    const r = runsOf(iso);
    if (r.length === 1) return `[ "$(date +%u)" -ge ${r[0][0]} -a "$(date +%u)" -le ${r[0][1]} ]`;
    return `date +%u | grep -qx '[${iso.join('')}]'`;
  }

  function yearTest(years) {
    const r = runsOf(years);
    if (years.length === 1) return `[ "$(date +%Y)" = ${years[0]} ]`;
    if (r.length === 1) return `[ "$(date +%Y)" -ge ${r[0][0]} -a "$(date +%Y)" -le ${r[0][1]} ]`;
    return `date +%Y | grep -qxE '${years.join('|')}'`;
  }

  const APS_FIELDS = ['year', 'month', 'day', 'week', 'day_of_week', 'hour', 'minute', 'second'];
  const APS_DEFAULTS = { year: '*', month: '1', day: '1', week: '*', day_of_week: '*', hour: '0', minute: '0', second: '0' };

  /**
   * CronTrigger keyword arguments. APScheduler fills in fields you leave out: those above the last one
   * given become '*', those below it their minimum. So only the fields that differ are written.
   */
  function apsLine(M, v) {
    const val = {
      year: M.years ? compress(M.years, 1970, 9999, 'unix', false) : '*',
      month: compress(M.months, 1, 12, 'unix'), day: v.dom, week: '*', day_of_week: v.dow,
      hour: compress(M.hours, 0, 23, 'unix'), minute: compress(M.minutes, 0, 59, 'unix'), second: compress(M.seconds, 0, 59, 'unix'),
    };
    // Pick the last field to write: everything after it must equal its default, everything before it
    // that isn't '*' is written too. Prefer the fewest fields, then a field that says something.
    let best = null;
    APS_FIELDS.forEach((f, a) => {
      if (f === 'week' || APS_FIELDS.slice(a + 1).some(g => val[g] !== APS_DEFAULTS[g])) return;
      const fields = APS_FIELDS.filter((g, i) => i === a || (i < a && val[g] !== '*'));
      const weak = val[f] === '*' || (f === 'second' && val[f] === '0');
      const score = fields.length * 2 + (weak ? 1 : 0);
      if (!best || score < best.score) best = { score, fields };
    });
    return best.fields.map(f => `${f}=${/^\d+$/.test(val[f]) ? val[f] : `'${val[f]}'`}`).join(', ');
  }

  /** A systemd calendar event: [weekdays] year-month-day hour:minute:second. */
  function sdLine(M, v) {
    const Y = M.years ? sdComp(M.years, 1970, 2199, 4) : '*';
    return `${v.wd ? v.wd + ' ' : ''}${Y}-${sdComp(M.months, 1, 12)}${v.sep}${v.day} ${sdComp(M.hours, 0, 23)}:${sdComp(M.minutes, 0, 59)}:${sdComp(M.seconds, 0, 59)}`;
  }

  const contiguousFromLast = o => o[0] === 0 && runsOf(o).length === 1;

  /** GitLab (fugit): # and #-1 for weekdays, L and -n-L for month ends, & to AND the day fields. Null: use the crontab workarounds. */
  function gitlabDays(M) {
    const dom = M.dom, dow = M.dow, mode = M.dayMode;
    if (mode === 'all') return { variants: [{ dom: '*', dow: '*' }] };
    let a = '*', b = '*';
    if (mode !== 'dow') {
      const s = dom.special;
      if (!s) a = compress(dom.list, 1, 31, 'unix', true);
      else if (s.type === 'L' && s.offset === 0) a = 'L';
      else if (s.type === 'fromEnd' && contiguousFromLast(s.offsets)) a = `-${s.offsets.length}-L`;
      else return null;
    }
    if (mode !== 'dom') {
      const s = dow.special;
      b = !s ? compressDow(dow.list, 'gitlab') : s.type === 'nth' ? `${s.dow}#${s.n}` : `${s.dow}#-1`;
    }
    if (mode === 'and') return { variants: [{ dom: a + '&', dow: b }], note: 'The `&` makes GitLab require both day fields (a fugit extension).' };
    return { variants: [{ dom: a, dow: b }] };
  }

  /** Cloudflare (saffron): Quartz-style L, W, # and nL, but no ? and no way to require both day fields. */
  function cloudflareDays(M, T) {
    const dom = M.dom, dow = M.dow, mode = M.dayMode;
    if (mode === 'all') return { variants: [{ dom: '*', dow: '*' }] };
    if (mode === 'and') return { reason: `${T.name} matches either day field when both are set, so it can't require both.` };
    const s = dom.special;
    if (mode === 'dom' && s && s.type === 'fromEnd' && s.offsets.length <= 3) {
      return {
        variants: s.offsets.map(k => ({ dom: k ? `L-${k}` : 'L', dow: '*' })),
        note: `${T.name} takes one \`L-n\` day per expression, so this needs ${s.offsets.length} cron triggers.`,
      };
    }
    let a = '*', b = '*';
    if (mode !== 'dow') {
      if (!s) a = compress(dom.list, 1, 31, 'unix', true);
      else if (s.type === 'L') a = s.offset ? `L-${s.offset}` : 'L';
      else if (s.type === 'LW') a = 'LW';
      else if (s.type === 'W') a = `${s.day}W`;
      else return { reason: `${T.name} can't express ${domPhrase(dom)} in one expression.` };
    }
    if (mode !== 'dom') {
      const w = dow.special;
      b = !w ? compressDow(dow.list, 'cloudflare') : w.type === 'nth' ? `${DOW_ABBR[w.dow]}#${w.n}` : `${DOW_ABBR[w.dow]}L`;
    }
    return { variants: [{ dom: a, dow: b }] };
  }

  /** Azure (NCrontab): plain fields only, ANDed, so "the nth Monday" is a week of dates plus the weekday. */
  function ncrontabDays(M, T) {
    const dom = M.dom, dow = M.dow, mode = M.dayMode;
    if (mode === 'all') return { variants: [{ dom: '*', dow: '*' }] };
    if (dom.special && mode !== 'dow') {
      return { reason: `NCRONTAB, which ${T.name} uses, can't express ${domPhrase(dom)}. Schedule the days it could fall on and return early in the function on the others.` };
    }
    if (dow.special && dow.special.type === 'lastDow') return { reason: `NCRONTAB, which ${T.name} uses, can't express ${dowPhrase(dow)}.` };
    const days = () => compress(dom.list, 1, 31, 'unix', true);
    const week = () => (dow.special
      ? { dom: `${7 * dow.special.n - 6}-${Math.min(7 * dow.special.n, 31)}`, dow: String(dow.special.dow) }
      : { dom: '*', dow: compressDow(dow.list, 'azure') });
    if (mode === 'dom') return { variants: [{ dom: days(), dow: '*' }] };
    if (mode === 'dow') return { variants: [week()] };
    if (mode === 'and') {
      if (dow.special) return { reason: `${T.name} can't combine these day rules.` };
      return { variants: [{ dom: days(), dow: compressDow(dow.list, 'azure') }] };
    }
    return { variants: [{ dom: days(), dow: '*' }, week()], note: `${T.name} requires both day fields to match, so this takes two timer functions.` };
  }

  /** APScheduler: `day` holds dates, "last", "1st mon" or "last fri"; `day_of_week` holds weekdays; both must match. */
  function apsDays(M, T) {
    const dom = M.dom, dow = M.dow, mode = M.dayMode;
    const ORD = ['1st', '2nd', '3rd', '4th', '5th'];
    const wd = d => DOW_ABBR[d].toLowerCase();
    const day = () => {
      const s = dom.special;
      if (!s) return compress(dom.list, 1, 31, 'unix', true);
      return s.type === 'L' && s.offset === 0 ? 'last' : null;
    };
    const weekly = () => (dow.special
      ? { dom: dow.special.type === 'nth' ? `${ORD[dow.special.n - 1]} ${wd(dow.special.dow)}` : `last ${wd(dow.special.dow)}`, dow: '*' }
      : { dom: '*', dow: compressDow(dow.list, 'apscheduler') });
    if (mode === 'all') return { variants: [{ dom: '*', dow: '*' }] };
    if (mode === 'dow') return { variants: [weekly()] };
    const a = day();
    if (a === null) return { reason: `${T.name} can't express ${domPhrase(dom)}.` };
    if (mode === 'dom') return { variants: [{ dom: a, dow: '*' }] };
    if (mode === 'and') {
      if (dow.special) return { reason: `${T.name} can't combine these day rules.` };
      return { variants: [{ dom: a, dow: compressDow(dow.list, 'apscheduler') }] };
    }
    return {
      variants: [{ dom: a, dow: '*' }, weekly()],
      note: `${T.name} requires \`day\` and \`day_of_week\` to both match, so this takes two triggers; combine them with \`OrTrigger\`.`,
    };
  }

  /** systemd: weekday names, *-*-dd dates, ~dd counted from the month's end; every part must match. */
  function systemdDays(M, T) {
    const dom = M.dom, dow = M.dow, mode = M.dayMode;
    const dates = () => {
      const s = dom.special;
      if (!s) return { sep: '-', day: sdComp(dom.list, 1, 31) };
      if (s.type === 'L' && s.offset <= 27) return { sep: '~', day: pad2(s.offset + 1) };
      if (s.type === 'fromEnd' && s.offsets[s.offsets.length - 1] <= 27 && s.offsets.length < 28) {
        return { sep: '~', day: sdComp(s.offsets.map(o => o + 1), 1, 28, 2, true) };
      }
      return null;
    };
    const name = d => cap(DOW_ABBR[d].toLowerCase());
    const weekly = () => {
      const s = dow.special;
      if (!s) return { wd: compressDow(dow.list, 'systemd'), sep: '-', day: '*' };
      if (s.type === 'lastDow') return { wd: name(s.dow), sep: '~', day: '07/1' };
      return { wd: name(s.dow), sep: '-', day: s.n === 5 ? '29..31' : `${pad2(7 * s.n - 6)}..${pad2(7 * s.n)}` };
    };
    if (mode === 'all') return { variants: [{ wd: '', sep: '-', day: '*' }] };
    if (mode === 'dow') return { variants: [weekly()] };
    const a = dates();
    if (!a) return { reason: `${T.name} can't express ${domPhrase(dom)}.` };
    if (mode === 'dom') return { variants: [Object.assign({ wd: '' }, a)] };
    if (mode === 'and') {
      if (dow.special) return { reason: `${T.name} can't combine these day rules.` };
      return { variants: [Object.assign({ wd: compressDow(dow.list, 'systemd') }, a)] };
    }
    return {
      variants: [Object.assign({ wd: '' }, a), weekly()],
      note: `${T.name} requires every part of a calendar event to match, so this takes two \`OnCalendar=\` lines in the same timer.`,
    };
  }

  /** Day-field rendering per target. Returns { variants:[{dom,dow}…], tests:[], reason, note }. */
  function renderDays(M, targetId) {
    const T = DIALECTS[targetId];
    const fam = T.family;
    const dom = M.dom, dow = M.dow, mode = M.dayMode;
    const style = fam === 'unix' ? 'unix' : 'quartz';
    const plainDom = (allowStar) => compress(dom.list, 1, 31, style, allowStar);

    if (fam === 'systemd') return systemdDays(M, T);
    if (fam === 'aps') return apsDays(M, T);
    if (fam === 'ncrontab') return ncrontabDays(M, T);
    if (fam === 'cf') return cloudflareDays(M, T);
    if (targetId === 'gitlab') {
      const g = gitlabDays(M);
      if (g) return g;
    }

    if (fam === 'unix') {
      const vixie = T.dayRule === 'vixie';
      if (mode === 'all') return { variants: [{ dom: '*', dow: '*' }] };
      if (mode === 'dom') {
        if (!dom.special) return { variants: [{ dom: plainDom(true), dow: '*' }] };
        if (dom.special.type === 'L') {
          const k = dom.special.offset;
          return {
            variants: [{ dom: `${28 - k}-${31 - k}`, dow: '*' }],
            tests: [`[ "$(date -d '+${k + 1} day' +%d)" = 01 ]`],
            reason: `${T.name} has no “last day of the month”.`,
          };
        }
        if (dom.special.type === 'fromEnd' && contiguousFromLast(dom.special.offsets)) {
          const n = dom.special.offsets.length;
          return {
            variants: [{ dom: `${Math.max(1, 29 - n)}-31`, dow: '*' }],
            tests: [`[ "$(date -d '+${n} days' +%d)" -le ${pad2(n)} ]`],
            reason: `${T.name} has no “last ${n} days of the month”.`,
          };
        }
        return { reason: `${T.name} can't express ${domPhrase(dom)}.` };
      }
      if (mode === 'dow') {
        if (!dow.special) return { variants: [{ dom: '*', dow: compressDow(dow.list, targetId) }] };
        if (dow.special.type === 'nth') {
          const n = dow.special.n;
          return {
            variants: [{ dom: `${7 * n - 6}-${Math.min(7 * n, 31)}`, dow: '*' }],
            tests: [weekdayTest([dow.special.dow])],
            reason: `${T.name} can't say “${dowPhrase(dow)}”. Combining day-of-month and day-of-week would OR them.`,
          };
        }
        return {
          variants: [{ dom: '*', dow: String(dow.special.dow) }],
          tests: [`[ "$(date -d '+7 days' +%d)" -le 07 ]`],
          reason: `${T.name} has no “last ${DOW_LONG[dow.special.dow]} of the month”.`,
        };
      }
      if (dom.special || dow.special) return { reason: `${T.name} can't combine these day rules.` };
      if (mode === 'or') return { variants: [{ dom: plainDom(false), dow: compressDow(dow.list, targetId) }] };
      // mode === 'and'
      if (vixie) {
        const g = apStep(dom.list);
        if (g > 1 && dom.list[0] === 1 && dom.list[dom.list.length - 1] + g > 31) {
          return {
            variants: [{ dom: `*/${g}`, dow: compressDow(dow.list, targetId) }],
            note: 'Relies on the Vixie/cronie rule that a day field starting with * makes cron require both day fields.',
          };
        }
      }
      return {
        variants: [{ dom: plainDom(true), dow: '*' }],
        tests: [weekdayTest(dow.list)],
        reason: `${T.name} ORs day-of-month and day-of-week, so it can't require both.`,
      };
    }

    const sp = T.specials;
    const domQ = () => {
      const s = dom.special;
      if (!s) return plainDom(true);
      if (s.type === 'L' && s.offset === 0 && sp.L) return 'L';
      if (s.type === 'L' && s.offset > 0 && sp.Loffset) return `L-${s.offset}`;
      if (s.type === 'LW' && sp.LW) return 'LW';
      if (s.type === 'W' && sp.W) return `${s.day}W`;
      return null;
    };
    const dowQ = () => {
      const s = dow.special;
      const num = d => targetId === 'spring' ? DOW_ABBR[d] : String(d + 1);
      if (!s) return compressDow(dow.list, targetId);
      if (s.type === 'nth' && sp.hash) return `${num(s.dow)}#${s.n}`;
      if (s.type === 'lastDow' && sp.dowLast) return `${num(s.dow)}L`;
      return null;
    };
    const any = fam === 'spring' ? '*' : '?';
    if (mode === 'all') return { variants: [{ dom: '*', dow: any }] };
    if (mode === 'dom' && dom.special && dom.special.type === 'fromEnd' && sp.Loffset && dom.special.offsets.length <= 4) {
      return {
        variants: dom.special.offsets.map(k => ({ dom: k ? `L-${k}` : 'L', dow: any })),
        note: `${T.name} takes one \`L-n\` day per expression, so this needs ${dom.special.offsets.length} schedules.`,
      };
    }
    const d1 = mode === 'dow' ? '' : domQ();
    const d2 = mode === 'dom' ? '' : dowQ();
    if (d1 === null) return { reason: `${T.name} can't express ${domPhrase(dom)}.` };
    if (d2 === null) return { reason: `${T.name} can't express ${dowPhrase(dow)}.` };
    if (mode === 'dom') return { variants: [{ dom: d1, dow: any }] };
    if (mode === 'dow') return { variants: [{ dom: fam === 'spring' ? '*' : '?', dow: d2 }] };
    if (mode === 'and') {
      if (fam === 'spring') return { variants: [{ dom: d1, dow: d2 }] };
      return { reason: `${T.name} can't require both a day-of-month and a day-of-week; one of them must be \`?\`.` };
    }
    return {
      variants: [{ dom: d1, dow: any }, { dom: fam === 'spring' ? '*' : '?', dow: d2 }],
      note: fam === 'spring'
        ? 'Spring requires both day fields to match, so the OR needs two @Scheduled annotations.'
        : `${T.name} can't OR the two day fields, so this needs two schedules.`,
    };
  }

  /**
   * Render model M as target dialect. Returns
   *  { ok:true, lines:[expr…], note }  or
   *  { ok:false, reason, workaround?: { expr, tests:[shell tests] } }
   */
  function render(M, targetId) {
    const T = DIALECTS[targetId];
    const fam = T.family;
    const style = fam === 'quartz' || fam === 'spring' || fam === 'eb' ? 'quartz' : 'unix';
    if (M.reboot) return targetId === 'unix' ? { ok: true, lines: ['@reboot'] } : { ok: false, reason: `${T.name} has no “at startup” schedule.` };
    const tests = [];
    const reasons = [];
    let sec = null;
    if (T.seconds) sec = compress(M.seconds, 0, 59, style);
    else if (!(M.seconds.length === 1 && M.seconds[0] === 0)) {
      if (M.seconds.length === 1 && fam === 'unix') { tests.push(`sleep ${M.seconds[0]}`); reasons.push(`${T.name} works in whole minutes.`); }
      else return { ok: false, reason: `${T.name} can't schedule anything more precise than a minute.` };
    }
    let year = null;
    if (M.years) {
      if (T.year) year = compress(M.years, T.year[0], T.year[1], style);
      else if (fam === 'unix') { tests.push(yearTest(M.years)); reasons.push(`${T.name} has no year field.`); }
      else return { ok: false, reason: `${T.name} has no year field; check the year in your code instead.` };
    } else if (targetId === 'eventbridge') year = '*';
    const minute = compress(M.minutes, 0, 59, style);
    const hour = compress(M.hours, 0, 23, style);
    const month = compress(M.months, 1, 12, style);
    const days = renderDays(M, targetId);
    if (!days.variants) return { ok: false, reason: days.reason };
    if (days.tests) { tests.push(...days.tests); reasons.unshift(days.reason); }
    const lines = days.variants.map(v => {
      if (fam === 'unix' || fam === 'cf') return `${minute} ${hour} ${v.dom} ${month} ${v.dow}`;
      if (fam === 'systemd') return sdLine(M, v);
      if (fam === 'aps') return apsLine(M, v);
      if (fam === 'spring' || fam === 'ncrontab') return `${sec} ${minute} ${hour} ${v.dom} ${month} ${v.dow}`;
      if (fam === 'quartz') return `${sec} ${minute} ${hour} ${v.dom} ${month} ${v.dow}${year ? ' ' + year : ''}`;
      return `cron(${minute} ${hour} ${v.dom} ${month} ${v.dow} ${year})`;
    });
    if (tests.length) {
      const sleeps = tests.filter(t => t.startsWith('sleep'));
      const checks = tests.filter(t => !t.startsWith('sleep'));
      return { ok: false, reason: reasons.join(' '), workaround: { expr: lines[0], tests: checks, sleep: sleeps[0] || null } };
    }
    return { ok: true, lines, note: days.note || null };
  }

  /** Shell guard for a workaround, in crontab-line or job-script form. */
  function workaroundText(w, targetId, command) {
    command = command || 'your-command';
    const parts = w.tests.slice();
    if (targetId === 'unix') {
      const chain = parts.concat(w.sleep ? [w.sleep] : []).concat([command]).join(' && ');
      return `${w.expr}  ${chain.replace(/%/g, '\\%')}`;
    }
    const lines = parts.map(t => `${t} || exit 0`);
    if (w.sleep) lines.push(w.sleep);
    return lines.join('\n');
  }

  /** Shift a model's times by deltaSec (e.g. to UTC). Returns { models:[…] } or { error }. */
  function shiftModel(M, deltaSec) {
    if (deltaSec === 0) return { models: [M] };
    if (deltaSec % 60 !== 0) return { error: 'The offset has seconds, which cron can’t express.' };
    const dmin = deltaSec / 60;
    const groups = new Map();
    for (const h of M.hours) {
      for (const m of M.minutes) {
        let t = h * 60 + m + dmin;
        const ds = Math.floor(t / 1440);
        t -= ds * 1440;
        if (!groups.has(ds)) groups.set(ds, new Map());
        const hm = groups.get(ds);
        const hh = Math.floor(t / 60);
        if (!hm.has(hh)) hm.set(hh, []);
        hm.get(hh).push(t % 60);
      }
    }
    const models = [];
    for (const [ds, hm] of [...groups].sort((a, b) => a[0] - b[0])) {
      let dowList = M.dow.list;
      if (ds !== 0) {
        const plain = M.dayMode === 'all' || (M.dayMode === 'dow' && !M.dow.special);
        if (!plain || M.months.length !== 12 || M.years) {
          return { error: 'Converting to UTC moves some runs to a different date, and these day rules can’t follow them across midnight.' };
        }
        dowList = sortNum(M.dow.list.map(d => (d + ds + 7) % 7));
      }
      const byMinutes = new Map();
      for (const [hh, mins] of [...hm].sort((a, b) => a[0] - b[0])) {
        const key = sortNum(mins).join(',');
        if (!byMinutes.has(key)) byMinutes.set(key, { minutes: sortNum(mins.slice()), hours: [] });
        byMinutes.get(key).hours.push(hh);
      }
      for (const g of byMinutes.values()) {
        models.push(buildModel({
          seconds: M.seconds, minutes: g.minutes, hours: g.hours, months: M.months, years: M.years,
          dom: { list: M.dom.list, special: M.dom.special },
          dow: { list: dowList, special: M.dow.special }, combine: M.combine,
        }));
      }
    }
    if (models.length > 4) return { error: 'Converting to UTC would take more than four expressions.' };
    return { models };
  }

  /** For UTC-only targets: the expressions to use for each UTC offset the zone has in the next year. */
  function utcVariants(M, tz, targetId, fromMs) {
    const periods = offsetPeriods(tz, fromMs, fromMs + 365 * DAY);
    const byOff = new Map();
    for (const p of periods) {
      if (!byOff.has(p.off)) byOff.set(p.off, []);
      byOff.get(p.off).push(p);
    }
    return [...byOff].map(([off, ps]) => {
      const shifted = shiftModel(M, -off / 1000);
      const v = { off, periods: ps };
      if (shifted.error) { v.error = shifted.error; return v; }
      const lines = [];
      for (const sm of shifted.models) {
        const r = render(sm, targetId);
        if (!r.ok) { v.error = r.reason; return v; }
        lines.push(...r.lines);
      }
      v.lines = lines;
      return v;
    });
  }

  // ---------------------------------------------------------------- checks

  function minuteIntervalLines(N) {
    if (N <= 0 || 1440 % N !== 0) return null;
    const byMinute = new Map();
    for (let t = 0; t < 1440; t += N) {
      const h = Math.floor(t / 60), m = t % 60;
      if (!byMinute.has(m)) byMinute.set(m, []);
      byMinute.get(m).push(h);
    }
    return [...byMinute].map(([m, hs]) => `${m} ${compress(hs, 0, 23, 'unix')} * * *`);
  }

  const shellFor = (dialectId, s) => (dialectId === 'unix' ? s.replace(/%/g, '\\%') : s);

  /**
   * Checks for one parsed expression. Each: { id, level: 'error'|'warn'|'info', title, body, fix? }.
   * Bodies use `code` and **bold** only.
   */
  function lint(P, tz, now) {
    const D = DIALECTS[P.dialect];
    const out = [];
    const add = (level, id, title, body, fix) => out.push({ level, id, title, body, fix: fix || null });
    if (!P.ok) return out;
    if (P.reboot) {
      add('info', 'reboot', 'Runs at startup only', '`@reboot` fires once when cron starts, which is usually at boot. There is no schedule to chart.');
      return out;
    }
    const by = P.by;
    const unixish = D.family === 'unix';
    const cmdHint = D.id === 'unix' ? 'in the command' : 'at the start of the job';

    // Never runs
    const up = upcoming(P, tz, now, 1);
    if (!up.runs.length) {
      let why = 'No date matches all of the fields.';
      const maxDom = P.dom.special ? 31 : Math.min(...P.dom.list);
      const longest = Math.max(...P.months.map(m => daysInMonth(2028, m)));
      if (P.dayMode === 'dom' && !P.dom.special && maxDom > longest) {
        why = `${joinList(P.months.map(m => MON_LONG[m - 1]))} never ${P.months.length > 1 ? 'have' : 'has'} a ${ordinal(maxDom)}.`;
      } else if (P.years && Math.max(...P.years) < new Date(now).getUTCFullYear()) {
        why = 'All of its years are in the past.';
      }
      add('error', 'never', 'This never runs', why);
    }

    // OR between day fields
    if (P.dayMode === 'or') {
      let body = `When both day fields are set, ${D.name} runs on days that match **either** one. This runs on ${domPhrase(P.dom)} **and also** on every ${dowPhrase(P.dow, true).replace(/s$/, '')}.`;
      const dl = P.dom.list, wl = P.dow.list;
      const block = dl.length === 7 && dl[0] % 7 === 1 && dl[6] === dl[0] + 6;
      if (block && wl.length === 1 && !P.dom.special && !P.dow.special) {
        const n = (dl[0] - 1) / 7 + 1;
        const fixed = render(buildModel({
          seconds: P.seconds, minutes: P.minutes, hours: P.hours, months: P.months, years: P.years,
          dom: { list: dl }, dow: { list: [0, 1, 2, 3, 4, 5, 6] }, combine: 'and',
        }), P.dialect);
        if (D.specials.hash) {
          body += ` If you meant **the ${NTH[n - 1]} ${DOW_LONG[wl[0]]} of the month**, say so directly.`;
        } else {
          body += ` If you meant **the ${NTH[n - 1]} ${DOW_LONG[wl[0]]} of the month**, cron can't say that in one expression. Keep the dates and check the weekday ${cmdHint}:`;
          if (fixed.ok) body += `\n\`${fixed.lines[0]}\`\n\`${shellFor(P.dialect, weekdayTest(wl))} ${D.id === 'unix' ? '&& your-command' : '|| exit 0'}\``;
        }
        if (D.specials.hash) body += ` Or use \`${wl[0] + (D.dow.min === 1 ? 1 : 0)}#${n}\` in ${D.name}.`;
        if (D.specials.amp) body += ` Adding \`&\` to a day field (\`${dl[0]}-${dl[6]}&\`) also makes GitLab require both.`;
      } else {
        body += ' To require both, keep one day field and test the other inside the job.';
      }
      if (D.dayRule === 'robfig' && (by.dom.vixieStar || by.dow.vixieStar)) {
        body += ' Vixie cron and cronie would treat this differently: a day field starting with `*` makes them require both.';
      }
      add('warn', 'or-trap', 'Day-of-month OR day-of-week', body);
    }
    if (P.combine === 'or' && P.dayMode === 'all' && (!P.dom.all || !P.dow.all) && unixish) {
      const ignored = P.dom.all ? by.dow : by.dom, full = P.dom.all ? by.dom : by.dow;
      add('warn', 'or-ignored', `\`${ignored.raw}\` has no effect`,
        `Neither day field starts with \`*\`, so ${D.name} ORs them, and \`${full.raw}\` already matches every day. To restrict by ${FIELD_LABEL[ignored.kind]}, put \`*\` in the ${FIELD_LABEL[full.kind]} field.`,
        { label: `Use * for ${FIELD_LABEL[full.kind]}`, expr: replaceToken(P.input, P.tokens, full.index, '*') });
    }
    if (P.dayMode === 'and' && D.dayRule === 'vixie') {
      const starred = by.dom.vixieStar ? by.dom : by.dow;
      add('warn', 'vixie-star', 'Both day fields must match here',
        `\`${starred.raw}\` starts with \`*\`, so Vixie cron and cronie require **both** day fields to match: ${describeDaysShort(P)}. Other crons, Kubernetes included, OR them instead. Avoid a \`*/n\` day field when the other day field is set if this has to behave the same everywhere.`);
    }
    if ((D.dayRule === 'and' || P.amp) && P.dayMode === 'and') {
      add('info', 'and-days', `${D.short} requires both day fields`,
        `${D.name} runs only on days that match the day of the month **and** the day of the week: ${describeDaysShort(P)}. The same fields in crontab would mean OR.`);
    }

    // Steps that don't divide their cycle
    for (const f of P.fields) {
      const it = f.items.length === 1 ? f.items[0] : null;
      if (!it || !it.hasStep || it.step < 2) continue;
      const b = bounds(f.kind, D);
      const vals = f.list;
      const last = vals[vals.length - 1];
      if (it.hi !== b.max && !it.star && !it.bareSlash) continue;
      const span = b.max - b.min + 1;
      if (f.kind === 'minute' || f.kind === 'second' || f.kind === 'hour' || f.kind === 'month') {
        if (it.step >= span) {
          let body = `\`${f.raw}\` only matches ${f.kind === 'month' ? MON_LONG[vals[0] - 1] : pad2(vals[0])}: steps restart every ${f.kind === 'month' ? 'year' : f.kind === 'hour' ? 'day' : f.kind === 'minute' ? 'hour' : 'minute'}, so they can't be longer than that.`;
          if (f.kind === 'minute') {
            const lines = minuteIntervalLines(it.step);
            if (lines) body += ` For every ${it.step} minutes, use ${lines.length} lines: ${lines.map(l => '`' + l + '`').join(', ')}.`;
            else body += ` Every ${it.step} minutes doesn't fit evenly into a day, so cron can't do it exactly.`;
          }
          add('warn', 'big-step-' + f.kind, `\`${f.raw}\` doesn't mean every ${it.step} ${f.kind}s`, body);
        } else if (span % it.step !== 0) {
          const unitNames = { second: ['second', 'minute'], minute: ['minute', 'hour'], hour: ['hour', 'day'], month: ['month', 'year'] }[f.kind];
          const wrapGap = span - last + vals[0];
          const show = f.kind === 'month' ? (v => MON_SHORT[v - 1]) : f.kind === 'hour' ? (v => pad2(v) + ':00') : (v => ':' + pad2(v));
          add('warn', 'uneven-' + f.kind, `\`${f.raw}\` is uneven`,
            `${span} isn't divisible by ${it.step}, so the ${unitNames[0]}s restart each ${unitNames[1]}: ${show(vals[0])}, ${show(vals[1])} … ${show(last)}, then ${show(vals[0])} again. That last gap is **${wrapGap} ${unitNames[0]}${wrapGap === 1 ? '' : 's'}**, not ${it.step}.`);
        }
      } else if (f.kind === 'dom' && (P.dayMode === 'dom' || P.dayMode === 'or')) {
        add('warn', 'uneven-dom', `\`${f.raw}\` isn't “every ${it.step} days”`,
          `Day-of-month steps restart on the ${ordinal(vals[0])} each month. After the ${ordinal(last)} the next run is the ${ordinal(vals[0])} of the following month, so the gap changes with the month's length. For a strict every-${it.step}-days rhythm, run daily and check ${cmdHint}: \`${shellFor(P.dialect, `[ $(( $(date +%s) / 86400 % ${it.step} )) -eq 0 ]`)}\`.`);
      }
    }

    // Days that don't exist in every month
    if (P.dayMode === 'dom' && !P.dom.special && P.dom.list.every(d => d >= 29)) {
      const missing = P.months.filter(m => !P.dom.list.some(d => d <= daysInMonth(2027, m)));
      const leapOnly = missing.length === 1 && missing[0] === 2 && P.dom.list.includes(29);
      if (missing.length && missing.length < P.months.length) {
        let body = leapOnly
          ? 'February only has a 29th in leap years, so February runs happen every four years.'
          : `${joinList(missing.map(m => MON_LONG[m - 1]))} ${missing.length > 1 ? 'are' : 'is'} skipped because ${missing.length > 1 ? 'they have' : 'it has'} no ${ordinal(Math.min(...P.dom.list))}.`;
        if (!leapOnly) {
          body += ' For the last day of every month, ' + (D.specials.L ? `use \`L\` in day-of-month.` : `run on the 28th–31st and check ${cmdHint}: \`${shellFor(P.dialect, '[ "$(date -d tomorrow +%d)" = 01 ]')}\`.`);
        }
        add('info', 'short-months', leapOnly ? 'Leap years only in February' : 'Skips shorter months', body);
      }
    }

    // * where a single value was probably meant
    if (by.minute.raw === '*' && P.hours.length <= 3 && P.hours.length < 24) {
      add('warn', 'every-minute', `Runs every minute of ${P.hours.length > 1 ? 'those hours' : 'that hour'}`,
        `\`*\` in the minute field means every minute, so this runs **${60 * P.hours.length * P.seconds.length} times** a day, from ${pad2(P.hours[0])}:00 to ${pad2(P.hours[P.hours.length - 1])}:59. To run once at ${pad2(P.hours[0])}:00, use \`0\` for the minute.`,
        { label: 'Use 0 for the minute', expr: replaceToken(P.input, P.tokens, by.minute.index, '0') });
    }
    if (by.second && by.second.raw === '*' && P.minutes.length < 60) {
      add('warn', 'every-second', 'Runs every second',
        `\`*\` in the seconds field runs this 60 times in each matching minute. To run once per matching minute, use \`0\`.`,
        { label: 'Use 0 for the second', expr: replaceToken(P.input, P.tokens, by.second.index, '0') });
    }

    // Day-of-week numbering
    if (D.dow.min === 1 && /\d/.test(by.dow.raw) && !by.dow.special) {
      if (/^1-5$/.test(by.dow.raw)) {
        add('warn', 'dow-numbering', '`1-5` is Sunday to Thursday here',
          `In ${D.name}, day-of-week 1 is **Sunday** and 7 is Saturday, so \`1-5\` means Sunday through Thursday. For Monday to Friday use \`2-6\` or \`MON-FRI\`.`,
          { label: 'Use MON-FRI', expr: replaceToken(P.input, P.tokens, by.dow.index, 'MON-FRI') });
      } else {
        add('info', 'dow-numbering', 'Day 1 is Sunday here',
          `${D.name} numbers days 1 = Sunday … 7 = Saturday, unlike crontab's 0 = Sunday. Names like \`MON\` avoid the mix-up.`);
      }
    }
    if (by.dow.bareL) add('info', 'bare-l', '`L` alone means Saturday', 'On its own in day-of-week, `L` means the last day of the week, which is Saturday. For the last Friday of the month, write `6L`.');
    if (D.id === 'unix' && by.dow.items.some(i => !i.star && (i.lo === 7 || i.hi === 7))) {
      add('info', 'dow-7', '7 is Sunday', 'crontab accepts both 0 and 7 for Sunday.');
    }
    if ((D.id === 'github' || D.id === 'gitlab') && by.dow.items.some(i => !i.star && (i.lo === 7 || i.hi === 7))) {
      add('warn', 'gh-dow-7', 'Use 0 for Sunday', `${D.short}'s documentation lists 0–6 for day-of-week. Write Sunday as \`0\` to be safe.`);
    }
    if (D.dow.monday0 && by.dow.items.some(i => !i.names && !i.star)) {
      if (P.fromCrontab) {
        let fix = null;
        try {
          const meant = parseField(by.dow.raw, 'dow', DIALECTS.unix, by.dow.index);
          const names = compressDow(meant.list, 'apscheduler');
          if (P.tokens[by.dow.index] && P.tokens[by.dow.index].start >= 0) fix = { label: `Use ${names}`, expr: replaceToken(P.input, P.tokens, by.dow.index, names) };
        } catch (e) { fix = null; }
        add('warn', 'aps-crontab-dow', `\`${by.dow.raw}\` is ${dowPhrase(P.dow)} here`,
          `APScheduler 3 numbers days from **Monday = 0** even in \`from_crontab()\`, unlike crontab's Sunday = 0, so the days are shifted by one. Use day names to be safe.`, fix);
      } else {
        add('info', 'aps-dow', 'Day 0 is Monday here', 'APScheduler numbers `day_of_week` 0 = Monday … 6 = Sunday, unlike crontab. Names like `mon-fri` avoid the mix-up.');
      }
    }
    if (by.dow.swapped || by.month.swapped) {
      const f = by.dow.swapped ? by.dow : by.month, it = f.swapped;
      add('warn', 'az-swap', `\`${it.raw}\` runs the other way`,
        `NCRONTAB swaps a backwards range instead of wrapping it, so \`${it.raw}\` means ${f.kind === 'dow' ? `${DOW_LONG[it.lo % 7]} to ${DOW_LONG[it.hi % 7]}` : `${MON_LONG[it.lo - 1]} to ${MON_LONG[it.hi - 1]}`}. To wrap around, list both parts, e.g. \`${it.hi}-${bounds(f.kind, D).max},${bounds(f.kind, D).min}-${it.lo}\`.`);
    }
    for (const f of [by.dow, by.month]) {
      if (f && f.shortName) add('info', 'az-name', `\`${f.shortName}\` is read as a name prefix`, `NCRONTAB accepts any leading part of a name and takes the first match, so \`${f.shortName}\` means ${f.kind === 'dow' ? DOW_LONG[f.list[0]] : MON_LONG[f.list[0] - 1]}. Three letters are clearer.`);
    }

    // A/step without a range in crontab
    if (D.id === 'unix') {
      for (const f of P.fields) {
        const it = f.items.find(i => i.bareSlash);
        if (!it) continue;
        const b = bounds(f.kind, D);
        const better = `${it.lo}-${b.max}/${it.step}`;
        add('info', 'bare-slash', `\`${it.raw}\` isn't portable`,
          `\`N/step\` isn't in the crontab(5) format and some crons reject it. \`${better}\` means the same and works everywhere.`,
          { label: `Use ${better}`, expr: replaceToken(P.input, P.tokens, f.index, f.raw.replace(new RegExp(it.raw.replace(/[/*]/g, '\\$&'), 'i'), better)) });
      }
    }

    // DST
    if (tz) {
      const impacts = dstImpact(P, tz, now, now + 365 * DAY).filter(x => x.affected);
      if (impacts.length) {
        const fmtDate = x => `${x.date.d} ${MON_SHORT[x.date.m - 1]}`;
        const sentences = impacts.map(x => {
          const from = fmtClock(Math.round((x.ws % DAY) / 1000)), to = fmtClock(Math.round((x.we % DAY) / 1000) % 86400);
          return x.gap
            ? `On **${fmtDate(x)}** clocks jump from ${from} to ${to}, so ${x.affected === 1 ? 'the run' : `${x.affected} runs`} in between ${x.affected === 1 ? "doesn't" : "don't"} exist.`
            : `On **${fmtDate(x)}** clocks fall back from ${to} to ${from}, so ${x.affected === 1 ? 'the run' : `${x.affected} runs`} in that hour happen${x.affected === 1 ? 's' : ''} twice by the clock.`;
        });
        let body = `${tz} changes its clocks. ${sentences.join(' ')}`;
        const pol = dstPolicy(P);
        if (D.id === 'unix') {
          body += pol.wild
            ? ' Because the minute or hour field starts with `*`, cron (Debian, Ubuntu, cronie) treats this as a wildcard job and just follows the clock: runs in a skipped hour are lost and runs in a repeated hour happen twice.'
            : ' For a job at fixed times like this one, cron (Debian, Ubuntu, cronie) runs a skipped time soon after the jump and doesn’t repeat a run in the repeated hour.';
        } else if (D.id === 'github') {
          body += ' GitHub moves a run in the skipped hour to the next valid time, so 02:30 becomes 03:00. Its docs don’t say what happens in a repeated hour.';
        } else if (D.id === 'eventbridge') {
          body += ' EventBridge Scheduler skips a time that doesn’t exist and runs a repeated time only once.';
        } else if (D.id === 'quartz') {
          body += ' According to the Quartz FAQ, a time that doesn’t exist is skipped and a time that happens twice fires once.';
        } else if (D.id === 'apscheduler') {
          body += ' APScheduler’s documentation says a time that doesn’t exist doesn’t run and a time that happens twice runs twice.';
        } else if (D.id === 'systemd') {
          body += " systemd's documentation doesn't say how it handles skipped or repeated times; `systemd-analyze calendar --iterations=5` shows what your version does.";
        } else {
          body += ` ${D.name}'s documentation doesn't say how it handles skipped or repeated times.`;
        }
        body += ' To avoid the question entirely, use UTC or a time outside the changeover.';
        add('warn', 'dst', 'Daylight saving time changes affect this', body);
      }
    }

    // Platform specifics
    if (D.id === 'github') {
      const st = stats(P, 'UTC', now);
      if (st && st.minGap !== null && st.minGap < 300) {
        add('warn', 'gh-5min', 'Too frequent for GitHub',
          `Runs can be ${fmtDuration(st.minGap)} apart, but GitHub Actions runs scheduled workflows at most every 5 minutes.`);
      }
      if (P.minutes.includes(0)) {
        add('info', 'gh-top-of-hour', 'Top of the hour is GitHub’s busiest time',
          'GitHub warns that load peaks at the start of every hour and queued scheduled runs can be delayed or dropped. An off-peak minute such as `17` is more reliable.',
          P.minutes.length === 1 ? { label: 'Use minute 17', expr: replaceToken(P.input, P.tokens, by.minute.index, '17') } : null);
      }
      if (tz && tz !== 'UTC' && tz !== 'Etc/UTC' && !P.tz) {
        add('warn', 'gh-timezone', 'Add `timezone:` to the workflow',
          `Without it, GitHub reads these times as UTC. Put \`timezone: "${tz}"\` under the \`cron:\` line; Translations shows the YAML. GitHub Enterprise Server supports it from version 3.22.`);
      }
      add('info', 'gh-notes', 'How GitHub runs schedules',
        'Scheduled workflows run on the latest commit of the default branch, only if the workflow file is on that branch. In public repositories GitHub disables them after 60 days without repository activity.');
    }
    if (D.id === 'k8s') {
      if (P.tzPrefix) {
        add('warn', 'k8s-crontz', 'Use spec.timeZone instead',
          `Kubernetes doesn't support \`${P.tzPrefix.split('=')[0]}=\` inside \`schedule\`, and recent versions reject it. Set \`spec.timeZone: "${P.tz}"\` instead.`);
      } else if (!P.tz) {
        add('info', 'k8s-tz', 'Set spec.timeZone',
          "Without `spec.timeZone`, Kubernetes evaluates the schedule in the kube-controller-manager's time zone. Set it explicitly so the schedule doesn't depend on the cluster.");
      }
    }
    if (D.id === 'unix') {
      if (P.tzPrefix && P.tzPrefix.startsWith('CRON_TZ')) {
        add('info', 'unix-crontz', 'CRON_TZ is a cronie feature',
          '`CRON_TZ=` is honoured by cronie (Fedora, RHEL, Arch) and normally goes on its own line above the job. Debian and Ubuntu cron use the system time zone instead.');
      }
      if (P.command && /(^|[^\\])%/.test(P.command)) {
        add('warn', 'percent', '`%` in the command means newline',
          'In a crontab line, an unescaped `%` ends the command and sends the rest to its standard input. Write `\\%`, for example `date +\\%F`.');
      } else if (P.command) {
        add('info', 'command', 'Command ignored', `Only the schedule was read; the command \`${P.command.length > 40 ? P.command.slice(0, 40) + '…' : P.command}\` was ignored.`);
      }
    }
    if (D.id === 'eventbridge') {
      add('info', 'eb-utc', 'Rules run in UTC',
        'EventBridge rules always use UTC. EventBridge Scheduler can use a time zone (`--schedule-expression-timezone`); the time zone picked here assumes Scheduler.');
    }
    if (D.id === 'gitlab') {
      const st = stats(P, 'UTC', now);
      if (st && st.minGap !== null && st.minGap < 600) {
        add('warn', 'gl-frequent', 'More often than GitLab checks',
          `Runs can be ${fmtDuration(st.minGap)} apart, but GitLab starts scheduled pipelines only when its pipeline schedule worker runs, every 10 minutes by default on self-managed GitLab. Runs due in between collapse into one.`);
      }
      add('info', 'gl-worker', 'GitLab starts schedules a little late',
        "Scheduled pipelines are queued the next time GitLab's pipeline schedule worker runs (`3-59/10 * * * *` by default on self-managed GitLab), so a pipeline usually starts a few minutes after its time, and later when many schedules are due at once.");
      if (tz && tz !== 'UTC' && tz !== 'Etc/UTC' && !P.tz) {
        add('info', 'gl-timezone', `Set the schedule's Cron timezone to ${tz}`,
          'Each GitLab pipeline schedule has its own **Cron timezone** setting (`cron_timezone` in the API). Make sure it matches, or the times shift.');
      }
    }
    if (D.id === 'cloudflare') {
      add('info', 'cf-utc', 'Cron Triggers run in UTC',
        'Cloudflare runs Cron Triggers on UTC time, so these times are UTC whatever your zone. Changes to triggers can take up to 15 minutes to reach Cloudflare’s network.');
      if (P.combine === 'or' && P.dayMode === 'or') {
        add('info', 'cf-or-source', 'Both day fields: from the parser, not the docs',
          "Cloudflare's documentation doesn't say how the two day fields combine; its open-source cron parser (saffron) runs on days that match either one.");
      }
    }
    if (D.id === 'azure') {
      if (!P.tz) {
        const body = 'Azure Functions reads the schedule in UTC unless the app setting `WEBSITE_TIME_ZONE` is set (a tz database name on Linux, a Windows zone name on Windows). It isn’t supported on Linux Consumption or Flex Consumption plans.';
        if (tz && tz !== 'UTC' && tz !== 'Etc/UTC') add('warn', 'az-timezone', `Set WEBSITE_TIME_ZONE for ${tz}`, body);
        else add('info', 'az-timezone', 'Times are UTC by default', body);
      }
      add('info', 'az-single', 'One run at a time',
        'When the app scales out, Azure still runs one instance of a timer function, and it doesn’t start a run while the previous one is still going. A run that starts late gets `isPastDue` set.');
    }
    if (D.id === 'apscheduler') {
      const given = new Set((P.chips || []).filter(c => !c.implied).map(c => c.kind));
      for (const [kind, below, above] of [['hour', ['minute', 'second'], ['year', 'month', 'dom', 'dow']], ['minute', ['second'], ['year', 'month', 'dom', 'dow', 'hour']]]) {
        if (!given.has(kind) && by[kind].raw === '*' && below.some(k => given.has(k)) && above.some(k => given.has(k))) {
          add('warn', 'aps-gap', `\`${kind}\` isn't set, so it means every ${kind}`,
            `APScheduler fills a field you leave out with \`*\` when a later field is set, so this runs every ${kind} on the days it matches. Add \`${kind}=…\` if you meant one time.`);
        }
      }
      if (!P.tz) add('info', 'aps-timezone', 'Uses the scheduler’s time zone', 'Without `timezone=`, the trigger uses the scheduler’s time zone, which is the machine’s local zone unless the scheduler sets one.');
      const o = P.apsOptions || {};
      add('info', 'aps-misfire', o.misfire_grace_time ? `Late runs: up to ${o.misfire_grace_time} s` : 'A run more than 1 second late is skipped',
        `${o.misfire_grace_time ? `With \`misfire_grace_time=${o.misfire_grace_time}\`, a run that can't start within ${o.misfire_grace_time} seconds is skipped.` : 'APScheduler’s default `misfire_grace_time` is 1 second, so a busy or sleeping process silently misses runs. Set it on the job or in `job_defaults`.'} By default missed runs are coalesced into one and only one instance runs at a time (\`max_instances=1\`).`);
    }
    if (D.id === 'systemd') {
      if (!P.tz) add('info', 'sd-timezone', 'Uses the system time zone', "Without a time zone at the end (for example `UTC` or `Europe/Berlin`), systemd uses the machine's local time zone.");
      add('info', 'sd-timer', 'Two timer settings to know',
        '`AccuracySec=` defaults to 1 minute, so the timer can fire up to a minute late; set `AccuracySec=1s` if that matters. `Persistent=` defaults to false, so runs missed while the machine was off are skipped; set `Persistent=true` to run them at boot.');
    }
    return out;
  }

  function describeDaysShort(P) {
    return `${dowPhrase(P.dow)} that are also ${domPhrase(P.dom)}`;
  }

  // ---------------------------------------------------------------- English → cron

  const NUM_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, 'forty-five': 45, ninety: 90,
  };
  const DAY_WORD = '(sun(?:days?)?|mon(?:days?)?|tue(?:s(?:days?)?)?|wed(?:nesdays?)?|thu(?:r(?:s(?:days?)?)?)?|fri(?:days?)?|sat(?:urdays?)?)';
  const MONTH_WORD = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const TIME_WORD = '(?:(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?|noon|midnight)';
  const dayIdx = w => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(w.slice(0, 3));
  const monIdx = w => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(w.slice(0, 3)) + 1;

  function parseTimeWord(s) {
    s = s.trim();
    if (s === 'noon') return { h: 12, m: 0 };
    if (s === 'midnight') return { h: 0, m: 0 };
    const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) return null;
    let h = +m[1];
    const mi = m[2] ? +m[2] : 0;
    if (m[3]) {
      if (h < 1 || h > 12) return null;
      if (m[3] === 'am') h = h === 12 ? 0 : h;
      else h = h === 12 ? 12 : h + 12;
    }
    if (h > 23 || mi > 59) return null;
    return { h, m: mi, ambiguous: !m[3] && !m[2] && h >= 1 && h <= 11 };
  }

  const ORD_WORD = '(?:first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)';
  const ORD_N = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5, last: 0 };
  const STEP_WORD = { other: 2, second: 2, third: 3, fourth: 4, sixth: 6 };
  const AND_MARK = '\u0001'; // stands in for "and" inside a phrase that mustn't be split
  const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const ALL_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
  const ALL_DOWS = [0, 1, 2, 3, 4, 5, 6];

  /** Months for "every n months", starting in a given month (1 = January). */
  function monthStep(n, start, notes) {
    start = start || 1;
    if (n <= 1) return null;
    let out;
    if (12 % n === 0) out = sortNum(Array.from({ length: 12 / n }, (_, k) => ((start - 1 + k * n) % 12) + 1));
    else {
      out = [];
      for (let m = start; m <= 12; m += n) out.push(m);
      notes.push(`12 isn't divisible by ${n}, so the months restart each January.`);
    }
    return out;
  }

  function normalizeEnglish(input) {
    let s = ' ' + String(input || '').toLowerCase()
      .replace(/a\.m\.?/g, 'am').replace(/p\.m\.?/g, 'pm')
      .replace(/(\d{1,2})\.(\d{2})/g, '$1:$2')
      .replace(/[!?]+/g, ' ').replace(/\.(\s|$)/g, ' ')
      .replace(/\b(each|every single)\b/g, 'every')
      .replace(/\b(thru|until|till)\b/g, 'through')
      .replace(/o'?clock/g, '')
      .replace(/&/g, ' and ')
      .replace(/\s+/g, ' ') + ' ';
    for (const [k, v] of Object.entries(NUM_WORDS)) s = s.replace(new RegExp(`\\bevery ${k}\\b`, 'g'), `every ${v}`);
    return s;
  }

  /** Split a sentence into clauses at commas, semicolons and "and"/"also"/"plus". */
  function splitClauses(s) {
    // Keep "and" that belongs to one phrase: time windows and lists of ordinals ("first and third monday").
    s = s.replace(/\bbetween\s+(\S+(?:\s+(?:am|pm))?)\s+and\s+/g, (m, a) => `between ${a} ${AND_MARK} `);
    s = s.replace(new RegExp(`\\b${ORD_WORD}(?:\\s*(?:,|and|or)\\s*${ORD_WORD})+(?=\\s+(?:day|weekday|business day|working day|${DAY_WORD}))`, 'g'),
      m => m.replace(/\s*(?:,|and|or)\s*/g, ` ${AND_MARK} `));
    return s.split(/\s*[,;]\s*|\s+(?=(?:and|also|plus)\s)/).map(c => c.trim()).filter(Boolean);
  }

  /** Read one clause into a day rule (which days) and a time spec (which times of day). */
  function parseClause(text, notes) {
    let s = ' ' + text.split(AND_MARK).join('and') + ' ';
    const rule = { dows: new Set(), doms: new Set(), months: new Set(), years: new Set(), entries: [], flags: {} };
    const time = { times: [], window: null, interval: null, minutePast: null, twice: false };
    let unsupported = null;
    const take = (re, fn) => { s = s.replace(re, (...a) => { const r = fn(...a); return r === false ? a[0] : ' '; }); };

    // nth / last day or weekday of the month, with its own month qualifier ("of every other month")
    const nthRe = new RegExp(
      `\\b(?<ords>${ORD_WORD}(?:\\s*(?:,|and|or)\\s*${ORD_WORD})*)\\s+(?<what>day|weekday|business day|working day|${DAY_WORD})` +
      `(?:\\s+(?:of|in)\\s+(?:the\\s+|every\\s+)?(?:(?<step>other|second|third|fourth|sixth|\\d+)(?:st|nd|rd|th)?\\s+)?(?<unit>months?|quarters?))?` +
      `(?:\\s+(?:starting|from|beginning)(?:\\s+in)?\\s+(?<start>${MONTH_WORD}))?`, 'g');
    take(nthRe, (...a) => {
      const g = a[a.length - 1];
      let n = 1;
      const quarter = !!(g.unit && g.unit.startsWith('quarter'));
      if (g.step) n = STEP_WORD[g.step] || parseInt(g.step, 10) || 1;
      if (quarter) n *= 3;
      const firstMonths = g.unit ? monthStep(n, g.start ? monIdx(g.start) : 1, notes) : null;
      if (n === 2 && !g.start) notes.push('“Every other month” is read as January, March, May… Add “starting in February” for the even months.');
      if (n === 3 && !quarter && !g.start) notes.push('Every three months is read as January, April, July and October.');
      for (const o of g.ords.split(/\s*(?:,|and|or)\s*/)) {
        const k = ORD_N[o];
        const what = g.what;
        // "last … of the quarter" falls in the quarter's final month (March, June, September, December).
        const months = quarter && k === 0 && firstMonths ? sortNum(firstMonths.map(m => ((m - 1 + 2) % 12) + 1)) : firstMonths;
        if (what === 'day') rule.entries.push(k === 0 ? { domSpecial: { type: 'L', offset: 0 }, months } : { domList: [k], months });
        else if (/weekday|business|working/.test(what)) {
          if (k === 0) rule.entries.push({ domSpecial: { type: 'LW' }, months });
          else if (k === 1) rule.entries.push({ domSpecial: { type: 'W', day: 1 }, months });
          else unsupported = `The ${o} weekday of the month has no cron equivalent; only the first and last weekday do.`;
        } else {
          const d = dayIdx(what);
          rule.entries.push({ dowSpecial: k === 0 ? { type: 'lastDow', dow: d } : { type: 'nth', dow: d, n: k }, months });
        }
      }
    });

    take(/\b(quarter|half) past (\d{1,2})\s*(am|pm)?\b/g, (_, q, h, ap) => {
      const t = parseTimeWord(h + (ap ? ' ' + ap : ''));
      if (!t) return false;
      time.times.push({ h: t.h, m: q === 'half' ? 30 : 15 });
    });
    take(/\btwice (?:a|per) day\b|\btwice daily\b/g, () => { time.twice = true; });
    take(/\b(?:during |in )?(?:business|working|office) hours\b/g, () => { time.window = { h1: 9, m1: 0, h2: 17, m2: 0 }; });
    take(/\bquarterly\b|\bevery quarter\b/g, () => { rule.flags.quarterly = true; });
    take(/\b(yearly|annually|every year|once a year)\b/g, () => { rule.flags.yearly = true; });
    take(/\b(monthly|every month|once a month)\b/g, () => { rule.flags.monthly = true; });
    take(/\b(weekly|every week|once a week)\b/g, () => { rule.flags.weekly = true; });
    take(/\b(daily|nightly|every day|once a day)\b/g, () => { rule.flags.daily = true; });
    take(/\bhourly\b/g, () => { time.interval = { n: 1, unit: 'hour' }; });
    take(/\b(?:in\s+|on\s+)?(?:the\s+)?(odd|even)(?:-numbered)? months\b/g, (_, w) => {
      for (let m = w === 'odd' ? 1 : 2; m <= 12; m += 2) rule.months.add(m);
    });

    // Intervals
    take(new RegExp(`\\bevery (other |\\d+ |\\d+(?:st|nd|rd|th) )?(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\\b(?:\\s+(?:starting|from|beginning)(?:\\s+in)?\\s+${MONTH_WORD})?`, 'g'), (_, n, unit, startMo) => {
      let k = 1;
      if (n) { n = n.trim(); k = n === 'other' ? 2 : parseInt(n, 10); }
      const u = unit.startsWith('sec') ? 'second' : unit.startsWith('min') ? 'minute' : unit.startsWith('h') ? 'hour'
        : unit.startsWith('d') ? 'day' : unit.startsWith('w') ? 'week' : unit.startsWith('mo') ? 'month' : 'year';
      if (u === 'day') { if (k === 1) rule.flags.daily = true; else rule.dayStep = k; return; }
      if (u === 'week') { if (k === 1) rule.flags.weekly = true; else rule.weekStep = k; return; }
      if (u === 'month') {
        if (k === 1) { rule.flags.monthly = true; return; }
        rule.monthStep = { n: k, start: startMo ? monIdx(startMo) : 1 };
        if (k === 2 && !startMo) notes.push('“Every other month” is read as January, March, May… Add “starting in February” for the even months.');
        return;
      }
      if (u === 'year') { if (k === 1) rule.flags.yearly = true; else rule.yearStep = k; return; }
      time.interval = { n: k, unit: u };
    });

    // Time windows
    const winRe = new RegExp(`\\b(?:between|from)\\s+${TIME_WORD}\\s+(?:and|to|through|-)\\s+${TIME_WORD}(?=\\s)`, 'g');
    take(winRe, (all) => {
      const m = all.match(new RegExp(`(?:between|from)\\s+(${TIME_WORD})\\s+(?:and|to|through|-)\\s+(${TIME_WORD})`));
      const a = parseTimeWord(m[1]), b = parseTimeWord(m[5]);
      if (!a || !b) return false;
      time.window = { h1: a.h, m1: a.m, h2: b.h, m2: b.m };
    });
    take(new RegExp(`\\b(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)\\s*-\\s*(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm))(?=\\s)`, 'g'), (_, a, b) => {
      const ta = parseTimeWord(a), tb = parseTimeWord(b);
      if (!ta || !tb) return false;
      time.window = { h1: ta.h, m1: ta.m, h2: tb.h, m2: tb.m };
    });

    // Day-of-week ranges and names
    take(new RegExp(`\\b(?:from\\s+)?${DAY_WORD}\\s*(?:-|to|through)\\s*${DAY_WORD}\\b`, 'g'), (_, a, b) => {
      let x = dayIdx(a);
      const y = dayIdx(b);
      for (let i = 0; i < 7; i++) { rule.dows.add(x); if (x === y) break; x = (x + 1) % 7; }
    });
    take(/\b(?:every )?(?:weekdays?|business days?|work ?days?|working days?)\b/g, () => { [1, 2, 3, 4, 5].forEach(d => rule.dows.add(d)); });
    take(/\b(?:every |on )?weekends?\b/g, () => { rule.dows.add(0); rule.dows.add(6); });
    take(new RegExp(`\\b${DAY_WORD}\\b`, 'g'), (_, w) => { rule.dows.add(dayIdx(w)); });

    // Specific dates: "march 3", "3 march", "3rd of march"
    take(new RegExp(`\\b${MONTH_WORD}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'g'), (_, mo, d) => { rule.months.add(monIdx(mo)); rule.doms.add(+d); });
    take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_WORD}\\b`, 'g'), (_, d, mo) => { rule.months.add(monIdx(mo)); rule.doms.add(+d); });
    take(new RegExp(`\\b${MONTH_WORD}\\s*(?:-|to|through)\\s*${MONTH_WORD}\\b`, 'g'), (_, a, b) => {
      let x = monIdx(a);
      const y = monIdx(b);
      for (let i = 0; i < 12; i++) { rule.months.add(x); if (x === y) break; x = x % 12 + 1; }
    });
    take(new RegExp(`\\b${MONTH_WORD}\\b`, 'g'), (_, mo, off, str) => {
      if (mo === 'may' && /\bmay\s+(?!\d)/.test(str.slice(off)) && !/\bin\s+$/.test(str.slice(0, off))) return false;
      rule.months.add(monIdx(mo));
    });

    // Days of month
    take(/\bbetween\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+and\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/g, (_, a, b) => { for (let d = +a; d <= +b; d++) rule.doms.add(d); });
    take(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:-|to|through)\s*(\d{1,2})(?:st|nd|rd|th)\b/g, (_, a, b) => { for (let d = +a; d <= +b; d++) rule.doms.add(d); });
    take(/\bdays?\s+(\d{1,2})\s*(?:-|to|through)\s*(\d{1,2})\b/g, (_, a, b) => { for (let d = +a; d <= +b; d++) rule.doms.add(d); });
    take(/\b(\d{1,2})(?:st|nd|rd|th)\b/g, (_, d) => { rule.doms.add(+d); });
    take(/\bday\s+(\d{1,2})\b/g, (_, d) => { rule.doms.add(+d); });

    // Years
    take(/\b(19[7-9]\d|2[01]\d\d)\b/g, (_, y) => { rule.years.add(+y); });

    // Minutes past the hour
    take(/\bat\s+:(\d{2})\b/g, (_, m) => { time.minutePast = +m; });
    take(/\b(?:at\s+)?(\d{1,2})\s+(?:minutes?\s+)?past(?:\s+the hour|\s+every hour)?\b/g, (_, m) => { time.minutePast = +m; });
    take(/\bat\s+minute\s+(\d{1,2})\b/g, (_, m) => { time.minutePast = +m; });
    take(/\bon the hour\b/g, () => { time.minutePast = 0; });
    take(/\b(?:at\s+)?(?:a\s+)?quarter past\b/g, () => { time.minutePast = 15; });
    take(/\b(?:at\s+)?half past\b/g, () => { time.minutePast = 30; });

    // Times of day
    take(/\b(?:at\s+)?(noon|midday|midnight)\b/g, (_, w) => { time.times.push(w === 'midnight' ? { h: 0, m: 0 } : { h: 12, m: 0 }); });
    take(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/g, (all, h, m, ap) => {
      const t = parseTimeWord(`${h}${m ? ':' + m : ''} ${ap}`);
      if (!t) return false;
      time.times.push(t);
    });
    take(/\b(?:at\s+)?(\d{1,2}):(\d{2})\b/g, (all, h, m) => {
      const t = parseTimeWord(`${h}:${m}`);
      if (!t) return false;
      time.times.push(t);
    });
    take(/\b(?:at|and)\s+(\d{1,2})(?=\s)(?!\s*(?:minutes?|mins?|hours?|seconds?|days?))/g, (all, h) => {
      const t = parseTimeWord(h);
      if (!t) return false;
      if (t.ambiguous) notes.push(`Read “${h}” as ${pad2(t.h)}:00 (24-hour clock). Write ${h}pm for ${pad2(t.h + 12)}:00.`);
      time.times.push(t);
    });

    const leftover = s.replace(/\b(at|on|in|of|the|and|also|plus|every|run|runs|running|it|job|please|schedule|cron|from|to|a|an|starting|start|day|days|month|months|week|time|times|each|during|but|only|between|past|minute|hour|o)\b/g, ' ').replace(/[^a-z0-9:]+/g, ' ').trim();
    if (leftover) notes.push(`Ignored: “${leftover}”.`);

    const f = rule.flags;
    const hasRule = rule.dows.size || rule.doms.size || rule.months.size || rule.years.size || rule.entries.length ||
      f.daily || f.weekly || f.monthly || f.yearly || f.quarterly || rule.dayStep || rule.weekStep || rule.monthStep || rule.yearStep;
    const hasTime = time.times.length || time.window || time.interval || time.minutePast != null || time.twice;
    return { rule: hasRule ? rule : null, time: hasTime ? time : null, unsupported };
  }

  /** Times of day for one group of clauses: [{ seconds, minutes, hours }…] or { error }. */
  function resolveTimes(specs, notes) {
    const T = { times: [], window: null, interval: null, minutePast: null, twice: false };
    for (const t of specs) {
      T.times.push(...t.times);
      if (t.window) T.window = t.window;
      if (t.interval) T.interval = t.interval;
      if (t.minutePast != null) T.minutePast = t.minutePast;
      if (t.twice) T.twice = true;
    }
    const allH = Array.from({ length: 24 }, (_, i) => i);
    const allM = Array.from({ length: 60 }, (_, i) => i);
    const W = T.window;
    if (W && W.h2 < W.h1) return { error: 'The time window ends before it starts. Cron hour ranges can’t wrap past midnight in one go.' };
    const windowHours = (inclusiveEnd) => {
      if (!W) return allH;
      const end = (inclusiveEnd || W.m2 > 0) ? W.h2 : W.h2 - 1;
      const out = [];
      for (let h = W.h1; h <= end; h++) out.push(h);
      return out.length ? out : allH;
    };
    if (T.twice && !T.times.length) T.times.push({ h: 0, m: 0 }, { h: 12, m: 0 });
    const iv = T.interval;
    if (iv) {
      const n = iv.n;
      if (iv.unit === 'second') {
        if (n >= 60) return { error: 'For intervals of a minute or more, say “every N minutes”.' };
        if (60 % n) notes.push(`60 isn't divisible by ${n}, so the seconds restart every minute.`);
        return [{ seconds: Array.from({ length: Math.ceil(60 / n) }, (_, i) => i * n).filter(v => v < 60), minutes: allM, hours: windowHours(false) }];
      }
      if (iv.unit === 'minute') {
        if (n >= 60) {
          if (n % 60 === 0 && n / 60 < 24) {
            const hs = windowHours(true);
            return [{ seconds: [0], minutes: [T.minutePast || 0], hours: hs.filter(h => (h - hs[0]) % (n / 60) === 0) }];
          }
          if (1440 % n) return { error: `Every ${n} minutes doesn't divide a day evenly, so cron can't do it.` };
          const byMinute = new Map();
          for (let t = 0; t < 1440; t += n) {
            const m = t % 60;
            if (!byMinute.has(m)) byMinute.set(m, []);
            byMinute.get(m).push(Math.floor(t / 60));
          }
          notes.push(`Every ${n} minutes takes ${byMinute.size} cron schedules, one per minute of the hour.`);
          return [...byMinute].map(([m, hs]) => ({ seconds: [0], minutes: [m], hours: hs }));
        }
        const start = W ? W.m1 % n : 0;
        const minutes = [];
        for (let m = start; m < 60; m += n) minutes.push(m);
        if (60 % n) notes.push(`60 isn't divisible by ${n}: runs restart at :${pad2(start)} each hour.`);
        const hours = windowHours(false);
        if (W && W.m2 === 0) notes.push(`Last run of the window is ${pad2(hours[hours.length - 1])}:${pad2(minutes[minutes.length - 1])}, the final slot before ${pad2(W.h2)}:00.`);
        return [{ seconds: [0], minutes, hours }];
      }
      if (iv.unit === 'hour') {
        if (n >= 24) return { error: 'For a day or longer, say “every day” or “every N days”.' };
        const base = windowHours(true);
        const first = T.times.length === 1 && !W ? T.times[0].h : base[0];
        if (24 % n && !W) notes.push(`24 isn't divisible by ${n}, so the hours restart at midnight.`);
        return [{ seconds: [0], minutes: [T.minutePast != null ? T.minutePast : (T.times.length === 1 ? T.times[0].m : 0)], hours: base.filter(h => h >= first && (h - first) % n === 0) }];
      }
    }
    if (T.times.length) {
      // Group minutes that share the same hours; each group is one schedule.
      const byMin = new Map();
      for (const t of T.times) { if (!byMin.has(t.m)) byMin.set(t.m, new Set()); byMin.get(t.m).add(t.h); }
      const byHours = new Map();
      for (const [m, hs] of byMin) {
        const key = sortNum([...hs]).join(',');
        if (!byHours.has(key)) byHours.set(key, { seconds: [0], minutes: [], hours: sortNum([...hs]) });
        byHours.get(key).minutes.push(m);
      }
      const out = [...byHours.values()].map(v => ({ ...v, minutes: sortNum(v.minutes) }));
      if (out.length > 1) notes.push(`Those times have different minutes, so they take ${out.length} cron schedules.`);
      return out;
    }
    if (T.minutePast != null) return [{ seconds: [0], minutes: [T.minutePast], hours: W ? windowHours(false) : allH }];
    if (W) {
      notes.push('No interval given, so this runs hourly within the window.');
      return [{ seconds: [0], minutes: [0], hours: windowHours(true) }];
    }
    notes.push('No time given, so this runs at midnight (00:00).');
    return [{ seconds: [0], minutes: [0], hours: [0] }];
  }

  /** Day rules for one group of clauses: [{ dom, dow, months, years, combine }…] or { error }. */
  function resolveDays(rules, notes) {
    // A clause that only names months ("and july") or years extends the clause before it.
    const folded = [];
    for (const r of rules) {
      const onlyMonths = !r.dows.size && !r.doms.size && !r.entries.length && !Object.keys(r.flags).length &&
        !r.dayStep && !r.weekStep && !r.monthStep && !r.yearStep;
      if (onlyMonths && folded.length) {
        r.months.forEach(m => folded[folded.length - 1].months.add(m));
        r.years.forEach(y => folded[folded.length - 1].years.add(y));
      } else folded.push(r);
    }
    const out = [];
    const plain = new Map();
    for (const r of folded) {
      if (r.weekStep) return { error: `Cron can't count weeks. Run weekly and skip alternate weeks in the job, e.g. \`[ $(( $(date +%s) / 604800 % ${r.weekStep} )) -eq 0 ]\`.` };
      if (r.yearStep) return { error: 'Cron can’t count years. Use a specific year (Quartz or EventBridge) or check the year in the job.' };
      let months = r.months.size ? sortNum([...r.months]) : null;
      if (!months && r.monthStep) months = monthStep(r.monthStep.n, r.monthStep.start, notes);
      if (!months && r.flags.quarterly) months = [1, 4, 7, 10];
      if (!months && r.flags.yearly) months = [1];
      const years = r.years.size ? sortNum([...r.years]) : null;
      for (const e of r.entries) {
        out.push({
          dom: e.domSpecial ? { list: ALL_MONTHS.concat(), special: e.domSpecial } : e.domList ? { list: e.domList } : null,
          dow: e.dowSpecial ? { special: e.dowSpecial } : null,
          months: e.months || months, years,
        });
      }
      let dows = r.dows.size ? sortNum([...r.dows]) : null;
      let doms = r.doms.size ? sortNum([...r.doms]) : null;
      if (r.dayStep) {
        doms = [];
        for (let d = 1; d <= 31; d += r.dayStep) doms.push(d);
        notes.push(`Day-of-month steps restart on the 1st each month, so this isn't a strict every-${r.dayStep}-days rhythm.`);
      }
      const f = r.flags;
      const hasPlain = dows || doms || f.daily || f.weekly || f.monthly || f.yearly || f.quarterly || r.monthStep || (!r.entries.length);
      if (!hasPlain) continue;
      if (f.weekly && !dows) { dows = [0]; notes.push('“Weekly” runs on Sundays, like cron’s @weekly.'); }
      if ((f.monthly || f.quarterly || f.yearly || r.monthStep) && !dows && !doms) doms = [1];
      const key = JSON.stringify([months, years, !!dows, !!doms]);
      const prev = plain.get(key);
      if (prev) {
        if (dows) prev.dows = sortNum([...new Set([...(prev.dows || []), ...dows])]);
        if (doms) prev.doms = sortNum([...new Set([...(prev.doms || []), ...doms])]);
      } else {
        const v = { dows, doms, months, years };
        plain.set(key, v);
        out.push(v);
      }
    }
    for (const v of out) {
      if (v.dom === undefined) {
        v.dom = v.doms ? { list: v.doms } : null;
        v.dow = v.dows ? { list: v.dows } : null;
        if (v.dom && v.dow) notes.push('Both a date and a weekday were given, so that schedule runs on either.');
      }
      for (const d of (v.dom && v.dom.list && !v.dom.special ? v.dom.list : [])) {
        if (d < 1 || d > 31) return { error: `There's no ${ordinal(d)} day of a month.` };
      }
    }
    return out.length ? out : [{ dom: null, dow: null, months: null, years: null }];
  }

  /**
   * Read a plain-English schedule. Returns { models:[…], notes:[…] } or { error }.
   * A sentence can describe several schedules ("first Monday of every month, third Monday of
   * every other month"); each becomes its own model, because cron can't combine them.
   */
  function fromEnglish(input) {
    const s = normalizeEnglish(input);
    if (!s.trim()) return { error: 'Describe a schedule, for example “every weekday at 9:30am”.' };
    const notes = [];
    const clauses = splitClauses(s).map(c => parseClause(c, notes));
    const bad = clauses.find(c => c.unsupported);
    if (bad) return { error: bad.unsupported };

    // Group clauses into schedules: a clause with both days and times completes a group;
    // days alone wait for a time; a time alone joins the days before it.
    const groups = [];
    let pend = { rules: [], times: [] };
    let last = null;
    for (const c of clauses) {
      if (c.rule && c.time) {
        pend.rules.push(c.rule);
        pend.times.push(c.time);
        groups.push(pend);
        last = pend;
        pend = { rules: [], times: [] };
      } else if (c.rule) pend.rules.push(c.rule);
      else if (c.time) {
        if (!pend.rules.length && last) last.times.push(c.time);
        else pend.times.push(c.time);
      }
    }
    if (pend.rules.length || pend.times.length) {
      if (last && !pend.times.length) last.rules.push(...pend.rules);
      else groups.push(pend);
    }
    if (!groups.length) return { error: 'Describe a schedule, for example “every weekday at 9:30am”.' };

    const models = [];
    const seen = new Set();
    for (const g of groups) {
      const times = resolveTimes(g.times, notes);
      if (times.error) return times;
      const days = resolveDays(g.rules, notes);
      if (days.error) return days;
      for (const d of days) {
        for (const t of times) {
          const hasDom = !!d.dom, hasDow = !!d.dow;
          const model = buildModel({
            seconds: t.seconds, minutes: t.minutes, hours: t.hours,
            months: d.months || ALL_MONTHS,
            years: d.years,
            dom: { list: d.dom ? d.dom.list || ALL_DAYS : ALL_DAYS, special: d.dom ? d.dom.special || null : null },
            dow: { list: d.dow ? d.dow.list || ALL_DOWS : ALL_DOWS, special: d.dow ? d.dow.special || null : null },
            combine: hasDom && hasDow ? 'or' : 'and',
          });
          if (!model.times.length) return { error: 'That doesn’t leave any times to run.' };
          const key = JSON.stringify([model.times.length, model.seconds, model.minutes, model.hours, model.months, model.years, model.dom.list, model.dom.special, model.dow.list, model.dow.special, model.dayMode]);
          if (seen.has(key)) continue;
          seen.add(key);
          models.push(model);
        }
      }
    }
    if (models.length > 8) return { error: `That takes ${models.length} separate cron schedules. Split it into simpler requests.` };
    return { models, notes: [...new Set(notes)] };
  }

  // ---------------------------------------------------------------- display helpers

  const dispCache = new Map();
  function displayParts(t, tz) {
    const key = tz;
    let f = dispCache.get(key);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
      });
      dispCache.set(key, f);
    }
    const o = {};
    for (const p of f.formatToParts(new Date(t))) o[p.type] = p.value;
    if (o.hour === '24') o.hour = '00';
    return o;
  }

  function fmtOffset(ms) {
    const m = Math.round(ms / 60000);
    const sign = m < 0 ? '−' : '+';
    const a = Math.abs(m);
    return `UTC${sign}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
  }

  return {
    DIALECTS, DIALECT_ORDER, FIELD_LABEL, DOW_ABBR, DOW_LONG, MON_LONG, MON_SHORT, EXAMPLE_BY_DIALECT, DAY,
    parse, unwrap, buildModel, dayMatches, upcoming, upcomingSet, dstImpact, dstPolicy, stats, statsSet, lintSet, describe, render, renderDays, workaroundText,
    utcVariants, shiftModel, offsetPeriods, transitionsBetween, lint, fromEnglish, minuteIntervalLines,
    wallParts, offsetAt, displayParts, fmtOffset, fmtClock, fmtDuration, ordinal, daysInMonth, weekday, isLeap,
    isValidZone, compress, runsOf, kindsFor,
    // for why.js and fleet.js
    daySegments, wallInstants, gapBoundary, domMatch, dowMatch, domPhrase, dowPhrase, monthPhrase, yearPhrase, timePhrase,
    offsetFast: cachedOffset, closeParen,
    joinList, cap, pad2, NTH,
  };
});
