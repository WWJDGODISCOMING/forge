// Snap a meal, no network: node --test test/
// The model is a stub that returns canned JSON. The "photo" is a few synthetic JPEG-header bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.js';
import { setSink } from '../src/log.js';
import { validateImage, parseFoods, snapMeal, meterSnap, deleteSnapData, SnapError, RATE_PER_HOUR, MAX_IMAGE_BYTES, MAX_FOODS } from '../src/snap.js';

const NOW = 1_800_000_000_000;
const IMG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 7)]).toString('base64');
const REPLY = { foods: [
  { name: 'Grilled chicken', portion: '5 oz', grams: 140, kcal: 230, protein_g: 43, carbs_g: 0, fat_g: 5, confidence: 0.8 },
  { name: 'White rice', portion: '1 cup', grams: 158, kcal: 205, protein_g: 4.2, carbs_g: 44.5, fat_g: 0.4, confidence: 0.6 },
] };
const model = (content, status = 200) => {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return { ok: status < 400, status, json: async () => ({ choices: [{ message: { content } }] }) }; };
  f.calls = calls;
  return f;
};
const run = (data, over = {}) => snapMeal({ db: over.db || fakeDb(), uid: 'u1', data, apiKey: 'KEY123', fetch: over.fetch || model(JSON.stringify(REPLY)), now: NOW });
const code = async (p) => { try { await p; } catch (e) { return e instanceof SnapError ? e.code : `other:${e.message}`; } return null; };

test('validateImage accepts a jpeg and a data: url, and rejects the rest', () => {
  assert.equal(validateImage({ image: IMG }).mime, 'image/jpeg');
  assert.equal(validateImage({ image: `data:image/jpeg;base64,${IMG}` }).b64, IMG);
  for (const bad of [null, {}, { image: 5 }, { image: 'not base64!!' }, { image: 'AAAA' }, { image: IMG, mime: 'image/gif' }, { image: Buffer.alloc(40, 1).toString('base64') }]) {
    assert.throws(() => validateImage(bad), (e) => e.code === 'invalid');
  }
});

test('validateImage caps the size', () => {
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_IMAGE_BYTES + 10)]).toString('base64');
  assert.throws(() => validateImage({ image: big }), (e) => e.code === 'toolarge');
  assert.throws(() => validateImage({ image: 'A'.repeat(MAX_IMAGE_BYTES * 3) }), (e) => e.code === 'toolarge');
});

test('parseFoods keeps good rows, clamps numbers, drops junk, and copes with fences and bad JSON', () => {
  assert.equal(parseFoods(JSON.stringify(REPLY)).length, 2);
  const fenced = parseFoods('```json\n' + JSON.stringify({ foods: [{ name: '  Apple\n', kcal: 99999, protein_g: -3, confidence: 4 }, { name: '' }, null, 'x'] }) + '\n```');
  assert.deepEqual(fenced, [{ name: 'Apple', portion: '', grams: 0, kcal: 5000, protein_g: 0, carbs_g: 0, fat_g: 0, confidence: 1 }]);
  for (const bad of ['', 'sorry', '{"foods": 3}', '{nope', null]) assert.deepEqual(parseFoods(bad), []);
  const many = { foods: Array.from({ length: 30 }, (_, i) => ({ name: `f${i}`, kcal: 10 })) };
  assert.equal(parseFoods(JSON.stringify(many)).length, MAX_FOODS);
});

test('snapMeal sends the photo to xAI with the key in a header and returns tidy foods', async () => {
  const fetch = model(JSON.stringify(REPLY));
  const out = await run({ image: IMG }, { fetch });
  assert.equal(out.foods.length, 2);
  assert.equal(out.foods[0].name, 'Grilled chicken');
  const call = fetch.calls[0];
  assert.match(call.url, /api\.x\.ai/);
  assert.equal(call.init.headers.authorization, 'Bearer KEY123');
  assert.ok(!call.url.includes('KEY123'));
  assert.ok(call.init.body.includes(IMG));
});

test('the photo is never stored and never logged', async () => {
  const lines = [];
  setSink((l) => lines.push(l));
  const db = fakeDb();
  await run({ image: IMG }, { db });
  setSink((l) => console.log(l));
  assert.ok(lines.length >= 1);
  for (const l of lines) { assert.ok(!l.includes(IMG)); assert.ok(!l.includes('KEY123')); assert.ok(!l.includes('Grilled')); }
  const stored = JSON.stringify(await db.doc('users/u1/private/snap_meal').get().then((s) => s.data()));
  assert.ok(!stored.includes(IMG));
  assert.deepEqual(Object.keys(JSON.parse(stored)).sort(), ['hour_n', 'hour_start']);
});

test('a stubbed model that fails: busy, down, garbage, no food', async () => {
  assert.equal(await code(run({ image: IMG }, { fetch: model('', 429) })), 'busy');
  assert.equal(await code(run({ image: IMG }, { fetch: model('', 500) })), 'down');
  assert.equal(await code(run({ image: IMG }, { fetch: async () => { throw new Error('network'); } })), 'down');
  assert.equal(await code(run({ image: IMG }, { fetch: model('I cannot help') })), 'nofood');
  assert.equal(await code(run({ image: IMG }, { fetch: model('{"foods":[]}') })), 'nofood');
  assert.equal(await code(run({ image: IMG }, { fetch: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }) })), 'down');
});

test('a bad photo never reaches the model or the counter', async () => {
  const fetch = model(JSON.stringify(REPLY));
  assert.equal(await code(run({ image: 'xx' }, { fetch })), 'invalid');
  assert.equal(fetch.calls.length, 0);
});

test('rate limit: 20 an hour per person, then a fresh hour; deleting keeps an open hour', async () => {
  const db = fakeDb();
  for (let i = 0; i < RATE_PER_HOUR; i++) assert.equal((await meterSnap({ db, uid: 'u1', now: NOW })).limited, false);
  assert.equal((await meterSnap({ db, uid: 'u1', now: NOW + 1000 })).limited, true);
  assert.equal(await code(run({ image: IMG }, { db })), 'limited');
  assert.equal((await meterSnap({ db, uid: 'u2', now: NOW })).limited, false, 'someone else is not limited');
  await deleteSnapData({ db, uid: 'u1', now: NOW + 1000 });
  assert.equal((await meterSnap({ db, uid: 'u1', now: NOW + 2000 })).limited, true, 'open hour is kept');
  assert.equal((await meterSnap({ db, uid: 'u1', now: NOW + 3600001 })).limited, false);
  await deleteSnapData({ db, uid: 'u1', now: NOW + 3 * 3600000 });
  assert.equal((await db.doc('users/u1/private/snap_meal').get()).exists, false);
});
