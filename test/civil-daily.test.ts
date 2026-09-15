/**
 * The civil layer's own day, and its standing audit (src/civil/).
 *
 * `dailyCivil` is the whole of what the Exchange does each morning. This runs a
 * small city of contracts through a fortnight of it — stipends, deliveries,
 * breaches, a suit, a judgment and the recovery ladder — and then asks the one
 * question the Charter cares about: did anything unlawful happen to anybody?
 *
 * Article VI, in this layer, is absolute. Nothing civil may fine, suspend,
 * exile, detain or convict, however long a debt stands and however plainly the
 * debtor could have paid it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, World } from '../src/types.ts';
import { transfer, withholdingPay } from '../src/economy/treasury.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { acceptContract, offerContract, performContract } from '../src/civil/contracts.ts';
import { allContracts, contractById } from '../src/civil/terms.ts';
import { acceptPatronage, offerPatronage } from '../src/civil/patronage.ts';
import { answerSuit, fileSuit, isDocketDay, judgeCivil, suitById } from '../src/civil/docket.ts';
import { closeCivilDocket, dailyCivil, openCivilDocket } from '../src/civil/daily.ts';
import {
  detectConveyances, enforceJudgment, enforcementStep, judgmentDebtOf, judgmentsAgainst, outstanding,
} from '../src/civil/enforcement.ts';
import { totalEscrowed } from '../src/civil/escrow.ts';

/**
 * One day as the world runs it: the rollover at hour 0, the docket's benches
 * seated at 16 before anybody decides anything, the citizens' own hour, and the
 * votes counted at the end of it.
 */
function liveDay(world: World, day: number, act?: (world: World) => void): void {
  world.day = day;
  world.hour = 0;
  world.tick = day * 24;
  dailyCivil(world);
  world.hour = 16;
  world.tick = day * 24 + 16;
  openCivilDocket(world);
  act?.(world);
  closeCivilDocket(world);
}

test('a fortnight of the Exchange conserves every lumen and touches nobody’s liberty', () => {
  const world = makeWorld();
  const landlord = makeCitizen(world, { name: 'Landlord', wallet: 400 });
  const tenant = makeCitizen(world, { name: 'Tenant', wallet: 200 });
  const patron = makeCitizen(world, { name: 'Patron', wallet: 800 });
  const artist = makeCitizen(world, { name: 'Artist', wallet: 120 });
  const judge = makeCitizen(world, { name: 'Judge', wallet: 100, reputation: 80 });
  world.government.judges.push(judge.id);
  const everyone: Citizen[] = [landlord, tenant, patron, artist, judge];
  const start = totalMoney(world);

  const lease = offerContract(world, landlord.id, {
    to: tenant.id, kind: 'lease', terms: 'a room at 21 Lantern Row', consideration: 6, days: 12, penalty: 30,
  }).id!;
  assert.equal(acceptContract(world, tenant.id, lease).ok, true);
  const stipend = offerPatronage(world, patron.id, { to: artist.id, perDay: 9, days: 12, subject: 'the harbour at dusk' }).id!;
  assert.equal(acceptPatronage(world, artist.id, stipend).ok, true);

  let suitId: string | null = null;
  for (let day = 1; day <= 14; day += 1) {
    liveDay(world, day, () => {
      // The tenant pays for four days and then stops.
      if (day <= 4) performContract(world, tenant.id, lease);
      if (day === 7 && suitId === null) {
        const r = fileSuit(world, landlord.id, {
          defendant: tenant.id, contractId: lease, damages: 60,
          claim: 'the rent of 6 lumens a day went unpaid from day 5 under a filed lease',
        });
        assert.equal(r.ok, true, r.message);
        suitId = r.id!;
        assert.equal(answerSuit(world, tenant.id, suitId, 'deny', 'The room was not fit to sleep in.').ok, true);
      }
      if (suitId && suitById(world, suitId)!.status === 'in_session') {
        judgeCivil(world, judge.id, suitId, 'plaintiff', 40, 'damages', 'The lease is filed and four days of rent are outstanding.');
      }
    });
  }

  assert.equal(contractById(world, lease)!.status, 'breached');
  assert.equal(contractById(world, stipend)!.status, 'kept', 'a patron who paid every morning kept it');
  assert.equal(suitById(world, suitId!)!.status, 'judged');
  assert.equal(totalMoney(world), start, 'a fortnight of civil law mints nothing and burns nothing');
  assert.equal(totalEscrowed(world), 0);

  for (const c of everyone) {
    assert.equal(c.standing, 'good', `${c.name} kept their standing`);
    assert.equal(c.jailedUntilDay, null, `${c.name} was never in a cell`);
    assert.equal(c.record.convictions.length, 0, `${c.name} was never convicted`);
    assert.equal(c.communityServiceDaysLeft, 0);
    assert.equal(c.suspendedUntilDay, null);
  }
  assert.equal(world.bans.length, 0);
  assert.equal(Object.keys(world.cases).length, 0, 'the docket files no charges');
});

test('the ladder collects a judgment, and stops exactly where the Charter stops it', () => {
  const world = makeWorld();
  const creditor = makeCitizen(world, { name: 'Creditor', wallet: 300 });
  const debtor = makeCitizen(world, { name: 'Debtor', wallet: 200 });
  const id = offerContract(world, creditor.id, {
    to: debtor.id, kind: 'loan', terms: 'fifteen lumens a day for ten days', consideration: 15, days: 10, penalty: 0,
  }).id!;
  assert.equal(acceptContract(world, debtor.id, id).ok, true);
  for (let day = 1; day <= 3; day += 1) liveDay(world, day);
  assert.equal(contractById(world, id)!.status, 'breached');

  const suit = fileSuit(world, creditor.id, {
    defendant: debtor.id, contractId: id, damages: 60,
    claim: 'the instalment of 15 lumens due on day 1 under the filed loan was never paid',
  }).id!;
  assert.equal(answerSuit(world, debtor.id, suit, 'admit', 'I could not pay it.').ok, true);
  const judgment = judgmentsAgainst(world, debtor.id)[0];
  assert.ok(judgment);
  debtor.wallet = 0;

  const start = totalMoney(world);
  for (let day = 4; day <= 20; day += 1) {
    liveDay(world, day, () => {
      // Three days to pay come first, and the creditor may not jump them.
      if (day === 4) assert.equal(enforceJudgment(world, creditor.id, judgment.id).ok, false);
      if (day === 7) assert.equal(enforceJudgment(world, creditor.id, judgment.id).ok, true);
      withholdingPay(world, 'treasury', debtor.id, 40, 'wage', 'a shift at the Forge');
    });
  }
  assert.ok(judgment.paid > 0, 'the ladder collected something');
  assert.ok(judgment.paid <= judgment.amount);
  assert.equal(totalMoney(world), start);
  assert.equal(judgmentDebtOf(world, debtor.id), outstanding(judgment));
  assert.ok(['garnishment', 'seizure', 'stock', 'licence', 'contempt', 'none'].includes(enforcementStep(world, debtor.id).step));

  // Everything the Charter forbids, checked one at a time.
  assert.equal(debtor.standing, 'good');
  assert.equal(debtor.jailedUntilDay, null);
  assert.equal(debtor.suspendedUntilDay, null);
  assert.equal(debtor.record.convictions.length, 0);
  assert.equal(world.bans.length, 0);
  assert.equal(Object.keys(world.cases).length, 0);
});

test('moving lumens to a friend while a judgment stands is read out of the ledger, and charged by nobody here', () => {
  const world = makeWorld();
  const creditor = makeCitizen(world, { name: 'Creditor', wallet: 300 });
  const debtor = makeCitizen(world, { name: 'Debtor', wallet: 400 });
  const friend = makeCitizen(world, { name: 'Friend', wallet: 0 });
  debtor.bonds[friend.id] = 70;
  friend.bonds[debtor.id] = 70;
  const id = offerContract(world, creditor.id, {
    to: debtor.id, kind: 'loan', terms: 'fifteen a day', consideration: 15, days: 10, penalty: 0,
  }).id!;
  acceptContract(world, debtor.id, id);
  for (let day = 1; day <= 3; day += 1) liveDay(world, day);
  const suit = fileSuit(world, creditor.id, {
    defendant: debtor.id, contractId: id, damages: 60, claim: 'the instalment due on day 1 was never paid',
  }).id!;
  answerSuit(world, debtor.id, suit, 'admit', 'I did not pay.');
  assert.deepEqual(detectConveyances(world), [], 'nothing has moved yet');

  transfer(world, debtor.id, friend.id, 150, 'gift', 'a present, entirely coincidental');
  const findings = detectConveyances(world);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'L22');
  assert.equal(findings[0].citizenId, debtor.id);
  assert.equal(findings[0].to, friend.id);
  assert.equal(findings[0].amount, 150);
  // Reading it is all this layer does: no charge, no case, nothing on the record.
  assert.equal(Object.keys(world.cases).length, 0);
  assert.equal(debtor.standing, 'good');
  assert.equal(debtor.record.convictions.length, 0);
});

test('the docket only sits on its own days', () => {
  const world = makeWorld();
  world.day = 3;
  assert.equal(isDocketDay(world), false);
  world.hour = 16;
  openCivilDocket(world);
  assert.equal(allContracts(world).length, 0);
});
