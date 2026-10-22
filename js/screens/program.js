// #/program: the running body program. A ring for the whole program, a row per week (past weeks ✓ or partly, the
// current week live), this week's goals with progress, the weight-pace bar, and a quiet "End program".
import { esc, sheet, confirmSheet, toast, todayKey } from '../ui.js';
import { haptics } from '../ui/haptic.js';
import { icon, emptyState } from '../ui/icons.js';
import { checkStart, weekBounds } from '../body-programs/core.js';
import { activeProgram, currentStatus, endProgram, changeStartDate } from '../body-programs/store.js';

const CIRC = 2 * Math.PI * 44;
const fmtDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });

function ringHtml(st) {
  const off = (CIRC * (1 - st.progress)).toFixed(1);
  return `<div class="pg-ring" role="img" aria-label="${Math.round(st.progress * 100)} percent through ${esc(st.def.name)}">
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" class="pg-ring-bg"/><circle cx="50" cy="50" r="44" class="pg-ring-fg" stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${off}" transform="rotate(-90 50 50)"/></svg>
    <div class="pg-ring-text"><b>Week ${st.weekNo}</b><small class="muted">of ${st.def.weeks}</small></div>
  </div>`;
}

function weekRow(w) {
  const total = w.goals.length;
  const done = w.goals.filter((g) => g.done).length;
  let mark;
  let sub;
  if (w.state === 'past') {
    mark = w.hit ? icon('check', { filled: true }) : `<i class="pg-half" aria-hidden="true"></i>`;
    sub = w.hit ? 'Every goal hit' : `${done} of ${total} goals`;
  } else if (w.state === 'current') {
    mark = '<i class="pg-now" aria-hidden="true"></i>';
    sub = `${done} of ${total} goals so far`;
  } else {
    mark = '<i class="ms-ring" aria-hidden="true"></i>';
    sub = 'Coming up';
  }
  return `<li class="ms-row pg-week ${w.state} ${w.hit ? 'done' : ''}" aria-label="Week ${w.n}: ${esc(sub)}">
    <span class="ms-check" aria-hidden="true">${mark}</span>
    <span class="ms-text"><span>Week ${w.n}</span><small class="muted">${fmtDay(w.start)} – ${fmtDay(w.end)}</small></span>
    <small class="${w.state === 'current' ? 'pg-sub-now' : 'muted'}">${esc(sub)}</small>
  </li>`;
}

/** A simple bar: the shaded zone is the safe pace (or "steady"), the dot is where you are. */
function barHtml(bar) {
  if (!bar) return '';
  const steady = bar.mode === 'steady';
  const min = steady ? bar.lo * 3 : 0;
  const max = steady ? bar.hi * 3 : bar.hi * 1.6;
  const pos = (v) => `${Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100)).toFixed(1)}%`;
  const dot = bar.value == null ? '' : `<i class="pg-dot" style="left:${pos(bar.value)}"></i>`;
  return `<div class="pg-bar" aria-hidden="true"><i class="pg-zone" style="left:${pos(bar.lo)};width:calc(${pos(bar.hi)} - ${pos(bar.lo)})"></i>${dot}</div>`;
}

function goalRow(g) {
  return `<li class="ms-row ${g.done ? 'done' : ''}" data-goal="${g.id}" aria-label="${esc(g.label)}: ${g.done ? 'done' : 'not yet'}">
    <span class="ms-check" aria-hidden="true">${g.done ? icon('check', { filled: true }) : '<i class="ms-ring"></i>'}</span>
    <span class="ms-text"><span>${esc(g.label)}</span><small class="muted">${esc(g.text)}</small>${barHtml(g.bar)}</span>
  </li>`;
}

export function renderProgram(el) {
  const st = activeProgram() ? currentStatus() : null;
  if (!st || st.finished) {
    el.innerHTML = `<section class="stack"><h1>Program</h1><div class="card">${emptyState({ icon: 'trophy', title: 'No program running', text: 'Pick a cut, recomp or maintenance program on the Body tab.', action: { href: '#/body', label: 'See programs' } })}</div></section>`;
    return;
  }
  const cur = st.weeks.find((w) => w.state === 'current') || st.weeks[0];
  el.innerHTML = `<section class="stack">
    <h1>${esc(st.def.name)}</h1>
    <div class="card pg-head">${ringHtml(st)}
      <div class="pg-head-text"><p><b>${st.weeksHit}</b> of ${st.def.weeks} weeks fully hit</p><p class="small muted">Started ${fmtDay(st.started)} · ends ${fmtDay(st.last)}</p></div>
    </div>
    <div class="card">
      <div class="row between center"><p class="label">This week</p><span class="small muted">${st.goalsDone} of ${st.goalsTotal} goals</span></div>
      <ul class="ms-list">${cur.goals.map(goalRow).join('')}</ul>
      <p class="small muted">Week ${cur.n} runs ${fmtDay(cur.start)} – ${fmtDay(cur.end)}. Each week starts on the day you began.</p>
    </div>
    <div class="card">
      <p class="label">Weeks</p>
      <ul class="ms-list">${st.weeks.map(weekRow).join('')}</ul>
      <p class="small muted">Hit every goal in a week for +50 XP. Finish the program for +250 XP and a badge.</p>
    </div>
    <div class="pg-actions">
      <button type="button" class="link pg-end" data-program-start aria-label="Change start date. Now ${esc(fmtDay(st.started))}">Change start date</button>
      <button type="button" class="link pg-end" data-program-end>End program</button>
    </div>
  </section>`;
  el.querySelector('[data-program-start]').onclick = () => openStartSheet(st, el);
  el.querySelector('[data-program-end]').onclick = async () => {
    const ok = await confirmSheet({
      title: 'End this program?',
      message: 'You keep the XP from weeks you already hit, but you won’t get the finish bonus or the badge. You can start another one any time.',
      confirmLabel: 'End program', danger: true,
    });
    if (!ok) return;
    if (endProgram()) {
      toast('Program ended');
      location.hash = '#/body';
    }
  };
}

/** The sheet for moving the start date: a date up to today, the new week 1 range, then Apply (with Undo afterwards). */
function openStartSheet(st, el) {
  const today = todayKey();
  sheet('Change start date', (body, closeSheet) => {
    body.innerHTML = `<div class="stack" data-start-sheet>
      <p class="muted">Pick the day week 1 began. Weeks and goals are worked out again from what you’ve already logged. Nothing is deleted.</p>
      <label class="field"><span>Start date</span><input type="date" name="start" value="${esc(st.started)}" max="${today}" aria-label="Program start date, today or earlier" data-start-input></label>
      <p class="pg-preview" aria-live="polite" data-start-preview></p>
      <div class="row gap">
        <button type="button" class="btn ghost grow" data-no>Cancel</button>
        <button type="button" class="btn grow" data-yes>Change date</button>
      </div>
    </div>`;
    const input = body.querySelector('[data-start-input]');
    const preview = body.querySelector('[data-start-preview]');
    const yes = body.querySelector('[data-yes]');
    const sync = () => {
      const c = checkStart(input.value, today);
      yes.disabled = !c.ok;
      if (!c.ok) { preview.textContent = c.reason; return; }
      const w = weekBounds(input.value, 0);
      preview.textContent = `Week 1 will run ${fmtDay(w.start)} – ${fmtDay(w.end)}.`;
    };
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    sync();
    body.querySelector('[data-no]').onclick = () => closeSheet();
    yes.onclick = () => {
      const r = changeStartDate(input.value);
      if (!r.ok) { preview.textContent = r.reason; return; }
      haptics.light();
      closeSheet();
      renderProgram(el);
      toast(`Week 1 now starts ${fmtDay(input.value)}`, 6000, {
        action: { label: 'Undo', onClick: () => { if (changeStartDate(r.previous).ok) { haptics.light(); renderProgram(el); } } },
      });
    };
  });
}
