// "Today's missions" card for the Today screen, and the week dots for Awards.
import { esc } from '../ui.js';
import { icon } from '../ui/icons.js';
import { badgeSVG } from '../ui/badges.js';
import { units as getUnits } from '../state.js';
import { rememberBadges } from '../workouts/awards-store.js';
import { celebrateMissions } from './celebrate.js';
import { todayMissions, seenToday, weekProgress, unseenMissionBadges, MISSION_XP } from './store.js';

const fmt = (n) => Math.round(n).toLocaleString();

function progressText(p) {
  return p ? `${fmt(p.value)} / ${fmt(p.target)} ${p.unit}` : '';
}

/** The card under the workout card. All done: one line. Nothing to show before missions have started. */
export function missionsCard() {
  const m = todayMissions();
  if (!m.started || !m.list.length) return '';
  if (m.all) {
    return `<a class="card ms-done" href="#/awards" data-missions>${icon('check', { filled: true })}<span>All missions done, +${m.xp} XP</span><span class="chev" aria-hidden="true">${icon('chev')}</span></a>`;
  }
  const seen = seenToday();
  const rows = m.list.map((x) => {
    const sub = x.waiting ? 'Updates when Apple Health syncs' : progressText(x.progress);
    const pop = x.done && !seen.has(x.id);
    return `<li class="ms-row ${x.done ? 'done' : ''}" data-mission="${x.id}" aria-label="${esc(x.label)}: ${x.done ? 'done' : 'not done yet'}">
      <span class="ms-check ${pop ? 'ms-pop' : ''}" aria-hidden="true">${x.done ? icon('check', { filled: true }) : '<i class="ms-ring"></i>'}</span>
      <span class="ms-text"><span>${esc(x.label)}</span>${sub ? `<small class="muted">${esc(sub)}</small>` : ''}</span>
      <small class="ms-xp ${x.done ? '' : 'muted'}">+${MISSION_XP} XP</small>
    </li>`;
  }).join('');
  return `<div class="card ms-card" data-missions>
    <div class="row between center"><p class="label">Today’s missions</p><span class="small muted">${m.done} of ${m.total}</span></div>
    <div class="ms-bar" aria-hidden="true"><i style="--f:${m.total ? m.done / m.total : 0}"></i><b class="ms-bar-flash"></b></div>
    <ul class="ms-list">${rows}</ul>
    <p class="small muted ms-foot">Finish ${m.total === 2 ? 'both' : `all ${m.total}`} for a <span class="nw">+${m.bonus} XP bonus.</span></p>
  </div>`;
}

/** After Today renders: celebrate what is new. */
export function afterMissionsRender() {
  celebrateMissions(); // marks missions seen itself, once the card has really been shown
}

const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Awards: the last seven days, a dot per day (filled = all missions, half = some). */
export function missionWeekHtml() {
  const days = weekProgress();
  const dots = days.map((d) => {
    const dow = new Date(`${d.day}T12:00:00`).getDay();
    const state = !d.counted ? 'off' : d.all ? 'all' : d.done ? 'some' : 'none';
    const label = !d.counted ? 'not counted yet' : `${d.done} of ${d.total} missions`;
    return `<li class="ms-dot ${state}" aria-label="${DAY_LETTER[dow]}: ${label}"><i></i><small>${DAY_LETTER[dow]}</small></li>`;
  }).join('');
  const full = days.filter((d) => d.all).length;
  return `<div class="card ms-week">
    <div class="row between center"><p class="label">Daily missions</p><span class="small muted">${full} of the last 7 days complete</span></div>
    <ol class="ms-dots">${dots}</ol>
    <p class="small muted">Bright = all missions done</p>
    <p class="small muted">+${MISSION_XP} XP for each mission and a bonus for finishing the day’s set.</p>
  </div>`;
}

// ---------- new mission badges ----------
// Saving a badge to awards_seen re-renders Today, so the card keeps what it showed for the rest of this visit
// (until dismissed) and the shine plays only the first time.
const XP_BADGE = 100;
const shown = new Map(); // badge id → badge, celebrated this session and not dismissed yet
const shone = new Set();

/** A small card per newly earned weigh-in streak or body-comp badge: art, name, +100 XP and a link to Awards. */
export function badgeCelebrationCards() {
  for (const b of unseenMissionBadges()) shown.set(b.id, b);
  const units = getUnits();
  return [...shown.values()].map((b) => {
    const first = !shone.has(b.id);
    shone.add(b.id);
    return `<div class="card ms-badge" data-new-badge="${esc(b.id)}" role="status">
      <span class="ms-badge-art">${badgeSVG(b.id, { shine: first, size: 56, label: b.name, units })}</span>
      <span class="ms-badge-text"><small class="label">New badge</small><b>${esc(b.name)}</b><small class="ms-xp">+${XP_BADGE} XP</small></span>
      <span class="ms-badge-links"><a class="link" href="#/awards" data-badge-awards>See awards</a><button type="button" class="ms-badge-x" data-badge-dismiss aria-label="Dismiss">${icon('close', { size: 18 })}</button></span>
    </div>`;
  }).join('');
}

/**
 * Wire the buttons. A badge is remembered (awards_seen) only once its card has been on screen for a moment (so the
 * shine isn't cut off by the re-render), or when it's dismissed or "See awards" is tapped. Never before it was seen.
 */
export function afterBadgeCelebrations(el) {
  const remember = (id) => {
    const fresh = unseenMissionBadges().filter((b) => b.id === id);
    if (fresh.length) rememberBadges(fresh);
  };
  for (const card of el.querySelectorAll('[data-new-badge]')) {
    const id = card.dataset.newBadge;
    card.querySelector('[data-badge-dismiss]').onclick = () => {
      shown.delete(id);
      card.remove();
      remember(id);
    };
    card.querySelector('[data-badge-awards]').onclick = () => { shown.delete(id); remember(id); };
    let timer = 0;
    const onScreen = () => { if (!timer) timer = setTimeout(() => card.isConnected && remember(id), 1500); };
    if (typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { io.disconnect(); onScreen(); }
      }, { threshold: 0.6 });
      io.observe(card);
    } else onScreen();
  }
}
