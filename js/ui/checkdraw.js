// One shared checkmark that draws itself (css/motion.css .ck-draw). Reduced motion: shown already drawn.

/**
 * SVG string. `size` in px; `delay` in ms before the draw starts; `disc` puts the check inside the filled disc that
 * done rows use. No ids, so several can sit on one screen.
 */
export function checkSvg({ size = 20, delay = 60, disc = false } = {}) {
  const style = delay === 60 ? '' : ` style="--ck-delay:${delay}ms"`;
  const body = disc
    ? '<circle cx="12" cy="12" r="9.5" fill="currentColor" stroke="none"/><path d="M7.8 12.4l3 3 5.4-6" stroke="var(--bg)" pathLength="1"/>'
    : '<path d="M5 12.5l4.5 4.5L19 7.5" pathLength="1"/>';
  return `<svg class="ic ck-draw" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${disc ? 2.2 : 2.6}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${style}>${body}</svg>`;
}
