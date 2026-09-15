/**
 * Where an estate goes (`docs/GENERATIONS.md` §3).
 *
 * An estate opens on **sunset**, on **emigration**, and on **erasure** — the
 * victim's estate passes to their family, as `JUSTICE.md` §3 promises. An
 * **exile's** assets are seized by the Court as they always were; exile leaves
 * no estate, and `openEstate` refuses one.
 *
 * Debts settle first (the loan, the unpaid fines), then the duty, then the
 * will's shares to heirs living anywhere in the Expanse, then the residue —
 * and the family floor in `wills.ts` comes out of the shares, never out of the
 * Treasury.
 *
 * Duty is paid in lumens, so an estate that is land and no cash must be sold:
 * the estate stays open for `EXECUTOR_DAYS` while the executor sells, after
 * which the Exchange liquidates at 60–75 % of market value. **This is what
 * breaks up great houses** — and the entail (`entail.ts`) is why it does not
 * break up all of them.
 *
 * The **reading** is a happening at the Hall of Records the morning after the
 * estate opens, and the shares are printed. An executor who under-declared is
 * found the way `GENERATIONS.md` §8 says they are found: the Hall holds the
 * tree, the Exchange holds the filings, and the arithmetic does not match.
 */
import type { Citizen, CitizenId, HappeningKind, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens, transfer } from '../economy/treasury.ts';
import { rand } from '../util/rng.ts';
import { addHappening } from '../society/calendar.ts';
import { commitOffence } from '../government/watch.ts';
import { marketPrice, setAsking } from '../markets/property.ts';
import type { Estate, EstateCause, EstateLine, Will } from './state.ts';
import {
  GENERATIONS_LAWS, generationsKind, generationsLaw, generationsState, nextGenerationsId, willOf,
} from './state.ts';
import { LIQUIDATION_HIGH, LIQUIDATION_LOW, entailedIn, unitById } from './entail.ts';
import { isAdult } from './houses.ts';
import {
  FLOOR_SHARE, FLOOR_TOTAL, defaultDivision, dutyOn, estateName, floorHeirs, siblingsOf,
} from './wills.ts';

/** Days the executor has to sell the land before the Exchange does it for them. */
export const EXECUTOR_DAYS = 14;
/** What the Exchange takes for executing an estate nobody else would. */
export const EXCHANGE_EXECUTOR_FEE = 0.02;
/** Where the shares are read out, the morning after the estate opens. */
export const READING_VENUE = 'hall_of_records';
export const READING_HOUR = 8;
/** `reading` is this layer's happening; the calendar carries it like any other. */
export const READING_KIND = 'reading' as unknown as HappeningKind;

/** Kin still in the register and not gone for good, for the executor's list. */
function livingKin(world: World, ids: readonly CitizenId[]): Citizen[] {
  const out: Citizen[] = [];
  for (const id of ids) {
    const c = world.citizens[id];
    if (c && c.standing !== 'exiled' && c.sunsetDay === null) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Opening an estate
// ---------------------------------------------------------------------------

/** Units the register still shows in this citizen's name, the entailed ones excepted. */
export function estateUnits(world: World, c: Citizen): string[] {
  return (c.ownedUnits ?? []).filter((id) => {
    const u = unitById(world, id);
    return !!u && u.ownerId === c.id && entailedIn(world, id) === null;
  });
}

/** What the land in an estate is worth at today's prices. */
export function estateLandValue(world: World, unitIds: readonly string[]): number {
  let total = 0;
  for (const id of unitIds) {
    const u = unitById(world, id);
    if (u) total += marketPrice(world, u);
  }
  return Math.round(total);
}

/** Debts an estate settles before anything else: the loan, and unpaid fines. */
export function estateDebts(world: World, c: Citizen): number {
  const loan = c.loanId ? world.loans?.[c.loanId] ?? null : null;
  const owed = loan ? Math.max(0, Math.round(loan.outstanding)) : 0;
  return owed + Math.max(0, Math.round(c.finesOwed ?? 0));
}

export function estateFor(world: World, cId: CitizenId): Estate | null {
  return Object.values(generationsState(world).estates).find((e) => e.citizenId === cId) ?? null;
}

export function openEstates(world: World): Estate[] {
  return Object.values(generationsState(world).estates).filter((e) => e.status === 'open');
}

/** Whoever the will names, else the eldest living adult heir, else the Exchange. */
function chooseExecutor(world: World, c: Citizen, will: Will | null): CitizenId | null {
  const named = will?.executorId ? world.citizens[will.executorId] ?? null : null;
  if (named && named.standing !== 'exiled' && named.sunsetDay === null && isAdult(named)) return named.id;
  const heirs = [
    ...livingKin(world, c.family?.partnerId ? [c.family.partnerId] : []),
    ...livingKin(world, c.family?.children ?? []),
    ...livingKin(world, c.family?.parents ?? []),
    ...siblingsOf(world, c),
  ].filter(isAdult);
  const eldest = heirs.sort((a, b) => (a.bornDay ?? 0) - (b.bornDay ?? 0) || a.id.localeCompare(b.id, 'en'))[0];
  return eldest ? eldest.id : null;
}

/**
 * Open an estate. Called on sunset, on emigration and on erasure — never on
 * exile, and never twice for the same citizen. Debts are settled as far as the
 * purse goes at once; the rest waits on the land being turned into lumens.
 */
export function openEstate(world: World, cId: CitizenId, cause: EstateCause): Estate | null {
  const c = world.citizens[cId];
  if (!c) return null;
  if (c.standing === 'exiled') return null;       // exile leaves no estate
  const already = estateFor(world, cId);
  if (already) return already;

  const will = willOf(world, cId);
  const units = estateUnits(world, c);
  const land = estateLandValue(world, units);
  const cash = Math.max(0, Math.floor(c.wallet));
  const debts = estateDebts(world, c);
  const gross = cash + land;
  const net = Math.max(0, gross - debts);
  const duty = dutyOn(world, net);
  const executorId = chooseExecutor(world, c, will);

  const estate: Estate = {
    id: nextGenerationsId(world, 'es'),
    citizenId: cId,
    cause,
    openedDay: world.day,
    will: will ? { ...will, shares: will.shares.map((s) => ({ ...s })) } : null,
    executorId,
    exchangeExecuted: executorId === null,
    gross,
    debts,
    duty,
    units,
    sellByDay: world.day + EXECUTOR_DAYS,
    status: 'open',
    settledDay: null,
    lines: [],
    read: false,
  };
  generationsState(world).estates[estate.id] = estate;

  payDebts(world, estate, c);
  emit(world, 'household', `The estate of ${c.name} ${c.familyName} opened at the Exchange: ${formatLumens(gross)} in all, ${formatLumens(debts)} of debts, ${formatLumens(duty)} of duty.`.trim(),
    [cId], 0.5, { estateId: estate.id, citizenId: cId, cause, gross, debts, duty });
  addHappening(world, {
    kind: READING_KIND, day: world.day + 1, hour: READING_HOUR, buildingId: READING_VENUE,
    who: [cId], label: `the reading of ${c.name} ${c.familyName}'s will at the Hall of Records`.trim(),
  });
  if (units.length === 0) settleEstate(world, estate);
  return estate;
}

/** Debts first, as far as the purse goes. What it cannot reach stands unpaid. */
function payDebts(world: World, estate: Estate, c: Citizen): number {
  let paid = 0;
  const loan = c.loanId ? world.loans?.[c.loanId] ?? null : null;
  if (loan) {
    const owed = Math.max(0, Math.round(loan.outstanding));
    const pay = Math.min(owed, Math.max(0, Math.floor(c.wallet)));
    if (pay > 0 && transfer(world, c.id, 'treasury', pay, 'repayment', `${c.name}'s estate settles the loan`)) {
      loan.outstanding = owed - pay;
      paid += pay;
      estate.lines.push({ kind: 'debt', to: 'treasury', amount: pay, reason: 'the Lantern Bank' });
    }
    if (loan.outstanding <= 0) {
      delete world.loans[loan.id];
      c.loanId = null;
    }
  }
  const fines = Math.max(0, Math.round(c.finesOwed ?? 0));
  if (fines > 0) {
    const pay = Math.min(fines, Math.max(0, Math.floor(c.wallet)));
    if (pay > 0 && transfer(world, c.id, 'treasury', pay, 'fine', `${c.name}'s estate settles unpaid fines`)) {
      c.finesOwed = fines - pay;
      if (c.finesOwed <= 0) c.finesOwedSinceDay = null;
      paid += pay;
      estate.lines.push({ kind: 'debt', to: 'treasury', amount: pay, reason: 'unpaid fines' });
    }
  }
  return paid;
}

/**
 * The Exchange turns the land into lumens: 60–75 % of what it is worth, which
 * is the price of not having sold it yourself. The city takes the deed.
 */
export function liquidateEstate(world: World, estate: Estate): number {
  const c = world.citizens[estate.citizenId];
  if (!c) return 0;
  let got = 0;
  for (const unitId of [...estate.units]) {
    const u = unitById(world, unitId);
    if (!u || u.ownerId !== c.id) { estate.units = estate.units.filter((id) => id !== unitId); continue; }
    const share = LIQUIDATION_LOW + rand(world) * (LIQUIDATION_HIGH - LIQUIDATION_LOW);
    const price = Math.max(1, Math.round(marketPrice(world, u) * share));
    if (world.treasury.balance < price) continue;
    if (!transfer(world, 'treasury', c.id, price, 'property', `the Exchange liquidated ${unitId} out of ${c.name}'s estate`)) continue;
    u.ownerId = 'city';
    setAsking(world, u, 0);
    c.ownedUnits = (c.ownedUnits ?? []).filter((id) => id !== unitId);
    estate.units = estate.units.filter((id) => id !== unitId);
    got += price;
  }
  if (got > 0) {
    emit(world, 'property', `The Exchange liquidated the land of ${c.name} ${c.familyName}'s estate for ${formatLumens(got)}.`.trim(),
      [c.id], 0.4, { estateId: estate.id, amount: got });
  }
  return got;
}

// ---------------------------------------------------------------------------
// Paying it out
// ---------------------------------------------------------------------------

export interface Entitlement { to: CitizenId | 'chest'; amount: number; kind: EstateLine['kind'] }

/** The will's shares, the floor, and the residue, in lumens. */
export function divideEstate(world: World, estate: Estate, divisible: number): Entitlement[] {
  const c = world.citizens[estate.citizenId];
  if (!c || divisible <= 0) return [];
  const will = estate.will;
  const rows = new Map<CitizenId | 'chest', Entitlement>();
  const add = (to: CitizenId | 'chest', amount: number, kind: EstateLine['kind']): void => {
    if (amount <= 0) return;
    const held = rows.get(to);
    if (held) held.amount += amount;
    else rows.set(to, { to, amount, kind });
  };

  let named = 0;
  if (will) {
    for (const s of will.shares) {
      const heir = world.citizens[s.to];
      if (!heir || heir.id === c.id) continue;
      const amount = Math.floor((divisible * s.percent) / 100);
      add(s.to, amount, 'share');
      named += amount;
    }
  }
  const residue = Math.max(0, divisible - named);
  if (residue > 0) {
    if (will && will.residue) {
      add(will.residue, residue, 'residue');
    } else {
      for (const row of defaultDivision(world, c)) {
        add(row.to, Math.floor((residue * row.percent) / 100), 'residue');
      }
    }
  }

  // The floor: the partner and each under-age child, whatever the will says.
  const heirs = floorHeirs(world, c);
  if (heirs.length > 0) {
    const each = Math.floor(divisible * FLOOR_SHARE);
    const cap = Math.floor(divisible * FLOOR_TOTAL);
    let topUp = 0;
    for (const heir of heirs) {
      const held = rows.get(heir.id)?.amount ?? 0;
      const want = Math.min(each, Math.max(0, cap - (topUp + held)));
      if (held >= want) continue;
      const short = want - held;
      if (short <= 0) continue;
      add(heir.id, short, 'floor');
      const row = rows.get(heir.id);
      if (row) row.kind = 'floor';
      topUp += short;
    }
    if (topUp > 0) {
      // Everybody else gives up their share of it, pro rata: the floor comes
      // out of the estate, never out of the Treasury.
      const others = [...rows.values()].filter((r) => !heirs.some((h) => h.id === r.to));
      const pool = others.reduce((sum, r) => sum + r.amount, 0);
      let left = topUp;
      for (const row of others) {
        if (left <= 0 || pool <= 0) break;
        const give = Math.min(row.amount, Math.round((row.amount / pool) * topUp));
        row.amount -= give;
        left -= give;
      }
      for (const row of others) {
        if (left <= 0) break;
        const give = Math.min(row.amount, left);
        row.amount -= give;
        left -= give;
      }
    }
  }
  return [...rows.values()].filter((r) => r.amount > 0);
}

/**
 * Settle: the duty, the executor's fee where the Exchange acted, and then the
 * shares — every one of them an ordinary transfer out of the estate's purse.
 */
export function settleEstate(world: World, estate: Estate): void {
  if (estate.status !== 'open') return;
  const c = world.citizens[estate.citizenId];
  if (!c) { estate.status = 'settled'; estate.settledDay = world.day; return; }

  payDebts(world, estate, c);
  const purse = Math.max(0, Math.floor(c.wallet));
  const duty = Math.min(estate.duty, purse);
  if (duty > 0 && transfer(world, c.id, 'treasury', duty, generationsKind('duty'), `estate duty on ${c.name}'s estate`)) {
    estate.lines.push({ kind: 'duty', to: 'treasury', amount: duty, reason: 'the estate duty' });
  }
  let divisible = Math.max(0, Math.floor(c.wallet));
  if (estate.exchangeExecuted && divisible > 0) {
    const fee = Math.round(divisible * EXCHANGE_EXECUTOR_FEE);
    if (fee > 0 && transfer(world, c.id, 'treasury', fee, 'fee', `the Exchange executed ${c.name}'s estate`)) {
      estate.lines.push({ kind: 'executor', to: 'treasury', amount: fee, reason: 'the Exchange as executor' });
      divisible -= fee;
    }
  }

  const rows = divideEstate(world, estate, divisible);
  for (const row of rows) {
    const to = row.to;
    const amount = Math.min(row.amount, Math.max(0, Math.floor(c.wallet)));
    if (amount <= 0) continue;
    if (!transfer(world, c.id, to, amount, generationsKind('estate'), `${c.name}'s estate`)) continue;
    estate.lines.push({ kind: row.kind, to, amount, reason: row.kind === 'floor' ? 'the family floor' : row.kind });
    if (to !== 'chest') {
      remember(world, to, 'family', `${c.name} ${c.familyName}'s estate paid you ${formatLumens(amount)}.`.trim());
    }
  }
  // Rounding leaves a lumen or two behind; it goes to the largest share rather
  // than sitting in a purse nobody can reach.
  const over = Math.max(0, Math.floor(c.wallet));
  const largest = [...rows].sort((a, b) => b.amount - a.amount)[0];
  if (over > 0 && largest && transfer(world, c.id, largest.to, over, generationsKind('estate'), `remainder of ${c.name}'s estate`)) {
    estate.lines.push({ kind: largest.kind, to: largest.to, amount: over, reason: 'the remainder' });
  }
  estate.status = 'settled';
  estate.settledDay = world.day;
}

// ---------------------------------------------------------------------------
// The reading, and the executor who under-declared
// ---------------------------------------------------------------------------

/** The morning after: the shares are read out at the Hall of Records, and printed. */
export function holdReading(world: World, estate: Estate): void {
  if (estate.read) return;
  estate.read = true;
  const c = world.citizens[estate.citizenId];
  const name = c ? `${c.name} ${c.familyName}`.trim() : 'a citizen';
  const paid = estate.lines.filter((l) => l.kind !== 'debt' && l.kind !== 'duty' && l.kind !== 'executor');
  const shares = paid.map((l) => `${estateName(world, l.to)} ${formatLumens(l.amount)}`).join(', ');
  const heirs = paid.map((l) => l.to).filter((to): to is CitizenId => to !== 'chest' && to !== 'treasury');
  emit(world, 'household', shares
    ? `The will of ${name} was read at the Hall of Records: ${shares}.`
    : `The will of ${name} was read at the Hall of Records; the estate had nothing left to divide.`,
  [estate.citizenId, ...heirs], 0.6, { estateId: estate.id, citizenId: estate.citizenId, lines: estate.lines.length });
}

/**
 * Concealment of an estate (L43): an executor under-declaring the assets. The
 * Hall holds the tree, the Exchange holds the filings, and the arithmetic does
 * not match — a deed the register still shows in the dead citizen's name that
 * the estate never declared. It leaves a trace like any other offence.
 */
export function checkConcealment(world: World, estate: Estate): boolean {
  const c = world.citizens[estate.citizenId];
  if (!c || !estate.executorId || estate.status !== 'settled') return false;
  const undeclared = (c.ownedUnits ?? []).filter((id) => {
    const u = unitById(world, id);
    return !!u && u.ownerId === c.id && entailedIn(world, id) === null;
  });
  if (undeclared.length === 0) return false;
  commitOffence(world, estate.executorId, generationsLaw(GENERATIONS_LAWS.concealmentOfAnEstate), {
    amount: estateLandValue(world, undeclared),
  });
  emit(world, 'household', `The Exchange's arithmetic on ${c.name}'s estate does not match the register: ${undeclared.length} undeclared ${undeclared.length === 1 ? 'deed' : 'deeds'}.`,
    [estate.executorId], 0.5, { estateId: estate.id, undeclared: undeclared.length, law: GENERATIONS_LAWS.concealmentOfAnEstate });
  return true;
}

/**
 * The morning: readings are held, estates whose land has gone are settled, and
 * an estate that has run out of days is liquidated by the Exchange and settled
 * whatever is left of it.
 */
export function dailyEstates(world: World): void {
  for (const estate of Object.values(generationsState(world).estates)) {
    if (estate.status === 'settled') {
      if (!estate.read && world.day > estate.openedDay) holdReading(world, estate);
      continue;
    }
    const c = world.citizens[estate.citizenId];
    if (!c) { estate.status = 'settled'; estate.settledDay = world.day; continue; }
    estate.units = estate.units.filter((id) => {
      const u = unitById(world, id);
      return !!u && u.ownerId === c.id;
    });
    if (world.day >= estate.sellByDay) liquidateEstate(world, estate);
    if (estate.units.length === 0) {
      settleEstate(world, estate);
      checkConcealment(world, estate);
    }
    if (!estate.read && world.day > estate.openedDay) holdReading(world, estate);
  }
}
