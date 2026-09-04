import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { World } from '../src/types.ts';
import { MONUMENT_COST } from '../src/data/jobs.ts';
import {
  INTERREGNUM, MONUMENT_FAMILY_REPUTATION, MONUMENT_REPUTATION, RECORD_SPECS,
  commissionMonument, currentEra, dailyHistory, eraOfDay, historyView, memorialOf, memorialise,
  monumentsTo, recordOf, refreshRecords,
} from '../src/world/history.ts';

const CYCLE = 28;

function historyEvents(w: World): number {
  return w.events.filter((e) => e.kind === 'history').length;
}

test('an era opens on day 0 and closes at the cycle boundary', () => {
  const w = makeWorld({ cycleDays: CYCLE });
  dailyHistory(w);
  const first = currentEra(w);
  assert.ok(first);
  assert.equal(first!.fromDay, 0);
  assert.equal(first!.toDay, null);
  assert.equal(first!.cycle, 0);
  assert.equal(first!.name, INTERREGNUM, 'a city with no Mayor has no name for its years');
  assert.equal(historyEvents(w), 1);

  for (let day = 1; day < CYCLE; day++) {
    w.day = day;
    dailyHistory(w);
  }
  assert.equal(w.eras.length, 1, 'one era to a cycle');

  w.day = CYCLE;
  dailyHistory(w);
  assert.equal(w.eras.length, 2);
  assert.equal(w.eras[0].toDay, CYCLE - 1);
  assert.equal(currentEra(w)!.fromDay, CYCLE);
  assert.equal(currentEra(w)!.cycle, 1);
  assert.equal(eraOfDay(w, 5)?.cycle, 0);
  assert.equal(eraOfDay(w, CYCLE + 5)?.cycle, 1);
  assert.equal(eraOfDay(w, CYCLE * 4), currentEra(w), 'the open era runs until it is closed');
  assert.equal(eraOfDay(w, -1), null, 'the city has no history before it began');
});

test('an era is named for the Mayor who sits through it', () => {
  const w = makeWorld({ cycleDays: CYCLE });
  const mayor = makeCitizen(w, { name: 'Ondine', familyName: 'Ashgrove', office: 'mayor' });
  w.government.mayorId = mayor.id;
  dailyHistory(w);
  assert.equal(currentEra(w)!.name, 'The Ashgrove Years');
  assert.equal(currentEra(w)!.mayorId, mayor.id);

  // a Mayor who falls does not rename the era they held
  w.government.mayorId = null;
  w.day = 3;
  dailyHistory(w);
  assert.equal(currentEra(w)!.name, 'The Ashgrove Years');

  // the next cycle, with nobody in the chair, is an Interregnum until somebody wins it
  w.day = CYCLE;
  dailyHistory(w);
  assert.equal(currentEra(w)!.name, INTERREGNUM);
  const next = makeCitizen(w, { name: 'Bram', familyName: 'Corvane' });
  w.government.mayorId = next.id;
  w.day = CYCLE + 1;
  dailyHistory(w);
  assert.equal(currentEra(w)!.name, 'The Corvane Years');
  assert.equal(currentEra(w)!.mayorId, next.id);
  assert.equal(w.eras.length, 2);
});

test('a record changes hands only when it is beaten, and says so once', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 100 });
  const b = makeCitizen(w, { wallet: 50 });
  refreshRecords(w);
  assert.equal(recordOf(w, 'richest')?.holderId, a.id);
  assert.equal(recordOf(w, 'richest')?.value, 100);
  assert.equal(historyEvents(w), 0, 'opening the book is not news');

  refreshRecords(w);
  assert.equal(historyEvents(w), 0);

  b.wallet = 500;
  w.day = 4;
  refreshRecords(w);
  assert.equal(recordOf(w, 'richest')?.holderId, b.id);
  assert.equal(recordOf(w, 'richest')?.value, 500);
  assert.equal(recordOf(w, 'richest')?.day, 4);
  assert.equal(historyEvents(w), 1);
  assert.ok(b.memory.some((m) => m.text.toLowerCase().includes('richest')));

  a.wallet = 400;
  refreshRecords(w);
  assert.equal(recordOf(w, 'richest')?.holderId, b.id, 'a record stands until it is beaten');
  assert.equal(historyEvents(w), 1);

  a.wallet = 900;
  refreshRecords(w);
  assert.equal(recordOf(w, 'richest')?.holderId, a.id);
  assert.equal(historyEvents(w), 2);
});

test('records read the city, not one citizen: storms, households and businesses too', () => {
  const w = makeWorld();
  const head = makeCitizen(w, { wallet: 10 });
  const other = makeCitizen(w, { wallet: 5 });
  w.households = {
    h_1: { id: 'h_1', headId: head.id, members: [head.id, other.id], tier: 1, createdDay: 0 },
  };
  w.disasters = [{ kind: 'storm', day: 1, district: 'commons', severity: 3, resolvedDay: 1 }];
  w.businesses = {
    b_1: {
      id: 'b_1', name: 'The Forge', kind: 'workshop', ownerId: head.id, treasury: 0, district: 'foundry_row',
      buildingId: 'shopfronts_harbor', employees: [], jobs: [], inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
      foundedDay: 0, rentPerDay: 0, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
    },
  };
  w.day = 12;
  refreshRecords(w);
  assert.equal(recordOf(w, 'largest_household')?.holderId, head.id);
  assert.equal(recordOf(w, 'largest_household')?.value, 2);
  assert.equal(recordOf(w, 'biggest_storm')?.value, 3);
  assert.equal(recordOf(w, 'biggest_storm')?.holderId, null, 'no citizen holds the weather');
  assert.equal(recordOf(w, 'oldest_business')?.holderId, head.id);
  assert.equal(recordOf(w, 'oldest_business')?.value, 12);
  assert.equal(recordOf(w, 'most_shifts'), null, 'nobody has worked a shift yet');
  assert.equal(RECORD_SPECS.length, 10);
});

test('a monument costs the works fund, lifts the honoree and their family, and never a wallet', () => {
  const w = makeWorld();
  const parent = makeCitizen(w, { reputation: 50 });
  const honoree = makeCitizen(w, { name: 'Ondine', familyName: 'Ashgrove', reputation: 60 });
  honoree.family.parents = [parent.id];
  parent.family.children = [honoree.id];
  const before = totalMoney(w);

  w.government.publicWorksFund = MONUMENT_COST - 1;
  assert.equal(commissionMonument(w, honoree.id, 'She kept the lights on.'), null, 'a short fund cuts no stone');
  assert.equal(honoree.reputation, 60);

  w.government.publicWorksFund = MONUMENT_COST + 20;
  const monument = commissionMonument(w, honoree.id, 'She kept the lights on.');
  assert.ok(monument);
  assert.equal(w.government.publicWorksFund, 20);
  assert.equal(totalMoney(w), before, 'the city cuts it with its own hands');
  assert.equal(honoree.reputation, 60 + MONUMENT_REPUTATION);
  assert.equal(parent.reputation, 50 + MONUMENT_FAMILY_REPUTATION);
  assert.deepEqual(monumentsTo(w, honoree.id).map((m) => m.id), [monument!.id]);
  const news = w.events.find((e) => e.kind === 'monument');
  assert.ok(news);
  assert.equal(news!.weight, 0.8);
  assert.ok(news!.text.includes('She kept the lights on.'));
  assert.ok(honoree.memory.some((m) => m.text.includes('statue')));
  assert.ok(parent.memory.some((m) => m.text.includes('statue')));
});

test('a monument to nobody is refused, and a blank inscription still names the honoree', () => {
  const w = makeWorld();
  w.government.publicWorksFund = MONUMENT_COST * 3;
  assert.equal(commissionMonument(w, 'c_404', 'For the missing'), null);
  assert.equal(w.government.publicWorksFund, MONUMENT_COST * 3, 'a refused commission costs nothing');
  const c = makeCitizen(w, { name: 'Wren', familyName: 'Vale' });
  const m = commissionMonument(w, c.id, '   ');
  assert.ok(m);
  assert.equal(m!.inscription, 'Wren Vale');
  assert.equal((w.monuments ?? []).length, 1);

  const fund = w.government.publicWorksFund;
  assert.equal(commissionMonument(w, c.id, 'And again'), null, 'one statue to a citizen');
  assert.equal(w.government.publicWorksFund, fund);
  assert.equal((w.monuments ?? []).length, 1);
  assert.equal(c.reputation, 50 + MONUMENT_REPUTATION);
});

test('a memorial is set in stone, survives a save and is found again', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Ilma', familyName: 'Reed' });
  w.day = 61;
  const memorial = memorialise(w, c, 'Ilma Reed. Forge operator. 61 days in Reverie.');
  assert.equal(memorial.citizenId, c.id);
  assert.equal(memorial.day, 61);
  assert.equal(memorialOf(w, c.id)?.epitaph, memorial.epitaph);
  assert.equal(memorialOf(w, 'c_404'), null);
  const news = w.events.find((e) => e.kind === 'sunset');
  assert.ok(news);
  assert.equal(news!.weight, 0.9);

  const saved: World = JSON.parse(JSON.stringify(w));
  assert.equal(memorialOf(saved, c.id)?.epitaph, memorial.epitaph);
  const view = historyView(saved);
  assert.equal(view.memorials.length, 1);
  view.memorials.push({ citizenId: 'c_9', day: 0, epitaph: 'not real' });
  assert.equal((saved.memorials ?? []).length, 1, 'the view is a copy, not the record');
});

test('the Hall of Records is safe to open in an empty or ancient world', () => {
  const w = makeWorld({ cycleDays: CYCLE });
  delete (w as { eras?: unknown[] }).eras;
  delete (w as { records?: unknown[] }).records;
  delete (w as { monuments?: unknown[] }).monuments;
  delete (w as { memorials?: unknown[] }).memorials;
  assert.equal(currentEra(w), null);
  dailyHistory(w);
  assert.ok(currentEra(w));
  refreshRecords(w);
  assert.deepEqual(w.records, []);
  const view = historyView(w);
  assert.deepEqual(view.monuments, []);
  assert.deepEqual(view.memorials, []);
  assert.equal(recordOf(w, 'nothing_at_all'), null);
});
