// Service worker: caches the app so it opens with no signal, and hands off new versions.
// Bump VERSION here AND in js/version.js on every release.
const VERSION = '0.15.10';
const CACHE = `forge-${VERSION}`;
const FB = 'https://www.gstatic.com/firebasejs/12.19.0';
// Demo photos live in their own cache (not versioned, not precached): see js/ui/photos.js.
const MEDIA = 'media-ex-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './config.js',
  './css/tokens.css',
  './css/app.css',
  './css/nav.css',
  './css/motion.css',
  './css/player.css',
  './css/health.css',
  './css/photos.css',
  './css/missions.css',
  './css/report.css',
  './css/food.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './js/app.js',
  './js/version.js',
  './js/nav.js',
  './js/firebase.js',
  './js/db.js',
  './js/auth.js',
  './js/state.js',
  './js/ui.js',
  './js/units.js',
  './js/export.js',
  './js/csv.js',
  './js/derived.js',
  './js/nutrition/targets.js',
  './js/food/core.js',
  './js/food/search.js',
  './js/food/portion.js',
  './js/food/flow.js',
  './js/weight/smoothing.js',
  './js/weight/reading.js',
  './js/weight/chart.js',
  './js/workouts/equipment.js',
  './js/workouts/exercises.js',
  './js/workouts/library.js',
  './js/workouts/history.js',
  './js/workouts/plan.js',
  './js/workouts/programs.js',
  './js/workouts/generator.js',
  './js/workouts/change.js',
  './js/workouts/progression.js',
  './js/workouts/recovery.js',
  './js/health/metrics.js',
  './js/health/readiness.js',
  './js/health/score.js',
  './js/health/today.js',
  './js/health/trends.js',
  './js/health/anomalies.js',
  './js/health/insights.js',
  './js/health/weekly.js',
  './js/health/goalpath.js',
  './js/health/delta.js',
  './js/health/weektext.js',
  './js/health/bodyprofile.js',
  './js/health/intel.js',
  './js/health/cards.js',
  './js/health/longterm.js',
  './js/health/longevity.js',
  './js/health/longview.js',
  './js/health/clinical.js',
  './js/health/pdf.js',
  './js/health/clinicalview.js',
  './js/health/zip.js',
  './js/health/apple-export.js',
  './js/timer.js',
  './js/ui/motion.js',
  './js/ui/gesture.js',
  './js/ui/controls.js',
  './js/ui/icons.js',
  './js/ui/pull.js',
  './js/ui/navbar.js',
  './js/ui/swipeback.js',
  './js/ui/skeleton.js',
  './js/ui/fx.js',
  './js/ui/sound.js',
  './js/ui/haptic.js',
  './js/ui/figure.js',
  './js/ui/poses.js',
  './js/ui/poses-lib.js',
  './js/ui/poses-home.js',
  './js/ui/poses-kb.js',
  './js/ui/poses-gym.js',
  './js/ui/poses-cardio.js',
  './js/ui/sheets.js',
  './js/ui/rig.js',
  './js/ui/bodymap.js',
  './js/ui/bodymap-data.js',
  './js/ui/photos.js',
  './js/ui/textsize.js',
  './js/screens/howto.js',
  './js/screens/awards.js',
  './js/screens/apple.js',
  './js/screens/score.js',
  './js/screens/trends.js',
  './js/screens/weekly.js',
  './js/screens/report.js',
  './js/screens/coach.js',
  './js/screens/food.js',
  './js/coach/answers.js',
  './js/coach/actions.js',
  './js/coach/data.js',
  './js/coach/lifts.js',
  './js/health/status.js',
  './js/health/ui.js',
  './js/missions/core.js',
  './js/missions/badges.js',
  './js/missions/store.js',
  './js/missions/ui.js',
  './js/body-programs/core.js',
  './js/body-programs/store.js',
  './js/body-programs/ui.js',
  './js/screens/program.js',
  './js/workouts/awards.js',
  './js/ui/sharecard.js',
  './js/ui/rings.js',
  './js/ui/badges.js',
  './js/workouts/awards-store.js',
  './js/workouts/rings.js',
  './js/workouts/clock.js',
  './js/workouts/session-core.js',
  './js/workouts/preview.js',
  './js/functions.js',
  './js/export-body.js',
  './js/withings/check.js',
  './js/withings/body.js',
  './js/withings/review.js',
  './js/withings/dedupe.js',
  './js/tour/steps.js',
  './js/tour/tour.js',
  './js/screens/withings.js',
  './js/screens/metric.js',
  './js/ui/linechart.js',
  './js/native/autoread.js',
  './js/native/bridge.js',
  './js/native/expiry.js',
  './js/native/refresh-ui.js',
  './js/native/health.js',
  './js/native/share.js',
  './js/deliver-file.js',
  './js/ui/errors.js',
  './data/metrics.json',
  './withings-connected.html',
  './js/workouts/live.js',
  './js/screens/auth.js',
  './js/screens/onboarding.js',
  './js/screens/today.js',
  './js/screens/weight.js',
  './js/screens/settings.js',
  './js/screens/locations.js',
  './js/screens/train.js',
  './js/screens/session.js',
  './js/screens/timer.js',
  './js/screens/history.js',
  './js/screens/library.js',
  './js/screens/picker.js',
  './js/screens/tools.js',
  './js/screens/player.js',
  './js/screens/summary.js',
  './js/screens/overlays.js',
  './js/screens/body.js',
  './js/screens/photos.js',
  './js/photos/core.js',
  './js/photos/zipwriter.js',
  './js/photos/store.js',
  './js/photos/image.js',
  './js/photos/metrics.js',
  './js/photos/access.js',
  './js/photos/capture.js',
  './js/photos/cards.js',
  './js/photos/compare.js',
  './js/photos/timelapse.js',
  './js/photos/deliver.js',
  './js/photos/settings.js',
  './js/screens/progress.js',
  './data/exercise-instructions.json',
  `${FB}/firebase-app.js`,
  `${FB}/firebase-auth.js`,
  `${FB}/firebase-firestore.js`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: 'reload', mode: url.startsWith('http') ? 'cors' : 'same-origin' }))
        )
      )
    )
  );
  // No skipWaiting here: the page shows a "new version" banner and the user chooses when to refresh.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('forge-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isSdk = url.href.startsWith(FB);
  if (!sameOrigin && !isSdk) return; // Firestore, Auth, APIs: let the network (and Firestore's own cache) handle them.

  // The test page (tests/run.html) must load from the network, not the cached app page.
  if (sameOrigin && url.pathname.includes('/tests/')) return;

  // Demo photos live in their own cache (they never change). The index is stale-while-revalidate, so a
  // weak gym signal never holds anything up; a photo that isn't cached and can't be fetched is a 504, and
  // the page falls back to the muscle list.
  if (sameOrigin && url.pathname.includes('/media/ex/')) {
    if (url.pathname.endsWith('/index.json')) {
      event.respondWith(caches.open(MEDIA).then((c) => c.match(req).then((hit) => {
        const fresh = fetch(req).then((res) => {
          if (res.ok) c.put(req, res.clone());
          return res;
        });
        if (hit) {
          event.waitUntil(fresh.catch(() => {}));
          return hit;
        }
        return fresh.catch(() => new Response('{"ids":{}}', { headers: { 'content-type': 'application/json' } }));
      })));
      return;
    }
    event.respondWith(caches.open(MEDIA).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }))).catch(() => new Response('', { status: 504, statusText: 'Offline' })));
    return;
  }

  // The page Withings sends you back to after connecting is its own page, not the app.
  if (req.mode === 'navigate' && url.pathname.endsWith('/withings-connected.html')) {
    event.respondWith(fetch(req).catch(() => caches.match('./withings-connected.html')));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then((r) => r || fetch(req)));
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok && sameOrigin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
