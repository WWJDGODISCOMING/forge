// Insight cards (W2b): turn trends and anomalies into a few plain-words cards, ranked by severity × recency.
// All wording comes from the templates below (no AI, never alarming or diagnostic). Pure functions.
import { daysBetween } from '../weight/smoothing.js';
import { shiftDay } from './metrics.js';
import { weightToDisplay, weightUnit } from '../units.js';
import { NOISE_FLOOR, trendMetric } from './trends.js';

export const TOP_N = 3;
export const DISMISS_DAYS = 7;
export const RECENCY_HALF_LIFE_DAYS = 7; // an insight loses half its weight for every 7 days it is old
export const MEDICAL = 'Not medical advice. If you feel unwell, talk to a doctor.';

/** severity × recency. `day` is the date the insight is about (the newest reading behind it). */
export const score = (c, today) => c.severity * Math.pow(0.5, Math.max(0, daysBetween(c.day, today)) / RECENCY_HALF_LIFE_DAYS);

/** Highest score first; ties by id so the order is stable. Dismissed ones (id → "until" day) are skipped. */
export function rankInsights(cands, today, { dismissed = {}, limit = TOP_N } = {}) {
  return cands
    .filter((c) => !(dismissed[c.id] && dismissed[c.id] > today))
    .map((c) => ({ ...c, rank: score(c, today) }))
    .sort((a, b) => b.rank - a.rank || (a.id < b.id ? -1 : 1))
    .slice(0, limit);
}

/** The still-active dismissals from settings.insight_dismissed ({ id: 'YYYY-MM-DD' until }). */
export function activeDismissals(settings, today) {
  const raw = (settings && settings.insight_dismissed) || {};
  return Object.fromEntries(Object.entries(raw).filter(([, until]) => typeof until === 'string' && until > today));
}

/** The settings change that hides an insight for 7 days (and forgets old dismissals). */
export function dismissChange(settings, id, today) {
  return { insight_dismissed: { ...activeDismissals(settings, today), [id]: shiftDay(today, DISMISS_DAYS) } };
}

// ---- wording ----

/** An amount in plain units: "0.4 lb", "1.2 points", "3 bpm". v is in the metric's stored unit. */
export function fmtAmount(metric, v, units) {
  const kind = (trendMetric(metric) || {}).kind;
  const a = Math.abs(v);
  switch (kind) {
    case 'mass': return `${weightToDisplay(a, units).toFixed(2)} ${weightUnit(units)}`;
    case 'pct': return `${a.toFixed(2)} points`;
    case 'bpm': return `${a.toFixed(1)} bpm`;
    case 'ms': return `${a.toFixed(1)} ms`;
    case 'sleep': case 'minutes': return `${Math.round(a)} min`;
    case 'count': return `${Math.round(a).toLocaleString()} steps`;
    default: return a.toFixed(2);
  }
}

const PLURAL_LABEL = new Set(['steps', 'exercise_min']);
// Per-day series measured as a daily amount; the unit says so ("steps/day", "min/night").
const DAILY_UNIT = { count: 'steps/day', sleep: 'min/night', minutes: 'min/day' };

/** The change over the whole window with its unit: "+2,520 steps/day", "−0.6 lb". The fit slope is per week, so scale by weeks in the window. */
export function fmtChange(metric, slopePerWeek, windowDays, units) {
  const kind = (trendMetric(metric) || {}).kind;
  const total = slopePerWeek * (windowDays / 7);
  const sign = total < 0 ? '−' : '+'; // a real minus sign, not a hyphen
  const a = Math.abs(total);
  const one = (v) => (Number(v.toFixed(1)) === 0 ? null : v.toFixed(1)); // null: rounds to no change
  const out = (txt) => (txt == null ? null : `${sign}${txt}`);
  if (metric === 'vo2max') { const t = one(a); return out(t && `${t} ml/kg/min`); }
  if (kind === 'mass') { const t = one(weightToDisplay(a, units)); return out(t && `${t} ${weightUnit(units)}`); }
  if (kind === 'pct') { const t = one(a); return out(t && `${t}% body fat`); }
  if (kind === 'index') { const t = one(a); return out(t && `${t} on the visceral fat index`); }
  if (kind === 'bpm') return Math.round(a) === 0 ? null : out(`${Math.round(a)} bpm`);
  if (kind === 'ms') { const t = one(a); return out(t && `${t} ms`); }
  if (kind === 'sleep' || kind === 'minutes' || kind === 'count') {
    const r = Math.round(a);
    if (r === 0) return null;
    if (kind === 'sleep' && r >= 60) return out(`${Math.floor(r / 60)} h${r % 60 ? ` ${r % 60} min` : ''}/night`);
    return out(`${fmtAmount(metric, total, units).replace(/ (steps|min)$/, '')} ${DAILY_UNIT[kind]}`);
  }
  return out(fmtAmount(metric, total, units));
}

function trendBody(metric, tr, w, units) {
  const span = w === 28 ? '4 weeks' : '3 months';
  const change = fmtChange(metric, tr.slopePerWeek, w, units);
  const kind = (trendMetric(metric) || {}).kind;
  if (change == null) return `About the same as ${span} ago.`;
  return DAILY_UNIT[kind] ? `${change} vs ${span} ago.` : `${change} over ${span}.`;
}

// What a rising / falling 28-day trend means and what to do, per metric. { why, todo } per direction.
const TREND_COPY = {
  weight_kg: {
    down: { why: 'Your smoothed weight is falling. Smoothing hides water swings, so this is real change.', todo: 'If you are aiming to lose, keep going. Check the goal path to see the pace.' },
    up: { why: 'Your smoothed weight is rising. Smoothing hides water swings, so this is real change.', todo: 'If you are aiming to gain, great. If not, look at the goal path and your food.' },
  },
  fat_ratio_pct: {
    down: { why: 'Body fat % is estimated by the scale, so only a steady change over weeks counts.', todo: 'Keep your routine. Weigh in at the same time of day for cleaner readings.' },
    up: { why: 'Body fat % is estimated by the scale, so only a steady change over weeks counts.', todo: 'Check that your weigh-ins are at a similar time of day, then look at fat mass.' },
  },
  fat_mass_kg: {
    down: { why: 'Fat mass is falling over four weeks.', todo: 'Keep protein up and keep lifting so the loss is fat, not muscle.' },
    up: { why: 'Fat mass is rising over four weeks.', todo: 'If you are bulking on purpose, fine. If not, trim portions a little.' },
  },
  fat_free_mass_kg: {
    down: { why: 'Fat-free mass (muscle, bone, water) is falling over four weeks.', todo: 'Keep protein up and keep lifting. A dip in the first weeks of a diet is often water.' },
    up: { why: 'Fat-free mass (muscle, bone, water) is rising over four weeks.', todo: 'Keep training and eating enough protein.' },
  },
  muscle_mass_kg: {
    down: { why: 'The scale’s muscle estimate is falling over four weeks.', todo: 'Keep protein up and keep lifting. Small dips are within the scale’s error.' },
    up: { why: 'The scale’s muscle estimate is rising over four weeks.', todo: 'Keep training and eating enough protein.' },
  },
  hydration_kg: {
    down: { why: 'Body water is drifting down.', todo: 'Drink a little more through the day.' },
    up: { why: 'Body water is drifting up.', todo: 'Nothing to do. It often follows carbs, salt or training.' },
  },
  visceral_fat: {
    down: { why: 'Visceral fat is the fat around your organs. It tends to fall early in a fat-loss phase.', todo: 'Keep doing what you are doing.' },
    up: { why: 'Visceral fat is the fat around your organs. It is an estimate, so look at the long trend.', todo: 'Walking and a steady routine help. Check again in a month.' },
  },
  heart_pulse_bpm: {
    down: { why: 'Your standing heart rate on the scale is trending lower.', todo: 'Often a sign of improving fitness. Keep it up.' },
    up: { why: 'Your standing heart rate on the scale is trending higher. Coffee, stress and poor sleep can do this.', todo: 'Look at sleep and rest this week.' },
  },
  hrv_sdnn_ms: {
    down: { why: 'HRV is trending lower than your usual. Stress, short sleep and hard weeks can do this.', todo: 'Protect your sleep and keep one full rest day this week.' },
    up: { why: 'HRV is trending higher, a sign you are recovering well.', todo: 'Good time to push a little in training.' },
  },
  rhr_bpm: {
    down: { why: 'Your resting heart rate is trending lower, often a sign of better fitness or recovery.', todo: 'Keep it up.' },
    up: { why: 'Your resting heart rate is trending higher. Stress, poor sleep or a heavy week can do this.', todo: 'Take it easier and protect your sleep for a few days.' },
  },
  sleep_min: {
    down: { why: 'You are sleeping a little less than before.', todo: 'Try getting into bed 30 minutes earlier tonight.' },
    up: { why: 'You are sleeping a little more than before.', todo: 'Nice. Keep your bedtime steady.' },
  },
  steps: {
    down: { why: 'You are walking a bit less than before.', todo: 'A 15-minute walk after a meal brings it back.' },
    up: { why: 'You are walking more than before.', todo: 'Keep it going.' },
  },
  exercise_min: {
    down: { why: 'You are getting fewer exercise minutes than before.', todo: 'Book your next session now so it happens.' },
    up: { why: 'You are getting more exercise minutes than before.', todo: 'Keep one easy day in the week so you recover.' },
  },
};
const MEDICAL_TREND = new Set(['heart_pulse_bpm', 'rhr_bpm']);
const hrefFor = (metric) => `#/metric/${metric}`;

/** Which window a metric's insight is based on: slow-moving metrics use 90 days, the rest 28. */
export const insightWindow = (metric) => (metric === 'visceral_fat' ? 90 : 28);

function trendCard(t, units) {
  const w = insightWindow(t.key);
  const tr = t.trends[w];
  if (!tr.enough || tr.direction === 'flat') return null;
  const copy = (TREND_COPY[t.key] || {})[tr.direction];
  if (!copy) return null;
  if (fmtChange(t.key, tr.slopePerWeek, w, units) == null) return null; // rounds to no change: no card
  const ratio = Math.abs(tr.slopePerWeek) / (NOISE_FLOOR[t.key] || 1);
  const severity = Math.min(0.7, 0.15 + 0.08 * ratio + (t.tone === 'bad' ? 0.1 : 0));
  return {
    id: `trend:${t.key}:${tr.direction}`, kind: 'trend', metric: t.key, severity, day: t.last.day,
    title: `${t.label} ${PLURAL_LABEL.has(t.key) ? 'are' : 'is'} trending ${tr.direction === 'up' ? 'up' : 'down'}`,
    body: trendBody(t.key, tr, w, units),
    why: copy.why, todo: copy.todo, href: hrefFor(t.key), tone: t.tone,
    ...(MEDICAL_TREND.has(t.key) ? { note: MEDICAL } : {}),
  };
}

/** Cards that read two metrics together. Returns the card plus the metrics it covers (so their own cards are dropped). */
export function crossCards(byKey, units, goal) {
  const dir = (k) => { const m = byKey[k]; return m ? (m.t28.enough ? m.t28.direction : null) : null; };
  const slope = (k) => byKey[k].t28.slopePerWeek;
  const fat = dir('fat_mass_kg');
  const leanKey = dir('fat_free_mass_kg') ? 'fat_free_mass_kg' : dir('muscle_mass_kg') ? 'muscle_mass_kg' : null;
  const lean = leanKey ? dir(leanKey) : null;
  if (!fat || !lean) return [];
  const day = byKey.fat_mass_kg.last.day;
  const covers = ['fat_mass_kg', leanKey];
  const mk = (id, severity, title, body, why, todo, tone) => ({ id, kind: 'cross', metric: 'fat_mass_kg', covers, severity, day, title, body, why, todo, href: hrefFor('fat_mass_kg'), tone });
  const f = fmtAmount('fat_mass_kg', slope('fat_mass_kg'), units);
  if (fat === 'down' && lean === 'flat') {
    return [mk('cross:cut', 0.65, 'Nice cut', `Fat mass is down ${f} a week while your lean mass is holding steady.`, 'That is the best kind of weight loss: fat goes, muscle stays.', 'Keep your protein up and keep lifting heavy.', 'good')];
  }
  if (fat === 'down' && lean === 'up') {
    return [mk('cross:recomp', 0.7, 'Losing fat and building muscle', `Fat mass is down ${f} a week and lean mass is up ${fmtAmount(leanKey, slope(leanKey), units)} a week.`, 'This is a recomposition, the hardest thing to do.', 'Change nothing. Keep training and eating the same.', 'good')];
  }
  if (fat === 'down' && lean === 'down') {
    return [mk('cross:lean-loss', 0.7, 'Some muscle may be going too', `Fat mass is down ${f} a week and lean mass is down ${fmtAmount(leanKey, slope(leanKey), units)} a week.`, 'Part of the weight you are losing is not fat. Early in a diet some of it is water.', 'Eat enough protein, lift heavy, and do not cut calories further for now.', 'bad')];
  }
  if (fat === 'up' && lean === 'down') {
    return [mk('cross:wrong-way', 0.7, 'Fat is up and lean mass is down', `Fat mass is up ${f} a week while lean mass is down.`, 'Often this follows a stretch of less training and more food.', 'Start with two lifting sessions this week and aim for steady protein.', 'bad')];
  }
  if (fat === 'up' && lean === 'up' && goal === 'muscle') {
    return [mk('cross:bulk', 0.5, 'Gaining muscle and some fat', `Lean mass is up ${fmtAmount(leanKey, slope(leanKey), units)} a week and fat mass is up ${f} a week.`, 'That is normal when building. Keep an eye on the pace.', 'If fat rises faster than muscle, trim a little off your daily calories.', 'neutral')];
  }
  return [];
}

const hours = (min) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} min`;

/** Wording for each anomaly kind. */
const ANOMALY_COPY = {
  water: (d, u) => ({ title: 'Likely water', body: `Today’s weight is ${Math.abs(d.pct).toFixed(1)}% ${d.pct > 0 ? 'above' : 'below'} your trend, and your water reading moved the same way. Likely water. Your trend hasn’t changed.`, why: 'Water and salt swing your weight by a kilo or more in a day.', todo: 'Nothing to change. Weigh in again tomorrow morning.', href: '#/body/weight' }),
  fatnoise: (d) => ({ title: 'Body fat reading jumped', body: `Body fat moved ${Math.abs(d.jump).toFixed(1)} points in a day. Bioimpedance noise (hydration, time of day). Trend unchanged.`, why: 'The scale estimates fat from a tiny electric current, so a drink or a workout can shift it.', todo: 'Look at the weekly trend, not one reading.', href: hrefFor('fat_ratio_pct') }),
  hrv: (d) => ({ title: 'HRV is lower than usual', body: `Your 7-day HRV is ${Math.round(d.dropPct)}% below your 4-week normal.`, why: 'A lower HRV often goes with stress, short sleep or a hard training week.', todo: 'Protect your sleep and keep the next workout easy.', href: hrefFor('hrv_sdnn_ms') }),
  rhr: (d) => ({ title: 'Resting heart rate is up', body: `Your resting heart rate has been about ${Math.round(d.up)} bpm above your usual for ${d.nights} days.`, why: 'Stress, short sleep, heat or a hard week can raise it for a few days.', todo: 'Take it easy, drink water and sleep well.', href: hrefFor('rhr_bpm'), note: MEDICAL }),
  temp: (d) => ({ title: 'Wrist temperature is up', body: `Your wrist temperature has been ${d.delta.toFixed(1)} °C above your usual for ${d.nights} nights.`, why: 'Late nights, a warm room, alcohol or feeling run down can all raise it.', todo: 'Rest up, drink water and see how you feel.', href: '#/apple', note: MEDICAL }),
  sleep: (d) => ({ title: 'Short sleep three nights running', body: `You slept about ${hours(d.avgMin)} a night.`, why: 'Short sleep slows recovery and makes training feel harder.', todo: 'Try getting into bed 30 minutes earlier tonight.', href: hrefFor('sleep_min') }),
  weighin: (d) => ({ title: 'Time for a weigh-in', body: `It has been ${d.gapDays} days since your last one.`, why: 'Your trend needs a few weigh-ins a week to stay accurate.', todo: 'Step on the scale tomorrow morning, before eating.', href: '#/body/weight' }),
};

/** Candidate cards from trends (allTrends() output) and anomalies (detectAnomalies() output). */
export function buildInsights({ trends = [], anomalies = [], units = 'imperial', goal = 'health' }) {
  const byKey = Object.fromEntries(trends.map((t) => [t.key, t]));
  const cross = crossCards(byKey, units, goal);
  const covered = new Set(cross.flatMap((c) => c.covers));
  const out = [...cross];
  for (const t of trends) if (!covered.has(t.key)) { const c = trendCard(t, units); if (c) out.push(c); }
  for (const a of anomalies) {
    const make = ANOMALY_COPY[a.kind];
    if (make) out.push({ id: `anomaly:${a.kind}`, kind: 'anomaly', metric: a.kind, severity: a.severity, day: a.day, tone: 'neutral', ...make(a.data, units) });
  }
  return out;
}
