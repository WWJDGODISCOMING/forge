// Daily missions: small real actions judged from data the app already has. Pure functions, no DOM, no state;
// js/missions/store.js reads state and settings. See docs/missions.md.
import { stepsSourceLabel } from '../steps-source.js';

export const MISSION_XP = 20; // per mission
export const ALL_DONE_XP = 30; // bonus when every mission of the day is done
export const MAX_MISSIONS = 4;
export const MOVE_MIN = 20; // cardio minutes that count as "moved"
export const DEFAULTS = { steps: 8000, bed: '23:00' };
export const MISSION_XP_RULES = '+20 per daily mission, and +30 more when you finish all of the day’s missions (counted from the day you first opened missions).';

const pad = (n) => String(n).padStart(2, '0');
/** Local calendar day (YYYY-MM-DD) of a timestamp. */
export const localDay = (t) => {
  if (t == null) return null;
  const d = new Date(t);
  return Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null;
};
export const shiftDay = (key, n) => {
  const [y, m, d] = key.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + n));
};
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** 'HH:MM' → minutes after midnight, or null. */
export function parseClock(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
}
// Bedtimes after midnight belong to the same night: 00:30 is later than 23:00.
const nightMin = (min) => (min < 12 * 60 ? min + 1440 : min);

/** Everything the missions need, grouped by local day once (so many days can be judged cheaply). */
export function indexDays({ weights = [], bodyMeasures = [], workouts = [], cardio = [], healthDaily = [], foodLogs = null } = {}) {
  const weigh = new Set();
  for (const w of weights) if (w && !w.deleted && !w.review) { const d = w.day || localDay(w.measured_at); if (d) weigh.add(d); }
  for (const b of bodyMeasures) if (b && !b.deleted && !b.needs_review) { const d = b.day || localDay(b.measured_at); if (d) weigh.add(d); }
  const trained = new Set();
  for (const w of workouts) if (w && w.status === 'done' && !w.deleted) { const d = localDay(w.started_at); if (d) trained.add(d); }
  const moved = new Set();
  for (const c of cardio) if (c && !c.deleted && num(c.duration_min) >= MOVE_MIN) { const d = localDay(c.started_at); if (d) moved.add(d); }
  const health = new Map();
  for (const r of healthDaily) if (r && !r.deleted && /^\d{4}-\d{2}-\d{2}$/.test(r.id || r.day || '')) health.set(r.id || r.day, r);
  let protein = null; // null = no food logging: the protein mission stays hidden
  if (foodLogs && foodLogs.length) {
    protein = new Map();
    for (const f of foodLogs) {
      if (!f || f.deleted || num(f.protein_g) == null) continue;
      const d = f.day || localDay(f.logged_at || f.at);
      if (d) protein.set(d, (protein.get(d) || 0) + f.protein_g * (num(f.servings) ?? 1)); // protein_g is per serving
    }
  }
  return { weigh, trained, moved, health, protein };
}

/** Minutes after midnight (local) that last night's sleep started; null when the data doesn't say. */
function bedStart(row) {
  const s = row && row.sleep;
  if (!s || !s.in_bed_start) return null;
  const d = new Date(s.in_bed_start);
  return Number.isFinite(d.getTime()) ? d.getHours() * 60 + d.getMinutes() : null;
}

export function fmtClock(min) {
  const h = Math.floor(min / 60);
  return `${h % 12 || 12}:${pad(min % 60)} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * The missions for one local day, most important first, at most four.
 *   idx      indexDays(...)
 *   targets  { steps, bed: 'HH:MM', proteinG }
 *   restDay  nothing is planned for today: the Train mission asks for a walk
 * Each: { id, label, done, xp, progress?: { value, target, unit }, waiting?: no Apple Health row for the day yet }
 */
export function missionsFor(day, idx, { targets = {}, restDay = false } = {}) {
  const t = { ...DEFAULTS, ...targets };
  const list = [];
  list.push({ id: 'weigh', label: 'Weigh in', done: idx.weigh.has(day) });
  const trained = idx.trained.has(day);
  list.push({
    id: 'train',
    label: restDay && !trained ? `Rest day: a ${MOVE_MIN}-min walk counts` : 'Train or move',
    done: trained || idx.moved.has(day),
  });
  if (idx.protein && t.proteinG > 0) {
    const g = Math.round(idx.protein.get(day) || 0);
    list.push({ id: 'protein', label: 'Protein hit', done: g >= t.proteinG, progress: { value: g, target: Math.round(t.proteinG), unit: 'g protein' } });
  }
  if (idx.health.size) {
    const row = idx.health.get(day);
    if (row) {
      const steps = num(row.steps) || 0;
      list.push({ id: 'steps', label: 'Steps', done: steps >= t.steps, progress: { value: steps, target: t.steps, unit: 'steps', source: stepsSourceLabel(row) } });
    } else {
      list.push({ id: 'steps', label: 'Steps', done: false, waiting: true }); // Apple Health usually syncs once a day
    }
    const start = bedStart(idx.health.get(day));
    const target = parseClock(t.bed);
    if (start != null && target != null) list.push({ id: 'bed', label: `In bed by ${fmtClock(target)}`, done: nightMin(start) <= nightMin(target) });
  }
  return list.slice(0, MAX_MISSIONS).map((m) => ({ ...m, xp: MISSION_XP }));
}

export const allDone = (list) => list.length > 0 && list.every((m) => m.done);
/** XP for one day's missions: +20 each done, +30 when all are done. */
export const dayXP = (list) => list.filter((m) => m.done).length * MISSION_XP + (allDone(list) ? ALL_DONE_XP : 0);

/**
 * Total mission XP from `startedDay` (inclusive) to `today`. Nothing before the feature shipped, and
 * nothing if it hasn't been started. Days are judged with today's targets.
 */
export function missionXP(startedDay, today, idx, opts = {}) {
  if (!startedDay || !today || startedDay > today) return 0;
  let xp = 0;
  let n = 0;
  for (let d = startedDay; d <= today && n < 4000; d = shiftDay(d, 1), n++) xp += dayXP(missionsFor(d, idx, { ...opts, restDay: false }));
  return xp;
}

/** The last seven days ending `today`, each with how many missions were done. Days before `startedDay` aren't counted. */
export function weekDots(today, idx, opts = {}, startedDay = null) {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const day = shiftDay(today, -i);
    if (!startedDay || day < startedDay) { out.push({ day, counted: false, done: 0, total: 0, all: false }); continue; }
    const list = missionsFor(day, idx, { ...opts, restDay: false });
    out.push({ day, counted: true, done: list.filter((m) => m.done).length, total: list.length, all: allDone(list) });
  }
  return out;
}
