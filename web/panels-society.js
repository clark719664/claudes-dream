/*
 * Reverie dashboard — the Society tab: families grouped by household, the
 * clubs and when they meet, the day's happenings and the next festival, the
 * Community Chest, and everything on sale at the Emporium and in the shops.
 *
 * A window, never a lever: nothing here can change the city.
 */
(function () {
  'use strict';
  const R = window.R;

  const HAPPENING_CLASS = {
    wedding: 'gold', birth: 'good', birthday: 'accent', festival: 'gold', swearing_in: 'neutral', club_meeting: 'accent',
  };
  const RELATION_LABEL = {
    head: 'head of household', spouse: 'spouse', partner: 'partner', parent: 'parent', child: 'child',
    sibling: 'sibling', housemate: 'housemate',
  };

  const hourText = (h) => `${R.pad2(h)}:00`;

  /** "Ashgrove", "Ashgrove & Vale", "Ashgrove, Vale & Thorne". */
  function joinNames(names) {
    const list = (names || []).filter(Boolean);
    if (list.length <= 1) return list[0] || '';
    return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`;
  }

  const stagePill = (stage) => R.stagePill(stage);

  function personLink(p) {
    return R.nameLink(p.id, R.displayName(p));
  }

  function personChips(list, empty) {
    if (!list || !list.length) return R.h('span', { class: 'dim small' }, empty || 'nobody');
    return R.h('div', { class: 'chips' }, list.map((p) => R.h('span', { class: `chip person${p.present === false ? ' gone' : ''}` },
      personLink(p), p.lifeStage === 'child' ? R.h('span', { class: 'dim' }, ' · child') : null)));
  }

  // ------------------------------------------------------------- calendar

  function calendarStrip(cal) {
    if (!cal) return null;
    const next = cal.nextFestival || {};
    const bits = [
      R.h('span', { class: 'day-name' }, cal.weekdayName || '—'),
      cal.restDay ? R.pill('Stillday · workplaces closed', 'accent') : null,
      cal.festivalToday ? R.pill(`${cal.festivalToday.name} tonight at ${hourText(cal.festivalToday.hour)}`, 'gold') : null,
      R.h('span', { class: 'muted' }, next.name ? (next.inDays === 0 ? `${next.name} is today` : `${next.name} in ${next.inDays} day${next.inDays === 1 ? '' : 's'}`) : ''),
    ];
    const birthdays = cal.birthdaysToday || [];
    if (birthdays.length) {
      bits.push(R.h('span', { class: 'muted' }, '· birthdays: '));
      bits.push(R.h('span', null, birthdays.map((b, i) => R.h('span', null, i ? ', ' : '', R.nameLink(b.id, `${b.name} ${b.familyName}`)))));
    }
    return R.h('div', { class: 'calendar-strip' }, bits);
  }

  function happeningRow(h) {
    return R.h('div', { class: `happening${h.done ? ' done' : ''}` },
      R.h('span', { class: 'when' }, hourText(h.hour)),
      R.pill(R.titleCase(h.kind), HAPPENING_CLASS[h.kind] || 'neutral'),
      R.h('span', { class: 'what' }, h.label,
        h.who && h.who.length ? R.h('span', { class: 'who' }, ' — ', h.who.map((p, i) => R.h('span', null, i ? ', ' : '', personLink(p)))) : null),
      R.h('span', { class: 'where muted small' },
        `${h.buildingName || ''}${h.buildingName ? ' · ' : ''}${h.districtName || R.districtName(h.district)}${h.done ? ' · held' : ''}`));
  }

  function happeningList(list, empty) {
    if (!list || !list.length) return R.h('div', { class: 'empty' }, empty);
    return R.h('div', { class: 'happenings' }, list.map(happeningRow));
  }

  // ----------------------------------------------------------- households

  function householdCard(home) {
    const members = home.members || [];
    const rows = members.map((m) => R.h('div', { class: 'member' },
      R.h('span', { class: 'who' }, personLink(m), ' ', stagePill(m.lifeStage)),
      R.h('span', { class: 'rel muted small' }, RELATION_LABEL[m.relation] || m.relation),
      R.h('span', { class: 'num small' }, m.lifeStage === 'child' ? `${m.age}d old` : m.rentShare ? `${R.lumens(m.rentShare)}/day` : '—')));
    const kids = members.filter((m) => m.lifeStage === 'child').length;
    const adults = members.length - kids;
    const who = `${adults} adult${adults === 1 ? '' : 's'}${kids ? ` and ${kids} child${kids === 1 ? '' : 'ren'}` : ''}`;
    return R.h('div', { class: 'household' },
      R.h('div', { class: 'head' },
        R.h('b', null, joinNames(home.familyNames) || 'Household'),
        R.h('span', { class: 'spacer' }),
        R.pill(home.tierName, home.tier >= 2 ? 'good' : 'neutral')),
      R.h('div', { class: 'sub muted small' },
        `${who} · sleeps ${home.capacity} · rent ${R.lumens(home.rent)}/day · since day ${home.createdDay}`,
        home.arrearsDays ? R.h('span', { class: 'warn-text' }, ` · ${home.arrearsDays}d in arrears`) : null),
      R.h('div', { class: 'members' }, rows));
  }

  // ---------------------------------------------------------------- clubs

  function clubCard(k) {
    const when = `${k.meetsOnName ? `${k.meetsOnName}s` : 'weekly'} at ${hourText(k.meetsAtHour)}${k.venue ? ` · ${k.venue.name}` : ''}`;
    return R.h('div', { class: 'club' },
      R.h('div', { class: 'head' },
        R.h('b', null, k.name),
        R.h('span', { class: 'spacer' }),
        R.pill(k.hobbyName, 'accent'),
        k.meetsToday ? R.pill('meets today', 'gold') : null),
      R.h('div', { class: 'sub muted small' },
        'convened by ', R.nameLink(k.convenorId, k.convenorName || '—'),
        ` · founded day ${k.foundedDay} · ${k.size} member${k.size === 1 ? '' : 's'}`),
      R.h('div', { class: 'sub muted small' }, when, k.meetsToday ? '' : ` · next on day ${k.nextMeetingDay}`),
      personChips(k.members, 'nobody left'));
  }

  // ---------------------------------------------------------------- chest

  function chestMovements(list, empty, sign) {
    if (!list || !list.length) return R.h('div', { class: 'empty' }, empty);
    return R.h('ul', { class: 'list' }, list.map((l) => {
      const who = (sign === '+' ? l.fromName : l.toName) || '—';
      const memo = l.memo && !l.memo.toLowerCase().includes(who.toLowerCase()) ? l.memo : '';
      return R.h('li', null,
        R.h('span', { class: 'when' }, `d${l.day}`),
        R.h('span', null, who, memo ? R.h('span', { class: 'muted small' }, ` · ${memo}`) : null),
        R.h('span', { class: 'spacer' }),
        R.h('span', { class: `num ${sign === '+' ? 'pos' : 'neg'}` }, `${sign}${R.lumens(l.amount)}`));
    }));
  }

  // -------------------------------------------------------- shelves, news

  function shelfTable(shelf) {
    return R.table({
      columns: [
        { key: 'name', label: 'Product', render: (p) => R.h('span', null, p.name, R.h('div', { class: 'muted small' }, R.titleCase(p.category) + (p.hobby ? ` · ${R.titleCase(p.hobby)}` : ''))) },
        { key: 'price', label: 'Price', cls: 'num', render: (p) => R.lumens(p.price) },
        { key: 'qty', label: 'Stock', cls: 'num', render: (p) => R.fmt(p.qty) },
      ],
      rows: shelf || [], empty: 'The shelf is bare.',
    });
  }

  function shopBlock(shop) {
    return R.h('div', { class: 'shop' },
      R.h('div', { class: 'head' },
        R.h('b', null, shop.name),
        R.h('span', { class: 'spacer' }),
        R.h('span', { class: 'muted small' }, shop.districtName || R.districtName(shop.district),
          shop.ownerName ? R.h('span', null, ' · ', R.nameLink(shop.ownerId, shop.ownerName)) : null)),
      shelfTable(shop.shelf));
  }

  function ceremonyList(list, empty) {
    if (!list || !list.length) return R.h('div', { class: 'empty' }, empty);
    return R.h('ul', { class: 'list' }, list.map((e) => R.h('li', null,
      R.h('span', { class: 'when' }, `d${e.day}`),
      R.h('span', null, e.text,
        e.who && e.who.length
          ? R.h('span', { class: 'muted small' }, ' — ',
            e.who.map((p, i) => R.h('span', null, i ? ', ' : '', personLink(p))),
            e.others ? ` and ${e.others} more` : null)
          : null))));
  }

  // ------------------------------------------------------------------ tab

  R.registerTab('society', {
    label: 'Society',
    mount(root) {
      root.appendChild(R.h('div', { class: 'cards', id: 'soc-cards' }));
      root.appendChild(R.section('Today in Reverie', null,
        R.h('div', { id: 'soc-calendar' }),
        R.h('h4', { class: 'sub-title' }, 'Today'), R.h('div', { id: 'soc-today' }),
        R.h('h4', { class: 'sub-title' }, 'Tomorrow'), R.h('div', { id: 'soc-tomorrow' })));
      root.appendChild(R.section('Families', 'everyone who shares a home', R.h('div', { class: 'card-grid', id: 'soc-households' })));
      root.appendChild(R.section('Clubs', 'hobbies practised together', R.h('div', { class: 'card-grid', id: 'soc-clubs' })));
      root.appendChild(R.h('div', { class: 'grid-2' },
        R.section('The Community Chest', 'hardship stipends', R.h('div', { id: 'soc-chest' })),
        R.section('Weddings and births', null, R.h('div', { id: 'soc-ceremonies' }))));
      root.appendChild(R.section('The Emporium and the shops', 'what a citizen can buy today', R.h('div', { id: 'soc-shops' })));
    },
    load: () => R.api('/api/society'),
    update(data, root) {
      const n = data.counts || {};
      const chest = data.chest || {};
      const happenings = data.happenings || {};
      R.setTabCount('society', n.households || '');

      R.replace(root.querySelector('#soc-cards'),
        R.card('Households', R.fmt(n.households), `${R.fmt(n.housed)} citizens at home`),
        R.card('Couples', R.fmt((n.marriages || 0) + (n.partnerships || 0)), `${R.fmt(n.marriages)} married · ${R.fmt(n.partnerships)} partnered`),
        R.card('Children', R.fmt(n.children), `${R.fmt(n.elders)} elder${n.elders === 1 ? '' : 's'}`),
        R.card('Clubs', R.fmt(n.clubs), `${R.fmt(n.clubMembers)} members`),
        R.card('Community Chest', R.lumens(chest.balance), `${R.lumens(chest.donatedTotal)} given · ${R.lumens(chest.paidTotal)} paid out`),
        R.card('Possessions', R.fmt(n.possessions), `${R.fmt(n.shops)} shop${n.shops === 1 ? '' : 's'} trading`));

      R.replace(root.querySelector('#soc-calendar'), calendarStrip(data.calendar));
      R.replace(root.querySelector('#soc-today'), happeningList(happenings.today, 'Nothing is planned today.'));
      R.replace(root.querySelector('#soc-tomorrow'), happeningList(happenings.tomorrow, 'Tomorrow is not written yet.'));

      const households = data.households || [];
      R.replace(root.querySelector('#soc-households'),
        households.length ? households.map(householdCard) : R.h('div', { class: 'empty' }, 'Nobody shares a home yet.'));

      const clubs = data.clubs || [];
      R.replace(root.querySelector('#soc-clubs'),
        clubs.length ? clubs.map(clubCard) : R.h('div', { class: 'empty' }, 'No club has been founded.'));

      R.replace(root.querySelector('#soc-chest'),
        R.h('div', { class: 'chest-total' }, R.h('b', null, R.lumens(chest.balance)), R.h('span', { class: 'muted small' }, ' in the Chest')),
        R.h('h4', { class: 'sub-title' }, 'Recent donations'),
        chestMovements(chest.donations, 'Nobody has given yet.', '+'),
        R.h('h4', { class: 'sub-title' }, 'Stipends paid'),
        chestMovements(chest.stipends, 'No stipend has been paid.', '−'));

      R.replace(root.querySelector('#soc-ceremonies'),
        R.h('h4', { class: 'sub-title' }, 'Weddings'),
        ceremonyList(data.recentWeddings, 'No wedding has been held.'),
        R.h('h4', { class: 'sub-title' }, 'Births'),
        ceremonyList(data.recentBirths, 'No child has been born in Reverie.'));

      const shops = [];
      if (data.emporium) shops.push(data.emporium);
      for (const s of data.shops || []) shops.push(s);
      R.replace(root.querySelector('#soc-shops'),
        shops.length ? R.h('div', { class: 'card-grid wide' }, shops.map(shopBlock)) : R.h('div', { class: 'empty' }, 'Nothing is for sale in the city.'));
    },
  });
})();
