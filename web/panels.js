/*
 * Reverie dashboard — Citizens, Court, Ban Registry and Chronicle tabs.
 */
(function () {
  'use strict';
  const R = window.R;

  // ------------------------------------------------------------- citizens

  const CITIZEN_COLUMNS = [
    { key: 'name', label: 'Name', sortable: true, render: (c) => R.h('span', null, R.h('b', null, c.name), ' ', R.brainBadge(c.brain)) },
    { key: 'lineage', label: 'Lineage', sortable: true, cls: 'small muted' },
    { key: 'brain', label: 'Mind', sortable: true, cls: 'small', render: (c) => (c.brain === 'llm' ? 'Claude' : c.brain) },
    { key: 'job', label: 'Job', sortable: true, render: (c) => (c.job ? R.h('span', null, c.job, c.employer ? R.h('span', { class: 'muted small' }, ` · ${c.employer}`) : null) : c.business ? R.h('span', null, 'Owner ', R.h('span', { class: 'muted small' }, `· ${c.business}`)) : R.h('span', { class: 'dim' }, 'unemployed')) },
    { key: 'district', label: 'District', sortable: true, render: (c) => R.districtName(c.district) },
    { key: 'wallet', label: 'Wallet', sortable: true, cls: 'num', render: (c) => R.lumens(c.wallet) },
    { key: 'mood', label: 'Mood', sortable: true, render: (c) => R.miniBar(c.mood, 100, c.mood < 30 ? 'crit' : c.mood < 50 ? 'warn' : '') },
    { key: 'reputation', label: 'Reputation', sortable: true, render: (c) => R.miniBar(c.reputation, 100, 'gold') },
    { key: 'standing', label: 'Standing', sortable: true, render: (c) => R.h('span', null, R.standingPill(c.standing), c.detained ? R.h('span', { class: 'pill neutral', style: 'margin-left:4px' }, 'detained') : null, !c.present && c.standing !== 'exiled' ? R.h('span', { class: 'pill neutral', style: 'margin-left:4px' }, 'departed') : null) },
    { key: 'office', label: 'Office', sortable: true, render: (c) => R.officeLabel(c.office) },
  ];

  R.registerTab('citizens', {
    label: 'Citizens',
    mount(root) {
      const f = (R.ui.filters.citizens = { q: '', standing: 'all', brain: 'all', presentOnly: true });
      R.ui.sort.citizens = { key: 'name', dir: 'asc' };
      const rerender = () => { if (this.data) this.update(this.data, root); };
      const search = R.h('input', { type: 'search', placeholder: 'Search name, job, lineage…', oninput: (e) => { f.q = e.target.value.trim().toLowerCase(); rerender(); } });
      const standing = R.h('select', { onchange: (e) => { f.standing = e.target.value; rerender(); } },
        ['all', 'good', 'probation', 'suspended', 'exiled'].map((s) => R.h('option', { value: s }, s === 'all' ? 'All standings' : R.titleCase(s))));
      const brain = R.h('select', { onchange: (e) => { f.brain = e.target.value; rerender(); } },
        R.h('option', { value: 'all' }, 'All minds'), R.h('option', { value: 'reflex' }, 'Reflex'), R.h('option', { value: 'llm' }, 'Claude'), R.h('option', { value: 'remote' }, 'Remote'));
      const present = R.h('label', null, R.h('input', { type: 'checkbox', checked: true, onchange: (e) => { f.presentOnly = e.target.checked; rerender(); } }), 'in the city only');
      root.appendChild(R.h('div', { class: 'toolbar' }, search, standing, brain, present, R.h('span', { class: 'spacer' }), R.h('span', { class: 'muted small', id: 'citizens-meta' })));
      root.appendChild(R.h('div', { id: 'citizens-table' }));
    },
    load: () => R.api('/api/citizens'),
    update(data, root) {
      this.data = data;
      const f = R.ui.filters.citizens;
      const all = data.citizens || [];
      let rows = all.filter((c) => {
        if (f.presentOnly && !c.present && c.standing !== 'exiled') return false;
        if (f.standing !== 'all' && c.standing !== f.standing) return false;
        if (f.brain !== 'all' && c.brain !== f.brain) return false;
        if (f.q) {
          const hay = `${c.name} ${c.job || ''} ${c.employer || ''} ${c.lineage} ${c.district} ${c.office || ''} ${c.id}`.toLowerCase();
          if (!hay.includes(f.q)) return false;
        }
        return true;
      });
      rows = R.sortRows(rows, CITIZEN_COLUMNS, R.ui.sort.citizens);
      const present = all.filter((c) => c.present).length;
      R.setTabCount('citizens', present);
      root.querySelector('#citizens-meta').textContent = `${rows.length} shown · ${present} living in Reverie · ${all.filter((c) => c.standing === 'exiled').length} exiled`;
      R.replace(root.querySelector('#citizens-table'), R.table({
        columns: CITIZEN_COLUMNS, rows, sort: R.ui.sort.citizens,
        onSort: (key, dir) => { R.ui.sort.citizens = { key, dir }; this.update(this.data, root); },
        rowClass: (c) => (c.standing === 'exiled' || !c.present ? 'faded' : ''),
        onRowClick: (c) => R.openCitizen(c.id),
        empty: 'No citizens match.',
      }));
    },
  });

  // ---------------------------------------------------------------- court

  const TIER_LABEL = { 1: 'warning', 2: 'fine', 3: 'community service', 4: 'suspension', 5: 'exile' };

  R.describeSentence = function describeSentence(s) {
    if (!s) return null;
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
      class: `chip ${v.verdict === 'guilty' ? 'verdict-guilty' : 'verdict-acquitted'}`, title: `${v.name} voted ${v.verdict}`,
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
      R.replace(root.querySelector('#court-cards'),
        R.card('Pending', R.fmt(n.pending), 'awaiting the 10:00 session'),
        R.card('Convictions', R.fmt(n.guilty), `${R.fmt(n.acquitted)} acquittals`),
        R.card('On appeal', R.fmt(n.appealed), 'decided by the Council at 14:00'),
        R.card('Exiles ordered', R.fmt(n.exiles), `${R.fmt(n.total)} cases in all`));
      R.replace(root.querySelector('#court-table'), R.table({ columns: CASE_COLUMNS, rows: data.cases || [], empty: 'No charges have been filed.' }));
    },
  });

  // ----------------------------------------------------------------- bans

  const BAN_COLUMNS = [
    { key: 'name', label: 'Citizen', render: (b) => R.h('span', null, R.nameLink(b.citizenId, b.name), R.h('div', { class: 'muted small' }, b.lineage)) },
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

  // ------------------------------------------------------------ chronicle

  function weightClass(w) {
    return w >= 0.8 ? 'w4' : w >= 0.5 ? 'w3' : w >= 0.3 ? 'w2' : 'w1';
  }

  function eventRow(ev, isNew) {
    const row = R.h('div', { class: `ev ${weightClass(ev.weight)}${isNew ? ' new' : ''}` },
      R.h('span', { class: 'when' }, R.whenText(ev.tick)),
      R.h('span', { class: 'kind' }, ev.kind.replace(/_/g, ' ')),
      R.h('span', { class: 'text' }, ev.text));
    if (ev.actors && ev.actors.length) {
      row.classList.add('clickable');
      row.style.cursor = 'pointer';
      row.title = ev.actors.map((id) => (R.map && R.map.nameOf(id)) || id).join(', ');
      row.addEventListener('click', () => R.openCitizen(ev.actors[0]));
    }
    return row;
  }

  function editionCard(ed) {
    return R.h('div', { class: 'edition' },
      R.h('div', { class: 'masthead' }, R.h('b', null, 'THE CHRONICLE'), R.h('span', { class: 'muted small' }, 'morning edition'), R.h('span', { class: 'day' }, `Day ${ed.day}`)),
      R.h('ol', null, (ed.headlines || []).map((h) => R.h('li', null, h))),
      ed.treasuryReport ? R.h('div', { class: 'report' }, ed.treasuryReport) : null);
  }

  R.registerTab('chronicle', {
    label: 'Chronicle',
    mount(root) {
      const f = (R.ui.filters.chronicle = { notable: false });
      const ticker = R.h('div', { class: 'ticker', id: 'ticker' });
      const renderTicker = (newList) => {
        const newCount = newList ? newList.length : 0;
        let events = R.ticker.events;
        if (f.notable) events = events.filter((e) => e.weight >= 0.5);
        R.replace(ticker, events.length ? events.slice(0, 200).map((e, i) => eventRow(e, i < newCount)) : R.h('div', { class: 'empty' }, 'No events yet.'));
      };
      this.renderTicker = renderTicker;
      R.ticker.onChange((list, reseeded) => { if (!root.classList.contains('hidden')) renderTicker(reseeded ? null : list); });
      root.appendChild(R.h('div', { class: 'grid-2' },
        R.h('div', null, R.section('Morning editions', null, R.h('div', { id: 'editions' }))),
        R.h('div', null,
          R.h('div', { class: 'toolbar' }, R.h('h3', { class: 'section-title', style: 'margin:0' }, 'Live ticker'), R.h('span', { class: 'spacer' }),
            R.h('label', null, R.h('input', { type: 'checkbox', onchange: (e) => { f.notable = e.target.checked; renderTicker(); } }), 'notable only')),
          ticker)));
    },
    load: () => R.api('/api/chronicle'),
    update(data, root) {
      const editions = data.editions || [];
      R.setTabCount('chronicle', editions.length || '');
      R.replace(root.querySelector('#editions'), editions.length ? editions.map(editionCard) : R.h('div', { class: 'empty' }, 'The first edition prints tomorrow morning.'));
      if (data.events) {
        const newest = R.ticker.events[0];
        const serverNewest = data.events[0];
        if (!newest || !serverNewest || newest.tick <= serverNewest.tick) R.ticker.events = data.events.slice(0, R.ticker.max);
      }
      this.renderTicker();
    },
  });
})();
