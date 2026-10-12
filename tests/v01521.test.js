// v0.15.21: the card order on Food, Body and Progress, the weight hero on Body, and the old links.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { redirectRoute, tabOf, TAB_ORDER, backTarget, backLabel, routeDepth, noteNavigation } from '../js/nav.js';
import { recoverySubtitle } from '../js/workouts/recovery.js';
import { TOUR_STEPS } from '../js/tour/steps.js';

const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const at = (s, needle) => { const i = s.indexOf(needle); assert(i >= 0, `missing ${needle}`); return i; };
const inOrder = (s, needles, what) => {
  const pos = needles.map((n) => at(s, n));
  for (let i = 1; i < pos.length; i++) assert(pos[i] > pos[i - 1], `${what}: ${needles[i]} should come after ${needles[i - 1]}`);
};

test('Food: day nav, Log food, totals, why, meals, My foods, disclaimer', () => {
  const f = src('js/screens/food.js');
  const body = f.slice(at(f, 'el.innerHTML = `'), at(f, 'export function openLogFood'));
  inOrder(body, ['<h1>Food</h1>', 'data-prev', 'data-log-food>', 'data-food-totals', 'data-food-why', 'class="food-meal"', 'data-my-foods', 'class="disclaimer"'], 'Food');
  assert(f.includes('Snap-a-meal') && !body.includes('data-snap'), 'Snap-a-meal is a comment only');
});

test('Body: weight hero, goal path, programs, composition, measures, photos, recovery link; weigh-ins last', () => {
  const b = src('js/screens/body.js');
  const body = b.slice(at(b, 'el.innerHTML = `'));
  inOrder(body, ['${weightHeroHtml()}', '${goalPathCard()}', '${programsCard()}', '${compositionCard()}', 'bodyProfileHtml(', 'data-photos-slot', 'data-recovery-link', '${weighInsHtml()}'], 'Body');
  assert(!body.includes('href="#/trends"') && !body.includes('bodyMap('), 'no Trends card, no map on Body');
  assert(src('js/photos/cards.js').includes('class="card stack nav-card pp-promo" href="#/photos" data-photos-card'), 'photos card is accent-colored with photos too');
});

test('Weight hero lives on Body and is not repeated on Progress', () => {
  const w = src('js/screens/weight.js');
  assert(w.includes('export function weightHeroHtml') && !w.includes('export function renderWeight'));
  for (const f of ['score', 'weekly', 'trends']) assert(!src(`js/screens/${f}.js`).includes('weightHeroHtml'), f);
  assert(!src('js/app.js').includes('renderWeight'), 'no weight route');
});

test('Progress: Score, Week, Trends, then Awards, History, Doctor summary and Coach rows', () => {
  const p = src('js/screens/progress.js');
  inOrder(p, ["['score', 'Score']", "['weekly', 'Week']", "['trends', 'Trends']"], 'segments');
  assert(!p.includes("['weight'"), 'no Weight segment');
  inOrder(p, ["'#/awards'", "'#/history'", "'#/report'", "'#/coach'"], 'rows');
  for (const f of ['score', 'weekly', 'trends']) assert(src(`js/screens/${f}.js`).includes('${progressRowsHtml()}'), f);
});

test('old links: #/weight opens Body, the Progress tab is #/score, the rest still land somewhere real', () => {
  eq(JSON.stringify(redirectRoute(['weight'])), JSON.stringify(['body', 'weight']));
  eq(TAB_ORDER[4], 'score');
  assert(src('index.html').includes('<a href="#/score">') && !src('index.html').includes('href="#/weight"'));
  for (const r of ['photos', 'trends', 'score', 'weekly', 'awards', 'report', 'progress']) {
    assert(src('js/app.js').includes(`${r}: (`), `${r} is routed`);
    eq(redirectRoute([r]), null, r);
  }
  eq(tabOf('trends'), 'score');
  eq(tabOf('photos'), 'body');
  eq(routeDepth(['score']), 0);
  eq(backTarget(['awards']), '#/score');
});

test('tour: the Progress and Settings steps use the Progress tab route', () => {
  for (const id of ['progress', 'settings']) eq(TOUR_STEPS.find((s) => s.id === id).route, 'score', id);
});

test('weight links open Body at the weight hero (#/body/weight) and Log weight buttons open the sheet (#/body/log)', () => {
  const app = src('js/app.js');
  assert(/link === 'weight' \|\| link === 'log'/.test(app) && app.includes('window.scrollTo(0, 0)') && app.includes('openLogWeight'), 'app.js skips the saved Body scroll and opens the sheet');
  eq(routeDepth(['body', 'weight']), 0);
  eq(tabOf('body'), 'body');
  assert(src('js/screens/today.js').includes('href="#/body/weight">See chart'), 'See chart');
  assert((src('js/health/insights.js').match(/href: '#\/body\/weight'/g) || []).length === 2, 'insight links');
  for (const f of ['js/withings/body.js', 'js/screens/report.js', 'js/screens/trends.js', 'js/screens/weekly.js']) {
    assert(src(f).includes("href: '#/body/log'") && !src(f).includes("href: '#/body', label: 'Log"), f);
  }
});

test('Body: the Recovery row opens #/train/recovery and says how long since the last workout', () => {
  const day = 86400000, now = Date.parse('2026-10-12T12:00:00Z');
  const s = (days) => recoverySubtitle(18, { finished_at: new Date(now - days * day).toISOString() }, now).replace(/<\/span><span class="nw">/g, ' · ').replace(/<[^>]+>/g, '');
  eq(s(2), '18 fresh · last workout 2 days ago');
  eq(s(1), '18 fresh · last workout yesterday');
  eq(s(0), '18 fresh · last workout today');
  eq(recoverySubtitle(18, undefined, now), 'No workouts yet');
  const at = (last, nowD) => recoverySubtitle(18, { finished_at: new Date(last).toISOString() }, new Date(nowD).getTime()).replace(/<\/span><span class="nw">/g, ' · ').replace(/<[^>]+>/g, '');
  eq(at(new Date(2026, 9, 11, 18, 30), new Date(2026, 9, 12, 8, 0)), '18 fresh · last workout yesterday'); // Sun 6:30 PM → Mon 8 AM
  eq(at(new Date(2026, 9, 10, 21, 0), new Date(2026, 9, 12, 8, 0)), '18 fresh · last workout 2 days ago'); // Sat 9 PM → Mon 8 AM
  eq(at(new Date(2026, 9, 11, 23, 30), new Date(2026, 9, 12, 0, 15)), '18 fresh · last workout yesterday');
  assert(src('js/screens/body.js').includes('href="#/train/recovery"'));
  const app = src('js/app.js');
  assert(app.includes("link === 'recovery'") && app.includes('[data-recovery-card]') && app.includes('scrollIntoView'), 'Train scrolls to the card');
  eq(routeDepth(['train', 'recovery']), 0);
  eq(backTarget(['train', 'recovery']), null);
});

test('Progress rows: Back returns to the part you came from; Coach keeps the Progress tab only when opened from Progress', () => {
  for (const from of ['score', 'weekly', 'trends']) {
    for (const row of ['history', 'awards']) {
      noteNavigation([from], [row]);
      eq(backTarget([row]), `#/${from}`, `${row} from ${from}`);
      eq(backLabel([row]), 'Progress');
      eq(tabOf(row), 'score');
    }
    noteNavigation([from], ['coach']);
    eq(tabOf('coach'), 'score', `Coach from ${from} lights Progress`);
    eq(backTarget(['coach']), `#/${from}`);
    eq(backLabel(['coach']), 'Progress');
  }
  noteNavigation(['weekly'], ['history']);
  noteNavigation(['history'], ['coach']);
  eq(backTarget(['coach']), '#/weekly', 'row to row keeps the part');
  noteNavigation(['today'], ['coach']);
  eq(tabOf('coach'), 'today');
  eq(backTarget(['coach']), '#/today');
  eq(backLabel(['coach']), 'Today');
  noteNavigation(['today'], ['history']);
  eq(backTarget(['history']), '#/score', 'History from elsewhere still goes to Score');
});

test('Body weigh-ins: the latest 5, then "Show all N weigh-ins", in a column of at most 560px', () => {
  const w = src('js/screens/weight.js');
  assert(w.includes('HISTORY_LIMIT = 5') && w.includes('Show all ${entries.length} weigh-ins') && w.includes('data-del='), 'limit, button, delete buttons');
  assert(/\[data-weigh-ins\] \{ max-width: 560px/.test(src('css/app.css')));
});

test('320px text: short Progress row subtitles and a one-word Copy button', () => {
  const p = src('js/screens/progress.js');
  for (const t of ['Badges and missions', 'Share with your doctor', 'From your own data']) assert(p.includes(`'${t}'`), t);
  assert(src('js/screens/food.js').includes('aria-label="Copy yesterday’s ${g.label.toLowerCase()}">Yesterday</button>'));
});
