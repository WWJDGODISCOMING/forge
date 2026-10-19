import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';
import { dragAxis, shouldClosePhoto, pastThreshold, dragOffset, dragScale, containRect, morphFrame } from '../js/photos/viewmath.js';

const viewer = readFileSync(new URL('../js/photos/viewer.js', import.meta.url), 'utf8');
const screen = readFileSync(new URL('../js/screens/photos.js', import.meta.url), 'utf8');
const near = (a, b, e = 0.01) => Math.abs(a - b) < e;

test('shouldClosePhoto: distance and velocity thresholds', () => {
  assert(!shouldClosePhoto({ dy: 100, velocity: 0.2 }), 'short slow drag springs back');
  assert(shouldClosePhoto({ dy: 130, velocity: 0 }), 'past 120 px closes');
  assert(shouldClosePhoto({ dy: 40, velocity: 0.9 }), 'fast flick down closes');
  assert(!shouldClosePhoto({ dy: 40, velocity: 0.7 }), 'slow flick does not');
  assert(!shouldClosePhoto({ dy: -200, velocity: -1 }), 'up never closes');
  assert(!shouldClosePhoto({ dy: 5, velocity: 2 }), 'a tiny move never closes');
});

test('horizontal drags are ignored', () => {
  assert(dragAxis(2, 3) === null, 'undecided under the slop');
  assert(dragAxis(30, 10) === 'h' && dragAxis(5, 30) === 'v', 'axis lock');
  assert(!shouldClosePhoto({ dx: 200, dy: 150, velocity: 1 }), 'mostly sideways does not close');
});

test('drag feel: 1:1 down, resisted up, scale to 0.85, one threshold', () => {
  assert(dragOffset(50) === 50 && dragOffset(-50) === -10, 'offset');
  assert(dragScale(0) === 1 && near(dragScale(300), 0.85) && near(dragScale(900), 0.85), 'scale');
  assert(!pastThreshold(120) && pastThreshold(121), 'threshold');
});

test('containRect: portrait and landscape in a phone and a Duo box', () => {
  const phone = { left: 0, top: 100, width: 390, height: 600 };
  const p = containRect(3000, 4000, phone); // portrait 3:4
  assert(near(p.width, 390) && near(p.height, 520) && near(p.top, 140) && near(p.left, 0), 'portrait fits width');
  const l = containRect(4000, 3000, phone);
  assert(near(l.width, 390) && near(l.height, 292.5) && near(l.top, 253.75), 'landscape centred');
  const duo = { left: 0, top: 60, width: 890, height: 500 }; // wide: ~1.8:1 box
  const d = containRect(3000, 4000, duo);
  assert(near(d.height, 500) && near(d.width, 375) && near(d.left, 257.5), 'portrait fits height on the wide screen');
  const w = containRect(4000, 2860, { left: 0, top: 0, width: 700, height: 500 }); // ~1.4:1
  assert(near(w.width, 699.3, 1) && w.height <= 500, 'about 1.4:1 stays inside');
  const z = containRect(0, 0, phone);
  assert(z.width === 390, 'unknown size falls back to the box');
});

test('morphFrame: starts on the thumb, ends exactly full, never squashes', () => {
  const full = containRect(3000, 4000, { left: 0, top: 100, width: 390, height: 600 }); // 390x520 at y=140
  const thumb = { left: 20, top: 400, width: 100, height: 100 };
  const a = morphFrame(thumb, full, 0);
  // the visible clip box, scaled and moved, should equal the thumb rect
  const w = (full.width - 2 * a.insetX) * a.scale;
  const h = (full.height - 2 * a.insetY) * a.scale;
  assert(near(w, 100, 0.05) && near(h, 100, 0.05), 'visible size = thumb size');
  assert(near(full.left + full.width / 2 + a.tx, 70) && near(full.top + full.height / 2 + a.ty, 450), 'centred on the thumb');
  assert(near(a.radius * a.scale, 12), 'thumb radius');
  const b = morphFrame(thumb, full, 1);
  assert(b.scale === 1 && b.tx === 0 && b.ty === 0 && b.insetX === 0 && b.insetY === 0 && b.radius === 0, 'ends full, square');
  const mid = morphFrame(thumb, full, 0.5);
  assert(mid.scale > a.scale && mid.scale < 1, 'one uniform scale');
});

test('viewer: spring-driven, reduced-motion fade, haptics, dialog, Escape', () => {
  assert(/animateSpring/.test(viewer) && /spring\.js/.test(viewer), 'uses the spring engine');
  assert(/prefers-reduced-motion: reduce/.test(viewer) && /calm/.test(viewer) && /opacity \.15s/.test(viewer), 'reduced motion fades');
  assert(/haptics\.light\(\)/.test(viewer) && /haptics\.select\(\)/.test(viewer), 'haptics');
  assert(/role', 'dialog'/.test(viewer) && /aria-modal/.test(viewer) && /aria-label="Close"/.test(viewer), 'dialog and close button');
  assert(/Escape/.test(viewer) && /findThumb/.test(viewer), 'Escape, and the thumb is looked up again');
  assert(/touch-action: pinch-zoom/.test(readFileSync(new URL('../css/photos.css', import.meta.url), 'utf8')), 'leaves pinch free');
});

test('photos screen: opens the viewer, and Delete still needs the confirm', () => {
  assert(/openViewer\(/.test(screen) && !/class="pp-full"/.test(screen), 'viewer replaces the sheet');
  const del = screen.slice(screen.indexOf('onDelete'));
  assert(del.indexOf('confirmSheet') > -1 && del.indexOf('confirmSheet') < del.indexOf('store.remove'), 'confirm comes before remove');
  assert(/if \(!yes\) return;/.test(del), 'declining stops the delete');
});
