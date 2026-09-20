// Persistence. Everything lives in this browser's localStorage and goes nowhere else,
// which is also why the backup panel in the Data tab is not optional.

import { SCHEMA, todayISO, addDays, addInterval, isISO } from './core.js';
import { catalogEntry } from './catalog.js';

const KEY = 'lasts.v1';

export const state = {
  items: [],
  showedExamples: false,
  storageOK: true,
  storageNote: '',
};

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
        every:
          it.every && Number.isFinite(it.every.n) && ['day', 'week', 'month', 'year'].includes(it.every.unit)
            ? { n: it.every.n, unit: it.every.unit }
            : null,
      })
    );
  return { items, showedExamples: !!raw.showedExamples };
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
    localStorage.setItem(KEY, JSON.stringify({ schema: SCHEMA, items: state.items, showedExamples: state.showedExamples }));
  } catch {
    state.storageOK = false;
    state.storageNote = 'Local storage is full or blocked, so changes are no longer being saved. Copy your backup from the Data tab.';
  }
}

export function exportJSON() {
  return JSON.stringify({ schema: SCHEMA, exported: todayISO(), items: state.items }, null, 2);
}

export function importJSON(text) {
  const parsed = sanitize(JSON.parse(text));
  if (!parsed) throw new Error('That does not look like a Lasts backup — it should be JSON with an "items" list.');
  state.items = parsed.items;
  state.showedExamples = false;
  save();
  return parsed.items.length;
}

export function wipe() {
  state.items = [];
  state.showedExamples = false;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
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
