import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';

const css = readFileSync(new URL('../css/tokens.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
const light = css.indexOf('prefers-color-scheme: light');

test('elevation: base/raised/floating defined in dark and light blocks', () => {
  for (const [name, part] of [['dark', css.slice(0, light)], ['light', css.slice(light)]]) {
    for (const t of ['base', 'raised', 'floating']) {
      assert(part.includes(`--elev-${t}:`), `--elev-${t} missing in ${name}`);
    }
  }
});

test('elevation: .card uses --elev-raised', () => {
  assert(/\.card \{[^}]*var\(--elev-raised\)/.test(app), '.card should use var(--elev-raised)');
});
