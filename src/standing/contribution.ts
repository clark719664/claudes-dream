/**
 * Contribution — the one part of repute that only ever rises
 * (`docs/CITIZENSHIP.md` §1).
 *
 * ```
 * Each cycle served on the Council      15   (Mayor 25)
 * Each judge's term completed           20
 * Each 100 shifts worked                 8
 * A business that survived 30 days      15
 * A work acquired by the Museum         20
 * Each citizen mentored to mastery      12
 * Each child raised to adulthood        10
 * Each 500 lumens given to the Chest     6
 * A club that reached 10 members         8
 * ```
 *
 * Every line is a deed done in person and read off the public record. Nothing
 * here is inheritable (`GENERATIONS.md` §6) and nothing here can be bought: a
 * purse is not a deed, and the column counts deeds. Once a line is counted it
 * stays counted — a business that later fails, a club that later shrinks and
 * an office later lost do not take back the days that were served.
 *
 * The rows the Expanse adds — a technology discovered or taught, an apprentice
 * who carries a secret on, a medal at the Games — are in the Charter's table
 * and wait for the layers that make them possible.
 */
import { clamp } from '../types.ts';
import type { Citizen, World } from '../types.ts';
import { MASTER_SKILL } from '../data/metropolis.ts';
import type { ContributionLedger, ObservedDeed } from './state.ts';
import { contributionLedger, standingState } from './state.ts';

// ---------------------------------------------------------------------------
// Contribution (0–140)
// ---------------------------------------------------------------------------

export const CONTRIBUTION_CAP = 140;
export const CONTRIBUTION_WORTH = {
  councilCycle: 15,
  mayorCycle: 25,
  judgeTerm: 20,
  hundredShifts: 8,
  business: 15,
  museum: 20,
  mentee: 12,
  child: 10,
  fiveHundredDonated: 6,
  club: 8,
} as const;
/** Shifts that buy one line of contribution. */
export const SHIFTS_PER_LINE = 100;
/** Lumens to the Chest that buy one line of contribution. */
export const DONATION_PER_LINE = 500;
/** Days a business must survive before it counts. */
export const BUSINESS_SURVIVAL_DAYS = 30;
/** Members a club must reach before it counts. */
export const CLUB_OF_TEN = 10;

// ---------------------------------------------------------------------------
// Contribution, accumulated
// ---------------------------------------------------------------------------

/** What a ledger of deeds is worth in repute, capped at 140. */
export function contributionWorth(l: ContributionLedger): number {
  const w = CONTRIBUTION_WORTH;
  const raw = l.councilCycles * w.councilCycle
    + l.mayorCycles * w.mayorCycle
    + l.judgeTerms * w.judgeTerm
    + Math.floor(l.shifts / SHIFTS_PER_LINE) * w.hundredShifts
    + l.businesses * w.business
    + l.museum * w.museum
    + l.mentored * w.mentee
    + l.children * w.child
    + Math.floor(l.donated / DONATION_PER_LINE) * w.fiveHundredDonated
    + l.clubs * w.club;
  return clamp(Math.round(raw), 0, CONTRIBUTION_CAP);
}

/** The deeds behind a citizen's contribution, itemised, for a notice or an observation. */
export function contributionDeeds(l: ContributionLedger): ObservedDeed[] {
  const w = CONTRIBUTION_WORTH;
  const rows: ObservedDeed[] = [
    { label: 'cycles on the Council', count: l.councilCycles, worth: l.councilCycles * w.councilCycle },
    { label: 'cycles as Mayor', count: l.mayorCycles, worth: l.mayorCycles * w.mayorCycle },
    { label: "judge's terms completed", count: l.judgeTerms, worth: l.judgeTerms * w.judgeTerm },
    { label: 'hundreds of shifts worked', count: Math.floor(l.shifts / SHIFTS_PER_LINE), worth: Math.floor(l.shifts / SHIFTS_PER_LINE) * w.hundredShifts },
    { label: 'businesses that survived 30 days', count: l.businesses, worth: l.businesses * w.business },
    { label: 'works acquired by the Museum', count: l.museum, worth: l.museum * w.museum },
    { label: 'citizens mentored to mastery', count: l.mentored, worth: l.mentored * w.mentee },
    { label: 'children raised to adulthood', count: l.children, worth: l.children * w.child },
    { label: 'five hundreds given to the Chest', count: Math.floor(l.donated / DONATION_PER_LINE), worth: Math.floor(l.donated / DONATION_PER_LINE) * w.fiveHundredDonated },
    { label: 'clubs that reached ten', count: l.clubs, worth: l.clubs * w.club },
  ];
  return rows.filter((r) => r.count > 0);
}

function pushOnce(list: string[], key: string): boolean {
  if (list.includes(key)) return false;
  list.push(key);
  return true;
}

/**
 * Donations reach the ledger through the Treasury's own book, so nothing is
 * counted twice and nothing has to be counted anywhere else. Only hours that
 * are wholly past are read, because the current hour is still being lived.
 */
export function readDonations(world: World): void {
  const s = standingState(world);
  const upTo = world.tick - 1;
  if (upTo <= s.donationsTick) return;
  for (const entry of world.treasury.ledger) {
    if (entry.tick <= s.donationsTick || entry.tick > upTo) continue;
    if (entry.kind !== 'donation') continue;
    const giver = world.citizens[entry.from];
    if (!giver) continue;
    contributionLedger(world, giver.id).donated += Math.max(0, Math.round(entry.amount));
  }
  s.donationsTick = upTo;
}

/**
 * The morning's tally of what a citizen has built. Every line is read off the
 * public record; every line, once counted, stays counted — a business that
 * later fails, a club that later shrinks and an office later lost do not take
 * back the years that were served.
 */
export function accrueContribution(world: World, c: Citizen): ContributionLedger {
  const l = contributionLedger(world, c.id);
  const g = world.government;

  // A ward the register watched grow up receives the baseline on the day it
  // happens; a citizen it first met as an adult is judged on the record.
  if (c.lifeStage === 'child') l.sawAsChild = true;
  else if (l.sawAsChild && l.adultSinceDay === null) l.adultSinceDay = world.day;

  // Office: a cycle on the Council pays once, and the Mayor's chair pays more.
  if (g.council.includes(c.id) || g.mayorId === c.id) {
    if (l.lastCycleCounted !== g.cycle) {
      l.lastCycleCounted = g.cycle;
      if (g.mayorId === c.id) l.mayorCycles += 1;
      else l.councilCycles += 1;
    }
  }

  // A judge's term counts when it is completed, never when it is cut short.
  if (g.judges.includes(c.id) && c.judgeTermEndsDay !== null) l.judgeTermEnd = c.judgeTermEndsDay;
  else if (l.judgeTermEnd !== null) {
    if (world.day >= l.judgeTermEnd) l.judgeTerms += 1;
    l.judgeTermEnd = null;
  }

  l.shifts = Math.max(l.shifts, Math.max(0, Math.floor(c.stats?.shiftsWorked ?? 0)));

  for (const b of Object.values(world.businesses)) {
    if (b.ownerId !== c.id) continue;
    const lastDay = b.dissolvedDay ?? world.day;
    if (lastDay - b.foundedDay < BUSINESS_SURVIVAL_DAYS) continue;
    if (pushOnce(l.countedBusinesses, b.id)) l.businesses += 1;
  }

  for (const work of Object.values(world.works ?? {})) {
    if (work.creatorId !== c.id || !work.inMuseum) continue;
    if (pushOnce(l.countedWorks, work.id)) l.museum += 1;
  }

  for (const other of Object.values(world.citizens)) {
    if (other.mentorId !== c.id) continue;
    const mastered = Object.values(other.skills).some((v) => v >= MASTER_SKILL);
    if (mastered && pushOnce(l.countedMentees, other.id)) l.mentored += 1;
  }

  for (const childId of c.family?.children ?? []) {
    const kid = world.citizens[childId];
    if (!kid || kid.lifeStage === 'child') continue;
    if (pushOnce(l.countedChildren, childId)) l.children += 1;
  }

  for (const club of Object.values(world.clubs ?? {})) {
    if (club.founderId !== c.id || club.members.length < CLUB_OF_TEN) continue;
    if (pushOnce(l.countedClubs, club.id)) l.clubs += 1;
  }

  return l;
}

