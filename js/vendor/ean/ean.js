// A small barcode reader for food packages: EAN-13, EAN-8, UPC-A and UPC-E only (Forge, MIT-style, no dependencies).
// It exists because iOS Safari and WKWebView have no BarcodeDetector. Pure functions on grayscale pixels, so it runs in
// Node tests too. decodeFrame(gray, width, height) → a digit string whose check digit is valid, or ''. The caller
// still waits for the same code on 2 frames in a row (js/food/gtin.js).

const L = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'].map((s) => [...s].map(Number));
const G = L.map((p) => [...p].reverse());
const FIRST = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
const UPCE_CHECK = ['GGGLLL', 'GGLGLL', 'GGLLGL', 'GGLLLG', 'GLGGLL', 'GLLGGL', 'GLLLGG', 'GLGLGL', 'GLGLLG', 'GLLGLG'];

/** True when the digit string's last digit is the correct GTIN check digit. */
export function checkDigitOk(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  let sum = 0;
  for (let i = code.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += Number(code[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]);
}

/** One digit from 4 run widths (pixels) starting at i: { d, p: 'L' | 'G' } or null. */
function digitAt(w, i, withG) {
  if (i + 3 >= w.length) return null;
  const u = (w[i] + w[i + 1] + w[i + 2] + w[i + 3]) / 7;
  if (!(u > 0)) return null;
  let best = null;
  let bestErr = Infinity;
  for (const [p, tbl] of withG ? [['L', L], ['G', G]] : [['L', L]]) {
    for (let d = 0; d < 10; d++) {
      let err = 0;
      let ok = true;
      for (let k = 0; k < 4; k++) {
        const e = Math.abs(w[i + k] / u - tbl[d][k]);
        if (e > 0.6) { ok = false; break; }
        err += e;
      }
      if (ok && err < bestErr) { bestErr = err; best = { d, p }; }
    }
  }
  return best;
}

/** The end guard's last bar is followed by a quiet zone (or the picture ends). */
const quietAfter = (w, i, u) => i + 1 >= w.length || w[i + 1] >= u * 2.5;

const guardOk = (w, i, n, u) => {
  if (i + n > w.length) return false;
  for (let k = 0; k < n; k++) if (w[i + k] / u < 0.4 || w[i + k] / u > 2.2) return false;
  return true;
};

function readSide(w, pos, n, withG) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const m = digitAt(w, pos + k * 4, withG);
    if (!m) return null;
    out.push(m);
  }
  return out;
}

/** A UPC-E (6 digits, number system 0) → the 12-digit UPC-A it stands for. */
export function expandUpcE(six) {
  const d = six.split('').map(Number);
  const [a, b, c, e, f, g] = d;
  let body;
  if (g <= 2) body = [a, b, g, 0, 0, 0, 0, c, e, f];
  else if (g === 3) body = [a, b, c, 0, 0, 0, 0, 0, e, f];
  else if (g === 4) body = [a, b, c, e, 0, 0, 0, 0, 0, f];
  else body = [a, b, c, e, f, 0, 0, 0, 0, g];
  const eleven = `0${body.join('')}`;
  let sum = 0;
  for (let i = 10, wt = 3; i >= 0; i--, wt = 4 - wt) sum += Number(eleven[i]) * wt;
  return `${eleven}${(10 - (sum % 10)) % 10}`;
}

/** Try each reading of the runs starting at the start guard `s` (index of its first bar). */
function readAt(w, s, u) {
  const pos = s + 3;
  // EAN-13 (and UPC-A, which is EAN-13 with a leading 0)
  const left = readSide(w, pos, 6, true);
  if (left && guardOk(w, pos + 24, 5, u)) {
    const right = readSide(w, pos + 29, 6, false);
    const first = left && FIRST.indexOf(left.map((m) => m.p).join(''));
    if (right && first >= 0 && pos + 55 < w.length && quietAfter(w, pos + 55, u)) {
      const code = `${first}${left.map((m) => m.d).join('')}${right.map((m) => m.d).join('')}`;
      if (checkDigitOk(code)) return code.startsWith('0') ? code.slice(1) : code;
    }
  }
  // EAN-8
  const l4 = readSide(w, pos, 4, false);
  if (l4 && guardOk(w, pos + 16, 5, u)) {
    const r4 = readSide(w, pos + 21, 4, false);
    if (r4 && pos + 39 < w.length && quietAfter(w, pos + 39, u)) {
      const code = [...l4, ...r4].map((m) => m.d).join('');
      if (checkDigitOk(code)) return code;
    }
  }
  // UPC-E
  const six = left || readSide(w, pos, 6, true);
  if (six && pos + 29 < w.length && guardOk(w, pos + 24, 6, u) && quietAfter(w, pos + 29, u)) {
    const check = UPCE_CHECK.indexOf(six.map((m) => m.p).join(''));
    if (check >= 0) {
      const a = expandUpcE(six.map((m) => m.d).join(''));
      if (Number(a[11]) === check) return a;
    }
  }
  return '';
}

/** Run widths of one pixel row. Returns { w: widths, dark: whether run 0 is a bar }. */
function runsOf(row) {
  const n = row.length;
  // Dark means below the middle of the row's own light and dark levels (5th and 95th percentile), which keeps bar
  // widths even when the picture is a little soft.
  const sorted = Uint8Array.from(row).sort();
  const lo = sorted[Math.floor(n * 0.05)];
  const hi = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
  if (hi - lo < 40) return { w: [n], dark0: false }; // flat: no barcode here
  const cut = (lo + hi) / 2;
  const w = [];
  let dark0 = false;
  let cur = null;
  let len = 0;
  for (let i = 0; i < n; i++) {
    const dark = row[i] < cut;
    if (cur === null) { cur = dark; dark0 = dark; len = 1; } else if (dark === cur) len++;
    else { w.push(len); cur = dark; len = 1; }
  }
  w.push(len);
  return { w, dark0 };
}

function scanRuns(w, dark0) {
  for (let i = dark0 ? 0 : 1; i + 3 < w.length; i += 2) {
    const u = (w[i] + w[i + 1] + w[i + 2]) / 3;
    if (u < 1) continue;
    if (Math.max(w[i], w[i + 1], w[i + 2]) > u * 1.8 || Math.min(w[i], w[i + 1], w[i + 2]) < u * 0.5) continue;
    if (i > 0 && w[i - 1] < u * 2.5) continue; // a start guard sits after a quiet zone
    const code = readAt(w, i, u);
    if (code) return code;
  }
  return '';
}

/** One row of grayscale pixels (0 dark … 255 light), right way up or upside down → digits or ''. */
export function decodeRow(row) {
  const { w, dark0 } = runsOf(row);
  const a = scanRuns(w, dark0);
  if (a) return a;
  // upside down: the same runs read from the other end; the last run's colour decides where the first bar is
  const rev = [...w].reverse();
  const lastDark = (w.length % 2 === 1) ? dark0 : !dark0;
  return scanRuns(rev, lastDark);
}

/** A grayscale frame → digits or ''. Looks at a few rows through the middle, where the barcode should be held. */
export function decodeFrame(gray, width, height) {
  for (const f of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74]) {
    const y = Math.min(height - 1, Math.max(0, Math.round(height * f)));
    const code = decodeRow(gray.subarray(y * width, (y + 1) * width));
    if (code) return code;
  }
  return '';
}
