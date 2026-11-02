// v0.14.2 demo figures for the gym and YMCA machine moves (js/ui/poses-gym.js): leg presses on the 45° sled, the hip
// abductor / adductor machine and the cable hip moves. Synthetic only: poses are checked as joint positions.
import { test, eq, assert } from './harness.js';
import { solve, dist, repPhases, repLength, paramsAt, camera, frameBox, propParts, drawOrder, sledPlate, kneePad, ankleCuff } from '../js/ui/rig.js';
import { TEMPLATES, EXERCISE_TEMPLATES } from '../js/ui/poses.js';
import { GYM, GYM_MAP } from '../js/ui/poses-gym.js';
import { EXERCISES } from '../js/workouts/exercises.js';

// Every move the v0.14.2 brief lists (issue #48). The hip abductor machine was skipped until v0.16.93 (its far leg drew wrong); it is drawn now.
const BRIEF = [
  'machine_leg_press', 'machine_single_leg_press', 'machine_leg_press_calf', 'machine_hip_abductor', 'machine_hip_adductor',
  'cable_hip_abduction', 'cable_hip_adduction',
];
const SKIPPED = [];
const PRESSES = ['machine_leg_press', 'machine_single_leg_press', 'machine_leg_press_calf'];
const HIP_MACHINES = ['machine_hip_adductor'];
const CABLES = ['cable_hip_abduction', 'cable_hip_adduction'];

const SAMPLES = 24;
const phases = (tpl) => repPhases(tpl.tempo, tpl.first);
const poses = (tpl) => {
  const ph = phases(tpl);
  const T = repLength(ph);
  return Array.from({ length: SAMPLES }, (_, k) => solve(tpl, paramsAt(tpl, ph, (T * k) / SAMPLES)));
};
const tplOf = (id) => TEMPLATES[EXERCISE_TEMPLATES[id]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const distToSegment = (p, a, b) => {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
};
const slabs = (tpl) => (tpl.env || []).filter((e) => e.type === 'slab');
/** Is the point inside the block a → b (top edge), t thick below it, w wide across z? */
const insideSlab = (p, e, pad = 0) => {
  const dx = e.b[0] - e.a[0];
  const dy = e.b[1] - e.a[1];
  const L = Math.hypot(dx, dy);
  const u = [dx / L, dy / L];
  const n = [-u[1], u[0]];
  const along = (p[0] - e.a[0]) * u[0] + (p[1] - e.a[1]) * u[1];
  const across = (p[0] - e.a[0]) * n[0] + (p[1] - e.a[1]) * n[1];
  return along > pad && along < L - pad && across < -pad && across > -e.t + pad && Math.abs(p[2] - (e.z || 0)) < (e.w ?? 0.5) / 2 - pad;
};
const BODY_POINTS = ['pelvis', 'chest', 'head', 'elbowN', 'elbowF', 'wristN', 'wristF', 'kneeN', 'kneeF', 'ankleN', 'ankleF', 'toeN', 'toeF', 'heelN', 'heelF'];
const D = [Math.SQRT1_2, Math.SQRT1_2];
const P = [-Math.SQRT1_2, Math.SQRT1_2];
const along = (p) => p[0] * D[0] + p[1] * D[1];
const up = (p) => p[0] * P[0] + p[1] * P[1];

test('gym figures: every id in the brief has a template, or is listed as skipped', () => {
  for (const id of BRIEF.filter((x) => !SKIPPED.includes(x))) {
    assert(EXERCISES.some((e) => e.id === id), `${id} is a real exercise`);
    assert(EXERCISE_TEMPLATES[id], `${id} has a template`);
    assert(GYM[EXERCISE_TEMPLATES[id]], `${id} is drawn from poses-gym.js`);
  }
  eq(Object.keys(GYM_MAP).sort().join(), BRIEF.filter((x) => !SKIPPED.includes(x)).sort().join(), 'the map holds exactly the brief, minus the skipped');
  for (const id of SKIPPED) assert(!EXERCISE_TEMPLATES[id], `${id} stays unmapped`);
  for (const id of SKIPPED) assert(EXERCISES.some((e) => e.id === id), `${id} is a real exercise`);
});

test('gym figures: every a / b number is finite, every frame solves and frames', () => {
  for (const [name, tpl] of Object.entries(GYM)) {
    for (const k of ['a', 'm', 'b']) for (const [p, v] of Object.entries(tpl[k] || {})) assert(Number.isFinite(v), `${name}.${k}.${p} is ${v}`);
    for (const p of Object.keys(tpl.b)) assert(p in tpl.a, `${name}.b.${p} has a start value`);
    for (const p of Object.keys(tpl.a)) assert(p in tpl.b, `${name}.a.${p} has an end value (the thumbnail draws b alone)`);
    for (const j of poses(tpl)) for (const [p, v] of Object.entries(j)) if (Array.isArray(v)) assert(v.every(Number.isFinite), `${name} ${p}`);
    assert(frameBox(tpl, camera(tpl.cam), phases(tpl)).every(Number.isFinite), `${name} frame`);
    assert(drawOrder(tpl, solve(tpl, tpl.a), camera(tpl.cam)).length >= 17, `${name} draw order`);
    for (const e of tpl.env || []) assert([e.a, e.b].every((q) => q.every(Number.isFinite)) && Number.isFinite(e.t), `${name} env block`);
  }
});

test('gym figures: cameras — side view for the leg presses, front view for the hip machine and the cable hip moves', () => {
  for (const id of PRESSES) assert(tplOf(id).cam.yaw <= 30, `${id} yaw ${tplOf(id).cam.yaw}`);
  for (const id of [...HIP_MACHINES, ...CABLES]) assert(tplOf(id).cam.yaw >= 70, `${id} yaw ${tplOf(id).cam.yaw}`);
});

test('gym figures: nothing goes through the floor', () => {
  for (const [name, tpl] of Object.entries(GYM)) {
    for (const j of poses(tpl)) {
      for (const key of BODY_POINTS) assert(j[key][1] > -0.03, `${name} ${key} at y=${j[key][1].toFixed(3)}`);
      for (const key of ['ankleN', 'ankleF']) assert(j[key][1] > 0.05, `${name} ${key} at y=${j[key][1].toFixed(3)}`);
    }
  }
});

test('gym figures: the machine moves show their props', () => {
  for (const id of PRESSES) assert(propParts(tplOf(id)).includes('sled'), `${id} has a sled`);
  for (const id of HIP_MACHINES) assert(['padN', 'padF'].every((p) => propParts(tplOf(id)).includes(p)), `${id} has knee pads`);
  for (const id of CABLES) assert(['cuff', 'cuffcable', 'pulley'].every((p) => propParts(tplOf(id)).includes(p)), `${id} has a cuff, cable and pulley`);
});

// ---------- leg presses ----------

test('leg press: the feet stay on the sled in every frame (both feet, flat on the plate, nothing past it)', () => {
  for (const id of ['machine_leg_press', 'machine_single_leg_press']) {
    const tpl = tplOf(id);
    for (const j of poses(tpl)) {
      for (const S of id === 'machine_single_leg_press' ? ['N'] : ['N', 'F']) {
        for (const key of ['toe', 'heel']) {
          const p = j[key + S];
          assert(Math.abs(along(p) - j.sl) < 0.01, `${id} ${key}${S} is ${(along(p) - j.sl).toFixed(3)} m off the plate`);
        }
        const pl = sledPlate(tpl, j);
        const lo = tpl.sled.q - tpl.sled.half;
        const hi = tpl.sled.q + tpl.sled.half;
        for (const key of ['toe', 'heel', 'ankle']) assert(up(j[key + S]) > lo && up(j[key + S]) < hi, `${id} ${key}${S} is on the plate`);
        assert(Math.abs(j['toe' + S][2]) < tpl.sled.w && Math.abs(j['heel' + S][2]) < tpl.sled.w, `${id} ${S} foot is within the plate width`);
        assert(pl.face.every((q) => q.every(Number.isFinite)), `${id} plate corners`);
      }
    }
  }
});

test('leg press: the sled slides along the rails and the legs really move it (deep → almost straight)', () => {
  for (const id of ['machine_leg_press', 'machine_single_leg_press']) {
    const tpl = tplOf(id);
    const a = solve(tpl, tpl.a);
    const b = solve(tpl, tpl.b);
    assert(a.sl - b.sl > 0.25, `${id} sled travels ${(a.sl - b.sl).toFixed(2)} m`);
    assert(dist(a.hipN, a.ankleN) > 0.78 && dist(a.hipN, a.ankleN) < 0.88, `${id} top is almost straight, not locked`);
    assert(dist(b.hipN, b.ankleN) < 0.6, `${id} bottom is deep`);
    // The plate stays square to the rails: its face points have the same position along the rails.
    for (const j of poses(tpl)) {
      const pl = sledPlate(tpl, j);
      for (const q of pl.face) assert(Math.abs(along(q) - j.sl) < 1e-9, `${id} plate is square to the rails`);
    }
  }
});

test('leg press: single-leg presses with one leg; the other foot stays planted on the floor under its knee', () => {
  const tpl = tplOf('machine_single_leg_press');
  const fs = poses(tpl);
  for (const j of fs) {
    assert(dist(j.ankleF, fs[0].ankleF) < 1e-9, 'resting foot does not move');
    assert(j.toeF[1] > -0.03 && j.heelF[1] > -0.03 && j.ankleF[1] < 0.1, 'resting foot is on the floor');
    assert(j.kneeF[1] > j.ankleF[1] + 0.3, 'resting knee is bent up over the foot');
  }
  const press = tplOf('machine_leg_press');
  assert(poses(press).every((j) => dist(j.ankleN, j.ankleF) < 0.3 && Math.abs(j.ankleN[1] - j.ankleF[1]) < 1e-9), 'two-leg press moves both feet together');
});

test('calf press: legs stay almost straight, the front of the foot pushes the plate and the heel is free', () => {
  const tpl = tplOf('machine_leg_press_calf');
  const fs = poses(tpl);
  const a = fs[0];
  for (const j of fs) {
    assert(dist(j.hipN, j.ankleN) > 0.8 && dist(j.hipN, j.ankleN) < 0.88, 'knees almost straight, not locked');
    assert(dist(j.ankleN, a.ankleN) < 1e-9, 'only the ankles move');
    const ball = [0, 1, 2].map((i) => j.heelN[i] + (j.toeN[i] - j.heelN[i]) * 0.62);
    const front = Math.max(along(ball), along(j.toeN));
    assert(Math.abs(front - j.sl) < 0.015, `front of the foot is ${(front - j.sl).toFixed(3)} m from the plate`);
    for (const key of ['toeN', 'toeF', 'ankleN', 'ankleF', 'kneeN', 'kneeF']) assert(along(j[key]) < j.sl + 0.015, `${key} went through the plate`);
    assert(along(j.heelN) < j.sl + 0.012, 'heel does not go through the plate');
  }
  const b = solve(tpl, tpl.b);
  assert(b.sl - solve(tpl, tpl.a).sl > 0.05, 'the plate moves a few centimetres');
  assert(solve(tpl, tpl.a).sl - along(solve(tpl, tpl.a).heelN) < 0.01 && b.sl - along(b.heelN) > 0.08, 'the heel lifts away from the plate at the top');
});

test('leg press: the body sits on the seat and against the back pad, the knees clear the chest, the plate rides the rails', () => {
  for (const id of PRESSES) {
    const tpl = tplOf(id);
    const [, seat, back, ...rails] = tpl.env;
    const railTop = rails[0];
    for (const j of poses(tpl)) {
      // Pelvis rests just above the seat pad.
      const gap = j.pelvis[1] - seat.a[1];
      assert(gap > 0.08 && gap < 0.2, `${id} pelvis is ${gap.toFixed(3)} above the seat`);
      assert(j.pelvis[0] > seat.a[0] && j.pelvis[0] < seat.b[0], `${id} pelvis is over the seat`);
      // Spine lies 0.13 in front of the back pad's face, all the way up.
      const dx = back.b[0] - back.a[0];
      const dy = back.b[1] - back.a[1];
      const n = [-dy / Math.hypot(dx, dy), dx / Math.hypot(dx, dy)];
      for (const key of ['pelvis', 'chest']) {
        const off = (j[key][0] - back.b[0]) * n[0] + (j[key][1] - back.b[1]) * n[1];
        assert(off > 0.09 && off < 0.17, `${id} ${key} is ${off.toFixed(3)} from the back pad`);
      }
      for (const S of ['N', 'F']) assert(distToSegment(j['knee' + S], j.pelvis, j.chest) > 0.2, `${id} knee ${S} is in the chest`);
      // The plate's lower edge sits on the rail.
      const lowEdge = tpl.sled.q - tpl.sled.half;
      const railUp = up([railTop.a[0], railTop.a[1]]);
      assert(lowEdge - railUp >= 0 && lowEdge - railUp < 0.05, `${id} plate rides the rail`);
    }
  }
});

// ---------- hip abductor / adductor machine ----------

test('hip machine: knees never pass through the pads, which are outside the knees (abductor) or inside them (adductor)', () => {
  for (const id of HIP_MACHINES) {
    const tpl = tplOf(id);
    const out = false;
    for (const j of poses(tpl)) {
      for (const S of ['N', 'F']) {
        const pad = kneePad(tpl, j, S);
        assert(distToSegment(j['knee' + S], pad.a, pad.b) > 0.09, `${id} knee ${S} is in its pad`);
        assert(distToSegment(j['ankle' + S], pad.a, pad.b) > 0.09, `${id} ankle ${S} is in its pad`);
        const mid = [(j['hip' + S][0] + j['knee' + S][0]) / 2, (j['hip' + S][1] + j['knee' + S][1]) / 2, (j['hip' + S][2] + j['knee' + S][2]) / 2];
        assert(distToSegment(mid, pad.a, pad.b) > 0.09, `${id} thigh ${S} is in its pad`);
        assert(out ? Math.abs(pad.centre[2]) > Math.abs(j['knee' + S][2]) + 0.08 : Math.abs(pad.centre[2]) < Math.abs(j['knee' + S][2]) - 0.08, `${id} ${S} pad is on the ${out ? 'outer' : 'inner'} side of the knee`);
        assert(pad.a[1] < j['knee' + S][1] && pad.b[1] > j['knee' + S][1], `${id} pad is at knee height`);
      }
      const [pn, pf] = ['N', 'F'].map((S) => kneePad(tpl, j, S));
      assert(distToSegment(pn.centre, pf.a, pf.b) > 0.095, `${id} the two pads touch`);
    }
  }
});

test('hip machine: the adductor squeezes the knees together, and the abductor presses them apart', () => {
  const gapOf = (tpl, k) => { const j = solve(tpl, tpl[k]); return Math.abs(j.kneeN[2] - j.kneeF[2]); };
  const ad = tplOf('machine_hip_adductor');
  assert(gapOf(ad, 'a') - gapOf(ad, 'b') > 0.2, 'adductor: knees close');
  assert(gapOf(ad, 'b') > 0.28, 'adductor: the knees do not cross or touch the other pad');
  const ab = tplOf('machine_hip_abductor');
  assert(gapOf(ab, 'b') - gapOf(ab, 'a') > 0.2, 'abductor: knees open');
  assert(ab.pads.out === true && gapOf(ab, 'a') > 0.1, 'abductor: pads outside the knees, knees start apart from each other');
});

test('hip machine: sits on the seat, spine on the back pad, thighs level over the seat, feet on the floor, hands clear of the pads', () => {
  for (const id of HIP_MACHINES) {
    const tpl = tplOf(id);
    const [, seat, back] = tpl.env;
    for (const j of poses(tpl)) {
      const gap = j.pelvis[1] - seat.a[1];
      assert(gap > 0.05 && gap < 0.12, `${id} pelvis is ${gap.toFixed(3)} above the seat`);
      const dx = back.b[0] - back.a[0];
      const dy = back.b[1] - back.a[1];
      const n = [-dy / Math.hypot(dx, dy), dx / Math.hypot(dx, dy)];
      for (const key of ['pelvis', 'chest']) {
        const off = (j[key][0] - back.b[0]) * n[0] + (j[key][1] - back.b[1]) * n[1];
        assert(off > 0.09 && off < 0.17, `${id} ${key} is ${off.toFixed(3)} from the back pad`);
      }
      for (const S of ['N', 'F']) {
        assert(Math.abs(j['knee' + S][1] - j.pelvis[1]) < 0.08, `${id} thigh is level`);
        assert(j['ankle' + S][1] < 0.12, `${id} foot is on the floor`);
        for (const p of [kneePad(tpl, j, S).a, kneePad(tpl, j, S).b]) assert(dist(j['wrist' + S], p) > 0.15, `${id} hand is in a pad`);
      }
    }
  }
});

// ---------- cable hip moves ----------

test('cable hip moves: the cable runs from the ankle cuff to the low pulley, and the pulley sits on the tower', () => {
  for (const id of CABLES) {
    const tpl = tplOf(id);
    const tower = slabs(tpl)[0];
    for (const j of poses(tpl)) {
      const c = ankleCuff(tpl, j);
      assert(dist(c.centre, j.ankleN) > 0.05 && dist(c.centre, j.ankleN) < 0.09, `${id} cuff sits at the ankle`);
      assert(dist(c.a, c.b) > 0.1, `${id} cuff has width`);
      eq(c.pulley.join(), tpl.cuff.pulley.join(), `${id} cable ends at the pulley`);
      assert(c.pulley[1] < 0.3, `${id} pulley is low`);
      assert(Math.abs(c.pulley[2] - tower.z) < tower.w / 2 + 0.01 && Math.abs(c.pulley[2] - tower.z) > tower.w / 2 - 0.2, `${id} pulley is on the tower`);
      assert(c.centre[1] > 0.04, `${id} cable starts above the floor`);
      assert(dist(c.centre, c.pulley) > 0.3, `${id} cable has length`);
    }
  }
});

test('cable hip moves: abduction pulls the leg out against a cable from the far side; adduction sweeps it across from its own side', () => {
  const ab = tplOf('cable_hip_abduction');
  const ad = tplOf('cable_hip_adduction');
  const a0 = solve(ab, ab.a);
  const a1 = solve(ab, ab.b);
  assert(Math.abs(a1.ankleN[2]) - Math.abs(a0.ankleN[2]) > 0.35, 'abduction: the leg moves out to the side');
  assert(Math.sign(ab.cuff.pulley[2]) !== Math.sign(a1.ankleN[2]), 'abduction: the pulley is on the other side, so the cable resists the move');
  assert(a1.ankleN[1] > a0.ankleN[1] + 0.1, 'abduction: the foot lifts');
  const d0 = solve(ad, ad.a);
  const d1 = solve(ad, ad.b);
  assert(Math.abs(d0.ankleN[2]) - Math.abs(d1.ankleN[2]) > 0.25, 'adduction: the leg moves in toward the midline');
  assert(Math.sign(ad.cuff.pulley[2]) === Math.sign(d0.ankleN[2]), 'adduction: the pulley is on the working leg\'s own side');
  assert(d1.ankleN[2] > -0.05, 'adduction: the leg reaches across the standing leg');
  // The working leg swings across in front of the standing leg: far enough forward that the feet never overlap.
  for (const j of poses(ad)) {
    const gapX = j.toeF[0] - j.heelN[0];
    assert(j.ankleN[2] < j.ankleF[2] - 0.02 || j.heelN[0] > j.toeF[0] + 0.03, `adduction: the swinging foot clears the standing foot (${gapX.toFixed(2)})`);
  }
  // The standing leg stays planted.
  for (const tpl of [ab, ad]) for (const j of poses(tpl)) assert(j.ankleF[1] < 0.09 && j.toeF[1] > -0.03, 'standing foot is on the floor');
});

test('gym figures: no body point passes through the seat, back pad, rails or tower', () => {
  for (const [name, tpl] of Object.entries(GYM)) {
    for (const j of poses(tpl)) {
      for (const e of slabs(tpl)) {
        for (const key of BODY_POINTS) {
          // The pelvis sinks a little into the soft seat pad; nothing else may be inside any block.
          const slack = key === 'pelvis' ? 0.06 : 0;
          assert(!insideSlab(j[key], e, slack), `${name} ${key} is inside a block at ${j[key].map((x) => x.toFixed(2))}`);
        }
      }
    }
  }
});

test('gym figures: library coverage — all seven machine and cable moves are mapped', () => {
  for (const id of BRIEF.filter((x) => !SKIPPED.includes(x))) assert(EXERCISE_TEMPLATES[id], `${id} is mapped`);
  for (const id of SKIPPED) assert(!EXERCISE_TEMPLATES[id], `${id} is skipped`);
});
