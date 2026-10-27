// v0.16.81 (#238): exercises grouped by muscle. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { allExercises } from '../js/workouts/library.js';
import { GROUPS, GROUP_LABELS, muscleGroup, groupExercises } from '../js/workouts/muscle-groups.js';
import { PATTERN_LABELS } from '../js/screens/picker.js';
import { MUSCLES } from '../js/workouts/recovery.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('v0.16.81: the groups are in the fixed order, Other last', () => {
  eq(GROUPS.map((g) => GROUP_LABELS[g]), ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Other']);
});

test('v0.16.81: every built-in exercise lands in exactly one group, and only cardio and mobility are Other', () => {
  const all = allExercises();
  assert(all.length > 300);
  const sections = groupExercises(all);
  eq(sections.reduce((n, s) => n + s.items.length, 0), all.length);
  const seen = new Set();
  for (const s of sections) for (const e of s.items) { assert(!seen.has(e.id), `${e.id} appears twice`); seen.add(e.id); }
  eq(seen.size, all.length);
  for (const e of all) {
    assert(GROUPS.includes(muscleGroup(e)), `${e.id} has no group`);
    if (muscleGroup(e) === 'other') assert(['conditioning', 'mobility'].includes(e.pattern), `${e.id} (${e.pattern}) fell through to Other by accident`);
  }
  eq(sections.map((s) => s.key), GROUPS.filter((g) => sections.some((s) => s.key === g)));
});

test('v0.16.81: every movement pattern and every muscle is mapped on purpose', () => {
  for (const p of Object.keys(PATTERN_LABELS)) {
    const g = muscleGroup({ pattern: p, primary: [] });
    if (g === 'other') assert(['conditioning', 'mobility', 'plyometric'].includes(p), `pattern ${p} is unmapped`);
  }
  for (const m of MUSCLES) assert(muscleGroup({ pattern: 'custom', primary: [m] }) !== 'other', `muscle ${m} is unmapped`);
});

test('v0.16.81: examples', () => {
  eq(muscleGroup({ pattern: 'horizontal_push', primary: ['chest'] }), 'chest');
  eq(muscleGroup({ pattern: 'horizontal_pull', primary: ['lats'] }), 'back');
  eq(muscleGroup({ pattern: 'hinge', primary: ['lower_back', 'glutes'] }), 'legs');
  eq(muscleGroup({ pattern: 'vertical_push', primary: ['front_delts', 'triceps'] }), 'shoulders');
  eq(muscleGroup({ pattern: 'triceps', primary: ['triceps'] }), 'arms');
  eq(muscleGroup({ pattern: 'core_flexion', primary: ['abs'] }), 'core');
  eq(muscleGroup({ pattern: 'plyometric', primary: ['quads', 'glutes'] }), 'legs'); // jumps follow the muscle
  eq(muscleGroup({ pattern: 'plyometric', primary: ['chest', 'triceps'] }), 'chest');
  eq(muscleGroup({ pattern: 'conditioning', primary: ['quads'] }), 'other');
  eq(muscleGroup({ pattern: 'weird', primary: [] }), 'other');
  eq(muscleGroup(null), 'other');
});

test('v0.16.81: grouping keeps the incoming order inside a group, drops empty groups and loses nothing from a filtered list', () => {
  const mk = (id, pattern, primary) => ({ id, pattern, primary });
  const list = [mk('a', 'triceps', ['triceps']), mk('b', 'squat', ['quads']), mk('c', 'triceps', ['triceps']), mk('d', 'squat', ['quads'])];
  const s = groupExercises(list);
  eq(s.map((x) => x.key), ['legs', 'arms']);
  eq(s[0].items.map((e) => e.id), ['b', 'd']);
  eq(s[1].items.map((e) => e.id), ['a', 'c']);
  eq(groupExercises([]), []);
  const hands = allExercises().filter((e) => e.pattern === 'squat');
  eq(groupExercises(hands).flatMap((x) => x.items).map((e) => e.id).sort(), hands.map((e) => e.id).sort());
});

test('v0.16.81: the library keeps its filters, search and detail actions, and the markup is accessible', () => {
  const src = read('js/screens/library.js');
  assert(src.includes('(!hereOnly || canDo(e, avail)) && (!pattern || e.pattern === pattern) && words.every((w) => e.name.toLowerCase().includes(w))'));
  assert(src.includes('(fav.has(b.id) - fav.has(a.id)) || a.name.localeCompare(b.name)'));
  assert(src.includes('aria-expanded="${open}"') && src.includes('aria-controls='));
  assert(src.includes('<h2 class="mg-h">'));
  assert(src.includes("haptics.select()") && src.includes('animateSpring') && src.includes('reducedMotion()'));
  assert(src.includes("groupExercises(list)"));
  for (const keep of ['toggleSetting', 'openCustomForm', 'data-new-empty']) assert(src.includes(keep), `${keep} lost`);
});

test('v0.16.81: the Train preview labels muscle groups without reordering the plan', () => {
  const src = read('js/screens/train.js');
  assert(src.includes('planBlocks(plan.exercises).map('));
  assert(src.includes('pv-mg-h'));
  assert(src.includes("muscleGroup(exerciseById(b.items[0].it.exercise_id))"));
});

test('v0.16.81: the sticky header sits under the nav bar, with a 44px target', () => {
  const css = read('css/app.css');
  assert(/\.mg-h \{[^}]*position: sticky; top: calc\(var\(--safe-top\) \+ 44px\)/.test(css));
  assert(/\.mg-btn \{[^}]*min-height: 44px/.test(css));
});
