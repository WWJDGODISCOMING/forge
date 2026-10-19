import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test, assert } from './harness.js';

const root = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['node_modules', 'functions', 'tests', 'ios', '.git', 'icons', 'assets', 'docs', 'notes', 'scripts']);
const walk = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|css|html|json)$/.test(n) && !/qrcode/i.test(n)) out.push(p);
  }
  return out;
};
const files = walk(root);
const rel = (p) => p.slice(root.length);

// Lime is for wins and success only. Files allowed to hold it, and why.
const LIME_OK = new Set([
  'css/tokens.css', // --good, --gold, --ring-win and their tints
  'css/missions.css', // win bloom
  'js/ui/rings.js', // BURST confetti
  'js/ui/fx.js', // volt confetti
  'js/missions/celebrate.js', // celebrations
  'js/ui/sharecard.js', // PR highlight
  'js/ui/badges.js', // earned state
  'withings-connected.html', // success tick
]);

test('lime only appears in win/success places', () => {
  const bad = files.filter((f) => /c6ff3d|198, ?255, ?61/i.test(readFileSync(f, 'utf8')) && !LIME_OK.has(rel(f)));
  assert(bad.length === 0, 'lime outside the allow-list: ' + bad.map(rel).join(', '));
});

test('no old orange or near-black left in js/ and css/', () => {
  const bad = files.filter((f) => /^(js|css)\//.test(rel(f)) && /e0663f|ff6a2b|0a0a0b/i.test(readFileSync(f, 'utf8')));
  assert(bad.length === 0, 'old colours in: ' + bad.map(rel).join(', '));
});
