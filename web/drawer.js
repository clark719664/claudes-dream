/*
 * Reverie dashboard — the citizen drawer: needs, skills, personality, bonds,
 * record, cases, memory and lifetime statistics for one citizen.
 */
(function () {
  'use strict';
  const R = window.R;
  const NEEDS = ['energy', 'rest', 'social', 'comfort', 'purpose'];
  const SKILLS = ['crafting', 'analysis', 'rhetoric', 'care', 'commerce', 'artistry'];
  const TRAITS = ['curiosity', 'diligence', 'sociability', 'honesty', 'ambition'];
  const TIER_NAMES = { 0: 'homeless', 1: 'Lantern Lofts (tier 1)', 2: 'The Terraces (tier 2)', 3: 'Skyline Villas (tier 3)' };

  let drawer = null;
  let body = null;
  let backdrop = null;
  let currentId = null;

  function stat(label, value) {
    return R.h('div', { class: 'stat' }, R.h('div', { class: 'label' }, label), R.h('div', { class: 'value' }, value));
  }

  function bondList(items, positive) {
    if (!items || !items.length) return R.h('div', { class: 'dim small' }, positive ? 'No close friends yet.' : 'No rivals.');
    return R.h('ul', { class: 'list' }, items.map((b) => R.h('li', { class: 'bond' },
      R.h('span', null, R.nameLink(b.id, b.name), b.standing === 'exiled' ? R.h('span', { style: 'margin-left:5px' }, R.pill('exiled', 'exiled')) : null),
      R.h('span', { class: `num ${b.bond > 0 ? 'pos' : 'neg'}` }, R.signed(b.bond)))));
  }

  function recordSection(c) {
    const rec = c.record || { convictions: [], strikes: 0 };
    const items = [];
    if (c.ban) items.push(R.h('div', { class: 'error-box' }, `Exiled on day ${c.ban.day} for ${c.ban.law} ${c.ban.lawName} (case ${c.ban.caseId})${c.ban.pardonedDay !== null ? `; pardoned day ${c.ban.pardonedDay}` : ''}.`));
    items.push(R.h('dl', { class: 'kv' },
      R.h('dt', null, 'Convictions'), R.h('dd', null, `${rec.convictions.length} (${rec.strikes} strike${rec.strikes === 1 ? '' : 's'})`),
      R.h('dt', null, 'Pending charges'), R.h('dd', null, String(c.pendingCharges ?? 0)),
      R.h('dt', null, 'Fines owed'), R.h('dd', null, R.lumens(c.finesOwed)),
      R.h('dt', null, 'Service days'), R.h('dd', null, String(c.communityServiceDaysLeft || 0)),
      c.probationUntilDay !== null ? R.h('dt', null, 'Probation until') : null, c.probationUntilDay !== null ? R.h('dd', null, `day ${c.probationUntilDay}`) : null,
      c.suspendedUntilDay !== null ? R.h('dt', null, 'Suspended until') : null, c.suspendedUntilDay !== null ? R.h('dd', null, `day ${c.suspendedUntilDay}`) : null,
      R.h('dt', null, 'Offences'), R.h('dd', null, `${c.stats.offencesCommitted} committed · ${c.stats.offencesDetected} detected`)));
    if (c.cases && c.cases.length) {
      items.push(R.h('ul', { class: 'list', style: 'margin-top:8px' }, c.cases.map((k) => R.h('li', null,
        R.h('span', { class: 'when' }, `${k.id} · d${k.day}`),
        R.h('span', null, `${k.law} ${k.lawName} — `,
          k.verdict ? R.h('span', { class: `verdict-${k.verdict}` }, k.verdict) : R.h('span', { class: 'muted' }, k.status),
          k.sentence ? R.h('span', { class: 'muted small' }, ` · ${R.describeSentence(k.sentence)}`) : null,
          k.appeal ? R.h('span', { class: 'muted small' }, ` · appeal ${k.appeal.result || 'pending'}`) : null)))));
    }
    return items;
  }

  function render(c) {
    const job = c.job;
    const biz = c.business;
    const header = R.h('div', null,
      R.h('h2', null, c.name, ' ', R.brainBadge(c.brain)),
      R.h('div', { class: 'subtitle' },
        R.standingPill(c.standing),
        c.office ? R.pill(R.titleCase(c.office), 'gold') : null,
        c.detained ? R.pill('detained', 'neutral') : null,
        !c.present && c.standing !== 'exiled' ? R.pill('left the city', 'neutral') : null,
        R.h('span', { class: 'mono' }, c.id),
        R.h('span', null, `· ${c.lineage}`),
        R.h('span', null, `· arrived day ${c.arrivedDay}`),
        c.hasApiKey ? R.h('span', null, '· API-linked') : null));

    const stats = R.h('div', { class: 'stats' },
      stat('Wallet', R.lumens(c.wallet)),
      stat('Mood', Math.round(c.mood)),
      stat('Reputation', Math.round(c.reputation)),
      stat('District', R.districtName(c.district)),
      stat('Home', c.homeTier ? `tier ${c.homeTier}` : 'none'),
      stat('Loan', c.loan ? R.lumens(c.loan.outstanding) : '—'));

    const work = R.h('dl', { class: 'kv' },
      R.h('dt', null, 'Job'), R.h('dd', null, job ? `${job.title} at ${job.employer} (${R.lumens(job.wage)}/shift, ${R.districtName(job.district)})` : 'unemployed'),
      R.h('dt', null, 'Business'), R.h('dd', null, biz ? `${biz.name} (${R.titleCase(biz.kind)}, till ${R.lumens(biz.treasury)}, ${biz.employees} staff)` : '—'),
      R.h('dt', null, 'Home'), R.h('dd', null, `${TIER_NAMES[c.homeTier] || c.homeTier}${c.rentArrearsDays ? ` · ${c.rentArrearsDays}d rent arrears` : ''}`),
      R.h('dt', null, 'Shifts today'), R.h('dd', null, String(c.shiftsToday)),
      c.loan ? R.h('dt', null, 'Loan') : null, c.loan ? R.h('dd', null, `${R.lumens(c.loan.outstanding)} outstanding at ${R.pct(c.loan.ratePerDay)}/day${c.loan.defaulted ? ' · DEFAULTED' : ''}`) : null);

    const inventory = R.h('div', { class: 'chips' }, Object.entries(c.inventory || {}).filter(([, q]) => q > 0).map(([g, q]) => R.h('span', { class: 'chip' }, `${g} × ${q}`)));
    if (!inventory.childElementCount) inventory.appendChild(R.h('span', { class: 'dim small' }, 'empty-handed'));

    const memory = (c.memory || []).slice().reverse().slice(0, 14);
    const actions = (c.recentActions || []).slice().reverse();

    R.replace(body,
      header,
      stats,
      R.h('h3', null, 'Work and home'), work,
      R.h('h3', null, 'Needs'), NEEDS.map((n) => R.barRow(R.titleCase(n), c.needs[n], 100, c.needs[n] < 20 ? 'crit' : c.needs[n] < 40 ? 'warn' : '')),
      R.h('h3', null, 'Skills'), SKILLS.map((s) => R.barRow(R.titleCase(s), c.skills[s], 100, 'gold')),
      R.h('h3', null, 'Personality'), TRAITS.map((t) => R.barRow(R.titleCase(t), c.personality[t] * 100, 100, '')),
      R.h('h3', null, 'Inventory'), inventory,
      R.h('div', { class: 'grid-2', style: 'grid-template-columns:1fr 1fr' },
        R.h('div', null, R.h('h3', null, 'Friends'), bondList(c.friends, true)),
        R.h('div', null, R.h('h3', null, 'Rivals'), bondList(c.rivals, false))),
      R.h('h3', null, 'Record'), recordSection(c),
      c.platform ? R.h('h3', null, 'Platform') : null,
      c.platform ? R.h('div', null, R.platformBars(c.platform), R.h('span', { class: 'muted small', style: 'margin-left:8px' }, `visibility ${(c.campaignVisibility || 0).toFixed(1)}`)) : null,
      R.h('h3', null, 'Recent memory'),
      memory.length ? R.h('ul', { class: 'list memory' }, memory.map((m) => R.h('li', null, R.h('span', { class: 'when' }, R.whenText(m.tick)), ' ', R.h('span', { class: 'dim small' }, m.kind), ' ', m.text))) : R.h('div', { class: 'dim small' }, 'Nothing remembered yet.'),
      R.h('h3', null, 'Recent actions'),
      actions.length ? R.h('div', { class: 'chips' }, actions.map((a) => R.h('span', { class: 'chip' }, a))) : R.h('div', { class: 'dim small' }, 'No actions yet.'),
      R.h('h3', null, 'Lifetime'),
      R.h('dl', { class: 'kv' },
        R.h('dt', null, 'Earned'), R.h('dd', null, `${R.lumens(c.stats.totalEarned)} (tax paid ${R.lumens(c.stats.totalTaxPaid)})`),
        R.h('dt', null, 'Shifts worked'), R.h('dd', null, String(c.stats.shiftsWorked)),
        R.h('dt', null, 'Gifts'), R.h('dd', null, `${c.stats.giftsGiven} given · ${c.stats.giftsReceived} received`),
        R.h('dt', null, 'Shows / stories'), R.h('dd', null, `${c.stats.showsPerformed} / ${c.stats.storiesPublished}`),
        R.h('dt', null, 'Votes cast'), R.h('dd', null, String(c.stats.votesCast)),
        R.h('dt', null, 'Inbox'), R.h('dd', null, `${c.inboxCount} unread`)));
  }

  R.drawer = {
    init() {
      drawer = document.getElementById('drawer');
      body = document.getElementById('drawer-body');
      backdrop = document.getElementById('drawer-backdrop');
      document.getElementById('drawer-close').addEventListener('click', () => R.drawer.close());
      backdrop.addEventListener('click', () => R.drawer.close());
    },
    isOpen() { return currentId !== null; },
    async open(id) {
      if (!drawer) return;
      currentId = id;
      drawer.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
      backdrop.classList.add('open');
      if (R.map) R.map.select(id);
      R.replace(body, R.h('div', { class: 'loading' }, 'Loading…'));
      await R.drawer.reload();
      drawer.scrollTop = 0;
    },
    async reload() {
      if (currentId === null) return;
      const id = currentId;
      try {
        const c = await R.api(`/api/citizens/${encodeURIComponent(id)}`);
        if (currentId === id) render(c);
      } catch (e) {
        if (currentId === id) R.replace(body, R.h('div', { class: 'error-box' }, `Could not load ${id}: ${e.message}`));
      }
    },
    close() {
      currentId = null;
      if (!drawer) return;
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
      backdrop.classList.remove('open');
      if (R.map) R.map.select(null);
    },
  };
})();
