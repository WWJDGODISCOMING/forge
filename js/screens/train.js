// Train hub: pick a location, see today's plan, start or resume, recovery, program, tools.
import { state } from '../state.js';
import { cachePhotos, hasPhotos, photoUrls, loadPhotoIndex } from '../ui/photos.js';
import { hasFigure, mountFigure } from '../ui/figure.js';
import { expandEquipment, canDo } from '../workouts/equipment.js';
import { autoRest, restDefaultSec, fmtClock } from '../workouts/session-core.js';
import { planBlocks, planMuscles } from '../workouts/preview.js';
import { openHowTo } from './howto.js';
import { openDemoPreview } from './demo-preview.js';
import { swapCandidate } from '../workouts/demo-preview-core.js';
import { bodyMap, exerciseValues } from '../ui/bodymap.js';
import { esc, $, $$, sheet, toast, confirmSheet } from '../ui.js';
import {
  activeLocation, setActiveLocation, activeProgram, startProgram, activeWorkout, planToday, startWorkout,
  currentRecovery, stalledMainLifts, startDeload, unit,
} from '../workouts/plan.js';
import { PROGRAMS, DAY_TYPES, smartDayTypes } from '../workouts/programs.js';
import { deloadInfo, planMinutes } from '../workouts/generator.js';
import { exerciseById, allExercises } from '../workouts/library.js';
import { openPlateCalculator, openLogWorkout } from './tools.js';
import { openExercisePicker } from './picker.js';
import { patch } from '../db.js';
import { focusChipsHtml, bindFocusChips } from '../ui/focus-chips.js';
import { cleanFocus, focusLabel } from '../workouts/focus.js';
import { unlockAudio } from '../ui/sound.js';
import { muscleGroup, GROUP_LABELS } from '../workouts/muscle-groups.js';
import { icon } from '../ui/icons.js';
import { whyCardHtml } from '../ui/why-card.js';
import { protectRowHtml, bindProtect } from '../ui/protect-joints.js';
import { jointAvoidSet, jointFriendly, jointPickerPatterns } from '../workouts/generator.js';
import { recoveryCardHtml, bindRecoveryCard } from '../ui/recovery-card.js';
import { haptic } from '../native/bridge.js';
import {
  MAX_MUSCLES, durationLabel, cleanMuscles, musclesLabel, defaultItem, cleanSaved, addSaved, removeSaved, itemsFromPlan, repStep, resolveCustomDay, choiceKey, savedSub,
} from '../workouts/switch-core.js';
import { FOCUS_GROUPS, FOCUS_KEYS } from '../workouts/focus.js';
import { gymChoices, switchAction, SWITCH_CONFIRM, RESUME_JOINT_NOTE } from '../workouts/gym-switch-core.js';
import { hapticsOn, haptics } from '../ui/haptic.js';
import * as liveWorkout from '../native/live-workout.js';
import { activeMs, LIVE_SHORT_MS } from '../workouts/live-core.js';
import { currentChipText, bindLiveChips } from '../ui/live-chip.js';
import {
  LENGTHS, blankEdits, takeSnapshot, restoreSnapshot, isChanged, pickedIds, withSwapAvoid, carryRest, swapResult, swapMessage, noSwapReason, lengthMessage,
} from '../workouts/change.js';

/** Guided player by default; List view if you chose it in Settings. */
export const playerRoute = () => (state.settings && state.settings.player === 'list' ? '#/session' : '#/play');

let dayOverride = null;
let minOverride = null; // "Shorter or longer" for today only; never written to the profile
let choice = null; // Switch: { kind:'muscles', groups } | { kind:'saved', id } | { kind:'scratch', name, items }, for today only
let flashAll = false; // a gym switch re-plans every row: highlight them all once
let flash = new Set(); // exercises that just changed, so the card can highlight them once

// Edits made in the preview before Start: ⋯ → Replace, ⋯ → Rest timer, and Change. They belong to one
// location + day; changing either starts fresh.
let edits = blankEdits();
let restoringTo = null; // Undo of a location change: the place whose edits were just put back, until the settings write lands
const editsFor = (key) => {
  if (restoringTo) {
    if (key.startsWith(`${restoringTo}|`)) restoringTo = null; // the old place is active again
    else if (edits.key.startsWith(`${restoringTo}|`)) return edits; // still showing the new place: keep what Undo restored
  }
  if (edits.key !== key) edits = blankEdits(key);
  return edits;
};
/**
 * Today's plan with the preview edits applied (Replace, Rest timer, Switch, a different day), so Today's
 * card and its Start button show and start exactly what Train shows.
 */
export function previewPlan() {
  const loc = activeLocation();
  if (!loc) return null;
  const ed = editsFor(`${loc.id}|${dayOverride || ''}|${choiceKey(choice)}`);
  const plan = planToday({ customDay: resolveCustomDay(choice, state.settings && state.settings.saved_workouts), dayType: dayOverride, forced: ed.forced, avoidIds: ed.avoid, sessionMin: minOverride, restSec: ed.rest });
  if (plan) {
    for (const it of plan.exercises) if (ed.rest[it.exercise_id]) it.rest_sec = ed.rest[it.exercise_id];
    plan.est_minutes = planMinutes(plan, allExercises(), restDefaultSec(state.settings)); // a rest picked in the dots menu changes the length
  }
  return plan;
}

/** A live cardio workout is still running: explain, and let them open it or end it and carry on. */
function liveBlocksStart(plan) {
  haptics.warning && haptics.warning();
  const s0 = liveWorkout.current();
  const keep = !!s0 && activeMs(s0, Date.now()) >= LIVE_SHORT_MS; // a minute or more is saved, never silently thrown away
  sheet('A live workout is running', (body, close) => {
    body.innerHTML = `
      <p class="muted">Finish or end it first, then start this workout.</p>
      <div class="stack">
        <button class="btn bigbtn" data-open>Open live workout</button>
        <button class="btn bigbtn ghost live-discard" data-endit>${keep ? 'Save it and start this workout' : 'Discard it and start this workout'}</button>
        <p class="small muted" data-endit-note>${keep ? 'Your live workout is saved first.' : 'It is under a minute, so it is thrown away.'}</p>
        <button class="btn ghost bigbtn" data-no>Not now</button>
      </div>`;
    body.querySelector('[data-open]').onclick = () => { close(); location.hash = '#/live'; };
    body.querySelector('[data-no]').onclick = () => close();
    body.querySelector('[data-endit]').onclick = async () => {
      close();
      const s = liveWorkout.current();
      if (s && activeMs(s, Date.now()) >= LIVE_SHORT_MS) await liveWorkout.finish(); else await liveWorkout.discard();
      startPlan(plan);
    };
  });
}

/** Start a previewed plan (Train or Today): unlock audio on this tap, cache today's photos, go. */
export function startPlan(plan) {
  liveWorkout.restore();
  if (liveWorkout.isActive()) return liveBlocksStart(plan); // never a silent no-op: say why, and offer to end it
  haptics.medium();
  unlockAudio(); // this tap unlocks sound + voice for the 3-2-1 GO on iPhone
  startWorkout(plan);
  cachePhotos(plan.exercises.map((it) => it.exercise_id)); // today's demo photos, for the gym's dead zones
  dayOverride = null;
  minOverride = null;
  choice = null;
  edits = blankEdits();
  restoringTo = null;
  location.hash = playerRoute();
}

const REST_CHOICES = [30, 45, 60, 90, 120, 150, 180, 240];


export function targetText(t, u, ex) {
  const reps = ex && ex.timed ? `${t.reps}s` : t.repLo === t.repHi ? `${t.repHi}` : t.mode === 'start' ? `${t.repLo}–${t.repHi}` : `${t.reps}`;
  const w = t.weight ? ` · ${t.weight} ${u}` : '';
  return `${t.sets} × ${reps}${w}`;
}

function dayChoices(program) {
  const templ = program ? program.template : 'smart';
  const p = PROGRAMS[templ];
  if (p.custom) return (program.custom_days || []).map((d, i) => [`custom_${i}`, d.name]);
  const keys = p.smart ? [...new Set([...smartDayTypes(state.profile.trainingDays || 3), 'full_a', 'upper', 'lower', 'push', 'pull', 'legs', 'boxing'])] : p.days;
  return keys.map((k) => [k, DAY_TYPES[k].label]);
}

// The profile listener re-renders Train again right after a toggle, so the scroll/focus fix-up outlives one render.
let pendingProtect = null;
function keepProtectInPlace(el) {
  const p = pendingProtect;
  if (!p || Date.now() - p.at > 2000) { pendingProtect = null; return; }
  const after = $('.protect-row', el)?.getBoundingClientRect().top;
  if (p.top != null && after != null && after !== p.top) window.scrollBy({ top: after - p.top, behavior: 'instant' });
  $(`[data-protect="${p.key}"]`, el)?.focus({ preventScroll: true });
}

export function renderTrain(el) {
  if (!state.programs.some((p) => p.active)) {
    startProgram('smart');
    return; // the new program arrives through the listener and re-renders
  }
  const u = unit();
  const loc = activeLocation();
  const program = activeProgram();
  const active = activeWorkout();
  const plan = !active && loc ? previewPlan() : null;
  const d = deloadInfo(program, state.profile.experience);
  const stalled = !active ? stalledMainLifts() : [];
  const rec = currentRecovery();

  el.innerHTML = `
    <section class="stack">
      <h1>Train</h1>

      ${loc ? `<button class="gym-chip" data-gym aria-haspopup="dialog" aria-label="Gym: ${esc(loc.name)}. Switch gyms">
        <span class="gym-pin" aria-hidden="true">${icon('pin')}</span><span>${esc(loc.name)}</span><span class="gym-chev" aria-hidden="true">${icon('chev')}</span>
      </button>` : ''}

      <div class="train-cols" data-train-cols>
      ${recoveryCardHtml(rec)}

      ${active ? `
        <div class="card resume">
          <p class="label">In progress</p>
          <p class="big-title">${esc(active.label)}</p>
          <p class="muted small">Started ${new Date(active.started_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
          <a class="btn" href="${playerRoute()}">Resume workout</a>
          ${protectRowHtml()}
          <p class="small muted protect-note">${esc(RESUME_JOINT_NOTE)}</p>
        </div>` : ''}

      ${plan ? previewCard(plan, { d, loc, program, u }) : ''}
      ${whyCardHtml(plan ? plan.notes : [], stalled.map((id) => exerciseById(id)?.name || id))}
      ${!loc ? '<div class="notice warn">Add a gym in Settings → Locations first.</div>' : ''}

      <div class="card">
        <div class="row between center">
          <p class="label">Program</p>
          <button class="link small" data-program>Change</button>
        </div>
        <p><b>${esc(PROGRAMS[program.template]?.name || program.name)}</b></p>
        <p class="small muted">Week ${d.week} of ${d.cycle}${d.deload ? ' — deload week' : ` · deload in week ${d.cycle}`}</p>
        <button class="focus-row" data-focus aria-label="Focus areas: ${esc(focusLabel(state.profile.focus_muscles) || 'None')}. Edit">
          <span class="muted small">Focus areas</span>
          <b class="focus-val">${focusLabel(state.profile.focus_muscles).split(', ').filter(Boolean).map(esc).map((l) => `<span>${l}</span>`).join(', ') || 'None'}</b>
          <span class="focus-go chev" aria-hidden="true">${icon('chev')}</span>
        </button>
      </div>

      <div class="tools">
        <a class="tool" href="#/timer"><span class="t-ic" aria-hidden="true">${icon('timer')}</span>Timer</a>
        <a class="tool" href="#/live" data-live><span class="t-ic" aria-hidden="true">${icon('play')}</span><span data-live-label data-idle="Live workout">${currentChipText() || 'Live workout'}</span></a>
        <button class="tool tool-log" data-cardio aria-label="Log a workout"><span class="t-ic" aria-hidden="true">${icon('plus')}</span>Add entry</button>
        <button class="tool" data-plates><span class="t-ic" aria-hidden="true">${icon('dumbbell')}</span>Plates</button>
        <a class="tool" href="#/library"><span class="t-ic" aria-hidden="true">${icon('book')}</span>Exercises</a>
      </div>

      <a class="card row between center nav-card" href="#/history" data-train-history>
        <div><p class="label">History &amp; PRs</p><p class="small">Past workouts and personal records</p></div>
        <span class="chev" aria-hidden="true">${icon('chev')}</span>
      </a>
      </div>
    </section>`;

  flash = new Set(); // the highlight plays once, on this render
  flashAll = false;
  const gym = $('[data-gym]', el);
  if (gym) gym.onclick = () => openGymPicker(el, !!active);
  bindRecoveryCard(el, rec);
  if (plan) wirePreview(el, plan);
  bindProtect(el, (list, key) => {
    flash = new Set();
    if (!el.isConnected) return;
    // Keep the Protect row where the thumb tapped it, even though the list above it changes height.
    pendingProtect = { key, top: $('.protect-row', el)?.getBoundingClientRect().top, at: Date.now() };
    renderTrain(el);
  });
  keepProtectInPlace(el);
  const start = $('[data-start]', el);
  if (start)
    start.onclick = () => startPlan(plan);
  arrangeTrainCols(el);
  const why = $('[data-why-toggle]', el);
  if (why) why.onclick = () => {
    tick();
    const open = why.getAttribute('aria-expanded') !== 'true';
    why.setAttribute('aria-expanded', String(open));
    $('[data-why-body]', el).hidden = !open;
    el.querySelector('[data-why-card]').classList.toggle('open', open);
  };
  const dl = $('[data-deload]', el);
  if (dl) dl.onclick = () => { startDeload(); toast('Deload week started'); };
  $('[data-program]', el).onclick = () => openProgramPicker();
  $('[data-focus]', el).onclick = () => openFocusPicker();
  $('[data-cardio]', el).onclick = () => openLogWorkout();
  $('[data-plates]', el).onclick = () => openPlateCalculator();
  bindLiveChips(el);
}

// Two columns (>= 840px). The DOM stays in the phone's reading order and the cards only move into columns while the
// wide query matches (like Today), so VoiceOver and Tab order follow the screen on every size.
const TRAIN_RIGHT = '.resume, .preview, [data-why-card], .notice';
let trainQuery = null;
let trainListener = null;
function arrangeTrainCols(el) {
  if (trainQuery && trainListener) trainQuery.removeEventListener('change', trainListener);
  trainQuery = trainListener = null;
  if (typeof matchMedia !== 'function') return;
  const host = $('[data-train-cols]', el);
  if (!host) return;
  const cards = [...host.children];
  const q = matchMedia('(min-width: 840px)');
  const apply = () => {
    if (!el.isConnected || !host.isConnected) return;
    const focused = document.activeElement;
    const hadFocus = focused && focused !== document.body && host.contains(focused);
    if (q.matches) {
      const a = document.createElement('div'); a.className = 'col col-a';
      const b = document.createElement('div'); b.className = 'col col-b';
      host.replaceChildren(a, b);
      for (const c of cards) (c.matches(TRAIN_RIGHT) ? b : a).append(c);
    } else host.replaceChildren(...cards);
    if (hadFocus && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  };
  trainQuery = q;
  trainListener = () => apply();
  q.addEventListener('change', trainListener);
  apply();
}

function previewCard(plan, { d, loc, program, u }) {
  const n = plan.exercises.length;
  const muscles = planMuscles(plan.exercises, exerciseById);
  const warm = plan.exercises.filter((it) => it.warmups.length);
  const row = ({ it, i }, label) => {
    const ex = exerciseById(it.exercise_id);
    const rest = it.rest_sec ? ` · rest ${fmtClock(it.rest_sec)}` : '';
    return `<li class="pv-ex${flash.has(ex.id) || flashAll ? ' flash' : ''}">
      <div class="pv-hit" role="button" tabindex="0" data-preview="${i}" aria-label="Preview demo: ${esc(ex.name)}">
      <div class="pv-thumb" data-thumb="${esc(ex.id)}" aria-hidden="true"></div>
      <div class="pv-txt">${label ? `<span class="pv-tag">${label}</span>` : ''}<b>${esc(ex.name)}</b>
        <small class="muted">${esc(targetText(it.target, u, ex))}${it.warmups.length ? ` · ${it.warmups.length} warm-up` : ''}${rest}</small>
        ${it.swap ? `<span class="swap-badge">${esc(it.swap.badge)}</span><small class="muted swap-why">${esc(it.swap.why)}</small>` : ''}</div>
      </div>
      <button class="icon-btn pv-more" data-more="${i}" aria-label="More for ${esc(ex.name)}">${icon('more')}</button>
    </li>`;
  };
  let lastGroup = '';
  const blocks = planBlocks(plan.exercises).map((b) => {
    const g = muscleGroup(exerciseById(b.items[0].it.exercise_id));
    const head = g === lastGroup ? '' : `<li class="pv-mg" role="none"><h3 class="pv-mg-h">${esc(GROUP_LABELS[g])}</h3></li>`;
    lastGroup = g;
    return head + (b.group
    ? `<li class="pv-group"><p class="pv-group-h"><span>${b.kind} ${esc(b.group)}</span><small class="muted">${b.rounds} rounds · rest after each round</small></p>
        <ol class="pv-list">${b.items.map((x, k) => row(x, `${esc(b.group)}${k + 1}`)).join('')}</ol></li>`
    : row(b.items[0], ''));
  });
  return `
      <div class="card preview">
        <p class="label">Today${d.deload ? ' · deload' : ''}</p>
        <div class="row between center pv-head">
          <p class="big-title">${esc(plan.label)}</p>
          <div class="row gap pv-acts">
            <button class="btn ghost small" data-switch aria-haspopup="dialog" aria-label="Switch workout">${icon('swap')} Switch</button>
            <button class="btn ghost small" data-change aria-label="Change today's workout">Change</button>
          </div>
        </div>
        <div class="pv-chips">
          <span class="pill">${icon('timer')} ~${plan.est_minutes} min</span>
          ${plan.focus && plan.focus.length ? `<span class="pill pill-focus">Focus: ${esc(plan.focusLabel)}</span>` : ''}
        </div>
        ${pvControls(plan, loc)}
        ${n ? `
        <div class="pv-sum">
          ${bodyMap(planValues(plan), { size: 'mini', caption: false })}
          <p><b>${n} exercise${n === 1 ? '' : 's'} · ${muscles} muscle${muscles === 1 ? '' : 's'}</b><small class="muted">Tap an exercise to preview it, or the dots for more.</small></p>
        </div>
        <div class="pv-warm">
          <p class="pv-group-h"><span>Warm-up</span><small class="muted">~${plan.warm_min || 5} min</small></p>
          <ul class="pv-wlist">
            ${(plan.warm_min || 5) <= 3
              ? '<li>2 min easy cardio</li><li>Arm circles and bodyweight squats, 10 each</li>'
              : '<li>3–5 min easy cardio or brisk walk</li><li>Arm circles, hip hinges and bodyweight squats, 10 each</li>'}
            ${warm.map((it) => `<li>${esc(exerciseById(it.exercise_id).name)}: ${it.warmups.length} lighter set${it.warmups.length === 1 ? '' : 's'} first (built in)</li>`).join('')}
          </ul>
        </div>
        <ol class="pv-list">${blocks.join('')}</ol>
        ${protectRowHtml()}
        <button class="btn" data-start>Start workout</button>` : '<p class="muted">Nothing fits this gym. Add equipment in Settings → Locations.</p>'}
      </div>`;
}

/** Thumbnails, ⋯ menus and Switch for the preview card. */
function wirePreview(el, plan) {
  const thumbs = $$('[data-thumb]', el);
  const paintThumbs = () => thumbs.forEach((t) => {
    if (t.childElementCount) return;
    const ex = exerciseById(t.dataset.thumb);
    if (!ex) return;
    t.classList.toggle('has-demo', hasFigure(ex.id) || hasPhotos(ex.id));
    if (hasFigure(ex.id)) mountFigure(t, ex, { at: 'hard' });
    else if (hasPhotos(ex.id)) {
      t.innerHTML = `<img src="${esc(photoUrls(ex.id)[0])}" alt="" decoding="async" loading="lazy">`;
      t.firstChild.addEventListener('error', () => { t.innerHTML = bodyMap(exerciseValues(ex), { size: 'mini', caption: false }); }, { once: true });
    } else t.innerHTML = bodyMap(exerciseValues(ex), { size: 'mini', caption: false });
  });
  paintThumbs();
  // Photos join in when the photo list arrives (weak signal): repaint the ones still on the map.
  loadPhotoIndex().then(() => thumbs.forEach((t) => {
    if (!t.isConnected || hasFigure(t.dataset.thumb) || !hasPhotos(t.dataset.thumb) || t.querySelector('img')) return;
    t.innerHTML = '';
    paintThumbs();
  }));

  const ch = $('[data-change]', el);
  if (ch) ch.onclick = () => openChange(el, plan);
  const sw = $('[data-switch]', el);
  if (sw) sw.onclick = () => { tick('light'); openSwitch(el, plan); };
  const pl = $('[data-pv-gym]', el);
  if (pl) pl.onclick = () => openGymPicker(el, false);
  $$('[data-len]', el).forEach((b) => (b.onclick = () => pickLength(el, plan, Number(b.dataset.len))));

  $$('[data-more]', el).forEach((b) => (b.onclick = () => exerciseMore(el, plan, Number(b.dataset.more))));
  $$('[data-preview]', el).forEach((h) => {
    const open = () => previewDemo(el, plan, Number(h.dataset.preview), $('[data-thumb]', h));
    h.onclick = open;
    h.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  });
}

const tick = (kind = 'select') => { if (hapticsOn()) haptic(kind); };
const dayDef = () => resolveCustomDay(choice, state.settings && state.settings.saved_workouts);
const snap = () => takeSnapshot({ edits, dayOverride, minOverride, choice, locationId: (activeLocation() || {}).id || null });

/** Put the whole preview back the way it was (the Undo on the toast). */
function undoTo(el, before) {
  const s = restoreSnapshot(before);
  const loc = activeLocation();
  edits = s.edits;
  dayOverride = s.dayOverride;
  minOverride = s.minOverride;
  choice = s.choice;
  flash = new Set();
  const moving = s.locationId && (!loc || loc.id !== s.locationId);
  if (moving) {
    // setActiveLocation is a database write; until it lands activeLocation() is still the new place. Keep the
    // restored edits through that gap (see editsFor) and let the settings listener do the redraw.
    restoringTo = s.locationId;
    setActiveLocation(s.locationId);
  } else if (el.isConnected) renderTrain(el);
  tick('light');
}

/** Redraw, highlight what changed, and offer Undo. */
function changed(el, before, message, flashIds = []) {
  flash = new Set(flashIds);
  if (el.isConnected) renderTrain(el);
  tick('success');
  toast(message, 6000, { action: { label: 'Undo', onClick: () => undoTo(el, before) } });
}

/** The gym chip's picker: saved gyms (current one ticked) and a shortcut to add or edit them in Settings. */
function openGymPicker(el, inProgress) {
  tick('light');
  const cur = activeLocation();
  sheet('Switch gym', (body, close) => {
    body.innerHTML = `
      <div class="gym-list" role="radiogroup" aria-label="Gym">
        ${gymChoices(state.locations, cur && cur.id).map((g) => `
          <button class="gym-row" role="radio" aria-checked="${g.current}" data-gym-id="${esc(g.id)}"><span>${esc(g.name)}</span>${g.current ? `<span class="gym-tick" aria-hidden="true">${icon('check')}</span>` : ''}</button>`).join('')}
      </div>
      <p class="small muted gym-note">Switching re-plans today for that gym’s equipment. Your Knees and Lower back settings stay the same.</p>
      <a class="btn ghost" href="#/locations" data-gym-edit>Add or edit gyms in Settings</a>`;
    $('[data-gym-edit]', body).onclick = () => { tick('light'); close(); };
    $$('[data-gym-id]', body).forEach((b) => (b.onclick = async () => {
      const id = b.dataset.gymId;
      const act = switchAction(cur && cur.id, id, inProgress);
      close();
      if (act === 'none') return;
      if (act === 'confirm' && !(await confirmSheet(SWITCH_CONFIRM))) return;
      const before = snap();
      dayOverride = null;
      restoringTo = null;
      flashAll = true;
      setActiveLocation(id);
      tick('success');
      const to = state.locations.find((l) => l.id === id);
      toast(`Now at ${to ? to.name : 'a new gym'}`, 6000, { action: { label: 'Undo', onClick: () => undoTo(el, before) } });
    }));
    // Arrow keys move between the gyms, like any radio group.
    const rows = $$('[data-gym-id]', body);
    rows.forEach((b, i) => (b.onkeydown = (e) => {
      const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      rows[(i + d + rows.length) % rows.length].focus();
    }));
  });
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * "Change today's workout": a sheet of plain-language options. Nothing changes until one is picked, and every
 * change comes with an Undo toast. Each step takes over the sheet's title, with a back chevron in the header.
 */
function openChange(el, plan) {
  const loc = activeLocation();
  const program = activeProgram();
  const focusLabel = plan.label;
  const ids = plan.exercises.map((it) => it.exercise_id);
  const picks = pickedIds(edits);
  const tryNew = (replacePicks) => {
    const next = withSwapAvoid(edits, ids, { replacePicks });
    const fresh = planToday({ customDay: dayDef(), dayType: dayOverride, forced: next.forced, avoidIds: next.avoid, sessionMin: minOverride, restSec: next.rest });
    const afterIds = fresh ? fresh.exercises.map((it) => it.exercise_id) : ids;
    return { next, afterIds, res: swapResult(ids, afterIds) };
  };
  const canSwap = ids.length > 0 && tryNew(false).res.state !== 'none';
  const recommended = planToday({ dayType: null, sessionMin: minOverride, restSec: edits.rest });
  const usual = (state.profile && state.profile.sessionMin) || 60;
  const where = loc ? loc.name : 'this location';
  const row = (attr, title, sub, { disabled = false, check = false, one = false, wrap = false } = {}) => `
    <button class="pick" type="button" ${attr} ${disabled ? 'disabled' : ''}>
      <span class="pick-text"><b>${title}</b>${sub ? `<small${one ? ' class="one"' : ''}${wrap ? ' data-layout-ok' : ''}>${sub}</small>` : ''}</span>
      <span class="chev" aria-hidden="true">${check ? icon('check') : icon('chev')}</span>
    </button>`;

  sheet('Change workout', (body, close, head) => {
    const home = () => {
      head.setStep('Change workout', null);
      const otherFocus = dayChoices(program).filter(([k]) => k !== plan.dayType).map(([, l]) => l);
      const otherPlaces = state.locations.filter((l) => !loc || l.id !== loc.id).map((l) => l.name);
      body.innerHTML = `
        <div class="stack">
          <p class="small muted">Nothing changes until you pick one. You can undo it right after.</p>
          <div class="pick-group">
            ${row('data-o="new"', 'New exercises', canSwap ? `Same ${esc(focusLabel)} focus, different moves.` : esc(noSwapReason(where, focusLabel)), { disabled: !canSwap, wrap: true })}
            ${row('data-o="focus"', 'Train a different focus', esc(otherFocus.join(', ')), { one: true, wrap: true })}
            ${row('data-o="length"', 'Session length', `Now ${minOverride || usual} min, for today only.`, { wrap: true })}
            ${state.locations.length > 1 ? row('data-o="place"', 'Different location', esc(otherPlaces.join(', ')), { one: true, wrap: true }) : ''}
            ${isChanged({ edits, dayOverride, minOverride, choice }) ? row('data-o="reset"', 'Back to recommended', 'Clears every change for today.') : ''}
          </div>
          ${picks.size && canSwap ? '<label class="choice check"><input type="checkbox" data-replace-picks><span>Also replace the ones I picked<small>Otherwise your own picks stay.</small></span></label>' : ''}
        </div>`;
      const on = (o, fn) => { const b = $(`[data-o="${o}"]`, body); if (b) b.onclick = () => { tick(); fn(); }; };
      on('new', () => {
        const before = snap();
        const replace = !!($('[data-replace-picks]', body) || {}).checked;
        const { next, afterIds, res } = tryNew(replace);
        if (!res.changed) { toast(noSwapReason(where, focusLabel)); return; }
        edits = { ...next, rest: carryRest(next.rest, ids, afterIds) };
        close();
        changed(el, before, swapMessage(res), afterIds.filter((id) => !ids.includes(id)));
      });
      on('focus', focusStep);
      on('length', lengthStep);
      on('place', placeStep);
      on('reset', () => {
        const before = snap();
        edits = { ...blankEdits(edits.key), rest: { ...edits.rest } };
        dayOverride = null;
        minOverride = null;
        choice = null;
        close();
        changed(el, before, 'Back to the recommended workout');
      });
    };
    const listStep = (title, rows, onPick) => {
      head.setStep(title, () => { tick(); home(); });
      body.innerHTML = `<div class="stack"><div class="pick-group">${rows}</div></div>`;
      $$('[data-v]', body).forEach((b) => (b.onclick = () => { tick(); onPick(b.dataset.v); }));
    };
    const focusStep = () => {
      const choices = dayChoices(program);
      const recKey = recommended ? recommended.dayType : null;
      const recLabel = recommended ? recommended.label : 'the usual';
      const rows = [row('data-v=""', `Recommended: ${esc(recLabel)}`, 'Forge’s pick for today.', { check: !dayOverride })]
        .concat(choices.filter(([k]) => k !== recKey).map(([k, l]) => row(`data-v="${esc(k)}"`, esc(l), '', { check: dayOverride === k })));
      listStep('Focus', rows.join(''), (v) => {
        const before = snap();
        dayOverride = v || null;
        choice = null;
        const label = v ? (choices.find(([k]) => k === v) || [0, v])[1] : recLabel;
        close();
        changed(el, before, lengthMessage(label, minOverride));
      });
    };
    const lengthStep = () => {
      // Each row previews the real result of picking it.
      const rows = LENGTHS.map((n) => {
        const p = planToday({ customDay: dayDef(), dayType: dayOverride, forced: edits.forced, avoidIds: edits.avoid, sessionMin: n === usual ? null : n, restSec: edits.rest });
        const fits = !!p && p.exercises.length > 0 && p.est_minutes <= n + 2;
        const sub = fits ? `${plural(p.exercises.length, 'exercise')}${n === usual ? ' · your usual' : ''}` : 'Too short for this workout here';
        return row(`data-v="${n}"`, `${n} min`, sub, { disabled: !fits, check: (minOverride || usual) === n, one: true });
      });
      listStep('Session length', rows.join(''), (v) => {
        const before = snap();
        minOverride = Number(v) === usual ? null : Number(v);
        close();
        changed(el, before, lengthMessage(focusLabel, Number(v)));
      });
    };
    const placeStep = () => {
      const rows = state.locations.map((l) => row(`data-v="${esc(l.id)}"`, esc(l.name), '', { check: loc && l.id === loc.id }));
      listStep('Gym', rows.join(''), (v) => {
        if (loc && v === loc.id) { close(); return; }
        const before = snap();
        dayOverride = null;
        setActiveLocation(v);
        close();
        const to = state.locations.find((l) => l.id === v);
        flash = new Set();
        tick('success');
        toast(`Now at ${to ? to.name : 'a new gym'}`, 6000, { action: { label: 'Undo', onClick: () => undoTo(el, before) } });
      });
    };
    home();
  }, { detents: ['medium', 'large'] });
}

/** Where and how long, right on the card: tap either and today's workout is rebuilt on the spot. */
function pvControls(plan, loc) {
  const usual = (state.profile && state.profile.sessionMin) || 60;
  const now = minOverride || usual;
  const fixed = !!(dayDef() && dayDef().fixed); // your own list keeps its sets, so the length chips sit this out
  return `
        <div class="pv-ctl">
          ${loc && state.locations.length > 1 ? `<button class="pv-chip pv-gym" data-pv-gym aria-haspopup="dialog" aria-label="Location: ${esc(loc.name)}. Change location">
            <span class="gym-pin" aria-hidden="true">${icon('pin')}</span><span>${esc(loc.name)}</span></button>` : ''}
          <div class="pv-len" role="radiogroup" aria-label="Session length${fixed ? ' (your own workout keeps its sets)' : ''}">
            ${LENGTHS.map((n) => `<button class="pv-chip" type="button" role="radio" aria-checked="${!fixed && now === n}" data-len="${n}" ${fixed ? 'disabled' : ''} aria-label="${n} minutes">${durationLabel(n)}</button>`).join('')}
          </div>
        </div>`;
}

/** A duration chip: rebuild today's workout for that many minutes (today only), with Undo. */
function pickLength(el, plan, n) {
  const usual = (state.profile && state.profile.sessionMin) || 60;
  if ((minOverride || usual) === n) { tick('light'); return; }
  const before = snap();
  minOverride = n === usual ? null : n;
  tick();
  changed(el, before, lengthMessage(plan.label, n), []);
}

/**
 * "Switch workout": three ways to change what you do today. Each one rebuilds the preview and offers Undo;
 * nothing is saved unless you ask (Save for later).
 */
function openSwitch(el, plan) {
  let local = null; // the list as this sheet last wrote it, until the settings listener delivers a newer one
  let seen = null;
  let view = 'home';
  const stored = () => state.settings && state.settings.saved_workouts;
  const savedList = () => {
    if (local && stored() !== seen) local = null;
    return local || cleanSaved(stored());
  };
  const setLocal = (list) => { local = list; seen = stored(); };
  const row = (attr, title, sub) => `
    <button class="pick" type="button" ${attr}>
      <span class="pick-text"><b>${title}</b><small data-layout-ok>${sub}</small></span>
      <span class="chev" aria-hidden="true">${icon('chev')}</span>
    </button>`;
  const apply = (next, message, close, skippedOf = null) => {
    const before = snap();
    choice = next;
    dayOverride = null;
    const fresh = previewPlan();
    if (!fresh || !fresh.exercises.length) {
      choice = before.choice;
      dayOverride = before.dayOverride;
      toast('Nothing fits this gym for that. Try other muscles or another gym.');
      return;
    }
    close();
    const ids = fresh.exercises.map((it) => it.exercise_id);
    const skipped = skippedOf ? skippedOf.filter((id) => !ids.includes(id)) : [];
    changed(el, before, skipped.length ? `${message}. ${skippedText(skipped)}` : message, ids);
  };
  const joints = jointAvoidSet(state.profile);
  sheet('Switch workout', (body, close, head) => {
    const home = () => {
      view = 'home';
      head.setStep('Switch workout', null);
      const n = savedList().length;
      body.innerHTML = `
        <div class="stack">
          <p class="small muted">Nothing changes until you pick one. You can undo it right after.</p>
          <div class="pick-group">
            ${row('data-o="muscles"', 'Pick muscle groups', 'Choose what to train. Forge builds it for this gym.')}
            ${row('data-o="saved"', 'Saved workouts', n ? `${n} saved` : 'None yet. Save any workout to start it later.')}
            ${row('data-o="scratch"', 'Create from scratch', 'Pick exercises, sets and reps.')}
          </div>
          ${plan.exercises.length ? '<button class="btn ghost" data-o="save-now">Save this workout for later</button>' : ''}
        </div>`;
      const on = (o, fn) => { const b = $(`[data-o="${o}"]`, body); if (b) b.onclick = () => { tick(); fn(); }; };
      on('muscles', musclesStep);
      on('saved', savedStep);
      on('scratch', () => { close(); openScratchBuilder(el); });
      on('save-now', () => nameStep(itemsFromPlan(plan, (id) => !!(exerciseById(id) || {}).timed), plan.label));
    };
    const musclesStep = () => {
      view = 'muscles';
      head.setStep('Muscle groups', () => { tick(); home(); });
      const picked = new Set(choice && choice.kind === 'muscles' ? cleanMuscles(choice.groups) : []);
      body.innerHTML = `
        <div class="stack">
          <p class="small muted">Pick up to ${MAX_MUSCLES}. ${joints.size ? 'Moves that stress the joints you protect are left out.' : 'Turn on Knees or Lower back under Protect to leave out the moves that stress them.'}</p>
          <div class="chips chips--grid chips--grid-2" role="group" aria-label="Muscle groups">
            ${FOCUS_KEYS.map((k) => `<label class="chip"><input type="checkbox" value="${k}" ${picked.has(k) ? 'checked' : ''}><span>${esc(FOCUS_GROUPS[k].label)}</span></label>`).join('')}
          </div>
          <button class="btn bigbtn" data-build disabled>Build workout</button>
        </div>`;
      const boxes = $$('input[type=checkbox]', body);
      const build = $('[data-build]', body);
      const sync = () => { build.disabled = !boxes.some((b) => b.checked); };
      boxes.forEach((b) => b.addEventListener('change', () => {
        if (b.checked && boxes.filter((x) => x.checked).length > MAX_MUSCLES) { b.checked = false; haptics.warning && haptics.warning(); toast(`Up to ${MAX_MUSCLES} groups`); return; }
        tick();
        sync();
      }));
      sync();
      build.onclick = () => {
        const groups = cleanMuscles(boxes.filter((b) => b.checked).map((b) => b.value));
        apply({ kind: 'muscles', groups }, musclesLabel(groups), close);
      };
    };
    const savedStep = () => {
      view = 'saved';
      head.setStep('Saved workouts', () => { tick(); home(); });
      const list = savedList();
      const names = (sv) => `${savedSub(sv)}: ${sv.items.slice(0, 3).map((i) => (exerciseById(i.exercise_id) || {}).name || i.exercise_id).join(', ')}${sv.items.length > 3 ? '…' : ''}`;
      body.innerHTML = list.length ? `
        <div class="stack">
          <ul class="list saved-list">
            ${list.map((sv) => `<li class="saved-row">
              <button class="pick saved-go" type="button" data-use="${esc(sv.id)}"><span class="pick-text"><b data-layout-ok>${esc(sv.name)}</b><small data-layout-ok>${esc(names(sv))}</small></span></button>
              <button class="icon-btn" type="button" data-del="${esc(sv.id)}" aria-label="Delete ${esc(sv.name)}">${icon('close')}</button>
            </li>`).join('')}
          </ul>
        </div>` : '<div class="stack"><p class="muted">Nothing saved yet. Build a workout, or tap “Save this workout for later” on the Switch sheet.</p></div>';
      $$('[data-use]', body).forEach((b) => (b.onclick = () => {
        const sv = list.find((x) => x.id === b.dataset.use);
        if (sv) apply({ kind: 'saved', id: sv.id }, sv.name, close, sv.items.map((i) => i.exercise_id));
      }));
      $$('[data-del]', body).forEach((b) => (b.onclick = () => {
        tick('light');
        const id = b.dataset.del;
        const cur = savedList();
        const at = cur.findIndex((x) => x.id === id);
        if (at < 0) return;
        const gone = cur[at];
        const wasCurrent = !!choice && choice.kind === 'saved' && choice.id === id;
        const before = wasCurrent ? snap() : null;
        setLocal(removeSaved(cur, id));
        patch('settings', 'main', { saved_workouts: local });
        if (wasCurrent) { choice = null; flash = new Set(); if (el.isConnected) renderTrain(el); }
        toast(`Deleted ${gone.name}`, 6000, { action: { label: 'Undo', onClick: () => {
          const now = savedList().filter((x) => x.id !== id);
          now.splice(Math.min(at, now.length), 0, gone);
          const next = cleanSaved(now);
          patch('settings', 'main', { saved_workouts: next });
          setLocal(next);
          if (view === 'saved' && body.isConnected) savedStep();
          if (before) undoTo(el, before);
        } } });
        savedStep();
      }));
    };
    const nameStep = (items, suggested) => {
      view = 'name';
      head.setStep('Save workout', () => { tick(); home(); });
      body.innerHTML = `
        <div class="stack">
          <label class="field"><span class="label">Name</span><input value="${esc(suggested)}" maxlength="40" data-name aria-label="Workout name"></label>
          <button class="btn bigbtn" data-save>Save</button>
        </div>`;
      $('[data-save]', body).onclick = () => {
        saveWorkout($('[data-name]', body).value.trim() || 'My workout', items);
        close();
      };
    };
    home();
  }, { detents: ['medium', 'large'] });
}

/** "1 skipped: needs a barbell" for saved moves this gym can't do. */
function skippedText(ids) {
  const need = new Set();
  for (const id of ids) {
    const alt = ((exerciseById(id) || {}).equip || [])[0] || [];
    alt.forEach((e) => need.add(String(e).replace(/_/g, ' ')));
  }
  return `${ids.length} skipped${need.size ? `: needs ${[...need].slice(0, 2).join(' or ')}` : ''}`;
}

/** Store a workout in Settings (no new collection, so no rules change) and say so. */
function saveWorkout(name, items) {
  const prev = cleanSaved(state.settings && state.settings.saved_workouts);
  const entry = { id: `sw_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, created_at: new Date().toISOString(), items };
  patch('settings', 'main', { saved_workouts: addSaved(prev, entry) });
  tick('success');
  toast(`Saved “${name}”`, 6000, { action: { label: 'Undo', onClick: () => patch('settings', 'main', { saved_workouts: removeSaved(state.settings && state.settings.saved_workouts, entry.id) }) } });
}

/** Create from scratch: pick exercises, set sets and reps, use it today, optionally save it. `draft` survives the exercise picker. */
function openScratchBuilder(el, draft = null) {
  const d = draft || { name: '', items: [], save: false };
  const avail = expandEquipment((activeLocation() || {}).equipment || []);
  const avoid = jointAvoidSet(state.profile);
  sheet('Create a workout', (body, close) => {
    const draw = () => {
      body.innerHTML = `
        <div class="stack">
          <ul class="list scratch-list">${d.items.map((it, i) => {
            const ex = exerciseById(it.exercise_id);
            return `<li class="scratch-row">
              <div class="scratch-name"><b>${esc(ex ? ex.name : it.exercise_id)}</b>
                <button class="icon-btn" type="button" data-rm="${i}" aria-label="Remove ${esc(ex ? ex.name : 'exercise')}">${icon('close')}</button></div>
              <div class="scratch-step">
                <span class="scratch-grp"><span class="muted small">Sets</span>
                <span class="scratch-trio"><button class="icon-btn" type="button" data-s="${i}:-1" aria-label="Fewer sets">−</button><b>${it.sets}</b><button class="icon-btn" type="button" data-s="${i}:1" aria-label="More sets">+</button></span></span>
                <span class="scratch-grp"><span class="muted small">${it.timed ? 'Seconds' : 'Reps'}</span>
                <span class="scratch-trio"><button class="icon-btn" type="button" data-r="${i}:-1" aria-label="Fewer reps">−</button><b>${it.reps_lo === it.reps_hi ? it.reps_hi : `${it.reps_lo}–${it.reps_hi}`}</b><button class="icon-btn" type="button" data-r="${i}:1" aria-label="More reps">+</button></span></span>
              </div>
            </li>`;
          }).join('') || '<li class="muted">No exercises yet</li>'}</ul>
          <button class="btn ghost" type="button" data-add>+ Add exercise</button>
          <label class="choice check"><input type="checkbox" data-save ${d.save ? 'checked' : ''}><span>Save for later<small>Find it under Saved workouts.</small></span></label>
          <label class="field" ${d.save ? '' : 'hidden'} data-name-wrap><span class="label">Name</span><input value="${esc(d.name)}" maxlength="40" data-name aria-label="Workout name" placeholder="My workout"></label>
          <button class="btn bigbtn" type="button" data-use ${d.items.length ? '' : 'disabled'}>Use this workout</button>
        </div>`;
      $$('[data-rm]', body).forEach((b) => (b.onclick = () => { tick('light'); d.items.splice(Number(b.dataset.rm), 1); draw(); }));
      const bump = (key, fn) => $$(`[data-${key}]`, body).forEach((b) => (b.onclick = () => {
        const [i, dir] = b.dataset[key].split(':').map(Number);
        tick();
        d.items[i] = fn(d.items[i], dir);
        draw();
        $(`[data-${key}="${i}:${dir}"]`, body)?.focus({ preventScroll: true });
      }));
      bump('s', (it, dir) => ({ ...it, sets: Math.min(8, Math.max(1, it.sets + dir)) }));
      bump('r', (it, dir) => {
        const step = repStep(!!it.timed, dir > 0 ? it.reps_lo : it.reps_lo - 1) * dir;
        const lo = Math.min(it.timed ? 3600 : 100, Math.max(1, it.reps_lo + step));
        return { ...it, reps_lo: lo, reps_hi: Math.min(it.timed ? 3600 : 100, Math.max(lo, it.reps_hi + step)) };
      });
      $('[data-add]', body).onclick = () => {
        tick('light');
        d.name = $('[data-name]', body).value;
        d.save = $('[data-save]', body).checked;
        close();
        const inList = new Set(d.items.map((x) => x.exercise_id));
        openExercisePicker({
          title: 'Add an exercise',
          filter: (c) => !inList.has(c.id) && canDo(c, avail) && jointFriendly(c, avoid),
          availableNote: avoid.size ? 'Doable at this gym, and easy on the joints you protect.' : 'Doable at this gym.',
          onPick: (ex) => { d.items.push(defaultItem(ex)); openScratchBuilder(el, d); },
        });
      };
      $('[data-save]', body).addEventListener('change', (e) => { tick(); d.save = e.target.checked; $('[data-name-wrap]', body).hidden = !d.save; });
      $('[data-use]', body).onclick = () => {
        const name = $('[data-name]', body).value.trim() || 'My workout';
        const saveIt = $('[data-save]', body).checked;
        const items = d.items.slice();
        const before = snap();
        choice = { kind: 'scratch', name, items };
        dayOverride = null;
        close();
        if (saveIt) saveWorkout(name, items);
        changed(el, before, name, items.map((x) => x.exercise_id));
      };
    };
    draw();
  }, { detents: ['medium', 'large'] });
}

/** What's doable here and not already planned, for Replace and the preview's Swap. */
function slotContext(plan, i) {
  const it = plan.exercises[i];
  const ex = exerciseById(it.exercise_id);
  const loc = activeLocation();
  const avail = expandEquipment(loc ? loc.equipment : []);
  const inPlan = new Set(plan.exercises.map((x) => x.exercise_id));
  // A Protect stand-in is picked from its original slot's movement, so Replace still has options.
  const slotEx = (it.swap && exerciseById(it.swap.from)) || ex;
  return { ex, avail, inPlan, slotEx, avoid: jointAvoidSet(state.profile) };
}

/** Put `c` in this slot. Keyed by what the generator picks for the slot, so it survives re-renders. */
function applyReplace(el, ex, c) {
  const orig = Object.keys(edits.forced).find((k) => edits.forced[k] === ex.id) || ex.id;
  const prevForced = edits.forced[orig];
  const prevRest = { ...edits.rest };
  edits.forced[orig] = c.id;
  if (edits.rest[ex.id]) { edits.rest[c.id] = edits.rest[ex.id]; delete edits.rest[ex.id]; }
  toast(`Replaced with ${c.name}`, 5000, { action: { label: 'Undo', onClick: () => {
    if (prevForced === undefined) delete edits.forced[orig]; else edits.forced[orig] = prevForced;
    edits.rest = prevRest;
    if (el.isConnected) renderTrain(el);
  } } });
  renderTrain(el);
}

function replaceExercise(el, plan, i) {
  const { ex, avail, inPlan, slotEx, avoid } = slotContext(plan, i);
  openExercisePicker({
    title: `Replace ${ex.name}`,
    onlyPattern: ex.pattern,
    patterns: jointPickerPatterns(slotEx.pattern, avoid),
    primary: slotEx.primary || [],
    filter: (c) => !inPlan.has(c.id) && canDo(c, avail) && jointFriendly(c, jointAvoidSet(state.profile)),
    availableNote: avoid.size ? 'Same movement, doable here, and easy on the joints you protect.' : 'Same movement, doable at this location.',
    onPick: (c) => applyReplace(el, ex, c),
  });
}

/** Tap a row or thumbnail: the demo preview, with Swap (best match, one tap) and Replace (the picker). */
function previewDemo(el, plan, i, origin) {
  const { ex, avail, inPlan, slotEx, avoid } = slotContext(plan, i);
  const pick = () => swapCandidate(slotEx, ex, { exercises: allExercises(), canDo: (c) => canDo(c, avail), inPlan, avoid, patterns: jointPickerPatterns(slotEx.pattern, avoid) });
  openDemoPreview(ex, {
    origin,
    canSwap: !!pick(),
    onSwap: () => { const c = pick(); if (c) applyReplace(el, ex, c); },
    onReplace: () => replaceExercise(el, plan, i),
  });
}

function exerciseMore(el, plan, i) {
  const it = plan.exercises[i];
  const ex = exerciseById(it.exercise_id);
  const ed = edits;
  const auto = autoRest(it, ex, { deload: !!deloadInfo(activeProgram(), state.profile.experience).deload, defaultSec: restDefaultSec(state.settings) });
  sheet(ex.name, (body, close) => {
    body.innerHTML = `
      <div class="stack">
        <button class="btn ghost" data-a="replace">Replace</button>
        <button class="btn ghost" data-a="history">History &amp; how-to</button>
        <div>
          <p class="label">Rest timer</p>
          <div class="chips chips--grid chips--grid-4" role="radiogroup" aria-label="Rest after each set">
            <label class="chip chip-wide"><input type="radio" name="rest" value="" ${it.rest_sec ? '' : 'checked'}><span>Default (${fmtClock(auto)})</span></label>
            ${REST_CHOICES.map((sec) => `<label class="chip"><input type="radio" name="rest" value="${sec}" ${it.rest_sec === sec ? 'checked' : ''}><span>${fmtClock(sec)}</span></label>`).join('')}
          </div>
        </div>
      </div>`;
    $('[data-a="replace"]', body).onclick = () => { close(); replaceExercise(el, plan, i); };
    $('[data-a="history"]', body).onclick = () => { close(); openHowTo(ex.id, { focus: 'history' }); };
    $$('input[name=rest]', body).forEach((r) => r.addEventListener('change', () => {
      if (r.value) ed.rest[ex.id] = Number(r.value);
      else delete ed.rest[ex.id];
      close();
      renderTrain(el);
    }));
  });
}

function openFocusPicker() {
  sheet('Focus areas', (body, close) => {
    body.innerHTML = `${focusChipsHtml(state.profile.focus_muscles)}
      <div class="row gap focus-actions"><button class="btn grow" data-ok>Done</button></div>`;
    const read = bindFocusChips(body);
    $('[data-ok]', body).onclick = () => {
      const list = cleanFocus(read());
      close();
      patch('profile', 'main', { focus_muscles: list });
      toast(list.length ? `Focus: ${focusLabel(list)}` : 'Focus areas cleared');
    };
  });
}

function openProgramPicker() {
  const current = activeProgram();
  sheet('Choose a program', (body, close) => {
    body.innerHTML = `
      <div class="choices">
        ${Object.entries(PROGRAMS).map(([k, p]) => `
          <label class="choice">
            <input type="radio" name="prog" value="${k}" ${current && current.template === k ? 'checked' : ''}>
            <span>${esc(p.name)}<small>${esc(p.description)}</small></span>
          </label>`).join('')}
      </div>
      <p class="small muted">Switching starts a new cycle (week 1). Your history and progress carry over.</p>
      <div class="row gap"><button class="btn grow" data-ok>Use this program</button></div>`;
    $('[data-ok]', body).onclick = async () => {
      const k = $('input[name=prog]:checked', body)?.value;
      if (!k) return;
      close();
      if (PROGRAMS[k].custom) {
        openCustomBuilder(current && current.template === 'custom' ? current : null);
        return;
      }
      if (current && current.template === k) return;
      startProgram(k);
      dayOverride = null;
      choice = null;
      toast(`Program: ${PROGRAMS[k].name}`);
    };
  });
}

/**
 * Build my own. `existing` is the saved custom program (or null); `draftDays` carries unsaved edits
 * while the builder hops to the exercise picker and back.
 */
function openCustomBuilder(existing, draftDays = null) {
  const days = draftDays || (existing ? structuredClone(existing.custom_days || []) : [{ name: 'Day 1', exercise_ids: [] }]);
  sheet('Build my own', (body, close) => {
    const draw = () => {
      body.innerHTML = `
        <div class="stack">
          ${days.map((d, i) => `
            <div class="card">
              <div class="row gap center">
                <input class="grow" value="${esc(d.name)}" data-name="${i}" aria-label="Day name" maxlength="30">
                <button class="icon-btn" data-delday="${i}" aria-label="Remove day">${icon('close')}</button>
              </div>
              <ul class="list">${d.exercise_ids.map((id, j) => `
                <li><span>${esc(exerciseById(id)?.name || id)}</span><button class="icon-btn" data-delex="${i}:${j}" aria-label="Remove">${icon('close')}</button></li>`).join('') || '<li class="muted">No exercises yet</li>'}</ul>
              <button class="btn ghost small" data-addex="${i}">+ Add exercise</button>
            </div>`).join('')}
          ${days.length < 7 ? '<button class="btn ghost" data-addday>+ Add a day</button>' : ''}
          <p class="small muted">On the day, exercises your location can’t do are skipped.</p>
          <button class="btn" data-save>Save program</button>
        </div>`;
      $$('[data-name]', body).forEach((inp) =>
        inp.addEventListener('change', () => (days[Number(inp.dataset.name)].name = inp.value.trim() || `Day ${Number(inp.dataset.name) + 1}`)));
      $$('[data-delday]', body).forEach((b) => (b.onclick = () => { days.splice(Number(b.dataset.delday), 1); draw(); }));
      $$('[data-delex]', body).forEach((b) => (b.onclick = () => {
        const [i, j] = b.dataset.delex.split(':').map(Number);
        days[i].exercise_ids.splice(j, 1);
        draw();
      }));
      $$('[data-addex]', body).forEach((b) => (b.onclick = () => {
        const i = Number(b.dataset.addex);
        close();
        openExercisePicker({
          title: `Add to ${days[i].name}`,
          onPick: (ex) => {
            days[i].exercise_ids.push(ex.id);
            openCustomBuilder(existing, days);
          },
        });
      }));
      const add = $('[data-addday]', body);
      if (add) add.onclick = () => { days.push({ name: `Day ${days.length + 1}`, exercise_ids: [] }); draw(); };
      $('[data-save]', body).onclick = () => {
        const kept = days.filter((d) => d.exercise_ids.length);
        if (!kept.length) { toast('Add at least one exercise.'); return; }
        if (existing) patch('programs', existing.id, { custom_days: kept });
        else startProgram('custom', { custom_days: kept });
        dayOverride = null;
        close();
        toast('Program saved');
      };
    };
    draw();
  });
}

/** Today's plan → muscle values for the preview map: working sets per muscle (secondary half), scaled to 0..1. */
function planValues(plan) {
  const v = {};
  for (const it of plan.exercises) {
    const ex = exerciseById(it.exercise_id);
    if (!ex || ex.kind === 'conditioning') continue;
    const n = it.target?.sets || 1;
    for (const m of ex.primary || []) v[m] = (v[m] || 0) + n;
    for (const m of ex.secondary || []) v[m] = (v[m] || 0) + n * 0.5;
  }
  const max = Math.max(1, ...Object.values(v));
  for (const m of Object.keys(v)) v[m] = 0.25 + 0.75 * (v[m] / max);
  return v;
}
