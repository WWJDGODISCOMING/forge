// Focus areas chips (max 3, or None). Used by the Train hub sheet and onboarding/profile.
import { esc, $$ } from '../ui.js';
import { FOCUS_GROUPS, FOCUS_KEYS, MAX_FOCUS, FOCUS_NOTE, cleanFocus } from '../workouts/focus.js';

export function focusChipsHtml(selected) {
  const sel = cleanFocus(selected);
  return `
    <div class="chips focus-chips" role="group" aria-label="Focus areas">
      ${FOCUS_KEYS.map((k) => `<label class="chip"><input type="checkbox" name="focus" value="${k}" ${sel.includes(k) ? 'checked' : ''}><span>${esc(FOCUS_GROUPS[k].label)}</span></label>`).join('')}
      <label class="chip"><input type="checkbox" name="focus-none" ${sel.length ? '' : 'checked'}><span>None</span></label>
    </div>
    <p class="small muted focus-note">Pick up to ${MAX_FOCUS}. ${esc(FOCUS_NOTE)}</p>`;
}

/** Keeps the max-3 and None rules. onChange(list) fires after each tap. Returns a getter for the current list. */
export function bindFocusChips(root, onChange = () => {}) {
  const boxes = () => $$('input[name=focus]', root);
  const none = root.querySelector('input[name=focus-none]');
  const read = () => boxes().filter((b) => b.checked).map((b) => b.value);
  const sync = () => {
    const n = read().length;
    none.checked = n === 0;
    boxes().forEach((b) => { b.disabled = !b.checked && n >= MAX_FOCUS; });
  };
  boxes().forEach((b) => b.addEventListener('change', () => { sync(); onChange(read()); }));
  none.addEventListener('change', () => {
    boxes().forEach((b) => { b.checked = false; });
    sync();
    onChange([]);
  });
  sync();
  return read;
}
