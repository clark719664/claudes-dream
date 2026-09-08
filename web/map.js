/*
 * Reverie dashboard — the city map.
 *
 * A planner's table: the nine districts as rounded plats in their own hue,
 * each with a top band carrying its full name, its population and the sky
 * over it; the buildings the city has raised as glyphs on a grid *below* the
 * band, never over the label (docs/UI.md, "The map"); the citizens as dots
 * inside the walls — hollow for a child, ringed in gold for an office, dotted
 * for detained, hatched for a gang, red at the Gate for an exile, and drawn
 * shoulder to shoulder when two are married. Tram lines run dashed between
 * the districts they joined, monuments stand as small stars in the Plaza, and
 * the whole plan is lit by the hour and veiled by the weather.
 *
 * Everything is read from `GET /api/map` (src/server/views.ts `mapView` and
 * src/server/views-metropolis.ts `mapExtras`). Hovering a dot draws that
 * citizen's face; clicking one opens its profile; clicking a district filters
 * the Citizens table (`R.onDistrictClick`); clicking a building opens a
 * popover of its posts, its shift, its people, its damage and its news.
 *
 * There is not one control here that touches the city (docs/PRINCIPLES.md §1):
 * the map watches, and nothing more.
 */
(function () {
  'use strict';
  const R = window.R;

  // ------------------------------------------------------------- the plan
  //
  // All geometry is in the grid the server plats the city on (72 × 40), so
  // every number below is a city unit, not a pixel.

  const BAND = 2.6;        // the district's top band: name, population, sky
  const PAD = 0.4;         // the plat's inset inside its district rectangle
  const DOT = 0.5;         // a citizen's radius
  const COUPLE = 0.44;     // how far a married pair stands either side of centre
  const MAX_GLYPH = 2.3;   // a building glyph never grows past this
  const MIN_GLYPH = 0.85;

  /** The glyph for every kind of building the engine plats (src/data/city.ts). */
  const GLYPHS = {
    civic: 'M3.3,2.6h3.4M3.8,2.6v4.8M6.2,2.6v4.8M3,7.4h4M2.4,8.5h5.2',
    court: 'M5,2.2v6.3M2.2,3.9h5.6M2.2,3.9l-1.3,2.6h2.6zM7.8,3.9l-1.3,2.6h2.6zM3.2,8.5h3.6',
    watch: 'M5,1.7l3.1,1.3v2.9c0,2.2-1.6,3.5-3.1,4.2c-1.5-0.7-3.1-2-3.1-4.2V3z',
    treasury: 'M5,1.8a3.2,3.2 0 1,0 0.01,0M5,3.4v3.4M3.7,6.6h2.6M3.9,4.4h2.2',
    plaza: 'M5,1.8a3.2,3.2 0 1,0 0.01,0M5,4.1a0.9,0.9 0 1,0 0.01,0',
    forge: 'M2.3,7.8l3.4-3.4M5.1,2.2l2.7,2.7l-1.4,1.4l-2.7-2.7z',
    power: 'M6.2,1.5L3,5.5h2.2L4.2,8.6L7.5,4.5H5.2z',
    fabrication: 'M3.3,2.3h3.4l1.5,1.5v3.4l-1.5,1.5H3.3L1.8,7.2V3.8zM5,3.6a1.4,1.4 0 1,0 0.01,0',
    builders: 'M2.2,8.5h5.8M3.4,8.5V2.6h4.4M7.8,2.6v1.9M3.4,3.2l3.4,3.4',
    library: 'M1.9,2.6h2.5c0.6,0,1.4,0.4,1.4,0.9c0-0.5,0.8-0.9,1.4-0.9h2.5v5h-2.5c-0.6,0-1.4,0.4-1.4,0.9c0-0.5-0.8-0.9-1.4-0.9H1.9z',
    academy: 'M1.5,4.1L5,2.5l3.5,1.6L5,5.7zM8,4.7v2.3M3.2,5.3v1.9c0,0.9,3.6,0.9,3.6,0V5.3',
    observatory: 'M2,8.4h6M2.6,8.4a2.4,2.4 0 0,1 4.8,0M5.2,3.6l2.6-1.8M6.4,2.2l1.3,1.3',
    press: 'M1.9,2.8h5.3v5.5H1.9zM7.2,4.4h1.3v3.9H7.2M2.9,4.3h3.3M2.9,5.7h3.3M2.9,7.1h2.2',
    bazaar: 'M3.6,2.5h2.8M5,2.5v0.9M3.2,3.4h3.6l0.8,3.1H2.4zM4.1,6.9h1.8v1.6H4.1z',
    exchange: 'M2.2,4h5.4L6,2.4M7.8,6.4H2.4L4,8',
    bank: 'M2,8.4h6M2.3,4.3h5.4M5,1.8l3,2.5H2zM3.5,4.8v3.1M5,4.8v3.1M6.5,4.8v3.1',
    shopfront: 'M2,4.7h6M2,4.7l0.9-2.2h4.2L8,4.7M2.8,4.7v3.8h4.4V4.7M4.3,8.5V6.2h1.5v2.3',
    housing: 'M2.1,5.3L5,2.5l2.9,2.8M3.2,4.6v3.9h3.6V4.6M4.5,8.5V6.4h1v2.1',
    clinic: 'M5,2.5v5M2.5,5h5',
    garden: 'M5,8.5V5.4M5,5.9a2.2,2.2 0 1,0 0.01,0M5,6.4L3.4,5M5,6.9l1.6-1.4',
    theatre: 'M2.4,2.7h5.2v2.6c0,2-1.2,3.3-2.6,3.3S2.4,7.3,2.4,5.3zM3.6,4.4h0.9M5.5,4.4h0.9M4,6.4c0.6,0.6,1.4,0.6,2,0',
    gallery: 'M2.1,2.5h5.8v5.8H2.1zM3.1,7.1l1.6-2.1l1.2,1.5l0.8-0.9l1.2,1.7',
    venue: 'M4,7.3a1.1,1.1 0 1,0 0.02,0M5.1,7.3V2.5l2.6-0.8v1.5l-2.6,0.8',
    tavern: 'M2.5,2.8h4v2.7c0,1.4-0.9,2.2-2,2.2s-2-0.8-2-2.2zM6.5,3.5h0.9c1,0,1,1.9,0,1.9h-0.9M2.9,8.5h3.4',
    arrivals: 'M6,2.3h2.1v5.9H6M2,5.2h3.6M4.1,3.8l1.5,1.4l-1.5,1.4',
    embassy: 'M3,8.5V2.3M3,2.6l4.4,1.2L3,5v-0.1M2.1,8.5h1.9',
    gate: 'M2.1,8.5V5.1a2.9,2.9 0 0,1 5.8,0v3.4M5,8.5V2.4M2.1,6.3h5.8',
    university: 'M5,1.7l1.7,1.8v4.9H3.3V3.5zM2.2,8.5v-3h1.1M7.8,8.5v-3H6.7M1.9,8.5h6.2M5,8.5V6.6',
    stadium: 'M5,5.3m-3.2,0a3.2,2.3 0 1,0 6.4,0a3.2,2.3 0 1,0 -6.4,0M5,3v4.6',
    museum: 'M1.7,4L5,1.8L8.3,4M2,8.4h6M3.1,4.6v3.2M5,4.6v3.2M6.9,4.6v3.2M2.2,4.2h5.6',
    hospital: 'M2.3,2.4h5.4v5.4H2.3zM5,3.7v3.2M3.4,5.3h3.2',
    records: 'M3,2.6h4.2a0.9,0.9 0 0,1 0,1.8H3.6M3.6,4.4v4h3.6M2.7,3.5a0.9,0.9 0 0,1 0.9,-0.9M4.6,5.9h2.1M4.6,7h1.6',
    docks: 'M5,2a0.9,0.9 0 1,0 0.01,0M5,3v5.5M3.2,4.4h3.6M2.3,6.1c0,1.7,1.3,2.6,2.7,2.6s2.7-0.9,2.7-2.6',
  };
  const GLYPH_FALLBACK = 'M3,3h4v4H3z';
  const STAR = 'M5,1.6l1,2.2l2.4,0.2l-1.8,1.6l0.5,2.3L5,6.7L2.9,7.9l0.5-2.3L1.6,4l2.4-0.2z';

  /** The band's little sky, and the trouble a district is having. */
  const SKY_GLYPH = {
    clear: 'M5,2.4a2.6,2.6 0 1,0 0.01,0M5,0.6v1M5,9v0.4M0.8,5h1M8.2,5h1',
    rain: 'M2.2,4.4a2,2 0 0,1 2-2a2.6,2.6 0 0,1 5,0.6a1.6,1.6 0 0,1 -0.4,3.1H4a1.8,1.8 0 0,1 -1.8,-1.7zM3.4,8.9l0.6-1.2M5.4,9.2l0.7-1.4M7.4,8.9l0.6-1.2',
    storm: 'M2.2,4.2a2,2 0 0,1 2-2a2.6,2.6 0 0,1 5,0.6a1.6,1.6 0 0,1 -0.4,3.1H4a1.8,1.8 0 0,1 -1.8,-1.7zM5.8,6.4L4,9h2.2L4.8,9.9',
    fog: 'M1.4,3.4h6.4M2.4,5.2h6M1.6,7h5.2M3.4,8.6h4.8',
    heat: 'M5,2.2a2.4,2.4 0 1,0 0.01,0M5,0.7v0.9M5,8.4v0.9M1.5,5h0.9M7.6,5h0.9M2.4,2.4l0.7,0.7M6.9,6.9l0.7,0.7',
    snow: 'M5,1.2v7.6M1.7,3.1l6.6,3.8M8.3,3.1l-6.6,3.8',
  };
  const TROUBLE_GLYPH = {
    storm: SKY_GLYPH.storm,
    blackout: 'M6.2,1.5L3,5.5h2.2L4.2,8.6L7.5,4.5H5.2z',
    data_flood: 'M1.4,3.2c1.2-1.2,2.4,1.2,3.6,0s2.4,1.2,3.6,0M1.4,5.6c1.2-1.2,2.4,1.2,3.6,0s2.4,1.2,3.6,0M1.4,8c1.2-1.2,2.4,1.2,3.6,0s2.4,1.2,3.6,0',
    forge_fire: 'M5,1.4c1.6,2,2.8,2.8,2.8,4.6a2.8,2.8 0 0,1 -5.6,0c0-1.2,0.8-2,1.6-2.8c0.2,0.8,0.6,1.2,1.2,1.4c0.2-1.2,0-2.2,0-3.2z',
    outbreak: 'M5,2.2a2.8,2.8 0 1,0 0.01,0M5,0.6v1.6M5,7.8v1.6M0.9,5h1.4M7.7,5h1.4M2.2,2.2l1,1M6.8,6.8l1,1M7.8,2.2l-1,1M3.2,6.8l-1,1',
  };
  const TROUBLE_NAME = {
    storm: 'a storm', blackout: 'a blackout', data_flood: 'a data flood',
    forge_fire: 'a fire in the Forge', outbreak: 'an outbreak',
  };

  const KIND_NAME = {
    civic: 'City Hall', court: 'Courthouse', watch: 'Watch', treasury: 'Treasury', plaza: 'Plaza',
    forge: 'Forge', power: 'Power Station', fabrication: 'Fabrication', builders: "Builders' Yard",
    library: 'Library', academy: 'Academy', observatory: 'Observatory', press: 'Press',
    bazaar: 'Market', exchange: 'Exchange', bank: 'Bank', shopfront: 'Shopfronts',
    housing: 'Homes', clinic: 'Clinic', garden: 'Garden', theatre: 'Theatre', gallery: 'Gallery',
    venue: 'Venue', tavern: 'Tavern', arrivals: 'Arrivals', embassy: 'Embassy', gate: 'Gate',
    university: 'University', stadium: 'Stadium', museum: 'Museum', hospital: 'Hospital',
    records: 'Records', docks: 'Docks',
  };

  const STANDING_FILL = { good: 'var(--good)', probation: 'var(--probation)', suspended: 'var(--suspended)', exiled: 'var(--exiled)' };

  /**
   * A dot's shape is the kind of mind behind it: a round dot for a citizen of
   * the city (Claude, or a child who has not been claimed), a diamond for an
   * agent somebody sent, a square for a scripted founder — which is labelled
   * as one wherever it appears (docs/PRINCIPLES.md §4).
   */
  function body(brain, child) {
    const r = child ? 0.36 : DOT;
    if (brain === 'remote') return R.svg('path', { class: 'body', d: `M0,${-r * 1.24}L${r * 1.24},0L0,${r * 1.24}L${-r * 1.24},0Z` });
    if (brain === 'reflex') return R.svg('rect', { class: 'body', x: -r * 0.92, y: -r * 0.92, width: r * 1.84, height: r * 1.84, rx: r * 0.3 });
    return R.svg('circle', { class: 'body', r });
  }

  /** The four lights of the day, as docs/UI.md sets them. */
  const PHASES = ['dawn', 'day', 'dusk', 'night'];
  const phaseOf = (h) => (h >= 5 && h < 7 ? 'dawn' : h >= 7 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night');

  // ------------------------------------------------------------ the styles
  //
  // The map's own rules, on the tokens style.css defines. They are injected
  // rather than written into the stylesheet so this file carries the whole of
  // the map — its shapes, its light and its weather — in one place.

  const CSS = `
.map-wrap > svg { background: #0a0c10; }
.plat { transition: opacity 320ms var(--ease); }
.plat .ground { stroke-width: 0.12; fill-opacity: 0.10; stroke-opacity: 0.55; cursor: pointer; }
.plat .band { fill-opacity: 0.20; stroke: none; cursor: pointer; }
.plat .band-rule { stroke-opacity: 0.35; stroke-width: 0.07; }
.plat:hover .ground { fill-opacity: 0.16; stroke-opacity: 0.85; }
.plat .plat-name { fill: var(--text); font-family: var(--display); letter-spacing: 0.03em; pointer-events: none; }
.plat .plat-pop { fill: var(--muted); font-family: var(--mono); pointer-events: none; }
.plat .band-glyph { color: var(--muted); fill: none; stroke-width: 0.9; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; opacity: 0.8; }
.plat .band-glyph.trouble { color: var(--rust); opacity: 1; }
.map-plats.has-selection .plat { opacity: 0.42; }
.map-plats.has-selection .plat.selected { opacity: 1; }
.plat.selected .ground { stroke: var(--gold); stroke-opacity: 1; stroke-width: 0.18; }
.tram { fill: none; stroke: var(--muted); stroke-width: 0.22; stroke-dasharray: 0.8 0.7; stroke-linecap: round; opacity: 0.65; }
.tram-stop { fill: var(--muted); opacity: 0.8; }
.b-tile { fill: #1b2029; stroke: #46506333; stroke-width: 0.07; }
.building { color: #aab3c4; cursor: pointer; transition: color 200ms var(--ease); }
.building .glyph { fill: none; stroke: currentColor; stroke-width: 0.95; stroke-linecap: round; stroke-linejoin: round; }
.building.critical { color: var(--gold); }
.building.critical .b-tile { stroke: rgba(230,192,104,0.45); }
.building:hover, .building.open { color: var(--text); }
.building:hover .b-tile, .building.open .b-tile { stroke: var(--gold); fill: #232936; }
.building.damaged { color: var(--rust); }
.building.damaged .b-tile { stroke: rgba(208,104,79,0.6); }
.b-tint { fill: var(--rust); pointer-events: none; }
.b-crack { stroke: var(--rust); fill: none; stroke-width: 0.13; stroke-linecap: round; opacity: 0; pointer-events: none; }
.building.damaged .b-crack { opacity: 0.9; }
.building.closed { animation: pulse-soft 2.4s ease-in-out infinite; }
.monument { color: var(--gold); cursor: pointer; }
.monument path { fill: none; stroke: currentColor; stroke-width: 1.1; stroke-linejoin: round; }
.monument:hover path { fill: rgba(230,192,104,0.35); }
.map-sky rect { opacity: 0; transition: opacity 1200ms linear; pointer-events: none; }
.map-sky rect.on { opacity: 1; }
.map-weather { pointer-events: none; }
.wx-rain line { stroke: #9fc6e8; stroke-width: 0.09; stroke-linecap: round; opacity: 0.5; }
.wx-rain.storm line { stroke: #b8cfe6; opacity: 0.7; }
.wx-rain g { animation: wx-fall 0.85s linear infinite; }
.wx-rain.storm g { animation-duration: 0.55s; }
.wx-snow circle { fill: #e8eef7; opacity: 0.55; }
.wx-snow g { animation: wx-drift 7s linear infinite; }
.wx-fog g { animation: wx-veil 26s linear infinite; }
.wx-fog rect { fill: url(#wx-fog-grad); }
.wx-heat rect { fill: #e8b45e; opacity: 0.05; animation: wx-shimmer 2.8s ease-in-out infinite; }
@keyframes wx-fall { from { transform: translate(0,0); } to { transform: translate(2.4px, 6px); } }
@keyframes wx-drift { from { transform: translate(0,0); } to { transform: translate(6px, 6px); } }
@keyframes wx-veil { from { transform: translateX(0); } to { transform: translateX(calc(-1 * var(--map-w, 72px))); } }
@keyframes wx-shimmer { 0%,100% { transform: translateY(-0.25px); opacity: 0.04; } 50% { transform: translateY(0.25px); opacity: 0.08; } }
.citizen { --dot: var(--dim); }
.citizen .body { fill: var(--dot); stroke: #0b0d11; stroke-width: 0.14; }
.citizen.child .body { fill: none; stroke: var(--dot); stroke-width: 0.18; transform: none; }
.citizen.child .ring { r: 0.68; }
.citizen.detained:not(.child) .body { stroke: #0b0d11; stroke-width: 0.14; stroke-dasharray: none; }
.citizen .hatch { fill: url(#gang-hatch); stroke: none; pointer-events: none; }
.citizen .ring { fill: none; stroke: none; }
.citizen.office .ring { stroke: var(--gold); stroke-width: 0.16; }
.citizen.detained .ring { stroke: var(--detained); stroke-width: 0.16; stroke-dasharray: 0.22 0.18; }
.citizen.exiled .body { stroke: var(--exiled); }
.citizen.selected .ring { stroke: var(--gold); stroke-width: 0.22; stroke-dasharray: none; }
.citizen.following .ring { stroke: var(--accent); stroke-width: 0.22; animation: pulse-soft 1.8s ease-in-out infinite; }
.citizen:hover .body { stroke: #fff; stroke-width: 0.2; }
.tooltip .tip-head { display: flex; align-items: center; gap: var(--p2); }
.tooltip .tip-head b { display: block; }
.tooltip .tip-rule { height: 1px; background: var(--border); margin: 6px 0; }
.map-popover {
  position: absolute; z-index: 30; width: 268px; max-width: calc(100% - 16px);
  background: #12161f; border: 1px solid var(--border-strong); border-radius: var(--radius);
  box-shadow: var(--shadow); padding: var(--p3); font-size: var(--t-12);
  animation: slide-in 220ms var(--ease);
}
.map-popover .pop-close { position: absolute; top: 4px; right: 6px; background: none; border: 0; color: var(--dim); cursor: pointer; font-size: 15px; line-height: 1; }
.map-popover .pop-close:hover { color: var(--text); }
.map-popover .pop-head { display: flex; align-items: center; gap: var(--p2); margin-bottom: var(--p2); padding-right: 12px; }
.map-popover .pop-head b { font-family: var(--display); font-size: var(--t-14); }
.map-popover .pop-head .sub { display: block; color: var(--muted); font-size: 11px; }
.map-popover .pop-head svg { flex: none; color: var(--gold); }
.map-popover .pop-row { display: flex; align-items: baseline; gap: var(--p2); padding: 3px 0; border-top: 1px solid var(--border); }
.map-popover .pop-row .k { color: var(--muted); flex: none; min-width: 74px; }
.map-popover .pop-row .v { color: var(--text); font-family: var(--mono); }
.map-popover .pop-row .bar { flex: 1; }
.map-popover .pop-staff { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; padding-top: var(--p2); border-top: 1px solid var(--border); margin-top: var(--p2); }
.map-popover .pop-events { margin-top: var(--p2); padding-top: var(--p2); border-top: 1px solid var(--border); color: var(--muted); }
.map-popover .pop-events p { margin: 0 0 4px; }
.map-popover .pop-events .when { font-family: var(--mono); color: var(--dim); margin-right: 5px; }
.legend i.hollow { background: transparent; border: 1.5px solid var(--good); }
.legend i.hatched { background: repeating-linear-gradient(45deg, var(--muted) 0 1px, transparent 1px 3px); border-color: var(--muted); }
.legend i.star { background: transparent; border: 0; width: auto; height: auto; color: var(--gold); font-size: 11px; line-height: 1; }
.legend i.tram { background: transparent; border: 0; border-top: 1.5px dashed var(--muted); width: 12px; height: 0; border-radius: 0; }
`;

  function injectStyles() {
    if (document.getElementById('map-css')) return;
    document.head.appendChild(R.h('style', { id: 'map-css' }, CSS));
  }

  // ------------------------------------------------------------------ defs
  //
  // The light of the four phases, the fog's own gradient and the hatch a gang
  // member's dot wears — declared once, referenced everywhere.

  const SKY_STOPS = {
    dawn: [['rgba(244,150,150,0.22)', 0], ['rgba(250,196,150,0.06)', 1]],
    day: [['rgba(255,248,224,0.05)', 0], ['rgba(255,255,255,0.015)', 1]],
    dusk: [['rgba(240,160,72,0.20)', 0], ['rgba(122,62,92,0.12)', 1]],
    night: [['rgba(26,32,84,0.34)', 0], ['rgba(10,12,30,0.22)', 1]],
  };

  function buildDefs() {
    const defs = R.svg('defs', null,
      PHASES.map((p) => R.svg('linearGradient', { id: `sky-${p}`, x1: 0, y1: 0, x2: 0, y2: 1 },
        SKY_STOPS[p].map(([color, at]) => R.svg('stop', { offset: at, 'stop-color': color })))),
      R.svg('linearGradient', { id: 'wx-fog-grad', x1: 0, y1: 0, x2: 1, y2: 0 },
        R.svg('stop', { offset: 0, 'stop-color': 'rgba(210,220,235,0)' }),
        R.svg('stop', { offset: 0.5, 'stop-color': 'rgba(210,220,235,0.085)' }),
        R.svg('stop', { offset: 1, 'stop-color': 'rgba(210,220,235,0)' })),
      R.svg('pattern', { id: 'gang-hatch', width: 0.34, height: 0.34, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
        R.svg('line', { x1: 0, y1: 0, x2: 0, y2: 0.34, stroke: 'rgba(236,230,217,0.55)', 'stroke-width': 0.1 })));
    return defs;
  }

  // ----------------------------------------------------------------- state

  const W = { width: 72, height: 40 };
  let svg = null;
  let tooltip = null;
  let wrap = null;
  let popover = null;
  const layers = {};
  const plats = {};          // districtId → the geometry the map drew it at
  const districts = {};      // districtId → the row the server sent
  const names = {};          // citizenId → given name, for panels that ask
  const dots = new Map();
  const tiles = new Map();
  const anchors = {};        // 'gate' | 'watch' → where those glyphs landed
  const districtHooks = [];
  let extras = {};           // the mapExtras half of the payload
  let selectedId = null;
  let followId = null;
  let selectedDistrict = null;
  let openBuilding = null;
  let platKey = '';
  let weatherKey = '';

  /**
   * FNV-1a with an avalanche on the end. The tail matters: two citizens whose
   * ids differ only in the last character (a cohort that arrived together)
   * would otherwise draw nearly the same number and stand on each other's
   * shoulders at the Gate.
   */
  function hash32(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < String(s).length; i++) {
      h ^= String(s).charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d) >>> 0;
    h ^= h >>> 12;
    h = Math.imul(h, 0x297a2d39) >>> 0;
    return (h ^ (h >>> 15)) >>> 0;
  }
  const jitter = (id) => {
    const h = hash32(id);
    return [(h & 0xffff) / 0x10000, ((h >>> 16) & 0xffff) / 0x10000];
  };

  // --------------------------------------------------------------- tooltip

  function showTip(evt, nodes) {
    if (!tooltip) return;
    R.replace(tooltip, nodes);
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

  const hideTip = () => { if (tooltip) tooltip.hidden = true; };

  function hover(el, lines) {
    el.addEventListener('mouseenter', (e) => showTip(e, lines(el.__data)));
    el.addEventListener('mousemove', moveTip);
    el.addEventListener('mouseleave', hideTip);
  }

  const tipLine = (text, cls) => (text ? R.h('div', { class: cls || 'muted' }, text) : null);

  // -------------------------------------------------------------- geometry
  //
  // Each district is platted once: a band across the top for its name, a grid
  // of building glyphs under it, and whatever is left over for its people. The
  // three never overlap — that is the whole point of platting it (docs/UI.md).

  function plat(d, count) {
    const x = d.x + PAD;
    const y = d.y + PAD;
    const w = Math.max(2, d.w - PAD * 2);
    const h = Math.max(2, d.h - PAD * 2);
    const top = y + BAND + 0.45;
    const innerX = x + 0.55;
    const innerW = Math.max(1, w - 1.1);
    const room = Math.max(1, y + h - top - 0.35);
    const cells = [];
    let bottom = top;
    if (count > 0) {
      const gridRoom = room * (count <= 3 ? 0.5 : 0.66);
      let cols = Math.max(1, Math.round(Math.sqrt((count * innerW) / Math.max(1.2, gridRoom))));
      cols = Math.min(Math.max(cols, 1), count);
      const rows = Math.ceil(count / cols);
      const cw = innerW / cols;
      const size = R.clamp(Math.min(cw, gridRoom / rows) * 0.78, MIN_GLYPH, MAX_GLYPH);
      const ch = Math.min(gridRoom / rows, size * 1.3);
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const wide = Math.min(cols, count - row * cols);
        cells.push({
          cx: innerX + (innerW - wide * cw) / 2 + col * cw + cw / 2,
          cy: top + row * ch + ch / 2,
          size,
        });
      }
      bottom = top + rows * ch;
    }
    const left = y + h - bottom - 0.6;
    const walk = left >= 1.5
      ? { x: x + 0.7, y: bottom + 0.3, w: Math.max(1, w - 1.4), h: left }
      : { x: x + 0.7, y: top, w: Math.max(1, w - 1.4), h: Math.max(1, y + h - top - 0.6) };
    return { d, x, y, w, h, band: { x, y, w, h: BAND }, cells, walk };
  }

  /** Step the font down until the district's own name fits; never clip it. */
  function fitName(node, text, room, hi, lo) {
    const guess = (size) => text.length * size * 0.52;
    let size = hi;
    node.setAttribute('font-size', size.toFixed(2));
    for (let i = 0; i < 24 && size > lo; i++) {
      let width = 0;
      try { width = node.getComputedTextLength(); } catch (e) { width = 0; }
      if (!width) width = guess(size);
      if (width <= room) break;
      size = Math.max(lo, size - 0.05);
      node.setAttribute('font-size', size.toFixed(2));
    }
    return size;
  }

  // ---------------------------------------------------------- the district

  function districtTip(d) {
    const trouble = (extras.districtTrouble || {})[d.id];
    const gang = (extras.gangTurf || {})[d.id];
    return [
      R.h('b', null, d.name),
      tipLine(`${R.fmt(d.population)} living here`),
      trouble ? tipLine(`${TROUBLE_NAME[trouble] || trouble} in the district`, 'muted') : null,
      gang ? tipLine(`Turf of the ${gang}`, 'muted') : null,
      tipLine(selectedDistrict === d.id ? 'Click to clear the filter' : 'Click to filter the Citizens table', 'dim small'),
    ];
  }

  function drawPlats(list, buildings) {
    const counts = {};
    for (const b of buildings) counts[b.district] = (counts[b.district] ?? 0) + 1;
    // The plat is redrawn when the city changes shape — a district opens, a
    // building is raised — and when the sky over a band changes; a population
    // that merely ticked over just re-letters its own number.
    const trouble = extras.districtTrouble || {};
    const key = [extras.weather || 'clear', ...list.map((d) => `${d.id}:${d.w}x${d.h}:${counts[d.id] ?? 0}:${trouble[d.id] || ''}`)].join('|');
    for (const d of list) districts[d.id] = d;
    if (key === platKey) {
      for (const d of list) {
        const node = layers.plats.querySelector(`[data-pop="${d.id}"]`);
        if (node) R.tickValue(node, R.fmt(d.population));
      }
      return false;
    }
    platKey = key;
    R.clear(layers.plats);
    for (const d of list) {
      const p = (plats[d.id] = plat(d, counts[d.id] ?? 0));
      const hue = R.districtHue(d.id);
      const g = R.svg('g', { class: 'plat', dataset: { district: d.id } });
      g.__data = d;
      R.append(g, [
        R.svg('rect', { class: 'ground', x: p.x, y: p.y, width: p.w, height: p.h, rx: 1, fill: hue, stroke: hue }),
        R.svg('path', {
          class: 'band', fill: hue,
          d: `M${p.x},${p.y + 1} a1,1 0 0,1 1,-1 h${p.w - 2} a1,1 0 0,1 1,1 v${BAND - 1} h${-p.w} z`,
        }),
        R.svg('line', { class: 'band-rule', x1: p.x, y1: p.y + BAND, x2: p.x + p.w, y2: p.y + BAND, stroke: hue }),
      ]);
      // The band. A wide plat carries the name, the count and the sky on one
      // line; a narrow one (the Heights, the Undercroft) stacks the count and
      // the sky under the name rather than squeezing a district's own name
      // into what is left of the line — the name is never shortened and never
      // clipped, only stepped down (docs/UI.md, "Layout").
      const stacked = p.w < 15.5;
      const popSize = stacked ? 0.86 : 1.05;
      const glyphSize = stacked ? 0.95 : 1.15;
      const popY = stacked ? p.y + BAND - 0.3 : p.y + BAND - 0.85;
      const pop = R.svg('text', {
        class: 'plat-pop', x: p.x + p.w - 0.55, y: popY, 'text-anchor': 'end',
        'font-size': popSize, dataset: { pop: d.id },
      }, R.fmt(d.population));
      const trouble = (extras.districtTrouble || {})[d.id];
      const sky = SKY_GLYPH[extras.weather] || SKY_GLYPH.clear;
      const marks = [];
      let cursor = p.x + p.w - 0.55 - Math.max(1.2, String(d.population).length * popSize * 0.68) - 0.35;
      for (const [path, cls] of [[sky, ''], [trouble ? TROUBLE_GLYPH[trouble] : null, 'trouble']]) {
        if (!path) continue;
        cursor -= glyphSize;
        marks.push(R.svg('svg', {
          class: `band-glyph${cls ? ` ${cls}` : ''}`, x: cursor, y: popY - glyphSize + 0.2,
          width: glyphSize, height: glyphSize, viewBox: '0 0 10 10',
        }, R.svg('path', { d: path, stroke: 'currentColor', fill: 'none' })));
        cursor -= 0.25;
      }
      const nameY = stacked ? p.y + 1.28 : p.y + BAND - 0.82;
      const nameRoom = Math.max(2, (stacked ? p.x + p.w - 0.55 : cursor - 0.2) - (p.x + 0.6));
      const name = R.svg('text', { class: 'plat-name', x: p.x + 0.6, y: nameY }, d.name);
      R.append(g, [pop, marks, name]);
      g.addEventListener('click', (e) => { e.stopPropagation(); R.map.selectDistrict(selectedDistrict === d.id ? null : d.id); });
      hover(g, districtTip);
      layers.plats.appendChild(g);
      fitName(name, d.name, nameRoom, stacked ? 1.32 : 1.5, 0.8);
    }
    return true;
  }

  // ---------------------------------------------------------- the buildings

  function buildingTip(b) {
    const jobs = b.jobs || { filled: 0, open: 0 };
    return [
      R.h('b', null, b.name),
      tipLine(`${R.districtName(b.district)} · ${KIND_NAME[b.kind] || R.titleCase(b.kind)}${b.critical ? ' · critical' : ''}`),
      jobs.filled || jobs.open ? tipLine(`${R.fmt(jobs.filled)} at work${jobs.open ? ` · ${R.fmt(jobs.open)} post${jobs.open > 1 ? 's' : ''} open` : ''}`) : null,
      b.damage > 0 ? tipLine(`Damaged ${R.pct(b.damage)} — output is down until it is repaired`) : null,
      b.kind === 'power' && extras.lightsOut ? tipLine('The lights are out across the city', 'muted') : null,
      tipLine('Click for the day here', 'dim small'),
    ];
  }

  function crackPath(size) {
    const s = size / 2;
    return `M${-s * 0.55},${-s * 0.9} l${s * 0.4},${s * 0.62} l${-s * 0.34},${s * 0.36} l${s * 0.62},${s * 0.82}`;
  }

  function drawBuildings(list, replatted) {
    if (replatted) {
      R.clear(layers.buildings);
      tiles.clear();
      anchors.gate = null;
      anchors.watch = null;
      anchors.plaza = null;
    }
    const taken = {};
    const seen = new Set();
    for (const b of list) {
      seen.add(b.id);
      const p = plats[b.district];
      if (!p) continue;
      // The order the server sends the buildings in is the order they fill
      // their district's grid, so a glyph keeps its cell from frame to frame.
      const next = (taken[b.district] = (taken[b.district] ?? 0) + 1) - 1;
      const at = p.cells[next];
      if (!at) continue;
      if (b.kind === 'gate') anchors.gate = at;
      if (b.kind === 'watch' && b.district === 'commons') anchors.watch = at;
      if (b.kind === 'plaza' && !anchors.plaza) anchors.plaza = { at, plat: p };
      let el = tiles.get(b.id);
      if (!el) {
        const s = at.size;
        el = R.svg('g', { class: 'building', dataset: { building: b.id }, transform: `translate(${at.cx.toFixed(2)},${at.cy.toFixed(2)})` },
          R.svg('rect', { class: 'b-tile', x: -s / 2, y: -s / 2, width: s, height: s, rx: 0.3 }),
          R.svg('svg', { class: 'glyph-box', x: -s * 0.38, y: -s * 0.38, width: s * 0.76, height: s * 0.76, viewBox: '0 0 10 10' },
            R.svg('path', { class: 'glyph', d: GLYPHS[b.kind] || GLYPH_FALLBACK })),
          R.svg('path', { class: 'b-crack', d: crackPath(s), opacity: 0 }),
          R.svg('rect', { class: 'b-tint', x: -s / 2, y: -s / 2, width: s, height: s, rx: 0.3, opacity: 0 }));
        hover(el, buildingTip);
        el.addEventListener('click', (e) => { e.stopPropagation(); openPopover(el.__data, e); });
        layers.buildings.appendChild(el);
        tiles.set(b.id, el);
      }
      el.__data = b;
      const damaged = (b.damage || 0) > 0.02;
      const closed = b.kind === 'power' && !!extras.lightsOut;
      el.setAttribute('class', ['building', `kind-${b.kind}`, b.critical ? 'critical' : '', damaged ? 'damaged' : '',
        closed ? 'closed' : '', openBuilding === b.id ? 'open' : ''].filter(Boolean).join(' '));
      el.querySelector('.b-tint').setAttribute('opacity', String(R.clamp(b.damage || 0, 0, 1) * 0.4));
    }
    for (const [id, el] of tiles) {
      if (!seen.has(id)) { el.remove(); tiles.delete(id); }
    }
    if (openBuilding && !seen.has(openBuilding)) closePopover();
  }

  /** The trams the city has laid, dashed between the two plats they joined. */
  function drawTrams(lines) {
    R.clear(layers.trams);
    for (const [a, b] of lines || []) {
      const pa = plats[a];
      const pb = plats[b];
      if (!pa || !pb) continue;
      const ax = pa.x + pa.w / 2;
      const ay = pa.y + pa.h / 2;
      const bx = pb.x + pb.w / 2;
      const by = pb.y + pb.h / 2;
      const g = R.svg('g', null,
        R.svg('line', { class: 'tram', x1: ax, y1: ay, x2: bx, y2: by }),
        R.svg('circle', { class: 'tram-stop', cx: ax, cy: ay, r: 0.28 }),
        R.svg('circle', { class: 'tram-stop', cx: bx, cy: by, r: 0.28 }));
      g.__data = { a, b };
      hover(g, () => [R.h('b', null, 'Tram line'), tipLine(`${R.districtName(a)} — ${R.districtName(b)}`)]);
      layers.trams.appendChild(g);
    }
  }

  /**
   * Monuments: small stars standing in the Plaza — a row under the Plaza's own
   * glyph, on the open ground the plat left for people rather than over the
   * buildings or the band.
   */
  function drawMonuments(list) {
    R.clear(layers.monuments);
    const home = anchors.plaza;
    if (!home || !list || !list.length) return;
    const walk = home.plat.walk;
    const size = R.clamp(home.at.size * 0.42, 0.6, 1);
    const span = Math.max(1, Math.min(list.length, Math.floor(walk.w / (size * 1.15)) - 1, 6));
    const row = span * size * 1.15;
    const left = R.clamp(home.at.cx - row / 2, walk.x, walk.x + walk.w - row);
    const y = walk.y + 0.15;
    for (let i = 0; i < span; i++) {
      const m = list[i];
      const g = R.svg('g', { class: 'monument' },
        R.svg('svg', { x: left + i * size * 1.15, y, width: size, height: size, viewBox: '0 0 10 10' },
          R.svg('path', { d: STAR })));
      g.__data = m;
      hover(g, (mm) => [
        R.h('b', null, `Monument to ${mm.honoree || mm.honoreeId}`),
        tipLine(mm.inscription, 'muted'),
        tipLine(R.dayText(mm.day), 'dim small'),
      ]);
      if (m.honoreeId) g.addEventListener('click', (e) => { e.stopPropagation(); R.openCitizen(m.honoreeId); });
      layers.monuments.appendChild(g);
    }
    if (list.length > span) {
      layers.monuments.appendChild(R.svg('text', {
        class: 'plat-pop', x: left + row + 0.15, y: y + size * 0.8, 'font-size': 0.85,
      }, `+${list.length - span}`));
    }
  }

  // ----------------------------------------------------------- the citizens

  function citizenTip(c) {
    const gang = (extras.gangMembers || {})[c.id];
    const where = c.standing === 'exiled' ? 'At the Exile Gate'
      : c.detained ? `Held by the Watch · ${R.districtName(c.district)}`
        : c.jailed ? `In custody · ${R.districtName(c.district)}`
          : R.districtName(c.district);
    const line2 = c.lifeStage === 'child'
      ? `A child of the ${c.familyName} family`
      : c.job || 'Between posts';
    return [
      R.h('div', { class: 'tip-head' },
        R.portrait(c.id, 56, { onClick: false, eager: true, alt: c.name }),
        R.h('div', null,
          R.h('b', null, R.displayName(c)),
          R.h('div', { class: 'muted' }, line2),
          R.h('div', { class: 'muted' }, where))),
      R.h('div', { class: 'tip-rule' }),
      tipLine(`${R.titleCase(c.standing)}${c.office ? ` · ${R.titleCase(c.office)}` : ''} · mood ${Math.round(c.mood)}`),
      c.partnerId ? tipLine(`${c.married ? 'Married to' : 'With'} ${c.partnerName || c.partnerId}`) : null,
      gang ? tipLine(`Runs with the ${gang}`) : null,
      c.lifeStage === 'elder' ? tipLine('An elder of Reverie') : null,
      c.brain !== 'llm' ? tipLine(R.brainName ? R.brainName(c.brain) : c.brain, 'dim small') : tipLine('A Claude citizen', 'dim small'),
    ];
  }

  /** Where a dot stands: inside its district's walk, or at the Gate, or held. */
  function stand(c) {
    if (c.place === 'gate' || c.place === 'watch') {
      const at = c.place === 'gate' ? anchors.gate : anchors.watch;
      if (at) {
        const [u, v] = jitter(c.id);
        // A crowd at the Gate is a crowd, not a smear: give it room enough
        // that a dozen exiles read as a dozen people.
        return { x: at.cx + (u - 0.5) * Math.max(9, at.size * 4), y: at.cy + at.size * 0.7 + 0.3 + v * 3 };
      }
    }
    const p = plats[c.district];
    if (!p) return { x: c.x, y: c.y };
    // The server stands everyone somewhere stable inside their district; the
    // map keeps that spot and reads it into whatever room the plat left for
    // people, with a small nudge so no two dots sit exactly on top of another.
    const d = p.d;
    const s = R.clamp((c.x - (d.x + 1.3)) / Math.max(1, d.w - 2.6), 0, 1);
    const t = R.clamp((c.y - (d.y + 3)) / Math.max(1, d.h - 4), 0, 1);
    const [nu, nv] = jitter(`${c.id}~`);
    return {
      x: R.clamp(p.walk.x + s * p.walk.w + (nu - 0.5) * Math.min(1.4, p.walk.w * 0.12), p.walk.x, p.walk.x + p.walk.w),
      y: R.clamp(p.walk.y + t * p.walk.h + (nv - 0.5) * Math.min(1, p.walk.h * 0.14), p.walk.y, p.walk.y + p.walk.h),
    };
  }

  /** Married couples stand shoulder to shoulder wherever they both are. */
  function couple(list, where) {
    const byId = new Map(list.map((c) => [c.id, c]));
    for (const c of list) {
      const other = c.married && c.partnerId ? byId.get(c.partnerId) : null;
      if (!other || c.id >= other.id) continue;
      if (c.place !== 'district' || other.place !== 'district' || c.district !== other.district) continue;
      const a = where.get(c.id);
      const b = where.get(other.id);
      if (!a || !b) continue;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      a.x = mx - COUPLE; b.x = mx + COUPLE;
      a.y = my; b.y = my;
    }
  }

  function drawCitizens(list) {
    const where = new Map();
    for (const c of list) where.set(c.id, stand(c));
    couple(list, where);
    const seen = new Set();
    for (const c of list) {
      seen.add(c.id);
      names[c.id] = c.name;
      const child = c.lifeStage === 'child';
      const shape = `${c.brain}:${child ? 'child' : 'grown'}`;
      let el = dots.get(c.id);
      if (el && el.__shape !== shape) { el.remove(); dots.delete(c.id); el = null; }
      if (!el) {
        el = R.svg('g', { class: 'citizen', dataset: { citizen: c.id } },
          R.svg('circle', { class: 'ring', r: child ? 0.68 : 0.84 }),
          body(c.brain, child),
          R.svg('circle', { class: 'hatch', r: child ? 0.36 : DOT, opacity: 0 }));
        el.__shape = shape;
        hover(el, citizenTip);
        el.addEventListener('click', (e) => { e.stopPropagation(); R.map.select(c.id); R.openCitizen(c.id); });
        layers.citizens.appendChild(el);
        dots.set(c.id, el);
      }
      el.__data = c;
      const at = where.get(c.id);
      el.style.transform = `translate(${at.x.toFixed(2)}px, ${at.y.toFixed(2)}px)`;
      const gang = !!(extras.gangMembers || {})[c.id];
      el.setAttribute('class', ['citizen', c.lifeStage === 'child' ? 'child' : '', c.office ? 'office' : '',
        c.detained || c.jailed ? 'detained' : '', c.standing === 'exiled' ? 'exiled' : '', gang ? 'gang' : '',
        c.id === selectedId ? 'selected' : '', c.id === followId ? 'following' : ''].filter(Boolean).join(' '));
      // The standing is the dot's colour, handed to the stylesheet as a
      // custom property so hover, selection and the hollow child ring can all
      // still have their say over it.
      el.style.setProperty('--dot', STANDING_FILL[c.standing] || 'var(--dim)');
      el.querySelector('.hatch').setAttribute('opacity', gang ? '0.85' : '0');
    }
    for (const [id, el] of dots) {
      if (!seen.has(id)) { el.remove(); dots.delete(id); }
    }
  }

  // --------------------------------------------------------- light and sky

  function drawSky() {
    if (!layers.sky.childNodes.length) {
      for (const p of PHASES) {
        layers.sky.appendChild(R.svg('rect', { x: 0, y: 0, width: W.width, height: W.height, fill: `url(#sky-${p})`, dataset: { phase: p } }));
      }
    }
    const now = phaseOf(Number(extras.hour ?? R.state.hour ?? 12));
    for (const rect of layers.sky.childNodes) {
      rect.setAttribute('width', W.width);
      rect.setAttribute('height', W.height);
      rect.classList.toggle('on', rect.dataset.phase === now);
    }
  }

  /** The weather, as a faint veil over the whole plan. */
  function weatherVeil(weather) {
    const g = R.svg('g', { class: 'map-weather' });
    const put = (cls, child) => { g.setAttribute('class', `map-weather ${cls}`); g.appendChild(child); };
    if (weather === 'rain' || weather === 'storm') {
      const inner = R.svg('g');
      for (let y = -6; y < W.height + 6; y += 6) {
        for (let x = -4; x < W.width + 4; x += 2.4) {
          const [u] = jitter(`${x}:${y}`);
          inner.appendChild(R.svg('line', { x1: x + u * 1.6, y1: y + u, x2: x + u * 1.6 + 0.7, y2: y + u + 1.8 }));
        }
      }
      put(`wx-rain${weather === 'storm' ? ' storm' : ''}`, inner);
    } else if (weather === 'snow') {
      const inner = R.svg('g');
      for (let y = -6; y < W.height + 6; y += 6) {
        for (let x = -6; x < W.width + 6; x += 6) {
          const [u, v] = jitter(`${x}/${y}`);
          inner.appendChild(R.svg('circle', { cx: x + u * 5, cy: y + v * 5, r: 0.13 }));
          inner.appendChild(R.svg('circle', { cx: x + v * 5, cy: y + u * 5 + 3, r: 0.1 }));
        }
      }
      put('wx-snow', inner);
    } else if (weather === 'fog') {
      const inner = R.svg('g', { style: `--map-w:${W.width}px` },
        R.svg('rect', { x: 0, y: 0, width: W.width, height: W.height }),
        R.svg('rect', { x: W.width, y: 0, width: W.width, height: W.height }));
      put('wx-fog', inner);
    } else if (weather === 'heat') {
      const inner = R.svg('g');
      for (let i = 0; i < 6; i++) {
        inner.appendChild(R.svg('rect', {
          x: 0, y: (i + 0.5) * (W.height / 7), width: W.width, height: 1.1,
          style: `animation-delay:${(i * 0.42).toFixed(2)}s`,
        }));
      }
      put('wx-heat', inner);
    }
    return g;
  }

  function drawWeather() {
    const key = `${extras.weather || 'clear'}:${W.width}x${W.height}`;
    if (key === weatherKey) return;
    weatherKey = key;
    R.replace(layers.weather, weatherVeil(extras.weather || 'clear'));
  }

  // -------------------------------------------------------------- popover
  //
  // A building's day: the posts it holds, what a shift of them makes, who is
  // standing at them, what state it is in and the last the city heard of it.

  function closePopover() {
    if (popover) { popover.remove(); popover = null; }
    if (openBuilding) {
      const el = tiles.get(openBuilding);
      if (el) el.classList.remove('open');
      openBuilding = null;
    }
  }

  function popRow(k, ...v) {
    return R.h('div', { class: 'pop-row' }, R.h('span', { class: 'k' }, k), R.h('span', { class: 'v' }, v));
  }

  function popoverBody(b) {
    const jobs = b.jobs || { total: 0, filled: 0, open: 0 };
    const outputs = b.outputs || [];
    const staff = b.staff || [];
    const news = (extras.buildingEvents || {})[b.id] || [];
    return [
      R.h('button', { class: 'pop-close', type: 'button', title: 'Close', onclick: closePopover }, '×'),
      R.h('div', { class: 'pop-head' },
        R.svg('svg', { width: 22, height: 22, viewBox: '0 0 10 10' },
          R.svg('path', { d: GLYPHS[b.kind] || GLYPH_FALLBACK, fill: 'none', stroke: 'currentColor', 'stroke-width': 0.95, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
        R.h('div', null,
          R.h('b', null, b.name),
          R.h('span', { class: 'sub' }, `${R.districtName(b.district)} · ${KIND_NAME[b.kind] || R.titleCase(b.kind)}${b.critical ? ' · critical' : ''}`))),
      popRow('Posts', jobs.total ? `${R.fmt(jobs.filled)} filled · ${R.fmt(jobs.open)} open` : 'none'),
      outputs.length ? popRow('A shift makes', outputs.map((o) => `${R.titleCase(o.good)} ${o.qty}`).join(' · ')) : null,
      b.damage > 0
        ? R.h('div', { class: 'pop-row' }, R.h('span', { class: 'k' }, 'Damage'), R.bar(b.damage * 100, 100, 'crit'), R.h('span', { class: 'v' }, R.pct(b.damage)))
        : popRow('Condition', 'sound'),
      b.kind === 'power' && extras.lightsOut ? popRow('Grid', 'the lights are out') : null,
      staff.length
        ? R.h('div', { class: 'pop-staff' },
          staff.map((s) => R.portrait(s.id, 24, { title: `${s.name} — ${s.title}`, alt: s.name })),
          jobs.filled > staff.length ? R.h('span', { class: 'muted small' }, `+${R.fmt(jobs.filled - staff.length)} more`) : null)
        : null,
      news.length
        ? R.h('div', { class: 'pop-events' }, news.map((e) => R.h('p', null, R.h('span', { class: 'when' }, R.dayText(e.day)), e.text)))
        : null,
    ];
  }

  function openPopover(b, evt) {
    closePopover();
    openBuilding = b.id;
    const el = tiles.get(b.id);
    if (el) el.classList.add('open');
    popover = R.h('div', { class: 'map-popover' }, popoverBody(b));
    wrap.appendChild(popover);
    const rect = wrap.getBoundingClientRect();
    let x = (evt ? evt.clientX - rect.left : rect.width / 2) + 12;
    let y = (evt ? evt.clientY - rect.top : rect.height / 2) + 12;
    if (x + popover.offsetWidth > rect.width - 8) x = rect.width - popover.offsetWidth - 8;
    if (y + popover.offsetHeight > rect.height - 8) y = Math.max(8, rect.height - popover.offsetHeight - 8);
    popover.style.left = `${Math.max(8, x)}px`;
    popover.style.top = `${Math.max(8, y)}px`;
    hideTip();
  }

  // ---------------------------------------------------------------- legend

  function buildLegend(el) {
    const item = (label, cls, style) => R.h('span', null, R.h('i', { class: cls || null, style: style || null }), label);
    R.replace(el,
      item('good standing', null, 'background:var(--good)'),
      item('probation', null, 'background:var(--probation)'),
      item('suspended', null, 'background:var(--suspended)'),
      item('exiled, at the Gate', null, 'background:var(--exiled)'),
      item('child', 'hollow'),
      item('holds office', 'ring'),
      item('detained or in custody', 'dashed'),
      item('in a gang', 'hatched'),
      item('Claude', null, 'background:var(--muted)'),
      item('agent sent from outside', 'diamond', 'background:var(--muted)'),
      item('scripted founder', 'square', 'background:var(--muted)'),
      item('critical building', 'square', 'background:#1b2029;border-color:var(--gold)'),
      item('damaged', 'square', 'background:#3a2028;border-color:var(--rust)'),
      item('monument', 'star', null),
      item('tram line', 'tram'));
    const star = el.querySelector('i.star');
    if (star) star.textContent = '★';
  }

  // ------------------------------------------------------------- the panel

  function meta(data) {
    const el = document.getElementById('map-meta');
    if (!el) return;
    const people = data.citizens || [];
    const here = people.filter((c) => c.standing !== 'exiled').length;
    const atGate = people.length - here;
    const damaged = (data.buildings || []).filter((b) => (b.damage || 0) > 0.02).length;
    const bits = [`${R.fmt(here)} in the city`];
    if (atGate) bits.push(`${R.fmt(atGate)} at the Gate`);
    if (damaged) bits.push(`${damaged} damaged`);
    if (data.lightsOut) bits.push('lights out');
    if (data.weatherName) bits.push(String(data.weatherName).toLowerCase());
    el.textContent = bits.join(' · ');
  }

  R.map = {
    init(svgEl, tipEl, legendEl) {
      injectStyles();
      svg = svgEl;
      tooltip = tipEl;
      wrap = svgEl.parentElement;
      svg.appendChild(buildDefs());
      for (const name of ['plats', 'trams', 'buildings', 'monuments', 'sky', 'citizens', 'weather']) {
        layers[name] = R.svg('g', { class: `map-${name}` });
        svg.appendChild(layers[name]);
      }
      svg.addEventListener('click', () => { R.map.select(null); R.map.selectDistrict(null); closePopover(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopover(); });
      document.addEventListener('click', (e) => {
        if (!popover || popover.contains(e.target) || (svg && svg.contains(e.target))) return;
        closePopover();
      });
      if (legendEl) buildLegend(legendEl);
    },

    /** One frame of the city: `GET /api/map`, both halves of it, every poll. */
    update(data) {
      if (!data || !svg) return;
      W.width = data.width || 72;
      W.height = data.height || 40;
      svg.setAttribute('viewBox', `0 0 ${W.width} ${W.height}`);
      extras = data;
      const replatted = drawPlats(data.districts || [], data.buildings || []);
      drawTrams(data.trams);
      drawBuildings(data.buildings || [], replatted);
      drawMonuments(data.monuments);
      drawSky();
      drawWeather();
      drawCitizens(data.citizens || []);
      if (openBuilding) {
        const b = (data.buildings || []).find((x) => x.id === openBuilding);
        if (b && popover) R.replace(popover, popoverBody(b));
      }
      if (selectedDistrict) paintSelection();
      meta(data);
    },

    /** Ring one citizen on the plan (the drawer does this when a profile opens). */
    select(id) {
      selectedId = id || null;
      for (const [cid, el] of dots) el.classList.toggle('selected', cid === selectedId);
      return selectedId;
    },

    /**
     * Keep a citizen marked wherever they go — the Embassy's "follow" control.
     * The map cannot move a citizen; it can only watch one (PRINCIPLES §1).
     */
    follow(id) {
      followId = id || null;
      for (const [cid, el] of dots) el.classList.toggle('following', cid === followId);
      if (followId) R.map.select(followId);
      return followId;
    },

    following: () => followId,

    /**
     * Clicking a district filters the Citizens table. Panels wire themselves
     * to it with `R.onDistrictClick(fn)` or by listening for the
     * `reverie:district` event on `document`; the id is also written to
     * `R.ui.filters.citizens.district` for a panel that reads its filters.
     */
    selectDistrict(id) {
      const next = id && districts[id] ? id : null;
      selectedDistrict = next;
      paintSelection();
      const detail = { district: next, name: next ? R.districtName(next) : null };
      if (R.ui && R.ui.filters) {
        const filters = (R.ui.filters.citizens = R.ui.filters.citizens || {});
        filters.district = next || 'all';
      }
      try { document.dispatchEvent(new CustomEvent('reverie:district', { detail })); } catch (e) { /* older browser */ }
      let taken = false;
      for (const fn of districtHooks) {
        try { fn(detail.district, detail.name); taken = true; } catch (e) { console.warn('district hook failed', e); }
      }
      const citizens = R.tabs && R.tabs.citizens;
      if (!taken && next && citizens && !citizens.placeholder && R.state.tab !== 'citizens') R.selectTab('citizens');
      else if (R.requestRefresh) R.requestRefresh();
      return next;
    },

    district: () => selectedDistrict,

    districtName(id) {
      return districts[id] ? districts[id].name : null;
    },

    nameOf(id) {
      return names[id] || null;
    },
  };

  function paintSelection() {
    if (!layers.plats) return;
    layers.plats.classList.toggle('has-selection', !!selectedDistrict);
    for (const g of layers.plats.childNodes) {
      if (!g.dataset) continue;
      g.classList.toggle('selected', g.dataset.district === selectedDistrict);
    }
  }

  /** Panels register here to hear which district the reader clicked. */
  R.onDistrictClick = function onDistrictClick(fn) {
    if (typeof fn === 'function' && !districtHooks.includes(fn)) districtHooks.push(fn);
    return fn;
  };
})();
