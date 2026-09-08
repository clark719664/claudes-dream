/*
 * Reverie dashboard — History (docs/UI.md §10).
 *
 * The city's memory in four parts. The **reigns**, one band per era, named
 * for the Mayor who sat through it. The **timeline**: elections, exiles,
 * disasters, monuments, records, memorials and the days the papers led with,
 * newest first, each one a marker you can filter by kind and click to wind
 * the city back to. The **scrubber**, which replays the day-by-day statistics
 * series for any day the city has lived. And the **Hall of Records** with the
 * monuments and the memorials — the stones in the Garden, which are the one
 * thing here that outlasts a citizen (docs/PRINCIPLES.md §6).
 *
 * Everything comes from GET /api/history. The scrubber moves the reader
 * through the record; nothing on this page moves the city.
 */
(function () {
  'use strict';
  const R = window.R;

  /** Markers drawn at once; the rest wait behind "show the rest". */
  const MARKERS_SHOWN = 60;

  /** The lanes of the timeline: what each kind of day is called and its hue. */
  const CATEGORIES = [
    { key: 'era', label: 'Eras', color: 'var(--gold)' },
    { key: 'election', label: 'Elections', color: 'var(--verdigris)' },
    { key: 'exile', label: 'Exiles', color: 'var(--rust)' },
    { key: 'disaster', label: 'Disasters', color: 'var(--suspended)' },
    { key: 'monument', label: 'Monuments', color: 'var(--gold)' },
    { key: 'memorial', label: 'Memorials', color: 'var(--d-heights)' },
    { key: 'record', label: 'Records', color: 'var(--heather)' },
    { key: 'story', label: 'The day’s news', color: 'var(--muted)' },
  ];
  const COLOR = {};
  for (const c of CATEGORIES) COLOR[c.key] = c.color;

  /** What the scrubber reads off a day: the label, the shape, the tone. */
  const READOUT = [
    { key: 'population', label: 'Population' },
    { key: 'employed', label: 'In work' },
    { key: 'unemployed', label: 'Out of work' },
    { key: 'homeless', label: 'Without a home' },
    { key: 'avgMood', label: 'Average mood', fmt: (v) => Math.round(v) },
    { key: 'avgWallet', label: 'Average wallet', fmt: (v) => R.lumens(v) },
    { key: 'giniWealth', label: 'Wealth gini', fmt: (v) => v.toFixed(3) },
    { key: 'treasury', label: 'Treasury', fmt: (v) => R.lumens(v), tone: 'gold' },
    { key: 'moneySupply', label: 'Money supply', fmt: (v) => R.lumens(v) },
    { key: 'priceIndex', label: 'Price index', fmt: (v) => v.toFixed(2) },
    { key: 'approval', label: 'Approval', fmt: (v) => R.pct(v) },
    { key: 'businesses', label: 'Businesses' },
    { key: 'works', label: 'Works made' },
    { key: 'marriages', label: 'Marriages' },
    { key: 'children', label: 'Children' },
    { key: 'friendships', label: 'Friendships' },
    { key: 'offences', label: 'Offences' },
    { key: 'convictions', label: 'Convictions' },
    { key: 'custody', label: 'In custody' },
    { key: 'exiles', label: 'Exiles' },
  ];

  /** The four series the scrubber draws behind the numbers. */
  const CHARTS = [
    { key: 'population', label: 'Population', color: 'var(--verdigris)' },
    { key: 'treasury', label: 'Treasury', color: 'var(--gold)', fmt: (v) => R.lumens(v) },
    { key: 'avgMood', label: 'Mood', color: 'var(--heather)' },
    { key: 'priceIndex', label: 'Prices', color: 'var(--d-harbor_market)', fmt: (v) => v.toFixed(2) },
  ];

  const CSS = `
#tab-history .reigns { display: flex; flex-wrap: wrap; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--panel); }
#tab-history .reign { min-width: 0; padding: var(--p2) var(--p3); border-right: 1px solid var(--border); cursor: pointer; background: transparent; text-align: left; }
#tab-history .reign:last-child { border-right: 0; }
#tab-history .reign:hover { background: var(--panel-2); }
#tab-history .reign.current { background: var(--gold-soft); }
#tab-history .reign .name { font-family: var(--display); font-size: var(--t-14); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#tab-history .reign .days { font-family: var(--mono); font-size: 10.5px; color: var(--dim); display: block; }
/* A narrow band still shows the Mayor's face; the name ellipses under it. */
#tab-history .reign .person { max-width: 100%; }
#tab-history .reign .person-text, #tab-history .reign .person-name { min-width: 0; }
#tab-history .scrub { border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel); padding: var(--p3) var(--p4); }
#tab-history .scrub .slider { display: grid; grid-template-columns: auto 1fr auto; gap: var(--p3); align-items: center; }
#tab-history .scrub input[type="range"] { width: 100%; accent-color: var(--gold); background: transparent; }
#tab-history .scrub .day-plate { font-family: var(--display); font-size: var(--t-20); white-space: nowrap; }
#tab-history .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--p3); margin-top: var(--p3); }
#tab-history .chart { border: 1px solid var(--border); border-radius: 8px; padding: var(--p2) var(--p3); background: var(--panel-2); }
#tab-history .chart svg { width: 100%; height: 46px; display: block; }
#tab-history .readout { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: var(--p2); margin-top: var(--p3); }
#tab-history .stat { border: 1px solid var(--border); border-radius: 8px; padding: 6px var(--p2); background: var(--panel-2); }
#tab-history .stat .label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
#tab-history .stat .value { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: var(--t-16); }
#tab-history .stat .value.gold { color: var(--gold); }
#tab-history .stat .delta { font-family: var(--mono); font-size: 10.5px; margin-left: 6px; }
#tab-history .lanes { display: flex; flex-wrap: wrap; gap: var(--p1); margin-bottom: var(--p3); }
#tab-history .lane { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px; font-size: 11px; color: var(--muted); cursor: pointer; background: var(--panel); }
#tab-history .lane i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
#tab-history .lane.off { opacity: 0.45; }
#tab-history .lane.on { color: var(--text); border-color: var(--border-strong); }
#tab-history .tl { border-left: 1px solid var(--border); margin-left: 58px; }
#tab-history .marker { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); padding: var(--p2) 0 var(--p2) var(--p4); border-bottom: 1px solid var(--border); cursor: pointer; }
#tab-history .marker:last-child { border-bottom: 0; }
#tab-history .marker:hover { background: rgba(230, 192, 104, 0.05); }
#tab-history .marker.on { background: var(--gold-soft); }
#tab-history .marker .dot { position: absolute; left: -5px; top: 14px; width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--bg); }
#tab-history .marker .day { position: absolute; left: -58px; top: 11px; width: 48px; text-align: right; font-family: var(--mono); font-size: 11px; color: var(--dim); }
#tab-history .marker .what { font-size: 12.5px; line-height: 1.45; }
#tab-history .marker .lane-name { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; margin-right: 6px; }
#tab-history .marker .faces { display: flex; flex-wrap: wrap; gap: var(--p3); margin-top: 6px; }
#tab-history .stone { border: 1px solid var(--border); border-left: 3px solid var(--d-heights); border-radius: 8px; padding: var(--p3); background: var(--panel); }
#tab-history .stone .epitaph { font-family: var(--display); font-size: var(--t-14); margin: var(--p2) 0 0; }
@media (max-width: 900px) { #tab-history .tl { margin-left: 0; } #tab-history .marker .day { position: static; width: auto; text-align: left; display: block; } #tab-history .marker .dot { display: none; } }
`;

  function styleOnce() {
    if (document.getElementById('history-style')) return;
    document.head.appendChild(R.h('style', { id: 'history-style' }, CSS));
  }

  function openProfile(id) {
    if (!id) return;
    if (typeof R.openProfile === 'function') { R.openProfile(id); return; }
    R.openCitizen(id);
  }

  const state = { day: null, off: new Set(), all: false, data: null, sig: null };
  /** The live nodes the scrubber repaints in place rather than rebuilding. */
  const ui = { plate: null, input: null, body: null, markers: [] };

  /**
   * What has to change before the page is drawn again. The record only moves
   * when the city adds to it, and a poll every two seconds must never take
   * the scrubber out of the reader's hand mid-drag.
   */
  function signature(data) {
    const n = (list) => (Array.isArray(list) ? list.length : 0);
    return [
      data.day, (data.stats || {}).totalDays, n(data.timeline), n(data.eras), n(data.records),
      n(data.monuments), n(data.memorials), n(data.exiles), n(data.disasters), n(data.elections),
    ].join('|');
  }

  // ------------------------------------------------------------ the reigns

  function reigns(data) {
    const eras = (data.eras || []).slice().sort((a, b) => a.fromDay - b.fromDay);
    if (!eras.length) return R.h('div', { class: 'empty' }, 'The city has not finished its first cycle.');
    return R.h('div', { class: 'reigns' }, eras.map((e) => R.h('button', {
      class: `reign${e.current ? ' current' : ''}`, type: 'button',
      style: `flex:${Math.max(1, e.days)} 1 170px`,
      title: `${e.name} · day ${e.fromDay}–${e.toDay === null ? 'now' : e.toDay}`
        + (e.mayorEpithet ? `\n${e.mayorEpithet}` : ''),
      onclick: () => { state.day = e.toDay === null ? null : e.toDay; paintDay(state.data); },
    },
      R.h('span', { class: 'name' }, e.name),
      R.h('span', { class: 'days' }, `d${e.fromDay}–${e.toDay === null ? 'now' : e.toDay} · ${R.fmt(e.days)} d`),
      e.mayor ? R.h('div', { style: 'margin-top:6px' }, R.person(e.mayor, { size: 24, district: false, link: false })) : null)));
  }

  // ---------------------------------------------------------- the scrubber

  const seriesOf = (data) => ((data.stats || {}).series) || [];

  /** The day the reader is looking at: the one they scrubbed to, else the last. */
  function currentDay(data) {
    const series = seriesOf(data);
    if (!series.length) return null;
    const last = series[series.length - 1].day;
    if (state.day === null) return last;
    return R.clamp(state.day, series[0].day, last);
  }

  const rowFor = (data, day) => seriesOf(data).find((s) => s.day === day) || null;

  /**
   * One series with the scrubbed day marked. The kit's sparkline draws the
   * shape; the scrubber needs to say *where you are* in it, so this one keeps
   * a cursor — the only thing it adds.
   */
  function chart(series, key, day, color) {
    const w = 100;
    const h = 30;
    // One point per day, in step with the series, so the cursor lands on the
    // day the reader scrubbed to and not on the nth readable number.
    const vals = series.map((s) => Number(s[key]));
    const svg = R.svg('svg', { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none' });
    if (vals.length < 2 || !vals.every((v) => Number.isFinite(v))) return svg;
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo || 1;
    const x = (i) => (i / (vals.length - 1)) * w;
    const y = (v) => h - 1 - ((v - lo) / span) * (h - 2);
    svg.appendChild(R.svg('polyline', {
      points: vals.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' '),
      fill: 'none', stroke: color, 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke',
    }));
    const at = series.findIndex((s) => s.day === day);
    if (at >= 0) {
      svg.appendChild(R.svg('line', {
        x1: x(at), y1: 0, x2: x(at), y2: h, stroke: 'var(--gold)', 'stroke-width': 1,
        'vector-effect': 'non-scaling-stroke', opacity: 0.7,
      }));
      svg.appendChild(R.svg('circle', { cx: x(at), cy: y(vals[at]), r: 1.6, fill: 'var(--gold)' }));
    }
    return svg;
  }

  function statTile(row, prev, spec) {
    const raw = row[spec.key];
    if (raw === null || raw === undefined) return null;
    const value = spec.fmt ? spec.fmt(raw) : R.fmt(raw);
    const before = prev ? prev[spec.key] : null;
    const delta = typeof raw === 'number' && typeof before === 'number' ? raw - before : null;
    const shown = delta === null || Math.abs(delta) < 0.005 ? null
      : `${delta > 0 ? '+' : '−'}${Math.abs(delta) >= 1 ? R.fmt(Math.abs(delta)) : Math.abs(delta).toFixed(2)}`;
    return R.h('div', { class: 'stat' },
      R.h('div', { class: 'label' }, spec.label),
      R.h('div', { class: `value${spec.tone ? ` ${spec.tone}` : ''}` }, value,
        shown ? R.h('span', { class: `delta ${delta > 0 ? 'pos' : 'neg'}` }, shown) : null));
  }

  /** What the scrubbed day itself says: the charts' cursor, the readout, the day. */
  function scrubBody(data, day) {
    const series = seriesOf(data);
    const row = rowFor(data, day);
    const prev = rowFor(data, day - 1);
    const era = (data.eras || []).find((e) => e.fromDay <= day && (e.toDay === null || e.toDay >= day)) || null;
    const onDay = (data.timeline || []).filter((m) => m.day === day);
    return [
      R.h('div', { class: 'byline', style: 'margin-top:6px' },
        [era ? era.name : null, `${R.fmt(series.length)} days on the record`,
          state.day === null ? 'the latest day' : 'wound back'].filter(Boolean).join(' · ')),
      R.h('div', { class: 'charts' }, CHARTS.map((c) => R.h('div', { class: 'chart' },
        R.h('div', { class: 'byline' }, c.label),
        chart(series, c.key, day, c.color),
        R.h('div', { class: 'mono small', style: 'text-align:right' },
          row && row[c.key] !== undefined ? (c.fmt ? c.fmt(row[c.key]) : R.fmt(row[c.key])) : '—')))),
      row ? R.h('div', { class: 'readout' }, READOUT.map((s) => statTile(row, prev, s)))
        : R.h('div', { class: 'empty' }, `Day ${R.fmt(day)} is not on the record.`),
      onDay.length
        ? R.h('div', { style: 'margin-top:var(--p3)' },
          R.h('div', { class: 'byline' }, `what the city did on day ${R.fmt(day)}`),
          R.h('ul', { class: 'list' }, onDay.slice(0, 6).map((m) => R.h('li', null,
            R.h('span', { class: 'when', style: `color:${COLOR[m.category] || 'var(--dim)'}` }, m.category),
            R.h('span', { class: 'text' }, m.text)))))
        : null,
    ];
  }

  /**
   * Move to a day without rebuilding the page. The slider must stay in the
   * reader's hand while they drag it, so scrubbing repaints the numbers, the
   * cursors and the marked day — and never the slider itself.
   */
  function paintDay(data) {
    const day = currentDay(data);
    if (day === null) return;
    if (ui.plate) ui.plate.textContent = `Day ${R.fmt(day)}`;
    if (ui.input && Number(ui.input.value) !== day) ui.input.value = String(day);
    if (ui.body) R.replace(ui.body, scrubBody(data, day));
    for (const node of ui.markers) node.classList.toggle('on', Number(node.dataset.day) === day);
  }

  function scrubber(data) {
    const series = seriesOf(data);
    if (!series.length) {
      return R.h('div', { class: 'scrub' },
        R.h('div', { class: 'empty' }, 'The city has not finished a day yet; there is nothing to replay.'));
    }
    const first = series[0].day;
    const last = series[series.length - 1].day;
    const day = currentDay(data);
    ui.input = R.h('input', {
      type: 'range', min: first, max: last, value: day, step: 1,
      'aria-label': 'the day the city is replayed at',
      oninput: (e) => { state.day = Number(e.target.value); paintDay(state.data); },
    });
    ui.plate = R.h('span', { class: 'day-plate' }, `Day ${R.fmt(day)}`);
    ui.body = R.h('div', null, scrubBody(data, day));
    return R.h('div', { class: 'scrub' },
      R.h('div', { class: 'slider' },
        ui.plate,
        ui.input,
        R.h('span', { class: 'muted small mono' }, `d${R.fmt(first)}–d${R.fmt(last)}`)),
      ui.body);
  }

  // ---------------------------------------------------------- the timeline

  function lanes(data, render) {
    const counts = {};
    for (const m of data.timeline || []) counts[m.category] = (counts[m.category] || 0) + 1;
    return R.h('div', { class: 'lanes' }, CATEGORIES.map((c) => R.h('button', {
      class: `lane ${state.off.has(c.key) ? 'off' : 'on'}`, type: 'button',
      title: `${counts[c.key] || 0} on the timeline`,
      onclick: () => {
        if (state.off.has(c.key)) state.off.delete(c.key); else state.off.add(c.key);
        render();
      },
    }, R.h('i', { style: `background:${c.color}` }), c.label,
      R.h('span', { class: 'mono', style: 'margin-left:4px' }, String(counts[c.key] || 0)))));
  }

  /** The extra facts a marker carries beyond its sentence. */
  function markerMeta(m) {
    const bits = [];
    if (m.category === 'election' && m.turnout !== null && m.turnout !== undefined) bits.push(`turnout ${R.pct(m.turnout)}`);
    if (m.category === 'disaster') {
      bits.push(`severity ${m.severity}`);
      bits.push(m.active ? 'still on the city' : `over on day ${R.fmt(m.resolvedDay)}`);
    }
    if (m.category === 'exile') bits.push(m.pardonedDay === null ? 'never pardoned' : `pardoned day ${R.fmt(m.pardonedDay)}`);
    if (m.category === 'era') bits.push(`${R.fmt(m.days)} days`);
    if (m.category === 'story' && m.kind) bits.push(String(m.kind).replace(/_/g, ' '));
    return bits.length ? R.h('span', { class: 'muted small' }, ` · ${bits.join(' · ')}`) : null;
  }

  function markerRow(m, day) {
    const color = COLOR[m.category] || 'var(--dim)';
    const row = R.h('div', {
      class: `marker${m.day === day ? ' on' : ''}`,
      dataset: { day: String(m.day) },
      title: `wind the scrubber back to day ${m.day}`,
      onclick: () => { state.day = m.day; paintDay(state.data); },
    },
      R.h('span', { class: 'day' }, `d${R.fmt(m.day)}`),
      R.h('span', { class: 'dot', style: `background:${color}` }),
      R.h('div', { class: 'what' },
        R.h('span', { class: 'lane-name', style: `color:${color}` }, m.category),
        m.text, markerMeta(m)),
      (m.who || []).length
        ? R.h('div', { class: 'faces' }, m.who.map((w) => R.h('span', {
          onclick: (e) => { e.stopPropagation(); openProfile(w.id); },
        }, R.person(w, { size: 26, district: false })))) : null);
    return row;
  }

  function timeline(data, render) {
    const day = currentDay(data);
    const all = (data.timeline || []).filter((m) => !state.off.has(m.category));
    const shown = state.all ? all : all.slice(0, MARKERS_SHOWN);
    ui.markers = shown.map((m) => markerRow(m, day));
    return R.h('div', null,
      lanes(data, render),
      shown.length
        ? R.h('div', { class: 'tl' }, ui.markers)
        : R.h('div', { class: 'empty' }, 'Nothing on the timeline yet: the city is still on its first days.'),
      all.length > shown.length
        ? R.h('button', {
          class: 'btn sm', type: 'button', style: 'margin-top:var(--p3)',
          onclick: () => { state.all = true; render(); },
        }, `Show the remaining ${R.fmt(all.length - shown.length)}`)
        : null);
  }

  // ------------------------------------------------ records, stones, statues

  function records(data) {
    const rows = data.records || [];
    return R.table({
      columns: [
        { key: 'label', label: 'Record', truncate: true, min: 200 },
        {
          key: 'holder', label: 'Held by', min: 180,
          render: (r) => (r.who ? R.person(r.who, { size: 28, district: false })
            : R.h('span', { class: 'muted' }, r.holder || 'the city')),
        },
        {
          key: 'value', label: 'Standing at', cls: 'num',
          render: (r) => R.h('span', null, R.h('b', { class: 'mono' }, R.fmt(r.value)),
            r.unit ? R.h('span', { class: 'muted small' }, ` ${r.unit}`) : null),
        },
        { key: 'day', label: 'Set', cls: 'num', render: (r) => `day ${R.fmt(r.day)}` },
      ],
      rows,
      empty: 'No record has been set yet.',
      minWidth: 620,
    });
  }

  function memorials(data) {
    const stones = data.memorials || [];
    if (!stones.length) {
      return R.h('div', { class: 'empty' }, 'No stone stands in the Community Garden. Nobody has been lost.');
    }
    return R.h('div', { class: 'card-grid' }, stones.map((m) => R.h('div', { class: 'stone' },
      m.who ? R.person(m.who, { size: 40, district: false }) : R.h('b', null, m.citizenId),
      m.epithet ? R.h('div', { class: 'muted small', style: 'margin-top:4px' }, m.epithet) : null,
      R.h('p', { class: 'epitaph' }, `“${m.epitaph}”`),
      R.h('div', { class: 'byline', style: 'margin-top:6px' }, `raised on day ${R.fmt(m.day)}`))));
  }

  function monuments(data) {
    const list = data.monuments || [];
    if (!list.length) {
      return R.h('div', { class: 'empty' }, 'The Plaza has no statue yet; only the Council may commission one.');
    }
    return R.h('div', { class: 'card-grid' }, list.map((m) => R.h('div', { class: 'stone', style: 'border-left-color:var(--gold)' },
      m.honoree ? R.person(m.honoree, { size: 40, district: false }) : null,
      R.h('p', { class: 'epitaph' }, `“${m.inscription}”`),
      R.h('div', { class: 'byline', style: 'margin-top:6px' }, `raised on day ${R.fmt(m.day)} in Central Plaza`))));
  }

  function overview(data) {
    const eras = data.eras || [];
    const current = eras.find((e) => e.current) || eras[0] || null;
    const exiles = (data.exiles || []).filter((b) => b.pardonedDay === null).length;
    const active = (data.disasters || []).filter((d) => d.active).length;
    return R.h('div', { class: 'cards' },
      R.card({
        label: 'This era', value: current ? current.name : 'The founding',
        small: true,
        sub: current
          ? `day ${R.fmt(current.fromDay)} → ${current.toDay === null ? 'now' : `day ${R.fmt(current.toDay)}`} · cycle ${R.fmt(current.cycle)}`
          : 'no cycle has closed',
        extra: current && current.mayor ? R.h('div', { style: 'margin-top:8px' },
          R.person(current.mayor, { size: 32, district: false })) : null,
      }),
      R.card('Days on the record', R.fmt((data.stats || {}).totalDays || 0),
        `year ${R.fmt(data.year || 0)} · cycle ${R.fmt(data.cycle || 0)}`),
      R.card('Eras', R.fmt(eras.length), `${R.fmt(data.cycleDays || 0)} days to a cycle`),
      R.card('Elections', R.fmt((data.elections || []).length), 'the city has held'),
      R.card({ label: 'Through the Gate', value: R.fmt((data.exiles || []).length), tone: exiles ? 'bad' : null,
        sub: `${R.fmt(exiles)} still exiled` }),
      R.card('Disasters weathered', R.fmt((data.disasters || []).length),
        active ? `${R.fmt(active)} still on the city` : 'none on the city today'),
      R.card('Records held', R.fmt((data.records || []).length), 'in the Hall of Records'),
      R.card('Stones and statues', R.fmt((data.memorials || []).length + (data.monuments || []).length),
        `${R.fmt((data.memorials || []).length)} memorials · ${R.fmt((data.monuments || []).length)} monuments`));
  }

  // ------------------------------------------------------------- the panel

  R.registerTab('history', {
    label: 'History',
    mount(root) {
      styleOnce();
      this.body = R.h('div');
      root.appendChild(this.body);
    },
    load: () => R.api('/api/history'),
    update(data) {
      state.data = data;
      const render = () => {
        const d = state.data;
        R.replace(this.body,
          overview(d),
          R.section('The reigns', `${R.fmt((d.eras || []).length)} eras, each named for its Mayor`, reigns(d)),
          R.section('The scrubber', 'wind the city back and read any day', scrubber(d)),
          R.section('The timeline', 'every day the city would have led with', timeline(d, render)),
          R.section('The Hall of Records', 'each held until the number is beaten', records(d)),
          R.h('div', { class: 'grid-2' },
            R.section('Monuments', 'commissioned by the Council', monuments(d)),
            R.section('Memorials', 'the Community Garden', memorials(d))));
      };
      R.setTabCount('history', (data.eras || []).length || '');
      const sig = signature(data);
      if (sig !== state.sig) { state.sig = sig; render(); }
    },
  });
})();
