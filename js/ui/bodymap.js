// Front/back muscle map (SVG). Path data: js/ui/bodymap-data.js (MIT, react-native-body-highlighter v3.2.0).
// Used for the recovery heatmap (Body tab), muscles worked (summary), the workout preview and exercise
// cards (mini), and the How-To sheet's Target tab.
import { FRONT, BACK } from './bodymap-data.js';

const VIEWBOX = { front: '0 0 724 1448', back: '724 0 724 1448' };

// Forge muscle → the map's regions ([side, slug]). Per the brief: front and side delts on the front
// deltoids, rear delts on the back deltoids, lats on upper-back, abductors on gluteal.
export const MUSCLE_REGIONS = {
  chest: [['front', 'chest']],
  front_delts: [['front', 'deltoids']],
  side_delts: [['front', 'deltoids']],
  rear_delts: [['back', 'deltoids']],
  lats: [['back', 'upper-back']],
  upper_back: [['back', 'upper-back']],
  traps: [['front', 'trapezius'], ['back', 'trapezius']],
  biceps: [['front', 'biceps']],
  triceps: [['front', 'triceps'], ['back', 'triceps']],
  forearms: [['front', 'forearm'], ['back', 'forearm']],
  abs: [['front', 'abs']],
  obliques: [['front', 'obliques']],
  lower_back: [['back', 'lower-back']],
  glutes: [['back', 'gluteal']],
  abductors: [['back', 'gluteal']],
  quads: [['front', 'quadriceps']],
  hamstrings: [['back', 'hamstring']],
  adductors: [['front', 'adductors'], ['back', 'adductors']],
  calves: [['front', 'calves'], ['back', 'calves']],
};

// Regions that are body, not muscle: drawn in the base colour and never tappable.
const NON_MUSCLE = new Set(['head', 'hair', 'neck', 'hands', 'feet', 'knees', 'ankles', 'tibialis']);

/**
 * Value per region on one side, from the Forge muscles drawn there: the highest by default (muscles
 * worked), or the lowest with combine = Math.min (recovery: a region is as tired as its most tired muscle).
 */
export function regionValues(values, side, combine = Math.max) {
  const out = {};
  for (const [m, v] of Object.entries(values || {})) {
    if (v == null) continue;
    for (const [sd, slug] of MUSCLE_REGIONS[m] || []) if (sd === side) out[slug] = slug in out ? combine(out[slug], v) : v;
  }
  return out;
}

/** The Forge muscles drawn in a region (for tapping a region). */
export function musclesIn(side, slug) {
  return Object.entries(MUSCLE_REGIONS).filter(([, rs]) => rs.some(([sd, s]) => sd === side && s === slug)).map(([m]) => m);
}

/** Recovery % → heatmap colour: red under 50, amber under 85, green when fresh. */
export const recoveryColor = (pct) => (pct < 50 ? '#ff4d3a' : pct < 85 ? '#ffb020' : '#36d17a');

const LABEL = {
  chest: 'Chest', obliques: 'Obliques', abs: 'Abs', biceps: 'Biceps', triceps: 'Triceps', trapezius: 'Traps', deltoids: 'Shoulders',
  adductors: 'Adductors', quadriceps: 'Quads', calves: 'Calves', forearm: 'Forearms', gluteal: 'Glutes', hamstring: 'Hamstrings',
  'lower-back': 'Lower back', 'upper-back': 'Upper back & lats',
};
export const regionLabel = (slug) => LABEL[slug] || slug;

// Path data lives once per page in a hidden sprite; every map just <use>s it, so a screen full of
// mini maps stays light.
let sprite = false;
function ensureSprite() {
  if (sprite || typeof document === 'undefined') return;
  sprite = true;
  const defs = [['front', FRONT, 'f'], ['back', BACK, 'b']]
    .map(([, parts, k]) => parts.map(([slug, paths]) => `<g id="bm-${k}-${slug}">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>`).join(''))
    .join('');
  const host = document.createElement('div');
  host.innerHTML = `<svg aria-hidden="true" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden"><defs>${defs}</defs></svg>`;
  document.body.prepend(host.firstChild);
}

/**
 * One side of the body as an SVG string.
 *   fill(slug) → { color, opacity } or null for the base colour.
 *   tappable   → muscle regions get role=button, tabindex and data-region="side:slug".
 */
export function bodySide(side, { fill = () => null, tappable = false, label = '', cls = '' } = {}) {
  ensureSprite();
  const parts = side === 'front' ? FRONT : BACK;
  const k = side === 'front' ? 'f' : 'b';
  const body = parts.map(([slug]) => {
    const muscle = !NON_MUSCLE.has(slug);
    const f = muscle ? fill(slug) : null;
    const style = f ? ` style="--bm-c:${f.color};--bm-o:${(f.opacity ?? 1).toFixed(2)}"` : '';
    const attrs = muscle && tappable ? ` role="button" tabindex="0" data-region="${side}:${slug}" aria-label="${regionLabel(slug)}"` : '';
    const klass = muscle ? (f ? 'bm-m bm-on' : 'bm-m') : 'bm-b';
    return `<use href="#bm-${k}-${slug}" class="${klass}"${style}${attrs}/>`;
  }).join('');
  return `<svg class="bodymap ${cls}" viewBox="${VIEWBOX[side]}" role="img" aria-label="${label || `Muscle map, ${side}`}">${body}</svg>`;
}

/**
 * Front and back side by side.
 *   values: Forge muscle → number. mode 'intensity' (0..1, ember accent) or 'recovery' (0..100 %, red/amber/green).
 */
export function bodyMap(values, { mode = 'intensity', tappable = false, size = '', caption = true } = {}) {
  // Mini maps show one side: whichever shows more of the work.
  let which = ['front', 'back'];
  if (size === 'mini') {
    const sum = (side) => Object.values(regionValues(values, side)).reduce((a, b) => a + b, 0);
    which = [sum('back') > sum('front') ? 'back' : 'front'];
  }
  const sides = which.map((side) => {
    const rv = regionValues(values, side, mode === 'recovery' ? Math.min : Math.max);
    const fill = (slug) => {
      const v = rv[slug];
      if (v == null || (mode === 'intensity' && v <= 0)) return null;
      return mode === 'recovery' ? { color: recoveryColor(v), opacity: 0.9 } : { color: '#3EC8F0', opacity: Math.max(0.2, Math.min(1, v)) };
    };
    return `<figure class="bm-side">${bodySide(side, { fill, tappable, label: `Muscle map, ${side}` })}${caption ? `<figcaption>${side === 'front' ? 'Front' : 'Back'}</figcaption>` : ''}</figure>`;
  });
  return `<div class="bm ${size ? `bm-${size}` : ''} bm-${mode}">${sides.join('')}</div>`;
}

/** Muscles an exercise works → map values (primary 1, secondary 0.45). */
export function exerciseValues(ex) {
  const v = {};
  for (const m of ex.secondary || []) v[m] = 0.45;
  for (const m of ex.primary || []) v[m] = 1;
  return v;
}

/**
 * Front and back as one self-contained SVG string (no sprite references), for drawing into a canvas
 * (the share card). values/mode as for bodyMap().
 */
export function bodyMapStandalone(values, { mode = 'intensity', base = '#1F3142', muscle = '#2A3F54' } = {}) {
  const side = (parts, sd) => {
    const rv = regionValues(values, sd, mode === 'recovery' ? Math.min : Math.max);
    return parts.map(([slug, paths]) => {
      let fill = NON_MUSCLE.has(slug) ? base : muscle;
      let op = 1;
      const v = rv[slug];
      if (!NON_MUSCLE.has(slug) && v != null && !(mode === 'intensity' && v <= 0)) {
        fill = mode === 'recovery' ? recoveryColor(v) : '#3EC8F0';
        op = mode === 'recovery' ? 0.9 : Math.max(0.25, Math.min(1, v));
      }
      return paths.map((d) => `<path d="${d}" fill="${fill}" fill-opacity="${op}" stroke="#172430" stroke-width="2"/>`).join('');
    }).join('');
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1448 1448" width="1448" height="1448">${side(FRONT, 'front')}${side(BACK, 'back')}</svg>`;
}
