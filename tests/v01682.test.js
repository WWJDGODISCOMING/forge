// v0.16.82 (#233): every data screen has a page-shaped loading skeleton. Logic checks here; the browser checks are in layout.test.js.
import { test, assert, eq } from './harness.js';
import { readFileSync } from 'node:fs';
import { skeletonHTML, skeletonKind, WIDE } from '../js/ui/skeleton.js';

const SCREENS = ['today', 'trends', 'weekly', 'score', 'progress', 'history', 'photos', 'body', 'awards', 'report', 'withings', 'library', 'coach'];

test('every data screen has a skeleton with real placeholder shapes', () => {
  for (const r of SCREENS) {
    const html = skeletonHTML(r);
    assert(html.includes('class="skeleton'), `${r} has placeholder shapes`);
    assert((html.match(/class="skeleton/g) || []).length >= 4, `${r} has a title and several blocks`);
  }
});

test('the skeleton is announced as loading once: role=status, aria-busy, no live text per shape', () => {
  const html = skeletonHTML('history');
  assert(html.includes('role="status"') && html.includes('aria-busy="true"') && html.includes('aria-label="Loading"'), 'container is a busy status region');
  assert(!/aria-live|aria-label="Loading"[^>]*>[^<]*<[^>]*aria-label/.test(html), 'only the container announces');
});

test('screens that go wide claim the width in their skeleton; unknown routes fall back to Today', () => {
  for (const r of WIDE) assert(skeletonHTML(r).includes('skel-wide'), `${r} is wide`);
  assert(!skeletonHTML('history').includes('skel-wide'), 'history is the narrow column');
  eq(skeletonKind('nope'), 'today');
  eq(skeletonKind('library'), 'list');
  eq(skeletonKind('coach'), 'list');
});

test('Reduce Motion turns the shimmer off, and arriving on a screen shows its skeleton first', () => {
  const css = readFileSync(new URL('../css/motion.css', import.meta.url), 'utf8');
  assert(/prefers-reduced-motion: reduce\)[\s\S]*\.skeleton \{ animation: none; \}/.test(css), 'static placeholder under Reduce Motion');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert(/routeChanged && !main\.querySelector\('\.skel-screen'\)\) main\.innerHTML = skeletonHTML\(route\)/.test(app), 'route change draws the skeleton before the screen loads');
});
