// Randomised and brute-force checks. Seeded, so failures reproduce.
// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../src/engine.js');

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

/** A random field in plain cron syntax (no specials). */
function field(r, lo, hi, opts = {}) {
  const v = () => int(r, lo, hi);
  switch (opts.force || pick(r, ['*', '*', 'v', 'v', 'list', 'range', 'step', 'rstep', 'slash'])) {
    case '*': return '*';
    case 'v': return String(v());
    case 'list': { const n = int(r, 2, 4); return [...new Set(Array.from({ length: n }, v))].sort((a, b) => a - b).join(','); }
    case 'range': { const a = v(), b = v(); return a === b ? String(a) : `${Math.min(a, b)}-${Math.max(a, b)}`; }
    case 'step': return `*/${int(r, 2, Math.max(2, Math.floor((hi - lo + 1) / 2)))}`;
    case 'rstep': { const a = v(), b = v(); return `${Math.min(a, b)}-${Math.max(a, b)}/${int(r, 2, 5)}`; }
    case 'slash': return `${v()}/${int(r, 2, 9)}`;
  }
}

/** Random valid expression for a dialect, biased toward the small hours where clocks change. */
function randomExpr(r, d) {
  const hour = () => (r() < 0.6 ? pick(r, ['0-3', '1', '2', '*/2', '1,2', '0-2/1', '*']) : field(r, 0, 23));
  const minute = () => (r() < 0.25 ? pick(r, ['0', '30', '*/15', '0,30']) : field(r, 0, 59));
  const month = () => (r() < 0.6 ? '*' : field(r, 1, 12));
  const unixDom = () => (r() < 0.6 ? '*' : field(r, 1, 31));
  const unixDow = (max) => (r() < 0.6 ? '*' : field(r, 0, max));
  switch (d) {
    case 'unix': case 'github':
      return `${minute()} ${hour()} ${unixDom()} ${month()} ${unixDow(d === 'unix' ? 7 : 6)}`;
    case 'k8s':
      return `${minute()} ${hour()} ${unixDom()} ${month()} ${unixDow(6)}`;
    case 'quartz': case 'eventbridge': {
      const useDom = r() < 0.5;
      const dom = useDom ? pick(r, ['L', 'L-2', 'LW', '15W', '1W', field(r, 1, 31), '*']) : '?';
      const dow = useDom ? '?' : pick(r, ['6#3', '2#1', '6L', 'MON-FRI', 'SUN', field(r, 1, 7), '*']);
      if (d === 'eventbridge') {
        const ebDom = ['L-2', 'LW'].includes(dom) ? 'L' : dom;
        const ebDow = dow === '6L' ? 'FRI' : dow;
        return `cron(${minute()} ${hour()} ${ebDom} ${month()} ${ebDow} ${pick(r, ['*', '*', '2027', '2027-2028'])})`;
      }
      return `${pick(r, ['0', '0', '30', '*/20'])} ${minute()} ${hour()} ${dom} ${month()} ${dow}${r() < 0.2 ? ' 2027-2028' : ''}`;
    }
    case 'spring': {
      const dom = r() < 0.5 ? '*' : pick(r, ['L', 'L-3', 'LW', '10W', field(r, 1, 31)]);
      const dow = r() < 0.5 ? '*' : pick(r, ['MON-FRI', 'FRI#2', 'FRIL', field(r, 0, 7)]);
      return `${pick(r, ['0', '0', '15', '*/30'])} ${minute()} ${hour()} ${dom} ${month()} ${dow}`;
    }
  }
}

// Wall-clock oracle: step through every minute and ask Intl what the local clock says.
function bruteRuns(P, tz, from, to) {
  const out = [];
  for (let t = Math.ceil(from / 60000) * 60000; t < to; t += 60000) {
    const w = E.wallParts(t, tz);
    if (!P.hours.includes(w.h) || !P.minutes.includes(w.mi)) continue;
    if (!E.dayMatches(P, w.y, w.mo, w.d)) continue;
    for (const s of P.seconds) if (t + s * 1000 >= from) out.push(t + s * 1000);
  }
  return out;
}

const TRANSITIONS = [
  ['America/New_York', Date.UTC(2027, 2, 14, 7)], // spring forward 02:00 -> 03:00
  ['America/New_York', Date.UTC(2026, 10, 1, 6)], // fall back 02:00 -> 01:00
  ['Europe/London', Date.UTC(2027, 2, 28, 1)],
  ['Europe/Berlin', Date.UTC(2026, 9, 25, 1)],
  ['Australia/Lord_Howe', Date.UTC(2027, 3, 3, 15)], // 30-minute change
  ['America/Santiago', Date.UTC(2027, 3, 4, 3)], // changes at midnight
  ['America/Havana', Date.UTC(2027, 2, 14, 5)], // 00:00 -> 01:00
  ['Asia/Kolkata', Date.UTC(2027, 2, 14, 0)], // no DST, +05:30
];

test('upcoming() matches a minute-by-minute wall-clock simulation around clock changes', () => {
  const r = rng(20261014);
  let compared = 0;
  for (let i = 0; i < 24; i++) {
    const d = pick(r, ['unix', 'k8s', 'quartz', 'spring', 'eventbridge']);
    const expr = randomExpr(r, d);
    const P = E.parse(expr, d);
    if (!P.ok || P.times.length > 400) continue;
    for (const [tz, around] of TRANSITIONS) {
      const from = around - 30 * 3600000, to = around + 30 * 3600000;
      const want = bruteRuns(P, tz, from, to);
      const got = E.upcoming(P, tz, from - 1, want.length + 50).runs
        .filter(x => x.kind !== 'skipped' && x.t < to).map(x => x.t);
      assert.deepEqual(got, want, `${expr} (${d}) in ${tz}`);
      compared += want.length;
    }
  }
  assert.ok(compared > 1000, `only ${compared} runs compared`);
});

test('skipped entries cover exactly the wall times that never occur', () => {
  const P = E.parse('*/10 2 * * *', 'unix');
  const runs = E.upcoming(P, 'America/New_York', Date.UTC(2027, 2, 13, 12), 20).runs;
  const skipped = runs.filter(x => x.kind === 'skipped');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].count, 6); // 02:00 … 02:50
  assert.equal(new Date(skipped[0].t).toISOString(), '2027-03-14T07:00:00.000Z');
});

function equivalentOverYear(A, lines, target, label) {
  const parsed = lines.map(l => {
    const P = E.parse(l, target);
    assert.ok(P.ok, `${label}: ${target} output ${l} doesn't parse: ${P.error && P.error.message}`);
    return P;
  });
  for (const P of parsed) assert.deepEqual(P.times, A.times, `${label}: times differ in ${target}`);
  for (const y of [2027, 2028]) {
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= E.daysInMonth(y, m); d++) {
        const want = E.dayMatches(A, y, m, d);
        const got = parsed.some(P => E.dayMatches(P, y, m, d));
        if (got !== want) assert.fail(`${label} -> ${target} [${lines.join(' | ')}] differs on ${y}-${m}-${d}`);
      }
    }
  }
}

test('random expressions translate to every dialect and back without changing meaning', () => {
  const r = rng(7);
  let checked = 0, translated = 0;
  for (let i = 0; i < 600; i++) {
    const d = E.DIALECT_ORDER[i % 6];
    const expr = randomExpr(r, d);
    const A = E.parse(expr, d);
    if (!A.ok) continue;
    checked++;
    for (const target of E.DIALECT_ORDER) {
      const out = E.render(A, target);
      if (!out.ok) { assert.ok(out.reason, `${expr} (${d}) -> ${target}: no reason given`); continue; }
      translated++;
      equivalentOverYear(A, out.lines, target, `${expr} (${d})`);
    }
  }
  assert.ok(checked > 450, `only ${checked} random expressions parsed`);
  assert.ok(translated > 1800, `only ${translated} translations checked`);
});

test('UTC conversions fire at the same instants as the zoned original', () => {
  const r = rng(99);
  for (let i = 0; i < 40; i++) {
    const expr = `${field(r, 0, 59, { force: pick(r, ['v', 'list', 'step']) })} ${pick(r, ['9', '0', '23', '22-23', '*/6', '9-17'])} * * ${pick(r, ['*', '1-5', '0,6'])}`;
    const A = E.parse(expr, 'unix');
    for (const tz of ['Europe/Berlin', 'Asia/Kolkata', 'America/Los_Angeles', 'Australia/Adelaide']) {
      const from = Date.UTC(2027, 0, 5), to = from + 7 * 86400000;
      const want = E.upcoming(A, tz, from, 2000).runs.filter(x => x.t < to).map(x => x.t);
      for (const v of E.utcVariants(A, tz, 'github', from)) {
        if (v.error || !v.periods.some(p => p.from <= from && from < p.to)) continue;
        const got = v.lines.flatMap(l => E.upcoming(E.parse(l, 'github'), 'UTC', from, 2000).runs)
          .filter(x => x.t < to).map(x => x.t).sort((a, b) => a - b);
        assert.deepEqual(got, want, `${expr} in ${tz} -> ${v.lines.join(' | ')}`);
      }
    }
  }
});

test('nothing throws on random input', () => {
  const r = rng(123);
  const chars = '0123456789*,-/?LW# MONFRISUNJANDEC@()';
  for (let i = 0; i < 3000; i++) {
    const len = int(r, 0, 28);
    let s = '';
    for (let j = 0; j < len; j++) s += pick(r, chars);
    for (const d of E.DIALECT_ORDER) {
      const P = E.parse(s, d);
      if (!P.ok) { assert.ok(P.error.message); continue; }
      E.describe(P);
      E.lint(P, 'America/New_York', Date.UTC(2026, 9, 14));
      E.upcoming(P, 'Europe/London', Date.UTC(2026, 9, 14), 5);
      for (const t of E.DIALECT_ORDER) E.render(P, t);
    }
  }
  const words = ['every', 'other', '15', 'minutes', 'at', '9am', 'noon', 'monday', 'weekdays', 'between', 'and', '5pm',
    'last', 'friday', 'of', 'the', 'month', '1st', 'march', 'hourly', 'twice', 'a', 'day', '2027', 'from', 'to', 'quarter', 'past',
    ',', 'first', 'third', '3rd', 'starting', 'in', 'february', 'odd', 'months', 'also', ';', 'weekday', 'year'];
  for (let i = 0; i < 2000; i++) {
    const phrase = Array.from({ length: int(r, 1, 9) }, () => pick(r, words)).join(' ');
    const res = E.fromEnglish(phrase);
    if (res.models) for (const m of res.models) for (const t of E.DIALECT_ORDER) E.render(m, t);
    else assert.ok(res.error, `no models and no error for: ${phrase}`);
  }
});
