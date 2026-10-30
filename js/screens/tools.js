// Plate calculator and cardio log sheets.
import { sheet, $, $$ } from '../ui.js';
import { platesPerSide, barWeight } from '../workouts/progression.js';
import { unit } from '../workouts/plan.js';
import { CARDIO_TYPES, NO_DISTANCE } from '../cardio-types.js';
import { openLogWorkout } from './log-workout.js';

export function openPlateCalculator(startWeight) {
  const u = unit();
  sheet('Plate calculator', (body) => {
    body.innerHTML = `
      <div class="stack">
        <label class="field big-input"><span>Total weight (${u})</span>
          <input type="number" inputmode="decimal" step="${u === 'kg' ? 1.25 : 2.5}" value="${startWeight || ''}" data-total placeholder="${u === 'kg' ? 60 : 135}"></label>
        <fieldset class="field"><legend>Bar</legend>
          <div class="seg">
            ${(u === 'kg' ? [20, 15, 10] : [45, 35, 25]).map((b, i) => `<label><input type="radio" name="bar" value="${b}" ${i === 0 ? 'checked' : ''}><span>${b} ${u}</span></label>`).join('')}
          </div>
        </fieldset>
        <div class="plates" data-out aria-live="polite"></div>
      </div>`;
    const draw = () => {
      const total = Number($('[data-total]', body).value);
      const bar = Number($('input[name=bar]:checked', body).value) || barWeight(u);
      const out = $('[data-out]', body);
      if (!total) {
        out.innerHTML = '<p class="muted">Enter a total to see plates for each side.</p>';
        return;
      }
      if (total < bar) {
        out.innerHTML = `<p class="muted">That’s less than the bar (${bar} ${u}).</p>`;
        return;
      }
      const r = platesPerSide(total, u, bar);
      out.innerHTML = `
        <p class="label">Each side</p>
        <div class="plate-row">${r.plates.length ? r.plates.map((p) => `<span class="plate p${String(p).replace('.', '_')}">${p}</span>`).join('') : '<span class="muted">Just the bar</span>'}</div>
        ${r.remainder ? `<p class="small warn">${r.remainder} ${u} can’t be loaded with standard plates. Closest: ${total - r.remainder} ${u}.</p>` : ''}`;
    };
    $('[data-total]', body).addEventListener('input', draw);
    $$('input[name=bar]', body).forEach((r) => r.addEventListener('change', draw));
    draw();
  });
}

export { CARDIO_TYPES, NO_DISTANCE, openLogWorkout };

/** The old Log cardio entry points (timer, quick log) open the same sheet as + Log a workout (#253). */
export function openCardioLog(prefill = {}) {
  return openLogWorkout({ ...prefill, activity: prefill.activity || 'run' });
}

