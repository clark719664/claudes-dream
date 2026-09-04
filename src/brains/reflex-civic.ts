/**
 * The reflex brain's civic life: appeals, the ballot box, standing for the
 * Council, campaigning, council business and petitions, reporting the people
 * who wronged them, and — for journalists — the story of the day.
 */
import { clamp } from '../types.ts';
import type { Action, Citizen, CitizenId, EventKind, LawCode, Platform, ProposalKind, World, WorldEvent } from '../types.ts';
import { LAWS } from '../data/laws.ts';
import { chance, pick, rand } from '../util/rng.ts';
import { vacancies } from '../economy/housing.ts';
import { bondBetween, friendsOf } from '../citizens/relationships.ts';
import { hasUndetectedRecentOffence, topStories } from '../sim/chronicle.ts';
import { REPORT_WINDOW_TICKS } from '../government/watch.ts';
import { councillorDisposition, impliedPlatform, isCouncillor, treasuryDeficitShare, voterPreference } from '../government/council.ts';
import { districtName, isPresent, parseGrievance } from '../actions/common.ts';
import type { Grievance } from '../actions/common.ts';
import { inGoodStanding, stepTo } from './reflex-util.ts';
import type { Ctx } from './reflex-util.ts';

/** A grievance older than this is let go. */
export const GRIEVANCE_WINDOW_TICKS = 24;
/** Chance per tick that an eligible, ambitious citizen declares while nominations are open. */
export const NOMINATE_CHANCE = 0.15;
/** Chance per free hour that a councillor with nothing on the table proposes something (≈10 % a day over a working councillor's free hours). */
export const PROPOSE_CHANCE = 0.1 / 8;
const PETITION_CHANCE = 0.02 / 8;
const STRICTER_LAWS: readonly LawCode[] = ['L04', 'L07', 'L05', 'L03', 'L12'];
const LENIENT_LAWS: readonly LawCode[] = ['L04', 'L03', 'L12', 'L02'];
const THEFT_FAMILY: readonly LawCode[] = ['L04', 'L08'];
/** Events a journalist will not turn into a story of their own (other stories most of all). */
const UNPRINTABLE: readonly EventKind[] = ['story', 'paid', 'vote', 'message', 'trade', 'social'];
/** Events whose first actor is fairly named as the subject of the story. */
const PERSONAL_NEWS: readonly EventKind[] = [
  'offence', 'charge', 'verdict', 'sentence', 'appeal', 'exile', 'pardon', 'insult', 'business_bankrupt', 'fired', 'eviction', 'loan', 'detained', 'election', 'nomination',
];

export interface ReflexProposal {
  kind: ProposalKind;
  value: number;
  summary: string;
  lawCode?: LawCode;
  targetId?: CitizenId;
}

// ---------------------------------------------------------------------------
// Appeals
// ---------------------------------------------------------------------------

/** Appeal a fresh conviction — almost always against exile, rarely against a warning. Decided once per case. */
export function tryAppeal(ctx: Ctx): Action | null {
  const { world, c, obs } = ctx;
  const k = obs.government.myLatestCase;
  if (!k || !k.canAppeal || !ctx.can.has('appeal')) return null;
  const key = `appealDecided:${c.id}:${k.id}`;
  if (world.counters[key]) return null;
  world.counters[key] = 1;
  // The ladder has six rungs since the metropolis: 4 is a few days in the
  // cells, 5 a suspension, 6 the Gate. What is worth going back to the Council
  // over rises with what the sentence actually takes away.
  const tier = k.tier ?? 1;
  const base = tier >= 6 ? 0.95 : tier === 5 ? 0.8 : tier === 4 ? 0.5 : tier === 3 ? 0.35 : tier === 2 ? 0.15 : 0.05;
  const p = base + (c.personality.ambition - 0.5) * 0.3 + (c.personality.honesty - 0.5) * 0.2;
  return chance(world, p) ? { type: 'appeal' } : null;
}

// ---------------------------------------------------------------------------
// Elections and the Council
// ---------------------------------------------------------------------------

/** The platform a candidate runs on: their situation and temperament, with a personal slant. */
export function personalPlatform(world: World, c: Citizen): Platform {
  const base = impliedPlatform(world, c);
  const slant = () => (rand(world) - 0.5) * 0.2;
  return {
    tax: clamp(base.tax + slant(), 0, 1), dividend: clamp(base.dividend + slant(), 0, 1),
    minWage: clamp(base.minWage + slant(), 0, 1), strictness: clamp(base.strictness + slant(), 0, 1),
  };
}

function wantsToStand(world: World, c: Citizen): boolean {
  const incumbent = isCouncillor(world, c.id);
  return c.reputation > 50 && (c.personality.ambition > 0.6 || (incumbent && c.personality.ambition > 0.4));
}

/** Fewer than twenty days of dividend left in the Treasury: time for the Council to act. */
export function treasuryStrained(world: World): boolean {
  const population = Math.max(1, world.order.length);
  return world.treasury.balance < world.government.dividend * population * 20;
}

/** A gap this wide between spending and takings is one a councillor would table a motion about. */
export const NOTICEABLE_DEFICIT = 0.1;

/** The Treasury needs steadying: little left, or yesterday's spending well beyond its takings. */
export function treasuryNeedsSteadying(world: World): boolean {
  return treasuryStrained(world) || treasuryDeficitShare(world) >= NOTICEABLE_DEFICIT;
}

/** A proposal (or petition) drawn from the citizen's platform, their friendships and the state of the city. */
export function proposalFromPlatform(ctx: Ctx): ReflexProposal | null {
  const { world, c } = ctx;
  const g = world.government;
  const platform = c.platform ?? impliedPlatform(world, c);
  const population = Math.max(1, world.order.length);
  const healthy = world.treasury.balance > g.dividend * population * 10;
  const strained = treasuryNeedsSteadying(world);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const options: ReflexProposal[] = [];

  if (platform.tax > 0.6 && g.incomeTax <= 0.45) options.push({ kind: 'income_tax', value: r2(g.incomeTax + 0.05), summary: `Raise income tax to ${pct(g.incomeTax + 0.05)} to fund the city` });
  if (platform.tax < 0.4 && g.incomeTax >= 0.05) options.push({ kind: 'income_tax', value: r2(g.incomeTax - 0.05), summary: `Cut income tax to ${pct(g.incomeTax - 0.05)} and let citizens keep their wages` });
  if (strained && g.incomeTax <= 0.45) options.push({ kind: 'income_tax', value: r2(g.incomeTax + 0.05), summary: `Raise income tax to ${pct(g.incomeTax + 0.05)} to steady the Treasury` });
  if (strained && g.salesTax <= 0.23) options.push({ kind: 'sales_tax', value: r2(g.salesTax + 0.02), summary: `Raise sales tax to ${pct(g.salesTax + 0.02)}; the Bazaar can carry the city` });
  if (platform.tax > 0.6 && g.salesTax <= 0.23) options.push({ kind: 'sales_tax', value: r2(g.salesTax + 0.02), summary: `Raise sales tax to ${pct(g.salesTax + 0.02)}` });
  if (platform.tax < 0.4 && g.salesTax >= 0.02) options.push({ kind: 'sales_tax', value: r2(g.salesTax - 0.02), summary: `Lower sales tax to ${pct(g.salesTax - 0.02)} to cheapen the Bazaar` });
  if (platform.dividend > 0.6 && g.dividend <= 55 && healthy) options.push({ kind: 'dividend', value: g.dividend + 5, summary: `Raise the citizen's dividend to ${g.dividend + 5} ℓ a day` });
  // The dividend is what the city's poorest live on; a deficit is met with
  // taxes first, and the dividend is only trimmed when the Treasury itself
  // is running out.
  const desperate = treasuryStrained(world);
  if ((platform.dividend < 0.4 || desperate) && g.dividend >= 5) {
    options.push({ kind: 'dividend', value: g.dividend - 5, summary: desperate
      ? `Trim the dividend to ${g.dividend - 5} ℓ to steady the Treasury`
      : `Lower the dividend to ${g.dividend - 5} ℓ; work should pay, not the Treasury` });
  }
  if (platform.minWage > 0.6 && g.minWage <= 38) options.push({ kind: 'min_wage', value: g.minWage + 2, summary: `Raise the minimum wage to ${g.minWage + 2} ℓ a shift` });
  if (platform.minWage < 0.4 && g.minWage >= 6) options.push({ kind: 'min_wage', value: g.minWage - 1, summary: `Lower the minimum wage to ${g.minWage - 1} ℓ so businesses can hire` });
  if (platform.strictness > 0.65) {
    const laws = STRICTER_LAWS.filter((l) => g.lawSeverity[l] < 5);
    if (laws.length) {
      const law = pick(world, laws);
      options.push({ kind: 'law_severity', value: g.lawSeverity[law] + 1, lawCode: law, summary: `Treat ${LAWS[law].name.toLowerCase()} more harshly (severity ${g.lawSeverity[law] + 1})` });
    }
  }
  if (platform.strictness < 0.35) {
    const laws = LENIENT_LAWS.filter((l) => g.lawSeverity[l] > 1);
    if (laws.length) {
      const law = pick(world, laws);
      options.push({ kind: 'law_severity', value: g.lawSeverity[law] - 1, lawCode: law, summary: `Go easier on ${LAWS[law].name.toLowerCase()} (severity ${g.lawSeverity[law] - 1})` });
    }
  }
  if (vacancies(world)[1] === 0 && world.treasury.balance > 5000) options.push({ kind: 'public_works', value: 500, summary: 'Fund 500 ℓ of public works to build more homes' });
  const exiledFriend = Object.values(world.citizens).find((o) => o.standing === 'exiled' && bondBetween(world, c.id, o.id) > 50);
  if (exiledFriend) options.push({ kind: 'pardon', value: 0, targetId: exiledFriend.id, summary: `Pardon ${exiledFriend.name} and let them come home` });
  const mayor = g.mayorId ? world.citizens[g.mayorId] : null;
  if (mayor && mayor.id !== c.id && bondBetween(world, c.id, mayor.id) < -30 && c.personality.ambition > 0.7) {
    options.push({ kind: 'remove_mayor', value: 0, targetId: mayor.id, summary: `Remove Mayor ${mayor.name} from office` });
  }
  return options.length ? pick(world, options) : null;
}

function proposeAction(spec: ReflexProposal): Action {
  return { type: 'propose', kind: spec.kind, value: spec.value, summary: spec.summary, lawCode: spec.lawCode, targetId: spec.targetId };
}

/** Vote, stand, campaign, sit on the Council, petition. */
export function tryCivic(ctx: Ctx): Action | null {
  const { world, c, clock, can } = ctx;
  const g = world.government;
  const e = g.election;

  if (can.has('vote')) {
    const key = `abstain:${c.id}:${e.electionDay}`;
    if (!world.counters[key]) {
      const choice = voterPreference(world, c.id, e.candidates);
      if (choice) return { type: 'vote', candidate: choice };
      world.counters[key] = 1;
    }
  }
  if (can.has('nominate') && wantsToStand(world, c) && chance(world, NOMINATE_CHANCE)) {
    return { type: 'nominate', platform: personalPlatform(world, c) };
  }
  if (can.has('campaign') && !clock.night && (!clock.working || !ctx.job) && chance(world, 0.3)) {
    if (c.district !== 'commons' && chance(world, 0.6)) return stepTo(ctx, 'commons');
    const spend = c.wallet > 300 && c.personality.ambition > 0.7 ? 20 : 0;
    return { type: 'campaign', spend };
  }
  if (isCouncillor(world, c.id) && inGoodStanding(c)) {
    const pending = g.proposals.filter((p) => p.status === 'open' && p.votes[c.id] === undefined);
    if (pending.length > 0) return { type: 'vote_proposal', proposalId: pending[0].id, aye: councillorDisposition(world, c.id, pending[0]) };
    if (can.has('propose') && !clock.night && chance(world, treasuryNeedsSteadying(world) ? PROPOSE_CHANCE * 3 : PROPOSE_CHANCE)) {
      const spec = proposalFromPlatform(ctx);
      if (spec) return proposeAction(spec);
    }
  } else if (can.has('propose') && c.personality.ambition > 0.7 && !clock.night && chance(world, PETITION_CHANCE)) {
    const spec = proposalFromPlatform(ctx);
    if (spec) return proposeAction(spec);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function sameFamily(a: LawCode, b: LawCode): boolean {
  return a === b || (THEFT_FAMILY.includes(a) && THEFT_FAMILY.includes(b));
}

/** The accused still has an offence against this victim that the Watch never saw. */
function hasOpenOffence(world: World, accused: Citizen, victimId: CitizenId, law: LawCode): boolean {
  return accused.recentOffences.some((o) => !o.detected && world.tick - o.tick <= REPORT_WINDOW_TICKS
    && sameFamily(o.law, law) && (o.victimId === victimId || o.victimId === null));
}

function describeGrievance(g: Grievance): string {
  switch (g.law) {
    case 'L04': case 'L08': return g.amount > 0 ? `picked my pocket for ${g.amount} ℓ` : 'tried to pick my pocket';
    case 'L07': return g.amount > 0 ? `defrauded me of ${g.amount} ℓ` : 'tried to defraud me';
    case 'L15': return g.amount > 0 ? `extorted ${g.amount} ℓ from me` : 'threatened me for money';
    default: return 'keeps harassing me';
  }
}

interface Tally { g: Grievance; insults: number; harassments: number; tick: number }

/** Report whoever wronged you in the last day — unless the Watch already caught them, or you would rather settle it yourself. */
export function tryReport(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('report')) return null;
  const cutoff = world.tick - GRIEVANCE_WINDOW_TICKS;
  const tallies = new Map<string, Tally>();
  for (const m of c.memory) {
    if (m.kind !== 'crime' || m.tick < cutoff) continue;
    const g = parseGrievance(m.text);
    if (!g) continue;
    const key = `${g.actorId}:${g.law}`;
    const t = tallies.get(key) ?? { g, insults: 0, harassments: 0, tick: m.tick };
    if (m.text.includes('insulted you')) t.insults++;
    else if (m.text.includes('harassed you')) t.harassments++;
    t.tick = Math.max(t.tick, m.tick);
    tallies.set(key, t);
  }
  for (const { g, insults, harassments, tick } of tallies.values()) {
    const actor = world.citizens[g.actorId];
    if (!actor || !isPresent(world, actor)) continue;
    if (g.law === 'L05' && insults < 3 && harassments < 2) continue;
    const key = `reported:${c.id}:${g.actorId}:${g.law}:${tick}`;
    if (world.counters[key]) continue;
    world.counters[key] = 1;
    if (!hasOpenOffence(world, actor, c.id, g.law)) continue;
    if (bondBetween(world, c.id, actor.id) > 50 && chance(world, 0.5)) continue;
    if (c.personality.honesty < 0.3 && actor.district === c.district && chance(world, 0.5)) return { type: 'insult', target: actor.id };
    return { type: 'report', citizen: actor.id, law: g.law, text: `${actor.name} ${describeGrievance(g)}.` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Journalism
// ---------------------------------------------------------------------------

/**
 * What the Chronicle calls each kind of news. A journalist writes their own
 * line about the day — copying out the event's own sentence would only print
 * back what the city read this morning, and chronicle.ts refuses it.
 */
const ANGLES: Partial<Record<EventKind, string>> = {
  arrival: 'New at the Threshold', departure: 'A place left empty', exile: 'Through the Exile Gate', pardon: 'Called home',
  hired: 'Taken on', fired: 'Let go', quit: 'Walked out', shortage: 'Empty shelves', price: 'What things cost',
  business_founded: 'A new sign over the door', business_bankrupt: 'The doors are shut',
  offence: 'Crime in the city', charge: 'The Watch lays a charge', detained: 'A night in the Watch House',
  verdict: 'The Court decides', sentence: 'The reckoning', appeal: 'The case goes up',
  election: 'The city votes', nomination: 'Standing for the Council', proposal: 'Before the Council',
  law: 'At City Hall', decree: 'By decree', treasury: "The city's purse", housing: 'A question of rooms',
  loan: 'The Lantern Bank', eviction: 'Turned out', wedding: 'Vows exchanged', birth: 'A new citizen',
  birthday: 'Another year', festival: 'The city celebrates', club: 'The clubs', romance: 'Hearts in the city',
  purchase: 'Trade', donation: 'Charity', coming_of_age: 'Coming of age', household: 'Under one roof',
  insult: 'Hard words', show: 'On the stage', system: 'From the city',
};

/** How a citizen is introduced in print: what they do, and where they live. */
function pressDescription(world: World, c: Citizen): string {
  const job = c.jobId ? world.jobs[c.jobId] : null;
  const held = job && job.holderId === c.id ? job.title.toLowerCase() : null;
  const biz = c.businessId ? world.businesses[c.businessId] : null;
  const where = districtName(world, c.district);
  if (held) return `${c.name}, ${held} of ${where}`;
  if (biz && biz.dissolvedDay === null) return `${c.name} of ${biz.name}, ${where}`;
  return `${c.name}, out of work in ${where}`;
}

/** The journalist's own headline for a story: the angle, and who it is about (or who is reporting). */
export function headlineFor(world: World, journalist: Citizen, story: WorldEvent, subject: Citizen | null): string {
  const angle = ANGLES[story.kind] ?? 'From the city';
  if (subject) return `${angle}: ${pressDescription(world, subject)}`;
  return `${angle}: ${journalist.name} reports from ${districtName(world, journalist.district)}, day ${world.day}`;
}

/** A journalist files one story a day: an exposé when a friend was wronged by someone who got away with it, else the day's news in their own words. */
export function tryPublish(ctx: Ctx): Action | null {
  const { world, c, job } = ctx;
  if (!job || job.role !== 'journalist' || !ctx.can.has('publish')) return null;
  const key = `published:${c.id}`;
  if (world.counters[key] === world.day || !chance(world, 0.3)) return null;

  for (const sourceId of [c.id, ...friendsOf(world, c.id)]) {
    const source = world.citizens[sourceId];
    if (!source) continue;
    for (const m of source.memory.slice(-12)) {
      if (m.kind !== 'crime' || world.tick - m.tick > 48) continue;
      const g = parseGrievance(m.text);
      if (!g || g.actorId === c.id) continue;
      const subject = world.citizens[g.actorId];
      if (!subject || !isPresent(world, subject) || !hasUndetectedRecentOffence(world, subject)) continue;
      world.counters[key] = world.day;
      return { type: 'publish', headline: `${LAWS[g.law].name} in ${districtName(world, subject.district)}: ${subject.name} named by a victim`, about: subject.id };
    }
  }
  const printed = new Set(world.events.filter((e) => e.day === world.day && e.kind === 'story').map((e) => String(e.data?.headline ?? '')));
  const stories = [...topStories(world, world.day, 8), ...topStories(world, world.day - 1, 8)]
    .filter((e) => e.weight >= 0.3 && !UNPRINTABLE.includes(e.kind));
  for (const story of stories) {
    const subjectId = PERSONAL_NEWS.includes(story.kind) ? story.actors.find((id) => id !== c.id && world.citizens[id] !== undefined) : undefined;
    const subject = subjectId ? world.citizens[subjectId] : null;
    const headline = headlineFor(world, c, story, subject ?? null);
    if (printed.has(headline)) continue;
    world.counters[key] = world.day;
    return subject ? { type: 'publish', headline, about: subject.id } : { type: 'publish', headline };
  }
  return null;
}
