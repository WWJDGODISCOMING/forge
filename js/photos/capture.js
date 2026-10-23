// The capture sheet: Front, Side and Back (each optional), a camera or library picker per pose, a faint ghost
// of your last photo of that pose to line up with, an optional note and the date. Everything stays on this phone.
import { sheet, toast, todayKey, formatDay } from '../ui.js';
import { icon } from '../ui/icons.js';
import { units as getUnits } from '../state.js';
import { POSES, sessionsWithPose } from './core.js';
import { prepareJpeg } from './image.js';
import { keepStorage } from './store.js';
import { bodyOn, fmtKg, photoUrl } from './metrics.js';
import { haptics } from '../ui/haptic.js';
import { canViewfinder, openViewfinder } from './viewfinder.js';

/**
 * openCapture({ store, sessions, day, onSaved }). `sessions` (newest first) supply the ghost of each pose's
 * latest photo. Saving asks the browser to keep the photos safe from eviction (first save does the work).
 */
export function openCapture({ store, sessions, day = todayKey(), onSaved }) {
  sheet('Progress photos', (body, close) => {
    const picked = {}; // pose → { blob, w, h, url }
    const ghostOn = {}; // pose → bool
    const last = (pose) => {
      const list = sessionsWithPose(sessions, pose);
      return list.length ? list[list.length - 1].poses[pose] : null;
    };
    const useViewfinder = canViewfinder();
    body.innerHTML = `
      <div class="stack pc">
        <p class="muted">Take any of these. Each one is optional.</p>
        ${POSES.map((p) => `
          <div class="pc-pose" data-pose="${p.key}">
            <button class="pc-thumb" type="button" data-ghost aria-label="${p.label}: show or hide your last photo to line up"></button>
            <div class="pc-side">
              <b>${p.label}</b>
              <small class="muted" data-hint></small>
              ${useViewfinder ? `<button class="btn small" type="button" data-cam>${icon('camera')}<span>Take photo</span></button>` : `<label class="btn small">${icon('camera')}<span>Take photo</span><input type="file" accept="image/*" capture="environment" hidden data-file></label>`}
              <label class="btn small ghost"><span>Choose from library</span><input type="file" accept="image/*" hidden data-file></label>
            </div>
          </div>`).join('')}
        <label class="field"><span>Date</span><input type="date" name="day" value="${day}" max="${todayKey()}"></label>
        <p class="small muted" data-body-line></p>
        <label class="field"><span>Note (optional)</span><input type="text" name="note" maxlength="140" placeholder="e.g. morning, after a hard week" autocomplete="off"></label>
        <p class="small muted">Photos stay on this phone. They are never uploaded.</p>
        <p class="error" aria-live="polite" data-err></p>
        <button class="btn primary" type="button" data-save disabled>Save photos</button>
      </div>`;
    const q = (sel, root = body) => root.querySelector(sel);
    // Revoke picked previews however the sheet goes away (close button, swipe, Escape, backdrop or save).
    body.closest('dialog').addEventListener('close', () => Object.values(picked).forEach((p) => URL.revokeObjectURL(p.url)));

    const paint = (pose) => {
      const row = q(`[data-pose="${pose}"]`);
      const thumb = q('.pc-thumb', row);
      const mine = picked[pose];
      const prev = last(pose);
      const ghost = prev && (mine ? ghostOn[pose] : true);
      thumb.innerHTML = `${mine ? `<img src="${mine.url}" alt="" class="pc-img">` : ''}${ghost ? `<img src="${photoUrl(prev)}" alt="" class="pc-img ${mine ? 'pc-ghost' : 'pc-last'}">` : ''}${!mine && !prev ? icon('person') : ''}`;
      thumb.disabled = !(mine && prev);
      q('[data-hint]', row).textContent = mine ? (prev ? (ghostOn[pose] ? 'Tap the picture to hide last time’s outline' : 'Tap the picture to line up with last time') : 'Ready') : (prev ? `Last: ${formatDay(prev.day)}` : 'Not taken yet');
      q('[data-save]').disabled = !Object.keys(picked).length;
    };
    POSES.forEach((p) => paint(p.key));

    for (const p of POSES) {
      const row = q(`[data-pose="${p.key}"]`);
      const ingest = async (file) => {
        q('[data-err]').textContent = '';
        q('[data-hint]', row).textContent = 'Getting it ready…';
        try {
          const out = await prepareJpeg(file);
          if (picked[p.key]) URL.revokeObjectURL(picked[p.key].url);
          picked[p.key] = { ...out, url: URL.createObjectURL(out.blob) };
          ghostOn[p.key] = !!last(p.key);
        } catch {
          q('[data-err]').textContent = 'That picture couldn’t be opened. Try another one.';
        }
        paint(p.key);
      };
      row.querySelectorAll('[data-file]').forEach((input) => {
        input.addEventListener('change', async () => {
          const file = input.files && input.files[0];
          input.value = '';
          if (file) await ingest(file);
        });
      });
      const cam = q('[data-cam]', row);
      if (cam) {
        cam.addEventListener('click', async () => {
          haptics.light();
          const prev = last(p.key);
          try {
            const file = await openViewfinder({ label: p.label, ghostUrl: prev ? photoUrl(prev) : '' });
            if (file) await ingest(file);
          } catch {
            // The camera wouldn't open (permission off): hand over to the system picker so Take photo still works.
            const pick = document.createElement('input');
            pick.type = 'file'; pick.accept = 'image/*'; pick.setAttribute('capture', 'environment');
            pick.addEventListener('change', () => { if (pick.files && pick.files[0]) ingest(pick.files[0]); });
            pick.click();
          }
        });
      }
      q('.pc-thumb', row).addEventListener('click', () => {
        ghostOn[p.key] = !ghostOn[p.key];
        paint(p.key);
      });
    }

    const dayInput = q('[name=day]');
    const paintBody = () => {
      const b = bodyOn(dayInput.value || day);
      const u = getUnits();
      q('[data-body-line]').textContent = b.trendKg == null ? 'No weigh-ins yet to show beside these.' : `Your weight trend then: ${fmtKg(b.trendKg, u)}${b.fatKg != null ? ` · fat mass ${fmtKg(b.fatKg, u)}` : ''}. Not saved with the photo.`;
    };
    paintBody();
    dayInput.addEventListener('change', paintBody);

    const save = q('[data-save]');
    save.addEventListener('click', async () => {
      const chosen = Object.entries(picked);
      if (!chosen.length) return;
      save.disabled = true;
      save.textContent = 'Saving…';
      const d = dayInput.value || day;
      const note = q('[name=note]').value.trim();
      try {
        await keepStorage();
        for (const [pose, p] of chosen) await store.save({ day: d, pose, blob: p.blob, w: p.w, h: p.h, note });
        if (note) await store.setNote(d, note);
        close();
        haptics.success();
        toast(`Saved ${chosen.length === 1 ? 'your photo' : `${chosen.length} photos`}`, 2600, { icon: 'check' });
        if (onSaved) onSaved();
      } catch (e) {
        save.disabled = false;
        save.textContent = 'Save photos';
        q('[data-err]').textContent = e && e.message ? e.message : 'Couldn’t save. Is the phone’s storage full?';
      }
    });
  });
}
