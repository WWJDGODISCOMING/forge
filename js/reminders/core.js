// Smart reminders (v0.16.77, #219): pure planning. Which local notifications to schedule, and which to leave out because
// the thing is already done. No clock, storage or plugin in here; js/reminders/store.js feeds it live data.
//
// Honest limit: a notification is scheduled ahead of time. Forge can only skip one using what it knew when it last
// scheduled (when you opened the app or your data changed), so steps that sync from Apple Health later in the day
// can't cancel a nudge that is already queued. Text for later days is kept general for the same reason.

export const KINDS = ['weigh', 'steps', 'protein', 'food', 'workout'];
export const DAYS_AHEAD = 3;
export const BASE_ID = 4200; // 4200 + kindIndex * 10 + dayOffset; the rest timer is 4101, the refresh reminder 4102

export const META = {
  weigh: { label: 'Weigh in', hint: 'Morning nudge. Skipped once you have weighed in.', time: '07:30' },
  steps: { label: 'Steps', hint: 'Evening nudge with the steps you have left. Skipped once you hit your goal.', time: '18:30' },
  protein: { label: 'Protein', hint: 'Evening nudge with the protein you have left. Skipped once you hit your goal.', time: '19:00' },
  food: { label: 'Log food', hint: 'Only if nothing is logged by this time.', time: '13:00' },
  workout: { label: 'Workout day', hint: 'Skipped once you have trained today or met your weekly plan.', time: '17:00' },
};

export const DEFAULT_QUIET = { on: true, from: '22:00', to: '07:00' };

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
export const validTime = (s) => typeof s === 'string' && TIME_RE.test(s);
export const toMin = (s) => { const m = TIME_RE.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export const pad = (s) => (validTime(s) ? s.padStart(5, '0') : null);

/** Stored value (anything) → the full settings object. Every reminder is off unless it was switched on. */
export function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = { quiet: { ...DEFAULT_QUIET } };
  const q = r.quiet && typeof r.quiet === 'object' ? r.quiet : {};
  if (q.on === false) out.quiet.on = false;
  if (validTime(q.from)) out.quiet.from = pad(q.from);
  if (validTime(q.to)) out.quiet.to = pad(q.to);
  for (const k of KINDS) {
    const v = r[k] && typeof r[k] === 'object' ? r[k] : {};
    out[k] = { on: v.on === true, time: validTime(v.time) ? pad(v.time) : META[k].time };
  }
  return out;
}

export const anyOn = (s) => KINDS.some((k) => s && s[k] && s[k].on);

/** `min` (minutes after midnight) falls inside quiet hours. */
export function inQuiet(min, quiet) {
  if (!quiet || !quiet.on) return false;
  const a = toMin(quiet.from);
  const b = toMin(quiet.to);
  if (a == null || b == null || a === b) return false;
  return a < b ? min >= a && min < b : min >= a || min < b;
}

/**
 * When a reminder set for `time` really fires, as minutes after midnight, or null to skip it that day.
 * Inside quiet hours it waits until they end if that is later the same day (a 6:30 weigh-in becomes 7:00), otherwise it is skipped.
 */
export function effectiveMinute(time, quiet) {
  const t = toMin(time);
  if (t == null) return null;
  if (!inQuiet(t, quiet)) return t;
  const end = toMin(quiet.to);
  return end > t ? end : null;
}

const at = (base, offset, min) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset, Math.floor(min / 60), min % 60, 0, 0);

const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

/** Is this reminder already satisfied for today? `snap` is what the app knows right now. */
export function doneToday(kind, snap) {
  const s = snap || {};
  switch (kind) {
    case 'weigh': return !!s.weighedIn;
    case 'steps': return num(s.steps) != null && num(s.stepsGoal) != null && s.steps >= s.stepsGoal;
    case 'protein': return num(s.proteinGoal) == null || (num(s.protein) != null && s.protein >= s.proteinGoal);
    case 'food': return (num(s.foodCount) || 0) > 0;
    case 'workout': return !!s.trained || !!s.weekMet;
    default: return true;
  }
}

/** Title and body. Today's text may use the numbers; later days stay general because the numbers aren't known yet. */
export function message(kind, snap, today) {
  const s = snap || {};
  switch (kind) {
    case 'weigh': return { title: 'Weigh in', body: 'A quick morning weigh-in keeps your trend honest.' };
    case 'steps': {
      const left = today && num(s.steps) != null && num(s.stepsGoal) != null ? s.stepsGoal - s.steps : null;
      return { title: 'Steps', body: left != null && left > 0 ? `${fmt(left)} steps to go for today’s goal. A short walk gets you there.` : 'A walk before the day ends? Check your steps in Forge.' };
    }
    case 'protein': {
      const left = today && num(s.protein) != null && num(s.proteinGoal) != null ? Math.ceil(s.proteinGoal - s.protein) : null;
      return { title: 'Protein', body: left != null && left > 0 ? `About ${fmt(left)} g of protein left for today.` : 'See how your protein is looking today.' };
    }
    case 'food': return { title: 'Log your food', body: 'Nothing logged yet today. It takes a few seconds.' };
    default: return { title: 'Workout day', body: 'Your plan has a session waiting. Even a short one counts.' };
  }
}

/**
 * The notifications to have scheduled: today (unless already done or past) and the next days (unknown, so general).
 * Returns [{ id, kind, at: ms, title, body }]. `now` is a Date.
 */
export function planReminders({ now, settings, snap, days = DAYS_AHEAD }) {
  const s = normalize(settings);
  const out = [];
  KINDS.forEach((kind, ki) => {
    if (!s[kind].on) return;
    const min = effectiveMinute(s[kind].time, s.quiet);
    if (min == null) return;
    for (let d = 0; d < days; d++) {
      const when = at(now, d, min);
      if (when.getTime() <= now.getTime() + 30000) continue;
      if (d === 0 && doneToday(kind, snap)) continue;
      const m = message(kind, snap, d === 0);
      out.push({ id: BASE_ID + ki * 10 + d, kind, at: when.getTime(), ...m });
    }
  });
  return out;
}

/** Every id this feature may have scheduled, for cancelling before a fresh plan. */
export const ALL_IDS = KINDS.flatMap((_, ki) => Array.from({ length: DAYS_AHEAD }, (__, d) => BASE_ID + ki * 10 + d));

/**
 * In-app banner (the web app can't notify): reminders whose time has passed today and which aren't done or dismissed.
 * `dismissed` is an array of kinds hidden for today. Never more than two at once.
 */
export function dueBanners({ now, settings, snap, dismissed = [] }) {
  const s = normalize(settings);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (inQuiet(nowMin, s.quiet)) return [];
  const out = [];
  for (const kind of KINDS) {
    if (!s[kind].on || dismissed.includes(kind)) continue;
    const min = effectiveMinute(s[kind].time, s.quiet);
    if (min == null || nowMin < min || doneToday(kind, snap)) continue;
    out.push({ kind, ...message(kind, snap, true) });
  }
  return out.slice(0, 2);
}

/** One honest line for Settings. */
export const HONEST_LINE = 'Reminders skip themselves when you have already done the thing, based on what Forge knew when you last opened it. Steps that sync from Apple Health later can’t cancel one that is already set.';
