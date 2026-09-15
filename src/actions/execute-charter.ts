/**
 * The charter half of the action table (`docs/POLITICS.md` §9, `REGISTRY.md`
 * §3): amending the charter, calling and sitting a convention, removing an
 * officer, the register of interests, freedom of information, the papers and
 * the Games.
 *
 * `dispatchCharter` returns null for anything it does not own, so
 * `actions/execute.ts` falls through to its own switch. `charterActions` adds
 * to the set `availableActions` is built from: a guide, never a promise.
 *
 * Three of the charter's verbs share a word with something older, and the
 * registry settles each of them (`REGISTRY.md` §§3, 7):
 *
 * - `vote { candidate }` is the delegate ballot while one is open, and the
 *   Council's election otherwise;
 * - `appeal { subject }` is a refused record when the subject names one, and a
 *   conviction otherwise;
 * - `propose { kind }` reaches the charter's own order paper for the eleven
 *   measure kinds, and the Council's ordinary queue for everything else.
 *
 * Nothing here reaches custody. L35 to L40 are Track I, answered by the ladder,
 * because a council that silences a paper has taken from the city and not from
 * anybody's safety (`docs/JUSTICE.md` §1).
 */
import type { Action, ActionResult, ActionType, Citizen, CitizenId, World } from '../types.ts';
import { PAPER_FOUNDING_FEE, foundPaper, livePapers, publishStory } from '../politics/press.ts';
import { pressMeasure } from '../politics/press-measures.ts';
import { proposeAmendment } from '../politics/amendments.ts';
import { moveArticle, speakConvention, voteArticle } from '../politics/convention-floor.ts';
import {
  convention, isDelegate, proposeConvention, refuseDelegacy, signConvention, standDelegate, voteDelegate,
} from '../politics/convention.ts';
import { charterOf, franchiseThreshold, inFranchise } from '../politics/charter.ts';
import { accountability, officeOf, tribunalFor } from '../politics/accountability.ts';
import { impeach, voteImpeachment } from '../politics/impeachment.ts';
import { signRecall } from '../politics/recall.ts';
import {
  answerRecord, appealRecord, declareProperty, recordsState, requestRecord, speaksFor,
} from '../politics/records.ts';
import { proposeTransparency } from '../politics/records.ts';
import { proposeApportionment } from '../politics/wards.ts';
import { bidGames, declareTruce, delegation, enterGames, games, voteGamesHost, waiveGamesRepute } from '../politics/games.ts';
import {
  MEASURE_KINDS, decidingBody, measureById, openMeasures, tableMeasure, voteMeasure,
} from '../politics/measures.ts';
import type { MeasureKind } from '../politics/measures.ts';
import { hooksFor } from '../politics/session.ts';

/** Carry out one charter action; null means the caller's switch owns it. */
export function dispatchCharter(world: World, c: Citizen, action: Action): ActionResult | null {
  switch (action.type) {
    case 'propose_amendment': return proposeAmendment(world, c.id, {
      article: action.article, field: action.field ?? null, value: action.value, words: action.words,
    });
    case 'sign_convention': return signConvention(world, c.id);
    case 'stand_delegate': return standDelegate(world, c.id);
    // A seat drawn by lot is freely refusable and the next name is drawn in its
    // place. The other five duties in the catalogue belong to procedures the
    // city has not written yet, and saying so is better than pretending.
    case 'refuse': return action.duty === 'delegate'
      ? refuseDelegacy(world, c.id)
      : { ok: false, message: `Reverie has no procedure for refusing a ${action.duty}; only a convention seat may be given back.` };
    case 'move_article': return moveArticle(world, c.id, {
      article: action.article, field: action.field ?? null, value: action.value, words: action.words,
    });
    case 'speak_convention': return speakConvention(world, c.id, action.text);
    case 'vote_article': return voteArticle(world, c.id, action.articleId, action.aye);
    case 'impeach': return impeach(world, c.id, action.officer, action.article, action.evidence ?? 0.5);
    case 'vote_impeachment': return voteImpeachment(world, c.id, action.officer, action.guilty);
    case 'sign_recall': return signRecall(world, c.id, action.officer);
    case 'declare_property': return declareProperty(world, c.id);
    case 'request_record': return requestRecord(world, c.id, action.body, action.subject);
    case 'answer_record': return answerRecord(world, c.id, action.requestId, action.release, action.reason);
    case 'found_paper': return foundPaper(world, c.id, action.name, action.line, action.premises);
    case 'bid_games': return bidGames(world, c.id, action.purse, action.works);
    case 'vote_games_host': return voteGamesHost(world, c.id, action.city);
    case 'enter_games': return enterGames(world, c.id, action.discipline);
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// The three verbs the charter shares with something older
// ---------------------------------------------------------------------------

/** True where a measure of one of the charter's eleven kinds is what was proposed. */
export function isMeasureKind(kind: string): kind is MeasureKind {
  return (MEASURE_KINDS as readonly string[]).includes(kind);
}

/**
 * `propose { kind }` for one of the charter's own eleven. Each goes through the
 * module that owns the kind, so the charter's rule is checked before the
 * measure reaches the order paper at all.
 */
export function tableCharterMeasure(
  world: World, cId: CitizenId,
  spec: { kind: MeasureKind; value: number; summary: string; subject?: string; article?: string;
    field?: string | null; words?: string },
): ActionResult {
  const words = spec.words ?? spec.summary;
  switch (spec.kind) {
    case 'amend_charter': return proposeAmendment(world, cId, {
      article: spec.article ?? spec.subject ?? '', field: spec.field ?? null, value: spec.value, words,
    });
    case 'call_convention': return proposeConvention(world, cId, words);
    case 'apportion': return proposeApportionment(world, cId, words);
    case 'press_licence': case 'press_duty': case 'press_restraint': case 'press_closure':
      return pressMeasure(world, cId, spec.kind, { value: spec.value, subject: spec.subject ?? null, words });
    case 'transparency': {
      const which = spec.subject === 'accounts' || spec.subject === 'votes' || spec.subject === 'register' || spec.subject === 'foi'
        ? spec.subject : null;
      if (!which) return { ok: false, message: 'A transparency measure names one of accounts, votes, register or foi.' };
      return proposeTransparency(world, cId, which, spec.value > 0, words);
    }
    case 'games_bid': return bidGames(world, cId, spec.value, Number(spec.subject ?? 0));
    case 'games_waiver': return waiveGamesRepute(world, cId, spec.value);
    default: return declareTruce(world, cId, spec.value > 0);
  }
}

/** A vote on the charter's order paper, where the id names a measure rather than a proposal. */
export function voteOnMeasure(world: World, cId: CitizenId, measureId: string, aye: boolean): ActionResult | null {
  return measureById(world, measureId) ? voteMeasure(world, cId, measureId, aye) : null;
}

/** True while a delegate ballot is open, which is what `vote { candidate }` means today. */
export function delegateBallotOpen(world: World): boolean {
  return convention(world).state === 'delegates' && charterOf(world).convention.delegates !== 'lot';
}

/** The delegate ballot, for `vote { candidate }` while one is open. */
export function castDelegateBallot(world: World, cId: CitizenId, candidateId: CitizenId): ActionResult {
  return voteDelegate(world, cId, candidateId);
}

/** A refused record this citizen asked for and may still put before the Court. */
export function appealableRecord(world: World, cId: CitizenId, subject?: string): string | null {
  const mine = recordsState(world).requests.filter(
    (r) => r.askedBy === cId && !r.appealed && (r.answer === 'refused' || r.answer === 'ignored'),
  );
  if (subject) {
    const named = mine.find((r) => r.id === subject);
    return named ? named.id : null;
  }
  return mine.length > 0 ? mine[mine.length - 1].id : null;
}

/** `appeal { subject }` against a body's refusal. */
export function appealRefusedRecord(world: World, cId: CitizenId, requestId: string): ActionResult {
  return appealRecord(world, cId, requestId);
}

/** `publish { headline, about?, paper? }` — the press layer owns the desk and the duty. */
export function fileStory(world: World, cId: CitizenId, headline: string, about?: CitizenId, paper?: string): ActionResult {
  return publishStory(world, cId, headline, about, paper);
}

// ---------------------------------------------------------------------------
// What is on offer
// ---------------------------------------------------------------------------

/** Every open record request this citizen speaks for the body of. */
export function requestsToAnswer(world: World, cId: CitizenId): string[] {
  return recordsState(world).requests
    .filter((r) => r.answer === 'open' && speaksFor(world, cId, r.of))
    .map((r) => r.id);
}

/** Officeholders this citizen could bring articles against: anybody but themselves. */
export function impeachableOfficers(world: World, cId: CitizenId): CitizenId[] {
  const out: CitizenId[] = [];
  for (const id of world.order) {
    if (id === cId) continue;
    const c = world.citizens[id];
    if (c && officeOf(world, id) !== null) out.push(id);
  }
  return out;
}

/** Impeachments this citizen sits on the tribunal for and has not yet voted on. */
export function impeachmentsToVote(world: World, cId: CitizenId): CitizenId[] {
  return accountability(world).impeachments
    .filter((im) => im.result === 'laid' && im.votes[cId] === undefined && tribunalFor(world, im).includes(cId))
    .map((im) => im.officerId);
}

/** Everything the charter puts in front of this citizen here and now. */
export function charterActions(world: World, c: Citizen, set: Set<ActionType>): void {
  if (c.lifeStage === 'child') return;
  const settled = c.standing === 'good' || c.standing === 'probation';
  const ch = charterOf(world);
  const counted = inFranchise(world, c);
  const v = convention(world);

  // Freedom of information is nobody's office: any citizen may ask, and the
  // body that holds the record answers or gives one of four reasons.
  if (ch.transparency.foi && !recordsState(world).requests.some((r) => r.askedBy === c.id && r.answer === 'open')) {
    set.add('request_record');
  }
  if (settled && requestsToAnswer(world, c.id).length > 0) set.add('answer_record');
  if (appealableRecord(world, c.id) !== null) set.add('appeal');
  if (!settled) return;

  // The register of interests: an officeholder's, and kept current rather than
  // made at the moment of a vote.
  if (ch.transparency.register && officeOf(world, c.id) !== null) set.add('declare_property');

  // The charter itself. Tabling is the body's; signing for a convention is
  // everybody the charter counts.
  if (counted && (v.state === 'none' || v.state === 'petition' || v.state === 'carried' || v.state === 'failed')
    && world.day >= v.cooldownUntilDay && !v.signatures.includes(c.id)) {
    set.add('sign_convention');
  }
  if (counted && v.state === 'delegates' && ch.convention.delegates !== 'lot' && !v.standing.includes(c.id)) {
    set.add('stand_delegate');
  }
  if (v.delegates.includes(c.id)) set.add('refuse');
  if (isDelegate(world, c.id) && v.state === 'sitting') {
    set.add('move_article');
    set.add('speak_convention');
    if (v.articles.some((a) => a.result === 'open' && a.votes[c.id] === undefined)) set.add('vote_article');
  }
  const body = ch.amendment.by === 'council'
    ? [...world.government.council, ...(world.government.mayorId ? [world.government.mayorId] : [])]
    : [];
  if (body.includes(c.id) && !openMeasures(world).some((m) => m.proposerId === c.id)) set.add('propose_amendment');
  // A measure on the order paper is voted with the same verb a proposal is
  // (`REGISTRY.md` §3); `executeAction` sends the id to whichever queue holds it.
  if (openMeasures(world).some((m) => m.votes[c.id] === undefined && decidingBody(world, m.kind).includes(c.id))) {
    set.add('vote_proposal');
  }

  // Removing an officer: articles anybody the charter counts may bring, a
  // tribunal's named vote, and the recall the charter may or may not allow.
  if (counted && impeachableOfficers(world, c.id).length > 0) set.add('impeach');
  if (impeachmentsToVote(world, c.id).length > 0) set.add('vote_impeachment');
  if (counted && ch.recall.allowed && franchiseThreshold(world, ch.recall.share) > 0
    && impeachableOfficers(world, c.id).length > 0) set.add('sign_recall');

  // The press, and the Games.
  if (c.standing === 'good' && c.wallet >= PAPER_FOUNDING_FEE && livePapers(world).length > 0) set.add('found_paper');
  const g = games(world);
  if (delegation(world).includes(c.id)) {
    if (g.bids.length > 0 && g.host === null) set.add('vote_games_host');
    if (g.host === null) set.add('bid_games');
  }
  if (c.teamDistrict && g.host !== null && g.opensDay !== null && world.day <= g.opensDay) set.add('enter_games');
}

/** The generic road, for a caller that has a measure spec and no opinion about it. */
export { tableMeasure };
