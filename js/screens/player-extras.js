// The player's History and Replace chips. History: past sessions of this move with a small trend.
// Replace: the swap picker (same movement, doable here, easy on Joints to protect) that keeps the set targets.
import { state } from '../state.js';
import { esc, $, sheet, toast } from '../ui.js';
import { historyIndex, unit } from '../workouts/plan.js';
import { exerciseById } from '../workouts/library.js';
import { canDo } from '../workouts/equipment.js';
import { jointAvoidSet, jointFriendly, jointPickerPatterns } from '../workouts/generator.js';
import { live, save } from '../workouts/live.js';
import { haptics } from '../ui/haptic.js';
import { openExercisePicker } from './picker.js';
import { buildEntry, availableHere } from './session.js';
import { historyRows, trendValues, sparkPoints, trendWords, replaceKeepingTargets } from '../workouts/exhistory.js';

const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

function sparkSvg(values, label) {
  const W = 300, H = 80;
  const pts = sparkPoints(values, W, H);
  if (!pts.length) return '';
  const line = pts.map((p, n) => `${n ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  return `<svg class="hx-spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    ${pts.length > 1 ? `<path d="${line}" class="hx-line"/>` : ''}
    ${pts.map((p, n) => `<circle cx="${p.x}" cy="${p.y}" r="${n === pts.length - 1 ? 5 : 3.5}" class="hx-dot${n === pts.length - 1 ? ' last' : ''}"/>`).join('')}
  </svg>`;
}

export function openExerciseHistory(ex) {
  const timed = !!ex.timed;
  const u = unit();
  const sessions = historyIndex().historyFor(ex.id);
  const rows = historyRows(sessions, { timed });
  const vals = trendValues(sessions, { timed });
  sheet(`${ex.name} history`, (body) => {
    body.innerHTML = rows.length ? `
      <div class="stack hx">
        <div class="hx-chart">
          <p class="label">${timed ? 'Best hold' : vals.length && sessions.some((s) => s.sets.some((x) => x.weight)) ? `Strength trend (${u})` : 'Best set'}</p>
          ${sparkSvg(vals, `Trend over your last ${vals.length} sessions. ${trendWords(vals)}`)}
          <p class="small muted">${esc(trendWords(vals))}</p>
        </div>
        <ul class="list hx-list">
          ${rows.map((r) => `<li><div class="hx-top"><b>${fmtDate(r.date)}</b>${r.deload ? '<span class="muted small">deload</span>' : ''}<span class="grow"></span><span class="hx-best">Best ${esc(r.best)}</span></div><small class="muted">${r.sets.map(esc).join(' · ')}</small></li>`).join('')}
        </ul>
      </div>` : '<div class="stack hx"><p class="muted">Not done yet. Your sets show up here after your first workout with it.</p></div>';
  });
}

/** Swap exercise `i` of the running workout for a similar one, keeping its sets and rep targets. */
export function openReplace(i, { onDone = () => {} } = {}) {
  const w = live.w;
  const old = w.exercises[i];
  const ex = exerciseById(old.exercise_id) || {};
  if (old.sets.some((s) => s.done)) { toast('Finish or undo the completed sets first, or add the new exercise instead.'); return; }
  const avail = availableHere();
  const avoid = jointAvoidSet(state.profile);
  const inWorkout = new Set(w.exercises.map((x) => x.exercise_id));
  openExercisePicker({
    title: `Replace ${ex.name || 'exercise'}`,
    onlyPattern: ex.pattern,
    patterns: jointPickerPatterns(ex.pattern, avoid),
    primary: ex.primary || [],
    filter: (c) => !inWorkout.has(c.id) && canDo(c, avail) && jointFriendly(c, avoid),
    availableNote: avoid.size ? 'Same movement, doable here, and easy on the joints you protect. Your sets and reps stay.' : 'Same movement, doable at this location. Your sets and reps stay.',
    onPick: (c) => {
      const next = replaceKeepingTargets(old, buildEntry(c, old.role));
      if (!next) return;
      w.exercises[i] = next;
      save();
      haptics.success();
      toast(`Replaced with ${c.name}`, 5000, { action: { label: 'Undo', onClick: () => { w.exercises[i] = old; save(); onDone(); } } });
      onDone();
    },
  });
}
