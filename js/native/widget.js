// Keeps the home-screen and lock-screen widgets current. In the iPhone app the local ForgeWidget plugin
// (ios/App/App/ForgeWidgetPlugin.swift) stores the snapshot where the widget can read it and reloads its timelines;
// on the web every function here does nothing. The snapshot itself is built in js/native/widget-core.js.
import { state, subscribe } from '../state.js';
import { todayKey } from '../ui.js';
import { currentTargets, weightSeries } from '../derived.js';
import { dayTotals } from '../food/core.js';
import { todayMissions, missionSettings } from '../missions/store.js';
import { plugin } from './bridge.js';
import { buildSnapshot, snapshotKey, shouldSend } from './widget-core.js';

const hk = () => plugin('ForgeWidget');
let lastKey = null;
let lastSent = 0;
let timer = null;
let cleared = false;
let lastRoute = { route: null, at: 0 };

/** The snapshot for right now from live state, or null before everything has loaded. */
export function currentSnapshot(now = Date.now()) {
  if (!state.user || !state.profile || state.partial) return null;
  const day = todayKey();
  const m = todayMissions();
  const row = (state.health_daily || []).find((r) => r && !r.deleted && (r.id || r.day) === day);
  const t = currentTargets();
  const tot = dayTotals(state.food_logs, day);
  return buildSnapshot({
    now, day,
    weighedIn: m.list.some((x) => x.id === 'weigh' && x.done),
    steps: row && typeof row.steps === 'number' ? row.steps : null, stepsGoal: missionSettings().steps,
    protein: tot.protein_g, proteinGoal: t && t.proteinG,
    kcal: tot.kcal, kcalCeiling: t && t.calories,
    series: weightSeries(), units: (state.settings && state.settings.units) || 'imperial',
  });
}

/** Hand the widget a fresh snapshot when something it shows has changed (or the last one is getting old). */
export function syncWidget({ force = false } = {}) {
  const P = hk();
  if (!P) return false;
  const snap = currentSnapshot();
  if (!snap) { if (state.user === null && !cleared) clearWidget(); return false; }
  const key = snapshotKey(snap);
  if (!shouldSend(lastKey, key, lastSent, snap.at, force)) return false;
  lastKey = key;
  cleared = false;
  lastSent = snap.at;
  try { const p = P.setSnapshot({ json: JSON.stringify(snap) }); if (p && p.catch) p.catch(() => {}); } catch { /* the widget keeps its last numbers */ }
  return true;
}

/** Call once at launch (iPhone app only). Re-syncs shortly after any data change and each time Forge comes to the front. */
export function startWidgetSync(doc = typeof document !== 'undefined' ? document : null, go = null) {
  const P = hk();
  if (!P) return false;
  const later = () => { clearTimeout(timer); timer = setTimeout(() => syncWidget(), 1500); };
  subscribe(later);
  if (doc) doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') { syncWidget({ force: true }); takeRoute(P, go); } });
  try { const p = P.addListener && P.addListener('route', (e) => openRoute(e && e.route, go)); if (p && p.catch) p.catch(() => {}); } catch { /* the cold-launch read below still works */ }
  takeRoute(P, go);
  later();
  return true;
}

/** A widget tap that launched the app: the route is waiting in the plugin. */
function takeRoute(P, go) {
  try { const p = P.takeRoute && P.takeRoute(); if (p && p.then) p.then((r) => openRoute(r && r.route, go)).catch(() => {}); } catch { /* nothing to open */ }
}

function openRoute(route, go) {
  if (typeof route !== 'string' || !/^[a-z]+(\/[\w-]+)?$/.test(route)) return;
  const now = Date.now();
  if (lastRoute.route === route && now - lastRoute.at < 2000) return; // the same tap arriving by two paths
  lastRoute = { route, at: now };
  if (go) go(route); else if (typeof location !== 'undefined') location.hash = `#/${route}`;
}

/** Sign-out or account delete: the widget should not keep showing someone's numbers. Resolves once the plugin has cleared. */
export async function clearWidget() {
  const P = hk();
  lastKey = null;
  cleared = true;
  if (!P) return false;
  try { await P.clear(); } catch { /* nothing stored */ }
  return true;
}
