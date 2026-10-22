// Restaurant meal builder (v0.16.49): pick a chain, tap what you ordered (build-your-own chains get components with
// half portions), watch the totals, then log it and save it as a Favorite. The numbers come from static JSON in
// data/restaurants/ (no network once loaded, no AI). The maths lives in js/food/restaurant.js.
import { state } from '../state.js';
import { put, newRecord } from '../db.js';
import { esc, $, $$, sheet, toast, todayKey } from '../ui.js';
import { icon } from '../ui/icons.js';
import { haptics } from '../ui/haptic.js';
import { settleTicks } from '../ui/motion.js';
import { MEALS, MEAL_LABEL, cleanFood, logFields, mealForHour } from '../food/core.js';
import { CHAIN_IDS, favoriteFood, findSameFood, orderName, orderSummary, picked, qtyLabel, stepQty, totalsFor, validateChain } from '../food/restaurant.js';

const cache = new Map();

/** Loads one chain file (cached for the session; the service worker keeps it for offline). Throws if it can't. */
export async function loadChain(id) {
  if (cache.has(id)) return cache.get(id);
  const res = await fetch(`data/restaurants/${id}.json`);
  if (!res.ok) throw new Error(`chain ${id}: ${res.status}`);
  const chain = await res.json();
  if (validateChain(chain).length) throw new Error(`chain ${id} is not valid`);
  cache.set(id, chain);
  return chain;
}

const NAMES = { chipotle: 'Chipotle', 'chick-fil-a': 'Chick-fil-A', panera: 'Panera', subway: 'Subway', starbucks: 'Starbucks', mcdonalds: 'McDonald’s', 'taco-bell': 'Taco Bell', wendys: 'Wendy’s', cava: 'Cava', sweetgreen: 'Sweetgreen' };
const num = (n) => Math.round(n).toLocaleString('en-US');

export function openRestaurant({ day = todayKey(), meal, onFallback } = {}) {
  sheet('Restaurant', (body, close, head) => {
    const fallback = () => `<div class="rest-fallback"><p class="small muted">Not on the list? Create the food yourself or snap a photo of the meal for an estimate.</p>
      <button type="button" class="btn ghost" data-fallback>Back to Log food</button></div>`;
    const bindFallback = () => { const b = $('[data-fallback]', body); if (b) b.onclick = () => { haptics.select(); close(); setTimeout(() => onFallback?.(), 0); }; };

    const chainList = () => {
      body.innerHTML = `<div class="stack"><p class="small muted">Pick where you ate.</p>
        <ul class="list rest-chains">${CHAIN_IDS.map((id) => `<li class="tap" data-chain="${id}" role="button" tabindex="0"><b>${esc(NAMES[id])}</b><span class="chev" aria-hidden="true">${icon('chev')}</span></li>`).join('')}</ul>
        ${fallback()}</div>`;
      $$('[data-chain]', body).forEach((li) => {
        const go = () => { haptics.select(); build(li.dataset.chain); };
        li.onclick = go;
        li.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
      });
      bindFallback();
    };

    const build = async (id) => {
      body.innerHTML = `<div class="stack"><p class="small muted" role="status">Loading ${esc(NAMES[id])}…</p></div>`;
      let chain;
      try { chain = await loadChain(id); } catch {
        body.innerHTML = `<div class="stack"><p role="status"><b>Couldn’t load ${esc(NAMES[id])}.</b></p><p class="small muted">Connect once and it will work offline after that.</p>
          <button type="button" class="btn ghost" data-back>All restaurants</button>${fallback()}</div>`;
        $('[data-back]', body).onclick = () => { haptics.select(); chainList(); };
        bindFallback();
        return;
      }
      const sel = {};
      let mealPick = meal || mealForHour(new Date().getHours());
      let ownName = '';
      let makeFav = true;
      const halfOf = new Map(chain.groups.map((g) => [g.id, !!g.half]));
      const showBuilder = () => {
      body.innerHTML = `
        <div class="stack rest-build">
          <button type="button" class="btn ghost rest-back" data-back>${icon('back', { size: 18 })}<span>All restaurants</span></button>
          <h2 class="rest-title">${esc(chain.name)}</h2>
          ${chain.groups.map((g) => `<section aria-label="${esc(g.label)}"><h3 class="rest-group">${esc(g.label)}${g.half ? ' <small class="muted">half portions ok</small>' : ''}</h3>
            <ul class="list rest-items">${chain.items.filter((i) => i.group === g.id).map((i) => `
              <li class="rest-item" data-item="${esc(i.id)}"><div class="food-row"><b class="clamp2">${esc(i.name)}</b>
                <small class="food-sub muted"><span class="food-kcal">${num(i.kcal)} kcal</span><span class="food-kcal">${Math.round(i.protein_g)} g P</span></small></div>
                <div class="rest-ctl"><button type="button" class="icon-btn" data-minus aria-label="Less ${esc(i.name)}" aria-hidden="true" tabindex="-1">${icon('minus')}</button><output class="rest-qty" data-qty aria-live="polite"></output><button type="button" class="icon-btn" data-plus aria-label="Add ${esc(i.name)}">${icon('plus')}</button></div></li>`).join('')}</ul></section>`).join('')}
          <p class="small muted">Numbers come from ${esc(chain.name)}’s published nutrition guide (version ${chain.version}, ${esc(chain.retrieved)}). Recipes and sizes change, so treat them as a close estimate.
            <a href="${esc(chain.source)}" target="_blank" rel="noopener">Source</a></p>
          ${fallback()}
          <p class="error" data-err aria-live="polite"></p>
        </div>
        <div class="rest-dock" data-dock>
          <dl class="rest-tally" aria-label="Running totals">
            <div class="rest-kcal"><dt>Calories</dt><dd data-tick="rest-kcal" data-t="kcal">0</dd></div>
            <div><dt>Protein</dt><dd data-tick="rest-p" data-t="protein_g">0 g</dd></div>
            <div><dt>Carbs</dt><dd data-tick="rest-c" data-t="carbs_g">0 g</dd></div>
            <div><dt>Fat</dt><dd data-tick="rest-f" data-t="fat_g">0 g</dd></div>
          </dl>
          <button class="btn" data-add disabled>Pick something</button>
        </div>`;
      const nameOf = new Map(chain.items.map((i) => [i.id, i.name]));
      const set = (id2, q) => {
        if (q > 0) sel[id2] = q; else delete sel[id2];
        paint(id2);
      };
      const paint = (only) => {
        for (const li of $$('[data-item]', body)) {
          if (only && li.dataset.item !== only) continue;
          const q = sel[li.dataset.item] || 0;
          const on = q > 0;
          li.classList.toggle('on', on);
          const out = $('[data-qty]', li);
          out.textContent = on ? (qtyLabel(q) || '1') : '';
          out.setAttribute('aria-label', on ? (q === 0.5 ? `Half portion of ${nameOf.get(li.dataset.item)}` : `${q} of ${nameOf.get(li.dataset.item)}`) : '');
          const minus = $('[data-minus]', li); // keeps its space when off, so the + never moves
          minus.classList.toggle('off', !on);
          minus.setAttribute('aria-hidden', String(!on));
          minus.tabIndex = on ? 0 : -1;
          if (only) { li.classList.remove('pop'); void li.offsetWidth; if (on) li.classList.add('pop'); }
        }
        const t = totalsFor(chain, sel);
        const n = picked(chain, sel).length;
        $$('[data-t]', body).forEach((d) => { d.textContent = d.dataset.t === 'kcal' ? num(t.kcal) : `${Math.round(t[d.dataset.t])} g`; });
        settleTicks(body);
        const add = $('[data-add]', body);
        add.disabled = !n;
        add.textContent = n ? `Add · ${num(t.kcal)} kcal` : 'Pick something';
      };
      $$('[data-item]', body).forEach((li) => {
        const half = halfOf.get(chain.items.find((i) => i.id === li.dataset.item).group);
        $('[data-plus]', li).onclick = () => { haptics.select(); const id2 = li.dataset.item; set(id2, stepQty(sel[id2] || 0, 1, half)); };
        $('[data-minus]', li).onclick = () => { haptics.select(); const id2 = li.dataset.item; set(id2, stepQty(sel[id2] || 0, -1, half)); };
      });
      $('[data-back]', body).onclick = () => { haptics.select(); chainList(); };
      bindFallback();
      $('[data-add]', body).onclick = () => { if (picked(chain, sel).length) { haptics.select(); showConfirm(); } };
      paint();
      };
      // Step 2: pick the meal where you can see it, name the order, choose whether it's a Favorite, then log it.
      const showConfirm = () => {
        const t = totalsFor(chain, sel);
        const label = () => `Log to ${MEAL_LABEL[mealPick].toLowerCase()} · ${num(t.kcal)} kcal`;
        body.innerHTML = `
          <div class="stack rest-build">
            <button type="button" class="btn ghost rest-back" data-edit>${icon('back', { size: 18 })}<span>Change order</span></button>
            <h2 class="rest-title">${esc(chain.name)} · ${num(t.kcal)} kcal</h2>
            <p class="small muted">${esc(orderSummary(chain, sel, 200))}</p>
            <div class="meal-chips" role="radiogroup" aria-label="Meal">${MEALS.map((m) => `<button type="button" class="chip-btn" role="radio" data-meal="${m}">${MEAL_LABEL[m]}</button>`).join('')}</div>
            <label class="field"><span>Name this order</span><input name="oname" maxlength="80" autocomplete="off" value="${esc(ownName)}" placeholder="${esc(orderName(chain, sel, ''))}"></label>
            <label class="rest-fav"><input type="checkbox" name="fav"${makeFav ? ' checked' : ''}><span>Save as a Favorite so it shows first in search</span></label>
            <p class="error" data-err aria-live="polite"></p>
          </div>
          <div class="rest-dock"><button class="btn" data-log>${label()}</button></div>`;
        const syncMeal = () => {
          $$('[data-meal]', body).forEach((b) => { const on = b.dataset.meal === mealPick; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
          $('[data-log]', body).textContent = label();
        };
        const keep = () => { ownName = $('[name=oname]', body).value; makeFav = $('[name=fav]', body).checked; };
        $$('[data-meal]', body).forEach((b) => { b.onclick = () => { haptics.select(); mealPick = b.dataset.meal; syncMeal(); }; });
        $('[data-edit]', body).onclick = () => { haptics.select(); keep(); showBuilder(); };
        syncMeal();
        $('[data-log]', body).onclick = () => {
          keep();
          const clean = cleanFood(favoriteFood(chain, sel, ownName));
          if (!clean.ok) { $('[data-err]', body).textContent = clean.error; return; }
          const f = clean.food;
          let food_id;
          if (makeFav) {
            const same = findSameFood(state.foods, f);
            if (same) food_id = same.id;
            else { const rec = newRecord({ ...f }); put('foods', rec); food_id = rec.id; }
          }
          put('food_logs', newRecord(logFields({ item: { name: f.name, kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g, portion: f.serving, brand: chain.name, ...(food_id ? { food_id } : {}) }, servings: 1, meal: mealPick, day })));
          haptics.success();
          close();
          toast(`Added to ${MEAL_LABEL[mealPick].toLowerCase()} · ${num(f.kcal)} kcal${food_id ? ' · saved' : ''}`, 2800, { icon: 'check' });
        };
      };
      showBuilder();
      head.expand?.();
    };
    chainList();
  }, { detents: ['medium', 'large'] });
}
