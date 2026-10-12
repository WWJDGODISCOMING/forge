// v0.12.2 demo figures for the kettlebell, dumbbell and band moves (js/ui/poses-kb.js), the retried fire hydrant and
// slider fly, and the mission-badge celebration on Today. Synthetic only: poses are checked as joint positions.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { BODY, solve, dist, repPhases, repLength, paramsAt, camera, frameBox, propParts, drawOrder, bellDir, BELL_OFFSET } from '../js/ui/rig.js';
import { TEMPLATES, EXERCISE_TEMPLATES } from '../js/ui/poses.js';
import { KB, KB_MAP } from '../js/ui/poses-kb.js';
import { EXERCISES } from '../js/workouts/exercises.js';
import { newMissionBadges, missionBadges } from '../js/missions/badges.js';

// Every move the v0.12.2 brief lists (issue #38). The Turkish get-up is skipped on purpose (too many phases).
const BRIEF = [
  'kb_halo', 'kb_clean', 'kb_snatch', 'kb_russian_twist', 'kb_high_pull',
  'db_renegade_row', 'db_z_press', 'db_side_bend', 'band_shoulder_dislocate',
];
// Left without a figure: the Turkish get-up (too many phases), the windmill (the rig can't hinge sideways) and the
// fire hydrant and slider fly (read wrong after three tries). A wrong demo is worse than the muscle map.
const SKIPPED = ['kb_turkish_getup', 'kb_windmill', 'bw_fire_hydrant', 'towel_slider_fly'];
const KETTLEBELL = BRIEF.filter((id) => id.startsWith('kb_'));

const SAMPLES = 24;
const phases = (tpl) => repPhases(tpl.tempo, tpl.first);
const poses = (tpl) => {
  const ph = phases(tpl);
  const T = repLength(ph);
  return Array.from({ length: SAMPLES }, (_, k) => solve(tpl, paramsAt(tpl, ph, (T * k) / SAMPLES)));
};
const withLoad = (id) => ({ ...TEMPLATES[EXERCISE_TEMPLATES[id]], load: EXERCISES.find((e) => e.id === id).load });
const key = (tpl, k) => solve(tpl, { ...tpl.a, ...(tpl[k] || {}) }); // the a, m or b keyframe
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const bell = (tpl, j, S = 'N') => { const d = bellDir(tpl, j, S); return j['grip' + S].map((v, i) => v + d[i] * BELL_OFFSET); };
const distToSegment = (p, a, b) => {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
};
const angleAt = (m, a, b) => {
  const u = sub(a, m);
  const v = sub(b, m);
  return (Math.acos(dot(u, v) / (Math.hypot(...u) * Math.hypot(...v))) * 180) / Math.PI;
};

test('kb figures: every id in the brief has a template, or is listed as skipped', () => {
  for (const id of BRIEF) {
    assert(EXERCISES.some((e) => e.id === id), `${id} is a real exercise`);
    assert(EXERCISE_TEMPLATES[id], `${id} has a template`);
    assert(KB[EXERCISE_TEMPLATES[id]], `${id} is drawn from poses-kb.js`);
  }
  eq(Object.keys(KB_MAP).sort().join(), [...BRIEF].sort().join(), 'the map holds exactly the brief');
  for (const id of SKIPPED) assert(!EXERCISE_TEMPLATES[id], `${id} stays unmapped`);
});

test('kb figures: every a / m / b number is finite, every frame solves and frames', () => {
  for (const [name, tpl] of Object.entries(KB)) {
    for (const k of ['a', 'm', 'b']) for (const [p, v] of Object.entries(tpl[k] || {})) assert(Number.isFinite(v), `${name}.${k}.${p} is ${v}`);
    for (const k of ['m', 'b']) for (const p of Object.keys(tpl[k] || {})) assert(p in tpl.a, `${name}.${k}.${p} has a start value`);
    for (const j of poses(tpl)) for (const [p, v] of Object.entries(j)) if (Array.isArray(v)) assert(v.every(Number.isFinite), `${name} ${p}`);
    assert(frameBox(tpl, camera(tpl.cam), phases(tpl)).every(Number.isFinite), `${name} frame`);
    assert(drawOrder(tpl, solve(tpl, tpl.a), camera(tpl.cam)).length >= 17, `${name} draw order`);
  }
});

test('kb figures: nothing goes through the floor', () => {
  for (const [name, tpl] of Object.entries(KB)) {
    for (const j of poses(tpl)) {
      for (const p of ['pelvis', 'chest', 'head', 'shoulderN', 'elbowN', 'wristN', 'handTipN', 'shoulderF', 'elbowF', 'wristF', 'handTipF', 'kneeN', 'ankleN', 'kneeF', 'ankleF']) {
        assert(j[p][1] > -0.03, `${name} ${p} at y=${j[p][1].toFixed(3)}`);
      }
      for (const p of ['toeN', 'toeF', 'heelN', 'heelF']) assert(j[p][1] > -0.1, `${name} ${p} at y=${j[p][1].toFixed(3)}`);
    }
  }
});

test('kb figures: the weight each move holds comes from its load (kettlebell, dumbbell, band, nothing)', () => {
  for (const id of KETTLEBELL) assert(propParts(withLoad(id)).some((p) => /^kb[NF]$/.test(p)), `${id} shows a bell`);
  for (const id of ['db_renegade_row', 'db_z_press', 'db_side_bend']) {
    const parts = propParts(withLoad(id));
    assert(parts.includes('dbNin') && parts.includes('dbNout'), `${id} shows the near dumbbell`);
  }
  assert(propParts(withLoad('db_renegade_row')).includes('dbFin'), 'renegade row has both dumbbells');
  assert(propParts(withLoad('db_z_press')).includes('dbFin'), 'Z press has both dumbbells');
  assert(!propParts(withLoad('db_side_bend')).includes('dbFin'), 'side bend has one');
  assert(propParts(withLoad('band_shoulder_dislocate')).includes('loop'), 'the dislocate shows the band between the hands');
});

test('kb figures: the hand stays on its grip and the bell stays in the hand, in every frame', () => {
  for (const [name, tpl] of Object.entries(KB)) {
    const load = EXERCISES.find((e) => e.id === name)?.load;
    for (const j of poses(tpl)) {
      for (const S of ['N', 'F']) {
        const gap = dist(j['wrist' + S], j['grip' + S]);
        const ik = (tpl.rig['arms' + S] || tpl.rig.arms) === 'ik';
        // Hands: IK keeps the wrist a fixed distance from its grip; FK builds the grip from the wrist.
        assert(Math.abs(gap - BODY.hand * (ik ? 0.55 : 0.5)) < 0.03, `${name} ${S} hand is ${gap.toFixed(3)} from its grip`);
      }
      if (load === 'kettlebell') {
        const c = bell(tpl, j);
        assert(dist(j.gripN, j.wristN) < 0.06, `${name} the near hand holds the handle`);
        assert(dist(c, j.gripN) < BELL_OFFSET + 1e-6, `${name} the bell hangs from the handle`);
      }
    }
  }
});

test('kb figures: the bell never passes through the forearm or the head, and never touches the floor', () => {
  for (const id of KETTLEBELL) {
    const tpl = TEMPLATES[EXERCISE_TEMPLATES[id]];
    for (const j of poses(tpl)) {
      const c = bell(tpl, j);
      assert(distToSegment(c, j.elbowN, j.wristN) >= 0.085, `${id} the bell is ${distToSegment(c, j.elbowN, j.wristN).toFixed(3)} from the forearm`);
      assert(distToSegment(c, j.shoulderN, j.elbowN) >= 0.06, `${id} the bell is in the upper arm`);
      assert(dist(c, j.head) >= 0.17, `${id} the bell is in the head (${dist(c, j.head).toFixed(3)})`);
      assert(c[1] - 0.085 > -0.03, `${id} the bell is below the floor`);
    }
  }
});

test('kb figures: clean, snatch and high pull read as a hinge, a middle and a finish', () => {
  for (const id of ['kb_clean', 'kb_snatch', 'kb_high_pull']) {
    const tpl = TEMPLATES[id];
    assert(tpl.m, `${id} has a middle keyframe`);
    const a = key(tpl, 'a');
    const m = key(tpl, 'm');
    const b = key(tpl, 'b');
    // Start: hinged, trunk well forward, bell swung back between the knees below the hips.
    assert(a.chest[1] < a.pelvis[1] + 0.35, `${id} starts in a hinge`);
    assert(a.gripN[1] < a.kneeN[1], `${id} bell starts below the knee`);
    assert(Math.abs(a.gripN[2]) < Math.abs(a.kneeN[2]), `${id} bell starts between the legs`);
    // Mid: standing tall, bell in a different place from the start and the finish.
    assert(m.chest[1] > 1.3, `${id} stands up through the middle`);
    assert(dist(a.gripN, m.gripN) > 0.3 && dist(m.gripN, b.gripN) > 0.2, `${id} the three poses are clearly different`);
    // Close to the body: the bell passes within a forearm of the torso at the middle.
    assert(Math.abs(bell(tpl, m)[0] - m.pelvis[0]) < 0.5, `${id} the bell stays close at the middle`);
  }
  const rack = key(TEMPLATES.kb_clean, 'b');
  assert(Math.abs(rack.gripN[1] - rack.shoulderN[1]) < 0.12, 'clean ends with the hand at the shoulder');
  assert(rack.gripN[0] - rack.chest[0] < 0.25, 'clean ends with the bell close to the chest');
  const lock = key(TEMPLATES.kb_snatch, 'b');
  assert(lock.gripN[1] > lock.head[1] + 0.25, 'snatch ends with the hand well above the head');
  assert(Math.abs(lock.wristN[0] - lock.shoulderN[0]) < 0.08, 'snatch lockout is a vertical arm');
  assert(bell(TEMPLATES.kb_snatch, lock)[0] < lock.wristN[0] - 0.08, 'snatch bell rests behind the wrist');
  const pull = key(TEMPLATES.kb_high_pull, 'b');
  assert(pull.elbowN[1] >= pull.shoulderN[1], 'high pull ends with the elbow at or above the shoulder');
  assert(pull.gripN[1] < pull.elbowN[1], 'high pull hand stays below the elbow');
});

test('kb figures: halo circles the head — front, beside, behind — and the camera is front-on', () => {
  const tpl = TEMPLATES.kb_halo;
  assert(tpl.cam.yaw >= 55, 'front-on camera');
  const a = key(tpl, 'a');
  const m = key(tpl, 'm');
  const b = key(tpl, 'b');
  assert(a.gripN[0] > a.head[0] + 0.15, 'starts in front of the face');
  assert(Math.abs(m.gripN[2]) > 0.18 && Math.abs(m.gripN[0] - m.head[0]) < 0.1, 'passes beside the ear');
  assert(b.gripN[0] < b.head[0] - 0.15, 'finishes behind the head');
  for (const j of [a, m, b]) assert(dist(j.gripN, j.gripF) < 0.2, 'both hands are on the bell');
});

test('kb figures: Russian twist swings the bell from one side to the other with both hands on it', () => {
  const tpl = TEMPLATES.kb_russian_twist;
  const a = key(tpl, 'a');
  const b = key(tpl, 'b');
  assert(a.gripN[2] < -0.2 && b.gripN[2] > 0.2, 'the near hand swings across');
  assert(dist(a.gripN, a.gripF) < 0.12 && dist(b.gripN, b.gripF) < 0.12, 'both hands stay together on the bell');
  assert(a.ankleN[1] > 0.1, 'feet off the floor');
});

test('kb figures: renegade row — the far hand stays planted, the near dumbbell rows to the ribs', () => {
  const tpl = TEMPLATES.db_renegade_row;
  const a = key(tpl, 'a');
  const b = key(tpl, 'b');
  assert(dist(a.gripF, b.gripF) < 1e-9, 'the planted hand does not move');
  assert(a.gripN[1] < 0.1 && a.gripF[1] < 0.1, 'both hands start on the dumbbells on the floor');
  assert(b.gripN[1] - a.gripN[1] > 0.35, 'the near dumbbell rows up');
  assert(Math.abs(b.pelvis[2] - a.pelvis[2]) < 1e-9, 'the hips stay square');
  assert(Math.abs(a.ankleN[2] - a.ankleF[2]) > 0.3, 'feet wide');
});

test('kb figures: Z press sits on the floor with straight legs and presses overhead', () => {
  const tpl = TEMPLATES.db_z_press;
  const a = key(tpl, 'a');
  const b = key(tpl, 'b');
  assert(a.pelvis[1] < 0.2 && Math.abs(a.pelvis[1] - b.pelvis[1]) < 1e-9, 'seated on the floor, not moving');
  assert(Math.abs(a.ankleN[1] - a.pelvis[1]) < 0.1 && a.ankleN[0] - a.pelvis[0] > 0.8, 'legs straight out in front');
  assert(a.gripN[1] < a.head[1] + 0.1, 'racked at the shoulders');
  assert(b.gripN[1] > b.head[1] + 0.25, 'locked out overhead');
});

test('kb figures: side bend tips the trunk sideways toward the weight, hips and feet fixed', () => {
  const tpl = TEMPLATES.db_side_bend;
  assert(tpl.cam.yaw >= 55, 'front-on camera');
  const a = key(tpl, 'a');
  const b = key(tpl, 'b');
  assert(dist(a.pelvis, b.pelvis) < 1e-9 && dist(a.ankleN, b.ankleN) < 1e-9, 'hips and feet stay put');
  assert(b.shoulderN[1] < a.shoulderN[1] - 0.1 && b.shoulderN[2] < a.shoulderN[2] - 0.1, 'near shoulder drops toward the weight');
  assert(b.head[2] < -0.2, 'head follows to the near side');
  assert(Math.abs(b.chest[0]) < 1e-9, 'straight sideways, not forward');
  assert(b.gripN[1] < a.gripN[1] - 0.08, 'the dumbbell lowers');
  assert(dist(a.gripF, [0, 0.99, 0.14]) < 0.04 && dist(b.gripF, [0, 0.99, 0.14]) < 0.04, 'the free hand stays on the hip');
  assert(Math.abs(dist(b.shoulderN, b.shoulderF) - 2 * BODY.shoulderZ) < 1e-9, 'the shoulders keep their width');
});

test('kb figures: lean is a rigid tilt (shoulders keep their width, bones keep their length)', () => {
  const tpl = TEMPLATES.db_side_bend;
  for (const lean of [-40, -10, 0, 25]) {
    const j = solve(tpl, { ...tpl.a, lean });
    assert(Math.abs(dist(j.shoulderN, j.shoulderF) - 2 * BODY.shoulderZ) < 1e-9, `shoulders at lean ${lean}`);
    assert(Math.abs(dist(j.pelvis, j.chest) - BODY.spine) < 1e-9, `spine at lean ${lean}`);
    assert(Math.abs(dist(j.shoulderN, j.elbowN) - BODY.upper) < 1e-9, `upper arm at lean ${lean}`);
  }
  eq(solve(tpl, { ...tpl.a, lean: 0 }).chest.join(), solve(tpl, { ...tpl.a, lean: undefined }).chest.join(), 'no lean, no change');
});

test('kb figures: band dislocate keeps a wide grip and straight arms from the thighs, overhead, to behind the hips', () => {
  const tpl = TEMPLATES.band_shoulder_dislocate;
  assert(tpl.cam.yaw >= 55, 'front-on camera');
  for (const j of poses(tpl)) {
    assert(dist(j.gripN, j.gripF) > 0.9, 'wide grip all the way');
    assert(dist(j.shoulderN, j.wristN) > BODY.upper + BODY.fore - 0.01, 'arms stay straight');
  }
  const a = key(tpl, 'a');
  const m = key(tpl, 'm');
  const b = key(tpl, 'b');
  assert(a.gripN[1] < 1.0 && a.gripN[0] > 0.05, 'starts in front of the thighs');
  assert(m.gripN[1] > m.head[1] + 0.1, 'passes overhead');
  assert(b.gripN[0] < -0.1 && b.gripN[1] < 1.0, 'ends behind the hips');
});

test('kb figures: library coverage — the Turkish get-up, windmill, fire hydrant and slider fly stay without a figure', () => {
  for (const id of SKIPPED) assert(EXERCISES.some((e) => e.id === id) && !EXERCISE_TEMPLATES[id], id);
  for (const id of BRIEF) assert(EXERCISE_TEMPLATES[id], id);
});

// ---------- mission badge celebration ----------
const at = (day) => ({ at: `${day}T12:00:00`, workoutId: null });
const badge = (id, day) => ({ id, name: id, how: '', earned: day ? at(day) : null });

test('celebrate: a mission badge earned since missions started and not in awards_seen is new', () => {
  const list = [badge('wi7', '2026-10-12'), badge('wi30', null), badge('bf1', '2026-10-20')];
  eq(newMissionBadges(list, { st4: '2026-09-01' }, '2026-10-09').map((b) => b.id).join(), 'wi7,bf1');
});

test('celebrate: never badges earned before missions_started (same rule as XP), never ones already seen', () => {
  const list = [badge('wi7', '2026-10-08'), badge('wi30', '2026-10-09'), badge('bf1', '2026-10-12')];
  eq(newMissionBadges(list, {}, '2026-10-09').map((b) => b.id).join(), 'wi30,bf1', 'the 8th is before the start');
  eq(newMissionBadges(list, { wi30: '2026-10-09T12:00:00' }, '2026-10-09').map((b) => b.id).join(), 'bf1', 'wi30 was seen');
  eq(newMissionBadges(list, { wi30: 'x', bf1: 'y' }, '2026-10-09').length, 0, 'all seen: nothing to celebrate');
});

test('celebrate: nothing before awards_seen exists (first run seeds quietly) or before missions have started', () => {
  const list = [badge('wi7', '2026-10-12')];
  eq(newMissionBadges(list, null, '2026-10-09').length, 0);
  eq(newMissionBadges(list, undefined, '2026-10-09').length, 0);
  eq(newMissionBadges(list, {}, null).length, 0);
});

test('celebrate: from real weigh-in data — a 7-day streak after the start is new, one that began before is not', () => {
  const days = (from, n) => Array.from({ length: n }, (_, i) => `2026-10-${String(from + i).padStart(2, '0')}`);
  const badges = missionBadges({ weighDays: days(10, 8) });
  eq(newMissionBadges(badges, {}, '2026-10-09').map((b) => b.id).join(), 'wi7');
  eq(newMissionBadges(badges, {}, '2026-10-20').length, 0, 'earned on the 16th, before a start on the 20th');
});

test('celebrate: Today shows the card, the card has art with shine, +100 XP and a See awards link, and saves through rememberBadges', () => {
  const ui = readFileSync(new URL('../js/missions/ui.js', import.meta.url), 'utf8');
  assert(/badgeSVG\(b\.id, \{ shine: first/.test(ui), 'badge art with shine');
  assert(ui.includes('+${XP_BADGE} XP') && /const XP_BADGE = 100;/.test(ui), '+100 XP');
  assert(/href="#\/awards"[^>]*>See awards</.test(ui), 'See awards link');
  assert(/rememberBadges\(fresh\)/.test(ui) && /from '\.\.\/workouts\/awards-store\.js'/.test(ui), 'saves through rememberBadges');
  assert(/IntersectionObserver/.test(ui) && /setTimeout\(\(\) => card\.isConnected/.test(ui), 'saves only after the card has been on screen');
  assert(/remember\(id\);\n\s*\};/.test(ui) && /data-badge-awards[\s\S]*remember\(id\)/.test(ui), 'dismiss and See awards remember it too');
  const today = readFileSync(new URL('../js/screens/today.js', import.meta.url), 'utf8');
  assert(today.includes('badge: () => badgeCelebrationCards()') && today.includes('afterBadgeCelebrations(el)'), 'wired into Today, through the single alert slot');
  const card = today.indexOf('${alert.html}');
  assert(card > today.indexOf('${greeting()}') && card < today.indexOf('${readinessCard()}'), 'right under the greeting, above Readiness');
  assert(card < today.indexOf('${workoutCard()}'), 'above the workout card, so it is on screen without scrolling');
  const store = readFileSync(new URL('../js/missions/store.js', import.meta.url), 'utf8');
  assert(/newMissionBadges\(extraBadges\(\), state\.settings && state\.settings\.awards_seen, startedDay\(\)\)/.test(store), 'uses awards_seen and missions_started');
});

test('celebrate: motion only when the person allows it', () => {
  const css = readFileSync(new URL('../css/missions.css', import.meta.url), 'utf8');
  const anim = css.slice(css.indexOf('.ms-badge {'));
  const block = anim.slice(anim.indexOf('@media (prefers-reduced-motion: no-preference)'));
  assert(/\.ms-badge \{ animation:/.test(block.slice(0, block.indexOf('}\n') + 2)), 'the card springs in only under no-preference');
  assert(!/^\.ms-badge \{[^}]*animation/m.test(anim.slice(0, anim.indexOf('@media'))), 'no animation outside the media query');
  const badges = readFileSync(new URL('../css/player.css', import.meta.url), 'utf8');
  assert(/prefers-reduced-motion: reduce\) \{ \.bdg-new \.bdg-shine/.test(badges), 'the badge shine stops under reduced motion');
});
