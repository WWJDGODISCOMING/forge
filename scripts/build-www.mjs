#!/usr/bin/env node
// Builds www/, the folder the Forge iPhone app ships inside itself (capacitor.config.json → webDir).
//   npm run native:build        (then: npx cap sync ios)
// It copies the app's own files (not functions/, tests/, notes/…) and bundles Firebase's code: the web app
// loads it from Google's CDN, the iPhone app carries it, so it opens with no connection. Run it on your Mac;
// it needs the internet once to download Firebase. Nothing here changes the web app on GitHub Pages.
import { cp, mkdir, readFile, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'www');
export const COPY = ['index.html', 'manifest.json', 'config.js', 'css', 'js', 'data', 'icons', 'media'];
const CDN = /https:\/\/www\.gstatic\.com\/firebasejs\/(\d+\.\d+\.\d+)\/(firebase-[a-z-]+\.js)/g;
const LOCAL = '/vendor/firebase/';

async function* files(dir) {
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) yield* files(p);
    else yield p;
  }
}

/** Every Firebase CDN file the app imports: [{ version, file }]. */
export function cdnRefs(text) {
  const out = new Map();
  for (const m of text.matchAll(CDN)) out.set(m[2], { version: m[1], file: m[2] });
  return [...out.values()];
}

/** Point CDN imports at the bundled copies. */
export const localise = (text) => text.replace(CDN, (_, v, f) => `${LOCAL}${f}`);

/** The app version, read from js/version.js. */
export const readVersion = (text) => (/VERSION\s*=\s*'([^']+)'/.exec(text) || [])[1] || null;

const plain = (t) => t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\s+/g, ' ').trim();
const short = (t, n = 150) => (t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);

/** CHANGELOG.md → { "0.15.11": { title, items: [...] } } for the newest `max` versions (top-level bullets, plain text). */
export function whatsNew(changelog, max = 6) {
  const out = {};
  let cur = null;
  for (const line of changelog.split('\n')) {
    const h = /^## (\d+\.\d+\.\d+)\s+[—-]\s+(.*?)(?:\s+\(\d{4}-\d{2}-\d{2}\))?\s*$/.exec(line);
    if (h) {
      if (Object.keys(out).length >= max) break;
      cur = out[h[1]] = { title: plain(h[2]), items: [] };
    } else if (cur && /^- /.test(line) && cur.items.length < 6) {
      const t = plain(line.slice(2));
      if (t && !/^(Issue #|Tests?:|Part \d)/i.test(t)) cur.items.push(short(t));
    }
  }
  return out;
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  for (const f of COPY) await cp(join(ROOT, f), join(OUT, f), { recursive: true });

  // Which Firebase files the app uses, and their version.
  const refs = new Map();
  const texts = [];
  for await (const p of files(OUT)) {
    if (!['.js', '.html'].includes(extname(p))) continue;
    const t = await readFile(p, 'utf8');
    texts.push([p, t]);
    for (const r of cdnRefs(t)) refs.set(r.file, r);
  }
  // Download them (and anything they import from the same place).
  const vendor = join(OUT, LOCAL);
  await mkdir(vendor, { recursive: true });
  const queue = [...refs.values()];
  const done = new Set();
  let ok = true;
  while (queue.length) {
    const { version, file } = queue.shift();
    if (done.has(file)) continue;
    done.add(file);
    const url = `https://www.gstatic.com/firebasejs/${version}/${file}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      for (const r of cdnRefs(body)) if (!done.has(r.file)) queue.push(r);
      for (const m of body.matchAll(/from\s*["']\.\/(firebase-[a-z-]+\.js)["']/g)) if (!done.has(m[1])) queue.push({ version, file: m[1] });
      await writeFile(join(vendor, file), localise(body));
      console.log(`bundled ${file} (${version})`);
    } catch (e) {
      ok = false;
      console.warn(`could not download ${url}: ${e.message}`);
    }
  }
  if (ok) for (const [p, t] of texts) await writeFile(p, localise(t));
  else console.warn('Firebase not bundled: the app will load it from the internet (it still works when online).');
  // When this copy was built: the app's weekly-refresh countdown starts here (js/native/expiry.js).
  // `version` + `builtAt` let a running app notice that a newer build was installed over it (js/native/update.js).
  const version = readVersion(await readFile(join(ROOT, 'js', 'version.js'), 'utf8'));
  await writeFile(join(OUT, 'app-install.json'), JSON.stringify({ version, builtAt: new Date().toISOString() }) + '\n');
  // The short "What's new" list shown once after an update (generated from CHANGELOG.md).
  await writeFile(join(OUT, 'whats-new.json'), JSON.stringify(whatsNew(await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8'))) + '\n');
  console.log(`www/ ready (${COPY.join(', ')}). Next: npx cap sync ios`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e); process.exit(1); });
