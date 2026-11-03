// What a stored weight number MEANS for an exercise (display only; stored numbers and progression never change).
//   per_hand       two dumbbells, the number is each one ("30 lb each hand")
//   total          one implement held with both hands, a pack, or a barbell (total incl. bar)
//   per_side       one implement, one arm/leg at a time ("30 lb per side")
//   machine_stack  machine or cable pin/stack setting ("Stack 50 lb")
//   bodyweight     no external load (an added load shows as "+X lb")

export const LOAD_TYPES = ['per_hand', 'total', 'per_side', 'machine_stack', 'bodyweight'];

const PER_HAND = ('db_floor_press db_bench_press db_incline_press db_decline_press db_fly db_floor_fly db_incline_fly db_bent_row '
  + 'db_chest_supported_row db_renegade_row db_rdl db_squat db_seated_shoulder_press db_standing_shoulder_press db_arnold_press db_z_press '
  + 'db_lateral_raise db_rear_delt_fly db_prone_rear_delt_fly db_curl db_hammer_curl db_incline_curl db_skull_crusher db_kickback db_shrug '
  + 'db_calf_raise db_farmer_carry db_thruster db_shadowboxing '
  // unilateral leg moves normally done with a dumbbell in each hand
  + 'db_single_leg_rdl db_bulgarian_split_squat db_reverse_lunge db_walking_lunge db_lateral_lunge db_step_up').split(' ');
const TOTAL = ('db_swing db_goblet_squat db_sumo_squat db_overhead_triceps db_pullover db_hip_thrust kb_swing kb_goblet_squat kb_deadlift '
  + 'kb_halo kb_russian_twist kb_high_pull kb_thruster kb_goblet_reverse_lunge kb_overhead_triceps mb_chest_pass mb_rotational_throw mb_slam back_extension').split(' ');
const PER_SIDE = ('db_one_arm_row db_concentration_curl db_single_leg_calf_raise db_suitcase_carry db_side_bend kb_one_arm_swing kb_single_leg_deadlift '
  + 'kb_row kb_press kb_floor_press kb_turkish_getup kb_clean kb_snatch kb_windmill kb_suitcase_carry kb_overhead_carry').split(' ');

const BY_ID = {};
for (const id of PER_HAND) BY_ID[id] = 'per_hand';
for (const id of TOTAL) BY_ID[id] = 'total';
for (const id of PER_SIDE) BY_ID[id] = 'per_side';

/** The loadType for a library entry { id, load }. Every entry gets one. */
export function loadTypeFor(e) {
  if (BY_ID[e.id]) return BY_ID[e.id];
  switch (e.load) {
    case 'barbell': case 'smith': case 'backpack': return 'total';
    case 'machine': case 'cable': return 'machine_stack';
    case 'dumbbell': case 'kettlebell': return 'total'; // unlisted single-implement default; the CI test makes this explicit
    default: return 'bodyweight';
  }
}

const typeOf = (ex) => (ex && ex.loadType) || (ex ? loadTypeFor(ex) : 'total');
const inclBar = (ex) => !!ex && (ex.load === 'barbell' || ex.load === 'smith');

/** The words after the number: 'each hand', 'total', 'total incl. bar', 'per side', 'stack' or ''. */
export function loadSuffix(ex) {
  const t = typeOf(ex);
  if (t === 'per_hand') return 'each hand';
  if (t === 'per_side') return 'per side';
  if (t === 'machine_stack') return 'stack';
  if (t === 'bodyweight') return '';
  return inclBar(ex) ? 'total incl. bar' : 'total';
}

const fmtN = (n) => String(Math.round(Number(n) * 10) / 10);

/** Short label: '30 lb each hand', '30 lb total', '135 lb total incl. bar', '30 lb per side', 'Stack 50 lb', '+10 lb'. */
export function loadLabel(n, ex, u) {
  const t = typeOf(ex);
  const v = `${fmtN(n)} ${u}`;
  if (t === 'machine_stack') return `Stack ${v}`;
  if (t === 'bodyweight') return `+${v}`;
  return `${v} ${loadSuffix(ex)}`;
}

/** Full phrase for VoiceOver: '30 pounds in each hand', '135 pounds total, including the bar', 'Stack set to 50 pounds'. */
export function loadPhrase(n, ex, u) {
  const t = typeOf(ex);
  const unit = u === 'kg' ? (Number(n) === 1 ? 'kilogram' : 'kilograms') : (Number(n) === 1 ? 'pound' : 'pounds');
  const v = `${fmtN(n)} ${unit}`;
  if (t === 'per_hand') return `${v} in each hand`;
  if (t === 'per_side') return `${v}, one side at a time`;
  if (t === 'machine_stack') return `Stack set to ${v}`;
  if (t === 'bodyweight') return `Plus ${v}`;
  return inclBar(ex) ? `${v} total, including the bar` : `${v} total`;
}

/** For an empty weight field: 'Weight in pounds, in each hand'. */
export function loadFieldAria(ex, u) {
  const unit = u === 'kg' ? 'kilograms' : 'pounds';
  const t = typeOf(ex);
  const tail = t === 'per_hand' ? ', in each hand' : t === 'per_side' ? ', one side at a time' : t === 'machine_stack' ? ', stack setting' : t === 'bodyweight' ? ', added weight' : inclBar(ex) ? ', total including the bar' : ', total';
  return `Weight in ${unit}${tail}`;
}

/** Just the meaning, for a caption under the number: 'in each hand' etc. ('' when there is nothing to add). */
export function loadCaption(ex, short = false) {
  const t = typeOf(ex);
  if (t === 'per_hand') return 'each hand';
  if (t === 'per_side') return 'per side';
  if (t === 'machine_stack') return short ? 'stack' : 'stack setting';
  if (t === 'bodyweight') return short ? 'added' : 'added weight';
  return inclBar(ex) && !short ? 'total incl. bar' : 'total';
}
