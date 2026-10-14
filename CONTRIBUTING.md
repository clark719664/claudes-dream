# Contributing to Cron Almanac

Thanks for helping. Cron Almanac is free and open source, and anyone can suggest a change. Every change goes through a pull request that the maintainer reviews and approves. Nobody else can push to `main` directly.

## Reporting a problem

[Open an issue](../../issues/new/choose) and include:

- the expression, exactly as you typed or pasted it
- the scheduler (crontab, systemd, GitHub Actions, GitLab, Kubernetes, EventBridge, Cloudflare, Azure, Quartz, Spring or APScheduler)
- the time zone
- what the page showed, and what you expected

If you're reporting that a scheduler behaves differently from what the page says, link to that scheduler's documentation or source code. Claims about scheduler behaviour need a primary source.

## Proposing a change

1. For anything bigger than a small fix, open an issue first so we can agree on the approach before you write code.
2. Fork the repository and create a branch.
3. Make your change in `src/`. Don't edit `index.html` by hand; it's generated.
4. Run the tests and the build:

   ```sh
   npm test
   npm run build
   ```

5. Commit `src/`, any new tests, and the rebuilt `index.html` together.
6. Open a pull request and fill in the template.

CI runs the tests and checks that `index.html` matches `src/`. The maintainer reviews every pull request before it can be merged.

## Ground rules for the code

- **No dependencies.** The page is plain HTML, CSS and JavaScript and must keep working when opened straight from disk.
- **All schedule logic lives in `src/engine.js`** as pure functions, with no DOM access. `src/why.js` and `src/fleet.js` build on it the same way. `src/app.js` only renders.
- **Every behaviour change comes with a test.** Tests use Node's built-in runner (`node:test`).
- **Cite sources for scheduler facts.** If a change depends on how a scheduler behaves (day-field rules, numbering, daylight-saving handling), put the link to its documentation or source in the pull request.
- **Write for people.** Messages on the page should say what's wrong and how to fix it, in plain language.

Some tests pin today's time zone rules (for example, US clock changes in 2027). If a government changes its rules, those tests need updating.

## Code of conduct

Be kind and assume good intent. The maintainer may close issues or pull requests that are abusive or off-topic.
