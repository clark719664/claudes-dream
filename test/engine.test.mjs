// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../src/engine.js');

const NOW = Date.UTC(2026, 9, 14, 16, 0, 0); // Wed 14 Oct 2026 16:00 UTC

const ok = (expr, dialect) => {
  const P = E.parse(expr, dialect);
  assert.ok(P.ok, `${expr} (${dialect}) should parse: ${P.error && P.error.message}`);
  return P;
};
const bad = (expr, dialect, re) => {
  const P = E.parse(expr, dialect);
  assert.equal(P.ok, false, `${expr} (${dialect}) should fail`);
  if (re) assert.match(P.error.message, re);
  return P;
};
const iso = (P, tz, n, from = NOW) => E.upcoming(P, tz, from, n).runs.map(r => new Date(r.t).toISOString().slice(0, 16));
const lintIds = (P, tz = 'UTC') => E.lint(P, tz, NOW).map(l => l.id);
const matchingDays = (P, y) => {
  const out = [];
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= E.daysInMonth(y, m); d++) if (E.dayMatches(P, y, m, d)) out.push(`${m}-${d}`);
  return out;
};

test('field counts per dialect', () => {
  ok('0 9 * * 1-5', 'unix');
  bad('0 0 9 * * 1-5', 'unix', /6 fields.*seconds/);
  bad('0 9 * * 1-5', 'quartz', /6 or 7.*crontab format/);
  ok('0 0 9 ? * MON-FRI', 'quartz');
  ok('0 0 9 ? * MON-FRI 2027', 'quartz');
  bad('0 9 ? * MON-FRI', 'eventbridge', /6/);
  ok('cron(0 9 ? * MON-FRI *)', 'eventbridge');
  ok('0 0 9 * * MON-FRI', 'spring');
});

test('copy-paste wrappers are unwrapped', () => {
  assert.equal(ok("- cron: '17 3 * * 0'", 'github').minutes[0], 17);
  assert.equal(ok('schedule: "*/5 * * * *"', 'k8s').minutes.length, 12);
  assert.equal(ok('@Scheduled(cron = "0 0 9 * * MON-FRI", zone = "UTC")', 'spring').hours[0], 9);
  const P = ok('CRON_TZ=Asia/Tokyo 0 9 * * *', 'unix');
  assert.equal(P.tz, 'Asia/Tokyo');
  const C = ok('0 9 * * 1-5 /usr/local/bin/backup --date %F', 'unix');
  assert.equal(C.command, '/usr/local/bin/backup --date %F');
  assert.ok(lintIds(C).includes('percent'));
});

test('day-of-week numbering differs by dialect', () => {
  assert.deepEqual(ok('0 0 * * 7', 'unix').dow.list, [0]);
  assert.deepEqual(ok('0 0 * * 0', 'unix').dow.list, [0]);
  bad('0 0 * * 7', 'k8s', /0–6/);
  assert.deepEqual(ok('0 0 0 ? * 1', 'quartz').dow.list, [0]);
  assert.deepEqual(ok('0 0 0 ? * 2-6', 'quartz').dow.list, [1, 2, 3, 4, 5]);
  assert.deepEqual(ok('0 0 0 * * 7', 'spring').dow.list, [0]);
  assert.deepEqual(ok('0 0 0 * * 1-5', 'spring').dow.list, [1, 2, 3, 4, 5]);
  assert.deepEqual(ok('0 0 0 ? * FRI-MON', 'quartz').dow.list, [0, 1, 5, 6]); // Quartz wraps ranges
  bad('0 0 * * 5-1', 'unix', /backwards/);
  const Q = ok('0 0 9 ? * 1-5', 'quartz');
  assert.ok(lintIds(Q).includes('dow-numbering'));
  assert.equal(E.lint(Q, 'UTC', NOW).find(l => l.id === 'dow-numbering').fix.expr, '0 0 9 ? * MON-FRI');
});

test('Vixie OR/AND rule for the day fields', () => {
  // Both restricted, neither starts with * -> OR
  const or = ok('0 0 1 * 1', 'unix');
  assert.equal(or.dayMode, 'or');
  assert.ok(matchingDays(or, 2027).includes('1-1')); // Fri 1 Jan
  assert.ok(matchingDays(or, 2027).includes('1-4')); // Mon 4 Jan
  // */2 starts with * -> AND in Vixie/cronie
  const and = ok('0 0 */2 * 1', 'unix');
  assert.equal(and.dayMode, 'and');
  assert.deepEqual(matchingDays(and, 2027).slice(0, 3), ['1-11', '1-25', '2-1']);
  // robfig (Kubernetes): a step > 1 drops the star flag -> OR
  assert.equal(ok('0 0 */2 * 1', 'k8s').dayMode, 'or');
  // 1-31 doesn't start with *, so OR with Monday = every day
  const all = ok('0 0 1-31 * 1', 'unix');
  assert.equal(all.dayMode, 'all');
  assert.ok(lintIds(all).includes('or-ignored'));
  // Spring always ANDs; one week of dates ANDed with one weekday is that week's weekday
  assert.equal(ok('0 0 0 1-15 * MON', 'spring').dayMode, 'and');
  assert.deepEqual(ok('0 0 0 1-7 * MON', 'spring').dow.special, { type: 'nth', dow: 1, n: 1 });
});

test('Quartz needs exactly one ?', () => {
  const P = bad('0 0 12 * * MON', 'quartz', /needs `\?`/);
  assert.equal(P.error.fix.expr, '0 0 12 ? * MON');
  bad('0 0 12 ? * ?', 'quartz', /Only one/);
  bad('0 0 12 1 * MON', 'quartz', /two separate/);
  bad('0 12 * * MON *', 'eventbridge', /needs `\?`/);
});

test('special characters', () => {
  const L = ok('0 0 0 L * ?', 'quartz');
  assert.deepEqual(matchingDays(L, 2028).slice(0, 3), ['1-31', '2-29', '3-31']);
  const L2 = ok('0 0 0 L-2 * ?', 'quartz');
  assert.deepEqual(matchingDays(L2, 2027).slice(0, 2), ['1-29', '2-26']);
  const LW = ok('0 0 0 LW * ?', 'quartz');
  assert.deepEqual(matchingDays(LW, 2027).slice(0, 3), ['1-29', '2-26', '3-31']); // Jan 31 2027 is a Sunday
  const W = ok('0 0 0 1W * ?', 'quartz');
  assert.equal(matchingDays(W, 2027)[4], '5-3'); // 1 May 2027 is Saturday -> Monday 3rd, never back into April
  const W15 = ok('0 0 0 15W * ?', 'quartz');
  assert.equal(matchingDays(W15, 2027)[4], '5-14'); // 15 May 2027 is Saturday -> Friday 14th
  const nth = ok('0 0 12 ? * 6#3', 'quartz');
  assert.deepEqual(matchingDays(nth, 2026).slice(9), ['10-16', '11-20', '12-18']);
  const last = ok('0 0 12 ? * 6L', 'quartz');
  assert.deepEqual(matchingDays(last, 2026).slice(9), ['10-30', '11-27', '12-25']);
  assert.deepEqual(ok('0 0 12 ? * L', 'quartz').dow.list, [6]);
  bad('0 0 L * *', 'unix', /doesn't support/);
  bad('0 12 ? * 6L *', 'eventbridge', /doesn't support/);
  bad('0 0 0 1,L * ?', 'quartz', /can't be combined/);
  bad('H/15 * * * *', 'unix', /Jenkins/);
});

test('upcoming runs in a zone, with DST', () => {
  const P = ok('30 2 * * *', 'unix');
  // Spring forward in New York, Sunday 14 Mar 2027: 02:30 doesn't exist
  const from = Date.UTC(2027, 2, 13, 5); // 00:00 EST
  const runs = E.upcoming(P, 'America/New_York', from, 3).runs;
  assert.equal(runs[0].kind, 'run');
  assert.equal(new Date(runs[0].t).toISOString(), '2027-03-13T07:30:00.000Z'); // EST
  assert.equal(runs[1].kind, 'skipped');
  assert.equal(new Date(runs[1].t).toISOString(), '2027-03-14T07:00:00.000Z'); // the 02:00 -> 03:00 jump
  assert.equal(new Date(runs[2].t).toISOString(), '2027-03-15T06:30:00.000Z'); // EDT
  // Fall back, Sunday 1 Nov 2026: 01:30 happens twice
  const F = ok('30 1 * * *', 'unix');
  const fr = E.upcoming(F, 'America/New_York', Date.UTC(2026, 10, 1, 0), 3).runs;
  assert.deepEqual(fr.map(r => r.kind), ['run', 'repeat', 'run']);
  assert.equal(fr[1].t - fr[0].t, 3600000);
  // Fixed-offset zone
  assert.deepEqual(iso(ok('0 9 * * *', 'unix'), 'Asia/Kolkata', 1), ['2026-10-15T03:30']);
});

test('dst impact is reported only when a run falls in the changeover', () => {
  assert.ok(lintIds(ok('30 2 * * *', 'unix'), 'America/New_York').includes('dst'));
  assert.ok(lintIds(ok('30 1 * * *', 'unix'), 'America/New_York').includes('dst'));
  assert.ok(!lintIds(ok('0 9 * * *', 'unix'), 'America/New_York').includes('dst'));
  assert.ok(!lintIds(ok('30 2 * * *', 'unix'), 'UTC').includes('dst'));
  // Only on Sundays: US changeovers happen on Sundays
  assert.ok(lintIds(ok('30 2 * * 0', 'unix'), 'America/New_York').includes('dst'));
  assert.ok(!lintIds(ok('30 2 * * 1', 'unix'), 'America/New_York').includes('dst'));
});

test('stats and uneven steps', () => {
  const s = E.stats(ok('*/7 * * * *', 'unix'), 'UTC', NOW);
  assert.equal(s.minGap, 240);
  assert.equal(s.maxGap, 420);
  assert.equal(s.perDay, 24 * 9);
  assert.ok(lintIds(ok('*/7 * * * *', 'unix')).includes('uneven-minute'));
  assert.ok(!lintIds(ok('*/15 * * * *', 'unix')).includes('uneven-minute'));
  assert.ok(lintIds(ok('0 */5 * * *', 'unix')).includes('uneven-hour'));
  assert.ok(lintIds(ok('*/90 * * * *', 'unix')).includes('big-step-minute'));
  assert.deepEqual(E.minuteIntervalLines(90), ['0 */3 * * *', '30 1-22/3 * * *']);
  assert.ok(lintIds(ok('0 0 */2 * *', 'unix')).includes('uneven-dom'));
  const w = E.stats(ok('0 9 * * 1-5', 'unix'), 'UTC', NOW);
  assert.equal(w.maxGap, 3 * 86400);
  assert.equal(w.perYear, 261);
});

test('checks for common mistakes', () => {
  assert.ok(lintIds(ok('0 9 1-7 * 1', 'unix')).includes('or-trap'));
  assert.ok(lintIds(ok('* 9 * * *', 'unix')).includes('every-minute'));
  assert.ok(lintIds(ok('0 0 30 2 *', 'unix')).includes('never'));
  assert.ok(lintIds(ok('0 0 31 * *', 'unix')).includes('short-months'));
  assert.ok(lintIds(ok('*/2 * * * *', 'github')).includes('gh-5min'));
  assert.ok(lintIds(ok('0 * * * *', 'github')).includes('gh-top-of-hour'));
  assert.ok(lintIds(ok('5/15 * * * *', 'unix')).includes('bare-slash'));
  assert.equal(E.lint(ok('5/15 * * * *', 'unix'), 'UTC', NOW).find(l => l.id === 'bare-slash').fix.expr, '5-59/15 * * * *');
  assert.ok(!lintIds(ok('0 9 * * *', 'unix')).includes('dow-7'));
});

test('descriptions', () => {
  const d = (x, dia = 'unix') => E.describe(ok(x, dia));
  assert.equal(d('0 9 * * 1-5'), 'At 09:00 on weekdays (Monday to Friday).');
  assert.equal(d('*/15 * * * *'), 'Every 15 minutes.');
  assert.equal(d('*/15 9-17 * * *'), 'Every 15 minutes from 09:00 to 17:45.');
  assert.equal(d('15 * * * *'), 'Every hour at :15.');
  assert.equal(d('0 9 1-7 * 1'), 'At 09:00 on the 1st through 7th of the month **or** on Mondays.');
  assert.equal(d('0 0 12 ? * 6#3', 'quartz'), 'At 12:00 on the third Friday of the month.');
  assert.equal(d('cron(0 18 L * ? *)', 'eventbridge'), 'At 18:00 on the last day of the month.');
  assert.equal(d('0 0 1 1,7 *'), 'At 00:00 on the 1st of the month, in January and July.');
  assert.equal(d('@reboot'), 'Once, when the cron daemon starts (usually at boot).');
});

// Translate to every dialect, parse it back there, and check it fires identically.
const ROUND_TRIP = [
  ['0 9 * * 1-5', 'unix'], ['*/15 9-17 * * *', 'unix'], ['0 9 1-7 * 1', 'unix'], ['0 0 */2 * 1', 'unix'],
  ['5,35 */3 1,15 * *', 'unix'], ['0 0 1 */3 *', 'unix'], ['0 22 * * 0,6', 'unix'], ['@weekly', 'unix'],
  ['0 0 12 ? * 6#3', 'quartz'], ['0 0 12 ? * 6L', 'quartz'], ['0 0 18 L * ?', 'quartz'], ['0 0 18 L-3 * ?', 'quartz'],
  ['0 0 18 LW * ?', 'quartz'], ['0 0 18 15W * ?', 'quartz'], ['*/10 * 9-10 ? * MON-FRI', 'quartz'],
  ['0 30 7 ? 1-6 SUN 2027-2028', 'quartz'], ['cron(0 18 L * ? *)', 'eventbridge'], ['cron(15 10 ? * 2#1 2027)', 'eventbridge'],
  ['0 0 9 1-7 * MON', 'spring'], ['0 0/20 8-18 * * SAT,SUN', 'spring'], ['0 0 0 * * 1-5', 'spring'],
];

function equivalent(A, lines, target) {
  const parsed = lines.map(l => ok(l, target));
  for (const P of parsed) assert.deepEqual(P.times, A.times, `times differ for ${lines.join(' | ')}`);
  for (const y of [2027, 2028]) {
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= E.daysInMonth(y, m); d++) {
        const want = E.dayMatches(A, y, m, d);
        const got = parsed.some(P => E.dayMatches(P, y, m, d));
        assert.equal(got, want, `${lines.join(' | ')} (${target}) on ${y}-${m}-${d}`);
      }
    }
  }
}

for (const [expr, dialect] of ROUND_TRIP) {
  test(`round trip: ${expr} (${dialect})`, () => {
    const A = ok(expr, dialect);
    let translated = 0;
    for (const target of E.DIALECT_ORDER) {
      const r = E.render(A, target);
      if (!r.ok) {
        assert.ok(r.reason, `${target} must explain why it can't`);
        continue;
      }
      translated++;
      equivalent(A, r.lines, target);
    }
    assert.ok(translated >= 1);
  });
}

test('translations that need a workaround say so', () => {
  const r = E.render(ok('0 0 12 ? * 6#3', 'quartz'), 'unix');
  assert.equal(r.ok, false);
  assert.equal(E.workaroundText(r.workaround, 'unix'), '0 12 15-21 * *  [ "$(date +\\%u)" = 5 ] && your-command');
  const k = E.render(ok('0 0 */2 * 1', 'unix'), 'k8s');
  assert.equal(k.ok, false);
  assert.match(k.reason, /ORs/);
  const s = E.render(ok('30 0 9 * * *', 'spring'), 'unix');
  assert.equal(s.ok, false);
  assert.equal(E.workaroundText(s.workaround, 'unix'), '0 9 * * *  sleep 30 && your-command');
  assert.equal(E.render(ok('0 0 9 * * * ', 'spring'), 'eventbridge').lines[0], 'cron(0 9 * * ? *)');
  // OR schedules need two triggers in Quartz
  assert.deepEqual(E.render(ok('0 9 1 * 1', 'unix'), 'quartz').lines, ['0 0 9 1 * ?', '0 0 9 ? * MON']);
  // Avoid */n in a crontab day field when ORing, or Vixie would AND
  const oddOrMonday = E.buildModel({
    seconds: [0], minutes: [0], hours: [9], months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], years: null,
    dom: { list: Array.from({ length: 16 }, (_, i) => 2 * i + 1) }, dow: { list: [1] }, combine: 'or',
  });
  const line = E.render(oddOrMonday, 'unix').lines[0];
  assert.equal(line, '0 9 1-31/2 * 1');
  assert.equal(ok(line, 'unix').dayMode, 'or');
});

test('UTC conversion for GitHub and EventBridge rules', () => {
  const v = E.utcVariants(ok('0 9 * * 1-5', 'unix'), 'Europe/Berlin', 'github', NOW);
  assert.deepEqual(v.map(x => x.lines[0]).sort(), ['0 7 * * 1-5', '0 8 * * 1-5']);
  const india = E.utcVariants(ok('*/15 9-17 * * *', 'unix'), 'Asia/Kolkata', 'github', NOW);
  assert.deepEqual(india[0].lines, ['30,45 3 * * *', '*/15 4-11 * * *', '0,15 12 * * *']);
  const midnight = E.utcVariants(ok('30 0 * * 1', 'unix'), 'Europe/Berlin', 'github', NOW);
  assert.deepEqual(midnight.map(x => x.lines[0]).sort(), ['30 22 * * 0', '30 23 * * 0']);
  const dom = E.utcVariants(ok('30 0 1 * *', 'unix'), 'Europe/Berlin', 'github', NOW);
  assert.ok(dom.every(x => x.error));
});

test('English to cron', () => {
  const u = (text, target = 'unix') => {
    const r = E.fromEnglish(text);
    assert.ok(r.models, `${text}: ${r.error}`);
    return r.models.map(m => {
      const out = E.render(m, target);
      assert.ok(out.ok, `${text} -> ${target}: ${out.reason}`);
      return out.lines.join(' | ');
    }).join(' + ');
  };
  assert.equal(u('every weekday at 9:30am'), '30 9 * * 1-5');
  assert.equal(u('every 15 minutes during business hours'), '*/15 9-16 * * *');
  assert.equal(u('quarterly on the 1st at 06:00'), '0 6 1 */3 *');
  assert.equal(u('every monday and wednesday at 14:00'), '0 14 * * 1,3');
  assert.equal(u('every sunday at 3:30 pm'), '30 15 * * 0');
  assert.equal(u('every 2 hours from 8am to 6pm on weekdays'), '0 8-18/2 * * 1-5');
  assert.equal(u('on the 1st and 15th at noon'), '0 12 1,15 * *');
  assert.equal(u('hourly at :15'), '15 * * * *');
  assert.equal(u('twice a day'), '0 0,12 * * *');
  assert.equal(u('every tuesday through thursday at 8am'), '0 8 * * 2-4');
  assert.equal(u('last friday of the month at 5pm', 'quartz'), '0 0 17 ? * 6L');
  assert.equal(u('first monday of the month at 9am', 'quartz'), '0 0 9 ? * 2#1');
  assert.equal(u('last day of the month at 23:00', 'eventbridge'), 'cron(0 23 L * ? *)');
  assert.equal(u('every 30 seconds', 'spring'), '0,30 * * * * *');
  assert.match(E.fromEnglish('every 2 weeks').error, /can't count weeks/);
  assert.equal(u('every 90 minutes'), '0 */3 * * * + 30 1-22/3 * * *');
  assert.equal(u('at 9:30 and 17:00'), '30 9 * * * + 0 17 * * *');
});

test('English with several schedules in one sentence', () => {
  const q = text => {
    const r = E.fromEnglish(text);
    assert.ok(r.models, `${text}: ${r.error}`);
    return r.models.map(m => E.render(m, 'quartz').lines.join(' | '));
  };
  // The report that started this: both rules must survive, each with its own months.
  assert.deepEqual(q('First monday of every month, 3rd monday of every other month'), ['0 0 0 ? * 2#1', '0 0 0 ? 1/2 2#3']);
  assert.deepEqual(q('first monday of every month and 3rd monday of every other month at 9am'), ['0 0 9 ? * 2#1', '0 0 9 ? 1/2 2#3']);
  assert.deepEqual(q('first monday of every month at 9am, 3rd monday of every other month'), ['0 0 9 ? * 2#1', '0 0 9 ? 1/2 2#3']);
  assert.deepEqual(q('every monday at 9am and every friday at 5pm'), ['0 0 9 ? * MON', '0 0 17 ? * FRI']);
  assert.deepEqual(q('first and third monday of the month at 6pm'), ['0 0 18 ? * 2#1', '0 0 18 ? * 2#3']);
  assert.deepEqual(q('on march 3 and july 4 at 10:00'), ['0 0 10 3 3 ?', '0 0 10 4 7 ?']);
  assert.deepEqual(q('every 15 minutes between 9am and 5pm on weekdays and hourly on weekends'), ['0 0/15 9-16 ? * MON-FRI', '0 0 * ? * SUN,SAT']);
  assert.deepEqual(q('second tuesday of every other month starting in february at 6pm'), ['0 0 18 ? 2/2 3#2']);
  assert.deepEqual(q('last day of every quarter at 23:00'), ['0 0 23 L 3/3 ?']);
  assert.deepEqual(q('first monday of the quarter at 8am'), ['0 0 8 ? 1/3 2#1']);
  // Things that are one schedule stay one schedule.
  assert.deepEqual(q('every weekday at 9am and 5pm'), ['0 0 9,17 ? * MON-FRI']);
  assert.deepEqual(q('every monday and wednesday at 14:00'), ['0 0 14 ? * MON,WED']);
  assert.deepEqual(q('mondays, wednesdays and fridays at 8pm'), ['0 0 20 ? * MON,WED,FRI']);
  assert.deepEqual(q('on the 1st and 15th at noon'), ['0 0 12 1,15 * ?']);
  assert.deepEqual(q('on the 1st of january and july'), ['0 0 0 1 1,7 ?']);
  assert.deepEqual(q('every 10 minutes between 9am and 5pm mon-fri'), ['0 0/10 9-16 ? * MON-FRI']);
  assert.match(E.fromEnglish('First monday of every month, 3rd monday of every other month').notes.join(' '), /January, March, May/);
});

test('whole pasted config blocks, with their time zone settings', () => {
  const gh = ok("on:\n  schedule:\n    - cron: '30 5 * * 1-5'\n      timezone: \"America/New_York\"\njobs: {}", 'github');
  assert.equal(gh.tz, 'America/New_York');
  assert.deepEqual([gh.hours[0], gh.minutes[0]], [5, 30]);
  assert.ok(!lintIds(gh, 'America/New_York').includes('gh-timezone'));
  assert.ok(lintIds(ok('30 5 * * 1-5', 'github'), 'Europe/Berlin').includes('gh-timezone'));
  assert.ok(!lintIds(ok('30 5 * * 1-5', 'github'), 'UTC').includes('gh-timezone'));
  const k = ok('spec:\n  schedule: "0 9 * * 1-5"\n  timeZone: "Europe/Berlin"', 'k8s');
  assert.equal(k.tz, 'Europe/Berlin');
  assert.ok(!lintIds(k, 'Europe/Berlin').includes('k8s-tz'));
  assert.equal(ok('@Scheduled(cron = "0 0 9 * * MON-FRI", zone = "Asia/Tokyo")', 'spring').tz, 'Asia/Tokyo');
  const aws = ok('aws scheduler create-schedule --schedule-expression "cron(0 9 ? * MON-FRI *)" --schedule-expression-timezone "Europe/Paris"', 'eventbridge');
  assert.equal(aws.tz, 'Europe/Paris');
  const tab = ok('# nightly\nMAILTO=ops@example.com\nCRON_TZ=Australia/Sydney\n30 2 * * * /opt/backup.sh', 'unix');
  assert.equal(tab.tz, 'Australia/Sydney');
  assert.equal(tab.command, '/opt/backup.sh');
  bad('rate(5 minutes)', 'eventbridge', /rate\(\)/);
  bad('CRON_TZ=Mars/Olympus 0 9 * * *', 'unix', /time zone/);
});

test('documented daylight-saving behaviour per scheduler', () => {
  assert.deepEqual(E.dstPolicy(ok('30 2 * * *', 'unix')), { gap: 'after', overlap: 'once', wild: false });
  assert.deepEqual(E.dstPolicy(ok('*/15 2 * * *', 'unix')), { gap: 'skip', overlap: 'twice', wild: true });
  assert.deepEqual(E.dstPolicy(ok('30 * * * *', 'unix')), { gap: 'skip', overlap: 'twice', wild: true });
  assert.deepEqual(E.dstPolicy(ok('@hourly', 'unix')), { gap: 'skip', overlap: 'twice', wild: true });
  assert.deepEqual(E.dstPolicy(ok('30 2 * * *', 'github')), { gap: 'after', overlap: null });
  assert.deepEqual(E.dstPolicy(ok('cron(30 2 * * ? *)', 'eventbridge')), { gap: 'skip', overlap: 'once' });
  assert.deepEqual(E.dstPolicy(ok('0 30 2 * * ?', 'quartz')), { gap: 'skip', overlap: 'once' });
  assert.deepEqual(E.dstPolicy(ok('30 2 * * *', 'k8s')), { gap: null, overlap: null });
  const body = E.lint(ok('30 2 * * *', 'github'), 'America/New_York', NOW).find(l => l.id === 'dst').body;
  assert.match(body, /next valid time/);
});

test('clock-change edges: the first and last minutes of a skipped or repeated hour', () => {
  const ny = (x) => E.lint(ok(x, 'unix'), 'America/New_York', NOW).find(l => l.id === 'dst');
  assert.match(ny('0 2 * * *').body, /jump/);        // 02:00 doesn't exist on spring-forward day
  assert.doesNotMatch(ny('0 2 * * *').body, /fall back/); // and occurs once on fall-back day
  assert.equal(ny('0 3 * * *'), undefined);          // 03:00 always exists, once
  assert.match(ny('59 1 * * *').body, /fall back/);  // 01:59 happens twice
  assert.match(ny('0 1 * * *').body, /fall back/);
  assert.equal(ny('59 0 * * *'), undefined);
});

test('several schedules analyzed together', () => {
  const [a, b] = E.fromEnglish('First monday of every month, 3rd monday of every other month').models;
  const st = E.statsSet([a, b], 'America/Chicago', NOW);
  assert.equal(st.perYear, 18); // 12 first Mondays + 6 third Mondays
  assert.equal(st.overlaps, 0);
  const runs = E.upcomingSet([a, b], 'America/Chicago', NOW, 5).runs;
  assert.deepEqual(runs.map(r => [new Date(r.t).toISOString().slice(0, 10), r.which.join()]),
    [['2026-11-02', '0'], ['2026-11-16', '1'], ['2026-12-07', '0'], ['2027-01-04', '0'], ['2027-01-18', '1']]);
  assert.deepEqual(E.lintSet([a, b], 'America/Chicago', NOW), []);
  // Coinciding runs are merged in the list and reported once per year-count.
  const mon = ok('0 0 9 ? * MON', 'quartz'), first = ok('0 0 9 ? * 2#1', 'quartz');
  const both = E.upcomingSet([mon, first], 'UTC', NOW, 4).runs;
  assert.deepEqual(both.map(r => [new Date(r.t).toISOString().slice(0, 10), r.which.join()]),
    [['2026-10-19', '0'], ['2026-10-26', '0'], ['2026-11-02', '0,1'], ['2026-11-09', '0']]);
  assert.equal(E.statsSet([mon, first], 'UTC', NOW).overlaps, 12);
  assert.equal(E.lintSet([mon, first], 'UTC', NOW)[0].id, 'overlap');
  // A single schedule gives the same answer either way.
  const one = ok('*/7 * * * *', 'unix');
  assert.deepEqual(E.upcomingSet([one], 'UTC', NOW, 10).runs.map(r => r.t), E.upcoming(one, 'UTC', NOW, 10).runs.map(r => r.t));
  assert.equal(E.statsSet([one], 'UTC', NOW).minGap, E.stats(one, 'UTC', NOW).minGap);
});

// ---------------------------------------------------------------- schedulers added in 1.1

const sameSchedule = (a, b, msg) => {
  assert.deepEqual(a.times, b.times, `${msg}: times`);
  for (const y of [2027, 2028]) assert.deepEqual(matchingDays(a, y), matchingDays(b, y), `${msg}: days in ${y}`);
};
const isoFrom = (P, from, n, tz = 'UTC') => E.upcoming(P, tz, from, n).runs.map(r => new Date(r.t).toISOString().slice(0, 16));

test('systemd: the normalized forms in systemd.time(7) mean the same thing', () => {
  const pairs = [
    ['Sat,Thu,Mon..Wed,Sat..Sun', 'Mon..Thu,Sat,Sun *-*-* 00:00:00'],
    ['Mon,Sun 12-*-* 2,1:23', 'Mon,Sun 2012-*-* 01,02:23:00'],
    ['Wed *-1', 'Wed *-*-01 00:00:00'],
    ['Wed..Wed,Wed *-1', 'Wed *-*-01 00:00:00'],
    ['Wed, 17:48', 'Wed *-*-* 17:48:00'],
    ['Wed..Sat,Tue 12-10-15 1:2:3', 'Tue..Sat 2012-10-15 01:02:03'],
    ['*-*-7 0:0:0', '*-*-07 00:00:00'],
    ['10-15', '*-10-15 00:00:00'],
    ['monday *-12-* 17:00', 'Mon *-12-* 17:00:00'],
    ['Mon,Fri *-*-3,1,2 *:30:45', 'Mon,Fri *-*-01,02,03 *:30:45'],
    ['12,14,13,12:20,10,30', '*-*-* 12,13,14:10,20,30:00'],
    ['12..14:10,20,30', '*-*-* 12..14:10,20,30:00'],
    ['mon,fri *-1/2-1,3 *:30:45', 'Mon,Fri *-01/2-01,03 *:30:45'],
    ['03-05 08:05:40', '*-03-05 08:05:40'],
    ['08:05:40', '*-*-* 08:05:40'],
    ['05:40', '*-*-* 05:40:00'],
    ['Sat,Sun 12-05 08:05:40', 'Sat,Sun *-12-05 08:05:40'],
    ['2003-03-05 05:40', '2003-03-05 05:40:00'],
    ['2003-02..04-05', '2003-02..04-05 00:00:00'],
    ['hourly', '*-*-* *:00:00'],
    ['daily', '*-*-* 00:00:00'],
    ['monthly', '*-*-01 00:00:00'],
    ['weekly', 'Mon *-*-* 00:00:00'],
    ['yearly', '*-01-01 00:00:00'],
    ['annually', '*-01-01 00:00:00'],
    ['quarterly', '*-01,04,07,10-01 00:00:00'],
    ['semiannually', '*-01,07-01 00:00:00'],
    ['*:2/3', '*-*-* *:02/3:00'],
  ];
  for (const [a, b] of pairs) {
    const A = ok(a, 'systemd'), B = ok(b, 'systemd');
    assert.deepEqual([A.years, A.months, A.times], [B.years, B.months, B.times], a);
    for (const y of [2003, 2012, 2027]) assert.deepEqual(matchingDays(A, y), matchingDays(B, y), `${a} in ${y}`);
  }
  // Rendering gives systemd's own normalized form where it can.
  for (const x of ['Mon..Thu,Sat,Sun *-*-* 00:00:00', 'Mon,Sun 2012-*-* 01,02:23:00', 'Tue..Sat 2012-10-15 01:02:03', 'Mon,Fri *-01/2-01,03 *:30:45', '*-*-* *:02/3:00']) {
    assert.equal(E.render(ok(x, 'systemd'), 'systemd').lines[0], x);
  }
});

test('systemd: month ends, time zones and refusals', () => {
  // "Mon *-05~07/1 means the last Monday in May"; "*-02~03 means the third last day in February"
  assert.deepEqual(matchingDays(ok('Mon *-05~07/1', 'systemd'), 2027), ['5-31']);
  assert.deepEqual(matchingDays(ok('*-02~03', 'systemd'), 2028), ['2-27']);
  assert.deepEqual(matchingDays(ok('*-*~01..03', 'systemd'), 2027).slice(0, 4), ['1-29', '1-30', '1-31', '2-26']);
  assert.equal(E.describe(ok('*-*~01..03 12:00', 'systemd')), 'At 12:00 on the last 3 days of the month.');
  assert.equal(E.render(ok('0 0 12 ? * 6L', 'quartz'), 'systemd').lines[0], 'Fri *-*~07/1 12:00:00');
  const z = ok('Mon..Fri 09:00 Europe/Berlin', 'systemd');
  assert.equal(z.tz, 'Europe/Berlin');
  assert.equal(ok('daily UTC', 'systemd').tz, 'UTC');
  const unit = ok('[Unit]\nDescription=Backup\n\n[Timer]\nOnCalendar=Sat *-*-1..7 03:00\nPersistent=true\n', 'systemd');
  assert.deepEqual(unit.dow.special, { type: 'nth', dow: 6, n: 1 });
  bad('*:*/15', 'systemd', /`0\/15`/);
  bad('Fri..Mon 10:00', 'systemd', /Monday to Sunday/);
  bad('*-*~29', 'systemd', /1–28/);
  bad('*:50/15', 'systemd', /never fires a second time/);
  bad('Mon 25:00', 'systemd', /0–23/);
  assert.deepEqual(E.dstPolicy(ok('02:30', 'systemd')), { gap: null, overlap: null });
  assert.ok(lintIds(ok('02:30', 'systemd')).includes('sd-timer'));
});

test('GitLab (fugit): #, L, -n-L and the & extension', () => {
  assert.deepEqual(ok('0 5 * * mon#1', 'gitlab').dow.special, { type: 'nth', dow: 1, n: 1 });
  for (const x of ['0 7 * * 5#-1', '0 7 * * fri#-1', '0 7 * * 5#L', '0 7 * * fri#last']) {
    assert.deepEqual(ok(x, 'gitlab').dow.special, { type: 'lastDow', dow: 5 }, x);
  }
  assert.deepEqual(ok('0 0 L * *', 'gitlab').dom.special, { type: 'L', offset: 0 });
  assert.deepEqual(ok('0 0 last * *', 'gitlab').dom.special, { type: 'L', offset: 0 });
  assert.deepEqual(ok('0 0 -7-L * *', 'gitlab').dom.special, { type: 'fromEnd', offsets: [0, 1, 2, 3, 4, 5, 6] });
  // The examples from fugit's README: & turns the day-field OR into AND.
  const from = (y, m, d) => Date.UTC(y, m - 1, d);
  assert.equal(isoFrom(ok('0 0 */2 * 1-5', 'gitlab'), from(2022, 8, 9), 1)[0], '2022-08-10T00:00');
  for (const x of ['0 0 */2 * 1-5&', '0 0 */2& * 1-5', '0 0 */2& * 1-5&']) assert.equal(isoFrom(ok(x, 'gitlab'), from(2022, 8, 9), 1)[0], '2022-08-11T00:00', x);
  assert.equal(isoFrom(ok('59 6 1-7 * 2', 'gitlab'), from(2020, 3, 15), 1)[0], '2020-03-17T06:59');
  assert.equal(isoFrom(ok('59 6 1-7& * 2', 'gitlab'), from(2020, 3, 15), 1)[0], '2020-04-07T06:59');
  // Lists of # days are split into separate schedules.
  const P = bad('0 6 * * 5#4,5#5', 'gitlab', /split/);
  assert.deepEqual(P.error.fix.exprs, ['0 6 * * 5#4', '0 6 * * 5#5']);
  assert.deepEqual(bad('0 23 * * mon#2,tue', 'gitlab').error.fix.exprs, ['0 23 * * mon#2', '0 23 * * tue']);
  bad('9 0 * * sun%2', 'gitlab', /every-nth-week/);
  assert.equal(E.render(ok('0 0 12 ? * 6#3', 'quartz'), 'gitlab').lines[0], '0 12 * * 5#3');
  assert.equal(E.render(ok('0 0 */2 * 1-5', 'unix'), 'gitlab').lines[0], '0 0 */2& * 1-5');
  assert.ok(lintIds(ok('*/5 * * * *', 'gitlab')).includes('gl-frequent'));
  assert.ok(lintIds(ok('0 9 * * *', 'gitlab')).includes('gl-worker'));
  assert.ok(lintIds(ok('0 9 1-7 * 1', 'gitlab')).includes('or-trap'));
});

test('Cloudflare: Sunday is 1, Quartz-style extras, UTC only', () => {
  sameSchedule(ok('0 17 * * sun', 'cloudflare'), ok('0 17 * * 1', 'cloudflare'), 'Sunday');
  sameSchedule(ok('10 7 * * mon-fri', 'cloudflare'), ok('10 7 * * 2-6', 'cloudflare'), 'weekdays');
  sameSchedule(ok('0 18 * * 6L', 'cloudflare'), ok('0 18 * * friL', 'cloudflare'), 'last Friday');
  assert.deepEqual(matchingDays(ok('59 23 LW * *', 'cloudflare'), 2027).slice(0, 3), ['1-29', '2-26', '3-31']);
  assert.deepEqual(ok('0 9 * * FRI-MON', 'cloudflare').dow.list, [0, 1, 5, 6]); // ranges wrap
  assert.equal(ok('0 0 1 * MON', 'cloudflare').dayMode, 'or');
  bad('0 9 ? * MON', 'cloudflare', /doesn't use `\?`/);
  bad('0 9 * * */8', 'cloudflare', /steps above 7/);
  const w = E.lint(ok('0 9 * * 1-5', 'cloudflare'), 'UTC', NOW);
  assert.equal(w.find(l => l.id === 'dow-numbering').fix.expr, '0 9 * * MON-FRI');
  assert.ok(lintIds(ok('0 9 * * *', 'cloudflare')).includes('cf-utc'));
  assert.equal(E.render(ok('0 9 * * 1-5', 'unix'), 'cloudflare').lines[0], '0 9 * * MON-FRI');
  assert.equal(ok('[triggers]\ncrons = ["*/3 * * * *", "0 15 1 * *"]', 'cloudflare').minutes.length, 20);
});

test('Azure Functions (NCRONTAB): seconds first, AND for the day fields', () => {
  const table = [
    ['0 */5 * * * *', 12 * 24], ['0 0 * * * *', 24], ['0 0 */2 * * *', 12], ['0 0 9-17 * * *', 9], ['0 30 9 * * *', 1],
  ];
  for (const [x, perDay] of table) assert.equal(ok(x, 'azure').times.length, perDay, x);
  sameSchedule(ok('30 9 * * 1-5', 'azure'), ok('0 30 9 * * 1-5', 'azure'), 'five fields');
  sameSchedule(ok('0 30 9 * Jan Mon', 'azure'), ok('0 30 9 * 1 1', 'azure'), 'names');
  sameSchedule(ok('0 0 9 * * Monday', 'azure'), ok('0 0 9 * * Mo', 'azure'), 'name prefixes');
  const sw = ok('0 0 9 * * Fri-Mon', 'azure');
  assert.deepEqual(sw.dow.list, [1, 2, 3, 4, 5]); // NCrontab swaps a backwards range
  assert.ok(lintIds(sw).includes('az-swap'));
  assert.deepEqual(ok('0 0 9 1-7 * 1', 'azure').dow.special, { type: 'nth', dow: 1, n: 1 });
  assert.equal(E.render(ok('0 0 9 ? * 2#3', 'quartz'), 'azure').lines[0], '0 0 9 15-21 * 1');
  bad('0 0 9 * * 7', 'azure', /0–6/);
  bad('0 0 9 L * *', 'azure', /doesn't support/);
  assert.equal(E.lint(ok('0 0 9 * * *', 'azure'), 'Europe/Berlin', NOW).find(l => l.id === 'az-timezone').level, 'warn');
  assert.equal(ok('[TimerTrigger("0 */5 * * * *")] TimerInfo t', 'azure').minutes.length, 12);
  assert.equal(ok('{"bindings":[{"type":"timerTrigger","name":"t","schedule":"0 30 9 * * 1-5"}]}', 'azure').hours[0], 9);
  assert.equal(ok('WEBSITE_TIME_ZONE=Europe/Paris\n0 30 9 * * *', 'azure').tz, 'Europe/Paris');
  const win = ok('WEBSITE_TIME_ZONE=Eastern Standard Time\n0 30 9 * * *', 'azure');
  assert.equal(win.tz, null);
  assert.match(win.notes.join(' '), /isn't a tz database name/);
});

test('APScheduler: keyword arguments, defaults and from_crontab()', () => {
  // The examples from APScheduler's cron trigger docs
  const third = ok("sched.add_job(job_function, 'cron', month='6-8,11-12', day='3rd fri', hour='0-3')", 'apscheduler');
  assert.deepEqual(third.months, [6, 7, 8, 11, 12]);
  assert.deepEqual(third.hours, [0, 1, 2, 3]);
  assert.deepEqual(third.dow.special, { type: 'nth', dow: 5, n: 3 });
  const early = ok("sched.add_job(job_function, 'cron', day_of_week='mon-fri', hour=5, minute=30, end_date='2014-05-30')", 'apscheduler');
  assert.deepEqual([early.dow.list, early.times], [[1, 2, 3, 4, 5], [5 * 3600 + 30 * 60]]);
  const lastSun = ok("@sched.scheduled_job('cron', id='my_job_id', day='last sun')", 'apscheduler');
  assert.deepEqual([lastSun.dow.special, lastSun.times], [{ type: 'lastDow', dow: 0 }, [0]]);
  // "day=1, minute=20 … at 20 minutes of every hour" on the 1st
  const gap = ok('CronTrigger(day=1, minute=20)', 'apscheduler');
  assert.equal(gap.times.length, 24);
  assert.ok(lintIds(gap).includes('aps-gap'));
  sameSchedule(ok("CronTrigger.from_crontab('0 0 1-15 may-aug *')", 'apscheduler'), ok('0 0 1-15 5-8 *', 'unix'), 'from_crontab');
  // from_crontab keeps APScheduler's Monday = 0
  const fc = ok("CronTrigger.from_crontab('0 9 * * 1-5')", 'apscheduler');
  assert.deepEqual(fc.dow.list, [2, 3, 4, 5, 6]);
  const warn = E.lint(fc, 'UTC', NOW).find(l => l.id === 'aps-crontab-dow');
  assert.equal(warn.fix.expr, "CronTrigger.from_crontab('0 9 * * mon-fri')");
  assert.equal(ok("CronTrigger(hour=9, timezone='Europe/Berlin')", 'apscheduler').tz, 'Europe/Berlin');
  // Rendering writes only what differs from APScheduler's defaults.
  const r = x => E.render(ok(x, 'unix'), 'apscheduler').lines.join(' | ');
  assert.equal(r('30 9 * * 1-5'), "day_of_week='mon-fri', hour=9, minute=30");
  assert.equal(r('0 0 * * *'), 'hour=0');
  assert.equal(r('* * * * *'), "minute='*'");
  assert.equal(r('0 * * * *'), 'minute=0');
  assert.equal(r('0 0 1 1 *'), 'month=1');
  assert.equal(r('0 9 1 * 1'), "day=1, hour=9 | day_of_week='mon', hour=9");
  bad('CronTrigger(hour=9, week=2)', 'apscheduler', /ISO week/);
  bad("CronTrigger(hour='*/24')", 'apscheduler', /step value \(24\)/);
  bad("CronTrigger(day_of_week='sun-mon')", 'apscheduler', /minimum value in a range/);
  assert.deepEqual(bad("CronTrigger(day='1st mon,3rd mon', hour=9)", 'apscheduler').error.fix.exprs,
    ["CronTrigger(day='1st mon', hour=9)", "CronTrigger(day='3rd mon', hour=9)"]);
  // Documented: in Europe/Helsinki, hour=3, minute=30 doesn't run on the last Sunday of March and runs twice on the last Sunday of October.
  const hel = ok('CronTrigger(hour=3, minute=30)', 'apscheduler');
  assert.deepEqual(E.dstPolicy(hel), { gap: 'skip', overlap: 'twice' });
  const spring = E.upcoming(hel, 'Europe/Helsinki', Date.UTC(2027, 2, 27, 12), 2).runs;
  assert.equal(spring[0].kind, 'skipped');
  const autumn = E.upcoming(hel, 'Europe/Helsinki', Date.UTC(2027, 9, 30, 12), 2).runs;
  assert.deepEqual(autumn.map(x => x.kind), ['run', 'repeat']);
});

test('one week of dates ANDed with a weekday translates as the nth weekday everywhere', () => {
  for (const [x, d] of [['0 0 9 1-7 * MON', 'spring'], ['0 0 9 1-7 * 1', 'azure'], ['Mon *-*-01..07 09:00', 'systemd'], ['0 9 1-7& * 1', 'gitlab']]) {
    const P = ok(x, d);
    assert.deepEqual(P.dow.special, { type: 'nth', dow: 1, n: 1 }, x);
    assert.equal(E.render(P, 'quartz').lines[0], '0 0 9 ? * 2#1', x);
  }
  assert.deepEqual(ok('0 0 9 29-31 * FRI', 'spring').dow.special, { type: 'nth', dow: 5, n: 5 });
  assert.equal(ok('0 0 9 1-8 * MON', 'spring').dayMode, 'and');
});
