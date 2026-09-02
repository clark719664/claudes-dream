# VaporDep API reference

The VaporDep API is a single Cloudflare Worker (`src/worker.js`). It verifies that a package exists on its registry and returns a risk verdict for the name. It keeps no state: every call is a lookup, a score and a response.

- **Base URL (direct):** `https://vapordep-api.<your-subdomain>.workers.dev` — `vapordep-api` is the Worker name in [`wrangler.toml`](../wrangler.toml); the subdomain is your Cloudflare account's `workers.dev` subdomain.
- **Base URL (RapidAPI):** `https://<your-listing>.p.rapidapi.com` once the API is listed (see [DEPLOY.md](DEPLOY.md)).

Examples below use `$API` for whichever base URL you are calling.

## At a glance

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| `GET` | `/` | Service description and endpoint list | none |
| `GET` | `/v1/health` | Liveness probe, `{"ok":true}` | none |
| `GET` | `/v1/check?name=&ecosystem=` | Verdict for one package | none |
| `POST` | `/v1/batch` | Verdicts for many packages in one call | none for 10 per call; pro key for 100 |
| `OPTIONS` | any | CORS preflight, `204` | none |

Supported ecosystems, exactly these strings (case-insensitive on input): `npm`, `pypi`, `crates`, `rubygems`, `packagist`, `go`.

## Conventions

- **Everything is JSON.** Responses carry `content-type: application/json; charset=utf-8`. Request bodies must be JSON.
- **Errors are always** `{"error":{"code":"...","message":"..."}}` with a matching HTTP status. See [Errors](#errors).
- **CORS is open:** `access-control-allow-origin: *`, methods `GET, POST, OPTIONS`, headers `Content-Type, X-Api-Key, X-RapidAPI-Proxy-Secret, X-RapidAPI-Key, X-RapidAPI-Host` (a preflight echoes whatever headers were requested). Preflights are cached for 24 hours.
- **Caching:** a successful `GET /v1/check` response is `Cache-Control: public, max-age=300`. `GET /` is `public, max-age=3600`. Health, batch and error responses are `no-store`.
- **Body limit:** request bodies larger than **100 KB** (102,400 bytes) are rejected with `413 PAYLOAD_TOO_LARGE`, whether declared via `Content-Length` or discovered while streaming.
- **Trailing slashes** are ignored (`/v1/check/` is `/v1/check`).
- **Names are untrusted input.** They are validated against the ecosystem's naming rules *before* any registry URL is built, and every URL segment is percent-encoded. A name that fails validation is not an HTTP error — it comes back as a verdict with the `INVALID_NAME` flag.

## Authentication and tiers

The API has two tiers. They differ only in the `/v1/batch` size limit; the Worker itself enforces no daily quota (quotas are a RapidAPI plan feature, see [Quotas](#quotas-and-rate-limits)).

| Tier | `/v1/batch` limit | How it is granted |
| --- | --- | --- |
| `free` | 10 packages per call | default |
| `pro` | 100 packages per call | either condition below |

A request is `pro` when **either**:

1. Header `x-api-key` equals one of the keys in the Worker secret `API_KEYS` (a comma-separated list). This is the path for keys you hand out yourself.
2. Header `x-rapidapi-proxy-secret` equals the Worker secret `RAPIDAPI_PROXY_SECRET`. RapidAPI's proxy adds this header to every request it forwards, so any subscriber calling through RapidAPI is `pro`. The check is skipped entirely while that secret is unset or empty. **Clients never send this header themselves** — through RapidAPI they send `X-RapidAPI-Key` and `X-RapidAPI-Host` to RapidAPI, which authenticates them and injects the proxy secret.

Comparisons are constant-time. Anything else is `free`. Unauthenticated calls are never rejected; they are just limited to 10 packages per batch.

## Endpoints

### `GET /`

Service description. Useful as a smoke test after deployment.

```sh
curl "$API/"
```

```json
{
  "name": "vapordep",
  "version": "0.1.0",
  "description": "Dependency hallucination firewall: verifies that package names actually exist on their registry and scores their slopsquatting/typosquatting risk.",
  "docs": "https://github.com/clark719664/claudes-dream#readme",
  "ecosystems": ["npm", "pypi", "crates", "rubygems", "packagist", "go"],
  "tiers": {
    "free": { "batchLimit": 10 },
    "pro": { "batchLimit": 100, "auth": "x-api-key header, or subscribe via RapidAPI" }
  },
  "endpoints": [
    { "method": "GET", "path": "/v1/health", "description": "Liveness probe; returns { ok: true }." },
    { "method": "GET", "path": "/v1/check", "query": { "name": "package name", "ecosystem": "npm, pypi, crates, rubygems, packagist, go" }, "description": "Verify one package and return its verdict." },
    { "method": "POST", "path": "/v1/batch", "body": { "packages": [{ "name": "package name", "ecosystem": "npm, pypi, crates, rubygems, packagist, go" }] }, "description": "Verify many packages at once; returns { results: [verdict...], tier }." }
  ]
}
```

`docs` is the `DOCS_URL` variable from `wrangler.toml`.

### `GET /v1/health`

```sh
curl "$API/v1/health"
# {"ok":true}
```

### `GET /v1/check`

Verdict for one package.

| Query parameter | Required | Notes |
| --- | --- | --- |
| `name` | yes | The package name as written. URL-encode it (`@scope%2Fpkg`, `vendor%2Fpackage`, `github.com%2Fuser%2Frepo`). |
| `ecosystem` | yes | One of `npm`, `pypi`, `crates`, `rubygems`, `packagist`, `go`; case-insensitive, whitespace trimmed. |

```sh
curl "$API/v1/check?name=expresss&ecosystem=npm"
curl "$API/v1/check?name=%40types%2Fnode&ecosystem=npm"
curl "$API/v1/check?name=monolog%2Fmonolog&ecosystem=packagist"
curl "$API/v1/check?name=github.com%2Fgin-gonic%2Fgin&ecosystem=go"
```

Response: `200` with one [verdict object](#the-verdict-object) and `Cache-Control: public, max-age=300`.

Errors: `400 MISSING_NAME`, `400 MISSING_ECOSYSTEM`, `400 INVALID_ECOSYSTEM`, `502 UPSTREAM`.

### `POST /v1/batch`

Verdicts for several packages in one call. Entries may mix ecosystems.

Request body:

```json
{
  "packages": [
    { "name": "requests", "ecosystem": "pypi" },
    { "name": "reqeusts", "ecosystem": "pypi" },
    { "name": "serde", "ecosystem": "crates" }
  ]
}
```

Rules:

- `packages` must be a non-empty array of objects with a non-empty string `name` and a valid `ecosystem`.
- At most **10** entries on the `free` tier, **100** on `pro`. Exceeding the limit returns `402 BATCH_LIMIT` before any lookup is made.
- Results come back **in the same order** as the input. Identical `{name, ecosystem}` entries in one batch share a single registry lookup.
- If any single lookup fails upstream, the whole batch fails with `502 UPSTREAM` (no partial results).

```sh
curl -X POST "$API/v1/batch" \
  -H 'content-type: application/json' \
  -H 'x-api-key: YOUR_KEY' \
  -d '{"packages":[{"name":"requests","ecosystem":"pypi"},{"name":"reqeusts","ecosystem":"pypi"}]}'
```

Response: `200`, `Cache-Control: no-store`:

```json
{
  "results": [
    {
      "name": "requests",
      "ecosystem": "pypi",
      "exists": true,
      "registry": {
        "created": "2011-02-14T12:03:50.000Z",
        "lastPublish": "2024-05-29T15:37:57.000Z",
        "downloadsWeekly": null,
        "repo": "https://github.com/psf/requests",
        "description": "Python HTTP for Humans."
      },
      "risk": { "level": "ok", "score": 0, "flags": [] },
      "suggestions": []
    },
    {
      "name": "reqeusts",
      "ecosystem": "pypi",
      "exists": false,
      "registry": null,
      "risk": {
        "level": "danger",
        "score": 90,
        "flags": [
          { "code": "NOT_FOUND", "message": "No package with this name exists on PyPI" },
          { "code": "NEAR_MISS_TOP", "message": "Name is 2 edits away from the popular package \"requests\" — the classic hallucination / slopsquat signature" }
        ]
      },
      "suggestions": [{ "name": "requests", "distance": 2 }]
    }
  ],
  "tier": "pro"
}
```

`results` holds one verdict per input entry, in the same order (the registry timestamps above are illustrative). `tier` is `"free"` or `"pro"` — the tier the request was served under, which the CLI shows in its summary line.

Errors: `400 INVALID_JSON`, `400 BAD_REQUEST`, `400 INVALID_ECOSYSTEM`, `402 BATCH_LIMIT`, `413 PAYLOAD_TOO_LARGE`, `502 UPSTREAM`.

## The verdict object

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

| Field | Type | Description |
| --- | --- | --- |
| `name` | string | The name exactly as submitted (not normalised). |
| `ecosystem` | string | `npm` \| `pypi` \| `crates` \| `rubygems` \| `packagist` \| `go` |
| `exists` | boolean | Whether the registry knows the package. From the API this is always a boolean; only the CLI's `--offline` mode emits `null` ("could not verify"). `false` for invalid names too. |
| `registry` | object \| null | `null` when the package does not exist or the name is invalid. Otherwise the object below, with `null` for anything the registry does not expose. |
| `registry.created` | string \| null | First-publish timestamp (ISO 8601 as the registry gives it). `null` on RubyGems and Go, whose endpoints only describe the latest version. |
| `registry.lastPublish` | string \| null | Timestamp of the most recent publish. |
| `registry.downloadsWeekly` | number \| null | Downloads in the last 7 days. npm: exact. crates.io: the 90-day figure scaled to a week. PyPI, RubyGems, Packagist, Go: `null` (not exposed by those registries). |
| `registry.repo` | string \| null | Source repository URL, normalised to plain `https://…` (from `git+https://`, `git@host:`, `github:owner/repo` shorthands, etc.). For Go modules hosted on a known forge it is derived from the module path. |
| `registry.description` | string \| null | The registry's one-line description. Always `null` for Go. |
| `risk.level` | string | `ok` \| `caution` \| `danger` |
| `risk.score` | number | 0–100, sum of the triggered flag points, capped at 100. |
| `risk.flags` | array | `{ code, message }` for every triggered flag, in the order the checks run. Empty when nothing is suspicious. |
| `suggestions` | array | `{ name, distance }` for popular packages within 2 edits of the name, at most 5, sorted by distance ascending then name. Empty when the package is itself on the popular list. |

## Risk flags and scoring

| Code | Points | Condition |
| --- | --- | --- |
| `INVALID_NAME` | 100 | The name fails the ecosystem's [naming rules](#name-validation-rules). No registry lookup is performed; `exists` is `false`, `registry` is `null`, suggestions are still computed. |
| `NOT_FOUND` | +60 | The registry has no package with this name (a fully unpublished npm package counts as not found). |
| `NEAR_MISS_TOP` | +30 | The package does **not** exist **and** its name is Levenshtein distance ≤ 2 from a package on the popular list. The classic hallucination / slopsquat signature. |
| `VERY_NEW` | +25 | Exists, and `registry.created` is less than 30 days before now. |
| `LOW_ADOPTION` | +15 | Exists, `registry.downloadsWeekly` is a number and it is below 100. |
| `NO_REPO` | +10 | Exists, but the registry metadata lists no source repository. |
| `SHADOWS_TOP` | +35 | Exists, is **not** itself on the popular list, and is distance 1–2 from a package that is. The typosquat pattern. |

Level thresholds:

| Score | Level |
| --- | --- |
| ≥ 60 | `danger` |
| 25 – 59 | `caution` |
| < 25 | `ok` |

Consequences worth knowing: any non-existent package is at least `danger` (60). An existing package can reach `danger` only by combining flags, e.g. `SHADOWS_TOP` + `VERY_NEW` = 60, or `VERY_NEW` + `LOW_ADOPTION` + `NO_REPO` = 50 (`caution`). A brand-new legitimate package with a repository and modest downloads scores 25–40 (`caution`) — that is intended: it deserves a second look, not a block.

The popular lists live in [`data/top-lists.mjs`](../data/top-lists.mjs) (all lowercase) and are refreshed monthly by [`scripts/refresh-top-packages.mjs`](../scripts/refresh-top-packages.mjs). For a valid name, membership and edit distance are both computed on the spelling the registry treats as canonical (`canonicalName()` in `src/check.js`): lowercased everywhere; for PyPI additionally PEP 503-normalised (runs of `-`, `_` and `.` become one `-`, so `typing_extensions` *is* `typing-extensions`); for crates.io `-` and `_` are interchangeable (`serde-json` *is* `serde_json`). Suggestions are spelled as they appear in the list. `Reqeusts` on PyPI is therefore still two edits from `requests`. A name that fails validation is compared exactly as written, so `React` on npm still suggests `react`.

## Name validation rules

`validateName(ecosystem, name)` in [`src/check.js`](../src/check.js). A failing name yields the `INVALID_NAME` verdict.

| Ecosystem | Rule |
| --- | --- |
| `npm` | Optional `@scope/` prefix. Each part matches `[a-z0-9._-]+` and must not start with `.` or `_`. Whole name ≤ 214 characters. Lowercase only. |
| `pypi` | Lowercased first, then `^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$`, ≤ 100 characters. (So `Django` is valid and is looked up as `django`.) |
| `crates` | `^[a-zA-Z][a-zA-Z0-9_-]*$`, ≤ 64 characters. |
| `rubygems` | `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`, ≤ 100 characters. |
| `packagist` | `vendor/package`: `^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$`. Lowercase only. |
| `go` | A module path `host.tld/segment/...`: `^[a-z0-9.-]+(\/[a-zA-Z0-9._~-]+)+$`, ≤ 255 characters. The first segment must be a real host name (dot-separated `[a-z0-9-]` labels, at least one dot) and no segment may be `.` or `..`. |

## Registries queried

| Ecosystem | Endpoint | Notes |
| --- | --- | --- |
| `npm` | `GET https://registry.npmjs.org/<name>` (scoped: `@scope%2Fpkg`) + `GET https://api.npmjs.org/downloads/point/last-week/<name>` | The downloads call is best-effort; if it fails `downloadsWeekly` is `null`. |
| `pypi` | `GET https://pypi.org/pypi/<name>/json` | `created` / `lastPublish` derived from the earliest / latest file upload time. |
| `crates` | `GET https://crates.io/api/v1/crates/<name>` | `downloadsWeekly` = `recent_downloads × 7 / 90`, rounded. |
| `rubygems` | `GET https://rubygems.org/api/v1/gems/<name>.json` | Latest-version date only; `created` is `null`. |
| `packagist` | `GET https://repo.packagist.org/p2/<vendor>/<package>.json` | Composer 2 "minified" metadata is expanded before reading. |
| `go` | `GET https://proxy.golang.org/<escaped module path>/@latest` | Capitals are escaped as `!x` per the goproxy protocol; `404` and `410` both mean not found. |

Each lookup has a 10-second timeout. On Cloudflare, registry responses are additionally edge-cached for 5 minutes.

Response bodies are capped at **6 MB** (`MAX_UPSTREAM_BYTES` in `src/registries.js`); larger documents are never buffered or parsed. Only the full npm packuments of a few very large, long-established packages (`typescript`, `react`, `@types/node`, …) exceed that: for them the Worker reads the small `GET https://registry.npmjs.org/<name>/latest` document instead, so `exists`, `repo`, `description` and `downloadsWeekly` are still real but `created` and `lastPublish` are `null` (no `VERY_NEW` flag can fire for them). For any other registry an oversized body fails the lookup with `502 UPSTREAM`. Batches run at most 4 lookups concurrently.

## Errors

Shape, always:

```json
{ "error": { "code": "BATCH_LIMIT", "message": "Batch of 25 packages exceeds the free tier limit of 10. Send an x-api-key header (or subscribe via RapidAPI) for the pro tier limit of 100." } }
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `MISSING_NAME` | `/v1/check` without `name` |
| 400 | `MISSING_ECOSYSTEM` | `/v1/check` without `ecosystem` |
| 400 | `INVALID_ECOSYSTEM` | `ecosystem` (query or batch entry) is not one of the six |
| 400 | `INVALID_JSON` | `/v1/batch` body is not valid JSON |
| 400 | `BAD_REQUEST` | `/v1/batch` body is not `{"packages":[…]}`, the array is empty, or an entry lacks a non-empty string `name` |
| 402 | `BATCH_LIMIT` | More packages than the tier allows (10 free / 100 pro) |
| 404 | `NOT_FOUND` | Unknown route |
| 405 | `METHOD_NOT_ALLOWED` | Wrong method for a known route; the `Allow` header lists what is accepted |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 100 KB |
| 500 | `INTERNAL` | Unexpected failure inside the Worker |
| 502 | `UPSTREAM` | A registry was unreachable, timed out, answered 5xx / an unexpected status, or returned malformed JSON. Retry later. |

Error responses are `Cache-Control: no-store` and carry the same CORS headers as successes.

## Quotas and rate limits

The Worker does **not** meter daily usage; it only enforces the per-call batch size. Monthly/daily quotas (Free 50 requests/day, Pro 10,000/month, Team 100,000/month as suggested in [MONETIZATION.md](MONETIZATION.md)) are configured and enforced by RapidAPI for traffic that flows through its proxy. RapidAPI counts **requests**, so one `/v1/batch` call is one request regardless of how many packages it contains. The direct `workers.dev` URL is covered only by Cloudflare's own limits (100,000 requests/day on the free plan across the account) — see [DEPLOY.md](DEPLOY.md) for how to keep the two apart.

## Client examples

**Shell**

```sh
API=https://vapordep-api.<your-subdomain>.workers.dev
curl -s "$API/v1/check?name=expresss&ecosystem=npm" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);console.log(v.risk.level, v.risk.score, v.suggestions.map(x=>x.name))})'
```

**Through RapidAPI** (headers issued by RapidAPI when you subscribe; the host is your listing's):

```sh
curl "https://<your-listing>.p.rapidapi.com/v1/check?name=reqeusts&ecosystem=pypi" \
  -H 'X-RapidAPI-Key: YOUR_RAPIDAPI_KEY' \
  -H 'X-RapidAPI-Host: <your-listing>.p.rapidapi.com'
```

**Browser / Node `fetch`**

```js
const res = await fetch(`${API}/v1/batch`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': process.env.VAPORDEP_API_KEY },
  body: JSON.stringify({ packages: [{ name: 'left-pad', ecosystem: 'npm' }, { name: 'lef-pad', ecosystem: 'npm' }] }),
});
if (!res.ok) throw new Error((await res.json()).error.message);
const { results, tier } = await res.json();
```

**The CLI as a client** — `node cli/vapordep.mjs check --api "$API" --api-key "$KEY"` sends `/v1/batch` requests in chunks (`--batch-size`: 10 by default, 100 as soon as a key is supplied, 1–100 explicitly) and formats the verdicts. The key is sent as `x-api-key` for a direct Worker URL; when `--api` is a `https://<listing>.p.rapidapi.com` URL the same key is sent as `X-RapidAPI-Key` with `X-RapidAPI-Host` set to the listing host, so a RapidAPI subscriber's key works as-is. `--api` must be `https://` (plain `http://` is accepted only for `localhost`), and redirects are refused so the key is never replayed to another host. The GitHub Action's `api-url` / `api-key` / `batch-size` inputs do the same.

## Versioning

Routes are prefixed `/v1`. The verdict fields, flag codes, point values and error codes documented here are the contract; additive changes (new flags, new registry fields) may appear within `v1`, removals or renames would go to `/v2`.
