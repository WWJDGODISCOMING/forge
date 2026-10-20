// Where the cards go on Today and Train (v0.15.20, part 3 of the approved IA). Pure, so the rules are unit-tested.

/** Today, top to bottom. `alert` is the single banner slot; Weekly report and Score share `report`; the rest are cards. */
export const TODAY_ORDER = ['alert', 'coach', 'workout', 'rings', 'missions', 'food', 'weight', 'report', 'photo', 'readiness', 'insights'];

/** Train, top to bottom. The fresh-muscle stat and the Recovery map are one card. */
export const TRAIN_ORDER = ['places', 'recovery', 'resume', 'workout', 'why', 'program', 'tools', 'history'];

/** Banners that could show on Today, most important first. Only the first one with content shows. */
export const ALERT_PRIORITY = ['refresh', 'flags', 'install', 'program-done', 'badge', 'tour-offer'];

/**
 * The one banner for the alert slot. `makers` maps an alert id to a function that returns its HTML (or ''); they run
 * lazily, in priority order, so a banner that loses never renders (and never counts as seen).
 */
export function pickAlert(makers) {
  for (const id of ALERT_PRIORITY) {
    const html = makers[id] ? makers[id]() : '';
    if (html) return { id, html };
  }
  return { id: null, html: '' };
}

/** The data-flag banner: the most serious one (stop, then warn, then info). */
export function topFlag(flags) {
  const rank = { stop: 0, warn: 1, info: 2 };
  const sorted = [...(flags || [])].sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3));
  return sorted[0] || null;
}

/** Weekly report or Forge Score, never both: the report wins on the days it is due. */
export function reportOrScore({ weekly, score }) {
  return weekly ? { id: 'weekly', html: weekly } : score ? { id: 'score', html: score } : { id: null, html: '' };
}
