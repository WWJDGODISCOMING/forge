// v0.16.19: Focus areas. Scoring, set caps, deload, fixed programs, chips rules and the Coach answer. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { EXERCISES } from '../js/workouts/exercises.js';
import { LOCATION_PRESETS, YMCA_PRESET } from '../js/workouts/equipment.js';
import { generateWorkout, pickDayType } from '../js/workouts/generator.js';
import { MUSCLES } from '../js/workouts/recovery.js';
import { FOCUS_GROUPS, FOCUS_MAX_ADDED, MAX_FOCUS, cleanFocus, activeFocus, focusLabel, dayFocusBonus } from '../js/workouts/focus.js';
import { spotAnswer, availableQuestions } from '../js/coach/answers.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const HOME = LOCATION_PRESETS.find((l) => l.key === 'home');
const YMCA = { equipment: YMCA_PRESET, weight_inventory: {} };
const base = { experience: 'intermediate', sessionMin: 90, trainingDays: 3, injuries: '' };
const fresh = Object.fromEntries(MUSCLES.map((m) => [m, 100]));
const gen = (o) => generateWorkout({ location: YMCA, exercises: EXERCISES, unit: 'lb', recovery: fresh, ...o });
const total = (w) => w.exercises.reduce((n, it) => n + it.target.sets, 0);
const withFocus = (focus_muscles) => ({ ...base, focus_muscles });

test('cleanFocus keeps valid unique groups, max 3', () => {
  eq(cleanFocus(['chest', 'chest', 'nope', 'arms', 'back', 'abs']).join(), 'chest,arms,back');
  eq(cleanFocus(undefined).length, 0);
  eq(MAX_FOCUS, 3);
  eq(focusLabel(['shoulders', 'abs']), 'Shoulders, Abs/core');
});

test('every focus group maps only to real muscles', () => {
  for (const g of Object.values(FOCUS_GROUPS)) for (const m of g.muscles) assert(MUSCLES.includes(m), m);
});

test('scoring: a focus nudges Smart toward the day that trains it, but only when recovered', () => {
  // arms days: push/pull style splits both hit arms, so use shoulders vs legs on a tie
  const rec = { ...fresh };
  const tie = (focus, recovery) => pickDayType('smart', { recovery, daysPerWeek: 3, focus });
  const plain = tie([], rec);
  const other = ['full_a', 'full_b', 'full_c'].find((d) => d !== plain);
  assert(dayFocusBonus(['front_delts'], ['shoulders'], rec) > 0);
  eq(dayFocusBonus(['quads'], ['shoulders'], rec), 0);
  // tired focus muscles get no bonus (recovery still wins)
  eq(dayFocusBonus(['front_delts'], ['shoulders'], { ...rec, front_delts: 40 }), 0);
  eq(dayFocusBonus(['chest'], ['chest'], { ...rec, chest: 59 }), 0);
  assert(dayFocusBonus(['chest'], ['chest'], { ...rec, chest: 60 }) > 0);
  assert(other);
  // the bonus is small: a clearly more recovered day beats a focus day
  const rec2 = { ...fresh, chest: 100, lats: 100, quads: 100, hamstrings: 100, glutes: 100, upper_back: 100, front_delts: 100 };
  const withBonus = pickDayType('smart', { recovery: rec2, daysPerWeek: 4, focus: ['legs'] });
  assert(typeof withBonus === 'string');
  const tiredLegs = { ...rec2, quads: 30, hamstrings: 30, glutes: 30, calves: 30 };
  assert(!['lower', 'legs'].includes(pickDayType('smart', { recovery: tiredLegs, daysPerWeek: 4, focus: ['legs'] })), 'tired legs are not picked just because they are a focus');
});

test('extra sets: +1 on a focus lift, never more than the cap, and the plan says so', () => {
  const plain = gen({ programKey: 'ppl', dayType: 'push', profile: base });
  const f = gen({ programKey: 'ppl', dayType: 'push', profile: withFocus(['chest', 'shoulders', 'arms']) });
  const added = total(f) - total(plain);
  assert(added >= 1 && added <= FOCUS_MAX_ADDED, `added ${added}`);
  eq(added, f.focus.length);
  assert(f.focus.length >= 2);
  assert(f.focusLabel.length > 0);
  assert(f.notes.every((n) => typeof n === 'string'));
});

test('extra sets never exceed +4 per session, even with three groups on a full-body day', () => {
  const plain = gen({ programKey: 'full_body_3x', dayType: 'full_a', profile: base });
  const f = gen({ programKey: 'full_body_3x', dayType: 'full_a', profile: withFocus(['chest', 'back', 'legs']) });
  const added = total(f) - total(plain);
  assert(added <= FOCUS_MAX_ADDED && added >= 1, `added ${added}`);
});

test('no focus, no change; a focus the day does not train changes nothing', () => {
  const plain = gen({ programKey: 'ppl', dayType: 'push', profile: base });
  eq(gen({ programKey: 'ppl', dayType: 'push', profile: withFocus([]) }).focus.length, 0);
  const legsOnPush = gen({ programKey: 'ppl', dayType: 'push', profile: withFocus(['legs']) });
  eq(total(legsOnPush), total(plain));
  eq(legsOnPush.focus.length, 0);
});

test('deload week: no extra sets', () => {
  const program = { started_at: '2026-01-01T00:00:00Z' };
  const now = Date.parse('2026-01-01T00:00:00Z') + 28 * 86400000; // week 5 of 5 for intermediate
  const plain = gen({ programKey: 'ppl', dayType: 'push', profile: base, program, now });
  assert(plain.deload);
  const f = gen({ programKey: 'ppl', dayType: 'push', profile: withFocus(['chest', 'shoulders']), program, now });
  eq(total(f), total(plain));
  eq(f.focus.length, 0);
});

test('a focus muscle under 60% recovered gets no extra set', () => {
  const tired = { ...fresh, chest: 45 };
  const plain = gen({ programKey: 'ppl', dayType: 'push', profile: base, recovery: tired });
  const f = gen({ programKey: 'ppl', dayType: 'push', profile: withFocus(['chest']), recovery: tired });
  eq(total(f), total(plain));
  eq(activeFocus(['chest', 'legs'], tired).join(), 'legs');
});

test('fixed programs keep their day order and only get the extra-set rule', () => {
  for (const key of ['ppl', 'upper_lower', 'five_by_five']) {
    for (const n of [0, 1, 2, 3, 4, 5]) {
      eq(pickDayType(key, { doneCount: n, focus: ['legs', 'chest'], recovery: { ...fresh, quads: 10 } }), pickDayType(key, { doneCount: n }), `${key} ${n}`);
    }
  }
  const w = gen({ programKey: 'five_by_five', dayType: 'sl5x5_a', location: YMCA, profile: withFocus(['legs']) });
  assert(w.exercises.length > 0);
  const custom = pickDayType('custom', { doneCount: 1, customDays: [{}, {}, {}], focus: ['arms'] });
  eq(custom, 'custom_1');
});

test('the Focus tag and chips are wired into Train and onboarding', () => {
  const t = src('js/screens/train.js');
  assert(t.includes('Focus: ${esc(plan.focusLabel)}') && t.includes('data-focus'));
  assert(src('js/screens/onboarding.js').includes('focus_muscles'));
  const c = src('js/ui/focus-chips.js');
  assert(c.includes('focus-none') && c.includes('MAX_FOCUS'));
});

test('Coach: the spot-reduction answer needs a focus and is plain about fat loss', () => {
  eq(spotAnswer({}), null);
  const a = spotAnswer({ focus: ['abs'] });
  assert(/whole body/i.test(a.headline));
  assert(a.lines.length >= 2 && a.lines.length <= 4 && a.why);
  assert(/calorie/i.test(a.lines.join(' ')));
  assert(!/spot[- ]reduc\w+ works/i.test(a.lines.join(' ')));
  assert(!availableQuestions({ focus: [] }, '2026-10-10').some((q) => q.id === 'spot'));
});
