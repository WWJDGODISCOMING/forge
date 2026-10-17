// v0.14.3 Coach answers for missions, body programs and long-term health: full / partial / empty data for each,
// the visibility rules, and the 8-question cap. Synthetic data only, built from the same pure modules the app uses.
import { test, eq, assert } from './harness.js';
import {
  missionsAnswer, programAnswer, programLabel, longtermAnswer, availableQuestions, QUESTIONS, MAX_QUESTIONS,
} from '../js/coach/answers.js';
import { shiftDay } from '../js/health/metrics.js';
import { indexDays, missionsFor, weekDots, missionXP, MISSION_XP, ALL_DONE_XP } from '../js/missions/core.js';
import { currentStreak } from '../js/missions/badges.js';
import { PROGRAMS, programStatus, paceBand, paceNumber, rangeText, recommendedId, recommendedWhy } from '../js/body-programs/core.js';
import { computeTargets } from '../js/nutrition/targets.js';
import { longevityCards } from '../js/health/longevity.js';
import { clearestChanges } from '../js/health/longview.js';

const TODAY = '2026-10-10';
const back = (n, from = TODAY) => Array.from({ length: n }, (_, k) => shiftDay(from, -k)); // n days ending at `from`

// ---------- missions ----------

/** The missions slice of coachData(): weigh-ins and workouts on given days, missions started `startedAgo` days ago. */
function missionsData({ weighDays = [], trainDays = [], startedAgo = 20 } = {}) {
  const idx = indexDays({
    weights: weighDays.map((day) => ({ day })),
    workouts: trainDays.map((day) => ({ id: day, status: 'done', started_at: `${day}T12:00:00` })),
  });
  const list = missionsFor(TODAY, idx);
  return {
    started: true,
    today: { list, done: list.filter((m) => m.done).length, total: list.length },
    week: weekDots(TODAY, idx, {}, shiftDay(TODAY, -startedAgo)),
    weekXP: missionXP(shiftDay(TODAY, -Math.min(6, startedAgo)), TODAY, idx), // mission XP only; no badges in this fixture
    streak: currentStreak(weighDays, TODAY),
  };
}

test('coach missions: full data — today and what is left, the last 7 days, streak and XP', () => {
  const m = missionsData({ weighDays: back(7), trainDays: back(6, shiftDay(TODAY, -1)) }); // today: weighed, not trained yet
  const a = missionsAnswer({ missions: m });
  eq(a.headline, '1 of 2 missions done today.');
  eq(a.lines[0], 'Still to do: Train or move.');
  eq(a.lines[1], '6 of the last 7 days complete.');
  eq(a.lines[2], 'Weigh-in streak: 7 days.');
  eq(a.lines[3], `You earned ${6 * (2 * MISSION_XP + ALL_DONE_XP) + MISSION_XP} XP from missions this week.`);
  eq(a.lines.length, 4);
  assert(a.why && !a.action, 'a why, and no action: the action system has no link type');
});

test('coach missions: all done, just started, and no missions at all', () => {
  const all = missionsAnswer({ missions: missionsData({ weighDays: back(1), trainDays: back(1) }) });
  eq(all.headline, 'All of today’s missions are done.');
  eq(all.lines[0], 'All done today.');
  const fresh = missionsAnswer({ missions: missionsData({ startedAgo: 0 }) });
  eq(fresh.headline, '0 of 2 missions done today.');
  eq(fresh.lines[1], '0 of the 1 day since you started complete.');
  eq(fresh.lines[2], 'No weigh-in streak yet. A weigh-in today starts one.');
  eq(fresh.lines[3], 'You earned 0 XP from missions this week.');
  const idle = missionsAnswer({ missions: { ...missionsData(), today: { list: [], done: 0, total: 0 } } });
  eq(idle.headline, 'No missions today.');
  eq(idle.lines[0], 'No missions today.');
});

test('coach missions: shown only after missions_started', () => {
  eq(missionsAnswer({}), null);
  eq(missionsAnswer({ missions: { ...missionsData(), started: false } }), null);
  const ids = (d) => availableQuestions(d, TODAY).map((q) => q.id);
  assert(!ids({ missions: { ...missionsData(), started: false } }).includes('missions'));
  assert(ids({ missions: missionsData() }).includes('missions'));
});

test('coach missions: the weigh-in streak counts back from yesterday until today is weighed', () => {
  eq(currentStreak(back(5, shiftDay(TODAY, -1)), TODAY), 5);
  eq(currentStreak(back(3), TODAY), 3);
  eq(currentStreak([shiftDay(TODAY, -2)], TODAY), 0);
  eq(currentStreak([], TODAY), 0);
});

// ---------- body programs ----------

const START = shiftDay(TODAY, -10); // week 2 of 4 (days -3 to +3), with 4 days of it behind us
const pgData = (series = []) => ({
  idx: indexDays({ weights: back(11).map((day) => ({ day })) }),
  series, progress: [], trainingDays: 3, steps: 8000, units: 'metric',
  band: paceBand(computeTargets({ goal: 'lose', sex: 'male', age: 35, heightCm: 180, weightKg: 100, activity: 'moderate', pacePct: 0.5 }), 100),
});
const falling = Array.from({ length: 12 }, (_, k) => ({ day: shiftDay(TODAY, -11 + k), kg: 100 - 0.1 * k, trend: 100 - 0.1 * k }));
const running = (id = 'cut4', series = []) => ({ status: programStatus({ id, started: START }, TODAY, pgData(series)) });
const suggest = (goal) => ({ status: null, recommended: { ...PROGRAMS[recommendedId(goal)], why: recommendedWhy(goal) } });

test('coach program: running — week N of M, this week’s goals in the #/program words, weeks hit, pace vs safe pace', () => {
  const d = { program: running('cut4', falling) };
  const a = programAnswer(d);
  const st = d.program.status;
  eq(a.headline, `Cut kickoff: ${st.goalsDone} of ${st.goalsTotal} goals so far.`);
  eq(a.lines[0], `Week 2 of 4. ${st.weeksHit === 1 ? '1 week' : `${st.weeksHit} weeks`} fully hit so far.`);
  for (const g of st.weeks.find((w) => w.state === 'current').goals) {
    assert(a.lines.some((l) => l.startsWith(`${g.label}: ${g.text}`)), `a line for the ${g.id} goal`);
  }
  const pace = a.lines.find((l) => l.startsWith('Lose weight at a safe pace'));
  assert(pace && /Losing/.test(pace) && /safe pace: /.test(pace), `pace line: ${pace}`);
  assert(a.lines.length >= 2 && a.lines.length <= 4 && a.why && !a.action);
  eq(programLabel(d), 'How’s my program going?');
});

test('coach program: partial data — pace waits for weigh-ins; the optional steps goal gives way past four lines', () => {
  const a = programAnswer({ program: running('cut4') });
  assert(a.lines.includes('Lose weight at a safe pace: Weigh in a few more times to see your pace.'), a.lines.join(' | '));
  const crowded = running('cut4');
  crowded.status.weeks.find((w) => w.state === 'current').goals.push({ id: 'steps', label: 'Average 8,000 steps a day', text: 'Averaging 9,000 steps a day', done: true });
  const b = programAnswer({ program: crowded });
  eq(b.lines.length, 4);
  assert(!b.lines.some((l) => l.startsWith('Average 8,000')), 'steps left out to fit');
  assert(programAnswer({ program: running('maintain4') }).headline.startsWith('Maintenance: '));
});

test('coach program: nothing running → "Which program should I start?" with the recommendation and a why', () => {
  for (const [goal, id] of [['lose', 'cut4'], ['recomp', 'recomp8'], ['muscle', 'recomp8'], ['health', 'maintain4']]) {
    const d = { program: suggest(goal) };
    const a = programAnswer(d);
    eq(a.headline, `Start ${PROGRAMS[id].name}.`);
    assert(a.lines.some((l) => l.startsWith('Why this one: ')), goal);
    assert(a.lines.length >= 2 && a.lines.length <= 4 && a.why, goal);
    eq(programLabel(d), 'Which program should I start?');
  }
  const done = { ...suggest('lose'), status: { ...running().status, finished: true } }; // a finished program is not running
  eq(programLabel({ program: done }), 'Which program should I start?');
  eq(programAnswer({ program: done }).headline, 'Start Cut kickoff.');
});

test('coach program: empty — no profile, or a cut blocked by the safety checks, hides the question', () => {
  eq(programAnswer({}), null);
  eq(programAnswer({ program: null }), null);
  eq(programAnswer({ program: { status: null, recommended: null } }), null);
});

// ---------- long-term health ----------

const rowsOf = (n, rhr, hrv = () => 50) => Array.from({ length: n }, (_, k) => ({ id: shiftDay(TODAY, -(n - 1 - k)), rhr_bpm: rhr(k), hrv_sdnn_ms: hrv(k) }));
const longData = (rows, sentence = 'Up 6 points since July') => {
  const cards = longevityCards({ rows, measures: [], profile: { sex: 'male', age: 35 }, today: TODAY });
  return { longterm: { hasCards: cards.length > 0, sentence, clear: clearestChanges(cards, 'metric') } };
};

test('coach long term: full data — the 90-day Score sentence, the clearest Longevity changes, the Theil–Sen why', () => {
  const a = longtermAnswer(longData(rowsOf(90, (k) => 60 - k * 0.05, (k) => 50 + (k % 2)))); // resting heart rate falls, HRV flat
  eq(a.lines[0], 'Forge Score over 90 days: up 6 points since July.');
  assert(/^Resting heart rate: (down|up) [\d.]+ bpm in 90 days/.test(a.lines[1]), a.lines[1]);
  assert(a.lines.length >= 2 && a.lines.length <= 4);
  eq(a.why, 'Theil–Sen trends over 90 days, compared only with your own past.');
  assert(availableQuestions(longData(rowsOf(90, () => 55)), TODAY).some((q) => q.id === 'longterm'));
});

test('coach long term: at most three metrics and four lines, with a metric in its own units', () => {
  const rows = rowsOf(90, (k) => 60 - k * 0.05).map((r, k) => ({ ...r, vo2max: 40 + k * 0.05 }));
  const measures = [
    { id: 'a', day: shiftDay(TODAY, -80), measured_at: `${shiftDay(TODAY, -80)}T07:00:00Z`, metrics: { fat_free_mass_kg: 70, visceral_fat: 9 } },
    { id: 'b', day: shiftDay(TODAY, -2), measured_at: `${shiftDay(TODAY, -2)}T07:00:00Z`, metrics: { fat_free_mass_kg: 72, visceral_fat: 7 } },
  ];
  const cards = longevityCards({ rows, measures, profile: { sex: 'male', age: 35, heightCm: 180 }, today: TODAY });
  assert(cards.length >= 4, `cards: ${cards.length}`);
  const clear = clearestChanges(cards, 'metric');
  assert(clear.length <= 3 && clear.length >= 1);
  const a = longtermAnswer({ longterm: { hasCards: true, sentence: 'About the same as 3 months ago', clear } });
  eq(a.lines.length, 1 + clear.length);
  assert(a.lines.length <= 4);
});

test('coach long term: partial data still answers, empty data hides it', () => {
  const few = longtermAnswer(longData(rowsOf(5, () => 55), null)); // a card, but no trend and no Score sentence yet
  assert(few, 'a card with data answers');
  eq(few.lines.length, 2, 'padded to two lines');
  eq(longtermAnswer(longData([])), null);
  eq(longtermAnswer({}), null);
  eq(longtermAnswer({ longterm: { hasCards: false } }), null);
});

// ---------- ordering and the cap ----------

test('coach: more than 8 questions → the eight most relevant, program and missions first while active', () => {
  // Stub the seven older answers so only the ordering is under test.
  const saved = QUESTIONS.map((q) => q.answer);
  try {
    for (const q of QUESTIONS) if (!['missions', 'program', 'longterm', 'spot'].includes(q.id)) q.answer = () => ({ id: q.id, headline: 'x', lines: ['a', 'b'], why: 'y' });
    const d = { missions: missionsData(), program: running('cut4', falling), ...longData(rowsOf(90, (k) => 60 - k * 0.05)) };
    const ids = (data) => availableQuestions(data, TODAY).map((q) => q.id);
    eq(QUESTIONS.length, 11);
    eq(MAX_QUESTIONS, 8);
    const active = ids(d);
    eq(active.length, 8, 'capped at 8');
    eq(active[0], 'program');
    eq(active[1], 'missions');
    assert(!active.includes('longterm'), 'the last in the list is the one dropped');
    // a suggestion (nothing running) keeps its place in the list, so the active missions still lead
    const idle = ids({ ...d, program: suggest('lose') });
    eq(idle.length, 8);
    eq(idle[0], 'missions');
    assert(idle.includes('week') && !idle.includes('longterm'));
    // exactly 8 apply: nothing dropped, list order kept
    const eight = ids({ ...d, longterm: { hasCards: false }, program: null });
    eq(eight.join(','), 'week,goal,weight,train,recovered,score,stronger,missions');
    // nine apply but nothing is active: the plain list order, cut at 8
    const nine = ids({ ...d, missions: { ...missionsData(), started: false }, program: suggest('lose') });
    eq(nine.join(','), 'week,goal,weight,train,recovered,score,stronger,program');
  } finally {
    QUESTIONS.forEach((q, i) => { q.answer = saved[i]; });
  }
});

test('coach: the new answers keep the format and add no network or storage', () => {
  const all = { missions: missionsData(), program: running(), ...longData(rowsOf(90, (k) => 60 - k * 0.05)) };
  for (const f of [missionsAnswer, programAnswer, longtermAnswer]) {
    const a = f(all, TODAY);
    assert(a.headline && a.lines.length >= 1 && a.lines.length <= 4 && a.why, f.name);
  }
});

test('pace text: a pace just outside the safe band never rounds into it', () => {
  const band = { loKg: 0.5 / 2.20462, hiKg: 1.6 / 2.20462 }; // shown as 0.5–1.6 lb
  eq(rangeText(band.loKg, band.hiKg, 'imperial'), '0.5–1.6 lb');
  eq(paceNumber(0.46, band, false, 'imperial'), '0.46'); // just under: would round to 0.5, so more decimals
  eq(paceNumber(1.62, band, false, 'imperial'), '1.62'); // just over
  eq(paceNumber(0.3, band, false, 'imperial'), '0.3'); // clearly outside: unchanged
  eq(paceNumber(0.46, band, true, 'imperial'), '0.5'); // goal met: usual rounding
});
