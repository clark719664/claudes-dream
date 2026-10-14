# Cron Almanac

Cron Almanac reads, checks and translates cron schedules for **Linux crontab, GitHub Actions, Kubernetes CronJob, AWS EventBridge, Quartz and Spring `@Scheduled`**. It's a single HTML file with no dependencies and no tracking. Open `index.html` in a browser.

Most cron tools explain standard 5-field cron and stop there. The bugs that cause real incidents come from the details those tools don't model:

| Problem | What Cron Almanac does |
| --- | --- |
| `0 9 1-7 * 1` looks like "first Monday of the month". It actually runs on the 1st–7th **and** every Monday, because cron ORs the day fields. | Says **or** in the description, shows it on the calendar, and gives the working pattern (`0 9 1-7 * *` plus a weekday check in the command). |
| Vixie cron and cronie AND the day fields when one starts with `*` (`*/2`). Kubernetes (robfig/cron) doesn't. | Applies each scheduler's real rule and warns where they disagree. |
| In Quartz and EventBridge, day 1 is **Sunday**, so `1-5` means Sunday–Thursday. | Flags it and offers `MON-FRI` as a one-click fix. |
| `*/7` restarts every hour, so the last gap is 4 minutes. `*/90` only fires at `:00`. | Warns about uneven steps and generates the multi-line crontab for 90-minute intervals. |
| `30 2 * * *` doesn't exist on the spring-forward day and `30 1 * * *` happens twice on the fall-back day. | Computes runs in any IANA time zone, marks skipped and repeated runs, and explains what cronie does with them. |
| GitHub Actions runs schedules in UTC, so "9am Berlin" needs two cron lines across the year. | Converts to UTC for each offset the zone uses. An offset like India's +05:30 can split one schedule into several lines; it handles that too. |
| `L`, `W`, `#`, `L-3` and `LW` exist only in some dialects. | Translates between all six dialects. Each translation is parsed back in its target dialect and must match the original exactly. Where there's no equivalent, it explains why and gives the usual workaround (for example `[ "$(date -d tomorrow +%d)" = 01 ]`). |

It also:

- Shows a 12-month calendar of the days it runs and a 24 × 60 minute map of the times.
- Lists the next runs with relative times and your own time zone alongside.
- Gives runs per year, plus the shortest and longest gap between runs.
- Converts plain English ("last friday of the month at 5pm", "every 15 minutes during business hours") into cron.
- Accepts pasted lines as they appear in configs: a full crontab line with its command, `- cron: '…'`, `schedule: "…"`, `cron(…)`, `@Scheduled(cron = "…")`, or `CRON_TZ=… ` prefixes.

## Development

```sh
npm test          # node --test: parser, DST, checks, English, and round-trip translations
npm run build     # inlines src/ into index.html (and dist/artifact.html)
```

- `src/engine.js` holds all schedule logic as pure functions with no DOM. It works in browsers and Node.
- `src/app.js` renders the page.
- `src/page.html` and `src/style.css` hold the markup and styles.
- `index.html` is the built page, committed so it works when opened directly or served from GitHub Pages.

Time zones come from the browser's `Intl` data. No time zone library is needed.

## Limits

- Run lists follow the wall clock: a skipped time is shown as skipped, and a repeated time is shown twice. The page explains cronie's special handling of these times but doesn't simulate each scheduler's own DST policy.
- The English parser is rule-based. It covers common phrasings and lists any words it ignored.
- Jenkins `H` syntax, systemd `OnCalendar` and `@every` aren't supported.
