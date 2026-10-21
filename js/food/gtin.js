// Camera barcode helpers (pure, unit tested): the GTIN check digit, the "same code on 2 frames in a row" rule, and the
// choice between the phone's own BarcodeDetector and the vendored JS reader (js/vendor/ean). iOS has no BarcodeDetector.
import { cleanBarcode } from './off.js';
import { checkDigitOk } from '../vendor/ean/ean.js';

export { checkDigitOk };

/** A scanned code is usable only when it is 8–14 digits with a valid GTIN check digit (8, 12, 13 or 14 long). */
export const validScan = (text) => {
  const c = cleanBarcode(text);
  return c && checkDigitOk(c) ? c : '';
};

/** push(code) → the code once it was read on `need` frames in a row, else ''. An unreadable frame ('') or a different code starts over. */
export function createConfirmer(need = 2) {
  let last = '';
  let n = 0;
  return (code) => {
    const c = validScan(code);
    if (!c) { last = ''; n = 0; return ''; }
    if (c === last) n++; else { last = c; n = 1; }
    return n >= need ? c : '';
  };
}

/** 'native' when the browser's BarcodeDetector reads EAN-13, else 'js' (the vendored reader). */
export async function pickDecoder(env = globalThis) {
  try {
    if (typeof env.BarcodeDetector === 'function' && typeof env.BarcodeDetector.getSupportedFormats === 'function') {
      const formats = await env.BarcodeDetector.getSupportedFormats();
      if (Array.isArray(formats) && formats.includes('ean_13')) return 'native';
    }
  } catch { /* fall through to the JS reader */ }
  return 'js';
}

/** The camera itself is needed either way. */
export const canScan = (env = globalThis) => !!(env.navigator && env.navigator.mediaDevices && env.navigator.mediaDevices.getUserMedia);
