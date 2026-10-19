// Body → Progress photos: your sets of photos, newest first, with Compare and Time-lapse. The pictures are
// stored on this phone only (IndexedDB); see js/photos/store.js.
import { esc, $, $$, sheet, toast, confirmSheet, formatDay, todayKey } from '../ui.js';
import { icon, emptyState } from '../ui/icons.js';
import { units as getUnits } from '../state.js';
import { daysBetween } from '../weight/smoothing.js';
import { POSES, fmtBytes, poseLabel, photoLossLine, photosUnavailableLine } from '../photos/core.js';
import { isNative } from '../native/bridge.js';
import { myStore, mySessions } from '../photos/access.js';
import { bodyOn, fmtKg, photoUrl, revokeAll } from '../photos/metrics.js';
import { openCapture } from '../photos/capture.js';
import { openViewer } from '../photos/viewer.js';

const ago = (day) => {
  const n = daysBetween(day, todayKey());
  return n <= 0 ? 'Today' : n === 1 ? 'Yesterday' : `${n} days ago`;
};

export async function renderPhotos(el, sub) {
  const { photos, sessions, ok } = await mySessions();
  revokeAll();
  const store = myStore();
  const u = getUnits();
  const bytes = photos.reduce((n, p) => n + (p.blob ? p.blob.size : 0), 0);
  const redraw = () => renderPhotos(el);

  const sessionCard = (s, i = 0) => {
    const b = bodyOn(s.day);
    return `<div class="card stack pp-session" data-day="${s.day}">
      <div class="row between center">
        <div><p class="pp-date">${esc(formatDay(s.day, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}</p>
          <p class="small muted">${ago(s.day)}${b.trendKg != null ? ` · trend ${fmtKg(b.trendKg, u)}` : ''}</p></div>
        <button class="icon-btn" data-more="${s.day}" aria-label="More for ${esc(formatDay(s.day))}">${icon('more', { size: 20 })}</button>
      </div>
      <div class="pp-thumbs">${POSES.map((p) => (s.poses[p.key]
        ? `<button class="pp-thumb" data-open="${s.poses[p.key].id}" aria-label="${p.label}, ${esc(formatDay(s.day))}"><img src="${photoUrl(s.poses[p.key])}" alt="" loading="${i === 0 ? 'eager' : 'lazy'}"><span>${p.label}</span></button>`
        : `<div class="pp-thumb empty" aria-hidden="true"><span>${p.label}</span></div>`)).join('')}</div>
      ${s.note ? `<p class="small">${esc(s.note)}</p>` : ''}
    </div>`;
  };

  el.innerHTML = `
    <section class="stack">
      <h1>Progress photos</h1>
      ${!ok ? `<div class="notice warn">${esc(photosUnavailableLine(isNative()))}</div>` : ''}
      ${sessions.length ? `
        <button class="btn primary" data-take>${icon('camera')}Take photos</button>
        <div class="row gap">
          <button class="btn ghost grow" data-compare ${sessions.length < 2 ? 'disabled' : ''}>${icon('swap')}Compare</button>
          <button class="btn ghost grow" data-lapse ${sessions.length < 2 ? 'disabled' : ''}>${icon('play')}Time-lapse</button>
        </div>
        ${sessions.length < 2 ? '<p class="small muted center-text">Take photos on two different days to compare them.</p>' : ''}
        ${sessions.map((s, i) => sessionCard(s, i)).join('')}`
        : `<div class="card">${emptyState({ art: 'photos', icon: 'camera', title: 'Track how you look, not just what you weigh', text: 'The scale can’t show everything. Take a few photos each week and watch the change. They stay on this phone.', action: ok ? { attr: 'data-take', label: 'Take first photos' } : null })}</div>`}
      <div class="card stack small">
        <p class="label">Privacy</p>
        <p>Photos stay on this iPhone only. They aren’t backed up by Forge. ${photoLossLine(isNative())}</p>
        <p class="muted">${photos.length ? `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'} · ${fmtBytes(bytes)} on this phone. ` : ''}Back them up from Settings → Progress photos.</p>
      </div>
    </section>`;

  const take = () => openCapture({ store, sessions, onSaved: redraw });
  $$('[data-take]', el).forEach((b) => { b.onclick = take; });
  const compare = $('[data-compare]', el);
  if (compare) compare.onclick = () => import('../photos/compare.js').then((m) => m.openCompare({ sessions }));
  const lapse = $('[data-lapse]', el);
  if (lapse) lapse.onclick = () => import('../photos/timelapse.js').then((m) => m.openTimelapse({ sessions }));

  const byId = new Map(photos.map((p) => [p.id, p]));
  const removeDay = async (day) => {
    const ok2 = await confirmSheet({ title: 'Delete this set?', message: `This deletes every photo from ${formatDay(day, { month: 'long', day: 'numeric', year: 'numeric' })} from this phone. There is no backup.`, confirmLabel: 'Delete set', danger: true });
    if (!ok2) return false;
    await store.removeDay(day);
    toast('Deleted');
    redraw();
    return true;
  };
  $$('[data-more]', el).forEach((b) => {
    b.onclick = () => sheet(formatDay(b.dataset.more, { month: 'long', day: 'numeric', year: 'numeric' }), (body, close) => {
      body.innerHTML = '<div class="stack"><button class="btn danger-ghost" data-del>Delete this whole set</button></div>';
      $('[data-del]', body).onclick = async () => { close(); await removeDay(b.dataset.more); };
    });
  });
  $$('[data-open]', el).forEach((b) => {
    b.onclick = () => {
      const p = byId.get(b.dataset.open);
      if (!p) return;
      openViewer({
        src: photoUrl(p),
        title: `${poseLabel(p.pose)} · ${formatDay(p.day, { month: 'short', day: 'numeric', year: 'numeric' })}`,
        thumb: b,
        findThumb: () => el.querySelector(`[data-open="${p.id}"]`),
        onDelete: async () => {
          const yes = await confirmSheet({ title: 'Delete this photo?', message: 'It is removed from this phone. There is no backup.', confirmLabel: 'Delete photo', danger: true });
          if (!yes) return;
          await store.remove(p.id);
          toast('Deleted');
          redraw();
        },
      });
    };
  });

  // Coming from the Body card's "Take first photos" (#/photos/take): open the sheet once, then tidy the address.
  if (sub === 'take' && ok) {
    history.replaceState(null, '', '#/photos');
    take();
  }
}
