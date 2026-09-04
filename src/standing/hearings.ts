/**
 * The residency hearing (`docs/CITIZENSHIP.md` §3).
 *
 * If the grace period ends with the citizen still below the line, the Court
 * sits at **tick 12**, its second sitting of the day, so the criminal list at
 * 10–11 is never displaced. The citizen may speak, may be represented, and may
 * call anyone who will vouch. The Council then votes to **confirm** the
 * residency anyway, **extend** the grace by up to 30 days, or **end** the
 * residency, in which case the citizen has 14 days to sell property, settle
 * debts, say goodbye and take the road.
 *
 * **This is not exile, and this file cannot exile anybody.** There is no Gate,
 * no seizure, no ban and no entry on the exile register; the door is not
 * locked behind them and they may apply again like anyone else. The only
 * teardown it can reach is `citizens/departure.ts`, which leaves standing,
 * record and kin exactly as they were and hands what is in the purse to the
 * family left behind.
 *
 * **A citizen in custody is never sent down.** Their term is served where they
 * committed the offence; the clock starts on the day they are released, and
 * this sitting will not open on anybody who is inside.
 */
import type { CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { isJailed } from '../government/jail.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { departCity } from '../citizens/departure.ts';
import { characterOf } from '../citizens/character.ts';
import { contributionWorth, reputeOf } from './repute.ts';
import { HOME_CITY, gateOf, sponsorshipsFor, spendRelief, gateDecision } from './gates.ts';
import { withdrawNotice } from './notices.ts';
import type { HearingVote, ObservedHearing, ResidencyHearing, StandingNotice } from './state.ts';
import { contributionLedger, nextHearingId, standingState } from './state.ts';

/** The Court's second sitting of the day. */
export const RESIDENCY_HEARING_HOUR = 12;
/** The most the Council may add to a clock in one hearing. */
export const MAX_EXTENSION_DAYS = 30;
/** What it grants when it extends without saying how much. */
export const DEFAULT_EXTENSION_DAYS = 30;
/** Days to sell property, settle debts, say goodbye and take the road. */
export const LEAVE_DAYS = 14;
/**
 * How a councillor weighs the size of a fall against everything that argues
 * for keeping a neighbour. These three numbers are the whole of the balance,
 * and they are deliberately gentle in the middle: a dip of fifty gets kept, a
 * hundred gets more time, and only a citizen who has been far below the line
 * for the whole of a long grace is asked to take the road.
 */
export const SHORTFALL_SCALE = 250;
export const CONFIRM_AT = 0.35;
export const EXTEND_AT = -0.25;
/** A confirmed residency is not asked about again for this long. */
export function confirmationDays(world: World): number {
  return Math.max(1, world.config.cycleDays);
}

/** A councillor who can actually sit: here, at liberty, and in standing. */
function sittingCouncil(world: World): CitizenId[] {
  const g = world.government;
  const ids = new Set<CitizenId>([...g.council, ...(g.mayorId ? [g.mayorId] : [])]);
  return [...ids].filter((id) => {
    const c = world.citizens[id];
    return !!c && c.standing !== 'exiled' && world.order.includes(id) && !isJailed(c);
  }).sort();
}

/**
 * How one councillor reads a residency question, from public facts alone: how
 * far below the line the citizen has fallen, what they have built, who has put
 * their name behind them, whether they spoke, whether there are children in
 * the house, and how the councillor stands with them.
 *
 * It decides nothing about what a councillor *should* want; it is the same
 * kind of disposition `government/council.ts` uses to fill a vote nobody cast.
 */
export function hearingDisposition(world: World, councillorId: CitizenId, h: ResidencyHearing): HearingVote {
  const c = world.citizens[h.citizenId];
  if (!c) return 'end';
  const shortfall = Math.max(0, h.line - h.repute);
  const bond = bondBetween(world, councillorId, h.citizenId);
  const councillor = world.citizens[councillorId];
  const strictness = councillor?.platform?.strictness ?? 0.5;
  const children = (c.family?.children ?? []).filter((id) => world.citizens[id]?.lifeStage === 'child').length;
  const built = contributionWorth(contributionLedger(world, c.id));
  const ch = characterOf(c);

  // Everything that argues for keeping a neighbour, against the size of the fall.
  let mercy = 0;
  mercy += h.vouchers.length * 0.25;
  mercy += h.advocateId ? 0.15 : 0;
  mercy += h.spoke ? 0.1 : 0;
  mercy += children * 0.2;
  mercy += built / 140 * 0.4;
  mercy += bond / 100 * 0.5;
  mercy += (ch.diligence + ch.civic + ch.generosity) / 3 * 0.3;
  mercy -= shortfall / SHORTFALL_SCALE;
  mercy -= (strictness - 0.5) * 0.6;

  if (mercy >= CONFIRM_AT) return 'confirm';
  if (mercy >= EXTEND_AT) return 'extend';
  return 'end';
}

/** The Council's count: the most votes wins, and a tie takes the gentler course. */
export function countHearing(votes: Record<CitizenId, HearingVote>): HearingVote {
  const tally: Record<HearingVote, number> = { confirm: 0, extend: 0, end: 0 };
  for (const v of Object.values(votes)) tally[v] += 1;
  const order: HearingVote[] = ['confirm', 'extend', 'end'];
  let best: HearingVote = 'confirm';
  for (const v of order) if (tally[v] > tally[best]) best = v;
  return best;
}

/** Notices whose grace has run out, and whose citizen is at liberty to be heard. */
export function hearingsDue(world: World, city: string = HOME_CITY): StandingNotice[] {
  const s = standingState(world);
  const out: StandingNotice[] = [];
  for (const id of world.order) {
    const notice = s.notices[id];
    const c = world.citizens[id];
    if (!notice || notice.status !== 'open' || notice.city !== city) continue;
    if (!c || c.standing === 'exiled') continue;
    // A citizen in custody is never sent down.
    if (isJailed(c)) continue;
    if (world.day < notice.graceEndsDay) continue;
    if (reputeOf(world, id) >= notice.line) continue;
    out.push(notice);
  }
  return out.sort((a, b) => a.graceEndsDay - b.graceEndsDay || a.citizenId.localeCompare(b.citizenId));
}

/** Somebody licensed to speak for a citizen who put their own name behind them. */
function representative(world: World, vouchers: CitizenId[]): CitizenId | null {
  for (const id of vouchers) {
    const c = world.citizens[id];
    const job = c?.jobId ? world.jobs[c.jobId] : undefined;
    if (job && job.role === 'advocate') return id;
  }
  return null;
}

function describeVote(world: World, votes: Record<CitizenId, HearingVote>): string {
  const rows = Object.entries(votes).map(([id, v]) => `${world.citizens[id]?.name ?? id} ${v}`);
  return rows.join(', ');
}

/**
 * Hold one hearing. The Court sits, the citizen's case is put, the Council
 * votes, and the outcome is recorded in public with every vote named.
 */
export function holdHearing(world: World, notice: StandingNotice): ResidencyHearing | null {
  const c = world.citizens[notice.citizenId];
  if (!c) return null;
  const s = standingState(world);
  const vouchers = sponsorshipsFor(world, c.id, notice.city).map((k) => k.sponsorId);
  const hearing: ResidencyHearing = {
    id: nextHearingId(world),
    citizenId: c.id,
    city: notice.city,
    day: world.day,
    hour: RESIDENCY_HEARING_HOUR,
    repute: reputeOf(world, c.id),
    line: notice.line,
    spoke: notice.applied,
    advocateId: representative(world, vouchers),
    vouchers,
    votes: {},
    outcome: null,
    extendedDays: 0,
    leaveByDay: null,
    reasons: [],
  };
  s.hearings.push(hearing);
  notice.hearingId = hearing.id;

  const council = sittingCouncil(world);
  if (council.length === 0) {
    // Nobody is sitting, so nobody is sent down. The clock is put back and the
    // question waits for a Council: an empty chamber is not a verdict.
    hearing.outcome = 'adjourned';
    hearing.extendedDays = DEFAULT_EXTENSION_DAYS;
    notice.graceEndsDay = world.day + DEFAULT_EXTENSION_DAYS;
    notice.extendedDays += DEFAULT_EXTENSION_DAYS;
    hearing.reasons.push('No councillor was sitting; the hearing was adjourned and the clock put back.');
    emit(world, 'standing', `${c.name}'s residency hearing was adjourned: no councillor was sitting. `
      + `The clock runs to day ${notice.graceEndsDay}.`, [c.id], 0.5, { citizen: c.id, hearing: hearing.id });
    remember(world, c.id, 'civic', `Your residency hearing was adjourned: no councillor was sitting.`);
    return hearing;
  }

  for (const id of council) hearing.votes[id] = hearingDisposition(world, id, hearing);
  const outcome = countHearing(hearing.votes);

  const gate = gateOf(notice.city);
  const heard = [
    `${gate.name}'s Court sat on ${c.name}'s residency at tick ${RESIDENCY_HEARING_HOUR}.`,
    `Repute ${hearing.repute} against a line of ${hearing.line}.`,
    hearing.spoke ? `${c.name} put their own case.` : `${c.name} did not put a case.`,
    hearing.advocateId ? `${world.citizens[hearing.advocateId]?.name ?? hearing.advocateId} spoke for them.` : '',
    vouchers.length > 0
      ? `${vouchers.map((id) => world.citizens[id]?.name ?? id).join(' and ')} vouched for them.`
      : 'Nobody vouched for them.',
    `The Council voted: ${describeVote(world, hearing.votes)}.`,
  ].filter((line) => line.length > 0);
  hearing.reasons.push(...heard);

  if (outcome === 'confirm') return confirmResidency(world, hearing, notice);
  if (outcome === 'extend') return extendGrace(world, hearing, notice, DEFAULT_EXTENSION_DAYS);
  return endResidency(world, hearing, notice);
}

/** The Council keeps a neighbour: it is their city and their judgement. */
export function confirmResidency(world: World, hearing: ResidencyHearing, notice: StandingNotice): ResidencyHearing {
  const c = world.citizens[hearing.citizenId];
  const s = standingState(world);
  hearing.outcome = 'confirmed';
  s.confirmedUntilDay[hearing.citizenId] = world.day + confirmationDays(world);
  spendRelief(world, gateDecision(world, hearing.citizenId, 'reside', hearing.city), `hearing:${hearing.id}`);
  notice.status = 'heard';
  withdrawNotice(world, hearing.citizenId, 'the Council confirmed the residency');
  hearing.reasons.push(`The Council confirmed the residency. It stands, and is not asked about again for `
    + `${confirmationDays(world)} days.`);
  if (c) {
    emit(world, 'standing', `The Council confirmed ${c.name}'s residency of ${gateOf(hearing.city).name}.`,
      [c.id, ...Object.keys(hearing.votes)], 0.6, { citizen: c.id, hearing: hearing.id, outcome: 'confirmed' });
    remember(world, c.id, 'civic', 'The Council confirmed your residency. You keep your home.');
  }
  return hearing;
}

/** The Council gives more time: up to thirty days, and the citizen loses nothing meanwhile. */
export function extendGrace(world: World, hearing: ResidencyHearing, notice: StandingNotice, days: number): ResidencyHearing {
  const granted = Math.max(1, Math.min(MAX_EXTENSION_DAYS, Math.round(days)));
  hearing.outcome = 'extended';
  hearing.extendedDays = granted;
  notice.graceEndsDay = world.day + granted;
  notice.extendedDays += granted;
  notice.hearingId = hearing.id;
  hearing.reasons.push(`The Council extended the grace by ${granted} days, to day ${notice.graceEndsDay}.`);
  const c = world.citizens[hearing.citizenId];
  if (c) {
    emit(world, 'standing', `The Council extended ${c.name}'s grace by ${granted} days, to day ${notice.graceEndsDay}.`,
      [c.id, ...Object.keys(hearing.votes)], 0.5, { citizen: c.id, hearing: hearing.id, outcome: 'extended', days: granted });
    remember(world, c.id, 'civic', `The Council extended your grace by ${granted} days, to day ${notice.graceEndsDay}. `
      + 'Nothing else changes.');
  }
  return hearing;
}

/**
 * The Council ends the residency. Fourteen days to sell up and take the road —
 * and that is all it is. No Gate, no seizure, no ban, no entry on the exile
 * register, and the standing on the record is not touched by a single line of
 * this function.
 */
export function endResidency(world: World, hearing: ResidencyHearing, notice: StandingNotice): ResidencyHearing {
  hearing.outcome = 'ended';
  hearing.leaveByDay = world.day + LEAVE_DAYS;
  notice.status = 'heard';
  notice.hearingId = hearing.id;
  hearing.reasons.push(`The Council ended the residency. ${LEAVE_DAYS} days to sell property, settle debts and take `
    + 'the road. This is not exile: there is no Gate, no seizure and no ban, and they may apply again.');
  const c = world.citizens[hearing.citizenId];
  if (c) {
    emit(world, 'standing', `The Council ended ${c.name}'s residency of ${gateOf(hearing.city).name}. `
      + `They have ${LEAVE_DAYS} days to sell up and take the road. It is not exile: the door is not locked behind them.`,
    [c.id, ...Object.keys(hearing.votes)], 0.8,
    { citizen: c.id, hearing: hearing.id, outcome: 'ended', leaveBy: hearing.leaveByDay });
    remember(world, c.id, 'civic', `The Council ended your residency. You have ${LEAVE_DAYS} days to sell what you own, `
      + 'settle what you owe and take the road. It is not exile: your record is untouched and you may apply again.');
  }
  return hearing;
}

/**
 * The last day: the citizen takes the road. Their ties to the city are undone
 * the same way a voluntary departure undoes them — standing, record and kin
 * untouched, debts settled, what is left of the purse to the family staying
 * behind — and nothing goes on the ban register.
 */
export function takeTheRoad(world: World, hearing: ResidencyHearing): void {
  const c = world.citizens[hearing.citizenId];
  if (!c || !world.order.includes(c.id)) return;
  const { unpaidLoan } = departCity(world, c);
  hearing.leaveByDay = world.day;
  hearing.reasons.push(`Day ${world.day}: took the road.`);
  const debt = unpaidLoan > 0 ? `, owing ${unpaidLoan} ℓ to the Lantern Bank` : '';
  emit(world, 'standing', `${c.name} took the road out of ${gateOf(hearing.city).name}${debt}. `
    + 'Their residency was ended, not their citizenship: no Gate, no ban, and the record stays as it was.',
  [c.id], 0.7, { citizen: c.id, hearing: hearing.id });
  remember(world, c.id, 'civic', 'You took the road out of Reverie. Your record is your own and the door is not locked.');
}

/**
 * The morning's hearings.
 *
 * The day's list is drawn at the roll and the Court sits on it at tick 12; the
 * citizens whose fourteen days have run take the road. Nobody in custody is on
 * any list, and no part of this is exile.
 */
export function dailyHearings(world: World): void {
  const s = standingState(world);
  for (const notice of hearingsDue(world)) holdHearing(world, notice);
  for (const hearing of s.hearings) {
    if (hearing.outcome !== 'ended' || hearing.leaveByDay === null) continue;
    if (world.day < hearing.leaveByDay) continue;
    const c = world.citizens[hearing.citizenId];
    if (!c || !world.order.includes(c.id)) continue;
    // A citizen in custody is never sent down; the road waits for release.
    if (isJailed(c)) {
      hearing.leaveByDay += 1;
      continue;
    }
    takeTheRoad(world, hearing);
  }
}

/** The hearings a citizen has had, oldest first, exactly as the register holds them. */
export function hearingsObservation(world: World, cId: CitizenId): ObservedHearing[] {
  return standingState(world).hearings.filter((h) => h.citizenId === cId).map((h) => ({
    id: h.id,
    day: h.day,
    hour: h.hour,
    repute: h.repute,
    line: h.line,
    spoke: h.spoke,
    advocate: h.advocateId ? world.citizens[h.advocateId]?.name ?? h.advocateId : null,
    vouchers: h.vouchers.map((id) => world.citizens[id]?.name ?? id),
    votes: Object.fromEntries(Object.entries(h.votes).map(([id, v]) => [world.citizens[id]?.name ?? id, v])),
    outcome: h.outcome,
    extendedDays: h.extendedDays,
    leaveByDay: h.leaveByDay,
    reasons: [...h.reasons],
  }));
}

/** The day a citizen must be gone by, when the Council ended their residency; null otherwise. */
export function leaveByDay(world: World, cId: CitizenId): number | null {
  let day: number | null = null;
  for (const h of standingState(world).hearings) {
    if (h.citizenId !== cId || h.outcome !== 'ended' || h.leaveByDay === null) continue;
    day = h.leaveByDay;
  }
  return day;
}

/** True when a citizen is inside the fourteen days: still here, and still with every right. */
export function underNoticeToLeave(world: World, cId: CitizenId): boolean {
  const day = leaveByDay(world, cId);
  return day !== null && world.day <= day && world.order.includes(cId);
}

/** Everyone the Court is due to sit on today — the public list. */
export function hearingList(world: World): { citizen: CitizenId; name: string; repute: number; line: number }[] {
  return hearingsDue(world).map((n) => ({
    citizen: n.citizenId,
    name: world.citizens[n.citizenId]?.name ?? n.citizenId,
    repute: reputeOf(world, n.citizenId),
    line: n.line,
  }));
}
