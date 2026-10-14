# Cron Almanac

[![CI](https://github.com/clark719664/cron-almanac/actions/workflows/ci.yml/badge.svg)](https://github.com/clark719664/cron-almanac/actions/workflows/ci.yml)

**Read, check and translate cron schedules** for Linux crontab, GitHub Actions, Kubernetes CronJob, AWS EventBridge, Quartz and Spring `@Scheduled`.

**Use it:** https://clark719664.github.io/cron-almanac/

It's free, open source, and a single web page with no dependencies, no tracking and no network requests. Your expressions never leave your browser.

## What it catches

Most cron tools explain standard 5-field cron and stop there. The bugs that cause real incidents come from the details those tools don't model:

| Problem | What Cron Almanac does |
| --- | --- |
| `0 9 1-7 * 1` looks like "first Monday of the month". It actually runs on the 1st–7th **and** every Monday, because cron ORs the day fields. | Says **or** in the description, shows it on the calendar, and gives the working pattern. |
| Vixie cron and cronie AND the day fields when one starts with `*` (`*/2`). Kubernetes (robfig/cron) doesn't. | Applies each scheduler's real rule and warns where they disagree. |
| In Quartz and EventBridge, day 1 is **Sunday**, so `1-5` means Sunday–Thursday. | Flags it and offers `MON-FRI` as a one-click fix. |
| `*/7` restarts every hour, so the last gap is 4 minutes. `*/90` only fires at `:00`. | Warns about uneven steps and writes the multi-line crontab for a 90-minute interval. |
| On the spring-forward day `30 2 * * *` doesn't exist, and on the fall-back day `30 1 * * *` happens twice. Each scheduler handles this differently. | Computes runs in any IANA time zone. It marks every run a clock change affects and says what that scheduler is documented to do: cron's fixed-time vs wildcard rule, GitHub, EventBridge Scheduler and Quartz. Where a scheduler doesn't document it, the page says so. |
| GitHub Actions uses UTC unless the workflow sets `timezone:`. Older GitHub Enterprise Server versions can't set it. | Reminds you to add `timezone:`, shows the YAML, and gives the UTC equivalents for every offset the zone uses. |
| "First Monday of every month, plus the third Monday of every other month" can't be written as one cron expression. | Splits the request into separate schedules and analyzes them as one job, with a combined calendar and run list. It warns when two schedules fire at the same moment, which would make the job run twice. |
| `L`, `W`, `#`, `L-3` and `LW` exist only in some dialects. | Translates between all six dialects. Each translation is parsed back in its target dialect and must match the original. Where there's no equivalent, it explains why and gives the usual workaround. |

It also:

- Shows a 12-month calendar of the days it runs and a 24 × 60 map of the times.
- Lists the next runs with relative times and your own time zone alongside.
- Gives runs per year and the shortest and longest gaps.
- Converts plain English into cron, including sentences that need several schedules ("every monday at 9am and every friday at 5pm", "first and third monday of the month", "every 90 minutes").
- Reads whatever you paste: a crontab file, a GitHub workflow (all of its `cron:` entries), a Kubernetes manifest, an `aws scheduler` command, a Spring annotation, or a Quartz call. It picks out the expressions, the time zone and the scheduler.

## Running it yourself

Download the repository and open `index.html`. It works offline. Keep the `fonts/` folder next to it, or the page falls back to system fonts.

## Development

```sh
npm test          # unit, round-trip, brute-force and fuzz tests (node:test)
npm run build     # inlines src/ into index.html
```

| File | What it is |
| --- | --- |
| `src/engine.js` | All schedule logic, as pure functions with no DOM: parsing, time zones, descriptions, checks, translations, English parsing. Runs in browsers and Node. |
| `src/app.js` | Renders the page. |
| `src/page.html`, `src/style.css`, `src/fonts.css` | Markup and styles. |
| `index.html` | The built page. It's committed, so the site needs no build step. |
| `test/` | Tests. `fuzz.test.mjs` compares the run list with a minute-by-minute simulation around clock changes in eight time zones, and round-trips hundreds of random expressions through every dialect. |

## Contributing

Suggestions and fixes are welcome. Every change goes through a pull request that the maintainer reviews; see [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, see [SECURITY.md](SECURITY.md).

## Limits

- Run lists follow the wall clock. Where a scheduler documents its daylight-saving behaviour, the list shows it; for Kubernetes and Spring, whose docs don't say, the page says so.
- The English parser is rule-based. It covers common phrasings and lists any words it ignored.
- Jenkins `H` syntax, systemd `OnCalendar` and `@every` aren't supported.

## License

[MIT](LICENSE). The fonts in `fonts/` are under the SIL Open Font License 1.1.
