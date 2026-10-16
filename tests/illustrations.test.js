import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';
import { illustration } from '../js/ui/illustrations.js';
import { emptyState } from '../js/ui/icons.js';

const rd = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('illustrations: five names, decorative 120x96 svg, two colour sources', () => {
  for (const n of ['photos', 'food', 'profile', 'scale', 'weigh']) {
    const s = illustration(n);
    assert(s.startsWith('<svg'), `${n}: svg`);
    assert(s.includes('viewBox="0 0 120 96"'), `${n}: viewBox`);
    assert(s.includes('aria-hidden="true"'), `${n}: aria-hidden`);
    assert(!s.includes('<text'), `${n}: no text`);
    assert(!/\sid=/.test(s), `${n}: no id`);
    const colours = (s.match(/(?:stroke|fill)="(?!none)([^"]+)"/g) || []).map((m) => m.replace(/^\w+="|"$/g, ''));
    for (const c of colours) assert(c === 'currentColor' || c.startsWith('var(--accent'), `${n}: colour ${c}`);
  }
  assert(illustration('nope') === '' && illustration('toString') === '', 'unknown is empty');
});

test('illustrations: emptyState art is optional and unchanged without it', () => {
  const plain = emptyState({ icon: 'food', title: 'T' });
  assert(plain.includes('class="es-icon"') && !plain.includes('es-art'), 'plain keeps badge');
  assert(emptyState({ icon: 'food', title: 'T', art: 'bogus' }) === plain, 'unknown art falls back');
  const art = emptyState({ icon: 'food', title: 'T', art: 'food' });
  assert(art.includes('class="es-art"') && !art.includes('es-icon'), 'art replaces badge');
});

test('illustrations: call sites pass the right art', () => {
  assert(/art: 'photos'/.test(rd('js/screens/photos.js')), 'photos');
  assert(/art: 'food'/.test(rd('js/screens/food.js')), 'food');
  const c = rd('js/health/cards.js');
  assert(/art: 'profile', icon: 'person'/.test(c) && /art: 'scale', icon: 'scale'/.test(c), 'cards');
  assert(/art: 'scale'/.test(rd('js/screens/body.js')), 'body');
  assert(/art: 'weigh'/.test(rd('js/screens/weight.js')), 'weight hero');
});

test('illustrations: empty-state titles balance their lines', () => {
  assert(/\.empty-state h3 \{[^}]*text-wrap: balance/.test(rd('css/app.css')), 'text-wrap: balance');
});
