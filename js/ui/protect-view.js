// Joints to protect (v0.16.40), the pure half: copy and markup for the Knees / Lower back switches (no database, so tests can import it).
import { jointAvoidSet } from '../workouts/generator.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const SAFETY_LINE = 'If pain is sharp, swelling, or lasts more than 1–2 weeks, see a doctor.';

const JOINTS = [
  { key: 'knee', label: 'Knees', aria: 'Protect knees' },
  { key: 'lower_back', label: 'Lower back', aria: 'Protect lower back' },
];

/** The saved joints, in a fixed order, unknown values dropped. */
export function protectedJoints(profile = {}) {
  const set = jointAvoidSet(profile);
  return JOINTS.map((j) => j.key).filter((k) => set.has(k));
}

/** "Knees, Lower back" or "Off". */
export function protectSummary(profile = {}) {
  const on = protectedJoints(profile);
  return on.length ? JOINTS.filter((j) => on.includes(j.key)).map((j) => j.label).join(', ') : 'Off';
}

/** Two switch pills (44 pt tall, wrap on large text). */
export function protectPillsHtml(profile = {}) {
  const on = protectedJoints(profile);
  return `<div class="protect-pills" role="group" aria-label="Joints to protect">
    ${JOINTS.map((j) => `<button type="button" class="protect-pill" role="switch" aria-checked="${on.includes(j.key)}" aria-label="${esc(j.aria)}" data-protect="${j.key}"><span>${esc(j.label)}</span></button>`).join('')}
  </div>`;
}

/** Train's compact row, sits right above Start workout. */
export function protectRowHtml(profile = {}) {
  return `<div class="protect-row">
    <div class="protect-head"><span class="label">Protect</span>${protectPillsHtml(profile)}</div>
    <p class="small muted protect-note">${esc(SAFETY_LINE)}</p>
  </div>`;
}

