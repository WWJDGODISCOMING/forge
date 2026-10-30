// A workout the phone kept running after Forge was closed (#254): ask what to do with it, never throw it away quietly.
import { sheet, esc } from '../ui.js';
import * as live from './live-workout.js';

const isOpen = () => !!document.querySelector('[data-stray-sheet]'); // a sheet dismissed by its backdrop leaves nothing behind to reset

/** The Keep / Discard sheet for a recovered workout `r` (needs .elapsed). `act` = { keep(), drop() }. Discard asks once more. */
export function openStraySheet(r, act) {
  const mins = Math.max(1, Math.round((Number(r.elapsed) || 0) / 60000));
  sheet('Finish your workout?', (body, close) => {
    const focusSoon = (q) => setTimeout(() => body.querySelector(q)?.focus({ preventScroll: true }), 60); // after the sheet is open
    const home = () => {
      body.innerHTML = `
        <div data-stray-sheet>
          <p class="muted">Forge was closed during a workout that’s still recorded on this iPhone (about ${esc(String(mins))} min). Keep it to finish and save it, or discard it.</p>
          <div class="row gap">
            <button class="btn ghost grow" data-drop>Discard</button>
            <button class="btn grow" data-keep>Keep it</button>
          </div>
        </div>`;
      body.querySelector('[data-keep]').onclick = () => { close(); act.keep(); };
      body.querySelector('[data-drop]').onclick = confirmDrop;
      focusSoon('[data-keep]'); // Keep is the first, safe choice
    };
    const confirmDrop = () => {
      body.innerHTML = `
        <div data-stray-sheet>
          <p class="muted" data-stray-confirm>Discard this ${esc(String(mins))}-min workout? It won’t be saved to Forge or Apple Health.</p>
          <div class="row gap">
            <button class="btn ghost grow" data-back>Go back</button>
            <button class="btn grow danger" data-drop-yes>Discard</button>
          </div>
        </div>`;
      body.querySelector('[data-back]').onclick = home;
      body.querySelector('[data-drop-yes]').onclick = () => { close(); act.drop(); };
      focusSoon('[data-back]');
    };
    home();
  });
}

/** Shows Keep / Discard when the phone holds a recovered workout with real data. Safe to call any number of times. */
export function askAboutStray() {
  const r = live.pendingStray();
  if (!r || isOpen() || live.isActive()) return;
  openStraySheet(r, { keep: () => { if (live.adoptStray()) location.hash = '#/live'; }, drop: () => { live.dropStray(); } });
}
