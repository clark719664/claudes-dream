# How VaporDep makes money — the honest playbook

Read this before you spend a weekend on it.

**The one-line version:** the code earns nothing by itself. Revenue appears only after the owner connects a Cloudflare account (to run the API) and a RapidAPI account (to bill for it), lists the API, and gives people a reason to find it. [DEPLOY.md](DEPLOY.md) is the step-by-step; this document is about what to expect.

## The three income streams, ranked by time-to-first-dollar

### 1. RapidAPI subscriptions — the actual product

| Plan | Price | Included | Who it is for |
| --- | --- | --- | --- |
| Free | $0 | 50 requests/day, batch of 100 per call (every request that comes through RapidAPI is `pro`-tier; only unauthenticated direct Worker calls are capped at 10) | Individuals trying it, hobby CI |
| Pro | $9/month | 10,000 requests/month, batch of 100 per call | A team's CI pipelines, an IDE plugin, a bot |
| Team | $29/month | 100,000 requests/month, batch of 100 | Platform / security teams running it across many repos |

Why this is first: RapidAPI already has the sign-up flow, key management, metering, card processing and payouts. You write no billing code (the Worker's whole notion of "paid" is a shared-secret header, see [`src/tiers.js`](../src/tiers.js)). The first dollar arrives as soon as one Pro subscriber's monthly charge clears and RapidAPI's payout cycle passes — realistically **weeks to a few months** after listing, and only if someone finds the listing.

Why people would pay rather than self-host: they don't want to deploy a Worker, they want a URL and a key that works from a CI job in thirty seconds; they want batch 100; they want someone else to keep the popular-package lists fresh. That is a real but modest value proposition, and the pricing reflects it.

### 2. The GitHub Marketplace Action — the funnel, not a stream

The Action is free and stays free. Its job is distribution:

- It is the thing people actually search for ("action check dependencies exist", "hallucinated package", "slopsquatting").
- Every workflow run prints VaporDep's name in someone's CI log.
- Its `api-url` / `api-key` inputs are the natural upgrade path: a team that hits registry rate limits from many parallel jobs, or wants one place to see results, points the Action at the hosted API.

Time-to-first-dollar: indirect. Expect the Marketplace to send trickle traffic to the README, and the README to send a fraction of that to the RapidAPI listing.

### 3. Gumroad "commercial self-host + priority support" and GitHub Sponsors — opportunistic

- **Gumroad, one-time, $49–$199:** a small number of companies have procurement processes that need an invoice and a support contact before they can run open-source tooling in CI. This product exists for them. It will sell rarely; when it does, the margin is essentially 100% minus Gumroad's cut.
- **GitHub Sponsors:** free to enable, occasionally produces a few dollars from people who liked the tool. Do not plan around it.

## Why the running cost is $0

- **Cloudflare Workers free plan:** 100,000 requests per day, 10 ms CPU per request. A VaporDep check spends a millisecond of CPU and the rest waiting on the registry. Even a busy free-tier launch stays well inside that. The first paid Cloudflare tier ($5/month for 10 million requests) only becomes relevant when RapidAPI revenue already covers it many times over.
- **No database, no storage, no queue.** Verdicts are computed on the fly; successful `/v1/check` responses are cacheable for 5 minutes and registry answers are edge-cached, which cuts upstream calls further.
- **Data refresh runs on GitHub Actions**, which is free for public repositories. The monthly job takes a couple of minutes.
- **Landing page:** static file on Cloudflare Pages or GitHub Pages, free.
- **RapidAPI:** free to list. They take a commission on sales (20% at the time of writing — verify in their current terms) rather than charging a fee up front.
- **npx wrangler** downloads Cloudflare's CLI into npm's cache when you run it; the repository itself has zero dependencies and nothing to install.

The only money that ever leaves your account is optional: a custom domain (~$10/year) if you want `api.something.tld` instead of `workers.dev`.

## What "passive" really means here

Passive after launch, not passive from the start. Concretely:

**Not passive (one-off, maybe 1–3 hours total):** creating the accounts, deploying, filling in the RapidAPI listing, publishing the Action release, writing one or two posts so search engines and humans learn the thing exists.

**Passive (ongoing):** the popular-package lists refresh themselves on a monthly cron; Cloudflare runs the Worker; RapidAPI bills and pays out; the CLI and Action need no server at all. Expected upkeep is a few minutes a month glancing at the Cloudflare metrics and the RapidAPI dashboard.

**Never fully passive:** answering the occasional support message, redeploying if a registry changes its API (rare — the six endpoints used are the registries' stable public ones), and honouring whatever you promised on Gumroad. If you sell "priority support", budget the time to provide it.

## Realistic expectations

- APIs listed on marketplaces commonly earn **$0–$100/month in their first months**, and many never pass that. A niche security tool with a clear story can do better than an average listing, but do not model this as a salary.
- Growth, if it comes, comes from two places: the **Action funnel** (people who run it in CI and then want the hosted version) and **search traffic for "slopsquatting"** (below). Neither happens without at least a little effort to be findable.
- Churn is real: CI budgets get cut, people self-host once they see how small the Worker is (it is MIT-licensed, and the FAQ says so plainly). That is fine — the honest position is "pay for convenience", and some people will.
- Payout mechanics add delay: RapidAPI pays monthly, after its minimum-balance threshold, through PayPal. Your first payout can lag the first subscription by one to two months.
- Prices are a starting point. RapidAPI lets you change plans; existing subscribers keep theirs.

## The SEO angle

"Slopsquatting" is a young term — it was coined in 2025 after the USENIX study on package hallucination got attention. Young terms have thin search results, which means a focused, genuinely useful page can rank without a marketing budget. Things that help and cost nothing:

- The landing page (`site/index.html`) uses the term in its title, headings and FAQ, explains it in plain language, and cites the primary source ([Spracklen et al., USENIX Security 2025](https://arxiv.org/abs/2406.10279)). Keep that citation — it is the one number in the whole project that is not yours to fabricate, and it is the number people search for.
- The README does the same on GitHub, which itself ranks well.
- A single write-up ("we checked N popular open-source repos' manifests with VaporDep; here is what a hallucinated dependency looks like in practice") on a dev blog or in a Hacker News / Lobsters "Show" post would do more than any amount of tweaking. Only publish numbers you actually measured.
- Cross-link everything: README → site → RapidAPI listing → README. Search engines follow that and so do humans.

What not to do: fake testimonials, invented user counts, "trusted by" logos. Beyond being wrong, they are the fastest way to lose the trust of the security-minded developers who are the only audience for this tool.

## The 30-minute launch checklist

Assumes the accounts exist. Tick in order; details are in [DEPLOY.md](DEPLOY.md).

- [ ] `npx wrangler deploy` succeeds; `curl …/v1/health` returns `{"ok":true}` (5 min)
- [ ] `npx wrangler secret put API_KEYS` with at least one key you generated (2 min)
- [ ] Landing page live on Cloudflare Pages or GitHub Pages; links to the README and API docs resolve (5 min)
- [ ] RapidAPI listing created: base URL, two endpoints, proxy secret copied into `RAPIDAPI_PROXY_SECRET`, three plans, set to Public (10 min)
- [ ] One real request through the RapidAPI console returns a verdict with `"tier":"pro"` (2 min)
- [ ] Subscribe buttons on the landing page point at the RapidAPI listing; the "goes live once listed" note is removed (2 min)
- [ ] Release `v1.0.0` published with "Publish to Marketplace" ticked, category Security; `v1` tag moved (4 min)

Then, over the following week and at your own pace: the `FUNDING.yml` for Sponsors, the Gumroad listing if you want it, and one honest write-up somewhere developers read.

## Summary

| Stream | Cost | Effort to set up | Ongoing effort | Expected early revenue |
| --- | --- | --- | --- | --- |
| RapidAPI subscriptions | $0 | ~30 min | minutes/month | $0–$100/month for the first months, more only with traffic |
| GitHub Marketplace Action | $0 | ~5 min | none | $0 (funnel) |
| Gumroad support listing | $0 | ~20 min | only when it sells | occasional one-off sales |
| GitHub Sponsors | $0 | ~5 min | none | small, sporadic |

Code alone earns nothing. Accounts connected + listing published + someone able to find it is the minimum; everything past that is distribution.
