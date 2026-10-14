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
  // Spring always ANDs
  assert.equal(ok('0 0 0 1-7 * MON', 'spring').dayMode, 'and');
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
