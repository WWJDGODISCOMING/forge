// Spot illustrations for empty states. 120x96, 2 px round strokes, currentColor line work plus one --accent-text shape.
// --accent-text is the lime in dark and a darker green in light, so the accent stays legible on white.
const A = 'var(--accent-text)';
const wrap = (body) => `<svg class="es-svg" viewBox="0 0 120 96" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const ART = {
  // Phone with a pose ghost and a sparkle
  photos: `<rect x="38" y="8" width="44" height="80" rx="9"/><path d="M55 14h10"/>
    <circle cx="60" cy="36" r="6" fill="currentColor" fill-opacity=".12"/>
    <path d="M50 70v-9a10 10 0 0 1 20 0v9" fill="currentColor" fill-opacity=".12"/>
    <path d="M97 22v14M90 29h14" stroke="${A}"/><path d="M26 50v8M22 54h8" stroke="${A}" stroke-width="1.5"/>`,
  // Plate, fork, knife and a leaf
  food: `<circle cx="60" cy="50" r="22" fill="currentColor" fill-opacity=".1"/><circle cx="60" cy="50" r="13"/>
    <path d="M24 28v12a4 4 0 0 0 8 0V28M28 28v44"/><path d="M96 72V28c-6 4-8 12-8 22h8"/>
    <path d="M60 50c0-7 5-11 11-11 0 7-4 11-11 11z" fill="${A}" fill-opacity=".25" stroke="${A}"/><path d="M60 50l6-6" stroke="${A}"/>`,
  // Standing figure beside a height ruler
  profile: `<path d="M90 12v72"/><path d="M90 20h8M90 32h5M90 44h8M90 56h5M90 68h8M90 80h5"/>
    <circle cx="52" cy="24" r="9" fill="currentColor" fill-opacity=".12"/>
    <path d="M38 52a14 14 0 0 1 28 0v12H38z" fill="currentColor" fill-opacity=".12"/><path d="M45 64v20M59 64v20"/>
    <path d="M70 12h16" stroke="${A}"/><path d="M78 8l-4 4 4 4" stroke="${A}"/>`,
  // Smart scale with a lime display and signal arcs
  scale: `<rect x="26" y="40" width="68" height="40" rx="12" fill="currentColor" fill-opacity=".1"/>
    <rect x="46" y="50" width="28" height="12" rx="4" stroke="${A}" fill="${A}" fill-opacity=".2"/>
    <path d="M44 72h32"/><path d="M48 28a17 17 0 0 1 24 0M42 21a26 26 0 0 1 36 0" stroke="${A}"/>`,
};

export function illustration(name) {
  const body = Object.prototype.hasOwnProperty.call(ART, name) ? ART[name] : '';
  return body ? wrap(body) : '';
}
