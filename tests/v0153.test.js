// v0.15.3 (audit part 2): Today order and length, tour steps and the one-time offer, photo findability and copy,
// ratio-only fat mass, one-line chips, rings that don't replay. Screens are DOM, so these check the rules and the
// markup order in the source; the 390×844 renders are checked by the review bot.
import { readFileSync } from 'node:fs';
import { test, eq, assert, near } from './harness.js';
import { indices, bodyProfile } from '../js/health/bodyprofile.js';
import { photoLossLine, photosUnavailableLine } from '../js/photos/core.js';
import { photosUnavailableHtml } from '../js/photos/cards.js';
import { TOUR_STEPS, TOUR_OFFER, tourFieldsForSave, tourSeenFields, tourOfferFields, tourOfferDue } from '../js/tour/steps.js';
import { startOffset, macroTilesHtml } from '../js/ui/rings.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const idx = (s, needle) => { const i = s.indexOf(needle); assert(i >= 0, `missing ${needle}`); return i; };

test('Today budget: the sections above the fold-and-a-half carry a fixed, small set of cards', () => {
  // Height can't be measured without a browser; keep the always-present card count small. The review bot measures ≤ 1,604 px at 390×844.
  const t = src('js/screens/today.js');
  const body = t.slice(idx(t, 'el.innerHTML = `'));
  const cards = body.match(/class="card[ "]/g) || [];
  assert(cards.length <= 4, `${cards.length} inline cards in the Today template`);
});


test('tour offer: shown once to accounts that already existed, never again after Show me / Not now', () => {
  assert(tourOfferDue({ goal: 'lose' }), 'old account with no tour field');
  assert(tourOfferDue({ goal: 'lose', tour: 'seen', tour_seen_at: '2026-09-01T00:00:00Z' }), 'old account that saw the tour');
  assert(!tourOfferDue(null), 'no profile');
  assert(!tourOfferDue({ tour: 'pending', ...tourFieldsForSave(false) }), 'a brand-new account gets the full tour instead');
  assert(!tourOfferDue({ tour: 'seen', ...tourSeenFields('2026-10-10T00:00:00Z') }), 'finishing or skipping the tour settles it');
  const answered = { goal: 'lose', ...tourOfferFields() };
  eq(answered.tour_offer, TOUR_OFFER);
  assert(!tourOfferDue(answered), 'not again after the answer');
  const t = src('js/screens/today.js');
  assert(t.includes('New: Food and photos') && t.includes('Show me') && t.includes('Not now'), 'copy');
  assert(/data-tour-offer-show[\s\S]*dismissTourOffer\(\);[\s\S]*startTour/.test(t), 'Show me settles the offer then starts the tour');
});

test('Body Profile: fat mass comes from weight × fat_ratio_pct when the scale sends only the ratio', () => {
  const ix = indices({ weight_kg: 80, fat_ratio_pct: 20 }, 1.8);
  near(ix.fmi, 16 / (1.8 * 1.8), 1e-9, 'FMI');
  near(ix.ffmi, 64 / (1.8 * 1.8), 1e-9, 'FFMI');
  eq(indices({ weight_kg: 80 }, 1.8), null, 'no composition at all still needs a scale reading');
  eq(indices({ weight_kg: 80, fat_ratio_pct: 0 }, 1.8), null, 'a zero ratio is not a reading');
  const real = indices({ weight_kg: 80, fat_mass_kg: 10, fat_free_mass_kg: 70, fat_ratio_pct: 50 }, 1.8);
  near(real.fmi, 10 / (1.8 * 1.8), 1e-9, 'real fat mass wins over the ratio');
  const p = bodyProfile({ measures: [{ day: '2026-10-01', metrics: { weight_kg: 176 / 2.20462, fat_ratio_pct: 18.5 } }], heightM: 1.78, sex: 'male' });
  eq(p.status, 'ok');
});


test('Body has the Progress photos card, and Progress has Awards and Coach rows', () => {
  const b = src('js/screens/body.js');
  assert(b.includes('data-photos-slot'), 'photos card on Body');
  const r = src('js/screens/progress.js');
  assert(r.includes('href="#/awards"') || r.includes("'#/awards'"), 'Awards row');
  assert(r.includes("'#/coach'"), 'Coach row');
});

test('photos: native copy never says Safari; the web keeps it', () => {
  assert(!/safari/i.test(photoLossLine(true)), 'native');
  eq(photoLossLine(true), 'If you delete the Forge app, they’re gone. Export a zip to keep them.');
  assert(photoLossLine(false).includes('clear Safari data'), 'web');
  for (const f of ['js/photos/settings.js', 'js/screens/photos.js']) {
    const s = src(f);
    assert(s.includes('photoLossLine(isNative())') && !s.includes('clear Safari data'), f);
  }
});

test('photos: when storage is not available the Body card says so instead of rendering nothing', () => {
  const h = photosUnavailableHtml();
  assert(h.includes('Photos can’t be saved here') && h.includes('data-photos-unavailable'), h);
  const c = src('js/photos/cards.js');
  assert(/if \(!ok\) \{\s*host\.innerHTML = photosUnavailableHtml\(\);/.test(c), 'wired in');
});

test('Train: location chips stay on one line with an ellipsis', () => {
  const css = src('css/app.css');
  const span = css.slice(idx(css, '.chip span {'), idx(css, '.chip input:checked'));
  assert(span.includes('white-space: nowrap') && span.includes('text-overflow: ellipsis') && span.includes('overflow: hidden') && span.includes('max-width: 100%'), span);
  assert(/\.chip \{[^}]*min-width: 0/.test(css), 'chip can shrink');
});

test('Settings: the iPhone app hides the demo-photo download (media/ is bundled)', () => {
  assert(src('js/ui/photos.js').includes('bundled: true') && src('js/ui/photos.js').includes('isNative()'), 'photoStatus knows');
  assert(src('js/screens/settings.js').includes('st.bundled'), 'settings hides it');
});

test('Today: macro tiles show eaten / target under a "Today of target" label, with thousands separators', () => {
  const h = macroTilesHtml({ protein_g: 110.4, carbs_g: 1234, fat_g: 0 }, { proteinG: 181, carbG: 1500, fatG: 58 });
  assert(h.includes('Today of target'), 'label');
  const flat = h.replace(/\u00a0/g, " ");
  assert(flat.includes('<b data-eaten>110</b><small data-target>/ 181 g</small>'), 'eaten and target are separate elements');
  assert(flat.includes('<b data-eaten>1,234</b><small data-target>/ 1,500 g</small>') && flat.includes('<b data-eaten>0</b><small data-target>/ 58 g</small>'), 'thousands and zero');
  assert(/\.food-targets b \{ font-size: calc\(20px/.test(src("css/food.css")) && /\.food-targets small \{ font-size: calc\(13px/.test(src("css/food.css")), "eaten big, target at 13px");
  assert(h.includes('Carbs 1,234 of 1,500 grams'), 'aria matches');
});

test('Photos: the "can’t save" line has no stray spaces and names the right place', () => {
  const web = photosUnavailableLine(false);
  const app = photosUnavailableLine(true);
  eq(app, 'Photos can’t be saved on this iPhone right now.');
  assert(web.includes('in this browser right now (private') && !web.includes('  ') && !web.includes(' .'), 'web wording');
  assert(!app.includes('browser') && !app.includes('  ') && !app.includes(' .'), 'native wording');
});

test('Progress photos card sits after Measures on Body, and the Progress tour step points at the new tab', () => {
  const b = src('js/screens/body.js');
  assert(idx(b, '${goalPathCard()}') < idx(b, 'data-photos-slot'), 'photos after goal path');
  const step = TOUR_STEPS.find((x) => x.id === 'progress');
  assert(step.target.includes('#/score'), 'tour target');
});

test('rings: a refresh starts from where the arcs were; the first draw starts empty', () => {
  const from = new Map([['training', 120.5]]);
  eq(startOffset(from, 'training', 300), 120.5);
  eq(startOffset(from, 'calories', 300), 300, 'new arc grows from empty');
  eq(startOffset(null, 'training', 300), 300, 'first draw of a visit');
  const t = src('js/screens/today.js');
  assert(t.indexOf('snapshotRings') < t.indexOf('el.innerHTML = `'), 'arcs are read before the screen redraws');
  assert(t.includes('rings, weekOf(new Date().toISOString()), ringsBefore)'), 'and passed to animateRings');
});
