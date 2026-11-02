// Demo figures for the last 30 exercises that had none (v0.16.93, #258): knee-friendly bodyweight moves, doorframe curls
// and rows, self-resisted arm work, prone shoulder work, plus the Turkish get-up, windmill, medicine-ball throw, the
// muscle-up drills and the slip-and-roll. Same a/m/b/tempo model as poses-lib.js. Moves that look the same as one already
// drawn reuse that template (`from`), changing only the tempo or the numbers that differ, so the library stays small.
import { T, STAND, HOLD } from './poses-lib.js';
import { LIBRARY } from './poses-lib.js';
import { HOME } from './poses-home.js';

/** An existing template with some fields changed. */
const from = (base, o) => ({ ...base, ...o, cam: { ...base.cam, ...(o.cam || {}) } });

const SLOW_CALF = { con: 2, top: 2, ecc: 4, pause: 0.3 };
const QUICK = { con: 0.3, top: 0.05, ecc: 0.3, pause: 0.05 };
const BREATH = { con: 1.2, top: 1, ecc: 1.2, pause: 0.6 };
const FLOOR_ARMS = { sh: 92, el: 0, abd: 14 };

// Lying on the back (trunk points back along the floor); hip 90° = leg flat on the floor, 180° = straight up.
const LYING = { px: 0, py: 0.15, trunk: -90, head: 6 };
const SUPINE = { root: 'pelvis', legs: 'fk', arms: 'fk' };

// Doorframe moves: the body leans back from the frame and pulls in (see doorframe_row in poses-home.js).
const DOOR = { type: 'doorframe', x: 0, w: 0.86 };
const doorRig = (o = {}) => ({ root: 'plank', pivot: { at: [0.39, 0.09], joint: 'ankle', dir: -1 }, feet: { z: 0.12, angle: 90 }, arms: 'ik', hands: { x: 0, y: 1.2 }, grip: 0.4, pole: [0.3, -0.6, 0.6], ...o });
// One hand on the frame: the near arm grips, the far arm hangs free.
const oneHand = { armsF: 'fk', handsN: { x: 0, y: 1.2 }, armsN: 'ik' };

export const FILL = {
  // ---------------- calves and feet ----------------
  bw_slow_calf_raise: from(LIBRARY.calf_raise, { tempo: SLOW_CALF, slow: SLOW_CALF }),
  // Up on the toes and staying there; small steps, the feet alternating.
  bw_toe_walk: T({
    cam: { yaw: 22 },
    rig: STAND({ feet: { x: 0, z: 0.12, kneesOut: 0.2 } }),
    a: { px: 0.04, py: 1.02, trunk: 2, head: 0, heel: 0.1, fxN: 0.08, fxF: -0.08, sh: 10, el: 10, abd: 8 },
    b: { px: 0.04, py: 1.02, trunk: 2, head: 0, heel: 0.1, fxN: -0.08, fxF: 0.08, sh: 10, el: 10, abd: 8 },
    tempo: { con: 0.7, top: 0.1, ecc: 0.7, pause: 0.1 }, slow: { con: 1, top: 0.2, ecc: 1, pause: 0.2 },
  }),
  // Short quick hops from the ankles: knees almost straight, heels barely touching.
  bw_pogo_hops: T({
    cam: { yaw: 22 },
    rig: STAND({ feet: { x: 0, z: 0.12, kneesOut: 0.15 } }),
    a: { px: 0.02, py: 0.93, trunk: 2, head: 0, heel: 0, air: 0, sh: 20, el: 40, abd: 10 },
    b: { px: 0.03, py: 1.0, trunk: 2, head: 0, heel: 0.1, air: 0.1, sh: 20, el: 40, abd: 10 },
    tempo: QUICK, slow: { con: 0.5, top: 0.1, ecc: 0.5, pause: 0.1 },
  }),

  // ---------------- legs, gently ----------------
  // Lying down, one leg straight with the knee relaxed, the other bent with the foot flat; the thigh muscle tightens.
  bw_quad_set: T({
    cam: { yaw: 24, pitch: 12 },
    rig: SUPINE,
    a: { ...LYING, hipN: 90, kneeN: 0, footN: -4, hipF: 135, kneeF: 90, footF: 0, ...FLOOR_ARMS },
    b: { ...LYING, hipN: 90, kneeN: 0, footN: -26, hipF: 135, kneeF: 90, footF: 0, ...FLOOR_ARMS },
    tempo: HOLD, slow: HOLD,
  }),
  // The straight leg lifts only as high as the bent knee, then lowers slowly.
  bw_straight_leg_raise: T({
    cam: { yaw: 24, pitch: 12 },
    rig: SUPINE,
    a: { ...LYING, hipN: 90, kneeN: 0, footN: -10, hipF: 135, kneeF: 90, footF: 0, ...FLOOR_ARMS },
    b: { ...LYING, hipN: 135, kneeN: 0, footN: -10, hipF: 135, kneeF: 90, footF: 0, ...FLOOR_ARMS },
    tempo: { ecc: 2.4, pause: 0.4, con: 1.4, top: 0.8 },
  }),
  // A wall sit that stays high: the knees open to about 135°, well above a right angle, the shins upright.
  bw_shallow_wall_sit: from(LIBRARY.wall_sit, {
    rig: STAND({ feet: { x: 0.12, z: 0.15, kneesOut: 0.3 } }),
    a: { px: -0.33, py: 0.72, trunk: -2, head: 0, sh: 4, el: 8, abd: 10 },
    b: { px: -0.33, py: 0.715, trunk: -2, head: 0, sh: 4, el: 10, abd: 10 },
  }),
  // Sit back onto a firm, high seat, lean forward a little, stand by pushing through the whole foot. Hands out for balance.
  bw_high_box_sit_to_stand: T({
    cam: { yaw: 22 },
    env: [{ type: 'box', x0: -0.62, x1: -0.2, h: 0.62, w: 0.45 }],
    rig: STAND({ feet: { x: 0.04, z: 0.15, kneesOut: 0.3 } }),
    a: { px: 0.03, py: 0.93, trunk: 3, head: 0, sh: 60, el: 20, abd: 10 },
    b: { px: -0.1, py: 0.73, trunk: 24, head: -12, sh: 70, el: 10, abd: 10 },
    lag: { trunk: -0.1, head: 0.2 },
    first: 'down',
    tempo: { ecc: 2.2, pause: 0.5, con: 1.3, top: 0.7 },
  }),

  // ---------------- hinge and hamstrings ----------------
  // Hands behind the head, soft knees: the hips push straight back and the back stays flat.
  bw_good_morning: T({
    cam: { yaw: 14 },
    rig: STAND({ feet: { x: 0, z: 0.14, kneesOut: 0.2 } }),
    a: { px: 0.02, py: 0.93, trunk: 4, head: 0, sh: 150, el: 140, abd: 40 },
    b: { px: -0.2, py: 0.85, trunk: 68, head: -34, sh: 150, el: 140, abd: 40 },
    lag: { head: 0.2 },
    first: 'down',
  }),
  // Hips stay up while the heels walk out and back in.
  bw_bridge_walkout: from(HOME.bw_slider_leg_curl, {
    a: { ...HOME.bw_slider_leg_curl.a, fxN: 0.75, fxF: 0.75 },
    b: { ...HOME.bw_slider_leg_curl.b, fxN: 0.35, fxF: 0.35 },
    tempo: { ecc: 1.8, pause: 0.4, con: 1.8, top: 0.4 },
  }),

  // ---------------- biceps ----------------
  // The free hand presses down on the working fist; the elbow stays by the ribs.
  bw_self_resisted_curl: T({
    cam: { yaw: 22 },
    rig: { ...STAND({ feet: { x: 0, z: 0.12, kneesOut: 0.2 } }), armsF: 'fk' },
    a: { px: 0, py: 0.93, trunk: 2, head: 0, shN: 3, elN: 10, wrist: 4, abd: 7, shF: 20, elF: 90, abdF: 0 },
    b: { px: 0, py: 0.93, trunk: 0, head: -2, shN: 12, elN: 130, wrist: -14, abd: 7, shF: 60, elF: 100, abdF: 0 },
    lag: { shN: 0.15, wrist: 0.2 },
    tempo: { con: 1.8, top: 0.5, ecc: 2.6, pause: 0.5 },
  }),
  // Both hands clasped at the chest, one arm curling up while the other presses down; held and breathing.
  bw_iso_curl_hold: T({
    cam: { yaw: 26 },
    rig: { ...STAND({ feet: { x: 0, z: 0.12, kneesOut: 0.2 } }), arms: 'ik', hands: { x: 0.26, y: 1.08 }, grip: 0.04, pole: [-0.3, -0.7, 0.4] },
    a: { px: 0, py: 0.93, trunk: 0, head: 0, hx: 0.26, hy: 1.06 },
    b: { px: 0, py: 0.93, trunk: 0, head: 0, hx: 0.28, hy: 1.12 },
    tempo: HOLD, slow: HOLD,
  }),
  // Hands on the frame, the body leans back with straight arms, then the elbows bend and the body comes in.
  bw_doorframe_curl: from(HOME.doorframe_row, {
    env: [DOOR],
    rig: doorRig(),
    a: { line: 56, head: 0 },
    b: { line: 70, head: 0 },
  }),
  bw_doorframe_hammer_curl: from(HOME.doorframe_row, {
    env: [DOOR],
    rig: doorRig(oneHand),
    a: { line: 56, head: 0, shF: 0, elF: 0, abdF: 6 },
    b: { line: 70, head: 0, shF: 0, elF: 0, abdF: 6 },
  }),
  bw_doorframe_wide_row: from(HOME.doorframe_row, {
    a: { line: 48, head: 0 },
    b: { line: 70, head: 0 },
  }),
  bw_doorframe_single_arm_row: from(HOME.doorframe_row, {
    rig: doorRig(oneHand),
    a: { line: 52, head: 0, shF: 0, elF: 0, abdF: 6 },
    b: { line: 68, head: 0, shF: 0, elF: 0, abdF: 6 },
  }),

  // ---------------- shoulders ----------------
  // Elbow bent, the back of the hand pressed to the wall at the side: held, tiny movement.
  bw_iso_lateral_raise_wall: T({
    cam: { yaw: 64, pitch: 8 },
    rig: STAND({ feet: { x: 0, z: 0.12, kneesOut: 0.2 } }),
    a: { px: 0, py: 0.93, trunk: 0, head: 0, sh: 0, el: 90, abd: 44, foreAbd: 1 },
    b: { px: 0, py: 0.93, trunk: 0, head: 0, sh: 0, el: 90, abd: 52, foreAbd: 1 },
    tempo: HOLD, slow: HOLD,
  }),
  // Working arm lifts out to the side to shoulder height while the free hand rests on its wrist and pushes back.
  bw_self_resisted_lateral_raise: T({
    cam: { yaw: 44 },
    rig: STAND({ feet: { x: 0, z: 0.13, kneesOut: 0.2 } }),
    a: { px: 0.01, py: 0.93, trunk: 3, head: 0, sh: 4, el: 14, abd: 6, shF: 20, elF: 70, abdF: 6 },
    b: { px: 0.01, py: 0.93, trunk: 3, head: 0, sh: 6, el: 14, abd: 84, shF: 40, elF: 70, abdF: 60 },
    tempo: { con: 1.8, top: 0.4, ecc: 2.6, pause: 0.4 },
  }),
  // Arms straight out at shoulder height, drawing circles.
  bw_arm_circles: T({
    cam: { yaw: 40, pitch: 8 },
    rig: STAND({ feet: { x: 0, z: 0.13, kneesOut: 0.2 } }),
    a: { px: 0, py: 0.93, trunk: 0, head: 0, sh: 30, el: 0, abd: 84 },
    m: { sh: -10, abd: 100 },
    b: { px: 0, py: 0.93, trunk: 0, head: 0, sh: -30, el: 0, abd: 70 },
    tempo: { con: 0.7, top: 0.05, ecc: 0.7, pause: 0.05 }, slow: { con: 1, top: 0.1, ecc: 1, pause: 0.1 },
  }),

  // ---------------- prone ----------------
  // Face down, arms sweeping from long overhead down toward the ribs (like a pull-up).
  bw_prone_lat_pulldown: from(HOME.bw_prone_ytw, {
    a: { line: 0, pike: 8, head: -12, hipN: -90, kneeN: 0, footN: -90, hipF: -90, kneeF: 0, footF: -90, sh: 100, el: 0, abd: 22, foreAbd: 1 },
    m: undefined,
    b: { line: 0, pike: 8, head: -12, hipN: -90, kneeN: 0, footN: -90, hipF: -90, kneeF: 0, footF: -90, sh: 240, el: -140, abd: 45, foreAbd: 1 },
  }),
  // Face down, arms straight out to the sides, lifting by squeezing the shoulder blades together.
  bw_prone_t_raise: from(HOME.bw_prone_ytw, {
    a: { line: 0, pike: 0, head: -4, hipN: -90, kneeN: 0, footN: -90, hipF: -90, kneeF: 0, footF: -90, sh: 100, el: 0, abd: 90, foreAbd: 1 },
    m: undefined,
    b: { line: 0, pike: 10, head: -14, hipN: -90, kneeN: 0, footN: -90, hipF: -90, kneeF: 0, footF: -90, sh: 100, el: 0, abd: 90, foreAbd: 1 },
    tempo: BREATH, slow: BREATH,
  }),
  // Opposite arm and leg lift and swap in small, steady kicks.
  bw_swimmer: from(HOME.bw_superman, {
    a: { line: 0, pike: 10, head: -12, hipN: -100, kneeN: 0, footN: -90, hipF: -90, kneeF: 0, footF: -90, shN: 112, elN: 0, shF: 92, elF: 0, abd: 6, foreAbd: 1 },
    m: undefined,
    b: { line: 0, pike: 10, head: -12, hipN: -90, kneeN: 0, footN: -90, hipF: -100, kneeF: 0, footF: -90, shN: 92, elN: 0, shF: 112, elF: 0, abd: 6, foreAbd: 1 },
    tempo: { con: 0.5, top: 0.05, ecc: 0.5, pause: 0.05 }, slow: { con: 0.8, top: 0.1, ecc: 0.8, pause: 0.1 },
  }),
};

// Exercise id → template name, for the moves that borrow another move's figure unchanged.
export const FILL_MAP = {
  bw_calf_raise: 'calf_raise',
};
for (const id of Object.keys(FILL)) FILL_MAP[id] = id;
