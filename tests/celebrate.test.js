// Mission celebrations (js/missions/celebrate-core.js): tier choice, once per day/week, haptics, reduced motion, Perfect Week. Synthetic data.
import { test, eq, assert } from './harness.js';
import { tierFor, tierToPlay, recordTier, hapticPlan, soundPlan, vibratePattern, effectsFor, sevenOfSeven, perfectWeekDue, weekStreak } from '../js/missions/celebrate-core.js';
import { weekDots, indexDays, shiftDay } from '../js/missions/core.js';
import { missionBadges } from '../js/missions/badges.js';

test('celebrate: tiers scale so the last mission always gets the finale', () => {
  eq([1, 2, 3].map((d) => tierFor(d, 3)).join(), '1,2,3');
  eq([1, 2].map((d) => tierFor(d, 2)).join(), '1,3', 'two missions: first, then finale');
  eq([1, 2, 3, 4].map((d) => tierFor(d, 4)).join(), '1,2,2,3');
  eq(tierFor(1, 1), 3);
  eq(tierFor(0, 3), 0);
  eq(tierFor(0, 0), 0);
});

test('celebrate: each tier plays once per day, only for a newly done mission, never on undo', () => {
  eq(tierToPlay({ done: 1, total: 3, celebrated: 0, hasNew: true }), 1);
  eq(tierToPlay({ done: 1, total: 3, celebrated: 1, hasNew: true }), 0, 'already played');
  eq(tierToPlay({ done: 3, total: 3, celebrated: 0, hasNew: false }), 0, 'reload with nothing new');
  eq(tierToPlay({ done: 3, total: 3, celebrated: 1, hasNew: true }), 3, 'skipped tier 2: straight to the finale');
  eq(tierToPlay({ done: 2, total: 3, celebrated: 3, hasNew: true }), 0, 'undo then redo does not replay');
  eq(tierToPlay({ done: 1, total: 3, celebrated: 2, hasNew: true }), 0, 'fewer done than before');
  let cele = recordTier({}, '2026-10-11', 2);
  cele = recordTier(cele, '2026-10-11', 1);
  eq(cele['2026-10-11'], 2, 'never goes down');
  cele = recordTier({ '2026-09-01': 3 }, '2026-10-11', 1);
  assert(!('2026-09-01' in cele), 'old days are dropped');
});

test('celebrate: haptics per tier', () => {
  eq(hapticPlan(1).map((s) => s.kind).join(), 'medium');
  const t2 = hapticPlan(2);
  eq(t2.map((s) => s.kind).join(), 'medium,heavy');
  eq(t2[1].t - t2[0].t, 80);
  const t3 = hapticPlan(3);
  eq(t3[t3.length - 1].kind, 'success');
  eq(t3[t3.length - 1].t, 1200);
  const heavy = t3.filter((s) => s.kind === 'heavy');
  assert(heavy.length >= 8, 'a rising run of heavy impacts');
  const gaps = heavy.slice(1).map((s, i) => s.t - heavy[i].t);
  assert(gaps.every((g, i) => i === 0 || g <= gaps[i - 1]), 'accelerating');
  assert(vibratePattern(3).length > 10 && vibratePattern(1).length === 1, 'web fallback pattern');
  const wk = hapticPlan('week');
  eq(wk[wk.length - 1].kind, 'success');
});

test('celebrate: reduced motion keeps haptics, toast and a fade, drops shake and particles', () => {
  const r = effectsFor(3, true);
  eq(r.shake, false);
  eq(r.particles, false);
  eq(r.aura, false);
  eq(r.pop, 1);
  eq(r.fade, true);
  eq(r.toast, true);
  eq(r.haptics, true);
  const m = effectsFor(3, false);
  eq(m.shake, true);
  eq(m.particles, true);
  eq(effectsFor(1, false).particles, false, 'tier 1 has no burst');
  eq(effectsFor(2, false).particles, true);
  eq(effectsFor(2, false).shake, false);
});

const dots = (n) => Array.from({ length: n }, () => ({ counted: true, all: true }));

test('perfect week: seven of seven, once per week', () => {
  eq(sevenOfSeven(dots(7)), true);
  eq(sevenOfSeven([...dots(6), { counted: true, all: false }]), false);
  eq(sevenOfSeven([{ counted: false, all: false }, ...dots(6)]), false, 'a day before missions started is not perfect');
  eq(perfectWeekDue(dots(7), [], '2026-10-11'), true);
  eq(perfectWeekDue(dots(7), ['2026-10-11'], '2026-10-11'), false, 'already celebrated today');
  eq(perfectWeekDue(dots(7), ['2026-10-05'], '2026-10-11'), false, 'overlapping week');
  eq(perfectWeekDue(dots(7), ['2026-10-04'], '2026-10-11'), true, 'seven days later is a new week');
  eq(perfectWeekDue(dots(7), ['2026-10-04'], '2026-10-10'), false);
});

test('perfect week: real dates across a month end, a DST change and a year end', () => {
  for (const end of ['2026-11-01', '2026-03-09', '2027-01-02']) {
    const start = shiftDay(end, -6);
    const days = Array.from({ length: 7 }, (_, i) => shiftDay(start, i));
    const idx = indexDays({ weights: days.map((d) => ({ day: d, kg: 80 })) });
    const week = weekDots(end, idx, { targets: {} }, start);
    eq(week.length, 7);
    assert(week.every((d) => d.counted), `${end}: counted`);
    eq(week[0].day, start);
    // a weigh-in alone is not every mission: stub "all done" to test the rule on these real dates
    eq(perfectWeekDue(week.map((d) => ({ ...d, all: true })), [], end), true, end);
    eq(perfectWeekDue(week.map((d, i) => ({ ...d, all: i !== 3 })), [], end), false, `${end}: one missed day`);
  }
});

test('perfect week: streak counter and the badge', () => {
  eq(weekStreak([]), 0);
  eq(weekStreak(['2026-10-04']), 1);
  eq(weekStreak(['2026-10-04', '2026-10-11', '2026-10-18']), 3);
  eq(weekStreak(['2026-09-20', '2026-10-11', '2026-10-18']), 2, 'a gap resets it');
  const none = missionBadges({}).find((b) => b.id === 'perfectweek');
  eq(none.earned, null);
  const got = missionBadges({ perfectWeeks: ['2026-10-18', '2026-10-04'] }).find((b) => b.id === 'perfectweek');
  eq(got.earned.at.slice(0, 10), '2026-10-04', 'earned on the first one');
});

test('perfect week: the medal is the Forge mark with a 7/7 ring, self-contained, and the same art serves Awards', async () => {
  const { perfectWeekMedal, badgeSVG } = await import('../js/ui/badges.js');
  const svg = perfectWeekMedal({ size: 100, label: 'Perfect Week', shine: true });
  assert(svg.includes('7/7') && svg.includes('stroke-dasharray') && svg.includes('<polyline'), 'ring, pulse and 7/7');
  assert(svg.includes('xmlns=') && svg.includes('bdg-shine') && svg.includes('role="img"'), 'standalone, shining, labelled');
  assert(!perfectWeekMedal({ earned: false, shine: true }).includes('bdg-shine'), 'a locked medal does not shine');
  eq(badgeSVG('perfectweek', { size: 40 }).includes('pw-medal-svg'), true, 'Awards draws the same medal');
  const ids = [...svg.matchAll(/url\(#([\w-]+)\)/g)].map((m) => m[1]);
  assert(ids.every((id) => svg.includes(`id="${id}"`)), 'every gradient it uses is defined inside it');
});

test('celebrate: the sound plan lands on the haptic impacts, ramps up, and the finale is the biggest', () => {
  const h3 = hapticPlan(3);
  const s3 = soundPlan(3);
  eq(s3.map((s) => s.t).join(), h3.map((s) => s.t).join(), 'same times as the haptics');
  eq(s3.filter((s) => s.kind === 'boom').length, 10, 'ten explosions');
  eq(s3[s3.length - 1].kind, 'finale');
  eq(s3[s3.length - 1].t, 1200);
  const booms = s3.filter((s) => s.kind === 'boom');
  assert(booms.every((s, i) => i === 0 || s.gain >= booms[i - 1].gain), 'each a little bigger');
  assert(s3.every((s) => s.gain > 0 && s.gain <= 1), 'gain capped at 1');
  eq(soundPlan(1).map((s) => s.kind).join(), 'pop');
  eq(soundPlan(2).map((s) => s.kind).join(), 'thud,thud');
  eq(soundPlan(2).map((s) => s.t).join(), hapticPlan(2).map((s) => s.t).join());
  const wk = soundPlan('week');
  eq(wk.map((s) => s.t).join(), hapticPlan('week').map((s) => s.t).join());
  eq(wk[wk.length - 1].kind, 'finale');
  assert(wk.filter((s) => s.kind === 'boom').length >= 3, 'its own bigger variant');
  eq(soundPlan(0).length, 0);
});

test('celebrate: the Sound effects switch silences explosions', async () => {
  const made = [];
  const param = new Proxy({}, { get: () => () => {}, set: () => true });
  const node = () => new Proxy(function () {}, { get: (t, k) => (k === 'gain' || k === 'frequency' ? param : () => node()), set: () => true });
  globalThis.window = globalThis.window || globalThis;
  globalThis.window.AudioContext = globalThis.AudioContext = function () {
    made.push(1);
    return { currentTime: 0, sampleRate: 8000, state: 'running', resume: async () => {}, destination: {}, createBuffer: () => ({ getChannelData: () => new Float32Array(10) }), createGain: node, createOscillator: node, createBiquadFilter: node, createBufferSource: node, createDynamicsCompressor: node };
  };
  const { state } = await import('../js/state.js');
  const { sfx } = await import('../js/ui/sound.js');
  state.settings = { ...(state.settings || {}), sfx: false };
  sfx.boom('boom', 1);
  eq(made.length, 0, 'switch off: nothing is even created');
  state.settings = { ...state.settings, sfx: true };
  sfx.boom('boom', 1);
  eq(made.length, 1, 'switch on: it plays');
});
