/**
 * Zoning, the referendum a district opens, and the interest a councillor must
 * declare (`src/environment/`, `docs/ENVIRONMENT.md` §§4–6, 8).
 *
 * The whole of the detection mechanism here is that two public registers — the
 * property register and the roll of votes — are read against each other. There
 * is no hidden state and no engine judgement: a councillor who declares gives
 * up a vote, and one who does not is answerable for what the register says.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CitizenId, DistrictId, Proposal, PropertyUnit, World } from '../src/types.ts';
import { signPetition } from '../src/politics/referendums.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  DISTRICT_PETITION_SHARE, ENTRENCHED_MAJORITY, GAIN_THRESHOLD, PERMIT_PREMIUM, admits,
  buyOutBuilding, buyOutCost, checkMeasure, dailyZoningPetitions, declareInterest, districtPetitionStanding,
  districtSignaturesNeeded, enactEnvironmentProposal, environmentQuestionOf, environmentState,
  hasDeclared, holdingsNear, isNonconforming, loadOf, mayExtend, mayOperate, mayTrade, motesForShift,
  neededFor, nonconformingBuildings, permitOf, permitPremium, petitionZoning, recordShiftEmission,
  relocateWorks, residentsOf, setPermit, settleZoningInterests, tableEnvironmentMeasure, zoningGain,
} from '../src/environment/index.ts';
import type { Permit } from '../src/environment/index.ts';

// ---------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------

function room(world: World, buildingId: string, ownerId: string, rent = 50): PropertyUnit {
  const id = `y_${Object.keys(world.property).length + 1}`;
  const u: PropertyUnit = { id, kind: 'home', tier: 1, buildingId, ownerId, tenantId: null, rent };
  world.property[id] = u;
  const owner = world.citizens[ownerId];
  if (owner) owner.ownedUnits = [...(owner.ownedUnits ?? []), id];
  return u;
}

/** A citizen who lives in a district, on the register. */
function residentOf(world: World, district: DistrictId, buildingId: string): CitizenId {
  const c = makeCitizen(world, { district });
  c.homeBuildingId = buildingId;
  c.homeTier = 1;
  return c.id;
}

function seatCouncil(world: World, ids: CitizenId[]): void {
  world.government.council = [...ids];
  world.government.mayorId = ids[0] ?? null;
  for (const id of ids) {
    const c = world.citizens[id];
    if (c) c.office = c.id === ids[0] ? 'mayor' : 'councillor';
  }
}

function tableZone(world: World, proposerId: CitizenId, district: DistrictId, permit: Permit): Proposal {
  const tabled = tableEnvironmentMeasure(world, proposerId, { kind: 'zone', district, permit });
  assert.ok(tabled.proposal, tabled.result.message);
  return tabled.proposal as Proposal;
}

// ---------------------------------------------------------------------------
// Permits
// ---------------------------------------------------------------------------

test('the premium table is exactly what the design says, and open is the founding permit', () => {
  assert.equal(PERMIT_PREMIUM.conserved, 0.20);
  assert.equal(PERMIT_PREMIUM.residential, 0.12);
  assert.equal(PERMIT_PREMIUM.civic, 0.08);
  assert.equal(PERMIT_PREMIUM.commercial, 0.04);
  assert.equal(PERMIT_PREMIUM.open, 0);
  assert.equal(PERMIT_PREMIUM.light_industry, -0.08);
  assert.equal(PERMIT_PREMIUM.heavy_industry, -0.20);
  const world = makeWorld();
  assert.equal(permitOf(world, 'foundry_row'), 'open');
  assert.equal(permitPremium(world, 'foundry_row'), 0);
});

test('a permit says what may be opened, and a breach is a refusal and not an offence', () => {
  const world = makeWorld();
  assert.equal(admits('open', 'forge'), true, 'the founding permit admits anything');
  assert.equal(admits('residential', 'forge'), false);
  assert.equal(admits('conserved', 'housing'), false, 'nothing new at all');
  setPermit(world, 'foundry_row', 'residential', 'a test');
  const refusal = mayOperate(world, 'forge', 'foundry_row');
  assert.ok(refusal && refusal.includes('residential'));
  assert.equal(mayOperate(world, 'housing', 'foundry_row'), null);
  assert.ok(mayTrade(world, 'workshop', 'foundry_row'), 'a workshop is not admitted by a residential permit');
  assert.equal(mayTrade(world, 'clinic', 'foundry_row'), null, 'a clinic is');
});

test('zoning never demolishes: what stands becomes nonconforming and may still be worked', () => {
  const world = makeWorld();
  setPermit(world, 'foundry_row', 'residential', 'the district voted for it');
  assert.equal(isNonconforming(world, 'compute_forge'), true);
  assert.ok(nonconformingBuildings(world, 'foundry_row').includes('compute_forge'));
  const refusal = mayExtend(world, 'compute_forge');
  assert.ok(refusal && refusal.includes('nonconforming'));
  // It still works, and it still emits: nothing was knocked down.
  assert.equal(mayExtend(world, 'forge_cottages'), null, 'housing conforms in a residential district');
});

test('a permit change tells the district it happened', () => {
  const world = makeWorld();
  const resident = residentOf(world, 'foundry_row', 'forge_cottages');
  setPermit(world, 'foundry_row', 'heavy_industry', 'the wages');
  assert.equal(permitOf(world, 'foundry_row'), 'heavy_industry');
  const told = world.citizens[resident].memory.some((m) => m.text.includes('heavy industry'));
  assert.equal(told, true);
  assert.ok(world.events.some((e) => e.kind === 'property' && e.text.includes('zoned heavy industry')));
});

// ---------------------------------------------------------------------------
// The measures
// ---------------------------------------------------------------------------

test('a zoning measure carries a district and a permit the Council can read back', () => {
  const world = makeWorld();
  const councillor = makeCitizen(world);
  seatCouncil(world, [councillor.id]);
  const p = tableZone(world, councillor.id, 'foundry_row', 'residential');
  const q = environmentQuestionOf(world, p.id);
  assert.equal(q?.district, 'foundry_row');
  assert.equal(q?.permit, 'residential');
  assert.equal(p.needed, 3);
  const r = enactEnvironmentProposal(world, p);
  assert.equal(r.ok, true, r.message);
  assert.equal(permitOf(world, 'foundry_row'), 'residential');
});

test('a conservation is undone only by four of five, like a pardon', () => {
  const world = makeWorld();
  const councillor = makeCitizen(world);
  seatCouncil(world, [councillor.id]);
  assert.equal(neededFor(world, { kind: 'conserve', district: 'verdant_quarter' }), 3);
  const p = tableEnvironmentMeasure(world, councillor.id, { kind: 'conserve', district: 'verdant_quarter' });
  assert.ok(p.proposal);
  enactEnvironmentProposal(world, p.proposal as Proposal);
  assert.equal(permitOf(world, 'verdant_quarter'), 'conserved');
  assert.equal(neededFor(world, { kind: 'zone', district: 'verdant_quarter', permit: 'heavy_industry' }), ENTRENCHED_MAJORITY);
});

test('a measure that names nothing the city knows is refused, and never thrown', () => {
  const world = makeWorld();
  assert.ok(checkMeasure(world, { kind: 'zone', district: 'foundry_row' }), 'a zoning measure needs a permit');
  assert.ok(checkMeasure(world, { kind: 'zone', district: 'foundry_row', permit: 'open' }), 'it is already open');
  assert.ok(checkMeasure(world, { kind: 'abatement_works', building: 'compute_forge' }), 'works need a fitting');
  assert.equal(checkMeasure(world, { kind: 'emission_charge', value: 2 }), null);
  assert.ok(checkMeasure(world, { kind: 'emission_charge', value: 1000 }), 'and it has a ceiling');
});

test('the emission charge and the host payment are numbers the Council sets', () => {
  const world = makeWorld();
  const councillor = makeCitizen(world);
  seatCouncil(world, [councillor.id]);
  const charge = tableEnvironmentMeasure(world, councillor.id, { kind: 'emission_charge', value: 3 });
  enactEnvironmentProposal(world, charge.proposal as Proposal);
  assert.equal(environmentState(world).charge, 3);
  const other = makeCitizen(world);
  seatCouncil(world, [councillor.id, other.id]);
  const host = tableEnvironmentMeasure(world, other.id, { kind: 'host_payment', district: 'foundry_row', value: 0.3 });
  enactEnvironmentProposal(world, host.proposal as Proposal);
  assert.equal(environmentState(world).districts.foundry_row.hostShare, 0.3);
});

// ---------------------------------------------------------------------------
// Buying out, and moving out
// ---------------------------------------------------------------------------

test('the city may buy out a nonconforming works at sixty days of what it makes', () => {
  const world = makeWorld();
  world.jobs.j_forge = {
    id: 'j_forge', role: 'forge_operator', title: 'Forge Operator', employer: 'city',
    buildingId: 'compute_forge', district: 'foundry_row', skill: 'crafting', minSkill: 0,
    minReputation: 0, wage: 14, output: { good: 'compute', qty: 3 }, holderId: null, createdDay: 0,
  };
  setPermit(world, 'foundry_row', 'residential', 'the vote');
  const cost = buyOutCost(world, 'compute_forge');
  assert.ok(cost > 0);
  const short = buyOutBuilding(world, 'compute_forge');
  assert.equal(short.ok, false, 'the fund is empty');
  world.government.publicWorksFund = cost;
  const bought = buyOutBuilding(world, 'compute_forge');
  assert.equal(bought.ok, true, bought.message);
  assert.equal(world.government.publicWorksFund, 0);
  assert.equal(world.jobs.j_forge, undefined, 'its posts are closed');
  assert.equal(motesForShift(world, {
    id: 'x', role: 'forge_operator', title: 't', employer: 'city', buildingId: 'compute_forge',
    district: 'foundry_row', skill: null, minSkill: 0, minReputation: 0, wage: 0,
    output: { good: 'compute', qty: 1 }, holderId: null, createdDay: 0,
  }), 0, 'and it emits nothing ever again');
});

test('moving a works out of town takes the smoke out of the district and puts it on the fields', () => {
  const world = makeWorld();
  world.government.publicWorksFund = 5000;
  const moved = relocateWorks(world, 'compute_forge');
  assert.equal(moved.ok, true, moved.message);
  const job = {
    id: 'j1', role: 'forge_operator' as const, title: 'Forge Operator', employer: 'city' as const,
    buildingId: 'compute_forge', district: 'foundry_row' as DistrictId, skill: null, minSkill: 0,
    minReputation: 0, wage: 0, output: { good: 'compute' as const, qty: 3 }, holderId: null, createdDay: 0,
  };
  recordShiftEmission(world, job);
  assert.equal(loadOf(world, 'foundry_row'), 0, 'the district keeps the wages and loses the smoke');
});

// ---------------------------------------------------------------------------
// NIMBY: the district's own petition
// ---------------------------------------------------------------------------

test("only a district's residents may open its permit at the district share", () => {
  const world = makeWorld();
  const inside = residentOf(world, 'foundry_row', 'forge_cottages');
  const outside = makeCitizen(world, { district: 'commons' }).id;
  const refused = petitionZoning(world, outside, 'foundry_row', 'residential');
  assert.equal(refused.ok, false);
  assert.ok(refused.message.includes('residents'));
  const opened = petitionZoning(world, inside, 'foundry_row', 'residential');
  assert.equal(opened.ok, true, opened.message);
});

test('a fifth of the district puts the permit to the whole city', () => {
  const world = makeWorld();
  const residents = Array.from({ length: 10 }, () => residentOf(world, 'foundry_row', 'forge_cottages'));
  // Somebody who lives elsewhere is not counted in the district's share.
  makeCitizen(world, { district: 'commons' });
  assert.equal(residentsOf(world, 'foundry_row').length, 10);
  const needed = districtSignaturesNeeded(world, 'foundry_row');
  assert.equal(needed, Math.ceil(DISTRICT_PETITION_SHARE * 10));
  const opened = petitionZoning(world, residents[0], 'foundry_row', 'residential');
  assert.equal(opened.ok, true, opened.message);
  const p = world.government.proposals[world.government.proposals.length - 1];
  let standing = districtPetitionStanding(world, p.id);
  assert.equal(standing?.signatures, 1, 'the petitioner is the first name');
  assert.equal(standing?.crossed, false);
  dailyZoningPetitions(world);
  assert.equal(world.referendums.length, 0, 'one name is not a fifth of the district');

  // The rest of the names arrive; the question goes to the city, not to the district.
  signPetition(world, residents[1], p.id);
  standing = districtPetitionStanding(world, p.id);
  assert.equal(standing?.crossed, true);
  dailyZoningPetitions(world);
  assert.equal(world.referendums.length, 1, 'the ballot it opens is the whole city\'s');
  assert.equal(world.referendums[0].petitionId, p.id);
});

// ---------------------------------------------------------------------------
// The interest a councillor must declare
// ---------------------------------------------------------------------------

test('a rezoning moves the price of what the councillor holds, and the register says so', () => {
  const world = makeWorld();
  const councillor = makeCitizen(world);
  seatCouncil(world, [councillor.id]);
  room(world, 'forge_cottages', councillor.id, 50);
  room(world, 'foremens_terraces', councillor.id, 50);
  assert.equal(holdingsNear(world, councillor.id, 'foundry_row').length, 2);
  const gain = zoningGain(world, councillor.id, 'foundry_row', 'heavy_industry', 'residential', world.day);
  assert.ok(gain > GAIN_THRESHOLD, `a 0.32 swing on two addresses is real money: ${gain}`);
  const loss = zoningGain(world, councillor.id, 'foundry_row', 'residential', 'heavy_industry', world.day);
  assert.ok(loss < 0, 'and it runs the other way too');
});

test('an aye vote on a rezoning that pays you, undeclared, leaves a trace that never decays', () => {
  const world = makeWorld();
  const councillor = makeCitizen(world);
  seatCouncil(world, [councillor.id]);
  setPermit(world, 'foundry_row', 'heavy_industry', 'the founding');
  room(world, 'forge_cottages', councillor.id, 50);
  room(world, 'foremens_terraces', councillor.id, 50);
  const p = tableZone(world, councillor.id, 'foundry_row', 'residential');
  p.votes[councillor.id] = true;
  const found = settleZoningInterests(world, p, 'foundry_row', 'heavy_industry', 'residential');
  assert.equal(found.length, 1);
  assert.equal(found[0].code, 'L11');
  assert.ok((found[0].trace ?? 0) >= 0.3);
  assert.ok((world.counters[`abuse:${councillor.id}`] ?? 0) > 0, 'on the same channel a detective already reads');
});

test('a small holding, undeclared, is L47 and goes before the Watch like anything else', () => {
  const world = makeWorld();
  const councillor = makeCitizen(world);
  seatCouncil(world, [councillor.id]);
  setPermit(world, 'foundry_row', 'heavy_industry', 'the founding');
  room(world, 'forge_cottages', councillor.id, 2);
  const p = tableZone(world, councillor.id, 'foundry_row', 'residential');
  p.votes[councillor.id] = true;
  const found = settleZoningInterests(world, p, 'foundry_row', 'heavy_industry', 'residential');
  assert.equal(found[0].code, 'L47');
  assert.ok(councillor.recentOffences.some((o) => String(o.law) === 'L47'));
  const report = Object.values(world.reports).find((r) => String(r.law) === 'L47');
  assert.ok(report, 'the Watch holds a report, and an officer decides whether to charge it');
  assert.equal(report?.suspectId, councillor.id);
  assert.equal((world.government.lawSeverity as Record<string, number>).L47, 3,
    'severity 3, on the ladder, never custody');
});

test('declaring the interest costs the vote and answers the charge', () => {
  const world = makeWorld();
  const councillor = makeCitizen(world);
  const other = makeCitizen(world);
  seatCouncil(world, [councillor.id, other.id]);
  setPermit(world, 'foundry_row', 'heavy_industry', 'the founding');
  room(world, 'forge_cottages', councillor.id, 50);
  room(world, 'foremens_terraces', councillor.id, 50);
  const p = tableZone(world, other.id, 'foundry_row', 'residential');
  const declared = declareInterest(world, councillor.id, p.id);
  assert.equal(declared.ok, true, declared.message);
  assert.equal(hasDeclared(world, p.id, councillor.id), true);
  assert.equal(p.votes[councillor.id], false, 'they have given up the vote on the question they know most about');
  p.votes[other.id] = true;
  const found = settleZoningInterests(world, p, 'foundry_row', 'heavy_industry', 'residential');
  assert.equal(found.length, 0, 'the councillor who declared is not among the ayes');
  assert.equal((world.counters[`abuse:${councillor.id}`] ?? 0), 0);
  assert.equal(councillor.recentOffences.length, 0);
});

test('a councillor who holds nothing there is not answerable for anything', () => {
  const world = makeWorld();
  const councillor = makeCitizen(world);
  seatCouncil(world, [councillor.id]);
  setPermit(world, 'foundry_row', 'heavy_industry', 'the founding');
  const p = tableZone(world, councillor.id, 'foundry_row', 'residential');
  p.votes[councillor.id] = true;
  const found = settleZoningInterests(world, p, 'foundry_row', 'heavy_industry', 'residential');
  assert.equal(found.length, 0);
  assert.equal(councillor.recentOffences.length, 0);
});

test('property bought in the fortnight before the tabling counts double', () => {
  const world = makeWorld();
  const councillor = makeCitizen(world);
  seatCouncil(world, [councillor.id]);
  world.day = 20;
  room(world, 'forge_cottages', councillor.id, 50);
  const plain = zoningGain(world, councillor.id, 'foundry_row', 'heavy_industry', 'residential', world.day);
  world.treasury.ledger.push({
    tick: (world.day - 3) * 24, kind: 'property', amount: 400, from: councillor.id, to: 'treasury',
    memo: 'purchase of a unit at Forge Cottages',
  });
  const doubled = zoningGain(world, councillor.id, 'foundry_row', 'heavy_industry', 'residential', world.day);
  assert.equal(doubled, plain * 2);
});

test('no money is made or lost by any of it', () => {
  const world = makeWorld();
  const councillor = makeCitizen(world);
  seatCouncil(world, [councillor.id]);
  const before = totalMoney(world);
  room(world, 'forge_cottages', councillor.id, 50);
  const p = tableZone(world, councillor.id, 'foundry_row', 'residential');
  p.votes[councillor.id] = true;
  enactEnvironmentProposal(world, p);
  assert.equal(totalMoney(world), before);
});
