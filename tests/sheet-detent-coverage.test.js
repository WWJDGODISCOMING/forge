import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const OPT = /\{ detents: \['medium', 'large'\] \}/;

// The text of one sheet() call: from its opening to the next sheet( in the file (or the end).
function sheetBody(file, opener) {
  const src = read(file);
  const at = src.indexOf(opener);
  assert(at >= 0, `${file}: found ${opener}`);
  const next = src.indexOf('sheet(', at + opener.length);
  return src.slice(at, next < 0 ? src.length : next);
}

const TALL = [
  ['js/screens/food.js', "sheet('Log food'"],
  ['js/screens/food.js', "sheet('My foods'"],
  ['js/screens/snap.js', "sheet('Snap a meal'"],
  ['js/screens/train.js', "sheet('Change workout'"],
  ['js/screens/howto.js', 'sheet(ex.name'],
  ['js/screens/food-plan.js', 'sheet(meal.name'],
  ['js/screens/food-plan.js', "sheet('Grocery list'"],
  ['js/screens/food-plan.js', "sheet('Sunday prep'"],
];
const SHORT = [
  ['js/screens/weight.js', "sheet('Log weight'"],
  ['js/screens/session.js', "sheet(ex.name || 'Exercise'"],
  ['js/screens/session.js', "sheet('Timer'"],
  ['js/screens/overlays.js', "sheet('Finish workout'"],
  ['js/screens/tools.js', "sheet('Log cardio'"],
  ['js/screens/settings.js', "sheet('Delete everything'"],
  ['js/screens/withings.js', "sheet('Disconnect Withings'"],
];

test('tall sheets pass detents medium + large', () => {
  for (const [f, o] of TALL) assert(OPT.test(sheetBody(f, o)), `${f} ${o}`);
});

test('short sheets do not pass detents', () => {
  for (const [f, o] of SHORT) assert(!/detents/.test(sheetBody(f, o)), `${f} ${o}`);
});
