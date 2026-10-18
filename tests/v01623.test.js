// v0.16.23: "Jog in place" in Log cardio. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { VERSION } from '../js/version.js';

test('v0.16.23: version bumped', () => { eq(VERSION, '0.16.23'); });

test('Jog in place is offered right after Run, with its label and no distance', () => {
  const src = readFileSync(new URL('../js/screens/tools.js', import.meta.url), 'utf8');
  const m = src.match(/export const CARDIO_TYPES = \{([\s\S]*?)\n\};/);
  assert(m, 'CARDIO_TYPES found');
  const keys = [...m[1].matchAll(/(\w+): '([^']+)'/g)];
  const idx = keys.findIndex((k) => k[1] === 'jog_in_place');
  assert(idx > 0, 'offered');
  eq(keys[idx][2], 'Jog in place');
  eq(keys[idx - 1][1], 'run');
  assert(src.includes("NO_DISTANCE = ['jog_in_place']"), 'no distance for jog in place');
});
