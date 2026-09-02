/**
 * String-similarity helpers used to detect "near-miss" package names
 * (hallucinated names one or two edits away from a popular package).
 *
 * Distances are measured in Unicode code points rather than UTF-16 units, so
 * an astral character such as an emoji counts as a single edit.
 */

const SURROGATE_RE = /[\uD800-\uDFFF]/;

/**
 * Index-able view of a string. Strings are indexed directly (fast path) unless
 * they contain astral characters, in which case they are split into code
 * points. Mixing the two forms is safe: a BMP character compares equal in both.
 */
function units(str) {
  return SURROGATE_RE.test(str) ? Array.from(str) : str;
}

/**
 * Classic Levenshtein edit distance (insert / delete / substitute, each cost 1)
 * computed with a two-row DP table.
 *
 * `maxDist` enables early exit: once the distance is known to exceed it the
 * function returns `maxDist + 1` instead of the exact value. Callers that only
 * care about "is it within N edits?" get a large speed-up on long, dissimilar
 * strings.
 */
export function levenshtein(a, b, maxDist = Infinity) {
  a = String(a);
  b = String(b);
  if (a === b) return 0;

  const s = units(a);
  const t = units(b);
  const n = s.length;
  const m = t.length;
  const cap = maxDist + 1; // Infinity + 1 === Infinity, so the default never caps

  // The distance is at least the length difference.
  if (Math.abs(n - m) > maxDist) return cap;
  if (n === 0) return m;
  if (m === 0) return n;

  let prev = new Array(m + 1);
  let cur = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;

  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = i;
    const si = s[i - 1];
    for (let j = 1; j <= m; j++) {
      let v = prev[j - 1] + (si === t[j - 1] ? 0 : 1); // substitute / match
      const del = prev[j] + 1; // delete from a
      if (del < v) v = del;
      const ins = cur[j - 1] + 1; // insert into a
      if (ins < v) v = ins;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    // Every cell in later rows is >= the minimum of this row, so bail out.
    if (rowMin > maxDist) return cap;
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }

  return prev[m] > maxDist ? cap : prev[m];
}

/**
 * Find entries of `list` within `maxDist` edits of `name`.
 *
 * Returns at most 5 `{ name, distance }` objects sorted by distance ascending,
 * then name ascending. An entry identical to `name` (distance 0) is never
 * returned — it is the package itself, not a near miss.
 */
export function nearMatches(name, list, maxDist = 2) {
  const out = [];
  if (typeof name !== 'string' || name.length === 0 || !list) return out;

  for (const candidate of list) {
    if (typeof candidate !== 'string' || candidate === name) continue;
    const distance = levenshtein(name, candidate, maxDist);
    if (distance <= maxDist) out.push({ name: candidate, distance });
  }

  out.sort((x, y) => x.distance - y.distance || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  return out.slice(0, 5);
}
