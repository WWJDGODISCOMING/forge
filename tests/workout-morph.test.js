import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';
import { heroMorphFor } from '../js/ui/motion.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('workout card morph: only Start / Resume taps, both player routes, back only from the card, never on finish', () => {
  const up = { workoutTap: true };
  const a = heroMorphFor(['today'], ['play'], up);
  assert(a && a.length === 1 && a[0].name === 'workout-card' && a[0].from.includes('data-workout-card') && a[0].to.includes('data-player'));
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
