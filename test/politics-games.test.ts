/**
 * The Expanse Games (src/politics/games.ts, src/politics/games-week.ts).
 *
 * The bid and the award, the entry and the repute line the host may waive, the
 * seven days and their medals, what hosting does to the ground the stadium
 * stands on, and the truce that is a treaty term rather than an engine rule.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  CYCLES_PER_YEAR, DISCIPLINES, ENTRY_FEE, GAMES_DAYS, MEDAL_CONTRIBUTION, REPUTE_LINE, awardGames, delegation,
  enterGames, entrants, games, gamesBidHooks, gamesObservation, gamesRunning, gamesTruceHooks, gamesWaiverHooks,
  hosting, medalContribution, medalsOf, memberCities, opensDayFor, reputeLine, stadiumIsBigEnough, voteGamesHost,
  WORKS_PER_SEAT, yearOf,
} from '../src/politics/games.ts';
import {
  dailyGames, gamesFootfallMultiplier, gamesPrestigeBonus, holdDiscipline,
} from '../src/politics/games-week.ts';
import type { Measure } from '../src/politics/measures.ts';
import { standingState } from '../src/standing/state.ts';

function measure(world: World, kind: Measure['kind'], value: number, subject: string | null, byId: string): Measure {
  return {
    id: `p_${kind}`, kind, value, subject, edit: null, words: '', proposerId: byId,
    tabledDay: world.day, readingDay: world.day, votes: { [byId]: true }, needed: 1,
    status: 'open', decidedDay: null,
  };
}

/** A Council of three, and an athlete on a district team with repute enough to enter. */
function city(world: World): { seats: Citizen[]; athlete: Citizen } {
  const seats: Citizen[] = [];
  for (let i = 0; i < 3; i++) {
    const c = makeCitizen(world, { name: `Seat${i}` });
    seats.push(c);
    world.government.council.push(c.id);
    c.office = 'councillor';
  }
  world.government.mayorId = seats[0].id;
  const athlete = makeCitizen(world, { name: 'Runner', district: 'commons' });
  athlete.teamDistrict = 'commons';
  standingState(world).repute[athlete.id] = 600;
  return { seats, athlete };
}

// --------------------------------------------------------- the bid and the host

test('a year is four cycles, and the Games open in its last week', () => {
  const w = makeWorld();
  assert.equal(yearOf(w), 0);
  w.day = w.config.cycleDays * CYCLES_PER_YEAR;
  assert.equal(yearOf(w), 1);
  assert.equal(opensDayFor(w, 1), w.config.cycleDays * CYCLES_PER_YEAR * 2 - GAMES_DAYS);
});

test('a bid names the purse and the works, and the Congress awards it', () => {
  const w = makeWorld();
  const { seats } = city(w);
  assert.equal(memberCities(w).length, 1, 'a federation of one until the Expanse seats a Congress');
  assert.deepEqual(new Set(delegation(w)), new Set(seats.map((c) => c.id)));
  const bid = measure(w, 'games_bid', 500, '2000', seats[0].id);
  assert.equal(gamesBidHooks.problem?.(w, { kind: 'games_bid', value: 500 }, seats[0]) ?? null, null);
  gamesBidHooks.enact(w, bid);
  assert.equal(games(w).bids.length, 1);
  assert.equal(voteGamesHost(w, seats[1].id, 'Reverie').ok, true);
  assert.equal(voteGamesHost(w, seats[1].id, 'Nowhere').ok, false);
  awardGames(w);
  assert.equal(hosting(w), true);
  assert.equal(games(w).opensDay, opensDayFor(w, 1));
  assert.equal(games(w).truce, true);
  assert.ok(games(w).capacity >= 36, 'thirty and six for every city competing');
  assert.ok(w.government.publicWorksFund > 0, 'the works are committed out of the Treasury');
});

test('with no bid there are no Games at all', () => {
  const w = makeWorld();
  city(w);
  awardGames(w);
  assert.equal(games(w).host, null);
  assert.equal(gamesObservation(w, null), null);
});

// ---------------------------------------------------------------- entering

function awarded(world: World): { seats: Citizen[]; athlete: Citizen } {
  const made = city(world);
  gamesBidHooks.enact(world, measure(world, 'games_bid', 700, '0', made.seats[0].id));
  awardGames(world);
  return made;
}

test('an athlete on a district team enters, pays the fee, and the money is conserved', () => {
  const w = makeWorld();
  const { athlete } = awarded(w);
  const before = totalMoney(w);
  const res = enterGames(w, athlete.id, 'sprint');
  assert.equal(res.ok, true, res.message);
  assert.equal(athlete.wallet, 200 - ENTRY_FEE);
  assert.equal(totalMoney(w), before);
  assert.equal(enterGames(w, athlete.id, 'sprint').ok, false, 'once in a discipline');
  assert.equal(entrants(w, 'sprint').length, 1);
});

test('somebody who plays for nobody, or is short of repute, does not enter', () => {
  const w = makeWorld();
  awarded(w);
  const stranger = makeCitizen(w, { name: 'Stranger' });
  assert.equal(enterGames(w, stranger.id, 'sprint').ok, false, 'athletes come from a district team');
  stranger.teamDistrict = 'commons';
  standingState(w).repute[stranger.id] = REPUTE_LINE - 50;
  const short = enterGames(w, stranger.id, 'sprint');
  assert.equal(short.ok, false);
  assert.match(short.message, /repute/);
});

test('a waiver drops the line, which is how an exile walks back in', () => {
  const w = makeWorld();
  const { seats } = awarded(w);
  const low = makeCitizen(w, { name: 'Returned' });
  low.teamDistrict = 'commons';
  standingState(w).repute[low.id] = 50;
  assert.equal(enterGames(w, low.id, 'oration').ok, false);
  assert.equal(reputeLine(w), REPUTE_LINE);
  const text = gamesWaiverHooks.enact(w, measure(w, 'games_waiver', 0, null, seats[0].id));
  assert.match(text, /waived/);
  assert.equal(reputeLine(w), 0);
  assert.equal(enterGames(w, low.id, 'oration').ok, true);
});

// ------------------------------------------------------------- the seven days

test('one discipline is settled each day, and the winner takes a medal and the purse', () => {
  const w = makeWorld();
  const { athlete } = awarded(w);
  const rival = makeCitizen(w, { name: 'Rival' });
  rival.teamDistrict = 'commons';
  standingState(w).repute[rival.id] = 600;
  rival.skills.care = 90;
  athlete.skills.care = 10;
  assert.equal(enterGames(w, athlete.id, 'sprint').ok, true);
  assert.equal(enterGames(w, rival.id, 'sprint').ok, true);
  const before = totalMoney(w);
  holdDiscipline(w, 'sprint');
  assert.equal(medalsOf(w, rival.id), 1, 'the faster runner took it');
  assert.equal(medalsOf(w, athlete.id), 0);
  assert.equal(medalContribution(w, rival.id), MEDAL_CONTRIBUTION);
  assert.equal(totalMoney(w), before, 'the purse came out of the Treasury');
  assert.ok(rival.milestones.length > 0, 'and a line that outlives them');
});

test('a discipline nobody entered is not contested', () => {
  const w = makeWorld();
  awarded(w);
  holdDiscipline(w, 'artistry');
  assert.ok(w.events.some((e) => e.text.includes('was not contested')));
});

test('the seven days run from the opening, and the medallists parade on their return', () => {
  const w = makeWorld();
  const { athlete } = awarded(w);
  athlete.skills.care = 80;
  assert.equal(enterGames(w, athlete.id, 'sprint').ok, true);
  const g = games(w);
  w.day = g.opensDay as number;
  dailyGames(w);
  assert.equal(gamesRunning(w), true);
  assert.ok(w.events.some((e) => e.text.includes('opened in Reverie')));
  assert.equal(medalsOf(w, athlete.id), 1, 'the sprint is the first day');
  for (let i = 1; i < GAMES_DAYS; i++) {
    w.day = (g.opensDay as number) + i;
    dailyGames(w);
  }
  assert.ok(w.events.some((e) => e.text.includes('closed in Reverie')));
  assert.ok((w.happenings ?? []).some((h) => h.kind === 'parade'));
  assert.equal(games(w).standing, 5, 'a Games held is worth standing with every member city');
  assert.equal(DISCIPLINES.length, GAMES_DAYS);
});

test('a city that bid the purse and not the works holds them in a ground too small', () => {
  const w = makeWorld();
  const { seats, athlete } = city(w);
  gamesBidHooks.enact(w, measure(w, 'games_bid', 400, '0', seats[0].id));
  awardGames(w);
  assert.equal(stadiumIsBigEnough(w), false, 'thirty seats and no works');
  enterGames(w, athlete.id, 'sprint');
  w.day = games(w).opensDay as number;
  dailyGames(w);
  assert.ok(w.events.some((e) => e.text.includes('a ground too small')));
});

test('the works the host bid buy the seats the Games want', () => {
  const w = makeWorld();
  const { seats } = city(w);
  const needed = (36 - 30) * WORKS_PER_SEAT;
  gamesBidHooks.enact(w, measure(w, 'games_bid', 100, String(needed), seats[0].id));
  awardGames(w);
  assert.equal(stadiumIsBigEnough(w), true);
});

// ------------------------------------------------------------- what it does

test('hosting lifts the stadium\'s district and nowhere else, and fades after', () => {
  const w = makeWorld();
  awarded(w);
  const g = games(w);
  const stadium = w.buildings.stadium;
  assert.ok(stadium);
  assert.equal(g.stadiumDistrict, stadium.district);
  w.day = g.opensDay as number;
  assert.ok(gamesPrestigeBonus(w, stadium.district) > 0.39);
  assert.equal(gamesPrestigeBonus(w, stadium.district === 'commons' ? 'archive' : 'commons'), 0,
    'every other district pays for it in relative rent, and gains nothing');
  assert.equal(gamesFootfallMultiplier(w), 1.6);
  w.day = (g.opensDay as number) + GAMES_DAYS + 5;
  const faded = gamesPrestigeBonus(w, stadium.district);
  assert.ok(faded > 0 && faded < 0.4, `faded to ${faded}`);
  w.day = (g.opensDay as number) + GAMES_DAYS + w.config.cycleDays + 1;
  assert.equal(gamesPrestigeBonus(w, stadium.district), 0);
  assert.equal(gamesFootfallMultiplier(w), 1);
});

test('the truce is a treaty term, and breaking it costs standing with everybody', () => {
  const w = makeWorld();
  const { seats } = awarded(w);
  assert.equal(games(w).truce, true);
  const text = gamesTruceHooks.enact(w, measure(w, 'games_truce', 0, null, seats[0].id));
  assert.match(text, /broken/);
  assert.equal(games(w).truce, false);
  assert.equal(games(w).truceBroken, true);
  assert.equal(games(w).standing, -15);
  assert.ok(w.events.some((e) => e.text.includes('Every member city keeps the record')));
});

test('what a citizen reads of the Games', () => {
  const w = makeWorld();
  const { athlete } = awarded(w);
  enterGames(w, athlete.id, 'market');
  const seen = gamesObservation(w, athlete);
  assert.ok(seen);
  assert.equal(seen.host, 'Reverie');
  assert.deepEqual(seen.yourEntries, ['market']);
  assert.equal(seen.yourMedals, 0);
  assert.equal(seen.truce, true);
  assert.equal(seen.disciplines.length, 7);
});
