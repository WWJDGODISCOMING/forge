// Coach (no-AI mode): tap a suggested question, get a rule-based answer from your own data. Docs: docs/coach.md.
// No network, nothing stored: the conversation lives in this module until the app is closed.
import { esc, $, $$, toast, confirmSheet, todayKey } from '../ui.js';
import { haptics } from '../ui/haptic.js';
import { icon } from '../ui/icons.js';
import { availableQuestions, needsStarter, MEDICAL, DISCLAIMER } from '../coach/answers.js';
import { runAction } from '../coach/actions.js';
import { coachData } from '../coach/data.js';
import { startDeload } from '../workouts/plan.js';
import { overrideReadiness } from '../health/today.js';
import { previewPlan, startPlan } from './train.js';
import { openLogWeight } from './weight.js';

const convo = []; // [{ label, answer, decision: null | 'done' | 'no' }], this session only

const deps = { previewPlan, startPlan, startDeload, overrideReadiness, confirm: confirmSheet };
const DONE_TEXT = { started: 'Started.', lighter: 'Readiness is back on. Today’s workout is lighter.', deload: 'Deload week started.', none: 'Nothing to do right now.' };

function actionCard(entry, i) {
  const a = entry.answer.action;
  if (!a) return '';
  if (entry.decision === 'done') return `<p class="small muted coach-done">${esc(entry.result || 'Done.')}</p>`;
  if (entry.decision === 'no') return '<p class="small muted coach-done">Okay, nothing changed.</p>';
  return `<div class="coach-action" role="group" aria-label="Coach suggestion">
    <p><span class="label">Coach suggests</span><br><b>${esc(a.label)}</b></p>
    <div class="row gap"><button class="btn grow" data-do="${i}" data-own-haptic>Do it</button><button class="btn ghost grow" data-no="${i}">Not now</button></div>
  </div>`;
}

function turn(entry, i) {
  const a = entry.answer;
  return `
    <div class="coach-q"><span class="bubble user">${esc(entry.label)}</span></div>
    <article class="card stack coach-a" data-answer="${esc(a.id)}">
      <p class="big-title coach-head">${esc(a.headline)}</p>
      <ul class="coach-lines">${a.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <p class="small muted"><b>Why:</b> ${esc(a.why)}</p>
      ${a.note ? `<p class="small muted">${esc(a.note)}</p>` : ''}
      ${actionCard(entry, i)}
    </article>`;
}

export function renderCoach(el) {
  const data = coachData();
  const qs = availableQuestions(data, todayKey());
  // No weigh-ins and no workouts yet: show the starter card, with any chips that exist (e.g. Train) below it.
  const empty = needsStarter(data) && !convo.length;

  el.innerHTML = `
    <section class="stack coach">
      <h1>Coach</h1>
      ${empty ? `
        <div class="card stack" data-empty>
          <p class="big-title">Coach needs a few weigh-ins or a workout first</p>
          <p class="muted">Once there is something to look at, you can ask Coach how your week is going, whether you are on track, and what to train.</p>
          <div class="row gap"><button class="btn grow" data-log>${icon('scale')}Log weight</button><a class="btn ghost grow" href="#/train">Train</a></div>
        </div>` : `
        <p class="muted">Ask me about your numbers. Every answer comes from your own data, and I show you how I got it.</p>`}
      ${empty && !qs.length ? '' : `
        <div class="coach-thread" data-thread>${convo.map(turn).join('')}</div>
        <div class="coach-chips" role="list" aria-label="Questions you can ask">
          ${qs.map((q) => `<button class="coach-chip" role="listitem" data-ask="${esc(q.id)}"><span>${esc(q.label)}</span><span class="chev" aria-hidden="true">${icon('chev')}</span></button>`).join('')}
        </div>
        <p class="small muted">Typing questions comes with AI coach, coming later.</p>`}
      <p class="disclaimer">${DISCLAIMER} ${convo.some((e) => e.answer.note) ? esc(MEDICAL) : ''}</p>
    </section>`;

  const log = $('[data-log]', el);
  if (log) log.onclick = openLogWeight;

  $$('[data-ask]', el).forEach((b) => {
    b.onclick = () => {
      const q = qs.find((x) => x.id === b.dataset.ask);
      if (!q) return;
      convo.push({ label: q.label, answer: q.answer, decision: null });
      renderCoach(el);
      const cards = $$('[data-answer]', el);
      const last = cards[cards.length - 1];
      if (last) last.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
  });
  $$('[data-no]', el).forEach((b) => { b.onclick = () => { convo[Number(b.dataset.no)].decision = 'no'; renderCoach(el); }; });
  $$('[data-do]', el).forEach((b) => {
    b.onclick = async () => {
      const entry = convo[Number(b.dataset.do)];
      b.disabled = true;
      const res = await runAction(entry.answer.action.id, deps);
      if (res === 'cancelled') { b.disabled = false; return; } // backed out of the confirm sheet: the card stays
      haptics.success();
      entry.decision = 'done';
      entry.result = DONE_TEXT[res];
      if (res !== 'started' && res !== 'none') toast(DONE_TEXT[res]);
      if (document.body.contains(el)) renderCoach(el);
    };
  });
}
