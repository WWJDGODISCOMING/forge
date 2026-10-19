// Animated silhouette demo, drawn in code (SVG): a jointed figure in a 3/4 view with tapered limbs,
// rib cage, pelvis, neck, hands and feet, a ground shadow, a rim light on the back edges, and the working
// muscles glowing (muscle-shaped, opacity only) at the hardest point of each rep.
//
// Every node is built once. Each frame only updates `transform` matrices (one <g> per body segment and
// prop) and, when it changes, the depth order of those groups; at most 30 times a second, and the loop
// sleeps while the workout is paused or resting. The view box is fitted to the whole rep at mount.
// Pure code and data: offline, no downloads. Templates: js/ui/poses.js. Skeleton and camera: js/ui/rig.js.
import { TEMPLATES, EXERCISE_TEMPLATES } from './poses.js';
import { BODY, BODY_PARTS, cardioProps, sledPlate, kneePad, ankleCuff, solve, camera, boneMatrix, repPhases, progressAt, paramsAt, propParts, loopEnds, bellDir, BELL_OFFSET, drawOrder, frameBox } from './rig.js';
const add3 = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
import { onFrame, reducedMotion } from './motion.js';

export const hasFigure = (exerciseId) => !!EXERCISE_TEMPLATES[exerciseId];

// ---------- muscles ----------
// Where each muscle glows: the segment it lives on and its shape in that segment's local frame
// (u = fraction along the bone, v = fraction of the half-width with + at the front, length, width).
const M = {
  quads: [['thigh', 0.52, 0.42, 0.66, 0.62]],
  hamstrings: [['thigh', 0.5, -0.45, 0.6, 0.55]],
  adductors: [['thigh', 0.32, 0.05, 0.4, 0.42]],
  glutes: [['pelvis']],
  calves: [['shin', 0.32, -0.42, 0.42, 0.62]],
  biceps: [['upper', 0.56, 0.45, 0.6, 0.62]],
  triceps: [['upper', 0.52, -0.45, 0.66, 0.6]],
  forearms: [['fore', 0.3, 0.2, 0.48, 0.75]],
  front_delts: [['upper', 0.12, 0.45, 0.26, 0.62]],
  side_delts: [['upper', 0.1, 0, 0.26, 0.66]],
  rear_delts: [['upper', 0.12, -0.45, 0.26, 0.62]],
  chest: [['torso', 'chest']],
  lats: [['torso', 'lats']],
  upper_back: [['torso', 'upper_back']],
  traps: [['torso', 'traps']],
  lower_back: [['torso', 'lower_back']],
  abs: [['torso', 'abs']],
  obliques: [['torso', 'obliques']],
};
/** Muscle → glow strength (primary 1, secondary 0.45), from the exercise's own muscle data. */
export function muscleGlow(ex) {
  const out = {};
  for (const m of ex.secondary || []) if (M[m]) out[m] = 0.45;
  for (const m of ex.primary || []) if (M[m]) out[m] = 1;
  return out;
}

// ---------- shapes ----------
const f1 = (x) => (Math.round(x * 10) / 10).toString();
/** Smooth path through points (Catmull-Rom → cubic Bézier). */
function smooth(pts, closed = true) {
  const n = pts.length;
  const P = (i) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  let d = `M${f1(pts[0][0])},${f1(pts[0][1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f1(c1[0])},${f1(c1[1])} ${f1(c2[0])},${f1(c2[1])} ${f1(p2[0])},${f1(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}

/**
 * A tapered limb along +x from 0 to L px: radius r0 → r1 with a front and a back muscle bulge
 * ([where, how much px]) and rounded ends. Returns { body, rim } (rim = the back edge only).
 */
function limb(L, r0, r1, front = [0.4, 0], back = [0.4, 0]) {
  const r = (u) => r0 + (r1 - r0) * u;
  const edge = (side, [at, amt]) => [0.04, 0.2, at, 0.62 + at * 0.3, 0.96].map((u) => {
    const bump = amt * Math.exp(-Math.pow((u - at) / 0.26, 2));
    return [u * L, side * (r(u) + bump)];
  });
  const backPts = edge(-1, back);
  const frontPts = edge(1, front).reverse();
  const cap = (cx, rr, from) => [1, 2, 3, 4, 5].map((k) => {
    const a = from + (Math.PI * k) / 6;
    return [cx + Math.cos(a) * rr, Math.sin(a) * rr];
  });
  const pts = [...backPts, ...cap(L, r1 * 0.98, -Math.PI / 2), ...frontPts, ...cap(0, r0 * 0.98, Math.PI / 2)];
  return { body: smooth(pts), rim: smooth(backPts.slice(1, -1), false) };
}

/** Almond-shaped muscle belly centred at (cx, cy), length l, half-width w (px). */
function belly(cx, cy, l, w) {
  const x0 = cx - l / 2;
  const x1 = cx + l / 2;
  return `M${f1(x0)},${f1(cy)}C${f1(x0 + l * 0.28)},${f1(cy - w)} ${f1(x1 - l * 0.3)},${f1(cy - w * 0.9)} ${f1(x1)},${f1(cy)}C${f1(x1 - l * 0.3)},${f1(cy + w * 0.9)} ${f1(x0 + l * 0.28)},${f1(cy + w)} ${f1(x0)},${f1(cy)}Z`;
}

// Limbs in metres: length, start and end radius, front and back bulge [where, how much].
const LIMB = {
  thigh: { L: BODY.thigh, r0: 0.082, r1: 0.054, front: [0.42, 0.016], back: [0.36, 0.014] },
  shin: { L: BODY.shin, r0: 0.054, r1: 0.036, front: [0.3, 0.004], back: [0.28, 0.02] },
  upper: { L: BODY.upper, r0: 0.05, r1: 0.039, front: [0.55, 0.01], back: [0.45, 0.008] },
  fore: { L: BODY.fore, r0: 0.04, r1: 0.027, front: [0.25, 0.008], back: [0.25, 0.004] },
  hand: { L: BODY.hand, r0: 0.027, r1: 0.026, front: [0.5, 0.004], back: [0.5, 0.002] },
  neck: { L: BODY.neck + 0.02, r0: 0.056, r1: 0.05, front: [0.5, 0], back: [0.4, 0.006] },
};

// Torso (rib cage + abdomen) in metres along the spine from the hip centre: [u, v], + = front.
const TORSO = [
  [-0.02, 0.1], [0.12, 0.115], [0.28, 0.14], [0.41, 0.145], [0.5, 0.1], [0.565, 0.05],
  [0.58, -0.035], [0.52, -0.085], [0.44, -0.13], [0.3, -0.125], [0.16, -0.095], [0.02, -0.11],
];
const PELVIS = [[0.11, 0.1], [0.02, 0.112], [-0.07, 0.075], [-0.115, 0.0], [-0.1, -0.1], [-0.02, -0.14], [0.08, -0.115]];
const TORSO_GLOW = { // [u, v, length, half-width] in metres
  chest: [0.43, 0.095, 0.17, 0.05],
  abs: [0.17, 0.085, 0.22, 0.035],
  obliques: [0.16, 0.0, 0.2, 0.045],
  lats: [0.3, -0.075, 0.24, 0.045],
  upper_back: [0.44, -0.085, 0.13, 0.04],
  traps: [0.52, -0.05, 0.12, 0.03],
  lower_back: [0.12, -0.07, 0.16, 0.03],
};
const HEAD = [
  [0.0, 0.03], [0.035, 0.072], [0.07, 0.092], [0.105, 0.112], [0.15, 0.1], [0.205, 0.06], [0.235, -0.005],
  [0.215, -0.07], [0.16, -0.105], [0.09, -0.098], [0.035, -0.055], [0.0, -0.035],
];
const FOOT = [[0.0, 0.015], [0.015, 0.06], [0.06, 0.095], [0.12, 0.06], [0.205, 0.028], [0.225, 0.005], [0.15, -0.006], [0.03, -0.006]];

// ---------- colours ----------
// Lighter greys than the app background (#040B0E / #172430) so the body reads clearly; far limbs darker.
const C = {
  nearBack: '#2f4152', nearFront: '#8493a6',
  farBack: '#1c2a38', farFront: '#46576a',
  torsoBack: '#33465a', torsoFront: '#8d9db0',
  outline: '#040B0E',
  rim: '#8FE6FF',
  steel: '#b9c1cb', steelDark: '#6b7480', plate: '#1F3142', plateEdge: '#54687c',
};

const NS = 'http://www.w3.org/2000/svg';
let uid = 0;
function el(tag, attrs, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}
const mtx = (m) => `matrix(${m.map((x) => (Math.round(x * 1000) / 1000).toString()).join(',')})`;

/**
 * Mount an animated figure for an exercise into `container`. Returns { stop } or null if the exercise
 * has no template. Options: isPaused() → true holds the frame and lets the loop sleep; slow → tempo days;
 * at → draw one still frame that many seconds into the rep ('hard': the hardest point, for thumbnails).
 * Stops by itself when the container leaves the page.
 */
export function mountFigure(container, ex, { isPaused = () => false, slow = false, at: still = null } = {}) {
  const base = TEMPLATES[EXERCISE_TEMPLATES[ex.id]];
  if (!base) return null;
  // The exercise decides what is held (barbell, dumbbell, kettlebell, cable, band…) unless the template says.
  const tpl = { ...base, load: base.load || ex.load };
  const s = tpl.cam.scale;
  const project = camera(tpl.cam);
  const phases = repPhases(slow && tpl.slow ? tpl.slow : tpl.tempo, tpl.first);
  const glow = muscleGlow(ex);
  const id = `fig${++uid}`;
  const box = frameBox(tpl, project, phases);

  const svg = el('svg', { viewBox: box.map(f1).join(' '), class: 'figure', role: 'img', 'aria-label': `${ex.name} demo` });
  const defs = el('defs', {}, svg);
  const lin = (name, a, b) => {
    const g = el('linearGradient', { id: `${id}${name}`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: 0, 'stop-color': a }, g);
    el('stop', { offset: 1, 'stop-color': b }, g);
  };
  lin('n', C.nearBack, C.nearFront);
  lin('f', C.farBack, C.farFront);
  lin('t', C.torsoBack, C.torsoFront);
  const rg = el('radialGradient', { id: `${id}g` }, defs);
  el('stop', { offset: 0, 'stop-color': '#8FE6FF', 'stop-opacity': 1 }, rg);
  el('stop', { offset: 0.45, 'stop-color': '#3EC8F0', 'stop-opacity': 0.85 }, rg);
  el('stop', { offset: 1, 'stop-color': '#077CA5', 'stop-opacity': 0 }, rg);
  const sg = el('radialGradient', { id: `${id}s` }, defs);
  el('stop', { offset: 0, 'stop-color': '#000', 'stop-opacity': 0.6 }, sg);
  el('stop', { offset: 1, 'stop-color': '#000', 'stop-opacity': 0 }, sg);

  // Floor line across the box (not for hanging moves); floor moves ask for it with tpl.floor.
  if (tpl.rig.legs === 'ik' || tpl.floor) el('line', { x1: f1(box[0]), y1: tpl.cam.ground + 2, x2: f1(box[0] + box[2]), y2: tpl.cam.ground + 2, stroke: '#2a313a', 'stroke-width': 1.5 }, svg);

  const groups = {};
  const glows = []; // { node, weight }
  const fill = (far) => `url(#${id}${far ? 'f' : 'n'})`;
  // A thin dark outline keeps overlapping parts (arm over torso, leg over leg) readable.
  const OUT = { stroke: C.outline, 'stroke-width': 0.9, 'stroke-linejoin': 'round' };
  const rimLine = (g, d, w = 1.1, o = 0.45) => el('path', { d, fill: 'none', stroke: C.rim, 'stroke-width': w, 'stroke-linecap': 'round', opacity: o }, g);

  function addGlow(g, d, weight, far) {
    const n = el('path', { d, fill: `url(#${id}g)`, opacity: 0 }, g);
    glows.push({ node: n, weight: weight * (far ? 0.7 : 1) });
  }

  function buildLimb(name) {
    const kind = name.slice(0, -1);
    const far = name.endsWith('F');
    const g = el('g', {});
    if (kind === 'foot') {
      const pts = FOOT.map(([u, v]) => [u * s, v * s]);
      el('path', { d: smooth(pts), fill: fill(far), ...OUT }, g);
      if (!far) rimLine(g, smooth(pts.slice(0, 3), false), 1, 0.35);
      return g;
    }
    const spec = LIMB[kind];
    const k = far ? 0.92 : 1;
    const { body, rim } = limb(spec.L * s, spec.r0 * s * k, spec.r1 * s * k, [spec.front[0], spec.front[1] * s], [spec.back[0], spec.back[1] * s]);
    el('path', { d: body, fill: fill(far), ...OUT }, g);
    if (kind === 'hand') {
      const x = spec.L * s * 0.55;
      el('path', { d: `M${f1(x)},${f1(-spec.r0 * s * 0.6)}L${f1(x)},${f1(spec.r0 * s * 0.6)}`, stroke: C.outline, 'stroke-width': 0.8, fill: 'none', opacity: 0.6 }, g);
    }
    if (!far) rimLine(g, rim);
    for (const [m, w] of Object.entries(glow)) {
      for (const shape of M[m]) {
        if (shape[0] !== kind) continue;
        const [, u, v, l, wd] = shape;
        const r = (spec.r0 + (spec.r1 - spec.r0) * u) * s * k;
        addGlow(g, belly(u * spec.L * s, v * r, l * spec.L * s, wd * r), w, far);
      }
    }
    return g;
  }

  function buildTorso() {
    const g = el('g', {});
    const k = 1.08;
    const pts = TORSO.map(([u, v]) => [u * s, v * s * k]);
    el('path', { d: smooth(pts), fill: `url(#${id}t)`, ...OUT }, g);
    rimLine(g, smooth(pts.slice(6, 12), false), 1.2);
    el('path', { d: `M${f1(0.31 * s)},${f1(0.135 * s * k)}Q${f1(0.36 * s)},${f1(0.07 * s)} ${f1(0.47 * s)},${f1(0.09 * s)}`, fill: 'none', stroke: C.outline, 'stroke-width': 0.9, opacity: 0.35 }, g);
    for (const [m, w] of Object.entries(glow)) {
      for (const shape of M[m]) {
        if (shape[0] !== 'torso') continue;
        const [u, v, l, wd] = TORSO_GLOW[shape[1]];
        addGlow(g, belly(u * s, v * s * k, l * s, wd * s), w, false);
      }
    }
    return g;
  }

  function buildPelvis() {
    const g = el('g', {});
    const pts = PELVIS.map(([u, v]) => [u * s, v * s]);
    el('path', { d: smooth(pts), fill: `url(#${id}t)`, ...OUT }, g);
    rimLine(g, smooth(pts.slice(3, 7), false), 1.1, 0.4);
    if (glow.glutes) addGlow(g, belly(-0.03 * s, -0.08 * s, 0.21 * s, 0.075 * s), glow.glutes, false);
    return g;
  }

  function buildHead() {
    const g = el('g', {});
    const pts = HEAD.map(([u, v]) => [u * s, v * s]);
    el('path', { d: smooth(pts), fill: `url(#${id}t)`, ...OUT }, g);
    rimLine(g, smooth(pts.slice(6, 11), false), 1.2, 0.5);
    el('ellipse', { cx: 0.12 * s, cy: -0.02 * s, rx: 0.025 * s, ry: 0.018 * s, fill: '#4a535e' }, g); // ear
    return g;
  }

  function buildNeck() {
    const g = el('g', {});
    const { body } = limb(LIMB.neck.L * s, LIMB.neck.r0 * s, LIMB.neck.r1 * s, LIMB.neck.front, [LIMB.neck.back[0], LIMB.neck.back[1] * s]);
    el('path', { d: body, fill: `url(#${id}t)`, ...OUT }, g);
    if (glow.traps) addGlow(g, belly(0.03 * s, -0.04 * s, 0.1 * s, 0.025 * s), glow.traps * 0.8, false);
    return g;
  }

  // Props: built once in their own local frames; each frame only moves them.
  function disc(g, R, face, edge, hub) {
    el('circle', { r: R, fill: face, stroke: edge, 'stroke-width': 1.2 }, g);
    el('circle', { r: R * 0.62, fill: 'none', stroke: edge, 'stroke-width': 0.7, opacity: 0.7 }, g);
    el('circle', { r: R * 0.18, fill: hub }, g);
  }
  function dbHead(parent, light) {
    // Round head seen end-on: face, bevel ring, handle end.
    const R = 0.058 * s;
    el('circle', { r: R, fill: light ? '#3d454f' : '#272d35', stroke: light ? '#7a8490' : '#4a525d', 'stroke-width': 1 }, parent);
    el('circle', { r: R * 0.7, fill: 'none', stroke: light ? '#56606b' : '#353c45', 'stroke-width': 0.8 }, parent);
    el('circle', { r: R * 0.22, fill: light ? C.steel : C.steelDark }, parent);
  }
  function kettlebell(parent, light) {
    // Bell hanging below the handle (local px, handle at 0,0).
    el('path', { d: `M${f1(-0.045 * s)},${f1(0.05 * s)}C${f1(-0.06 * s)},${f1(-0.05 * s)} ${f1(0.06 * s)},${f1(-0.05 * s)} ${f1(0.045 * s)},${f1(0.05 * s)}`, fill: 'none', stroke: light ? '#59626d' : '#3a414a', 'stroke-width': 0.022 * s }, parent);
    el('circle', { cy: 0.11 * s, r: 0.085 * s, fill: light ? '#343b44' : '#22272e', stroke: light ? '#6a737e' : '#3e454e', 'stroke-width': 1 }, parent);
    el('ellipse', { cx: -0.03 * s, cy: 0.08 * s, rx: 0.025 * s, ry: 0.015 * s, fill: '#ffffff', opacity: light ? 0.12 : 0.06 }, parent);
  }
  function buildProp(name) {
    const g = el('g', {});
    if (name === 'plateF' || name === 'plateN') {
      // A bumper plate: two faces so it reads as a thick disc.
      const R = (tpl.plate ?? 0.2) * s;
      const back = el('g', {}, g);
      disc(back, R, C.plate, C.plateEdge, C.steelDark);
      const front = el('g', {}, g);
      disc(front, R, name === 'plateN' ? '#333a43' : '#252a31', C.plateEdge, C.steel);
      g._faces = [back, front];
    } else if (name === 'barF' || name === 'barN') {
      g._line = el('line', { stroke: name === 'barF' ? '#8d96a1' : C.steel, 'stroke-width': 0.03 * s, 'stroke-linecap': 'butt' }, g);
    } else if (/^pb[FMN]$/.test(name)) {
      g._line = el('line', { stroke: C.steel, 'stroke-width': 0.034 * s, 'stroke-linecap': 'butt' }, g);
      // The pull-up bar's cross-section shows at its near end.
      if (name === 'pbN') g._cap = el('circle', { r: 0.017 * s, fill: '#d6dce3', stroke: C.steelDark, 'stroke-width': 0.6 }, g);
    } else if (name === 'posts') {
      g._a = el('line', { stroke: '#3f4752', 'stroke-width': 0.035 * s }, g);
      g._b = el('line', { stroke: '#3f4752', 'stroke-width': 0.035 * s }, g);
    } else if (/^db[NF]in$/.test(name)) {
      // Dumbbell seen end-on: handle and inner head behind the hand, outer head in front.
      g._handle = el('line', { stroke: name[2] === 'N' ? C.steel : C.steelDark, 'stroke-width': 0.026 * s, 'stroke-linecap': 'round' }, g);
      g._head = el('g', {}, g);
      dbHead(g._head, false);
    } else if (/^db[NF]out$/.test(name)) {
      g._head = el('g', {}, g);
      dbHead(g._head, name[2] === 'N');
    } else if (/^kb[NF]$/.test(name)) {
      g._bell = el('g', {}, g);
      kettlebell(g._bell, name === 'kbN');
    } else if (name === 'goblet') {
      g._w = el('g', {}, g);
      if (tpl.load === 'kettlebell') kettlebell(g._w, true);
      else {
        // A dumbbell held upright at the chest by the top head.
        el('line', { x1: 0, y1: -0.02 * s, x2: 0, y2: 0.2 * s, stroke: C.steel, 'stroke-width': 0.028 * s }, g._w);
        el('rect', { x: -0.07 * s, y: -0.07 * s, width: 0.14 * s, height: 0.06 * s, rx: 0.015 * s, fill: '#3d454f', stroke: '#7a8490', 'stroke-width': 1 }, g._w);
        el('rect', { x: -0.07 * s, y: 0.19 * s, width: 0.14 * s, height: 0.06 * s, rx: 0.015 * s, fill: '#2c333b', stroke: '#5a636e', 'stroke-width': 1 }, g._w);
      }
    } else if (/^(cable|band)[NF]$/.test(name)) {
      const band = name.startsWith('band');
      g._line = el('line', { stroke: band ? '#3EC8F0' : '#c3cad3', 'stroke-width': (band ? 0.022 : 0.008) * s, 'stroke-linecap': 'round', opacity: name.endsWith('F') ? 0.6 : 1 }, g);
    } else if (name === 'towel' || /^strap[NF]$/.test(name)) {
      g._line = el('line', { stroke: name === 'strapF' ? '#a9b3c2' : '#d7dee9', 'stroke-width': 0.034 * s, 'stroke-linecap': 'round', opacity: name === 'strapF' ? 0.7 : 1 }, g);
    } else if (name === 'loop') {
      g._line = el('line', { stroke: '#3EC8F0', 'stroke-width': 0.026 * s, 'stroke-linecap': 'round' }, g);
    } else if (name === 'sled') {
      // The carriage plate the feet press: a dark back face under a lighter front face.
      g._back = el('path', { fill: '#1f252c', stroke: C.outline, 'stroke-width': 0.8, 'stroke-linejoin': 'round' }, g);
      g._face = el('path', { fill: '#4a525d', stroke: C.steelDark, 'stroke-width': 1, 'stroke-linejoin': 'round' }, g);
    } else if (/^pad[NF]$/.test(name)) {
      g._edge = el('line', { stroke: C.outline, 'stroke-width': 0.1 * s, 'stroke-linecap': 'round' }, g);
      g._pad = el('line', { stroke: name === 'padN' ? '#a8453d' : '#7a322d', 'stroke-width': 0.075 * s, 'stroke-linecap': 'round' }, g);
    } else if (name === 'cuff') {
      g._edge = el('line', { stroke: C.outline, 'stroke-width': 0.068 * s, 'stroke-linecap': 'round' }, g);
      g._line = el('line', { stroke: '#3EC8F0', 'stroke-width': 0.052 * s, 'stroke-linecap': 'round' }, g);
    } else if (name === 'cuffcable') {
      g._line = el('line', { stroke: '#c3cad3', 'stroke-width': 0.012 * s, 'stroke-linecap': 'round' }, g);
    } else if (name === 'pulley') {
      el('circle', { r: 0.055 * s, fill: '#2a3038', stroke: C.steel, 'stroke-width': 1.6 }, g);
      el('circle', { r: 0.016 * s, fill: C.steel }, g);
    } else if (name === 'cardioB' || name === 'cardioF') {
      g._nodes = []; // the machine shapes, updated in place each frame (same count every frame)
    } else if (name === 'ball') {
      g._b = el('circle', { r: 0.11 * s, fill: '#3b3128', stroke: '#6b5a48', 'stroke-width': 1.2 }, g);
    } else if (name === 'wheel') {
      g._b = el('g', {}, g);
      el('circle', { r: 0.09 * s, fill: '#2a3038', stroke: '#6a737e', 'stroke-width': 1.5 }, g._b);
      el('circle', { r: 0.025 * s, fill: C.steel }, g._b);
    } else if (/^dip[NF]$/.test(name)) {
      g._rail = el('line', { stroke: name === 'dipN' ? C.steel : '#7d8691', 'stroke-width': 0.04 * s, 'stroke-linecap': 'round' }, g);
      g._legA = el('line', { stroke: '#3f4752', 'stroke-width': 0.035 * s }, g);
      g._legB = el('line', { stroke: '#3f4752', 'stroke-width': 0.035 * s }, g);
    } else if (/^ring[NF]$/.test(name)) {
      g._strap = el('line', { stroke: '#c9b48a', 'stroke-width': 0.012 * s }, g);
      g._ring = el('circle', { r: 0.09 * s, fill: 'none', stroke: '#2b2f35', 'stroke-width': 0.03 * s }, g);
    } else if (name === 'shadow') {
      el('ellipse', { rx: 0.42 * s, ry: 0.06 * s, fill: `url(#${id}s)` }, g);
    }
    return g;
  }

  // ----- environment: benches, boxes, walls, cable stacks. Static, so drawn once, always behind the body. -----
  function buildEnv() {
    const g = el('g', { class: 'env' });
    const yaw = (tpl.cam.yaw * Math.PI) / 180;
    const pitch = (tpl.cam.pitch * Math.PI) / 180;
    const toViewer = [Math.sin(yaw), Math.sin(pitch), -Math.cos(yaw)];
    const dot = (a, b2) => a[0] * b2[0] + a[1] * b2[1] + a[2] * b2[2];
    const poly = (pts, fillc) => el('path', { d: `M${pts.map((p) => project(p).slice(0, 2).map(f1).join(',')).join('L')}Z`, fill: fillc, stroke: C.outline, 'stroke-width': 0.8, 'stroke-linejoin': 'round' }, g);
    // A box from a top edge a→b (in the x-y plane), width w across z, thickness t below the top.
    const slab = (a, b2, w, t, col = ['#3d4550', '#262c34', '#2e353e'], zc = 0) => {
      const dx = b2[0] - a[0];
      const dy = b2[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      const u = [dx / L, dy / L, 0];
      const n = [-u[1], u[0], 0]; // up-ish normal of the top face
      const down = [-n[0] * t, -n[1] * t, 0];
      const P = (p, z, d = false) => [p[0] + (d ? down[0] : 0), p[1] + (d ? down[1] : 0), z + zc];
      const hw = w / 2;
      const faces = [
        [[P(a, -hw), P(b2, -hw), P(b2, hw), P(a, hw)], n, col[0]],
        [[P(a, -hw), P(b2, -hw), P(b2, -hw, true), P(a, -hw, true)], [0, 0, -1], col[1]],
        [[P(a, hw), P(b2, hw), P(b2, hw, true), P(a, hw, true)], [0, 0, 1], col[1]],
        [[P(b2, -hw), P(b2, hw), P(b2, hw, true), P(b2, -hw, true)], u, col[2]],
        [[P(a, -hw), P(a, hw), P(a, hw, true), P(a, -hw, true)], [-u[0], -u[1], 0], col[2]],
      ];
      faces.filter(([, nn]) => dot(nn, toViewer) > 0)
        .sort((f, h) => project(h[0][0])[2] - project(f[0][0])[2])
        .forEach(([pts, , c]) => poly(pts, c));
    };
    const post = (x, y0, y1, z, w = 0.04) => slab([x - w / 2, y1], [x + w / 2, y1], w, y1 - y0, ['#323942', '#20252b', '#292f37'], z);
    for (const e of tpl.env || []) {
      if (e.type === 'bench') {
        const w = e.w ?? 0.3;
        for (const [a, b2] of e.pads) {
          if (e.legs === false) continue;
          post(a[0] + 0.08, 0, a[1] - 0.07, e.z || 0, 0.05);
          post(b2[0] - 0.08, 0, b2[1] - 0.07, e.z || 0, 0.05);
        }
        for (const [a, b2] of e.pads) slab(a, b2, w, 0.07, ['#4a3a32', '#2c231e', '#3a2e27'], e.z || 0);
      } else if (e.type === 'box') {
        slab([e.x0, e.h], [e.x1, e.h], e.w ?? 0.5, e.h, ['#4b4035', '#2e271f', '#3b3229'], e.z || 0);
      } else if (e.type === 'wall') {
        slab([e.x, 2.4], [e.x + 0.12, 2.4], 1.6, 2.4, ['#2a3038', '#1d2228', '#262c33']);
      } else if (e.type === 'stack') {
        slab([e.x - 0.12, e.h], [e.x + 0.12, e.h], 0.3, e.h, ['#2f363f', '#1f242a', '#282e35']);
      } else if (e.type === 'rails') {
        for (const z of [0.55, -0.55]) post(e.x, 0, 2.2, z, 0.045);
      } else if (e.type === 'table') {
        // A top slab on four legs (the far legs sit behind the figure).
        const w = e.w ?? 0.8;
        for (const z of [-w / 2 + 0.05, w / 2 - 0.05]) for (const x of [e.x0 + 0.06, e.x1 - 0.06]) post(x, 0, e.h - 0.04, z, 0.05);
        slab([e.x0, e.h], [e.x1, e.h], w, 0.04, ['#5a4636', '#33271d', '#45352a']);
      } else if (e.type === 'doorframe') {
        // Two jambs with the doorway between them; the top runs off the demo box.
        const w = e.w ?? 0.86;
        for (const z of [-w / 2, w / 2]) post(e.x, 0, 2.1, z, 0.07);
      } else if (e.type === 'slab') {
        // Any block: a top edge a → b (x, y), width w across z, thickness t down from the top, optional z shift.
        slab(e.a, e.b, e.w ?? 0.5, e.t ?? 0.1, e.col || ['#3d4550', '#262c34', '#2e353e'], e.z || 0);
      } else if (e.type === 'floorpad') {
        slab([e.x0, 0.02], [e.x1, 0.02], 0.6, 0.02, ['#262c33', '#1b1f24', '#20252b']);
      }
    }
    return g;
  }

  const builders = { torso: buildTorso, pelvis: buildPelvis, head: buildHead, neck: buildNeck };
  const env = buildEnv();
  for (const name of ['shadow', ...BODY_PARTS, ...propParts(tpl)]) {
    const g = /^(thigh|shin|foot|upper|fore|hand)[NF]$/.test(name) ? buildLimb(name) : builders[name] ? builders[name]() : buildProp(name);
    g.dataset.part = name;
    svg.appendChild(g);
    groups[name] = g;
  }
  container.innerHTML = '';
  container.appendChild(svg);

  // Plane transform for a prop face: local px → the world plane spanned by ax/ay (unit vectors) through c.
  const plane = (c, ax, ay) => {
    const O = project(c);
    const X = project([c[0] + ax[0], c[1] + ax[1], c[2] + ax[2]]);
    const Y = project([c[0] + ay[0], c[1] + ay[1], c[2] + ay[2]]);
    return [(X[0] - O[0]) / s, (X[1] - O[1]) / s, (Y[0] - O[0]) / s, (Y[1] - O[1]) / s, O[0], O[1]];
  };
  const set = (g, m) => g && g.setAttribute('transform', mtx(m));
  const at = (p, z) => [p[0], p[1], z];
  const line = (n, a, b) => {
    const A = project(a);
    const B = project(b);
    n.setAttribute('x1', f1(A[0]));
    n.setAttribute('y1', f1(A[1]));
    n.setAttribute('x2', f1(B[0]));
    n.setAttribute('y2', f1(B[1]));
  };
  const ux = [1, 0, 0];
  const uy = [0, -1, 0]; // screen y runs down

  const PRIM_TAG = { line: 'line', curve: 'polyline', circle: 'circle', poly: 'polygon' };
  const pt2 = (p) => project(p).slice(0, 2).map(f1).join(',');
  const setAll = (n, attrs) => { for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); };
  /** Machine shapes (rig.js cardioProps): one node per shape, reused from frame to frame. */
  function drawPrims(g, list) {
    list.forEach((p, i) => {
      let n = g._nodes[i];
      if (!n || n.tagName !== PRIM_TAG[p.k]) {
        const fresh = document.createElementNS(NS, PRIM_TAG[p.k]);
        if (n) g.replaceChild(fresh, n); else g.appendChild(fresh);
        n = fresh;
        g._nodes[i] = n;
      }
      if (p.k === 'line') {
        const A = project(p.a);
        const B = project(p.b);
        setAll(n, { x1: f1(A[0]), y1: f1(A[1]), x2: f1(B[0]), y2: f1(B[1]), stroke: p.c, 'stroke-width': f1(p.w * s), 'stroke-linecap': 'round' });
      } else if (p.k === 'curve') {
        setAll(n, { points: p.pts.map(pt2).join(' '), fill: 'none', stroke: p.c, 'stroke-width': f1(p.w * s), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      } else if (p.k === 'circle') {
        const C0 = project(p.c);
        setAll(n, { cx: f1(C0[0]), cy: f1(C0[1]), r: f1(p.r * s), fill: p.fill || 'none', stroke: p.stroke || 'none', 'stroke-width': 1.2 });
      } else {
        setAll(n, { points: p.pts.map(pt2).join(' '), fill: p.fill || 'none', stroke: p.stroke || 'none', 'stroke-width': 1, 'stroke-linejoin': 'round' });
      }
    });
    while (g._nodes.length > list.length) g.removeChild(g._nodes.pop());
  }

  // ----- props, moved each frame -----
  function updateProps(j) {
    const b = j.bar;
    const g = groups;
    if (g.barF) line(g.barF._line, at(b, 0), at(b, 0.78));
    if (g.barN) line(g.barN._line, at(b, 0), at(b, -0.78));
    for (const [name, side] of [['plateF', 1], ['plateN', -1]]) {
      if (!g[name]) continue;
      const [inner, outer] = g[name]._faces;
      set(inner, plane(at(b, side * 0.5), ux, uy));
      set(outer, plane(at(b, side * 0.6), ux, uy));
      g[name].appendChild(side < 0 ? outer : inner); // nearer face on top
    }
    if (g.pbM) {
      const { x, y } = tpl.rig.hands;
      line(g.pbF._line, [x, y, 0.62], [x, y, 0.12]);
      line(g.pbM._line, [x, y, 0.12], [x, y, -0.12]);
      line(g.pbN._line, [x, y, -0.12], [x, y, -0.62]);
      const cap = project([x, y, -0.62]);
      g.pbN._cap.setAttribute('cx', f1(cap[0]));
      g.pbN._cap.setAttribute('cy', f1(cap[1]));
      line(g.posts._a, [x, y - 0.02, 0.62], [x, y + 0.7, 0.62]);
      line(g.posts._b, [x, y - 0.02, -0.62], [x, y + 0.7, -0.62]);
    }
    for (const S of ['N', 'F']) {
      const side = S === 'N' ? -1 : 1;
      const grip = j['grip' + S];
      if (g[`db${S}in`]) {
        const inner = [grip[0], grip[1], grip[2] - side * 0.11];
        const outer = [grip[0], grip[1], grip[2] + side * 0.11];
        line(g[`db${S}in`]._handle, inner, outer);
        set(g[`db${S}in`]._head, plane(inner, ux, uy));
        set(g[`db${S}out`]._head, plane(outer, ux, uy));
      }
      if (g['kb' + S]) {
        const P0 = project(grip);
        // Hangs under the hand, swings out along the forearm (tpl.kbOrient = 'arm') or lies where param `kb` says.
        const B = project(add3(grip, bellDir(tpl, j, S), BELL_OFFSET));
        const ang = (Math.atan2(B[0] - P0[0], B[1] - P0[1]) * -180) / Math.PI;
        g['kb' + S]._bell.setAttribute('transform', `translate(${f1(P0[0])},${f1(P0[1])}) rotate(${f1(ang)})`);
      }
      for (const kind of ['cable', 'band']) {
        if (g[kind + S]) line(g[kind + S]._line, grip, [tpl.anchor[0], tpl.anchor[1], grip[2] * (tpl.anchorZ ?? 1)]);
      }
      if (g['strap' + S]) line(g['strap' + S]._line, grip, [tpl.anchor[0], tpl.anchor[1], grip[2] * (tpl.anchorZ ?? 1)]);
      if (g['dip' + S]) {
        const y = tpl.dipY ?? 1.15;
        const z = side * 0.26;
        line(g['dip' + S]._rail, [-0.45, y, z], [0.45, y, z]);
        line(g['dip' + S]._legA, [-0.4, y, z], [-0.4, 0, z]);
        line(g['dip' + S]._legB, [0.4, y, z], [0.4, 0, z]);
      }
      if (g['ring' + S]) {
        const P0 = project(grip);
        line(g['ring' + S]._strap, [grip[0], grip[1] + 1.2, grip[2]], grip);
        g['ring' + S]._ring.setAttribute('cx', f1(P0[0]));
        g['ring' + S]._ring.setAttribute('cy', f1(P0[1]));
      }
    }
    if (g.sled) {
      const pl = sledPlate(tpl, j);
      const path = (q) => `M${q.map((p) => project(p).slice(0, 2).map(f1).join(',')).join('L')}Z`;
      g.sled._back.setAttribute('d', path(pl.back));
      g.sled._face.setAttribute('d', path(pl.face));
    }
    for (const S of ['N', 'F']) {
      if (!g['pad' + S]) continue;
      const pd = kneePad(tpl, j, S);
      line(g['pad' + S]._edge, pd.a, pd.b);
      line(g['pad' + S]._pad, pd.a, pd.b);
    }
    if (g.cuff) {
      const cf = ankleCuff(tpl, j);
      line(g.cuff._edge, cf.a, cf.b);
      line(g.cuff._line, cf.a, cf.b);
      line(g.cuffcable._line, cf.centre, cf.pulley);
      const P0 = project(cf.pulley);
      g.pulley.setAttribute('transform', `translate(${f1(P0[0])},${f1(P0[1])})`);
    }
    if (g.cardioB) {
      const cp = cardioProps(tpl, j);
      drawPrims(g.cardioB, cp.back);
      drawPrims(g.cardioF, cp.front);
    }
    if (g.towel) line(g.towel._line, j.gripN, j.gripF);
    if (g.loop) line(g.loop._line, ...loopEnds(tpl, j));
    const mg = [(j.gripN[0] + j.gripF[0]) / 2, (j.gripN[1] + j.gripF[1]) / 2, (j.gripN[2] + j.gripF[2]) / 2];
    if (g.goblet) {
      const P0 = project([mg[0], mg[1] + 0.03, mg[2]]);
      g.goblet._w.setAttribute('transform', `translate(${f1(P0[0])},${f1(P0[1])})`);
    }
    for (const name of ['ball', 'wheel']) {
      if (!g[name]) continue;
      const P0 = project(name === 'wheel' ? [mg[0] + 0.03, 0.09, 0] : [mg[0] + 0.05, mg[1], 0]);
      if (name === 'ball') { g.ball._b.setAttribute('cx', f1(P0[0])); g.ball._b.setAttribute('cy', f1(P0[1])); }
      else g.wheel._b.setAttribute('transform', `translate(${f1(P0[0])},${f1(P0[1])})`);
    }
  }
  let lastOrder = '';

  function draw(t, staticPose) {
    const P = staticPose || paramsAt(tpl, phases, t);
    const j = solve(tpl, P);
    const bone = (name, a, b, L, front) => set(groups[name], boneMatrix(project, s, a, b, L, front));
    for (const S of ['N', 'F']) {
      bone(`thigh${S}`, j[`hip${S}`], j[`knee${S}`], BODY.thigh, ux);
      bone(`shin${S}`, j[`knee${S}`], j[`ankle${S}`], BODY.shin, ux);
      bone(`foot${S}`, j[`heel${S}`], j[`toe${S}`], 0.225, [0, 1, 0]);
      bone(`upper${S}`, j[`shoulder${S}`], j[`elbow${S}`], BODY.upper, j.fwd);
      // Forearm front = the flexor side, which turns toward the upper arm as the elbow bends.
      const e = j[`elbow${S}`];
      const sh = j[`shoulder${S}`];
      bone(`fore${S}`, e, j[`wrist${S}`], BODY.fore, [sh[0] - e[0] + j.fwd[0] * 0.15, sh[1] - e[1] + j.fwd[1] * 0.15, sh[2] - e[2]]);
      bone(`hand${S}`, j[`wrist${S}`], j[`handTip${S}`], BODY.hand, j.fwd);
    }
    bone('torso', j.pelvis, j.chest, BODY.spine, j.fwd);
    bone('pelvis', j.pelvis, j.chest, BODY.spine, j.fwd);
    bone('neck', [j.chest[0] - j.up[0] * 0.02, j.chest[1] - j.up[1] * 0.02, j.chest[2] - j.up[2] * 0.02], j.neck, LIMB.neck.L, j.fwd);
    bone('head', j.neck, [j.neck[0] + j.headUp[0] * 0.24, j.neck[1] + j.headUp[1] * 0.24, j.neck[2] + j.headUp[2] * 0.24], 0.24, j.headFwd);

    // Shadow under the feet (smaller and fainter when hanging).
    const O = project([(j.ankleN[0] + j.ankleF[0]) / 2, 0, (j.ankleN[2] + j.ankleF[2]) / 2]);
    const air = Math.max(0, Math.min(j.ankleN[1], j.ankleF[1]) - BODY.ankleY);
    groups.shadow.setAttribute('transform', `translate(${f1(O[0])},${f1(O[1])}) scale(${(1 - Math.min(0.6, air * 0.8)).toFixed(2)})`);
    groups.shadow.setAttribute('opacity', Math.max(0.3, 1 - air * 1.5).toFixed(2));

    updateProps(j);

    // Depth sort: re-append groups only when the back-to-front order changes.
    const order = drawOrder(tpl, j, project);
    const key = order.join();
    if (key !== lastOrder) {
      lastOrder = key;
      for (const name of order) {
        svg.appendChild(groups[name]);
        if (name === 'shadow') svg.appendChild(env); // benches, boxes, walls: always behind the body
      }
    }

    // Glow: opacity only, strongest at the hardest point of the rep.
    const k = staticPose || tpl.cycle ? 1 : progressAt(phases, t, 0); // loops (cardio, rope, boxing) keep a steady glow
    const kk = Math.pow(k, 1.6);
    for (const g of glows) g.node.setAttribute('opacity', (g.weight * kk).toFixed(2));
  }

  if (still === 'hard') {
    draw(0, tpl.b); // thumbnail: the hardest point, muscles lit
    return { stop() {} };
  }
  if (still != null) {
    draw(still); // a still frame `at` seconds into the rep (frame sheets)
    return { stop() {} };
  }
  if (reducedMotion()) {
    draw(0, tpl.b); // static: the hardest point, muscles lit
    return { stop() {} };
  }

  // Animate at ≤ 30 fps. Paused or resting: hold the current frame and let the loop sleep. Every way out
  // of a pause or a rest re-renders the screen, which mounts a fresh figure.
  let stopped = false;
  let last = -1;
  const start = performance.now();
  draw(0);
  onFrame((now) => {
    if (stopped || !svg.isConnected || isPaused()) return false;
    if (now - last < 33) return true;
    last = now;
    draw((now - start) / 1000);
    return true;
  });
  return { stop() { stopped = true; } };
}
