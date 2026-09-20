import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gs1CheckDigit, checksumOK, expandUPCE, toEAN13, displayCode, codeOrigin,
  rowToRuns, decodeRuns, decodeGray, encodeEAN13, encodeEAN8, encodeUPCE,
} from '../src/barcode.js';

// ---------------------------------------------------------------- helpers

/** Render a module string into a greyscale frame, the way a camera would see it. */
function render(bits, { scale = 3, width = null, height = 40, quiet = 12, dark = 30, light = 225, noise = 0, blur = 0, gradient = 0, seed = 7 } = {}) {
  const w = width || bits.length * scale + quiet * 2 * scale;
  const gray = new Uint8Array(w * height);
  let rnd = seed;
  const rand = () => {
    rnd = (rnd * 1103515245 + 12345) & 0x7fffffff;
    return rnd / 0x7fffffff - 0.5;
  };
  const left = Math.floor((w - bits.length * scale) / 2);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = Math.floor((x - left) / scale);
      const isBar = i >= 0 && i < bits.length && bits[i] === '1';
      let v = isBar ? dark : light;
      if (gradient) v += (x / w - 0.5) * gradient; // uneven lighting across the frame
      if (noise) v += rand() * noise;
      gray[y * w + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  if (blur > 0) {
    const out = new Uint8Array(gray);
    for (let y = 0; y < height; y += 1) {
      for (let x = blur; x < w - blur; x += 1) {
        let sum = 0;
        for (let k = -blur; k <= blur; k += 1) sum += gray[y * w + x + k];
        out[y * w + x] = Math.round(sum / (blur * 2 + 1));
      }
    }
    return { gray: out, width: w, height };
  }
  return { gray, width: w, height };
}

const roundTrip = (code, opts) => {
  const bits = encodeEAN13(code);
  assert.ok(bits, `encoded ${code}`);
  const { gray, width, height } = render(bits, opts);
  return decodeGray(gray, width, height);
};

// ---------------------------------------------------------------- checksums

test('GS1 check digits match published examples', () => {
  assert.equal(gs1CheckDigit([...'01234567890'].map(Number)), 5);
  assert.equal(gs1CheckDigit([...'400638133393'].map(Number)), 1);
  assert.equal(gs1CheckDigit([...'9638507'].map(Number)), 4);
  assert.ok(checksumOK('012345678905'));
  assert.ok(checksumOK('4006381333931'));
  assert.ok(checksumOK('96385074'));
  assert.ok(!checksumOK('012345678904'), 'a single wrong digit is caught');
  assert.ok(!checksumOK('01234567890'), 'wrong length');
  assert.ok(!checksumOK('abcdefghijkl'));
});

test('a scan is only accepted when its check digit agrees', () => {
  // Every single-digit corruption of a valid code must be rejected.
  const valid = '012345678905';
  let caught = 0;
  for (let i = 0; i < 12; i += 1) {
    for (let d = 0; d <= 9; d += 1) {
      const bad = valid.slice(0, i) + d + valid.slice(i + 1);
      if (bad === valid) continue;
      if (!checksumOK(bad)) caught += 1;
    }
  }
  assert.equal(caught, 108, 'all 108 single-digit corruptions fail the checksum');
});

// ---------------------------------------------------------------- UPC-E

test('UPC-E expands by the rule its last digit names', () => {
  assert.equal(expandUPCE('01234565'), '012345000065');
  assert.equal(expandUPCE('04252614'), '042100005264');
  assert.equal(expandUPCE('01200000'), null, 'a bad check digit expands to nothing');
  assert.equal(expandUPCE('21234565'), null, 'number system must be 0 or 1');
  assert.equal(expandUPCE('0123456'), null);
});

test('everything normalizes to 13 digits so one code looks up one way', () => {
  assert.equal(toEAN13('012345678905'), '0012345678905', 'UPC-A gains a leading zero');
  assert.equal(toEAN13('4006381333931'), '4006381333931');
  assert.equal(toEAN13('01234565'), '0012345000065', 'UPC-E expands then pads');
  assert.equal(toEAN13('96385074'), '0000096385074', 'EAN-8 pads');
  assert.equal(toEAN13('10012345678902'), '0012345678902', 'a GTIN-14 carton drops its indicator');
  assert.equal(toEAN13('  012345678905 '), '0012345678905', 'stray characters are ignored');
  assert.equal(toEAN13('012345678904'), null, 'a failed checksum is not a code');
  assert.equal(toEAN13(''), null);
  assert.equal(displayCode('0012345678905'), '012345678905', 'shown as the UPC people see');
  assert.equal(displayCode('4006381333931'), '4006381333931');
});

test('the origin of a code is reported, and never mistaken for the product', () => {
  assert.equal(codeOrigin('0012345678905'), 'US or Canada');
  assert.equal(codeOrigin('5012345678900'), 'United Kingdom');
  assert.equal(codeOrigin('4006381333931'), 'Germany');
  assert.equal(codeOrigin('6901234567892'), 'China');
  assert.equal(codeOrigin('9781234567897'), 'book or sheet music');
  assert.equal(codeOrigin('nonsense'), '');
});

// ---------------------------------------------------------------- decoding

test('every digit in every position survives a round trip', () => {
  // Codes built so each digit 0-9 lands in each of the 12 positions.
  for (let d = 0; d <= 9; d += 1) {
    for (let pos = 0; pos < 11; pos += 1) {
      const body = Array.from({ length: 11 }, (_, i) => (i === pos ? d : (i * 3 + 1) % 10)).join('');
      const code = body + gs1CheckDigit([...body].map(Number));
      const hit = roundTrip(code);
      assert.ok(hit, `decoded ${code}`);
      assert.equal(hit.code, code);
    }
  }
});

test('real-world codes decode, in both orientations', () => {
  for (const code of ['012345678905', '4006381333931', '888462079464', '5000159484695']) {
    const hit = roundTrip(code);
    assert.ok(hit, `decoded ${code}`);
    assert.equal(hit.code, code);

    // Held upside down, the run order reverses; the decoder must still land on the same code.
    const bits = [...encodeEAN13(code)].reverse().join('');
    const f = render(bits);
    const flipped = decodeGray(f.gray, f.width, f.height);
    assert.ok(flipped, `decoded ${code} reversed`);
    assert.equal(flipped.code, hit.code);
  }
});

test('the format is reported so a UPC is not mislabelled an EAN', () => {
  // A UPC-A comes back as the 12 digits printed on the pack, matching what the browser's
  // own BarcodeDetector returns, so both scan paths feed the lookup identical strings.
  assert.equal(roundTrip('012345678905').code.length, 12);
  assert.equal(roundTrip('012345678905').format, 'upc_a');
  assert.equal(roundTrip('4006381333931').format, 'ean_13');

  const eight = render(encodeEAN8('96385074'));
  const e8 = decodeGray(eight.gray, eight.width, eight.height);
  assert.equal(e8?.format, 'ean_8');
  assert.equal(e8?.code, '96385074');

  const upce = render(encodeUPCE('01234565'));
  const ue = decodeGray(upce.gray, upce.width, upce.height);
  assert.equal(ue?.format, 'upc_e');
  assert.equal(ue?.code, '01234565');
  assert.equal(expandUPCE(ue.code), '012345000065');
});

test('UPC-E decodes under both number systems', () => {
  for (const code of ['01234565', '04252614']) {
    const f = render(encodeUPCE(code));
    assert.equal(decodeGray(f.gray, f.width, f.height)?.code, code);
  }
});

test('a phone camera does not produce a clean image, and it still decodes', () => {
  const code = '888462079464';
  const conditions = [
    ['tiny in frame', { scale: 2 }],
    ['filling the frame', { scale: 9 }],
    ['sensor noise', { noise: 55 }],
    ['out of focus', { blur: 2, scale: 4 }],
    ['noisy and soft', { noise: 40, blur: 1, scale: 4 }],
    ['lit from one side', { gradient: 110 }],
    ['low contrast print', { dark: 95, light: 175 }],
    ['glare and gradient', { gradient: 90, noise: 30, dark: 70, light: 200 }],
    ['off centre', { width: 1400, scale: 3 }],
  ];
  for (const [name, opts] of conditions) {
    const hit = roundTrip(code, opts);
    assert.ok(hit, `decoded when ${name}`);
    assert.equal(hit.code, code, `correct when ${name}`);
  }
});

test('nothing is invented from an image with no barcode in it', () => {
  const blank = new Uint8Array(400 * 40).fill(210);
  assert.equal(decodeGray(blank, 400, 40), null, 'a plain surface reads as nothing');

  const noisy = new Uint8Array(400 * 40);
  let r = 3;
  for (let i = 0; i < noisy.length; i += 1) {
    r = (r * 1103515245 + 12345) & 0x7fffffff;
    noisy[i] = r % 256;
  }
  assert.equal(decodeGray(noisy, 400, 40), null, 'noise reads as nothing');

  // Stripes that are not a barcode must not produce a code.
  const stripes = '10'.repeat(120);
  const f = render(stripes);
  assert.equal(decodeGray(f.gray, f.width, f.height), null, 'a striped pattern reads as nothing');
});

test('a corrupted symbol is refused rather than misread', () => {
  const bits = encodeEAN13('012345678905');
  // Flip a module inside the first data digit: the digit still matches something, but the
  // checksum will not agree, and a wrong number is worse than no number.
  const broken = bits.slice(0, 5) + (bits[5] === '1' ? '0' : '1') + bits.slice(6);
  const f = render(broken, { scale: 4 });
  const hit = decodeGray(f.gray, f.width, f.height);
  assert.ok(hit === null || hit.code === '012345678905', 'either refused or correct, never wrong');
});

test('rowToRuns reports contrast honestly', () => {
  const flat = new Uint8Array(200).fill(128);
  assert.equal(rowToRuns(flat, 200), null, 'no contrast, no runs');

  const half = new Uint8Array(200);
  half.fill(20, 0, 100);
  half.fill(230, 100);
  const row = rowToRuns(half, 200);
  assert.deepEqual(row.runs, [100, 100]);
  assert.equal(row.startsDark, true);
});

test('decodeRuns works straight from widths, with no image at all', () => {
  // The module string for a known code, as ideal run lengths.
  const bits = encodeEAN13('4006381333931');
  const runs = [];
  let last = bits[0];
  let len = 0;
  for (const b of bits) {
    if (b === last) len += 1;
    else {
      runs.push(len);
      last = b;
      len = 1;
    }
  }
  runs.push(len);
  const hit = decodeRuns(runs, true);
  assert.equal(hit?.code, '4006381333931');
  assert.equal(hit?.runsUsed, 59);
});
