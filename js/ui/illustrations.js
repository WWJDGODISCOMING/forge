// Spot illustrations for empty states. 120x96, 2 px round strokes, currentColor line work plus one --accent-text shape.
// --accent-text is the lime in dark and a darker green in light, so the accent stays legible on white.
const A = 'var(--accent-text)';
const wrap = (body) => `<svg class="es-svg" viewBox="0 0 120 96" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const ART = {
  // Phone with a figure posing and two sparkles
  photos: `<rect x="38" y="8" width="44" height="80" rx="9"/><path d="M55 14h10"/>
    <circle cx="60" cy="29" r="5" fill="currentColor" fill-opacity=".12"/>
    <path d="M47 30v6a5 5 0 0 0 5 5h16a5 5 0 0 0 5-5v-6"/>
    <path d="M54 41l2 19h8l2-19z" fill="currentColor" fill-opacity=".12"/><path d="M57 60v16M63 60v16"/>
    <path d="M50 80h20" stroke-opacity=".5"/>
    <path d="M97 21q1.05 5.95 7 7q-5.95 1.05-7 7q-1.05-5.95-7-7q5.95-1.05 7-7z" stroke="${A}" fill="${A}" fill-opacity=".25"/>
    <path d="M26 50q.6 3.4 4 4q-3.4.6-4 4q-.6-3.4-4-4q3.4-.6 4-4z" stroke="${A}" stroke-width="1.5"/>`,
  // Plate, fork, knife and a leaf
  food: `<circle cx="60" cy="50" r="22" fill="currentColor" fill-opacity=".1"/><circle cx="60" cy="50" r="13"/>
    <path d="M24 28v12a4 4 0 0 0 8 0V28M28 28v44"/><path d="M96 72V28c-6 4-8 12-8 22h8"/>
    <path d="M60 50c0-7 5-11 11-11 0 7-4 11-11 11z" fill="${A}" fill-opacity=".25" stroke="${A}"/><path d="M60 50l6-6" stroke="${A}"/>`,
  // Standing figure beside a height ruler
  profile: `<path d="M82 12v72"/><path d="M82 20h8M82 32h5M82 44h8M82 56h5M82 68h8M82 80h5"/>
    <circle cx="44" cy="24" r="9" fill="currentColor" fill-opacity=".12"/>
    <path d="M30 52a14 14 0 0 1 28 0v12H30z" fill="currentColor" fill-opacity=".12"/><path d="M37 64v20M51 64v20"/>
    <path d="M62 12h14" stroke="${A}"/><path d="M66 8l-4 4 4 4" stroke="${A}"/>`,
  // Top-down smart scale with a lime display and signal arcs
  scale: `<rect x="32" y="30" width="56" height="56" rx="14" fill="currentColor" fill-opacity=".1"/>
    <rect x="49" y="37" width="22" height="9" rx="3" stroke="${A}" fill="${A}" fill-opacity=".2"/>
    <rect x="41" y="54" width="14" height="24" rx="7"/><rect x="65" y="54" width="14" height="24" rx="7"/>
    <path d="M53 22a10 10 0 0 1 14 0M47 15a19 19 0 0 1 26 0" stroke="${A}"/>`,
  // Weigh-in dots with a lime trend line
  weigh: `<path d="M24 14v66h72"/>
    <circle cx="38" cy="30" r="3.5" fill="currentColor" fill-opacity=".2"/><circle cx="52" cy="54" r="3.5" fill="currentColor" fill-opacity=".2"/>
    <circle cx="66" cy="45" r="3.5" fill="currentColor" fill-opacity=".2"/><circle cx="80" cy="69" r="3.5" fill="currentColor" fill-opacity=".2"/>
    <path d="M30 34L90 66" stroke="${A}"/>`,
};

export function illustration(name) {
  const body = Object.prototype.hasOwnProperty.call(ART, name) ? ART[name] : '';
  return body ? wrap(body) : '';
}
