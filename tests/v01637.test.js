// v0.16.37: custom protein goal. Synthetic profile only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { state } from '../js/state.js';
import { computeTargets, applyProteinGoal, customProteinG, stepProtein, parseProteinInput, startProteinG } from '../js/nutrition/targets.js';
import { currentTargets, foodTargets } from '../js/derived.js';
import { missionsFor, indexDays } from '../js/missions/core.js';

const P = { goal: 'lose', sex: 'male', age: 40, heightCm: 180, weightKg: 94.5, targetWeightKg: 85, activity: 'light' };
const auto = computeTargets(P);

test('Auto (no field, or a bad one) returns exactly what computeTargets gives', () => {
  eq(applyProteinGoal(auto, P), auto);
  for (const bad of [NaN, '145', 0, 39, 301, null, Infinity, -5]) eq(applyProteinGoal(auto, { ...P, proteinGoalG: bad }), auto, String(bad));
});

test('Custom sets protein, refills carbs, keeps calories and fat, keeps the auto value', () => {
  const t = applyProteinGoal(auto, { ...P, proteinGoalG: 145 });
  eq(t.proteinG, 145); eq(t.autoProteinG, auto.proteinG);
  eq(t.calories, auto.calories); eq(t.fatG, auto.fatG);
  eq(t.carbG, Math.round((auto.calories - 145 * 4 - auto.fatG * 9) / 4));
  assert(t.carbG > auto.carbG);
  eq(t.reasoning[t.reasoning.length - 1], 'Protein: your own goal, 145 g/day.');
});

test('clamps to 40 and 300 whole grams; carbs never below 0', () => {
  eq(customProteinG({ proteinGoalG: 40 }), 40);
  eq(customProteinG({ proteinGoalG: 300 }), 300);
  eq(customProteinG({ proteinGoalG: 144.6 }), 145);
  eq(applyProteinGoal({ ...auto, calories: 1000, fatG: 50 }, { proteinGoalG: 300 }).carbG, 0);
});

test('currentTargets and foodTargets pick it up; removing the field restores Auto', () => {
  state.weights = [];
  state.profile = { ...P };
  const a = currentTargets().proteinG;
  state.profile = { ...P, proteinGoalG: 145 };
  eq(currentTargets().proteinG, 145);
  eq(foodTargets().proteinG, 145);
  state.profile = { ...P };
  eq(currentTargets().proteinG, a);
});

test('Protein hit mission target and meal-plan targets (both read currentTargets) use it', () => {
  state.weights = [];
  state.profile = { ...P, proteinGoalG: 145 };
  const t = currentTargets();
  const idx = indexDays({ foodLogs: [{ day: '2026-10-19', protein_g: 150, kcal: 1 }] });
  const m = missionsFor('2026-10-19', idx, { targets: { proteinG: t.proteinG } }).find((x) => x.id === 'protein');
  eq(m.progress.target, 145);
  assert(m.done);
  state.profile = null;
});

test('Settings stepper: 5 g steps, bounds 40–300, typed values, sensible start', () => {
  eq(stepProtein(145, 1), 150); eq(stepProtein(145, -1), 140);
  eq(stepProtein(40, -1), 40); eq(stepProtein(300, 1), 300);
  eq(parseProteinInput('147'), 147); eq(parseProteinInput('39'), null); eq(parseProteinInput('abc'), null); eq(parseProteinInput(''), null);
  eq(startProteinG(189), 190); eq(startProteinG(0), 40);
});

test('Profile targets and "Why these numbers?" agree with the custom goal', () => {
  const t = applyProteinGoal(auto, { ...P, proteinGoalG: 145 });
  const carbLines = t.reasoning.join(' ').match(/Carbs fill the rest: \d+ g/g);
  eq(carbLines.join('|'), `Carbs fill the rest: ${t.carbG} g`);
  assert(t.reasoning.some((r) => r.startsWith('Auto protein would be')), 'auto reference');
  const src = readFileSync(new URL('../js/screens/onboarding.js', import.meta.url), 'utf8');
  assert(src.includes('applyProteinGoal(t, state.profile)'), 'profile editor applies the goal');
});
