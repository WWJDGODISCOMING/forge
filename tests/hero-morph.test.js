import { readFileSync, readdirSync } from 'node:fs';
import { test, assert } from './harness.js';
import { sharedRingFor, ringMorphFor } from '../js/ui/motion.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('score-ring is never in static markup or screen templates', () => {
  const files = [...readdirSync(new URL('../js/screens', import.meta.url)).map((f) => 'js/screens/' + f), 'index.html'];
  for (const f of files) assert(!read(f).includes('score-ring'), f + ' must not hardcode score-ring');
});

test('the name is set around the transition and cleared after', () => {
  const m = read('js/ui/motion.js');
  assert(m.includes('style.viewTransitionName = shared.name'), 'sets the name');
  assert(m.includes("el.style.viewTransitionName = ''"), 'clears the name');
  assert(/finally\([\s\S]*untag\(\)/.test(m), 'clears when the transition finishes');
});

test('reduced motion skips the morph', () => {
  assert(read('js/ui/motion.js').includes('shared && !reducedMotion()'));
  assert(read('css/motion.css').includes('group(score-ring)'));
});

test('only Today <-> Score gets a ring', () => {
  assert(sharedRingFor(['today'], ['score']));
  assert(sharedRingFor(['score'], ['today']));
  assert(sharedRingFor([], ['score']));
  assert(sharedRingFor(['body'], ['score']) === null);
  assert(sharedRingFor(['score'], ['body']) === null);
});

test('Score card tap morphs even though Score is a tab root; tab bar and deep links do not', () => {
  assert(ringMorphFor(['today'], ['score'], { cardTap: true }), 'card tap today -> score');
  assert(ringMorphFor(['today'], ['score']) === null, 'plain tab bar today -> score');
  assert(ringMorphFor(['train'], ['score'], { cardTap: true }) === null, 'train -> score');
  assert(ringMorphFor(['score'], ['today'], { fromCard: true }), 'return after a card tap');
  assert(ringMorphFor(['score'], ['today']) === null, 'return after a tab bar visit');
  assert(ringMorphFor(['today'], ['score'], { cardTap: true, reduced: true }) === null, 'reduced motion');
  assert(ringMorphFor(['score'], ['today'], { fromCard: true, reduced: true }) === null, 'reduced motion back');
});

test('the hashchange handler uses ringMorphFor, and a card tap forgets Score scroll', () => {
  const a = read('js/app.js');
  assert(a.includes('ringMorphFor(from, to'));
  assert(/data-score[\s\S]{0,160}scrollMemory\.forget\('score'\)/.test(a));
});

test('the morph target ring skips the draw-in and the count-up', () => {
  assert(read('js/ui/motion.js').includes('el.closest(finalRing)'), 'no count-up');
  assert(read('js/health/ui.js').includes('keepRingFinal(root)'));
  assert(read('css/health.css').includes('.sc-pre .sc-final .sc-arc'));
});

test('the morph is skipped when a ring is off screen', () => {
  const m = read('js/ui/motion.js');
  assert(m.includes('onScreen(document.querySelector(shared.from))'));
  assert(m.includes('if (onScreen(el)) el.style.viewTransitionName'));
});
