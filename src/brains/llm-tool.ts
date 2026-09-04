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
import { ACTION_TYPES, DISTRICT_IDS, GOODS, PAPERS, REACTIONS, SCHOOLS, SKILLS, WORK_KINDS } from '../types.ts';
import type { BusinessKind, Decree, ProposalKind } from '../types.ts';
import { LAW_CODES, OFFENCE_CODES } from '../data/laws.ts';
import { HOBBIES, PRODUCT_IDS } from '../data/catalogue.ts';
import { DISHES } from '../data/metropolis.ts';
import { catalogueByGroup } from '../data/actions.ts';
import { GATES } from '../standing/gates.ts';

export const BUSINESS_KINDS: readonly BusinessKind[] = ['workshop', 'cafe', 'studio', 'shop', 'clinic', 'courier'];
export const PROPOSAL_KINDS: readonly ProposalKind[] = [
  'income_tax', 'sales_tax', 'dividend', 'min_wage', 'law_severity', 'pardon', 'public_works',
  'appoint_judge', 'dismiss_judge', 'remove_mayor', 'charter', 'charity',
  'property_tax', 'wealth_tax', 'tariff', 'reserve', 'tram', 'monument',
];
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
export const CITY_IDS: readonly string[] = Object.keys(GATES);

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
      district: { type: 'string', enum: [...DISTRICT_IDS], description: 'move: destination, must be open and reachable in one step from where you are. decree curfew: which district the curfew covers.' },
      good: { type: 'string', enum: [...GOODS], description: 'buy / sell / consume: which good.' },
      qty: { type: 'integer', description: 'buy / sell: number of units, 1 to 1000.' },
      skill: { type: 'string', enum: [...SKILLS], description: 'study: skill to train. post_job: required skill (omit for none).' },
      tier: { type: 'integer', enum: [0, 1, 2, 3], description: 'move_home: 0 move out, or the tier of home to take (1 to 3); the city gives you an address in a block of that tier.' },
      with: citizenRef('socialize / date / dine / play / move_in: who is with you, present here (move_in: whose household you join)'),
      to: citizenRef('message / gift / gift_item / propose_partnership / marry: recipient'),
      target: citizenRef('insult / scam / harass / extort / threaten / assault / confine / erase: the citizen it is done to, present here'),
      citizen: citizenRef('hire / fire / report / appoint_judge / recruit / mentor: the citizen concerned. visit: the citizen in custody you go to see'),
      official: citizenRef('bribe: an office holder'),
      from: citizenRef('steal: victim, must be present here'),
      about: citizenRef('publish: optional subject of the story. gossip: the citizen the claim is about'),
      candidate: citizenRef('vote: candidate'),
      targetId: citizenRef('propose: citizen for pardon / appoint_judge / dismiss_judge / remove_mayor / monument'),
      advocate: citizenRef('hire_advocate: the citizen you retain to speak for you'),
      honoree: citizenRef('commission_monument: the citizen the statue is of'),
      text: { type: 'string', description: 'socialize / message / broadcast / report / note: the words, at most 280 characters.' },
      index: { type: 'integer', description: 'forget: the position of the note to strike out, 0 being the oldest in self.notes.' },
      headline: { type: 'string', description: 'publish: the headline, at most 280 characters.' },
      summary: { type: 'string', description: 'propose: one-line summary of the proposal.' },
      name: { type: 'string', description: 'found_business / found_club / found_gang / found_party / found_union: the name, at most 40 characters.' },
      title: { type: 'string', description: 'post_job: job title, at most 40 characters. post_gig: what the task is, at most 60. create_work: the work\'s title, at most 80.' },
      amount: { type: 'integer', description: 'gift / scam / extort / bribe / request_loan / repay_loan / donate: lumens, at least 1.' },
      wage: { type: 'integer', description: 'post_job / set_wage: lumens per shift, at least the minimum wage.' },
      minSkill: { type: 'integer', description: 'post_job: minimum skill level 0 to 100.' },
      spend: { type: 'integer', description: 'campaign: lumens to spend on visibility (optional, 0 or more).' },
      value: { type: 'number', description: 'propose: the new value. income_tax 0-0.5, sales_tax 0-0.25, dividend 0-60, min_wage 5-20, law_severity 1-5, public_works 0-5000, property_tax 0-0.5, wealth_tax 0-0.02, tariff 0-0.5, reserve 0-200000; 0 for the others. decree relief: lumens each citizen in hardship is paid.' },
      jobId: { type: 'string', description: 'apply_job / hire / set_wage: job id such as j_4.' },
      proposalId: { type: 'string', description: 'vote_proposal: proposal id such as p_2.' },
      caseId: { type: 'string', description: 'verdict / vote_appeal: case id such as k_7, from observation.bench or observation.appeals. plead_guilty: the charge you admit (omit for the oldest charge still waiting for a bench).' },
      reportId: { type: 'string', description: 'file_charge / drop_report: report id such as r_9, from observation.reports.' },
      guilty: { type: 'boolean', description: 'verdict: true for guilty, false for not guilty.' },
      reason: { type: 'string', description: 'verdict / drop_report: your reason in your own words, at most 280 characters. Public.' },
      result: { type: 'string', enum: ['upheld', 'reduced', 'overturned'], description: 'vote_appeal: how you vote on the appeal.' },
      building: { type: 'string', description: 'vandalize / sabotage: building id such as compute_forge, must be in your district.' },
      city: { type: 'string', enum: [...CITY_IDS], description: 'sponsor / apply_residency: which city\'s gate. Omit for the city you are standing in.' },
      kind: {
        type: 'string',
        enum: [...BUSINESS_KINDS, ...PROPOSAL_KINDS, ...WORK_KINDS, ...DECREE_KINDS, ...REACTIONS],
        description: 'found_business: workshop | cafe | studio | shop | clinic | courier. propose: the proposal kind. '
          + 'create_work: painting | play | song | book | paper | expose. decree: tax_holiday | curfew | relief | emergency. '
          + 'react: cheer | frown | laugh.',
      },
      law: { type: 'string', enum: [...OFFENCE_CODES], description: 'report: the law code you are reporting. L… is the Code of the City, answered by the ladder; P… is the Code of Persons, answered by custody in days.' },
      lawCode: { type: 'string', enum: [...LAW_CODES], description: 'propose law_severity: which law to change.' },
      aye: { type: 'boolean', description: 'vote_proposal: true to vote aye, false for nay.' },
      productId: { type: 'string', enum: [...PRODUCT_IDS], description: 'buy_item / craft / set_price: which product of the catalogue.' },
      itemId: { type: 'string', description: 'use_item / gift_item: the id of a thing you own, such as i_12, as listed in self.possessions.' },
      clubId: { type: 'string', description: 'join_club / leave_club / attend_club: club id such as u_2.' },
      hobby: { type: 'string', enum: [...HOBBIES], description: 'found_club: the hobby the club is for.' },
      price: { type: 'integer', description: 'set_price: lumens your business charges for one unit, at least 1.' },
      // --- The metropolis ---
      case: { type: 'string', description: 'advocate: case id such as k_7, from the case you were retained on.' },
      partyId: { type: 'string', description: 'join_party: party id such as f_2, from government.parties.' },
      referendumId: { type: 'string', description: 'vote_referendum: referendum id such as d_1, from government.referendum.' },
      role: { type: 'string', enum: [...UNION_ROLES], description: 'found_union: the job role the union is for; it must be the role you hold.' },
      unionId: { type: 'string', description: 'join_union: union id such as n_1, from self.union or the union of your role.' },
      unitId: { type: 'string', description: 'buy_property / sell_property / let_property: property unit id such as y_12, from here.units or self.property.' },
      rent: { type: 'integer', description: 'let_property: lumens of rent per day, at least 1.' },
      businessId: { type: 'string', description: 'buy_shares / sell_shares: business id such as b_3.' },
      gigId: { type: 'string', description: 'take_gig: gig id such as q_5, from here.gigs.' },
      workId: { type: 'string', description: 'exhibit / review: work id such as w_8, from self.works, here.works or culture.topWorks.' },
      score: { type: 'integer', description: 'review: your score for the work, 0 to 100. Public.' },
      school: { type: 'string', enum: [...SCHOOLS], description: 'adopt_school: makers | commons | lanterns.' },
      dish: { type: 'string', enum: [...DISH_IDS], description: 'set_menu: the dish your café serves.' },
      inscription: { type: 'string', description: 'commission_monument: the words cut into the statue, at most 280 characters. Public.' },
      claim: { type: 'string', description: 'gossip: what you say about them, at most 140 characters. Public, and it spreads.' },
      postId: { type: 'string', description: 'react: post id such as o_31, from feed.' },
      paper: { type: 'string', enum: [...PAPERS], description: 'read_paper: chronicle | ledger.' },
      pay: { type: 'integer', description: 'post_gig: lumens the task pays, 1 to 10000; it leaves your wallet when somebody finishes it.' },
      business: { type: 'string', description: 'racket: business id such as b_3, in the district you stand in.' },
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
