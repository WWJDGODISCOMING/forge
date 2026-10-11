// Navigation rules, kept free of the DOM so they can be unit-tested: which tab a screen belongs to, how
// deep it sits (tab root = 0), which way a screen change should animate, where "Back" goes, and
// per-tab scroll memory.

export const TAB_ORDER = ['today', 'train', 'food', 'body', 'weight'];

// Which tab lights up for each screen. Settings and its children have no tab: they light whichever tab opened Settings.
export const TAB_FOR = {
  session: 'train', play: 'train', summary: 'train', timer: 'train', library: 'train',
  history: 'weight', awards: 'weight', score: 'weight',
  metric: 'body', photos: 'body', progress: 'weight', trends: 'weight', weekly: 'weight',
  coach: 'today', program: 'today', food: 'food',
};

// Settings opens from the avatar on any tab root (no Settings tab). Everything behind it lights the tab you came from.
export const SETTINGS_SCREENS = new Set(['settings', 'locations', 'report', 'profile', 'withings', 'apple']);
let settingsOrigin = 'today';
export const getSettingsOrigin = () => settingsOrigin;
export const setSettingsOrigin = (tab) => { settingsOrigin = TAB_ORDER.includes(tab) ? tab : 'today'; };
/** Call for every route change: remembers which tab Settings would go back to. */
export function noteRoute(route) {
  if (!SETTINGS_SCREENS.has(route)) settingsOrigin = tabOf(route);
}

export const tabOf = (route) => (SETTINGS_SCREENS.has(route) ? settingsOrigin : TAB_FOR[route] || route);

/** Old bookmarks, notification links and the removed Settings tab: hash route -> where it lives now (null = unchanged). */
const OLD_ROUTES = { home: 'today', log: 'food', foods: 'food', diary: 'food' };
export function redirectRoute(parts) {
  const route = parts[0] || 'today';
  if (Object.hasOwn(OLD_ROUTES, route)) return [OLD_ROUTES[route], ...parts.slice(1)];
  return null;
}

// Screens that live at the root of a tab (the Progress tab has four siblings behind its segmented control).
const ROOTS = new Set(['progress', 'today', 'train', 'food', 'body', 'weight', 'score', 'trends', 'weekly']);
// Screens pushed on top of another one, one level deeper than their parent.
const DEPTH_2 = new Set(['play', 'summary']);

/** `parts` is the hash split on "/", e.g. ['withings', 'check']. */
export function routeDepth(parts) {
  const route = parts[0] || 'today';
  if (ROOTS.has(route)) return 0;
  if (DEPTH_2.has(route)) return 2;
  if (route === 'withings' && parts[1]) return 2; // Data check sits on top of Withings
  return 1;
}

/** 'push' | 'pop' | 'tab' | 'fade' for a change from one route to another. */
export function transitionKind(fromParts, toParts) {
  const df = routeDepth(fromParts);
  const dt = routeDepth(toParts);
  if (dt > df) return 'push';
  if (dt < df) return 'pop';
  if (dt === 0) return 'tab';
  return 'fade';
}

/** Hash to go to for "Back" from a detail screen, or null on a root screen. */
export function backTarget(parts) {
  const route = parts[0] || 'today';
  if (routeDepth(parts) === 0) return null;
  if (route === 'withings' && parts[1]) return '#/withings';
  if (route === 'play') return '#/session';
  if (route === 'summary') return '#/train';
  if (route === 'settings') return `#/${settingsOrigin}`;
  if (SETTINGS_SCREENS.has(route)) return '#/settings';
  return `#/${tabOf(route)}`;
}

const LABELS = {
  today: 'Today', train: 'Train', food: 'Food', body: 'Body', weight: 'Progress', settings: 'Settings',
  withings: 'Withings', session: 'Workout',
};
/** Title of the screen "Back" goes to, e.g. "Settings" (iOS shows the parent's title on the back button). */
export function backLabel(parts) {
  const target = backTarget(parts);
  if (!target) return null;
  return LABELS[target.replace(/^#\/?/, '')] || 'Back';
}

/** Large-title screens that should not show the title of their own sub-page (Progress shows one header). */
export const TITLE_FOR = {weight: 'Progress', trends: 'Progress', score: 'Progress', weekly: 'Progress' };

/** Per-tab scroll memory: tab roots restore where you left them; detail screens always start at the top. */
export function createScrollMemory() {
  const saved = new Map();
  return {
    save(route, y) {
      if (routeDepth([route]) === 0) saved.set(route, Math.max(0, Math.round(y)));
    },
    restore(route) {
      return routeDepth([route]) === 0 ? saved.get(route) || 0 : 0;
    },
    forget(route) {
      saved.delete(route);
    },
  };
}
