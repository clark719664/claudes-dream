/**
 * What a term leaves a citizen, as actions (`docs/JUSTICE.md` §2).
 *
 * Track II is answered in days, and a day in custody is still a day a citizen
 * spends: this file holds the two pieces of that the dispatcher needs — the
 * list of what somebody serving a term may actually do this hour, and the plea
 * a defendant may still enter while a charge waits for a bench.
 *
 * The list is the Charter's own and nothing here adds to it. What it does is
 * narrow it to what the engine would actually carry out, so a prisoner is
 * never offered a lesson the Academy cannot give or a parole the Court will not
 * hear yet. Everything the term takes — work, trade, the ballot, the office and
 * any act against another person — is simply absent, and `standingAllows`
 * refuses it in `government/registry.ts` whoever asks.
 */
import type { Action, ActionResult, ActionType, CaseId, Citizen, World } from '../types.ts';
import { ACADEMY_TUITION } from '../data/jobs.ts';
import { CUSTODY_ACTIONS, pleadGuilty, pleadedGuilty, workedInCustodyToday } from '../government/jail.ts';
import { paroleProblem } from '../government/parole.ts';
import { canAppeal, pendingCasesFor } from '../government/court.ts';
import { teacherOnStaff } from './daily.ts';
import { fail } from './common.ts';

/** Charges still waiting for a bench that this citizen has not yet admitted. */
export function admissibleCharges(world: World, c: Citizen): Action[] {
  return pendingCasesFor(world, c.id)
    .filter((k) => k.status === 'pending' && !pleadedGuilty(world, k.id))
    .map((k) => ({ type: 'plead_guilty', caseId: k.id }));
}

/**
 * What a citizen serving a custodial term may do this hour. The notebook and
 * the diary always; a letter while there is anybody to write to; the appeal
 * inside its window; a plea while a charge is still waiting for a bench;
 * parole once half the term is served; a shift in custody once a day; a lesson
 * while the Academy has a teacher and the tuition is in the wallet; and a
 * story, if they are a journalist.
 *
 * Custody takes the day. It does not take the voice, the notebook, the letter
 * home or the right to ask the Council to look again.
 */
export function custodyActionsFor(
  world: World, c: Citizen,
  ctx: { notebook: ActionType[]; anyoneElse: boolean; journalist: boolean },
): ActionType[] {
  const set = new Set<ActionType>(['idle', 'write_diary', ...ctx.notebook]);
  if (ctx.anyoneElse) set.add('message');
  if (canAppeal(world, c.id)) set.add('appeal');
  if (!workedInCustodyToday(world, c.id)) set.add('work_custody');
  if (paroleProblem(world, c.id) === null) set.add('request_parole');
  if (admissibleCharges(world, c).length > 0) set.add('plead_guilty');
  if (teacherOnStaff(world) && (world.buildings.academy?.damage ?? 0) < 1 && c.wallet >= ACADEMY_TUITION) {
    set.add('study');
  }
  if (ctx.journalist) set.add('publish');
  return CUSTODY_ACTIONS.filter((a) => set.has(a));
}

/**
 * Admit a charge. Named or not: with no `caseId` the oldest charge still
 * waiting for a bench is the one admitted, because that is the one a plea in
 * time can still be entered on. A plea is worth a fifth off a custodial term
 * and goes on the record on either track.
 */
export function doPleadGuilty(world: World, c: Citizen, caseId?: CaseId): ActionResult {
  if (caseId) {
    const k = world.cases[caseId];
    if (!k) return fail('There is no such case.');
    return pleadGuilty(world, c.id, caseId, k.status !== 'pending');
  }
  const waiting = admissibleCharges(world, c);
  if (waiting.length === 0) return fail('You have no charge waiting for a bench to admit.');
  return pleadGuilty(world, c.id, (waiting[0] as { caseId: CaseId }).caseId);
}
