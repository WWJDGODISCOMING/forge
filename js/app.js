// App boot: service worker, sign-in, live data, and a tiny hash router.
import { isNative, syncStatusBar, hideSplash, setupKeyboard, scheduleExpiryReminder } from './native/bridge.js';
import { setupLock, appLock } from './native/lock.js';
import { configured } from './firebase.js';
import { state, subscribe, LOADED_KEYS } from './state.js';
import { esc, toast, sheet, closeAllSheets } from './ui.js';
import { APP_NAME } from '../config.js';
import { stopRest, restRemaining } from './timer.js';
import { viewTransition, ringMorphFor, heroMorphFor, keepRingFinal, animateCounters, settleTicks, resetCounters, reducedMotion, onScreen } from './ui/motion.js';
import { loadPhotoIndex } from './ui/photos.js';
import { navBar, hideNavBar, screenNav } from './ui/navbar.js';
import { hapticTabs, hapticSegments, haptics } from './ui/haptic.js';
import { mountQuickLog, syncQuickLog, placeQuickLog } from './ui/quicklog.js';
import { setupTextSize } from './ui/textsize.js';
import { setupResizeAnchor } from './ui/anchor.js';
import { enhanceSegs } from './ui/controls.js';
import { fitCharts } from './ui/charts.js';
import { attachPull, detachPull, canPullSync, waitAtMost, PULL_WAIT_MS } from './ui/pull.js';
import { call } from './functions.js';
import { attachSwipeBack } from './ui/swipeback.js';
import { skeletonHTML } from './ui/skeleton.js';
import { tabOf, routeDepth, transitionKind, backTarget, backLabel, redirectRoute, noteRoute, noteNavigation, TITLE_FOR, createScrollMemory, tabTapAction, TAB_MODULE } from './nav.js';
import { decodeImages } from './ui/decode.js';

const main = document.getElementById('main');
const nav = document.getElementById('nav');
const syncPill = document.getElementById('sync');
const offlineBanner = document.getElementById('offline');
const scrollMemory = createScrollMemory();

setupTextSize(); // follow iOS Settings → Text Size (web and app)
setupResizeAnchor(); // folding or rotating keeps the card you were reading in place

// ---------- the iPhone app (Capacitor shell) ----------
if (isNative()) {
  document.documentElement.classList.add('native');
  setupLock(); // before anything else: with the lock on, the app is covered until Face ID says yes
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  syncStatusBar(dark.matches);
  dark.addEventListener('change', (e) => syncStatusBar(e.matches));
  setupKeyboard();
  // A newer build installed over this running app (Refresh Forge): notice on resume, reload when it's safe, say what's new.
  import('./native/update.js').then(async (u) => {
    await u.cleanOldCaches(); // no service worker or forge-* cache may ever answer for the app's own files
    const [{ isTimerRunning }, { isTourActive }] = await Promise.all([import('./screens/timer.js'), import('./tour/tour.js')]);
    u.holdReloadWhile(isTimerRunning);
    u.holdReloadWhile(isTourActive);
    u.holdReloadWhile(() => { const l = appLock(); return !!l && l.busy; }); // never reload under the Face ID prompt
    u.setupUpdates();
    const l = appLock();
    if (l) await l.whenUnlocked(); // the "Updated to" note waits for the lock
    setTimeout(() => u.announceUpdate({ toast, sheet, esc }), 1800);
  }).catch(() => {});
}
// The splash stays up until the first real screen is on the page (never a white flash or a blank frame), with a
// fallback so a slow start can't leave it covering the app.
let splashDone = !isNative();
const firstPaint = () => {
  if (splashDone) return;
  splashDone = true;
  requestAnimationFrame(() => requestAnimationFrame(hideSplash));
};
if (isNative()) setTimeout(firstPaint, 3500);

// ---------- service worker + "new version" banner ----------
function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (isNative()) return; // the iPhone app ships its files inside the app: no offline cache or update banner needed
  // Reload on controller change only if a service worker already controlled this page (a real update)
  // or you tapped the banner. The very first install also fires controllerchange (clients.claim), and
  // reloading then would just flash the page for no reason.
  const hadController = !!navigator.serviceWorker.controller;
  let userAccepted = false;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (!reg) return;
    const showBanner = (worker) => {
      const bar = document.getElementById('update');
      bar.hidden = false;
      bar.onclick = () => {
        userAccepted = true;
        worker.postMessage('SKIP_WAITING');
      };
    };
    if (reg.waiting && navigator.serviceWorker.controller) showBanner(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) showBanner(w);
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch((e) => console.warn('Service worker not registered:', e));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !(hadController || userAccepted)) return;
    reloading = true;
    location.reload();
  });
}

// ---------- sync status (inline in the nav bar, only when it isn't "Synced") ----------
let offlineTimer = 0;
function renderSync() {
  const labels = { saving: 'Saving…', offline: 'Offline' };
  const label = labels[state.sync] || '';
  syncPill.className = `nb-status ${state.sync}`;
  syncPill.textContent = label;
  syncPill.hidden = !state.user || !label;
  // Offline for more than a few seconds: say what that means.
  if (state.sync === 'offline') {
    if (!offlineTimer) offlineTimer = setTimeout(() => { offlineBanner.hidden = false; }, 4000);
  } else {
    clearTimeout(offlineTimer);
    offlineTimer = 0;
    offlineBanner.hidden = true;
  }
}

// ---------- routing ----------
const routes = {
  today: () => import('./screens/today.js').then((m) => m.renderToday(main)),
  train: () => import('./screens/train.js').then((m) => m.renderTrain(main)),
  session: () => import('./screens/session.js').then((m) => m.renderSession(main)),
  play: () => import('./screens/player.js').then((m) => m.renderPlayer(main)),
  summary: (id) => import('./screens/summary.js').then((m) => m.renderSummary(main, decodeURIComponent(id || ''))),
  body: () => import('./screens/body.js').then((m) => m.renderBody(main)),
  progress: () => import('./screens/progress.js').then((m) => { location.replace(`#/${m.lastProgressRoute()}`); }),
  live: () => import('./screens/live.js').then((m) => m.renderLive(main)),
  timer: () => import('./screens/timer.js').then((m) => m.renderTimer(main)),
  history: () => import('./screens/history.js').then((m) => m.renderHistory(main)),
  library: () => import('./screens/library.js').then((m) => m.renderLibrary(main)),
  days: (day) => import('./screens/days.js').then((m) => m.renderDays(main, day)),
  awards: () => import('./screens/awards.js').then((m) => m.renderAwards(main)),
  settings: () => import('./screens/settings.js').then((m) => m.renderSettings(main)),
  locations: () => import('./screens/locations.js').then((m) => m.renderLocations(main)),
  apple: () => import('./screens/apple.js').then((m) => m.renderApple(main)),
  score: () => import('./screens/score.js').then((m) => m.renderScore(main)),
  trends: () => import('./screens/trends.js').then((m) => m.renderTrends(main)),
  program: () => import('./screens/program.js').then((m) => m.renderProgram(main)),
  report: () => import('./screens/report.js').then((m) => m.renderReport(main)),
  weekly: () => import('./screens/weekly.js').then((m) => m.renderWeekly(main)),
  recaps: () => import('./screens/recap.js').then((m) => m.renderRecaps(main)),
  coach: () => import('./screens/coach.js').then((m) => m.renderCoach(main)),
  food: () => import('./screens/food.js').then((m) => m.renderFood(main)),
  withings: (sub) => import('./screens/withings.js').then((m) => m.renderWithings(main, sub)),
  metric: (key) => import('./screens/metric.js').then((m) => m.renderMetric(main, decodeURIComponent(key || 'weight_kg'))),
  photos: (sub) => import('./screens/photos.js').then((m) => m.renderPhotos(main, sub)),
  profile: () => import('./screens/onboarding.js').then((m) => m.renderOnboarding(main, { editing: true })),
};
// Screens that fill the whole screen (no tab bar, no nav bar).
const FULLSCREEN = new Set(['play', 'summary', 'profile', 'live']);

const routeParts = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'today').split('/');
const currentRoute = () => routeParts()[0];
const allLoaded = () => LOADED_KEYS.every((k) => state.loaded[k]);
// Coming back to the app, the skeleton waits for every collection. A returning user gets the real screen once their
// profile and settings are in and the skeleton has had a moment (later snapshots redraw it), so it never sits there.
const SKELETON_MAX_MS = 500;
let skeletonSince = 0;
let skeletonTimer = null;
// The early draw is read-only: only the two tab roots that read happily from partial data, and `state.partial` tells the
// parts that remember or save things (missions seen, badges, celebrations) to wait for the full data and the redraw that follows.
const EARLY_ROUTES = new Set(['today', 'train']);
const mayDrawEarly = () => !!(seenBefore() && EARLY_ROUTES.has(currentRoute()) && state.loaded.profile && state.loaded.settings && state.profile && skeletonSince && Date.now() - skeletonSince >= SKELETON_MAX_MS);

let pendingRender = false;
let lastRoute = null;
let skeletonFor = null;
const seenBefore = () => { try { return localStorage.getItem('forge.seen') === '1'; } catch { return false; } };
const markSeen = (on) => { try { if (on) localStorage.setItem('forge.seen', '1'); else localStorage.removeItem('forge.seen'); } catch { /* private mode */ } };

function loadErrorMessage(err) {
  const code = (err && err.code) || '';
  if (code.includes('permission-denied')) {
    return 'Can’t read your data: the database said “permission denied”. Did you publish the security rules (SETUP step 5)? If you just updated the app, publish the new firestore.rules too (DEPLOY.md).';
  }
  if (code.includes('unavailable')) return 'Can’t reach the database right now. Check your connection and try again.';
  return `Can’t read your data (${esc(code || (err && err.message) || 'unknown error')}).`;
}

// Old bookmarks and notification links (#/home, #/log ...) land on their new home, never on a blank screen.
function applyRedirect() {
  const to = redirectRoute(routeParts());
  if (!to) return false;
  location.replace(`#/${to.join('/')}`);
  return true;
}

// Settings has no tab: a small avatar (initials) at the top-right of each tab root's large title opens it.
function addAvatar(route) {
  const large = main.querySelector('.large-title');
  if (!large || routeDepth([route]) !== 0 || large.querySelector('[data-avatar]')) return;
  const src = (state.profile && state.profile.name) || (state.user && state.user.email) || '';
  const initial = (src.trim()[0] || '').toUpperCase();
  const a = document.createElement('a');
  a.href = '#/settings';
  a.className = 'avatar-btn';
  a.dataset.avatar = '';
  a.setAttribute('aria-label', 'Settings and profile');
  a.innerHTML = initial ? `<span aria-hidden="true">${esc(initial)}</span>` : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4"/></svg>';
  let acts = large.querySelector('.lt-actions');
  if (!acts) {
    acts = document.createElement('div');
    acts.className = 'lt-actions';
    large.appendChild(acts);
  }
  placeQuickLog(acts);
  acts.appendChild(a);
  // Make room for the avatar without wrapping or shrinking tap targets: first a smaller title and tighter gaps,
  // then the short button label ("+ Log" instead of "+ Log weight").
  // The title (nowrap) must also fit beside the actions on one line: a wrapped or overrunning h1 counts as not fitting.
  const fits = () => {
    const h1 = large.querySelector('h1');
    if (acts.getBoundingClientRect().right > large.getBoundingClientRect().right + 0.5) return false;
    if (!h1) return true;
    const lh = parseFloat(getComputedStyle(h1).lineHeight) || 0;
    return h1.scrollWidth <= h1.clientWidth + 0.5 && (!lh || h1.getBoundingClientRect().height <= lh * 1.5)
      && (h1.getBoundingClientRect().right <= acts.getBoundingClientRect().left + 0.5 || h1.getBoundingClientRect().top >= acts.getBoundingClientRect().bottom - 0.5);
  };
  const fit = () => {
    large.classList.remove('snug', 'tight', 'stacked');
    for (const step of ['snug', 'tight', 'stacked']) {
      if (fits()) break;
      large.classList.add(step);
    }
  };
  fit();
  // Refit whenever the title row or the actions change size (rotation, folding, text size, fonts), in both directions.
  if (avatarFit) avatarFit.disconnect();
  avatarFit = null;
  if (typeof ResizeObserver === 'function') {
    avatarFit = new ResizeObserver(fit);
    avatarFit.observe(acts);
    avatarFit.observe(large);
  }
}
let avatarFit = null;

// The quick-log + follows the screen: shown on tab roots only, never while a screen is changing.
const syncQL = (busy = false) => syncQuickLog({ parts: routeParts(), navHidden: nav.hidden, busy });
async function render() {
  try {
    await renderScreen();
  } finally {
    syncQL(false);
  }
}

async function renderScreen() {
  if (applyRedirect()) return;
  // Don't redraw under your fingers: if you're typing in the page, wait until you leave the field.
  const a = document.activeElement;
  if (a && main.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'radio' && a.type !== 'checkbox') {
    pendingRender = true;
    return;
  }
  pendingRender = false;
  renderSync();

  if (!configured) {
    firstPaint();
    nav.hidden = true;
    hideNavBar();
    main.innerHTML = `<section class="card stack"><h1>Almost there</h1>
      <p>Paste your Firebase settings into <code>config.js</code> (see SETUP.md, step 3), then reload.</p></section>`;
    return;
  }
  if (state.user && state.loadError) {
    firstPaint();
    nav.hidden = true;
    hideNavBar();
    main.innerHTML = `<section class="card stack"><h1>Something’s blocking your data</h1>
      <p>${loadErrorMessage(state.loadError)}</p>
      <button class="btn" data-retry>Try again</button></section>`;
    main.querySelector('[data-retry]').onclick = () => location.reload();
    return;
  }
  if (state.user === undefined || (state.user && !allLoaded() && !mayDrawEarly())) {
    if (!skeletonSince) skeletonSince = Date.now();
    if (!skeletonTimer) skeletonTimer = setTimeout(() => { skeletonTimer = null; renderScreen(); }, SKELETON_MAX_MS + 20);
    // A skeleton of the screen that's about to appear, never a spinner. Tab bar shows if you've been here before.
    nav.hidden = !seenBefore() || FULLSCREEN.has(currentRoute());
    hideNavBar();
    if (skeletonFor !== currentRoute()) {
      skeletonFor = currentRoute();
      main.innerHTML = skeletonHTML(currentRoute());
    }
    return;
  }
  skeletonFor = null;
  skeletonSince = 0;
  if (!state.user) {
    markSeen(false);
    nav.hidden = true;
    hideNavBar();
    const m = await import('./screens/auth.js');
    m.renderAuth(main);
    firstPaint();
    return;
  }
  if (!state.profile) {
    nav.hidden = true;
    hideNavBar();
    const m = await import('./screens/onboarding.js');
    m.renderOnboarding(main, { editing: false });
    firstPaint();
    return;
  }

  const route = routes[currentRoute()] ? currentRoute() : 'today';
  // The rest timer belongs to a running workout; never let it outlive one.
  if (restRemaining() > 0 && !state.workouts.some((w) => w.status === 'active' && !w.deleted)) stopRest();
  if (lastRoute === 'body' && route !== 'body') import('./screens/weight.js').then((m) => m.resetWeightPan());
  if (lastRoute === 'metric' && route !== 'metric') import('./screens/metric.js').then((m) => m.resetMetricPan());
  if (lastRoute === 'session' && route !== 'session') import('./screens/session.js').then((m) => m.leaveSession());
  if (lastRoute === 'play' && route !== 'play') import('./screens/player.js').then((m) => m.leavePlayer());
  if (lastRoute === 'live' && route !== 'live') import('./screens/live.js').then((m) => m.leaveLive());
  if (lastRoute === 'summary' && route !== 'summary') import('./ui/fx.js').then((m) => m.clearParticles());
  if (lastRoute !== route) screenNav(null); // sub-view nav (e.g. a Locations editor) never outlives its screen
  lastRoute = route;
  noteRoute(route);
  const tab = tabOf(route);
  nav.hidden = FULLSCREEN.has(route);
  document.body.classList.toggle('fullscreen', FULLSCREEN.has(route));
  nav.querySelectorAll('a').forEach((link) => {
    const target = link.getAttribute('href').slice(2);
    link.classList.toggle('active', target === tab);
    link.setAttribute('aria-current', target === tab ? 'page' : 'false');
  });
  try {
    await routes[route](...routeParts().slice(1));
    await decodeImages(main); // photos are decoded before the transition reveals them
    markSeen(true);
    firstPaint();
    if (FULLSCREEN.has(route)) hideNavBar();
    else navBar({ title: TITLE_FOR[route], back: backTarget(routeParts()), backLabel: backLabel(routeParts()) });
    addAvatar(route);
    hapticTabs(nav, onTab);
    enhanceSegs(main);
    fitCharts(main);
    syncPull(route);
    hapticSegments(main);
    keepRingFinal(main); // every incoming morph part (ring, weight number, chart) arrives final, not drawn in from empty
    animateCounters(main);
    settleTicks(main); // numbers the user just changed (food, weight, rings) roll instead of snapping
    // A brand-new account sees the how-to tour once, on Today, right after onboarding.
    if (route === 'today' && state.profile.tour === 'pending') import('./tour/tour.js').then((m) => m.maybeStartTour());
    // The Face ID lock is offered once in the iPhone app, after the tour is out of the way.
    else if (route === 'today' && isNative() && appLock()) Promise.all([import('./tour/tour.js'), import('./native/update.js'), import('./native/lock-ui.js')]).then(([t, u, m]) => m.maybeAskLock({ tourBusy: t.isTourActive(), noteSettled: u.updateNoteSettled() }));
  } catch (e) {
    console.error(e);
    firstPaint();
    hideNavBar();
    detachPull();
    main.innerHTML = `<section class="card"><h1>Something broke</h1><p class="muted">${esc(e.message)}</p></section>`;
  }
}

main.addEventListener('focusout', () => {
  setTimeout(() => {
    if (pendingRender) render();
  }, 0);
});

// Re-render when data changes, but not for sync-status-only updates. While a workout is open (player or
// list view), its own saves come back through the listener: skip those so animations aren't cut off.
// First run after the badges update: save the badges you already have, quietly (no celebrations), before
// any summary can show. Loaded lazily; it's a no-op once settings/main.awards_seen exists.
let awardsSeeded = false;
function seedAwards() {
  if (awardsSeeded || !allLoaded() || !state.settings || state.settings.awards_seen) return;
  awardsSeeded = true;
  import('./workouts/awards-store.js').then((m) => m.syncBadges());
}

// Missions count XP from the day they first run: remember that day once, after settings have loaded.
let missionsSeeded = false;
function seedMissions() {
  if (missionsSeeded || !allLoaded() || !state.settings) return;
  missionsSeeded = true;
  if (!state.settings.missions_started) import('./missions/store.js').then((m) => m.ensureStarted());
}

// A body program whose last week is over becomes history (once), judged on fully loaded data.
function settlePrograms() {
  if (!allLoaded() || !state.settings || !state.settings.body_program) return;
  import('./body-programs/store.js').then((m) => m.settleProgram());
}

// iPhone app: read Apple Health quietly on open and when Forge comes back to the front (every 6 h at most,
// and only once you've connected it on Settings → Apple Health).
let healthAutoAt = 0;
function autoHealth({ force = false } = {}) {
  if (!isNative() || !allLoaded() || !state.user || (!force && Date.now() - healthAutoAt < 60000)) return; // a foreground call is already throttled by watchForeground
  healthAutoAt = Date.now();
  import('./native/workouts-health.js').then((m) => m.retryPending()).catch(() => {}); // workouts that couldn't be sent at finish
  import('./screens/apple.js').then((m) => m.autoHealthSync({ force })).catch(() => {});
}
// Coming back to the front always re-reads today's burned calories (resting + active), past the 3 minute wait.
if (isNative()) import('./native/autoread.js').then((m) => m.watchForeground(document, () => autoHealth({ force: true })));
// A live workout the phone still holds but Forge has lost (a native end that timed out, cleared storage) is ended on launch and on every return to the front.
if (isNative()) {
  import('./native/live-workout.js').then((m) => {
    m.restore();
    m.reconcile();
    return import('./native/autoread.js').then((a) => a.watchForeground(document, () => m.refresh()));
  }).catch(() => {});
}
// Home-screen and lock-screen widgets: numbers handed over after data changes (js/native/widget.js).
if (isNative()) import('./native/widget.js').then((m) => m.startWidgetSync(document, (r) => { location.hash = `#/${r}`; })).catch(() => {});
// ...and a cheap re-read of today's steps and energy about every 5 minutes while Today or Food is showing (js/screens/apple.js refreshToday).
if (isNative()) setInterval(() => { if (document.visibilityState === 'visible' && ['today', 'food'].includes(currentRoute()) && allLoaded() && state.user) import('./screens/apple.js').then((m) => m.refreshToday()).catch(() => {}); }, 5 * 60 * 1000);

// iPhone app: a local notification the day before the free Apple ID signature runs out (js/native/expiry.js).
if (isNative()) {
  import('./native/expiry.js').then(async (m) => {
    const at = m.reminderAt(await m.loadExpiry());
    if (at != null) scheduleExpiryReminder(at); // never asks for permission here (Settings → "Remind me" does); none once it's past: the Today banner takes over
  }).catch(() => {});
}

// Saving that a celebration played (or that missions were seen) must not redraw Today: it would replace the card
// the effect is drawn on. The in-memory state is already up to date, so only these keys changing means nothing to draw.
const QUIET_SETTINGS = new Set(['missions_seen', 'missions_cele', 'perfect_weeks', 'updated_at']);
let lastSettings = null;
const onlyQuietChanged = (a, b) => {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (!QUIET_SETTINGS.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  return true;
};

const PLAYER_QUIET = new Set(['workouts', 'loaded', 'sync', 'energy', 'health_daily', 'cardio']);
let lastLoaded = '';
subscribe((patch) => {
  // A real snapshot arrives as { settings, loaded: {...state.loaded, settings: true} }: `loaded` (and `sync`) only count when they changed.
  const loadedNow = JSON.stringify(state.loaded || {});
  const loadedChanged = loadedNow !== lastLoaded;
  lastLoaded = loadedNow;
  const meaningful = Object.keys(patch).filter((k) => k !== 'sync' && (k !== 'loaded' || loadedChanged));
  const quiet = meaningful.join() === 'settings' && currentRoute() === 'today' && onlyQuietChanged(lastSettings, state.settings);
  lastSettings = state.settings ? { ...state.settings } : null;
  seedAwards();
  seedMissions();
  settlePrograms();
  autoHealth();
  const keys = Object.keys(patch);
  // Withings finished a history import while weight.csv rows are in Forge: drop the duplicate csv copies.
  if (('weights' in patch || 'integrations' in patch) && allLoaded()) import('./withings/dedupe.js').then((m) => m.dedupeCsv());
  if (keys.length === 1 && keys[0] === 'sync') return renderSync();
  if (quiet) return;
  const route = currentRoute();
  // Mid-workout, the player is left alone by anything that isn't about the workout: its own saves, and Apple Health's energy and daily numbers.
  if ((route === 'play' || route === 'session') && keys.every((k) => PLAYER_QUIET.has(k)) && state.workouts.some((w) => w.status === 'active' && !w.deleted)) return;
  render();
});

// ---------- pull to refresh (Today, Progress, Body) ----------
const PULL_ROUTES = new Set(['today', 'history', 'awards', 'score', 'body']);
let pullRoute = null;
let lastPullSync = 0;
async function refreshData() {
  const w = state.integrations && state.integrations.withings;
  // Re-read the cache always; ask Withings for new weigh-ins only where that button already exists (Settings → Withings).
  // The spinner waits at most PULL_WAIT_MS; a slower sync carries on in the background (toast only if it fails),
  // and a pull won't start another one within the cooldown.
  if (w && w.connected && !w.needs_reconnect && navigator.onLine && canPullSync(Date.now(), lastPullSync)) {
    lastPullSync = Date.now();
    const sync = call('withingsSyncNow', {}, { timeout: 130000 }).then(() => 'ok', (e) => { toast(e.message); return 'failed'; });
    if ((await waitAtMost(sync, PULL_WAIT_MS)) === 'timeout') sync.then((r) => { if (r === 'ok') render(); });
  }
  if (isNative()) await import('./screens/apple.js').then((m) => m.refreshToday({ force: true })).catch(() => {});
  resetCounters();
  await render();
}
function syncPull(route) {
  if (!PULL_ROUTES.has(route)) {
    detachPull();
    pullRoute = null;
  } else if (pullRoute !== route) {
    attachPull(refreshData);
    pullRoute = route;
  }
}

// ---------- screen changes ----------
let prevParts = routeParts();
let snapshot = null; // { route, html, scroll } of the parent screen, for the swipe-back parallax
let swipePop = null; // set while an edge swipe is finishing: the screen already slid away, so don't animate again

// Train draws the recovery card a beat after the route changes, so start at the top (Body's scroll must not carry
// over) and jump to the card the moment it exists, giving up after 1.5 s.
let recoveryWatch = null;
function scrollToRecovery() {
  if (recoveryWatch) recoveryWatch();
  window.scrollTo(0, 0);
  let done = false;
  let mo = null;
  const stop = () => {
    done = true;
    if (mo) mo.disconnect();
    clearTimeout(timer);
    if (recoveryWatch === stop) recoveryWatch = null;
  };
  const tryScroll = () => {
    if (done) return;
    const card = main.querySelector('[data-recovery-card]');
    if (!card) return;
    card.scrollIntoView({ block: 'start', behavior: 'instant' }); // html scroll-padding-top keeps it under the title bar
    stop();
  };
  const timer = setTimeout(stop, 1500);
  recoveryWatch = stop;
  mo = new MutationObserver(tryScroll);
  mo.observe(main, { childList: true, subtree: true });
  tryScroll();
}

function afterRoute(parts) {
  const route = parts[0] || 'today';
  const link = parts[1];
  // Links that mean "my weight", "log a weight" or "the recovery map" open the thing itself, not wherever the tab was left.
  if (route === 'body' && (link === 'weight' || link === 'log')) {
    window.scrollTo(0, 0);
    if (link === 'log') {
      history.replaceState(null, '', '#/body'); // so a later redraw or Back doesn't reopen the sheet
      import('./screens/weight.js').then((m) => m.openLogWeight());
    }
    return;
  }
  if (route === 'train' && link === 'recovery') {
    scrollToRecovery();
    return;
  }
  window.scrollTo(0, scrollMemory.restore(route)); // tab roots remember where you were; detail screens start at the top
}

// Tapping the Score card on Today grows its ring into Score (a tab switch, so it is flagged here); tapping Today
// from a Score opened that way shrinks it back. Used up by the next hashchange.
let cardTap = false;
let scoreFromCard = false;
main.addEventListener('click', (e) => {
  if (!e.target.closest('[data-score]')) return;
  cardTap = true;
  scrollMemory.forget('score'); // opens at the top, so the ring is on screen
});

// Same for the Weight card: its "See chart" link or the number + sparkline block grows into the Body weight hero.
let weightTap = false;
let weightFromCard = false;
const openWeight = () => { weightTap = true; location.hash = '#/body/weight'; };
main.addEventListener('click', (e) => {
  if (e.target.closest('.weight-card .card-link')) { weightTap = !!main.querySelector('[data-weight-open]'); return; } // no reading: nothing to fly
  if (e.target.closest('[data-weight-open]')) openWeight();
});
main.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-weight-open]')) { e.preventDefault(); openWeight(); }
});

// And the Food card: its text link or small ring grows into the Food totals card. Log food never sets it.
let foodTap = false;
let foodFromCard = false;
main.addEventListener('click', (e) => {
  if (!e.target.closest('.food-card-text, .food-card-ring')) return;
  foodTap = true;
  scrollMemory.forget('food'); // opens at the top, so the totals card is on screen
  import('./screens/food.js').then((m) => m.showFoodToday());
  if (!e.target.closest('a')) location.hash = '#/food';
});

// And the filled Progress photos card on Body: its thumb strip grows into the Photos screen. The empty promo and the
// Today reminder go to Take photos and never set it.
let photosTap = false;
let photosFromCard = false;
main.addEventListener('click', (e) => {
  if (!e.target.closest('[data-photos-card]')) return;
  photosTap = true;
  scrollMemory.forget('photos'); // opens at the top, so the first set is on screen
});

// And the Today workout card: its Start button or the Resume/Finish card grows into the player. See plan never sets it.
let workoutTap = false;
let workoutFromCard = false;
main.addEventListener('click', (e) => {
  if (e.target.closest('[data-workout-card="resume"]')) { workoutTap = true; haptics.light(); return; }
  if (e.target.closest('[data-workout-card="start"] [data-start]')) workoutTap = true;
});

window.addEventListener('hashchange', async () => {
  closeAllSheets(); // a sheet never stays on top of the new screen (navigating button, deep link, back gesture)
  const from = prevParts;
  const to = routeParts();
  prevParts = to;
  noteNavigation(from, to);
  scrollMemory.save(from[0] || 'today', window.scrollY);
  // A focused field (e.g. Library search) would make render() wait for blur; a route change always renders.
  if (document.activeElement && main.contains(document.activeElement)) document.activeElement.blur();
  if (from[0] !== to[0] || from[1] !== to[1]) resetCounters();
  if (swipePop) {
    const done = swipePop;
    swipePop = null;
    await render();
    afterRoute(to);
    done();
    return;
  }
  const kind = transitionKind(from, to);
  let foodToday = true; // Food on another day would not match the Today card
  if (foodFromCard && from[0] === 'food') foodToday = await import('./screens/food.js').then((m) => m.foodShowsToday());
  const ring = heroMorphFor(from, to, { cardTap, fromCard: scoreFromCard, weightTap, weightFromCard, foodTap, foodFromCard, foodToday, photosTap, photosFromCard, workoutTap, workoutFromCard, reduced: reducedMotion() });
  // Only when the strip is really on screen to fly from; otherwise there is nothing to fly back to either.
  photosFromCard = photosTap && from[0] === 'body' && to[0] === 'photos' && !!ring && onScreen(document.querySelector('#main [data-photos-card] .pp-thumbs'));
  photosTap = false;
  workoutFromCard = workoutTap && (from[0] || 'today') === 'today' && !from[1] && !!ring && (to[0] === 'play' || to[0] === 'session');
  workoutTap = false;
  foodFromCard = foodTap && from[0] !== 'food' && to[0] === 'food' && !!ring;
  foodTap = false;
  scoreFromCard = cardTap && from[0] !== 'score' && to[0] === 'score' && !!ring; // any other navigation forgets it
  weightFromCard = weightTap && from[0] !== 'body' && to[0] === 'body' && !!ring;
  cardTap = false;
  weightTap = false;
  if (kind !== 'tab') syncQL(true); // hide the + at once for a push or pop; render() brings it back on a root
  // Keep the screen we are leaving (one level) so a swipe back can show it sliding in behind.
  if (kind === 'push') snapshot = { route: from.join('/'), html: main.innerHTML, scroll: window.scrollY };
  viewTransition(async () => {
    await render();
    afterRoute(to);
  }, reducedMotion() ? 'fade' : ring && ring.some((p) => p.name === 'workout-card') ? (kind === 'push' ? 'card-in' : 'card-out') : kind, ring);
});

// Tapping a tab: switch to it; tapping the tab you're on scrolls to the top, or pops a detail screen back to its root.
function onTab(link) {
  const href = link.getAttribute('href');
  const target = href.slice(2);
  const action = tabTapAction({ sameTab: target === tabOf(currentRoute()), depth: routeDepth(routeParts()), scrollY: window.scrollY });
  if (action === 'top') {
    if (routeDepth(routeParts()) === 0) scrollMemory.forget(currentRoute());
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    return;
  }
  if (action === 'root') scrollMemory.forget(target);
  workoutTap = false; workoutFromCard = false;
  photosFromCard = false; // a tab-bar tap forgets the card; only Back morphs home
  location.hash = href;
}
// A finger landing on a tab starts loading its screen, so the tap itself has nothing left to fetch.
nav.addEventListener('touchstart', (e) => {
  const a = e.target.closest && e.target.closest('a');
  const name = a && TAB_MODULE[a.getAttribute('href').slice(2)];
  if (name) import(`./screens/${name}.js`).catch(() => {});
}, { passive: true });
nav.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a || e.target.classList.contains('haptic-input')) return;
  e.preventDefault();
  onTab(a);
});

attachSwipeBack({
  el: main,
  canSwipe: () => routeDepth(routeParts()) > 0 && !FULLSCREEN.has(currentRoute()),
  getSnapshot: () => (snapshot && `#/${snapshot.route}` === backTarget(routeParts()) ? snapshot : null),
  onPop: ({ crossfade = false } = {}) => new Promise((resolve) => {
    // Reduced motion: nothing slid away, so let the normal route change crossfade.
    if (!crossfade) swipePop = resolve;
    else resolve();
    location.hash = backTarget(routeParts());
  }),
});
window.addEventListener('forge:error', (e) => toast(e.detail, 4000));

// ---------- boot ----------
mountQuickLog();
const WATCH = [
  ['profile', (rows) => ({ profile: rows.find((r) => r.id === 'main') || null })],
  ['settings', (rows) => ({ settings: rows.find((r) => r.id === 'main') || null })],
  ['locations', (rows) => {
    migrateInventory(rows);
    return { locations: rows };
  }],
  ['weights', (rows) => ({ weights: rows })],
  ['workouts', (rows) => ({ workouts: rows })],
  ['cardio_sessions', (rows) => ({ cardio: rows }), 'cardio'],
  ['programs', (rows) => ({ programs: rows })],
  ['exercises', (rows) => ({ exercises: rows })],
];
// Server-written (Withings, Apple Health). Not part of "loaded": if they fail (rules not published yet,
// functions not deployed) the app still opens; the Withings screen explains.
const WATCH_SERVER = [
  ['body_measures', (rows) => ({ body_measures: rows })],
  ['health_daily', (rows) => ({ health_daily: rows })],
  ['integrations', (rows) => ({ integrations: Object.fromEntries(rows.map((r) => [r.id || 'withings', r])) })],
];

// My foods and the food log. Like the server-written ones, they are not part of "loaded": if the rules aren't
// published yet the app still opens and the Food screen says what to do.
const WATCH_FOOD = [
  ['foods', (rows) => ({ foods: rows })],
  ['food_logs', (rows) => ({ food_logs: rows })],
  ['saved_meals', (rows) => ({ saved_meals: rows })],
];

// v0.1.x stored weight inventory in pounds (dumbbells_lb); v0.2.0 stores kg like everything else.
let dbModule = null;
function migrateInventory(rows) {
  if (!dbModule) return;
  for (const loc of rows) {
    const inv = loc.weight_inventory || {};
    if (!('dumbbells_lb' in inv) && !('kettlebells_lb' in inv)) continue;
    const kg = (list) => (list || []).map((lb) => Math.round(lb * 0.45359237 * 1000) / 1000);
    const next = { ...inv };
    if ('dumbbells_lb' in inv) {
      next.dumbbells_kg = next.dumbbells_kg || kg(inv.dumbbells_lb);
      delete next.dumbbells_lb;
    }
    if ('kettlebells_lb' in inv) {
      next.kettlebells_kg = next.kettlebells_kg || kg(inv.kettlebells_lb);
      delete next.kettlebells_lb;
    }
    loc.weight_inventory = next;
    dbModule.patch('locations', loc.id, { weight_inventory: next });
  }
}

async function boot() {
  // Which exercises have demo photos. If the index arrives after the player has drawn, redraw so the demo
  // box picks the photos up.
  loadPhotoIndex().then((ix) => {
    if (Object.keys(ix.ids).length && location.hash === '#/play') render();
  });
  document.title = APP_NAME;
  setupServiceWorker();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if (routeParts()[0] === 'train' && routeParts()[1] === 'recovery') scrollToRecovery(); // cold load of the deep link
  if (!configured) {
    render();
    return;
  }
  state.user = undefined; // "checking sign-in"
  render();

  const [{ onAuth }, db] = await Promise.all([import('./auth.js'), import('./db.js')]);
  dbModule = db;
  let unsubs = [];
  onAuth((user) => {
    unsubs.forEach((u) => u());
    unsubs = [];
    state.reset(user);
    if (!user) return;
    for (const [col, toPatch, key = col] of WATCH) {
      unsubs.push(db.watch(
        col,
        (rows) => state.set({ ...toPatch(rows), loaded: { ...state.loaded, [key]: true } }),
        (err) => state.set({ loadError: err })
      ));
    }
    const serverErr = {};
    const errs = () => ({ ...serverErr });
    for (const [col, toPatch] of WATCH_SERVER) {
      unsubs.push(db.watch(
        col,
        (rows) => { serverErr[col] = null; state.set({ ...toPatch(rows), serverErrors: errs() }); },
        (err) => { serverErr[col] = err.code || 'error'; state.set({ serverErrors: errs() }); }
      ));
    }
    const foodErr = {};
    for (const [col, toPatch] of WATCH_FOOD) {
      unsubs.push(db.watch(
        col,
        (rows) => { foodErr[col] = null; state.set({ ...toPatch(rows), foodError: Object.values(foodErr).find(Boolean) || null }); },
        (err) => { if (col === 'saved_meals') return; /* favorites only: until the new rules are published the rest of Food works and the favorites row stays empty */ foodErr[col] = err.code || 'error'; state.set({ foodError: Object.values(foodErr).find(Boolean) || null }); }
      ));
    }
    db.updateSync();
  });
}

boot();
