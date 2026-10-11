// Headless layout check (v0.15.7). Boots the real app in Chromium with a synthetic account and fails when a chip, pill,
// button or label wraps or clips, a tap target is under 44 px, or content runs off-screen or under the tab bar.
// Skips (loudly) when no Chrome/Chromium is installed. GitHub's ubuntu runners have one, so CI runs it.
//   LAYOUT_ROUTES=today,body node tests/layout.test.js   → only those screens
//   LAYOUT_SHOTS=/tmp/shots                              → also save a PNG of every render
import { test, assert } from './harness.js';
import { skipReason, launch } from './layout/browser.js';
import { detect } from './layout/detect.js';
import { seed } from './layout/seed.js';

const SIZES = [[320, 568], [375, 667], [390, 844], [440, 956]];
const WIDE = [[466, 678], [678, 466], [626, 890], [890, 626]];
const ROUTES = ['play', 'today', 'train', 'body', 'weight', 'trends', 'timer', 'history', 'settings', 'apple', 'food', 'awards', 'locations', 'library'];
const arg = (k) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1] || process.env['LAYOUT_' + k.toUpperCase()];
const only = arg('routes') ? arg('routes').split(',') : null;
const shots = arg('shots');
let browser = null;

// every size in dark mode, plus light mode on the two common phones; the long-value account at 375 and 390
const CASES = [
  ...SIZES.map(([w, h]) => ({ w, h, dark: true, long: false })),
  { w: 375, h: 667, dark: false, long: false },
  ...WIDE.map(([w, h]) => ({ w, h, dark: true, long: false })), // iPhone Duo: folded (outer) and unfolded (inner), portrait and landscape
  { w: 626, h: 890, dark: false, long: true },
  { w: 375, h: 667, dark: true, long: true }, { w: 390, h: 844, dark: false, long: true },
  { w: 320, h: 568, dark: true, long: false, over: true }, { w: 390, h: 844, dark: true, long: false, over: true, ts: 1.35 }, // past every food target
  { w: 390, h: 844, dark: true, long: false, ts: 1.3 }, // iOS Text Size at ~130%: lines may wrap, but nothing may clip
];

if (arg('size')) CASES.splice(0, CASES.length, ...CASES.filter((c) => String(c.w) === arg('size')));

const standalone = !!(process.argv[1] && process.argv[1].endsWith("layout.test.js"));

for (const route of standalone ? ROUTES : []) {
  if (only && !only.includes(route)) continue;
  test(`layout: ${route} has no wraps, clips, small tap targets or overflow`, async () => {
    if (skipReason()) { console.log('      (skipped: ' + skipReason() + ')'); return; }
    browser = browser || await launch();
    const found = new Map();
    for (const c of CASES) {
      await browser.viewport(c.w, c.h, c.dark);
      await browser.open(route, seed({ long: c.long, over: c.over, active: route === 'play' }));
      const cls = await browser.eval('window.__cls || 0'); // before any text-size change
      if (c.ts) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${c.ts}')`); await new Promise((r) => setTimeout(r, 300)); }
      const probs = await browser.eval(`(${detect})(${JSON.stringify({ largeText: !!c.ts })})`);
      if (await browser.eval("!!document.querySelector('#main .skeleton')")) probs.push(`screen never finished drawing (still the loading skeleton). Page errors: ${browser.errors.slice(-3).join(' | ') || 'none'}`);
      if (shots) await browser.screenshot(`${shots}/${route}-${c.w}x${c.h}-${c.dark ? 'dark' : 'light'}${c.long ? '-long' : ''}${c.ts ? '-text' : ''}.png`);
      if (shots) {
        await browser.eval("window.scrollTo({ top: 1e6, behavior: 'instant' })");
        await browser.screenshot(`${shots}/${route}-${c.w}x${c.h}-${c.dark ? 'dark' : 'light'}${c.long ? '-long' : ''}${c.ts ? '-text' : ''}-bottom.png`);
      }
      if (cls > 0.02) probs.push(`layout shift ${cls.toFixed(3)} on first render`);
      for (const p of probs) found.set(p, [...(found.get(p) || []), `${c.w}${c.dark ? "d" : "l"}${c.long ? "L" : ""}${c.over ? "O" : ""}${c.ts ? "T" : ""}`]);
    }
    assert(found.size === 0, `\n        ${[...found].map(([p, at]) => `${p}  [${at.join(' ')}]`).join('\n        ')}`);
  });
}

for (const route of standalone ? ['today', 'train', 'body', 'weight', 'settings'] : []) {
  test(`layout: ${route}: the nav bar collapses once the large title scrolls under it, and not before`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(390, 844, true);
    await browser.open(route, seed());
    const state = async (y) => { await browser.eval(`window.scrollTo({ top: ${y}, behavior: 'instant' })`); await new Promise((r) => setTimeout(r, 350)); return browser.eval("document.getElementById('nav-bar') ? document.getElementById('nav-bar').classList.contains('collapsed') : document.querySelector('.navbar').classList.contains('collapsed')"); };
    assert((await state(0)) === false, 'expanded at the top');
    const h1 = await browser.eval("(() => { const r = (document.querySelector('.large-title h1') || document.querySelector('main h1')).getBoundingClientRect(); return r.bottom + window.scrollY; })()");
    assert((await state(Math.max(0, h1 - 120))) === false, 'still expanded while the title is below the bar');
    assert((await state(h1 + 40)) === true, 'collapsed once the title is under the bar');
  });
}

if (standalone) {
  test('layout: the Log weight label is one piece, and the workout place sits on its own line', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    for (const [w, label] of [[320, '+ Log'], [375, '+ Log weight']]) {
      await browser.viewport(w, 667, true);
      await browser.open('weight', seed());
      const got = await browser.eval("(document.querySelector('[data-log]') || {}).innerText");
      assert(got === label, `weight button reads "${got}" at ${w}, wanted "${label}"`);
    }
    for (const long of [false, true]) {
      await browser.viewport(320, 568, true);
      await browser.open('today', seed({ long }));
      const r = await browser.eval("(() => { const p = document.querySelector('[data-workout-place]'); if (!p) return null; const m = p.previousElementSibling; return { place: p.getBoundingClientRect().height < 30, dot: /·\\s*$/.test(m.innerText), lines: (() => { const rg = document.createRange(); rg.selectNodeContents(m); return new Set([...rg.getClientRects()].map((q) => Math.round(q.top / 6))).size; })() }; })()");
      if (!r) continue; // seed has no planned workout today
      assert(r.place && !r.dot && r.lines === 1, `workout meta/place wrapped badly at 320: ${JSON.stringify(r)}`);
    }
  });
}

if (standalone) {
  test('layout: Today weight card: trend line breaks only at the dot, the two actions share one row', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    for (const w of [320, 390]) for (const ts of [1, 1.35]) {
      await browser.viewport(w, w === 320 ? 568 : 844, true);
      await browser.open('today', seed());
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
      const r = await browser.eval(`(() => {
        const c = document.querySelector('.weight-card'); if (!c) return null;
        const lines = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); return new Set([...rg.getClientRects()].map((q) => Math.round(q.top / 4))).size; };
        const t = c.querySelector('[data-weight-trend]'); const why = c.querySelector('[data-weight-why]'); const log = c.querySelector('[data-log]');
        const a = why.getBoundingClientRect(), b = log.getBoundingClientRect();
        return { heading: c.querySelector('.label').innerText, tw: t ? t.getBoundingClientRect().width : 0, sw: t ? t.scrollWidth : 0, halves: t ? [...t.querySelectorAll('.nw')].map(lines) : [], whole: t ? lines(t) : 0,
          sameRow: Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) < 4, h: [a.height, b.height], over: c.scrollWidth > c.clientWidth + 1 };
      })()`);
      if (!r) continue; // no weight data in the seed
      const at = `${w}px text ${ts}`;
      assert(r.heading === 'Weight', `heading reads "${r.heading}" at ${at}`);
      assert(r.halves.every((n) => n === 1), `trend halves wrap at ${at}: ${JSON.stringify(r.halves)}`);
      if (ts === 1 && w === 390) assert(r.whole === 1, `trend line wraps at ${at}: ${JSON.stringify(r)}`);
      assert(r.sameRow && r.h[0] >= 44 && r.h[1] >= 44 && !r.over, `weight actions at ${at}: ${JSON.stringify(r)}`);
      const g = await browser.eval(`(() => {
        const c = document.querySelector('.weight-card'); const log = c.querySelector('[data-log]'); const why = c.querySelector('[data-weight-why]'); const row = c.querySelector('.weight-actions');
        c.querySelector('[data-weight-why-text]').hidden = false;
        const b = log.getBoundingClientRect(), a = why.getBoundingClientRect(), cs = getComputedStyle(c), cr = c.getBoundingClientRect();
        const edge = cr.right - parseFloat(cs.paddingRight), e = c.querySelector('[data-weight-why-text]').getBoundingClientRect();
        return { edge: Math.abs(b.right - edge), mid: (b.top + b.height / 2) >= a.top && (b.top + b.height / 2) <= a.bottom, below: e.top >= row.getBoundingClientRect().bottom - 1 };
      })()`);
      assert(g.edge <= 1 && g.mid && g.below, `weight actions layout at ${at}: ${JSON.stringify(g)}`);
    }
  });
}

if (standalone) {
  test('layout: Interval timer: presets do not overflow or touch, the three inputs share one top', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    for (const w of [320, 390]) for (const ts of [1, 1.35]) {
      await browser.viewport(w, w === 320 ? 568 : 844, true);
      await browser.open('timer', seed());
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
      const r = await browser.eval(`(() => {
        const spans = [...document.querySelectorAll('.timer-screen .seg.small span')];
        const rects = spans.map((s) => { const rg = document.createRange(); rg.selectNodeContents(s); return rg.getBoundingClientRect(); });
        const gaps = rects.slice(1).map((q, i) => q.left - rects[i].right);
        return { over: spans.filter((s) => s.scrollWidth > s.clientWidth + 1).length, gaps, tops: [...document.querySelectorAll('.timer-screen .field input')].map((i) => Math.round(i.getBoundingClientRect().top)) };
      })()`);
      const at = `${w}px text ${ts}`;
      assert(r.over === 0 && r.gaps.every((x) => x >= 4), `timer presets at ${at}: ${JSON.stringify(r)}`);
      assert(r.tops.length === 3 && new Set(r.tops).size === 1, `timer inputs not on one line at ${at}: ${JSON.stringify(r.tops)}`);
    }
  });
}

if (standalone) {
  test("layout: Change today's workout: the sheet, its steps and the Undo toast fit at every size", async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const found = new Map();
    const note = (msg, at) => found.set(msg, [...(found.get(msg) || []), at]);
    for (const c of [...SIZES.map(([w, h]) => ({ w, h, dark: true, long: false })), { w: 375, h: 667, dark: false, long: true }]) {
      await browser.viewport(c.w, c.h, c.dark);
      await browser.open('train', seed({ long: c.long }));
      const at = `${c.w}${c.dark ? 'd' : 'l'}${c.long ? 'L' : ''}`;
      const btn = await browser.eval("(() => { const b = document.querySelector('[data-change]'); if (!b) return null; return { h: b.getBoundingClientRect().height, t: b.innerText.trim() }; })()");
      if (!btn) { note('no Change button on Train', at); continue; }
      if (btn.h < 44 || btn.t !== 'Change') note(`Change button is ${btn.h}px tall and reads "${btn.t}"`, at);
      const step = async (label, js) => {
        await browser.eval(js);
        await wait(450);
        // Check the sheet on its own: hide the screen behind it so its buttons don't count as overlapping the sheet's.
        const behind = (v) => browser.eval(`['main', 'nav', 'navbar'].forEach((id) => { const e = document.getElementById(id); if (e) e.style.visibility = '${v}'; })`);
        await behind('hidden');
        let probs = await browser.eval(`(${detect})(${JSON.stringify({ largeText: false })})`);
        await behind('');
        if (c.long && label === 'place') probs = probs.filter((x) => !/Downtown|Hotel/.test(x)); // a place name wider than the row is the user's own text
        if (!(await browser.eval("!!document.querySelector('dialog.sheet[open]')"))) probs.push('sheet is not open');
        for (const pr of probs) note(`${label}: ${pr}`, at);
        // The sheet title is one line on every step, and the home step's row titles and subtitles are too (>= 390 for subtitles).
        const lines = await browser.eval(`(() => { const n = (e) => { const s = getComputedStyle(e); return Math.round(e.getBoundingClientRect().height / (parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.25)); }; const h = document.querySelector('dialog.sheet h2'); return { h2: h ? n(h) : 1, titles: [...document.querySelectorAll('dialog.sheet .pick b')].map(n), subs: [...document.querySelectorAll('dialog.sheet .pick small')].map(n) }; })()`);
        if (lines.h2 > 1) note(`${label}: sheet title wraps to ${lines.h2} lines`, at);
        if (lines.titles.some((x) => x > 1) && !c.long) note(`${label}: a row title wraps`, at);
        if (label === 'sheet' && c.w >= 390 && lines.subs.some((x) => x > 1)) note('sheet: a subtitle wraps', at);
        if (shots) await browser.screenshot(`${shots}/change-${label}-${c.w}x${c.h}-${c.dark ? 'dark' : 'light'}${c.long ? '-long' : ''}.png`);
      };
      const sh = "document.querySelector('dialog.sheet ";
      await step('sheet', "document.querySelector('[data-change]').click()");
      await step('focus', `${sh}[data-o=focus]').click()`);
      await step('length', `${sh}[data-back]').click(); ${sh}[data-o=length]').click()`);
      await step('place', `${sh}[data-back]').click(); ${sh}[data-o=place]').click()`);
      // pick a length: the sheet closes, the Undo toast appears and fits
      await browser.eval(`${sh}[data-back]').click(); ${sh}[data-o=length]').click(); ${sh}[data-v=\\"20\\"]').click()`);
      await wait(700);
      const tb = await browser.eval("(() => { const t = document.querySelector('.toast'); const b = t && t.querySelector('.toast-act'); if (!b) return null; const r = t.getBoundingClientRect(); const a = b.getBoundingClientRect(); return { inside: r.left >= 0 && r.right <= innerWidth, h: a.height, w: a.width }; })()");
      if (!tb) note('no Undo toast after a change', at);
      else {
        if (!tb.inside || tb.h < 44 || tb.w < 44) note(`Undo toast does not fit: ${JSON.stringify(tb)}`, at);
        if (shots) await browser.screenshot(`${shots}/change-toast-${c.w}x${c.h}-${c.dark ? 'dark' : 'light'}${c.long ? '-long' : ''}.png`);
        await browser.eval("document.querySelector('.toast-act').click()");
        await wait(400);
        await browser.eval("document.querySelector('[data-change]').click()");
        await wait(450);
        if (await browser.eval("!!document.querySelector('dialog.sheet [data-o=reset]')")) note('Undo did not bring back the recommended workout', at);
      }
    }
    assert(found.size === 0, `\n        ${[...found].map(([p, at]) => `${p}  [${at.join(' ')}]`).join('\n        ')}`);
  });
}

if (standalone) {
  test('layout: every Change toast message is one line, Undo is plain text, and Undo after a new location keeps earlier swaps', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const found = new Map();
    const note = (msg, at) => found.set(msg, [...(found.get(msg) || []), at]);
    const sh = "document.querySelector('dialog.sheet ";
    const names = () => browser.eval("[...document.querySelectorAll('.preview .pv-ex b')].map((b) => b.textContent).join('|')");
    const open = async () => { await browser.eval("document.querySelector('[data-change]').click()"); await wait(450); };
    const toastInfo = () => browser.eval(`(() => {
      const t = [...document.querySelectorAll('.toast')].pop(); const m = t && t.querySelector('.toast-msg'); const b = t && t.querySelector('.toast-act');
      if (!m) return null;
      const rg = document.createRange(); rg.selectNodeContents(m);
      const lines = new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top / 6))).size;
      return { text: m.textContent, lines, cut: m.scrollWidth > m.clientWidth + 1, border: getComputedStyle(b).borderTopWidth, inside: t.getBoundingClientRect().left >= 0 && t.getBoundingClientRect().right <= innerWidth };
    })()`);
    // run one option, check the toast it leaves, then Undo it
    const probe = async (what, js, at, { cutOk = false } = {}) => {
      await open();
      await browser.eval(js);
      await wait(700);
      const t = await toastInfo();
      if (!t) { note(`${what}: no toast`, at); return; }
      if (t.lines !== 1) note(`${what}: toast "${t.text}" takes ${t.lines} lines`, at);
      if (t.cut && !cutOk) note(`${what}: toast "${t.text}" is cut off`, at);
      if (t.border !== '0px') note(`${what}: Undo has a ${t.border} border`, at);
      if (!t.inside) note(`${what}: toast runs off-screen`, at);
      await browser.eval("[...document.querySelectorAll('.toast-act')].pop().click()");
      await wait(500);
    };
    for (const c of [...SIZES.map(([w, h]) => ({ w, h, long: false })), { w: 320, h: 568, long: true }, { w: 440, h: 956, long: true }]) {
      await browser.viewport(c.w, c.h, true);
      await browser.open('train', seed({ long: c.long }));
      const at = `${c.w}${c.long ? 'L' : ''}`;
      await probe('new exercises', `${sh}[data-o=new]').click()`, at);
      const values = await (async () => { await open(); await browser.eval(`${sh}[data-o=focus]').click()`); await wait(450); const v = await browser.eval(`[...document.querySelectorAll('dialog.sheet [data-v]')].map((b) => b.dataset.v)`); await browser.eval(`${sh}[data-back]').click(); document.querySelector('dialog.sheet [data-close]').click()`); await wait(500); return v; })();
      const labels = await browser.eval("document.querySelector('.preview .big-title').textContent");
      if (!labels) note('no focus title', at);
      for (const v of values.filter((x) => x)) await probe(`focus ${v}`, `${sh}[data-o=focus]').click(); ${sh}[data-v=\\"${v}\\"]').click()`, at);
      for (const n of [20, 30, 60]) await probe(`${n} min`, `${sh}[data-o=length]').click(); ${sh}[data-v=\\"${n}\\"]').click()`, at);
      await probe('place', `${sh}[data-o=place]').click(); ${sh}[data-v=\\"l2\\"]').click()`, at, { cutOk: c.long });
      // swap → change location → Undo: the swapped exercises must still be showing
      const rec = await names();
      await open(); await browser.eval(`${sh}[data-o=new]').click()`); await wait(700);
      const swapped = await names();
      await browser.eval("[...document.querySelectorAll('.toast-act')].pop().click()"); await wait(300); // undo of the swap, to start clean...
      await open(); await browser.eval(`${sh}[data-o=new]').click()`); await wait(700); // ...and swap again
      if ((await names()) !== swapped) note('New exercises is not repeatable', at);
      await open(); await browser.eval(`${sh}[data-o=place]').click(); ${sh}[data-v=\\"l2\\"]').click()`); await wait(700);
      await browser.eval("[...document.querySelectorAll('.toast-act')].pop().click()"); await wait(900);
      const after = await names();
      if (after !== swapped) note(`Undo after a new location lost the swap (${after} vs ${swapped})`, at);
      if (swapped === rec) note('New exercises changed nothing in the fixture', at);
    }
    assert(found.size === 0, `\n        ${[...found].map(([p, at]) => `${p}  [${at.join(' ')}]`).join('\n        ')}`);
  });
}

if (!standalone) {
  // Inside tests/run.js the other suites replace globals (fetch, document...), so the browser run happens in its own process.
  test('layout: every screen, 320 to 440 wide, dark and light, large text (headless Chromium)', async () => {
    if (skipReason()) { console.log('      (skipped: ' + skipReason() + ')'); return; }
    if (process.argv.includes('--no-layout')) { console.log('      (skipped: --no-layout)'); return; }
    const { spawn } = await import('node:child_process');
    // the screens are independent, so run them as parallel shards (each with its own Chromium) instead of one long serial run
    const SHARDS = 3;
    const runs = Array.from({ length: SHARDS }, (_, i) => new Promise((resolve) => {
      const p = spawn(process.execPath, [new URL(import.meta.url).pathname, `--shard=${i + 1}/${SHARDS}`], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
      const timer = setTimeout(() => { p.kill('SIGKILL'); out += `\nshard ${i + 1} timed out`; }, 420000);
      p.on('close', (status) => { clearTimeout(timer); resolve({ status, out }); });
    }));
    const results = await Promise.all(runs);
    const bad = results.filter((r) => r.status !== 0);
    assert(!bad.length, '\n' + bad.map((r) => r.out.split('\n').filter((l) => !l.includes('✓')).join('\n')).join('\n'));
  });
}

if (standalone) {
  test('layout: Food summary: over-target values stay on one line at 320, 375 and 390, normal and large text', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const found = new Map();
    const note = (msg, at) => found.set(msg, [...(found.get(msg) || []), at]);
    for (const [w, h] of [[320, 568], [375, 667], [390, 844]]) {
      for (const ts of [1, 1.35]) {
        await browser.viewport(w, h, true);
        await browser.open('food', seed({ over: true }));
        if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
        const rows = await browser.eval(`(() => [...document.querySelectorAll('.meter-row')].map((r) => {
          const lines = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); const c = [...rg.getClientRects()].filter((q) => q.width > 0).map((q) => [(q.top + q.bottom) / 2, q.height]).sort((x, y) => x[0] - y[0]); const hh = Math.max(...c.map((q) => q[1])); return c.filter((q, i) => i === 0 || q[0] - c[i - 1][0] > hh * 0.6).length; };
          const label = r.querySelector('.label'); const val = label.parentElement.lastElementChild;
          const a = label.getBoundingClientRect(); const b = val.getBoundingClientRect();
          return { name: label.textContent.trim(), label: lines(label), val: lines(val), side: Math.abs(a.top - b.top) < 4, overlap: Math.abs(a.top - b.top) < 4 && a.right > b.left + 1, parts: [...val.children].map(lines), text: val.textContent.replace(/\\s+/g, ' ').trim(), out: b.right > r.getBoundingClientRect().right + 1 };
        }))()`);
        const at = `${w}${ts !== 1 ? 'T' : ''}`;
        if (!rows.length) note('no meter rows on Food', at);
        for (const r of rows) {
          if (r.label !== 1) note(`${r.name}: label wraps`, at);
          if (r.val !== 1 && ts === 1) note(`${r.name}: value "${r.text}" wraps`, at);
          if (r.parts.some((n) => n !== 1)) note(`${r.name}: "${r.text}" breaks mid-value`, at);
          if (r.overlap || r.out) note(`${r.name}: value overlaps the label or runs off-screen`, at);
        }
      }
    }
    assert(found.size === 0, `\n        ${[...found].map(([p, at]) => `${p}  [${at.join(' ')}]`).join('\n        ')}`);
  });
}

if (standalone) {
  test('layout: Log food dock: each macro value stays with its unit at 320 and 390, normal and large text', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const found = new Map();
    const note = (msg, at) => found.set(msg, [...(found.get(msg) || []), at]);
    for (const [w, h] of [[320, 568], [390, 844]]) {
      for (const ts of [1, 1.35]) {
        await browser.viewport(w, h, true);
        await browser.open('food', seed({ over: true }));
        if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await wait(300); }
        await browser.eval("document.querySelector('[data-log-food]').click()"); await wait(600);
        await browser.eval("document.querySelector('dialog.sheet [data-results] li[data-i]').click()"); await wait(500);
        const r = await browser.eval(`(() => {
          const line = document.querySelector('dialog.sheet [data-sel-line]'); if (!line) return null;
          const lines = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); const c = [...rg.getClientRects()].filter((q) => q.width > 0).map((q) => (q.top + q.bottom) / 2).sort((x, y) => x - y); return c.filter((q, i) => i === 0 || q - c[i - 1] > 6).length; };
          return { parts: [...line.querySelectorAll('.nb')].map((n) => [n.textContent, lines(n)]), cut: line.scrollWidth > line.clientWidth + 1 };
        })()`);
        const at = `${w}${ts !== 1 ? 'T' : ''}`;
        if (!r || !r.parts.length) { note('dock macro line missing', at); continue; }
        for (const [t, n] of r.parts) if (n !== 1) note(`"${t}" splits across lines`, at);
        if (r.cut) note('macro line is cut off', at);
      }
    }
    assert(found.size === 0, `\n        ${[...found].map(([p, at]) => `${p}  [${at.join(' ')}]`).join('\n        ')}`);
  });
}

if (standalone) {
  test('layout: Today missions footer keeps "+30 XP bonus." together at 320 and 390, normal and large text', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const found = new Map();
    for (const [w, h] of [[320, 568], [390, 844]]) for (const ts of [1, 1.35]) {
      await browser.viewport(w, h, true);
      await browser.open('today', seed());
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
      const r = await browser.eval(`(() => {
        const f = document.querySelector('.ms-foot'); if (!f) return null;
        const lines = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); return new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round((q.top + q.bottom) / 2 / 6))).size; };
        const t = f.querySelector('.nw');
        return { text: f.innerText, tail: t ? lines(t) : 0, all: lines(f), cut: f.scrollWidth > f.clientWidth + 1 };
      })()`);
      const at = `${w}${ts !== 1 ? 'T' : ''}`;
      if (!r) { found.set('missions footer missing', [at]); continue; }
      if (r.tail !== 1) found.set(`the bonus splits across lines: "${r.text}"`, [...(found.get(`the bonus splits across lines: "${r.text}"`) || []), at]);
      if (r.all > 2 || r.cut) found.set(`footer too long or cut: ${JSON.stringify(r)}`, [at]);
    }
    assert(found.size === 0, `\n        ${[...found].map(([p, at]) => `${p}  [${at.join(' ')}]`).join('\n        ')}`);
  });
}

// A fake iPhone shell for the update tests: a native Capacitor with the App plugin, and app-install.json / whats-new.json served
// from sessionStorage so a reload keeps them. The setup script is kept across the reload (open(..., { persist: true })).
const NATIVE_SHELL = `
  const read = (k, d) => { try { return JSON.parse(sessionStorage.getItem(k) || d); } catch (e) { return JSON.parse(d); } };
  const realFetch = window.fetch.bind(window);
  window.fetch = (u, o) => {
    const s = String(u);
    if (s.includes('app-install.json')) return Promise.resolve(new Response(JSON.stringify(read('__install', '{"version":"0.15.10","builtAt":"2026-10-10T10:00:00Z"}')), { status: 200 }));
    if (s.includes('whats-new.json')) return Promise.resolve(new Response(JSON.stringify(read('__news', '{}')), { status: 200 }));
    return realFetch(u, o);
  };
  window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: (n) => n === 'App', Plugins: { App: { addListener: (ev, cb) => { (window.__cb = window.__cb || {})[ev] = cb; return Promise.resolve({ remove() {} }); } } } };
`;

// Wide canvas (item 28/30): two columns on Today and Train from 840 px (each column >= 340px), every other screen stays the 560px column, the tab bar is full width on every tab, and nothing sits inside the side insets.
for (const route of standalone ? ['today', 'train', 'body', 'food', 'settings'] : []) {
  if (only && !only.includes(route)) continue;
  test(`layout: ${route}: wide canvas has the right columns, a full-width tab bar, and respects left/right insets`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const bad = [];
    let base = new Set(); // what already wraps on a 390 phone isn't a wide-layout problem
    for (const [w, h] of [[390, 844], ...WIDE]) for (const inset of (w > h ? [0, 47] : [0])) { // side insets only exist in landscape
      await browser.viewport(w, h, true);
      await browser.open(route, seed());
      if (inset) { await browser.eval(`document.documentElement.style.setProperty('--safe-left', '${inset}px'); document.documentElement.style.setProperty('--safe-right', '${inset}px')`); await wait(300); }
      const at = `${w}x${h}${inset ? ' inset ' + inset : ''}`;
      const m = await browser.eval(`(() => {
        const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
        const a = document.querySelector('#main .col-a'), b = document.querySelector('#main .col-b');
        const out = [];
        document.querySelectorAll('#main a[href], #main button, #main .card, #nav a').forEach((e) => {
          const q = e.getBoundingClientRect();
          if (q.width < 1 || q.height < 1 || getComputedStyle(e).visibility === 'hidden') return;
          if (q.left < ${inset} - 0.5 || q.right > innerWidth - ${inset} + 0.5) out.push((e.className || e.tagName) + ' ' + Math.round(q.left) + '-' + Math.round(q.right));
        });
        const wrap = [];
        const lineCount = (e) => { const g = document.createRange(); g.selectNodeContents(e); return new Set([...g.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top / 6))).size; };
        document.querySelectorAll('#main .weight-text .hero-num, #main .weight-text [data-weight-trend] .nw, #main .rings-card > .row a, #main .food-card-kcal b, #main [data-weight-why]').forEach((e) => {
          if (e.getBoundingClientRect().width < 1) return;
          if (lineCount(e) > 1) wrap.push('wraps: ' + (e.className || e.tagName) + ' "' + e.textContent.trim().slice(0, 24) + '"');
          if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline') wrap.push('overflows: ' + (e.className || e.tagName));
        });
        const kc = document.querySelector('#main .food-card-kcal'); if (kc && lineCount(kc) > 1) wrap.push('wraps: food headline');
        const ht = document.querySelector('#main .weight-text [data-weight-trend]'); if (ht && lineCount(ht) > 1) wrap.push('wraps: weight trend line');
        const rw = document.querySelector('#main .rings-card > .row'); if (rw) { const k = [...rw.children].map((c) => c.getBoundingClientRect().top); if (Math.max(...k) - Math.min(...k) > 6) wrap.push('wraps: rings header'); }
        return { wrap: wrap, main: r(document.getElementById('main')), tab: r(document.getElementById('nav')), a: r(a), b: r(b), out: out.slice(0, 4), vw: innerWidth };
      })()`);
      if (Math.abs(m.tab.l) > 1 || Math.abs(m.tab.r - m.vw) > 1) bad.push(`${at}: tab bar ${Math.round(m.tab.l)}-${Math.round(m.tab.r)} is not full width (${m.vw})`);
      const cols = route === 'today' || route === 'train';
      if (!cols && m.main.r - m.main.l > 560 + 1) bad.push(`${at}: ${route} stretched to ${Math.round(m.main.r - m.main.l)}px, should stay a 560px column`);
      if (w === 390 && !inset) base = new Set(m.wrap);
      const fresh = m.wrap.filter((x) => !base.has(x));
      if (fresh.length) bad.push(`${at}: ${fresh.join(', ')}`);
      if (m.out.length) bad.push(`${at}: sits inside the inset: ${m.out.join(', ')}`);
      if (!cols) continue;
      const two = m.a && m.b && m.a.r - m.a.l > 1 && m.b.r - m.b.l > 1 && m.b.l >= m.a.r - 0.5 && Math.abs(m.a.t - m.b.t) < 4;
      if (w >= 840 && !two) bad.push(`${at}: not two columns`);
      if (w < 840 && two) bad.push(`${at}: should stay one column`);
      if (w >= 840 && two && m.a.r - m.a.l < 340) bad.push(`${at}: left column ${Math.round(m.a.r - m.a.l)}px is narrower than 340px`);
      if (w >= 840 && two && m.b.r - m.b.l < 340) bad.push(`${at}: right column ${Math.round(m.b.r - m.b.l)}px is narrower than 340px`);
      if (route === 'today' && w >= 840 && two && Math.abs(m.a.b - m.b.b) > 120) bad.push(`${at}: Today's columns end ${Math.round(Math.abs(m.a.b - m.b.b))}px apart (left ${Math.round(m.a.b)}, right ${Math.round(m.b.b)}), should be within 120px`);
      if (w >= 840 && two && m.b.l - m.a.r < 24) bad.push(`${at}: gutter ${Math.round(m.b.l - m.a.r)}px is under 24px`);
    }
    assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
  });
}

if (standalone) {
  test('layout: resume with a changed app-install.json reloads, then toasts "Updated to …" and opens What\'s new (never mid-workout)', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const version = (await import('../js/version.js')).VERSION;
    const news = { [version]: { title: 'Test notes', items: ['First highlight', 'Second highlight'] } };
    const newBuild = JSON.stringify({ version, builtAt: '2026-10-12T09:00:00Z' });
    const newerBuild = JSON.stringify({ version, builtAt: '2026-10-13T09:00:00Z' }); // (sessionStorage outlives a test page: each scenario needs a build that differs from the last one's)
    const newestBuild = JSON.stringify({ version, builtAt: '2026-10-14T09:00:00Z' });
    const reloaded = () => browser.eval("performance.getEntriesByType('navigation')[0].type === 'reload' && !window.__marker");
    for (const [w, h] of [[320, 568], [390, 844]]) {
      await browser.viewport(w, h, true);
      // 1. a normal screen: resume → reload → toast → sheet
      await browser.open('today', seed(), NATIVE_SHELL, { persist: true });
      await wait(2300); // the app's own first check and its (silent) version note have run; resume events closer than 1.5 s are ignored
      await browser.eval(`sessionStorage.setItem('__news', ${JSON.stringify(JSON.stringify(news))}); localStorage.setItem('forge.seenVersion', '0.0.1'); window.__marker = 1; sessionStorage.setItem('__install', ${JSON.stringify(newBuild)})`);
      assert(await browser.eval("typeof window.__cb.resume === 'function'"), 'the app registered a resume listener');
      await browser.eval('window.__cb.resume()');
      await wait(2500);
      assert(await reloaded(), `resume with a new build did not reload the app at ${w}`);
      for (let i = 0; i < 30 && !(await browser.eval("!!document.querySelector('.toast-act')")); i++) await wait(200);
      assert((await browser.eval("(document.querySelector('.toast-msg') || {}).textContent")) === `Updated to ${version}`, 'no "Updated to" toast after the reload');
      await browser.eval("document.querySelector('.toast-act').click()");
      await wait(900);
      const sheetInfo = await browser.eval("({ title: (document.querySelector('dialog.sheet h2') || {}).textContent, items: [...document.querySelectorAll('dialog.sheet .whats-new li')].map((l) => l.textContent) })");
      assert(sheetInfo.title === `What’s new in ${version}` && sheetInfo.items.length === 2, `What's new sheet: ${JSON.stringify(sheetInfo)}`);
      await browser.eval("['main', 'nav', 'navbar'].forEach((id) => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; })"); // the sheet on its own
      const probs = await browser.eval(`(${detect})(${JSON.stringify({ largeText: false })})`);
      assert(probs.length === 0, `What's new sheet at ${w}: ${probs.join(' | ')}`);
      await browser.eval("localStorage.setItem('forge.seenVersion', '" + version + "')");
      // 2. mid-workout: the player is left alone until you leave it
      await browser.open('play', seed({ active: true }), NATIVE_SHELL, { persist: true });
      await wait(2300);
      await browser.eval(`window.__marker = 1; sessionStorage.setItem('__install', ${JSON.stringify(newerBuild)})`);
      await browser.eval('window.__cb.resume()');
      await wait(2000);
      assert(await browser.eval('window.__marker === 1'), `the app reloaded in the middle of a workout at ${w}`);
      await browser.eval("location.hash = '#/today'");
      await wait(2500);
      assert(await reloaded(), `the waiting update did not go through after leaving the player at ${w}`);
      // 3. an open sheet (it may hold unsaved input): the reload waits until it closes
      await browser.open('today', seed(), NATIVE_SHELL, { persist: true });
      await wait(2300);
      await browser.eval("document.querySelector('[data-log]').click()");
      await wait(700);
      assert(await browser.eval("!!document.querySelector('dialog.sheet[open]')"), `the Log weight sheet did not open at ${w}`);
      await browser.eval(`window.__marker = 1; sessionStorage.setItem('__install', ${JSON.stringify(newestBuild)})`);
      await browser.eval('window.__cb.resume()');
      await wait(2000);
      assert(await browser.eval('window.__marker === 1 && !!document.querySelector("dialog.sheet[open]")'), `the app reloaded under an open sheet at ${w}`);
      await browser.eval("document.querySelector('dialog.sheet[open]').close()");
      await wait(2500);
      assert(await reloaded(), `the waiting update did not go through after the sheet closed at ${w}`);
    }
    await browser.dropInit();
  });
}

for (const [w, h] of standalone ? [[320, 568], [375, 667], [390, 844]] : []) {
  test(`layout: tour keeps each target in view above the card at ${w}x${h}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await browser.viewport(w, h, true);
    await browser.open('today', seed({}));
    await browser.eval("import('./js/tour/tour.js').then((m) => m.startTour({ replay: true }))");
    await wait(600);
    const bad = [];
    for (let i = 0; i < 11; i++) {
      await wait(450);
      const m = await browser.eval(`(() => { const c = document.querySelector('.tour-card').getBoundingClientRect(); const s = document.querySelector('.tour-spot'); const sr = s.getBoundingClientRect(); return { t: document.querySelector('#tour-title').textContent, empty: s.classList.contains('empty'), ctop: c.top, sbot: sr.bottom, stop: sr.top, sh: sr.height, bar: (() => { const b = document.getElementById('navbar'); return b && !b.hidden ? b.getBoundingClientRect().bottom : 0; })() }; })()`);
      if (shots) await browser.screenshot(`${shots}/tour-${i + 1}-${w}x${h}.png`);
      // The tab-bar step puts the card above its target; a target taller than the room is pinned under the nav bar.
      const fits = !m.empty && m.stop < m.ctop && m.sh + 12 + 36 <= m.ctop;
      if (fits) {
        const gap = m.ctop - m.sbot; // spotlight outline (8px pad included) to the top of the card
        if (gap < 11) bad.push(`step ${i + 1} "${m.t}": only ${Math.round(gap)}px between target and card`);
        if (m.stop < 30) bad.push(`step ${i + 1} "${m.t}": only ${Math.round(m.stop)}px of page above the target`);
      }
      // The ring never overlaps the top bar (it is drawn 8px out, so it clears the bar by its own pad).
      if (!m.empty && m.stop < m.ctop && m.stop < m.bar - 0.5) bad.push(`step ${i + 1} "${m.t}": spotlight top ${Math.round(m.stop)}px is under the top bar (bottom ${Math.round(m.bar)}px)`);
      await browser.eval("document.querySelector('[data-next]').click()");
    }
    assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
  });
}

for (const [w, h] of standalone ? [[890, 626]] : []) {
  test(`layout: tour card never covers its target on two-column screens at ${w}x${h}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await browser.viewport(w, h, true);
    await browser.open('today', seed({}));
    await browser.eval("import('./js/tour/tour.js').then((m) => m.startTour({ replay: true }))");
    await wait(600);
    const bad = [];
    let checked = 0;
    for (let i = 0; i < 11; i++) {
      await wait(450);
      const m = await browser.eval(`(() => {
        const c = document.querySelector('.tour-card').getBoundingClientRect(); const s = document.querySelector('.tour-spot'); const sr = s.getBoundingClientRect();
        return { t: document.querySelector('#tour-title').textContent, empty: s.classList.contains('empty'), card: [c.left, c.top, c.right, c.bottom], spot: [sr.left, sr.top, sr.right, sr.bottom], two: !!document.querySelector('.today-cols, .train-cols') && getComputedStyle(document.querySelector('.today-cols, .train-cols')).display === 'grid', vw: innerWidth, vh: innerHeight };
      })()`);
      if (shots) await browser.screenshot(`${shots}/tour2-${i + 1}-${w}x${h}.png`);
      if (!m.empty && m.two) { // Today and Train; the one-column screens keep the phone behaviour (tested above)
        const [cl, ct, cr, cb] = m.card; const [sl, st, sr, sb] = m.spot;
        const hit = cl < sr && cr > sl && ct < sb && cb > st;
        checked++;
        if (hit) bad.push(`step ${i + 1} "${m.t}": card (${[cl, ct, cr, cb].map(Math.round)}) covers the spotlight (${[sl, st, sr, sb].map(Math.round)})`);
        if ((st < 0 || sb > m.vh)) bad.push(`step ${i + 1} "${m.t}": spotlight is off-screen`);
      }
      await browser.eval("document.querySelector('[data-next]').click()");
    }
    assert(checked >= 4, `only ${checked} two-column steps were checked`);
    assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
  });
}

// A fake iPhone shell with the Face ID plugin: verifyIdentity rejects (user cancel) until window.__allow is set.
const LOCK_SHELL = `
  localStorage.setItem('forge.lock', JSON.stringify({ enabled: true, timeout: 0, asked: true }));
  window.__allow = false; window.__verifies = 0;
  document.addEventListener('readystatechange', () => { if (document.readyState === 'interactive') window.__earlyLocked = document.documentElement.classList.contains('app-locked'); });
  const bio = { isAvailable: () => Promise.resolve({ isAvailable: true }), verifyIdentity: () => { window.__verifies++; return window.__allow ? Promise.resolve() : Promise.reject({ code: '16', message: 'User cancel' }); } };
  window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: (n) => n === 'App' || n === 'NativeBiometric',
    Plugins: { NativeBiometric: bio, App: { addListener: (ev, cb) => { (window.__cb = window.__cb || {})[ev] = cb; return Promise.resolve({ remove() {} }); } } } };
`;

// 320/375/390 phones plus the wide folded (about 5.4 inch) and unfolded (about 7.6 inch) iPhone Duo screens.
const LOCK_SIZES = [[320, 568], [375, 667], [390, 844], [540, 720], [720, 900]];
const noteTo = (found) => (msg, at) => found.set(msg, [...(found.get(msg) || []), at]);
const report = (found) => `\n        ${[...found].map(([p, at]) => `${p}  [${at.join(' ')}]`).join('\n        ')}`;

if (standalone) {
  test('layout: Face ID lock: covers the app before it is drawn, fits at 320 to Duo widths, shields on leaving, unlocks', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const found = new Map();
    const note = noteTo(found);
    const hidden = "['main', 'nav', 'navbar'].every((id) => { const e = document.getElementById(id); return !e || getComputedStyle(e).visibility === 'hidden'; })";
    for (const [w, h] of LOCK_SIZES) for (const ts of [1, 1.35]) {
      const at = `${w}${ts !== 1 ? 'T' : ''}`;
      await browser.viewport(w, h, true);
      await browser.open('today', seed(), LOCK_SHELL);
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await wait(300); }
      // 1. cold launch: locked before the app's scripts ran, content hidden, Face ID asked without a tap
      if (!(await browser.eval('window.__earlyLocked === true'))) note('the page was not marked locked before the app started (content could flash)', at);
      if (!(await browser.eval(hidden))) note('app content is visible while locked', at);
      if ((await browser.eval('window.__verifies')) < 1) note('Face ID was not asked for on launch', at);
      if (ts === 1 && shots) await browser.screenshot(`${shots}/lock-${w}x${h}.png`);
      const m = await browser.eval(`(() => {
        const lock = document.getElementById('lock'); const r = lock.getBoundingClientRect();
        const lines = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); return new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round((q.top + q.bottom) / 2 / 6))).size; };
        const b = lock.querySelector('[data-unlock]').getBoundingClientRect(); const t = lock.querySelector('h1');
        const kids = [...lock.children].map((c) => c.getBoundingClientRect());
        return { shown: getComputedStyle(lock).display !== 'none', full: r.width >= innerWidth - 1 && r.height >= innerHeight - 1, btnH: b.height, btnL: b.left, btnR: b.right,
          title: lines(t), titleCut: t.scrollWidth > t.clientWidth + 1, out: kids.some((k) => k.left < -0.5 || k.right > innerWidth + 0.5 || k.top < -0.5 || k.bottom > innerHeight + 0.5),
          hscroll: document.documentElement.scrollWidth > innerWidth + 1 };
      })()`);
      if (!m.shown || !m.full) note('the lock screen does not cover the whole screen', at);
      if (m.btnH < 44) note(`Unlock button is only ${m.btnH}px tall`, at);
      if (m.btnL < 0 || m.btnR > w) note('Unlock button runs off-screen', at);
      if (m.out) note('something on the lock screen is clipped or off-screen', at);
      if (ts === 1 && (m.title !== 1 || m.titleCut)) note('the lock title wraps or is cut', at);
      if (m.hscroll) note('the lock screen scrolls sideways', at);
      if (ts !== 1) continue;
      // 2. Unlock: the app shows
      await browser.eval('window.__allow = true');
      await browser.eval("document.querySelector('#lock [data-unlock]').click()");
      await wait(500);
      if (!(await browser.eval("!document.documentElement.classList.contains('app-locked') && getComputedStyle(document.getElementById('main')).visibility === 'visible'"))) note('Unlock did not reveal the app', at);
      // 3. leaving the app: the blurred shield goes up at once (the app-switcher picture)
      await browser.eval('window.__allow = false; window.__cb.appStateChange({ isActive: false })');
      await wait(150);
      const sh = await browser.eval(`({ cls: document.documentElement.className, hidden: ${hidden}, blur: getComputedStyle(document.getElementById('lock')).backdropFilter, btn: getComputedStyle(document.querySelector('#lock [data-unlock]')).visibility })`);
      if (!/app-shield/.test(sh.cls) || !sh.hidden) note('no shield over the app when it left the front', at);
      if (!/blur/.test(sh.blur)) note('the shield is not blurred', at);
      if (sh.btn !== 'hidden') note('the shield shows the Unlock button', at);
      if (shots) await browser.screenshot(`${shots}/lock-shield-${w}x${h}.png`);
      // 4. coming back with "Immediately": locked again (a cancelled Face ID leaves it locked)
      await browser.eval("window.__cb.pause && window.__cb.pause(); window.__cb.appStateChange({ isActive: true })");
      await wait(300);
      if (!(await browser.eval(`document.documentElement.classList.contains('app-locked') && ${hidden}`))) note('coming back did not lock the app again', at);
      // 5. a sheet (modal <dialog>) is open with typed input: the lock sits above it, Unlock is tappable, the sheet comes back untouched
      await browser.eval('window.__allow = true'); await browser.eval("document.querySelector('#lock [data-unlock]').click()"); await wait(400);
      await browser.eval("(() => { const d = document.createElement('dialog'); d.id = 'sheetprobe'; d.innerHTML = '<input id=sheetin>'; document.body.appendChild(d); d.showModal(); document.getElementById('sheetin').value = '211.6'; window.__allow = false; })()");
      await browser.eval("window.__cb.pause && window.__cb.pause(); window.__cb.appStateChange({ isActive: true })"); await wait(300);
      const top = await browser.eval("(() => { const b = document.querySelector('#lock [data-unlock]').getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!e && !!e.closest('#lock') && document.documentElement.classList.contains('app-locked'); })()");
      if (!top) note('with a sheet open, the Unlock button cannot be reached (the lock is under the sheet)', at);
      if (shots) await browser.screenshot(`${shots}/lock-over-sheet-${w}x${h}.png`);
      await browser.eval('window.__allow = true');
      await browser.eval("(() => { const b = document.querySelector('#lock [data-unlock]').getBoundingClientRect(); document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2).click(); })()"); await wait(500);
      const kept = await browser.eval("({ open: document.getElementById('sheetprobe').open, val: document.getElementById('sheetin').value, locked: document.documentElement.classList.contains('app-locked') })");
      if (kept.locked || !kept.open || kept.val !== '211.6') note(`the sheet did not survive lock and unlock: ${JSON.stringify(kept)}`, at);
    }
    await browser.dropInit();
    assert(found.size === 0, report(found));
  });

  test('layout: Settings → Privacy & security: the web shows one line, the app shows the toggle and timeout, and it fits', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const found = new Map();
    const note = noteTo(found);
    const probe = `(() => {
      const box = document.querySelector('[data-privacy]'); if (!box) return null;
      const lines = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); return new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round((q.top + q.bottom) / 2 / 6))).size; };
      const r = box.getBoundingClientRect();
      return { text: box.innerText.replace(/\\s+/g, ' ').trim(), sw: !!box.querySelector('input[name=applock]'), time: !!box.querySelector('input[name=locktime]'),
        out: [...box.querySelectorAll('*')].some((e) => e.getBoundingClientRect().right > innerWidth + 0.5),
        segLines: [...box.querySelectorAll('.seg label')].map(lines),
        segSpill: [...box.querySelectorAll('.seg label span')].some((e) => e.scrollWidth > e.clientWidth + 0.5), inside: r.left >= 0 && r.right <= innerWidth };
    })()`;
    for (const [w, h] of LOCK_SIZES) for (const ts of [1, 1.35]) {
      const at = `${w}${ts !== 1 ? 'T' : ''}`;
      await browser.viewport(w, h, true);
      // the web (Safari / home-screen app): no toggle, one line
      await browser.open('settings', seed());
      let r = await browser.eval(probe);
      if (!r || r.sw || !/Face ID lock is available in the iPhone app\./.test(r.text)) note(`the web should show only the one-line note: ${JSON.stringify(r)}`, at);
      // the app, lock on: toggle checked, timeout choices
      await browser.open('settings', seed(), LOCK_SHELL.replace('window.__allow = false', 'window.__allow = true'));
      await browser.eval("document.querySelector('#lock [data-unlock]').click()"); await wait(400);
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await wait(300); }
      r = await browser.eval(probe);
      if (!r || !r.sw || !r.time) { note(`the app should show the toggle and timeout: ${JSON.stringify(r)}`, at); continue; }
      if (r.out || !r.inside) note('Privacy & security runs off-screen or is clipped', at);
      if (ts === 1 && r.segLines.some((n) => n !== 1)) note('a timeout choice wraps', at);
      if (r.segSpill) note('a timeout choice spills out of its segment', at);
      if (shots && ts === 1) { await browser.eval("document.querySelector('[data-privacy]').scrollIntoView({ block: 'center' })"); await wait(200); await browser.screenshot(`${shots}/privacy-${w}x${h}.png`); }
      // turning it off asks Face ID: refused → stays on; allowed → off
      await browser.eval("window.__allow = false; document.querySelector('input[name=applock]').click()"); await wait(500);
      if (!(await browser.eval("document.querySelector('input[name=applock]').checked && JSON.parse(localStorage.getItem('forge.lock')).enabled"))) note('the lock turned off without Face ID', at);
      await browser.eval("window.__allow = true; document.querySelector('input[name=applock]').click()"); await wait(500);
      if (!(await browser.eval("!document.querySelector('input[name=applock]').checked && JSON.parse(localStorage.getItem('forge.lock')).enabled === false"))) note('the lock did not turn off after Face ID said yes', at);
    }
    await browser.dropInit();
    assert(found.size === 0, report(found));
  });
}

test('layout: close the browser', async () => {
  if (browser) await browser.close();
  browser = null;
});

if (standalone) {
  const { runAll, tests } = await import('./harness.js');
  const shard = (arg('shard') || '').split('/').map(Number); // --shard=2/3 → every third test, starting at the second
  if (shard.length === 2) {
    const keep = tests.filter((t, i) => i % shard[1] === shard[0] - 1 || t.name === 'layout: close the browser');
    tests.splice(0, tests.length, ...keep);
  }
  const { fail } = await runAll();
  process.exit(fail ? 1 : 0);
}
