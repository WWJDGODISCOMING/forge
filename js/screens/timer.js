// Interval timer: boxing rounds (with combo callouts), HIIT, EMOM, Tabata, custom.
// Runs from timestamps, keeps the screen awake, beeps at 3-2-1 and on every switch.
import { esc, $, $$ } from '../ui.js';
import { unlockAudio, beep, buzz, fmtClock, setWantAwake } from '../timer.js';
import { openCardioLog } from './tools.js';

export const PRESETS = {
  boxing: { name: 'Boxing rounds', short: 'Boxing', work: 180, rest: 60, rounds: 6, prep: 10, combos: true },
  hiit: { name: 'HIIT 40/20', short: 'HIIT', work: 40, rest: 20, rounds: 10, prep: 10 },
  emom: { name: 'EMOM 10', short: 'EMOM', work: 60, rest: 0, rounds: 10, prep: 10 },
  tabata: { name: 'Tabata', short: 'Tabata', work: 20, rest: 10, rounds: 8, prep: 10 },
  custom: { name: 'Custom', short: 'Custom', work: 45, rest: 15, rounds: 8, prep: 10 },
};

// Punch numbers: 1 jab, 2 cross, 3 lead hook, 4 rear hook, 5 lead uppercut, 6 rear uppercut.
export const COMBOS = [
  '1-2', '1-1-2', '1-2-3', '1-2-3-2', '2-3-2', '1-6-3-2', '1-2, slip, 2', 'Jab, roll, 3-2', '3-4', '1-2-5-2',
  'Double jab, cross', 'Slip-slip, 2-3', 'Body 3, head 3', '1-2, pivot out', 'Roll left, 3-2', '1-2-3, roll, 3-2',
  'Fast 1-2s for 10s', 'Defense: slip, slip, roll', 'Feint jab, 2', 'Step in 1-2, step out',
];

let cfg = { ...PRESETS.boxing, key: 'boxing', speak: false };
let run = null; // { phases: [{type, dur, round}], idx, phaseEnd, paused, pausedLeft, startedAt }
let tickId = null;
let lastCombo = 0;

function buildPhases(c) {
  const p = [];
  if (c.prep) p.push({ type: 'prep', dur: c.prep, round: 1 });
  for (let r = 1; r <= c.rounds; r++) {
    p.push({ type: 'work', dur: c.work, round: r });
    if (c.rest && r < c.rounds) p.push({ type: 'rest', dur: c.rest, round: r });
  }
  return p;
}

const totalSeconds = (c) => (c.prep || 0) + c.rounds * c.work + Math.max(0, c.rounds - 1) * (c.rest || 0);

function say(text) {
  if (!cfg.speak || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text.replace(/-/g, ' '));
  u.rate = 1.15;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/** True while an interval run is in memory (any route): an app update must not reload it away. */
export const isTimerRunning = () => !!run;

export function stopIntervalTimer() {
  clearInterval(tickId);
  run = null;
  setWantAwake(false);
}

export function renderTimer(el) {
  el.innerHTML = `
    <section class="stack timer-screen">
      <h1>Interval timer</h1>
      <div class="seg small" role="radiogroup" aria-label="Preset">
        ${Object.entries(PRESETS).map(([k, p]) => `<label><input type="radio" name="preset" value="${k}" aria-label="${esc(p.name)}" ${cfg.key === k ? 'checked' : ''} ${run ? 'disabled' : ''}><span>${esc(p.short)}</span></label>`).join('')}
      </div>
      <div class="row gap">
        <label class="field grow"><span>Work (sec)</span><input data-k="work" type="number" inputmode="numeric" min="5" value="${cfg.work}" ${run ? 'disabled' : ''}></label>
        <label class="field grow"><span>Rest (sec)</span><input data-k="rest" type="number" inputmode="numeric" min="0" value="${cfg.rest}" ${run ? 'disabled' : ''}></label>
        <label class="field grow"><span>Rounds</span><input data-k="rounds" type="number" inputmode="numeric" min="1" max="50" value="${cfg.rounds}" ${run ? 'disabled' : ''}></label>
      </div>
      ${cfg.key === 'boxing' ? `
        <label class="choice check small"><input type="checkbox" data-speak ${cfg.speak ? 'checked' : ''}>
          <span>Call combos out loud<small>Numbers: 1 jab · 2 cross · 3 lead hook · 4 rear hook · 5/6 uppercuts</small></span></label>` : ''}
      <div class="bigtimer" data-face aria-live="polite">
        <p class="phase" data-phase>Ready</p>
        <b data-left>${fmtClock(cfg.work)}</b>
        <p class="muted" data-round>${cfg.rounds} rounds · ${Math.round(totalSeconds(cfg) / 60)} min total</p>
        <p class="combo" data-combo></p>
      </div>
      <div class="row gap">
        <button class="btn grow" data-go>${run ? (run.paused ? 'Resume' : 'Pause') : 'Start'}</button>
        <button class="btn ghost grow" data-reset ${run ? '' : 'disabled'}>Reset</button>
      </div>
      <p class="small muted">Keep the app open: the screen stays awake. iPhone pauses web timers when you switch apps or lock the phone.</p>
    </section>`;

  $$('input[name=preset]', el).forEach((r) => r.addEventListener('change', () => {
    cfg = { ...PRESETS[r.value], key: r.value, speak: cfg.speak };
    renderTimer(el);
  }));
  $$('input[data-k]', el).forEach((inp) => inp.addEventListener('change', () => {
    const v = Math.max(inp.dataset.k === 'rest' ? 0 : 1, Math.round(Number(inp.value) || 0));
    cfg[inp.dataset.k] = v;
    renderTimer(el);
  }));
  const sp = $('[data-speak]', el);
  if (sp) sp.addEventListener('change', () => (cfg.speak = sp.checked));
  $('[data-go]', el).onclick = () => {
    unlockAudio();
    if (!run) start(el);
    else if (run.paused) resume(el);
    else pause(el);
  };
  $('[data-reset]', el).onclick = () => {
    stopIntervalTimer();
    renderTimer(el);
  };
  if (run) paint(el);
}

function start(el) {
  run = { phases: buildPhases(cfg), idx: 0, phaseEnd: 0, paused: false, startedAt: Date.now() };
  run.phaseEnd = Date.now() + run.phases[0].dur * 1000;
  setWantAwake(true);
  announce();
  loop(el);
  renderTimer(el);
}

function pause(el) {
  run.paused = true;
  run.pausedLeft = run.phaseEnd - Date.now();
  clearInterval(tickId);
  renderTimer(el);
}

function resume(el) {
  run.paused = false;
  run.phaseEnd = Date.now() + run.pausedLeft;
  loop(el);
  renderTimer(el);
}

function announce() {
  const ph = run.phases[run.idx];
  if (ph.type === 'work') {
    beep({ freq: 990, ms: 350 });
    buzz([300]);
    say(cfg.key === 'boxing' ? `Round ${ph.round}` : 'Go');
  } else if (ph.type === 'rest') {
    beep({ freq: 520, ms: 450 });
    buzz([150, 80, 150]);
    say('Rest');
  }
  lastCombo = Date.now();
}

function loop(el) {
  clearInterval(tickId);
  let lastSec = null;
  tickId = setInterval(() => {
    if (!run || run.paused) return;
    const left = (run.phaseEnd - Date.now()) / 1000;
    const sec = Math.ceil(left);
    if (sec !== lastSec && sec <= 3 && sec >= 1) beep({ freq: 660, ms: 90 });
    lastSec = sec;
    const ph = run.phases[run.idx];
    if (ph.type === 'work' && cfg.combos && Date.now() - lastCombo > 7000 && left > 3) {
      lastCombo = Date.now();
      const c = COMBOS[Math.floor(Math.random() * COMBOS.length)];
      const box = document.querySelector('[data-combo]');
      if (box) box.textContent = c;
      say(c);
    }
    if (left <= 0) {
      run.idx++;
      if (run.idx >= run.phases.length) return done(el);
      run.phaseEnd += run.phases[run.idx].dur * 1000;
      announce();
    }
    paint(el);
  }, 200);
}

function paint(el) {
  const face = document.querySelector('[data-face]');
  if (!face || !run) return;
  const ph = run.phases[run.idx];
  const left = run.paused ? run.pausedLeft / 1000 : (run.phaseEnd - Date.now()) / 1000;
  face.className = `bigtimer ${ph.type}`;
  face.querySelector('[data-phase]').textContent = { prep: 'Get ready', work: cfg.key === 'boxing' ? 'Fight' : 'Work', rest: 'Rest' }[ph.type];
  face.querySelector('[data-left]').textContent = fmtClock(left);
  face.querySelector('[data-round]').textContent = `Round ${ph.round} of ${cfg.rounds}`;
  if (ph.type !== 'work') face.querySelector('[data-combo]').textContent = '';
}

function done(el) {
  const minutes = Math.max(1, Math.round((Date.now() - run.startedAt) / 60000));
  clearInterval(tickId);
  beep({ freq: 990, ms: 600 });
  buzz([400, 100, 400]);
  say('Done. Great work.');
  run = null;
  setWantAwake(false);
  renderTimer(el);
  const face = document.querySelector('[data-face]');
  if (face) {
    face.querySelector('[data-phase]').textContent = 'Done';
    face.querySelector('[data-left]').textContent = `${minutes} min`;
  }
  const btn = document.createElement('button');
  btn.className = 'btn ghost';
  btn.textContent = 'Log this as cardio';
  btn.onclick = () => openCardioLog({ activity: cfg.key === 'boxing' ? 'boxing' : 'hiit', duration_min: minutes, notes: `${cfg.name}: ${cfg.rounds} × ${cfg.work}s` });
  el.querySelector('.timer-screen').appendChild(btn);
}
