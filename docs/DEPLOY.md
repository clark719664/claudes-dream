# Deploying VaporDep: from zero to a billable API

This is the whole path, in order, from a fresh clone to an API that can accept paying subscribers. Every step is something the **owner** has to do with their own accounts — the repository ships the code, the Worker config (`wrangler.toml`), the Action (`action.yml`) and the landing page (`site/`), but it cannot sign up for anything on your behalf.

Budget: roughly an hour the first time, most of it filling in forms. Running cost: $0 on the free tiers described below.

**Prerequisites**

- Node.js 18+ locally (22 is what the repo is tested with)
- A GitHub account, with this repository pushed to it as a **public** repo (required for the Marketplace step and convenient for Pages)
- No `npm install` is needed anywhere; `npx wrangler …` downloads Cloudflare's CLI on demand into npm's cache, not into the repo

---

## 1. Deploy the API to Cloudflare Workers

The Worker is `src/worker.js`; `wrangler.toml` already names it `vapordep-api` and enables a `workers.dev` route.

1. Create a free Cloudflare account at <https://dash.cloudflare.com/sign-up>. No domain or credit card is required for Workers.
2. On first use, Cloudflare asks you to pick a `workers.dev` subdomain (Workers & Pages → Overview). Your API will live at `https://vapordep-api.<that-subdomain>.workers.dev`.
3. From the repository root:

   ```sh
   npx wrangler login      # opens the browser once, stores a token locally
   npx wrangler deploy     # builds and publishes src/worker.js
   ```

   The command prints the public URL. Smoke-test it:

   ```sh
   curl https://vapordep-api.<subdomain>.workers.dev/v1/health
   # {"ok":true}
   curl "https://vapordep-api.<subdomain>.workers.dev/v1/check?name=expresss&ecosystem=npm"
   ```

4. Set the secrets. Both are optional for the API to run, but without them nobody can reach the `pro` batch limit.

   ```sh
   # Keys you hand out yourself (comma-separated). Generate them however you like:
   #   node -e "console.log('vd_' + require('crypto').randomBytes(24).toString('base64url'))"
   npx wrangler secret put API_KEYS

   # Leave this one for step 3; you get the value from RapidAPI.
   npx wrangler secret put RAPIDAPI_PROXY_SECRET
   ```

   Secrets are stored in Cloudflare, never in the repo. Re-running `wrangler deploy` keeps them.

5. (Optional) Custom domain. In the Cloudflare dashboard open the Worker → Settings → Domains & Routes → Add → Custom domain, e.g. `api.yourdomain.tld`. This requires the domain's DNS to be on Cloudflare. A custom domain also lets you attach a WAF rate-limiting rule (the free plan includes one), which is the simplest way to throttle people who bypass RapidAPI and hit the Worker directly.

What you get for free: 100,000 requests per day across the account and 10 ms of CPU per request — far more than a lookup needs, since the Worker mostly waits on the registry. Cloudflare's dashboard shows request counts and errors under the Worker's Metrics tab (`observability` is enabled in `wrangler.toml`, so logs are viewable there too).

Local development, if you want it: put `API_KEYS=dev-key` in a git-ignored `.dev.vars` file and run `npx wrangler dev` (serves on <http://localhost:8787>).

## 2. Publish the landing page

`site/index.html` is one self-contained file: no build step, no external assets. Two zero-cost hosts; pick one.

**Option A — Cloudflare Pages** (same account, simplest)

1. Workers & Pages → Create → Pages → Connect to Git → pick this repository.
2. Build command: leave empty. Build output directory: `site`.
3. Deploy. The page appears at `https://<project>.pages.dev`; add a custom domain under the project's Custom domains tab if you have one.

**Option B — GitHub Pages**

GitHub's "deploy from a branch" mode only serves `/` or `/docs`, not `/site`, so use the Actions-based deployment. Add this workflow file to the repository (it is not shipped, because it should carry your branch name):

```yaml
# .github/workflows/pages.yml
name: Deploy landing page
on:
  push:
    branches: [main]        # your default branch
    paths: ["site/**"]
  workflow_dispatch: {}
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
      - id: deployment
        uses: actions/deploy-pages@v4
```

Then: repository Settings → Pages → Source: **GitHub Actions**, and run the workflow once (Actions tab → Deploy landing page → Run workflow). The page is served at `https://<user>.github.io/<repo>/`.

**Option C — no separate host.** Skip the page entirely and rely on the README plus the RapidAPI listing. The page mainly exists for search traffic (see [MONETIZATION.md](MONETIZATION.md#the-seo-angle)).

After publishing, update the links on the page and in `wrangler.toml`'s `DOCS_URL` if you moved the docs somewhere other than the GitHub README.

## 3. List the API on RapidAPI

RapidAPI (the "API Hub") handles sign-ups, API keys, quotas, billing and payouts. Your Worker only has to recognise RapidAPI's traffic.

1. Create an account at <https://rapidapi.com> and open the **Provider Dashboard** (top-right menu → "My APIs" / "Add New API").
2. **Add New API.** Name: `VaporDep`. Short description, e.g. *"Dependency hallucination firewall: verify that AI-suggested package names exist on npm, PyPI, crates.io, RubyGems, Packagist and Go, and score their slopsquatting risk."* Category: the closest security/developer-tools category on offer. Choose *"UI"* (manual definition) when asked how to specify the API — there are only two endpoints.
3. **Base URL.** Under Definition → Settings (the exact tab name shifts occasionally) set the base URL to your Worker: `https://vapordep-api.<subdomain>.workers.dev`. Leave "Firewall / Proxy secret" enabled — that is what injects the `X-RapidAPI-Proxy-Secret` header.
4. **Endpoints.** Add the two public endpoints, copying the descriptions from [API.md](API.md):
   - `GET /v1/check` with required query parameters `name` (string) and `ecosystem` (enum: `npm, pypi, crates, rubygems, packagist, go`). Example: `name=expresss`, `ecosystem=npm`.
   - `POST /v1/batch` with a JSON body; paste the example body from API.md. Set the example response from a real call so the interactive console looks right.
   - Optionally `GET /v1/health`.
5. **Proxy secret.** In the API's settings RapidAPI shows a per-API secret it sends as `X-RapidAPI-Proxy-Secret` on every proxied request. Copy it and store it in the Worker:

   ```sh
   npx wrangler secret put RAPIDAPI_PROXY_SECRET
   ```

   From now on **only** requests that came through RapidAPI (or carry one of your own `API_KEYS`) get the `pro` batch limit. Everyone hitting the Worker URL directly stays on `free`. Verify from RapidAPI's test console: a `/v1/batch` request with 20 packages must succeed and the response must say `"tier":"pro"`.

   One consequence to decide on: the Worker cannot tell RapidAPI *plans* apart — every RapidAPI subscriber, including free-plan users, is `pro` with batch 100. If you want batch 100 to be a paid-only feature, either restrict the `/v1/batch` endpoint to paid plans in RapidAPI's plan editor (each plan can enable or disable individual endpoints), or extend `src/tiers.js` to read the `X-RapidAPI-Subscription` header RapidAPI forwards (values are the plan names).
6. **Plans & Pricing.** Define three plans:

   | Plan | Price | Quota | Overage |
   | --- | --- | --- | --- |
   | Basic (Free) | $0 | 50 requests / day, hard limit | none |
   | Pro | $9 / month | 10,000 requests / month | e.g. $0.002 per extra request, or hard limit |
   | Team (RapidAPI calls this tier "Ultra") | $29 / month | 100,000 requests / month | same |

   Quotas are counted per **request** — a batch of 100 is one request. Rate limits (requests per second) can also be set per plan; 5–10/s is plenty. Leave the fourth ("Mega") plan disabled or turn it into an enterprise "contact us" if you want.
7. **Payouts.** Provider Dashboard → Payout settings: RapidAPI pays providers through PayPal on a monthly cycle once the balance reaches their minimum, and keeps a commission on each transaction (20% at the time of writing; confirm the current figure in their terms before you set prices). Fill in tax details or payouts will be held.
8. **Publish.** Set the API to **Public**, write the long description (the README's "Why this exists" section adapts well, keep the USENIX citation), add the `site/` URL as the website, and upload an icon (the inline SVG shield from `site/index.html`, exported to PNG, works). Subscribe to your own API on the Basic plan and run one request through the RapidAPI console to confirm the whole chain.
9. **Wire up the page.** Replace the `href="#"` on the three subscribe buttons in `site/index.html` with the RapidAPI listing URL and delete the "goes live once listed" note.

## 4. Publish the Action to the GitHub Marketplace

`action.yml` is already Marketplace-ready (composite action, `branding` set to a purple shield). Publishing is done through a release.

1. Requirements GitHub checks: the repository is **public**, `action.yml` sits in the **root**, the `name` in it is unique across the Marketplace, there is a README, and your account has **two-factor authentication** enabled.
2. Tag a release from the default branch: repository → Releases → **Draft a new release** → new tag `v1.0.0`.
3. Tick **Publish this Action to the GitHub Marketplace**, accept the Marketplace Developer Agreement the first time, and choose primary category **Security** (secondary, if offered: *Dependency management* or *Code quality*). GitHub validates `action.yml` inline.
4. Publish the release. Then create the moving major tag so `uses: <owner>/<repo>@v1` keeps working across patch releases:

   ```sh
   git tag -f v1 v1.0.0 && git push -f origin v1
   ```

   Repeat for every release: bump the exact tag, move `v1`.
5. Update the `uses:` line in the README quickstart to the real `<owner>/<repo>@v1` if you renamed the repository.

The listing page lives at `https://github.com/marketplace/actions/<slug>`; put its URL on the landing page and in the RapidAPI long description. Marketplace listings are free and unpaid — the Action's job is to bring people to the API (see [MONETIZATION.md](MONETIZATION.md)).

## 5. Optional extras

**Gumroad — one-time "commercial self-host + priority support"**

The code is MIT, so nobody *needs* to buy anything to self-host. What some companies will pay for is a receipt and a person to email. Create a Gumroad product (Gumroad takes a percentage per sale; no monthly fee): price it in the $49–$199 range, deliverable = a PDF with the deploy steps above tailored to their case plus an email address with a stated response time (e.g. two business days). Keep the promise small enough that you will actually keep it. Link it from the FAQ on the landing page.

**GitHub Sponsors**

Settings → Sponsors → enable; add a `FUNDING.yml` under `.github/` with your handle. Contribution amounts from a tool like this are usually small, but it costs nothing and shows up on the repo.

## Maintenance: what "running it" actually involves

| What | Who does it | How often |
| --- | --- | --- |
| Refresh the popular-package lists (`data/top-*.json`, `data/top-lists.mjs`) | `.github/workflows/refresh-data.yml` runs `scripts/refresh-top-packages.mjs`, validates with the test suite, commits | Monthly cron (1st, 06:17 UTC); a failed source keeps its previous list and the run is marked failed so you notice |
| Redeploy the Worker after a data refresh | You: `npx wrangler deploy` — or add a deploy job to the refresh workflow using a `CLOUDFLARE_API_TOKEN` secret and `cloudflare/wrangler-action` | When you want the API to pick up new lists. A CLI run from a fresh clone of the default branch sees them immediately; Action users on `@v1` only get them when you next move the `v1` tag (section 4) — cut a patch release after a refresh you care about |
| Watch for registry API changes | You, only when `502 UPSTREAM` errors climb in the Cloudflare metrics or RapidAPI reports a failing health check | Rare; the six endpoints used are the registries' stable public ones |
| Bump `compatibility_date` in `wrangler.toml` | You | Occasionally, purely optional |
| Respond to RapidAPI support tickets / Gumroad emails | You | Proportional to subscribers — near zero early on |
| Payout housekeeping | You | Monthly glance at the RapidAPI provider dashboard |

Expected steady-state effort is close to zero: the cron keeps the data fresh, Cloudflare and RapidAPI keep the servers and billing running, and there is no database to back up. What is *not* zero is the launch work above and the occasional support reply — [MONETIZATION.md](MONETIZATION.md) is candid about that.
