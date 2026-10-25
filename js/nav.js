// Navigation rules, kept free of the DOM so they can be unit-tested: which tab a screen belongs to, how
// deep it sits (tab root = 0), which way a screen change should animate, where "Back" goes, and
// per-tab scroll memory.

export const TAB_ORDER = ['today', 'train', 'food', 'body', 'score'];

// Which tab lights up for each screen. Settings and its children have no tab: they light whichever tab opened Settings.
export const TAB_FOR = {
  session: 'train', play: 'train', live: 'train', summary: 'train', timer: 'train', library: 'train',
  history: 'score', awards: 'score', days: 'score', score: 'score',
  metric: 'body', photos: 'body', progress: 'score', trends: 'score', weekly: 'score',
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

// Where Back goes from a Settings child that was opened from outside Settings (Readiness -> Apple Health, Body ->
// Connect Withings). null = it was opened from Settings, or on a cold start: Back goes to Settings.
let childReturn = null;
export const getChildReturn = () => childReturn;
const isChild = (route) => SETTINGS_SCREENS.has(route) && route !== 'settings';
/** Call for every route change (from = null on a cold start): remembers where a Settings child should go Back to. */
export function noteNavigation(fromParts, toParts) {
  const to = (toParts && toParts[0]) || 'today';
  const fromRoute = fromParts && fromParts.length ? fromParts[0] || 'today' : null;
  if (PROGRESS_ROWS.has(to)) {
    if (PROGRESS_PARTS.has(fromRoute)) progressFrom = fromRoute;
    else if (!PROGRESS_ROWS.has(fromRoute)) progressFrom = null; // row to row keeps the earlier answer
  }
  if (!isChild(to)) return;
  const from = fromParts && fromParts.length ? fromParts[0] || 'today' : null;
  if (from === null || from === 'settings') childReturn = null;
  else if (!SETTINGS_SCREENS.has(from)) childReturn = `#/${fromParts.join('/')}`; // child to child keeps the earlier answer
}

// Awards, History and Coach are rows under each Progress part (Score, Week, Trends). Opened from one, Back returns to that part and the
// Progress tab stays lit; Coach opened from anywhere else (Today) stays on Today. null = not opened from a Progress part.
const PROGRESS_PARTS = new Set(['score', 'weekly', 'trends']);
const PROGRESS_ROWS = new Set(['awards', 'history', 'coach']);
let progressFrom = null;
export const getProgressFrom = () => progressFrom;

export const tabOf = (route) => {
  if (SETTINGS_SCREENS.has(route)) return settingsOrigin;
  if (route === 'coach' && progressFrom) return 'score';
  return TAB_FOR[route] || route;
};

/** Old bookmarks, notification links and the removed Settings tab: hash route -> where it lives now (null = unchanged). */
// The Progress tab is #/score; the weight chart and weigh-ins now live on Body (v0.15.21).
const OLD_ROUTES = { home: 'today', log: 'food', foods: 'food', diary: 'food', weight: ['body', 'weight'] };
export function redirectRoute(parts) {
  const route = parts[0] || 'today';
  if (Object.hasOwn(OLD_ROUTES, route)) return [].concat(OLD_ROUTES[route], parts.slice(1));
  return null;
}

// Screens that live at the root of a tab (the Progress tab has four siblings behind its segmented control).
const ROOTS = new Set(['progress', 'today', 'train', 'food', 'body', 'score', 'trends', 'weekly']);
// Screens pushed on top of another one, one level deeper than their parent.
const DEPTH_2 = new Set(['play', 'summary']);

/** `parts` is the hash split on "/", e.g. ['withings', 'check']. */
export function routeDepth(parts) {
  const route = parts[0] || 'today';
  if (ROOTS.has(route)) return 0;
  if (DEPTH_2.has(route)) return 2;
  if (route === 'withings' && parts[1]) return 3; // Data check sits on top of Withings
  if (SETTINGS_SCREENS.has(route) && route !== 'settings') return 2; // pushed on top of Settings
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
  if (route === 'days') return parts[1] ? '#/days' : '#/awards';
  if (route === 'summary') return '#/train';
  if (route === 'settings') return `#/${settingsOrigin}`;
  if (SETTINGS_SCREENS.has(route)) return childReturn || '#/settings';
  if (PROGRESS_ROWS.has(route) && progressFrom) return `#/${progressFrom}`;
  return `#/${tabOf(route)}`;
}

const LABELS = {
  today: 'Today', train: 'Train', food: 'Food', body: 'Body', settings: 'Settings',
  withings: 'Withings', session: 'Workout', coach: 'Coach', program: 'Program', history: 'History', awards: 'Awards', days: 'Past days',
  score: 'Progress', trends: 'Progress', weekly: 'Progress', progress: 'Progress', metric: 'Body', photos: 'Photos',
};
/** Title of the screen "Back" goes to, e.g. "Settings" (iOS shows the parent's title on the back button). */
export function backLabel(parts) {
  const target = backTarget(parts);
  if (!target) return null;
  return LABELS[target.replace(/^#\/?/, '').split('/')[0]] || 'Back';
}

/** Large-title screens that should not show the title of their own sub-page (Progress shows one header). */
export const TITLE_FOR = { trends: 'Progress', score: 'Progress', weekly: 'Progress' };

/**
 * What tapping a tab does (iOS rules). Another tab: switch. The tab you're on: a deeper screen scrolls to the top first
 * and a second tap pops to the tab's root; on a root it scrolls to the top (nothing more to pop).
 * Returns 'switch' | 'top' | 'root'.
 */
export function tabTapAction({ sameTab, depth, scrollY }) {
  if (!sameTab) return 'switch';
  if (depth === 0) return 'top';
  return scrollY > 8 ? 'top' : 'root';
}

/** The screen module each tab opens, so it can be loaded the moment a finger lands on the tab. */
export const TAB_MODULE = { today: 'today', train: 'train', food: 'food', body: 'body', score: 'score' };

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
