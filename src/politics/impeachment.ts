/**
 * Impeachment — removal for conduct in office (`docs/POLITICS.md` §4).
 *
 * Articles are brought by two councillors or by a petition of the share of the
 * franchise the charter asks for. They must name conduct in office: enriching
 * self out of it, directing the Watch at a rival, refusing a duty the charter
 * imposes, taking a payment, or defying a ratified referendum or a Court order.
 *
 * The hearing takes one day at the Courthouse at tick 12 — the Court's second
 * sitting. The Court presides; the tribunal the charter names votes, in public,
 * and the accused never votes on their own articles.
 *
 * | Officer | Tribunal | Threshold |
 * | Councillor | the rest of the Council | 0.8 of the whole body |
 * | Mayor | the Council | 0.8 |
 * | Judge | the other judges **and** the Council together | 0.8 of the combined body |
 * | Watch Captain | the Council | simple majority |
 *
 * On removal the seat is vacated, the officer is barred for `barDays`, and the
 * unfinished term pays nothing to contribution. On acquittal the bringers lose
 * standing, and an officer cleared twice on the same article in a cycle cannot
 * be charged on it again that cycle — without that rule a hostile council
 * impeaches every session and governs by hearing.
 */
import { clamp } from '../types.ts';
import type { ActionResult, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { adjustReputation, isPresent } from '../citizens/citizen.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { nextId } from '../util/ids.ts';
import { isCouncillor } from '../government/council.ts';
import { charterOf, franchiseThreshold, inFranchise } from './charter.ts';
import { approvalOfOffice } from './approval.ts';
import type { Impeachment, ImpeachmentArticle } from './accountability.ts';
import {
  IMPEACHMENT_ARTICLES, accountability, announceRemoval, barFromOffice, denyCycleCredit,
  impeachmentNeeded, officeOf, tribunalFor, vacateOffice,
} from './accountability.ts';

/** What bringing articles that fail costs the people who brought them. */
export const FAILED_ARTICLES_REPUTATION = 3;
/** A charge is laid when this many councillors have signed it. */
export const COUNCILLOR_BRINGERS = 2;

function fail(message: string): ActionResult { return { ok: false, message }; }

function acquittalKey(officerId: CitizenId, article: string, cycle: number): string {
  return `impeach:acquitted:${officerId}:${article}:${cycle}`;
}

/**
 * Has this officer already been cleared twice on this article this cycle? The
 * double-jeopardy bar is a public fact — every acquittal was a named vote the
 * Chronicle printed — so anybody weighing whether to bring articles can read
 * it, and `impeach` refuses where it is true.
 */
export function clearedTwice(world: World, officerId: CitizenId, article: string): boolean {
  return (world.counters[acquittalKey(officerId, article, world.government.cycle)] ?? 0) >= 2;
}

/**
 * Bring articles of impeachment, or add your name to articles already brought.
 * Two councillors lay a charge between them; anybody else needs the share of
 * the franchise the charter asks for.
 */
export function impeach(
  world: World, cId: CitizenId, officerId: CitizenId, article: ImpeachmentArticle, evidence = 0.5,
): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (!inFranchise(world, c)) return fail('Only somebody the charter counts may bring articles of impeachment.');
  if (cId === officerId) return fail('You cannot impeach yourself.');
  const officer = world.citizens[officerId];
  if (!officer) return fail('Nobody by that id lives in Reverie.');
  const office = officeOf(world, officerId);
  if (!office) return fail(`${officer.name} holds no office to be removed from.`);
  if (!IMPEACHMENT_ARTICLES[article]) {
    return fail(`An article must name conduct in office: ${Object.keys(IMPEACHMENT_ARTICLES).join(', ')}.`);
  }
  const g = world.government;
  if ((world.counters[acquittalKey(officerId, article, g.cycle)] ?? 0) >= 2) {
    return fail(`${officer.name} has been cleared twice on that article this cycle; it cannot be brought again until the next.`);
  }
  const book = accountability(world);
  const open = book.impeachments.find(
    (x) => x.officerId === officerId && x.article === article && (x.result === 'gathering' || x.result === 'laid'),
  );
  const clean = clamp(Number.isFinite(evidence) ? evidence : 0.5, 0, 1);
  if (open) {
    if (open.broughtBy.includes(cId)) return fail('Your name is already on those articles.');
    open.broughtBy.push(cId);
    open.evidence = Math.max(open.evidence, clean);
    return layCharge(world, open);
  }
  const im: Impeachment = {
    id: nextId(world, 'i'), officerId, office, article, evidence: clean,
    broughtBy: [cId], laidDay: null, hearingDay: null, votes: {}, result: 'gathering', decidedDay: null,
  };
  book.impeachments.push(im);
  emit(world, 'law', `${c.name} brought articles of impeachment against ${officer.name}: ${IMPEACHMENT_ARTICLES[article]}.`,
    [cId, officerId], 0.8, { impeachmentId: im.id, officer: officerId, article });
  remember(world, officerId, 'civic', `${c.name} brought articles of impeachment against you: ${IMPEACHMENT_ARTICLES[article]}.`);
  return layCharge(world, im);
}

/** Is the charge laid — two councillors, or the franchise's share of names? */
function layCharge(world: World, im: Impeachment): ActionResult {
  const officer = world.citizens[im.officerId];
  const councillors = im.broughtBy.filter((id) => isCouncillor(world, id)).length;
  const share = franchiseThreshold(world, charterOf(world).impeachment.chargeShare);
  const enough = councillors >= COUNCILLOR_BRINGERS || im.broughtBy.length >= share;
  if (!enough || im.result !== 'gathering') {
    return {
      ok: true,
      message: `Your name is on the articles against ${officer?.name ?? im.officerId}`
        + ` (${im.broughtBy.length} of the ${share} names, or two councillors, that lay the charge).`,
    };
  }
  im.result = 'laid';
  im.laidDay = world.day;
  im.hearingDay = world.day + 1;
  const names = im.broughtBy.map((id) => world.citizens[id]?.name ?? id).join(', ');
  emit(world, 'law', `The articles against ${officer?.name ?? im.officerId} are laid by ${names};`
    + ` the Court hears them on day ${im.hearingDay}.`, [...im.broughtBy, im.officerId], 0.9,
  { impeachmentId: im.id, officer: im.officerId, article: im.article, hearingDay: im.hearingDay });
  remember(world, im.officerId, 'civic',
    `Articles of impeachment against you were laid; the hearing is on day ${im.hearingDay}. You may answer them.`);
  return { ok: true, message: `The articles are laid; the hearing is on day ${im.hearingDay}.` };
}

/** A tribunal member's named vote. */
export function voteImpeachment(world: World, cId: CitizenId, officerId: CitizenId, guilty: boolean): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const im = accountability(world).impeachments.find((x) => x.officerId === officerId && x.result === 'laid');
  if (!im) return fail('There are no articles laid against that officer.');
  if (cId === im.officerId) return fail('The officer does not sit in judgment on their own articles.');
  if (!tribunalFor(world, im).includes(cId)) return fail('You do not sit on that tribunal.');
  im.votes[cId] = Boolean(guilty);
  const officer = world.citizens[officerId];
  emit(world, 'vote', `${c.name} voted ${guilty ? 'to remove' : 'to clear'} ${officer?.name ?? officerId}.`, [cId], 0.4,
    { impeachmentId: im.id, officer: officerId, guilty: Boolean(guilty) });
  remember(world, cId, 'civic', `You voted ${guilty ? 'to remove' : 'to clear'} ${officer?.name ?? officerId}.`);
  return { ok: true, message: `You voted ${guilty ? 'to remove' : 'to clear'} ${officer?.name ?? officerId}.` };
}

/**
 * How a scripted member of the tribunal reads the articles when the hour comes
 * and they have not voted: the evidence in front of them, what they think of
 * the office as the city does, and how they stand with the officer. A member
 * with no evidence and no view abstains, and an abstention is not an aye.
 */
export function impeachmentDisposition(world: World, cId: CitizenId, im: Impeachment): boolean | null {
  const c = world.citizens[cId];
  const officer = world.citizens[im.officerId];
  if (!c || !officer) return null;
  let score = im.evidence - 0.5;
  score -= clamp(bondBetween(world, cId, im.officerId) / 100, -1, 1) * 0.25;
  if (im.broughtBy.includes(cId)) score += 0.4;
  score += (0.5 - approvalOfOffice(world, im.officerId)) * 0.4;
  if (officer.record.convictions.length > 0) score += 0.1;
  if (Math.abs(score) < 0.05) return null;
  return score > 0;
}

/**
 * The Court's second sitting. The officer answers, the tribunal votes, and
 * every vote is named. Scripted members who never voted make their minds up
 * now; members who think for themselves and stayed silent have abstained.
 */
export function holdImpeachments(world: World): void {
  const book = accountability(world);
  for (const im of book.impeachments) {
    if (im.result !== 'laid' || im.hearingDay === null || im.hearingDay > world.day) continue;
    const officer = world.citizens[im.officerId];
    const tribunal = tribunalFor(world, im);
    if (!officer || officeOf(world, im.officerId) === null) {
      im.result = 'lapsed';
      im.decidedDay = world.day;
      emit(world, 'law', `The articles against ${officer?.name ?? im.officerId} lapsed: they hold no office to lose.`,
        [im.officerId], 0.4, { impeachmentId: im.id });
      continue;
    }
    for (const id of tribunal) {
      if (im.votes[id] !== undefined) continue;
      const member = world.citizens[id];
      if (!member || member.brain !== 'reflex') continue;
      const view = impeachmentDisposition(world, id, im);
      if (view === null) continue;
      im.votes[id] = view;
    }
    const needed = impeachmentNeeded(world, im);
    const ayes = Object.values(im.votes).filter(Boolean).length;
    const nays = Object.values(im.votes).filter((v) => !v).length;
    const named = Object.entries(im.votes)
      .map(([id, v]) => `${world.citizens[id]?.name ?? id} ${v ? 'remove' : 'clear'}`).sort();
    const removed = ayes >= needed;
    im.result = removed ? 'removed' : 'acquitted';
    im.decidedDay = world.day;

    if (removed) {
      const barDays = charterOf(world).impeachment.barDays;
      const after = vacateOffice(world, im.officerId, im.office);
      denyCycleCredit(world, im.officerId, im.office);
      barFromOffice(world, im.officerId, barDays);
      announceRemoval(world, im.officerId,
        `${officer.name} is removed from the office of ${im.office === 'watch' ? 'Watch Captain' : im.office}`
        + ` on the article of ${IMPEACHMENT_ARTICLES[im.article]} (${ayes} of ${needed}: ${named.join(', ')}). ${after}`
        + ` They are barred from office for ${barDays} days. It is not a conviction.`,
        [...tribunal, ...im.broughtBy]);
      continue;
    }

    const key = acquittalKey(im.officerId, im.article, world.government.cycle);
    world.counters[key] = (world.counters[key] ?? 0) + 1;
    const twice = world.counters[key] >= 2;
    for (const id of im.broughtBy) {
      const bringer = world.citizens[id];
      if (bringer) adjustReputation(world, bringer, -FAILED_ARTICLES_REPUTATION, 'articles of impeachment that failed');
    }
    const text = `${officer.name} is cleared on the article of ${IMPEACHMENT_ARTICLES[im.article]}`
      + ` (${ayes} of ${needed} to remove, ${nays} to clear).`
      + (twice ? ' Cleared twice on it this cycle, they cannot be charged on it again until the next.' : '');
    emit(world, 'law', text, [im.officerId, ...im.broughtBy], 0.8,
      { impeachmentId: im.id, officer: im.officerId, article: im.article, votes: named, removed: false });
    remember(world, im.officerId, 'civic', text);
    for (const id of im.broughtBy) remember(world, id, 'civic', `${text} It cost you standing to bring them.`);
  }
  const cycle = world.config?.cycleDays ?? 28;
  book.impeachments = book.impeachments.filter((im) => im.result === 'gathering' || im.result === 'laid'
    || (im.decidedDay ?? 0) > world.day - cycle);
}
