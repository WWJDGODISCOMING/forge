// v0.16.38: default rest between sets. Synthetic workouts only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { generateWorkout, minutesFor, planMinutes } from '../js/workouts/generator.js';
import { EXERCISES } from '../js/workouts/exercises.js';
import { LOCATION_PRESETS } from '../js/workouts/equipment.js';
import { buildQueue, restAfter, autoRest, restDefaultSec, fmtClock, restDefaultTitle, REST, REST_DEFAULT_CHOICES } from '../js/workouts/session-core.js';

const set = (o = {}) => ({ target_reps: 8, ...o });
const plan = (extra = {}) => [{ exercise_id: 'x', role: 'main', sets: [set({ warmup: true }), set(), set()], ...extra }];
const rest = (e, k, opts) => restAfter(buildQueue(e), e, k, {}, opts);

test('stored value is read; missing or bad values fall back to 1:00', () => {
  for (const v of [30, 45, 60, 90, 120, 180]) eq(restDefaultSec({ rest_default_sec: v }), v);
  for (const bad of [undefined, null, '60', 0, 999, 150, NaN]) eq(restDefaultSec({ rest_default_sec: bad }), 60, String(bad));
  eq(restDefaultSec(undefined), 60);
});

test('the player rests the default after a working set', () => {
  eq(rest(plan(), 1, { defaultSec: 90 }).sec, 90);
  eq(rest(plan(), 2, { defaultSec: 60 }).sec, 60);
  eq(rest(plan({ role: 'accessory' }), 1, { defaultSec: 30 }).sec, 30);
  eq(rest(plan(), 1, { deload: true, defaultSec: 60 }).sec, 60, 'a rest you picked is never cut for a deload');
});

test("an exercise's own rest wins over the default", () => {
  eq(rest(plan({ rest_sec: 150 }), 1, { defaultSec: 60 }).sec, 150);
  eq(rest(plan({ rest_sec: 90 }), 1, { deload: true, defaultSec: 60 }).sec, 90);
});

test('warm-ups never rest longer than the default', () => {
  eq(rest(plan(), 0, { defaultSec: 30 }).sec, 30);
  eq(rest(plan(), 0, { defaultSec: 60 }).sec, REST.warmup);
});

test('timed and superset end-of-round use the default; mid-round stays no rest', () => {
  const t = plan({ role: 'accessory' });
  eq(restAfter(buildQueue(t), t, 1, { timed: true }, { defaultSec: 45 }).sec, 45);
  const ss = [{ exercise_id: 'a', role: 'accessory', superset: 'A', sets: [set(), set()] }, { exercise_id: 'b', role: 'accessory', superset: 'A', sets: [set(), set()] }];
  const q = buildQueue(ss);
  eq(restAfter(q, ss, 0, {}, { defaultSec: 60 }), null);
  eq(restAfter(q, ss, 1, {}, { defaultSec: 60 }).sec, 60);
  eq(restAfter(q, ss, 1, {}, { defaultSec: 60 }).label, 'Rest (superset)');
});

test('without a default, rest is by exercise type as before', () => {
  eq(rest(plan(), 1, {}).sec, REST.main);
  eq(rest(plan(), 1, { deload: true }).sec, 120);
  eq(rest(plan(), 1, { defaultSec: 'x' }).sec, REST.main);
});

test('autoRest matches what the player returns (the ⋯ "Auto" label)', () => {
  for (const defaultSec of [null, 60, 120]) for (const deload of [false, true]) {
    const e = plan();
    eq(autoRest(e[0], {}, { deload, defaultSec }), rest(e, 1, { deload, defaultSec }).sec);
  }
  eq(autoRest({ role: 'accessory' }, { timed: true }, {}), REST.timed, 'timed label fix');
});

test('labels and wiring', () => {
  eq(fmtClock(60), '1:00'); eq(fmtClock(30), '0:30'); eq(fmtClock(180), '3:00');
  eq(restDefaultTitle({}), 'Rest between sets · 1:00');
  eq(restDefaultTitle({ rest_default_sec: 90 }), 'Rest between sets · 1:30');
  assert(readFileSync('sw.js', 'utf8').includes("'./js/screens/rest-default.js'"), 'in the app shell');
  assert(readFileSync('js/workouts/live.js', 'utf8').includes('restDefaultSec(state.settings)'), 'live.js passes the setting');
});

// ---------- plan length follows the rest ----------
const HOME = LOCATION_PRESETS.find((l) => l.key === 'home');
const gen = (rest_default_sec) => generateWorkout({
  programKey: 'full_body_3x', dayType: 'full_a', location: HOME, unit: 'lb', exercises: EXERCISES,
  profile: { experience: 'intermediate', sessionMin: 240, trainingDays: 4, injuries: '' }, settings: { rest_default_sec },
});

test('minutes per set = work + rest, and the old rests give the old 3.5 / 3 / 2', () => {
  const ex = { reps: [8, 12] };
  eq(minutesFor(ex, 1, 'main', {}, 150), 3.5);
  eq(minutesFor(ex, 1, 'secondary', {}, 120), 3);
  eq(minutesFor(ex, 1, 'accessory', {}, 75), 2);
  eq(minutesFor({ timed: true, reps: [30, 30] }, 2, 'accessory', { reps: 30 }, 60), 3);
});

test('est_minutes drops when the default goes from 3:00 to 1:00', () => {
  const long = gen(180);
  const short = gen(60);
  assert(long.exercises.length && long.exercises.length === short.exercises.length, 'same workout');
  assert(short.est_minutes < long.est_minutes - 10, `${short.est_minutes} vs ${long.est_minutes}`);
});

test('the pill follows a rest picked in ⋯ (planMinutes)', () => {
  const p = gen(60);
  const before = p.est_minutes;
  eq(planMinutes(p, EXERCISES, 60), before);
  p.exercises[0].rest_sec = 240;
  eq(planMinutes(p, EXERCISES, 60), Math.round(before + p.exercises[0].target.sets * 3));
});

// ---------- rest sheets: even grids, one time format ----------
test('rest sheets use even grids and m:ss labels only', () => {
  const css = readFileSync('css/app.css', 'utf8');
  assert(/\.chips--grid-6 \{ grid-template-columns: repeat\(6/.test(css) && /\.chips--grid \{[^}]*repeat\(3/.test(css), 'six chips: 3 x 2 on phones, 6 across when wide');
  const def = readFileSync('js/screens/rest-default.js', 'utf8');
  assert(def.includes('chips--grid chips--grid-6'), 'Settings sheet uses the grid');
  eq(REST_DEFAULT_CHOICES.length % 3, 0);
  const tr = readFileSync('js/screens/train.js', 'utf8');
  assert(tr.includes('chips--grid-4') && tr.includes('chip-wide'), '⋯ sheet: wide first chip, then 4 columns');
  assert(!tr.includes('fmtRest') && !/\} min`/.test(tr.split('function exerciseMore')[1]), 'no "min" labels in the rest chips');
  assert(tr.includes('Default (${fmtClock(auto)})'), 'first chip says Default');
  const REST_CHOICES = tr.match(/const REST_CHOICES = \[([^\]]+)\]/)[1].split(',').length;
  eq(REST_CHOICES % 4, 0, 'eight chips fill 4 columns');
});
