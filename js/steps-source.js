// Where a day's steps came from. The server keeps the higher of Apple Health and Withings in `steps` and
// says which one won in `steps_source` ('apple' | 'withings'); older rows have neither and are Apple's.

/** "from Withings" / "from Apple Health", or '' when the row has no steps. */
export function stepsSourceLabel(row) {
  if (!row || typeof row.steps !== 'number') return '';
  return row.steps_source === 'withings' ? 'from Withings' : 'from Apple Health';
}

/** True when the Withings link was made before steps were asked for (known scopes, no user.activity). */
export function needsActivityScope(status) {
  const s = status && status.scopes;
  return !!(status && status.connected && !status.needs_reconnect && typeof s === 'string' && s.trim() && !s.split(/[,\s]+/).includes('user.activity'));
}
