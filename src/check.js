/**
 * Core verdict logic: name validation, registry lookup and risk scoring.
 *
 * `checkPackage()` produces the verdict object used everywhere (API, CLI, docs):
 *
 *   {
 *     name, ecosystem,
 *     exists: boolean,
 *     registry: null | { created, lastPublish, downloadsWeekly, repo, description },
 *     risk: { level: 'ok'|'caution'|'danger', score, flags: [{ code, message }] },
 *     suggestions: [{ name, distance }]
 *   }
 */

import { nearMatches } from './similarity.js';

export const ECOSYSTEMS = Object.freeze(['npm', 'pypi', 'crates', 'rubygems', 'packagist', 'go']);

/** Human-readable registry names used in flag messages. */
export const REGISTRY_NAMES = Object.freeze({
  npm: 'npm',
  pypi: 'PyPI',
  crates: 'crates.io',
  rubygems: 'RubyGems',
  packagist: 'Packagist',
  go: 'the Go module proxy',
});

/** Points contributed by each flag; the score is their sum capped at 100. */
export const FLAG_POINTS = Object.freeze({
  INVALID_NAME: 100,
  NOT_FOUND: 60,
  NEAR_MISS_TOP: 30,
  VERY_NEW: 25,
  LOW_ADOPTION: 15,
  NO_REPO: 10,
  SHADOWS_TOP: 35,
});

const MAX_SCORE = 100;
const VERY_NEW_DAYS = 30;
const LOW_ADOPTION_WEEKLY = 100;
const NEAR_DISTANCE = 2;
const DAY_MS = 86_400_000;

/*
 * Naming rules per ecosystem. The regular expressions are written so that
 * every repetition is unambiguous (a separator must be consumed between
 * alphanumeric runs) — untrusted names must not be able to trigger
 * catastrophic backtracking.
 */
const NPM_PART_RE = /^[a-z0-9._-]+$/;
const PYPI_RE = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;
const CRATES_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const RUBYGEMS_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
// Equivalent to ^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$
const PACKAGIST_RE = /^[a-z0-9]+([_.-][a-z0-9]+)*\/[a-z0-9]+(([_.]|-{1,2})[a-z0-9]+)*$/;
const GO_RE = /^[a-z0-9.-]+(\/[a-zA-Z0-9._~-]+)+$/;
// The first Go path segment must be a real hostname: dot-separated labels of
// [a-z0-9-] that neither start nor end with "-", at least one dot.
const GO_HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const NAME_RULES = {
  npm(name) {
    if (name.length > 214) return false;
    let parts;
    if (name.startsWith('@')) {
      const slash = name.indexOf('/');
      if (slash < 0) return false;
      parts = [name.slice(1, slash), name.slice(slash + 1)];
    } else {
      parts = [name];
    }
    return parts.every((part) => NPM_PART_RE.test(part) && !part.startsWith('.') && !part.startsWith('_'));
  },
  pypi(name) {
    const lower = name.toLowerCase();
    return lower.length <= 100 && PYPI_RE.test(lower);
  },
  crates(name) {
    return name.length <= 64 && CRATES_RE.test(name);
  },
  rubygems(name) {
    return name.length <= 100 && RUBYGEMS_RE.test(name);
  },
  packagist(name) {
    return PACKAGIST_RE.test(name);
  },
  go(name) {
    if (name.length > 255 || !GO_RE.test(name)) return false;
    const segments = name.split('/');
    // "." and ".." segments would be normalised away by URL resolution and
    // let a name steer the request to another path on the proxy.
    if (segments.some((s) => /^\.+$/.test(s))) return false;
    // The first segment must be a real host name such as "github.com".
    return GO_HOST_RE.test(segments[0]);
  },
};

/**
 * Does `name` satisfy the naming rules of `ecosystem`? Runs before any
 * registry URL is built.
 */
export function validateName(ecosystem, name) {
  const rule = NAME_RULES[ecosystem];
  if (!rule || typeof name !== 'string' || name.length === 0) return false;
  return rule(name);
}

/** Map a numeric score onto a risk level. */
export function levelForScore(score) {
  if (score >= 60) return 'danger';
  if (score >= 25) return 'caution';
  return 'ok';
}

function flag(code, message) {
  return { code, message };
}

function buildVerdict({ name, ecosystem, exists, registry, flags, suggestions }) {
  const score = Math.min(MAX_SCORE, flags.reduce((sum, f) => sum + (FLAG_POINTS[f.code] ?? 0), 0));
  return {
    name,
    ecosystem,
    exists,
    registry,
    risk: { level: levelForScore(score), score, flags },
    suggestions,
  };
}

function stringOrNull(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

function toMillis(now) {
  const ms = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now);
  return Number.isNaN(ms) ? Date.now() : ms;
}

function edits(n) {
  return `${n} edit${n === 1 ? '' : 's'}`;
}

/**
 * The spelling a registry treats as identical to `name`, used for top-list
 * membership and edit distance so that a package is never flagged as a typo
 * of itself:
 *
 *   - pypi:   PEP 503 — case-insensitive, runs of "-", "_" and "." are one "-"
 *             (`typing_extensions` is `typing-extensions`)
 *   - crates: case-insensitive, "-" and "_" are interchangeable
 *   - others: lowercased (the lists are lowercase; npm/packagist names must be)
 */
export function canonicalName(ecosystem, name) {
  const lower = String(name).toLowerCase();
  if (ecosystem === 'pypi') return lower.replace(/[-_.]+/g, '-');
  if (ecosystem === 'crates') return lower.replace(/-/g, '_');
  return lower;
}

// Canonical indexes are cached per top-list array (and ecosystem) so repeated
// checks do not re-normalise the list.
const topIndexCache = new WeakMap();
function topIndex(ecosystem, list) {
  let byEcosystem = topIndexCache.get(list);
  if (!byEcosystem) {
    byEcosystem = new Map();
    topIndexCache.set(list, byEcosystem);
  }
  let index = byEcosystem.get(ecosystem);
  if (!index) {
    const canonical = [];
    const original = new Map(); // canonical spelling -> spelling in the list
    for (const entry of list) {
      if (typeof entry !== 'string') continue;
      const key = canonicalName(ecosystem, entry);
      if (!original.has(key)) {
        original.set(key, entry);
        canonical.push(key);
      }
    }
    index = { canonical, original };
    byEcosystem.set(ecosystem, index);
  }
  return index;
}

/**
 * Compare `name` with the top list of its ecosystem in canonical form.
 * Returns whether the name *is* a top package and, if not, the popular names
 * within `maxDist` edits (spelled as they appear in the list).
 *
 * @returns {{ inTop: boolean, suggestions: { name: string, distance: number }[] }}
 */
export function topMatches(ecosystem, name, list, maxDist = NEAR_DISTANCE) {
  const top = Array.isArray(list) ? list : [];
  const { canonical, original } = topIndex(ecosystem, top);
  const key = canonicalName(ecosystem, name);
  if (original.has(key)) return { inTop: true, suggestions: [] };
  const suggestions = nearMatches(key, canonical, maxDist).map((m) => ({ name: original.get(m.name), distance: m.distance }));
  return { inTop: false, suggestions };
}

/**
 * Produce a verdict for one package.
 *
 * @param {object} opts
 * @param {string} opts.name       package name as the user wrote it
 * @param {string} opts.ecosystem  one of ECOSYSTEMS
 * @param {{ lookup(ecosystem: string, name: string): Promise<object> }} opts.client
 * @param {Record<string, string[]>} [opts.topLists] default export of data/top-lists.mjs
 * @param {Date|number|string} [opts.now] reference time for the VERY_NEW check
 */
export async function checkPackage({ name, ecosystem, client, topLists = {}, now = new Date() } = {}) {
  if (!ECOSYSTEMS.includes(ecosystem)) {
    const err = new RangeError(`Unsupported ecosystem "${ecosystem}"; expected one of ${ECOSYSTEMS.join(', ')}`);
    err.code = 'INVALID_ECOSYSTEM';
    throw err;
  }
  if (typeof name !== 'string') throw new TypeError('name must be a string');

  const registryName = REGISTRY_NAMES[ecosystem];
  const top = Array.isArray(topLists?.[ecosystem]) ? topLists[ecosystem] : [];
  const flags = [];

  if (!validateName(ecosystem, name)) {
    flags.push(flag('INVALID_NAME', `Not a valid ${registryName} package name; no registry lookup was performed`));
    // Compared as written so that e.g. "React" still suggests "react".
    return buildVerdict({ name, ecosystem, exists: false, registry: null, flags, suggestions: nearMatches(name, top, NEAR_DISTANCE) });
  }

  if (!client || typeof client.lookup !== 'function') {
    throw new TypeError('checkPackage: a registry client with lookup(ecosystem, name) is required');
  }

  // Membership and edit distance are both measured on the registry's
  // canonical spelling (see canonicalName), so `typing_extensions` is
  // `typing-extensions` and `Reqeusts` is still two edits from `requests`.
  const { inTop, suggestions } = topMatches(ecosystem, name, top);
  const closest = suggestions[0];

  const result = await client.lookup(ecosystem, name);

  if (!result || result.exists !== true) {
    flags.push(flag('NOT_FOUND', `No package with this name exists on ${registryName}`));
    if (closest) {
      flags.push(
        flag(
          'NEAR_MISS_TOP',
          `Name is ${edits(closest.distance)} away from the popular package "${closest.name}" — the classic hallucination / slopsquat signature`,
        ),
      );
    }
    return buildVerdict({ name, ecosystem, exists: false, registry: null, flags, suggestions });
  }

  const registry = {
    created: stringOrNull(result.created),
    lastPublish: stringOrNull(result.lastPublish),
    downloadsWeekly: typeof result.downloadsWeekly === 'number' && Number.isFinite(result.downloadsWeekly) ? result.downloadsWeekly : null,
    repo: stringOrNull(result.repo),
    description: stringOrNull(result.description),
  };

  const nowMs = toMillis(now);
  const createdMs = registry.created ? Date.parse(registry.created) : NaN;
  if (!Number.isNaN(createdMs) && nowMs - createdMs < VERY_NEW_DAYS * DAY_MS) {
    const days = Math.max(0, Math.floor((nowMs - createdMs) / DAY_MS));
    flags.push(flag('VERY_NEW', `First published ${days} day${days === 1 ? '' : 's'} ago (less than ${VERY_NEW_DAYS} days)`));
  }
  if (registry.downloadsWeekly !== null && registry.downloadsWeekly < LOW_ADOPTION_WEEKLY) {
    flags.push(flag('LOW_ADOPTION', `Only ${registry.downloadsWeekly} download${registry.downloadsWeekly === 1 ? '' : 's'} in the last week (fewer than ${LOW_ADOPTION_WEEKLY})`));
  }
  if (!registry.repo) {
    flags.push(flag('NO_REPO', `No source repository is listed in the ${registryName} metadata`));
  }
  if (!inTop && closest) {
    flags.push(
      flag(
        'SHADOWS_TOP',
        `Exists, but its name is ${edits(closest.distance)} away from the popular package "${closest.name}" — typosquat pattern`,
      ),
    );
  }

  return buildVerdict({
    name,
    ecosystem,
    exists: true,
    registry,
    flags,
    // A package that is itself on the top list gets no "did you mean" hints
    // (topMatches already returns [] in that case).
    suggestions,
  });
}
