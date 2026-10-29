// Settings → Progress photos: reminder day, backup (zip) and delete-all. Photos live only on this phone.
import { $, sheet, toast } from '../ui.js';
import { icon } from '../ui/icons.js';
import { myStore, mySessions } from './access.js';
import { DOW_NAMES, fmtBytes, exportName, poseLabel, photoLossLine } from './core.js';
import { isNative } from '../native/bridge.js';
import { haptics } from '../ui/haptic.js';
import { getRemindDow, setRemindDow } from './cards.js';
import { dayKey } from '../weight/smoothing.js';
import { zipStore } from './zipwriter.js';
import { deliverSheet } from './deliver.js';

export function photoSettingsHtml() {
  const dow = getRemindDow();
  return `
      <p class="sec-title">Progress photos</p>
      <div class="group" data-photo-settings>
        <label class="g-row"><span class="g-text"><span>Reminder</span><small>A card on Today until you take the week’s photos.</small></span>
          <select name="photo-remind" aria-label="Weekly photo reminder day">
            <option value="off" ${dow == null ? 'selected' : ''}>Off</option>
            ${DOW_NAMES.map((n, i) => `<option value="${i}" ${dow === i ? 'selected' : ''}>${n}</option>`).join('')}
          </select></label>
        <a class="g-row" href="#/photos"><span class="g-ic">${icon('camera')}</span><span class="g-text"><span>Progress photos</span><small data-photo-usage>&nbsp;</small></span><span class="chev">${icon('chev')}</span></a>
        <button class="g-row" data-photo-export><span class="g-ic">${icon(isNative() ? 'share' : 'download')}</span><span class="g-text"><span>Export all photos (zip)</span><small>Your backup. Save it to Files or iCloud Drive.</small></span></button>
        <button class="g-row g-danger" data-photo-wipe><span class="g-ic">${icon('trash')}</span><span class="g-text"><span>Delete all photos</span></span></button>
      </div>
      <p class="sec-foot">Photos stay on this iPhone only. They aren’t backed up by Forge. ${photoLossLine(isNative())}</p>`;
}

export async function bindPhotoSettings(el) {
  const root = $('[data-photo-settings]', el);
  if (!root) return;
  $('[name=photo-remind]', root).addEventListener('change', (e) => {
    setRemindDow(e.target.value === 'off' ? null : Number(e.target.value));
    toast(e.target.value === 'off' ? 'Photo reminder off' : `Reminder set for ${DOW_NAMES[Number(e.target.value)]}`, 2200, { icon: 'check' });
  });

  const paintUsage = async () => {
    const { photos } = await mySessions();
    const out = $('[data-photo-usage]', root);
    if (out) out.textContent = photos.length ? `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'} · ${fmtBytes(photos.reduce((n, p) => n + (p.blob ? p.blob.size : 0), 0))} on this phone` : 'No photos yet';
  };
  paintUsage();

  $('[data-photo-export]', root).onclick = async (e) => {
    const btn = e.currentTarget;
    const { photos } = await mySessions();
    if (!photos.length) return toast('No photos to export yet');
    btn.disabled = true;
    const lab = $('.g-text > span', btn);
    const label = lab.textContent;
    lab.textContent = 'Building your backup…';
    try {
      const sorted = [...photos].sort((a, b) => (a.day + a.pose < b.day + b.pose ? -1 : 1));
      const entries = [];
      for (const p of sorted) entries.push({ name: exportName(p), data: new Uint8Array(await p.blob.arrayBuffer()), date: new Date(p.created_at || Date.now()) });
      const enc = new TextEncoder();
      const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
      entries.push({ name: 'photos.csv', data: enc.encode(`date,pose,file,note\n${sorted.map((p) => [p.day, poseLabel(p.pose), exportName(p), q(p.note || '')].join(',')).join('\n')}\n`) });
      entries.push({ name: 'README.txt', data: enc.encode('Forge progress photos backup. One JPEG per pose per day (photos/DATE_POSE.jpg). photos.csv lists them with your notes.\nThese pictures contain no location or camera information.\n') });
      deliverSheet({ title: 'Your photo backup', blob: zipStore(entries), name: `forge-photos-${dayKey(new Date())}.zip`, note: 'Keep this somewhere safe. Forge can’t restore from it yet, but the pictures are plain JPEGs.' });
    } catch {
      toast('Couldn’t build the backup. Try again.');
    } finally {
      btn.disabled = false;
      lab.textContent = label;
    }
  };

  $('[data-photo-wipe]', root).onclick = () => sheet('Delete all photos?', (body, close) => {
    body.innerHTML = `<form class="stack" novalidate>
      <p>This permanently deletes every progress photo on this phone. Forge has no copy, so they can’t be brought back unless you exported a backup.</p>
      <label class="field"><span>Type DELETE to confirm</span><input name="confirm" autocomplete="off" autocapitalize="characters"></label>
      <p class="error" aria-live="polite"></p>
      <button class="btn danger" type="submit">Delete all photos</button></form>`;
    $('form', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if ($('[name=confirm]', body).value.trim().toUpperCase() !== 'DELETE') {
        $('.error', body).textContent = 'Type DELETE to confirm.';
        return;
      }
      try {
        haptics.warning();
        await myStore().clearAll();
        close();
        toast('All photos deleted from this phone');
        paintUsage();
      } catch (ex) {
        $('.error', body).textContent = ex.message || 'Couldn’t delete. Try again.';
      }
    });
  });
}
