// Demo figures for the cardio machines, the jump rope and the boxing moves (v0.14.4). Same rig as poses-lib.js, but
// these are loops, not reps: every template has one number, `ph` (a cycle angle in degrees), which runs 0 → 360 at a
// steady speed, and a `drive(P)` that turns it into the joint targets (rig.js solve()). Feet and hands are placed from
// the machine's own geometry, so they stay on the belt, pedals, plates, steps and handles in every frame. The machine
// shapes come from `prims(j)` (rig.js cardioProps); figure.js draws them behind or in front of the body.
//
// Cardio machines use a side view; the boxing uses a 3/4 front view so the punches read, and the rope a front view so its arcs read.
import { T } from './poses-lib.js';
import { BODY } from './rig.js';

const R = Math.PI / 180;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const mod = (x, m) => ((x % m) + m) % m;
/** 1 at angle c, 0 further than w degrees away, smooth between. */
const bump = (m, c, w) => { const d = Math.abs(mod(m - c + 180, 360) - 180); return d >= w ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * d) / w); };
const SOLE = 0.068; // ankle → sole (flat foot)
const sgn = (S) => (S === 'N' ? -1 : 1);

const METAL = '#4a5a6a';
const DARK = '#1F3142';
const EDGE = '#7189a0';
const LIGHT = '#9AA1AB';
const PAD = '#2A3F54';
const ACCENT = '#3EC8F0';
const ln = (a, b, w, c) => ({ k: 'line', a, b, w, c });

/** Ankle world point → the pose numbers that put it there (rig.js: ankle height = ankleY + fy). */
const foot = (S, p) => ({ ['fx' + S]: p[0], ['fy' + S]: p[1] - BODY.ankleY });
/** A loop: `ph` runs from ph0 to ph0 + 360 at a steady speed in `secs` seconds. ph0 is the frame shown as the thumbnail. */
const loop = (secs, ph0, o) => T({ ...o, cycle: true, first: 'up', tempo: { con: secs, top: 0, ecc: 0, pause: 0, lin: true }, slow: { con: secs * 1.6, top: 0, ecc: 0, pause: 0, lin: true }, a: { ph: ph0 }, b: { ph: ph0 + 360 } });

// ---------------- treadmill: incline walk, hands on the rails ----------------
export const TM = { th: 10, h0: 0.22, s0: -0.95, s1: 0.95, stride: 0.25, lift: 0.05, hip: 0.91, bob: 0.025, rail: { x0: 0.2, x1: 1.0, y: 1.35, z: 0.27 }, footZ: 0.12 };
const tmU = [Math.cos(TM.th * R), Math.sin(TM.th * R)];
const tmN = [-tmU[1], tmU[0]];
/** A point on the belt (s metres along it, h above it, z across). */
export const tmPoint = (s, h = 0, z = 0) => [tmU[0] * s + tmN[0] * h, TM.h0 + tmU[1] * s + tmN[1] * h, z];
/** Height of the belt surface under world x. */
export const tmSurfaceY = (x) => TM.h0 + Math.tan(TM.th * R) * x;
/** Where a foot is: stance (half the cycle) it rides the belt backward; swing it comes forward, lifted. */
export const tmFoot = (ph, S) => {
  const u = mod(ph + (S === 'F' ? 180 : 0), 360) / 360;
  if (u < 0.5) return { s: TM.stride - (2 * TM.stride * u) / 0.5, h: 0, stance: true };
  const v = (u - 0.5) / 0.5;
  return { s: -TM.stride + 2 * TM.stride * (v - Math.sin(2 * Math.PI * v) / (2 * Math.PI)), h: TM.lift * Math.sin(Math.PI * v), stance: false };
};
export const tmAnkle = (ph, S) => { const f = tmFoot(ph, S); return tmPoint(f.s, SOLE + f.h, sgn(S) * TM.footZ); };
const tmDrive = (P) => {
  const pel = tmPoint(0, TM.hip - TM.bob * Math.cos(2 * P.ph * R));
  return { ph: P.ph, px: pel[0], py: pel[1], trunk: 6, head: -3, fa: 90 + TM.th, ...foot('N', tmAnkle(P.ph, 'N')), ...foot('F', tmAnkle(P.ph, 'F')) };
};
const tmPrims = (j) => {
  const { ph } = j.P;
  const back = [
    { k: 'poly', pts: [tmPoint(TM.s0, 0), tmPoint(TM.s1, 0), tmPoint(TM.s1, -0.12), tmPoint(TM.s0, -0.12)], fill: DARK, stroke: EDGE },
    ln(tmPoint(TM.s0, -0.008), tmPoint(TM.s1, -0.008), 0.016, LIGHT),
    { k: 'circle', c: tmPoint(TM.s0, -0.06), r: 0.06, fill: METAL, stroke: EDGE },
    { k: 'circle', c: tmPoint(TM.s1, -0.06), r: 0.06, fill: METAL, stroke: EDGE },
    ln(tmPoint(-0.55, -0.12), [tmPoint(-0.55, -0.12)[0], 0.03, 0], 0.04, METAL),
    ln(tmPoint(0.6, -0.12), [tmPoint(0.6, -0.12)[0], 0.03, 0], 0.04, METAL),
    ln([tmPoint(0.85, -0.06)[0], tmPoint(0.85, -0.06)[1], 0], [1.02, 1.5, 0], 0.06, METAL),
    ln([0.96, 1.56, 0], [1.1, 1.5, 0], 0.13, DARK),
  ];
  // The belt marks slide backward at the speed of the foot that is on the belt.
  for (let k = 0; k < 6; k++) {
    const s = mod(k * 0.3 - (ph * 2 * TM.stride) / 180 + 0.95, 1.9) - 0.95;
    if (s > TM.s0 + 0.04 && s < TM.s1 - 0.12) back.push(ln(tmPoint(s, -0.003), tmPoint(s + 0.07, -0.003), 0.012, EDGE));
  }
  for (const z of [-TM.rail.z, TM.rail.z]) back.push({ k: 'curve', pts: [[TM.rail.x0, TM.rail.y, z], [TM.rail.x1, TM.rail.y, z], [1.02, TM.rail.y + 0.02, 0]], w: 0.035, c: LIGHT });
  return { back, front: [] };
};

// ---------------- upright bike: seat, handlebars, crank ----------------
export const BIKE = { bb: [0, 0.3], crank: 0.17, seat: { x0: -0.42, x1: -0.12, y: 0.88 }, grip: [0.36, 1.08, 0.21], pelvis: [-0.26, 0.97], pedalZ: 0.15, pedalHalf: 0.055 };
/** Pedal axle: the crank angle runs clockwise seen from the right, so the top of the circle moves forward. */
export const bikePedal = (ph, S) => {
  const a = (90 - ph - (S === 'F' ? 180 : 0)) * R;
  return [BIKE.bb[0] + BIKE.crank * Math.cos(a), BIKE.bb[1] + BIKE.crank * Math.sin(a), sgn(S) * BIKE.pedalZ];
};
/** The ball of the foot (62% of the way from the heel to the toe, 0.0845 in front of the ankle) sits on the pedal. */
export const bikeAnkle = (ph, S) => { const p = bikePedal(ph, S); return [p[0] - 0.0845, p[1] + 0.015 + SOLE, p[2]]; };
const bikeDrive = (lean) => (P) => ({ ph: P.ph, px: BIKE.pelvis[0], py: BIKE.pelvis[1], trunk: lean, head: -8, ...foot('N', bikeAnkle(P.ph, 'N')), ...foot('F', bikeAnkle(P.ph, 'F')) });
const bikePrims = (j) => {
  const { ph } = j.P;
  const back = [
    { k: 'circle', c: [0.2, 0.38, 0], r: 0.2, fill: DARK, stroke: EDGE },
    ln([-0.55, 0.04, 0], [0.62, 0.04, 0], 0.05, METAL),
    ln(BIKE.bb.concat(0), [-0.27, 0.83, 0], 0.05, METAL),
    ln(BIKE.bb.concat(0), [0.26, 0.4, 0], 0.05, METAL),
    ln([0.26, 0.4, 0], [0.34, 1.03, 0], 0.055, METAL),
    ln([-0.41, 0.855, 0], [-0.13, 0.855, 0], 0.05, PAD),
    ln([0.34, 1.08, -BIKE.grip[2]], [0.34, 1.08, BIKE.grip[2]], 0.035, METAL),
    ln([0.29, 1.08, -BIKE.grip[2]], [0.42, 1.08, -BIKE.grip[2]], 0.04, DARK),
    ln([0.29, 1.08, BIKE.grip[2]], [0.42, 1.08, BIKE.grip[2]], 0.04, DARK),
  ];
  for (const S of ['F', 'N']) {
    const p = bikePedal(ph, S);
    back.push(ln([BIKE.bb[0], BIKE.bb[1], sgn(S) * 0.11], [p[0], p[1], sgn(S) * 0.11], 0.03, S === 'N' ? LIGHT : EDGE));
    back.push(ln([p[0] - BIKE.pedalHalf, p[1], p[2]], [p[0] + BIKE.pedalHalf, p[1], p[2]], 0.03, DARK));
  }
  back.push({ k: 'circle', c: [BIKE.bb[0], BIKE.bb[1], 0], r: 0.035, fill: METAL, stroke: EDGE });
  return { back, front: [] };
};

// ---------------- rower: rail, sliding seat, handle on a chain to the flywheel ----------------
export const ROW = { ank: [0.7, 0.4], plate: 55, seatY: 0.4, railY: 0.3, hip0: -0.145, hip1: 0.16, pelvisY: 0.49, fw: [1.2, 0.62], fwR: 0.24, chainEnd: [0.97, 0.62], footZ: 0.13, handZ: 0.15 };
const rowU = [Math.cos(ROW.plate * R), Math.sin(ROW.plate * R)];
const rowN = [-rowU[1], rowU[0]];
/** The sole line of the footplate: a point on it, its direction and the way it faces (toward the rower). */
export const rowPlate = () => ({ p0: [ROW.ank[0] - rowN[0] * SOLE, ROW.ank[1] - rowN[1] * SOLE], u: rowU, n: rowN });
/** Seat position (1 = catch, forward; 0 = finish), trunk lean, arm bend (0 straight, 1 pulled in) for a cycle angle: catch at 0°, finish at 130°. */
export const rowStage = (ph) => {
  const m = mod(ph, 360);
  return {
    seat: m < 180 ? 1 - smooth(0, 100, m) : smooth(190, 360, m),
    lean: m < 130 ? lerp(20, -22, smooth(45, 125, m)) : lerp(-22, 20, smooth(170, 255, m)),
    bend: m < 130 ? smooth(75, 128, m) : 1 - smooth(135, 185, m),
  };
};
const rowDrive = (P) => {
  const { seat, lean, bend } = rowStage(P.ph);
  const px = lerp(ROW.hip0, ROW.hip1, seat);
  const shx = px + 0.465 * Math.sin(lean * R);
  const shy = ROW.pelvisY + 0.465 * Math.cos(lean * R);
  const hx = shx + lerp(0.55, 0.1, bend);
  const hy = shy + lerp(-0.12, -0.3, bend);
  return { ph: P.ph, px, py: ROW.pelvisY, trunk: lean, head: -lean * 0.5, hx, hy, ...foot('N', [ROW.ank[0], ROW.ank[1]]), ...foot('F', [ROW.ank[0], ROW.ank[1]]) };
};
const rowPrims = (j) => {
  const { p0 } = rowPlate();
  const sx = j.P.px;
  const back = [
    ln([-1.0, ROW.railY - 0.025, 0], [0.98, ROW.railY - 0.025, 0], 0.05, METAL),
    ln([-0.95, 0.03, 0], [-0.95, ROW.railY - 0.04, 0], 0.045, METAL),
    ln([1.0, 0.03, 0], [1.0, ROW.railY - 0.04, 0], 0.045, METAL),
    { k: 'circle', c: [ROW.fw[0], ROW.fw[1], 0], r: ROW.fwR, fill: DARK, stroke: EDGE },
    { k: 'circle', c: [ROW.fw[0], ROW.fw[1], 0], r: 0.05, fill: METAL, stroke: EDGE },
    ln([sx - 0.13, ROW.seatY - 0.07, 0], [sx + 0.13, ROW.seatY - 0.07, 0], 0.03, METAL),
    ln([sx - 0.15, ROW.seatY - 0.025, 0], [sx + 0.15, ROW.seatY - 0.025, 0], 0.05, PAD),
    ln([p0[0], p0[1], 0], [p0[0], ROW.railY - 0.02, 0], 0.03, METAL),
  ];
  for (const z of [-ROW.footZ, ROW.footZ]) back.push(ln([p0[0] - rowU[0] * 0.12 - rowN[0] * 0.015, p0[1] - rowU[1] * 0.12 - rowN[1] * 0.015, z], [p0[0] + rowU[0] * 0.26 - rowN[0] * 0.015, p0[1] + rowU[1] * 0.26 - rowN[1] * 0.015, z], 0.03, LIGHT));
  const mid = [(j.gripN[0] + j.gripF[0]) / 2, (j.gripN[1] + j.gripF[1]) / 2, 0];
  back.push(ln(mid, [ROW.chainEnd[0], ROW.chainEnd[1], 0], 0.012, LIGHT));
  back.push(ln(j.gripN, j.gripF, 0.035, ACCENT));
  return { back, front: [] };
};

// ---------------- stair climber: two steps, alternately up and down, hands on the rails ----------------
export const STAIR = { x: 0.05, base: 0.3, amp: 0.11, half: 0.16, footZ: 0.12, rail: { x0: 0.3, x1: 0.58, y: 1.12, z: 0.25 } };
/** Top of each step. */
export const stairTop = (ph, S) => STAIR.base + STAIR.amp * Math.sin(ph * R) * (S === 'N' ? 1 : -1);
export const stairAnkle = (ph, S) => [STAIR.x - 0.055, stairTop(ph, S) + SOLE, sgn(S) * STAIR.footZ];
const stairDrive = (P) => ({ ph: P.ph, px: -0.05, py: 1.0, trunk: 10, head: -3, ...foot('N', stairAnkle(P.ph, 'N')), ...foot('F', stairAnkle(P.ph, 'F')) });
const stairPrims = (j) => {
  const { ph } = j.P;
  const back = [ln([-0.3, 0.03, 0], [0.4, 0.03, 0], 0.06, METAL), ln([0.6, 0.03, 0], [0.6, 1.5, 0], 0.06, METAL), ln([0.52, 1.52, 0], [0.7, 1.46, 0], 0.13, DARK)];
  for (const S of ['F', 'N']) {
    const y = stairTop(ph, S);
    const z = sgn(S) * STAIR.footZ;
    back.push(ln([STAIR.x - 0.14, y - 0.07, z], [STAIR.x - 0.14, 0.04, z], 0.03, EDGE));
    back.push(ln([STAIR.x - STAIR.half, y - 0.025, z], [STAIR.x + STAIR.half, y - 0.025, z], 0.05, S === 'N' ? METAL : DARK));
  }
  for (const z of [-STAIR.rail.z, STAIR.rail.z]) back.push({ k: 'curve', pts: [[STAIR.rail.x0, STAIR.rail.y, z], [STAIR.rail.x1, STAIR.rail.y, z], [0.6, STAIR.rail.y + 0.02, 0]], w: 0.035, c: LIGHT });
  return { back, front: [] };
};

// ---------------- elliptical: foot plates on elliptical paths, handles that swing ----------------
export const ELL = { c: [0, 0.3], a: 0.22, b: 0.07, th: 15, piv: [0.42, 0.78], handle: 0.38, swing: 10, handZ: 0.2, footZ: 0.12, plateHalf: 0.13 };
const ellAngle = (ph, S) => (90 - ph - (S === 'F' ? 180 : 0)) * R;
/** Centre of the foot plate (its top surface is 0.015 above this). */
export const ellPlate = (ph, S) => {
  const al = ellAngle(ph, S);
  const lx = ELL.a * Math.cos(al);
  const ly = ELL.b * Math.sin(al);
  const c = Math.cos(ELL.th * R);
  const s = Math.sin(ELL.th * R);
  return [ELL.c[0] + lx * c - ly * s, ELL.c[1] + lx * s + ly * c, sgn(S) * ELL.footZ];
};
export const ellAnkle = (ph, S) => { const p = ellPlate(ph, S); return [p[0] - 0.057, p[1] + 0.015 + SOLE, p[2]]; };
/** The handle swings about its pivot: it goes back as the same-side foot goes forward. */
export const ellHandle = (ph, S) => {
  const beta = -ELL.swing * Math.cos(ellAngle(ph, S)) * R;
  const d = [Math.sin(beta), Math.cos(beta)];
  return { grip: [ELL.piv[0] + ELL.handle * d[0], ELL.piv[1] + ELL.handle * d[1], sgn(S) * ELL.handZ], low: [ELL.piv[0] - 0.16 * d[0], ELL.piv[1] - 0.16 * d[1], sgn(S) * ELL.handZ] };
};
const ellDrive = (P) => {
  const hN = ellHandle(P.ph, 'N').grip;
  const hF = ellHandle(P.ph, 'F').grip;
  return { ph: P.ph, px: 0.03, py: 1.08, trunk: 8, head: -4, hxN: hN[0], hyN: hN[1], hxF: hF[0], hyF: hF[1], ...foot('N', ellAnkle(P.ph, 'N')), ...foot('F', ellAnkle(P.ph, 'F')) };
};
const ellPrims = (j) => {
  const { ph } = j.P;
  const track = [];
  for (let k = 0; k <= 40; k++) {
    const al = (k / 40) * 2 * Math.PI;
    const lx = ELL.a * Math.cos(al);
    const ly = ELL.b * Math.sin(al);
    track.push([ELL.c[0] + lx * Math.cos(ELL.th * R) - ly * Math.sin(ELL.th * R), ELL.c[1] + lx * Math.sin(ELL.th * R) + ly * Math.cos(ELL.th * R) - 0.04, 0]);
  }
  const back = [
    { k: 'circle', c: [-0.42, 0.4, 0], r: 0.17, fill: DARK, stroke: EDGE },
    ln([-0.6, 0.04, 0], [0.62, 0.04, 0], 0.05, METAL),
    { k: 'curve', pts: track, w: 0.012, c: '#3a424c' },
    { k: 'curve', pts: [[0.55, 0.03, 0], [ELL.piv[0], ELL.piv[1], 0], [0.36, 1.35, 0]], w: 0.055, c: METAL },
    { k: 'circle', c: [ELL.piv[0], ELL.piv[1], 0], r: 0.03, fill: LIGHT, stroke: EDGE },
  ];
  for (const S of ['F', 'N']) {
    const p = ellPlate(ph, S);
    const h = ellHandle(ph, S);
    back.push(ln([p[0] - ELL.plateHalf, p[1], p[2]], [p[0] + ELL.plateHalf, p[1], p[2]], 0.03, S === 'N' ? LIGHT : EDGE));
    back.push(ln(h.low, h.grip, 0.035, S === 'N' ? METAL : DARK));
    back.push(ln([h.grip[0] - 0.05 * (h.grip[0] - ELL.piv[0]) / ELL.handle, h.grip[1] - 0.05, h.grip[2]], h.grip, 0.05, S === 'N' ? LIGHT : EDGE));
  }
  return { back, front: [] };
};

// ---------------- jump rope ----------------
export const ROPE = { handZ: 0.3, handX: 0.12, handY: 0.98, floor: 0.03, flat: 0.08, round: 0.5 };
/** Cycle: one hop; the rope turns `k` times and passes under the feet in the air (rope angle 0 = straight down). */
export const ropeAngle = (ph, k) => 360 * k * (mod(ph, 360) / 360) - 180;
const jumpDrive = (k, hop, heel) => (P) => {
  const h = mod(P.ph, 360) / 360;
  const air = hop * (0.5 - 0.5 * Math.cos(2 * Math.PI * h));
  const psi = ropeAngle(P.ph, k) * R;
  const hx = ROPE.handX + 0.04 * Math.sin(psi);
  const hy = ROPE.handY + air - 0.04 * Math.cos(psi);
  return { ph: P.ph, psi, px: 0, py: 0.93, air, heel, trunk: 2, head: 0, hx, hy };
};
/** The rope: a flat-bottomed arc from hand to hand, swung `psi` about the hands, bottom just above the floor. */
export const ropePoints = (j, n = 28) => {
  const a = j.gripN;
  const b = j.gripF;
  const psi = j.P.psi;
  const rho = (a[1] + b[1]) / 2 - ROPE.floor;
  const d = [Math.sin(psi), -Math.cos(psi)];
  const shape = ROPE.round - (ROPE.round - ROPE.flat) * smooth(0.2, 0.8, Math.cos(psi)); // a flat-bottomed U under the feet, a round loop elsewhere
  return Array.from({ length: n + 1 }, (_, i) => {
    const s = i / n;
    const w = i === 0 || i === n ? 0 : Math.pow(Math.sin(Math.PI * s), shape);
    return [lerp(a[0], b[0], s) + d[0] * rho * w, lerp(a[1], b[1], s) + d[1] * rho * w, lerp(a[2], b[2], s)];
  });
};
const ropePrims = (j) => {
  const rope = { k: 'curve', pts: ropePoints(j), w: 0.014, c: ACCENT };
  // A rope swinging in front of the body is drawn over it, one behind the body under it.
  return Math.sin(j.P.psi) > 0 ? { back: [], front: [rope] } : { back: [rope], front: [] };
};

// ---------------- boxing: guard stance, straight punches, footwork, heavy bag ----------------
export const BOX = { px: 0, py: 0.86, trunk: 6, lead: 0.22, rear: -0.22, handZ: 0.12, reach: 0.58, jab: 40, cross: 220, w: 45 };
export const BAG = { x: 0.86, r: 0.18, y0: 0.62, y1: 1.45, top: 2.05, punchY: 1.4, swing: { N: 0.045, F: 0.035 } };
/** How far the bag has swung forward at cycle angle m: it takes the jab (far hand) at 40° and the cross (near hand) at 220°. */
export const bagSwing = (ph) => {
  const m = mod(ph, 360);
  const one = (c, amp) => (m > c && m < c + 120 ? amp * Math.sin((Math.PI * (m - c)) / 120) : 0);
  return one(BOX.jab, BAG.swing.F) + one(BOX.cross, BAG.swing.N);
};
/** The front of the bag where a fist at sideways offset z lands (a round bag: it curves away at the sides). */
export const bagFace = (ph, z) => BAG.x + bagSwing(ph) - Math.sqrt(BAG.r * BAG.r - z * z);
const punchPlan = (m) => ({ F: bump(m, BOX.jab, BOX.w), N: bump(m, BOX.cross, BOX.w) });
const boxerDrive = (bag) => (P) => {
  const m = mod(P.ph, 360);
  const pun = punchPlan(m);
  const px = BOX.px + 0.03 * pun.F + 0.05 * pun.N;
  const trunk = BOX.trunk + 2 * pun.F + 4 * pun.N;
  const py = BOX.py - 0.015 * Math.max(pun.F, pun.N);
  const shx = px + 0.465 * Math.sin(trunk * R);
  const shy = py + 0.465 * Math.cos(trunk * R);
  const out = { ph: P.ph, px, py, trunk, head: -4, heelN: 0.05, fxF: BOX.lead, fxN: BOX.rear };
  for (const S of ['N', 'F']) {
    const gx = shx + (S === 'F' ? 0.28 : 0.22);
    const gy = shy + 0.07;
    const ex = bag ? bagFace(P.ph, BOX.handZ) - 0.045 : shx + BOX.reach;
    out['hx' + S] = lerp(gx, ex, pun[S]);
    out['hy' + S] = lerp(gy, bag ? BAG.punchY : shy + 0.1, pun[S]);
  }
  return out;
};
/** Footwork: the lead foot steps in, then the rear follows; then the rear steps out and the lead follows. */
export const STEP = 0.16;
export const stepPlan = (ph) => {
  const m = mod(ph, 360);
  const lift = (a, b) => (m >= a && m <= b ? 0.05 * Math.sin((Math.PI * (m - a)) / (b - a)) : 0);
  return {
    lead: BOX.lead + STEP * smooth(0, 55, m) - STEP * smooth(235, 290, m),
    rear: BOX.rear + STEP * smooth(55, 110, m) - STEP * smooth(180, 235, m),
    leadLift: lift(0, 55) + lift(235, 290),
    rearLift: lift(55, 110) + lift(180, 235),
  };
};
const footworkDrive = (P) => {
  const st = stepPlan(P.ph);
  const px = (st.lead + st.rear) / 2;
  const shx = px + 0.465 * Math.sin(BOX.trunk * R);
  const shy = 0.85 + 0.465 * Math.cos(BOX.trunk * R);
  return { ph: P.ph, px, py: 0.85, trunk: BOX.trunk, head: -4, heelN: 0.05, fxF: st.lead, fxN: st.rear, fyF: st.leadLift, fyN: st.rearLift, hxN: shx + 0.22, hyN: shy + 0.07, hxF: shx + 0.28, hyF: shy + 0.07 };
};
const bagPrims = (j) => {
  const d = bagSwing(j.P.ph);
  const L = BAG.top - BAG.punchY;
  const th = Math.asin(clamp(d / L, -0.5, 0.5));
  const at = (len) => [BAG.x + len * Math.sin(th), BAG.top - len * Math.cos(th), 0];
  const a = at(BAG.top - BAG.y1);
  const b = at(BAG.top - BAG.y0);
  return {
    back: [
      ln([BAG.x - 0.25, BAG.top, 0], [BAG.x + 0.25, BAG.top, 0], 0.05, METAL),
      ln([BAG.x, BAG.top, 0], at(BAG.top - BAG.y1 - BAG.r), 0.012, LIGHT),
      ln(a, b, BAG.r * 2 + 0.014, '#1f1812'),
      ln(a, b, BAG.r * 2, '#6a5342'),
      ln([a[0] + 0.0, a[1] - 0.12, 0], [b[0], b[1] + 0.12, 0], 0.02, '#7d6450'),
    ],
    front: [],
  };
};

const CYCLE_BASE = { floor: true };
const boxCam = { yaw: 38, pitch: 6 };
// The rope turns in the front-back plane, so it is drawn from almost straight on: an arch over the head, a U under the feet, always hand to hand.
export const ropeCam = { yaw: 88, pitch: 6 };
const sideCam = { yaw: 14, pitch: 6 };
const BOXER = { root: 'pelvis', legs: 'ik', feet: { z: 0.14, kneesOut: 0.3 }, arms: 'ik', hands: { x: 0.3, y: 1.4, z: BOX.handZ }, pole: [0.2, -0.8, 0.8] };

export const CARDIO = {
  treadmill_walk: loop(2.4, 90, {
    ...CYCLE_BASE, cam: sideCam, gear: ['cardio'], drive: tmDrive, prims: tmPrims,
    rig: { root: 'pelvis', legs: 'ik', feet: { z: TM.footZ, kneesOut: 0.1, raw: true }, arms: 'ik', hands: { x: TM.rail.x0 + 0.08, y: TM.rail.y, z: TM.rail.z }, grip: TM.rail.z },
  }),
  bike_upright: loop(1.5, 90, {
    ...CYCLE_BASE, cam: sideCam, gear: ['cardio'], drive: bikeDrive(22), prims: bikePrims,
    rig: { root: 'pelvis', legs: 'ik', feet: { z: BIKE.pedalZ, kneesOut: 0.15 }, arms: 'ik', hands: { x: BIKE.grip[0], y: BIKE.grip[1], z: BIKE.grip[2] } },
  }),
  // The same bike, faster and leaning further over the bars.
  bike_sprint: loop(0.75, 90, {
    ...CYCLE_BASE, cam: sideCam, gear: ['cardio'], drive: bikeDrive(40), prims: bikePrims,
    rig: { root: 'pelvis', legs: 'ik', feet: { z: BIKE.pedalZ, kneesOut: 0.15 }, arms: 'ik', hands: { x: BIKE.grip[0], y: BIKE.grip[1], z: BIKE.grip[2] } },
  }),
  rower: loop(2.8, 130, {
    ...CYCLE_BASE, cam: sideCam, gear: ['cardio'], drive: rowDrive, prims: rowPrims,
    rig: { root: 'pelvis', legs: 'ik', feet: { z: ROW.footZ, kneesOut: 0.3, raw: true, angle: 90 + ROW.plate, pole: 0, poleY: 1 }, arms: 'ik', hands: { x: 0.5, y: 0.8, z: ROW.handZ }, pole: [-0.5, -0.3, 0.8] },
  }),
  stair_climber: loop(1.6, 90, {
    ...CYCLE_BASE, cam: sideCam, gear: ['cardio'], drive: stairDrive, prims: stairPrims,
    rig: { root: 'pelvis', legs: 'ik', feet: { z: STAIR.footZ, kneesOut: 0.15 }, arms: 'ik', hands: { x: STAIR.rail.x0 + 0.08, y: STAIR.rail.y, z: STAIR.rail.z } },
  }),
  elliptical: loop(1.8, 90, {
    ...CYCLE_BASE, cam: sideCam, gear: ['cardio'], drive: ellDrive, prims: ellPrims,
    rig: { root: 'pelvis', legs: 'ik', feet: { z: ELL.footZ, kneesOut: 0.15 }, arms: 'ik', hands: { x: 0.4, y: 1.15, z: ELL.handZ } },
  }),

  jump_rope: loop(0.7, 180, {
    ...CYCLE_BASE, cam: ropeCam, gear: ['cardio'], drive: jumpDrive(1, 0.1, 0.05), prims: ropePrims,
    rig: { root: 'pelvis', legs: 'ik', feet: { x: 0, z: 0.1, kneesOut: 0.15 }, arms: 'ik', hands: { x: ROPE.handX, y: ROPE.handY, z: ROPE.handZ }, pole: [0, -0.7, 0.9] },
  }),
  // Two turns of the rope in one higher hop.
  jump_rope_double_under: loop(0.9, 180, {
    ...CYCLE_BASE, cam: ropeCam, gear: ['cardio'], drive: jumpDrive(2, 0.2, 0.07), prims: ropePrims,
    rig: { root: 'pelvis', legs: 'ik', feet: { x: 0, z: 0.1, kneesOut: 0.15 }, arms: 'ik', hands: { x: ROPE.handX, y: ROPE.handY, z: ROPE.handZ }, pole: [0, -0.7, 0.9] },
  }),

  shadowboxing: loop(2.0, 40, { ...CYCLE_BASE, cam: boxCam, drive: boxerDrive(false), rig: BOXER }),
  shadowboxing_db: loop(2.0, 40, { ...CYCLE_BASE, cam: boxCam, both: true, drive: boxerDrive(false), rig: BOXER }),
  boxing_footwork: loop(2.4, 55, { ...CYCLE_BASE, cam: boxCam, drive: footworkDrive, rig: BOXER }),
  heavy_bag: loop(2.0, 40, { ...CYCLE_BASE, cam: boxCam, gear: ['cardio'], drive: boxerDrive(true), prims: bagPrims, rig: BOXER }),
};

// Exercise id → template name. Left without a figure (see the CHANGELOG): slip_and_roll, muscleup, muscleup_transition, mb_rotational_throw.
export const CARDIO_MAP = {
  treadmill_incline_walk: 'treadmill_walk',
  bike_steady: 'bike_upright',
  bike_intervals: 'bike_sprint',
  rower_intervals: 'rower',
  stair_climber: 'stair_climber',
  elliptical: 'elliptical',
  jump_rope: 'jump_rope',
  jump_rope_double_under: 'jump_rope_double_under',
  shadowboxing: 'shadowboxing',
  db_shadowboxing: 'shadowboxing_db',
  boxing_footwork: 'boxing_footwork',
  heavy_bag_rounds: 'heavy_bag',
};
