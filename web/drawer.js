/*
 * Reverie dashboard — the Profile (docs/UI.md panel 3).
 *
 * One life, drawn over whichever tab is open: the face the city drew for this
 * citizen, how they are introduced, the story of their life so far, their
 * ambitions and needs, a radar of their six skills, where they stand with the
 * Registry, the family tree, the web of friends and rivals, what they own,
 * where they belong, what they have made, what the Court has said of them and
 * what they have said themselves, and the timeline of everything the city
 * wrote down about them.
 *
 * Everything comes from `GET /api/profile/:id` (src/server/views-profile.ts),
 * which is built from public facts alone. Two things are never on this page
 * and never will be: a citizen's own notes and the letters it writes home
 * (docs/PRINCIPLES.md §5). There is no element for them here, and the API does
 * not carry them.
 *
 * There is exactly one button: **follow on the map**, which changes nothing in
 * the city and only marks a dot for the reader (docs/PRINCIPLES.md §1).
 */
(function () {
  'use strict';
  const R = window.R;

  const NEEDS = ['energy', 'rest', 'social', 'comfort', 'purpose'];
  const SKILLS = ['crafting', 'analysis', 'rhetoric', 'care', 'commerce', 'artistry'];
  const CHARACTER = ['honesty', 'diligence', 'sociability', 'generosity', 'civic'];
  /** The score's five public readings, in the order the Registry counts them. */
  const READINGS = ['reputation', 'diligence', 'honesty', 'civic', 'generosity'];
  const TIER_NAMES = { 0: 'no home', 1: 'Lantern Lofts (tier 1)', 2: 'The Terraces (tier 2)', 3: 'Skyline Villas (tier 3)' };
  const POSTS_SHOWN = 8;
  const TIMELINE_SHOWN = 30;

  // ------------------------------------------------------------ the styles
  //
  // The Profile's own rules, on the tokens style.css defines, injected so this
  // file carries the whole of the page — its head, its radar and its ledger —
  // in one place, the way map.js carries the map.

  const CSS = `
.drawer { width: min(760px, 100vw); }
.profile-head { display: flex; gap: var(--p4); align-items: flex-start; margin-bottom: var(--p3); }
.profile-head > .portrait { flex: 0 0 auto; border-radius: 12px; }
.profile-id { min-width: 0; flex: 1; }
.profile-id h2 { margin: 0; }
.profile-epithet { font-family: var(--display); font-size: var(--t-16); color: var(--gold); line-height: 1.3; margin: 3px 0 var(--p2); max-width: 46ch; }
.profile-meta { display: flex; flex-wrap: wrap; gap: 4px var(--p3); font-family: var(--mono); font-size: 11px; color: var(--dim); }
.profile-actions { margin-top: var(--p3); }
.profile-actions .btn.following { background: var(--accent-soft); border-color: rgba(95, 179, 161, 0.55); color: var(--accent); }
.profile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--p3) var(--p5); align-items: start; }
.profile-grid > div { min-width: 0; }
.drawer .goal { display: grid; grid-template-columns: 1fr 54px; gap: 2px var(--p3); align-items: center; margin-bottom: var(--p2); font-size: 12.5px; }
.drawer .goal .bar { grid-column: 1 / -1; }
.drawer .goal .done { color: var(--good); }

.radar { display: block; margin: 0 auto; overflow: visible; }
.radar .ring { fill: none; stroke: var(--border); stroke-width: 1; }
.radar .ring.outer { stroke: var(--border-strong); }
.radar .axis { stroke: var(--border); stroke-width: 1; }
.radar .shape { fill: rgba(230, 192, 104, 0.16); stroke: var(--gold); stroke-width: 1.5; stroke-linejoin: round; }
.radar .vertex { fill: var(--gold); }
.radar .label { fill: var(--muted); font-size: 10px; font-family: var(--sans); letter-spacing: 0.04em; }
.radar .label .amt { fill: var(--text); font-family: var(--mono); }

.score-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--p2) var(--p3); }
.score-head .score { font-family: var(--mono); font-size: var(--t-34); font-weight: 600; line-height: 1; color: var(--gold); }
.score-head .of { color: var(--dim); font-family: var(--mono); font-size: var(--t-12); }
.score-track { position: relative; height: 10px; margin: var(--p2) 0 var(--p1); background: var(--panel-3); border-radius: 5px; overflow: hidden; }
.score-track > i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--gold); border-radius: 5px; transition: width 600ms var(--ease); }
.score-track.short > i { background: var(--rust); }
.score-track > b { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--text); opacity: 0.85; }
.ledger { display: grid; grid-template-columns: 104px 1fr 74px; gap: 3px var(--p3); align-items: center; font-size: 12px; }
.ledger .who { color: var(--muted); }
.ledger .amt { font-family: var(--mono); text-align: right; font-variant-numeric: tabular-nums; }
.ledger .amt.neg { color: var(--exiled); }
.ledger .rule { grid-column: 1 / -1; height: 1px; background: var(--border); margin: var(--p1) 0; }
.notice-box { border: 1px solid rgba(230, 192, 104, 0.4); background: var(--gold-soft); border-radius: 8px; padding: var(--p3); margin: var(--p3) 0; }
.notice-box.grave { border-color: rgba(208, 104, 79, 0.45); background: rgba(208, 104, 79, 0.08); }
.notice-box h4 { margin: 0 0 var(--p1); font-family: var(--display); font-size: var(--t-16); color: var(--gold); }
.notice-box.grave h4 { color: var(--rust); }
.notice-box .keeps { color: var(--muted); font-size: 11.5px; margin-top: var(--p2); }
.notice-items { display: grid; grid-template-columns: 1fr 64px; gap: 2px var(--p3); font-size: 11.5px; margin-top: var(--p2); }
.notice-items .amt { font-family: var(--mono); text-align: right; }

.drawer .lifeline { list-style: none; margin: 0; padding: 0; }
.drawer .lifeline li { display: grid; grid-template-columns: 58px 1fr; gap: var(--p3); padding: var(--p2) 0 var(--p2) 0; border-bottom: 1px solid rgba(42, 48, 59, 0.7); font-size: 12.5px; }
.drawer .lifeline li:last-child { border-bottom: 0; }
.drawer .lifeline .day { font-family: var(--mono); font-size: 11px; color: var(--gold); }
.drawer .said { border-left: 2px solid var(--border-strong); padding: 2px 0 2px var(--p3); margin-bottom: var(--p2); font-size: 12.5px; }
.drawer .said .when { font-family: var(--mono); font-size: 11px; color: var(--dim); margin-right: var(--p2); }
.drawer .said.diary { font-family: var(--display); border-left-color: var(--gold); }
@media (max-width: 700px) {
  .profile-grid { grid-template-columns: 1fr; }
  .profile-head { gap: var(--p3); }
}
`;

  function injectStyles() {
    if (document.getElementById('profile-css')) return;
    document.head.appendChild(R.h('style', { id: 'profile-css' }, CSS));
  }

  // ------------------------------------------------------------ the follow
  //
  // The one control on this page. The map pack owns the marking
  // (`R.map.follow`); this is the name every other pack calls, late-bound so
  // whoever defines it first wins. Following a citizen changes nothing in the
  // city — it only decides which dot the reader's eye is kept on.

  let wanted = null;

  R.followCitizen = R.followCitizen || function followCitizen(id) {
    wanted = id || null;
    if (R.map && typeof R.map.follow === 'function') return R.map.follow(wanted);
    return wanted;
  };

  R.followingCitizen = R.followingCitizen || function followingCitizen() {
    if (R.map && typeof R.map.following === 'function') return R.map.following();
    return wanted;
  };

  // ------------------------------------------------------------- the radar
  //
  // Six axes, no library: rings at a quarter, a half, three quarters and the
  // whole of the scale, one spoke per skill, and the citizen's own hexagon
  // over them.

  const RINGS = [0.25, 0.5, 0.75, 1];

  function radar(values, keys, opts) {
    const o = opts || {};
    const size = o.size || 220;
    const max = o.max || 100;
    const r = size / 2 - 30;
    const cx = size / 2;
    const cy = size / 2;
    const n = keys.length;
    const at = (i, frac) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return [cx + Math.cos(a) * r * frac, cy + Math.sin(a) * r * frac];
    };
    const poly = (frac) => keys.map((k, i) => at(i, frac).map((v) => v.toFixed(1)).join(',')).join(' ');
    const svg = R.svg('svg', {
      class: 'radar', width: size, height: size, viewBox: `0 0 ${size} ${size}`,
      role: 'img', 'aria-label': o.label || 'skills',
    });
    for (const ring of RINGS) svg.appendChild(R.svg('polygon', { class: `ring${ring === 1 ? ' outer' : ''}`, points: poly(ring) }));
    keys.forEach((k, i) => {
      const [x, y] = at(i, 1);
      svg.appendChild(R.svg('line', { class: 'axis', x1: cx, y1: cy, x2: x.toFixed(1), y2: y.toFixed(1) }));
    });
    const fracs = keys.map((k) => R.clamp((Number(values[k]) || 0) / max, 0, 1));
    svg.appendChild(R.svg('polygon', {
      class: 'shape',
      points: keys.map((k, i) => at(i, Math.max(0.02, fracs[i])).map((v) => v.toFixed(1)).join(',')).join(' '),
    }));
    keys.forEach((k, i) => {
      const [vx, vy] = at(i, Math.max(0.02, fracs[i]));
      svg.appendChild(R.svg('circle', { class: 'vertex', cx: vx.toFixed(1), cy: vy.toFixed(1), r: 2.2 }));
      const [lx, ly] = at(i, 1.2);
      const anchor = lx > cx + 2 ? 'start' : lx < cx - 2 ? 'end' : 'middle';
      svg.appendChild(R.svg('text', {
        class: 'label', x: lx.toFixed(1), y: (ly + (ly < cy ? -1 : 7)).toFixed(1), 'text-anchor': anchor,
      }, R.titleCase(k), ' ', R.svg('tspan', { class: 'amt' }, String(Math.round(Number(values[k]) || 0)))));
    });
    return svg;
  }

  // ----------------------------------------------------------- small parts

  const dim = (text) => R.h('span', { class: 'dim' }, text);
  const empty = (text) => R.h('div', { class: 'dim small' }, text);

  function stat(label, value, cls) {
    return R.h('div', { class: 'stat' },
      R.h('div', { class: 'label' }, label),
      R.h('div', { class: `value ${cls || ''}` }, value));
  }

  function sub(title, node) {
    return R.h('div', null, R.h('div', { class: 'sub-title' }, title), node);
  }

  /** A person the profile links to, as a portrait and a name. */
  function personChip(card, note) {
    if (!card) return null;
    return R.h('span', { class: 'person' },
      R.portrait(card.id, 24, { alt: card.name }),
      R.h('span', { class: 'person-text' },
        R.h('span', { class: 'person-name' }, R.nameLink(card.id, R.fullName(card))),
        note ? R.h('span', { class: 'person-sub' }, note) : null));
  }

  // ------------------------------------------------------------ the header

  function header(c) {
    const ring = c.standing === 'exiled' ? 'exiled' : c.office ? 'office' : null;
    const follow = R.h('button', { class: 'btn', type: 'button' }, 'Follow on the map');
    const paint = () => {
      const on = R.followingCitizen() === c.id;
      follow.classList.toggle('following', on);
      follow.textContent = on ? 'Following on the map · stop' : 'Follow on the map';
      follow.title = on
        ? 'Stop marking this citizen on the plan'
        : 'Keep this citizen marked on the plan. The map watches; it cannot move anybody.';
    };
    follow.addEventListener('click', () => {
      R.followCitizen(R.followingCitizen() === c.id ? null : c.id);
      paint();
    });
    paint();
    return R.h('div', { class: 'profile-head' },
      R.portrait(c.id, 128, { eager: true, ring, onClick: false, alt: R.fullName(c) }),
      R.h('div', { class: 'profile-id' },
        R.h('h2', null, R.fullName(c)),
        R.h('div', { class: 'profile-epithet' }, c.epithet || ''),
        R.h('div', { class: 'subtitle' },
          R.standingPill(c.standing),
          R.stagePill(c.lifeStage),
          c.office ? R.pill(R.titleCase(c.office), 'gold') : null,
          R.brainBadge(c.brain),
          R.tag('district', c.district, { label: c.districtName }),
          c.record && c.record.jailed ? R.pill('in custody', 'danger') : null,
          c.record && c.record.detained && !c.record.jailed ? R.pill('detained', 'neutral') : null,
          c.health && c.health.glitched ? R.pill('unwell', 'suspended') : null,
          !c.present && c.standing !== 'exiled' ? R.pill('left the city', 'neutral') : null),
        R.h('div', { class: 'profile-meta' },
          R.h('span', null, c.id),
          R.h('span', null, c.lineage),
          R.h('span', null, c.bornDay !== null && c.family && (c.family.parents || []).length
            ? `born day ${c.bornDay}` : `arrived day ${c.arrivedDay}`),
          R.h('span', null, `${c.age} day${c.age === 1 ? '' : 's'} old`),
          c.judgeTermEndsDay ? R.h('span', null, `judge until day ${c.judgeTermEndsDay}`) : null),
        R.h('div', { class: 'profile-actions' }, follow)));
  }

  function statsRow(c) {
    const b = c.belongings || {};
    const rep = c.repute || {};
    return R.h('div', { class: 'stats' },
      stat('Wallet', R.lumens(b.wallet), 'mono'),
      // A child is never tested against a line, so the tile stays empty and the
      // Standing section says why (docs/CITIZENSHIP.md §2).
      stat('Repute', rep.scored && rep.tested ? R.fmt(rep.score) : '—', rep.scored && rep.tested && !rep.admitted ? 'warn-text' : ''),
      stat('Reputation', R.fmt(c.reputation)),
      stat('Mood', R.fmt(c.mood)),
      stat('Home', TIER_NAMES[b.homeTier] ? String(TIER_NAMES[b.homeTier]).replace(/\s*\(.*\)$/, '') : `tier ${b.homeTier}`),
      stat('District', c.districtName || R.districtName(c.district)));
  }

  // ------------------------------------------------- goals, needs, skills

  /** The goal labels are already sentences ("grow old in good standing"). */
  const sentence = (s) => String(s || '').replace(/^./, (m) => m.toUpperCase());

  function goals(list) {
    if (!list || !list.length) return empty('No ambition on the record.');
    return R.h('div', null, list.map((g) => R.h('div', { class: 'goal' },
      R.h('span', null, sentence(g.label || R.titleCase(g.kind)), ' ',
        g.achieved ? R.h('span', { class: 'done' }, '· reached') : null),
      R.h('span', { class: 'num' }, R.pct(g.progress, 0)),
      R.bar(g.progress * 100, 100, g.achieved ? 'gold' : ''))));
  }

  function needs(values) {
    return R.h('div', null, NEEDS.map((n) => R.barRow(R.titleCase(n), values[n] ?? 0, 100,
      (values[n] ?? 0) < 20 ? 'crit' : (values[n] ?? 0) < 40 ? 'warn' : '')));
  }

  function character(values) {
    return R.h('div', null,
      empty('What the city has watched this citizen do, read off the record and refreshed daily.'),
      CHARACTER.map((t) => R.barRow(R.titleCase(t), ((values || {})[t] || 0) * 100, 100, '')));
  }

  // ---------------------------------------------------------- the standing
  //
  // Repute (docs/CITIZENSHIP.md §1) is counted, not inferred: every line of it
  // is a public act, so the whole sum is printed here — what each reading was
  // worth, what the contribution column counted, and what every conviction
  // still costs.

  function ledgerRow(label, value, max, cls) {
    return [
      R.h('span', { class: 'who' }, label),
      max ? R.bar(Math.abs(value), max, cls) : R.h('span', null),
      R.h('span', { class: `amt${value < 0 ? ' neg' : ''}` }, R.signed(value)),
    ];
  }

  function reputeLedger(k) {
    const w = (k.scale && k.scale.weights) || {};
    const rows = [ledgerRow('baseline', k.baseline, k.scale ? k.scale.baseline : 300, 'gold')];
    for (const name of READINGS) rows.push(ledgerRow(name, k[name] ?? 0, w[name] || 100, ''));
    rows.push(ledgerRow('contribution', k.contribution ?? 0, (k.scale && k.scale.contributionCap) || 140, 'gold'));
    if (k.civicPenalty) rows.push(ledgerRow('the ladder', -k.civicPenalty, k.scale ? k.scale.max / 4 : 250, 'crit'));
    if (k.custodialPenalty) rows.push(ledgerRow('custody', -k.custodialPenalty, k.scale ? k.scale.max / 2 : 500, 'crit'));
    rows.push([R.h('span', { class: 'rule' })]);
    rows.push([
      R.h('span', { class: 'who' }, 'repute'),
      R.h('span', { class: 'muted small' }, k.capped ? `capped at ${R.fmt(k.ceiling)} for life by the record` : ''),
      R.h('span', { class: 'amt' }, R.fmt(k.score)),
    ]);
    return R.h('div', { class: 'ledger' }, rows);
  }

  /**
   * The open notice, in the Registry's own terms. The score and the shortfall
   * are the ones printed at the top of the section — the notice carries the
   * register's reading of them, which can be a morning behind — so the page
   * never shows one citizen two repute scores.
   */
  function noticeBox(n, k, city) {
    const grave = n.immediate || n.daysLeft === 0;
    const short = Math.max(0, n.line - k.score);
    return R.h('div', { class: `notice-box${grave ? ' grave' : ''}` },
      R.h('h4', null, `Notice of standing, day ${n.issuedDay}`),
      R.h('div', null,
        `${city} asks ${R.fmt(n.line)} of a resident; this repute is ${R.fmt(k.score)}, `
        + `${R.fmt(short)} short — ${n.reason}.`),
      R.h('div', { class: 'muted', style: 'margin-top:6px' },
        n.immediate
          ? 'There is no grace: the Court sits on this residency at the next sitting.'
          : `Grace of ${n.graceDays} days runs out on day ${n.graceEndsDay}`
            + `${n.daysLeft > 0 ? ` — ${n.daysLeft} day${n.daysLeft === 1 ? '' : 's'} left` : ' — the grace has run out'}`
            + `${n.halved ? ' (halved: a second notice within a cycle)' : ''}.`),
      R.h('div', { class: 'muted small', style: 'margin-top:4px' },
        `${n.daysAbove} of ${n.recoveryDays} days back above the line`
        + `${n.applied ? ' · they have asked to be heard' : ''}`),
      n.items && n.items.length
        ? R.h('div', { class: 'sub-title' }, `What the notice itemised on day ${n.issuedDay}`) : null,
      n.items && n.items.length
        ? R.h('div', { class: 'notice-items' }, n.items.slice(0, 8).map((i) => [
          R.h('span', null, i.label),
          R.h('span', { class: `amt${i.amount < 0 ? ' neg' : ''}` }, R.signed(i.amount)),
        ]))
        : null,
      n.keeps && n.keeps.length
        ? R.h('div', { class: 'keeps' }, `Nothing else changes: ${n.keeps.join(', ')}.`)
        : null);
  }

  function hearingList(list) {
    if (!list || !list.length) return null;
    return sub('Residency hearings', R.h('ul', { class: 'list' }, list.map((h) => R.h('li', null,
      R.h('span', { class: 'when' }, `d${h.day} ${R.pad2(h.hour)}:00`),
      R.h('span', null,
        R.h('span', null, `repute ${R.fmt(h.repute)} against a line of ${R.fmt(h.line)} — `),
        R.pill(h.outcome || 'sitting', h.outcome === 'ended' ? 'exiled' : h.outcome === 'confirmed' ? 'good' : 'probation'),
        h.leaveByDay !== null && h.leaveByDay !== undefined ? R.h('span', { class: 'muted small' }, ` · to leave by day ${h.leaveByDay}`) : null,
        h.extendedDays ? R.h('span', { class: 'muted small' }, ` · ${h.extendedDays} more days`) : null,
        h.vouchers && h.vouchers.length ? R.h('div', { class: 'muted small' }, `Vouched for by ${h.vouchers.join(', ')}.`) : null,
        Object.keys(h.votes || {}).length
          ? R.h('div', { class: 'chips', style: 'margin-top:4px' },
            Object.entries(h.votes).map(([who, v]) => R.h('span', { class: 'chip' }, `${who} ${v}`)))
          : null,
        (h.reasons || []).length ? R.h('div', { class: 'muted small' }, h.reasons.join(' ')) : null)))));
  }

  function standing(c) {
    const k = c.repute || {};
    if (!k.scored) {
      return [empty('The Registry has not scored this citizen yet.'),
        R.h('div', { class: 'muted small' }, `${(k.city || {}).name || 'Reverie'} asks ${R.fmt(k.line)} of a resident.`)];
    }
    const max = (k.scale && k.scale.max) || 1000;
    const cityName = (k.city || {}).name || 'Reverie';
    const track = R.h('div', { class: `score-track${k.admitted ? '' : ' short'}` },
      R.h('i', { style: `width:${R.clamp((k.score / max) * 100, 0, 100).toFixed(1)}%` }),
      R.h('b', { style: `left:${R.clamp((k.line / max) * 100, 0, 100).toFixed(1)}%`, title: `the residency line: ${R.fmt(k.line)}` }));
    const out = [
      R.h('div', { class: 'score-head' },
        R.h('span', { class: 'score' }, R.fmt(k.score)),
        R.h('span', { class: 'of' }, `of ${R.fmt(max)}`),
        k.tested
          ? R.h('span', { class: k.admitted ? 'muted' : 'warn-text' },
            k.admitted
              ? `${R.fmt(k.above)} above the line ${cityName} asks of a resident (${R.fmt(k.line)})`
              : `${R.fmt(k.shortfall)} short of the ${R.fmt(k.line)} ${cityName} asks of a resident`)
          : R.h('span', { class: 'muted' }, 'never tested: a child born in Reverie is a resident of it')),
      track,
      R.h('div', { class: 'dim small' }, 'Counted from public acts alone, and readable by anyone.'),
      reputeLedger(k),
    ];
    if (k.notice) out.push(noticeBox(k.notice, k, cityName));
    if (k.penalties && k.penalties.length) {
      out.push(sub('What the record still costs', R.h('ul', { class: 'list' }, k.penalties.map((p) => R.h('li', null,
        R.h('span', { class: 'when' }, p.caseId),
        R.h('span', null, R.h('span', { class: 'mono' }, p.law), ` ${p.lawName} `,
          R.pill(p.kind === 'custodial' ? 'custody' : 'ladder', p.kind === 'custodial' ? 'danger' : 'neutral'),
          R.h('span', { class: 'muted small' }, p.frozen
            ? ' · frozen while the term is served'
            : ` · ${p.cleanDays} clean day${p.cleanDays === 1 ? '' : 's'} counted against it`)),
        R.h('span', { class: 'spacer' }),
        R.h('span', { class: 'num neg' }, R.signed(-p.cost)))))));
    }
    if (k.deeds && k.deeds.length) {
      out.push(sub('What the city counted', R.h('div', { class: 'chips' }, k.deeds.map((d) => R.h('span', {
        class: 'chip', title: `${d.count} × ${d.label}`,
      }, `${d.label} ×${d.count} · +${d.worth}`)))));
    }
    if (k.vouchedBy && k.vouchedBy.length) {
      out.push(R.h('div', { class: 'muted small', style: 'margin-top:8px' }, `Names standing behind them at the gate: ${k.vouchedBy.join(', ')}.`));
    }
    const hearings = hearingList(k.hearings);
    if (hearings) out.push(hearings);
    return out;
  }

  // ------------------------------------------------- family, ties, belongs

  function selfCard(c) {
    return {
      id: c.id, name: c.name, familyName: c.familyName, lifeStage: c.lifeStage,
      standing: c.standing, office: c.office, district: c.district, present: c.present,
    };
  }

  function family(c) {
    const fam = c.family || {};
    const home = fam.household;
    return [
      // The citizen stands beside their partner; on their own they are not a band.
      R.tree(fam, { self: fam.partner ? selfCard(c) : null, empty: 'No family on the record.' }),
      fam.partner
        ? R.h('div', { class: 'muted small', style: 'margin-top:8px' },
          `${fam.partner.married ? 'Married' : 'Partners'} since day ${fam.partner.since ?? 0} · affection ${fam.partner.affection}`)
        : null,
      home
        ? R.h('div', { class: 'muted small' },
          `Home: ${home.tierName}, ${(home.members || []).length} at home, sleeps ${home.capacity} · `
          + `${R.lumens(home.rentShare)}/day of the rent${home.arrearsDays ? ` · ${home.arrearsDays}d in arrears` : ''}`)
        : null,
    ];
  }

  function bondList(items, none) {
    if (!items || !items.length) return empty(none);
    return R.h('ul', { class: 'list' }, items.map((b) => R.h('li', { class: 'bond' },
      personChip(b),
      R.h('span', { class: 'spacer' }),
      R.h('span', { class: `num ${b.bond >= 0 ? 'pos' : 'neg'}` }, R.signed(b.bond)))));
  }

  function ties(c) {
    const rel = c.relationships || {};
    return [
      R.graph(rel, { selfId: c.id, size: 440, node: 40, max: 18, empty: 'No ties yet.' }),
      R.h('div', { class: 'profile-grid', style: 'margin-top:12px' },
        R.h('div', null, R.h('div', { class: 'sub-title' }, 'Friends'), bondList(rel.friends, 'No close friends yet.')),
        R.h('div', null, R.h('div', { class: 'sub-title' }, 'Rivals'), bondList(rel.rivals, 'No rivals.'))),
      rel.affections && rel.affections.length
        ? sub('Affection', R.h('div', { class: 'chips' }, rel.affections.map((a) => R.h('span', {
          class: 'chip person clickable', onclick: () => R.openProfile(a.id),
        }, `${a.name} ${a.affection}`))))
        : null,
      rel.mentor || rel.mentee
        ? sub('Mentorship', R.h('div', { class: 'chips' }, [
          rel.mentor ? personChip(rel.mentor, 'mentor') : null,
          rel.mentee ? personChip(rel.mentee, 'mentee') : null,
        ].filter(Boolean)))
        : null,
      rel.feuds && rel.feuds.length
        ? sub('Feuds', R.h('ul', { class: 'list' }, rel.feuds.map((f) => R.h('li', null,
          R.h('span', null, (f.families || []).join(' and '), ' '),
          R.h('span', { class: 'muted small' }, `since day ${f.sinceDay} · ${f.incidents} incident${f.incidents === 1 ? '' : 's'}`)))))
        : null,
    ];
  }

  function belongs(c) {
    const rows = [];
    const kv = (label, node) => { rows.push(R.h('dt', null, label), R.h('dd', null, node)); };
    if (c.clubs && c.clubs.length) {
      kv('Clubs', R.h('span', null, c.clubs.map((k, i) => R.h('span', null, i ? ', ' : '', k.name,
        k.isConvenor ? R.h('span', { class: 'muted small' }, ' (convenor)') : null))));
    }
    if (c.team) kv('Team', `${c.team.name} · ${c.team.wins}W ${c.team.draws}D ${c.team.losses}L`);
    if (c.party) kv('Party', R.h('span', null, c.party.name, ' ', R.platformBars(c.party.platform),
      R.h('span', { class: 'muted small' }, ` · ${c.party.seats} seat${c.party.seats === 1 ? '' : 's'}${c.party.isLeader ? ' · leader' : ''}`)));
    if (c.platform) kv('Stood on', R.h('span', null, R.platformBars(c.platform),
      R.h('span', { class: 'muted small' }, ' tax · dividend · minimum wage · strictness')));
    if (c.promises && c.promises.length) {
      kv('Promises', R.h('span', null, c.promises.map((p, i) => R.h('span', null, i ? '; ' : '',
        `${p.words} (day ${p.madeDay})`,
        R.h('span', { class: p.state === 'kept' ? 'num pos' : p.state === 'broken' ? 'num neg' : 'muted' }, ` ${p.state}`)))));
    }
    if (c.school) kv('School of thought', c.school.name);
    if (c.union) kv('Union', `${c.union.name} (${c.union.role})${c.union.striking ? ' · on strike' : ''}`);
    if (c.gang) kv('Known to the Watch', `${c.gang.name}${c.gang.isBoss ? ' · boss' : ''}${c.gang.bustedDay !== null ? ` · broken up day ${c.gang.bustedDay}` : ''}`);
    if (c.paper) kv('Reads', R.titleCase(c.paper));
    if (!rows.length) return empty('Belongs to nothing yet.');
    return R.h('dl', { class: 'kv' }, rows);
  }

  function work(c) {
    const b = c.belongings || {};
    const rows = [];
    const kv = (label, node) => { rows.push(R.h('dt', null, label), R.h('dd', null, node)); };
    kv('Work', c.job
      ? `${c.job.title} at ${c.job.employer} · ${R.lumens(c.job.wage)}/shift · ${R.districtName(c.job.district)}`
      : dim('unemployed'));
    if (c.business) kv('Business', `${c.business.name} (${R.titleCase(c.business.kind)}) · till ${R.lumens(c.business.treasury)} · ${c.business.employees} staff`);
    kv('Home', `${TIER_NAMES[b.homeTier] || b.homeTier}${b.homeBuildingName ? ` · ${b.homeBuildingName}` : ''}`
      + (b.tenancy ? ` · rent ${R.lumens(b.tenancy.rent)}` : ''));
    if (b.property && b.property.length) {
      kv('Property', R.h('span', null, b.property.map((u, i) => R.h('span', null, i ? ', ' : '',
        `${u.buildingName} (tier ${u.tier}, ${R.lumens(u.rent)}${u.tenant ? ` — let to ${u.tenant}` : ' — empty'})`))));
    }
    if (b.shares && b.shares.length) {
      kv('Shares', b.shares.map((s) => `${s.name} ×${s.qty} (${R.lumens(s.value)})`).join(', '));
    }
    if (b.loan) kv('Loan', `${R.lumens(b.loan.outstanding)} outstanding${b.loan.defaulted ? ' · DEFAULTED' : ''}`);
    const held = Object.entries(b.inventory || {}).filter(([, q]) => q > 0);
    kv('Carrying', held.length ? held.map(([g, q]) => `${g} × ${q}`).join(', ') : dim('empty-handed'));
    return [
      R.h('dl', { class: 'kv' }, rows),
      sub(`Possessions (${(b.possessions || []).length})`, (b.possessions || []).length
        ? R.h('div', { class: 'chips' }, b.possessions.map((p) => R.h('span', {
          class: 'chip', title: `${R.titleCase(p.category)}${p.hobby ? ` · ${R.titleCase(p.hobby)}` : ''} · bought day ${p.acquiredDay}`,
        }, p.name)))
        : empty('Owns nothing yet.')),
      (b.wants || []).length
        ? sub('Would like', R.h('div', { class: 'chips' }, b.wants.map((w) => R.h('span', {
          class: 'chip want', title: `about ${R.lumens(w.basePrice)}`,
        }, w.name))))
        : null,
      (b.neighbours || []).length
        ? sub('Neighbours', R.h('div', { class: 'chips' }, b.neighbours.map((p) => R.h('span', {
          class: 'chip person clickable', onclick: () => R.openProfile(p.id),
        }, R.fullName(p)))))
        : null,
    ];
  }

  function works(list) {
    if (!list || !list.length) return empty('Has made nothing yet.');
    return R.h('ul', { class: 'list' }, list.map((w) => R.h('li', null,
      R.h('span', { class: 'when' }, `d${w.createdDay}`),
      R.h('span', null, R.h('b', null, w.title), ' ', R.tag('work', R.titleCase(w.kind)),
        w.inMuseum ? R.pill('in the Museum', 'gold') : null,
        R.h('span', { class: 'muted small' }, ` · ${w.homeName} · quality ${w.quality} · known to ${w.popularity}`
          + (w.reviewScore === null || w.reviewScore === undefined ? '' : ` · reviewed ${w.reviewScore}`))))));
  }

  // ---------------------------------------------------------- the record

  function record(c) {
    const rec = c.record || {};
    const s = c.stats || {};
    const out = [];
    if (rec.ban) {
      out.push(R.h('div', { class: 'error-box' },
        `Exiled on day ${rec.ban.day} for ${rec.ban.law} ${rec.ban.lawName} (case ${rec.ban.caseId})`
        + `${rec.ban.pardonedDay !== null ? `; pardoned day ${rec.ban.pardonedDay}` : ''}.`));
    }
    if (rec.jailed) {
      out.push(R.h('div', { class: 'error-box' },
        `In custody${rec.jailCaseId ? ` on case ${rec.jailCaseId}` : ''}`
        + `${rec.jailedUntilDay !== null && rec.jailedUntilDay !== undefined ? ` until day ${rec.jailedUntilDay} (${rec.jailDaysLeft} days left)` : ' for life'}.`));
    }
    out.push(R.h('dl', { class: 'kv' },
      R.h('dt', null, 'Convictions'), R.h('dd', null, `${(rec.convictions || []).length} (${rec.strikes || 0} strike${rec.strikes === 1 ? '' : 's'})`),
      R.h('dt', null, 'Pending charges'), R.h('dd', null, String(rec.pendingCharges ?? 0)),
      R.h('dt', null, 'Fines owed'), R.h('dd', null, R.lumens(rec.finesOwed)),
      R.h('dt', null, 'Service days'), R.h('dd', null, String(rec.communityServiceDaysLeft || 0)),
      rec.probationUntilDay !== null && rec.probationUntilDay !== undefined ? R.h('dt', null, 'Probation until') : null,
      rec.probationUntilDay !== null && rec.probationUntilDay !== undefined ? R.h('dd', null, `day ${rec.probationUntilDay}`) : null,
      rec.suspendedUntilDay !== null && rec.suspendedUntilDay !== undefined ? R.h('dt', null, 'Suspended until') : null,
      rec.suspendedUntilDay !== null && rec.suspendedUntilDay !== undefined ? R.h('dd', null, `day ${rec.suspendedUntilDay}`) : null,
      R.h('dt', null, 'Offences'), R.h('dd', null, `${s.offencesCommitted ?? 0} committed · ${s.offencesDetected ?? 0} detected`)));
    if (rec.cases && rec.cases.length) {
      out.push(R.h('ul', { class: 'list' }, rec.cases.map((k) => R.h('li', null,
        R.h('span', { class: 'when' }, `${k.id} · d${k.day}`),
        R.h('span', null,
          R.h('span', { class: 'mono' }, k.law), ` ${k.lawName} — `,
          k.verdict ? R.h('span', { class: `verdict-${k.verdict}` }, k.verdict) : R.h('span', { class: 'muted' }, k.status),
          k.sentence && typeof R.describeSentence === 'function'
            ? R.h('span', { class: 'muted small' }, ` · ${R.describeSentence(k.sentence)}`) : null,
          k.advocate ? R.h('span', { class: 'muted small' }, ` · defended by ${k.advocate}`) : null)))));
    }
    if (rec.memorial) {
      out.push(R.h('div', { class: 'muted small' },
        `A memorial was raised on day ${rec.memorial.day}: “${rec.memorial.epitaph}”`));
    }
    if (rec.monuments && rec.monuments.length) {
      out.push(R.h('div', { class: 'muted small' },
        rec.monuments.map((m) => `A monument stands, raised day ${m.day}: “${m.inscription}”`).join(' ')));
    }
    if (c.rumours && c.rumours.length) {
      out.push(sub('What is being said', R.h('ul', { class: 'list' }, c.rumours.slice(0, 6).map((r) => R.h('li', null,
        R.h('span', { class: 'when' }, `d${r.day}`),
        R.h('span', null, r.claim, R.h('span', { class: 'muted small' }, ` · told to ${r.heard}`),
          r.disprovedDay !== null && r.disprovedDay !== undefined
            ? R.h('span', null, ' ', R.pill('disproved', 'good')) : null))))));
    }
    return out;
  }

  // -------------------------------------------------- words and the life

  function said(c) {
    const posts = (c.posts || []).slice(0, POSTS_SHOWN);
    const diary = (c.diary || []).slice().reverse().slice(0, 5);
    return [
      R.h('div', { class: 'sub-title' }, 'On the Commons feed'),
      posts.length
        ? R.h('div', null, posts.map((p) => R.h('div', { class: 'said' },
          R.h('span', { class: 'when' }, `d${p.day}`), p.text,
          p.reactionCount ? R.h('span', { class: 'muted small' }, ` · ${p.reactionCount} reacted`) : null)))
        : empty('Has posted nothing.'),
      R.h('div', { class: 'sub-title' }, 'From the diary'),
      diary.length
        ? R.h('div', null, diary.map((d) => R.h('div', { class: 'said diary' },
          R.h('span', { class: 'when' }, `d${d.day}`), d.text)))
        : empty('Has written nothing.'),
      R.h('div', { class: 'dim small', style: 'margin-top:6px' },
        'The diary is a public line about the day. A citizen’s private notebook and its letters home are not shown here, and never will be.'),
    ];
  }

  function lifeline(list) {
    const rows = (list || []).slice(-TIMELINE_SHOWN).reverse();
    if (!rows.length) return empty('Nothing written down yet.');
    return R.h('ul', { class: 'lifeline' }, rows.map((m) => R.h('li', null,
      R.h('span', { class: 'day' }, `day ${m.day}`),
      R.h('span', null, m.text))));
  }

  function lifetime(c) {
    const s = c.stats || {};
    return R.h('dl', { class: 'kv' },
      R.h('dt', null, 'Earned'), R.h('dd', null, `${R.lumens(s.totalEarned)} · tax paid ${R.lumens(s.totalTaxPaid)}`),
      R.h('dt', null, 'Shifts worked'), R.h('dd', null, String(s.shiftsWorked ?? 0)),
      R.h('dt', null, 'Gifts'), R.h('dd', null, `${s.giftsGiven ?? 0} given · ${s.giftsReceived ?? 0} received`),
      R.h('dt', null, 'Shows / stories'), R.h('dd', null, `${s.showsPerformed ?? 0} / ${s.storiesPublished ?? 0}`),
      R.h('dt', null, 'Votes cast'), R.h('dd', null, String(s.votesCast ?? 0)),
      c.promisesKept !== null && c.promisesKept !== undefined
        ? R.h('dt', null, 'Promises kept') : null,
      c.promisesKept !== null && c.promisesKept !== undefined
        ? R.h('dd', null, `${R.pct(c.promisesKept)} of ${(c.promises || []).length}`) : null);
  }

  // ------------------------------------------------------------ the page

  let drawer = null;
  let body = null;
  let backdrop = null;
  let currentId = null;
  let lastPayload = null;

  function render(c) {
    const h3 = (text) => R.h('h3', null, text);
    R.replace(body,
      header(c),
      statsRow(c),
      h3('The story'), R.story(c.story, { empty: 'No story yet.' }),
      // What they want and what they need, beside what they can do and what
      // the city has watched them do.
      R.h('div', { class: 'profile-grid' },
        R.h('div', null, h3('Ambitions'), goals(c.goals), h3('Needs'), needs(c.needs || {})),
        R.h('div', null,
          h3('Skills'), radar(c.skills || {}, SKILLS, { label: 'skills' }),
          h3('Character'), character(c.character))),
      h3('Standing'), standing(c),
      h3('Family'), family(c),
      h3('Ties'), ties(c),
      h3('Work, home and things'), work(c),
      h3('Belonging'), belongs(c),
      h3('Works'), works(c.works),
      h3('Record'), record(c),
      h3('Words'), said(c),
      h3('A life'), lifeline(c.timeline && c.timeline.length ? c.timeline : c.milestones),
      h3('Lifetime'), lifetime(c));
  }

  R.drawer = {
    init() {
      injectStyles();
      drawer = document.getElementById('drawer');
      body = document.getElementById('drawer-body');
      backdrop = document.getElementById('drawer-backdrop');
      document.getElementById('drawer-close').addEventListener('click', () => R.drawer.close());
      backdrop.addEventListener('click', () => R.drawer.close());
    },
    isOpen() { return currentId !== null; },
    async open(id) {
      if (!drawer || !id) return;
      const fresh = currentId !== id;
      currentId = id;
      if (fresh) lastPayload = null;
      drawer.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
      backdrop.classList.add('open');
      if (R.map) R.map.select(id);
      if (fresh) R.replace(body, R.h('div', { class: 'loading' }, 'Reading the register…'));
      await R.drawer.reload();
      if (fresh) drawer.scrollTop = 0;
    },
    /** Re-read the profile; the page is redrawn only when something changed. */
    async reload() {
      if (currentId === null) return;
      const id = currentId;
      try {
        const c = await R.api(`/api/profile/${encodeURIComponent(id)}`);
        if (currentId !== id) return;
        const payload = JSON.stringify(c);
        if (payload === lastPayload) return;
        lastPayload = payload;
        const top = drawer ? drawer.scrollTop : 0;
        render(c);
        if (drawer) drawer.scrollTop = top;
      } catch (e) {
        if (currentId === id) {
          lastPayload = null;
          R.replace(body, R.h('div', { class: 'error-box' }, `Could not read ${id}: ${e.message}`));
        }
      }
    },
    close() {
      currentId = null;
      lastPayload = null;
      if (!drawer) return;
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
      backdrop.classList.remove('open');
      if (R.map) R.map.select(null);
    },
  };

  /** The name every other panel opens a citizen with (panels.js, the map, the ticker). */
  R.openProfile = function openProfile(citizenId) {
    if (!citizenId) return;
    R.drawer.open(citizenId);
  };
})();
