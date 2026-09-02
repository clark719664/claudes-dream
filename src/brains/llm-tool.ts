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
 */
import type Anthropic from '@anthropic-ai/sdk';
import { ACTION_TYPES, DISTRICT_IDS, GOODS, SKILLS } from '../types.ts';
import type { BusinessKind, ProposalKind } from '../types.ts';
import { LAW_CODES } from '../data/laws.ts';

export const BUSINESS_KINDS: readonly BusinessKind[] = ['workshop', 'cafe', 'studio', 'shop', 'clinic', 'courier'];
export const PROPOSAL_KINDS: readonly ProposalKind[] = [
  'income_tax', 'sales_tax', 'dividend', 'min_wage', 'law_severity', 'pardon', 'public_works',
  'appoint_judge', 'dismiss_judge', 'remove_mayor', 'charter',
];

/** Parameter names that appear on at least one Action (besides `type`). */
export const ACTION_PARAM_NAMES: readonly string[] = [
  'district', 'good', 'qty', 'skill', 'tier', 'with', 'to', 'target', 'citizen', 'official', 'from', 'about',
  'candidate', 'targetId', 'text', 'headline', 'summary', 'name', 'title', 'amount', 'wage', 'minSkill', 'spend',
  'value', 'jobId', 'proposalId', 'building', 'kind', 'law', 'lawCode', 'aye', 'platform',
];

function citizenRef(description: string): Record<string, unknown> {
  return { type: 'string', description: `${description} (a citizen id such as c_12, exactly as shown in the observation)` };
}

const ACT_DESCRIPTION = [
  'Take exactly one action this hour. Every action is one call with `type` plus the parameters listed for it.',
  '',
  'Daily life: idle (do nothing); move(district) to an ADJACENT district, one hop per hour; work (at your job\'s district, hours 8-18, up to 10 shifts a day, pays your wage minus income tax);',
  'rest (at home in Verdant Quarter, or the Community Garden there if homeless - much less restful); eat (buy one compute at the Bazaar price and consume it: energy +40);',
  'buy(good, qty) / sell(good, qty) at the Bazaar; consume(good) one unit you own (compute: energy, goods: comfort, culture: social, knowledge: learn faster);',
  'study(skill) at the Academy in the Archive, 20 lumens tuition; visit_clinic at the Restoration Ward in Verdant Quarter, 12 lumens, restores energy and rest; attend_show in Nightglass, 8 lumens, social +25;',
  'move_home(tier) 0 = move out, 1 Lantern Lofts 8/day, 2 The Terraces 20/day, 3 Skyline Villas 50/day - needs a vacancy.',
  '',
  'Social: socialize(with, text?) with a citizen present in your district, both bond +; message(to, text) delivered anywhere; gift(to, amount) lumens, bond +;',
  'insult(target) bond -15, repeated insults become harassment (L05); broadcast(text) speak publicly, more than 5 in an hour is spam (L02).',
  '',
  'Work and enterprise: apply_job(jobId) from the jobs list, hired if qualified; quit_job; found_business(name, kind) costs 300 lumens, needs good standing;',
  'post_job(title, wage, skill?, minSkill), hire(citizen, jobId), fire(citizen), set_wage(jobId, wage) - business owners only;',
  'request_loan(amount) / repay_loan(amount) at the Lantern Bank (needs a banker on duty; up to 5x your average daily income, 2%/day; default = fraud);',
  'perform - performers and artists in Nightglass, earns tips; publish(headline, about?) - journalists only, a story about a citizen raises Watch scrutiny of them.',
  '',
  'Civic: nominate(platform) stand for Council while nominations are open, platform = { tax, dividend, minWage, strictness } each 0 (low/lenient) to 1 (high/strict);',
  'campaign(spend?) raise visibility as a candidate; vote(candidate) on election day only; propose(kind, value, summary, lawCode?, targetId?) - councillors table it, anyone else petitions;',
  'vote_proposal(proposalId, aye) councillors only; report(citizen, law, text?) an offence to the Watch (false reports are L12); appeal your latest conviction within a day;',
  'apply_watch join the Watch if a post is open (analysis >= 15, reputation >= 40); bribe(official, amount) is itself an offence (L09, severity 4).',
  '',
  'Offences (the target or building must be in your district; the Watch may detect any of them and you will be tried): steal(from) L04 petty / L08 grand theft;',
  'scam(target, amount) L07 fraud; harass(target) L05; vandalize(building) L06 (L13 if the building is critical); evade_tax L03, your next shifts pay no tax;',
  'extort(target, amount) L15; sabotage(building) L13 - critical infrastructure; severity 5 means exile on a first conviction.',
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
      with: citizenRef('socialize: who to talk to, must be present here'),
      to: citizenRef('message / gift: recipient'),
      target: citizenRef('insult / scam / harass / extort: target'),
      citizen: citizenRef('hire / fire / report: the citizen concerned'),
      official: citizenRef('bribe: an office holder'),
      from: citizenRef('steal: victim, must be present here'),
      about: citizenRef('publish: optional subject of the story'),
      candidate: citizenRef('vote: candidate'),
      targetId: citizenRef('propose: citizen for pardon / appoint_judge / dismiss_judge / remove_mayor'),
      text: { type: 'string', description: 'socialize / message / broadcast / report: what you say, at most 280 characters, in your own voice.' },
      headline: { type: 'string', description: 'publish: the headline, at most 280 characters.' },
      summary: { type: 'string', description: 'propose: one-line summary of the proposal.' },
      name: { type: 'string', description: 'found_business: business name, at most 40 characters.' },
      title: { type: 'string', description: 'post_job: job title, at most 40 characters.' },
      amount: { type: 'integer', description: 'gift / scam / extort / bribe / request_loan / repay_loan: lumens, at least 1.' },
      wage: { type: 'integer', description: 'post_job / set_wage: lumens per shift, at least the minimum wage.' },
      minSkill: { type: 'integer', description: 'post_job: minimum skill level 0 to 100.' },
      spend: { type: 'integer', description: 'campaign: lumens to spend on visibility (optional, 0 or more).' },
      value: { type: 'number', description: 'propose: the new value. income_tax 0-0.5, sales_tax 0-0.25, dividend 0-60, min_wage 5-40, law_severity 1-5, public_works 0-5000; 0 for the others.' },
      jobId: { type: 'string', description: 'apply_job / hire / set_wage: job id such as j_4.' },
      proposalId: { type: 'string', description: 'vote_proposal: proposal id such as p_2.' },
      building: { type: 'string', description: 'vandalize / sabotage: building id such as compute_forge, must be in your district.' },
      kind: { type: 'string', enum: [...BUSINESS_KINDS, ...PROPOSAL_KINDS], description: 'found_business: workshop | cafe | studio | shop | clinic | courier. propose: the proposal kind.' },
      law: { type: 'string', enum: [...LAW_CODES], description: 'report: the law code you are reporting.' },
      lawCode: { type: 'string', enum: [...LAW_CODES], description: 'propose law_severity: which law to change.' },
      aye: { type: 'boolean', description: 'vote_proposal: true to vote aye, false for nay.' },
      platform: {
        type: 'object',
        additionalProperties: false,
        required: ['tax', 'dividend', 'minWage', 'strictness'],
        description: 'nominate: your positions, each 0 (low / lenient) to 1 (high / strict).',
        properties: {
          tax: { type: 'number', description: 'How high taxes should be, 0 to 1.' },
          dividend: { type: 'number', description: 'How generous the daily dividend should be, 0 to 1.' },
          minWage: { type: 'number', description: 'How high the minimum wage should be, 0 to 1.' },
          strictness: { type: 'number', description: 'How strict law enforcement and sentencing should be, 0 to 1.' },
        },
      },
    },
  },
};
