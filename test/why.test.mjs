// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../src/engine.js');
const W = require('../src/why.js');

const ok = (expr, dialect) => {
  const P = E.parse(expr, dialect);
  assert.ok(P.ok, `${expr} (${dialect}): ${P.error && P.error.message}`);
  return P;
};
const why = (expr, dialect, tz, at, zone) => {
  const P = ok(expr, dialect);
  const [y, mo, d, h, mi] = at.split(/[-T:]/).map(Number);
  return W.explain({ P, models: [P], tz, wall: { y, mo, d, h, mi }, zone: zone || tz, localTz: 'America/Chicago' });
};
const iso = t => new Date(t).toISOString().slice(0, 16);

test('a moment the schedule misses says which field and why', () => {
  const r = why('0 9 1-7 * 1', 'unix', 'Europe/Berlin', '2026-10-14T09:00');
  assert.equal(r.scheduled, false);
  const day = r.schedules[0].rows.find(x => x.field === 'Day');
  assert.equal(day.ok, false);
  assert.match(r.headline, /Not scheduled/);
  assert.match(r.headline, /either is enough/);
  assert.equal(iso(r.prev.t), '2026-10-12T07:00');
  assert.equal(iso(r.next.t), '2026-10-19T07:00');
  const t = why('*/15 9-17 * * 1-5', 'k8s', 'UTC', '2026-10-14T18:00');
  assert.match(t.headline, /every 15 minutes from 09:00 to 17:45, and this is 18:00/);
});

test('a scheduled moment points at what else to check', () => {
  const r = why('0 9 * * 1', 'unix', 'Europe/Berlin', '2026-10-12T09:00');
  assert.equal(r.scheduled, true);
  assert.ok(r.checklist.length >= 4);
  assert.ok(r.checklist.some(c => /anacron/.test(c.body)));
  for (const d of E.DIALECT_ORDER) assert.ok(W.CHECKLIST[d], `checklist for ${d}`);
});

test('a time zone mix-up is spotted', () => {
  // A GitHub schedule without timezone: runs in UTC; the person expected 09:00 Berlin time.
  const r = why('0 9 * * 1', 'github', 'UTC', '2026-10-12T09:00', 'Europe/Berlin');
  assert.equal(r.scheduled, false);
  assert.match(r.hints.join(' '), /Europe\/Berlin.*timezone: "Europe\/Berlin"/);
  // A Berlin schedule checked against 09:00 UTC: reading it in UTC would explain it.
  const u = why('0 9 * * *', 'azure', 'Europe/Berlin', '2026-10-12T09:00', 'UTC');
  assert.match(u.hints.join(' '), /UTC.*WEBSITE_TIME_ZONE/);
});

test('clock changes follow each scheduler\'s documented behaviour', () => {
  const cron = why('30 2 * * *', 'unix', 'America/New_York', '2027-03-14T02:30');
  assert.equal(cron.scheduled, true);
  assert.match(cron.dst, /right after the jump, at 03:00/);
  const eb = why('cron(30 2 * * ? *)', 'eventbridge', 'America/New_York', '2027-03-14T02:30');
  assert.equal(eb.scheduled, false);
  assert.match(eb.headline, /No run/);
  const k8s = why('30 2 * * *', 'k8s', 'America/New_York', '2027-03-14T02:30');
  assert.equal(k8s.uncertain, true);
  const aps = why('hour=3, minute=30', 'apscheduler', 'Europe/Helsinki', '2027-03-28T03:30');
  assert.equal(aps.scheduled, false);
  const back = why('30 1 * * *', 'unix', 'America/New_York', '2026-11-01T01:30');
  assert.match(back.dst, /fell back from 02:00 to 01:00.*only the first time/);
  const twice = why('hour=1, minute=30', 'apscheduler', 'America/New_York', '2026-11-01T01:30');
  assert.match(twice.dst, /both times/);
});

test('a time given in another zone is converted first', () => {
  const r = why('0 14 * * *', 'unix', 'Asia/Tokyo', '2026-10-14T07:00', 'Europe/Berlin');
  assert.equal(r.scheduled, true);
  assert.deepEqual([r.wall.h, r.wall.mi], [14, 0]);
  assert.match(r.notes.join(' '), /14:00 in Asia\/Tokyo/);
  const g = W.instantsOf({ y: 2027, mo: 3, d: 14, h: 2, mi: 30 }, 'America/New_York');
  assert.equal(g.ts.length, 0);
  assert.equal(iso(g.gap.t), '2027-03-14T07:00');
  assert.equal(W.instantsOf({ y: 2026, mo: 11, d: 1, h: 1, mi: 30 }, 'America/New_York').ts.length, 2);
});

test('several schedules: a moment matches if any of them runs', () => {
  const [a, b] = E.fromEnglish('first monday of every month at 9am, third monday of every other month at 9am').models;
  const at = { y: 2026, mo: 11, d: 16, h: 9, mi: 0 };
  const r = W.explain({ P: Object.assign({ ok: true, dialect: 'quartz' }, a), models: [a, b], tz: 'UTC', wall: at, zone: 'UTC' });
  assert.equal(r.scheduled, true);
  assert.deepEqual(r.which, [1]);
});

// previousRun walks backwards; upcoming walks forwards. They must agree.
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('previousRun agrees with upcoming() around clock changes', () => {
  const r = rng(42);
  const exprs = ['30 2 * * *', '*/20 1-3 * * *', '0 9 * * 1-5', '15 0 1,15 * *', '0 0 0 L * ?', '0 30 1 ? * 1#1', '45 23 * * 0', '0 */6 * * *'];
  const zones = ['America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'America/Santiago', 'Asia/Kolkata'];
  let checked = 0;
  for (const x of exprs) {
    const P = x.split(' ').length === 6 ? ok(x, 'quartz') : ok(x, 'unix');
    for (const tz of zones) {
      const start = Date.UTC(2026, 9, 1), end = Date.UTC(2027, 4, 1);
      const runs = E.upcoming(P, tz, start, 5000).runs.filter(q => q.kind !== 'skipped' && q.t < end);
      for (let k = 0; k < 12; k++) {
        const t = start + 40 * E.DAY + Math.floor(r() * (end - start - 40 * E.DAY));
        const want = runs.filter(q => q.t < t).pop();
        const got = W.previousRun([P], tz, t);
        assert.equal(got && got.t, want && want.t, `${x} in ${tz} before ${iso(t)}`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 400);
});
