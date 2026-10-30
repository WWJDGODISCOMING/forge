// History: calendar heatmap, weekly sets per muscle, PR board, e1RM trends, recent sessions.
import { state } from '../state.js';
import { esc, $, sheet, confirmSheet, todayKey, formatDay } from '../ui.js';
import { historyIndex, unit } from '../workouts/plan.js';
import { exerciseById } from '../workouts/library.js';
import { e1rm, toUnit } from '../workouts/progression.js';
import { MUSCLE_LABELS } from '../workouts/recovery.js';
import { dayKey, addDays } from '../weight/smoothing.js';
import { softDelete, patch } from '../db.js';
import { exerciseRir, setEffort, effortLabel, EFFORT_CHOICES } from '../workouts/effort.js';
import { CARDIO_TYPES, cardioStatsHtml } from '../cardio-types.js';
import { icon, emptyState } from '../ui/icons.js';
import { setsPerMuscle } from '../workouts/sets-per-muscle.js';
import { legActivity, legSummary, LEG_MUSCLES } from '../workouts/leg-activity.js';
import { sourceTag } from '../health/apple-workouts.js';

import { bindScrub } from '../ui/scrub.js';
import { durationText } from '../workouts/energy.js';
import { scrubLayer, scrubBar } from '../ui/linechart.js';

let trendId = null;
let unbindScrub = () => {};

function mondayOf(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7;
  return addDays(key, -dow);
}

export { setsPerMuscle };

function bestOf(ex, sets) {
  if (ex.timed || ['bodyweight', 'band', 'other', 'backpack'].includes(ex.load)) return { v: Math.max(...sets.map((s) => s.reps || 0)), unit: ex.timed ? 's' : 'reps' };
  const best = Math.max(0, ...sets.map((s) => e1rm(s.weight, s.reps) || 0));
  if (best) return { v: Math.round(best), unit: 'e1RM' };
  return { v: Math.max(...sets.map((s) => s.weight || 0)), unit: 'top' };
}

export function renderHistory(el) {
  const u = unit();
  const h = historyIndex();
  const done = h.done;
  const cardio = [...state.cardio].sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  const today = todayKey();
  const thisMon = mondayOf(today);
  const thisWeek = setsPerMuscle(done, thisMon, addDays(today, 1));
  const lastWeek = setsPerMuscle(done, addDays(thisMon, -7), thisMon);
  // Display only: steps and leg cardio, drawn as a separate stripe. It never touches the hard-set numbers above.
  const leg = legActivity({ healthDaily: state.health_daily, cardio, from: thisMon, to: addDays(today, 1) });
  const legRows = leg ? LEG_MUSCLES.filter((m) => leg[m] > 0) : [];
  const muscles = ['chest', 'lats', 'upper_back', 'front_delts', 'side_delts', 'rear_delts', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs'];

  // Heatmap: 12 weeks, Monday-start columns.
  const start = addDays(thisMon, -7 * 11);
  const load = {};
  for (const w of done) {
    const k = dayKey(w.started_at);
    load[k] = (load[k] || 0) + (w.exercises || []).reduce((n, it) => n + (it.sets || []).filter((s) => s.done && !s.warmup).length, 0);
  }
  for (const c of cardio) {
    const k = c.day || dayKey(c.started_at);
    load[k] = (load[k] || 0) + Math.round((c.duration_min || 0) / 5);
  }
  const cells = [];
  for (let wk = 0; wk < 12; wk++) {
    for (let d = 0; d < 7; d++) {
      const k = addDays(start, wk * 7 + d);
      const v = load[k] || 0;
      const lvl = k > today ? 'future' : v === 0 ? 'l0' : v < 8 ? 'l1' : v < 16 ? 'l2' : v < 24 ? 'l3' : 'l4';
      cells.push(`<i class="${lvl}" title="${k}: ${v}" style="grid-column:${wk + 1};grid-row:${d + 1}"></i>`);
    }
  }
  const activeDays = Object.keys(load).filter((k) => k >= start && k <= today && load[k] > 0).length;

  // PR board
  const exIds = [...new Set(done.flatMap((w) => (w.exercises || []).map((it) => it.exercise_id)))];
  const board = exIds
    .map((id) => {
      const ex = exerciseById(id);
      const hist = h.historyFor(id);
      if (!ex || !hist.length) return null;
      const all = hist.flatMap((s) => s.sets);
      const b = bestOf(ex, all);
      return { id, ex, b, last: hist[0].date, sessions: hist.length };
    })
    .filter(Boolean)
    .sort((a, b) => (a.last < b.last ? 1 : -1));
  const trendable = board.filter((r) => r.sessions >= 2);
  if (!trendId || !trendable.some((r) => r.id === trendId)) trendId = trendable[0]?.id || null;

  const recent = [
    ...done.slice(0, 30).map((w) => ({ kind: 'w', at: w.started_at, w })),
    ...cardio.slice(0, 30).map((c) => ({ kind: 'c', at: c.started_at, c })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 25);

  el.innerHTML = `
    <section class="stack">
      <div class="large-title hist-head"><h1>History</h1><button class="btn small" data-log-workout>+ Log a workout</button></div>

      <div class="card">
        <p class="label">Last 12 weeks · <span data-count>${activeDays}</span> active days</p>
        <div class="heatmap" role="img" aria-label="Training calendar heatmap">${cells.join('')}</div>
        <p class="small muted legend">Less <i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> More</p>
      </div>

      <div class="card">
        <p class="label">Sets per muscle this week</p>
        <p class="small muted">Most people grow well on about 10–20 hard sets per muscle per week. Last week shown faintly.</p>
        <div class="vol">
          ${muscles.map((m) => {
            const v = thisWeek[m] || 0;
            const p = lastWeek[m] || 0;
            const a = legRows.includes(m) ? leg[m] : 0;
            const hard = Math.round(v * 10) / 10;
            const bar = `<div class="vol-bar"${a ? ` role="img" aria-label="${MUSCLE_LABELS[m]}: ${hard} hard sets, plus ${a} leg activity"` : ''}><em style="width:${Math.min(100, (p / 24) * 100)}%"></em><i style="width:${Math.min(100, (v / 24) * 100)}%" class="${v >= 10 && v <= 20 ? 'in' : ''}"></i>${a ? `<u class="act" style="left:${Math.min(100, (v / 24) * 100)}%;width:${(Math.min(a, 4) / 24) * 100}%"></u>` : ''}<s></s></div>`;
            if (!a) return `<div class="vol-row"><span>${MUSCLE_LABELS[m]}</span>${bar}<b>${hard}</b></div>`;
            return `<button type="button" class="vol-row vol-leg" data-leg aria-label="${MUSCLE_LABELS[m]}: ${hard} hard sets, plus ${a} leg activity. What is this?"><span>${MUSCLE_LABELS[m]}<small class="muted act-sub">+${a} activity</small></span>${bar}<b>${hard}</b></button>`;
          }).join('')}
        </div>
        ${legRows.length ? `<button type="button" class="vol-legend small muted" data-leg><i class="act-sw" aria-hidden="true"></i>Leg activity (steps, jogging)</button>` : ''}
      </div>

      ${trendable.length ? `
      <div class="card">
        <p class="label">Progress</p>
        <select data-trend aria-label="Exercise">${trendable.map((r) => `<option value="${esc(r.id)}" ${r.id === trendId ? 'selected' : ''}>${esc(r.ex.name)}</option>`).join('')}</select>
        ${trendChart(trendId, u)}
      </div>` : ''}

      <div class="card">
        <p class="label">Personal records</p>
        ${board.length ? `<ul class="list flat">${board.slice(0, 25).map((r) => `
          <li><div><b>${esc(r.ex.name)}</b><small class="muted">${r.sessions} session${r.sessions === 1 ? '' : 's'} · last ${formatDay(dayKey(r.last))}</small></div>
          <b class="pr">${r.b.v}${r.b.unit === 'e1RM' || r.b.unit === 'top' ? ` ${u}` : r.b.unit === 's' ? 's' : ' reps'}<small class="muted">${r.b.unit === 'e1RM' ? ' est. 1RM' : r.b.unit === 'top' ? ' best' : ''}</small></b></li>`).join('')}</ul>`
          : '<p class="muted">Finish a workout to start your PR board.</p>'}
      </div>

      <h2>Recent</h2>
      ${recent.length ? `<ul class="list">${recent.map((r) => r.kind === 'w' ? `
        <li class="tap" data-w="${esc(r.w.id)}"><div><b>${esc(r.w.label)}</b>
          <small class="muted">${formatDay(dayKey(r.at), { weekday: 'short', month: 'short', day: 'numeric' })} · ${esc(state.locations.find((l) => l.id === r.w.location_id)?.name || '')} · ${(r.w.exercises || []).reduce((n, it) => n + it.sets.filter((s) => s.done && !s.warmup).length, 0)} sets${durationText(r.w)}${(r.w.prs || []).length ? ` · ${icon('trophy')} ${r.w.prs.length}` : ''}</small></div><span class="chev" aria-hidden="true">${icon('chev')}</span></li>` : `
        <li class="tap" data-c="${esc(r.c.id)}"><div><b>${esc(r.c.name || (r.c.activity === 'other' && r.c.notes && r.c.notes.includes(' · ') ? r.c.notes.split(' · ')[0] : CARDIO_TYPES[r.c.activity] || r.c.activity))}</b>
          <small class="muted">${formatDay(r.c.day || dayKey(r.at), { weekday: 'short', month: 'short', day: 'numeric' })} · ${r.c.duration_min} min${r.c.calories ? ` · ${r.c.calories} kcal` : ''} · ${esc(sourceTag(r.c))}</small></div><span class="chev" aria-hidden="true">${icon('chev')}</span></li>`).join('')}</ul>`
        : `<div class="card">${emptyState({ icon: 'chart', title: 'No workouts yet', text: 'Finish a workout and it shows up here, with your records.', action: { href: '#/train', label: 'Start your first workout' } })}</div>`}
    </section>`;

  const sel = $('[data-trend]', el);
  if (sel) sel.addEventListener('change', () => { trendId = sel.value; renderHistory(el); });
  unbindScrub();
  unbindScrub = bindScrub($('[data-trend] ~ svg.chart', el), $('[data-trend] ~ .scrub-bar [data-readout]', el), { dayText: (d) => formatDay(d, { month: 'short', day: 'numeric' }) });
  el.querySelectorAll('[data-leg]').forEach((b) => b.addEventListener('click', () => openLegActivity(leg)));
  $('[data-log-workout]', el).addEventListener('click', () => import('./log-workout.js').then((m) => m.openLogWorkout()));
  el.querySelectorAll('[data-w]').forEach((li) => li.addEventListener('click', () => openWorkout(li.dataset.w)));
  el.querySelectorAll('[data-c]').forEach((li) => li.addEventListener('click', () => openCardio(li.dataset.c)));
}

function trendChart(id, u) {
  const ex = exerciseById(id);
  if (!ex) return '';
  const hist = [...historyIndex().historyFor(id)].reverse();
  const pts = hist.map((s) => ({ day: dayKey(s.date), v: bestOf(ex, s.sets).v })).filter((p) => p.v > 0);
  if (pts.length < 2) return '<p class="muted small">Needs two sessions.</p>';
  const W = 340, Hh = 160, L = 36, R = 8, T = 10, B = 22;
  const vs = pts.map((p) => p.v);
  let min = Math.min(...vs), max = Math.max(...vs);
  if (max === min) { max += 1; min -= 1; }
  const x = (i) => L + (i / (pts.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (Hh - T - B);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const b = bestOf(ex, [{ weight: 1, reps: 1 }]).unit;
  const label = ex.timed ? 'seconds' : b === 'reps' ? 'best reps' : `est. 1RM (${u})`;
  const unitText = ex.timed ? 's' : b === 'reps' ? 'reps' : u;
  const scrub = pts.map((p, i) => [Number(x(i).toFixed(1)), Number(y(p.v).toFixed(1)), p.day, `${Math.round(p.v * 10) / 10} ${unitText}`]);
  return `<svg viewBox="0 0 ${W} ${Hh}" class="chart" role="img" aria-label="${esc(ex.name)} ${label} over time" data-scrub="${esc(JSON.stringify(scrub))}">
    <line x1="${L}" x2="${W - R}" y1="${y(max)}" y2="${y(max)}" class="grid"/><line x1="${L}" x2="${W - R}" y1="${y(min)}" y2="${y(min)}" class="grid"/>
    <text x="${L - 6}" y="${y(max) + 4}" class="axis" text-anchor="end">${Math.round(max)}</text>
    <text x="${L - 6}" y="${y(min) + 4}" class="axis" text-anchor="end">${Math.round(min)}</text>
    <path d="${d}" class="trend"/>${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="3" class="dot strong"/>`).join('')}
    ${scrubLayer(T, Hh - B)}
    <text x="${L}" y="${Hh - 6}" class="axis">${formatDay(pts[0].day)}</text><text x="${W - R}" y="${Hh - 6}" class="axis" text-anchor="end">${formatDay(pts[pts.length - 1].day)}</text>
  </svg>${scrubBar()}<p class="small muted">${esc(label)}</p>`;
}

function openWorkout(id) {
  const w = state.workouts.find((x) => x.id === id);
  if (!w) return;
  const u = unit();
  sheet(w.label, (body, close) => {
    body.innerHTML = `
      <div class="stack">
        <p class="muted small">${new Date(w.started_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${durationText(w)}</p>
        ${(w.prs || []).length ? `<div class="card prs"><p class="label">PRs ${icon('trophy')}</p><ul class="reasons">${w.prs.map((p) => `<li>${esc(p.label)}</li>`).join('')}</ul></div>` : ''}
        ${(w.exercises || []).map((it, n) => {
          const ex = exerciseById(it.exercise_id);
          const sets = it.sets.filter((s) => s.done);
          if (!sets.length) return '';
          return `<div><b>${esc(ex ? ex.name : it.exercise_id)}</b><p class="small muted">${sets.map((s) => `${s.warmup ? 'W ' : ''}${s.weight_kg != null ? `${Math.round(toUnit(s.weight_kg, u) * 10) / 10}×` : ''}${s.reps}${ex && ex.timed ? 's' : ''}${s.rir != null ? ` @${s.rir}` : ''}`).join(' · ')}</p>${ex && ex.timed ? '' : effortRow(n, exerciseRir(it))}</div>`;
        }).join('')}
        <button class="btn danger-ghost" data-del>Delete this workout</button>
      </div>`;
    body.querySelectorAll('[data-effort]').forEach((b) => b.addEventListener('click', () => {
      const [n, v] = b.dataset.effort.split(':');
      const it = w.exercises[Number(n)];
      const same = exerciseRir(it) === Number(v);
      setEffort(it, same ? null : Number(v));
      if (!same) delete it.effort_skipped;
      patch('workouts', w.id, { exercises: w.exercises });
      import('../native/workouts-health.js').then((m) => m.resync(w)).catch(() => {}); // Apple Health replaces its copy (higher version)
      const r = exerciseRir(it);
      b.closest('.effort-row').querySelectorAll('[data-effort]').forEach((x) => x.classList.toggle('on', Number(x.dataset.effort.split(':')[1]) === r));
    }));
    $('[data-del]', body).onclick = async () => {
      close();
      if (await confirmSheet({ title: 'Delete workout?', message: 'It will be removed from your history and PRs on all devices.', confirmLabel: 'Delete', danger: true })) {
        const gone = state.workouts.find((x) => x.id === id);
        softDelete('workouts', id);
        if (gone && gone.hk_uuid) import('../native/workouts-health.js').then((m) => m.removeFor(gone)).catch(() => {});
      }
    };
  });
}

/** "Reps left" rating for one exercise, editable afterward (tap the lit one again to clear it). */
function effortRow(n, r) {
  return `<div class="effort-row" role="group" aria-label="Reps left in the tank"><span class="small muted">Reps left</span>${EFFORT_CHOICES.map((v) => `<button data-effort="${n}:${v}" class="${r === v ? 'on' : ''}" aria-label="${effortLabel(v)} reps left">${effortLabel(v)}</button>`).join('')}</div>`;
}

function openCardio(id) {
  const c = state.cardio.find((x) => x.id === id);
  if (!c) return;
  const u = unit();
  sheet(c.name || CARDIO_TYPES[c.activity] || 'Cardio', (body, close) => {
    body.innerHTML = `
      <div class="stack">
        <div class="stats">
          ${cardioStatsHtml(c, u)}
        </div>
        ${c.avg_hr ? `<p>Avg heart rate: ${c.avg_hr} bpm <span class="muted small">(${c.source === 'apple_health' ? 'Apple Watch' : 'typed in'})</span></p>` : ''}
        ${c.notes ? `<p class="muted">${esc(c.notes)}</p>` : ''}
        <p class="small muted">Source: ${c.source === 'apple_health' ? esc(`Apple Health · ${sourceTag(c)}`) : 'manual entry'}</p>
        <button class="btn danger-ghost" data-del>Delete</button>
      </div>`;
    $('[data-del]', body).onclick = async () => {
      close();
      if (await confirmSheet({ title: 'Delete this cardio session?', message: 'This can’t be undone.', confirmLabel: 'Delete', danger: true })) softDelete('cardio_sessions', id);
    };
  });
}

function openLegActivity(a) {
  if (!a) return;
  const names = { quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes', calves: 'Calves' };
  sheet('Leg activity', (body) => {
    body.innerHTML = `<div class="stack" data-leg-sheet>
      <p>${esc(legSummary(a))}</p>
      <ul class="list flat">${LEG_MUSCLES.map((m) => `<li><div><b>${names[m]}</b></div><b>+${a[m]}</b></li>`).join('')}</ul>
      <p class="small muted">Steps: ${a.sources.stepUnits.toFixed(1)} · Cardio bonus: ${a.sources.cardioUnits.toFixed(1)} · across ${a.sources.days} ${a.sources.days === 1 ? 'day' : 'days'}. Each muscle tops out at 4, so this never reads as a training dose.</p>
    </div>`;
  });
}
