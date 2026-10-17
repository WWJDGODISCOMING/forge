// One interface for finding foods: search(query, ctx) → Promise<item[]>. Two kinds of provider:
//  - local (My foods and your recent entries, on this phone, no network): answers instantly.
//  - remote (USDA FoodData Central through the foodSearch Cloud Function): answers a moment later, debounced, and
//    can fail without hurting anything. A remote provider has `remote: true` and throws an error with
//    `kind: 'offline' | 'limited' | 'unavailable'` when it can't answer.
//
// An item: { key, kind: 'mine' | 'recent' | 'usda', name, kcal, protein_g, carbs_g, fat_g, serving, food_id?, portion? }
// kcal and macros are per serving. A logged USDA food keeps food_id "usda:<fdcId>" and the portion text.
import { usdaItem } from './portion.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const isUsdaId = (id) => typeof id === 'string' && id.startsWith('usda:');

/** Your recent entries, newest first, one per food (by food_id, else by name). */
export function recentItems(logs, limit = 30) {
  const seen = new Set();
  const out = [];
  const sorted = logs.filter((l) => l && !l.deleted && l.name).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  for (const l of sorted) {
    const id = l.food_id ? `f:${l.food_id}` : `n:${norm(l.name)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      key: `recent:${id}`, kind: 'recent', name: l.name, kcal: l.kcal, protein_g: l.protein_g, carbs_g: l.carbs_g, fat_g: l.fat_g,
      serving: l.portion || '', ...(l.brand ? { brand: l.brand } : {}), ...(l.food_id ? { food_id: l.food_id } : {}),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function foodItems(foods) {
  return foods.filter((f) => f && !f.deleted).sort((a, b) => a.name.localeCompare(b.name)).map((f) => ({
    key: `mine:${f.id}`, kind: 'mine', name: f.name, kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g,
    serving: f.serving || '', food_id: f.id,
  }));
}

/**
 * Local provider. No query: foods you logged lately first (what you eat most is one tap away), then the rest
 * of My foods. With a query: every word must appear in the name; names that start with it come first; a recent
 * entry that is just a logged copy of one of My foods is hidden (the food itself shows instead). A recent USDA food
 * (food_id "usda:…") has no My foods copy, so it shows as itself.
 */
export function searchLocal(query, { foods = [], logs = [], limit = 40 } = {}) {
  const mine = foodItems(foods);
  const byId = new Map(mine.map((m) => [m.food_id, m]));
  const recents = recentItems(logs);
  const q = norm(query);
  if (!q) {
    const lately = recents.map((r) => {
      if (r.food_id && byId.has(r.food_id)) return byId.get(r.food_id);
      return r.food_id && !isUsdaId(r.food_id) ? null : r;
    }).filter(Boolean);
    const rest = mine.filter((m) => !lately.includes(m));
    return [...lately, ...rest].slice(0, limit);
  }
  const words = q.split(' ');
  const hit = (it) => { const n = norm(it.name); return words.every((w) => n.includes(w)); };
  const rank = (it) => (norm(it.name).startsWith(q) ? 0 : 1);
  const extra = recents.filter((r) => !r.food_id || isUsdaId(r.food_id));
  return [...mine.filter(hit), ...extra.filter(hit)].sort((a, b) => rank(a) - rank(b)).slice(0, limit);
}

export const MAX_QUERY = 60; // the foodSearch function rejects anything longer

/** Trims a search to MAX_QUERY characters at a word boundary, so a long name still searches instead of failing. */
export function capQuery(q, max = MAX_QUERY) {
  const t = String(q || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const i = cut.lastIndexOf(' ');
  return (i > 0 ? cut.slice(0, i) : t.slice(0, max)).trim();
}

/** Asks the foodSearch function. Throws an error with kind 'offline' or 'unavailable' so the sheet can say one quiet line. */
async function searchUsda(query) {
  const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
  if (isOffline()) throw Object.assign(new Error('offline'), { kind: 'offline' });
  try {
    const { call } = await import('../functions.js');
    const res = await call('foodSearch', { query: capQuery(query) }, { timeout: 9000 });
    return (res && Array.isArray(res.foods) ? res.foods : []).map(usdaItem);
  } catch (e) {
    // The server's own "That's a lot of searches…" is a friendly line, not an outage: pass it through.
    if (e && e.code === 'resource-exhausted' && e.message) throw Object.assign(new Error(e.message), { kind: 'limited' });
    // Same for "Food search is busy. Try again in a minute." (USDA answered 429): truer than "isn't available".
    if (e && e.code === 'unavailable' && /busy/i.test(e.message || '')) throw Object.assign(new Error(e.message), { kind: 'limited' });
    throw Object.assign(new Error('unavailable'), { kind: isOffline() ? 'offline' : 'unavailable' });
  }
}

export const PROVIDERS = [
  { id: 'local', search: async (query, ctx) => searchLocal(query, ctx) },
  { id: 'usda', remote: true, search: (query) => searchUsda(query) },
];

/** The instant part: every local provider, merged. Remote providers are skipped (see searchRemote). */
export async function search(query, ctx) {
  const lists = await Promise.all(PROVIDERS.filter((p) => !p.remote).map((p) => p.search(query, ctx).catch(() => [])));
  return lists.flat();
}

export const MIN_ONLINE_CHARS = 2;

/** The slow part → { state: 'ok' | 'offline' | 'limited' | 'unavailable', items, message? }. One failing provider never hides another's rows.
 *  'limited' carries the server's friendly line in `message`. */
export async function searchRemote(query, providers = PROVIDERS) {
  const remotes = providers.filter((p) => p.remote);
  const runs = await Promise.allSettled(remotes.map((p) => p.search(query)));
  const items = runs.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const failed = runs.filter((r) => r.status === 'rejected');
  if (failed.length && failed.length === runs.length) {
    const why = failed[0].reason || {};
    if (why.kind === 'limited') return { state: 'limited', message: String(why.message || ''), items: [] };
    return { state: why.kind === 'offline' ? 'offline' : 'unavailable', items: [] };
  }
  return { state: 'ok', items };
}

/**
 * Typing → online results, debounced (300 ms). onUpdate gets { state: 'idle' | 'loading' | 'ok' | 'offline' | 'unavailable',
 * items, query }. A slow answer for an older word never overwrites a newer one. Fewer than 2 letters → idle.
 */
export function createOnlineSearch({ onUpdate, delay = 300, providers = PROVIDERS }) {
  let timer = null;
  let seq = 0;
  return {
    query(q) {
      const text = String(q || '').trim();
      clearTimeout(timer);
      const mine = ++seq;
      if (text.length < MIN_ONLINE_CHARS) { onUpdate({ state: 'idle', items: [], query: text }); return; }
      onUpdate({ state: 'loading', items: [], query: text });
      timer = setTimeout(async () => {
        const r = await searchRemote(text, providers);
        if (mine === seq) onUpdate({ ...r, query: text });
      }, delay);
    },
    cancel() { clearTimeout(timer); seq++; },
  };
}
