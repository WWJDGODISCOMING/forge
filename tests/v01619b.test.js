// v0.16.19 R1 fixes: inherited keys, budget-aware focus sets, Coach rank, chip rules. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { EXERCISES } from '../js/workouts/exercises.js';
import { LOCATION_PRESETS, YMCA_PRESET } from '../js/workouts/equipment.js';
import { generateWorkout } from '../js/workouts/generator.js';
import { MUSCLES } from '../js/workouts/recovery.js';
import { FOCUS_MAX_ADDED, FOCUS_GROUPS, cleanFocus } from '../js/workouts/focus.js';
import { QUESTIONS, MAX_QUESTIONS } from '../js/coach/answers.js';
import { bindFocusChips } from '../js/ui/focus-chips.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const HOME = LOCATION_PRESETS.find((l) => l.key === 'home');
const YMCA = { equipment: YMCA_PRESET, weight_inventory: {} };
const base = { experience: 'intermediate', sessionMin: 90, trainingDays: 3, injuries: '' };
const fresh = Object.fromEntries(MUSCLES.map((m) => [m, 100]));
const gen = (o) => generateWorkout({ location: YMCA, exercises: EXERCISES, unit: 'lb', recovery: fresh, ...o });

test('cleanFocus ignores inherited keys and non-strings; generateWorkout survives them', () => {
  eq(cleanFocus(['constructor', 'toString', '__proto__', 5, null, 'chest']).join(), 'chest');
  const w = gen({ programKey: 'ppl', dayType: 'push', profile: { ...base, focus_muscles: ['constructor'] } });
  assert(w.exercises.length > 0);
  eq(w.focus.length, 0);
});

const PROGRAMS = [['ppl', 'push'], ['ppl', 'legs'], ['smart', 'lower'], ['smart', 'upper'], ['smart', 'full_a'], ['upper_lower', 'upper']];
const FOCI = [['glutes', 'legs', 'abs'], ['shoulders'], ['arms'], ['chest', 'back'], ['legs']];
const SPOTS = [['YMCA', YMCA], ['Home', HOME]];

test('focus never drops a lift, stays in the session length, and the tag only shows for a real extra set (30, 45, 60 min)', () => {
  for (const sessionMin of [30, 45, 60]) for (const [pk, dt] of PROGRAMS) for (const [ln, location] of SPOTS) for (const focus of FOCI) {
    const at = `${sessionMin}min ${pk}/${dt} ${ln} ${focus}`;
    const opts = { programKey: pk, dayType: dt, location, profile: { ...base, sessionMin } };
    const plain = gen(opts);
    const f = gen({ ...opts, profile: { ...opts.profile, focus_muscles: focus } });
    eq(f.exercises.map((e) => e.exercise_id).join(), plain.exercises.map((e) => e.exercise_id).join(), `no lift dropped: ${at}`);
    assert(f.est_minutes <= Math.max(plain.est_minutes, sessionMin), `fits: ${at}`);
    const extra = (it) => it.target.sets - plain.exercises.find((p) => p.exercise_id === it.exercise_id).target.sets;
    const net = f.exercises.reduce((n, it) => n + extra(it), 0);
    assert(net >= 0 && net <= FOCUS_MAX_ADDED, `net ${net}: ${at}`);
    const tagged = f.exercises.filter((it) => it.focusKey);
    for (const it of tagged) assert(extra(it) >= 1, `tagged lift really has +1: ${at}`);
    eq([...new Set(tagged.map((it) => it.focusKey))].join(), f.focus.join(), `tag matches lifts: ${at}`);
  }
});

test('focus repros keep the same lifts: Home Lower 45 (Glutes, Legs, Abs), YMCA full 60, YMCA push 45 (Shoulders)', () => {
  const same = (opts, focus) => {
    const a = gen(opts);
    const b = gen({ ...opts, profile: { ...opts.profile, focus_muscles: focus } });
    eq(b.exercises.map((e) => e.exercise_id).join(), a.exercises.map((e) => e.exercise_id).join());
  };
  same({ programKey: 'smart', dayType: 'lower', location: HOME, profile: { ...base, sessionMin: 45 } }, ['glutes', 'legs', 'abs']);
  same({ programKey: 'smart', dayType: 'full_a', profile: { ...base, sessionMin: 60 } }, ['glutes', 'legs', 'abs']);
  same({ programKey: 'ppl', dayType: 'push', profile: { ...base, sessionMin: 45 } }, ['shoulders']);
});

test('focus sets never come from a lift that trains a chosen group; every tagged group nets at least +1', () => {
  const cases = [
    [45, 'ppl', 'push', HOME, ['chest', 'shoulders', 'arms']],
    [45, 'smart', 'full_a', YMCA, ['glutes', 'legs', 'abs']],
    [60, 'smart', 'full_a', YMCA, ['glutes', 'legs', 'abs']],
  ];
  for (const sessionMin of [30, 45, 60, 75]) for (const [pk, dt] of PROGRAMS) for (const [, location] of SPOTS) for (const focus of FOCI) cases.push([sessionMin, pk, dt, location, focus]);
  for (const [sessionMin, pk, dt, location, focus] of cases) for (const experience of ['beginner', 'intermediate', 'advanced']) {
    const at = `${sessionMin}min ${pk}/${dt} ${experience} ${focus}`;
    const opts = { programKey: pk, dayType: dt, location, profile: { ...base, experience, sessionMin } };
    const plain = gen(opts);
    const f = gen({ ...opts, profile: { ...opts.profile, focus_muscles: focus } });
    const sets = (w, ms) => w.exercises.filter((it) => it.primary.some((m) => ms.includes(m))).reduce((n, it) => n + it.target.sets, 0);
    for (const k of focus) {
      const ms = FOCUS_GROUPS[k].muscles;
      assert(sets(f, ms) >= sets(plain, ms), `${k} never loses sets: ${at}`);
      if (f.focus.includes(k)) assert(sets(f, ms) >= sets(plain, ms) + 1, `${k} tag has a net gain: ${at}`);
    }
  }
});

test('Coach: the spot question is ranked inside the top MAX_QUESTIONS slots', () => {
  const spot = QUESTIONS.find((q) => q.id === 'spot');
  assert(spot.rank, 'spot has a rank');
  const order = (q, i, d) => (q.rank && q.rank(d) != null ? q.rank(d) : i);
  const d = { focus: ['abs'] };
  const all = QUESTIONS.map((q, i) => ({ id: q.id, o: order(q, i, d) })).sort((a, b) => a.o - b.o);
  assert(all.slice(0, MAX_QUESTIONS).some((q) => q.id === 'spot'), 'spot is in the first 8 even if every question answers');
});

test('focus chips: stop at 3 and None clears; the profile step binds them', () => {
  const mk = (value, checked = false) => {
    const l = {};
    return { value, checked, disabled: false, addEventListener: (ev, fn) => { l[ev] = fn; }, fire: () => l.change() };
  };
  const boxes = ['chest', 'arms', 'abs', 'legs', 'glutes'].map((v) => mk(v));
  const none = mk(undefined, true);
  const root = { querySelectorAll: () => boxes, querySelector: () => none };
  const read = bindFocusChips(root);
  for (const b of boxes.slice(0, 3)) { b.checked = true; b.fire(); }
  eq(read().length, 3);
  assert(boxes[3].disabled && boxes[4].disabled && !none.checked);
  none.checked = true; none.fire();
  eq(read().length, 0);
  assert(boxes.every((b) => !b.disabled && !b.checked));
  assert(src('js/screens/onboarding.js').includes('mount(form) { bindFocusChips(form); }'));
});
