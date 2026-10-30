// "+ Log a workout" (#253): one sheet for any hand-logged session, with a real start time and an optional
// Apple Health save. Saved as a cardio_sessions row (see js/health/manual-workout.js for why).
import { sheet, esc, $, toast, todayKey } from '../ui.js';
import { put, newRecord } from '../db.js';
import { unit } from '../workouts/plan.js';
import { CARDIO_TYPES, NO_DISTANCE } from '../cardio-types.js';
import { validateManual } from '../health/manual-workout.js';
import { haptics } from '../ui/haptic.js';

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** prefill: { activity, duration_min, notes }. With a duration, the start defaults to that long ago. */
export function openLogWorkout(prefill = {}) {
  const dist = unit() === 'kg' ? 'km' : 'mi';
  const now = new Date();
  const start = new Date(now.getTime() - (Number(prefill.duration_min) || 0) * 60000);
  const act = prefill.activity || 'strength';
  sheet('Log a workout', (body, close) => {
    body.innerHTML = `
      <form class="stack log-workout" novalidate>
        <label class="field"><span>Type</span>
          <select name="activity">${Object.entries(CARDIO_TYPES).map(([k, l]) => `<option value="${k}" ${act === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        </label>
        <label class="field" data-name-field ${act === 'other' ? '' : 'hidden'}><span>Name</span><input name="name" maxlength="40" placeholder="Yoga, climbing, hike…"></label>
        <div class="row gap wrap2">
          <label class="field grow"><span>Date</span><input name="day" type="date" value="${todayKey()}" max="${todayKey()}"></label>
          <label class="field grow"><span>Start time</span><input name="time" type="time" value="${hhmm(start)}"></label>
        </div>
        <label class="field"><span>Minutes</span><input name="min" type="number" inputmode="numeric" min="1" max="600" value="${prefill.duration_min || ''}"></label>
        <div class="row gap wrap2">
          <label class="field grow"><span>Calories <small class="muted">optional</small></span><input name="kcal" type="number" inputmode="numeric" min="0" max="5000"></label>
          <label class="field grow"><span>Avg heart rate <small class="muted">optional</small></span><input name="hr" type="number" inputmode="numeric" min="30" max="230"></label>
        </div>
        <label class="field" data-dist-field ${NO_DISTANCE.includes(act) ? 'hidden' : ''}><span>Distance (${dist}) <small class="muted">optional</small></span><input name="dist" type="number" inputmode="decimal" step="0.01" min="0"></label>
        <label class="field"><span>Notes <small class="muted">optional</small></span><input name="notes" value="${esc(prefill.notes || '')}" maxlength="200"></label>
        <label class="check-row" data-health-field hidden><input type="checkbox" name="health"><span>Also save to Apple Health</span></label>
        <p class="small muted">Apple Watch workouts are added automatically. If one matches this entry, Forge offers to keep the Watch data instead.</p>
        <p class="error" aria-live="polite"></p>
        <button class="btn" type="submit">Save workout</button>
      </form>`;
    const form = $('form', body);
    const sync = () => {
      $('[data-name-field]', body).hidden = form.activity.value !== 'other';
      $('[data-dist-field]', body).hidden = NO_DISTANCE.includes(form.activity.value);
    };
    form.activity.addEventListener('change', sync);
    sync();
    import('../native/bridge.js').then((b) => { if (b.isNative() && b.plugin('ForgeWorkouts')) $('[data-health-field]', body).hidden = false; }).catch(() => {});
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = validateManual({
        activity: form.activity.value, name: form.name.value, day: form.day.value || todayKey(), time: form.time.value,
        min: form.min.value, kcal: form.kcal.value, dist: form.dist.value, hr: form.hr.value, notes: form.notes.value,
      }, { distUnit: dist });
      if (!v.ok) { $('.error', body).textContent = v.error; haptics.warning && haptics.warning(); return; }
      const row = newRecord(v.fields);
      put('cardio_sessions', row);
      haptics.success();
      const toHealth = form.health.checked && !$('[data-health-field]', body).hidden;
      close();
      if (!toHealth) { toast('Workout saved'); return; }
      const { sendManual } = await import('../native/workouts-health.js');
      const r = await sendManual(row);
      toast(r === 'saved' ? 'Saved to Forge and Apple Health' : r === 'denied' ? 'Saved to Forge. Allow Workouts in Settings → Health → Data Access to send it to Health.' : 'Saved to Forge. It couldn’t reach Apple Health.', 5000);
    });
  });
}
