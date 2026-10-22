// v0.16.48: deficit on the Today calories line, Programs "Change start date", burned stays fresh. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { programStatus, checkStart, weekBounds } from '../js/body-programs/core.js';
import { indexDays } from '../js/missions/core.js';
import { dayBalance, deficitText, deficitShort } from '../js/nutrition/balance.js';
import { watchForeground, FOREGROUND_GAP_MS } from '../js/native/autoread.js';

const done = (day) => ({ id: `w${day}`, status: 'done', started_at: `${day}T12:00:00`, exercises: [], prs: [] });
const mk = (workouts = []) => ({ idx: indexDays({ weights: [], workouts, cardio: [], healthDaily: [] }), series: [], progress: [], trainingDays: 3, steps: 8000, band: null, units: 'imperial' });
const data = mk();
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

test('Today deficit: the same number and wording as the Food card, just shorter', () => {
  const b = dayBalance({ eaten: 1085, active: 338, basal: 1757 });
  eq(b.deficit, 1010);
  eq(deficitShort(b.deficit, b.eaten), '1,010 deficit');
  assert(deficitText(b.deficit, b.eaten).startsWith('1,010 '), 'Food card says the same number');
  eq(deficitShort(-210, 1600), '210 over');
  eq(deficitShort(0, 1600), 'Even');
  eq(deficitShort(500, 0), '');
});

test('Today deficit: ceiling is the Settings value and the colours match the Food card', () => {
  const ui = src('../js/screens/balance-ui.js');
  const today = src('../js/screens/today.js');
  assert(today.includes('of ${n(t.calories)} kcal</small></p>\n      ${todayDeficitHtml()}'), 'ceiling is t.calories, deficit sits right under it');
  assert(ui.includes("b.partial ? 'now' : b.deficit > 0 ? 'good' : 'over'"), 'same colour classes as the Food card');
  assert(ui.includes('deficitShort(b.deficit, b.eaten)'), 'same balance object as the Food card');
});

test('start moved to 2026-10-19: week 1 is Oct 19-25, weeks recompute', () => {
  eq(weekBounds('2026-10-19', 0).start, '2026-10-19');
  eq(weekBounds('2026-10-19', 0).end, '2026-10-25');
  const st = programStatus({ id: 'cut4', started: '2026-10-19' }, '2026-10-22', data);
  eq(st.weekNo, 1);
  eq(st.weeks[3].end, '2026-11-15');
  const old = programStatus({ id: 'cut4', started: '2026-10-22' }, '2026-10-22', data);
  eq(old.weeks[0].start, '2026-10-22');
  const later = programStatus({ id: 'cut4', started: '2026-10-19' }, '2026-10-27', data);
  eq(later.weekNo, 2);
  eq(later.weeks[0].state, 'past');
  // goals re-evaluate from data already logged: a workout on Oct 19 sits in week 1 only once the start moves back to it
  const w = [done('2026-10-19')];
  const count = (started) => programStatus({ id: 'cut4', started }, '2026-10-22', mk(w)).weeks[0].goals.map((g) => JSON.stringify(g)).join();
  assert(count('2026-10-19') !== count('2026-10-22'), 'week 1 goals changed with the start date');
});

test('start date check: today and past dates pass, future and junk are rejected', () => {
  eq(checkStart('2026-10-22', '2026-10-22').ok, true);
  eq(checkStart('2026-10-19', '2026-10-22').ok, true);
  eq(checkStart('2025-01-01', '2026-10-22').ok, true);
  eq(checkStart('2026-10-23', '2026-10-22').ok, false);
  for (const bad of ['', null, 'nope', '2026-02-31', '2026-13-01']) eq(checkStart(bad, '2026-10-22').ok, false, String(bad));
});

test('change start date only rewrites body_program.started; Undo puts the old one back', () => {
  const store = src('../js/body-programs/store.js');
  assert(store.includes("patch('settings', 'main', { body_program: { ...p, started: day } })"), 'only the start changes');
  assert(store.includes('checkStart(day, today())'), 'future dates refused in the store');
  const ui = src('../js/screens/program.js');
  assert(ui.includes("label: 'Undo'") && ui.includes('changeStartDate(r.previous)'), 'Undo restores the previous start');
  assert(ui.includes('haptics.light()'), 'light haptic');
  assert(ui.includes('max="${today}"'), 'date picker capped at today');
  assert(ui.indexOf('data-program-start') < ui.indexOf('data-program-end'), 'next to End program');
});

test('foreground event triggers a refresh, throttled', () => {
  const ls = [];
  const doc = { visibilityState: 'hidden', addEventListener: (_, f) => ls.push(f), removeEventListener: (_, f) => ls.splice(ls.indexOf(f), 1) };
  let t = 1000000;
  let n = 0;
  const stop = watchForeground(doc, () => n++, { now: () => t });
  ls.forEach((f) => f()); eq(n, 0); // still hidden
  doc.visibilityState = 'visible';
  ls.forEach((f) => f()); eq(n, 1);
  t += 10000; ls.forEach((f) => f()); eq(n, 1); // too soon
  t += FOREGROUND_GAP_MS; ls.forEach((f) => f()); eq(n, 2);
  stop(); eq(ls.length, 0);
});

test('app wires the foreground refresh and the periodic one covers Today and Food', () => {
  const app = src('../js/app.js');
  assert(app.includes('watchForeground(document, () => autoHealth({ force: true }))'));
  assert(app.includes("['today', 'food'].includes(currentRoute())"));
});
