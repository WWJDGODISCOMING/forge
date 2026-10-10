// Food (v0.11.0): today's totals against your targets, the day's meals, and the Log food sheet.
// It lives under the Today tab (#/food, reached from the Food card on Today) so the tab bar stays at five.
// Log food searches My foods and recents instantly, then USDA FoodData Central a moment later (js/food/search.js).
import { state, units } from '../state.js';
import { put, patch, softDelete, newRecord } from '../db.js';
import { esc, $, $$, sheet, toast, confirmSheet, todayKey, formatDay } from '../ui.js';
import { currentTargets } from '../derived.js';
import { icon, emptyState } from '../ui/icons.js';
import { MEAL_LABEL, MEALS, cleanFood, copyMealFields, dayBefore, dayTotals, groupByMeal, progress, stepServings } from '../food/core.js';
import { createFlow } from '../food/flow.js';
import { search, createOnlineSearch } from '../food/search.js';
import { SERVING_CHOICES, amountLabel, gramsFromAmount, gramsToOz, measureServing, portionItem, servingsLabel } from '../food/portion.js';

let viewDay = null; // the day shown; null = today
const dayShown = () => (viewDay && viewDay <= todayKey() ? viewDay : todayKey());
const fmtNum = (n) => Math.round(n * 100) / 100;
const grams = (n) => `${Math.round(n)} g`;
let lastUnit = 'serv'; // the portion unit you used last (servings, oz or g), kept while the app is open

function itemLine(it) {
  const bits = it.brand ? [it.brand] : [];
  bits.push(`${Math.round(it.kcal).toLocaleString('en-US')} kcal`);
  if (it.protein_g) bits.push(`${Math.round(it.protein_g)} g protein`);
  if (it.serving) bits.push(it.serving);
  return bits.join(' · ');
}

/** One-line grey text under a food name: brand (shortens first), the numbers that never split, then the portion. */
function subLine({ brand, kcal, protein, portion }) {
  const span = (cls, t) => `<span class="${cls}">${esc(t)}</span>`;
  return `<small class="food-sub muted">${brand ? `<span class="food-brand"><i>${esc(brand)}</i></span>` : ''}${kcal == null ? '' : span('food-kcal', `${Math.round(kcal).toLocaleString('en-US')} kcal`)}${protein ? span('food-kcal', `${Math.round(protein)} g protein`) : ''}${portion ? span('food-serv', portion) : ''}</small>`;
}

/** A logged entry's grey line. The calories are the number on the right, so they aren't repeated here. */
function entryLine(e) {
  const n = e.servings;
  const portion = e.portion ? (n === 1 ? e.portion : `${servingsLabel(n)} × ${e.portion}`) : `${fmtNum(n)} ${n === 1 ? 'serving' : 'servings'}`;
  return subLine({ brand: e.brand, protein: e.protein_g * n, portion });
}

const stepBtns = (out = '') => `<button type="button" class="icon-btn" data-minus aria-label="Fewer servings">${icon('minus')}</button><output data-serv aria-live="polite">${out}</output><button type="button" class="icon-btn" data-plus aria-label="More servings">${icon('plus')}</button>`;

function meter(label, value, target, unit, { big = false } = {}) {
  const p = progress(value, target);
  const pct = p ? Math.min(100, Math.max(0, p.pct)) : 0;
  const over = p && p.pct > 110;
  return `<div class="meter-row ${big ? 'meter-row--big' : ''}">
    <div class="row between"><span class="label">${label}</span>
      <span class="${big ? 'meter-val' : 'small'}"><b>${unit === 'kcal' ? Math.round(value).toLocaleString('en-US') : grams(value)}</b>${target ? ` <span class="muted">of ${unit === 'kcal' ? target.toLocaleString('en-US') + ' kcal' : grams(target)}</span>` : ''}</span></div>
    <div class="meter ${over ? 'over' : ''}" role="img" aria-label="${esc(label)}: ${p ? `${p.pct}% of your target` : 'no target'}"><i style="width:${pct}%"></i></div>
  </div>`;
}

export function renderFood(el) {
  const day = dayShown();
  const isToday = day === todayKey();
  const t = currentTargets();
  const tot = dayTotals(state.food_logs, day);
  const groups = groupByMeal(state.food_logs, day);
  const yesterday = dayBefore(day);
  const yGroups = groupByMeal(state.food_logs, yesterday);
  const anything = groups.some((g) => g.entries.length);

  el.innerHTML = `
    <section class="stack food">
      <h1>Food</h1>
      ${state.foodError ? `<div class="card" data-food-error><p class="label">Food isn’t switched on yet</p>
        <p class="small muted">The database said no (${esc(state.foodError)}). Food needs the new security rules published: run <code>firebase deploy --only firestore:rules</code> (DEPLOY.md, “If an update changes firestore.rules”). Nothing else in the app is affected.</p></div>` : ''}
      <div class="row between center week-nav">
        <button class="btn ghost" data-prev aria-label="Previous day">${icon('back')}</button>
        <div style="text-align:center"><b>${isToday ? 'Today' : formatDay(day, { weekday: 'short', month: 'short', day: 'numeric' })}</b></div>
        <button class="btn ghost" data-next aria-label="Next day" ${isToday ? 'disabled' : ''}>${icon('chev')}</button>
      </div>
      <div class="card stack" data-food-totals>
        ${meter('Calories', tot.kcal, t && t.calories, 'kcal', { big: true })}
        ${meter('Protein', tot.protein_g, t && t.proteinG, 'g', { big: true })}
        <div class="food-minor">
          ${meter('Carbs', tot.carbs_g, t && t.carbG, 'g')}
          ${meter('Fat', tot.fat_g, t && t.fatG, 'g')}
        </div>
      </div>
      <button class="btn bigbtn" data-log-food>${icon('plus')}Log food</button>
      ${anything ? '' : emptyState({ icon: 'food', title: isToday ? 'Nothing logged yet today' : 'Nothing logged this day', text: 'Tap Log food. If you don’t know the numbers, “Quick add” takes just calories.' })}
      ${anything || !yGroups.some((y) => y.entries.length) ? '' : '<button class="btn ghost" data-copy-day>Copy yesterday</button>'}
      ${anything ? groups.map((g) => {
        const canCopy = !g.entries.length && yGroups.find((y) => y.meal === g.meal).entries.length;
        return `<div class="food-meal" data-meal="${g.meal}">
          <div class="row between center food-meal-head">
            <h2>${g.label}</h2>
            <span class="row gap center"><span class="small muted">${g.entries.length ? `${g.totals.kcal.toLocaleString('en-US')} kcal` : ''}</span>
              ${canCopy ? `<button class="btn ghost small-btn" data-copy="${g.meal}">Copy yesterday</button>` : ''}
              <button class="btn ghost small-btn" data-add-meal="${g.meal}" aria-label="Add to ${g.label.toLowerCase()}">Add</button></span>
          </div>
          ${g.entries.length ? `<ul class="list">${g.entries.map((e) => `
            <li class="tap" data-entry="${esc(e.id)}"><div class="food-row"><b class="clamp2">${esc(e.name)}</b>
              ${entryLine(e)}</div>
              <b>${Math.round(e.kcal * e.servings).toLocaleString('en-US')}</b></li>`).join('')}</ul>` : ''}
        </div>`;
      }).join('') : ''}
      <div class="group"><button class="g-row" data-my-foods><span class="g-ic">${icon('list')}</span><span class="g-text"><span>My foods</span><small>${state.foods.length ? `${state.foods.length} saved` : 'Save the things you eat often'}</small></span><span class="chev" aria-hidden="true">${icon('chev')}</span></button></div>
      <p class="disclaimer">General fitness information, not medical advice.</p>
    </section>`;

  $('[data-prev]', el).onclick = () => { viewDay = dayBefore(day); renderFood(el); };
  $('[data-next]', el).onclick = () => {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    viewDay = d.toISOString().slice(0, 10);
    renderFood(el);
  };
  $('[data-log-food]', el).onclick = () => openLogFood({ day });
  $('[data-my-foods]', el).onclick = () => openMyFoods();
  $$('[data-add-meal]', el).forEach((b) => { b.onclick = () => openLogFood({ day, meal: b.dataset.addMeal }); });
  const copyDay = $('[data-copy-day]', el);
  if (copyDay) copyDay.onclick = () => {
    let n = 0;
    for (const m of MEALS) for (const f of copyMealFields(state.food_logs, yesterday, day, m)) { put('food_logs', newRecord(f)); n++; }
    toast(`Copied ${n} ${n === 1 ? 'item' : 'items'} from yesterday`);
  };
  $$('[data-copy]', el).forEach((b) => {
    b.onclick = () => {
      const fields = copyMealFields(state.food_logs, yesterday, day, b.dataset.copy);
      for (const f of fields) put('food_logs', newRecord(f));
      toast(`Copied ${fields.length} ${fields.length === 1 ? 'item' : 'items'} to ${MEAL_LABEL[b.dataset.copy].toLowerCase()}`);
    };
  });
  $$('[data-entry]', el).forEach((li) => {
    li.onclick = () => {
      const e = state.food_logs.find((x) => x.id === li.dataset.entry);
      if (e) openEditEntry(e);
    };
  });
}

/** The Log food sheet. Tap 1 opens it (caller), tap 2 picks a food, tap 3 adds it. */
export function openLogFood({ day = todayKey(), meal } = {}) {
  const now = new Date();
  const flow = createFlow({ foods: state.foods, logs: state.food_logs, hour: now.getHours() + now.getMinutes() / 60, day });
  if (meal) flow.setMeal(meal);
  sheet('Log food', (body, close) => {
    body.innerHTML = `
      <div class="stack food-log">
        <label class="field">
          <input type="search" name="q" placeholder="Search foods" autocomplete="off" autocapitalize="off" enterkeyhint="search" aria-label="Search foods"></label>
        <div class="food-scroll">
          <ul class="list food-results" data-results></ul>
          <section class="food-online" data-online hidden aria-label="USDA results">
            <h3 class="food-online-head" data-online-head>From USDA FoodData Central</h3>
            <ul class="list food-results" data-online-list></ul>
            <p class="small muted food-online-note" data-online-note role="status" aria-live="polite"></p>
          </section>
        </div>
        <button class="btn ghost" data-quick-toggle>Quick add: just calories</button>
        <form class="stack" data-quick hidden novalidate>
          <div class="field-grid">
            <label class="field"><span>Calories</span><input name="kcal" type="number" inputmode="numeric" min="1" max="5000" placeholder="600"></label>
            <label class="field"><span>Protein (g, optional)</span><input name="p" type="number" inputmode="decimal" min="0" max="500"></label>
          </div>
          <p class="error" aria-live="polite"></p>
          <button class="btn" type="submit">Add</button>
        </form>
        <div class="food-dock" data-dock hidden>
          <div class="row between center food-dock-head"><div class="food-dock-title"><b class="clamp2" data-sel-name></b><small class="muted" data-sel-brand hidden></small></div>
            <span class="serv-stepper" data-stepper>${stepBtns('1')}</span></div>
          <div class="portion" data-portion hidden>
            <div class="serv-chips" role="radiogroup" aria-label="Servings">${SERVING_CHOICES.map((n) => `<button type="button" class="chip-btn" role="radio" data-serv-choice="${n}">${servingsLabel(n)}</button>`).join('')}</div>
            <p class="portion-cap" data-measures-cap hidden>Serving size</p>
            <div class="serv-chips serv-chips--wrap" role="radiogroup" aria-label="Serving size" data-measures hidden></div>
            <div class="portion-amount">
              <label class="field"><input type="text" inputmode="decimal" autocomplete="off" data-amount aria-label="Amount"></label>
              <div class="unit-seg" role="radiogroup" aria-label="Unit">${(units() === 'metric' ? ['serv', 'g', 'oz'] : ['serv', 'oz', 'g']).map((u) => `<button type="button" role="radio" data-unit="${u}">${u === 'serv' ? 'servings' : u}</button>`).join('')}</div>
            </div>
            <p class="small muted" data-portion-note></p>
          </div>
          <p class="small muted macro-line" data-sel-line></p>
          <div class="meal-chips" role="radiogroup" aria-label="Meal">${MEALS.map((m) => `<button type="button" class="chip-btn" role="radio" data-meal="${m}">${MEAL_LABEL[m]}</button>`).join('')}</div>
          <button class="btn" data-add></button>
        </div>
      </div>`;
    const results = $('[data-results]', body);
    const dock = $('[data-dock]', body);
    const onlineBox = $('[data-online]', body);
    const onlineHead = $('[data-online-head]', body);
    const onlineList = $('[data-online-list]', body);
    const onlineNote = $('[data-online-note]', body);
    const amountEl = $('[data-amount]', dock);
    let items = []; // My foods and recents
    let onlineItems = []; // USDA
    let portion = null; // while a USDA food is picked: { base, serving: {g, text}, unit: 'serv' | 'oz' | 'g', servings, grams }

    const plain = (n) => String(Math.round(n * 100) / 100);
    const applyPortion = () => {
      const { base, unit, servings, grams } = portion;
      flow.f.selected = portionItem(base, { serving: portion.serving, ...(unit === 'serv' ? { mode: 'servings', servings } : { mode: 'weight', unit, grams }) });
      flow.f.servings = 1;
    };
    const paintPortion = (keepTyped = false) => {
      const { serving, unit, servings, grams } = portion;
      $$('[data-measure]', dock).forEach((b) => { const on = measureServing(portion.base.usda.measures[Number(b.dataset.measure)]).text === serving.text; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      $$('[data-serv-choice]', dock).forEach((b) => { const on = unit === 'serv' && Number(b.dataset.servChoice) === servings; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      $$('[data-unit]', dock).forEach((b) => { const on = b.dataset.unit === unit; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      if (!keepTyped) amountEl.value = unit === 'serv' ? plain(servings) : unit === 'oz' ? String(Math.round(gramsToOz(grams) * 10) / 10) : String(Math.round(grams));
      // With a chip row the selected chip already names the measure, so the note stays short; "(86 g)" never orphans.
      const chips = portion.base.usda.measures.length >= 2;
      const m = /^(.*?)(\s*\(\d[^()]*\))$/.exec(serving.text);
      const named = chips ? `${plain(serving.g)} g` : (m ? `${esc(m[1])} <span class="nowrap">${esc(m[2].trim())}</span>` : esc(serving.text));
      $('[data-portion-note]', dock).innerHTML = unit === 'serv'
        ? `1 serving = ${named}`
        : `${esc(amountLabel(grams, unit === 'oz' ? 'g' : 'oz'))} · 1 serving = ${named}`;
    };
    const paintMeasures = () => {
      const box = $('[data-measures]', dock);
      const ms = portion.base.usda.measures;
      box.hidden = ms.length < 2;
      $('[data-measures-cap]', dock).hidden = box.hidden;
      box.innerHTML = ms.map((m, i) => `<button type="button" class="chip-btn" role="radio" data-measure="${i}">${esc(m.text)}</button>`).join('');
    };
    const setPortion = (patch) => { portion = { ...portion, ...patch }; lastUnit = portion.unit; applyPortion(); paintPortion(); paintDock(); };

    const paintMeal = () => {
      $$('[data-meal]', dock).forEach((b) => { const on = b.dataset.meal === flow.f.meal; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      $('[data-add]', dock).textContent = `Add to ${MEAL_LABEL[flow.f.meal].toLowerCase()}`;
    };
    const paintDock = () => {
      const s = flow.f.selected;
      dock.hidden = !s;
      if (!s) return;
      const usda = !!portion;
      $('[data-stepper]', dock).hidden = usda;
      $('[data-portion]', dock).hidden = !usda;
      $('[data-sel-name]', dock).textContent = s.name;
      const brandEl = $('[data-sel-brand]', dock);
      brandEl.textContent = s.brand || '';
      brandEl.hidden = !s.brand;
      const macro = (n, unit) => `<span class="nb">${n.toLocaleString('en-US')}\u00a0${unit}</span>`;
      const selLine = (parts) => parts.join(' <span aria-hidden="true">·</span> ');
      if (usda) {
        $('[data-sel-line]', dock).innerHTML = selLine([macro(s.kcal, 'kcal'), macro(Math.round(s.protein_g), 'g\u00a0protein'), macro(Math.round(s.carbs_g), 'g\u00a0carbs'), macro(Math.round(s.fat_g), 'g\u00a0fat')]);
      } else {
        $('[data-serv]', dock).textContent = `${fmtNum(flow.f.servings)} ${flow.f.servings === 1 ? 'serving' : 'servings'}`;
        $('[data-sel-line]', dock).innerHTML = selLine([macro(Math.round(s.kcal * flow.f.servings), 'kcal'), macro(Math.round(s.protein_g * flow.f.servings), 'g\u00a0protein')].concat(s.serving ? [`<span class="nb">${esc(s.serving)}\u00a0each</span>`] : []));
      }
      $('[data-add]', dock).disabled = false;
      paintMeal();
    };
    const paintResults = async () => {
      const q = flow.f.query.trim();
      items = await search(flow.f.query, { foods: state.foods, logs: state.food_logs });
      const picked = (it) => (flow.f.selected && flow.f.selected.key === it.key ? 'picked' : '');
      results.innerHTML = items.length ? items.map((it, i) => `
        <li class="tap ${picked(it)}" data-i="${i}" role="button" tabindex="0">
          <div class="food-row"><b class="clamp2">${esc(it.name)}</b>${subLine({ brand: it.brand, kcal: it.kcal, protein: it.protein_g, portion: it.serving })}</div>
          <span class="muted">${it.kind === 'recent' ? 'Recent' : ''}</span></li>`).join('')
        : q.length >= 2 ? '' // the USDA section below speaks for itself
          : `<li class="food-none"><div><b>${q ? 'No match in your foods' : 'Nothing saved yet'}</b><small class="muted">${q ? 'Try Quick add, or save it in My foods.' : 'Type a food to search the USDA database, or use Quick add.'}</small></div></li>`;
    };
    const paintOnline = (u) => {
      if (u.state === 'idle') { onlineItems = []; onlineBox.hidden = true; return; }
      onlineBox.hidden = false;
      onlineBox.setAttribute('aria-busy', String(u.state === 'loading'));
      if (u.state === 'loading') {
        onlineNote.textContent = '';
        if (onlineItems.length) { onlineList.classList.add('stale'); return; } // keep the old rows (dimmed) so the list doesn't jump
        onlineHead.hidden = false;
        onlineList.innerHTML = '<li class="food-skel" aria-hidden="true"><div class="food-row"><i class="skeleton food-skel-name"></i><i class="skeleton food-skel-sub"></i></div></li>'.repeat(3);
        return;
      }
      onlineList.classList.remove('stale');
      if (u.state !== 'ok') {
        onlineItems = [];
        onlineHead.hidden = true;
        onlineList.innerHTML = '';
        onlineNote.textContent = u.state === 'offline' ? 'Online search needs a connection' : u.state === 'limited' && u.message ? u.message : 'Online search isn’t available right now';
        return;
      }
      onlineItems = u.items;
      onlineHead.hidden = !onlineItems.length;
      onlineList.innerHTML = onlineItems.map((it, i) => `
        <li class="tap ${flow.f.selected && flow.f.selected.key === it.key ? 'picked' : ''}" data-o="${i}" role="button" tabindex="0">
          <div class="food-row"><b class="food-name">${esc(it.title)}</b>
            <small class="food-sub">${it.brand ? `<span class="food-brand"><i>${esc(it.brand)}</i></span>` : ''}<span class="food-kcal">${it.kcal.toLocaleString('en-US')} kcal</span><span class="food-serv">${esc(it.serving)}</span></small></div></li>`).join('');
      onlineNote.textContent = onlineItems.length ? '' : 'No matches in the USDA database.';
    };
    const onlineSearch = createOnlineSearch({ onUpdate: paintOnline });
    const pick = (li) => {
      const isOnline = li.dataset.o !== undefined;
      const it = (isOnline ? onlineItems : items)[Number(isOnline ? li.dataset.o : li.dataset.i)];
      if (!it) return;
      flow.select(it);
      portion = it.usda ? { base: it, serving: it.usda.serving, unit: lastUnit, servings: 1, grams: it.usda.serving.g } : null;
      if (portion) { paintMeasures(); applyPortion(); paintPortion(); }
      paintDock();
      $$('[data-i], [data-o]', body).forEach((x) => x.classList.toggle('picked', x === li));
    };

    for (const list of [results, onlineList]) {
      list.addEventListener('click', (e) => { const li = e.target.closest('[data-i], [data-o]'); if (li) pick(li); });
      list.addEventListener('keydown', (e) => { const li = e.target.closest('[data-i], [data-o]'); if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(li); } });
    }
    $$('[data-serv-choice]', dock).forEach((b) => { b.onclick = () => { const n = Number(b.dataset.servChoice); setPortion({ unit: 'serv', servings: n, grams: n * portion.serving.g }); }; });
    $('[data-measures]', dock).addEventListener('click', (e) => {
      const b = e.target.closest('[data-measure]');
      if (!b || !portion) return;
      const serving = measureServing(portion.base.usda.measures[Number(b.dataset.measure)]);
      setPortion({ serving, ...(portion.unit === 'serv' ? { grams: portion.servings * serving.g } : {}) });
    });
    $$('[data-unit]', dock).forEach((b) => {
      b.onclick = () => {
        const u = b.dataset.unit;
        if (u === portion.unit) return;
        const sg = portion.serving.g;
        if (u === 'serv') { const n = Math.max(0.25, Math.round((portion.grams / sg) * 100) / 100); setPortion({ unit: u, servings: n, grams: n * sg }); } else setPortion({ unit: u });
      };
    });
    amountEl.addEventListener('input', () => {
      if (!portion) return;
      const sg = portion.serving.g;
      const raw = amountEl.value.replace(/,/g, '').trim();
      const n = Number(raw);
      const grams = portion.unit === 'serv' ? (raw && n > 0 && n * sg <= 5000 ? n * sg : null) : gramsFromAmount(raw, portion.unit);
      if (grams === null) { $('[data-add]', dock).disabled = true; return; } // not a usable amount yet: keep what was typed, don't log it
      portion = { ...portion, grams, ...(portion.unit === 'serv' ? { servings: n } : {}) };
      applyPortion();
      paintPortion(true);
      paintDock();
    });
    $('[name=q]', body).addEventListener('input', (e) => { flow.search(e.target.value); paintResults(); onlineSearch.query(e.target.value); });
    $('[data-minus]', dock).onclick = () => { flow.f.servings = stepServings(flow.f.servings, -1); paintDock(); };
    $('[data-plus]', dock).onclick = () => { flow.f.servings = stepServings(flow.f.servings, 1); paintDock(); };
    $$('[data-meal]', dock).forEach((b) => { b.onclick = () => { flow.setMeal(b.dataset.meal); paintMeal(); }; });
    $('[data-add]', dock).onclick = () => {
      const fields = flow.commit();
      if (!fields) return;
      put('food_logs', newRecord(fields));
      close();
      toast(`Added to ${MEAL_LABEL[fields.meal].toLowerCase()} · ${Math.round(fields.kcal * fields.servings).toLocaleString('en-US')} kcal`);
    };

    const quick = $('[data-quick]', body);
    $('[data-quick-toggle]', body).onclick = () => {
      quick.hidden = !quick.hidden;
      if (!quick.hidden) quick.kcal.focus();
    };
    quick.addEventListener('submit', (e) => {
      e.preventDefault();
      const fields = flow.quick(quick.kcal.value, quick.p.value);
      if (!fields) { $('.error', quick).textContent = 'Enter the calories (1 to 5000).'; return; }
      put('food_logs', newRecord(fields));
      close();
      toast(`Added ${fields.kcal} kcal to ${MEAL_LABEL[fields.meal].toLowerCase()}`);
    });
    paintResults();
  });
}

/** Change servings or meal on an entry you already logged, or delete it. */
function openEditEntry(e) {
  let servings = e.servings;
  let meal = e.meal;
  sheet(e.name, (body, close) => {
    body.innerHTML = `
      <div class="stack">
        <p class="small muted" data-line></p>
        <div class="row between center"><b>Servings</b>
          <span class="serv-stepper">${stepBtns()}</span></div>
        <div class="meal-chips" role="radiogroup" aria-label="Meal">${MEALS.map((m) => `<button type="button" class="chip-btn" role="radio" data-meal="${m}">${MEAL_LABEL[m]}</button>`).join('')}</div>
        <button class="btn" data-save>Save</button>
        <button class="btn danger-ghost" data-del>Delete this entry</button>
      </div>`;
    const paint = () => {
      $('[data-serv]', body).textContent = fmtNum(servings);
      $('[data-line]', body).textContent = `${Math.round(e.kcal * servings).toLocaleString('en-US')} kcal · ${Math.round(e.protein_g * servings)} g protein · ${Math.round(e.carbs_g * servings)} g carbs · ${Math.round(e.fat_g * servings)} g fat`;
      $$('[data-meal]', body).forEach((b) => { const on = b.dataset.meal === meal; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    };
    $('[data-minus]', body).onclick = () => { servings = stepServings(servings, -1); paint(); };
    $('[data-plus]', body).onclick = () => { servings = stepServings(servings, 1); paint(); };
    $$('[data-meal]', body).forEach((b) => { b.onclick = () => { meal = b.dataset.meal; paint(); }; });
    $('[data-save]', body).onclick = () => { patch('food_logs', e.id, { servings, meal }); close(); };
    $('[data-del]', body).onclick = () => { softDelete('food_logs', e.id); close(); toast('Removed'); };
    paint();
  });
}

/** My foods: the list, and a form to create or edit one. Editing a food never changes entries you logged. */
export function openMyFoods() {
  sheet('My foods', (body, close) => {
    const list = () => {
      const foods = [...state.foods].sort((a, b) => a.name.localeCompare(b.name));
      body.innerHTML = `
        <div class="stack">
          ${foods.length ? `<ul class="list">${foods.map((f) => `
            <li class="tap" data-id="${esc(f.id)}"><div><b>${esc(f.name)}</b><small class="muted">${esc(itemLine(f))}</small></div>
              <span class="chev" aria-hidden="true">${icon('chev')}</span></li>`).join('')}</ul>`
            : '<p class="muted">Nothing saved yet. Add the foods you eat often and they’ll be one tap away in Log food.</p>'}
          <button class="btn" data-new>${icon('plus')}New food</button>
        </div>`;
      $$('[data-id]', body).forEach((li) => { li.onclick = () => form(state.foods.find((f) => f.id === li.dataset.id)); });
      $('[data-new]', body).onclick = () => form(null);
    };
    const form = (food) => {
      const v = food || { name: '', serving: '', kcal: '', protein_g: '', carbs_g: '', fat_g: '' };
      body.innerHTML = `
        <form class="stack" novalidate>
          <label class="field"><span>Name</span><input name="name" maxlength="80" value="${esc(v.name)}" autocomplete="off" placeholder="Greek yoghurt"></label>
          <label class="field"><span>Serving</span><input name="serving" maxlength="40" value="${esc(v.serving)}" autocomplete="off" placeholder="1 cup, 100 g…"></label>
          <p class="small muted">Numbers are for one serving.</p>
          <div class="field-grid">
            <label class="field"><span>Calories</span><input name="kcal" type="number" inputmode="numeric" min="0" max="5000" value="${v.kcal}"></label>
            <label class="field"><span>Protein (g)</span><input name="protein_g" type="number" inputmode="decimal" min="0" max="500" value="${v.protein_g}"></label>
            <label class="field"><span>Carbs (g)</span><input name="carbs_g" type="number" inputmode="decimal" min="0" max="500" value="${v.carbs_g}"></label>
            <label class="field"><span>Fat (g)</span><input name="fat_g" type="number" inputmode="decimal" min="0" max="500" value="${v.fat_g}"></label>
          </div>
          <p class="error" aria-live="polite"></p>
          <button class="btn" type="submit">Save</button>
          <button class="btn ghost" type="button" data-back>Back to the list</button>
          ${food ? '<button class="btn danger-ghost" type="button" data-del>Delete this food</button>' : ''}
        </form>`;
      const f = $('form', body);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const r = cleanFood(Object.fromEntries(new FormData(f)));
        if (!r.ok) { $('.error', body).textContent = r.error; return; }
        if (food) patch('foods', food.id, r.food);
        else put('foods', newRecord(r.food));
        toast(food ? 'Saved' : `Saved ${r.food.name}`);
        close();
      });
      $('[data-back]', body).onclick = list;
      const del = $('[data-del]', body);
      if (del) del.onclick = async () => {
        if (!(await confirmSheet({ title: 'Delete this food?', message: 'Entries you already logged keep their numbers.', confirmLabel: 'Delete', danger: true }))) return;
        softDelete('foods', food.id);
        close();
        toast('Deleted');
      };
    };
    list();
  });
}
