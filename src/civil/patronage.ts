/**
 * Patronage — what a fortune can buy (`docs/CIVIL.md` §8).
 *
 * A fortune cannot buy repute (`CITIZENSHIP.md` §1) or a shorter sentence
 * (`JUSTICE.md` §2). This is what it can: a daily stipend from the patron's
 * wallet to a named artist, performer, researcher, journalist or club, filed as
 * a contract like any other and paid at the morning rollover.
 *
 * - While it runs, the recipient's `create_work`, `perform`, `publish` and
 *   `study` count as a worked shift for the purpose need — they can make things
 *   instead of holding a job.
 * - **Every work created during the term carries the patron's name forever**:
 *   in the Chronicle's review, on the Museum's label, in the Hall of Records, in
 *   the creator's biography, long after both of them are gone.
 * - When a patronised work reaches the Museum the patron takes 10 of repute
 *   contribution against the creator's 20.
 * - Stopping payment inside the term is a breach, and the Exchange's record
 *   makes it the easiest suit in the city to win.
 *
 * `subject` is **a request and never an instruction.** No citizen is told what
 * to make (`PRINCIPLES.md` §2); a patron whose subject is ignored may serve
 * notice, and the Chronicle prints that too — for most patrons a worse outcome
 * than the work they did not want.
 */
import type { ActionType, CitizenId, ClubId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens, transfer } from '../economy/treasury.ts';
import type { Contract } from './shapes.ts';
import { civilKind } from './shapes.ts';
import { civilState } from './state.ts';
import type { CivilResult } from './common.ts';
import { fail, nameOf } from './common.ts';
import { acceptContract, offerContract } from './contracts.ts';
import { activeContractsOf, allContracts, contractById, currentPeriod, isPerformed, periodDueDay } from './terms.ts';

/** What a patron takes of a patronised work that reaches the Museum, against the creator's 20. */
export const PATRON_MUSEUM_CONTRIBUTION = 10;
export const CREATOR_MUSEUM_CONTRIBUTION = 20;

/** The acts a stipend pays for, in place of a shift. */
export const PATRONISED_ACTIONS: readonly ActionType[] = ['create_work', 'perform', 'publish', 'study'];

/** Fund a citizen or a club. `terminate_contract` ends it on notice. */
export function offerPatronage(
  world: World, patronId: CitizenId, spec: { to: CitizenId; perDay: number; days: number; subject?: string; clubId?: ClubId },
): CivilResult {
  const club = spec.clubId ? world.clubs[spec.clubId] : null;
  if (spec.clubId && !club) return fail('There is no such club.');
  // A club has no purse of its own; its convenor takes the stipend in its name.
  const to = club ? club.convenorId : spec.to;
  if (!to) return fail('There is nobody to pay.');
  return offerContract(world, patronId, {
    to,
    kind: 'patronage',
    terms: club
      ? `a stipend to ${club.name}, taken by its convenor${spec.subject ? `; the patron asks for ${spec.subject}` : ''}`
      : `a daily stipend${spec.subject ? `; the patron asks for ${spec.subject}` : ''}`,
    consideration: spec.perDay,
    days: spec.days,
    penalty: 0,
    notice: 0,
    subject: spec.subject,
    clubId: spec.clubId,
  });
}

/** Take it. The same act as `accept_contract`, and it pays the same filing fee. */
export function acceptPatronage(world: World, actorId: CitizenId, offerId: string): CivilResult {
  const k = contractById(world, offerId);
  if (!k) return fail('There is no such offer.');
  if (k.kind !== 'patronage') return fail(`${k.id} is a ${k.kind} instrument, not patronage.`);
  const r = acceptContract(world, actorId, offerId);
  if (r.ok) {
    remember(world, actorId, 'money', `${nameOf(world, k.offerorId)} is your patron for ${k.days} days at ${k.consideration} ℓ a day. `
      + `${k.subject ? `They ask for ${k.subject} — a request, and never an instruction. ` : ''}`
      + 'Every work you make while it runs carries their name forever.');
  }
  return r;
}

/** The patronage running over this citizen today, if one is. */
export function patronageOf(world: World, cId: CitizenId): Contract | null {
  return activeContractsOf(world, cId).find((k) => k.kind === 'patronage' && k.offereeId === cId) ?? null;
}

/** Everyone this patron is funding today. */
export function patronageBy(world: World, patronId: CitizenId): Contract[] {
  return activeContractsOf(world, patronId).filter((k) => k.kind === 'patronage' && k.offerorId === patronId);
}

/**
 * While it runs, making things counts as a worked shift for the purpose need:
 * a patronised citizen can make things instead of holding a job.
 */
export function countsAsShift(world: World, cId: CitizenId, action: ActionType): boolean {
  return PATRONISED_ACTIONS.includes(action) && patronageOf(world, cId) !== null;
}

/**
 * Stamp a work with its patron's name. Called when the work is made; the stamp
 * is permanent and is never removed, whatever happens to either of them
 * afterwards.
 */
export function recordPatronisedWork(world: World, workId: string, creatorId: CitizenId): CitizenId | null {
  const k = patronageOf(world, creatorId);
  if (!k) return null;
  const s = civilState(world);
  if (s.patronOfWork[workId]) return s.patronOfWork[workId];
  s.patronOfWork[workId] = k.offerorId;
  emit(world, 'work', `${nameOf(world, creatorId)}'s new work was made under ${nameOf(world, k.offerorId)}'s patronage, `
    + 'and carries their name forever.', [creatorId, k.offerorId], 0.3, { work: workId, patron: k.offerorId });
  return k.offerorId;
}

/** Whose name a work carries besides its maker's, forever. */
export function patronOfWork(world: World, workId: string): CitizenId | null {
  return civilState(world).patronOfWork[workId] ?? null;
}

/** Every work this patron's money stands behind. */
export function worksPatronisedBy(world: World, patronId: CitizenId): string[] {
  const s = civilState(world);
  return Object.keys(s.patronOfWork).filter((id) => s.patronOfWork[id] === patronId);
}

/** How the Museum's label reads. */
export function museumLabel(world: World, workId: string): string {
  const patron = patronOfWork(world, workId);
  return patron ? `under the patronage of ${nameOf(world, patron)}` : '';
}

/**
 * The morning's stipends. A patron who cannot pay has not paid, the period goes
 * undischarged, and `amend.ts` marks the breach tomorrow — which is the easiest
 * suit in the city to win, and still nobody's obligation to bring.
 */
export function payPatronage(world: World): number {
  let paid = 0;
  for (const k of allContracts(world)) {
    if (k.status !== 'active' || k.kind !== 'patronage' || k.startDay === null) continue;
    const period = currentPeriod(world, k);
    if (isPerformed(k, period) || world.day < periodDueDay(k, period)) continue;
    const amount = k.consideration;
    if (!transfer(world, k.offerorParty, k.offereeParty, amount, civilKind('patronage'), `patronage under ${k.id}`)) {
      remember(world, k.offerorId, 'money', `You could not pay today's ${amount} ℓ stipend under ${k.id}. `
        + 'Stopping payment inside the term is a breach, and the record shows it.');
      continue;
    }
    k.performances.push({ period, day: world.day, tick: world.tick, byId: k.offerorId, note: `a stipend of ${amount} ℓ` });
    paid += amount;
    if (period === 0) {
      emit(world, 'donation', `${nameOf(world, k.offerorId)} began paying ${nameOf(world, k.offereeId)} `
        + `${formatLumens(amount)} a day for ${k.days} days${k.subject ? `, asking for ${k.subject}` : ''}.`,
        [k.offerorId, k.offereeId], 0.4, { contract: k.id, perDay: amount, days: k.days });
    }
  }
  return paid;
}
