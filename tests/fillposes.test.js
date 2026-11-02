// v0.16.93 (#258): every exercise has a demo, and the last 30 figures (js/ui/poses-fill.js plus the hip abductor) are sane.
// Synthetic only: poses are checked as joint positions, no rendering.
import { test, eq, assert } from './harness.js';
import { BODY, solve, dist, repPhases, repLength, paramsAt, camera, frameBox, drawOrder } from '../js/ui/rig.js';
import { TEMPLATES, EXERCISE_TEMPLATES } from '../js/ui/poses.js';
import { FILL, FILL_MAP } from '../js/ui/poses-fill.js';
import { EXERCISES } from '../js/workouts/exercises.js';

// The 31 exercises #258 listed; every one is drawn now (the abductor lives in poses-gym.js).
const LISTED = [
  'kb_turkish_getup', 'kb_windmill', 'machine_hip_abductor', 'mb_rotational_throw', 'bw_straight_leg_raise', 'bw_fire_hydrant',
  'towel_slider_fly', 'muscleup_transition', 'muscleup', 'slip_and_roll', 'bw_quad_set', 'bw_shallow_wall_sit', 'bw_high_box_sit_to_stand',
  'bw_self_resisted_curl', 'bw_iso_curl_hold', 'bw_doorframe_curl', 'bw_doorframe_hammer_curl', 'bw_calf_raise', 'bw_slow_calf_raise',
  'bw_toe_walk', 'bw_pogo_hops', 'bw_good_morning', 'bw_bridge_walkout', 'bw_prone_lat_pulldown', 'bw_doorframe_wide_row',
  'bw_doorframe_single_arm_row', 'bw_iso_lateral_raise_wall', 'bw_self_resisted_lateral_raise', 'bw_arm_circles', 'bw_prone_t_raise', 'bw_swimmer',
];

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
/** Angle at the knee between thigh and shin, in degrees: 180 = straight. */
const kneeAngle = (j, S) => {
  const u = sub(j['hip' + S], j['knee' + S]);
  const v = sub(j['ankle' + S], j['knee' + S]);
  return (Math.acos(dot(u, v) / (Math.hypot(...u) * Math.hypot(...v))) * 180) / Math.PI;
};

test('every exercise has a demo template (no skip list)', () => {
  const missing = EXERCISES.filter((e) => !EXERCISE_TEMPLATES[e.id] || !TEMPLATES[EXERCISE_TEMPLATES[e.id]]).map((e) => e.id);
  eq(missing.join(), '', 'exercises without a demo');
});

test('the 31 listed exercises are real, drawn, and the poses-fill ones come from FILL', () => {
  for (const id of LISTED) {
    assert(EXERCISES.some((e) => e.id === id), `${id} is a real exercise`);
    assert(tplOf(id), `${id} has a template`);
  }
  for (const [id, name] of Object.entries(FILL_MAP)) {
    assert(EXERCISES.some((e) => e.id === id), `${id} (FILL_MAP) is a real exercise`);
    assert(TEMPLATES[name], `${id} → ${name} exists`);
  }
});

test('fill figures: every number is finite, every frame solves, frames and draws, limb lengths are kept', () => {
  const names = [...Object.keys(FILL), 'hip_abductor_machine'];
  for (const name of names) {
    const tpl = TEMPLATES[name];
    assert(tpl, `${name} registered`);
    for (const k of ['a', 'm', 'b']) for (const [p, v] of Object.entries(tpl[k] || {})) assert(Number.isFinite(v), `${name}.${k}.${p} is ${v}`);
    for (const k of ['m', 'b']) for (const p of Object.keys(tpl[k] || {})) assert(p in tpl.a, `${name}.${k}.${p} has a start value`);
    for (const j of poses(tpl)) {
      for (const [p, v] of Object.entries(j)) if (Array.isArray(v)) assert(v.every(Number.isFinite), `${name} ${p}`);
      for (const S of ['N', 'F']) {
        assert(Math.abs(dist(j['hip' + S], j['knee' + S]) - BODY.thigh) < 1e-6, `${name} thigh`);
        assert(Math.abs(dist(j['knee' + S], j['ankle' + S]) - BODY.shin) < 1e-6, `${name} shin`);
        assert(Math.abs(dist(j['shoulder' + S], j['elbow' + S]) - BODY.upper) < 1e-6, `${name} upper arm`);
        assert(Math.abs(dist(j['elbow' + S], j['wrist' + S]) - BODY.fore) < 1e-6, `${name} forearm`);
      }
    }
    assert(frameBox(tpl, camera(tpl.cam), phases(tpl)).every(Number.isFinite), `${name} frame`);
    assert(drawOrder(tpl, solve(tpl, tpl.a), camera(tpl.cam)).length >= 17, `${name} draw order`);
    assert(tpl.tempo && tpl.tempo.con > 0 && tpl.slow, `${name} has a tempo and a slow tempo`);
  }
});

test('fill figures: nothing goes through the floor (the pull-up bar moves hang, so only the hands and head are checked)', () => {
  const BAR = ['muscleup', 'muscleup_transition'];
  for (const [name, tpl] of Object.entries(FILL)) {
    for (const j of poses(tpl)) {
      const pts = BAR.includes(name) ? ['head', 'pelvis'] : ['pelvis', 'chest', 'head', 'elbowN', 'wristN', 'elbowF', 'wristF', 'kneeN', 'kneeF', 'ankleN', 'ankleF'];
      for (const p of pts) assert(j[p][1] > -0.03, `${name} ${p} at y=${j[p][1].toFixed(3)}`);
      if (!BAR.includes(name)) for (const p of ['toeN', 'toeF', 'heelN', 'heelF']) assert(j[p][1] > -0.1, `${name} ${p} at y=${j[p][1].toFixed(3)}`);
    }
  }
});

test('gentle knee moves: the shallow wall sit stays well above a right angle, knees over the ankles, back on the wall', () => {
  const tpl = tplOf('bw_shallow_wall_sit');
  const wall = tpl.env.find((e) => e.type === 'wall').x;
  for (const j of poses(tpl)) {
    for (const S of ['N', 'F']) {
      assert(kneeAngle(j, S) > 125, `knee bend ${kneeAngle(j, S).toFixed(0)}° is shallow`);
      assert(Math.abs(j['knee' + S][0] - j['ankle' + S][0]) < 0.12, 'knee stays over the ankle, no pushing past the toes');
    }
    assert(j.pelvis[0] - wall < 0.16 && j.pelvis[1] > 0.7, 'hips near the wall and high');
    assert(j.heelN[1] < 0.03 && j.toeN[1] < 0.03, 'both feet flat on the floor');
  }
});

test('gentle knee moves: the high-seat sit-to-stand lands on the seat, knees stay behind the toes and never go below ~85° of bend', () => {
  const tpl = tplOf('bw_high_box_sit_to_stand');
  const box = tpl.env.find((e) => e.type === 'box');
  const deep = solve(tpl, tpl.b);
  assert(Math.abs(deep.pelvis[1] - (box.h + 0.1)) < 0.08, `pelvis ${deep.pelvis[1].toFixed(2)} sits on a ${box.h} m seat`);
  assert(deep.pelvis[0] > box.x0 && deep.pelvis[0] < box.x1, 'over the seat');
  for (const j of poses(tpl)) {
    for (const S of ['N', 'F']) {
      assert(kneeAngle(j, S) > 85, `knee bend ${kneeAngle(j, S).toFixed(0)}° stays open`);
      assert(j['knee' + S][0] - j['toe' + S][0] < 0.02, 'knees do not travel past the toes');
      assert(Math.abs(j['knee' + S][2] - j['ankle' + S][2]) < 0.1, 'knees track over the feet, no caving');
    }
    assert(j.heelN[1] < 0.03 && j.heelF[1] < 0.03, 'heels stay down');
  }
});

test('gentle knee moves: the quad set and straight-leg raise keep the working leg straight, the other foot flat, and lie down', () => {
  for (const id of ['bw_quad_set', 'bw_straight_leg_raise']) {
    const tpl = tplOf(id);
    for (const j of poses(tpl)) {
      assert(kneeAngle(j, 'N') > 172, `${id} working knee straight (${kneeAngle(j, 'N').toFixed(0)}°)`);
      assert(Math.abs(kneeAngle(j, 'F') - 90) < 15, `${id} other knee bent about 90°`);
      assert(j.pelvis[1] < 0.25 && j.head[1] < 0.3, `${id} lying on the floor`);
    }
  }
  const raise = tplOf('bw_straight_leg_raise');
  const top = solve(raise, raise.b);
  assert(Math.abs(top.ankleN[1] - top.kneeF[1]) < 0.4 && top.ankleN[1] > 0.3 && top.ankleN[1] < 0.55, 'the raised leg stops at about the bent knee, no higher');
  const set = tplOf('bw_quad_set');
  assert(solve(set, set.a).ankleN[1] < 0.2 && solve(set, set.b).ankleN[1] < 0.2, 'the quad set holds the leg on the floor');
});

test('calf and hop moves: knees stay nearly straight and the heels lift, the slow raise follows 2-2-4', () => {
  for (const id of ['bw_calf_raise', 'bw_slow_calf_raise', 'bw_toe_walk', 'bw_pogo_hops']) {
    const tpl = tplOf(id);
    const top = solve(tpl, tpl.b);
    assert(top.heelN[1] > 0.1, `${id} heel is up`);
    for (const j of poses(tpl)) assert(kneeAngle(j, 'N') > 160, `${id} knee is soft but straight (${kneeAngle(j, 'N').toFixed(0)}°)`);
  }
  const t = tplOf('bw_slow_calf_raise').tempo;
  eq([t.con, t.top, t.ecc].join(), '2,2,4', 'two up, two hold, four down');
});

test('good morning: hips go back, the back stays flat, the knees stay soft', () => {
  const tpl = tplOf('bw_good_morning');
  const a = solve(tpl, tpl.a);
  const b = solve(tpl, tpl.b);
  assert(b.pelvis[0] < a.pelvis[0] - 0.1, 'hips travel back');
  assert(b.chest[1] < a.chest[1] - 0.4, 'the chest folds forward');
  for (const j of poses(tpl)) for (const S of ['N', 'F']) assert(kneeAngle(j, S) > 135, 'knees soft, not squatting');
});

test('doorframe moves: the hands stay on the frame and the feet stay planted', () => {
  for (const id of ['bw_doorframe_curl', 'bw_doorframe_hammer_curl', 'bw_doorframe_wide_row', 'bw_doorframe_single_arm_row']) {
    const tpl = tplOf(id);
    assert(tpl.env.some((e) => e.type === 'doorframe'), `${id} shows the frame`);
    const first = poses(tpl)[0];
    for (const j of poses(tpl)) {
      assert(Math.abs(j.gripN[0]) < 0.05 && Math.abs(j.gripN[1] - 1.2) < 0.05, `${id} near hand stays on the frame`);
      assert(dist(j.ankleN, first.ankleN) < 0.01, `${id} feet do not slide`);
    }
  }
});

test('hip abductor machine: pads on the outside of the knees, the legs press apart, the far leg mirrors the near one', () => {
  const tpl = tplOf('machine_hip_abductor');
  assert(tpl.pads.out === true, 'pads outside the knees');
  const gap = (k) => { const j = solve(tpl, tpl[k]); return Math.abs(j.kneeN[2] - j.kneeF[2]); };
  assert(gap('b') - gap('a') > 0.2 && gap('a') > 0.1, 'knees start together and open');
  for (const j of poses(tpl)) {
    assert(Math.abs(j.kneeN[1] - j.kneeF[1]) < 1e-6 && Math.abs(j.ankleN[1] - j.ankleF[1]) < 1e-6, 'both legs at the same height');
    assert(Math.abs(Math.abs(j.kneeN[2]) - Math.abs(j.kneeF[2])) < 0.03, 'the far leg opens as far as the near one');
    assert(Math.abs(j.kneeN[1] - j.pelvis[1]) < 0.1, 'thighs level on the seat');
  }
});

test('self-resisted and held arm moves: the working arm moves and the held moves barely do', () => {
  const curl = tplOf('bw_self_resisted_curl');
  assert(solve(curl, curl.b).wristN[1] - solve(curl, curl.a).wristN[1] > 0.3, 'the fist curls up');
  const lat = tplOf('bw_self_resisted_lateral_raise');
  assert(solve(lat, lat.b).wristN[2] * -1 > 0.4 || Math.abs(solve(lat, lat.b).wristN[2]) > 0.4, 'the working arm reaches out to the side');
  for (const id of ['bw_iso_curl_hold', 'bw_iso_lateral_raise_wall']) {
    const tpl = tplOf(id);
    assert(dist(solve(tpl, tpl.a).wristN, solve(tpl, tpl.b).wristN) < 0.12, `${id} is a hold: the hand barely moves`);
    eq(tpl.tempo.con, 1.6, `${id} breathes at the hold tempo`);
  }
});

test('muscle-up: the hands stay on the bar and the chest ends above it', () => {
  for (const id of ['muscleup', 'muscleup_transition']) {
    const tpl = tplOf(id);
    for (const j of poses(tpl)) assert(Math.abs(j.gripN[1] - 2.15) < 0.02 && Math.abs(j.gripN[0]) < 0.02, `${id} hands on the bar`);
    assert(solve(tpl, tpl.b).chest[1] > 2.15 + 0.2, `${id} chest above the bar at the top`);
  }
});

test('prone and floor moves: they lie close to the floor', () => {
  for (const id of ['bw_prone_lat_pulldown', 'bw_prone_t_raise', 'bw_swimmer']) {
    for (const j of poses(tplOf(id))) assert(j.pelvis[1] < 0.3 && j.chest[1] < 0.4, `${id} face down on the floor`);
  }
});
