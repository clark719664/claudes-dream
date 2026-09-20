// A dependency-free EAN-13 / UPC-A / UPC-E / EAN-8 decoder.
//
// Written rather than imported for two reasons: the app has to work with the network off,
// and iOS Safari has no BarcodeDetector, so a browser-native fast path alone would leave
// every iPhone unable to scan. Everything here is pure — it takes a row of grey pixels and
// returns digits — so test/barcode.test.mjs can synthesize barcodes and decode them back.
//
// Structure of an EAN-13 symbol, in modules (95 total):
//   start guard 101 | 6 left digits (7 each) | middle guard 01010 | 6 right digits | end 101
// Left digits are encoded in one of two parities (L = odd, G = even) and the pattern of
// those parities across the six is what encodes the 13th digit.

/**
 * Run-length widths of the four runs making up each digit, in modules. An L digit begins on
 * a space, an R digit on a bar, and both use these widths; a G digit is an L digit reversed.
 * The three sets are mutually disjoint, so one width match identifies digit AND parity.
 */
const WIDTHS = [
  [3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2],
  [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2],
];

/** Which left-hand parity pattern encodes which leading digit of an EAN-13. 1 = even (G). */
const LEADING = [
  [0, 0, 0, 0, 0, 0], [0, 0, 1, 0, 1, 1], [0, 0, 1, 1, 0, 1], [0, 0, 1, 1, 1, 0],
  [0, 1, 0, 0, 1, 1], [0, 1, 1, 0, 0, 1], [0, 1, 1, 1, 0, 0], [0, 1, 0, 1, 0, 1],
  [0, 1, 0, 1, 1, 0], [0, 1, 1, 0, 1, 0],
];

/** UPC-E parity patterns, indexed by check digit, for number system 0. 1 = even (G). */
const UPCE_PARITY = [
  [1, 1, 1, 0, 0, 0], [1, 1, 0, 1, 0, 0], [1, 1, 0, 0, 1, 0], [1, 1, 0, 0, 0, 1],
  [1, 0, 1, 1, 0, 0], [1, 0, 0, 1, 1, 0], [1, 0, 0, 0, 1, 1], [1, 0, 1, 0, 1, 0],
  [1, 0, 1, 0, 0, 1], [1, 0, 0, 1, 0, 1],
];

const L_PATTERNS = WIDTHS.map((w, d) => ({ digit: d, parity: 0, w }));
const G_PATTERNS = WIDTHS.map((w, d) => ({ digit: d, parity: 1, w: [...w].reverse() }));
const LEFT_PATTERNS = [...L_PATTERNS, ...G_PATTERNS];
const RIGHT_PATTERNS = L_PATTERNS; // R widths equal L widths; only the starting colour differs

/** How far a digit's normalized widths may sit from the nearest table entry before we refuse. */
const MAX_DIGIT_ERROR = 0.85;
/** A guard's three runs must be within this ratio of one another. */
const GUARD_TOLERANCE = 0.65;

// ---------------------------------------------------------------- checksums

/** GS1 mod-10: every second digit from the right counts triple. */
export function gs1CheckDigit(digits) {
  let sum = 0;
  for (let i = digits.length - 1, weight = 3; i >= 0; i -= 1, weight = weight === 3 ? 1 : 3) {
    sum += digits[i] * weight;
  }
  return (10 - (sum % 10)) % 10;
}

export function checksumOK(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = [...code].map(Number);
  return gs1CheckDigit(digits.slice(0, -1)) === digits[digits.length - 1];
}

// ---------------------------------------------------------------- UPC-E

/**
 * Expand a zero-suppressed UPC-E to its full UPC-A. Which zeros were dropped is encoded in
 * the sixth data digit, so this is a lookup rather than arithmetic.
 */
export function expandUPCE(upce) {
  if (!/^\d{8}$/.test(upce)) return null;
  const n = upce[0];
  if (n !== '0' && n !== '1') return null;
  const d = upce.slice(1, 7);
  const check = upce[7];
  const last = d[5];
  let body;
  if (last <= '2') body = `${d[0]}${d[1]}${last}0000${d[2]}${d[3]}${d[4]}`;
  else if (last === '3') body = `${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`;
  else if (last === '4') body = `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`;
  else body = `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}0000${last}`;
  const upca = `${n}${body}${check}`;
  return checksumOK(upca) ? upca : null;
}

/** Everything is normalized to 13 digits so one code always looks up the same way. */
export function toEAN13(code) {
  const raw = String(code || '').replace(/\D/g, '');
  if (raw.length === 8) {
    const expanded = expandUPCE(raw);
    if (expanded) return `0${expanded}`;
    return checksumOK(raw) ? raw.padStart(13, '0') : null; // EAN-8
  }
  if (raw.length === 12) return checksumOK(raw) ? `0${raw}` : null; // UPC-A
  if (raw.length === 13) return checksumOK(raw) ? raw : null;
  if (raw.length === 14) return checksumOK(raw) ? raw.slice(1) : null; // GTIN-14 carton
  return null;
}

/** The human-facing form: a UPC-A is shown as 12 digits, not zero-padded to 13. */
export function displayCode(ean13) {
  if (!ean13) return '';
  return ean13.startsWith('0') ? ean13.slice(1) : ean13;
}

// ---------------------------------------------------------------- GS1 prefix

const REGIONS = [
  [0, 19, 'US or Canada'], [20, 29, 'in-store code'], [30, 39, 'US drugs or France'],
  [40, 44, 'Germany'], [45, 49, 'Japan'], [50, 59, 'coupon or in-store'],
  [60, 61, 'US or Canada'], [62, 62, 'US or Canada'], [63, 63, 'US or Canada'],
  [64, 64, 'Finland'], [70, 70, 'Norway'], [73, 73, 'Sweden'], [76, 76, 'Switzerland'],
  [80, 83, 'Italy'], [84, 84, 'Spain'], [87, 87, 'Netherlands'], [90, 91, 'Austria'],
  [93, 93, 'Australia'], [94, 94, 'New Zealand'], [97, 97, 'reserved'],
];
const REGIONS_3 = [
  [380, 380, 'Bulgaria'], [385, 385, 'Croatia'], [400, 440, 'Germany'], [471, 471, 'Taiwan'],
  [474, 474, 'Estonia'], [476, 476, 'Azerbaijan'], [480, 480, 'Philippines'],
  [489, 489, 'Hong Kong'], [500, 509, 'United Kingdom'], [520, 521, 'Greece'],
  [528, 528, 'Lebanon'], [531, 531, 'North Macedonia'], [535, 535, 'Malta'],
  [539, 539, 'Ireland'], [540, 549, 'Belgium or Luxembourg'], [560, 560, 'Portugal'],
  [569, 569, 'Iceland'], [570, 579, 'Denmark'], [590, 590, 'Poland'], [594, 594, 'Romania'],
  [599, 599, 'Hungary'], [600, 601, 'South Africa'], [608, 608, 'Bahrain'],
  [611, 611, 'Morocco'], [613, 613, 'Algeria'], [616, 616, 'Kenya'], [619, 619, 'Tunisia'],
  [621, 621, 'Syria'], [622, 622, 'Egypt'], [625, 625, 'Jordan'], [626, 626, 'Iran'],
  [628, 628, 'Saudi Arabia'], [629, 629, 'United Arab Emirates'], [640, 649, 'Finland'],
  [690, 699, 'China'], [700, 709, 'Norway'], [729, 729, 'Israel'], [730, 739, 'Sweden'],
  [740, 745, 'Central America'], [746, 746, 'Dominican Republic'], [750, 750, 'Mexico'],
  [754, 755, 'Canada'], [759, 759, 'Venezuela'], [770, 771, 'Colombia'], [773, 773, 'Uruguay'],
  [775, 775, 'Peru'], [777, 777, 'Bolivia'], [778, 779, 'Argentina'], [780, 780, 'Chile'],
  [784, 784, 'Paraguay'], [786, 786, 'Ecuador'], [789, 790, 'Brazil'], [850, 850, 'Cuba'],
  [858, 858, 'Slovakia'], [859, 859, 'Czechia'], [860, 860, 'Serbia'], [865, 865, 'Mongolia'],
  [867, 867, 'North Korea'], [868, 869, 'Turkey'], [880, 880, 'South Korea'],
  [883, 883, 'Myanmar'], [884, 884, 'Cambodia'], [885, 885, 'Thailand'], [888, 888, 'Singapore'],
  [890, 890, 'India'], [893, 893, 'Vietnam'], [896, 896, 'Pakistan'], [899, 899, 'Indonesia'],
  [950, 950, 'GS1 head office'], [955, 955, 'Malaysia'], [958, 958, 'Macau'],
  [977, 977, 'periodical'], [978, 979, 'book or sheet music'], [980, 980, 'refund receipt'],
  [981, 984, 'coupon'], [99, 99, 'coupon'],
];

/**
 * Where a code was registered. Not the product — but it is real, published information, and
 * it is honest about being all a number alone can tell you.
 */
export function codeOrigin(ean13) {
  if (!/^\d{13}$/.test(ean13)) return '';
  const three = Number(ean13.slice(0, 3));
  for (const [lo, hi, name] of REGIONS_3) if (three >= lo && three <= hi) return name;
  const two = Number(ean13.slice(0, 2));
  for (const [lo, hi, name] of REGIONS) if (two >= lo && two <= hi) return name;
  return '';
}

// ---------------------------------------------------------------- binarizing a row

/**
 * Threshold a row by finding the two tallest peaks in its brightness histogram and cutting
 * between them. A single global threshold across a whole camera frame fails on the uneven
 * lighting you get holding a phone over a label; per-row two-peak works far better.
 */
export function rowToRuns(gray, width, offset = 0) {
  const buckets = new Array(32).fill(0);
  for (let x = 0; x < width; x += 1) buckets[gray[offset + x] >> 3] += 1;

  let first = 0;
  for (let i = 1; i < 32; i += 1) if (buckets[i] > buckets[first]) first = i;
  let second = 0;
  let bestScore = -1;
  for (let i = 0; i < 32; i += 1) {
    const gap = i - first;
    const score = buckets[i] * gap * gap; // favour a peak that is both tall and far away
    if (score > bestScore) {
      bestScore = score;
      second = i;
    }
  }
  const [lo, hi] = first < second ? [first, second] : [second, first];
  if (hi - lo <= 2) return null; // the two peaks sit on top of each other: no contrast
  if (buckets[second] * 64 < width) return null; // the second peak is empty: one flat tone
  const threshold = ((lo + hi) << 2) + 4; // midpoint of the two buckets, back in 0-255

  const runs = [];
  const startsDark = gray[offset] < threshold;
  let dark = startsDark;
  let len = 0;
  for (let x = 0; x < width; x += 1) {
    const isDark = gray[offset + x] < threshold;
    if (isDark === dark) {
      len += 1;
    } else {
      runs.push(len);
      dark = isDark;
      len = 1;
    }
  }
  runs.push(len);
  return { runs, startsDark };
}

// ---------------------------------------------------------------- decoding runs

function matchDigit(runs, at, patterns) {
  let total = 0;
  for (let i = 0; i < 4; i += 1) total += runs[at + i];
  if (total <= 0) return null;
  const unit = total / 7; // self-normalising: each digit is 7 modules wide whatever the scale
  let best = null;
  let bestError = Infinity;
  for (const pattern of patterns) {
    let error = 0;
    for (let i = 0; i < 4; i += 1) {
      const diff = runs[at + i] / unit - pattern.w[i];
      error += diff * diff;
    }
    if (error < bestError) {
      bestError = error;
      best = pattern;
    }
  }
  return bestError <= MAX_DIGIT_ERROR ? { ...best, error: bestError } : null;
}

function guardOK(runs, at, count) {
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const w = runs[at + i];
    if (!(w > 0)) return 0;
    total += w;
  }
  const unit = total / count;
  for (let i = 0; i < count; i += 1) {
    if (Math.abs(runs[at + i] - unit) / unit > GUARD_TOLERANCE) return 0;
  }
  return unit;
}

function readDigits(runs, at, count, patterns) {
  const digits = [];
  const parities = [];
  for (let i = 0; i < count; i += 1) {
    const hit = matchDigit(runs, at + i * 4, patterns);
    if (!hit) return null;
    digits.push(hit.digit);
    parities.push(hit.parity);
  }
  return { digits, parities };
}

function tryEAN13(runs, at) {
  if (at + 59 > runs.length) return null;
  if (!guardOK(runs, at, 3)) return null;
  const left = readDigits(runs, at + 3, 6, LEFT_PATTERNS);
  if (!left) return null;
  if (!guardOK(runs, at + 27, 5)) return null;
  const right = readDigits(runs, at + 32, 6, RIGHT_PATTERNS);
  if (!right) return null;
  if (!guardOK(runs, at + 56, 3)) return null;
  const leading = LEADING.findIndex((p) => p.every((v, i) => v === left.parities[i]));
  if (leading < 0) return null;
  const ean = `${leading}${left.digits.join('')}${right.digits.join('')}`;
  if (!checksumOK(ean)) return null;
  const upcA = leading === 0;
  return { format: upcA ? 'upc_a' : 'ean_13', code: upcA ? ean.slice(1) : ean, runsUsed: 59 };
}

function tryEAN8(runs, at) {
  if (at + 43 > runs.length) return null;
  if (!guardOK(runs, at, 3)) return null;
  const left = readDigits(runs, at + 3, 4, L_PATTERNS);
  if (!left) return null;
  if (!guardOK(runs, at + 19, 5)) return null;
  const right = readDigits(runs, at + 24, 4, RIGHT_PATTERNS);
  if (!right) return null;
  if (!guardOK(runs, at + 40, 3)) return null;
  const code = `${left.digits.join('')}${right.digits.join('')}`;
  if (!checksumOK(code)) return null;
  return { format: 'ean_8', code, runsUsed: 43 };
}

function tryUPCE(runs, at) {
  if (at + 33 > runs.length) return null;
  if (!guardOK(runs, at, 3)) return null;
  const data = readDigits(runs, at + 3, 6, LEFT_PATTERNS);
  if (!data) return null;
  if (!guardOK(runs, at + 27, 6)) return null;
  // The parity pattern carries the check digit; number system 1 inverts it.
  let check = UPCE_PARITY.findIndex((p) => p.every((v, i) => v === data.parities[i]));
  let system = 0;
  if (check < 0) {
    check = UPCE_PARITY.findIndex((p) => p.every((v, i) => v !== data.parities[i]));
    system = 1;
  }
  if (check < 0) return null;
  const code = `${system}${data.digits.join('')}${check}`;
  if (!expandUPCE(code)) return null;
  return { format: 'upc_e', code, runsUsed: 33 };
}

const ATTEMPTS = [tryEAN13, tryUPCE, tryEAN8];

/**
 * Find and decode a symbol anywhere in one row of runs. Tries every dark run as a possible
 * start guard, and then the whole row reversed, since a barcode held upside down produces a
 * structurally valid but unreadable run order rather than a wrong answer.
 */
export function decodeRuns(runs, startsDark) {
  for (const reversed of [false, true]) {
    const seq = reversed ? [...runs].reverse() : runs;
    const firstDark = reversed ? (runs.length % 2 === 1) === startsDark : startsDark;
    for (let at = firstDark ? 0 : 1; at + 33 <= seq.length; at += 2) {
      for (const attempt of ATTEMPTS) {
        const hit = attempt(seq, at);
        if (hit) return hit;
      }
    }
  }
  return null;
}

/**
 * Sweep a grey frame for a barcode. Rows are tried from the middle outwards, because that is
 * where someone aiming a phone puts the thing they are aiming at.
 */
export function decodeGray(gray, width, height, { rows = 24 } = {}) {
  const order = [];
  const middle = Math.floor(height / 2);
  const step = Math.max(1, Math.floor(height / (rows * 2)));
  for (let i = 0; i < rows; i += 1) {
    const delta = Math.ceil(i / 2) * step * (i % 2 === 0 ? 1 : -1);
    const y = middle + delta;
    if (y >= 0 && y < height) order.push(y);
  }
  for (const y of order) {
    const row = rowToRuns(gray, width, y * width);
    if (!row) continue;
    const hit = decodeRuns(row.runs, row.startsDark);
    if (hit) return { ...hit, row: y };
  }
  return null;
}

// ---------------------------------------------------------------- encoding, for tests and previews

const GUARD_START = '101';
const GUARD_MIDDLE = '01010';
const GUARD_END = '101';

function bitsFor(digit, parity) {
  const w = parity === 1 ? [...WIDTHS[digit]].reverse() : WIDTHS[digit];
  let bits = '';
  let dark = parity === 2; // parity 2 marks an R digit, which starts on a bar
  for (const width of w) {
    bits += (dark ? '1' : '0').repeat(width);
    dark = !dark;
  }
  return bits;
}

/** Turn a 12- or 13-digit code into its module string. Used by the tests and the demo strip. */
export function encodeEAN13(code) {
  const ean = toEAN13(code);
  if (!ean) return null;
  const leading = Number(ean[0]);
  const left = ean.slice(1, 7);
  const right = ean.slice(7);
  let bits = GUARD_START;
  for (let i = 0; i < 6; i += 1) bits += bitsFor(Number(left[i]), LEADING[leading][i]);
  bits += GUARD_MIDDLE;
  for (let i = 0; i < 6; i += 1) bits += bitsFor(Number(right[i]), 2);
  bits += GUARD_END;
  return bits;
}

export function encodeEAN8(code) {
  if (!/^\d{8}$/.test(code) || !checksumOK(code)) return null;
  let bits = GUARD_START;
  for (let i = 0; i < 4; i += 1) bits += bitsFor(Number(code[i]), 0);
  bits += GUARD_MIDDLE;
  for (let i = 4; i < 8; i += 1) bits += bitsFor(Number(code[i]), 2);
  return bits + GUARD_END;
}

export function encodeUPCE(code) {
  if (!/^\d{8}$/.test(code) || !expandUPCE(code)) return null;
  const system = Number(code[0]);
  const check = Number(code[7]);
  const parity = UPCE_PARITY[check].map((p) => (system === 1 ? 1 - p : p));
  let bits = GUARD_START;
  for (let i = 0; i < 6; i += 1) bits += bitsFor(Number(code[i + 1]), parity[i]);
  return bits + '010101';
}
