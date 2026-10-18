import { readFileSync, readdirSync } from 'node:fs';
import { test, assert } from './harness.js';
import { sharedRingFor } from '../js/ui/motion.js';

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
