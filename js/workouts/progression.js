// Progressive overload, load steps, warm-ups, plates, estimated 1RM and PRs.
// Math is done in the user's display unit ('lb' or 'kg') so steps are round numbers; callers convert.
// Pure functions; see docs/workout-algorithm.md.

const KG_PER_LB = 0.45359237;
export const toUnit = (kg, unit) => (unit === 'kg' ? kg : kg / KG_PER_LB);
export const fromUnit = (x, unit) => (unit === 'kg' ? x : x * KG_PER_LB);

const LOWER = new Set(['squat', 'hinge', 'lunge', 'hip_thrust', 'knee_extension', 'knee_flexion', 'calf', 'hip_abduction', 'hip_adduction']);
export const isLowerBody = (ex) => LOWER.has(ex.pattern);

/** Standard gym racks when a location has no explicit inventory. */
const GYM_DUMBBELLS = { lb: range(5, 120, 5), kg: [2, 4, 6, 8, 10, 12, 12.5, 14, 16, 17.5, 18, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40, 42.5, 45, 50] };
const GYM_KETTLEBELLS = { lb: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80], kg: [4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36] };

function range(a, b, step) {
  const out = [];
  for (let x = a; x <= b + 1e-9; x += step) out.push(Math.round(x * 100) / 100);
  return out;
}

const round = (x, step) => Math.round(x / step) * step;
const floorTo = (x, step) => Math.floor(x / step + 1e-9) * step;

/** Smallest normal jump for continuous loads (barbell, machine, cable, smith). */
export function loadStep(ex, unit) {
  if (unit === 'kg') return ex.load === 'barbell' || ex.load === 'smith' ? (isLowerBody(ex) ? 5 : 2.5) : 2.5;
  return ex.load === 'barbell' || ex.load === 'smith' ? (isLowerBody(ex) ? 10 : 5) : 5;
}

export const barWeight = (unit) => (unit === 'kg' ? 20 : 45);

/**
 * Loads you can actually pick for this exercise at this location, ascending, in `unit`.
 * Returns null when loads are continuous (barbell/machine/cable): use loadStep instead.
 * inventory: location.weight_inventory, stored in kg like all other data,
 * e.g. { dumbbells_kg: [2.268, 13.608], kettlebells_kg: [9.072] }
 */
export function availableLoads(ex, inventory = {}, unit = 'lb') {
  const conv = (list) => [...new Set(list.map((kg) => Math.round(toUnit(kg, unit) * 10) / 10))].sort((a, b) => a - b);
  if (ex.load === 'dumbbell') return inventory.dumbbells_kg && inventory.dumbbells_kg.length ? conv(inventory.dumbbells_kg) : GYM_DUMBBELLS[unit];
  if (ex.load === 'kettlebell') return inventory.kettlebells_kg && inventory.kettlebells_kg.length ? conv(inventory.kettlebells_kg) : GYM_KETTLEBELLS[unit];
  return null;
}

/** Nearest load at or below x (or the smallest available). */
export function snapDown(x, loads, ex, unit) {
  if (loads) {
    let best = loads[0];
    for (const l of loads) if (l <= x + 1e-9) best = l;
    return best;
  }
  const min = ex.load === 'barbell' ? barWeight(unit) : 0;
  return Math.max(min, floorTo(x, unit === 'kg' ? 1.25 : 2.5));
}

export function nextLoad(current, loads, ex, unit) {
  if (loads) return loads.find((l) => l > current + 1e-9) ?? null;
  return current + loadStep(ex, unit);
}

/** Epley estimated 1-rep max. Unreliable above ~12 reps, so returns null there. */
export function e1rm(weight, reps) {
  if (!weight || !reps || reps < 1 || reps > 12) return null;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

/** Default working sets by role and experience. */
export function defaultSets(role, experience) {
  if (role === 'main') return experience === 'advanced' ? 4 : 3;
  if (role === 'secondary') return 3;
  return experience === 'beginner' ? 2 : 3;
}

/**
 * Reps you could probably do at `target`, from a set of `reps` at `weight` (Epley, reps capped at 30).
 * Epley is unreliable for *estimating a 1RM* above ~12 reps (see e1rm). Using it up to 30 here is OK because
 * it's only a gate for moving to the next owned weight: it's fed your *weakest* set, it has to clear the
 * bottom of the rep range (or 5 reps for the tempo escape below), and the target it unlocks never asks for
 * more reps than the estimate supports. A high-rep overestimate just means trying the heavier weight a
 * little earlier, at a low rep target.
 */
export function predictedReps(weight, reps, target) {
  if (!weight || !target) return 0;
  const oneRm = weight * (1 + Math.min(reps, 30) / 30);
  return Math.floor(30 * (oneRm / target - 1) + 1e-9);
}

/** A ~10% lighter load you own, or null if the nearest lighter option is more than 20% lighter (e.g. 30 → 5 lb). */
export function lighterLoad(w, loads, ex, unit) {
  const d = snapDown(w * 0.9, loads, ex, unit);
  if (d >= w || (w - d) / w > 0.2) return null;
  return d;
}

/** Progression ignores deload sessions: they're deliberately light and would drag the next target down. */
const working = (history) => history.filter((h) => h.sets && h.sets.length && !h.deload);

/**
 * The target for the next time you do this exercise.
 * history: past sessions of this exercise, MOST RECENT FIRST: [{ date, deload?, sets: [{ weight, reps, rir }] }]
 *   (weights already in `unit`; only completed working sets). Deload sessions are skipped.
 * Returns { weight|null, reps, repLo, repHi, sets, rir, mode, note, nextStepId?, stalled }
 */
export function nextTarget(ex, history, { inventory = {}, unit = 'lb', role = 'secondary', experience = 'beginner', deload = false, chainNext = null } = {}) {
  const [lo, hi] = ex.reps;
  const sets = defaultSets(role, experience);
  const base = { repLo: lo, repHi: hi, sets, rir: 2, stalled: false, note: '' };
  const hist = working(history);
  const last = hist[0];
  const loads = availableLoads(ex, inventory, unit);
  // Timed work (holds, carries, rounds) progresses by time, even when it uses a weight.
  const loaded = !ex.timed && !['bodyweight', 'other', 'band', 'backpack'].includes(ex.load);

  if (deload) {
    const dSets = Math.max(1, Math.ceil(Math.max(sets, last ? last.sets.length : 0) / 2));
    if (!last) return { ...base, sets: dSets, weight: null, reps: lo, rir: 3, mode: 'deload', note: 'Deload week: light and easy.' };
    const w = topWeight(last.sets);
    const lighter = loaded && w ? lighterLoad(w, loads, ex, unit) : null;
    return {
      ...base, sets: dSets, rir: 3, mode: 'deload',
      weight: lighter ?? w,
      reps: lo,
      note: lighter != null
        ? 'Deload week: about 10% lighter, half the sets, stop well short of failure.'
        : 'Deload week: same weight, half the sets, fewer reps, stop well short of failure.',
    };
  }

  if (!last) {
    const owned = (ex.load === 'dumbbell' && inventory.dumbbells_kg?.length) || (ex.load === 'kettlebell' && inventory.kettlebells_kg?.length);
    const options = owned && loads.length <= 8 ? ` Your options here: ${loads.map(fmt).join(', ')} ${unit}.` : '';
    return {
      ...base, weight: null, reps: hi, mode: 'start',
      note: ex.timed ? `Hold as long as you can with good form (aim ${lo}–${hi}s).`
        : loaded ? `First time: pick a weight you could lift about ${hi + 2} times. Do ${hi}.${options}`
        : `First time: do ${lo}–${hi} clean reps per set.`,
    };
  }

  const reps = last.sets.map((s) => s.reps || 0);
  const minReps = Math.min(...reps);
  const maxReps = Math.max(...reps);
  const lastSets = last.sets.length;
  const allTop = minReps >= hi;

  // Effort rating from the most recent session (reps in reserve). No rating → numbers only, as before.
  const rated = !ex.timed && last.rir != null;
  const missedIn = (h) => h.sets.some((s) => (s.planReps != null ? (s.reps || 0) < s.planReps : (s.reps || 0) < lo));
  const toughIn = (h) => h.rir === 0 || missedIn(h);
  const keepSets = Math.max(sets, Math.min(5, lastSets));
  if (rated && toughIn(last)) {
    // Hit the wall: hold. A second tough session in a row at this weight eases the load about 5%.
    const w0 = topWeight(last.sets);
    const holdReps = Math.min(hi, Math.max(lo, minReps));
    const prev0 = hist[1];
    if (loaded && prev0 && toughIn(prev0) && topWeight(prev0.sets) === w0) {
      const eased = snapDown(w0 * 0.95, loads, ex, unit);
      if (eased < w0) return { ...base, weight: eased, sets: keepSets, reps: holdReps, mode: 'ease', stalled: true, note: `Tough twice in a row: easing to ${fmt(eased)} ${unit}.` };
    }
    return { ...base, weight: w0, sets: keepSets, reps: holdReps, mode: 'hold', note: missedIn(last) ? 'Missed reps last time: same weight again.' : 'Went to failure last time: same weight again.' };
  }
  if (rated && last.rir === 1) {
    const w1 = topWeight(last.sets);
    const up = minReps < hi;
    return { ...base, weight: w1, sets: keepSets, reps: Math.min(hi, Math.max(lo, minReps + (up ? 1 : 0))), mode: 'reps', note: up ? 'Close to the limit last time: same weight, one more rep.' : 'Close to the limit last time: same weight.' };
  }
  const easy = rated && last.rir >= 3;

  // Timed holds and bodyweight / band work: progress reps (or seconds), then suggest the next chain step.
  if (!loaded) {
    if (allTop) {
      const extended = ex.timed ? Math.min(maxReps + 5, hi + 30) : Math.min(minReps + (easy ? 2 : 1), hi + 5);
      return {
        ...base, weight: topWeight(last.sets), reps: extended, mode: chainNext ? 'chain' : 'reps',
        nextStepId: chainNext ? chainNext.id : undefined,
        note: chainNext ? `You hit the top of the range. Ready to try ${chainNext.name}?` : easy ? 'Felt easy last time, +2 reps.' : 'Top of the range: keep adding reps or slow the lowering to 3 seconds.',
      };
    }
    if (easy) return { ...base, weight: topWeight(last.sets), reps: Math.min(hi, minReps + 2), mode: 'reps', note: 'Felt easy last time, +2 reps.' };
    const step = ex.timed ? 5 : 1;
    return { ...base, weight: topWeight(last.sets), reps: Math.min(hi, minReps + step), mode: 'reps', note: ex.timed ? `Add ${step} seconds.` : 'Add a rep to your weakest set.' };
  }

  const w = topWeight(last.sets);
  const stalled = isStalled(history, w);

  // Two sessions in a row under the bottom of the range at the same weight: reset ~10% (or, if the next
  // weight down is a big drop, keep the weight and rebuild from the bottom of the range).
  const prev = hist[1];
  if (minReps < lo && prev && Math.min(...prev.sets.map((s) => s.reps || 0)) < lo && topWeight(prev.sets) === w) {
    const dropped = lighterLoad(w, loads, ex, unit);
    if (dropped != null) return { ...base, weight: dropped, reps: lo, mode: 'reset', stalled: true, note: 'Two tough sessions in a row: drop about 10% and build back up.' };
    return { ...base, weight: w, reps: lo, mode: 'reset', stalled: true, note: 'Two tough sessions in a row: same weight, aim for the bottom of the range and build back up.' };
  }

  if (easy && allTop) {
    // Felt easy and every set hit the top: take two steps up, when the heavier weight is within reach.
    const n1 = nextLoad(w, loads, ex, unit);
    const n2 = n1 != null ? nextLoad(n1, loads, ex, unit) : null;
    if (n2 != null && (n2 - n1 <= loadStep(ex, unit) + 1e-9 || predictedReps(w, minReps, n2) >= lo)) {
      return { ...base, weight: n2, reps: lo, mode: 'weight', note: `Felt easy last time, +${fmt(n2 - w)} ${unit}.` };
    }
  }
  if (easy && !allTop) {
    return { ...base, weight: w, sets: keepSets, reps: Math.min(hi, Math.max(lo, minReps + 2)), mode: 'reps', stalled, note: 'Felt easy last time, +2 reps.' };
  }

  if (allTop) {
    const n = nextLoad(w, loads, ex, unit);
    // Move up if it's a normal small step, or if your last session predicts you can hit the bottom
    // of the range at the next weight (estimated 1RM). Otherwise the jump is too big for now.
    const canJump = n != null && (n - w <= loadStep(ex, unit) + 1e-9 || predictedReps(w, minReps, n) >= lo);
    if (canJump) {
      return { ...base, weight: n, reps: lo, mode: 'weight', note: `Weight up to ${fmt(n)} ${unit}.` };
    }
    // Stuck at this weight (e.g. 5 lb → 30 lb): reps up to the top + 8, then one more set at a time
    // up to 5, then slower tempo. Each step keeps what you've already earned, so it never loops back.
    const ext = hi + 8;
    const curSets = Math.max(sets, lastSets);
    const why = n == null ? 'This is your heaviest option here' : `Next weight (${fmt(n)} ${unit}) is too big a jump for now`;
    if (minReps < ext) {
      return { ...base, weight: w, sets: curSets, reps: Math.min(ext, minReps + 1), repHi: ext, mode: 'reps', note: `${why}, so we’re adding reps.` };
    }
    if (curSets < 5) {
      return { ...base, weight: w, sets: curSets + 1, reps: ext, repHi: ext, mode: 'sets', note: `${why}, and you’ve maxed the reps, so adding a set.` };
    }
    // Tempo escape: after 2 tempo sessions (3 maxed sessions in a row, counting the one that maxed out)
    // at this weight, take the bigger jump if your weakest
    // set predicts at least 5 reps at the next weight (e.g. 30 → 40 lb). 5 → 30 lb predicts far less, so it
    // still never jumps.
    const maxedRun = hist.slice(0, 3).filter((h) => topWeight(h.sets) === w && h.sets.length >= 5 && Math.min(...h.sets.map((x) => x.reps || 0)) >= ext).length;
    if (n != null && maxedRun >= 3) {
      const pr = predictedReps(w, minReps, n);
      if (pr >= 5) {
        const r = Math.max(5, Math.min(pr, lo));
        return { ...base, weight: n, reps: r, mode: 'weight', note: `Bigger jump to ${fmt(n)} ${unit}: aim for ${r} reps and build back up to ${lo}.` };
      }
    }
    return { ...base, weight: w, sets: 5, reps: ext, repHi: ext, mode: 'tempo', note: 'Maxed out reps and sets here: lower for 3–4 seconds and pause at the bottom.' };
  }

  // Not every set at the top yet: keep the weight and the number of sets you've built up, add a rep.
  return {
    ...base, weight: w, sets: Math.max(sets, Math.min(5, lastSets)), reps: Math.min(hi, Math.max(lo, minReps + 1)), mode: 'reps', stalled,
    note: stalled ? 'Same weight for 3 sessions without progress. A deload or swap may help.' : 'Same weight; beat last time by a rep.',
  };
}

function fmt(x) {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

export function topWeight(sets) {
  return sets.reduce((m, s) => Math.max(m, s.weight || 0), 0) || null;
}

/** Stalled: same top weight for the last 3 sessions and best reps didn't go up. */
export function isStalled(history, w) {
  const hs = working(history).slice(0, 3);
  if (hs.length < 3) return false;
  if (!hs.every((h) => topWeight(h.sets) === w)) return false;
  const best = hs.map((h) => Math.max(...h.sets.map((s) => s.reps || 0)));
  return best[0] <= best[2];
}

/** Warm-up sets before the first working set of a loaded compound. Returns [{ weight, reps }] in unit. */
export function warmups(ex, working, { inventory = {}, unit = 'lb' } = {}) {
  if (!working || ex.kind !== 'compound') return [];
  if (ex.load === 'barbell' || ex.load === 'smith') {
    const bar = ex.load === 'barbell' ? barWeight(unit) : 0;
    const step = unit === 'kg' ? 2.5 : 5;
    const plan = [[0, 10], [0.4, 5], [0.6, 3], [0.8, 2]];
    const out = [];
    for (const [pct, reps] of plan) {
      const w = pct === 0 ? bar : Math.max(bar, round(working * pct, step));
      if (w >= working || (pct === 0 && !bar)) continue;
      if (out.length && out[out.length - 1].weight === w) continue;
      out.push({ weight: w, reps });
    }
    return out;
  }
  if (ex.load === 'dumbbell' || ex.load === 'kettlebell') {
    const loads = availableLoads(ex, inventory, unit) || [];
    const lighter = loads.filter((l) => l <= working * 0.65);
    return lighter.length ? [{ weight: lighter[lighter.length - 1], reps: 8 }] : [];
  }
  if (ex.load === 'machine' || ex.load === 'cable') {
    const w = snapDown(working * 0.5, null, ex, unit);
    return w > 0 ? [{ weight: w, reps: 8 }] : [];
  }
  return [];
}

/** Plates per side for a barbell total. Greedy with standard plates. */
export function platesPerSide(total, unit = 'lb', bar = barWeight(unit)) {
  const plates = unit === 'kg' ? [25, 20, 15, 10, 5, 2.5, 1.25] : [45, 35, 25, 10, 5, 2.5];
  let side = (total - bar) / 2;
  if (side < 0) return { plates: [], remainder: total - bar, bar };
  const out = [];
  for (const p of plates) {
    while (side + 1e-9 >= p) {
      out.push(p);
      side -= p;
    }
  }
  return { plates: out, remainder: Math.round(side * 2 * 100) / 100, bar };
}

/**
 * PRs set by this session's sets, compared with earlier history (same unit, most recent first).
 * Returns [{ type: 'e1rm'|'weight'|'reps'|'time', value, prev, label }] — `prev` is the old best, for "185 → 192".
 */
export function detectPRs(ex, sessionSets, history) {
  const prevSets = history.flatMap((h) => h.sets || []);
  if (!prevSets.length || !sessionSets.length) return [];
  const prs = [];
  const loaded = !['bodyweight', 'other', 'band', 'backpack'].includes(ex.load);
  if (ex.timed) {
    const best = Math.max(...prevSets.map((s) => s.reps || 0));
    const now = Math.max(...sessionSets.map((s) => s.reps || 0));
    if (now > best) prs.push({ type: 'time', value: now, prev: best, label: `Longest hold: ${now}s` });
    return prs;
  }
  if (loaded) {
    const bestE = Math.max(0, ...prevSets.map((s) => e1rm(s.weight, s.reps) || 0));
    const nowE = Math.max(0, ...sessionSets.map((s) => e1rm(s.weight, s.reps) || 0));
    if (nowE > bestE * 1.001 && bestE > 0) prs.push({ type: 'e1rm', value: nowE, prev: bestE, label: `Est. 1-rep max ${Math.round(nowE)}` });
    const bestW = Math.max(...prevSets.map((s) => s.weight || 0));
    const nowW = Math.max(...sessionSets.map((s) => s.weight || 0));
    if (nowW > bestW) prs.push({ type: 'weight', value: nowW, prev: bestW, label: `Heaviest: ${nowW}` });
    // Best single-set volume (weight × reps).
    const bestV = Math.max(0, ...prevSets.map((s) => (s.weight || 0) * (s.reps || 0)));
    const nowV = Math.max(0, ...sessionSets.map((s) => (s.weight || 0) * (s.reps || 0)));
    if (bestV > 0 && nowV > bestV * 1.001) prs.push({ type: 'volume', value: Math.round(nowV), prev: Math.round(bestV), label: `Best set volume ${Math.round(nowV)}` });
    // Rep PR at a weight you've used before (great for fixed dumbbells).
    for (const s of sessionSets) {
      const sameW = prevSets.filter((p) => p.weight === s.weight);
      const best = sameW.length ? Math.max(...sameW.map((p) => p.reps || 0)) : 0;
      if (sameW.length && s.reps > best) {
        prs.push({ type: 'reps', value: s.reps, prev: best, weight: s.weight, label: `${s.reps} reps at ${s.weight}` });
        break;
      }
    }
    return prs;
  }
  const best = Math.max(...prevSets.map((s) => s.reps || 0));
  const now = Math.max(...sessionSets.map((s) => s.reps || 0));
  if (now > best) prs.push({ type: 'reps', value: now, prev: best, label: `Most reps in a set: ${now}` });
  return prs;
}
