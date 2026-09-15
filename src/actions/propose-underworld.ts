/**
 * The underworld's four questions, put to the Council through the same verb
 * everything else is (`docs/UNDERWORLD.md` §7, `REGISTRY.md` §3):
 * `restrict_good`, `amnesty`, `customs_posts` and `spy_disposition`.
 *
 * A `Proposal` carries one number, one law code and one citizen. A schedule
 * entry is a list of goods and a direction, so — exactly as a zoning question
 * does in `environment/state.ts` — the question itself is filed beside the roll
 * of votes in `underworld/state.ts`, under the proposal's own id. The Council
 * votes on the proposal; `government/council.ts enactProposal` then hands the
 * id back to the layer that knows what it meant.
 *
 * Nothing here decides anything: it writes down what a citizen asked the
 * Council for, and the Council answers it at its own hour.
 */
import type { ActionResult, CitizenId, Good, ProposalKind, World } from '../types.ts';
import { DISPOSITIONS, HOME_CITY, tableUnderworldQuestion } from '../underworld/index.ts';
import type { Restriction, RestrictionSeverity } from '../underworld/index.ts';
import { tableProposal } from '../government/council.ts';

/** The four kinds this file owns. */
export type UnderworldProposalKind = 'restrict_good' | 'amnesty' | 'customs_posts' | 'spy_disposition';

export const UNDERWORLD_PROPOSAL_KINDS: readonly UnderworldProposalKind[] = [
  'restrict_good', 'amnesty', 'customs_posts', 'spy_disposition',
];

export interface UnderworldProposalSpec {
  kind: UnderworldProposalKind;
  value: number;
  summary: string;
  /** The Bazaar good a `restrict_good` names, where it names one. */
  good?: Good | null;
  /** The agent a `spy_disposition` is about. */
  targetId?: CitizenId;
  /** The id of a live restriction a `restrict_good` would strike out instead. */
  subject?: string;
}

function fail(message: string): ActionResult { return { ok: false, message }; }

/** The entry a carried `restrict_good` would write, from what the proposal names. */
function restrictionFrom(good: Good, severity: RestrictionSeverity): Restriction {
  return {
    id: `sched_${good}`, city: HOME_CITY, subject: `${good} crossing either gate`,
    direction: 'either', severity, goods: [good], products: [], categories: [],
    licensed: false, needsCertificate: false, masterGradeOnly: false, money: false,
    minValue: 0, undeclaredOnly: false, sinceDay: 0, proposalId: null, liftedDay: null,
  };
}

/**
 * Table one of the four, and file the question beside it. The proposal is an
 * ordinary one in every other respect: a councillor tables it, anybody else
 * petitions, and it is read at the next session.
 */
export function tableUnderworldProposal(world: World, proposerId: CitizenId, spec: UnderworldProposalSpec): ActionResult {
  const severity = Math.min(3, Math.max(1, Math.round(spec.value || 1))) as RestrictionSeverity;
  if (spec.kind === 'restrict_good' && !spec.good && !spec.subject) {
    return fail('A schedule measure names the good it would restrict, or the entry it would strike out.');
  }
  if (spec.kind === 'spy_disposition' && !spec.targetId) {
    return fail('A disposition names the agent it is about.');
  }
  const before = world.government.proposals.length;
  const result = tableProposal(world, proposerId, {
    kind: spec.kind as ProposalKind,
    value: spec.kind === 'restrict_good' ? severity : Math.max(0, Math.round(spec.value)),
    summary: spec.summary,
    ...(spec.kind === 'spy_disposition' && spec.targetId ? { targetId: spec.targetId } : {}),
  });
  if (!result.ok) return result;
  const p = world.government.proposals[world.government.proposals.length - 1];
  if (!p || world.government.proposals.length === before) return result;

  tableUnderworldQuestion(world, {
    proposalId: p.id,
    kind: spec.kind,
    city: HOME_CITY,
    restriction: spec.kind === 'restrict_good' && spec.good ? restrictionFrom(spec.good, severity) : null,
    liftId: spec.kind === 'restrict_good' && !spec.good ? spec.subject ?? null : null,
    value: spec.kind === 'spy_disposition'
      ? Math.min(DISPOSITIONS.length - 1, Math.max(0, Math.round(spec.value)))
      : Math.max(0, Math.round(spec.value)),
    targetId: spec.targetId ?? null,
  });
  return result;
}
