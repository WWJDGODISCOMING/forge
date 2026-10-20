// v0.15.7 fit-and-finish part 2: stale readings, photos card, text scale, Today density, player leftovers.
// The real layout checks live in tests/layout.test.js (headless Chromium). Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { staleCaption, daysBetween, OLD_READING_DAYS } from '../js/withings/body.js';
import { daysToCheckin, checkinText } from '../js/photos/cards.js';
import { textScaleFor, MAX_TEXT_SCALE } from '../js/ui/textsize.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('stale body readings: a calm, one-line caption', () => {
  eq(daysBetween('2026-10-08', '2026-10-10'), 2);
  eq(staleCaption('2026-10-10', '2026-10-10', 'en-US'), 'Today');
  eq(staleCaption('2026-10-09', '2026-10-10', 'en-US'), 'Yesterday');
  eq(staleCaption('2026-10-08', '2026-10-10', 'en-US'), '2 days ago');
  eq(staleCaption('2026-09-23', '2026-10-10', 'en-US'), 'Sep 23');
  assert(/Oct 28/.test(staleCaption('2025-10-28', '2026-10-10', 'en-US')) && /25/.test(staleCaption('2025-10-28', '2026-10-10', 'en-US')), 'a past year shows a two-digit year');
  eq(OLD_READING_DAYS, 90);
});

test('Body composition: no warning colour on stale tiles, older readings tucked away, Standing HR explained', () => {
  assert(/\.bc-tile\.stale small \{ color: var\(--text-3\)/.test(src('css/app.css')));
  assert(!/\.bc-tile\.stale small \{ color: var\(--warn\)/.test(src('css/app.css')));
  const b = src('js/screens/body.js');
  assert(b.includes('data-bc-older') && b.includes('Show older (') && b.includes('data-bc-hr') && b.includes('Standing HR is'));
});

test('Progress photos card: accent disc and a clear action; check-in countdown', () => {
  const c = src('js/photos/cards.js');
  assert(c.includes('pp-disc') && c.includes('Take photos') && c.includes('See your change, not just the scale') && c.includes('Last set '));
  const css = src('css/photos.css');
  assert(/\.pp-disc \{[^}]*background: var\(--accent\)[^}]*color: var\(--accent-ink\)/.test(css));
  eq(daysToCheckin('2026-10-10', 0), 1, 'Saturday to Sunday');
  eq(daysToCheckin('2026-10-11', 0), 0);
  eq(daysToCheckin('2026-10-10', null), null);
  eq(checkinText(3), 'Next check-in in 3 days');
  eq(checkinText(1), 'Next check-in tomorrow');
  eq(checkinText(null), '');
});

test('text size: scale follows iOS Text Size between 1 and the cap', () => {
  eq(textScaleFor(17), 1);
  eq(textScaleFor(16), 1, 'never below 1');
  eq(textScaleFor(NaN), 1);
  eq(textScaleFor(21), 1.24);
  eq(textScaleFor(40), MAX_TEXT_SCALE, 'capped');
});

test('every font size and line height up to 28px scales with --ts', () => {
  for (const f of ['app', 'food', 'health', 'missions', 'nav', 'photos', 'player', 'report']) {
    for (const m of src(`css/${f}.css`).matchAll(/(?:font-size|line-height)\s*:\s*(\d+(?:\.\d+)?)px/g)) {
      assert(Number(m[1]) > 28, `${f}.css has a fixed ${m[0]}`);
    }
  }
  assert(src('css/tokens.css').includes('--ts: 1'));
});

test('button pairs wrap instead of clipping', () => {
  const css = src('css/app.css');
  assert(css.includes('.row:has(> .btn.grow) { flex-wrap: wrap; }') && css.includes('min-width: max-content'));
});

test('nav bar: stronger glass, learn-more disclosure, scroll padding', () => {
  const t = src('css/tokens.css');
  assert(t.includes('--glass: rgba(4, 11, 14, .62)') && t.includes('--glass: rgba(238, 241, 245, .88)'));
  assert(src('js/health/cards.js').includes('<details class="learn-more"><summary>What is this?'));
  assert(src('js/ui/navbar.js').includes("large.querySelector('h1')"));
});

test('Today: header links, Start beside the title, one insight, 12 px gaps', () => {
  const t = src('js/screens/today.js');
  for (const label of ['See plan', 'See chart']) assert(t.includes("card-link") && t.includes(label + "${icon"), label);
  assert(t.includes('class="stack today-stack"') && t.includes('.slice(0, 2)'));
  assert(/\.today-stack \{ gap: var\(--s-3\)/.test(src('css/app.css')));
  assert(t.includes('data-food-log') && t.includes('data-start') && t.includes('data-log'), 'the daily buttons are still there');
});

test('player leftovers: "Undo set" on one line; the short-phone How-To strip names the muscle', () => {
  const j = src('js/screens/player.js');
  assert(j.includes('<button data-undo>Undo set</button>') && j.includes('pl-demo-cap'));
  assert(/max-height: 600px\) \{[\s\S]*\.pl-demo-cap \{ display: block/.test(src('css/player.css')));
});

test('Standing HR note: under the grid when the HR tile is fresh, inside "Show older" when it is tucked away', () => {
  const b = src('js/screens/body.js');
  assert(b.includes("${hrOld ? hrNote : ''}</details>"), 'older HR: note inside the details');
  assert(b.includes("${hrFresh ? hrNote : ''}"), 'fresh HR: note under the grid');
  assert(!b.includes('hasHr'), 'no note without a visible tile');
});

test('Goal path chart: "Goal 181 lb" sits at the left end of the goal line, away from the projection', async () => {
  const { goalPathSvg } = await import('../js/health/cards.js');
  const series = [];
  for (let i = 0; i < 28; i++) {
    const d = new Date(Date.UTC(2026, 8, 13 + i)).toISOString().slice(0, 10);
    series.push({ day: d, trend: 84 - i * 0.05 });
  }
  for (const goalKg of [82, 86]) {
    const path = { status: 'ok', etaDay: '2026-12-20', earlyDay: '2026-12-01', lateDay: '2027-01-20' };
    const svg = goalPathSvg(path, series, '2026-10-10', goalKg, 'imperial');
    assert(/<text x="44" [^>]*text-anchor="start">Goal \d+ lb<\/text>/.test(svg), `label at left for goal ${goalKg}`);
    assert(!/>goal \d/.test(svg));
  }
});
