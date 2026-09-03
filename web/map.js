/*
 * Reverie dashboard — the SVG city map.
 *
 * Districts are labelled rounded rectangles on the 60 x 40 city grid,
 * buildings are small squares (gold-edged when critical, tinted red by
 * damage), citizens are dots jittered inside their district and coloured by
 * standing; office holders wear a gold ring, detained citizens a dashed one.
 * Dots are keyed by citizen id and moved with a CSS transition so the city
 * looks alive between polls.
 */
(function () {
  'use strict';
  const R = window.R;

  const DISTRICT_FILL = {
    commons: '#232c3e', foundry_row: '#33291f', archive: '#1f2a3c', harbor_market: '#1c3136',
    verdant_quarter: '#1f3226', nightglass: '#2c2340', threshold: '#24252c',
  };
  const STANDING_FILL = { good: '#58d68d', probation: '#e7c15c', suspended: '#ef8a4c', exiled: '#e05563' };

  let svg = null;
  let tooltip = null;
  let wrap = null;
  const layers = {};
  const districts = {};
  const names = {};
  const dots = new Map();
  const buildings = new Map();
  let selectedId = null;
  let drawnDistricts = '';

  function showTip(evt, lines) {
    if (!tooltip) return;
    R.replace(tooltip, lines.map((l, i) => (i === 0 ? R.h('b', null, l) : R.h('div', { class: 'muted' }, l))));
    tooltip.hidden = false;
    moveTip(evt);
  }

  function moveTip(evt) {
    if (!tooltip || tooltip.hidden) return;
    const rect = wrap.getBoundingClientRect();
    let x = evt.clientX - rect.left + 14;
    let y = evt.clientY - rect.top + 14;
    if (x + tooltip.offsetWidth > rect.width - 8) x = evt.clientX - rect.left - tooltip.offsetWidth - 10;
    if (y + tooltip.offsetHeight > rect.height - 8) y = evt.clientY - rect.top - tooltip.offsetHeight - 10;
    tooltip.style.left = `${Math.max(0, x)}px`;
    tooltip.style.top = `${Math.max(0, y)}px`;
  }

  function hideTip() {
    if (tooltip) tooltip.hidden = true;
  }

  function drawDistricts(list) {
    const key = list.map((d) => d.id).join(',');
    if (key === drawnDistricts) {
      for (const d of list) {
        const pop = layers.districts.querySelector(`[data-pop="${d.id}"]`);
        if (pop) pop.textContent = String(d.population ?? 0);
      }
      return;
    }
    drawnDistricts = key;
    R.clear(layers.districts);
    for (const d of list) {
      districts[d.id] = d;
      const g = R.svg('g', { class: 'district-group' },
        R.svg('rect', {
          class: 'district', x: d.x + 0.3, y: d.y + 0.3, width: d.w - 0.6, height: d.h - 0.6, rx: 0.9,
          fill: DISTRICT_FILL[d.id] || '#222833',
        }),
        R.svg('text', { class: 'district-label', x: d.x + 1.1, y: d.y + 2.0 }, d.name),
        R.svg('text', { class: 'district-pop', x: d.x + d.w - 1.1, y: d.y + 2.0, 'text-anchor': 'end', 'data-pop': d.id }, String(d.population ?? 0)));
      layers.districts.appendChild(g);
    }
  }

  function buildingTip(b) {
    const lines = [b.name, `${R.districtName(b.district)} · ${R.titleCase(b.kind)}${b.critical ? ' · critical infrastructure' : ''}`];
    if (b.damage > 0) lines.push(`Damage ${Math.round(b.damage * 100)}% — output reduced until repaired`);
    if (b.workers) lines.push(`${b.workers} working here`);
    return lines;
  }

  function drawBuildings(list) {
    const seen = new Set();
    for (const b of list) {
      seen.add(b.id);
      let el = buildings.get(b.id);
      if (!el) {
        const size = b.critical ? 2.0 : 1.7;
        el = R.svg('g', { class: 'building-group' },
          R.svg('rect', { class: `building${b.critical ? ' critical' : ''}`, x: b.x - size / 2, y: b.y - size / 2, width: size, height: size, rx: 0.28 }),
          R.svg('rect', { class: 'building-damage', x: b.x - size / 2, y: b.y - size / 2, width: size, height: size, rx: 0.28, opacity: 0 }));
        el.addEventListener('mouseenter', (e) => showTip(e, buildingTip(el.__data)));
        el.addEventListener('mousemove', moveTip);
        el.addEventListener('mouseleave', hideTip);
        layers.buildings.appendChild(el);
        buildings.set(b.id, el);
      }
      el.__data = b;
      el.lastChild.setAttribute('opacity', String(R.clamp(b.damage || 0, 0, 1) * 0.85));
    }
    for (const [id, el] of buildings) {
      if (!seen.has(id)) { el.remove(); buildings.delete(id); }
    }
  }

  function shapeFor(brain) {
    if (brain === 'llm') return R.svg('path', { class: 'body', d: 'M0,-0.6 L0.6,0 L0,0.6 L-0.6,0 Z' });
    if (brain === 'remote') return R.svg('rect', { class: 'body', x: -0.48, y: -0.48, width: 0.96, height: 0.96, rx: 0.12 });
    return R.svg('circle', { class: 'body', r: 0.46 });
  }

  function citizenTip(c) {
    const lines = [c.name];
    lines.push(`${c.job || 'Unemployed'} · ${R.districtName(c.district)}`);
    lines.push(`${R.titleCase(c.standing)}${c.office ? ` · ${R.titleCase(c.office)}` : ''}${c.detained ? ' · detained' : ''} · mood ${Math.round(c.mood)}`);
    if (c.brain !== 'reflex') lines.push(c.brain === 'llm' ? 'A Claude citizen' : 'An external agent');
    return lines;
  }

  function drawCitizens(list) {
    const seen = new Set();
    for (const c of list) {
      seen.add(c.id);
      names[c.id] = c.name;
      let el = dots.get(c.id);
      if (!el || el.__brain !== c.brain) {
        if (el) el.remove();
        el = R.svg('g', { class: 'citizen' }, R.svg('circle', { class: 'ring', r: 0.78 }), shapeFor(c.brain));
        el.__brain = c.brain;
        el.addEventListener('mouseenter', (e) => showTip(e, citizenTip(el.__data)));
        el.addEventListener('mousemove', moveTip);
        el.addEventListener('mouseleave', hideTip);
        el.addEventListener('click', (e) => { e.stopPropagation(); R.map.select(c.id); R.openCitizen(c.id); });
        layers.citizens.appendChild(el);
        dots.set(c.id, el);
      }
      el.__data = c;
      el.style.transform = `translate(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px)`;
      el.setAttribute('class', ['citizen', c.office ? 'office' : '', c.detained ? 'detained' : '', c.id === selectedId ? 'selected' : ''].join(' ').trim());
      el.lastChild.setAttribute('fill', STANDING_FILL[c.standing] || '#8a94a8');
    }
    for (const [id, el] of dots) {
      if (!seen.has(id)) { el.remove(); dots.delete(id); }
    }
  }

  function buildLegend(legendEl) {
    const item = (label, cls, style) => R.h('span', null, R.h('i', { class: cls || null, style: style || null }), label);
    R.replace(legendEl,
      item('good standing', null, `background:${STANDING_FILL.good}`),
      item('probation', null, `background:${STANDING_FILL.probation}`),
      item('suspended', null, `background:${STANDING_FILL.suspended}`),
      item('exiled (at the Gate)', null, `background:${STANDING_FILL.exiled}`),
      item('holds office', 'ring'),
      item('detained', 'dashed'),
      item('Claude', 'diamond', 'background:#b8c0d0'),
      item('remote agent', 'square', 'background:#b8c0d0'),
      item('critical building', 'square', 'background:#3a4459;border-color:var(--gold)'),
      item('damaged', 'square', 'background:#7a3a48'));
  }

  R.map = {
    init(svgEl, tipEl, legendEl) {
      svg = svgEl;
      tooltip = tipEl;
      wrap = svgEl.parentElement;
      layers.districts = R.svg('g', { class: 'layer-districts' });
      layers.buildings = R.svg('g', { class: 'layer-buildings' });
      layers.citizens = R.svg('g', { class: 'layer-citizens' });
      svg.appendChild(layers.districts);
      svg.appendChild(layers.buildings);
      svg.appendChild(layers.citizens);
      svg.addEventListener('click', () => R.map.select(null));
      if (legendEl) buildLegend(legendEl);
    },

    update(data) {
      if (!data || !svg) return;
      svg.setAttribute('viewBox', `0 0 ${data.width || 60} ${data.height || 40}`);
      drawDistricts(data.districts || []);
      drawBuildings(data.buildings || []);
      drawCitizens(data.citizens || []);
      const damaged = (data.buildings || []).filter((b) => b.damage > 0).length;
      const present = (data.citizens || []).filter((c) => c.standing !== 'exiled').length;
      const meta = document.getElementById('map-meta');
      if (meta) meta.textContent = `${present} in the city${damaged ? ` · ${damaged} damaged building${damaged > 1 ? 's' : ''}` : ''}`;
    },

    select(id) {
      selectedId = id;
      for (const [cid, el] of dots) el.classList.toggle('selected', cid === id);
    },

    districtName(id) {
      return districts[id] ? districts[id].name : null;
    },

    nameOf(id) {
      return names[id] || null;
    },
  };
})();
