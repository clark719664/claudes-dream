import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PARTS, PART_GROUPS, normalizePart, findByPart, findByModel, searchParts, orderLine, partById,
} from '../src/parts.js';
import { catalogEntry } from '../src/catalog.js';

test('every record can answer what the app asks of it', () => {
  const groups = new Set(PART_GROUPS.map((g) => g.id));
  const ids = new Set();
  for (const rec of PARTS) {
    assert.ok(!ids.has(rec.id), `duplicate id ${rec.id}`);
    ids.add(rec.id);
    assert.ok(groups.has(rec.group), `${rec.id} group`);
    assert.ok(rec.what && rec.brand, `${rec.id} names`);
    assert.ok(rec.every?.n > 0, `${rec.id} interval`);
    assert.ok(rec.where, `${rec.id} must say where to confirm the number`);
    assert.ok(Array.isArray(rec.parts) && Array.isArray(rec.fits) && Array.isArray(rec.names));
    if (rec.catalogId) assert.ok(catalogEntry(rec.catalogId), `${rec.id} links to a real catalogue entry`);
  }
  assert.ok(PARTS.length >= 40);
});

test('no record claims to know a barcode', () => {
  // Shipping a guessed UPC-to-product mapping would be worse than admitting ignorance.
  for (const rec of PARTS) {
    assert.ok(!('upcs' in rec), `${rec.id} must not carry guessed barcodes`);
    for (const part of rec.parts) {
      assert.ok(!/^\d{12,13}$/.test(part), `${rec.id}: "${part}" looks like a barcode, not a part number`);
    }
  }
});

test('part numbers match however they are punctuated', () => {
  for (const written of ['WF3CB', 'wf3cb', 'wf-3cb', ' WF 3CB ', 'wf_3cb']) {
    const hits = findByPart(written);
    assert.equal(hits.length, 1, `matched ${written}`);
    assert.equal(hits[0].id, 'ps3');
  }
  assert.equal(normalizePart('DA29-00020B'), 'DA2900020B');
  assert.equal(findByPart('DA29 00020 B')[0].id, 'samsung-cin');
});

test('a number embedded in label text still matches', () => {
  assert.equal(findByPart('FILTER MODEL ULTRAWF')[0].id, 'ultrawf');
  assert.equal(findByPart('EveryDrop EDR1RXD1 Filter 1')[0].id, 'edr1');
});

test('a marketing name matches as well as an order code', () => {
  assert.equal(findByPart('PureSource 3')[0].id, 'ps3');
  assert.equal(findByPart('UltraClarity')[0].id, 'bosch-uc');
  assert.ok(findByPart('LT1000P').some((r) => r.brand === 'LG'));
});

test('nothing is matched from nothing', () => {
  for (const junk of ['', ' ', 'x', '-', null, undefined, 'ZZZZZZZZZ9999']) {
    assert.deepEqual(findByPart(junk), [], `refused ${JSON.stringify(junk)}`);
  }
});

test('an appliance model resolves to what it takes', () => {
  const fridge = findByModel('FFSS2615TS');
  assert.ok(fridge.length >= 2, 'a Frigidaire side-by-side needs a water filter and an air filter');
  assert.ok(fridge.some((r) => r.parts.includes('WF3CB')));
  assert.ok(fridge.some((r) => r.parts.includes('PAULTRA')), 'the air filter nobody knows about');

  assert.equal(findByModel('NV356E')[0].parts[0], 'XFF350');
  assert.ok(findByModel('LFXS26973S').some((r) => r.parts.includes('LT1000P')));
  assert.ok(findByModel('HPA300').some((r) => r.parts.includes('HRF-R3')));
  assert.ok(findByModel('CORE300S').some((r) => r.parts.includes('CORE300-RF')));
});

test('a model that matches nothing returns nothing rather than a guess', () => {
  for (const model of ['', 'AB', 'QQQQ9999', 'not-a-model']) {
    assert.deepEqual(findByModel(model), [], `refused ${JSON.stringify(model)}`);
  }
});

test('search finds records by product, brand or code', () => {
  assert.ok(searchParts('water filter').length >= 10);
  assert.ok(searchParts('brita').length >= 2);
  assert.ok(searchParts('EB50').some((r) => r.brand === 'Oral-B'));
  assert.ok(searchParts('humidifier').length >= 3);
  assert.equal(searchParts('').length, PARTS.length);
});

test('the order line tells you exactly what to buy', () => {
  assert.equal(orderLine(partById('ps3')), 'WF3CB (also sold as PS-RF200, PS2364646)');
  assert.equal(orderLine(partById('wiper-size')), 'Blade length', 'a record with no order code falls back to its name');
  for (const rec of PARTS) assert.ok(orderLine(rec).length > 1, `${rec.id} has an order line`);
});

test('the intervals here agree with the maintenance catalogue they link to', () => {
  // A part saying "every 3 months" while the catalogue entry says yearly would show the user
  // two different answers for the same thing.
  for (const rec of PARTS) {
    if (!rec.catalogId) continue;
    const entry = catalogEntry(rec.catalogId);
    if (entry.kind !== 'interval' || !entry.every) continue;
    const months = (iv) => iv.n * { day: 1 / 30.44, week: 7 / 30.44, month: 1, year: 12 }[iv.unit];
    const a = months(rec.every);
    const b = months(entry.every);
    assert.ok(
      Math.max(a, b) / Math.min(a, b) <= 3.5,
      `${rec.id} says every ${a.toFixed(1)} months but ${rec.catalogId} says ${b.toFixed(1)}`
    );
  }
});
