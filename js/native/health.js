// Apple Health straight from HealthKit, inside the iPhone app only (js/native/bridge.js). It replaces the
// Shortcut and the export.zip import there: Forge reads the same signals, turns them into the same daily
// summaries with the same code the export import uses (js/health/apple-export.js), and sends only those
// summaries to importHealthDays. No raw samples leave the phone. Pure except readHealthDays (plugin calls).
//
// Plugin: @capgo/capacitor-health (Capacitor 8). Its data types → the HealthKit identifiers the aggregator knows.
import { createAggregator } from '../health/apple-export.js';
import { plugin } from './bridge.js';

/** Read one by one: each sample counts (means; sleep stages). */
export const SAMPLE_TYPES = {
  heartRateVariability: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  restingHeartRate: 'HKQuantityTypeIdentifierRestingHeartRate',
  respiratoryRate: 'HKQuantityTypeIdentifierRespiratoryRate',
  oxygenSaturation: 'HKQuantityTypeIdentifierOxygenSaturation',
  appleSleepingWristTemperature: 'HKQuantityTypeIdentifierAppleSleepingWristTemperature', // Readiness (overnight only, like the export)
  vo2Max: 'HKQuantityTypeIdentifierVO2Max', // the Longevity card
};
// Walking Heart Rate Average isn't in the plugin, so it isn't read. Nothing waits for it: it only feeds one optional
// line in the doctor summary (js/health/clinical.js), and the Data check leaves it out in the app.
/** Daily totals: HealthKit adds them up itself and removes iPhone + Watch double counting. */
export const SUM_TYPES = {
  steps: 'HKQuantityTypeIdentifierStepCount',
  calories: 'HKQuantityTypeIdentifierActiveEnergyBurned',
  exerciseTime: 'HKQuantityTypeIdentifierAppleExerciseTime',
};
// 'workouts' (Apple Watch sessions), 'heartRate' (avg/max during a workout) and 'basalCalories' (resting energy,
// read live and kept on this phone only) are read but never saved as daily summaries.
export const READ_TYPES = [...Object.keys(SAMPLE_TYPES), ...Object.keys(SUM_TYPES), 'sleep', 'workouts', 'heartRate', 'basalCalories'];
const SLEEP_STATE = { inBed: 'HKCategoryValueSleepAnalysisInBed', asleep: 'HKCategoryValueSleepAnalysisAsleepUnspecified', awake: 'HKCategoryValueSleepAnalysisAwake', rem: 'HKCategoryValueSleepAnalysisAsleepREM', deep: 'HKCategoryValueSleepAnalysisAsleepDeep', light: 'HKCategoryValueSleepAnalysisAsleepCore', core: 'HKCategoryValueSleepAnalysisAsleepCore' };

const pad = (n) => String(n).padStart(2, '0');
/** A time as the export writes it, in this phone's time zone: "2026-10-09 06:41:00 -0400". */
export function localStamp(t) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${sign}${pad(Math.floor(a / 60))}${pad(a % 60)}`;
}

/** One plugin sample → an export-style record (or null). */
export function sampleToRecord(dataType, s) {
  if (!s) return null;
  const startDate = localStamp(s.startDate || s.endDate);
  const endDate = localStamp(s.endDate || s.startDate);
  if (!startDate || !endDate) return null;
  const sourceName = s.sourceName || 'Apple Health';
  if (dataType === 'sleep') {
    const state = SLEEP_STATE[s.sleepState] || (s.sleepState ? null : SLEEP_STATE.asleep);
    return state ? { type: 'HKCategoryTypeIdentifierSleepAnalysis', value: state, startDate, endDate, sourceName } : null;
  }
  const type = SAMPLE_TYPES[dataType] || SUM_TYPES[dataType];
  const v = Number(s.value);
  if (!type || !Number.isFinite(v)) return null;
  return { type, value: String(v), unit: s.unit || '', startDate, endDate, sourceName };
}

/** Sleep samples can carry stage segments; each segment becomes its own record. */
export function sleepRecords(s) {
  if (s && s.hasStageData && Array.isArray(s.stages) && s.stages.length) {
    return s.stages.map((g) => sampleToRecord('sleep', { startDate: g.startDate, endDate: g.endDate, sleepState: g.stage, sourceName: s.sourceName })).filter(Boolean);
  }
  const r = sampleToRecord('sleep', s);
  return r ? [r] : [];
}

/** A daily total → one record ending at that day's 23:59 local, from a single source (HealthKit's own sum).
 * The day is taken from the middle of the bucket. */
export function totalToRecord(dataType, agg) {
  const v = Number(agg && agg.value);
  if (!SUM_TYPES[dataType] || !Number.isFinite(v) || v <= 0) return null;
  const s0 = new Date(agg.startDate);
  if (Number.isNaN(s0.getTime())) return null;
  const start = new Date(s0.getTime() + 12 * 3600 * 1000); // the bucket's middle: right day even if it's anchored at UTC midnight
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 0);
  return { type: SUM_TYPES[dataType], value: String(v), unit: agg.unit || '', startDate: localStamp(start), endDate: localStamp(end), sourceName: 'HealthKit' };
}

/** Turn already-read plugin results into daily summaries (the shape importHealthDays takes). Pure. */
export function daysFromHealth({ samples = {}, totals = {}, since }) {
  const agg = createAggregator({ since });
  for (const [type, list] of Object.entries(samples)) {
    for (const s of list || []) {
      const recs = type === 'sleep' ? sleepRecords(s) : [sampleToRecord(type, s)];
      for (const r of recs) if (r) agg.addRecord(r);
    }
  }
  for (const [type, list] of Object.entries(totals)) for (const a of list || []) { const r = totalToRecord(type, a); if (r) agg.addRecord(r); }
  return { days: agg.finish(), records: agg.records };
}

/** The HealthKit plugin, or null outside the app. */
export const healthPlugin = () => plugin('Health');

/**
 * Ask for read access (iOS shows its Health sheet once; later calls return at once), then read `days` days and
 * summarise them. Returns { days, records } or throws an Error with a plain message.
 */
export async function readHealthDays({ since, now = new Date(), limit = 20000 } = {}) {
  const H = healthPlugin();
  if (!H) throw new Error('Apple Health is only available in the Forge iPhone app.');
  const avail = await H.isAvailable().catch(() => ({ available: false }));
  if (!avail || !avail.available) throw new Error('Apple Health isn’t available on this device.');
  await H.requestAuthorization({ read: READ_TYPES, write: [] });
  const startDate = new Date(`${since}T00:00:00`);
  startDate.setDate(startDate.getDate() - 30); // the aggregator wants a month before for the wrist-temperature baseline
  const range = { startDate: startDate.toISOString(), endDate: new Date(now).toISOString() };
  const samples = {};
  for (const t of [...Object.keys(SAMPLE_TYPES), 'sleep']) {
    try { samples[t] = (await H.readSamples({ dataType: t, ...range, limit, ascending: false })).samples || []; } catch { samples[t] = []; }
  }
  const totals = {};
  for (const t of Object.keys(SUM_TYPES)) {
    try { totals[t] = (await H.queryAggregated({ dataType: t, ...range, bucket: 'day', aggregation: 'sum' })).samples || []; } catch { totals[t] = []; }
  }
  return daysFromHealth({ samples, totals, since });
}

const dayRange = (since, now) => ({ startDate: new Date(`${since}T00:00:00`).toISOString(), endDate: new Date(now).toISOString() });

/** Apple Watch workouts since `since` (YYYY-MM-DD), paged with `anchor`, each with avg_hr / max_hr (and active-energy samples when it has no total). */
export async function readHealthWorkouts({ since, now = new Date() } = {}) {
  const H = healthPlugin();
  if (!H) return [];
  const range = dayRange(since, now);
  const out = [];
  let anchor;
  for (let page = 0; page < 20; page++) {
    let r;
    try { r = await H.queryWorkouts({ ...range, limit: 200, ascending: false, anchor }); } catch (e) { if (!page) throw e; break; } // a failed first page is a failed read, not "no workouts"
    const list = (r && r.workouts) || [];
    out.push(...list);
    anchor = r && r.anchor;
    if (!anchor || list.length < 200) break;
  }
  for (const w of out) {
    try {
      const hr = (await H.readSamples({ dataType: 'heartRate', startDate: w.startDate, endDate: w.endDate, limit: 2000 })).samples || [];
      const v = hr.map((s) => Number(s.value)).filter((x) => x > 0);
      if (v.length) { w.avg_hr = Math.round(v.reduce((a, b) => a + b, 0) / v.length); w.max_hr = Math.round(Math.max(...v)); }
    } catch { /* no heart rate for this one */ }
    if (!(Number(w.totalEnergyBurned) > 0)) { // deprecated on iOS 18+: add up the active energy inside the window
      try { w.energySamples = (await H.readSamples({ dataType: 'calories', startDate: w.startDate, endDate: w.endDate, limit: 2000 })).samples || []; } catch { w.energySamples = []; }
    }
  }
  return out;
}

/** Daily active and resting energy from `since` to now → [{ day, active, resting }]. Kept on this phone only. */
export async function readHealthEnergy({ since, now = new Date() } = {}) {
  const H = healthPlugin();
  if (!H) return [];
  const range = dayRange(since, now);
  const byDay = new Map();
  for (const [type, key] of [['calories', 'active'], ['basalCalories', 'resting']]) {
    try {
      const r = await H.queryAggregated({ dataType: type, ...range, bucket: 'day', aggregation: 'sum' });
      for (const a of (r && r.samples) || []) {
        const d = new Date(new Date(a.startDate).getTime() + 12 * 3600 * 1000).toLocaleDateString('en-CA'); // bucket middle: right day
        byDay.set(d, { ...(byDay.get(d) || { day: d }), [key]: Number(a.value) });
      }
    } catch { /* not shared */ }
  }
  return [...byDay.values()];
}

/** A cheap re-read of today only: steps, active energy and exercise totals (daily-summary shape) plus today's resting energy. */
export async function readHealthToday({ now = new Date() } = {}) {
  const H = healthPlugin();
  if (!H) throw new Error('Apple Health is only available in the Forge iPhone app.');
  const today = new Date(now).toLocaleDateString('en-CA');
  const range = dayRange(today, now);
  const totals = {};
  for (const t of Object.keys(SUM_TYPES)) {
    try { totals[t] = (await H.queryAggregated({ dataType: t, ...range, bucket: 'day', aggregation: 'sum' })).samples || []; } catch { totals[t] = []; }
  }
  const energy = await readHealthEnergy({ since: today, now });
  return { ...daysFromHealth({ totals, since: today }), energy };
}
