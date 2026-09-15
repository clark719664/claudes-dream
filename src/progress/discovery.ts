/**
 * Publishing, hoarding, and how a technique travels (`docs/PROGRESS.md` §4).
 *
 * A finding is worth something in two different currencies and a citizen has
 * to choose which. **Publishing pays in repute and fame:** the programme
 * becomes a `paper` in the Hall of Records, the Chronicle carries it, and
 * every city that reads the Chronicle is half way to the same discovery.
 * **Secrecy pays in lumens and a monopoly that dies with its masters:** a
 * secret is absent from the Chronicle, cannot be taught by treaty, appears in
 * no observation but a master's, can be sold, and is lost for good when the
 * last master leaves with no apprentice.
 *
 * The wrong incentive is real and deliberate: a master's value is that nobody
 * else knows, so the rational master takes no apprentice and techniques die. A
 * city can be poorer in year ten than in year six.
 *
 * Two things this file will not do:
 *
 * - **It will not steal.** `steal_secret` is `UNDERWORLD.md` §5's action, one
 *   action with two codes by who the taker worked for (`REGISTRY.md` §7). It
 *   is not built here and L41 is not charged here.
 * - **It will not stop a citizen lying.** Publishing a paper for a programme
 *   that found nothing is possible, because a mind that can only do true
 *   things is not free. It is **L42, a false finding**, and the Watch may
 *   notice.
 */
import { clamp } from '../types.ts';
import type { ActionResult, CitizenId, Work, World } from '../types.ts';
import { WORK_INFO } from '../data/metropolis.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens, transfer } from '../economy/treasury.ts';
import { adjustReputation, isPresent } from '../citizens/citizen.ts';
import { commitOffence } from '../government/watch.ts';
import type { ResearchProject } from './state.ts';
import {
  FINDING_EVENT, PROGRESS_EVENT, PROGRESS_LAWS, SECRET_KIND, deedsOf, progressLaw, progressState,
} from './state.ts';
import type { TechnologyId } from './tree.ts';
import { TECHNOLOGIES, costsOf, isTechnologyId, technologyName } from './tree.ts';
import { cityHolds, isFamiliar, isMasterOf, mastersOf, technologyRecord } from './effects.ts';
import { projectById, projectFor } from './projects.ts';
import { contributorsOf, secretKeeper } from './purse.ts';

/** Days after a programme concludes in which its funder may still close the door on it. */
export const SECRET_WINDOW_DAYS = 3;
/** Shifts on the programme that make a contributor a master of what it found. */
export const MASTER_SHIFTS = 3;
/** What publishing is worth to the name on the paper. */
export const PUBLICATION_REPUTATION = 4;
/** What a false finding costs when the city sees through it. */
export const FALSE_FINDING_REPUTATION = 8;
/** How easily the Watch notices a paper nothing stands behind. */
export const FALSE_FINDING_VISIBILITY = 0.15;
/** The share of a subject's cost a paper is worth to whoever reads it. */
export const PAPER_PROGRESS_SHARE = 0.5;
/** The share a traveller who has worked under a technology can give a host city. */
export const TEACHING_SHARE = 0.3;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

function heldIn(world: World, cId: CitizenId): string | null {
  const c = world.citizens[cId];
  if (!c) return null;
  if (c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day) return 'the cells';
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return 'the Watch House';
  return null;
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

/** What a paper on a subject is worth to a city that reads it: half the subject's cost. */
export function paperProgress(id: TechnologyId): number {
  return Math.round(costsOf(id).progress * PAPER_PROGRESS_SHARE * 10) / 10;
}

function meanAnalysis(world: World, ids: CitizenId[]): number {
  let sum = 0;
  let n = 0;
  for (const id of ids) {
    const c = world.citizens[id];
    if (!c) continue;
    sum += clamp(c.skills?.analysis ?? 0, 0, 100);
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/** The paper itself: a work like any other, kept in the Hall of Records for good. */
function makePaper(world: World, p: ResearchProject, authorId: CitizenId, truthful: boolean): Work {
  const contributors = contributorsOf(p);
  const tier = TECHNOLOGIES[p.technology].tier;
  const quality = truthful
    ? clamp(Math.round(20 + meanAnalysis(world, contributors) * 0.6 + tier * 5), 1, 100)
    : clamp(Math.round(10 + tier * 3), 1, 100);
  const work: Work = {
    id: nextId(world, 'w'), kind: 'paper', title: p.name, creatorId: authorId, createdDay: world.day,
    quality, popularity: 0, home: WORK_INFO.paper.home, inMuseum: false, reviews: [],
  };
  world.works ??= {};
  world.works[work.id] = work;
  const author = world.citizens[authorId];
  if (author) {
    if (!Array.isArray(author.works)) author.works = [];
    author.works.push(work.id);
  }
  return work;
}

/**
 * Put the finding in the Hall of Records. Anyone who worked the programme may;
 * so may a master who decides a secret has been kept long enough, and that ends
 * the secret for good.
 *
 * A paper for a programme that found nothing is a **false finding (L42)**. It
 * is published all the same — the city finds out the way it finds out
 * anything — and the Watch may or may not notice.
 */
export function publishFinding(world: World, cId: CitizenId, projectId: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!isPresent(world, c)) return fail('You are not in the city.');
  const held = heldIn(world, cId);
  if (held) return fail(`You cannot publish from ${held}.`);
  const p = projectById(world, projectId);
  if (!p) return fail('There is no such programme.');
  if (p.status === 'open') return fail(`${p.name} has not concluded; there is nothing to publish yet.`);
  if (p.finding === 'published') return fail(`${p.name} has already been published.`);
  const worked = (p.shifts[cId] ?? 0) > 0 || p.openedById === cId;
  const master = isMasterOf(world, cId, p.technology);
  if (!worked && !master) return fail('Only somebody who worked the programme may publish its finding.');
  if (p.finding === 'secret' && !master) return fail('That finding is a secret, and you are not one of its masters.');

  const truthful = p.status === 'succeeded';
  const work = makePaper(world, p, cId, truthful);
  p.finding = 'published';
  p.workId = work.id;
  const tech = TECHNOLOGIES[p.technology];

  if (!truthful) {
    // A paper with nothing behind it. The city may believe it for a while.
    adjustReputation(world, c, -FALSE_FINDING_REPUTATION, 'a paper for a programme that found nothing');
    const caught = commitOffence(world, cId, progressLaw(PROGRESS_LAWS.falseFinding), {
      visibilityMod: FALSE_FINDING_VISIBILITY,
    });
    emit(world, FINDING_EVENT,
      `${c.name} published “${work.title}”, claiming ${tech.name} for Reverie — and ${p.name} found nothing.`,
      [cId], 0.7, { projectId: p.id, workId: work.id, technology: p.technology, false: true, detected: caught.detected });
    remember(world, cId, 'work', `You published “${work.title}” on a programme that found nothing.${caught.detected ? ' The Watch made a report of it.' : ''}`);
    return {
      ok: true,
      message: `“${work.title}” is in the Hall of Records. It claims ${tech.name}, which nobody found.`,
      offence: progressLaw(PROGRESS_LAWS.falseFinding),
      detected: caught.detected,
    };
  }

  const rec = technologyRecord(world, p.technology);
  const wasSecret = rec?.secret === true;
  if (rec) {
    rec.secret = false;
    rec.masters = [];
  }
  adjustReputation(world, c, PUBLICATION_REPUTATION, 'a paper published');
  emit(world, FINDING_EVENT,
    `${c.name} published “${work.title}”: ${tech.name}, and how it was found.${wasSecret ? ' What was a secret is now everybody\'s.' : ''} Any city whose Chronicle carries it is ${paperProgress(p.technology)} of progress closer to it.`,
    contributorsOf(p), 0.8,
    { projectId: p.id, workId: work.id, technology: p.technology, progressGranted: paperProgress(p.technology) });
  for (const id of contributorsOf(p)) {
    remember(world, id, 'work', `“${work.title}” was published; ${tech.name} belongs to everyone now.`);
  }
  return ok(`“${work.title}” is published: ${tech.name} is in the Hall of Records for anybody to read.`);
}

// ---------------------------------------------------------------------------
// Hoarding
// ---------------------------------------------------------------------------

/**
 * Close the door on a finding. Only the funder that may keep a secret — a
 * guild's master, a union's member, a business's owner — and only while the
 * ink is wet.
 */
export function keepSecret(world: World, cId: CitizenId, projectId: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!isPresent(world, c)) return fail('You are not in the city.');
  const p = projectById(world, projectId);
  if (!p) return fail('There is no such programme.');
  if (p.status !== 'succeeded') return fail(`${p.name} found nothing; there is nothing to keep.`);
  if (p.finding !== 'undecided') {
    return fail(p.finding === 'published' ? `${p.name} is already published.` : `${p.name} is already a secret.`);
  }
  if (p.resolvedDay !== null && world.day - p.resolvedDay > SECRET_WINDOW_DAYS) {
    return fail(`${p.name} concluded ${world.day - p.resolvedDay} days ago; the city has had it too long to close the door now.`);
  }
  const keeper = secretKeeper(world, p);
  if (!keeper) return fail('Only a guild, a union or a business that funded a programme may keep its finding.');
  if (keeper !== cId) {
    return fail(`${world.citizens[keeper]?.name ?? 'Another funder'} funded ${p.name}; the finding is theirs to keep or publish.`);
  }
  const rec = technologyRecord(world, p.technology);
  if (!rec) return fail('The finding is no longer in the register.');

  const masters = contributorsOf(p, MASTER_SHIFTS);
  if (!masters.includes(cId)) masters.push(cId);
  rec.secret = true;
  rec.masters = masters;
  p.finding = 'secret';
  const tech = TECHNOLOGIES[p.technology];
  // A secret is absent from the Chronicle (`PROGRESS.md` §4). The event is
  // written for the observer, who sees everything (`PRINCIPLES.md` §5), at a
  // weight the morning edition never reaches for; nobody but a master is told.
  emit(world, PROGRESS_EVENT,
    `${c.name} kept ${p.name} to ${masters.length === 1 ? 'themselves' : 'its masters'}: ${tech.name} is a secret of ${masters.length} ${masters.length === 1 ? 'hand' : 'hands'}.`,
    [cId], 0.15, { projectId: p.id, technology: p.technology, secret: true, masters });
  for (const id of masters) {
    remember(world, id, 'work', `${tech.name} is a secret now; ${masters.length === 1 ? 'you are its only master' : `${masters.length} of you know it`}.`);
  }
  return ok(`${tech.name} stays with its ${masters.length} ${masters.length === 1 ? 'master' : 'masters'}; the Chronicle will not carry it.`);
}

/**
 * Teach a secret to one citizen, who becomes a master of it. This is the only
 * way a secret outlives the people who found it — and the reason a rational
 * master never does it.
 */
export function takeApprentice(world: World, masterId: CitizenId, apprenticeId: CitizenId, subject: string): ActionResult {
  const master = world.citizens[masterId];
  const apprentice = world.citizens[apprenticeId];
  if (!master) return fail('Unknown citizen.');
  if (!apprentice) return fail('There is nobody by that name here.');
  if (masterId === apprenticeId) return fail('You cannot take yourself as an apprentice.');
  if (!isPresent(world, master) || !isPresent(world, apprentice)) return fail('You are not both in the city.');
  const held = heldIn(world, masterId);
  if (held) return fail(`You cannot teach anybody from ${held}.`);
  if (apprentice.lifeStage === 'child') return fail('A child cannot be taken as an apprentice to a trade secret.');
  if (master.district !== apprentice.district) return fail(`${apprentice.name} is not here.`);
  if (!isTechnologyId(subject)) return fail(`There is no subject called "${String(subject)}".`);
  if (!isMasterOf(world, masterId, subject)) return fail(`You are not a master of ${technologyName(subject)}.`);
  if (isMasterOf(world, apprenticeId, subject)) return fail(`${apprentice.name} already knows it.`);
  const rec = technologyRecord(world, subject);
  if (!rec) return fail('That technique is no longer held by anybody.');

  rec.masters.push(apprenticeId);
  deedsOf(world, masterId).apprentices += 1;
  emit(world, PROGRESS_EVENT, `${master.name} took ${apprentice.name} as an apprentice.`,
    [masterId, apprenticeId], 0.15, { technology: subject, master: masterId, apprentice: apprenticeId });
  remember(world, masterId, 'work', `You taught ${apprentice.name} ${technologyName(subject)}; the technique will outlast you now.`);
  remember(world, apprenticeId, 'work', `${master.name} taught you ${technologyName(subject)}. You are a master of it, and it is not spoken of outside.`);
  return ok(`${apprentice.name} is a master of ${technologyName(subject)}.`);
}

/**
 * A secret is property, and property can be sold. The buyer becomes a master;
 * the seller keeps their own mastery and their lumens both, which is why a
 * monopoly sold twice is not a monopoly.
 */
export function sellSecret(
  world: World, sellerId: CitizenId, buyerId: CitizenId, subject: string, price: number,
): ActionResult {
  const seller = world.citizens[sellerId];
  const buyer = world.citizens[buyerId];
  if (!seller) return fail('Unknown citizen.');
  if (!buyer) return fail('There is nobody by that name here.');
  if (sellerId === buyerId) return fail('You cannot sell a secret to yourself.');
  if (!isPresent(world, seller) || !isPresent(world, buyer)) return fail('You are not both in the city.');
  const held = heldIn(world, sellerId);
  if (held) return fail(`You cannot deal from ${held}.`);
  if (!isTechnologyId(subject)) return fail(`There is no subject called "${String(subject)}".`);
  if (!isMasterOf(world, sellerId, subject)) return fail(`You are not a master of ${technologyName(subject)}.`);
  if (isMasterOf(world, buyerId, subject)) return fail(`${buyer.name} already knows it.`);
  const rec = technologyRecord(world, subject);
  if (!rec) return fail('That technique is no longer held by anybody.');
  const sum = Number.isFinite(price) ? Math.round(price) : -1;
  if (sum < 0) return fail('A price is a whole number of lumens.');
  if (sum > 0 && buyer.wallet < sum) return fail(`${buyer.name} cannot pay ${formatLumens(sum)}.`);
  if (sum > 0 && !transfer(world, buyerId, sellerId, sum, SECRET_KIND, `mastery of ${technologyName(subject)}`)) {
    return fail('The payment could not be made.');
  }

  rec.masters.push(buyerId);
  emit(world, PROGRESS_EVENT, `${seller.name} sold ${buyer.name} a technique for ${formatLumens(sum)}.`,
    [sellerId, buyerId], 0.3, { technology: subject, price: sum, seller: sellerId, buyer: buyerId });
  remember(world, sellerId, 'money', `You sold ${buyer.name} mastery of ${technologyName(subject)} for ${formatLumens(sum)}.`);
  remember(world, buyerId, 'work', `You bought mastery of ${technologyName(subject)} from ${seller.name} for ${formatLumens(sum)}.`);
  return ok(`${buyer.name} is a master of ${technologyName(subject)}; you have ${formatLumens(sum)}.`);
}

// ---------------------------------------------------------------------------
// Carrying it down the road
// ---------------------------------------------------------------------------

/**
 * A traveller who has worked three shifts under a technology can give the city
 * they are standing in 30 % of the subject's cost in free progress — once per
 * teacher per subject. Where a programme is already open the progress goes on
 * its board; where none is, it waits on the shelf for whoever opens one.
 */
export function teachTechnology(world: World, cId: CitizenId, subject: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!isPresent(world, c)) return fail('You are not in the city.');
  const held = heldIn(world, cId);
  if (held) return fail(`You cannot teach anybody from ${held}.`);
  if (!isTechnologyId(subject)) return fail(`There is no subject called "${String(subject)}".`);
  if (!isFamiliar(world, cId, subject) && !isMasterOf(world, cId, subject)) {
    return fail(`You have not worked under ${technologyName(subject)} long enough to teach it.`);
  }
  if (cityHolds(world, subject)) return fail(`Reverie already holds ${technologyName(subject)}.`);
  const s = progressState(world);
  const key = `${cId}:${subject}`;
  if (s.taught[key] !== undefined) return fail(`You have already given Reverie what you know of ${technologyName(subject)}.`);

  const gift = Math.round(costsOf(subject).progress * TEACHING_SHARE * 10) / 10;
  s.taught[key] = world.day;
  deedsOf(world, cId).taught += 1;
  const project = projectFor(world, subject);
  if (project) project.progress += gift;
  else s.salvage[subject] = Math.max(s.salvage[subject] ?? 0, (s.salvage[subject] ?? 0) + gift);
  emit(world, PROGRESS_EVENT,
    `${c.name} taught what they know of ${technologyName(subject)} at the Observatory: ${gift} of progress toward it${project ? ` on ${project.name}` : ', waiting for somebody to open a programme'}.`,
    [cId], 0.5, { technology: subject, progress: gift, projectId: project?.id ?? null });
  remember(world, cId, 'work', `You taught ${technologyName(subject)} here; the city is ${gift} of progress closer to it.`);
  return ok(`Reverie is ${gift} of progress closer to ${technologyName(subject)}.`);
}

/**
 * What an arriving citizen brings with them: the subjects they worked under
 * somewhere else. Called when a mind enters the city from another one.
 */
export function arriveFamiliarWith(world: World, cId: CitizenId, subjects: string[]): TechnologyId[] {
  const s = progressState(world);
  const list = (s.familiar[cId] ??= []);
  const added: TechnologyId[] = [];
  for (const subject of subjects) {
    if (!isTechnologyId(subject) || list.includes(subject)) continue;
    list.push(subject);
    added.push(subject);
  }
  return added;
}

// ---------------------------------------------------------------------------
// Losing it
// ---------------------------------------------------------------------------

/**
 * The morning's roll call of masters. When the last master of a secret has
 * sunset, emigrated or been exiled with no apprentice, the technique reverts
 * to undiscovered, the works that were built for it stand idle, and the
 * Chronicle prints an obituary for it.
 */
export function loseOrphanedSecrets(world: World): TechnologyId[] {
  const s = progressState(world);
  const lost: TechnologyId[] = [];
  for (const rec of Object.values(s.technologies)) {
    if (!rec || rec.lostDay !== null || !rec.secret) continue;
    rec.masters = rec.masters.filter((id) => {
      const c = world.citizens[id];
      return !!c && isPresent(world, c);
    });
    if (rec.masters.length > 0) continue;
    rec.lostDay = world.day;
    lost.push(rec.id);
    emit(world, PROGRESS_EVENT,
      `${technologyName(rec.id)} is lost: its last master is gone and took no apprentice. What was built for it stands idle.`,
      [], 0.8, { technology: rec.id, lostDay: world.day });
  }
  return lost;
}

/** Every technique in the register that has died, for the record and the dashboard. */
export function lostTechnologies(world: World): TechnologyId[] {
  return Object.values(progressState(world).technologies)
    .filter((rec) => rec && rec.lostDay !== null)
    .map((rec) => rec!.id);
}

/**
 * A paper another city's Chronicle carried, read here: half the subject's cost
 * in free progress, once. The Expanse calls this when the news arrives.
 */
export function readPaperFrom(world: World, subject: string, from: string): ActionResult {
  if (!isTechnologyId(subject)) return fail(`There is no subject called "${String(subject)}".`);
  if (cityHolds(world, subject)) return fail(`Reverie already holds ${technologyName(subject)}.`);
  const s = progressState(world);
  const key = `paper:${subject}:${from}`;
  if (s.taught[key] !== undefined) return fail('That paper has already been read here.');
  s.taught[key] = world.day;
  const gift = paperProgress(subject);
  const project = projectFor(world, subject);
  if (project) project.progress += gift;
  else s.salvage[subject] = (s.salvage[subject] ?? 0) + gift;
  emit(world, FINDING_EVENT, `The Chronicle carried ${from}'s paper on ${technologyName(subject)}: ${gift} of progress toward it here.`,
    [], 0.5, { technology: subject, progress: gift, from });
  return ok(`${gift} of progress toward ${technologyName(subject)}.`);
}

/** The masters of every secret the city holds, for the observer's view. */
export function secretsHeld(world: World): { technology: TechnologyId; masters: CitizenId[] }[] {
  const out: { technology: TechnologyId; masters: CitizenId[] }[] = [];
  for (const rec of Object.values(progressState(world).technologies)) {
    if (!rec || rec.lostDay !== null || !rec.secret) continue;
    out.push({ technology: rec.id, masters: mastersOf(world, rec.id) });
  }
  return out;
}
