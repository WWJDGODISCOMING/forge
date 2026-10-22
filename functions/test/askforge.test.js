// Ask Forge, no network: node --test test/. The model is a stub that returns canned JSON. All data is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fakeDb } from './fake-db.js';
import { setSink } from '../src/log.js';
import { cleanInput, parseReply, finalAnswer, buildPrompt, askForge, meterAskForge, deleteAskForgeData, AskForgeError, PER_HOUR, PER_DAY, GLOBAL_PER_DAY } from '../src/askforge.js';

const NOW = Date.parse('2026-10-21T01:00:00Z');
const CTX = { eatenKcal: 1500, eatenProtein: 90, ceiling: 2100, proteinGoal: 120, burned: 2000, hour: 20 };
const YOGURT = { name: 'Noosa vanilla bean yogurt', kcal: 300, protein_g: 12, carbs_g: 38, fat_g: 11 };
const body = (over = {}) => ({ question: 'Is it too late for a Noosa vanilla bean yogurt?', item: YOGURT, ctx: CTX, prefs: { diets: [], avoid: [] }, ...over });
const reply = (o = {}) => JSON.stringify({ verdict: 'yes', reason: 'It fits your day.', better: '', item: YOGURT, ...o });
const model = (content, status = 200, extra = {}) => {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return { ok: status < 400, status, json: async () => ({ choices: [{ message: { content }, ...extra }] }) }; };
  f.calls = calls;
  return f;
};
const run = (over = {}) => askForge({ db: over.db || fakeDb(), uid: 'u1', data: over.data || body(), apiKey: 'KEY123', fetch: over.fetch || model(reply()), now: NOW });
const code = async (p) => { try { await p; } catch (e) { return e instanceof AskForgeError ? e.code : `other:${e.message}`; } return null; };

test('the server copy of the Ask Forge rules is identical to the app’s file', () => {
  const app = new URL('../../js/food/ask-rules.js', import.meta.url);
  if (!existsSync(app)) return;
  assert.equal(readFileSync(new URL('../src/meal/ask-rules.js', import.meta.url), 'utf8'), readFileSync(app, 'utf8'), 'copy js/food/ask-rules.js to functions/src/meal/');
});

test('cleanInput: needs a question, caps sizes, cleans the numbers, whitelists diets', () => {
  const ok = cleanInput(body({ question: '<b>Can I   have   pizza?</b>', prefs: { diets: ['pregnancy_safe', 'keto'], avoid: ['mushroom', 7] } }));
  assert.equal(ok.question, 'Can I have pizza?');
  assert.deepEqual(ok.prefs.diets, ['pregnancy_safe']);
  assert.deepEqual(ok.prefs.avoid, ['mushroom']);
  assert.equal(ok.ctx.eatenKcal, 1500);
  assert.equal(cleanInput(body({ item: null })).item, null);
  assert.equal(cleanInput(body({ item: { name: 'x', kcal: 99999 } })).item, null);
  for (const bad of [null, 'x', {}, { question: '' }, { question: 'a' }, body({ question: 'y'.repeat(5000) })]) {
    assert.throws(() => cleanInput(bad), (e) => e instanceof AskForgeError && e.code === 'invalid');
  }
  assert.equal(cleanInput(body({ question: 'q'.repeat(300) })).question.length, 200);
});

test('the prompt carries the numbers and the rules, and the question is quoted as text', () => {
  const p = buildPrompt(cleanInput(body({ prefs: { diets: ['low_histamine'], avoid: ['mushroom'] } })));
  for (const s of ['1500 kcal eaten', '2100 kcal ceiling', '600 left', '120 g', 'low-histamine', 'mushroom', 'Never diagnose', 'Noosa vanilla bean yogurt, 300 kcal']) assert.ok(p.includes(s), s);
});

test('parseReply: strict about the verdict, tolerant of fences, throws garbled for junk', () => {
  for (const bad of ['', 'sure!', '{"verdict":"maybe"}', '{nope', 'x'.repeat(9000), null]) assert.throws(() => parseReply(bad), (e) => e.code === 'garbled');
  const r = parseReply('```json\n' + reply({ verdict: 'HALF', reason: '<i>Half</i> works', better: 'fruit' }) + '\n```');
  assert.equal(r.verdict, 'half'); assert.equal(r.reason, 'Half works'); assert.equal(r.item.kcal, 300);
});

test('the AI can never be kinder than the numbers: yes becomes half, half becomes better', () => {
  const tight = { ...CTX, eatenKcal: 1900 }; // 200 left, yogurt 300: half (150) fits
  const a = finalAnswer({ reply: parseReply(reply({ verdict: 'yes' })), input: cleanInput(body({ ctx: tight })) });
  assert.equal(a.verdict, 'half'); assert.match(a.reason, /Half is 150 kcal/);
  const full = { ...CTX, eatenKcal: 2050 };
  const b = finalAnswer({ reply: parseReply(reply({ verdict: 'half' })), input: cleanInput(body({ ctx: full })) });
  assert.equal(b.verdict, 'better'); assert.ok(b.better);
});

test('the AI may be stricter, with its own words; its words are dropped when it disagrees or sounds medical', () => {
  const a = finalAnswer({ reply: parseReply(reply({ verdict: 'half', reason: 'Late sugar can wait.' })), input: cleanInput(body()) });
  assert.equal(a.verdict, 'half'); assert.equal(a.reason, 'Late sugar can wait.');
  const m = finalAnswer({ reply: parseReply(reply({ verdict: 'half', reason: 'This will treat your insulin spike.' })), input: cleanInput(body()) });
  assert.equal(m.verdict, 'half'); assert.ok(!/insulin|treat/i.test(m.reason));
  const y = finalAnswer({ reply: parseReply(reply({ verdict: 'yes' })), input: cleanInput(body()) });
  assert.equal(y.verdict, 'yes'); assert.equal(y.source, 'ai');
});

test('a food that breaks a diet rule is always "better", whatever the model says, with the rules’ own words', () => {
  const input = cleanInput(body({ item: { name: 'Smoked salmon bagel', kcal: 100 }, prefs: { diets: ['pregnancy_safe'], avoid: [] } }));
  const a = finalAnswer({ reply: parseReply(reply({ verdict: 'yes', reason: 'Delicious and fits.' })), input });
  assert.equal(a.verdict, 'better'); assert.match(a.reason, /pregnancy/i); assert.ok(!a.reason.includes('Delicious'));
  const lh = cleanInput(body({ item: { name: 'Aged cheddar', kcal: 100 }, prefs: { diets: ['low_histamine'], avoid: [] } }));
  assert.equal(finalAnswer({ reply: parseReply(reply()), input: lh }).verdict, 'better');
});

test('the app’s food numbers win over the model’s; with none, the model’s estimate is used', () => {
  const lie = parseReply(reply({ item: { name: 'Yogurt', kcal: 10, protein_g: 1, carbs_g: 1, fat_g: 0 } }));
  assert.equal(finalAnswer({ reply: lie, input: cleanInput(body()) }).item.kcal, 300);
  assert.equal(finalAnswer({ reply: lie, input: cleanInput(body({ item: null })) }).item.kcal, 10);
  assert.throws(() => finalAnswer({ reply: { verdict: 'yes', reason: '', better: '', item: null }, input: cleanInput(body({ item: null })) }), (e) => e.code === 'garbled');
});

test('askForge: calls xAI once with the key, returns the checked answer, and logs counts only', async () => {
  const lines = [];
  setSink((l) => lines.push(l));
  const f = model(reply());
  const out = await run({ fetch: f });
  setSink(console.log);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init.headers.authorization, 'Bearer KEY123');
  assert.equal(out.answer.verdict, 'yes');
  const logged = JSON.stringify(lines);
  for (const s of ['Noosa', 'yogurt', 'KEY123', 'fits your day']) assert.ok(!logged.includes(s), `${s} not logged`);
});

test('askForge: no key, bad input, upstream trouble and cut-off replies map to short codes', async () => {
  assert.equal(await code(askForge({ db: fakeDb(), uid: 'u', data: body(), apiKey: '', fetch: model(reply()), now: NOW })), 'nokey');
  assert.equal(await code(run({ data: { question: '' } })), 'invalid');
  assert.equal(await code(run({ fetch: model('', 500) })), 'down');
  assert.equal(await code(run({ fetch: model('', 429) })), 'busy');
  assert.equal(await code(run({ fetch: model('not json') })), 'garbled');
  assert.equal(await code(run({ fetch: model(reply(), 200, { finish_reason: 'length' }) })), 'garbled');
  const slow = async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; };
  assert.equal(await code(run({ fetch: slow })), 'busy');
});

test('rate limits: per hour, per day, and for everyone; the counter is deleted with the account data except while its day is open', async () => {
  const db = fakeDb();
  for (let i = 0; i < PER_HOUR; i++) assert.equal((await meterAskForge({ db, uid: 'u1', now: NOW + i })).limited, false);
  assert.equal((await meterAskForge({ db, uid: 'u1', now: NOW + 100 })).limited, true);
  assert.equal((await meterAskForge({ db, uid: 'u1', now: NOW + 3700000 })).limited, false, 'a new hour');
  assert.ok(PER_DAY > PER_HOUR && GLOBAL_PER_DAY > PER_DAY);
  const db2 = fakeDb();
  for (let i = 0; i < PER_HOUR; i++) await run({ db: db2 });
  const f = model(reply());
  assert.equal(await code(run({ db: db2, fetch: f })), 'limited');
  assert.equal(f.calls.length, 0, 'no model call once limited');
  await deleteAskForgeData({ db: db2, uid: 'u1', now: NOW });
  assert.equal(await code(run({ db: db2 })), 'limited', 'deleting data does not reset today’s count');
  await deleteAskForgeData({ db: db2, uid: 'u1', now: NOW + 3 * 86400000 });
  assert.equal(await code(run({ db: db2 })), null, 'gone once its day has passed');
});

test('the rules’ "try instead" idea never clashes with the active diets, with room left or at the ceiling', async () => {
  const { judge, dietConflict } = await import('../src/meal/ask-rules.js');
  const big = { name: 'Big dessert', kcal: 1500, protein_g: 5, carbs_g: 100, fat_g: 40 };
  for (const diet of ['low_histamine', 'dairy_free', 'vegetarian', 'pregnancy_safe', 'gluten_free']) {
    const prefs = { diets: [diet], avoid: [] };
    for (const eatenKcal of [1500, 2100]) {
      const j = judge(big, { ...CTX, eatenKcal }, prefs);
      assert.equal(j.verdict, 'better');
      assert.ok(j.better);
      assert.equal(dietConflict(j.better, prefs), null, `${diet} @${eatenKcal}: ${j.better}`);
    }
  }
});

test('the rules’ idea also skips anything on the skip list, alone or with diets', async () => {
  const { judge, dietConflict } = await import('../src/meal/ask-rules.js');
  const big = { name: 'Big dessert', kcal: 1500, protein_g: 5, carbs_g: 100, fat_g: 40 };
  const cases = [
    { diets: [], avoid: ['apple'] }, { diets: [], avoid: ['pear'] }, { diets: [], avoid: ['apple', 'pear'] },
    { diets: [], avoid: ['apple', 'pear', 'banana', 'carrot', 'rice', 'egg', 'protein'] },
    { diets: ['low_histamine'], avoid: ['apple'] }, { diets: ['pregnancy_safe', 'dairy_free'], avoid: ['pear', 'banana'] },
    { diets: ['vegetarian', 'gluten_free', 'low_histamine', 'pregnancy_safe', 'dairy_free'], avoid: ['apple', 'pear'] },
  ];
  for (const prefs of cases) {
    for (const eatenKcal of [1500, 2100]) {
      const j = judge(big, { ...CTX, eatenKcal }, prefs);
      assert.ok(j.better);
      assert.equal(dietConflict(j.better, prefs), null, `${JSON.stringify(prefs)} @${eatenKcal}: ${j.better}`);
    }
  }
  assert.ok(/fits your food preferences/.test(judge(big, { ...CTX, eatenKcal: 1500 }, cases[3]).better));
});

test('finalAnswer drops an AI "better" idea that clashes with the person’s diet', () => {
  const input = cleanInput(body({ item: { name: 'Big dessert', kcal: 1500, protein_g: 5, carbs_g: 100, fat_g: 40 }, prefs: { diets: ['low_histamine'], avoid: [] } }));
  const r = parseReply(reply({ verdict: 'better', better: 'Try some Greek yogurt.', item: input.item }));
  const a = finalAnswer({ reply: r, input });
  assert.ok(!/yogurt/i.test(a.better), a.better);
  const ok = finalAnswer({ reply: parseReply(reply({ verdict: 'better', better: 'A fresh pear.', item: input.item })), input });
  assert.equal(ok.better, 'A fresh pear.');
});
