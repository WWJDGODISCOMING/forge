// Food → Plan (v0.16.21): the week's meals, one day at a time, from the built-in recipe library (js/food/meal-plan.js).
// Everything runs on the phone with no network and works with AI off. Calories and protein are estimates.
import { state } from '../state.js';
import { put, patch, newRecord } from '../db.js';
import { esc, $, $$, sheet, toast, todayKey } from '../ui.js';
import { currentTargets } from '../derived.js';
import { customProteinG } from '../nutrition/targets.js';
import { icon } from '../ui/icons.js';
import { haptics } from '../ui/haptic.js';
import { logFields } from '../food/core.js';
import { getRecipe } from '../food/meal-library.js';
import { generateWeek, alternatives, withSwap, weekStartOf, planWeekFor, SLOT_LABEL, MEAL_FOOTER, groceryList, batchPrep, scaleQty, servingsText, plannedPortion, plannedLogDay, isPlannedLogged } from '../food/meal-plan.js';
import { cachedAiPlan, saveAiPlan, clearAiPlan, requestAiPlan, AI_FAIL } from '../food/meal-ai.js';
import { mealPrefs, openFoodPrefs, prefsSummary } from './food-prefs.js';

const num = (n) => Math.round(n).toLocaleString('en-US');
const dayName = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
const mealKind = (slot) => (slot.startsWith('snack') ? 'snack' : slot);
const estimate = (m) => `About ${num(m.kcal)} kcal · ${num(m.protein_g)} g protein`;
const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function targets() {
  const t = currentTargets();
  return { calories: t && t.calories, proteinG: t && t.proteinG };
}
/** On Sunday (prep day) the plan is next week, Monday to Sunday; otherwise this week. */
export const currentPlan = (prefs = mealPrefs()) => generateWeek({ prefs, targets: targets(), weekStart: planWeekFor(todayKey()) });
export const aiEnabled = () => !!(state.settings && state.settings.meal_ai === true);
const hasPrefs = () => !!(state.profile && state.profile.meal_prefs);
const logged = (meal, date) => isPlannedLogged(state.food_logs, meal, plannedLogDay(date, todayKey()));

let busy = false;
/** Adds one planned meal to the food log (on its own day, or today if that day hasn't come yet). Does nothing if it's already there. */
export function logPlanned(meal, date) {
  const day = plannedLogDay(date, todayKey());
  if (busy || isPlannedLogged(state.food_logs, meal, day)) return false;
  busy = true;
  setTimeout(() => { busy = false; }, 400);
  const fields = logFields({ item: { name: meal.name, kcal: meal.kcal, protein_g: meal.protein_g, carbs_g: meal.carbs_g, fat_g: meal.fat_g, portion: plannedPortion(meal) }, servings: 1, meal: mealKind(meal.slot), day });
  put('food_logs', newRecord(fields));
  haptics.light();
  toast(`Added to ${mealKind(meal.slot)} · ${num(meal.kcal)} kcal`);
  return true;
}

export function openRecipe(meal) {
  const rec = getRecipe(meal.id);
  const own = Array.isArray(meal.ingredients) && meal.ingredients.length; // an AI week carries its own amounts (already for this meal)
  if (!rec && !own) return;
  const f = meal.servings || 1;
  const ings = own ? meal.ingredients : rec.ingredients.map((i) => ({ name: i.name, qty: scaleQty(i.qty, f) }));
  const steps = own && meal.steps && meal.steps.length ? meal.steps : rec ? rec.steps : [];
  sheet(meal.name, (body) => {
    body.innerHTML = `
      <div class="stack plan-recipe">
        <p class="small muted">${esc(estimate(meal))} for ${esc(servingsText(f))}. Estimates.</p>
        <h3>Ingredients</h3>
        <ul class="list plan-ing">${ings.map((i) => `<li><span class="plan-ing-name">${esc(i.name)}</span><small class="muted plan-ing-qty">${esc(i.qty)}</small></li>`).join('')}</ul>
        <p class="small muted">Amounts are for ${esc(servingsText(f))}.</p>
        <h3>Steps</h3>
        <ol class="plan-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
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
        <p class="small muted">Instead of ${esc(meal.name)}. ${alts.length === 1 ? 'This one follows' : 'Both follow'} your food preferences.</p>
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

function mealRow(m, date, swappable) {
  const done = logged(m, date);
  return `<li class="plan-meal" data-slot="${m.slot}">
    <button type="button" class="plan-open" data-open aria-label="Open recipe for ${esc(m.name)}">
      <small class="plan-slot">${esc(SLOT_LABEL[m.slot])}</small>
      <b class="clamp2">${esc(m.name)}</b>
      <small class="muted">${esc(estimate(m))}</small>
    </button>
    <div class="plan-acts"><button type="button" class="btn ${done ? 'ok' : 'ghost'} small-btn" data-log ${done ? 'aria-disabled="true"' : ''}>${done ? `Logged <span class="plan-tick" aria-hidden="true">${icon('check')}</span>` : 'Log this'}</button>${swappable ? '<button type="button" class="btn ghost small-btn" data-swap>Swap</button>' : ''}</div>
  </li>`;
}

const groceryKey = (ws) => `forge.grocery.${ws}`;
function groceryChecked(ws) {
  try { return new Set(JSON.parse(localStorage.getItem(groceryKey(ws)) || '[]')); } catch { return new Set(); }
}
function saveChecked(ws, set) {
  try { localStorage.setItem(groceryKey(ws), JSON.stringify([...set])); } catch { /* private mode: checks just reset */ }
}

function openGrocery(plan) {
  const groups = groceryList(plan);
  const checked = groceryChecked(plan.weekStart);
  sheet('Grocery list', (body) => {
    body.innerHTML = `<div class="stack plan-grocery" data-grocery>
      ${groups.map((g) => `<div class="stack plan-gsec"><h3>${esc(g.label)}</h3><ul class="list">${g.items.map((it) => `<li><label class="plan-check"><input type="checkbox" data-key="${esc(it.key)}" ${checked.has(it.key) ? 'checked' : ''}><span class="plan-ring" aria-hidden="true"></span><span class="plan-gtext"><span class="plan-gname">${esc(it.name)}</span><small class="muted">${esc(it.qty)}</small></span></label></li>`).join('')}</ul></div>`).join('')}
      <p class="disclaimer">${esc(MEAL_FOOTER)}</p></div>`;
    $$('input[data-key]', body).forEach((c) => {
      c.onchange = () => { if (c.checked) checked.add(c.dataset.key); else checked.delete(c.dataset.key); saveChecked(plan.weekStart, checked); haptics.select(); };
    });
  }, { detents: ['medium', 'large'] });
}

function openPrep(plan, prefs) {
  const prep = batchPrep(plan, prefs);
  sheet('Sunday prep', (body) => {
    body.innerHTML = `<div class="stack" data-prep>
      <ul class="list plan-prep">${prep.items.map((i, n) => `<li class="tap" data-prep-item="${n}" tabindex="0" role="button"><div class="food-row"><b class="clamp2">${esc(i.name)}</b><small class="muted">${i.portions} portions this week${i.freezes ? ' · freezes well' : ''}</small></div><span class="chev" aria-hidden="true">${icon('chev')}</span></li>`).join('')}</ul>
      <ul class="small muted plan-tips">${prep.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <p class="disclaimer">${esc(MEAL_FOOTER)}</p></div>`;
    $$('[data-prep-item]', body).forEach((li) => {
      const go = () => openRecipe(prep.items[Number(li.dataset.prepItem)].meal);
      li.onclick = go;
      li.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
  }, { detents: ['medium', 'large'] });
}

const row = (attr, ic, title, sub) => `<button type="button" class="g-row plan-prefs" ${attr}><span class="g-ic">${icon(ic)}</span><span class="g-text"><span>${esc(title)}</span><small>${esc(sub)}</small></span><span class="chev">${icon('chev')}</span></button>`;

let picked = null; // { weekStart, idx }: the day shown in the strip
let aiBusy = false;
let aiNote = ''; // a calm message after the last AI try, shown until the next one

/** Draws the Plan view into `el` (the Food screen's section). */
export function renderPlan(el, { rerender }) {
  el.querySelector('[data-plan]')?.remove();
  const box = document.createElement('div');
  box.className = 'stack plan';
  box.dataset.plan = '';
  el.appendChild(box);
  const prefs = mealPrefs();

  if (!hasPrefs()) {
    box.innerHTML = `
      <div class="card stack plan-setup" data-setup>
        <h2>Set up your meal plan</h2>
        <p class="muted">Tell Forge how you eat (diet, foods to skip, how you cook) and it builds your week. It takes about a minute.</p>
        <button type="button" class="btn" data-prefs>Set up</button>
      </div>
      <p class="disclaimer" data-plan-foot>${esc(MEAL_FOOTER)}</p>`;
    $('[data-prefs]', box).onclick = () => openFoodPrefs({ onSave: rerender });
    return;
  }

  const base = currentPlan(prefs);
  const aiOn = aiEnabled();
  const aiPlan = aiOn ? cachedAiPlan(base.weekStart, prefs, state.user && state.user.uid, undefined, customProteinG(state.profile) ?? 'auto') : null; // with AI off nothing is read, sent or shown
  const plan = aiPlan || base;
  const today = todayKey();
  const nextWeek = plan.weekStart !== weekStartOf(today);
  const todayIdx = plan.days.findIndex((d) => d.date === today);
  if (!picked || picked.weekStart !== plan.weekStart) picked = { weekStart: plan.weekStart, idx: todayIdx >= 0 ? todayIdx : 0 };
  const prep = batchPrep(plan, prefs);
  const hasPrep = !!(prep && prep.items.length);

  box.innerHTML = `
    <div class="plan-head"><h2>${nextWeek ? 'Next week' : 'This week'}</h2><small class="muted">${aiPlan ? 'Made with AI, checked against your food preferences. ' : ''}Aiming for about ${num(plan.kcalTarget)} kcal and ${num(plan.proteinTarget)} g protein a day. All numbers are estimates.</small></div>
    <div class="stack plan-rows">
      ${aiOn ? (aiPlan ? row('data-ai-off', 'refresh', 'Use the standard plan', 'Go back to the built-in week') : row('data-ai-on', 'star', aiBusy ? 'Working on your plan…' : 'Personalize with AI', 'Sends your food preferences to xAI')) : ''}
      ${aiOn && aiNote ? `<p class="small muted plan-ai-note" role="status" data-ai-note>${esc(aiNote)}</p>` : ''}
      ${row('data-prefs', 'sliders', 'Food preferences', prefsSummary(prefs))}
      ${row('data-open-grocery', 'list', 'Grocery list', 'By store section')}
      ${hasPrep ? row('data-open-prep', 'calendar', 'Sunday prep', 'Cook once, eat all week') : ''}
    </div>
    ${plan.gaps.length ? '<div class="card"><p class="small">Some meals are left out because nothing fits your food preferences. Loosening them will fill the gaps.</p></div>' : ''}
    <div class="plan-strip" role="group" aria-label="Day of the week">${plan.days.map((d, i) => `<button type="button" class="plan-dayb${d.date < today ? ' past' : ''}${d.date === today ? ' today' : ''}" data-day="${i}" aria-pressed="${i === picked.idx}" aria-label="${esc(dayName(d.date))}"><small>${LETTERS[i]}</small><b>${Number(d.date.slice(8))}</b></button>`).join('')}</div>
    <div class="card stack plan-day" data-plan-day></div>
    <p class="disclaimer" data-plan-foot>${esc(MEAL_FOOTER)}</p>`;

  const dayBox = $('[data-plan-day]', box);
  const draw = () => {
    const di = picked.idx;
    const d = plan.days[di];
    $$('.plan-dayb', box).forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.day) === di)));
    dayBox.innerHTML = `<div class="row between center"><h3>${d.date === today ? 'Today' : esc(dayName(d.date))}</h3><small class="muted">About ${num(d.kcal)} kcal</small></div>
      <ul class="plan-meals">${d.meals.map((m) => mealRow(m, d.date, !aiPlan)).join('')}</ul>`;
    $$('.plan-meal', dayBox).forEach((li) => {
      const meal = d.meals.find((m) => m.slot === li.dataset.slot);
      $('[data-open]', li).onclick = () => openRecipe(meal);
      $('[data-log]', li).onclick = () => { if (logPlanned(meal, d.date)) draw(); };
      const sw = $('[data-swap]', li);
      if (sw) sw.onclick = () => openSwap(plan, di, meal, rerender);
    });
  };
  $$('.plan-dayb', box).forEach((b) => { b.onclick = () => { picked.idx = Number(b.dataset.day); haptics.select(); draw(); }; });
  $('[data-prefs]', box).onclick = () => openFoodPrefs({ onSave: rerender });
  $('[data-open-grocery]', box).onclick = () => openGrocery(plan);
  const on = $('[data-ai-on]', box);
  if (on) {
    on.disabled = aiBusy;
    on.setAttribute('aria-busy', String(aiBusy));
    if (aiBusy) on.querySelector('.g-ic').classList.add('plan-spin');
    on.onclick = async () => {
      if (aiBusy) return;
      aiBusy = true; aiNote = '';
      const uid = state.user && state.user.uid;
      rerender();
      try {
        const { call } = await import('../functions.js');
        const sent = targets();
        saveAiPlan(await requestAiPlan({ prefs, targets: sent, weekStart: base.weekStart, call }), prefs, uid, undefined, customProteinG(state.profile) ?? 'auto');
        haptics.success();
      } catch (e) {
        aiNote = (e && e.message) || AI_FAIL;
        toast(aiNote);
      }
      aiBusy = false;
      rerender();
    };
  }
  const off = $('[data-ai-off]', box);
  if (off) off.onclick = () => { clearAiPlan(base.weekStart); aiNote = ''; haptics.select(); rerender(); };
  const pr = $('[data-open-prep]', box);
  if (pr) pr.onclick = () => openPrep(plan, prefs);
  draw();
}
