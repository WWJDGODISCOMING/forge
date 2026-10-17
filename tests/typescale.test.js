import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';

const rd = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('typescale: tokens exist, hero rules use them capped at 72px', () => {
  const t = rd('css/tokens.css');
  assert(/--t-hero:\s*56px/.test(t) && /--t-hero-sub:\s*44px/.test(t), 'tokens');
  assert(/min-width:\s*700px\)\s*\{\s*:root\s*\{\s*--t-hero:\s*64px/.test(t), 'duo 64px');
  const app = rd('css/app.css');
  assert(/\.big \{[^}]*min\(calc\(var\(--t-hero\) \* var\(--ts\)\), 72px\)/.test(app), '.big');
  assert(app.includes('700 min(calc(var(--t-hero) * var(--ts)), 72px)/1 var(--num)'), '.hero-num');
  assert(rd('css/food.css').includes('var(--t-hero-sub)'), 'food');
});

test('typescale: small phones, ring, baseline, onboarding face', () => {
  const t = rd('css/tokens.css'), app = rd('css/app.css'), h = rd('css/health.css'), f = rd('css/food.css');
  assert(/max-width:\s*359px\)\s*\{\s*:root\s*\{\s*--t-hero:\s*48px/.test(t), '48px token');
  assert(/max-width:\s*359px\)\s*\{\s*\.hero-num, \.big \{ font-size: min\(calc\(var\(--t-hero\) \* var\(--ts\)\), 48px\)/.test(app), '48px cap');
  assert(/\.score-mini \{[^}]*flex:\s*none/.test(h), 'ring flex none');
  assert(/\.hero-num\.w-hero \{ display: flex; flex-wrap: wrap; align-items: baseline; column-gap: \.22em/.test(h) && /\.w-hero small/.test(h), 'w-hero wraps as units');
  assert(/\.big small \{ white-space: nowrap/.test(app), 'big small nowrap');
  assert(/\.meter-val \{ align-items: baseline/.test(f), 'baseline');
  assert(/\.big \{[^}]*font-family: var\(--num\)/.test(app), '.big face');
});

test('typescale: Perfect week header is sentence case', () => {
  const c = rd('js/missions/celebrate.js');
  assert(c.includes('<h2 class="pw-title">Perfect week</h2>'), 'sentence case');
  assert(!c.includes('<h2 class="pw-title">Perfect Week'), 'old header gone');
});
