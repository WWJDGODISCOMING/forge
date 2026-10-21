// v0.16.47: Ask Forge, "Can I eat this?". Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { judge, dietConflict, foodFromQuestion, stricter, cleanItem, cleanContext } from '../js/food/ask-rules.js';
import { contextFrom, lookupFood, queryVariants, localAnswer, checkAnswer, requestAnswer, askLogFields, askAiOn } from '../js/food/ask.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const YOGURT = { name: 'Noosa vanilla bean yogurt', kcal: 300, protein_g: 12, carbs_g: 38, fat_g: 11 };
const CTX = { eatenKcal: 1500, eatenProtein: 90, ceiling: 2100, proteinGoal: 120, burned: 2000, hour: 20 };
const NONE = { diets: [], avoid: [] };

test('foodFromQuestion pulls the food out of a spoken question', () => {
  eq(foodFromQuestion('Is it too late for a Noosa vanilla bean yogurt?'), 'noosa vanilla bean yogurt');
  eq(foodFromQuestion('Can I have a slice of pizza tonight?'), 'slice of pizza');
  eq(foodFromQuestion('banana'), 'banana');
  eq(foodFromQuestion('Is a banana okay?'), 'banana');
  assert(foodFromQuestion('x'.repeat(200)).length <= 60);
});

test('judge: yes when it fits, half when only half fits, better when not even half', () => {
  const yes = judge(YOGURT, CTX, NONE);
  eq(yes.verdict, 'yes'); eq(yes.factor, 1); eq(yes.numbers.after, 300); eq(yes.headline, 'Yes, go for it');
  assert(yes.reason.includes('300 kcal fits') && yes.reason.includes('12 g protein') && yes.reason.includes('30 g to go'));
  const half = judge(YOGURT, { ...CTX, eatenKcal: 1900 }, NONE);
  eq(half.verdict, 'half'); eq(half.factor, 0.5); assert(half.reason.includes('Half is 150 kcal'));
  const better = judge(YOGURT, { ...CTX, eatenKcal: 2000 }, NONE);
  eq(better.verdict, 'better'); eq(better.factor, 0); assert(better.better.includes('100 kcal'));
  const over = judge(YOGURT, { ...CTX, eatenKcal: 2300 }, NONE);
  eq(over.verdict, 'better'); assert(over.better.includes('tomorrow'));
});

test('judge: exact edges (fits at equal, half at equal) and a late-night nudge', () => {
  eq(judge({ ...YOGURT, kcal: 600 }, CTX, NONE).verdict, 'yes');
  eq(judge({ ...YOGURT, kcal: 1200 }, CTX, NONE).verdict, 'half');
  eq(judge({ ...YOGURT, kcal: 1202 }, CTX, NONE).verdict, 'better');
  assert(judge(YOGURT, { ...CTX, hour: 22 }, NONE).reason.includes('late'));
  assert(!judge(YOGURT, { ...CTX, hour: 15 }, NONE).reason.includes('late'));
  eq(judge({ name: 'x', kcal: 'lots' }, CTX, NONE), null);
});

test('a missing ceiling uses the default; blanks and nonsense are clamped', () => {
  eq(cleanContext({}).ceiling, 2000);
  eq(cleanContext({ ceiling: 1e9, eatenKcal: -5, burned: null }).ceiling, 6000);
  eq(cleanContext({ eatenKcal: -5 }).eatenKcal, 0);
  eq(cleanContext({}).burned, null);
  eq(cleanItem({ name: '<b>Oat</b> bar', kcal: 190.4, protein_g: -3 }).name, 'Oat bar');
  eq(cleanItem({ name: 'x', kcal: 9999 }), null);
});

test('per-profile needs: pregnancy-safe, low-histamine, dairy-free and the skip list turn a yes into Better pick', () => {
  const preg = { diets: ['pregnancy_safe'], avoid: [] };
  for (const f of ['Smoked salmon bagel', 'Sushi roll', 'Brie and crackers', 'Glass of wine', 'Tuna sandwich', 'Deli turkey sandwich']) eq(judge({ name: f, kcal: 100 }, CTX, preg).verdict, 'better', f);
  assert(judge({ name: 'Sushi', kcal: 100 }, CTX, preg).reason.includes('OB'));
  eq(judge({ name: 'Pasteurized brie', kcal: 100 }, CTX, preg).verdict, 'yes');
  eq(judge({ name: 'Cooked chicken and rice', kcal: 100 }, CTX, preg).verdict, 'yes');
  const lh = { diets: ['low_histamine'], avoid: [] };
  for (const f of ['Aged cheddar', 'Leftover pasta', 'Dark chocolate', 'Strawberry yogurt', 'Salsa and chips']) eq(judge({ name: f, kcal: 100 }, CTX, lh).verdict, 'better', f);
  eq(judge({ name: 'Fresh mozzarella', kcal: 100 }, CTX, lh).verdict, 'yes');
  eq(judge({ name: 'Greek yogurt', kcal: 100 }, CTX, { diets: ['dairy_free'], avoid: [] }).verdict, 'better');
  eq(judge({ name: 'Almond milk', kcal: 100 }, CTX, { diets: ['dairy_free'], avoid: [] }).verdict, 'yes');
  eq(judge({ name: 'Mushroom soup', kcal: 100 }, CTX, { diets: [], avoid: ['mushroom'] }).verdict, 'better');
  eq(judge({ name: 'Gluten free bread', kcal: 100 }, CTX, { diets: ['gluten_free'], avoid: [] }).verdict, 'yes');
  eq(dietConflict('Banana', preg), null);
});

test('reasons never diagnose and every answer is general guidance', () => {
  const bad = /\b(diagnos|treat|cure|disease|disorder)\w*/i;
  for (const prefs of [NONE, { diets: ['pregnancy_safe'], avoid: [] }, { diets: ['low_histamine'], avoid: [] }]) {
    for (const k of [100, 300, 1500]) for (const eaten of [0, 1900, 2300]) {
      const j = judge({ name: 'Smoked fish', kcal: k }, { ...CTX, eatenKcal: eaten }, prefs);
      assert(!bad.test(`${j.reason} ${j.better}`));
    }
  }
  assert(read('js/screens/ask.js').includes('ASK_FOOTER'));
  assert(read('js/food/ask-rules.js').includes('not medical advice'));
});

test('stricter picks the harsher verdict', () => {
  eq(stricter('yes', 'half'), 'half'); eq(stricter('better', 'yes'), 'better'); eq(stricter('half', 'half'), 'half');
});

test('contextFrom totals today only and carries targets, burned and hour', () => {
  const logs = [
    { day: '2026-10-21', kcal: 400, protein_g: 30, carbs_g: 40, fat_g: 10, servings: 1 },
    { day: '2026-10-21', kcal: 200, protein_g: 10, carbs_g: 20, fat_g: 5, servings: 2 },
    { day: '2026-10-20', kcal: 999, protein_g: 99, carbs_g: 9, fat_g: 9, servings: 1 },
    { day: '2026-10-21', kcal: 500, deleted: true, servings: 1 },
  ];
  const c = contextFrom({ logs, day: '2026-10-21', targets: { calories: 2100, proteinG: 120 }, burned: 1850.4, now: new Date(2026, 9, 21, 21, 15) });
  eq(c.eatenKcal, 800); eq(c.eatenProtein, 50); eq(c.ceiling, 2100); eq(c.proteinGoal, 120); eq(c.burned, 1850); eq(c.hour, 21);
  eq(contextFrom({ logs: [], day: '2026-10-21', targets: null, burned: null }).burned, null);
});

test('lookupFood: My foods first, then USDA when online, null offline or with no match', async () => {
  const foods = [{ id: 'f1', name: 'Noosa vanilla bean yogurt', kcal: 300, protein_g: 12, carbs_g: 38, fat_g: 11, serving: '1 cup' }];
  const remote = async () => ({ state: 'ok', items: [{ name: 'Banana, raw', kcal: 105, protein_g: 1.3, carbs_g: 27, fat_g: 0.4, serving: '1 medium' }] });
  const mine = await lookupFood('noosa yogurt', { foods, remote });
  eq(mine.kcal, 300); eq(mine.from, 'mine');
  const usda = await lookupFood('banana', { foods, remote });
  eq(usda.from, 'usda'); eq(usda.kcal, 105);
  eq(await lookupFood('banana', { foods, remote, online: false }), null);
  eq(await lookupFood('banana', { foods, remote: async () => ({ state: 'offline', items: [] }) }), null);
  eq(await lookupFood('banana', { foods, remote: async () => { throw new Error('x'); } }), null);
  eq(await lookupFood('a', { foods, remote }), null);
  eq(queryVariants('a bowl of oatmeal').join('|'), 'a bowl of oatmeal|oatmeal');
  eq(queryVariants('banana').join('|'), 'banana');
  eq((await lookupFood('bowl of noosa', { foods, remote })).kcal, 300, 'the amount word is dropped before searching');
});

test('localAnswer works with AI off: verdict, numbers and Log it / Log half amounts', () => {
  const a = localAnswer(YOGURT, { ...CTX, eatenKcal: 1900 }, NONE);
  eq(a.source, 'rules'); eq(a.verdict, 'half');
  const full = askLogFields(a, 1, { meal: 'snack', day: '2026-10-21' });
  eq(full.kcal, 300); eq(full.name, 'Noosa vanilla bean yogurt'); eq(full.meal, 'snack'); eq(full.day, '2026-10-21'); eq(full.servings, 1);
  const half = askLogFields(a, 0.5, { meal: 'snack', day: '2026-10-21' });
  eq(half.kcal, 150); eq(half.protein_g, 6); eq(half.carbs_g, 19); eq(half.portion, 'Half a serving');
  eq(localAnswer({ name: 'x' }, CTX, NONE), null);
});

test('checkAnswer: the app’s rules have the last word over the server', () => {
  const raw = (o) => ({ verdict: 'yes', reason: 'Looks good.', better: '', item: YOGURT, ...o });
  const ok = checkAnswer(raw(), CTX, NONE);
  eq(ok.verdict, 'yes'); eq(ok.reason, 'Looks good.'); eq(ok.source, 'ai'); eq(ok.factor, 1);
  const tight = checkAnswer(raw(), { ...CTX, eatenKcal: 1900 }, NONE);
  eq(tight.verdict, 'half'); assert(tight.reason.includes('Half is 150'));
  const pregnant = checkAnswer(raw({ item: { ...YOGURT, name: 'Sushi platter' } }), CTX, { diets: ['pregnancy_safe'], avoid: [] });
  eq(pregnant.verdict, 'better'); assert(!pregnant.reason.includes('Looks good'));
  const stricterAi = checkAnswer(raw({ verdict: 'better', reason: 'Late sugar.', better: 'Berries.' }), CTX, NONE);
  eq(stricterAi.verdict, 'better'); eq(stricterAi.reason, 'Late sugar.'); eq(stricterAi.better, 'Berries.'); eq(stricterAi.factor, 0);
  for (const bad of [null, {}, raw({ verdict: 'maybe' }), raw({ item: null }), raw({ item: { name: '', kcal: 5 } })]) eq(checkAnswer(bad, CTX, NONE), null);
});

test('requestAnswer sends only the question, numbers and food rules to askForge; failures reject with a calm message', async () => {
  let sent;
  const call = async (name, data, opts) => { sent = { name, data, opts }; return { answer: { verdict: 'yes', reason: 'Fits.', better: '', item: YOGURT } }; };
  const a = await requestAnswer({ question: 'Is it too late for yogurt?', item: YOGURT, ctx: CTX, prefs: { diets: ['vegetarian'], avoid: ['mushroom'], leftovers: 'freeze', cooking: 'both', snacks: 1 }, call });
  eq(a.verdict, 'yes'); eq(sent.name, 'askForge');
  eq(Object.keys(sent.data).sort().join(), 'ctx,item,prefs,question');
  eq(Object.keys(sent.data.prefs).sort().join(), 'avoid,diets');
  let err = '';
  try { await requestAnswer({ question: 'q?', item: null, ctx: CTX, prefs: NONE, call: async () => { throw new Error('The AI is busy.'); } }); } catch (e) { err = e.message; }
  eq(err, 'The AI is busy.');
  err = '';
  try { await requestAnswer({ question: 'q?', item: null, ctx: CTX, prefs: NONE, call: async () => ({ answer: { verdict: 'x' } }) }); } catch (e) { err = e.message; }
  assert(err.includes('your numbers'));
});

test('AI is off unless Settings → Ask Forge AI is on; the switch is in Settings and off by default', () => {
  eq(askAiOn(undefined), false); eq(askAiOn({}), false); eq(askAiOn({ ask_ai: 'yes' }), false); eq(askAiOn({ ask_ai: true }), true);
  const settings = read('js/screens/settings.js');
  assert(settings.includes('name="askai" ${st.ask_ai === true ?') && settings.includes('ask_ai: e.target.checked'));
  const ask = read('js/screens/ask.js');
  assert(ask.includes('askAiOn(state.settings)') && ask.includes("import('../functions.js')"), 'the network is only reached behind the setting');
});

test('Ask Forge is on Today and Food, a sheet with detents, haptics, big targets and reduced-motion-safe CSS', () => {
  assert(read('js/screens/today.js').includes("askButton('ask-entry--today')") && read('js/screens/today.js').includes('bindAsk(el)'));
  assert(read('js/screens/food.js').includes('${askButton()}') && read('js/screens/food.js').includes('openAskForge({ day })'));
  const ask = read('js/screens/ask.js');
  assert(ask.includes("detents: ['medium', 'large']"));
  assert(ask.includes('haptics.success()') && ask.includes('haptics.light()'));
  const css = read('css/ask.css');
  assert(/\.ask-entry \{[^}]*min-height: 56px/.test(css) && /\.ask-actions \.btn \{ min-height: 52px/.test(css));
  assert(/@media \(prefers-reduced-motion: no-preference\) \{ \.ask-card \{ animation/.test(css), 'the card animation is opt-in and only a fade');
  assert(!/translate|scale/.test(css), 'no movement in the Ask Forge CSS');
});

test('privacy copy in Settings and the sheet footer says calories burned go to xAI', () => {
  assert(/Sends your question[^<]*burned[^<]*xAI/.test(read('js/screens/settings.js')), 'Settings copy mentions burned');
  assert(/calories burned\) and your food preferences go to xAI/.test(read('js/screens/ask.js')), 'footer mentions burned');
});

test('server files exist, are wired, and are in the offline shell', () => {
  const sw = read('sw.js');
  for (const f of ['js/food/ask-rules.js', 'js/food/ask.js', 'js/screens/ask.js']) assert(sw.includes(`'./${f}'`), f);
  assert(sw.includes("'./css/ask.css'") && read('index.html').includes('css/ask.css'));
  assert(read('functions/index.js').includes('export const askForge = onCall'));
  assert(read('functions/src/meal/ask-rules.js') === read('js/food/ask-rules.js'), 'server copy of the rules matches');
});
