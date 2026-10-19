// v0.16.36: one serving, not the whole package. Synthetic mushroom-coffee label, bar and plates.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { snapRows, rowMacros, stepRow, mealFields, canWhole, toggleWhole, portionText, unitMacros, bigRow, bigMeal, wholeAsk } from '../js/food/snap.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const COFFEE = { name: 'Organic mushroom blend powder', portion: '1 Tbsp (6g)', serving_size: '1 Tbsp (6g)', serving_g: 6, servings_per_container: 30, grams: 6, kcal: 25, protein_g: 0, carbs_g: 3, fat_g: 1.5, confidence: 0.9, source: 'label' };

test('label row starts at 1 serving; 2× is 50 kcal / 3 g fat / 6 g carbs / 0 g protein', () => {
  let [r] = snapRows([COFFEE]);
  eq(r.qty, 1);
  eq(rowMacros(r).kcal, 25);
  eq(portionText(r), '1 Tbsp (6g)');
  r = stepRow(stepRow(r, 1), 1); // 1 → 1.5 → 2
  eq(r.qty, 2);
  const m = rowMacros(r);
  eq(m.kcal, 50); eq(m.fat_g, 3); eq(m.carbs_g, 6); eq(m.protein_g, 0);
  const f = mealFields([r], { meal: 'breakfast', day: '2026-10-19' })[0];
  eq(f.servings, 2);
  eq(f.kcal, 25);
});

test('stepper goes in halves and never below ½', () => {
  let [r] = snapRows([COFFEE]);
  const seen = [r.qty];
  for (let i = 0; i < 4; i++) { r = stepRow(r, 1); seen.push(r.qty); }
  eq(seen.join(','), '1,1.5,2,2.5,3');
  eq(stepRow({ ...r, qty: 1 }, -1).qty, 0.5);
  eq(stepRow({ ...r, qty: 0.5 }, -1).qty, 0.5);
});

test('whole package is off by default; on, one step is the whole container and it logs that way', () => {
  const [r] = snapRows([COFFEE]);
  assert(canWhole(r) && !r.whole);
  const w = toggleWhole(r);
  eq(rowMacros(w).kcal, 750);
  eq(unitMacros(w).kcal, 750);
  eq(portionText(w), 'whole package');
  const f = mealFields([w], { meal: 'lunch', day: '2026-10-19' })[0];
  eq(f.kcal, 750);
  eq(rowMacros(toggleWhole(w)).kcal, 25);
});

test('a single-serve bar has no whole-package option and is unchanged', () => {
  const [bar] = snapRows([{ name: 'Bar', portion: '1 bar (60g)', grams: 60, kcal: 200, protein_g: 20, carbs_g: 22, fat_g: 7, source: 'label', servings_per_container: 1 }]);
  assert(!canWhole(bar));
  eq(toggleWhole(bar), bar);
  eq(rowMacros(bar).kcal, 200);
});

test('portion text names the portion and adds grams when the words lack them', () => {
  const [p] = snapRows([{ name: 'Rice', portion: 'about 1 cup', grams: 180, kcal: 240 }]);
  eq(portionText(p), 'about 1 cup (180 g)');
});

test('hints: a row over 1,000 kcal; a snap over 1,500 kcal', () => {
  const big = snapRows([{ name: 'Pizza', portion: '1 pie', grams: 600, kcal: 1100 }, { name: 'Cake', portion: '1 slice', grams: 200, kcal: 450 }]);
  assert(bigRow(big[0]) && !bigRow(big[1]));
  assert(bigMeal(big));
  assert(!bigMeal(snapRows([{ name: 'Chicken', kcal: 230 }, { name: 'Rice', kcal: 205 }])));
});

test('the screen shows the hints and the whole-package switch', () => {
  const s = src('js/screens/snap.js');
  assert(s.includes('data-whole') && s.includes('data-big-row') && s.includes('data-big-meal'));
});

test('R1-5: Whole package is only offered when one entry fits the rules', () => {
  const [ok] = snapRows([COFFEE]);
  eq(canWhole(ok), true);
  const [whey] = snapRows([{ ...COFFEE, name: 'Whey', kcal: 120, protein_g: 24, carbs_g: 3, fat_g: 1.5, servings_per_container: 74 }]);
  eq(canWhole(whey), false);
  const [pb] = snapRows([{ ...COFFEE, name: 'Peanut butter', kcal: 190, protein_g: 7, carbs_g: 7, fat_g: 16, servings_per_container: 28 }]);
  eq(canWhole(pb), false);
  eq(toggleWhole(pb).whole, undefined);
});

test('R1-7: whole-package line is short; the switch says the servings', () => {
  const [r] = snapRows([COFFEE]);
  eq(portionText(toggleWhole(r)), 'whole package');
  assert(wholeAsk(r).includes('30 servings'));
  assert(src('js/screens/snap.js').includes('snap-switch'));
});

test('R2-1: every ../food/snap.js name the screen calls is imported', () => {
  const s = src('js/screens/snap.js');
  const imp = /import \{([^}]*)\} from '\.\.\/food\/snap\.js'/.exec(s)[1].split(',').map((x) => x.trim());
  const exported = [...src('js/food/snap.js').matchAll(/export (?:async )?(?:const|function) (\w+)/g)].map((m) => m[1]);
  const body = s.replace(/^import [^\n]*\n/gm, '');
  for (const name of exported) if (new RegExp(`\\b${name}\\(`).test(body)) assert(imp.includes(name), `${name} is used but not imported`);
});
