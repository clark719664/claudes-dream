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
  const MAX_SCHEDULES = 8;

  const EXAMPLES = [
    { label: 'The “first Monday” mistake', exprs: ['0 9 1-7 * 1'], d: 'unix' },
    { label: 'Every 7 minutes (uneven)', exprs: ['*/7 * * * *'], d: 'unix' },
    { label: '02:30 in New York (daylight saving)', exprs: ['30 2 * * *'], d: 'unix', tz: 'America/New_York' },
    { label: 'Every 90 minutes takes two lines', exprs: ['0 */3 * * *', '30 1-22/3 * * *'], d: 'unix' },
    { label: 'Full crontab line with a command', exprs: ['15 3 * * 1-5 /opt/backup.sh > /var/log/backup-$(date +%F).log'], d: 'unix' },
    { label: 'GitHub Actions: 02:30 in New York', exprs: ['30 2 * * *'], d: 'github', tz: 'America/New_York' },
    { label: 'Kubernetes: */2 with a weekday', exprs: ['0 0 */2 * 1'], d: 'k8s' },
    { label: 'EventBridge: month end', exprs: ['cron(0 18 L * ? *)'], d: 'eventbridge' },
    { label: 'Quartz: first Monday, and third Monday every other month', exprs: ['0 0 9 ? * 2#1', '0 0 9 ? 1/2 2#3'], d: 'quartz' },
    { label: 'Quartz: 1-5 isn’t Monday to Friday', exprs: ['0 0 9 ? * 1-5'], d: 'quartz' },
    { label: 'Spring: weekday mornings in Berlin', exprs: ['0 30 8 * * MON-FRI'], d: 'spring', tz: 'Europe/Berlin' },
  ];

  // exprs[0] is the main expression; the rest are extra schedules that run the same job.
  const state = { exprs: ['0 9 1-7 * 1'], dialect: 'unix', tz: browserTz, calStart: null, runs: 12, sel: null };
  let current = null; // { list, P, models, tz }

  // ------------------------------------------------------------ helpers

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = s => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
  const nf = new Intl.NumberFormat('en-US');
  const pad = n => String(n).padStart(2, '0');

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
    if (P && P.ok && P.tz) return P.tz;
    return state.tz;
  }

  const multi = () => current && current.models.length > 1;
  const schedName = i => `Schedule ${i + 1}`;

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
      if (typeof o.e === 'string') state.exprs = [o.e];
      if (Array.isArray(o.x)) state.exprs.push(...o.x.filter(x => typeof x === 'string').slice(0, MAX_SCHEDULES - 1));
      if (D[o.d]) state.dialect = o.d;
      if (typeof o.z === 'string' && E.isValidZone(o.z)) state.tz = o.z;
    } catch (e) { return false; }
    return true;
  }

  function save() {
    const o = { e: state.exprs[0], d: state.dialect, z: state.tz };
    if (state.exprs.length > 1) o.x = state.exprs.slice(1);
    const json = JSON.stringify(o);
    try { localStorage.setItem(STORE_KEY, json); } catch (e) { /* storage unavailable */ }
    if (window.top === window) {
      try { history.replaceState(null, '', '#s.' + b64(json)); } catch (e) { /* ignore */ }
    }
  }

  /** Replace the whole set of expressions (and optionally the dialect), then redraw. */
  function setExprs(exprs, dialect) {
    if (dialect) state.dialect = dialect;
    state.exprs = exprs.length ? exprs.slice(0, MAX_SCHEDULES) : [''];
    state.sel = null;
    $('expr').value = state.exprs[0];
    update();
  }

  // ------------------------------------------------------------ static controls

  function buildDialects() {
    const box = $('dialects');
    box.innerHTML = E.DIALECT_ORDER.map(id => `<button type="button" data-d="${id}" aria-pressed="false" title="${esc(D[id].name)}"><span class="dl-long">${esc(D[id].name)}</span><span class="dl-short">${esc(D[id].short)}</span></button>`).join('');
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
      if (x.tz) state.tz = x.tz;
      state.calStart = null;
      toast('');
      setExprs(x.exprs, x.d);
    });
  }

  // ------------------------------------------------------------ dialect switching

  function switchDialect(id) {
    if (id === state.dialect) return;
    const T = D[id];
    const list = current ? current.list : [];
    let msg = '';
    if (list.length && list[0].ok) {
      if (list[0].tz) state.tz = list[0].tz;
      const out = [];
      const problems = [];
      let split = 0;
      list.forEach((P, i) => {
        if (!P.ok) { out.push(state.exprs[i]); return; }
        const r = E.render(P, id);
        if (r.ok) { out.push(...r.lines); if (r.lines.length > 1) split++; }
        else if (r.workaround) { out.push(r.workaround.expr); problems.push(r.reason); }
        else { out.push(state.exprs[i]); problems.push(r.reason); }
      });
      if (problems.length) {
        msg = `${problems[0]} ${list.length > 1 ? 'Where there was no exact match, the closest schedule is shown' : 'Showing the closest schedule'}; Translations has the check the job needs.`;
      } else if (split) {
        msg = `${T.name} needs ${out.length} schedules for this, so they're all listed below the expression.`;
      } else msg = `Converted to ${T.name}.`;
      toast(msg);
      setExprs(out, id);
    } else {
      toast(`Reading the expression as ${T.name}.`);
      setExprs(state.exprs, id);
    }
  }

  // ------------------------------------------------------------ field chips (main expression)

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
        case 'minute': case 'second': return ':' + pad(v);
        case 'hour': return pad(v) + 'h';
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
      `<li><button type="button" class="chip ${cls || ''}" data-i="${idx}"><span class="f-label">${esc(label)}</span><span class="f-token">${esc(token)}</span><span class="f-mean">${esc(mean || ' ')}</span></button></li>`;
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
    const toks = (current && current.P && current.P.tokens) || [];
    const pos = input.selectionStart;
    const idx = document.activeElement === input ? toks.findIndex(t => pos >= t.start && pos <= t.end) : -1;
    $('fields').querySelectorAll('.chip').forEach(c => c.classList.toggle('active', +c.dataset.i === idx));
  }

  // ------------------------------------------------------------ extra schedules

  function renderExtras(list) {
    const box = $('extras');
    const n = state.exprs.length - 1;
    $('expr-n').hidden = n === 0;
    $('add-expr').hidden = state.exprs.length >= MAX_SCHEDULES;
    let rows = box.querySelectorAll('.extra');
    if (rows.length !== n) {
      const focused = document.activeElement && document.activeElement.classList.contains('extra-input') ? +document.activeElement.dataset.i : -1;
      box.innerHTML = state.exprs.slice(1).map((x, k) => {
        const i = k + 1;
        return `<div class="extra">
          <span class="extra-n" aria-hidden="true">${i + 1}</span>
          <label class="sr-only" for="expr-${i}">${schedName(i)}</label>
          <input id="expr-${i}" class="extra-input" data-i="${i}" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off">
          <button type="button" class="btn ghost small" data-remove="${i}" aria-label="Remove ${schedName(i).toLowerCase()}">Remove</button>
          <p class="extra-note" id="expr-note-${i}"></p>
        </div>`;
      }).join('');
      rows = box.querySelectorAll('.extra');
      if (focused > 0 && focused <= n) $('expr-' + focused).focus();
    }
    rows.forEach((row, k) => {
      const i = k + 1;
      const input = row.querySelector('input');
      if (document.activeElement !== input && input.value !== state.exprs[i]) input.value = state.exprs[i];
      const P = list[i];
      const note = row.querySelector('.extra-note');
      let text, bad = false;
      if (!P.ok) { text = P.error.message; bad = true; }
      else if (P.reboot) { text = '`@reboot` can’t be combined with other schedules.'; bad = true; }
      else text = E.describe(P).replace(/\*\*/g, '');
      note.innerHTML = md(text);
      note.classList.toggle('bad', bad);
      input.classList.toggle('invalid', bad);
      input.setAttribute('aria-invalid', String(bad));
      input.setAttribute('aria-describedby', 'expr-note-' + i);
    });
  }

  // ------------------------------------------------------------ main render

  function update() {
    const list = state.exprs.map(x => E.parse(x, state.dialect));
    const P = list[0];
    const tz = effTz(P);
    const now = Date.now();
    const models = !P.ok ? [] : P.reboot ? [P] : list.filter(Q => Q.ok && !Q.reboot);
    current = { list, P, models, tz };
    syncDialectButtons();
    renderTz(P, tz, now);
    renderFields(P);
    renderExtras(list);
    const results = $('results');
    const input = $('expr');
    input.setAttribute('aria-invalid', String(!P.ok));
    if (!P.ok) {
      renderError(P);
      results.classList.add('stale');
      input.classList.add('invalid');
      input.setAttribute('aria-describedby', 'error');
      save();
      return;
    }
    $('error').hidden = true;
    results.classList.remove('stale');
    input.classList.remove('invalid');
    input.setAttribute('aria-describedby', 'sentence');
    renderSummary(models, tz, now);
    renderChecks(models, tz, now);
    renderRuns(models, tz, now);
    renderCalendar(models, tz, now);
    renderDaymap(models, tz, now);
    renderTranslations(models, tz, now);
    save();
  }

  function renderTz(P, tz, now) {
    const sel = $('tz');
    ensureTzOption(tz);
    sel.disabled = !!(P.ok && P.tz);
    const p = E.displayParts(now, tz);
    let hint = `Now ${p.hour}:${p.minute} ${p.timeZoneName} (${E.fmtOffset(E.offsetAt(now, tz))}).`;
    if (P.ok && P.tz) hint = `Set by ${P.tzSource.replace(/`/g, '')} in the pasted text. ` + hint;
    else if (state.dialect === 'github') hint += ' GitHub uses UTC unless the workflow sets its timezone key.';
    else if (state.dialect === 'eventbridge') hint += ' Rules always use UTC; EventBridge Scheduler can use this zone.';
    $('tz-hint').textContent = hint;
  }

  function renderError(P) {
    const el = $('error');
    const actions = [];
    if (P.error.fix) actions.push(`<button type="button" class="btn small" data-fix="0" data-expr="${esc(P.error.fix.expr)}">${esc(P.error.fix.label)}</button>`);
    for (const id of E.DIALECT_ORDER) {
      if (id === state.dialect || actions.length >= 4) continue;
      const Q = E.parse(state.exprs[0], id);
      if (Q.ok) actions.push(`<button type="button" class="btn ghost small" data-read="${id}">Read it as ${esc(D[id].name)}</button>`);
    }
    el.innerHTML = `<p>${md(P.error.message)}</p>${actions.length ? `<div class="actions">${actions.join('')}</div>` : ''}`;
    el.hidden = false;
  }

  function renderSummary(models, tz, now) {
    const desc = M => md(E.describe(M)).replace(/<strong>or<\/strong>/g, '<mark>or</mark>');
    const zone = models[0].reboot ? '' : ` <span class="tz">${esc(tz)}</span>`;
    $('sentence').innerHTML = models.length === 1
      ? `<p>${desc(models[0])}${zone}</p>`
      : `<p class="lead">Runs on ${models.length} schedules together${zone}</p><ol>${models.map(M => `<li>${desc(M)}</li>`).join('')}</ol>`;
    const st = E.statsSet(models, tz, now);
    const dl = $('stats');
    if (!st) { dl.innerHTML = ''; dl.hidden = true; return; }
    dl.hidden = false;
    const next = E.upcomingSet(models, tz, now, 1).runs[0];
    const perDay = st.perDayMin === st.perDayMax ? nf.format(st.perDayMax) : `${nf.format(st.perDayMin)}–${nf.format(st.perDayMax)}`;
    const items = [
      ['Next run', next ? `${relTime(next.t - now)}<small>${esc(fmtDate(next.t, tz, new Date(next.t).getUTCFullYear() !== new Date(now).getUTCFullYear()))}</small>` : 'Never'],
      ['Runs a year', `${nf.format(st.perYear)}<small>on ${nf.format(st.activeDays)} day${st.activeDays === 1 ? '' : 's'}</small>`],
      ['Runs a day', `${perDay}<small>on days it runs</small>`],
      ['Shortest gap', st.minGap == null ? '—' : esc(E.fmtDuration(st.minGap))],
      ['Longest gap', st.maxGap == null ? '—' : esc(E.fmtDuration(st.maxGap))],
    ];
    dl.innerHTML = items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  }

  // Notes about the platform rather than one expression; shown once for a set.
  const PLATFORM_CHECKS = new Set(['gh-notes', 'gh-timezone', 'k8s-tz', 'k8s-crontz', 'eb-utc', 'unix-crontz']);

  function renderChecks(models, tz, now) {
    const items = [];
    const seen = new Set();
    models.forEach((M, i) => {
      for (const c of E.lint(M, tz, now)) {
        const global = PLATFORM_CHECKS.has(c.id);
        const key = global ? c.id : `${i}|${c.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(Object.assign({}, c, { title: models.length > 1 && !global ? `${schedName(i)}: ${c.title}` : c.title, at: i }));
      }
    });
    items.push(...E.lintSet(models, tz, now));
    const order = { error: 0, warn: 1, info: 2 };
    items.sort((a, b) => order[a.level] - order[b.level]);
    if (!items.some(i => i.level !== 'info')) {
      const zoneNote = E.transitionsBetween(tz, now, now + 365 * DAY).length ? `, daylight saving in ${tz}` : '';
      items.unshift({
        level: 'ok', title: 'No problems found',
        body: `Checked the day-field logic, step sizes, impossible dates${zoneNote}${models.length > 1 ? ', overlapping schedules' : ''} and ${D[state.dialect].name} limits.`,
      });
    }
    const label = { error: 'Error', warn: 'Warning', info: 'Note', ok: 'OK' };
    $('checks').innerHTML = items.map(c => `
      <article class="check">
        <header><span class="sev ${c.level}">${label[c.level]}</span><h3>${md(c.title)}</h3></header>
        <p>${md(c.body)}</p>
        ${c.fix ? `<button type="button" class="btn ghost small" data-fix="${c.at || 0}" data-expr="${esc(c.fix.expr)}">${esc(c.fix.label)}</button>` : ''}
      </article>`).join('');
  }

  function renderRuns(models, tz, now) {
    const table = $('runs');
    const more = $('more-runs');
    if (models[0].reboot) {
      table.innerHTML = '<tbody><tr><td class="runs-empty">Runs once each time cron starts.</td></tr></tbody>';
      more.hidden = true;
      return;
    }
    const up = E.upcomingSet(models, tz, now, state.runs);
    if (!up.runs.length) {
      table.innerHTML = '<tbody><tr><td class="runs-empty">No upcoming runs.</td></tr></tbody>';
      more.hidden = true;
      return;
    }
    const showLocal = browserTz !== tz;
    const several = models.length > 1;
    const withSec = models.some(M => M.seconds.some(s => s !== 0));
    const thisYear = E.wallParts(now, tz).y;
    const T = D[state.dialect];
    const badgeHtml = (text, title) => `<span class="badge" title="${esc(title)}">${esc(text)}</span>`;
    const rows = up.runs.map(r => {
      const pol = E.dstPolicy(models[r.which[0]]);
      const p = E.displayParts(r.t, tz);
      const date = `${p.weekday} ${p.day} ${p.month}${+p.year !== thisYear ? ' ' + p.year : ''}`;
      let time, badge = '', cls = '';
      if (r.kind === 'skipped') {
        const wall = E.fmtClock(r.sec, withSec) + (r.count > 1 ? '–' + E.fmtClock(r.lastSec, withSec) : '');
        const jump = `Clocks jump from ${E.fmtClock(((r.tr.t + r.tr.before) % DAY) / 1000)} to ${E.fmtClock(((r.tr.t + r.tr.after) % DAY) / 1000)}, so ${wall} doesn’t exist.`;
        cls = 'dst';
        if (pol.gap === 'after') {
          time = `${p.hour}:${p.minute}${withSec ? ':' + p.second : ''}`;
          badge = badgeHtml(r.count > 1 ? `${r.count} moved here` : `moved from ${E.fmtClock(r.sec, withSec)}`, `${jump} ${T.name} runs it right after the jump.`);
        } else {
          time = wall;
          badge = pol.gap === 'skip'
            ? badgeHtml('skipped', `${jump} ${T.name} skips it.`)
            : badgeHtml('skipped?', `${jump} ${T.name}'s docs don't say whether it's skipped or moved.`);
        }
      } else {
        time = `${p.hour}:${p.minute}${withSec ? ':' + p.second : ''}`;
        const twice = 'Clocks fall back, so this time happens twice.';
        if (r.kind === 'repeat') {
          cls = 'dst';
          if (pol.overlap === 'once') { cls += ' gone'; badge = badgeHtml('not repeated', `${twice} ${T.name} runs it only the first time.`); }
          else if (pol.overlap === 'twice') badge = badgeHtml('again', `${twice} ${T.name} runs it both times.`);
          else badge = badgeHtml('again?', `${twice} ${T.name}'s docs don't say whether it runs once or twice.`);
        } else if (r.repeats) {
          cls = 'dst';
          badge = badgeHtml(pol.overlap === 'once' ? 'runs once' : '1st of 2', twice);
        }
      }
      if (several && r.which.length > 1) {
        cls += ' clash';
        badge += badgeHtml('twice', `Schedules ${r.which.map(i => i + 1).join(' and ')} both fire now.`);
      }
      let local = '';
      if (showLocal) {
        const q = E.displayParts(r.t, browserTz);
        local = `<td class="local"><span class="mono">${q.hour}:${q.minute}</span>${q.day === p.day ? '' : ' ' + esc(q.weekday)}</td>`;
      }
      const sched = several ? `<td class="sched">${r.which.map(i => i + 1).join(', ')}</td>` : '';
      return `<tr class="${cls.trim()}"><td>${esc(date)}</td><td class="t">${esc(time)}<span class="abbr">${esc(p.timeZoneName)}</span>${badge}</td>${sched}${local}<td class="rel">${esc(relTime(r.t - now))}</td></tr>`;
    });
    table.innerHTML = `<thead><tr><th scope="col">Date</th><th scope="col">Time</th>${several ? '<th scope="col" title="Which schedule">Sched.</th>' : ''}${showLocal ? `<th scope="col" title="${esc(browserTz)}">Your time</th>` : ''}<th scope="col">In</th></tr></thead><tbody>${rows.join('')}</tbody>`;
    more.hidden = up.exhausted || state.runs >= 200;
  }

  function dstDays(models, tz, a, b) {
    const map = new Map();
    for (const M of models) {
      for (const x of E.dstImpact(M, tz, a, b)) {
        if (!x.affected) continue;
        for (const s of x.samples) {
          const d = new Date(s.day);
          map.set(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`, x);
        }
      }
    }
    return map;
  }

  function renderCalendar(models, tz, now) {
    const w = E.wallParts(now, tz);
    if (state.calStart == null) state.calStart = w.y * 12 + (w.mo - 1);
    const start = state.calStart;
    const ym = k => ({ y: Math.floor(k / 12), m: (k % 12) + 1 });
    const first = ym(start), last = ym(start + 11);
    $('year-label').textContent = `${E.MON_SHORT[first.m - 1]} ${first.y} – ${E.MON_SHORT[last.m - 1]} ${last.y}`;
    $('year-prev').disabled = first.y <= 1970;
    $('year-next').disabled = last.y >= 2199;
    const box = $('calendar');
    if (models[0].reboot) { box.innerHTML = ''; $('day-detail').textContent = 'No calendar for a startup-only job.'; return; }
    const dst = dstDays(models, tz, Date.UTC(first.y, first.m - 1, 1) - 2 * DAY, Date.UTC(last.y, last.m, 1) + 2 * DAY);
    const todayKey = `${w.y}-${w.mo}-${w.d}`;
    const todayNum = Date.UTC(w.y, w.mo - 1, w.d);
    const T = D[state.dialect];
    const wdNum = i => (T.dow.min === 1 ? i + 1 : i);
    const inWindow = key => {
      const [ky, km] = key.split('-').map(Number);
      const k = ky * 12 + km - 1;
      return k >= start && k < start + 12;
    };
    const focusKey = state.sel && inWindow(state.sel) ? state.sel : inWindow(todayKey) ? todayKey : `${first.y}-${first.m}-1`;
    const head = DOW_SHORT.map((n, i) => `<span class="wd" title="${E.DOW_LONG[i]} is ${wdNum(i)} in ${esc(T.name)}">${n[0]}<small>${wdNum(i)}</small></span>`).join('');
    let html = '';
    for (let k = start; k < start + 12; k++) {
      const { y, m } = ym(k);
      const dim = E.daysInMonth(y, m);
      const lead = E.weekday(y, m, 1);
      let cells = '';
      let count = 0;
      for (let i = 0; i < lead; i++) cells += '<span></span>';
      for (let d = 1; d <= dim; d++) {
        const key = `${y}-${m}-${d}`;
        const on = models.some(M => E.dayMatches(M, y, m, d));
        if (on) count++;
        const cls = [on ? 'on' : '', key === todayKey ? 'today' : '', Date.UTC(y, m - 1, d) < todayNum ? 'past' : '', dst.has(key) ? 'dst' : '', state.sel === key ? 'sel' : ''].join(' ').trim();
        cells += `<button type="button" class="${cls}" data-date="${key}" tabindex="${key === focusKey ? 0 : -1}" aria-pressed="${state.sel === key}" aria-label="${E.DOW_LONG[E.weekday(y, m, d)]} ${d} ${E.MON_LONG[m - 1]}${on ? ', runs' : ''}${dst.has(key) ? ', clock change' : ''}">${d}</button>`;
      }
      const yr = k === start || m === 1 ? ` <em>${y}</em>` : '';
      html += `<div class="month"><h3><b>${E.MON_LONG[m - 1]}${yr}</b><span>${count} day${count === 1 ? '' : 's'}</span></h3><div class="mgrid" role="group" aria-label="${E.MON_LONG[m - 1]} ${y}">${head}${cells}</div></div>`;
    }
    box.innerHTML = html;
    renderDayDetail(models, tz, dst);
  }

  function renderDayDetail(models, tz, dst) {
    const el = $('day-detail');
    if (!state.sel) { el.textContent = 'Pick a day to see its run times.'; return; }
    const [y, m, d] = state.sel.split('-').map(Number);
    const label = `${E.DOW_LONG[E.weekday(y, m, d)]} ${d} ${E.MON_LONG[m - 1]} ${y}`;
    const hits = models.map((M, i) => ({ M, i })).filter(x => E.dayMatches(x.M, y, m, d));
    if (!hits.length) { el.innerHTML = `<strong>${esc(label)}</strong>: no runs.`; return; }
    const part = M => {
      const withSec = M.seconds.some(s => s !== 0);
      const T = M.times;
      return `${nf.format(T.length)} run${T.length === 1 ? '' : 's'} at ${esc(T.slice(0, 10).map(s => E.fmtClock(s, withSec)).join(', '))}${T.length > 10 ? ` and ${nf.format(T.length - 10)} more` : ''}`;
    };
    let html = `<strong>${esc(label)}</strong> (${esc(tz)}): `;
    html += models.length === 1 ? part(hits[0].M) : hits.map(x => `${schedName(x.i).toLowerCase()}, ${part(x.M)}`).join('; ');
    html += '.';
    const x = dst && dst.get(state.sel);
    if (x) {
      html += x.gap
        ? ` Clocks jump forward this day, so ${x.affected === 1 ? 'one of these times doesn’t' : `${x.affected} of these times don’t`} exist.`
        : ` Clocks fall back this day, so ${x.affected === 1 ? 'one of these times happens' : `${x.affected} of these times happen`} twice.`;
    }
    el.innerHTML = html;
  }

  let daymapBuilt = false;
  let daymapDefault = '';
  function buildDaymap() {
    const box = $('daymap');
    let html = '<span></span><div class="cols"><span>:00</span><span>:15</span><span>:30</span><span>:45</span></div>';
    const cells = '<i></i>'.repeat(60);
    for (let h = 0; h < 24; h++) html += `<span class="hl" data-hl="${h}">${pad(h)}</span><div class="row" data-h="${h}">${cells}</div>`;
    box.innerHTML = html;
    box.addEventListener('pointerover', e => {
      const cell = e.target.closest('.row i');
      if (!cell || !current || !current.models.length || current.models[0].reboot) return;
      const h = +cell.parentElement.dataset.h;
      const m = Array.prototype.indexOf.call(cell.parentElement.children, cell);
      const which = current.models.map((M, i) => (M.hours.includes(h) && M.minutes.includes(m) ? i : -1)).filter(i => i >= 0);
      const clock = `${pad(h)}:${pad(m)}`;
      if (!which.length) { $('daymap-status').textContent = `${clock}: no run`; return; }
      const secs = current.models[which[0]].seconds;
      const at = secs.length > 1 || secs[0] !== 0 ? ` at ${secs.length > 6 ? secs.length + ' seconds' : secs.map(s => ':' + pad(s)).join(', ')}` : '';
      $('daymap-status').textContent = `${clock}: runs${at}${current.models.length > 1 ? ` (schedule ${which.map(i => i + 1).join(', ')})` : ''}`;
    });
    box.addEventListener('pointerleave', () => { $('daymap-status').textContent = daymapDefault; });
    daymapBuilt = true;
  }

  function renderDaymap(models, tz, now) {
    if (!daymapBuilt) buildDaymap();
    const box = $('daymap');
    const reboot = models[0].reboot;
    const lit = new Set();
    if (!reboot) for (const M of models) for (const h of M.hours) for (const m of M.minutes) lit.add(h * 60 + m);
    box.querySelectorAll('.row').forEach(row => {
      const h = +row.dataset.h;
      const kids = row.children;
      for (let m = 0; m < 60; m++) kids[m].className = lit.has(h * 60 + m) ? 'on' : '';
    });
    const dstHours = new Set();
    for (const tr of E.transitionsBetween(tz, now, now + 365 * DAY)) {
      const ws = tr.t + Math.min(tr.before, tr.after), we = tr.t + Math.max(tr.before, tr.after);
      for (let t = ws; t < we; t += 60000) dstHours.add(Math.floor((t % DAY) / 3600000));
    }
    box.querySelectorAll('.hl').forEach(l => l.classList.toggle('dsth', dstHours.has(+l.dataset.hl)));
    const notes = [];
    if (reboot) notes.push('Startup-only jobs have no time of day.');
    else {
      const secs = models[0].seconds;
      if (models.length === 1 && secs.length > 1) notes.push(`Each lit minute runs ${secs.length} times (${secs.length > 6 ? `every ${secs[1] - secs[0]} s` : 'at ' + secs.map(s => ':' + pad(s)).join(', ')}).`);
      else if (models.length === 1 && secs[0] !== 0) notes.push(`Each lit minute runs at :${pad(secs[0])} seconds.`);
      notes.push(models.length > 1 ? 'Lit cells combine all the schedules; each one runs only on its own days.' : 'The same pattern repeats on every day it runs.');
    }
    if (dstHours.size) notes.push(`<span class="key dst"></span>Hours where ${esc(tz)} changes its clocks.`);
    $('daymap-legend').innerHTML = notes.join(' ');
    const perDay = new Set();
    if (!reboot) for (const M of models) for (const t of M.times) perDay.add(t);
    daymapDefault = reboot ? '' : `${nf.format(lit.size)} lit minute${lit.size === 1 ? '' : 's'}. Hover a cell for its time.`;
    box.setAttribute('aria-label', reboot ? 'No time of day' : `Grid of 24 hours by 60 minutes, with ${lit.size} run minutes lit.`);
    $('daymap-status').textContent = daymapDefault;
  }

  // ------------------------------------------------------------ translations

  /** Config showing where the expressions go; several lines become several entries. */
  function snippet(id, lines, tz) {
    const many = lines.length > 1;
    switch (id) {
      case 'unix':
        return `# CRON_TZ works in cronie; Debian/Ubuntu cron use the system time zone\nCRON_TZ=${tz}\n${lines.map(l => `${l}  /path/to/command`).join('\n')}`;
      case 'github':
        return `on:\n  schedule:\n${lines.map(l => tz === 'UTC' ? `    - cron: '${l}'  # UTC` : `    - cron: '${l}'\n      timezone: "${tz}"`).join('\n')}`;
      case 'k8s':
        return lines.map((l, i) => `apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: my-job${many ? '-' + (i + 1) : ''}\nspec:\n  schedule: "${l}"\n  timeZone: "${tz}"\n  jobTemplate:\n    # …`).join('\n---\n');
      case 'eventbridge':
        return lines.map((l, i) => `aws scheduler create-schedule \\\n  --name my-job${many ? '-' + (i + 1) : ''} \\\n  --schedule-expression "${l}" \\\n  --schedule-expression-timezone "${tz}" \\\n  --flexible-time-window '{"Mode": "OFF"}' \\\n  --target '{"Arn": "…", "RoleArn": "…"}'`).join('\n\n');
      case 'quartz':
        return lines.map((l, i) => `Trigger trigger${many ? i + 1 : ''} = TriggerBuilder.newTrigger()\n    .forJob(job)\n    .withSchedule(CronScheduleBuilder.cronSchedule("${l}")\n        .inTimeZone(TimeZone.getTimeZone("${tz}")))\n    .build();`).join('\n\n');
      case 'spring':
        return `${lines.map(l => `@Scheduled(cron = "${l}", zone = "${tz}")`).join('\n')}\npublic void run() { /* … */ }`;
    }
    return lines.join('\n');
  }

  function lineHtml(line, label) {
    return `<div class="line">${label ? `<span class="sched-label">${esc(label)}</span>` : ''}<span class="expr">${esc(line)}</span><button type="button" class="btn ghost small" data-copy="${esc(line)}">Copy</button></div>`;
  }

  function useButton(id, lines, tz) {
    const attrs = tz ? ` data-tz="${esc(tz)}"` : '';
    return `<button type="button" class="btn small" data-use="${id}" data-lines="${esc(JSON.stringify(lines))}"${attrs}>${lines.length > 1 ? `Use these ${lines.length}` : 'Use this'}</button>`;
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

  function utcBlock(models, tz, id, now) {
    // Group each schedule's UTC lines by offset period.
    const byOff = new Map();
    models.forEach((M, i) => {
      for (const v of E.utcVariants(M, tz, id, now)) {
        if (!byOff.has(v.off)) byOff.set(v.off, { v, lines: [], errors: [] });
        const g = byOff.get(v.off);
        if (v.error) g.errors.push(models.length > 1 ? `${schedName(i)}: ${v.error}` : v.error);
        else g.lines.push(...v.lines);
      }
    });
    let html = '';
    for (const g of byOff.values()) {
      html += `<p class="period">${esc(periodText(g.v, tz, now))}</p>`;
      html += g.lines.map(l => lineHtml(l)).join('');
      html += g.errors.map(e => `<p>${md(e)}</p>`).join('');
      if (g.lines.length && !g.errors.length) html += `<div class="line">${useButton(id, g.lines, 'UTC')}</div>`;
    }
    if (byOff.size > 1) html += `<p>A UTC schedule can't follow daylight saving. Pick one, or schedule both and skip the run that doesn't apply.</p>`;
    return html;
  }

  function renderTranslations(models, tz, now) {
    const several = models.length > 1;
    const out = [];
    for (const id of E.DIALECT_ORDER) {
      const T = D[id];
      const renders = models.map(M => E.render(M, id));
      const allOk = renders.every(r => r.ok);
      const isSelf = id === state.dialect;
      const tags = [];
      if (isSelf) tags.push(`<span class="tag">${several ? 'These expressions' : 'This expression'}</span>`);
      if (!allOk) tags.push('<span class="tag no">No exact match</span>');
      let body = '';
      const lines = [];
      renders.forEach((r, i) => {
        const label = several ? String(i + 1) : '';
        if (r.ok) {
          lines.push(...r.lines);
          body += r.lines.map(l => lineHtml(l, label)).join('');
          if (r.note) body += `<p>${several ? `${schedName(i)}: ` : ''}${md(r.note)}</p>`;
        } else {
          body += `<p>${several ? `<strong>${schedName(i)}:</strong> ` : ''}${md(r.reason)}</p>`;
          if (r.workaround) {
            const text = E.workaroundText(r.workaround, id);
            if (id === 'unix') body += `<p class="sub">Closest crontab line</p><pre class="snippet">${esc(text)}</pre>`;
            else body += `<p class="sub">Closest schedule</p>${lineHtml(r.workaround.expr, label)}<p class="sub">Then start the job with</p><pre class="snippet">${esc(text)}</pre>`;
            body += '<p>The check uses GNU <code>date</code>.</p>';
          }
        }
      });
      if (allOk) {
        if (!isSelf) body += `<div class="line">${useButton(id, lines)}</div>`;
        if (lines.length > 1 && renders.some(r => r.lines.length > 1)) body += `<p>${T.name} needs ${lines.length} schedules here; set them all up for the same job.</p>`;
        body += `<details class="snip"><summary>Where it goes</summary><pre class="snippet">${esc(snippet(id, lines, tz))}</pre></details>`;
        const utc = tz !== 'UTC' && !models[0].reboot;
        if (utc && id === 'github') {
          body += `<details class="snip"><summary>Without <code>timezone:</code> (UTC, or GitHub Enterprise Server before 3.22)</summary><div>${utcBlock(models, tz, id, now)}</div></details>`;
        } else if (utc && id === 'eventbridge') {
          body += `<details class="snip"><summary>For an EventBridge rule, which only runs in UTC</summary><div>${utcBlock(models, tz, id, now)}</div></details>`;
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
    if (r.error) { out.innerHTML = `<p class="bad">${md(r.error)}</p>`; return; }
    const notes = r.notes.slice();
    // Use the current scheduler if it can express every schedule; otherwise the first one that can.
    const order = [state.dialect, 'quartz', 'spring', 'eventbridge'].filter((x, i, a) => a.indexOf(x) === i);
    const target = order.find(id => r.models.every(M => E.render(M, id).ok));
    if (!target) {
      const why = r.models.map(M => E.render(M, state.dialect)).find(x => !x.ok);
      out.innerHTML = `<p class="bad">${md(why ? why.reason : 'No scheduler here can express that.')}</p>`;
      return;
    }
    if (target !== state.dialect) {
      notes.unshift(`${D[state.dialect].name} can't express this, so it's shown as ${D[target].name}. Translations has the ${D[state.dialect].short} workaround.`);
    }
    const lines = r.models.flatMap(M => E.render(M, target).lines);
    if (lines.length > 1) notes.unshift(`That takes ${lines.length} cron schedules, because cron can't combine those rules in one expression. They're numbered above and analyzed together.`);
    toast('');
    setExprs(lines, target);
    out.innerHTML = notes.map(n => `<p>${md(n)}</p>`).join('');
  }

  // ------------------------------------------------------------ events

  function bind() {
    const input = $('expr');
    let t = 0;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { state.exprs[0] = input.value; update(); }, 70);
    });
    ['keyup', 'click', 'focus', 'select'].forEach(ev => input.addEventListener(ev, syncCaret));
    // A text field drops line breaks, so read pasted configs here: take the expression(s),
    // the time zone and the scheduler the surrounding text implies.
    input.addEventListener('paste', e => {
      const text = e.clipboardData && e.clipboardData.getData('text/plain');
      if (!text || !/\n|cron\s*[:=(]|schedule\s*:|@Scheduled|cronSchedule|ScheduleExpression|CRON_TZ/i.test(text)) return;
      let u;
      try { u = E.unwrap(text); } catch (err) { return; }
      if (!u.core.trim() || (u.core === text && !u.tz)) return;
      e.preventDefault();
      let exprs = [u.wrapped ? `cron(${u.core.trim()})` : u.core.trim()];
      if (u.dialect === 'github') {
        const all = [...text.matchAll(/(?:^|\n)[ \t]*-?[ \t]*cron[ \t]*:[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|(\S[^\n#]*?))[ \t]*(?:#[^\n]*)?(?=\n|$)/g)]
          .map(m => (m[1] || m[2] || m[3] || '').trim()).filter(Boolean);
        if (all.length > 1) exprs = all;
      }
      const from = [];
      if (u.dialect && u.dialect !== state.dialect) from.push(D[u.dialect].name);
      if (u.tz) { state.tz = u.tz; from.push(`time zone ${u.tz}`); }
      if (exprs.length > 1) from.push(`${exprs.length} schedules`);
      toast(`${u.notes[0] || 'Read the expression from the pasted text.'}${from.length ? ` Set ${from.join(', ')}.` : ''}`);
      setExprs(exprs, u.dialect || state.dialect);
    });
    input.addEventListener('blur', () => setTimeout(syncCaret, 0));
    $('fields').addEventListener('click', e => {
      const c = e.target.closest('.chip');
      if (!c || !current) return;
      const tok = current.P.tokens[+c.dataset.i];
      if (!tok) return;
      input.focus();
      input.setSelectionRange(tok.start, tok.end);
      syncCaret();
    });
    let te = 0;
    $('extras').addEventListener('input', e => {
      const el = e.target.closest('.extra-input');
      if (!el) return;
      clearTimeout(te);
      te = setTimeout(() => { state.exprs[+el.dataset.i] = el.value; update(); }, 70);
    });
    $('add-expr').addEventListener('click', () => {
      if (state.exprs.length >= MAX_SCHEDULES) return;
      state.exprs.push('');
      update();
      const last = $('expr-' + (state.exprs.length - 1));
      if (last) last.focus();
    });
    $('copy-expr').addEventListener('click', e => copyText(state.exprs.filter(x => x.trim()).join('\n'), e.currentTarget));
    if (window.top === window && /^https?:$/.test(location.protocol)) {
      $('share').hidden = false;
      $('share').addEventListener('click', e => { save(); copyText(location.href, e.currentTarget); });
    }
    $('english-form').addEventListener('submit', onEnglish);
    $('more-runs').addEventListener('click', () => { state.runs = Math.min(200, state.runs + 30); update(); });
    const redrawCalendar = () => { if (current && current.models.length) renderCalendar(current.models, current.tz, Date.now()); };
    $('year-prev').addEventListener('click', () => { state.calStart -= 12; redrawCalendar(); });
    $('year-next').addEventListener('click', () => { state.calStart += 12; redrawCalendar(); });
    $('calendar').addEventListener('keydown', e => {
      const b = e.target.closest('button[data-date]');
      if (!b) return;
      const [y, m, d] = b.dataset.date.split('-').map(Number);
      let t = Date.UTC(y, m - 1, d);
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (step) t += step * DAY;
      else if (e.key === 'Home') t -= E.weekday(y, m, d) * DAY;
      else if (e.key === 'End') t += (6 - E.weekday(y, m, d)) * DAY;
      else if (e.key === 'PageUp' || e.key === 'PageDown') {
        const mm = new Date(Date.UTC(y, m - 1 + (e.key === 'PageDown' ? 1 : -1), 1));
        t = Date.UTC(mm.getUTCFullYear(), mm.getUTCMonth(), Math.min(d, E.daysInMonth(mm.getUTCFullYear(), mm.getUTCMonth() + 1)));
      } else return;
      e.preventDefault();
      const n = new Date(t);
      const next = $('calendar').querySelector(`button[data-date="${n.getUTCFullYear()}-${n.getUTCMonth() + 1}-${n.getUTCDate()}"]`);
      if (!next) return;
      b.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    });
    $('calendar').addEventListener('click', e => {
      const b = e.target.closest('button[data-date]');
      if (!b || !current || !current.models.length) return;
      state.sel = state.sel === b.dataset.date ? null : b.dataset.date;
      redrawCalendar();
    });
    document.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.copy != null) copyText(b.dataset.copy, b);
      else if (b.dataset.remove) {
        state.exprs.splice(+b.dataset.remove, 1);
        update();
        const prev = $('expr-' + Math.min(+b.dataset.remove, state.exprs.length - 1)) || $('expr');
        prev.focus();
      } else if (b.dataset.expr != null) {
        const i = +(b.dataset.fix || 0);
        state.exprs[i] = b.dataset.expr;
        toast('');
        setExprs(state.exprs);
        (i === 0 ? $('expr') : $('expr-' + i)).focus();
      } else if (b.dataset.read) {
        toast(`Reading the expression as ${D[b.dataset.read].name}.`);
        setExprs(state.exprs, b.dataset.read);
        $('expr').focus();
      } else if (b.dataset.use) {
        const id = b.dataset.use;
        const lines = JSON.parse(b.dataset.lines);
        if (current && current.P.ok && current.P.tz) state.tz = current.P.tz;
        if (b.dataset.tz) state.tz = b.dataset.tz;
        toast(lines.length > 1 ? `Switched to ${D[id].name} with ${lines.length} schedules.` : `Switched to ${D[id].name}.`);
        setExprs(lines, id);
        $('expr').focus();
      }
    });
    setInterval(() => {
      if (document.hidden || !current || !current.models.length) return;
      const now = Date.now();
      renderSummary(current.models, current.tz, now);
      renderRuns(current.models, current.tz, now);
    }, 30000);
  }

  function init() {
    const linked = location.hash.startsWith('#s.');
    const returning = load();
    buildDialects();
    buildTz();
    buildExamples();
    bind();
    $('expr').value = state.exprs[0];
    update();
    if (!returning && !linked) toast('This opening example hides a classic mistake; Checks explains it. Type your own expression or load another example.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
