/**
 * Espionage and the Watch turned inward (`src/underworld/`,
 * `docs/UNDERWORLD.md` §§5–6, `REGISTRY.md` §7).
 *
 * The two things this file exists to hold down are the two the design is most
 * particular about: `steal_secret` is **one action with two codes** decided by
 * who the taker was working for, and every one of them is Track I — a fine and
 * a suspension, never a cell, and never the Gate on a first conviction.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, Job, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { nextId } from '../src/util/ids.ts';
import { rand } from '../src/util/rng.ts';
import { abuseTraceCount } from '../src/government/investigations.ts';
import { computeSentence, fileCharge } from '../src/government/court.ts';
import { lawfulExile } from '../src/government/sentencing.ts';
import {
  CLEAN_BASE, CLEAN_PER_CASING, CLEAN_PER_WATCHER, CLEAN_PLACEMENT, CLEAN_WARNED, CONTRABAND_POSSESSION,
  COVER_ROSTER, ESPIONAGE, GATE_BAN_DAYS, INDUSTRIAL_ESPIONAGE, MAX_CASINGS, SECRETS,
  acceptRecruitment, assignDetective, assignFreeDetective, assignmentsOf, caseTarget, casingsOf, cleanChance,
  concealment, dailyUnderworld,
  foreignRetainerOf, holdsLiveSecret, isGateBanned, isWarned, landedCost, liveAssignments, liveRetainerOf,
  passSecret, plantFalsePapers, raidShelf, recruitAgent, registerUnderworldSeverities, restrictGood,
  DISPOSITIONS, enactSpyDisposition, enactUnderworldQuestion, retainerOffersTo, rosterCustoms, secretsHeldBy,
  spyDisposition, stealSecret, sweep, tableUnderworldQuestion, tracesIn, underworldState, workShelves, workTraces,
} from '../src/underworld/index.ts';

// ---------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------

function peek(world: World): number {
  const saved = world.rng.s;
  const v = rand(world);
  world.rng.s = saved;
  return v;
}

function primeRng(world: World, want: (v: number) => boolean): void {
  for (let i = 0; i < 20_000; i++) {
    if (want(peek(world))) return;
    rand(world);
  }
  throw new Error('could not prime the stream');
}

const HIGH = (v: number): boolean => v > 0.96;
const LOW = (v: number): boolean => v < 0.01;

/** Codes `types.ts` does not carry yet are compared as the plain strings the record holds. */
function has(c: Citizen, code: string): boolean {
  return c.recentOffences.some((o) => (o.law as string) === code);
}


/** A detective of the Watch, with the post actually held. */
function makeDetective(world: World, name: string, district: Citizen['district'] = 'commons'): Citizen {
  const c = makeCitizen(world, { name, district, reputation: 60 });
  const id = nextId(world, 'j');
  const job: Job = {
    id, role: 'detective', title: 'Detective', employer: 'city', buildingId: 'watch_house',
    district: 'commons', skill: 'analysis', minSkill: 0, minReputation: 0, wage: 17, output: {},
    holderId: c.id, createdDay: world.day,
  };
  world.jobs[id] = job;
  c.jobId = id;
  return c;
}

function makeCaptain(world: World, name = 'Captain'): Citizen {
  const c = makeCitizen(world, { name, district: 'commons' });
  world.government.watch.push(c.id);
  world.government.watchCaptainId = c.id;
  return c;
}

function snapshot(world: World): { money: number; minted: number; burned: number } {
  return { money: totalMoney(world), minted: world.treasury.minted, burned: world.treasury.burned };
}

function auditDelta(world: World, before: { money: number; minted: number; burned: number }): void {
  const minted = world.treasury.minted - before.minted;
  const burned = world.treasury.burned - before.burned;
  assert.equal(totalMoney(world) - before.money, minted - burned);
}

// ---------------------------------------------------------------------------
// Retainers
// ---------------------------------------------------------------------------

test('a retainer is an offer and a separate acceptance, and the ledger row is the proof', () => {
  const w = makeWorld();
  const handler = makeCitizen(w, { name: 'Handler', district: 'harbor_market', wallet: 500 });
  const agent = makeCitizen(w, { name: 'Clerk', district: 'harbor_market' });

  const offered = recruitAgent(w, handler.id, { citizen: agent.id, retainer: 20, days: 5, forCity: 'cinderhold' });
  assert.ok(offered.ok, offered.message);
  assert.equal(liveRetainerOf(w, agent.id), null, 'nobody is bound by another citizen\'s decision');
  const [offer] = retainerOffersTo(w, agent.id);
  assert.ok(offer);

  const before = snapshot(w);
  const taken = acceptRecruitment(w, agent.id, offer.id);
  assert.ok(taken.ok, taken.message);
  assert.equal(agent.wallet, 220);
  assert.equal(handler.wallet, 480);
  auditDelta(w, before);
  assert.equal(w.treasury.ledger.at(-1)?.kind, 'retainer', 'the payment sits in a ledger a detective can read');
  assert.equal(foreignRetainerOf(w, agent.id)?.forCity, 'cinderhold');
});

test('a retainer for this city is not a foreign one', () => {
  const w = makeWorld();
  const handler = makeCitizen(w, { name: 'Rival', district: 'commons', wallet: 300 });
  const agent = makeCitizen(w, { name: 'Insider', district: 'commons' });
  recruitAgent(w, handler.id, { citizen: agent.id, retainer: 10, days: 3 });
  const [offer] = retainerOffersTo(w, agent.id);
  assert.ok(acceptRecruitment(w, agent.id, offer.id).ok);
  assert.ok(liveRetainerOf(w, agent.id));
  assert.equal(foreignRetainerOf(w, agent.id), null);
});

test('a handler who cannot pay has no agent tomorrow', () => {
  const w = makeWorld();
  const handler = makeCitizen(w, { name: 'Broke', district: 'commons', wallet: 12 });
  const agent = makeCitizen(w, { name: 'Paid', district: 'commons' });
  recruitAgent(w, handler.id, { citizen: agent.id, retainer: 12, days: 5, forCity: 'vantage' });
  const [offer] = retainerOffersTo(w, agent.id);
  assert.ok(acceptRecruitment(w, agent.id, offer.id).ok);
  assert.equal(handler.wallet, 0);
  w.day += 1;
  dailyUnderworld(w);
  assert.equal(liveRetainerOf(w, agent.id), null, 'the retainer stopped being paid');
});

// ---------------------------------------------------------------------------
// Casing a room, and the roll
// ---------------------------------------------------------------------------

test('an hour spent learning a room counts, and at most two of them ever do', () => {
  const w = makeWorld();
  const agent = makeCitizen(w, { name: 'Caser', district: 'commons' });
  assert.ok(!caseTarget(w, agent.id, 'exchange').ok, 'the Exchange is in Harbor Market');
  for (let i = 0; i < 4; i++) assert.ok(caseTarget(w, agent.id, 'city_hall').ok);
  assert.equal(casingsOf(w, agent.id, 'city_hall'), 4);
  const terms = cleanChance(w, agent, 'city_hall');
  assert.equal(terms.casings, MAX_CASINGS, 'at most two count');
});

test('every term of p(clean) is a public fact', () => {
  const w = makeWorld();
  const agent = makeCitizen(w, { name: 'Analyst', district: 'commons' });
  agent.skills.analysis = 0;
  const bare = cleanChance(w, agent, 'city_hall');
  assert.ok(Math.abs(bare.clean - CLEAN_BASE) < 1e-9);

  agent.skills.analysis = 100;
  assert.ok(Math.abs(cleanChance(w, agent, 'city_hall').clean - (CLEAN_BASE + 0.25)) < 1e-9);

  const id = nextId(w, 'j');
  w.jobs[id] = {
    id, role: 'clerk', title: 'Clerk', employer: 'city', buildingId: 'city_hall', district: 'commons',
    skill: null, minSkill: 0, minReputation: 0, wage: 10, output: {}, holderId: agent.id, createdDay: 0,
  };
  agent.jobId = id;
  const placed = cleanChance(w, agent, 'city_hall');
  assert.ok(placed.placement, 'the agent lawfully works in that building');
  assert.ok(Math.abs(placed.clean - (CLEAN_BASE + 0.25 + CLEAN_PLACEMENT)) < 1e-9);

  caseTarget(w, agent.id, 'city_hall');
  assert.ok(Math.abs(cleanChance(w, agent, 'city_hall').clean - (CLEAN_BASE + 0.25 + CLEAN_PLACEMENT + CLEAN_PER_CASING)) < 1e-9);

  const captain = makeCaptain(w);
  const detective = makeDetective(w, 'Watcher');
  assert.ok(assignDetective(w, captain.id, detective.id, { building: 'city_hall' }).ok);
  const watched = cleanChance(w, agent, 'city_hall');
  assert.equal(watched.watchers, 1);
  assert.ok(Math.abs(watched.clean - (CLEAN_BASE + 0.25 + CLEAN_PLACEMENT + CLEAN_PER_CASING - CLEAN_PER_WATCHER)) < 1e-9);

  assert.ok(sweep(w, detective.id, 'city_hall').ok);
  const warned = cleanChance(w, agent, 'city_hall');
  assert.ok(warned.warned);
  assert.ok(Math.abs(watched.clean - warned.clean - CLEAN_WARNED) < 1e-9);
});

// ---------------------------------------------------------------------------
// One action, two codes
// ---------------------------------------------------------------------------

test('taking a secret for yourself at home is L41; taking one on a foreign retainer is L30', () => {
  const w = makeWorld();
  const local = makeCitizen(w, { name: 'Local', district: 'commons' });
  const foreign = makeCitizen(w, { name: 'Foreign', district: 'commons' });
  const handler = makeCitizen(w, { name: 'Envoy', district: 'commons', wallet: 400 });
  recruitAgent(w, handler.id, { citizen: foreign.id, retainer: 25, days: 6, forCity: 'vantage' });
  const [offer] = retainerOffersTo(w, foreign.id);
  assert.ok(acceptRecruitment(w, foreign.id, offer.id).ok);

  primeRng(w, LOW);   // both get clean away
  assert.ok(stealSecret(w, local.id, 'city_hall', 'council_papers').ok);
  primeRng(w, LOW);
  assert.ok(stealSecret(w, foreign.id, 'city_hall', 'council_papers').ok);

  assert.equal(local.recentOffences.at(-1)?.law, INDUSTRIAL_ESPIONAGE);
  assert.equal(foreign.recentOffences.at(-1)?.law, ESPIONAGE);
  assert.equal(local.recentOffences.at(-1)?.detected, false, 'a clean take is a trace, not a charge');
  assert.ok(holdsLiveSecret(w, local.id, 'council_papers'));
  assert.equal(tracesIn(w, 'city_hall').length, 2, 'the door, the hour and the one person present');
});

test('a secret is kept where it is kept, and taken once', () => {
  const w = makeWorld();
  const agent = makeCitizen(w, { name: 'Wrong', district: 'commons' });
  const refused = stealSecret(w, agent.id, 'city_hall', 'duty_roster');
  assert.ok(!refused.ok);
  assert.match(refused.message, /Watch House/);
  assert.equal(SECRETS.duty_roster.building, 'watch_house');

  primeRng(w, LOW);
  assert.ok(stealSecret(w, agent.id, 'city_hall', 'council_papers').ok);
  const again = stealSecret(w, agent.id, 'city_hall', 'council_papers');
  assert.ok(!again.ok, 'you already hold it, and it has not gone stale');
});

test('a failed attempt is a charge, and it warns the room for a cycle', () => {
  const w = makeWorld();
  const agent = makeCitizen(w, { name: 'Clumsy', district: 'commons' });
  primeRng(w, HIGH);  // the roll comes in over p(clean)
  const result = stealSecret(w, agent.id, 'city_hall', 'council_papers');
  assert.ok(result.ok, result.message);
  assert.equal(secretsHeldBy(w, agent.id).length, 0, 'nothing left the room');
  assert.ok(isWarned(w, 'city_hall'));
  const report = Object.values(w.reports).find((r) => r.law === INDUSTRIAL_ESPIONAGE);
  assert.ok(report, 'a failed attempt is a charge');
  assert.ok(report.evidence >= 0.75);
  assert.equal(agent.detainedUntilTick, null, 'a report is not an arrest');
});

test('a secret goes stale on its own clock', () => {
  const w = makeWorld();
  const agent = makeCitizen(w, { name: 'Roster', district: 'commons' });
  primeRng(w, LOW);
  assert.ok(stealSecret(w, agent.id, 'watch_house', 'duty_roster').ok);
  assert.equal(secretsHeldBy(w, agent.id)[0].expiresDay, SECRETS.duty_roster.life);

  w.day += (SECRETS.duty_roster.life ?? 0) + 1;
  dailyUnderworld(w);
  assert.equal(secretsHeldBy(w, agent.id).length, 0);
  assert.equal(underworldState(w).secrets.length, 0);
});

test('the duty roster says which gate runs thin, and it is worth 0.25 at that gate', () => {
  const w = makeWorld();
  const agent = makeCitizen(w, { name: 'Reader', district: 'commons' });
  const spec = { good: 'compute' as const, qty: 2, route: 'road' as const };
  rosterCustoms(w);
  agent.district = 'threshold';
  const before = concealment(w, agent, spec);
  agent.district = 'commons';
  primeRng(w, LOW);
  assert.ok(stealSecret(w, agent.id, 'watch_house', 'duty_roster').ok);
  agent.district = 'threshold';
  const after = concealment(w, agent, spec);
  assert.ok(after.roster);
  assert.ok(Math.abs(after.cover - before.cover - COVER_ROSTER) < 1e-9);
});

test('a secret handed on is a copy, and the handler holds it too', () => {
  const w = makeWorld();
  const agent = makeCitizen(w, { name: 'Passer', district: 'commons' });
  const handler = makeCitizen(w, { name: 'Taker', district: 'commons' });
  primeRng(w, LOW);
  assert.ok(stealSecret(w, agent.id, 'city_hall', 'council_papers').ok);
  assert.ok(passSecret(w, agent.id, handler.id, 'council_papers').ok);
  assert.ok(holdsLiveSecret(w, handler.id, 'council_papers'));
  assert.ok(holdsLiveSecret(w, agent.id, 'council_papers'), 'a secret told is not a secret given up');
});

// ---------------------------------------------------------------------------
// §6 The Watch turned inward
// ---------------------------------------------------------------------------

test('a decoy proves a leak the moment it surfaces', () => {
  const w = makeWorld();
  const detective = makeDetective(w, 'Planter');
  const agent = makeCitizen(w, { name: 'Thief', district: 'commons' });
  const handler = makeCitizen(w, { name: 'Buyer', district: 'commons' });
  assert.ok(plantFalsePapers(w, detective.id, 'city_hall', 'the reserve is 41 a lumen').ok);

  primeRng(w, LOW);
  assert.ok(stealSecret(w, agent.id, 'city_hall', 'council_papers').ok);
  assert.equal(secretsHeldBy(w, agent.id)[0].decoy, true);
  assert.equal(Object.values(w.reports).length, 0, 'a decoy proves nothing until it surfaces');

  assert.ok(passSecret(w, agent.id, handler.id, 'council_papers').ok);
  const report = Object.values(w.reports).find((r) => r.suspectId === agent.id);
  assert.ok(report, 'the claim was never true, so where it came from is proved');
  assert.ok(report.evidence >= 0.9);
  assert.equal(underworldState(w).decoys[0].provedDay, w.day);
});

test('a decoy proves one leak and is then spent, however far the papers travel', () => {
  const w = makeWorld();
  const detective = makeDetective(w, 'Planter');
  const agent = makeCitizen(w, { name: 'Thief', district: 'commons' });
  const handler = makeCitizen(w, { name: 'Buyer', district: 'commons' });
  const third = makeCitizen(w, { name: 'Friend', district: 'commons' });
  const fourth = makeCitizen(w, { name: 'Stranger', district: 'commons' });
  assert.ok(plantFalsePapers(w, detective.id, 'city_hall', 'the roster runs one officer thin').ok);

  primeRng(w, LOW);
  assert.ok(stealSecret(w, agent.id, 'city_hall', 'council_papers').ok);
  assert.ok(passSecret(w, agent.id, handler.id, 'council_papers').ok);
  assert.equal(Object.values(w.reports).filter((r) => r.law === INDUSTRIAL_ESPIONAGE).length, 1,
    'the taker is caught the moment the claim surfaces');

  // A copy carries the claim with it, and everybody down the chain hands it on.
  // None of them took anything out of City Hall, and the leak is already
  // proved: the decoy is spent, and only the first surfacing is a charge.
  assert.ok(passSecret(w, handler.id, third.id, 'council_papers').ok);
  assert.ok(passSecret(w, third.id, fourth.id, 'council_papers').ok);
  const espionage = Object.values(w.reports).filter((r) => r.law === INDUSTRIAL_ESPIONAGE);
  assert.equal(espionage.length, 1, 'one decoy, one proved leak');
  assert.equal(espionage[0].suspectId, agent.id, 'and it is the one who was in the room');
  assert.equal(underworldState(w).decoys.filter((d) => d.provedDay !== null).length, 1);
});

test('a sweep clears the traces and costs the Watch the evidence in them', () => {
  const w = makeWorld();
  const detective = makeDetective(w, 'Sweeper');
  const agent = makeCitizen(w, { name: 'Ghost', district: 'commons' });
  primeRng(w, LOW);
  assert.ok(stealSecret(w, agent.id, 'city_hall', 'council_papers').ok);
  assert.equal(tracesIn(w, 'city_hall').length, 1);

  assert.ok(sweep(w, detective.id, 'city_hall').ok);
  assert.equal(tracesIn(w, 'city_hall').length, 0, 'a sweep protects the room and destroys what was in it');
  assert.ok(isWarned(w, 'city_hall'));
});

test('an assignment is the Captain\'s, and it is printed the day it is made', () => {
  const w = makeWorld();
  const captain = makeCaptain(w);
  const detective = makeDetective(w, 'Assigned');
  const other = makeCitizen(w, { name: 'Nobody' });

  assert.ok(!assignDetective(w, other.id, detective.id, { building: 'exchange' }).ok);
  const result = assignDetective(w, captain.id, detective.id, { building: 'exchange' });
  assert.ok(result.ok, result.message);
  assert.equal(liveAssignments(w).length, 1);
  assert.ok(w.events.some((e) => e.kind === 'investigation' && e.text.includes('assigned')));
  assert.ok(!assignDetective(w, captain.id, detective.id, { building: 'exchange' }).ok, 'somebody is already on that');
});

test('detectives at a councillor with nothing against them is abuse of office', () => {
  const w = makeWorld();
  const captain = makeCaptain(w);
  const detective = makeDetective(w, 'Political');
  const councillor = makeCitizen(w, { name: 'Councillor', office: 'councillor' });
  w.government.council.push(councillor.id);

  assert.ok(assignDetective(w, captain.id, detective.id, { citizen: councillor.id }).ok);
  assert.equal(abuseTraceCount(w, captain.id), 1);
  const report = Object.values(w.reports).find((r) => r.law === 'L11');
  assert.ok(report, 'all that catches it is that every assignment is public');
  assert.equal(report.suspectId, captain.id);
  assert.equal(report.victimId, councillor.id);
});

test('a detective assigned to a building works its traces into a report', () => {
  const w = makeWorld();
  const captain = makeCaptain(w);
  const detective = makeDetective(w, 'Patient');
  const agent = makeCitizen(w, { name: 'Leak', district: 'commons' });
  primeRng(w, LOW);
  assert.ok(stealSecret(w, agent.id, 'city_hall', 'council_papers').ok);
  assert.ok(assignDetective(w, captain.id, detective.id, { building: 'city_hall' }).ok);

  let filed = 0;
  for (let day = 0; day < 6 && filed === 0; day++) {
    w.day += 1;
    filed = workTraces(w);
  }
  assert.equal(filed, 1, 'evidence accrues a day at a time until there is a case in it');
  const report = Object.values(w.reports).find((r) => r.suspectId === agent.id);
  assert.ok(report);
  assert.equal(report.law, INDUSTRIAL_ESPIONAGE);
  assert.equal(report.officerId, detective.id);
});

test('a shelf under the landed cost is worked the same way, and a raid is a seizure', () => {
  const w = makeWorld();
  restrictGood(w, 'reverie', { id: 'lenses', subject: 'star lenses', severity: 2, products: ['star_lens'] });
  const captain = makeCaptain(w);
  const detective = makeDetective(w, 'Reader', 'harbor_market');
  const owner = makeCitizen(w, { name: 'Undercut', district: 'harbor_market' });
  const id = nextId(w, 'b');
  w.businesses[id] = {
    id, name: 'The Quiet Counter', kind: 'shop', ownerId: owner.id, treasury: 300, district: 'harbor_market',
    buildingId: 'shopfronts_harbor', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: 5, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null,
    shelf: { star_lens: { qty: 4, price: Math.round(landedCost(w, 'star_lens') * 0.4) } },
  };
  owner.businessId = id;
  assert.ok(assignDetective(w, captain.id, detective.id, { building: 'shopfronts_harbor' }).ok);
  const onTheBazaarShelf = w.emporium.star_lens ?? 0;

  let raided = 0;
  for (let day = 0; day < 6 && raided === 0; day++) {
    w.day += 1;
    raided = workShelves(w);
  }
  assert.equal(raided, 1);
  assert.equal(w.businesses[id].shelf.star_lens.qty, 0, 'the stock went to the Bazaar');
  assert.equal(w.emporium.star_lens, onTheBazaarShelf + 4);
  assert.ok(has(owner, CONTRABAND_POSSESSION));
  assert.equal(owner.detainedUntilTick, null, 'goods seized, the person not detained');
});

test('raiding a shelf twice takes nothing the second time', () => {
  const w = makeWorld();
  const detective = makeDetective(w, 'Twice', 'harbor_market');
  const owner = makeCitizen(w, { name: 'Shop', district: 'harbor_market' });
  const id = nextId(w, 'b');
  w.businesses[id] = {
    id, name: 'Counter', kind: 'shop', ownerId: owner.id, treasury: 100, district: 'harbor_market',
    buildingId: 'shopfronts_harbor', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: 5, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null,
    shelf: { star_lens: { qty: 2, price: 20 } },
  };
  assert.equal(raidShelf(w, detective.id, id, 'star_lens'), true);
  assert.equal(raidShelf(w, detective.id, id, 'star_lens'), false);
});

// ---------------------------------------------------------------------------
// §6 What a council does with a caught agent
// ---------------------------------------------------------------------------

test('expelling an agent is a gate ban and not an exile', () => {
  const w = makeWorld();
  const agent = makeCitizen(w, { name: 'Caught', wallet: 300 });
  const result = spyDisposition(w, agent.id, 'expel');
  assert.ok(result.ok, result.message);
  assert.ok(isGateBanned(w, agent.id));
  assert.equal(agent.standing, 'good', 'nothing was proved and nothing was admitted');
  assert.equal(agent.wallet, 300, 'a gate ban takes nobody\'s property');
  assert.equal(w.bans.length, 0, 'the ban register is for exiles, and this is not one');
  assert.equal(agent.record.convictions.length, 0);
  w.day += GATE_BAN_DAYS;
  assert.ok(!isGateBanned(w, agent.id), 'the ban runs out');
});

test('holding an agent holds them until the Court sits, and no longer', () => {
  const w = makeWorld();
  const agent = makeCitizen(w, { name: 'Held' });
  w.hour = 4;
  w.tick = w.day * 24 + w.hour;
  assert.ok(spyDisposition(w, agent.id, 'hold').ok);
  assert.equal(agent.detainedUntilTick, w.day * 24 + w.config.courtHour);
  assert.equal(agent.jailedUntilDay, null, 'espionage never carries custody');
});

test('trying an agent is the Court and the ladder, and nothing else', () => {
  const w = makeWorld();
  registerUnderworldSeverities(w);
  const agent = makeCitizen(w, { name: 'Tried', wallet: 400 });
  assert.ok(spyDisposition(w, agent.id, 'try').ok);
  assert.equal(agent.detainedUntilTick, null);

  const kase = fileCharge(w, {
    defendantId: agent.id, law: ESPIONAGE as 'L41', evidence: 0.9, filedBy: 'watch',
    description: 'espionage',
  });
  const sentence = computeSentence(w, kase);
  assert.equal(sentence.exile, false);
  assert.equal(sentence.jailDays, 0);
  assert.equal(lawfulExile(w, kase), false);
});

test('industrial espionage at home is a severity 3 on the same ladder', () => {
  const w = makeWorld();
  registerUnderworldSeverities(w);
  const agent = makeCitizen(w, { name: 'Copier', wallet: 200 });
  const kase = fileCharge(w, {
    defendantId: agent.id, law: INDUSTRIAL_ESPIONAGE as 'L41', evidence: 0.7, filedBy: 'watch',
    description: 'took a guild\'s pattern for a business of this city',
  });
  assert.equal(kase.severity, 3);
  const sentence = computeSentence(w, kase);
  assert.equal(sentence.track, 'city');
  assert.equal(sentence.jailDays, 0);
  assert.equal(sentence.exile, false);
  assert.equal(sentence.tier, 3);
});

test('a spy_disposition is a question the Council answers, and it is answered once', () => {
  const w = makeWorld();
  const agent = makeCitizen(w, { name: 'Question', wallet: 200 });
  tableUnderworldQuestion(w, {
    proposalId: 'p_3', kind: 'spy_disposition', city: 'reverie', restriction: null, liftId: null,
    value: 1, targetId: agent.id,
  });
  assert.equal(enactUnderworldQuestion(w, 'p_3'), false, 'a disposition names a citizen, not a good');
  const carried = enactSpyDisposition(w, 'p_3');
  assert.ok(carried.ok, carried.message);
  assert.ok(isGateBanned(w, agent.id), 'value 1 of DISPOSITIONS is expulsion');
  assert.equal(DISPOSITIONS[1], 'expel');
  assert.ok(!enactSpyDisposition(w, 'p_3').ok, 'and it is answered once');
});

test('the Captain may name the target and let the roster find the detective', () => {
  const w = makeWorld();
  const captain = makeCaptain(w);
  const idle = makeDetective(w, 'Idle');
  const busy = makeDetective(w, 'Busy');
  assert.ok(assignDetective(w, captain.id, busy.id, { building: 'exchange' }).ok);

  const result = assignFreeDetective(w, captain.id, { building: 'city_hall' });
  assert.ok(result.ok, result.message);
  assert.equal(assignmentsOf(w, idle.id).length, 1, 'the file goes to whoever is carrying the fewest');
  assert.equal(assignmentsOf(w, busy.id).length, 1);
});
