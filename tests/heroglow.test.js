import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';

const read = (f) => readFileSync(new URL(`../css/${f}`, import.meta.url), 'utf8');
const tokens = read('tokens.css');
const light = tokens.indexOf('prefers-color-scheme: light');

test('hero glow: token defined in dark and light blocks', () => {
  assert(tokens.slice(0, light).includes('--hero-glow:'), 'dark missing');
  assert(tokens.slice(light).includes('--hero-glow:'), 'light missing');
});

for (const [file, sel] of [['app.css', '.rings-hero::before'], ['health.css', '.score-hero::before']]) {
  test(`hero glow: ${sel} is static and uses the token`, () => {
    const css = read(file);
    const i = css.indexOf(`${sel} {`);
    assert(i >= 0, `${sel} missing`);
    const rule = css.slice(i, css.indexOf('}', i));
    assert(rule.includes('var(--hero-glow)'), 'should use var(--hero-glow)');
    assert(!/animation|transition|filter/.test(rule), 'glow must be static');
  });
}
