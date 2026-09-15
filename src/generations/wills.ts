/**
 * Wills: filing a division, and the city's own when nobody filed one
 * (`docs/GENERATIONS.md` §3).
 *
 * `write_will` files a division at the Exchange for 10 ℓ. Like every filed
 * instrument it is **public the day it is filed** — the heirs read it while
 * the testator lives, which is the point, and `GENERATIONS.md` §9 admits how
 * cruel that is — and it may be refiled any day, the last filing standing. It
 * is **honoured**: the executor has no discretion and `estate.ts` executes the
 * shares.
 *
 * **The floor** is the one thing a will cannot write away: the partner and
 * each under-age child take at least 10 % of what there is to divide, to a
 * total of 40 %, because a will may not hand the Chest a family the estate
 * could have kept. Above that a testator may disinherit anyone, and some will.
 *
 * The duty is the Council's: a rate on the net estate above a season's wages,
 * argued in a chamber where the great houses have relatives.
 */
import type { ActionResult, Citizen, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens, transfer } from '../economy/treasury.ts';
import type { Will, WillShare } from './state.ts';
import { generationsSettings, generationsState } from './state.ts';
import { isAdult } from './houses.ts';

/** What the Exchange charges to file a division. */
export const WILL_FEE = 10;
/** The partner and each under-age child cannot be written below this. */
export const FLOOR_SHARE = 0.1;
export const FLOOR_TOTAL = 0.4;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/** How the register names a party to an estate. */
export function estateName(world: World, id: CitizenId | 'treasury' | 'chest'): string {
  if (id === 'treasury') return 'the Treasury';
  if (id === 'chest') return 'the Community Chest';
  const c = world.citizens[id];
  return c ? `${c.name} ${c.familyName}`.trim() : 'a citizen';
}

// ---------------------------------------------------------------------------
// Filing a will
// ---------------------------------------------------------------------------

/**
 * Read a filed division into shares of a hundred. A share is a percentage of
 * what there is to divide; anything the shares do not name is the residue.
 */
export function normaliseShares(input: unknown): WillShare[] {
  const out: WillShare[] = [];
  const push = (to: unknown, percent: unknown): void => {
    if (typeof to !== 'string' || !to) return;
    const pct = typeof percent === 'number' && Number.isFinite(percent) ? percent : Number(percent);
    if (!Number.isFinite(pct) || pct <= 0) return;
    const held = out.find((s) => s.to === to);
    if (held) held.percent += pct;
    else out.push({ to, percent: pct });
  };
  if (Array.isArray(input)) {
    for (const row of input) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      push(r.to ?? r.citizen ?? r.id, r.percent ?? r.share ?? r.value);
    }
  } else if (input && typeof input === 'object') {
    for (const [to, percent] of Object.entries(input as Record<string, unknown>)) push(to, percent);
  }
  let total = out.reduce((sum, s) => sum + s.percent, 0);
  // A division that adds to more than the estate is scaled back, not refused:
  // the testator meant proportions, and the Exchange reads them as proportions.
  if (total > 100) {
    for (const s of out) s.percent = (s.percent / total) * 100;
    total = 100;
  }
  for (const s of out) s.percent = Math.round(s.percent * 100) / 100;
  return out;
}

export interface WillSpec {
  shares?: unknown;
  residue?: string | null;
  executor?: CitizenId | null;
  instructions?: string;
}

/**
 * File (or refile) your estate's division. Public the day it is filed, and the
 * heirs are told: a sealed instrument would be a secret, and `PRINCIPLES.md`
 * §5 does not allow the city secrets.
 */
export function writeWill(world: World, cId: CitizenId, spec: WillSpec): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (c.standing === 'exiled') return fail('An exile leaves no estate to divide.');
  if (!isAdult(c)) return fail('A child files no will.');
  if (c.wallet < WILL_FEE) return fail(`Filing a will costs ${formatLumens(WILL_FEE)}; you have ${formatLumens(c.wallet)}.`);

  const shares = normaliseShares(spec.shares).filter((s) => s.to !== cId && !!world.citizens[s.to]);
  const residue = spec.residue === 'chest' ? 'chest'
    : (spec.residue && world.citizens[spec.residue] && spec.residue !== cId ? spec.residue : null);
  const executorId = spec.executor && world.citizens[spec.executor] && spec.executor !== cId ? spec.executor : null;
  if (!transfer(world, cId, 'treasury', WILL_FEE, 'fee', `filing of ${c.name}'s will at the Exchange`)) {
    return fail('The filing fee could not be paid.');
  }

  const will: Will = {
    citizenId: cId,
    shares,
    residue,
    executorId,
    instructions: (spec.instructions ?? '').trim().slice(0, 280),
    filedDay: world.day,
    fee: WILL_FEE,
  };
  generationsState(world).wills[cId] = will;

  const named = shares.map((s) => `${estateName(world, s.to)} ${s.percent}%`).join(', ') || 'nobody by name';
  emit(world, 'household', `${c.name} ${c.familyName} filed a will at the Exchange: ${named}${residue ? `, residue to ${estateName(world, residue)}` : ''}.`.trim(),
    [cId, ...shares.map((s) => s.to)], 0.4, { citizenId: cId, shares: shares.length });
  for (const s of shares) {
    remember(world, s.to, 'family', `${c.name} ${c.familyName}'s will, filed today, leaves you ${s.percent}% of their estate.`.trim());
  }
  remember(world, cId, 'money', `You filed your will for ${formatLumens(WILL_FEE)}. It is public, and your heirs have read it.`);
  return ok(`Your will is on file at the Exchange, and it is public.`);
}

/** Withdraw it. What you leave behind falls back to the city's default division. */
export function revokeWill(world: World, cId: CitizenId): ActionResult {
  const s = generationsState(world);
  const will = s.wills[cId];
  if (!will) return fail('You have no will on file.');
  delete s.wills[cId];
  const c = world.citizens[cId];
  emit(world, 'household', `${c?.name ?? 'A citizen'} withdrew their will.`, [cId], 0.3, { citizenId: cId });
  for (const share of will.shares) {
    remember(world, share.to, 'family', `${c?.name ?? 'A citizen'} withdrew the will that left you ${share.percent}%.`);
  }
  return ok('Your will is withdrawn.');
}

// ---------------------------------------------------------------------------
// The default division
// ---------------------------------------------------------------------------

function livingKin(world: World, ids: readonly CitizenId[]): Citizen[] {
  const out: Citizen[] = [];
  for (const id of ids) {
    const c = world.citizens[id];
    if (c && c.standing !== 'exiled' && c.sunsetDay === null) out.push(c);
  }
  return out;
}

/** Siblings, as the tree derives them: anybody sharing a parent. */
export function siblingsOf(world: World, c: Citizen): Citizen[] {
  const out = new Map<CitizenId, Citizen>();
  for (const parentId of c.family?.parents ?? []) {
    for (const childId of world.citizens[parentId]?.family?.children ?? []) {
      if (childId === c.id) continue;
      const sib = world.citizens[childId];
      if (sib && sib.standing !== 'exiled' && sib.sunsetDay === null) out.set(childId, sib);
    }
  }
  return [...out.values()];
}

/**
 * The city's division of anything the will did not name (`GENERATIONS.md` §3):
 * half to the partner and half among the children; all to the partner; equally
 * among the children; equally among parents and siblings; and, with no family
 * at all, the Community Chest.
 */
export function defaultDivision(world: World, c: Citizen): { to: CitizenId | 'chest'; percent: number }[] {
  const partner = c.family?.partnerId ? livingKin(world, [c.family.partnerId])[0] ?? null : null;
  const children = livingKin(world, c.family?.children ?? []);
  if (partner && children.length > 0) {
    return [
      { to: partner.id, percent: 50 },
      ...children.map((k) => ({ to: k.id, percent: 50 / children.length })),
    ];
  }
  if (partner) return [{ to: partner.id, percent: 100 }];
  if (children.length > 0) return children.map((k) => ({ to: k.id, percent: 100 / children.length }));
  const rest = [...livingKin(world, c.family?.parents ?? []), ...siblingsOf(world, c)];
  if (rest.length > 0) return rest.map((k) => ({ to: k.id, percent: 100 / rest.length }));
  return [{ to: 'chest', percent: 100 }];
}

/** The partner and the under-age children: the ones a will may not write out. */
export function floorHeirs(world: World, c: Citizen): Citizen[] {
  const out: Citizen[] = [];
  const partner = c.family?.partnerId ? livingKin(world, [c.family.partnerId])[0] ?? null : null;
  if (partner) out.push(partner);
  for (const k of livingKin(world, c.family?.children ?? [])) {
    if (k.lifeStage === 'child') out.push(k);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The duty
// ---------------------------------------------------------------------------

/** A season's wages pass untaxed. */
export function dutyExemption(world: World): number {
  const s = generationsSettings(world);
  return Math.round(Math.max(0, s.exemptionWages) * Math.max(0, world.government?.minWage ?? 0));
}

/** What the Council's rate takes of an estate this size. */
export function dutyOn(world: World, net: number): number {
  const rate = Math.max(0, generationsSettings(world).estateDuty);
  return Math.max(0, Math.round(rate * Math.max(0, net - dutyExemption(world))));
}
