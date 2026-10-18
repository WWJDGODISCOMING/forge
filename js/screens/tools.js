// Plate calculator and cardio log sheets.
import { sheet, esc, $, $$, toast, todayKey } from '../ui.js';
import { put, newRecord } from '../db.js';
import { platesPerSide, barWeight } from '../workouts/progression.js';
import { unit } from '../workouts/plan.js';

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

/** Activities that have no distance, so the sheet hides the field and saves none. */
export const NO_DISTANCE = ['jog_in_place'];

export const CARDIO_TYPES = {
  peloton: 'Peloton ride', bike: 'Bike (other)', run: 'Run', jog_in_place: 'Jog in place', walk: 'Walk', row: 'Row', elliptical: 'Elliptical', stairs: 'Stair climber',
  boxing: 'Boxing / shadowboxing', hiit: 'HIIT / intervals', jump_rope: 'Jump rope', swim: 'Swim', other: 'Other',
};

/** prefill: { activity, duration_min, notes } */
export function openCardioLog(prefill = {}) {
  const u = unit();
  const dist = u === 'kg' ? 'km' : 'mi';
  sheet('Log cardio', (body, close) => {
    body.innerHTML = `
      <form class="stack" novalidate>
        <label class="field"><span>Activity</span>
          <select name="activity">${Object.entries(CARDIO_TYPES).map(([k, l]) => `<option value="${k}" ${prefill.activity === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        </label>
        <div class="row gap">
          <label class="field grow"><span>Minutes</span><input name="min" type="number" inputmode="decimal" min="1" value="${prefill.duration_min || ''}"></label>
          <label class="field grow"><span>Date</span><input name="day" type="date" value="${todayKey()}" max="${todayKey()}"></label>
        </div>
        <div class="row gap">
          <label class="field grow" data-dist-field ${NO_DISTANCE.includes(prefill.activity) ? 'hidden' : ''}><span>Distance (${dist}) <small class="muted">optional</small></span><input name="dist" type="number" inputmode="decimal" step="0.01"></label>
          <label class="field grow"><span>Calories <small class="muted">optional</small></span><input name="kcal" type="number" inputmode="numeric"></label>
        </div>
        <label class="field"><span>Avg heart rate <small class="muted">optional</small></span><input name="hr" type="number" inputmode="numeric"></label>
        <label class="field"><span>Notes <small class="muted">optional</small></span><input name="notes" value="${esc(prefill.notes || '')}" maxlength="200"></label>
        <p class="small muted">Typed in by you. Apple Health and Strava imports come in Phase 2.</p>
        <p class="error" aria-live="polite"></p>
        <button class="btn" type="submit">Save</button>
      </form>`;
    const form = $('form', body);
    const distField = $('[data-dist-field]', body);
    form.activity.addEventListener('change', () => { distField.hidden = NO_DISTANCE.includes(form.activity.value); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const min = Number(form.min.value);
      if (!min || min <= 0) {
        $('.error', body).textContent = 'Enter how many minutes.';
        return;
      }
      const day = form.day.value || todayKey();
      const started = day === todayKey() ? new Date(Date.now() - min * 60000) : new Date(day + 'T12:00:00');
      const km = form.dist.value && !NO_DISTANCE.includes(form.activity.value) ? Number(form.dist.value) * (dist === 'mi' ? 1.609344 : 1) : null;
      put('cardio_sessions', newRecord({
        activity: form.activity.value,
        started_at: started.toISOString(),
        day,
        duration_min: min,
        distance_km: km,
        calories: form.kcal.value ? Number(form.kcal.value) : null,
        avg_hr: form.hr.value ? Number(form.hr.value) : null,
        notes: form.notes.value.trim(),
      }));
      close();
      toast('Cardio saved');
    });
  });
}
