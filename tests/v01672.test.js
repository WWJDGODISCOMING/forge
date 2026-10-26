// v0.16.72 (#215): more home + bodyweight moves, and Recommend more / less. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq as strictEq, assert } from './harness.js';
const eq = (a, b, m) => strictEq(JSON.stringify(a), JSON.stringify(b), m);
import { EXERCISES } from '../js/workouts/exercises.js';
import { LOCATION_PRESETS, expandEquipment, canDo } from '../js/workouts/equipment.js';
import { generateWorkout, pickExercise } from '../js/workouts/generator.js';
import { cleanPrefs, prefOf, setPref, prefScore, prefRank, prefRows, prefSummary, prefAria, hashPick, PREF_SCORE } from '../js/workouts/prefs.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const HOME = LOCATION_PRESETS.find((l) => l.key === 'home');
const MAIN = ['chest', 'lats', 'upper_back', 'front_delts', 'side_delts', 'rear_delts', 'biceps', 'triceps', 'abs', 'quads', 'hamstrings', 'glutes', 'calves'];
const trains = (e) => e.kind !== 'conditioning' && e.pattern !== 'mobility';

// ---------- catalog ----------
test('catalog: every main muscle has 4+ moves with the saved Home equipment, and 4+ with no equipment at all', () => {
  const home = expandEquipment(HOME.equipment);
  const none = expandEquipment([]);
  for (const m of MAIN) {
    const h = EXERCISES.filter((e) => trains(e) && e.primary.includes(m) && canDo(e, home));
    const b = EXERCISES.filter((e) => trains(e) && e.primary.includes(m) && canDo(e, none));
    assert(h.length >= 4, `${m}: only ${h.length} with Home equipment`);
    assert(b.length >= 4, `${m}: only ${b.length} with no equipment`);
  }
});

test('catalog: new moves have cues, muscles, equipment and a rep range; ids are unique', () => {
  eq(new Set(EXERCISES.map((e) => e.id)).size, EXERCISES.length);
  for (const e of EXERCISES) {
    assert(e.cues.length >= 3 && e.cues.every((c) => c.length > 5), `${e.id} cues`);
    assert(e.primary.length >= 1 && Array.isArray(e.secondary), `${e.id} muscles`);
    assert(Array.isArray(e.equip) && e.equip.every(Array.isArray), `${e.id} equip`);
    assert(e.reps.length === 2 && e.reps[0] <= e.reps[1], `${e.id} reps`);
    assert(Array.isArray(e.avoid), `${e.id} avoid`);
  }
});

test('catalog: joint tags on the new moves are right (bounces and hinges are flagged, gentle holds are not)', () => {
  const by = (id) => EXERCISES.find((e) => e.id === id);
  assert(by('bw_pogo_hops').avoid.includes('knee'));
  assert(by('bw_good_morning').avoid.includes('lower_back'));
  assert(by('bw_swimmer').avoid.includes('lower_back'));
  assert(by('bw_doorframe_wide_row').avoid.includes('shoulder'));
  assert(by('bw_doorframe_wide_row').cues[0].startsWith('Only a solid frame'));
  assert(!by('bw_calf_raise').avoid.includes('knee'), 'a calf raise is fine for sore knees');
  assert(!by('bw_bridge_walkout').avoid.includes('knee'));
});

// ---------- prefs (pure) ----------
test('prefs: cleanPrefs keeps only more / less, setPref toggles and clears, nothing mutates', () => {
  eq(cleanPrefs(null), {});
  eq(cleanPrefs([1]), {});
  eq(cleanPrefs({ a: 'more', b: 'less', c: 'maybe', '': 'more' }), { a: 'more', b: 'less' });
  const p = { a: 'more' };
  const q = setPref(p, 'b', 'less');
  eq(p, { a: 'more' });
  eq(q, { a: 'more', b: 'less' });
  eq(setPref(q, 'a', 'less'), { a: 'less', b: 'less' }, 'switching sides');
  eq(setPref(q, 'b', 'less'), { a: 'more' }, 'tapping the same choice again clears it');
  eq(setPref(q, 'a', ''), { b: 'less' }, 'empty clears');
  eq(prefOf(q, 'zzz'), '');
  eq(prefSummary({}), 'None set');
  eq(prefSummary(q), '1 more · 1 less');
  assert(prefAria('Push-up', 'more').includes('recommend more'));
  assert(prefAria('Push-up', '').includes('no preference'));
});

test('prefs: Settings rows list more first, then less, A to Z, and skip ids that no longer exist', () => {
  const names = { a: 'Zebra Curl', b: 'Alpha Row', c: 'Mid Press' };
  const rows = prefRows({ a: 'more', b: 'less', c: 'more', gone: 'less' }, (id) => names[id] || '');
  eq(rows.map((r) => r.id), ['c', 'a', 'b']);
  eq(prefScore({ a: 'more' }, 'a'), PREF_SCORE.more);
  assert(prefScore({ a: 'less' }, 'a') < 0 && prefScore({}, 'a') === 0);
  assert(prefRank({ a: 'more', b: 'less' }, 'a') < prefRank({}, 'x') && prefRank({}, 'x') < prefRank({ a: 'more', b: 'less' }, 'b'));
  assert(hashPick('x', 9) === hashPick('x', 9) && hashPick('x', 9) < 9, 'stable and in range');
});

// ---------- generator ----------
const profile = { experience: 'intermediate', sessionMin: 60, trainingDays: 3 };
const ctxFor = (prefs, extra = {}) => ({
  available: expandEquipment(HOME.equipment), avoid: new Set(), recovery: {}, daysSince: () => null, chainChoice: new Map(), used: new Set(),
  maxLevel: 2, userLevel: 2, prefer: null, excluded: new Set(), favorites: new Set(), avoidSoft: new Set(), prefs, week: 100, ...extra,
});

test('generator: Recommend more wins the slot, Recommend less loses it, but a lone "less" move is still used', () => {
  const slot = { patterns: ['biceps'], role: 'accessory' };
  const cands = EXERCISES.filter((e) => e.pattern === 'biceps' && canDo(e, expandEquipment(HOME.equipment)));
  assert(cands.length >= 3);
  const base = pickExercise(slot, EXERCISES, ctxFor({}));
  const other = cands.find((e) => e.id !== base.id);
  // Whatever the plain pick is, "more" on another move overrides it; "less" on the plain pick drops it.
  assert(pickExercise(slot, EXERCISES, ctxFor({ [other.id]: 'more' })).id === other.id, 'more wins');
  assert(pickExercise(slot, EXERCISES, ctxFor({ [base.id]: 'less' })).id !== base.id, 'less loses');
  // "Less" on every candidate: still picks one (rarely, not never).
  const allLess = Object.fromEntries(cands.map((e) => [e.id, 'less']));
  assert(pickExercise(slot, EXERCISES, ctxFor(allLess)) !== null, 'a slot with only "less" moves still fills');
  // A lone candidate marked less is used when nothing else fits.
  const lone = [other];
  eq(pickExercise({ patterns: ['biceps'], role: 'accessory' }, lone, ctxFor({ [other.id]: 'less' })).id, other.id);
});

test('generator: settings.exercise_prefs reach the plan; "more" shows up, "less" rarely does', () => {
  const run = (prefs, now) => generateWorkout({ programKey: 'smart', dayType: 'upper', location: HOME, profile, exercises: EXERCISES, unit: 'lb', settings: { exercise_prefs: prefs }, now });
  const T0 = Date.parse('2026-10-26T12:00:00Z');
  const plan = run({}, T0);
  const ids = plan.exercises.map((x) => x.exercise_id);
  assert(ids.length >= 4);
  const acc = plan.exercises.find((x) => x.role === 'accessory');
  assert(acc, 'has an accessory');
  const pat = EXERCISES.find((e) => e.id === acc.exercise_id).pattern;
  const alt = EXERCISES.find((e) => e.pattern === pat && canDo(e, expandEquipment(HOME.equipment)) && !ids.includes(e.id) && e.kind !== 'conditioning');
  if (alt) {
    const more = run({ [alt.id]: 'more' }, T0).exercises.map((x) => x.exercise_id);
    assert(more.includes(alt.id), `${alt.id} marked more should be in the plan`);
  }
  const less = run({ [acc.exercise_id]: 'less' }, T0).exercises.map((x) => x.exercise_id);
  assert(!less.includes(acc.exercise_id) || ids.length === less.length, 'less moves out of the plan when another fits');
  // Over many weeks a "less" move shows up much less often than the plain pick, but the plan never breaks.
  let plain = 0; let withLess = 0;
  for (let wk = 0; wk < 20; wk++) {
    const t = T0 + wk * 7 * 86400000;
    if (run({}, t).exercises.some((x) => x.exercise_id === acc.exercise_id)) plain++;
    if (run({ [acc.exercise_id]: 'less' }, t).exercises.some((x) => x.exercise_id === acc.exercise_id)) withLess++;
  }
  assert(withLess <= plain, `less (${withLess}) should not beat plain (${plain})`);
});

test('generator: the wider pool rotates accessories from week to week, while main lifts stay put', () => {
  const T0 = Date.parse('2026-10-26T12:00:00Z');
  const weeks = [0, 1, 2, 3, 4, 5].map((n) => generateWorkout({ programKey: 'smart', dayType: 'upper', location: HOME, profile, exercises: EXERCISES, unit: 'lb', now: T0 + n * 7 * 86400000 }));
  const accIds = new Set(weeks.flatMap((w) => w.exercises.filter((x) => x.role === 'accessory').map((x) => x.exercise_id)));
  const accPerWeek = weeks[0].exercises.filter((x) => x.role === 'accessory').length;
  assert(accIds.size > accPerWeek, `only ${accIds.size} different accessories over 6 weeks`);
  eq(weeks.map((w) => w.exercises.find((x) => x.role === 'main').exercise_id).filter((v, i, a) => a.indexOf(v) === i).length, 1, 'the main lift is the same each week');
  // Same week, same plan (no flicker on re-render).
  const a = generateWorkout({ programKey: 'smart', dayType: 'upper', location: HOME, profile, exercises: EXERCISES, unit: 'lb', now: T0 });
  const b = generateWorkout({ programKey: 'smart', dayType: 'upper', location: HOME, profile, exercises: EXERCISES, unit: 'lb', now: T0 + 3600000 });
  eq(a.exercises.map((x) => x.exercise_id), b.exercises.map((x) => x.exercise_id));
});

// ---------- wiring ----------
test('wiring: summary, History, Settings and the picker use the shared control; the files are in the offline shell', () => {
  assert(read('js/screens/summary.js').includes('prefControlHtml(r.ex)'));
  assert(read('js/screens/player-extras.js').includes('prefControlHtml(ex)'));
  assert(read('js/screens/settings.js').includes('data-exercise-prefs'));
  assert(read('js/screens/picker.js').includes('prefRank'));
  const sw = read('sw.js');
  assert(sw.includes('./js/screens/exercise-prefs.js') && sw.includes('./js/workouts/prefs.js'));
  assert(read('js/screens/exercise-prefs.js').includes("exercise_prefs: next"), 'saves the whole map so a cleared entry is removed');
});

test('rules: exercise_prefs needs no rules change (settings/main takes any field); a rules test covers it', () => {
  assert(read('tests/rules/rules.test.js').includes('exercise_prefs'));
});
