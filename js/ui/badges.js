// Badge art: code-drawn SVG medals in the Forge style. The tier sets the metal (ember bronze → steel →
// gold → white heat), the family sets the shape (hexagon: workouts, shield: records, medallion: tonnage,
// flame: streaks, diamond: everything else) and every badge has its own engraved icon. Locked badges are
// grey silhouettes; a new one gets a shine sweep. Gradients and clip shapes live once per page in a hidden
// sprite (like the muscle map), so a grid of 22 stays light.

// ---------- icons (24 × 24, filled; drawn engraved into the face) ----------
const escAttr = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const HAMMER = 'M4 3h11a2 2 0 0 1 2 2v1h4v3h-4v1a2 2 0 0 1-2 2H4z M8.5 12h3v10h-3z';
const ICONS = {
  spark: '<path d="M12 1l2.2 8.8L23 12l-8.8 2.2L12 23l-2.2-8.8L1 12l8.8-2.2z"/>',
  hammer: `<path d="${HAMMER}"/>`,
  anvil: '<path d="M1 6h16c0 3 2 5 6 5v2h-8l-2 3v2h4v3H5v-3h4v-2l-3-4C3 12 1 9.5 1 6z"/>',
  hammers: `<g transform="rotate(-38 12 12)"><path d="${HAMMER}"/></g><g transform="rotate(38 12 12) translate(24 0) scale(-1 1)"><path d="${HAMMER}"/></g>`,
  crown: '<path d="M2 7l5 4.5L12 3l5 8.5L22 7l-2 12H4z M4 20.5h16V23H4z"/>',
  ingot: '<path d="M5 14h14l3.5 7.5H1.5z M12 1.5l5.5 6.5H14v4.5h-4V8H6.5z"/>',
  trophy: '<path d="M6 2h12v6.5a6 6 0 0 1-12 0z M2.5 3H6v2.2H4.6V6c0 1 .6 2 1.6 2.4l.4 2.3A4.6 4.6 0 0 1 2.5 6z M21.5 3H18v2.2h1.4V6c0 1-.6 2-1.6 2.4l-.4 2.3A4.6 4.6 0 0 0 21.5 6z M10 14.5h4V18h3.5v4h-11v-4H10z"/>',
  columns: '<path d="M12 1l11 6H1z M2.5 8.5h3.5V19H2.5z M10.25 8.5h3.5V19h-3.5z M18 8.5h3.5V19H18z M1 20h22v3H1z"/>',
  arrows3: '<path d="M2.5 22v-7H0l4-5 4 5H5.5v7z M10.5 22V9H8l4-6.5L16 9h-2.5v13z M18.5 22v-7H16l4-5 4 5h-2.5v7z"/>',
  dumbbell: '<path d="M.5 9h3v6h-3z M4 6.5h3.2v11H4z M7.2 10.8h9.6v2.4H7.2z M16.8 6.5H20v11h-3.2z M20.5 9h3v6h-3z"/>',
  barbell: '<path d="M0 10.8h24v2.4H0z M2.5 4h3.3v16H2.5z M6.3 6.5h2.2v11H6.3z M18.2 4h3.3v16h-3.3z M15.5 6.5h2.2v11h-2.2z"/>',
  mountain: '<path d="M.5 21.5L8.5 6l3.8 6.4L15.5 8l8 13.5z M8.5 6l-2 3.9 2-1 2 1z"/>',
  kettlebell: '<path d="M7.5 9.5V6.5a4.5 4.5 0 0 1 9 0v3h-2.6v-3a1.9 1.9 0 0 0-3.8 0v3z"/><circle cx="12" cy="15.5" r="7"/>',
  flame: '<path d="M12 1c1.2 4.2 6.5 6.6 6.5 12.5a6.5 6.5 0 0 1-13 0c0-3.2 1.8-5.2 3.2-6.5 0 2.2.9 3.6 2.3 3.6C10.6 7.4 9.5 4.6 12 1z"/>',
  flame2: '<path d="M9.5 2c1 4 5.2 6 5.2 11.2a5.6 5.6 0 0 1-11.2 0c0-2.8 1.6-4.6 2.8-5.6 0 1.9.8 3.1 2 3.1-.4-3-1.3-5.6 1.2-8.7z M17.5 8c1 3 4.5 4.3 4.5 8.3a4.3 4.3 0 0 1-6.7 3.6c1.3-1.4 2-3.1 1.8-5.2.7-1.8.8-4.2.4-6.7z"/>',
  sun: '<circle cx="12" cy="12" r="5.2"/><path d="M11 0h2v4.5h-2z M11 19.5h2V24h-2z M0 11h4.5v2H0z M19.5 11H24v2h-4.5z M3.2 4.6l1.4-1.4 3.2 3.2-1.4 1.4z M16.2 17.6l1.4-1.4 3.2 3.2-1.4 1.4z M3.2 19.4l3.2-3.2 1.4 1.4-3.2 3.2z M16.2 6.4l3.2-3.2 1.4 1.4-3.2 3.2z"/>',
  body: '<circle cx="12" cy="3.4" r="2.6"/><path d="M6.8 7h10.4l3.3 7.3-2.1 1-2.6-4.6V15l1.6 8h-2.7L12 17.2 9.3 23H6.6l1.6-8v-4.3l-2.6 4.6-2.1-1z"/>',
  leaf: '<path d="M21 2C10 2.5 4 8.5 4 15c0 1.8.5 3.3 1.4 4.5L2.5 22.4l1.4 1.2 2.8-2.9c1.3.8 2.8 1.2 4.4 1.2C17.5 21.9 21.7 15 21 2z M7.5 19.5c2.5-4.5 5.8-8.5 10-11.5-3.3 3.6-6 7.5-8.2 12.2z"/>',
  return: '<path d="M12.5 4a8.5 8.5 0 1 1-8.5 8.5h3.2a5.3 5.3 0 1 0 5.3-5.3V11L6.7 5.6 12.5.2z"/>',
  sunrise: '<path d="M5.5 17a6.5 6.5 0 0 1 13 0z M1 18.5h22V21H1z M11 4.5h2V10h-2z M2.8 9.2l1.5-1.5 3.3 3.3-1.5 1.5z M16.4 11l3.3-3.3 1.5 1.5-3.3 3.3z"/>',
  moon: '<path d="M14.5 2a10.2 10.2 0 1 0 7.6 15.4A8.2 8.2 0 0 1 14.5 2z M19 2.5l.9 1.9 1.9.9-1.9.9L19 8.1l-.9-1.9-1.9-.9 1.9-.9z"/>',
  scale: '<path d="M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M12 6a5.5 5.5 0 0 0-5.5 4.6h11A5.5 5.5 0 0 0 12 6z" fill-rule="evenodd"/>',
  target: '<path fill-rule="evenodd" d="M12 1.5a10.5 10.5 0 1 0 0 21 10.5 10.5 0 0 0 0-21z M12 5.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>',
  drop: '<path d="M12 1.5c3.2 4.4 7 8.3 7 12.8a7 7 0 0 1-14 0c0-4.5 3.8-8.4 7-12.8z"/>',
  plus: '<path d="M9.5 2h5v7.5H22v5h-7.5V22h-5v-7.5H2v-5h7.5z"/>',
  strike: `<g transform="rotate(-32 11 12) translate(-2 -1)"><path d="${HAMMER}"/></g><path d="M18.5 16.5l1.1 2.3 2.4 1.1-2.4 1.1-1.1 2.4-1.1-2.4-2.3-1.1 2.3-1.1z M21.5 10.5l.7 1.4 1.4.7-1.4.7-.7 1.4-.7-1.4-1.4-.7 1.4-.7z"/>`,
};

// ---------- per badge: tier (1 ember, 2 steel, 3 gold, 4 white heat), shape, icon, optional number ----------
export const BADGE_ART = {
  first: { tier: 1, shape: 'hex', icon: 'spark' },
  w10: { tier: 1, shape: 'hex', icon: 'hammer', n: '10' },
  w50: { tier: 2, shape: 'hex', icon: 'anvil', n: '50' },
  w100: { tier: 3, shape: 'hex', icon: 'hammers', n: '100' },
  w250: { tier: 4, shape: 'hex', icon: 'crown', n: '250' },
  pr1: { tier: 1, shape: 'shield', icon: 'ingot' },
  pr3: { tier: 2, shape: 'shield', icon: 'arrows3' },
  pr10: { tier: 2, shape: 'shield', icon: 'trophy', n: '10' },
  pr50: { tier: 3, shape: 'shield', icon: 'columns', n: '50' },
  vol1: { tier: 1, shape: 'round', icon: 'dumbbell', n: '10 t' },
  big: { tier: 2, shape: 'round', icon: 'kettlebell' },
  vol2: { tier: 3, shape: 'round', icon: 'barbell', n: '100 t' },
  vol3: { tier: 4, shape: 'round', icon: 'mountain', n: '1000 t' },
  st4: { tier: 1, shape: 'flame', icon: 'flame', n: '4' },
  st12: { tier: 2, shape: 'flame', icon: 'flame2', n: '12' },
  st26: { tier: 3, shape: 'flame', icon: 'sun', n: '26' },
  full: { tier: 2, shape: 'diamond', icon: 'body' },
  deload: { tier: 1, shape: 'diamond', icon: 'leaf' },
  comeback: { tier: 1, shape: 'diamond', icon: 'return' },
  dawn: { tier: 1, shape: 'diamond', icon: 'sunrise' },
  night: { tier: 2, shape: 'diamond', icon: 'moon' },
  lv11: { tier: 3, shape: 'diamond', icon: 'strike', n: '11' },
  wi7: { tier: 1, shape: 'flame', icon: 'scale', n: '7' },
  wi30: { tier: 2, shape: 'flame', icon: 'scale', n: '30' },
  wi100: { tier: 3, shape: 'flame', icon: 'scale', n: '100' },
  bf1: { tier: 1, shape: 'round', icon: 'drop', n: '−1' },
  bf2: { tier: 2, shape: 'round', icon: 'drop', n: '−2' },
  bf5: { tier: 3, shape: 'round', icon: 'drop', n: '−5' },
  perfectweek: { tier: 4, shape: 'round', icon: 'spark', n: '7/7' }, // drawn by perfectWeekMedal() instead
  lean1: { tier: 2, shape: 'shield', icon: 'plus', n: '+1 kg' },
  pg_cut4: { tier: 2, shape: 'shield', icon: 'target', n: '4 wk' },
  pg_recomp8: { tier: 3, shape: 'hex', icon: 'barbell', n: '8 wk' },
  pg_maintain4: { tier: 2, shape: 'round', icon: 'return', n: '4 wk' },
};
export const TIER_NAMES = { 1: 'Ember', 2: 'Steel', 3: 'Gold', 4: 'White heat' };

// Shapes in a 64 × 64 box.
const SHAPES = {
  hex: 'M32 2.5l26 15v29l-26 15-26-15v-29z',
  shield: 'M32 2.5l25 8.2V30c0 16-10.8 26.6-25 31.5C17.8 56.6 7 46 7 30V10.7z',
  round: 'M32 2.5a29.5 29.5 0 1 1 0 59 29.5 29.5 0 1 1 0-59z',
  flame: 'M32 1.5c6 9.5 25 17.5 25 37.5A25 23.5 0 0 1 7 39c0-11.5 6.5-18.5 12-23 .6 5 2.8 8 6 9.5C24 17 25.5 9 32 1.5z',
  diamond: 'M32 1.5l30.5 30.5L32 62.5 1.5 32z',
};
// rim (outer) and face (inner) gradient stops, and the engraving colour, per tier
const METAL = {
  1: { rim: ['#ffc48a', '#c2672a', '#6e2c0c'], face: ['#ffb36a', '#d9702c', '#8d3a12'], ink: '#3a1505', glow: 'rgba(255,106,43,.35)' },
  2: { rim: ['#f4f7fa', '#9aa6b2', '#454e58'], face: ['#e3e9ef', '#a9b4bf', '#5f6a76'], ink: '#1b222a', glow: 'rgba(170,200,230,.3)' },
  3: { rim: ['#fff1b8', '#e3a72e', '#7d4f0c'], face: ['#ffe58a', '#f0b43a', '#a8691a'], ink: '#4a2c04', glow: 'rgba(255,201,77,.45)' },
  4: { rim: ['#ffffff', '#ffd59a', '#ff6a2b'], face: ['#fffdf6', '#ffe7bd', '#ffb067'], ink: '#7a2a06', glow: 'rgba(255,140,60,.7)' },
};

let sprite = false;
function ensureSprite() {
  if (sprite || typeof document === 'undefined') return;
  sprite = true;
  const grad = (id, [a, b, c], x2 = 0.35, y2 = 1) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`;
  const defs = [
    ...Object.entries(METAL).flatMap(([t, m]) => [grad(`bdg-rim-${t}`, m.rim), grad(`bdg-face-${t}`, m.face, 0.75, 0.9)]),
    ...Object.entries(SHAPES).map(([k, d]) => `<clipPath id="bdg-clip-${k}"><path d="${d}"/></clipPath>`),
    '<linearGradient id="bdg-shine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>',
  ].join('');
  const host = document.createElement('div');
  host.innerHTML = `<svg aria-hidden="true" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden"><defs>${defs}</defs></svg>`;
  document.body.prepend(host.firstChild);
}

/**
 * One badge as SVG markup.
 *   earned  false → grey silhouette   shine  true → a light sweeps across once (new badges)
 */
export function badgeSVG(id, { earned = true, shine = false, size = 64, label = '', units = 'imperial' } = {}) {
  if (id === 'perfectweek') return perfectWeekMedal({ earned, shine, size, label });
  ensureSprite();
  const a = { ...(BADGE_ART[id] || { tier: 1, shape: 'round', icon: 'spark' }) };
  if (id === 'lean1') a.n = units === 'metric' ? '+1 kg' : '+2 lb'; // the 1 kg goal, in the user's units
  const m = METAL[a.tier];
  const d = SHAPES[a.shape];
  const icon = ICONS[a.icon] || ICONS.spark;
  // Icon box: 24 units scaled to ~26 px, nudged up when a number banner sits underneath.
  const iy = a.n ? 15 : 19;
  const banner = a.n ? `
    <g class="bdg-n"><rect x="${32 - (6 + a.n.length * 3.2)}" y="43" width="${12 + a.n.length * 6.4}" height="11" rx="3" fill="${m.ink}" opacity=".82"/>
    <text x="32" y="51.4" text-anchor="middle" font-size="8.6" font-weight="800" fill="${m.face[0]}" font-family="system-ui,-apple-system,sans-serif">${a.n}</text></g>` : '';
  return `<svg class="bdg ${earned ? 'bdg-on' : 'bdg-locked'} ${shine && earned ? 'bdg-new' : ''} bdg-t${a.tier}" viewBox="0 0 64 64" width="${size}" height="${size}" style="--bdg-glow:${m.glow}" ${label ? `role="img" aria-label="${escAttr(label)}"` : 'aria-hidden="true"'}>
    <path d="${d}" fill="url(#bdg-rim-${a.tier})"/>
    <path d="${d}" fill="url(#bdg-face-${a.tier})" transform="translate(32 32) scale(.8) translate(-32 -32)"/>
    <path d="${d}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.2" transform="translate(32 32) scale(.8) translate(-32 -32)"/>
    <g transform="translate(${32 - 13} ${iy}) scale(1.083)">
      <g fill="#fff" fill-opacity=".38" transform="translate(-.5 -.6)">${icon}</g>
      <g fill="${m.ink}" fill-opacity=".85">${icon}</g>
    </g>${banner}
    <g clip-path="url(#bdg-clip-${a.shape})"><path class="bdg-shine" d="M-26 -4h14l-22 72h-14z" fill="url(#bdg-shine)"/></g>
  </svg>`;
}

// ---------- the Perfect Week medal: the Forge mark (barbell and pulse) in lime and steel, with a seven-segment ring ----------
let medalN = 0;
/**
 * The Perfect Week medal as SVG markup. Self-contained (own gradients), so it also draws to a canvas for the share card.
 *   earned false → grey silhouette   shine true → the light sweep runs (the page animates .bdg-shine; skip it for canvas)
 */
export function perfectWeekMedal({ earned = true, shine = false, size = 64, label = '' } = {}) {
  const k = `pwm${++medalN}`;
  const volt = earned ? '#C6FF3D' : '#6b7480';
  const steel = earned ? ['#f4f7fa', '#9aa6b2', '#454e58'] : ['#cfd5db', '#8e97a1', '#4a525b'];
  const seg = 20.4; // seven arcs round r = 26.5 (circumference 166.5), one per day
  const gap = 166.5 / 7 - seg;
  const plate = (x) => `<rect x="${x}" y="19.5" width="4" height="19" rx="1.2" fill="url(#${k}-s)"/><rect x="${x < 32 ? x + 4.6 : x - 3.4}" y="22.5" width="2.8" height="13" rx="1" fill="url(#${k}-s)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="bdg pw-medal-svg ${earned ? 'bdg-on' : 'bdg-locked'} ${shine && earned ? 'bdg-new' : ''}" viewBox="0 0 64 64" width="${size}" height="${size}" style="--bdg-glow:rgba(198,255,61,.45)" ${label ? `role="img" aria-label="${escAttr(label)}"` : 'aria-hidden="true"'}>
    <defs>
      <linearGradient id="${k}-r" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="${steel[0]}"/><stop offset=".55" stop-color="${steel[1]}"/><stop offset="1" stop-color="${steel[2]}"/></linearGradient>
      <linearGradient id="${k}-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#aeb9c4"/><stop offset="1" stop-color="#5d6773"/></linearGradient>
      <radialGradient id="${k}-f" cx=".5" cy=".4" r=".75"><stop offset="0" stop-color="#2a323c"/><stop offset="1" stop-color="#0b0e12"/></radialGradient>
      <linearGradient id="${k}-h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <clipPath id="${k}-c"><circle cx="32" cy="32" r="30"/></clipPath>
    </defs>
    <circle cx="32" cy="32" r="30" fill="url(#${k}-r)"/>
    <circle cx="32" cy="32" r="23.6" fill="url(#${k}-f)"/>
    <circle cx="32" cy="32" r="26.5" fill="none" stroke="${volt}" stroke-width="2.6" stroke-dasharray="${seg} ${gap.toFixed(2)}" stroke-linecap="butt" transform="rotate(-90 32 32)"/>
    <rect x="15" y="28.4" width="34" height="2.4" rx="1.2" fill="url(#${k}-s)"/>
    ${plate(13.5)}${plate(46.5)}
    <polyline points="18,29.6 25,29.6 28,22.5 32,36.5 35.5,25 38,29.6 46,29.6" fill="none" stroke="${volt}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="22.5" y="41.5" width="19" height="9" rx="3" fill="#0b0e12" stroke="${volt}" stroke-width=".9"/>
    <text x="32" y="48.5" text-anchor="middle" font-size="7.4" font-weight="900" fill="${volt}" font-family="system-ui,-apple-system,sans-serif">7/7</text>
    ${shine && earned ? `<g clip-path="url(#${k}-c)"><path class="bdg-shine" d="M-26 -4h14l-22 72h-14z" fill="url(#${k}-h)"/></g>` : ''}
  </svg>`;
}
