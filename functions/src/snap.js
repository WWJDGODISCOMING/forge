// Snap a meal: a plate photo → estimated foods, portions, calories and macros, from an xAI vision model.
// The photo exists only in this request: it is never written to Firestore or Storage and never logged. The only
// logger is log.js and we hand it counts and durations. No network in tests: `fetch` is injected.
import { P } from './paths.js';
import { log } from './log.js';

export const XAI_URL = 'https://api.x.ai/v1/chat/completions';
export const MODEL = 'grok-4.3'; // explicit current vision model (a reasoning model), not the 'grok-4' alias; see docs.x.ai/docs/models
export const MAX_TOKENS = 4000; // reasoning tokens share this budget, so it is generous
export const RATE_PER_HOUR = 20;
export const MAX_IMAGE_BYTES = 1500000; // the app sends a ~1024 px JPEG (about 150 KB); this is a hard stop
export const TIMEOUT_MS = 45000;
export const MAX_FOODS = 12;

/** Carries a short code the wiring maps to an HttpsError: 'invalid' | 'toolarge' | 'limited' | 'busy' | 'down' | 'garbled' | 'nofood' | 'nokey'.
 *  `upstream` is a short, key-free note for the app's grey bracket: 'timeout' | 'no key' | 'network' | 'xAI 403: <msg>'. */
export class SnapError extends Error {
  constructor(code, upstream = '') { super(code); this.code = code; if (upstream) this.upstream = upstream; }
}

/** xAI's own short reason from an error body ({"error":"..","code":".."} or {"error":{"message":..,"code":..}}), at most 120 chars. */
export function upstreamNote(status, text) {
  let msg = '';
  try {
    const o = JSON.parse(String(text || ''));
    if (o && typeof o === 'object') {
      const e = o.error;
      const specific = typeof e === 'string' ? e : e && typeof e === 'object' && typeof e.message === 'string' ? e.message : '';
      const generic = typeof o.code === 'string' ? o.code : e && typeof e === 'object' && typeof e.code === 'string' ? e.code : '';
      msg = specific || generic; // xAI's `code` is a long generic gRPC line; the specific reason comes first
    }
  } catch {
    msg = String(text || '');
    if (/<(!doctype|html|head|body|title|h1)\b/i.test(msg)) { // an edge error page: keep just its title, never the tags
      const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(msg) || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(msg);
      msg = t ? t[1].replace(/<[^>]*>/g, ' ') : '';
    }
  }
  msg = clean(msg.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '…').replace(/[A-Za-z0-9+/=]{40,}/g, '[cut]'), 120);
  return msg ? `xAI ${status}: ${msg}` : `xAI ${status}`;
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

const PROMPT = 'You estimate the food a person is about to eat from a photo for a calorie tracker. Reply with JSON only: '
  + '{"foods":[{"name":"plain food name","portion":"e.g. about 1 cup or 150 g","grams":number,"kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number,"confidence":number between 0 and 1,'
  + '"brand":"optional, only if printed","product":"optional, only if printed","net_weight_g":number (optional, only if printed),'
  + '"serving_size":"optional, the printed serving size text, e.g. 1 Tbsp (6g)","serving_g":number (optional, grams in one printed serving),"servings_per_container":number (optional, only if printed),'
  + '"source":"label" or "estimate"}]}. '
  + 'List each distinct food once (at most 12). '
  + 'PLATE AND MEAL PHOTOS: estimate ONE realistic portion per food, the amount actually on the plate or in the bowl or cup, not per 100 g. Use visible references (plate size, utensils, hands) for scale. '
  + 'Never assume a whole pot, tray, bag, box or bottle in the background. Ignore anything clearly not being eaten: packaging, serving dishes, cookware and other people\'s plates. '
  + 'Packaged items, wrappers, bottles, cans, boxes and bars ARE food: never reply with no food just because something is wrapped. '
  + 'For a packaged item, read the visible brand, product name and net weight (in grams; convert oz). '
  + 'If a Nutrition Facts panel is visible, set source to "label" and return its printed PER-SERVING values (kcal, protein, carbs, fat) for ONE serving, never multiplied by the container. '
  + 'Also return serving_size (the printed text), serving_g (grams in one serving) and servings_per_container if printed; set portion to the serving size and grams to serving_g. '
  + 'For a single-serve package (servings per container is 1, or not printed and clearly one item such as a bar or a can), use the whole item and set grams to its net weight. '
  + 'Otherwise set source to "estimate". '
  + 'Keep calories realistic: no food has more than 9 kcal per gram. '
  + 'Only if the picture has no food or drink at all, reply {"foods":[]}. Do not add any other text.';
export const PROMPT_TEXT = PROMPT;

export const MAX_KCAL_PER_G = 9; // pure fat is about 9 kcal/g, so nothing edible is higher
export const FLAG_NOTE = 'Calories looked too high for the weight, so they were lowered.';
const num = (x, hi) => { const n = Number(x); return Number.isFinite(n) ? Math.min(hi, Math.max(0, n)) : 0; };
const r1 = (x) => Math.round(x * 10) / 10;
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** More than 9 kcal per gram is impossible: clamp to 9 and mark the item low confidence with a short reason. */
export function sanityCheck(item) {
  const g = item.grams > 0 ? item.grams : item.net_weight_g; // kcal is for the amount in the photo, which is grams
  if (g > 0 && item.kcal / g > MAX_KCAL_PER_G) {
    const kcal = Math.floor(g * MAX_KCAL_PER_G);
    const k = kcal / item.kcal; // macros shrink with the calories so they still add up
    const out = { ...item, kcal, protein_g: r1(item.protein_g * k), carbs_g: r1(item.carbs_g * k), fat_g: r1(item.fat_g * k), confidence: Math.min(item.confidence, 0.4), note: FLAG_NOTE };
    if (out.source === 'label') delete out.source; // no longer the label's numbers
    return out;
  }
  return item;
}

export const CONTAINER_NOTE = 'That looked like the whole package, so it was cut to one serving.';
export const MACRO_NOTE = 'Calories didn’t match the macros, so they were re-worked.';
export const PORTION_NOTE = 'That looked like more than one portion, so it was scaled down.';
const within = (a, b, tol) => a > 0 && b > 0 && Math.abs(a - b) <= tol * Math.max(a, b);

/** Scales an item's weight, calories and macros by k (macros shrink with calories so they still add up). */
function scaled(item, k, extra = {}) {
  return { ...item, grams: Math.round(item.grams * k), kcal: Math.round(item.kcal * k), protein_g: r1(item.protein_g * k), carbs_g: r1(item.carbs_g * k), fat_g: r1(item.fat_g * k), ...extra };
}

/** A label answer that is the whole container (per-serving × servings) goes back to ONE serving. Single-serve packages are untouched. */
export function unwrapContainer(item) {
  const n = item.servings_per_container;
  if (item.source !== 'label' || !(n > 1)) return item;
  const sg = item.serving_g;
  // The weight is about serving_g × n (or the printed net weight when that is n servings): the model multiplied.
  const whole = (sg > 0 && within(item.grams, sg * n, 0.15)) || (item.net_weight_g > 0 && within(item.grams, item.net_weight_g, 0.15) && (!(sg > 0) || within(item.net_weight_g, sg * n, 0.2)));
  if (!whole) return item.serving_size ? { ...item, portion: item.serving_size } : item;
  const out = scaled(item, 1 / n, { note: CONTAINER_NOTE, flag: 'container' });
  if (sg > 0) out.grams = Math.round(sg);
  if (item.serving_size) out.portion = item.serving_size;
  return out;
}

// Single-portion ceilings by food type (kcal). First match wins; sauces first.
const BOUNDS = [
  [/\b(sauce|dressing|ketchup|mayo|mayonnaise|gravy|syrup|dip|condiment|salsa|mustard|jam|jelly|hummus|aioli|vinaigrette)\b/i, 200],
  [/\b(coffee|latte|cappuccino|espresso|tea|juice|soda|cola|smoothie|shake|water|drink|beer|wine|cocktail|lemonade|milk|kombucha|cider)\b/i, 400],
  [/\b(chicken|beef|steak|pork|ham|fish|salmon|tuna|turkey|lamb|bacon|sausage|shrimp|meat|ribs|brisket|cod|tilapia)\b/i, 800],
  [/\b(rice|pasta|spaghetti|noodles?|macaroni|couscous|quinoa|oatmeal|porridge|grits|risotto)\b/i, 700],
];
export const DEFAULT_MAX_KCAL = 1200; // any other single food
export const maxKcalFor = (name) => { const b = BOUNDS.find(([re]) => re.test(name)); return b ? b[1] : DEFAULT_MAX_KCAL; };

/** One food is one portion: past its ceiling it is scaled down to the ceiling and flagged. Label numbers are the printed ones, so they are left alone. */
export function boundPortion(item) {
  if (item.source === 'label') return item;
  const max = maxKcalFor(item.name);
  if (!(item.kcal > max)) return item;
  return scaled(item, max / item.kcal, { confidence: Math.min(item.confidence, 0.4), note: PORTION_NOTE, flag: 'portion' });
}

/** kcal should be about 4P + 4C + 9F. More than 20% apart: the macros win and the calories are recomputed; with no macros, they are derived from the calories. */
export function fixMacros(item) {
  const calc = 4 * item.protein_g + 4 * item.carbs_g + 9 * item.fat_g;
  if (calc > 0) {
    if (Math.abs(item.kcal - calc) <= Math.max(0.2 * calc, 10)) return item; // a little slack for tiny items, fibre and alcohol
    return { ...item, kcal: Math.round(calc), confidence: Math.min(item.confidence, 0.4), note: item.note || MACRO_NOTE, flag: item.flag || 'macros' };
  }
  if (item.kcal > 0) return { ...item, protein_g: r1((item.kcal * 0.2) / 4), carbs_g: r1((item.kcal * 0.45) / 4), fat_g: r1((item.kcal * 0.35) / 9) }; // a middling split of the energy
  return item;
}

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
    const item = {
      name, portion: clean(f.portion, 40), grams: Math.round(num(f.grams, 5000)), kcal: Math.round(num(f.kcal, 5000)),
      protein_g: r1(num(f.protein_g, 500)), carbs_g: r1(num(f.carbs_g, 500)), fat_g: r1(num(f.fat_g, 500)),
      confidence: Math.round(num(f.confidence, 1) * 100) / 100,
    };
    // Packaged-food fields are optional: absent when the model didn't read them, so older clients see the same shape.
    const brand = clean(f.brand, 60), product = clean(f.product, 80), net = r1(num(f.net_weight_g, 5000));
    if (brand) item.brand = brand;
    if (product) item.product = product;
    if (net > 0) item.net_weight_g = net;
    if (f.source === 'label' || f.source === 'estimate') item.source = f.source;
    const servingSize = clean(f.serving_size, 40), servingG = r1(num(f.serving_g, 5000)), per = r1(num(f.servings_per_container, 1000));
    if (servingSize) item.serving_size = servingSize;
    if (servingG > 0) item.serving_g = servingG;
    if (per > 0) item.servings_per_container = per;
    out.push(sanityCheck(fixMacros(boundPortion(unwrapContainer(item)))));
    if (out.length >= MAX_FOODS) break;
  }
  return out;
}

/** True when the reply holds a JSON object with a foods list (an empty list is a valid "no food"). */
export function replyParses(text) {
  try {
    const m = /\{[\s\S]*\}/.exec(String(text || ''));
    const obj = m ? JSON.parse(m[0]) : null;
    return !!obj && Array.isArray(obj.foods);
  } catch { return false; }
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
  if (!apiKey) { log('snap_meal_error', { reason: 'nokey' }); throw new SnapError('nokey', 'no key'); }
  if ((await meterSnap({ db, uid, now })).limited) throw new SnapError('limited');
  const started = Date.now();
  let res;
  try {
    res = await fetch(XAI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL, temperature: 0.2, max_tokens: MAX_TOKENS, response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}`, detail: 'high' } },
        ] }],
      }),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
    });
  } catch (e) {
    const name = e && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : 'Error';
    log('snap_meal_error', { reason: name, ms: Date.now() - started });
    throw name === 'TimeoutError' || name === 'AbortError' ? new SnapError('busy', 'timeout') : new SnapError('down', 'network');
  }
  if (!res.ok) {
    // log.js only keeps short codes, so the error text goes out on its own line. It is xAI's reply, never our request,
    // and any long base64-looking run is cut in case it echoes the photo.
    let text = '';
    try { text = await res.text(); } catch { /* no body */ }
    const body = String(text || '').replace(/[A-Za-z0-9+/=]{100,}/g, '[cut]').slice(0, 300);
    console.error(JSON.stringify({ event: 'snap_meal_error', status: res.status, body, ms: Date.now() - started }));
    throw new SnapError(res.status === 429 ? 'busy' : 'down', upstreamNote(res.status, text));
  }
  let body;
  try { body = await res.json(); } catch { throw new SnapError('down'); }
  const text = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  const choice = body && body.choices && body.choices[0];
  if (choice && choice.finish_reason === 'length') throw new SnapError('garbled'); // cut off mid-reply: not "no food"
  if (!replyParses(text)) throw new SnapError('garbled');
  const foods = parseFoods(text);
  log('snap_meal', { count: foods.length, ms: Date.now() - started });
  if (!foods.length) throw new SnapError('nofood');
  return { foods };
}
