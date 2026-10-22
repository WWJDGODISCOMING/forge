// v0.16.52: badges flip in 3D. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { dragAngle, settleAngle, crossedMid, backInfo, howText, wireFlips } from '../js/ui/badge-flip.js';
import { awardsFor, badgeProgress, METERS, BADGES } from '../js/workouts/awards.js';
import { VERSION } from '../js/version.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('drag follows the finger: half a turn per card width, held to 0–180', () => {
  eq(dragAngle(0, 50, 100), 90);
  eq(dragAngle(0, -40, 100), 0);
  eq(dragAngle(180, 80, 100), 180);
  eq(dragAngle(180, -50, 100), 90);
});

test('release settles to the nearer side, and a flick tips it over', () => {
  eq(settleAngle(40), 0);
  eq(settleAngle(120), 180);
  eq(settleAngle(70, 0.8), 180, 'flick right from 70 goes to the back');
  eq(settleAngle(110, -0.8), 0, 'flick left from 110 goes to the front');
});

test('the haptic fires once as the card passes edge-on', () => {
  assert(crossedMid(80, 100));
  assert(crossedMid(100, 80));
  assert(!crossedMid(10, 80));
  assert(!crossedMid(100, 170));
});

const W = (i) => ({ id: `w${i}`, status: 'done', started_at: `2026-09-${String(10 + i).padStart(2, '0')}T12:00:00`, finished_at: `2026-09-${String(10 + i).padStart(2, '0')}T13:00:00`, exercises: [{ exercise_id: 'x', sets: [{ done: true, weight_kg: 100, reps: 10 }] }], prs: [] });

test('locked badges carry progress; the bar caps at the goal', () => {
  const a = awardsFor([W(1), W(2), W(3)], [], 3);
  const w10 = a.badges.find((b) => b.id === 'w10');
  eq(JSON.stringify(w10.progress), JSON.stringify({ cur: 3, goal: 10, unit: 'workouts' }));
  eq(a.badges.find((b) => b.id === 'first').progress.cur, 1);
  eq(a.badges.find((b) => b.id === 'full').progress, null, 'yes/no badges have no bar');
  eq(badgeProgress('w10', { workouts: 99 }).cur, 10);
  for (const id of Object.keys(METERS)) assert(BADGES.some((b) => b.id === id), `${id} is a real badge`);
});

test('back text: locked shows the bar, earned shows the date, the tier is named', () => {
  const locked = backInfo({ name: 'Ten Strikes', how: 'Finish 10 workouts', earned: null, progress: { cur: 3, goal: 10, unit: 'workouts' } }, { tierName: 'Cobalt' });
  eq(locked.bar.text, '3 of 10 workouts');
  assert(locked.sr.includes('Cobalt tier') && locked.sr.includes('3 of 10 workouts'));
  const got = backInfo({ name: 'Ten Strikes', how: 'Finish 10 workouts', earned: { at: '2026-09-20T12:00:00' }, progress: { cur: 10, goal: 10, unit: 'workouts' } }, { tierName: 'Cobalt' });
  eq(got.bar, null);
  assert(got.lines.some((l) => l.startsWith('Earned') && l.includes('2026') && l.includes('10 workouts')));
  const yes = backInfo({ name: 'Comeback', how: 'Train again after 3 weeks or more away', earned: null, progress: null }, {});
  assert(yes.lines.includes('Not earned yet'));
});

test('weights on the back follow the user units', () => {
  const p = { name: 'Ten Tons', how: 'x', earned: null, progress: { cur: 5000, goal: 10000, unit: 'kg lifted' } };
  eq(backInfo(p, { units: 'metric' }).bar.text, '5,000 of 10,000 kg lifted');
  assert(backInfo(p, { units: 'imperial' }).bar.text.includes('lb lifted'));
});

test('volume badges speak one unit on both sides, and the bar uses the displayed numbers', () => {
  const v = (id, goal, unit, cur) => ({ id, name: 'Hundred Tons', how: 'Lift 100 tonnes in total', earned: null, progress: { cur, goal, unit } });
  const b = v('vol2', 100000, 'kg lifted', 5443.108); // 12,000 lb
  eq(howText(b, 'imperial'), 'Lift 220,000 lb in total');
  eq(howText(b, 'metric'), 'Lift 100 tonnes in total');
  const imp = backInfo(b, { units: 'imperial' });
  eq(imp.bar.text, '12,000 of 220,000 lb lifted');
  eq(imp.bar.goal, 220000);
  eq(imp.bar.cur, 12000);
  assert(!imp.sr.includes('220,462') && imp.lines[0] === 'Lift 220,000 lb in total');
  const met = backInfo(b, { units: 'metric' });
  eq(met.bar.text, '5,443 of 100,000 kg lifted');
  eq(met.bar.goal, 100000);
  const big = v('big', 10000, 'kg in one workout', 0);
  eq(howText(big, 'imperial'), 'Lift 22,000 lb in one workout');
  eq(howText(big, 'metric'), 'Lift 10 tonnes in one workout');
  eq(howText(v('vol3', 1000000, 'kg lifted', 0), 'imperial'), 'Lift 2,200,000 lb in total');
});

test('turning a card swaps the button label so VoiceOver re-reads the side that is up', () => {
  const attrs = () => { const m = {}; return { m, setAttribute: (k, x) => { m[k] = x; }, getAttribute: (k) => (k in m ? m[k] : null) }; };
  const el = (extra = {}) => ({ ...attrs(), ...extra });
  const front = el(); const back = el({ dataset: { sr: 'Ten Tons. Cobalt tier.' } });
  const cls = new Set();
  const btn = el({
    classList: { contains: (c) => cls.has(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), add: (c) => cls.add(c), remove: (c) => cls.delete(c) },
    querySelector: (q) => (q === '.aw-front' ? front : q === '.aw-back' ? back : el({ style: { setProperty() {} } })),
    addEventListener: (t, fn) => { (btn.fire[t] ||= []).push(fn); },
    getBoundingClientRect: () => ({ width: 100 }), fire: {},
  });
  btn.setAttribute('aria-label', 'Ten Tons, locked. Turns over to show its story.');
  const spoken = [];
  const g = globalThis;
  const keep = { win: g.window, rm: g.matchMedia, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
  g.matchMedia = () => ({ matches: true }); g.window = g;
  g.requestAnimationFrame = () => 0; g.cancelAnimationFrame = () => {};
  try {
    wireFlips({ querySelectorAll: () => [btn] }, (t) => spoken.push(t));
    for (const fn of btn.fire.click) fn();
    eq(btn.getAttribute('aria-label'), 'Ten Tons. Cobalt tier.');
    eq(spoken.length, 1);
    for (const fn of btn.fire.click) fn();
    eq(btn.getAttribute('aria-label'), 'Ten Tons, locked. Turns over to show its story.');
  } finally { g.window = keep.win; g.matchMedia = keep.rm; g.requestAnimationFrame = keep.raf; g.cancelAnimationFrame = keep.caf; }
});

test('the screen wires the flip, with button role, hidden back and Reduce Motion crossfade', () => {
  const s = read('js/screens/awards.js');
  assert(s.includes('class="aw-flip"') && s.includes('type="button"') && s.includes('aria-pressed') && s.includes('wireFlips'));
  assert(s.includes('aria-live="polite"'));
  const js = read('js/ui/badge-flip.js');
  assert(js.includes('haptics.light()') && js.includes('reducedMotion()') && js.includes('setPointerCapture'));
  const css = read('css/player.css');
  assert(css.includes('perspective') && css.includes('backface-visibility') && css.includes('touch-action: pan-y'));
  assert(/prefers-reduced-motion: reduce\) \{[^}]*bdg-shine[\s\S]*?\.aw-back \{ transform: none; opacity: 0/.test(css), 'crossfade under Reduce Motion');
  assert(read('sw.js').includes('./js/ui/badge-flip.js'));
});

test('0.16.52 is in the changelog and the version has not gone backwards', () => {
  assert(read('CHANGELOG.md').includes('## 0.16.52'));
  assert(VERSION.split('.').map(Number)[2] >= 52);
});
