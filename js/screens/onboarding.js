// Onboarding (first run) and "Edit profile & targets" (same screens, prefilled).
import { state, units as getUnits } from '../state.js';
import { put, patch, newRecord } from '../db.js';
import { tourFieldsForSave } from '../tour/steps.js';
import { esc, $, $$, toast, todayKey } from '../ui.js';
import {
  GOALS, ACTIVITY_LEVELS, computeTargets, applyProteinGoal, FLOOR_SOURCE, MAX_LOSS_PCT, MAX_LOSS_PCT_OVERRIDE,
} from '../nutrition/targets.js';
import { weightToDisplay, weightFromInput, weightUnit, feetInchesToCm, cmToFeetInches, formatWeight } from '../units.js';
import { LOCATION_PRESETS, presetDescription, locationFromPreset } from '../workouts/equipment.js';
import { currentWeightKg } from '../derived.js';
import { focusChipsHtml, bindFocusChips } from '../ui/focus-chips.js';
import { cleanFocus } from '../workouts/focus.js';

let draft = null;
let step = 0;

const EXPERIENCE = { beginner: 'New (under 1 year)', intermediate: 'Intermediate (1–3 years)', advanced: 'Advanced (3+ years)' };

function startDraft(editing) {
  const p = state.profile || {};
  draft = {
    editing,
    units: getUnits(),
    goal: p.goal || null,
    sex: p.sex || null,
    age: p.age || '',
    heightCm: p.heightCm || null,
    weightKg: editing ? currentWeightKg() || p.weightKg : null,
    targetWeightKg: p.targetWeightKg || null,
    activity: p.activity || 'light',
    trainingDays: p.trainingDays || 3,
    sessionMin: p.sessionMin || 60,
    experience: p.experience || 'beginner',
    injuries: p.injuries || '',
    focus: cleanFocus(p.focus_muscles),
    locations: new Set(['home', 'ymca', 'travel']),
    pacePct: p.pacePct ?? null,
    allowFastPace: !!p.allowFastPace,
  };
  step = 0;
}

function steps() {
  // Locations are set up once; after that they're managed in Settings → Locations.
  return draft.editing
    ? [stepGoal, stepBody, stepTraining, stepTargets]
    : [stepGoal, stepBody, stepTraining, stepLocations, stepTargets];
}

export function renderOnboarding(el, { editing = false } = {}) {
  if (!draft || draft.editing !== editing) startDraft(editing);
  const all = steps();
  const fn = all[step];
  el.innerHTML = `
    <section class="onboard">
      <div class="progress" aria-label="Step ${step + 1} of ${all.length}">
        ${all.map((_, i) => `<span class="${i <= step ? 'on' : ''}"></span>`).join('')}
      </div>
      <form class="stack" novalidate>
        ${fn.html()}
        <p class="error" aria-live="polite"></p>
        <div class="row gap sticky-actions">
          ${step > 0 || editing ? `<button type="button" class="btn ghost" data-back>${step === 0 ? 'Cancel' : 'Back'}</button>` : ''}
          <button type="submit" class="btn grow">${step === all.length - 1 ? (editing ? 'Save' : 'Let’s go') : 'Next'}</button>
        </div>
      </form>
    </section>`;

  const form = $('form', el);
  fn.mount && fn.mount(form, () => renderOnboarding(el, { editing }));

  const back = $('[data-back]', el);
  if (back)
    back.onclick = () => {
      if (step === 0) {
        draft = null;
        location.hash = '#/settings';
      } else {
        step--;
        renderOnboarding(el, { editing });
      }
    };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = fn.read(form);
    if (err) {
      $('.error', el).textContent = err;
      return;
    }
    if (step < all.length - 1) {
      step++;
      renderOnboarding(el, { editing });
      window.scrollTo(0, 0);
    } else {
      finish();
    }
  });
}

// ---------- steps ----------

const stepGoal = {
  html: () => `
    <h1>What’s your main goal?</h1>
    <p class="muted">You can change this any time.</p>
    <div class="choices">
      ${Object.entries(GOALS).map(([k, g]) => `
        <label class="choice">
          <input type="radio" name="goal" value="${k}" ${draft.goal === k ? 'checked' : ''}>
          <span>${esc(g.label)}</span>
        </label>`).join('')}
    </div>`,
  read(form) {
    if (!form.goal.value) return 'Pick a goal to continue.';
    if (draft.goal !== form.goal.value) draft.pacePct = null; // reset pace when goal changes
    draft.goal = form.goal.value;
  },
};

const stepBody = {
  html: () => {
    const u = draft.units;
    const fi = draft.heightCm ? cmToFeetInches(draft.heightCm) : { feet: '', inches: '' };
    const w = (kg) => (kg ? weightToDisplay(kg, u).toFixed(1) : '');
    return `
    <h1>About you</h1>
    <p class="muted">Used to estimate how many calories you burn.</p>
    <div class="seg" role="radiogroup" aria-label="Units">
      <label><input type="radio" name="units" value="imperial" ${u === 'imperial' ? 'checked' : ''}><span>lb / ft</span></label>
      <label><input type="radio" name="units" value="metric" ${u === 'metric' ? 'checked' : ''}><span>kg / cm</span></label>
    </div>
    <fieldset class="field">
      <legend>Sex (for the calorie formula)</legend>
      <div class="seg">
        ${[['male', 'Male'], ['female', 'Female'], ['unspecified', 'Prefer not to say']].map(([k, l]) =>
          `<label><input type="radio" name="sex" value="${k}" ${draft.sex === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}
      </div>
    </fieldset>
    <label class="field"><span>Age</span><input name="age" type="number" inputmode="numeric" min="13" max="100" value="${esc(draft.age)}"></label>
    ${u === 'imperial'
      ? `<div class="row gap">
          <label class="field grow"><span>Height (ft)</span><input name="ft" type="number" inputmode="numeric" min="3" max="8" value="${fi.feet}"></label>
          <label class="field grow"><span>(in)</span><input name="in" type="number" inputmode="numeric" min="0" max="11" value="${fi.inches}"></label>
        </div>`
      : `<label class="field"><span>Height (cm)</span><input name="cm" type="number" inputmode="decimal" min="100" max="250" value="${draft.heightCm ? Math.round(draft.heightCm) : ''}"></label>`}
    <label class="field"><span>Current weight (${weightUnit(u)})</span><input name="weight" type="number" inputmode="decimal" step="0.1" value="${w(draft.weightKg)}"></label>
    <label class="field"><span>Target weight (${weightUnit(u)}) <small class="muted">optional</small></span><input name="target" type="number" inputmode="decimal" step="0.1" value="${w(draft.targetWeightKg)}"></label>`;
  },
  mount(form, rerender) {
    $$('input[name=units]', form).forEach((r) =>
      r.addEventListener('change', () => {
        stepBody.read(form, true); // keep what's typed
        draft.units = r.value;
        rerender();
      })
    );
  },
  read(form, lenient = false) {
    const u = draft.units;
    draft.sex = form.sex.value || draft.sex;
    draft.age = form.age.value ? Number(form.age.value) : '';
    const h = u === 'imperial' ? (form.ft.value ? feetInchesToCm(form.ft.value, form.in.value) : null) : Number(form.cm.value) || null;
    draft.heightCm = h;
    draft.weightKg = form.weight.value ? weightFromInput(form.weight.value, u) : null;
    draft.targetWeightKg = form.target.value ? weightFromInput(form.target.value, u) : null;
    if (lenient) return;
    if (!draft.sex) return 'Choose an option for sex (or “Prefer not to say”).';
    if (!draft.age || draft.age < 13 || draft.age > 100) return 'Enter an age between 13 and 100.';
    if (!draft.heightCm || draft.heightCm < 100 || draft.heightCm > 250) return 'Enter your height.';
    if (!draft.weightKg || draft.weightKg < 30 || draft.weightKg > 350) return 'Enter your current weight.';
    if (draft.targetWeightKg && (draft.targetWeightKg < 30 || draft.targetWeightKg > 350)) return 'That target weight doesn’t look right.';
  },
};

const stepTraining = {
  html: () => `
    <h1>Your activity and training</h1>
    <fieldset class="field">
      <legend>Daily activity outside workouts</legend>
      <div class="choices">
        ${Object.entries(ACTIVITY_LEVELS).map(([k, a]) => `
          <label class="choice">
            <input type="radio" name="activity" value="${k}" ${draft.activity === k ? 'checked' : ''}>
            <span>${esc(a.label)}<small>${esc(a.hint)}</small></span>
          </label>`).join('')}
      </div>
    </fieldset>
    <fieldset class="field"><legend>Workouts per week</legend>
      <div class="seg">${[2, 3, 4, 5, 6].map((n) => `<label><input type="radio" name="days" value="${n}" ${draft.trainingDays === n ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
    </fieldset>
    <fieldset class="field"><legend>Session length (minutes)</legend>
      <div class="seg">${[30, 45, 60, 75, 90].map((n) => `<label><input type="radio" name="len" value="${n}" ${draft.sessionMin === n ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
    </fieldset>
    <fieldset class="field"><legend>Lifting experience</legend>
      <div class="seg wrap">${Object.entries(EXPERIENCE).map(([k, l]) => `<label><input type="radio" name="exp" value="${k}" ${draft.experience === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    </fieldset>
    <fieldset class="field"><legend>Focus areas <small class="muted">optional</small></legend>
      ${focusChipsHtml(draft.focus)}
    </fieldset>
    <label class="field"><span>Injuries or limits <small class="muted">optional</small></span>
      <textarea name="injuries" rows="2" placeholder="e.g. left shoulder, no overhead pressing">${esc(draft.injuries)}</textarea>
    </label>`,
  mount(form) { bindFocusChips(form); },
  read(form) {
    draft.activity = form.activity.value || 'light';
    draft.trainingDays = Number(form.days.value) || 3;
    draft.sessionMin = Number(form.len.value) || 60;
    draft.experience = form.exp.value || 'beginner';
    draft.injuries = form.injuries.value.trim();
    draft.focus = cleanFocus($$('input[name=focus]:checked', form).map((b) => b.value));
  },
};

const stepLocations = {
  html: () => `
    <h1>Where do you train?</h1>
    <p class="muted">Each place gets its own equipment list. Workouts only use what’s there. Bodyweight moves work everywhere.</p>
    <div class="choices">
      ${LOCATION_PRESETS.map((l) => `
        <label class="choice check">
          <input type="checkbox" name="loc" value="${l.key}" ${draft.locations.has(l.key) ? 'checked' : ''}>
          <span>${esc(l.name)}<small>${esc(presetDescription(l))}</small></span>
        </label>`).join('')}
    </div>`,
  read(form) {
    draft.locations = new Set($$('input[name=loc]:checked', form).map((i) => i.value));
    if (!draft.locations.size) return 'Pick at least one place.';
  },
};

function targetsFromDraft() {
  const t = computeTargets({ ...draft, pacePct: draft.pacePct ?? undefined });
  return state.profile ? applyProteinGoal(t, state.profile) : t; // editing: keep the own protein goal
}

const stepTargets = {
  html: () => {
    const t = targetsFromDraft();
    if (draft.pacePct == null) draft.pacePct = t.pacePct;
    const u = draft.units;
    const paceChoices =
      draft.goal === 'lose'
        ? [0.25, 0.5, 0.75, 1.0, ...(draft.allowFastPace ? [1.25, 1.5] : [])]
        : draft.goal === 'muscle'
          ? [0.1, 0.25, 0.5]
          : [];
    const stopped = t.flags.some((f) => f.level === 'stop');
    const perWeek = (pct) => formatWeight((draft.weightKg * pct) / 100, u, 1);
    return `
      <h1>Your daily targets</h1>
      ${t.flags.map((f) => `<div class="notice ${f.level}">${esc(f.message)}</div>`).join('')}
      ${paceChoices.length && !stopped ? `
        <fieldset class="field"><legend>${draft.goal === 'lose' ? 'Weekly loss pace' : 'Weekly gain pace'}</legend>
          <div class="seg wrap">${paceChoices.map((p) => `<label><input type="radio" name="pace" value="${p}" ${Math.abs(draft.pacePct - p) < 1e-9 ? 'checked' : ''}><span>${p}%<small>${perWeek(p)}</small></span></label>`).join('')}</div>
        </fieldset>
        ${draft.goal === 'lose' ? `
          <label class="choice check small">
            <input type="checkbox" name="fast" ${draft.allowFastPace ? 'checked' : ''}>
            <span>Let me go faster than ${MAX_LOSS_PCT}% a week (up to ${MAX_LOSS_PCT_OVERRIDE}%)<small>Faster loss costs more muscle and is harder to stick with.</small></span>
          </label>` : ''}` : ''}
      <div class="card target-hero">
        <div class="big">${t.calories.toLocaleString()}<small>kcal / day</small></div>
        <div class="macros">
          <div><b>${t.proteinG} g</b><span>Protein</span></div>
          <div><b>${t.carbG} g</b><span>Carbs</span></div>
          <div><b>${t.fatG} g</b><span>Fat</span></div>
        </div>
      </div>
      <details class="card" open>
        <summary>How these were calculated</summary>
        <ul class="reasons">${t.reasoning.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        <p class="small muted">Safe floor: ${t.floor} kcal/day. ${esc(FLOOR_SOURCE)}</p>
        <p class="small muted">After 2–3 weeks of logging food and weight, targets will adjust to your real metabolism (coming in Phase 2).</p>
      </details>
      <p class="disclaimer">This app gives general fitness information, not medical advice. Check with a doctor before big changes to diet or exercise, especially if you have a health condition.</p>`;
  },
  mount(form, rerender) {
    $$('input[name=pace]', form).forEach((r) =>
      r.addEventListener('change', () => {
        draft.pacePct = Number(r.value);
        rerender();
      })
    );
    const fast = form.fast;
    if (fast)
      fast.addEventListener('change', () => {
        draft.allowFastPace = fast.checked;
        if (!fast.checked && draft.pacePct > MAX_LOSS_PCT) draft.pacePct = MAX_LOSS_PCT;
        rerender();
      });
  },
  read() {},
};

// ---------- save ----------

function finish() {
  const t = targetsFromDraft();
  const profileData = {
    goal: draft.goal,
    sex: draft.sex,
    age: draft.age,
    heightCm: draft.heightCm,
    weightKg: draft.weightKg,
    targetWeightKg: draft.targetWeightKg,
    activity: draft.activity,
    trainingDays: draft.trainingDays,
    sessionMin: draft.sessionMin,
    experience: draft.experience,
    injuries: draft.injuries,
    focus_muscles: draft.focus,
    pacePct: t.pacePct,
    allowFastPace: draft.allowFastPace,
    ...tourFieldsForSave(!!state.profile), // a brand-new account gets the how-to tour; editing a profile doesn't
  };

  if (state.profile) patch('profile', 'main', profileData);
  else put('profile', newRecord(profileData, { id: 'main' }));

  if (state.settings) {
    if (state.settings.units !== draft.units) patch('settings', 'main', { units: draft.units });
  } else {
    put('settings', newRecord({ units: draft.units }, { id: 'main' }));
  }

  if (!draft.editing) {
    let first = true;
    for (const preset of LOCATION_PRESETS) {
      if (!draft.locations.has(preset.key)) continue;
      put('locations', newRecord(locationFromPreset(preset, first)));
      first = false;
    }
    const now = new Date();
    put('weights', newRecord({ kg: draft.weightKg, day: todayKey(), measured_at: now.toISOString() }));
  }

  // Optimistic local update so the next screen renders immediately (Firestore's listener confirms it).
  state.set({ profile: { ...(state.profile || {}), ...profileData } });
  const wasEditing = draft.editing;
  draft = null;
  toast(wasEditing ? 'Profile updated' : 'You’re all set');
  location.hash = '#/today';
}
