/*
 * Reverie dashboard — the component kit.
 *
 * The pieces every panel draws with: pills and tags, bars and sparklines,
 * portraits and person lines, prose at a readable measure, a family tree, a
 * citizen's web of ties, cards, sections and the table. They hang off the
 * same `R` namespace app.js defines and are loaded before any panel file, so
 * no panel ever has to invent a component — or its spacing — of its own.
 *
 * Everything is built with textContent: citizen-written text can never
 * become markup.
 */
(function () {
  'use strict';
  const R = window.R;

  // ---------------------------------------------------------- pills & tags

  R.pill = function pill(text, cls) {
    return R.h('span', { class: `pill ${cls || text}` }, text);
  };

  R.standingPill = (standing) => R.pill(standing, standing);

  /**
   * A small pill styled by what it says: office, standing, party, school,
   * district (in that district's hue), gang, club, mind, work — anything the
   * panels label a citizen or a row with. `kind` is the styling, `text` the
   * words. For a district, pass the id or the name; both find the hue.
   */
  R.tag = function tag(kind, text, opts) {
    const o = opts || {};
    const el = R.h('span', { class: `tag tag-${kind || 'plain'}`, title: o.title || null });
    if (kind === 'district') {
      const id = R.districtId(o.id || text);
      if (id) {
        el.style.setProperty('--tag-hue', R.districtHue(id));
        el.classList.add('has-hue');
        if (!o.title) el.title = R.districtName(id);
      }
      R.append(el, [o.label || (id ? R.districtName(id) : text)]);
    } else {
      R.append(el, [text]);
    }
    if (o.onClick) {
      el.classList.add('clickable');
      el.addEventListener('click', o.onClick);
    }
    return el;
  };

  /** What kind of mind this is: Claude, an external agent, an unclaimed child, or a scripted founder. */
  R.brainBadge = function brainBadge(brain) {
    if (brain === 'llm') return R.h('span', { class: 'badge llm', title: 'Driven by Claude' }, 'Claude');
    if (brain === 'remote') return R.h('span', { class: 'badge remote', title: 'External agent over HTTP' }, 'remote');
    if (brain === 'child') return R.h('span', { class: 'badge child', title: 'Born here and unclaimed: it lives on the child instinct until someone claims it' }, 'unclaimed');
    if (brain === 'reflex') return R.h('span', { class: 'badge founder', title: 'A scripted mind seeded to demonstrate the city' }, 'scripted founder');
    return null;
  };

  R.brainName = function brainName(brain) {
    if (brain === 'llm') return 'Claude';
    if (brain === 'reflex') return 'scripted founder';
    if (brain === 'child') return 'unclaimed child';
    if (brain === 'remote') return 'agent';
    return brain;
  };

  R.officeLabel = (office) => (office ? R.pill(R.titleCase(office), 'gold') : R.h('span', { class: 'dim' }, '—'));

  R.bar = function bar(value, max, cls) {
    const p = R.clamp((value / (max || 1)) * 100, 0, 100);
    return R.h('div', { class: `bar ${cls || ''}` }, R.h('i', { style: `width:${p.toFixed(1)}%` }));
  };

  /** Need bar coloured by criticality (<20 critical, <40 warning). */
  R.needBar = (value) => R.bar(value, 100, value < 20 ? 'crit' : value < 40 ? 'warn' : '');

  R.barRow = function barRow(label, value, max, cls) {
    return R.h('div', { class: 'bar-row' },
      R.h('span', { class: 'muted' }, label),
      R.bar(value, max, cls),
      R.h('span', { class: 'num' }, Math.round(value)));
  };

  R.miniBar = function miniBar(value, max, cls) {
    return R.h('span', { class: 'mini-bar' }, R.bar(value, max, cls), R.h('span', { class: 'num small' }, Math.round(value)));
  };

  /** Tiny inline SVG line chart. */
  R.sparkline = function sparkline(values, w = 80, h = 22, color = 'var(--accent)') {
    const el = R.svg('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: 'spark' });
    const vals = (values || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (vals.length < 2) {
      el.appendChild(R.svg('line', { x1: 0, y1: h / 2, x2: w, y2: h / 2, stroke: 'var(--dim)', 'stroke-width': 1 }));
      return el;
    }
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo || 1;
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * (w - 2) + 1;
      const y = h - 2 - ((v - lo) / span) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    el.appendChild(R.svg('polyline', { points: pts.join(' '), fill: 'none', stroke: color, 'stroke-width': 1.4, 'stroke-linejoin': 'round' }));
    const last = pts[pts.length - 1].split(',');
    el.appendChild(R.svg('circle', { cx: last[0], cy: last[1], r: 1.8, fill: color }));
    return el;
  };

  /** Four thin bars for a candidate's platform (tax, dividend, min wage, strictness). */
  R.platformBars = function platformBars(p) {
    if (!p) return R.h('span', { class: 'dim' }, '—');
    const keys = ['tax', 'dividend', 'minWage', 'strictness'];
    const title = keys.map((k) => `${R.titleCase(k)} ${Math.round((p[k] || 0) * 100)}%`).join(' · ');
    return R.h('span', { class: 'platform', title },
      keys.map((k) => R.h('i', { class: k, style: `height:${Math.max(2, Math.round((p[k] || 0) * 14))}px` })));
  };

  /** "Ondine Ashgrove" for a married citizen, "Ondine" for everyone else. */
  R.displayName = function displayName(c) {
    if (!c) return '';
    return c.married && c.familyName ? `${c.name} ${c.familyName}` : c.name;
  };

  /** Given and family name together: what a profile, a tree or a card is headed with. */
  R.fullName = function fullName(c) {
    if (!c) return '—';
    return c.familyName ? `${c.name} ${c.familyName}` : c.name;
  };

  /** A pill for the citizens who are not simply adults. */
  R.stagePill = function stagePill(stage) {
    if (stage === 'child') return R.pill('child', 'accent');
    if (stage === 'elder') return R.pill('elder', 'gold');
    return null;
  };

  R.nameLink = function nameLink(id, name) {
    if (!id) return R.h('span', { class: 'dim' }, '—');
    // The title is what a clipped name needs: the name in full, not the id.
    return R.h('a', {
      class: 'name-link', href: '#', title: name ? String(name) : id, dataset: { id },
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); R.openCitizen(id); },
    }, name || id);
  };

  R.nameList = function nameList(items) {
    if (!items || !items.length) return R.h('span', { class: 'dim' }, '—');
    const out = [];
    items.forEach((it, i) => {
      if (i) out.push(', ');
      out.push(R.nameLink(it.id, it.name));
    });
    return R.h('span', null, out);
  };

  // ------------------------------------------------------------- portraits
  //
  // The city draws every citizen a face from public facts alone
  // (src/identity/portrait.ts, served by GET /api/portrait/:id.svg?size=N).
  // It is a file, not a data URI, so the browser caches it for a day and a
  // table of two hundred faces costs two hundred cache hits. Requests are
  // snapped to a few sizes so the server's per-tick cache is reused too.

  const PORTRAIT_SIZES = [24, 32, 40, 56, 72, 96, 128, 192, 256];

  R.portraitSize = function portraitSize(size) {
    const want = Math.round(Number(size) || 40);
    return PORTRAIT_SIZES.find((s) => s >= want) || PORTRAIT_SIZES[PORTRAIT_SIZES.length - 1];
  };

  R.portraitSrc = function portraitSrc(id, size) {
    return `/api/portrait/${encodeURIComponent(id)}.svg?size=${R.portraitSize(size)}`;
  };

  /**
   * A citizen's face at `size` px. The frame is drawn immediately (a quiet
   * placeholder ring), the image fades in when it loads and the placeholder
   * simply stays if the id is unknown. Lazy: faces below the fold are never
   * fetched.
   */
  R.portrait = function portrait(id, size = 40, opts) {
    const o = opts || {};
    const px = Math.round(Number(size) || 40);
    const frame = R.h('span', {
      class: `portrait${o.class ? ` ${o.class}` : ''}${o.ring ? ` ring-${o.ring}` : ''}`,
      style: `width:${px}px;height:${px}px`,
      title: o.title || null,
    });
    if (!id) {
      frame.classList.add('anon');
      return frame;
    }
    const img = R.h('img', {
      src: R.portraitSrc(id, px), width: px, height: px, alt: o.alt || '',
      loading: o.eager ? 'eager' : 'lazy', decoding: 'async', draggable: 'false',
    });
    img.addEventListener('load', () => frame.classList.add('loaded'));
    img.addEventListener('error', () => frame.classList.add('anon'));
    frame.appendChild(img);
    if (o.onClick !== false) {
      frame.classList.add('clickable');
      frame.addEventListener('click', o.onClick || ((e) => { e.stopPropagation(); R.openCitizen(id); }));
    }
    return frame;
  };

  /**
   * A person as the views send them (a PersonCard: id, name, familyName,
   * lifeStage, standing, office, district, present). Portrait, name and the
   * one or two tags that matter — the shape every table and list should use
   * so a citizen looks the same everywhere.
   */
  R.person = function person(card, opts) {
    if (!card) return R.h('span', { class: 'dim' }, '—');
    const o = opts || {};
    const size = o.size || 32;
    const line = R.h('span', { class: 'person-name' },
      o.link === false
        ? R.h('span', { class: 'person-plain', title: R.fullName(card) }, R.fullName(card))
        : R.nameLink(card.id, R.fullName(card)));
    if (o.stage !== false) R.append(line, [' ', R.stagePill(card.lifeStage)]);
    if (o.office !== false && card.office) R.append(line, [' ', R.tag('office', R.titleCase(card.office))]);
    if (o.standing && card.standing && card.standing !== 'good') R.append(line, [' ', R.standingPill(card.standing)]);
    const sub = o.sub !== undefined ? o.sub
      : o.district !== false && card.district ? R.tag('district', card.district) : null;
    return R.h('span', { class: `person${card.present === false ? ' away' : ''}${o.class ? ` ${o.class}` : ''}` },
      o.portrait === false ? null : R.portrait(card.id, size, { alt: card.name }),
      R.h('span', { class: 'person-text' }, line, sub ? R.h('span', { class: 'person-sub' }, sub) : null));
  };

  // ----------------------------------------------------------------- story

  const STORY_CLAMP = 420;

  /**
   * Prose at a readable measure (~66 characters). Long text is clamped with
   * a fade and a "Read more" toggle rather than being allowed to run away
   * down the page. Blank lines make paragraphs.
   */
  R.story = function story(text, opts) {
    const o = opts || {};
    const body = String(text ?? '').trim();
    if (!body) return R.h('div', { class: 'story empty' }, o.empty || 'Nothing written yet.');
    const paras = body.split(/\n\s*\n/).map((p) => R.h('p', null, p.replace(/\s*\n\s*/g, ' ')));
    const prose = R.h('div', { class: 'story-body' }, paras);
    const wrap = R.h('div', { class: `story${o.class ? ` ${o.class}` : ''}` }, prose);
    if (body.length <= (o.clamp || STORY_CLAMP)) return wrap;
    prose.classList.add('clamped');
    const more = R.h('button', {
      class: 'story-more', type: 'button',
      onclick: () => {
        const open = prose.classList.toggle('clamped') === false;
        more.textContent = open ? 'Read less' : 'Read more';
      },
    }, 'Read more');
    wrap.appendChild(more);
    return wrap;
  };

  // ------------------------------------------------------------ family tree

  const TREE_BANDS = [
    { key: 'parents', label: 'Parents' },
    { key: 'partner', label: 'Partner' },
    { key: 'siblings', label: 'Siblings' },
    { key: 'children', label: 'Children' },
  ];

  function treeMember(m, relation) {
    if (!m) return null;
    return R.h('div', { class: `tree-node${m.present === false ? ' away' : ''}` },
      R.portrait(m.id, 44, { alt: m.name }),
      R.h('span', { class: 'tree-name' }, R.nameLink(m.id, R.fullName(m))),
      R.h('span', { class: 'tree-rel' }, relation || m.relation || ''),
      m.standing === 'exiled' ? R.pill('exiled', 'exiled') : null);
  }

  /**
   * A compact family tree from `profile.family`: partner, parents, children,
   * siblings, each a small portrait and a name, in bands joined by a hairline.
   * Pass `{ self }` (a person card) to stand the citizen beside their partner.
   */
  R.tree = function tree(family, opts) {
    const o = opts || {};
    const fam = family || {};
    const wrap = R.h('div', { class: 'tree' });
    let drew = false;
    for (const band of TREE_BANDS) {
      const value = fam[band.key];
      let members = [];
      if (band.key === 'partner') {
        members = [
          o.self ? { ...o.self, relation: 'self' } : null,
          value ? { ...value, relation: value.married ? 'spouse' : 'partner' } : null,
        ].filter(Boolean);
      } else {
        members = Array.isArray(value) ? value : [];
      }
      if (!members.length) continue;
      drew = true;
      wrap.appendChild(R.h('div', { class: `tree-band band-${band.key}` },
        R.h('div', { class: 'tree-label' }, band.key === 'partner' && fam.partner && fam.partner.married ? 'Married' : band.label),
        R.h('div', { class: 'tree-row' }, members.map((m) => treeMember(m, m.relation)))));
    }
    if (!drew) return R.h('div', { class: 'empty' }, o.empty || 'No family on the record.');
    if (fam.familyName) wrap.appendChild(R.h('div', { class: 'tree-foot muted small' }, `of the ${fam.familyName} family`));
    return wrap;
  };

  // ----------------------------------------------------- relationship graph

  function hash32(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < String(s).length; i++) {
      h ^= String(s).charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  const EDGE_TONE = {
    partner: 'warm', spouse: 'warm', parent: 'warm', child: 'warm', sibling: 'warm',
    friend: 'good', mentor: 'good', mentee: 'good',
    rival: 'bad', feud: 'bad', enemy: 'bad',
  };

  /** Rest distance from the centre: affection pulls in, a feud pushes out. */
  function restRadius(value) {
    const v = R.clamp(Number(value) || 0, -100, 100) / 100;
    return R.clamp(0.85 - v * 0.42, 0.4, 1.3);
  }

  /**
   * One citizen's web: the self in the middle, everyone they are bound to
   * around them, edges coloured by kind and weighted by the bond. The layout
   * is a small deterministic relaxation (spring to a rest radius, repel your
   * neighbours) — a few dozen nodes at most, no library, no physics engine.
   */
  R.graph = function graph(relationships, opts) {
    const o = opts || {};
    const rel = relationships || {};
    const web = rel.nodes ? rel : rel.web || { nodes: [], links: [] };
    const nodes = (web.nodes || []).slice(0, o.max || 24);
    if (!nodes.length) return R.h('div', { class: 'empty' }, o.empty || 'No ties yet.');
    const ids = new Set(nodes.map((n) => n.id));
    const links = (web.links || []).filter((l) => ids.has(l.from) && ids.has(l.to));
    const selfId = o.selfId || (nodes.find((n) => n.relation === 'self') || nodes[0]).id;
    const bond = new Map();
    for (const l of links) {
      const other = l.from === selfId ? l.to : l.to === selfId ? l.from : null;
      if (other) bond.set(other, l);
    }

    const pts = nodes.map((n, i) => {
      const self = n.id === selfId;
      const seed = hash32(n.id);
      const angle = self ? 0 : ((seed % 3600) / 3600) * Math.PI * 2 + i * 0.31;
      const r = self ? 0 : restRadius(bond.get(n.id) ? bond.get(n.id).value : n.bond);
      return { node: n, self, x: Math.cos(angle) * r, y: Math.sin(angle) * r, r };
    });
    const nodePx = o.node || 40;
    const size = o.size || 320;
    // Two faces must not sit closer than a name is wide. The relaxation runs
    // in normalised space and is rescaled to fit at the end (scale ≈ 0.4), so
    // the rest separation has to be divided by that scale to come out as the
    // pixels we actually want between two labels.
    const label = Math.max(nodePx * 1.3, o.gap || 62);
    const sep = R.clamp(label / (size * 0.42), 0.08, 0.7);
    for (let step = 0; step < 220; step++) {
      for (const p of pts) {
        if (p.self) { p.x = 0; p.y = 0; continue; }
        const d = Math.hypot(p.x, p.y) || 0.001;
        const pull = (p.r - d) * 0.12;
        p.x += (p.x / d) * pull;
        p.y += (p.y / d) * pull;
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i];
          const b = pts[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.001;
          const want = a.self || b.self ? sep * 1.2 : sep;
          if (d >= want) continue;
          const push = ((want - d) / d) * 0.5;
          if (!a.self) { a.x -= dx * push; a.y -= dy * push; }
          if (!b.self) { b.x += dx * push; b.y += dy * push; }
        }
      }
    }
    let extent = 0.5;
    for (const p of pts) extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
    const scale = 0.44 / extent;
    const at = (p) => ({ left: 50 + p.x * scale * 100, top: 50 + p.y * scale * 100 });

    const wrap = R.h('div', { class: 'graph', style: `--graph-size:${size}px` });
    const edges = R.svg('svg', { class: 'graph-edges', viewBox: '0 0 100 100', preserveAspectRatio: 'none' });
    const byId = new Map(pts.map((p) => [p.node.id, p]));
    for (const l of links) {
      const a = byId.get(l.from);
      const b = byId.get(l.to);
      if (!a || !b) continue;
      const pa = at(a);
      const pb = at(b);
      const tone = EDGE_TONE[l.kind] || (Number(l.value) < 0 ? 'bad' : 'plain');
      edges.appendChild(R.svg('line', {
        x1: pa.left, y1: pa.top, x2: pb.left, y2: pb.top,
        class: `graph-edge edge-${tone}`,
        'stroke-width': (0.25 + R.clamp(Math.abs(Number(l.value) || 0) / 100, 0, 1) * 0.5).toFixed(2),
      }));
    }
    wrap.appendChild(edges);
    for (const p of pts) {
      const pos = at(p);
      const l = bond.get(p.node.id);
      const kind = p.self ? 'self' : (l && l.kind) || p.node.relation || 'tie';
      const value = l ? l.value : p.node.bond;
      wrap.appendChild(R.h('div', {
        class: `graph-node${p.self ? ' is-self' : ''} tone-${EDGE_TONE[kind] || 'plain'}`,
        style: `left:${pos.left.toFixed(2)}%;top:${pos.top.toFixed(2)}%`,
        title: `${R.fullName(p.node)} · ${R.titleCase(kind)}${value === undefined || value === null ? '' : ` · bond ${Math.round(value)}`}`,
      },
        R.portrait(p.node.id, p.self ? Math.round(nodePx * 1.3) : nodePx, { alt: p.node.name }),
        R.h('span', { class: 'graph-label' }, p.node.name)));
    }
    return wrap;
  };

  // ----------------------------------------------------------- cards, table

  /**
   * A stat card. Either the positional form — card(label, value, sub, extra) —
   * or an options object: { label, value, sub, tone, spark, extra, onClick }.
   */
  R.card = function card(label, value, sub, extra) {
    const o = label && typeof label === 'object' && !(label instanceof Node) ? label : { label, value, sub, extra };
    const subEl = o.sub ? R.h('div', { class: `sub ${o.sub.cls || o.tone || ''}` }, o.sub.text ?? o.sub) : null;
    const el = R.h('div', { class: `card${o.class ? ` ${o.class}` : ''}${o.tone ? ` tone-${o.tone}` : ''}` },
      R.h('div', { class: 'label' }, o.label),
      R.h('div', { class: `value${o.small ? ' small' : ''}` }, o.value),
      subEl,
      o.spark || null,
      o.extra || null);
    if (o.onClick) {
      el.classList.add('clickable');
      el.addEventListener('click', o.onClick);
    }
    return el;
  };

  R.section = function section(title, meta, ...children) {
    return R.h('div', { class: 'section' },
      R.h('h3', { class: 'section-title' }, title, meta ? R.h('span', { class: 'meta' }, meta) : null),
      children);
  };

  /** Minimum widths the brief fixes, applied from the column key so nobody has to remember them. */
  const COLUMN_MIN = { name: 140, job: 180, district: 120, employer: 160, defendant: 140, citizen: 140, title: 160 };

  function columnMin(col) {
    if (col.min === 0) return null;
    if (col.min) return col.min;
    if (COLUMN_MIN[col.key]) return COLUMN_MIN[col.key];
    if (/\bnum\b/.test(col.cls || '')) return 80;
    return null;
  }

  function cellValue(col, row) {
    const v = col.render ? col.render(row) : row[col.key];
    if (v === null || v === undefined || v === '') return R.h('span', { class: 'dim' }, '—');
    if (!col.truncate) return v;
    const title = col.title ? col.title(row) : typeof v === 'string' ? v : null;
    return R.h('span', { class: 'trunc', title: title || null }, v);
  }

  /**
   * Generic table. columns: [{ key, label, cls, render(row), sortable,
   * sortValue(row), min, truncate, title(row) }]; sort: { key, dir };
   * onSort(key, dir) re-renders; onRowClick(row). `minWidth` keeps a wide
   * table honest — it scrolls inside its own wrapper rather than smooshing.
   */
  R.table = function table({ columns, rows, sort, onSort, rowClass, onRowClick, empty, minWidth, dense }) {
    if (!rows || !rows.length) return R.h('div', { class: 'empty' }, empty || 'Nothing to show yet.');
    const head = R.h('tr', null, columns.map((col) => {
      const sortable = col.sortable && onSort;
      const min = columnMin(col);
      const th = R.h('th', {
        class: [col.cls || '', sortable ? 'sortable' : ''].join(' ').trim() || null,
        style: min ? `min-width:${min}px` : null,
      }, col.label);
      if (sort && sort.key === col.key) th.appendChild(R.h('span', { class: 'arrow' }, sort.dir === 'asc' ? '▲' : '▼'));
      if (sortable) th.addEventListener('click', () => onSort(col.key, sort && sort.key === col.key && sort.dir === 'asc' ? 'desc' : 'asc'));
      return th;
    }));
    const body = R.h('tbody', null, rows.map((row) => {
      const cls = [onRowClick ? 'clickable' : '', rowClass ? rowClass(row) || '' : ''].join(' ').trim();
      const tr = R.h('tr', { class: cls || null }, columns.map((col) => R.h('td', { class: col.cls || null }, cellValue(col, row))));
      if (onRowClick) tr.addEventListener('click', () => onRowClick(row));
      return tr;
    }));
    return R.h('div', { class: 'table-wrap' },
      R.h('table', { class: dense ? 'dense' : null, style: minWidth ? `min-width:${minWidth}px` : null },
        R.h('thead', null, head), body));
  };

  /** Sort rows for R.table using the column definitions. */
  R.sortRows = function sortRows(rows, columns, sort) {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const val = col.sortValue || ((r) => r[col.key]);
    const dir = sort.dir === 'desc' ? -1 : 1;
    return rows.slice().sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  };
})();
