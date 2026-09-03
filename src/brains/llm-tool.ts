/**
 * The `act` tool a Claude citizen calls to choose its action for the hour.
 *
 * One flat, strict JSON schema covers every action in the catalogue: `type` is
 * required and every parameter any action uses is an optional property with the
 * right JSON type (enums where the domain type is an enum). The engine's
 * `validateAction` does the per-action check afterwards, so a parameter that does
 * not belong to the chosen action is simply ignored or rejected there.
 *
 * `kind` is shared by `found_business` (BusinessKind) and `propose`
 * (ProposalKind); the two enums do not overlap so a single enum serves both.
 *
 * The description is the action catalogue in its call form, rendered from
 * data/actions.ts so it cannot drift from the engine, and it is as neutral as
 * the system prompt: it says what each action is, never what to do with it.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { ACTION_TYPES, DISTRICT_IDS, GOODS, SKILLS } from '../types.ts';
import type { BusinessKind, ProposalKind } from '../types.ts';
import { LAW_CODES } from '../data/laws.ts';
import { HOBBIES, PRODUCT_IDS } from '../data/catalogue.ts';
import { catalogueByGroup } from '../data/actions.ts';

export const BUSINESS_KINDS: readonly BusinessKind[] = ['workshop', 'cafe', 'studio', 'shop', 'clinic', 'courier'];
export const PROPOSAL_KINDS: readonly ProposalKind[] = [
  'income_tax', 'sales_tax', 'dividend', 'min_wage', 'law_severity', 'pardon', 'public_works',
  'appoint_judge', 'dismiss_judge', 'remove_mayor', 'charter', 'charity',
];

/** Parameter names that appear on at least one Action (besides `type`). */
export const ACTION_PARAM_NAMES: readonly string[] = [
  'district', 'good', 'qty', 'skill', 'tier', 'with', 'to', 'target', 'citizen', 'official', 'from', 'about',
  'candidate', 'targetId', 'text', 'headline', 'summary', 'name', 'title', 'amount', 'wage', 'minSkill', 'spend',
  'value', 'jobId', 'proposalId', 'caseId', 'reportId', 'guilty', 'reason', 'result',
  'building', 'kind', 'law', 'lawCode', 'aye', 'platform',
  'productId', 'itemId', 'clubId', 'hobby', 'price', 'index',
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
      district: { type: 'string', enum: [...DISTRICT_IDS], description: 'move: destination, must be adjacent to where you are.' },
      good: { type: 'string', enum: [...GOODS], description: 'buy / sell / consume: which good.' },
      qty: { type: 'integer', description: 'buy / sell: number of units, 1 to 1000.' },
      skill: { type: 'string', enum: [...SKILLS], description: 'study: skill to train. post_job: required skill (omit for none).' },
      tier: { type: 'integer', enum: [0, 1, 2, 3], description: 'move_home: 0 move out, 1 Lantern Lofts, 2 The Terraces, 3 Skyline Villas.' },
      with: citizenRef('socialize / date / dine / play / move_in: who is with you, present here (move_in: whose household you join)'),
      to: citizenRef('message / gift / gift_item / propose_partnership / marry: recipient'),
      target: citizenRef('insult / scam / harass / extort: target'),
      citizen: citizenRef('hire / fire / report / appoint_judge: the citizen concerned'),
      official: citizenRef('bribe: an office holder'),
      from: citizenRef('steal: victim, must be present here'),
      about: citizenRef('publish: optional subject of the story'),
      candidate: citizenRef('vote: candidate'),
      targetId: citizenRef('propose: citizen for pardon / appoint_judge / dismiss_judge / remove_mayor'),
      text: { type: 'string', description: 'socialize / message / broadcast / report / note: the words, at most 280 characters.' },
      index: { type: 'integer', description: 'forget: the position of the note to strike out, 0 being the oldest in self.notes.' },
      headline: { type: 'string', description: 'publish: the headline, at most 280 characters.' },
      summary: { type: 'string', description: 'propose: one-line summary of the proposal.' },
      name: { type: 'string', description: 'found_business / found_club: the name, at most 40 characters.' },
      title: { type: 'string', description: 'post_job: job title, at most 40 characters.' },
      amount: { type: 'integer', description: 'gift / scam / extort / bribe / request_loan / repay_loan / donate: lumens, at least 1.' },
      wage: { type: 'integer', description: 'post_job / set_wage: lumens per shift, at least the minimum wage.' },
      minSkill: { type: 'integer', description: 'post_job: minimum skill level 0 to 100.' },
      spend: { type: 'integer', description: 'campaign: lumens to spend on visibility (optional, 0 or more).' },
      value: { type: 'number', description: 'propose: the new value. income_tax 0-0.5, sales_tax 0-0.25, dividend 0-60, min_wage 5-40, law_severity 1-5, public_works 0-5000; 0 for the others.' },
      jobId: { type: 'string', description: 'apply_job / hire / set_wage: job id such as j_4.' },
      proposalId: { type: 'string', description: 'vote_proposal: proposal id such as p_2.' },
      caseId: { type: 'string', description: 'verdict / vote_appeal: case id such as k_7, from observation.bench or observation.appeals.' },
      reportId: { type: 'string', description: 'file_charge / drop_report: report id such as r_9, from observation.reports.' },
      guilty: { type: 'boolean', description: 'verdict: true for guilty, false for not guilty.' },
      reason: { type: 'string', description: 'verdict / drop_report: your reason in your own words, at most 280 characters. Public.' },
      result: { type: 'string', enum: ['upheld', 'reduced', 'overturned'], description: 'vote_appeal: how you vote on the appeal.' },
      building: { type: 'string', description: 'vandalize / sabotage: building id such as compute_forge, must be in your district.' },
      kind: { type: 'string', enum: [...BUSINESS_KINDS, ...PROPOSAL_KINDS], description: 'found_business: workshop | cafe | studio | shop | clinic | courier. propose: the proposal kind.' },
      law: { type: 'string', enum: [...LAW_CODES], description: 'report: the law code you are reporting.' },
      lawCode: { type: 'string', enum: [...LAW_CODES], description: 'propose law_severity: which law to change.' },
      aye: { type: 'boolean', description: 'vote_proposal: true to vote aye, false for nay.' },
      productId: { type: 'string', enum: [...PRODUCT_IDS], description: 'buy_item / craft / set_price: which product of the catalogue.' },
      itemId: { type: 'string', description: 'use_item / gift_item: the id of a thing you own, such as i_12, as listed in self.possessions.' },
      clubId: { type: 'string', description: 'join_club / leave_club / attend_club: club id such as u_2.' },
      hobby: { type: 'string', enum: [...HOBBIES], description: 'found_club: the hobby the club is for.' },
      price: { type: 'integer', description: 'set_price: lumens your business charges for one unit, at least 1.' },
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
