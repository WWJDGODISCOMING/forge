// v0.15.9: USDA food search on the phone. The provider merge, the 300 ms debounce, the offline / failure line, and
// the portion maths (servings ↔ grams ↔ oz). No network: remote providers are fakes. Synthetic data only.
import { test, eq, near, assert } from './harness.js';
import { readFileSync } from 'node:fs';
import { search, searchRemote, searchLocal, createOnlineSearch, recentItems, PROVIDERS } from '../js/food/search.js';
import {
  OZ_G, measureServing, gramsToOz, ozToGrams, gramsFromAmount, macrosFor, servingsLabel, amountLabel, portionText, usdaItem, portionItem, servingsToGrams, gramsToServings,
} from '../js/food/portion.js';
import { logFields, LIMITS } from '../js/food/core.js';

// A row as the foodSearch function returns it.
const ROW = {
  fdcId: 2001, name: 'Greek Yogurt, Vanilla', brand: 'Chobani', dataType: 'Branded',
  serving: { g: 150, text: '1 container (150 g)', real: true },
  per100: { kcal: 80, protein_g: 11.3, carbs_g: 8, fat_g: 0 },
  perServing: { kcal: 120, protein_g: 17, carbs_g: 12, fat_g: 0 },
};
const BANANA = {
  fdcId: 1105073, name: 'Bananas, raw', brand: '', dataType: 'SR Legacy', serving: { g: 100, text: '100 g', real: false },
  per100: { kcal: 89, protein_g: 1.1, carbs_g: 22.8, fat_g: 0.3 }, perServing: { kcal: 89, protein_g: 1.1, carbs_g: 22.8, fat_g: 0.3 },
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeRemote = (fn) => ({ id: 'fake', remote: true, search: fn });

test('usdaItem: name with brand, per-serving numbers, a serving line and food_id usda:<fdcId>', () => {
  const it = usdaItem(ROW);
  eq(it.kind, 'usda');
  eq(it.key, 'usda:2001');
  eq(it.food_id, 'usda:2001');
  eq(it.name, 'Greek Yogurt, Vanilla', 'the stored name is the clean title; the brand is its own field');
  eq(it.title, 'Greek Yogurt, Vanilla');
  eq(it.brand, 'Chobani');
  eq(it.kcal, 120);
  eq(it.serving, '1 container (150 g)');
  eq(usdaItem(BANANA).name, 'Bananas, raw');
  const long = usdaItem({ ...ROW, name: 'x'.repeat(90), brand: 'Brand'.repeat(10) });
  assert(long.name.length <= 80 && long.name.endsWith('…'), 'fits the 80-character name limit');
  eq(logFields({ item: long, servings: 1, meal: 'lunch', day: '2026-10-10' }).brand.length, 40, 'brand capped at 40 in the log entry');
});

test('provider merge: local rows come back instantly and never wait for (or break on) the online provider', async () => {
  const foods = [{ id: 'f1', name: 'Banana bread', kcal: 300, protein_g: 4, carbs_g: 50, fat_g: 9, serving: '1 slice' }];
  eq(PROVIDERS.filter((p) => p.remote).length, 1, 'USDA is registered as a remote provider');
  const t0 = Date.now();
  const local = await search('banana', { foods, logs: [] });
  assert(Date.now() - t0 < 100, 'instant');
  eq(local.length, 1);
  eq(local[0].kind, 'mine');
  // Two remote providers: rows are merged, and one failing keeps the other's rows.
  const a = fakeRemote(async () => [usdaItem(BANANA)]);
  const b = fakeRemote(async () => { throw Object.assign(new Error('x'), { kind: 'unavailable' }); });
  const r = await searchRemote('banana', [{ id: 'local', search: async () => [] }, a, b]);
  eq(r.state, 'ok');
  eq(r.items.length, 1);
  eq(r.items[0].key, 'usda:1105073');
});

test('offline and failure: one quiet state, local results untouched, never a throw', async () => {
  const off = fakeRemote(async () => { throw Object.assign(new Error('offline'), { kind: 'offline' }); });
  const down = fakeRemote(async () => { throw new Error('boom'); });
  const r1 = await searchRemote('banana', [off]);
  eq(r1.state, 'offline');
  eq(r1.items.length, 0);
  const r2 = await searchRemote('banana', [down]);
  eq(r2.state, 'unavailable');
  eq((await searchRemote('banana', [])).state, 'ok');
  // The real USDA provider, with no network or Firebase in Node, ends in a state and not an exception.
  const real = await searchRemote('banana');
  assert(['offline', 'unavailable'].includes(real.state), real.state);
  // The sheet's words.
  const src = readFileSync(new URL('../js/screens/food.js', import.meta.url), 'utf8');
  assert(src.includes('Online search needs a connection'));
  assert(src.includes('Online search isn’t available right now'));
  assert(!/toast\([^)]*[Oo]nline search/.test(src), 'a failed search is a quiet line, not a toast');
});

test('debounce: typing fast makes one search ~300 ms after the last key, and an old answer never overwrites a new one', async () => {
  const asked = [];
  const updates = [];
  const slow = fakeRemote(async (q) => { asked.push(q); await wait(q === 'oat' ? 60 : 5); return [usdaItem({ ...BANANA, name: q })]; });
  const s = createOnlineSearch({ onUpdate: (u) => updates.push(u), delay: 40, providers: [slow] });
  s.query('o'); // too short: idle, nothing asked
  s.query('oa');
  s.query('oat');
  await wait(15);
  s.query('oatm');
  s.query('oatme');
  await wait(25);
  eq(asked.length, 0, 'nothing asked while the keys are still coming');
  await wait(80);
  eq(asked.join(','), 'oatme', 'one search for the final text');
  eq(updates[0].state, 'idle');
  eq(updates.filter((u) => u.state === 'loading').length, 4);
  const last = updates[updates.length - 1];
  eq(last.state, 'ok');
  eq(last.query, 'oatme');
  eq(last.items[0].title, 'oatme');
  // Stale: 'oat' (slow) is superseded by 'oats' before it answers.
  const seen = [];
  const s2 = createOnlineSearch({ onUpdate: (u) => seen.push(u), delay: 1, providers: [slow] });
  s2.query('oat');
  await wait(10);
  s2.query('oats');
  await wait(120);
  const answers = seen.filter((u) => u.state === 'ok');
  eq(answers.length, 1);
  eq(answers[0].query, 'oats');
  // Short again → idle, and cancel stops a pending search.
  const s3 = createOnlineSearch({ onUpdate: (u) => seen.push(u), delay: 20, providers: [slow] });
  const before = asked.length;
  s3.query('rice');
  s3.cancel();
  await wait(50);
  eq(asked.length, before);
});

test('recents: a logged USDA food comes back as itself, with its portion as the serving line', () => {
  const logs = [{
    id: 'l1', day: '2026-10-09', meal: 'lunch', name: 'Bananas, raw', kcal: 107, protein_g: 1.3, carbs_g: 27.4, fat_g: 0.4, servings: 1,
    food_id: 'usda:1105073', portion: '4.2 oz (120 g)', created_at: '2026-10-09T12:00:00Z',
  }, {
    id: 'l2', day: '2026-10-09', meal: 'lunch', name: 'Copy of a saved food', kcal: 100, protein_g: 1, carbs_g: 1, fat_g: 1, servings: 1,
    food_id: 'f1', created_at: '2026-10-09T11:00:00Z',
  }];
  const r = recentItems(logs);
  eq(r[0].serving, '4.2 oz (120 g)');
  const shown = searchLocal('', { foods: [], logs }); // f1 isn't in My foods, so only the USDA one shows
  eq(shown.length, 1);
  eq(shown[0].food_id, 'usda:1105073');
  eq(searchLocal('banana', { foods: [], logs }).length, 1);
});

test('portion maths: grams ↔ oz ↔ servings', () => {
  near(OZ_G, 28.3495, 1e-3);
  near(gramsToOz(100), 3.5274, 1e-3);
  near(ozToGrams(4), 113.398, 1e-3);
  near(ozToGrams(gramsToOz(250)), 250, 1e-9);
  const p = usdaItem(ROW).usda;
  eq(servingsToGrams(p, 1.5), 225);
  near(gramsToServings(p, 75), 0.5, 1e-9);
  // What gets typed: commas, spaces, nonsense.
  near(gramsFromAmount('4', 'oz'), 113.398, 1e-3);
  eq(gramsFromAmount('150', 'g'), 150);
  eq(gramsFromAmount(' 1,250 ', 'g'), 1250);
  for (const bad of ['', '  ', 'abc', '0', '-5', '5001', '1e9']) eq(gramsFromAmount(bad, 'g'), null, bad);
  eq(gramsFromAmount('200', 'oz'), null, 'over the 5,000 g cap');
});

test('portion maths: macros for any number of grams, rounded and capped like the rules', () => {
  const p = usdaItem(ROW).usda;
  const one = macrosFor(p, 150);
  eq(one.kcal, 120);
  near(one.protein_g, 17, 1e-9); // 11.3 × 1.5 = 16.95 → 17
  near(one.carbs_g, 12, 1e-9);
  const half = macrosFor(p, 75);
  eq(half.kcal, 60);
  near(half.protein_g, 8.5, 1e-9); // 8.475 → 8.5
  eq(macrosFor(p, 0).kcal, 0);
  eq(macrosFor(p, -50).kcal, 0);
  // 20 oz of a 900 kcal / 100 g food would be 5,100 kcal: clamp to what a log entry can hold.
  const oil = { per100: { kcal: 900, protein_g: 0, carbs_g: 0, fat_g: 100 }, serving: { g: 14, text: '1 tbsp (14 g)', real: true } };
  eq(macrosFor(oil, ozToGrams(20)).kcal, LIMITS.kcal);
  eq(macrosFor(oil, ozToGrams(20)).fat_g, 500);
});

test('portion text: servings, weight in oz or g, thousands, fractions', () => {
  eq(servingsLabel(0.5), '½');
  eq(servingsLabel(1), '1');
  eq(servingsLabel(1.5), '1½');
  eq(servingsLabel(2.75), '2¾');
  eq(servingsLabel(1.3), '1.3');
  eq(servingsLabel(3), '3');
  eq(amountLabel(150, 'g'), '150 g');
  eq(amountLabel(1250, 'g'), '1,250 g');
  eq(amountLabel(150, 'oz'), '5.3 oz');
  const p = usdaItem(ROW).usda;
  eq(portionText(p, { mode: 'servings', servings: 1 }), '1 container (150 g)');
  eq(portionText(p, { mode: 'servings', servings: 1.5 }), '1½ × 1 container (150 g)');
  eq(portionText(p, { mode: 'weight', unit: 'oz', grams: 113.4 }), '4 oz (113 g)');
  eq(portionText(p, { mode: 'weight', unit: 'g', grams: 1250 }), '1,250 g');
  assert(portionText({ serving: { text: 'x'.repeat(80) } }, { mode: 'servings', servings: 1 }).length <= 40);
});

test('portionItem → logFields: the entry holds the macros for the chosen portion, one serving, the fdcId and the portion text', () => {
  const item = usdaItem(ROW);
  const oz4 = portionItem(item, { mode: 'weight', unit: 'oz', grams: ozToGrams(4) });
  eq(oz4.kcal, 91); // 80 × 1.134
  eq(oz4.portion, '4 oz (113 g)');
  eq(oz4.food_id, 'usda:2001');
  eq(oz4.key, 'usda:2001');
  const f = logFields({ item: oz4, servings: 1, meal: 'snack', day: '2026-10-10' });
  eq(f.kcal, 91);
  eq(f.servings, 1);
  eq(f.food_id, 'usda:2001');
  eq(f.portion, '4 oz (113 g)');
  eq(f.name, 'Greek Yogurt, Vanilla');
  eq(f.brand, 'Chobani');
  eq(logFields({ item: { name: 'Oats', kcal: 300 }, servings: 1, meal: 'lunch', day: '2026-10-10' }).brand, undefined);
  // Small amounts aren't squeezed by the 0.25-servings floor: 20 g is logged as 1 "serving" of 20 g.
  const tiny = portionItem(usdaItem({ ...ROW, serving: { g: 100, text: '100 g', real: false } }), { mode: 'weight', unit: 'g', grams: 20 });
  eq(logFields({ item: tiny, servings: 1, meal: 'lunch', day: '2026-10-10' }).kcal, 16);
  // 1½ servings
  const one5 = portionItem(item, { mode: 'servings', servings: 1.5 });
  eq(one5.kcal, 180);
  eq(one5.portion, '1½ × 1 container (150 g)');
  // Entries without a portion are unchanged.
  eq(logFields({ item: { name: 'Oats', kcal: 300 }, servings: 1, meal: 'lunch', day: '2026-10-10' }).portion, undefined);
});

const RICE = {
  fdcId: 782345, name: 'Rice, white, cooked', brand: '', dataType: 'Survey (FNDDS)',
  serving: { g: 158, text: '1 cup (158 g)', real: true }, measures: [{ text: '1 cup', g: 158 }, { text: '1 tablespoon', g: 10 }],
  per100: { kcal: 130, protein_g: 2.7, carbs_g: 28.2, fat_g: 0.3 }, perServing: { kcal: 205, protein_g: 4.3, carbs_g: 44.6, fat_g: 0.5 },
};

test('household measures: a chosen measure becomes the serving, and the portion text and macros follow it', () => {
  const item = usdaItem(RICE);
  eq(item.serving, '1 cup (158 g)');
  eq(item.usda.measures.length, 2);
  eq(usdaItem(BANANA).usda.measures.length, 0, 'no measures from the server → empty, 100 g stays');
  const tbsp = measureServing(RICE.measures[1]);
  eq(tbsp.text, '1 tablespoon (10 g)');
  const two = portionItem(item, { mode: 'servings', servings: 2, serving: tbsp });
  eq(two.portion, '2 × 1 tablespoon (10 g)');
  eq(two.kcal, 26); // 130 × 0.2
  eq(portionItem(item, { mode: 'servings', servings: 1 }).portion, '1 cup (158 g)');
});

test('server messages: "a lot of searches" is shown as itself, a real outage keeps the generic line', async () => {
  const limited = fakeRemote(async () => { throw Object.assign(new Error('That’s a lot of searches. Try again in a little while.'), { kind: 'limited' }); });
  const r = await searchRemote('banana', [limited]);
  eq(r.state, 'limited');
  eq(r.message, 'That’s a lot of searches. Try again in a little while.');
  eq(r.items.length, 0);
  const down = fakeRemote(async () => { throw Object.assign(new Error('unavailable'), { kind: 'unavailable' }); });
  eq((await searchRemote('banana', [down])).state, 'unavailable');
  const src = readFileSync(new URL('../js/screens/food.js', import.meta.url), 'utf8');
  assert(src.includes("u.state === 'limited' && u.message ? u.message"), 'the sheet shows the server line');
  const fn = readFileSync(new URL('../js/functions.js', import.meta.url), 'utf8');
  assert(fn.includes("replace('functions/', '') })"), 'call() keeps the error code so the search can tell limited from down');
  const se = readFileSync(new URL('../js/food/search.js', import.meta.url), 'utf8');
  assert(se.includes("e.code === 'resource-exhausted'"));
});

test('brand: recents keep it, the meal row and the result row show it first, kcal gets a thousands separator, the toast is one short line', () => {
  const logs = [{ id: 'l1', day: '2026-10-09', meal: 'lunch', name: 'Chicken Strips', brand: 'Tyson', kcal: 1250, protein_g: 80, carbs_g: 5, fat_g: 9, servings: 1, food_id: 'usda:9', created_at: '2026-10-09T12:00:00Z' }];
  eq(recentItems(logs)[0].brand, 'Tyson');
  const src = readFileSync(new URL('../js/screens/food.js', import.meta.url), 'utf8');
  assert(src.includes('subLine({ brand: e.brand,'), 'meal row: brand first on the grey line');
  assert(src.includes("<b>${Math.round(e.kcal * e.servings).toLocaleString('en-US')}</b>"), '1,250 kcal in the meal list');
  assert(!/toLocaleString\(\)/.test(src), 'every kcal on this screen uses en-US');
  assert(src.includes('data-sel-brand') && src.includes('class="clamp2" data-sel-name'), 'dock: title (2 lines) with the brand under it');
  assert(!/toast\(`Added \$\{fields\.name\}/.test(src), 'the toast no longer carries the long name');
  assert(src.includes("toast(`Added to ${MEAL_LABEL[fields.meal].toLowerCase()} · "), 'one short line');
});

test('Delete everything reaches the server even with no Withings or Apple data (food search counter)', () => {
  const db = readFileSync(new URL('../js/db.js', import.meta.url), 'utf8');
  const body = db.slice(db.indexOf('export async function deleteAllUserData'));
  assert(!/if \(serverData\) \{\s*const \{ call \}/.test(body), 'the server call is no longer skipped when there is no server data');
  assert(body.includes("call('withingsDisconnect', { deleteData: true, deleteApple: true })"));
  assert(body.includes('if (serverData) throw e'), 'a failure only blocks the delete when real server data needs it');
});

test('the sheet is wired: debounce, skeleton, portion picker, tabular numbers and one-line rows', () => {
  const src = readFileSync(new URL('../js/screens/food.js', import.meta.url), 'utf8');
  for (const s of ['createOnlineSearch', 'data-online-list', 'food-skel', 'data-portion', 'data-amount', 'data-serv-choice', "units() === 'metric'", 'portionItem']) assert(src.includes(s), s);
  const css = readFileSync(new URL('../css/food.css', import.meta.url), 'utf8');
  assert(/\.food-sub > \.food-kcal \{[^}]*flex: none/.test(css), 'kcal never shrinks or splits');
  assert(/\.food-brand \{[^}]*flex: 0 1 auto;[^}]*max-width: 45%/.test(css), 'brand sizes to its content, ellipsizes past 45%');
  assert(!/\.food-brand \{[^}]*flex: 0 1 40%/.test(css), 'no fixed 40% brand slot (it left a gap after short brands)');
  assert(/\.food-row > b[^{]*\{[^}]*-webkit-line-clamp: 2/.test(css), 'name wraps to two lines');
  assert(/\.food-sub \{[^}]*white-space: nowrap/.test(css), 'sub line stays on one line');
  assert(/\.food-skel-name/.test(css) && /\.food-skel-sub/.test(css), 'skeleton rows are two bars');
  assert(/font-variant-numeric: tabular-nums/.test(css));
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert(rules.includes("(!('food_id' in d) || d.food_id is string)"), 'food_id (usda:<fdcId>) is already allowed, so no rules change');
});

test('round 2: chips, toast, meal row and busy message', () => {
  const css = readFileSync(new URL('../css/food.css', import.meta.url), 'utf8');
  assert(css.indexOf('.serv-chips.serv-chips--wrap {') > css.indexOf('\n.serv-chips { display: grid'), '.chips--wrap is more specific and declared after .chips');
  assert(/\.serv-chips\.serv-chips--wrap \{[^}]*flex-wrap: wrap/.test(css) && !/\.serv-chips\.serv-chips--wrap \{[^}]*overflow-x/.test(css) && /\.serv-chips--wrap \.chip-btn \{[^}]*white-space: nowrap/.test(css), 'one-line pills that wrap onto more rows');
  assert(css.includes('.food-sub > .food-brand::after { content: " · "'), 'the brand draws its own separator');
  const nav = readFileSync(new URL('../css/nav.css', import.meta.url), 'utf8');
  assert(/\.toast \{[^}]*width: max-content;[^}]*max-width: calc\(100vw - 32px[^)]*\)/.test(nav), 'toast sizes to its text');
  const src = readFileSync(new URL('../js/screens/food.js', import.meta.url), 'utf8');
  assert(src.includes('Serving size') && src.includes('data-measures-cap'));
  const line = src.slice(src.indexOf('function entryLine'), src.indexOf('const stepBtns'));
  assert(!line.includes('kcal'), 'the meal row grey line does not repeat the calories');
  assert(readFileSync(new URL('../js/food/search.js', import.meta.url), 'utf8').includes("e.code === 'unavailable' && /busy/i"), 'the busy line is passed through');
});
