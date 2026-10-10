// The iPhone app keeps running after Refresh Forge installs a newer build over it. This notices (on resume, with
// visibilitychange as a fallback), reloads when it's safe, and says "Updated to x · What's new" once per version.
// The build writes { version, builtAt } into app-install.json (scripts/build-www.mjs); Refresh Forge adds `expires`.
import { isNative, plugin } from './bridge.js';
import { VERSION } from '../version.js';

const SEEN_KEY = 'forge.seenVersion';
const CLEAN_KEY = 'forge.nativeCleaned';

/** What identifies a build: { version, builtAt, expires } (missing fields are null). */
export const buildOf = (info) => {
  const i = info || {};
  return { version: i.version ? String(i.version) : null, builtAt: i.builtAt || null, expires: i.expires || null };
};

/** True when `latest` (a fresh app-install.json) is a different install than the running one. A field is only compared when both sides know it. */
export function isNewBuild(running, latest) {
  const a = buildOf(running), b = buildOf(latest);
  if (!b.version && !b.builtAt && !b.expires) return false; // unreadable: assume nothing changed
  if (b.version && a.version && b.version !== a.version) return true;
  if (b.builtAt && a.builtAt && b.builtAt !== a.builtAt) return true;
  if (b.expires && a.expires && b.expires !== a.expires) return true;
  return false;
}

/**
 * Reloading must never cost a set or a running rest. A workout screen (the player or the list) is left alone until you
 * leave it; so is a field you're typing in. Everything else is saved (workouts live in Firestore and the local cache,
 * the rest timer in localStorage) and survives a reload.
 */
export function safeToReload({ route = '', typing = false } = {}) {
  if (typing) return false;
  return route !== 'play' && route !== 'session';
}

/** Compare dotted versions: -1, 0, 1. */
export function cmpVersion(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** → { from, to } the first time a new version runs, else null (also null on a first install). Remembers the version. */
export function versionChange(store, now = VERSION) {
  let prev = null;
  try { prev = store.getItem(SEEN_KEY); } catch { return null; }
  try { store.setItem(SEEN_KEY, now); } catch { /* private mode */ }
  return prev && prev !== now && cmpVersion(now, prev) > 0 ? { from: prev, to: now } : null;
}

// ---------- the check ----------
const readInstall = async () => {
  const r = await fetch('./app-install.json', { cache: 'no-store' });
  return r.ok ? r.json() : null;
};

let running = null;
let pending = false;
let checking = false;
let lastCheck = 0;

/** → 'reloading' | 'later' (new build, not safe yet) | 'same'. `deps` is for tests. */
export async function checkForUpdate({ read = readInstall, route = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'today').split('/')[0], typing = () => { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); }, reload = () => location.reload(), force = false } = {}) {
  if (checking && !force) return 'same';
  checking = true;
  try {
    if (!pending) {
      let latest = null;
      try { latest = await read(); } catch { return 'same'; } // offline: nothing to compare
      if (!running) { running = latest; return 'same'; } // first look = the build that is running now
      if (!isNewBuild(running, latest)) return 'same';
      pending = true;
    }
    if (!safeToReload({ route: route(), typing: typing() })) return 'later';
    pending = false;
    reload();
    return 'reloading';
  } finally { checking = false; }
}

export const _reset = () => { running = null; pending = false; checking = false; lastCheck = 0; };

/** Re-check when the app comes back to the front, and again when you leave a workout screen (a reload that had to wait). */
export function setupUpdates() {
  if (!isNative()) return;
  const go = () => {
    if (Date.now() - lastCheck < 1500) return;
    lastCheck = Date.now();
    checkForUpdate().catch(() => {});
  };
  go(); // remember the running build
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') go(); });
  // A reload that had to wait goes through once you've left the workout screen (after the new screen has drawn, so a field
  // of the old one no longer counts as "typing"), or when you stop typing.
  const retry = () => { if (pending) setTimeout(() => checkForUpdate().catch(() => {}), 600); };
  window.addEventListener('hashchange', retry);
  document.addEventListener('focusout', retry);
  const App = plugin('App');
  if (App && App.addListener) {
    try { const h = App.addListener('resume', go); if (h && h.catch) h.catch(() => {}); } catch { /* the visibilitychange fallback covers it */ }
  }
}

/** One-time cleanup: the iPhone app ships its files, so no service worker or `forge-*` cache may ever answer for them. */
export async function cleanOldCaches(store = localStorage) {
  if (!isNative()) return false;
  try { if (store.getItem(CLEAN_KEY) === '1') return false; } catch { /* run it */ }
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
    }
    if (typeof caches !== 'undefined') {
      for (const k of await caches.keys()) if (k.startsWith('forge-')) await caches.delete(k);
    }
    try { store.setItem(CLEAN_KEY, '1'); } catch { /* private mode */ }
  } catch { /* try again next launch */ }
  return true;
}

// ---------- "Updated to … · What's new" ----------
/** The sheet's list for one version: [] when nothing is bundled. */
export function highlightsFor(data, version) {
  const v = data && data[version];
  return v && Array.isArray(v.items) ? v.items.slice(0, 6) : [];
}

export async function announceUpdate({ store = localStorage, toast, sheet, esc } = {}) {
  if (!isNative()) return false;
  const change = versionChange(store);
  if (!change) return false;
  toast(`Updated to ${change.to}`, 7000, {
    action: {
      label: 'What’s new',
      onClick: async () => {
        let data = null;
        try { const r = await fetch('./whats-new.json'); if (r.ok) data = await r.json(); } catch { /* none bundled */ }
        const items = highlightsFor(data, change.to);
        const title = (data && data[change.to] && data[change.to].title) || '';
        sheet(`What’s new in ${change.to}`, (body, close) => {
          body.innerHTML = `${title ? `<p class="muted">${esc(title)}</p>` : ''}${items.length ? `<ul class="whats-new">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="muted">No notes for this version.</p>'}
            <button type="button" class="btn ghost grow" data-done>Done</button>`;
          body.querySelector('[data-done]').addEventListener('click', close);
        });
      },
    },
  });
  return true;
}
