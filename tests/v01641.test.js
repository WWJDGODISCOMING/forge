// v0.16.41: weekly report titles, the share line, Today's live week count, the Why card and Ask Coach staying normal size. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { weekTitle, reportText } from '../js/health/weektext.js';
import { weekDays, mondayOf, shiftWeek } from '../js/health/weekly.js';
import { whyCardHtml } from '../js/ui/why-card.js';

const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// 2026-10-12 is a Monday; 2026-10-18 a Sunday.
const MON = '2026-10-12';
const LAST = shiftWeek(MON, -1); // 2026-10-05
const report = (monday, partial = false) => ({
  days: weekDays(monday), partial,
  score: { now: 70, delta: 2 }, training: { workouts: 3, planned: 4, prs: 0 }, weight: { change: null }, nutrition: null,
  suggestion: { text: 'Keep going.' },
});

test('weekTitle: Monday and Tuesday call the finished week "Last week"', () => {
  eq(mondayOf('2026-10-12'), MON);
  assert(weekTitle(report(LAST), '2026-10-12').startsWith('Last week · '), 'Monday');
  assert(weekTitle(report(LAST), '2026-10-13').startsWith('Last week · '), 'Tuesday');
});

test('weekTitle: a week still running reads "This week so far" (Sunday)', () => {
  assert(weekTitle(report(MON, true), '2026-10-18').startsWith('This week so far · '), 'Sunday');
});

test('weekTitle: older weeks are just "Week", and the Sunday/Monday edge flips Last week', () => {
  assert(weekTitle(report(shiftWeek(MON, -2)), '2026-10-12').startsWith('Week · '), 'two weeks back');
  assert(weekTitle(report(LAST), '2026-10-18').startsWith('Last week · '), 'Sunday: last week is still last week');
  assert(weekTitle(report(LAST), '2026-10-19').startsWith('Week · '), 'next Monday: it is now two weeks back');
  assert(weekTitle(report(LAST)).startsWith('Week · '), 'no today given');
});

test('reportText: leads with the title and adds this week so far only for a finished week', () => {
  const t = reportText(report(LAST), 'metric', { workouts: 1, planned: 4 }, '2026-10-12');
  const lines = t.split('\n');
  assert(lines[0].startsWith('Forge weekly report · Last week · '), lines[0]);
  assert(lines.includes('This week so far: 1/4 workouts'), 'live line');
  const live = reportText(report(MON, true), 'metric', { workouts: 1, planned: 4 }, '2026-10-18');
  assert(!live.includes('This week so far:'), 'a running week has no extra line');
  assert(live.split('\n')[0].includes('This week so far ·'), 'title says so');
  assert(!reportText(report(LAST), 'metric').includes('This week so far:'), 'no count passed, no line');
});

test('Today weekly card: titled by weekTitle with a live "This week x/y so far"', () => {
  const t = src('js/screens/today.js');
  assert(t.includes('weekTitle(r, todayKey())'), 'uses weekTitle');
  assert(/data-week-live>This week \$\{now\.workouts\}\/\$\{now\.planned\} so far/.test(t), 'live count text');
  assert(t.includes('wk === cur ? null'), 'no live count when the report already is this week');
});

test('weekly screen shares the live count only for last week', () => {
  assert(src('js/screens/weekly.js').includes('weekStart === shiftWeek(cur, -1)'), 'older weeks get no live line');
});

test('Why card: collapsed, aria-expanded and hidden agree, body never empty', () => {
  for (const [notes, stalled] of [[['One note'], []], [[], ['A', 'B']], [['n1', 'n2'], ['A', 'B', 'C']]]) {
    const h = whyCardHtml(notes, stalled);
    assert(h.includes('aria-expanded="false"'), 'collapsed');
    assert(/data-why-body hidden>/.test(h), 'body hidden');
    const body = h.slice(h.indexOf('data-why-body'));
    assert(/<p class="small">/.test(body), 'body has text');
    for (const n of notes) assert(body.includes(n), `body has ${n}`);
  }
  eq(whyCardHtml([], []), '');
  eq(whyCardHtml([], ['A']), '', 'one stalled lift alone shows nothing');
});

test('Why card: header is a count; the single note lives in the body only', () => {
  const h = whyCardHtml(['Skipping knee-heavy moves.'], []);
  const head = h.slice(0, h.indexOf('data-why-body'));
  assert(head.includes('1 note') && !head.includes('Skipping'), 'count only in header');
  assert(whyCardHtml(['a', 'b'], ['X', 'Y']).includes('2 notes · 2 stalled lifts'), 'both counts');
});

test('Why card: deload button only with 2 or more stalled lifts', () => {
  assert(!whyCardHtml(['n'], ['A']).includes('data-deload'), '1 stalled');
  assert(whyCardHtml(['n'], ['A', 'B']).includes('data-deload'), '2 stalled');
});

test('Why card: notes and lift names are escaped', () => {
  const h = whyCardHtml(['<img src=x onerror=1>'], ['<b>A</b>', 'B']);
  assert(!h.includes('<img') && !h.includes('<b>A'), 'no raw markup');
  assert(h.includes('&lt;img'), 'escaped');
});

test('Train: Why toggle fires a select haptic', () => {
  const t = src('js/screens/train.js');
  assert(/why\.onclick = \(\) => \{\s*tick\(\);/.test(t), 'tick() in the toggle');
});

test('Ask Coach: first on Today, same size as before (no big variant)', () => {
  const t = src('js/screens/today.js');
  assert(t.indexOf('data-o="1">${coachLine()}') > 0, 'slot 1 is Ask Coach');
  assert(!t.includes('coach-line-big') && !src('css/food.css').includes('coach-line-big'), 'no enlarged variant');
});
