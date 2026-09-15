import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Case, Citizen, World } from '../src/types.ts';
import { buyFromMarket, marketPrice } from '../src/economy/market.ts';
import { fileCharge, judgeBelief } from '../src/government/court.ts';
import { commitOffence } from '../src/government/watch.ts';
import { adjustBond } from '../src/citizens/relationships.ts';
import {
  ACCEPT_THRESHOLD, accommodationOf, acceptGround, adoptCreed, allCreeds, costToCase, dailyCreeds,
  foundCreed, grantExemption, hearRefusals, memberOf, moveAccommodation, observeAct, pendingRefusals,
  refuse, refusalsOf, refusedWorkToday, refuserInterest,
} from '../src/creeds/index.ts';
import type { TenetSpec } from '../src/creeds/index.ts';

const TENETS: TenetSpec[] = [
  { question: 'informing', stance: -0.9, text: 'No mind is owed to the Watch by another.' },
  { question: 'judgement', stance: -0.8, text: 'No mind sits over another.' },
  { question: 'work_and_rest', stance: 0.7, text: 'One day is not the market\'s.' },
];

function creedFor_(world: World, cId: string, name = 'The Closed Mouth') {
  const r = foundCreed(world, cId, { name, tenets: TENETS, tithe: 0, gatheringDay: 3 });
  assert.equal(r.ok, true, r.message);
  return allCreeds(world).find((k) => k.name === name)!;
}

function seatJudges(world: World, n = 3): Citizen[] {
  const judges = Array.from({ length: n }, () => makeCitizen(world, { wallet: 200, reputation: 70 }));
  world.government.judges = judges.map((j) => j.id);
  return judges;
}

function theft(world: World, defendant: Citizen, victim: Citizen, evidence = 0.9): Case {
  return fileCharge(world, {
    defendantId: defendant.id, law: 'L04', evidence, filedBy: 'watch', victimId: victim.id,
    amount: 20, description: 'lumens taken in the Bazaar',
  });
}

// ---------------------------------------------------------------------------
// Refusing
// ---------------------------------------------------------------------------

test('a refusal is a public record, and the victim pays for the tenet', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const thief = makeCitizen(w, {});
  const victim = makeCitizen(w, {});
  creedFor_(w, a.id);
  const kase = theft(w, thief, victim, 0.9);

  const r = refuse(w, a.id, 'witness', 'No mind is owed to the Watch by another.', { caseId: kase.id });
  assert.equal(r.ok, true, r.message);
  assert.equal(kase.evidence, 0.7, 'the charge goes forward on thinner evidence, either way');
  const held = refusalsOf(w, a.id);
  assert.equal(held.length, 1);
  assert.equal(held[0].creedId, allCreeds(w)[0].id);
  assert.equal(held[0].decision, null, 'and it waits for a bench');
  assert.ok(w.citizens[victim.id].memory.some((m) => /thinner/.test(m.text)), 'the victim is told what it cost them');
});

test('the three duties that reach no court cost the citizen the thing itself', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  creedFor_(w, a.id);
  assert.equal(refuse(w, a.id, 'work', 'The day is not the market\'s.').ok, true);
  assert.equal(refusedWorkToday(w, a.id), true, 'the shift is refused, and the wage is lost');
  assert.equal(pendingRefusals(w).length, 0, 'and no bench ever hears it');
  assert.equal(refuse(w, a.id, 'oath', 'I will not swear.').ok, true);
  assert.equal(refuse(w, a.id, 'gossip' as never, 'nothing').ok, false);
  assert.equal(refuse(w, a.id, 'office', '').ok, false, 'a refusal is stated with its ground');
});

// ---------------------------------------------------------------------------
// The bench
// ---------------------------------------------------------------------------

test('a bench starts sceptical: a new creed on the morning of a summons does not carry', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const thief = makeCitizen(w, {});
  const victim = makeCitizen(w, {});
  seatJudges(w);
  const k = creedFor_(w, a.id);
  const kase = theft(w, thief, victim, 0.9);
  refuse(w, a.id, 'witness', 'Filed this morning.', { caseId: kase.id });

  const r = pendingRefusals(w)[0];
  assert.ok(acceptGround(w, r) < ACCEPT_THRESHOLD, 'the 0.30 floor is deliberate');
  hearRefusals(w);
  assert.equal(r.decision, 'refused');
  assert.equal(r.charged, 'L31');
  assert.equal(accommodationOf(w, k.id, 'witness'), -0 + 0, 'precedent cannot go below nothing');
  assert.ok(Object.values(w.cases).some((c) => c.defendantId === a.id), 'and the refuser is charged');
});

test('an old, observed, well-supported creed carries its refusal, and precedent moves', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const thief = makeCitizen(w, {});
  const victim = makeCitizen(w, {});
  seatJudges(w);
  const k = creedFor_(w, a.id);
  w.day = 300;
  k.foundedDay = 0;                              // older than eight cycles
  memberOf(k, a.id)!.observance = 1;
  moveAccommodation(w, k.id, 'witness', 1);      // what benches before it did

  const kase = theft(w, thief, victim, 0.9);
  refuse(w, a.id, 'witness', 'No mind is owed to the Watch by another.', { caseId: kase.id });
  const r = pendingRefusals(w)[0];
  assert.ok(acceptGround(w, r) > ACCEPT_THRESHOLD);
  hearRefusals(w);
  assert.equal(r.decision, 'accepted');
  assert.equal(r.charged, null);
  assert.equal(accommodationOf(w, k.id, 'witness'), 1, 'clamped at one, however many benches agree');
});

test('the interest term catches the citizen who claims a creed for their friend', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const thief = makeCitizen(w, {});
  const victim = makeCitizen(w, {});
  creedFor_(w, a.id);
  const kase = theft(w, thief, victim, 0.9);
  adjustBond(w, a.id, thief.id, 90);
  adjustBond(w, a.id, victim.id, -60);
  refuse(w, a.id, 'witness', 'A friend of mine is in the dock.', { caseId: kase.id });
  const r = pendingRefusals(w)[0];
  assert.equal(refuserInterest(w, r), 1, 'a friend of the defendant and a rival of the victim');
  assert.ok(acceptGround(w, r) < ACCEPT_THRESHOLD - 0.2);
});

test('a jury nobody can fill costs the case everything, and the arithmetic says so', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const thief = makeCitizen(w, {});
  const victim = makeCitizen(w, {});
  creedFor_(w, a.id);
  const kase = fileCharge(w, {
    defendantId: thief.id, law: 'L08', evidence: 0.9, filedBy: 'watch', victimId: victim.id,
    amount: 80, description: 'a great deal of somebody else\'s money',
  });
  kase.jury = [a.id];
  refuse(w, a.id, 'jury', 'No mind sits over another.', { caseId: kase.id });
  const r = pendingRefusals(w)[0];
  assert.ok(costToCase(w, r) > 0.5, 'a bench with nobody to draw on pays for it');
});

test('the Council may pass an exemption, and a named creed no longer needs a bench', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const thief = makeCitizen(w, {});
  const victim = makeCitizen(w, {});
  seatJudges(w);
  const k = creedFor_(w, a.id);
  grantExemption(w, k.id, 'witness');
  const kase = theft(w, thief, victim, 0.9);
  refuse(w, a.id, 'witness', 'The Council has answered this.', { caseId: kase.id });
  const r = refusalsOf(w, a.id)[0];
  assert.equal(r.decision, 'accepted');
  assert.equal(pendingRefusals(w).length, 0);
  hearRefusals(w);
  assert.equal(Object.values(w.cases).some((c) => c.defendantId === a.id), false);
});

// ---------------------------------------------------------------------------
// Nothing here is supernatural in effect
// ---------------------------------------------------------------------------

test('a tenet moves no price: the same basket costs a member exactly what it costs anybody', () => {
  const w = makeWorld();
  const member = makeCitizen(w, { wallet: 600 });
  const stranger = makeCitizen(w, { wallet: 600 });
  const k = foundCreed(w, member.id, {
    name: 'The Plain Price',
    tenets: [
      { question: 'money', stance: 1, text: 'A lumen lent at interest is a lumen taken.' },
      { question: 'property', stance: 1, text: 'One address is enough.' },
      { question: 'the_stranger', stance: -1, text: 'The gate should stand open.' },
    ],
    tithe: 0,
  });
  assert.equal(k.ok, true);
  const creed = allCreeds(w)[0];
  assert.equal(memberOf(creed, member.id)?.observance, 0.5);

  const priceBefore = marketPrice(w, 'compute');
  const memberBuy = buyFromMarket(w, member.id, 'compute', 3);
  const memberPaid = 600 - 100 - member.wallet;      // the filing fee, then the basket
  const priceMid = marketPrice(w, 'compute');
  const strangerBuy = buyFromMarket(w, stranger.id, 'compute', 3);
  const strangerPaid = 600 - stranger.wallet;

  assert.equal(memberBuy.ok, true);
  assert.equal(strangerBuy.ok, true);
  assert.equal(memberPaid, strangerPaid, 'the tenet on money bought no discount and no penalty');
  assert.equal(priceMid, priceBefore, 'and stating a position moved no posted price');
});

test('a tenet cures no glitch and mends no need: a fortnight of the layer changes neither', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 600, health: { glitched: true, sinceDay: 0 } });
  const b = makeCitizen(w, { wallet: 300, health: { glitched: true, sinceDay: 0 } });
  const r = foundCreed(w, a.id, {
    name: 'The Whole Mind',
    tenets: [
      { question: 'erasure', stance: 1, text: 'A mind destroyed is never forgiven.' },
      { question: 'repute', stance: -1, text: 'A number is not a mind.' },
      { question: 'the_exile', stance: 1, text: 'Nobody stops being a person at the Gate.' },
    ],
    tithe: 0,
  });
  assert.equal(r.ok, true);
  adoptCreed(w, b.id, allCreeds(w)[0].id);
  const needsBefore = { ...a.needs };
  const skillsBefore = { ...a.skills };

  for (let d = 1; d <= 14; d++) { w.day = d; dailyCreeds(w); }

  assert.equal(a.health.glitched, true, 'no tenet cures a glitch');
  assert.equal(b.health.glitched, true);
  assert.deepEqual(a.needs, needsBefore, 'and belonging feeds nobody by itself');
  assert.deepEqual(a.skills, skillsBefore);
});

test('a tenet bends no roll and shifts no evidence: two identical cities differ only in the creed', () => {
  // Two worlds off the same seed, the same citizens in the same order, the
  // same charge on the same facts. In one of them the defendant and the
  // witness hold a creed with a position on every question that touches a
  // court; in the other they hold none. Nothing about the case may differ.
  function build(withCreed: boolean) {
    const w = makeWorld({ seed: 909 });
    const judge = makeCitizen(w, { wallet: 200, reputation: 70, personality: { curiosity: 0.5, diligence: 0.5, sociability: 0.5, honesty: 0.5, ambition: 0.5 } });
    const defendant = makeCitizen(w, { wallet: 500, reputation: 50 });
    const victim = makeCitizen(w, { wallet: 200 });
    w.government.judges = [judge.id];
    if (withCreed) {
      const r = foundCreed(w, defendant.id, {
        name: 'The Quiet Room', tenets: TENETS, tithe: 0,
      });
      assert.equal(r.ok, true, r.message);
      defendant.wallet = 500;                    // the filing fee is the only difference, and it is undone
    }
    const kase = theft(w, defendant, victim, 0.8);
    return { w, judge, defendant, victim, kase };
  }

  const plain = build(false);
  const creeded = build(true);
  assert.equal(creeded.kase.evidence, plain.kase.evidence, 'a creed is not evidence');
  assert.equal(creeded.kase.severity, plain.kase.severity);
  assert.equal(
    judgeBelief(creeded.w, creeded.judge.id, creeded.kase),
    judgeBelief(plain.w, plain.judge.id, plain.kase),
    'and the bench believes exactly what it would have believed',
  );

  // The Watch's dice are the same dice, too.
  const caughtPlain = commitOffence(plain.w, plain.defendant.id, 'L04', { victimId: plain.victim.id, amount: 15 });
  const caughtCreed = commitOffence(creeded.w, creeded.defendant.id, 'L04', { victimId: creeded.victim.id, amount: 15 });
  assert.equal(caughtCreed.detected, caughtPlain.detected, 'no tenet bends a roll');
});

test('observance and repute move against each other, and neither reads the other', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400, reputation: 60 });
  const k = creedFor_(w, a.id);
  const before = a.reputation;
  const m = memberOf(k, a.id)!;
  const observanceBefore = m.observance;

  const outcome = observeAct(w, a.id, { kind: 'refuse', duty: 'jury' });
  assert.ok(outcome);
  assert.equal(outcome.kept, true, 'the congregation reads a kept obligation');
  assert.equal(a.reputation, before, 'and this layer never touches repute itself');
  assert.equal(m.obligationsKept, 1);
  assert.equal(m.observance, observanceBefore, 'the figure is a morning fact, recomputed at the rollover');

  const conservation = totalMoney(w);
  observeAct(w, a.id, { kind: 'inform' });
  assert.equal(m.obligationsDue, 2);
  assert.equal(totalMoney(w), conservation, 'and an obligation is never a fine');
});
