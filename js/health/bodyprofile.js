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

// Where inside its cell a dot may sit (fractions of the cell). Vertically it stays above the "You" label at the cell's foot.
const X_IN = [0.2, 0.8];
const Y_IN = [0.2, 0.6];
/** 0 to 1: how far the value is through its band; the open-ended outer bands get a span as wide as their neighbour. */
export function bandFraction(v, cuts, band) {
  const lo = band === 0 ? Math.max(0, cuts[0] - (cuts[1] - cuts[0])) : cuts[band - 1];
  const hi = band === 3 ? cuts[2] + (cuts[2] - cuts[1]) : cuts[band];
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

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
  const place = (ix) => {
    const col = bandOf(ix.ffmi, ffmiCuts);
    const row = bandOf(ix.fmi, fmiCuts);
    // x, y: a continuous spot inside the band's cell, in grid units (0 to 4 across, 0 at the top)
    const fx = bandFraction(ix.ffmi, ffmiCuts, col);
    const fy = bandFraction(ix.fmi, fmiCuts, row);
    return { ffmi: ix.ffmi, fmi: ix.fmi, col, row, x: col + X_IN[0] + (X_IN[1] - X_IN[0]) * fx, y: 3 - row + Y_IN[1] - (Y_IN[1] - Y_IN[0]) * fy };
  };
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


export const LINE_MIN = 0.11; // cells (about 6 px): closer than this, the two readings count as the same spot
const APART = 0.55; // cells (about 30 px): how far the Last week ring is kept from You, so both stay visible and a line fits

/**
 * Where to draw You and the Last week ring, in grid units, and whether a line joins them. The line shows for any move
 * of LINE_MIN or more. When both sit in one cell and are closer than APART, the ring is moved away from You (along the
 * move where it fits in the cell) so neither hides the other.
 */
export function markPositions(bp) {
  const you = { x: bp.x, y: bp.y, col: bp.col, row: bp.row };
  const lw = bp.lastWeek;
  if (!lw) return { you, last: null, line: false };
  const true0 = Math.hypot(lw.x - bp.x, lw.y - bp.y);
  const line = true0 >= LINE_MIN || lw.col !== bp.col || lw.row !== bp.row;
  const last = { x: lw.x, y: lw.y, col: lw.col, row: lw.row };
  const sameCell = lw.col === bp.col && lw.row === bp.row;
  const want = line ? APART : APART * 0.8;
  if (sameCell && true0 < want) {
    const base = true0 > 1e-6 ? Math.atan2(lw.y - bp.y, lw.x - bp.x) : Math.PI;
    const clamp = (v, [a, b], o) => Math.min(o + b, Math.max(o + a, v));
    let best = null;
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4]) {
      const a = base + k * Math.PI / 4;
      const c = { x: clamp(bp.x + want * Math.cos(a), X_IN, bp.col), y: clamp(bp.y + want * Math.sin(a), Y_IN, 3 - bp.row) };
      const d = Math.hypot(c.x - bp.x, c.y - bp.y);
      if (!best || d > best.d + 0.01) best = { ...c, d };
      if (d >= want - 0.01) break;
    }
    last.x = best.x; last.y = best.y;
  }
  return { you, last, line };
}
