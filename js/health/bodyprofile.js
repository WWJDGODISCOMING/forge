// Body Profile (W2b): where your fat-free mass index (FFMI) and fat mass index (FMI) sit on a 4×4 grid.
// Index = mass (kg) ÷ height (m)². The grid idea is Kyle et al. 2003; the cut points below are approximate
// adult reference bands (see docs/trends.md) and live in this one table. Pure functions, no DOM.

/**
 * Three cut points per index split it into four bands, low → high. Approximate adult reference bands drawn
 * from Kyle et al., Nutrition 2003;19:597-604 (and the Swiss reference data behind it). Not age-adjusted:
 * the screen says so. "unspecified" uses the midpoint of the two.
 */
export const CUTS = {
  // FMI: men ~3–6 normal / 6–9 excess / >9 obese, women ~5–9 / 9–13 / >13. FFMI "low" is below ~17 (men) / ~15 (women).
  male: { ffmi: [17.0, 19.0, 21.0], fmi: [3.0, 6.0, 9.0] },
  female: { ffmi: [15.0, 16.5, 18.0], fmi: [5.0, 9.0, 13.0] },
};
export const FFMI_BANDS = ['Low', 'Moderate', 'Good', 'High'];
export const FMI_BANDS = ['Low', 'Healthy', 'Higher', 'High'];
export const cutsFor = (sex, which) => (CUTS[sex] || { [which]: CUTS.male[which].map((v, i) => (v + CUTS.female[which][i]) / 2) })[which];

/** 0–3: how many cut points the value has reached. */
export const bandOf = (v, cuts) => cuts.filter((c) => v >= c).length;

/** FFMI and FMI from one reading { weight_kg, fat_mass_kg, fat_free_mass_kg }; null if it can't be worked out. */
export function indices(m, heightM) {
  if (!heightM || !m) return null;
  const w = m.weight_kg;
  let fat = m.fat_mass_kg;
  let ffm = m.fat_free_mass_kg;
  // Some scales (Withings Body Comp) send only body fat %: fat mass = weight × ratio.
  const pct = m.fat_ratio_pct;
  if (!Number.isFinite(fat) && !Number.isFinite(ffm) && Number.isFinite(w) && Number.isFinite(pct) && pct > 0 && pct < 100) fat = w * (pct / 100);
  if (!Number.isFinite(fat) && Number.isFinite(ffm) && Number.isFinite(w)) fat = w - ffm;
  if (!Number.isFinite(ffm) && Number.isFinite(fat) && Number.isFinite(w)) ffm = w - fat;
  if (!Number.isFinite(fat) || !Number.isFinite(ffm)) return null;
  return { ffmi: ffm / (heightM * heightM), fmi: fat / (heightM * heightM), fatKg: fat, ffmKg: ffm };
}

/**
 * measures: your body_measures docs; heightM; sex: 'male' | 'female' | other. Returns
 * { status: 'needs-height' | 'needs-comp' | 'ok', ffmi, fmi, col (FFMI band), row (FMI band), day, trail: [{ month, ffmi, fmi, col, row }] }.
 * The trail is one dot per earlier month (the average of that month's readings), newest last, at most 6.
 */
export function bodyProfile({ measures, heightM, sex }) {
  if (!heightM) return { status: 'needs-height', trail: [] };
  const ffmiCuts = cutsFor(sex, 'ffmi');
  const fmiCuts = cutsFor(sex, 'fmi');
  const docs = measures.filter((d) => !d.deleted && !d.needs_review && d.metrics && d.day)
    .map((d) => ({ day: d.day, ix: indices(d.metrics, heightM) })).filter((d) => d.ix).sort((a, b) => (a.day < b.day ? -1 : 1));
  if (!docs.length) return { status: 'needs-comp', trail: [] };
  const last = docs[docs.length - 1];
  const place = (ix) => ({ ffmi: ix.ffmi, fmi: ix.fmi, col: bandOf(ix.ffmi, ffmiCuts), row: bandOf(ix.fmi, fmiCuts) });
  const months = new Map();
  for (const d of docs) {
    const k = d.day.slice(0, 7);
    if (k === last.day.slice(0, 7)) continue;
    const m = months.get(k) || { f: 0, m: 0, n: 0 };
    m.f += d.ix.ffmi; m.m += d.ix.fmi; m.n++;
    months.set(k, m);
  }
  const trail = [...months].map(([month, m]) => ({ month, ...place({ ffmi: m.f / m.n, fmi: m.m / m.n }) })).slice(-6);
  return { status: 'ok', ...place(last.ix), day: last.day, trail, lastWeek: lastWeekOf(docs, last, place) };
}

const WEEK_MIN = 5;
const WEEK_MAX = 10;
const dayNum = (key) => Date.parse(`${key}T12:00:00Z`) / 86400000;

/**
 * The reading closest to 7 days before the latest one, if it is 5 to 10 days back; otherwise null.
 * { day, ffmi, fmi, col, row, ffmKg, fatKg, dLeanKg, dFatKg } (the deltas are latest minus then, in kg).
 */
function lastWeekOf(docs, last, place) {
  let best = null;
  for (const d of docs) {
    const gap = dayNum(last.day) - dayNum(d.day);
    if (gap < WEEK_MIN || gap > WEEK_MAX) continue;
    const off = Math.abs(gap - 7);
    if (!best || off < best.off || (off === best.off && d.day > best.d.day)) best = { d, off };
  }
  if (!best) return null;
  const { ix, day } = best.d;
  return { day, ...place(ix), ffmKg: ix.ffmKg, fatKg: ix.fatKg, dLeanKg: last.ix.ffmKg - ix.ffmKg, dFatKg: last.ix.fatKg - ix.fatKg };
}

