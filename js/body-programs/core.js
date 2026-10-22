// Body programs: multi-week plans (cut kickoff, recomp, maintenance) judged week by week from data the app
// already has. Pure functions, no DOM, no state; js/body-programs/store.js reads state and settings.
// See docs/body-programs.md.
import { shiftDay, localDay } from '../missions/core.js';
import { GOALS, MAX_LOSS_PCT, MAX_LOSS_PCT_OVERRIDE } from '../nutrition/targets.js';
import { weightToDisplay, weightUnit } from '../units.js';

export const FINISH_XP = 250; // for finishing a program
export const WEEK_XP = 50; // for each week with every goal hit
export const PACE_LOW = 0.5; // the safe pace is the planned weekly pace ± 50%
export const PACE_HIGH = 1.5;
export const MIN_SPAN_DAYS = 3; // days of weigh-ins needed before a week's weight trend is judged

export const PROGRAMS = {
  cut4: {
    id: 'cut4', name: 'Cut kickoff', weeks: 4, forGoals: ['lose'], weighDays: 5, goals: ['weigh', 'train', 'steps', 'pace'],
    badge: 'pg_cut4', badgeName: 'Cut Kickoff',
    blurb: 'Four weeks to start losing fat at a safe pace.',
    plain: 'Each week: weigh in 5 days, train your planned days, keep your weight going down at a safe pace.',
  },
  recomp8: {
    id: 'recomp8', name: 'Recomp', weeks: 8, forGoals: ['recomp', 'muscle'], weighDays: 4, progressWorkouts: 2, steadyPct: 0.25,
    goals: ['weigh', 'train', 'progress', 'steady'],
    badge: 'pg_recomp8', badgeName: 'Recomp',
    blurb: 'Eight weeks to build strength while your weight holds steady.',
    plain: 'Each week: weigh in 4 days, train your planned days, beat a past lift in 2 workouts, and keep your weight steady.',
  },
  maintain4: {
    id: 'maintain4', name: 'Maintenance', weeks: 4, forGoals: [], weighDays: 3, steadyPct: 0.3, goals: ['weigh', 'train', 'steady'],
    badge: 'pg_maintain4', badgeName: 'Steady State',
    blurb: 'Four weeks to hold the weight you have.',
    plain: 'Each week: weigh in 3 days, train your planned days, and keep your weight steady.',
  },
};
export const PROGRAM_IDS = Object.keys(PROGRAMS);
export const programById = (id) => PROGRAMS[id] || null;
export const PROGRAM_BADGE_IDS = new Set(PROGRAM_IDS.map((id) => PROGRAMS[id].badge));
export const PROGRAM_XP_RULES = `+${FINISH_XP} XP for finishing a body program and +${WEEK_XP} for each week you hit every goal (counted from the day you start it).`;

/** The program that fits a profile goal: Cut kickoff for losing fat, Recomp for recomp or muscle, Maintenance otherwise. */
export function recommendedId(goal) {
  const p = PROGRAM_IDS.find((id) => PROGRAMS[id].forGoals.includes(goal));
  return p || 'maintain4';
}

/** One plain line on why recommendedId(goal) fits that goal. */
export function recommendedWhy(goal) {
  if (goal === 'lose') return 'your goal is to lose weight, and it keeps the pace safe';
  if (goal === 'recomp' || goal === 'muscle') return 'your goal is to build strength while your weight holds steady';
  return 'it helps you hold the weight you have';
}

// ---------- dates ----------
const dayNum = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);
/** Last day of a program that started on `started`. */
export const lastDayOf = (started, id) => shiftDay(started, PROGRAMS[id].weeks * 7 - 1);
/** Week boundaries run from the start day, not the calendar week. Week n is 0-based. */
/** Can the program's start move to `day`? Today or a past date only, a real YYYY-MM-DD. → { ok, reason }. */
export function checkStart(day, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || Number.isNaN(new Date(`${day}T12:00:00`).getTime()) || shiftDay(day, 0) !== day) return { ok: false, reason: 'Pick a date.' };
  if (day > today) return { ok: false, reason: 'Pick today or an earlier day. A program can’t start in the future.' };
  return { ok: true, reason: '' };
}

export const weekBounds = (started, n) => ({ start: shiftDay(started, n * 7), end: shiftDay(started, n * 7 + 6) });

// ---------- the safe pace ----------
/**
 * The weekly pace to aim for while cutting, from computeTargets (js/nutrition/targets.js): the planned pace ± 50%,
 * never faster than the safety caps (1%/week, 1.5% with the override). Returns percent of body weight per week and kg.
 *   targets   computeTargets(profile) result (pacePct)    weightKg  your current trend weight
 */
export function paceBand(targets, weightKg, { allowFastPace = false } = {}) {
  const planned = targets && targets.pacePct > 0 ? targets.pacePct : GOALS.lose.defaultPace;
  const cap = allowFastPace ? MAX_LOSS_PCT_OVERRIDE : MAX_LOSS_PCT;
  const hiPct = Math.min(planned * PACE_HIGH, cap);
  const loPct = Math.min(planned * PACE_LOW, hiPct);
  const kg = (pct) => (weightKg * pct) / 100;
  return { loPct, hiPct, loKg: kg(loPct), hiKg: kg(hiPct) };
}

const trim = (n) => String(Number(n.toFixed(1)));
/** "0.5–1.5 lb" in the user's units (kg values in). */
/**
 * The weekly pace as a number. When the goal isn't met it must never read as inside the safe range shown beside it:
 * a pace just outside the band that rounds into it gets more decimals until it no longer does.
 */
export function paceNumber(value, band, done, units) {
  if (!band || done) return trim(value);
  const lo = Number(trim(weightToDisplay(band.loKg, units)));
  const hi = Number(trim(weightToDisplay(band.hiKg, units)));
  for (const places of [1, 2, 3]) {
    const shown = Number(value.toFixed(places));
    if (shown < lo || shown > hi) return String(shown);
  }
  return String(Number(value.toFixed(3)));
}

export function rangeText(loKg, hiKg, units) {
  return `${trim(weightToDisplay(loKg, units))}–${trim(weightToDisplay(hiKg, units))} ${weightUnit(units)}`;
}
/** "losing 0.5–1.5 lb a week" */
export const bandText = (band, units) => `losing ${rangeText(band.loKg, band.hiKg, units)} a week`;

// ---------- the weight trend of one week ----------
/**
 * How your trend moved over a week, scaled to a full week: { pct, kg, span } with pct a percent of body weight
 * (negative = down). `series` is the smoothed weight series [{ day, trend }]. Null when there isn't enough to say yet:
 * fewer than MIN_SPAN_DAYS between the first and last reading we can use.
 */
export function weekTrend(series, start, end, today) {
  const stop = end < today ? end : today;
  let base = null; // the last reading before the week, else the first inside it
  let last = null;
  for (const p of series) {
    if (p.day < start) base = p;
    else if (p.day <= stop) {
      if (!base) base = p;
      last = p;
    }
  }
  if (!base || !last || last.day <= base.day) return null;
  const span = daysBetween(base.day, last.day);
  if (span < MIN_SPAN_DAYS) return null;
  const kg = ((last.trend - base.trend) * 7) / span;
  return { kg, pct: (kg / base.trend) * 100, span };
}

// ---------- progress: PRs and progression steps ----------
/**
 * Days of workouts that set a PR or took a progression step (more weight, or more reps at the same weight, than
 * the last time that exercise was trained). Deload workouts are skipped. Returns one day per qualifying workout.
 */
export function progressDays(workouts) {
  const done = workouts.filter((w) => w && w.status === 'done' && !w.deleted).sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
  const last = new Map(); // exercise → { w, reps } from its previous session
  const out = [];
  for (const w of done) {
    if (w.deload) continue;
    let up = (w.prs || []).length > 0;
    for (const it of w.exercises || []) {
      const sets = (it.sets || []).filter((s) => s.done && !s.warmup);
      if (!sets.length) continue;
      const top = sets.reduce((m, s) => Math.max(m, s.weight_kg || 0), 0);
      const reps = sets.filter((s) => (s.weight_kg || 0) === top).reduce((m, s) => Math.max(m, s.reps || 0), 0);
      const prev = last.get(it.exercise_id);
      if (prev && (top > prev.w + 1e-6 || (Math.abs(top - prev.w) < 1e-6 && reps > prev.reps))) up = true;
      last.set(it.exercise_id, { w: top, reps });
    }
    if (up) out.push(localDay(w.started_at));
  }
  return out.filter(Boolean);
}

// ---------- weekly goals ----------
const count = (set, start, stop) => {
  let n = 0;
  for (const d of set) if (d >= start && d <= stop) n++;
  return n;
};
const plural = (n, one, many) => (n === 1 ? one : many);

/**
 * The goals for one week, as the missions do: { id, label, done, text, ... }. Steps are left out without Apple Health.
 *   data  { idx (indexDays), series (weight trend), progress (progressDays), trainingDays, steps (target),
 *           band (paceBand, for cut4), units }
 * Protein is not a goal yet: food logging exists (v0.14.5); to add it, put a `protein` goal here that uses idx.protein and
 * targets.proteinG, the way missions/core.js does, and list it in the programs' `goals`.
 */
export function weekGoals(def, start, end, today, data) {
  const stop = end < today ? end : today;
  const idx = data.idx;
  const out = [];
  for (const id of def.goals) {
    if (id === 'weigh') {
      const n = count(idx.weigh, start, stop);
      out.push({ id, label: `Weigh in ${def.weighDays} days`, done: n >= def.weighDays, text: `Weighed in ${n} of ${def.weighDays} days`, value: n, target: def.weighDays });
    } else if (id === 'train') {
      const days = new Set([...idx.trained, ...idx.moved]);
      const n = count(days, start, stop);
      const goal = data.trainingDays || 3;
      out.push({ id, label: 'Train your planned days', done: n >= goal, text: `Trained ${n} of ${goal} ${plural(goal, 'day', 'days')}`, value: n, target: goal });
    } else if (id === 'steps') {
      if (!idx.health.size) continue; // no Apple Health: hidden, like the steps mission
      const target = data.steps || 8000;
      // Today's row is still filling up, so a week in progress is judged on its finished days.
      let rows = [];
      for (let d = start; d <= stop; d = shiftDay(d, 1)) if (idx.health.has(d) && (d < today || end < today)) rows.push(idx.health.get(d));
      if (!rows.length) for (let d = start; d <= stop; d = shiftDay(d, 1)) if (idx.health.has(d)) rows.push(idx.health.get(d));
      const avg = rows.length ? rows.reduce((s, r) => s + (Number.isFinite(r.steps) ? r.steps : 0), 0) / rows.length : null;
      out.push({
        id, label: `Average ${target.toLocaleString()} steps a day`, done: avg != null && avg >= target,
        text: avg == null ? 'Updates when Apple Health syncs' : `Averaging ${Math.round(avg).toLocaleString()} steps a day`,
        value: avg, target, waiting: avg == null,
      });
    } else if (id === 'progress') {
      const n = count(data.progress || [], start, stop);
      out.push({ id, label: `Beat a past lift in ${def.progressWorkouts} workouts`, done: n >= def.progressWorkouts, text: `${n} of ${def.progressWorkouts} workouts with a PR or a step up`, value: n, target: def.progressWorkouts });
    } else if (id === 'pace' || id === 'steady') {
      const t = weekTrend(data.series || [], start, end, today);
      const g = { id, done: false, waiting: !t };
      if (id === 'pace') {
        const band = data.band;
        const down = t ? -t.pct : null; // % of body weight lost this week
        g.label = 'Lose weight at a safe pace';
        g.bar = band && { value: down, lo: band.loPct, hi: band.hiPct, mode: 'down' };
        g.done = !!t && !!band && down >= band.loPct - 1e-9 && down <= band.hiPct + 1e-9;
        g.text = !t ? 'Weigh in a few more times to see your pace'
          : `${down > 0.005 ? 'Losing' : down < -0.005 ? 'Gaining' : 'Holding'} ${paceNumber(Math.abs(weightToDisplay(t.kg, data.units || 'imperial')), band, g.done, data.units || 'imperial')} ${weightUnit(data.units || 'imperial')} a week`
            + (band ? ` (safe pace: ${rangeText(band.loKg, band.hiKg, data.units || 'imperial')})` : '');
      } else {
        const lim = def.steadyPct;
        g.label = 'Keep your weight steady';
        g.bar = { value: t ? t.pct : null, lo: -lim, hi: lim, mode: 'steady' };
        g.done = !!t && Math.abs(t.pct) <= lim + 1e-9;
        g.text = !t ? 'Weigh in a few more times to see your weight'
          : `${Math.abs(t.pct) < 0.005 ? 'Holding steady' : t.pct < 0 ? 'Down' : 'Up'}${Math.abs(t.pct) < 0.005 ? '' : ` ${trim(Math.abs(weightToDisplay(t.kg, data.units || 'imperial')))} ${weightUnit(data.units || 'imperial')} a week`}`;
      }
      out.push(g);
    }
  }
  return out;
}

// ---------- the whole program ----------
/**
 * Where a running program stands on `today`.
 *   program  { id, started }      data  see weekGoals
 * Returns { def, started, last (final day), finished, weekNo, weeks: [{ n, start, end, state: past|current|future,
 * goals, met, hit }], weeksHit, goalsDone, goalsTotal, progress (0–1, by days) }.
 */
export function programStatus(program, today, data) {
  const def = PROGRAMS[program.id];
  const started = program.started;
  const last = lastDayOf(started, program.id);
  const finished = today > last;
  const elapsed = Math.max(0, daysBetween(started, today));
  const weeks = [];
  for (let n = 0; n < def.weeks; n++) {
    const { start, end } = weekBounds(started, n);
    const state = today > end ? 'past' : today >= start ? 'current' : 'future';
    const goals = state === 'future' ? [] : weekGoals(def, start, end, today, data);
    const met = goals.length > 0 && goals.every((g) => g.done);
    weeks.push({ n: n + 1, start, end, state, goals, met, hit: state === 'past' && met });
  }
  const cur = weeks.find((w) => w.state === 'current') || null;
  const visible = cur ? cur.goals : [];
  return {
    def, started, last, finished,
    weekNo: finished ? def.weeks : cur ? cur.n : 1,
    weeks,
    weeksHit: weeks.filter((w) => w.hit).length,
    goalsDone: visible.filter((g) => g.done).length,
    goalsTotal: visible.length,
    progress: finished ? 1 : Math.min(1, elapsed / (def.weeks * 7)),
  };
}

// ---------- history ----------
/** A program ended by hand ('early') never counts as finished, even on its last day. */
export const entryCompleted = (e) => !!PROGRAMS[e.id] && !e.early && e.ended >= lastDayOf(e.started, e.id);

/** The history entry for a program that ran its course (judged as of the day after it ended). */
export function finishedEntry(program, data) {
  const st = programStatus(program, shiftDay(lastDayOf(program.started, program.id), 1), data);
  return { id: program.id, started: program.started, ended: st.last, weeksHit: st.weeksHit };
}

/** The history entry for a program you end early: only weeks that were already over can count. */
export function endedEntry(program, today, data) {
  const st = programStatus(program, today, data);
  return { id: program.id, started: program.started, ended: today, weeksHit: st.weeksHit, early: true };
}

/** What the completion card says: weeks fully hit, weight trend change, workouts and PRs between the two days. */
export function summaryFor(entry, { series = [], workouts = [] } = {}) {
  let base = null;
  let end = null;
  for (const p of series) {
    if (p.day < entry.started) base = p;
    else if (p.day <= entry.ended) { if (!base) base = p; end = p; }
  }
  const mine = workouts.filter((w) => w && w.status === 'done' && !w.deleted && localDay(w.started_at) >= entry.started && localDay(w.started_at) <= entry.ended);
  return {
    weeksHit: entry.weeksHit,
    weeks: PROGRAMS[entry.id].weeks,
    changeKg: base && end && end.day > base.day ? end.trend - base.trend : null,
    workouts: mine.length,
    prs: mine.reduce((n, w) => n + (w.prs || []).length, 0),
  };
}

// ---------- XP ----------
/**
 * XP from programs. Only programs started on or after `missionsStart` pay (never retroactive), +50 for each week
 * fully hit and +250 once finished. An ended-early program keeps the weeks it hit and gets no finish bonus.
 *   history  settings.body_program_history      active  programStatus(...) of the running program, or null
 */
export function programXP({ history = [], active = null, missionsStart = null }) {
  if (!missionsStart) return 0;
  let xp = 0;
  for (const e of history || []) {
    if (!PROGRAMS[e.id] || e.started < missionsStart) continue;
    xp += (Number.isFinite(e.weeksHit) ? e.weeksHit : 0) * WEEK_XP + (entryCompleted(e) ? FINISH_XP : 0);
  }
  if (active && active.started >= missionsStart) xp += active.weeksHit * WEEK_XP + (active.finished ? FINISH_XP : 0);
  return xp;
}

/** Program badges for the Awards screen: earned by finishing the program (the first time wins); kept once seen. */
export function programBadges(history = [], seen = {}) {
  return PROGRAM_IDS.map((id) => {
    const def = PROGRAMS[id];
    const done = (history || []).filter((e) => e.id === id && entryCompleted(e)).sort((a, b) => (a.ended < b.ended ? -1 : 1))[0];
    const date = done ? `${done.ended}T12:00:00` : (seen && seen[def.badge]) || null;
    return {
      id: def.badge, name: def.badgeName, how: `Finish the ${def.weeks}-week ${def.name} program`,
      earned: date ? { at: date, workoutId: null } : null,
    };
  });
}

/** Programs finished, for "Programs: 1 finished" on Awards. */
export const finishedCount = (history = []) => (history || []).filter(entryCompleted).length;

export { localDay };

/** One program at a time: a new one can start only when settings.body_program is empty. */
export const canStart = (settings, id) => !!PROGRAMS[id] && !(settings && settings.body_program && PROGRAMS[settings.body_program.id]);
