// v0.16.40: Joints to protect. Synthetic profiles only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { EXERCISES } from '../js/workouts/exercises.js';
import { LOCATION_PRESETS, YMCA_PRESET } from '../js/workouts/equipment.js';
import { generateWorkout, jointAvoidSet, jointFriendly } from '../js/workouts/generator.js';
import { DAY_TYPES } from '../js/workouts/programs.js';
import { MUSCLES } from '../js/workouts/recovery.js';
import { SAFETY_LINE, protectSummary, protectRowHtml } from '../js/ui/protect-view.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const byId = (id) => EXERCISES.find((e) => e.id === id);
const base = { experience: 'intermediate', sessionMin: 90, trainingDays: 3, injuries: '' };
const fresh = Object.fromEntries(MUSCLES.map((m) => [m, 100]));
const HOME = LOCATION_PRESETS.find((l) => l.key === 'home');
const GYM = { equipment: YMCA_PRESET, weight_inventory: {} };
const gen = (profile, location = GYM, dayType = 'legs', programKey = 'smart') => generateWorkout({ programKey, dayType, location, exercises: EXERCISES, unit: 'lb', recovery: fresh, profile });
const DAYS = Object.keys(DAY_TYPES);
const stresses = (id) => byId(id).avoid.some((t) => t === 'knee' || t === 'lower_back');

test('jointAvoidSet: empty, knee, back, both, bad values', () => {
  eq(jointAvoidSet({}).size, 0);
  eq(jointAvoidSet(null).size, 0);
  eq([...jointAvoidSet({ protectJoints: ['knee'] })].join(), 'knee');
  eq([...jointAvoidSet({ protectJoints: ['lower_back'] })].join(), 'lower_back');
  eq([...jointAvoidSet({ protectJoints: ['knee', 'lower_back'] })].sort().join(), 'knee,lower_back');
  eq(jointAvoidSet({ protectJoints: ['elbow', 7, null, 'knee'] }).size, 1, 'unknown values are ignored');
  eq(jointAvoidSet({ protectJoints: 'knee' }).size, 0, 'a non-list is ignored');
});

test('tags: the moves named in the issue carry the right joint tag', () => {
  const knee = ['bb_back_squat', 'bb_front_squat', 'db_goblet_squat', 'bb_reverse_lunge', 'db_walking_lunge', 'db_step_up', 'bw_step_up', 'squat_jump', 'box_jump', 'machine_leg_extension', 'bw_sissy_squat', 'jumping_jacks', 'jump_rope', 'high_knees', 'squat_assisted'];
  const back = ['bb_deadlift', 'bb_good_morning', 'bb_bent_row', 'db_bent_row', 'bb_back_squat', 'bb_overhead_press', 'db_standing_shoulder_press', 'kb_press', 'decline_situp', 'cable_crunch', 'band_good_morning', 'db_single_leg_rdl', 'kb_single_leg_deadlift', 'band_rdl'];
  for (const id of knee) assert(byId(id).avoid.includes('knee'), `${id} knee`);
  for (const id of back) assert(byId(id).avoid.includes('lower_back'), `${id} lower_back`);
  for (const id of ['glute_bridge', 'bw_glute_kickback', 'machine_seated_leg_curl', 'bw_straight_leg_raise', 'bw_side_lying_leg_raise', 'machine_chest_press', 'dead_bug', 'db_chest_supported_row']) assert(!stresses(id), `${id} is friendly`);
});

test('the generator never picks a knee- or back-avoided move when its toggle is on', () => {
  for (const joint of ['knee', 'lower_back']) {
    for (const loc of [GYM, HOME]) {
      for (const d of DAYS) {
        const w = gen({ ...base, protectJoints: [joint] }, loc, d);
        for (const it of w.exercises) assert(!byId(it.exercise_id).avoid.includes(joint), `${d}: ${it.exercise_id} stresses ${joint}`);
      }
    }
  }
  const both = gen({ ...base, protectJoints: ['knee', 'lower_back'] });
  for (const it of both.exercises) assert(!stresses(it.exercise_id), it.exercise_id);
});

test('swaps keep a primary muscle, so weekly sets are still credited, and say why', () => {
  let swaps = 0;
  for (const joint of ['knee', 'lower_back']) {
    for (const d of DAYS) {
      const off = gen(base, GYM, d);
      const on = gen({ ...base, protectJoints: [joint] }, GYM, d);
      for (const it of on.exercises) {
        if (!it.swap) continue;
        swaps++;
        const from = byId(it.swap.from);
        assert(from.avoid.includes(joint), `${from.id} was a ${joint} move`);
        assert(off.exercises.some((o) => o.exercise_id === from.id), `${from.id} was in the normal plan`);
        assert(it.swap.badge === (joint === 'knee' ? 'Knee-friendly' : 'Back-friendly'), it.swap.badge);
        assert(it.swap.why.startsWith(`Swapped from ${from.name} to go easy on your`), it.swap.why);
      }
    }
  }
  assert(swaps > 0, 'some moves were swapped');
  const legs = gen({ ...base, protectJoints: ['knee'] }, HOME, 'legs');
  assert(legs.exercises.length >= 3, 'legs day still has work at home');
  assert(legs.exercises.some((it) => it.primary.includes('glutes') || it.primary.includes('quads')), 'legs still credited');
  const quads = (p) => p.exercises.some((it) => it.primary.includes('quads'));
  const places = [...LOCATION_PRESETS, { equipment: [], weight_inventory: {} }];
  for (const loc of places) {
    for (const d of DAYS) {
      if (d !== 'boxing' && quads(gen(base, loc, d))) assert(quads(gen({ ...base, protectJoints: ['knee'] }, loc, d)), `${d} keeps quads with Knees on`);
    }
  }
});

test('with Lower back on, no loaded hinge gets a Back-friendly badge', () => {
  for (const loc of [...LOCATION_PRESETS, GYM]) {
    for (const d of DAYS) {
      for (const it of gen({ ...base, protectJoints: ['lower_back'] }, loc, d).exercises) {
        const e = byId(it.exercise_id);
        assert(!(e.pattern === 'hinge' && e.load !== 'bodyweight' && it.swap), `${d}: ${e.id} is a loaded hinge`);
      }
    }
  }
});

test('turning the toggle off restores the original plan for the same inputs', () => {
  for (const d of DAYS) {
    const plain = gen(base, GYM, d);
    const off = gen({ ...base, protectJoints: [] }, GYM, d);
    eq(JSON.stringify(off.exercises), JSON.stringify(plain.exercises), `${d} off`);
    assert(!plain.exercises.some((it) => it.swap), 'no swap labels when off');
    const on = gen({ ...base, protectJoints: ['knee', 'lower_back'] }, GYM, d);
    const back = gen({ ...base, protectJoints: [] }, GYM, d);
    eq(JSON.stringify(back.exercises), JSON.stringify(plain.exercises), `${d} on then off`);
    assert(on.exercises.every((it) => !it.swap || it.swap.from), 'labels have a source');
  }
});

test('the swap picker hides moves tagged for a protected joint', () => {
  const knees = jointAvoidSet({ protectJoints: ['knee'] });
  assert(!jointFriendly(byId('bb_back_squat'), knees));
  assert(jointFriendly(byId('glute_bridge'), knees));
  assert(jointFriendly(byId('bb_deadlift'), knees), 'back moves stay when only knees are on');
  assert(jointFriendly(byId('bb_back_squat'), new Set()), 'nothing hidden when off');
  assert(/jointFriendly\(c, jointAvoidSet\(state\.profile\)\)/.test(src('js/screens/train.js')), 'the Replace picker uses the filter');
});

test('safety line is present, short, and never diagnoses', () => {
  eq(SAFETY_LINE, 'If pain is sharp, swelling, or lasts more than 1–2 weeks, see a doctor.');
  assert(!/arthritis|tendin|sciatica|herniat|tear|sprain|strain|syndrome|injur|diagnos|condition|disc\b/i.test(SAFETY_LINE + protectSummary({ protectJoints: ['knee', 'lower_back'] })));
  assert(protectRowHtml({}).includes(SAFETY_LINE));
  assert(src('js/screens/settings.js').includes('SAFETY_LINE'), 'Settings shows it too');
});

test('Train renders the toggles before Start workout; both are real switches', () => {
  const html = protectRowHtml({ protectJoints: ['knee'] });
  assert(html.includes('role="switch"') && html.includes('aria-checked="true"') && html.includes('aria-checked="false"'));
  assert(html.includes('aria-label="Protect knees"') && html.includes('aria-label="Protect lower back"'));
  eq(protectSummary({}), 'Off');
  eq(protectSummary({ protectJoints: ['lower_back', 'knee'] }), 'Knees, Lower back');
  const train = src('js/screens/train.js');
  const at = train.indexOf('${protectRowHtml()}');
  assert(at > 0 && at < train.indexOf('<button class="btn" data-start>'), 'toggles come right before [data-start]');
  assert(/\.protect-pill \{[^}]*min-height: 44px/.test(src('css/player.css')), '44 pt tap target');
});

test('no rules change: the field lives on the profile doc', () => {
  assert(!/protectJoints/.test(src('firestore.rules')));
  assert(/protectJoints/.test(src('js/ui/protect-joints.js')));
});
