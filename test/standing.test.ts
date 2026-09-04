/**
 * The notice of standing and the residency hearing (`docs/CITIZENSHIP.md` §3).
 *
 * A notice issued and itemised, withdrawn by three days of recovery, halved on
 * a second, and skipped for a collapse or a severity-4 offence against a
 * person; a hearing confirming, extending and ending; a prisoner never sent
 * down; and — the rule the whole file exists to keep — that nothing here can
 * exile anybody.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Character, Citizen, World } from '../src/types.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import { dailyRepute, reputeOf } from '../src/standing/repute.ts';
import { residencyLine, sponsor } from '../src/standing/gates.ts';
import {
  BASE_GRACE_DAYS, CHILD_GRACE_DAYS, COLLAPSE_SHORTFALL, MAX_RESIDENCY_GRACE, RECOVERY_DAYS, applyResidency,
  dailyNotices, graceFor, issueNotice, openNotices,
} from '../src/standing/notices.ts';
import {
  LEAVE_DAYS, MAX_EXTENSION_DAYS, RESIDENCY_HEARING_HOUR, countHearing, dailyHearings, hearingsDue,
  hearingsObservation, holdHearing,
} from '../src/standing/hearings.ts';
import { noticeOf, standingState } from '../src/standing/state.ts';
import { reputeObservation } from '../src/standing/observe.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STANDING_DIR = join(ROOT, 'src', 'standing');

function flat(v: number): Character {
  return { honesty: v, diligence: v, sociability: v, generosity: v, civic: v };
}

function nextDay(world: World, days = 1): void {
  world.tick += 24 * days;
  world.day = Math.floor(world.tick / 24);
  world.hour = world.tick % 24;
}

/** A citizen sitting at exactly this repute: 300 + 2·reputation, with a flat-zero character. */
function citizenAt(world: World, repute: number, extra: Record<string, unknown> = {}): Citizen {
  const reputation = (repute - 300) / 2;
  return makeCitizen(world, { reputation, character: flat(0), ...extra });
}

/** One morning of the standing round, in the order daily.ts runs it. */
function morning(world: World): void {
  dailyRepute(world);
  dailyNotices(world);
  dailyHearings(world);
}

// ------------------------------------------------------------- the notice

test('the morning repute falls below the line, the Registry issues a notice', () => {
  const world = makeWorld();
  const c = citizenAt(world, 400);
  morning(world);
  const notice = noticeOf(world, c.id);
  assert.ok(notice, 'a notice stands');
  assert.equal(notice.line, residencyLine(world));
  assert.equal(notice.reputeAtIssue, 400);
  assert.equal(notice.shortfall, 40);
  assert.equal(notice.issuedDay, world.day);
  assert.equal(openNotices(world).length, 1);
});

test('a notice takes nothing away: every right is kept throughout', () => {
  const world = makeWorld();
  const c = citizenAt(world, 400, { wallet: 500, homeTier: 2, standing: 'good' });
  c.jobId = 'j_1';
  morning(world);
  assert.ok(noticeOf(world, c.id));
  assert.equal(c.standing, 'good');
  assert.equal(c.wallet, 500);
  assert.equal(c.homeTier, 2);
  assert.equal(c.jobId, 'j_1');
  assert.equal(c.suspendedUntilDay, null);
  assert.equal(c.jailedUntilDay, null);
  assert.equal(c.detainedUntilTick, null);
  assert.equal(world.bans.length, 0);
});

test('the notice itemises exactly what cost what, and names the day the grace ends', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { reputation: 50, character: flat(0.5) });
  c.record.convictions.push({ caseId: 'k_1', law: 'L14', severity: 5, tier: 5, day: 0 });
  morning(world);
  const notice = noticeOf(world, c.id);
  assert.ok(notice);

  const conviction = notice.items.find((i) => i.caseId === 'k_1');
  assert.ok(conviction, 'the conviction is itemised by case');
  assert.equal(conviction.kind, 'civic');
  assert.equal(conviction.amount, -250);
  assert.ok(conviction.label.includes('Election fraud'));

  const shortfall = notice.items.find((i) => i.kind === 'shortfall');
  assert.ok(shortfall);
  assert.equal(shortfall.amount, notice.reputeAtIssue - notice.line);

  assert.equal(notice.graceEndsDay, notice.issuedDay + notice.graceDays);
  // It reached the citizen: their inbox, their memory and the public register.
  assert.ok(c.inbox.some((m) => m.text.includes('Notice of standing')));
  assert.ok(c.inbox.some((m) => m.text.includes(`day ${notice.graceEndsDay}`)));
  assert.ok(c.memory.some((m) => m.text.includes('notice of standing')));
  assert.ok(world.events.some((e) => e.kind === 'standing' && e.text.includes('notice of standing')));
});

test('grace is 21 days, one more per ten of residency to +39, and 14 more with a child', () => {
  const world = makeWorld();
  const fresh = makeCitizen(world);
  assert.equal(graceFor(world, fresh), BASE_GRACE_DAYS);

  nextDay(world, 400);
  const old = makeCitizen(world, { arrivedDay: 0 });
  assert.equal(graceFor(world, old), BASE_GRACE_DAYS + MAX_RESIDENCY_GRACE, 'the cap is +39');

  const child = makeCitizen(world, { lifeStage: 'child' });
  const parent = makeCitizen(world, { arrivedDay: world.day });
  parent.family.children = [child.id];
  assert.equal(graceFor(world, parent), BASE_GRACE_DAYS + CHILD_GRACE_DAYS);
});

test('three consecutive days back above the line withdraws the notice and destroys the clock', () => {
  const world = makeWorld();
  const c = citizenAt(world, 400);
  morning(world);
  assert.ok(noticeOf(world, c.id));

  c.reputation = 80; // 460: back above the line
  for (let i = 0; i < RECOVERY_DAYS - 1; i++) {
    nextDay(world);
    morning(world);
    assert.ok(noticeOf(world, c.id), 'two days is not three');
  }
  nextDay(world);
  morning(world);
  assert.equal(noticeOf(world, c.id), null, 'withdrawn');
  assert.equal(standingState(world).notices[c.id], undefined, 'and struck from the register');
  assert.ok(c.memory.some((m) => m.text.includes('withdrawn and struck')));
});

test('a dip that does not last resets the count: recovery must be consecutive', () => {
  const world = makeWorld();
  const c = citizenAt(world, 400);
  morning(world);
  c.reputation = 80;
  nextDay(world);
  morning(world);
  assert.equal(noticeOf(world, c.id)?.daysAbove, 1);
  c.reputation = 50;
  nextDay(world);
  morning(world);
  assert.equal(noticeOf(world, c.id)?.daysAbove, 0);
});

test('a second notice within a cycle halves the remaining grace', () => {
  const world = makeWorld();
  const c = citizenAt(world, 400);
  morning(world);
  const first = noticeOf(world, c.id);
  assert.ok(first);
  assert.equal(first.halved, false);
  const fullGrace = first.graceDays;

  // Recover, be struck off, and fall again inside the same cycle.
  c.reputation = 80;
  for (let i = 0; i < RECOVERY_DAYS; i++) {
    nextDay(world);
    morning(world);
  }
  assert.equal(noticeOf(world, c.id), null);
  c.reputation = 50;
  nextDay(world);
  morning(world);
  const second = noticeOf(world, c.id);
  assert.ok(second);
  assert.equal(second.halved, true);
  assert.equal(second.graceDays, Math.floor(fullGrace / 2));
});

test('a collapse gets no grace at all: the hearing opens at once', () => {
  const world = makeWorld();
  // 300 from the floor, less a tier-2 fine: 275, which is 165 below the line.
  const c = citizenAt(world, 300);
  c.record.convictions.push({ caseId: 'k_1', law: 'L04', severity: 2, tier: 2, day: 0 });
  morning(world);
  assert.ok(residencyLine(world) - reputeOf(world, c.id) >= COLLAPSE_SHORTFALL);
  assert.equal(standingState(world).notices[c.id]?.immediate, true);
  const hearings = hearingsObservation(world, c.id);
  assert.equal(hearings.length, 1, 'the Court sat the same day');
  assert.ok(world.events.some((e) => e.kind === 'standing' && e.text.includes('with no grace')));
});

test('a conviction against a person at severity 4 skips the grace; a lesser one does not', () => {
  const world = makeWorld();
  const grave = makeCitizen(world, { reputation: 50, character: flat(0.5) });
  grave.record.convictions.push({ caseId: 'k_1', law: 'P04', severity: 4, tier: null, day: 0 });
  const lesser = makeCitizen(world, { reputation: 50, character: flat(0.5) });
  lesser.record.convictions.push({ caseId: 'k_2', law: 'P03', severity: 3, tier: null, day: 0 });
  lesser.record.convictions.push({ caseId: 'k_3', law: 'P01', severity: 2, tier: null, day: 0 });

  dailyRepute(world);
  assert.ok(reputeOf(world, grave.id) < residencyLine(world));
  assert.ok(reputeOf(world, lesser.id) < residencyLine(world));
  dailyNotices(world);

  const graveNotice = standingState(world).notices[grave.id];
  assert.ok(graveNotice);
  assert.equal(graveNotice.immediate, true);
  assert.equal(graveNotice.graceDays, 0);
  assert.ok(graveNotice.reason.includes('P04'));

  const lesserNotice = noticeOf(world, lesser.id);
  assert.ok(lesserNotice);
  assert.equal(lesserNotice.immediate, false);
  assert.ok(lesserNotice.graceDays >= BASE_GRACE_DAYS);
});

test('a city cannot amend people out of their homes', () => {
  const world = makeWorld();
  const c = citizenAt(world, 500);
  morning(world);
  assert.equal(noticeOf(world, c.id), null);
  // The Council raises the line above them. Their conduct has not changed.
  world.counters['gate:reverie:reside'] = 700;
  nextDay(world);
  morning(world);
  assert.equal(noticeOf(world, c.id), null, 'a line that rises issues no notice');
  // A fall below the line they actually met still does.
  c.reputation = 30;
  nextDay(world);
  morning(world);
  assert.ok(noticeOf(world, c.id));
});

// ------------------------------------------------------------ the hearing

test('the Council counts the most votes, and a tie takes the gentler course', () => {
  assert.equal(countHearing({ a: 'end', b: 'end', c: 'confirm' }), 'end');
  assert.equal(countHearing({ a: 'confirm', b: 'end' }), 'confirm');
  assert.equal(countHearing({ a: 'extend', b: 'end' }), 'extend');
  assert.equal(countHearing({}), 'confirm', 'a chamber that says nothing sends nobody down');
});

/** A council of one, with the disposition the test wants. */
function seatCouncillor(world: World, opts: { strict?: boolean; bondTo?: Citizen } = {}): Citizen {
  const councillor = makeCitizen(world, { office: 'councillor', character: flat(0.5) });
  councillor.platform = { tax: 0.5, dividend: 0.5, minWage: 0.5, strictness: opts.strict ? 1 : 0.5 };
  world.government.council = [councillor.id];
  if (opts.bondTo) {
    councillor.bonds[opts.bondTo.id] = 100;
    opts.bondTo.bonds[councillor.id] = 100;
  }
  return councillor;
}

test('the hearing sits at tick 12, and records who spoke and who vouched', () => {
  const world = makeWorld();
  const c = citizenAt(world, 380);
  const neighbour = makeCitizen(world);
  seatCouncillor(world, { bondTo: c });
  morning(world);
  const notice = noticeOf(world, c.id);
  assert.ok(notice);

  assert.equal(applyResidency(world, c.id).ok, false, 'sixty short, and nobody behind them yet');
  assert.equal(noticeOf(world, c.id)?.applied, true, 'the application is their own case, put in their own words');
  assert.equal(sponsor(world, neighbour.id, c.id).ok, true);

  nextDay(world, notice.graceDays);
  assert.equal(hearingsDue(world).length, 1);
  const hearing = holdHearing(world, notice);
  assert.ok(hearing);
  assert.equal(hearing.hour, RESIDENCY_HEARING_HOUR);
  assert.equal(hearing.spoke, true);
  assert.deepEqual(hearing.vouchers, [neighbour.id]);
  assert.ok(hearing.reasons.some((r) => r.includes('vouched for them')));
});

test('the Council may confirm a residency, and does not answer the same question twice in a cycle', () => {
  const world = makeWorld();
  const c = citizenAt(world, 430);
  const neighbour = makeCitizen(world);
  seatCouncillor(world, { bondTo: c });
  morning(world);
  const notice = noticeOf(world, c.id);
  assert.ok(notice);
  applyResidency(world, c.id);
  sponsor(world, neighbour.id, c.id);

  nextDay(world, notice.graceDays);
  const hearing = holdHearing(world, notice);
  assert.equal(hearing?.outcome, 'confirmed');
  assert.equal(noticeOf(world, c.id), null);
  assert.ok(world.order.includes(c.id));

  nextDay(world);
  morning(world);
  assert.equal(noticeOf(world, c.id), null, 'the judgement stands for a cycle');
});

test('the Council may extend the grace, by up to thirty days', () => {
  const world = makeWorld();
  const c = citizenAt(world, 430);
  seatCouncillor(world);
  morning(world);
  const notice = noticeOf(world, c.id);
  assert.ok(notice);
  nextDay(world, notice.graceDays);
  const hearing = holdHearing(world, notice);
  assert.equal(hearing?.outcome, 'extended');
  assert.ok(hearing.extendedDays > 0 && hearing.extendedDays <= MAX_EXTENSION_DAYS);
  assert.equal(notice.graceEndsDay, world.day + hearing.extendedDays);
  assert.equal(noticeOf(world, c.id), notice, 'the notice stands, and so does everything else');
  assert.equal(c.standing, 'good');
});

test('the Council may end a residency: fourteen days, and then the road', () => {
  const world = makeWorld();
  const c = citizenAt(world, 380);
  seatCouncillor(world, { strict: true });
  morning(world);
  const notice = noticeOf(world, c.id);
  assert.ok(notice);
  nextDay(world, notice.graceDays);
  const hearing = holdHearing(world, notice);
  assert.equal(hearing?.outcome, 'ended');
  assert.equal(hearing.leaveByDay, world.day + LEAVE_DAYS);

  // Through the fourteen days they are still here, with everything they had,
  // and no second notice is piled on top of the Council's one decision.
  for (let i = 0; i < LEAVE_DAYS - 1; i++) {
    nextDay(world);
    morning(world);
    assert.equal(noticeOf(world, c.id), null, 'one hearing is one hearing');
  }
  assert.ok(world.order.includes(c.id));
  assert.equal(c.standing, 'good');
  assert.equal(hearingsObservation(world, c.id).length, 1);

  nextDay(world);
  morning(world);
  assert.equal(world.order.includes(c.id), false, 'they took the road');
  assert.equal(c.standing, 'good', 'their standing is untouched');
  assert.equal(c.exiledDay, null);
  assert.equal(c.exiledCaseId, null);
  assert.equal(world.bans.length, 0, 'no entry on the exile register');
  assert.ok(world.events.some((e) => e.kind === 'standing' && e.text.includes('took the road')));
});

test('an empty chamber sends nobody down', () => {
  const world = makeWorld();
  const c = citizenAt(world, 380);
  morning(world);
  const notice = noticeOf(world, c.id);
  assert.ok(notice);
  nextDay(world, notice.graceDays);
  const hearing = holdHearing(world, notice);
  assert.equal(hearing?.outcome, 'adjourned');
  assert.ok(world.order.includes(c.id));
  assert.ok(notice.graceEndsDay > world.day);
});

test('a citizen in custody is never sent down: the clock starts on release', () => {
  const world = makeWorld();
  const c = citizenAt(world, 380);
  seatCouncillor(world, { strict: true });
  morning(world);
  const notice = noticeOf(world, c.id);
  assert.ok(notice);
  const endedOn = notice.graceEndsDay;

  c.jailedUntilDay = world.day + 100;
  for (let i = 0; i < 10; i++) {
    nextDay(world);
    morning(world);
  }
  assert.equal(hearingsDue(world).length, 0, 'no hearing sits on a prisoner');
  assert.equal(hearingsObservation(world, c.id).length, 0);
  assert.equal(noticeOf(world, c.id)?.graceEndsDay, endedOn + 10, 'the clock did not run inside');
  assert.ok(world.order.includes(c.id));

  // Released: the clock starts, and only then does the Court sit.
  c.jailedUntilDay = null;
  nextDay(world, 40);
  morning(world);
  assert.equal(hearingsObservation(world, c.id).length, 1);
});

test('a prisoner whose fourteen days run out inside keeps them until the door opens', () => {
  const world = makeWorld();
  const c = citizenAt(world, 380);
  seatCouncillor(world, { strict: true });
  morning(world);
  const notice = noticeOf(world, c.id);
  assert.ok(notice);
  nextDay(world, notice.graceDays);
  const hearing = holdHearing(world, notice);
  assert.equal(hearing?.outcome, 'ended');

  c.jailedUntilDay = world.day + 60;
  nextDay(world, LEAVE_DAYS + 5);
  morning(world);
  assert.ok(world.order.includes(c.id), 'nobody is put on the road out of a cell');
  c.jailedUntilDay = null;
  nextDay(world);
  morning(world);
  assert.equal(world.order.includes(c.id), false);
  assert.equal(c.standing, 'good');
  assert.equal(world.bans.length, 0);
});

test('a resident\'s name can still open the gate after the Council has closed it', () => {
  const world = makeWorld();
  const c = citizenAt(world, 400);
  const neighbour = makeCitizen(world);
  seatCouncillor(world, { strict: true });
  morning(world);
  const notice = noticeOf(world, c.id);
  assert.ok(notice);
  nextDay(world, notice.graceDays);
  assert.equal(holdHearing(world, notice)?.outcome, 'ended');

  sponsor(world, neighbour.id, c.id);
  const again = applyResidency(world, c.id);
  assert.equal(again.ok, true, 'they may apply again like anyone else');
  nextDay(world, LEAVE_DAYS + 1);
  morning(world);
  assert.ok(world.order.includes(c.id), 'admitted, and still at home');
});

// -------------------------------------------------------------- not exile

test('nothing in the standing layer can exile anybody', () => {
  for (const file of readdirSync(STANDING_DIR)) {
    if (!file.endsWith('.ts')) continue;
    const src = readFileSync(join(STANDING_DIR, file), 'utf8');
    assert.equal(src.includes('exileCitizen'), false, `${file} must not reach the Gate`);
    assert.equal(/standing\s*=\s*'/.test(src), false, `${file} must not set a citizen's standing`);
    assert.equal(/world\.bans/.test(src), false, `${file} must not touch the ban register`);
    assert.equal(/government\/registry\.ts/.test(src), false,
      `${file} must not reach the registry that exiles and suspends`);
    assert.equal(/suspendCitizen|takeIntoCustody|jailCitizen|detain\(/.test(src), false,
      `${file} must not reach a cell or a suspension`);
  }
});

test('a hearing that ends a residency leaves the record, the standing and the kin exactly as they were', () => {
  const world = makeWorld();
  const c = citizenAt(world, 380, { wallet: 300 });
  const kin = makeCitizen(world);
  c.family.children = [kin.id];
  kin.family.parents = [c.id];
  c.record.convictions.push({ caseId: 'k_1', law: 'L04', severity: 2, tier: 2, day: 0 });
  seatCouncillor(world, { strict: true });
  morning(world);
  const notice = noticeOf(world, c.id);
  assert.ok(notice);
  nextDay(world, notice.graceDays);
  holdHearing(world, notice);
  nextDay(world, LEAVE_DAYS);
  morning(world);

  assert.equal(c.standing, 'good');
  assert.equal(c.record.convictions.length, 1, 'the record is theirs and stays');
  assert.deepEqual(c.family.children, [kin.id]);
  assert.equal(world.bans.length, 0);
  assert.equal(world.citizens[c.id], c, 'no citizen is ever deleted');
});

// ------------------------------------------------------------ observation

test('the observation carries the score broken out, the notice, and what it keeps', () => {
  const world = makeWorld();
  const c = citizenAt(world, 400);
  c.record.convictions.push({ caseId: 'k_1', law: 'L06', severity: 3, tier: 3, day: 0 });
  morning(world);
  const view = reputeObservation(world, c.id);
  assert.ok(view);
  assert.equal(view.score, reputeOf(world, c.id));
  assert.equal(view.baseline, 300);
  assert.equal(typeof view.contribution, 'number');
  assert.equal(view.civicPenalty, 45);
  assert.equal(view.custodialPenalty, 0);
  assert.equal(view.tested, true);
  assert.equal(view.line, residencyLine(world));
  assert.ok(view.penalties.some((p) => p.caseId === 'k_1' && p.lawName === 'Vandalism'));
  assert.ok(view.notice);
  assert.ok(view.notice.items.length > 0);
  assert.ok(view.notice.keeps.some((k) => k.includes('vote')));
  assert.equal(view.notice.recoveryDays, RECOVERY_DAYS);
});

test('the Registry reads one application a day', () => {
  const world = makeWorld();
  const c = citizenAt(world, 400);
  morning(world);
  assert.equal(applyResidency(world, c.id).ok, false);
  const again = applyResidency(world, c.id);
  assert.equal(again.ok, false);
  assert.match(again.message, /already read your application today/);
});

test('applying from above the line asks nothing of the city, and buys nothing', () => {
  const world = makeWorld();
  const c = citizenAt(world, 500);
  morning(world);
  assert.equal(applyResidency(world, c.id).ok, true);
  assert.equal(standingState(world).confirmedUntilDay[c.id], undefined);
  // A later fall still issues its notice on the ordinary day.
  c.reputation = 40;
  nextDay(world);
  morning(world);
  assert.ok(noticeOf(world, c.id));
});

test('an issued notice is a fact anybody can read, about anybody', () => {
  const world = makeWorld();
  const c = citizenAt(world, 400);
  dailyRepute(world);
  issueNotice(world, c);
  const view = reputeObservation(world, c.id);
  assert.ok(view?.notice);
  assert.equal(openNotices(world)[0].citizenId, c.id);
});
