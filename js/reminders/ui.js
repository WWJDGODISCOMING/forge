// Smart reminders UI: the Settings section (all off by default, one switch to turn everything off) and the Today banner
// that stands in for notifications on the web.
import { esc, $, $$, toast } from '../ui.js';
import { icon } from '../ui/icons.js';
import { haptics } from '../ui/haptic.js';
import { isNative } from '../native/bridge.js';
import { KINDS, META, HONEST_LINE, anyOn } from './core.js';
import { getReminders, saveReminders, syncReminders, bannersNow, dismissToday } from './store.js';

const ROUTE = { weigh: '#/body', steps: '#/apple', protein: '#/food', food: '#/food', workout: '#/train' };

const where = () => (isNative()
  ? 'Notifications come from this iPhone.'
  : 'On the web app these show as a card on Today. Install the iPhone app for real notifications.');

export function reminderSettingsHtml() {
  const s = getReminders();
  return `
      <p class="sec-title">Reminders</p>
      <div class="group" data-reminders>
        ${KINDS.map((k) => `<div class="g-row col static rm-row" data-rm="${k}">
          <label class="rm-top"><span class="g-text"><span>${esc(META[k].label)}</span><small>${esc(META[k].hint)}</small></span><input type="checkbox" switch name="rm-on-${k}" aria-label="${esc(META[k].label)} reminder" ${s[k].on ? 'checked' : ''}></label>
          <label class="rm-time" ${s[k].on ? '' : 'hidden'}><span>Time</span><input type="time" name="rm-time-${k}" value="${esc(s[k].time)}" aria-label="${esc(META[k].label)} reminder time"></label>
        </div>`).join('')}
        <div class="g-row col static rm-row" data-rm-quiet>
          <label class="rm-top"><span class="g-text"><span>Quiet hours</span><small>Nothing goes off between these times.</small></span><input type="checkbox" switch name="rm-quiet-on" aria-label="Quiet hours" ${s.quiet.on ? 'checked' : ''}></label>
          <div class="rm-time" ${s.quiet.on ? '' : 'hidden'}><label><span>From</span><input type="time" name="rm-quiet-from" value="${esc(s.quiet.from)}" aria-label="Quiet hours start"></label><label><span>To</span><input type="time" name="rm-quiet-to" value="${esc(s.quiet.to)}" aria-label="Quiet hours end"></label></div>
        </div>
        <button type="button" class="g-row" data-rm-off ${anyOn(s) ? '' : 'hidden'}><span class="g-text"><span>Turn all reminders off</span></span></button>
      </div>
      <p class="sec-foot">${esc(where())} ${esc(HONEST_LINE)} Goals come from your own settings. These are friendly nudges, not medical advice.</p>`;
}

export function bindReminderSettings(el) {
  const root = $('[data-reminders]', el);
  if (!root) return;
  const read = () => {
    const out = { quiet: { on: $('[name=rm-quiet-on]', root).checked, from: $('[name=rm-quiet-from]', root).value, to: $('[name=rm-quiet-to]', root).value } };
    for (const k of KINDS) out[k] = { on: $(`[name=rm-on-${k}]`, root).checked, time: $(`[name=rm-time-${k}]`, root).value };
    return out;
  };
  const paint = () => {
    for (const k of KINDS) $(`[data-rm=${k}] .rm-time`, root).hidden = !$(`[name=rm-on-${k}]`, root).checked;
    $('[data-rm-quiet] .rm-time', root).hidden = !$('[name=rm-quiet-on]', root).checked;
    $('[data-rm-off]', root).hidden = !KINDS.some((k) => $(`[name=rm-on-${k}]`, root).checked);
  };
  const apply = (next) => {
    saveReminders(next);
    syncReminders({ force: true });
  };

  $$('input[type=checkbox]', root).forEach((box) => box.addEventListener('change', async () => {
    haptics.select();
    paint();
    const turnedOn = box.checked && box.name.startsWith('rm-on-');
    saveReminders(read());
    if (turnedOn) {
      const res = await syncReminders({ ask: true, force: true });
      if (res === 'denied') {
        box.checked = false;
        paint();
        saveReminders(read());
        toast('Notifications are off for Forge. You can turn them on in iPhone Settings.', 3600);
      } else if (res === 'web') {
        toast('On the web this shows as a card on Today.', 2800, { icon: 'check' });
      }
    } else {
      syncReminders({ force: true });
    }
  }));
  $$('input[type=time]', root).forEach((inp) => inp.addEventListener('change', () => {
    if (!/^\d{1,2}:\d{2}$/.test(inp.value)) return; // cleared: keep the old time
    apply(read());
  }));
  $('[data-rm-off]', root).onclick = () => {
    haptics.select();
    $$('input[name^=rm-on-]', root).forEach((b) => { b.checked = false; });
    paint();
    apply(read());
    toast('All reminders off', 2200, { icon: 'check' });
  };
}

/** Web only: a card on Today for each reminder whose time has passed and that isn't done yet. */
export function mountReminderBanners(host) {
  if (!host) return;
  const list = bannersNow();
  if (!list.length) { host.innerHTML = ''; return; }
  host.innerHTML = list.map((b) => `<div class="card row between center rm-banner" data-reminder-card="${b.kind}">
    <a class="grow rm-banner-text" href="${ROUTE[b.kind]}"><p class="label">${icon('timer', { size: 16 })} ${esc(b.title)}</p><p class="small">${esc(b.body)}</p></a>
    <button class="icon-btn" data-dismiss="${b.kind}" aria-label="Hide ${esc(b.title)} reminder for today">${icon('close', { size: 18 })}</button>
  </div>`).join('');
  $$('[data-dismiss]', host).forEach((btn) => btn.addEventListener('click', () => {
    haptics.select();
    dismissToday(btn.dataset.dismiss);
    mountReminderBanners(host);
  }));
}
