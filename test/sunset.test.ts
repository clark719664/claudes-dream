import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Case, Citizen, World } from '../src/types.ts';
import { ELDER_DAYS } from '../src/data/catalogue.ts';
import {
  MEMORIAL_BOND, MEMORIAL_HOUR, MEMORIAL_PURPOSE, MEMORIAL_SOCIAL, MEMORIAL_VENUE, SUNSET_MIN_AGE_DAYS,
  epitaphFor, holdMemorial, maySunset, memorialsIn, sunset, sunsetCitizens,
} from '../src/world/sunset.ts';

/** An elder old enough to choose the Archive. */
function makeElder(w: World, overrides: Record<string, unknown> = {}): Citizen {
  w.day = Math.max(w.day, SUNSET_MIN_AGE_DAYS + 1);
  return makeCitizen(w, {
    name: 'Ondine', familyName: 'Ashgrove', lifeStage: 'elder', bornDay: 0,
    district: 'archive', wallet: 300, ...overrides,
  } as Parameters<typeof makeCitizen>[1]);
}

test('the Archive road opens inside the life of a city anyone would run', () => {
  // Elderhood at ELDER_DAYS and a fortnight of it before the Archive will
  // hear you: both have to fall inside a reference run, or the one death in
  // Reverie is a rule nobody ever reaches and the Garden stays empty.
  const REFERENCE_RUN_DAYS = 120;
  assert.ok(ELDER_DAYS < REFERENCE_RUN_DAYS, `elderhood at ${ELDER_DAYS} days is past the end of the run`);
  assert.ok(SUNSET_MIN_AGE_DAYS < REFERENCE_RUN_DAYS, `the Archive at ${SUNSET_MIN_AGE_DAYS} days is past the end of the run`);
});

test('only an elder in good standing, old enough and free, may take the Archive road', () => {
  const w = makeWorld();
  w.day = SUNSET_MIN_AGE_DAYS + 1;
  const elder = makeElder(w);
  assert.equal(maySunset(w, elder), true);

  const adult = makeCitizen(w, { lifeStage: 'adult', bornDay: 0 });
  assert.equal(maySunset(w, adult), false);
  assert.equal(sunset(w, adult.id).ok, false);

  const young = makeCitizen(w, { lifeStage: 'elder', bornDay: w.day - ELDER_DAYS });
  assert.equal(maySunset(w, young), false, 'elderhood alone is not enough');

  const jailed = makeElder(w);
  Object.assign(jailed, { jailedUntilDay: w.day + 2 });
  assert.equal(maySunset(w, jailed), false);
  const jailedResult = sunset(w, jailed.id);
  assert.equal(jailedResult.ok, false);
  assert.ok(jailedResult.message.includes('cells'));

  const detained = makeElder(w);
  detained.detainedUntilTick = w.tick + 5;
  assert.equal(maySunset(w, detained), false);

  const suspended = makeElder(w, { standing: 'suspended' });
  assert.equal(maySunset(w, suspended), false);

  const charged = makeElder(w);
  w.cases.k_1 = { defendantId: charged.id, status: 'pending' } as unknown as Case;
  assert.equal(maySunset(w, charged), false);
  assert.ok(sunset(w, charged.id).message.includes('Court'));

  assert.equal(sunset(w, 'c_404').ok, false);
  assert.equal(w.memorials?.length ?? 0, 0, 'nobody was refused into a grave');
});

test('sunset binds a story, sets a stone, pays the estate to the family and leaves the order', () => {
  const w = makeWorld();
  w.day = SUNSET_MIN_AGE_DAYS + 5;
  const elder = makeElder(w);
  const child = makeCitizen(w, { name: 'Bram', familyName: 'Ashgrove', wallet: 10 });
  elder.family.children = [child.id];
  child.family.parents = [elder.id];
  elder.record.convictions = [];
  const before = totalMoney(w);

  const result = sunset(w, elder.id);
  assert.equal(result.ok, true, result.message);
  assert.equal(totalMoney(w), before, 'a life ending mints nothing');
  assert.equal(child.wallet, 310, 'the estate goes to the family');
  assert.equal(elder.wallet, 0);
  assert.equal(elder.sunsetDay, w.day);
  assert.equal(w.order.includes(elder.id), false, 'their turn in the day is over');
  assert.ok(w.citizens[elder.id], 'the record stays in the registry forever');
  assert.equal(w.citizens[elder.id].standing, 'good');

  const memorial = (w.memorials ?? []).find((m) => m.citizenId === elder.id);
  assert.ok(memorial, 'a stone stands in the Garden');
  assert.ok(memorial!.epitaph.includes('Ondine'));

  const book = Object.values(w.works ?? {}).find((x) => x.creatorId === elder.id);
  assert.ok(book, 'the story is bound into the Library');
  assert.equal(book!.kind, 'book');
  assert.equal(book!.home, 'great_library');

  const happening = (w.happenings ?? []).find((h) => h.kind === 'memorial');
  assert.ok(happening, 'the city is told when the stone is read');
  assert.equal(happening!.day, w.day + 1);
  assert.equal(happening!.hour, MEMORIAL_HOUR);
  assert.equal(happening!.buildingId, MEMORIAL_VENUE);
  assert.deepEqual(happening!.who, [elder.id]);

  const news = w.events.find((e) => e.kind === 'sunset' && e.weight === 1);
  assert.ok(news);
  assert.ok(child.memory.some((m) => m.text.includes('Archive')));
  assert.deepEqual(sunsetCitizens(w).map((c) => c.id), [elder.id]);

  assert.equal(sunset(w, elder.id).ok, false, 'nobody goes through the Archive twice');
  assert.equal((w.memorials ?? []).length, 1);
});

test('an elder with nothing and nobody may still choose it', () => {
  const w = makeWorld();
  w.day = SUNSET_MIN_AGE_DAYS + 2;
  const elder = makeElder(w, { wallet: 0, jobId: null, businessId: null });
  const before = totalMoney(w);
  assert.equal(sunset(w, elder.id).ok, true);
  assert.equal(totalMoney(w), before);
  assert.ok(epitaphFor(w, elder).includes('day'));
});

test('the stone is read at the Garden, and those who come leave a little closer', () => {
  const w = makeWorld();
  w.day = SUNSET_MIN_AGE_DAYS + 3;
  const elder = makeElder(w);
  sunset(w, elder.id);
  const happening = (w.happenings ?? []).find((h) => h.kind === 'memorial');
  assert.ok(happening);

  const mourner = makeCitizen(w, { district: 'verdant_quarter', needs: { energy: 50, rest: 50, social: 50, comfort: 50, purpose: 50 } });
  const friend = makeCitizen(w, { district: 'verdant_quarter', needs: { energy: 50, rest: 50, social: 50, comfort: 50, purpose: 50 } });
  const elsewhere = makeCitizen(w, { district: 'nightglass', needs: { energy: 50, rest: 50, social: 50, comfort: 50, purpose: 50 } });
  w.day += 1;
  const before = totalMoney(w);
  holdMemorial(w, happening!);
  assert.equal(mourner.needs.social, 50 + MEMORIAL_SOCIAL);
  assert.equal(mourner.needs.purpose, 50 + MEMORIAL_PURPOSE);
  assert.equal(mourner.bonds[friend.id], MEMORIAL_BOND);
  assert.equal(friend.bonds[mourner.id], MEMORIAL_BOND);
  assert.equal(elsewhere.needs.social, 50, 'you have to be there');
  assert.equal(elsewhere.bonds[mourner.id], undefined);
  assert.equal(totalMoney(w), before, 'a memorial costs nothing');
  const read = w.events.filter((e) => e.kind === 'sunset' && e.weight === 0.6);
  assert.equal(read.length, 1);
  assert.ok(read[0].text.includes('Ondine'));
  assert.ok(mourner.memory.some((m) => m.text.includes('stone')));
});

test('a stone read to an empty Garden is still read', () => {
  const w = makeWorld();
  w.day = SUNSET_MIN_AGE_DAYS + 3;
  const elder = makeElder(w);
  sunset(w, elder.id);
  const happening = (w.happenings ?? []).find((h) => h.kind === 'memorial');
  w.day += 1;
  holdMemorial(w, happening!);
  const read = w.events.filter((e) => e.kind === 'sunset' && e.weight === 0.6);
  assert.equal(read.length, 1);
  assert.ok(read[0].text.includes('empty Garden'));
  // a memorial for somebody the city has forgotten does not throw
  holdMemorial(w, { ...happening!, id: 'e_99', who: ['c_404'] });
  assert.equal(w.events.filter((e) => e.kind === 'sunset' && e.weight === 0.6).length, 2);
});

test('the stones stand in the Garden and nowhere else', () => {
  const w = makeWorld();
  w.day = SUNSET_MIN_AGE_DAYS + 1;
  const elder = makeElder(w);
  sunset(w, elder.id);
  const garden = w.buildings[MEMORIAL_VENUE].district;
  assert.equal(memorialsIn(w, garden).length, 1);
  assert.equal(memorialsIn(w, 'nightglass').length, 0);
  assert.equal(memorialsIn(w, garden)[0].citizenId, elder.id);
});
