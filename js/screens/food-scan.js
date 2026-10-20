// Barcode scan and Create food for Log food (v0.16.44). Scan: the camera reads the barcode on this phone (nothing is
// recorded or sent but the number), or you type the number. Create food: a food from the nutrition label, saved to My
// foods with its barcode, so it is the first thing a search or scan finds next time. The lookups are in js/food/off.js.
import { put, newRecord } from '../db.js';
import { esc, $, sheet, toast } from '../ui.js';
import { icon } from '../ui/icons.js';
import { haptics } from '../ui/haptic.js';
import { cleanFood } from '../food/core.js';
import { cleanBarcode, labelPrefill } from '../food/off.js';
import { foodItems } from '../food/search.js';
import { prepareImage, estimateMeal } from '../food/snap.js';
import { photoInput } from './snap.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
export const canScan = () => typeof navigator !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof BarcodeDetector === 'function';

/** The camera sheet. Calls onCode(code) with the digits once, then closes. Typing the number always works. */
export function openBarcodeScan({ onCode }) {
  let stream = null;
  let alive = true;
  sheet('Scan a barcode', (body, close) => {
    const stop = () => { alive = false; if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
    const dlg = body.closest('dialog');
    if (dlg) dlg.addEventListener('close', stop);
    const done = (code) => { if (!alive) return; stop(); haptics.success(); close(); setTimeout(() => onCode(code), 0); };
    body.innerHTML = `
      <div class="stack scan">
        ${canScan() ? `<div class="scan-view"><video playsinline muted aria-label="Camera"></video><i class="scan-frame" aria-hidden="true"></i></div>` : ''}
        <p class="small muted" data-scan-note role="status" aria-live="polite">${canScan() ? 'Point the camera at the barcode.' : 'This device can’t scan with the camera. Type the number under the barcode.'}</p>
        <form class="stack" data-scan-form novalidate>
          <label class="field"><span>Or type the barcode number</span><input name="code" inputmode="numeric" autocomplete="off" maxlength="20" placeholder="0 96619 12345 6"></label>
          <p class="error" aria-live="polite"></p>
          <button class="btn" type="submit">Look it up</button>
        </form>
      </div>`;
    $('[data-scan-form]', body).addEventListener('submit', (e) => {
      e.preventDefault();
      const code = cleanBarcode(e.target.code.value);
      if (!code) { $('.error', body).textContent = 'Barcodes are 8 to 14 digits.'; return; }
      done(code);
    });
    if (!canScan()) return;
    const video = $('video', body);
    const note = $('[data-scan-note]', body);
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (!alive) { stop(); return; }
        video.srcObject = stream;
        await video.play();
        const detector = new BarcodeDetector({ formats: FORMATS });
        const tick = async () => {
          if (!alive) return;
          try {
            const hits = await detector.detect(video);
            const code = hits.map((h) => cleanBarcode(h.rawValue)).find(Boolean);
            if (code) { done(code); return; }
          } catch { /* a frame that can't be read is just skipped */ }
          setTimeout(tick, 250);
        };
        tick();
      } catch {
        note.textContent = 'Camera access is off. Type the number under the barcode instead.';
        $('.scan-view', body)?.remove();
      }
    })();
  }, { detents: ['medium', 'large'] });
}

/**
 * Create food: name, serving and the label's numbers. `start` pre-fills it (a barcode, a typed name, or a label photo's
 * numbers). onSaved(item) gets the new food as a Log food item, so the caller can select it.
 */
export function openCreateFood({ start = {}, onSaved } = {}) {
  sheet('Create food', (body, close) => {
    let v = { name: '', serving: '', kcal: '', protein_g: '', carbs_g: '', fat_g: '', barcode: '', favorite: false, ...start };
    const paint = (note = '') => {
      body.innerHTML = `
        <form class="stack" novalidate>
          ${v.barcode ? `<p class="small muted" data-barcode-note>${icon('barcode', { size: 16 })} Barcode ${esc(v.barcode)} wasn’t found. Add it once and scanning finds it next time.</p>` : ''}
          <label class="btn ghost snap-take" data-label-btn>${icon('camera')}Estimate from a photo of the label${photoInput('data-label-file')}</label>
          <p class="small muted" data-label-note role="status" aria-live="polite">${esc(note || 'Optional. The photo goes to the AI to read the label and isn’t saved. You can fix the numbers before saving.')}</p>
          <label class="field"><span>Name</span><input name="name" maxlength="80" value="${esc(v.name)}" autocomplete="off" placeholder="Just Bare spicy chicken strips"></label>
          <label class="field"><span>Serving</span><input name="serving" maxlength="40" value="${esc(v.serving)}" autocomplete="off" placeholder="3 oz (84 g)"></label>
          <p class="small muted">Numbers are for one serving, as printed on the label.</p>
          <div class="field-grid">
            <label class="field"><span>Calories</span><input name="kcal" type="number" inputmode="numeric" min="0" max="5000" value="${esc(v.kcal)}"></label>
            <label class="field"><span>Protein (g)</span><input name="protein_g" type="number" inputmode="decimal" min="0" max="500" value="${esc(v.protein_g)}"></label>
            <label class="field"><span>Carbs (g)</span><input name="carbs_g" type="number" inputmode="decimal" min="0" max="500" value="${esc(v.carbs_g)}"></label>
            <label class="field"><span>Fat (g)</span><input name="fat_g" type="number" inputmode="decimal" min="0" max="500" value="${esc(v.fat_g)}"></label>
          </div>
          <label class="field"><span>Barcode (optional)</span><input name="barcode" inputmode="numeric" maxlength="20" value="${esc(v.barcode)}" autocomplete="off"></label>
          <label class="g-row sw"><span class="g-text"><span>Favorite</span><small>Shows at the top of search.</small></span><input type="checkbox" switch name="favorite" ${v.favorite ? 'checked' : ''}></label>
          <p class="error" aria-live="polite"></p>
          <button class="btn" type="submit">Save to my foods</button>
        </form>`;
      const f = $('form', body);
      const read = () => ({ ...Object.fromEntries(new FormData(f)), favorite: f.favorite.checked });
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const r = cleanFood(read());
        if (!r.ok) { $('.error', body).textContent = r.error; return; }
        const rec = newRecord(r.food);
        put('foods', rec);
        haptics.success();
        close();
        toast(`Saved ${r.food.name}`, 2200, { icon: 'check' });
        if (onSaved) onSaved(foodItems([{ ...rec }])[0]);
      });
      $('[data-label-file]', body).onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        v = { ...v, ...read() };
        const msg = $('[data-label-note]', body);
        msg.textContent = 'Reading the label…';
        try {
          const { call } = await import('../functions.js');
          const rows = await estimateMeal(await prepareImage(file), call);
          const p = labelPrefill(rows[0]);
          v = { ...v, ...p, name: v.name || p.name, serving: p.serving || v.serving };
          paint('Filled in from the label. Check the numbers against the package.');
        } catch (err) {
          msg.textContent = `${(err && err.message) || 'Couldn’t read that photo.'} You can type the numbers instead.`;
        }
      };
    };
    paint();
  }, { detents: ['medium', 'large'] });
}
