/**
 * Shape validation for actions arriving from outside the engine (HTTP API,
 * LLM tool calls). Returns a typed Action or an error string. Never throws.
 */
import { ACTION_TYPES, DISTRICT_IDS, GOODS, SKILLS } from '../types.ts';
import type { Action, ActionType, BusinessKind, HousingTier, LawCode, ProposalKind } from '../types.ts';
import { LAW_CODES } from '../data/laws.ts';
import { HOBBIES, PRODUCT_IDS } from '../data/catalogue.ts';

const BUSINESS_KINDS: readonly BusinessKind[] = ['workshop', 'cafe', 'studio', 'shop', 'clinic', 'courier'];
const PROPOSAL_KINDS: readonly ProposalKind[] = [
  'income_tax', 'sales_tax', 'dividend', 'min_wage', 'law_severity', 'pardon', 'public_works',
  'appoint_judge', 'dismiss_judge', 'remove_mayor', 'charter', 'charity',
];
const MAX_TEXT = 280;

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
const PID = /^p_\d+$/;
const BID = /^[a-z_]+$/;
const IID = /^i_\d+$/;
const UID = /^u_\d+$/;

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
