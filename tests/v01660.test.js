// v0.16.60 (#197): the You label moves to the side of its cell away from the You dot. Synthetic readings only.
import { test, assert } from './harness.js';
import { bodyProfile } from '../js/health/bodyprofile.js';
import { bodyProfileHtml } from '../js/health/cards.js';

const doc = (day, fat, ffm) => ({ id: day, day, metrics: { weight_kg: fat + ffm, fat_mass_kg: fat, fat_free_mass_kg: ffm } });

test('You label sits on the side of the cell away from the dot', () => {
  for (const fat of [8, 12, 16, 20, 25]) {
    const p = bodyProfile({ measures: [doc('2026-10-23', fat, 64)], heightM: 1.8, sex: 'male' });
    const html = bodyProfileHtml(p, { sex: 'male', age: 30 });
    const frac = p.y - (3 - p.row);
    const up = /class="bp-you up"/.test(html);
    assert(up === frac > 0.5, `fat ${fat}: dot at ${frac.toFixed(2)} down the cell, label up=${up}`);
  }
});
