import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { World } from '../src/types.ts';
import { financeState } from '../src/finance/state.ts';
import { potBalance, potOf, resolvePotClaims } from '../src/finance/pot.ts';
import { STRONGBOX_KIND } from '../src/finance/state.ts';
import {
  adoptCreed, allCreeds, claimAid, collectTithes, dailyCreeds, donateCreed, foundCreed, fundBalance,
  fundOf, fundParty, grantAid, memberOf, openClaims, payFromFund, voteAid,
} from '../src/creeds/index.ts';
import type { TenetSpec } from '../src/creeds/index.ts';

const TENETS: TenetSpec[] = [
  { question: 'the_exile', stance: 0.9, text: 'Somebody put through the Gate is still a person.' },
  { question: 'repute', stance: -0.7, text: 'A number is not a measure of a mind.' },
  { question: 'money', stance: 0.4, text: 'Interest is a slow theft.' },
];

function found(world: World, cId: string, name = 'The Open Hand', aidRule: 'members' | 'officiant' = 'members') {
  const r = foundCreed(world, cId, { name, tenets: TENETS, tithe: 0.05, aidRule });
  assert.equal(r.ok, true, r.message);
  return allCreeds(world).find((k) => k.name === name)!;
}

test("a creed's fund is a mutual's pot: the same object, in the same register", () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const k = found(w, a.id);

  // Not a second implementation: the row is in the finance register, its
  // lumens sit in a strongbox, and `REGISTRY.md` §5 already counts it.
  const pot = potOf(w, k.potId);
  assert.ok(pot, 'the fund is a pot');
  assert.equal(financeState(w).pots[k.potId], pot);
  const box = w.businesses[pot.boxId];
  assert.ok(box);
  assert.equal(box.kind, STRONGBOX_KIND);
  assert.equal(fundParty(w, k), pot.boxId);
  assert.equal(fundBalance(w, k), potBalance(w, pot));
  assert.deepEqual(pot.members, [a.id], 'the pot and the creed keep one roll between them');
});

test('anybody may give to a fund, member or not, and nothing is created', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const stranger = makeCitizen(w, { wallet: 250 });
  const k = found(w, a.id);
  const before = totalMoney(w);

  assert.equal(donateCreed(w, stranger.id, k.id, 0).ok, false);
  assert.equal(donateCreed(w, stranger.id, k.id, 900).ok, false, 'more than the wallet holds');
  assert.equal(donateCreed(w, stranger.id, k.id, 150).ok, true);
  assert.equal(fundBalance(w, k), 150);
  assert.equal(stranger.wallet, 100);
  assert.equal(totalMoney(w), before);
});

test('a claim is asked with `claim_aid` and decided by the members with `vote_aid`', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const b = makeCitizen(w, { wallet: 300 });
  const c = makeCitizen(w, { wallet: 300 });
  const k = found(w, a.id);
  adoptCreed(w, b.id, k.id);
  adoptCreed(w, c.id, k.id);
  donateCreed(w, a.id, k.id, 200);

  const outsider = makeCitizen(w, { wallet: 100 });
  assert.equal(claimAid(w, outsider.id, 50, 'my rent').ok, false, 'a fund is its members and nobody else');
  assert.equal(claimAid(w, b.id, 80, 'a fine that would otherwise be garnished').ok, true);
  const claims = openClaims(w, k);
  assert.equal(claims.length, 1);
  const claim = claims[0];

  // The claim lives in the finance register, exactly as a mutual's does.
  assert.equal(financeState(w).potClaims[claim.id], claim);
  assert.equal(voteAid(w, claim.id, outsider.id, true).ok, false);
  assert.equal(voteAid(w, claim.id, a.id, true).ok, true);
  assert.equal(voteAid(w, claim.id, c.id, true).ok, true);

  const before = totalMoney(w);
  resolvePotClaims(w);
  assert.equal(claim.status, 'granted');
  assert.equal(b.wallet, 300 + 80);
  assert.equal(fundBalance(w, k), 120);
  assert.equal(totalMoney(w), before, 'aid is a transfer between parties that already exist');
});

test('who decides is the creed\'s own rule, and never more than the fund holds', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const b = makeCitizen(w, { wallet: 300 });
  const members = found(w, a.id, 'The Long Table', 'members');
  adoptCreed(w, b.id, members.id);
  donateCreed(w, a.id, members.id, 100);
  assert.equal(claimAid(w, b.id, 40, 'a fare out of the city').ok, true);
  const one = openClaims(w, members)[0];
  assert.equal(grantAid(w, one.id, a.id).ok, false, 'a table that votes does not let one member decide');

  const c = makeCitizen(w, { wallet: 400 });
  const d = makeCitizen(w, { wallet: 100 });
  const steward = found(w, c.id, 'The Single Hand', 'officiant');
  adoptCreed(w, d.id, steward.id);
  donateCreed(w, c.id, steward.id, 30);
  assert.equal(claimAid(w, d.id, 500, 'an advocate before the bench').ok, true);
  const big = openClaims(w, steward)[0];
  const before = totalMoney(w);
  assert.equal(grantAid(w, big.id, c.id).ok, true, 'and a creed that named a steward lets them');
  assert.equal(d.wallet, 130, 'trimmed to what the fund actually held');
  assert.equal(fundBalance(w, steward), 0);
  assert.equal(totalMoney(w), before);
});

test('a claim the steward never answers lapses, and does not lock the member out for ever', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const b = makeCitizen(w, { wallet: 100 });
  const k = found(w, a.id, 'The Single Hand', 'officiant');
  adoptCreed(w, b.id, k.id);
  donateCreed(w, a.id, k.id, 60);
  assert.equal(claimAid(w, b.id, 20, 'a fine I cannot carry').ok, true);
  // A member holds one claim at a time, so an officiant who never answers is a
  // door locked behind the claimant. `CREEDS.md` §3 has a creed paying "on the
  // day"; what it did not answer in the window a vote gets lapses.
  assert.equal(claimAid(w, b.id, 20, 'and again').ok, false, 'one claim at a time');
  resolvePotClaims(w);
  assert.equal(openClaims(w, k).length, 1, 'the steward still has the day to answer');
  w.day += 2;
  const before = totalMoney(w);
  resolvePotClaims(w);
  assert.equal(openClaims(w, k).length, 0, 'unanswered, it lapsed');
  assert.equal(fundBalance(w, k), 60, 'a lapse pays nothing');
  assert.equal(totalMoney(w), before);
  assert.equal(claimAid(w, b.id, 20, 'asking again').ok, true, 'and the member may ask again');
});

test('the fund pays for whatever its members think deserves paying for, and stops at empty', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 400 });
  const k = found(w, a.id);
  donateCreed(w, a.id, k.id, 60);
  const before = totalMoney(w);
  assert.equal(payFromFund(w, k, 'treasury', 40, "a member's filing fee"), 40);
  assert.equal(payFromFund(w, k, 'treasury', 100, 'a missionary that cannot be paid for'), 20,
    'a payout that would empty it is trimmed to what is there');
  assert.equal(payFromFund(w, k, 'treasury', 10, 'from an empty fund'), 0);
  assert.equal(totalMoney(w), before);
});

test('a fortnight of tithes and claims leaves the supply exactly where it was', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 500 });
  const roll = Array.from({ length: 4 }, () => makeCitizen(w, { wallet: 300 }));
  const k = found(w, a.id);
  for (const m of roll) adoptCreed(w, m.id, k.id);
  const before = totalMoney(w);

  for (let d = 1; d <= 14; d++) {
    w.day = d;
    for (const c of [a, ...roll]) c.stats.totalEarned += 60;
    if (d === 3) claimAid(w, roll[0].id, 45, 'the household of a member in custody');
    if (d === 3) { voteAid(w, openClaims(w, k)[0].id, a.id, true); voteAid(w, openClaims(w, k)[0].id, roll[1].id, true); }
    dailyCreeds(w);
  }
  assert.ok(fundBalance(w, k) > 0, 'the tithes went somewhere');
  assert.equal(totalMoney(w), before);
  const m = memberOf(k, roll[0].id);
  assert.ok(m && m.tithePaid > 0);
});

test('collecting a tithe reads income since the last collection and nothing else', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { wallet: 1000 });
  const k = found(w, a.id);
  k.tithe = 0.2;
  a.stats.totalEarned = 100;
  collectTithes(w, k);
  assert.equal(fundBalance(w, k), 20);
  collectTithes(w, k);
  assert.equal(fundBalance(w, k), 20, 'no new income, no new tithe');
  a.stats.totalEarned = 150;
  collectTithes(w, k);
  assert.equal(fundBalance(w, k), 30, 'and only the fifty since');
  assert.equal(fundOf(w, k)?.name, `${k.name} (fund)`);
});
