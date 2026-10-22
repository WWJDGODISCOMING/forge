// Eaten vs burned. Pure. burned = resting + active, where `active` is HealthKit's own de-duplicated daily sum of
// active energy (workout calories are already inside it, so they are NEVER added on top). It is shown next to
// what you ate and nothing else: the calorie target does not move (it already allows for the activity level you
// picked). Resting energy comes from Apple Health when we have it (kept on this phone only), else Mifflin-St Jeor.
import { bmrMifflin } from './targets.js';

export const fmt = (n) => Math.round(n).toLocaleString('en-US');

/** Fraction of the local day that has passed at `now` (0–1). */
export function dayFraction(now) {
  const d = new Date(now);
  return Math.min(1, Math.max(0, (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400));
}

/** Full-day Mifflin estimate from a profile, or null without one. */
export function restingEstimate(profile) {
  if (!profile || !(profile.weightKg > 0) || !(profile.heightCm > 0) || !(profile.age > 0)) return null;
  return bmrMifflin(profile);
}

/**
 * eaten: kcal. active: kcal or null. basal: Apple resting kcal for that day or null (today: so far).
 * profile: for the Mifflin fallback. today: is `day` today. now: Date.
 * → null when there is neither active energy nor any resting figure, else
 *   { eaten, active, resting, burned, net, deficit, restingFrom: 'apple'|'estimate', partial }.
 * net = eaten − burned. deficit = burned − eaten (positive: you burned more than you ate).
 */
export function dayBalance({ eaten = 0, active = null, basal = null, profile = null, today = false, now = new Date() } = {}) {
  const a = Number.isFinite(active) && active > 0 ? active : null;
  let resting = null;
  let restingFrom = null;
  if (Number.isFinite(basal) && basal > 0) { resting = basal; restingFrom = 'apple'; } else {
    const bmr = restingEstimate(profile);
    if (bmr != null) { resting = today ? bmr * dayFraction(now) : bmr; restingFrom = 'estimate'; }
  }
  if (a == null && resting == null) return null;
  const burned = (resting || 0) + (a || 0);
  return { eaten, active: a, resting, burned, net: eaten - burned, deficit: burned - eaten, restingFrom, partial: !!today };
}

/** "612 calorie deficit" / "210 calories over" / "Even". Needs something eaten to say anything. */
export function deficitText(deficit, eaten = 1) {
  if (!(eaten > 0) || !Number.isFinite(deficit)) return '';
  const n = Math.round(Math.abs(deficit));
  if (n === 0) return 'Even';
  return deficit > 0 ? `${fmt(n)} calorie deficit` : `${fmt(n)} ${n === 1 ? 'calorie' : 'calories'} over`;
}

/** The same figure, short enough for the Calories line on Today: "1,010 deficit" / "210 over". */
export const deficitShort = (deficit, eaten = 1) => deficitText(deficit, eaten).replace(/ calorie(s)? (deficit|over)$/, ' $2');

/** Short Today line: "Burned 1,940 so far · 320 calorie deficit". */
export function todayLine(b) {
  if (!b) return '';
  const d = deficitText(b.deficit, b.eaten);
  return `Burned ${fmt(b.burned)} so far${d ? ` · ${d}` : ''}`;
}

/** Last `n` days ending at `today`: days is a list of { day, balance }. → totals for days with both food and burn. */
export function weekTotals(rows) {
  let eaten = 0, burned = 0, counted = 0;
  for (const r of rows) {
    if (!r.balance || !(r.balance.eaten > 0)) continue;
    eaten += r.balance.eaten;
    burned += r.balance.burned;
    counted++;
  }
  return { eaten, burned, deficit: burned - eaten, counted };
}

/** "1,820 calorie deficit this week" with the count of days it covers. */
export function weekText(t) {
  if (!t.counted) return '';
  return `${deficitText(t.deficit)} across ${t.counted} ${t.counted === 1 ? 'day' : 'days'}`;
}

// ---- Apple resting/active energy kept on this phone only (never uploaded) ----
/** Merge day buckets { day, active?, resting? } into the stored map. Idempotent: the same read gives the same map. */
export function mergeEnergy(map = {}, entries = [], at = Date.now()) {
  const out = { ...map };
  for (const e of entries) {
    if (!e || !e.day) continue;
    const prev = out[e.day] || {};
    const next = { ...prev, at };
    if (Number.isFinite(e.active) && e.active > 0) next.active = Math.round(e.active);
    if (Number.isFinite(e.resting) && e.resting > 0) next.resting = Math.round(e.resting);
    out[e.day] = next;
  }
  return out;
}

/** Did any day's resting/active figure differ between two maps? (The `at` stamp doesn't count.) */
export function energyChanged(a = {}, b = {}) {
  for (const d of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[d] || {}, y = b[d] || {};
    if (x.active !== y.active || x.resting !== y.resting) return true;
  }
  return false;
}

/** Only the days whose figures differ from what health_daily already has, so a re-read that found nothing new writes nothing. */
export function newerDays(days, rows = []) {
  const have = new Map((rows || []).map((r) => [r.id || r.day, r]));
  return days.filter((d) => { const r = have.get(d.day); return !r || Object.keys(d).some((k) => k !== 'day' && r[k] !== d[k]); });
}

/** Keep the newest `keep` days so the stored map stays small. */
export function trimEnergy(map, keep = 60) {
  const days = Object.keys(map).sort().slice(-keep);
  return Object.fromEntries(days.map((d) => [d, map[d]]));
}

/** Which days a read must cover: the 30 days back (first run or gaps) plus today and yesterday every time. */
export function backfillStart(map, today, shift, days = 30) {
  const first = shift(today, -(days - 1));
  const missing = [];
  for (let i = days - 1; i >= 2; i--) { const d = shift(today, -i); if (!map[d] || map[d].resting == null) missing.push(d); }
  return missing.length ? first : shift(today, -1);
}

const KEY = (uid) => `forge.energy.${uid || ''}`;
export function loadEnergy(uid, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { return JSON.parse(storage.getItem(KEY(uid))) || {}; } catch { return {}; }
}
export function saveEnergy(uid, map, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { storage.setItem(KEY(uid), JSON.stringify(trimEnergy(map))); } catch { /* private mode */ }
}
