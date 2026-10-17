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

test('typescale: Perfect week header is sentence case', () => {
  const c = rd('js/missions/celebrate.js');
  assert(c.includes('<h2 class="pw-title">Perfect week</h2>'), 'sentence case');
  assert(!c.includes('<h2 class="pw-title">Perfect Week'), 'old header gone');
});
