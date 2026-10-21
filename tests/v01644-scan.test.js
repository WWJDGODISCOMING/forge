// v0.16.44 round 1: the vendored EAN/UPC reader, the check digit, the 2-frame rule, and the decoder choice. Synthetic codes only.
import { test, eq, assert } from './harness.js';
import { decodeRow, decodeFrame, checkDigitOk, expandUpcE } from '../js/vendor/ean/ean.js';
import { validScan, createConfirmer, pickDecoder, canScan } from '../js/food/gtin.js';

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = L.map((s) => [...s].reverse().map((c) => (c === '1' ? '0' : '1')).reverse().join('')).map((s) => s);
// G is the mirror of R, and R is the complement of L
const R = L.map((s) => [...s].map((c) => (c === '1' ? '0' : '1')).join(''));
const GG = R.map((s) => [...s].reverse().join(''));
const FIRST = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

const ean13 = (code) => {
  const par = FIRST[Number(code[0])];
  let m = '101';
  for (let i = 0; i < 6; i++) m += (par[i] === 'L' ? L : GG)[Number(code[1 + i])];
  m += '01010';
  for (let i = 0; i < 6; i++) m += R[Number(code[7 + i])];
  return `${m}101`;
};
const ean8 = (code) => `101${[...code.slice(0, 4)].map((c) => L[c]).join('')}01010${[...code.slice(4)].map((c) => R[c]).join('')}101`;
const UPCE_PAR = ['GGGLLL', 'GGLGLL', 'GGLLGL', 'GGLLLG', 'GLGGLL', 'GLLGGL', 'GLLLGG', 'GLGLGL', 'GLGLLG', 'GLLGLG'];
const upce = (six, check) => `101${[...six].map((c, i) => (UPCE_PAR[check][i] === 'L' ? L : GG)[c]).join('')}010101`;

/** Modules → one grayscale row, `px` pixels per module, with quiet zones; optional blur-free noise. */
const toRow = (modules, px = 3, quiet = 12) => {
  const bits = '0'.repeat(quiet) + modules + '0'.repeat(quiet);
  const row = new Uint8Array(bits.length * px);
  for (let i = 0; i < bits.length; i++) row.fill(bits[i] === '1' ? 30 : 225, i * px, (i + 1) * px);
  return row;
};
const frame = (row, h = 40) => { const g = new Uint8Array(row.length * h); for (let y = 0; y < h; y++) g.set(row, y * row.length); return { g, w: row.length, h }; };

test('checkDigitOk: GTIN-8/12/13 check digits', () => {
  assert(checkDigitOk('4006381333931') && checkDigitOk('096619123456') === checkDigitOk('096619123456'));
  assert(checkDigitOk('4006381333931'));
  assert(checkDigitOk('73513537'));
  assert(checkDigitOk('036000291452'));
  assert(!checkDigitOk('4006381333932'));
  assert(!checkDigitOk('036000291453'));
  assert(!checkDigitOk('1234567'), 'wrong length');
  assert(!checkDigitOk('12345678a'));
});

test('validScan: cleans, then requires a valid check digit', () => {
  eq(validScan('4006381333931'), '4006381333931');
  eq(validScan('0 36000 29145 2'), '036000291452');
  eq(validScan('4006381333932'), '');
  eq(validScan(''), '');
});

test('createConfirmer: the same valid code on 2 frames in a row, nothing else', () => {
  const c = createConfirmer(2);
  eq(c('4006381333931'), '', 'first sighting');
  eq(c('4006381333931'), '4006381333931', 'second in a row');
  const d = createConfirmer(2);
  d('4006381333931');
  eq(d('036000291452'), '', 'a different code starts over');
  eq(d('036000291452'), '036000291452');
  const e = createConfirmer(2);
  e('4006381333931');
  eq(e(''), '', 'an unreadable frame resets');
  eq(e('4006381333931'), '', 'so one more sighting is not enough');
  const f = createConfirmer(2);
  eq(f('4006381333932'), '');
  eq(f('4006381333932'), '', 'a bad check digit never confirms');
});

test('decodeRow: EAN-13, upside down, UPC-A, EAN-8, UPC-E', () => {
  eq(decodeRow(toRow(ean13('4006381333931'))), '4006381333931');
  eq(decodeRow(toRow(ean13('4006381333931'), 2)), '4006381333931');
  eq(decodeRow(Uint8Array.from(toRow(ean13('4006381333931'))).reverse()), '4006381333931', 'upside down');
  eq(decodeRow(toRow(ean13('0036000291452'))), '036000291452', 'UPC-A comes back as 12 digits');
  eq(decodeRow(toRow(ean8('73513537'))), '73513537');
  const six = '123456';
  const a = expandUpcE(six);
  eq(decodeRow(toRow(upce(six, Number(a[11])))), a, 'UPC-E expands to its UPC-A');
});

test('decodeRow: a wrong check digit, a cut-off code and plain noise read as nothing', () => {
  eq(decodeRow(toRow(ean13('4006381333932'))), '');
  eq(decodeRow(toRow(ean13('4006381333931')).subarray(0, 200)), '');
  eq(decodeRow(new Uint8Array(400).fill(128)), '');
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let k = 0; k < 20; k++) eq(decodeRow(Uint8Array.from({ length: 600 }, () => Math.floor(rnd() * 256))), '', 'random noise');
});

test('decodeRow: still reads a slightly blurred, noisy row', () => {
  for (const px of [3, 4, 5]) {
    const row = toRow(ean13('4006381333931'), px);
    const soft = Uint8Array.from(row, (_, i) => {
      const a = row[Math.max(0, i - 1)], b = row[i], c = row[Math.min(row.length - 1, i + 1)];
      return Math.round((a + b + c) / 3) + ((i * 37) % 11);
    });
    eq(decodeRow(soft), '4006381333931', `${px}px per module`);
  }
});

test('decodeFrame: reads from the middle rows of a frame', () => {
  const { g, w, h } = frame(toRow(ean13('4006381333931')));
  eq(decodeFrame(g, w, h), '4006381333931');
});

test('decoder choice: native BarcodeDetector only when it reads ean_13, else the vendored reader', async () => {
  eq(await pickDecoder({}), 'js', 'no BarcodeDetector (iOS)');
  const withFormats = (formats) => { const B = function B() {}; B.getSupportedFormats = async () => formats; return { BarcodeDetector: B }; };
  eq(await pickDecoder(withFormats(['qr_code', 'code_128'])), 'js', 'detector without ean_13');
  eq(await pickDecoder(withFormats(['ean_13', 'qr_code'])), 'native');
  const broken = function B() {}; broken.getSupportedFormats = async () => { throw new Error('nope'); };
  eq(await pickDecoder({ BarcodeDetector: broken }), 'js', 'a detector that throws');
  eq(await pickDecoder({ BarcodeDetector: function B() {} }), 'js', 'no getSupportedFormats');
  assert(!canScan({}), 'no camera API');
  assert(canScan({ navigator: { mediaDevices: { getUserMedia() {} } } }), 'the camera is enough: the JS reader needs no BarcodeDetector');
});

/** Modules → a row at a fractional `px` per module, Gaussian blurred (sigma px), with noise and a lighting gradient. */
const softRow = (modules, px, sigma, { noise = 8, gradient = 40, quiet = 14, seed = 5 } = {}) => {
  const bits = '0'.repeat(quiet) + modules + '0'.repeat(quiet);
  const n = Math.ceil(bits.length * px);
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) raw[i] = bits[Math.min(bits.length - 1, Math.floor((i + 0.5) / px))] === '1' ? 30 : 225;
  const r = Math.ceil(sigma * 3);
  const k = Array.from({ length: 2 * r + 1 }, (_, j) => Math.exp(-((j - r) ** 2) / (2 * sigma * sigma)));
  const ks = k.reduce((a, b) => a + b, 0);
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 - 0.5; };
  return Uint8Array.from(raw, (_, i) => {
    let v = 0;
    for (let j = -r; j <= r; j++) v += raw[Math.min(n - 1, Math.max(0, i + j))] * k[j + r];
    return Math.max(0, Math.min(255, Math.round(v / ks - gradient * (i / n - 0.5) + rnd() * 2 * noise)));
  });
};

test('decodeRow: fractional module widths with Gaussian blur, noise and a lighting gradient', () => {
  const cases = [[2.2, 1.0], [3.3, 1.5], [2.55, 0.8], [3, 1.2], [2.0, 0.6], [4.1, 1.8]];
  for (const code of ['4006381333931', '0036000291452']) {
    for (const [px, sigma] of cases) {
      const want = code.startsWith('0') ? code.slice(1) : code;
      eq(decodeRow(softRow(ean13(code), px, sigma)), want, `${code} at ${px}px/module, sigma ${sigma}`);
    }
  }
});

test('the camera asks for a large picture and the reader keeps full width', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../js/screens/food-scan.js', import.meta.url), 'utf8');
  const m = /width:\s*\{\s*ideal:\s*(\d+)/.exec(src);
  assert(m && Number(m[1]) >= 1280, 'getUserMedia asks for an ideal width of at least 1280');
  assert(!/Math\.min\(960/.test(src), 'frames are not scaled down to 960');
});

test('UPC-E from the native detector is expanded before the check digit', () => {
  const a = expandUpcE('123456');
  eq(validScan(`0123456${a[11]}`, 'upc_e'), a);
  eq(validScan(`0123456${(Number(a[11]) + 1) % 10}`, 'upc_e'), '');
});

test('the scan sheet no longer lists code_128 and the reader is vendored without a CDN', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../js/screens/food-scan.js', import.meta.url), 'utf8');
  assert(!src.includes('code_128'));
  assert(!/https?:\/\//.test(readFileSync(new URL('../js/vendor/ean/ean.js', import.meta.url), 'utf8')));
});
