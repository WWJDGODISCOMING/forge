// Recommend more / less: the small control (workout summary, History sheet) and the Settings list.
// Saved as settings/main.exercise_prefs ({ id: 'more' | 'less' }); the pure half is workouts/prefs.js.
import { state } from '../state.js';
import { patch } from '../db.js';
import { esc, $, $$, sheet, toast, confirmSheet } from '../ui.js';
import { icon } from '../ui/icons.js';
import { haptics } from '../ui/haptic.js';
import { exerciseById } from '../workouts/library.js';
import { cleanPrefs, prefOf, setPref, prefAria, prefRows, prefSummary, PREF_LABELS } from '../workouts/prefs.js';

export { prefSummary };

/** The saved map, repaired. */
export const currentPrefs = () => cleanPrefs(state.settings && state.settings.exercise_prefs);

/** Saves the whole map (updateDoc replaces the field, so a cleared entry really goes). Shown at once; the live listener confirms. */
export function savePrefs(next) {
  if (state.settings) state.settings.exercise_prefs = next;
  patch('settings', 'main', { exercise_prefs: next });
}

/** Two toggle buttons: Recommend more, Recommend less. Neither pressed = no preference. */
export function prefControlHtml(ex) {
  const cur = prefOf(currentPrefs(), ex.id);
  const btn = (v) => `<button type="button" class="xpref-b" data-pref="${v}" aria-pressed="${cur === v}">${icon(v === 'more' ? 'arrowup' : 'arrowdown', { size: 16 })}<span>${PREF_LABELS[v]}</span></button>`;
  return `<div class="xpref" role="group" aria-label="${esc(ex.name)}: how often to suggest it" data-xpref="${esc(ex.id)}" data-xpref-name="${esc(ex.name)}">${btn('more')}${btn('less')}<span class="sr-only" aria-live="polite" data-xpref-say>${esc(prefAria(ex.name, cur))}</span></div>`;
}

/** Wires every control under root. onChange(id, value) fires after the save ('' = cleared). */
export function bindPrefControls(root, onChange = () => {}) {
  $$('.xpref', root).forEach((group) => {
    const id = group.dataset.xpref;
    const name = group.dataset.xprefName;
    $$('[data-pref]', group).forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation(); // never also trigger a row-level handler
      const next = setPref(currentPrefs(), id, b.dataset.pref);
      const value = prefOf(next, id);
      savePrefs(next);
      haptics.select();
      $$('[data-pref]', group).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.pref === value)));
      $('[data-xpref-say]', group).textContent = prefAria(name, value);
      onChange(id, value);
    }));
  });
}

const nameOf = (id) => { const ex = exerciseById(id); return ex ? ex.name : ''; };

/** Settings → Exercise preferences: see every More / Less and reset one or all. */
export function openExercisePrefs({ onSave = () => {} } = {}) {
  sheet('Exercise preferences', (body, close) => {
    const draw = () => {
      const rows = prefRows(currentPrefs(), nameOf);
      body.innerHTML = rows.length ? `
        <div class="stack">
          <p class="small muted">“More” moves come up more often in your workouts. “Less” moves come up rarely, and still show up when nothing else fits. Set them on the workout summary or an exercise’s History.</p>
          <ul class="list xpref-list" role="list">
            ${rows.map((r) => `<li><div class="grow"><b>${esc(r.name)}</b><small class="muted">${r.value === 'more' ? 'Recommend more' : 'Recommend less'}</small></div><button type="button" class="btn ghost xpref-reset" data-reset="${esc(r.id)}" aria-label="Reset ${esc(r.name)}">Reset</button></li>`).join('')}
          </ul>
          <button type="button" class="btn ghost" data-reset-all>Reset all</button>
        </div>` : '<div class="stack"><p class="muted">Nothing set. After a workout, tap Recommend more or Recommend less under an exercise, and it shows up here.</p></div>';
      $$('[data-reset]', body).forEach((b) => { b.onclick = () => { haptics.light(); savePrefs(setPref(currentPrefs(), b.dataset.reset, '')); toast('Back to normal'); onSave(); draw(); }; });
      const all = $('[data-reset-all]', body);
      if (all) all.onclick = async () => {
        if (!(await confirmSheet({ title: 'Reset all preferences?', message: 'Every exercise goes back to neither more nor less.', confirmLabel: 'Reset all' }))) return;
        savePrefs({});
        toast('All reset');
        onSave();
        close();
      };
    };
    draw();
  });
}
