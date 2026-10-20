// Train's demo preview (v0.16.42), the pure half: joint notes, the one-tap Swap pick and the open-from-thumbnail motion.
import { jointFriendly } from './generator.js';

const WORDS = { knee: 'knees', lower_back: 'lower back' };

/** Lines about the joints you protect for this move. Empty when no joint is on. */
export function jointNotes(ex, avoid) {
  if (!avoid || !avoid.size) return [];
  return [...avoid].filter((t) => WORDS[t]).map((t) => ((ex.avoid || []).includes(t)
    ? { joint: t, stress: true, text: `This one can load your ${WORDS[t]}. Swap it for an easier move if it bothers you.` }
    : { joint: t, stress: false, text: `Easy on your ${WORDS[t]}.` }));
}

/**
 * The move Swap picks: the slot's own movement first, then (with Protect on) its joint stand-ins in order (`patterns`,
 * as the Replace picker lists them). It must be doable here, not already in the plan and easy on the joints you
 * protect; the closest match on muscles worked wins, ties go to the first in the list so the pick is steady.
 */
export function swapCandidate(slotEx, current, { exercises, canDo, inPlan, avoid, patterns }) {
  const order = patterns && patterns.length ? patterns : [slotEx.pattern];
  const want = new Set(slotEx.primary || []);
  let best = null;
  let bestKey = null;
  for (const c of exercises) {
    const rank = order.indexOf(c.pattern);
    if (rank < 0 || c.id === current.id || inPlan.has(c.id) || !canDo(c) || !jointFriendly(c, avoid)) continue;
    const key = [rank, -(c.primary || []).filter((m) => want.has(m)).length];
    if (!best || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) { best = c; bestKey = key; }
  }
  return best;
}

/** Where the demo starts when it opens from the thumbnail: translate + scale from its rect to the demo's rect. */
export function originTransform(from, to) {
  if (!from || !to || !to.width || !to.height) return null;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  return { dx, dy, scale: Math.max(0.05, Math.min(1, from.width / to.width)) };
}

/** Keyframes for that: a short crossfade when Reduce Motion is on, otherwise grow out of the thumbnail. */
export function openKeyframes(from, to, reduced) {
  const t = reduced ? null : originTransform(from, to);
  if (!t) return [{ opacity: 0 }, { opacity: 1 }];
  return [
    { transform: `translate(${t.dx}px, ${t.dy}px) scale(${t.scale})`, opacity: 0.6 },
    { transform: 'none', opacity: 1 },
  ];
}

/**
 * A rect measured while the dialog is mid-slide, moved to where it sits once the dialog rests: its live --sheet-y
 * minus the resting offset (the medium detent leaves half the screen showing; large and the side panel rest at 0).
 */
export function restingRect(rect, dialog, viewH = (typeof innerHeight === 'number' ? innerHeight : 0)) {
  const y = parseFloat(dialog?.style?.getPropertyValue?.('--sheet-y')) || 0;
  const rest = dialog?.classList?.contains('at-medium') ? Math.max(0, (dialog.offsetHeight || 0) - viewH * 0.5) : 0;
  return { left: rect.left, top: rect.top - (y - rest), width: rect.width, height: rect.height };
}
