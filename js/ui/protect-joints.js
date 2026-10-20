// Joints to protect (v0.16.40): saving and wiring for the Knees / Lower back switches shared by Train and Settings.
// One value, profile.protectJoints (e.g. ['knee']); no field means off. Copy and markup live in protect-view.js.
import { state } from '../state.js';
import { patch, unsetField } from '../db.js';
import { $$ } from '../ui.js';
import { haptics } from './haptic.js';
export { SAFETY_LINE } from './protect-view.js';
import { protectSummary as summary, protectRowHtml as rowHtml, protectPillsHtml as pillsHtml } from './protect-view.js';

export const protectSummary = () => summary(state.profile);
export const protectRowHtml = () => rowHtml(state.profile);
export const protectPillsHtml = () => pillsHtml(state.profile);

const KEYS = ['knee', 'lower_back'];

/** Saves the list (field left out when empty). */
export function setProtectJoints(list) {
  const clean = KEYS.filter((k) => list.includes(k));
  if (state.profile) { // show it now; the live profile listener confirms a moment later
    if (clean.length) state.profile.protectJoints = clean;
    else delete state.profile.protectJoints;
  }
  if (clean.length) patch('profile', 'main', { protectJoints: clean });
  else unsetField('profile', 'main', 'protectJoints');
}

/** Wires every pill under root. onChange(list) fires after the save. */
export function bindProtect(root, onChange = () => {}) {
  $$('[data-protect]', root).forEach((b) => {
    b.addEventListener('click', () => {
      // Read the pills, not state.profile: the profile only catches up after the save round-trips.
      b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true'));
      const list = $$('[data-protect]', root).filter((x) => x.getAttribute('aria-checked') === 'true').map((x) => x.dataset.protect);
      haptics.select();
      setProtectJoints(list);
      onChange(list);
    });
  });
}
