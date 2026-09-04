/**
 * Shape validation for actions arriving from outside the engine (HTTP API,
 * LLM tool calls). Returns a typed Action or an error string. Never throws.
 */
import { ACTION_TYPES, DISTRICT_IDS, GOODS, PAPERS, REACTIONS, SCHOOLS, SKILLS, WORK_KINDS } from '../types.ts';
import type {
  Action, ActionType, AppealResult, BusinessKind, Decree, HousingTier, JobRole, LawCode, ProposalKind,
} from '../types.ts';
import { LAW_CODES } from '../data/laws.ts';
import { HOBBIES, PRODUCT_IDS } from '../data/catalogue.ts';
import { DISHES } from '../data/metropolis.ts';

const BUSINESS_KINDS: readonly BusinessKind[] = ['workshop', 'cafe', 'studio', 'shop', 'clinic', 'courier'];
const PROPOSAL_KINDS: readonly ProposalKind[] = [
  'income_tax', 'sales_tax', 'dividend', 'min_wage', 'law_severity', 'pardon', 'public_works',
  'appoint_judge', 'dismiss_judge', 'remove_mayor', 'charter', 'charity',
];
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

export function validateAction(input: unknown): { ok: true; action: Action } | { ok: false; error: string } {
  try {
    if (!isRec(input)) throw new Error('action must be an object');
    const type = oneOf(input.type, 'type', ACTION_TYPES) as ActionType;
    const a = input;
    let action: Action;
    switch (type) {
      case 'idle': case 'work': case 'rest': case 'eat': case 'visit_clinic': case 'attend_show':
      case 'quit_job': case 'perform': case 'appeal': case 'apply_watch': case 'evade_tax':
      case 'break_up': case 'start_family': case 'celebrate':
        action = { type }; break;
      case 'move': action = { type, district: oneOf(a.district, 'district', DISTRICT_IDS) }; break;
      case 'buy': action = { type, good: oneOf(a.good, 'good', GOODS), qty: int(a.qty, 'qty', 1, 1000) }; break;
      case 'sell': action = { type, good: oneOf(a.good, 'good', GOODS), qty: int(a.qty, 'qty', 1, 1000) }; break;
      case 'consume': action = { type, good: oneOf(a.good, 'good', GOODS) }; break;
      case 'study': action = { type, skill: oneOf(a.skill, 'skill', SKILLS) }; break;
      case 'move_home': action = { type, tier: int(a.tier, 'tier', 0, 3) as HousingTier }; break;
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
      case 'publish': action = { type, headline: str(a.headline, 'headline'), ...(a.about ? { about: id(a.about, 'about', CID) } : {}) }; break;
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
      case 'propose': action = {
        type, kind: oneOf(a.kind, 'kind', PROPOSAL_KINDS), value: num(a.value ?? 0, 'value', 0, 1_000_000),
        summary: str(a.summary, 'summary'),
        ...(a.lawCode ? { lawCode: oneOf(a.lawCode, 'lawCode', LAW_CODES) as LawCode } : {}),
        ...(a.targetId ? { targetId: id(a.targetId, 'targetId', CID) } : {}),
      }; break;
      case 'vote_proposal': action = { type, proposalId: id(a.proposalId, 'proposalId', PID), aye: Boolean(a.aye) }; break;
      case 'report': action = {
        type, citizen: id(a.citizen, 'citizen', CID), law: oneOf(a.law, 'law', LAW_CODES) as LawCode,
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
