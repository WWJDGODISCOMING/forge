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
import { canScan, pickDecoder, createConfirmer, validScan } from '../food/gtin.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
export { canScan };

/** Reads a frame with the vendored JS reader (iOS has no BarcodeDetector): the middle band of the video, as grayscale. */
async function jsDetector() {
  const { decodeFrame } = await import('../vendor/ean/ean.js');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return '';
    // Full width (up to 1920), only the middle half of the height: scaling down would halve the width of each bar.
    const w = Math.min(1920, vw);
    const sy = Math.round(vh * 0.25);
    const sh = Math.max(1, Math.round(vh * 0.5));
    const h = Math.max(1, Math.round(sh * (w / vw)));
    canvas.width = w; canvas.height = h;
    ctx.drawImage(video, 0, sy, vw, sh, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
    return decodeFrame(gray, w, h);
  };
}

async function nativeDetector() {
  const d = new BarcodeDetector({ formats: FORMATS });
  return async (video) => {
    const hits = await d.detect(video);
    return hits.map((h) => validScan(h.rawValue, h.format)).find(Boolean) || '';
  };
}

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
        <p class="small muted" data-scan-note role="status" aria-live="polite">${canScan() ? 'Hold the barcode level across the frame.' : 'This device can’t scan with the camera. Type the number under the barcode.'}</p>
        <form class="stack" data-scan-form novalidate>
          <label class="field"><span>Or type the barcode number</span><input name="code" inputmode="numeric" autocomplete="off" maxlength="20" placeholder="e.g. 0 96619 12345 6"></label>
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
        // A big picture, so each bar is several pixels wide at a distance the phone can focus at.
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!alive) { stop(); return; }
        // Keep focus adjusting where the browser allows it; ignored elsewhere.
        try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* not supported */ }
        video.srcObject = stream;
        await video.play();
        const detect = (await pickDecoder()) === 'native' ? await nativeDetector() : await jsDetector();
        const confirm = createConfirmer(2); // the same valid code on 2 frames in a row, so a misread can't pick the wrong product
        const tick = async () => {
          if (!alive) return;
          let code = '';
          try { code = confirm(await detect(video)); } catch { confirm(''); /* a frame that can't be read is just skipped */ }
          if (code) { done(code); return; }
          setTimeout(tick, 120);
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
          ${v.barcode ? `<p class="small muted" data-barcode-note>${icon('barcode', { size: 16 })} ${v.unchecked ? `Couldn’t check barcode ${esc(v.barcode)} right now.` : `Barcode ${esc(v.barcode)} wasn’t found.`} Add it once and scanning finds it next time.</p>` : ''}
          <label class="btn ghost snap-take" data-label-btn>${icon('camera')}Read the label with a photo${photoInput('data-label-file')}</label>
          <p class="small muted" data-label-note role="status" aria-live="polite">${esc(note || 'Optional. The photo goes to the AI to read the label and isn’t saved. You can fix the numbers before saving.')}</p>
          <label class="field"><span>Name</span><input name="name" maxlength="80" value="${esc(v.name)}" autocomplete="off" placeholder="e.g. Just Bare spicy chicken strips"></label>
          <label class="field"><span>Serving</span><input name="serving" maxlength="40" value="${esc(v.serving)}" autocomplete="off" placeholder="e.g. 3 oz (84 g)"></label>
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
