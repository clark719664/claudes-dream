/**
 * The Treasury and every movement of lumens in Reverie.
 *
 * All money changes hands through transfer(); nothing else in src/ may assign
 * a wallet, a business treasury or the Treasury balance. That single funnel is
 * what makes the money supply auditable (auditMoneySupply) and the ledger
 * complete. Business profit/loss is tracked here too, because every lumen a
 * business earns or spends passes through this file.
 */
import { clamp, isBusinessId } from '../types.ts';
import type { Business, CitizenId, LedgerEntry, LedgerKind, MoneyParty, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';

/** Daily stipends for public office, paid from the Treasury via withholdingPay. */
export const OFFICE_SALARIES = { mayor: 30, councillor: 20, judge: 25 } as const;

/** Money flowing into a business that is not revenue. */
const NOT_REVENUE: readonly LedgerKind[] = ['capital', 'loan'];
/** Money flowing out of a business that is not an operating cost. */
const NOT_COST: readonly LedgerKind[] = ['payout', 'profit_tax', 'capital', 'seizure'];

/** "12,345" — thousands separators without locale dependence. */
export function formatNumber(n: number): string {
  const sign = n < 0 ? '−' : '';
  const digits = String(Math.abs(Math.round(n)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "12,345 ℓ" */
export function formatLumens(n: number): string {
  return `${formatNumber(n)} ℓ`;
}

function businessOf(world: World, party: MoneyParty): Business | null {
  if (!isBusinessId(party)) return null;
  return world.businesses[party] ?? null;
}

/** Current balance of a party. 'mint' is infinite; 'burn' and unknown parties hold nothing; 'chest' is the Community Chest. */
export function balanceOf(world: World, party: MoneyParty): number {
  if (party === 'treasury') return world.treasury.balance;
  if (party === 'chest') return world.treasury.chest ?? 0;
  if (party === 'mint') return Number.POSITIVE_INFINITY;
  if (party === 'burn') return 0;
  const c = world.citizens[party];
  if (c) return c.wallet;
  const b = world.businesses[party];
  if (b) return b.treasury;
  return 0;
}

/** Can this party be credited? Dissolved businesses and the mint cannot receive. */
function canReceive(world: World, party: MoneyParty): boolean {
  if (party === 'treasury' || party === 'burn' || party === 'chest') return true;
  if (party === 'mint') return false;
  if (world.citizens[party]) return true;
  const b = world.businesses[party];
  return !!b && b.dissolvedDay === null;
}

function isKnownPayer(world: World, party: MoneyParty): boolean {
  if (party === 'treasury' || party === 'mint' || party === 'chest') return true;
  if (party === 'burn') return false;
  return !!world.citizens[party] || !!world.businesses[party];
}

function debit(world: World, party: MoneyParty, amount: number): void {
  if (party === 'treasury') { world.treasury.balance -= amount; return; }
  if (party === 'chest') { world.treasury.chest = (world.treasury.chest ?? 0) - amount; return; }
  if (party === 'mint') { world.treasury.minted += amount; return; }
  const c = world.citizens[party];
  if (c) { c.wallet -= amount; return; }
  const b = world.businesses[party];
  if (b) b.treasury -= amount;
}

function credit(world: World, party: MoneyParty, amount: number): void {
  if (party === 'treasury') { world.treasury.balance += amount; return; }
  if (party === 'chest') { world.treasury.chest = (world.treasury.chest ?? 0) + amount; return; }
  if (party === 'burn') { world.treasury.burned += amount; return; }
  const c = world.citizens[party];
  if (c) { c.wallet += amount; return; }
  const b = world.businesses[party];
  if (b) b.treasury += amount;
}

const FLOW_TICK_KEY = 'treasuryFlowTick';
const FLOW_REVENUE_KEY = 'treasuryRevenueTick';
const FLOW_SPEND_KEY = 'treasurySpendTick';
const REVENUE_YESTERDAY_KEY = 'treasuryRevenueYesterday';
const SPEND_YESTERDAY_KEY = 'treasurySpendYesterday';
const REVENUE_TOTAL_KEY = 'treasuryRevenueTotal';
const SPEND_TOTAL_KEY = 'treasurySpendTotal';

/**
 * The Treasury's own flows within the current tick. The morning rollover pays
 * the dividend, the stipends and the arrival grants before the day's wage
 * budget is set (economy/budget.ts), and those payments land in the same daily
 * counters as yesterday's takings, which are not closed until the end of the
 * rollover. Recording each tick's flows separately lets the budget tell
 * "what the city took yesterday" from "what it has already committed today".
 */
function noteTreasuryFlow(world: World, revenue: number, spend: number): void {
  if (world.counters[FLOW_TICK_KEY] !== world.tick) {
    world.counters[FLOW_TICK_KEY] = world.tick;
    world.counters[FLOW_REVENUE_KEY] = 0;
    world.counters[FLOW_SPEND_KEY] = 0;
  }
  if (revenue > 0) {
    world.counters[FLOW_REVENUE_KEY] = (world.counters[FLOW_REVENUE_KEY] ?? 0) + revenue;
    world.counters[REVENUE_TOTAL_KEY] = (world.counters[REVENUE_TOTAL_KEY] ?? 0) + revenue;
  }
  if (spend > 0) {
    world.counters[FLOW_SPEND_KEY] = (world.counters[FLOW_SPEND_KEY] ?? 0) + spend;
    world.counters[SPEND_TOTAL_KEY] = (world.counters[SPEND_TOTAL_KEY] ?? 0) + spend;
  }
}

/** What the Treasury has taken in and paid out so far this tick. */
export function treasuryFlowThisTick(world: World): { revenue: number; spend: number } {
  if (world.counters[FLOW_TICK_KEY] !== world.tick) return { revenue: 0, spend: 0 };
  return { revenue: world.counters[FLOW_REVENUE_KEY] ?? 0, spend: world.counters[FLOW_SPEND_KEY] ?? 0 };
}

/**
 * Every lumen the Treasury has taken in and paid out since the city was
 * founded, never reset. The daily counters (`revenueToday`, `spendToday`) are
 * cleared at the *end* of the morning rollover, which means the rollover's own
 * payments — the dividend and the stipends before the wage budget is set, and
 * the Museum's acquisitions, the arrival grants, the champions' purse and the
 * public works bonus after it — belong to a day that has already closed by the
 * time anything reads them. Anything measuring a day's flows off those
 * counters therefore misses the whole of the morning, which is where most of
 * the city's spending happens: on seed 7 that was 447 ℓ a day the wage budget
 * never saw. Running totals have no seam to fall through — the difference
 * between two marks is exactly what moved between them, whatever hour it moved
 * in. A world saved before these existed reads as a fresh mark and loses one
 * day's reading, not the count.
 */
export function treasuryTotals(world: World): { revenue: number; spend: number } {
  return { revenue: world.counters[REVENUE_TOTAL_KEY] ?? 0, spend: world.counters[SPEND_TOTAL_KEY] ?? 0 };
}

/**
 * The balance sheet the Chronicle printed this morning: the revenue and spend
 * of the day that just closed. Everyone in the city can read it, so citizens
 * (councillors above all) may weigh it when they vote.
 */
export function lastBalanceSheet(world: World): { revenue: number; spend: number } {
  return { revenue: world.counters[REVENUE_YESTERDAY_KEY] ?? 0, spend: world.counters[SPEND_YESTERDAY_KEY] ?? 0 };
}

/** Keep each business's daily revenue/cost counters in step with its cash flows. */
function trackBusinessFlows(world: World, from: MoneyParty, to: MoneyParty, amount: number, kind: LedgerKind): void {
  const dest = businessOf(world, to);
  if (dest && !NOT_REVENUE.includes(kind)) dest.revenueToday += amount;
  const src = businessOf(world, from);
  if (src && !NOT_COST.includes(kind)) src.costsToday += amount;
}

/**
 * Move an integer amount of lumens. Returns false (and changes nothing) when
 * the payer cannot cover it, when either party is unknown, or on a self-transfer.
 * 'mint' has infinite funds and 'burn' absorbs; both are recorded on the Treasury.
 */
export function transfer(
  world: World, from: MoneyParty, to: MoneyParty, amount: number, kind: LedgerKind, memo: string,
): boolean {
  if (!Number.isFinite(amount)) return false;
  const amt = Math.round(amount);
  if (amt <= 0) return false;
  if (from === to) return false;
  if (!isKnownPayer(world, from) || !canReceive(world, to)) return false;
  if (balanceOf(world, from) < amt) return false;

  debit(world, from, amt);
  credit(world, to, amt);

  const t = world.treasury;
  const entry: LedgerEntry = { tick: world.tick, kind, amount: amt, from, to, memo };
  t.ledger.push(entry);
  const max = Math.max(1, world.config.ledgerLength);
  if (t.ledger.length > max) t.ledger.splice(0, t.ledger.length - max);
  t.totals[kind] = (t.totals[kind] ?? 0) + amt;
  if (to === 'treasury') t.revenueToday += amt;
  if (from === 'treasury') t.spendToday += amt;
  if (to === 'treasury' || from === 'treasury') noteTreasuryFlow(world, to === 'treasury' ? amt : 0, from === 'treasury' ? amt : 0);
  trackBusinessFlows(world, from, to, amt, kind);
  return true;
}

/**
 * Pay a citizen a gross amount with income tax withheld. The tax leg goes to
 * the Treasury as 'income_tax'; when the Treasury itself is the payer only the
 * net amount leaves it (the tax is recorded, not round-tripped). A payer short
 * of funds pays pro rata. `opts.taxRate` overrides the government rate (tax
 * evasion passes 0). Returns what was actually paid.
 */
export function withholdingPay(
  world: World, payer: MoneyParty, payee: CitizenId, gross: number,
  // The metropolis pays for a gig and for a share of a payout through the same
  // funnel; nothing else about the money changes.
  kind: 'wage' | 'salary' | 'payout' | 'gig' | 'share_dividend', memo: string, opts?: { taxRate?: number },
): { net: number; tax: number } {
  const none = { net: 0, tax: 0 };
  const c = world.citizens[payee];
  if (!c || payer === payee || !Number.isFinite(gross)) return none;
  const wanted = Math.round(gross);
  if (wanted <= 0 || !isKnownPayer(world, payer)) return none;

  const available = balanceOf(world, payer);
  const actual = Math.min(wanted, Math.max(0, Math.floor(available)));
  if (actual <= 0) return none;

  const rate = clamp(opts?.taxRate ?? world.government.incomeTax, 0, 1);
  const tax = Math.round(actual * rate);
  const net = actual - tax;

  if (payer === 'treasury') {
    if (net > 0 && !transfer(world, 'treasury', payee, net, kind, memo)) return none;
    if (tax > 0) world.treasury.totals.income_tax = (world.treasury.totals.income_tax ?? 0) + tax;
  } else {
    if (tax > 0 && !transfer(world, payer, 'treasury', tax, 'income_tax', memo)) return none;
    if (net > 0 && !transfer(world, payer, payee, net, kind, memo)) {
      c.stats.totalTaxPaid += tax;
      return { net: 0, tax };
    }
  }
  c.stats.totalEarned += net;
  c.stats.totalTaxPaid += tax;
  return { net, tax };
}

/**
 * Ids of citizens actually living in the city: in the turn order and not
 * exiled. Emigrants keep their standing but leave the order, so this is the
 * test the daily money flows (dividend, rent, loans) use.
 */
export function residentIds(world: World): Set<CitizenId> {
  const out = new Set<CitizenId>();
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && c.standing !== 'exiled') out.add(id);
  }
  return out;
}

function receivesPublicMoney(world: World, id: CitizenId, residents: Set<CitizenId>): boolean {
  const c = world.citizens[id];
  return !!c && residents.has(id) && (c.standing === 'good' || c.standing === 'probation');
}

/**
 * The most of yesterday's takings the citizen's dividend may share out. The
 * dividend is a share of what the city takes, not a draw on what it holds:
 * above this the bill is met pro rata and the shortfall is printed.
 *
 * Two fifths is a wide line. The reference budget in `docs/ECONOMY.md` shares
 * out a third of the city's takings and never comes near it, and no dividend
 * the city can actually pay is refused by it. What it stops is the *unpayable*
 * one. The Council votes a rate per head while the Treasury's capacity is a
 * total, and the two part company twice over — the rate is set once and the
 * population doubles under it, and a party platform reads as a position
 * between 0 and the Charter's 60 ℓ, so a middling platform means 30 ℓ a head
 * a day against takings of about 45 ℓ a head. On seed 7 a single platform
 * motion took the dividend from 3 ℓ to 30 ℓ on day 94 and the city lost 39,000
 * ℓ — two thirds of its Treasury — in the seventeen days it took the reserve's
 * float and the Council between them to unwind it.
 *
 * This does not overrule the vote and does not decide what the dividend should
 * be: the rate the Council set stands, the shortfall is public, the Treasury
 * goes on losing money at the reduced rate (so the reserve is still breached
 * and the float still trims, which is what actually brings the rate back
 * down), and a Council that wants to spend two fifths of the city's
 * takings on the dividend still can. It is the same arithmetic that already paid the dividend
 * pro rata out of an empty Treasury, moved off the edge of the cliff.
 */
export const DIVIDEND_REVENUE_SHARE = 0.4;

/**
 * Daily citizen's dividend to everyone in good standing or on probation. When
 * the Treasury cannot cover the full bill — or the bill is more of yesterday's
 * takings than the city shares out — the dividend is paid pro rata; when there
 * is nothing to share the dividend is suspended and the Chronicle hears about
 * it.
 */
export function payDividend(world: World): void {
  const dividend = Math.round(world.government.dividend);
  if (dividend <= 0) return;
  const residents = residentIds(world);
  const eligible = Object.values(world.citizens).filter((c) => receivesPublicMoney(world, c.id, residents));
  if (eligible.length === 0) return;

  const total = dividend * eligible.length;
  // What the city took yesterday, as the Chronicle printed it this morning.
  // Before the first balance sheet there is no reading, and the founding city
  // pays what the Council set.
  const takings = lastBalanceSheet(world).revenue;
  const purse = Math.min(world.treasury.balance, takings > 0 ? Math.floor(takings * DIVIDEND_REVENUE_SHARE) : total);
  const share = purse >= total ? dividend : Math.floor(Math.max(0, purse) / eligible.length);
  if (share <= 0) {
    emit(world, 'treasury', "The Treasury is empty: the citizen's dividend is suspended today.", [], 0.7);
    return;
  }
  let count = 0;
  for (const c of eligible) {
    if (!transfer(world, 'treasury', c.id, share, 'dividend', "citizen's dividend")) continue;
    count++;
    remember(world, c.id, 'money', `You received the citizen's dividend of ${share} ℓ.`);
  }
  if (share < dividend) {
    emit(world, 'treasury',
      `Treasury shortfall: the dividend of ${dividend} ℓ would take ${formatLumens(total)} and the city took ${formatLumens(takings)} yesterday, `
      + `so it was paid pro rata at ${share} ℓ.`, [], 0.6, { dividend, share, total, takings });
  } else {
    emit(world, 'paid', `Dividend of ${dividend} ℓ paid to ${count} citizens (${formatLumens(share * count)}).`, [], 0.1);
  }
}

/** Daily stipends for the mayor, councillors and judges (mayor's stipend supersedes a council seat). */
export function paySalaries(world: World): void {
  const g = world.government;
  const stipends = new Map<CitizenId, { office: string; amount: number }>();
  for (const id of g.judges) stipends.set(id, { office: 'judge', amount: OFFICE_SALARIES.judge });
  for (const id of g.council) stipends.set(id, { office: 'councillor', amount: OFFICE_SALARIES.councillor });
  if (g.mayorId) stipends.set(g.mayorId, { office: 'mayor', amount: OFFICE_SALARIES.mayor });

  const residents = residentIds(world);
  let paid = 0;
  let count = 0;
  for (const [id, s] of stipends) {
    if (!receivesPublicMoney(world, id, residents)) continue;
    const { net, tax } = withholdingPay(world, 'treasury', id, s.amount, 'salary', `${s.office}'s stipend`);
    if (net <= 0) continue;
    paid += net;
    count++;
    const c = world.citizens[id];
    c.needs.purpose = clamp(c.needs.purpose + 3, 0, 100);
    remember(world, id, 'money', `You received your ${s.office}'s stipend: ${net} ℓ (${tax} ℓ withheld in tax).`);
  }
  if (count > 0) emit(world, 'paid', `Public stipends paid to ${count} office holders (${formatLumens(paid)} net).`, [], 0.1);
}

/** Treasury + Community Chest + every wallet + every business treasury. */
export function moneySupply(world: World): number {
  let sum = world.treasury.balance + (world.treasury.chest ?? 0);
  for (const c of Object.values(world.citizens)) sum += c.wallet;
  for (const b of Object.values(world.businesses)) sum += b.treasury;
  return sum;
}

/** Lumens are conserved: supply must equal founding + minted − burned. */
export function auditMoneySupply(world: World): { supply: number; expected: number; ok: boolean } {
  const supply = moneySupply(world);
  const t = world.treasury;
  const expected = t.foundingSupply + t.minted - t.burned;
  const ok = supply === expected;
  if (!ok) {
    emit(world, 'system', `Money supply audit failed: ${formatLumens(supply)} in circulation but ${formatLumens(expected)} expected.`,
      [], 0.9, { supply, expected });
  }
  return { supply, expected, ok };
}

/**
 * End-of-day balance sheet. Returns the one-line report for the Chronicle,
 * resets the daily counters, and raises the alarm when the balance could not
 * cover another day like today.
 */
export function dailyTreasuryRollover(world: World): string {
  const t = world.treasury;
  const revenue = t.revenueToday;
  const spend = t.spendToday;
  const report = `Treasury: ${formatLumens(t.balance)} (+${formatNumber(revenue)} revenue, −${formatNumber(spend)} spend)`;
  const crisis = t.balance < spend;
  if (crisis) {
    emit(world, 'treasury', `Treasury crisis: only ${formatLumens(t.balance)} left after spending ${formatLumens(spend)} in a day.`,
      [], 0.9, { balance: t.balance, revenue, spend });
  } else {
    emit(world, 'treasury', report, [], 0.2, { balance: t.balance, revenue, spend });
  }
  world.counters[REVENUE_YESTERDAY_KEY] = revenue;
  world.counters[SPEND_YESTERDAY_KEY] = spend;
  t.revenueToday = 0;
  t.spendToday = 0;
  return report;
}
