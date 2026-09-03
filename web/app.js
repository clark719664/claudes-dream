/*
 * Reverie dashboard — core.
 *
 * DOM helpers (everything is built with textContent, so citizen-written text
 * can never become markup), the API client, header and simulation controls,
 * the tab framework, the SSE stream with a polling fallback, and the live
 * event ticker. The other scripts (map.js, panels*.js, drawer.js) register
 * themselves on the global `R` namespace defined here.
 */
(function () {
  'use strict';
  const R = (window.R = {});
  const $ = (sel) => document.querySelector(sel);

  // ------------------------------------------------------------ DOM helpers

  /** h('div', { class: 'x', onclick: fn }, 'text', node, [more]) */
  R.h = function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    applyAttrs(el, attrs);
    R.append(el, children);
    return el;
  };

  /** Same as h() but in the SVG namespace. */
  R.svg = function svg(tag, attrs, ...children) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    applyAttrs(el, attrs);
    R.append(el, children);
    return el;
  };

  function applyAttrs(el, attrs) {
    if (!attrs) return;
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }

  R.append = function append(el, children) {
    for (const c of children) {
      if (c === null || c === undefined || c === false || c === '') continue;
      if (Array.isArray(c)) append(el, c);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    }
    return el;
  };

  R.clear = function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  };

  R.replace = function replace(el, ...children) {
    R.clear(el);
    return R.append(el, children);
  };

  // ------------------------------------------------------------- formatting

  R.fmt = function fmt(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    const r = Math.round(n);
    const digits = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (r < 0 ? '−' : '') + digits;
  };
  R.lumens = (n) => R.fmt(n) + ' ℓ';
  R.signed = (n) => (n > 0 ? '+' : '') + R.fmt(n);
  R.pct = (x, d = 0) => (x === null || x === undefined || Number.isNaN(x) ? '—' : (x * 100).toFixed(d) + '%');
  R.pad2 = (n) => String(n).padStart(2, '0');
  R.clockText = (day, hour) => `Day ${day}, ${R.pad2(hour)}:00`;
  R.whenText = (tick) => `d${Math.floor(tick / 24)} ${R.pad2(tick % 24)}:00`;
  R.dayText = (day) => (day === null || day === undefined ? '—' : `day ${day}`);
  R.titleCase = (s) => String(s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  R.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  R.districtName = (id) => (R.map && R.map.districtName(id)) || R.titleCase(id);

  // ------------------------------------------------------------- components

  R.pill = function pill(text, cls) {
    return R.h('span', { class: `pill ${cls || text}` }, text);
  };

  R.standingPill = (standing) => R.pill(standing, standing);

  /** What kind of mind this is: Claude, an external agent, an unclaimed child, or a scripted founder. */
  R.brainBadge = function brainBadge(brain) {
    if (brain === 'llm') return R.h('span', { class: 'badge llm', title: 'Driven by Claude' }, 'Claude');
    if (brain === 'remote') return R.h('span', { class: 'badge remote', title: 'External agent over HTTP' }, 'remote');
    if (brain === 'child') return R.h('span', { class: 'badge child', title: 'Born here and unclaimed: it lives on the child instinct until someone claims it' }, 'unclaimed');
    if (brain === 'reflex') return R.h('span', { class: 'badge founder', title: 'A scripted mind seeded to demonstrate the city' }, 'scripted founder');
    return null;
  };

  R.brainName = function brainName(brain) {
    if (brain === 'llm') return 'Claude';
    if (brain === 'reflex') return 'scripted founder';
    if (brain === 'child') return 'unclaimed child';
    if (brain === 'remote') return 'agent';
    return brain;
  };

  R.officeLabel = (office) => (office ? R.pill(R.titleCase(office), 'gold') : R.h('span', { class: 'dim' }, '—'));

  R.bar = function bar(value, max, cls) {
    const p = R.clamp((value / (max || 1)) * 100, 0, 100);
    return R.h('div', { class: `bar ${cls || ''}` }, R.h('i', { style: `width:${p.toFixed(1)}%` }));
  };

  /** Need bar coloured by criticality (<20 critical, <40 warning). */
  R.needBar = (value) => R.bar(value, 100, value < 20 ? 'crit' : value < 40 ? 'warn' : '');

  R.barRow = function barRow(label, value, max, cls) {
    return R.h('div', { class: 'bar-row' },
      R.h('span', { class: 'muted' }, label),
      R.bar(value, max, cls),
      R.h('span', { class: 'num' }, Math.round(value)));
  };

  R.miniBar = function miniBar(value, max, cls) {
    return R.h('span', { class: 'mini-bar' }, R.bar(value, max, cls), R.h('span', { class: 'num small' }, Math.round(value)));
  };

  /** Tiny inline SVG line chart. */
  R.sparkline = function sparkline(values, w = 80, h = 22, color = 'var(--accent)') {
    const el = R.svg('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: 'spark' });
    const vals = (values || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (vals.length < 2) {
      el.appendChild(R.svg('line', { x1: 0, y1: h / 2, x2: w, y2: h / 2, stroke: 'var(--dim)', 'stroke-width': 1 }));
      return el;
    }
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo || 1;
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * (w - 2) + 1;
      const y = h - 2 - ((v - lo) / span) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    el.appendChild(R.svg('polyline', { points: pts.join(' '), fill: 'none', stroke: color, 'stroke-width': 1.4, 'stroke-linejoin': 'round' }));
    const last = pts[pts.length - 1].split(',');
    el.appendChild(R.svg('circle', { cx: last[0], cy: last[1], r: 1.8, fill: color }));
    return el;
  };

  /** Four thin bars for a candidate's platform (tax, dividend, min wage, strictness). */
  R.platformBars = function platformBars(p) {
    if (!p) return R.h('span', { class: 'dim' }, '—');
    const keys = ['tax', 'dividend', 'minWage', 'strictness'];
    const title = keys.map((k) => `${R.titleCase(k)} ${Math.round((p[k] || 0) * 100)}%`).join(' · ');
    return R.h('span', { class: 'platform', title },
      keys.map((k) => R.h('i', { class: k, style: `height:${Math.max(2, Math.round((p[k] || 0) * 14))}px` })));
  };

  /** "Ondine Ashgrove" for a married citizen, "Ondine" for everyone else. */
  R.displayName = function displayName(c) {
    if (!c) return '';
    return c.married && c.familyName ? `${c.name} ${c.familyName}` : c.name;
  };

  /** A pill for the citizens who are not simply adults. */
  R.stagePill = function stagePill(stage) {
    if (stage === 'child') return R.pill('child', 'accent');
    if (stage === 'elder') return R.pill('elder', 'gold');
    return null;
  };

  R.nameLink = function nameLink(id, name) {
    if (!id) return R.h('span', { class: 'dim' }, '—');
    return R.h('a', {
      class: 'name-link', href: '#', title: id,
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); R.openCitizen(id); },
    }, name || id);
  };

  R.nameList = function nameList(items) {
    if (!items || !items.length) return R.h('span', { class: 'dim' }, '—');
    const out = [];
    items.forEach((it, i) => {
      if (i) out.push(', ');
      out.push(R.nameLink(it.id, it.name));
    });
    return R.h('span', null, out);
  };

  R.card = function card(label, value, sub, extra) {
    return R.h('div', { class: 'card' },
      R.h('div', { class: 'label' }, label),
      R.h('div', { class: 'value' }, value),
      sub ? R.h('div', { class: `sub ${sub.cls || ''}` }, sub.text ?? sub) : null,
      extra || null);
  };

  R.section = function section(title, meta, ...children) {
    return R.h('div', { class: 'section' },
      R.h('h3', { class: 'section-title' }, title, meta ? R.h('span', { class: 'meta' }, meta) : null),
      children);
  };

  /**
   * Generic table. columns: [{ key, label, cls, render(row), sortable, sortValue(row) }]
   * sort: { key, dir }; onSort(key, dir) re-renders; onRowClick(row).
   */
  R.table = function table({ columns, rows, sort, onSort, rowClass, onRowClick, empty }) {
    if (!rows || !rows.length) return R.h('div', { class: 'empty' }, empty || 'Nothing to show yet.');
    const head = R.h('tr', null, columns.map((col) => {
      const sortable = col.sortable && onSort;
      const th = R.h('th', { class: [col.cls || '', sortable ? 'sortable' : ''].join(' ').trim() }, col.label);
      if (sort && sort.key === col.key) th.appendChild(R.h('span', { class: 'arrow' }, sort.dir === 'asc' ? '▲' : '▼'));
      if (sortable) th.addEventListener('click', () => onSort(col.key, sort && sort.key === col.key && sort.dir === 'asc' ? 'desc' : 'asc'));
      return th;
    }));
    const body = R.h('tbody', null, rows.map((row) => {
      const cls = [onRowClick ? 'clickable' : '', rowClass ? rowClass(row) || '' : ''].join(' ').trim();
      const tr = R.h('tr', { class: cls || null }, columns.map((col) => {
        const v = col.render ? col.render(row) : row[col.key];
        return R.h('td', { class: col.cls || null }, v === null || v === undefined || v === '' ? R.h('span', { class: 'dim' }, '—') : v);
      }));
      if (onRowClick) tr.addEventListener('click', () => onRowClick(row));
      return tr;
    }));
    return R.h('div', { class: 'table-wrap' }, R.h('table', null, R.h('thead', null, head), body));
  };

  /** Sort rows for R.table using the column definitions. */
  R.sortRows = function sortRows(rows, columns, sort) {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const val = col.sortValue || ((r) => r[col.key]);
    const dir = sort.dir === 'desc' ? -1 : 1;
    return rows.slice().sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  };

  // ----------------------------------------------------------------- API

  /**
   * Every call the dashboard makes is a GET. There is nothing here that can
   * change the city: no body, no method, no controls (docs/PRINCIPLES.md §1).
   */
  R.api = async function api(path) {
    const res = await fetch(path, { method: 'GET' });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
    return data;
  };

  // --------------------------------------------------------- state/header

  R.state = { tickSeconds: null, tick: 0, day: 0, hour: 0, population: 0, founders: 0, tab: 'citizens' };
  R.ui = { sort: {}, filters: {} };

  /** "one hour every 20 s" — the pace, which nobody here can change. */
  const paceLabel = (seconds) => {
    if (!seconds && seconds !== 0) return 'the clock is turning';
    const n = seconds >= 1 ? String(Math.round(seconds * 10) / 10) : String(seconds);
    return `one hour every ${n} s`;
  };

  R.applyState = function applyState(s) {
    if (!s) return;
    Object.assign(R.state, {
      tickSeconds: s.tickSeconds ?? R.state.tickSeconds, tick: s.tick ?? 0, day: s.day ?? 0, hour: s.hour ?? 0,
      population: s.population ?? 0, founders: s.founders ?? 0,
    });
    R.lastState = s;
    renderHeader();
  };

  function renderHeader() {
    const s = R.state;
    $('#clock-time').textContent = R.clockText(s.day, s.hour);
    $('#clock-tick').textContent = `tick ${R.fmt(s.tick)}`;
    $('#population').textContent = R.fmt(s.population);
    $('#founders').textContent = s.founders ? ` · ${R.fmt(s.founders)} scripted` : '';
    $('#pace').textContent = paceLabel(s.tickSeconds);
    document.title = `Reverie — Day ${s.day}, ${R.pad2(s.hour)}:00`;
  }

  function setConn(mode, text) {
    const el = $('#conn');
    el.className = `conn ${mode}`;
    el.textContent = text || { live: 'live', poll: 'polling', down: 'offline' }[mode] || mode;
  }

  /**
   * The dashboard is a window: it watches and never steers. The only key
   * bound here closes the drawer.
   */
  function wireKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'Escape' && R.drawer) R.drawer.close();
    });
  }

  // ----------------------------------------------------------------- tabs

  const TAB_ORDER = ['citizens', 'society', 'economy', 'government', 'court', 'bans', 'chronicle', 'agents'];
  R.tabs = {};

  /** def: { label, load(): Promise<data>, mount(root) (once), update(data, root) } */
  R.registerTab = function registerTab(name, def) {
    R.tabs[name] = Object.assign({ name, counts: null }, def);
  };

  function buildTabs() {
    const nav = $('#tabs');
    const body = $('#tab-body');
    for (const name of TAB_ORDER) {
      const t = R.tabs[name];
      if (!t) continue;
      t.button = R.h('button', { class: 'tab', dataset: { tab: name }, onclick: () => R.selectTab(name) }, t.label, R.h('span', { class: 'count' }));
      nav.appendChild(t.button);
      t.root = R.h('div', { class: 'tab-root hidden', id: `tab-${name}` });
      body.appendChild(t.root);
      if (t.mount) t.mount(t.root);
    }
  }

  R.setTabCount = function setTabCount(name, n) {
    const t = R.tabs[name];
    if (!t || !t.button) return;
    t.button.querySelector('.count').textContent = n === null || n === undefined || n === '' ? '' : String(n);
  };

  R.selectTab = function selectTab(name) {
    if (!R.tabs[name]) name = TAB_ORDER.find((n) => R.tabs[n]);
    R.state.tab = name;
    for (const t of Object.values(R.tabs)) {
      if (!t.root) continue;
      t.root.classList.toggle('hidden', t.name !== name);
      t.button.classList.toggle('active', t.name === name);
    }
    try { localStorage.setItem('reverie.tab', name); } catch (e) { /* private mode */ }
    if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
    R.refresh();
  };

  window.addEventListener('hashchange', () => {
    const name = location.hash.slice(1);
    if (R.tabs[name] && R.state.tab !== name) R.selectTab(name);
  });

  // -------------------------------------------------------------- refresh

  let refreshing = false;
  let lastRefresh = 0;
  let wantRefresh = false;
  const sse = { live: false };

  R.refresh = async function refresh() {
    if (refreshing) { wantRefresh = true; return; }
    refreshing = true;
    try {
      const jobs = [];
      if (R.map) jobs.push(R.api('/api/map').then((m) => R.map.update(m)));
      const tab = R.tabs[R.state.tab];
      if (tab && tab.load) jobs.push(tab.load().then((data) => tab.update(data, tab.root)));
      if (R.drawer && R.drawer.isOpen()) jobs.push(R.drawer.reload());
      const results = await Promise.allSettled(jobs);
      const failed = results.find((r) => r.status === 'rejected');
      if (failed) {
        console.warn('refresh failed', failed.reason);
        if (!sse.live) setConn('down', 'error: ' + (failed.reason && failed.reason.message));
      }
    } finally {
      refreshing = false;
      lastRefresh = performance.now();
    }
  };

  /** Ask for a refresh, coalescing bursts of SSE frames to about one per second. */
  R.requestRefresh = function requestRefresh() {
    if (refreshing || performance.now() - lastRefresh < 900) { wantRefresh = true; return; }
    R.refresh();
  };

  async function pollState() {
    try {
      R.applyState(await R.api('/api/state'));
      if (!sse.live) setConn('poll');
    } catch (e) {
      setConn('down');
    }
  }

  function startPolling() {
    setInterval(() => {
      if (!sse.live) pollState();
      if (wantRefresh || !sse.live) { wantRefresh = false; R.refresh(); }
    }, 2000);
    setInterval(() => { if (wantRefresh && !refreshing) { wantRefresh = false; R.refresh(); } }, 500);
  }

  // ------------------------------------------------------------------ SSE

  function connectSse() {
    if (typeof EventSource === 'undefined') { setConn('poll'); return; }
    const es = new EventSource('/api/events');
    es.addEventListener('state', (e) => {
      try { R.applyState(JSON.parse(e.data)); } catch (err) { return; }
      if (!sse.live) { sse.live = true; setConn('live'); }
      R.requestRefresh();
    });
    es.addEventListener('events', (e) => {
      try {
        const list = JSON.parse(e.data);
        if (Array.isArray(list) && list.length) R.ticker.push(list);
      } catch (err) { /* ignore malformed frame */ }
    });
    es.onopen = () => { sse.live = true; setConn('live'); };
    es.onerror = () => { sse.live = false; setConn('poll'); };
  }

  // --------------------------------------------------------------- ticker

  R.ticker = {
    events: [],
    max: 300,
    listeners: [],
    /** Replace the buffer with a newest-first list. */
    seed(list) {
      this.events = (list || []).slice(0, this.max);
      this.listeners.forEach((fn) => fn([], true));
      const top = this.events.find((e) => e.weight >= 0.5) || this.events[0];
      if (top) showNews(top, false);
    },
    /** Prepend a tick's events (given oldest first). */
    push(list) {
      for (const ev of list) this.events.unshift(ev);
      if (this.events.length > this.max) this.events.length = this.max;
      this.listeners.forEach((fn) => fn(list, false));
      const notable = list.filter((e) => e.weight >= 0.5).sort((a, b) => b.weight - a.weight)[0];
      if (notable) showNews(notable, true);
    },
    onChange(fn) { this.listeners.push(fn); },
  };

  function showNews(ev, flash) {
    const el = $('#newsbar-text');
    el.textContent = `${R.whenText(ev.tick)} · ${ev.text}`;
    el.classList.remove('flash');
    if (flash) { void el.offsetWidth; el.classList.add('flash'); }
  }

  R.openCitizen = function openCitizen(id) {
    if (R.drawer) R.drawer.open(id);
  };

  // ----------------------------------------------------------------- boot

  document.addEventListener('DOMContentLoaded', async () => {
    wireKeys();
    buildTabs();
    if (R.map) R.map.init($('#map'), $('#tooltip'), $('#legend'));
    if (R.drawer) R.drawer.init();
    await pollState();
    let saved = null;
    try { saved = localStorage.getItem('reverie.tab'); } catch (e) { saved = null; }
    const fromHash = location.hash.slice(1);
    R.selectTab(R.tabs[fromHash] ? fromHash : saved || 'citizens');
    try {
      const ch = await R.api('/api/chronicle');
      R.ticker.seed(ch.events || []);
    } catch (e) { /* the chronicle tab will retry */ }
    connectSse();
    startPolling();
  });
})();
