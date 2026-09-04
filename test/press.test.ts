/**
 * The press (src/culture/press.ts).
 *
 * Two papers over one day's events: what each of them leads with, the words
 * each of them uses, and what reading one does to a reader's opinion of the
 * people running the city.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, Job, PaperId, World, WorldEvent } from '../src/types.ts';
import { PAPERS } from '../src/types.ts';
import { PAPER_INFO } from '../src/data/metropolis.ts';
import { emit } from '../src/sim/events.ts';
import { HEADLINES_PER_EDITION, printMorningEdition } from '../src/sim/chronicle.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import {
  APPROVAL_PAPER_SHIFT, LIFT, PLAY_DOWN, READING_SOCIAL,
  frontPage, frontPages, paperOf, paperOfJob, paperReading, printLedgerEdition, readPaper,
  readershipShare, rewrite, slant,
} from '../src/culture/press.ts';

const REPORT = 'Treasury: 91,204 ℓ (+1,203 revenue, −2,980 spend)';

function desk(world: World, c: Citizen, buildingId: string): Job {
  const job: Job = {
    id: `j_${Object.keys(world.jobs).length + 1}`, role: 'journalist', title: 'Journalist', employer: 'city',
    buildingId, district: world.buildings[buildingId].district, skill: 'rhetoric', minSkill: 0,
    minReputation: 0, wage: 13, output: {}, holderId: c.id, createdDay: world.day,
  };
  world.jobs[job.id] = job;
  c.jobId = job.id;
  return job;
}

/** Yesterday's news, ready for this morning's editions. */
function yesterday(world: World): void {
  world.day = 0;
  emit(world, 'verdict', 'The bench found Bram Corvane guilty of petty theft.', [], 0.6);
  emit(world, 'treasury', 'The Treasury raised the minimum wage to 15 ℓ.', [], 0.5);
  emit(world, 'social', 'Ondine and Ivo ate at the Halflight Tavern.', [], 0.4);
  world.day = 1;
}

// --------------------------------------------------------------------- desks

test('a journalist files to the desk they sit at', () => {
  const w = makeWorld();
  const chron = makeCitizen(w, { district: 'archive' });
  const ledg = makeCitizen(w, { district: 'harbor_market' });
  assert.equal(paperOfJob(w, chron), 'chronicle', 'no desk is the paper of record');
  desk(w, chron, 'chronicle');
  desk(w, ledg, PAPER_INFO.ledger.buildingId);
  assert.equal(paperOfJob(w, chron), 'chronicle');
  assert.equal(paperOfJob(w, ledg), 'ledger');
});

// --------------------------------------------------------------------- slant

test('the Ledger lifts money, plays down a proprietor in the dock, and shrugs at a wedding', () => {
  const w = makeWorld();
  const owner = makeCitizen(w, { name: 'Owner' });
  w.businesses.b_1 = {
    id: 'b_1', name: 'The Quay Café', kind: 'cafe', ownerId: owner.id, treasury: 100, district: 'harbor_market',
    buildingId: 'shopfronts_harbor', employees: [], jobs: [], inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: 10, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  owner.businessId = 'b_1';

  const trade: WorldEvent = { tick: 0, day: 0, kind: 'trade', text: 'x', actors: [], weight: 0.5 };
  const wedding: WorldEvent = { tick: 0, day: 0, kind: 'wedding', text: 'x', actors: [], weight: 0.5 };
  const dock: WorldEvent = { tick: 0, day: 0, kind: 'verdict', text: 'x', actors: [owner.id], weight: 0.5 };
  const stranger: WorldEvent = { tick: 0, day: 0, kind: 'verdict', text: 'x', actors: [], weight: 0.5 };

  assert.equal(slant(w, 'ledger', trade), LIFT);
  assert.equal(slant(w, 'ledger', wedding), PLAY_DOWN);
  assert.equal(slant(w, 'ledger', dock), PLAY_DOWN);
  assert.equal(slant(w, 'ledger', stranger), 1);
  assert.ok(slant(w, 'chronicle', wedding) > slant(w, 'chronicle', trade));
});

// ------------------------------------------------------------------- rewrite

test('the Ledger changes the words and never the facts', () => {
  const w = makeWorld();
  const ev: WorldEvent = {
    tick: 0, day: 0, kind: 'law', actors: [], weight: 0.5,
    text: 'The Council raised the minimum wage to 15 ℓ and Mayor Ondine Ashgrove signed it.',
  };
  const plain = rewrite(w, 'chronicle', ev);
  const ledger = rewrite(w, 'ledger', ev);
  assert.equal(plain, ev.text, 'the paper of record prints what was said');
  assert.notEqual(ledger, ev.text);
  assert.match(ledger, /wage floor/);
  assert.match(ledger, /City Hall/);
  assert.match(ledger, /Ondine Ashgrove/, 'the name is a fact; the title is a courtesy');
  assert.doesNotMatch(ledger, /Mayor/);

  const numbersIn = (s: string): string[] => s.match(/\d+/g) ?? [];
  for (const n of numbersIn(ledger)) assert.ok(numbersIn(ev.text).includes(n), `the Ledger invented ${n}`);
  assert.equal(rewrite(w, 'ledger', { ...ev, text: '' }), '');
});

// ------------------------------------------------------------------ editions

test('both papers print each morning, and they do not lead with the same story', () => {
  const w = makeWorld();
  assert.equal(frontPage(w, 'ledger'), null);
  yesterday(w);

  const chronicle = printMorningEdition(w, REPORT);
  const ledger = printLedgerEdition(w, REPORT);

  assert.equal(paperOf(chronicle), 'chronicle');
  assert.equal(paperOf(ledger), 'ledger');
  assert.equal(ledger.day, w.day);
  assert.equal(ledger.treasuryReport, REPORT);
  assert.ok(ledger.headlines.length > 0 && ledger.headlines.length <= HEADLINES_PER_EDITION);
  assert.match(chronicle.headlines[0], /guilty/, 'the Chronicle leads with the court');
  assert.match(ledger.headlines[0], /public purse|wage floor/, 'the Ledger leads with the money');
  assert.notEqual(chronicle.headlines[0], ledger.headlines[0]);

  assert.equal(frontPage(w, 'ledger')?.headlines[0], ledger.headlines[0]);
  assert.equal(frontPage(w, 'chronicle')?.headlines[0], chronicle.headlines[0]);
  assert.deepEqual(frontPages(w).map((p) => p.paper), [...PAPERS]);
  assert.ok(w.events.some((e) => e.kind === 'story' && e.text.includes('The Harbor Ledger')));
});

test('printing twice in a morning replaces the page rather than adding one', () => {
  const w = makeWorld();
  yesterday(w);
  printLedgerEdition(w, REPORT);
  printLedgerEdition(w, 'a different report');
  const ledgerEditions = w.chronicle.filter((e) => paperOf(e) === 'ledger');
  assert.equal(ledgerEditions.length, 1);
  assert.equal(ledgerEditions[0].treasuryReport, 'a different report');
});

test('a day with nothing in it still gets a front page', () => {
  const w = makeWorld();
  w.day = 1;
  const ledger = printLedgerEdition(w, REPORT);
  assert.equal(ledger.headlines.length, 1);
  assert.match(ledger.headlines[0], /Quiet on the quay/);
});

test('a paper never runs its own front-page notice as tomorrow’s news', () => {
  const w = makeWorld();
  yesterday(w);
  printMorningEdition(w, REPORT);
  printLedgerEdition(w, REPORT);
  w.day = 2;
  const next = printLedgerEdition(w, REPORT);
  for (const line of next.headlines) assert.doesNotMatch(line, /The Harbor Ledger, day/);
});

// ------------------------------------------------------------------- readers

test('reading a paper sets it, moves the reader toward its view, and only once a day', () => {
  const w = makeWorld();
  yesterday(w);
  printLedgerEdition(w, REPORT);
  const reading = paperReading(w, 'ledger');
  const start = Math.min(1, Math.max(0, Math.round((reading + 0.4) * 100) / 100));
  const c = makeCitizen(w, {
    approval: { mayor: start, council: start },
    needs: { energy: 80, rest: 80, social: 50, comfort: 80, purpose: 80 },
  });

  const res = readPaper(w, c.id, 'ledger');
  assert.equal(res.ok, true, res.message);
  assert.equal(c.paper, 'ledger');
  assert.equal(c.needs.social, 50 + READING_SOCIAL);
  assert.equal(Math.round((start - c.approval.mayor) * 100), Math.round(APPROVAL_PAPER_SHIFT * 100));
  assert.equal(Math.round((start - c.approval.council) * 100), Math.round(APPROVAL_PAPER_SHIFT * 100));

  const again = readPaper(w, c.id, 'chronicle');
  assert.equal(again.ok, false, 'one paper a day');
  assert.equal(c.paper, 'ledger');

  w.day += 1;
  assert.equal(readPaper(w, c.id, 'chronicle').ok, true);
  assert.equal(c.paper, 'chronicle');
});

test('a reader already of the paper’s mind does not overshoot it', () => {
  const w = makeWorld();
  const reading = paperReading(w, 'chronicle');
  const c = makeCitizen(w, { approval: { mayor: reading, council: reading } });
  assert.equal(readPaper(w, c.id, 'chronicle').ok, true);
  assert.equal(c.approval.mayor, reading);
  assert.ok(paperReading(w, 'ledger') >= 0 && paperReading(w, 'ledger') <= 1);
});

test('an unknown paper falls back to the paper of record, and an unknown reader is refused', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  assert.equal(readPaper(w, c.id, 'gazette' as PaperId).ok, true);
  assert.equal(c.paper, 'chronicle');
  assert.equal(readPaper(w, 'c_999', 'ledger').ok, false);
});

test('readership shares add to one, whoever is in the city', () => {
  const w = makeWorld();
  assert.deepEqual(readershipShare(w), { chronicle: 1, ledger: 0 });

  const a = makeCitizen(w);
  const b = makeCitizen(w);
  const c = makeCitizen(w);
  b.paper = 'ledger';
  const share = readershipShare(w);
  assert.equal(Math.round((share.chronicle + share.ledger) * 100), 100);
  assert.equal(share.ledger, 0.33);

  c.standing = 'exiled';
  w.order = w.order.filter((id) => id !== c.id);
  const after = readershipShare(w);
  assert.equal(Math.round((after.chronicle + after.ledger) * 100), 100);
  assert.equal(after.ledger, 0.5, 'an exile reads nothing here');
  assert.equal(a.paper, 'chronicle');
});

test('the Ledger will not open on the story the Chronicle opened on', () => {
  const w = makeWorld();
  w.day = 0;
  // One story outweighs everything else, so both desks reach for it first.
  // The Ledger would print this one in its own words ("the public purse"),
  // so the echo is only caught if the two are compared in the same voice.
  emit(w, 'exile', 'Halcyon Sunder was exiled; 40 ℓ were seized by the Treasury.', [], 0.9);
  emit(w, 'trade', 'The Bazaar paid 240 ℓ for a crate of compute.', [], 0.5);
  w.day = 1;
  const chronicle = printMorningEdition(w, REPORT);
  const ledger = printLedgerEdition(w, REPORT);
  assert.equal(chronicle.headlines[0], 'Halcyon Sunder was exiled; 40 ℓ were seized by the Treasury.');
  assert.notEqual(ledger.headlines[0], chronicle.headlines[0], 'a front page that reprints the other is not a second paper');
  assert.ok(ledger.headlines.includes('The market paid 240 ℓ for a crate of compute.'));
  assert.ok(ledger.headlines.some((h) => h.includes('Halcyon Sunder was exiled')), 'the story still runs, lower down');
  assert.ok(ledger.headlines.some((h) => h.includes('the public purse')), 'and in the Ledger\'s words');
});

test('with one story in the day, both papers print it', () => {
  const w = makeWorld();
  w.day = 0;
  emit(w, 'exile', 'Halcyon Sunder was exiled from Reverie through the Exile Gate.', [], 0.9);
  w.day = 1;
  const chronicle = printMorningEdition(w, REPORT);
  const ledger = printLedgerEdition(w, REPORT);
  assert.equal(ledger.headlines[0], chronicle.headlines[0], 'nothing is invented to avoid an echo');
});

test('the Ledger says constables, the bench, the market and residents', () => {
  const w = makeWorld();
  const ev: WorldEvent = {
    tick: 0, day: 0, kind: 'verdict', text: 'The Watch took Bram to the Court; the Bazaar lost 40 ℓ and two citizens saw it.',
    actors: [], weight: 0.5,
  } as unknown as WorldEvent;
  assert.equal(
    rewrite(w, 'ledger', ev),
    'The constables took Bram to the bench; the market lost 40 ℓ and two residents saw it.',
  );
  assert.equal(rewrite(w, 'chronicle', ev), ev.text, 'the paper of record prints what was said');
});
