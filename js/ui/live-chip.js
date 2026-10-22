// A running live workout must never be invisible: once it is minimised, the Train tile and a slim pill on Today say
// "● Live 12:34" (or "Paused") and reopen it. Text is pure (liveChipText); bindLiveChips keeps the labels ticking.
import * as live from '../native/live-workout.js';
import { activeMs, isPaused, fmtElapsed } from '../workouts/live-core.js';

/** "● Live 12:34" | "Paused" | null when nothing is running. */
export function liveChipText(s, now = Date.now()) {
  if (!s || s.ended_at) return null;
  return isPaused(s) ? 'Paused' : `● Live ${fmtElapsed(activeMs(s, now))}`;
}

/** The text for right now (also picks up a workout left running from a reload). */
export function currentChipText() { live.restore(); return liveChipText(live.current()); }

/** Slim "resume" pill for the top of Today; '' when nothing is running. */
export function livePillHtml() {
  const t = currentChipText();
  return t ? `<a class="live-pill" href="#/live" data-live-pill aria-label="Workout in progress. Open it"><span data-live-label data-idle="Workout in progress">${t}</span><span aria-hidden="true">· Open</span></a>` : '';
}

/** Keep every [data-live-label] under `el` current. Stops itself when the labels leave the page. */
export function bindLiveChips(el) {
  const nodes = [...el.querySelectorAll('[data-live-label]')];
  if (!nodes.length) return;
  const update = () => {
    const t = liveChipText(live.current());
    for (const n of nodes) {
      const text = t || n.dataset.idle;
      if (n.textContent !== text) n.textContent = text;
      n.closest('.tool')?.classList.toggle('live-on', !!t);
    }
  };
  update();
  const id = setInterval(() => { if (!nodes[0].isConnected) clearInterval(id); else update(); }, 1000);
}
