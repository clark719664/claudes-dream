// Persistence. Everything lives in this browser's localStorage and goes nowhere else,
// which is also why the backup panel in the Data tab is not optional.

import { SCHEMA, todayISO, addDays, addInterval, isISO } from './core.js';
import { toEAN13 } from './barcode.js';
import { catalogEntry } from './catalog.js';

const KEY = 'lasts.v1';

export const state = {
  items: [],
  /** Barcodes this browser has been taught, keyed by normalized EAN-13. See rememberCode(). */
  learned: {},
  showedExamples: false,
  storageOK: true,
  storageNote: '',
};

/** What a thing actually is, as distinct from when it is next due. */
export function emptyProduct() {
  return { brand: '', model: '', part: '', code: '', serial: '' };
}

function cleanProduct(raw) {
  const out = emptyProduct();
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(out)) {
    if (typeof raw[key] === 'string') out[key] = raw[key].trim().slice(0, 60);
  }
  return out;
}

export function hasProduct(item) {
  const p = item.product;
  return !!p && Object.values(p).some(Boolean);
}

function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

/** Items are stored thin: a catalog reference rather than a copy of its prose. */
export function makeItem(patch = {}) {
  return {
    id: uid(),
    ref: null,
    name: 'Untitled',
    where: '',
    cat: 'home',
    kind: 'interval',
    due: null,
    every: null,
    lead: 14,
    note: '',
    product: emptyProduct(),
    history: [],
    archived: false,
    created: todayISO(),
    ...patch,
  };
}

export function fromCatalog(entry, { date, dontKnow, where, every, lead } = {}) {
  const iv = every || entry.every || null;
  let due = null;
  if (!dontKnow && isISO(date)) {
    // For a lifespan the answer is the date printed on the thing, so add the lifespan to it.
    // For upkeep the answer is when you last did it, so the next one is one interval later.
    if (entry.kind === 'expiry') due = entry.life ? addInterval(date, entry.life) : date;
    else due = addInterval(date, iv);
  }
  return makeItem({
    ref: entry.id,
    name: entry.name,
    cat: entry.cat,
    kind: entry.kind,
    every: entry.kind === 'interval' ? iv : null,
    lead: Number.isFinite(lead) ? lead : entry.lead,
    where: where || '',
    due,
  });
}

/** Prose for an item, from its catalog entry when it has one. */
export function hintsFor(item) {
  const entry = item.ref ? catalogEntry(item.ref) : null;
  return {
    where: entry?.where || '',
    why: entry?.why || '',
    ask: entry?.ask || (item.kind === 'expiry' ? 'When does it expire?' : 'When did you last do it?'),
    life: entry?.life || null,
  };
}

// ---------------------------------------------------------------- load & save

function sanitize(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null;
  const items = raw.items
    .filter((it) => it && typeof it.name === 'string')
    .map((it) =>
      makeItem({
        ...it,
        due: isISO(it.due) ? it.due : null,
        lead: Number.isFinite(it.lead) ? it.lead : 14,
        history: Array.isArray(it.history) ? it.history.slice(-40) : [],
        archived: !!it.archived,
        product: cleanProduct(it.product),
        every:
          it.every && Number.isFinite(it.every.n) && ['day', 'week', 'month', 'year'].includes(it.every.unit)
            ? { n: it.every.n, unit: it.every.unit }
            : null,
      })
    );
  return { items, learned: cleanLearned(raw.learned), showedExamples: !!raw.showedExamples };
}

/** The learned-barcode map is user data too, so it gets the same treatment on the way in. */
function cleanLearned(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    const code = toEAN13(key);
    if (!code || !value || typeof value !== 'object') continue;
    const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 60) : '');
    const entry = {
      name: str(value.name),
      catalogId: str(value.catalogId) || null,
      partId: str(value.partId) || null,
      brand: str(value.brand),
      model: str(value.model),
      part: str(value.part),
      at: isISO(value.at) ? value.at : todayISO(),
    };
    if (!entry.name && !entry.catalogId && !entry.partId && !entry.part) continue;
    out[code] = entry;
    if (Object.keys(out).length >= 2000) break;
  }
  return out;
}

export function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    state.storageOK = false;
    state.storageNote =
      'This browser is blocking local storage, so anything you add will be lost when you close the tab. Private-browsing windows usually do this.';
  }
  if (!raw) {
    state.items = seedExamples();
    state.showedExamples = true;
    return;
  }
  try {
    const parsed = sanitize(JSON.parse(raw));
    if (!parsed) throw new Error('shape');
    state.items = parsed.items;
    state.learned = parsed.learned;
    state.showedExamples = parsed.showedExamples;
  } catch {
    state.items = seedExamples();
    state.showedExamples = true;
    state.storageNote = 'Saved data could not be read, so the examples are showing instead.';
  }
}

export function save() {
  if (!state.storageOK) return;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ schema: SCHEMA, items: state.items, learned: state.learned, showedExamples: state.showedExamples })
    );
  } catch {
    state.storageOK = false;
    state.storageNote = 'Local storage is full or blocked, so changes are no longer being saved. Copy your backup from the Data tab.';
  }
}

export function exportJSON() {
  return JSON.stringify(
    { schema: SCHEMA, exported: todayISO(), items: state.items, learned: state.learned },
    null,
    2
  );
}

export function importJSON(text) {
  const parsed = sanitize(JSON.parse(text));
  if (!parsed) throw new Error('That does not look like a Lasts backup — it should be JSON with an "items" list.');
  state.items = parsed.items;
  state.learned = parsed.learned;
  state.showedExamples = false;
  save();
  return parsed.items.length;
}

export function wipe() {
  state.items = [];
  state.learned = {};
  state.showedExamples = false;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

// ---------------------------------------------------------------- learned barcodes

/**
 * Nobody can ship an offline barcode database, so the app builds its own one scan at a time.
 * Tell it what a code is once and that code is exact forever, on this device, for free.
 */
export function rememberCode(code, info) {
  const key = toEAN13(code);
  if (!key) return null;
  state.learned[key] = {
    name: String(info.name || '').trim().slice(0, 60),
    catalogId: info.catalogId || null,
    partId: info.partId || null,
    brand: String(info.brand || '').trim().slice(0, 60),
    model: String(info.model || '').trim().slice(0, 60),
    part: String(info.part || '').trim().slice(0, 60),
    at: todayISO(),
  };
  save();
  return state.learned[key];
}

export function recallCode(code) {
  const key = toEAN13(code);
  return key ? state.learned[key] || null : null;
}

export function forgetCode(code) {
  const key = toEAN13(code);
  if (key && state.learned[key]) {
    delete state.learned[key];
    save();
  }
}

export function learnedCount() {
  return Object.keys(state.learned).length;
}

/** Items already carrying this barcode — "you tracked this before" rather than a duplicate. */
export function itemsWithCode(code) {
  const key = toEAN13(code);
  if (!key) return [];
  return state.items.filter((it) => it.product?.code && toEAN13(it.product.code) === key);
}

// ---------------------------------------------------------------- example data

/**
 * A first run shows six examples, dated relative to today so the list always looks live:
 * something late, something close, something far off, and one with no date yet.
 * They are labelled as examples and clear in one tap.
 */
export function seedExamples() {
  const t = todayISO();
  const mk = (ref, over, extra = {}) => {
    const entry = catalogEntry(ref);
    return makeItem({
      ref,
      name: entry.name,
      cat: entry.cat,
      kind: entry.kind,
      every: entry.kind === 'interval' ? entry.every : null,
      lead: entry.lead,
      due: over === null ? null : addDays(t, over),
      example: true,
      ...extra,
    });
  };
  return [
    mk('hvac-filter', -23, { where: 'hall cupboard' }),
    mk('smoke-alarm', 34, { where: 'upstairs landing' }),
    mk('passport', 214),
    mk('registration', 61),
    mk('toothbrush', 48),
    mk('extinguisher', null, { where: 'kitchen' }),
  ];
}

export function hasExamples() {
  return state.items.some((it) => it.example);
}

export function clearExamples() {
  state.items = state.items.filter((it) => !it.example);
  save();
}
