// Food → Plan (v0.16.21): this week's meals, day by day, from the built-in recipe library (js/food/meal-plan.js).
// Everything runs on the phone with no network and works with AI off. Calories and protein are estimates.
import { state } from '../state.js';
import { put, patch, newRecord } from '../db.js';
import { esc, $, $$, sheet, toast, todayKey } from '../ui.js';
import { currentTargets } from '../derived.js';
import { icon } from '../ui/icons.js';
import { haptics } from '../ui/haptic.js';
import { logFields } from '../food/core.js';
import { getRecipe } from '../food/meal-library.js';
import { generateWeek, alternatives, withSwap, weekStartOf, SLOT_LABEL, MEAL_FOOTER, groceryList, batchPrep } from '../food/meal-plan.js';
import { mealPrefs, openFoodPrefs, prefsSummary } from './food-prefs.js';

const num = (n) => Math.round(n).toLocaleString('en-US');
const dayName = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
const mealKind = (slot) => (slot.startsWith('snack') ? 'snack' : slot);
const estimate = (m) => `About ${num(m.kcal)} kcal · ${num(m.protein_g)} g protein`;

function targets() {
  const t = currentTargets();
  return { calories: t && t.calories, proteinG: t && t.proteinG };
}
export const currentPlan = (prefs = mealPrefs()) => generateWeek({ prefs, targets: targets(), weekStart: weekStartOf(todayKey()) });

/** Adds one planned meal to the food log (on its own day, or today if that day hasn't come yet). */
export function logPlanned(meal, date) {
  const day = date <= todayKey() ? date : todayKey();
  const fields = logFields({ item: { name: meal.name, kcal: meal.kcal, protein_g: meal.protein_g }, servings: 1, meal: mealKind(meal.slot), day });
  fields.portion = `${meal.servings === 1 ? '1 serving' : `${meal.servings} servings`} (planned)`;
  put('food_logs', newRecord(fields));
  haptics.light();
  toast(`Added to ${mealKind(meal.slot)} · ${num(meal.kcal)} kcal`);
}

export function openRecipe(meal) {
  const rec = getRecipe(meal.id);
  if (!rec) return;
  sheet(rec.name, (body) => {
    body.innerHTML = `
      <div class="stack plan-recipe">
        <p class="small muted">${esc(estimate(meal))} for ${meal.servings === 1 ? '1 serving' : `${meal.servings} servings`}. Estimates.</p>
        <h3>Ingredients</h3>
        <ul class="list plan-ing">${rec.ingredients.map((i) => `<li><span class="clamp2">${esc(i.name)}</span><small class="muted">${esc(i.qty)}</small></li>`).join('')}</ul>
        <p class="small muted">Amounts are for 1 serving.</p>
        <h3>Steps</h3>
        <ol class="plan-steps">${rec.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        <p class="disclaimer">${esc(MEAL_FOOTER)}</p>
      </div>`;
  }, { detents: ['medium', 'large'] });
}

function openSwap(plan, dayIdx, meal, rerender) {
  const prefs = mealPrefs();
  const alts = alternatives({ prefs, targets: targets(), weekStart: plan.weekStart, dayIdx, slot: meal.slot, count: 2 });
  sheet('Swap this meal', (body, close) => {
    body.innerHTML = alts.length ? `
      <div class="stack">
        <p class="small muted">Instead of ${esc(meal.name)}. Both follow your food preferences.</p>
        <ul class="list">${alts.map((a, i) => `<li class="tap" data-alt="${i}" tabindex="0" role="button"><div class="food-row"><b class="clamp2">${esc(a.name)}</b><small class="muted">${esc(estimate(a))}</small></div><span class="chev" aria-hidden="true">${icon('chev')}</span></li>`).join('')}</ul>
        ${(prefs.swaps[`${plan.weekStart}:${dayIdx}:${meal.slot}`]) ? '<button class="btn ghost" data-reset>Go back to the original pick</button>' : ''}
      </div>` : '<p class="muted">No other recipe fits your food preferences for this meal. Try loosening them in Food preferences.</p>';
    const apply = (id) => {
      patch('profile', 'main', { meal_prefs: withSwap(prefs, plan.weekStart, dayIdx, meal.slot, id) });
      haptics.select();
      close();
      rerender();
    };
    $$('[data-alt]', body).forEach((li) => {
      const go = () => apply(alts[Number(li.dataset.alt)].id);
      li.onclick = go;
      li.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
    const reset = $('[data-reset]', body);
    if (reset) reset.onclick = () => apply(null);
  });
}

function mealRow(m, di) {
  return `<li class="plan-meal" data-day="${di}" data-slot="${m.slot}">
    <button type="button" class="plan-open" data-open aria-label="Open recipe for ${esc(m.name)}">
      <small class="plan-slot">${esc(SLOT_LABEL[m.slot])}</small>
      <b class="clamp2">${esc(m.name)}</b>
      <small class="muted">${esc(estimate(m))}</small>
    </button>
    <div class="plan-acts"><button type="button" class="btn ghost small-btn" data-log>Log this</button><button type="button" class="btn ghost small-btn" data-swap>Swap</button></div>
  </li>`;
}

function groceryHtml(plan) {
  const groups = groceryList(plan);
  const prep = batchPrep(plan, mealPrefs());
  return `
    ${prep && prep.items.length ? `<div class="card stack" data-prep><p class="label">Sunday prep</p>
      <ul class="plan-prep">${prep.items.map((i) => `<li><b class="clamp2">${esc(i.name)}</b><small class="muted">${i.portions} ${i.portions === 1 ? 'portion' : 'portions'} this week${i.freezes ? ' · freezes well' : ''}</small></li>`).join('')}</ul>
      <ul class="small muted plan-tips">${prep.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    <div class="card stack" data-grocery><p class="label">Grocery list</p>
      ${groups.map((g) => `<div class="stack"><h3>${esc(g.label)}</h3><ul class="list">${g.items.map((it) => `<li><label class="plan-check"><input type="checkbox"><span><span class="clamp2">${esc(it.name)}</span><small class="muted">${esc(it.qty)}${it.uses > 1 ? ` × ${it.uses}` : ''}</small></span></label></li>`).join('')}</ul></div>`).join('')}
    </div>`;
}

/** Draws the Plan view into `el` (the Food screen's section). */
export function renderPlan(el, { rerender }) {
  const prefs = mealPrefs();
  const plan = currentPlan(prefs);
  const today = todayKey();
  el.querySelector('[data-plan]')?.remove();
  const box = document.createElement('div');
  box.className = 'stack plan';
  box.dataset.plan = '';
  box.innerHTML = `
    <div class="row between center plan-head"><div><h2>This week</h2><small class="muted">Aiming for about ${num(plan.kcalTarget)} kcal and ${num(plan.proteinTarget)} g protein a day</small></div></div>
    <button type="button" class="g-row plan-prefs" data-prefs><span class="g-ic">${icon('food')}</span><span class="g-text"><span>Food preferences</span><small>${esc(prefsSummary(prefs))}</small></span><span class="chev">${icon('chev')}</span></button>
    ${plan.gaps.length ? '<div class="card"><p class="small">Some meals are left out because nothing fits your food preferences. Loosening them will fill the gaps.</p></div>' : ''}
    ${plan.days.map((d, di) => `<div class="card stack plan-day${d.date === today ? ' today' : ''}" data-plan-day="${di}">
      <div class="row between center"><h3>${d.date === today ? 'Today' : esc(dayName(d.date))}</h3><small class="muted">About ${num(d.kcal)} kcal</small></div>
      <ul class="plan-meals">${d.meals.map((m) => mealRow(m, di)).join('')}</ul></div>`).join('')}
    ${groceryHtml(plan)}
    <p class="disclaimer" data-plan-foot>${esc(MEAL_FOOTER)}</p>`;
  el.appendChild(box);

  $('[data-prefs]', box).onclick = () => openFoodPrefs({ onSave: rerender });
  $$('.plan-meal', box).forEach((li) => {
    const di = Number(li.dataset.day);
    const day = plan.days[di];
    const meal = day.meals.find((m) => m.slot === li.dataset.slot);
    $('[data-open]', li).onclick = () => openRecipe(meal);
    $('[data-log]', li).onclick = () => logPlanned(meal, day.date);
    $('[data-swap]', li).onclick = () => openSwap(plan, di, meal, rerender);
  });
}
