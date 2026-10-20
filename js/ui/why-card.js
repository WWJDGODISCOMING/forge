// Train's "Why this workout" card: collapsed by default, with a count in the header and every note in the body. Pure, so it is unit-tested.
import { esc } from '../ui.js';
import { icon } from './icons.js';

/** `notes` are plain strings; `stalledNames` are the stalled main lifts (the deload offer needs 2 or more). */
export function whyCardHtml(notes, stalledNames) {
  const nStall = stalledNames.length >= 2 ? stalledNames.length : 0;
  if (!notes.length && !nStall) return '';
  const stall = nStall ? `${nStall} main lifts have stalled (${stalledNames.map(esc).join(', ')}). A lighter week often breaks a plateau.` : '';
  const parts = [];
  if (notes.length) parts.push(`${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`);
  if (nStall) parts.push(`${nStall} lifts stalled`);
  return `<div class="card why-card" data-why-card>
    <button class="why-head" type="button" data-why-toggle aria-expanded="false" aria-controls="why-body">
      <span class="why-text"><span class="label">Why this workout</span><span class="small why-first">${parts.join(' · ')}</span></span>
      <span class="why-chev" aria-hidden="true">${icon('chev')}</span></button>
    <div class="why-body stack" id="why-body" data-why-body hidden>
      ${notes.map((x) => `<p class="small">${esc(x)}</p>`).join('')}
      ${stall ? `<p class="small">${stall}</p>` : ''}
      ${nStall ? '<div class="row gap"><button class="btn small" data-deload>Start a deload week</button></div>' : ''}
    </div>
  </div>`;
}
