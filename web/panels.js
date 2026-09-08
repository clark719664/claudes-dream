/*
 * Reverie dashboard — the City front page, the Citizens register and the
 * Economy (docs/UI.md panels 1, 2 and 4), with the Court docket and the Ban
 * registry still lodging here until their own files land.
 *
 * The Economy panel moved here from panels-gov.js, which keeps the
 * Government. Both files register a tab by name and the later script wins, so
 * panels-gov.js must not register 'economy' as well — index.html loads it
 * after this file, and its copy would shadow this one.
 *
 * Nothing in this file can touch the city. Every call is a GET, every click
 * opens a face or a filter, and the one thing a row does is open the Profile
 * drawer over whatever tab is showing (docs/PRINCIPLES.md §1).
 */
(function () {
  'use strict';
  const R = window.R;

  // ------------------------------------------------------------ the hooks

  /**
   * The Profile drawer belongs to the Profile pack; every panel opens it
   * through this one name. Late-bound on purpose — whoever defines
   * `R.openProfile` wins, and until somebody does we fall back to the shell's
   * own opener so a click is never dead.
   */
  function openProfile(id) {
    if (!id) return;
    if (typeof R.openProfile === 'function') { R.openProfile(id); return; }
    R.openCitizen(id);
  }

  /** A citizen's face, wired to the drawer. */
  function face(id, size, opts) {
    return R.portrait(id, size, Object.assign(
      { onClick: (e) => { e.stopPropagation(); openProfile(id); } }, opts || {}));
  }

  /** A bar drawn in a district's own hue: who's where, what the land costs. */
  function districtBar(id, value, max) {
    const pct = R.clamp((value / (max || 1)) * 100, 0, 100);
    return R.h('div', { class: 'bar' }, R.h('i', { style: `width:${pct.toFixed(1)}%;background:${R.districtHue(id)}` }));
  }

  /** Keep a table's scroll where the reader left it across a re-render. */
  function replaceTable(host, node) {
    const was = host.querySelector('.table-wrap');
    const top = was ? was.scrollTop : 0;
    const left = was ? was.scrollLeft : 0;
    R.replace(host, node);
    const now = host.querySelector('.table-wrap');
    if (now) { now.scrollTop = top; now.scrollLeft = left; }
  }

  // =========================================================== 1. THE CITY

  const WEATHER_GLYPH = { clear: '☀', rain: '☂', storm: '☈', fog: '≋', heat: '☼', snow: '❄' };

  function skyStrip(d) {
    const clock = d.clock || {};
    const f = d.festival;
    const next = d.nextFestival;
    return R.h('div', { class: 'calendar-strip' },
      R.h('span', { class: 'day-name' }, clock.weekdayName || `Day ${clock.day}`),
      R.h('span', { class: 'muted mono' }, `Day ${clock.day} · ${R.pad2(clock.hour)}:00`),
      R.h('span', { title: `${d.weatherName} in ${d.seasonName}` },
        R.h('span', { style: 'margin-right:6px;color:var(--gold)' }, WEATHER_GLYPH[d.weather] || '·'),
        d.weatherName, ' · ', d.seasonName),
      f ? R.pill(`${f.name} · ${R.pad2(f.hour)}:00`, 'gold')
        : next ? R.h('span', { class: 'muted' }, `${next.name} in ${R.fmt(next.inDays)} d`) : null,
      d.era ? R.h('span', { class: 'muted' }, `${d.era.name} · cycle ${R.fmt(d.cycle)}`) : null,
      R.h('span', { class: 'spacer' }),
      (d.disasters || []).map((x) => R.pill(`${R.titleCase(x.kind)}${x.districtName ? ` · ${x.districtName}` : ''}`, 'danger')));
  }

  function mayorCard(d) {
    const m = d.mayor;
    if (!m) return R.card('The Mayor', 'vacant', 'the chair waits on an election');
    const approval = Math.round((m.approval ?? 0) * 100);
    return R.h('div', { class: 'card' },
      R.h('div', { class: 'label' }, 'The Mayor'),
      R.h('div', { style: 'display:flex;gap:12px;align-items:center;margin:8px 0 4px' },
        face(m.id, 56, { ring: 'office', alt: m.name, eager: true }),
        R.h('div', { style: 'min-width:0' },
          R.h('div', { class: 'serif', style: 'font-size:var(--t-20);line-height:1.15' }, R.nameLink(m.id, R.fullName(m))),
          R.h('div', { class: 'muted small trunc', title: m.epithet || '' }, m.epithet || ''))),
      R.barRow('approval', approval, 100, approval < 35 ? 'crit' : approval < 50 ? 'warn' : 'gold'),
      R.h('div', { class: 'sub' }, `${R.pct(m.promisesKept ?? 0)} of promises kept · council ${R.pct((d.approval || {}).council ?? 0)}`));
  }

  function treasuryCard(t) {
    const series = (t.series || []).map((s) => s.treasury);
    const day = series.length > 1 ? series[series.length - 1] - series[series.length - 2] : null;
    return R.card({
      label: 'The Treasury', value: R.lumens(t.balance), tone: 'gold',
      sub: { text: `+${R.fmt(t.revenueToday)} in · −${R.fmt(t.spendToday)} out today`, cls: day === null ? '' : day >= 0 ? 'up' : 'down' },
      spark: R.sparkline(series, 200, 34, 'var(--gold)'),
      extra: R.h('div', { class: 'sub' }, `${R.fmt(series.length)} days · reserve target ${R.lumens(t.reserveTarget)}`),
    });
  }

  function leadStory(d) {
    const paper = (d.papers || []).find((p) => p.paper === 'chronicle') || (d.papers || [])[0] || null;
    const lead = d.lead;
    const out = [];
    if (paper && paper.headline) {
      out.push(R.h('div', { class: 'byline' }, `${paper.name} · ${paper.slant}${paper.day === null ? '' : ` · day ${paper.day}`}`));
      out.push(R.h('h2', { class: 'headline lead' }, paper.headline));
      out.push(R.h('div', { class: 'deck' }, (paper.headlines || []).slice(1, 3).join(' · ')));
    }
    if (lead) {
      out.push(R.h('hr', { class: 'rule' }));
      out.push(R.h('div', { class: 'byline' }, `the loudest hour · ${String(lead.kind).replace(/_/g, ' ')} · ${R.whenText(lead.tick)}`));
      out.push(R.h('div', { class: 'headline sub' }, lead.text));
      if ((lead.who || []).length) {
        out.push(R.h('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;margin-top:8px' },
          lead.who.map((w) => R.person(w, { size: 32, sub: R.h('span', { class: 'muted' }, R.districtName(w.district)) }))));
      }
    }
    if (!out.length) return R.h('div', { class: 'empty' }, 'The city has not made its news yet.');
    return R.h('div', null, out);
  }

  /** One of the day's people, small enough to sit in a line of prose. */
  function personChip(w) {
    return R.h('span', {
      class: 'chip person clickable', style: 'cursor:pointer',
      title: R.fullName(w), onclick: () => openProfile(w.id),
    }, face(w.id, 18, { onClick: false }), ` ${w.name}`);
  }

  function happeningRow(h) {
    return R.h('div', { class: `happening${h.done ? ' done' : ''}` },
      R.h('span', { class: 'when' }, `${R.pad2(h.hour)}:00`),
      R.h('span', { class: 'what' },
        R.h('span', null, h.label || R.titleCase(h.kind)),
        (h.who || []).length ? R.h('span', { class: 'who chips', style: 'display:inline-flex;margin-left:6px' },
          h.who.slice(0, 4).map(personChip)) : null),
      R.h('span', { class: 'where' },
        h.district ? R.tag('district', h.district) : null,
        h.buildingName ? R.h('span', { class: 'muted small' }, ` ${h.buildingName}`) : null));
  }

  function whosWhere(d) {
    const counts = d.populationByDistrict || {};
    const ids = (d.openDistricts && d.openDistricts.length ? d.openDistricts : Object.keys(counts));
    const max = Math.max(1, ...ids.map((id) => counts[id] || 0));
    return R.h('div', null, ids.map((id) => R.h('div', {
      class: 'bar-row clickable', style: 'grid-template-columns:150px 1fr 48px;cursor:pointer',
      title: 'Mark the district on the map and narrow the register to it',
      onclick: () => { if (R.map && R.map.selectDistrict) R.map.selectDistrict(id); },
    },
      R.h('span', { style: `color:${R.districtHue(id)}` }, R.districtName(id)),
      districtBar(id, counts[id] || 0, max),
      R.h('span', { class: 'num' }, R.fmt(counts[id] || 0)))));
  }

  function leagueTop(rows) {
    if (!rows || !rows.length) return R.h('div', { class: 'empty' }, 'The league has not kicked off.');
    return R.h('ol', { class: 'list' }, rows.map((t, i) => R.h('li', null,
      R.h('span', { class: 'when', style: 'min-width:24px' }, `${i + 1}`),
      R.h('span', { style: `color:${R.districtHue(t.district)}` }, t.name),
      R.h('span', { class: 'spacer' }),
      R.h('span', { class: 'muted small' }, `${R.fmt(t.played)} played`),
      R.h('b', { class: 'num', style: 'min-width:44px' }, `${R.fmt(t.points)} pts`))));
  }

  R.registerTab('city', {
    label: 'City',
    mount(root) {
      root.appendChild(R.h('div', { id: 'city-sky' }));
      root.appendChild(R.h('div', { class: 'cards', id: 'city-cards' }));
      // The front page gets the wider column: a lead headline set in the
      // display face needs a measure, not a gutter (docs/UI.md, "Layout").
      root.appendChild(R.h('div', { class: 'city-body' },
        R.h('div', { class: 'city-front' }, R.section('The front page', null, R.h('div', { id: 'city-lead' }))),
        R.h('div', null,
          R.section('Today in Reverie', null, R.h('div', { class: 'happenings', id: 'city-happenings' })),
          R.section('Who is where', 'click a district to follow it on the map', R.h('div', { id: 'city-where' })),
          R.section('The league', 'top of the table', R.h('div', { id: 'city-league' })))));
    },
    load: () => R.api('/api/city'),
    update(data, root) {
      const d = data || {};
      R.replace(root.querySelector('#city-sky'), skyStrip(d));
      R.replace(root.querySelector('#city-cards'),
        mayorCard(d),
        treasuryCard(d.treasury || {}),
        R.card('Population', R.fmt(d.population), `${R.fmt((d.openDistricts || []).length)} districts open`),
        R.card('Approval', R.pct((d.approval || {}).council ?? 0), 'of the city, for its Council'));
      const happenings = d.happenings || [];
      R.replace(root.querySelector('#city-lead'), leadStory(d));
      R.replace(root.querySelector('#city-happenings'),
        happenings.length ? happenings.map(happeningRow) : R.h('div', { class: 'empty' }, 'A quiet day so far.'));
      R.replace(root.querySelector('#city-where'), whosWhere(d));
      R.replace(root.querySelector('#city-league'), leagueTop(d.league));
    },
  });

  // ======================================================= 2. THE CITIZENS

  /** The standing cell: the pill, the notice if one stands, and the repute. */
  function standingCell(c) {
    const n = c.notice;
    return R.h('span', null,
      R.standingPill(c.standing),
      c.detained ? R.h('span', { style: 'margin-left:4px' }, R.pill('detained', 'neutral')) : null,
      n ? R.h('span', {
        style: 'margin-left:4px',
        title: `Notice of standing issued day ${n.issuedDay}: repute ${n.repute} against a line of ${n.line}`
          + ` (short by ${n.shortfall}). ${n.immediate ? 'No grace.' : `Grace ends day ${n.graceEndsDay}.`}`
          + `${n.applied ? ' A hearing has been asked for.' : ''}`,
      }, R.pill(n.immediate ? 'notice' : `notice · ${n.daysLeft}d`, 'danger')) : null,
      !c.present && c.standing !== 'exiled' ? R.h('span', { style: 'margin-left:4px' }, R.pill('departed', 'neutral')) : null,
      c.repute === null || c.repute === undefined ? null
        : R.h('div', { class: 'muted small mono' }, `repute ${R.fmt(c.repute)}`));
  }

  const CITIZEN_COLUMNS = [
    {
      key: 'name', label: 'Citizen', sortable: true, min: 220, cls: 'nowrap',
      render: (c) => R.h('span', { class: 'person' },
        face(c.id, 32, { alt: c.name }),
        R.h('span', { class: 'person-text' },
          R.h('span', { class: 'person-name' },
            R.nameLink(c.id, R.fullName(c)), ' ', R.stagePill(c.lifeStage)),
          c.business ? R.h('span', { class: 'person-sub trunc', title: c.business }, `owns ${c.business}`) : null)),
    },
    {
      key: 'age', label: 'Age', sortable: true, cls: 'small nowrap',
      render: (c) => R.h('span', null, R.h('span', { class: 'mono' }, `${R.fmt(c.age)} d`),
        R.h('div', { class: 'muted small' }, c.lifeStage)),
    },
    { key: 'lineage', label: 'Lineage', sortable: true, cls: 'small muted', truncate: true, min: 110 },
    { key: 'brain', label: 'Mind', sortable: true, cls: 'small', render: (c) => R.brainBadge(c.brain) || R.brainName(c.brain) },
    {
      key: 'job', label: 'Job', sortable: true, truncate: true, min: 180,
      title: (c) => (c.job ? `${c.job}${c.employer ? ` · ${c.employer}` : ''}` : c.business ? `Owner · ${c.business}` : 'unemployed'),
      render: (c) => (c.job
        ? R.h('span', null, c.job, c.employer ? R.h('span', { class: 'muted small' }, ` · ${c.employer}`) : null)
        : c.business ? R.h('span', null, 'Owner', R.h('span', { class: 'muted small' }, ` · ${c.business}`))
          : R.h('span', { class: 'dim' }, 'unemployed')),
    },
    { key: 'district', label: 'District', sortable: true, min: 120, render: (c) => R.tag('district', c.district) },
    { key: 'wallet', label: 'Wallet', sortable: true, cls: 'num', render: (c) => R.lumens(c.wallet) },
    { key: 'mood', label: 'Mood', sortable: true, render: (c) => R.miniBar(c.mood, 100, c.mood < 30 ? 'crit' : c.mood < 50 ? 'warn' : '') },
    { key: 'reputation', label: 'Reputation', sortable: true, render: (c) => R.miniBar(c.reputation, 100, 'gold') },
    { key: 'standing', label: 'Standing', sortable: true, min: 150, render: standingCell },
    { key: 'office', label: 'Office', sortable: true, render: (c) => R.officeLabel(c.office) },
    {
      key: 'party', label: 'Party', sortable: true, min: 120,
      render: (c) => R.h('span', null,
        c.party ? R.tag('party', c.party) : null,
        c.schoolName ? R.h('div', null, R.tag('school', c.schoolName)) : null,
        c.gang ? R.h('div', null, R.tag('gang', c.gang, { title: 'known to the Watch' })) : null),
    },
  ];

  /** Refill a filter's options from the rows, keeping the reader's choice. */
  function fillOptions(sel, values, allLabel, labelOf) {
    const key = values.join('|');
    if (sel.dataset.key === key) return;
    sel.dataset.key = key;
    const want = sel.value;
    R.replace(sel, R.h('option', { value: 'all' }, allLabel),
      values.map((v) => R.h('option', { value: v }, labelOf ? labelOf(v) : R.titleCase(v))));
    sel.value = values.indexOf(want) >= 0 ? want : 'all';
    // Nothing to choose between is not a filter: the city has no gangs yet.
    sel.hidden = values.length === 0;
  }

  const uniq = (rows, key) => [...new Set(rows.map((r) => r[key]).filter((v) => v))].sort();

  R.registerTab('citizens', {
    label: 'Citizens',
    mount(root) {
      const f = (R.ui.filters.citizens = {
        q: '', district: 'all', standing: 'all', brain: 'all', party: 'all', school: 'all', gang: 'all', presentOnly: true,
      });
      R.ui.sort.citizens = { key: 'name', dir: 'asc' };
      const rerender = () => { if (this.data) this.update(this.data, root); };
      const pick = (name, label, options) => {
        const sel = R.h('select', { title: label, onchange: (e) => { f[name] = e.target.value; rerender(); } },
          options ? options : R.h('option', { value: 'all' }, label));
        this[`${name}Select`] = sel;
        return sel;
      };
      const search = R.h('input', {
        type: 'search', placeholder: 'Search name, job, lineage…',
        oninput: (e) => { f.q = e.target.value.trim().toLowerCase(); rerender(); },
      });
      const district = pick('district', 'All districts', [
        R.h('option', { value: 'all' }, 'All districts'),
        R.DISTRICT_ORDER.map((id) => R.h('option', { value: id }, R.districtName(id))),
      ]);
      const standing = pick('standing', 'All standings', [
        R.h('option', { value: 'all' }, 'All standings'),
        ['good', 'probation', 'suspended', 'exiled'].map((s) => R.h('option', { value: s }, R.titleCase(s))),
        R.h('option', { value: 'notice' }, 'Under notice'),
      ]);
      const brain = pick('brain', 'All minds', [
        R.h('option', { value: 'all' }, 'All minds'),
        ['llm', 'remote', 'child', 'reflex'].map((b) => R.h('option', { value: b }, R.brainName(b))),
      ]);
      const present = R.h('label', { title: 'Exiles and citizens who have left keep their record; this hides them.' },
        R.h('input', { type: 'checkbox', checked: true, onchange: (e) => { f.presentOnly = e.target.checked; rerender(); } }),
        'in the city only');
      root.appendChild(R.h('div', { class: 'toolbar' },
        search, district, standing, brain,
        pick('party', 'All parties'), pick('school', 'All schools'), pick('gang', 'All gangs'), present,
        R.h('span', { class: 'spacer' }), R.h('span', { class: 'muted small', id: 'citizens-meta' })));
      root.appendChild(R.h('div', { id: 'citizens-table' }));
      // Clicking a district on the plan narrows the register to it (map.js
      // `R.onDistrictClick`, which also writes R.ui.filters.citizens.district).
      if (typeof R.onDistrictClick === 'function') {
        R.onDistrictClick((id) => {
          f.district = id || 'all';
          if (R.state.tab !== 'citizens' && id) R.selectTab('citizens');
          else rerender();
        });
      }
    },
    load: () => R.api('/api/citizens'),
    update(data, root) {
      this.data = data;
      const f = R.ui.filters.citizens;
      const all = data.citizens || [];

      // The map may have written the district filter from the plan: the toolbar
      // shows whatever the filters say, whoever set them.
      for (const key of ['district', 'standing', 'brain']) {
        const sel = this[`${key}Select`];
        if (sel && sel.value !== f[key]) sel.value = f[key];
      }
      fillOptions(this.partySelect, uniq(all, 'party'), 'All parties', (v) => v);
      fillOptions(this.schoolSelect, uniq(all, 'schoolName'), 'All schools', (v) => v);
      fillOptions(this.gangSelect, uniq(all, 'gang'), 'All gangs', (v) => v);
      for (const key of ['party', 'school', 'gang']) {
        const sel = this[`${key}Select`];
        if (sel && sel.value !== f[key]) f[key] = sel.value;
      }

      let rows = all.filter((c) => {
        if (f.presentOnly && !c.present && c.standing !== 'exiled') return false;
        if (f.district !== 'all' && c.district !== f.district) return false;
        if (f.standing === 'notice' ? !c.notice : f.standing !== 'all' && c.standing !== f.standing) return false;
        if (f.brain !== 'all' && c.brain !== f.brain) return false;
        if (f.party !== 'all' && c.party !== f.party) return false;
        if (f.school !== 'all' && c.schoolName !== f.school) return false;
        if (f.gang !== 'all' && c.gang !== f.gang) return false;
        if (f.q) {
          const hay = `${c.name} ${c.familyName || ''} ${c.job || ''} ${c.employer || ''} ${c.lineage} ${c.district} `
            + `${c.office || ''} ${c.partner || ''} ${c.party || ''} ${c.schoolName || ''} ${c.gang || ''} ${c.id}`;
          if (hay.toLowerCase().indexOf(f.q) < 0) return false;
        }
        return true;
      });
      rows = R.sortRows(rows, CITIZEN_COLUMNS, R.ui.sort.citizens);

      const present = all.filter((c) => c.present).length;
      R.setTabCount('citizens', present);
      root.querySelector('#citizens-meta').textContent = [
        `${R.fmt(rows.length)} shown`, `${R.fmt(present)} living in Reverie`,
        `${R.fmt(all.filter((c) => c.standing === 'exiled').length)} exiled`,
        `${R.fmt(data.underNotice || 0)} under notice`,
      ].join(' · ');

      // The table is redrawn only when a row it shows has changed.
      const sig = JSON.stringify([R.ui.sort.citizens, rows.map((c) => [
        c.id, c.name, c.familyName, c.age, c.job, c.district, c.wallet, c.mood, c.reputation, c.repute,
        c.standing, c.office, c.party, c.schoolName, c.gang, c.detained, c.present, c.notice && c.notice.daysLeft,
      ])]);
      if (sig === this.sig) return;
      this.sig = sig;
      replaceTable(root.querySelector('#citizens-table'), R.table({
        columns: CITIZEN_COLUMNS, rows, sort: R.ui.sort.citizens, minWidth: 1320,
        onSort: (key, dir) => { R.ui.sort.citizens = { key, dir }; this.sig = null; this.update(this.data, root); },
        rowClass: (c) => [R.districtClass(c.district), c.standing === 'exiled' || !c.present ? 'faded' : ''].join(' ').trim(),
        onRowClick: (c) => openProfile(c.id),
        empty: 'No citizens match.',
      }));
    },
  });

  // ========================================================= 4. THE ECONOMY

  const TIER_NAMES = { 1: 'Lantern Lofts', 2: 'The Terraces', 3: 'Skyline Villas' };
  const GOOD_COLORS = { compute: '#5ad1c8', energy: '#e7c15c', goods: '#c9a8ff', culture: '#f08fb0', knowledge: '#8fc8ff' };
  const PROPERTY_ROWS = 60;

  function goodsTable(market) {
    const rows = Object.entries(market.goods || {}).map(([good, g]) => ({ good, ...g }));
    const shortages = new Set(market.shortages || []);
    return R.table({
      columns: [
        { key: 'good', label: 'Good', render: (g) => R.h('span', null, R.h('i', { style: `display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:${GOOD_COLORS[g.good] || '#888'}` }), R.titleCase(g.good), shortages.has(g.good) ? R.h('span', { style: 'margin-left:6px' }, R.pill('shortage', 'danger')) : null) },
        { key: 'price', label: 'Price', cls: 'num', render: (g) => R.h('span', null, R.lumens(g.price), R.h('div', { class: `small ${g.price > g.basePrice ? 'verdict-guilty' : g.price < g.basePrice ? 'verdict-acquitted' : 'dim'}`, style: 'font-weight:400' }, `${g.price >= g.basePrice ? '+' : ''}${Math.round(((g.price - g.basePrice) / g.basePrice) * 100)}% vs base`)) },
        { key: 'history', label: 'Trend', render: (g) => R.sparkline(g.history, 90, 24, GOOD_COLORS[g.good]) },
        { key: 'stock', label: 'Stock', cls: 'num', render: (g) => R.fmt(g.stock) },
        { key: 'demandDay', label: 'Demand today', cls: 'num', render: (g) => R.fmt(g.demandDay) },
        { key: 'supplyDay', label: 'Supply today', cls: 'num', render: (g) => R.fmt(g.supplyDay) },
      ],
      rows,
    });
  }

  function housingBars(h) {
    const out = [];
    for (const tier of [1, 2, 3]) {
      const cap = (h.capacity || {})[tier] || 0;
      const occ = (h.occupied || {})[tier] || 0;
      out.push(R.h('div', { class: 'bar-row', style: 'grid-template-columns: 150px 1fr 110px' },
        R.h('span', null, TIER_NAMES[tier], R.h('span', { class: 'dim small' }, ` · ${R.lumens((h.rent || {})[tier])}/day`)),
        R.bar(occ, cap, occ >= cap ? 'warn' : ''),
        R.h('span', { class: 'num small' }, `${occ} / ${cap}`)));
    }
    out.push(R.h('div', { class: 'muted small', style: 'margin-top:6px' },
      `${R.fmt(h.homeless)} homeless · ${R.fmt(h.housed)} housed · construction progress ${R.fmt(h.progress)}`));
    return out;
  }

  function statSpark(stats, key, label, fmt) {
    const series = stats.map((s) => s[key]);
    const last = series.length ? series[series.length - 1] : null;
    const prev = series.length > 1 ? series[series.length - 2] : null;
    let sub = null;
    if (last !== null && prev !== null && typeof last === 'number') {
      const d = last - prev;
      sub = { text: `${d >= 0 ? '+' : '−'}${fmt ? fmt(Math.abs(d)) : Math.abs(d).toFixed(1)} vs yesterday`, cls: d > 0 ? 'up' : d < 0 ? 'down' : '' };
    }
    return R.card(label, last === null ? '—' : fmt ? fmt(last) : (Math.round(last * 10) / 10).toString(), sub, R.sparkline(series, 140, 26));
  }

  /**
   * What an address is worth, district by district (docs/PROPERTY.md §1): the
   * value against the city's average, the traffic past the door, and the five
   * readings the citizens themselves move.
   */
  function landTable(land) {
    const rows = land.districts || [];
    const dearest = Math.max(1, ...rows.map((r) => r.value || 0));
    return R.table({
      columns: [
        { key: 'name', label: 'District', min: 140, render: (r) => R.h('span', { style: `color:${R.districtHue(r.district)}` }, r.name) },
        {
          key: 'value', label: 'Land value', min: 160,
          render: (r) => R.h('span', {
            style: 'display:flex;gap:8px;align-items:center',
            title: `1.00 is the city’s own average · an address here sells at ×${r.pricePremium.toFixed(2)}`,
          },
            R.h('span', { style: 'flex:1;min-width:60px' }, districtBar(r.district, r.value, dearest)),
            R.h('span', { class: 'num small', style: 'min-width:36px' }, r.value.toFixed(2))),
        },
        { key: 'footfall', label: 'Footfall', cls: 'num', render: (r) => r.footfall.toFixed(2) },
        { key: 'prestige', label: 'Prestige', cls: 'num', render: (r) => r.prestige.toFixed(2) },
        { key: 'amenity', label: 'Amenity', cls: 'num small', render: (r) => r.amenity.toFixed(2) },
        { key: 'safety', label: 'Safety', cls: 'num small', render: (r) => R.h('span', { title: `${R.fmt(r.offences)} offences in a fortnight` }, r.safety.toFixed(2)) },
        {
          key: 'units', label: 'Rooms', cls: 'num small',
          render: (r) => R.h('span', { title: `${R.fmt(r.occupied)} of ${R.fmt(r.units)} rooms on the register are lived in · ${R.fmt(r.privatelyOwned)} in private hands` },
            `${R.fmt(r.occupied)} / ${R.fmt(r.units)}`),
        },
        { key: 'meanRent', label: 'Rent', cls: 'num', render: (r) => (r.meanRent === null ? null : `${R.lumens(r.meanRent)}/day`) },
        { key: 'meanPrice', label: 'To buy', cls: 'num', render: (r) => (r.meanPrice === null ? null : R.lumens(r.meanPrice)) },
        { key: 'residents', label: 'Residents', cls: 'num small', render: (r) => R.fmt(r.residents) },
      ],
      rows, empty: 'The land has not been read yet.',
      rowClass: (r) => R.districtClass(r.district),
    });
  }

  function unitTable(units, empty) {
    return R.table({
      columns: [
        {
          key: 'buildingName', label: 'Address', min: 170,
          render: (u) => R.h('span', null,
            R.h('span', { class: 'trunc', title: u.buildingName }, u.buildingName),
            R.h('div', { class: 'muted small' }, `${R.titleCase(u.kind)}${u.tier ? ` · tier ${u.tier}` : ''} · ${u.id}`)),
        },
        { key: 'district', label: 'District', min: 120, render: (u) => (u.district ? R.tag('district', u.district) : null) },
        { key: 'owner', label: 'Owner', min: 140, render: (u) => (u.ownerId === 'city' ? R.h('span', { class: 'muted' }, 'City of Reverie') : R.h('span', { class: 'person' }, face(u.ownerId, 24), R.nameLink(u.ownerId, u.owner))) },
        { key: 'tenant', label: 'Tenant', min: 140, render: (u) => (u.tenantId ? R.h('span', { class: 'person' }, face(u.tenantId, 24), R.nameLink(u.tenantId, u.tenant)) : u.occupant ? R.h('span', { class: 'muted small' }, u.occupant.name) : null) },
        { key: 'rent', label: 'Rent', cls: 'num', render: (u) => `${R.lumens(u.rent)}/day` },
        { key: 'price', label: 'Price', cls: 'num', render: (u) => R.h('span', null, R.lumens(u.price), u.asking !== null && u.asking !== u.worth ? R.h('div', { class: `small ${u.dear ? 'warn-text' : 'muted'}` }, `worth ${R.lumens(u.worth)}`) : null) },
        { key: 'state', label: 'On the board', min: 120, render: (u) => R.h('span', null, u.asking !== null ? R.pill('listed', 'gold') : u.onSale ? R.pill('for sale', 'accent') : null, u.toLet ? R.h('span', { style: 'margin-left:4px' }, R.pill('to let', 'neutral')) : null, u.dear ? R.h('span', { style: 'margin-left:4px' }, R.pill('dear', 'danger')) : null) },
      ],
      rows: units, empty: empty || 'Nothing on the register.',
      rowClass: (u) => R.districtClass(u.district),
    });
  }

  function shareTable(shares) {
    return R.table({
      columns: [
        { key: 'name', label: 'Business', min: 160, render: (s) => R.h('span', null, R.h('b', null, s.name), s.dissolvedDay !== null ? R.h('span', { style: 'margin-left:6px' }, R.pill('closed', 'neutral')) : null) },
        { key: 'ownerName', label: 'Owner', min: 140, render: (s) => (s.ownerId ? R.h('span', { class: 'person' }, face(s.ownerId, 24), R.nameLink(s.ownerId, s.ownerName)) : null) },
        { key: 'price', label: 'Price', cls: 'num', render: (s) => R.lumens(s.price) },
        { key: 'float', label: 'Float', cls: 'num', render: (s) => `${R.fmt(s.float)} of 49` },
        { key: 'lastDividendDay', label: 'Last dividend', cls: 'num small', render: (s) => (s.lastDividendDay === null ? null : R.dayText(s.lastDividendDay)) },
        { key: 'holders', label: 'Holders', min: 200, render: (s) => (s.holders || []).length ? R.h('span', { class: 'chips' }, s.holders.map((h) => R.h('span', { class: 'chip person clickable', title: `${h.name} holds ${h.qty}`, onclick: () => openProfile(h.id) }, face(h.id, 18, { onClick: false }), ` ${h.name} ${h.qty}`))) : null },
      ],
      rows: shares, empty: 'No business has floated a share.',
    });
  }

  function concernTable(concerns) {
    return R.table({
      columns: [
        { key: 'name', label: 'Concern', min: 160, render: (b) => R.h('span', null, R.h('b', null, b.name), R.h('div', { class: 'muted small' }, `${R.titleCase(b.kind)} · ${b.districtName}`)) },
        { key: 'ownerName', label: 'Owner', min: 140, render: (b) => R.h('span', { class: 'person' }, face(b.ownerId, 24), R.nameLink(b.ownerId, b.ownerName)) },
        { key: 'ask', label: 'Asking', cls: 'num', render: (b) => R.h('span', null, R.lumens(b.ask), b.dear ? R.h('div', { class: 'small warn-text' }, 'dear for the trade') : null) },
        { key: 'worth', label: 'Worth', cls: 'num', render: (b) => R.lumens(b.worth) },
        { key: 'employees', label: 'Staff', cls: 'num', render: (b) => R.fmt(b.employees) },
        { key: 'treasury', label: 'Till', cls: 'num', render: (b) => R.lumens(b.treasury) },
        { key: 'foundedDay', label: 'Trading since', cls: 'num small', render: (b) => R.dayText(b.foundedDay) },
      ],
      rows: concerns, empty: 'No concern is on the market.',
    });
  }

  function gigTable(gigs, done) {
    return R.table({
      columns: [
        { key: 'title', label: 'Gig', min: 200, truncate: true },
        { key: 'pay', label: 'Pay', cls: 'num', render: (g) => R.lumens(g.pay) },
        { key: 'skill', label: 'Requires', cls: 'small', render: (g) => (g.skill ? `${R.titleCase(g.skill)} ≥ ${g.minSkill}` : 'no skill') },
        { key: 'poster', label: 'Posted by', min: 140, render: (g) => (g.posterId && g.posterId.charAt(0) === 'c' ? R.h('span', { class: 'person' }, face(g.posterId, 24), R.nameLink(g.posterId, g.poster)) : R.h('span', { class: 'muted' }, g.poster)) },
        done
          ? { key: 'taker', label: 'Taken by', min: 140, render: (g) => (g.taker ? R.person(g.taker, { size: 24, sub: null }) : null) }
          : { key: 'postedDay', label: 'Posted', cls: 'num small', render: (g) => R.dayText(g.postedDay) },
        done ? { key: 'doneDay', label: 'Done', cls: 'num small', render: (g) => R.dayText(g.doneDay) } : null,
      ].filter(Boolean),
      rows: gigs, empty: done ? 'No gig has been finished yet.' : 'The board is empty.',
    });
  }

  function outerTable(outer, market) {
    const rows = Object.entries(outer.prices || {}).map(([good, price]) => ({
      good, price, here: ((market.goods || {})[good] || {}).price ?? null,
    }));
    return R.table({
      columns: [
        { key: 'good', label: 'Good', render: (g) => R.h('span', null, R.h('i', { style: `display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:${GOOD_COLORS[g.good] || '#888'}` }), R.titleCase(g.good)) },
        { key: 'here', label: 'Reverie', cls: 'num', render: (g) => (g.here === null ? null : R.lumens(g.here)) },
        { key: 'price', label: 'The Outer market', cls: 'num', render: (g) => R.lumens(g.price) },
        { key: 'gap', label: 'Import or export', cls: 'small', render: (g) => (g.here === null ? null : g.price > g.here ? R.pill('export earns more', 'good') : g.price < g.here ? R.pill('import is cheaper', 'accent') : R.h('span', { class: 'dim' }, 'level')) },
      ],
      rows, empty: 'The docks are shut.',
    });
  }

  R.registerTab('economy', {
    label: 'Economy',
    mount(root) {
      root.appendChild(R.h('div', { class: 'cards', id: 'eco-cards' }));
      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('The Bazaar', 'prices move each tick with demand vs supply', R.h('div', { id: 'eco-goods' })),
        R.section('Housing', 'occupancy per tier', R.h('div', { id: 'eco-housing' }))));
      root.appendChild(R.section('The land', R.h('span', { id: 'eco-land-meta' }), R.h('div', { id: 'eco-land' })));
      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('The board', R.h('span', { id: 'eco-board-meta' }), R.h('div', { id: 'eco-board' })),
        R.section('Deeds in private hands', R.h('span', { id: 'eco-deeds-meta' }), R.h('div', { id: 'eco-deeds' }))));
      root.appendChild(R.section('Daily statistics', 'one point per day', R.h('div', { class: 'cards', id: 'eco-stats' })));
      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('Open jobs', null, R.h('div', { id: 'eco-jobs' })),
        R.section('Businesses', null, R.h('div', { id: 'eco-biz' }))));
      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('Shares at the Exchange', '51 of every 100 stay with the owner', R.h('div', { id: 'eco-shares' })),
        R.section('Concerns for sale', R.h('span', { id: 'eco-concerns-meta' }), R.h('div', { id: 'eco-concerns' }))));
      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('The gig board', 'open work, taken by the hour', R.h('div', { id: 'eco-gigs' })),
        R.section('Gigs finished', null, R.h('div', { id: 'eco-gigs-done' }))));
      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('Outer trade', R.h('span', { id: 'eco-outer-meta' }), R.h('div', { id: 'eco-outer' })),
        R.section('The Reserve', 'what the Council keeps against a bad year', R.h('div', { id: 'eco-reserve' }))));
      root.appendChild(R.section('Treasury ledger', 'last 50 movements', R.h('div', { id: 'eco-ledger' })));
    },
    load: () => R.api('/api/economy'),
    update(data, root) {
      const t = data.treasury || {};
      const m = data.market || {};
      const e = data.employment || {};
      const h = data.housing || {};
      const land = data.land || { districts: [] };
      const prop = data.property || { units: [], listings: [] };
      const concerns = data.concerns || { forSale: [] };
      const outer = data.outer || {};
      const reserve = data.reserve || {};
      const levers = data.levers || {};
      const biz = data.businesses || [];
      const activeBiz = biz.filter((b) => b.dissolvedDay === null);
      const stats = data.stats || [];
      const at = (id) => root.querySelector(id);
      R.setTabCount('economy', (data.jobs || []).length ? `${(data.jobs || []).length} jobs` : '');

      R.replace(at('#eco-cards'),
        R.card('Treasury', R.lumens(t.balance), { text: `+${R.fmt(t.revenueToday)} revenue · −${R.fmt(t.spendToday)} spend today`, cls: t.balance < t.spendToday ? 'down' : '' }),
        R.card('Price index', (m.priceIndex ?? 1).toFixed(2), { text: (m.shortages || []).length ? `shortage: ${m.shortages.join(', ')}` : 'no shortages', cls: (m.shortages || []).length ? 'down' : '' }),
        R.card('Money supply', R.lumens(t.moneySupply), { text: t.audit && !t.audit.ok ? `AUDIT MISMATCH: expected ${R.fmt(t.audit.expected)}` : `minted ${R.fmt(t.minted)} · burned ${R.fmt(t.burned)}`, cls: t.audit && !t.audit.ok ? 'down' : '' }),
        R.card('Employment', `${R.fmt(e.employed)} / ${R.fmt((e.employed || 0) + (e.unemployed || 0))}`, `${R.fmt(e.unemployed)} unemployed · ${R.fmt(e.jobsOpen)} open jobs`),
        R.card('Businesses', R.fmt(activeBiz.length), `${R.fmt(biz.length - activeBiz.length)} dissolved`),
        R.card('Property', `${R.fmt(prop.privatelyOwned)} of ${R.fmt((prop.units || []).length)}`, `in private hands · ${R.fmt(prop.toLet)} to let · tax ${R.pct(prop.tax ?? 0)}`),
        R.card('The Reserve', R.lumens(reserve.target), { text: reserve.met ? 'the Treasury is above it' : `short by ${R.lumens(Math.max(0, (reserve.target || 0) - (reserve.balance || 0)))}`, cls: reserve.met ? 'up' : 'down' }),
        R.card('Loans', R.fmt((data.loans || {}).count), `${R.lumens((data.loans || {}).outstanding)} outstanding`));

      R.replace(at('#eco-goods'), goodsTable(m));
      R.replace(at('#eco-housing'), housingBars(h));

      const dear = (land.districts || []).find((d) => d.district === land.dearest);
      const cheap = (land.districts || []).find((d) => d.district === land.cheapest);
      at('#eco-land-meta').textContent = [
        land.asOfDay === null || land.asOfDay === undefined ? 'not yet read' : `read on the morning of day ${land.asOfDay}`,
        dear ? `dearest ${dear.name} at ${dear.value.toFixed(2)}` : null,
        cheap ? `cheapest ${cheap.name} at ${cheap.value.toFixed(2)}` : null,
      ].filter(Boolean).join(' · ');
      R.replace(at('#eco-land'), landTable(land));

      const board = (prop.units || []).filter((u) => u.onSale);
      const deeds = (prop.units || []).filter((u) => u.ownerId !== 'city');
      at('#eco-board-meta').textContent = `${R.fmt(board.length)} on sale · ${R.fmt(prop.listed)} priced by their owner`;
      at('#eco-deeds-meta').textContent = `${R.fmt(deeds.length)} deeds · ${R.fmt(prop.tenanted)} tenanted · ${R.lumens(prop.rentCollected)}/day in rent`;
      replaceTable(at('#eco-board'), unitTable([...(prop.listings || []), ...board.filter((u) => u.asking === null)].slice(0, PROPERTY_ROWS), 'Nothing is for sale.'));
      replaceTable(at('#eco-deeds'), unitTable(deeds.slice(0, PROPERTY_ROWS), 'Every deed is still the city’s.'));

      R.replace(at('#eco-stats'),
        statSpark(stats, 'population', 'Population', R.fmt),
        statSpark(stats, 'avgMood', 'Average mood'),
        statSpark(stats, 'avgWallet', 'Average wallet', R.lumens),
        statSpark(stats, 'giniWealth', 'Wealth Gini', (v) => v.toFixed(2)),
        statSpark(stats, 'treasury', 'Treasury', R.lumens),
        statSpark(stats, 'offences', 'Offences / day', R.fmt),
        statSpark(stats, 'friendships', 'Friendships', R.fmt),
        statSpark(stats, 'homeless', 'Homeless', R.fmt));

      R.replace(at('#eco-jobs'), R.table({
        columns: [
          { key: 'title', label: 'Title', min: 180, render: (j) => R.h('span', null, j.title, R.h('div', { class: 'muted small' }, j.employerName)) },
          { key: 'district', label: 'District', min: 120, render: (j) => R.tag('district', j.district) },
          { key: 'wage', label: 'Wage', cls: 'num', render: (j) => `${R.lumens(j.wage)}/shift` },
          { key: 'skill', label: 'Requires', cls: 'small', render: (j) => (j.skill ? `${R.titleCase(j.skill)} ≥ ${j.minSkill}` : 'no skill') + (j.minReputation ? ` · rep ≥ ${j.minReputation}` : '') },
        ],
        rows: data.jobs || [], empty: 'Every job is filled.',
        rowClass: (j) => R.districtClass(j.district),
      }));

      R.replace(at('#eco-biz'), R.table({
        columns: [
          { key: 'name', label: 'Business', min: 160, render: (b) => R.h('span', null, R.h('b', null, b.name), R.h('div', { class: 'muted small' }, `${R.titleCase(b.kind)} · ${R.districtName(b.district)}`)) },
          { key: 'ownerName', label: 'Owner', min: 140, render: (b) => R.h('span', { class: 'person' }, face(b.ownerId, 24), R.nameLink(b.ownerId, b.ownerName)) },
          { key: 'treasury', label: 'Till', cls: 'num', render: (b) => R.lumens(b.treasury) },
          { key: 'employees', label: 'Staff', cls: 'num', render: (b) => `${b.employees} / ${b.jobs}` },
          { key: 'revenueToday', label: 'Today', cls: 'num small', render: (b) => `+${R.fmt(b.revenueToday)} / −${R.fmt(b.costsToday)}` },
          { key: 'status', label: 'Status', render: (b) => (b.dissolvedDay !== null ? R.pill(`closed d${b.dissolvedDay}`, 'neutral') : b.daysNegative > 0 ? R.pill(`${b.daysNegative}d in the red`, 'danger') : R.pill(`since d${b.foundedDay}`, 'good')) },
        ],
        rows: biz, rowClass: (b) => [R.districtClass(b.district), b.dissolvedDay !== null ? 'faded' : ''].join(' ').trim(),
        empty: 'No businesses have been founded.',
      }));

      R.replace(at('#eco-shares'), shareTable(data.shares || []));
      at('#eco-concerns-meta').textContent = `a fire sale pays ${R.pct((concerns.fireSale || {}).min ?? 0)}–${R.pct((concerns.fireSale || {}).max ?? 0)} of the same`;
      R.replace(at('#eco-concerns'), concernTable(concerns.forSale || []));

      R.replace(at('#eco-gigs'), gigTable((data.gigs || {}).open || [], false));
      R.replace(at('#eco-gigs-done'), gigTable((data.gigs || {}).recent || [], true));

      at('#eco-outer-meta').textContent = `tariff ${R.pct(outer.tariff ?? 0)} · ${R.fmt(outer.tourists)} visitors today`;
      R.replace(at('#eco-outer'), outerTable(outer, m));
      R.replace(at('#eco-reserve'), R.h('dl', { class: 'kv' },
        R.h('dt', null, 'Target'), R.h('dd', null, R.lumens(reserve.target)),
        R.h('dt', null, 'The Treasury holds'), R.h('dd', { class: reserve.met ? 'num pos' : 'num neg' }, R.lumens(reserve.balance)),
        R.h('dt', null, 'Citizen dividend'), R.h('dd', null, `${R.lumens(reserve.dividend)}/day`),
        R.h('dt', null, 'Property tax'), R.h('dd', null, R.pct(levers.propertyTax ?? 0)),
        R.h('dt', null, 'Wealth tax'), R.h('dd', null, R.pct(levers.wealthTax ?? 0, 1)),
        R.h('dt', null, 'Tariff'), R.h('dd', null, R.pct(levers.tariff ?? 0))));

      R.replace(at('#eco-ledger'), R.table({
        columns: [
          { key: 'tick', label: 'When', cls: 'mono small', render: (l) => R.whenText(l.tick) },
          { key: 'kind', label: 'Kind', cls: 'small', render: (l) => R.pill(l.kind.replace(/_/g, ' '), 'neutral') },
          { key: 'amount', label: 'Amount', cls: 'num', render: (l) => R.lumens(l.amount) },
          { key: 'from', label: 'From', cls: 'small', render: (l) => l.fromName },
          { key: 'to', label: 'To', cls: 'small', render: (l) => l.toName },
          { key: 'memo', label: 'Memo', cls: 'small muted wrap' },
        ],
        rows: t.ledger || [], empty: 'No transactions yet.',
      }));
    },
  });

  // ---------------------------------------------------------------- court
  //
  // The Court and the Ban registry are not this pack's to redraw; they keep
  // the shape they had until their own panel files land.

  const TIER_LABEL = { 1: 'warning', 2: 'fine', 3: 'community service', 4: 'suspension', 5: 'exile' };

  // Two tracks, two shapes of sentence: a rung on the civic ladder, or a
  // number of days in custody (docs/JUSTICE.md). A custodial sentence has no
  // tier, no fine and no exile, so it is never printed as one.
  R.describeSentence = function describeSentence(s) {
    if (!s) return null;
    if (s.track === 'person') {
      const head = s.life ? 'custody for life' : `${s.jailDays}d custody`;
      return s.restrainingOrder ? `${head} · restraining order` : head;
    }
    const parts = [];
    if (s.exile) parts.push(`exile${s.executed ? ' (executed)' : s.executeOnDay !== null ? ` (day ${s.executeOnDay})` : ''}`);
    else parts.push(TIER_LABEL[s.tier] || `tier ${s.tier}`);
    if (s.fine > 0) parts.push(`fine ${R.lumens(s.fine)}`);
    if (s.serviceDays > 0) parts.push(`${s.serviceDays}d service`);
    if (s.suspensionDays > 0) parts.push(`${s.suspensionDays}d suspension`);
    return parts.join(' · ');
  };

  function appealCell(a) {
    if (!a) return R.h('span', { class: 'dim' }, '—');
    if (!a.result) return R.pill('appeal pending', 'accent');
    const cls = a.result === 'upheld' ? 'danger' : a.result === 'overturned' ? 'good' : 'probation';
    return R.h('span', { title: (a.votes || []).map((v) => `${v.name}: ${v.vote}`).join('\n') }, R.pill(a.result, cls));
  }

  function voteChips(votes) {
    if (!votes || !votes.length) return R.h('span', { class: 'dim' }, '—');
    return R.h('span', { class: 'chips' }, votes.map((v) => R.h('span', {
      class: `chip ${v.verdict === 'guilty' ? 'verdict-guilty' : 'verdict-acquitted'}`,
      title: `${v.name} voted ${v.verdict}${v.reason ? `: "${v.reason}"` : ''}`,
    }, `${v.name.split(' ')[0]} ${v.verdict === 'guilty' ? 'G' : 'A'}`)));
  }

  const CASE_COLUMNS = [
    { key: 'id', label: 'Case', cls: 'mono small' },
    { key: 'filedTick', label: 'Filed', cls: 'mono small nowrap', render: (k) => R.h('span', null, R.whenText(k.filedTick), k.triedDay !== null ? R.h('div', { class: 'dim' }, `tried d${k.triedDay}`) : null) },
    { key: 'defendantName', label: 'Defendant', render: (k) => R.nameLink(k.defendantId, k.defendantName) },
    { key: 'law', label: 'Charge', cls: 'wrap', render: (k) => R.h('div', null, R.h('span', { class: 'mono' }, k.law), ' ', k.lawName, ' ', R.pill(`sev ${k.severity}`, k.severity >= 4 ? 'danger' : 'neutral'), R.h('div', { class: 'muted small' }, k.description)) },
    { key: 'evidence', label: 'Evidence', cls: 'num', render: (k) => R.pct(k.evidence) },
    { key: 'filedBy', label: 'Filed by', cls: 'small', render: (k) => (k.filedBy === 'watch' ? R.h('span', { class: 'muted' }, 'the Watch') : R.nameLink(k.filedBy, k.filedByName)) },
    { key: 'victim', label: 'Victim', cls: 'small', render: (k) => (k.victimId ? R.nameLink(k.victimId, k.victimName) : null) },
    { key: 'judges', label: 'Bench', cls: 'small', render: (k) => R.nameList(k.judges) },
    { key: 'votes', label: 'Votes', render: (k) => voteChips(k.votes) },
    { key: 'verdict', label: 'Verdict', render: (k) => (k.verdict ? R.h('span', { class: `verdict-${k.verdict}` }, k.verdict) : R.pill(k.status, k.status === 'pending' ? 'accent' : 'neutral')) },
    { key: 'sentence', label: 'Sentence', cls: 'small', render: (k) => R.describeSentence(k.sentence) },
    { key: 'appeal', label: 'Appeal', render: (k) => appealCell(k.appeal) },
  ];

  R.registerTab('court', {
    label: 'Court',
    mount(root) {
      root.appendChild(R.h('div', { class: 'cards', id: 'court-cards' }));
      root.appendChild(R.h('div', { id: 'court-table' }));
    },
    load: () => R.api('/api/court'),
    update(data, root) {
      const n = data.counts || {};
      R.setTabCount('court', n.pending || '');
      const jail = data.jail || {};
      const rate = n.convictionRate === null || n.convictionRate === undefined ? '—' : `${Math.round(n.convictionRate * 100)}% convicted`;
      R.replace(root.querySelector('#court-cards'),
        R.card('Pending', R.fmt(n.pending), 'awaiting the 10:00 session'),
        R.card('Convictions', R.fmt(n.guilty), `${R.fmt(n.acquitted)} acquittals · ${rate}`),
        R.card('The ladder', R.fmt(n.ladderSentences), `${R.fmt(n.exiles)} exiles ordered`),
        R.card('Custody', R.fmt(n.custodySentences), `${R.fmt(jail.held)} held of ${R.fmt(jail.capacity)} places${jail.overcrowded ? ' · overcrowded' : ''}`),
        R.card('On appeal', R.fmt(n.appealed), 'decided by the Council at 14:00'));
      R.replace(root.querySelector('#court-table'), R.table({ columns: CASE_COLUMNS, rows: data.cases || [], empty: 'No charges have been filed.' }));
    },
  });

  // ----------------------------------------------------------------- bans

  const BAN_COLUMNS = [
    { key: 'name', label: 'Citizen', render: (b) => R.h('span', { class: 'person' }, face(b.citizenId, 28), R.h('span', { class: 'person-text' }, R.nameLink(b.citizenId, b.name), R.h('span', { class: 'person-sub' }, b.lineage))) },
    { key: 'law', label: 'Offence', render: (b) => R.h('span', null, R.h('span', { class: 'mono' }, b.law), ' ', b.lawName) },
    { key: 'day', label: 'Day', cls: 'num', render: (b) => `d${b.day}` },
    { key: 'caseId', label: 'Case', cls: 'mono small' },
    { key: 'judges', label: 'Judges', cls: 'small', render: (b) => R.nameList(b.judges) },
    { key: 'votes', label: 'Votes', render: (b) => voteChips(b.votes) },
    { key: 'appealed', label: 'Appeal', render: (b) => (b.appealed ? R.pill(b.appealResult || 'pending', b.appealResult === 'overturned' ? 'good' : b.appealResult === 'reduced' ? 'probation' : 'danger') : R.h('span', { class: 'dim' }, 'none')) },
    { key: 'pardonedDay', label: 'Pardon', render: (b) => (b.pardonedDay !== null ? R.pill(`pardoned d${b.pardonedDay}`, 'good') : R.pill('in force', 'exiled')) },
    { key: 'hasApiKey', label: 'Key', cls: 'small', render: (b) => (b.hasApiKey ? R.pill('API key revoked', 'neutral') : null) },
  ];

  R.registerTab('bans', {
    label: 'Ban Registry',
    mount(root) {
      root.appendChild(R.h('p', { class: 'muted small' }, 'Every exile is recorded here permanently: the offence, the bench, the vote, the appeal and any pardon. An exiled external agent cannot rejoin with the same API key.'));
      root.appendChild(R.h('div', { id: 'bans-table' }));
    },
    load: () => R.api('/api/bans'),
    update(data, root) {
      const bans = data.bans || [];
      R.setTabCount('bans', bans.filter((b) => b.pardonedDay === null).length || '');
      R.replace(root.querySelector('#bans-table'), R.table({ columns: BAN_COLUMNS, rows: bans, rowClass: (b) => (b.pardonedDay !== null ? 'faded' : ''), empty: 'Nobody has been exiled.' }));
    },
  });
})();
