// Progress → Awards: your level and XP, the weekly streak (with this week's days and the monthly freeze),
// and badges. Derived from history (js/workouts/awards.js); earned badges are also kept in
// settings/main.awards_seen so they never disappear.
import { state, units as getUnits } from '../state.js';
import { esc } from '../ui.js';
import { streak, LEVELS, xpForLevel, XP_RULES } from '../workouts/awards.js';
import { myAwards, syncBadges, goalDays } from '../workouts/awards-store.js';
import { badgeSVG, BADGE_ART, TIER_NAMES } from '../ui/badges.js';
import { backInfo, howText, wireFlips } from '../ui/badge-flip.js';
import { icon, emptyState } from '../ui/icons.js';
import { missionWeekHtml } from '../missions/ui.js';
import { programsAwardsHtml } from '../body-programs/ui.js';

const RECENT = 3 * 86400000; // badges earned in the last 3 days shine when you open Awards

const fmt = (n) => Math.round(n).toLocaleString();
const when = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

export function renderAwards(el) {
  const goal = goalDays();
  const aw = myAwards();
  const xp = aw.total;
  const lv = aw.level;
  const st = streak(state.workouts, state.cardio || [], goal);
  // Earned first (newest first), then locked by tier.
  const bs = [...aw.badges].sort((a, b) => (!!b.earned - !!a.earned)
    || (a.earned ? (b.earned.at > a.earned.at ? 1 : -1) : BADGE_ART[a.id].tier - BADGE_ART[b.id].tier));
  syncBadges(); // anything earned outside a summary (e.g. a cardio day finishing a streak) is kept from now on
  const got = bs.filter((b) => b.earned);
  const units = getUnits();
  const dots = Array.from({ length: goal }, (_, i) => `<i class="${i < st.thisWeek.done ? 'on' : ''}"></i>`).join('');

  el.innerHTML = `
    <section class="stack">
      <h1>Awards</h1>

      <div class="card aw-level">
        <p class="label">Level ${lv.level} of ${LEVELS.length}</p>
        <p class="aw-name">${esc(lv.name)}</p>
        <div class="aw-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(lv.progress * 100)}" aria-label="Progress to next level"><i style="--p:${lv.progress.toFixed(3)}"></i></div>
        <p class="small muted">${lv.next != null ? `${fmt(xp)} XP · ${fmt(lv.next - xp)} to <b>${esc(lv.nextName)}</b>` : `${fmt(xp)} XP · top level reached`}</p>
        <details class="small"><summary class="muted">How XP works</summary>
          <p class="muted">${esc(XP_RULES)}</p>
          <ol class="aw-levels">${LEVELS.map((n, i) => `<li class="${i + 1 <= lv.level ? 'on' : ''}"><span>${esc(n)}</span><small>${fmt(xpForLevel(i + 1))}</small></li>`).join('')}</ol>
        </details>
      </div>

      ${missionWeekHtml()}

      ${programsAwardsHtml()}

      <div class="card aw-streak">
        <div class="row between center">
          <div><p class="label">Weekly streak</p><p class="aw-big">${icon('flame', { filled: true })} ${st.current} ${st.current === 1 ? 'week' : 'weeks'}</p></div>
          <div class="aw-best"><small class="muted">Best</small><b>${st.best}</b></div>
        </div>
        <div class="aw-week"><span class="small muted">This week</span><span class="aw-dots" aria-label="${st.thisWeek.done} of ${goal} days">${dots}</span><span class="small">${st.thisWeek.done} of ${goal} days</span></div>
        <p class="small muted">A week counts when you train on your planned ${goal} days (workouts or logged cardio). One missed week a month is covered by a freeze${st.freezeLeft ? ' — this month’s is still available.' : ' — this month’s is used.'}</p>
      </div>

      <div class="card">
        <div class="row between center"><p class="label">Badges</p><span class="small muted">${got.length} of ${bs.length}</span></div>
        ${got.length ? '' : emptyState({ icon: 'medal', title: 'No badges yet', text: 'Finish a workout and your first badge unlocks.', action: { href: '#/train', label: 'Start a workout' } })}
        <p class="small muted">Tap a badge, or drag across it, to turn it over.</p>
        <ul class="aw-badges">
          ${bs.map((b, i) => {
            const tier = TIER_NAMES[BADGE_ART[b.id].tier];
            const back = backInfo(b, { tierName: tier, units });
            return `
            <li class="${b.earned ? 'on' : ''}" style="--i:${Math.min(i, 12)}">
              <button type="button" class="aw-flip" aria-pressed="false" aria-label="${esc(b.name)}${b.earned ? '' : ', locked'}. Turns over to show its story.">
                <span class="aw-card">
                  <span class="aw-face aw-front" aria-hidden="false">
                    ${badgeSVG(b.id, { earned: !!b.earned, shine: !!b.earned && Date.now() - Date.parse(b.earned.at) < RECENT, size: 76, units })}
                    <span class="aw-tier">${tier}</span>
                    <b>${esc(b.name)}</b>
                    <small class="muted">${b.earned ? `Earned ${when(b.earned.at)}` : esc(howText(b, units))}</small>
                  </span>
                  <span class="aw-face aw-back" aria-hidden="true" data-sr="${esc(back.sr)}">
                    <span class="aw-tier">${tier}</span>
                    <b>${esc(back.title)}</b>
                    ${back.lines.map((t) => `<small>${esc(t)}</small>`).join('')}
                    ${back.bar ? `<span class="aw-pbar" role="progressbar" aria-valuemin="0" aria-valuemax="${back.bar.goal}" aria-valuenow="${back.bar.cur}" aria-label="${esc(back.bar.text)}"><i style="--p:${(back.bar.cur / back.bar.goal).toFixed(3)}"></i></span><small class="aw-ptext">${esc(back.bar.text)}</small>` : ''}
                  </span>
                </span>
              </button>
            </li>`;
          }).join('')}
        </ul>
        <p class="sr-only" role="status" aria-live="polite" id="aw-say"></p>
      </div>
    </section>`;
  wireFlips(el, (t) => { const s = el.querySelector('#aw-say'); if (s) s.textContent = t; });
}
