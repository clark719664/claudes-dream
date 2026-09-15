/**
 * A project's purse: who pays for research, and what happens to what is left
 * (`docs/PROGRESS.md` §1).
 *
 * A purse is **real lumens**, held for one programme, counted in the daily
 * audit as `Σ project purses` (`REGISTRY.md` §5). It is a strongbox — the same
 * business record `finance/box.ts` opens for the Lantern vault and a mutual's
 * pot — so it holds money the supply already sums, pays no rent, keeps no
 * books, is never read as a trading concern and can never go bankrupt.
 *
 * Three funders, and they are not the same:
 *
 * - the **Council**, by a `research_grant` proposal argued over like any other
 *   spend (`enactResearchGrant`);
 * - a **patron** — any citizen or business — by `fund_project`;
 * - a **guild, union or business**, the only funder that may keep a secret,
 *   which is what `secretKeeper` decides and `progress/discovery.ts` acts on.
 *
 * Every lumen is recorded against the party that put it in, because what is
 * left in the purse at completion or abandonment goes back to them.
 */
import type { ActionResult, CitizenId, MoneyParty, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { balanceOf, formatLumens } from '../economy/treasury.ts';
import { isPresent } from '../citizens/citizen.ts';
import { boxBalance, moveThroughBox } from '../finance/box.ts';
import { civilState } from '../civil/state.ts';
import type { ResearchProject } from './state.ts';
import { GRANT_KIND, PROGRESS_EVENT, REFUND_KIND, progressState } from './state.ts';

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/** What is in a project's purse right now. */
export function purseOf(world: World, p: ResearchProject): number {
  return boxBalance(world, p.purseId);
}

/** Everyone who has worked at least this many shifts on a project, most first. */
export function contributorsOf(p: ResearchProject, minShifts = 1): CitizenId[] {
  return Object.keys(p.shifts).filter((id) => (p.shifts[id] ?? 0) >= minShifts)
    .sort((a, b) => (p.shifts[b] ?? 0) - (p.shifts[a] ?? 0) || a.localeCompare(b));
}

function funderName(world: World, party: MoneyParty): string {
  if (party === 'treasury') return 'the Council';
  return world.citizens[party]?.name ?? world.businesses[party]?.name ?? String(party);
}

/**
 * Lumens into a purse. Any citizen or business may; the Council does it by a
 * `research_grant` proposal, which is `enactResearchGrant` below.
 */
export function fundProject(world: World, from: MoneyParty, projectId: string, amount: number): ActionResult {
  const p = progressState(world).projects[projectId] ?? null;
  if (!p) return fail('There is no such programme.');
  if (p.status !== 'open') return fail(`${p.name} is closed; it takes no more money.`);
  const sum = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (sum <= 0) return fail('A grant is a positive whole number of lumens.');
  if (from !== 'treasury' && !world.citizens[from] && !world.businesses[from]) return fail('Unknown funder.');
  const payer = world.citizens[from];
  if (payer && !isPresent(world, payer)) return fail('You are not in the city.');
  if (balanceOf(world, from) < sum) return fail(`You cannot spare ${formatLumens(sum)}.`);
  if (!moveThroughBox(world, from, p.purseId, sum, GRANT_KIND, `grant to ${p.name}`)) {
    return fail('The grant could not be paid.');
  }
  p.funded[from] = (p.funded[from] ?? 0) + sum;
  const who = funderName(world, from);
  emit(world, PROGRESS_EVENT, `${who} put ${formatLumens(sum)} into ${p.name}; its purse holds ${formatLumens(purseOf(world, p))}.`,
    payer ? [payer.id] : [], 0.3, { projectId: p.id, amount: sum, from });
  if (payer) remember(world, payer.id, 'money', `You put ${formatLumens(sum)} into ${p.name}.`);
  for (const id of contributorsOf(p)) {
    if (id === from) continue;
    remember(world, id, 'work', `${who} put ${formatLumens(sum)} into ${p.name}.`);
  }
  return ok(`${formatLumens(sum)} into ${p.name}; the purse holds ${formatLumens(purseOf(world, p))}.`);
}

/**
 * The Council's `research_grant`: the Treasury's own money into a named purse,
 * argued over like any other spend. The layer that enacts proposals calls this.
 */
export function enactResearchGrant(world: World, projectId: string, amount: number): ActionResult {
  return fundProject(world, 'treasury', projectId, amount);
}

/** How many guilds hold this citizen's mark, off the Exchange's own register. */
function guildMemberships(world: World, cId: CitizenId): number {
  let n = 0;
  for (const g of Object.values(civilState(world).guilds)) {
    if ((g.masters ?? []).includes(cId) || (g.members ?? []).includes(cId)) n++;
  }
  return n;
}

/** Whether a funder is one that may keep a secret: a business, a guild's master, a union's member. */
export function maySecrete(world: World, party: string): boolean {
  const biz = world.businesses[party];
  if (biz) return biz.dissolvedDay === null;
  const c = world.citizens[party];
  if (!c) return false;
  return !!c.unionId || guildMemberships(world, c.id) > 0;
}

/**
 * Who, if anybody, may keep this finding to themselves: the funder that may
 * hold a secret and put in the most — a business's owner answers for it. Null
 * when the money came from the Council or from ordinary patrons, and then the
 * finding is the city's.
 */
export function secretKeeper(world: World, p: ResearchProject): CitizenId | null {
  let best: { id: CitizenId; amount: number } | null = null;
  for (const [party, amount] of Object.entries(p.funded)) {
    if (party === 'treasury' || amount <= 0 || !maySecrete(world, party)) continue;
    const biz = world.businesses[party];
    const holder = biz ? biz.ownerId : party;
    const c = world.citizens[holder];
    if (!c || !isPresent(world, c)) continue;
    if (!best || amount > best.amount || (amount === best.amount && holder < best.id)) {
      best = { id: holder, amount };
    }
  }
  return best?.id ?? null;
}

/** Give the purse back, pro rata, to whoever filled it. Returns what was returned. */
export function refundPurse(world: World, p: ResearchProject, why: string): number {
  const left = purseOf(world, p);
  if (left <= 0) return 0;
  const total = Object.values(p.funded).reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) {
    moveThroughBox(world, p.purseId, 'treasury', left, REFUND_KIND, `unclaimed purse of ${p.name}`);
    return left;
  }
  let returned = 0;
  const parties = Object.keys(p.funded).sort((a, b) => (p.funded[b] ?? 0) - (p.funded[a] ?? 0) || a.localeCompare(b));
  for (const party of parties) {
    const share = Math.floor(left * (p.funded[party] ?? 0) / total);
    if (share <= 0) continue;
    // A funder who has left the city or wound up is paid to the Treasury: the
    // lumens go somewhere that exists, and the audit never notices a hole.
    const target: MoneyParty = party === 'treasury' ? 'treasury'
      : world.citizens[party] ? party : world.businesses[party]?.dissolvedDay === null ? party : 'treasury';
    if (moveThroughBox(world, p.purseId, target, share, REFUND_KIND, `${why}: ${p.name}`)) returned += share;
  }
  const remainder = purseOf(world, p);
  if (remainder > 0 && moveThroughBox(world, p.purseId, 'treasury', remainder, REFUND_KIND, `remainder of ${p.name}`)) {
    returned += remainder;
  }
  return returned;
}

/** The purse a wage or a volume is paid out of, through the ordinary money funnel. */
export function payFromPurse(
  world: World, p: ResearchProject, to: MoneyParty, amount: number, kind: 'wage' | 'income_tax', memo: string,
): boolean {
  return moveThroughBox(world, p.purseId, to, amount, kind, memo);
}
