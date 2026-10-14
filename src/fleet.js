/*
 * Cron Almanac: all your jobs at once.
 * Reads many schedules from one paste (a crontab, GitHub workflows, Kubernetes manifests or
 * kubectl output, systemd timers, a Wrangler config, GitLab or EventBridge JSON, Spring, Quartz,
 * Azure or APScheduler code, or a plain list) and shows how they run together: a week heatmap,
 * minutes where several jobs start at once, jobs that run very often or across clock changes,
 * and a staggered rewrite of the paste. Pure functions over the engine; no DOM.
 */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./engine.js') : root.CronEngine);
  if (node) module.exports = api;
  else root.CronFleet = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';

  const DAY = E.DAY, HOUR = 3600000, MINUTE = 60000;
  const pad2 = E.pad2;

  // Schedulers that read a schedule in UTC unless it says otherwise.
  const UTC_BY_DEFAULT = new Set(['github', 'gitlab', 'eventbridge', 'cloudflare', 'azure']);

  // A job that runs this often (seconds between runs) is "frequent": shown on its own, left out of pile-ups.
  const FREQUENT = 900;

  /** A short label for a crontab command: the program's name and first arguments, no redirections. */
  function shortCommand(cmd, userField) {
    let c = cmd.replace(/\s+(?:\d?>>?|&>|<)\s*\S+/g, '').replace(/\s+2>&1/g, '').trim();
    // /etc/crontab and /etc/cron.d lines carry a user name before the command.
    let parts = c.split(/\s+/);
    if (parts.length > 1 && (userField || parts[0] === 'root' || (/^[a-z_][a-z0-9_-]*$/.test(parts[0]) && /^[/~$.]/.test(parts[1])))) parts.shift();
    // In "cd / && run-parts …" or "test -x … || …", the last step names the job.
    const steps = parts.join(' ').split(/\s*(?:&&|\|\||;)\s*/).map(x => x.replace(/^[(\s]+|[)\s]+$/g, '')).filter(Boolean);
    parts = (steps.length > 1 ? steps[steps.length - 1] : parts.join(' ')).split(/\s+/);
    parts[0] = parts[0].replace(/^.*\//, '');
    c = parts.slice(0, 3).join(' ');
    return c.length > 40 ? c.slice(0, 39) + '…' : c;
  }

  const unquote = v => v.trim().replace(/^(['"])(.*)\1$/, '$2');

  /**
   * Find the jobs in pasted text. opts: { dialect } is how to read plain lines.
   * Returns { jobs: [{ name, expr, dialect, P, zone, line, disabled }], format, notes }.
   */
  function parseJobs(text, opts) {
    opts = opts || {};
    const plain = opts.dialect || 'unix';
    const src = String(text || '').replace(/\r\n?/g, '\n');
    const lines = src.split('\n');
    const jobs = [], notes = [];
    // A "# m h dom mon dow user command" header marks a system crontab with a user field.
    const userField = /^#.*\bdow\s+user\b/m.test(src);
    const add = (expr, dialect, info) => {
      const P = E.parse(expr, dialect);
      jobs.push(Object.assign({ expr: expr.trim(), dialect, P, name: '', zone: null, line: null, disabled: false }, info));
    };
    const lineOf = index => src.slice(0, index).split('\n').length;
    const finish = format => {
      // Name what has no name, and tell repeated names apart.
      const seen = new Map();
      jobs.forEach((j, k) => {
        // The schedule alone: no crontab command, and APScheduler's fields without the call around them.
        if (j.P.ok && j.P.command && j.P.tokens.length) j.schedule = j.expr.slice(0, j.P.tokens[j.P.tokens.length - 1].end).trim();
        else if (j.P.ok && j.dialect === 'apscheduler' && j.P.chips) j.schedule = j.P.chips.filter(c => !c.implied).map(c => `${c.label}=${c.token}`).join(', ') || j.expr;
        else j.schedule = j.expr;
        if (!j.name) j.name = j.P.ok && j.P.command ? shortCommand(j.P.command, userField) : j.line ? `line ${j.line}` : `job ${k + 1}`;
        seen.set(j.name, (seen.get(j.name) || 0) + 1);
      });
      const count = new Map();
      jobs.forEach(j => {
        if (seen.get(j.name) < 2) return;
        const n = (count.get(j.name) || 0) + 1;
        count.set(j.name, n);
        j.name = `${j.name} (${n})`;
      });
      return { jobs, format, notes };
    };
    if (!src.trim()) return finish(null);

    // JSON from an API or a CLI.
    const trimmed = src.trim();
    if (/^[[{]/.test(trimmed)) {
      let data = null;
      try { data = JSON.parse(trimmed); } catch (e) { data = null; }
      if (data) {
        const walk = o => {
          if (Array.isArray(o)) { o.forEach(walk); return; }
          if (!o || typeof o !== 'object') return;
          if (o.kind === 'CronJob' && o.spec && typeof o.spec.schedule === 'string') {
            add(o.spec.schedule, 'k8s', { name: o.metadata && o.metadata.name, zone: o.spec.timeZone || null, disabled: o.spec.suspend === true });
            return;
          }
          if (typeof o.cron === 'string') {
            add(o.cron, 'gitlab', { name: o.description || (o.id != null ? `schedule ${o.id}` : ''), zone: o.cron_timezone || 'UTC', disabled: o.active === false });
            return;
          }
          if (typeof o.ScheduleExpression === 'string') {
            if (/^\s*cron\(/i.test(o.ScheduleExpression)) {
              add(o.ScheduleExpression, 'eventbridge', { name: o.Name || '', zone: o.ScheduleExpressionTimezone || 'UTC', disabled: o.State === 'DISABLED' });
            } else notes.push(`Skipped \`${o.Name || o.ScheduleExpression}\`: \`${o.ScheduleExpression}\` is a rate or one-time schedule, not cron.`);
            return;
          }
          if (Array.isArray(o.bindings)) {
            for (const b of o.bindings) if (b && /^timerTrigger$/i.test(b.type) && typeof b.schedule === 'string') add(b.schedule, 'azure', { name: b.name || 'timer' });
            return;
          }
          if (o.triggers && Array.isArray(o.triggers.crons)) o.triggers.crons.forEach((c, k) => add(String(c), 'cloudflare', { name: `cron trigger ${k + 1}` }));
          Object.values(o).forEach(walk);
        };
        walk(data);
        if (jobs.length) return finish('json');
      }
    }

    // Kubernetes CronJob manifests, or `kubectl get cronjobs -o yaml`.
    if (/^\s*(?:-\s+)?kind:\s*["']?CronJob\b/m.test(src)) {
      let ctx = null;
      const flush = () => {
        if (ctx && ctx.schedule != null) add(ctx.schedule, 'k8s', { name: ctx.name || '', zone: ctx.tz || null, line: ctx.line, disabled: !!ctx.suspend });
        ctx = null;
      };
      lines.forEach((ln, i) => {
        let m;
        if (/^---\s*$/.test(ln)) { flush(); return; }
        if (/^\s*(?:-\s+)?kind:\s*["']?CronJob\b/.test(ln)) { flush(); ctx = { meta: null }; return; }
        if (!ctx) return;
        if ((m = /^(\s*)metadata:\s*$/.exec(ln))) { if (ctx.meta == null) ctx.meta = m[1].length; return; }
        if (ctx.meta != null && !ctx.name && (m = /^(\s*)name:\s*["']?([^"'\s#]+)/.exec(ln)) && m[1].length > ctx.meta) ctx.name = m[2];
        if ((m = /^\s*schedule:\s*(?:"([^"]*)"|'([^']*)'|([^#\n]*?))\s*(?:#.*)?$/.exec(ln))) { ctx.schedule = (m[1] ?? m[2] ?? m[3]).trim(); ctx.line = i + 1; }
        if ((m = /^\s*timeZone:\s*["']?([^"'\s#]+)/.exec(ln))) ctx.tz = m[1];
        if (/^\s*suspend:\s*true\b/.test(ln)) ctx.suspend = true;
      });
      flush();
      if (jobs.length) return finish('k8s');
    }

    // GitHub Actions workflows: `- cron:` lines, each with an optional `timezone:`.
    if (/^\s*-?\s*cron\s*:/m.test(src) && /^\s*schedule\s*:/m.test(src)) {
      let wf = null;
      lines.forEach((ln, i) => {
        let m;
        if ((m = /^name:\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/.exec(ln))) { wf = (m[1] ?? m[2] ?? m[3]).trim(); return; }
        if ((m = /^\s*-?\s*cron\s*:\s*(?:'([^'\n]*)'|"([^"\n]*)"|(\S[^\n#]*?))\s*(?:#.*)?$/.exec(ln))) {
          const info = { name: wf || 'workflow', line: i + 1 };
          for (let k = i + 1; k < lines.length && k <= i + 3; k++) {
            if (/^\s*-/.test(lines[k])) break;
            const z = /^\s*timezone\s*:\s*["']?([^"'\s#]+)/.exec(lines[k]);
            if (z) { info.zone = z[1]; break; }
          }
          add((m[1] ?? m[2] ?? m[3]).trim(), 'github', info);
        }
      });
      if (jobs.length) return finish('github');
    }

    // systemd timer units: every OnCalendar= line; an empty one clears the unit's earlier lines.
    if (/^\s*OnCalendar\s*=/m.test(src)) {
      let file = null, desc = null, unit = 0;
      lines.forEach((ln, i) => {
        let m;
        if ((m = /^\s*#.*?([\w@.-]+)\.timer\b/.exec(ln))) { file = m[1]; return; }
        if (/^\s*\[Unit\]\s*$/.test(ln)) { unit++; desc = null; return; }
        if ((m = /^\s*Description\s*=\s*(.+)$/.exec(ln))) { desc = m[1].trim(); return; }
        if ((m = /^\s*OnCalendar\s*=\s*(.*)$/.exec(ln))) {
          const v = m[1].trim();
          if (!v) { for (let k = jobs.length - 1; k >= 0 && jobs[k].unit === unit; k--) jobs.pop(); return; }
          add(v, 'systemd', { name: file || desc || '', line: i + 1, unit });
        }
      });
      if (jobs.length) return finish('systemd');
    }

    // Wrangler (Cloudflare Workers): crons = [ … ] or "crons": [ … ].
    if (/\bcrons['"]?\s*[=:]\s*\[/.test(src)) {
      for (const m of src.matchAll(/\bcrons['"]?\s*[=:]\s*\[([^\]]*)\]/g)) {
        for (const c of m[1].matchAll(/["']([^"']*)["']/g)) {
          add(c[1], 'cloudflare', { name: `cron trigger ${jobs.length + 1}`, line: lineOf(m.index + m[0].indexOf(c[0])) });
        }
      }
      if (jobs.length) return finish('cloudflare');
    }

    // Source code: Spring, Quartz, Azure Functions, APScheduler.
    if (/@Scheduled|cronSchedule|TimerTrigger|timer_trigger|\bapp\.timer\s*\(|add_job|scheduled_job/.test(src)) {
      for (const m of src.matchAll(/@Scheduled\s*\(([^)]*)\)/g)) {
        const cron = /cron\s*=\s*"([^"]*)"/.exec(m[1]);
        if (!cron) continue;
        const zone = /zone\s*=\s*"([^"]+)"/.exec(m[1]);
        const after = src.slice(m.index + m[0].length, m.index + m[0].length + 300);
        const fn = /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|protected|private|static|final|suspend)\s+)*[\w<>[\],.? ]*?\s(\w+)\s*\(/.exec(after) || /fun\s+(\w+)\s*\(/.exec(after);
        add(cron[1], 'spring', { name: fn ? fn[1] : '', zone: zone ? zone[1] : null, line: lineOf(m.index) });
      }
      for (const m of src.matchAll(/cronSchedule\s*\(\s*"([^"]*)"\s*\)/g)) {
        const before = src.slice(Math.max(0, m.index - 300), m.index);
        const ids = [...before.matchAll(/withIdentity\s*\(\s*"([^"]+)"/g)];
        const zone = /^\s*\.inTimeZone\s*\(\s*TimeZone\.getTimeZone\s*\(\s*"([^"]+)"/.exec(src.slice(m.index + m[0].length));
        add(m[1], 'quartz', { name: ids.length ? ids[ids.length - 1][1] : '', zone: zone ? zone[1] : null, line: lineOf(m.index) });
      }
      for (const m of src.matchAll(/TimerTrigger\s*\(\s*"([^"]*)"|@TimerTrigger\s*\([^)]*?\bschedule\s*=\s*"([^"]*)"|\.(?:timer_trigger|schedule)\s*\([^)]*?\bschedule\s*=\s*["']([^"']*)["']|\bapp\.timer\s*\(\s*['"]([^'"]+)['"][^)]*?\bschedule\s*:\s*['"]([^'"]*)['"]/g)) {
        const expr = m[1] ?? m[2] ?? m[3] ?? m[5];
        const before = src.slice(Math.max(0, m.index - 400), m.index);
        const after = src.slice(m.index, m.index + 600);
        const fnName = [...before.matchAll(/(?:\[Function\(\s*"([^"]+)"|@FunctionName\(\s*"([^"]+)")/g)].pop();
        const py = /\)\s*\n\s*(?:async\s+)?def\s+(\w+)/.exec(after);
        add(expr, 'azure', { name: m[4] || (fnName ? fnName[1] || fnName[2] : py ? py[1] : ''), line: lineOf(m.index) });
      }
      for (const m of src.matchAll(/\b(add_job|scheduled_job)\s*\(/g)) {
        const call = src.slice(m.index, E.closeParen(src, m.index + m[0].length - 1));
        if (!/['"]cron['"]|CronTrigger/.test(call)) {
          if (/['"](?:interval|date)['"]|IntervalTrigger|DateTrigger/.test(call)) notes.push(`Skipped an APScheduler ${/interval/i.test(call) ? 'interval' : 'one-time'} job; only cron jobs have a calendar.`);
          continue;
        }
        const id = /\b(?:id|name)\s*=\s*['"]([^'"]+)['"]/.exec(call);
        const first = m[1] === 'add_job' && /^add_job\s*\(\s*([\w.]+)\s*,/.exec(call);
        const def = m[1] === 'scheduled_job' && /\)\s*\n\s*(?:async\s+)?def\s+(\w+)/.exec(src.slice(m.index + call.length - 1, m.index + call.length + 200));
        add(call.replace(/\s*\n\s*/g, ' '), 'apscheduler', { name: id ? id[1] : first ? first[1] : def ? def[1] : '', line: lineOf(m.index) });
      }
      if (jobs.length) return finish('code');
    }

    // Line by line: a crontab, or one expression per line in the chosen dialect.
    let comment = null, zone = null;
    lines.forEach((raw, i) => {
      const ln = raw.trim();
      if (!ln) { comment = null; return; }
      if (ln[0] === '#') {
        const c = ln.replace(/^#+\s*/, '');
        // A commented-out job isn't a label.
        comment = c && !/^[\d*@]/.test(c) && !/^[mM]\s+[hH]\b/.test(c) ? c : null;
        return;
      }
      if (plain === 'unix') {
        const env = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(ln);
        if (env) {
          if (env[1] === 'CRON_TZ' || env[1] === 'TZ') zone = unquote(env[2]);
          return;
        }
      }
      let expr = ln, label = null;
      if (plain !== 'unix') {
        const c = /\s+#\s*(.+)$/.exec(ln);
        if (c) { label = c[1].trim(); expr = ln.slice(0, c.index); }
      }
      add(expr, plain, { line: i + 1, name: comment || label || '', zone: zone && E.isValidZone(zone) ? zone : null });
      comment = null;
    });
    return finish(plain === 'unix' ? 'crontab' : 'lines');
  }

  /** The zone a job runs in: its own setting, else its scheduler's default, else the server's. */
  function jobZone(job, serverTz) {
    if (job.P.ok && job.P.tz) return job.P.tz;
    if (job.zone && E.isValidZone(job.zone)) return job.zone;
    if (E.DIALECTS[job.dialect].utcOnly || UTC_BY_DEFAULT.has(job.dialect)) return 'UTC';
    return serverTz;
  }

  /** The instant a wall-clock time (as UTC ms) first happens in tz; the jump if a clock change skips it. */
  function firstInstant(wallMs, tz) {
    const segs = E.daySegments(tz, Math.floor(wallMs / DAY) * DAY);
    const ts = E.wallInstants(wallMs, segs);
    if (ts.length) return ts[0];
    const g = E.gapBoundary(wallMs, segs);
    return g ? g.t : wallMs - E.offsetFast(tz, wallMs);
  }

  /**
   * How the jobs run together over the next `days` days (default 7), on `tz`'s clock.
   * Returns { rows (per job), heat, collisions, busiest, totals, start, startWall, days }.
   */
  function analyze(jobs, opts) {
    const tz = opts.tz, now = opts.now, days = opts.days || 7;
    const w = E.wallParts(now, tz);
    const startWall = Date.UTC(w.y, w.mo - 1, w.d);
    const start = firstInstant(startWall, tz);
    const end = firstInstant(startWall + days * DAY, tz);
    const heat = Array.from({ length: days * 24 }, () => ({ runs: 0, core: 0, jobs: new Set() }));
    const byMinute = new Map();
    const cellOf = t => Math.floor((t + E.offsetFast(tz, t) - startWall) / HOUR);

    const rows = jobs.map((job, i) => {
      const r = { i, job, zone: null, error: null, weekRuns: 0 };
      const M = job.P;
      if (!M.ok) { r.error = M.error.message; return r; }
      if (M.reboot) { r.reboot = true; return r; }
      const zone = jobZone(job, tz);
      r.zone = zone;
      r.next = E.upcoming(M, zone, now, 4).runs.find(x => x.kind !== 'skipped') || null;
      r.stats = E.stats(M, zone, now);
      const checks = E.lint(M, zone, now);
      r.worst = checks.some(c => c.level === 'error') ? 'error' : checks.some(c => c.level === 'warn') ? 'warn' : 'ok';
      r.problems = checks.filter(c => c.level !== 'info');
      r.dst = checks.find(c => c.id === 'dst') || null;
      r.frequent = !!(r.stats && r.stats.minGap != null && r.stats.minGap < FREQUENT);
      if (job.disabled) return r;
      const pol = E.dstPolicy(M);
      const count = (t, n, minute) => {
        const c = cellOf(t);
        if (c < 0 || c >= heat.length) return;
        heat[c].runs += n;
        if (!r.frequent) heat[c].core += n;
        heat[c].jobs.add(i);
        r.weekRuns += n;
        if (minute && !r.frequent) {
          const k = Math.floor(t / MINUTE);
          if (!byMinute.has(k)) byMinute.set(k, new Set());
          byMinute.get(k).add(i);
        }
      };
      if (M.times.length > 1440) {
        // More than once a minute: count whole hours rather than listing every run.
        const perHour = new Map();
        for (const sec of M.times) perHour.set(Math.floor(sec / 3600), (perHour.get(Math.floor(sec / 3600)) || 0) + 1);
        for (let d = -1; d <= days; d++) {
          const dt = new Date(startWall + d * DAY);
          const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, dd = dt.getUTCDate();
          if (!E.dayMatches(M, y, m, dd)) continue;
          for (const [h, n] of perHour) {
            const t = firstInstant(Date.UTC(y, m - 1, dd, h), zone);
            if (t >= start && t < end) count(t, n, false);
          }
        }
        return r;
      }
      const perDay = r.stats ? r.stats.perDay : M.times.length;
      const runs = E.upcoming(M, zone, start - 1, Math.min(250000, Math.ceil(perDay * (days + 2)) + 50)).runs;
      for (const run of runs) {
        if (run.t >= end) break;
        if (run.kind === 'skipped') { if (pol.gap === 'after') count(run.t, run.count, true); continue; }
        if (run.kind === 'repeat' && pol.overlap === 'once') continue;
        count(run.t, 1, true);
      }
      return r;
    });

    // Minutes where two or more jobs start together, grouped by time of day.
    const groups = new Map();
    for (const [k, set] of byMinute) {
      if (set.size < 2) continue;
      const t = k * MINUTE;
      const tod = (((t + E.offsetFast(tz, t)) % DAY) + DAY) % DAY;
      const time = `${pad2(Math.floor(tod / HOUR))}:${pad2(Math.floor((tod % HOUR) / MINUTE))}`;
      let g = groups.get(time);
      if (!g) { g = { time, jobs: new Set(), max: 0, days: 0, first: t }; groups.set(time, g); }
      set.forEach(j => g.jobs.add(j));
      g.max = Math.max(g.max, set.size);
      g.days++;
      g.first = Math.min(g.first, t);
    }
    const collisions = [...groups.values()]
      .map(g => Object.assign(g, { jobs: [...g.jobs].sort((a, b) => a - b) }))
      .sort((a, b) => b.max - a.max || b.days - a.days || a.time.localeCompare(b.time));

    // The busiest hour leaves out the frequent jobs, like the chart does by default.
    let busiest = null;
    heat.forEach((c, k) => { if (c.core && (!busiest || c.core > busiest.runs)) busiest = { cell: k, runs: c.core, jobs: [...c.jobs].filter(i => !rows[i].frequent) }; });
    const valid = rows.filter(r => !r.error);
    const totals = {
      jobs: jobs.length,
      errors: rows.filter(r => r.error).length,
      disabled: jobs.filter(j => j.disabled).length,
      weekRuns: valid.reduce((a, r) => a + r.weekRuns, 0),
      frequent: valid.filter(r => r.frequent).length,
      dst: valid.filter(r => r.dst).length,
      warnings: valid.filter(r => r.problems && r.problems.some(x => x.id !== 'dst')).length,
    };
    return { rows, heat, collisions, busiest, totals, start, startWall, days, tz };
  }

  /**
   * Stagger jobs that start together. Each pile-up keeps its first job and moves the others to
   * the quietest minutes after it in the same hour. Only jobs with a single minute are moved,
   * and only when the job's own scheduler can say the new time in one expression.
   * Returns [{ time, moves: [{ i, name, from, to }] }].
   */
  function spread(jobs, analysis) {
    const use = new Array(60).fill(0);
    analysis.rows.forEach(r => { if (!r.error && !r.reboot && !r.frequent) for (const m of r.job.P.minutes) use[m]++; });
    const moved = new Set();
    const out = [];
    for (const g of analysis.collisions) {
      // An earlier move may already have broken this pile-up up.
      const left = g.jobs.filter(i => !moved.has(i));
      if (left.length < 2) continue;
      const movers = left.slice(1).filter(i => jobs[i].P.minutes.length === 1);
      // Spread the movers through the hour, near evenly spaced targets, on the least used minutes.
      // Minutes on the quarter hour are popular, so they lose ties.
      const gap = Math.max(3, Math.min(10, Math.floor(60 / (movers.length + 1))));
      const taken = new Set([jobs[left[0]].P.minutes[0]]);
      const moves = [];
      movers.forEach((i, k) => {
        const job = jobs[i], P = job.P;
        const target = P.minutes[0] + (k + 1) * gap;
        let best = -1, bestScore = Infinity;
        for (let m = 1; m < 60; m++) {
          if (taken.has(m)) continue;
          const score = use[m] * 100 + Math.abs(m - target) + (m % 15 === 0 ? 5 : 0);
          if (score < bestScore) { best = m; bestScore = score; }
        }
        if (best < 0) return;
        const M2 = E.buildModel({
          seconds: P.seconds, minutes: [best], hours: P.hours, months: P.months, years: P.years,
          dom: { list: P.dom.list, special: P.dom.special }, dow: { list: P.dow.list, special: P.dow.special }, combine: P.combine,
        });
        const r = E.render(M2, job.dialect);
        if (!r.ok || r.lines.length !== 1) return;
        use[best]++;
        use[P.minutes[0]]--;
        taken.add(best);
        moved.add(i);
        moves.push({ i, name: job.name, from: job.schedule, to: r.lines[0], minute: best });
      });
      if (moves.length) out.push({ time: g.time, keep: left[0], moves });
    }
    return out;
  }

  /**
   * The pasted text with moved jobs rewritten in place, or null when the moves can't be placed
   * (JSON or code without line numbers). A crontab line keeps its command.
   */
  function rewrite(text, jobs, plan) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    let changed = 0;
    for (const g of plan) {
      for (const mv of g.moves) {
        const job = jobs[mv.i];
        if (!job.line) return null;
        const ln = lines[job.line - 1];
        let next = null;
        if (job.P.tokens && job.P.tokens.length && job.dialect === 'unix' && ln.trim() === job.expr) {
          // Replace the schedule fields and keep the command exactly as written.
          const lead = ln.length - ln.trimStart().length;
          const t0 = job.P.tokens[0].start, t1 = job.P.tokens[job.P.tokens.length - 1].end;
          next = ln.slice(0, lead + t0) + mv.to + ln.slice(lead + t1);
        } else if (ln.includes(job.expr)) {
          next = ln.replace(job.expr, mv.to);
        }
        if (next == null) return null;
        lines[job.line - 1] = next;
        changed++;
      }
    }
    return changed ? lines.join('\n') : null;
  }

  const EXAMPLE = `# m h dom mon dow command
CRON_TZ=America/New_York
# Nightly database backup
0 0 * * * /opt/scripts/db-backup.sh
# Rotate logs
0 0 * * * /usr/sbin/logrotate /etc/logrotate.conf
# Rebuild the search index
0 0 * * * /opt/app/bin/reindex --all
# Weekly cleanup
0 0 * * 0 /opt/scripts/cleanup.sh
# Warm the cache
0 * * * * /opt/app/bin/warm-cache
# Sync with the warehouse
*/5 * * * * /opt/app/bin/sync
# Daily report
0 9 * * 1-5 /opt/app/bin/report --email team@example.com
# Renew certificates
30 2 * * * /usr/bin/certbot renew --quiet
# Monthly invoices, meant for the first Monday
0 6 1-7 * 1 /opt/app/bin/invoices
`;

  return { parseJobs, analyze, spread, rewrite, jobZone, shortCommand, EXAMPLE, FREQUENT };
});
