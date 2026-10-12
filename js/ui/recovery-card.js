// The Recovery card: the fresh-muscle number with the front/back heatmap directly under it, one card.
// It lives on Train (next to the workout it informs). Tap a muscle for its %, when you last trained it and its sets this week.
import { state } from '../state.js';
import { esc, $$, sheet } from '../ui.js';
import { exerciseById } from '../workouts/library.js';
import { MUSCLE_LABELS, muscleStats, SHOW_MUSCLES as SHOW, freshCount } from '../workouts/recovery.js';
import { bodyMap, musclesIn, regionLabel, recoveryColor } from './bodymap.js';

const ago = (iso) => {
  if (!iso) return 'Not trained yet';
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`;
};
const status = (pct) => (pct < 50 ? 'Needs rest' : pct < 85 ? 'Recovering' : 'Ready');

export function recoveryCardHtml(rec) {
  const fresh = freshCount(rec);
  const tired = [...SHOW].sort((a, b) => rec[a] - rec[b]).filter((m) => rec[m] < 85).slice(0, 4);
  return `<div class="card recovery-card" id="body-recovery" tabindex="-1" data-recovery-card>
    <div class="row between center" data-tour="train-recovery"><div class="rc-stat"><b data-count>${fresh}</b><span>fresh muscle groups</span></div><span class="small muted">Tap a muscle</span></div>
    ${bodyMap(rec, { mode: 'recovery', tappable: true })}
    <div class="bm-legend">
      <span><i style="background:${recoveryColor(100)}"></i>Ready</span>
      <span><i style="background:${recoveryColor(70)}"></i>Recovering</span>
      <span><i style="background:${recoveryColor(20)}"></i>Needs rest</span>
    </div>
    ${tired.length ? `<p class="small muted">Least recovered: ${tired.map((m) => `${esc(MUSCLE_LABELS[m])} ${rec[m]}%`).join(' · ')}</p>` : '<p class="small muted">Everything is recovered. Good day to train anything.</p>'}
    <p class="small muted">Based on your sets, effort and time since (big muscles ~72 h, small ~48 h).</p>
  </div>`;
}

/** Wire the muscle taps inside `el`. */
export function bindRecoveryCard(el, rec) {
  const open = (region) => {
    const [side, slug] = region.split(':');
    const ms = musclesIn(side, slug);
    if (!ms.length) return;
    const stats = muscleStats(state.workouts, exerciseById);
    sheet(regionLabel(slug), (body) => {
      body.innerHTML = `<div class="stack">${ms.map((m) => `
        <div class="bm-detail">
          <div class="row between"><b>${esc(MUSCLE_LABELS[m])}</b><span class="bm-pill" style="--c:${recoveryColor(rec[m])}">${rec[m]}% · ${status(rec[m])}</span></div>
          <div class="rec-bar"><i style="width:${rec[m]}%;background:${recoveryColor(rec[m])}"></i></div>
          <p class="small muted">Last trained: ${ago(stats[m].last)} · Sets this week: ${Math.round(stats[m].weekSets * 10) / 10}</p>
        </div>`).join('')}</div>`;
    });
  };
  $$('[data-region]', el).forEach((g) => {
    g.addEventListener('click', () => open(g.dataset.region));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(g.dataset.region);
      }
    });
  });
}
