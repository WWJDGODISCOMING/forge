// Cardio activity names and the small pure helpers around them (shared by the log sheet, History and the CSV export).

/** Activities that have no distance, so the sheet hides the field and saves none. */
export const NO_DISTANCE = ['jog_in_place', 'strength'];

export const CARDIO_TYPES = {
  strength: 'Strength', peloton: 'Peloton ride', bike: 'Bike (other)', run: 'Run', jog_in_place: 'Jog in place', walk: 'Walk', row: 'Row', elliptical: 'Elliptical', stairs: 'Stair climber',
  boxing: 'Boxing / shadowboxing', hiit: 'HIIT / intervals', jump_rope: 'Jump rope', swim: 'Swim', other: 'Other',
};

/** Distance to save, in km: null when none was typed or the activity can't have one. `dist` is 'mi' or 'km'. */
export function cardioDistanceKm(activity, typed, dist) {
  if (!typed || NO_DISTANCE.includes(activity)) return null;
  return Number(typed) * (dist === 'mi' ? 1.609344 : 1);
}

export const CARDIO_CSV_COLUMNS = ['day', 'started_at', 'activity', 'activity_name', 'duration_min', 'distance_km', 'distance_mi', 'calories', 'avg_hr', 'notes', 'source', 'id'];

/** CSV rows for cardio sessions: adds a readable `activity_name` next to the stable `activity` key. */
export function cardioCsvRows(sessions) {
  return sessions.filter((r) => !r.deleted)
    .sort((a, b) => (a.started_at < b.started_at ? -1 : 1))
    .map((r) => ({ ...r, activity_name: CARDIO_TYPES[r.activity] || r.activity, distance_mi: r.distance_km ? (r.distance_km / 1.609344).toFixed(2) : '' }));
}

/** The stat tiles for the History detail sheet; no Distance tile for activities that can't have one. `u` is 'kg' (metric) or 'lb'. */
export function cardioStatsHtml(c, u) {
  const dist = c.distance_km ? (u === 'kg' ? `${c.distance_km.toFixed(2)} km` : `${(c.distance_km / 1.609344).toFixed(2)} mi`) : '—';
  return `<div><span>Minutes</span><b>${c.duration_min}</b></div>`
    + (NO_DISTANCE.includes(c.activity) ? '' : `<div><span>Distance</span><b>${dist}</b></div>`)
    + `<div><span>Calories</span><b>${c.calories ?? '—'}</b></div>`;
}
