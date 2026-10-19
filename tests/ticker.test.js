import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';

let reduced = false;
const stub = () => { globalThis.window = { ...(globalThis.window || {}), matchMedia: () => ({ matches: reduced }) }; globalThis.requestAnimationFrame = () => 0; };
stub();
globalThis.requestAnimationFrame = () => 0;
const { tickTo, settleTicks, resetTicks, countUp } = await import('../js/ui/motion.js');

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const el = (text) => ({ textContent: text, children: [], isConnected: true });

test('tickTo: reduced motion swaps instantly and keeps grouping', () => {
  reduced = true; stub();
  const e = el('1,200');
  assert(tickTo(e, 8532, { from: 1200 }) === true);
  assert(e.textContent === '8,532', e.textContent);
  const w = el('48.0');
  tickTo(w, 48.5);
  assert(w.textContent === '48.5', w.textContent);
});

test('tickTo: skips when the value is unchanged', () => {
  reduced = true; stub();
  const e = el('8,532');
  assert(tickTo(e, 8532) === false);
  assert(e.textContent === '8,532');
});

test('tickTo: starts from the shown number in the shown format', () => {
  reduced = false; stub();
  const e = el('48.0 lb');
  assert(tickTo(e, 48.5, { from: 48.0 }) === true);
  assert(e.textContent === '48.0 lb', e.textContent);
});

test('settleTicks: first sight records, a real change rolls, same text is left alone', () => {
  reduced = true; stub();
  resetTicks();
  const e = { dataset: { tick: 'k' }, textContent: '2,000', children: [] };
  const root = { querySelectorAll: (s) => (s === '[data-tick]' ? [e] : []) };
  settleTicks(root);
  assert(e.textContent === '2,000');
  e.textContent = '2,450';
  settleTicks(root);
  assert(e.textContent === '2,450');
  settleTicks(root);
  assert(e.textContent === '2,450');
});

test('settleTicks: two passes over the same root after one change end on the new value', () => {
  reduced = false; stub();
  resetTicks();
  const e = { dataset: { tick: 'kcal' }, textContent: '1,490', children: [], isConnected: true };
  const root = { querySelectorAll: (s) => (s === '[data-tick]' ? [e] : []) };
  settleTicks(root);
  e.textContent = '1,940';
  settleTicks(root); // starts the roll, which writes the old number back at once
  assert(e.textContent === '1,490', e.textContent);
  settleTicks(root); // second pass in the same render must not read that as a change
  const again = { dataset: { tick: 'kcal' }, textContent: '1,940', children: [], isConnected: true };
  settleTicks({ querySelectorAll: (s) => (s === '[data-tick]' ? [again] : []) });
  assert(again.textContent === '1,940', again.textContent);
  reduced = true; stub();
  const x = { dataset: { tick: 'k2' }, textContent: '1,490', children: [], isConnected: true };
  const r2 = { querySelectorAll: (s) => (s === '[data-tick]' ? [x] : []) };
  resetTicks(); settleTicks(r2);
  x.textContent = '1,940'; settleTicks(r2); settleTicks(r2);
  assert(x.textContent === '1,940', x.textContent);
});

test('settleTicks: count-up, settle, then a redraw with the same value does not roll', () => {
  reduced = false; stub();
  resetTicks();
  const mk = () => ({ dataset: { tick: 'w' }, textContent: '190.7', children: [], isConnected: true });
  const a = mk();
  countUp(a, 190.7, { format: (v) => v.toFixed(1), dur: 800 }); // animateCounters wrote 0.0
  assert(a.textContent === '0.0');
  settleTicks({ querySelectorAll: (s) => (s === '[data-tick]' ? [a] : []) });
  const b = mk(); // a later redraw, same value
  settleTicks({ querySelectorAll: (s) => (s === '[data-tick]' ? [b] : []) });
  assert(b.textContent === '190.7', b.textContent);
});

test('ticker: every wired spot carries data-tick and the screens call settleTicks', () => {
  const food = src('js/screens/food.js');
  assert(food.includes('data-tick="meal-') && food.includes('settleTicks(el)') && food.includes('data-fill="meter-'));
  assert(src('js/screens/today.js').includes('data-tick="today-kcal"'));
  assert(src('js/screens/today.js').includes('data-tick="today-weight"'));
  assert(src('js/screens/weight.js').includes('data-tick="body-latest"'));
  assert(src('js/ui/rings.js').includes('data-tick="rings-days"'));
  assert(src('js/app.js').includes('settleTicks(main)'));
  assert(src('css/motion.css').includes('[data-tick] { font-variant-numeric: tabular-nums; }'));
});

test('checkmark: shared draw is used by toast, mission, food add and set done', () => {
  assert(src('js/ui.js').includes("name === 'check' ? checkSvg"));
  assert(src('js/missions/ui.js').includes('checkSvg('));
  assert(src('js/screens/player.js').includes('checkSvg(') && src('js/screens/player.js').includes('haptics.success()'));
  assert(src('js/screens/food.js').includes("icon: 'check'"));
  assert(src('css/motion.css').includes('.ck-draw path') && src('css/motion.css').includes('prefers-reduced-motion: no-preference'));
});
