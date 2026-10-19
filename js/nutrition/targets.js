// Calorie and macro targets. Pure functions, no browser APIs, so they can be unit tested.
//
// Sources:
// - BMR: Mifflin MD, St Jeor ST, et al. Am J Clin Nutr. 1990;51(2):241-247.
// - Calorie floors: Harvard Health Publishing, "Calorie counting made easy" — women should
//   not go below about 1,200 kcal/day and men about 1,500 kcal/day unless supervised by a
//   doctor. This is the more cautious choice: NIH/NHLBI describes low-calorie diets of
//   1,000–1,200 kcal/day for women and 1,200–1,600 kcal/day for men.
// - Protein 1.6–2.2 g/kg: Morton RW et al., Br J Sports Med. 2018;52:376-384, and
//   International Society of Sports Nutrition position stand on protein (2017).
// - 7,700 kcal per kg of body weight change: the standard rough estimate (about 3,500 kcal/lb).
//   It's an approximation; Phase 2 replaces it with adaptive TDEE from your real data.

export const KCAL_PER_KG = 7700;

export const CALORIE_FLOORS = { female: 1200, male: 1500, unspecified: 1500 };

export const FLOOR_SOURCE =
  'Harvard Health Publishing ("Calorie counting made easy"): about 1,200 kcal/day for women and 1,500 kcal/day for men, unless a doctor supervises. That’s more cautious than NIH/NHLBI’s low-calorie diet ranges (1,000–1,200 for women, 1,200–1,600 for men). "Prefer not to say" uses the higher floor.';

export const ACTIVITY_LEVELS = {
  sedentary: { factor: 1.2, label: 'Mostly sitting', hint: 'Desk job, little walking' },
  light: { factor: 1.375, label: 'Lightly active', hint: 'Some walking, 1–3 workouts a week' },
  moderate: { factor: 1.55, label: 'Moderately active', hint: 'On your feet often, 3–5 workouts a week' },
  very: { factor: 1.725, label: 'Very active', hint: 'Physical job or hard training 6–7 days' },
  extra: { factor: 1.9, label: 'Extremely active', hint: 'Physical job plus hard training' },
};

export const GOALS = {
  lose: { label: 'Lose fat', proteinPerKg: 2.0, defaultPace: 0.5 },
  muscle: { label: 'Build muscle', proteinPerKg: 1.8, defaultPace: 0.25 },
  recomp: { label: 'Recomp (lose fat, keep or build muscle)', proteinPerKg: 2.0, defaultPace: 0 },
  endurance: { label: 'Endurance', proteinPerKg: 1.6, defaultPace: 0 },
  health: { label: 'General health', proteinPerKg: 1.6, defaultPace: 0 },
};

export const MAX_LOSS_PCT = 1.0; // % of body weight per week (default cap)
export const MAX_LOSS_PCT_OVERRIDE = 1.5; // hard ceiling even with override
export const MAX_GAIN_PCT = 0.5;
export const MAX_SURPLUS_KCAL = 500;
export const RECOMP_DEFICIT_FRACTION = 0.1;

export function bmrMifflin({ weightKg, heightCm, age, sex }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (sex === 'male') return base + 5;
  if (sex === 'female') return base - 161;
  return base - 78; // average of the male (+5) and female (-161) constants
}

export function tdeeFrom(bmr, activity) {
  const level = ACTIVITY_LEVELS[activity] || ACTIVITY_LEVELS.sedentary;
  return bmr * level.factor;
}

export function bmi(weightKg, heightCm) {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/** Checks inputs for anything that should change advice or send the user to a professional. */
export function safetyFlags(p) {
  const flags = [];
  const currentBmi = bmi(p.weightKg, p.heightCm);
  if (p.age < 18) {
    flags.push({
      level: 'stop',
      code: 'minor',
      message: 'Weight-loss targets are turned off for anyone under 18. Please talk with a doctor or registered dietitian.',
    });
  }
  if (currentBmi < 18.5 && (p.goal === 'lose' || p.goal === 'recomp')) {
    flags.push({
      level: 'stop',
      code: 'underweight',
      message: 'Your BMI is under 18.5, so the app won’t set a calorie deficit. Please check with a doctor before trying to lose weight.',
    });
  }
  if (currentBmi >= 40) {
    flags.push({
      level: 'warn',
      code: 'bmi40',
      message: 'At a BMI of 40 or more, a doctor or dietitian can help you lose weight safely and may offer options this app can’t.',
    });
  }
  if (p.targetWeightKg && p.goal === 'lose' && bmi(p.targetWeightKg, p.heightCm) < 18.5) {
    flags.push({
      level: 'warn',
      code: 'low_target',
      message: 'Your target weight is below a BMI of 18.5. Consider a higher target, and check with a professional.',
    });
  }
  if (p.age > 80 || p.heightCm < 120 || p.heightCm > 230 || p.weightKg < 35 || p.weightKg > 300) {
    flags.push({
      level: 'warn',
      code: 'out_of_range',
      message: 'Some of your numbers are outside the range these formulas were built for, so treat the targets as rough. A professional can give you better ones.',
    });
  }
  return flags;
}

const round10 = (n) => Math.round(n / 10) * 10;

/**
 * profile: { goal, sex, age, heightCm, weightKg, targetWeightKg, activity, pacePct, allowFastPace }
 * pacePct is % of body weight per week (loss for 'lose', gain for 'muscle').
 */
export function computeTargets(p) {
  const goal = GOALS[p.goal] ? p.goal : 'health';
  const flags = safetyFlags(p);
  const stopped = flags.some((f) => f.level === 'stop');
  const reasoning = [];

  const bmr = bmrMifflin(p);
  const tdee = tdeeFrom(bmr, p.activity);
  const activityLabel = (ACTIVITY_LEVELS[p.activity] || ACTIVITY_LEVELS.sedentary).label.toLowerCase();
  reasoning.push(
    `Your resting burn (BMR) is about ${Math.round(bmr)} kcal/day, using the Mifflin-St Jeor formula.`,
    `Multiplied by ${(ACTIVITY_LEVELS[p.activity] || ACTIVITY_LEVELS.sedentary).factor} for “${activityLabel}”, your maintenance (TDEE) is about ${Math.round(tdee)} kcal/day.`
  );

  let pacePct = Number.isFinite(p.pacePct) ? p.pacePct : GOALS[goal].defaultPace;
  let paceCapped = false;
  let delta = 0;

  if (goal === 'lose') {
    if (stopped) {
      pacePct = 0;
      reasoning.push('No deficit is set because of the safety note below.');
    } else {
      const cap = p.allowFastPace ? MAX_LOSS_PCT_OVERRIDE : MAX_LOSS_PCT;
      if (pacePct > cap) {
        pacePct = cap;
        paceCapped = true;
      }
      delta = -((p.weightKg * pacePct) / 100) * KCAL_PER_KG / 7;
      reasoning.push(
        `To lose about ${pacePct}% of your body weight per week, you need a deficit of about ${Math.round(-delta)} kcal/day.`
      );
    }
  } else if (goal === 'muscle') {
    if (pacePct > MAX_GAIN_PCT) {
      pacePct = MAX_GAIN_PCT;
      paceCapped = true;
    }
    delta = Math.min(((p.weightKg * pacePct) / 100) * KCAL_PER_KG / 7, MAX_SURPLUS_KCAL);
    reasoning.push(
      `For lean muscle gain of about ${pacePct}% of body weight per week, you get a small surplus of about ${Math.round(delta)} kcal/day.`
    );
  } else if (goal === 'recomp') {
    pacePct = 0;
    if (!stopped) {
      delta = -tdee * RECOMP_DEFICIT_FRACTION;
      reasoning.push('Recomp uses a small deficit (about 10% below maintenance) with high protein.');
    }
  } else {
    pacePct = 0;
    reasoning.push('Your goal doesn’t need a deficit or surplus, so calories are set to maintenance.');
  }

  let calories = tdee + delta;
  const floor = CALORIE_FLOORS[p.sex] || CALORIE_FLOORS.unspecified;
  let floorApplied = false;
  if (calories < floor) {
    calories = floor;
    floorApplied = true;
    reasoning.push(`That came out below the safe floor, so it’s raised to ${floor} kcal/day. Source: ${FLOOR_SOURCE}`);
  }
  if (tdee < floor) {
    flags.push({
      level: 'warn',
      code: 'tdee_below_floor',
      message: 'Your estimated maintenance is below the general safe floor. These targets may not fit you. A registered dietitian can help.',
    });
  }
  if (paceCapped && goal === 'lose') {
    reasoning.push(
      p.allowFastPace
        ? `Pace is capped at ${MAX_LOSS_PCT_OVERRIDE}% per week even with the override.`
        : `Pace is capped at ${MAX_LOSS_PCT}% per week. You can override this in your profile.`
    );
  }

  const dailyDelta = Math.round(calories - tdee);
  calories = round10(calories);

  // Protein: per kg of body weight. With BMI 30+, use the target weight (if lower), because
  // per-kg protein guidance is based on leaner people.
  const currentBmi = bmi(p.weightKg, p.heightCm);
  let refKg = p.weightKg;
  let refNote = 'your current weight';
  if (currentBmi >= 30 && p.targetWeightKg && p.targetWeightKg < p.weightKg) {
    refKg = p.targetWeightKg;
    refNote = 'your target weight (with a BMI of 30 or more, current weight overstates protein needs)';
  }
  const perKg = GOALS[goal].proteinPerKg;
  const proteinG = Math.round(refKg * perKg);
  reasoning.push(`Protein: ${perKg} g per kg of ${refNote} = ${proteinG} g/day (research supports 1.6–2.2 g/kg for building and keeping muscle).`);

  // Fat: 25% of calories, at least 0.6 g/kg. Carbs: the rest.
  let fatG = Math.round(Math.max((calories * 0.25) / 9, refKg * 0.6));
  let carbG = Math.round((calories - proteinG * 4 - fatG * 9) / 4);
  if (carbG < 0) {
    carbG = 0;
  }
  reasoning.push(`Fat: 25% of calories (at least 0.6 g/kg) = ${fatG} g. Carbs fill the rest: ${carbG} g.`);

  const paceKgPerWeek = (dailyDelta * 7) / KCAL_PER_KG;

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    calories,
    proteinG,
    fatG,
    carbG,
    floor,
    floorApplied,
    pacePct,
    paceCapped,
    dailyDelta,
    paceKgPerWeek,
    bmi: Math.round(currentBmi * 10) / 10,
    flags,
    reasoning,
  };
}

export const PROTEIN_GOAL_MIN_G = 40;
export const PROTEIN_GOAL_MAX_G = 300;

/** The custom protein goal in whole grams, or null (Auto) when the field is missing or not a usable number. */
export function customProteinG(profile) {
  const v = profile && profile.proteinGoalG;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const g = Math.round(v);
  return g >= PROTEIN_GOAL_MIN_G && g <= PROTEIN_GOAL_MAX_G ? g : null;
}

/** Applies the optional own protein goal to computeTargets output. Carbs refill from the calories left; calories and fat stay. */
export function applyProteinGoal(targets, profile) {
  const g = customProteinG(profile);
  if (!targets || g === null) return targets;
  const carbG = Math.max(0, Math.round((targets.calories - g * 4 - targets.fatG * 9) / 4));
  return {
    ...targets,
    autoProteinG: targets.proteinG,
    proteinG: g,
    carbG,
    reasoning: [...targets.reasoning, `Protein: your own goal, ${g} g/day.`],
  };
}

export const PROTEIN_STEP_G = 5;

/** One tap of − / +: moves by 5 g, stays inside 40–300 g. */
export function stepProtein(g, dir) {
  const v = Math.round(Number(g) || 0) + dir * PROTEIN_STEP_G;
  return Math.min(PROTEIN_GOAL_MAX_G, Math.max(PROTEIN_GOAL_MIN_G, v));
}

/** A typed value as whole grams inside 40–300, or null when it isn't usable. */
export function parseProteinInput(text) {
  const n = Number(String(text).trim());
  if (!String(text).trim() || !Number.isFinite(n) || n < PROTEIN_GOAL_MIN_G || n > PROTEIN_GOAL_MAX_G) return null;
  return Math.round(n);
}

/** Where Custom starts: the auto value rounded to 5 g, kept in range. */
export function startProteinG(autoG) {
  const v = Math.round((Number(autoG) || 0) / PROTEIN_STEP_G) * PROTEIN_STEP_G;
  return Math.min(PROTEIN_GOAL_MAX_G, Math.max(PROTEIN_GOAL_MIN_G, v));
}
