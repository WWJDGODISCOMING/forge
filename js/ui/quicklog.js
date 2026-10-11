// The floating quick-log + (bottom-right, above the tab bar, tab roots only) and its sheet. Rules live in js/quicklog.js.
import { quickLogVisible, quickLogRows } from '../quicklog.js';
import { icon } from './icons.js';
import { openSheetCount, onSheetsChange } from './sheets.js';
import { lightTap } from './haptic.js';
import { sheet, esc, $$ } from '../ui.js';
import { state } from '../state.js';

const TEXT_INPUT = /^(checkbox|radio|button|submit|reset|range|file|color|hidden|image)$/;
const isTyping = (el) => !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !TEXT_INPUT.test(el.type)));

let fab = null;
let inputs = { parts: [], navHidden: true, busy: false };
let opening = false;

const hasActiveWorkout = () => (state.workouts || []).some((w) => w.status === 'active' && !w.deleted);

function keyboardOpen() {
  if (isTyping(document.activeElement)) return true;
  const vv = window.visualViewport;
  return !!vv && window.innerHeight - vv.height > 150; // a soft keyboard that doesn't resize the page
}

function refresh() {
  if (!fab) return;
  const show = quickLogVisible({
    ...inputs,
    keyboard: keyboardOpen(),
    sheets: openSheetCount(),
    dialogs: document.querySelectorAll('dialog[open], [role=dialog][aria-modal=true]').length,
    overlay: !!document.querySelector('.ov, .tour') || document.body.classList.contains('tour-on'),
  });
  fab.classList.toggle('on', show);
  fab.tabIndex = show ? 0 : -1;
  fab.setAttribute('aria-hidden', show ? 'false' : 'true');
  // Room for the last card to scroll clear of the +: depends only on the screen, so opening a sheet or the keyboard doesn't reflow.
  document.body.classList.toggle('ql-room', quickLogVisible({ parts: inputs.parts, navHidden: inputs.navHidden }));
}

/** Tell the + where the app is: call on every route change (busy = true while a screen is changing) and after each render. */
export function syncQuickLog(next) {
  inputs = { ...inputs, ...next };
  refresh();
}

const RUN = {
  logFood: () => import('../screens/food.js').then((m) => m.openLogFood()),
  logWeight: () => import('../screens/weight.js').then((m) => m.openLogWeight()),
  logCardio: () => import('../screens/tools.js').then((m) => m.openCardioLog()),
  startWorkout: () => import('../screens/train.js').then((m) => {
    const plan = m.previewPlan();
    if (plan && plan.exercises.length) m.startPlan(plan);
    else location.hash = '#/train'; // nothing planned here: Train shows why and lets you pick
  }),
};

export function openQuickLog() {
  if (opening) return;
  opening = true;
  lightTap();
  import('../screens/train.js').then((train) => {
    const rows = quickLogRows({ active: hasActiveWorkout(), playerRoute: train.playerRoute() });
    sheet('Quick log', (body, close) => {
      const dlg = body.closest('dialog');
      if (dlg) dlg.classList.add('ql-sheet');
      body.innerHTML = `<ul class="ql-list">${rows.map((r) => `
        <li><button type="button" class="ql-row" data-row="${r.id}">${icon(r.icon, { size: 22 })}<span>${esc(r.label)}</span></button></li>`).join('')}</ul>`;
      $$('[data-row]', body).forEach((b) => {
        const row = rows.find((r) => r.id === b.dataset.row);
        b.onclick = () => {
          lightTap();
          close();
          if (row.go) location.hash = row.go;
          else setTimeout(RUN[row.run], 0);
        };
      });
    });
  }).finally(() => { opening = false; });
}

export function mountQuickLog() {
  if (fab) return;
  fab = document.createElement('button');
  fab.type = 'button';
  fab.id = 'quicklog';
  fab.className = 'ql-fab';
  fab.setAttribute('aria-label', 'Quick log');
  fab.setAttribute('aria-haspopup', 'dialog');
  fab.setAttribute('aria-hidden', 'true');
  fab.tabIndex = -1;
  fab.innerHTML = icon('plus', { size: 28 });
  fab.addEventListener('click', openQuickLog);
  document.body.appendChild(fab);
  onSheetsChange(refresh);
  document.addEventListener('focusin', refresh);
  document.addEventListener('focusout', () => setTimeout(refresh, 0));
  document.addEventListener('close', refresh, true); // a dialog closing (lock screen, native dialogs)
  if (window.visualViewport) window.visualViewport.addEventListener('resize', refresh);
  new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ['class'] }); // the tour adds tour-on
}
