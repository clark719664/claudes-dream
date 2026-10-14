/* Cron Almanac UI. Renders the engine's output; all schedule logic lives in engine.js. */
(function () {
  'use strict';
  const E = window.CronEngine;
  const W = window.CronWhy;
  const F = window.CronFleet;
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
    { label: 'systemd: last Monday of the month', exprs: ['Mon *-*~07/1 18:00'], d: 'systemd' },
    { label: 'GitLab: first Monday with &', exprs: ['0 9 1-7& * 1'], d: 'gitlab' },
    { label: 'Cloudflare: 1-5 isn’t Monday to Friday', exprs: ['0 9 * * 1-5'], d: 'cloudflare' },
    { label: 'Azure: seconds come first, times are UTC', exprs: ['0 30 9 * * 1-5'], d: 'azure', tz: 'Europe/Berlin' },
    { label: 'APScheduler: from_crontab() shifts weekdays', exprs: ["CronTrigger.from_crontab('0 9 * * 1-5')"], d: 'apscheduler' },
  ];

  // exprs[0] is the main expression; the rest are extra schedules that run the same job.
  const state = {
    exprs: ['0 9 1-7 * 1'], dialect: 'unix', tz: browserTz, calStart: null, runs: 12, sel: null,
    why: { at: '', zone: 'schedule', edited: false, shown: false },
  };
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
    if (D[state.dialect].utcOnly) return 'UTC';
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
      let zoneNote = '';
      if (D[state.dialect].utcOnly && !T.utcOnly && state.tz !== 'UTC') {
        state.tz = 'UTC';
        zoneNote = ' The times were UTC, so the time zone is now UTC.';
      }
      const out = [];
      const problems = [];
      let split = 0;
      const tz = effTz(list[0]);
      const toUtc = T.utcOnly && tz !== 'UTC' && !list[0].reboot;
      let utcNote = '';
      list.forEach((P, i) => {
        if (!P.ok) { out.push(state.exprs[i]); return; }
        if (toUtc) {
          const now = Date.now();
          const v = E.utcVariants(P, tz, id, now).find(x => x.periods.some(p => p.from <= now && now < p.to));
          if (v && v.lines) {
            out.push(...v.lines);
            utcNote = ` ${T.name} runs in UTC, so the times were converted for ${tz}'s current offset (${E.fmtOffset(v.off)}); Translations shows every offset.`;
            return;
          }
        }
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
      toast(msg + utcNote + zoneNote);
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
      if (sp.type === 'L') return sp.offset ? `${E.ordinal(sp.offset + 1)}-to-last day` : 'last day';
      if (sp.type === 'fromEnd') return sp.offsets[0] === 0 && E.runsOf(sp.offsets).length === 1 ? `last ${sp.offsets.length} days` : 'days before month end';
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
    const toks = P.tokens || [];
    const min = T.fields.filter(f => !f.endsWith('?')).length;
    const names = E.kindsFor(T, Math.min(Math.max(toks.length, min), T.fields.length));
    const chips = [];
    const chip = (label, token, mean, cls, idx) =>
      `<li><button type="button" class="chip ${cls || ''}" data-i="${idx}"><span class="f-label">${esc(label)}</span><span class="f-token">${esc(token)}</span><span class="f-mean">${esc(mean || ' ')}</span></button></li>`;
    if (P.chips) {
      P.chips.forEach((c, i) => {
        let mean = '', cls = c.implied ? 'implied' : '';
        if (c.kind === 'shortcut') mean = `= ${P.macroExpansion}`;
        else if (P.ok && c.field) mean = chipMeaning(c.field) + (c.implied ? ' (default)' : '');
        if (!P.ok && P.error.field === i) { cls += ' bad'; mean = 'see below'; }
        chips.push(chip(c.label, c.token, mean, cls, i));
      });
    } else if (P.ok && P.macro) {
      chips.push(chip('shortcut', P.macro, P.reboot ? 'at startup' : `= ${P.macroExpansion}`, '', 0));
    } else {
      const n = Math.max(toks.length, names.length);
      for (let i = 0; i < n; i++) {
        const kind = names[i];
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
    const long = !!D[state.dialect].custom;
    input.classList.toggle('long', long);
    document.querySelectorAll('.extra-input').forEach(x => x.classList.toggle('long', long));
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
    renderWhy(models, tz, now);
    save();
  }

  const TZ_HINT = {
    github: 'GitHub uses UTC unless the workflow sets its timezone key.',
    gitlab: 'Each GitLab pipeline schedule has its own Cron timezone setting.',
    eventbridge: 'Rules always use UTC; EventBridge Scheduler can use this zone.',
    azure: 'Azure uses UTC unless the app setting WEBSITE_TIME_ZONE is set.',
    systemd: 'systemd uses the machine’s time zone unless the expression ends with one.',
    apscheduler: 'APScheduler uses the scheduler’s time zone unless the trigger sets timezone=.',
  };

  function renderTz(P, tz, now) {
    const sel = $('tz');
    const T = D[state.dialect];
    ensureTzOption(tz);
    sel.disabled = !!(P.ok && P.tz) || !!T.utcOnly;
    const p = E.displayParts(now, tz);
    let hint = `Now ${p.hour}:${p.minute} ${p.timeZoneName} (${E.fmtOffset(E.offsetAt(now, tz))}).`;
    if (T.utcOnly) hint = `${T.name} always runs in UTC. ` + hint;
    else if (P.ok && P.tzInline) hint = 'Set by the time zone at the end of the expression. ' + hint;
    else if (P.ok && P.tz) hint = `Set by ${P.tzSource.replace(/`/g, '')} in the pasted text. ` + hint;
    else if (TZ_HINT[state.dialect]) hint += ' ' + TZ_HINT[state.dialect];
    $('tz-hint').textContent = hint;
  }

  function renderError(P) {
    const el = $('error');
    const actions = [];
    const fx = P.error.fix;
    if (fx && fx.exprs) actions.push(`<button type="button" class="btn small" data-fix="0" data-exprs="${esc(JSON.stringify(fx.exprs))}">${esc(fx.label)}</button>`);
    else if (fx) actions.push(`<button type="button" class="btn small" data-fix="0" data-expr="${esc(fx.expr)}">${esc(fx.label)}</button>`);
    const cronLike = /^\s*\S+(\s+\S+){4,6}\s*$/.test(state.exprs[0]) && !/[=(]/.test(state.exprs[0]);
    for (const id of E.DIALECT_ORDER) {
      if (id === state.dialect || actions.length >= 4 || (cronLike && D[id].custom)) continue;
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
  const PLATFORM_CHECKS = new Set(['gh-notes', 'gh-timezone', 'k8s-tz', 'k8s-crontz', 'eb-utc', 'unix-crontz', 'gl-worker', 'gl-timezone',
    'cf-utc', 'cf-or-source', 'az-timezone', 'az-single', 'aps-timezone', 'aps-misfire', 'sd-timezone', 'sd-timer']);

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
    const wdNum = i => (T.dow.monday0 ? (i + 6) % 7 : T.dow.min === 1 ? i + 1 : i);
    const numbered = T.family !== 'systemd';
    const inWindow = key => {
      const [ky, km] = key.split('-').map(Number);
      const k = ky * 12 + km - 1;
      return k >= start && k < start + 12;
    };
    const focusKey = state.sel && inWindow(state.sel) ? state.sel : inWindow(todayKey) ? todayKey : `${first.y}-${first.m}-1`;
    const head = DOW_SHORT.map((n, i) => (numbered
      ? `<span class="wd" title="${E.DOW_LONG[i]} is ${wdNum(i)} in ${esc(T.name)}">${n[0]}<small>${wdNum(i)}</small></span>`
      : `<span class="wd" title="${E.DOW_LONG[i]}">${n[0]}</span>`)).join('');
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
    if (!hits.length) { el.innerHTML = `<strong>${esc(label)}</strong>: no runs. <button type="button" class="linkish" data-why="${state.sel}">Why not?</button>`; return; }
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
    html += ` <button type="button" class="linkish" data-why="${state.sel}">Why did or didn't it run that day?</button>`;
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
      case 'systemd':
        return `# /etc/systemd/system/my-job.timer (runs my-job.service)\n[Unit]\nDescription=Run my-job on a schedule\n\n[Timer]\n${lines.map(l => `OnCalendar=${l} ${tz}`).join('\n')}\n# Run a start that was missed while the machine was off\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n\n# Check the next runs:\n# systemd-analyze calendar --iterations=5 '${lines[0]} ${tz}'`;
      case 'gitlab':
        return `# Build › Pipeline schedules in the project, or the API:\n${lines.map((l, i) => `curl --request POST --header "PRIVATE-TOKEN: <token>" \\\n  --form description="My job${many ? ' ' + (i + 1) : ''}" --form ref="main" \\\n  --form cron="${l}" --form cron_timezone="${tz}" \\\n  "https://gitlab.example.com/api/v4/projects/<id>/pipeline_schedules"`).join('\n\n')}\n\n# .gitlab-ci.yml: run a job only in scheduled pipelines\nmy-job:\n  rules:\n    - if: $CI_PIPELINE_SOURCE == "schedule"`;
      case 'cloudflare':
        return `# wrangler.toml — Cron Triggers run in UTC\n[triggers]\ncrons = [${lines.map(l => `"${l}"`).join(', ')}]`;
      case 'azure':
        return `// C#, isolated worker model\n${lines.map((l, i) => `[Function("MyJob${many ? i + 1 : ''}")]\npublic void Run${many ? i + 1 : ''}([TimerTrigger("${l}")] TimerInfo timer) { /* … */ }`).join('\n\n')}\n\n${tz === 'UTC' ? '# Times are UTC unless the app setting WEBSITE_TIME_ZONE is set.' : `# App setting: a tz database name on Linux, a Windows zone name on Windows.\n# Not supported on Linux Consumption or Flex Consumption plans.\nWEBSITE_TIME_ZONE=${tz}`}`;
      case 'apscheduler':
        if (!many) return `scheduler.add_job(my_job, 'cron', ${lines[0]}, timezone='${tz}')`;
        return `from apscheduler.triggers.combining import OrTrigger\nfrom apscheduler.triggers.cron import CronTrigger\n\ntrigger = OrTrigger([\n${lines.map(l => `    CronTrigger(${l}, timezone='${tz}'),`).join('\n')}\n])\nscheduler.add_job(my_job, trigger)`;
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
      if (T.utcOnly && tz !== 'UTC' && !models[0].reboot) {
        const tagU = id === state.dialect ? `<span class="tag">${several ? 'These expressions' : 'This expression'}</span>` : '';
        out.push(`<div class="tr"><div class="tr-name"><strong>${esc(T.name)}</strong>${tagU}</div><div class="tr-body"><p>${esc(T.name)} runs in UTC, so the times shift.</p>${utcBlock(models, tz, id, now)}</div></div>`);
        continue;
      }
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

  // ------------------------------------------------------------ why didn't it run?

  const isoLocal = w => `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`;

  function whyZone(tz) {
    return state.why.zone === 'local' ? browserTz : state.why.zone === 'utc' ? 'UTC' : tz;
  }

  function renderWhy(models, tz, now) {
    const sel = $('why-zone');
    const opts = [['schedule', `${tz} (the schedule's)`]];
    if (browserTz !== tz) opts.push(['local', `${browserTz} (yours)`]);
    if (tz !== 'UTC' && browserTz !== 'UTC') opts.push(['utc', 'UTC']);
    if (!opts.some(o => o[0] === state.why.zone)) state.why.zone = 'schedule';
    sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
    sel.value = state.why.zone;
    const off = models[0].reboot;
    $('why-form').hidden = off;
    if (off) { $('why-out').innerHTML = '<p class="why-note">A startup-only job has no times to check.</p>'; return; }
    if (!state.why.edited) {
      // Default to the most recent run, which is usually the one someone is asking about.
      const prev = W.previousRun(models, tz, now) || E.upcomingSet(models, tz, now, 1).runs[0];
      state.why.at = isoLocal(prev ? E.wallParts(prev.t, whyZone(tz)) : E.wallParts(now, whyZone(tz)));
    }
    const input = $('why-at');
    if (document.activeElement !== input) input.value = state.why.at;
    if (state.why.shown) renderWhyResult(models, tz);
    else $('why-out').innerHTML = '';
  }

  function whenText(t, tz, ref) {
    const p = E.displayParts(t, tz);
    const delta = Math.round((t - ref) / 1000);
    const rel = delta === 0 ? 'the same moment' : `${E.fmtDuration(Math.abs(delta))} ${delta < 0 ? 'earlier' : 'later'}`;
    return `${p.weekday} ${p.day} ${p.month} ${p.year} at ${p.hour}:${p.minute} (${rel})`;
  }

  function renderWhyResult(models, tz) {
    const out = $('why-out');
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(state.why.at || '');
    if (!m) { out.innerHTML = '<p class="why-note">Pick a date and time.</p>'; return; }
    const wall = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
    const r = W.explain({ P: current.P, models, tz, wall, zone: whyZone(tz), localTz: browserTz });
    if (!r) { out.innerHTML = ''; return; }
    const cls = r.uncertain ? 'maybe' : r.scheduled ? 'yes' : 'no';
    let html = `<p class="why-head ${cls}">${md(r.headline)}</p>`;
    html += r.notes.map(n => `<p class="why-note">${md(n)}</p>`).join('');
    if (r.dst) html += `<p class="why-dst">${md(r.dst)}</p>`;
    html += r.hints.map(h => `<p class="why-hint">${md(h)}</p>`).join('');
    r.schedules.forEach(x => {
      const rows = x.rows.map(row => `<tr class="${row.info ? '' : row.ok ? 'hit' : 'miss'}"><td>${esc(row.field)}</td><td class="v">${esc(row.value)}</td><td>${md(row.wants)}</td><td class="r">${row.info ? '' : row.ok ? '✓ match' : '✗ no match'}</td></tr>`).join('');
      html += `<div class="table-scroll"><table class="why-table">${models.length > 1 ? `<caption>${schedName(x.i)}</caption>` : ''}<thead><tr><th scope="col">Field</th><th scope="col">That moment</th><th scope="col">The schedule wants</th><th scope="col"><span class="sr-only">Result</span></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    });
    const near = [];
    if (r.prev) near.push(`Previous run: ${whenText(r.prev.t, tz, r.t)}`);
    if (r.next) near.push(`next run: ${whenText(r.next.t, tz, r.t)}`);
    if (near.length) html += `<p class="why-near">${esc(near.join('; '))}.</p>`;
    if (r.checklist.length && (r.scheduled || r.uncertain)) {
      html += `<p class="why-sub">If it still didn't run, check</p><ul class="why-list">${r.checklist.map(c => `<li><strong>${md(c.title)}</strong> ${md(c.body)}</li>`).join('')}</ul>`;
    }
    out.innerHTML = html;
  }

  // ------------------------------------------------------------ all my jobs

  const JOBS_KEY = 'cron-almanac-jobs';
  const fleet = { jobs: [], analysis: null, plan: [], rewritten: null, dialect: 'unix', tz: browserTz, frequent: false, built: false };

  function setMode(mode, focus) {
    const all = mode === 'all';
    $('single').hidden = all;
    $('fleet').hidden = !all;
    $('tab-one').setAttribute('aria-selected', String(!all));
    $('tab-all').setAttribute('aria-selected', String(all));
    $('tab-one').tabIndex = all ? -1 : 0;
    $('tab-all').tabIndex = all ? 0 : -1;
    try { localStorage.setItem(STORE_KEY + '-mode', mode); } catch (e) { /* storage unavailable */ }
    if (all && window.top === window) {
      try { history.replaceState(null, '', '#jobs'); } catch (e) { /* ignore */ }
    }
    if (all) {
      buildFleet();
      runFleet();
      if (focus) $('fleet-text').focus();
    } else if (current) update();
  }

  function buildFleet() {
    if (fleet.built) return;
    fleet.built = true;
    fleet.dialect = state.dialect;
    fleet.tz = state.tz;
    $('fleet-dialect').innerHTML = E.DIALECT_ORDER.map(id => `<option value="${id}">${esc(D[id].name)}</option>`).join('');
    $('fleet-dialect').value = fleet.dialect;
    $('fleet-tz').innerHTML = $('tz').innerHTML;
    $('fleet-tz').disabled = false;
    $('fleet-tz').value = fleet.tz;
    let saved = '';
    try { saved = sessionStorage.getItem(JOBS_KEY) || ''; } catch (e) { saved = ''; }
    $('fleet-text').value = saved;
    let t = 0;
    $('fleet-text').addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        try { sessionStorage.setItem(JOBS_KEY, $('fleet-text').value); } catch (e) { /* storage unavailable */ }
        runFleet();
      }, 250);
    });
    $('fleet-dialect').addEventListener('change', () => { fleet.dialect = $('fleet-dialect').value; runFleet(); });
    $('fleet-tz').addEventListener('change', () => { fleet.tz = $('fleet-tz').value; runFleet(); });
    $('fleet-example').addEventListener('click', () => {
      $('fleet-text').value = F.EXAMPLE;
      fleet.dialect = 'unix';
      $('fleet-dialect').value = 'unix';
      try { sessionStorage.setItem(JOBS_KEY, F.EXAMPLE); } catch (e) { /* storage unavailable */ }
      runFleet();
    });
    $('heat-frequent').addEventListener('change', () => { fleet.frequent = $('heat-frequent').checked; renderHeat(); });
    buildHeat();
  }

  const FORMAT_NAME = {
    crontab: 'a crontab', lines: 'one schedule per line', json: 'JSON', k8s: 'Kubernetes CronJobs', github: 'GitHub workflows',
    systemd: 'systemd timers', cloudflare: 'a Wrangler config', code: 'source code',
  };

  function runFleet() {
    const text = $('fleet-text').value;
    const parsed = F.parseJobs(text, { dialect: fleet.dialect });
    fleet.jobs = parsed.jobs;
    const status = $('fleet-status');
    if (!parsed.jobs.length) {
      $('fleet-results').hidden = true;
      status.innerHTML = text.trim() ? md(parsed.notes[0] || 'No schedules found. Check “Read plain lines as”, or paste one of the formats above.') : '';
      return;
    }
    const readable = parsed.jobs.filter(j => j.P.ok);
    if (!readable.length) {
      $('fleet-results').hidden = true;
      const first = parsed.jobs[0];
      status.innerHTML = md(`None of the ${parsed.jobs.length === 1 ? 'lines' : `${parsed.jobs.length} lines`} could be read as ${D[fleet.dialect].name}. Line ${first.line || 1}: ${first.P.error.message} Check “Read plain lines as”, or paste one of the formats above.`);
      return;
    }
    const now = Date.now();
    fleet.analysis = F.analyze(parsed.jobs, { tz: fleet.tz, now });
    fleet.plan = F.spread(parsed.jobs, fleet.analysis);
    fleet.rewritten = F.rewrite(text, parsed.jobs, fleet.plan);
    const bad = fleet.analysis.totals.errors;
    status.innerHTML = md(`Read ${parsed.jobs.length} job${parsed.jobs.length === 1 ? '' : 's'} from ${FORMAT_NAME[parsed.format] || 'the text'}${bad ? `; ${bad} couldn't be read` : ''}.${parsed.notes.length ? ' ' + parsed.notes.join(' ') : ''}`);
    $('fleet-results').hidden = false;
    renderFleetStats(now);
    renderHeat();
    renderCollisions();
    renderFlags();
    renderFleetTable(now);
  }

  function renderFleetStats(now) {
    const a = fleet.analysis, t = a.totals;
    const top = a.collisions[0];
    const items = [
      ['Jobs', `${nf.format(t.jobs)}<small>${t.disabled ? `${t.disabled} turned off` : t.errors ? `${t.errors} unreadable` : 'all readable'}</small>`],
      ['Runs a week', `${nf.format(t.weekRuns)}<small>about ${nf.format(Math.round(t.weekRuns / 7))} a day</small>`],
      ['Busiest hour', a.busiest ? `${nf.format(a.busiest.runs)} runs<small>${esc(cellLabel(a.busiest.cell))}</small>` : '—'],
      ['Biggest pile-up', top ? `${top.max} jobs<small>at ${top.time}</small>` : 'none'],
      ['Need a look', `${nf.format(t.warnings)}<small>job${t.warnings === 1 ? '' : 's'} with warnings</small>`],
    ];
    $('fleet-stats').innerHTML = items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  }

  function cellDate(k) {
    const d = new Date(fleet.analysis.startWall + Math.floor(k / 24) * DAY);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay() };
  }
  function cellLabel(k) {
    const c = cellDate(k), h = k % 24;
    return `${DOW_SHORT[c.wd]} ${c.d} ${E.MON_SHORT[c.m - 1]}, ${pad(h)}:00`;
  }

  function buildHeat() {
    const box = $('heat');
    box.addEventListener('pointerover', e => {
      const cell = e.target.closest('i[data-c]');
      if (!cell || !fleet.analysis) return;
      $('heat-status').textContent = heatText(+cell.dataset.c);
    });
    box.addEventListener('pointerleave', () => { $('heat-status').textContent = ''; });
  }

  function heatText(k) {
    const c = fleet.analysis.heat[k];
    const n = fleet.frequent ? c.runs : c.core;
    const names = [...c.jobs].filter(i => fleet.frequent || !fleet.analysis.rows[i].frequent).map(i => fleet.jobs[i].name);
    if (!n) return `${cellLabel(k)}: no runs`;
    return `${cellLabel(k)}–${pad(k % 24)}:59: ${nf.format(n)} run${n === 1 ? '' : 's'} from ${names.length} job${names.length === 1 ? '' : 's'} (${names.slice(0, 4).join(', ')}${names.length > 4 ? ', …' : ''})`;
  }

  function renderHeat() {
    const a = fleet.analysis;
    if (!a) return;
    const val = c => (fleet.frequent ? c.runs : c.core);
    const max = Math.max(0, ...a.heat.map(val));
    const level = n => (!n ? 0 : max <= 1 ? 3 : Math.max(1, Math.min(5, 1 + Math.round(4 * Math.log(n) / Math.log(max)))));
    let html = '<span></span>';
    for (let h = 0; h < 24; h++) html += `<span class="hd">${h % 3 === 0 ? pad(h) : ''}</span>`;
    for (let d = 0; d < a.days; d++) {
      const c = cellDate(d * 24);
      html += `<span class="dl">${d === 0 ? 'Today' : DOW_SHORT[c.wd]} <small>${c.d}</small></span>`;
      for (let h = 0; h < 24; h++) {
        const k = d * 24 + h;
        html += `<i class="q${level(val(a.heat[k]))}" data-c="${k}" title="${esc(heatText(k))}"></i>`;
      }
    }
    $('heat').innerHTML = html;
    const steps = [1, 2, 3, 4, 5].map(q => `<span class="key q${q}"></span>`).join('');
    $('heat-legend').innerHTML = `Runs per hour <span class="key q0"></span>0 ${steps} ${nf.format(max)} <span class="tz">${esc(a.tz)}</span>`;
    const order = a.heat.map((c, k) => ({ k, n: val(c) })).filter(x => x.n).sort((x, y) => y.n - x.n).slice(0, 3);
    const busy = order.length ? `Busiest: ${order.map(x => `${cellLabel(x.k)} (${nf.format(x.n)})`).join('; ')}.` : 'No runs in the next 7 days.';
    $('heat-busiest').textContent = busy;
    $('heat').setAttribute('aria-label', `Grid of 7 days by 24 hours showing how many runs start in each hour. ${busy}`);
  }

  function openJob(i) {
    const j = fleet.jobs[i];
    const zone = fleet.analysis.rows[i].zone;
    if (zone && !D[j.dialect].utcOnly) state.tz = zone;
    state.calStart = null;
    toast(`Opened “${j.name}”.`);
    setExprs([j.expr], j.dialect);
    setMode('one');
    $('expr').focus();
  }

  function renderCollisions() {
    const a = fleet.analysis;
    const box = $('fleet-collisions');
    if (!a.collisions.length) {
      box.innerHTML = '<p class="panel-intro">No two jobs start in the same minute in the next 7 days.</p>';
      return;
    }
    const name = i => esc(fleet.jobs[i].name);
    let html = '<ul class="piles">' + a.collisions.slice(0, 6).map(g =>
      `<li><span class="pile-time">${g.time}</span><span>Up to <strong>${g.max} jobs</strong> together, on ${g.days} day${g.days === 1 ? '' : 's'} of the next 7: ${g.jobs.map(name).join(', ')}</span></li>`).join('') + '</ul>';
    if (a.collisions.length > 6) html += `<p class="panel-intro">And ${a.collisions.length - 6} more times.</p>`;
    if (fleet.plan.length) {
      html += '<p class="why-sub">Stagger them</p><p class="panel-intro">Each pile-up keeps its first job; the others move to quiet minutes later in the same hour.</p><ul class="moves">';
      for (const g of fleet.plan) {
        for (const mv of g.moves) {
          html += `<li><span class="move-name">${esc(mv.name)}</span><span class="expr">${esc(mv.from)}</span><span aria-hidden="true">→</span><span class="sr-only">becomes</span><span class="expr">${esc(mv.to)}</span></li>`;
        }
      }
      html += '</ul>';
      if (fleet.rewritten) html += `<button type="button" class="btn small" data-copy="${esc(fleet.rewritten)}">Copy the updated text</button>`;
    }
    box.innerHTML = html;
  }

  function renderFlags() {
    const a = fleet.analysis;
    const items = [];
    const open = i => `<button type="button" class="btn ghost small" data-open="${i}">Open</button>`;
    for (const r of a.rows) {
      const j = r.job;
      if (r.error) items.push({ level: 'error', title: `${j.name} can't be read`, body: `\`${j.schedule.length > 60 ? j.schedule.slice(0, 59) + '…' : j.schedule}\`: ${r.error}`, i: r.i });
    }
    const freq = a.rows.filter(r => r.frequent);
    if (freq.length) {
      items.push({
        level: 'info', title: `${freq.length} frequent job${freq.length === 1 ? '' : 's'}`,
        body: freq.map(r => `**${r.job.name}** every ${E.fmtDuration(r.stats.minGap)}`).join('; ') + '. They are left out of the pile-ups, and out of the chart unless you include them.',
      });
    }
    for (const r of a.rows) {
      if (r.error || r.reboot) continue;
      const p = r.problems.filter(x => x.id !== 'dst');
      if (!p.length) continue;
      items.push({ level: p.some(x => x.level === 'error') ? 'error' : 'warn', title: r.job.name, body: p.map(x => x.title).join('; ') + '.', i: r.i });
    }
    // Clock changes: one note for all the jobs they touch; a warning when a once-a-day-or-rarer job is hit.
    const dst = a.rows.filter(r => r.dst && !r.job.disabled);
    if (dst.length) {
      const fixed = dst.filter(r => !r.frequent && r.stats && r.stats.minGap >= 3600);
      items.push({
        level: fixed.length ? 'warn' : 'info',
        title: `Clock changes affect ${dst.length} job${dst.length === 1 ? '' : 's'}`,
        body: `In the next year, daylight saving time skips or repeats a run of ${dst.map(r => `**${r.job.name}**`).join(', ')}. ${fixed.length ? `For ${fixed.map(r => r.job.name).join(', ')} that means a missed or doubled run on those days. ` : ''}Open a job to see the dates and what its scheduler does.`,
        i: fixed.length === 1 ? fixed[0].i : null,
      });
    }
    for (const r of a.rows) if (r.job.disabled) items.push({ level: 'info', title: `${r.job.name} is turned off`, body: 'It is suspended, inactive or disabled, so it is left out of the chart and pile-ups.', i: r.i });
    if (!items.length) items.push({ level: 'ok', title: 'Nothing stands out', body: 'No warnings, no unreadable lines and no very frequent jobs.' });
    const label = { error: 'Error', warn: 'Warning', info: 'Note', ok: 'OK' };
    const order = { error: 0, warn: 1, info: 2, ok: 3 };
    items.sort((x, y) => order[x.level] - order[y.level]);
    $('fleet-flags').innerHTML = items.map(c => `
      <article class="check">
        <header><span class="sev ${c.level}">${label[c.level]}</span><h3>${md(c.title)}</h3></header>
        <p>${md(c.body)}</p>
        ${c.i != null ? open(c.i) : ''}
      </article>`).join('');
  }

  function renderFleetTable(now) {
    const a = fleet.analysis;
    const rows = a.rows.map(r => {
      const j = r.job;
      const expr = j.schedule.length > 40 ? j.schedule.slice(0, 39) + '…' : j.schedule;
      let next = '—', perWeek = '—', issues = '';
      if (r.error) issues = '<span class="sev error">Error</span>';
      else if (r.reboot) next = 'at startup';
      else {
        if (r.next && !j.disabled) { const p = E.displayParts(r.next.t, fleet.tz); next = `${p.weekday} ${p.day} ${p.month} ${p.hour}:${p.minute}<small>${esc(relTime(r.next.t - now))}</small>`; }
        if (j.disabled) next = 'turned off';
        perWeek = nf.format(r.weekRuns);
        if (r.worst !== 'ok') issues = `<span class="sev ${r.worst}">${r.problems.length} ${r.worst === 'error' ? 'error' : 'warning'}${r.problems.length === 1 ? '' : 's'}</span>`;
      }
      return `<tr${r.error ? ' class="bad"' : ''}><td class="name">${esc(j.name)}</td><td class="t">${esc(expr)}</td><td>${esc(D[j.dialect].short)}</td><td class="rel">${esc(r.zone || '')}</td><td class="next">${next}</td><td class="num">${perWeek}</td><td>${issues}</td><td><button type="button" class="btn ghost small" data-open="${r.i}" aria-label="Open ${esc(j.name)}">Open</button></td></tr>`;
    });
    $('fleet-table').innerHTML = `<thead><tr><th scope="col">Job</th><th scope="col">Schedule</th><th scope="col">Scheduler</th><th scope="col">Zone</th><th scope="col">Next run (${esc(fleet.tz)})</th><th scope="col">This week</th><th scope="col">Checks</th><th scope="col"><span class="sr-only">Open</span></th></tr></thead><tbody>${rows.join('')}</tbody>`;
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
      if (!text || !/\n|cron\s*[:=(]|schedule\s*:|@Scheduled|cronSchedule|ScheduleExpression|CRON_TZ|OnCalendar|crons|TimerTrigger|CronTrigger|add_job|scheduled_job|cron_timezone|WEBSITE_TIME_ZONE/i.test(text)) return;
      let u;
      try { u = E.unwrap(text); } catch (err) { return; }
      if (!u.core.trim() || (u.core === text && !u.tz)) return;
      e.preventDefault();
      // A text field can't hold line breaks, so a multi-line call (APScheduler) is joined into one line.
      let exprs = [u.wrapped ? `cron(${u.core.trim()})` : u.core.trim().replace(/\s*\n\s*/g, ' ').replace(/\(\s+/g, '(').replace(/,?\s*\)$/, ')')];
      let all = [];
      if (u.dialect === 'github') {
        all = [...text.matchAll(/(?:^|\n)[ \t]*-?[ \t]*cron[ \t]*:[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|(\S[^\n#]*?))[ \t]*(?:#[^\n]*)?(?=\n|$)/g)]
          .map(m => (m[1] || m[2] || m[3] || '').trim()).filter(Boolean);
      } else if (u.dialect === 'cloudflare') {
        const list = /\bcrons['"]?\s*[=:]\s*\[([^\]]*)\]/.exec(text);
        if (list) all = [...list[1].matchAll(/["']([^"']*)["']/g)].map(m => m[1].trim()).filter(Boolean);
      } else if (u.dialect === 'systemd') {
        // An empty OnCalendar= clears the ones before it, as in systemd.
        for (const m of text.matchAll(/(?:^|\n)[ \t]*OnCalendar[ \t]*=[ \t]*([^\n]*)/g)) {
          const v = m[1].trim();
          if (v) all.push(v); else all = [];
        }
      }
      if (all.length > 1) exprs = all.slice(0, MAX_SCHEDULES);
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
    $('tab-one').addEventListener('click', () => setMode('one'));
    $('tab-all').addEventListener('click', () => setMode('all', true));
    document.querySelector('.modes').addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const next = $('tab-one').getAttribute('aria-selected') === 'true' ? 'all' : 'one';
      setMode(next);
      $(next === 'all' ? 'tab-all' : 'tab-one').focus();
      e.preventDefault();
    });
    $('why-form').addEventListener('submit', e => {
      e.preventDefault();
      state.why.at = $('why-at').value;
      state.why.edited = true;
      state.why.shown = true;
      if (current && current.models.length) renderWhyResult(current.models, current.tz);
    });
    $('why-at').addEventListener('change', () => { state.why.at = $('why-at').value; state.why.edited = true; });
    $('why-zone').addEventListener('change', () => {
      // Keep the same moment, shown on the newly chosen clock.
      const before = whyZone(current.tz);
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec($('why-at').value);
      state.why.zone = $('why-zone').value;
      if (m && current) {
        const t = W.instantsOf({ y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] }, before);
        const at = t.ts.length ? t.ts[0] : t.gap ? t.gap.t : null;
        if (at != null) { state.why.at = isoLocal(E.wallParts(at, whyZone(current.tz))); $('why-at').value = state.why.at; }
      }
      if (state.why.shown && current && current.models.length) renderWhyResult(current.models, current.tz);
    });
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
      else if (b.dataset.open != null) openJob(+b.dataset.open);
      else if (b.dataset.why) {
        // From the calendar: check that day at its first run time, or at the time already entered.
        const [y, m, d] = b.dataset.why.split('-').map(Number);
        const M = current.models.find(x => E.dayMatches(x, y, m, d));
        const time = M ? E.fmtClock(M.times[0]) : (state.why.at.split('T')[1] || '09:00');
        state.why.zone = 'schedule';
        state.why.at = `${y}-${pad(m)}-${pad(d)}T${time}`;
        state.why.edited = true;
        state.why.shown = true;
        renderWhy(current.models, current.tz, Date.now());
        $('why-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      else if (b.dataset.remove) {
        state.exprs.splice(+b.dataset.remove, 1);
        update();
        const prev = $('expr-' + Math.min(+b.dataset.remove, state.exprs.length - 1)) || $('expr');
        prev.focus();
      } else if (b.dataset.exprs != null) {
        const i = +(b.dataset.fix || 0);
        const parts = JSON.parse(b.dataset.exprs);
        state.exprs.splice(i, 1, ...parts);
        toast(`Split into ${parts.length} schedules that run the same job.`);
        setExprs(state.exprs);
        $('expr').focus();
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
    const wantJobs = location.hash === '#jobs';
    const returning = load();
    buildDialects();
    buildTz();
    buildExamples();
    bind();
    $('expr').value = state.exprs[0];
    update();
    let mode = 'one';
    try { mode = localStorage.getItem(STORE_KEY + '-mode') || 'one'; } catch (e) { mode = 'one'; }
    if (wantJobs) mode = 'all';
    else if (linked) mode = 'one';
    if (mode === 'all') setMode('all');
    if (!returning && !linked) toast('This opening example hides a classic mistake; Checks explains it. Type your own expression or load another example.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
