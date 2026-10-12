// v0.15.6 fit-and-finish: the Food rules no longer leak into the design system, plus the insight wording.
// Layout can't be measured without a browser, so these pin the CSS and markup rules. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { fmtChange } from '../js/health/insights.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const rules = (css) => [...css.matchAll(/(^|\})\s*([^{}@]+)\{/g)].flatMap((m) => m[2].split(',').map((s) => s.trim()));

test('food.css does not redefine global .chips, .chip-btn or .stepper', () => {
  for (const sel of rules(src('css/food.css'))) {
    assert(!/^\.(chips|stepper)(\s|$|\.|:)/.test(sel), `food.css leaks ${sel}`);
    assert(!/^\.chip-btn(\s|$|\.|:)/.test(sel), `food.css leaks ${sel}`);
  }
});

test('Food markup uses its scoped classes; the player keeps .stepper', () => {
  const f = src('js/screens/food.js');
  assert(!f.includes('class="stepper"') && !/class="chips"/.test(f), 'food.js uses .serv-stepper / .meal-chips');
  assert(f.includes('serv-stepper') && f.includes('meal-chips'));
  assert(src('css/player.css').includes('.stepper { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px'));
});

test('one .chip-btn definition: pill radius in app.css only', () => {
  assert(/\.chip-btn \{[^}]*--r-pill/.test(src('css/app.css')));
});

test('chips flow at natural width; wrapped segs and tap targets are 44px', () => {
  const css = src('css/app.css');
  assert(/\.chip \{[^}]*flex: 0 0 auto/.test(css) && css.includes('width: max-content'), 'chip sizes to its text');
  assert(css.includes('.seg.wrap label { flex: 1 0 auto; }'));
  assert(!/\.seg span \{[^}]*min-height: 3\d/.test(css) && !/\.seg\.small span \{[^}]*min-height: 3\d/.test(css), 'segs at least 44px');
  assert(/\.pl-rir button \{[^}]*height: 44px/.test(src('css/player.css')));
  assert(/\.rest-ctl \{[^}]*1fr 1\.4fr 1fr/.test(src('css/player.css')));
});

test('tour: keyboard focus keeps one offset ring; no focusVisible option', () => {
  const css = src('css/app.css');
  assert(!src('js/tour/tour.js').includes('focusVisible'));
  assert(!/\[data-next\]:focus-visible \{ outline: none/.test(css));
  assert(/\[data-next\]:focus-visible \{ outline: 2px solid var\(--accent-text\); outline-offset: 3px/.test(css));
});

test('tap targets: RIR row, Progress switcher, timer presets in one equal row', () => {
  const p = src('css/player.css');
  assert(/\.pl-rir \{[^}]*repeat\(6, 1fr\)/.test(p) && !/\.pl-rir \{[^}]*auto repeat/.test(p) && /\.pl-rir span \{ grid-column: 1 \/ -1/.test(p));
  assert(/\.progress-seg a \{[^}]*min-height: 44px/.test(p));
  const t = src('js/screens/timer.js');
  assert(t.includes('class="seg small"') && !t.includes('seg wrap') && t.includes('short: \'Boxing\'') && t.includes('aria-label="${esc(p.name)}"'));
});

test('Body: the recovery row opens Train and shows the fresh-muscle count', () => {
  const b = src('js/screens/body.js');
  assert(/data-recovery-link/.test(b) && b.includes('href="#/train/recovery"') && b.includes('recoverySubtitle('));
  const pc = src('css/player.css');
  assert(pc.includes('grid-template-columns: repeat(2, minmax(0, 1fr))') && /\.bh-word \{ font-size: clamp\(28px, 10\.5vw, 40px\)/.test(pc), 'equal tiles; the word scales to fit');
  assert(/\.bh-tap::after \{[^}]*--text-3/.test(src('css/app.css')) && src('css/app.css').includes('.bh-tap:active'));
});

test('copy chips: identifiers break only after an underscore', () => {
  const a = src('js/screens/apple.js');
  assert(a.includes("esc(label).replace(/_/g, '_<wbr>')"), 'escape first, then <wbr>');
  const css = src('css/health.css');
  assert(/\.copy-chip code \{[^}]*overflow-wrap: normal/.test(css) && !/\.copy-chip code \{[^}]*anywhere/.test(css));
  assert(/\.copy-chip span \{[^}]*flex: 0 0 auto/.test(css));
});

test('insight wording: grammar, units and the real change over the window', () => {
  // slopePerWeek is the change in the daily value per week: 630 steps/day more each week = about +2,520/day after 4 weeks.
  eq(fmtChange('steps', 630, 28, 'metric'), '+2,520 steps/day');
  eq(fmtChange('sleep_min', -15, 28, 'metric'), '−1 h/night');
  eq(fmtChange('sleep_min', -11.85, 28, 'metric'), '−47 min/night');
  eq(fmtChange('sleep_min', -154 / 13, 91, 'metric'), '−2 h 34 min/night');
  eq(fmtChange('hrv_sdnn_ms', 1.25, 28, 'metric'), '+5.0 ms');
  eq(fmtChange('vo2max', 0.1, 28, 'metric'), '+0.4 ml/kg/min');
  const w = fmtChange('weight_kg', -0.28, 28, 'imperial');
  assert(/^−\d\.\d lb$/.test(w), w);
  assert(Math.abs(parseFloat(w.slice(1)) - 1.12 * 2.20462) / (1.12 * 2.20462) < 0.05, `weight change within 5%: ${w}`);
  const ins = src('js/health/insights.js');
  assert(ins.includes("'are' : 'is'"), 'plural labels say "are"');
});

test('insight wording: one case per kind, never a zero change', () => {
  eq(fmtChange('fat_ratio_pct', -0.155, 28, 'metric'), '−0.6% body fat');
  eq(fmtChange('visceral_fat', -0.385, 28, 'metric'), '−1.5 on the visceral fat index');
  eq(fmtChange('rhr_bpm', -1.6, 28, 'metric'), '−6 bpm');
  eq(fmtChange('heart_pulse_bpm', 1.6, 28, 'metric'), '+6 bpm');
  eq(fmtChange('muscle_mass_kg', 0.25, 28, 'metric'), '+1.0 kg');
  eq(fmtChange('exercise_min', 2.5, 28, 'metric'), '+10 min/day');
  eq(fmtChange('weight_kg', 0.001, 28, 'imperial'), null);
  eq(fmtChange('rhr_bpm', 0.05, 28, 'metric'), null);
  eq(fmtChange('hrv_sdnn_ms', 0.01, 28, 'metric'), null);
  eq(fmtChange('steps', 0.05, 28, 'metric'), null);
  eq(fmtChange('vo2max', 0.001, 28, 'metric'), null);
  assert(src('js/health/insights.js').includes('About the same as'), 'a zero change reads "about the same"');
});

test('tour: focus goes to the Next pill only after a key press, otherwise to the card', () => {
  const t = src('js/tour/tour.js');
  assert(t.includes('class="tour-card" tabindex="-1"'));
  assert(t.includes("lastInput = 'key'") && t.includes("lastInput = 'pointer'") && t.includes("addEventListener('pointerdown', onPointer, true)"));
  assert(t.includes("(lastInput === 'key' ? q('[data-next]') : card).focus("));
  assert(/\.tour-card:focus \{ outline: none/.test(src('css/app.css')));
});

test('player: Done set is pinned in a dock; RIR and timer tighten at 320px', () => {
  const p = src('css/player.css');
  assert(/\.pl-dock \{[^}]*position: sticky; bottom: 0[^}]*safe-bottom/.test(p));
  const j = src('js/screens/player.js');
  assert(j.indexOf('class="pl-dock"') < j.indexOf('data-done-label') && j.indexOf('data-done-label') < j.indexOf('class="pl-nav"'));
  assert(/max-width: 340px\) \{ \.pl-rir \{ gap: 2px/.test(p) && /max-height: 700px\) \{\s*\.pl-demo\.has-fig/.test(p));
  assert(/max-width: 340px\) \{ \.timer-screen \.seg\.small span \{ font-size: calc\(12px/.test(src('css/app.css')));
});

test('rings legend: short titles, sets as three rows without separators', () => {
  const r = src('js/workouts/rings.js');
  assert(r.includes("label: 'Calories'") && r.includes("label: 'Protein'") && r.includes('lines: ['));
});

test('player: short screens compact the set view; Next line stays on one row; hint balances', () => {
  const p = src('css/player.css');
  const short = p.slice(p.indexOf('@media (max-height: 700px)'));
  assert(/\.pl-demo\.has-fig \{ height: 72px/.test(short) && /\.pl-hero-n b \{ font-size: 56px/.test(short));
  assert(/\.pl-next-name \{[^}]*min-width: 0[^}]*text-overflow: ellipsis/.test(p) && /\.pl-next-meta \{ flex: none/.test(p));
  assert(/\.pl-last \{[^}]*text-wrap: balance/.test(p));
  assert(src('js/screens/player.js').includes('class="pl-next-name"'));
  assert(src('js/workouts/progression.js').includes('times. Do' + String.fromCharCode(160) + '$'));
});

test('Body tiles: second value is --text, every value has one fixed 56px box', () => {
  const p = src('css/player.css');
  assert(/\.body-hero b \{[^}]*font: 900 40px\/1 var\(--num\)[^}]*height: 56px; display: flex; align-items: center/.test(p));
  assert(!/min-height: 48px/.test(p.slice(p.indexOf('/* Body */'))));
  assert(/\.body-hero \.bh-tile \+ \.bh-tile b \{ color: var\(--text\)/.test(p));
  assert(!/\.body-hero div/.test(p));
});

test('player: very short screens (320x568) hide the picture and sit the steppers side by side', () => {
  const p = src('css/player.css');
  const m = p.slice(p.indexOf('@media (max-height: 600px)'));
  assert(/\.pl-demo \.fig-wrap, \.pl-demo \.pl-muscles \{ display: none/.test(m));
  assert(/\.pl-steppers \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(m));
  assert(/\.pl-demo\.has-fig, \.pl-demo \{ height: 44px/.test(m));
});

test('Programs badge uses accent tokens only', () => {
  assert(/\.pg-rec \{[^}]*var\(--accent-tint\)/.test(src('css/missions.css')) && !/\.pg-rec \{[^}]*--ember/.test(src('css/missions.css')));
});
