# VaporDep

**A dependency hallucination firewall.** VaporDep verifies that package names — especially the ones an AI coding assistant just suggested — actually exist on their registry, and scores how much each name looks like a *slopsquatting* or typosquatting trap.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Supports **npm, PyPI, crates.io, RubyGems, Packagist and the Go module proxy**. Zero runtime dependencies. Ships as a CLI, a GitHub Action and a hosted HTTP API (a Cloudflare Worker).

---

## Why this exists

Code-generation models invent package names. A USENIX Security 2025 study by Spracklen et al. found that **19.7% of the packages recommended by LLMs across 576,000 generated code samples did not exist** — and that many of the hallucinated names recur across prompts, which makes them predictable ([arXiv:2406.10279](https://arxiv.org/abs/2406.10279)).

Predictable non-existent names are an attack surface: register the name, upload a package with a malicious install hook, and wait for the next developer who pastes the model's suggestion. This is *slopsquatting* — typosquatting's younger sibling, where the "typo" is made by the model rather than the human.

VaporDep sits between the suggestion and your lockfile:

1. It parses your manifests (or takes names directly).
2. It asks the real registry whether the package exists.
3. It scores the name against a list of the most popular packages per ecosystem, so `expresss`, `reqeusts` or `serde-jsn` light up even when nobody has (yet) registered them.

## What a verdict looks like

Every surface — API, CLI `--json`, the Action — produces the same object:

```json
{
  "name": "expresss",
  "ecosystem": "npm",
  "exists": false,
  "registry": null,
  "risk": {
    "level": "danger",
    "score": 90,
    "flags": [
      { "code": "NOT_FOUND", "message": "No package with this name exists on npm" },
      { "code": "NEAR_MISS_TOP", "message": "Name is 1 edit away from the popular package \"express\" — the classic hallucination / slopsquat signature" }
    ]
  },
  "suggestions": [
    { "name": "express", "distance": 1 }
  ]
}
```

| Flag | Points | Meaning |
| --- | --- | --- |
| `INVALID_NAME` | 100 | Name breaks the ecosystem's naming rules; no registry lookup is made |
| `NOT_FOUND` | +60 | Package does not exist on the registry |
| `NEAR_MISS_TOP` | +30 | Does not exist **and** is within 2 edits of a top package |
| `SHADOWS_TOP` | +35 | Exists, is not itself a top package, but is 1–2 edits from one |
| `VERY_NEW` | +25 | Exists but was first published less than 30 days ago |
| `LOW_ADOPTION` | +15 | Exists but has fewer than 100 downloads in the last week |
| `NO_REPO` | +10 | Exists but lists no source repository |

Score is the sum, capped at 100. `score >= 60` is **danger**, `>= 25` is **caution**, otherwise **ok**. The full reference is in [docs/API.md](docs/API.md).

## Quickstart

### 1. CLI (no install, no dependencies)

Requires Node.js 18 or newer.

```sh
git clone https://github.com/clark719664/claudes-dream.git vapordep
cd your-project
node ../vapordep/cli/vapordep.mjs check            # auto-detects manifests in the current directory
node ../vapordep/cli/vapordep.mjs check package.json requirements.txt --fail-on caution
node ../vapordep/cli/vapordep.mjs check --json     # machine-readable {"results":[...],"summary":{...}}
node ../vapordep/cli/vapordep.mjs check --offline  # no network: name rules + similarity only
```

Manifests understood: `package.json`, `requirements*.txt`, `Cargo.toml`, `Gemfile`, `composer.json`, `go.mod`. Any other file is read as one package name per line when you pass `--ecosystem <npm|pypi|crates|rubygems|packagist|go>`.

Exit codes: `0` clean, `1` at least one verdict at or above `--fail-on` (default `danger`), `2` usage or runtime error. Run `node cli/vapordep.mjs --help` for every option.

### 2. GitHub Action

```yaml
# .github/workflows/vapordep.yml
name: VaporDep
on: [pull_request, push]
jobs:
  vapordep:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: clark719664/claudes-dream@v1   # or pin a commit SHA until v1 is tagged
        with:
          files: package.json requirements.txt   # optional; auto-detects when empty
          fail-on: danger                        # danger | caution | never
```

Optional inputs `api-url` and `api-key` route the checks through a hosted VaporDep API (`POST <api-url>/v1/batch`) instead of having the runner query each registry itself — a direct Worker URL or a `https://<listing>.p.rapidapi.com` listing both work with the key you got for it. With a key, batches of 100 are sent (`batch-size` overrides). See [action.yml](action.yml).

### 3. Hosted API

Replace the host with your own deployment (see [docs/DEPLOY.md](docs/DEPLOY.md)); `vapordep-api` is the Worker name in `wrangler.toml`.

```sh
API=https://vapordep-api.<your-subdomain>.workers.dev

# One package
curl "$API/v1/check?name=expresss&ecosystem=npm"

# Up to 10 packages per call on the free tier, 100 with a pro key
curl -X POST "$API/v1/batch" \
  -H 'content-type: application/json' \
  -H 'x-api-key: YOUR_KEY' \
  -d '{"packages":[{"name":"requests","ecosystem":"pypi"},{"name":"reqeusts","ecosystem":"pypi"}]}'
```

Full reference: [docs/API.md](docs/API.md).

## How this makes money

Honestly and modestly. The code is MIT-licensed and fully self-hostable; what is sold is convenience:

- **Hosted API subscriptions** on RapidAPI (Free / Pro $9 / Team $29 per month) — the only stream that can produce recurring revenue.
- **The GitHub Action and CLI are free** and act as the funnel that makes people aware the API exists.
- **Optional extras**: a one-time Gumroad "commercial self-host + priority support" listing and GitHub Sponsors.

Nothing earns anything until the owner connects a Cloudflare account and a RapidAPI account; the code alone produces no revenue. Expectations, costs (Cloudflare's free tier covers 100k requests/day) and a launch checklist are spelled out in [docs/MONETIZATION.md](docs/MONETIZATION.md).

## Architecture

```
                 ┌──────────────────────────────────────────────────────┐
  manifests ───► │ cli/vapordep.mjs   parse → verdicts → table/JSON     │
                 │   modes: local (query registries) | --api | --offline│
                 └───────────────┬──────────────────────────────────────┘
                                 │ uses
   action.yml ──────────────────►│ (composite Action wraps the CLI)
                                 ▼
                 ┌──────────────────────────────────────────────────────┐
  HTTP clients ─►│ src/worker.js      Cloudflare Worker: /v1/check,     │
  (RapidAPI,     │                    /v1/batch, tiers, CORS, errors    │
   curl, CI)     └───────────────┬──────────────────────────────────────┘
                                 ▼
                 ┌──────────────────────────────────────────────────────┐
                 │ src/check.js       validateName + checkPackage       │
                 │ src/registries.js  one lookup() per registry         │
                 │ src/similarity.js  levenshtein + nearMatches         │
                 │ src/tiers.js       free (batch 10) / pro (batch 100) │
                 │ data/top-lists.mjs popular names per ecosystem       │
                 └──────────────────────────────────────────────────────┘

  scripts/refresh-top-packages.mjs + .github/workflows/refresh-data.yml
    → regenerate data/top-*.json and data/top-lists.mjs monthly
```

| Path | Purpose |
| --- | --- |
| `src/check.js` | Name validation per ecosystem, the scoring rules, `checkPackage()` |
| `src/registries.js` | `createRegistryClient(fetch)` — talks to npm, PyPI, crates.io, RubyGems, Packagist, proxy.golang.org |
| `src/similarity.js` | Levenshtein distance with early exit; `nearMatches()` (max 5, distance ≤ 2) |
| `src/tiers.js` | Resolves `free` / `pro` from `x-api-key` or RapidAPI's proxy secret |
| `src/worker.js` | The HTTP API (web-standard `Request`/`Response`, runs on Workers or Node ≥ 18) |
| `cli/vapordep.mjs` | Manifest parsers, CLI, human and JSON output |
| `action.yml` | Composite GitHub Action wrapping the CLI |
| `data/` | Top-package lists (`top-<eco>.json`) and the generated `top-lists.mjs` |
| `scripts/refresh-top-packages.mjs` | Rebuilds the data from live sources; scheduled by `refresh-data.yml` |
| `site/index.html` | Static landing page (GitHub Pages / Cloudflare Pages ready) |
| `docs/` | [API reference](docs/API.md), [deployment guide](docs/DEPLOY.md), [monetization playbook](docs/MONETIZATION.md) |

Design constraints worth knowing:

- **Untrusted input never reaches a URL unvalidated.** `validateName()` runs before any registry URL is built, and every path segment is still `encodeURIComponent`-ed.
- **No state.** The Worker has no database; it looks up, scores and returns. Successful `/v1/check` responses carry `Cache-Control: public, max-age=300`.
- **Registry gaps are reported as `null`**, never guessed: PyPI no longer publishes download counts, RubyGems' gem endpoint does not expose the first-release date, and so on.

## Development

Node.js 22 is what the repo is developed and tested with (the CLI itself runs on 18+). There is nothing to install.

```sh
npm test                          # runs `node --test` — offline, deterministic, mocked fetch
node --test test/core.test.js     # a single file
npx wrangler dev                  # local API on http://localhost:8787 (downloads wrangler on demand)
node scripts/refresh-top-packages.mjs --dry-run   # preview a top-list refresh (needs network)
```

Tests live in `test/` and never touch the network; CLI tests use `--offline`. Keep it that way: no runtime dependencies, no TypeScript, plain ESM.

## Documentation

- [docs/API.md](docs/API.md) — endpoints, headers, verdict schema, error codes, curl examples
- [docs/DEPLOY.md](docs/DEPLOY.md) — from zero to a listed, billable API, step by step
- [docs/MONETIZATION.md](docs/MONETIZATION.md) — what to expect, what "passive" means here, launch checklist
- [site/index.html](site/index.html) — the landing page

## License

[MIT](LICENSE) © 2026 vapordep contributors.
