// Exercise picker sheet, used for swap, add exercise, and Build my own.
import { sheet, esc, $ } from '../ui.js';
import { allExercises } from '../workouts/library.js';
import { EQUIPMENT_LABELS } from '../workouts/equipment.js';
import { icon } from '../ui/icons.js';

export const PATTERN_LABELS = {
  horizontal_push: 'Chest press / push-up', vertical_push: 'Overhead press', horizontal_pull: 'Row', vertical_pull: 'Pull-up / pulldown',
  squat: 'Squat', hinge: 'Hinge / deadlift', lunge: 'Lunge / split squat', knee_extension: 'Leg extension', knee_flexion: 'Leg curl',
  hip_thrust: 'Hip thrust / bridge', hip_abduction: 'Hip abduction', hip_adduction: 'Hip adduction', calf: 'Calves', biceps: 'Biceps',
  triceps: 'Triceps', lateral_raise: 'Lateral raise', rear_delt: 'Rear delts', chest_fly: 'Chest fly', shrug: 'Shrug',
  core_anti_extension: 'Core: plank / rollout', core_flexion: 'Core: crunch / raise', core_rotation: 'Core: rotation', core_lateral: 'Core: side',
  carry: 'Carry', plyometric: 'Jumps', conditioning: 'Conditioning / cardio', skill_handstand: 'Handstand skill', skill_lsit: 'L-sit skill', mobility: 'Mobility',
};

export function equipmentText(ex) {
  const opts = ex.equip.map((req) => (req.length ? req.map((k) => EQUIPMENT_LABELS[k] || k.replace(/^custom:/, '')).join(' + ') : 'No equipment'));
  return opts.join(' or ');
}

/**
 * opts: { title, filter(ex) → bool, onlyPattern, patterns, primary, onPick(ex), availableNote }
 * `patterns` (with Protect on) makes the default view list all of them, shared `primary` muscles first.
 */
export function openExercisePicker({ title = 'Choose an exercise', filter = () => true, onlyPattern = null, patterns = null, primary = [], onPick, availableNote = '' }) {
  let q = '';
  const SIMILAR = '__similar';
  let pattern = patterns && patterns.length > 1 ? SIMILAR : onlyPattern || '';
  sheet(title, (body, close) => {
    body.innerHTML = `
      <div class="stack">
        <input type="search" placeholder="Search exercises" aria-label="Search exercises" data-q>
        <select aria-label="Movement" data-pattern>
          ${patterns && patterns.length > 1 ? `<option value="${SIMILAR}" ${pattern === SIMILAR ? 'selected' : ''}>Similar, easy on your joints</option>` : ''}
          <option value="">All movements</option>
          ${Object.entries(PATTERN_LABELS).map(([k, l]) => `<option value="${k}" ${k === pattern ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        </select>
        ${availableNote ? `<p class="small muted">${esc(availableNote)}</p>` : ''}
        <ul class="list picker-list" data-list></ul>
      </div>`;
    const list = $('[data-list]', body);
    const shared = (e) => (pattern === SIMILAR ? (e.primary || []).filter((m) => primary.includes(m)).length : 0);
    const draw = () => {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const items = allExercises()
        .filter((e) => filter(e) && (!pattern || (pattern === SIMILAR ? patterns.includes(e.pattern) : e.pattern === pattern)) && words.every((w) => e.name.toLowerCase().includes(w)))
        .sort((a, b) => shared(b) - shared(a) || a.name.localeCompare(b.name))
        .slice(0, 80);
      list.innerHTML = items.length
        ? items.map((e) => `
          <li class="tap" data-id="${esc(e.id)}">
            <div><b>${esc(e.name)}</b><small class="muted">${esc(equipmentText(e))}${e.custom ? ' · custom' : ''}</small></div>
            <span class="chev" aria-hidden="true">${icon('chev')}</span>
          </li>`).join('')
        : '<li class="muted">Nothing matches here.</li>';
    };
    draw();
    $('[data-q]', body).addEventListener('input', (e) => {
      q = e.target.value;
      draw();
    });
    $('[data-pattern]', body).addEventListener('change', (e) => {
      pattern = e.target.value;
      draw();
    });
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[data-id]');
      if (!li) return;
      const ex = allExercises().find((x) => x.id === li.dataset.id);
      close();
      onPick(ex);
    });
  });
}
