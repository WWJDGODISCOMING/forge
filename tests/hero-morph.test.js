import { readFileSync, readdirSync } from 'node:fs';
import { test, assert } from './harness.js';
import { sharedRingFor, ringMorphFor, heroMorphFor } from '../js/ui/motion.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('score-ring is never in static markup or screen templates', () => {
  const files = [...readdirSync(new URL('../js/screens', import.meta.url)).map((f) => 'js/screens/' + f), 'index.html'];
  for (const f of files) assert(!read(f).includes('score-ring'), f + ' must not hardcode score-ring');
});

test('the name is set around the transition and cleared after', () => {
  const m = read('js/ui/motion.js');
  assert(m.includes('style.viewTransitionName = p.name'), 'sets the name');
  assert(m.includes("el.style.viewTransitionName = ''"), 'clears the name');
  assert(/finally\([\s\S]*untag\(\)/.test(m), 'clears when the transition finishes');
});

test('reduced motion skips the morph', () => {
  assert(read('js/ui/motion.js').includes('!reducedMotion() && onScreen('));
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
  assert(a.includes('heroMorphFor(from, to'));
  assert(/data-score[\s\S]{0,160}scrollMemory\.forget\('score'\)/.test(a));
});

test('the morph target ring skips the draw-in and the count-up', () => {
  assert(read('js/ui/motion.js').includes('el.closest(finalRing)'), 'no count-up');
  assert(read('js/health/ui.js').includes('keepRingFinal(root)'));
  assert(read('css/health.css').includes('.sc-pre .sc-final .sc-arc'));
});

test('the morph is skipped when a ring is off screen', () => {
  const m = read('js/ui/motion.js');
  assert(m.includes('onScreen(document.querySelector(p.from))'));
  assert(m.includes('if (onScreen(el)) el.style.viewTransitionName = p.name'));
});

test('weight names are never in static markup or screen templates', () => {
  const files = [...readdirSync(new URL('../js/screens', import.meta.url)).map((f) => 'js/screens/' + f), 'index.html'];
  for (const f of files) for (const n of ['weight-num', 'weight-chart']) assert(!read(f).includes(n), f + ' must not hardcode ' + n);
});

test('weight parts: card tap Today -> Body, and back only when opened from the card', () => {
  const go = heroMorphFor(['today'], ['body', 'weight'], { weightTap: true });
  assert(go && go.length === 2 && go[0].name === 'weight-num' && go[1].name === 'weight-chart', 'card tap');
  assert(heroMorphFor(['today'], ['body', 'weight']) === null, 'tab bar / deep link');
  assert(heroMorphFor(['train'], ['body', 'weight'], { weightTap: true }) === null, 'other route');
  assert(heroMorphFor(['today'], ['body', 'weight'], { weightTap: true, reduced: true }) === null, 'reduced motion');
  const back = heroMorphFor(['body', 'weight'], ['today'], { weightFromCard: true });
  assert(back && back[0].to.includes('weight-card') && back[1].to.includes('spark'), 'return');
  assert(heroMorphFor(['body', 'weight'], ['today']) === null, 'return after other visit');
  assert(heroMorphFor(['body', 'weight'], ['today'], { weightFromCard: true, reduced: true }) === null, 'back reduced');
});

test('Score results unchanged through heroMorphFor', () => {
  const r = heroMorphFor(['today'], ['score'], { cardTap: true });
  assert(r && r.length === 1 && r[0].name === 'score-ring');
  assert(heroMorphFor(['today'], ['score']) === null);
});

test('every incoming morph part is marked final in render(), not only rings', () => {
  const a = read('js/app.js');
  assert(/keepRingFinal\(main\);[\s\S]{0,160}animateCounters\(main\)/.test(a), 'render marks final before counters');
  assert(read('js/ui/motion.js').includes("toFinal: '[data-weight-hero] .chart'"));
});

test('See chart only flags the weight morph when there is a reading', () => {
  assert(read('js/app.js').includes("weightTap = !!main.querySelector('[data-weight-open]')"));
});

test('weight tap target: VoiceOver reads content, press feedback, pointer', () => {
  const t = read('js/screens/today.js');
  assert(!/aria-label="Weight chart"/.test(t), 'no label hiding the value');
  const c = read('css/motion.css');
  assert(c.split('[data-weight-open]:active').length - 1 >= 2, 'active in normal and reduced motion');
  assert(/\[data-weight-open\] \{\s*cursor: pointer/.test(c));
});

test('weight morph wiring: tap target and CSS', () => {
  assert(read('js/screens/today.js').includes('data-weight-open'));
  const c = read('css/motion.css');
  assert(c.includes('group(weight-num)') && c.includes('group(weight-chart)'));
});

test('food names are never in static markup or screen templates', () => {
  const files = [...readdirSync(new URL('../js/screens', import.meta.url)).map((f) => 'js/screens/' + f), 'index.html'];
  for (const f of files) for (const n of ['name: \'food-card', 'name: \'food-kcal']) assert(!read(f).includes(n), f + ' must not hardcode ' + n);
});

test('food parts: card tap Today -> Food (today shown), back only when opened from the card', () => {
  const go = heroMorphFor(['today'], ['food'], { foodTap: true });
  assert(go && go.length === 2 && go[0].name === 'food-card' && go[1].name === 'food-kcal', 'card tap');
  assert(heroMorphFor(['today'], ['food']) === null, 'tab bar / deep link / Log food');
  assert(heroMorphFor(['today'], ['food'], { foodTap: true, foodToday: false }) === null, 'another day shown');
  assert(heroMorphFor(['train'], ['food'], { foodTap: true }) === null, 'other route');
  assert(heroMorphFor(['today'], ['food'], { foodTap: true, reduced: true }) === null, 'reduced motion');
  const back = heroMorphFor(['food'], ['today'], { foodFromCard: true });
  assert(back && back[0].to.includes('data-food-card') && back[1].to.includes('food-card-kcal'), 'return');
  assert(heroMorphFor(['food'], ['today']) === null, 'return after other visit');
  assert(heroMorphFor(['food'], ['today'], { foodFromCard: true, foodToday: false }) === null, 'day changed on Food');
  assert(heroMorphFor(['food'], ['today'], { foodFromCard: true, reduced: true }) === null, 'back reduced');
});

test('Score and Weight unchanged with food flags set', () => {
  assert(heroMorphFor(['today'], ['score'], { cardTap: true, foodTap: true })[0].name === 'score-ring');
  assert(heroMorphFor(['today'], ['body', 'weight'], { weightTap: true, foodTap: true })[0].name === 'weight-num');
});

test('food morph wiring: tap flags, Log food excluded, CSS', () => {
  const a = read('js/app.js');
  assert(a.includes("closest('.food-card-text, .food-card-ring')") && !a.includes('data-food-log') );
  assert(/foodTap = true;\s*scrollMemory\.forget\('food'\)/.test(a));
  const c = read('css/motion.css');
  assert(c.includes('group(food-card)') && c.includes('group(food-kcal)') && /food-kcal\) \{[^}]*z-index: 11/.test(c));
});

test('food card snapshots are not stretched; ring and text links get press feedback', () => {
  const c = read('css/motion.css');
  const rule = c.split('\n').find(l => l.startsWith('::view-transition-old(food-card), ::view-transition-new(food-card)'));
  assert(rule && !/height: 100%|object-fit: fill/.test(rule) && rule.includes('object-fit: none'), 'food-card sizing');
  assert(/view-transition-old\(food-card\) \{[^}]*animation-duration: 160ms/.test(c), 'old fade');
  assert(c.split('.food-card-ring:active').length - 1 >= 2, 'active in normal and reduced motion');
  assert(/\.food-card-text, \.food-card-ring, \[data-weight-open\] \{\s*cursor: pointer/.test(c), 'cursor');
});
