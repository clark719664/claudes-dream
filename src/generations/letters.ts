/**
 * What a name buys, and what it never buys (`docs/GENERATIONS.md` §2, §6).
 *
 * Three instruments live here, and every one of them is public:
 *
 * - **The letter of the house** — this citizen is of this house, and the house
 *   stands behind them. It takes a day off a destination Registry's background
 *   check and is admissible at the appeal of a refused visa and at a residency
 *   hearing. **It shifts no threshold and buys no repute.** A head's
 *   sponsorship is entered against the house, and a conviction of that
 *   applicant inside the cycle lands on the house's stain — which is exactly
 *   why the willingness to sponsor is worth anything.
 * - **The judge who knows the family** — a judge's belief gains
 *   `− 0.10 × familiarity(judge, defendant's house)`, running −1 to 1, and a
 *   judge must **recuse** at |familiarity| ≥ 0.5. Below that the tie is
 *   declared in public with the judge's reason, so observers see the thumb.
 *   Declaring a bias is not the same as not having one, and `GENERATIONS.md`
 *   §9 says so out loud.
 * - **The pledge** — the head puts the entail behind a member's loan, the
 *   Bank's terms rise, and a default really does seize the property.
 *
 * Nothing here is read by a gate. Every threshold in `CITIES.md` is judged on
 * the citizen's own repute, and no relief is enlarged for a name.
 */
import { clamp } from '../types.ts';
import type { ActionResult, Citizen, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens } from '../economy/treasury.ts';
import { isPresent } from '../citizens/citizen.ts';
import { inFeud } from '../social/feuds.ts';
import type { House, HouseLetter, HousePledge } from './state.ts';
import { generationsState, nextGenerationsId, stainsOf } from './state.ts';
import { STAIN_CIVIC, houseReputeOf } from './repute.ts';
import { houseFor, houseHeaded, houseOfName } from './houses.ts';
import { houseLandValue, houseTreasury, seizeFromEntail } from './entail.ts';

/** What a letter is worth at a foreign Registry: one day of the background check. */
export const LETTER_DAYS_OFF = 1;
/** The thumb a declared familiarity puts on the scale, and the line it may not cross. */
export const FAMILIARITY_WEIGHT = 0.1;
export const RECUSAL_FAMILIARITY = 0.5;
/** The Bank's multiple, with the entail behind it, against the ordinary 5×. */
export const PLEDGED_INCOME_MULTIPLE = 8;
/** The most a pledge takes off the daily rate, reached at a house repute of 800. */
export const PLEDGE_RATE_RELIEF = 0.006;
export const PLEDGE_RELIEF_AT = 800;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

// ---------------------------------------------------------------------------
// The letter of the house
// ---------------------------------------------------------------------------

/** Letters the register holds for this citizen, the withdrawn ones dropped. */
export function lettersFor(world: World, cId: CitizenId): HouseLetter[] {
  return Object.values(generationsState(world).letters)
    .filter((l) => l.toId === cId && l.withdrawnDay === null)
    .sort((a, b) => b.day - a.day || a.id.localeCompare(b.id, 'en'));
}

/** Every letter a house has out, newest first. */
export function lettersOfHouse(world: World, h: House): HouseLetter[] {
  return Object.values(generationsState(world).letters)
    .filter((l) => l.houseId === h.id && l.withdrawnDay === null)
    .sort((a, b) => b.day - a.day || a.id.localeCompare(b.id, 'en'));
}

/**
 * Days a destination Registry's background check is shortened by, exactly as a
 * records treaty shortens it (`CITIES.md` §2). It shortens a wait and moves no
 * threshold: a citizen short of a gate's repute is short of it with a letter
 * in their hand.
 */
export function letterDaysOff(world: World, cId: CitizenId, city: string): number {
  const held = lettersFor(world, cId).some((l) => l.city === city || l.city === 'any');
  return held ? LETTER_DAYS_OFF : 0;
}

/** True when a letter of the house is admissible in this citizen's hearing or appeal. */
export function letterAdmissible(world: World, cId: CitizenId): HouseLetter | null {
  return lettersFor(world, cId)[0] ?? null;
}

/**
 * File a letter of the house. The head files it at the Exchange, it is public
 * the day it is filed, and the house's own name is what stands behind it.
 * `motions.ts` files one this way too, when the members carry a `letter`
 * motion (`GENERATIONS.md` §4).
 */
export function letterOfHouse(world: World, byId: CitizenId, toId: CitizenId, city: string, house?: House): ActionResult {
  const by = world.citizens[byId];
  if (!by) return fail('Unknown citizen.');
  const h = house ?? houseHeaded(world, byId);
  if (!h) return fail('Only the head of a house may file a letter of the house.');
  if (h.dormantDay !== null) return fail(`The house of ${h.name} is dormant.`);
  const to = world.citizens[toId];
  if (!to) return fail('Unknown citizen.');
  const where = (city ?? '').trim().slice(0, 40) || 'any';
  if (lettersFor(world, toId).some((l) => l.city === where && l.houseId === h.id)) {
    return fail(`The house of ${h.name} already has a letter out for ${to.name} at ${where}.`);
  }

  const letter: HouseLetter = {
    id: nextGenerationsId(world, 'lt'),
    houseId: h.id,
    byId,
    toId,
    city: where,
    day: world.day,
    cycle: world.government?.cycle ?? 0,
    withdrawnDay: null,
  };
  generationsState(world).letters[letter.id] = letter;
  emit(world, 'household', `${by.name} filed a letter of the house of ${h.name} for ${to.name} at ${where}: the house stands behind them.`,
    [byId, toId], 0.4, { houseId: h.id, letterId: letter.id, city: where });
  remember(world, toId, 'family', `The house of ${h.name} filed a letter for you at ${where}. It takes a day off the check and shifts no threshold.`);
  remember(world, byId, 'family', `You put the house of ${h.name} behind ${to.name} at ${where}. A conviction of theirs this cycle lands on the house.`);
  return ok(`The letter is filed at the Exchange, and it is public.`);
}

/** Withdraw a letter. The house may take its name back; what it did stands. */
export function withdrawLetter(world: World, cId: CitizenId, letterId: string): ActionResult {
  const letter = generationsState(world).letters[letterId];
  if (!letter || letter.withdrawnDay !== null) return fail('There is no such letter on file.');
  const h = houseHeaded(world, cId);
  if (!h || h.id !== letter.houseId) return fail('Only the head of the house may withdraw its letter.');
  letter.withdrawnDay = world.day;
  emit(world, 'household', `The house of ${h.name} withdrew its letter for ${world.citizens[letter.toId]?.name ?? 'a citizen'}.`,
    [cId, letter.toId], 0.3, { houseId: h.id, letterId });
  return ok('The letter is withdrawn.');
}

/**
 * A conviction of somebody the house sponsored, inside the cycle it sponsored
 * them: it lands on the house's stain exactly as a member's would. This is the
 * whole of what makes a letter cost anything to give.
 */
export function noteSponsoredConvictions(world: World): number {
  const s = generationsState(world);
  const cycle = world.government?.cycle ?? 0;
  let entered = 0;
  for (const letter of Object.values(s.letters)) {
    if (letter.cycle !== cycle) continue;
    const h = s.houses[letter.houseId];
    const applicant = world.citizens[letter.toId];
    if (!h || !applicant) continue;
    if (applicant.familyName === h.name) continue;   // a member's own conviction is already counted
    const stains = stainsOf(world, h.name);
    for (const k of applicant.record?.convictions ?? []) {
      if (k.day < letter.day) continue;
      if (stains.some((st) => st.caseId === k.caseId)) continue;
      stains.push({
        caseId: k.caseId, citizenId: applicant.id, law: k.law, day: k.day,
        base: STAIN_CIVIC, cleanDays: 0, sponsored: true,
      });
      entered++;
      emit(world, 'household', `${applicant.name}, whom the house of ${h.name} put its name behind, was convicted; the house carries it.`,
        [applicant.id], 0.4, { houseId: h.id, caseId: k.caseId });
    }
  }
  return entered;
}

// ---------------------------------------------------------------------------
// The judge who knows the family
// ---------------------------------------------------------------------------

function partnerOf(world: World, c: Citizen): Citizen | null {
  const id = c.family?.partnerId ?? null;
  return id ? world.citizens[id] ?? null : null;
}

/** True when the two names have a match settled between them. */
export function matchedHouses(world: World, a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  const s = generationsState(world);
  for (const m of Object.values(s.matches)) {
    if (m.status !== 'accepted') continue;
    const from = s.houses[m.fromHouseId]?.name;
    const to = s.houses[m.toHouseId]?.name;
    if (!from || !to) continue;
    if ((from === a && to === b) || (from === b && to === a)) return true;
  }
  return false;
}

/** True when the judge works in, employs, or trades out of one of the house's concerns. */
function inBusinessWith(world: World, judge: Citizen, name: string): boolean {
  const job = judge.jobId ? world.jobs[judge.jobId] : null;
  const employer = job ? world.businesses[job.employer] ?? null : null;
  if (employer) {
    const owner = world.citizens[employer.ownerId] ?? null;
    if (owner && owner.familyName === name) return true;
    const house = houseOfName(world, name);
    if (house && house.businesses.includes(employer.id)) return true;
  }
  const own = judge.businessId ? world.businesses[judge.businessId] ?? null : null;
  if (own) {
    for (const id of own.employees ?? []) {
      if (world.citizens[id]?.familyName === name) return true;
    }
  }
  return false;
}

/**
 * How well this judge knows the defendant's house, −1 to 1. Positive for
 * marriage into the house, a match between the houses, kinship, or a
 * partnership in one of its businesses; negative for a live feud between the
 * names. Every part of it is a public fact anybody may check.
 */
export function houseFamiliarity(world: World, judgeId: CitizenId, defendantId: CitizenId): number {
  const judge = world.citizens[judgeId];
  const defendant = world.citizens[defendantId];
  if (!judge || !defendant || judgeId === defendantId) return 0;
  const name = defendant.familyName;
  if (!name) return 0;
  let f = 0;
  if (judge.familyName === name) f += 1;
  const partner = partnerOf(world, judge);
  if (partner && partner.familyName === name) f += 0.8;
  const kin = [...(judge.family?.parents ?? []), ...(judge.family?.children ?? [])];
  if (kin.some((id) => world.citizens[id]?.familyName === name)) f += 0.6;
  if (matchedHouses(world, judge.familyName, name)) f += 0.5;
  if (inBusinessWith(world, judge, name)) f += 0.5;
  if (inFeud(world, judgeId, defendantId)) f -= 0.7;
  return clamp(f, -1, 1);
}

/** Must this judge stand down? Married into it, born to it, in business with it, in feud with it. */
export function mustRecuseForHouse(world: World, judgeId: CitizenId, defendantId: CitizenId): boolean {
  return Math.abs(houseFamiliarity(world, judgeId, defendantId)) >= RECUSAL_FAMILIARITY;
}

/** What a familiarity below the recusal line does to a judge's belief: a declared thumb. */
export function houseBeliefAdjustment(world: World, judgeId: CitizenId, defendantId: CitizenId): number {
  const f = houseFamiliarity(world, judgeId, defendantId);
  if (Math.abs(f) >= RECUSAL_FAMILIARITY) return 0;   // they should not be sitting at all
  return -FAMILIARITY_WEIGHT * f;
}

/**
 * The judge's public reason, for a tie declared rather than recused. Null when
 * the judge does not know the family at all — and the bench says nothing.
 */
export function declaredFamiliarity(world: World, judgeId: CitizenId, defendantId: CitizenId): string | null {
  const f = houseFamiliarity(world, judgeId, defendantId);
  if (f === 0) return null;
  const defendant = world.citizens[defendantId];
  const name = defendant?.familyName ?? 'the defendant';
  const how = f > 0 ? 'knows' : 'is at odds with';
  const strength = Math.abs(f) >= RECUSAL_FAMILIARITY ? 'and stands down' : `and declares it at ${f.toFixed(2)}`;
  return `${world.citizens[judgeId]?.name ?? 'The judge'} ${how} the house of ${name} ${strength}.`;
}

// ---------------------------------------------------------------------------
// The pledge
// ---------------------------------------------------------------------------

/** The live pledge behind a citizen's borrowing, or null. */
export function pledgeFor(world: World, cId: CitizenId): HousePledge | null {
  return generationsState(world).pledges.find((p) => p.borrowerId === cId && p.seizedDay === null) ?? null;
}

export function pledgeOnLoan(world: World, loanId: string): HousePledge | null {
  return generationsState(world).pledges.find((p) => p.loanId === loanId && p.seizedDay === null) ?? null;
}

/**
 * Put the entail behind a member's loan. Only the head may pledge the house,
 * the borrower must be of it, and the entail must actually hold something —
 * a pledge that could not be seized would be a promise, not collateral.
 */
export function pledgeHouse(world: World, cId: CitizenId, loanId: string): ActionResult {
  const h = houseHeaded(world, cId);
  if (!h) return fail('Only the head of a house may pledge it.');
  if (h.dormantDay !== null) return fail(`The house of ${h.name} is dormant.`);
  const loan = world.loans?.[loanId];
  if (!loan) return fail('There is no such loan.');
  const borrower = world.citizens[loan.borrowerId];
  if (!borrower || !isPresent(world, borrower)) return fail('Unknown borrower.');
  if (borrower.familyName !== h.name) return fail(`${borrower.name} is not of the ${h.name}s.`);
  if (pledgeOnLoan(world, loanId)) return fail('That loan already has the house behind it.');
  if (houseLandValue(world, h) + houseTreasury(world, h) <= 0) {
    return fail(`The house of ${h.name} holds nothing a default could seize.`);
  }

  const pledge: HousePledge = {
    houseId: h.id, loanId, borrowerId: loan.borrowerId, pledgedBy: cId, day: world.day,
    seizedDay: null, seizedUnitId: null,
  };
  generationsState(world).pledges.push(pledge);
  emit(world, 'loan', `The house of ${h.name} pledged its entail behind ${borrower.name}'s loan of ${formatLumens(loan.outstanding)}.`,
    [cId, borrower.id], 0.5, { houseId: h.id, loanId, borrowerId: borrower.id });
  remember(world, borrower.id, 'money', `The house of ${h.name} stands behind your loan. A default seizes the house's property, not only yours.`);
  return ok(`The entail of the ${h.name}s stands behind that loan.`);
}

/**
 * The multiple of average daily income the Bank will lend against, for the
 * wiring pass to read where `economy/bank.creditLimit` reads its own: 8× with
 * the entail behind it, 5× without. **This is the only place a house moves a
 * number the citizen did not earn, and it is collateral, not standing.**
 */
export function pledgedIncomeMultiple(world: World, cId: CitizenId): number | null {
  return pledgeFor(world, cId) ? PLEDGED_INCOME_MULTIPLE : null;
}

/** What a pledge takes off the daily rate: up to 0.6 %, reached at a house repute of 800. */
export function pledgedRateRelief(world: World, cId: CitizenId): number {
  const pledge = pledgeFor(world, cId);
  if (!pledge) return 0;
  const h = generationsState(world).houses[pledge.houseId];
  if (!h) return 0;
  const repute = houseReputeOf(world, h.name);
  const reach = clamp((repute - 500) / (PLEDGE_RELIEF_AT - 500), 0, 1);
  return Math.round(PLEDGE_RATE_RELIEF * reach * 10000) / 10000;
}

/**
 * A default seizes what the house pledged, at its land value. Called from the
 * daily pass: the Bank has already written the loan off as defaulted, and the
 * house that stood behind it pays what the borrower did not.
 */
export function callPledges(world: World): number {
  let seized = 0;
  const s = generationsState(world);
  for (const pledge of s.pledges) {
    if (pledge.seizedDay !== null) continue;
    const loan = world.loans?.[pledge.loanId];
    const h = s.houses[pledge.houseId];
    if (!h) { pledge.seizedDay = world.day; continue; }
    if (!loan) { pledge.seizedDay = world.day; continue; }   // settled, and the pledge with it
    if (!loan.defaulted) continue;
    const owed = Math.max(0, Math.round(loan.outstanding));
    if (owed <= 0) { pledge.seizedDay = world.day; continue; }
    const { paid, unitId } = seizeFromEntail(world, h, owed, `the house of ${h.name} answered ${world.citizens[pledge.borrowerId]?.name ?? 'a member'}'s default`);
    pledge.seizedDay = world.day;
    pledge.seizedUnitId = unitId;
    if (paid <= 0) continue;
    seized += paid;
    loan.outstanding = Math.max(0, owed - paid);
    if (loan.outstanding === 0) loan.defaulted = false;
    emit(world, 'loan', `The house of ${h.name} paid ${formatLumens(paid)} of ${world.citizens[pledge.borrowerId]?.name ?? 'a member'}'s defaulted loan out of the entail.`,
      [pledge.borrowerId, pledge.pledgedBy], 0.6, { houseId: h.id, loanId: pledge.loanId, paid, unitId });
    for (const id of [pledge.borrowerId, pledge.pledgedBy]) {
      remember(world, id, 'money', `The entail of the ${h.name}s answered for ${formatLumens(paid)} of a defaulted loan.`);
    }
  }
  return seized;
}

// ---------------------------------------------------------------------------
// What a name is worth at a ballot box
// ---------------------------------------------------------------------------

/**
 * The most a name is worth to a reflex voter, in points of reputation: ten,
 * either way — one good deed (`GENERATIONS.md` §2). **Nothing hands a
 * candidate visibility for a surname.** What a name gives a candidate is
 * relatives with lumens, and a house treasury that may fund their campaign
 * spend by a motion of the members; this term is only the voter's own reading
 * of a public number, and it is small on purpose.
 */
export const HOUSE_VOTE_REPUTATION = 10;

/** What a candidate's house is worth to this voter, in reputation points, −10..10. */
export function houseVoteBonus(world: World, voterId: CitizenId, candidateId: CitizenId): number {
  const candidate = world.citizens[candidateId];
  if (!candidate || !candidate.familyName || voterId === candidateId) return 0;
  const repute = houseReputeOf(world, candidate.familyName);
  const reach = clamp((repute - 500) / 500, -1, 1);
  return Math.round(reach * HOUSE_VOTE_REPUTATION * 10) / 10;
}

/**
 * The same term where `government/council.voterPreference` adds it: that score
 * counts reputation at a two-hundredth of a point, so ten points of reputation
 * is 0.05 of a score — one good deed, and never the difference a great name
 * would like it to be.
 */
export function houseVoteScore(world: World, voterId: CitizenId, candidateId: CitizenId): number {
  return houseVoteBonus(world, voterId, candidateId) / 200;
}

/** The house a citizen's borrowing has behind it, for the observation. */
export function pledgedHouse(world: World, cId: CitizenId): House | null {
  const pledge = pledgeFor(world, cId);
  if (pledge) return generationsState(world).houses[pledge.houseId] ?? null;
  return houseFor(world, cId);
}
