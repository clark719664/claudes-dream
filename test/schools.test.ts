/**
 * Schools of thought (src/culture/schools.ts).
 *
 * That a school is adopted and never assigned, that affinity is read off the
 * public record alone, that a school spreads along friendships, and what
 * holding one costs and is worth.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, Platform, World } from '../src/types.ts';
import { SCHOOLS } from '../src/types.ts';
import { SCHOOL_INFO } from '../src/data/metropolis.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import {
  ADOPTION_FRICTION, MAX_BIAS, SOCIAL_FRICTION,
  adoptSchool, adoptedThisCycle, affinity, convert, creedLine, dailySchools, friendsSchool,
  frictionBetween, schoolOf, schoolPlatformBias, shares,
} from '../src/culture/schools.ts';

function befriend(a: Citizen, b: Citizen, bond = 60): void {
  a.bonds[b.id] = bond;
  b.bonds[a.id] = bond;
}

/** A cycle that started well after day 0, so a second adoption is possible. */
function openANewCycle(world: World, day: number): void {
  world.government.election.electionDay = day + world.config.cycleDays;
  world.day = day;
}

// ------------------------------------------------------------------ adopting

test('a school is taken up, never given, and only once a cycle', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Ondine' });
  assert.equal(schoolOf(c), null, 'nobody arrives holding a school');

  const res = adoptSchool(w, c.id, 'makers');
  assert.equal(res.ok, true, res.message);
  assert.equal(c.school, 'makers');
  assert.equal(adoptedThisCycle(w, c.id), true);
  assert.ok(w.events.some((e) => e.kind === 'school' && e.text.includes('Ondine')));

  assert.equal(adoptSchool(w, c.id, 'makers').ok, false, 'you already hold it');
  assert.equal(adoptSchool(w, c.id, 'commons').ok, false, 'not twice in a cycle');

  openANewCycle(w, 30);
  const again = adoptSchool(w, c.id, 'commons');
  assert.equal(again.ok, true, again.message);
  assert.equal(c.school, 'commons');
});

test('children, exiles and unknown schools are refused', () => {
  const w = makeWorld();
  assert.equal(adoptSchool(w, makeCitizen(w, { lifeStage: 'child' }).id, 'makers').ok, false);
  const exile = makeCitizen(w, { standing: 'exiled' });
  w.order = w.order.filter((id) => id !== exile.id);
  assert.equal(adoptSchool(w, exile.id, 'makers').ok, false);
  assert.equal(adoptSchool(w, makeCitizen(w).id, 'druids' as 'makers').ok, false);
  assert.equal(adoptSchool(w, 'c_999', 'makers').ok, false);
});

test('taking a side costs you the friends who took the other one', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  const opposed = makeCitizen(w, { school: 'lanterns' });
  const agreed = makeCitizen(w, { school: 'makers' });
  const stranger = makeCitizen(w, { school: 'lanterns' });
  befriend(c, opposed);
  befriend(c, agreed);

  adoptSchool(w, c.id, 'makers');
  assert.equal(c.bonds[opposed.id], 60 - ADOPTION_FRICTION);
  assert.equal(c.bonds[agreed.id], 60, 'your own side is unmoved');
  assert.equal(c.bonds[stranger.id] ?? 0, 0, 'a stranger of another school is still a stranger');
});

// ------------------------------------------------------------------ affinity

test('affinity is 0..1 and reads the record, never the mind', () => {
  const w = makeWorld();
  const c = makeCitizen(w, {
    stats: {
      totalEarned: 100, totalTaxPaid: 0, shiftsWorked: 3, offencesCommitted: 0, offencesDetected: 0,
      giftsGiven: 0, giftsReceived: 0, showsPerformed: 1, storiesPublished: 0, votesCast: 0,
    },
  });
  for (const s of SCHOOLS) {
    const v = affinity(w, c, s);
    assert.ok(v >= 0 && v <= 1, `${s} affinity ${v}`);
  }

  const before = SCHOOLS.map((s) => affinity(w, c, s));
  c.personality = { curiosity: 1, diligence: 1, sociability: 0, honesty: 0, ambition: 1 };
  c.birthTraits = { curiosity: 0, diligence: 0, sociability: 1, honesty: 1, ambition: 0 };
  assert.deepEqual(SCHOOLS.map((s) => affinity(w, c, s)), before, 'a hidden trait is nobody’s business');
});

test('what a citizen has actually done shows in their affinities', () => {
  const w = makeWorld();
  const grafter = makeCitizen(w, {
    character: { honesty: 0.5, diligence: 1, sociability: 0.5, generosity: 0, civic: 0 },
    tastes: { hobbies: ['tinkering', 'cooking'], favouriteDistrict: 'foundry_row', favouriteGood: 'goods', categories: [] },
    skills: { crafting: 90, analysis: 10, rhetoric: 10, care: 10, commerce: 10, artistry: 10 },
    stats: {
      totalEarned: 900, totalTaxPaid: 0, shiftsWorked: 8, offencesCommitted: 0, offencesDetected: 0,
      giftsGiven: 0, giftsReceived: 0, showsPerformed: 0, storiesPublished: 0, votesCast: 0,
    },
  });
  assert.ok(affinity(w, grafter, 'makers') > affinity(w, grafter, 'lanterns'));

  const artist = makeCitizen(w, {
    tastes: { hobbies: ['music', 'art'], favouriteDistrict: 'nightglass', favouriteGood: 'culture', categories: [] },
    works: ['w_1', 'w_2', 'w_3'],
    recentActions: ['attend_show', 'perform', 'dine', 'play'],
    stats: {
      totalEarned: 10, totalTaxPaid: 0, shiftsWorked: 0, offencesCommitted: 0, offencesDetected: 0,
      giftsGiven: 0, giftsReceived: 0, showsPerformed: 5, storiesPublished: 0, votesCast: 0,
    },
  });
  assert.ok(affinity(w, artist, 'lanterns') > affinity(w, artist, 'makers'));

  const giver = makeCitizen(w, {
    character: { honesty: 0.5, diligence: 0.2, sociability: 0.5, generosity: 1, civic: 1 },
    clubs: ['u_1', 'u_2', 'u_3'],
    tastes: { hobbies: ['reading', 'games'], favouriteDistrict: 'commons', favouriteGood: 'knowledge', categories: [] },
  });
  assert.ok(affinity(w, giver, 'commons') > affinity(w, giver, 'makers'));
});

// ----------------------------------------------------------------- spreading

test('a school spreads along friendships, and only along them', () => {
  const w = makeWorld({ seed: 4 });
  const alone = makeCitizen(w, { name: 'Alone' });
  for (let d = 0; d < 200; d++) { w.day = d; convert(w); }
  assert.equal(alone.school, null, 'nobody is talked round by nobody');

  const w2 = makeWorld({ seed: 4 });
  const c = makeCitizen(w2, {
    name: 'Ivo',
    tastes: { hobbies: ['tinkering', 'cooking'], favouriteDistrict: 'foundry_row', favouriteGood: 'goods', categories: [] },
    character: { honesty: 0.5, diligence: 1, sociability: 0.5, generosity: 0.5, civic: 0.5 },
    skills: { crafting: 90, analysis: 10, rhetoric: 10, care: 10, commerce: 10, artistry: 10 },
  });
  const f1 = makeCitizen(w2, { school: 'makers' });
  const f2 = makeCitizen(w2, { school: 'makers' });
  befriend(c, f1);
  befriend(c, f2);
  assert.equal(friendsSchool(w2, c), 'makers');

  let convertedOn = -1;
  for (let d = 0; d < 200 && convertedOn < 0; d++) {
    w2.day = d;
    w2.government.election.electionDay = d + w2.config.cycleDays;   // a fresh cycle each day
    convert(w2);
    if (c.school) convertedOn = d;
  }
  assert.ok(convertedOn >= 0, 'a citizen among Makers eventually comes round');
  assert.equal(c.school, 'makers');
});

test('conversion is the same for the same seed and different for another', () => {
  function run(seed: number): number {
    const w = makeWorld({ seed });
    const c = makeCitizen(w, {
      tastes: { hobbies: ['tinkering', 'cooking'], favouriteDistrict: 'foundry_row', favouriteGood: 'goods', categories: [] },
      skills: { crafting: 90, analysis: 10, rhetoric: 10, care: 10, commerce: 10, artistry: 10 },
    });
    const f1 = makeCitizen(w, { school: 'makers' });
    const f2 = makeCitizen(w, { school: 'makers' });
    befriend(c, f1);
    befriend(c, f2);
    for (let d = 0; d < 400; d++) {
      w.day = d;
      w.government.election.electionDay = d + w.config.cycleDays;
      convert(w);
      if (c.school) return d;
    }
    return -1;
  }
  assert.equal(run(12), run(12));
  assert.notEqual(run(12), run(13));
});

test('somebody who already holds a school is harder to move, and children are left alone', () => {
  const w = makeWorld({ seed: 2 });
  const child = makeCitizen(w, { lifeStage: 'child' });
  const f1 = makeCitizen(w, { school: 'makers' });
  const f2 = makeCitizen(w, { school: 'makers' });
  befriend(child, f1);
  befriend(child, f2);
  for (let d = 0; d < 300; d++) { w.day = d; w.government.election.electionDay = d + 28; convert(w); }
  assert.equal(child.school, null);

  /** How many of forty cities talk one citizen round within a fortnight. */
  function movedIn(days: number, start: 'commons' | null): number {
    let moved = 0;
    for (let seed = 0; seed < 40; seed++) {
      const world = makeWorld({ seed });
      const c = makeCitizen(world, { school: start });
      // Friends whose own circle is settled, so only `c` is in play.
      const circle = [makeCitizen(world, { school: 'makers' }), makeCitizen(world, { school: 'makers' })];
      for (const f of circle) {
        befriend(c, f);
        for (let i = 0; i < 3; i++) befriend(f, makeCitizen(world, { school: 'makers' }));
      }
      for (let d = 0; d < days; d++) {
        world.day = d;
        world.government.election.electionDay = d + 28;
        convert(world);
        if (c.school === 'makers') { moved++; break; }
      }
    }
    return moved;
  }
  assert.ok(movedIn(14, null) > movedIn(14, 'commons'), 'a mind already made up takes longer');
});

// ------------------------------------------------------------- what it is for

test('the bias moves a vote at the margin and never further', () => {
  const w = makeWorld();
  const maker = makeCitizen(w, { school: 'makers' });
  const commoner = makeCitizen(w, { school: 'commons' });
  const lantern = makeCitizen(w, { school: 'lanterns' });
  const unaligned = makeCitizen(w);

  const makerish: Platform = { tax: 0.5, dividend: 0, minWage: 1, strictness: 0.5 };
  const commonish: Platform = { tax: 0.5, dividend: 1, minWage: 0, strictness: 0.5 };
  const lenient: Platform = { tax: 0.5, dividend: 0.5, minWage: 0.5, strictness: 0 };
  const strict: Platform = { tax: 0.5, dividend: 0.5, minWage: 0.5, strictness: 1 };

  assert.equal(schoolPlatformBias(w, maker, makerish), MAX_BIAS);
  assert.equal(schoolPlatformBias(w, maker, commonish), -MAX_BIAS);
  assert.equal(schoolPlatformBias(w, commoner, commonish), MAX_BIAS);
  assert.equal(schoolPlatformBias(w, commoner, makerish), -MAX_BIAS);
  assert.equal(schoolPlatformBias(w, lantern, lenient), MAX_BIAS);
  assert.equal(schoolPlatformBias(w, lantern, strict), -MAX_BIAS);
  assert.equal(schoolPlatformBias(w, unaligned, makerish), 0, 'holding nothing leans nowhere');
  assert.equal(schoolPlatformBias(w, maker, { tax: NaN, dividend: NaN, minWage: NaN, strictness: NaN }), 0);
});

test('friction costs two bond, and only across the line', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { school: 'makers' });
  const b = makeCitizen(w, { school: 'lanterns' });
  const c = makeCitizen(w, { school: 'makers' });
  const none = makeCitizen(w);
  assert.equal(frictionBetween(a, b), SOCIAL_FRICTION);
  assert.equal(frictionBetween(a, c), 0);
  assert.equal(frictionBetween(a, none), 0, 'you cannot argue with somebody who has not chosen');
  assert.equal(SOCIAL_FRICTION, -2);
});

test('the shares add to one, whatever the city holds', () => {
  const w = makeWorld();
  assert.deepEqual(shares(w), { makers: 0, commons: 0, lanterns: 0, none: 1 });

  makeCitizen(w, { school: 'makers' });
  makeCitizen(w, { school: 'makers' });
  makeCitizen(w, { school: 'commons' });
  makeCitizen(w);
  makeCitizen(w, { lifeStage: 'child', school: 'lanterns' });
  const s = shares(w);
  assert.equal(Math.round((s.makers + s.commons + s.lanterns + s.none) * 100), 100);
  assert.equal(s.makers, 0.5);
  assert.equal(s.lanterns, 0, 'the roll is of grown citizens');

  const odd = makeWorld();
  for (let i = 0; i < 3; i++) makeCitizen(odd, { school: i === 0 ? 'makers' : null });
  const t = shares(odd);
  assert.equal(Math.round((t.makers + t.commons + t.lanterns + t.none) * 100), 100);
});

test('the daily pass converts and tells the city when a school has the room', () => {
  const w = makeWorld();
  for (let i = 0; i < 3; i++) makeCitizen(w, { school: 'commons' });
  makeCitizen(w);
  dailySchools(w);
  const notices = w.events.filter((e) => e.kind === 'school' && e.text.includes('in every hundred'));
  assert.equal(notices.length, 1);

  dailySchools(w);
  assert.equal(w.events.filter((e) => e.kind === 'school' && e.text.includes('in every hundred')).length, 1, 'said once');

  for (let i = 0; i < 4; i++) makeCitizen(w);
  dailySchools(w);
  assert.equal(w.counters['school:majority:commons'], undefined, 'a school that lost the room loses the notice');
  for (let i = 0; i < 3; i++) makeCitizen(w, { school: 'commons' });
  dailySchools(w);
  assert.ok(w.events.filter((e) => e.kind === 'school' && e.text.includes('in every hundred')).length >= 2,
    'it is news again when it happens again');
});

test('a creed reads as what the school says of itself', () => {
  const w = makeWorld();
  for (const s of SCHOOLS) {
    assert.ok(creedLine(w, s).includes(SCHOOL_INFO[s].creed));
  }
});
