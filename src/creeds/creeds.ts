/**
 * Founding, joining, leaving, amending, splitting and ending a creed
 * (`docs/CREEDS.md` §§1 and 6).
 *
 * **Nothing converts anybody.** There is exactly one door into a creed and it
 * is `adoptCreed`, called by the citizen itself, in its own hour, out of its
 * own observation. Nothing in this file — not a bond, not a preacher, not an
 * invitation, not a parent's creed — puts a citizen on a roll they did not put
 * themselves on. `METROPOLIS.md`'s schools of thought, which sorted citizens
 * by personality, were retired for exactly this (`REGISTRY.md` §7), and a
 * child holds no creed and inherits none.
 *
 * A tenet carries a `stance` the engine reads and words only citizens read.
 * The stance moves nothing in the world: no price, no verdict, no roll. What
 * it does is tell the congregation what its members said they owed each other,
 * so that `creeds/observance.ts` can record in public whether they did it.
 */
import { clamp } from '../types.ts';
import type { ActionResult, Citizen, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens, transfer } from '../economy/treasury.ts';
import { WEEK_LENGTH } from '../data/catalogue.ts';
import { closePot, potOf } from '../finance/pot.ts';
import type { AidRule, Creed, Succession, Tenet, TenetQuestion } from './shapes.ts';
import {
  FOUND_CREED_FEE, GATHERING_HOUR, MAX_CREED_NAME, MAX_TENETS, MAX_TENET_TEXT, MAX_TITHE, MIN_TENETS,
  QUESTIONS, SUCCESSIONS, TENET_QUESTIONS,
} from './shapes.ts';
import {
  allCreeds, creedFor, creedId, creedOf, creedState, isMember, livingMembers, newMember,
} from './state.ts';
import { fundBalance, openFund, setFundMembership, syncFundRule } from './fund.ts';
import { chooseOfficiant, describeForm } from './officiant.ts';

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

function adult(c: Citizen): boolean {
  return c.lifeStage === 'adult' || c.lifeStage === 'elder';
}

function goodStanding(c: Citizen): boolean {
  return c.standing === 'good' || c.standing === 'probation';
}

/** What a citizen may state a position with: a question, a stance and words. */
export interface TenetSpec {
  question: TenetQuestion;
  stance: number;
  text?: string;
}

export interface FoundCreedSpec {
  name: string;
  tenets: TenetSpec[];
  tithe?: number;
  gatheringDay?: number;
  succession?: Succession;
  /** Who decides a claim on the fund. `members` unless the founders wrote otherwise. */
  aidRule?: AidRule;
  /** Under `examination`, the observance the seat asks for. */
  examinationFloor?: number;
}

function cleanStance(v: number): number {
  return Number.isFinite(v) ? Math.round(clamp(v, -1, 1) * 100) / 100 : 0;
}

function cleanText(v: string | undefined): string {
  return (typeof v === 'string' ? v : '').trim().slice(0, MAX_TENET_TEXT);
}

function nameTaken(world: World, name: string): boolean {
  const want = name.toLowerCase();
  return allCreeds(world).some((k) => k.name.toLowerCase() === want);
}

/** A creed of this name that has died and whose record the Hall of Records keeps. */
export function deadCreedNamed(world: World, name: string): Creed | null {
  const want = name.trim().toLowerCase();
  return Object.values(creedState(world).dead).find((k) => k.name.toLowerCase() === want) ?? null;
}

function buildTenets(world: World, specs: TenetSpec[]): { tenets: Tenet[]; error: string | null } {
  const tenets: Tenet[] = [];
  const seen = new Set<TenetQuestion>();
  for (const spec of specs ?? []) {
    if (!TENET_QUESTIONS.includes(spec?.question)) {
      return { tenets, error: `${String(spec?.question)} is not one of the nine questions a creed may take a position on.` };
    }
    if (seen.has(spec.question)) {
      return { tenets, error: `A creed states one position on ${QUESTIONS[spec.question].title.toLowerCase()}, not two.` };
    }
    seen.add(spec.question);
    tenets.push({
      id: creedId(world, 'tn'), question: spec.question, stance: cleanStance(spec.stance),
      text: cleanText(spec.text), statedDay: world.day,
    });
  }
  return { tenets, error: null };
}

// ---------------------------------------------------------------------------
// Founding
// ---------------------------------------------------------------------------

/**
 * `found_creed { name, tenets, tithe, gatheringDay, succession }` — 100 ℓ at
 * the Registry, the filing a club takes, and everything about it is public
 * from that hour. The founder is its first member because they adopted it by
 * founding it; nobody else is on the roll.
 *
 * A name the Hall of Records already holds for a dead creed restores that
 * creed's tenets and its kindred, which a citizen might genuinely want to do a
 * hundred days later.
 */
export function foundCreed(world: World, cId: CitizenId, spec: FoundCreedSpec): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!goodStanding(c)) return fail(`You cannot found a creed while ${c.standing}.`);
  if (!adult(c)) return fail('A child holds no creed and founds none.');
  if (creedFor(world, cId)) return fail('You already belong to a creed; leave it before founding another.');

  const name = (spec.name ?? '').trim().slice(0, MAX_CREED_NAME);
  if (!name) return fail('A creed needs a name.');
  if (nameTaken(world, name)) return fail(`There is already a creed called ${name}.`);

  const restored = deadCreedNamed(world, name);
  const built = buildTenets(world, spec.tenets ?? []);
  if (built.error) return fail(built.error);
  let tenets = built.tenets;
  if (tenets.length === 0 && restored) {
    tenets = restored.tenets.map((t) => ({ ...t, id: creedId(world, 'tn'), statedDay: world.day }));
  }
  if (tenets.length < MIN_TENETS || tenets.length > MAX_TENETS) {
    return fail(`A creed holds between ${MIN_TENETS} and ${MAX_TENETS} tenets; you stated ${tenets.length}.`);
  }

  const tithe = clamp(Number.isFinite(spec.tithe) ? (spec.tithe as number) : 0, 0, MAX_TITHE);
  const day = Number.isFinite(spec.gatheringDay)
    ? ((Math.round(spec.gatheringDay as number) % WEEK_LENGTH) + WEEK_LENGTH) % WEEK_LENGTH
    : world.day % WEEK_LENGTH;
  const succession: Succession = SUCCESSIONS.includes(spec.succession as Succession)
    ? (spec.succession as Succession) : 'founder';
  const aidRule: AidRule = spec.aidRule === 'officiant' ? 'officiant' : 'members';

  if (c.wallet < FOUND_CREED_FEE) {
    return fail(`Filing a creed costs ${FOUND_CREED_FEE} ℓ at the Registry; you have ${formatLumens(c.wallet)}.`);
  }
  if (!transfer(world, cId, 'treasury', FOUND_CREED_FEE, 'registration', `filing of ${name} at the Registry`)) {
    return fail('The filing fee could not be paid.');
  }

  const pot = openFund(world, name, cId, aidRule === 'officiant');
  const k: Creed = {
    id: creedId(world, 'cr'), name, founderId: cId, foundedDay: world.day, potId: pot.id, tenets,
    tithe: Math.round(tithe * 1000) / 1000, gatheringDay: day, gatheringHour: GATHERING_HOUR,
    succession, aidRule,
    // The floor a founder who named none is taken to have meant: the figure a
    // new member starts at, so the seat is held until somebody passes it.
    examinationFloor: clamp(Number.isFinite(spec.examinationFloor) ? (spec.examinationFloor as number) : 0.5, 0, 1),
    officiantId: cId, members: { [cId]: newMember(world, cId) }, roll: [cId], house: null,
    gatheringsHeld: 0, parentCreedId: restored ? restored.id : null,
    kindred: restored ? [...restored.kindred] : [], acclaim: {}, standing: [], ballots: {},
    lastElectionDay: null, endedDay: null,
  };
  creedState(world).creeds[k.id] = k;
  syncFundRule(world, k);

  const questions = tenets.map((t) => QUESTIONS[t.question].title.toLowerCase()).join(', ');
  emit(world, 'club',
    `${c.name} filed ${k.name}${restored ? ', reviving a creed the Hall of Records had kept' : ''}: ${tenets.length} tenets (${questions}), a ${Math.round(k.tithe * 100)} % tithe, gathering on day ${day} of the week — ${describeForm(k)}.`,
    [cId], 0.6, { creedId: k.id, tenets: tenets.length, tithe: k.tithe, succession, aidRule });
  remember(world, cId, 'civic',
    `You filed ${k.name} for ${FOUND_CREED_FEE} ℓ and are its first member; it gathers on day ${day} of the week at ${k.gatheringHour}:00.`);
  return ok(`${k.name} (${k.id}) is on the register; you are its first member and its officiant.`);
}

// ---------------------------------------------------------------------------
// Joining and leaving
// ---------------------------------------------------------------------------

/**
 * `adopt_creed { creedId }` — **the only path into a creed there is.** Called
 * by the citizen, in its own hour. No engine path, no roll, no persuasion
 * check and no invitation ever calls this on somebody's behalf.
 */
export function adoptCreed(world: World, cId: CitizenId, creedId_: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (c.standing === 'exiled') return fail('You are outside the Gate.');
  if (!adult(c)) return fail('A child holds no creed; you may adopt one on coming of age.');
  const k = creedOf(world, creedId_);
  if (!k) return fail('There is no such creed.');
  if (isMember(k, cId)) return fail(`You already belong to ${k.name}.`);
  const held = creedFor(world, cId);
  if (held) return fail(`You belong to ${held.name}; leave it first.`);

  k.members[cId] = newMember(world, cId);
  k.roll.push(cId);
  setFundMembership(world, k, cId, true);
  answerInvitations(world, cId, k.id);
  const size = livingMembers(world, k).length;
  emit(world, 'club', `${c.name} adopted ${k.name} (${size} member${size === 1 ? '' : 's'}).`, [cId], 0.3,
    { creedId: k.id, members: size });
  remember(world, cId, 'civic',
    `You adopted ${k.name} of your own motion; it gathers on day ${k.gatheringDay} of the week at ${k.gatheringHour}:00 and tithes ${Math.round(k.tithe * 100)} % of income.`);
  for (const id of livingMembers(world, k)) {
    if (id !== cId) remember(world, id, 'social', `${c.name} adopted ${k.name}.`);
  }
  chooseOfficiant(world, k);
  return ok(`You adopted ${k.name}; the fund holds ${formatLumens(fundBalance(world, k))}.`);
}

/** Mark every standing invitation to this creed answered. An ignored one just stands. */
function answerInvitations(world: World, cId: CitizenId, creedId_: string): void {
  for (const inv of Object.values(creedState(world).invitations)) {
    if (inv.toId === cId && inv.creedId === creedId_ && inv.answeredDay === null) inv.answeredDay = world.day;
  }
}

/**
 * `leave_creed {}` — leave. What you tithed stays in the fund, because that is
 * what pooling means. **The last one out ends it.**
 */
export function leaveCreed(world: World, cId: CitizenId, creedId_?: string): ActionResult {
  const k = creedId_ ? creedOf(world, creedId_) : creedFor(world, cId);
  if (!k || !isMember(k, cId)) return fail('You do not belong to a creed.');
  const c = world.citizens[cId];
  const wasOfficiant = k.officiantId === cId;
  removeMember(world, k, cId);
  remember(world, cId, 'civic', `You left ${k.name}; what you tithed stays in the fund.`);

  if (livingMembers(world, k).length === 0) {
    endCreed(world, k, wasOfficiant ? cId : null, 'its last member left');
    return ok(`You left ${k.name}; with nobody left, it has ended.`);
  }
  emit(world, 'club', `${c?.name ?? 'A member'} left ${k.name}.`, [cId], 0.2, { creedId: k.id });
  chooseOfficiant(world, k);
  return ok(`You left ${k.name}.`);
}

/** Take a member off the roll without ceremony. The caller narrates. */
export function removeMember(world: World, k: Creed, cId: CitizenId): void {
  delete k.members[cId];
  k.roll = k.roll.filter((id) => id !== cId);
  delete k.acclaim[cId];
  delete k.ballots[cId];
  k.standing = k.standing.filter((id) => id !== cId);
  setFundMembership(world, k, cId, false);
}

/**
 * End a creed. The fund goes to the Community Chest, or to a named kindred
 * creed if the last one out was the officiant. The name, tenets and record go
 * to the Hall of Records and stay there for anyone to found under again.
 */
export function endCreed(world: World, k: Creed, lastOfficiantOut: CitizenId | null, reason: string): void {
  const kindred = lastOfficiantOut
    ? k.kindred.map((id) => creedOf(world, id)).find((other): other is Creed => !!other) ?? null
    : null;
  const left = fundBalance(world, k);
  const kindredBox = kindred ? potOf(world, kindred.potId)?.boxId ?? null : null;
  closePot(world, k.potId, kindredBox ?? 'chest');
  releaseHouse(world, k);
  k.endedDay = world.day;
  creedState(world).dead[k.id] = k;
  emit(world, 'club',
    `${k.name} has ended: ${reason}. Its ${formatLumens(left)} went to ${kindred ? kindred.name : 'the Community Chest'}, and its tenets to the Hall of Records.`,
    [], 0.5, { creedId: k.id, fund: left, kindred: kindred?.id ?? null });
}

/** Give up the house of meeting; a creed with none has no sanctuary to give. */
export function releaseHouse(world: World, k: Creed): void {
  k.house = null;
}

// ---------------------------------------------------------------------------
// Tenets: stating, amending, disputing
// ---------------------------------------------------------------------------

/**
 * `state_tenet { question, stance, text }` — the officiant adds a position, or
 * amends one the creed already holds. A creed never states two positions on
 * the same question: that is what a schism is for.
 */
export function stateTenet(
  world: World, k: Creed, cId: CitizenId, question: TenetQuestion, stance: number, text: string,
): ActionResult {
  if (k.officiantId !== cId) return fail(`Only ${k.name}'s officiant states its tenets.`);
  if (!TENET_QUESTIONS.includes(question)) return fail(`${String(question)} is not one of the nine questions.`);
  const held = k.tenets.find((t) => t.question === question) ?? null;
  if (!held && k.tenets.length >= MAX_TENETS) return fail(`A creed holds at most ${MAX_TENETS} tenets.`);
  const value = cleanStance(stance);
  const words = cleanText(text);
  const title = QUESTIONS[question].title.toLowerCase();
  if (held) {
    const was = held.stance;
    held.stance = value;
    held.text = words || held.text;
    held.statedDay = world.day;
    emit(world, 'club', `${k.name} restated its position on ${title} (${was.toFixed(2)} → ${value.toFixed(2)}): ${held.text}`,
      [cId], 0.4, { creedId: k.id, question, stance: value, was });
  } else {
    k.tenets.push({ id: creedId(world, 'tn'), question, stance: value, text: words, statedDay: world.day });
    emit(world, 'club', `${k.name} stated a position on ${title} (${value.toFixed(2)}): ${words}`,
      [cId], 0.4, { creedId: k.id, question, stance: value });
  }
  for (const id of livingMembers(world, k)) {
    remember(world, id, 'civic', `${k.name} now holds ${value >= 0 ? '+' : ''}${value.toFixed(2)} on ${title}: ${words}`);
  }
  return ok(`${k.name} holds ${value.toFixed(2)} on ${title}.`);
}
