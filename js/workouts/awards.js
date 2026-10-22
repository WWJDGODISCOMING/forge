// XP, levels, weekly streaks and badges. Derived from your workout history (and cardio log); the only
// thing stored is the list of badges you've earned (settings/main.awards_seen = { id: date }), so a badge
// stays earned even if a later change (say 3 → 4 planned days) would no longer unlock it.
// Pure functions; see docs/levels.md.

// ---------- XP ----------
export const XP = {
  set: 10, setCap: 40, // +10 per working set, up to 40 sets a workout
  exercise: 25, exerciseMinSets: 2, // +25 per exercise with at least 2 working sets
  pr: 50, prCap: 200, // +50 per PR, up to +200 a workout
  week: 100, // +100 for the workout that hits your weekly goal
  badge: 100, // +100 per badge
};
export const XP_RULES = '+10 per working set (up to 40), +25 per exercise with 2 or more working sets, +50 per PR (up to +200 a workout), +100 for the workout that hits your weekly goal, and +100 per badge. Daily missions add +20 each, and +30 more when you finish all of a day’s missions. Body programs add +50 for each week you hit every goal and +250 for finishing.';

const workingSets = (it) => (it.sets || []).filter((s) => s.done && !s.warmup).length;
/** A finished workout only counts (XP, training days, streaks, badges) if it has a working set. */
export const hasWork = (w) => (w.exercises || []).some((it) => workingSets(it) > 0);

/**
 * XP for one finished workout. ctx.week: this workout hit the weekly goal; ctx.badges: badges it unlocked.
 * Returns { sets, exercises, prs, week, badges, total } (XP per part).
 */
export function workoutXP(w, { week = false, badges = 0 } = {}) {
  if (!hasWork(w)) return { sets: 0, exercises: 0, prs: 0, week: 0, badges: 0, total: 0 };
  let sets = 0;
  let exercises = 0;
  for (const it of w.exercises || []) {
    const n = workingSets(it);
    sets += n;
    if (n >= XP.exerciseMinSets) exercises++;
  }
  const parts = {
    sets: Math.min(sets, XP.setCap) * XP.set,
    exercises: exercises * XP.exercise,
    prs: Math.min((w.prs || []).length * XP.pr, XP.prCap),
    week: week ? XP.week : 0,
    badges: badges * XP.badge,
  };
  return { ...parts, total: parts.sets + parts.exercises + parts.prs + parts.week + parts.badges };
}

const finished = (workouts) => workouts
  .filter((w) => w.status === 'done' && !w.deleted && hasWork(w))
  .sort((a, b) => (a.started_at < b.started_at ? -1 : 1));

// ---------- levels ----------
export const LEVELS = [
  'Spark', 'Kindling', 'Ember', 'Coal Bed', 'Bellows', 'Raw Ore', 'Smelter', 'Pig Iron', 'Cast Iron', 'Wrought Iron',
  'Hammer Strike', 'Anvil', 'Red Heat', 'White Heat', 'Quench', 'Tempered', 'Carbon Steel', 'Spring Steel', 'Damascus', 'Blade Smith',
  'Forge Master', 'Ironclad', 'Titanium', 'Tungsten', 'Meteorite', 'Molten Core', 'Star Forge', 'Supernova', 'Adamant', 'Unbreakable',
];

/**
 * XP needed to reach a level (level 1 = 0): 250 × (n − 1)^1.6 + 3 × (n − 1)³. The first term keeps early
 * levels quick; the cubic slows the top so Unbreakable takes about two years at three workouts a week.
 */
export const xpForLevel = (level) => (level <= 1 ? 0 : Math.round(250 * Math.pow(level - 1, 1.6) + 3 * Math.pow(level - 1, 3)));

export function levelFor(xp) {
  let level = 1;
  while (level < LEVELS.length && xp >= xpForLevel(level + 1)) level++;
  const floor = xpForLevel(level);
  const next = level < LEVELS.length ? xpForLevel(level + 1) : null;
  return {
    level,
    name: LEVELS[level - 1],
    xp,
    floor,
    next,
    nextName: next != null ? LEVELS[level] : null,
    progress: next != null ? (xp - floor) / (next - floor) : 1,
  };
}

// ---------- weeks ----------
const pad = (n) => String(n).padStart(2, '0');
/** Local date key YYYY-MM-DD. */
export const dateKey = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** Monday (local) of the week containing a date, as YYYY-MM-DD. */
export function weekOf(iso) {
  const d = new Date(iso);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dateKey(d.toISOString());
}
const addWeeks = (key, n) => {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n * 7, 12);
  return dateKey(dt.toISOString());
};
const liveCardio = (cardio) => (cardio || []).filter((c) => !c.deleted && c.started_at);

/** Distinct training days per week: finished workouts with a working set, and logged cardio. */
export function daysPerWeek(workouts, cardio = []) {
  const weeks = new Map();
  const add = (iso) => {
    const w = weekOf(iso);
    if (!weeks.has(w)) weeks.set(w, new Set());
    weeks.get(w).add(dateKey(iso));
  };
  finished(workouts).forEach((w) => add(w.started_at));
  liveCardio(cardio).forEach((c) => add(c.started_at));
  return new Map([...weeks].map(([k, v]) => [k, v.size]));
}

/**
 * Weekly streak: consecutive weeks where you trained on at least `goal` days (your planned days a week).
 * One missed week per calendar month is covered by a freeze, used automatically. The current week never
 * breaks the streak while it's still in progress.
 * Returns { current, best, goal, thisWeek, frozen: [week keys], freezeLeft }.
 */
export function streak(workouts, cardio, goal, now = Date.now()) {
  const counts = daysPerWeek(workouts, cardio);
  const thisWeek = weekOf(new Date(now).toISOString());
  const weeks = [...counts.keys()].sort();
  const result = { current: 0, best: 0, goal, thisWeek: { done: counts.get(thisWeek) || 0, goal }, frozen: [], freezeLeft: true };
  if (!weeks.length) return result;
  const usedFreeze = new Set(); // 'YYYY-MM' of the months whose freeze is spent
  let run = 0;
  let best = 0;
  const frozen = [];
  for (let wk = weeks[0]; wk <= thisWeek; wk = addWeeks(wk, 1)) {
    const hit = (counts.get(wk) || 0) >= goal;
    const month = wk.slice(0, 7);
    if (hit) {
      run++;
    } else if (wk === thisWeek) {
      // still in progress: neither extends nor breaks the run
    } else if (run > 0 && !usedFreeze.has(month)) {
      usedFreeze.add(month);
      frozen.push(wk);
    } else {
      run = 0;
    }
    best = Math.max(best, run);
  }
  result.current = run;
  result.best = best;
  result.frozen = frozen;
  result.freezeLeft = !usedFreeze.has(thisWeek.slice(0, 7));
  return result;
}

// ---------- badges ----------
// The muscle groups "Full House" wants in one week: at least FULL_HOUSE_SETS working sets each, counted
// by the exercise's primary muscles (one full-body session alone doesn't do it).
export const FULL_HOUSE_SETS = 4;
export const FULL_HOUSE = {
  chest: ['chest'], back: ['lats', 'upper_back'], shoulders: ['front_delts', 'side_delts', 'rear_delts'],
  arms: ['biceps', 'triceps'], quads: ['quads'], hamstrings: ['hamstrings'], glutes: ['glutes'], core: ['abs', 'obliques'],
};
const GROUP_OF_MUSCLE = Object.fromEntries(Object.entries(FULL_HOUSE).flatMap(([g, ms]) => ms.map((m) => [m, g])));

// Each badge: id, name, how you earn it, and a test over the running totals after each workout.
export const BADGES = [
  { id: 'first', name: 'First Spark', how: 'Finish your first workout', test: (t) => t.workouts >= 1 },
  { id: 'w10', name: 'Ten Strikes', how: 'Finish 10 workouts', test: (t) => t.workouts >= 10 },
  { id: 'w50', name: 'Fifty Heats', how: 'Finish 50 workouts', test: (t) => t.workouts >= 50 },
  { id: 'w100', name: 'Centurion', how: 'Finish 100 workouts', test: (t) => t.workouts >= 100 },
  { id: 'w250', name: 'Forged in Fire', how: 'Finish 250 workouts', test: (t) => t.workouts >= 250 },
  { id: 'pr1', name: 'New Metal', how: 'Set your first PR', test: (t) => t.prs >= 1 },
  { id: 'pr10', name: 'Record Breaker', how: 'Set 10 PRs', test: (t) => t.prs >= 10 },
  { id: 'pr50', name: 'Hall of Records', how: 'Set 50 PRs', test: (t) => t.prs >= 50 },
  { id: 'pr3', name: 'Triple Strike', how: 'Set 3 PRs in one workout', test: (t) => t.maxPrsInWorkout >= 3 },
  { id: 'vol1', name: 'Ten Tons', how: 'Lift 10 tonnes (22,000 lb) in total', test: (t) => t.volumeKg >= 10000 },
  { id: 'vol2', name: 'Hundred Tons', how: 'Lift 100 tonnes in total', test: (t) => t.volumeKg >= 100000 },
  { id: 'vol3', name: 'Mountain Mover', how: 'Lift 1,000 tonnes in total', test: (t) => t.volumeKg >= 1000000 },
  { id: 'big', name: 'Heavy Day', how: 'Lift 10 tonnes in one workout', test: (t) => t.maxVolumeKg >= 10000 },
  { id: 'st4', name: 'Hot Streak', how: 'Hit your planned days 4 weeks running', test: (t) => t.bestStreak >= 4 },
  { id: 'st12', name: 'Heat Treated', how: 'Hit your planned days 12 weeks running', test: (t) => t.bestStreak >= 12 },
  { id: 'st26', name: 'Half-Year Forge', how: 'Hit your planned days 26 weeks running', test: (t) => t.bestStreak >= 26 },
  { id: 'full', name: 'Full House', how: 'In one week, 4+ sets for every major muscle group', test: (t) => t.fullHouse },
  { id: 'deload', name: 'Recovery Respect', how: 'Finish a workout in a deload week', test: (t) => t.deloads >= 1 },
  { id: 'comeback', name: 'Comeback', how: 'Train again after 3 weeks or more away', test: (t) => t.comebacks >= 1 },
  { id: 'dawn', name: 'Dawn Patrol', how: 'Start 5 workouts before 7 am', test: (t) => t.early >= 5 },
  { id: 'night', name: 'Night Shift', how: 'Start 5 workouts after 8 pm', test: (t) => t.late >= 5 },
  { id: 'lv11', name: 'Into the Forge', how: 'Reach level 11 (Hammer Strike)', test: (t) => t.level >= 11 },
];

// What each countable badge is measured by: [running total in awardsFor's `t`, target, unit shown on the card back].
// Badges without an entry (Full House, Recovery Respect, Comeback) are yes/no and show no bar.
export const METERS = {
  first: ['workouts', 1, 'workouts'], w10: ['workouts', 10, 'workouts'], w50: ['workouts', 50, 'workouts'],
  w100: ['workouts', 100, 'workouts'], w250: ['workouts', 250, 'workouts'],
  pr1: ['prs', 1, 'PRs'], pr10: ['prs', 10, 'PRs'], pr50: ['prs', 50, 'PRs'], pr3: ['maxPrsInWorkout', 3, 'PRs in one workout'],
  vol1: ['volumeKg', 10000, 'kg lifted'], vol2: ['volumeKg', 100000, 'kg lifted'], vol3: ['volumeKg', 1000000, 'kg lifted'],
  big: ['maxVolumeKg', 10000, 'kg in one workout'],
  st4: ['bestStreak', 4, 'weeks'], st12: ['bestStreak', 12, 'weeks'], st26: ['bestStreak', 26, 'weeks'],
  dawn: ['early', 5, 'early workouts'], night: ['late', 5, 'late workouts'], lv11: ['level', 11, 'level'],
};
/** { cur, goal, unit } for a badge from the running totals, or null when it has no count. cur is capped at goal. */
export function badgeProgress(id, t) {
  const m = METERS[id];
  if (!m) return null;
  return { cur: Math.min(m[1], t[m[0]] || 0), goal: m[1], unit: m[2] };
}

/**
 * Which workouts get the weekly-goal +100: the one that brings its week to `goal` training days, or, when
 * cardio logged after your last workout of the week completes the goal (lift Mon/Wed, run Fri), that last
 * workout. Once a week; a week with no workout gets none. Returns a Set of workout ids.
 */
export function weeklyBonusIds(list, cardioList, goal) {
  const all = new Map(); // week → Set(day) for the whole week
  const add = (m, at) => { const k = weekOf(at); if (!m.has(k)) m.set(k, new Set()); m.get(k).add(dateKey(at)); };
  for (const w of list) add(all, w.started_at);
  for (const c of cardioList) add(all, c.started_at);
  const so = new Map();
  const out = new Set();
  const crossed = new Set();
  const lastOfWeek = new Map();
  let ci = 0;
  for (const w of list) {
    while (ci < cardioList.length && cardioList[ci].started_at <= w.started_at) add(so, cardioList[ci++].started_at);
    const wk = weekOf(w.started_at);
    const before = so.has(wk) ? so.get(wk).size : 0;
    add(so, w.started_at);
    if (!crossed.has(wk) && before < goal && so.get(wk).size >= goal) { crossed.add(wk); out.add(w.id); }
    lastOfWeek.set(wk, w.id);
  }
  for (const [wk, id] of lastOfWeek) if (!crossed.has(wk) && all.get(wk).size >= goal) out.add(id);
  return out;
}

/**
 * One pass over your history: XP per workout (with the weekly-goal bonus and badge XP), badges with the
 * workout that unlocked them, total XP and level.
 *   opts.seen          settings/main.awards_seen ({ id: ISO date }): badges stay earned once seen
 *   opts.exerciseById  for Full House (primary muscles); without it Full House is never unlocked
 *   opts.extraBadges   badges decided elsewhere (js/missions/badges.js), listed after the rest: [{ id, name, how, earned }]
 *   opts.bonusXP       XP from outside workouts (daily missions and their badges), added to the total and the level
 * Returns { total, level, perWorkout: Map(id → { xp, badges: [ids], at }), badges: [{ id, name, how, earned }] }
 */
export function awardsFor(workouts, cardio = [], goal = 3, { seen = {}, exerciseById = null, extraBadges = [], bonusXP = 0 } = {}) {
  const list = finished(workouts);
  const cardioList = liveCardio(cardio).sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
  const t = { workouts: 0, prs: 0, maxPrsInWorkout: 0, volumeKg: 0, maxVolumeKg: 0, bestStreak: 0, early: 0, late: 0, level: 1, xp: 0, fullHouse: false, deloads: 0, comebacks: 0 };
  const earned = {};
  const perWorkout = new Map();
  const weekGroups = new Map(); // week → { group: working sets }
  const upTo = [];
  let ci = 0;
  let lastAt = null; // last training activity (workout or logged cardio), for Comeback
  const bonus = weeklyBonusIds(list, cardioList, goal);
  for (const w of list) {
    upTo.push(w);
    const wk = weekOf(w.started_at);
    // Cardio logged before this workout counts as activity for Comeback.
    while (ci < cardioList.length && cardioList[ci].started_at <= w.started_at) lastAt = Math.max(lastAt ?? 0, Date.parse(cardioList[ci++].started_at));
    const week = bonus.has(w.id); // weekly-goal +100 (see weeklyBonusIds)

    t.workouts++;
    const prs = (w.prs || []).length;
    t.prs += prs;
    t.maxPrsInWorkout = Math.max(t.maxPrsInWorkout, prs);
    let vol = 0;
    for (const it of w.exercises || []) {
      for (const s of it.sets || []) if (s.done && !s.warmup && s.weight_kg && s.reps) vol += s.weight_kg * s.reps;
      const n = workingSets(it);
      if (exerciseById && n > 0) {
        const ex = exerciseById(it.exercise_id);
        if (!weekGroups.has(wk)) weekGroups.set(wk, {});
        const g = weekGroups.get(wk);
        for (const grp of new Set(((ex && ex.primary) || []).map((m) => GROUP_OF_MUSCLE[m]).filter(Boolean))) g[grp] = (g[grp] || 0) + n;
      }
    }
    if (weekGroups.has(wk) && Object.keys(FULL_HOUSE).every((grp) => (weekGroups.get(wk)[grp] || 0) >= FULL_HOUSE_SETS)) t.fullHouse = true;
    t.volumeKg += vol;
    t.maxVolumeKg = Math.max(t.maxVolumeKg, vol);
    if (w.deload) t.deloads++;
    if (lastAt != null && Date.parse(w.started_at) - lastAt >= 21 * 86400000) t.comebacks++;
    lastAt = Math.max(lastAt ?? 0, Date.parse(w.started_at));
    const h = new Date(w.started_at).getHours();
    if (h < 7) t.early++;
    if (h >= 20) t.late++;
    const at = w.finished_at || w.started_at;
    t.bestStreak = streak(upTo, cardioList.filter((c) => c.started_at <= at), goal, Date.parse(at)).best;

    // XP without badges first, then badges (badge XP can unlock "Into the Forge", so repeat until stable).
    t.xp += workoutXP(w, { week }).total;
    const mine = [];
    for (let changed = true; changed;) {
      changed = false;
      t.level = levelFor(t.xp).level;
      for (const b of BADGES) {
        if (earned[b.id] || !b.test(t)) continue;
        earned[b.id] = { at, workoutId: w.id };
        mine.push(b.id);
        t.xp += XP.badge;
        changed = true;
      }
    }
    perWorkout.set(w.id, { xp: workoutXP(w, { week, badges: mine.length }), badges: mine, at });
  }
  // Badges you earned before that today's history no longer unlocks (planned days changed, a workout
  // deleted…) stay earned and keep their XP.
  let kept = 0;
  for (const [id, date] of Object.entries(seen || {})) {
    if (earned[id] || !BADGES.some((b) => b.id === id)) continue;
    earned[id] = { at: date, workoutId: null };
    kept++;
  }
  const total = t.xp + kept * XP.badge + (bonusXP || 0);
  return {
    total,
    level: levelFor(total),
    perWorkout,
    badges: [...BADGES.map((b) => ({ id: b.id, name: b.name, how: b.how, earned: earned[b.id] || null, progress: badgeProgress(b.id, t) })), ...extraBadges.map((b) => ({ ...b, extra: true }))],
  };
}

export const totalXP = (workouts, cardio = [], goal = 3, opts = {}) => awardsFor(workouts, cardio, goal, opts).total;
export const badges = (workouts, cardio = [], goal = 3, opts = {}) => awardsFor(workouts, cardio, goal, opts).badges;

/** Badges to add to settings/main.awards_seen: earned now but not seen yet. { id: date } or null if none. */
export function unseenBadges(list, seen = {}) {
  const add = {};
  for (const b of list) if (b.earned && !(seen && seen[b.id])) add[b.id] = b.earned.at;
  return Object.keys(add).length ? add : null;
}

/**
 * Everything the summary screen needs about one workout: XP, level before/after, the badges it unlocked
 * (`badges`), the ones to celebrate (`celebrate`: not in `seen` yet), and the streak.
 */
export function workoutAwards(workouts, cardio, goal, workoutId, now = Date.now(), opts = {}) {
  const a = awardsFor(workouts, cardio, goal, opts);
  const mine = a.perWorkout.get(workoutId);
  if (!mine) return null;
  const list = finished(workouts);
  const idx = list.findIndex((w) => w.id === workoutId);
  let before = list.slice(0, idx).reduce((n, w) => n + a.perWorkout.get(w.id).xp.total, 0);
  // Kept badges (earned before, no longer unlocked by history) count toward the level before, by date.
  for (const b of a.badges) if (b.earned && !b.extra && !b.earned.workoutId && b.earned.at < mine.at) before += XP.badge;
  before += opts.bonusXP || 0; // mission XP isn't tied to a workout: it counts toward the level you started from
  const lvBefore = levelFor(before);
  const lvAfter = levelFor(before + mine.xp.total);
  const byId = Object.fromEntries(a.badges.map((b) => [b.id, b]));
  const unlocked = mine.badges.map((id) => byId[id]);
  const seen = opts.seen || {};
  return {
    xp: mine.xp, before: lvBefore, after: lvAfter, levelUp: lvAfter.level > lvBefore.level,
    badges: unlocked, celebrate: unlocked.filter((b) => !seen[b.id]),
    streak: streak(workouts, cardio, goal, now), all: a.badges,
  };
}
