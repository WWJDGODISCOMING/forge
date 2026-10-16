// Snap a meal (v0.15.26): photo → analyzing → editable rows → Log meal. The photo is shrunk on this phone, sent to the
// snapMealPhoto function and dropped; Forge keeps only the foods you log. The maths is in js/food/snap.js.
import { state } from '../state.js';
import { put, newRecord } from '../db.js';
import { esc, $, $$, sheet, toast, todayKey } from '../ui.js';
import { icon } from '../ui/icons.js';
import { MEALS, MEAL_LABEL, mealForHour } from '../food/core.js';
import { servingsLabel } from '../food/portion.js';
import { createOnlineSearch } from '../food/search.js';
import { ESTIMATE_NOTE, estimateMeal, upstreamTag, isUnsure, mealFields, prepareImage, removeRow, rowMacros, stepRow, swapRow, totalsOfRows } from '../food/snap.js';

/** A heading for the real cause, so a busy server never reads as a bad photo. */
export function errorHeading(message = '', code = '') {
  if (/offline/i.test(message)) return 'You’re offline';
  if (code === 'resource-exhausted') return 'Photo limit for now';
  if (code === 'failed-precondition') return 'No food spotted';
  if (code === 'invalid-argument' || /couldn’t be opened/.test(message)) return 'Couldn’t read that one';
  return 'No estimate this time';
}

const num = (n) => Math.round(n).toLocaleString('en-US');

/** The hidden file input behind every "Take photo" button. No `capture`: iPhone then offers Take Photo, Photo Library and Files. */
export const photoInput = (attr = 'data-snap-file') => `<input type="file" accept="image/*" ${attr} hidden>`;

export function openSnapMeal({ file = null, day = todayKey(), meal } = {}) {
  const now = new Date();
  let mealSel = meal || mealForHour(now.getHours() + now.getMinutes() / 60);
  let rows = [];
  let swapping = null; // the row id whose USDA match list is open
  let live = true; // false once the sheet is closed: a late answer is dropped
  let preview = '';
  let online = null;

  sheet('Snap a meal', (body, closeSheet) => {
    const close = () => { live = false; if (online) online.cancel(); if (preview) URL.revokeObjectURL(preview); closeSheet(); };
    const dlg = body.closest('dialog');
    if (dlg) dlg.addEventListener('close', () => { live = false; if (preview) URL.revokeObjectURL(preview); });
    body.innerHTML = '<div class="stack snap" data-snap></div>';
    const root = $('[data-snap]', body);

    const thumb = () => (preview ? `<img class="snap-thumb" src="${preview}" alt="Your photo">` : '');

    const paintPicker = () => {
      root.innerHTML = `
        <div class="snap-pick">
          <span class="snap-pick-ic" aria-hidden="true">${icon('camera', { size: 32 })}</span>
          <b>Snap your plate</b>
          <p class="small muted">Forge guesses the foods, portions and calories. ${ESTIMATE_NOTE}.</p>
          <label class="btn bigbtn snap-take">${icon('camera')}Take photo${photoInput()}</label>
          <p class="small muted">Camera or photo library. The photo isn’t saved; only the meal you log is.</p>
        </div>`;
      $('[data-snap-file]', root).onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) start(f); };
    };

    const paintAnalyzing = () => {
      root.innerHTML = `
        <div class="snap-wait" role="status" aria-live="polite">
          ${thumb()}
          <div class="snap-scan" aria-hidden="true"><i></i></div>
          <b>Looking at your plate…</b>
          <p class="small muted">Spotting foods and sizing portions. This takes a few seconds.</p>
          <div class="snap-skels" aria-hidden="true">${'<div class="snap-skel"><i class="skeleton"></i><i class="skeleton"></i></div>'.repeat(3)}</div>
        </div>`;
    };

    const paintError = (message, code = '', tag = '') => {
      const head = errorHeading(message, code);
      root.innerHTML = `
        <div class="snap-err" data-snap-error>
          ${thumb()}
          <b>${esc(head)}</b>
          <p class="small" role="alert">${esc(message)}</p>
          ${tag ? `<small class="muted" data-snap-diag>${esc(tag)}</small>` : ''}
          <label class="btn bigbtn snap-take">${icon('camera')}Try another photo${photoInput()}</label>
          <button class="btn ghost" data-snap-search>Search for the food instead</button>
        </div>`;
      $('[data-snap-file]', root).onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) start(f); };
      $('[data-snap-search]', root).onclick = () => { close(); setTimeout(() => import('./food.js').then((m) => m.openLogFood({ day, meal: mealSel })), 0); };
    };

    const rowHtml = (r) => {
      const m = rowMacros(r);
      const portion = r.portion ? (r.qty === 1 ? r.portion : `${servingsLabel(r.qty)} × ${r.portion}`) : `${servingsLabel(r.qty)} ${r.qty === 1 ? 'serving' : 'servings'}`;
      return `<li class="snap-row" data-row="${r.id}">
        <div class="snap-row-top">
          <div class="food-row"><b class="clamp2">${esc(r.name)}</b>
            <small class="food-sub"><span class="food-kcal">${num(m.kcal)} kcal</span><span class="food-kcal">${Math.round(m.protein_g)} g protein</span><span class="food-serv">${esc(portion)}</span></small>
            ${isUnsure(r) ? '<small class="snap-unsure">Not sure about this one. Check it.</small>' : ''}</div>
        </div>
        <div class="snap-row-bar">
          <span class="serv-stepper"><button type="button" class="icon-btn" data-minus aria-label="Smaller portion of ${esc(r.name)}">${icon('minus')}</button><output aria-live="polite">${esc(servingsLabel(r.qty))}×</output><button type="button" class="icon-btn" data-plus aria-label="Bigger portion of ${esc(r.name)}">${icon('plus')}</button></span>
          <span class="snap-acts"><button type="button" class="icon-btn" data-swap aria-label="Swap ${esc(r.name)} for a USDA match" aria-expanded="${swapping === r.id}">${icon('swap')}</button>
          <button type="button" class="icon-btn" data-remove aria-label="Remove ${esc(r.name)}">${icon('trash')}</button></span>
        </div>
        ${swapping === r.id ? `<div class="snap-swap" data-swap-panel>
          <label class="field"><input type="search" data-swap-q value="${esc(r.name)}" autocomplete="off" aria-label="Search USDA foods"></label>
          <ul class="list food-results" data-swap-list></ul>
          <p class="small muted" data-swap-note role="status" aria-live="polite"></p></div>` : ''}
      </li>`;
    };

    const paintResults = () => {
      const t = totalsOfRows(rows);
      root.innerHTML = `
        <div class="snap-top">${thumb()}<div class="snap-head"><b>${rows.length} ${rows.length === 1 ? 'food' : 'foods'} spotted</b><small class="muted">${ESTIMATE_NOTE}</small></div>
          <label class="btn ghost snap-again">${icon('camera')}<span class="snap-again-t">Retake photo</span>${photoInput()}</label></div>
        ${rows.length ? `<ul class="list snap-rows">${rows.map(rowHtml).join('')}</ul>` : '<p class="small muted">Everything is removed. Take another photo or close this.</p>'}
        <div class="snap-foot">
          <p class="small muted macro-line"><span class="nb">${num(t.kcal)} kcal</span> <span class="nb">· ${t.protein_g} g protein</span> <span class="nb">· ${t.carbs_g} g carbs</span> <span class="nb">· ${t.fat_g} g fat</span></p>
          <div class="meal-chips" role="radiogroup" aria-label="Meal">${MEALS.map((m) => `<button type="button" class="chip-btn ${m === mealSel ? 'on' : ''}" role="radio" aria-checked="${m === mealSel}" data-meal="${m}">${MEAL_LABEL[m]}</button>`).join('')}</div>
          <button class="btn" data-log ${mealFields(rows, { meal: mealSel, day }).length ? '' : 'disabled'}>Log meal · ${num(t.kcal)} kcal</button>
        </div>`;
      $$('[data-meal]', root).forEach((b) => { b.onclick = () => { mealSel = b.dataset.meal; paintResults(); }; });
      $('[data-snap-file]', root).onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) start(f); };
      $('[data-log]', root).onclick = () => {
        const fields = mealFields(rows, { meal: mealSel, day });
        if (!fields.length) return;
        for (const f of fields) put('food_logs', newRecord(f));
        close();
        toast(`Logged ${fields.length} ${fields.length === 1 ? 'food' : 'foods'} to ${MEAL_LABEL[mealSel].toLowerCase()} · ${num(t.kcal)} kcal`);
      };
      const swapLi = swapping && $$('[data-row]', root).find((li) => li.dataset.row === swapping);
      if (swapLi) openSwap(swapLi, swapping); // once, from the freshly painted row
      $$('[data-row]', root).forEach((li) => {
        const id = li.dataset.row;
        const edit = (fn) => { rows = rows.map((r) => (r.id === id ? fn(r) : r)); paintResults(); };
        $('[data-minus]', li).onclick = () => edit((r) => stepRow(r, -1));
        $('[data-plus]', li).onclick = () => edit((r) => stepRow(r, 1));
        $('[data-remove]', li).onclick = () => { if (online) online.cancel(); swapping = null; rows = removeRow(rows, id); paintResults(); };
        $('[data-swap]', li).onclick = () => { if (online) online.cancel(); swapping = swapping === id ? null : id; paintResults(); };
      });
    };

    function openSwap(li, id) {
      const list = $('[data-swap-list]', li);
      const note = $('[data-swap-note]', li);
      let items = [];
      online = createOnlineSearch({
        onUpdate: (u) => {
          if (!live || !list.isConnected) return;
          if (u.state === 'loading') { note.textContent = 'Searching…'; return; }
          if (u.state === 'idle') { items = []; list.innerHTML = ''; note.textContent = 'Type a food to search.'; return; }
          if (u.state !== 'ok') { items = []; list.innerHTML = ''; note.textContent = u.state === 'offline' ? 'Searching needs a connection. Your estimate still works.' : u.message || 'USDA search isn’t available right now. Your estimate still works.'; return; }
          items = u.items.slice(0, 5);
          note.textContent = items.length ? '' : 'No matches. Try other words.';
          list.innerHTML = items.map((it, i) => `<li class="tap" data-pick="${i}" role="button" tabindex="0"><div class="food-row"><b class="clamp2">${esc(it.title)}</b><small class="food-sub">${it.brand ? `<span class="food-brand"><i>${esc(it.brand)}</i></span>` : ''}<span class="food-kcal">${num(it.kcal)} kcal</span><span class="food-serv">${esc(it.serving)}</span></small></div></li>`).join('');
        },
      });
      const pickAt = (e) => { const p = e.target.closest('[data-pick]'); if (!p) return; const it = items[Number(p.dataset.pick)]; if (!it) return; online.cancel(); swapping = null; rows = rows.map((r) => (r.id === id ? swapRow(r, it) : r)); paintResults(); };
      list.addEventListener('click', pickAt);
      list.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickAt(e); } });
      const q = $('[data-swap-q]', li);
      q.addEventListener('input', () => online.query(q.value));
      online.query(q.value);
    }

    async function start(f) {
      if (preview) URL.revokeObjectURL(preview);
      preview = URL.createObjectURL(f);
      swapping = null;
      paintAnalyzing();
      try {
        const b64 = await prepareImage(f);
        if (!live) return;
        const { call } = await import('../functions.js');
        rows = await estimateMeal(b64, call);
        if (!live) return;
        paintResults();
      } catch (e) {
        if (!live) return;
        paintError((e && e.message) || 'Something went wrong. Try again in a minute.', (e && e.code) || '', upstreamTag(e));
      }
    }

    if (file) start(file); else paintPicker();
  });
}
