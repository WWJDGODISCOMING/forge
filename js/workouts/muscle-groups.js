// One primary muscle group per exercise, for the Library sections and the Train preview labels. Pure; no DOM.
export const GROUPS = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core', 'other'];
export const GROUP_LABELS = { chest: 'Chest', back: 'Back', legs: 'Legs', shoulders: 'Shoulders', arms: 'Arms', core: 'Core', other: 'Other' };

// The movement pattern decides first (a row is Back whatever the secondary muscles are)...
const BY_PATTERN = {
  horizontal_push: 'chest', chest_fly: 'chest',
  horizontal_pull: 'back', vertical_pull: 'back', shrug: 'back',
  squat: 'legs', hinge: 'legs', lunge: 'legs', knee_extension: 'legs', knee_flexion: 'legs', hip_thrust: 'legs',
  hip_abduction: 'legs', hip_adduction: 'legs', calf: 'legs',
  vertical_push: 'shoulders', lateral_raise: 'shoulders', rear_delt: 'shoulders', skill_handstand: 'shoulders',
  biceps: 'arms', triceps: 'arms',
  core_anti_extension: 'core', core_flexion: 'core', core_rotation: 'core', core_lateral: 'core', carry: 'core', skill_lsit: 'core',
  conditioning: 'other', mobility: 'other',
};

// ...then the first primary muscle (jumps, and custom exercises with an unusual pattern).
const BY_MUSCLE = {
  chest: 'chest', lats: 'back', upper_back: 'back', traps: 'back', lower_back: 'back',
  quads: 'legs', hamstrings: 'legs', glutes: 'legs', adductors: 'legs', abductors: 'legs', calves: 'legs',
  front_delts: 'shoulders', side_delts: 'shoulders', rear_delts: 'shoulders',
  biceps: 'arms', triceps: 'arms', forearms: 'arms',
  abs: 'core', obliques: 'core',
};

/** The group key for one exercise: always one of GROUPS. */
export function muscleGroup(ex) {
  if (!ex) return 'other';
  return BY_PATTERN[ex.pattern] || BY_MUSCLE[(ex.primary || [])[0]] || 'other';
}

/** Splits a list into sections in the fixed order, keeping the incoming order inside each. Empty groups are left out. */
export function groupExercises(list) {
  const by = Object.fromEntries(GROUPS.map((g) => [g, []]));
  for (const e of list) by[muscleGroup(e)].push(e);
  return GROUPS.filter((g) => by[g].length).map((g) => ({ key: g, label: GROUP_LABELS[g], items: by[g] }));
}
