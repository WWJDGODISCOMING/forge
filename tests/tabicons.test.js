import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const nav = html.slice(html.indexOf('<nav id="nav"'), html.indexOf('</nav>'));
const links = [...nav.matchAll(/<a href="([^"]+)">(.*?)<\/a>/g)];

test('tab icons: five tabs, same names and order', () => {
  assert(links.length === 5, `expected 5 tabs, got ${links.length}`);
  const labels = links.map((m) => (m[2].match(/<span>(.*?)<\/span>/) || [])[1]);
  assert(labels.join(',') === 'Today,Train,Food,Body,Progress', labels.join(','));
});

test('tab icons: each tab has one outline and one filled svg on a 24 grid', () => {
  for (const [, href, inner] of links) {
    for (const cls of ['ic-off', 'ic-on']) {
      const svgs = [...inner.matchAll(new RegExp(`<svg class="${cls}"([^>]*)>`, 'g'))];
      assert(svgs.length === 1, `${href} ${cls}: expected 1 svg, got ${svgs.length}`);
      assert(svgs[0][1].includes('viewBox="0 0 24 24"'), `${href} ${cls}: viewBox`);
      assert(svgs[0][1].includes('aria-hidden="true"'), `${href} ${cls}: aria-hidden`);
    }
  }
});

test('tab icons: filled glyphs are real fills, not fat strokes', () => {
  for (const [, href, inner] of links) {
    const on = inner.match(/<svg class="ic-on".*?<\/svg>/)[0];
    assert(!/stroke-width/.test(on), `${href}: ic-on uses stroke-width`);
  }
});
