// A workout the phone kept running after Forge was closed (#254): ask what to do with it, never throw it away quietly.
import { sheet, esc } from '../ui.js';
import * as live from './live-workout.js';

let open = false;

/** Shows Keep / Discard when the phone holds a recovered workout with real data. Safe to call any number of times. */
export function askAboutStray() {
  const r = live.pendingStray();
  if (!r || open || live.isActive()) return;
  open = true;
  const mins = Math.max(1, Math.round((Number(r.elapsed) || 0) / 60000));
  sheet('Finish your workout?', (body, close) => {
    body.innerHTML = `
      <p class="muted">Forge was closed during a workout that’s still recorded on this iPhone (about ${esc(String(mins))} min). Keep it to finish and save it, or discard it.</p>
      <div class="row gap">
        <button class="btn ghost grow" data-drop>Discard</button>
        <button class="btn grow" data-keep>Keep it</button>
      </div>`;
    body.querySelector('[data-drop]').onclick = () => { open = false; close(); live.dropStray(); };
    body.querySelector('[data-keep]').onclick = () => { open = false; close(); if (live.adoptStray()) location.hash = '#/live'; };
  });
}
