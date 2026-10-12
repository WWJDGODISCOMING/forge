// Snap a meal: a plate photo → estimated foods, portions, calories and macros, from an xAI vision model.
// The photo exists only in this request: it is never written to Firestore or Storage and never logged. The only
// logger is log.js and we hand it counts and durations. No network in tests: `fetch` is injected.
import { P } from './paths.js';
import { log } from './log.js';

export const XAI_URL = 'https://api.x.ai/v1/chat/completions';
export const MODEL = 'grok-4';
export const RATE_PER_HOUR = 20;
export const MAX_IMAGE_BYTES = 1500000; // the app sends a ~1024 px JPEG (about 150 KB); this is a hard stop
export const TIMEOUT_MS = 45000;
export const MAX_FOODS = 12;

/** Carries a short code the wiring maps to an HttpsError: 'invalid' | 'toolarge' | 'limited' | 'busy' | 'down' | 'nofood'. */
export class SnapError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const MAGIC = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47] };

/** The clean base64 image and its type. Throws SnapError('invalid' | 'toolarge'). */
export function validateImage(data) {
  const d = data && typeof data === 'object' ? data : {};
  const mime = d.mime === undefined ? 'image/jpeg' : d.mime;
  if (!MAGIC[mime] || typeof d.image !== 'string') throw new SnapError('invalid');
  if (d.image.length > MAX_IMAGE_BYTES * 2) throw new SnapError('toolarge'); // before any regex work on a huge string
  const b64 = d.image.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (b64.length < 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new SnapError('invalid');
  if (Math.floor((b64.length * 3) / 4) > MAX_IMAGE_BYTES) throw new SnapError('toolarge');
  const head = Buffer.from(b64.slice(0, 8), 'base64');
  if (!MAGIC[mime].every((byte, i) => head[i] === byte)) throw new SnapError('invalid');
  return { b64, mime };
}

const PROMPT = 'You estimate the food on a plate from a photo for a calorie tracker. Reply with JSON only: '
  + '{"foods":[{"name":"plain food name","portion":"e.g. 1 cup or 150 g","grams":number,"kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number,"confidence":number between 0 and 1}]}. '
  + 'List each distinct food once (at most 12), with the numbers for the amount you can see, not per 100 g. '
  + 'If the picture has no food, reply {"foods":[]}. Do not add any other text.';

const num = (x, hi) => { const n = Number(x); return Number.isFinite(n) ? Math.min(hi, Math.max(0, n)) : 0; };
const r1 = (x) => Math.round(x * 10) / 10;
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** The model's reply text → a short, bounded list the app can trust. Returns [] for anything unusable. */
export function parseFoods(text) {
  let obj;
  try {
    const m = /\{[\s\S]*\}/.exec(String(text || ''));
    obj = m ? JSON.parse(m[0]) : null;
  } catch { return []; }
  const list = obj && Array.isArray(obj.foods) ? obj.foods : [];
  const out = [];
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const name = clean(f.name, 80);
    if (!name) continue;
    out.push({
      name, portion: clean(f.portion, 40), grams: Math.round(num(f.grams, 5000)), kcal: Math.round(num(f.kcal, 5000)),
      protein_g: r1(num(f.protein_g, 500)), carbs_g: r1(num(f.carbs_g, 500)), fat_g: r1(num(f.fat_g, 500)),
      confidence: Math.round(num(f.confidence, 1) * 100) / 100,
    });
    if (out.length >= MAX_FOODS) break;
  }
  return out;
}

/** Counts this photo for the user: 20 an hour (a window that starts at the first photo). */
export async function meterSnap({ db, uid, now }) {
  const ref = db.doc(P.snapMeal(uid));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : {};
    const fresh = d.hour_start && now - d.hour_start < 3600000 && now >= d.hour_start;
    const n = fresh ? d.hour_n || 0 : 0;
    if (n >= RATE_PER_HOUR) return { limited: true };
    tx.set(ref, { hour_start: fresh ? d.hour_start : now, hour_n: n + 1 });
    return { limited: false };
  });
}

/** Removes the photo counter for Delete everything (kept while its hour is open so a reset can't dodge the limit). */
export async function deleteSnapData({ db, uid, now = Date.now() }) {
  try {
    const ref = db.doc(P.snapMeal(uid));
    const snap = await ref.get();
    if (!snap.exists) return;
    const start = snap.data().hour_start;
    if (typeof start === 'number' && now >= start && now - start < 3600000) return;
    await ref.delete();
  } catch (e) { if (e && (e.code === 5 || e.code === 'not-found')) return; throw e; }
}

/** The whole job: check, count, ask the model, tidy. Returns { foods }. Throws SnapError. */
export async function snapMeal({ db, uid, data, apiKey, fetch, now = Date.now() }) {
  const { b64, mime } = validateImage(data);
  if ((await meterSnap({ db, uid, now })).limited) throw new SnapError('limited');
  const started = Date.now();
  let res;
  try {
    res = await fetch(XAI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL, temperature: 0.2, max_tokens: 1200, response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}`, detail: 'high' } },
        ] }],
      }),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
    });
  } catch { throw new SnapError('down'); }
  if (res.status === 429) throw new SnapError('busy');
  if (!res.ok) throw new SnapError('down');
  let body;
  try { body = await res.json(); } catch { throw new SnapError('down'); }
  const text = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  const foods = parseFoods(text);
  log('snap_meal', { count: foods.length, ms: Date.now() - started });
  if (!foods.length) throw new SnapError('nofood');
  return { foods };
}
