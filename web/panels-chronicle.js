/*
 * Reverie dashboard — the Chronicle (docs/UI.md §9).
 *
 * The front page as a broadsheet: a masthead, the lead story with the face of
 * whoever it is about, the secondary columns, the Treasury box, the arts
 * desk's notices, lines quoted from the evening's diaries, a rail of back
 * numbers to read your way through, and the live despatches under it all.
 * Both papers are here — the Chronicle is the paper of record, the Harbor
 * Ledger prints the same city from the quay — and the switch between them
 * changes nothing but which page you are reading.
 *
 * Everything comes from GET /api/chronicle. A citizen's diary is public and
 * the Chronicle may quote it; notes and letters are not here and never will
 * be (docs/PRINCIPLES.md §5). Nothing in this file can touch the city: there
 * is no control on the page, only the paper (docs/PRINCIPLES.md §1).
 */
(function () {
  'use strict';
  const R = window.R;

  /** Despatches kept in the panel's live column. */
  const DESPATCHES = 80;

  const CSS = `
#tab-chronicle .sheet { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: var(--p4); align-items: start; }
#tab-chronicle .broadsheet { border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel); padding: var(--p4) var(--p5) var(--p5); box-shadow: inset 0 1px 0 rgba(255,255,255,0.03); min-width: 0; }
#tab-chronicle .masthead { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--p3); border-bottom: 2px solid var(--border-strong); padding-bottom: var(--p2); }
#tab-chronicle .masthead .title { font-family: var(--display); font-size: var(--t-26); letter-spacing: 0.03em; }
#tab-chronicle .masthead .lumen { color: var(--gold); margin-right: 6px; }
#tab-chronicle .masthead .dateline { margin-left: auto; text-align: right; font-family: var(--mono); font-size: 11px; color: var(--muted); line-height: 1.5; }
#tab-chronicle .subhead { display: flex; flex-wrap: wrap; gap: var(--p3); align-items: center; padding: var(--p2) 0; border-bottom: 1px solid var(--border); font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--dim); }
#tab-chronicle .lead { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--p4); align-items: start; padding: var(--p4) 0; border-bottom: 1px solid var(--border); }
#tab-chronicle .lead.nofigure { grid-template-columns: minmax(0, 1fr); }
#tab-chronicle .faces { display: flex; flex-wrap: wrap; gap: var(--p3); margin-top: var(--p3); }
#tab-chronicle .col { break-inside: avoid; padding: var(--p3) 0; border-bottom: 1px solid var(--border); }
#tab-chronicle .col:last-child { border-bottom: 0; }
#tab-chronicle .box { border: 1px solid var(--border); border-left: 3px solid var(--gold); border-radius: 8px; background: var(--panel-2); padding: var(--p3); margin: var(--p4) 0 0; }
#tab-chronicle .box .figures { display: flex; flex-wrap: wrap; gap: var(--p4); align-items: baseline; margin-top: var(--p2); }
#tab-chronicle .box .figures b { font-family: var(--mono); font-size: var(--t-20); color: var(--gold); }
#tab-chronicle .quote { border-left: 2px solid var(--border-strong); padding: 2px 0 2px var(--p3); margin: 0 0 var(--p3); }
#tab-chronicle .quote p { font-family: var(--display); font-size: var(--t-14); line-height: 1.5; margin: 0 0 6px; }
#tab-chronicle .quote .who { display: flex; align-items: center; gap: var(--p2); }
#tab-chronicle .review { display: grid; grid-template-columns: minmax(0, 1fr) 90px; gap: var(--p2) var(--p3); align-items: center; padding: var(--p2) 0; border-bottom: 1px solid var(--border); }
#tab-chronicle .review:last-child { border-bottom: 0; }
#tab-chronicle .rail { position: sticky; top: 0; }
#tab-chronicle .rail .rail-list { max-height: 60vh; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 4px; }
#tab-chronicle .rail button { display: block; width: 100%; text-align: left; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 6px var(--p2); cursor: pointer; color: var(--muted); }
#tab-chronicle .rail button:hover { border-color: var(--border-strong); color: var(--text); }
#tab-chronicle .rail button.on { border-color: var(--gold); background: var(--gold-soft); color: var(--text); }
#tab-chronicle .rail button .d { font-family: var(--mono); font-size: 11px; color: var(--dim); }
#tab-chronicle .rail button.on .d { color: var(--gold); }
#tab-chronicle .rail button .h {
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
  font-size: 11.5px; line-height: 1.35; overflow: hidden;
}
@media (max-width: 1100px) { #tab-chronicle .sheet { grid-template-columns: minmax(0, 1fr); } #tab-chronicle .rail { position: static; } }
`;

  function styleOnce() {
    if (document.getElementById('chronicle-style')) return;
    document.head.appendChild(R.h('style', { id: 'chronicle-style' }, CSS));
  }

  /** The Profile drawer, late-bound exactly as the other panels bind it. */
  function openProfile(id) {
    if (!id) return;
    if (typeof R.openProfile === 'function') { R.openProfile(id); return; }
    R.openCitizen(id);
  }

  function face(id, size, opts) {
    return R.portrait(id, size, Object.assign(
      { onClick: (e) => { e.stopPropagation(); openProfile(id); } }, opts || {}));
  }

  const state = { paper: 'chronicle', day: null, data: null, lastEditionDay: null, dirty: false, sig: null };

  /**
   * What has to change before the page is set again. A poll every two seconds
   * must not reset a page the reader is in the middle of: the broadsheet is
   * redrawn when a paper prints, an hour turns or the desks file something
   * new, and left alone otherwise.
   */
  function signature(data) {
    const editions = data.editions || [];
    return [
      data.day, data.hour, editions.length, (editions[0] || {}).key,
      (data.reviews || []).length, ((data.diaries || [])[0] || {}).day,
      ((data.treasury || {}).series || []).length,
    ].join('|');
  }

  // ------------------------------------------------------------- the page

  const editionsOf = (data, paper) => (data.editions || []).filter((e) => e.paper === paper);

  /** The edition the reader is on: the one they clicked, else the newest. */
  function currentEdition(data) {
    const list = editionsOf(data, state.paper);
    if (!list.length) return null;
    if (state.day === null) return list[0];
    return list.find((e) => e.day === state.day) || list[0];
  }

  /**
   * The line above a headline. An edition keeps its sentences for sixty
   * mornings and the event log does not run that deep, so a back number whose
   * event has aged out of the log simply prints without one.
   */
  function byline(story) {
    const bits = [
      story.kind ? String(story.kind).replace(/_/g, ' ') : null,
      story.tick === null || story.tick === undefined ? null : R.whenText(story.tick),
    ].filter(Boolean);
    return bits.length ? R.h('div', { class: 'byline' }, bits.join(' · ')) : null;
  }

  /** The lead: the one story a page gives a face to. */
  function leadStory(story) {
    if (!story) return R.h('div', { class: 'empty' }, 'This edition went to press with nothing in it.');
    const who = story.who || [];
    const wrap = R.h('div', { class: `lead${who.length ? '' : ' nofigure'}` });
    if (who.length) {
      wrap.appendChild(R.h('figure', { style: 'margin:0;text-align:center' },
        face(who[0].id, 96, { alt: who[0].name, eager: true, class: 'square' }),
        R.h('figcaption', { class: 'byline', style: 'margin-top:6px;max-width:110px' }, R.fullName(who[0]))));
    }
    wrap.appendChild(R.h('div', { style: 'min-width:0' },
      byline(story),
      R.h('h2', { class: 'headline lead' }, story.text),
      who.length > 1
        ? R.h('div', { class: 'faces' }, who.slice(1).map((w) => R.person(w, { size: 32 })))
        : null));
    return wrap;
  }

  /** The columns under the fold: everything else the editor set that morning. */
  function columns(stories) {
    if (!stories.length) return null;
    return R.h('div', { class: 'columns-2', style: 'margin-top:var(--p3)' },
      stories.map((s) => R.h('div', { class: 'col' },
        byline(s),
        R.h('h3', { class: 'headline sub' }, s.text),
        (s.who || []).length
          ? R.h('div', { class: 'faces' }, s.who.map((w) => R.person(w, { size: 26, district: false })))
          : null)));
  }

  /**
   * The Treasury box: the morning's line, and where the balance had been by
   * then. A back number is never shown a figure from after it went to press.
   */
  function treasuryBox(data, edition) {
    const t = data.treasury || {};
    const series = (t.series || []).filter((s) => s.day <= edition.reportedDay);
    const values = series.map((s) => s.treasury);
    const last = values.length ? values[values.length - 1] : null;
    const prev = values.length > 1 ? values[values.length - 2] : null;
    const delta = last !== null && prev !== null ? last - prev : null;
    return R.h('div', { class: 'box' },
      R.h('div', { class: 'byline' }, 'The Treasury'),
      R.h('div', { class: 'mono', style: 'font-size:12.5px;margin-top:4px' }, edition.treasuryReport || '—'),
      R.h('div', { class: 'figures' },
        R.h('span', null, R.h('b', null, last === null ? '—' : R.lumens(last)),
          delta === null ? null : R.h('span', { class: `small mono ${delta >= 0 ? 'pos' : 'neg'}`, style: 'margin-left:6px' },
            `${delta >= 0 ? '+' : '−'}${R.fmt(Math.abs(delta))} on the day`)),
        R.h('span', { class: 'spacer' }),
        values.length > 1 ? R.sparkline(values, 180, 30, 'var(--gold)') : null),
      series.length
        ? R.h('div', { class: 'byline', style: 'margin-top:6px' },
          `money supply ${R.lumens(series[series.length - 1].moneySupply)}`
          + ` · price index ${(series[series.length - 1].priceIndex ?? 0).toFixed(2)}`)
        : null);
  }

  /** What the papers made of what the city made. */
  function reviews(data, edition) {
    // Nothing a page prints can be later than the page.
    const run = (data.reviews || []).filter((r) => r.day <= edition.day);
    const mine = run.filter((r) => r.paper === edition.paper);
    const list = mine.length ? mine : run;
    if (!list.length) return null;
    return R.section('From the arts desk', `${R.fmt(list.length)} notices`,
      list.slice(0, 6).map((r) => R.h('div', { class: 'review' },
        R.h('div', { style: 'min-width:0' },
          R.h('div', { class: 'serif', style: 'font-size:var(--t-14)' }, r.title,
            r.inMuseum ? R.h('span', { style: 'margin-left:6px' }, R.pill('in the Museum', 'gold')) : null),
          R.h('div', { class: 'byline', style: 'margin-top:2px' },
            `${r.kindName || r.kind} · day ${R.fmt(r.day)} · ${r.paperName || r.paper}`),
          r.creator ? R.h('div', { style: 'margin-top:6px' }, R.person(r.creator, { size: 24, district: false })) : null),
        R.h('div', null,
          R.bar(r.score, 100, r.score >= 70 ? 'gold' : r.score >= 40 ? '' : 'crit'),
          R.h('div', { class: 'byline', style: 'text-align:right;margin-top:4px' }, `${R.fmt(r.score)} / 100`)))));
  }

  /** Lines from the evening's diaries. Public, unlike a citizen's notes. */
  function diaries(data, edition) {
    // The evening the edition reports on, and no other: a back number older
    // than the days the city keeps diaries for simply has no quotes.
    const entry = (data.diaries || []).find((d) => d.day === edition.reportedDay) || null;
    if (!entry || !(entry.quotes || []).length) return null;
    return R.section('From the evening’s pages', `day ${R.fmt(entry.day)} · written by their own hands`,
      entry.quotes.map((q) => R.h('blockquote', { class: 'quote' },
        R.h('p', null, `“${q.text}”`),
        R.h('div', { class: 'who' }, q.who ? R.person(q.who, { size: 24, district: false }) : null))));
  }

  function masthead(data, edition) {
    const paper = (data.papers || []).find((p) => p.paper === edition.paper) || null;
    return R.h('div', null,
      R.h('div', { class: 'masthead' },
        R.h('div', { class: 'title' }, R.h('span', { class: 'lumen', 'aria-hidden': 'true' }, '☾'), edition.paperName),
        R.h('div', { class: 'dateline' },
          R.h('div', null, `Day ${R.fmt(edition.day)}`),
          R.h('div', null, edition.era || `cycle ${R.fmt(data.cycle)}`),
          paper ? R.h('div', null, `read by ${R.pct(paper.readership || 0)} of the city`) : null)),
      R.h('div', { class: 'subhead' },
        R.h('span', null, edition.slant),
        R.h('span', null, `the news of day ${R.fmt(edition.reportedDay)}`),
        R.h('span', { class: 'spacer' }),
        edition.day === data.day ? R.pill('this morning', 'gold') : R.pill('back number', 'neutral')));
  }

  function page(data) {
    const edition = currentEdition(data);
    if (!edition) {
      const paper = (data.papers || []).find((p) => p.paper === state.paper) || null;
      return R.h('div', { class: 'broadsheet' },
        R.h('div', { class: 'empty' },
          `${paper ? paper.name : 'This paper'} has not printed yet. The presses run at first light.`));
    }
    const stories = edition.stories || [];
    const sheet = R.h('div', { class: 'broadsheet' },
      masthead(data, edition),
      leadStory(stories[0]),
      columns(stories.slice(1)),
      treasuryBox(data, edition),
      R.h('div', { style: 'margin-top:var(--p5)' }, reviews(data, edition), diaries(data, edition)));
    return sheet;
  }

  // -------------------------------------------------------------- the rail

  function rail(data, render) {
    const list = editionsOf(data, state.paper);
    const current = currentEdition(data);
    return R.h('div', { class: 'rail' },
      R.h('div', { class: 'section-title', style: 'margin-bottom:var(--p2)' }, 'Back numbers'),
      R.h('div', { class: 'rail-list' },
        list.length ? list.map((e) => R.h('button', {
          class: current && e.key === current.key ? 'on' : null, type: 'button',
          title: (e.stories || []).map((st) => st.text).join('\n'),
          onclick: () => { state.day = e.day; render(); },
        },
          R.h('span', { class: 'd' }, `day ${R.fmt(e.day)}`),
          R.h('span', { class: 'h' }, ((e.stories || [])[0] || {}).text || '—')))
          : R.h('div', { class: 'empty' }, 'No back numbers yet.')));
  }

  function toolbar(data, render) {
    const papers = data.papers || [];
    return R.h('div', { class: 'toolbar' },
      papers.map((p) => R.h('button', {
        class: `btn${p.paper === state.paper ? ' primary' : ''}`, type: 'button',
        title: `${p.slant} · ${R.pct(p.readership || 0)} of the city reads it`,
        onclick: () => { state.paper = p.paper; state.day = null; render(); },
      }, p.name)),
      R.h('span', { class: 'spacer' }),
      state.day === null ? null : R.h('button', {
        class: 'btn sm', type: 'button', onclick: () => { state.day = null; render(); },
      }, 'Back to this morning'),
      R.h('span', { class: 'muted small' },
        `${R.fmt((data.editions || []).length)} editions on the shelf`));
  }

  // -------------------------------------------------------- the despatches

  function despatch(ev) {
    const w = ev.weight ?? 0;
    const node = R.h('div', { class: `ev w${w >= 0.8 ? 4 : w >= 0.5 ? 3 : w >= 0.3 ? 2 : 1}` },
      R.h('span', { class: 'when' }, R.whenText(ev.tick)),
      R.h('span', { class: 'kind' }, String(ev.kind || '').replace(/_/g, ' ')),
      R.h('span', { class: 'text' }, ev.text));
    if ((ev.actors || []).length) {
      node.classList.add('clickable');
      node.style.cursor = 'pointer';
      node.addEventListener('click', () => openProfile(ev.actors[0]));
    }
    return node;
  }

  /** The city's own wire, newest first, as the Chronicle receives it. */
  function despatches(host) {
    R.replace(host, (R.ticker.events || []).slice(0, DESPATCHES).map(despatch));
    if (!host.childNodes.length) R.append(host, [R.h('div', { class: 'empty' }, 'Nothing on the wire yet.')]);
  }

  function prependDespatches(host, list) {
    const empty = host.querySelector('.empty');
    if (empty) R.clear(host);
    for (const ev of list) {
      const node = despatch(ev);
      host.insertBefore(node, host.firstChild);
      R.slideIn(node);
    }
    while (host.childNodes.length > DESPATCHES) host.removeChild(host.lastChild);
  }

  // ------------------------------------------------------------- the panel

  R.registerTab('chronicle', {
    label: 'Chronicle',
    mount(root) {
      styleOnce();
      this.head = R.h('div');
      this.sheet = R.h('div', { class: 'sheet' });
      this.wire = R.h('div', { class: 'ticker' });
      root.appendChild(this.head);
      root.appendChild(this.sheet);
      root.appendChild(R.h('div', { style: 'margin-top:var(--p5)' },
        R.section('The despatches', 'everything the city reported, as it came in', this.wire)));
      despatches(this.wire);
      R.ticker.onChange((list, seeded) => {
        if (root.classList.contains('hidden')) { state.dirty = true; return; }
        if (seeded || state.dirty) { state.dirty = false; despatches(this.wire); return; }
        prependDespatches(this.wire, list);
      });
    },
    load: () => R.api('/api/chronicle'),
    update(data) {
      state.data = data;
      const render = () => {
        R.replace(this.head, toolbar(state.data, render));
        R.replace(this.sheet, page(state.data), rail(state.data, render));
      };
      // A new morning: the paper the reader has open puts its own lead on the
      // strip under the header, which is how anything on this page reaches the
      // whole window. Switching papers is not a new morning, so the day — not
      // the edition's key — is what says the presses have run again.
      const newest = editionsOf(data, state.paper)[0] || null;
      if (newest && state.lastEditionDay !== null && newest.day > state.lastEditionDay) {
        const who = ((newest.stories || [])[0] || {}).who || [];
        R.ticker({
          text: `${newest.paperName}, day ${newest.day}: “${((newest.stories || [])[0] || {}).text || '—'}”`,
          kind: 'edition', tone: 'lead', actors: who.length ? [who[0].id] : [],
        });
        if (state.day === null) R.slideIn(this.sheet);
      }
      state.lastEditionDay = newest ? newest.day : state.lastEditionDay;
      R.setTabCount('chronicle', (data.editions || []).length || '');
      const sig = signature(data);
      if (sig !== state.sig) { state.sig = sig; render(); }
      if (state.dirty) { state.dirty = false; despatches(this.wire); }
    },
  });
})();
