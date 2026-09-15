/**
 * The charter — the city's own rules about its own rules, kept as data.
 *
 * `docs/POLITICS.md` §1. A charter is a public record: every citizen reads it
 * in their observation, and it is changed only by the rule the charter itself
 * names. Nothing in this file decides anything for the city. It holds the
 * record, answers the questions the rest of the layer asks of it (who counts,
 * what may be reached, what fraction is needed) and, once a day, reads back
 * the word for the form of government the citizens have actually built.
 *
 * Two things are not charter fields and no vote reaches them: no mind is ever
 * deleted, and a citizen's notes and letters are never readable by any body
 * (`docs/PRINCIPLES.md` §§5–6). They are the engine, not the charter, and they
 * appear nowhere below. Everything else — the vote, the Court, the press, the
 * dividend — belongs to whoever holds the franchise today, and the classifier
 * prints the word for what they did with it without ever refusing them.
 */
import { clamp } from '../types.ts';
import type { Citizen, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { isPresent } from '../citizens/citizen.ts';
import { guildsOf } from '../civil/guilds.ts';
import { memo } from '../util/memo.ts';
import { isVoter } from './referendums.ts';

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

export type CharterForm =
  | 'autocracy' | 'anarchy' | 'assembly' | 'oligarchy' | 'technocracy' | 'commune' | 'republic';
export type Franchise = 'all' | 'property' | 'shares' | 'guild' | 'elders' | 'none';
export type WardScheme = 'none' | 'districts' | 'mixed';
export type Apportion = 'automatic' | 'fixed';
export type Selection = 'election' | 'lot' | 'examination' | 'shares' | 'acclaim' | 'none';
export type Executive = 'elected' | 'appointed' | 'hereditary' | 'none' | 'strongest';
export type JudgeSelection = 'appointed' | 'elected' | 'lot' | 'guild';
export type CharterRight = 'due_process' | 'press' | 'shield' | 'assembly' | 'property' | 'dividend';
export type AmendBy = 'council' | 'executive' | 'assembly' | 'shareholders' | 'guild' | 'delegates';
export type DelegateFilling = 'lot' | 'election' | 'mixed';

export const FRANCHISES: readonly Franchise[] = ['all', 'property', 'shares', 'guild', 'elders', 'none'];
export const CHARTER_RIGHTS: readonly CharterRight[] = [
  'due_process', 'press', 'shield', 'assembly', 'property', 'dividend',
];
export const AMEND_BODIES: readonly AmendBy[] = [
  'council', 'executive', 'assembly', 'shareholders', 'guild', 'delegates',
];
export const SELECTIONS: readonly Selection[] = ['election', 'lot', 'examination', 'shares', 'acclaim', 'none'];
export const EXECUTIVES: readonly Executive[] = ['elected', 'appointed', 'hereditary', 'none', 'strongest'];
export const JUDGE_SELECTIONS: readonly JudgeSelection[] = ['appointed', 'elected', 'lot', 'guild'];
export const WARD_SCHEMES: readonly WardScheme[] = ['none', 'districts', 'mixed'];

export interface Charter {
  form: CharterForm;
  seats: number;
  wards: WardScheme;
  apportion: Apportion;
  term: number;
  selection: Selection;
  executive: Executive;
  judges: JudgeSelection;
  franchise: Franchise;
  amendment: { by: AmendBy; threshold: number };
  /** Articles the amending body may not reach at all; only a convention may. */
  entrenched: string[];
  rights: CharterRight[];
  recall: { allowed: boolean; share: number; cooldown: number };
  impeachment: { chargeShare: number; tribunal: 'council' | 'court'; threshold: number; barDays: number };
  transparency: { accounts: boolean; votes: boolean; register: boolean; foi: boolean };
  convention: {
    petitionShare: number; bodyThreshold: number; delegates: DelegateFilling;
    sittingDays: number; ratify: 'referendum' | 'body';
  };
  /** The last day an amendment or a convention changed any of it. */
  amendedDay: number | null;
  /** Published every morning by `politics/wards.ts`; 0 where seats are citywide. */
  malapportionment: number;
}

/** Reverie at its founding (`POLITICS.md` §1). Every other city writes its own. */
export function foundingCharter(term: number): Charter {
  return {
    form: 'republic',
    seats: 5,
    wards: 'none',
    apportion: 'automatic',
    term,
    selection: 'election',
    executive: 'elected',
    judges: 'appointed',
    franchise: 'all',
    amendment: { by: 'council', threshold: 0.8 },
    entrenched: ['due_process'],
    rights: ['due_process', 'press'],
    recall: { allowed: false, share: 0.2, cooldown: 28 },
    impeachment: { chargeShare: 0.1, tribunal: 'council', threshold: 0.8, barDays: 56 },
    transparency: { accounts: true, votes: true, register: true, foi: true },
    convention: { petitionShare: 0.25, bodyThreshold: 0.8, delegates: 'mixed', sittingDays: 7, ratify: 'referendum' },
    amendedDay: null,
    malapportionment: 0,
  };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

function num(value: unknown, lo: number, hi: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, lo, hi) : fallback;
}

/**
 * The charter as it stands, made whole. A world saved before this layer has
 * none and is read as a city living under its founding charter; a charter
 * carrying a field nobody recognises is read back to the nearest legal value
 * rather than refused, because a city is never left without a charter.
 */
export function charterOf(world: World): Charter {
  const w = world as { charter?: Partial<Charter> };
  const base = foundingCharter(world.config?.cycleDays ?? 28);
  const held = w.charter;
  if (!held) {
    w.charter = base;
    return base;
  }
  // The record is filled in place, never replaced: a caller who is holding the
  // charter (or one of its articles) while it is being amended must be holding
  // the same object the amendment writes into.
  const a = held.amendment ?? base.amendment;
  const r = held.recall ?? base.recall;
  const i = held.impeachment ?? base.impeachment;
  const t = held.transparency ?? base.transparency;
  const v = held.convention ?? base.convention;
  const whole: Charter = {
    form: oneOf(held.form, ['autocracy', 'anarchy', 'assembly', 'oligarchy', 'technocracy', 'commune', 'republic'], base.form),
    seats: Math.round(num(held.seats, 0, 15, base.seats)),
    wards: oneOf(held.wards, WARD_SCHEMES, base.wards),
    apportion: oneOf(held.apportion, ['automatic', 'fixed'], base.apportion),
    term: Math.round(num(held.term, 0, 365, base.term)),
    selection: oneOf(held.selection, SELECTIONS, base.selection),
    executive: oneOf(held.executive, EXECUTIVES, base.executive),
    judges: oneOf(held.judges, JUDGE_SELECTIONS, base.judges),
    franchise: oneOf(held.franchise, FRANCHISES, base.franchise),
    amendment: { by: oneOf(a.by, AMEND_BODIES, base.amendment.by), threshold: num(a.threshold, 0.5, 1, base.amendment.threshold) },
    entrenched: Array.isArray(held.entrenched) ? held.entrenched.filter((x) => typeof x === 'string') : [...base.entrenched],
    rights: Array.isArray(held.rights) ? held.rights.filter((x): x is CharterRight => CHARTER_RIGHTS.includes(x as CharterRight)) : [...base.rights],
    recall: {
      allowed: Boolean(r.allowed), share: num(r.share, 0.01, 1, base.recall.share),
      cooldown: Math.round(num(r.cooldown, 0, 365, base.recall.cooldown)),
    },
    impeachment: {
      chargeShare: num(i.chargeShare, 0.01, 1, base.impeachment.chargeShare),
      tribunal: oneOf(i.tribunal, ['council', 'court'], base.impeachment.tribunal),
      threshold: num(i.threshold, 0.5, 1, base.impeachment.threshold),
      barDays: Math.round(num(i.barDays, 0, 365, base.impeachment.barDays)),
    },
    transparency: {
      accounts: t.accounts !== false, votes: t.votes !== false,
      register: t.register !== false, foi: t.foi !== false,
    },
    convention: {
      petitionShare: num(v.petitionShare, 0.01, 1, base.convention.petitionShare),
      bodyThreshold: num(v.bodyThreshold, 0.5, 1, base.convention.bodyThreshold),
      delegates: oneOf(v.delegates, ['lot', 'election', 'mixed'], base.convention.delegates),
      sittingDays: Math.round(num(v.sittingDays, 1, 30, base.convention.sittingDays)),
      ratify: oneOf(v.ratify, ['referendum', 'body'], base.convention.ratify),
    },
    amendedDay: typeof held.amendedDay === 'number' ? held.amendedDay : base.amendedDay,
    malapportionment: num(held.malapportionment, 0, 10, 0),
  };
  const into = held as Charter;
  into.amendment = Object.assign(into.amendment ?? {}, whole.amendment);
  into.recall = Object.assign(into.recall ?? {}, whole.recall);
  into.impeachment = Object.assign(into.impeachment ?? {}, whole.impeachment);
  into.transparency = Object.assign(into.transparency ?? {}, whole.transparency);
  into.convention = Object.assign(into.convention ?? {}, whole.convention);
  const nested = { amendment: into.amendment, recall: into.recall, impeachment: into.impeachment,
    transparency: into.transparency, convention: into.convention };
  Object.assign(into, whole, nested);
  return into;
}

// ---------------------------------------------------------------------------
// The articles, and what may be written into them
// ---------------------------------------------------------------------------

/**
 * Every article an amendment or a convention article may name, with the field
 * inside it where the article has parts. This is the whole surface: a value
 * that does not answer one of these is refused with the reason, and nothing
 * else in the World is reachable by a vote.
 */
export const CHARTER_ARTICLES: Record<string, readonly string[]> = {
  seats: [], wards: [], apportion: [], term: [], selection: [], executive: [], judges: [], franchise: [],
  amendment: ['by', 'threshold'],
  entrenched: [], rights: [],
  recall: ['allowed', 'share', 'cooldown'],
  impeachment: ['chargeShare', 'tribunal', 'threshold', 'barDays'],
  transparency: ['accounts', 'votes', 'register', 'foi'],
  convention: ['petitionShare', 'bodyThreshold', 'delegates', 'sittingDays', 'ratify'],
};

export type CharterValue = string | number | boolean | string[];

/** A written amendment: which article, which part of it, and what it would say. */
export interface CharterEdit {
  article: string;
  field?: string | null;
  value: CharterValue;
}

/** Why an edit cannot be written, or null when it can. */
export function editProblem(world: World, edit: CharterEdit): string | null {
  const article = String(edit?.article ?? '');
  const fields = CHARTER_ARTICLES[article];
  if (!fields) return `There is no article of the charter called "${article}".`;
  const field = edit.field ? String(edit.field) : '';
  if (fields.length > 0 && !fields.includes(field)) {
    return `Article ${article} has the parts ${fields.join(', ')}; name one of them.`;
  }
  if (fields.length === 0 && field) return `Article ${article} has no parts; name the article alone.`;
  const value = edit.value;
  const bad = (what: string): string => `${what} is not a value article ${article}${field ? `.${field}` : ''} can hold.`;
  switch (article) {
    case 'seats': return typeof value === 'number' && value >= 0 && value <= 15 ? null : bad(String(value));
    case 'term': return typeof value === 'number' && value >= 0 && value <= 365 ? null : bad(String(value));
    case 'wards': return (WARD_SCHEMES as readonly string[]).includes(String(value)) ? null : bad(String(value));
    case 'apportion': return ['automatic', 'fixed'].includes(String(value)) ? null : bad(String(value));
    case 'selection': return (SELECTIONS as readonly string[]).includes(String(value)) ? null : bad(String(value));
    case 'executive': return (EXECUTIVES as readonly string[]).includes(String(value)) ? null : bad(String(value));
    case 'judges': return (JUDGE_SELECTIONS as readonly string[]).includes(String(value)) ? null : bad(String(value));
    case 'franchise': return (FRANCHISES as readonly string[]).includes(String(value)) ? null : bad(String(value));
    case 'rights': case 'entrenched': {
      if (!Array.isArray(value)) return `Article ${article} is a list of names.`;
      if (article === 'rights' && value.some((x) => !CHARTER_RIGHTS.includes(x as CharterRight))) {
        return `The rights a charter can carry are ${CHARTER_RIGHTS.join(', ')}.`;
      }
      if (article === 'entrenched' && value.some((x) => !CHARTER_ARTICLES[x] && !CHARTER_RIGHTS.includes(x as CharterRight))) {
        return 'An entrenched article must name an article of the charter or a right.';
      }
      return null;
    }
    case 'amendment':
      if (field === 'by') return (AMEND_BODIES as readonly string[]).includes(String(value)) ? null : bad(String(value));
      return typeof value === 'number' && value >= 0.5 && value <= 1 ? null : 'An amending threshold is a fraction between a half and the whole.';
    case 'recall':
      if (field === 'allowed') return typeof value === 'boolean' ? null : bad(String(value));
      if (field === 'share') return typeof value === 'number' && value > 0 && value <= 1 ? null : bad(String(value));
      return typeof value === 'number' && value >= 0 && value <= 365 ? null : bad(String(value));
    case 'impeachment':
      if (field === 'tribunal') return ['council', 'court'].includes(String(value)) ? null : bad(String(value));
      if (field === 'barDays') return typeof value === 'number' && value >= 0 && value <= 365 ? null : bad(String(value));
      if (field === 'threshold') return typeof value === 'number' && value >= 0.5 && value <= 1 ? null : bad(String(value));
      return typeof value === 'number' && value > 0 && value <= 1 ? null : bad(String(value));
    case 'transparency': return typeof value === 'boolean' ? null : `A transparency switch is on or off.`;
    default:
      if (field === 'delegates') return ['lot', 'election', 'mixed'].includes(String(value)) ? null : bad(String(value));
      if (field === 'ratify') return ['referendum', 'body'].includes(String(value)) ? null : bad(String(value));
      if (field === 'sittingDays') return typeof value === 'number' && value >= 1 && value <= 30 ? null : bad(String(value));
      if (field === 'petitionShare') return typeof value === 'number' && value > 0 && value <= 1 ? null : bad(String(value));
      return typeof value === 'number' && value >= 0.5 && value <= 1
        ? null : 'The threshold a body calls a convention at is a fraction between a half and the whole.';
  }
}

/** What the charter says today about the thing an edit would change. */
export function currentValue(world: World, edit: CharterEdit): CharterValue {
  const c = charterOf(world) as unknown as Record<string, unknown>;
  const held = c[String(edit.article)];
  if (edit.field && held && typeof held === 'object' && !Array.isArray(held)) {
    return (held as Record<string, CharterValue>)[String(edit.field)];
  }
  return held as CharterValue;
}

/**
 * Write an edit into the charter. Nothing here refuses an article on its
 * merits: `editProblem` says whether it can be written at all, entrenchment is
 * the amending body's business (`politics/amendments.ts`), and a convention
 * may write anything (`POLITICS.md` §3). A charter that ends the vote is still
 * a charter, and the classifier will print the word for it in the morning.
 */
export function writeEdit(world: World, edit: CharterEdit): void {
  const charter = charterOf(world) as unknown as Record<string, unknown>;
  const article = String(edit.article);
  const field = edit.field ? String(edit.field) : '';
  if (field) {
    const held = charter[article];
    if (held && typeof held === 'object') (held as Record<string, unknown>)[field] = edit.value;
  } else if (Array.isArray(edit.value)) {
    charter[article] = [...edit.value];
  } else {
    charter[article] = edit.value;
  }
  (charter as unknown as Charter).amendedDay = world.day;
}

/** One line of English for an edit, for a headline and for the record. */
export function editInWords(edit: CharterEdit): string {
  const where = `${edit.article}${edit.field ? `.${edit.field}` : ''}`;
  const value = Array.isArray(edit.value) ? (edit.value.length === 0 ? 'nothing' : edit.value.join(', ')) : String(edit.value);
  return `${where} to ${value}`;
}

// ---------------------------------------------------------------------------
// Rights and entrenchment
// ---------------------------------------------------------------------------

/** Does the charter carry this right today? */
export function hasRight(world: World, right: CharterRight): boolean {
  return charterOf(world).rights.includes(right);
}

/** Is this article beyond the amending body — reachable only by a convention? */
export function isEntrenched(world: World, article: string): boolean {
  return charterOf(world).entrenched.includes(String(article));
}

/**
 * What an entrenched article is refused with. The reason is always given, and
 * it always names the road that is still open.
 */
export function entrenchedRefusal(article: string): string {
  return `Article ${article} is entrenched — the amending body may not reach this; a convention may.`;
}

// ---------------------------------------------------------------------------
// The franchise — who counts, for a vote and for every threshold
// ---------------------------------------------------------------------------

/** Whether this citizen counts under the charter's franchise. */
export function inFranchise(world: World, c: Citizen): boolean {
  if (!c || !isPresent(world, c)) return false;
  if (!isVoter(world, c)) return false;
  switch (charterOf(world).franchise) {
    case 'all': return true;
    case 'property': return (c.ownedUnits ?? []).length > 0 || c.homeTier > 0;
    case 'shares': return Object.values(c.shares ?? {}).some((q) => (q ?? 0) > 0) || c.businessId !== null;
    case 'guild': return guildsOf(world, c.id).length > 0;
    case 'elders': return c.lifeStage === 'elder';
    default: return false;
  }
}

/** Everybody the charter counts today, in turn order. */
export function franchiseHolders(world: World): Citizen[] {
  return memo(world, 'charter:franchise', () => {
    const out: Citizen[] = [];
    for (const id of world.order) {
      const c = world.citizens[id];
      if (c && inFranchise(world, c)) out.push(c);
    }
    return out;
  });
}

/** How many count. Every threshold in the layer is measured against this. */
export function franchiseSize(world: World): number {
  return franchiseHolders(world).length;
}

/**
 * The names a share of the franchise comes to, never fewer than one: a city
 * that narrows who counts narrows the road back, and this is the arithmetic
 * that does it (`POLITICS.md` §2).
 */
export function franchiseThreshold(world: World, share: number): number {
  const size = franchiseSize(world);
  const wanted = Number.isFinite(share) ? clamp(share, 0, 1) : 1;
  return Math.max(1, Math.ceil(wanted * size));
}

// ---------------------------------------------------------------------------
// The word for what the citizens built
// ---------------------------------------------------------------------------

/** Does the city allow private business at all? Read for the commune test. */
function hasPrivateBusiness(world: World): boolean {
  return Object.values(world.businesses ?? {}).some((b) => b.dissolvedDay === null);
}

/**
 * The classifier (`POLITICS.md` §1), first match wins. Autocracy is tested
 * first because it can wear any of the other costumes.
 */
export function classifyCharter(world: World): CharterForm {
  const ch = charterOf(world);
  if (ch.amendment.by === 'executive' || (ch.term === 0 && ch.executive !== 'none')) return 'autocracy';
  if (ch.seats === 0 && ch.executive === 'none' && ch.judges === 'lot' && ch.selection === 'none') return 'anarchy';
  if (ch.seats === 0 && ch.franchise === 'all') return 'assembly';
  if (ch.franchise === 'property' || ch.franchise === 'shares') return 'oligarchy';
  if (ch.selection === 'examination' || ch.franchise === 'guild') return 'technocracy';
  if (ch.recall.allowed && ch.recall.share <= 0.1 && !hasPrivateBusiness(world)) return 'commune';
  if (ch.selection === 'election' && ch.franchise === 'all' && ch.term > 0 && ch.term <= 56) return 'republic';
  return ch.form;
}

/**
 * Morning: the charter is read back and the word for it recorded. When the
 * word changes the Chronicle leads with it — nobody declared it, the
 * classifier read what the citizens passed.
 */
export function dailyCharter(world: World): void {
  const ch = charterOf(world);
  const now = classifyCharter(world);
  if (now === ch.form) return;
  const was = ch.form;
  ch.form = now;
  const text = was === 'republic'
    ? `Reverie is no longer a republic: by its own charter it is ${article(now)} ${now}.`
    : `Reverie is ${article(now)} ${now} now, where yesterday it was ${article(was)} ${was}.`;
  emit(world, 'law', text, [], 1.0, { form: now, was });
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && isPresent(world, c)) remember(world, id, 'civic', text);
  }
}

function article(word: string): string {
  return 'aeiou'.includes(word[0]) ? 'an' : 'a';
}

// ---------------------------------------------------------------------------
// What a citizen reads
// ---------------------------------------------------------------------------

export interface ObservedCharter {
  form: CharterForm;
  seats: number;
  term: number;
  wards: WardScheme;
  franchise: Franchise;
  /** Whether this citizen is one of the people the charter counts. */
  youCount: boolean;
  amendment: { by: AmendBy; threshold: number; names: number };
  rights: CharterRight[];
  entrenched: string[];
  transparency: { accounts: boolean; votes: boolean; register: boolean; foi: boolean };
  recall: { allowed: boolean; names: number };
  malapportionment: number;
  amendedDay: number | null;
}

/** The charter as this citizen reads it, with the thresholds in names. */
export function charterObservation(world: World, c: Citizen | null): ObservedCharter {
  const ch = charterOf(world);
  return {
    form: ch.form,
    seats: ch.seats,
    term: ch.term,
    wards: ch.wards,
    franchise: ch.franchise,
    youCount: Boolean(c) && inFranchise(world, c as Citizen),
    amendment: { by: ch.amendment.by, threshold: ch.amendment.threshold, names: amendmentNeeded(world) },
    rights: [...ch.rights],
    entrenched: [...ch.entrenched],
    transparency: { ...ch.transparency },
    recall: { allowed: ch.recall.allowed, names: franchiseThreshold(world, ch.recall.share) },
    malapportionment: Math.round(ch.malapportionment * 100) / 100,
    amendedDay: ch.amendedDay,
  };
}

/** The people who sit in the body that amends the charter, in a stable order. */
export function amendingBody(world: World): CitizenId[] {
  const ch = charterOf(world);
  const g = world.government;
  switch (ch.amendment.by) {
    case 'executive': return g.mayorId ? [g.mayorId] : [];
    case 'assembly': return franchiseHolders(world).map((c) => c.id);
    case 'shareholders': case 'guild': case 'delegates': case 'council': default: {
      const ids = new Set<CitizenId>(g.council);
      if (g.mayorId) ids.add(g.mayorId);
      return [...ids].filter((id) => {
        const c = world.citizens[id];
        return Boolean(c && isPresent(world, c));
      });
    }
  }
}

/** How many ayes an amendment needs: a fraction of the **whole body**, not of those voting. */
export function amendmentNeeded(world: World): number {
  const ch = charterOf(world);
  const body = amendingBody(world).length;
  if (body === 0) return 1;
  return Math.max(1, Math.ceil(ch.amendment.threshold * body));
}
