// Run all unit tests:   node tests/run.js
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { test, eq, assert, runAll } from './harness.js';
import './units.test.js';
import './targets.test.js';
import './smoothing.test.js';
import './workouts.test.js';
import './csv.test.js';
import './session.test.js';
import './figure.test.js';
import './homeposes.test.js';
import './kbposes.test.js';
import './gymposes.test.js';
import './cardioposes.test.js';
import './goalpath-dates.test.js';
import './bodymap.test.js';
import './preview.test.js';
import './rings.test.js';
import './withings.test.js';
import './awards.test.js';
import './tour.test.js';
import './native.test.js';
import './polish.test.js';
import './health.test.js';
import './shell.test.js';
import './restyle.test.js';
import './trends.test.js';
import './photos.test.js';
import './coach.test.js';
import './coach-v0143.test.js';
import './missions.test.js';
import './longterm.test.js';
import './report.test.js';
import './bodyprograms.test.js';
import './readiness-trends.test.js';
import './food.test.js';
import './v0153.test.js';
import './v0154.test.js';
import './v0154pdf.test.js';
import './v0159.test.js';
import './v0156.test.js';
import './v0157.test.js';
import './v0158.test.js';
import './v01510.test.js';
import './layout.test.js';
import { VERSION } from '../js/version.js';

test('sw.js VERSION matches js/version.js', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const m = sw.match(/const VERSION = '([^']+)'/);
  eq(m && m[1], VERSION);
});

test('every JS module and stylesheet is in the offline app shell (sw.js)', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const walk = (dir) => readdirSync(new URL(`../${dir}`, import.meta.url)).flatMap((f) => {
    const rel = `${dir}/${f}`;
    return statSync(new URL(`../${rel}`, import.meta.url)).isDirectory() ? walk(rel) : [rel];
  });
  for (const f of [...walk('js'), ...walk('css')]) assert(sw.includes(`'./${f}'`), `${f} missing from SHELL`);
});

const { fail } = await runAll();
process.exit(fail ? 1 : 0);
