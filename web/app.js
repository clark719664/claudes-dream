/*
 * Reverie dashboard — the shell.
 *
 * DOM helpers (everything is built with textContent, so citizen-written text
 * can never become markup), formatting, the motion vocabulary, the API
 * client, the name plate, the tab framework, the SSE stream with a polling
 * fallback, and the ticker strip under the header. The drawing kit every
 * panel uses — portraits, tags, bars, tables, the family tree, the web of
 * ties — is components.js, loaded straight after this file onto the same `R`
 * namespace. The other scripts (map.js, panels*.js, drawer.js) register
 * themselves on `R` and should never need to invent a component of their own.
 *
 * There is nothing in this file that can change the city. Every call is a
 * GET; the only key bound closes the drawer (docs/PRINCIPLES.md §1).
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

  /** The nine districts, in the order the map plats them. Hues live in style.css. */
  R.DISTRICTS = {
    commons: 'The Commons', foundry_row: 'Foundry Row', archive: 'The Archive',
    harbor_market: 'Harbor Market', verdant_quarter: 'Verdant Quarter', nightglass: 'Nightglass',
    threshold: 'The Threshold', heights: 'The Heights', undercroft: 'The Undercroft',
  };
  R.DISTRICT_ORDER = Object.keys(R.DISTRICTS);

  R.districtName = (id) =>
    (R.map && R.map.districtName && R.map.districtName(id)) || R.DISTRICTS[id] || R.titleCase(id);

  /** The district's own colour, as a CSS value usable anywhere (`var(--d-archive)`). */
  R.districtHue = function districtHue(id) {
    const key = String(id ?? '').toLowerCase();
    return R.DISTRICTS[key] ? `var(--d-${key})` : 'var(--muted)';
  };

  /**
   * The row class that draws a district's hue down the left edge of a table
   * row: `rowClass: (r) => R.districtClass(r.district)`.
   */
  R.districtClass = function districtClass(id) {
    const key = R.districtId(id);
    return key || '';
  };

  /** A district id from a name or an id; null when it is neither. */
  R.districtId = function districtId(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const key = raw.toLowerCase().replace(/^the\s+/, '').replace(/[\s-]+/g, '_');
    if (R.DISTRICTS[key]) return key;
    for (const id of R.DISTRICT_ORDER) if (R.DISTRICTS[id].toLowerCase() === raw.toLowerCase()) return id;
    return null;
  };

  // ------------------------------------------------------------------ motion
  //
  // The motion vocabulary, so no panel has to hand-roll one: dots ease
  // (map.js, .citizen), numbers tick when they change, new lines slide in.
  // Both helpers are class flips over keyframes declared in style.css.

  /** Play an animation class once, cleaning up after itself. */
  R.animate = function animate(node, cls) {
    if (!node || !node.classList) return node;
    node.classList.remove(cls);
    void node.offsetWidth; // restart the keyframes
    node.classList.add(cls);
    node.addEventListener('animationend', () => node.classList.remove(cls), { once: true });
    return node;
  };

  /** New content arriving in a list or a panel. */
  R.slideIn = (node) => R.animate(node, 'slide-in');

  /** Write a number; it ticks (and colours by direction) only when it changed. */
  R.tickValue = function tickValue(el, text) {
    if (!el) return el;
    const next = text === null || text === undefined ? '—' : String(text);
    if (el.textContent === next) return el;
    const before = Number(String(el.textContent).replace(/[^\d.-]/g, ''));
    const after = Number(String(next).replace(/[^\d.-]/g, ''));
    el.textContent = next;
    el.classList.remove('tick-up', 'tick-down');
    if (Number.isFinite(before) && Number.isFinite(after) && before !== after) {
      el.classList.add(after > before ? 'tick-up' : 'tick-down');
    }
    return R.animate(el, 'ticked');
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

  R.state = {
    tickSeconds: null, tick: 0, day: 0, hour: 0, population: 0, founders: 0,
    season: null, weather: null, dateLine: null, tab: 'city',
  };
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
      season: s.season ?? R.state.season, weather: s.weather ?? R.state.weather,
      dateLine: s.dateLine ?? R.state.dateLine,
    });
    R.lastState = s;
    renderHeader();
  };

  function dateLine() {
    const s = R.state;
    if (s.dateLine) return s.dateLine;
    const parts = [`Day ${s.day}`];
    if (s.season) parts.push(R.titleCase(s.season));
    parts.push(`${R.pad2(s.hour)}:00`);
    if (s.weather) parts.push(s.weather);
    return parts.join(' · ');
  }

  function renderHeader() {
    const s = R.state;
    $('#dateline').textContent = dateLine();
    R.tickValue($('#clock-tick'), `tick ${R.fmt(s.tick)}`);
    R.tickValue($('#population'), R.fmt(s.population));
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
  //
  // The twelve panels of docs/UI.md. Eleven are tabs; the twelfth, Profile,
  // is the drawer that opens over them whenever a name is clicked. A panel
  // that has not registered yet still gets its place in the nav, so the shell
  // is the same shape before and after its file lands.

  const TABS = [
    { name: 'city', label: 'City' },
    { name: 'citizens', label: 'Citizens' },
    { name: 'economy', label: 'Economy' },
    { name: 'government', label: 'Government' },
    { name: 'court', label: 'Court' },
    { name: 'society', label: 'Society' },
    { name: 'culture', label: 'Culture' },
    { name: 'chronicle', label: 'Chronicle' },
    { name: 'history', label: 'History' },
    { name: 'bans', label: 'Bans' },
    { name: 'agents', label: 'Send your agent' },
  ];
  const TAB_ORDER = TABS.map((t) => t.name);
  R.TAB_ORDER = TAB_ORDER;
  R.tabs = {};

  const tabKey = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
  const tabLabel = (key) => (TABS.find((t) => t.name === key) || {}).label || R.titleCase(key);

  /**
   * def: { label, load(): Promise<data>, mount(root) (once), update(data, root) }
   * The eleven panels of the brief keep the shell's name whatever the file
   * calls them, so the nav always reads the same; anything else is free to
   * name itself.
   */
  R.registerTab = function registerTab(name, def) {
    const key = tabKey(name);
    const named = TABS.some((t) => t.name === key);
    R.tabs[key] = Object.assign({ counts: null }, def, {
      name: key,
      label: named ? tabLabel(key) : (def && def.label) || tabLabel(key),
    });
    return R.tabs[key];
  };

  /** A panel whose file has not been written yet: a real tab, an honest body. */
  function placeholderTab(key) {
    return {
      name: key, label: tabLabel(key), placeholder: true,
      mount(root) {
        root.appendChild(R.h('div', { class: 'panel-stub' },
          R.h('h3', null, tabLabel(key)),
          R.h('p', { class: 'muted' }, 'This panel has not been built yet.')));
      },
    };
  }

  function buildTabs() {
    const nav = $('#tabs');
    const body = $('#tab-body');
    for (const name of TAB_ORDER) {
      const t = R.tabs[name] || (R.tabs[name] = placeholderTab(name));
      t.button = R.h('button', {
        class: `tab${t.placeholder ? ' pending' : ''}`, type: 'button',
        dataset: { tab: name }, onclick: () => R.selectTab(name),
      }, R.h('span', { class: 'tab-label' }, t.label), R.h('span', { class: 'count' }));
      nav.appendChild(t.button);
      t.root = R.h('div', { class: 'tab-root hidden', id: `tab-${name}` });
      body.appendChild(t.root);
      if (t.mount) t.mount(t.root);
    }
  }

  R.setTabCount = function setTabCount(name, n) {
    const t = R.tabs[tabKey(name)];
    if (!t || !t.button) return;
    R.tickValue(t.button.querySelector('.count'), n === null || n === undefined || n === '' ? '' : String(n));
  };

  R.selectTab = function selectTab(name) {
    let key = tabKey(name);
    if (!R.tabs[key]) key = TAB_ORDER.find((n) => R.tabs[n]);
    R.state.tab = key;
    for (const t of Object.values(R.tabs)) {
      if (!t.root) continue;
      t.root.classList.toggle('hidden', t.name !== key);
      t.button.classList.toggle('active', t.name === key);
    }
    try { localStorage.setItem('reverie.tab', key); } catch (e) { /* private mode */ }
    if (location.hash !== `#${key}`) history.replaceState(null, '', `#${key}`);
    R.refresh();
  };

  window.addEventListener('hashchange', () => {
    const name = tabKey(location.hash.slice(1));
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
  //
  // Two things wearing one name. `R.ticker.push/seed/onChange/events` is the
  // buffer of the city's events (capped at 300, oldest dropped) that the
  // Chronicle panel reads. Calling `R.ticker(line)` writes a line onto the
  // strip under the header — a string, or { text, kind, tick, weight,
  // actors, tone } — which is how any panel puts something in front of the
  // reader without owning a pixel of the header.

  const TICKER_LINES = 24;
  let track = null;

  function weightTone(w) {
    return w >= 0.8 ? 'lead' : w >= 0.5 ? 'notable' : 'plain';
  }

  function lineNode(line) {
    const l = typeof line === 'string' ? { text: line } : line || {};
    if (!l.text) return null;
    const node = R.h('span', { class: `ticker-line tone-${l.tone || weightTone(l.weight ?? 0)}` },
      l.actors && l.actors.length ? R.portrait(l.actors[0], 18, { onClick: false }) : null,
      l.tick === undefined || l.tick === null ? null : R.h('span', { class: 'when' }, R.whenText(l.tick)),
      l.kind ? R.h('span', { class: 'kind' }, String(l.kind).replace(/_/g, ' ')) : null,
      R.h('span', { class: 'text' }, l.text));
    if (l.actors && l.actors.length) {
      node.classList.add('clickable');
      node.addEventListener('click', () => R.openCitizen(l.actors[0]));
    }
    return node;
  }

  function pushLine(line, animate = true) {
    if (!track) return null;
    const node = lineNode(line);
    if (!node) return null;
    track.insertBefore(node, track.firstChild);
    if (animate) R.slideIn(node);
    while (track.childNodes.length > TICKER_LINES) track.removeChild(track.lastChild);
    return node;
  }

  /** R.ticker('The Forge is cold') — put a line on the strip under the header. */
  R.ticker = function ticker(line) {
    if (Array.isArray(line)) return line.map((l) => pushLine(l));
    return pushLine(line);
  };

  Object.assign(R.ticker, {
    events: [],
    max: 300,
    listeners: [],
    /** Replace the buffer with a newest-first list. */
    seed(list) {
      this.events = (list || []).slice(0, this.max);
      this.listeners.forEach((fn) => fn([], true));
      if (track) {
        R.clear(track);
        const notable = this.events.filter((e) => (e.weight ?? 0) >= 0.3);
        for (const ev of (notable.length ? notable : this.events).slice(0, TICKER_LINES).reverse()) pushLine(ev, false);
      }
    },
    /** Prepend a tick's events (given oldest first). */
    push(list) {
      for (const ev of list) this.events.unshift(ev);
      if (this.events.length > this.max) this.events.length = this.max;
      // The strip carries the hour's news, not its every errand.
      const notable = list.filter((e) => (e.weight ?? 0) >= 0.3);
      for (const ev of (notable.length ? notable : list.slice(-1)).slice(-TICKER_LINES)) pushLine(ev);
      this.listeners.forEach((fn) => fn(list, false));
    },
    onChange(fn) { this.listeners.push(fn); },
    /** Empty the strip (the buffer is the city's record and is not cleared). */
    clear() { if (track) R.clear(track); },
  });

  R.openCitizen = function openCitizen(id) {
    if (R.drawer) R.drawer.open(id);
  };

  // ----------------------------------------------------------------- boot

  document.addEventListener('DOMContentLoaded', async () => {
    track = $('#ticker-track');
    wireKeys();
    buildTabs();
    if (R.map) R.map.init($('#map'), $('#tooltip'), $('#legend'));
    if (R.drawer) R.drawer.init();
    await pollState();
    let saved = null;
    try { saved = localStorage.getItem('reverie.tab'); } catch (e) { saved = null; }
    const fromHash = tabKey(location.hash.slice(1));
    const wanted = [fromHash, saved && tabKey(saved), 'city', 'citizens'].find((n) => n && R.tabs[n] && !R.tabs[n].placeholder)
      || fromHash || saved || 'city';
    R.selectTab(wanted);
    try {
      const ch = await R.api('/api/chronicle');
      R.ticker.seed(ch.events || []);
    } catch (e) { /* the chronicle tab will retry */ }
    connectSse();
    startPolling();
  });
})();
