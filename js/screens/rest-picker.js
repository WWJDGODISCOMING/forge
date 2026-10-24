// Rest timer picker for one exercise (v0.16.65): an on/off switch plus two duration wheels (warm-up and
// working sets, 0:15 steps). Saved per exercise in settings/main.rest_prefs; it overrides the default rest.
import { state } from '../state.js';
import { patch } from '../db.js';
import { sheet } from '../ui.js';
import { haptics } from '../ui/haptic.js';
import { fmtClock, restDefaultSec } from '../workouts/session-core.js';
import { REST_WHEEL, restPref, withRestPref, snapRest } from '../workouts/restprefs.js';

const ROW = 44; // px, matches .rest-wheel li height

function wheelHtml(key, label, sec) {
  return `<div class="rest-col">
    <p class="label" id="rw-${key}">${label}</p>
    <div class="rest-wheel" data-wheel="${key}" role="listbox" tabindex="0" aria-labelledby="rw-${key}" data-value="${sec}">
      <ul>${REST_WHEEL.map((v) => `<li role="option" data-v="${v}" aria-selected="${v === sec}">${fmtClock(v)}</li>`).join('')}</ul>
    </div>
  </div>`;
}

/** Scroll-snap wheel: a haptic tick each time a new value passes the middle. */
function bindWheel(wheel) {
  const items = [...wheel.querySelectorAll('li')];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const at = (v) => Math.max(0, REST_WHEEL.indexOf(v));
  let idx = at(Number(wheel.dataset.value));
  const mark = () => items.forEach((li, n) => li.setAttribute('aria-selected', String(n === idx)));
  wheel.scrollTop = idx * ROW;
  wheel.addEventListener('scroll', () => {
    const n = Math.min(items.length - 1, Math.max(0, Math.round(wheel.scrollTop / ROW)));
    if (n === idx) return;
    idx = n;
    wheel.dataset.value = String(REST_WHEEL[n]);
    haptics.select();
    mark();
  }, { passive: true });
  items.forEach((li, n) => li.addEventListener('click', () => wheel.scrollTo({ top: n * ROW, behavior: reduce ? 'auto' : 'smooth' })));
  wheel.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    wheel.scrollTo({ top: Math.min(items.length - 1, Math.max(0, idx + d)) * ROW, behavior: 'auto' });
  });
}

export function openRestPicker(ex, { onSave = () => {} } = {}) {
  sheet(`${ex.name}: rest timer`, (body, close) => {
    const pref = restPref(state.settings, ex.id);
    const dflt = restDefaultSec(state.settings);
    const warm = (pref && pref.warm) || snapRest(Math.min(45, dflt));
    const work = (pref && pref.work) || snapRest(dflt);
    const on = !pref || pref.on;
    body.innerHTML = `
      <div class="stack rest-picker">
        <label class="rest-switch"><span>Rest timer</span><input type="checkbox" role="switch" data-on ${on ? 'checked' : ''}></label>
        <div class="rest-wheels" data-wheels ${on ? '' : 'hidden'}>
          ${wheelHtml('warm', 'Warm-up sets', warm)}
          ${wheelHtml('work', 'Working sets', work)}
        </div>
        <p class="small muted">Remembered for this exercise and used instead of your default rest.</p>
        <div class="row gap">
          <button class="btn ghost grow" data-reset ${pref ? '' : 'disabled'}>Use default</button>
          <button class="btn grow" data-save>Save</button>
        </div>
      </div>`;
    const sw = body.querySelector('[data-on]');
    const wheels = body.querySelector('[data-wheels]');
    const wheelEls = [...body.querySelectorAll('[data-wheel]')];
    const bind = () => wheelEls.forEach(bindWheel);
    // The wheels can only be positioned once visible.
    if (on) requestAnimationFrame(bind);
    let bound = on;
    sw.addEventListener('change', () => {
      haptics.select();
      wheels.hidden = !sw.checked;
      if (sw.checked && !bound) { bound = true; requestAnimationFrame(bind); }
    });
    const done = (next) => {
      patch('settings', 'main', { rest_prefs: withRestPref(state.settings, ex.id, next) });
      haptics.select();
      onSave();
      close();
    };
    body.querySelector('[data-reset]').onclick = () => done(null);
    body.querySelector('[data-save]').onclick = () => {
      const v = (k) => Number(body.querySelector(`[data-wheel="${k}"]`).dataset.value);
      done({ on: sw.checked, warm: v('warm'), work: v('work') });
    };
  });
}
