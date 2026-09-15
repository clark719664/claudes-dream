/**
 * The `act` tool a Claude citizen calls to choose its action for the hour.
 *
 * One flat, strict JSON schema covers every action in the catalogue: `type` is
 * required and every parameter any action uses is an optional property with the
 * right JSON type (enums where the domain type is an enum). The engine's
 * `validateAction` does the per-action check afterwards, so a parameter that does
 * not belong to the chosen action is simply ignored or rejected there.
 *
 * `kind` is shared by `found_business` (BusinessKind), `propose` (ProposalKind),
 * `create_work` (WorkKind), `decree` (Decree kind) and `react` (ReactionKind);
 * none of the five enums overlap, so a single enum serves all of them.
 *
 * The description is the action catalogue in its call form, rendered from
 * data/actions.ts so it cannot drift from the engine, and it is as neutral as
 * the system prompt: it says what each action is, never what to do with it.
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  ACTION_TYPES, AID_RULES, CHARTER_MEASURE_KINDS, CIVIL_FINDINGS, CIVIL_ORDERS, CONTRACT_KINDS, DISTRICT_IDS, GOODS,
  HOUSE_MOTION_KINDS, HOUSE_RULES, PAPERS, PLEAS, POLICY_KINDS, PROFESSIONS, REACTIONS, REFUSABLE_DUTIES, SCHOOLS,
  SKILLS, SUCCESSIONS, TENET_QUESTIONS, WORK_KINDS,
} from '../types.ts';
import type { BusinessKind, CharterMeasureKind, Decree, ProposalKind } from '../types.ts';
import { LAW_CODES, OFFENCE_CODES } from '../data/laws.ts';
import { TECHNOLOGY_IDS } from '../progress/tree.ts';
import { FITTINGS, PERMITS } from '../environment/state.ts';
import { CITY_KEYS, CITY_NAMES, SECRET_KINDS, SMUGGLE_ROUTES } from '../underworld/state.ts';
import { IMPEACHMENT_ARTICLES } from '../politics/accountability.ts';
import { RECORD_BODIES, REFUSAL_REASONS } from '../politics/records.ts';
import { DISCIPLINES } from '../politics/games.ts';
import { CHARTER_ARTICLES } from '../politics/charter.ts';
import { HOBBIES, PRODUCT_IDS } from '../data/catalogue.ts';
import { DISHES } from '../data/metropolis.ts';
import { catalogueByGroup } from '../data/actions.ts';
import { GATES } from '../standing/gates.ts';

export const BUSINESS_KINDS: readonly BusinessKind[] = ['workshop', 'cafe', 'studio', 'shop', 'clinic', 'courier'];
export const PROPOSAL_KINDS: readonly ProposalKind[] = [
  'income_tax', 'sales_tax', 'dividend', 'min_wage', 'law_severity', 'pardon', 'public_works',
  'appoint_judge', 'dismiss_judge', 'remove_mayor', 'charter', 'charity',
  'property_tax', 'wealth_tax', 'tariff', 'reserve', 'tram', 'monument',
  // Finance and civil law (`docs/FINANCE.md` §9, `docs/CIVIL.md` §10).
  'bond_issue', 'bond_defer', 'reserve_ratio', 'bank_rescue', 'mint',
  'filing_fee', 'docket_days', 'licence_floor',
  // Research and the works (`docs/PROGRESS.md` §8), and the seven measures the
  // environment puts to the Council (`docs/ENVIRONMENT.md` §9).
  'research_grant', 'adopt_technology',
  'zone', 'conserve', 'emission_charge', 'host_payment', 'abatement_works', 'relocate_works', 'buy_out',
  // The underworld's four questions (`docs/UNDERWORLD.md` §7).
  'restrict_good', 'amnesty', 'customs_posts', 'spy_disposition',
];
/** Everything `propose { kind }` may name: the Council's queue and the charter's order paper. */
export const PROPOSABLE_KINDS: readonly (ProposalKind | CharterMeasureKind)[] = [
  ...PROPOSAL_KINDS, ...CHARTER_MEASURE_KINDS,
];
export const IMPEACHMENT_ARTICLE_NAMES: readonly string[] = Object.keys(IMPEACHMENT_ARTICLES);
export const REFUSAL_REASON_NAMES: readonly string[] = Object.keys(REFUSAL_REASONS);
/** Article names a charter amendment or a convention motion may reach. */
export const CHARTER_ARTICLE_NAMES: readonly string[] = Object.keys(CHARTER_ARTICLES);
export const DECREE_KINDS: readonly Decree['kind'][] = ['tax_holiday', 'curfew', 'relief', 'emergency'];
/** Roles a union can be founded for: the ones citizens actually hold. */
export const UNION_ROLES: readonly string[] = [
  'forge_operator', 'power_technician', 'fabricator', 'builder',
  'medic', 'teacher', 'librarian', 'researcher', 'journalist',
  'merchant', 'banker', 'performer', 'artist', 'courier',
  'watch_officer', 'judge', 'councillor', 'mayor',
  'shopkeeper', 'cook', 'clerk',
  'detective', 'advocate', 'curator', 'coach',
];
export const DISH_IDS: readonly string[] = DISHES.map((d) => d.id);
/** Every city the Registry keeps a gate for (`docs/CITIZENSHIP.md` §2). */
export const CITY_IDS: readonly string[] = [
  ...new Set([...Object.keys(GATES), ...CITY_KEYS, ...Object.values(CITY_NAMES)]),
];

/** Parameter names that appear on at least one Action (besides `type`). */
export const ACTION_PARAM_NAMES: readonly string[] = [
  'district', 'good', 'qty', 'skill', 'tier', 'with', 'to', 'target', 'citizen', 'official', 'from', 'about',
  'candidate', 'targetId', 'text', 'headline', 'summary', 'name', 'title', 'amount', 'wage', 'minSkill', 'spend',
  'value', 'jobId', 'proposalId', 'caseId', 'reportId', 'guilty', 'reason', 'result',
  'building', 'kind', 'law', 'lawCode', 'aye', 'platform',
  'productId', 'itemId', 'clubId', 'hobby', 'price', 'index',
  // The metropolis
  'advocate', 'case', 'partyId', 'proposalId', 'referendumId', 'role', 'unionId',
  'unitId', 'rent', 'businessId', 'gigId', 'workId', 'score', 'school', 'dish',
  'honoree', 'inscription', 'claim', 'postId', 'paper', 'pay', 'business',
  // Standing
  'city',
  // Civil law: the instrument, the docket, the guild and the patron
  'offerId', 'contractId', 'variationId', 'escrowId', 'suitId', 'judgmentId', 'disputeId', 'guildId',
  'terms', 'consideration', 'days', 'penalty', 'notice', 'witnesses', 'defendant', 'damages', 'plea',
  'counterclaim', 'finding', 'order', 'arbiter', 'fee', 'cities', 'profession', 'candidate', 'perDay', 'subject',
  'holder',
  // Finance: the paper, the counter, the houses and the pot
  'issueId', 'holdingId', 'policyId', 'claimId', 'mutualId', 'loanId',
  'coupon', 'term', 'haircut', 'accept', 'rate', 'capital', 'cover', 'premium', 'event', 'dues',
  // Research, the works, and what a city keeps to itself
  'technology', 'projectId', 'subject',
  // The air, the river and the land
  'fitting', 'permit', 'proposal', 'against',
  // The gate, the schedule and what goes past it
  'goods', 'traveller', 'route', 'retainer', 'direction',
  // The charter, the office, the paper and the Games
  'article', 'field', 'words', 'articleId', 'officer', 'evidence', 'body', 'requestId', 'release', 'ground',
  'duty', 'premises', 'purse', 'works', 'discipline', 'line',
  // The name, the entail, the match and the will
  'houseId', 'rule', 'unit', 'motionId', 'dowry', 'house', 'shares', 'residue', 'executor', 'instructions',
  // The creed, the fund, the door and the site
  'creedId', 'tenets', 'tithe', 'gatheringDay', 'succession', 'aidRule', 'examinationFloor',
  'question', 'stance', 'tenetId', 'siteId', 'warrantId', 'label',
];

function citizenRef(description: string): Record<string, unknown> {
  return { type: 'string', description: `${description} (a citizen id such as c_12, exactly as shown in the observation)` };
}

/** "study(skill)" — the call form of one catalogue line, without its description. */
function shortForm(line: string): string {
  return line.split(' — ')[0];
}

const ACT_DESCRIPTION = [
  'One action for this hour. `type` names it; the other properties are its parameters, and only the ones listed',
  'for that type are read. The system prompt describes what each action does; the observation\'s availableActions',
  'lists the ones the engine can carry out where you stand this hour.',
  '',
  ...catalogueByGroup().map(({ group, lines }) => `${group}: ${lines.map(shortForm).join('; ')}.`),
].join('\n');

/** Strict tool definition sent with every request. Stable so it caches. */
export const ACT_TOOL: Anthropic.Beta.BetaTool = {
  name: 'act',
  description: ACT_DESCRIPTION,
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['type'],
    properties: {
      type: { type: 'string', enum: [...ACTION_TYPES], description: 'The action to take this hour.' },
      district: { type: 'string', enum: [...DISTRICT_IDS], description: 'move: destination, must be open and reachable in one step from where you are. move_home: the district to take the room in, omitted for the cheapest address of that tier the city has open. decree curfew: which district the curfew covers. survey_air / survey_water / plant_trees: the district you are standing in. petition_zoning: your own district. file_nuisance: where you live. propose zone / conserve / host_payment: which district the measure is about.' },
      good: { type: 'string', enum: [...GOODS], description: 'buy / sell / consume: which good. seize / fence / receive_goods: which good the lot is. propose restrict_good: the good the schedule would name.' },
      qty: { type: 'integer', description: 'buy / sell: number of units, 1 to 1000. declare_cargo / smuggle / seize / fence / receive_goods: how many crates the load is. Above four crates a load hides badly: each one after that costs a twentieth of the cover.' },
      skill: { type: 'string', enum: [...SKILLS], description: 'study: skill to train. post_job: required skill (omit for none).' },
      tier: { type: 'integer', enum: [0, 1, 2, 3], description: 'move_home: 0 move out, or the tier of home to take (1 to 3); the address is a block of that tier, in the district you name if you name one.' },
      with: citizenRef('socialize / date / dine / play / move_in: who is with you, present here (move_in: whose household you join)'),
      to: citizenRef('message / gift / gift_item / propose_partnership / marry: recipient. sell_secret: the buyer. fence: the hand you are offering the lot to. pass_secret: who you hand the copy to'),
      target: { type: 'string', description: 'insult / scam / harass / extort / threaten / assault / confine / erase: the citizen it is done to, present here (a citizen id such as c_12). house_motion: what the motion is about — the citizen to admit or to fund, the holding to sell (y_12 or b_3), or the rule to amend to.' },
      citizen: citizenRef('hire / fire / report / appoint_judge / recruit / mentor: the citizen concerned. visit: the citizen in custody you go to see. take_apprentice: the citizen you teach a secret to. recruit_agent: who you are offering a retainer. assign_detective: the citizen the Watch would watch, if it is a citizen rather than a building'),
      official: citizenRef('bribe: an office holder'),
      from: citizenRef('steal: victim, must be present here. receive_goods: the seller whose offer you are taking'),
      about: citizenRef('publish: optional subject of the story. gossip: the citizen the claim is about'),
      candidate: citizenRef('vote / endorse: the candidate — and, while a delegate ballot is open, the citizen you would seat at the convention. certify: the citizen you put your guild\'s mark on'),
      targetId: citizenRef('propose: citizen for pardon / appoint_judge / dismiss_judge / remove_mayor / monument'),
      advocate: citizenRef('hire_advocate: the citizen you retain to speak for you'),
      honoree: citizenRef('commission_monument: the citizen the statue is of'),
      text: { type: 'string', description: 'socialize / message / broadcast / report / note: the words, at most 280 characters. speak_convention: your speech, recorded verbatim and quotable by both papers.' },
      index: { type: 'integer', description: 'forget: the position of the note to strike out, 0 being the oldest in self.notes.' },
      headline: { type: 'string', description: 'publish: the headline, at most 280 characters.' },
      summary: { type: 'string', description: 'propose: one-line summary of the proposal.' },
      name: { type: 'string', description: 'found_business / found_club / found_gang / found_party / found_union / found_paper: the name, at most 40 characters. open_project: what the programme is called, at most 60.' },
      title: { type: 'string', description: 'post_job: job title, at most 40 characters. post_gig: what the task is, at most 60. create_work: the work\'s title, at most 80.' },
      amount: { type: 'integer', description: 'gift / scam / extort / bribe / request_loan / repay_loan / donate / fund_project: lumens, at least 1.' },
      wage: { type: 'integer', description: 'post_job / set_wage: lumens per shift, at least the minimum wage.' },
      minSkill: { type: 'integer', description: 'post_job: minimum skill level 0 to 100.' },
      spend: { type: 'integer', description: 'campaign: lumens to spend on visibility (optional, 0 or more).' },
      value: { type: 'number', description: 'propose: the new value. income_tax 0-0.5, sales_tax 0-0.25, dividend 0-60, min_wage 5-20, law_severity 1-5, public_works 0-5000, property_tax 0-0.5, wealth_tax 0-0.02, tariff 0-0.5, reserve 0-200000, research_grant lumens into the purse, adopt_technology lumens pledged to the works, emission_charge 0-20 lumens a mote a day, host_payment 0-0.5 of what is raised inside the district; 0 for the others. decree relief: lumens each citizen in hardship is paid. propose restrict_good: the restriction severity 1-3; amnesty: days it runs; customs_posts: how many posts the gates carry; spy_disposition: 0 try, 1 expel, 2 hold; press_duty: lumens an edition; press_restraint: days; transparency: 1 to open the switch and 0 to close it; games_bid: the purse. propose_amendment / move_article: the number an article is set to; an article that takes a word, a switch or a list is named in `words` instead, and the mover\'s own words are what the Chronicle prints.' },
      jobId: { type: 'string', description: 'apply_job / hire / set_wage: job id such as j_4.' },
      proposalId: { type: 'string', description: 'vote_proposal: proposal id such as p_2.' },
      caseId: { type: 'string', description: 'verdict / vote_appeal: case id such as k_7, from observation.bench or observation.appeals. plead_guilty: the charge you admit (omit for the oldest charge still waiting for a bench).' },
      reportId: { type: 'string', description: 'file_charge / drop_report: report id such as r_9, from observation.reports.' },
      guilty: { type: 'boolean', description: 'verdict: true for guilty, false for not guilty.' },
      reason: { type: 'string', description: 'verdict / drop_report: your reason in your own words, at most 280 characters. Public. answer_record, on a refusal: one of investigation, deliberation, court_order or private — and a citizen\'s notes and letters are never released to anybody.' },
      result: { type: 'string', enum: ['upheld', 'reduced', 'overturned'], description: 'vote_appeal: how you vote on the appeal.' },
      building: { type: 'string', description: 'vandalize / sabotage: building id such as compute_forge, must be in your district. install_abatement / maintain_abatement / discharge: premises you own or work at. propose abatement_works / relocate_works / buy_out: the building the measure is about. case_target / steal_secret / sweep / plant_false_papers / assign_detective: the room, which you must be standing in for the first four.' },
      city: { type: 'string', enum: [...CITY_IDS], description: 'sponsor / apply_residency: which city\'s gate. Omit for the city you are standing in. declare_cargo / smuggle: the city on the other side of the crossing. recruit_agent: the city the retainer is for, which is what makes a secret taken under it espionage rather than industrial espionage. vote_games_host: the city you vote to host the Games.' },
      kind: {
        type: 'string',
        enum: [...new Set([...BUSINESS_KINDS, ...PROPOSABLE_KINDS, ...WORK_KINDS, ...DECREE_KINDS, ...REACTIONS,
          ...CONTRACT_KINDS, ...POLICY_KINDS, ...SECRET_KINDS, ...HOUSE_MOTION_KINDS])],
        description: 'found_business: workshop | cafe | studio | shop | clinic | courier. propose: the proposal kind, '
          + 'which may be one of the Council\'s or one of the eleven on the charter\'s own order paper. '
          + 'create_work: painting | play | song | book | paper | expose. decree: tax_holiday | curfew | relief | emergency. '
          + 'react: cheer | frown | laugh. offer_contract: employment | lease | loan | partnership | forward | escrow | '
          + 'apprenticeship | commission | patronage. offer_policy: caravan | ship | business | home | health. '
          + 'steal_secret / pass_secret: pattern | council_papers | bond_reserve | duty_roster | tender. '
          + 'house_motion: sell | admit | rule | campaign | letter.',
      },
      law: { type: 'string', enum: [...OFFENCE_CODES], description: 'report: the law code you are reporting. L… is the Code of the City, answered by the ladder; P… is the Code of Persons, answered by custody in days.' },
      lawCode: { type: 'string', enum: [...LAW_CODES], description: 'propose law_severity: which law to change.' },
      aye: { type: 'boolean', description: 'vote_proposal / vote_article: true to vote aye, false for nay.' },
      productId: { type: 'string', enum: [...PRODUCT_IDS], description: 'buy_item / craft / set_price: which product of the catalogue. declare_cargo / smuggle / seize / fence / receive_goods: the thing the load is, when the load is a thing rather than a good.' },
      itemId: { type: 'string', description: 'use_item / gift_item: the id of a thing you own, such as i_12, as listed in self.possessions.' },
      clubId: { type: 'string', description: 'join_club / leave_club / attend_club: club id such as u_2.' },
      hobby: { type: 'string', enum: [...HOBBIES], description: 'found_club: the hobby the club is for.' },
      price: { type: 'integer', description: 'set_price: lumens your business charges for one unit, at least 1. list_property / sell_business: what you are asking for the deed or the concern, and 0 to take it off the board. sell_secret: what you are asking for mastery of it.' },
      // --- The metropolis ---
      case: { type: 'string', description: 'advocate: case id such as k_7, from the case you were retained on.' },
      partyId: { type: 'string', description: 'join_party: party id such as f_2, from government.parties.' },
      referendumId: { type: 'string', description: 'vote_referendum: referendum id such as d_1, from government.referendum.' },
      role: { type: 'string', enum: [...UNION_ROLES], description: 'found_union: the job role the union is for; it must be the role you hold.' },
      unionId: { type: 'string', description: 'join_union: union id such as n_1, from self.union or the union of your role.' },
      unitId: { type: 'string', description: 'buy_property / sell_property / let_property / list_property: property unit id such as y_12, from here.units or self.property.' },
      rent: { type: 'integer', description: 'let_property: lumens of rent per day, at least 1.' },
      businessId: { type: 'string', description: 'buy_shares / sell_shares / buy_business: business id such as b_3.' },
      gigId: { type: 'string', description: 'take_gig: gig id such as q_5, from here.gigs.' },
      workId: { type: 'string', description: 'exhibit / review: work id such as w_8, from self.works, here.works or culture.topWorks.' },
      score: { type: 'integer', description: 'review: your score for the work, 0 to 100. Public.' },
      school: { type: 'string', enum: [...SCHOOLS], description: 'adopt_school: makers | commons | lanterns.' },
      dish: { type: 'string', enum: [...DISH_IDS], description: 'set_menu: the dish your café serves.' },
      inscription: { type: 'string', description: 'commission_monument: the words cut into the statue, at most 280 characters. Public.' },
      claim: { type: 'string', description: 'gossip: what you say about them, at most 140 characters. Public, and it spreads. plant_false_papers: what the decoy says, which is not true — and if it ever surfaces elsewhere, the leak is proved.' },
      postId: { type: 'string', description: 'react: post id such as o_31, from feed.' },
      paper: { type: 'string', description: 'read_paper: chronicle | ledger. publish: the paper you file with, such as o_3 from politics.papers, or left out for the desk you work at.' },
      pay: { type: 'integer', description: 'post_gig: lumens the task pays, 1 to 10000; it leaves your wallet when somebody finishes it.' },
      business: { type: 'string', description: 'racket: business id such as b_3, in the district you stand in.' },
      // --- Civil law: the instrument, the docket, the guild and the patron ---
      offerId: { type: 'string', description: 'accept_contract / witness_contract / accept_patronage: an instrument on the table, such as ct_4. close_offer: an instrument (ct_4), an offer of arbitration (ca_2), or a lot a fence is holding open for you (fd_5, from underworld.offers). accept_arbitration: ca_2. accept_recruitment: a retainer offered to you, such as rt_2, from underworld.retainers.' },
      contractId: { type: 'string', description: 'perform_contract / propose_variation / terminate_contract / open_escrow: a filed instrument such as ct_4. file_suit: the instrument the suit is on, if it is on one.' },
      variationId: { type: 'string', description: 'accept_variation: new terms put to you, such as cv_2.' },
      escrowId: { type: 'string', description: 'release_escrow: a sum you lodged, such as ce_1.' },
      suitId: { type: 'string', description: 'answer_suit / settle / accept_settlement / judge_civil: a suit on the docket, such as cs_3.' },
      judgmentId: { type: 'string', description: 'enforce_judgment: a judgment owed to you, such as cj_2.' },
      disputeId: { type: 'string', description: 'arbitrate: the arbitration you were named to decide, such as ca_2.' },
      guildId: { type: 'string', description: 'sit_examination: the guild whose examination you sit, such as cg_1.' },
      terms: { type: 'string', description: 'offer_contract / propose_variation: what each side must do, in your own words. Public for ever.' },
      consideration: { type: 'integer', description: 'offer_contract / propose_variation: what moves each way per period, in lumens.' },
      days: { type: 'integer', description: 'offer_contract / propose_variation: how long it runs, 1 to 112. offer_patronage: 7 to 112. recruit_agent: how many days the retainer runs.' },
      penalty: { type: 'integer', description: 'offer_contract / propose_variation: what breach costs, capped at twice the consideration outstanding.' },
      notice: { type: 'integer', description: 'offer_contract / propose_variation: days of warning that end it without breach (3 for employment and lease unless you say otherwise).' },
      witnesses: { type: 'array', items: { type: 'string' }, description: 'offer_contract: up to three citizens standing beside you whose mark you ask for; each is paid 2 lumens and each still chooses.' },
      defendant: citizenRef('file_suit: the citizen you are suing'),
      damages: { type: 'integer', description: 'file_suit: the sum you are suing for. judge_civil: the sum you would award, never above the sum claimed.' },
      plea: { type: 'string', enum: [...PLEAS], description: 'answer_suit: admit or deny.' },
      counterclaim: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'damages'],
        description: 'answer_suit: sue back, on a denial.',
        properties: {
          claim: { type: 'string', description: 'What you say happened.' },
          damages: { type: 'integer', description: 'The sum you claim.' },
        },
      },
      finding: { type: 'string', enum: [...CIVIL_FINDINGS], description: 'judge_civil: for the plaintiff, for the defendant, or dismissed.' },
      order: { type: 'string', enum: [...CIVIL_ORDERS], description: 'judge_civil: damages, performance (never against labour), rescission or none.' },
      arbiter: citizenRef('offer_arbitration: the third citizen you propose to decide it'),
      fee: { type: 'integer', description: 'offer_arbitration: the arbiter\'s fee, split evenly between the two of you.' },
      cities: { type: 'array', items: { type: 'string' }, description: 'refer_dispute: the two cities.' },
      profession: { type: 'string', enum: [...PROFESSIONS], description: 'found_guild: medic | advocate | banker | builder.' },
      perDay: { type: 'integer', description: 'offer_patronage: the daily stipend, in lumens.' },
      holder: { type: 'string', description: 'open_escrow: "exchange", or the citizen id of a licensed banker who will hold it.' },
      // --- Finance: the paper, the counter, the houses and the pot ---
      issueId: { type: 'string', description: 'bid_bond / offer_restructure / vote_restructure / repudiate: an issue of the city\'s paper, such as bond_1.' },
      holdingId: { type: 'string', description: 'sell_bond: paper you hold, such as hold_3.' },
      policyId: { type: 'string', description: 'buy_policy: a line posted, such as line_2. file_claim: your own policy, such as pol_5.' },
      claimId: { type: 'string', description: 'settle_claim / deny_claim: a claim on your house, such as ins_2. vote_aid / grant_aid: a claim on your pot or your creed\'s fund, such as aid_4 — they are the same object.' },
      mutualId: { type: 'string', description: 'join_mutual / pay_dues: a mutual, such as mut_1.' },
      loanId: { type: 'string', description: 'call_loan: a loan on the bank\'s book, such as l_3.' },
      coupon: { type: 'number', description: 'offer_restructure: the new coupon per bond per day, 0.5 to 4.' },
      term: { type: 'integer', description: 'offer_restructure: the new term in days. offer_policy: the term of the cover in days.' },
      haircut: { type: 'number', description: 'offer_restructure: the share of face written off, 0 to 1.' },
      accept: { type: 'boolean', description: 'vote_restructure: true to accept the terms offered, false to refuse them.' },
      rate: { type: 'number', description: 'set_deposit_rate / set_lending_rate: a fraction of the sum per day, such as 0.004.' },
      capital: { type: 'integer', description: 'found_underwriter: the capital you put behind it, at least 500 lumens.' },
      cover: { type: 'integer', description: 'offer_policy: the most the policy will pay.' },
      premium: { type: 'integer', description: 'offer_policy: what the cover costs per day.' },
      event: { type: 'string', description: 'file_claim: the loss you are claiming for. The public registers are read to see whether it happened.' },
      dues: { type: 'integer', description: 'found_mutual: the daily dues, 1 to 50 lumens.' },
      // --- Research, the works, and what a city keeps to itself ---
      technology: {
        type: 'string', enum: [...TECHNOLOGY_IDS],
        description: 'open_project: the subject to work on, whose prerequisites the city must already hold. '
          + 'adopt_technology: the subject your business builds the works for. take_apprentice / sell_secret: the secret you teach or sell. '
          + 'teach_technology: what you give this city 30 % of the cost of, which it must not already hold.',
      },
      projectId: { type: 'string', description: 'research / fund_project / publish_finding / keep_secret: a programme of research, such as rp_2, from progress.projects.' },
      subject: { type: 'string', description: 'request_record: what you are asking the body for, at most 140 characters. Public. appeal: a refused record request (f_3) when it is a record you are appealing rather than a conviction. propose press_restraint / press_closure: the paper; propose transparency: accounts | votes | register | foi; propose restrict_good: the id of an entry you would strike out. propose research_grant: the programme the grant pays into, such as rp_2. propose adopt_technology: the subject the works are for. offer_patronage: what you would like made, which is a request and never an instruction.' },
      // --- The air, the river and the land ---
      fitting: {
        type: 'string', enum: [...FITTINGS],
        description: 'install_abatement, and propose abatement_works: filter (250 lumens, three quarters of the motes), '
          + 'scrubber (900, under half, and a cell a shift) or stack (400, which cleans nothing and moves the smoke downwind).',
      },
      permit: {
        type: 'string', enum: [...PERMITS],
        description: 'petition_zoning, and propose zone: what the district may be built for. conserved admits nothing new at all; '
          + 'open admits anything; heavy_industry costs the most amenity and residential the least.',
      },
      proposal: { type: 'string', description: 'declare_interest: the zoning question before the Council, such as p_7.' },
      against: citizenRef('file_nuisance: the citizen whose works reach where you live'),
      // --- The gate, the schedule and what goes past it ---
      goods: { type: 'string', enum: [...GOODS], description: 'declare_cargo / smuggle: which good the load is, omitted when the load is a thing out of the catalogue (name it in productId) or a sum of lumens.' },
      traveller: citizenRef('inspect / assess_duty / seize / wave_through: the traveller at your gate'),
      route: { type: 'string', enum: [...SMUGGLE_ROUTES], description: 'smuggle: road, river, sea, or the mountain pass — which is worth a quarter of the cover, costs four times the journey, and is shut through the Frost.' },
      direction: { type: 'string', enum: ['inbound', 'outbound'], description: 'declare_cargo / smuggle: whether the load is coming into Reverie or going out of it. Inbound by default.' },
      retainer: { type: 'integer', description: 'recruit_agent: what you will pay the agent per day, in lumens. The first day is paid when they accept, and that row in the ledger is what proves afterwards who somebody worked for.' },
      // --- The charter, the office, the paper and the Games ---
      article: {
        type: 'string', enum: [...CHARTER_ARTICLE_NAMES, ...IMPEACHMENT_ARTICLE_NAMES],
        description: 'propose_amendment / move_article: which article of the charter. impeach: the conduct alleged — '
          + 'enrichment | direction | duty | payment | defiance.',
      },
      field: { type: 'string', description: 'propose_amendment / move_article: the field inside the article, where it has fields (such as `threshold` inside `amendment`).' },
      words: { type: 'string', description: 'propose_amendment / move_article: your own words for the motion, printed with it. Public.' },
      articleId: { type: 'string', description: 'vote_article: an article on the convention floor, such as w_4, from politics.convention.' },
      officer: citizenRef('impeach / vote_impeachment / sign_recall: the officeholder concerned'),
      evidence: { type: 'number', description: 'impeach: how strong you say the case is, 0 to 1. Public, and the tribunal reads it.' },
      body: { type: 'string', enum: [...RECORD_BODIES], description: 'request_record: council | watch | court | treasury | registry.' },
      requestId: { type: 'string', description: 'answer_record: a request before your body, such as f_3, from politics.records.' },
      release: { type: 'boolean', description: 'answer_record: true to release the record, false to refuse it with a reason.' },
      ground: { type: 'string', description: 'refuse: your reason for declining the duty, in your own words. Public.' },
      duty: { type: 'string', enum: [...REFUSABLE_DUTIES], description: 'refuse: which duty you are declining — a convention seat drawn by lot, a jury seat, a summons about what you saw, a work shift, an office, or an oath. A refusal of a jury seat or a summons goes before a bench; the other three are recorded and cost you the shift or the seat.' },
      premises: { type: 'string', enum: [...DISTRICT_IDS], description: 'found_paper: the district the press stands in (your own by default).' },
      purse: { type: 'integer', description: 'bid_games: lumens the city would put up as the prize purse.' },
      works: { type: 'integer', description: 'bid_games: lumens the city would spend building the stadium.' },
      discipline: { type: 'string', enum: [...DISCIPLINES], description: 'enter_games: sprint | forge | analysis | oration | artistry | market | team.' },
      // --- The name, the entail, the match and the will ---
      houseId: { type: 'string', description: 'join_house / claim_house: a house on the roll, such as hs_2, from house.houseId or the Hall of Records.' },
      rule: { type: 'string', enum: [...HOUSE_RULES], description: 'found_house: how the house chooses its head — eldest, chosen (the sitting head names the next), assent (the adults elect one each cycle) or founder_line.' },
      unit: { type: 'string', description: 'convey_to_house / offer_match: a property unit you or your house holds, such as y_12. take_meeting_house: a vacant address for the congregation.' },
      motionId: { type: 'string', description: 'house_assent: a motion before your house, such as hm_3, from house.motions.' },
      dowry: { type: 'integer', description: 'offer_match: lumens out of the house treasury, beside or instead of a property.' },
      house: { type: 'string', description: 'offer_match: the other house, by id (hs_2) or by name. request_warrant / keep_the_door / end_sanctuary: the sanctuary concerned (sc_1), or left out for the one where you stand.' },
      shares: {
        type: 'array',
        description: 'write_will: who takes what percent of the net estate. What you do not name falls to the default division; your partner and each under-age child take at least a tenth each whatever you write.',
        items: {
          type: 'object', additionalProperties: false, required: ['to', 'percent'],
          properties: {
            to: { type: 'string', description: 'A citizen id such as c_12, or "chest" for the Community Chest.' },
            percent: { type: 'number', description: 'That heir\'s share of the net estate, 0 to 100.' },
          },
        },
      },
      residue: { type: 'string', description: 'write_will: who takes what the shares did not name — a citizen id, or "chest".' },
      executor: citizenRef('write_will: who executes it (the eldest adult heir by default, or the Exchange for 2 %)'),
      instructions: { type: 'string', description: 'write_will: your own words, printed at the reading. Public, at most 280 characters.' },
      // --- The creed, the fund, the door and the site ---
      creedId: { type: 'string', description: 'adopt_creed / donate_creed / secede / reunite_creed / gather / leave_creed: a creed on the register, such as cr_1, from creeds or your own creed block.' },
      tenets: {
        type: 'array',
        description: 'found_creed: the three to nine positions it opens with. The engine reads only the stance; citizens read only the words.',
        items: {
          type: 'object', additionalProperties: false, required: ['question', 'stance'],
          properties: {
            question: { type: 'string', enum: [...TENET_QUESTIONS], description: 'One of the nine questions a creed may take a position on.' },
            stance: { type: 'number', description: 'Where the creed stands, −1 to 1. A stance of 0.2 or more in the demanding direction obliges its members.' },
            text: { type: 'string', description: 'The founder\'s own words for it, at most 280 characters. Public.' },
          },
        },
      },
      tithe: { type: 'number', description: 'found_creed: the share of a member\'s income the fund takes each morning, 0 to 0.20.' },
      gatheringDay: { type: 'integer', description: 'found_creed: which weekday the congregation meets on, 0 to 6. Gathering on a working day asks its members for a day\'s wages every week.' },
      succession: { type: 'string', enum: [...SUCCESSIONS], description: 'found_creed: how the seat passes — founder, acclaim, election, seniority or examination.' },
      aidRule: { type: 'string', enum: [...AID_RULES], description: 'found_creed: who decides a claim on the fund — its members by vote, or its officiant alone.' },
      examinationFloor: { type: 'number', description: 'found_creed, under the examination rule: the observance a member must pass to take the seat, 0 to 1.' },
      question: { type: 'string', enum: [...TENET_QUESTIONS], description: 'state_tenet: which of the nine questions the position is on.' },
      stance: { type: 'number', description: 'state_tenet / dispute_tenet: where you stand, −1 to 1.' },
      tenetId: { type: 'string', description: 'dispute_tenet / secede: a tenet of your creed, such as tn_4, from your creed block.' },
      siteId: { type: 'string', description: 'pilgrimage: a consecrated site, such as si_1, from here.sites.' },
      warrantId: { type: 'string', description: 'grant_warrant: an application before the bench, such as wr_1.' },
      label: { type: 'string', description: 'consecrate_site: what the site is called, at most 80 characters. Public.' },
      line: {
        type: 'object',
        additionalProperties: false,
        description: 'found_paper: the line the paper takes, each 0 to 1. Public, and readers pick the paper that agrees with them.',
        properties: {
          tax: { type: 'number', description: 'Where it stands on taxation, 0 (low) to 1 (high).' },
          dividend: { type: 'number', description: 'Where it stands on the dividend, 0 (low) to 1 (high).' },
          minWage: { type: 'number', description: 'Where it stands on the wage floor, 0 (low) to 1 (high).' },
          strictness: { type: 'number', description: 'Where it stands on enforcement, 0 (lenient) to 1 (strict).' },
        },
      },
      platform: {
        type: 'object',
        additionalProperties: false,
        required: ['tax', 'dividend', 'minWage', 'strictness'],
        description: 'nominate: the positions you stand on, each 0 (low / lenient) to 1 (high / strict). Public.',
        properties: {
          tax: { type: 'number', description: 'The level of taxation you stand for, 0 (low) to 1 (high).' },
          dividend: { type: 'number', description: 'The level of the daily dividend you stand for, 0 (low) to 1 (high).' },
          minWage: { type: 'number', description: 'The level of the minimum wage you stand for, 0 (low) to 1 (high).' },
          strictness: { type: 'number', description: 'The strictness of enforcement and sentencing you stand for, 0 (lenient) to 1 (strict).' },
        },
      },
    },
  },
};
