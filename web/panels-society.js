/*
 * Reverie dashboard — Society and Culture (docs/UI.md panels 7 and 8).
 *
 * Society is the city off the clock: the households and the family names they
 * carry, the clubs and the district sides, the day's happenings, the Community
 * Chest and who has given to it, the Commons feed, the rumours still in the
 * air, and everything a citizen can buy at the Emporium and in the shops.
 *
 * Culture is what the city makes of its evenings: the works and how popular
 * they are, the Museum's collection, the league table with its fixtures and
 * results, the two papers' front pages side by side, the schools of thought
 * and their share, and the cafés' menus.
 *
 * Both panels are windows, never levers. Every call is a GET; a click opens a
 * face or sorts a column and can never touch the city (docs/PRINCIPLES.md §1).
 * Nothing here shows a citizen's own notes or the letters it sends home (§5).
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

  /** A person as every panel draws one. */
  function who(card, opts) {
    if (!card || !card.id) return R.h('span', { class: 'dim' }, '—');
    return R.person(card, opts);
  }

  /**
   * A row of faces — a family, a squad, a club, a school. The whole point of
   * the portrait renderer: a group you can recognise at a glance.
   */
  function faces(cards, size, max) {
    const list = (cards || []).filter(Boolean);
    if (!list.length) return R.h('div', { class: 'dim small', style: 'margin-top:8px' }, 'nobody');
    const shown = list.slice(0, max || 20);
    const wrap = R.h('div', { class: 'chips', style: 'gap:4px;align-items:center;margin-top:8px' },
      shown.map((c) => {
        const portrait = face(c.id, size || 28, {
          title: `${R.fullName(c)}${c.office ? ` · ${R.titleCase(c.office)}` : ''}${c.present === false ? ' · away' : ''}`,
          ring: c.office ? 'office' : c.standing === 'exiled' ? 'exiled' : null,
        });
        if (c.present === false) portrait.style.opacity = '0.5';
        return portrait;
      }));
    if (list.length > shown.length) wrap.appendChild(R.h('span', { class: 'muted small' }, `+${list.length - shown.length}`));
    return wrap;
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

  const hourText = (h) => `${R.pad2(h)}:00`;
  const dayText = (d) => (d === null || d === undefined ? '—' : `d${d}`);
  const PLURALS = {
    family: 'families', match: 'matches', piece: 'pieces', dish: 'dishes', child: 'children',
    'café': 'cafés', person: 'people',
  };
  const plural = (n, word) => `${R.fmt(n)} ${Math.round(n) === 1 ? word : PLURALS[word] || `${word}s`}`;

  /** "Ashgrove", "Ashgrove & Vale", "Ashgrove, Vale & Thorne". */
  function joinNames(names) {
    const list = (names || []).filter(Boolean);
    if (list.length <= 1) return list[0] || '';
    return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`;
  }

  /** A scrolling box for a long list, in the same frame a table gets. */
  function scrollBox(height, ...children) {
    return fenced(R.h('div', { class: 'table-wrap', style: `max-height:${height}px` },
      R.h('div', { style: 'padding:0 12px' }, children)));
  }

  /**
   * Rebuild a region only when what it shows has changed. A face is a real
   * image and a family is twenty of them; the panel refreshes every couple of
   * seconds and almost nothing on it moves that fast (docs/UI.md, performance).
   */
  function region(sigs, key, sig, host, build) {
    if (!host || sigs[key] === sig) return;
    sigs[key] = sig;
    R.replace(host, build());
  }

  const ids = (list) => (list || []).map((x) => x && x.id).join(',');

  /**
   * A table wide enough to need its own scrollbar must not drag the page
   * sideways with it. A scroll container is only allowed to shrink below its
   * contents when it is a grid or flex item, so every table goes inside a
   * one-cell grid that may itself shrink to nothing (docs/UI.md: nothing
   * horizontal-scrolls except tables inside their own containers).
   */
  function fenced(node) {
    return R.h('div', { style: 'display:grid;min-width:0;max-width:100%' }, node);
  }

  /**
   * One sortable table, remembering its sort. `maxHeight` keeps a long table
   * inside its own scroller so the sections under it stay reachable; the
   * header row is sticky, so it comes along.
   */
  function sortedTable(state, key, spec) {
    const sort = state[key] || (state[key] = spec.sort || null);
    const rows = R.sortRows(spec.rows, spec.columns, sort);
    const node = R.table(Object.assign({}, spec, {
      rows, sort,
      onSort: (k, dir) => { state[key] = { key: k, dir }; spec.rerender(); },
    }));
    if (spec.maxHeight && node.classList.contains('table-wrap')) node.style.maxHeight = `${spec.maxHeight}px`;
    return fenced(node);
  }

  /** A stat card whose value is words, not a number, and may take two lines. */
  function wordCard(opts) {
    const el = R.card(opts);
    const value = el.querySelector('.value');
    if (value) { value.style.whiteSpace = 'normal'; value.style.lineHeight = '1.2'; }
    return el;
  }

  // ======================================================== 7. THE SOCIETY

  const HAPPENING_CLASS = {
    wedding: 'gold', birth: 'good', birthday: 'accent', festival: 'gold', swearing_in: 'neutral',
    club_meeting: 'accent', match: 'accent', block_party: 'gold', memorial: 'neutral', parade: 'gold',
  };
  const RELATION_LABEL = {
    head: 'head', spouse: 'spouse', partner: 'partner', parent: 'parent', child: 'child',
    sibling: 'sibling', housemate: 'housemate',
  };
  const RELATION_TITLE = { head: 'head of the household', housemate: 'shares the address, no kin' };

  // ------------------------------------------------------------- calendar

  function calendarStrip(cal) {
    if (!cal) return null;
    const next = cal.nextFestival || {};
    const bits = [
      R.h('span', { class: 'day-name' }, cal.weekdayName || '—'),
      cal.restDay ? R.pill('Stillday · workplaces closed', 'accent') : null,
      cal.festivalToday ? R.pill(`${cal.festivalToday.name} tonight at ${hourText(cal.festivalToday.hour)}`, 'gold') : null,
      R.h('span', { class: 'muted' }, next.name
        ? (next.inDays === 0 ? `${next.name} is today` : `${next.name} in ${plural(next.inDays, 'day')}`) : ''),
    ];
    const birthdays = cal.birthdaysToday || [];
    if (birthdays.length) {
      bits.push(R.h('span', { class: 'muted' }, '· birthdays:'));
      bits.push(R.h('span', { class: 'chips', style: 'gap:6px;align-items:center' },
        birthdays.map((b) => R.h('span', { class: 'chip person', style: 'display:inline-flex;align-items:center;gap:5px' },
          face(b.id, 20), R.nameLink(b.id, `${b.name} ${b.familyName}`),
          R.h('span', { class: 'dim' }, `${b.age}`)))));
    }
    return R.h('div', { class: 'calendar-strip' }, bits);
  }

  function happeningRow(h) {
    const guests = (h.attendees || []).length;
    return R.h('div', { class: `happening${h.done ? ' done' : ''} ${R.districtClass(h.district)}` },
      R.h('span', { class: 'when' }, hourText(h.hour)),
      R.pill(R.titleCase(h.kind), HAPPENING_CLASS[h.kind] || 'neutral'),
      R.h('span', { class: 'what' }, h.label,
        h.who && h.who.length
          ? R.h('span', { class: 'chips', style: 'gap:4px;align-items:center;display:inline-flex;margin-left:8px;vertical-align:middle' },
            h.who.slice(0, 8).map((p) => face(p.id, 20, { title: R.fullName(p) })))
          : null),
      R.h('span', { class: 'where muted small' },
        [h.buildingName, h.districtName || R.districtName(h.district)].filter(Boolean).join(' · '),
        guests ? ` · ${plural(guests, 'guest')}` : '',
        h.done ? ' · held' : ''));
  }

  function happeningList(list, empty) {
    if (!list || !list.length) return R.h('div', { class: 'empty' }, empty);
    return R.h('div', { class: 'happenings', style: 'max-height:440px;overflow:auto' }, list.map(happeningRow));
  }

  // ----------------------------------------------------------- households

  function householdCard(home) {
    const members = home.members || [];
    const rows = members.map((m) => R.h('div', { class: 'member', style: 'align-items:center' },
      R.h('span', { class: 'who', style: 'min-width:0;overflow-wrap:normal' },
        face(m.id, 26, { title: R.fullName(m) }),
        R.h('span', { class: 'trunc', title: R.fullName(m) }, R.nameLink(m.id, R.fullName(m))),
        R.stagePill(m.lifeStage),
        m.office ? R.tag('office', R.titleCase(m.office)) : null),
      R.h('span', {
        class: 'rel muted small', title: RELATION_TITLE[m.relation] || RELATION_LABEL[m.relation] || m.relation,
      }, RELATION_LABEL[m.relation] || m.relation),
      R.h('span', { class: 'num small' },
        m.lifeStage === 'child' ? `${m.age}d old` : m.rentShare ? `${R.lumens(m.rentShare)}/day` : '—')));
    const kids = members.filter((m) => m.lifeStage === 'child').length;
    const adults = members.length - kids;
    return R.h('div', { class: 'household' },
      R.h('div', { class: 'head' },
        R.h('b', null, joinNames(home.familyNames) || 'Household'),
        R.h('span', { class: 'spacer' }),
        R.pill(home.tierName, home.tier >= 3 ? 'gold' : home.tier >= 2 ? 'good' : 'neutral')),
      R.h('div', { class: 'sub muted small' },
        `${plural(adults, 'adult')}${kids ? ` and ${plural(kids, 'child')}` : ''} · sleeps ${home.capacity}`,
        ` · rent ${R.lumens(home.rent)}/day · since day ${home.createdDay}`,
        home.size > home.capacity ? R.h('span', { class: 'warn-text' }, ' · overcrowded') : null,
        home.arrearsDays ? R.h('span', { class: 'warn-text' }, ` · ${home.arrearsDays}d in arrears`) : null),
      R.h('div', { class: 'members' }, rows));
  }

  // -------------------------------------------------------------- families

  function familyCard(f) {
    const kin = [
      plural(f.adults, 'adult'),
      f.children ? plural(f.children, 'child') : null,
      f.elders ? plural(f.elders, 'elder') : null,
    ].filter(Boolean).join(' · ');
    return R.h('div', { class: 'club' },
      R.h('div', { class: 'head', style: 'align-items:center' },
        R.h('b', null, `The ${f.name} family`),
        R.h('span', { class: 'spacer' }),
        R.pill(`${R.fmt(f.size)} strong`, f.size >= 6 ? 'gold' : 'neutral')),
      R.h('div', { class: 'sub muted small' },
        kin,
        f.married ? ` · ${plural(f.married, 'marriage')}` : '',
        ` · ${plural(f.homes, 'home')}`,
        f.officeHolders ? ` · ${plural(f.officeHolders, 'office holder')}` : ''),
      R.h('div', { class: 'sub' },
        (f.districts || []).slice(0, 4).map((d) => R.h('span', { style: 'margin-right:4px' },
          R.tag('district', d.districtName, {
            id: d.district, label: `${d.districtName} ${d.count}`,
            title: `${plural(d.count, 'person')} of the family in ${d.districtName}`,
          })))),
      f.eldest ? R.h('div', { class: 'muted small' },
        'eldest: ', R.nameLink(f.eldest.id, R.fullName(f.eldest)), ` at ${f.eldestAge}`) : null,
      (f.feudsWith || []).length
        ? R.h('div', { style: 'margin-top:6px' },
          R.h('span', { class: 'muted small' }, 'feuding with '),
          f.feudsWith.map((n) => R.h('span', { style: 'margin-right:4px' }, R.tag('gang', n))))
        : null,
      faces(f.members, 28, 16));
  }

  // ---------------------------------------------------------------- clubs

  function clubCard(k) {
    const venue = k.venue || {};
    return R.h('div', { class: 'club' },
      R.h('div', { class: 'head', style: 'align-items:center' },
        R.h('b', null, k.name),
        R.h('span', { class: 'spacer' }),
        R.tag('club', k.hobbyName),
        k.meetsToday ? R.pill('meets today', 'gold') : null),
      R.h('div', { class: 'sub muted small' },
        'convened by ', R.nameLink(k.convenorId, k.convenorName || '—'),
        ` · founded day ${k.foundedDay} · ${plural(k.size, 'member')}`),
      R.h('div', { class: 'sub muted small' },
        `${k.meetsOnName ? `${k.meetsOnName}s` : 'weekly'} at ${hourText(k.meetsAtHour)}`,
        venue.name ? ' · ' : '', venue.name || '',
        venue.district ? R.h('span', { style: 'margin-left:6px' }, R.tag('district', venue.districtName || venue.district, { id: venue.district })) : null,
        k.meetsToday ? '' : ` · next on day ${k.nextMeetingDay}`),
      faces(k.members, 28, 18));
  }

  // ---------------------------------------------------------------- sides

  function teamCard(t) {
    const record = `${t.wins}W · ${t.draws}D · ${t.losses}L`;
    return R.h('div', { class: 'club' },
      R.h('div', { class: 'head', style: 'align-items:center' },
        R.h('b', null, t.name),
        R.h('span', { class: 'spacer' }),
        R.tag('district', t.districtName || t.district, { id: t.district })),
      R.h('div', { class: 'sub muted small mono' }, record, ` · ${plural(t.size, 'player')}`),
      faces(t.players, 28, 16));
  }

  // ---------------------------------------------------------------- chest

  function chestMovements(list, empty, sign) {
    if (!list || !list.length) return R.h('div', { class: 'empty' }, empty);
    return R.h('ul', { class: 'list' }, list.map((l) => {
      const id = sign === '+' ? l.from : l.to;
      const name = (sign === '+' ? l.fromName : l.toName) || '—';
      const memo = l.memo && !l.memo.toLowerCase().includes(String(name).toLowerCase()) ? l.memo : '';
      return R.h('li', { style: 'align-items:center' },
        R.h('span', { class: 'when' }, dayText(l.day)),
        /^c_/.test(String(id)) ? face(id, 24, { title: name }) : null,
        // The memo can run long; it ellipses rather than shoving the sum off
        // the edge of the column.
        R.h('span', { class: 'trunc', style: 'flex:1;min-width:0', title: memo ? `${name} · ${memo}` : name },
          /^c_/.test(String(id)) ? R.nameLink(id, name) : name,
          memo ? R.h('span', { class: 'muted small' }, ` · ${memo}`) : null),
        R.h('span', { class: `num ${sign === '+' ? 'pos' : 'neg'}`, style: 'flex:none' },
          `${sign}${R.lumens(l.amount)}`));
    }));
  }

  function chestRoll(list, empty) {
    if (!list || !list.length) return R.h('div', { class: 'empty' }, empty);
    const top = Math.max.apply(null, list.map((r) => r.amount).concat([1]));
    return R.h('ul', { class: 'list' }, list.map((r) => R.h('li', { style: 'align-items:center' },
      r.who ? face(r.who.id, 26, { title: r.name }) : null,
      R.h('span', { class: 'trunc', style: 'flex:1;min-width:80px', title: r.name },
        r.who ? R.nameLink(r.who.id, r.name) : r.name),
      R.bar(r.amount, top, 'gold'),
      R.h('span', { class: 'num', style: 'flex:none;min-width:70px' }, R.lumens(r.amount)))));
  }

  // ----------------------------------------------------- the Commons feed

  const REACTION_GLYPH = { cheer: '▲', frown: '▼', laugh: '≈' };

  function postCard(p) {
    const r = p.reactions || {};
    return R.h('div', { style: 'display:grid;grid-template-columns:40px 1fr;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)' },
      face(p.author && p.author.id, 36, { title: p.author ? R.fullName(p.author) : '' }),
      R.h('div', { style: 'min-width:0' },
        R.h('div', { class: 'person-name', style: 'gap:8px' },
          p.author ? R.nameLink(p.author.id, R.fullName(p.author)) : R.h('span', { class: 'dim' }, 'someone'),
          p.author && p.author.office ? R.tag('office', R.titleCase(p.author.office)) : null,
          p.author && p.author.standing && p.author.standing !== 'good' ? R.standingPill(p.author.standing) : null,
          R.h('span', { class: 'dim small mono' }, dayText(p.day))),
        R.h('div', { class: 'prose', style: 'margin:4px 0 6px' }, p.text),
        R.h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:8px' },
          ['cheer', 'frown', 'laugh'].filter((k) => r[k]).map((k) =>
            R.h('span', { class: 'chip', title: R.titleCase(k) }, `${REACTION_GLYPH[k]} ${r[k]}`)),
          (p.reactors || []).length
            ? R.h('span', { class: 'chips', style: 'gap:3px' },
              p.reactors.slice(0, 6).map((x) => face(x.id, 20, { title: `${R.fullName(x)} · ${x.reaction}` })))
            : R.h('span', { class: 'dim small' }, 'no reactions'))));
  }

  // ------------------------------------------------------------- rumours

  function rumourRow(rm) {
    const pop = Math.max(R.state.population || 0, rm.heard || 1);
    return R.h('div', { style: 'display:grid;grid-template-columns:40px 1fr;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)' },
      face(rm.about && rm.about.id, 36, { title: rm.about ? R.fullName(rm.about) : '' }),
      R.h('div', { style: 'min-width:0' },
        R.h('div', { class: 'prose', style: 'margin-bottom:4px' },
          '“', rm.claim, '”',
          rm.disprovedDay !== null && rm.disprovedDay !== undefined
            ? R.h('span', { style: 'margin-left:6px' }, R.pill(`disproved ${dayText(rm.disprovedDay)}`, 'neutral'))
            : R.h('span', { style: 'margin-left:6px', title: 'Observers see everything; the citizens repeating it do not' },
              R.pill(rm.truthful ? 'true' : 'false', rm.truthful ? 'good' : 'danger'))),
        R.h('div', { class: 'muted small', style: 'display:flex;flex-wrap:wrap;align-items:center;gap:6px' },
          'first told by ', rm.source ? R.nameLink(rm.source.id, R.fullName(rm.source)) : '—',
          ` on ${dayText(rm.day)}`,
          rm.lawName ? R.tag('gang', rm.lawName) : null,
          R.h('span', { class: 'mono' }, `${R.fmt(rm.heard)} have heard it`),
          R.bar(rm.heard, pop, rm.truthful ? '' : 'crit')),
        (rm.heardBy || []).length
          ? R.h('span', { class: 'chips', style: 'gap:3px;margin-top:6px' },
            rm.heardBy.slice(0, 6).map((x) => face(x.id, 20, { title: R.fullName(x) })))
          : null));
  }

  // ------------------------------------------------------- shops and wares

  const SHELF_COLUMNS = [
    {
      key: 'name', label: 'Ware', sortable: true, min: 180, truncate: true,
      render: (p) => R.h('span', null, R.h('b', { style: 'font-family:var(--display);font-weight:600' }, p.name),
        R.h('div', { class: 'muted small' }, [R.titleCase(p.category), p.hobbyName].filter(Boolean).join(' · '))),
      title: (p) => p.description || p.name,
    },
    {
      key: 'shopName', label: 'Counter', sortable: true, min: 160,
      render: (p) => R.h('span', null, p.shopName,
        R.h('div', null, R.tag('district', p.districtName || p.district, { id: p.district }))),
    },
    {
      key: 'price', label: 'Price', cls: 'num', sortable: true,
      render: (p) => R.h('span', null, R.lumens(p.price),
        R.h('div', { class: `small ${p.price > p.basePrice ? 'verdict-guilty' : p.price < p.basePrice ? 'verdict-acquitted' : 'dim'}`, style: 'font-weight:400' },
          `${p.price >= p.basePrice ? '+' : ''}${Math.round(((p.price - p.basePrice) / (p.basePrice || 1)) * 100)}% vs base`)),
    },
    { key: 'qty', label: 'Stock', cls: 'num', sortable: true, render: (p) => R.fmt(p.qty) },
  ];

  function shelfRows(data) {
    const out = [];
    const shops = [];
    if (data.emporium) shops.push(data.emporium);
    for (const s of data.shops || []) shops.push(s);
    for (const shop of shops) {
      for (const line of shop.shelf || []) {
        out.push(Object.assign({}, line, {
          shopId: shop.businessId, shopName: shop.name, district: shop.district, districtName: shop.districtName,
        }));
      }
    }
    return out;
  }

  function shelfTable(shelf) {
    const node = R.table({
      columns: [
        { key: 'name', label: 'Ware', min: 150, truncate: true, title: (p) => p.description || p.name },
        { key: 'price', label: 'Price', cls: 'num', render: (p) => R.lumens(p.price) },
        { key: 'qty', label: 'Stock', cls: 'num', render: (p) => R.fmt(p.qty) },
      ],
      rows: shelf || [], dense: true, empty: 'The shelf is bare.',
    });
    if (node.classList.contains('table-wrap')) node.style.maxHeight = '280px';
    return fenced(node);
  }

  function shopBlock(shop) {
    return R.h('div', { class: 'shop' },
      R.h('div', { class: 'head', style: 'align-items:center' },
        R.h('b', null, shop.name),
        R.h('span', { class: 'spacer' }),
        R.tag('district', shop.districtName || R.districtName(shop.district), { id: shop.district })),
      R.h('div', { class: 'sub muted small' },
        shop.ownerId ? R.h('span', null, 'kept by ', R.nameLink(shop.ownerId, shop.ownerName)) : 'a house of the city',
        ` · ${plural(shop.lines, 'line')} · ${plural(shop.stock, 'item')} · ${R.lumens(shop.value)} on the shelf`),
      shelfTable(shop.shelf));
  }

  // ------------------------------------------------------ ceremonies, ties

  function ceremonyList(list, empty) {
    if (!list || !list.length) return R.h('div', { class: 'empty' }, empty);
    return scrollBox(340, R.h('ul', { class: 'list' }, list.map((e) => R.h('li', { style: 'align-items:center' },
      R.h('span', { class: 'when' }, dayText(e.day)),
      (e.who || []).length
        ? R.h('span', { class: 'chips', style: 'gap:3px;flex:none;flex-wrap:nowrap' },
          e.who.slice(0, 4).map((p) => face(p.id, 24, { title: R.fullName(p) })))
        : null,
      R.h('span', { class: 'prose', style: 'margin:0' }, e.text)))));
  }

  function feudRow(f) {
    return R.h('li', { style: 'align-items:center' },
      R.h('span', null, R.h('b', null, joinNames(f.families)),
        R.h('div', { class: 'muted small' },
          `since day ${f.sinceDay} · ${plural(f.incidents, 'incident')} · `
          + `${(f.sizes || []).join(' against ')}`)),
      R.h('span', { class: 'spacer' }),
      R.pill('open', 'danger'));
  }

  function mentorRow(m) {
    return R.h('li', { style: 'align-items:center;gap:8px' },
      who(m.mentor, { size: 28, district: false, sub: R.h('span', { class: 'dim' }, 'mentor') }),
      R.h('span', { class: 'dim' }, '→'),
      who(m.mentee, { size: 28, district: false, sub: R.h('span', { class: 'dim' }, 'learning') }));
  }

  // ------------------------------------------------------------ the panel

  R.registerTab('society', {
    label: 'Society',
    mount(root) {
      const f = (R.ui.filters.society = { ware: '', shop: 'all' });
      R.ui.sort.shelf = { key: 'price', dir: 'asc' };
      const rerender = () => { if (this.data) { this.shelfSig = null; this.update(this.data, root); } };

      root.appendChild(R.h('div', { class: 'cards', id: 'soc-cards' }));

      root.appendChild(R.section('Today in Reverie', 'the city off the clock',
        R.h('div', { id: 'soc-calendar' }),
        R.h('div', { class: 'grid-2' },
          R.h('div', null, R.h('h4', { class: 'sub-title' }, 'Today'), R.h('div', { id: 'soc-today' })),
          R.h('div', null, R.h('h4', { class: 'sub-title' }, 'Tomorrow'), R.h('div', { id: 'soc-tomorrow' })))));

      root.appendChild(R.section('Households', 'everyone who shares an address',
        R.h('div', { id: 'soc-households' })));

      root.appendChild(R.section('Families', 'the names the city carries',
        R.h('div', { id: 'soc-families' })));

      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('Clubs', 'hobbies practised together', R.h('div', { id: 'soc-clubs' })),
        R.section('The district sides', 'who turns out for the league', R.h('div', { id: 'soc-teams' }))));

      root.appendChild(R.section('The Community Chest', 'given freely, paid out in hardship',
        R.h('div', { id: 'soc-chest-head' }),
        R.h('div', { class: 'grid-2' },
          R.h('div', null,
            R.h('h4', { class: 'sub-title' }, 'Who has given'), R.h('div', { id: 'soc-chest-givers' }),
            R.h('h4', { class: 'sub-title' }, 'Who it has helped'), R.h('div', { id: 'soc-chest-helped' })),
          R.h('div', null,
            R.h('h4', { class: 'sub-title' }, 'Donations in'), R.h('div', { id: 'soc-chest-in' }),
            R.h('h4', { class: 'sub-title' }, 'Stipends paid'), R.h('div', { id: 'soc-chest-out' })))));

      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('The Commons', 'what the city says out loud', R.h('div', { id: 'soc-feed' })),
        R.section('Rumours in circulation', 'unproved, repeated anyway', R.h('div', { id: 'soc-rumours' }))));

      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('Weddings and births', null,
          R.h('h4', { class: 'sub-title' }, 'Weddings'), R.h('div', { id: 'soc-weddings' }),
          R.h('h4', { class: 'sub-title' }, 'Births'), R.h('div', { id: 'soc-births' })),
        R.section('Feuds and mentors', null,
          R.h('h4', { class: 'sub-title' }, 'Families not speaking'), R.h('div', { id: 'soc-feuds' }),
          R.h('h4', { class: 'sub-title' }, 'Teaching a trade'), R.h('div', { id: 'soc-mentors' }))));

      const search = R.h('input', {
        type: 'search', placeholder: 'Search the shelves…',
        oninput: (e) => { f.ware = e.target.value.trim().toLowerCase(); rerender(); },
      });
      const shopPick = R.h('select', { onchange: (e) => { f.shop = e.target.value; rerender(); } },
        R.h('option', { value: 'all' }, 'Every counter'));
      this.shopPick = shopPick;
      root.appendChild(R.section('The Emporium and the shops', 'what a citizen can buy today',
        R.h('div', { class: 'toolbar' }, search, shopPick, R.h('span', { class: 'spacer' }),
          R.h('span', { class: 'muted small', id: 'soc-shelf-meta' })),
        R.h('div', { id: 'soc-shelf' }),
        R.h('h4', { class: 'sub-title' }, 'Counter by counter'),
        R.h('div', { id: 'soc-shops' })));
    },

    load: () => R.api('/api/society'),

    update(data, root) {
      this.data = data;
      const n = data.counts || {};
      const chest = data.chest || {};
      const happenings = data.happenings || {};
      const families = data.families || [];
      const posts = data.posts || {};
      const sigs = this.sigs || (this.sigs = {});
      R.setTabCount('society', n.households || '');

      const biggest = families[0];
      R.replace(root.querySelector('#soc-cards'),
        R.card('Households', R.fmt(n.households), `${R.fmt(n.housed)} citizens at an address`),
        R.card('Families', R.fmt(n.families), biggest ? `largest: the ${biggest.name}s, ${R.fmt(biggest.size)} strong` : '—'),
        R.card('Couples', R.fmt((n.marriages || 0) + (n.partnerships || 0)),
          `${R.fmt(n.marriages)} married · ${R.fmt(n.partnerships)} partnered`),
        R.card('Clubs', R.fmt(n.clubs), `${R.fmt(n.clubMembers)} members · ${plural(n.teams, 'district side')}`),
        R.card({
          label: 'Community Chest', value: R.lumens(chest.balance), tone: 'gold',
          sub: `${R.lumens(chest.donatedTotal)} given · ${R.lumens(chest.paidTotal)} paid`,
          spark: R.sparkline((chest.series || []).map((s) => s.balance), 150, 26, 'var(--gold)'),
        }),
        R.card('The Commons', R.fmt(posts.count), `${R.fmt(posts.reactions)} reactions · ${R.fmt(posts.today)} today`),
        R.card('Rumours abroad', R.fmt(n.rumours), `${R.fmt(n.rumoursTold)} told in all · ${R.fmt(n.feuds)} feuds`));

      R.replace(root.querySelector('#soc-calendar'), calendarStrip(data.calendar));
      R.replace(root.querySelector('#soc-today'), happeningList(happenings.today, 'Nothing is planned today.'));
      R.replace(root.querySelector('#soc-tomorrow'), happeningList(happenings.tomorrow, 'Tomorrow is not written yet.'));

      const households = data.households || [];
      region(sigs, 'households',
        households.map((h) => `${h.id}/${h.tier}/${h.rent}/${h.arrearsDays}/${(h.members || []).map((m) => m.id + m.relation + m.rentShare + m.office).join('')}`).join('|'),
        root.querySelector('#soc-households'),
        () => (households.length
          ? scrollBox(600, R.h('div', { class: 'card-grid', style: 'padding:12px 0' }, households.map(householdCard)))
          : R.h('div', { class: 'empty' }, 'Nobody shares a home yet.')));

      region(sigs, 'families',
        families.map((f) => `${f.name}/${f.homes}/${f.married}/${f.officeHolders}/${(f.feudsWith || []).join()}/${ids(f.members)}`).join('|'),
        root.querySelector('#soc-families'),
        () => (families.length
          ? scrollBox(600, R.h('div', { class: 'card-grid', style: 'padding:12px 0' }, families.map(familyCard)))
          : R.h('div', { class: 'empty' }, 'No family name has taken root.')));

      const clubs = data.clubs || [];
      region(sigs, 'clubs',
        clubs.map((k) => `${k.id}/${k.nextMeetingDay}/${k.meetsToday}/${k.convenorId}/${ids(k.members)}`).join('|'),
        root.querySelector('#soc-clubs'),
        () => scrollBox(560, clubs.length
          ? clubs.map((k) => R.h('div', { style: 'margin:12px 0' }, clubCard(k)))
          : R.h('div', { class: 'empty' }, 'No club has been founded.')));

      const teams = data.teams || [];
      region(sigs, 'teams',
        teams.map((t) => `${t.district}/${t.wins}-${t.draws}-${t.losses}/${ids(t.players)}`).join('|'),
        root.querySelector('#soc-teams'),
        () => scrollBox(560, teams.length
          ? teams.map((t) => R.h('div', { style: 'margin:12px 0' }, teamCard(t)))
          : R.h('div', { class: 'empty' }, 'No district has raised a side.')));

      R.replace(root.querySelector('#soc-chest-head'),
        R.h('div', { class: 'calendar-strip' },
          R.h('span', { class: 'chest-total' }, R.h('b', null, R.lumens(chest.balance))),
          R.h('span', { class: 'muted' }, 'in the Chest'),
          R.h('span', { class: 'muted' }, `· ${plural(chest.givers || 0, 'giver')} · ${plural(chest.helped || 0, 'citizen')} helped`),
          R.h('span', { class: 'spacer' }),
          R.sparkline((chest.series || []).map((s) => s.balance), 220, 28, 'var(--gold)')));
      R.replace(root.querySelector('#soc-chest-givers'), chestRoll(chest.roll, 'Nobody has given yet.'));
      R.replace(root.querySelector('#soc-chest-helped'), chestRoll(chest.helpedRoll, 'No stipend has been paid.'));
      R.replace(root.querySelector('#soc-chest-in'), chestMovements(chest.donations, 'Nobody has given yet.', '+'));
      R.replace(root.querySelector('#soc-chest-out'), chestMovements(chest.stipends, 'No stipend has been paid.', '−'));

      const feed = data.feed || [];
      region(sigs, 'feed', feed.map((p) => `${p.id}/${p.reactionCount}`).join('|'),
        root.querySelector('#soc-feed'),
        () => (feed.length ? scrollBox(620, feed.map(postCard)) : R.h('div', { class: 'empty' }, 'Nobody has posted.')));

      const rumours = data.rumours || [];
      region(sigs, 'rumours', rumours.map((r) => `${r.id}/${r.heard}/${r.disprovedDay}`).join('|'),
        root.querySelector('#soc-rumours'),
        () => (rumours.length ? scrollBox(620, rumours.map(rumourRow))
          : R.h('div', { class: 'empty' }, 'Nothing is going round.')));

      R.replace(root.querySelector('#soc-weddings'), ceremonyList(data.recentWeddings, 'No wedding has been held.'));
      R.replace(root.querySelector('#soc-births'), ceremonyList(data.recentBirths, 'No child has been born in Reverie.'));

      const feuds = data.feuds || [];
      R.replace(root.querySelector('#soc-feuds'),
        feuds.length ? R.h('ul', { class: 'list' }, feuds.map(feudRow)) : R.h('div', { class: 'empty' }, 'The families are at peace.'));
      const mentors = data.mentorships || [];
      R.replace(root.querySelector('#soc-mentors'),
        mentors.length ? scrollBox(300, R.h('ul', { class: 'list' }, mentors.map(mentorRow)))
          : R.h('div', { class: 'empty' }, 'Nobody is teaching anybody.'));

      // ---- the shelves
      const f = R.ui.filters.society;
      const shops = (data.emporium ? [data.emporium] : []).concat(data.shops || []);
      const wanted = new Set(shops.map((s) => s.businessId));
      if (this.shopSig !== [...wanted].join(',')) {
        this.shopSig = [...wanted].join(',');
        R.replace(this.shopPick, R.h('option', { value: 'all' }, 'Every counter'),
          shops.map((s) => R.h('option', { value: s.businessId }, s.name)));
        this.shopPick.value = wanted.has(f.shop) ? f.shop : 'all';
        if (this.shopPick.value === 'all') f.shop = 'all';
      }
      let rows = shelfRows(data);
      if (f.shop !== 'all') rows = rows.filter((r) => r.shopId === f.shop);
      if (f.ware) {
        rows = rows.filter((r) => `${r.name} ${r.category} ${r.hobbyName || ''} ${r.shopName} ${r.description || ''}`
          .toLowerCase().indexOf(f.ware) >= 0);
      }
      root.querySelector('#soc-shelf-meta').textContent =
        `${plural(rows.length, 'line')} · ${R.fmt(rows.reduce((s, r) => s + r.qty, 0))} in stock`;
      const sig = JSON.stringify([R.ui.sort.shelf, rows.map((r) => [r.shopId, r.product, r.price, r.qty])]);
      if (sig !== this.shelfSig) {
        this.shelfSig = sig;
        replaceTable(root.querySelector('#soc-shelf'), sortedTable(R.ui.sort, 'shelf', {
          columns: SHELF_COLUMNS, rows, minWidth: 720, maxHeight: 520, empty: 'Nothing is for sale in the city.',
          rowClass: (r) => R.districtClass(r.district),
          rerender: () => { this.shelfSig = null; this.update(this.data, root); },
        }));
      }
      region(sigs, 'shops', shops.map((x) => `${x.businessId}/${x.lines}/${x.stock}/${x.value}`).join('|'),
        root.querySelector('#soc-shops'),
        () => (shops.length
          ? scrollBox(620, R.h('div', { class: 'card-grid wide', style: 'padding:12px 0' }, shops.map(shopBlock)))
          : R.h('div', { class: 'empty' }, 'No counter is trading.')));
    },
  });

  // ======================================================== 8. THE CULTURE

  const WORK_TONE = { painting: 'accent', play: 'gold', song: 'accent', book: 'neutral', paper: 'neutral', expose: 'danger' };
  const MAX_POPULARITY = 200;

  function reviewPills(w) {
    if (!w.reviews || !w.reviews.length) return R.h('span', { class: 'dim small' }, 'unreviewed');
    return R.h('span', { class: 'chips' }, w.reviews.map((r) =>
      R.h('span', { class: 'chip', title: `${r.paperName} · day ${r.day}` },
        `${r.paper === 'ledger' ? 'Ledger' : 'Chronicle'} ${r.score}`)));
  }

  /** One work as a card: the maker's face, the title, and how far it has gone. */
  function workCard(w) {
    return R.h('div', { class: 'club' },
      R.h('div', { class: 'head', style: 'align-items:center' },
        R.h('b', { style: 'font-size:var(--t-16)' }, w.title),
        R.h('span', { class: 'spacer' }),
        R.tag('work', w.kindName || w.kind),
        w.inMuseum ? R.pill('in the Museum', 'gold') : null),
      R.h('div', { style: 'display:flex;align-items:center;gap:8px;margin:6px 0' },
        face(w.creatorId, 32, { title: w.creatorCard ? R.fullName(w.creatorCard) : w.creator }),
        R.h('span', null, 'by ', R.nameLink(w.creatorId, w.creatorCard ? R.fullName(w.creatorCard) : w.creator || '—')),
        R.h('span', { class: 'dim small' }, `· made day ${w.createdDay}`)),
      R.h('div', { class: 'bar-row', style: 'grid-template-columns:76px 1fr 48px' },
        R.h('span', { class: 'muted' }, 'popularity'), R.bar(w.popularity, MAX_POPULARITY, 'gold'),
        R.h('span', { class: 'num' }, R.fmt(w.popularity))),
      R.h('div', { class: 'bar-row', style: 'grid-template-columns:76px 1fr 48px' },
        R.h('span', { class: 'muted' }, 'quality'), R.bar(w.quality, 100),
        R.h('span', { class: 'num' }, R.fmt(w.quality))),
      R.h('div', { class: 'muted small', style: 'margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap' },
        w.homeName || '—',
        w.district ? R.tag('district', w.districtName || w.district, { id: w.district }) : null,
        reviewPills(w)));
  }

  /**
   * A held work, one line: everything in the Museum is in the Museum, so the
   * pill and the venue that a card carries would say nothing here.
   */
  function museumRow(w) {
    return R.h('li', { style: 'align-items:center;gap:12px' },
      face(w.creatorId, 32, { title: w.creatorCard ? R.fullName(w.creatorCard) : w.creator }),
      R.h('span', { style: 'flex:1;min-width:0' },
        R.h('b', { style: 'font-family:var(--display);font-size:var(--t-14)' }, w.title),
        R.h('div', { class: 'muted small' },
          `${w.kindName} · `, R.nameLink(w.creatorId, w.creatorCard ? R.fullName(w.creatorCard) : w.creator || '—'),
          ` · made day ${w.createdDay}`)),
      R.h('span', { class: 'small', title: 'quality' }, R.miniBar(w.quality, 100)),
      R.h('span', { class: 'small', title: 'popularity' }, R.miniBar(w.popularity, MAX_POPULARITY, 'gold')),
      reviewPills(w));
  }

  // The kind rides in the work's own cell rather than a column of its own:
  // seven columns will not fit the panel without scrolling, and the filter
  // above the table already sorts the city's output by kind.
  const WORK_COLUMNS = [
    {
      key: 'title', label: 'Work', sortable: true, min: 200, truncate: true,
      render: (w) => R.h('span', null,
        R.h('b', { style: 'font-family:var(--display);font-weight:600' }, w.title),
        ' ', R.pill(w.kindName || w.kind, WORK_TONE[w.kind] || 'neutral'),
        R.h('div', { class: 'muted small' },
          [w.homeName, w.inMuseum && w.home !== 'museum' ? 'in the Museum' : null].filter(Boolean).join(' · '))),
      title: (w) => `${w.title} — a ${w.kindName} at ${w.homeName || 'no venue'}`,
    },
    {
      key: 'creator', label: 'Maker', sortable: true, min: 150,
      render: (w) => who(w.creatorCard, { size: 26, district: false, sub: null }),
      sortValue: (w) => w.creator || '',
    },
    { key: 'createdDay', label: 'Made', cls: 'right mono small', min: 50, sortable: true, render: (w) => dayText(w.createdDay) },
    {
      key: 'quality', label: 'Quality', cls: 'right mono', min: 90, sortable: true,
      render: (w) => R.miniBar(w.quality, 100),
    },
    {
      key: 'popularity', label: 'Popularity', cls: 'right mono', min: 110, sortable: true,
      render: (w) => R.miniBar(w.popularity, MAX_POPULARITY, 'gold'),
    },
    { key: 'reviewScore', label: 'Reviews', sortable: true, min: 100, render: reviewPills },
  ];

  // ------------------------------------------------------------- the league

  // `right mono` rather than `num`, so the nine one-letter columns keep to
  // their own width instead of the eighty pixels a number column reserves.
  const TALLY = 'right mono small';
  const LEAGUE_COLUMNS = [
    { key: 'rank', label: '#', cls: TALLY, min: 34, render: (t) => R.fmt(t.rank) },
    {
      key: 'name', label: 'Side', min: 170,
      render: (t) => R.h('span', null, t.name, R.h('div', null, R.tag('district', R.districtName(t.district), { id: t.district }))),
    },
    { key: 'played', label: 'P', cls: TALLY, min: 38, sortable: true, title: () => 'played' },
    { key: 'wins', label: 'W', cls: TALLY, min: 38, sortable: true },
    { key: 'draws', label: 'D', cls: TALLY, min: 38, sortable: true },
    { key: 'losses', label: 'L', cls: TALLY, min: 38, sortable: true },
    { key: 'goalsFor', label: 'GF', cls: TALLY, min: 42 },
    { key: 'goalsAgainst', label: 'GA', cls: TALLY, min: 42 },
    { key: 'goalDiff', label: 'GD', cls: TALLY, min: 42, render: (t) => R.signed(t.goalDiff) },
    { key: 'points', label: 'Pts', cls: 'num', min: 56, sortable: true, render: (t) => R.h('b', { class: 'mono' }, R.fmt(t.points)) },
    { key: 'size', label: 'Squad', cls: TALLY, min: 56 },
  ];

  function matchRow(m) {
    const tone = m.result === 'draw' ? '' : m.result === 'home' ? 'home' : 'away';
    return R.h('li', { style: 'align-items:center' },
      R.h('span', { class: 'when' }, dayText(m.day)),
      R.h('span', { class: 'trunc', title: m.homeName, style: `min-width:0;flex:1;${tone === 'home' ? 'font-weight:600' : ''}` }, m.homeName),
      R.h('span', { class: 'mono', style: 'min-width:64px;text-align:center' },
        R.h('b', null, `${m.homeGoals}–${m.awayGoals}`)),
      R.h('span', { class: 'trunc', title: m.awayName, style: `min-width:0;flex:1;text-align:right;${tone === 'away' ? 'font-weight:600' : ''}` }, m.awayName),
      R.h('span', { class: 'dim small mono', style: 'min-width:70px;text-align:right' }, `${R.fmt(m.attendance)} in`));
  }

  function fixtureRow(x) {
    return R.h('li', { style: 'align-items:center' },
      R.h('span', { class: 'when' }, `${dayText(x.day)} ${hourText(x.hour)}`),
      R.h('span', { style: 'flex:1' }, `${x.homeName} v ${x.awayName}`),
      x.district ? R.tag('district', x.districtName || x.district, { id: x.district }) : null);
  }

  function championRow(c) {
    return R.h('li', { style: 'align-items:center' },
      R.h('span', { class: 'when' }, dayText(c.day)),
      R.h('span', { style: 'flex:1' }, R.h('b', null, c.name),
        R.h('div', { class: 'muted small' }, `${plural(c.points, 'point')} from ${plural(c.played, 'match')}`)),
      c.prize ? R.h('span', { class: 'num pos' }, R.lumens(c.prize)) : null);
  }

  // -------------------------------------------------------------- the press

  function frontPage(p) {
    const heads = p.headlines || [];
    return R.h('div', { class: 'edition' },
      R.h('div', { class: 'masthead' },
        R.h('b', null, p.name),
        R.h('span', { class: 'byline' }, p.slant),
        R.h('span', { class: 'day' }, p.day === null ? 'no edition yet' : `day ${p.day}`)),
      heads.length
        ? R.h('div', null,
          R.h('h3', { class: 'headline lead', style: 'font-size:var(--t-20)' }, heads[0]),
          R.h('ol', { start: 2 }, heads.slice(1).map((h) => R.h('li', { class: 'deck' }, h))))
        : R.h('div', { class: 'empty' }, 'The presses have not run.'),
      p.treasuryReport ? R.h('div', { class: 'report' }, p.treasuryReport) : null,
      R.h('div', { class: 'rule' }),
      R.h('div', { class: 'bar-row', style: 'grid-template-columns:96px 1fr 64px' },
        R.h('span', { class: 'muted' }, 'readership'), R.bar((p.share || 0) * 100, 100, 'gold'),
        R.h('span', { class: 'num small' }, R.pct(p.share))),
      R.h('div', {
        class: 'bar-row', style: 'grid-template-columns:96px 1fr 64px',
        title: 'How near the Government’s actual line sits to this paper’s',
      },
        R.h('span', { class: 'muted' }, 'reads City Hall'), R.bar((p.reading || 0) * 100, 100),
        R.h('span', { class: 'num small' }, R.pct(p.reading))),
      (p.backIssues || []).length
        ? R.h('div', { style: 'margin-top:8px' },
          R.h('h4', { class: 'sub-title' }, `Back issues · ${plural(p.editions, 'edition')} printed`),
          // The gazette rule that makes an edition's first line a lead would
          // catch the first back issue too; these are a rail, not a story.
          R.h('ul', { class: 'list' }, p.backIssues.map((b) => R.h('li', {
            style: 'font-family:var(--sans);font-weight:400;font-size:var(--t-12)',
          },
            R.h('span', { class: 'when' }, dayText(b.day)),
            R.h('span', { class: 'deck', style: 'margin:0' }, b.headline)))))
        : null);
  }

  // ------------------------------------------------------------- the schools

  function schoolCard(s) {
    return R.h('div', { class: 'club' },
      R.h('div', { class: 'head', style: 'align-items:center' },
        R.h('b', { style: 'font-size:var(--t-16)' }, R.titleCase(s.name.replace(/^the /, ''))),
        R.h('span', { class: 'spacer' }),
        R.platformBars(s.platform)),
      R.h('div', { class: 'prose', style: 'margin:4px 0 8px;font-family:var(--display);font-size:var(--t-14)' }, `“${s.creed}”`),
      R.h('div', { class: 'bar-row', style: 'grid-template-columns:70px 1fr 92px' },
        R.h('span', { class: 'muted' }, 'share'), R.bar((s.share || 0) * 100, 100, 'gold'),
        R.h('span', { class: 'num small' }, `${R.pct(s.share)} · ${R.fmt(s.count)}`)),
      R.h('div', { class: 'chips', style: 'margin-top:6px' },
        (s.hobbies || []).map((h) => R.tag('club', R.titleCase(h)))),
      faces(s.members, 26, 18));
  }

  // ---------------------------------------------------------------- menus

  function cafeRow(c) {
    return R.h('li', { style: 'align-items:center' },
      R.h('span', { style: 'flex:1;min-width:0' },
        R.h('b', null, c.name),
        R.h('div', { class: 'muted small' },
          c.ownerId ? R.h('span', null, 'kept by ', R.nameLink(c.ownerId, c.ownerName)) : 'a house of the city',
          ' · ', c.dishName, ` · set day ${c.setDay}`)),
      R.tag('district', c.districtName || c.district, { id: c.district }),
      R.miniBar(c.quality, 100),
      R.h('span', { class: 'num', style: 'min-width:70px' }, R.lumens(c.price)));
  }

  // ------------------------------------------------------------ the panel

  R.registerTab('culture', {
    label: 'Culture',
    mount(root) {
      const f = (R.ui.filters.culture = { q: '', kind: 'all', museumOnly: false });
      R.ui.sort.works = { key: 'popularity', dir: 'desc' };
      R.ui.sort.league = { key: 'points', dir: 'desc' };
      const rerender = () => { if (this.data) { this.worksSig = null; this.update(this.data, root); } };

      root.appendChild(R.h('div', { class: 'cards', id: 'cul-cards' }));

      root.appendChild(R.section('What the city is talking about', 'the works with the room',
        R.h('div', { class: 'card-grid', id: 'cul-top' })));

      const search = R.h('input', {
        type: 'search', placeholder: 'Search titles and makers…',
        oninput: (e) => { f.q = e.target.value.trim().toLowerCase(); rerender(); },
      });
      const kindPick = R.h('select', { onchange: (e) => { f.kind = e.target.value; rerender(); } },
        R.h('option', { value: 'all' }, 'Every kind'));
      this.kindPick = kindPick;
      const museumOnly = R.h('label', null,
        R.h('input', { type: 'checkbox', onchange: (e) => { f.museumOnly = e.target.checked; rerender(); } }),
        'In the Museum');
      root.appendChild(R.section('Every work', 'made by a citizen, kept by the city',
        R.h('div', { class: 'toolbar' }, search, kindPick, museumOnly,
          R.h('span', { class: 'spacer' }), R.h('span', { class: 'muted small', id: 'cul-works-meta' })),
        R.h('div', { id: 'cul-works' })));

      root.appendChild(R.section('The Museum', 'what the city decided to keep',
        R.h('div', { id: 'cul-museum-head' }),
        R.h('div', { id: 'cul-museum' })));

      root.appendChild(R.section('The league', 'nine districts, one table',
        R.h('div', { id: 'cul-league' }),
        R.h('div', { class: 'grid-2' },
          R.h('div', null, R.h('h4', { class: 'sub-title' }, 'Fixtures'), R.h('div', { id: 'cul-fixtures' }),
            R.h('h4', { class: 'sub-title' }, 'Champions'), R.h('div', { id: 'cul-champions' })),
          R.h('div', null, R.h('h4', { class: 'sub-title' }, 'Results'), R.h('div', { id: 'cul-results' })))));

      root.appendChild(R.section('The front pages', 'two papers, one city',
        R.h('div', { class: 'grid-2', id: 'cul-papers' })));

      root.appendChild(R.section('Schools of thought', 'adopted, never assigned',
        R.h('div', { id: 'cul-schools-head' }),
        R.h('div', { class: 'card-grid', id: 'cul-schools' })));

      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('Café menus', 'what is on tonight', R.h('div', { id: 'cul-cafes' })),
        R.section('The dishes', 'what a kitchen can set', R.h('div', { id: 'cul-dishes' }))));

      root.appendChild(R.section('Monuments', 'raised by the Council', R.h('div', { id: 'cul-monuments' })));
    },

    load: () => R.api('/api/culture'),

    update(data, root) {
      this.data = data;
      const works = data.works || {};
      const museum = data.museum || {};
      const league = data.league || {};
      const schools = data.schools || {};
      const menus = data.menus || {};
      const sigs = this.sigs || (this.sigs = {});
      R.setTabCount('culture', works.count || '');

      const leader = (league.table || []).find((t) => t.played > 0) || null;
      const readership = (data.papers || {}).readership || {};
      const loudest = (works.top || [])[0];
      R.replace(root.querySelector('#cul-cards'),
        R.card('Works made', R.fmt(works.count), `${R.fmt(works.creators)} makers · ${R.fmt(works.reviewed)} reviewed`),
        wordCard({
          label: 'Loudest work', value: loudest ? loudest.title : '—', small: true,
          sub: loudest ? `${loudest.kindName} by ${loudest.creator}` : 'nothing yet',
        }),
        R.card({
          label: 'The Museum', value: `${R.fmt(museum.count)} ${museum.count === 1 ? 'piece' : 'pieces'}`,
          sub: `${R.lumens(museum.value)} · ${museum.curatorOnDuty ? 'a curator is on duty' : 'no curator on duty'}`,
          tone: 'gold',
        }),
        wordCard({
          label: 'League leader', value: leader ? leader.name : '—', small: true,
          sub: leader ? `${plural(leader.points, 'point')} from ${plural(leader.played, 'match')}` : 'no match played yet',
        }),
        R.card({
          label: 'Readership', value: R.pct(readership.chronicle || 0), small: true,
          sub: `the Chronicle · ${R.pct(readership.ledger || 0)} the Harbor Ledger`,
        }),
        R.card('Schools of thought', R.pct(1 - (schools.none || 0)),
          `${plural(schools.unaffiliated || 0, 'citizen')} hold none`));

      region(sigs, 'top', (works.top || []).map((w) => `${w.id}/${w.popularity}/${(w.reviews || []).length}`).join('|'),
        root.querySelector('#cul-top'),
        () => ((works.top || []).length ? works.top.map(workCard)
          : R.h('div', { class: 'empty' }, 'Nobody has made anything yet.')));

      // ---- every work
      const f = R.ui.filters.culture;
      const kinds = works.kinds || [];
      const kindSig = kinds.map((k) => k.kind).join(',');
      if (this.kindSig !== kindSig) {
        this.kindSig = kindSig;
        R.replace(this.kindPick, R.h('option', { value: 'all' }, 'Every kind'),
          kinds.map((k) => R.h('option', { value: k.kind }, `${R.titleCase(k.name)} (${k.count})`)));
        this.kindPick.value = kinds.some((k) => k.kind === f.kind) ? f.kind : 'all';
        if (this.kindPick.value === 'all') f.kind = 'all';
      }
      let rows = works.all || [];
      if (f.kind !== 'all') rows = rows.filter((w) => w.kind === f.kind);
      if (f.museumOnly) rows = rows.filter((w) => w.inMuseum);
      if (f.q) {
        rows = rows.filter((w) => `${w.title} ${w.creator || ''} ${w.homeName || ''} ${w.kindName}`
          .toLowerCase().indexOf(f.q) >= 0);
      }
      root.querySelector('#cul-works-meta').textContent =
        `${plural(rows.length, 'work')} shown · ${plural(works.inMuseum || 0, 'piece')} in the Museum`;
      const sig = JSON.stringify([R.ui.sort.works, rows.map((w) => [w.id, w.popularity, w.quality, w.inMuseum, (w.reviews || []).length])]);
      if (sig !== this.worksSig) {
        this.worksSig = sig;
        replaceTable(root.querySelector('#cul-works'), sortedTable(R.ui.sort, 'works', {
          columns: WORK_COLUMNS, rows, minWidth: 820, maxHeight: 620, empty: 'No work matches.',
          rowClass: (w) => R.districtClass(w.district),
          onRowClick: (w) => openProfile(w.creatorId),
          rerender: () => { this.worksSig = null; this.update(this.data, root); },
        }));
      }

      // ---- the Museum
      R.replace(root.querySelector('#cul-museum-head'),
        R.h('div', { class: 'calendar-strip' },
          R.h('span', { class: 'day-name' }, museum.name || 'The Museum'),
          museum.district ? R.tag('district', museum.districtName || museum.district, { id: museum.district }) : null,
          R.h('span', { class: 'muted' }, `${plural(museum.count || 0, 'piece')} · valued at ${R.lumens(museum.value)}`),
          museum.curatorOnDuty ? R.pill('curator on duty', 'good') : R.pill('unattended', 'neutral')));
      const held = museum.collection || [];
      region(sigs, 'museum', held.map((w) => `${w.id}/${w.popularity}`).join('|'),
        root.querySelector('#cul-museum'),
        () => (held.length ? scrollBox(560, R.h('ul', { class: 'list' }, held.map(museumRow)))
          : R.h('div', { class: 'empty' }, 'The Museum has acquired nothing.')));

      // ---- the league
      const table = R.sortRows(league.table || [], LEAGUE_COLUMNS, R.ui.sort.league);
      replaceTable(root.querySelector('#cul-league'), fenced(R.table({
        columns: LEAGUE_COLUMNS, rows: table, sort: R.ui.sort.league, minWidth: 680,
        onSort: (key, dir) => { R.ui.sort.league = { key, dir }; this.update(this.data, root); },
        rowClass: (t) => R.districtClass(t.district),
        empty: 'No side has played.',
      })));
      const fixtures = league.fixtures || [];
      R.replace(root.querySelector('#cul-fixtures'),
        fixtures.length ? R.h('ul', { class: 'list' }, fixtures.map(fixtureRow))
          : R.h('div', { class: 'empty' }, 'Nothing is scheduled.'));
      const champs = league.champions || [];
      R.replace(root.querySelector('#cul-champions'),
        champs.length ? R.h('ul', { class: 'list' }, champs.map(championRow))
          : R.h('div', { class: 'empty' }, 'No season has been crowned.'));
      const results = league.matches || [];
      region(sigs, 'results', results.map((m) => `${m.day}${m.home}${m.away}${m.homeGoals}-${m.awayGoals}`).join('|'),
        root.querySelector('#cul-results'),
        () => (results.length ? scrollBox(420, R.h('ul', { class: 'list' }, results.map(matchRow)))
          : R.h('div', { class: 'empty' }, 'No match has been played.')));

      // ---- the papers
      const pages = (data.papers || {}).pages || [];
      region(sigs, 'papers', pages.map((p) => `${p.paper}/${p.day}/${p.editions}/${p.share}/${p.reading}`).join('|'),
        root.querySelector('#cul-papers'), () => pages.map(frontPage));

      // ---- the schools
      R.replace(root.querySelector('#cul-schools-head'),
        R.h('div', { class: 'calendar-strip' },
          (schools.schools || []).map((s) => R.h('span', { style: 'display:flex;align-items:center;gap:6px' },
            R.tag('school', R.titleCase(s.name.replace(/^the /, ''))),
            R.h('span', { class: 'num small' }, R.pct(s.share)))),
          R.h('span', { class: 'spacer' }),
          R.h('span', { class: 'muted small' }, `${R.pct(schools.none)} hold no school`)));
      region(sigs, 'schools',
        (schools.schools || []).map((x) => `${x.school}/${x.share}/${ids(x.members)}`).join('|'),
        root.querySelector('#cul-schools'), () => (schools.schools || []).map(schoolCard));

      // ---- the cafés
      const cafes = menus.cafes || [];
      R.replace(root.querySelector('#cul-cafes'),
        cafes.length
          ? R.h('div', null,
            menus.best ? R.h('div', { class: 'muted small', style: 'margin-bottom:8px' },
              'best table tonight: ', R.h('b', null, menus.best.name), ` · ${menus.best.dish}`) : null,
            R.h('ul', { class: 'list' }, cafes.map(cafeRow)))
          : R.h('div', { class: 'empty' }, 'No kitchen has set a menu.'));
      R.replace(root.querySelector('#cul-dishes'), fenced(R.table({
        columns: [
          { key: 'name', label: 'Dish', min: 140 },
          {
            key: 'recipe', label: 'From', min: 130,
            render: (d) => R.h('span', { class: 'chips' },
              Object.entries(d.recipe || {}).map(([g, n]) => R.h('span', { class: 'chip' }, `${n} ${g}`))),
          },
          { key: 'energy', label: 'Energy', cls: 'num', render: (d) => R.signed(d.energy) },
          { key: 'social', label: 'Company', cls: 'num', render: (d) => R.signed(d.social) },
          { key: 'servedBy', label: 'Served by', cls: 'num', render: (d) => (d.servedBy ? plural(d.servedBy, 'café') : R.h('span', { class: 'dim' }, 'nobody')) },
        ],
        rows: menus.dishes || [], dense: true, empty: 'No dish is on any list.',
      })));

      // ---- monuments
      const monuments = data.monuments || [];
      R.replace(root.querySelector('#cul-monuments'),
        monuments.length
          ? R.h('div', { class: 'card-grid' }, monuments.map((m) => R.h('div', { class: 'club' },
            R.h('div', { class: 'head', style: 'align-items:center' },
              R.h('b', null, '★ ', m.honoree ? R.fullName(m.honoree) : 'unnamed'),
              R.h('span', { class: 'spacer' }),
              R.h('span', { class: 'dim small mono' }, dayText(m.day))),
            R.h('div', { style: 'display:flex;gap:12px;align-items:center;margin-top:8px' },
              m.honoree ? face(m.honoree.id, 48) : null,
              R.h('span', { class: 'prose', style: 'margin:0;font-family:var(--display)' }, m.inscription)))))
          : R.h('div', { class: 'empty' }, 'The Plaza carries no monument.'));
    },
  });
})();
