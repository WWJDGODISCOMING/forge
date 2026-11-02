// Motion templates for the silhouette demos (drawn by js/ui/figure.js, solved by js/ui/rig.js).
//
// Each template has:
//   cam    3/4 camera: yaw (degrees from side-on toward the front), pitch (looking down), scale (px per
//          metre in a 200×210 box), x (screen x of world x = 0), ground (screen y of the floor).
//   rig    how the skeleton is placed (see solve() in rig.js): root, balance, legs, arms, feet, hands, grip.
//   a, b   start pose and hardest point. Every number blends from a to b.
//   lag    per parameter: > 0 trails the movement, < 0 leads it (fraction of each phase).
//   first  'down' if the rep starts by lowering (squat), 'up' if it starts by lifting (curl, pull-up).
//   tempo  seconds { ecc: lowering, pause: bottom, con: lifting, top: top }; `slow` is used on tempo days.
//   bias   optional depth nudges for the draw order (metres, + = further back); grips: hand → prop it holds.
//   focus  optional joints to frame (the rest may run off the edge of the demo box).
// Parts are depth-sorted every frame (rig.js drawOrder), so limbs crossing the body layer correctly.
//
// The squat, pull-up and curl below are the approved samples; js/ui/poses-lib.js holds the rest of the library
// and js/ui/poses-home.js the home, travel and bodyweight moves (table, towel, doorframe, floor, mobility).
import { LIBRARY, LIBRARY_MAP } from './poses-lib.js';
import { HOME, HOME_MAP } from './poses-home.js';
import { KB, KB_MAP } from './poses-kb.js';
import { GYM, GYM_MAP } from './poses-gym.js';
import { CARDIO, CARDIO_MAP } from './poses-cardio.js';
import { FILL, FILL_MAP } from './poses-fill.js';

export const TEMPLATES = {
  squat_barbell: {
    cam: { yaw: 12, pitch: 7, scale: 100, x: 108, ground: 200 },
    hold: 'back',
    // Bar low on the upper back (below the neck) so the plate clears the head.
    rig: { root: 'pelvis', balance: 'bar', legs: 'ik', feet: { x: 0, z: 0.16, kneesOut: 0.45 }, arms: 'ik-bar', grip: 0.3, barDrop: 0.115, barBack: 0.09 },
    a: { py: 0.935, trunk: 7, head: 0 },
    b: { py: 0.5, trunk: 43, head: -22 },
    lag: { py: 0, trunk: -0.12, head: 0.2 },
    first: 'down',
    tempo: { ecc: 2, pause: 0.4, con: 1.2, top: 0.9 },
    slow: { ecc: 3.5, pause: 1, con: 1.2, top: 0.9 },
    plate: 0.19,
    // The near plate is really in front of the near arm; nudge it back so the grip reads.
    bias: { plateN: 0.42 },
  },
  pullup: {
    cam: { yaw: 26, pitch: 6, scale: 80, x: 108, ground: 206 },
    // Frame the arms, bar and back; the legs run off the bottom of the box.
    focus: ['gripN', 'gripF', 'elbowN', 'elbowF', 'shoulderN', 'shoulderF', 'chest', 'pelvis', 'head'],
    gear: ['pullbar'],
    rig: { root: 'chest', legs: 'fk', arms: 'ik-fixed', hands: { x: 0, y: 2.15 }, grip: 0.33 },
    a: { px: -0.045, py: 1.595, trunk: -3, head: 0, hipN: 8, kneeN: 10, hipF: 3, kneeF: 24, footN: 28, footF: 34 },
    b: { px: -0.12, py: 2.065, trunk: -17, head: -8, hipN: 24, kneeN: 22, hipF: 16, kneeF: 38, footN: 22, footF: 30 },
    lag: { px: 0.05, trunk: 0.1, head: 0.25, hipN: 0.2, kneeN: 0.3, hipF: 0.24, kneeF: 0.34, footN: 0.3, footF: 0.35 },
    first: 'up',
    tempo: { con: 1.1, top: 0.5, ecc: 2, pause: 0.6 },
    slow: { con: 1.1, top: 0.8, ecc: 3.5, pause: 1 },
    grips: { handN: 'pbN', handF: 'pbF' },
  },
  curl_dumbbell: {
    cam: { yaw: 18, pitch: 7, scale: 102, x: 92, ground: 200 },
    rig: { root: 'pelvis', legs: 'ik', feet: { x: 0, z: 0.12, kneesOut: 0.2 }, arms: 'fk' },
    // One dumbbell, near hand; the far arm hangs relaxed (fewer shapes, clearer read).
    a: { px: 0.0, py: 0.93, trunk: 2, head: 0, shN: 3, elN: 6, shF: 2, elF: 10, wrist: 4, abd: 7 },
    b: { px: 0.0, py: 0.93, trunk: 0, head: -2, shN: 12, elN: 136, shF: 2, elF: 10, wrist: -14, abd: 7 },
    lag: { shN: 0.15, wrist: 0.2, trunk: 0.3 },
    first: 'up',
    tempo: { con: 1.1, top: 0.4, ecc: 2.2, pause: 0.5 },
    slow: { con: 1.1, top: 0.6, ecc: 3.5, pause: 1 },
  },
};

Object.assign(TEMPLATES, LIBRARY, HOME, KB, GYM, CARDIO, FILL);

/** Exercise id → template. Anything not listed falls back to photos or the muscle list. */
export const EXERCISE_TEMPLATES = {
  bb_back_squat: 'squat_barbell',
  pullup: 'pullup',
  db_curl: 'curl_dumbbell',
  // Around the house. Props follow the exercise's load, so backpack moves show empty hands. The table,
  // towel, doorframe, floor, band and mobility moves have their own templates in poses-home.js (HOME_MAP).
  backpack_bent_row: 'row_bent', backpack_one_arm_row: 'row_one_arm', backpack_reverse_fly: 'rear_delt_fly',
  backpack_curl: 'curl_dumbbell', backpack_lateral_raise: 'lateral_raise', backpack_shrug: 'shrug',
  backpack_suitcase_carry: 'carry', chair_dip: 'bench_dip', backpack_goblet_squat: 'squat_goblet',
  backpack_rdl: 'rdl', stair_step_up: 'step_up',
  ...LIBRARY_MAP,
  ...HOME_MAP,
  ...KB_MAP,
  ...GYM_MAP,
  ...CARDIO_MAP,
  ...FILL_MAP,
};

export const templateFor = (exerciseId) => TEMPLATES[EXERCISE_TEMPLATES[exerciseId]] || null;

/** Coverage report: which library exercises have a silhouette. */
export function coverage(exercises) {
  const mapped = exercises.filter((e) => EXERCISE_TEMPLATES[e.id]).map((e) => e.id);
  return { mapped, total: exercises.length, percent: Math.round((mapped.length / exercises.length) * 100) };
}
