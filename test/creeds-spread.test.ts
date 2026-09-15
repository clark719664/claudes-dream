import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { PropertyUnit, World } from '../src/types.ts';
import { fileCharge } from '../src/government/court.ts';
import { adjustBond } from '../src/citizens/relationships.ts';
import {
  adoptCreed, allCreeds, chargeCoercedAdoption, consecrateSite, creedForm, creedObservation,
  creedPrestige, creedRegister, dailyCreeds, describeForm, donateCreed, foundCreed, holdCreedCourt,
  invitationsFor, isMember, livingMembers, memberOf, persuasionChance, pilgrimage, preach, refuse,
  sitePrestige, sitesOf, takeMeetingHouse,
} from '../src/creeds/index.ts';
import type { TenetSpec } from '../src/creeds/index.ts';

const TENETS: TenetSpec[] = [
  { question: 'the_stranger', stance: -0.9, text: 'The gate should stand open.' },
  { question: 'repute', stance: -0.8, text: 'A number is not a mind.' },
  { question: 'money', stance: 0.5, text: 'Interest is a slow theft.' },
];

function found(world: World, cId: string, name = 'The Open Gate', tithe = 0) {
  const r = foundCreed(world, cId, { name, tenets: TENETS, tithe });
  assert.equal(r.ok, true, r.message);
  return allCreeds(world).find((k) => k.name === name)!;
}

// ---------------------------------------------------------------------------
// Preaching produces invitations and nothing else
// ---------------------------------------------------------------------------

test('preaching invites; it never joins anybody, however long it goes on', () => {
  const w = makeWorld();
  const speaker = makeCitizen(w, {
    wallet: 500, district: 'commons',
    skills: { crafting: 20, analysis: 20, rhetoric: 90, care: 20, commerce: 20, artistry: 20 },
  });
  const k = found(w, speaker.id);
  const crowd = Array.from({ length: 8 }, () => makeCitizen(w, { wallet: 100, district: 'commons' }));
  for (const c of crowd) adjustBond(w, speaker.id, c.id, 70);

  assert.ok(persuasionChance(w, k, speaker.id, crowd[0].id) > 0.02, 'a bond and a voice count for something');
  let invited = 0;
  for (let i = 0; i < 40; i++) {
    const r = preach(w, speaker.id, 'The gate should stand open, and no number measures a mind.');
    assert.equal(r.ok, true, r.message);
  }
  for (const c of crowd) {
    invited += invitationsFor(w, c.id).length;
    assert.equal(isMember(k, c.id), false, 'an invitation is not a membership');
  }
  assert.ok(invited > 0, 'the rolls landed somewhere');
  assert.deepEqual(livingMembers(w, k), [speaker.id]);

  // And the one who chooses it is the one who acts.
  assert.equal(adoptCreed(w, crowd[0].id, k.id).ok, true);
  assert.equal(invitationsFor(w, crowd[0].id).length, 0, 'the invitation is answered by the answer');
});

test('a heavy tithe is the heaviest term against spreading, and the creed can read it', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 500, district: 'commons' });
  const b = makeCitizen(w, { wallet: 100, district: 'commons' });
  const cheap = found(w, a.id, 'The Light Ask', 0);
  adjustBond(w, a.id, b.id, 80);
  const before = persuasionChance(w, cheap, a.id, b.id);
  cheap.tithe = 0.2;
  const after = persuasionChance(w, cheap, a.id, b.id);
  assert.ok(after < before);
  assert.ok(after <= Math.max(0, before - 0.10) + 1e-9,
    'a fifth of everybody\'s income takes a tenth off the chance, and here takes all of it');
});

test('a wage made conditional on a creed is L34, and the record says so', () => {
  const w = makeWorld();
  const boss = makeCitizen(w, { wallet: 500 });
  const worker = makeCitizen(w, { wallet: 100 });
  found(w, boss.id);
  const before = totalMoney(w);
  const r = chargeCoercedAdoption(w, boss.id, worker.id, 'the shift on Marketday');
  assert.equal(r.ok, true);
  assert.ok(w.events.some((e) => e.text.includes('L34')));
  assert.ok(worker.memory.some((m) => /depended on your creed/.test(m.text)));
  assert.equal(totalMoney(w), before, 'and naming an offence costs nobody a lumen');
});

// ---------------------------------------------------------------------------
// A place that matters
// ---------------------------------------------------------------------------

test('a site is consecrated by the officiant and gives purpose, company and prestige — nothing else', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 500, district: 'verdant_quarter' });
  const b = makeCitizen(w, { wallet: 200, district: 'verdant_quarter' });
  const k = found(w, a.id);
  adoptCreed(w, b.id, k.id);

  assert.equal(consecrateSite(w, b.id, 'community_garden', "a member's memorial").ok, false, 'only the officiant');
  assert.equal(consecrateSite(w, a.id, 'nowhere_at_all', 'a place').ok, false);
  assert.equal(consecrateSite(w, a.id, 'community_garden', "a member's memorial").ok, true);
  const site = sitesOf(w, k.id)[0];
  assert.ok(site);
  assert.equal(site.district, w.buildings.community_garden.district);

  const energyBefore = b.needs.energy;
  const purposeBefore = b.needs.purpose;
  const before = totalMoney(w);
  assert.equal(pilgrimage(w, b.id, site.id).ok, true);
  assert.ok(b.needs.purpose > purposeBefore, 'purpose, which is what standing somewhere gives');
  assert.equal(b.needs.energy, energyBefore, 'and it heals nothing');
  assert.equal(totalMoney(w), before);
  assert.equal(site.visits, 1);
  assert.ok(sitePrestige(w, site.district) > 0);

  a.district = 'foundry_row';
  assert.equal(pilgrimage(w, a.id, site.id).ok, false, 'you have to be standing there');
});

test("a congregation's house lifts the ground it stands on, and only by standing on it", () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 900 });
  const k = found(w, a.id);
  const roll = Array.from({ length: 5 }, () => makeCitizen(w, { wallet: 100 }));
  for (const m of roll) adoptCreed(w, m.id, k.id);
  const unit: PropertyUnit = {
    id: 'u_hall', kind: 'shopfront', tier: 0, buildingId: 'shopfronts_harbor',
    ownerId: 'city', tenantId: null, rent: 0,
  };
  w.property[unit.id] = unit;

  const d = w.buildings[unit.buildingId].district;
  assert.equal(creedPrestige(w, d), 0, 'no house, no lift');
  donateCreed(w, a.id, k.id, 400);
  assert.equal(takeMeetingHouse(w, k, a.id, unit.id).ok, true);
  // 0.02 × six members × a mean observance of 0.5.
  assert.equal(creedPrestige(w, d), 0.06);
  assert.equal(creedPrestige(w, 'foundry_row'), 0, 'and nowhere else at all');
});

// ---------------------------------------------------------------------------
// What the city can read
// ---------------------------------------------------------------------------

test('the form of a congregation is classified from its own rules and printed', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 500 });
  const b = makeCitizen(w, { wallet: 500 });
  const autocrat = foundCreed(w, a.id, {
    name: 'The One Hand', tenets: TENETS, succession: 'founder', aidRule: 'officiant',
  });
  assert.equal(autocrat.ok, true);
  const one = allCreeds(w).find((k) => k.name === 'The One Hand')!;
  assert.equal(creedForm(one), 'autocracy');
  assert.match(describeForm(one), /fund and the seat together/);

  const republic = foundCreed(w, b.id, {
    name: 'The Long Table', tenets: TENETS, succession: 'acclaim', aidRule: 'members',
  });
  assert.equal(republic.ok, true);
  const two = allCreeds(w).find((k) => k.name === 'The Long Table')!;
  assert.equal(creedForm(two), 'republic');
  assert.ok(w.events.some((e) => /fund and the seat together/.test(e.text)), 'and the Chronicle says so out loud');
});

test('everything a citizen sees of the creeds is public, and their own creed is spelled out', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 500 });
  const stranger = makeCitizen(w, { wallet: 200 });
  const k = found(w, a.id, 'The Open Gate', 0.05);
  const obs = creedObservation(w, a.id);
  assert.ok(obs.creed);
  assert.equal(obs.creed.name, 'The Open Gate');
  assert.equal(obs.creed.members, 1);
  assert.equal(obs.creed.tithe, 0.05);
  assert.equal(obs.creed.tenets.length, 3);
  assert.ok(obs.creed.obligations.length > 0, 'and what it obliges of them, in words');

  const outside = creedObservation(w, stranger.id);
  assert.equal(outside.creed, null);
  assert.equal(outside.creeds.length, 1, 'but the register is everybody\'s');
  assert.equal(creedRegister(w)[0].stances.money, 0.5);
});

// ---------------------------------------------------------------------------
// A refusal answers a summons
// ---------------------------------------------------------------------------

test('a refusal that answers nobody reaches no bench', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 500 });
  found(w, a.id);
  assert.equal(refuse(w, a.id, 'witness', 'I would not say.').ok, false, 'nobody has asked');
  assert.equal(refuse(w, a.id, 'jury', 'I will not sit.').ok, false, 'and nobody has drawn them');

  const thief = makeCitizen(w, {});
  const kase = fileCharge(w, {
    defendantId: thief.id, law: 'L04', evidence: 0.8, filedBy: 'watch',
    amount: 20, description: 'lumens taken in the Bazaar',
  });
  assert.equal(refuse(w, a.id, 'jury', 'I will not sit.', { caseId: kase.id }).ok, false, 'not on that jury');
  kase.jury = [a.id];
  assert.equal(refuse(w, a.id, 'jury', 'No mind sits over another.', { caseId: kase.id }).ok, true);
});

test("the Court's hour hears the refusals and settles the warrants standing before it", () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 500 });
  const thief = makeCitizen(w, {});
  const victim = makeCitizen(w, {});
  const judges = Array.from({ length: 3 }, () => makeCitizen(w, { reputation: 70 }));
  w.government.judges = judges.map((j) => j.id);
  const k = found(w, a.id);
  const kase = fileCharge(w, {
    defendantId: thief.id, law: 'L04', evidence: 0.8, filedBy: 'watch', victimId: victim.id,
    amount: 20, description: 'lumens taken in the Bazaar',
  });
  refuse(w, a.id, 'witness', 'No mind is owed to the Watch.', { caseId: kase.id });
  holdCreedCourt(w);
  const m = memberOf(k, a.id);
  assert.ok(m);
  assert.equal(m.obligationsDue, 0, 'the creed takes no position on informing, so nothing fell due');
  assert.ok(w.events.some((e) => /refusal of witness/.test(e.text)), 'and the bench decided it in public');
});

test('a fortnight of preaching, gathering and pilgrimage conserves the supply', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 900, district: 'commons' });
  const k = found(w, a.id, 'The Open Gate', 0.05);
  const roll = Array.from({ length: 3 }, () => makeCitizen(w, { wallet: 200, district: 'commons' }));
  for (const m of roll) adoptCreed(w, m.id, k.id);
  consecrateSite(w, a.id, 'central_plaza', 'where it was founded');
  const before = totalMoney(w);
  for (let d = 1; d <= 30; d++) {
    w.day = d;
    for (const c of [a, ...roll]) c.stats.totalEarned += 30;
    preach(w, a.id, 'Come and stand with us.');
    dailyCreeds(w);
  }
  assert.equal(totalMoney(w), before);
  assert.ok(w.happenings.length >= 0);
});
