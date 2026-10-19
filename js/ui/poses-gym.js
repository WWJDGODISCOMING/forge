// Demo figures for the gym and YMCA machine moves (v0.14.2): the leg press family, the hip abductor / adductor
// machine and the cable hip moves. Same a/m/b/tempo model as poses-lib.js; the props (sled, knee pads, ankle cuff
// with its cable to the low pulley) are drawn by js/ui/figure.js from the helpers in js/ui/rig.js.
//
// Leg presses use a side view and the 45° sled: the rails rise away from the seat, the plate stands square to
// them (param `sl` = where the plate sits along the rail) and the seat back is parallel to the plate. The feet
// are placed from the plate position, so they stay on it in every frame. The hip machines and the cable hip
// moves use a front view, so the legs swinging out to the side are what you see.
import { T } from './poses-lib.js';
import { solve } from './rig.js';

const PAD = ['#2A3F54', '#172430', '#1F3142'];
const FRAME = ['#2a3a4a', '#18232e', '#223140'];

// ---------------- leg press: 45° sled ----------------
export const SLED_DIR = 45;
const D = [Math.SQRT1_2, Math.SQRT1_2]; // along the rails
const P = [-Math.SQRT1_2, Math.SQRT1_2]; // along the plate, toward the head
const HIP = [-0.3, 0.26]; // pelvis, sitting on the seat
const SLED = { dir: SLED_DIR, q: 0.46, half: 0.3, w: 0.28 };
/** Ankle `reach` metres from the hip along the rails (and 0.04 up the plate) → the numbers that put the sole flat on the plate. */
const onSled = (reach, up = 0.04) => {
  const dd = HIP[0] * D[0] + HIP[1] * D[1] + reach; // along the rails
  const pp = HIP[0] * P[0] + HIP[1] * P[1] + up; // up the plate
  return {
    fx: +(D[0] * dd + P[0] * pp).toFixed(4),
    fy: +(D[1] * dd + P[1] * pp - 0.08).toFixed(4), // ankle height above its floor height (0.08)
    sl: +(dd + 0.068).toFixed(4), // the sole sits 0.068 beyond the ankle
  };
};
const EXTENDED = onSled(0.82);
const DEEP = onSled(0.56);
const SEAT_AND_BACK = [
  { type: 'slab', a: [-0.5, 0.05], b: [-0.12, 0.05], w: 0.3, t: 0.05, col: FRAME },
  { type: 'slab', a: [-0.52, 0.12], b: [-0.1, 0.12], w: 0.42, t: 0.07, col: PAD },
  // The back pad lies along the spine, 0.13 behind it.
  { type: 'slab', a: [-1.03, 0.8], b: [-0.36, 0.13], w: 0.4, t: 0.07, col: PAD },
];
const RAILS = [
  { type: 'slab', a: [0.219, 0.417], b: [0.679, 0.877], w: 0.5, t: 0.05, col: FRAME },
  { type: 'slab', a: [0.2, 0.41], b: [0.26, 0.41], w: 0.42, t: 0.41, col: FRAME },
  { type: 'slab', a: [0.58, 0.81], b: [0.64, 0.81], w: 0.42, t: 0.81, col: FRAME },
];
const PRESS_BODY = { px: HIP[0], py: HIP[1], trunk: -45, head: 8, sh: 22, el: 26, abd: 16 };
const PRESS_TEMPO = { ecc: 2.2, pause: 0.4, con: 1.4, top: 0.5 };
const PRESS_FEET = { x: 0, z: 0.14, kneesOut: 0.08, angle: 225, raw: true, pole: -1, poleY: 1 };
const PRESS_BASE = { cam: { yaw: 14, pitch: 6 }, floor: true, gear: ['sled'], env: [...SEAT_AND_BACK, ...RAILS], first: 'down', tempo: PRESS_TEMPO, bias: { sled: 0.6 } };

/** Plate position that the front of the near foot just touches: the ball (62% of the way from heel to toe) or the toe tip, whichever is further along the rails. */
const ballSl = (tpl, pose) => {
  const j = solve(tpl, pose);
  const ball = [0, 1, 2].map((i) => j.heelN[i] + (j.toeN[i] - j.heelN[i]) * 0.62);
  return +Math.max(ball[0] * D[0] + ball[1] * D[1], j.toeN[0] * D[0] + j.toeN[1] * D[1]).toFixed(4);
};

const calfPress = () => {
  const legs = (foot) => ({ hipN: 135, kneeN: 6, footN: foot, hipF: 135, kneeF: 6, footF: foot });
  const tpl = T({
    ...PRESS_BASE,
    sled: SLED,
    rig: { root: 'pelvis', legs: 'fk', arms: 'fk' },
    a: { ...PRESS_BODY, ...legs(8), sl: 0 },
    b: { ...PRESS_BODY, ...legs(-26), sl: 0 },
    first: 'up',
    tempo: { con: 1.1, top: 0.6, ecc: 1.8, pause: 0.5 },
  });
  tpl.a.sl = ballSl(tpl, tpl.a);
  tpl.b.sl = ballSl(tpl, tpl.b);
  return tpl;
};

// ---------------- hip adductor machine: seated, front view ----------------
const MACHINE_SEAT = [
  { type: 'slab', a: [-0.28, 0.39], b: [0.2, 0.39], w: 0.22, t: 0.39, col: FRAME },
  { type: 'slab', a: [-0.3, 0.46], b: [0.26, 0.46], w: 0.4, t: 0.07, col: PAD },
  // Back pad: 0.13 behind the spine, which leans back 8°.
  { type: 'slab', a: [-0.295, 1.136], b: [-0.202, 0.47], w: 0.4, t: 0.07, col: PAD },
];
const SEATED = { px: -0.08, py: 0.54, trunk: -8, head: 0, sh: 10, el: 30, abd: 14 };
/** Thighs level, shins down; `s` swings the thighs out sideways (degrees), the shins follow about a third as far. */
const knees = (s) => ({ hipN: 85, kneeN: 85, hipF: 85, kneeF: 85, footN: 0, footF: 0, splayN: s, splayF: s, shinSplayN: +(s * 0.35).toFixed(1), shinSplayF: +(s * 0.35).toFixed(1) });
const MACHINE_BASE = {
  cam: { yaw: 80, pitch: 12 },
  floor: true,
  gear: ['kneepads'],
  env: MACHINE_SEAT,
  rig: { root: 'pelvis', legs: 'fk', arms: 'fk' },
  tempo: { con: 1.2, top: 0.6, ecc: 1.8, pause: 0.4 },
  slow: { con: 1.8, top: 0.8, ecc: 3, pause: 0.5 },
};

// ---------------- cable hip moves: standing, front view, cuff on the working ankle ----------------
const TOWER = (z) => ({ type: 'slab', a: [-0.1, 1.2], b: [0.1, 1.2], w: 0.3, t: 1.2, z, col: FRAME });
const CABLE_BASE = {
  cam: { yaw: 80, pitch: 8 },
  rig: { root: 'pelvis', legs: 'ik', legsN: 'fk', feet: { x: 0, z: 0.12, kneesOut: 0.2 }, arms: 'fk' },
  tempo: { con: 1, top: 0.4, ecc: 1.6, pause: 0.3 },
  slow: { con: 1.4, top: 0.6, ecc: 2.4, pause: 0.4 },
};
const STANDING = { px: 0, py: 0.95, trunk: 0, head: 0, hipN: 0, kneeN: 0, footN: 0, sh: 10, el: 10, abd: 38 };

export const GYM = {
  // Both feet on the plate; lower until the knees come toward the chest, then press back to almost straight.
  leg_press: T({
    ...PRESS_BASE,
    sled: SLED,
    rig: { root: 'pelvis', legs: 'ik', feet: PRESS_FEET, arms: 'fk' },
    a: { ...PRESS_BODY, fxN: EXTENDED.fx, fyN: EXTENDED.fy, fxF: EXTENDED.fx, fyF: EXTENDED.fy, sl: EXTENDED.sl },
    b: { ...PRESS_BODY, fxN: DEEP.fx, fyN: DEEP.fy, fxF: DEEP.fx, fyF: DEEP.fy, sl: DEEP.sl },
  }),
  // The near foot presses; the other foot rests on the floor under the knee.
  leg_press_single: T({
    ...PRESS_BASE,
    sled: SLED,
    rig: { root: 'pelvis', legs: 'ik', feet: PRESS_FEET, feetF: { x: 0, y: 0, z: 0.14, angle: 90, raw: false, pole: 0.5, poleY: 0.85 }, arms: 'fk' },
    a: { ...PRESS_BODY, fxN: EXTENDED.fx, fyN: EXTENDED.fy, fxF: 0, fyF: 0, sl: EXTENDED.sl },
    b: { ...PRESS_BODY, fxN: DEEP.fx, fyN: DEEP.fy, fxF: 0, fyF: 0, sl: DEEP.sl },
  }),
  // Legs almost straight; the balls of the feet push the plate away and let it back.
  leg_press_calf: calfPress(),

  // Pads on the inside of the knees; squeeze them together.
  hip_adductor_machine: T({
    ...MACHINE_BASE,
    pads: { out: false, off: 0.1, h: 0.18 },
    a: { ...SEATED, ...knees(34) },
    b: { ...SEATED, ...knees(10) },
  }),

  // Cuff on the near ankle, cable to the low pulley on the far side; the near leg lifts out to the side.
  cable_hip_abduction: T({
    ...CABLE_BASE,
    gear: ['cuff'],
    cuff: { leg: 'N', pulley: [0.05, 0.17, 0.47] },
    env: [TOWER(0.62)],
    bias: { cuffcable: -0.3 },
    a: { ...STANDING, splayN: 4, shinSplayN: 4 },
    b: { ...STANDING, splayN: 36, shinSplayN: 36 },
  }),
  // Cuff on the near ankle, cable to the low pulley on its own side; the leg sweeps in across the other leg.
  cable_hip_adduction: T({
    ...CABLE_BASE,
    gear: ['cuff'],
    cuff: { leg: 'N', pulley: [0.05, 0.17, -0.8] },
    env: [TOWER(-0.95)],
    bias: { thighN: -0.3, shinN: -0.3, footN: -0.3, cuffcable: -0.3 },
    a: { ...STANDING, hipN: 20, kneeN: 0, footN: 14, splayN: 22, shinSplayN: 22 },
    b: { ...STANDING, hipN: 20, kneeN: 0, footN: 14, splayN: -12, shinSplayN: -12 },
  }),
};

// Exercise id → template name. Moves left out are listed in the CHANGELOG (machine_hip_abductor: no figure for now).
export const GYM_MAP = {
  machine_leg_press: 'leg_press',
  machine_single_leg_press: 'leg_press_single',
  machine_leg_press_calf: 'leg_press_calf',
  machine_hip_adductor: 'hip_adductor_machine',
  cable_hip_abduction: 'cable_hip_abduction',
  cable_hip_adduction: 'cable_hip_adduction',
};
