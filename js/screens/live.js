// Live cardio workout screen (#/live): pick Jog in place / Walk / Run, then a big running timer with active and total
// kcal, heart rate when the phone has it (a paired Watch), and distance + pace for walk and run. Pause, resume, end.
// The numbers come from js/workouts/live-core.js; the work is in js/native/live-workout.js.
import { esc, $, confirmSheet } from '../ui.js';
import { unit } from '../workouts/plan.js';
import { icon } from '../ui/icons.js';
import { haptics } from '../ui/haptic.js';
import { setWantAwake } from '../timer.js';
import { LIVE_KINDS, LIVE_ORDER, activeMs, isPaused, fmtElapsed, fmtDistance, fmtPace, activeKcal, totalKcal, liveSummaryLine } from '../workouts/live-core.js';
import * as live from '../native/live-workout.js';

let tickId = null;
let offChange = null;

const stopTicking = () => { clearInterval(tickId); tickId = null; if (offChange) offChange(); offChange = null; setWantAwake(false); };

export function leaveLive() { stopTicking(); }

const KIND_ICON = { jog_in_place: 'bike', walk: 'bike', run: 'bike' };

function pickerHtml() {
  return `
    <div class="live-top"><a class="live-close" href="#/train" aria-label="Back to Train">${icon('chev')}</a><h1>Live workout</h1></div>
    <p class="live-lead">Pick one and tap Start. Forge keeps the clock, the calories and your lock screen up to date.</p>
    <div class="live-kinds" role="radiogroup" aria-label="Workout type">
      ${LIVE_ORDER.map((k, i) => `
        <button class="live-kind" role="radio" aria-checked="${i === 0}" data-kind="${k}">
          <span class="live-kind-ic" aria-hidden="true">${icon(KIND_ICON[k])}</span>
          <span class="live-kind-t">${esc(LIVE_KINDS[k].label)}</span>
          <span class="live-kind-s small">${LIVE_KINDS[k].distance ? 'Time, distance, pace, calories' : 'Time and calories'}</span>
        </button>`).join('')}
    </div>
    <button class="live-go" data-start>Start</button>
    <p class="small muted live-fine">${live.weightKg() ? '' : 'Add your weight in Body for calories. '}Calories are saved to Apple Health when it’s on. Heart rate shows when your Apple Watch is on and paired.</p>`;
}

function tileHtml(label, val, sub = '', attr = '') {
  return `<div class="live-tile"><span class="live-tl">${label}</span><b class="live-tv" ${attr}>${val}</b>${sub ? `<span class="live-ts small">${sub}</span>` : ''}</div>`;
}

function runningHtml(s) {
  const k = LIVE_KINDS[s.kind];
  const u = unit() === 'kg' ? 'km' : 'mi';
  return `
    <div class="live-top"><a class="live-close" href="#/train" aria-label="Minimise. The workout keeps running">${icon('chev')}</a><h1>${esc(k.label)}</h1><span class="live-badge" data-state></span></div>
    <div class="live-clock" data-clock aria-hidden="true">0:00</div>
    <p class="sr-only" data-sr aria-live="off"></p>
    <div class="live-grid">
      ${k.distance ? tileHtml(`Distance (${u})`, '0.00', '', 'data-dist') + tileHtml(`Avg pace (/${u})`, '--\'--"', '', 'data-pace') : ''}
      ${tileHtml('Active kcal', '0', '', 'data-active')}
      ${tileHtml('Total kcal', '0', '', 'data-total')}
      ${tileHtml('Heart rate', '--', 'bpm', 'data-hr')}
    </div>
    <div class="live-actions">
      <button class="live-pause" data-pause><span data-pause-ic aria-hidden="true"></span><span data-pause-t>Pause</span></button>
      <button class="live-end" data-end>End</button>
    </div>
    <p class="small muted live-fine" data-note></p>`;
}

function paint(el) {
  const s = live.current();
  if (!s) return;
  const m = live.liveMetrics();
  const now = Date.now();
  const ms = activeMs(s, now);
  const k = LIVE_KINDS[s.kind];
  const u = unit() === 'kg' ? 'km' : 'mi';
  const w = live.weightKg();
  const active = activeKcal(s.kind, ms, w, m.kcal);
  const total = totalKcal(active, ms, w);
  const set = (sel, v) => { const n = $(sel, el); if (n && n.textContent !== v) n.textContent = v; };
  set('[data-clock]', fmtElapsed(ms));
  if (k.distance) { set('[data-dist]', fmtDistance(m.distanceM, u)); set('[data-pace]', fmtPace(m.distanceM, ms, u)); }
  set('[data-active]', active == null ? '--' : String(active));
  set('[data-total]', total == null ? '--' : String(total));
  set('[data-hr]', m.hr ? String(Math.round(m.hr)) : '--');
  const paused = isPaused(s);
  const root = $('.live', el);
  if (root) root.classList.toggle('paused', paused);
  set('[data-state]', paused ? 'Paused' : 'Live');
  set('[data-pause-t]', paused ? 'Resume' : 'Pause');
  const pb = $('[data-pause]', el);
  if (pb) pb.setAttribute('aria-label', paused ? 'Resume workout' : 'Pause workout');
  const ic = $('[data-pause-ic]', el);
  if (ic) ic.innerHTML = paused ? icon('play') : icon('pause');
  set('[data-note]', m.nativeLive ? (m.activity ? 'Also on your lock screen.' : 'Saving to Apple Health when you end.') : 'Kept in Forge. Open the iPhone app to also fill your Apple rings.');
  const sr = $('[data-sr]', el);
  if (sr && Math.floor(ms / 60000) !== Number(sr.dataset.min)) { sr.dataset.min = Math.floor(ms / 60000); sr.textContent = liveSummaryLine(s, now, u, { distanceM: m.distanceM, kcal: active }); }
}

function doneHtml(row, u) {
  const f = row.fields;
  const km = f.distance_km;
  const dist = km ? (u === 'km' ? `${km.toFixed(2)} km` : `${(km / 1.609344).toFixed(2)} mi`) : null;
  return `
    <div class="live-top"><h1>Nice work</h1></div>
    <div class="live-clock done" aria-label="${f.duration_min} minutes">${f.duration_min}<small> min</small></div>
    <div class="live-grid">
      ${dist ? tileHtml('Distance', dist) : ''}
      ${tileHtml('Active kcal', f.calories == null ? '--' : String(f.calories))}
      ${f.avg_hr ? tileHtml('Avg heart rate', String(f.avg_hr), 'bpm') : ''}
    </div>
    <p class="small muted live-fine">${f.hk_uuid ? 'Saved to Forge and Apple Health.' : 'Saved to Forge.'}</p>
    <a class="live-go" href="#/train">Done</a>`;
}

function showRunning(el) {
  const s = live.current();
  el.innerHTML = `<section class="live" data-kind="${s.kind}">${runningHtml(s)}</section>`;
  setWantAwake(true);
  paint(el);
  $('[data-pause]', el).onclick = async () => {
    haptics.medium && haptics.medium();
    if (isPaused(live.current())) await live.resume(); else await live.pause();
    paint(el);
  };
  $('[data-end]', el).onclick = async () => {
    haptics.light && haptics.light();
    const go = await confirmSheet({ title: 'End this workout?', message: 'It will be saved to Forge and, if it’s on, Apple Health.', confirmLabel: 'End and save' });
    if (!go) return;
    stopTicking();
    const row = await live.finish();
    haptics.success && haptics.success();
    if (row) el.innerHTML = `<section class="live">${doneHtml(row, unit() === 'kg' ? 'km' : 'mi')}</section>`;
    else location.hash = '#/train';
  };
  clearInterval(tickId);
  tickId = setInterval(() => { if (!el.isConnected) return stopTicking(); paint(el); }, 250);
  if (offChange) offChange();
  offChange = live.onChange((s2) => { if (!s2) return; paint(el); });
  live.refresh().then(() => paint(el));
}

export function renderLive(el) {
  stopTicking();
  live.restore();
  if (live.current()) return showRunning(el);
  el.innerHTML = `<section class="live">${pickerHtml()}</section>`;
  let kind = LIVE_ORDER[0];
  el.querySelectorAll('.live-kind').forEach((b) => {
    b.onclick = () => {
      kind = b.dataset.kind;
      el.querySelectorAll('.live-kind').forEach((o) => o.setAttribute('aria-checked', String(o === b)));
      haptics.select && haptics.select();
    };
  });
  $('[data-start]', el).onclick = async (e) => {
    e.currentTarget.disabled = true;
    haptics.medium && haptics.medium();
    await live.start(kind);
    showRunning(el);
  };
}
