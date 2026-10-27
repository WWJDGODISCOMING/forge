// Exercise library: search, filter by location and movement, favorites, "never suggest", custom exercises.
import { state } from '../state.js';
import { esc, $, $$, sheet, toast } from '../ui.js';
import { allExercises, exerciseById } from '../workouts/library.js';
import { activeLocation } from '../workouts/plan.js';
import { expandEquipment, canDo, EQUIPMENT_GROUPS } from '../workouts/equipment.js';
import { MUSCLES, MUSCLE_LABELS } from '../workouts/recovery.js';
import { PATTERN_LABELS, equipmentText } from './picker.js';
import { openHowTo } from './session.js';
import { put, patch, softDelete, newRecord } from '../db.js';
import { icon, emptyState } from '../ui/icons.js';
import { groupExercises, GROUPS } from '../workouts/muscle-groups.js';
import { haptics } from '../ui/haptic.js';
import { animateSpring } from '../ui/spring.js';
import { reducedMotion, DUR } from '../ui/motion.js';

let q = '';
let pattern = '';
let hereOnly = true;

export function renderLibrary(el) {
  const loc = activeLocation();
  const avail = expandEquipment(loc ? loc.equipment : []);
  const fav = new Set((state.settings && state.settings.favorites) || []);
  const excluded = new Set((state.settings && state.settings.excluded) || []);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = allExercises()
    .filter((e) => (!hereOnly || canDo(e, avail)) && (!pattern || e.pattern === pattern) && words.every((w) => e.name.toLowerCase().includes(w)))
    .sort((a, b) => (fav.has(b.id) - fav.has(a.id)) || a.name.localeCompare(b.name));

  const groups = groupExercises(list);
  const collapsed = loadCollapsed();
  const searching = words.length > 0; // a search always shows its matches, whatever is collapsed

  el.innerHTML = `
    <section class="stack">
      <div class="row between center"><h1>Exercises</h1><button class="btn small" data-new>+ Custom</button></div>
      <input type="search" placeholder="Search ${allExercises().length} exercises" value="${esc(q)}" data-q aria-label="Search">
      <div class="row gap">
        <select class="grow" data-pattern aria-label="Movement"><option value="">All movements</option>
          ${Object.entries(PATTERN_LABELS).map(([k, l]) => `<option value="${k}" ${k === pattern ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      </div>
      <label class="choice check small"><input type="checkbox" data-here ${hereOnly ? 'checked' : ''}>
        <span>Only what I can do at ${esc(loc ? loc.name : 'this location')}</span></label>
      <p class="small muted">${list.length} shown</p>
      ${groups.map((g) => {
        const open = searching || !collapsed.has(g.key);
        return `<section class="mg" data-group="${g.key}">
          <h2 class="mg-h"><button type="button" class="mg-btn" data-toggle="${g.key}" aria-expanded="${open}" aria-controls="mg-${g.key}">
            <span class="mg-name">${esc(g.label)}</span><span class="mg-count">${g.items.length}</span><span class="mg-chev" aria-hidden="true">${icon('chev')}</span></button></h2>
          <ul class="list mg-list" id="mg-${g.key}" ${open ? '' : 'hidden'}>
            ${g.items.map((e) => `
          <li class="tap" data-id="${esc(e.id)}">
            <div><b>${fav.has(e.id) ? `<span class="fav-star" aria-label="Favourite">${icon('star', { filled: true, size: 14 })}</span> ` : ''}${esc(e.name)}</b>
            <small class="muted">${esc(equipmentText(e))}${e.custom ? ' · custom' : ''}${excluded.has(e.id) ? ' · never suggested' : ''}</small></div>
            <span class="chev" aria-hidden="true">${icon('chev')}</span>
          </li>`).join('')}
          </ul>
        </section>`;
      }).join('')}
      ${list.length ? '' : emptyState({ icon: 'search', title: 'No exercises found', text: 'Try a different word, or add your own exercise.', action: { attr: 'data-new-empty', label: 'Add a custom exercise' } })}
      <p class="small muted">Library curated for this app. Step-by-step instructions from free-exercise-db by Yuhonas (public domain, Unlicense).</p>
    </section>`;

  const qi = $('[data-q]', el);
  qi.addEventListener('input', () => {
    q = qi.value;
    clearTimeout(qi._t);
    qi._t = setTimeout(() => { renderLibrary(el); const n = $('[data-q]', el); n.focus(); n.setSelectionRange(q.length, q.length); }, 250);
  });
  $('[data-pattern]', el).addEventListener('change', (e) => { pattern = e.target.value; renderLibrary(el); });
  $('[data-here]', el).addEventListener('change', (e) => { hereOnly = e.target.checked; renderLibrary(el); });
  $$('[data-toggle]', el).forEach((b) => b.addEventListener('click', () => toggleGroup(b, collapsed)));
  $$('[data-id]', el).forEach((li) => li.addEventListener('click', () => openDetail(li.dataset.id)));
  $('[data-new]', el).onclick = () => openCustomForm();
  const newEmpty = $('[data-new-empty]', el);
  if (newEmpty) newEmpty.onclick = () => openCustomForm();
}

const COLLAPSE_KEY = 'forge.library.collapsed';
function loadCollapsed() {
  try { const a = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'); return new Set(Array.isArray(a) ? a.filter((k) => GROUPS.includes(k)) : []); } catch { return new Set(); }
}

/** One tap opens or closes a section: a spring on the height (a fade under Reduce Motion), a select haptic, and the choice is remembered on this device. */
function toggleGroup(btn, collapsed) {
  const key = btn.dataset.toggle;
  const list = document.getElementById(`mg-${key}`);
  const open = btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', String(open));
  open ? collapsed.delete(key) : collapsed.add(key);
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed])); } catch { /* private mode: not remembered */ }
  haptics.select();
  list._anim?.stop();
  if (open) list.hidden = false;
  const full = list.scrollHeight;
  if (reducedMotion()) {
    const a = list.animate?.([{ opacity: open ? 0 : 1 }, { opacity: open ? 1 : 0 }], { duration: DUR.fast, fill: 'both' });
    if (a) a.onfinish = () => { a.cancel(); if (!open) list.hidden = true; }; else if (!open) list.hidden = true;
    return;
  }
  list.style.overflow = 'hidden';
  list._anim = animateSpring({
    from: open ? 0 : list.offsetHeight, to: open ? full : 0,
    onUpdate: (v) => { list.style.height = `${Math.max(0, v)}px`; },
    onDone: () => { list.style.height = ''; list.style.overflow = ''; if (!open) list.hidden = true; list._anim = null; },
  });
}

function toggleSetting(key, id) {
  const cur = new Set((state.settings && state.settings[key]) || []);
  cur.has(id) ? cur.delete(id) : cur.add(id);
  patch('settings', 'main', { [key]: [...cur] });
}

function openDetail(id) {
  const ex = exerciseById(id);
  // Favourite lives in the How-To sheet's action row; the library adds its own controls below.
  openHowTo(id, {
    extra: (box, close) => {
      const never = ((state.settings && state.settings.excluded) || []).includes(id);
      box.className = 'stack';
      box.innerHTML = `
        <button class="btn ghost" data-ex>${never ? 'Allow in workouts again' : 'Never suggest this'}</button>
        ${ex.custom ? '<button class="btn danger-ghost" data-del>Delete custom exercise</button>' : ''}`;
      box.querySelector('[data-ex]').onclick = () => { toggleSetting('excluded', id); close(); toast(never ? 'It can show up again' : 'Won’t be suggested'); };
      const del = box.querySelector('[data-del]');
      if (del) del.onclick = () => { softDelete('exercises', id); close(); toast('Deleted'); };
    },
  });
}

function openCustomForm() {
  sheet('Custom exercise', (body, close) => {
    body.innerHTML = `
      <form class="stack" novalidate>
        <label class="field"><span>Name</span><input name="name" maxlength="50" placeholder="e.g. Landmine press"></label>
        <label class="field"><span>Movement</span><select name="pattern">${Object.entries(PATTERN_LABELS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
        <label class="field"><span>Load type</span><select name="load">
          ${[['dumbbell', 'Dumbbell'], ['barbell', 'Barbell'], ['kettlebell', 'Kettlebell'], ['machine', 'Machine'], ['cable', 'Cable'], ['band', 'Band'], ['backpack', 'Backpack'], ['bodyweight', 'Bodyweight'], ['other', 'Other']].map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
        </select></label>
        <div class="row gap">
          <label class="field grow"><span>Rep range low</span><input name="lo" type="number" inputmode="numeric" value="8"></label>
          <label class="field grow"><span>High</span><input name="hi" type="number" inputmode="numeric" value="12"></label>
        </div>
        <label class="choice check small"><input type="checkbox" name="timed"><span>Timed (seconds instead of reps)</span></label>
        <label class="choice check small"><input type="checkbox" name="uni"><span>One side at a time</span></label>
        <fieldset class="field"><legend>Main muscles</legend>
          <div class="chips">${MUSCLES.map((m) => `<label class="chip"><input type="checkbox" name="mus" value="${m}"><span>${MUSCLE_LABELS[m]}</span></label>`).join('')}</div>
        </fieldset>
        <fieldset class="field"><legend>Equipment needed (leave empty for none)</legend>
          <div class="chips">${EQUIPMENT_GROUPS.flatMap((g) => g.items).map(([k, l]) => `<label class="chip"><input type="checkbox" name="eq" value="${k}"><span>${esc(l)}</span></label>`).join('')}</div>
        </fieldset>
        <label class="field"><span>Form cue <small class="muted">optional</small></span><input name="cue" maxlength="80"></label>
        <p class="error" aria-live="polite"></p>
        <button class="btn" type="submit">Save exercise</button>
      </form>`;
    const form = $('form', body);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      const primary = $$('input[name=mus]:checked', form).map((i) => i.value);
      const lo = Math.max(1, Number(form.lo.value) || 8);
      const hi = Math.max(lo, Number(form.hi.value) || 12);
      if (!name) return ($('.error', body).textContent = 'Give it a name.');
      if (!primary.length) return ($('.error', body).textContent = 'Pick at least one muscle.');
      put('exercises', newRecord({
        name,
        pattern: form.pattern.value,
        load: form.load.value,
        kind: ['biceps', 'triceps', 'lateral_raise', 'rear_delt', 'chest_fly', 'calf', 'knee_extension', 'knee_flexion', 'shrug'].includes(form.pattern.value) ? 'isolation' : 'compound',
        primary,
        secondary: [],
        equipment: $$('input[name=eq]:checked', form).map((i) => i.value),
        rep_lo: lo,
        rep_hi: hi,
        timed: form.timed.checked,
        unilateral: form.uni.checked,
        cues: form.cue.value.trim() ? [form.cue.value.trim()] : [],
      }));
      close();
      toast('Custom exercise saved');
    });
  });
}
