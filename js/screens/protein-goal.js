// Protein goal (v0.16.37): Auto (2.0 g/kg style, from your profile) or your own number. Saved as profile.proteinGoalG; no field means Auto.
// Everything that shows a protein target reads currentTargets() (js/derived.js), so a change here shows up everywhere at once.
import { state } from '../state.js';
import { patch, unsetField } from '../db.js';
import { $, sheet, toast } from '../ui.js';
import { haptics } from '../ui/haptic.js';
import { computeTargets, customProteinG, stepProtein, parseProteinInput, startProteinG, PROTEIN_GOAL_MIN_G as MIN, PROTEIN_GOAL_MAX_G as MAX } from '../nutrition/targets.js';
import { currentWeightKg } from '../derived.js';

function autoProtein() {
  const p = state.profile;
  if (!p) return null;
  const kg = currentWeightKg() || p.weightKg;
  const t = computeTargets({ ...p, weightKg: kg });
  return { g: t.proteinG, perKg: kg ? Math.round((t.proteinG / kg) * 10) / 10 : null };
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
          <button type="button" class="icon-btn" data-dec style="min-width:44px;min-height:44px">−</button>
          <label class="field" style="margin:0;text-align:center"><input data-g inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" style="text-align:center;min-height:44px;width:5.5em;font-size:1.4em"> <small class="muted">g</small></label>
          <button type="button" class="icon-btn" data-inc style="min-width:44px;min-height:44px">+</button>
        </div>
        <p class="small muted" data-note>Between ${MIN} and ${MAX} g. Carbs adjust to fit your calories.</p>
        <button class="btn" type="button" data-save>Save</button>
      </div>`;
    const box = $('[data-custom]', body), input = $('[data-g]', body), dec = $('[data-dec]', body), inc = $('[data-inc]', body);
    const paint = () => {
      body.querySelector(`input[name=pmode][value=${custom ? 'custom' : 'auto'}]`).checked = true;
      box.hidden = !custom;
      input.value = String(g);
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
    dec.onclick = () => { g = stepProtein(g, -1); haptics.select(); paint(); };
    inc.onclick = () => { g = stepProtein(g, 1); haptics.select(); paint(); };
    input.addEventListener('change', () => {
      const v = parseProteinInput(input.value);
      if (v === null) toast(`Pick a number from ${MIN} to ${MAX}`);
      else g = v;
      paint();
    });
    $('[data-save]', body).onclick = () => {
      if (custom) {
        const v = parseProteinInput(input.value);
        if (v === null) { toast(`Pick a number from ${MIN} to ${MAX}`); paint(); return; }
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
