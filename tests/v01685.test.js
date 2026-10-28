// v0.16.85 (#235): illustrated empty states for Score, Progress and Withings. Synthetic only.
import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';
import { illustration } from '../js/ui/illustrations.js';
import { emptyState } from '../js/ui/icons.js';
import { longTermHtml, longevityHtml } from '../js/health/longview.js';

const rd = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('new art: ring and trend are decorative 120x96 svgs using only theme colours', () => {
  for (const n of ['ring', 'trend']) {
    const s = illustration(n);
    assert(s.startsWith('<svg') && s.includes('viewBox="0 0 120 96"') && s.includes('aria-hidden="true"'), `${n}: svg`);
    assert(!s.includes('<text') && !/\sid=/.test(s), `${n}: no text or id`);
    const colours = (s.match(/(?:stroke|fill)="(?!none)([^"]+)"/g) || []).map((m) => m.replace(/^\w+="|"$/g, ''));
    for (const c of colours) assert(c === 'currentColor' || c.startsWith('var(--accent'), `${n}: colour ${c}`);
  }
});

test('long-term card with no data shows art and a plain line, no fake numbers', () => {
  const h = longTermHtml({ status: 'short', weeksSoFar: 0 }, 90, '2026-10-12');
  assert(h.includes('es-art') && /No long-term view yet/.test(h) && /0 of \d+ weeks/.test(h), h);
  assert(!/%/.test(h), 'no percent');
});

test('longevity with no cards shows art and one action', () => {
  const h = longevityHtml([], 'imperial', '2026-10-12');
  assert(h.includes('es-art') && h.includes('href="#/apple"'), h);
});

test('withings no-data Sync now is disabled while syncing and is the only [data-sync]', () => {
  const w = rd('js/screens/withings.js');
  const line = w.split('\n').find((l) => l.includes('data-no-data'));
  assert(line && /attr: `data-sync data-own-haptic \$\{busy === 'sync' \? 'disabled' : ''\}`/.test(line), 'empty-state sync button disables on busy');
  // The usual button is skipped in the no-data state, so exactly one [data-sync] renders.
  assert(/\$\{noData \? '' : `<button class="btn ghost grow" data-sync/.test(w), 'usual button hidden when no data');
  const html = emptyState({ art: 'weigh', title: 'No weigh-ins yet', action: { attr: 'data-sync data-own-haptic disabled', label: 'Syncing…' } });
  assert((html.match(/data-sync/g) || []).length === 1 && /<button[^>]*data-sync[^>]*disabled/.test(html), html);
});

test('call sites use the empty state with art', () => {
  const sc = rd('js/screens/score.js');
  assert(/art: 'ring'/.test(sc) && /Log a workout/.test(sc), 'score');
  assert(/trackedCount > 0 \? `<div class="pillar-grid">/.test(sc), 'no empty pillar rings with no data');
  assert(/art: 'trend'/.test(rd('js/screens/trends.js')) && /art: 'trend'/.test(rd('js/screens/metric.js')), 'trends and metric');
  const w = rd('js/screens/withings.js');
  assert(/data-not-connected/.test(w) && /art: 'scale'/.test(w) && /data-no-data/.test(w) && /art: 'weigh'/.test(w), 'withings');
});
