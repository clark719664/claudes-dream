// Reading a photo. The model is used as an eye, not an authority: it names what it sees
// and transcribes dates printed on labels. Every interval, lead time and explanation still
// comes from the catalogue in this app, so the advice does not depend on what a model
// happens to recall — and nothing reaches the list until the person confirms it.

import { CATALOG, catalogEntry } from './catalog.js';
import { humanizeInterval, isISO, addInterval, pad } from './core.js';

/** A compact index is all the model needs to map what it sees onto our own entries. */
export function catalogIndex() {
  return CATALOG.map((c) => {
    const cycle = c.kind === 'interval' ? humanizeInterval(c.every) : c.life ? `${c.life.n}-${c.life.unit} life` : 'expiry date';
    return `${c.id} | ${c.name} | ${cycle}`;
  }).join('\n');
}

const SHAPE = `{"items":[{"catalogId":"smoke-alarm","label":"Smoke alarm","confidence":"high","seen":"ceiling-mounted alarm, Kidde branding","date":{"value":"2016-04","kind":"manufacture","text":"MFD 04/2016","confidence":"high"}}],"note":""}`;

export function buildPrompt(mode, subject) {
  const common = `You are the eye of a maintenance tracker. Read the attached photo or photos.

Reply with only JSON in this shape, and nothing else:
${SHAPE}

Rules:
- catalogId must be copied exactly from the list below, or null if nothing in the list fits. Never invent an id.
- label is a short plain name for the thing, even when catalogId is null.
- confidence is "high", "medium" or "low". Use low when you are inferring rather than seeing.
- seen is one short clause naming what in the image made you say this. No speculation.
- date is the date PRINTED ON THE THING, or null if you cannot read one. Never estimate a date from how worn or old something looks, and never use today's date.
- date.value is "YYYY", "YYYY-MM" or "YYYY-MM-DD" — only as precise as what you can actually read.
- date.kind is "manufacture", "expiry", "install", "service" or "purchase".
- date.text is the characters as printed, so a person can check your reading.
- A tyre sidewall's DOT code ends in four digits: week then year. "2319" is week 23 of 2019 — report that as "2019-06", kind "manufacture", and put the raw code in date.text.
- Say nothing about any people in the image; ignore them.
- If nothing in the image is a trackable object, return an empty items array and explain in one sentence in note.

Catalogue (id | name | cycle):
${catalogIndex()}`;

  if (mode === 'date') {
    const entry = subject?.ref ? catalogEntry(subject.ref) : null;
    return `${common}

This photo is meant to show the date printed on one specific thing: ${subject?.name || 'an item'}.${
      entry?.where ? `\nWhere that date normally is: ${entry.where}` : ''
    }
Return at most one item, matching that thing, and concentrate on transcribing the date correctly. If no date is legible, return the item with date null and say why in note.`;
  }

  return `${common}

List every trackable thing you can actually see, most prominent first, at most six. A photo of a whole room may hold several.`;
}

// ---------------------------------------------------------------- reading the reply

const DATE_RE = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/;

/**
 * Partial dates round to the START of the period they name. That is the safe direction in
 * both directions this app cares about: an earlier manufacture date expires sooner, and an
 * earlier printed expiry warns sooner. Never round a safety date later than it might be.
 */
export function normalizeReadDate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const m = DATE_RE.exec(String(raw.value ?? '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1950 || year > 2100) return null;
  const month = m[2] ? Math.min(12, Math.max(1, Number(m[2]))) : null;
  const day = m[3] ? Math.min(31, Math.max(1, Number(m[3]))) : null;
  const iso = `${year}-${pad(month ?? 1)}-${pad(day ?? 1)}`;
  if (!isISO(iso)) return null;
  return {
    iso,
    precision: day ? 'day' : month ? 'month' : 'year',
    kind: ['manufacture', 'expiry', 'install', 'service', 'purchase'].includes(raw.kind) ? raw.kind : null,
    text: typeof raw.text === 'string' ? raw.text.slice(0, 60) : '',
    confidence: CONF.includes(raw.confidence) ? raw.confidence : 'low',
  };
}

const CONF = ['high', 'medium', 'low'];

/** Everything the model returns is untrusted shape and untrusted content. Take only what fits. */
export function normalizeFindings(raw, limit = 6) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  const note = typeof raw?.note === 'string' ? raw.note.slice(0, 240) : '';
  const items = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const entry = typeof row.catalogId === 'string' ? catalogEntry(row.catalogId) : null;
    const label = String(row.label ?? entry?.name ?? '').trim().slice(0, 80);
    if (!entry && !label) continue;
    items.push({
      entry,
      label: entry?.name || label,
      given: label,
      confidence: CONF.includes(row.confidence) ? row.confidence : 'low',
      seen: typeof row.seen === 'string' ? row.seen.slice(0, 140) : '',
      date: normalizeReadDate(row.date),
    });
    if (items.length >= limit) break;
  }
  return { items, note };
}

/**
 * Turn a date read off a label into a due date. What the date MEANS decides this: a printed
 * expiry is the due date itself, while a manufacture or service date is the start of a
 * lifespan or a cycle. Getting this backwards would put a 2016 smoke alarm in the "later"
 * pile instead of flagging it as eight years past its useful life.
 */
export function dueFromRead(entry, kind, dateISO) {
  if (!isISO(dateISO)) return null;
  if (kind === 'expiry') return dateISO;
  if (!entry) return dateISO;
  if (entry.kind === 'expiry') return entry.life ? addInterval(dateISO, entry.life) : dateISO;
  return entry.every ? addInterval(dateISO, entry.every) : dateISO;
}

// ---------------------------------------------------------------- preparing the file

/**
 * The platform downsizes and strips metadata before anything is sent, so this only steps in
 * when a file is of a type the view will not accept or is over its size cap — a re-encode
 * through a canvas fixes both.
 */
export async function prepImage(file, limits) {
  const types = limits?.mediaTypes || [];
  const tooBig = limits?.maxInputBytes ? file.size > limits.maxInputBytes : false;
  const wrongType = types.length ? !types.includes(file.type) : false;
  if (!tooBig && !wrongType) return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
  if (!blob) throw new Error('That image could not be read. Try a JPEG or PNG.');
  return blob;
}

/** Viewer-facing copy for each way a sample call can fail. */
export function sampleErrorCopy(code) {
  switch (code) {
    case 'not_granted':
    case 'sampling_disabled':
    case 'not_declared':
    case 'capability_disabled':
    case 'capability_removed':
      return 'Reading photos is not available on this account. Everything else works as normal.';
    case 'images_unavailable':
      return 'This view cannot send photos. Try opening the page in a browser.';
    case 'image_rejected':
      return 'That file could not be used. A JPEG or PNG photo works best.';
    case 'rate_limited':
      return 'Too many requests just now. Give it a minute and try again.';
    case 'session_expired':
      return 'Your session expired. Sign in again and retry.';
    case 'refused':
      return 'That photo could not be read. Try one showing just the item and its label.';
    case 'invalid_json':
    case 'empty_completion':
      return 'The answer came back unreadable. Try again, or add the item by hand.';
    case 'prompt_too_large':
      return 'That was too much to send at once. Try a single photo.';
    case 'cancelled':
      return '';
    default:
      return 'Something went wrong reading that photo. Try again, or add the item by hand.';
  }
}
