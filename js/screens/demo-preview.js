// Train: tap an exercise to preview its demo before starting (v0.16.42).
// The same looping demo as the How-To sheet and the player, plus cues, muscles and joint notes, with Swap and
// Replace right there. On a wide screen (Duo unfolded) it is a side panel instead of a bottom sheet.
import { state } from '../state.js';
import { esc, $, sheet } from '../ui.js';
import { mountFigure, hasFigure } from '../ui/figure.js';
import { photoLoop, hasPhotos, loadPhotoIndex, photoFallback } from '../ui/photos.js';
import { bodyMap, exerciseValues } from '../ui/bodymap.js';
import { MUSCLE_LABELS } from '../workouts/recovery.js';
import { jointAvoidSet } from '../workouts/generator.js';
import { SAFETY_LINE } from '../ui/protect-view.js';
import { reducedMotion } from '../ui/motion.js';
import { jointNotes, openKeyframes } from '../workouts/demo-preview-core.js';

/**
 * Open the preview for `ex`. `origin` is the tapped thumbnail (the demo grows out of it). `canSwap` says whether
 * Swap has a move to offer; `onSwap()` / `onReplace()` run after the sheet closes. (sheet() gives the light haptic.)
 */
export function openDemoPreview(ex, { origin, canSwap = true, onSwap, onReplace } = {}) {
  const works = ex.primary.map((m) => MUSCLE_LABELS[m] || m).join(', ');
  const also = (ex.secondary || []).map((m) => MUSCLE_LABELS[m] || m).join(', ');
  const notes = jointNotes(ex, jointAvoidSet(state.profile));
  const from = origin && origin.getBoundingClientRect ? origin.getBoundingClientRect() : null;

  return sheet(ex.name, (body, close) => {
    body.closest('dialog')?.classList.add('demo-sheet');
    const cues = (ex.cues || []).map((c) => `<li>${esc(c)}</li>`).join('') || '<li class="muted">No cues yet</li>';
    const joints = notes.length
      ? `<div class="demo-joints" data-joints>${notes.map((n) => `<p class="${n.stress ? 'stress' : 'easy'}">${esc(n.text)}</p>`).join('')}<p class="small muted">${esc(SAFETY_LINE)}</p></div>`
      : '';
    body.innerHTML = `
      <div class="stack demo-prev">
        <div class="ht-demo" data-demo role="img" aria-label="${esc(ex.name)} demo"></div>
        <div><p class="label">Form cues</p><ul class="reasons">${cues}</ul></div>
        <p><b>Works:</b> ${esc(works)}${also ? `<span class="muted"> · also ${esc(also)}</span>` : ''}</p>
        ${joints}
        <div class="row gap demo-actions">
          <button class="btn ghost grow" data-a="swap" ${canSwap ? '' : 'disabled'}>Swap</button>
          <button class="btn ghost grow" data-a="replace">Replace</button>
        </div>
        ${canSwap ? '' : '<p class="small muted">No other move fits here right now. Replace lets you browse.</p>'}
      </div>`;

    const demo = $('[data-demo]', body);
    const mapHtml = () => bodyMap(exerciseValues(ex), { size: 'small' });
    let shown = '';
    const show = () => {
      const want = hasFigure(ex.id) ? 'figure' : hasPhotos(ex.id) ? 'photos' : 'map';
      if (want === shown) return;
      shown = want;
      if (want === 'figure') { demo.innerHTML = '<div class="fig-wrap"></div>'; mountFigure(demo.firstChild, ex); }
      else if (want === 'photos') { demo.innerHTML = photoLoop(ex.id, ex.name); photoFallback(demo, mapHtml()); } // offline and not cached: the muscle map
      else demo.innerHTML = mapHtml();
    };
    show();
    loadPhotoIndex().then(() => { if (demo.isConnected) show(); });

    // Grow out of the thumbnail once the sheet is up (a short crossfade under Reduce Motion).
    if (demo.animate) {
      requestAnimationFrame(() => {
        const reduced = reducedMotion();
        demo.animate(openKeyframes(from, demo.getBoundingClientRect(), reduced), { duration: reduced ? 160 : 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
      });
    }

    $('[data-a="swap"]', body).onclick = () => { close(); if (onSwap) onSwap(); };
    $('[data-a="replace"]', body).onclick = () => { close(); if (onReplace) onReplace(); };
  }, { detents: ['medium', 'large'] });
}
