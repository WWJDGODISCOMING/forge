// v0.14.4 demo figures for the cardio machines, the jump rope and the boxing moves (js/ui/poses-cardio.js).
// Synthetic only: the poses are checked as joint positions, so a foot that floats or a punch that goes through the bag fails here.
import { test, eq, assert } from './harness.js';
import { solve, dist, repPhases, repLength, paramsAt, camera, frameBox, propParts, drawOrder, cardioProps, primPoints, BODY } from '../js/ui/rig.js';
import { TEMPLATES, EXERCISE_TEMPLATES } from '../js/ui/poses.js';
import * as C from '../js/ui/poses-cardio.js';
import { EXERCISES } from '../js/workouts/exercises.js';

const { CARDIO, CARDIO_MAP } = C;

// Every move the v0.14.4 brief lists (issue #52). The last four are the optional ones; they stay unmapped because they would not read clearly.
const BRIEF = [
  'treadmill_incline_walk', 'bike_steady', 'bike_intervals', 'rower_intervals', 'stair_climber', 'elliptical',
  'jump_rope', 'jump_rope_double_under', 'shadowboxing', 'db_shadowboxing', 'boxing_footwork', 'heavy_bag_rounds',
  'slip_and_roll', 'muscleup', 'muscleup_transition', 'mb_rotational_throw',
];
const SKIPPED = ['slip_and_roll', 'muscleup', 'muscleup_transition', 'mb_rotational_throw'];
const MAPPED = BRIEF.filter((x) => !SKIPPED.includes(x));
const MACHINES = ['treadmill_incline_walk', 'bike_steady', 'bike_intervals', 'rower_intervals', 'stair_climber', 'elliptical'];
const ROPES = ['jump_rope', 'jump_rope_double_under'];
const BOXING = ['shadowboxing', 'db_shadowboxing', 'boxing_footwork', 'heavy_bag_rounds'];

const SAMPLES = 36;
const phases = (tpl) => repPhases(tpl.tempo, tpl.first);
const poses = (tpl, n = SAMPLES) => {
  const ph = phases(tpl);
  const T = repLength(ph);
  return Array.from({ length: n }, (_, k) => solve(tpl, paramsAt(tpl, ph, (T * k) / n)));
};
/** Frames at exact cycle angles. */
const at = (tpl, angles) => angles.map((ph) => solve(tpl, { ph }));
const tplOf = (id) => TEMPLATES[EXERCISE_TEMPLATES[id]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const distToSegment = (p, a, b) => {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
};
const BODY_POINTS = ['pelvis', 'chest', 'head', 'elbowN', 'elbowF', 'wristN', 'wristF', 'kneeN', 'kneeF', 'ankleN', 'ankleF', 'toeN', 'toeF', 'heelN', 'heelF'];
const near = (a, b, tol) => dist(a, b) <= tol;
const rad = (d) => (d * Math.PI) / 180;
const SIDES = ['N', 'F'];

test('cardio figures: every id in the brief has a template, or is listed as skipped', () => {
  for (const id of MAPPED) {
    assert(EXERCISES.some((e) => e.id === id), `${id} is a real exercise`);
    assert(EXERCISE_TEMPLATES[id], `${id} has a template`);
    assert(CARDIO[EXERCISE_TEMPLATES[id]], `${id} is drawn from poses-cardio.js`);
  }
  eq(Object.keys(CARDIO_MAP).sort().join(), MAPPED.slice().sort().join(), 'the map holds exactly the brief, minus the skipped');
  for (const id of SKIPPED) {
    assert(EXERCISES.some((e) => e.id === id), `${id} is a real exercise`);
    assert(!EXERCISE_TEMPLATES[id], `${id} stays unmapped`);
  }
  eq(new Set(Object.values(CARDIO_MAP)).size, Object.keys(CARDIO_MAP).length - 0, 'one template per id');
});

test('cardio figures: every number is finite, every frame solves, frames and orders', () => {
  for (const [name, tpl] of Object.entries(CARDIO)) {
    for (const k of ['a', 'm', 'b']) for (const [p, v] of Object.entries(tpl[k] || {})) assert(Number.isFinite(v), `${name}.${k}.${p} is ${v}`);
    for (const p of Object.keys(tpl.a)) assert(p in tpl.b, `${name}.a.${p} has an end value (the thumbnail draws b alone)`);
    const ph = phases(tpl);
    assert(repLength(ph) > 0.5 && repLength(ph) < 4, `${name} cycle length`);
    for (const j of [...poses(tpl, 72), solve(tpl, tpl.a), solve(tpl, tpl.b)]) {
      for (const [p, v] of Object.entries(j)) if (Array.isArray(v)) assert(v.every(Number.isFinite), `${name} ${p}`);
      for (const k of Object.keys(j.P)) assert(Number.isFinite(j.P[k]), `${name} drive ${k}`);
      if (tpl.prims) for (const q of [...cardioProps(tpl, j).back, ...cardioProps(tpl, j).front]) for (const pt of primPoints(q)) assert(pt.length === 3 && pt.every(Number.isFinite), `${name} prim point`);
    }
    assert(frameBox(tpl, camera(tpl.cam), ph).every(Number.isFinite), `${name} frame`);
    assert(drawOrder(tpl, solve(tpl, tpl.a), camera(tpl.cam)).length >= 17, `${name} draw order`);
  }
});

test('cardio figures: the cycle is steady and loops without a jump', () => {
  for (const [name, tpl] of Object.entries(CARDIO)) {
    const ph = phases(tpl);
    const T = repLength(ph);
    assert(tpl.cycle && tpl.tempo.lin, `${name} runs at a steady speed`);
    const first = solve(tpl, paramsAt(tpl, ph, 0));
    const last = solve(tpl, paramsAt(tpl, ph, T - 1e-6));
    for (const k of ['pelvis', 'chest', 'ankleN', 'ankleF', 'wristN', 'wristF', 'kneeN', 'kneeF']) assert(dist(first[k], last[k]) < 0.01, `${name} ${k} jumps ${dist(first[k], last[k]).toFixed(4)} m at the loop`);
    // Speed is even: the same step in cycle angle moves the pelvis about the same everywhere (no stop-start at the ends).
    const mid = solve(tpl, paramsAt(tpl, ph, T * 0.5));
    assert(mid.P.ph - tpl.a.ph > 150 && mid.P.ph - tpl.a.ph < 210, `${name} halfway through the time is halfway round (${mid.P.ph - tpl.a.ph})`);
  }
});

test('cardio figures: cameras — side view for the machines, 3/4 front for the rope and the boxing', () => {
  for (const id of MACHINES) assert(tplOf(id).cam.yaw <= 30, `${id} yaw ${tplOf(id).cam.yaw}`);
  for (const id of BOXING) assert(tplOf(id).cam.yaw >= 30 && tplOf(id).cam.yaw <= 60, `${id} yaw ${tplOf(id).cam.yaw}`);
  for (const id of ROPES) assert(tplOf(id).cam.yaw >= 85 && tplOf(id).cam.yaw <= 95, `${id} is seen from the front (yaw ${tplOf(id).cam.yaw})`);
});

test('cardio figures: nothing goes through the floor', () => {
  for (const [name, tpl] of Object.entries(CARDIO)) {
    for (const j of poses(tpl, 72)) {
      for (const key of BODY_POINTS) assert(j[key][1] > -0.03, `${name} ${key} at y=${j[key][1].toFixed(3)}`);
      for (const key of ['ankleN', 'ankleF']) assert(j[key][1] > 0.05, `${name} ${key} at y=${j[key][1].toFixed(3)}`);
      for (const q of [...cardioProps(tpl, j).back, ...cardioProps(tpl, j).front]) if (q.k === 'line' && tpl !== CARDIO.jump_rope) for (const pt of primPoints(q)) assert(pt[1] > -0.001, `${name} a machine line is under the floor`);
    }
  }
});

test('cardio figures: the machines and the bag draw props; legs never lock and never overreach', () => {
  for (const id of [...MACHINES, ...ROPES, 'heavy_bag_rounds']) assert(propParts(tplOf(id)).includes('cardioB') && propParts(tplOf(id)).includes('cardioF'), `${id} has machine props`);
  for (const id of ['shadowboxing', 'boxing_footwork']) assert(!propParts(tplOf(id)).includes('cardioB'), `${id} has no machine`);
  assert(propParts(tplOf('db_shadowboxing')).includes('dbNin') === false, 'db shadowboxing takes its dumbbells from the exercise load');
  for (const [name, tpl] of Object.entries(CARDIO)) {
    for (const j of poses(tpl, 72)) {
      for (const S of SIDES) {
        const d = dist(j['hip' + S], j['ankle' + S]);
        assert(d < 0.875, `${name} leg ${S} is stretched (${d.toFixed(3)})`);
        assert(dist(j['hip' + S], j['knee' + S]) > 0.449 && dist(j['hip' + S], j['knee' + S]) < 0.451, `${name} thigh length`);
      }
    }
  }
});

// ---------- treadmill ----------

test('treadmill: both feet follow the belt (stance on it, swing just above it), one foot is always down, and the sole lies flat on the incline', () => {
  const tpl = tplOf('treadmill_incline_walk');
  let stanceFrames = 0;
  for (const j of poses(tpl, 72)) {
    for (const S of SIDES) {
      eq(near(j['ankle' + S], C.tmAnkle(j.P.ph, S), 0.004), true, `treadmill ankle ${S} is where the belt puts it`);
      for (const key of ['heel', 'toe']) {
        const p = j[key + S];
        const gap = (p[1] - C.tmSurfaceY(p[0])) * Math.cos(rad(C.TM.th));
        assert(gap > -0.004, `treadmill ${key}${S} is ${gap.toFixed(3)} m into the belt`);
        assert(p[0] > C.TM.s0 && p[0] < C.TM.s1, 'foot is over the belt');
      }
    }
    const down = SIDES.filter((S) => ['heel', 'toe'].every((key) => (j[key + S][1] - C.tmSurfaceY(j[key + S][0])) * Math.cos(rad(C.TM.th)) < 0.006));
    assert(down.length >= 1, 'a foot is on the belt');
    if (down.length) stanceFrames++;
  }
  eq(stanceFrames, 72, 'a foot is on the belt in every frame');
});

test('treadmill: walking cycle — the feet swap, the stance foot runs backward at the belt speed, the pelvis bobs a little and the legs stay bent', () => {
  const tpl = tplOf('treadmill_incline_walk');
  const f = (ph, S) => C.tmFoot(ph, S);
  assert(f(90, 'N').stance && !f(90, 'F').stance, 'one foot on, one swinging');
  assert(!f(270, 'N').stance && f(270, 'F').stance, 'then they swap');
  assert(f(10, 'N').s > f(170, 'N').s + 0.4, 'the stance foot goes backward along the belt');
  assert(f(270, 'N').h > 0.04, 'the swing foot clears the belt');
  const ys = poses(tpl, 72).map((j) => j.pelvis[1] - C.tmSurfaceY(j.pelvis[0]));
  assert(Math.max(...ys) - Math.min(...ys) > 0.02 && Math.max(...ys) - Math.min(...ys) < 0.07, 'a small bob');
  for (const j of poses(tpl, 72)) for (const S of SIDES) assert(dist(j['hip' + S], j['ankle' + S]) < 0.88, 'the leg never over-reaches');
});

test('treadmill: it reads as a walk — the stance leg is nearly straight at mid-stance, and the walker never sits back into a squat', () => {
  const tpl = tplOf('treadmill_incline_walk');
  const knee = (j, S) => {
    const u = sub(j['hip' + S], j['knee' + S]);
    const v = sub(j['ankle' + S], j['knee' + S]);
    return (Math.acos(dot(u, v) / Math.hypot(...u) / Math.hypot(...v)) * 180) / Math.PI;
  };
  // Near foot mid-stance at 90°, far foot at 270°.
  for (const [ph, S, other] of [[90, 'N', 'F'], [270, 'F', 'N']]) {
    const j = at(tpl, [ph])[0];
    assert(knee(j, S) >= 160, `stance knee ${S} is ${knee(j, S).toFixed(0)}° at mid-stance`);
    assert(knee(j, other) > 125 && knee(j, other) < knee(j, S), `swing knee ${other} is bent more (${knee(j, other).toFixed(0)}°)`);
  }
  for (const j of poses(tpl, 72)) for (const S of SIDES) assert(knee(j, S) >= 135, `knee ${S} is ${knee(j, S).toFixed(0)}° — too deep for a walk`);
});

test('treadmill: an upright with handrails; the hands stay on the rails', () => {
  const tpl = tplOf('treadmill_incline_walk');
  for (const j of poses(tpl, 72)) {
    for (const S of SIDES) {
      const z = (S === 'N' ? -1 : 1) * C.TM.rail.z;
      const grip = j['grip' + S];
      assert(distToSegment(grip, [C.TM.rail.x0, C.TM.rail.y, z], [C.TM.rail.x1, C.TM.rail.y, z]) < 0.01, `treadmill hand ${S} is on the rail`);
      assert(dist(j['wrist' + S], grip) < BODY.hand * 0.55 + 0.01, `treadmill arm ${S} reaches the rail (${dist(j['wrist' + S], grip).toFixed(3)})`);
    }
  }
  const j = solve(tpl, tpl.a);
  const rails = cardioProps(tpl, j).back.filter((q) => q.k === 'curve');
  eq(rails.length, 2, 'a rail each side');
  assert(cardioProps(tpl, j).back.some((q) => q.k === 'line' && q.a[1] > 1.4), 'an upright with a console');
});

// ---------- bike ----------

test('bike: the feet stay on the pedals, which go round a circle around the crank; the ball of the foot is over the axle', () => {
  for (const id of ['bike_steady', 'bike_intervals']) {
    const tpl = tplOf(id);
    for (const j of poses(tpl, 72)) {
      for (const S of SIDES) {
        const p = C.bikePedal(j.P.ph, S);
        assert(Math.abs(dist([p[0], p[1], 0], [C.BIKE.bb[0], C.BIKE.bb[1], 0]) - C.BIKE.crank) < 1e-9, `${id} pedal ${S} is on the circle`);
        const ball = [0, 1, 2].map((i) => j['heel' + S][i] + (j['toe' + S][i] - j['heel' + S][i]) * 0.62);
        assert(Math.abs(ball[0] - p[0]) < 0.012, `${id} ball of foot ${S} is ${(ball[0] - p[0]).toFixed(3)} m off the pedal`);
        for (const key of ['heel', 'toe']) {
          const gap = j[key + S][1] - (p[1] + 0.015);
          assert(gap > -0.004 && gap < 0.004, `${id} ${key}${S} is ${gap.toFixed(3)} m from the pedal top`);
          assert(Math.abs(j[key + S][0] - p[0]) < 0.2, 'foot is over the pedal');
        }
        assert(Math.abs(j['ankle' + S][2] - p[2]) < 1e-9, 'foot is in line with its pedal');
      }
      // The two pedals are opposite each other.
      assert(near([C.bikePedal(j.P.ph, 'N')[0], C.bikePedal(j.P.ph, 'N')[1], 0], [2 * C.BIKE.bb[0] - C.bikePedal(j.P.ph, 'F')[0], 2 * C.BIKE.bb[1] - C.bikePedal(j.P.ph, 'F')[1], 0], 1e-9), 'pedals opposite');
    }
    // The top of the circle moves forward: a full turn per cycle, clockwise seen from the right.
    assert(C.bikePedal(0, 'N')[1] > C.bikePedal(45, 'N')[1] - 1e-9 && C.bikePedal(45, 'N')[0] > C.bikePedal(0, 'N')[0], `${id} the top pedal moves forward`);
  }
});

test('bike: the body sits on the seat, the hands are on the handlebars, the knees never reach the bars', () => {
  for (const id of ['bike_steady', 'bike_intervals']) {
    const tpl = tplOf(id);
    for (const j of poses(tpl, 72)) {
      const gap = j.pelvis[1] - C.BIKE.seat.y;
      assert(gap > 0.05 && gap < 0.14, `${id} pelvis is ${gap.toFixed(3)} above the seat`);
      assert(j.pelvis[0] > C.BIKE.seat.x0 && j.pelvis[0] < C.BIKE.seat.x1, `${id} pelvis is over the seat`);
      for (const S of SIDES) {
        const g = [C.BIKE.grip[0], C.BIKE.grip[1], (S === 'N' ? -1 : 1) * C.BIKE.grip[2]];
        assert(near(j['grip' + S], g, 1e-9), `${id} grip ${S} on the bar`);
        assert(dist(j['wrist' + S], j['grip' + S]) < BODY.hand * 0.55 + 0.01, `${id} arm ${S} reaches the bar (${dist(j['wrist' + S], j['grip' + S]).toFixed(3)})`);
        assert(dist(j['knee' + S], g) > 0.2, `${id} knee ${S} hits the bars`);
      }
    }
  }
});

test('bike: intervals use the same bike but look faster — a bigger lean and a quicker cadence', () => {
  const a = tplOf('bike_steady');
  const b = tplOf('bike_intervals');
  assert(a !== b && b.prims === a.prims && b.rig.hands.x === a.rig.hands.x, 'one bike');
  const lean = (tpl) => solve(tpl, tpl.a).P.trunk;
  assert(lean(b) - lean(a) >= 12, `lean ${lean(a)} → ${lean(b)}`);
  assert(repLength(phases(b)) < repLength(phases(a)) * 0.7, 'a faster cadence');
});

// ---------- rower ----------

test('rower: the feet stay on the footplates in every frame, flat on the plate', () => {
  const tpl = tplOf('rower_intervals');
  const pl = C.rowPlate();
  const first = solve(tpl, tpl.a);
  for (const j of poses(tpl, 72)) {
    for (const S of SIDES) {
      for (const key of ['heel', 'toe']) {
        const off = (j[key + S][0] - pl.p0[0]) * pl.n[0] + (j[key + S][1] - pl.p0[1]) * pl.n[1];
        const along = (j[key + S][0] - pl.p0[0]) * pl.u[0] + (j[key + S][1] - pl.p0[1]) * pl.u[1];
        assert(Math.abs(off) < 0.004, `rower ${key}${S} is ${off.toFixed(3)} m off the plate`);
        assert(along > -0.12 && along < 0.26, `rower ${key}${S} is on the plate (${along.toFixed(2)})`);
      }
      assert(dist(j['ankle' + S], first['ankle' + S]) < 1e-9, 'the feet are strapped in and do not move');
    }
  }
});

test('rower: the body sits on the sliding seat (on the rail), the knees clear the chest', () => {
  const tpl = tplOf('rower_intervals');
  for (const j of poses(tpl, 72)) {
    const gap = j.pelvis[1] - C.ROW.seatY;
    assert(gap > 0.05 && gap < 0.14, `rower pelvis is ${gap.toFixed(3)} above the seat`);
    const seat = cardioProps(tpl, j).back.find((q) => q.k === 'line' && q.c === '#2A3F54');
    assert(seat && Math.abs((seat.a[0] + seat.b[0]) / 2 - j.pelvis[0]) < 1e-9, 'the seat is under the pelvis');
    assert(seat.a[0] > -0.95 && seat.b[0] < 0.98, 'the seat rides the rail');
    for (const S of SIDES) {
      assert(distToSegment(j['knee' + S], j.pelvis, j.chest) > 0.15, `rower knee ${S} is in the chest (${distToSegment(j['knee' + S], j.pelvis, j.chest).toFixed(2)})`);
      assert(j['knee' + S][1] > ROW_RAIL + 0.1, 'knee above the rail');
    }
  }
});
const ROW_RAIL = C.ROW.railY;

test('rower: catch → drive → finish → recovery — legs push first, then the back opens, then the arms pull; and back the other way', () => {
  const tpl = tplOf('rower_intervals');
  const s = (ph) => C.rowStage(ph);
  const [catchJ, driveJ, finishJ, recoveryJ] = at(tpl, [0, 60, 130, 250]);
  assert(catchJ.pelvis[0] > driveJ.pelvis[0] && driveJ.pelvis[0] > finishJ.pelvis[0], 'the seat slides back in the drive');
  assert(recoveryJ.pelvis[0] > finishJ.pelvis[0] && recoveryJ.pelvis[0] < catchJ.pelvis[0], 'and forward in the recovery');
  assert(s(60).seat < 0.65 && s(60).lean > 5 && s(60).bend < 0.05, 'drive: legs push, back still forward, arms straight');
  assert(s(110).lean < s(60).lean - 15 && s(110).bend > 0 && s(110).bend < 0.9, 'then the back opens and the arms start to pull');
  assert(s(130).bend > 0.99 && s(130).lean < -20 && s(130).seat < 0.01, 'finish: handle in, leaning back, legs flat');
  assert(s(185).bend < 0.01 && s(185).lean < -15 && s(185).seat < 0.01, 'recovery: arms go away first');
  assert(s(230).lean > -10 && s(230).seat < 0.2, 'then the body swings over');
  assert(s(300).seat > 0.4 && s(300).lean > 15, 'then the seat comes forward');
  assert(s(0).seat === 1 && s(0).bend === 0 && Math.abs(s(360).lean - s(0).lean) < 1e-9, 'catch');
  // Legs: bent at the catch, nearly straight (not locked) at the finish.
  assert(dist(catchJ.hipN, catchJ.ankleN) < 0.6 && dist(finishJ.hipN, finishJ.ankleN) > 0.8 && dist(finishJ.hipN, finishJ.ankleN) < 0.87, 'legs compress and extend');
  // Handle: out over the knees at the catch, in at the lower ribs at the finish.
  const mid = (j) => [(j.gripN[0] + j.gripF[0]) / 2, (j.gripN[1] + j.gripF[1]) / 2];
  assert(mid(catchJ)[0] > catchJ.kneeN[0] - 0.1, 'catch: the handle is out past the knees');
  assert(mid(finishJ)[0] < finishJ.pelvis[0] + 0.3 && mid(finishJ)[1] > finishJ.pelvis[1] + 0.05 && mid(finishJ)[1] < finishJ.chest[1] - 0.15, 'finish: the handle is at the lower ribs');
});

test('rower: the hands stay on the handle, which is on a chain to the flywheel', () => {
  const tpl = tplOf('rower_intervals');
  for (const j of poses(tpl, 72)) {
    for (const S of SIDES) assert(dist(j['wrist' + S], j['grip' + S]) < BODY.hand * 0.55 + 0.01, `rower arm ${S} reaches the handle (${dist(j['wrist' + S], j['grip' + S]).toFixed(3)})`);
    const lines = cardioProps(tpl, j).back.filter((q) => q.k === 'line');
    const handle = lines.find((q) => q.c === '#3EC8F0');
    assert(near(handle.a, j.gripN, 1e-9) && near(handle.b, j.gripF, 1e-9), 'the handle is between the hands');
    const chain = lines.find((q) => q.c === '#9AA1AB' && q.b[0] === C.ROW.chainEnd[0]);
    assert(chain && near(chain.b, [...C.ROW.chainEnd, 0], 1e-9), 'the chain ends at the flywheel');
    const fw = cardioProps(tpl, j).back.find((q) => q.k === 'circle' && q.r === C.ROW.fwR);
    assert(dist([C.ROW.chainEnd[0], C.ROW.chainEnd[1], 0], fw.c) <= fw.r + 1e-9, 'on the flywheel housing');
    assert(chain.a[0] < chain.b[0] - 0.02, 'the chain runs forward from the hands');
  }
});

// ---------- stair climber ----------

test('stair climber: both feet stay on the steps, which go up and down in turn; the hands stay on the rails', () => {
  const tpl = tplOf('stair_climber');
  const tops = [];
  for (const j of poses(tpl, 72)) {
    for (const S of SIDES) {
      const y = C.stairTop(j.P.ph, S);
      for (const key of ['heel', 'toe']) {
        const gap = j[key + S][1] - y;
        assert(gap > -0.004 && gap < 0.004, `stairs ${key}${S} is ${gap.toFixed(3)} m from the step`);
        assert(j[key + S][0] > C.STAIR.x - C.STAIR.half && j[key + S][0] < C.STAIR.x + C.STAIR.half, `stairs ${key}${S} is on the step`);
      }
      const z = (S === 'N' ? -1 : 1) * C.STAIR.rail.z;
      assert(distToSegment(j['grip' + S], [C.STAIR.rail.x0, C.STAIR.rail.y, z], [C.STAIR.rail.x1, C.STAIR.rail.y, z]) < 0.01, 'hand on the rail');
      assert(dist(j['wrist' + S], j['grip' + S]) < BODY.hand * 0.55 + 0.01, `stairs arm ${S} reaches the rail`);
    }
    tops.push(C.stairTop(j.P.ph, 'N') - C.stairTop(j.P.ph, 'F'));
  }
  assert(Math.max(...tops) > 0.2 && Math.min(...tops) < -0.2, 'one step is up while the other is down, then they swap');
  const up = solve(tpl, tpl.b);
  assert(dist(up.hipN, up.ankleN) < dist(up.hipF, up.ankleF) - 0.15, 'the foot on the high step has its knee bent, the other leg pushes');
});

// ---------- elliptical ----------

test('elliptical: the feet stay on the plates, which travel an ellipse; the plates swap ends', () => {
  const tpl = tplOf('elliptical');
  const xs = [];
  for (const j of poses(tpl, 72)) {
    for (const S of SIDES) {
      const p = C.ellPlate(j.P.ph, S);
      for (const key of ['heel', 'toe']) {
        const gap = j[key + S][1] - (p[1] + 0.015);
        assert(gap > -0.004 && gap < 0.004, `elliptical ${key}${S} is ${gap.toFixed(3)} m from the plate`);
        assert(Math.abs(j[key + S][0] - p[0]) < C.ELL.plateHalf, `elliptical ${key}${S} is over the plate`);
      }
      // On the ellipse (undo the tilt).
      const dx = p[0] - C.ELL.c[0];
      const dy = p[1] - C.ELL.c[1];
      const lx = dx * Math.cos(rad(C.ELL.th)) + dy * Math.sin(rad(C.ELL.th));
      const ly = -dx * Math.sin(rad(C.ELL.th)) + dy * Math.cos(rad(C.ELL.th));
      assert(Math.abs((lx / C.ELL.a) ** 2 + (ly / C.ELL.b) ** 2 - 1) < 1e-9, 'plate is on its ellipse');
    }
    xs.push(C.ellPlate(j.P.ph, 'N')[0] - C.ellPlate(j.P.ph, 'F')[0]);
  }
  assert(Math.max(...xs) > 0.35 && Math.min(...xs) < -0.35, 'one foot forward while the other is back, then they swap');
});

test('elliptical: the handles swing about a pivot — back as the same-side foot goes forward — and the hands stay on them', () => {
  const tpl = tplOf('elliptical');
  const swing = [];
  for (const j of poses(tpl, 72)) {
    for (const S of SIDES) {
      const h = C.ellHandle(j.P.ph, S);
      assert(near(j['grip' + S], h.grip, 1e-9), 'hand on the grip');
      assert(dist(j['wrist' + S], j['grip' + S]) < BODY.hand * 0.55 + 0.01, `elliptical arm ${S} reaches the handle (${dist(j['wrist' + S], j['grip' + S]).toFixed(3)})`);
      assert(Math.abs(dist(h.grip, [C.ELL.piv[0], C.ELL.piv[1], h.grip[2]]) - C.ELL.handle) < 1e-9, 'the grip swings on a circle about the pivot');
      const p = C.ellPlate(j.P.ph, S);
      assert((h.grip[0] - C.ELL.piv[0]) * (p[0] - C.ELL.c[0]) <= 1e-9, `${S} handle goes back when its foot goes forward`);
    }
    swing.push(C.ellHandle(j.P.ph, 'N').grip[0]);
  }
  assert(Math.max(...swing) - Math.min(...swing) > 0.1, 'the handles really move');
});

// ---------- jump rope ----------

test('jump rope: a small hop with the rope arcing from the hands, passing under the feet in the air and over the head', () => {
  for (const id of ROPES) {
    const tpl = tplOf(id);
    const k = id === 'jump_rope' ? 1 : 2;
    const fs = poses(tpl, 144);
    const airs = fs.map((j) => j.P.air);
    assert(Math.min(...airs) < 0.002 && Math.max(...airs) > (k === 1 ? 0.08 : 0.15) && Math.max(...airs) < 0.25, `${id} a small hop (${Math.max(...airs).toFixed(2)})`);
    let under = 0;
    for (const j of fs) {
      const rope = C.ropePoints(j);
      assert(near(rope[0], j.gripN, 1e-9) && near(rope[rope.length - 1], j.gripF, 1e-9), `${id} the rope starts and ends in the hands`);
      assert(rope.every((p) => p[1] >= C.ROPE.floor - 1e-9), `${id} the rope is not under the floor`);
      // The rope never goes through the legs, trunk or head; it passes beneath the feet.
      const limbs = [['hipN', 'kneeN', 0.09], ['kneeN', 'ankleN', 0.06], ['hipF', 'kneeF', 0.09], ['kneeF', 'ankleF', 0.06], ['heelN', 'toeN', 0.04], ['heelF', 'toeF', 0.04], ['pelvis', 'chest', 0.14], ['neck', 'head', 0.12]];
      for (const [a, b, r] of limbs) for (const p of rope) assert(distToSegment(p, j[a], j[b]) > r + 0.005, `${id} the rope goes through ${a}-${b} at ψ=${(j.P.psi / rad(1)).toFixed(0)} (${distToSegment(p, j[a], j[b]).toFixed(3)})`);
      const psi = ((j.P.psi / rad(1)) % 360 + 360) % 360;
      if (psi < 8 || psi > 352) {
        under++;
        const lowestFoot = Math.min(j.toeN[1], j.toeF[1], j.heelN[1], j.heelF[1]);
        for (const p of rope.filter((q) => Math.abs(q[2]) < 0.17)) assert(p[1] < lowestFoot - 0.02, `${id} the rope is at the feet, not under them (${p[1].toFixed(3)} vs ${lowestFoot.toFixed(3)})`);
      }
    }
    assert(under > 0, `${id} the rope comes round under the feet`);
    // Over the head at the other end of the turn.
    const top = at(tpl, [0])[0];
    assert(Math.max(...C.ropePoints(top).map((p) => p[1])) > top.head[1] + 0.2, `${id} the rope goes over the head`);
  }
});

test('jump rope: the feet are in the air exactly when the rope passes under them; double-unders turn the rope twice in a higher hop', () => {
  const single = tplOf('jump_rope');
  const dbl = tplOf('jump_rope_double_under');
  for (const [tpl, k] of [[single, 1], [dbl, 2]]) {
    for (const ph of [0, 90, 180, 270]) {
      const j = solve(tpl, { ph });
      const psi = (((C.ropeAngle(ph, k)) % 360) + 360) % 360;
      if (psi === 0) assert(j.P.air > (k === 1 ? 0.07 : 0.04), `the feet are up when the rope is underneath at ph ${ph}`);
    }
  }
  assert(Math.abs(C.ropeAngle(359.999, 2) - C.ropeAngle(0, 2) - 720) < 0.01, 'two turns in one hop');
  assert(Math.abs(C.ropeAngle(359.999, 1) - C.ropeAngle(0, 1) - 360) < 0.01, 'one turn in one hop');
  assert(Math.abs(C.ropeAngle(90, 2)) < 1e-9 && Math.abs(C.ropeAngle(270, 2) - 360) < 1e-9, 'double-under: the rope passes under on the way up and again on the way down');
  assert(Math.max(...poses(dbl).map((j) => j.P.air)) > Math.max(...poses(single).map((j) => j.P.air)) + 0.03, 'double-unders hop higher');
  for (const tpl of [single, dbl]) for (const j of poses(tpl, 72)) assert(Math.min(j.toeN[1], j.toeF[1]) >= -0.001 && Math.min(j.toeN[1], j.toeF[1]) < j.P.air + 0.03, 'toes leave the floor with the hop');
  assert(dbl.rig.hands.x === single.rig.hands.x && repLength(phases(dbl)) > 0, 'same grip');
});

test('jump rope: seen from the front, the rope never sticks out sideways past the hands (no hula hoop)', () => {
  for (const id of ROPES) {
    const tpl = tplOf(id);
    const cam = camera({ ...tpl.cam, scale: 1, x: 0, ground: 0 }); // metres on screen
    for (const j of poses(tpl, 144)) {
      const hx = [cam(j.gripN)[0], cam(j.gripF)[0]];
      const lo = Math.min(...hx) - 0.04;
      const hi = Math.max(...hx) + 0.04;
      for (const p of C.ropePoints(j)) {
        const x = cam(p)[0];
        assert(x >= lo && x <= hi, `${id} the rope sticks out sideways at ψ=${(j.P.psi / rad(1)).toFixed(0)} (${x.toFixed(3)} vs hands ${lo.toFixed(3)}…${hi.toFixed(3)})`);
      }
    }
  }
});

test('jump rope: the hands are at the hips, wide apart, and stay with the rope ends', () => {
  for (const id of ROPES) {
    const tpl = tplOf(id);
    for (const j of poses(tpl, 72)) {
      for (const S of SIDES) {
        assert(Math.abs(Math.abs(j['grip' + S][2]) - C.ROPE.handZ) < 1e-9, 'hands out to the sides');
        assert(Math.abs(j['grip' + S][1] - (C.ROPE.handY + j.P.air)) < 0.05, 'hands at the hips');
        assert(dist(j['wrist' + S], j['grip' + S]) < BODY.hand * 0.55 + 0.01, `${id} arm ${S} reaches the handle`);
      }
    }
  }
});

// ---------- boxing ----------

const GUARD_FRAMES = [0, 100, 150, 300];
test('shadowboxing: a guard stance with alternating straight punches — jab with the lead hand, then cross with the rear hand', () => {
  for (const id of ['shadowboxing', 'db_shadowboxing']) {
    const tpl = tplOf(id);
    const [jab, cross, guard] = at(tpl, [C.BOX.jab, C.BOX.cross, 130]);
    const reach = (j, S) => j['grip' + S][0] - j['shoulder' + S][0];
    assert(reach(jab, 'F') > 0.5 && reach(jab, 'N') < 0.35, `${id} jab: lead hand out (${reach(jab, 'F').toFixed(2)}), rear hand home`);
    assert(reach(cross, 'N') > 0.5 && reach(cross, 'F') < 0.35, `${id} cross: rear hand out (${reach(cross, 'N').toFixed(2)}), lead hand home`);
    assert(reach(guard, 'F') < 0.35 && reach(guard, 'N') < 0.35, `${id} guard between punches`);
    // The punching arm is almost straight; the guard arm is bent with the hand up by the chin.
    assert(dist(jab.shoulderF, jab.wristF) > 0.5, `${id} straight jab`);
    assert(dist(guard.shoulderF, guard.wristF) < 0.4 && guard.wristF[1] > guard.chest[1] - 0.15, `${id} guard hands up`);
    for (const j of poses(tpl, 72)) {
      for (const S of SIDES) {
        assert(dist(j['wrist' + S], j['grip' + S]) < BODY.hand * 0.55 + 0.01, `${id} arm ${S} reaches the target (${dist(j['wrist' + S], j['grip' + S]).toFixed(3)})`);
        assert(j['grip' + S][1] > j.chest[1] - 0.3 && j['grip' + S][1] < j.head[1] + 0.05, `${id} hands stay between the belt and the head`);
      }
    }
    // Stance: lead foot (far side) forward, rear foot back with the heel up, both on the floor.
    for (const j of GUARD_FRAMES.map((ph) => solve(tpl, { ph }))) {
      assert(j.ankleF[0] - j.ankleN[0] > 0.35, `${id} staggered stance`);
      assert(j.toeN[1] > -0.03 && j.toeF[1] > -0.03 && j.toeN[1] < 0.03 && j.toeF[1] < 0.03, `${id} feet planted`);
    }
    assert(Math.min(...poses(tpl, 72).map((j) => j.heelN[1] - j.toeN[1])) > 0.02, `${id} rear heel is up`);
  }
});

test('shadowboxing: the punches alternate in time — never both at once', () => {
  const tpl = tplOf('shadowboxing');
  let jabs = 0;
  let crosses = 0;
  for (const j of poses(tpl, 144)) {
    const f = j.gripF[0] - j.shoulderF[0] > 0.5;
    const n = j.gripN[0] - j.shoulderN[0] > 0.5;
    assert(!(f && n), 'one hand at a time');
    if (f) jabs++;
    if (n) crosses++;
  }
  assert(jabs > 4 && crosses > 4 && Math.abs(jabs - crosses) <= 2, `both hands punch (${jabs}, ${crosses})`);
});

test('db shadowboxing: the same punches with a small dumbbell in each hand', () => {
  const plain = tplOf('shadowboxing');
  const db = tplOf('db_shadowboxing');
  eq(db.both, true, 'both hands hold one');
  assert(plain !== db && db.drive === db.drive && Math.abs(solve(db, { ph: 40 }).gripF[0] - solve(plain, { ph: 40 }).gripF[0]) < 1e-9, 'same motion');
  assert(!plain.both, 'plain shadowboxing holds nothing');
  const ex = EXERCISES.find((e) => e.id === 'db_shadowboxing');
  eq(ex.load, 'dumbbell', 'the exercise says dumbbell, so the figure draws them');
  const parts = propParts({ ...db, load: ex.load });
  assert(['dbNin', 'dbNout', 'dbFin', 'dbFout'].every((p) => parts.includes(p)), 'a dumbbell in each hand');
});

test('boxing footwork: guard stance, step in (lead foot, then rear), step out (rear foot, then lead); one foot always on the floor', () => {
  const tpl = tplOf('boxing_footwork');
  const fs = poses(tpl, 144);
  let moved = 0;
  for (const j of fs) {
    const st = C.stepPlan(j.P.ph);
    assert(Math.abs(j.ankleF[0] - st.lead) < 0.004 && Math.abs(j.ankleN[0] - st.rear) < 0.004, 'feet where the plan puts them');
    assert(j.toeN[1] > -0.03 && j.toeF[1] > -0.03, 'feet do not go through the floor');
    assert(Math.min(j.toeN[1], j.toeF[1]) < 0.02, 'one foot is on the floor');
    assert(Math.abs(j.pelvis[0] - (st.lead + st.rear) / 2) < 1e-9, 'the body travels between the feet');
    assert(st.lead - st.rear > 0.4 && st.lead - st.rear < 0.64, 'the stance stays staggered, never a split');
    for (const S of SIDES) assert(dist(j['wrist' + S], j['grip' + S]) < BODY.hand * 0.55 + 0.01, 'guard hands reach their guard');
    if (Math.abs(j.pelvis[0]) > 0.05) moved++;
  }
  assert(moved > 20, 'the whole body moves in');
  const p = (ph) => C.stepPlan(ph);
  assert(p(30).lead > p(0).lead + 0.05 && p(30).rear === p(0).rear, 'step in: the lead foot first');
  assert(p(85).rear > p(55).rear + 0.05 && p(85).lead > BOX_LEAD + 0.15, 'then the rear foot follows');
  assert(p(205).rear < p(180).rear - 0.05 && p(205).lead === p(180).lead, 'step out: the rear foot first');
  assert(p(262).lead < p(235).lead - 0.05 && p(300).rear < BOX_REAR + 0.01, 'then the lead foot, back where it started');
  assert(p(0).lead === BOX_LEAD && Math.abs(p(360).lead - BOX_LEAD) < 1e-9 && Math.abs(p(360).rear - BOX_REAR) < 1e-9, 'a loop');
  assert(p(30).leadLift > 0.03 && p(30).rearLift === 0 && p(85).rearLift > 0.03 && p(85).leadLift === 0, 'only the moving foot lifts');
});
const BOX_LEAD = C.BOX.lead;
const BOX_REAR = C.BOX.rear;

test('heavy bag: a bag hangs from a chain; the punches reach it and never go through it', () => {
  const tpl = tplOf('heavy_bag_rounds');
  let touched = 0;
  const frames = [...poses(tpl, 144), ...at(tpl, [C.BOX.jab, C.BOX.cross, C.BOX.jab + 5, C.BOX.cross + 5])];
  for (const j of frames) {
    const m = j.P.ph;
    for (const S of SIDES) {
      const z = j['handTip' + S][2];
      const face = C.bagFace(m, z);
      const tip = j['handTip' + S][0];
      assert(tip < face + 0.012, `bag: the ${S} fist is ${(tip - face).toFixed(3)} m inside the bag at ph ${m.toFixed(0)}`);
      assert(j['wrist' + S][0] < face && j['elbow' + S][0] < face, 'bag: no wrist or elbow inside the bag');
      if (tip > face - 0.02) touched++;
    }
    // Head and body stay well clear of it.
    for (const key of ['head', 'chest', 'pelvis', 'kneeF']) assert(j[key][0] + 0.12 < C.bagFace(m, 0), `bag: ${key} stays clear`);
  }
  assert(touched >= 4, `the fists land on the bag (${touched})`);
  for (const [ph, S] of [[C.BOX.jab, 'F'], [C.BOX.cross, 'N']]) {
    const j = solve(tpl, { ph });
    assert(Math.abs(j['handTip' + S][0] - C.bagFace(ph, j['handTip' + S][2])) < 0.02, `${S} punch lands on the bag (${(j['handTip' + S][0] - C.bagFace(ph, j['handTip' + S][2])).toFixed(3)})`);
    assert(j['handTip' + S][1] > C.BAG.y0 && j['handTip' + S][1] < C.BAG.y1 + C.BAG.r, 'at bag height');
  }
  // The bag hangs from a chain and sways only after it has been hit.
  const swing = (ph) => C.bagSwing(ph);
  eq(swing(C.BOX.jab), 0, 'still when the jab lands');
  assert(swing(C.BOX.jab + 60) > 0.03 && swing(C.BOX.cross + 60) > 0.04, 'it swings away');
  eq(swing(0), 0, 'and settles between rounds');
  const j = solve(tpl, tpl.b);
  const lines = cardioProps(tpl, j).back.filter((q) => q.k === 'line');
  assert(lines.some((q) => q.a[1] === C.BAG.top && q.b[1] === C.BAG.top), 'a mount at the top');
  assert(lines.some((q) => q.c === '#6a5342' && Math.abs(q.w - 2 * C.BAG.r) < 1e-9), 'a bag');
  assert(lines.some((q) => q.c === '#9AA1AB' && q.a[1] === C.BAG.top && q.b[1] < C.BAG.y1 + C.BAG.r + 0.001), 'a chain from the mount to the bag');
  for (const jj of poses(tpl, 72)) assert(cardioProps(tpl, jj).back.find((q) => q.c === '#6a5342').a[1] > 0.5, 'the bag hangs clear of the floor');
});

test('cardio figures: no body point passes through a machine bar, rail, plate or step', () => {
  const JOINTS = ['pelvis', 'chest', 'head', 'elbowN', 'elbowF', 'kneeN', 'kneeF'];
  for (const [name, tpl] of Object.entries(CARDIO)) {
    if (!tpl.prims || tpl === CARDIO.jump_rope || tpl === CARDIO.jump_rope_double_under) continue;
    for (const j of poses(tpl, 72)) {
      const cp = cardioProps(tpl, j);
      for (const q of [...cp.back, ...cp.front]) {
        if (q.k !== 'line' || q.c === '#3EC8F0') continue;
        for (const key of JOINTS) {
          const slack = key === 'pelvis' && q.c === '#2A3F54' ? 0.04 : 0;
          assert(distToSegment(j[key], q.a, q.b) > q.w / 2 + slack, `${name} ${key} is inside a ${q.w} bar at ${j[key].map((x) => x.toFixed(2))}`);
        }
      }
    }
  }
});

test('cardio figures: library coverage — twelve ids mapped, the optional four are not', () => {
  for (const id of MAPPED) assert(EXERCISE_TEMPLATES[id], `${id} is mapped`);
  for (const id of SKIPPED) assert(!EXERCISE_TEMPLATES[id], `${id} is skipped`);
  eq(MAPPED.length, 12, 'twelve figures');
});

// A stand-in for the DOM, just enough for figure.js to mount a still frame.
const fakeNode = (tag) => ({
  tagName: tag, attrs: {}, children: [], dataset: {}, style: {}, isConnected: true,
  setAttribute(k, v) { this.attrs[k] = String(v); },
  appendChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); this.children.push(c); return c; },
  replaceChild(a, b) { this.children[this.children.indexOf(b)] = a; return b; },
  removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; },
  set innerHTML(v) { this.children = []; },
  get innerHTML() { return ''; },
});

test('cardio figures: figure.js draws the machine shapes — a still frame and the thumbnail mount for every id', async () => {
  const had = globalThis.document;
  globalThis.document = { createElementNS: (ns, t) => fakeNode(t), createElement: fakeNode };
  try {
    const { mountFigure } = await import('../js/ui/figure.js');
    for (const id of MAPPED) {
      const ex = EXERCISES.find((e) => e.id === id);
      for (const at of [0.3, 1.1, 'hard']) {
        const box = fakeNode('div');
        assert(mountFigure(box, ex, { at }), `${id} mounts at ${at}`);
        const svg = box.children[0];
        const layers = Object.fromEntries(svg.children.filter((g) => /^cardio[BF]$/.test(g.dataset.part || '')).map((g) => [g.dataset.part, g.children.length]));
        if (!tplOf(id).prims) { eq(Object.keys(layers).length, 0, `${id} has no machine layer`); continue; }
        assert(layers.cardioB + layers.cardioF >= 1, `${id} draws its machine (${JSON.stringify(layers)})`);
        const vb = svg.attrs.viewBox.split(' ').map(Number);
        assert(vb.every(Number.isFinite) && vb[2] > 60 && vb[3] > 60, `${id} view box ${vb}`);
      }
    }
  } finally {
    if (had === undefined) delete globalThis.document; else globalThis.document = had;
  }
});
