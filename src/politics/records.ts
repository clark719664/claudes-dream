/**
 * Transparency — four switches, and what they cost (`docs/POLITICS.md` §7).
 *
 * | Switch | On | Off |
 * | `accounts` | every transfer published daily with party, amount and reason | a monthly total |
 * | `votes` | every vote named in the observation and the Chronicle | tallies only |
 * | `register` | officeholders file property, business, shares and creditors | nothing filed |
 * | `foi` | any citizen may request a record | no route exists |
 *
 * A request reaches the Council, the Watch, the Court, the Treasury or the
 * Registry. The body has three days to **release**, **refuse** with one of four
 * reasons, or **ignore** — itself the story, because every request and its
 * outcome is public: what was asked, by whom, of whom, and the reason given. A
 * refusal is appealable once to the Court, which may order release.
 *
 * The fourth reason is not policy and cannot be voted away: a citizen's notes
 * and letters are private by `docs/PRINCIPLES.md` §5 and no body in any city
 * may read them. Nothing below can release them, no amendment can reach them,
 * and a Court that orders it is refused by the engine.
 */
import type { ActionResult, Citizen, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { isPresent } from '../citizens/citizen.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { nextId } from '../util/ids.ts';
import { balanceOf } from '../economy/treasury.ts';
import { charterOf } from './charter.ts';
import { chargeCharterOffence } from './offences.ts';
import type { Measure, MeasureHooks } from './measures.ts';
import { tableMeasure } from './measures.ts';

export type RecordBody = 'council' | 'watch' | 'court' | 'treasury' | 'registry';
export const RECORD_BODIES: readonly RecordBody[] = ['council', 'watch', 'court', 'treasury', 'registry'];

/** The four reasons a body may give, and no others. */
export type RefusalReason = 'investigation' | 'deliberation' | 'court_order' | 'private';
export const REFUSAL_REASONS: Record<RefusalReason, string> = {
  investigation: 'a live investigation',
  deliberation: 'a sealed deliberation',
  court_order: 'a Court order',
  private: 'a citizen\'s notes and letters, which no body may read',
};

/** Days a body has to answer before the silence is itself the story. */
export const ANSWER_DAYS = 3;
/** Days an officeholder has to file the register after taking office or a change. */
export const FILING_DAYS = 3;
/** Requests kept on the public list. */
export const MAX_REQUESTS = 60;

export interface RecordRequest {
  id: string;
  of: RecordBody;
  subject: string;
  askedBy: CitizenId;
  askedDay: number;
  answer: 'open' | 'released' | 'refused' | 'ignored';
  reason: RefusalReason | null;
  answeredBy: CitizenId | null;
  answeredDay: number | null;
  released: string | null;
  appealed: boolean;
  ordered: boolean;
}

export interface RegisterEntry {
  officerId: CitizenId;
  filedDay: number;
  homes: number;
  business: string | null;
  shares: number;
  creditors: number;
}

interface RecordsState {
  requests: RecordRequest[];
  register: RegisterEntry[];
}

function fail(message: string): ActionResult { return { ok: false, message }; }

export function recordsState(world: World): RecordsState {
  // `world.records` is the Hall of Records; the transparency layer keeps its
  // own book beside it.
  const w = world as World & { transparency?: RecordsState };
  if (!w.transparency) w.transparency = { requests: [], register: [] };
  if (!Array.isArray(w.transparency.requests)) w.transparency.requests = [];
  if (!Array.isArray(w.transparency.register)) w.transparency.register = [];
  return w.transparency;
}

// ---------------------------------------------------------------------------
// Who answers for a body
// ---------------------------------------------------------------------------

/** Does this citizen speak for the body a request was made of? */
export function speaksFor(world: World, cId: CitizenId, body: RecordBody): boolean {
  const g = world.government;
  switch (body) {
    case 'council': return g.mayorId === cId || g.council.includes(cId);
    case 'watch': return g.watchCaptainId === cId || g.watch.includes(cId);
    case 'court': return g.judges.includes(cId);
    case 'treasury': return g.mayorId === cId || g.council.includes(cId);
    default: return g.mayorId === cId || g.council.includes(cId) || g.judges.includes(cId);
  }
}

/**
 * What the body actually holds on the subject, drawn from what is already
 * public. Releasing a record does not create knowledge; it puts what the city
 * already keeps in front of the citizen who asked, in the Chronicle, where
 * everybody else can read it too.
 */
export function readRecord(world: World, body: RecordBody, subject: string): string {
  const key = String(subject ?? '').toLowerCase();
  switch (body) {
    case 'council': {
      const p = world.government.proposals.find((x) => x.id === subject || x.summary.toLowerCase().includes(key));
      if (!p) return 'The Council holds no paper answering that.';
      const votes = Object.entries(p.votes).map(([id, v]) => `${world.citizens[id]?.name ?? id} ${v ? 'aye' : 'nay'}`).sort();
      return `${p.id} (${p.summary}): ${p.status}${votes.length ? `, votes ${votes.join(', ')}` : ', no votes recorded'}.`;
    }
    case 'watch': {
      const officers = world.government.watch.map((id) => world.citizens[id]?.name ?? id);
      return `The Watch: ${officers.length} officer${officers.length === 1 ? '' : 's'}`
        + `${officers.length ? ` (${officers.join(', ')})` : ''}, ${world.counters.patrolTicks ?? 0} patrol hours on the books.`;
    }
    case 'court': {
      const cases = Object.values(world.cases).filter((k) => k.id === subject
        || (world.citizens[k.defendantId]?.name ?? '').toLowerCase().includes(key));
      if (cases.length === 0) return 'The Court holds no case answering that.';
      return cases.slice(0, 3).map((k) => `${k.id}: ${world.citizens[k.defendantId]?.name ?? k.defendantId}`
        + ` charged under ${k.law}, ${k.status}${k.verdict ? ` (${k.verdict})` : ''}.`).join(' ');
    }
    case 'treasury': {
      const ledger = (world.treasury.ledger ?? []).slice(-5)
        .map((e) => `${e.kind} ${e.amount} ℓ ${e.from}→${e.to} (${e.memo})`);
      return `The Treasury holds ${Math.round(balanceOf(world, 'treasury'))} ℓ. Last entries: ${ledger.join('; ') || 'none'}.`;
    }
    default: {
      const c = Object.values(world.citizens).find((x) => x.id === subject || x.name.toLowerCase().includes(key));
      if (!c) return 'The Registry holds nobody by that name.';
      return `${c.name}: standing ${c.standing}, arrived day ${c.arrivedDay},`
        + ` ${c.record.convictions.length} conviction${c.record.convictions.length === 1 ? '' : 's'} on the record.`;
    }
  }
}

// ---------------------------------------------------------------------------
// Asking, and answering
// ---------------------------------------------------------------------------

/** A freedom-of-information request. Public the moment it is made. */
export function requestRecord(world: World, cId: CitizenId, body: RecordBody, subject: string): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (!charterOf(world).transparency.foi) return fail('The charter opens no route to ask for a record.');
  if (!RECORD_BODIES.includes(body)) return fail(`A request reaches ${RECORD_BODIES.join(', ')}.`);
  const clean = String(subject ?? '').trim().replace(/\s+/g, ' ').slice(0, 140);
  if (!clean) return fail('A request has to name what it asks for.');
  const state = recordsState(world);
  if (state.requests.some((r) => r.askedBy === cId && r.answer === 'open')) {
    return fail('You already have a request outstanding; wait for it to be answered.');
  }
  const r: RecordRequest = {
    id: nextId(world, 'f'), of: body, subject: clean, askedBy: cId, askedDay: world.day,
    answer: 'open', reason: null, answeredBy: null, answeredDay: null, released: null,
    appealed: false, ordered: false,
  };
  state.requests.push(r);
  emit(world, 'law', `${c.name} asked the ${body} for a record: "${clean}". It has ${ANSWER_DAYS} days to answer.`,
    [cId], 0.4, { requestId: r.id, body, subject: clean });
  remember(world, cId, 'civic', `You asked the ${body} for "${clean}" (${r.id}).`);
  return { ok: true, message: `Request ${r.id} is before the ${body}; it has ${ANSWER_DAYS} days.` };
}

/** Release it, refuse it with a stated reason, or let it lapse. */
export function answerRecord(
  world: World, cId: CitizenId, requestId: string, release: boolean, reason?: RefusalReason,
): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const r = recordsState(world).requests.find((x) => x.id === requestId);
  if (!r) return fail('There is no such request.');
  if (r.answer !== 'open') return fail(`Request ${r.id} has already been answered.`);
  if (!speaksFor(world, cId, r.of)) return fail(`You do not speak for the ${r.of}.`);
  const asker = world.citizens[r.askedBy];
  if (release) {
    const text = readRecord(world, r.of, r.subject);
    r.answer = 'released';
    r.released = text;
    r.answeredBy = cId;
    r.answeredDay = world.day;
    emit(world, 'law', `The ${r.of} released the record ${asker?.name ?? r.askedBy} asked for: ${text}`,
      [cId, r.askedBy], 0.5, { requestId: r.id, body: r.of, released: true });
    if (asker) remember(world, asker.id, 'civic', `The ${r.of} released what you asked for: ${text}`);
    return { ok: true, message: `You released the record: ${text}` };
  }
  const given: RefusalReason = reason && REFUSAL_REASONS[reason] ? reason : 'deliberation';
  r.answer = 'refused';
  r.reason = given;
  r.answeredBy = cId;
  r.answeredDay = world.day;
  emit(world, 'law', `The ${r.of} refused ${asker?.name ?? r.askedBy} the record on "${r.subject}": ${REFUSAL_REASONS[given]}.`,
    [cId, r.askedBy], 0.6, { requestId: r.id, body: r.of, reason: given });
  if (asker) remember(world, asker.id, 'civic', `The ${r.of} refused your request: ${REFUSAL_REASONS[given]}. You may appeal once.`);
  return { ok: true, message: `You refused the request: ${REFUSAL_REASONS[given]}.` };
}

/** A refusal is appealable once, to the Court. */
export function appealRecord(world: World, cId: CitizenId, requestId: string): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const r = recordsState(world).requests.find((x) => x.id === requestId);
  if (!r) return fail('There is no such request.');
  if (r.askedBy !== cId) return fail('Only the citizen who asked may appeal the answer.');
  if (r.answer !== 'refused' && r.answer !== 'ignored') return fail('There is nothing to appeal.');
  if (r.appealed) return fail('You have already appealed that refusal; the Court hears it once.');
  r.appealed = true;
  emit(world, 'appeal', `${c.name} appealed the ${r.of}'s answer on "${r.subject}" to the Court.`, [cId], 0.5,
    { requestId: r.id, body: r.of });
  return { ok: true, message: `The Court will hear your appeal on ${r.id}.` };
}

/**
 * The Court's second sitting. Judges vote on the appeals in front of them: a
 * refusal for a live investigation or a Court order stands, a sealed
 * deliberation may be opened, and a citizen's notes and letters are never
 * ordered released by anybody — the engine refuses it, whatever the bench says.
 */
export function decideRecordAppeals(world: World): void {
  const judges = world.government.judges.map((id) => world.citizens[id]).filter((c): c is Citizen => Boolean(c));
  for (const r of recordsState(world).requests) {
    if (!r.appealed || r.ordered || r.answer === 'released') continue;
    if (r.reason === 'private') {
      r.appealed = false;
      emit(world, 'appeal', `The Court refused to order the release of a citizen's notes and letters: no body in any city may read them.`,
        [r.askedBy], 0.6, { requestId: r.id, body: r.of, refusedByEngine: true });
      continue;
    }
    if (judges.length === 0) continue;
    // Each judge reads the reason for themselves: a live investigation or
    // another Court's order stands of itself; a sealed deliberation is the
    // body's own convenience, and an unanswered request is nothing at all.
    // Whom they know in the body that refused is theirs, and silent.
    const holds = r.reason === 'investigation' || r.reason === 'court_order';
    let order = 0;
    for (const j of judges) {
      const lean = (holds ? -0.5 : 0.5) - (r.answeredBy ? bondBetween(world, j.id, r.answeredBy) / 200 : 0);
      if (lean > 0) order += 1;
    }
    r.appealed = false;
    if (order * 2 <= judges.length) {
      emit(world, 'appeal', `The Court upheld the ${r.of}'s refusal on "${r.subject}".`, [r.askedBy], 0.5,
        { requestId: r.id, body: r.of, ordered: false });
      continue;
    }
    r.ordered = true;
    r.answer = 'open';
    emit(world, 'appeal', `The Court ordered the ${r.of} to release the record on "${r.subject}".`, [r.askedBy], 0.7,
      { requestId: r.id, body: r.of, ordered: true });
    for (const id of world.government.council) remember(world, id, 'civic', `The Court ordered the ${r.of} to release the record on "${r.subject}".`);
  }
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

/** What an officeholder actually holds today, from the public registers. */
export function holdingsOf(world: World, c: Citizen): Omit<RegisterEntry, 'officerId' | 'filedDay'> {
  const business = c.businessId && world.businesses[c.businessId]?.dissolvedDay === null ? c.businessId : null;
  const shares = Object.values(c.shares ?? {}).reduce((sum, q) => sum + Math.max(0, q ?? 0), 0);
  const creditors = (c.loanId ? 1 : 0) + (c.finesOwed > 0 ? 1 : 0);
  return { homes: (c.ownedUnits ?? []).length, business, shares, creditors };
}

/** File or update the register entry. A return that does not match the registers is L37. */
export function declareProperty(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (!charterOf(world).transparency.register) return fail('The charter asks nobody to file a register entry.');
  const state = recordsState(world);
  const now = holdingsOf(world, c);
  const held = state.register.find((e) => e.officerId === cId);
  const entry: RegisterEntry = { officerId: cId, filedDay: world.day, ...now };
  if (held) Object.assign(held, entry);
  else state.register.push(entry);
  const text = `${c.name} filed the register: ${now.homes} propert${now.homes === 1 ? 'y' : 'ies'},`
    + ` ${now.business ? world.businesses[now.business]?.name ?? now.business : 'no business'},`
    + ` ${now.shares} share${now.shares === 1 ? '' : 's'}, ${now.creditors} creditor${now.creditors === 1 ? '' : 's'}.`;
  emit(world, 'law', text, [cId], 0.3, { officer: cId, ...now });
  remember(world, cId, 'civic', 'You filed your entry in the register of interests.');
  return { ok: true, message: text };
}

/** The entry filed for an officeholder, or null. */
export function registerEntry(world: World, cId: CitizenId): RegisterEntry | null {
  return recordsState(world).register.find((e) => e.officerId === cId) ?? null;
}

/** Is the filed entry still true? */
export function returnIsTrue(world: World, c: Citizen): boolean {
  const filed = registerEntry(world, c.id);
  if (!filed) return false;
  const now = holdingsOf(world, c);
  return filed.homes === now.homes && filed.business === now.business
    && filed.shares === now.shares && filed.creditors === now.creditors;
}

function officeHolders(world: World): Citizen[] {
  const g = world.government;
  const ids = new Set<CitizenId>([...g.council, ...g.judges]);
  if (g.mayorId) ids.add(g.mayorId);
  if (g.watchCaptainId) ids.add(g.watchCaptainId);
  const out: Citizen[] = [];
  for (const id of ids) {
    const c = world.citizens[id];
    if (c && isPresent(world, c)) out.push(c);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function staleKey(cId: CitizenId): string { return `register:stale:${cId}`; }

/**
 * Morning: officeholders who have not filed, or whose filed entry stopped
 * being true, have three days to put it right; after that the register itself
 * proves the false return, which is what makes L37 provable rather than
 * alleged. A detective or a journalist reads it against the property register;
 * so does this pass.
 */
export function dailyRegister(world: World): void {
  const state = recordsState(world);
  if (!charterOf(world).transparency.register) {
    for (const key of Object.keys(world.counters)) if (key.startsWith('register:stale:')) delete world.counters[key];
    return;
  }
  for (const c of officeHolders(world)) {
    const key = staleKey(c.id);
    if (returnIsTrue(world, c)) { delete world.counters[key]; continue; }
    const since = world.counters[key];
    if (since === undefined) { world.counters[key] = world.day; continue; }
    if (world.day - since < FILING_DAYS) continue;
    delete world.counters[key];
    const filed = registerEntry(world, c.id);
    chargeCharterOffence(world, c.id, 'L37', {
      what: filed ? 'a register entry that no longer names what they hold' : 'no register entry at all',
    });
  }
  state.register = state.register.filter((e) => world.citizens[e.officerId]);
}

// ---------------------------------------------------------------------------
// Accounts, and the daily pass
// ---------------------------------------------------------------------------

/**
 * With `accounts` on, the day's movements are published with party, amount and
 * reason; with it off, the city gets a monthly total and nothing else.
 */
export function publishAccounts(world: World): void {
  const ch = charterOf(world);
  const ledger = world.treasury.ledger ?? [];
  const since = (world.day - 1) * 24;
  const today = ledger.filter((e) => e.tick >= since);
  if (ch.transparency.accounts) {
    const lines = today.slice(-8).map((e) => `${e.kind} ${e.amount} ℓ ${e.from}→${e.to} (${e.memo})`);
    emit(world, 'treasury', `The accounts for day ${world.day - 1}: ${today.length} movement${today.length === 1 ? '' : 's'}`
      + `${lines.length ? `, latest ${lines.join('; ')}` : ''}.`, [], 0.2,
    { movements: today.length, published: true });
    return;
  }
  const cycle = world.config?.cycleDays ?? 28;
  if (world.day % cycle !== 0) return;
  const total = today.reduce((sum, e) => sum + e.amount, 0);
  emit(world, 'treasury', `The accounts, once a month and in one line: ${total} ℓ moved on the last day of the month.`,
    [], 0.3, { movements: today.length, published: false });
}

/**
 * Morning: a request nobody answered in three days is ignored — itself the
 * story — and a body that sits on a record the Court ordered released is
 * obstructing one (L38).
 */
export function dailyRecords(world: World): void {
  const state = recordsState(world);
  for (const r of state.requests) {
    if (r.answer !== 'open') continue;
    const asker = world.citizens[r.askedBy];
    if (r.ordered && r.answeredDay !== null && world.day - r.answeredDay > 1) {
      const head = world.government.mayorId ?? world.government.council[0] ?? null;
      if (head) {
        chargeCharterOffence(world, head, 'L38', { what: `withholding the record on "${r.subject}" the Court ordered released` });
        r.ordered = false;
      }
      continue;
    }
    if (world.day - r.askedDay <= ANSWER_DAYS) continue;
    r.answer = 'ignored';
    r.answeredDay = world.day;
    emit(world, 'law', `The ${r.of} let ${asker?.name ?? r.askedBy}'s request on "${r.subject}" lapse unanswered.`,
      [r.askedBy], 0.6, { requestId: r.id, body: r.of, ignored: true });
    if (asker) remember(world, asker.id, 'civic', `The ${r.of} never answered your request on "${r.subject}".`);
  }
  const cycle = world.config?.cycleDays ?? 28;
  const keep = state.requests.filter((r) => r.answer === 'open' || (r.answeredDay ?? 0) > world.day - cycle);
  state.requests = keep.length > MAX_REQUESTS ? keep.slice(keep.length - MAX_REQUESTS) : keep;
  dailyRegister(world);
  publishAccounts(world);
}

// ---------------------------------------------------------------------------
// The measure that moves a switch
// ---------------------------------------------------------------------------

/** The `transparency` measure: one switch, on or off. */
export const transparencyHooks: MeasureHooks = {
  problem(world: World, spec): string | null {
    const which = String(spec.subject ?? '');
    if (!['accounts', 'votes', 'register', 'foi'].includes(which)) {
      return 'A transparency measure names one of accounts, votes, register or foi.';
    }
    const ch = charterOf(world);
    const on = spec.value !== undefined && spec.value > 0;
    if (ch.transparency[which as keyof typeof ch.transparency] === on) return `The ${which} switch is already ${on ? 'on' : 'off'}.`;
    return null;
  },
  enact(world: World, m: Measure): string {
    const which = String(m.subject ?? '') as keyof ReturnType<typeof charterOf>['transparency'];
    const on = m.value > 0;
    const ch = charterOf(world);
    ch.transparency[which] = on;
    ch.amendedDay = world.day;
    return `The ${which} switch is ${on ? 'open' : 'closed'}.`;
  },
  /**
   * A councillor reads a switch from where they stand: opening the books is a
   * cost to whoever is in office and a gift to everybody else, and a member
   * with something filed in the register reads it more sharply than one with
   * nothing.
   */
  disposition(world: World, cId: CitizenId, m: Measure): boolean | null {
    const c = world.citizens[cId];
    if (!c) return null;
    const on = m.value > 0;
    const holdings = holdingsOf(world, c);
    const exposed = holdings.homes > 0 || holdings.business !== null || holdings.shares > 0;
    if (on) return exposed ? false : null;
    return exposed ? true : null;
  },
};

/** A councillor moves one switch, open or closed. */
export function proposeTransparency(
  world: World, cId: CitizenId, which: 'accounts' | 'votes' | 'register' | 'foi', on: boolean, words?: string,
): ActionResult {
  return tableMeasure(world, cId, {
    kind: 'transparency', value: on ? 1 : 0, subject: which,
    words: words ?? `${on ? 'Open' : 'Close'} the ${which}.`,
  }, transparencyHooks);
}

// ---------------------------------------------------------------------------
// What a citizen reads
// ---------------------------------------------------------------------------

export interface ObservedRecords {
  transparency: { accounts: boolean; votes: boolean; register: boolean; foi: boolean };
  requests: { id: string; of: RecordBody; subject: string; asked: string; answer: string; reason: string | null }[];
  /** Set for an officeholder whose entry is out of date. */
  yourReturnDue: boolean;
}

export function recordsObservation(world: World, c: Citizen | null): ObservedRecords {
  const ch = charterOf(world);
  const state = recordsState(world);
  const holder = c ? officeHolders(world).some((o) => o.id === c.id) : false;
  return {
    transparency: { ...ch.transparency },
    requests: state.requests.slice(-6).map((r) => ({
      id: r.id, of: r.of, subject: r.subject,
      asked: world.citizens[r.askedBy]?.name ?? r.askedBy,
      answer: r.answer, reason: r.reason ? REFUSAL_REASONS[r.reason] : null,
    })),
    yourReturnDue: Boolean(c) && holder && ch.transparency.register && !returnIsTrue(world, c as Citizen),
  };
}
