// Rendering and interaction. The app is four views, one detail sheet, and a toast.

import {
  todayISO, addDays, addInterval, statusOf, bySoonest, relativeDays,
  humanizeInterval, prettyDate, toICS, isISO,
} from './core.js';
import { CATALOG, CATEGORIES, catalogEntry, searchCatalog } from './catalog.js';
import {
  state, makeItem, fromCatalog, hintsFor, load, save,
  exportJSON, importJSON, wipe, hasExamples, clearExamples,
  emptyProduct, hasProduct, rememberCode, recallCode, forgetCode, learnedCount, itemsWithCode,
} from './store.js';
import {
  buildPrompt, normalizeFindings, dueFromRead, prepImage, sampleErrorCopy,
  normalizeNameplate, nameplateHasContent,
} from './vision.js';
import { toEAN13, displayCode, codeOrigin, checksumOK } from './barcode.js';
import { cameraSupport, permissionCopy, startScanner } from './scanner.js';
import { findByPart, findByModel, searchParts, orderLine, partById, PARTS } from './parts.js';
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Downloads are inert inside a sandboxed frame, so the copy panel leads there instead. */
const FRAMED = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const ICON = {
  tag: '<path d="M13.5 3H6a3 3 0 0 0-3 3v7.5a3 3 0 0 0 .88 2.12l5.5 5.5a3 3 0 0 0 4.24 0l6.5-6.5a3 3 0 0 0 0-4.24l-5.5-5.5A3 3 0 0 0 13.5 3Z"/><circle cx="8" cy="8" r="1.25"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8.5v7M8.5 12h7"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  shield: '<path d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 9.5-4.1-1.6-7-5.3-7-9.5V6l7-3Z"/><path d="M9 12l2 2 4-4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.3-4.3"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  barcode: '<path d="M3.5 5.5v13M6.5 5.5v13M10 5.5v13M13.5 5.5v9M17 5.5v13M20.5 5.5v13"/>',
  camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.1a2 2 0 0 0 1.7-.95l.5-.8A2 2 0 0 1 11.5 3.3h1a2 2 0 0 1 1.7.95l.5.8A2 2 0 0 0 16.4 6h1.1A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z"/><circle cx="12" cy="12.5" r="3.2"/>',
};

const svg = (name, cls = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="${cls}" aria-hidden="true">${ICON[name]}</svg>`;

const LEADS = [
  [0, 'on the day'], [3, '3 days before'], [7, 'a week before'], [14, '2 weeks before'],
  [30, 'a month before'], [45, '6 weeks before'], [60, '2 months before'],
  [90, '3 months before'], [180, '6 months before'], [270, '9 months before'],
];
const UNITS = [['day', 'days'], ['week', 'weeks'], ['month', 'months'], ['year', 'years']];

let view = 'due';
let undo = null;
let allFilter = 'active';
let allQuery = '';
let addQuery = '';
let partQuery = '';

// ---------------------------------------------------------------- shared bits

function rows(today) {
  return state.items.map((item) => ({ item, ...statusOf(item, today) }));
}

function subLine(item) {
  const part = item.product?.part;
  if (item.kind === 'interval') {
    const every = humanizeInterval(item.every);
    if (part) return `${every} · ${part}`;
    const last = [...(item.history || [])].reverse().find((h) => h.kind === 'done');
    return last ? `${every} · last done ${prettyDate(last.on)}` : every;
  }
  if (part) return part;
  if (!isISO(item.due)) return 'Needs the date from the label';
  const life = hintsFor(item).life;
  return life ? `${life.n}-${life.unit} life` : 'Expiry date';
}

function rowHTML({ item, state: st, days }) {
  const rel = st === 'nodate' ? 'no date yet' : relativeDays(days);
  return `<button class="row" type="button" data-id="${esc(item.id)}" data-state="${st}">
    <span class="stripe" aria-hidden="true"></span>
    <span class="row-main">
      <span class="row-name">${esc(item.name)}${item.where ? ` <span class="where">· ${esc(item.where)}</span>` : ''}</span>
      <span class="row-sub">${esc(subLine(item))}</span>
    </span>
    <span class="row-when">
      <span class="row-rel">${esc(rel)}</span>
      <span class="row-date">${item.due ? esc(prettyDate(item.due)) : '—'}</span>
    </span>
  </button>`;
}

function groupHTML(title, list, st) {
  if (!list.length) return '';
  return `<section class="group" data-state="${st}">
    <h3 class="group-head">${esc(title)} <span class="n">${list.length}</span></h3>
    <div class="rows">${list.map(rowHTML).join('')}</div>
  </section>`;
}

// ---------------------------------------------------------------- due view

function renderDue() {
  const today = todayISO();
  const all = rows(today).filter((r) => !r.item.archived).sort(bySoonest);
  const overdue = all.filter((r) => r.state === 'overdue');
  const soon = all.filter((r) => r.state === 'soon');
  const nodate = all.filter((r) => r.state === 'nodate');
  const later = all.filter((r) => r.state === 'later');

  let line;
  if (!all.length) {
    line = 'Nothing tracked yet. Open <b>Add</b> and start with Safety — that list is where the surprises are.';
  } else if (overdue.length && soon.length) {
    line = `<em>${overdue.length} ${overdue.length === 1 ? 'thing is' : 'things are'} overdue</em>, and ${soon.length} ${soon.length === 1 ? 'is' : 'are'} coming up.`;
  } else if (overdue.length) {
    line = `<em>${overdue.length} ${overdue.length === 1 ? 'thing is' : 'things are'} overdue.</em>`;
  } else if (soon.length) {
    line = `${soon.length} ${soon.length === 1 ? 'thing is' : 'things are'} coming up.`;
  } else if (later.length) {
    const next = later[0];
    line = `Nothing needs attention. Next is <b>${esc(next.item.name)}</b>, ${esc(relativeDays(next.days))}.`;
  } else {
    line = 'Nothing needs attention.';
  }

  const counts = [
    ['overdue', 'overdue', overdue.length],
    ['soon', 'due soon', soon.length],
    ['nodate', 'need a date', nodate.length],
    ['tracked', 'tracked', all.length],
  ]
    .map(([st, label, n]) => `<li data-state="${st}"><b>${n}</b> ${label}</li>`)
    .join('');

  const notices = [];
  if (!state.storageOK || state.storageNote) {
    notices.push(`<div class="notice" data-tone="warn"><p>${esc(state.storageNote)}</p></div>`);
  }
  if (hasExamples()) {
    notices.push(`<div class="notice"><p><b>These are examples</b> so the list is not blank — the dates are made up.</p>
      <button class="btn btn-sm btn-quiet" data-act="clear-examples" type="button">Clear examples</button></div>`);
  }

  const body = all.length
    ? groupHTML('Overdue', overdue, 'overdue') +
      groupHTML('Due soon', soon, 'soon') +
      groupHTML('Needs a date', nodate, 'nodate') +
      groupHTML('Later', later, 'later')
    : `<div class="empty">${svg('tag')}<p>Add the things you would rather not find out about late.</p>
        <div class="btn-row" style="justify-content:center">
          <button class="btn btn-primary" data-cansee-only data-act="photo" type="button">${svg('camera')} Read a photo</button>
          <button class="btn" data-act="go-add" type="button">Browse what to track</button>
        </div></div>`;

  $('#view-due').innerHTML = `<div class="wrap">
    <div class="view-head"><div class="summary">
      <p class="summary-line">${line}</p>
      <ul class="counts">${counts}</ul>
    </div></div>
    ${notices.join('')}
    ${body}
  </div>`;

  const pip = $('#pip-due');
  const n = overdue.length + soon.length;
  pip.textContent = n ? String(n) : '';
  pip.hidden = !n;
}

// ---------------------------------------------------------------- add view

function renderAdd() {
  const found = searchCatalog(addQuery);
  const ids = new Set(found.map((c) => c.id));
  const groups = CATEGORIES.map((cat) => {
    const list = CATALOG.filter((c) => c.cat === cat.id && ids.has(c.id));
    if (!list.length) return '';
    const open = addQuery ? ' open' : cat.id === 'safety' ? ' open' : '';
    return `<details class="cat"${open}>
      <summary>
        <span class="cat-name">${esc(cat.name)}</span>
        <span class="cat-n">${list.length}</span>
        <p class="cat-blurb">${esc(cat.blurb)}</p>
      </summary>
      <div class="cat-body">${list
        .map(
          (c) => `<button class="pick" type="button" data-pick="${esc(c.id)}">
          <span class="pick-name">${esc(c.name)}</span>
          <span class="pick-every">${esc(c.kind === 'interval' ? humanizeInterval(c.every) : c.life ? `${c.life.n}-${c.life.unit} life` : 'expiry date')}</span>
          <span class="pick-why">${esc(c.why)}</span>
        </button>`
        )
        .join('')}</div>
    </details>`;
  }).join('');

  $('#view-add').innerHTML = `<div class="wrap">
    <div class="view-head">
      <h2>What catches people out</h2>
      <p>${CATALOG.length} things with a real shelf life, each with the interval, where the date is printed, and what being late actually costs. Pick one and answer a single question.</p>
    </div>
    <button class="photo-cta" type="button" data-act="scan">
      ${svg('barcode')}
      <span>
        <b>Scan a barcode</b>
        <small>Decoded on your device, with no lookup service. Tell it what a code is once and that code is exact from then on.</small>
      </span>
    </button>
    <button class="photo-cta" type="button" data-act="plate" data-cansee-only>
      ${svg('camera')}
      <span>
        <b>Read a label or nameplate</b>
        <small>Brand, model and part numbers off a rating plate — then it tells you which filter, pad or cartridge that machine takes.</small>
      </span>
    </button>
    <button class="photo-cta" type="button" data-act="photo" data-cansee-only>
      ${svg('camera')}
      <span>
        <b>Identify from a photo</b>
        <small>Point your camera at a thing — or a whole room — and it will work out what needs tracking and read the date off the label.</small>
      </span>
    </button>
    <div class="search">${svg('search')}
      <label class="sr" for="add-search">Search what to track</label>
      <input type="search" id="add-search" class="searchbox" placeholder="Search — filter, passport, tyres, sponge…" value="${esc(addQuery)}">
    </div>
    ${groups || `<div class="empty"><p>Nothing matches “${esc(addQuery)}”.</p><button class="btn" data-act="custom" type="button">Add it yourself</button></div>`}
    <div class="panel">
      <h3>Something not on the list?</h3>
      <p>Anything with a date works — a bike service, a visa appointment, a plant that needs repotting.</p>
      <button class="btn" data-act="custom" type="button">Add your own</button>
    </div>

    <div class="panel">
      <h3>What does it take?</h3>
      <p>${PARTS.length} consumables with their order numbers, what they fit, and where the number is printed on your own unit. Search a model number or a part code.</p>
      <div class="search">${svg('search')}
        <label class="sr" for="parts-search">Search parts and model numbers</label>
        <input type="search" id="parts-search" class="searchbox" placeholder="WF3CB, FFSS2615TS, 20x25x1, brush head…" value="${esc(partQuery)}">
      </div>
      <div id="parts-out">${partsResultsHTML()}</div>
    </div>
  </div>`;
}

/** Results for the parts search: a model number finds what it takes, a code finds itself. */
function partsResultsHTML() {
  const q = partQuery.trim();
  if (!q) return '<p class="help">Nothing typed yet — try the model number off a nameplate.</p>';
  const hits = [...new Set([...findByPart(q), ...findByModel(q), ...searchParts(q)])].slice(0, 10);
  if (!hits.length) {
    return `<p class="help">No match for “${esc(q)}”. The number printed on the old part is always the reliable answer — this list only covers common consumables.</p>`;
  }
  return hits
    .map(
      (rec) => `<div class="found">
      <p class="order-line"><span class="label">Buy</span><b>${esc(orderLine(rec))}</b>
        <button class="btn-link" type="button" data-copy-text="${esc(rec.parts[0] || rec.names[0] || '')}">Copy</button></p>
      <p class="found-cycle">${esc(rec.what)} · ${esc(rec.brand)} · ${esc(humanizeInterval(rec.every))}</p>
      <p class="found-seen">${esc(rec.where)}</p>
      ${rec.note ? `<p class="found-seen">${esc(rec.note)}</p>` : ''}
      <div class="btn-row" style="margin-top:10px"><button class="btn btn-sm" type="button" data-plate-part="${esc(rec.id)}">Track this</button></div>
    </div>`
    )
    .join('');
}

// ---------------------------------------------------------------- all view

function renderAll() {
  const today = todayISO();
  const q = allQuery.trim().toLowerCase();
  let list = rows(today);
  if (allFilter === 'active') list = list.filter((r) => !r.item.archived);
  if (allFilter === 'nodate') list = list.filter((r) => !r.item.archived && r.state === 'nodate');
  if (allFilter === 'archived') list = list.filter((r) => r.item.archived);
  if (q) list = list.filter((r) => (r.item.name + ' ' + r.item.where + ' ' + r.item.note).toLowerCase().includes(q));
  list.sort(bySoonest);

  const byCat = CATEGORIES.map((cat) => {
    const inCat = list.filter((r) => r.item.cat === cat.id);
    return inCat.length ? groupHTML(cat.name, inCat, 'later') : '';
  }).join('');
  const other = list.filter((r) => !CATEGORIES.some((c) => c.id === r.item.cat));

  const filters = [['active', 'Active'], ['nodate', 'Needs a date'], ['archived', 'Archived']]
    .map(([id, label]) => `<button class="filter" type="button" data-filter="${id}" aria-pressed="${allFilter === id}">${label}</button>`)
    .join('');

  $('#view-all').innerHTML = `<div class="wrap">
    <div class="view-head">
      <h2>Everything you track</h2>
      <p>${state.items.filter((i) => !i.archived).length} active, grouped the way the catalogue groups them.</p>
    </div>
    <div class="search">${svg('search')}
      <label class="sr" for="all-search">Search your list</label>
      <input type="search" id="all-search" class="searchbox" placeholder="Search your list" value="${esc(allQuery)}">
    </div>
    <div class="filters">${filters}</div>
    ${byCat + groupHTML('Other', other, 'later') || `<div class="empty"><p>Nothing here yet.</p></div>`}
  </div>`;
}

// ---------------------------------------------------------------- data view

function renderData() {
  const active = state.items.filter((i) => i.archived !== true);
  const dated = active.filter((i) => isISO(i.due));
  $('#view-data').innerHTML = `<div class="wrap">
    <div class="view-head">
      <h2>Your data, and where it is</h2>
      <p>Your list stays in this browser. There is no account, no server, and no analytics — which also means nobody else is keeping a copy for you.</p>
      <p><b>One exception:</b> if you use <i>Read it from a photo</i>, that photo is sent to Claude on your own account to be read, and what it finds comes back as a suggestion you confirm. Your list is never sent, and the feature is only offered where the host provides it. Everything else here works with the network switched off.</p>
    </div>

    <div class="panel">
      <h3>Put it in your calendar</h3>
      <p>Turns ${dated.length} dated ${dated.length === 1 ? 'item' : 'items'} into a calendar file, with a reminder the right number of days ahead of each one. Repeating upkeep comes through as a repeating event, so the calendar keeps it going on its own.</p>
      <div class="btn-row"><button class="btn btn-primary" data-act="ics" type="button">${svg('check')} Build calendar file</button></div>
      <div id="ics-out" hidden></div>
    </div>

    <div class="panel">
      <h3>Barcodes this device knows</h3>
      <p>${learnedCount() === 0
        ? 'None yet. Scan something, tell it what it is once, and that code is exact from then on — no lookup service involved.'
        : `${learnedCount()} ${learnedCount() === 1 ? 'code' : 'codes'} you have taught it. They travel in the backup below, so a restore brings them with you.`}</p>
    </div>

    <div class="panel">
      <h3>Back it up</h3>
      <p>Clearing your browser data, or a private window closing, takes this list with it. Keep a copy somewhere you trust — a note, a file, an email to yourself.</p>
      <div class="btn-row">
        <button class="btn" data-act="backup" type="button">Show backup</button>
        <button class="btn" data-save-only data-act="backup-dl" type="button">Save a .json file</button>
      </div>
      <div id="backup-out" hidden></div>
    </div>

    <div class="panel">
      <h3>Restore from a backup</h3>
      <p>Paste a backup here to replace what is currently in this browser.</p>
      <div class="field">
        <label for="restore-in">Backup text</label>
        <textarea id="restore-in" spellcheck="false" placeholder='{ "items": [ … ] }'></textarea>
      </div>
      <div class="btn-row"><button class="btn" data-act="restore" type="button">Replace my list</button></div>
      <p id="restore-msg" class="help"></p>
    </div>

    <div class="panel">
      <h3>Start over</h3>
      <p>Deletes all ${state.items.length} ${state.items.length === 1 ? 'item' : 'items'} from this browser. There is no copy anywhere else, so take a backup first if you might want it.</p>
      <div class="btn-row"><button class="btn btn-danger" data-act="wipe" data-armed="0" type="button">Delete everything</button></div>
    </div>

    <div class="foot">
      <p><b>About the defaults.</b> Every interval in the catalogue is typical manufacturer or public-safety guidance, and every one is editable. Where they disagree, the label on your device and your local rules win — this app's job is to remind you to go and read them.</p>
      <p>Lasts 1.0 · no account, no network calls, no analytics, no ads. Works offline once loaded.</p>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- copy / files

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the old way, which works in more places */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Two ways to hand over a file, because neither works everywhere.
 * Self-hosted, a link saves it. On claude.ai the frame cannot, so the host's
 * downloads capability asks the viewer instead — but its allowlist has no .ics,
 * so a calendar file falls back to the copy panel, which always works.
 */
let saver = null;
let asker = null;
let imageLimits = null;

/**
 * Two host abilities, both optional. Saving a file needs either a link (self-hosted) or the
 * host's downloads capability; reading a photo needs the host's sample capability AND a view
 * that can carry images. Both are advertised through data attributes so the CSS can hide the
 * affordances, and the app is fully usable without either.
 */
function initCapabilities() {
  const root = document.documentElement;
  if (!FRAMED) root.dataset.cansave = 'local';

  Promise.resolve()
    .then(() => window.claude?.use?.('downloads'))
    .then((d) => {
      if (!d) return;
      saver = d;
      if (!root.dataset.cansave) root.dataset.cansave = 'hosted';
    })
    .catch(() => {
      /* no save path; the copy panel covers it */
    });

  Promise.resolve()
    .then(() => window.claude?.use?.('sample'))
    .then(async (fn) => {
      if (!fn) return;
      const limits = await fn.limits().catch(() => null);
      if (!limits?.images) return;
      asker = fn;
      imageLimits = limits.images;
      root.dataset.cansee = '1';
      refresh();
    })
    .catch(() => {
      /* photo reading stays hidden */
    });
}

function linkDownload(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function saveFile(name, text, type) {
  if (saver) {
    try {
      await saver.save({ filename: name, data: text });
      return toast('Saved.');
    } catch (err) {
      if (err?.code === 'declined') return;
      if (err?.code === 'rate_limited') return toast('Try that again in a moment.');
      if (!FRAMED) return linkDownload(name, text, type), toast('File saved.');
      return toast('This page cannot hand you a file — copy the text instead.');
    }
  }
  if (!FRAMED) {
    linkDownload(name, text, type);
    return toast('File saved.');
  }
  toast('This page cannot hand you a file — copy the text instead.');
}

function outputPanel(host, { text, label, note, filename, mime, localOnly }) {
  host.hidden = false;
  host.innerHTML = `<div class="field">
      <label class="field-label" for="${host.id}-ta">${esc(label)}</label>
      <textarea id="${host.id}-ta" readonly spellcheck="false">${esc(text)}</textarea>
      ${note ? `<p class="help">${note}</p>` : ''}
    </div>
    <div class="btn-row">
      <button class="btn btn-primary btn-sm" data-copy="${host.id}-ta" type="button">Copy to clipboard</button>
      <button class="btn btn-sm" ${localOnly ? 'data-save-local' : 'data-save-only'} data-dl="${esc(filename)}" data-mime="${esc(mime)}" data-src="${host.id}-ta" type="button">Save ${esc(filename)}</button>
    </div>`;
}


// ---------------------------------------------------------------- reading a photo

let findings = null;      // the last normalized reply, awaiting confirmation
let photoCtl = null;      // AbortController for the call in flight
let photoURL = null;      // object URL for the preview thumbnail

function releasePhoto() {
  if (photoURL) URL.revokeObjectURL(photoURL);
  photoURL = null;
  photoCtl?.abort();
  photoCtl = null;
  findings = null;
  plate = null;
}

const CONF_LABEL = { high: 'confident', medium: 'fairly sure', low: 'a guess' };

function photoStage(html, foot) {
  const stage = $('#photo-stage');
  if (!stage) return;
  stage.innerHTML = html;
  $('#photo-foot').innerHTML = foot;
}

/** Stage one: ask for the photo, and be straight about where it goes. */
function stagePick(mode, item) {
  const accept = (imageLimits?.mediaTypes || ['image/jpeg', 'image/png']).join(',');
  const tip =
    mode === 'date'
      ? hintsFor(item).where || 'Get the printed date filling as much of the frame as you can.'
      : mode === 'nameplate'
        ? 'The rating plate or sticker — the one with a model number on it. Inside the door, round the back, or under the base.'
        : 'One thing up close, or a whole room to find several at once.';
  photoStage(
    `<p class="help" style="margin-top:14px">${esc(tip)}</p>
     <label class="photo-drop" for="photo-file">
       ${svg('camera')}
       <span class="photo-drop-main">Take or choose a photo</span>
       <span class="photo-drop-sub">Fill the frame with the label. Avoid glare.</span>
     </label>
     <input type="file" id="photo-file" class="sr" accept="${esc(accept)}">
     <p class="callout" style="margin-top:16px"><span class="label">Where this photo goes</span>
       This one feature sends your photo to Claude, on your own account, to be read. It is the only
       thing in this app that leaves your browser — your list never does. Nothing is stored there,
       and nothing is added here until you confirm it.</p>`,
    `<button class="btn btn-quiet" type="button" data-act="close">Cancel</button>`
  );
}

function stageBusy() {
  photoStage(
    `<div class="photo-busy">
       ${photoURL ? `<img src="${esc(photoURL)}" alt="The photo you chose">` : ''}
       <p class="photo-status" id="photo-status">Reading the photo…</p>
       <p class="help">Looking for what it is and any date printed on it. This usually takes a few seconds.</p>
     </div>`,
    `<button class="btn btn-quiet" type="button" data-act="photo-stop">Stop</button>`
  );
}

function stageError(msg) {
  photoStage(
    `<div class="notice" data-tone="warn" style="margin-top:16px"><p>${esc(msg)}</p></div>`,
    `<button class="btn btn-quiet" type="button" data-act="close">Close</button>
     <button class="btn" type="button" data-act="photo-again">Try another photo</button>`
  );
}

/** Stage three: everything the model returned, as a proposal to accept, edit or ignore. */
function stageResults(mode, item) {
  const { items, note } = findings;
  if (!items.length) {
    return stageError(
      note || 'Nothing trackable turned up in that photo. Try getting closer, or add the item by hand.'
    );
  }

  const rows = items
    .map((f, i) => {
      const entry = f.entry;
      const cycle = entry
        ? entry.kind === 'interval'
          ? humanizeInterval(entry.every)
          : entry.life
            ? `${entry.life.n}-${entry.life.unit} life`
            : 'expiry date'
        : 'one-off date';
      const due = dueFromRead(entry, f.date?.kind, f.date?.iso);
      const hint = entry?.where;
      return `<div class="found" data-found="${i}">
        <label class="found-head">
          <input type="checkbox" id="found-${i}" ${f.confidence === 'low' ? '' : 'checked'}>
          <span class="found-name">${esc(f.label)}</span>
          <span class="chip" data-state="${f.confidence === 'high' ? 'later' : f.confidence === 'medium' ? 'soon' : 'overdue'}">${esc(CONF_LABEL[f.confidence])}</span>
        </label>
        ${f.seen ? `<p class="found-seen">Saw: ${esc(f.seen)}</p>` : ''}
        <p class="found-cycle">${esc(entry ? `${entry.name} · ${cycle}` : `Not in the catalogue — tracked as “${f.label}”`)}</p>
        ${f.date
          ? `<p class="found-read">Read <b>${esc(f.date.text || f.date.iso)}</b>${
              f.date.kind ? ` as the ${esc(f.date.kind)} date` : ''
            }${f.date.precision !== 'day' ? `, to the nearest ${esc(f.date.precision)}` : ''}.</p>`
          : `<p class="found-read found-none">No date legible.${hint ? ` ${esc(hint)}` : ''}</p>`}
        <div class="field" style="margin-top:8px">
          <label for="found-date-${i}">${esc(f.date?.kind === 'expiry' || entry?.kind === 'expiry' ? 'Expires' : 'Next due')}</label>
          <input type="date" id="found-date-${i}" value="${esc(due || '')}">
        </div>
      </div>`;
    })
    .join('');

  const one = mode === 'date';
  photoStage(
    `<div class="photo-found">
       ${photoURL ? `<img src="${esc(photoURL)}" alt="The photo you chose">` : ''}
       <p class="help">${esc(
         one
           ? 'Check this against the label before you rely on it.'
           : 'Untick anything wrong, fix any date, then add the rest. Check dates against the label before you rely on them.'
       )}</p>
     </div>
     ${rows}
     ${note ? `<p class="help" style="margin-top:12px">${esc(note)}</p>` : ''}`,
    `<button class="btn btn-quiet" type="button" data-act="photo-again">Another photo</button>
     <button class="btn btn-primary" type="button" data-act="photo-apply">${one ? 'Save date' : 'Add ticked'}</button>`
  );
}

function openPhoto(mode, item) {
  releasePhoto();
  openSheet(`<div data-photo="${esc(mode)}"${item ? ` data-target="${esc(item.id)}"` : ''}>
    <div class="sheet-head">
      <div>
        <h3>${mode === 'date' ? 'Read the date' : mode === 'nameplate' ? 'Read the label' : 'What is this?'}</h3>
        <p class="sub">${esc(
          mode === 'date'
            ? item.name
            : mode === 'nameplate'
              ? 'Brand, model and part numbers'
              : 'Point your camera at a thing or a room'
        )}</p>
      </div>
      <button class="x" type="button" data-act="close" aria-label="Close">✕</button>
    </div>
    <div class="sheet-body"><div id="photo-stage"></div></div>
    <div class="sheet-foot" id="photo-foot"></div>
  </div>`);
  stagePick(mode, item);
}

function photoContext() {
  const holder = sheet().querySelector('[data-photo]');
  if (!holder) return null;
  return { mode: holder.dataset.photo, item: holder.dataset.target ? byId(holder.dataset.target) : null };
}

async function runPhoto(file) {
  const ctx = photoContext();
  if (!ctx || !asker) return;
  const { mode, item } = ctx;

  if (photoURL) URL.revokeObjectURL(photoURL);
  photoURL = URL.createObjectURL(file);
  stageBusy();

  photoCtl = new AbortController();
  try {
    const blob = await prepImage(file, imageLimits);
    const raw = await asker.json(buildPrompt(mode, item), {
      images: blob,
      signal: photoCtl.signal,
      onText: () => {
        const el = $('#photo-status');
        if (el) el.textContent = 'Writing down what it found…';
      },
    });
    if (mode === 'nameplate') {
      plate = normalizeNameplate(raw);
      stageNameplate();
    } else {
      findings = normalizeFindings(raw, mode === 'date' ? 1 : 6);
      stageResults(mode, item);
    }
  } catch (err) {
    if (err?.code === 'cancelled') return closeSheet();
    if (err?.code === 'not_granted' || err?.code === 'sampling_disabled') {
      asker = null;
      document.documentElement.removeAttribute('data-cansee');
      refresh();
    }
    stageError(err?.code ? sampleErrorCopy(err.code) : err?.message || sampleErrorCopy('upstream_error'));
  } finally {
    photoCtl = null;
  }
}

/** Nothing the model said reaches the list until it passes through here. */
function applyFindings() {
  const ctx = photoContext();
  if (!ctx || !findings) return;
  const { mode, item } = ctx;

  if (mode === 'date') {
    const val = $('#found-date-0')?.value;
    if (item && isISO(val)) {
      item.due = val;
      item.history = [...item.history, { on: todayISO(), kind: 'renewed', to: val }];
      item.example = false;
      save();
      closeSheet();
      refresh();
      toast(`Date set — ${prettyDate(val)}.`);
    } else {
      closeSheet();
    }
    return;
  }

  let added = 0;
  findings.items.forEach((f, i) => {
    if (!$(`#found-${i}`)?.checked) return;
    const due = $(`#found-date-${i}`)?.value;
    const made = f.entry
      ? fromCatalog(f.entry, { dontKnow: true })
      : makeItem({ name: f.label, kind: 'expiry', cat: 'home', lead: 30 });
    made.due = isISO(due) ? due : null;
    state.items.push(made);
    added += 1;
  });
  save();
  closeSheet();
  if (!added) return toast('Nothing ticked, so nothing added.');
  switchView('due');
  toast(`Added ${added} ${added === 1 ? 'thing' : 'things'} from the photo.`);
}


// ---------------------------------------------------------------- scanning a barcode

let scanHandle = null;
let plate = null;        // the last nameplate reading, awaiting confirmation

function stopScanner() {
  scanHandle?.stop();
  scanHandle = null;
}

const FORMAT_NAMES = { upc_a: 'UPC-A', upc_e: 'UPC-E', ean_13: 'EAN-13', ean_8: 'EAN-8' };

function scanStage(html, foot) {
  const stage = $('#scan-stage');
  if (!stage) return;
  stage.innerHTML = html;
  $('#scan-foot').innerHTML = foot;
}

function openScanner() {
  const support = cameraSupport();
  openSheet(`<div data-scan="1">
    <div class="sheet-head">
      <div><h3>Scan a barcode</h3><p class="sub">Decoded here on your device</p></div>
      <button class="x" type="button" data-act="close" aria-label="Close">✕</button>
    </div>
    <div class="sheet-body"><div id="scan-stage"></div></div>
    <div class="sheet-foot" id="scan-foot"></div>
  </div>`);

  if (!support.ok) return stageScanBlocked(support.reason);

  scanStage(
    `<div class="scan-view">
       <video id="scan-video" playsinline muted></video>
       <div class="scan-reticle" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
     </div>
     <p class="scan-status" id="scan-status">Starting the camera…</p>
     <p class="help">Hold the barcode so it fills the width of the box. Sideways is fine.</p>`,
    `<button class="btn btn-quiet" type="button" data-act="close">Cancel</button>
     <button class="btn" type="button" data-act="type-code">Type the digits</button>`
  );

  const video = $('#scan-video');
  startScanner(video, {
    onHit: (hit) => {
      stopScanner();
      openCode(hit);
    },
    onStatus: (text) => {
      const el = $('#scan-status');
      if (el) el.textContent = text;
    },
  })
    .then((handle) => {
      scanHandle = handle;
      const el = $('#scan-status');
      if (el) el.textContent = 'Looking for a barcode…';
      if (handle.canTorch) {
        $('#scan-foot').insertAdjacentHTML(
          'afterbegin',
          '<button class="btn btn-quiet" type="button" data-act="torch">Light</button>'
        );
      }
    })
    .catch((err) => stageScanBlocked(permissionCopy(err)));
}

function stageScanBlocked(reason) {
  scanStage(
    `<div class="notice" data-tone="warn" style="margin-top:16px"><p>${esc(reason)}</p></div>
     <p class="help">The digits printed under the barcode work just as well — the check digit is verified either way.</p>`,
    `<button class="btn btn-quiet" type="button" data-act="close">Close</button>
     <button class="btn btn-primary" type="button" data-act="type-code">Type the digits</button>`
  );
}

/** Typing the digits is the universal fallback: no camera, no permission, no https needed. */
function openTypeCode() {
  stopScanner();
  openSheet(`<form id="code-form">
    <div class="sheet-head">
      <div><h3>Type the digits</h3><p class="sub">The number printed under the barcode</p></div>
      <button class="x" type="button" data-act="close" aria-label="Close">✕</button>
    </div>
    <div class="sheet-body">
      <div class="field">
        <label for="code-in">Barcode number</label>
        <input type="text" id="code-in" data-autofocus inputmode="numeric" autocomplete="off"
               spellcheck="false" placeholder="012345678905" class="code-input">
        <p class="help">8, 12 or 13 digits. The last one is a check digit, so a typo is caught rather than looked up.</p>
      </div>
      <p class="help" id="code-msg"></p>
    </div>
    <div class="sheet-foot">
      <button class="btn btn-quiet" type="button" data-act="close">Cancel</button>
      <button class="btn btn-primary" type="submit">Look it up</button>
    </div>
  </form>`);
}

// ---------------------------------------------------------------- what a code turned out to be

/** Candidates for "what is this?", drawn from both knowledge bases at once. */
function pickerHTML(query, prefix) {
  const q = query.trim();
  const cats = (q ? searchCatalog(q) : CATALOG).slice(0, 8);
  const parts = (q ? searchParts(q) : PARTS).slice(0, 8);
  if (!cats.length && !parts.length) {
    return `<p class="help">Nothing matches “${esc(q)}”. Name it yourself below instead.</p>`;
  }
  const partRows = parts
    .map(
      (rec) => `<button class="pick" type="button" data-${prefix}-part="${esc(rec.id)}">
        <span class="pick-name">${esc(rec.what)}</span>
        <span class="pick-every">${esc(rec.parts[0] || rec.names[0] || '')}</span>
        <span class="pick-why">${esc(rec.brand)} · ${esc(humanizeInterval(rec.every))}</span>
      </button>`
    )
    .join('');
  const catRows = cats
    .map(
      (c) => `<button class="pick" type="button" data-${prefix}-cat="${esc(c.id)}">
        <span class="pick-name">${esc(c.name)}</span>
        <span class="pick-every">${esc(c.kind === 'interval' ? humanizeInterval(c.every) : c.life ? `${c.life.n}-${c.life.unit} life` : 'expiry date')}</span>
      </button>`
    )
    .join('');
  return `${parts.length ? `<p class="field-label" style="margin-top:14px">Replacement parts</p>${partRows}` : ''}
          ${cats.length ? `<p class="field-label" style="margin-top:14px">Things to track</p>${catRows}` : ''}`;
}

function openCode(hit) {
  const ean13 = hit.ean13 || toEAN13(hit.code);
  const shown = displayCode(ean13) || hit.code;
  const known = recallCode(ean13);
  const already = itemsWithCode(ean13);
  const origin = codeOrigin(ean13);
  const rec = known?.partId ? partById(known.partId) : null;

  const head = `<div class="sheet-head">
      <div>
        <h3>${esc(known?.name || (already.length ? already[0].name : 'Barcode read'))}</h3>
        <p class="sub"><span class="code-shown">${esc(shown)}</span> · ${esc(FORMAT_NAMES[hit.format] || 'barcode')}${origin ? ` · registered in ${esc(origin)}` : ''}</p>
      </div>
      <button class="x" type="button" data-act="close" aria-label="Close">✕</button>
    </div>`;

  // Already on your list: the most useful answer, and the commonest once the app is in use.
  if (already.length) {
    const item = already[0];
    const st = statusOf(item, todayISO());
    openSheet(`<div data-code="${esc(ean13)}">
      ${head}
      <div class="sheet-body">
        <p class="callout" style="margin-top:14px"><span class="label">You already track this</span>
          ${esc(item.name)}${item.where ? ` · ${esc(item.where)}` : ''} — ${esc(st.state === 'nodate' ? 'no date set yet' : `${item.kind === 'expiry' ? 'expires' : 'due'} ${prettyDate(item.due)}, ${relativeDays(st.days)}`)}</p>
        ${item.product?.part ? `<p class="order-line"><span class="label">Buy</span><b>${esc(item.product.part)}</b></p>` : ''}
        <div class="btn-row" style="margin-top:16px">
          <button class="btn btn-primary" type="button" data-act="code-open" data-id="${esc(item.id)}">Open it</button>
          ${item.kind === 'interval' ? `<button class="btn" type="button" data-act="code-done" data-id="${esc(item.id)}">${svg('check')} Just replaced it</button>` : ''}
        </div>
      </div>
      <div class="sheet-foot"><button class="btn btn-quiet" type="button" data-act="scan-again">Scan another</button></div>
    </div>`);
    return;
  }

  // Taught before, so this is exact — the whole point of the learned map.
  if (known) {
    openSheet(`<div data-code="${esc(ean13)}">
      ${head}
      <div class="sheet-body">
        <p class="callout" style="margin-top:14px"><span class="label">You taught this one</span>
          Saved on this device ${esc(prettyDate(known.at))}. No lookup, no network — just what you told it.</p>
        ${rec ? `<p class="order-line"><span class="label">Buy</span><b>${esc(orderLine(rec))}</b>
          <button class="btn-link" type="button" data-copy-text="${esc(rec.parts[0] || rec.names[0] || '')}">Copy</button></p>
          <p class="help">${esc(rec.where)}</p>` : ''}
        ${known.part && !rec ? `<p class="order-line"><span class="label">Buy</span><b>${esc(known.part)}</b>
          <button class="btn-link" type="button" data-copy-text="${esc(known.part)}">Copy</button></p>` : ''}
      </div>
      <div class="sheet-foot">
        <button class="btn btn-quiet" type="button" data-act="forget-code">Forget</button>
        <button class="btn btn-primary" type="button" data-act="track-known">Track this</button>
      </div>
    </div>`);
    return;
  }

  // Never seen. Say so plainly rather than matching it to something plausible.
  openSheet(`<div data-code="${esc(ean13)}">
    ${head}
    <div class="sheet-body">
      <p class="callout" style="margin-top:14px"><span class="label">Not a product name — yet</span>
        A barcode is only a number. Turning one into a product needs a lookup service, and this app
        does not call out to anything. Tell it what this is once and the code is exact from then on,
        on this device, for good.</p>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn" type="button" data-act="plate" data-cansee-only>${svg('camera')} Read the label instead</button>
      </div>
      <div class="field">
        <label for="code-search">What is it?</label>
        <input type="search" id="code-search" class="searchbox" placeholder="filter, brush head, battery…" autocomplete="off">
      </div>
      <div id="code-picker">${pickerHTML('', 'code')}</div>
      <hr class="sheet-sep">
      <form id="code-name-form">
        <div class="field">
          <label for="code-name">Or just name it</label>
          <input type="text" id="code-name" placeholder="Kitchen tap filter">
        </div>
        <div class="field">
          <label for="code-part">Part number, if the pack shows one</label>
          <input type="text" id="code-part" placeholder="WF3CB" autocomplete="off">
        </div>
        <button class="btn" type="submit">Remember it under that name</button>
      </form>
    </div>
    <div class="sheet-foot"><button class="btn btn-quiet" type="button" data-act="scan-again">Scan another</button></div>
  </div>`);
}

/** Create an item from a picked catalogue entry or part record, and learn the code. */
function trackFromCode(ean13, { entry, rec, name, part }) {
  const made = entry
    ? fromCatalog(entry, { dontKnow: true })
    : makeItem({
        name: rec?.what || name || 'Scanned item',
        cat: rec ? 'home' : 'home',
        kind: 'interval',
        every: rec?.every || { n: 6, unit: 'month' },
        lead: 7,
      });
  made.product = {
    ...emptyProduct(),
    code: displayCode(ean13),
    part: part || rec?.parts?.[0] || '',
    brand: rec?.brand && rec.brand !== 'Any' && rec.brand !== 'Generic' ? rec.brand : '',
  };
  if (rec && !entry) made.note = rec.where;
  if (rec?.every) made.every = rec.every;
  state.items.push(made);
  rememberCode(ean13, {
    name: made.name,
    catalogId: entry?.id || null,
    partId: rec?.id || null,
    brand: made.product.brand,
    part: made.product.part,
  });
  save();
  closeSheet();
  switchView('due');
  toast(`${made.name} added, and this barcode is now remembered.`);
}

// ---------------------------------------------------------------- reading a nameplate

function stageNameplate() {
  const found = [
    ...(plate.part ? findByPart(plate.part) : []),
    ...(plate.model ? findByModel(plate.model) : []),
    ...(plate.size ? findByPart(plate.size) : []),
  ];
  const unique = [...new Set(found)];
  const fields = [
    ['Brand', plate.brand],
    ['Model', plate.model],
    ['Part', plate.part],
    ['Size', plate.size],
    ['Serial', plate.serial],
  ].filter(([, v]) => v);

  const takes = unique.length
    ? `<p class="field-label" style="margin-top:18px">What this takes</p>
       ${unique
         .map(
           (rec, i) => `<div class="found">
            <p class="order-line"><span class="label">Buy</span><b>${esc(orderLine(rec))}</b>
              <button class="btn-link" type="button" data-copy-text="${esc(rec.parts[0] || rec.names[0] || '')}">Copy</button></p>
            <p class="found-cycle">${esc(rec.what)} · ${esc(humanizeInterval(rec.every))}</p>
            <p class="found-seen">${esc(rec.where)}</p>
            ${rec.note ? `<p class="found-seen">${esc(rec.note)}</p>` : ''}
            <div class="btn-row" style="margin-top:10px"><button class="btn btn-sm" type="button" data-plate-part="${esc(rec.id)}">Track this part</button></div>
          </div>`
         )
         .join('')}`
    : `<p class="callout" style="margin-top:18px"><span class="label">No cross-reference</span>
        Nothing in the built-in parts list matches this label. The details above are saved with the item
        anyway, which is what you need when you come to reorder.</p>`;

  photoStage(
    `<div class="photo-found">
       ${photoURL ? `<img src="${esc(photoURL)}" alt="The label you photographed">` : ''}
     </div>
     ${fields.length
       ? `<dl class="plate">${fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
       : '<p class="help" style="margin-top:14px">Nothing legible on that label.</p>'}
     ${plate.dates.length
       ? `<p class="found-read" style="margin-left:0">Dates read: ${plate.dates
           .map((d) => `<b>${esc(d.text || d.iso)}</b>${d.kind ? ` (${esc(d.kind)})` : ''}`)
           .join(', ')}</p>`
       : ''}
     ${nameplateHasContent(plate) ? takes : ''}
     ${plate.note ? `<p class="help" style="margin-top:12px">${esc(plate.note)}</p>` : ''}
     <p class="help" style="margin-top:14px">Transcribed from your photo — check it against the label before ordering.</p>`,
    `<button class="btn btn-quiet" type="button" data-act="photo-again">Another photo</button>
     ${nameplateHasContent(plate) ? '<button class="btn btn-primary" type="button" data-act="plate-save">Save these details</button>' : ''}`
  );
}

// ---------------------------------------------------------------- sheet

const sheet = () => $('#sheet');

function closeSheet() {
  const d = sheet();
  if (d.open) d.close();
}

function openSheet(html) {
  const d = sheet();
  d.innerHTML = html;
  if (!d.open) d.showModal();
  d.scrollTop = 0;
  const first = d.querySelector('[data-autofocus]') || d.querySelector('input, button');
  first?.focus();
}

function leadSelect(id, value) {
  const opts = LEADS.map(([n, label]) => `<option value="${n}"${n === value ? ' selected' : ''}>${label}</option>`).join('');
  return `<select id="${id}">${opts}</select>`;
}

function everyFields(idN, idU, every) {
  const n = every?.n ?? 3;
  const unit = every?.unit ?? 'month';
  return `<div class="field-2">
    <input type="number" id="${idN}" min="1" max="120" value="${n}" aria-label="Repeat every, number">
    <select id="${idU}" aria-label="Repeat every, unit">${UNITS.map(([v, l]) => `<option value="${v}"${v === unit ? ' selected' : ''}>${l}</option>`).join('')}</select>
  </div>`;
}

/** Sheet 1: adding something from the catalogue — one question, with the label hint beside it. */
function openAdd(entry) {
  const isExpiry = entry.kind === 'expiry';
  openSheet(`<form id="add-form" data-ref="${esc(entry.id)}">
    <div class="sheet-head">
      <div>
        <h3>${esc(entry.name)}</h3>
        <p class="sub">${esc(isExpiry ? (entry.life ? `Lasts about ${entry.life.n} ${entry.life.unit}${entry.life.n === 1 ? '' : 's'}` : 'Has an expiry date') : humanizeInterval(entry.every))}</p>
      </div>
      <button class="x" type="button" data-act="close" aria-label="Close">✕</button>
    </div>
    <div class="sheet-body">
      <div class="field">
        <label for="add-date">${esc(entry.ask)}</label>
        <input type="date" id="add-date" data-autofocus value="${isExpiry ? '' : todayISO()}">
      </div>
      <div class="quick">
        ${isExpiry ? '' : `<button class="btn btn-sm" type="button" data-quick="today">Today</button>
        <button class="btn btn-sm" type="button" data-quick="month">A month ago</button>`}
        <button class="btn btn-sm btn-quiet" type="button" data-quick="unknown">I need to go and look</button>
      </div>
      <p class="callout" style="margin-top:16px"><span class="label">Where the date is</span>${esc(entry.where)}</p>
      <p class="callout"><span class="label">Why it matters</span>${esc(entry.why)}</p>
      <hr class="sheet-sep">
      <div class="field">
        <label for="add-where">Which one is it? <span style="text-transform:none;letter-spacing:0">(optional)</span></label>
        <input type="text" id="add-where" placeholder="upstairs landing, the blue car, kitchen">
        <p class="help">Handy once you are tracking more than one of something.</p>
      </div>
      ${isExpiry ? '' : `<div class="field"><span class="field-label">Repeat every</span>${everyFields('add-n', 'add-u', entry.every)}</div>`}
      <div class="field"><label for="add-lead">Warn me</label>${leadSelect('add-lead', entry.lead)}</div>
    </div>
    <div class="sheet-foot">
      <button class="btn btn-quiet" type="button" data-act="close">Cancel</button>
      <button class="btn btn-primary" type="submit">Track this</button>
    </div>
  </form>`);
}

/** Sheet 2: adding something the catalogue does not cover. */
function openCustom() {
  openSheet(`<form id="custom-form">
    <div class="sheet-head">
      <div><h3>Add your own</h3><p class="sub">Anything with a date on it</p></div>
      <button class="x" type="button" data-act="close" aria-label="Close">✕</button>
    </div>
    <div class="sheet-body">
      <div class="field">
        <label for="c-name">What is it?</label>
        <input type="text" id="c-name" data-autofocus required placeholder="Bike service, visa appointment, repot the fig">
      </div>
      <div class="field">
        <label for="c-where">Which one <span style="text-transform:none;letter-spacing:0">(optional)</span></label>
        <input type="text" id="c-where" placeholder="garage, spare room">
      </div>
      <div class="field">
        <span class="field-label">Is it a one-off date, or does it repeat?</span>
        <div class="field-2">
          <select id="c-kind" aria-label="Kind">
            <option value="interval">Repeats</option>
            <option value="expiry">One-off date</option>
          </select>
          <select id="c-cat" aria-label="Category">${CATEGORIES.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="field"><label for="c-due">Due date</label><input type="date" id="c-due" value="${addDays(todayISO(), 30)}"></div>
      <div id="c-every-wrap" class="field"><span class="field-label">Repeat every</span>${everyFields('c-n', 'c-u', { n: 6, unit: 'month' })}</div>
      <div class="field"><label for="c-lead">Warn me</label>${leadSelect('c-lead', 14)}</div>
      <div class="field"><label for="c-note">Note <span style="text-transform:none;letter-spacing:0">(optional)</span></label><input type="text" id="c-note" placeholder="Account number, where the receipt is"></div>
    </div>
    <div class="sheet-foot">
      <button class="btn btn-quiet" type="button" data-act="close">Cancel</button>
      <button class="btn btn-primary" type="submit">Track this</button>
    </div>
  </form>`);
}

/** Sheet 3: an item you already track. Fields save as you change them. */
/**
 * The answer to "what do I buy again?", resolved fresh from whatever the item currently
 * knows: a stored part number first, then a live cross-reference against its own part or
 * model number, so filling in a model after the fact still surfaces the filter it takes.
 */
function buyLineFor(item) {
  const product = item.product || {};
  if (product.part) {
    const hits = findByPart(product.part);
    const rec = hits[0];
    return `<p class="order-line" style="margin-top:6px"><span class="label">Buy</span><b>${esc(rec ? orderLine(rec) : product.part)}</b>
      <button class="btn-link" type="button" data-copy-text="${esc(product.part)}">Copy</button></p>
      ${rec?.where ? `<p class="found-seen">${esc(rec.where)}</p>` : ''}`;
  }
  const byModel = product.model ? findByModel(product.model) : [];
  if (byModel.length) {
    return byModel
      .map(
        (rec) => `<p class="order-line" style="margin-top:6px"><span class="label">Takes</span><b>${esc(orderLine(rec))}</b>
          <button class="btn-link" type="button" data-copy-text="${esc(rec.parts[0] || rec.names[0] || '')}">Copy</button></p>
          <p class="found-seen">${esc(rec.where)}</p>`
      )
      .join('');
  }
  return '';
}

function openItem(item) {
  const today = todayISO();
  const st = statusOf(item, today);
  const hints = hintsFor(item);
  const isExpiry = item.kind === 'expiry';
  const history = [...(item.history || [])].reverse().slice(0, 8);
  const statusText =
    st.state === 'nodate'
      ? 'No date yet'
      : `${isExpiry ? 'Expires' : 'Due'} ${prettyDate(item.due)} · ${relativeDays(st.days)}`;

  openSheet(`<div data-item="${esc(item.id)}">
    <div class="sheet-head">
      <div>
        <h3>${esc(item.name)}${item.where ? ` <span style="font-weight:400;color:var(--ink-faint)">· ${esc(item.where)}</span>` : ''}</h3>
        <p class="sub">${esc(statusText)}</p>
      </div>
      <button class="x" type="button" data-act="close" aria-label="Close">✕</button>
    </div>
    <div class="sheet-body">
      ${st.state === 'nodate' && hints.where ? `<p class="callout"><span class="label">Where the date is</span>${esc(hints.where)}</p>` : ''}
      ${st.state === 'nodate' ? `<div class="btn-row" style="margin-top:14px"><button class="btn" type="button" data-act="photo-date" data-cansee-only>${svg('camera')} Read the date from a photo</button></div>` : ''}
      <div class="btn-row" style="margin-top:16px">
        ${isExpiry
          ? `<button class="btn btn-primary" type="button" data-act="renew">Renewed — set new date</button>`
          : `<button class="btn btn-primary" type="button" data-act="done">${svg('check')} Done today</button>`}
        ${isISO(item.due) ? `<button class="btn" type="button" data-act="snooze" data-days="7">+1 week</button>
        <button class="btn" type="button" data-act="snooze" data-days="30">+1 month</button>` : ''}
      </div>

      <div class="field"><label for="i-due">${isExpiry ? 'Expiry date' : 'Next due'}</label><input type="date" id="i-due" value="${esc(item.due || '')}"></div>
      ${isExpiry ? '' : `<div class="field"><span class="field-label">Repeat every</span>${everyFields('i-n', 'i-u', item.every)}</div>`}
      <div class="field"><label for="i-lead">Warn me</label>${leadSelect('i-lead', item.lead)}</div>
      <div class="field"><label for="i-name">Name</label><input type="text" id="i-name" value="${esc(item.name)}"></div>
      <div class="field"><label for="i-where">Which one</label><input type="text" id="i-where" value="${esc(item.where || '')}" placeholder="optional"></div>
      <div class="field"><label for="i-note">Note</label><input type="text" id="i-note" value="${esc(item.note || '')}" placeholder="optional"></div>

      <hr class="sheet-sep">
      <p class="field-label" style="margin-top:16px">Product</p>
      ${item.product?.code ? `<p class="found-seen">Barcode <span class="code-shown">${esc(item.product.code)}</span></p>` : ''}
      <div class="field-2">
        <div class="field"><label for="i-brand">Brand</label><input type="text" id="i-brand" value="${esc(item.product?.brand || '')}" placeholder="optional"></div>
        <div class="field"><label for="i-model">Model</label><input type="text" id="i-model" value="${esc(item.product?.model || '')}" placeholder="optional"></div>
      </div>
      <div class="field"><label for="i-part">Replacement part number</label><input type="text" id="i-part" value="${esc(item.product?.part || '')}" placeholder="e.g. WF3CB"></div>
      <div id="i-buy">${buyLineFor(item)}</div>
      ${!item.product?.code ? `<div class="btn-row" style="margin-top:8px"><button class="btn btn-sm" type="button" data-act="scan">${svg('barcode')} Attach a scanned barcode</button></div>` : ''}

      ${hints.why ? `<hr class="sheet-sep"><p class="callout" style="margin-top:16px"><span class="label">Why it matters</span>${esc(hints.why)}</p>` : ''}
      ${hints.where && st.state !== 'nodate' ? `<p class="callout"><span class="label">Where the date is</span>${esc(hints.where)}</p>` : ''}

      ${history.length ? `<hr class="sheet-sep"><div class="field"><span class="field-label">History</span>
        <ul class="hist">${history.map((h) => `<li><time>${esc(prettyDate(h.on))}</time><span>${esc(h.kind === 'done' ? 'marked done' : h.kind === 'renewed' ? `renewed to ${prettyDate(h.to)}` : `pushed back to ${prettyDate(h.to)}`)}</span></li>`).join('')}</ul></div>` : ''}

      <hr class="sheet-sep">
      <div class="btn-row" style="margin-top:14px">
        <button class="btn btn-sm" type="button" data-act="archive">${item.archived ? 'Put back on the list' : 'Archive'}</button>
        <button class="btn btn-sm btn-danger" type="button" data-act="delete" data-armed="0">Delete</button>
      </div>
    </div>
    <div class="sheet-foot"><button class="btn btn-quiet" type="button" data-act="close">Close</button></div>
  </div>`);
}

// ---------------------------------------------------------------- actions

function toast(msg, undoFn) {
  const t = $('#toast');
  undo = undoFn || null;
  t.innerHTML = `<span>${esc(msg)}</span>${undoFn ? '<button class="btn-link" data-act="undo" type="button">Undo</button>' : ''}`;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    t.hidden = true;
    undo = null;
  }, undoFn ? 7000 : 3200);
}

function byId(id) {
  return state.items.find((i) => i.id === id);
}

function refresh() {
  if (view === 'due') renderDue();
  else if (view === 'add') renderAdd();
  else if (view === 'all') renderAll();
  else renderData();
  // The badge is on the Due tab, so it has to be recomputed whichever view is showing.
  if (view !== 'due') {
    const today = todayISO();
    const n = rows(today).filter((r) => !r.item.archived && (r.state === 'overdue' || r.state === 'soon')).length;
    const pip = $('#pip-due');
    pip.textContent = n ? String(n) : '';
    pip.hidden = !n;
  }
}

function markDone(item) {
  const before = { due: item.due, history: [...item.history] };
  const today = todayISO();
  item.due = item.every ? addInterval(today, item.every) : null;
  item.history = [...item.history, { on: today, kind: 'done', to: item.due }];
  item.example = false;
  save();
  closeSheet();
  refresh();
  toast(`Done. Next ${prettyDate(item.due)}.`, () => {
    Object.assign(item, before);
    save();
    refresh();
  });
}

function snooze(item, days) {
  const before = { due: item.due, history: [...item.history] };
  const base = isISO(item.due) ? item.due : todayISO();
  item.due = addDays(base, days);
  item.history = [...item.history, { on: todayISO(), kind: 'snoozed', to: item.due }];
  save();
  closeSheet();
  refresh();
  toast(`Pushed back to ${prettyDate(item.due)}.`, () => {
    Object.assign(item, before);
    save();
    refresh();
  });
}

function renew(item) {
  const hints = hintsFor(item);
  const suggested = hints.life ? addInterval(todayISO(), hints.life) : item.due;
  openSheet(`<form id="renew-form" data-item="${esc(item.id)}">
    <div class="sheet-head">
      <div><h3>${esc(item.name)} renewed</h3><p class="sub">What is the new expiry date?</p></div>
      <button class="x" type="button" data-act="close" aria-label="Close">✕</button>
    </div>
    <div class="sheet-body">
      <div class="field"><label for="r-due">New expiry date</label><input type="date" id="r-due" data-autofocus value="${esc(suggested || '')}"></div>
      ${hints.life ? `<p class="help">Suggested from the usual ${hints.life.n}-${hints.life.unit} life. Use the date on the new one if you have it.</p>` : ''}
    </div>
    <div class="sheet-foot">
      <button class="btn btn-quiet" type="button" data-act="close">Cancel</button>
      <button class="btn btn-primary" type="submit">Save date</button>
    </div>
  </form>`);
}

function armOrRun(btn, run) {
  if (btn.dataset.armed === '1') return run();
  btn.dataset.armed = '1';
  btn.dataset.label = btn.textContent;
  btn.textContent = 'Tap again to confirm';
  setTimeout(() => {
    if (btn.isConnected && btn.dataset.armed === '1') {
      btn.dataset.armed = '0';
      btn.textContent = btn.dataset.label;
    }
  }, 4000);
}

function switchView(next) {
  view = next;
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.view === next));
  }
  for (const sec of document.querySelectorAll('main > section')) {
    sec.hidden = sec.id !== `view-${next}`;
  }
  refresh();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ---------------------------------------------------------------- wiring

export function start() {
  load();
  initCapabilities();
  switchView('due');

  document.addEventListener('click', (e) => {
    const t = e.target;
    const tab = t.closest?.('.tab');
    if (tab) return switchView(tab.dataset.view);

    const act = t.closest?.('[data-act]')?.dataset.act;
    const btn = t.closest?.('[data-act]');

    if (act === 'undo') {
      const fn = undo;
      undo = null;
      $('#toast').hidden = true;
      fn?.();
      return;
    }
    if (act === 'close') return closeSheet();
    if (act === 'photo') return openPhoto('scan');
    if (act === 'photo-again') {
      const ctx = photoContext();
      releasePhoto();
      return stagePick(ctx?.mode || 'scan', ctx?.item);
    }
    if (act === 'photo-stop') return photoCtl?.abort();
    if (act === 'photo-apply') return applyFindings();
    if (act === 'scan') return openScanner();
    if (act === 'type-code') return openTypeCode();
    if (act === 'plate') return openPhoto('nameplate');
    if (act === 'torch') {
      scanHandle?.torch().then((on) => {
        btn.textContent = on ? 'Light off' : 'Light';
      });
      return;
    }
    if (act === 'scan-again') {
      stopScanner();
      return openScanner();
    }
    if (act === 'plate-save') {
      closeSheet();
      return toast('Details saved with the item.');
    }

    // ---- barcode: candidate picked from the catalogue or parts list, inside the code sheet
    const codeHolder = sheet().querySelector('[data-code]');
    const codeVal = codeHolder?.dataset.code;
    const codeCat = t.closest?.('[data-code-cat]')?.dataset.codeCat;
    if (codeVal && codeCat) return trackFromCode(codeVal, { entry: catalogEntry(codeCat) });
    const codePart = t.closest?.('[data-code-part]')?.dataset.codePart;
    if (codeVal && codePart) return trackFromCode(codeVal, { rec: partById(codePart) });
    const platePart = t.closest?.('[data-plate-part]')?.dataset.platePart;
    if (platePart) {
      const rec = partById(platePart);
      const due = plate?.dates?.[0]
        ? dueFromRead(rec.catalogId ? catalogEntry(rec.catalogId) : null, plate.dates[0].kind, plate.dates[0].iso)
        : null;
      const made = rec.catalogId
        ? fromCatalog(catalogEntry(rec.catalogId), { dontKnow: true })
        : makeItem({ name: rec.what, cat: rec.group === 'fridge' ? 'home' : 'home', kind: 'interval', every: rec.every, lead: 14 });
      made.every = rec.every;
      made.due = due;
      made.product = { ...emptyProduct(), part: rec.parts[0] || '', brand: rec.brand !== 'Any' && rec.brand !== 'Generic' ? rec.brand : '', model: plate?.model || '' };
      made.note = rec.where;
      state.items.push(made);
      save();
      closeSheet();
      switchView('due');
      toast(`${made.name} added.`);
      return;
    }

    if (act === 'code-open') {
      const item = byId(btn.dataset.id);
      closeSheet();
      if (item) openItem(item);
      return;
    }
    if (act === 'code-done') {
      const item = byId(btn.dataset.id);
      if (item) markDone(item);
      return;
    }
    if (act === 'track-known' && codeVal) {
      const known = recallCode(codeVal);
      const rec = known?.partId ? partById(known.partId) : null;
      const entry = known?.catalogId ? catalogEntry(known.catalogId) : null;
      return trackFromCode(codeVal, { entry, rec, name: known?.name, part: known?.part });
    }
    if (act === 'forget-code' && codeVal) {
      forgetCode(codeVal);
      closeSheet();
      return toast('Forgotten.');
    }

    const copyText2 = t.closest?.('[data-copy-text]')?.dataset.copyText;
    if (copyText2) {
      copyText(copyText2).then((ok) => toast(ok ? 'Copied.' : 'Could not copy — select and copy by hand.'));
      return;
    }
    if (act === 'go-add') return switchView('add');
    if (act === 'custom') return openCustom();
    if (act === 'clear-examples') {
      clearExamples();
      refresh();
      return toast('Examples cleared.');
    }

    const pick = t.closest?.('[data-pick]');
    if (pick) {
      const entry = catalogEntry(pick.dataset.pick);
      if (entry) openAdd(entry);
      return;
    }

    const row = t.closest?.('.row');
    if (row) {
      const item = byId(row.dataset.id);
      if (item) openItem(item);
      return;
    }

    const filter = t.closest?.('[data-filter]');
    if (filter) {
      allFilter = filter.dataset.filter;
      renderAll();
      return;
    }

    // ---- sheet actions, scoped to the open item
    const holder = sheet().querySelector('[data-item]');
    const item = holder ? byId(holder.dataset.item) : null;
    if (item) {
      if (act === 'done') return markDone(item);
      if (act === 'snooze') return snooze(item, Number(btn.dataset.days));
      if (act === 'renew') return renew(item);
      if (act === 'photo-date') return openPhoto('date', item);
      if (act === 'archive') {
        item.archived = !item.archived;
        save();
        closeSheet();
        refresh();
        return toast(item.archived ? 'Archived.' : 'Back on the list.');
      }
      if (act === 'delete') {
        return armOrRun(btn, () => {
          const copy = { ...item };
          const at = state.items.indexOf(item);
          state.items.splice(at, 1);
          save();
          closeSheet();
          refresh();
          toast(`Deleted ${copy.name}.`, () => {
            state.items.splice(at, 0, copy);
            save();
            refresh();
          });
        });
      }
    }

    // ---- data tab
    if (act === 'ics') {
      const text = toICS(state.items);
      outputPanel($('#ics-out'), {
        text,
        label: 'Calendar file (.ics)',
        filename: 'lasts.ics',
        mime: 'text/calendar',
        localOnly: true,
        note: FRAMED
          ? 'Copy this, paste it into a plain text file named <code>lasts.ics</code>, then open that file — your calendar app will offer to add the reminders. On a phone, emailing the file to yourself and tapping the attachment is the easiest route. Re-import after you add new things; existing events update rather than duplicate.'
          : 'Open the downloaded file and your calendar app will offer to add the reminders. Re-import after you add new things; existing events update rather than duplicate.',
      });
      return;
    }
    if (act === 'backup') {
      outputPanel($('#backup-out'), {
        text: exportJSON(),
        label: 'Backup (JSON)',
        filename: 'lasts-backup.json',
        mime: 'application/json',
        note: 'Keep this somewhere you will find it again. Pasting it into the restore box on any device brings your list back.',
      });
      return;
    }
    if (act === 'backup-dl') {
      saveFile('lasts-backup.json', exportJSON(), 'application/json');
      return;
    }
    if (act === 'restore') {
      const msg = $('#restore-msg');
      try {
        const n = importJSON($('#restore-in').value);
        refresh();
        toast(`Restored ${n} ${n === 1 ? 'item' : 'items'}.`);
      } catch (err) {
        msg.textContent = err.message || 'That backup could not be read.';
        msg.style.color = 'var(--alarm)';
      }
      return;
    }
    if (act === 'wipe') {
      return armOrRun(btn, () => {
        wipe();
        refresh();
        toast('Everything deleted.');
      });
    }

    const copyBtn = t.closest?.('[data-copy]');
    if (copyBtn) {
      const ta = document.getElementById(copyBtn.dataset.copy);
      copyText(ta.value).then((ok) => {
        if (ok) return toast('Copied.');
        ta.focus();
        ta.select();
        toast('Selected — press Ctrl+C or ⌘C to copy.');
      });
      return;
    }
    const dlBtn = t.closest?.('[data-dl]');
    if (dlBtn) {
      saveFile(dlBtn.dataset.dl, document.getElementById(dlBtn.dataset.src).value, dlBtn.dataset.mime);
      return;
    }

    const quick = t.closest?.('[data-quick]')?.dataset.quick;
    if (quick) {
      const input = $('#add-date');
      if (quick === 'today') input.value = todayISO();
      if (quick === 'month') input.value = addDays(todayISO(), -30);
      if (quick === 'unknown') {
        input.value = '';
        toast('Saved without a date — it will sit under “Needs a date”.');
      }
      return;
    }
  });

  // ---- searches
  document.addEventListener('input', (e) => {
    if (e.target.id === 'add-search') {
      addQuery = e.target.value;
      const at = e.target.selectionStart;
      renderAdd();
      const again = $('#add-search');
      again.focus();
      again.setSelectionRange(at, at);
    }
    if (e.target.id === 'all-search') {
      allQuery = e.target.value;
      const at = e.target.selectionStart;
      renderAll();
      const again = $('#all-search');
      again.focus();
      again.setSelectionRange(at, at);
    }
    if (e.target.id === 'c-kind') {
      $('#c-every-wrap').hidden = e.target.value === 'expiry';
    }
    if (e.target.id === 'parts-search') {
      partQuery = e.target.value;
      const at = e.target.selectionStart;
      $('#parts-out').innerHTML = partsResultsHTML();
      const again = $('#parts-search');
      again.focus();
      again.setSelectionRange(at, at);
    }
    if (e.target.id === 'code-search') {
      const at = e.target.selectionStart;
      $('#code-picker').innerHTML = pickerHTML(e.target.value, 'code');
      const again = $('#code-search');
      again.focus();
      again.setSelectionRange(at, at);
    }
  });

  // ---- live editing in the item sheet
  document.addEventListener('change', (e) => {
    if (e.target.id === 'photo-file') {
      const file = e.target.files?.[0];
      if (file) runPhoto(file);
      return;
    }
    const holder = sheet().querySelector('[data-item]');
    if (!holder || !sheet().open) return;
    const item = byId(holder.dataset.item);
    if (!item) return;
    const id = e.target.id;
    const map = {
      'i-due': () => (item.due = isISO(e.target.value) ? e.target.value : null),
      'i-lead': () => (item.lead = Number(e.target.value)),
      'i-name': () => (item.name = e.target.value.trim() || item.name),
      'i-where': () => (item.where = e.target.value.trim()),
      'i-note': () => (item.note = e.target.value.trim()),
      'i-n': () => (item.every = { n: Math.max(1, Number($('#i-n').value) || 1), unit: $('#i-u').value }),
      'i-u': () => (item.every = { n: Math.max(1, Number($('#i-n').value) || 1), unit: $('#i-u').value }),
      'i-brand': () => (item.product = { ...emptyProduct(), ...item.product, brand: e.target.value.trim() }),
      'i-model': () => (item.product = { ...emptyProduct(), ...item.product, model: e.target.value.trim() }),
      'i-part': () => (item.product = { ...emptyProduct(), ...item.product, part: e.target.value.trim() }),
    };
    if (!map[id]) return;
    map[id]();
    item.example = false;
    save();
    refresh();
    const sub = sheet().querySelector('.sheet-head .sub');
    if (sub) {
      const st = statusOf(item, todayISO());
      sub.textContent =
        st.state === 'nodate' ? 'No date yet' : `${item.kind === 'expiry' ? 'Expires' : 'Due'} ${prettyDate(item.due)} · ${relativeDays(st.days)}`;
    }
    if (id === 'i-brand' || id === 'i-model' || id === 'i-part') {
      const buyBox = $('#i-buy');
      if (buyBox) buyBox.innerHTML = buyLineFor(item);
    }
  });

  // ---- form submits
  document.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;

    if (form.id === 'add-form') {
      const entry = catalogEntry(form.dataset.ref);
      const date = $('#add-date').value;
      const every = entry.kind === 'interval' ? { n: Math.max(1, Number($('#add-n').value) || 1), unit: $('#add-u').value } : null;
      const item = fromCatalog(entry, {
        date,
        dontKnow: !isISO(date),
        where: $('#add-where').value.trim(),
        every,
        lead: Number($('#add-lead').value),
      });
      state.items.push(item);
      save();
      closeSheet();
      switchView('due');
      const st = statusOf(item, todayISO());
      toast(
        st.state === 'nodate'
          ? `${item.name} added — go and find the date.`
          : `${item.name} added · ${item.kind === 'expiry' ? 'expires' : 'due'} ${prettyDate(item.due)}.`
      );
      return;
    }

    if (form.id === 'custom-form') {
      const kind = $('#c-kind').value;
      const due = $('#c-due').value;
      const item = makeItem({
        name: $('#c-name').value.trim() || 'Untitled',
        where: $('#c-where').value.trim(),
        cat: $('#c-cat').value,
        kind,
        due: isISO(due) ? due : null,
        every: kind === 'interval' ? { n: Math.max(1, Number($('#c-n').value) || 1), unit: $('#c-u').value } : null,
        lead: Number($('#c-lead').value),
        note: $('#c-note').value.trim(),
      });
      state.items.push(item);
      save();
      closeSheet();
      switchView('due');
      toast(`${item.name} added.`);
      return;
    }

    if (form.id === 'code-form') {
      const raw = $('#code-in').value.replace(/\D/g, '');
      const ean13 = toEAN13(raw);
      const msg = $('#code-msg');
      if (!ean13) {
        msg.textContent = raw.length < 8
          ? 'That is not enough digits for a barcode.'
          : 'Those digits do not check out as a real barcode — check for a typo.';
        msg.style.color = 'var(--alarm)';
        return;
      }
      openCode({ code: raw, format: raw.length === 8 ? 'ean_8' : raw.length === 12 ? 'upc_a' : 'ean_13', ean13 });
      return;
    }

    if (form.id === 'code-name-form') {
      const codeHolder = sheet().querySelector('[data-code]');
      const ean13 = codeHolder?.dataset.code;
      const name = $('#code-name').value.trim();
      const part = $('#code-part').value.trim();
      if (!ean13 || !name) return;
      trackFromCode(ean13, { name, part });
      return;
    }

    if (form.id === 'renew-form') {
      const item = byId(form.dataset.item);
      const val = $('#r-due').value;
      if (item && isISO(val)) {
        item.due = val;
        item.history = [...item.history, { on: todayISO(), kind: 'renewed', to: val }];
        item.example = false;
        save();
        closeSheet();
        refresh();
        toast(`Renewed — expires ${prettyDate(val)}.`);
      }
      return;
    }
  });

  // Clicking the backdrop of a sheet closes it, the way a bottom sheet should.
  sheet().addEventListener('click', (e) => {
    if (e.target === sheet()) closeSheet();
  });

  // Emptying it on close means a stale data-item can never catch a later click.
  sheet().addEventListener('close', () => {
    releasePhoto();
    stopScanner();
    sheet().innerHTML = '';
  });
}
