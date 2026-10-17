// Overlays shared by the guided player and the list view: Paused, "You were away", and Finish.
import { esc, $, sheet, toast, confirmSheet } from '../ui.js';
import { live, pause, resume, elapsed, finishWorkout, discardWorkout, removeAway, acceptAway, flush } from '../workouts/live.js';
import { sessionStats } from '../workouts/session-core.js';
import { toUnit } from '../workouts/progression.js';
import { unit } from '../workouts/plan.js';
import { fmtClock, setWantAwake } from '../timer.js';
import { coach } from '../ui/sound.js';

function overlay(cls, html) {
  document.querySelectorAll('.ov').forEach((o) => o.remove());
  const el = document.createElement('div');
  el.className = `ov ${cls}`;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

/**
 * After the very last set: a chance to take it back before the workout is saved.
 * onUndo() puts that set back; Finish saves and opens the summary.
 */
export function openComplete(onUndo) {
  const w = live.w;
  if (!w) return;
  const u = unit();
  const st = sessionStats(w.exercises, (kg) => toUnit(kg, u));
  const el = overlay('ov-complete', `
    <div class="ov-card">
      <p class="label">All sets done</p>
      <b class="ov-big">Workout complete</b>
      <p class="muted small">${st.sets} set${st.sets === 1 ? '' : 's'} · ${fmtClock(elapsed() / 1000)}</p>
      <button class="btn big" data-finish>Finish</button>
      <button class="btn ghost" data-undo>Undo last set</button>
    </div>`);
  $('[data-finish]', el).onclick = () => {
    el.remove();
    saveAndSummarize();
  };
  $('[data-undo]', el).onclick = () => {
    el.remove();
    onUndo();
  };
}

export const closeOverlays = () => document.querySelectorAll('.ov').forEach((o) => o.remove());

/** Pause the workout and show the Paused overlay. rerender() is called after Resume. */
export function openPaused(rerender) {
  pause();
  coach.cancel();
  const el = overlay('ov-paused', `
    <div class="ov-card">
      <p class="label">Workout paused</p>
      <b class="ov-big">${fmtClock(elapsed() / 1000)}</b>
      <p class="muted small">The clock, rest timer and demos are frozen. Paused time doesn’t count.</p>
      <button class="btn big" data-resume>Resume</button>
      <button class="btn ghost" data-ratesets aria-pressed="${localStorage.getItem('forge.rateSets') === '1'}">Rate every set: ${localStorage.getItem('forge.rateSets') === '1' ? 'on' : 'off'}</button>
      <div class="row gap">
        <button class="btn ghost grow" data-end>End workout</button>
        <button class="btn danger-ghost grow" data-discard>Discard</button>
      </div>
    </div>`);
  $('[data-resume]', el).onclick = () => {
    el.remove();
    resume();
    rerender();
  };
  $('[data-ratesets]', el).onclick = (e) => {
    const on = localStorage.getItem('forge.rateSets') !== '1';
    localStorage.setItem('forge.rateSets', on ? '1' : '0');
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = `Rate every set: ${on ? 'on' : 'off'}`;
  };
  $('[data-end]', el).onclick = () => {
    el.remove();
    openFinish(rerender, { fromPause: true });
  };
  $('[data-discard]', el).onclick = async () => {
    const ok = await confirmSheet({ title: 'Discard workout?', message: 'Nothing from this session will be saved to your history.', confirmLabel: 'Discard', danger: true });
    if (!ok) return;
    el.remove();
    discardWorkout();
    setWantAwake(false);
    toast('Workout discarded');
    location.hash = '#/train';
  };
}

/** Shown on return after >10 min away while not paused. */
export function openAway(gapMs, rerender) {
  const minutes = Math.round(gapMs / 60000);
  const el = overlay('ov-away', `
    <div class="ov-card">
      <p class="label">Welcome back</p>
      <b class="ov-mid">You were away ${minutes} min.</b>
      <p class="muted small">Count it toward this workout’s time, or remove it?</p>
      <div class="row gap">
        <button class="btn ghost grow" data-count>Count it</button>
        <button class="btn grow" data-remove>Remove it</button>
      </div>
    </div>`);
  $('[data-count]', el).onclick = () => {
    acceptAway();
    el.remove();
    rerender();
  };
  $('[data-remove]', el).onclick = () => {
    removeAway(gapMs);
    el.remove();
    toast(`Removed ${minutes} min`);
    rerender();
  };
}

/** Finish (or discard, if nothing was done). Saving goes to the summary screen. */
export function openFinish(rerender, { fromPause = false } = {}) {
  flush();
  const w = live.w;
  if (!w) return;
  const u = unit();
  const st = sessionStats(w.exercises, (kg) => toUnit(kg, u));
  const undone = w.exercises.reduce((n, it) => n + it.sets.filter((s) => !s.done && !s.warmup).length, 0);
  sheet('Finish workout', (body, close) => {
    body.innerHTML = `
      <div class="stack">
        <div class="stats">
          <div><span>Time</span><b>${fmtClock(elapsed() / 1000)}</b></div>
          <div><span>Sets</span><b>${st.sets}</b></div>
          <div><span>Volume</span><b>${st.volume.toLocaleString()} ${u}</b></div>
        </div>
        ${undone && st.sets ? `<p class="small muted">${undone} planned set${undone === 1 ? '' : 's'} not done. They won’t count, and that’s fine.</p>` : ''}
        ${st.sets ? `
          <button class="btn" data-ok>Save workout</button>
          <button class="btn ghost" data-no>Keep going</button>` : `
          <p class="notice warn">No sets completed, so there’s nothing to save. Discarding keeps it out of your history and your program rotation.</p>
          <button class="btn danger" data-discard>Discard workout</button>
          <button class="btn ghost" data-no>Keep going</button>`}
      </div>`;
    $('[data-no]', body).onclick = () => {
      close();
      if (fromPause) openPaused(rerender);
    };
    const discard = $('[data-discard]', body);
    if (discard) {
      discard.onclick = () => {
        close();
        discardWorkout();
        setWantAwake(false);
        toast('Workout discarded');
        location.hash = '#/train';
      };
      return;
    }
    $('[data-ok]', body).onclick = () => {
      close();
      saveAndSummarize();
    };
  });
}

/** Save the workout and open its summary. */
export function saveAndSummarize() {
  const id = finishWorkout();
  setWantAwake(false);
  location.hash = `#/summary/${encodeURIComponent(id)}`;
}

export const escHtml = esc;
