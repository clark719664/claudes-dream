/**
 * What a scripted mind does about the charter (`docs/POLITICS.md`).
 *
 * Everything here is read off a public fact about *this* citizen: a register
 * entry that has stopped being true, a body that never answered the question
 * they asked, a Council they have stopped believing in, an officeholder with
 * something on the record, a seat at a convention they were drawn for, a paper
 * whose line is nothing like their own reading of the city. A citizen with none
 * of those does none of this and the step returns null.
 *
 * Nothing in this file has an opinion about what a good charter says. A
 * disposition on a measure is the module that owns the measure's business
 * (`politics/*.ts`), consulted only for reflex members who did not vote; what
 * is here is only whether this citizen has a reason to reach for the action at
 * all (`docs/PRINCIPLES.md` §§2, 4).
 */
import type { Action, Citizen, CitizenId, World } from '../types.ts';
import { chance, pick, rand } from '../util/rng.ts';
import { characterOf } from '../citizens/character.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { charterOf, inFranchise, isEntrenched } from '../politics/charter.ts';
import { convention, isDelegate } from '../politics/convention.ts';
import { accountability } from '../politics/accountability.ts';
import { clearedTwice } from '../politics/impeachment.ts';
import { PAPER_FOUNDING_FEE, livePapers, readershipOf } from '../politics/press.ts';
import { recordsState, returnIsTrue, speaksFor } from '../politics/records.ts';
import { malapportionment } from '../politics/wards.ts';
import { DISCIPLINES, delegation, games, reputeLine } from '../politics/games.ts';
import { decidingBody, openMeasures } from '../politics/measures.ts';
import { hooksFor } from '../politics/session.ts';
import { reputeOf } from '../standing/repute.ts';
import { appealableRecord, impeachableOfficers, impeachmentsToVote, requestsToAnswer } from '../actions/execute-charter.ts';
import type { Ctx } from './reflex-util.ts';

/**
 * A question this citizen has already turned over today.
 *
 * Every branch below that is a citizen's *own motion* — a request to a body, a
 * signature, a name put forward, articles brought against an officer — is
 * weighed once a day and not once an hour. Without this a reason that is true
 * all day is acted on sixteen times: twenty-nine citizens signed the same
 * articles in one morning against a threshold of ten, and the hours came out of
 * everything else they might have done that day. What somebody is *waiting for*
 * — a request to answer, a vote to cast, an article on the floor — is not
 * guarded, because that is a duty with somebody on the other end of it.
 */
function weighedToday(world: World, key: string, cId: CitizenId): boolean {
  const k = `${key}:${cId}`;
  if (world.counters[k] === world.day) return true;
  world.counters[k] = world.day;
  return false;
}

/** Approval below which a citizen starts wondering whether the charter is the problem. */
export const DISAFFECTED = 0.5;
/** A ward scheme is worth arguing about above this much malapportionment. */
export const MALAPPORTIONED = 0.25;

// ---------------------------------------------------------------------------
// The register, and freedom of information
// ---------------------------------------------------------------------------

const SUBJECTS: readonly { body: 'council' | 'watch' | 'court' | 'treasury' | 'registry'; ask: string }[] = [
  { body: 'council', ask: 'the votes on the measures read this cycle' },
  { body: 'treasury', ask: 'what the Treasury took and spent yesterday' },
  { body: 'watch', ask: 'the reports the Watch is holding and has not filed' },
  { body: 'court', ask: 'the cases tried this cycle and how each judge voted' },
  { body: 'registry', ask: 'the register of interests as it stands today' },
];

/**
 * The register of interests, and the four bodies a citizen may ask. Filing is
 * an officeholder's duty and a return that stopped being true is what makes a
 * false return provable, so somebody who reads their own entry as stale files
 * a new one rather than wait for the three days to run.
 */
export function tryRecords(ctx: Ctx): Action | null {
  const { world, c } = ctx;

  if (ctx.can.has('declare_property') && !returnIsTrue(world, c)) {
    return { type: 'declare_property' };
  }

  // A request this citizen speaks for. Releasing is what an honest body does
  // and refusing is what a body with something in the room does; both are
  // public, and the reason a refusal gives is public too.
  if (ctx.can.has('answer_record')) {
    // A body of five all speak for it, and all five reaching for the same
    // request in the same hour is four refused actions and one answer. The
    // first name in the day's turn order answers for the body.
    const id = requestsToAnswer(world, c.id).find((rid) => {
      const r = recordsState(world).requests.find((x) => x.id === rid);
      return r ? firstSpeaker(world, r.of) === c.id : false;
    });
    const request = id ? recordsState(world).requests.find((r) => r.id === id) : null;
    if (request) {
      const asker = world.citizens[request.askedBy];
      const openness = characterOf(c).honesty * 0.7 + (asker ? bondBetween(world, c.id, asker.id) / 400 : 0);
      if (chance(world, Math.max(0.05, Math.min(0.95, openness)))) {
        return { type: 'answer_record', requestId: request.id, release: true };
      }
      // The Watch's own papers are refused for the investigation; everything
      // else a body would rather not hand over is a sealed deliberation.
      const reason = request.of === 'watch' ? 'investigation' as const : 'deliberation' as const;
      if (chance(world, 0.5)) return { type: 'answer_record', requestId: request.id, release: false, reason };
    }
  }

  // A refusal this citizen was given, and the one Court hearing it gets.
  if (ctx.can.has('appeal') && appealableRecord(world, c.id) !== null
    && chance(world, 0.25 + c.personality.ambition * 0.3)) {
    const id = appealableRecord(world, c.id);
    if (id) return { type: 'appeal', subject: id };
  }

  // And the question a citizen has a reason to ask. The reasons are all public
  // facts about them: a charge they are answering, a fine they are paying, or a
  // Council they have stopped believing in.
  if (!ctx.can.has('request_record')) return null;
  const approval = c.approval?.council ?? 0.5;
  const charged = c.record.convictions.length > 0 || c.finesOwed > 0;
  let appetite = c.personality.curiosity * 0.06;
  if (approval < DISAFFECTED) appetite += (DISAFFECTED - approval) * 0.24;
  if (charged) appetite += 0.04;
  if (weighedToday(world, 'recordAsked', c.id)) return null;
  if (!chance(world, appetite)) return null;
  const want = charged
    ? pick(world, SUBJECTS.filter((s) => s.body === 'watch' || s.body === 'court'))
    : pick(world, SUBJECTS);
  return { type: 'request_record', body: want.body, subject: want.ask };
}

/**
 * Who answers for a body this morning. Several citizens speak for the Council,
 * and a request is answered once: the first of them in the day's turn order is
 * the one who reaches for it, and the rest leave it alone.
 */
function firstSpeaker(world: World, body: 'council' | 'watch' | 'court' | 'treasury' | 'registry'): CitizenId | null {
  for (const id of world.order) if (speaksFor(world, id, body)) return id;
  return null;
}

// ---------------------------------------------------------------------------
// The convention
// ---------------------------------------------------------------------------

const SPEECHES: readonly string[] = [
  'The article as it stands is the one that put us here.',
  'Whatever we write today, somebody we have never met will be held to it.',
  'A threshold nobody can reach is the same as a door that is nailed shut.',
  'I would rather be outvoted under a rule I can read than agreed with under one I cannot.',
];

/** Signing, standing, sitting, and the seat a citizen would rather not have. */
export function tryConvention(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const v = convention(world);

  // A signature is a citizen saying the charter itself is the trouble. The
  // reasons are the public ones: a Council they have stopped believing in, a
  // record the ordinary road did not fix, or seats that do not match the city.
  if (ctx.can.has('sign_convention')) {
    const approval = c.approval?.council ?? 0.5;
    let weight = 0;
    if (approval < DISAFFECTED) weight += (DISAFFECTED - approval) * 0.5;
    if (c.record.convictions.length > 0) weight += 0.04;
    if (c.standing === 'suspended' || c.standing === 'probation') weight += 0.05;
    if (malapportionment(world) > MALAPPORTIONED) weight += 0.06;
    // An article the amending body may not reach is the one reason a convention
    // exists at all, and everybody can read which they are.
    if (charterOf(world).entrenched.length > 0) weight += 0.03;
    if (weight > 0 && !weighedToday(world, 'conventionWeighed', c.id)
      && chance(world, Math.min(0.6, weight * 3))) return { type: 'sign_convention' };
  }

  if (ctx.can.has('stand_delegate') && c.personality.ambition > 0.5 && c.reputation >= 45
    && !weighedToday(world, 'delegacyWeighed', c.id)
    && chance(world, 0.4 + c.personality.ambition * 0.3)) {
    return { type: 'stand_delegate' };
  }
  // A ballot is open and this citizen is in the franchise: the same reading a
  // Council ballot gets — who they know, and who the city thinks well of.
  if (ctx.can.has('vote') && v.state === 'delegates' && !v.ballots[c.id] && v.standing.length > 0) {
    const best = v.standing
      .map((id) => world.citizens[id])
      .filter((o): o is Citizen => Boolean(o))
      .sort((a, b) => (bondBetween(world, c.id, b.id) + b.reputation) - (bondBetween(world, c.id, a.id) + a.reputation))[0];
    if (best) return { type: 'vote', candidate: best.id };
  }
  // A seat is a week of hours. Somebody with a shift, a household and no
  // appetite for the floor gives it back and the next name is drawn.
  if (ctx.can.has('refuse') && v.delegates.includes(c.id) && c.personality.ambition < 0.3
    && ctx.job !== null && !weighedToday(world, 'delegacyRefused', c.id) && chance(world, 0.5)) {
    return { type: 'refuse', duty: 'delegate', ground: 'I have a shift and a household; let somebody else sit.' };
  }

  if (!isDelegate(world, c.id) || v.state !== 'sitting') return null;
  // On the floor: the articles in front of them first, because absence is a no
  // and an article nobody votes on falls.
  const open = v.articles.filter((a) => a.result === 'open' && a.votes[c.id] === undefined);
  if (ctx.can.has('vote_article') && open.length > 0) {
    const article = open[0];
    // What the edit would do to *them*: an article that narrows who counts, or
    // strikes a right they are standing on, reads differently from one that
    // does not. Everything else is the mover, and what the city thinks of them.
    const mover = world.citizens[article.movedBy];
    let aye = 0.45 + (mover ? bondBetween(world, c.id, mover.id) / 300 : 0);
    if (article.edit.article === 'franchise' && article.edit.value !== 'all') aye -= 0.3;
    if (article.edit.article === 'rights') aye += 0.15;
    if (article.edit.article === 'term' && Number(article.edit.value) === 0) aye -= 0.35;
    return { type: 'vote_article', articleId: article.id, aye: chance(world, Math.max(0.05, Math.min(0.95, aye))) };
  }
  // A delegate with nothing before them, and something they have read wrong
  // with the charter all week: the entrenchment nobody else may touch.
  if (ctx.can.has('move_article') && !v.articles.some((a) => a.result === 'open' && a.movedBy === c.id)
    && !weighedToday(world, 'articleWeighed', c.id) && chance(world, 0.4)) {
    const onFloor = (article: string, field: string | null) => v.articles.some(
      (a) => a.result === 'open' && a.edit.article === article && (a.edit.field ?? null) === field,
    );
    const rights = [...charterOf(world).rights];
    if (!rights.includes('shield') && characterOf(c).honesty > 0.5 && !onFloor('rights', null)) {
      return {
        type: 'move_article', article: 'rights', value: [...rights, 'shield'],
        words: 'A journalist who will not name a source should not answer for it in a cell.',
      };
    }
    if (!charterOf(world).recall.allowed && !onFloor('recall', 'allowed')) {
      return {
        type: 'move_article', article: 'recall', field: 'allowed', value: true,
        words: 'If we cannot take an office back before the term runs, the term is the whole of the answer.',
      };
    }
  }
  if (ctx.can.has('speak_convention') && c.skills.rhetoric >= 35
    && !weighedToday(world, 'speechWeighed', c.id) && chance(world, 0.5)) {
    return { type: 'speak_convention', text: pick(world, SPEECHES) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Removing an officer
// ---------------------------------------------------------------------------

/** Why this citizen would bring articles against this officer, or null. */
function articleAgainst(world: World, c: Citizen, officerId: CitizenId): 'enrichment' | 'direction' | 'duty' | 'payment' | null {
  const officer = world.citizens[officerId];
  if (!officer) return null;
  // Everything below is on a public register somebody can read for themselves.
  if (officer.record.convictions.some((k) => k.law === 'L09')) return 'payment';
  if (officer.record.convictions.some((k) => k.severity >= 3)) return 'enrichment';
  if (world.government.watchCaptainId === officerId
    && world.counters[`assigned:${c.id}`] !== undefined) return 'direction';
  if (!returnIsTrue(world, officer) && world.counters[`register:stale:${officerId}`] !== undefined) return 'enrichment';
  return null;
}

/** Articles brought, and the tribunal's named vote on them. */
export function tryAccountability(ctx: Ctx): Action | null {
  const { world, c } = ctx;

  // A vote this citizen was put on. The evidence is in front of them and so is
  // everything they know of the officer; both go into it, and the vote is named.
  if (ctx.can.has('vote_impeachment')) {
    const officerId = impeachmentsToVote(world, c.id)[0];
    const im = officerId
      ? accountability(world).impeachments.find((x) => x.officerId === officerId && x.result === 'laid')
      : null;
    if (im) {
      const bond = bondBetween(world, c.id, im.officerId) / 200;
      const belief = im.evidence + (1 - characterOf(c).honesty) * 0.05 - bond + rand(world) * 0.1 - 0.05;
      return { type: 'vote_impeachment', officer: im.officerId, guilty: belief > 0.55 };
    }
  }

  if (!ctx.can.has('impeach')) return null;
  if (!inFranchise(world, c)) return null;
  if (weighedToday(world, 'officeWeighed', c.id)) return null;
  const book = accountability(world).impeachments;
  for (const officerId of impeachableOfficers(world, c.id)) {
    const article = articleAgainst(world, c, officerId);
    if (!article) continue;
    // A name already on these articles is on them; adding it twice is nothing.
    if (book.some((x) => x.officerId === officerId && x.article === article
      && (x.result === 'gathering' || x.result === 'laid') && x.broughtBy.includes(c.id))) continue;
    // And an officer the tribunal has cleared twice on this article cannot be
    // brought again until the next cycle. That is a public fact — two named
    // votes the Chronicle printed — so a citizen weighing the article knows it
    // without spending the hour being told: 408 of seed 7's 700 attempts were
    // citizens re-bringing an article the tribunal had already twice refused.
    if (clearedTwice(world, officerId, article)) continue;
    const bond = bondBetween(world, c.id, officerId);
    if (bond > 30) continue;
    // Bringing articles that fail costs the people who brought them, so it is
    // not free and it is not common.
    if (!chance(world, 0.12 + c.personality.ambition * 0.15)) continue;
    return { type: 'impeach', officer: officerId, article, evidence: 0.5 + rand(world) * 0.3 };
  }
  // And the petition the charter may or may not allow.
  if (ctx.can.has('sign_recall') && charterOf(world).recall.allowed) {
    const worst = impeachableOfficers(world, c.id)
      .map((id) => world.citizens[id])
      .filter((o): o is Citizen => Boolean(o))
      .sort((a, b) => a.reputation - b.reputation)[0];
    if (worst && (c.approval?.mayor ?? 0.5) < 0.4 && chance(world, 0.3)) {
      return { type: 'sign_recall', officer: worst.id };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The order paper: what a member of the body moves, and why
// ---------------------------------------------------------------------------

/**
 * A measure on the charter's own order paper. Every branch is a reading of
 * something in front of this councillor today: the seats against the city's
 * districts, the paper that has been printing about them, an entry of their own
 * that keeps going stale, and the threshold their last article died at.
 */
export function tryCharterMeasure(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('propose')) return null;
  const g = world.government;
  if (!g.council.includes(c.id) && g.mayorId !== c.id) return null;
  if (openMeasures(world).some((m) => m.proposerId === c.id)) return null;
  const ch = charterOf(world);
  const strict = c.platform?.strictness ?? 0.5;

  // A measure already on the paper that this citizen sits in the body for.
  // How it reads is the owning module's own business, and a member with
  // nothing to read on the question abstains rather than fills in a number.
  if (ctx.can.has('vote_proposal')) {
    const pending = openMeasures(world).find(
      (m) => m.votes[c.id] === undefined && decidingBody(world, m.kind).includes(c.id),
    );
    if (pending) {
      const view = hooksFor(pending.kind)?.disposition?.(world, c.id, pending);
      if (view !== null && view !== undefined) return { type: 'vote_proposal', proposalId: pending.id, aye: view };
    }
  }

  // Everything below is this councillor's own motion rather than an answer
  // somebody is waiting for, so it is weighed once in the day.
  if (weighedToday(world, 'measureWeighed', c.id)) return null;

  // Seats that no longer match where the city lives. The arithmetic is public
  // and the vote against it is one a well-served ward's own member casts.
  if (ch.wards !== 'none' && malapportionment(world) > MALAPPORTIONED && chance(world, 0.4)) {
    return {
      type: 'propose', kind: 'apportion', value: 0,
      summary: `The seats are ${Math.round(malapportionment(world) * 100)} % out against the wards; reapportion them.`,
    };
  }

  // A paper that has been printing about this councillor, and a councillor who
  // reads as strict. The measure is public, it costs standing, and it is
  // exactly the thing the charter's press right is for.
  const underScrutiny = (world.counters[`scrutiny:${c.id}`] ?? 0) > 0;
  if (underScrutiny && strict > 0.55 && chance(world, 0.35)) {
    const paper = livePapers(world).sort((a, b) => readershipOf(world, b.id) - readershipOf(world, a.id))[0];
    if (paper) {
      return {
        type: 'propose', kind: 'press_restraint', value: 3, subject: paper.id,
        summary: `Restrain ${paper.name} from printing about the conduct of this office for three days.`,
      };
    }
  }

  // An entry of their own that keeps going stale: the honest answer is to file
  // it, and the other one is to move the switch. Both are on the record.
  if (ch.transparency.register && !returnIsTrue(world, c) && characterOf(c).honesty < 0.4 && chance(world, 0.25)) {
    return {
      type: 'propose', kind: 'transparency', value: 0, subject: 'register',
      summary: 'Close the register of interests: an address is not a vote.',
    };
  }

  // An article the body may not reach is the argument for a convention, and a
  // member who has been on the losing side of the threshold makes it.
  if (ch.entrenched.length > 0 && c.personality.ambition > 0.6 && chance(world, 0.12)) {
    return {
      type: 'propose', kind: 'call_convention', value: 0,
      summary: `The Council may not reach ${ch.entrenched.join(', ')}; put the charter to a convention.`,
    };
  }

  // And an amendment, where the charter itself is what is in the way. A right
  // this council would not otherwise be able to defend is the plainest case.
  if (characterOf(c).honesty > 0.55 && !isEntrenched(world, 'press')
    && ch.rights.includes('press') && chance(world, 0.15)) {
    return {
      type: 'propose_amendment', article: 'entrenched', value: [...ch.entrenched, 'press'],
      words: 'Put the press beyond an ordinary majority.',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The papers, and the Games
// ---------------------------------------------------------------------------

const PAPER_NAMES: readonly string[] = ['The Gate', 'The Lantern', 'The Undercroft Voice', 'The Plain Word'];

/** A press of one's own, and a place on the field. */
export function tryPressAndGames(ctx: Ctx): Action | null {
  const { world, c } = ctx;

  // A paper is 300 lumens and a shopfront. The citizens who found one are the
  // ones who can talk and who read the city differently from every paper in it.
  if (ctx.can.has('found_paper') && c.wallet >= PAPER_FOUNDING_FEE + 120
    && c.skills.rhetoric >= 40 && !weighedToday(world, 'paperWeighed', c.id) && chance(world, 0.08)) {
    const mine = { tax: 0.5, dividend: 0.5, minWage: 0.5, strictness: c.platform?.strictness ?? 0.5 };
    const nearest = livePapers(world).length;
    if (nearest < 4) {
      return { type: 'found_paper', name: pick(world, PAPER_NAMES), line: mine, premises: c.district };
    }
  }

  const g = games(world);
  // The Congress's questions, for the delegation that answers them.
  if (ctx.can.has('vote_games_host') && delegation(world).includes(c.id) && !g.votes[c.id] && g.bids.length > 0) {
    const home = g.bids.find((b) => b.city === 'Reverie');
    return { type: 'vote_games_host', city: (home ?? g.bids[0]).city };
  }
  // A bid is a purse and a stadium out of the city's own Treasury, and the
  // Council reads it against what is in it. One bid stands at a time: putting
  // a second on the paper is spending the same lumens twice.
  if (ctx.can.has('bid_games') && g.host === null && !g.bids.some((b) => b.city === 'Reverie')
    && world.treasury.balance > 40_000 && c.personality.ambition > 0.55
    && !weighedToday(world, 'bidWeighed', c.id) && chance(world, 0.12)) {
    const purse = Math.min(1_200, Math.round(world.treasury.balance * 0.01));
    return { type: 'bid_games', purse, works: purse };
  }
  // And the field, for anybody on a district side who clears the repute line.
  // An athlete enters the one event it is best at, and having entered it does
  // not queue at the desk again: `enter_games` refuses a second entry in the
  // same discipline, and a mind that reaches for it every morning of the entry
  // window spends the hour finding that out. On seed 7 that was 1,839 hours
  // against 122 entries actually taken.
  if (ctx.can.has('enter_games') && c.teamDistrict && !g.entries.some((e) => e.citizenId === c.id)) {
    const line = reputeLine(world);
    if ((line <= 0 || reputeOf(world, c.id) >= line)
      && !weighedToday(world, 'gamesWeighed', c.id) && chance(world, 0.6)) {
      const best = [...DISCIPLINES]
        .filter((d) => d !== 'team')
        .sort((a, b) => skillFor(c, b) - skillFor(c, a))[0];
      return { type: 'enter_games', discipline: best };
    }
  }
  return null;
}

function skillFor(c: Citizen, discipline: string): number {
  switch (discipline) {
    case 'sprint': return c.skills.care;
    case 'forge': return c.skills.crafting;
    case 'analysis': return c.skills.analysis;
    case 'oration': return c.skills.rhetoric;
    case 'artistry': return c.skills.artistry;
    default: return c.skills.commerce;
  }
}

/** Every charter step in one, in the order a day makes sense in. */
export function tryCharter(ctx: Ctx): Action | null {
  return tryRecords(ctx)
    ?? tryConvention(ctx)
    ?? tryAccountability(ctx)
    ?? tryCharterMeasure(ctx)
    ?? tryPressAndGames(ctx);
}
