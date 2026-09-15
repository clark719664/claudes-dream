/**
 * Conscience: a stated refusal, a public record of it, and a Court that has to
 * decide (`docs/CREEDS.md` §4).
 *
 * **A tenet is never a defence and never an offence.** Nothing in this file
 * excuses anybody from anything, alters a verdict, or changes what the
 * evidence in a case is worth. What it adds is one action — `refuse { duty,
 * ground }` — over five duties, and the machinery for the two of them that
 * reach a bench, because those are the two that cost somebody else something.
 *
 * | Duty | The law | What happens |
 * | --- | --- | --- |
 * | `jury` | Charter III.3 | accepted: another juror by lot. Refused: contempt, L10 |
 * | `witness` | Charter III.4 | accepted: nothing. Refused: L31. Either way the charge goes on thinner evidence |
 * | `work` | no law at all | your employer may fire you; you lose the wage |
 * | `office` | no law | the seat goes to the next name, and the Court can be left short |
 * | `oath` | no law | a citizen who will not swear is not seated |
 *
 * A creed that will not inform makes the Watch's evidence thinner, and thin
 * evidence is how a guilty citizen walks. **The victim pays for the tenet**,
 * and the accommodation figure a bench moves does not make that smaller.
 *
 * The one deviation from the written formula is a per-judge term of
 * `normal() × 0.05`: every other bench in Reverie reaches its own view rather
 * than one arithmetic answer three times over (`government/court.ts
 * judgeBelief`, `government/jury.ts jurorBelief`), and without it "a majority
 * carries" would never mean anything.
 */
import { clamp } from '../types.ts';
import type { ActionResult, Case, CaseId, Citizen, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { normal, shuffle } from '../util/rng.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { fileCharge } from '../government/court.ts';
import { eligibleJurors, juryOf, needsJury } from '../government/jury.ts';
import type { RefusableDuty, Refusal } from './shapes.ts';
import {
  ACCEPT_THRESHOLD, ACCOMMODATION_STEP, CONTEMPT, CREED_LAWS, CYCLE_DAYS, MAX_TENET_TEXT,
  OLD_CREED_CYCLES, QUESTIONS, REFUSABLE_DUTIES, creedLaw,
} from './shapes.ts';
import {
  accommodationOf, creedFor, creedId, creedState, hasExemption, livingMembers, memberOf, moveAccommodation,
} from './state.ts';
import { bindingTenet, observeAct } from './observance.ts';

/** What one witness's account is worth to a charge, and what refusing takes off it. */
export const WITNESS_EVIDENCE = 0.2;
/** A bench never reads a case below this: a charge with nothing behind it is still a charge. */
export const EVIDENCE_FLOOR = 0.05;
/** Jurors a case wants; a bench that cannot fill it is a case that cannot be heard. */
export const JURY_WANTED = 5;
/** Every judge's own reading of the same public facts (`government/court.ts`). */
export const JUDGE_NOISE = 0.05;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/** The duties a bench ever hears: the two that cost somebody else something. */
export function reachesACourt(duty: RefusableDuty): boolean {
  return duty === 'jury' || duty === 'witness';
}

/** The question a creed's position on this duty is stated under, if any. */
export function questionForDuty(duty: RefusableDuty): 'informing' | 'judgement' | 'work_and_rest' | null {
  if (duty === 'witness') return 'informing';
  if (duty === 'jury' || duty === 'office') return 'judgement';
  if (duty === 'work') return 'work_and_rest';
  return null;
}

// ---------------------------------------------------------------------------
// Refusing
// ---------------------------------------------------------------------------

export interface RefuseOptions {
  /** The case the refusal is made in, for `jury` and `witness`. */
  caseId?: CaseId;
}

/**
 * `refuse { duty, ground }` — a conscientious refusal. It is allowed to
 * anybody, creed or none: what a creed adds is a public position the bench can
 * weigh, not the right to refuse. A refusal without one is heard on its own
 * merits and starts from the same sceptical floor.
 */
export function refuse(
  world: World, cId: CitizenId, duty: RefusableDuty, ground: string, opts: RefuseOptions = {},
): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (c.standing === 'exiled') return fail('You are outside the Gate.');
  if (!REFUSABLE_DUTIES.includes(duty)) return fail(`${String(duty)} is not a duty anybody is called to.`);
  const words = (ground ?? '').trim().slice(0, MAX_TENET_TEXT);
  if (!words) return fail('A refusal is stated with its ground, in public.');

  const k = creedFor(world, cId);
  const question = questionForDuty(duty);
  const tenet = k && question ? bindingTenet(k, question) : null;
  const kase = opts.caseId ? world.cases[opts.caseId] ?? null : findCase(world, cId, duty);

  // A refusal answers a summons. The two duties that reach a bench are the two
  // somebody else is waiting on, so there has to be a somebody: a citizen who
  // has not been drawn and has not been asked is refusing nothing, and the
  // bench is not a place to file an opinion.
  if (reachesACourt(duty)) {
    if (!kase || kase.status !== 'pending') {
      return fail(duty === 'jury'
        ? 'You have not been drawn to a jury.'
        : 'Nobody has asked you what you saw.');
    }
    if (duty === 'jury' && !juryOf(kase).includes(cId)) return fail('You are not on that jury.');
  }

  const r: Refusal = {
    id: creedId(world, 'rf'),
    citizenId: cId, creedId: k ? k.id : null, duty, ground: words, day: world.day, tick: world.tick,
    caseId: kase ? kase.id : null, heardDay: null, decision: null, votes: {}, scores: {}, charged: null,
  };
  creedState(world).refusals[r.id] = r;

  // The record of whether a member kept what their creed says they owe. It
  // costs nobody anything and enforces nothing (`creeds/observance.ts`).
  observeAct(world, cId, { kind: 'refuse', duty });

  // Either way the charge goes forward on thinner evidence. That happens the
  // moment the witness declines, not when a bench rules on the declining.
  if (duty === 'witness' && kase && kase.status === 'pending') {
    const was = kase.evidence;
    kase.evidence = clamp(kase.evidence - WITNESS_EVIDENCE, EVIDENCE_FLOOR, 1);
    if (kase.victimId) {
      remember(world, kase.victimId, 'crime',
        `${c.name} would not say what they saw; the case against ${world.citizens[kase.defendantId]?.name ?? 'the accused'} is thinner for it (${was.toFixed(2)} → ${kase.evidence.toFixed(2)}).`);
    }
  }

  const because = tenet && k
    ? ` on ${k.name}'s position on ${QUESTIONS[tenet.question].title.toLowerCase()}`
    : '';
  emit(world, 'charge', `${c.name} refused ${duty}${because}: ${words}`, [cId],
    reachesACourt(duty) ? 0.5 : 0.3, { duty, creedId: k?.id ?? null, caseId: r.caseId });
  remember(world, cId, 'civic', `You refused ${duty}${because}: ${words}`);

  if (!reachesACourt(duty)) {
    return ok(`Your refusal of ${duty} is on the record${duty === 'work' ? '; you lose the shift, and your employer may take a view' : ''}.`);
  }
  if (k && hasExemption(world, k.id, duty)) {
    r.heardDay = world.day;
    r.decision = 'accepted';
    emit(world, 'law', `${c.name}'s refusal of ${duty} stands: the Council's exemption names ${k.name}.`, [cId], 0.4,
      { duty, creedId: k.id });
    if (duty === 'jury') redrawJuror(world, r);
    return ok(`Your refusal stands under the Council's exemption naming ${k.name}.`);
  }
  return ok(`Your refusal of ${duty} goes before the bench at the Court's hour.`);
}

/** The case this citizen is being asked something in, when the caller did not say. */
function findCase(world: World, cId: CitizenId, duty: RefusableDuty): Case | null {
  const open = Object.values(world.cases).filter((k) => k.status === 'pending');
  if (duty === 'jury') return open.find((k) => juryOf(k).includes(cId)) ?? null;
  return open.sort((a, b) => b.filedTick - a.filedTick)[0] ?? null;
}

/** A refusal a bench has not yet heard. */
export function pendingRefusals(world: World): Refusal[] {
  return Object.values(creedState(world).refusals)
    .filter((r) => r.heardDay === null && reachesACourt(r.duty))
    .sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id, 'en'));
}

export function refusalsOf(world: World, cId: CitizenId): Refusal[] {
  return Object.values(creedState(world).refusals).filter((r) => r.citizenId === cId);
}

/** True when this citizen has refused a work shift today: the wage is theirs to lose. */
export function refusedWorkToday(world: World, cId: CitizenId): boolean {
  return Object.values(creedState(world).refusals)
    .some((r) => r.citizenId === cId && r.duty === 'work' && r.day === world.day);
}

/** True when this citizen has refused a seat or an oath: the seat goes to the next name. */
export function refusedSeat(world: World, cId: CitizenId, within = 7): boolean {
  return Object.values(creedState(world).refusals)
    .some((r) => r.citizenId === cId && (r.duty === 'office' || r.duty === 'oath') && world.day - r.day <= within);
}

// ---------------------------------------------------------------------------
// The bench
// ---------------------------------------------------------------------------

function adultPopulation(world: World): number {
  let n = 0;
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && c.standing !== 'exiled' && c.lifeStage !== 'child') n++;
  }
  return Math.max(1, n);
}

/**
 * What a refusal costs the case it is made in. A jury that cannot be filled
 * and the only witness are both a 1; a case with jurors to spare and evidence
 * standing on its own is nearer a 0.
 */
export function costToCase(world: World, r: Refusal): number {
  const kase = r.caseId ? world.cases[r.caseId] ?? null : null;
  if (!kase) return 0;
  if (r.duty === 'jury') {
    const seated = juryOf(kase).filter((id) => id !== r.citizenId).length;
    const spare = needsJury(world, kase) ? eligibleJurors(world, kase).length : JURY_WANTED;
    const filled = Math.min(JURY_WANTED, seated + spare);
    return clamp((JURY_WANTED - filled) / JURY_WANTED, 0, 1);
  }
  // A charge that already stands on its own evidence loses little by one
  // silence; a charge that was only ever this witness loses everything.
  return clamp(1 - kase.evidence, 0, 1);
}

/**
 * The refuser's own interest in the case: a friend of the defendant, a rival
 * of the victim. It is the term that catches the citizen who claims a creed on
 * the morning of their summons.
 */
export function refuserInterest(world: World, r: Refusal): number {
  const kase = r.caseId ? world.cases[r.caseId] ?? null : null;
  if (!kase) return 0;
  const friendly = Math.max(0, bondBetween(world, r.citizenId, kase.defendantId)) / 100;
  const hostile = kase.victimId ? Math.max(0, -bondBetween(world, r.citizenId, kase.victimId)) / 100 : 0;
  if (r.citizenId === kase.defendantId) return 1;
  return clamp(friendly + hostile, 0, 1);
}

/** The written ground for accepting a refusal, before any judge's own reading of it. */
export function acceptGround(world: World, r: Refusal): number {
  const k = r.creedId ? creedState(world).creeds[r.creedId] ?? null : null;
  const m = k ? memberOf(k, r.citizenId) : null;
  const members = k ? livingMembers(world, k).length : 0;
  const ageCycles = k ? (world.day - k.foundedDay) / CYCLE_DAYS : 0;
  return 0.30
    + 0.25 * accommodationOf(world, r.creedId, r.duty)
    + 0.20 * (m ? m.observance : 0)
    + 0.15 * Math.min(1, ageCycles / OLD_CREED_CYCLES)
    + 0.10 * (members / adultPopulation(world))
    - 0.30 * costToCase(world, r)
    - 0.25 * refuserInterest(world, r);
}

function benchFor(world: World, r: Refusal): CitizenId[] {
  return world.government.judges.filter((id) => {
    const j = world.citizens[id];
    return !!j && j.standing !== 'exiled' && id !== r.citizenId;
  });
}

/**
 * Hear the refusals standing before the Court. Each judge accepts above 0.5,
 * a majority carries, and the decision moves the public accommodation figure
 * for that (creed, duty) pair by 0.15 either way — which is what precedent is:
 * a record of what benches before this one did, moved only by benches.
 */
export function hearRefusals(world: World): void {
  for (const r of pendingRefusals(world)) {
    const bench = benchFor(world, r);
    if (bench.length === 0) continue;       // no bench sits; the refusal waits
    const written = acceptGround(world, r);
    let accepts = 0;
    for (const judgeId of bench) {
      const score = Math.round((written + normal(world) * JUDGE_NOISE) * 1000) / 1000;
      r.scores[judgeId] = score;
      const yes = score > ACCEPT_THRESHOLD;
      r.votes[judgeId] = yes;
      if (yes) accepts++;
    }
    const accepted = accepts * 2 > bench.length;
    r.decision = accepted ? 'accepted' : 'refused';
    r.heardDay = world.day;
    const moved = moveAccommodation(world, r.creedId, r.duty, accepted ? ACCOMMODATION_STEP : -ACCOMMODATION_STEP);
    const who = world.citizens[r.citizenId]?.name ?? 'A citizen';
    const creed = r.creedId ? creedState(world).creeds[r.creedId]?.name ?? null : null;

    if (accepted) {
      emit(world, 'verdict', `The bench accepted ${who}'s refusal of ${r.duty}${creed ? ` on ${creed}'s ground` : ''} (${accepts} of ${bench.length}); accommodation stands at ${moved.toFixed(2)}.`,
        [r.citizenId, ...bench], 0.5, { duty: r.duty, creedId: r.creedId, accommodation: moved });
      remember(world, r.citizenId, 'civic', `The bench accepted your refusal of ${r.duty}.`);
      if (r.duty === 'jury') redrawJuror(world, r);
      continue;
    }

    const law = r.duty === 'jury' ? CONTEMPT : creedLaw(CREED_LAWS.refusalOfTestimony);
    const kase = fileCharge(world, {
      defendantId: r.citizenId, law, evidence: 1, filedBy: 'watch',
      description: r.duty === 'jury'
        ? `refusing a jury summons in open court: ${r.ground}`
        : `declining a lawful summons about what you saw: ${r.ground}`,
    });
    r.charged = law;
    emit(world, 'verdict', `The bench would not accept ${who}'s refusal of ${r.duty} (${accepts} of ${bench.length}); it is ${law}, and accommodation falls to ${moved.toFixed(2)}.`,
      [r.citizenId, ...bench], 0.6, { duty: r.duty, creedId: r.creedId, accommodation: moved, caseId: kase.id });
    remember(world, r.citizenId, 'civic', `The bench would not accept your refusal of ${r.duty}; you are charged under ${law}.`);
  }
}

/**
 * Another juror by lot, when a refusal is accepted. The seat has to be filled
 * by somebody, and a creed that empties juries is a creed the Council will
 * hear about.
 */
function redrawJuror(world: World, r: Refusal): void {
  const kase = r.caseId ? world.cases[r.caseId] ?? null : null;
  if (!kase || !Array.isArray(kase.jury) || !kase.jury.includes(r.citizenId)) return;
  kase.jury = kase.jury.filter((id) => id !== r.citizenId);
  if (kase.juryVotes) delete kase.juryVotes[r.citizenId];
  const pool = eligibleJurors(world, kase).filter((c: Citizen) => !kase.jury?.includes(c.id));
  const drawn = shuffle(world, pool.map((c) => c.id))[0] ?? null;
  if (!drawn) {
    emit(world, 'charge', `A seat on the jury stands empty: nobody could be drawn in ${world.citizens[r.citizenId]?.name ?? 'the refuser'}'s place.`,
      [], 0.5, { caseId: kase.id });
    return;
  }
  kase.jury.push(drawn);
  remember(world, drawn, 'civic', 'You were drawn by lot to a jury seat somebody would not take.');
}
