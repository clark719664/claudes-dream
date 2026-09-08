/*
 * Reverie dashboard — Government, Court, the Ban registry, and the city's
 * public register of standing (docs/UI.md panels 5, 6 and 11, plus
 * docs/CITIZENSHIP.md §3, which the brief predates).
 *
 * The Economy panel lives in panels.js. Both files register tabs by name and
 * the later script wins, so this file must never register 'economy' — and
 * because index.html loads it after panels.js, the Court and the Ban registry
 * registered here are the ones the reader gets.
 *
 * Nothing in this file can touch the city. Every call is a GET; a click opens
 * a face, a case, or a filter, and never a verdict (docs/PRINCIPLES.md §1).
 * A citizen's own notes and letters are never shown — a notice of standing is
 * not one of those: the Charter puts it on the public register, itemised.
 */
(function () {
  'use strict';
  const R = window.R;

  // ------------------------------------------------------------- the hooks

  /** The Profile drawer, late-bound: whoever defines R.openProfile wins. */
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

  /** A person card as every panel draws one, with the face clicking through. */
  function who(card, opts) {
    if (!card || !card.id) return R.h('span', { class: 'dim' }, '—');
    return R.person(card, opts);
  }

  /** Keep a table's scroll where the reader left it across a re-render. */
  function replaceTable(host, node) {
    const was = host && host.querySelector('.table-wrap');
    const top = was ? was.scrollTop : 0;
    const left = was ? was.scrollLeft : 0;
    R.replace(host, node);
    const now = host && host.querySelector('.table-wrap');
    if (now) { now.scrollTop = top; now.scrollLeft = left; }
  }

  const dayText = (d) => (d === null || d === undefined ? '—' : `d${d}`);
  const PLURALS = { party: 'parties', judge: 'judges', notice: 'notices', citizen: 'citizens' };
  const plural = (n, word) =>
    `${R.fmt(n)} ${Math.round(n) === 1 ? word : PLURALS[word] || `${word}s`}`;

  // ====================================================== 5. THE GOVERNMENT

  function platformText(p) {
    if (!p) return '';
    const word = (v, lo, hi) => (v < 0.35 ? lo : v > 0.65 ? hi : 'moderate');
    return `${word(p.tax, 'low', 'high')} tax · ${word(p.dividend, 'lean', 'generous')} dividend · `
      + `${word(p.minWage, 'low', 'high')} min wage · ${word(p.strictness, 'lenient', 'strict')}`;
  }

  function proposalValue(p) {
    switch (p.kind) {
      case 'income_tax': case 'sales_tax': return R.pct(p.value);
      case 'dividend': case 'min_wage': case 'public_works': return R.lumens(p.value);
      case 'law_severity': return `${p.lawCode} → severity ${p.value}`;
      case 'pardon': case 'appoint_judge': case 'dismiss_judge': case 'remove_mayor':
        return p.targetName || p.targetId || '';
      default: return p.value ? String(p.value) : '';
    }
  }

  /** A gauge: a labelled bar with the share written beside it. */
  function gauge(label, share, note) {
    const v = share === null || share === undefined ? null : share;
    return R.h('div', { class: 'bar-row', style: 'grid-template-columns:140px 1fr 108px' },
      R.h('span', { class: 'muted' }, label),
      R.bar(v === null ? 0 : v * 100, 100, v === null ? '' : v < 0.35 ? 'crit' : v < 0.5 ? 'warn' : ''),
      R.h('span', { class: 'num small' }, v === null ? '—' : R.pct(v), note ? R.h('span', { class: 'dim' }, ` ${note}`) : null));
  }

  /** The Council, the bench and the Watch: a face, a name, and the one fact that matters. */
  function memberList(items, extra) {
    if (!items || !items.length) return R.h('div', { class: 'empty' }, 'Vacant.');
    return R.h('ul', { class: 'list' }, items.map((m) => R.h('li', { style: 'align-items:center' },
      face(m.id, 32),
      R.h('span', { class: 'person-text' },
        R.h('span', { class: 'person-name' },
          R.nameLink(m.id, m.name),
          m.isMayor ? R.pill('Mayor', 'gold') : null,
          m.captain ? R.pill('Captain', 'gold') : null),
        R.h('span', { class: 'person-sub' }, `reputation ${Math.round(m.reputation)}`)),
      R.h('span', { class: 'spacer' }),
      extra ? extra(m) : null)));
  }

  function partyCard(p, majorityId) {
    return R.h('div', { class: 'club' },
      R.h('div', { class: 'head', style: 'align-items:center' },
        R.h('b', null, p.name),
        p.seats ? R.pill(plural(p.seats, 'seat'), 'gold') : R.pill('no seats', 'neutral'),
        p.id === majorityId ? R.pill('majority', 'accent') : null,
        R.h('span', { class: 'spacer' }),
        R.platformBars(p.platform)),
      R.h('div', { class: 'sub muted small' }, p.words || platformText(p.platform)),
      R.h('div', { class: 'muted small', style: 'margin-top:4px' },
        `founded d${p.foundedDay} · ${plural(p.size, 'member')}`),
      R.h('div', { style: 'margin-top:8px' }, who(p.leader, { size: 32, sub: R.h('span', { class: 'dim' }, 'leader') })),
      p.manifesto ? R.h('div', { class: 'muted small', style: 'margin-top:8px' }, p.manifesto) : null);
  }

  const PROMISE_TONE = { kept: 'good', broken: 'danger', open: 'neutral' };

  function promiseCard(row) {
    const kept = row.keptShare;
    return R.h('div', { class: 'household' },
      R.h('div', { class: 'head', style: 'align-items:center' },
        who(row, { size: 36 }),
        R.h('span', { class: 'spacer' }),
        R.h('span', { class: 'mini-bar' },
          R.bar((kept || 0) * 100, 100, kept >= 0.6 ? '' : kept >= 0.3 ? 'warn' : 'crit'),
          R.h('span', { class: 'num small' }, R.pct(kept)))),
      R.h('ul', { class: 'list' }, (row.promises || []).map((p) => R.h('li', null,
        R.pill(p.state, PROMISE_TONE[p.state] || 'neutral'),
        R.h('span', null, p.words),
        R.h('span', { class: 'spacer' }),
        R.h('span', { class: 'dim small mono' }, `made d${p.madeDay}`)))));
  }

  /** The 14:00 session's order paper: bills, appeals, residencies. */
  function agendaBox(a) {
    if (!a) return R.h('div', { class: 'empty' }, 'Nothing before the Council.');
    const bills = (a.bills || []).map((b) => R.h('li', null,
      R.h('span', { class: 'mono small dim' }, b.id),
      R.h('span', null, b.summary, b.petition ? R.h('span', { style: 'margin-left:5px' }, R.pill('petition', 'neutral')) : null),
      R.h('span', { class: 'spacer' }),
      R.h('span', { class: 'small' },
        R.h('span', { class: 'vote-aye' }, `${b.ayes} aye`), ' · ',
        R.h('span', { class: 'vote-nay' }, `${b.nays} nay`),
        R.h('span', { class: 'dim' }, ` / ${b.needed} needed`))));
    const appeals = (a.appeals || []).map((k) => R.h('li', { style: 'align-items:center' },
      R.h('a', { class: 'name-link mono small', href: '#court', onclick: (e) => { e.preventDefault(); R.openCase(k.caseId); } }, k.caseId),
      who(k.defendant, { size: 26, sub: null, district: false }),
      R.h('span', { class: 'muted small' }, `${k.law} ${k.lawName}`),
      R.h('span', { class: 'spacer' }),
      R.h('span', { class: 'dim small mono' }, `filed ${dayText(k.filedDay)}`)));
    const residency = (a.residency || []).map((n) => R.h('li', { style: 'align-items:center' },
      face(n.id, 26),
      R.nameLink(n.id, n.name),
      R.h('span', { class: 'muted small' }, `${R.fmt(n.shortfall)} short of the line`),
      R.h('span', { class: 'spacer' }),
      n.immediate ? R.pill('no grace', 'danger') : R.pill('grace run out', 'probation'),
      n.applied ? R.pill('has applied', 'accent') : null));
    const block = (title, rows, empty) => R.h('div', null,
      R.h('div', { class: 'sub-title' }, title),
      rows.length ? R.h('ul', { class: 'list' }, rows) : R.h('div', { class: 'muted small' }, empty));
    return R.h('div', { class: 'grid-2' },
      block('Bills tabled', bills, 'No bill is on the table.'),
      R.h('div', null,
        block('Appeals to decide', appeals, 'No appeal is before the Council.'),
        block('Residencies to hear', residency, 'No residency is before the Court.')));
  }

  function electionBox(el) {
    if (!el) return R.h('div', { class: 'empty' }, 'No election scheduled.');
    let headline;
    if (el.electionToday) {
      headline = R.h('span', null, R.pill('Election day', 'gold'),
        ` polls close at 20:00 · ${R.fmt(el.ballotsCast)} of ${R.fmt(el.eligibleVoters)} ballots cast`);
    } else if (el.nominationsOpen) {
      headline = R.h('span', null, R.pill('Nominations open', 'accent'),
        ` election in ${plural(el.daysToElection, 'day')} (day ${el.electionDay})`);
    } else {
      headline = R.h('span', null, `Election in ${plural(el.daysToElection, 'day')} (day ${el.electionDay})`
        + ` · nominations open day ${el.nominationsOpenDay}`);
    }

    const candidates = R.table({
      columns: [
        { key: 'name', label: 'Candidate', truncate: true, render: (c) => R.h('span', { class: 'person' }, face(c.id, 28), R.h('span', { class: 'person-text' }, R.nameLink(c.id, c.name))) },
        { key: 'reputation', label: 'Rep', cls: 'num', render: (c) => Math.round(c.reputation) },
        { key: 'platform', label: 'Platform', render: (c) => R.h('span', null, R.platformBars(c.platform), R.h('span', { class: 'muted small', style: 'margin-left:8px' }, platformText(c.platform))) },
        { key: 'visibility', label: 'Visibility', cls: 'num', render: (c) => (c.visibility || 0).toFixed(1) },
        { key: 'ballots', label: 'Ballots', cls: 'num' },
      ],
      rows: el.candidates || [],
      empty: el.nominationsOpen || el.electionToday ? 'Nobody has stood yet.' : 'No candidates until nominations open.',
    });

    const results = el.results && el.results.length
      ? R.table({
        columns: [
          { key: 'name', label: 'Candidate', truncate: true, render: (r) => R.h('span', { class: 'person' }, face(r.candidateId, 28), R.h('span', { class: 'person-text' }, R.nameLink(r.candidateId, r.name))) },
          { key: 'votes', label: 'Votes', cls: 'num' },
          { key: 'seated', label: '', render: (r) => (r.seated ? R.pill(r.mayor ? 'Mayor' : 'Councillor', 'gold') : null) },
        ],
        rows: el.results,
      })
      : R.h('div', { class: 'empty' }, 'No election has been held yet.');

    return R.h('div', null,
      R.h('div', { style: 'margin-bottom:10px' }, headline, R.h('span', { class: 'muted small' }, ` · cycle ${el.cycle}`)),
      R.h('div', { class: 'grid-2' },
        R.section('Candidates', null, candidates),
        R.section('Last results', el.turnout === null || el.turnout === undefined ? null : `turnout ${R.pct(el.turnout)}`, results)));
  }

  function referendumTable(rows) {
    return R.table({
      columns: [
        { key: 'question', label: 'Question', cls: 'wrap', render: (r) => R.h('span', null, r.question, r.today ? R.h('span', { style: 'margin-left:6px' }, R.pill('voting today', 'gold')) : null) },
        { key: 'day', label: 'Day', cls: 'num', render: (r) => dayText(r.day) },
        { key: 'ayes', label: 'Ballots', render: (r) => R.h('span', null, R.h('span', { class: 'vote-aye' }, `${r.ayes} aye`), ' · ', R.h('span', { class: 'vote-nay' }, `${r.nays} nay`)) },
        { key: 'result', label: 'Result', render: (r) => (r.result ? R.pill(r.result, r.result === 'passed' ? 'good' : 'danger') : R.pill('open', 'accent')) },
      ],
      rows: rows || [], empty: 'No petition has reached a referendum.',
    });
  }

  function petitionTable(rows) {
    return R.table({
      columns: [
        { key: 'summary', label: 'Petition', cls: 'wrap' },
        { key: 'proposer', label: 'Raised by', truncate: true, render: (p) => who(p.proposer, { size: 26, district: false }) },
        { key: 'signatures', label: 'Signatures', render: (p) => R.h('span', { class: 'mini-bar' }, R.bar(p.signatures, p.needed || 1, p.signatures >= p.needed ? 'gold' : ''), R.h('span', { class: 'num small' }, `${p.signatures}/${p.needed}`)) },
        { key: 'status', label: 'Status', render: (p) => R.h('span', null, R.pill(p.status, p.status === 'passed' ? 'good' : p.status === 'failed' ? 'danger' : 'accent'), p.referendumId ? R.h('span', { style: 'margin-left:5px' }, R.pill('to referendum', 'gold')) : null) },
      ],
      rows: rows || [], empty: 'Nobody has raised a petition.',
    });
  }

  function unionTable(rows) {
    return R.table({
      columns: [
        { key: 'name', label: 'Union', truncate: true, render: (u) => R.h('span', null, R.h('b', null, u.name), R.h('div', { class: 'muted small' }, `${R.titleCase(u.role)} · ${plural(u.size, 'member')}`)) },
        { key: 'demandWage', label: 'Demand', cls: 'num', render: (u) => R.h('span', null, `${R.lumens(u.demandWage)}/shift`, R.h('div', { class: 'dim small' }, `mean ${R.lumens(u.meanWage)}`)) },
        { key: 'majority', label: 'Of the trade', render: (u) => (u.majority ? R.pill('majority', 'accent') : R.pill('minority', 'neutral')) },
        { key: 'striking', label: 'Status', render: (u) => (u.striking ? R.pill(`on strike to d${u.strikingUntilDay}`, 'danger') : R.pill('working', 'good')) },
        { key: 'members', label: 'Members', render: (u) => R.h('span', { class: 'chips' }, (u.members || []).slice(0, 10).map((m) => face(m.id, 24))) },
      ],
      rows: rows || [], empty: 'No trade has organised.',
    });
  }

  function decreeTable(rows) {
    return R.table({
      columns: [
        { key: 'kind', label: 'Decree', render: (d) => R.h('span', null, R.titleCase(d.kind), d.districtName ? R.h('div', { class: 'muted small' }, d.districtName) : null) },
        { key: 'by', label: 'By', truncate: true, render: (d) => who(d.by, { size: 26, district: false }) },
        { key: 'day', label: 'In force', cls: 'small nowrap', render: (d) => `d${d.day} – d${d.untilDay}` },
        { key: 'value', label: 'Value', cls: 'num', render: (d) => (d.value === null || d.value === undefined ? null : d.value) },
        { key: 'inForce', label: '', render: (d) => (d.inForce ? R.pill('in force', 'gold') : R.pill('lapsed', 'neutral')) },
      ],
      rows: rows || [], empty: 'The Mayor has issued no decree.',
      rowClass: (d) => (d.inForce ? '' : 'faded'),
    });
  }

  // ------------------------------------------ the public register of standing

  const NOTICE_KINDS = { civic: 'ladder', custodial: 'custody', component: 'reading', shortfall: 'the gap' };

  /** What a notice cost, itemised — the Charter prints exactly this. */
  function noticeItems(n) {
    return R.h('ul', { class: 'list' }, (n.items || []).map((i) => R.h('li', null,
      R.h('span', { class: 'mono small', style: `min-width:52px;color:${i.amount < 0 ? 'var(--exiled)' : 'var(--good)'}` },
        `${i.amount >= 0 ? '+' : '−'}${Math.abs(i.amount)}`),
      R.h('span', { class: 'small' }, i.label),
      R.h('span', { class: 'spacer' }),
      i.caseId
        ? R.h('a', { class: 'name-link mono small', href: '#court', onclick: (e) => { e.preventDefault(); R.openCase(i.caseId); } }, i.caseId)
        : R.h('span', { class: 'dim small' }, NOTICE_KINDS[i.kind] || i.kind))));
  }

  function noticeRow(n) {
    const wrap = R.h('div', { class: 'household' },
      R.h('div', { class: 'head', style: 'align-items:center' },
        who(n, { size: 40 }),
        R.h('span', { class: 'spacer' }),
        n.immediate ? R.pill('no grace', 'danger')
          : n.due ? R.pill('grace run out', 'probation')
            : R.pill(`${plural(n.daysLeft, 'day')} of grace`, 'accent'),
        n.applied ? R.pill('has asked to be heard', 'accent') : null,
        n.halved ? R.pill('second in a cycle: grace halved', 'neutral') : null),
      R.h('div', { class: 'bar-row', style: 'grid-template-columns:140px 1fr 150px' },
        R.h('span', { class: 'muted' }, 'Repute against the line'),
        R.bar(n.repute, Math.max(n.line, n.repute) || 1, n.repute < n.line ? 'crit' : ''),
        R.h('span', { class: 'num small' }, `${R.fmt(n.repute)} / ${R.fmt(n.line)}`,
          R.h('span', { class: 'dim' }, ` · ${R.fmt(n.shortfall)} short`))),
      R.h('div', { class: 'muted small' },
        `Issued d${n.issuedDay}: ${n.reason}. `,
        n.immediate ? 'The Court sits at the next sitting they are at liberty for.'
          : `Grace of ${plural(n.graceDays, 'day')} ends on day ${n.graceEndsDay}`
            + (n.extendedDays ? ` (extended by ${plural(n.extendedDays, 'day')})` : '') + '.'),
      noticeItems(n));
    return wrap;
  }

  const HEARING_TONE = { confirmed: 'good', extended: 'probation', ended: 'exiled', adjourned: 'neutral' };
  const HEARING_VOTE = { confirm: 'good', extend: 'probation', end: 'danger' };

  function hearingRow(h) {
    return R.h('div', { class: 'household' },
      R.h('div', { class: 'head', style: 'align-items:center' },
        R.h('span', { class: 'mono small dim' }, `${h.id} · d${h.day}, ${R.pad2(h.hour)}:00`),
        who(h.citizen, { size: 34 }),
        R.h('span', { class: 'spacer' }),
        h.outcome ? R.pill(h.outcome, HEARING_TONE[h.outcome] || 'neutral') : R.pill('sitting', 'accent'),
        h.leaveByDay !== null && h.leaveByDay !== undefined ? R.pill(`14 days: gone by d${h.leaveByDay}`, 'probation') : null),
      R.h('div', { class: 'muted small' },
        `Repute ${R.fmt(h.repute)} against a line of ${R.fmt(h.line)}, ${R.fmt(h.shortfall)} short. `,
        h.spoke ? 'They put their own case. ' : 'They did not put a case. ',
        h.advocate ? 'An advocate spoke for them. ' : ''),
      h.vouchers && h.vouchers.length
        ? R.h('div', { style: 'margin-top:6px' }, R.h('span', { class: 'muted small' }, 'Vouched for by '),
          R.h('span', { class: 'chips' }, h.vouchers.map((v) => R.h('span', { class: 'chip person' }, face(v.id, 20), v.name))))
        : null,
      R.h('div', { class: 'chips', style: 'margin-top:8px' }, (h.votes || []).map((v) => R.h('span', {
        class: 'chip person', title: `${R.fullName(v)} voted ${v.vote}`,
      }, face(v.id, 20), v.name, ' ', R.pill(v.vote, HEARING_VOTE[v.vote] || 'neutral')))),
      R.h('div', { class: 'muted small', style: 'margin-top:8px' }, (h.reasons || []).join(' ')));
  }

  function registerBox(reg) {
    if (!reg) return R.h('div', { class: 'empty' }, 'The register is empty.');
    const preamble = R.h('div', { style: 'margin-bottom:12px' },
      R.h('div', { class: 'muted small', style: 'max-width:74ch' },
        `${reg.city} asks ${R.fmt(reg.residencyLine)} of a resident and ${R.fmt(reg.visitLine)} of a visitor. `
        + 'A notice of standing takes nothing away: through the whole grace period the citizen keeps every right '
        + `they had. Rise above the line for ${plural(reg.recoveryDays, 'day')} and the notice is withdrawn and `
        + `struck from the register; if the grace runs out below it, the Court sits at ${R.pad2(reg.hearingHour)}:00.`),
      R.h('div', { class: 'chips', style: 'margin-top:6px' },
        (reg.keeps || []).map((k) => R.h('span', { class: 'chip' }, k))));
    const open = (reg.open || []).length
      ? R.h('div', { class: 'card-grid wide' }, (reg.open || []).map(noticeRow))
      : R.h('div', { class: 'empty' }, 'Nobody is under a notice of standing.');
    const hearings = (reg.hearings || []).length
      ? R.h('div', { class: 'card-grid wide' }, reg.hearings.map(hearingRow))
      : R.h('div', { class: 'empty' }, 'The Court has sat on no residency.');
    const under = (reg.open || []).length;
    return R.h('div', null, preamble,
      R.h('div', { class: 'sub-title' }, under ? `Under notice — ${plural(under, 'name')}` : 'Under notice'), open,
      R.h('div', { class: 'sub-title' }, 'Residency hearings held'), hearings);
  }

  R.registerTab('government', {
    label: 'Government',
    mount(root) {
      root.appendChild(R.h('div', { class: 'cards', id: 'gov-cards' }));
      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('The Council', 'five seats, elected every 28 days', R.h('div', { id: 'gov-council' })),
        R.h('div', null,
          R.section('What the city makes of them', 'approval, and promises kept', R.h('div', { id: 'gov-approval' })),
          R.section('The Court', 'three judges, 56-day terms', R.h('div', { id: 'gov-judges' })),
          R.section('The Watch', null, R.h('div', { id: 'gov-watch' })))));
      root.appendChild(R.section('Parties', R.h('span', { id: 'gov-parties-meta' }), R.h('div', { id: 'gov-parties' })));
      root.appendChild(R.section('Promises', 'what they stood on, and what they have done about it', R.h('div', { id: 'gov-promises' })));
      root.appendChild(R.section('The Council session', R.h('span', { id: 'gov-agenda-meta' }), R.h('div', { id: 'gov-agenda' })));
      root.appendChild(R.section('Election', null, R.h('div', { id: 'gov-election' })));
      root.appendChild(R.section('Proposals', 'voted at the Council session', R.h('div', { id: 'gov-proposals' })));
      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('Referendums', 'a petition the Council would not take', R.h('div', { id: 'gov-referendums' })),
        R.section('Petitions', 'signatures a citizen gathered', R.h('div', { id: 'gov-petitions' }))));
      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('Unions and strikes', null, R.h('div', { id: 'gov-unions' })),
        R.section('Decrees', "the Mayor's own hand, once a cycle", R.h('div', { id: 'gov-decrees' }))));
      root.appendChild(R.section('The register of standing', R.h('span', { id: 'gov-register-meta' }), R.h('div', { id: 'gov-register' })));
      root.appendChild(R.section('Code of offences', 'severities may be changed by the Council', R.h('div', { id: 'gov-laws' })));
    },
    load: () => R.api('/api/government'),
    update(data, root) {
      const $ = (sel) => root.querySelector(sel);
      const open = (data.proposals || []).filter((p) => p.status === 'open').length;
      const approval = data.approval || {};
      const reg = data.notices || {};
      R.setTabCount('government', open || '');

      R.replace($('#gov-cards'),
        R.card({
          label: 'Mayor',
          value: data.mayor
            ? R.h('span', { style: 'display:inline-flex;align-items:center;gap:10px' },
              face(data.mayor.id, 40), R.nameLink(data.mayor.id, data.mayor.name))
            : R.h('span', { class: 'dim' }, 'vacant'),
          sub: data.mayor ? `cycle ${data.cycle} · approval ${R.pct(approval.mayor)}` : 'no mayor in office',
          small: true,
        }),
        R.card('Income tax', R.pct(data.incomeTax), 'withheld from wages'),
        R.card('Sales tax', R.pct(data.salesTax), `profit tax ${R.pct(data.profitTax)}`),
        R.card('Dividend', R.lumens(data.dividend), 'per citizen per day'),
        R.card('Minimum wage', R.lumens(data.minWage), 'per shift'),
        R.card('Public works', R.lumens(data.publicWorksFund), 'fund for housing'),
        R.card({
          label: 'Under notice', value: R.fmt((reg.open || []).length),
          sub: { text: `${R.fmt(reg.due || 0)} for the Court · line ${R.fmt(reg.residencyLine)}`, cls: reg.due ? 'down' : '' },
          onClick: () => { const el = $('#gov-register'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
        }));

      R.replace($('#gov-approval'),
        gauge('The Mayor', approval.mayor),
        gauge('The Council', approval.council),
        R.h('div', { class: 'muted small', style: 'margin-top:6px' },
          'Approval is what the city says of them, counted from what they have done.'));

      R.replace($('#gov-council'), memberList(data.council || [], (m) => R.h('span', { title: platformText(m.platform) }, R.platformBars(m.platform))));
      R.replace($('#gov-judges'), memberList(data.judges || [], (m) => R.h('span', { class: 'dim small' }, m.termEndsDay === null || m.termEndsDay === undefined ? 'provisional' : `term ends d${m.termEndsDay}`)));
      R.replace($('#gov-watch'), memberList(data.watch || [], (m) => (m.onDuty ? R.pill('on duty', 'good') : R.pill('off duty', 'neutral'))));

      const parties = data.parties || [];
      const coalition = data.coalition || null;
      R.replace($('#gov-parties-meta'), `${plural(parties.length, 'party')} · `
        + (coalition ? `a coalition of ${coalition.map((c) => c.name).join(' and ')}` : 'no coalition'));
      R.replace($('#gov-parties'), parties.length
        ? R.h('div', { class: 'card-grid' }, parties.map((p) => partyCard(p, data.majorityPartyId)))
        : R.h('div', { class: 'empty' }, 'Nobody has founded a party.'));

      const promises = data.promises || [];
      R.replace($('#gov-promises'), promises.length
        ? R.h('div', { class: 'card-grid' }, promises.map(promiseCard))
        : R.h('div', { class: 'empty' }, 'Nobody in office stood on a promise.'));

      R.replace($('#gov-agenda-meta'), data.agenda ? `sits at ${R.pad2(data.agenda.hour)}:00 · ${plural(data.agenda.seats, 'seat')}` : '');
      R.replace($('#gov-agenda'), agendaBox(data.agenda));
      R.replace($('#gov-election'), electionBox(data.election));

      replaceTable($('#gov-proposals'), R.table({
        columns: [
          { key: 'id', label: 'Id', cls: 'mono small' },
          { key: 'kind', label: 'Kind', render: (p) => R.h('span', null, R.titleCase(p.kind), R.h('div', { class: 'muted small' }, proposalValue(p))) },
          { key: 'summary', label: 'Summary', cls: 'wrap' },
          { key: 'proposerName', label: 'Proposer', truncate: true, render: (p) => R.h('span', null, R.nameLink(p.proposerId, p.proposerName), p.petition ? R.h('span', { style: 'margin-left:5px' }, R.pill('petition', 'neutral')) : null) },
          { key: 'tabledDay', label: 'Tabled', cls: 'num', render: (p) => dayText(p.tabledDay) },
          { key: 'ayes', label: 'Votes', render: (p) => R.h('span', { title: (p.votes || []).map((v) => `${v.name}: ${v.aye ? 'aye' : 'nay'}`).join('\n') || 'no votes yet' }, R.h('span', { class: 'vote-aye' }, `${p.ayes} aye`), ' · ', R.h('span', { class: 'vote-nay' }, `${p.nays} nay`), R.h('span', { class: 'dim small' }, ` / ${p.needed} needed`)) },
          { key: 'status', label: 'Status', render: (p) => R.pill(p.status, p.status === 'passed' ? 'good' : p.status === 'failed' ? 'danger' : 'accent') },
          { key: 'decidedDay', label: 'Decided', cls: 'num', render: (p) => (p.decidedDay === null ? null : dayText(p.decidedDay)) },
        ],
        rows: data.proposals || [], rowClass: (p) => (p.status !== 'open' ? 'faded' : ''), empty: 'No proposals have been tabled.',
        minWidth: 980,
      }));

      R.replace($('#gov-referendums'), referendumTable(data.referendums));
      R.replace($('#gov-petitions'), petitionTable(data.petitions));
      R.replace($('#gov-unions'), unionTable(data.unions));
      R.replace($('#gov-decrees'), decreeTable(data.decrees));

      R.replace($('#gov-register-meta'), `${plural((reg.open || []).length, 'notice')} standing · ${plural((reg.leaving || []).length, 'citizen')} taking the road`);
      R.replace($('#gov-register'), registerBox(reg));

      R.replace($('#gov-laws'), R.table({
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

  // =========================================================== 6. THE COURT

  const TIER_LABEL = { 1: 'warning', 2: 'fine', 3: 'community service', 4: 'suspension', 5: 'exile' };

  /**
   * A sentence in words, on whichever of the two tracks answered the charge.
   * Kept on `R` because the Profile drawer prints it too.
   */
  R.describeSentence = function describeSentence(s) {
    if (!s) return null;
    if (s.track === 'person') {
      const head = s.life ? 'custody for life' : `${s.jailDays}d custody`;
      return s.restrainingOrder ? `${head} · restraining order` : head;
    }
    const parts = [];
    if (s.exile) parts.push(`exile${s.executed ? ' (executed)' : s.executeOnDay !== null && s.executeOnDay !== undefined ? ` (day ${s.executeOnDay})` : ''}`);
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
    }, `${String(v.name || '').split(' ')[0]} ${v.verdict === 'guilty' ? 'G' : 'A'}`)));
  }

  /** The case the courtroom is showing. Persists across refreshes. */
  let openCaseId = null;

  /**
   * Open a case in the courtroom, from anywhere: a ban row, a notice's
   * itemised penalty, the Council's appeal list. Selecting a case is reading,
   * not steering — nothing here can change it.
   */
  R.openCase = function openCase(caseId) {
    if (!caseId) return;
    openCaseId = caseId;
    if (R.state.tab !== 'court') R.selectTab('court');
    else R.refresh();
    window.requestAnimationFrame(() => {
      const el = document.querySelector('#court-room');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  /**
   * What each part of a judge's reading is, in words. The view sends keys —
   * the docket carries two hundred cases — and the panel names them.
   */
  const READING_PART = {
    evidence: 'the evidence as filed',
    record: 'a conviction already on the record',
    reputation: "the city's regard for the defendant",
    bondDefendant: 'friendship with the defendant',
    bondVictim: 'friendship with the victim',
    advocacy: 'the advocate spoke for them',
  };

  /** A belief bar with the Charter's standard of proof marked on it. */
  function beliefBar(j, threshold) {
    const belief = Number(j.belief) || 0;
    const over = belief > threshold;
    const bar = R.bar(belief * 100, 100, over ? 'crit' : '');
    bar.style.minWidth = '120px';
    bar.appendChild(R.h('i', {
      class: 'threshold',
      style: `left:${(threshold * 100).toFixed(1)}%;width:2px;border-radius:0;background:var(--gold);opacity:.85`,
    }));
    const detail = (j.parts || [])
      .map((p) => `${p.amount >= 0 ? '+' : '−'}${Math.abs(p.amount)}  ${READING_PART[p.key] || p.key}`).join('\n');
    return R.h('span', { class: 'mini-bar', title: `${detail}\n= ${belief.toFixed(2)} against a standard of proof of ${threshold}` },
      bar, R.h('span', { class: `num small ${over ? 'verdict-guilty' : 'verdict-acquitted'}` }, belief.toFixed(2)));
  }

  /**
   * One seat on the bench: the face, the reading, the vote and the words. The
   * reading arrives on `case.bench` keyed by id; the name, the vote and the
   * reason are already on `case.judges`, so the two are read together.
   */
  function benchSeat(j, threshold) {
    return R.h('div', { class: 'household' },
      R.h('div', { class: 'head', style: 'align-items:center' },
        face(j.id, 36),
        R.h('span', { class: 'person-text' }, R.h('span', { class: 'person-name' }, R.nameLink(j.id, j.name))),
        R.h('span', { class: 'spacer' }),
        j.verdict ? R.h('span', { class: `verdict-${j.verdict}` }, j.verdict) : R.pill('no vote', 'neutral')),
      R.h('div', { class: 'bar-row', style: 'grid-template-columns:104px 1fr auto' },
        R.h('span', { class: 'muted' }, 'Belief in guilt'), beliefBar(j, threshold), R.h('span')),
      j.reason ? R.h('div', { class: 'muted small', style: 'margin-top:6px' }, `“${j.reason}”`) : null);
  }

  /** The bench as the courtroom draws it: who sat, how they voted, how they read it. */
  function benchSeats(k) {
    const reading = new Map((k.bench || []).map((b) => [b.id, b]));
    return (k.judges || []).map((j) => Object.assign({ belief: 0, parts: [] }, reading.get(j.id), {
      id: j.id, name: j.name, verdict: j.verdict, reason: j.reason,
    }));
  }

  /** The box: five citizens drawn by lot, on any charge grave enough. */
  function juryBox(k) {
    const jury = k.jury || [];
    if (!jury.length) return null;
    const t = k.juryTally || { guilty: 0, total: 0 };
    return R.h('div', null,
      R.h('div', { class: 'sub-title' }, `The jury — ${t.guilty} of ${t.total} cast for guilt`),
      R.h('div', { class: 'chips' }, jury.map((j) => R.h('span', {
        class: 'chip person', title: `${j.name}${j.verdict ? ` voted ${j.verdict}` : ' did not vote'}${j.reason ? `: "${j.reason}"` : ''}`,
        style: j.seated ? '' : 'opacity:.5',
      }, face(j.id, 24), j.name, ' ',
      j.verdict ? R.h('span', { class: `verdict-${j.verdict}` }, j.verdict === 'guilty' ? 'G' : 'A') : R.h('span', { class: 'dim' }, '—')))));
  }

  const PARTY_ROLES = [
    ['defendant', 'The defendant'], ['victim', 'The victim'],
    ['advocate', 'The advocate'], ['officer', 'Filed by'],
  ];

  /** The courtroom for one case: everyone in the room, and how it went. */
  function courtroom(k, picked, note) {
    if (!k) return R.h('div', { class: 'empty' }, 'No charge has been filed; the Court has not sat.');
    const seats = benchSeats(k);
    const threshold = k.standardOfProof === undefined || k.standardOfProof === null ? 0.55 : Number(k.standardOfProof);
    const people = R.h('div', { class: 'chips', style: 'gap:var(--p4)' }, PARTY_ROLES.map(([key, label]) => {
      const card = k[key];
      if (!card) return null;
      return R.h('div', { style: 'min-width:150px' },
        R.h('div', { class: 'byline' }, label),
        who(card, { size: 44 }));
    }).filter(Boolean));

    const charge = R.h('div', { style: 'margin:10px 0' },
      R.h('span', { class: 'mono' }, k.law), ' ',
      R.h('b', { class: 'serif' }, k.lawName), ' ',
      R.pill(`severity ${k.severity}`, k.severity >= 4 ? 'danger' : 'neutral'), ' ',
      R.pill(k.track === 'person' ? 'Code of Persons' : 'Code of the City', k.track === 'person' ? 'danger' : 'neutral'),
      k.amount ? R.h('span', { class: 'muted small' }, ` · ${R.lumens(k.amount)} at stake`) : null,
      R.h('div', { class: 'muted small', style: 'margin-top:4px' },
        `filed ${R.whenText(k.filedTick)}${k.triedDay === null ? '' : `, tried d${k.triedDay}`}`
        + `${k.carriedSessions ? ` · carried over ${plural(k.carriedSessions, 'sitting')}` : ''}`
        + `${k.decidedByDefault ? ' · decided on the evidence alone' : ''}`));

    const evidence = R.h('div', { class: 'bar-row', style: 'grid-template-columns:140px 1fr 130px' },
      R.h('span', { class: 'muted' }, 'Evidence as filed'),
      R.bar((k.evidence || 0) * 100, 100, k.evidence >= 0.55 ? 'gold' : ''),
      R.h('span', { class: 'num small' }, R.pct(k.evidence),
        k.advocacy ? R.h('span', { class: 'dim' }, ` · −${k.advocacy} spoken off`) : null));

    const outcome = R.h('div', { style: 'margin-top:10px' },
      k.verdict
        ? R.h('span', { class: `verdict-${k.verdict}`, style: 'font-size:var(--t-20);font-family:var(--display)' }, k.verdict)
        : R.pill(k.status, k.status === 'pending' ? 'accent' : 'neutral'),
      k.sentence ? R.h('span', { class: 'muted', style: 'margin-left:10px' }, R.describeSentence(k.sentence)) : null,
      R.h('span', { style: 'margin-left:10px' }, appealCell(k.appeal)),
      k.appeal && k.appeal.votes && k.appeal.votes.length
        ? R.h('div', { class: 'muted small', style: 'margin-top:4px' },
          `The Council on appeal, ${dayText(k.appeal.decidedDay)}: `
          + k.appeal.votes.map((v) => `${v.name} ${v.vote}`).join(', '))
        : null);

    return R.h('div', { class: 'shop' },
      R.h('div', { class: 'head', style: 'align-items:center' },
        R.h('span', { class: 'mono small dim' }, k.id),
        R.h('span', { class: 'spacer' }),
        picked
          ? R.h('button', { class: 'btn sm', type: 'button', title: 'Back to whatever the Court is sitting on', onclick: () => { openCaseId = null; R.refresh(); } }, 'back to the sitting')
          : R.h('span', { class: 'dim small' }, note)),
      people, charge, evidence,
      R.h('div', { class: 'sub-title' }, `The bench — ${plural(seats.length, 'judge')}`),
      seats.length
        ? R.h('div', { class: 'card-grid' }, seats.map((j) => benchSeat(j, threshold)))
        : R.h('div', { class: 'muted small' }, 'No bench sat on this case.'),
      R.h('div', { class: 'dim small', style: 'margin-top:4px;max-width:70ch' },
        'The bar is the reading that is on the record — the evidence, the record, the city’s regard, '
        + 'the judge’s own ties and what the advocate’s speech was worth. The gold mark is the Charter’s '
        + 'standard of proof. A judge’s private margin is theirs and is not written down.'),
      juryBox(k),
      outcome,
      k.description ? R.story(k.description, { class: 'small' }) : null);
  }

  /** The docket. `shownId` is the case the courtroom above is sitting in on. */
  const caseColumns = (shownId) => [
    { key: 'id', label: 'Case', cls: 'mono small', render: (k) => R.h('span', { style: k.id === shownId ? 'color:var(--gold);font-weight:600' : null }, k.id === shownId ? `▸ ${k.id}` : k.id) },
    { key: 'filedTick', label: 'Filed', cls: 'mono small nowrap', render: (k) => R.h('span', null, R.whenText(k.filedTick), k.triedDay === null ? null : R.h('div', { class: 'dim' }, `tried d${k.triedDay}`)) },
    { key: 'defendantName', label: 'Defendant', truncate: true, render: (k) => R.h('span', { class: 'person' }, face(k.defendantId, 28), R.h('span', { class: 'person-text' }, R.nameLink(k.defendantId, k.defendantName))) },
    { key: 'law', label: 'Charge', cls: 'wrap', render: (k) => R.h('div', null, R.h('span', { class: 'mono' }, k.law), ' ', k.lawName, ' ', R.pill(`sev ${k.severity}`, k.severity >= 4 ? 'danger' : 'neutral')) },
    { key: 'evidence', label: 'Evidence', cls: 'num', render: (k) => R.pct(k.evidence) },
    { key: 'victim', label: 'Victim', cls: 'small', truncate: true, render: (k) => (k.victimId ? R.nameLink(k.victimId, k.victimName) : null) },
    { key: 'judges', label: 'Bench', cls: 'small', render: (k) => R.h('span', { class: 'chips' }, (k.judges || []).map((j) => face(j.id, 22, { title: j.name }))) },
    { key: 'votes', label: 'Votes', render: (k) => voteChips(k.votes) },
    { key: 'verdict', label: 'Verdict', render: (k) => (k.verdict ? R.h('span', { class: `verdict-${k.verdict}` }, k.verdict) : R.pill(k.status, k.status === 'pending' ? 'accent' : 'neutral')) },
    { key: 'sentence', label: 'Sentence', cls: 'small', render: (k) => R.describeSentence(k.sentence) },
    { key: 'appeal', label: 'Appeal', render: (k) => appealCell(k.appeal) },
  ];

  function investigationTable(rows, closed) {
    return R.table({
      columns: [
        { key: 'id', label: 'Id', cls: 'mono small' },
        { key: 'suspect', label: 'Suspect', truncate: true, render: (i) => R.h('span', { class: 'person' }, face(i.suspectId, 26), R.h('span', { class: 'person-text' }, R.nameLink(i.suspectId, i.suspect))) },
        { key: 'lawName', label: 'Looking into', cls: 'small', render: (i) => R.h('span', null, R.h('span', { class: 'mono' }, i.law), ' ', i.lawName) },
        { key: 'evidence', label: 'Evidence', render: (i) => R.h('span', { class: 'mini-bar' }, R.bar((i.evidence || 0) * 100, 100, i.evidence >= 0.55 ? 'gold' : ''), R.h('span', { class: 'num small' }, R.pct(i.evidence))) },
        { key: 'detective', label: 'Detective', cls: 'small', truncate: true, render: (i) => R.nameLink(i.detectiveId, i.detective) },
        { key: 'openedDay', label: closed ? 'Ran' : 'Opened', cls: 'num small nowrap', render: (i) => (closed ? `d${i.openedDay}–d${i.closedDay}` : dayText(i.openedDay)) },
        { key: 'caseId', label: 'Became', cls: 'mono small', render: (i) => (i.caseId ? R.h('a', { class: 'name-link', href: '#court', onclick: (e) => { e.preventDefault(); R.openCase(i.caseId); } }, i.caseId) : i.reportId || null) },
      ],
      rows: rows || [], empty: closed ? 'No investigation has been closed.' : 'The Watch is looking into nothing.',
    });
  }

  function jailBox(jail, keep) {
    if (!jail) return R.h('div', { class: 'empty' }, 'The city holds nobody.');
    const roster = R.table({
      columns: [
        { key: 'name', label: 'Held', truncate: true, render: (r) => who(r, { size: 34 }) },
        { key: 'lawName', label: 'For', cls: 'small', render: (r) => R.h('span', null, R.h('span', { class: 'mono' }, r.law || '—'), ' ', r.lawName || '') },
        { key: 'caseId', label: 'Case', cls: 'mono small', render: (r) => (r.caseId ? R.h('a', { class: 'name-link', href: '#court', onclick: (e) => { e.preventDefault(); R.openCase(r.caseId); } }, r.caseId) : null) },
        { key: 'term', label: 'Term', cls: 'small nowrap', render: (r) => (r.life ? R.pill('for life', 'exiled') : `${plural(r.term, 'day')} from d${r.startDay}`) },
        { key: 'daysLeft', label: 'Served', render: (r) => (r.life
          ? R.h('span', { class: 'dim small' }, `${plural(r.daysServed, 'day')} so far`)
          : R.h('span', { class: 'mini-bar' }, R.bar(r.daysServed, Math.max(r.term || 1, 1), ''), R.h('span', { class: 'num small' }, `${plural(r.daysLeft, 'day')} left`))) },
        { key: 'where', label: 'Where', cls: 'small', render: (r) => R.pill(r.where, r.where === 'watch house' ? 'probation' : 'neutral') },
        { key: 'paroleDay', label: 'Parole', cls: 'small nowrap', render: (r) => (r.paroleRequested ? R.pill('applied', 'accent') : r.paroleEligible ? R.pill('eligible', 'good') : r.paroleDay === null ? R.h('span', { class: 'dim' }, 'none') : `from d${r.paroleDay}`) },
        { key: 'restitutionOwed', label: 'Owed', cls: 'num', render: (r) => (r.restitutionOwed ? R.lumens(r.restitutionOwed) : null) },
      ],
      rows: jail.roster || [], empty: 'The cells are empty.', minWidth: 900,
    });
    const paroled = (jail.paroled || []).length
      ? R.h('div', null,
        R.h('div', { class: 'sub-title' }, 'Out on parole, still serving'),
        R.h('div', { class: 'chips' }, jail.paroled.map((p) => R.h('span', { class: 'chip person', title: `conditions to d${p.untilDay}` },
          face(p.id, 22), p.name, ' ', R.h('span', { class: 'dim' }, `to d${p.untilDay}`)))))
      : null;
    const keepNote = keep && !keep.built && (keep.heldWithoutAKeep || []).length
      ? R.h('div', { class: 'muted small', style: 'margin-top:8px' },
        `The Keep is not built: ${plural(keep.heldWithoutAKeep.length, 'citizen')} held in the Watch house`
        + `${keep.obligationSince === null ? '' : ` since day ${keep.obligationSince}`}.`)
      : null;
    return R.h('div', null, roster, paroled, keepNote);
  }

  function paroleBox(rows) {
    if (!rows || !rows.length) return R.h('div', { class: 'empty' }, 'No prisoner has applied.');
    return R.h('div', { class: 'card-grid wide' }, rows.map((h) => R.h('div', { class: 'household' },
      R.h('div', { class: 'head', style: 'align-items:center' },
        who(h.prisoner, { size: 36 }),
        R.h('span', { class: 'spacer' }),
        h.caseId ? R.h('a', { class: 'name-link mono small', href: '#court', onclick: (e) => { e.preventDefault(); R.openCase(h.caseId); } }, h.caseId) : null,
        R.h('span', { class: 'dim small mono' }, `opened ${dayText(h.openedDay)}`)),
      h.victimOpposes === true ? R.h('div', { class: 'muted small' }, 'The victim opposes release.') : null,
      R.h('div', { class: 'chips', style: 'margin-top:6px' }, (h.bench || []).map((b) => R.h('span', {
        class: 'chip person', title: `${R.fullName(b)}: ${b.vote === null || b.vote === undefined ? 'has not voted' : b.vote ? 'for release' : 'against'}`,
      }, face(b.id, 20), b.name, ' ',
      b.vote === null || b.vote === undefined ? R.h('span', { class: 'dim' }, '—')
        : R.h('span', { class: b.vote ? 'verdict-acquitted' : 'verdict-guilty' }, b.vote ? 'release' : 'hold')))))));
  }

  function gangTable(rows) {
    return R.table({
      columns: [
        { key: 'name', label: 'Gang', render: (g) => R.h('span', null, R.h('b', null, g.name), R.h('div', { class: 'muted small' }, `founded d${g.foundedDay}`)) },
        { key: 'turfName', label: 'Turf', render: (g) => R.tag('district', g.turfName, { id: g.turf }) },
        { key: 'boss', label: 'Boss', truncate: true, render: (g) => who(g.boss, { size: 28, district: false }) },
        { key: 'size', label: 'Members', render: (g) => R.h('span', { class: 'chips' }, (g.members || []).slice(0, 10).map((m) => face(m.id, 22, { title: m.name }))) },
        { key: 'rackets', label: 'Rackets', cls: 'small wrap', render: (g) => (g.rackets || []).map((r) => r.name).join(', ') },
        { key: 'bustedDay', label: 'Status', render: (g) => (g.bustedDay === null ? R.pill('running', 'danger') : R.pill(`busted d${g.bustedDay}`, 'good')) },
      ],
      rows: rows || [], rowClass: (g) => (g.bustedDay === null ? '' : 'faded'), empty: 'The Watch knows of no gang.',
    });
  }

  function reportTable(rows) {
    const tone = { filed: 'accent', open: 'probation', dropped: 'neutral', expired: 'neutral' };
    return R.table({
      columns: [
        { key: 'tick', label: 'When', cls: 'mono small nowrap', render: (r) => R.whenText(r.tick) },
        { key: 'officerName', label: 'Officer', cls: 'small', truncate: true, render: (r) => (r.officerId ? R.nameLink(r.officerId, r.officerName) : R.h('span', { class: 'muted' }, 'the Watch')) },
        { key: 'suspectName', label: 'Suspect', truncate: true, render: (r) => R.nameLink(r.suspectId, r.suspectName) },
        { key: 'lawName', label: 'Reported', cls: 'small', render: (r) => R.h('span', null, R.h('span', { class: 'mono' }, r.law), ' ', r.lawName) },
        { key: 'evidence', label: 'Evidence', cls: 'num', render: (r) => R.pct(r.evidence) },
        { key: 'status', label: 'What came of it', cls: 'small', render: (r) => R.h('span', null, R.pill(r.status, tone[r.status] || 'neutral'), r.filedCaseId ? R.h('a', { class: 'name-link mono small', style: 'margin-left:6px', href: '#court', onclick: (e) => { e.preventDefault(); R.openCase(r.filedCaseId); } }, r.filedCaseId) : null, r.droppedReason ? R.h('div', { class: 'muted small' }, r.droppedReason) : null) },
      ],
      rows: (rows || []).slice(0, 60), empty: 'The Watch has written nothing down.', minWidth: 900,
    });
  }

  R.registerTab('court', {
    label: 'Court',
    mount(root) {
      root.appendChild(R.h('div', { class: 'cards', id: 'court-cards' }));
      root.appendChild(R.section('The courtroom', R.h('span', { id: 'court-room-meta' }), R.h('div', { id: 'court-room' })));
      root.appendChild(R.section('The docket', 'click a row to sit in on the case', R.h('div', { id: 'court-table' })));
      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('Investigations in progress', null, R.h('div', { id: 'court-investigations' })),
        R.section('Gangs known to the Watch', null, R.h('div', { id: 'court-gangs' }))));
      root.appendChild(R.section('The cells', R.h('span', { id: 'court-jail-meta' }), R.h('div', { id: 'court-jail' })));
      root.appendChild(R.section('Parole hearings', 'the bench, the votes and the victim, all of it public', R.h('div', { id: 'court-parole' })));
      root.appendChild(R.section("The Watch's book", 'what was reported, and what an officer did with it', R.h('div', { id: 'court-reports' })));
      root.appendChild(R.section('Investigations closed', null, R.h('div', { id: 'court-closed' })));
    },
    load: () => R.api('/api/court'),
    update(data, root) {
      const $ = (sel) => root.querySelector(sel);
      const n = data.counts || {};
      const jail = data.jail || {};
      const cases = data.cases || [];
      R.setTabCount('court', n.pending || '');

      const rate = n.convictionRate === null || n.convictionRate === undefined ? '—' : `${Math.round(n.convictionRate * 100)}% convicted`;
      R.replace($('#court-cards'),
        R.card('Pending', R.fmt(n.pending), `awaiting the ${R.pad2(data.nextSessionHour)}:00 session`),
        R.card('Convictions', R.fmt(n.guilty), `${R.fmt(n.acquitted)} acquittals · ${rate}`),
        R.card('The ladder', R.fmt(n.ladderSentences), `${R.fmt(n.civicCharges)} charges · ${R.fmt(n.exiles)} exiles ordered`),
        R.card('Custody', R.fmt(n.custodySentences), `${R.fmt(n.personCharges)} charges · ${R.fmt(jail.held)} of ${R.fmt(jail.capacity)} cells${jail.overcrowded ? ' · overcrowded' : ''}`),
        R.card('On appeal', R.fmt(n.appealed), 'decided by the Council'),
        R.card('Investigations', R.fmt((data.investigations || []).length), `${R.fmt((data.gangs || []).filter((g) => g.bustedDay === null).length)} gangs running`));

      // The courtroom keeps whatever the reader picked; failing that it shows
      // the case in front of the bench, and failing that the last one tried.
      let shown = openCaseId ? cases.find((k) => k.id === openCaseId) : null;
      if (!shown) {
        shown = cases.find((k) => k.status === 'in_session') || cases.find((k) => k.status === 'pending')
          || cases.find((k) => k.verdict !== null) || cases[0] || null;
      }
      R.replace($('#court-room-meta'), shown ? `${shown.id} · ${shown.lawName} · ${shown.triedDay === null ? 'not yet tried' : `day ${shown.triedDay}`}` : '');
      const note = shown && (shown.status === 'pending' || shown.status === 'in_session')
        ? 'the case in front of the bench' : 'the last case the Court decided';
      R.replace($('#court-room'), courtroom(shown, Boolean(openCaseId), note));

      replaceTable($('#court-table'), R.table({
        columns: caseColumns(shown ? shown.id : null), rows: cases,
        empty: 'No charges have been filed.', minWidth: 1180,
        onRowClick: (k) => { openCaseId = k.id; R.refresh(); },
      }));

      R.replace($('#court-investigations'), investigationTable(data.investigations, false));
      R.replace($('#court-gangs'), gangTable(data.gangs));
      R.replace($('#court-jail-meta'), `${R.fmt(jail.held)} held of ${R.fmt(jail.capacity)} places · ${R.fmt(jail.lifeTerms)} for life`);
      R.replace($('#court-jail'), jailBox(jail, data.keep));
      R.replace($('#court-parole'), paroleBox(data.paroleHearings));
      replaceTable($('#court-reports'), reportTable(data.reports));
      R.replace($('#court-closed'), investigationTable(data.closedInvestigations, true));
    },
  });

  // ============================================================ 11. THE BANS

  const BAN_COLUMNS = [
    { key: 'name', label: 'Citizen', truncate: true, render: (b) => R.h('span', { class: 'person' },
      face(b.citizenId, 34, { ring: 'exiled' }),
      R.h('span', { class: 'person-text' },
        R.h('span', { class: 'person-name' }, R.nameLink(b.citizenId, b.familyName ? `${b.name} ${b.familyName}` : b.name)),
        R.h('span', { class: 'person-sub' }, b.lineage))) },
    { key: 'law', label: 'Offence', cls: 'wrap', render: (b) => R.h('span', null,
      R.h('span', { class: 'mono' }, b.law), ' ', b.lawName, ' ',
      b.case ? R.pill(`sev ${b.case.severity}`, 'danger') : null,
      b.case ? R.h('div', { class: 'muted small' }, b.case.description) : null) },
    { key: 'day', label: 'Day', cls: 'num', render: (b) => dayText(b.day) },
    { key: 'caseId', label: 'Case', cls: 'mono small', render: (b) => R.h('a', {
      class: 'name-link', href: '#court', title: 'Open the whole case in the courtroom',
      onclick: (e) => { e.preventDefault(); R.openCase(b.caseId); },
    }, b.caseId) },
    { key: 'evidence', label: 'Evidence', cls: 'num', render: (b) => (b.case ? R.pct(b.case.evidence) : null) },
    { key: 'judges', label: 'Bench', cls: 'small', render: (b) => R.h('span', { class: 'chips' }, (b.judges || []).map((j) => face(j.id, 22, { title: j.name }))) },
    { key: 'votes', label: 'Votes', render: (b) => voteChips(b.votes) },
    { key: 'appealed', label: 'Appeal', render: (b) => (b.appealed
      ? R.pill(b.appealResult || 'pending', b.appealResult === 'overturned' ? 'good' : b.appealResult === 'reduced' ? 'probation' : 'danger')
      : R.h('span', { class: 'dim' }, 'none')) },
    { key: 'pardonedDay', label: 'Pardon', render: (b) => (b.pardonedDay === null ? R.pill('in force', 'exiled') : R.pill(`pardoned d${b.pardonedDay}`, 'good')) },
    { key: 'hasApiKey', label: 'Key', cls: 'small', render: (b) => (b.hasApiKey ? R.pill('API key revoked', 'neutral') : null) },
  ];

  R.registerTab('bans', {
    label: 'Ban Registry',
    mount(root) {
      root.appendChild(R.h('p', { class: 'muted small', style: 'max-width:70ch' },
        'Every exile is recorded here permanently: the face, the offence, the bench, the vote, the appeal and any '
        + 'pardon. No citizen is ever deleted — an exile leaves through the Gate and its record stays in the '
        + 'registry forever. An exiled external agent cannot rejoin with the same API key. Click a case number to '
        + 'sit in on the whole trial.'));
      root.appendChild(R.h('div', { id: 'bans-table' }));
    },
    load: () => R.api('/api/bans'),
    update(data, root) {
      const bans = data.bans || [];
      R.setTabCount('bans', data.active || '');
      replaceTable(root.querySelector('#bans-table'), R.table({
        columns: BAN_COLUMNS, rows: bans, minWidth: 1100,
        rowClass: (b) => (b.pardonedDay === null ? '' : 'faded'),
        empty: 'Nobody has been exiled.',
      }));
    },
  });
})();
