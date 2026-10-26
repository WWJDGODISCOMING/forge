// Deterministic workout generator (no AI). Given a program, location, profile, history and recovery,
// it builds today's session. Pure functions; see docs/workout-algorithm.md.
import { DAY_TYPES, PROGRAMS, smartDayTypes, DAY_MUSCLES } from './programs.js';
import { expandEquipment, canDo } from './equipment.js';
import { averageRecovery } from './recovery.js';
import { activeFocus, cleanFocus, focusLabel, FOCUS_GROUPS, FOCUS_MAX_ADDED, dayFocusBonus } from './focus.js';
import { nextTarget, warmups, defaultSets } from './progression.js';
import { restDefaultSec, REST_DEFAULT_SEC } from './session-core.js';
import { cleanPrefs, prefScore, hashPick } from './prefs.js';

const INJURY_WORDS = {
  shoulder: /shoulder|rotator|labrum|ac joint/i,
  elbow: /elbow|tennis|golfer/i,
  wrist: /wrist|carpal/i,
  lower_back: /back|spine|disc|lumbar|sciatic/i,
  knee: /knee|acl|mcl|menisc|patell/i,
  hip: /\bhip/i,
  neck: /neck|cervical/i,
};

/** Turns the free-text injuries note into tags, e.g. "left shoulder" → ['shoulder']. */
export function injuryTags(text = '') {
  return Object.entries(INJURY_WORDS).filter(([, re]) => re.test(text)).map(([k]) => k);
}

/** Joints you can protect with the Knees / Lower back toggles (Train + Settings), as avoid-tags. */
export const PROTECT_JOINTS = ['knee', 'lower_back'];

/** The avoid tags from profile.protectJoints. Unknown values are ignored. */
export function jointAvoidSet(profile) {
  const list = profile && Array.isArray(profile.protectJoints) ? profile.protectJoints : [];
  return new Set(list.filter((t) => PROTECT_JOINTS.includes(t)));
}

/** False when the move is tagged for a joint you're protecting (the swap picker hides those). */
export function jointFriendly(ex, jointAvoid) {
  return !(ex.avoid || []).some((t) => jointAvoid.has(t));
}

const JOINT_WORDS = { knee: { word: 'knees', badge: 'Knee-friendly' }, lower_back: { word: 'lower back', badge: 'Back-friendly' } };

/** { from, badge, why } when Protect swapped `was` (what the plan would have had) for `now`, else null. */
export function swapInfo(was, now, jointAvoid) {
  if (!was || !now || was.id === now.id || !jointAvoid || !jointAvoid.size) return null;
  const tags = (was.avoid || []).filter((t) => jointAvoid.has(t) && JOINT_WORDS[t]);
  if (!tags.length) return null;
  return {
    from: was.id,
    joints: tags,
    badge: tags.map((t) => JOINT_WORDS[t].badge).join(' · '),
    why: `Swapped from ${was.name} to go easy on your ${tags.map((t) => JOINT_WORDS[t].word).join(' and ')}.`,
  };
}

const LEVEL = { beginner: 1, intermediate: 2, advanced: 3 };
export const CYCLE_WEEKS = { beginner: 6, intermediate: 5, advanced: 4 };

/** Planned deload: the last week of each cycle (cycle length by experience), or a manually started deload week. */
export function deloadInfo(program, experience = 'beginner', now = Date.now()) {
  if (!program || !program.started_at) return { deload: false, week: 1, cycle: CYCLE_WEEKS[experience] };
  const cycle = CYCLE_WEEKS[experience] || 5;
  const days = Math.floor((now - Date.parse(program.started_at)) / 86400000);
  const week = Math.floor(days / 7);
  const manual = program.deload_started_at && now - Date.parse(program.deload_started_at) < 7 * 86400000;
  return { deload: manual || week % cycle === cycle - 1, week: (week % cycle) + 1, cycle, manual: !!manual };
}

/** Which day of the program is next. Smart mode: the day type whose muscles are most recovered. */
export function pickDayType(programKey, { recovery, doneCount = 0, daysPerWeek = 3, lastDayType = null, customDays = [], focus = [] } = {}) {
  const prog = PROGRAMS[programKey] || PROGRAMS.smart;
  if (prog.custom) return customDays.length ? `custom_${doneCount % customDays.length}` : null;
  if (!prog.smart) return prog.days[doneCount % prog.days.length];
  const options = smartDayTypes(daysPerWeek);
  let best = null;
  let bestScore = -Infinity;
  options.forEach((d, i) => {
    let score = averageRecovery(recovery, DAY_MUSCLES[d]);
    score += dayFocusBonus(DAY_MUSCLES[d], focus, recovery); // tired focus muscles earn no bonus, so recovery still wins
    if (d === lastDayType) score -= 15; // avoid repeating the same day back to back
    score -= i * 0.01; // stable tie-break
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  });
  return best;
}

/** Chain step to use when you've never done any exercise in the chain. */
function defaultChainStep(chainLength, experience) {
  const f = { beginner: 0.34, intermediate: 0.5, advanced: 0.7 }[experience] || 0.34;
  return Math.max(1, Math.ceil(chainLength * f));
}

const ROLE_LOAD_PREF = {
  main: { barbell: 30, dumbbell: 26, smith: 16, machine: 16, kettlebell: 16, bodyweight: 14, cable: 10, backpack: 9, band: 4, other: 0 },
  secondary: { dumbbell: 26, barbell: 22, machine: 20, cable: 18, kettlebell: 16, bodyweight: 14, smith: 12, backpack: 10, band: 6, other: 0 },
  accessory: { cable: 22, dumbbell: 22, machine: 20, bodyweight: 16, backpack: 14, band: 12, kettlebell: 12, barbell: 8, smith: 6, other: 4 },
};

/** When a slot has no candidate, these patterns are tried (in order) before the slot is dropped. */
export const PATTERN_FALLBACKS = {
  vertical_pull: ['horizontal_pull', 'rear_delt'],
  horizontal_pull: ['rear_delt'],
  lateral_raise: ['vertical_push'],
  biceps: ['horizontal_pull'],
  shrug: ['rear_delt'],
  carry: ['rear_delt'],
  chest_fly: ['horizontal_push'],
};

/** Extra stand-ins used only while Protect is on: same legs, no deep knee bend or loaded spine. */
export const JOINT_FALLBACKS = {
  squat: ['knee_extension', 'hip_thrust', 'hip_abduction'],
  lunge: ['knee_extension', 'hip_thrust', 'hip_abduction'],
  knee_extension: ['hip_thrust'],
  hinge: ['hip_thrust', 'knee_flexion'],
};

/** Patterns the Swap/Replace picker lists while Protect is on: the move's own plus its joint stand-ins, else null. */
export function jointPickerPatterns(pattern, jointAvoid) {
  if (!jointAvoid || !jointAvoid.size || !pattern) return null;
  return [pattern, ...(JOINT_FALLBACKS[pattern] || []).filter((p) => p !== pattern)];
}

/** The fallback patterns for a slot, in order, without repeats or patterns the slot already tried. */
export function fallbackPatterns(slot, extra = null) {
  const out = [];
  for (const p of slot.patterns) {
    for (const f of [...(PATTERN_FALLBACKS[p] || []), ...(extra ? extra[p] || [] : [])]) {
      if (!slot.patterns.includes(f) && !out.includes(f)) out.push(f);
    }
  }
  return out;
}

/**
 * Scores every candidate for a slot and returns the best, or null.
 * ctx: { available:Set, avoid:Set, maxLevel, recovery, daysSince(id), chainChoice: Map(chain → id), used:Set, prefer[], excluded:Set, favorites:Set, prefs:{id:'more'|'less'}, week }
 */
export function pickExercise(slot, all, ctx) {
  const pinned = slot.ids || [];
  for (const id of pinned) {
    const ex = all.find((e) => e.id === id);
    if (!ex || !canDo(ex, ctx.available) || ctx.used.has(id)) continue;
    // Your own picks (Build my own) are kept even if risky; the generator adds a warning instead.
    if (slot.userPicked) return ex;
    // Template pins (e.g. 5x5) get the same filters as everything else, then fall back to the slot's patterns.
    if (ctx.excluded.has(id)) continue;
    if ((ex.avoid || []).some((t) => ctx.avoid.has(t))) continue;
    if ((ex.level || 1) > ctx.maxLevel) continue;
    return ex;
  }
  for (let pi = 0; pi < slot.patterns.length; pi++) {
    const pattern = slot.patterns[pi];
    const cands = all.filter((e) =>
      e.pattern === pattern &&
      canDo(e, ctx.available) &&
      !ctx.used.has(e.id) &&
      !ctx.excluded.has(e.id) &&
      !(e.avoid || []).some((t) => ctx.avoid.has(t)) &&
      (e.level || 1) <= ctx.maxLevel &&
      (!e.chain || ctx.chainChoice.get(`${e.chain}|${e.pattern}`) === e.id) &&
      !(slot.role !== 'accessory' && e.kind === 'conditioning' && pattern !== 'conditioning')
    );
    if (!cands.length) continue;
    let best = null;
    let bestScore = -Infinity;
    for (const e of cands) {
      let s = 0;
      s += ROLE_LOAD_PREF[slot.role][e.load] ?? 0;
      if (ctx.prefer && ctx.prefer.length) s += ctx.prefer.includes(e.load) ? 25 - ctx.prefer.indexOf(e.load) * 3 : -20;
      if (slot.role !== 'accessory') s += e.kind === 'compound' ? 20 : -10;
      if (e.unilateral && slot.role === 'main') s -= 6; // bilateral lifts make better main lifts
      if (e.timed && slot.role !== 'accessory' && pattern !== 'conditioning') s -= 25; // holds don't anchor a session
      s += averageRecovery(ctx.recovery, e.primary || []) * 0.2;
      const since = ctx.daysSince(e.id);
      if (since != null) {
        if (slot.role !== 'accessory' && since <= 28) s += 40; // stick with your main lifts so they progress
        if (slot.role === 'accessory' && since <= 3) s -= 15; // rotate accessories
      }
      if (ctx.favorites.has(e.id)) s += 15;
      s += prefScore(ctx.prefs, e.id); // Recommend more / less: a nudge either way, never a ban
      // Accessories and secondary lifts rotate week to week through the wider pool; main lifts stay put so they progress.
      if (slot.role === 'accessory') s += hashPick(`${e.id}|${ctx.week || 0}`, 9);
      else if (slot.role === 'secondary') s += hashPick(`${e.id}|${ctx.week || 0}`, 5);
      if (ctx.avoidSoft && ctx.avoidSoft.has(e.id)) s -= 80; // Switch: anything else first
      s -= Math.max(0, (e.level || 1) - ctx.userLevel) * 6; // harder than your level costs points; easier doesn't
      if (s > bestScore || (s === bestScore && e.id < best.id)) {
        bestScore = s;
        best = e;
      }
    }
    return best;
  }
  return null;
}

// Minutes per set = time under load + the rest after it. Work: ~1 min main/secondary, 0.75 accessory, reps/60 for holds.
// restSec is the exercise's own rest, else your Settings default. (At the old 2:30 / 2:00 / 1:15 rests this is the old 3.5 / 3 / 2.)
export function minutesFor(ex, sets, role, target, restSec = REST_DEFAULT_SEC) {
  const work = ex.timed ? (target?.reps || ex.reps[1]) / 60 : role === 'accessory' ? 0.75 : 1;
  return sets * (work + restSec / 60);
}

/** Session minutes for a plan's items (each may carry its own rest_sec), including the warm-up. */
export function planMinutes(plan, exercises, defaultSec = REST_DEFAULT_SEC) {
  const sum = plan.exercises.reduce((m, it) => m + minutesFor(exercises.find((e) => e.id === it.exercise_id), it.target.sets, it.role, it.target, it.rest_sec || defaultSec), 0);
  return Math.round(sum + (plan.warm_min || 0));
}

/**
 * Builds a session.
 * opts: {
 *   programKey, program (stored doc), dayType (optional override), location { equipment[], weight_inventory },
 *   profile { experience, sessionMin, trainingDays, injuries }, unit, exercises (library + custom),
 *   historyFor(exId) → [{ date, sets:[{weight,reps,rir}] }] most recent first (weights in unit),
 *   daysSince(exId) → number|null, recovery {muscle:%}, doneCount, lastDayType, settings { excluded[], favorites[], exercise_prefs{} }, now
 * }
 */
export function generateWorkout(opts) {
  const {
    programKey = 'smart', program = null, location, profile, unit = 'lb', exercises,
    historyFor = () => [], daysSince = () => null, recovery = {}, doneCount = 0, lastDayType = null,
    settings = {}, now = Date.now(),
    // Preview edits (Train): forced = { pickedId: replacementId } (⋯ → Replace);
    // avoidIds = exercises to steer away from when there's another option (Switch).
    forced = {}, avoidIds = [],
    // Readiness (js/health/readiness.js): { level: 'green'|'amber'|'red', override?: true }. Amber takes a set
    // off every accessory; Red makes it a light day unless you override.
    readiness = null,
    // A one-day session length in minutes (Change → Shorter or longer); otherwise the profile's.
    sessionMin: sessionMinOpt = null,
    // Rests picked in ⋯ ({ exercise_id: sec }) so the length fit counts them.
    restSec = {},
    // Switch (Train): a day built from muscle groups, a saved workout or your own list: { key, label, slots, fixed? }.
    customDay = null,
  } = opts;
  // A fixed day is your own list, so the length is whatever you built (the length chips don't trim it).
  const sessionMin = customDay && customDay.fixed ? 600 : sessionMinOpt || profile.sessionMin || 60;
  const experience = profile.experience || 'beginner';
  const notes = [];
  const prog = PROGRAMS[programKey] || PROGRAMS.smart;

  const dayType = customDay ? customDay.key : opts.dayType || pickDayType(programKey, {
    recovery, doneCount, daysPerWeek: profile.trainingDays || 3, lastDayType, customDays: (program && program.custom_days) || [],
    focus: profile.focus_muscles,
  });

  let day;
  if (customDay) {
    day = customDay;
  } else if (dayType && dayType.startsWith('custom_')) {
    const cd = program.custom_days[Number(dayType.split('_')[1])];
    day = { label: cd.name, slots: cd.exercise_ids.map((id) => ({ patterns: [], role: 'secondary', ids: [id], userPicked: true })) };
  } else {
    day = DAY_TYPES[dayType];
  }
  if (!day) return { dayType: null, label: 'No workout', exercises: [], notes: ['Set up your days in Build my own.'], deload: false };

  const available = expandEquipment(location.equipment || []);
  if (prog.requires && !prog.requires.every((k) => available.has(k))) {
    notes.push(`${prog.name} needs a barbell and rack. This location doesn’t have them, so similar moves were picked instead.`);
  }

  const injuryAvoid = new Set(injuryTags(profile.injuries));
  const jointAvoid = jointAvoidSet(profile);
  const avoid = new Set([...injuryAvoid, ...jointAvoid]);
  if (avoid.size) notes.push(`Skipping moves that commonly stress your ${[...avoid].map((t) => t.replace('_', ' ')).join(', ')}. Swap any exercise if it feels fine for you.`);

  const { deload, week, cycle } = deloadInfo(program, experience, now);
  if (deload) notes.push('Deload week: lighter weights and fewer sets so you recover and come back stronger.');
  const rLevel = readiness && !readiness.override ? readiness.level : null;
  const readinessDeload = rLevel === 'red' && !deload;
  const lighter = deload || readinessDeload; // targets for a deload week, whether planned or from Readiness
  if (readinessDeload) notes.push('Your body is asking for a lighter day (Readiness is red), so this is a short, easy session. Mobility or a walk is a good swap too. You can train as planned instead.');
  if (rLevel === 'amber') notes.push('Readiness is amber: one set less on each accessory today.');

  // Chains: per chain AND movement pattern (e.g. the squat chain has squat steps and split-squat steps),
  // use the step you last trained; otherwise a starting step for your experience.
  const chainChoice = new Map();
  const groups = new Map();
  for (const e of exercises) {
    if (!e.chain) continue;
    const key = `${e.chain}|${e.pattern}`;
    groups.set(key, [...(groups.get(key) || []), e]);
  }
  for (const [key, list] of groups) {
    list.sort((a, b) => a.step - b.step);
    const doable = list.filter((e) => canDo(e, available) && (e.level || 1) <= (experience === 'advanced' ? 3 : 2));
    if (!doable.length) continue;
    let pick = null;
    let recent = Infinity;
    for (const e of doable) {
      const d = daysSince(e.id);
      if (d != null && d < recent) {
        recent = d;
        pick = e;
      }
    }
    if (!pick) {
      const target = defaultChainStep(list.length, experience);
      pick = doable.reduce((b, e) => (Math.abs(e.step - target) < Math.abs(b.step - target) ? e : b), doable[0]);
    }
    chainChoice.set(key, pick.id);
  }

  const ctx = {
    available, avoid, recovery, daysSince, chainChoice, used: new Set(),
    maxLevel: experience === 'advanced' ? 3 : 2, userLevel: LEVEL[experience] || 1,
    prefer: day.prefer || null,
    excluded: new Set(settings.excluded || []), favorites: new Set(settings.favorites || []),
    avoidSoft: new Set(avoidIds),
    prefs: cleanPrefs(settings.exercise_prefs),
    week: Math.floor(now / (7 * 86400000)),
  };

  const volume = prog.volume || 1;
  const items = [];
  let injuryDropped = false;
  // With Protect on, also pick what the plan would have been without it, to label each swap.
  const baseCtx = jointAvoid.size ? { ...ctx, avoid: injuryAvoid, used: new Set() } : null;
  const pickFor = (slot, c, extra = null) => {
    let e = pickExercise(slot, exercises, c);
    if (!e && !slot.userPicked) {
      const fb = fallbackPatterns(slot, extra);
      if (fb.length) e = pickExercise({ ...slot, patterns: fb, ids: [] }, exercises, c);
    }
    return e;
  };
  for (const slot of day.slots) {
    let ex = pickFor(slot, ctx, jointAvoid.size ? JOINT_FALLBACKS : null);
    const was = baseCtx ? pickFor(slot, baseCtx) : null;
    if (was) baseCtx.used.add(was.id);
    const swapTo = ex && forced[ex.id] ? exercises.find((e) => e.id === forced[ex.id]) : null;
    if (swapTo && !ctx.used.has(swapTo.id) && canDo(swapTo, available)) { ctx.used.add(ex.id); ex = swapTo; }
    if (!ex) {
      // Say why a slot is empty when it's your injury note (not missing equipment) that ruled it out.
      if (avoid.size) {
        const blocked = exercises.some((e) =>
          (slot.ids || []).includes(e.id) || slot.patterns.includes(e.pattern)
            ? canDo(e, available) && (e.avoid || []).some((t) => avoid.has(t))
            : false);
        if (blocked) {
          const what = (slot.patterns[0] || 'this slot').replace(/_/g, ' ');
          notes.push(`Left out ${what}: every option here commonly stresses your ${[...avoid].map((t) => t.replace('_', ' ')).join(', ')}. Add one back with “+ Add exercise” if it feels fine.`);
          injuryDropped = true;
        }
      }
      continue;
    }
    ctx.used.add(ex.id);
    const exForTarget = slot.reps ? { ...ex, reps: slot.reps } : prog.repBias === 'high' && !ex.timed ? { ...ex, reps: [Math.max(ex.reps[0], 8), Math.max(ex.reps[1], 12)] } : ex;
    const chainNext = ex.chain ? exercises.find((e) => e.chain === ex.chain && e.step === ex.step + 1 && canDo(e, available) && jointFriendly(e, avoid)) : null;
    const target = nextTarget(exForTarget, historyFor(ex.id), {
      inventory: location.weight_inventory || {}, unit, role: slot.role, experience, deload: lighter, chainNext,
    });
    if (slot.sets && !lighter) target.sets = slot.sets;
    else if (!lighter && volume !== 1) target.sets = Math.min(5, Math.round(defaultSets(slot.role, experience) * volume));
    if (rLevel === 'amber' && slot.role === 'accessory' && !lighter) target.sets = Math.max(1, target.sets - 1);
    const wu = slot.role !== 'accessory' && target.weight ? warmups(ex, target.weight, { inventory: location.weight_inventory || {}, unit }) : [];
    const risky = (ex.avoid || []).filter((t) => avoid.has(t));
    const warning = risky.length ? `Heads up: this commonly stresses your ${risky.map((t) => t.replace('_', ' ')).join(', ')} (${risky.some((t) => injuryAvoid.has(t)) ? 'from your injury note' : 'you turned on Protect'}). Swap it if it bothers you.` : null;
    const swap = swapInfo(was, ex, jointAvoid);
    items.push({ exercise_id: ex.id, role: slot.role, target, primary: ex.primary || [], warmups: items.length < 2 ? wu : wu.slice(-1), superset: null, warning, ...(swap ? { swap } : {}), ...(restSec[ex.id] ? { rest_sec: restSec[ex.id] } : {}) });
  }

  if (items.length < 4 && !injuryDropped && !(customDay && customDay.fixed)) {
    notes.push('This location doesn’t have much for today’s focus. Try a different day, or add equipment in Settings → Locations.');
  }

  // Fit the session length: drop accessories from the end until it fits.
  // A 20-minute session gets a shorter warm-up and only one lighter-set ramp.
  const warmMin = sessionMin <= 20 ? 3 : 5;
  if (sessionMin <= 20) for (const it of items) it.warmups = it.warmups.slice(0, items.indexOf(it) === 0 ? 1 : 0);
  const defaultRest = restDefaultSec(settings);
  const budget = sessionMin - warmMin;
  const total = () => items.reduce((m, it) => m + minutesFor(exercises.find((e) => e.id === it.exercise_id), it.target.sets, it.role, it.target, it.rest_sec || defaultRest), 0);
  while (total() > budget) {
    const idx = items.map((it) => it.role).lastIndexOf('accessory');
    if (idx === -1) break;
    items.splice(idx, 1);
  }
  // Still too long: trim sets on the later lifts toward a floor of 2 (not on a deload, which is already light)…
  while (total() > budget && !lighter) {
    let pick = -1;
    items.forEach((it, i) => { if (it.target.sets > 2 && (pick === -1 || it.target.sets >= items[pick].target.sets)) pick = i; });
    if (pick === -1) break;
    items[pick].target.sets -= 1;
  }
  // …then drop lifts from the end, always keeping the first one.
  while (total() > budget && items.length > 1) items.pop();

  // Focus areas: after the fit, +1 set on one lift per active focus group (main first, then secondary, then accessory),
  // at most FOCUS_MAX_ADDED in total, none on a deload or light day. Groups under ~60% recovered are skipped.
  // A set is added only if it fits the session, or by taking one set from the largest other lift above 2 sets. No lift is ever dropped.
  if (!lighter) {
    let added = 0;
    const donors = new Set();
    const chosen = new Set(cleanFocus(profile.focus_muscles).flatMap((k) => FOCUS_GROUPS[k].muscles));
    const trainsFocus = (it) => it.primary.some((m) => chosen.has(m));
    const rank = { main: 0, secondary: 1, accessory: 2 };
    const cost = (it, sets) => minutesFor(exercises.find((e) => e.id === it.exercise_id), sets, it.role, it.target, it.rest_sec || defaultRest);
    for (const key of activeFocus(profile.focus_muscles, recovery)) {
      if (added >= FOCUS_MAX_ADDED) break;
      const ms = FOCUS_GROUPS[key].muscles;
      const first = (it) => it.primary.findIndex((m) => ms.includes(m));
      const cand = items
        .filter((it) => !it.focusKey && !donors.has(it) && first(it) >= 0 && it.target.sets < 6)
        .sort((a, b) => rank[a.role] - rank[b.role] || first(a) - first(b))[0];
      if (!cand) continue;
      const extra = cost(cand, cand.target.sets + 1) - cost(cand, cand.target.sets);
      if (total() + extra <= budget) {
        cand.target.sets += 1;
      } else {
        let donor = null;
        for (const it of items) if (it !== cand && !it.focusKey && !trainsFocus(it) && it.target.sets > 2 && (!donor || it.target.sets >= donor.target.sets)) donor = it;
        if (!donor || total() + extra - (cost(donor, donor.target.sets) - cost(donor, donor.target.sets - 1)) > budget) continue;
        donor.target.sets -= 1;
        donors.add(donor);
        cand.target.sets += 1;
      }
      cand.focusKey = key;
      added += 1;
    }
  }

  // Short sessions: pair accessories into supersets.
  if (sessionMin <= 45) {
    const acc = items.filter((it) => it.role === 'accessory' && !exercises.find((e) => e.id === it.exercise_id).timed);
    for (let i = 0; i + 1 < acc.length; i += 2) {
      const g = String.fromCharCode(65 + i / 2);
      acc[i].superset = g;
      acc[i + 1].superset = g;
    }
  }

  const focus = [...new Set(items.filter((it) => it.focusKey).map((it) => it.focusKey))];
  const readinessApplied = rLevel === 'amber' ? 'amber' : readinessDeload ? 'red' : null;
  return { dayType, label: day.label, focus, focusLabel: focusLabel(focus), deload, readinessDeload, readiness: readinessApplied, week, cycle, notes, exercises: items, est_minutes: Math.round(total() + warmMin), warm_min: warmMin };
}
