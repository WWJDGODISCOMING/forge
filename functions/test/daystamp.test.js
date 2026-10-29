// #248: the daily quota rolls over at local midnight (America/New_York by default), not at UTC midnight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayStamp as askDay } from '../src/askforge.js';
import { dayStamp as mealDay } from '../src/mealai.js';

for (const [name, dayStamp] of [['askforge', askDay], ['mealai', mealDay]]) {
  test(`${name} dayStamp: 23:30 ET is still that ET date`, () => {
    assert.equal(dayStamp(Date.parse('2026-10-28T03:30:00Z')), '2026-10-27'); // EDT
    assert.equal(dayStamp(Date.parse('2026-12-16T04:30:00Z')), '2026-12-15'); // EST
    assert.equal(dayStamp(Date.parse('2026-10-28T04:30:00Z')), '2026-10-28');
  });
  test(`${name} dayStamp: honours a valid tz and falls back on a bad one`, () => {
    assert.equal(dayStamp(Date.parse('2026-10-28T03:30:00Z'), 'UTC'), '2026-10-28');
    assert.equal(dayStamp(Date.parse('2026-10-28T03:30:00Z'), 'Not/AZone'), '2026-10-27');
  });
}
