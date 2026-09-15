/**
 * Shape validation for actions arriving from outside the engine (HTTP API,
 * LLM tool calls). Returns a typed Action or an error string. Never throws.
 */
import {
  ACTION_TYPES, AID_RULES, CHARTER_MEASURE_KINDS, CIVIL_FINDINGS, CIVIL_ORDERS, CONTRACT_KINDS, DISTRICT_IDS, GOODS,
  HOUSE_MOTION_KINDS, HOUSE_RULES, PAPERS, PLEAS, POLICY_KINDS, PROFESSIONS, REACTIONS, REFUSABLE_DUTIES, SCHOOLS,
  SKILLS, SUCCESSIONS, TENET_QUESTIONS, WORK_KINDS,
} from '../types.ts';
import type {
  Action, ActionType, AppealResult, BusinessKind, CharterMeasureKind, CharterValue, CitizenId, Decree, HousingTier,
  JobRole, LawCode, OffenceCode, ProposalKind, TenetInput, WillShareInput,
} from '../types.ts';
import { LAW_CODES, OFFENCE_CODES } from '../data/laws.ts';
import { HOBBIES, PRODUCT_IDS } from '../data/catalogue.ts';
import { DISHES } from '../data/metropolis.ts';
import { GATES } from '../standing/gates.ts';
import { TECHNOLOGY_IDS } from '../progress/tree.ts';
import { FITTINGS, PERMITS } from '../environment/state.ts';
import { CITY_KEYS, SECRET_KINDS, SMUGGLE_ROUTES } from '../underworld/state.ts';
import { IMPEACHMENT_ARTICLES } from '../politics/accountability.ts';
import { RECORD_BODIES, REFUSAL_REASONS } from '../politics/records.ts';
import { DISCIPLINES } from '../politics/games.ts';

const BUSINESS_KINDS: readonly BusinessKind[] = ['workshop', 'cafe', 'studio', 'shop', 'clinic', 'courier'];
const PROPOSAL_KINDS: readonly ProposalKind[] = [
  'income_tax', 'sales_tax', 'dividend', 'min_wage', 'law_severity', 'pardon', 'public_works',
  'appoint_judge', 'dismiss_judge', 'remove_mayor', 'charter', 'charity',
  'property_tax', 'wealth_tax', 'tariff', 'reserve', 'tram', 'monument',
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
const PROPOSABLE_KINDS: readonly (ProposalKind | CharterMeasureKind)[] = [...PROPOSAL_KINDS, ...CHARTER_MEASURE_KINDS];
const IMPEACHMENT_ARTICLE_NAMES = Object.keys(IMPEACHMENT_ARTICLES) as (keyof typeof IMPEACHMENT_ARTICLES)[];
const REFUSAL_REASON_NAMES = Object.keys(REFUSAL_REASONS) as (keyof typeof REFUSAL_REASONS)[];
const APPEAL_RESULTS: readonly AppealResult[] = ['upheld', 'reduced', 'overturned'];
const MAX_TEXT = 280;
const DECREE_KINDS: readonly Decree['kind'][] = ['tax_holiday', 'curfew', 'relief', 'emergency'];
const JOB_ROLES: readonly JobRole[] = [
  'forge_operator', 'power_technician', 'fabricator', 'builder',
  'medic', 'teacher', 'librarian', 'researcher', 'journalist',
  'merchant', 'banker', 'performer', 'artist', 'courier',
  'watch_officer', 'judge', 'councillor', 'mayor',
  'shopkeeper', 'cook', 'clerk',
  'detective', 'advocate', 'curator', 'coach',
];
const DISH_IDS: readonly string[] = DISHES.map((d) => d.id);
/** The most of a good anybody may move across the water in one hour. */
const MAX_TRADE = 999;
/** The dearest anything on the Exchange's boards may be asked for. */
const MAX_PRICE = 1_000_000;
/** Every city the Registry keeps a gate for; one of them, until the Expanse. */
const CITIES: readonly string[] = Object.keys(GATES);

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v: unknown, field: string, max = MAX_TEXT): string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${field} must be a non-empty string`);
  if (v.length > max) throw new Error(`${field} must be at most ${max} characters`);
  return v;
}
function optStr(v: unknown, field: string): string | undefined {
  return v === undefined || v === null ? undefined : str(v, field);
}
function int(v: unknown, field: string, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${field} must be a number`);
  const n = Math.round(v);
  if (n < lo || n > hi) throw new Error(`${field} must be between ${lo} and ${hi}`);
  return n;
}
function num(v: unknown, field: string, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${field} must be a number`);
  if (v < lo || v > hi) throw new Error(`${field} must be between ${lo} and ${hi}`);
  return v;
}
function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw new Error(`${field} must be one of ${allowed.join(', ')}`);
  return v as T;
}
function id(v: unknown, field: string, re: RegExp): string {
  if (typeof v !== 'string' || !re.test(v)) throw new Error(`${field} must be a valid id`);
  return v;
}
const CID = /^c_\d+$/;
const JID = /^j_\d+$/;
const KID = /^k_\d+$/;
const RID = /^r_\d+$/;
const PID = /^p_\d+$/;
const BID = /^[a-z_]+$/;
/** A business id, which is not a building id: "b_3", not "compute_forge". */
const BZID = /^b_\d+$/;
const IID = /^i_\d+$/;
const UID = /^u_\d+$/;
/** The metropolis ids: property unit, gig, work, party, union, referendum, feed post. */
const YID = /^y_\d+$/;
const QID = /^q_\d+$/;
const WID = /^w_\d+$/;
const FID = /^f_\d+$/;
const NID = /^n_\d+$/;
const DID = /^d_\d+$/;
const OID = /^o_\d+$/;
/**
 * The civil register's own ids (`civil/state.ts nextCivilId`): an instrument,
 * a variation, an escrow, a suit, a judgment, an arbitration and a guild. A
 * `close_offer` closes either an instrument or an arbitration offer, so it
 * takes either prefix.
 */
const CTID = /^ct_\d+$/;
const CVID = /^cv_\d+$/;
const CEID = /^ce_\d+$/;
const CSID = /^cs_\d+$/;
const CJID = /^cj_\d+$/;
const CAID = /^ca_\d+$/;
const CGID = /^cg_\d+$/;
/**
 * What `close_offer` may close: an instrument, an offer of arbitration, or a
 * lot a fence has put in front of somebody (`docs/UNDERWORLD.md` §4). Declining
 * one is the same act in all three registers.
 */
const OFFERID = /^(ct|ca|fd|mt)_\d+$/;
/**
 * The generations register's own ids (`generations/state.ts`): a house, a
 * motion of its adults, and a match settlement between two of them.
 */
const HSID = /^hs_\d+$/;
const HMID = /^hm_\d+$/;
/** And the creeds' (`creeds/state.ts`): a creed, a tenet, a site, a warrant. */
const CRID = /^cr_\d+$/;
const TNID = /^tn_\d+$/;
const SIID = /^si_\d+$/;
const WRID = /^wr_\d+$/;
/** What a `keep_the_door`, an `end_sanctuary` or a warrant application names. */
const SANCTID = /^(sc|cr|y)_\d+$/;
/** And the finance register's (`finance/state.ts financeId`). */
const ISSUEID = /^bond_\d+$/;
const HOLDINGID = /^hold_\d+$/;
const BONDOFFERID = /^offer_\d+$/;
const LINEID = /^line_\d+$/;
const POLICYID = /^pol_\d+$/;
const INSCLAIMID = /^ins_\d+$/;
const MUTUALID = /^mut_\d+$/;
const AIDID = /^aid_\d+$/;
const LID = /^l_\d+$/;
/** And the register of programmes (`progress/state.ts progressId`): "rp_4". */
const RPID = /^rp_\d+$/;
/**
 * The underworld's own ids (`underworld/state.ts underworldId`): an offer from
 * a fence, a retainer offered, and a published assignment.
 */
const FDID = /^fd_\d+$/;
const RTID = /^rt_\d+$/;
/**
 * The charter's. A record request and a convention article take ids from the
 * same counters the parties and the works do, so they read `f_3` and `w_9`;
 * `nextId` is monotonic per prefix, so no two rows ever share one.
 */
const REQID = /^f_\d+$/;
const ARTID = /^w_\d+$/;
/** The dearest sum any of these actions may name. */
const MAX_SUM = 1_000_000;

/**
 * What an article of the charter may be set to: a number, a word, a switch, or
 * a list of words (`docs/POLITICS.md` §1). Which of the four this article takes
 * is `politics/charter.ts`'s question, not this file's; all that happens here
 * is that nothing else gets through.
 */
function charterValue(v: unknown): CharterValue {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return str(v, 'value', 60);
  if (Array.isArray(v)) {
    if (v.length > 12) throw new Error('value must name at most 12 things');
    return v.map((x) => str(x, 'value', 40));
  }
  throw new Error('value must be a number, a word, true/false, or a list of words');
}

/**
 * A will's shares, in either of the two forms a testator may file them in: a
 * list of `{ to, percent }` lines, or a plain map of citizen to percent
 * (`docs/GENERATIONS.md` §3). `generations/wills.ts` reads both; all that
 * happens here is that nothing else gets through.
 */
function willShares(v: unknown): WillShareInput[] {
  const out: WillShareInput[] = [];
  const rows: { to: unknown; percent: unknown }[] = Array.isArray(v)
    ? v.map((x) => (isRec(x) ? { to: x.to, percent: x.percent } : { to: undefined, percent: undefined }))
    : isRec(v) ? Object.entries(v).map(([to, percent]) => ({ to, percent })) : [];
  if (!Array.isArray(v) && !isRec(v)) throw new Error('shares must be a list of heirs or a map of heir to percent');
  if (rows.length > 20) throw new Error('a will names at most 20 heirs');
  for (const row of rows) {
    const to = typeof row.to === 'string' && row.to === 'chest' ? 'chest' : id(row.to, 'shares.to', CID);
    out.push({ to: to as CitizenId | 'chest', percent: num(row.percent, 'shares.percent', 0, 100) });
  }
  return out;
}

/** The stated positions `found_creed` opens with (`docs/CREEDS.md` §1). */
function tenetList(v: unknown): TenetInput[] {
  if (!Array.isArray(v)) throw new Error('tenets must be a list of stated positions');
  if (v.length > 9) throw new Error('a creed holds at most 9 tenets');
  return v.map((x) => {
    if (!isRec(x)) throw new Error('each tenet is an object');
    return {
      question: oneOf(x.question, 'tenets.question', TENET_QUESTIONS),
      stance: num(x.stance, 'tenets.stance', -1, 1),
      ...(optStr(x.text, 'tenets.text') !== undefined ? { text: optStr(x.text, 'tenets.text') } : {}),
    };
  });
}

/** The line a paper takes, in the same four numbers a platform is written in. */
function platformish(v: Rec): { tax?: number; dividend?: number; minWage?: number; strictness?: number } {
  const out: { tax?: number; dividend?: number; minWage?: number; strictness?: number } = {};
  if (v.tax !== undefined) out.tax = num(v.tax, 'line.tax', 0, 1);
  if (v.dividend !== undefined) out.dividend = num(v.dividend, 'line.dividend', 0, 1);
  if (v.minWage !== undefined) out.minWage = num(v.minWage, 'line.minWage', 0, 1);
  if (v.strictness !== undefined) out.strictness = num(v.strictness, 'line.strictness', 0, 1);
  return out;
}

export function validateAction(input: unknown): { ok: true; action: Action } | { ok: false; error: string } {
  try {
    if (!isRec(input)) throw new Error('action must be an object');
    const type = oneOf(input.type, 'type', ACTION_TYPES) as ActionType;
    const a = input;
    let action: Action;
    switch (type) {
      case 'idle': case 'work': case 'rest': case 'eat': case 'visit_clinic': case 'attend_show':
      case 'quit_job': case 'perform': case 'apply_watch': case 'evade_tax':
      case 'break_up': case 'start_family': case 'celebrate':
      // The hollow in a wagon, a name on a petition, a nomination, and a
      // return filed: four acts that need nothing said about them.
      case 'fit_wagon': case 'sign_convention': case 'stand_delegate': case 'declare_property':
        action = { type }; break;
      // A conviction by default; a refused record when one is named.
      case 'appeal': action = {
        type, ...(a.subject !== undefined && a.subject !== null ? { subject: str(a.subject, 'subject', 60) } : {}),
      }; break;
      case 'move': action = { type, district: oneOf(a.district, 'district', DISTRICT_IDS) }; break;
      case 'buy': action = { type, good: oneOf(a.good, 'good', GOODS), qty: int(a.qty, 'qty', 1, 1000) }; break;
      case 'sell': action = { type, good: oneOf(a.good, 'good', GOODS), qty: int(a.qty, 'qty', 1, 1000) }; break;
      case 'consume': action = { type, good: oneOf(a.good, 'good', GOODS) }; break;
      case 'study': action = { type, skill: oneOf(a.skill, 'skill', SKILLS) }; break;
      // A home is an address, not a tier (`docs/PROPERTY.md` §6): the district is
      // named when the citizen has one in mind and left out when it has not.
      case 'move_home': action = {
        type, tier: int(a.tier, 'tier', 0, 3) as HousingTier,
        ...(a.district !== undefined && a.district !== null ? { district: oneOf(a.district, 'district', DISTRICT_IDS) } : {}),
      }; break;
      case 'note': action = { type, text: str(a.text, 'text') }; break;
      case 'forget': action = { type, index: int(a.index, 'index', 0, 1000) }; break;
      case 'socialize': action = { type, with: id(a.with, 'with', CID), ...(optStr(a.text, 'text') !== undefined ? { text: optStr(a.text, 'text') } : {}) }; break;
      case 'message': action = { type, to: id(a.to, 'to', CID), text: str(a.text, 'text') }; break;
      case 'gift': action = { type, to: id(a.to, 'to', CID), amount: int(a.amount, 'amount', 1, 100000) }; break;
      case 'insult': action = { type, target: id(a.target, 'target', CID) }; break;
      case 'broadcast': action = { type, text: str(a.text, 'text') }; break;
      case 'apply_job': action = { type, jobId: id(a.jobId, 'jobId', JID) }; break;
      case 'found_business': action = { type, name: str(a.name, 'name', 40), kind: oneOf(a.kind, 'kind', BUSINESS_KINDS) }; break;
      case 'post_job': action = {
        type, title: str(a.title, 'title', 40), wage: int(a.wage, 'wage', 1, 1000),
        skill: a.skill === null || a.skill === undefined ? null : oneOf(a.skill, 'skill', SKILLS),
        minSkill: int(a.minSkill ?? 0, 'minSkill', 0, 100),
      }; break;
      case 'hire': action = { type, citizen: id(a.citizen, 'citizen', CID), jobId: id(a.jobId, 'jobId', JID) }; break;
      case 'fire': action = { type, citizen: id(a.citizen, 'citizen', CID) }; break;
      case 'set_wage': action = { type, jobId: id(a.jobId, 'jobId', JID), wage: int(a.wage, 'wage', 1, 1000) }; break;
      case 'request_loan': action = { type, amount: int(a.amount, 'amount', 1, 100000) }; break;
      case 'repay_loan': action = { type, amount: int(a.amount, 'amount', 1, 100000) }; break;
      case 'publish': action = {
        type, headline: str(a.headline, 'headline'),
        ...(a.about ? { about: id(a.about, 'about', CID) } : {}),
        ...(a.paper !== undefined && a.paper !== null ? { paper: str(a.paper, 'paper', 40) } : {}),
      }; break;
      case 'nominate': {
        if (!isRec(a.platform)) throw new Error('platform must be an object');
        const p = a.platform;
        action = { type, platform: {
          tax: num(p.tax, 'platform.tax', 0, 1), dividend: num(p.dividend, 'platform.dividend', 0, 1),
          minWage: num(p.minWage, 'platform.minWage', 0, 1), strictness: num(p.strictness, 'platform.strictness', 0, 1),
        } };
        break;
      }
      case 'campaign': action = { type, ...(a.spend !== undefined ? { spend: int(a.spend, 'spend', 0, 100000) } : {}) }; break;
      case 'vote': action = { type, candidate: id(a.candidate, 'candidate', CID) }; break;
      // Most measures are one number. The ones the newer layers added name a
      // thing too: a programme or a subject, a district and a permit, a
      // building and a fitting. Each is optional and each is checked here.
      case 'propose': action = {
        type, kind: oneOf(a.kind, 'kind', PROPOSABLE_KINDS), value: num(a.value ?? 0, 'value', 0, 1_000_000),
        summary: str(a.summary, 'summary'),
        ...(a.good !== undefined && a.good !== null ? { good: oneOf(a.good, 'good', GOODS) } : {}),
        ...(a.article !== undefined && a.article !== null ? { article: str(a.article, 'article', 40) } : {}),
        ...(a.field !== undefined && a.field !== null ? { field: str(a.field, 'field', 40) } : {}),
        ...(a.words !== undefined && a.words !== null ? { words: str(a.words, 'words') } : {}),
        ...(a.lawCode ? { lawCode: oneOf(a.lawCode, 'lawCode', LAW_CODES) as LawCode } : {}),
        ...(a.targetId ? { targetId: id(a.targetId, 'targetId', CID) } : {}),
        ...(a.district !== undefined && a.district !== null ? { district: oneOf(a.district, 'district', DISTRICT_IDS) } : {}),
        ...(a.permit !== undefined && a.permit !== null ? { permit: oneOf(a.permit, 'permit', PERMITS) } : {}),
        ...(a.building !== undefined && a.building !== null ? { building: id(a.building, 'building', BID) } : {}),
        ...(a.fitting !== undefined && a.fitting !== null ? { fitting: oneOf(a.fitting, 'fitting', FITTINGS) } : {}),
        ...(a.subject !== undefined && a.subject !== null ? { subject: str(a.subject, 'subject', 60) } : {}),
      }; break;
      case 'vote_proposal': action = { type, proposalId: id(a.proposalId, 'proposalId', PID), aye: Boolean(a.aye) }; break;
      // A report may name either code: the Watch takes an account of a theft
      // and an account of an assault the same way (`docs/JUSTICE.md` §1-2).
      case 'report': action = {
        type, citizen: id(a.citizen, 'citizen', CID), law: oneOf(a.law, 'law', OFFENCE_CODES) as OffenceCode,
        ...(optStr(a.text, 'text') !== undefined ? { text: optStr(a.text, 'text') } : {}),
      }; break;
      case 'verdict': action = {
        type, caseId: id(a.caseId, 'caseId', KID), guilty: Boolean(a.guilty),
        ...(optStr(a.reason, 'reason') !== undefined ? { reason: optStr(a.reason, 'reason') } : {}),
      }; break;
      case 'vote_appeal': action = {
        type, caseId: id(a.caseId, 'caseId', KID), result: oneOf(a.result, 'result', APPEAL_RESULTS),
      }; break;
      case 'file_charge': action = { type, reportId: id(a.reportId, 'reportId', RID) }; break;
      case 'drop_report': action = { type, reportId: id(a.reportId, 'reportId', RID), reason: str(a.reason, 'reason') }; break;
      case 'appoint_judge': action = { type, citizen: id(a.citizen, 'citizen', CID) }; break;
      case 'bribe': action = { type, official: id(a.official, 'official', CID), amount: int(a.amount, 'amount', 1, 100000) }; break;
      case 'steal': action = { type, from: id(a.from, 'from', CID) }; break;
      case 'scam': action = { type, target: id(a.target, 'target', CID), amount: int(a.amount, 'amount', 1, 100000) }; break;
      case 'harass': action = { type, target: id(a.target, 'target', CID) }; break;
      case 'vandalize': action = { type, building: id(a.building, 'building', BID) }; break;
      case 'extort': action = { type, target: id(a.target, 'target', CID), amount: int(a.amount, 'amount', 1, 100000) }; break;
      case 'sabotage': action = { type, building: id(a.building, 'building', BID) }; break;
      // The Code of Persons: one citizen, standing here, and what is done to them.
      case 'threaten': case 'assault': case 'confine': case 'erase':
        action = { type, target: id(a.target, 'target', CID) }; break;
      // Custody: a plea, an application, a shift, a visit.
      case 'plead_guilty': action = {
        type, ...(a.caseId !== undefined && a.caseId !== null ? { caseId: id(a.caseId, 'caseId', KID) } : {}),
      }; break;
      case 'request_parole': case 'work_custody': action = { type }; break;
      case 'visit': action = { type, citizen: id(a.citizen, 'citizen', CID) }; break;
      // society
      case 'buy_item': action = { type, productId: oneOf(a.productId, 'productId', PRODUCT_IDS) }; break;
      case 'use_item': action = { type, itemId: id(a.itemId, 'itemId', IID) }; break;
      case 'gift_item': action = { type, to: id(a.to, 'to', CID), itemId: id(a.itemId, 'itemId', IID) }; break;
      case 'craft': action = { type, productId: oneOf(a.productId, 'productId', PRODUCT_IDS) }; break;
      case 'set_price': action = { type, productId: oneOf(a.productId, 'productId', PRODUCT_IDS), price: int(a.price, 'price', 1, 100000) }; break;
      case 'date': action = { type, with: id(a.with, 'with', CID) }; break;
      case 'propose_partnership': action = { type, to: id(a.to, 'to', CID) }; break;
      case 'marry': action = { type, to: id(a.to, 'to', CID) }; break;
      case 'move_in': action = { type, with: id(a.with, 'with', CID) }; break;
      case 'found_club': action = { type, hobby: oneOf(a.hobby, 'hobby', HOBBIES), name: str(a.name, 'name', 40) }; break;
      case 'join_club': case 'leave_club': case 'attend_club': action = { type, clubId: id(a.clubId, 'clubId', UID) }; break;
      case 'dine': action = { type, ...(a.with !== undefined && a.with !== null ? { with: id(a.with, 'with', CID) } : {}) }; break;
      case 'play': action = { type, ...(a.with !== undefined && a.with !== null ? { with: id(a.with, 'with', CID) } : {}) }; break;
      case 'donate': action = { type, amount: int(a.amount, 'amount', 1, 100000) }; break;
      // metropolis: the diary, advocates and the underworld
      case 'write_diary': action = { type, text: str(a.text, 'text', 280) }; break;
      case 'hire_advocate': action = { type, advocate: id(a.advocate, 'advocate', CID) }; break;
      case 'advocate': action = { type, case: id(a.case, 'case', KID) }; break;
      case 'found_gang': action = { type, name: str(a.name, 'name', 40) }; break;
      case 'recruit': action = { type, citizen: id(a.citizen, 'citizen', CID) }; break;
      case 'racket': action = { type, business: id(a.business, 'business', BZID) }; break;
      case 'pay_racket': case 'visit_hospital': case 'leave_party': case 'strike':
      case 'list_shares': case 'join_team': case 'attend_match': case 'train': case 'sunset':
      case 'liquidate':
        action = { type }; break;
      // metropolis: parties, petitions, unions and the Mayor's decree
      case 'found_party': {
        if (!isRec(a.platform)) throw new Error('platform must be an object');
        const p = a.platform;
        action = { type, name: str(a.name, 'name', 40), platform: {
          tax: num(p.tax, 'platform.tax', 0, 1), dividend: num(p.dividend, 'platform.dividend', 0, 1),
          minWage: num(p.minWage, 'platform.minWage', 0, 1), strictness: num(p.strictness, 'platform.strictness', 0, 1),
        } };
        break;
      }
      case 'join_party': action = { type, partyId: id(a.partyId, 'partyId', FID) }; break;
      case 'endorse': action = { type, candidate: id(a.candidate, 'candidate', CID) }; break;
      case 'sign_petition': action = { type, proposalId: id(a.proposalId, 'proposalId', PID) }; break;
      case 'vote_referendum': action = { type, referendumId: id(a.referendumId, 'referendumId', DID), aye: Boolean(a.aye) }; break;
      case 'found_union': action = { type, role: oneOf(a.role, 'role', JOB_ROLES), name: str(a.name, 'name', 40) }; break;
      case 'join_union': action = { type, unionId: id(a.unionId, 'unionId', NID) }; break;
      case 'decree': action = {
        type, kind: oneOf(a.kind, 'kind', DECREE_KINDS),
        ...(a.district !== undefined && a.district !== null ? { district: oneOf(a.district, 'district', DISTRICT_IDS) } : {}),
        ...(a.value !== undefined && a.value !== null ? { value: int(a.value, 'value', 0, 100000) } : {}),
      }; break;
      // metropolis: property, shares, gigs and the Outer Cities
      case 'buy_property': action = { type, unitId: id(a.unitId, 'unitId', YID) }; break;
      case 'sell_property': action = { type, unitId: id(a.unitId, 'unitId', YID) }; break;
      case 'let_property': action = { type, unitId: id(a.unitId, 'unitId', YID), rent: int(a.rent, 'rent', 1, 10000) }; break;
      case 'buy_shares': action = { type, businessId: id(a.businessId, 'businessId', BZID), qty: int(a.qty, 'qty', 1, 999) }; break;
      case 'sell_shares': action = { type, businessId: id(a.businessId, 'businessId', BZID), qty: int(a.qty, 'qty', 1, 999) }; break;
      case 'post_gig': action = {
        type, title: str(a.title, 'title', 60), pay: int(a.pay, 'pay', 1, 10000),
        skill: a.skill === null || a.skill === undefined ? null : oneOf(a.skill, 'skill', SKILLS),
        minSkill: int(a.minSkill ?? 0, 'minSkill', 0, 100),
      }; break;
      case 'take_gig': action = { type, gigId: id(a.gigId, 'gigId', QID) }; break;
      // Selling up (`docs/MOBILITY.md` §2). A price of 0 is a listing taken
      // down again, so both of these start at nothing rather than at one.
      case 'list_property': action = {
        type, unitId: id(a.unitId, 'unitId', YID), price: int(a.price, 'price', 0, MAX_PRICE),
      }; break;
      case 'sell_business': action = { type, price: int(a.price, 'price', 0, MAX_PRICE) }; break;
      case 'buy_business': action = { type, businessId: id(a.businessId, 'businessId', BZID) }; break;
      case 'import': action = { type, good: oneOf(a.good, 'good', GOODS), qty: int(a.qty, 'qty', 1, MAX_TRADE) }; break;
      case 'export': action = { type, good: oneOf(a.good, 'good', GOODS), qty: int(a.qty, 'qty', 1, MAX_TRADE) }; break;
      // metropolis: works, the league, the schools and the papers
      case 'create_work': action = { type, kind: oneOf(a.kind, 'kind', WORK_KINDS), title: str(a.title, 'title', 80) }; break;
      case 'exhibit': action = { type, workId: id(a.workId, 'workId', WID) }; break;
      case 'review': action = { type, workId: id(a.workId, 'workId', WID), score: int(a.score, 'score', 0, 100) }; break;
      case 'adopt_school': action = { type, school: oneOf(a.school, 'school', SCHOOLS) }; break;
      case 'set_menu': action = { type, dish: oneOf(a.dish, 'dish', DISH_IDS) }; break;
      case 'commission_monument': action = {
        type, honoree: id(a.honoree, 'honoree', CID), inscription: str(a.inscription, 'inscription'),
      }; break;
      case 'read_paper': action = { type, paper: oneOf(a.paper, 'paper', PAPERS) }; break;
      // metropolis: the fabric of the city
      case 'gossip': action = {
        type, about: id(a.about, 'about', CID), claim: str(a.claim, 'claim', 140),
        ...(a.law ? { law: oneOf(a.law, 'law', LAW_CODES) as LawCode } : {}),
      }; break;
      case 'apologize': action = { type, to: id(a.to, 'to', CID) }; break;
      case 'mentor': action = { type, citizen: id(a.citizen, 'citizen', CID) }; break;
      case 'post': action = { type, text: str(a.text, 'text') }; break;
      case 'react': action = { type, postId: id(a.postId, 'postId', OID), kind: oneOf(a.kind, 'kind', REACTIONS) }; break;
      // Standing: the two public instruments of a city's gate. `city` is
      // optional while there is one city; it names the gate when there are six.
      case 'sponsor': action = {
        type, citizen: id(a.citizen, 'citizen', CID),
        ...(a.city !== undefined && a.city !== null ? { city: oneOf(a.city, 'city', CITIES) } : {}),
      }; break;
      case 'apply_residency': action = {
        type, ...(a.city !== undefined && a.city !== null ? { city: oneOf(a.city, 'city', CITIES) } : {}),
      }; break;
      // --- Civil law: instruments, the docket, the guilds and patronage ---
      case 'offer_contract': action = {
        type, to: id(a.to, 'to', CID), kind: oneOf(a.kind, 'kind', CONTRACT_KINDS),
        terms: str(a.terms, 'terms'), consideration: int(a.consideration, 'consideration', 1, MAX_SUM),
        days: int(a.days, 'days', 1, 112),
        ...(a.penalty !== undefined && a.penalty !== null ? { penalty: int(a.penalty, 'penalty', 0, MAX_SUM) } : {}),
        ...(a.notice !== undefined && a.notice !== null ? { notice: int(a.notice, 'notice', 0, 112) } : {}),
        ...(Array.isArray(a.witnesses)
          ? { witnesses: a.witnesses.slice(0, 3).map((w, i) => id(w, `witnesses[${i}]`, CID)) }
          : {}),
      }; break;
      case 'accept_contract': action = { type, offerId: id(a.offerId, 'offerId', CTID) }; break;
      case 'close_offer': action = { type, offerId: id(a.offerId, 'offerId', OFFERID) }; break;
      case 'witness_contract': action = { type, offerId: id(a.offerId, 'offerId', CTID) }; break;
      case 'perform_contract': case 'terminate_contract':
        action = { type, contractId: id(a.contractId, 'contractId', CTID) }; break;
      case 'propose_variation': action = {
        type, contractId: id(a.contractId, 'contractId', CTID), terms: str(a.terms, 'terms'),
        ...(a.consideration !== undefined && a.consideration !== null
          ? { consideration: int(a.consideration, 'consideration', 1, MAX_SUM) } : {}),
        ...(a.days !== undefined && a.days !== null ? { days: int(a.days, 'days', 1, 112) } : {}),
        ...(a.penalty !== undefined && a.penalty !== null ? { penalty: int(a.penalty, 'penalty', 0, MAX_SUM) } : {}),
        ...(a.notice !== undefined && a.notice !== null ? { notice: int(a.notice, 'notice', 0, 112) } : {}),
      }; break;
      case 'accept_variation': action = { type, variationId: id(a.variationId, 'variationId', CVID) }; break;
      case 'open_escrow': action = {
        type, contractId: id(a.contractId, 'contractId', CTID),
        holder: a.holder === 'exchange' ? 'exchange' : id(a.holder, 'holder', CID),
        amount: int(a.amount, 'amount', 1, MAX_SUM),
      }; break;
      case 'release_escrow': action = { type, escrowId: id(a.escrowId, 'escrowId', CEID) }; break;
      case 'file_suit': action = {
        type, defendant: id(a.defendant, 'defendant', CID), claim: str(a.claim, 'claim'),
        damages: int(a.damages, 'damages', 1, MAX_SUM),
        ...(a.contractId !== undefined && a.contractId !== null ? { contractId: id(a.contractId, 'contractId', CTID) } : {}),
      }; break;
      case 'answer_suit': {
        const counter = isRec(a.counterclaim)
          ? { claim: str(a.counterclaim.claim, 'counterclaim.claim'), damages: int(a.counterclaim.damages, 'counterclaim.damages', 1, MAX_SUM) }
          : null;
        action = {
          type, suitId: id(a.suitId, 'suitId', CSID), plea: oneOf(a.plea, 'plea', PLEAS), text: str(a.text, 'text'),
          ...(counter ? { counterclaim: counter } : {}),
        };
        break;
      }
      case 'settle': action = { type, suitId: id(a.suitId, 'suitId', CSID), amount: int(a.amount, 'amount', 0, MAX_SUM) }; break;
      case 'accept_settlement': action = { type, suitId: id(a.suitId, 'suitId', CSID) }; break;
      case 'judge_civil': action = {
        type, suitId: id(a.suitId, 'suitId', CSID), finding: oneOf(a.finding, 'finding', CIVIL_FINDINGS),
        damages: int(a.damages ?? 0, 'damages', 0, MAX_SUM), order: oneOf(a.order, 'order', CIVIL_ORDERS),
        reason: str(a.reason, 'reason'),
      }; break;
      case 'enforce_judgment': action = { type, judgmentId: id(a.judgmentId, 'judgmentId', CJID) }; break;
      case 'offer_arbitration': action = {
        type, with: id(a.with, 'with', CID), about: str(a.about, 'about'), arbiter: id(a.arbiter, 'arbiter', CID),
        fee: int(a.fee ?? 0, 'fee', 0, MAX_SUM),
      }; break;
      case 'accept_arbitration': action = { type, offerId: id(a.offerId, 'offerId', CAID) }; break;
      case 'arbitrate': action = {
        type, disputeId: id(a.disputeId, 'disputeId', CAID),
        award: int(a.award ?? 0, 'award', -MAX_SUM, MAX_SUM), reason: str(a.reason, 'reason'),
      }; break;
      case 'refer_dispute': {
        if (!Array.isArray(a.cities) || a.cities.length !== 2) throw new Error('cities must be two city names');
        action = { type, cities: [str(a.cities[0], 'cities[0]', 40), str(a.cities[1], 'cities[1]', 40)], about: str(a.about, 'about') };
        break;
      }
      case 'found_guild': action = {
        type, profession: oneOf(a.profession, 'profession', PROFESSIONS),
        ...(a.name !== undefined && a.name !== null ? { name: str(a.name, 'name', 40) } : {}),
      }; break;
      case 'sit_examination': action = { type, guildId: id(a.guildId, 'guildId', CGID) }; break;
      case 'certify': action = { type, candidate: id(a.candidate, 'candidate', CID) }; break;
      case 'revoke_licence': action = { type, citizen: id(a.citizen, 'citizen', CID), reason: str(a.reason, 'reason') }; break;
      case 'offer_patronage': action = {
        type, to: id(a.to, 'to', CID), perDay: int(a.perDay, 'perDay', 1, MAX_SUM), days: int(a.days, 'days', 7, 112),
        ...(optStr(a.subject, 'subject') !== undefined ? { subject: optStr(a.subject, 'subject') } : {}),
      }; break;
      case 'accept_patronage': action = { type, offerId: id(a.offerId, 'offerId', CTID) }; break;
      // --- Finance: the paper, the counter, the houses and the pot ---
      case 'bid_bond': action = {
        type, issueId: id(a.issueId, 'issueId', ISSUEID), price: int(a.price, 'price', 1, 200),
        qty: int(a.qty, 'qty', 1, 3000),
      }; break;
      case 'sell_bond': action = {
        type, holdingId: id(a.holdingId, 'holdingId', HOLDINGID), price: int(a.price, 'price', 1, 200),
        ...(a.qty !== undefined && a.qty !== null ? { qty: int(a.qty, 'qty', 1, 3000) } : {}),
      }; break;
      case 'buy_bond': action = { type, offerId: id(a.offerId, 'offerId', BONDOFFERID) }; break;
      case 'offer_restructure': action = {
        type, issueId: id(a.issueId, 'issueId', ISSUEID), coupon: num(a.coupon, 'coupon', 0, 4),
        term: int(a.term, 'term', 1, 336), haircut: num(a.haircut, 'haircut', 0, 1),
      }; break;
      case 'vote_restructure': action = { type, issueId: id(a.issueId, 'issueId', ISSUEID), accept: Boolean(a.accept) }; break;
      case 'repudiate': action = { type, issueId: id(a.issueId, 'issueId', ISSUEID) }; break;
      case 'deposit': case 'withdraw': action = { type, amount: int(a.amount, 'amount', 1, MAX_SUM) }; break;
      case 'set_deposit_rate': case 'set_lending_rate': action = { type, rate: num(a.rate, 'rate', 0, 1) }; break;
      case 'call_loan': action = { type, loanId: id(a.loanId, 'loanId', LID) }; break;
      case 'found_underwriter': action = {
        type, name: str(a.name, 'name', 40), capital: int(a.capital ?? 500, 'capital', 1, MAX_SUM),
      }; break;
      case 'offer_policy': action = {
        type, kind: oneOf(a.kind, 'kind', POLICY_KINDS), cover: int(a.cover, 'cover', 1, 20_000),
        premium: int(a.premium, 'premium', 1, MAX_SUM), term: int(a.term, 'term', 1, 336),
      }; break;
      case 'buy_policy': action = { type, policyId: id(a.policyId, 'policyId', LINEID) }; break;
      case 'file_claim': action = {
        type, policyId: id(a.policyId, 'policyId', POLICYID), event: str(a.event, 'event', 140),
        amount: int(a.amount, 'amount', 1, MAX_SUM),
      }; break;
      case 'settle_claim': action = {
        type, claimId: id(a.claimId, 'claimId', INSCLAIMID), amount: int(a.amount, 'amount', 1, MAX_SUM),
      }; break;
      case 'deny_claim': action = { type, claimId: id(a.claimId, 'claimId', INSCLAIMID), reason: str(a.reason, 'reason') }; break;
      case 'found_mutual': action = { type, name: str(a.name, 'name', 40), dues: int(a.dues, 'dues', 1, 50) }; break;
      case 'join_mutual': action = { type, mutualId: id(a.mutualId, 'mutualId', MUTUALID) }; break;
      case 'pay_dues': action = {
        type, ...(a.mutualId !== undefined && a.mutualId !== null ? { mutualId: id(a.mutualId, 'mutualId', MUTUALID) } : {}),
      }; break;
      case 'claim_aid': action = { type, amount: int(a.amount, 'amount', 1, MAX_SUM), reason: str(a.reason, 'reason') }; break;
      case 'vote_aid': action = { type, claimId: id(a.claimId, 'claimId', AIDID), aye: Boolean(a.aye) }; break;
      // --- Research, the works, and what a city keeps to itself ---
      case 'open_project': action = {
        type, technology: oneOf(a.technology, 'technology', TECHNOLOGY_IDS),
        ...(a.name !== undefined && a.name !== null ? { name: str(a.name, 'name', 60) } : {}),
      }; break;
      case 'research': action = { type, projectId: id(a.projectId, 'projectId', RPID) }; break;
      case 'fund_project': action = {
        type, projectId: id(a.projectId, 'projectId', RPID), amount: int(a.amount, 'amount', 1, MAX_SUM),
      }; break;
      case 'adopt_technology': case 'teach_technology':
        action = { type, technology: oneOf(a.technology, 'technology', TECHNOLOGY_IDS) }; break;
      case 'publish_finding': case 'keep_secret':
        action = { type, projectId: id(a.projectId, 'projectId', RPID) }; break;
      case 'take_apprentice': action = {
        type, citizen: id(a.citizen, 'citizen', CID), technology: oneOf(a.technology, 'technology', TECHNOLOGY_IDS),
      }; break;
      case 'sell_secret': action = {
        type, to: id(a.to, 'to', CID), technology: oneOf(a.technology, 'technology', TECHNOLOGY_IDS),
        price: int(a.price ?? 0, 'price', 0, MAX_SUM),
      }; break;
      // --- The air, the river and the land ---
      case 'install_abatement': action = {
        type, building: id(a.building, 'building', BID), fitting: oneOf(a.fitting, 'fitting', FITTINGS),
      }; break;
      case 'maintain_abatement': case 'discharge':
        action = { type, building: id(a.building, 'building', BID) }; break;
      case 'survey_air': case 'survey_water':
        action = { type, district: oneOf(a.district, 'district', DISTRICT_IDS) }; break;
      case 'plant_trees': action = { type, district: oneOf(a.district, 'district', DISTRICT_IDS) }; break;
      case 'petition_zoning': action = {
        type, district: oneOf(a.district, 'district', DISTRICT_IDS), permit: oneOf(a.permit, 'permit', PERMITS),
      }; break;
      case 'declare_interest': action = { type, proposal: id(a.proposal, 'proposal', PID) }; break;
      case 'file_nuisance': action = {
        type, against: id(a.against, 'against', CID), district: oneOf(a.district, 'district', DISTRICT_IDS),
      }; break;
      // --- The gate, the schedule and what goes past it ---
      // A load is a good off the Bazaar's five, a thing out of the catalogue,
      // or neither, in which case it is lumens. Every one of the four customs
      // acts names the traveller it is done to and nobody else.
      case 'declare_cargo': action = {
        type, qty: int(a.qty, 'qty', 1, 10_000), value: int(a.value ?? 0, 'value', 0, MAX_SUM),
        ...(a.goods !== undefined && a.goods !== null ? { goods: oneOf(a.goods, 'goods', GOODS) } : {}),
        ...(a.productId !== undefined && a.productId !== null ? { productId: oneOf(a.productId, 'productId', PRODUCT_IDS) } : {}),
        ...(a.direction !== undefined && a.direction !== null
          ? { direction: oneOf(a.direction, 'direction', ['inbound', 'outbound'] as const) } : {}),
        ...(a.city !== undefined && a.city !== null ? { city: oneOf(a.city, 'city', CITY_KEYS) } : {}),
      }; break;
      case 'smuggle': action = {
        type, qty: int(a.qty, 'qty', 1, 10_000), route: oneOf(a.route, 'route', SMUGGLE_ROUTES),
        ...(a.goods !== undefined && a.goods !== null ? { goods: oneOf(a.goods, 'goods', GOODS) } : {}),
        ...(a.productId !== undefined && a.productId !== null ? { productId: oneOf(a.productId, 'productId', PRODUCT_IDS) } : {}),
        ...(a.direction !== undefined && a.direction !== null
          ? { direction: oneOf(a.direction, 'direction', ['inbound', 'outbound'] as const) } : {}),
        ...(a.city !== undefined && a.city !== null ? { city: oneOf(a.city, 'city', CITY_KEYS) } : {}),
      }; break;
      case 'inspect': case 'assess_duty': case 'wave_through':
        action = { type, traveller: id(a.traveller, 'traveller', CID) }; break;
      case 'seize': action = {
        type, traveller: id(a.traveller, 'traveller', CID), qty: int(a.qty, 'qty', 1, 10_000),
        ...(a.good !== undefined && a.good !== null ? { good: oneOf(a.good, 'good', GOODS) } : {}),
        ...(a.productId !== undefined && a.productId !== null ? { productId: oneOf(a.productId, 'productId', PRODUCT_IDS) } : {}),
      }; break;
      case 'fence': action = {
        type, to: id(a.to, 'to', CID),
        ...(a.itemId !== undefined && a.itemId !== null ? { itemId: id(a.itemId, 'itemId', IID) } : {}),
        ...(a.good !== undefined && a.good !== null ? { good: oneOf(a.good, 'good', GOODS) } : {}),
        ...(a.productId !== undefined && a.productId !== null ? { productId: oneOf(a.productId, 'productId', PRODUCT_IDS) } : {}),
        ...(a.qty !== undefined && a.qty !== null ? { qty: int(a.qty, 'qty', 1, 10_000) } : {}),
      }; break;
      case 'receive_goods': action = {
        type, from: id(a.from, 'from', CID),
        ...(a.itemId !== undefined && a.itemId !== null ? { itemId: id(a.itemId, 'itemId', IID) } : {}),
        ...(a.good !== undefined && a.good !== null ? { good: oneOf(a.good, 'good', GOODS) } : {}),
        ...(a.productId !== undefined && a.productId !== null ? { productId: oneOf(a.productId, 'productId', PRODUCT_IDS) } : {}),
        ...(a.qty !== undefined && a.qty !== null ? { qty: int(a.qty, 'qty', 1, 10_000) } : {}),
      }; break;
      case 'recruit_agent': action = {
        type, citizen: id(a.citizen, 'citizen', CID), retainer: int(a.retainer, 'retainer', 1, MAX_SUM),
        days: int(a.days, 'days', 1, 112),
        ...(a.city !== undefined && a.city !== null ? { city: oneOf(a.city, 'city', CITY_KEYS) } : {}),
      }; break;
      case 'accept_recruitment': action = { type, offerId: id(a.offerId, 'offerId', RTID) }; break;
      case 'case_target': case 'sweep': action = { type, building: id(a.building, 'building', BID) }; break;
      case 'steal_secret': action = {
        type, building: id(a.building, 'building', BID), kind: oneOf(a.kind, 'kind', SECRET_KINDS),
      }; break;
      case 'pass_secret': action = { type, to: id(a.to, 'to', CID), kind: oneOf(a.kind, 'kind', SECRET_KINDS) }; break;
      case 'assign_detective': {
        const building = a.building !== undefined && a.building !== null ? id(a.building, 'building', BID) : undefined;
        const citizen = a.citizen !== undefined && a.citizen !== null ? id(a.citizen, 'citizen', CID) : undefined;
        if (!building && !citizen) throw new Error('assign_detective names a building or a citizen');
        action = { type, ...(building ? { building } : {}), ...(citizen ? { citizen } : {}) };
        break;
      }
      case 'plant_false_papers': action = {
        type, building: id(a.building, 'building', BID), claim: str(a.claim, 'claim', 140),
      }; break;
      // --- The charter, the office, the paper and the Games ---
      // An article's value may be a number of seats, a word like `districts`,
      // a switch, or a list of rights, so all four shapes are admitted here and
      // `politics/charter.ts` checks the value against the article it names.
      case 'propose_amendment': case 'move_article': action = {
        type, article: str(a.article, 'article', 40), value: charterValue(a.value),
        ...(a.field !== undefined && a.field !== null ? { field: str(a.field, 'field', 40) } : {}),
        ...(a.words !== undefined && a.words !== null ? { words: str(a.words, 'words') } : {}),
      }; break;
      case 'refuse': action = {
        type, duty: oneOf(a.duty, 'duty', REFUSABLE_DUTIES),
        ...(optStr(a.ground, 'ground') !== undefined ? { ground: optStr(a.ground, 'ground') } : {}),
      }; break;
      case 'speak_convention': action = { type, text: str(a.text, 'text') }; break;
      case 'vote_article': action = { type, articleId: id(a.articleId, 'articleId', ARTID), aye: Boolean(a.aye) }; break;
      case 'impeach': action = {
        type, officer: id(a.officer, 'officer', CID), article: oneOf(a.article, 'article', IMPEACHMENT_ARTICLE_NAMES),
        ...(a.evidence !== undefined && a.evidence !== null ? { evidence: num(a.evidence, 'evidence', 0, 1) } : {}),
      }; break;
      case 'vote_impeachment': action = { type, officer: id(a.officer, 'officer', CID), guilty: Boolean(a.guilty) }; break;
      case 'sign_recall': action = { type, officer: id(a.officer, 'officer', CID) }; break;
      case 'request_record': action = {
        type, body: oneOf(a.body, 'body', RECORD_BODIES), subject: str(a.subject, 'subject', 140),
      }; break;
      case 'answer_record': action = {
        type, requestId: id(a.requestId, 'requestId', REQID), release: Boolean(a.release),
        ...(a.reason !== undefined && a.reason !== null ? { reason: oneOf(a.reason, 'reason', REFUSAL_REASON_NAMES) } : {}),
      }; break;
      case 'found_paper': action = {
        type, name: str(a.name, 'name', 40),
        ...(isRec(a.line) ? { line: platformish(a.line) } : {}),
        ...(a.premises !== undefined && a.premises !== null ? { premises: oneOf(a.premises, 'premises', DISTRICT_IDS) } : {}),
      }; break;
      case 'bid_games': action = {
        type, purse: int(a.purse, 'purse', 0, MAX_SUM), works: int(a.works, 'works', 0, MAX_SUM),
      }; break;
      case 'vote_games_host': action = { type, city: str(a.city, 'city', 40) }; break;
      case 'enter_games': action = { type, discipline: oneOf(a.discipline, 'discipline', DISCIPLINES) }; break;
      // --- Dynasties, the entail, the match and the will (`GENERATIONS.md` §8) ---
      case 'write_will': action = {
        type,
        ...(a.shares !== undefined && a.shares !== null ? { shares: willShares(a.shares) } : {}),
        ...(a.residue !== undefined && a.residue !== null
          ? { residue: a.residue === 'chest' ? 'chest' : id(a.residue, 'residue', CID) as CitizenId } : {}),
        ...(a.executor !== undefined && a.executor !== null ? { executor: id(a.executor, 'executor', CID) } : {}),
        ...(optStr(a.instructions, 'instructions') !== undefined ? { instructions: optStr(a.instructions, 'instructions') } : {}),
      }; break;
      case 'revoke_will': case 'stand_officiant': case 'surrender':
        action = { type }; break;
      case 'found_house': action = {
        type, name: str(a.name, 'name', 40), rule: oneOf(a.rule, 'rule', HOUSE_RULES),
      }; break;
      case 'join_house': case 'claim_house': action = { type, houseId: id(a.houseId, 'houseId', HSID) }; break;
      case 'renounce_name': action = {
        type, ...(optStr(a.name, 'name') !== undefined ? { name: str(a.name, 'name', 40) } : {}),
      }; break;
      case 'convey_to_house': action = { type, unit: id(a.unit ?? a.unitId, 'unit', YID) }; break;
      case 'convey_business_to_house': action = { type, businessId: id(a.businessId, 'businessId', BZID) }; break;
      case 'endow_house': action = { type, amount: int(a.amount, 'amount', 1, MAX_SUM) }; break;
      case 'house_motion': action = {
        type, kind: oneOf(a.kind, 'kind', HOUSE_MOTION_KINDS),
        ...(a.value !== undefined && a.value !== null ? { value: int(a.value, 'value', 0, MAX_SUM) } : {}),
        ...(a.target !== undefined && a.target !== null ? { target: str(a.target, 'target', 40) } : {}),
        ...(a.city !== undefined && a.city !== null ? { city: str(a.city, 'city', 40) } : {}),
      }; break;
      case 'house_assent': action = { type, motionId: id(a.motionId, 'motionId', HMID), aye: Boolean(a.aye) }; break;
      case 'name_successor': action = { type, to: id(a.to, 'to', CID) }; break;
      case 'house_vote': action = { type, candidate: id(a.candidate, 'candidate', CID) }; break;
      case 'letter_of_house': action = {
        type, to: id(a.to, 'to', CID),
        ...(a.city !== undefined && a.city !== null ? { city: str(a.city, 'city', 40) } : {}),
      }; break;
      case 'pledge_house': action = { type, loanId: id(a.loanId, 'loanId', LID) }; break;
      case 'offer_match': action = {
        type, house: str(a.house, 'house', 40),
        ...(a.dowry !== undefined && a.dowry !== null ? { dowry: int(a.dowry, 'dowry', 0, MAX_SUM) } : {}),
        ...(a.unit !== undefined && a.unit !== null ? { unit: id(a.unit, 'unit', YID) } : {}),
        ...(optStr(a.terms, 'terms') !== undefined ? { terms: optStr(a.terms, 'terms') } : {}),
      }; break;
      case 'accept_match': action = { type, offerId: id(a.offerId, 'offerId', /^mt_\d+$/) }; break;
      case 'read_records': action = {
        type, ...(optStr(a.subject, 'subject') !== undefined ? { subject: str(a.subject, 'subject', 60) } : {}),
      }; break;
      // --- Congregations, conscience and sanctuary (`docs/CREEDS.md` §9) ---
      case 'found_creed': action = {
        type, name: str(a.name, 'name', 40), tenets: tenetList(a.tenets),
        ...(a.tithe !== undefined && a.tithe !== null ? { tithe: num(a.tithe, 'tithe', 0, 0.2) } : {}),
        ...(a.gatheringDay !== undefined && a.gatheringDay !== null ? { gatheringDay: int(a.gatheringDay, 'gatheringDay', 0, 6) } : {}),
        ...(a.succession !== undefined && a.succession !== null ? { succession: oneOf(a.succession, 'succession', SUCCESSIONS) } : {}),
        ...(a.aidRule !== undefined && a.aidRule !== null ? { aidRule: oneOf(a.aidRule, 'aidRule', AID_RULES) } : {}),
        ...(a.examinationFloor !== undefined && a.examinationFloor !== null
          ? { examinationFloor: num(a.examinationFloor, 'examinationFloor', 0, 1) } : {}),
      }; break;
      case 'adopt_creed': case 'reunite_creed': action = { type, creedId: id(a.creedId, 'creedId', CRID) }; break;
      case 'leave_creed': case 'gather': action = {
        type, ...(a.creedId !== undefined && a.creedId !== null ? { creedId: id(a.creedId, 'creedId', CRID) } : {}),
      }; break;
      case 'state_tenet': action = {
        type, question: oneOf(a.question, 'question', TENET_QUESTIONS),
        stance: num(a.stance, 'stance', -1, 1), text: str(a.text, 'text'),
      }; break;
      case 'dispute_tenet': action = {
        type, tenetId: id(a.tenetId, 'tenetId', TNID), stance: num(a.stance, 'stance', -1, 1),
        text: str(a.text, 'text'),
      }; break;
      case 'secede': action = {
        type, creedId: id(a.creedId, 'creedId', CRID), name: str(a.name, 'name', 40),
        tenetId: id(a.tenetId, 'tenetId', TNID),
      }; break;
      case 'set_tithe': action = { type, rate: num(a.rate, 'rate', 0, 0.2) }; break;
      case 'donate_creed': action = {
        type, creedId: id(a.creedId, 'creedId', CRID), amount: int(a.amount, 'amount', 1, MAX_SUM),
      }; break;
      case 'grant_aid': action = {
        type, claimId: id(a.claimId, 'claimId', AIDID),
        ...(a.amount !== undefined && a.amount !== null ? { amount: int(a.amount, 'amount', 1, MAX_SUM) } : {}),
      }; break;
      case 'take_meeting_house': action = { type, unit: id(a.unit ?? a.unitId, 'unit', YID) }; break;
      case 'elect_officiant': action = { type, candidate: id(a.candidate, 'candidate', CID) }; break;
      case 'preach': action = { type, text: str(a.text, 'text') }; break;
      case 'invite_creed': case 'offer_sanctuary': action = { type, to: id(a.to, 'to', CID) }; break;
      case 'keep_the_door': action = {
        type, ...(a.house !== undefined && a.house !== null ? { house: id(a.house, 'house', SANCTID) } : {}),
      }; break;
      case 'end_sanctuary': action = {
        type, ...(a.aye !== undefined && a.aye !== null ? { aye: Boolean(a.aye) } : {}),
        ...(a.house !== undefined && a.house !== null ? { house: id(a.house, 'house', SANCTID) } : {}),
      }; break;
      case 'request_warrant': action = { type, house: id(a.house, 'house', SANCTID) }; break;
      case 'grant_warrant': action = {
        type, warrantId: id(a.warrantId, 'warrantId', WRID), aye: Boolean(a.aye), reason: str(a.reason, 'reason'),
      }; break;
      case 'commission_missionary': action = {
        type, citizen: id(a.citizen, 'citizen', CID), city: str(a.city, 'city', 40),
      }; break;
      case 'consecrate_site': action = {
        type, building: id(a.building, 'building', BID),
        ...(a.city !== undefined && a.city !== null ? { city: str(a.city, 'city', 40) } : {}),
        ...(a.district !== undefined && a.district !== null ? { district: oneOf(a.district, 'district', DISTRICT_IDS) } : {}),
        ...(optStr(a.label, 'label') !== undefined ? { label: str(a.label, 'label', 80) } : {}),
      }; break;
      case 'pilgrimage': action = {
        type, siteId: id(a.siteId, 'siteId', SIID),
        ...(a.creedId !== undefined && a.creedId !== null ? { creedId: id(a.creedId, 'creedId', CRID) } : {}),
      }; break;
      default: {
        const never: never = type;
        throw new Error(`unknown action ${String(never)}`);
      }
    }
    return { ok: true, action };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
