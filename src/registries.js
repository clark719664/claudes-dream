/**
 * Registry lookups for every supported ecosystem.
 *
 * `createRegistryClient(fetchImpl)` returns `{ lookup(ecosystem, name) }` which
 * resolves to a normalised record:
 *
 *   { exists: false }
 *   { exists: true, created, lastPublish, downloadsWeekly, repo, description }
 *
 * and throws an Error with `.code === 'UPSTREAM'` when the registry cannot be
 * reached, answers with a 5xx (or any other unexpected status) or returns
 * malformed JSON.
 *
 * Names are untrusted input. `validateName()` in check.js runs before any URL
 * is built, and every path segment is still passed through encodeURIComponent
 * here so the client is safe to use on its own as well.
 */

const USER_AGENT = 'vapordep/0.1.0 (+https://github.com/clark719664/claudes-dream)';
const TIMEOUT_MS = 10_000;

/**
 * Upper bound on an upstream response body. Registry documents for the most
 * popular packages can be enormous (full npm packuments of 10-16 MB; the
 * largest PyPI project documents are under 4 MB), and buffering plus parsing
 * them costs memory and CPU that a caller could amplify. Bodies over this
 * size are never parsed: npm falls back to the small `/<name>/latest`
 * document, other registries fail the lookup with UPSTREAM.
 */
export const MAX_UPSTREAM_BYTES = 6 * 1024 * 1024;

/** Sentinel returned by `getJson` when a body exceeds MAX_UPSTREAM_BYTES. */
const TOO_LARGE = Symbol('vapordep.too-large');

/** Hosts we recognise as source-code forges when guessing a repository URL. */
const FORGE_HOSTS = new Set([
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'codeberg.org',
  'gitea.com',
  'sr.ht',
  'git.sr.ht',
  'sourceforge.net',
]);

/** Build the error thrown for any registry failure. */
export function upstreamError(message, cause) {
  const err = cause === undefined ? new Error(message) : new Error(message, { cause });
  err.code = 'UPSTREAM';
  return err;
}

// `globalThis.fetch(...)` (rather than a detached reference) keeps `this`
// bound the way browser-style runtimes expect.
const defaultFetch = (...args) => globalThis.fetch(...args);

function timeoutSignal() {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(TIMEOUT_MS)
    : undefined;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Non-empty trimmed string, else null. */
function str(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isForgeUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const host = new URL(value).host.replace(/^www\./, '');
    return FORGE_HOSTS.has(host);
  } catch {
    return false;
  }
}

/**
 * Normalise the many spellings of a repository reference into a plain https
 * URL: "git+https://github.com/x/y.git", "git://...", "git@github.com:x/y.git",
 * "github:x/y", "x/y" (npm shorthand) and `{ type, url }` objects.
 */
export function normalizeRepoUrl(repo) {
  const raw = typeof repo === 'string' ? repo : repo && typeof repo === 'object' ? repo.url : null;
  const url = str(raw);
  if (!url) return null;

  const short = url.match(/^(?:(github|gitlab|bitbucket):)?([\w.-]+\/[\w.-]+)$/);
  if (short) {
    const host = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' }[short[1] ?? 'github'];
    return `https://${host}/${short[2].replace(/\.git$/, '')}`;
  }

  return url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@([^:/]+):/, 'https://$1/')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
}

/** Earliest and latest of a list of date strings (as the original strings). */
function dateRange(values) {
  let earliest = null;
  let latest = null;
  let earliestMs = Infinity;
  let latestMs = -Infinity;
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) continue;
    if (ms < earliestMs) {
      earliestMs = ms;
      earliest = value;
    }
    if (ms > latestMs) {
      latestMs = ms;
      latest = value;
    }
  }
  return { earliest, latest };
}

/** npm registry URL segment: "@scope/pkg" must become "@scope%2Fpkg". */
function encodeNpmName(name) {
  if (name.startsWith('@') && name.includes('/')) {
    const i = name.indexOf('/');
    return `@${encodeURIComponent(name.slice(1, i))}%2F${encodeURIComponent(name.slice(i + 1))}`;
  }
  return encodeURIComponent(name);
}

/** The downloads API wants the literal slash for scoped packages. */
function encodeNpmDownloadsName(name) {
  if (name.startsWith('@') && name.includes('/')) {
    const i = name.indexOf('/');
    return `@${encodeURIComponent(name.slice(1, i))}/${encodeURIComponent(name.slice(i + 1))}`;
  }
  return encodeURIComponent(name);
}

/**
 * Go module proxy escaping: every uppercase letter becomes "!" + lowercase
 * (module paths may not contain "!" themselves), then each path segment is
 * percent-encoded.
 */
export function escapeGoModulePath(modulePath) {
  return modulePath
    .replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`)
    .split('/')
    .map(encodeURIComponent)
    .join('/');
}

/** Derive a repository URL from a Go module path hosted on a known forge. */
function repoFromGoPath(modulePath) {
  const segments = modulePath.split('/');
  if (segments.length >= 3 && FORGE_HOSTS.has(segments[0].toLowerCase())) {
    return `https://${segments[0]}/${segments[1]}/${segments[2]}`;
  }
  return null;
}

/**
 * Packagist's p2 metadata is "minified" (composer/2.0): each version entry
 * only carries the keys that differ from the previous entry, and the string
 * "__unset" removes an inherited key.
 */
function expandMinifiedVersions(list) {
  const out = [];
  let prev = {};
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const cur = { ...prev };
    for (const [key, value] of Object.entries(entry)) {
      if (value === '__unset') delete cur[key];
      else cur[key] = value;
    }
    out.push(cur);
    prev = cur;
  }
  return out;
}

/** Pick the most repository-looking URL from PyPI's project_urls. */
function pickPypiRepo(info) {
  const entries = Object.entries(info.project_urls ?? {}).filter(([, url]) => typeof url === 'string');
  const byLabel = entries.find(([label]) => /^(source|source ?code|repository|repo|code|github|gitlab)$/i.test(label.trim()));
  if (byLabel) return byLabel[1];
  const byHost = entries.find(([, url]) => isForgeUrl(url));
  if (byHost) return byHost[1];
  return isForgeUrl(info.home_page) ? info.home_page : null;
}

/**
 * @param {typeof fetch} [fetchImpl] fetch-compatible function (injectable for tests)
 */
export function createRegistryClient(fetchImpl = defaultFetch) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('createRegistryClient: fetchImpl must be a function');
  }

  async function request(url) {
    try {
      return await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        // Cloudflare-only hint: cache registry answers at the edge for 5 minutes.
        // Other runtimes ignore unknown RequestInit keys.
        cf: { cacheTtl: 300 },
        signal: timeoutSignal(),
      });
    } catch (err) {
      throw upstreamError(`Network error contacting ${hostOf(url)}: ${err?.message ?? err}`, err);
    }
  }

  /**
   * Read a response body as text, giving up (and cancelling the stream) as
   * soon as it is known to exceed MAX_UPSTREAM_BYTES. Resolves to TOO_LARGE
   * in that case.
   */
  async function readBodyCapped(res) {
    const declared = Number(res.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > MAX_UPSTREAM_BYTES) {
      await res.body?.cancel?.().catch(() => {});
      return TOO_LARGE;
    }
    if (!res.body || typeof res.body.getReader !== 'function') {
      const text = await res.text();
      return text.length > MAX_UPSTREAM_BYTES ? TOO_LARGE : text;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_UPSTREAM_BYTES) {
        await reader.cancel().catch(() => {});
        return TOO_LARGE;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }

  /**
   * GET `url` as JSON. Resolves to `null` for a "not found" status, the parsed
   * body for 2xx, TOO_LARGE when the body exceeds MAX_UPSTREAM_BYTES, and
   * throws UPSTREAM for anything else.
   */
  async function getJson(url, notFoundStatuses = [404]) {
    const res = await request(url);
    if (notFoundStatuses.includes(res.status)) return null;
    if (res.status < 200 || res.status >= 300) {
      throw upstreamError(`${hostOf(url)} responded with HTTP ${res.status}`);
    }
    let text;
    try {
      text = await readBodyCapped(res);
    } catch (err) {
      throw upstreamError(`Network error reading from ${hostOf(url)}: ${err?.message ?? err}`, err);
    }
    if (text === TOO_LARGE) return TOO_LARGE;
    try {
      return JSON.parse(text);
    } catch (err) {
      throw upstreamError(`${hostOf(url)} returned malformed JSON`, err);
    }
  }

  /** Registries other than npm have no small fallback document: refuse oversized bodies. */
  function rejectTooLarge(doc, url) {
    if (doc === TOO_LARGE) {
      throw upstreamError(`${hostOf(url)} response exceeds ${MAX_UPSTREAM_BYTES / (1024 * 1024)} MB and was not parsed`);
    }
    return doc;
  }

  const lookups = {
    async npm(name) {
      // Secondary call; any failure just leaves downloadsWeekly unknown.
      async function weeklyDownloads() {
        try {
          const dl = await getJson(`https://api.npmjs.org/downloads/point/last-week/${encodeNpmDownloadsName(name)}`);
          return typeof dl?.downloads === 'number' ? dl.downloads : null;
        } catch {
          return null;
        }
      }

      // This is the full packument because `time.created` is only available
      // there. It is bounded by MAX_UPSTREAM_BYTES: only long-established,
      // heavily published packages exceed that, so for them the small
      // `/latest` document is enough (created stays unknown).
      const doc = await getJson(`https://registry.npmjs.org/${encodeNpmName(name)}`);
      if (doc === TOO_LARGE) {
        const latestUrl = `https://registry.npmjs.org/${encodeNpmName(name)}/latest`;
        const latestDoc = rejectTooLarge(await getJson(latestUrl), latestUrl);
        if (!latestDoc || typeof latestDoc !== 'object') return { exists: false };
        return {
          exists: true,
          created: null,
          lastPublish: null,
          downloadsWeekly: await weeklyDownloads(),
          repo: normalizeRepoUrl(latestDoc.repository),
          description: str(latestDoc.description),
        };
      }
      // A fully unpublished package answers 200 with `time.unpublished` and no
      // installable versions — for our purposes it does not exist.
      if (!doc || typeof doc !== 'object' || doc.time?.unpublished) return { exists: false };

      const latestTag = doc['dist-tags']?.latest;
      const latest = latestTag ? doc.versions?.[latestTag] : undefined;
      const time = doc.time ?? {};
      const downloadsWeekly = await weeklyDownloads();

      return {
        exists: true,
        created: str(time.created),
        lastPublish: str(latestTag && time[latestTag]) ?? str(time.modified),
        downloadsWeekly,
        repo: normalizeRepoUrl(latest?.repository ?? doc.repository),
        description: str(doc.description) ?? str(latest?.description),
      };
    },

    async pypi(name) {
      // PyPI names are case-insensitive; lowercase avoids a redirect.
      const url = `https://pypi.org/pypi/${encodeURIComponent(name.toLowerCase())}/json`;
      const doc = rejectTooLarge(await getJson(url), url);
      if (!doc || typeof doc !== 'object') return { exists: false };

      const info = doc.info ?? {};
      const times = [];
      for (const files of Object.values(doc.releases ?? {})) {
        if (!Array.isArray(files)) continue;
        for (const file of files) times.push(file?.upload_time_iso_8601 ?? file?.upload_time);
      }
      const { earliest, latest } = dateRange(times);

      return {
        exists: true,
        created: earliest,
        lastPublish: latest,
        // The PyPI JSON API no longer reports download counts.
        downloadsWeekly: null,
        repo: normalizeRepoUrl(pickPypiRepo(info)),
        description: str(info.summary),
      };
    },

    async crates(name) {
      const url = `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`;
      const doc = rejectTooLarge(await getJson(url), url);
      if (!doc) return { exists: false };
      const crate = doc.crate;
      if (!crate || typeof crate !== 'object') throw upstreamError('crates.io returned an unexpected document');

      return {
        exists: true,
        created: str(crate.created_at),
        lastPublish: str(doc.versions?.[0]?.created_at) ?? str(crate.updated_at),
        // crates.io only exposes a trailing-90-day figure; scale it to a week.
        downloadsWeekly: typeof crate.recent_downloads === 'number' ? Math.round((crate.recent_downloads * 7) / 90) : null,
        repo: normalizeRepoUrl(crate.repository),
        description: str(crate.description),
      };
    },

    async rubygems(name) {
      const url = `https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`;
      const doc = rejectTooLarge(await getJson(url), url);
      if (!doc || typeof doc !== 'object') return { exists: false };

      return {
        exists: true,
        // This endpoint only reports the latest version's date, not the gem's
        // first release, so `created` is unknown.
        created: null,
        lastPublish: str(doc.version_created_at),
        // RubyGems exposes lifetime totals only, not a weekly figure.
        downloadsWeekly: null,
        repo:
          normalizeRepoUrl(str(doc.source_code_uri) ?? str(doc.metadata?.source_code_uri)) ??
          (isForgeUrl(doc.homepage_uri) ? normalizeRepoUrl(doc.homepage_uri) : null),
        description: str(doc.info),
      };
    },

    async packagist(name) {
      const slash = name.indexOf('/');
      if (slash <= 0) {
        const err = new TypeError('Packagist names must be "vendor/package"');
        err.code = 'INVALID_NAME';
        throw err;
      }
      const vendor = name.slice(0, slash);
      const pkg = name.slice(slash + 1);
      const url = `https://repo.packagist.org/p2/${encodeURIComponent(vendor)}/${encodeURIComponent(pkg)}.json`;
      const doc = rejectTooLarge(await getJson(url), url);
      if (!doc || typeof doc !== 'object') return { exists: false };

      const packages = doc.packages && typeof doc.packages === 'object' ? doc.packages : {};
      const raw = packages[name] ?? packages[name.toLowerCase()] ?? Object.values(packages)[0];
      const versions = expandMinifiedVersions(Array.isArray(raw) ? raw : []);
      if (versions.length === 0) return { exists: false };

      const { earliest, latest } = dateRange(versions.map((v) => v.time));
      const newest = versions[0]; // p2 lists the newest version first
      return {
        exists: true,
        created: earliest,
        lastPublish: latest,
        // Download statistics are not part of the p2 metadata.
        downloadsWeekly: null,
        repo: normalizeRepoUrl(newest.source?.url) ?? (isForgeUrl(newest.homepage) ? normalizeRepoUrl(newest.homepage) : null),
        description: str(newest.description),
      };
    },

    async go(name) {
      // The proxy answers 404 (and sometimes 410 Gone) for unknown modules.
      const url = `https://proxy.golang.org/${escapeGoModulePath(name)}/@latest`;
      const doc = rejectTooLarge(await getJson(url, [404, 410]), url);
      if (!doc || typeof doc !== 'object') return { exists: false };

      return {
        exists: true,
        // @latest only describes the newest version; the first-publish date
        // would need extra /@v/list calls.
        created: null,
        lastPublish: str(doc.Time),
        downloadsWeekly: null,
        repo: normalizeRepoUrl(doc.Origin?.URL) ?? repoFromGoPath(name),
        description: null,
      };
    },
  };

  return {
    /**
     * @param {string} ecosystem one of npm|pypi|crates|rubygems|packagist|go
     * @param {string} name package name (already validated by check.js)
     */
    async lookup(ecosystem, name) {
      const fn = lookups[ecosystem];
      if (!fn) {
        const err = new RangeError(`Unsupported ecosystem "${ecosystem}"`);
        err.code = 'INVALID_ECOSYSTEM';
        throw err;
      }
      if (typeof name !== 'string' || name.length === 0) {
        const err = new TypeError('Package name must be a non-empty string');
        err.code = 'INVALID_NAME';
        throw err;
      }
      return fn(name);
    },
  };
}
