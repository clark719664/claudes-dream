/*
 * Cron Almanac: "Why didn't it run?"
 * Given a schedule and the moment someone expected a run, explains field by field whether the
 * schedule fires then, what a clock change did to it, whether reading it in another time zone
 * would explain the surprise, the nearest real runs, and what else to check on that scheduler.
 * Pure functions over the engine; no DOM.
 */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./engine.js') : root.CronEngine);
  if (node) module.exports = api;
  else root.CronWhy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';

  const DAY = E.DAY;
  const pad2 = E.pad2;

  /** Instants at which a wall-clock time happens in tz: none when a clock change skips it, two when it repeats. */
  function instantsOf(w, tz) {
    const W0 = Date.UTC(w.y, w.mo - 1, w.d);
    const wall = W0 + ((w.h * 60 + w.mi) * 60 + (w.s || 0)) * 1000;
    const segs = E.daySegments(tz, W0);
    const ts = E.wallInstants(wall, segs);
    return { ts, gap: ts.length ? null : E.gapBoundary(wall, segs) };
  }

  /** A model's runs on one local day, including entries for times a clock change skips. */
  function runsOnDay(M, tz, y, m, d) {
    if (M.reboot || !E.dayMatches(M, y, m, d)) return [];
    const W0 = Date.UTC(y, m - 1, d);
    const segs = E.daySegments(tz, W0);
    const out = [];
    for (const sec of M.times) {
      const ts = E.wallInstants(W0 + sec * 1000, segs);
      if (!ts.length) {
        const tr = E.gapBoundary(W0 + sec * 1000, segs);
        if (tr) out.push({ t: tr.t, y, m, d, sec, kind: 'skipped', tr });
      } else ts.forEach((t, k) => out.push({ t, y, m, d, sec, kind: k ? 'repeat' : 'run' }));
    }
    return out.sort((a, b) => a.t - b.t);
  }

  /** The last run of any of the models strictly before `before`, searching back up to 30 years. */
  function previousRun(models, tz, before) {
    const w = E.wallParts(before, tz);
    let best = null;
    models.forEach((M, i) => {
      if (M.reboot || !M.times.length) return;
      const floor = Math.max(1970, M.years ? Math.min(...M.years) : w.y - 30);
      let day = Date.UTC(w.y, w.mo - 1, w.d) + DAY;
      for (;;) {
        const dt = new Date(day);
        const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
        if (y < floor || (best && day + 2 * DAY < best.t)) break;
        if (M.yearSet && !M.yearSet.has(y)) { day = Date.UTC(y, 0, 1) - DAY; continue; }
        if (!M.monthHas[m]) { day = Date.UTC(y, m - 1, 1) - DAY; continue; }
        const runs = runsOnDay(M, tz, y, m, d).filter(r => r.kind !== 'skipped' && r.t < before);
        if (runs.length) {
          const r = runs[runs.length - 1];
          if (!best || r.t > best.t) best = Object.assign(r, { which: [i] });
          else if (r.t === best.t) best.which.push(i);
          break;
        }
        day -= DAY;
      }
    });
    return best;
  }

  function nextRun(models, tz, after) {
    const up = E.upcomingSet(models, tz, after, 8).runs;
    return up.find(r => r.kind !== 'skipped') || null;
  }

  // ------------------------------------------------------------ field by field

  function listPhrase(vals, size, fmt) {
    if (vals.length === size) return null;
    const runs = E.runsOf(vals);
    if (runs.length > 4) return `${vals.slice(0, 4).map(fmt).join(', ')} …`;
    return E.joinList(runs.map(([a, b]) => (a === b ? fmt(a) : b === a + 1 ? `${fmt(a)}, ${fmt(b)}` : `${fmt(a)}–${fmt(b)}`)));
  }

  /** Rows describing each field at wall time w: { field, value, wants, ok }. */
  function fieldRows(M, w) {
    const wd = E.weekday(w.y, w.mo, w.d), dim = E.daysInMonth(w.y, w.mo);
    const domOk = E.domMatch(M.dom, w.y, w.mo, w.d, dim);
    const dowOk = E.dowMatch(M.dow, w.d, dim, wd);
    let dayOk = true, wants = 'any day';
    switch (M.dayMode) {
      case 'dom': dayOk = domOk; wants = E.domPhrase(M.dom); break;
      case 'dow': dayOk = dowOk; wants = E.dowPhrase(M.dow); break;
      case 'or': dayOk = domOk || dowOk; wants = `${E.domPhrase(M.dom)}, or ${E.dowPhrase(M.dow)} (either is enough)`; break;
      case 'and': dayOk = domOk && dowOk; wants = `${E.dowPhrase(M.dow)} that are also ${E.domPhrase(M.dom)}`; break;
    }
    const rows = [];
    if (M.years) rows.push({ field: 'Year', value: String(w.y), wants: E.yearPhrase(M).replace(/^in /, ''), ok: M.yearSet.has(w.y) });
    rows.push({ field: 'Month', value: E.MON_LONG[w.mo - 1], wants: listPhrase(M.months, 12, m => E.MON_LONG[m - 1]) || 'every month', ok: !!M.monthHas[w.mo] });
    rows.push({ field: 'Day', value: `${E.DOW_LONG[wd]} the ${E.ordinal(w.d)}`, wants, ok: dayOk });
    rows.push({ field: 'Hour', value: pad2(w.h), wants: listPhrase(M.hours, 24, pad2) || 'every hour', ok: M.hours.includes(w.h) });
    rows.push({ field: 'Minute', value: ':' + pad2(w.mi), wants: listPhrase(M.minutes, 60, v => ':' + pad2(v)) || 'every minute', ok: M.minutes.includes(w.mi) });
    if (M.seconds.length !== 1 || M.seconds[0] !== 0) {
      rows.push({ field: 'Second', value: 'any', wants: listPhrase(M.seconds, 60, v => ':' + pad2(v)) || 'every second', ok: true, info: true });
    }
    return rows;
  }

  /** One sentence on why model M doesn't fire at wall time w (rows from fieldRows). */
  function reasonFor(M, rows, w) {
    const bad = rows.filter(r => !r.ok);
    if (!bad.length) return '';
    const day = bad.find(r => r.field === 'Day');
    if (day) return `it runs on ${day.wants}, and this is ${day.value}`;
    const cal = bad.find(r => r.field === 'Month' || r.field === 'Year');
    if (cal) return `it runs in ${cal.wants}, and this is ${cal.value}`;
    return `it runs ${E.timePhrase(M)}, and this is ${pad2(w.h)}:${pad2(w.mi)}`;
  }

  // ------------------------------------------------------------ what each scheduler does with a clock change

  function dstText(P, kind, tr, D) {
    const pol = E.dstPolicy(P);
    const name = D.name;
    const from = E.fmtClock(Math.round(((tr.t + tr.before) % DAY + DAY) % DAY / 1000));
    const to = E.fmtClock(Math.round(((tr.t + tr.after) % DAY + DAY) % DAY / 1000));
    if (kind === 'gap') {
      const head = `Clocks jumped from ${from} to ${to} that night, so this time didn't exist.`;
      if (pol.gap === 'after') return { scheduled: true, text: `${head} ${name} runs a skipped time right after the jump, at ${to}.` };
      if (pol.gap === 'skip') return { scheduled: false, text: `${head} ${name} skips it, so **there was no run**.` };
      return { scheduled: null, text: `${head} ${name}'s documentation doesn't say whether it skips the run or runs it after the jump.` };
    }
    const head = `Clocks fell back from ${from} to ${to} that night, so this time happened twice.`;
    if (pol.overlap === 'once') return { scheduled: true, text: `${head} ${name} runs it only the first time.` };
    if (pol.overlap === 'twice') return { scheduled: true, text: `${head} ${name} runs it both times.` };
    return { scheduled: true, text: `${head} ${name}'s documentation doesn't say whether it runs once or twice.` };
  }

  // ------------------------------------------------------------ what else to check

  const CHECKLIST = {
    unix: P => [
      ['Was cron running, and the machine on?', 'cron doesn’t catch up on runs it missed while stopped or switched off (anacron does, for daily jobs and longer). The log shows what it started: `grep CRON /var/log/syslog` on Debian and Ubuntu, `journalctl -u crond` on Fedora and RHEL.'],
      ['Is the job in the crontab you think?', '`crontab -l` lists the current user’s jobs; root’s crontab and `/etc/cron.d/` are separate. Files in `/etc/cron.d/` need a user field, a name without dots, and a newline at the end.'],
      ['Did it start but fail?', 'cron runs jobs with a bare environment (`PATH=/usr/bin:/bin`, no shell profile), so use full paths. Output is mailed or lost; capture it with `>> /tmp/my-job.log 2>&1`.'],
      ['Is there a `%` in the command?', 'An unescaped `%` ends the command and turns the rest into its input. Write `\\%`.'],
      ['Which time zone does cron use?', 'The system’s (`timedatectl`). `CRON_TZ=` only works in cronie.'],
    ],
    systemd: () => [
      ['Is the timer enabled and started?', '`systemctl list-timers --all` shows its last and next run. Start it with `systemctl enable --now my-job.timer`.'],
      ['Did the service fail?', '`systemctl status my-job.service` shows the last result and `journalctl -u my-job.service` its output.'],
      ['Was the machine off or asleep?', 'With the default `Persistent=false` a missed run is skipped. `Persistent=true` runs it at the next boot.'],
      ['Up to a minute late is normal', '`AccuracySec=` defaults to 1 minute so wake-ups can be batched. Set `AccuracySec=1s` if the exact second matters.'],
      ['Which time zone?', 'Without a zone at the end of `OnCalendar=`, the system’s (`timedatectl`).'],
    ],
    github: P => [
      ['Is the workflow on the default branch?', 'Scheduled workflows run only from the latest commit on the default branch.'],
      ['Did GitHub disable the schedule?', 'In public repositories, scheduled workflows are disabled after 60 days without repository activity. Re-enable it on the workflow’s page in the Actions tab.'],
      ['Busy times delay or drop runs', `Scheduled runs can start late when GitHub Actions is busy, especially at the top of the hour, and some queued runs can be dropped.${P.minutes.includes(0) ? ' This schedule runs at minute 0, the busiest time; an off-peak minute is more reliable.' : ''}`],
      ['Which time zone?', 'UTC, unless the schedule has a `timezone:` key.'],
      ['Where to look', 'The Actions tab, filtered by event `schedule`.'],
    ],
    gitlab: () => [
      ['Is the schedule active?', 'A pipeline schedule turns Inactive when its owner is blocked or removed from the project. Take ownership of it to reactivate it.'],
      ['Do the jobs run in scheduled pipelines?', '`rules:` (or `only`/`except`) can leave jobs out when `$CI_PIPELINE_SOURCE` is `"schedule"`.'],
      ['A few minutes late is normal', 'Scheduled pipelines start when GitLab’s pipeline schedule worker next runs (every 10 minutes by default on self-managed GitLab), and later when many schedules are due together.'],
      ['Which time zone?', 'The schedule’s own Cron timezone setting.'],
      ['Where to look', 'Build › Pipeline schedules lists each schedule’s last pipeline and its status.'],
    ],
    k8s: () => [
      ['Is the CronJob suspended?', '`kubectl get cronjob my-job` shows SUSPEND. With `.spec.suspend: true` no new Jobs start.'],
      ['Was the previous Job still running?', 'With `concurrencyPolicy: Forbid`, a run is skipped while the previous one is still going.'],
      ['Too many missed start times?', 'If the controller missed more than 100 start times since the last one it counted, it stops starting Jobs and logs “too many missed start times”. Setting `.spec.startingDeadlineSeconds` limits how far back it counts; a value under 10 seconds can skip runs.'],
      ['Which time zone?', '`.spec.timeZone` if set, otherwise the kube-controller-manager’s local zone.'],
      ['Where to look', '`kubectl describe cronjob my-job` shows recent events and the last schedule time.'],
    ],
    eventbridge: () => [
      ['Is the rule or schedule enabled?', 'Check its state in the console or with the CLI.'],
      ['Which time zone?', 'Rules always use UTC; EventBridge Scheduler uses the schedule’s time zone.'],
      ['Could it reach the target?', 'The target’s IAM role needs permission to invoke it. The rule’s or schedule’s CloudWatch metrics show invocations and failures.'],
      ['Flexible time window', 'A Scheduler schedule with a flexible time window can run any time within that window after the scheduled time.'],
    ],
    cloudflare: () => [
      ['Was the change live yet?', 'New or changed Cron Triggers can take up to 15 minutes to reach Cloudflare’s network.'],
      ['Which time zone?', 'Always UTC.'],
      ['Where to look', 'The Worker’s past Cron Trigger events (the last 100 runs) and Workers Logs. A new Worker’s events can take up to 30 minutes to show.'],
    ],
    azure: () => [
      ['Which time zone?', 'UTC unless the app setting `WEBSITE_TIME_ZONE` is set. It isn’t supported on Linux Consumption or Flex Consumption plans.'],
      ['Was the previous run still going?', 'Azure runs one instance of a timer function at a time and doesn’t start a run while the previous one is still running.'],
      ['Was the app restarting?', 'A restart can make a run late or missed. A late invocation has `isPastDue` set.'],
      ['Where to look', 'The function’s Monitor tab or Application Insights lists invocations and errors.'],
    ],
    quartz: () => [
      ['Did the trigger misfire?', 'If Quartz couldn’t fire within `org.quartz.jobStore.misfireThreshold` (60 seconds by default), the trigger’s misfire instruction decides. For a CronTrigger the default fires once as soon as possible.'],
      ['Is the scheduler started and the trigger not paused?', 'Check `scheduler.isStarted()` and `scheduler.getTriggerState(triggerKey)`.'],
      ['Were all worker threads busy?', 'When the thread pool is full, runs wait and can misfire.'],
      ['Which time zone?', '`inTimeZone()` on the schedule, otherwise the JVM default.'],
    ],
    spring: () => [
      ['Is scheduling enabled?', '`@EnableScheduling` must be on a configuration class, and the method must be on a Spring-managed bean.'],
      ['One thread by default', 'Spring Boot’s scheduler has a single thread (`spring.task.scheduling.pool.size=1`), so one slow task holds up every other `@Scheduled` method.'],
      ['Which time zone?', 'The `zone` attribute, otherwise the JVM default.'],
      ['Where to look', 'Exceptions from a scheduled method are logged; the schedule carries on.'],
    ],
    apscheduler: P => {
      const grace = (P.apsOptions && P.apsOptions.misfire_grace_time) || '1';
      return [
        ['Was the scheduler running?', 'The scheduler must be started, and a `BackgroundScheduler` stops when your program exits.'],
        ['Was the run too late?', `A run that can't start within \`misfire_grace_time\` (${grace} s${grace === '1' ? ', the default' : ''}) is skipped, and the log says “Run time of job … was missed by …”.`],
        ['Was the previous run still going?', 'With `max_instances=1` (the default) a run is skipped while the previous one runs: “maximum number of running instances reached”.'],
        ['Which time zone?', 'The trigger’s `timezone=`, otherwise the scheduler’s, which defaults to the machine’s.'],
      ];
    },
  };

  /**
   * Explain a moment. opts: { P, models, tz, wall: { y, mo, d, h, mi }, zone }
   *   P       the main parsed expression (dialect, options)
   *   models  the schedules that run the job (P alone, or several)
   *   tz      the zone the schedules run in
   *   wall    the expected time, read in `zone`
   */
  function explain(opts) {
    const { P, models, tz } = opts;
    if (!P || !P.ok || P.reboot || !models.length) return null;
    const D = E.DIALECTS[P.dialect];
    const zone = opts.zone || tz;
    const w0 = Object.assign({ s: 0 }, opts.wall);
    const out = { tz, zone, notes: [], hints: [] };

    // 1. The moment itself, in the zone it was given in.
    const at = instantsOf(w0, zone);
    let t;
    if (at.gap) {
      t = at.gap.t;
      if (zone !== tz) out.notes.push(`${pad2(w0.h)}:${pad2(w0.mi)} didn't exist in ${zone} that day, because clocks jumped forward; using the moment of the jump.`);
    } else {
      t = at.ts[0];
      if (at.ts.length > 1 && zone !== tz) out.notes.push(`${pad2(w0.h)}:${pad2(w0.mi)} happened twice in ${zone} that day, because clocks fell back; using the first time.`);
    }
    out.t = t;
    // 2. The same moment on the schedule's clock.
    const sw = zone === tz ? w0 : E.wallParts(t, tz);
    out.wall = sw;
    if (zone !== tz) out.notes.push(`That is ${E.DOW_LONG[E.weekday(sw.y, sw.mo, sw.d)]} ${sw.d} ${E.MON_LONG[sw.mo - 1]} at ${pad2(sw.h)}:${pad2(sw.mi)} in ${tz}, the schedule's time zone.`);

    // 3. Field by field, for each schedule.
    out.schedules = models.map((M, i) => {
      const rows = fieldRows(M, sw);
      const match = rows.every(r => r.ok);
      return { i, rows, match, reason: match ? '' : reasonFor(M, rows, sw) };
    });
    const hits = out.schedules.filter(x => x.match);
    out.which = hits.map(x => x.i);

    // 4. A clock change on the schedule's side.
    let scheduled = hits.length > 0;
    if (scheduled) {
      const local = instantsOf(sw, tz);
      if (local.gap) {
        const d = dstText(models[hits[0].i], 'gap', local.gap, D);
        out.dst = d.text;
        if (d.scheduled === false) scheduled = false;
        if (d.scheduled === null) out.uncertain = true;
      } else if (local.ts.length > 1) {
        const tr = E.transitionsBetween(tz, local.ts[0], local.ts[1] + 1)[0];
        if (tr) out.dst = dstText(models[hits[0].i], 'overlap', tr, D).text;
      }
    }
    out.scheduled = scheduled;

    // 5. Would another time zone explain it?
    if (!hits.length) {
      const zones = [...new Set(['UTC', opts.localTz, zone].filter(z => z && z !== tz))];
      for (const z of zones) {
        const wz = E.wallParts(t, z);
        const m = models.findIndex(M => fieldRows(M, wz).every(r => r.ok));
        if (m < 0) continue;
        const how = ZONE_SETTING[P.dialect];
        out.hints.push(z === 'UTC'
          ? `It would have run at this moment if the schedule were read in **UTC**. ${UTC_DEFAULT[P.dialect] || 'Check which time zone the scheduler really uses.'}`
          : `It would have run at this moment if the schedule were read in **${z}** (${pad2(wz.h)}:${pad2(wz.mi)} there).${how ? ` To run it on ${z} time, ${how(z)}.` : ''}`);
      }
    }

    // 6. The nearest real runs.
    out.prev = previousRun(models, tz, scheduled ? t : t + 1);
    out.next = nextRun(models, tz, t);

    // 7. Headline.
    const when = `${E.DOW_LONG[E.weekday(sw.y, sw.mo, sw.d)].slice(0, 3)} ${sw.d} ${E.MON_SHORT[sw.mo - 1]} ${sw.y} at ${pad2(sw.h)}:${pad2(sw.mi)}`;
    if (scheduled) {
      out.headline = out.uncertain
        ? `**Maybe.** ${when} (${tz}) is a run time, but a clock change makes it uncertain.`
        : `**Scheduled.** ${when} (${tz}) is a run time${models.length > 1 ? ` for schedule ${E.joinList(out.which.map(i => String(i + 1)))}` : ''}. If nothing ran, the cause is outside the expression; see below.`;
    } else if (hits.length) {
      out.headline = `**No run.** ${when} (${tz}) didn't exist, and ${D.name} skips such times.`;
    } else if (models.length === 1) {
      out.headline = `**Not scheduled** for ${when} (${tz}): ${out.schedules[0].reason}.`;
    } else {
      out.headline = `**Not scheduled** for ${when} (${tz}): none of the ${models.length} schedules runs then.`;
    }
    out.checklist = (CHECKLIST[P.dialect] || (() => []))(P).map(([title, body]) => ({ title, body }));
    return out;
  }

  // How to make each scheduler use a given zone.
  const ZONE_SETTING = {
    unix: z => `use a server set to ${z}, or put \`CRON_TZ=${z}\` above the job (cronie only)`,
    systemd: z => `end the expression with \`${z}\``,
    github: z => `add \`timezone: "${z}"\` under the \`cron:\` line`,
    gitlab: z => `set the schedule's Cron timezone to ${z}`,
    k8s: z => `set \`.spec.timeZone: "${z}"\``,
    eventbridge: z => `use EventBridge Scheduler with \`--schedule-expression-timezone "${z}"\``,
    cloudflare: () => 'convert the times to UTC, since Cloudflare only runs in UTC (Translations shows how)',
    azure: z => `set the app setting \`WEBSITE_TIME_ZONE\` to ${z}`,
    quartz: z => `add \`.inTimeZone(TimeZone.getTimeZone("${z}"))\``,
    spring: z => `add \`zone = "${z}"\``,
    apscheduler: z => `pass \`timezone='${z}'\``,
  };

  // Why a scheduler might be reading the schedule in UTC.
  const UTC_DEFAULT = {
    github: 'GitHub reads schedules in UTC unless the workflow sets `timezone:`.',
    gitlab: 'Check the pipeline schedule’s Cron timezone setting.',
    k8s: 'Kubernetes uses the controller’s zone, often UTC, unless `.spec.timeZone` is set.',
    eventbridge: 'EventBridge rules always run in UTC.',
    azure: 'Azure Functions uses UTC unless `WEBSITE_TIME_ZONE` is set.',
    unix: 'Servers are often set to UTC; cron uses the system zone (`timedatectl`).',
    systemd: 'Servers are often set to UTC; systemd uses the system zone unless the expression ends with one.',
    quartz: 'Quartz uses the JVM’s default zone unless the schedule calls `inTimeZone()`.',
    spring: 'Spring uses the JVM’s default zone unless `zone` is set.',
    apscheduler: 'APScheduler uses the scheduler’s zone unless the trigger sets `timezone=`.',
  };

  return { explain, previousRun, nextRun, runsOnDay, instantsOf, CHECKLIST };
});
