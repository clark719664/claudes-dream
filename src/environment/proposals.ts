/**
 * The measures this layer puts before the Council (`docs/ENVIRONMENT.md` §9):
 * `zone`, `conserve`, `emission_charge`, `host_payment`, `abatement_works`,
 * `relocate_works` and the buy-out of §4.
 *
 * A `Proposal` carries one number, one law code and one citizen, and a zoning
 * question is a district and a permit — so the question itself is kept beside
 * the roll of votes, in the register, under the proposal's own id. Everything
 * else about it is an ordinary proposal: it is tabled, it is voted on in
 * public, it passes on a simple majority, and **undoing a conservation needs
 * four of five, like a pardon** — the one entrenchment here, and the only
 * reason a park survives a Council that wants a forge.
 */
import { clamp } from '../types.ts';
import type { ActionResult, BuildingId, CitizenId, DistrictId, Proposal, ProposalKind, World } from '../types.ts';
import { BUILDINGS } from '../data/city.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { districtName, fail, isDetained, isPresent, ok } from '../actions/common.ts';
import { isOpen } from '../world/growth.ts';
import {
  ENVIRONMENT_PROPOSAL_KINDS, HOST_SHARE_MAX, districtEnvironment, environmentState, permitOf,
} from './state.ts';
import type { EnvironmentProposalKind, EnvironmentQuestion, Fitting, Permit } from './state.ts';
import { buyOutBuilding, isConserved, readPermit, relocateWorks, setPermit } from './zoning.ts';
import { installFromPublicWorks } from './abatement.ts';
import { settleZoningInterests } from './interests.ts';

/** Four of five: the charter threshold, and what undoing a conservation asks. */
export const ENTRENCHED_MAJORITY = 4;
/** An ordinary measure passes on three. */
export const ORDINARY_MAJORITY = 3;

/** The most the Council may charge for a mote a day. */
export const CHARGE_MAX = 20;

export interface EnvironmentProposalSpec {
  kind: EnvironmentProposalKind;
  district?: DistrictId;
  permit?: Permit;
  building?: BuildingId;
  fitting?: Fitting;
  value?: number;
  summary?: string;
  /** Tabled by the district rather than by a councillor (`ENVIRONMENT.md` §6). */
  petition?: boolean;
}

function isCouncillor(world: World, cId: CitizenId): boolean {
  const g = world.government;
  return g.mayorId === cId || g.council.includes(cId);
}

function buildingName(world: World, id: BuildingId): string {
  return world.buildings[id]?.name ?? BUILDINGS[id]?.name ?? id;
}

/** The line the Chronicle prints when nobody wrote one. */
export function describeMeasure(world: World, spec: EnvironmentProposalSpec): string {
  const where = spec.district ? districtName(world, spec.district) : 'the city';
  switch (spec.kind) {
    case 'zone': return `Zone ${where} ${String(spec.permit).replace(/_/g, ' ')}`;
    case 'conserve': return `Conserve ${where}: nothing new to be built in it`;
    case 'emission_charge': return `Charge ${Math.round((spec.value ?? 0) * 100) / 100} ℓ a mote a day for what the city's shifts emit`;
    case 'host_payment': return `Pay ${where} ${Math.round((spec.value ?? 0) * 100)}% of what is raised inside it, to its residents`;
    case 'abatement_works': return `Fit a ${spec.fitting} at ${buildingName(world, spec.building ?? '')} out of public works`;
    case 'relocate_works': return `Move ${buildingName(world, spec.building ?? '')} to a hinterland site`;
    case 'buy_out': return `Buy out ${buildingName(world, spec.building ?? '')}, which stands nonconforming`;
    default: return 'An environment measure';
  }
}

/** What a measure needs to pass: three, or four where it would undo a conservation. */
export function neededFor(world: World, spec: EnvironmentProposalSpec): number {
  if (spec.kind !== 'zone' || !spec.district) return ORDINARY_MAJORITY;
  return isConserved(world, spec.district) ? ENTRENCHED_MAJORITY : ORDINARY_MAJORITY;
}

/** Why this measure cannot be tabled, if it cannot. */
export function checkMeasure(world: World, spec: EnvironmentProposalSpec): string | null {
  if (!ENVIRONMENT_PROPOSAL_KINDS.includes(spec.kind)) return 'There is no such kind of measure.';
  const needsDistrict = spec.kind === 'zone' || spec.kind === 'conserve' || spec.kind === 'host_payment';
  if (needsDistrict) {
    if (!spec.district || !isOpen(world, spec.district)) return 'That measure must name a district the city has opened.';
  }
  if (spec.kind === 'zone') {
    const permit = readPermit(spec.permit);
    if (!permit) return 'A zoning measure must name a permit.';
    if (permit === permitOf(world, spec.district as DistrictId)) {
      return `${districtName(world, spec.district as DistrictId)} is already zoned ${permit.replace(/_/g, ' ')}.`;
    }
  }
  if (spec.kind === 'conserve' && isConserved(world, spec.district as DistrictId)) {
    return `${districtName(world, spec.district as DistrictId)} is already conserved.`;
  }
  const needsBuilding = spec.kind === 'abatement_works' || spec.kind === 'relocate_works' || spec.kind === 'buy_out';
  if (needsBuilding && !(spec.building && (world.buildings[spec.building] ?? BUILDINGS[spec.building]))) {
    return 'That measure must name a building.';
  }
  if (spec.kind === 'abatement_works' && !spec.fitting) return 'A works measure must name a fitting.';
  if (spec.kind === 'emission_charge') {
    const value = spec.value ?? 0;
    if (!Number.isFinite(value) || value < 0 || value > CHARGE_MAX) return `An emission charge is between 0 and ${CHARGE_MAX} ℓ a mote.`;
  }
  if (spec.kind === 'host_payment') {
    const value = spec.value ?? 0;
    if (!Number.isFinite(value) || value < 0 || value > HOST_SHARE_MAX) return `A host payment is between 0 and ${HOST_SHARE_MAX * 100}%.`;
  }
  return null;
}

/**
 * Table one. Councillors table; anybody else petitions, exactly as
 * `government/council.ts` has it — and the question itself is filed beside the
 * proposal so the register and the roll always read together.
 *
 * (When `types.ts` learns these kinds this becomes a call to
 * `council.tableProposal`; the register entry stays either way.)
 */
export function tableEnvironmentProposal(
  world: World, proposerId: CitizenId, spec: EnvironmentProposalSpec,
): ActionResult {
  return tableEnvironmentMeasure(world, proposerId, spec).result;
}

/** The same, for a caller that needs the proposal itself (`petitions.ts`). */
export function tableEnvironmentMeasure(
  world: World, proposerId: CitizenId, spec: EnvironmentProposalSpec,
): { proposal: Proposal | null; result: ActionResult } {
  const refuse = (message: string): { proposal: null; result: ActionResult } => ({ proposal: null, result: fail(message) });
  const c = world.citizens[proposerId];
  if (!c) return refuse('Unknown citizen.');
  if (c.standing !== 'good' && c.standing !== 'probation') return refuse(`You cannot petition the Council while ${c.standing}.`);
  if (!isPresent(world, c)) return refuse('You are not in the city.');
  if (isDetained(world, c)) return refuse('You cannot petition the Council while detained.');
  const problem = checkMeasure(world, spec);
  if (problem) return refuse(problem);
  if (world.government.proposals.some((p) => p.status === 'open' && p.proposerId === proposerId)) {
    return refuse('You already have a proposal before the Council; wait for the next session.');
  }
  const councillor = isCouncillor(world, proposerId);
  const petition = spec.petition ?? !councillor;
  const summary = (spec.summary ?? describeMeasure(world, spec)).trim().slice(0, 280);
  const p: Proposal = {
    id: nextId(world, 'p'),
    kind: spec.kind as unknown as ProposalKind,
    value: Number.isFinite(spec.value) ? (spec.value as number) : 0,
    lawCode: null,
    targetId: null,
    summary,
    proposerId,
    petition,
    tabledDay: world.day,
    status: 'open',
    votes: councillor && !petition ? { [proposerId]: true } : {},
    decidedDay: null,
    needed: neededFor(world, spec),
  };
  world.government.proposals.push(p);
  const question: EnvironmentQuestion = {
    proposalId: p.id, kind: spec.kind,
    district: spec.district ?? null,
    permit: spec.kind === 'conserve' ? 'conserved' : readPermit(spec.permit),
    building: spec.building ?? null,
    fitting: spec.fitting ?? null,
    value: p.value,
    tabledDay: world.day,
    petition,
    settledDay: null,
  };
  environmentState(world).zoning[p.id] = question;
  emit(world, 'proposal',
    councillor && !petition ? `Councillor ${c.name} tabled a proposal: ${summary}` : `${c.name} petitioned the Council: ${summary}`,
    [proposerId], 0.4, { proposalId: p.id, kind: p.kind, value: p.value, petition, district: question.district });
  remember(world, proposerId, 'civic',
    `You ${petition ? 'petitioned the Council' : 'tabled proposal'} ${p.id}: ${summary}. It needs ${p.needed} ayes.`);
  return {
    proposal: p,
    result: ok(`Proposal ${p.id} is before the Council; it needs ${p.needed} ayes at the next session.`),
  };
}

/** The question a proposal is asking, where it is one of this layer's. */
export function environmentQuestionOf(world: World, proposalId: string): EnvironmentQuestion | null {
  return environmentState(world).zoning[proposalId] ?? null;
}

/** True where a proposal is one of this layer's. */
export function isEnvironmentProposal(world: World, p: { id: string; kind: string }): boolean {
  return ENVIRONMENT_PROPOSAL_KINDS.includes(p.kind as EnvironmentProposalKind)
    || environmentQuestionOf(world, p.id) !== null;
}

/**
 * A passed measure, applied. Called from `government/council.ts enactProposal`
 * for the kinds above, and by `politics/referendums.ts` through the same door
 * when the city carries one over the Council's head.
 */
export function enactEnvironmentProposal(world: World, p: Proposal): ActionResult {
  const q = environmentQuestionOf(world, p.id);
  const kind = (q?.kind ?? p.kind) as EnvironmentProposalKind;
  switch (kind) {
    case 'zone': case 'conserve': {
      const d = q?.district;
      const permit = kind === 'conserve' ? 'conserved' as Permit : q?.permit ?? null;
      if (!d || !permit) return fail('The measure named no district, and nothing changed.');
      const was = permitOf(world, d);
      setPermit(world, d, permit, p.summary);
      settleZoningInterests(world, p, d, was, permit);
      if (q) q.settledDay = world.day;
      return ok(`${districtName(world, d)} is zoned ${permit.replace(/_/g, ' ')}.`);
    }
    case 'emission_charge': {
      const rate = clamp(Number.isFinite(p.value) ? p.value : 0, 0, CHARGE_MAX);
      environmentState(world).charge = rate;
      return ok(rate > 0
        ? `The city charges ${Math.round(rate * 100) / 100} ℓ a mote a day for what its shifts emit.`
        : 'The emission charge is lifted; the city charges nothing for what its shifts emit.');
    }
    case 'host_payment': {
      const d = q?.district;
      if (!d) return fail('The measure named no district, and nothing changed.');
      const share = clamp(Number.isFinite(p.value) ? p.value : 0, 0, HOST_SHARE_MAX);
      districtEnvironment(world, d).hostShare = share;
      return ok(`${districtName(world, d)} takes ${Math.round(share * 100)}% of what is raised inside it, paid daily to its residents.`);
    }
    case 'abatement_works': {
      if (!q?.building || !q.fitting) return fail('The works named no building, and nothing was fitted.');
      return installFromPublicWorks(world, q.building, q.fitting);
    }
    case 'relocate_works': {
      if (!q?.building) return fail('The works named no building, and nothing moved.');
      const r = relocateWorks(world, q.building);
      return r.ok ? ok(r.message) : fail(r.message);
    }
    case 'buy_out': {
      if (!q?.building) return fail('The measure named no building, and nothing was bought.');
      const r = buyOutBuilding(world, q.building);
      return r.ok ? ok(r.message) : fail(r.message);
    }
    default:
      return fail('That is not an environment measure.');
  }
}
