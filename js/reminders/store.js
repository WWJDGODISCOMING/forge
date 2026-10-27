// Smart reminders: reads live state, hands the plan to the phone's notification centre (iPhone app) and feeds the
// in-app banner (web). Settings live in settings/main as `reminders`; goals come from the app's own settings, never constants.
import { state, subscribe } from '../state.js';
import { patch } from '../db.js';
import { todayKey } from '../ui.js';
import { currentTargets } from '../derived.js';
import { dayTotals, entriesOn } from '../food/core.js';
import { todayMissions, missionSettings } from '../missions/store.js';
import { streak } from '../workouts/awards.js';
import { isNative, scheduleReminderSet } from '../native/bridge.js';
import { normalize, planReminders, dueBanners, anyOn, ALL_IDS } from './core.js';

export const getReminders = () => normalize(state.settings && state.settings.reminders);

export function saveReminders(next) {
  if (state.partial) return;
  patch('settings', 'main', { reminders: next });
}

/** What the app knows about today, for deciding what to skip. Null until everything has loaded. */
export function snapshotNow() {
  if (!state.user || !state.profile || state.partial) return null;
  const day = todayKey();
  const m = todayMissions();
  const row = (state.health_daily || []).find((r) => r && !r.deleted && (r.id || r.day) === day);
  let t = null;
  try { t = currentTargets(); } catch { /* no goals yet */ }
  const goal = state.profile.trainingDays || 3;
  const week = streak(state.workouts, state.cardio || [], goal).thisWeek;
  const tot = dayTotals(state.food_logs, day);
  return {
    day,
    weighedIn: m.list.some((x) => x.id === 'weigh' && x.done),
    trained: m.list.some((x) => x.id === 'train' && x.done),
    weekMet: week.done >= week.goal,
    steps: row && typeof row.steps === 'number' ? row.steps : null,
    stepsGoal: missionSettings().steps,
    protein: tot.protein_g,
    proteinGoal: t && t.proteinG > 0 ? t.proteinG : null,
    foodCount: entriesOn(state.food_logs || [], day).length,
  };
}

let lastKey = '';
let timer = null;

/** Replace the scheduled set with a fresh plan. `ask` is only for the tap that switches a reminder on. */
export async function syncReminders({ ask = false, force = false } = {}) {
  if (!isNative()) return 'web';
  const snap = snapshotNow();
  if (!snap) return 'wait';
  const settings = getReminders();
  const list = anyOn(settings) ? planReminders({ now: new Date(), settings, snap }) : [];
  const key = JSON.stringify(list.map((r) => [r.id, r.at, r.body]));
  if (!force && !ask && key === lastKey) return 'same';
  const res = await scheduleReminderSet(list, ALL_IDS, { ask });
  if (res === 'ok') lastKey = key;
  return res;
}

/** Call once at launch. Re-plans shortly after any data or settings change and every time the app comes to the front. */
export function startReminders(doc = typeof document !== 'undefined' ? document : null) {
  if (!isNative()) return false;
  subscribe(() => { clearTimeout(timer); timer = setTimeout(() => syncReminders(), 2000); });
  if (doc) doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') syncReminders({ force: true }); });
  return true;
}

// ---- in-app banner (the web app can't send notifications) ----
const dismissKey = () => `forge.reminders.${state.user ? state.user.uid : 'x'}.${todayKey()}`;
export function dismissedToday() {
  try { return JSON.parse(localStorage.getItem(dismissKey()) || '[]'); } catch { return []; }
}
export function dismissToday(kind) {
  try { localStorage.setItem(dismissKey(), JSON.stringify([...new Set([...dismissedToday(), kind])])); } catch { /* private mode */ }
}

/** Banners to show on Today right now. Web only: the iPhone app uses real notifications. */
export function bannersNow() {
  if (isNative()) return [];
  const snap = snapshotNow();
  if (!snap) return [];
  return dueBanners({ now: new Date(), settings: getReminders(), snap, dismissed: dismissedToday() });
}
