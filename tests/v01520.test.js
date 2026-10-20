// v0.15.20: the card order on Today and Train, the single alert slot, Weekly report XOR Score, and where the moved cards went.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { TODAY_ORDER, TRAIN_ORDER, ALERT_PRIORITY, pickAlert, topFlag, reportOrScore } from '../js/home-order.js';
import { TOUR_STEPS } from '../js/tour/steps.js';

const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const at = (s, needle) => { const i = s.indexOf(needle); assert(i >= 0, `missing ${needle}`); return i; };
const inOrder = (s, needles, what) => {
  const pos = needles.map((n) => at(s, n));
  for (let i = 1; i < pos.length; i++) assert(pos[i] > pos[i - 1], `${what}: ${needles[i]} should come after ${needles[i - 1]}`);
};

test('Today: the template lists the cards in the approved order (alert, coach, workout, rings, missions, food, weight, report, photo, readiness, insights)', () => {
  eq(TODAY_ORDER.join(), 'alert,coach,workout,rings,missions,food,weight,report,photo,readiness,insights');
  const t = src('js/screens/today.js');
  const body = t.slice(at(t, 'el.innerHTML = `'));
  inOrder(body, ['${greeting()}', '${alert.html}', '${coachLine()}', '${workoutCard()}', 'class="card rings-card"', '${missionsCard()}', '${foodRow(t)}',
    'class="card weight-card"', '${report.html}', 'data-photo-reminder', '${readinessCard()}', '${insightsBlock()}'], 'Today');
  const slots = [...body.matchAll(/class="slot" data-o="(\d+)"/g)].map((m) => Number(m[1]));
  eq(slots.join(), '1,2,3,4,5,6,7,8,9,10', 'slots sit in the DOM in one-column order');
});

test('Today: nothing from before is left on it (no full Food card, no program line, no separate Score and Weekly cards)', () => {
  const t = src('js/screens/today.js');
  const body = t.slice(at(t, 'el.innerHTML = `'));
  for (const gone of ['foodCard(', 'programLine', 'macroTilesHtml', 'Why these numbers?</summary>']) assert(!t.includes(gone), `${gone} is gone from Today`);
  assert(t.split('scoreCard()').length === 3 && t.split('weeklyCard()').length === 3, 'Score and Weekly are built once, then shared through reportOrScore');
  assert(!body.includes('${badgeCelebrationCards()}') && !body.includes('${completionCards()}') && !body.includes('${tourOfferCard()}'), 'banners only through the alert slot');
  assert(t.includes('foodRow(t)') && t.includes('href="#/food"') && t.includes('data-food-log'), 'compact Food row links to the tab and keeps Log food');
  assert(t.includes('.slice(0, 2)'), 'top 2 insights');
});

test('alert slot: only the highest-priority banner shows when several qualify', () => {
  eq(ALERT_PRIORITY.join(), 'refresh,flags,install,program-done,badge,tour-offer');
  const all = Object.fromEntries(ALERT_PRIORITY.map((id) => [id, () => `<div>${id}</div>`]));
  eq(pickAlert(all).id, 'refresh');
  const { refresh, ...rest } = all;
  eq(pickAlert(rest).id, 'flags', 'a data problem beats the rest');
  eq(pickAlert({ install: all.install, badge: all.badge, 'tour-offer': all['tour-offer'] }).html, '<div>install</div>', 'two qualify, one shows');
  eq(pickAlert({ badge: all.badge, 'tour-offer': all['tour-offer'] }).id, 'badge', 'a badge beats the tour offer');
  eq(pickAlert({ badge: () => '', 'tour-offer': all['tour-offer'] }).id, 'tour-offer', 'an empty one is skipped');
  eq(JSON.stringify(pickAlert({})), JSON.stringify({ id: null, html: '' }));
});

test('alert slot: banners that lose are never rendered (a badge is not marked shown until it can be seen)', () => {
  const ran = [];
  const makers = Object.fromEntries(ALERT_PRIORITY.map((id) => [id, () => { ran.push(id); return id === 'install' ? '<b>x</b>' : ''; }]));
  eq(pickAlert(makers).id, 'install');
  eq(ran.join(), 'refresh,flags,install', 'stops at the first banner with content');
  const f = topFlag([{ level: 'info', message: 'a' }, { level: 'warn', message: 'b' }, { level: 'stop', message: 'c' }]);
  eq(f.message, 'c', 'the most serious flag only');
  eq(topFlag([]), null);
});

test('Today: Weekly report or Forge Score, never both', () => {
  eq(JSON.stringify(reportOrScore({ weekly: '<w>', score: '<s>' })), JSON.stringify({ id: 'weekly', html: '<w>' }));
  eq(JSON.stringify(reportOrScore({ weekly: '', score: '<s>' })), JSON.stringify({ id: 'score', html: '<s>' }));
  eq(JSON.stringify(reportOrScore({ weekly: '', score: '' })), JSON.stringify({ id: null, html: '' }));
  const t = src('js/screens/today.js');
  assert(t.split('${report.html}').length === 2 && !t.includes('data-o="9">${scoreCard') && !t.includes('${weeklyCard()}</div>'), 'one slot for both');
});

test('Today: the app-expiry banner still takes the alert slot when it arrives', () => {
  const t = src('js/screens/today.js');
  assert(/isNative\(\) \? \$\('\[data-alert-slot\]', el\)/.test(t) && t.includes('refreshBannerHtml'), 'refresh banner goes into the alert slot');
});

test('Train: location chips, Resume, preview, Recovery (fresh stat + map in one card), Program, Tools, History & PRs', () => {
  eq(TRAIN_ORDER.join(), 'places,recovery,resume,workout,why,program,tools,history');
  const t = src('js/screens/train.js');
  const body = t.slice(at(t, 'el.innerHTML = `'), at(t, 'flash = new Set(); // the highlight'));
  inOrder(body, ['aria-label="Location"', '${recoveryCardHtml(rec)}', 'class="card resume"', '${plan ? previewCard', '${whyCard(plan, stalled)}', '<p class="label">Program</p>', 'class="tools"', 'data-train-history'], 'Train');
  assert(!body.includes('href="#/history"><span class="t-ic"'), 'History is its own row, not a tool tile');
  const r = src('js/ui/recovery-card.js');
  inOrder(r, ['fresh muscle groups', '${bodyMap(rec'], 'Recovery card');
  assert(r.includes('data-tour="train-recovery"') && r.includes('data-recovery-card'), 'one card');
});

test('Body: the recovery map moved to Train, and Body points there so nothing is orphaned', () => {
  const b = src('js/screens/body.js');
  assert(!b.includes('bodyMap(') && b.includes('data-recovery-link') && b.includes('href="#/train/recovery"'), 'link to the Recovery card on Train');
});

test('Food: the "Why these numbers?" explainer moved here from Today', () => {
  const f = src('js/screens/food.js');
  assert(f.includes('Why these numbers?') && f.includes('FLOOR_SOURCE') && f.includes('data-food-why'));
});

test('tour: every step still points at a real element on its screen', () => {
  assert(TOUR_STEPS.length >= 10 && TOUR_STEPS.length <= 11, `${TOUR_STEPS.length} steps`);
  const screens = { today: src('js/screens/today.js'), train: src('js/screens/train.js') + src('js/ui/recovery-card.js'), food: src('index.html'), weight: src('index.html') + src('js/screens/weight.js') };
  const needle = { workout: 'data-tour="workout"', rings: 'rings-card', coach: 'data-coach-card', weight: 'data-log', recovery: 'data-tour="train-recovery"', food: 'href="#/food"' };
  for (const [id, n] of Object.entries(needle)) {
    const s = TOUR_STEPS.find((x) => x.id === id);
    assert(s && s.route && screens[s.route] && screens[s.route].includes(n), `${id}: ${n} is on ${s && s.route}`);
  }
  eq(TOUR_STEPS.find((s) => s.id === 'recovery').route, 'train');
  assert(!TOUR_STEPS.some((s) => s.target && s.target.includes('body-recovery')), 'no step points at the old Body map');
});

test('old links: #/body still opens Body (with its Recovery map link) and #/food, #/score and the rest are unchanged', () => {
  const nav = src('js/nav.js');
  for (const r of ['today', 'train', 'food', 'body', 'score']) assert(nav.includes(`'${r}'`), r);
});
