// Live cardio workout screen (#/live): pick Jog in place / Walk / Run, a 3-2-1, then a big running timer with active and
// total kcal, heart rate when the phone has it (a paired Watch), and distance + pace for walk and run. Pause, resume,
// end (or discard an accidental start). The numbers come from js/workouts/live-core.js; the work is in js/native/live-workout.js.
import { esc, $, sheet, toast } from '../ui.js';
import { state } from '../state.js';
import { patch } from '../db.js';
import { plugin } from '../native/bridge.js';
import { requestAccess } from '../native/workouts-health.js';
import { unit } from '../workouts/plan.js';
import { icon } from '../ui/icons.js';
import { haptics } from '../ui/haptic.js';
import { setWantAwake } from '../timer.js';
import { LIVE_KINDS, LIVE_ORDER, LIVE_SHORT_MS, activeMs, isPaused, fmtElapsed, fmtDistance, fmtPace, activeKcal, totalKcal, liveSummaryLine, healthWriteWanted, liveNote } from '../workouts/live-core.js';
import * as live from '../native/live-workout.js';

let tickId = null;
let offChange = null;
let countT = null; // the 3-2-1 before the clock starts

const stopTicking = () => { clearInterval(tickId); tickId = null; clearTimeout(countT); countT = null; if (offChange) offChange(); offChange = null; setWantAwake(false); };

export function leaveLive() { stopTicking(); }

const KIND_ICON = { jog_in_place: 'run', walk: 'walk', run: 'run' };
const SHORT_WORKOUT = LIVE_SHORT_MS;
const COUNTDOWN_FROM = 3;

/** One line to flip Settings → Apple Health → Save Forge workouts, right where the choice matters. iPhone app only. */
function healthRowHtml() {
  if (!plugin('ForgeWorkouts')) return '';
  const on = healthWriteWanted(state.settings);
  return `<button class="live-health" role="switch" aria-checked="${on}" data-health><span>Save to Apple Health</span><b data-health-v>${on ? 'On' : 'Off'}</b></button>`;
}

async function flipHealth(el) {
  const next = !healthWriteWanted(state.settings);
  if (next) {
    const status = await requestAccess();
    if (status === 'denied' || status === 'unavailable') { toast('Allow Forge to write Workouts and Active Energy in Settings → Health → Data Access & Devices → Forge.', 6000); return; }
    patch('settings', 'main', { health_write_workouts: true, health_write_since: new Date().toISOString() });
  } else patch('settings', 'main', { health_write_workouts: false });
  const b = $('[data-health]', el);
  if (b) { b.setAttribute('aria-checked', String(next)); $('[data-health-v]', b).textContent = next ? 'On' : 'Off'; }
  haptics.select && haptics.select();
}

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
    ${healthRowHtml()}
    <button class="live-go" data-start>Start</button>
    <p class="small muted live-fine">${live.weightKg() ? '' : 'Add your weight in Body for calories. '}Forge always keeps the workout. It goes to Apple Health only when “Save to Apple Health” is on. Heart rate shows when your Apple Watch is on and paired.</p>`;
}

function tileHtml(label, val, attr = '') {
  return `<div class="live-tile"><span class="live-tl">${label}</span><b class="live-tv" ${attr}>${val}</b></div>`;
}

const gridHtml = (tiles) => `<div class="live-grid" data-n="${tiles.length}">${tiles.join('')}</div>`;

function runningHtml(s) {
  const k = LIVE_KINDS[s.kind];
  const u = unit() === 'kg' ? 'km' : 'mi';
  const tiles = [
    ...(k.distance ? [tileHtml(`Distance ${u}`, '0.00', 'data-dist'), tileHtml(`Avg pace /${u}`, '--\'--"', 'data-pace')] : []),
    tileHtml('Active kcal', '0', 'data-active'),
    tileHtml('Total kcal', '0', 'data-total'),
    tileHtml('Heart rate bpm', '--', 'data-hr'),
  ];
  return `
    <div class="live-top"><a class="live-close" href="#/train" aria-label="Minimise. The workout keeps running">${icon('chev')}</a><h1>${esc(k.label)}</h1><span class="live-badge" data-state></span></div>
    <div class="live-body">
      <div class="live-main">
        <div class="live-clock" data-clock aria-hidden="true">0:00</div>
        <p class="sr-only" data-sr aria-live="off"></p>
        <div class="live-actions">
          <button class="live-pause" data-pause><span data-pause-ic aria-hidden="true"></span><span data-pause-t>Pause</span></button>
          <button class="live-end" data-end>End</button>
        </div>
      </div>
      ${gridHtml(tiles)}
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
  set('[data-note]', liveNote({ failed: m.failed, nativeLive: m.nativeLive, activity: m.activity, healthOn: healthWriteWanted(state.settings), inApp: !!plugin('ForgeWorkouts') }));
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
    ${gridHtml([
      ...(dist ? [tileHtml('Distance', dist)] : []),
      tileHtml('Active kcal', f.calories == null ? '--' : String(f.calories)),
      ...(f.avg_hr ? [tileHtml('Avg heart rate bpm', String(f.avg_hr))] : []),
    ])}
    <p class="small muted live-fine">${f.hk_uuid ? 'Saved to Forge and Apple Health.' : 'Saved to Forge.'}</p>
    <a class="live-go" href="#/train">Done</a>`;
}

/** End / Discard / Keep going. A very short workout is most likely a mis-tap, so Discard is the suggested button then. → 'save' | 'discard' | null */
function endChoice(ms) {
  const short = ms < SHORT_WORKOUT;
  return new Promise((resolve) => {
    let answered = false;
    const done = (v, closeSheet) => { answered = true; closeSheet(); resolve(v); };
    sheet('End this workout?', (body, closeSheet) => {
      body.innerHTML = `
        <p class="muted">${short ? 'That was under a minute. Was it an accidental start? Discard throws it away.' : 'Saved to Forge, and to Apple Health if “Save to Apple Health” is on.'}</p>
        <div class="stack">
          <button class="btn bigbtn ${short ? 'ghost' : ''}" data-save>End and save</button>
          <button class="btn bigbtn live-discard ${short ? '' : 'ghost'}" data-discard>Discard workout</button>
          <button class="btn ghost bigbtn" data-keep>Keep going</button>
        </div>`;
      body.querySelector('[data-save]').onclick = () => done('save', closeSheet);
      body.querySelector('[data-keep]').onclick = () => done(null, closeSheet);
      // Discard asks once more inside this same sheet (a second sheet opening on top of a closing one is what lost the tap before).
      body.querySelector('[data-discard]').onclick = () => {
        body.innerHTML = `
          <p class="muted">Nothing is saved to Forge or Apple Health.</p>
          <div class="stack">
            <button class="btn bigbtn danger live-discard" data-sure>Yes, discard it</button>
            <button class="btn ghost bigbtn" data-keep>Keep going</button>
          </div>`;
        haptics.warning && haptics.warning();
        body.querySelector('[data-sure]').onclick = () => done('discard', closeSheet);
        body.querySelector('[data-keep]').onclick = () => done(null, closeSheet);
      };
    });
    const obs = new MutationObserver(() => {
      if (!document.querySelector('dialog.sheet') && !answered) { answered = true; resolve(null); }
      if (answered) obs.disconnect();
    });
    obs.observe(document.body, { childList: true });
  });
}

function showRunning(el) {
  const s = live.current();
  el.innerHTML = `<section class="live" data-kind="${s.kind}">${runningHtml(s)}</section>`;
  setWantAwake(true);
  paint(el);
  $('[data-pause]', el).onclick = async () => {
    if (!live.current()) return renderLive(el);
    haptics.medium && haptics.medium();
    if (isPaused(live.current())) await live.resume(); else await live.pause();
    paint(el);
  };
  $('[data-end]', el).onclick = async () => {
    haptics.light && haptics.light();
    const cur = live.current();
    if (!cur) return renderLive(el); // already ended somewhere else: show the truth, never a dead button
    const choice = await endChoice(activeMs(cur, Date.now()));
    if (choice === 'discard') {
      stopTicking();
      const stopping = live.discard(); // the state is cleared before this returns; the native stop finishes in the background
      location.hash = '#/train';
      await stopping;
      return;
    }
    if (choice !== 'save') return;
    stopTicking();
    for (const b of el.querySelectorAll('[data-pause], [data-end]')) b.disabled = true; // the phone can take a few seconds to answer: show it's working, never a dead-looking button
    const endBtn = $('[data-end]', el);
    if (endBtn) endBtn.textContent = 'Saving…';
    const row = await live.finish();
    haptics.success && haptics.success();
    if (row) el.innerHTML = `<section class="live">${doneHtml(row, unit() === 'kg' ? 'km' : 'mi')}</section>`;
    else location.hash = '#/train';
  };
  clearInterval(tickId);
  tickId = setInterval(() => { if (!el.isConnected) return stopTicking(); paint(el); }, 250);
  if (offChange) offChange();
  offChange = live.onChange((s2) => { if (!s2) { if (el.isConnected && $('.live', el)?.dataset.kind) renderLive(el); return; } paint(el); });
  live.refresh().then(() => paint(el));
}

/** 3-2-1 with a haptic tick per count. The pop is CSS and is off under Reduce Motion, where the number just changes. Cancel goes back to the picker. */
function countdown(el, kind) {
  let n = COUNTDOWN_FROM;
  el.innerHTML = `<section class="live" data-count>
    <div class="live-top"><h1>${esc(LIVE_KINDS[kind].label)}</h1></div>
    <div class="live-countwrap"><div class="live-count" data-n role="timer" aria-live="polite">${n}</div><p class="muted live-count-t">Get ready</p></div>
    <button class="live-end live-cancel" data-cancel>Cancel</button></section>`;
  $('[data-cancel]', el).onclick = () => { clearTimeout(countT); countT = null; renderLive(el); };
  const num = $('[data-n]', el);
  const step = async () => {
    if (!el.isConnected || !num.isConnected) return;
    if (n === 0) { countT = null; await live.start(kind); showRunning(el); return; }
    num.textContent = String(n);
    num.style.animation = 'none'; void num.offsetWidth; num.style.animation = '';
    haptics.select && haptics.select();
    n -= 1;
    countT = setTimeout(step, 1000);
  };
  step();
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
  const h = $('[data-health]', el);
  if (h) h.onclick = () => flipHealth(el);
  $('[data-start]', el).onclick = (e) => {
    e.currentTarget.disabled = true;
    haptics.medium && haptics.medium();
    countdown(el, kind);
  };
}
