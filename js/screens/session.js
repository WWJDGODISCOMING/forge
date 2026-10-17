// List view of the running workout (the guided player is the default; this is the "List view" toggle):
// big one-handed rows, last session inline, rest bar, supersets, RIR, warm-ups, swaps, plate calculator,
// pause, and the same power-up / PR celebrations as the player. State lives in js/workouts/live.js.
import { state } from '../state.js';
import { esc, $, $$, sheet, toast, confirmSheet } from '../ui.js';
import { historyIndex, unit, activeLocation } from '../workouts/plan.js';
import { exerciseById } from '../workouts/library.js';
import { toUnit, fromUnit, nextTarget, warmups } from '../workouts/progression.js';
import { expandEquipment, canDo } from '../workouts/equipment.js';
import { stopRest, unlockAudio, beep, buzz, fmtClock, setWantAwake } from '../timer.js';
import { live, syncLive, save, completeSet, undoSet, elapsed, paused, checkAway, flush, discardWorkout } from '../workouts/live.js';
import { powerUp, prExplosion } from '../ui/fx.js';
import { openPaused, openAway, openFinish, closeOverlays } from './overlays.js';
import { openPlateCalculator } from './tools.js';
import { openExercisePicker } from './picker.js';
import { icon } from '../ui/icons.js';

let clockTimer = null;
let holdTimer = null;
let awayChecked = null;

const round1 = (x) => Math.round(x * 10) / 10;
const disp = (kg) => (kg == null ? '' : String(round1(toUnit(kg, unit()))));

// The rest of this file uses `local` for the running workout; it's the shared live copy.
const L = () => live.w;

// Back from the background after >10 min without pausing? Ask whether to count it.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || location.hash !== '#/session' || !live.w || document.querySelector('.ov')) return;
  const gap = checkAway();
  if (gap) openAway(gap, () => renderSession(document.getElementById('main')));
});

export function leaveSession() {
  clearInterval(clockTimer);
  clearInterval(holdTimer);
  closeOverlays();
  setWantAwake(false);
  flush();
}

function previousSets(exId) {
  const h = historyIndex().historyFor(exId);
  return h.length ? h[0].sets : [];
}

export function renderSession(el) {
  const local = syncLive();
  if (!local) {
    el.innerHTML = `<section class="stack"><h1>No workout running</h1><a class="btn" href="#/train">Go to Train</a></section>`;
    return;
  }
  setWantAwake(true);
  const u = unit();
  const loc = state.locations.find((l) => l.id === local.location_id);

  el.innerHTML = `
    <section class="stack session" data-list>
      <div class="row between center">
        <a class="btn small ghost" href="#/play">${icon('play')} Guided view</a>
        <div class="row gap">
          <button class="icon-btn" data-pause aria-label="Pause workout">${icon('pause')}</button>
          <button class="icon-btn" data-menu aria-label="Workout options">${icon('more')}</button>
        </div>
      </div>
      <div>
        <p class="label">${esc(loc ? loc.name : '')}${local.deload ? ' · deload' : ''}</p>
        <h1>${esc(local.label)}</h1>
        <p class="muted small"><span data-clock>0:00</span> ${paused() ? 'paused' : 'elapsed'}</p>
      </div>
      ${(local.notes || []).map((n) => `<p class="notice info small">${esc(n)}</p>`).join('')}
      ${local.exercises.map((it, i) => exerciseCard(it, i, u)).join('')}
      <button class="btn ghost" data-add>+ Add exercise</button>
      <button class="btn" data-finish>Finish workout</button>
    </section>`;

  // Elapsed clock (pause-aware)
  clearInterval(clockTimer);
  const clock = $('[data-clock]', el);
  const tickClock = () => (clock.textContent = fmtClock(elapsed() / 1000));
  tickClock();
  clockTimer = setInterval(tickClock, 1000);

  if (awayChecked !== local.id) {
    awayChecked = local.id;
    const gap = checkAway();
    if (gap) openAway(gap, () => renderSession(el));
  }
  if (paused() && !document.querySelector('.ov')) openPaused(() => renderSession(el));
  $('[data-pause]', el).onclick = () => openPaused(() => renderSession(el));

  // Inputs: store on change without redrawing
  $$('input[data-w]', el).forEach((inp) => inp.addEventListener('change', () => {
    const [i, j] = inp.dataset.w.split(':').map(Number);
    const v = inp.value === '' ? null : Number(inp.value);
    L().exercises[i].sets[j].weight_kg = v == null || !Number.isFinite(v) ? null : fromUnit(v, u);
    save();
  }));
  $$('input[data-r]', el).forEach((inp) => inp.addEventListener('change', () => {
    const [i, j] = inp.dataset.r.split(':').map(Number);
    const v = inp.value === '' ? null : Math.round(Number(inp.value));
    L().exercises[i].sets[j].reps = v == null || !Number.isFinite(v) ? null : v;
    save();
  }));
  $$('[data-rir]', el).forEach((b) => b.addEventListener('click', () => {
    const [i, j] = b.dataset.rir.split(':').map(Number);
    const order = [null, 4, 3, 2, 1, 0];
    const s = L().exercises[i].sets[j];
    s.rir = order[(order.indexOf(s.rir ?? null) + 1) % order.length];
    b.textContent = rirLabel(s.rir);
    b.classList.toggle('set', s.rir != null);
    save();
  }));
  $$('[data-done]', el).forEach((b) => b.addEventListener('click', () => {
    unlockAudio();
    const [i, j] = b.dataset.done.split(':').map(Number);
    toggleDone(i, j, el, b);
  }));
  $$('[data-hold]', el).forEach((b) => b.addEventListener('click', () => {
    unlockAudio();
    const [i, j] = b.dataset.hold.split(':').map(Number);
    runHold(i, j, el);
  }));
  $$('[data-exmenu]', el).forEach((b) => b.addEventListener('click', () => exerciseMenu(Number(b.dataset.exmenu), el)));
  $$('[data-info]', el).forEach((b) => b.addEventListener('click', () => openHowTo(L().exercises[Number(b.dataset.info)].exercise_id)));
  $$('[data-chain]', el).forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.chain);
    swapExercise(i, exerciseById(L().exercises[i].next_step_id), el);
  }));
  $$('[data-addset]', el).forEach((b) => b.addEventListener('click', () => {
    const it = L().exercises[Number(b.dataset.addset)];
    const last = [...it.sets].reverse().find((s) => !s.warmup) || {};
    it.sets.push({ warmup: false, plan_weight_kg: last.weight_kg ?? last.plan_weight_kg ?? null, plan_reps: last.reps ?? last.plan_reps ?? null, weight_kg: null, reps: null, rir: null, done: false, completed_at: null });
    save();
    renderSession(el);
  }));
  $('[data-add]', el).onclick = () => addExercise(el);
  $('[data-finish]', el).onclick = () => openFinish(() => renderSession(el));
  $('[data-menu]', el).onclick = () => workoutMenu(el);
}

const rirLabel = (r) => (r == null ? 'RIR' : r >= 4 ? '4+' : String(r));

function exerciseCard(it, i, u) {
  const ex = exerciseById(it.exercise_id) || { name: it.exercise_id, load: 'other', reps: [8, 12], equip: [[]] };
  const prev = previousSets(it.exercise_id);
  const bw = ['bodyweight', 'band', 'other', 'backpack'].includes(ex.load);
  const timed = !!ex.timed;
  let workIdx = 0;
  const rows = it.sets.map((s, j) => {
    const label = s.warmup ? 'W' : String(++workIdx);
    const p = !s.warmup ? prev[workIdx - 1] : null;
    const prevText = p ? (timed ? `${p.reps}s` : p.weight ? `${p.weight}×${p.reps}` : `${p.reps}`) : '—';
    return `
      <div class="setrow ${s.done ? 'done' : ''} ${s.warmup ? 'warm' : ''}">
        <span class="setno">${label}</span>
        <span class="prev">${esc(prevText)}</span>
        ${bw || timed ? (timed && ex.load !== 'bodyweight' && !bw
          ? `<input data-w="${i}:${j}" type="number" inputmode="decimal" step="0.5" placeholder="${disp(s.plan_weight_kg)}" value="${disp(s.weight_kg)}" aria-label="Weight ${u}">`
          : '<span class="bwtag">BW</span>')
          : `<input data-w="${i}:${j}" type="number" inputmode="decimal" step="0.5" placeholder="${disp(s.plan_weight_kg) || u}" value="${disp(s.weight_kg)}" aria-label="Weight ${u}">`}
        <input data-r="${i}:${j}" type="number" inputmode="numeric" placeholder="${s.plan_reps ?? (timed ? 's' : 'reps')}" value="${s.reps ?? ''}" aria-label="${timed ? 'Seconds' : 'Reps'}">
        ${timed ? `<button class="mini" data-hold="${i}:${j}" aria-label="Start timer">${icon('play', { size: 16 })}</button>` : `<button class="mini rir ${s.rir != null ? 'set' : ''}" data-rir="${i}:${j}" aria-label="Reps in reserve">${rirLabel(s.rir)}</button>`}
        <button class="setcheck" data-done="${i}:${j}" aria-label="${s.done ? 'Undo set' : 'Complete set'}">${s.done ? icon('check') : ''}</button>
      </div>`;
  }).join('');
  const t = it.target || {};
  const range = timed ? `${t.rep_lo}–${t.rep_hi}s` : `${t.rep_lo}–${t.rep_hi} reps`;
  const next = it.next_step_id ? exerciseById(it.next_step_id) : null;
  return `
    <article class="card excard ${it.superset ? 'superset' : ''}" data-ex="${i}">
      <div class="row between center">
        <button class="exname" data-info="${i}"><b>${esc(ex.name)}</b>${it.superset ? ` <span class="pill">Superset ${esc(it.superset)}</span>` : ''}</button>
        <button class="icon-btn" data-exmenu="${i}" aria-label="Exercise options">${icon('more')}</button>
      </div>
      <p class="small muted">${esc(range)}${ex.unilateral ? ' · each side' : ''}${it.note ? ` · ${esc(it.note)}` : ''}</p>
      ${it.warning ? `<p class="notice warn small">${esc(it.warning)}</p>` : ''}
      ${next ? `<button class="notice info small chain" data-chain="${i}">Ready for the next step: <b>${esc(next.name)}</b>. Tap to switch.</button>` : ''}
      <div class="sethead"><span>Set</span><span>Last</span><span>${bw || timed ? '' : u}</span><span>${timed ? 'Sec' : 'Reps'}</span><span></span><span></span></div>
      ${rows}
      <button class="link small" data-addset="${i}">+ Add set</button>
    </article>`;
}

function toggleDone(i, j, el, btn) {
  const it = L().exercises[i];
  const s = it.sets[j];
  if (s.done) {
    undoSet(i, j);
    renderSession(el);
    return;
  }
  const res = completeSet(i, j);
  if (!res.ok) {
    toast(res.error);
    return;
  }
  const total = L().exercises.reduce((n, x) => n + x.sets.filter((y) => !y.warmup).length, 0) || 1;
  const card = btn && btn.closest('.excard');
  powerUp({ button: btn, hero: card, shakeEl: card, level: Math.min(1, res.workingDone / total), last: res.lastOfExercise, xp: s.warmup ? 0 : 10 });
  if (res.prs.length) prExplosion(res.prs, { origin: btn }); // one card per set
  if (!res.rest && !res.lastSetOfWorkout && it.superset) {
    const members = L().exercises.map((x, k) => [x, k]).filter(([x]) => x.superset === it.superset);
    const nxt = members.find(([, k]) => k > i);
    if (nxt) toast(`Now: ${exerciseById(nxt[0].exercise_id)?.name || 'next exercise'}`);
  }
  setTimeout(() => renderSession(el), 380);
}

function runHold(i, j, el) {
  const s = L().exercises[i].sets[j];
  const target = s.reps || s.plan_reps || 30;
  clearInterval(holdTimer);
  stopRest();
  const end = Date.now() + target * 1000 + 3000;
  sheet('Timer', (body, close) => {
    body.innerHTML = `<div class="holdclock" aria-live="polite"><p class="label" data-phase>Get ready</p><b data-left>3</b></div>
      <button class="btn ghost" data-stop>Stop</button>`;
    let warned = false;
    const left = $('[data-left]', body);
    const phase = $('[data-phase]', body);
    beep({ freq: 660 });
    holdTimer = setInterval(() => {
      const ms = end - Date.now();
      if (ms > target * 1000) {
        left.textContent = Math.ceil((ms - target * 1000) / 1000);
        return;
      }
      if (!warned) {
        warned = true;
        phase.textContent = 'Go';
        beep({ freq: 990 });
      }
      left.textContent = fmtClock(ms / 1000);
      if (ms <= 0) {
        clearInterval(holdTimer);
        beep({ freq: 990, ms: 400 });
        buzz();
        s.reps = target;
        close();
        toggleDone(i, j, el);
      }
    }, 200);
    $('[data-stop]', body).onclick = () => {
      clearInterval(holdTimer);
      const done = Math.round(target - Math.max(0, (end - Date.now()) / 1000));
      close();
      if (done > 0) {
        s.reps = done;
        save();
        renderSession(el);
      }
    };
  });
}

function availableHere() {
  const loc = state.locations.find((l) => l.id === L().location_id) || activeLocation();
  return expandEquipment(loc ? loc.equipment : []);
}

function buildEntry(ex, role = 'accessory') {
  const u = unit();
  const loc = state.locations.find((l) => l.id === L().location_id) || activeLocation();
  const t = nextTarget(ex, historyIndex().historyFor(ex.id), { inventory: (loc && loc.weight_inventory) || {}, unit: u, role, experience: state.profile.experience, deload: L().deload });
  const kg = (x) => (x == null ? null : fromUnit(x, u));
  const wu = role !== 'accessory' && t.weight ? warmups(ex, t.weight, { inventory: (loc && loc.weight_inventory) || {}, unit: u }) : [];
  return {
    exercise_id: ex.id, role, superset: null, note: t.note || '', next_step_id: null,
    target: { sets: t.sets, rep_lo: t.repLo, rep_hi: t.repHi, reps: t.reps, weight_kg: kg(t.weight), rir: t.rir, mode: t.mode },
    sets: [
      ...wu.map((w) => ({ warmup: true, plan_weight_kg: kg(w.weight), plan_reps: w.reps, weight_kg: null, reps: null, rir: null, done: false, completed_at: null })),
      ...Array.from({ length: t.sets }, () => ({ warmup: false, plan_weight_kg: kg(t.weight), plan_reps: t.reps, weight_kg: null, reps: null, rir: null, done: false, completed_at: null })),
    ],
  };
}

function swapExercise(i, ex, el) {
  if (!ex) return;
  const old = L().exercises[i];
  if (old.sets.some((s) => s.done)) {
    toast('Finish or undo the completed sets first, or add the new exercise instead.');
    return;
  }
  const entry = buildEntry(ex, old.role);
  entry.superset = old.superset;
  if (old.rest_sec) entry.rest_sec = old.rest_sec; // the rest you chose in the preview stays with the slot
  L().exercises[i] = entry;
  save();
  renderSession(el);
}

function addExercise(el) {
  const avail = availableHere();
  openExercisePicker({
    title: 'Add exercise',
    filter: (e) => canDo(e, avail),
    availableNote: 'Showing what you can do at this location.',
    onPick: (ex) => {
      L().exercises.push(buildEntry(ex, 'accessory'));
      save();
      renderSession(el);
    },
  });
}

function exerciseMenu(i, el) {
  const it = L().exercises[i];
  const ex = exerciseById(it.exercise_id) || {};
  sheet(ex.name || 'Exercise', (body, close) => {
    body.innerHTML = `
      <div class="stack">
        <button class="btn ghost" data-a="swap">Swap for a similar exercise</button>
        ${ex.load === 'barbell' ? '<button class="btn ghost" data-a="plates">Plate calculator</button>' : ''}
        <button class="btn ghost" data-a="how">How to do it</button>
        <div class="row gap">
          <button class="btn ghost grow" data-a="up" ${i === 0 ? 'disabled' : ''}>Move up</button>
          <button class="btn ghost grow" data-a="down" ${i === L().exercises.length - 1 ? 'disabled' : ''}>Move down</button>
        </div>
        <button class="btn ghost" data-a="dropset">Remove last open set</button>
        <button class="btn danger-ghost" data-a="remove">Remove exercise</button>
      </div>`;
    body.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      close();
      if (a === 'swap') {
        const avail = availableHere();
        openExercisePicker({
          title: `Swap ${ex.name}`,
          onlyPattern: ex.pattern,
          filter: (c) => c.id !== ex.id && canDo(c, avail),
          availableNote: 'Same movement, doable at this location.',
          onPick: (c) => swapExercise(i, c, el),
        });
      } else if (a === 'plates') {
        const w = [...it.sets].reverse().find((s) => s.weight_kg || s.plan_weight_kg);
        openPlateCalculator(w ? round1(toUnit(w.weight_kg || w.plan_weight_kg, unit())) : null);
      } else if (a === 'how') {
        openHowTo(ex.id);
      } else if (a === 'up' || a === 'down') {
        const k = a === 'up' ? i - 1 : i + 1;
        [L().exercises[i], L().exercises[k]] = [L().exercises[k], L().exercises[i]];
        save();
        renderSession(el);
      } else if (a === 'dropset') {
        const idx = it.sets.map((s) => !s.done).lastIndexOf(true);
        if (idx >= 0) it.sets.splice(idx, 1);
        save();
        renderSession(el);
      } else if (a === 'remove') {
        L().exercises.splice(i, 1);
        save();
        renderSession(el);
      }
    });
  });
}

// The How-To sheet lives in howto.js; re-exported here for older imports.
export { openHowTo } from './howto.js';

function workoutMenu(el) {
  sheet('Workout', (body, close) => {
    body.innerHTML = `
      <div class="stack">
        <button class="btn ghost" data-a="plates">Plate calculator</button>
        <button class="btn danger-ghost" data-a="discard">Discard this workout</button>
      </div>`;
    body.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      close();
      if (a === 'plates') openPlateCalculator();
      if (a === 'discard') {
        const ok = await confirmSheet({ title: 'Discard workout?', message: 'Nothing from this session will be saved to your history.', confirmLabel: 'Discard', danger: true });
        if (!ok) return;
        discardWorkout();
        setWantAwake(false);
        location.hash = '#/train';
      }
    });
  });
}
