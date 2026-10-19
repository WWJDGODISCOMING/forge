// One shared checkmark that draws itself (css/motion.css .ck-draw). Reduced motion: shown already drawn.

/** SVG string. `size` in px. No ids, so several can sit on one screen. */
export function checkSvg({ size = 20 } = {}) {
  return `<svg class="ic ck-draw" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" pathLength="1"/></svg>`;
}
