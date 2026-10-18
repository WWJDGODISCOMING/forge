// Food preferences (v0.16.21): the rules the meal plan follows. Saved to profile.meal_prefs. It never asks for calories or protein:
// the plan uses the goal you already have. Opened from Settings and from the Plan tab.
import { state } from '../state.js';
import { patch } from '../db.js';
import { esc, $, $$, sheet, toast } from '../ui.js';
import { haptics } from '../ui/haptic.js';
import { cleanPrefs, parseAvoid, DIETS, COOKING, MAX_AVOID } from '../food/meal-plan.js';

export const mealPrefs = () => cleanPrefs(state.profile && state.profile.meal_prefs);

const LEFTOVER_CHIP = { freeze: 'Freeze right away', normal: 'Normal' };
const radio = (name, value, label, on) => `<label><input type="radio" name="${name}" value="${value}" ${on ? 'checked' : ''}><span>${esc(label)}</span></label>`;
const chipRadio = (name, value, label, on) => `<label class="chip">${radio(name, value, label, on).slice('<label>'.length)}`;

/** One-line summary for the Settings row. */
export function prefsSummary(prefs = mealPrefs()) {
  const bits = prefs.diets.map((d) => DIETS.find((x) => x[0] === d)[1]);
  if (prefs.avoid.length) bits.push(`avoiding ${prefs.avoid.length}`);
  return bits.length ? bits.join(' · ') : 'Diet, foods to skip, how you cook';
}

export function openFoodPrefs({ onSave = () => {} } = {}) {
  sheet('Food preferences', (body, close) => {
    const p = mealPrefs();
    body.innerHTML = `
      <form class="stack food-prefs" novalidate>
        <p class="small muted">Your meal plan follows these. It uses the calorie and protein goal you already have.</p>
        <p class="sec-title">Diet</p>
        <div class="chips" role="group" aria-label="Diet">${DIETS.map(([k, l]) => `<label class="chip"><input type="checkbox" name="diet" value="${k}" ${p.diets.includes(k) ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>
        <p class="sec-title">Foods to skip</p>
        <label class="field"><span>Separate with commas</span><input name="avoid" maxlength="400" value="${esc(p.avoid.join(', '))}" autocomplete="off" autocapitalize="off" placeholder="tomatoes, mushrooms, spicy" aria-describedby="avoid-note"></label>
        <p class="small muted" id="avoid-note">Up to ${MAX_AVOID}. Plans leave out any recipe that has them.</p>
        <p class="sec-title">Leftovers</p>
        <div class="chips" role="radiogroup" aria-label="Leftovers">${Object.entries(LEFTOVER_CHIP).map(([k, l]) => chipRadio('leftovers', k, l, p.leftovers === k)).join('')}</div>
        <p class="small muted">Freeze right away means extra portions go to the freezer the same day, never the fridge.</p>
        <p class="sec-title">Cooking style</p>
        <div class="chips" role="radiogroup" aria-label="Cooking style">${Object.entries(COOKING).map(([k, l]) => chipRadio('cooking', k, l, p.cooking === k)).join('')}</div>
        <p class="sec-title">Snacks a day</p>
        <div class="seg small" role="radiogroup" aria-label="Snacks a day">${[0, 1, 2].map((n) => radio('snacks', n, String(n), p.snacks === n)).join('')}</div>
        <p class="small muted">Always 3 meals, plus the snacks you pick.</p>
        <button class="btn" type="submit">Save</button>
      </form>`;
    const f = $('form', body);
    f.addEventListener('change', () => haptics.select());
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const next = {
        ...p,
        diets: $$('input[name=diet]:checked', f).map((b) => b.value),
        avoid: parseAvoid(f.avoid.value),
        leftovers: f.leftovers.value,
        cooking: f.cooking.value,
        snacks: Number(f.snacks.value),
      };
      if (state.profile) patch('profile', 'main', { meal_prefs: cleanPrefs(next) });
      haptics.success();
      close();
      toast('Saved');
      onSave();
    });
  });
}
