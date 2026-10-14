/* Cron Almanac UI. Renders the engine's output; all schedule logic lives in engine.js. */
(function () {
  'use strict';
  const E = window.CronEngine;
  const D = E.DIALECTS;
  const DAY = E.DAY;
  const $ = id => document.getElementById(id);
  const browserTz = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
  })();
  const NTH = ['1st', '2nd', '3rd', '4th', '5th'];
  const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const STORE_KEY = 'cron-almanac';

  const EXAMPLES = [
    { label: 'The “first Monday” mistake', expr: '0 9 1-7 * 1', d: 'unix' },
    { label: 'Every 7 minutes (uneven)', expr: '*/7 * * * *', d: 'unix' },
    { label: '02:30 in New York (daylight saving)', expr: '30 2 * * *', d: 'unix', tz: 'America/New_York' },
    { label: 'Every 90 minutes?', expr: '*/90 * * * *', d: 'unix' },
    { label: 'Full crontab line with a command', expr: '15 3 * * 1-5 /opt/backup.sh > /var/log/backup-$(date +%F).log', d: 'unix' },
    { label: 'GitHub Actions: nightly build', expr: '0 3 * * *', d: 'github' },
    { label: 'Kubernetes: */2 with a weekday', expr: '0 0 */2 * 1', d: 'k8s' },
    { label: 'EventBridge: month end', expr: 'cron(0 18 L * ? *)', d: 'eventbridge' },
    { label: 'Quartz: third Friday', expr: '0 0 12 ? * 6#3', d: 'quartz' },
    { label: 'Quartz: 1-5 isn’t Monday to Friday', expr: '0 0 9 ? * 1-5', d: 'quartz' },
    { label: 'Spring: weekday mornings in Berlin', expr: '0 30 8 * * MON-FRI', d: 'spring', tz: 'Europe/Berlin' },
  ];

  const state = { expr: '0 9 1-7 * 1', dialect: 'unix', tz: browserTz, calStart: null, runs: 12, sel: null };
  let current = null;

  // ------------------------------------------------------------ helpers

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = s => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
  const nf = new Intl.NumberFormat('en-US');

  function b64(s) {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }

  function relTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return `in ${s} s`;
    if (s < 3600) return `in ${Math.floor(s / 60)} min`;
    if (s < 86400) { const m = Math.floor(s / 60) % 60; return `in ${Math.floor(s / 3600)} h${m ? ' ' + m + ' min' : ''}`; }
    if (s < 60 * 86400) { const h = Math.floor(s / 3600) % 24; return `in ${Math.floor(s / 86400)} d${h ? ' ' + h + ' h' : ''}`; }
    if (s < 730 * 86400) return `in ${Math.round(s / (30.44 * 86400))} months`;
    return `in ${Math.round(s / (365.25 * 86400))} years`;
  }

  function fmtDate(t, tz, withYear) {
    const p = E.displayParts(t, tz);
    return `${p.weekday} ${p.day} ${p.month}${withYear ? ' ' + p.year : ''}`;
  }

  function effTz(P) {
    if (state.dialect === 'github') return 'UTC';
    if (P && P.ok && P.tz) return P.tz;
    return state.tz;
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast');
    if (!msg) { el.hidden = true; return; }
    el.innerHTML = md(msg);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 9000);
  }

  function copyText(text, btn) {
    const done = ok => {
      if (!btn) return;
      const label = btn.textContent;
      btn.textContent = ok ? 'Copied' : 'Select and copy';
      btn.classList.toggle('done', ok);
      setTimeout(() => { btn.textContent = label; btn.classList.remove('done'); }, 1400);
    };
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      done(ok);
    };
    try {
      navigator.clipboard.writeText(text).then(() => done(true), fallback);
    } catch (e) { fallback(); }
  }

  // ------------------------------------------------------------ state

  function load() {
    let raw = null;
    const h = location.hash.slice(1);
    if (h.startsWith('s.')) { try { raw = unb64(h.slice(2)); } catch (e) { raw = null; } }
    if (!raw) { try { raw = localStorage.getItem(STORE_KEY); } catch (e) { raw = null; } }
    if (!raw) return false;
    try {
      const o = JSON.parse(raw);
      if (typeof o.e === 'string') state.expr = o.e;
      if (D[o.d]) state.dialect = o.d;
      if (typeof o.z === 'string' && E.isValidZone(o.z)) state.tz = o.z;
    } catch (e) { return false; }
    return true;
  }

  function save() {
    const json = JSON.stringify({ e: state.expr, d: state.dialect, z: state.tz });
    try { localStorage.setItem(STORE_KEY, json); } catch (e) { /* storage unavailable */ }
    if (window.top === window) {
      try { history.replaceState(null, '', '#s.' + b64(json)); } catch (e) { /* ignore */ }
    }
  }

  // ------------------------------------------------------------ static controls

  function buildDialects() {
    const box = $('dialects');
    box.innerHTML = E.DIALECT_ORDER.map(id => `<button type="button" data-d="${id}" aria-pressed="false">${esc(D[id].name)}</button>`).join('');
    box.addEventListener('click', e => {
      const b = e.target.closest('button[data-d]');
      if (b) switchDialect(b.dataset.d);
    });
  }

  function syncDialectButtons() {
    for (const b of $('dialects').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.d === state.dialect));
  }

  function buildTz() {
    let zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) { zones = []; }
    if (!zones.length) {
      zones = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Sao_Paulo',
        'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Kyiv', 'Africa/Lagos', 'Asia/Dubai', 'Asia/Kolkata',
        'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland'];
    }
    const sel = $('tz');
    const common = ['UTC', browserTz, 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney']
      .filter((z, i, a) => a.indexOf(z) === i);
    const opt = (z, label) => `<option value="${esc(z)}">${esc(label || z)}</option>`;
    sel.innerHTML =
      `<optgroup label="Common">${common.map(z => opt(z, z === browserTz ? `${z} (your time zone)` : z)).join('')}</optgroup>` +
      `<optgroup label="All time zones">${zones.filter(z => z !== 'UTC').map(z => opt(z)).join('')}</optgroup>`;
    sel.addEventListener('change', () => { state.tz = sel.value; state.sel = null; update(); });
  }

  function ensureTzOption(tz) {
    const sel = $('tz');
    if (![...sel.options].some(o => o.value === tz)) sel.insertAdjacentHTML('afterbegin', `<option value="${esc(tz)}">${esc(tz)}</option>`);
    sel.value = tz;
  }

  function buildExamples() {
    const sel = $('examples');
    sel.innerHTML = '<option value="">Load an example…</option>' + EXAMPLES.map((x, i) => `<option value="${i}">${esc(x.label)}</option>`).join('');
    sel.addEventListener('change', () => {
      const x = EXAMPLES[+sel.value];
      sel.value = '';
      if (!x) return;
      state.expr = x.expr;
      state.dialect = x.d;
      if (x.tz) state.tz = x.tz;
      state.sel = null;
      state.calStart = null;
      $('expr').value = state.expr;
      toast('');
      update();
    });
  }

  // ------------------------------------------------------------ dialect switching

  function switchDialect(id) {
    if (id === state.dialect) return;
    const P = current;
    const fromTz = effTz(P);
    const T = D[id];
    let msg;
    if (P && P.ok) {
      if (P.tz) state.tz = P.tz;
      if (id === 'github' && fromTz !== 'UTC') {
        const now = Date.now();
        const vs = E.utcVariants(P, fromTz, 'github', now);
        const v = vs.find(x => x.periods.some(p => p.from <= now && now < p.to)) || vs[0];
        if (v && v.lines) {
          state.expr = v.lines[0];
          msg = `GitHub runs schedules in UTC, so the ${fromTz} times were converted at today's offset (${E.fmtOffset(v.off)}).` +
            (vs.length > 1 ? ' Translations shows the other season too.' : '') +
            (v.lines.length > 1 ? ` This takes ${v.lines.length} lines; showing the first.` : '');
        } else {
          msg = `Couldn't convert to UTC: ${v ? v.error : 'no offset found'} The expression is unchanged.`;
        }
      } else {
        const r = E.render(P, id);
        if (r.ok) {
          state.expr = r.lines[0];
          msg = r.lines.length > 1
            ? `${T.name} needs ${r.lines.length} schedules for this; showing the first. Translations lists both.`
            : `Converted to ${T.name}.`;
        } else if (r.workaround) {
          state.expr = r.workaround.expr;
          msg = `${r.reason} Showing the closest ${T.short} schedule; Translations has the check the job needs.`;
        } else {
          msg = `${T.name} can't express this: ${r.reason}`;
        }
        if (state.dialect === 'github') { state.tz = 'UTC'; msg += ' The time zone is set to UTC so the times stay the same.'; }
      }
    } else {
      msg = `Reading the expression as ${T.name}.`;
    }
    state.dialect = id;
    $('expr').value = state.expr;
    toast(msg);
    update();
  }

  // ------------------------------------------------------------ field chips

  function chipMeaning(f) {
    if (f.question) return 'not used';
    const sp = f.special;
    if (sp) {
      if (sp.type === 'L') return sp.offset ? `${sp.offset} before last day` : 'last day';
      if (sp.type === 'LW') return 'last weekday';
      if (sp.type === 'W') return `weekday nearest ${E.ordinal(sp.day)}`;
      if (sp.type === 'nth') return `${NTH[sp.n - 1]} ${DOW_SHORT[sp.dow]}`;
      if (sp.type === 'lastDow') return `last ${DOW_SHORT[sp.dow]}`;
    }
    const L = f.list;
    const full = { second: 60, minute: 60, hour: 24, dom: 31, month: 12, dow: 7 }[f.kind];
    if (f.kind === 'year') {
      if (f.raw === '*') return 'any year';
    } else if (L.length === full) {
      return { second: 'every second', minute: 'every minute', hour: 'every hour', dom: 'every day', month: 'every month', dow: 'any weekday' }[f.kind];
    }
    const name = v => {
      switch (f.kind) {
        case 'dow': return DOW_SHORT[v];
        case 'month': return E.MON_SHORT[v - 1];
        case 'minute': case 'second': return ':' + String(v).padStart(2, '0');
        case 'hour': return String(v).padStart(2, '0') + 'h';
        case 'dom': return E.ordinal(v);
        default: return String(v);
      }
    };
    const runs = E.runsOf(L);
    const unit = { second: ' s', minute: ' min', hour: ' h', dom: ' days', month: ' months' }[f.kind] || '';
    if (L.length > 2 && runs.length > 1) {
      const g = L[1] - L[0];
      if (L.every((v, i) => i === 0 || v - L[i - 1] === g)) return L[0] === (f.kind === 'dom' || f.kind === 'month' ? 1 : 0) ? `every ${g}${unit}` : `every ${g}${unit} from ${name(L[0])}`;
    }
    if (runs.length <= 3) return runs.map(([a, b]) => a === b ? name(a) : `${name(a)}–${name(b)}`).join(', ');
    return `${L.slice(0, 3).map(name).join(', ')} …`;
  }

  function renderFields(P) {
    const T = D[state.dialect];
    const names = T.fields.map(f => f.replace('?', ''));
    const toks = P.tokens || [];
    const chips = [];
    const chip = (label, token, mean, cls, idx) =>
      `<li><button type="button" class="chip ${cls || ''}" data-i="${idx}"><span class="f-label">${esc(label)}</span><span class="f-token">${esc(token)}</span><span class="f-mean">${esc(mean || ' ')}</span></button></li>`;
    if (P.ok && P.macro) {
      chips.push(chip('shortcut', P.macro, P.reboot ? 'at startup' : `= ${P.macroExpansion}`, '', 0));
    } else {
      const n = Math.max(toks.length, names.length);
      for (let i = 0; i < n; i++) {
        const kind = names[i];
        const optional = T.fields[i] && T.fields[i].endsWith('?');
        if (i >= toks.length && optional) continue;
        const label = kind ? E.FIELD_LABEL[kind] : 'extra';
        const token = toks[i] ? toks[i].text : '—';
        let mean = '', cls = '';
        if (P.ok) mean = chipMeaning(P.fields[i]);
        else if (P.error.field === i) { cls = 'bad'; mean = 'see below'; }
        else if (!kind || !toks[i]) { cls = 'bad'; mean = kind ? 'missing' : 'unexpected'; }
        chips.push(chip(label, token, mean, cls, i));
      }
    }
    $('fields').innerHTML = chips.join('');
    syncCaret();
  }

  function syncCaret() {
    const input = $('expr');
    const toks = (current && current.tokens) || [];
    const pos = input.selectionStart;
    const idx = document.activeElement === input ? toks.findIndex(t => pos >= t.start && pos <= t.end) : -1;
    $('fields').querySelectorAll('.chip').forEach(c => c.classList.toggle('active', +c.dataset.i === idx));
  }

  // ------------------------------------------------------------ main render

  function update() {
    const P = E.parse(state.expr, state.dialect);
    current = P;
    const tz = effTz(P);
    const now = Date.now();
    syncDialectButtons();
    renderTz(P, tz, now);
    renderFields(P);
    const results = $('results');
    if (!P.ok) {
      renderError(P);
      results.classList.add('stale');
      $('expr').classList.add('invalid');
      save();
      return;
    }
    $('error').hidden = true;
    results.classList.remove('stale');
    $('expr').classList.remove('invalid');
    renderSummary(P, tz, now);
    renderChecks(P, tz, now);
    renderRuns(P, tz, now);
    renderCalendar(P, tz, now);
    renderDaymap(P, tz, now);
    renderTranslations(P, tz, now);
    save();
  }

  function renderTz(P, tz, now) {
    const sel = $('tz');
    ensureTzOption(tz);
    const forced = state.dialect === 'github' || !!(P.ok && P.tz);
    sel.disabled = forced;
    const p = E.displayParts(now, tz);
    let hint = `Now ${p.hour}:${p.minute} ${p.timeZoneName} (${E.fmtOffset(E.offsetAt(now, tz))}).`;
    if (state.dialect === 'github') hint = 'GitHub Actions evaluates schedules in UTC. ' + hint;
    else if (P.ok && P.tz) hint = `Set by ${P.tzPrefix.split('=')[0]} in the expression. ` + hint;
    else if (state.dialect === 'eventbridge') hint += ' Rules always use UTC; EventBridge Scheduler can use this zone.';
    $('tz-hint').textContent = hint;
  }

  function renderError(P) {
    const el = $('error');
    const actions = [];
    if (P.error.fix) actions.push(`<button type="button" class="btn small" data-expr="${esc(P.error.fix.expr)}">${esc(P.error.fix.label)}</button>`);
    for (const id of E.DIALECT_ORDER) {
      if (id === state.dialect || actions.length >= 4) continue;
      const Q = E.parse(state.expr, id);
      if (Q.ok) actions.push(`<button type="button" class="btn ghost small" data-read="${id}">Read it as ${esc(D[id].name)}</button>`);
    }
    el.innerHTML = `<p>${md(P.error.message)}</p>${actions.length ? `<div class="actions">${actions.join('')}</div>` : ''}`;
    el.hidden = false;
  }

  function renderSummary(P, tz, now) {
    let s = md(E.describe(P)).replace(/<strong>or<\/strong>/g, '<mark>or</mark>');
    if (!P.reboot) s += ` <span class="tz">${esc(tz)}</span>`;
    $('sentence').innerHTML = s;
    const st = E.stats(P, tz, now);
    const dl = $('stats');
    if (!st) { dl.innerHTML = ''; dl.hidden = true; return; }
    dl.hidden = false;
    const next = E.upcoming(P, tz, now, 1).runs[0];
    const items = [
      ['Next run', next ? `${relTime(next.t - now)}<small>${esc(fmtDate(next.t, tz, new Date(next.t).getUTCFullYear() !== new Date(now).getUTCFullYear()))}</small>` : 'Never'],
      ['Runs a year', `${nf.format(st.perYear)}<small>on ${nf.format(st.activeDays)} day${st.activeDays === 1 ? '' : 's'}</small>`],
      ['Runs a day', `${nf.format(st.perDay)}<small>on days it runs</small>`],
      ['Shortest gap', st.minGap == null ? '—' : esc(E.fmtDuration(st.minGap))],
      ['Longest gap', st.maxGap == null ? '—' : esc(E.fmtDuration(st.maxGap))],
    ];
    dl.innerHTML = items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  }

  function renderChecks(P, tz, now) {
    const items = E.lint(P, tz, now);
    const order = { error: 0, warn: 1, info: 2 };
    items.sort((a, b) => order[a.level] - order[b.level]);
    if (!items.some(i => i.level !== 'info')) {
      const zoneNote = E.transitionsBetween(tz, now, now + 365 * DAY).length ? `, daylight saving in ${tz}` : '';
      items.unshift({
        level: 'ok', title: 'No problems found',
        body: `Checked the day-field logic, step sizes, impossible dates${zoneNote} and ${D[state.dialect].name} limits.`,
      });
    }
    const label = { error: 'Error', warn: 'Warning', info: 'Note', ok: 'OK' };
    $('checks').innerHTML = items.map(c => `
      <article class="check">
        <header><span class="sev ${c.level}">${label[c.level]}</span><h3>${md(c.title)}</h3></header>
        <p>${md(c.body)}</p>
        ${c.fix ? `<button type="button" class="btn ghost small" data-expr="${esc(c.fix.expr)}">${esc(c.fix.label)}</button>` : ''}
      </article>`).join('');
  }

  function renderRuns(P, tz, now) {
    const table = $('runs');
    const more = $('more-runs');
    if (P.reboot) {
      table.innerHTML = '<tbody><tr><td class="runs-empty">Runs once each time cron starts.</td></tr></tbody>';
      more.hidden = true;
      return;
    }
    const up = E.upcoming(P, tz, now, state.runs);
    if (!up.runs.length) {
      table.innerHTML = '<tbody><tr><td class="runs-empty">No upcoming runs.</td></tr></tbody>';
      more.hidden = true;
      return;
    }
    const showLocal = browserTz !== tz;
    const withSec = P.seconds.some(s => s !== 0);
    const thisYear = E.wallParts(now, tz).y;
    const rows = up.runs.map(r => {
      const p = E.displayParts(r.t, tz);
      const date = `${p.weekday} ${p.day} ${p.month}${+p.year !== thisYear ? ' ' + p.year : ''}`;
      let time, badge = '', cls = '';
      if (r.kind === 'skipped') {
        time = E.fmtClock(r.sec, withSec) + (r.count > 1 ? '–' + E.fmtClock(r.lastSec, withSec) : '');
        badge = `<span class="badge" title="Clocks jump from ${E.fmtClock(((r.tr.t + r.tr.before) % DAY) / 1000)} to ${E.fmtClock(((r.tr.t + r.tr.after) % DAY) / 1000)}; ${r.count > 1 ? 'these times don’t' : 'this time doesn’t'} exist.">skipped</span>`;
        cls = 'dst';
      } else {
        time = `${p.hour}:${p.minute}${withSec ? ':' + p.second : ''}`;
        if (r.kind === 'repeat') { badge = '<span class="badge" title="Clocks fall back, so this wall time happens a second time.">again</span>'; cls = 'dst'; }
        else if (r.repeats) { badge = '<span class="badge" title="Clocks fall back later, so this wall time happens twice.">1st of 2</span>'; cls = 'dst'; }
      }
      let local = '';
      if (showLocal) {
        const q = E.displayParts(r.t, browserTz);
        const sameDay = q.day === p.day;
        local = `<td class="local"><span class="mono">${q.hour}:${q.minute}</span>${sameDay ? '' : ' ' + esc(q.weekday)}</td>`;
      }
      return `<tr class="${cls}"><td>${esc(date)}</td><td class="t">${esc(time)}<span class="abbr">${esc(p.timeZoneName)}</span>${badge}</td>${local}<td class="rel">${esc(relTime(r.t - now))}</td></tr>`;
    });
    table.innerHTML = `<thead><tr><th scope="col">Date</th><th scope="col">Time</th>${showLocal ? `<th scope="col" title="${esc(browserTz)}">Your time</th>` : ''}<th scope="col">In</th></tr></thead><tbody>${rows.join('')}</tbody>`;
    more.hidden = up.exhausted || state.runs >= 200;
  }

  function dstDays(P, tz, a, b) {
    const map = new Map();
    for (const x of E.dstImpact(P, tz, a, b)) {
      if (!x.affected) continue;
      for (const s of x.samples) {
        const d = new Date(s.day);
        map.set(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`, x);
      }
    }
    return map;
  }

  function renderCalendar(P, tz, now) {
    const w = E.wallParts(now, tz);
    if (state.calStart == null) state.calStart = w.y * 12 + (w.mo - 1);
    const start = state.calStart;
    const ym = k => ({ y: Math.floor(k / 12), m: (k % 12) + 1 });
    const first = ym(start), last = ym(start + 11);
    $('year-label').textContent = `${E.MON_SHORT[first.m - 1]} ${first.y} – ${E.MON_SHORT[last.m - 1]} ${last.y}`;
    $('year-prev').disabled = first.y <= 1970;
    $('year-next').disabled = last.y >= 2199;
    const box = $('calendar');
    if (P.reboot) { box.innerHTML = ''; $('day-detail').textContent = 'No calendar for a startup-only job.'; return; }
    const dst = dstDays(P, tz, Date.UTC(first.y, first.m - 1, 1) - 2 * DAY, Date.UTC(last.y, last.m, 1) + 2 * DAY);
    const todayKey = `${w.y}-${w.mo}-${w.d}`;
    const todayNum = Date.UTC(w.y, w.mo - 1, w.d);
    const T = D[state.dialect];
    const wdNum = i => (T.dow.min === 1 ? i + 1 : i);
    const head = DOW_SHORT.map((n, i) => `<span class="wd" title="${E.DOW_LONG[i]} is ${wdNum(i)} in ${esc(T.name)}">${n[0]}<small>${wdNum(i)}</small></span>`).join('');
    let html = '';
    for (let k = start; k < start + 12; k++) {
      const { y, m } = ym(k);
      const dim = E.daysInMonth(y, m);
      const first = E.weekday(y, m, 1);
      let cells = '';
      let count = 0;
      for (let i = 0; i < first; i++) cells += '<span></span>';
      for (let d = 1; d <= dim; d++) {
        const key = `${y}-${m}-${d}`;
        const on = E.dayMatches(P, y, m, d);
        if (on) count++;
        const cls = [on ? 'on' : '', key === todayKey ? 'today' : '', Date.UTC(y, m - 1, d) < todayNum ? 'past' : '', dst.has(key) ? 'dst' : '', state.sel === key ? 'sel' : ''].join(' ').trim();
        cells += `<button type="button" class="${cls}" data-date="${key}" aria-label="${d} ${E.MON_LONG[m - 1]}${on ? ', runs' : ''}">${d}</button>`;
      }
      const yr = k === start || m === 1 ? ` <em>${y}</em>` : '';
      html += `<div class="month"><h3><b>${E.MON_LONG[m - 1]}${yr}</b><span>${count} day${count === 1 ? '' : 's'}</span></h3><div class="mgrid">${head}${cells}</div></div>`;
    }
    box.innerHTML = html;
    renderDayDetail(P, tz, dst);
  }

  function renderDayDetail(P, tz, dst) {
    const el = $('day-detail');
    if (!state.sel) { el.textContent = 'Pick a day to see its run times.'; return; }
    const [y, m, d] = state.sel.split('-').map(Number);
    const label = `${E.DOW_LONG[E.weekday(y, m, d)]} ${d} ${E.MON_LONG[m - 1]} ${y}`;
    if (!E.dayMatches(P, y, m, d)) { el.innerHTML = `<strong>${esc(label)}</strong>: no runs.`; return; }
    const withSec = P.seconds.some(s => s !== 0);
    const T = P.times;
    const shown = T.slice(0, 10).map(s => E.fmtClock(s, withSec)).join(', ');
    let html = `<strong>${esc(label)}</strong>: ${T.length} run${T.length === 1 ? '' : 's'} (${esc(tz)}) at ${esc(shown)}${T.length > 10 ? ` and ${nf.format(T.length - 10)} more` : ''}.`;
    const x = dst && dst.get(state.sel);
    if (x) {
      html += x.gap
        ? ` Clocks jump forward this day, so ${x.affected === 1 ? 'one of these times doesn’t' : `${x.affected} of these times don’t`} exist.`
        : ` Clocks fall back this day, so ${x.affected === 1 ? 'one of these times happens' : `${x.affected} of these times happen`} twice.`;
    }
    el.innerHTML = html;
  }

  let daymapBuilt = false;
  function buildDaymap() {
    const box = $('daymap');
    let html = '<span></span><div class="cols"><span>:00</span><span>:15</span><span>:30</span><span>:45</span></div>';
    const cells = '<i></i>'.repeat(60);
    for (let h = 0; h < 24; h++) html += `<span class="hl" data-hl="${h}">${String(h).padStart(2, '0')}</span><div class="row" data-h="${h}">${cells}</div>`;
    box.innerHTML = html;
    box.addEventListener('pointerover', e => {
      const cell = e.target.closest('.row i');
      if (!cell || !current || !current.ok || current.reboot) return;
      const h = +cell.parentElement.dataset.h;
      const m = Array.prototype.indexOf.call(cell.parentElement.children, cell);
      const on = current.hours.includes(h) && current.minutes.includes(m);
      const secs = current.seconds;
      const clock = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      $('daymap-status').textContent = on
        ? `${clock}: runs${secs.length > 1 || secs[0] !== 0 ? ` at ${secs.length > 6 ? secs.length + ' seconds' : secs.map(s => ':' + String(s).padStart(2, '0')).join(', ')}` : ''}`
        : `${clock}: no run`;
    });
    box.addEventListener('pointerleave', () => { $('daymap-status').textContent = daymapDefault; });
    daymapBuilt = true;
  }

  let daymapDefault = '';
  function renderDaymap(P, tz, now) {
    if (!daymapBuilt) buildDaymap();
    const box = $('daymap');
    const hs = new Set(P.reboot ? [] : P.hours), ms = new Set(P.reboot ? [] : P.minutes);
    box.querySelectorAll('.row').forEach(row => {
      const h = +row.dataset.h;
      const hOn = hs.has(h);
      const kids = row.children;
      for (let m = 0; m < 60; m++) kids[m].className = hOn && ms.has(m) ? 'on' : '';
    });
    const dstHours = new Set();
    for (const tr of E.transitionsBetween(tz, now, now + 365 * DAY)) {
      const ws = tr.t + Math.min(tr.before, tr.after), we = tr.t + Math.max(tr.before, tr.after);
      for (let t = ws; t < we; t += 60000) dstHours.add(Math.floor((t % DAY) / 3600000));
    }
    box.querySelectorAll('.hl').forEach(l => l.classList.toggle('dsth', dstHours.has(+l.dataset.hl)));
    const notes = [];
    if (P.reboot) notes.push('Startup-only jobs have no time of day.');
    else {
      const secs = P.seconds;
      if (secs.length > 1) notes.push(`Each lit minute runs ${secs.length} times (${secs.length > 6 ? `every ${secs[1] - secs[0]} s` : 'at ' + secs.map(s => ':' + String(s).padStart(2, '0')).join(', ')}).`);
      else if (secs[0] !== 0) notes.push(`Each lit minute runs at :${String(secs[0]).padStart(2, '0')} seconds.`);
      notes.push('The same pattern repeats on every day it runs.');
    }
    if (dstHours.size) notes.push(`<span class="key dst"></span>Hours where ${esc(tz)} changes its clocks.`);
    $('daymap-legend').innerHTML = notes.join(' ');
    daymapDefault = P.reboot ? '' : `${nf.format(P.times.length)} run${P.times.length === 1 ? '' : 's'} a day. Hover a cell for its time.`;
    box.setAttribute('aria-label', P.reboot ? 'No time of day' : `Grid of 24 hours by 60 minutes. ${P.times.length} run times a day: ${E.describe(P).replace(/\*\*/g, '')}`);
    $('daymap-status').textContent = daymapDefault;
  }

  function snippet(id, line, tz) {
    switch (id) {
      case 'unix':
        return `# CRON_TZ works in cronie; Debian/Ubuntu cron use the system time zone\nCRON_TZ=${tz}\n${line}  /path/to/command`;
      case 'github':
        return `on:\n  schedule:\n    - cron: '${line}'  # UTC`;
      case 'k8s':
        return `apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: my-job\nspec:\n  schedule: "${line}"\n  timeZone: "${tz}"\n  jobTemplate:\n    # …`;
      case 'eventbridge':
        return `aws scheduler create-schedule \\\n  --name my-job \\\n  --schedule-expression "${line}" \\\n  --schedule-expression-timezone "${tz}" \\\n  --flexible-time-window '{"Mode": "OFF"}' \\\n  --target '{"Arn": "…", "RoleArn": "…"}'`;
      case 'quartz':
        return `Trigger trigger = TriggerBuilder.newTrigger()\n    .withSchedule(CronScheduleBuilder.cronSchedule("${line}")\n        .inTimeZone(TimeZone.getTimeZone("${tz}")))\n    .build();`;
      case 'spring':
        return `@Scheduled(cron = "${line}", zone = "${tz}")\npublic void run() { /* … */ }`;
    }
    return line;
  }

  function lineHtml(line, id, canUse) {
    return `<div class="line"><span class="expr">${esc(line)}</span><button type="button" class="btn ghost small" data-copy="${esc(line)}">Copy</button>${canUse ? `<button type="button" class="btn ghost small" data-use="${id}" data-line="${esc(line)}">Use</button>` : ''}</div>`;
  }

  function periodText(v, tz, now) {
    const end = now + 365 * DAY - 1000;
    const short = t => { const p = E.displayParts(t, tz); return `${p.day} ${p.month}`; };
    const ranges = v.periods.map(p => {
      const a = p.from > now + 1000 ? short(p.from) : null;
      const b = p.to < end ? short(p.to) : null;
      return a && b ? `${a} – ${b}` : a ? `from ${a}` : b ? `until ${b}` : 'all year';
    });
    const abbr = E.displayParts(Math.max(v.periods[0].from, now) + 1000, tz).timeZoneName;
    return `While ${tz} is ${E.fmtOffset(v.off)} (${abbr}), ${ranges.join(' and ')}`;
  }

  function utcBlock(P, tz, id, now) {
    const vs = E.utcVariants(P, tz, id, now);
    let html = '';
    for (const v of vs) {
      html += `<p class="period">${esc(periodText(v, tz, now))}</p>`;
      if (v.error) html += `<p>${md(v.error)}</p>`;
      else html += v.lines.map(l => lineHtml(l, id, true)).join('') + (v.lines.length > 1 ? `<p>Use all ${v.lines.length} lines together.</p>` : '');
    }
    if (vs.length > 1) html += `<p>A UTC schedule can't follow daylight saving. Pick one, or schedule both and skip the run that doesn't apply.</p>`;
    return html;
  }

  function renderTranslations(P, tz, now) {
    const out = [];
    for (const id of E.DIALECT_ORDER) {
      const T = D[id];
      const r = E.render(P, id);
      const isSelf = id === state.dialect;
      const tags = [];
      if (isSelf) tags.push('<span class="tag">This expression</span>');
      if (!r.ok) tags.push('<span class="tag no">No exact match</span>');
      let body = '';
      if (r.ok) {
        const utcOnly = id === 'github' && tz !== 'UTC' && !P.reboot;
        if (utcOnly) {
          body += `<p>GitHub runs schedules in UTC, so the ${esc(tz)} times shift:</p>` + utcBlock(P, tz, id, now);
        } else {
          body += r.lines.map(l => lineHtml(l, id, !isSelf)).join('');
          if (r.note) body += `<p>${md(r.note)}</p>`;
          if (id === 'eventbridge' && tz !== 'UTC' && !P.reboot) {
            body += `<details class="snip"><summary>For an EventBridge rule, which only runs in UTC</summary><div>${utcBlock(P, tz, id, now)}</div></details>`;
          }
        }
        const first = utcOnly ? null : r.lines[0];
        if (first) body += `<details class="snip"><summary>Where it goes</summary><pre class="snippet">${esc(snippet(id, first, tz))}</pre></details>`;
      } else {
        body += `<p>${md(r.reason)}</p>`;
        if (r.workaround) {
          const text = E.workaroundText(r.workaround, id);
          if (id === 'unix') {
            body += `<p class="sub">Closest crontab line</p><pre class="snippet">${esc(text)}</pre>`;
          } else {
            body += `<p class="sub">Closest schedule</p>${lineHtml(r.workaround.expr, id, !isSelf)}<p class="sub">Then start the job with</p><pre class="snippet">${esc(text)}</pre>`;
          }
          body += '<p>The check uses GNU <code>date</code>.</p>';
        }
      }
      out.push(`<div class="tr"><div class="tr-name"><strong>${esc(T.name)}</strong>${tags.join('')}</div><div class="tr-body">${body}</div></div>`);
    }
    $('translations').innerHTML = out.join('');
  }

  // ------------------------------------------------------------ English

  function onEnglish(e) {
    e.preventDefault();
    const text = $('english').value.trim();
    const out = $('english-out');
    if (!text) { out.innerHTML = ''; return; }
    const r = E.fromEnglish(text);
    if (r.error) {
      out.innerHTML = `<p class="bad">${md(r.error)}</p>` + (r.lines ? r.lines.map(l => lineHtml(l, 'unix', true)).join('') : '');
      return;
    }
    let target = state.dialect;
    let res = E.render(r.model, target);
    const notes = r.notes.slice();
    if (!res.ok) {
      const alt = ['quartz', 'spring', 'eventbridge'].find(id => E.render(r.model, id).ok);
      if (alt) {
        notes.unshift(`${D[target].name} can't express this (${res.reason.replace(/\.$/, '')}), so it's shown as ${D[alt].name}.`);
        target = alt;
        res = E.render(r.model, alt);
      } else {
        out.innerHTML = `<p class="bad">${md(res.reason)}</p>`;
        return;
      }
    }
    if (target === 'github') notes.push('GitHub reads these times as UTC.');
    if (res.lines.length > 1) notes.push(`This needs ${res.lines.length} schedules; the other is \`${res.lines.slice(1).join('`, `')}\`.`);
    state.dialect = target;
    state.expr = res.lines[0];
    state.sel = null;
    $('expr').value = state.expr;
    toast('');
    update();
    out.innerHTML = notes.map(n => `<p>${md(n)}</p>`).join('');
  }

  // ------------------------------------------------------------ events

  function applyExpr(expr, dialect) {
    if (dialect) state.dialect = dialect;
    state.expr = expr;
    $('expr').value = expr;
    update();
  }

  function bind() {
    const input = $('expr');
    let t = 0;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { state.expr = input.value; update(); }, 70);
    });
    ['keyup', 'click', 'focus', 'select'].forEach(ev => input.addEventListener(ev, syncCaret));
    input.addEventListener('blur', () => setTimeout(syncCaret, 0));
    $('fields').addEventListener('click', e => {
      const c = e.target.closest('.chip');
      if (!c || !current) return;
      const tok = current.tokens[+c.dataset.i];
      if (!tok) return;
      input.focus();
      input.setSelectionRange(tok.start, tok.end);
      syncCaret();
    });
    $('copy-expr').addEventListener('click', e => copyText(input.value, e.currentTarget));
    $('english-form').addEventListener('submit', onEnglish);
    $('more-runs').addEventListener('click', () => { state.runs = Math.min(200, state.runs + 30); update(); });
    $('year-prev').addEventListener('click', () => { state.calStart -= 12; renderCalendar(current, effTz(current), Date.now()); });
    $('year-next').addEventListener('click', () => { state.calStart += 12; renderCalendar(current, effTz(current), Date.now()); });
    $('calendar').addEventListener('click', e => {
      const b = e.target.closest('button[data-date]');
      if (!b || !current || !current.ok) return;
      state.sel = state.sel === b.dataset.date ? null : b.dataset.date;
      renderCalendar(current, effTz(current), Date.now());
    });
    document.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.copy != null) copyText(b.dataset.copy, b);
      else if (b.dataset.expr != null) { toast(''); applyExpr(b.dataset.expr); }
      else if (b.dataset.read) { const T = D[b.dataset.read]; toast(`Reading the expression as ${T.name}.`); applyExpr(state.expr, b.dataset.read); }
      else if (b.dataset.use) {
        const id = b.dataset.use;
        if (current && current.ok && current.tz) state.tz = current.tz;
        if (state.dialect === 'github' && id !== 'github') state.tz = 'UTC';
        toast(`Switched to ${D[id].name}.`);
        applyExpr(b.dataset.line, id);
      }
    });
    setInterval(() => {
      if (document.hidden || !current || !current.ok) return;
      const tz = effTz(current), now = Date.now();
      renderSummary(current, tz, now);
      renderRuns(current, tz, now);
    }, 30000);
  }

  function init() {
    const linked = location.hash.startsWith('#s.');
    const returning = load();
    buildDialects();
    buildTz();
    buildExamples();
    bind();
    $('expr').value = state.expr;
    update();
    if (!returning && !linked) toast('This opening example hides a classic mistake; Checks explains it. Type your own expression or load another example.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
