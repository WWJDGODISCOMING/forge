// Apple Health bridge: Shortcut tokens, payload validation, per-day merge, and the ingest/import handlers.
//   - Only the SHA-256 of a token is stored (users/{uid}/private/shortcut and shortcut_tokens/{hash} → {uid}).
//     The token is returned once, at creation. Neither the token nor its hash is ever logged or returned.
//   - Payloads are validated field by field (type, range, size). Nothing here logs a health value: the
//     logger (log.js) only keeps codes and counts, and error replies name a field, never its value.
//   - Writes are idempotent per day: late and duplicate posts merge by field, newer non-empty wins.
import { createHash, randomBytes } from 'node:crypto';
import { P } from './paths.js';
import { log } from './log.js';

export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_DAYS_PER_POST = 14;
export const MAX_DAYS_PER_IMPORT = 120;
const TOKEN_RE = /^fsc_[A-Za-z0-9_-]{43}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');
export const newToken = () => `fsc_${randomBytes(32).toString('base64url')}`;
export const looksLikeToken = (t) => typeof t === 'string' && TOKEN_RE.test(t);

export class BadPayload extends Error {
  constructor(code, field) {
    super(code);
    this.code = code;
    this.field = field || null;
  }
}

// name: [min, max, how an array of samples is combined]
const NUMERIC = {
  hrv_sdnn_ms: [1, 400, 'mean'],
  rhr_bpm: [25, 220, 'mean'],
  wrist_temp_delta_c: [-6, 6, 'mean'],
  wrist_temp_c: [20, 45, 'mean'],
  resp_rate: [4, 50, 'mean'],
  spo2_avg_pct: [50, 100, 'mean'],
  vo2max: [5, 100, 'mean'],
  walking_hr_avg: [30, 220, 'mean'],
  steps: [0, 200000, 'sum'],
  active_kcal: [0, 15000, 'sum'],
  exercise_min: [0, 1440, 'sum'],
};
const SLEEP_MIN = ['asleep_min', 'core_min', 'deep_min', 'rem_min', 'awake_min'];
export const FIELD_NAMES = [...Object.keys(NUMERIC), 'hrv_samples', 'sleep', 'workouts', 'fallback_body'];
const MAX_SAMPLES = 5000;
const MAX_SEGMENTS = 600;

const absent = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** A number, or a numeric string ("52.3": Shortcuts often sends text). NaN when it's neither. */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string') return NaN;
  let t = v.trim();
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, ''); // "8,532" (a thousands separator)
  else if (/^-?\d+,\d+$/.test(t)) t = t.replace(',', '.'); // "52,5" (a decimal comma)
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

function numeric(field, v) {
  const [lo, hi, how] = NUMERIC[field];
  // Shortcuts joins a list into text, one value per line: "52\n48\n61". Treat that as the list it is.
  if (typeof v === 'string' && /\s|;/.test(v.trim())) v = v.trim().split(/[\s;]+/);
  const fix = (x) => {
    if (field === 'spo2_avg_pct' && x > 0 && x <= 1) return x * 100; // Health gives 0.97
    if (field === 'wrist_temp_c' && x >= 80 && x <= 115) return ((x - 32) * 5) / 9; // an iPhone set to °F sends °F
    return x;
  };
  if (Array.isArray(v)) {
    if (v.length > MAX_SAMPLES) throw new BadPayload('too_many_samples', field);
    const xs = v.map((x) => fix(num(x))).filter((x) => x >= lo && x <= hi);
    if (!xs.length) return { value: null, n: 0 };
    const sum = xs.reduce((a, b) => a + b, 0);
    return { value: how === 'sum' ? sum : sum / xs.length, n: xs.length };
  }
  const x = fix(num(v));
  if (!(x >= lo && x <= hi)) throw new BadPayload('bad_field', field);
  return { value: x, n: 1 };
}

const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** Stage names Shortcuts / HealthKit use → 'deep' | 'rem' | 'core' | 'asleep' | 'awake' | 'inbed' (or null). */
export function stageOf(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z]/g, '');
  if (s.includes('deep')) return 'deep';
  if (s.includes('rem')) return 'rem';
  if (s.includes('core')) return 'core';
  if (s.includes('awake')) return 'awake';
  if (s.includes('inbed')) return 'inbed';
  if (s.includes('asleep') || s === 'sleep') return 'asleep';
  return null;
}

function unionMinutes(intervals) {
  const xs = intervals.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let total = 0;
  let curA = null;
  let curB = null;
  for (const [a, b] of xs) {
    if (curB == null || a > curB) {
      if (curB != null) total += curB - curA;
      curA = a;
      curB = b;
    } else if (b > curB) curB = b;
  }
  if (curB != null) total += curB - curA;
  return total / 60000;
}

/** Sleep-stage segments [{stage,start,end}] → minutes per stage (overlaps counted once). */
export function sleepFromSegments(segs) {
  const by = { deep: [], rem: [], core: [], asleep: [], awake: [], inbed: [] };
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of segs) {
    const stage = stageOf(s && s.stage);
    const a = Date.parse(s && s.start);
    const b = Date.parse(s && s.end);
    if (!stage || !Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > 24 * 3600000) throw new BadPayload('bad_field', 'sleep_segments');
    by[stage].push([a, b]);
    lo = Math.min(lo, a);
    hi = Math.max(hi, b);
  }
  if (!Number.isFinite(lo)) return null;
  const asleepAll = [...by.deep, ...by.rem, ...by.core, ...by.asleep];
  const out = { asleep_min: Math.round(unionMinutes(asleepAll)) };
  for (const k of ['core', 'deep', 'rem']) if (by[k].length) out[`${k}_min`] = Math.round(unionMinutes(by[k]));
  if (by.awake.length) out.awake_min = Math.round(unionMinutes(by.awake));
  out.in_bed_start = new Date(lo).toISOString();
  out.in_bed_end = new Date(hi).toISOString();
  return out;
}

/** Lines of "a,b,c" text (what a Shortcut builds with Repeat + Text) → arrays of trimmed parts. */
function lines(text, field, max) {
  if (typeof text !== 'string' || text.length > 60000) throw new BadPayload('bad_field', field);
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (rows.length > max) throw new BadPayload('bad_field', field);
  return rows.map((l) => l.split(',').map((p) => p.trim()));
}

const goodSegment = (s) => {
  const a = Date.parse(s && s.start);
  const b = Date.parse(s && s.end);
  return !!stageOf(s && s.stage) && Number.isFinite(a) && Number.isFinite(b) && b > a && b - a <= 24 * 3600000;
};

/** `bad` collects the names of fields that lost a bad line (the rest of the field is kept). */
function sleepField(v, segments, text, bad) {
  let out = {};
  if (!absent(text)) {
    // "Core,2026-10-10T01:10:00Z,2026-10-10T03:00:00Z" per line: stage, start, end
    const segs = lines(text, 'sleep_text', MAX_SEGMENTS).map(([stage, start, end]) => ({ stage, start, end }));
    segments = [...(Array.isArray(segments) ? segments : []), ...segs];
  }
  if (!absent(segments)) {
    if (!Array.isArray(segments) || segments.length > MAX_SEGMENTS) throw new BadPayload('bad_field', 'sleep_segments');
    const good = segments.filter(goodSegment);
    if (good.length < segments.length) bad.push(!absent(text) ? 'sleep_text' : 'sleep_segments'); // a bad line is skipped, not fatal
    out = sleepFromSegments(good) || {};
  }
  if (!absent(v)) {
    if (typeof v !== 'object' || Array.isArray(v)) throw new BadPayload('bad_field', 'sleep');
    for (const k of SLEEP_MIN) {
      if (absent(v[k])) continue;
      const x = num(v[k]);
      if (!(x >= 0 && x <= 1440)) throw new BadPayload('bad_field', 'sleep');
      out[k] = Math.round(x);
    }
    for (const k of ['in_bed_start', 'in_bed_end']) {
      if (absent(v[k])) continue;
      if (typeof v[k] !== 'string' || v[k].length > 40 || !ISO_RE.test(v[k])) throw new BadPayload('bad_field', 'sleep');
      out[k] = v[k];
    }
  }
  return Object.keys(out).length ? out : null;
}

function workoutsField(v, text, bad) {
  if (!absent(text)) {
    // "Running,2026-10-10T07:00:00Z,45,420,150" per line: type, start, minutes, kcal, average heart rate
    const fromText = lines(text, 'workouts_text', 30).map(([type, start, duration_min, kcal, avg_hr]) => ({ type, start, duration_min, kcal, avg_hr }));
    v = [...(Array.isArray(v) ? v : []), ...fromText];
  }
  if (absent(v)) return null;
  if (!Array.isArray(v) || v.length > 30) throw new BadPayload('bad_field', 'workouts');
  const list = v.map((w) => { try { return oneWorkout(w); } catch (e) { if (e instanceof BadPayload) return null; throw e; } }).filter(Boolean);
  if (list.length < v.length) bad.push(!absent(text) ? 'workouts_text' : 'workouts'); // a bad line is skipped, the rest is kept
  return list.length ? list : null;
}

function oneWorkout(w) {
  if (!w || typeof w !== 'object' || typeof w.type !== 'string' || w.type.length > 40) throw new BadPayload('bad_field', 'workouts');
  const out = { type: w.type };
  if (!absent(w.start)) {
    if (typeof w.start !== 'string' || w.start.length > 40 || !ISO_RE.test(w.start)) throw new BadPayload('bad_field', 'workouts');
    out.start = w.start;
  }
  for (const [k, lo, hi] of [['duration_min', 0, 1440], ['kcal', 0, 20000], ['avg_hr', 30, 230]]) {
    if (absent(w[k])) continue;
    const x = num(w[k]);
    if (!(x >= lo && x <= hi)) throw new BadPayload('bad_field', 'workouts');
    out[k] = round(x, 1);
  }
  return out;
}

function bodyField(v) {
  if (absent(v)) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new BadPayload('bad_field', 'fallback_body');
  const out = {};
  for (const [k, lo, hi] of [['weight_kg', 20, 500], ['fat_pct', 1, 80], ['lean_kg', 10, 300]]) {
    if (absent(v[k])) continue;
    const x = num(v[k]);
    if (!(x >= lo && x <= hi)) throw new BadPayload('bad_field', 'fallback_body');
    out[k] = round(x, 2);
  }
  if (!absent(v.source_name)) {
    if (typeof v.source_name !== 'string' || v.source_name.length > 60) throw new BadPayload('bad_field', 'fallback_body');
    out.source_name = v.source_name;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * One day's fields, validated and normalised. Unknown keys are ignored. Returns only fields that have data.
 * A field that can't be read is dropped on its own (its name goes into `rejected`); the rest of the day is kept.
 */
export function cleanDay(raw, rejected = []) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadPayload('bad_payload');
  const out = {};
  let samples = null;
  const attempt = (name, fn) => {
    try { fn(); } catch (e) { if (!(e instanceof BadPayload)) throw e; rejected.push(e.field || name); }
  };
  for (const f of Object.keys(NUMERIC)) {
    if (absent(raw[f])) continue;
    attempt(f, () => {
      const r = numeric(f, raw[f]);
      if (r.value == null) return;
      out[f] = round(r.value, f === 'steps' || f === 'active_kcal' ? 0 : 2);
      if (f === 'hrv_sdnn_ms' && Array.isArray(raw[f])) samples = r.n;
    });
  }
  if (!absent(raw.hrv_samples)) {
    attempt('hrv_samples', () => {
      const x = num(raw.hrv_samples);
      if (!(Number.isInteger(x) && x >= 0 && x <= MAX_SAMPLES)) throw new BadPayload('bad_field', 'hrv_samples');
      samples = x;
    });
  }
  if (samples != null && out.hrv_sdnn_ms != null) out.hrv_samples = samples;
  attempt('sleep', () => { const sleep = sleepField(raw.sleep, raw.sleep_segments, raw.sleep_text, rejected); if (sleep) out.sleep = sleep; });
  attempt('workouts', () => { const w = workoutsField(raw.workouts, raw.workouts_text, rejected); if (w) out.workouts = w; });
  attempt('fallback_body', () => { const b = bodyField(raw.fallback_body); if (b) out.fallback_body = b; });
  return out;
}

const validDay = (d, now) => {
  if (typeof d !== 'string' || !DAY_RE.test(d)) return false;
  const t = Date.parse(`${d}T12:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d && t <= now + 2 * 86400000 && t >= now - 1100 * 86400000;
};

// Daily totals for the day before `day`: key → the field it fills on day − 1.
const YESTERDAY = { steps_yesterday: 'steps', active_kcal_yesterday: 'active_kcal', exercise_min_yesterday: 'exercise_min' };
const shiftDay = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const OBJ_FIELDS = new Set(['sleep', 'fallback_body']);

/** Layer `fields` over `base`: newer non-empty fields win; sleep and fallback_body merge key by key. */
export function mergeFields(base, fields) {
  const out = { ...base };
  for (const [k, v] of Object.entries(fields)) out[k] = OBJ_FIELDS.has(k) ? { ...(base[k] || {}), ...v } : v;
  return out;
}

/**
 * body → [{ day, fields }]. Accepts one day ({ day, ...fields }) or { days: [ { day, ...fields } ] }.
 * Throws BadPayload (its code and field name never contain a health value).
 */
export function parsePayload(body, { now = Date.now(), maxDays = MAX_DAYS_PER_POST, rejected = [] } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadPayload('bad_payload');
  const list = Array.isArray(body.days) ? body.days : [body];
  if (!list.length || list.length > maxDays) throw new BadPayload('bad_days');
  const seen = new Map();
  for (const item of list) {
    if (!item || typeof item !== 'object') throw new BadPayload('bad_payload');
    if (!validDay(item.day, now)) throw new BadPayload('bad_day', 'day');
    const put = (day, fields) => {
      if (!Object.keys(fields).length) return; // a day with nothing readable is skipped, not an error
      seen.set(day, seen.has(day) ? mergeFields(seen.get(day), fields) : fields);
    };
    put(item.day, cleanDay(item, rejected));
    // Finished totals for the day before (the morning run sends yesterday's whole day).
    const yest = {};
    for (const [k, f] of Object.entries(YESTERDAY)) if (!absent(item[k])) yest[f] = item[k];
    if (Object.keys(yest).length) put(shiftDay(item.day, -1), cleanDay(yest, rejected));
  }
  if (!seen.size) throw new BadPayload(rejected.length ? 'unreadable' : 'no_data');
  return [...seen].map(([day, fields]) => ({ day, fields }));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const core = ({ updated_at, source, sources, ...rest }) => rest; // eslint-disable-line no-unused-vars

/**
 * Steps come from two places: Apple Health (apple_steps) and Withings (withings_steps). The day's `steps` is
 * the higher of the two, never their sum, and `steps_source` says which won ('apple' on a tie, so Apple
 * Health stays the default). A doc from before this field existed has `steps` from Apple and no apple_steps.
 */
export function resolveSteps(doc) {
  const out = { ...doc };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const apple = num(doc.apple_steps) ?? (doc.steps_source ? null : num(doc.steps));
  const withings = num(doc.withings_steps);
  if (apple == null && withings == null) return out;
  if (apple != null) out.apple_steps = apple;
  if (withings != null && (apple == null || withings > apple)) Object.assign(out, { steps: withings, steps_source: 'withings' });
  else Object.assign(out, { steps: apple, steps_source: 'apple' });
  return out;
}

/** The stored doc after applying one day's fields. Returns null when nothing would change. */
export function mergeDay(existing, { uid, day, fields, source, nowIso }) {
  const base = existing || { id: day, user_id: uid, created_at: nowIso, day, deleted: false };
  const layered = mergeFields(base, fields);
  if ('steps' in fields) layered.apple_steps = fields.steps; // a fresh Apple number replaces the old Apple number
  const merged = 'steps' in fields || 'withings_steps' in fields ? resolveSteps(layered) : layered;
  const prior = base.sources || (base.source ? [base.source] : []);
  const sources = [...new Set([...prior, source])];
  if (existing && same(core(merged), core(base)) && sources.length === prior.length) return null;
  return { ...merged, source, sources, updated_at: nowIso };
}

/** Write days in one transaction: read all, merge, write what changed. Tombstoned days stay deleted. */
export async function upsertDays({ db, uid, days, source, now = () => Date.now() }) {
  const nowIso = new Date(now()).toISOString();
  const refs = days.map((d) => db.doc(P.health(uid, d.day)));
  return db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...refs);
    let written = 0;
    let skipped = 0;
    snaps.forEach((snap, i) => {
      const cur = snap.exists ? snap.data() : null;
      if (cur && cur.deleted) { skipped++; return; }
      const next = mergeDay(cur, { uid, day: days[i].day, fields: days[i].fields, source, nowIso });
      if (!next) return;
      tx.set(refs[i], next);
      written++;
    });
    return { written, skipped };
  });
}

const fieldsIn = (days) => [...new Set(days.flatMap((d) => Object.keys(d.fields)))].filter((f) => f !== 'hrv_samples').sort();

/** Status doc the app reads (no secrets, no values): when data last arrived and which fields. */
async function touchStatus({ db, uid, days, kind, now, rejected = [] }) {
  const ref = db.doc(P.apple(uid));
  const cur = (await ref.get()).data() || {};
  const names = fieldsIn(days);
  const lastDay = days.map((d) => d.day).sort().pop();
  const iso = new Date(now()).toISOString();
  const patch = { fields_seen: [...new Set([...(cur.fields_seen || []), ...names])].sort() };
  if (!cur.last_day || lastDay > cur.last_day) patch.last_day = lastDay;
  if (kind === 'ingest') {
    patch.last_ingest_at = iso;
    patch.fields_last = names;
    patch.rejected_last = rejected; // field names only, never values
  } else {
    patch.last_import_at = iso;
    patch.import_days = days.length + (cur.last_import_at && iso.slice(0, 10) === cur.last_import_at.slice(0, 10) ? cur.import_days || 0 : 0);
  }
  await ref.set(patch, { merge: true });
}

/**
 * POST /healthIngest. req: { method, headers, bodyBytes, body }. Returns { status, body } (JSON).
 * 401 for a missing/unknown token, 413 over 256 KB, 400 for a bad payload, 405 for other methods.
 */
export async function handleIngest(req, { db, now = () => Date.now() }) {
  if (req.method !== 'POST') return { status: 405, body: { error: 'post_only' } };
  // Too big is refused first, before any lookup or parsing.
  if (req.bodyBytes > MAX_BODY_BYTES) { log('ingest', { status: 413 }); return { status: 413, body: { error: 'too_large' } }; }
  const auth = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
  const unauthorized = () => { log('ingest', { status: 401 }); return { status: 401, body: { error: 'unauthorized' } }; };
  if (!m || !looksLikeToken(m[1])) return unauthorized();
  const meter = await meterToken({ db, hash: hashToken(m[1]), now: now() });
  if (!meter.uid) return unauthorized();
  if (meter.limited) { log('ingest', { status: 429 }); return { status: 429, body: { error: 'slow_down' } }; }
  const uid = meter.uid;
  const rejected = [];
  let days;
  try {
    days = parsePayload(req.body, { now: now(), rejected });
  } catch (e) {
    if (!(e instanceof BadPayload)) throw e;
    log('ingest', { status: 400, code: e.code });
    return { status: 400, body: { error: e.code, ...(e.field ? { field: e.field } : {}) } };
  }
  const dropped = [...new Set(rejected)].sort();
  await upsertDays({ db, uid, days, source: 'apple_shortcut', now });
  await touchStatus({ db, uid, days, kind: 'ingest', now, rejected: dropped });
  log('ingest', { status: 200, count: days.length, rejected: dropped.length });
  return { status: 200, body: { ok: true, days: days.length, fields: fieldsIn(days), ...(dropped.length ? { rejected: dropped } : {}) } };
}

export const RATE_PER_HOUR = 30;
export const RATE_PER_DAY = 200;

/**
 * One read-modify-write on shortcut_tokens/{hash}: finds the owner and counts this post. Over 30 an hour or
 * 200 a day → { limited: true } (nothing is written for refused posts). Unknown token → { uid: null }.
 */
async function meterToken({ db, hash, now }) {
  const ref = db.doc(P.shortcutTok(hash));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : null;
    if (!d || !d.uid) return { uid: null };
    const freshH = d.hour_start && now - d.hour_start < 3600000 && now >= d.hour_start;
    const freshD = d.day_start && now - d.day_start < 86400000 && now >= d.day_start;
    const hourN = freshH ? d.hour_n || 0 : 0;
    const dayN = freshD ? d.day_n || 0 : 0;
    if (hourN >= RATE_PER_HOUR || dayN >= RATE_PER_DAY) return { uid: d.uid, limited: true };
    tx.set(ref, {
      uid: d.uid,
      hour_start: freshH ? d.hour_start : now, hour_n: hourN + 1,
      day_start: freshD ? d.day_start : now, day_n: dayN + 1,
      last_used_at: new Date(now).toISOString(),
    });
    return { uid: d.uid };
  });
}

/** Signed-in callable: days parsed from an Apple Health export on the phone ({ days: [...] }, source 'apple_export'). */
export async function importDays({ db, uid, data, now = () => Date.now() }) {
  const days = parsePayload(data, { now: now(), maxDays: MAX_DAYS_PER_IMPORT });
  const r = await upsertDays({ db, uid, days, source: 'apple_export', now });
  await touchStatus({ db, uid, days, kind: 'import', now });
  log('import', { count: days.length });
  return { days: days.length, written: r.written, skipped: r.skipped };
}

/** Issue (or rotate) the Shortcut token. Returns the token once; stores only its hash. */
export async function createToken({ db, uid, now = () => Date.now() }) {
  const token = newToken();
  const hash = hashToken(token);
  const iso = new Date(now()).toISOString();
  await db.runTransaction(async (tx) => {
    const cur = await tx.get(db.doc(P.shortcut(uid)));
    if (cur.exists && cur.data().token_hash) tx.delete(db.doc(P.shortcutTok(cur.data().token_hash)));
    tx.set(db.doc(P.shortcutTok(hash)), { uid });
    tx.set(db.doc(P.shortcut(uid)), { token_hash: hash, created_at: iso });
    tx.set(db.doc(P.apple(uid)), { connected: true, token_created_at: iso }, { merge: true });
  });
  log('token', { reason: 'created' });
  return { token, created_at: iso };
}

/** Revoke the Shortcut token: the old one stops working at once. Safe to call twice. */
export async function revokeToken({ db, uid, now = () => Date.now() }) {
  await db.runTransaction(async (tx) => {
    const cur = await tx.get(db.doc(P.shortcut(uid)));
    if (cur.exists && cur.data().token_hash) tx.delete(db.doc(P.shortcutTok(cur.data().token_hash)));
    if (cur.exists) tx.delete(db.doc(P.shortcut(uid)));
    tx.set(db.doc(P.apple(uid)), { connected: false, revoked_at: new Date(now()).toISOString() }, { merge: true });
  });
  return { revoked: true };
}

/** Drop the token and the Apple status. */
export async function wipeApple({ db, uid }) {
  await revokeToken({ db, uid });
  await db.doc(P.apple(uid)).delete();
}

/** "Delete Apple Health data": every health_daily day, the Shortcut token and the Apple status. Safe to repeat. */
export async function deleteAppleData({ db, uid }) {
  const snap = await db.collection(P.healthCol(uid)).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const b = db.batch();
    snap.docs.slice(i, i + 400).forEach((d) => b.delete(db.doc(d.ref.path)));
    await b.commit();
  }
  await wipeApple({ db, uid });
  return { deleted: snap.docs.length };
}
