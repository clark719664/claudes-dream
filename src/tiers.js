/**
 * Tier resolution for the API.
 *
 *   free — default; batches of up to 10 packages
 *   pro  — batches of up to 100 packages; granted when either
 *            * header `x-api-key` matches one of env.API_KEYS (comma-separated), or
 *            * header `x-rapidapi-proxy-secret` equals env.RAPIDAPI_PROXY_SECRET
 *              (only when that variable is set and non-empty — RapidAPI adds this
 *              header to every request it proxies, proving the caller is a
 *              subscribed RapidAPI user).
 */

export const TIERS = Object.freeze({
  free: Object.freeze({ tier: 'free', batchLimit: 10 }),
  pro: Object.freeze({ tier: 'pro', batchLimit: 100 }),
});

/**
 * Constant-time string comparison (no early exit on the first mismatch) so
 * that key checks do not leak how many leading characters were correct.
 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function headerOf(request, name) {
  const headers = request?.headers;
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  // Plain-object fallback (case-insensitive) for callers without a Headers instance.
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? null : headers[key];
}

function parseKeys(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/**
 * @param {Request} request
 * @param {{ API_KEYS?: string, RAPIDAPI_PROXY_SECRET?: string }} env
 * @returns {{ tier: 'free'|'pro', batchLimit: number }}
 */
export function resolveTier(request, env = {}) {
  const presentedKey = headerOf(request, 'x-api-key');
  if (typeof presentedKey === 'string' && presentedKey.length > 0) {
    // Check every key (no early break) to keep timing independent of position.
    let matched = false;
    for (const key of parseKeys(env?.API_KEYS)) {
      if (safeEqual(key, presentedKey)) matched = true;
    }
    if (matched) return { ...TIERS.pro };
  }

  const secret = env?.RAPIDAPI_PROXY_SECRET;
  if (typeof secret === 'string' && secret.length > 0) {
    const presentedSecret = headerOf(request, 'x-rapidapi-proxy-secret');
    if (typeof presentedSecret === 'string' && safeEqual(presentedSecret, secret)) {
      return { ...TIERS.pro };
    }
  }

  return { ...TIERS.free };
}
