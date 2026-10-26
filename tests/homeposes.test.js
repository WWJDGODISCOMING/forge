// v0.12.1 demo figures for the home, travel and bodyweight moves (js/ui/poses-home.js), and sheets closing on a
// route change. Synthetic only: poses are checked as numbers (joint positions), not pixels.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { BODY, solve, dist, repPhases, repLength, paramsAt, camera, frameBox, propParts, drawOrder, loopEnds } from '../js/ui/rig.js';
import { TEMPLATES, EXERCISE_TEMPLATES } from '../js/ui/poses.js';
import { HOME, HOME_MAP } from '../js/ui/poses-home.js';
import { KB_MAP } from '../js/ui/poses-kb.js';
import { GYM_MAP } from '../js/ui/poses-gym.js';
import { CARDIO_MAP } from '../js/ui/poses-cardio.js';
import { EXERCISES } from '../js/workouts/exercises.js';
import { registerSheet, closeAllSheets, openSheetCount } from '../js/ui/sheets.js';

// Every move the v0.12.1 brief lists (issue #36).
const BRIEF = [
  'table_row_bent_knees', 'table_row_straight_legs', 'table_row_feet_raised', 'doorframe_row', 'wall_triceps_extension', 'table_triceps_extension',
  'towel_lat_pulldown_iso', 'sliding_floor_pulldown', 'towel_pull_apart', 'towel_iso_curl', 'towel_lateral_raise_iso',
  'side_plank', 'bw_copenhagen_plank', 'bw_superman', 'bw_prone_ytw', 'reverse_snow_angel', 'bw_side_lying_leg_raise',
  'bw_russian_twist', 'bw_slider_leg_curl', 'bw_reverse_nordic', 'bw_sissy_squat',
  'bw_lateral_lunge', 'db_lateral_lunge', 'band_lateral_walk', 'band_hip_abduction', 'band_hip_adduction',
  'cat_cow', 'inchworm', 'worlds_greatest_stretch', 'kneeling_hip_flexor_stretch', 'hip_90_90', 'thoracic_open_book',
  'high_knees', 'burpee', 'bear_crawl', 'skater_hops',
];

const SAMPLES = 24;
const poses = (tpl) => {
  const ph = repPhases(tpl.tempo, tpl.first);
  const T = repLength(ph);
  return Array.from({ length: SAMPLES }, (_, k) => solve(tpl, paramsAt(tpl, ph, (T * k) / SAMPLES)));
};
const withLoad = (id, name) => ({ ...TEMPLATES[name], load: EXERCISES.find((e) => e.id === id).load });

test('home figures: every move in the brief exists in the library and has a template', () => {
  for (const id of BRIEF) {
    assert(EXERCISES.some((e) => e.id === id), `${id} is a real exercise`);
    assert(EXERCISE_TEMPLATES[id], `${id} has a template`);
    assert(TEMPLATES[EXERCISE_TEMPLATES[id]], `${id} maps to a template that exists`);
  }
  for (const id of Object.keys(HOME_MAP)) assert(BRIEF.includes(id), `${id} is in the brief`);
});

test('home figures: what we leave out stays out (kettlebell ballistics, muscle-up; the cardio kit and boxing got figures in v0.14.4)', () => {
  for (const id of ['kb_turkish_getup', 'muscleup', 'slip_and_roll']) {
    assert(!EXERCISE_TEMPLATES[id], `${id} has no template yet`);
  }
});

test('home figures: every a / m / b number is finite and every frame solves to finite joints and a finite box', () => {
  for (const [name, tpl] of Object.entries(HOME)) {
    for (const key of ['a', 'm', 'b']) {
      for (const [k, v] of Object.entries(tpl[key] || {})) assert(Number.isFinite(v), `${name}.${key}.${k} is ${v}`);
    }
    // b and m only override keys a has, so nothing blends to NaN.
    for (const key of ['m', 'b']) for (const k of Object.keys(tpl[key] || {})) assert(k in tpl.a, `${name}.${key}.${k} has a start value`);
    for (const j of poses(tpl)) for (const [key, v] of Object.entries(j)) if (Array.isArray(v)) assert(v.every(Number.isFinite), `${name} ${key}`);
    const ph = repPhases(tpl.tempo, tpl.first);
    assert(frameBox(tpl, camera(tpl.cam), ph).every(Number.isFinite), `${name} frame`);
    assert(drawOrder(tpl, solve(tpl, tpl.a), camera(tpl.cam)).length >= 17, `${name} draw order`);
  }
});

test('home figures: with the exercise\'s own load every figure still solves (towels, loops and bodyweight show no weights)', () => {
  for (const id of BRIEF) {
    const tpl = withLoad(id, EXERCISE_TEMPLATES[id]);
    for (const j of poses(tpl)) assert(j.pelvis.every(Number.isFinite), id);
    const parts = propParts(tpl);
    assert(!parts.some((p) => /^(barN|barF|plate|db|kb)/.test(p)), `${id} shows a weight it does not use: ${parts}`);
  }
});

test('home figures: no limb goes through the floor (toes and heels get the same slack the library plank has)', () => {
  for (const [name, tpl] of Object.entries(HOME)) {
    for (const j of poses(tpl)) {
      for (const key of ['pelvis', 'chest', 'head', 'shoulderN', 'elbowN', 'wristN', 'handTipN', 'shoulderF', 'elbowF', 'wristF', 'handTipF', 'kneeN', 'ankleN', 'kneeF', 'ankleF']) {
        assert(j[key][1] > -0.03, `${name} ${key} at y=${j[key][1].toFixed(3)}`);
      }
      for (const key of ['toeN', 'toeF', 'heelN', 'heelF']) assert(j[key][1] > -0.1, `${name} ${key} at y=${j[key][1].toFixed(3)}`);
    }
  }
});

test('home figures: hands stay on what they hold (no detached hands) in every frame', () => {
  for (const [name, tpl] of Object.entries(HOME)) {
    for (const j of poses(tpl)) {
      for (const S of ['N', 'F']) {
        if ((tpl.rig['arms' + S] || tpl.rig.arms) !== 'ik') continue;
        const gap = dist(j['wrist' + S], j['grip' + S]);
        assert(Math.abs(gap - BODY.hand * 0.55) < 0.03, `${name} ${S} hand is ${gap.toFixed(3)} from its grip`);
      }
    }
  }
});

test('home figures: nothing passes through the table, the step or the wall', () => {
  for (const [name, tpl] of Object.entries(HOME)) {
    for (const j of poses(tpl)) {
      for (const e of tpl.env || []) {
        for (const key of ['pelvis', 'chest', 'head', 'kneeN', 'kneeF', 'ankleN', 'ankleF']) {
          const p = j[key];
          if (e.type === 'table' || e.type === 'box') {
            const bottom = e.type === 'table' ? e.h - 0.04 : 0;
            const inside = p[0] > e.x0 && p[0] < e.x1 && Math.abs(p[2] - (e.z || 0)) < (e.w ?? 0.5) / 2 && p[1] > bottom && p[1] < e.h + 0.02;
            assert(!inside, `${name} ${key} is inside the ${e.type} at ${p.map((x) => x.toFixed(2))}`);
          }
          if (e.type === 'wall') assert(p[0] < e.x - 0.08, `${name} ${key} is in the wall`);
        }
        if (e.type === 'wall') for (const key of ['handTipN', 'handTipF']) assert(j[key][0] <= e.x + 0.01, `${name} ${key} reaches into the wall`);
      }
    }
  }
});

test('home figures: held moves breathe (a and b differ a little) instead of freezing', () => {
  const held = Object.entries(HOME).filter(([, t]) => t.tempo && t.tempo.ecc === t.tempo.con && t.tempo.pause === t.tempo.top && t.tempo.ecc >= 1.6);
  assert(held.length >= 6, 'plank, side plank, iso towel moves, hip-flexor stretch and the 90/90 hold are all held');
  for (const [name, tpl] of held) {
    const moves = Object.keys(tpl.a).some((k) => tpl.b[k] != null && tpl.b[k] !== tpl.a[k]);
    assert(moves, `${name} is held but a === b`);
  }
});

test('home figures: rolled poses lie on their side (side plank: one shoulder over the other, near arm up)', () => {
  const tpl = TEMPLATES.side_plank;
  const j = solve(tpl, tpl.a);
  assert(j.shoulderN[1] - j.shoulderF[1] > 0.25, 'near shoulder stacked above the far one');
  assert(Math.abs(j.shoulderN[2] - j.shoulderF[2]) < 0.05, 'shoulders in the same vertical plane');
  assert(j.wristN[1] > j.shoulderN[1] + 0.2, 'top arm reaches up');
  assert(j.elbowF[1] < 0.12 && j.wristF[1] < 0.12, 'supporting forearm lies on the floor');
  const lie = solve(TEMPLATES.bw_side_lying_leg_raise, TEMPLATES.bw_side_lying_leg_raise.b);
  assert(lie.ankleN[1] > lie.ankleF[1] + 0.4, 'the top leg lifts away from the bottom one');
});

test('home figures: props — the table and doorframe are known to the framer, towels and loops land on real points', () => {
  for (const id of ['table_row_straight_legs', 'doorframe_row', 'table_triceps_extension']) {
    const tpl = TEMPLATES[EXERCISE_TEMPLATES[id]];
    assert(tpl.env.some((e) => e.type === 'table' || e.type === 'doorframe'), id);
    assert(frameBox(tpl, camera(tpl.cam), repPhases(tpl.tempo, tpl.first)).every(Number.isFinite), id);
  }
  const tp = TEMPLATES.towel_pull_apart;
  assert(propParts(tp).includes('towel'));
  const j = solve(tp, tp.a);
  assert(dist(j.gripN, j.gripF) > 0.3, 'the towel is held apart');
  const iso = TEMPLATES.towel_iso_curl;
  assert(propParts(iso).includes('strapN') && propParts(iso).includes('strapF'));
  const loop = TEMPLATES.band_hip_abduction;
  const [p, q] = loopEnds(loop, solve(loop, loop.b));
  assert(dist(p, q) > 0.3, 'the band stretches as the leg goes out');
  const [p0, q0] = loopEnds(loop, solve(loop, loop.a));
  assert(dist(p, q) > dist(p0, q0), 'wider at the end than the start');
});

test('home figures: the rig keeps its bone lengths in the new poses', () => {
  for (const [name, tpl] of Object.entries(HOME)) {
    for (const j of poses(tpl)) {
      for (const S of ['N', 'F']) {
        assert(Math.abs(dist(j['hip' + S], j['knee' + S]) - BODY.thigh) < 1e-6, `${name} thigh`);
        assert(Math.abs(dist(j['knee' + S], j['ankle' + S]) - BODY.shin) < 1e-6, `${name} shin`);
        assert(Math.abs(dist(j['shoulder' + S], j['elbow' + S]) - BODY.upper) < 1e-6, `${name} upper arm`);
        assert(Math.abs(dist(j['elbow' + S], j['wrist' + S]) - BODY.fore) < 1e-6, `${name} forearm`);
      }
    }
  }
});

test('home figures: the exercise library coverage went up and the rest is still honest', () => {
  const unmapped = EXERCISES.filter((e) => !EXERCISE_TEMPLATES[e.id]);
  const kb = Object.keys(KB_MAP); // v0.12.2 added these (tests/kbposes.test.js)
  const gym = Object.keys(GYM_MAP); // v0.14.2 added these (tests/gymposes.test.js)
  const cardio = Object.keys(CARDIO_MAP); // v0.14.4 added these (tests/cardioposes.test.js)
  eq(unmapped.length, 73 + 18 - BRIEF.length - kb.length - gym.length - cardio.length, 'was 73 without a figure (+18 no-equipment moves added in v0.16.72, drawn later); all four briefs are covered');
  for (const e of unmapped) assert(!BRIEF.includes(e.id) && !kb.includes(e.id) && !gym.includes(e.id) && !cardio.includes(e.id), e.id);
});

// ---------- sheets close when the route changes ----------
test('sheets: closeAllSheets closes every open sheet once and forgets them', () => {
  const calls = [];
  const a = registerSheet(() => calls.push('a'));
  registerSheet(() => calls.push('b'));
  eq(openSheetCount(), 2);
  eq(closeAllSheets(), 2);
  eq(calls.join(), 'a,b');
  eq(openSheetCount(), 0);
  eq(closeAllSheets(), 0, 'nothing left to close');
  a(); // forgetting an already-cleared sheet is harmless
  eq(openSheetCount(), 0);
});

test('sheets: a sheet that closed itself is no longer tracked', () => {
  let closed = 0;
  const forget = registerSheet(() => { closed++; });
  forget();
  eq(closeAllSheets(), 0);
  eq(closed, 0);
});

test('sheets: a close() that opens another sheet does not loop or lose it', () => {
  const calls = [];
  registerSheet(() => {
    calls.push('first');
    registerSheet(() => calls.push('second')); // e.g. a confirm that follows a sheet
  });
  eq(closeAllSheets(), 1);
  eq(openSheetCount(), 1, 'the new sheet stays open');
  eq(closeAllSheets(), 1);
  eq(calls.join(), 'first,second');
});

test('sheets: sheet() registers its close, and the hashchange handler closes sheets before it renders', () => {
  const ui = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  assert(/forget = registerSheet\(close\)/.test(ui), 'sheet() registers its close');
  assert(/const close = \(\) => \{\s*if \(closing\) return;\s*closing = true;\s*forget\(\);/.test(ui), 'close() forgets the sheet');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const handler = app.slice(app.indexOf("window.addEventListener('hashchange'"));
  const body = handler.slice(0, handler.indexOf('});'));
  assert(body.indexOf('closeAllSheets()') > 0, 'the handler closes sheets');
  assert(body.indexOf('closeAllSheets()') < body.indexOf('await render()'), 'and does it before rendering the new screen');
  assert(body.indexOf('closeAllSheets()') < body.indexOf('prevParts = to'), 'and before any other work');
});
