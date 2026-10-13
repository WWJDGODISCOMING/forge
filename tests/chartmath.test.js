// v0.16.5: axis year rule and dot sizing (pure).
import { test, eq } from './harness.js';
import { axisNeedsYear, dotStyle } from '../js/ui/chartmath.js';

test('axis ends: year only when the span is over ~300 days or crosses a year', () => {
  eq(axisNeedsYear('2026-10-06', '2026-10-13'), false);
  eq(axisNeedsYear('2026-01-01', '2026-10-13'), false); // 285 days, same year
  eq(axisNeedsYear('2025-10-13', '2026-10-13'), true); // 1y
  eq(axisNeedsYear('2025-12-28', '2026-01-04'), true); // short but crosses New Year
  eq(axisNeedsYear('2026-01-01', '2026-11-01'), true); // over 300 days, same year
  eq(axisNeedsYear(null, '2026-10-13'), false);
});
test('dots: normal size up to 120 points, small and faint beyond', () => {
  eq(JSON.stringify(dotStyle(30, 2.4)), JSON.stringify({ r: 2.4, dense: false }));
  eq(JSON.stringify(dotStyle(120, 2.6)), JSON.stringify({ r: 2.6, dense: false }));
  eq(JSON.stringify(dotStyle(121, 2.6)), JSON.stringify({ r: 1.6, dense: true }));
});
