import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Citizen, World } from '../src/types.ts';
import { transfer } from '../src/economy/treasury.ts';
import { requestLoan } from '../src/economy/bank.ts';
import {
  VAULT_SEED, bankOpenNow, bankState, bankSuspended, bankersOnDuty, depositLumens, depositOf, depositsTotal,
  hasBankersLicence, isBankOfficer, payDepositInterest, rescueBank, reserveRequired, seedVault, setDepositRate,
  setLendingRate, setReserveRatio, suspendBank, vaultBalance, vaultId, windUpBank, withdrawLumens,
} from '../src/finance/bank.ts';
import {
  CALL_DAYS, bankConfidence, bankView, borrowingLimit, callLoan, dailyBank, dailyCalledLoans, lendingHeadroom,
  loanBook, mayLend, requestBankLoan, selfDealingBanker, settleVaultFunding,
} from '../src/finance/credit.ts';

/** A banker at the desk, built raw so the test does not lean on jobs.ts. */
function openBank(world: World): Citizen {
  const banker = makeCitizen(world, { district: 'harbor_market' });
  banker.skills.commerce = 60;
  world.jobs.j_bank = {
    id: 'j_bank', role: 'banker', title: 'Banker', employer: 'city', buildingId: 'lantern_bank',
    district: 'harbor_market', skill: 'commerce', minSkill: 35, minReputation: 30, wage: 17,
    output: {}, holderId: banker.id, createdDay: 0,
  };
  banker.jobId = 'j_bank';
  return banker;
}

function openWorld(): { w: World; banker: Citizen } {
  const w = makeWorld();
  w.hour = 10;
  const banker = openBank(w);
  seedVault(w);
  return { w, banker };
}

test('the Treasury capitalises the vault exactly once', () => {
  const { w } = openWorld();
  assert.equal(vaultBalance(w), VAULT_SEED);
  const supply = totalMoney(w);
  assert.equal(seedVault(w), false, 'and never again');
  assert.equal(vaultBalance(w), VAULT_SEED);
  assert.equal(totalMoney(w), supply, 'the seed moved lumens and made none');
});

test('a deposit is a claim on the vault, and the counter keeps hours', () => {
  const { w } = openWorld();
  const c = makeCitizen(w, { wallet: 300 });
  const supply = totalMoney(w);

  w.hour = 20;
  assert.match(depositLumens(w, c.id, 100).message, /counter is open/);
  w.hour = 10;
  assert.equal(depositLumens(w, c.id, 0).ok, false);
  assert.equal(depositLumens(w, c.id, 1_000).ok, false, 'more than the wallet holds');
  assert.equal(depositLumens(w, c.id, 100).ok, true);
  assert.equal(c.wallet, 200);
  assert.equal(depositOf(w, c.id), 100);
  assert.equal(vaultBalance(w), VAULT_SEED + 100);
  assert.equal(totalMoney(w), supply, 'a deposit moves a lumen and creates no claim on the supply');

  c.standing = 'suspended';
  assert.equal(depositLumens(w, c.id, 10).ok, false);
});

test('a withdrawal is first come, first served, and the vault does not scale down', () => {
  const { w } = openWorld();
  const early = makeCitizen(w, { wallet: 3_000 });
  const late = makeCitizen(w, { wallet: 3_000 });
  depositLumens(w, early.id, 2_000);
  depositLumens(w, late.id, 2_000);
  assert.equal(depositsTotal(w), 4_000);

  // The vault lends most of what it holds: the gap is the promise.
  transfer(w, vaultId(w), 'treasury', 5_500, 'loan', 'the vault lends the city');
  assert.equal(vaultBalance(w), 500);

  const supply = totalMoney(w);
  const first = withdrawLumens(w, early.id, 2_000);
  assert.equal(first.ok, true);
  assert.match(first.message, /suspended/);
  assert.equal(early.wallet, 3_000 - 2_000 + 500, 'whoever is at the counter first is paid what there is');
  assert.equal(depositOf(w, early.id), 1_500, 'and the rest of their claim stands');
  assert.equal(bankSuspended(w), true);
  assert.equal(bankOpenNow(w), false);
  assert.equal(withdrawLumens(w, late.id, 100).ok, false, 'the one behind them gets nothing');
  assert.equal(late.wallet, 1_000);
  assert.equal(totalMoney(w), supply);
});

test('interest is carried until it is worth a lumen, then paid out of the vault', () => {
  const { w } = openWorld();
  const c = makeCitizen(w, { wallet: 500 });
  depositLumens(w, c.id, 100);          // 0.4 ℓ a day at the founding rate
  const supply = totalMoney(w);
  payDepositInterest(w);
  assert.equal(c.wallet, 400, 'four tenths of a lumen is not a lumen');
  payDepositInterest(w);
  payDepositInterest(w);
  assert.equal(c.wallet, 401, 'and three days of it is');
  assert.equal(vaultBalance(w), VAULT_SEED + 100 - 1);
  assert.equal(totalMoney(w), supply);
});

test('only the bank’s own bankers post its rates, and the spread never inverts', () => {
  const { w, banker } = openWorld();
  const stranger = makeCitizen(w);
  assert.equal(isBankOfficer(w, banker.id), true);
  assert.equal(isBankOfficer(w, stranger.id), false);
  assert.equal(setDepositRate(w, stranger.id, 0.01).ok, false);
  assert.equal(setDepositRate(w, banker.id, 0.05).ok, false, 'never above the lending rate');
  assert.equal(setDepositRate(w, banker.id, 0.01).ok, true);
  assert.equal(bankState(w).depositRate, 0.01);
  assert.equal(setLendingRate(w, banker.id, 0.005).ok, false, 'and never below the deposit rate');
  assert.equal(setLendingRate(w, banker.id, 0.03).ok, true);
  assert.equal(bankState(w).lendingRate, 0.03);
});

test('the Council sets the reserve, and the bank will not lend below it', () => {
  const { w } = openWorld();
  const saver = makeCitizen(w, { wallet: 4_000 });
  depositLumens(w, saver.id, 4_000);
  assert.equal(setReserveRatio(w, 0.25).ok, true);
  assert.equal(reserveRequired(w), 1_000);
  assert.equal(lendingHeadroom(w), VAULT_SEED + 4_000 - 1_000);
  assert.equal(mayLend(w, 5_000).ok, true);
  assert.equal(mayLend(w, 5_001).ok, false);
  assert.match(mayLend(w, 6_000).message, /reserve/);

  setReserveRatio(w, 2);        // clamped to the charter's ceiling
  assert.equal(bankState(w).reserveRatio, 1);
  assert.equal(lendingHeadroom(w), VAULT_SEED + 4_000 - 4_000);
});

test('a loan is funded by the vault and its repayments come back to it', () => {
  const { w } = openWorld();
  const borrower = makeCitizen(w, { wallet: 0 });
  borrower.stats.totalEarned = 400;
  const saver = makeCitizen(w, { wallet: 1_000 });
  const supply = totalMoney(w);

  assert.equal(requestBankLoan(w, borrower.id, 500).ok, true);
  assert.equal(borrower.wallet, 500);
  assert.equal(loanBook(w), 500);
  settleVaultFunding(w);
  assert.equal(vaultBalance(w), VAULT_SEED - 500, 'the vault funds the lending, not the city');

  // The bank creates no money: the vault holds its seed and every deposit,
  // less exactly what has been lent out. The gap is the promise.
  depositLumens(w, saver.id, 1_000);
  assert.equal(vaultBalance(w), VAULT_SEED + depositsTotal(w) - loanBook(w));

  transfer(w, borrower.id, 'treasury', 500, 'repayment', 'repaid in full');
  settleVaultFunding(w);
  assert.equal(vaultBalance(w), VAULT_SEED + 1_000, 'and the repayment comes home');
  assert.equal(totalMoney(w), supply, 'through it all, nothing was minted');
});

test('lending the vault cannot fund stands against it as a debt to the city', () => {
  const { w } = openWorld();
  const bank = bankState(w);
  transfer(w, vaultId(w), 'treasury', VAULT_SEED - 100, 'capital', 'the vault is nearly empty');
  const borrower = makeCitizen(w, { wallet: 0 });
  borrower.stats.totalEarned = 400;
  requestLoan(w, borrower.id, 500);          // straight through economy/bank.ts, past the reserve check
  settleVaultFunding(w);
  assert.equal(vaultBalance(w), 0);
  assert.equal(bank.owedToTreasury, 400);
  transfer(w, borrower.id, 'treasury', 500, 'repayment', 'repaid in full');
  settleVaultFunding(w);
  assert.equal(bank.owedToTreasury, 0, 'the city is paid back first');
  assert.equal(vaultBalance(w), 100);
});

test('a banker lending to themselves or their household is misappropriation', () => {
  const { w, banker } = openWorld();
  banker.stats.totalEarned = 400;
  assert.equal(selfDealingBanker(w, banker.id), banker.id);
  const housemate = makeCitizen(w, { wallet: 0 });
  housemate.householdId = 'h_1';
  banker.householdId = 'h_1';
  assert.equal(selfDealingBanker(w, housemate.id), banker.id);
  const stranger = makeCitizen(w, { wallet: 0 });
  assert.equal(selfDealingBanker(w, stranger.id), null);

  // The charge itself is laid through `commitOffence`, which ignores a code the
  // Code of the City does not yet carry: L24 arrives with `data/laws.ts`, and
  // the reading that finds the banker is what this layer owns.
  const supply = totalMoney(w);
  assert.equal(requestBankLoan(w, banker.id, 300).ok, true);
  assert.equal(totalMoney(w), supply);
});

test('the bank will not lend below the reserve, whoever asks', () => {
  const { w } = openWorld();
  const saver = makeCitizen(w, { wallet: 8_000 });
  depositLumens(w, saver.id, 8_000);
  setReserveRatio(w, 0.25);
  // Yesterday's lending has already taken the vault below the reserve.
  transfer(w, vaultId(w), 'treasury', 8_500, 'loan', 'lent out yesterday');
  const borrower = makeCitizen(w, { wallet: 0 });
  borrower.stats.totalEarned = 4_000;
  const refused = requestBankLoan(w, borrower.id, 500);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /reserve/);
  assert.equal(loanBook(w), 0);
  assert.equal(borrowingLimit(w, borrower), 0);
});

test('confidence is read off the vault, the book, the bankers and the talk', () => {
  const { w, banker } = openWorld();
  banker.reputation = 90;
  const saver = makeCitizen(w, { wallet: 4_000 });
  depositLumens(w, saver.id, 4_000);
  const full = bankConfidence(w);
  assert.ok(full > 0.8, `a covered vault reads well (${full})`);

  transfer(w, vaultId(w), 'treasury', vaultBalance(w), 'capital', 'the vault is emptied');
  const empty = bankConfidence(w);
  assert.ok(empty < full - 0.4, `an empty vault reads badly (${empty})`);
  assert.ok(empty >= 0 && empty <= 1);
});

test('a called loan is answered in three days or it goes to recovery', () => {
  const { w, banker } = openWorld();
  const borrower = makeCitizen(w, { wallet: 0 });
  borrower.stats.totalEarned = 400;
  requestBankLoan(w, borrower.id, 400);
  const loanId = borrower.loanId!;
  const stranger = makeCitizen(w);
  assert.equal(callLoan(w, stranger.id, loanId).ok, false, 'only a banker calls a loan');
  assert.equal(callLoan(w, banker.id, loanId).ok, true);
  assert.equal(callLoan(w, banker.id, loanId).ok, false, 'and only once');

  dailyCalledLoans(w);
  assert.equal(w.loans[loanId].defaulted, false, 'three days means three days');
  w.day += CALL_DAYS;
  dailyCalledLoans(w);
  assert.equal(w.loans[loanId].defaulted, true);
});

test('the Council may rescue the bank, or let it fail', () => {
  const { w } = openWorld();
  const saver = makeCitizen(w, { wallet: 4_000 });
  depositLumens(w, saver.id, 4_000);
  transfer(w, vaultId(w), 'treasury', vaultBalance(w) - 400, 'capital', 'lent out to the last lumen');
  suspendBank(w, 'the vault is empty');
  assert.equal(bankSuspended(w), true);

  const supply = totalMoney(w);
  assert.equal(rescueBank(w, 1_000).ok, true);
  assert.equal(vaultBalance(w), 1_400);
  assert.equal(bankSuspended(w), false, 'the run stops the hour it passes');
  assert.equal(bankState(w).rescued, 1_000);
  assert.equal(totalMoney(w), supply, 'a bailout is a transfer, not a minting');

  // Or the other door: what it holds, pro rata, and no more.
  suspendBank(w, 'it went again');
  const before = saver.wallet;
  assert.equal(windUpBank(w).ok, true);
  assert.equal(saver.wallet, before + 1_400, 'one depositor takes the whole of a pro rata share');
  assert.equal(depositOf(w, saver.id), 4_000 - 1_400, 'and is a creditor for the rest');
  assert.equal(totalMoney(w), supply);
});

test('the morning settles, pays, reads and prints', () => {
  const { w } = openWorld();
  const saver = makeCitizen(w, { wallet: 2_000 });
  depositLumens(w, saver.id, 1_000);
  const supply = totalMoney(w);
  dailyBank(w);
  assert.ok(bankState(w).confidence > 0);
  assert.equal(bankState(w).servedToday.length, 0);
  assert.equal(totalMoney(w), supply);

  const view = bankView(w, saver.id);
  assert.equal(view.yours, 1_000);
  assert.equal(view.deposits, 1_000);
  assert.equal(view.vault, VAULT_SEED + 1_000 - 4, 'less the four lumens of interest the morning paid');
  assert.equal(view.reserveRatio, 0.25);
  assert.equal(view.open, true);
});

test("a banker's licence is the Council's floor until the Lantern House sets one", () => {
  const { w, banker } = openWorld();
  assert.equal(hasBankersLicence(w, banker.id), true, 'a post at the bank is a licence by any reading');
  const merchant = makeCitizen(w);
  merchant.skills.commerce = 60;
  assert.equal(hasBankersLicence(w, merchant.id), true);
  const apprentice = makeCitizen(w);
  apprentice.skills.commerce = 20;
  assert.equal(hasBankersLicence(w, apprentice.id), false);
  const child = makeCitizen(w);
  child.skills.commerce = 90;
  child.lifeStage = 'child';
  assert.equal(hasBankersLicence(w, child.id), false);
  assert.equal(bankersOnDuty(w).length, 1);
});
