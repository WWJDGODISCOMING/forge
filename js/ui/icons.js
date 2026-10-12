// One icon set for the whole app: inline SVG on a 24px grid, 1.9px stroke, round caps and joins. Icons are
// decoration (aria-hidden); the button or link that holds one carries the label. Use currentColor, so
// colour comes from the surrounding text. `filled` icons are for the active tab and trophies.

const P = {
  chev: '<path d="M9 5l7 7-7 7"/>',
  key: '<circle cx="8" cy="15.5" r="3.5"/><path d="M10.6 13L19 4.6M16 7.6l2.4 2.4M13.4 10.2l1.8 1.8"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  list: '<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.6" cy="7" r="1" fill="currentColor"/><circle cx="4.6" cy="12" r="1" fill="currentColor"/><circle cx="4.6" cy="17" r="1" fill="currentColor"/>',
  pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  bike: '<circle cx="6" cy="16" r="3.6"/><circle cx="18" cy="16" r="3.6"/><path d="M6 16l4-8h5l3 8M10 8H8M13.5 12.5H9"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/>',
  book: '<path d="M5 4.5h9.5A3.5 3.5 0 0118 8v12H8.5A3.5 3.5 0 015 16.5z"/><path d="M5 16.5A3.5 3.5 0 018.5 13H18"/>',
  chart: '<path d="M4 19V5M4 19h16"/><path d="M8 14l3-3.5 3 2 4.5-6"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4.2l2.6 1.6M9.5 3h5"/>',
  pin: '<path d="M12 21s6.5-5.7 6.5-11A6.5 6.5 0 005.5 10c0 5.3 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.2a1.5 1.5 0 001.5 1.3h6.4a1.5 1.5 0 001.5-1.3L17.5 7M10 11v6M14 11v6"/>',
  warn: '<path d="M12 4.2L2.8 19.5h18.4z"/><path d="M12 10v4.6M12 17.4v.2"/>',
  flame: '<path d="M12 21c-3.9 0-6.5-2.7-6.5-6.2 0-3 2-4.6 3.2-6.6C9.6 6.6 10 5 10 3c3.7 1.6 5.5 4.6 5.7 7.2.9-.7 1.4-1.7 1.5-2.7 1.4 1.6 1.8 3.4 1.8 5.3 0 4.4-2.8 8.2-7 8.2z"/>',
  trophy: '<path d="M8 4h8v5.5a4 4 0 01-8 0zM8 6H4.5c0 3 1.5 4.5 3.7 4.8M16 6h3.5c0 3-1.5 4.5-3.7 4.8M12 13.5V17M8.5 20h7M10 17h4"/>',
  swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  sliders: '<path d="M4 7h9M19 7h1M4 12h2M12 12h8M4 17h9M19 17h1"/><circle cx="16" cy="7" r="2.3"/><circle cx="9" cy="12" r="2.3"/><circle cx="16" cy="17" r="2.3"/>',
  scale: '<rect x="3.5" y="4" width="17" height="16" rx="4"/><path d="M8 9.5a5.5 5.5 0 018 0M12 9.8l1.6-1.8"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0112 7.6 4.3 4.3 0 0119.5 10c0 5.4-7.5 10-7.5 10z"/>',
  cloud: '<path d="M7 18.5a4.2 4.2 0 01-.6-8.3 5.6 5.6 0 0110.9 1A3.7 3.7 0 0117 18.5z"/>',
  person: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.6-3.7 3.4-5.6 7-5.6s6.4 1.9 7 5.6"/>',
  download: '<path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 20h14"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5M12 14.5v2.2"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.6a2.3 2.3 0 114 1.5c-.8.8-1.8 1.2-1.8 2.6M12 16.8v.2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  medal: '<circle cx="12" cy="14" r="5.5"/><path d="M8.5 9.5L6.5 3.5h4l1.5 3 1.5-3h4l-2 6M12 11.8l.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z"/>',
  arrowup: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowdown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  arrowright: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  flat: '<path d="M5 12h14"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 11-2.4-5.5M19.5 4.5v4h-4"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  tape: '<rect x="3" y="8" width="18" height="8" rx="2"/><path d="M7 8v3.2M11 8v4.5M15 8v3.2M19 8v4.5"/>',
  camera: '<path d="M4 8.5A2.5 2.5 0 016.5 6H8l1.3-2h5.4L16 6h1.5A2.5 2.5 0 0120 8.5v9a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 17.5z"/><circle cx="12" cy="13" r="3.6"/>',
  more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4M6 11H5.5A1.5 1.5 0 004 12.5v6A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5v-6a1.5 1.5 0 00-1.5-1.5H18"/>',
  star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
  food: '<path d="M7 3v7.5M4.5 3v5a2.5 2.5 0 005 0V3M7 10.5V21M17 21V3c-2.5 1.5-3.5 4.5-3.5 8.5H17"/>',
  moon:'<path d="M19.5 14.5A8 8 0 019.5 4.5a8 8 0 1010 10z"/>',
};

// Solid versions, for the active tab and filled trophies.
const F = {
  trophy: '<path d="M7 3.5h10v6a5 5 0 01-10 0z" fill="currentColor"/><path d="M7 5.5H3.8c0 3.4 1.7 5 4.2 5.4M17 5.5h3.2c0 3.4-1.7 5-4.2 5.4M12 14.5V17.5M8 20.5h8M9.8 17.5h4.4"/>',
  flame: '<path d="M12 21.5c-4.2 0-7-2.9-7-6.7 0-3.2 2.1-5 3.4-7C9.2 6.5 9.5 5 9.5 2.5c4 1.7 6 5 6.2 7.6 1-.7 1.5-1.8 1.6-2.9 1.5 1.7 2 3.7 2 5.6 0 4.7-3 8.7-7.3 8.7z" fill="currentColor" stroke="none"/>',
  star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z" fill="currentColor"/>',
  heart: '<path d="M12 20.5s-8-4.8-8-10.5A4.6 4.6 0 0112 7.4 4.6 4.6 0 0120 10c0 5.7-8 10.5-8 10.5z" fill="currentColor" stroke="none"/>',
  check: '<circle cx="12" cy="12" r="9.5" fill="currentColor" stroke="none"/><path d="M7.8 12.4l3 3 5.4-6" stroke="var(--bg)" stroke-width="2.2"/>',
};

/**
 * icon('chev') → '<svg class="ic" ...>'. Options: { filled, size, cls }. Unknown names return ''.
 * Decorative by default; give the surrounding control an aria-label.
 */
export function icon(name, { filled = false, size = 0, cls = '' } = {}) {
  const body = (filled && F[name]) || P[name];
  if (!body) return '';
  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg class="ic ic-${name}${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24"${dim} fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

export const ICON_NAMES = Object.keys(P);

/** Empty state: icon, one-line title, a helpful sentence and one action ({href, label} or {attr, label}). */
export function emptyState({ icon: name = 'info', title, text = '', action = null }) {
  const btn = action
    ? (action.href
      ? `<a class="btn primary" href="${action.href}">${action.label}</a>`
      : `<button class="btn primary" type="button" ${action.attr || ''}>${action.label}</button>`)
    : '';
  return `<div class="empty-state"><span class="es-icon">${icon(name)}</span><h3>${title}</h3>${text ? `<p>${text}</p>` : ''}${btn}</div>`;
}
