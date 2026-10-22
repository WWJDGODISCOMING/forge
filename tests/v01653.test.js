// v0.16.53: drag to scrub on every chart. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { scrubIntent, isFlick, stepIndex, spokenPoint } from '../js/ui/scrubmath.js';
import { weightChartSVG, sparklineSVG } from '../js/weight/chart.js';
import { lineChartSVG, scrubBar } from '../js/ui/linechart.js';
import { VERSION } from '../js/version.js';

const same = (a, b, m) => eq(JSON.stringify(a), JSON.stringify(b), m);
const read =(p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const scrubData = (svg) => JSON.parse(svg.match(/data-scrub="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

const series = [];
for (let i = 0; i < 40; i++) {
  const d = new Date(Date.UTC(2026, 8, 1 + i));
  const day = d.toISOString().slice(0, 10);
  series.push({ day, kg: 95 - i * 0.1, trend: 95.2 - i * 0.1 });
}

test('a finger scrubs on a horizontal move or a long press, and leaves vertical moves to the page', () => {
  eq(scrubIntent({ dx: 14, dy: 3, ms: 40 }), 'scrub');
  eq(scrubIntent({ dx: 3, dy: 16, ms: 40 }), 'scroll');
  eq(scrubIntent({ dx: 2, dy: 2, ms: 100 }), 'wait');
  eq(scrubIntent({ dx: 2, dy: 2, ms: 400 }), 'scrub', 'long press');
  eq(scrubIntent({ dx: 0, dy: 0, ms: 0, touch: false }), 'scrub', 'a mouse starts at once');
  eq(scrubIntent({ dx: 10, dy: 10, ms: 50 }), 'scroll', 'a diagonal is scroll, not scrub');
});

test('a quick long swipe pans; a slow drag scrubs', () => {
  assert(isFlick({ dx: -120, ms: 150 }));
  assert(!isFlick({ dx: -120, ms: 600 }));
  assert(!isFlick({ dx: 20, ms: 100 }));
});

test('prev/next step one reading and report running off an end', () => {
  same(stepIndex(null, -1, 5), { i: 4, edge: 0 }, 'first earlier tap lands on the latest');
  same(stepIndex(3, 1, 5), { i: 4, edge: 0 });
  same(stepIndex(4, 1, 5), { i: 4, edge: 1 });
  same(stepIndex(0, -1, 5), { i: 0, edge: -1 });
  same(stepIndex(null, 1, 0), { i: null, edge: 0 });
});

test('VoiceOver hears the day, value and trend', () => {
  eq(spokenPoint('Oct 15', '209.1 lb', 'Trend 208.4 lb'), 'Oct 15, 209.1 lb, Trend 208.4 lb');
  eq(spokenPoint('Oct 15', '41 reps', ''), 'Oct 15, 41 reps');
});

test('the weight chart carries a point per weigh-in with value and trend text, and the scrub layer', () => {
  const svg = weightChartSVG(series, { units: 'imperial', rangeDays: 30 });
  const pts = scrubData(svg);
  assert(pts.length >= 30 && pts.length <= 31);
  assert(/ lb$/.test(pts[0][3]) && /^Trend [\d.]+ lb$/.test(pts[0][4]), `${pts[0][3]} / ${pts[0][4]}`);
  assert(pts[0][0] < pts[1][0], 'x ascends');
  assert(svg.includes('class="scrub"') && svg.includes('scrub-pill'));
});

test('panning the weight chart shows an earlier window and drops the goal projection', () => {
  const now = weightChartSVG(series, { units: 'imperial', rangeDays: 14 });
  const back = weightChartSVG(series, { units: 'imperial', rangeDays: 14, endDay: series[20].day, projection: { day: '2026-12-01', reached: false }, goalKg: 80 });
  const a = scrubData(now);
  const b = scrubData(back);
  assert(b[b.length - 1][2] === series[20].day, 'window ends on the panned day');
  assert(a[a.length - 1][2] === series[39].day);
  assert(!back.includes('class="proj"'));
});

test('the sparkline scrubs when it knows the units, and stays plain without', () => {
  assert(!/data-scrub/.test(sparklineSVG(series)));
  const sp = sparklineSVG(series, 30, 120, 36, 'metric');
  const pts = scrubData(sp);
  assert(pts.length >= 30);
  assert(/ kg$/.test(pts[0][3]));
  assert(sp.includes('spark-scrub'));
});

test('metric charts show the 7-day average as the trend value', () => {
  const pts = [{ day: '2026-10-01', v: 150, t: '150.0 lb' }, { day: '2026-10-02', v: 152, t: '152.0 lb' }];
  const d = scrubData(lineChartSVG(pts, { unit: 'lb' }));
  assert(/^7-day avg 151\.0 lb$/.test(d[1][4]), d[1][4]);
});

test('the readout row has 44 px arrows with labels', () => {
  const html = scrubBar();
  assert(html.includes('data-scrub-prev') && html.includes('data-scrub-next'));
  assert(/aria-label="Earlier reading"/.test(html) && /aria-label="Later reading"/.test(html));
  assert(/\.icon-btn \{ width: 44px; height: 44px/.test(read('css/app.css')));
});

test('scrub code uses pointer events, honours Reduce Motion, and is wired into every chart', () => {
  const src = read('js/ui/scrub.js');
  assert(/pointerdown/.test(src) && /pointermove/.test(src) && !/touchstart/.test(src), 'pointer events');
  assert(/aria-valuetext/.test(src) && /role', 'slider'/.test(src), 'adjustable');
  assert(/prefers-reduced-motion: reduce\) \{ \.chart \.scrub/.test(read('css/app.css')), 'no fade under Reduce Motion');
  assert(/bindScrub/.test(read('js/screens/weight.js')) && /bindScrub/.test(read('js/screens/today.js')) && /bindScrub/.test(read('js/screens/history.js')) && /bindScrub/.test(read('js/screens/metric.js')));
  assert(read('sw.js').includes("'./js/ui/scrub.js'"), 'precached');
});

test('version bumped in step', () => {
  eq(VERSION, '0.16.53');
  assert(read('sw.js').includes("const VERSION = '0.16.53'"));
  assert(read('CHANGELOG.md').includes('## 0.16.53'));
});
