// Default rest between sets (v0.16.38): a Settings row that opens a sheet of chips.
// Saved as settings/main.rest_default_sec (account-wide); a missing or odd value reads as 1:00 (restDefaultSec).
import { state } from '../state.js';
import { patch } from '../db.js';
import { sheet } from '../ui.js';
import { haptics } from '../ui/haptic.js';
import { REST_DEFAULT_CHOICES, restDefaultSec, fmtClock, restDefaultTitle } from '../workouts/session-core.js';

export { restDefaultTitle };

export function openRestDefault({ onSave = () => {} } = {}) {
  sheet('Rest between sets', (body, close) => {
    const cur = restDefaultSec(state.settings);
    body.innerHTML = `
      <div class="stack">
        <div class="chips chips--grid chips--grid-6" role="radiogroup" aria-label="Rest between sets">
          ${REST_DEFAULT_CHOICES.map((sec) => `<label class="chip"><input type="radio" name="restdef" value="${sec}" ${sec === cur ? 'checked' : ''}><span>${fmtClock(sec)}</span></label>`).join('')}
        </div>
        <p class="small muted">The timer starts after every set. An exercise with its own rest (set from its dots menu on the Train tab) keeps it.</p>
      </div>`;
    body.querySelectorAll('input[name=restdef]').forEach((r) => r.addEventListener('change', () => {
      haptics.select();
      patch('settings', 'main', { rest_default_sec: Number(r.value) });
      onSave();
      close();
    }));
  });
}
