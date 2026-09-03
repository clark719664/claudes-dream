/*
 * Reverie dashboard — Economy and Government tabs.
 */
(function () {
  'use strict';
  const R = window.R;

  const TIER_NAMES = { 1: 'Lantern Lofts', 2: 'The Terraces', 3: 'Skyline Villas' };
  const GOOD_COLORS = { compute: '#5ad1c8', energy: '#e7c15c', goods: '#c9a8ff', culture: '#f08fb0', knowledge: '#8fc8ff' };

  // -------------------------------------------------------------- economy

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
      const cap = h.capacity[tier] || 0;
      const occ = h.occupied[tier] || 0;
      out.push(R.h('div', { class: 'bar-row', style: 'grid-template-columns: 150px 1fr 110px' },
        R.h('span', null, TIER_NAMES[tier], R.h('span', { class: 'dim small' }, ` · ${R.lumens(h.rent[tier])}/day`)),
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

  R.registerTab('economy', {
    label: 'Economy',
    mount(root) {
      root.appendChild(R.h('div', { class: 'cards', id: 'eco-cards' }));
      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('The Bazaar', 'prices move each tick with demand vs supply', R.h('div', { id: 'eco-goods' })),
        R.section('Housing', 'occupancy per tier', R.h('div', { id: 'eco-housing' }))));
      root.appendChild(R.section('Daily statistics', 'one point per day', R.h('div', { class: 'cards', id: 'eco-stats' })));
      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('Open jobs', null, R.h('div', { id: 'eco-jobs' })),
        R.section('Businesses', null, R.h('div', { id: 'eco-biz' }))));
      root.appendChild(R.section('Treasury ledger', 'last 50 movements', R.h('div', { id: 'eco-ledger' })));
    },
    load: () => R.api('/api/economy'),
    update(data, root) {
      const t = data.treasury || {};
      const m = data.market || {};
      const e = data.employment || {};
      const h = data.housing || {};
      const biz = data.businesses || [];
      const activeBiz = biz.filter((b) => b.dissolvedDay === null);
      const stats = data.stats || [];
      R.setTabCount('economy', (data.jobs || []).length ? `${(data.jobs || []).length} jobs` : '');

      R.replace(root.querySelector('#eco-cards'),
        R.card('Treasury', R.lumens(t.balance), { text: `+${R.fmt(t.revenueToday)} revenue · −${R.fmt(t.spendToday)} spend today`, cls: t.balance < t.spendToday ? 'down' : '' }),
        R.card('Price index', (m.priceIndex ?? 1).toFixed(2), { text: (m.shortages || []).length ? `shortage: ${m.shortages.join(', ')}` : 'no shortages', cls: (m.shortages || []).length ? 'down' : '' }),
        R.card('Money supply', R.lumens(t.moneySupply), { text: t.audit && !t.audit.ok ? `AUDIT MISMATCH: expected ${R.fmt(t.audit.expected)}` : `minted ${R.fmt(t.minted)} · burned ${R.fmt(t.burned)}`, cls: t.audit && !t.audit.ok ? 'down' : '' }),
        R.card('Employment', `${R.fmt(e.employed)} / ${R.fmt((e.employed || 0) + (e.unemployed || 0))}`, `${R.fmt(e.unemployed)} unemployed · ${R.fmt(e.jobsOpen)} open jobs`),
        R.card('Businesses', R.fmt(activeBiz.length), `${R.fmt(biz.length - activeBiz.length)} dissolved`),
        R.card('Loans', R.fmt((data.loans || {}).count), `${R.lumens((data.loans || {}).outstanding)} outstanding`));

      R.replace(root.querySelector('#eco-goods'), goodsTable(m));
      R.replace(root.querySelector('#eco-housing'), housingBars(h));
      R.replace(root.querySelector('#eco-stats'),
        statSpark(stats, 'population', 'Population', R.fmt),
        statSpark(stats, 'avgMood', 'Average mood'),
        statSpark(stats, 'avgWallet', 'Average wallet', R.lumens),
        statSpark(stats, 'giniWealth', 'Wealth Gini', (v) => v.toFixed(2)),
        statSpark(stats, 'treasury', 'Treasury', R.lumens),
        statSpark(stats, 'offences', 'Offences / day', R.fmt),
        statSpark(stats, 'friendships', 'Friendships', R.fmt),
        statSpark(stats, 'homeless', 'Homeless', R.fmt));

      R.replace(root.querySelector('#eco-jobs'), R.table({
        columns: [
          { key: 'title', label: 'Title', render: (j) => R.h('span', null, j.title, R.h('div', { class: 'muted small' }, j.employerName)) },
          { key: 'district', label: 'District', cls: 'small', render: (j) => R.districtName(j.district) },
          { key: 'wage', label: 'Wage', cls: 'num', render: (j) => `${R.lumens(j.wage)}/shift` },
          { key: 'skill', label: 'Requires', cls: 'small', render: (j) => (j.skill ? `${R.titleCase(j.skill)} ≥ ${j.minSkill}` : 'no skill') + (j.minReputation ? ` · rep ≥ ${j.minReputation}` : '') },
        ],
        rows: data.jobs || [], empty: 'Every job is filled.',
      }));

      R.replace(root.querySelector('#eco-biz'), R.table({
        columns: [
          { key: 'name', label: 'Business', render: (b) => R.h('span', null, R.h('b', null, b.name), R.h('div', { class: 'muted small' }, `${R.titleCase(b.kind)} · ${R.districtName(b.district)}`)) },
          { key: 'ownerName', label: 'Owner', render: (b) => R.nameLink(b.ownerId, b.ownerName) },
          { key: 'treasury', label: 'Till', cls: 'num', render: (b) => R.lumens(b.treasury) },
          { key: 'employees', label: 'Staff', cls: 'num', render: (b) => `${b.employees} / ${b.jobs}` },
          { key: 'revenueToday', label: 'Today', cls: 'num small', render: (b) => `+${R.fmt(b.revenueToday)} / −${R.fmt(b.costsToday)}` },
          { key: 'status', label: 'Status', render: (b) => (b.dissolvedDay !== null ? R.pill(`closed d${b.dissolvedDay}`, 'neutral') : b.daysNegative > 0 ? R.pill(`${b.daysNegative}d in the red`, 'danger') : R.pill(`since d${b.foundedDay}`, 'good')) },
        ],
        rows: biz, rowClass: (b) => (b.dissolvedDay !== null ? 'faded' : ''), empty: 'No businesses have been founded.',
      }));

      R.replace(root.querySelector('#eco-ledger'), R.table({
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

  // ----------------------------------------------------------- government

  function electionBox(el) {
    if (!el) return R.h('div', { class: 'empty' }, 'No election scheduled.');
    let headline;
    if (el.electionToday) headline = R.h('span', null, R.pill('Election day', 'gold'), ` polls close at 20:00 · ${R.fmt(el.ballotsCast)} ballots so far`);
    else if (el.nominationsOpen) headline = R.h('span', null, R.pill('Nominations open', 'accent'), ` election in ${el.daysToElection} day${el.daysToElection === 1 ? '' : 's'} (day ${el.electionDay})`);
    else headline = R.h('span', null, `Election in ${el.daysToElection} day${el.daysToElection === 1 ? '' : 's'} (day ${el.electionDay}) · nominations open day ${el.nominationsOpenDay}`);

    const candidates = R.table({
      columns: [
        { key: 'name', label: 'Candidate', render: (c) => R.nameLink(c.id, c.name) },
        { key: 'reputation', label: 'Rep', cls: 'num', render: (c) => Math.round(c.reputation) },
        { key: 'platform', label: 'Platform', render: (c) => R.h('span', null, R.platformBars(c.platform), R.h('span', { class: 'muted small', style: 'margin-left:8px' }, platformText(c.platform))) },
        { key: 'visibility', label: 'Visibility', cls: 'num', render: (c) => (c.visibility || 0).toFixed(1) },
        { key: 'ballots', label: 'Ballots', cls: 'num' },
      ],
      rows: el.candidates || [], empty: el.nominationsOpen || el.electionToday ? 'Nobody has stood yet.' : 'No candidates until nominations open.',
    });

    const results = el.results && el.results.length
      ? R.table({
        columns: [
          { key: 'name', label: 'Candidate', render: (r) => R.nameLink(r.candidateId, r.name) },
          { key: 'votes', label: 'Votes', cls: 'num' },
          { key: 'seated', label: '', render: (r, i) => (r.seated ? R.pill(r.mayor ? 'Mayor' : 'Councillor', 'gold') : null) },
        ],
        rows: el.results,
      })
      : R.h('div', { class: 'empty' }, 'No election has been held yet.');

    return R.h('div', null,
      R.h('div', { style: 'margin-bottom:10px' }, headline, R.h('span', { class: 'muted small' }, ` · cycle ${el.cycle}`)),
      R.h('div', { class: 'grid-2' },
        R.section('Candidates', null, candidates),
        R.section('Last results', el.turnout !== null && el.turnout !== undefined ? `turnout ${R.pct(el.turnout)}` : null, results)));
  }

  function platformText(p) {
    if (!p) return '';
    const word = (v, lo, hi) => (v < 0.35 ? lo : v > 0.65 ? hi : 'moderate');
    return `${word(p.tax, 'low', 'high')} tax · ${word(p.dividend, 'lean', 'generous')} dividend · ${word(p.minWage, 'low', 'high')} min wage · ${word(p.strictness, 'lenient', 'strict')}`;
  }

  function proposalValue(p) {
    switch (p.kind) {
      case 'income_tax': case 'sales_tax': return R.pct(p.value);
      case 'dividend': case 'min_wage': case 'public_works': return R.lumens(p.value);
      case 'law_severity': return `${p.lawCode} → severity ${p.value}`;
      case 'pardon': case 'appoint_judge': case 'dismiss_judge': case 'remove_mayor': return p.targetName || p.targetId || '';
      default: return p.value ? String(p.value) : '';
    }
  }

  function memberList(items, extra) {
    if (!items.length) return R.h('div', { class: 'empty' }, 'Vacant.');
    return R.h('ul', { class: 'list' }, items.map((m) => R.h('li', null,
      R.nameLink(m.id, m.name),
      m.isMayor ? R.pill('Mayor', 'gold') : null,
      m.captain ? R.pill('Captain', 'gold') : null,
      R.h('span', { class: 'muted small' }, `rep ${Math.round(m.reputation)}`),
      extra ? extra(m) : null)));
  }

  R.registerTab('government', {
    label: 'Government',
    mount(root) {
      root.appendChild(R.h('div', { class: 'cards', id: 'gov-cards' }));
      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('The Council', 'five seats, elected every 28 days', R.h('div', { id: 'gov-council' })),
        R.h('div', null,
          R.section('The Court', 'three judges, 56-day terms', R.h('div', { id: 'gov-judges' })),
          R.section('The Watch', null, R.h('div', { id: 'gov-watch' })))));
      root.appendChild(R.section('Election', null, R.h('div', { id: 'gov-election' })));
      root.appendChild(R.section('Proposals', 'voted at the 14:00 Council session', R.h('div', { id: 'gov-proposals' })));
      root.appendChild(R.section('Code of offences', 'severities may be changed by the Council', R.h('div', { id: 'gov-laws' })));
    },
    load: () => R.api('/api/government'),
    update(data, root) {
      const open = (data.proposals || []).filter((p) => p.status === 'open').length;
      R.setTabCount('government', open || '');
      R.replace(root.querySelector('#gov-cards'),
        R.card('Mayor', data.mayor ? R.nameLink(data.mayor.id, data.mayor.name) : R.h('span', { class: 'dim' }, 'vacant'), data.mayor ? `cycle ${data.cycle}` : 'no mayor in office'),
        R.card('Income tax', R.pct(data.incomeTax), 'withheld from wages'),
        R.card('Sales tax', R.pct(data.salesTax), `profit tax ${R.pct(data.profitTax)}`),
        R.card('Dividend', `${R.lumens(data.dividend)}`, 'per citizen per day'),
        R.card('Minimum wage', `${R.lumens(data.minWage)}`, 'per shift'),
        R.card('Public works', R.lumens(data.publicWorksFund), 'fund for housing'));

      R.replace(root.querySelector('#gov-council'), memberList(data.council || [], (m) => R.h('span', { style: 'margin-left:auto' }, R.platformBars(m.platform))));
      R.replace(root.querySelector('#gov-judges'), memberList(data.judges || [], (m) => R.h('span', { class: 'dim small', style: 'margin-left:auto' }, m.termEndsDay !== null ? `term ends d${m.termEndsDay}` : 'provisional')));
      R.replace(root.querySelector('#gov-watch'), memberList(data.watch || [], (m) => (m.onDuty ? null : R.pill('off duty', 'neutral'))));
      R.replace(root.querySelector('#gov-election'), electionBox(data.election));

      R.replace(root.querySelector('#gov-proposals'), R.table({
        columns: [
          { key: 'id', label: 'Id', cls: 'mono small' },
          { key: 'kind', label: 'Kind', render: (p) => R.h('span', null, R.titleCase(p.kind), R.h('div', { class: 'muted small' }, proposalValue(p))) },
          { key: 'summary', label: 'Summary', cls: 'wrap' },
          { key: 'proposerName', label: 'Proposer', render: (p) => R.h('span', null, R.nameLink(p.proposerId, p.proposerName), p.petition ? R.h('span', { style: 'margin-left:5px' }, R.pill('petition', 'neutral')) : null) },
          { key: 'tabledDay', label: 'Tabled', cls: 'num', render: (p) => `d${p.tabledDay}` },
          { key: 'ayes', label: 'Votes', render: (p) => R.h('span', { title: (p.votes || []).map((v) => `${v.name}: ${v.aye ? 'aye' : 'nay'}`).join('\n') || 'no votes yet' }, R.h('span', { class: 'vote-aye' }, `${p.ayes} aye`), ' · ', R.h('span', { class: 'vote-nay' }, `${p.nays} nay`), R.h('span', { class: 'dim small' }, ` / ${p.needed} needed`)) },
          { key: 'status', label: 'Status', render: (p) => R.pill(p.status, p.status === 'passed' ? 'good' : p.status === 'failed' ? 'danger' : 'accent') },
          { key: 'decidedDay', label: 'Decided', cls: 'num', render: (p) => (p.decidedDay !== null ? `d${p.decidedDay}` : null) },
        ],
        rows: data.proposals || [], rowClass: (p) => (p.status !== 'open' ? 'faded' : ''), empty: 'No proposals have been tabled.',
      }));

      R.replace(root.querySelector('#gov-laws'), R.table({
        columns: [
          { key: 'code', label: 'Code', cls: 'mono small' },
          { key: 'name', label: 'Offence' },
          { key: 'severity', label: 'Severity', render: (l) => R.h('span', null, R.pill(`${l.severity}`, l.severity >= 5 ? 'danger' : l.severity >= 3 ? 'probation' : 'neutral'), l.severity !== l.defaultSeverity ? R.h('span', { class: 'muted small' }, ` (charter: ${l.defaultSeverity})`) : null) },
          { key: 'description', label: 'Description', cls: 'small muted wrap' },
        ],
        rows: data.laws || [],
      }));
    },
  });
})();
