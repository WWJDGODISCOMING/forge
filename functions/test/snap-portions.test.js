// Snap a meal: one portion, never the whole package. Synthetic foods only, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFoods, maxKcalFor, DEFAULT_MAX_KCAL, PROMPT_TEXT } from '../src/snap.js';

const one = (f) => parseFoods(JSON.stringify({ foods: [f] }))[0];
// Mushroom coffee: printed per serving 25 kcal, 1 Tbsp (6 g), 30 servings per container.
const COFFEE = { name: 'Organic mushroom blend powder', portion: '1 Tbsp (6g)', serving_size: '1 Tbsp (6g)', serving_g: 6, servings_per_container: 30, source: 'label', confidence: 0.9 };

test('label: per-serving values pass through and keep the serving fields', () => {
  const c = one({ ...COFFEE, grams: 6, kcal: 25, protein_g: 0, carbs_g: 3, fat_g: 1.5 });
  assert.equal(c.kcal, 25);
  assert.equal(c.grams, 6);
  assert.equal(c.serving_size, '1 Tbsp (6g)');
  assert.equal(c.serving_g, 6);
  assert.equal(c.servings_per_container, 30);
  assert.equal(c.source, 'label');
  assert.equal('note' in c, false);
});

test('label: a whole-container answer is divided back to one serving', () => {
  const c = one({ ...COFFEE, portion: '1 container', grams: 180, net_weight_g: 180, kcal: 750, protein_g: 0, carbs_g: 90, fat_g: 45 });
  assert.equal(c.kcal, 25);
  assert.equal(c.carbs_g, 3);
  assert.equal(c.fat_g, 1.5);
  assert.equal(c.protein_g, 0);
  assert.equal(c.grams, 6);
  assert.equal(c.portion, '1 Tbsp (6g)');
  assert.equal(c.flag, 'container');
  assert.equal(c.source, 'label');
});

test('label: a whole-container answer is caught from the net weight alone', () => {
  const c = one({ name: 'Cereal', source: 'label', servings_per_container: 10, grams: 400, net_weight_g: 400, kcal: 1500, protein_g: 30, carbs_g: 300, fat_g: 20, confidence: 0.8 });
  assert.equal(c.kcal, 150);
  assert.equal(c.grams, 40);
});

test('label: a single-serve bar is unchanged', () => {
  const bar = { name: 'Protein bar', portion: '1 bar (60g)', grams: 60, net_weight_g: 60, kcal: 200, protein_g: 20, carbs_g: 22, fat_g: 7, source: 'label', confidence: 0.9 };
  const single = one({ ...bar, servings_per_container: 1, serving_g: 60 });
  assert.equal(single.kcal, 200);
  assert.equal(single.grams, 60);
  assert.equal('note' in single, false);
  const noInfo = one(bar);
  assert.equal(noInfo.kcal, 200);
  assert.equal('flag' in noInfo, false);
});

test('plate: a whole-pot amount is scaled to one portion and flagged', () => {
  const rice = one({ name: 'White rice', portion: '1 pot', grams: 1500, kcal: 1950, protein_g: 40, carbs_g: 430, fat_g: 4, confidence: 0.9, source: 'estimate' });
  assert.equal(rice.kcal, 700);
  assert.ok(rice.grams < 600);
  assert.ok(rice.confidence <= 0.4);
  assert.equal(rice.flag, 'portion');
  assert.ok(rice.note);
});

test('every food-type ceiling holds', () => {
  assert.equal(maxKcalFor('Iced coffee'), 400);
  assert.equal(maxKcalFor('Pasta'), 700);
  assert.equal(maxKcalFor('Grilled chicken'), 800);
  assert.equal(maxKcalFor('Ranch dressing'), 200);
  assert.equal(maxKcalFor('Lasagna'), DEFAULT_MAX_KCAL);
  for (const [name, max] of [['Latte', 400], ['Spaghetti', 700], ['Steak', 800], ['Ketchup', 200], ['Lasagna', DEFAULT_MAX_KCAL]]) {
    const at = (kcal) => one({ name, grams: 300, kcal, protein_g: kcal / 16, carbs_g: kcal / 8, fat_g: kcal / 36, confidence: 0.8 });
    assert.equal(at(max * 2).kcal, max, name);
    assert.equal(at(max * 2).flag, 'portion', name);
    assert.equal(at(max).kcal, max, name);
    assert.equal('flag' in at(max), false, name);
  }
});

test('macros: calories more than 20% off 4P+4C+9F are recomputed; missing macros are derived', () => {
  const bad = one({ name: 'Granola', grams: 60, kcal: 600, protein_g: 5, carbs_g: 40, fat_g: 10, confidence: 0.9 });
  assert.equal(bad.kcal, 270);
  assert.equal(bad.flag, 'macros');
  assert.ok(bad.confidence <= 0.4);
  const none = one({ name: 'Mystery stew', grams: 300, kcal: 400, confidence: 0.7 });
  assert.equal(none.kcal, 400);
  assert.ok(none.protein_g > 0 && none.carbs_g > 0 && none.fat_g > 0);
});

test('a normal plate stays exactly as the model said', () => {
  const foods = [
    { name: 'Grilled chicken', portion: 'about 5 oz', grams: 140, kcal: 230, protein_g: 43, carbs_g: 0, fat_g: 5, confidence: 0.8 },
    { name: 'White rice', portion: 'about 1 cup', grams: 158, kcal: 205, protein_g: 4.2, carbs_g: 44.5, fat_g: 0.4, confidence: 0.6 },
  ];
  assert.deepEqual(parseFoods(JSON.stringify({ foods })), foods);
});

test('the prompt asks for per-serving label values and one plated portion', () => {
  assert.match(PROMPT_TEXT, /PER-SERVING/);
  assert.match(PROMPT_TEXT, /serving_size/);
  assert.match(PROMPT_TEXT, /servings_per_container/);
  assert.match(PROMPT_TEXT, /ONE realistic portion/);
  assert.match(PROMPT_TEXT, /Ignore anything clearly not being eaten/);
});
