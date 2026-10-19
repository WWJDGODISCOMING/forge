// Protein goal (v0.16.37): Auto (2.0 g/kg style, from your profile) or your own number. Saved as profile.proteinGoalG; no field means Auto.
// Everything that shows a protein target reads currentTargets() (js/derived.js), so a change here shows up everywhere at once.
import { state } from '../state.js';
import { patch, unsetField } from '../db.js';
import { $, sheet, toast } from '../ui.js';
import { icon } from '../ui/icons.js';
import { haptics } from '../ui/haptic.js';
import { computeTargets, GOALS, customProteinG, stepProtein, parseProteinInput, startProteinG, PROTEIN_GOAL_MIN_G as MIN, PROTEIN_GOAL_MAX_G as MAX } from '../nutrition/targets.js';
import { currentWeightKg } from '../derived.js';

const STEP_BTN = 'min-width:48px;min-height:48px;padding:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--accent);color:var(--accent-ink);border:2px solid var(--accent)';

function autoProtein() {
  const p = state.profile;
  if (!p) return null;
  const kg = currentWeightKg() || p.weightKg;
  const t = computeTargets({ ...p, weightKg: kg });
  return { g: t.proteinG, perKg: GOALS[p.goal] ? GOALS[p.goal].proteinPerKg : null, fatG: t.fatG, calories: t.calories };
}

/** One-line summary for the Settings row. */
export function proteinSummary() {
  const c = customProteinG(state.profile);
  if (c !== null) return `Protein ${c} g (custom)`;
  const a = autoProtein();
  return a ? `Protein ${a.g} g (auto)` : 'Protein goal';
}

export function openProteinGoal({ onSave = () => {} } = {}) {
  const a = autoProtein();
  if (!a) return;
  sheet('Protein goal', (body, close) => {
    let custom = customProteinG(state.profile) !== null;
    let g = customProteinG(state.profile) ?? startProteinG(a.g);
    body.innerHTML = `
      <div class="stack protein-goal">
        <div class="seg small" role="radiogroup" aria-label="Protein goal mode">
          <label><input type="radio" name="pmode" value="auto"><span>Auto</span></label>
          <label><input type="radio" name="pmode" value="custom"><span>Custom</span></label>
        </div>
        <p class="small muted">Auto: ${a.g} g${a.perKg ? `, ${a.perKg.toFixed(1)} g/kg` : ''}</p>
        <div class="row" data-custom style="justify-content:center;gap:12px;align-items:center">
          <button type="button" class="icon-btn" data-dec aria-label="Down 5 grams" style="${STEP_BTN}">${icon('minus')}</button>
          <label class="field" style="margin:0;display:flex;align-items:baseline;justify-content:center;gap:6px;white-space:nowrap"><input data-g inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" style="text-align:center;min-height:44px;width:3.2em;font-size:2em;font-weight:700"><b class="muted" style="font-size:1.2em">g</b></label>
          <button type="button" class="icon-btn" data-inc aria-label="Up 5 grams" style="${STEP_BTN}">${icon('plus')}</button>
        </div>
        <p class="small muted" data-carbs></p>
        <p class="small muted" data-note>Between ${MIN} and ${MAX} g. Carbs adjust to fit your calories.</p>
        <button class="btn" type="button" data-save>Save</button>
      </div>`;
    const box = $('[data-custom]', body), input = $('[data-g]', body), dec = $('[data-dec]', body), inc = $('[data-inc]', body);
    let typing = false; // a typed value stays on screen until it is valid, so Save can check what was really typed
    const paint = () => {
      body.querySelector(`input[name=pmode][value=${custom ? 'custom' : 'auto'}]`).checked = true;
      box.hidden = !custom;
      if (document.activeElement !== input || !typing) input.value = String(g);
      const carbs = $('[data-carbs]', body);
      carbs.hidden = !custom;
      carbs.textContent = `Carbs become ${Math.max(0, Math.round((a.calories - g * 4 - a.fatG * 9) / 4))} g`;
      input.setAttribute('aria-label', `Protein goal, ${g} grams, ${custom ? 'custom' : 'auto'}`);
      dec.setAttribute('aria-label', 'Down 5 grams');
      inc.setAttribute('aria-label', 'Up 5 grams');
      dec.disabled = g <= MIN;
      inc.disabled = g >= MAX;
    };
    body.addEventListener('change', (e) => {
      if (e.target.name !== 'pmode') return;
      custom = e.target.value === 'custom';
      haptics.select();
      paint();
    });
    dec.onclick = () => { typing = false; g = stepProtein(g, -1); haptics.select(); paint(); };
    inc.onclick = () => { typing = false; g = stepProtein(g, 1); haptics.select(); paint(); };
    input.addEventListener('input', () => { typing = true; });
    input.addEventListener('change', () => {
      const v = parseProteinInput(input.value);
      if (v === null) toast(`Pick a number from ${MIN} to ${MAX}`);
      else { g = v; typing = false; paint(); }
    });
    $('[data-save]', body).onclick = () => {
      if (custom) {
        const v = parseProteinInput(input.value);
        if (v === null) { toast(`Pick a number from ${MIN} to ${MAX}`); return; }
        patch('profile', 'main', { proteinGoalG: v });
      } else if (state.profile && 'proteinGoalG' in state.profile) {
        unsetField('profile', 'main', 'proteinGoalG');
      }
      haptics.success();
      close();
      toast('Saved');
      onSave();
    };
    paint();
  });
}
