// Awards → Past days (#/days) and one day's missions (#/days/YYYY-MM-DD). Read-only, built from stored data.
import { esc } from '../ui.js';
import { icon } from '../ui/icons.js';
import { units as getUnits } from '../state.js';
import { formatWeight } from '../units.js';
import { dayList, dayView } from '../missions/store.js';
import { isDayKey } from '../missions/day-core.js';
import { localDay } from '../missions/core.js';

const fmt = (n) => Math.round(n).toLocaleString();
const parse = (day) => new Date(`${day}T12:00:00`);
const longDate = (day) => parse(day).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = (day) => parse(day).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const NOTHING = 'Nothing logged';

function listHtml() {
  const days = dayList();
  if (!days.length) return `<div class="card"><p class="muted">${NOTHING} yet. Weigh in or finish a workout and your days show up here.</p></div>`;
  const today = localDay(Date.now());
  const rows = days.map((d) => {
    const sub = d.empty ? NOTHING : `${d.done} of ${d.total} missions`;
    const cls = d.all ? 'all' : d.done ? 'some' : 'none';
    return `<li><a class="dd-link" href="#/days/${d.day}" data-day="${d.day}">
      <span class="ms-dot ${cls}" aria-hidden="true"><i></i></span>
      <span class="dd-text"><b>${d.day === today ? 'Today' : esc(shortDate(d.day))}</b><small class="muted">${sub}</small></span>
      <span class="chev" aria-hidden="true">${icon('chev')}</span>
    </a></li>`;
  }).join('');
  return `<div class="card"><ul class="dd-list">${rows}</ul></div>`;
}

function row({ done, label, value, status, muted }) {
  return `<li class="ms-row dd-row ${done ? 'done' : ''}" aria-label="${esc(label)}: ${esc(status)}">
    <span class="ms-check" aria-hidden="true">${done ? icon('check', { filled: true }) : '<i class="ms-ring"></i>'}</span>
    <span class="ms-text"><span>${esc(label)}</span><small class="${muted ? 'muted' : ''}">${esc(value)}</small></span>
    <small class="dd-status ${done ? 'good' : 'muted'}">${esc(status)}</small>
  </li>`;
}

function rowsHtml(v, units) {
  const miss = v.isToday ? 'Not yet' : 'Missed';
  const by = Object.fromEntries(v.missions.map((m) => [m.id, m]));
  const out = [];
  const w = v.weighIn;
  const wv = [w.kg != null ? formatWeight(w.kg, units) : '', w.fatPct != null ? `${w.fatPct.toFixed(1)}% body fat` : ''].filter(Boolean).join(' · ');
  out.push(row({ done: !!by.weigh.done, label: 'Weigh in', value: wv || NOTHING, status: by.weigh.done ? 'Done' : miss, muted: !wv }));
  const tv = v.training.map((t) => `${t.name}${t.minutes != null ? `, ${t.minutes} min` : ''}`).join(' · ');
  out.push(row({ done: !!by.train.done, label: 'Train or move', value: tv || NOTHING, status: by.train.done ? 'Done' : miss, muted: !tv }));
  if (by.steps) {
    const sv = v.steps != null ? `${fmt(v.steps)} of ${fmt(v.stepGoal)} steps` : 'No Apple Health steps for this day';
    out.push(row({ done: by.steps.done, label: 'Steps', value: sv, status: by.steps.done ? 'Done' : by.steps.waiting ? 'No data' : miss, muted: v.steps == null }));
  }
  if (by.protein) {
    out.push(row({ done: by.protein.done, label: 'Protein hit', value: v.protein.logged ? `${fmt(v.protein.g)} of ${fmt(v.protein.target)} g protein` : NOTHING, status: by.protein.done ? 'Done' : miss, muted: !v.protein.logged }));
  }
  if (v.calories.logged || by.protein) {
    const c = v.calories;
    const under = c.logged && (c.ceiling == null || c.kcal <= c.ceiling);
    const val = !c.logged ? NOTHING : c.ceiling != null ? `${fmt(c.kcal)} of ${fmt(c.ceiling)} kcal ceiling` : `${fmt(c.kcal)} kcal`;
    out.push(row({ done: !!under, label: 'Calories', value: val, status: !c.logged ? 'No data' : under ? 'Under' : 'Over', muted: !c.logged }));
  }
  if (by.bed) out.push(row({ done: by.bed.done, label: by.bed.label, value: by.bed.done ? 'On time' : 'Later than your target', status: by.bed.done ? 'Done' : miss }));
  return out.join('');
}

function detailHtml(day) {
  const v = dayView(day);
  const units = getUnits();
  const arrow = (to, dir) => (to
    ? `<a class="dd-arrow" href="#/days/${to}" data-${dir} aria-label="${dir === 'prev' ? 'Previous day' : 'Next day'}, ${esc(shortDate(to))}">${icon('chev')}</a>`
    : `<span class="dd-arrow off" aria-hidden="true">${icon('chev')}</span>`);
  const summary = v.isFuture ? 'This day hasn’t happened yet.' : v.empty ? NOTHING : `${v.done} of ${v.total} missions done${v.all ? ', all of them' : ''}`;
  return `
    <div class="card dd-head">
      <div class="dd-nav">
        ${arrow(v.prev, 'prev')}
        <div class="dd-title"><p class="label">${v.isToday ? 'Today' : 'Day'}</p><h2>${esc(longDate(day))}</h2></div>
        ${arrow(v.next, 'next')}
      </div>
      <p class="small muted">${summary}</p>
      ${v.isToday ? '<a class="link dd-today" href="#/today" data-live>See today’s live card</a>' : ''}
    </div>
    ${v.isFuture ? '' : `<div class="card"><ul class="ms-list">${rowsHtml(v, units)}</ul>
      ${v.empty ? `<p class="small muted">${NOTHING} for this day. That’s okay, rest counts too.</p>` : ''}</div>`}
    <p class="small muted"><a class="link" href="#/days">All past days</a></p>`;
}

export function renderDays(el, day) {
  const ok = isDayKey(day);
  el.innerHTML = `<section class="stack dd">
    <h1>${ok ? 'Daily missions' : 'Past days'}</h1>
    ${ok ? detailHtml(day) : `<p class="small muted">Tap a day to see its missions.</p>${listHtml()}`}
  </section>`;
}
