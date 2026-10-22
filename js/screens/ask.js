// Ask Forge (v0.16.47): the "Can I eat this?" sheet, opened from Today and Food. Type it (or tap the mic on the iOS keyboard), get a short
// verdict (Yes / Have half / Better pick), the numbers, and a one-tap Log it / Log half. With Settings → "Ask Forge AI" off, the
// answer is built from your numbers (only the food name may go to the food lookup) and nothing else is sent. The maths is in js/food/ask-rules.js and ask.js.
import { state } from '../state.js';
import { put, newRecord } from '../db.js';
import { esc, $, $$, sheet, toast, todayKey } from '../ui.js';
import { currentTargets } from '../derived.js';
import { mealForHour, MEAL_LABEL } from '../food/core.js';
import { ASK_FOOTER, cleanItem } from '../food/ask-rules.js';
import { askAiOn, askLogFields, contextFrom, foodFromQuestion, localAnswer, lookupFood, requestAnswer, MAX_QUESTION } from '../food/ask.js';
import { balanceOn } from './balance-ui.js';
import { mealPrefs } from './food-prefs.js';
import { haptics } from '../ui/haptic.js';

const num = (n) => Math.round(n).toLocaleString('en-US');
const EXAMPLES = ['Is it too late for a yogurt?', 'Can I have a slice of pizza?', 'Is a banana okay?'];
const BADGE = { yes: 'Yes', half: 'Half', better: 'Swap' };

/** The "Ask Forge" button for Today and Food. */
export const askButton = (cls = '') => `<button type="button" class="ask-entry ${cls}" data-ask-forge aria-label="Ask Forge: can I eat this?"><span class="ask-entry-ic" aria-hidden="true">?</span><span class="ask-entry-txt"><b>Ask Forge</b><small>Can I eat this? Quick food check</small></span></button>`;

/** Wires every [data-ask-forge] button inside `el`. */
export function bindAsk(el) {
  $$('[data-ask-forge]', el).forEach((b) => { b.onclick = () => { haptics.light(); openAskForge(); }; });
}

function numbersHtml(a, ctx, isToday = true) {
  const n = a.numbers;
  return `<dl class="ask-nums">
    <div><dt>This</dt><dd><b>${num(a.item.kcal)}</b> kcal${a.item.protein_g ? `<small>${num(a.item.protein_g)} g protein</small>` : ''}</dd></div>
    <div><dt>${isToday ? 'Left today' : 'Left that day'}</dt><dd><b>${n.left >= 0 ? num(n.left) : `−${num(-n.left)}`}</b> kcal<small>of ${num(ctx.ceiling)}</small></dd></div>
    <div><dt>After</dt><dd><b class="${n.after < 0 ? 'ask-over' : ''}">${num(Math.abs(n.after))}</b> kcal ${n.after < 0 ? 'over' : 'left'}<small>if you eat it all</small></dd></div>
  </dl>${ctx.burned != null ? `<p class="small muted ask-burn">${num(ctx.burned)} kcal burned so far doesn’t change your ceiling.</p>` : ''}`;
}

export function openAskForge({ day = todayKey() } = {}) {
  sheet('Ask Forge', (body, close) => {
    const ai = askAiOn(state.settings);
    let seq = 0;
    body.innerHTML = `
      <div class="stack ask" data-ask>
        <form class="ask-form" novalidate>
          <label class="field ask-field"><span>Can I eat this?</span>
            <input name="q" type="text" maxlength="${MAX_QUESTION}" enterkeyhint="send" autocomplete="off" autocapitalize="sentences" placeholder="Is it too late for a Noosa vanilla bean yogurt?" aria-describedby="ask-hint"></label>
          <button class="btn bigbtn" type="submit" data-ask-go>Ask</button>
        </form>
        <p class="small muted" id="ask-hint">Tap the mic on your keyboard to say it instead.</p>
        <div class="chips ask-examples" role="group" aria-label="Examples">${EXAMPLES.map((x) => `<button type="button" class="chip-btn" data-example="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <div class="ask-out" data-ask-out role="status" aria-live="polite"></div>
        <p class="small muted ask-foot">${ai ? 'Your question, the food, today’s calories and protein (eaten, goals and calories burned) and your food preferences go to xAI to write the answer; Forge double-checks it against your numbers.' : 'Answered from your numbers. Forge may look up the food’s calories (food name only). Turn on Ask Forge AI in Settings for a friendlier take.'} ${esc(ASK_FOOTER)}</p>
      </div>`;
    const form = $('form', body);
    const input = $('input[name=q]', body);
    const out = $('[data-ask-out]', body);

    const targets = () => currentTargets();
    const context = () => {
      const bal = balanceOn(day);
      return contextFrom({ logs: state.food_logs.filter((l) => !l.deleted), day, targets: targets(), burned: bal ? bal.burned : null, now: new Date() });
    };

    function showAnswer(a, ctx, note = '') {
      out.innerHTML = `
        <section class="ask-card ask-v-${a.verdict}" data-ask-answer data-verdict="${a.verdict}">
          <div class="ask-head"><span class="ask-badge" aria-hidden="true">${BADGE[a.verdict]}</span><h3>${esc(a.headline)}</h3></div>
          <p class="ask-food small muted">${esc(a.item.name)}${a.item.serving ? ` · ${esc(a.item.serving)}` : ''}</p>
          <p class="ask-reason">${esc(a.reason)}</p>
          ${a.better ? `<p class="ask-try"><b>Try instead:</b> ${esc(a.better)}</p>` : ''}
          ${numbersHtml(a, ctx, day === todayKey())}
          <div class="ask-actions">
            <button type="button" class="btn ${a.verdict === 'half' ? '' : 'ghost'}" data-log="0.5">Log half</button>
            <button type="button" class="btn ${a.verdict === 'yes' ? '' : 'ghost'}" data-log="1">Log it</button>
          </div>
          <p class="small muted">Logs to ${esc(MEAL_LABEL[mealForHour(new Date().getHours() + new Date().getMinutes() / 60)])}. ${a.source === 'ai' ? 'Estimates; check the label if you can.' : 'From your numbers.'}${note ? ` ${esc(note)}` : ''}</p>
        </section>`;
      const ex = $('.ask-examples', body);
      if (ex) ex.hidden = true; // so the verdict shows at the medium detent
      $$('[data-log]', out).forEach((b) => {
        b.onclick = () => {
          const portion = Number(b.dataset.log);
          const meal = mealForHour(new Date().getHours() + new Date().getMinutes() / 60);
          const f = askLogFields(a, portion, { meal, day });
          put('food_logs', newRecord(f));
          haptics.success();
          toast(`Added to ${MEAL_LABEL[meal]} · ${num(f.kcal)} kcal`);
          close();
        };
      });
    }

    function askCalories(name) {
      out.innerHTML = `
        <form class="stack ask-cal" novalidate data-ask-cal>
          <p>I couldn’t find “${esc(name)}” to look up. How many calories is it?</p>
          <div class="field-grid">
            <label class="field"><span>Calories</span><input name="kcal" type="number" inputmode="numeric" min="1" max="5000" placeholder="150"></label>
            <label class="field"><span>Protein (g, optional)</span><input name="p" type="number" inputmode="decimal" min="0" max="500"></label>
          </div>
          <p class="error" aria-live="polite"></p>
          <button class="btn" type="submit">Check it</button>
        </form>`;
      const f = $('form', out);
      $('input[name=kcal]', f).focus();
      f.onsubmit = (e) => {
        e.preventDefault();
        const item = cleanItem({ name: name.replace(/^./, (c) => c.toUpperCase()), kcal: f.kcal.value, protein_g: f.p.value });
        if (!item || item.kcal <= 0) { $('.error', f).textContent = 'Enter the calories, like 150.'; return; }
        const ctx = context();
        showAnswer(localAnswer(item, ctx, mealPrefs()), ctx);
      };
    }

    async function ask(question) {
      const q = question.replace(/\s+/g, ' ').trim();
      if (q.length < 2) { out.innerHTML = '<p class="small muted">Type what you’re thinking of eating.</p>'; input.focus(); return; }
      const mine = ++seq;
      const go = $('[data-ask-go]', body);
      go.disabled = true;
      out.innerHTML = '<div class="ask-wait skeleton" aria-hidden="true"></div><p class="small muted">Checking your numbers…</p>';
      const prefs = mealPrefs();
      const ctx = context();
      const name = foodFromQuestion(q);
      const item = await lookupFood(name, { foods: state.foods, logs: state.food_logs, online: navigator.onLine !== false });
      if (mine !== seq) return;
      let answer = null;
      let note = '';
      if (ai) {
        try {
          const { call } = await import('../functions.js');
          answer = await requestAnswer({ question: q, item, ctx, prefs, call });
        } catch (e) { note = e && e.message ? e.message : ''; }
        if (mine !== seq) return;
      }
      go.disabled = false;
      if (!answer && item) answer = localAnswer(item, ctx, prefs);
      if (!answer) { askCalories(name); return; }
      haptics.select();
      showAnswer(answer, ctx, note);
    }

    form.onsubmit = (e) => { e.preventDefault(); ask(input.value); };
    $$('[data-example]', body).forEach((b) => { b.onclick = () => { input.value = b.dataset.example; ask(input.value); }; });
  }, { detents: ['medium', 'large'] });
}
