// Skeleton screens: the shape of the page that's about to appear, shown while data loads (never a spinner).
// Pure strings, so they can be dropped straight into main.innerHTML.

const bar = (cls = '') => `<div class="skeleton ${cls}"></div>`;

const SHAPES = {
  today: [bar('sk-title'), bar('sk-card tall'), bar('sk-card short'), bar('sk-card')],
  train: [bar('sk-title'), bar('sk-card'), bar('sk-card short'), bar('sk-row'), bar('sk-row'), bar('sk-row')],
  progress: [bar('sk-title'), bar('sk-row'), bar('sk-card tall'), bar('sk-row'), bar('sk-row')],
  body: [bar('sk-title'), bar('sk-card'), bar('sk-card tall'), bar('sk-card short')],
  list: [bar('sk-title'), bar('sk-row'), bar('sk-row'), bar('sk-row'), bar('sk-row')],
};
const KIND = { today: 'today', train: 'train', weight: 'progress', trends: 'progress', weekly: 'progress', history: 'list', awards: 'list', score: 'progress', body: 'body', metric: 'body', withings: 'list', settings: 'list', report: 'list', photos: 'list', food: 'list' };

const WIDE = new Set(['today', 'train', 'body', 'weight', 'trends', 'weekly', 'score', 'play', 'settings']); // routes that go two-column or full-width on a wide canvas; the skeleton must claim the same width so the page doesn't jump when the screen draws

export const skeletonKind = (route) => KIND[route] || 'today';

/** Skeleton markup for a route name (e.g. 'today', 'weight', 'withings'). */
export function skeletonHTML(route) {
  return `<div class="skel-screen${WIDE.has(route) ? ' skel-wide' : ''}" aria-label="Loading"${route === 'play' ? ' data-play' : ''} role="status">${SHAPES[skeletonKind(route)].join('')}</div>`;
}
