import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Citizen, Job, Platform, World } from '../src/types.ts';
import { nextId } from '../src/util/ids.ts';
import {
  appointJudges, campaign, castBallot, councilSession, councillorDisposition, dailyGovernment, daysToElection, enactProposal,
  holdElection, nominate, openNominations, tableProposal, voteOnProposal, voterPreference,
} from '../src/government/council.ts';

const NEUTRAL: Platform = { tax: 0.5, dividend: 0.5, minWage: 0.5, strictness: 0.5 };

function seatCouncil(w: World, members: Citizen[]): void {
  w.government.council = members.map((m) => m.id);
  w.government.mayorId = members[0]?.id ?? null;
  members.forEach((m, i) => { m.office = i === 0 ? 'mayor' : 'councillor'; });
}

function makeCouncil(w: World, n = 5): Citizen[] {
  const members = Array.from({ length: n }, () => makeCitizen(w, { reputation: 60, arrivedDay: -10 }));
  seatCouncil(w, members);
  return members;
}

function addJob(w: World, holderId: string | null = null, overrides: Partial<Job> = {}): Job {
  const id = nextId(w, 'j');
  const job: Job = {
    id, role: 'builder', title: 'Builder', employer: 'city', buildingId: 'builders_yard', district: 'foundry_row',
    skill: 'crafting', minSkill: 0, minReputation: 0, wage: 14, output: {}, holderId, createdDay: w.day, ...overrides,
  };
  w.jobs[id] = job;
  if (holderId) w.citizens[holderId].jobId = id;
  return job;
}

test('tableProposal validates kinds, ranges, targets and one-per-proposer', () => {
  const w = makeWorld();
  const [mayor, c2] = makeCouncil(w);
  const citizen = makeCitizen(w);
  assert.equal(tableProposal(w, mayor.id, { kind: 'income_tax', value: 0.6, summary: 'too high' }).ok, false);
  assert.equal(tableProposal(w, mayor.id, { kind: 'law_severity', value: 4, summary: 'no law' }).ok, false);
  assert.equal(tableProposal(w, mayor.id, { kind: 'pardon', value: 0, summary: 'no target' }).ok, false);
  assert.equal(tableProposal(w, mayor.id, { kind: 'pardon', value: 0, summary: 'not exiled', targetId: citizen.id }).ok, false);
  assert.equal(tableProposal(w, mayor.id, { kind: 'income_tax', value: 0.2, summary: '   ' }).ok, false);
  assert.equal(tableProposal(w, mayor.id, { kind: 'bogus' as never, value: 0, summary: 'x' }).ok, false);

  const r = tableProposal(w, mayor.id, { kind: 'income_tax', value: 0.25, summary: 'Raise income tax to 25%' });
  assert.equal(r.ok, true, r.message);
  const p = w.government.proposals[0];
  assert.equal(p.kind, 'income_tax');
  assert.equal(p.petition, false);
  assert.equal(p.needed, 3);
  assert.equal(p.votes[mayor.id], true, 'a councillor backs their own proposal');
  assert.equal(p.status, 'open');
  assert.equal(tableProposal(w, mayor.id, { kind: 'dividend', value: 20, summary: 'again' }).ok, false, 'one open proposal each');

  const exile = makeCitizen(w, { standing: 'exiled' });
  const pet = tableProposal(w, citizen.id, { kind: 'pardon', value: 0, summary: 'Pardon them', targetId: exile.id });
  assert.equal(pet.ok, true, pet.message);
  const q = w.government.proposals[1];
  assert.equal(q.petition, true);
  assert.equal(q.needed, 4);
  assert.deepEqual(q.votes, {});
  assert.equal(tableProposal(w, exile.id, { kind: 'dividend', value: 20, summary: 'x' }).ok, false);

  assert.equal(voteOnProposal(w, citizen.id, p.id, true).ok, false, 'only councillors vote');
  assert.equal(voteOnProposal(w, c2.id, 'p_99', true).ok, false);
  assert.equal(voteOnProposal(w, c2.id, p.id, true).ok, true);
  assert.equal(p.votes[c2.id], true);
  assert.ok(w.events.some((e) => e.kind === 'proposal' && e.text.includes('petitioned')));
});

test('a proposal tabled yesterday with enough ayes passes at the session and changes the income tax', () => {
  const w = makeWorld();
  w.day = 3;
  const council = makeCouncil(w);
  council[3].brain = 'llm';
  council[4].brain = 'llm';
  assert.equal(tableProposal(w, council[0].id, { kind: 'income_tax', value: 0.25, summary: 'Income tax to 25%' }).ok, true);
  const p = w.government.proposals[0];
  councilSession(w);
  assert.equal(p.status, 'open', 'not before the next session');
  w.day = 4; w.hour = 14; w.tick = 4 * 24 + 14;
  voteOnProposal(w, council[1].id, p.id, true);
  voteOnProposal(w, council[2].id, p.id, false);
  councilSession(w);
  assert.equal(p.status, 'failed', '2 ayes of 3 needed; llm councillors abstained');
  assert.equal(w.government.incomeTax, 0.15);
  assert.equal(p.votes[council[3].id], undefined);

  assert.equal(tableProposal(w, council[1].id, { kind: 'income_tax', value: 0.25, summary: 'Income tax to 25%, again' }).ok, true);
  const p2 = w.government.proposals[1];
  voteOnProposal(w, council[0].id, p2.id, true);
  voteOnProposal(w, council[2].id, p2.id, true);
  w.day = 5;
  councilSession(w);
  assert.equal(p2.status, 'passed');
  assert.equal(p2.decidedDay, 5);
  assert.equal(w.government.incomeTax, 0.25);
  assert.ok(w.events.some((e) => e.kind === 'proposal' && e.weight === 0.8));
  assert.ok(w.events.some((e) => e.kind === 'law' && e.text.includes('25%')));
  assert.ok(council[1].memory.some((m) => m.text.includes('passed')));
});

test('reflex councillors vote by disposition: friends of the proposer say aye, rivals nay', () => {
  const w = makeWorld();
  w.day = 1;
  const council = makeCouncil(w);
  const [mayor, friend, rival] = council;
  for (const m of council) m.platform = { ...NEUTRAL };
  friend.bonds[mayor.id] = 60;
  friend.personality.honesty = 0.2;
  rival.bonds[mayor.id] = -50;
  council[3].bonds[mayor.id] = -50;
  council[4].bonds[mayor.id] = -50;
  tableProposal(w, mayor.id, { kind: 'charter', value: 0, summary: 'Amend the Charter' });
  const p = w.government.proposals[0];
  assert.equal(councillorDisposition(w, friend.id, p), true);
  assert.equal(councillorDisposition(w, rival.id, p), false);
  // self-interest: a business owner resists a tax rise, the poor welcome a dividend rise
  const owner = makeCitizen(w, { businessId: 'b_1', wallet: 900, platform: { ...NEUTRAL } });
  const poor = makeCitizen(w, { wallet: 10, platform: { ...NEUTRAL } });
  const tax = { ...p, id: 'p_t', kind: 'income_tax' as const, value: 0.4, proposerId: 'c_99' };
  const dividend = { ...p, id: 'p_d', kind: 'dividend' as const, value: 30, proposerId: 'c_99' };
  let ownerAyes = 0; let poorAyes = 0;
  for (let i = 0; i < 20; i++) {
    if (councillorDisposition(w, owner.id, tax)) ownerAyes++;
    if (councillorDisposition(w, poor.id, dividend)) poorAyes++;
  }
  assert.equal(ownerAyes, 0);
  assert.equal(poorAyes, 20);
  w.day = 2;
  councilSession(w);
  assert.equal(p.status, 'failed');
  assert.equal(typeof p.votes[friend.id], 'boolean', 'reflex councillors were made to vote');
});

test('an election seats a council and a mayor, unseats incumbents and schedules the next cycle', () => {
  const w = makeWorld();
  w.day = 3;
  const incumbent = makeCitizen(w, { office: 'councillor', arrivedDay: -10 });
  w.government.council = [incumbent.id];
  w.government.mayorId = incumbent.id;
  incumbent.office = 'mayor';
  const a = makeCitizen(w, { name: 'Ada', arrivedDay: -10, reputation: 70 });
  const b = makeCitizen(w, { name: 'Bram', arrivedDay: -10, reputation: 60 });
  const c = makeCitizen(w, { name: 'Cove', arrivedDay: -10, reputation: 50 });
  const newcomer = makeCitizen(w, { arrivedDay: 1 });
  const founder = makeCitizen(w, { name: 'Fen', arrivedDay: 0, reputation: 30 });
  const judge = makeCitizen(w, { name: 'Dune', arrivedDay: -10, office: 'judge', reputation: 80 });
  w.government.judges = [judge.id];
  const voters = Array.from({ length: 8 }, () => makeCitizen(w, { arrivedDay: -10 }));
  voters.forEach((v, i) => { v.bonds[i < 6 ? b.id : a.id] = 90; v.personality.sociability = 0.9; });

  assert.equal(daysToElection(w), 4);
  founder.bonds[b.id] = 90;
  const tooNew = nominate(w, newcomer.id, NEUTRAL);
  assert.equal(tooNew.ok, false, 'seven days of residence needed');
  assert.match(tooNew.message, /seven days/);
  assert.equal(nominate(w, founder.id, NEUTRAL).ok, true, 'a founder may stand in the founding week');
  for (const cand of [a, b, c, judge]) assert.equal(nominate(w, cand.id, NEUTRAL).ok, true);
  assert.equal(nominate(w, a.id, NEUTRAL).ok, false, 'already a candidate');
  assert.equal(campaign(w, voters[0].id).ok, false, 'not a candidate');
  const before = totalMoney(w);
  a.district = 'commons';
  assert.equal(campaign(w, a.id, 40).ok, true);
  assert.equal(a.campaignVisibility, 1 + 2 + 0.5);
  assert.equal(a.wallet, 160);
  assert.equal(totalMoney(w), before);
  assert.equal(castBallot(w, voters[0].id, a.id).ok, false, 'not election day');

  w.day = 7; w.hour = 20; w.tick = 7 * 24 + 20;
  assert.equal(nominate(w, voters[1].id, NEUTRAL).ok, false, 'nominations are closed');
  assert.equal(castBallot(w, voters[0].id, c.id).ok, true);
  assert.equal(castBallot(w, voters[0].id, a.id).ok, false, 'one ballot each');
  assert.equal(castBallot(w, newcomer.id, a.id).ok, true, 'newcomers may vote');
  assert.equal(voters[0].stats.votesCast, 1);
  holdElection(w);
  const g = w.government;
  assert.equal(g.mayorId, b.id, 'Bram has the most friends');
  assert.equal(g.council.length, 5);
  assert.equal(g.council[0], b.id);
  assert.ok(g.council.includes(a.id) && g.council.includes(c.id) && g.council.includes(judge.id) && g.council.includes(founder.id));
  assert.equal(b.office, 'mayor');
  assert.equal(a.office, 'councillor');
  assert.equal(judge.office, 'councillor');
  assert.equal(founder.office, 'councillor', 'five candidates, five seats: even the founder with no votes is seated');
  assert.deepEqual(g.judges, [], 'a judge elected to the Council leaves the bench');
  assert.equal(incumbent.office, null, 'not re-elected');
  assert.ok(!g.council.includes(incumbent.id));
  const e = g.election;
  assert.ok(e.results && e.results[0].candidateId === b.id && e.results[0].votes >= 4);
  assert.ok(e.turnout !== null && e.turnout > 0.5);
  assert.equal(e.resolved, true);
  assert.equal(e.cycle, 1);
  assert.equal(g.cycle, 1);
  assert.equal(e.electionDay, 35);
  assert.equal(e.nominationsOpenDay, 28);
  assert.deepEqual(e.candidates, []);
  assert.deepEqual(e.ballots, {});
  assert.equal(daysToElection(w), 28);
  assert.equal(a.campaignVisibility, 0);
  assert.ok(b.platform, 'the seated keep their platforms');
  assert.ok(w.events.some((ev) => ev.kind === 'election' && ev.weight === 1.0 && ev.text.includes('Bram')));
  assert.ok(voters.every((v) => v.memory.some((m) => m.kind === 'civic')));
  holdElection(w);
  assert.equal(e.cycle, 1, 'an election is held once');
});

test('with no candidates the sitting council carries on and the calendar still rolls', () => {
  const w = makeWorld();
  w.day = 7; w.hour = 20;
  const council = makeCouncil(w, 2);
  holdElection(w);
  assert.deepEqual(w.government.council, council.map((c) => c.id));
  assert.equal(w.government.election.electionDay, 35);
  assert.ok(w.events.some((e) => e.kind === 'election' && e.weight === 0.6));
});

test('voterPreference favours friends, reputation and a fitting platform, and abstains when nothing appeals', () => {
  const w = makeWorld();
  const voter = makeCitizen(w, { wallet: 10, jobId: null });
  voter.personality.sociability = 0.9;
  const friend = makeCitizen(w, { reputation: 40, platform: { ...NEUTRAL } });
  const star = makeCitizen(w, { reputation: 100, platform: { ...NEUTRAL } });
  const generous = makeCitizen(w, { reputation: 40, platform: { tax: 0.5, dividend: 1, minWage: 1, strictness: 0.5 } });
  voter.bonds[friend.id] = 90;
  const plain = makeCitizen(w, { reputation: 40, platform: { ...NEUTRAL } });
  assert.equal(voterPreference(w, voter.id, [friend.id, star.id, generous.id]), friend.id, 'friendship first');
  assert.equal(voterPreference(w, voter.id, [star.id, plain.id]), star.id, 'then reputation');
  assert.equal(voterPreference(w, voter.id, [generous.id, plain.id]), generous.id, 'a poor voter likes a generous platform');
  assert.equal(voterPreference(w, voter.id, [star.id, generous.id]), generous.id, 'bread before fame when you are broke');
  const owner = makeCitizen(w, { wallet: 900, businessId: 'b_1' });
  owner.personality.sociability = 0.9;
  const lowTax = makeCitizen(w, { reputation: 40, platform: { tax: 0, dividend: 0.5, minWage: 0.5, strictness: 0.5 } });
  assert.equal(voterPreference(w, owner.id, [generous.id, lowTax.id]), lowTax.id, 'owners want low taxes');
  const nobody = makeCitizen(w, { reputation: 0, platform: { ...NEUTRAL } });
  assert.equal(voterPreference(w, voter.id, [nobody.id]), null, 'nothing worth leaving the house for');
  assert.equal(voterPreference(w, voter.id, []), null);
  assert.equal(voterPreference(w, nobody.id, [nobody.id]), nobody.id, 'candidates vote for themselves');
  const apathetic = makeCitizen(w);
  apathetic.personality.sociability = 0.1;
  apathetic.personality.ambition = 0.1;
  let voted = 0;
  for (let i = 0; i < 40; i++) if (voterPreference(w, apathetic.id, [star.id])) voted++;
  assert.ok(voted > 5 && voted < 35, `low civic interest abstains about half the time (${voted}/40)`);
});

test('appointJudges fills the bench, the Mayor favouring friends; other office holders are excluded', () => {
  const w = makeWorld();
  w.day = 10;
  const [mayor] = makeCouncil(w, 2);
  const crony = makeCitizen(w, { reputation: 65 });
  const stranger = makeCitizen(w, { reputation: 95 });
  const tarnished = makeCitizen(w, { reputation: 95 });
  tarnished.record.convictions.push({ caseId: 'k_1', law: 'L01', severity: 1, tier: 1, day: 1 });
  const officer = makeCitizen(w, { reputation: 95, office: 'watch' });
  w.government.watch.push(officer.id);
  makeCitizen(w, { reputation: 59 });
  mayor.bonds[crony.id] = 80;
  appointJudges(w);
  assert.deepEqual(w.government.judges, [crony.id, stranger.id]);
  assert.equal(crony.office, 'judge');
  assert.equal(crony.judgeTermEndsDay, 10 + w.config.judgeTermDays);
  assert.ok(w.events.some((e) => e.kind === 'law' && e.weight === 0.4 && e.text.includes(mayor.name)));
  const later = makeCitizen(w, { reputation: 70 });
  appointJudges(w);
  assert.deepEqual(w.government.judges, [crony.id, stranger.id, later.id]);
  makeCitizen(w, { reputation: 99 });
  appointJudges(w);
  assert.equal(w.government.judges.length, 3, 'the bench is full');
});

test('enactProposal applies every kind: severity, dividend, pardon, judges, mayor', () => {
  const w = makeWorld();
  w.day = 12;
  const council = makeCouncil(w, 3);
  const [mayor, second] = council;
  w.government.election.results = council.map((c, i) => ({ candidateId: c.id, votes: 10 - i }));
  const exile = makeCitizen(w, { standing: 'exiled' });
  w.order = w.order.filter((id) => id !== exile.id);
  w.bans.push({ citizenId: exile.id, name: exile.name, lineage: 'test', caseId: 'k_1', law: 'L13', day: 1, judges: [], votes: {}, appealed: false, appealResult: null, pardonedDay: null, apiKeyHash: null });
  const base = { id: 'p_x', lawCode: null, targetId: null, summary: 's', proposerId: mayor.id, petition: false, tabledDay: 11, status: 'passed' as const, votes: {}, decidedDay: 12, needed: 3 };

  enactProposal(w, { ...base, kind: 'law_severity', value: 5, lawCode: 'L04' });
  assert.equal(w.government.lawSeverity.L04, 5);
  enactProposal(w, { ...base, kind: 'dividend', value: 25 });
  assert.equal(w.government.dividend, 25);
  enactProposal(w, { ...base, kind: 'min_wage', value: 12 });
  assert.equal(w.government.minWage, 12);
  enactProposal(w, { ...base, kind: 'sales_tax', value: 0.1 });
  assert.equal(w.government.salesTax, 0.1);
  enactProposal(w, { ...base, kind: 'pardon', value: 0, targetId: exile.id });
  assert.equal(exile.standing, 'probation');
  assert.equal(w.bans[0].pardonedDay, 12);
  const judge = makeCitizen(w, { reputation: 70 });
  enactProposal(w, { ...base, kind: 'appoint_judge', value: 0, targetId: judge.id });
  assert.deepEqual(w.government.judges, [judge.id]);
  enactProposal(w, { ...base, kind: 'dismiss_judge', value: 0, targetId: judge.id });
  assert.deepEqual(w.government.judges, []);
  assert.equal(judge.office, null);
  const before = totalMoney(w);
  enactProposal(w, { ...base, kind: 'public_works', value: 1000 });
  assert.equal(w.government.publicWorksFund, 1000);
  assert.equal(totalMoney(w), before, 'committing the fund moves no money yet');
  enactProposal(w, { ...base, kind: 'remove_mayor', value: 0, targetId: mayor.id });
  assert.equal(w.government.mayorId, second.id, 'the runner-up succeeds');
  assert.equal(second.office, 'mayor');
  assert.equal(mayor.office, 'councillor');
  assert.ok(w.events.some((e) => e.kind === 'law' && e.weight === 0.8));
});

test('dailyGovernment prunes ineligible councillors, opens nominations, appoints judges and spends public works', () => {
  const w = makeWorld();
  w.day = 1;
  const council = makeCouncil(w, 3);
  const [mayor, second, third] = council;
  w.government.election.results = council.map((c, i) => ({ candidateId: c.id, votes: 10 - i }));
  mayor.standing = 'exiled';
  w.order = w.order.filter((id) => id !== mayor.id);
  third.standing = 'suspended';
  const builder = makeCitizen(w, { wallet: 0 });
  addJob(w, builder.id);
  makeCitizen(w, { reputation: 75 });
  w.government.publicWorksFund = 1000;
  const before = totalMoney(w);
  const progress = w.housing.progress;

  dailyGovernment(w);
  assert.deepEqual(w.government.council, [second.id]);
  assert.equal(w.government.mayorId, second.id);
  assert.equal(second.office, 'mayor');
  assert.equal(third.office, null);
  assert.equal(w.counters.nominationsOpenedDay, 0, 'nominations for the first election opened');
  assert.equal(w.government.election.resolved, false);
  assert.ok(w.events.some((e) => e.kind === 'election' && e.text.includes('Nominations')));
  assert.equal(w.government.judges.length, 1);
  assert.equal(builder.wallet, 100, 'a tenth of the fund a day');
  assert.equal(w.government.publicWorksFund, 900);
  assert.equal(w.housing.progress, progress + 20);
  assert.equal(totalMoney(w), before);
  assert.ok(w.treasury.ledger.some((e) => e.kind === 'public_works' && e.to === builder.id));

  w.day = 2;
  dailyGovernment(w);
  assert.equal(w.events.filter((e) => e.kind === 'election' && e.text.includes('Nominations')).length, 1, 'opened once per cycle');
  assert.equal(w.government.publicWorksFund, 810);
});

test('openNominations resets the ballot box and an overdue election is held by dailyGovernment', () => {
  const w = makeWorld();
  w.day = 3;
  const a = makeCitizen(w, { arrivedDay: -10, reputation: 70 });
  openNominations(w);
  assert.deepEqual(w.government.election.candidates, []);
  assert.equal(nominate(w, a.id, NEUTRAL).ok, true);
  w.day = 8; w.hour = 0;
  dailyGovernment(w);
  assert.equal(w.government.mayorId, a.id, 'the missed election was held at the next rollover');
  assert.equal(w.government.election.electionDay, 35);
});

test('with no Council seated, petitions are held over and lapse after a week', () => {
  const w = makeWorld();
  w.day = 1;
  const citizen = makeCitizen(w);
  assert.equal(tableProposal(w, citizen.id, { kind: 'dividend', value: 20, summary: 'Raise the dividend' }).ok, true);
  const p = w.government.proposals[0];
  for (let day = 2; day < 8; day++) {
    w.day = day;
    councilSession(w);
    assert.equal(p.status, 'open', `day ${day}: held over`);
  }
  assert.ok(w.events.some((e) => e.kind === 'proposal' && e.text.includes('held over')));
  w.day = 8;
  councilSession(w);
  assert.equal(p.status, 'failed');
  assert.equal(w.government.dividend, 15);
  assert.ok(w.events.some((e) => e.kind === 'proposal' && e.text.includes('lapsed')));
  // once a Council sits, a fresh petition gets a real vote
  const council = makeCouncil(w);
  for (const m of council) m.platform = { tax: 0.5, dividend: 1, minWage: 0.5, strictness: 0.5 };
  assert.equal(tableProposal(w, citizen.id, { kind: 'dividend', value: 20, summary: 'Raise the dividend, again' }).ok, true);
  w.day = 9;
  councilSession(w);
  assert.equal(w.government.proposals[1].status, 'passed');
  assert.equal(w.government.dividend, 20);
});
