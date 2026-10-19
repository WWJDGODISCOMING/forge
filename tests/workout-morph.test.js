import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';
import { heroMorphFor } from '../js/ui/motion.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('workout card morph: only Start / Resume taps, both player routes, back only from the card, never on finish', () => {
  const up = { workoutTap: true };
  const a = heroMorphFor(['today'], ['play'], up);
  assert(a && a.length === 1 && a[0].name === 'workout-card' && a[0].from.includes('data-workout-card') && a[0].content.includes('data-player'));
  assert(heroMorphFor([], ['session'], up), 'list player');
  assert(heroMorphFor(['today'], ['play']) === null, 'no tap (See plan, deep link)');
  assert(heroMorphFor(['train'], ['play'], up) === null, 'from Train');
  assert(heroMorphFor(['today'], ['play'], { workoutTap: true, reduced: true }) === null, 'reduced motion');
  const b = heroMorphFor(['play'], ['today'], { workoutFromCard: true });
  assert(b && b[0].to.includes('"resume"'), 'back to the Resume card');
  assert(heroMorphFor(['play'], ['today']) === null, 'back without the card');
  assert(heroMorphFor(['play'], ['summary'], { workoutFromCard: true }) === null, 'finish');
  assert(heroMorphFor(['play'], ['today'], { workoutFromCard: true, reduced: true }) === null, 'reduced back');
  assert(heroMorphFor(['today'], ['score'], { cardTap: true }), 'score unchanged');
});

test('workout card wiring: hook in all three states, flag, haptic, countdown after the morph, CSS', () => {
  const t = read('js/screens/today.js');
  for (const v of ['resume', 'done', 'start']) assert(t.includes('data-workout-card="' + v + '"'), v);
  const a = read('js/app.js');
  assert(a.includes('[data-workout-card="start"] [data-start]') && a.includes('haptics.light()'));
  assert(a.includes('workoutTap = false; workoutFromCard = false;'), 'tab-bar forgets');
  const p = read('js/screens/player.js');
  assert(/drawSet\(el\);\s*const go = [^\n]*dataset\.vt/.test(p), 'draws first, counts in after the morph');
  const c = read('css/motion.css');
  assert(c.includes('group(workout-card)') && c.includes('vt-pop-old-full'));
});

test('workout card morph: hero names hidden, own page kind, full-screen surface, snapshot not stretched', () => {
  const up = heroMorphFor(['today'], ['play'], { workoutTap: true })[0];
  assert(up.hide.includes('[data-hero]') && up.hide.includes('.rest-ring'), 'hero hidden while the card morphs');
  assert(up.surface && up.to === '#vt-surface' && up.contentSide === 'to', 'push grows into the surface');
  const back = heroMorphFor(['play'], ['today'], { workoutFromCard: true })[0];
  assert(back.hide && back.surface && back.from === '#vt-surface' && back.contentSide === 'from' && back.gate.includes('data-player'), 'pop shrinks from the surface');
  assert(heroMorphFor(['today'], ['body', 'weight'], { weightTap: true }).every((p) => !p.hide && !p.surface), 'other morphs untouched');
  const m = read('js/ui/motion.js');
  assert(m.includes("viewTransitionName = 'none'") && m.includes('hidden.forEach'), 'names cleared and restored');
  const a = read('js/app.js');
  assert(a.includes("'card-in' : 'card-out'") && a.includes("(from[0] || 'today') === 'today'"), 'own kind, same from rule');
  const c = read('css/motion.css');
  assert(c.includes('data-vt="card-in"]::view-transition-old(root)'), 'own page kind');
  assert(!/data-vt="card-(in|out)"\]::view-transition-(old|new)\(root\)[^}]*translate/.test(c), 'page behind does not slide');
  assert(/view-transition-new\(workout-card\)[^{]*\{[^}]*object-fit: none; object-position: left top/.test(c), 'snapshot keeps its size');
  assert(c.includes('vt-card-surface') && c.includes('border-radius: 0') && c.includes('#vt-surface'), 'surface to full screen');
});
