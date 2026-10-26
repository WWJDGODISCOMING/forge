// Favorite meals (v0.16.75): the row at the top of Log food, the review sheet (change servings, swap or remove a food,
// then log or save), and the Favorite meals list. Logic lives in js/food/saved-meals.js.
import { state } from '../state.js';
import { put, patch, softDelete, newRecord } from '../db.js';
import { esc, $, $$, sheet, toast, confirmSheet, todayKey, formatDay } from '../ui.js';
import { icon } from '../ui/icons.js';
import { haptics } from '../ui/haptic.js';
import { MEALS, MEAL_LABEL, mealForHour, stepServings, groupByMeal } from '../food/core.js';
import { searchLocal } from '../food/search.js';
import { cleanMeal, defaultName, itemsFromEntries, logMealFields, mealLine, mealTotals, recentLabel, recentMeals, removeItem, setServings, sortFavorites, swapItem } from '../food/saved-meals.js';
import { openCreateFood } from './food-scan.js';

const fmtNum = (n) => Math.round(n * 100) / 100;
const mealWord = (m) => MEAL_LABEL[m].toLowerCase();
const MAX_SHOWN = 8; // favorites in the Log food row; the rest are under Favorite meals

/** What the Log food row offers right now: your favorites, then up to 3 recent meals you could log again. */
export function favoriteChoices(day = todayKey()) {
  const favs = sortFavorites(state.saved_meals || []);
  const recents = recentMeals(state.food_logs, day, { favorites: favs }).map((r) => ({
    ...r, label: recentLabel(r, formatDay(r.day, { weekday: 'short' })),
  }));
  return [...favs.slice(0, MAX_SHOWN).map((m) => ({ kind: 'fav', id: m.id, label: m.name, items: m.items, meal: m.meal })), ...recents.map((r) => ({ kind: 'recent', label: r.label, items: r.items, meal: r.meal }))];
}

/** The row's HTML ('' when there is nothing to show). Each card is two buttons: log it now, or review it first. */
export function favoritesRowHtml(choices) {
  if (!choices.length) return '';
  return `<section class="fav-row" data-favs aria-label="Favorite meals">
    <h3 class="fav-head">Favorite meals</h3>
    <ul class="fav-list">${choices.map((c, i) => `<li class="fav-card ${c.kind === 'recent' ? 'recent' : ''}">
      <button type="button" class="fav-log" data-fav="${i}" aria-label="Log ${esc(c.label)} again, ${esc(mealLine(c.items))}">
        <b class="clamp2">${esc(c.label)}</b><small class="muted">${esc(mealLine(c.items))}</small></button>
      <button type="button" class="fav-edit" data-fav-edit="${i}" aria-label="Review or change ${esc(c.label)}">${icon('more', { size: 20 })}</button></li>`).join('')}</ul>
  </section>`;
}

/** Writes every item as a new log entry. Returns the ids, so Undo can take them back. */
function logNow(items, { meal, day }) {
  const ids = [];
  for (const f of logMealFields(items, { meal, day })) { const r = newRecord(f); ids.push(r.id); put('food_logs', r); }
  return ids;
}

function toastLogged(name, items, meal, ids) {
  const t = mealTotals(items);
  toast(`Logged ${name} to ${mealWord(meal)} · ${t.kcal.toLocaleString('en-US')} kcal`, 4200, {
    icon: 'check',
    action: { label: 'Undo', onClick: () => { for (const id of ids) softDelete('food_logs', id); haptics.select(); } },
  });
}

/** One tap: log choice `c` into its meal (or `meal` when the sheet was opened for one). Guarded against a double tap. */
let tapping = false;
export function logChoice(c, { day, meal }) {
  if (tapping) return false;
  tapping = true;
  setTimeout(() => { tapping = false; }, 800);
  const m = meal || c.meal || mealForHour(new Date().getHours() + new Date().getMinutes() / 60);
  const ids = logNow(c.items, { meal: m, day });
  if (c.kind === 'fav') patch('saved_meals', c.id, { last_used_at: new Date().toISOString() });
  haptics.success();
  toastLogged(c.label, c.items, m, ids);
  return true;
}

/** Save a day's meal as a favorite: the review sheet, ready to name. */
export function openSaveMeal({ day, meal }) {
  const items = itemsFromEntries(groupByMeal(state.food_logs, day).find((g) => g.meal === meal).entries);
  openReview({ kind: 'new', name: defaultName(items, meal), items, meal, day });
}

/**
 * The review sheet. kind: 'fav' (a favorite: log, save changes, rename, delete), 'recent' (log with changes, or save as favorite)
 * or 'new' (name it and save). Nothing is written until you tap a button at the bottom.
 */
export function openReview({ kind, id = null, name = '', items, meal, day = todayKey(), explicitMeal = false }) {
  let work = items.map((i) => ({ ...i }));
  let title = name;
  let slot = explicitMeal && meal ? meal : (meal || mealForHour(new Date().getHours() + new Date().getMinutes() / 60));
  let changed = false;
  sheet(kind === 'new' ? 'Save as favorite' : 'Review meal', (body, close) => {
    const main = () => {
      const t = mealTotals(work);
      body.innerHTML = `<div class="stack fav-review">
        <label class="field"><span>${kind === 'recent' ? 'Name (if you save it)' : 'Name'}</span><input name="name" maxlength="40" value="${esc(title)}" autocomplete="off"></label>
        ${work.length ? `<ul class="list fav-items">${work.map((it, i) => `<li class="fav-item" data-i="${i}">
          <div class="fav-top"><b class="clamp2">${esc(it.name)}</b><span class="fav-kcal">${Math.round(it.kcal * it.servings).toLocaleString('en-US')} kcal</span></div>
          <div class="fav-item-ctl">
            <span class="serv-stepper"><button type="button" class="icon-btn" data-minus="${i}" aria-label="Fewer servings of ${esc(it.name)}">${icon('minus')}</button><output aria-live="polite">${fmtNum(it.servings)}</output><button type="button" class="icon-btn" data-plus="${i}" aria-label="More servings of ${esc(it.name)}">${icon('plus')}</button></span>
            <button type="button" class="btn ghost small-btn" data-swap="${i}" aria-label="Swap ${esc(it.name)} for another food">${icon('swap', { size: 18 })}<span>Swap</span></button>
            <button type="button" class="icon-btn" data-remove="${i}" aria-label="Remove ${esc(it.name)}">${icon('trash', { size: 20 })}</button>
          </div></li>`).join('')}</ul>` : '<p class="muted">No foods left. Go back and keep at least one.</p>'}
        <p class="small muted" data-total>${work.length ? `${t.kcal.toLocaleString('en-US')} kcal · ${Math.round(t.protein_g)} g protein · ${Math.round(t.carbs_g)} g carbs · ${Math.round(t.fat_g)} g fat` : ''}</p>
        ${kind === 'new' ? '' : `<div class="meal-chips" role="radiogroup" aria-label="Log it to">${MEALS.map((m) => `<button type="button" class="chip-btn ${m === slot ? 'on' : ''}" role="radio" aria-checked="${m === slot}" data-slot="${m}">${MEAL_LABEL[m]}</button>`).join('')}</div>`}
        <p class="error" aria-live="polite"></p>
        ${kind === 'new' ? '' : '<button type="button" class="btn" data-log>Log this meal</button>'}
        ${kind === 'fav' ? `<button type="button" class="btn ghost" data-save ${changed ? '' : 'hidden'}>Save changes to favorite</button>` : `<button type="button" class="btn ${kind === 'new' ? '' : 'ghost'}" data-save>${kind === 'new' ? 'Save favorite' : 'Save as favorite'}</button>`}
        ${kind === 'fav' ? '<button type="button" class="btn danger-ghost" data-del>Delete this favorite</button>' : ''}
      </div>`;
      const nameEl = $('[name=name]', body);
      nameEl.addEventListener('input', () => { title = nameEl.value; if (kind === 'fav') { changed = true; const s = $('[data-save]', body); if (s) s.hidden = false; } });
      const bump = (i, dir) => { haptics.select(); work = setServings(work, i, stepServings(work[i].servings, dir)); changed = true; main(); $(`[data-${dir > 0 ? 'plus' : 'minus'}="${i}"]`, body)?.focus(); };
      $$('[data-minus]', body).forEach((b) => { b.onclick = () => bump(Number(b.dataset.minus), -1); });
      $$('[data-plus]', body).forEach((b) => { b.onclick = () => bump(Number(b.dataset.plus), 1); });
      $$('[data-remove]', body).forEach((b) => {
        b.onclick = () => {
          if (work.length < 2) { $('.error', body).textContent = 'A meal needs at least one food. Swap it instead, or delete the favorite.'; haptics.warning(); return; }
          haptics.select(); work = removeItem(work, Number(b.dataset.remove)); changed = true; main();
        };
      });
      $$('[data-swap]', body).forEach((b) => { b.onclick = () => { haptics.select(); swap(Number(b.dataset.swap)); }; });
      $$('[data-slot]', body).forEach((b) => { b.onclick = () => { haptics.select(); slot = b.dataset.slot; $$('[data-slot]', body).forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); }); }; });
      const logBtn = $('[data-log]', body);
      if (logBtn) {
        logBtn.onclick = () => {
          if (tapping || !work.length) return;
          tapping = true; setTimeout(() => { tapping = false; }, 800);
          const ids = logNow(work, { meal: slot, day });
          if (kind === 'fav') patch('saved_meals', id, { last_used_at: new Date().toISOString() });
          haptics.success(); close(); toastLogged(title.trim() || 'meal', work, slot, ids);
        };
      }
      const saveBtn = $('[data-save]', body);
      saveBtn.onclick = () => {
        const r = cleanMeal({ name: title, items: work, meal: kind === 'recent' ? slot : (kind === 'fav' ? meal : slot) });
        if (!r.ok) { $('.error', body).textContent = r.error; haptics.warning(); return; }
        if (kind === 'fav') patch('saved_meals', id, r.meal); else put('saved_meals', newRecord({ ...r.meal, ...(kind === 'new' ? { meal } : {}) }));
        haptics.success(); close(); toast(kind === 'fav' ? 'Saved changes' : `Saved ${r.meal.name} to favorites`, 2600, { icon: 'check' });
      };
      const del = $('[data-del]', body);
      if (del) {
        del.onclick = async () => {
          haptics.warning();
          if (!(await confirmSheet({ title: 'Delete this favorite?', message: 'Entries you already logged stay as they are.', confirmLabel: 'Delete', danger: true }))) return;
          softDelete('saved_meals', id); close(); toast('Deleted');
        };
      }
    };
    // Swap: pick from My foods and recents, or create a food. The servings you had carry over.
    const swap = (i) => {
      let q = '';
      body.innerHTML = `<div class="stack">
        <p class="small muted">Swap ${esc(work[i].name)} for:</p>
        <label class="field"><input type="search" name="q" placeholder="Search your foods" autocomplete="off" autocapitalize="off" enterkeyhint="search" aria-label="Search your foods"></label>
        <ul class="list food-results" data-results></ul>
        <button type="button" class="btn ghost" data-create>${icon('plus', { size: 18 })}<span>Create a new food</span></button>
        <button type="button" class="btn ghost" data-back>Back to the meal</button></div>`;
      const results = $('[data-results]', body);
      let found = [];
      const paint = () => {
        found = searchLocal(q, { foods: state.foods, logs: state.food_logs, limit: 12 });
        results.innerHTML = found.length ? found.map((it, k) => `<li class="tap" data-k="${k}" role="button" tabindex="0"><div class="food-row"><b class="clamp2">${esc(it.name)}</b><small class="food-sub muted"><span class="food-kcal">${Math.round(it.kcal).toLocaleString('en-US')} kcal</span>${it.protein_g ? `<span class="food-kcal">${Math.round(it.protein_g)} g protein</span>` : ''}</small></div></li>`).join('')
          : `<li class="food-none"><div><b>No match in your foods</b><small class="muted">Create it below, with the numbers from the label.</small></div></li>`;
      };
      const choose = (it) => { work = swapItem(work, i, it); changed = true; haptics.success(); main(); };
      results.addEventListener('click', (e) => { const li = e.target.closest('[data-k]'); if (li) choose(found[Number(li.dataset.k)]); });
      results.addEventListener('keydown', (e) => { const li = e.target.closest('[data-k]'); if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); choose(found[Number(li.dataset.k)]); } });
      $('[name=q]', body).addEventListener('input', (e) => { q = e.target.value; paint(); });
      $('[data-back]', body).onclick = () => { haptics.select(); main(); };
      $('[data-create]', body).onclick = () => { haptics.select(); openCreateFood({ start: { name: q.trim() }, onSaved: (it) => choose(it) }); };
      paint();
    };
    main();
  }, { detents: ['medium', 'large'] });
}

/** Favorite meals: the list. Tap one to review, rename, swap or delete it. */
export function openFavorites({ day = todayKey() } = {}) {
  sheet('Favorite meals', (body, close) => {
    const favs = sortFavorites(state.saved_meals || []);
    body.innerHTML = `<div class="stack">
      ${favs.length ? `<ul class="list">${favs.map((m) => `<li class="tap" data-id="${esc(m.id)}" role="button" tabindex="0"><div class="food-row"><b class="clamp2">${esc(m.name)}</b><small class="muted">${esc(mealLine(m.items))}</small></div><span class="chev" aria-hidden="true">${icon('chev')}</span></li>`).join('')}</ul>`
        : '<p class="muted">Nothing saved yet. On a meal you logged, tap “Save as favorite” and it will be one tap away in Log food.</p>'}
    </div>`;
    const open = (li) => {
      const m = favs.find((x) => x.id === li.dataset.id);
      if (!m) return;
      close();
      setTimeout(() => openReview({ kind: 'fav', id: m.id, name: m.name, items: m.items, meal: m.meal, day }), 0);
    };
    $$('[data-id]', body).forEach((li) => {
      li.onclick = () => open(li);
      li.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(li); } };
    });
  }, { detents: ['medium', 'large'] });
}
