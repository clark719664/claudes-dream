// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../src/engine.js');
const F = require('../src/fleet.js');

const NOW = Date.UTC(2026, 9, 14, 16);
const read = (text, opts) => F.parseJobs(text, opts || {});
const summary = p => p.jobs.map(j => [j.dialect, j.name, j.schedule, j.zone, j.disabled]);

test('reads a crontab: comments name jobs, CRON_TZ sets the zone, commands stay out of the schedule', () => {
  const p = read(F.EXAMPLE);
  assert.equal(p.format, 'crontab');
  assert.equal(p.jobs.length, 9);
  assert.deepEqual(summary(p)[0], ['unix', 'Nightly database backup', '0 0 * * *', 'America/New_York', false]);
  assert.equal(p.jobs[0].P.command, '/opt/scripts/db-backup.sh');
  // /etc/crontab: a user field before the command, names from the program that runs
  const sys = read('SHELL=/bin/sh\n# m h dom mon dow user  command\n17 *\t* * *\troot    cd / && run-parts --report /etc/cron.hourly\n');
  assert.equal(sys.jobs[0].name, 'run-parts --report /etc/cron.hourly');
  assert.equal(F.shortCommand('/usr/local/bin/backup.sh --full > /var/log/backup.log 2>&1'), 'backup.sh --full');
});

test('reads Kubernetes manifests and kubectl JSON', () => {
  const yaml = read('apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: hello\n  labels:\n    app.kubernetes.io/name: x\nspec:\n  schedule: "*/5 * * * *"\n  timeZone: "Europe/Berlin"\n  jobTemplate:\n    spec:\n      template:\n        spec:\n          containers:\n          - name: hello\n---\napiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: nightly\nspec:\n  schedule: \'0 0 * * *\'\n  suspend: true\n');
  assert.deepEqual(summary(yaml), [['k8s', 'hello', '*/5 * * * *', 'Europe/Berlin', false], ['k8s', 'nightly', '0 0 * * *', null, true]]);
  const json = read(JSON.stringify({ kind: 'List', items: [{ kind: 'CronJob', metadata: { name: 'report' }, spec: { schedule: '0 9 * * 1-5', timeZone: 'Asia/Tokyo' } }] }));
  assert.deepEqual(summary(json), [['k8s', 'report', '0 9 * * 1-5', 'Asia/Tokyo', false]]);
});

test('reads GitHub workflows, systemd timers and Wrangler configs', () => {
  const gh = read("name: Nightly build\non:\n  schedule:\n    - cron: '0 0 * * *'\n    - cron: '30 5 * * 1-5'\n      timezone: \"Asia/Tokyo\"\njobs: {}\n");
  assert.deepEqual(summary(gh), [['github', 'Nightly build (1)', '0 0 * * *', null, false], ['github', 'Nightly build (2)', '30 5 * * 1-5', 'Asia/Tokyo', false]]);
  const sd = read('# /etc/systemd/system/backup.timer\n[Unit]\nDescription=Nightly backup\n\n[Timer]\nOnCalendar=daily\nOnCalendar=\nOnCalendar=Mon..Fri 01:30 Europe/Berlin\n');
  assert.deepEqual(summary(sd), [['systemd', 'backup', 'Mon..Fri 01:30 Europe/Berlin', null, false]]);
  assert.equal(sd.jobs[0].P.tz, 'Europe/Berlin');
  const cf = read('[triggers]\ncrons = ["*/30 * * * *", "59 23 LW * *"]\n');
  assert.deepEqual(cf.jobs.map(j => [j.dialect, j.schedule]), [['cloudflare', '*/30 * * * *'], ['cloudflare', '59 23 LW * *']]);
});

test('reads GitLab and EventBridge JSON', () => {
  const gl = read(JSON.stringify([{ id: 12, description: 'Nightly', cron: '0 1 * * *', cron_timezone: 'UTC', active: true }, { id: 13, description: 'Weekly', cron: '0 2 * * 0', cron_timezone: 'Europe/Paris', active: false }]));
  assert.deepEqual(summary(gl), [['gitlab', 'Nightly', '0 1 * * *', 'UTC', false], ['gitlab', 'Weekly', '0 2 * * 0', 'Europe/Paris', true]]);
  const eb = read(JSON.stringify({ Rules: [{ Name: 'nightly', ScheduleExpression: 'cron(0 3 * * ? *)', State: 'ENABLED' }, { Name: 'often', ScheduleExpression: 'rate(5 minutes)' }] }));
  assert.deepEqual(summary(eb), [['eventbridge', 'nightly', 'cron(0 3 * * ? *)', 'UTC', false]]);
  assert.match(eb.notes[0], /rate\(5 minutes\)/);
});

test('reads Spring, Quartz, Azure and APScheduler code', () => {
  const spring = read('@Scheduled(cron = "0 0 9 * * MON-FRI", zone = "Europe/Berlin")\npublic void sendReport() {}\n\n@Scheduled(fixedRate = 5000)\nvoid ping() {}\n\n@Scheduled(cron = "0 */15 * * * *")\nvoid refresh() {}');
  assert.deepEqual(summary(spring), [['spring', 'sendReport', '0 0 9 * * MON-FRI', 'Europe/Berlin', false], ['spring', 'refresh', '0 */15 * * * *', null, false]]);
  const quartz = read('TriggerBuilder.newTrigger().withIdentity("nightly", "g").withSchedule(CronScheduleBuilder.cronSchedule("0 0 1 * * ?").inTimeZone(TimeZone.getTimeZone("UTC")))');
  assert.deepEqual(summary(quartz), [['quartz', 'nightly', '0 0 1 * * ?', 'UTC', false]]);
  const azure = read('[Function("Cleanup")]\npublic void Run([TimerTrigger("0 30 2 * * *")] TimerInfo t) {}');
  assert.deepEqual(summary(azure), [['azure', 'Cleanup', '0 30 2 * * *', null, false]]);
  const aps = read("scheduler.add_job(send_report, 'cron', day_of_week='mon-fri', hour=8, minute=45)\nscheduler.add_job(poll, 'interval', minutes=5)\n@sched.scheduled_job('cron', day='last sun')\ndef monthly():\n    pass\n");
  assert.deepEqual(aps.jobs.map(j => [j.name, j.schedule]), [['send_report', 'day_of_week=mon-fri, hour=8, minute=45'], ['monthly', 'day=last sun']]);
  assert.match(aps.notes[0], /interval/);
});

test('plain lines in another dialect, with # labels', () => {
  const p = read('0 0 9 ? * MON-FRI  # report\n0 0/15 * * * ?  # poll\n', { dialect: 'quartz' });
  assert.deepEqual(p.jobs.map(j => [j.name, j.schedule, j.P.ok]), [['report', '0 0 9 ? * MON-FRI', true], ['poll', '0 0/15 * * * ?', true]]);
});

test('each job runs in its own scheduler\'s zone', () => {
  const p = read("name: ci\non:\n  schedule:\n    - cron: '0 9 * * *'\n");
  assert.equal(F.jobZone(p.jobs[0], 'Europe/Berlin'), 'UTC'); // GitHub without timezone:
  const k = read('kind: CronJob\nmetadata:\n  name: a\nspec:\n  schedule: "0 9 * * *"\n');
  assert.equal(F.jobZone(k.jobs[0], 'Europe/Berlin'), 'Europe/Berlin'); // the controller's zone
  // A UTC job shows up an hour or two later on a Berlin chart.
  const a = F.analyze(p.jobs, { tz: 'Europe/Berlin', now: NOW });
  const lit = a.heat.map((c, k) => (c.runs ? k % 24 : -1)).filter(h => h >= 0);
  assert.ok(lit.every(h => h === 11 || h === 10), `hours ${lit}`);
});

test('pile-ups, frequent jobs and clock changes in the example', () => {
  const p = read(F.EXAMPLE);
  const a = F.analyze(p.jobs, { tz: 'America/New_York', now: NOW });
  assert.equal(a.collisions[0].time, '00:00');
  assert.equal(a.collisions[0].max, 5);
  assert.equal(a.totals.frequent, 1);
  assert.equal(a.rows[0].weekRuns, 7);
  assert.equal(a.heat.reduce((s, c) => s + c.runs, 0), a.totals.weekRuns);
  assert.ok(a.rows.find(r => r.job.name === 'Renew certificates').dst);
  assert.equal(a.busiest.runs, 5);
});

test('the staggered rewrite keeps commands and breaks the pile-ups up', () => {
  const p = read(F.EXAMPLE);
  const a = F.analyze(p.jobs, { tz: 'America/New_York', now: NOW });
  const plan = F.spread(p.jobs, a);
  const moves = plan.flatMap(g => g.moves);
  assert.ok(moves.length >= 3);
  const text = F.rewrite(F.EXAMPLE, p.jobs, plan);
  assert.ok(text.includes('/usr/sbin/logrotate /etc/logrotate.conf'));
  const q = read(text);
  assert.equal(q.jobs.length, 9);
  assert.ok(q.jobs.every(j => j.P.ok));
  const b = F.analyze(q.jobs, { tz: 'America/New_York', now: NOW });
  assert.ok(!b.collisions.length || b.collisions[0].max < a.collisions[0].max);
  // Moves happen in the job's own syntax, inside YAML too.
  const gh = "name: a\non:\n  schedule:\n    - cron: '0 0 * * *'\n---\nname: b\non:\n  schedule:\n    - cron: '0 0 * * *'\n";
  const g = read(gh);
  const ga = F.analyze(g.jobs, { tz: 'UTC', now: NOW });
  const gp = F.spread(g.jobs, ga);
  const out = F.rewrite(gh, g.jobs, gp);
  assert.match(out, /- cron: '\d+ 0 \* \* \*'\n---/);
  assert.equal(read(out).jobs.filter(j => j.schedule === '0 0 * * *').length, 1);
});
