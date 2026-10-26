// Tiny app-wide store. Screens read from `state` and re-render when it changes.
const listeners = new Set();

export const LOADED_KEYS = ['profile', 'settings', 'locations', 'weights', 'workouts', 'cardio', 'programs', 'exercises'];
const notLoaded = () => Object.fromEntries(LOADED_KEYS.map((k) => [k, false]));

export const state = {
  user: null,
  loaded: notLoaded(),
  loadError: null,
  profile: null,
  settings: null,
  locations: [],
  weights: [],
  workouts: [],
  cardio: [],
  programs: [],
  exercises: [], // custom exercises
  body_measures: [], // server-written (Withings)
  health_daily: [], // server-written (Apple Health, W2)
  energy: {}, // Apple resting/active energy per day, kept on this phone only (js/nutrition/balance.js)
  foods: [], // My foods (v0.11.0)
  food_logs: [], // what you ate (v0.11.0)
  saved_meals: [], // favorite meals (v0.16.75)
  foodError: null, // set when the food collections can't be read (rules not published yet); the rest of the app still works
  integrations: {}, // server-written status: { withings: {...} }
  serverErrors: {}, // Firestore error code per server-written collection, e.g. { health_daily: 'permission-denied' }
  sync: typeof navigator === 'undefined' || navigator.onLine ? 'synced' : 'offline',

  /** True while signed in and a collection is still loading: a screen drawn now may show it, but must not remember or save anything from it.
   *  Known limit: if one collection never loads (offline first load, a rules error) this stays true, so missions and badges don't celebrate that session. */
  get partial() { return !!this.user && LOADED_KEYS.some((k) => !this.loaded[k]); },

  set(patch) {
    Object.assign(this, patch);
    listeners.forEach((fn) => fn(patch));
  },

  reset(user) {
    this.set({
      user, loaded: notLoaded(), loadError: null, profile: null, settings: null,
      locations: [], weights: [], workouts: [], cardio: [], programs: [], exercises: [],
      body_measures: [], health_daily: [], integrations: {}, serverErrors: {}, foods: [], food_logs: [], saved_meals: [], foodError: null, energy: {},
    });
  },
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const units = () => (state.settings && state.settings.units) || 'imperial';
