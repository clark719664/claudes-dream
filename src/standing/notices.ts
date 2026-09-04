/**
 * The notice of standing (`docs/CITIZENSHIP.md` §3).
 *
 * The morning a resident's repute drops below their city's residency line, the
 * Registry issues a notice. It says what the line is, what they are, what it
 * cost them — the exact penalties, itemised — and the day the grace ends. It
 * arrives in their inbox, in their memory and on the public register.
 *
 * **Nothing else changes.** Through the whole grace period the citizen keeps
 * every right they had: work, trade, vote, stand for office, own property, be
 * housed. A notice is a warning, not a sentence, and this file passes no
 * sentence of any kind.
 *
 * ```
 * grace = 21 days
 *       + 1 day per 10 days of residency, capped at +39      (so 21–60 days)
 *       + 14 days if they have a child under age in the city
 *       + 7 days if they are in the middle of a custodial term
 * ```
 *
 * Recovery clears everything: three consecutive days back above the line and
 * the notice is withdrawn, struck from the register, and the clock destroyed.
 * A second notice within a cycle halves the remaining grace. There is no grace
 * at all for a collapse — 150 or more below the line — or for a conviction
 * under the Code of Persons at severity 4 or above.
 *
 * And a **citizen in custody is never sent down**: their clock does not run
 * while they are inside, because a city does not get to make its prisoners
 * somebody else's problem.
 */
import type { ActionResult, Citizen, CitizenId, World } from '../types.ts';
import { CITY_SENDER } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { isCivicLaw } from '../data/laws.ts';
import { isJailed } from '../government/jail.ts';
import { reputeItems, reputeOf, residentDays } from './repute.ts';
import { GATES, HOME_CITY, gateDecision, gateOf, residencyLine, spendRelief } from './gates.ts';
import type { NoticeItem, ObservedNotice, StandingNotice } from './state.ts';
import { noticeOf, standingState } from './state.ts';

/** The grace every notice starts with. */
export const BASE_GRACE_DAYS = 21;
/** One more day for every ten of residency… */
export const GRACE_DAYS_PER_RESIDENCY = 10;
/** …up to this, so the whole range is 21 to 60 days. */
export const MAX_RESIDENCY_GRACE = 39;
/** A child under age in the city is worth this much more rope. */
export const CHILD_GRACE_DAYS = 14;
/** A term being served is worth this much more, and the clock does not run inside. */
export const CUSTODY_GRACE_DAYS = 7;
/** Consecutive days back above the line that withdraw a notice. */
export const RECOVERY_DAYS = 3;
/** A fall this far below the line is a collapse, not a dip: no grace at all. */
export const COLLAPSE_SHORTFALL = 150;
/** A conviction against a *person* at this severity or above skips the grace. */
export const GRAVE_PERSON_SEVERITY = 4;

/** The grace a notice would carry for this citizen, before any halving. */
export function graceFor(world: World, c: Citizen): number {
  const residency = Math.min(MAX_RESIDENCY_GRACE, Math.floor(residentDays(world, c) / GRACE_DAYS_PER_RESIDENCY));
  const child = (c.family?.children ?? []).some((id) => world.citizens[id]?.lifeStage === 'child');
  return BASE_GRACE_DAYS + residency + (child ? CHILD_GRACE_DAYS : 0) + (isJailed(c) ? CUSTODY_GRACE_DAYS : 0);
}

/**
 * A conviction under the Code of Persons at severity 4 or above, recent enough
 * to be the reason for this fall: grievous assault, confinement, extortion,
 * mind-tampering, terror, erasure.
 */
export function graveOffence(world: World, c: Citizen): { caseId: string; law: string } | null {
  const window = Math.max(1, world.config.cycleDays);
  for (const k of [...(c.record?.convictions ?? [])].reverse()) {
    if (isCivicLaw(k.law)) continue;
    if (k.severity < GRAVE_PERSON_SEVERITY) continue;
    if (world.day - k.day > window) continue;
    return { caseId: k.caseId, law: k.law };
  }
  return null;
}

/**
 * The residency line a citizen is judged against: the line in force the last
 * day they stood above it, never a higher one. A city cannot amend people out
 * of their homes (`CITIZENSHIP.md` §3), so a line that rises issues no notice
 * to anybody already living inside it.
 */
export function judgedLine(world: World, cId: CitizenId, city: string = HOME_CITY): number {
  const held = standingState(world).lineFor[cId];
  const current = residencyLine(world, city);
  return Math.min(held ?? current, current);
}

/** Is a fall a collapse rather than a dip? */
export function isCollapse(repute: number, line: number): boolean {
  return line - repute >= COLLAPSE_SHORTFALL;
}

/** Everything the notice prints: the penalties by name, and every reading short of full. */
function noticeItems(world: World, c: Citizen, repute: number, line: number): NoticeItem[] {
  const items = reputeItems(world, c.id);
  items.push({ kind: 'shortfall', label: `repute ${repute} against a residency line of ${line}`, amount: repute - line });
  return items;
}

function noticeText(world: World, c: Citizen, n: StandingNotice): string {
  const gate = gateOf(n.city);
  const lines = [
    `Notice of standing, day ${n.issuedDay}. ${gate.name} asks ${n.line} of a resident; your repute is `
    + `${n.reputeAtIssue}, ${n.shortfall} short.`,
    ...n.items.slice(0, 6).map((i) => `  ${i.amount >= 0 ? '+' : ''}${i.amount}  ${i.label}`),
  ];
  if (n.immediate) {
    lines.push(`There is no grace: ${n.reason}. The Court sits on your residency at the next sitting you are at liberty for.`);
  } else {
    lines.push(`Your grace runs ${n.graceDays} days and ends on day ${n.graceEndsDay}`
      + `${n.halved ? ' (halved: this is your second notice within a cycle)' : ''}.`);
    lines.push(`Rise above ${n.line} for ${RECOVERY_DAYS} days at any point and this notice is withdrawn and struck from the register.`);
  }
  lines.push('Nothing else changes: you keep your work, your trade, your vote, your property and your home throughout.');
  if (isJailed(c)) lines.push('You are in custody; the clock does not run until the day you are released.');
  return lines.join('\n');
}

/**
 * Issue the notice. It goes to the citizen's inbox, their memory and the
 * public register, and it takes nothing away from them.
 */
export function issueNotice(world: World, c: Citizen, city: string = HOME_CITY): StandingNotice {
  const s = standingState(world);
  const line = s.lineFor[c.id] ?? residencyLine(world, city);
  const repute = reputeOf(world, c.id);
  const grave = graveOffence(world, c);
  const collapse = isCollapse(repute, line);
  const previous = s.lastNoticeDay[c.id];
  const halved = previous !== undefined && world.day - previous < Math.max(1, world.config.cycleDays);

  let grace = graceFor(world, c);
  if (halved) grace = Math.floor(grace / 2);
  const immediate = collapse || grave !== null;
  if (immediate) grace = 0;

  const reason = collapse
    ? `a fall of ${line - repute}, which is ${COLLAPSE_SHORTFALL} or more below the line`
    : grave
      ? `a conviction under the Code of Persons at severity ${GRAVE_PERSON_SEVERITY} or above (${grave.law}, case ${grave.caseId})`
      : 'repute below the residency line';

  const notice: StandingNotice = {
    citizenId: c.id,
    city,
    issuedDay: world.day,
    line,
    reputeAtIssue: repute,
    shortfall: Math.max(0, line - repute),
    graceDays: grace,
    graceEndsDay: world.day + grace,
    immediate,
    reason,
    items: noticeItems(world, c, repute, line),
    daysAbove: 0,
    halved,
    applied: false,
    status: 'open',
    extendedDays: 0,
    hearingId: null,
  };
  s.notices[c.id] = notice;
  s.lastNoticeDay[c.id] = world.day;

  const text = noticeText(world, c, notice);
  c.inbox.push({ from: CITY_SENDER, to: c.id, tick: world.tick, text });
  remember(world, c.id, 'civic', `The Registry issued you a notice of standing: repute ${repute} against a line of `
    + `${line}${immediate ? '. There is no grace; the Court will sit.' : `, grace to day ${notice.graceEndsDay}.`}`);
  emit(world, 'standing', `The Registry issued ${c.name} a notice of standing: repute ${repute} against `
    + `${gateOf(city).name}'s residency line of ${line}`
    + `${immediate ? ', with no grace — the Court will sit' : `, with ${grace} days of grace to day ${notice.graceEndsDay}`}.`,
  [c.id], immediate ? 0.7 : 0.5,
  { citizen: c.id, repute, line, grace, immediate, reason, halved });
  return notice;
}

/**
 * Withdraw a notice: struck from the register, and the clock destroyed. Most
 * notices end this way — convictions decay at 2 % a day, so an ordinary dip
 * repairs itself with ordinary living.
 */
export function withdrawNotice(world: World, cId: CitizenId, why: string): void {
  const s = standingState(world);
  const notice = s.notices[cId];
  if (!notice) return;
  delete s.notices[cId];
  const c = world.citizens[cId];
  if (!c) return;
  remember(world, cId, 'civic', `Your notice of standing was withdrawn and struck from the register: ${why}.`);
  emit(world, 'standing', `${c.name}'s notice of standing was withdrawn and struck from the register: ${why}.`,
    [cId], 0.4, { citizen: cId, why });
}

/**
 * `apply_residency { city }` — ask a city to have you, on your repute and its
 * own relief. A citizen already under notice puts their own case with it, and
 * that is what "the citizen may speak" means at the hearing.
 *
 * When the gate opens — on repute alone, or with a resident's name behind them
 * — the notice is withdrawn there and then. When it does not, the refusal
 * states its reasons in full and takes nothing away.
 */
export function applyResidency(world: World, cId: CitizenId, city: string = HOME_CITY): ActionResult {
  const c = world.citizens[cId];
  if (!c) return { ok: false, message: 'Unknown citizen.' };
  if (!GATES[city]) return { ok: false, message: `Reverie's Registry keeps no gate for ${city}.` };
  // The Registry reads one application a day from each citizen; asking twice
  // in an afternoon is not a second answer.
  const asked = `standing:applied:${cId}:${city}`;
  if (world.counters[asked] === world.day) {
    return { ok: false, message: `${gateOf(city).name}'s Registry has already read your application today.` };
  }
  world.counters[asked] = world.day;
  const decision = gateDecision(world, cId, 'reside', city);
  const notice = noticeOf(world, cId);
  if (notice && notice.city === city) notice.applied = true;

  if (decision.admitted) {
    spendRelief(world, decision, `residency:${cId}:${world.day}`);
    const s = standingState(world);
    // Where there was a real shortfall and the city's own relief covered it,
    // the gate has answered the question and does not ask it again inside a
    // cycle. An application by somebody already above the line asked nothing,
    // and buys nothing.
    if (decision.shortfall > 0) s.confirmedUntilDay[cId] = world.day + Math.max(1, world.config.cycleDays);
    // "They may apply again like anyone else" — including inside the fourteen
    // days, in which case the road they were taking is simply not taken.
    for (const hearing of s.hearings) {
      if (hearing.citizenId !== cId || hearing.outcome !== 'ended' || hearing.leaveByDay === null) continue;
      hearing.leaveByDay = null;
      hearing.reasons.push(`Day ${world.day}: readmitted at the gate; the road is not taken.`);
    }
    if (notice) withdrawNotice(world, cId, `${decision.cityName} admitted their application for residency`);
    emit(world, 'standing', `${decision.cityName} admitted ${c.name}'s application for residency: `
      + `${decision.reasons.join(' ')}`, [cId], 0.5, { citizen: cId, city, repute: decision.repute });
    remember(world, cId, 'civic', `${decision.cityName} admitted your application for residency.`);
    return { ok: true, message: decision.reasons.join(' ') };
  }
  remember(world, cId, 'civic', `${decision.cityName} refused your application for residency: ${decision.reasons.join(' ')}`);
  emit(world, 'standing', `${decision.cityName} refused ${c.name}'s application for residency: ${decision.reasons[0]}`,
    [cId], 0.4, { citizen: cId, city, repute: decision.repute, shortfall: decision.shortfall - decision.covered });
  return { ok: false, message: decision.reasons.join(' ') };
}

/** Citizens the register is judging today: living here, of age, not exiled. */
function judged(world: World): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || c.standing === 'exiled' || c.lifeStage === 'child') continue;
    out.push(c);
  }
  return out;
}

/**
 * The morning's standing round.
 *
 * Every resident is read against the line they are judged by — the line in
 * force the last day they stood above it, because a city cannot amend people
 * out of their homes. A fall issues a notice; three days back above the line
 * withdraws one; and a clock never runs while its citizen is in custody.
 */
export function dailyNotices(world: World): void {
  const s = standingState(world);
  const line = residencyLine(world);
  for (const c of judged(world)) {
    const repute = reputeOf(world, c.id);
    const judgedBy = judgedLine(world, c.id);
    const notice = s.notices[c.id];

    if (repute >= line) {
      // They meet today's line, so today's line becomes theirs.
      s.lineFor[c.id] = line;
    } else if (s.lineFor[c.id] === undefined) {
      // Nobody has ever seen them above the line: they are judged by it as it stands.
      s.lineFor[c.id] = line;
    }

    if (notice && notice.status === 'open') {
      if (repute >= notice.line) {
        notice.daysAbove += 1;
        if (notice.daysAbove >= RECOVERY_DAYS) {
          withdrawNotice(world, c.id, `${RECOVERY_DAYS} days back above the line`);
        }
        continue;
      }
      notice.daysAbove = 0;
      // A citizen in custody is never sent down: the clock starts on release.
      if (isJailed(c) && !notice.immediate) notice.graceEndsDay += 1;
      continue;
    }

    if (repute >= judgedBy) continue;
    // The Council has already had this question and answered it; it does not
    // answer it again inside a cycle.
    const confirmed = s.confirmedUntilDay[c.id];
    if (confirmed !== undefined && world.day < confirmed) continue;
    // Nor does it ask it again of somebody already inside the fourteen days
    // the Council gave them to sell up and take the road: one hearing is one
    // hearing, and a second notice on top of it would be a second sentence.
    if (s.hearings.some((h) => h.citizenId === c.id && h.outcome === 'ended' && h.leaveByDay !== null)) continue;
    issueNotice(world, c);
  }
}

/** The notices standing this morning, oldest first — the public register. */
export function openNotices(world: World): StandingNotice[] {
  return Object.values(standingState(world).notices)
    .filter((n) => n.status === 'open')
    .sort((a, b) => a.issuedDay - b.issuedDay || a.citizenId.localeCompare(b.citizenId));
}

/** The Charter's own list of what a notice leaves untouched. */
export const NOTICE_KEEPS: readonly string[] = [
  'you may work',
  'you may trade',
  'you may vote and stand for office',
  'you may own property',
  'you keep your home',
  'you may rise above the line and end this',
];

/** A citizen's own notice, as their observation shows it; null for everybody else. */
export function noticeObservation(world: World, cId: CitizenId): ObservedNotice | null {
  const n = noticeOf(world, cId);
  if (!n) return null;
  return {
    issuedDay: n.issuedDay,
    line: n.line,
    repute: reputeOf(world, cId),
    shortfall: Math.max(0, n.line - reputeOf(world, cId)),
    graceDays: n.graceDays,
    graceEndsDay: n.graceEndsDay,
    daysLeft: Math.max(0, n.graceEndsDay - world.day),
    daysAbove: n.daysAbove,
    recoveryDays: RECOVERY_DAYS,
    immediate: n.immediate,
    reason: n.reason,
    halved: n.halved,
    applied: n.applied,
    items: n.items.map((i) => ({ ...i })),
    keeps: [...NOTICE_KEEPS],
  };
}
