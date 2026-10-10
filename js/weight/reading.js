// The latest weigh-in as the user sees it (pure: no state, no DOM).
import { dayKey } from './smoothing.js';

/** Newest reading in `weights`, skipping review ones and ids in `skip`. { kg, day, measured_at, source, created_at } or null. */
export function pickLatest(weights, skip = new Set()) {
  let best = null;
  for (const w of weights || []) {
    if (!w || !Number.isFinite(w.kg) || w.review || skip.has(w.id)) continue;
    if (!best || w.day > best.day || (w.day === best.day && (w.measured_at || '') > (best.measured_at || ''))) best = w;
  }
  return best ? { kg: best.kg, day: best.day, measured_at: best.measured_at || null, source: best.source, created_at: best.created_at } : null;
}

/**
 * " · 7:42 AM" when the weigh-in has a real time: scale and Apple Health readings, and typed-in weights
 * logged for today. Typed-in weights for a past day get a placeholder 8 AM, so they show no time.
 */
export function timeOf(w) {
  if (!w.measured_at) return '';
  const d = new Date(w.measured_at);
  if (Number.isNaN(d.getTime())) return '';
  if (w.source === 'manual' && !(w.created_at && dayKey(w.created_at) === w.day)) return '';
  return ` · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/** "Today · 7:42 AM", "Yesterday", "Latest · Oct 8": what the big number on a weight card is. */
export function readingLabel(r, today) {
  if (r.day === today) return `Today${timeOf(r)}`;
  const y = new Date(`${today}T12:00:00`);
  y.setDate(y.getDate() - 1);
  if (r.day === dayKey(y)) return 'Yesterday';
  return `Latest · ${new Date(`${r.day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
