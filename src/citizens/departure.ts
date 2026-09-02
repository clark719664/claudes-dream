/**
 * Leaving the city: the plain-data teardown shared by voluntary emigration
 * (citizen.ts). Clears the citizen's job, offices, home and business without
 * touching their standing or record. Money moves only through the Treasury's
 * transfer(); the housing count goes through housing.moveHome with a plain
 * fallback so the ledger of occupied rooms never drifts.
 */
import type { Business, Citizen, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { moveHome } from '../economy/housing.ts';

export interface DepartureOutcome {
  /** Loan balance the citizen could not settle before leaving (written off). */
  unpaidLoan: number;
  /** Ids of employees who lost their jobs when the citizen's business closed. */
  laidOff: CitizenId[];
}

/** Remove the citizen from the turn order (idempotent). */
function leaveOrder(world: World, cId: CitizenId): void {
  for (let i = world.order.length - 1; i >= 0; i--) {
    if (world.order[i] === cId) world.order.splice(i, 1);
  }
}

/** Give up the citizen's job: the position reopens; a business employer drops them. */
function releaseJob(world: World, c: Citizen): void {
  if (!c.jobId) return;
  const job = world.jobs[c.jobId];
  c.jobId = null;
  if (!job) return;
  if (job.holderId === c.id) job.holderId = null;
  const employer = world.businesses[job.employer];
  if (employer) employer.employees = employer.employees.filter((id) => id !== c.id);
}

/** Vacate every office and candidacy the citizen holds. */
function vacateOffices(world: World, c: Citizen): void {
  const g = world.government;
  g.council = g.council.filter((id) => id !== c.id);
  g.judges = g.judges.filter((id) => id !== c.id);
  g.watch = g.watch.filter((id) => id !== c.id);
  if (g.mayorId === c.id) g.mayorId = null;
  if (g.watchCaptainId === c.id) g.watchCaptainId = null;
  c.office = null;
  c.judgeTermEndsDay = null;
  const e = g.election;
  e.candidates = e.candidates.filter((id) => id !== c.id);
  for (const [voter, candidate] of Object.entries(e.ballots)) {
    if (candidate === c.id) delete e.ballots[voter];
  }
  c.platform = null;
  c.campaignVisibility = 0;
}

/** Hand back the citizen's room; falls back to a plain count fix if housing refuses. */
function vacateHome(world: World, c: Citizen): void {
  const tier = c.homeTier;
  if (tier === 0) return;
  const result = moveHome(world, c.id, 0);
  if (result.ok && c.homeTier === 0) return;
  world.housing.occupied[tier] = Math.max(0, world.housing.occupied[tier] - 1);
  c.homeTier = 0;
  c.rentArrearsDays = 0;
}

/** Repay as much of any loan as the wallet allows; the remainder is written off. Returns the unpaid balance. */
function settleLoan(world: World, c: Citizen): number {
  if (!c.loanId) return 0;
  const loan = world.loans[c.loanId];
  c.loanId = null;
  if (!loan) return 0;
  const owed = Math.max(0, Math.round(loan.outstanding));
  const payment = Math.min(owed, Math.max(0, Math.floor(c.wallet)));
  if (payment > 0 && transfer(world, c.id, 'treasury', payment, 'repayment', `${c.name} settles their loan before leaving`)) {
    loan.outstanding = owed - payment;
  }
  const unpaid = Math.max(0, Math.round(loan.outstanding));
  delete world.loans[loan.id];
  if (unpaid > 0) emit(world, 'loan', `${c.name} left the city owing ${unpaid} ℓ to the Lantern Bank.`, [c.id], 0.4);
  return unpaid;
}

/** Close a business: staff lose their jobs, positions vanish, what is left in the till goes to the owner. */
function closeBusiness(world: World, owner: Citizen, b: Business): CitizenId[] {
  const laidOff: CitizenId[] = [];
  for (const jobId of b.jobs) {
    const job = world.jobs[jobId];
    if (!job) continue;
    if (job.holderId) {
      const holder = world.citizens[job.holderId];
      if (holder && holder.jobId === jobId) {
        holder.jobId = null;
        laidOff.push(holder.id);
        remember(world, holder.id, 'work', `You lost your job as ${job.title}: ${b.name} closed when ${owner.name} left the city.`);
      }
      job.holderId = null;
    }
    delete world.jobs[jobId];
  }
  b.employees = [];
  const till = Math.round(b.treasury);
  if (till > 0) transfer(world, b.id, owner.id, till, 'payout', `${b.name} liquidated on ${owner.name}'s departure`);
  b.dissolvedDay = world.day;
  emit(world, 'system', `${b.name} closed its doors: its owner ${owner.name} left the city.`, [owner.id, ...laidOff], 0.4);
  return laidOff;
}

function dissolveOwnedBusiness(world: World, c: Citizen): CitizenId[] {
  if (!c.businessId) return [];
  const b = world.businesses[c.businessId];
  c.businessId = null;
  if (!b || b.dissolvedDay !== null) return [];
  return closeBusiness(world, c, b);
}

/**
 * Tear down a citizen's ties to the city. Standing and record are untouched;
 * the citizen ends up at the Threshold, out of the turn order.
 */
export function departCity(world: World, c: Citizen): DepartureOutcome {
  leaveOrder(world, c.id);
  releaseJob(world, c);
  vacateOffices(world, c);
  vacateHome(world, c);
  const unpaidLoan = settleLoan(world, c);
  const laidOff = dissolveOwnedBusiness(world, c);
  c.district = 'threshold';
  return { unpaidLoan, laidOff };
}
