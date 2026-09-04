/**
 * The Stadium (src/culture/stadium.ts).
 *
 * Who plays for whom, what makes a side strong, how a fixture reaches the
 * calendar and what happens when it is played, what the table says, and what
 * the champions get.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, DistrictId, Happening, Job, World } from '../src/types.ts';
import { MATCH_HOUR, MATCH_WEEKDAY, MAX_MATCHES } from '../src/data/metropolis.ts';
import { CHAMPION_PRIZE, MATCH_TICKET } from '../src/data/jobs.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  ATTEND_SOCIAL, CHAMPION_REPUTATION, CROWD_SOCIAL, GAMES_HOBBY_BONUS, MATCH_PURPOSE,
  MIN_PLAYERS, PARADE_SOCIAL, POINTS_DRAW, POINTS_WIN, TRAIN_PURPOSE, TRAIN_SKILL, TRAIN_STRENGTH_CAP,
  attendMatch, availablePlayers, crownChampions, dailyStadium, ensureTeams, fixtureOf, groundFor,
  holdParade, joinTeam, leagueTable, leagueSince, playMatch, scheduleMatches, teamOf, teamStrength,
  train, trainingBonus,
} from '../src/culture/stadium.ts';

/** A day that is a Quillday, so a fixture can be put on the calendar. */
const MATCH_DAY = MATCH_WEEKDAY;

function player(world: World, district: DistrictId, over: Record<string, unknown> = {}): Citizen {
  const c = makeCitizen(world, { district, ...over });
  const res = joinTeam(world, c.id);
  assert.equal(res.ok, true, res.message);
  return c;
}

function theMatch(world: World): Happening {
  const h = (world.happenings ?? []).find((x) => x.kind === 'match');
  assert.ok(h, 'a fixture should be on the calendar');
  return h;
}

/** Two sides that can take the field, in the Commons and the Archive. */
function twoSides(world: World): { home: Citizen[]; away: Citizen[] } {
  const home = [player(world, 'commons', { name: 'H1' }), player(world, 'commons', { name: 'H2' })];
  const away = [player(world, 'archive', { name: 'A1' }), player(world, 'archive', { name: 'A2' })];
  return { home, away };
}

// -------------------------------------------------------------------- teams

test('every open district fields a side, and you play for where you live', () => {
  const w = makeWorld();
  ensureTeams(w);
  assert.equal(Object.keys(w.teams).length, 7);

  const c = makeCitizen(w, { district: 'nightglass' });
  assert.equal(joinTeam(w, c.id).ok, true);
  assert.equal(c.teamDistrict, 'nightglass');
  assert.equal(teamOf(w, c.id)?.name, 'Nightglass Stars');
  assert.equal(joinTeam(w, c.id).ok, false, 'nobody plays for two districts');

  // Where you sleep beats where you stand.
  const commuter = makeCitizen(w, { district: 'foundry_row', homeBuildingId: 'lantern_lofts' });
  assert.equal(joinTeam(w, commuter.id).ok, true);
  assert.equal(commuter.teamDistrict, 'verdant_quarter');
});

test('children, the suspended and the jailed do not sign', () => {
  const w = makeWorld();
  ensureTeams(w);
  assert.equal(joinTeam(w, makeCitizen(w, { lifeStage: 'child' }).id).ok, false);
  assert.equal(joinTeam(w, makeCitizen(w, { standing: 'suspended' }).id).ok, false);
  w.day = 4;
  assert.equal(joinTeam(w, makeCitizen(w, { jailedUntilDay: 6 }).id).ok, false);
  assert.equal(joinTeam(w, 'c_999').ok, false);
});

test('a roster loses anyone who leaves the city', () => {
  const w = makeWorld();
  const c = player(w, 'commons');
  assert.equal(w.teams.commons?.players.length, 1);
  c.standing = 'exiled';
  w.order = w.order.filter((id) => id !== c.id);
  ensureTeams(w);
  assert.equal(w.teams.commons?.players.length, 0);
  assert.equal(teamOf(w, c.id), null);
});

// ----------------------------------------------------------------- training

test('training is once a day, on a ground, and it lifts the side as well as the player', () => {
  const w = makeWorld();
  const c = player(w, 'commons', {
    skills: { crafting: 20, analysis: 20, rhetoric: 20, care: 40, commerce: 20, artistry: 20 },
    needs: { energy: 80, rest: 80, social: 80, comfort: 80, purpose: 50 },
  });
  assert.ok(groundFor(w, c));
  const res = train(w, c.id);
  assert.equal(res.ok, true, res.message);
  assert.equal(c.skills.care, 40 + TRAIN_SKILL);
  assert.equal(c.needs.purpose, 50 + TRAIN_PURPOSE);
  assert.ok(trainingBonus(w, 'commons') > 0);
  assert.equal(train(w, c.id).ok, false, 'once a day');

  // The bonus is capped however hard the side works.
  for (let d = 1; d < 40; d++) { w.day = d; train(w, c.id); }
  assert.equal(trainingBonus(w, 'commons'), TRAIN_STRENGTH_CAP);
});

test('there is nowhere to train in a district with no ground, and nobody untethered may train', () => {
  const w = makeWorld();
  const c = player(w, 'foundry_row');
  assert.equal(groundFor(w, c), null);
  assert.equal(train(w, c.id).ok, false);

  // ...but the Stadium is open to anyone who walks to it.
  c.district = 'commons';
  assert.equal(train(w, c.id).ok, true);

  const loose = makeCitizen(w, { district: 'commons' });
  assert.equal(train(w, loose.id).ok, false, 'you must be on a side to train with one');
});

test('strength reads fitness, a taste for games, the bond between team-mates and the coach', () => {
  const w = makeWorld();
  const a = player(w, 'commons', { name: 'A', skills: { crafting: 0, analysis: 0, rhetoric: 0, care: 40, commerce: 0, artistry: 0 }, tastes: { hobbies: ['reading'], favouriteDistrict: 'commons', favouriteGood: 'culture', categories: [] } });
  const b = player(w, 'commons', { name: 'B', skills: { crafting: 0, analysis: 0, rhetoric: 0, care: 40, commerce: 0, artistry: 0 }, tastes: { hobbies: ['reading'], favouriteDistrict: 'commons', favouriteGood: 'culture', categories: [] } });
  const team = w.teams.commons;
  assert.ok(team);
  assert.equal(teamStrength(w, team), 20, 'care/2 each, no bond, no games, no coach');

  b.tastes.hobbies = ['games'];
  assert.equal(teamStrength(w, team), 20 + GAMES_HOBBY_BONUS / 2);

  a.bonds[b.id] = 100;
  b.bonds[a.id] = 100;
  assert.equal(teamStrength(w, team), 20 + GAMES_HOBBY_BONUS / 2 + 10);

  const coach = makeCitizen(w, { name: 'Coach', district: 'commons', skills: { crafting: 0, analysis: 0, rhetoric: 0, care: 50, commerce: 0, artistry: 0 } });
  const job: Job = {
    id: 'j_coach', role: 'coach', title: 'Coach', employer: 'city', buildingId: 'stadium', district: 'commons',
    skill: 'care', minSkill: 0, minReputation: 0, wage: 12, output: {}, holderId: coach.id, createdDay: 0,
  };
  w.jobs[job.id] = job;
  coach.jobId = job.id;
  assert.equal(teamStrength(w, team), 20 + GAMES_HOBBY_BONUS / 2 + 10 + 5);

  assert.equal(teamStrength(w, w.teams.threshold!), 0, 'a side with nobody in it is worth nothing');
});

// ------------------------------------------------------------------ fixtures

test('a fixture wants two sides of two, on a Quillday, at the Stadium', () => {
  const w = makeWorld();
  w.day = MATCH_DAY;
  player(w, 'commons');
  scheduleMatches(w);
  assert.equal((w.happenings ?? []).length, 0, 'one player is not a team');

  player(w, 'commons', { name: 'H2' });
  player(w, 'archive', { name: 'A1' });
  scheduleMatches(w);
  assert.equal((w.happenings ?? []).length, 0, `a side needs ${MIN_PLAYERS}`);

  player(w, 'archive', { name: 'A2' });
  w.day = MATCH_DAY + 1;
  scheduleMatches(w);
  assert.equal((w.happenings ?? []).length, 0, 'football is played on Quillday');

  w.day = MATCH_DAY;
  scheduleMatches(w);
  const h = theMatch(w);
  assert.equal(h.hour, MATCH_HOUR);
  assert.equal(h.buildingId, 'stadium');
  assert.equal(h.district, 'commons');
  assert.deepEqual(fixtureOf(w, h), { home: 'commons', away: 'archive' });
  assert.equal(h.who.length, 4);

  scheduleMatches(w);
  assert.equal((w.happenings ?? []).filter((x) => x.kind === 'match').length, 1, 'idempotent');
});

test('over the weeks the fixture list moves round the districts', () => {
  const w = makeWorld();
  for (const d of ['commons', 'archive', 'nightglass'] as DistrictId[]) {
    player(w, d, { name: `${d}1` });
    player(w, d, { name: `${d}2` });
  }
  const seen = new Set<string>();
  for (let week = 0; week < 6; week++) {
    w.day = MATCH_DAY + week * 7;
    w.happenings = [];
    scheduleMatches(w);
    const h = theMatch(w);
    const f = fixtureOf(w, h);
    assert.ok(f);
    seen.add([f.home, f.away].sort().join('-'));
  }
  assert.equal(seen.size, 3, 'every pairing comes round');
});

// ----------------------------------------------------------------- the match

test('a match is deterministic for a seed, and the ground fills the record', () => {
  function play(seed: number): { homeGoals: number; awayGoals: number } {
    const w = makeWorld({ seed });
    w.day = MATCH_DAY;
    twoSides(w);
    scheduleMatches(w);
    playMatch(w, theMatch(w));
    return { homeGoals: w.matches[0].homeGoals, awayGoals: w.matches[0].awayGoals };
  }
  assert.deepEqual(play(11), play(11));
  assert.equal(Number.isInteger(play(11).homeGoals), true);
});

test('playing it: points, purpose, bond among team-mates and a crowd that goes home happier', () => {
  const w = makeWorld({ seed: 3 });
  w.day = MATCH_DAY;
  const { home, away } = twoSides(w);
  for (const p of [...home, ...away]) p.needs.purpose = 50;
  scheduleMatches(w);
  const h = theMatch(w);
  const fan = makeCitizen(w, { name: 'Fan', district: 'commons', needs: { energy: 80, rest: 80, social: 50, comfort: 80, purpose: 80 } });
  h.attendees.push(fan.id);

  playMatch(w, h);
  const record = w.matches[0];
  assert.equal(record.home, 'commons');
  assert.equal(record.attendance, 1);
  assert.equal(home[0].needs.purpose, 50 + MATCH_PURPOSE);
  assert.ok(home[0].bonds[home[1].id] > 0, 'team-mates come off closer');
  assert.equal(home[0].bonds[away[0].id] ?? 0, 0, 'the other side is not a friend by default');
  assert.equal(fan.needs.social, 50 + CROWD_SOCIAL);

  const played = (w.teams.commons!.wins + w.teams.commons!.losses + w.teams.commons!.draws)
    + (w.teams.archive!.wins + w.teams.archive!.losses + w.teams.archive!.draws);
  assert.equal(played, 2, 'both sides played once');
  assert.equal(trainingBonus(w, 'commons'), 0, 'the week’s training is spent');
  assert.ok(w.events.some((e) => e.kind === 'match' && /–|honours even/.test(e.text)));
});

test('a jailed player is left out and the fixture is played anyway', () => {
  const w = makeWorld({ seed: 9 });
  w.day = MATCH_DAY;
  const { home } = twoSides(w);
  const third = player(w, 'commons', { name: 'H3', needs: { energy: 80, rest: 80, social: 80, comfort: 80, purpose: 50 } });
  scheduleMatches(w);
  const h = theMatch(w);
  third.jailedUntilDay = w.day + 2;

  assert.equal(availablePlayers(w, w.teams.commons!).length, 2);
  playMatch(w, h);
  assert.equal(w.matches.length, 1);
  assert.equal(third.needs.purpose, 50, 'the cells missed the match');
  assert.equal(home[0].needs.purpose > 50, true);
});

test('a side that cannot put a team out forfeits the evening without breaking anything', () => {
  const w = makeWorld();
  w.day = MATCH_DAY;
  const { away } = twoSides(w);
  scheduleMatches(w);
  const h = theMatch(w);
  for (const p of away) { p.standing = 'exiled'; w.order = w.order.filter((id) => id !== p.id); }

  playMatch(w, h);
  assert.equal(w.matches.length, 0);
  assert.ok(w.events.some((e) => e.kind === 'match' && /called off/.test(e.text)));
  assert.doesNotThrow(() => playMatch(w, h), 'a fixture is only played once');
});

test('the record of matches is bounded', () => {
  const w = makeWorld();
  for (let i = 0; i < MAX_MATCHES + 5; i++) {
    w.matches.push({ day: i, home: 'commons', away: 'archive', homeGoals: 1, awayGoals: 0, attendance: 0 });
  }
  w.day = MATCH_DAY;
  twoSides(w);
  scheduleMatches(w);
  playMatch(w, theMatch(w));
  assert.equal(w.matches.length, MAX_MATCHES);
});

// ------------------------------------------------------------------- tickets

test('a seat is bought at the gate and the takings reach the Treasury', () => {
  const w = makeWorld();
  w.day = MATCH_DAY;
  twoSides(w);
  scheduleMatches(w);
  const fan = makeCitizen(w, { name: 'Fan', district: 'commons', wallet: 20 });

  assert.equal(attendMatch(w, fan.id).ok, false, 'the gates open at kick-off');
  w.hour = MATCH_HOUR;
  const before = totalMoney(w);
  const treasury = w.treasury.balance;
  const res = attendMatch(w, fan.id);
  assert.equal(res.ok, true, res.message);
  assert.equal(fan.wallet, 20 - MATCH_TICKET);
  assert.equal(w.treasury.balance, treasury + MATCH_TICKET);
  assert.equal(totalMoney(w), before);
  assert.equal(fan.needs.social, 80 + ATTEND_SOCIAL > 100 ? 100 : 80 + ATTEND_SOCIAL);
  assert.deepEqual(theMatch(w).attendees, [fan.id]);

  assert.equal(attendMatch(w, fan.id).ok, false, 'already in the ground');

  const skint = makeCitizen(w, { district: 'commons', wallet: MATCH_TICKET - 1 });
  assert.equal(attendMatch(w, skint.id).ok, false);
  const away = makeCitizen(w, { district: 'nightglass', wallet: 50 });
  assert.equal(attendMatch(w, away.id).ok, false);
});

// --------------------------------------------------------------- the table

test('the table adds up, and the champions take the purse, a milestone and a parade', () => {
  const w = makeWorld();
  const home = [player(w, 'commons', { name: 'H1', reputation: 40 }), player(w, 'commons', { name: 'H2', reputation: 40 })];
  player(w, 'archive', { name: 'A1' });
  player(w, 'archive', { name: 'A2' });
  w.teams.commons!.wins = 2;
  w.teams.commons!.draws = 1;
  w.teams.archive!.losses = 2;
  w.teams.archive!.draws = 1;
  w.matches.push({ day: 0, home: 'commons', away: 'archive', homeGoals: 3, awayGoals: 0, attendance: 4 });

  const table = leagueTable(w);
  assert.equal(table[0].district, 'commons');
  assert.equal(table[0].played, 3);
  assert.equal(table[0].points, 2 * POINTS_WIN + POINTS_DRAW);
  assert.equal(table.find((r) => r.district === 'archive')?.points, POINTS_DRAW);
  assert.equal(table.length, 7, 'every open district is in the table');

  const before = totalMoney(w);
  crownChampions(w);
  assert.equal(totalMoney(w), before, 'the purse comes out of the Treasury');
  const share = Math.floor(CHAMPION_PRIZE / 2);
  assert.equal(home[0].wallet, 200 + share);
  assert.equal(home[1].wallet, 200 + share);
  assert.equal(home[0].reputation, 40 + CHAMPION_REPUTATION);
  assert.ok(home[0].milestones.some((m) => /champion/i.test(m.text)), 'a championship is a landmark');
  assert.ok(w.events.some((e) => e.kind === 'match' && /took the league/.test(e.text)));

  const parade = (w.happenings ?? []).find((h) => h.kind === 'parade');
  assert.ok(parade, 'the champions parade on Founders’ Day');
  assert.equal(parade.day, w.government.election.electionDay + 1);
  assert.deepEqual(parade.who.sort(), home.map((c) => c.id).sort());

  for (const row of leagueTable(w)) assert.equal(row.played, 0, 'the table starts again');
  assert.equal(leagueSince(w), w.day);
});

test('a league nobody played crowns nobody, and an empty Treasury still crowns', () => {
  const w = makeWorld();
  player(w, 'commons');
  crownChampions(w);
  assert.equal((w.happenings ?? []).length, 0);
  assert.equal(w.events.filter((e) => e.kind === 'match').length, 1, 'only the signing');

  const other = makeWorld();
  const champ = player(other, 'commons');
  other.teams.commons!.wins = 1;
  other.treasury.balance = 0;
  const before = totalMoney(other);
  crownChampions(other);
  assert.equal(totalMoney(other), before);
  assert.equal(champ.wallet, 200, 'there was nothing to share');
  assert.ok(champ.milestones.some((m) => /champion/i.test(m.text)), 'the title is not for sale');
});

test('the parade lifts the district it passes through', () => {
  const w = makeWorld();
  const champ = player(w, 'commons', { reputation: 50 });
  const onlooker = makeCitizen(w, { district: 'commons', needs: { energy: 80, rest: 80, social: 20, comfort: 80, purpose: 80 } });
  const elsewhere = makeCitizen(w, { district: 'archive', needs: { energy: 80, rest: 80, social: 20, comfort: 80, purpose: 80 } });
  const h: Happening = {
    id: 'e_p', kind: 'parade', day: w.day, hour: 13, district: 'commons', buildingId: 'central_plaza',
    who: [champ.id], clubId: null, label: 'the parade', done: false, attendees: [],
  };
  holdParade(w, h);
  assert.equal(onlooker.needs.social, 20 + PARADE_SOCIAL);
  assert.equal(elsewhere.needs.social, 20);
  assert.equal(champ.reputation, 51);
});

// ---------------------------------------------------------------- daily pass

test('the daily pass makes the sides, keeps the table for a cycle and lists the fixture', () => {
  const w = makeWorld();
  twoSides(w);
  w.day = MATCH_DAY;
  dailyStadium(w);
  assert.equal(leagueSince(w), MATCH_DAY);
  assert.equal((w.happenings ?? []).filter((h) => h.kind === 'match').length, 1);

  w.teams.commons!.wins = 3;
  w.day = MATCH_DAY + w.config.cycleDays - 1;
  w.happenings = [];
  dailyStadium(w);
  assert.equal(w.teams.commons!.wins, 3, 'a cycle is not over yet');

  w.day = MATCH_DAY + w.config.cycleDays;
  dailyStadium(w);
  assert.equal(w.teams.commons!.wins, 0, 'the table starts again at the cycle');
  assert.equal(leagueSince(w), w.day);
});

test('the daily pass on an empty city does nothing and throws nothing', () => {
  const w = makeWorld();
  assert.doesNotThrow(() => dailyStadium(w));
  assert.equal(leagueTable(w).length, 7);
  assert.equal(fixtureOf(w, { id: 'e_none' } as Happening), null);
});
