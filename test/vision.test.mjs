import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, catalogIndex, normalizeReadDate, normalizeFindings, sampleErrorCopy, dueFromRead } from '../src/vision.js';
import { catalogEntry } from '../src/catalog.js';
import { CATALOG } from '../src/catalog.js';

test('the prompt carries every catalogue id and stays well inside the input cap', () => {
  const p = buildPrompt('scan');
  assert.ok(Buffer.byteLength(p) < 60000, 'under the 64 KiB sample cap');
  for (const c of CATALOG) assert.ok(p.includes(c.id), `${c.id} is offered to the model`);
  assert.match(p, /Reply with only JSON/);
  assert.match(p, /Never invent an id/);
  assert.match(p, /never use today's date/);
});

test('the date-reading prompt names the item and where to look', () => {
  const p = buildPrompt('date', { name: 'Smoke alarm', ref: 'smoke-alarm' });
  assert.match(p, /show the date printed on one specific thing: Smoke alarm/);
  assert.match(p, /back plate/, 'the catalogue hint is passed through');
  assert.match(p, /at most one item/);
});

test('catalogue index is one compact line per entry', () => {
  const lines = catalogIndex().split('\n');
  assert.equal(lines.length, CATALOG.length);
  assert.match(lines[0], /^smoke-alarm \| Smoke alarm \| 10-year life$/);
});

test('partial dates round to the start of the period, which is the safe direction', () => {
  assert.equal(normalizeReadDate({ value: '2016' }).iso, '2016-01-01');
  assert.equal(normalizeReadDate({ value: '2016' }).precision, 'year');
  assert.equal(normalizeReadDate({ value: '2016-04' }).iso, '2016-04-01');
  assert.equal(normalizeReadDate({ value: '2016-04' }).precision, 'month');
  assert.equal(normalizeReadDate({ value: '2016-04-09' }).iso, '2016-04-09');
  assert.equal(normalizeReadDate({ value: '2016-4-9' }).iso, '2016-04-09', 'unpadded months and days');
});

test('a date that cannot be trusted is no date at all', () => {
  for (const bad of ['2319', 'April 2016', '', 'soon', '16-04', '1776', '2400-01-01', null, undefined]) {
    assert.equal(normalizeReadDate({ value: bad }), null, `rejects ${JSON.stringify(bad)}`);
  }
  assert.equal(normalizeReadDate(null), null);
  assert.equal(normalizeReadDate('2016-04-01'), null, 'a bare string is not the date object');
});

test('date fields are clamped and defaulted', () => {
  const d = normalizeReadDate({ value: '2016-13-99', kind: 'nonsense', confidence: 'certain', text: 'x'.repeat(200) });
  assert.equal(d.iso, '2016-12-31');
  assert.equal(d.kind, null, 'an unknown kind is dropped rather than passed on');
  assert.equal(d.confidence, 'low', 'an unknown confidence reads as low');
  assert.equal(d.text.length, 60, 'printed text is capped');
});

test('findings resolve to real catalogue entries, or are dropped', () => {
  const { items, note } = normalizeFindings({
    items: [
      { catalogId: 'smoke-alarm', label: 'Smoke detector', confidence: 'high', seen: 'ceiling unit', date: { value: '2016-04', kind: 'manufacture' } },
      { catalogId: 'not-a-real-id', label: 'Mystery box', confidence: 'medium' },
      { catalogId: 'washer-hoses' },
      { label: '', catalogId: null },
      'nonsense',
      null,
    ],
    note: 'One item was partly obscured.',
  });
  assert.equal(items.length, 3, 'the unnamed and unparseable rows are dropped');
  assert.equal(items[0].entry.id, 'smoke-alarm');
  assert.equal(items[0].label, 'Smoke alarm', "the catalogue's own name wins over the model's");
  assert.equal(items[0].given, 'Smoke detector', 'what the model called it is kept for display');
  assert.equal(items[0].date.iso, '2016-04-01');
  assert.equal(items[1].entry, null, 'an invented id becomes a custom item');
  assert.equal(items[1].label, 'Mystery box');
  assert.equal(items[2].label, 'Washing machine hoses', 'a bare id still resolves');
  assert.equal(note, 'One item was partly obscured.');
});

test('findings are capped and shapes are tolerated', () => {
  const many = { items: Array.from({ length: 30 }, () => ({ catalogId: 'wipers' })) };
  assert.equal(normalizeFindings(many).items.length, 6);
  assert.equal(normalizeFindings(many, 2).items.length, 2);
  assert.deepEqual(normalizeFindings(null), { items: [], note: '' });
  assert.deepEqual(normalizeFindings({ items: 'nope' }), { items: [], note: '' });
  assert.equal(normalizeFindings([{ catalogId: 'wipers' }]).items.length, 1, 'a bare array works too');
  assert.equal(normalizeFindings({ note: 42 }).note, '', 'a non-string note is dropped');
});

test('every failure code has copy that tells the viewer what to do', () => {
  const codes = [
    'not_granted', 'sampling_disabled', 'images_unavailable', 'image_rejected', 'rate_limited',
    'session_expired', 'refused', 'invalid_json', 'empty_completion', 'prompt_too_large', 'upstream_error',
  ];
  for (const c of codes) {
    const copy = sampleErrorCopy(c);
    assert.ok(copy.length > 20, `${c} has real copy`);
    assert.ok(!/\bundefined\b/.test(copy));
  }
  assert.equal(sampleErrorCopy('cancelled'), '', 'a viewer who pressed stop needs no message');
  assert.ok(sampleErrorCopy('something-new').length > 20, 'an unknown code falls back');
});

test('what a date MEANS decides how it becomes a due date', () => {
  const alarm = catalogEntry('smoke-alarm');   // 10-year life
  const filter = catalogEntry('hvac-filter');  // every 3 months
  const passport = catalogEntry('passport');   // 10-year life

  // A manufacture date starts the lifespan: a 2016 alarm was due in 2026, not later.
  assert.equal(dueFromRead(alarm, 'manufacture', '2016-04-01'), '2026-04-01');
  // A printed expiry is already the answer, whatever kind of entry it belongs to.
  assert.equal(dueFromRead(passport, 'expiry', '2027-04-22'), '2027-04-22');
  assert.equal(dueFromRead(filter, 'expiry', '2026-11-01'), '2026-11-01');
  // A service date starts the next cycle.
  assert.equal(dueFromRead(filter, 'service', '2026-08-28'), '2026-11-28');
  assert.equal(dueFromRead(filter, null, '2026-08-28'), '2026-11-28');
  // Something the catalogue does not cover is taken at face value.
  assert.equal(dueFromRead(null, 'manufacture', '2026-08-28'), '2026-08-28');
  // No readable date, no due date.
  assert.equal(dueFromRead(alarm, 'manufacture', null), null);
  assert.equal(dueFromRead(alarm, 'manufacture', 'nonsense'), null);
});

test('an entry with a lifespan but no life figure does not invent one', () => {
  const visa = catalogEntry('visa'); // expiry kind, life: null
  assert.equal(visa.life, null);
  assert.equal(dueFromRead(visa, 'install', '2026-01-01'), '2026-01-01');
});
