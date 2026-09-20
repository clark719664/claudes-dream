import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, addInterval, nextDue, daysBetween, statusOf, relativeDays,
  humanizeInterval, prettyDate, toICS, foldLine, bySoonest, todayISO, isISO,
} from '../src/core.js';
import { CATALOG, CATEGORIES } from '../src/catalog.js';

test('todayISO is a plain calendar date', () => {
  assert.ok(isISO(todayISO()));
  assert.equal(todayISO(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
});

test('addDays crosses months and years', () => {
  assert.equal(addDays('2026-01-30', 3), '2026-02-02');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('month steps clamp to the end of a short month', () => {
  assert.equal(addInterval('2026-01-31', { n: 1, unit: 'month' }), '2026-02-28');
  assert.equal(addInterval('2024-01-31', { n: 1, unit: 'month' }), '2024-02-29');
  assert.equal(addInterval('2026-08-31', { n: 6, unit: 'month' }), '2027-02-28');
});

test('year steps handle leap days and long spans', () => {
  assert.equal(addInterval('2024-02-29', { n: 1, unit: 'year' }), '2025-02-28');
  assert.equal(addInterval('2016-04-12', { n: 10, unit: 'year' }), '2026-04-12');
});

test('day and week steps are exact', () => {
  assert.equal(addInterval('2026-09-20', { n: 2, unit: 'week' }), '2026-10-04');
  assert.equal(addInterval('2026-09-20', { n: 90, unit: 'day' }), '2026-12-19');
});

test('daysBetween ignores DST shifts', () => {
  // Europe/London springs forward on 29 March 2026; a naive local-time diff loses an hour here.
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
  assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
  assert.equal(daysBetween('2026-01-01', '2026-01-01'), 0);
  assert.equal(daysBetween('2026-01-10', '2026-01-01'), -9);
});

test('nextDue skips every missed cycle in one move', () => {
  // A monthly job last done nine months ago lands in the future, not next month.
  const due = nextDue('2026-01-05', { n: 1, unit: 'month' }, '2026-09-20');
  assert.equal(due, '2026-10-05');
  assert.equal(nextDue('2026-09-19', { n: 3, unit: 'month' }, '2026-09-20'), '2026-12-19');
});

test('status buckets follow each item lead time', () => {
  const today = '2026-09-20';
  const passport = { due: '2027-03-01', lead: 270 };
  const filter = { due: '2026-10-05', lead: 7 };
  assert.equal(statusOf(passport, today).state, 'soon', 'nine months of warning on a passport');
  assert.equal(statusOf(filter, today).state, 'later', 'a week of warning on a filter');
  assert.equal(statusOf({ due: '2026-09-19', lead: 7 }, today).state, 'overdue');
  assert.equal(statusOf({ due: today, lead: 7 }, today).state, 'soon');
  assert.equal(statusOf({ due: null }, today).state, 'nodate');
  assert.equal(statusOf({ due: today, archived: true }, today).state, 'archived');
  assert.equal(statusOf({ due: '2026-10-04' }, today).state, 'soon', 'the default lead is two weeks, inclusive');
  assert.equal(statusOf({ due: '2026-10-05' }, today).state, 'later', 'a day past the default lead');
});

test('relative phrasing reads like a person wrote it', () => {
  assert.equal(relativeDays(0), 'today');
  assert.equal(relativeDays(1), 'tomorrow');
  assert.equal(relativeDays(-1), 'yesterday');
  assert.equal(relativeDays(-23), '3 weeks late');
  assert.equal(relativeDays(5), 'in 5 days');
  assert.equal(relativeDays(214), 'in 7 months');
  assert.equal(relativeDays(1000), 'in 3 years');
  assert.equal(relativeDays(null), 'no date yet');
});

test('intervals and dates are spelled out, not abbreviated', () => {
  assert.equal(humanizeInterval({ n: 1, unit: 'month' }), 'every month');
  assert.equal(humanizeInterval({ n: 3, unit: 'month' }), 'every 3 months');
  assert.equal(humanizeInterval({ n: 12, unit: 'month' }), 'every year');
  assert.equal(humanizeInterval({ n: 10, unit: 'year' }), 'every 10 years');
  assert.equal(prettyDate('2026-09-20'), '20 Sep 2026');
  assert.equal(prettyDate(null), '—');
});

test('sorting puts what is late first and undated ahead of distant', () => {
  const rows = [
    { state: 'later', item: { due: '2027-01-01', name: 'Tyres' } },
    { state: 'overdue', item: { due: '2026-09-01', name: 'Filter' } },
    { state: 'nodate', item: { due: null, name: 'Extinguisher' } },
    { state: 'soon', item: { due: '2026-09-25', name: 'Passport' } },
  ];
  assert.deepEqual(rows.sort(bySoonest).map((r) => r.item.name), ['Filter', 'Passport', 'Extinguisher', 'Tyres']);
});

test('content lines fold at 75 octets with a leading space', () => {
  const folded = foldLine('SUMMARY:' + 'x'.repeat(200));
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  assert.ok(parts.slice(1).every((p) => p.startsWith(' ')));
  for (const p of parts) assert.ok(new TextEncoder().encode(p).length <= 75, 'line within 75 octets');
  assert.equal(parts.join('').replace(/ /g, ''), 'SUMMARY:' + 'x'.repeat(200));
  assert.equal(foldLine('SHORT:ok'), 'SHORT:ok');
});

test('calendar export produces importable events', () => {
  const ics = toICS(
    [
      { id: 'a1', name: 'Furnace filter', where: 'hall cupboard', kind: 'interval', every: { n: 3, unit: 'month' }, due: '2026-10-05', lead: 7 },
      { id: 'b2', name: 'Passport', kind: 'expiry', due: '2027-04-01', lead: 270, note: 'renew early' },
      { id: 'c3', name: 'Archived thing', kind: 'expiry', due: '2027-01-01', archived: true },
      { id: 'd4', name: 'No date yet', kind: 'expiry', due: null },
    ],
    { now: new Date('2026-09-20T09:00:00Z') }
  );
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.split('BEGIN:VEVENT').length - 1, 2, 'archived and undated items are left out');
  assert.match(ics, /DTSTART;VALUE=DATE:20261005/);
  assert.match(ics, /DTEND;VALUE=DATE:20261006/, 'all-day events end the next day');
  assert.match(ics, /RRULE:FREQ=MONTHLY;INTERVAL=3/);
  assert.match(ics, /SUMMARY:Passport expires/);
  assert.match(ics, /SUMMARY:Furnace filter — hall cupboard/);
  assert.match(ics, /TRIGGER:-P270D/);
  assert.match(ics, /TRIGGER:-P7D/);
  assert.ok(!/RRULE/.test(ics.split('BEGIN:VEVENT')[2]), 'a one-off expiry does not repeat');
  assert.ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
});

test('calendar text escapes separators', () => {
  const ics = toICS([{ id: 'x', name: 'Insurance; home, contents', kind: 'expiry', due: '2027-01-01', lead: 30 }]);
  assert.match(ics, /SUMMARY:Insurance\; home\\, contents expires/);
});

test('every catalog entry can answer what the app asks of it', () => {
  const cats = new Set(CATEGORIES.map((c) => c.id));
  const ids = new Set();
  for (const c of CATALOG) {
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
    ids.add(c.id);
    assert.ok(cats.has(c.cat), `${c.id} has an unknown category`);
    assert.ok(['interval', 'expiry'].includes(c.kind), `${c.id} kind`);
    assert.ok(Number.isFinite(c.lead) && c.lead >= 0, `${c.id} lead`);
    assert.ok(c.ask && c.where && c.why, `${c.id} is missing its prose`);
    if (c.kind === 'interval') assert.ok(c.every?.n > 0, `${c.id} needs an interval`);
    if (c.kind === 'expiry' && c.life) assert.ok(c.life.n > 0, `${c.id} lifespan`);
    // A lead time longer than the whole cycle would keep the item permanently "due soon".
    const cycle = c.every || c.life;
    if (cycle) {
      const span = { day: 1, week: 7, month: 30.44, year: 365.25 }[cycle.unit] * cycle.n;
      assert.ok(c.lead < span, `${c.id} warns for longer than its own cycle`);
    }
  }
  assert.ok(CATALOG.length >= 60, 'the catalog is the product');
});
