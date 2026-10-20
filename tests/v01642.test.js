// v0.16.42: Train's demo preview (open, swap from it, reduced motion, joint notes). Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { EXERCISES } from '../js/workouts/exercises.js';
import { LOCATION_PRESETS, expandEquipment, canDo } from '../js/workouts/equipment.js';
import { jointFriendly, jointPickerPatterns } from '../js/workouts/generator.js';
import { jointNotes, swapCandidate, originTransform, openKeyframes } from '../js/workouts/demo-preview-core.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const byId = (id) => EXERCISES.find((e) => e.id === id);
const GYM = LOCATION_PRESETS.find((l) => l.key === 'gym') || LOCATION_PRESETS[0];
const avail = expandEquipment(GYM.equipment);
const ctx = (avoid = new Set(), inPlan = new Set(), slot = null) => ({ exercises: EXERCISES, canDo: (c) => canDo(c, avail), inPlan, avoid, patterns: slot && jointPickerPatterns(slot.pattern, avoid) });

test('opening: rows and thumbnails open the preview; the ••• button does not', () => {
  const t = src('js/screens/train.js');
  assert(t.includes('data-preview="${i}"'), 'row has a preview hit area');
  assert(t.includes('Preview demo: '), 'VoiceOver label');
  assert(t.includes('role="button" tabindex="0" data-preview'), 'focusable');
  const row = t.slice(t.indexOf('class="pv-hit"'), t.indexOf('class="icon-btn pv-more"'));
  assert(row.includes('data-thumb') && !row.includes('data-more'), 'thumbnail inside the hit area, menu outside');
  assert(t.includes('openDemoPreview(ex,'), 'opens the sheet');
});

test('the sheet has the demo, cues, muscles, joint notes, Swap and Replace, offline fallback', () => {
  const d = src('js/screens/demo-preview.js');
  for (const k of ['mountFigure', 'photoLoop', 'photoFallback', 'Form cues', 'Works:', 'data-joints', 'data-a="swap"', 'data-a="replace"']) assert(d.includes(k), k);
  assert(d.includes("detents: ['medium', 'large']"), 'iPhone detents');
});

test('wide screens get a side panel, thumbnails a play badge', () => {
  const c = src('css/player.css');
  assert(/min-width: 600px\) \{\s*dialog\.sheet\.demo-sheet \{[^}]*inset: 0 0 0 auto/.test(c), 'side panel');
  assert(c.includes('.pv-thumb::after'), 'play badge');
});

test('jointNotes: nothing when off; stress vs easy per protected joint', () => {
  eq(jointNotes(byId('bb_back_squat'), new Set()).length, 0);
  const n = jointNotes(byId('bb_back_squat'), new Set(['knee']));
  eq(n.length, 1);
  assert(n[0].stress && n[0].text.includes('knees'), 'squat stresses knees');
  const easy = jointNotes(byId('glute_bridge'), new Set(['knee', 'lower_back']));
  assert(easy.length === 2 && easy.every((x) => !x.stress), 'bridge is easy on both');
});

test('swap from the preview: same movement or stand-in, doable, new, and joint-friendly', () => {
  const ex = byId('bb_back_squat');
  const avoid = new Set(['knee']);
  const inPlan = new Set([ex.id]);
  const c = swapCandidate(ex, ex, ctx(avoid, inPlan, ex));
  assert(c, 'a candidate exists');
  assert(c.id !== ex.id && jointPickerPatterns(ex.pattern, avoid).includes(c.pattern), 'same movement or its joint stand-in');
  assert(jointFriendly(c, avoid) && canDo(c, avail), 'friendly and doable');
  eq(swapCandidate(ex, ex, ctx(avoid, inPlan, ex)).id, c.id, 'steady pick');
  const other = swapCandidate(ex, ex, ctx(avoid, new Set([ex.id, c.id]), ex));
  assert(!other || other.id !== c.id, 'skips what is already planned');
  eq(swapCandidate(ex, ex, { ...ctx(avoid, inPlan, ex), canDo: () => false }), null, 'none doable -> null (Swap disabled)');
});

test('swap wiring: preview Swap and Replace share the replace path with the dots menu', () => {
  const t = src('js/screens/train.js');
  assert(t.includes('onSwap: () =>') && t.includes('applyReplace(el, ex, c)'), 'swap applies');
  assert(t.includes('onReplace: () => replaceExercise(el, plan, i)'), 'replace opens the picker');
  assert(t.includes('replaceExercise(el, plan, i); };'), 'the dots menu shares it');
});

test('reduced motion: a crossfade, no movement; otherwise it grows from the thumbnail', () => {
  const from = { left: 20, top: 300, width: 56, height: 56 };
  const to = { left: 20, top: 100, width: 350, height: 250 };
  const rm = openKeyframes(from, to, true);
  assert(rm.every((k) => !('transform' in k)), 'no transform');
  eq(rm[0].opacity, 0);
  const mv = openKeyframes(from, to, false);
  assert(mv[0].transform.includes('scale('), 'starts at the thumbnail');
  eq(mv[1].transform, 'none');
  const t = originTransform(from, to);
  assert(t.scale < 0.2 && t.dy > 0, 'smaller and below');
  eq(openKeyframes(null, to, false)[0].transform, undefined, 'no origin -> crossfade');
  assert(src('js/screens/demo-preview.js').includes('reducedMotion()'), 'reads the setting');
});
