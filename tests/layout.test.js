// Headless layout check (v0.15.7). Boots the real app in Chromium with a synthetic account and fails when a chip, pill,
// button or label wraps or clips, a tap target is under 44 px, or content runs off-screen or under the tab bar.
// Skips (loudly) when no Chrome/Chromium is installed. GitHub's ubuntu runners have one, so CI runs it.
//   LAYOUT_ROUTES=today,body node tests/layout.test.js   → only those screens
//   LAYOUT_SHOTS=/tmp/shots                              → also save a PNG of every render
import { test, assert } from './harness.js';
import { skipReason, launch } from './layout/browser.js';
import { detect } from './layout/detect.js';
import { seed, WORKOUT_DAY, REST_DAY } from './layout/seed.js';
const DAYS = [WORKOUT_DAY, REST_DAY]; // Today differs by day type, so its column checks run on a workout day and on a rest day
const onDay = (at) => ({ now: new Date(at).getTime() });

const SIZES = [[320, 568], [375, 667], [390, 844], [440, 956]];
const shortLand0 = (w, h) => w >= 600 && h <= 500;
const SAFE_BOTTOM = 21; // the home indicator in landscape
const WIDE = [[466, 678], [678, 466], [844, 390], [874, 402], [932, 430], [626, 890], [890, 626]]; // 844x390, 874x402 and 932x430 are current iPhones sideways
const ROUTES = ['play', 'today', 'train', 'body', 'score', 'trends', 'timer', 'history', 'settings', 'apple', 'food', 'awards', 'locations', 'library'];
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

for (const route of standalone ? ['today', 'train', 'body', 'score', 'settings'] : []) {
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
  test('layout: the effort prompt fits at 320, 390 and the Duo sizes, light and dark, without wrapping', async () => {
    if (skipReason()) { console.log('      (skipped: ' + skipReason() + ')'); return; }
    browser = browser || await launch();
    const cases = [[320, 568, true], [320, 568, false], [390, 844, true], [390, 844, false], [466, 678, true], [678, 466, true], [626, 890, false], [890, 626, true]];
    for (const [w, h, dark] of cases) {
      await browser.viewport(w, h, dark);
      await browser.open('play', seed({ active: true, effort: true }));
      await browser.eval("document.querySelector('[data-done]').click()");
      await new Promise((r) => setTimeout(r, 1200));
      const got = await browser.eval("(() => { const b = document.querySelector('.pl-effort'); if (!b) return null; const r = b.getBoundingClientRect(); const p = b.querySelector('p'); const btns = [...b.querySelectorAll('button')].map((x) => { const q = x.getBoundingClientRect(); return { h: q.height, w: q.width, wrap: x.scrollWidth > x.clientWidth + 1 }; }); return { bottom: r.bottom, vh: innerHeight, vw: innerWidth, left: r.left, right: r.right, pWrap: p.getBoundingClientRect().height > parseFloat(getComputedStyle(p).lineHeight || 20) * 1.6, pOver: p.scrollWidth > p.clientWidth + 1, n: btns.length, small: btns.filter((x) => x.h < 44 || x.w < 40).length, wrapped: btns.filter((x) => x.wrap).length }; })()");
      const tag = `${w}x${h}${dark ? 'd' : 'l'}`;
      assert(got, `prompt did not show at ${tag}`);
      assert(got.n === 6 && got.small === 0 && got.wrapped === 0, `buttons ${JSON.stringify(got)} at ${tag}`);
      assert(!got.pWrap && !got.pOver, `question wraps at ${tag}: ${JSON.stringify(got)}`);
      assert(got.left >= 0 && got.right <= got.vw + 1 && Math.abs(got.bottom - got.vh) <= 1, `prompt off-screen at ${tag}: ${JSON.stringify(got)}`);
    }
  });
  test('layout: the Log weight label is one piece, and the workout place sits on its own line', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    for (const w of [320, 375]) { // Log weight lives in the Weight content now; the title row holds only the + and the avatar
      await browser.viewport(w, 667, true);
      await browser.open('body', seed());
      const got = await browser.eval("(() => { const b = document.querySelector('main [data-log]'); const kids = [...document.querySelectorAll('#main .large-title .lt-actions > *')].map((e) => e.id || (e.matches('[data-avatar]') ? 'avatar' : e.tagName)); return { label: b ? b.innerText.trim() : null, inTitle: !!document.querySelector('.large-title [data-log]'), kids }; })()");
      assert(got.label === 'Log weight' && !got.inTitle, `weight button ${JSON.stringify(got)} at ${w}`);
      assert(got.kids.join() === 'quicklog,avatar', `Progress title row holds ${got.kids} at ${w}`);
    }
    for (const long of [false, true]) {
      await browser.viewport(320, 568, true);
      await browser.open('today', seed({ long }));
      const r = await browser.eval("(() => { const p = document.querySelector('[data-workout-place]'); if (!p) return null; const m = p.previousElementSibling; return { place: p.getBoundingClientRect().height < 30, dot: /·\\s*$/.test(m.innerText), lines: (() => { const rg = document.createRange(); rg.selectNodeContents(m); return new Set([...rg.getClientRects()].map((q) => Math.round(q.top / 6))).size; })() }; })()");
      if (!r) continue; // seed has no planned workout today
      assert(r.place && !r.dot && r.lines === 1, `workout meta/place wrapped badly at 320: ${JSON.stringify(r)}`);
    }
  });

  test('layout: the Progress title row refits on resize without a re-render (890 → 320 → 390)', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const read = () => browser.eval(`(() => { const l = document.querySelector('#main .large-title'), a = l.querySelector('.lt-actions'), t = l.querySelector('h1, .lt-title') || l.firstElementChild; return { actionsRight: a.getBoundingClientRect().right, titleRight: l.getBoundingClientRect().right, snug: l.classList.contains('snug'), tight: l.classList.contains('tight'), label: '', fs: parseFloat(getComputedStyle(t).fontSize) }; })()`);
    const sizes = [[890, 626], [320, 568], [390, 844]];
    const fresh = {};
    for (const [w, h] of sizes) { // what a fresh render gives at each size
      await browser.viewport(w, h, true);
      await browser.open('body', seed());
      await wait(300);
      fresh[w] = await read();
    }
    await browser.viewport(890, 626, true);
    await browser.open('body', seed());
    for (const [w, h] of [...sizes.slice(1), sizes[0], sizes[2], sizes[0]]) { // same page, no re-render
      await browser.viewport(w, h, true);
      await wait(300);
      const r = await read(), f = fresh[w];
      assert(r.actionsRight <= r.titleRight + 0.5, `actions run past the title row at ${w}: ${JSON.stringify(r)}`);
      assert(r.snug === f.snug && r.tight === f.tight && r.label === f.label && r.fs === f.fs, `resized page differs from a fresh render at ${w}: ${JSON.stringify(r)} vs ${JSON.stringify(f)}`);
    }
    assert(!fresh[890].snug, 'no shrinking needed at 890');
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
  test('layout: Focus areas sheet and Program row fit at 320, 390 and the Duo sizes, light and dark, and no chip wraps', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const found = new Map();
    const note = (msg, at) => found.set(msg, [...(found.get(msg) || []), at]);
    const cases = [[320, 568], [390, 844], ...WIDE].flatMap(([w, h]) => [{ w, h, dark: true }, { w, h, dark: false }]);
    for (const c of cases) {
      await browser.viewport(c.w, c.h, c.dark);
      const data = seed(); data.profile[0].focus_muscles = ['shoulders', 'abs', 'glutes']; // the longest labels
      await browser.open('train', data);
      const at = `${c.w}x${c.h}${c.dark ? 'd' : 'l'}`;
      if (!(await browser.eval("!!document.querySelector('[data-focus]')"))) { note('no Focus areas row on the Program card', at); continue; }
      const probsRow = await browser.eval(`(${detect})(${JSON.stringify({ largeText: false })})`);
      for (const pr of probsRow) note(`program card: ${pr}`, at);
      // the Program row's value never breaks inside a name (it may wrap between names only at large text)
      const rowFit = await browser.eval("(() => { const r = document.querySelector('[data-focus]'); const spans = [...r.querySelectorAll('.focus-val span')]; const lines = (e) => { const g = document.createRange(); g.selectNodeContents(e); return new Set([...g.getClientRects()].map((q) => Math.round(q.top))).size; }; const tops = new Set(spans.map((e) => Math.round(e.getBoundingClientRect().top))).size; return { names: spans.map(lines), rows: tops, h: Math.round(r.getBoundingClientRect().height) }; })()");
      if (rowFit.names.some((n) => n > 1)) note('program card: a focus name breaks across lines', at);
      if (rowFit.rows > 1) note('program card: the focus value wraps onto a second line', at);
      if (rowFit.h < 44) note(`program card: the focus row is only ${rowFit.h}px tall`, at);
      await browser.eval("document.querySelector('[data-focus]').click()");
      await wait(450);
      if (!(await browser.eval("!!document.querySelector('dialog.sheet[open]')"))) { note('Focus sheet did not open', at); continue; }
      await browser.eval("['main', 'nav', 'navbar'].forEach((id) => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; })");
      const probs = await browser.eval(`(${detect})(${JSON.stringify({ largeText: false })})`);
      for (const pr of probs) note(`sheet: ${pr}`, at);
      const chips = await browser.eval("[...document.querySelectorAll('dialog.sheet .focus-chips .chip span')].map((s) => { const st = getComputedStyle(s); const g = document.createRange(); g.selectNodeContents(s); return new Set([...g.getClientRects()].map((q) => Math.round(q.top))).size + ':' + s.scrollWidth + ':' + s.clientWidth; })");
      if (chips.length !== 8) note(`expected 7 groups plus None, found ${chips.length}`, at);
      for (const x of chips) { const [lines, sw, cw] = x.split(':').map(Number); if (lines > 1 || sw > cw) note(`a Focus chip wraps or clips (${x})`, at); }
      if (shots) await browser.screenshot(`${shots}/focus-${c.w}x${c.h}-${c.dark ? 'dark' : 'light'}.png`);
    }
    assert(found.size === 0, `\n        ${[...found].map(([p, at]) => `${p}  [${at.join(' ')}]`).join('\n        ')}`);
  });

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
    const SHARDS = 4; // shard 1 of 3 sat at ~6m50s against a 7m cap; four shards on the 4-core runner leave real headroom
    const runs = Array.from({ length: SHARDS }, (_, i) => new Promise((resolve) => {
      const p = spawn(process.execPath, [new URL(import.meta.url).pathname, `--shard=${i + 1}/${SHARDS}`], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
      const timer = setTimeout(() => { p.kill('SIGKILL'); out += `\nshard ${i + 1} timed out`; }, 540000);
      p.on('close', (status) => { clearTimeout(timer); resolve({ status, out }); });
    }));
    const results = await Promise.all(runs);
    const bad = results.filter((r) => r.status !== 0);
    assert(!bad.length, '\n' + bad.map((r) => r.out.split('\n').filter((l) => !l.includes('✓')).join('\n')).join('\n'));
    // The Duo resize/rotation/fold blocks only exist when the file runs as its own process (these shards). Fail loudly if they stop running.
    const ran = results.map((r) => r.out).join('\n');
    const count = (ran.match(/✓ layout:/g) || []).length;
    assert(count >= 30, `only ${count} layout tests ran in the shards (expected 30+); the Duo blocks may have been skipped`);
    assert(/✓ layout: [^\n]*(fold|resize)/i.test(ran), 'the fold/resize harness test did not run in the shards');
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
  test('layout: Today Food row: text never runs under Log food at 320, 375, 390 and 890, text size 1 to 1.35', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const found = new Map();
    const note = (msg, at) => found.set(msg, [...(found.get(msg) || []), at]);
    for (const [w, h] of [[320, 568], [375, 667], [390, 844], [890, 626]]) {
      for (const ts of [1, 1.12, 1.35]) {
        await browser.viewport(w, h, true);
        await browser.open('today', seed({ over: true }));
        if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await wait(300); }
        const m = await browser.eval(`(() => {
          const row = document.querySelector('#main .food-row-compact'); if (!row) return null;
          const box = row.querySelector('.food-card-text').getBoundingClientRect(), lb = row.querySelector('[data-food-log]').getBoundingClientRect(), rg = row.querySelector('.food-card-ring').getBoundingClientRect();
          const lines = (e) => { const r = document.createRange(); r.selectNodeContents(e); const rs = [...r.getClientRects()].filter((q) => q.width > 0.5); return { n: rs.length ? (Math.max(...rs.map((q) => q.bottom)) - Math.min(...rs.map((q) => q.bottom)) > 8 ? 2 : 1) : 0, right: rs.reduce((a, q) => Math.max(a, q.right), 0) }; };
          const ps = [...row.querySelectorAll('.food-card-text p')].map(lines);
          return { kcal: lines(row.querySelector('.food-card-kcal')).n, nb: [...row.querySelectorAll('.nb')].map((e) => lines(e).n), right: Math.max(...ps.map((p) => p.right)), boxR: box.right, logL: lb.left, logW: lb.width, logH: lb.height, dy: Math.abs((rg.top + rg.bottom) / 2 - (lb.top + lb.bottom) / 2) };
        })()`);
        const at = `${w}x${h}${ts !== 1 ? ' ts' + ts : ''}`;
        if (!m) { note('no Food row on Today', at); continue; }
        if (ts === 1 && m.kcal !== 1) note('headline wraps at normal text size', at);
        if (ts === 1 && m.nb.some((n) => n !== 1)) note('a note phrase wraps at normal text size', at);
        if (m.right > m.boxR + 0.5) note('text runs past its box', at);
        if (m.right > m.logL - 4) note('text runs under Log food', at);
        if (m.dy > 8) note('ring and Log food are not on one row', at);
        if (m.logW < 43.5 || m.logH < 43.5) note('Log food is under 44x44', at);
      }
    }
    assert(found.size === 0, `\n        ${[...found].map(([p, at]) => `${p}  [${at.join(' | ')}]`).join('\n        ')}`);
  });

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

  test('layout: Log food list scrolls to its last row and Add stays on screen (medium, large, keyboard, Duo inner)', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const found = new Map();
    const note = (msg, at) => found.set(msg, [...(found.get(msg) || []), at]);
    const many = seed({ over: true });
    for (let i = 0; i < 40; i++) many.foods.push({ ...many.foods[0], id: `fx${i}`, name: `Synthetic food ${i}` });
    // tall: unhide the USDA portion block (the worst-case dock; USDA itself is blocked in the test browser); 'kb': shrink the viewport by 336px
    const cases = [[390, 844, 1, false, 'medium'], [390, 844, 1, false, 'large'], [320, 568, 1.35, true, 'large'], [375, 667, 1, true, 'large'], [390, 844, 1, 'kb', 'large'], [626, 890, 1, false, 'inner']];
    for (const [w, h, ts, tall, mode] of cases) {
      await browser.viewport(w, h, true);
      if (mode === 'medium') await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
      await browser.open('food', many);
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await wait(300); }
      await browser.eval("document.querySelector('[data-log-food]').click()"); await wait(900);
      const at = `${w}x${h}${ts !== 1 ? 'T' : ''} ${mode}${tall === 'kb' ? ' kb' : ''}`;
      const list = await browser.eval(`(() => {
        const sc = document.querySelector('dialog.sheet .food-scroll'); if (!sc) return null;
        sc.scrollTop = sc.scrollHeight; const rows = sc.querySelectorAll('li[data-i]'); const last = rows[rows.length - 1].getBoundingClientRect(), b = sc.getBoundingClientRect();
        return { scrolls: sc.scrollHeight > sc.clientHeight + 1, lastIn: last.bottom <= b.bottom + 1 && last.top >= b.top - 1 };
      })()`);
      if (!list) { note('no food list', at); continue; }
      if (!list.scrolls) note('food list does not scroll', at);
      if (!list.lastIn) note('last row cannot be scrolled into view', at);
      await browser.eval("document.querySelector('dialog.sheet [data-results] li[data-i]').click()"); await wait(900);
      if (tall) await browser.eval("(() => { const p = document.querySelector('dialog.sheet [data-portion]'); p.hidden = false; p.querySelectorAll('[hidden]').forEach((e) => { e.hidden = false; }); })()");
      if (tall === 'kb') await browser.viewport(w, h - 336, true);
      await wait(400);
      const r = await browser.eval(`(() => {
        const add = document.querySelector('dialog.sheet [data-add]'); if (!add) return null;
        const a = add.getBoundingClientRect(), d = document.querySelector('dialog.sheet .food-dock').getBoundingClientRect(), sc = document.querySelector('dialog.sheet .food-scroll'), b = sc.getBoundingClientRect();
        return { top: a.top, bottom: a.bottom, vh: innerHeight, over: b.bottom > d.top + 1 };
      })()`);
      if (!r) { note('Add missing', at); continue; }
      if (r.top < 0 || r.bottom > r.vh + 0.5) note(`Add is off screen (${Math.round(r.top)}-${Math.round(r.bottom)} of ${r.vh})`, at);
      if (r.over) note('the list runs under the dock', at);
    }
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert(found.size === 0, `\n        ${[...found].map(([p, at]) => `${p}  [${at.join(' | ')}]`).join('\n        ')}`);
  });

  test('layout: Log food with a pick never rests at medium, the dock is not clipped (reduced motion, Duo, focus ring)', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const found = new Map();
    const note = (msg, at) => found.set(msg, [...(found.get(msg) || []), at]);
    const many = seed({ over: true });
    for (let i = 0; i < 40; i++) many.foods.push({ ...many.foods[0], id: `fx${i}`, name: `Synthetic food ${i}` });
    const clipped = "(() => { const m = document.querySelector('dialog.sheet .food-dock-main'); return m ? m.scrollHeight - m.clientHeight : null; })()";
    // [w, h, drag the grabber down, reduced motion, label]
    const cases = [[390, 844, true, false, '390 drag'], [375, 667, true, false, '375 drag'], [390, 844, false, true, '390 reduced'], [390, 844, false, false, '390 large'], [375, 667, false, false, '375'], [466, 678, false, false, 'Duo folded'], [626, 890, false, false, 'Duo inner']];
    for (const [w, h, drag, reduce, at] of cases) {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
      await browser.viewport(w, h, true);
      await browser.open('food', many);
      await browser.eval("document.querySelector('[data-log-food]').click()"); await wait(900);
      await browser.eval("document.querySelector('dialog.sheet [data-results] li[data-i]').click()"); await wait(900);
      if (drag) {
        const g = await browser.eval("(() => { const r = document.querySelector('dialog.sheet .sheet-grab').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
        const mouse = (type, y) => browser.send('Input.dispatchMouseEvent', { type, x: g.x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
        await mouse('mouseMoved', g.y); await mouse('mousePressed', g.y);
        for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', g.y + i * 20); await wait(16); }
        await mouse('mouseReleased', g.y + 120); await wait(1200);
        if (await browser.eval("document.querySelector('dialog.sheet')?.classList.contains('at-medium') || false")) note('the sheet rests at medium with a food picked', at);
      }
      const over = await browser.eval(clipped);
      if (over == null) { note('food dock missing', at); continue; }
      if (over > 1) note(`the dock content is clipped by ${over}px`, at);
      const ring = await browser.eval(`(() => {
        const a = document.querySelector('dialog.sheet [data-amount]'), m = document.querySelector('dialog.sheet .food-dock-main'); if (!a || a.offsetParent === null) return true;
        a.focus(); const r = a.getBoundingClientRect(), b = m.getBoundingClientRect();
        return r.left - 3 >= b.left && r.right + 3 <= b.right && r.top - 3 >= b.top && r.bottom + 3 <= b.bottom;
      })()`);
      if (!ring) note('the focused amount ring is clipped by the dock scroller', at);
    }
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert(found.size === 0, `\n        ${[...found].map(([p, at]) => `${p}  [${at.join(' | ')}]`).join('\n        ')}`);
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

if (standalone) {
  test('layout: #/metric/steps with sets on keeps stats, switch row and legend on one line, no overflow', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const found = new Map();
    for (const [w, h] of [[320, 568], [390, 844], [466, 678], [626, 890], [890, 626]]) for (const ts of [1, 1.35]) {
      await browser.viewport(w, h, true);
      await browser.open('metric/steps', seed());
      await browser.eval("(() => { const c = document.querySelector('input[name=sets]'); if (c && !c.checked) c.click(); })()");
      await new Promise((r) => setTimeout(r, 300));
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
      const r = await browser.eval(`(() => {
        const lines = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); return new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round((q.top + q.bottom) / 2 / 6))).size; };
        const stats = [...document.querySelectorAll('.stats-m span')];
        const tops = [...document.querySelectorAll('.stats-m b')].map((b) => Math.round(b.getBoundingClientRect().top));
        const sw = document.querySelector('.g-row.sw .g-text > span');
        const spread = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); const c = [...rg.getClientRects()].filter((q) => q.width > 0).map((q) => (q.top + q.bottom) / 2); return Math.max(...c) - Math.min(...c); };
        const groups = [...document.querySelectorAll('.legend .nw')];
        return { none: !stats.length || !sw, wrapStat: stats.filter((e) => lines(e) > 1).map((e) => e.textContent), baseline: new Set(tops).size > 1, wrapSwitch: sw ? lines(sw) > 1 : false, wrapLegend: groups.filter((e) => spread(e) > 8).length, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
      })()`);
      const at = `${w}${ts !== 1 ? 'T' : ''}`;
      const add = (m) => found.set(m, [...(found.get(m) || []), at]);
      if (r.none) { add('metric card missing stats or switch'); continue; }
      if (r.wrapStat.length) add(`stat label wraps: ${r.wrapStat.join(', ')}`);
      if (r.baseline) add('stat values are not on one baseline');
      if (r.wrapSwitch) add('switch label wraps');
      if (r.wrapLegend) add('a legend group wraps');
      if (r.overflow) add('horizontal overflow');
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
for (const route of standalone ? ['today', 'train', 'body', 'play', 'score', 'food', 'settings'] : []) {
  if (only && !only.includes(route)) continue;
  test(`layout: ${route}: wide canvas has the right columns, a full-width tab bar, and respects left/right insets`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const bad = [];
    let base = new Set(); // what already wraps on a 390 phone isn't a wide-layout problem
    for (const pin of (route === 'today' ? DAYS : [WORKOUT_DAY])) for (const [w, h] of [[390, 844], ...WIDE]) for (const inset of (w > h ? [0, 47] : [0])) { // side insets only exist in landscape
      await browser.viewport(w, h, true);
      await browser.open(route, seed({ active: route === 'play', ...onDay(pin) }), '', { at: pin });
      if (inset) { await browser.eval(`document.documentElement.style.setProperty('--safe-left', '${inset}px'); document.documentElement.style.setProperty('--safe-right', '${inset}px'); document.documentElement.style.setProperty('--safe-bottom', '${SAFE_BOTTOM}px')`); await wait(300); }
      const at = `${route === 'today' ? pin.slice(5, 10) + ' ' : ''}${w}x${h}${inset ? ' inset ' + inset : ''}`;
      const m = await browser.eval(`(() => {
        const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
        const a = document.querySelector('#main .col-a, #main .pl-col-a, #main .set-nav'), b = document.querySelector('#main .col-b, #main .pl-col-b, #main .set-panes');
        const out = [];
        document.querySelectorAll('#main a[href], #main button, #main .card, #nav a').forEach((e) => {
          const q = e.getBoundingClientRect();
          if (q.width < 1 || q.height < 1 || getComputedStyle(e).visibility === 'hidden') return;
          if (q.left < ${inset} - 0.5 || q.right > innerWidth - ${inset} + 0.5) out.push((e.className || e.tagName) + ' ' + Math.round(q.left) + '-' + Math.round(q.right));
        });
        const wrap = [];
        const lineCount = (e) => { const g = document.createRange(); g.selectNodeContents(e); const k = [...g.getClientRects()].filter((x) => x.width > 0).map((x) => x.top); return k.length && Math.max(...k) - Math.min(...k) > 6 ? 2 : 1; }; /* a spread, not rounding buckets: an icon centred beside text differs by under a pixel and a bucket edge could split them */
        document.querySelectorAll('#main .weight-text .hero-num, #main .weight-text [data-weight-trend] .nw, #main .rings-card > .row a, #main .food-card-kcal b, #main [data-weight-why]').forEach((e) => {
          if (e.getBoundingClientRect().width < 1) return;
          if (lineCount(e) > 1) wrap.push('wraps: ' + (e.className || e.tagName) + ' "' + e.textContent.trim().slice(0, 24) + '"');
          if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline') wrap.push('overflows: ' + (e.className || e.tagName));
        });
        const kc = document.querySelector('#main .food-card-kcal'); if (kc && (() => { const g = document.createRange(); g.selectNodeContents(kc); const k = [...g.getClientRects()].filter((x) => x.width > 0).map((x) => x.bottom); return k.length && Math.max(...k) - Math.min(...k) > 8; })()) wrap.push('wraps: food headline');
        const ht = document.querySelector('#main .weight-text [data-weight-trend]'); if (ht && lineCount(ht) > 1) wrap.push('wraps: weight trend line');
        const rw = document.querySelector('#main .rings-card > .row'); if (rw) { const k = [...rw.children].map((c) => c.getBoundingClientRect().top); if (Math.max(...k) - Math.min(...k) > 6) wrap.push('wraps: rings header'); }
        const fr = document.querySelector('#main .food-row-compact'); if (fr) { const rg = fr.querySelector('.food-card-ring'), lb = fr.querySelector('[data-food-log]'); if (rg && lb) { if (Math.abs(rg.getBoundingClientRect().top - lb.getBoundingClientRect().top) > 6 && Math.abs(rg.getBoundingClientRect().bottom - lb.getBoundingClientRect().bottom) > 6 && Math.abs((rg.getBoundingClientRect().top + rg.getBoundingClientRect().bottom) - (lb.getBoundingClientRect().top + lb.getBoundingClientRect().bottom)) > 12) wrap.push('wraps: Today food row'); if (lb.getBoundingClientRect().height < 43.5) wrap.push('small: Log food'); } }
        const slots = [...document.querySelectorAll('#main .slot')].map((e) => { const c = e.firstElementChild, q = c && c.getBoundingClientRect(); return { o: Number(e.dataset.o), col: e.parentElement.classList.contains('col-a') ? 'a' : e.parentElement.classList.contains('col-b') ? 'b' : '', t: q && q.height > 1 ? q.top + scrollY : null }; });
        const done = document.querySelector('#main [data-done-label]'), dq = done && done.getBoundingClientRect();
        const ch = document.querySelector('#main svg.chart'), cq = ch && ch.getBoundingClientRect(), card = ch && ch.closest('.card'), cdq = card && card.getBoundingClientRect();
        const ordered = [...document.querySelectorAll('#main *')].filter((e) => getComputedStyle(e).order !== '0').length;
        const axis = document.querySelector('#main svg.chart .axis'), ax = axis && parseFloat(getComputedStyle(axis).fontSize) * (cq.width / ch.viewBox.baseVal.width);
        const dm = document.querySelector('#main [data-demo]'), st = document.querySelector('#main .pl-steppers'), top = (e) => e ? e.getBoundingClientRect().top : null;
        const dom = a && b ? !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
        const h1 = document.querySelector('#main h1'), tabs = [...document.querySelectorAll('#nav a')].map((e) => e.getBoundingClientRect().height);
        const rows = [...document.querySelectorAll('#main .set-nav [data-pane]')], lastRow = rows.length ? rows[rows.length - 1].getBoundingClientRect() : null;
        return { h1: h1 && { fs: parseFloat(getComputedStyle(h1).fontSize), h: h1.getBoundingClientRect().height }, tabH: tabs, lastRowB: lastRow && lastRow.bottom, tabTop: document.getElementById('nav').getBoundingClientRect().top, scrollH: document.documentElement.scrollHeight, demoTop: top(dm), stepTop: top(st), dom: dom, ordered: ordered, doneBox: dq && { t: dq.top, b: dq.bottom }, chart: cq && { w: cq.width, ar: cq.width / cq.height, vb: ch.viewBox.baseVal.width / ch.viewBox.baseVal.height }, card: cdq && { w: cdq.width }, axisPx: ax, vh: innerHeight, slots: slots, wrap: wrap, main: r(document.getElementById('main')), tab: r(document.getElementById('nav')), a: r(a), b: r(b), out: out.slice(0, 4), vw: innerWidth };
      })()`);
      if (route !== 'play' && (Math.abs(m.tab.l) > 1 || Math.abs(m.tab.r - m.vw) > 1)) bad.push(`${at}: tab bar ${Math.round(m.tab.l)}-${Math.round(m.tab.r)} is not full width (${m.vw})`);
      const cols = route === 'today' || route === 'train' || route === 'body' || route === 'food' || route === 'score' || route === 'play' || route === 'settings';
      if (!cols && route !== 'body' && m.main.r - m.main.l > 560 + 1) bad.push(`${at}: ${route} stretched to ${Math.round(m.main.r - m.main.l)}px, should stay a 560px column`);
      if (w === 390 && !inset) base = new Set(m.wrap);
      const fresh = m.wrap.filter((x) => !base.has(x));
      if (fresh.length) bad.push(`${at}: ${fresh.join(', ')}`);
      if (m.out.length) bad.push(`${at}: sits inside the inset: ${m.out.join(', ')}`);
      if (route === 'today') { // reading order (VoiceOver, Tab) must match the screen: DOM order = visual order on a phone, and the right column per card on two columns
        const shown = m.slots.filter((x) => x.t != null);
        if (w < 840 && m.slots.map((x) => x.o).join() !== '1,2,3,4,5,6,7,8,9,10') bad.push(`${at}: Today's cards are not in phone order in the DOM: ${m.slots.map((x) => x.o)}`);
        if (w < 840) for (let i = 1; i < shown.length; i++) if (shown[i].t < shown[i - 1].t - 1) bad.push(`${at}: Today card ${shown[i].o} sits above card ${shown[i - 1].o} on screen but after it in the DOM`);
        if (w >= 840) for (const x of m.slots) if (x.col !== ([1, 3, 5].includes(x.o) ? 'a' : 'b') && !([6, 9].includes(x.o) && x.col)) // 6 and 9 (coach line, insights) go on the shorter side
          bad.push(`${at}: Today card ${x.o} is in column ${x.col || 'none'}`);
        if (w >= 840) for (const col of ['a', 'b']) { const o = m.slots.filter((x) => x.col === col).map((x) => x.o); if (o.join() !== [...o].sort((p, q) => p - q).join()) bad.push(`${at}: column ${col} is out of phone order: ${o}`); }
      }
      if (route === 'settings') { // list left, selected section right; a phone keeps the whole page (list hidden, every section shown)
        const st = await browser.eval(`(() => ({ cur: [...document.querySelectorAll('#main .set-nav [aria-selected="true"]')].map((e) => e.dataset.pane), shown: [...document.querySelectorAll('#main .set-pane')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.id), navW: document.querySelector('#main .set-nav').getBoundingClientRect().width }))()`);
        if (w >= 840) {
          if (st.cur.join() !== 'general') bad.push(`${at}: the first section should be selected, got ${st.cur}`);
          if (st.shown.join() !== 'set-general') bad.push(`${at}: only the selected section should show, got ${st.shown}`);
          if (Math.abs(st.navW - 300) > 2) bad.push(`${at}: the list is ${Math.round(st.navW)}px wide, should be about 300`);
          await browser.eval("document.querySelector('#main .set-nav [data-pane=connections]').click()");
          const st2 = await browser.eval("[...document.querySelectorAll('#main .set-pane')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.id).join()");
          if (st2 !== 'set-connections') bad.push(`${at}: picking Connections shows ${st2}`);
          await browser.eval("document.querySelector('#main .set-nav [data-pane=general]').click()");
        } else {
          if (st.navW > 1) bad.push(`${at}: the section list should be hidden on a phone`);
          if (st.shown.length !== 5) bad.push(`${at}: a phone shows every section, got ${st.shown}`);
        }
      }
      if (route === 'body' || route === 'play') { // reading order is the screen order: left column first in the DOM, and no CSS order anywhere
        if (m.dom === false) bad.push(`${at}: the left column comes after the right in the DOM`);
        if (m.ordered) bad.push(`${at}: ${m.ordered} elements use CSS order`);
      }
      if (route === 'play' && w >= 840 && m.demoTop != null && m.stepTop != null && Math.abs(m.demoTop - m.stepTop) > 4) bad.push(`${at}: demo top ${Math.round(m.demoTop)} and steppers top ${Math.round(m.stepTop)} do not line up`);
      if (shortLand0(w, h)) { // compact title and slim tab bar (nav.css), and the Settings list clears the bar
        if (m.h1 && (Math.abs(m.h1.fs - 24) > 0.5 || Math.abs(m.h1.h - 30) > 1)) bad.push(`${at}: the title is ${m.h1.fs}px font / ${Math.round(m.h1.h)}px tall, should be 24 / 30`);
        if (route !== 'play' && (!m.tabH.length || m.tabH.some((x) => Math.abs(x - 44) > 0.5))) bad.push(`${at}: tab items are ${m.tabH.map(Math.round)} px tall, should be 44`);
        if (route === 'settings' && w >= 840 && m.lastRowB != null && m.lastRowB > m.tabTop + 0.5) bad.push(`${at}: the last Settings row ends at ${Math.round(m.lastRowB)}, under the tab bar (${Math.round(m.tabTop)})`);
      }
      if (route === 'play' && shortLand0(w, h) && m.scrollH > m.vh + 1) bad.push(`${at}: the player scrolls (${m.scrollH} > ${m.vh}), Done set, steppers and target should fit`);
      if (route === 'play' && m.doneBox && (m.doneBox.t < 0 || m.doneBox.b > m.vh + 0.5)) bad.push(`${at}: Done set is not in view (${Math.round(m.doneBox.t)}-${Math.round(m.doneBox.b)} of ${m.vh})`);
      if (route === 'body' && m.chart) { // charts take the card's width, keep their proportions, and keep phone-size axis text
        if (w >= 840 && m.main.r - m.main.l <= 560 + 1) bad.push(`${at}: Progress did not widen (${Math.round(m.main.r - m.main.l)}px)`);
        if (m.chart.w < m.card.w - 40) bad.push(`${at}: chart ${Math.round(m.chart.w)}px is not the card's full width (${Math.round(m.card.w)})`);
        if (Math.abs(m.chart.ar - m.chart.vb) > 0.02) bad.push(`${at}: chart aspect ${m.chart.ar.toFixed(2)} differs from its drawing ${m.chart.vb.toFixed(2)}`);
        if (w >= 840 && Math.abs(m.axisPx - 11) > 1.5) bad.push(`${at}: chart axis text is ${m.axisPx.toFixed(1)}px, should stay 11px`);
      }
      if (!cols) continue;
      const two = m.a && m.b && m.a.r - m.a.l > 1 && m.b.r - m.b.l > 1 && m.b.l >= m.a.r - 0.5 && Math.abs(m.a.t - m.b.t) < (route === 'settings' ? 40 : 4); // (the Settings list sits a little higher than its pane in short landscape)
      const minCol = w >= 880 ? 340 : 320; // an 844 phone sideways with 47px insets has 750px for two columns
      const shortLand = route === 'play' && w >= 600 && h <= 500; // item 29: the player goes two-column on the short outer screen sideways
      if ((w >= 840 || shortLand) && !two) bad.push(`${at}: not two columns`);
      if (w < 840 && !shortLand && two) bad.push(`${at}: should stay one column`);
      if (w >= 840 && two && route !== 'settings' && m.a.r - m.a.l < minCol) bad.push(`${at}: left column ${Math.round(m.a.r - m.a.l)}px is narrower than ${minCol}px`);
      if (w >= 840 && two && m.b.r - m.b.l < minCol) bad.push(`${at}: right column ${Math.round(m.b.r - m.b.l)}px is narrower than ${minCol}px`);
      if (route === 'today' && w >= 840 && two && Math.abs(m.a.b - m.b.b) > 120) bad.push(`${at}: Today's columns end ${Math.round(Math.abs(m.a.b - m.b.b))}px apart (left ${Math.round(m.a.b)}, right ${Math.round(m.b.b)}), should be within 120px`);
      if (w >= 840 && two && m.b.l - m.a.r < 24) bad.push(`${at}: gutter ${Math.round(m.b.l - m.a.r)}px is under 24px`);
    }
    assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
  });
}

if (standalone) {
  test('layout: Weight at 890x626: charts stay phone-size after a range change, and the chart fits the screen with its range picker', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await browser.viewport(890, 626, true);
    await browser.open('body', seed({}));
    const probe = () => browser.eval(`(() => {
      const ch = document.querySelector('#main svg.chart'), q = ch.getBoundingClientRect(), ax = ch.querySelector('.axis');
      const pick = document.querySelector('#main .seg.small').getBoundingClientRect();
      return { axis: parseFloat(getComputedStyle(ax).fontSize) * (q.width / ch.viewBox.baseVal.width), h: q.height, vh: innerHeight, pickTop: pick.top, chartBottom: q.bottom, bar: document.getElementById('nav').getBoundingClientRect().top };
    })()`);
    const bad = [];
    const a = await probe();
    if (a.h > a.vh * 0.45) bad.push(`chart is ${Math.round(a.h)}px tall, more than 45% of ${a.vh}`);
    if (a.pickTop < 0 || a.chartBottom > a.bar + 0.5) bad.push(`range picker (${Math.round(a.pickTop)}) and chart (bottom ${Math.round(a.chartBottom)}) do not fit above the tab bar (${Math.round(a.bar)})`);
    for (const v of ['30', '90', '0']) {
      await browser.eval(`document.querySelector('#main input[name=range][value="${v}"]').click()`);
      await wait(400);
      const r = await probe();
      if (Math.abs(r.axis - 11) > 1.5) bad.push(`axis text is ${r.axis.toFixed(1)}px after choosing range ${v}, should stay 11px`);
    }
    assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
  });
}

if (standalone) {
  test('layout: Trends, Score and Week: two columns from 840, one below, same tab control width, no CSS order, no card past ~560px', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const bad = [];
    for (const [w, h] of [[390, 844], [678, 466], [890, 626]]) {
      const segs = [];
      for (const route of ['trends', 'score', 'weekly']) {
        await browser.viewport(w, h, true);
        await browser.open(route, seed({}));
        await wait(300);
        const at = `${w}x${h} ${route}`;
        const m = await browser.eval(`(() => {
          const q = (e) => e && e.getBoundingClientRect();
          const a = document.querySelector('#main .pg-cols > .col-a'), b = document.querySelector('#main .pg-cols > .col-b');
          const rows = [...document.querySelectorAll('#main .trend-row')].map((e) => q(e));
          const cards = [...document.querySelectorAll('#main .card')].filter((e) => !e.querySelector('.score-hero, svg.chart')).map((e) => q(e).width);
          return { seg: q(document.querySelector('#main .progress-seg')).width, a: a && { l: q(a).left, r: q(a).right, t: q(a).top, b: q(a).bottom }, b: b && { l: q(b).left, r: q(b).right, t: q(b).top, b: q(b).bottom },
            ltIn: !!document.querySelector('#main .col-a [data-longterm-slot]'),
            phoneOrder: (() => { const kids = [...document.querySelectorAll('#main .pg-cols > .col-a > *, #main .pg-cols > .col-b > *')].map((e) => e.matches('.pillar-grid') ? 'pillars' : e.matches('[data-longterm-slot]') ? 'longterm' : e.matches('details') ? 'how' : e.querySelector('.score-hero') ? 'hero' : ''); const i = kids.indexOf('pillars'), j = kids.indexOf('longterm'), k = kids.indexOf('how'); return i >= 0 && i < j && j < k && kids.indexOf('hero') < i; })(),
            hair: [...document.querySelectorAll('#main .trend-list .g-row')].filter((e) => Math.abs(q(e).top - q(e.parentElement).top) < 1 && getComputedStyle(e, '::before').display !== 'none' && getComputedStyle(e, '::before').content !== 'none').length,
            dom: a && b ? !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
            rowL: rows.length ? [...new Set(rows.map((r) => Math.round(r.left)))].length : 0, rowW: rows.length ? Math.max(...rows.map((r) => r.width)) : 0,
            ordered: [...document.querySelectorAll('#main *')].filter((e) => getComputedStyle(e).order !== '0').length, cards: Math.max(0, ...cards), vw: innerWidth };
        })()`);
        segs.push(m.seg);
        if (m.ordered) bad.push(`${at}: ${m.ordered} elements use CSS order`);
        if (route !== 'body' && w >= 840 && m.cards > 561) bad.push(`${at}: a card is ${Math.round(m.cards)}px wide`);
        if (route === 'score' || route === 'weekly') {
          if (!m.a || !m.b) { bad.push(`${at}: no columns found`); continue; }
          if (!m.dom) bad.push(`${at}: left column is after the right in the DOM`);
          const two = m.a.r - m.a.l > 1 && m.b.l >= m.a.r - 0.5 && Math.abs(m.a.t - m.b.t) < 4;
          if (w >= 840 && !two) bad.push(`${at}: not two columns`);
          if (route === 'score') {
            if (w >= 840 && Math.abs(m.a.b - m.b.b) > 150) bad.push(`${at}: columns end ${Math.round(Math.abs(m.a.b - m.b.b))}px apart`);
            if (w >= 840 && !m.ltIn) bad.push(`${at}: Long term is not in the left column`);
            if (w < 840 && (m.ltIn || !m.phoneOrder)) bad.push(`${at}: phone order changed (hero, movers, pillars, ..., Long term, Longevity)`);
          }
          if (w < 840 && two) bad.push(`${at}: should be one column`);
        }
        if (route === 'trends') {
          if (w >= 840 && m.rowL < 2) bad.push(`${at}: rows are not in two columns`);
          if (w >= 840 && m.hair) bad.push(`${at}: ${m.hair} trend row(s) at the card top show a separator`);
          if (w >= 840 && m.rowW > 561) bad.push(`${at}: a trend row is ${Math.round(m.rowW)}px wide`);
          if (w < 840 && m.rowL > 1) bad.push(`${at}: rows should be one column`);
        }
      }
      if (Math.max(...segs) - Math.min(...segs) > 1) bad.push(`${w}x${h}: tab control width differs between tabs: ${segs.map(Math.round)}`);
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

// Today's two columns should end at about the same height, and the phone order must not change.
if (standalone) {
  test('layout: Today columns end within 120px of each other at 890x626 and 932x430, and the phone order is unchanged at 390x844', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const bad = [];
    const measure = `(() => {
      const a = document.querySelector('.col-a'), b = document.querySelector('.col-b');
      const end = (c) => (c ? Math.round(c.getBoundingClientRect().bottom + scrollY) : null);
      return { a: end(a), b: end(b), order: [...document.querySelectorAll('[data-today-cols] .slot')].map((s) => s.dataset.o).join(',') };
    })()`;
    for (const at of DAYS) for (const [w, h] of [[890, 626], [932, 430], [844, 390], [874, 402]]) {
      await browser.viewport(w, h, true);
      await browser.open('today', seed(onDay(at)), '', { at });
      const m = await browser.eval(measure);
      const where = `${at.slice(0, 10)} ${w}x${h}`;
      if (m.a == null || m.b == null) bad.push(`${where}: no two columns`);
      else if (Math.abs(m.a - m.b) > 120) bad.push(`${where}: columns end ${m.a}px and ${m.b}px down (${Math.abs(m.a - m.b)}px apart)`);
    }
    await browser.viewport(390, 844, true);
    await browser.open('today', seed());
    const p = await browser.eval(measure);
    const nums = p.order.split(',').map(Number);
    if (p.a != null || nums.some((n, i) => i && n < nums[i - 1])) bad.push(`390x844: phone order changed: ${p.order}`);
    assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
  });
}

// The player's "Next: name · Set 2 of 3" keeps its dot on one line, and never starts a wrapped second line with it.
if (standalone) {
  test('layout: player Next line has the separator dot only when the set stays on the same line', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const bad = [];
    let sawDot = false;
    for (const [w, h] of [[390, 844], [466, 678], [626, 890], [844, 390], [890, 626], [932, 430]]) {
      await browser.viewport(w, h, true);
      await browser.open('play', seed({ active: true }));
      const r = await browser.eval(`(() => {
        const line = document.querySelector('.pl-next'), name = line && line.querySelector('.pl-next-name'), meta = line && line.querySelector('.pl-next-meta');
        if (!meta) return null;
        return { wrapped: meta.offsetTop > name.offsetTop + 2, dot: getComputedStyle(meta, '::before').visibility === 'hidden' ? '' : getComputedStyle(meta, '::before').content };
      })()`);
      if (!r) continue; // "Last one" has no dot to check
      const hasDot = r.dot.includes('·');
      if (r.wrapped && hasDot) bad.push(`${w}x${h}: a wrapped second line starts with the dot`);
      if (!r.wrapped && !hasDot) bad.push(`${w}x${h}: the Next line is on one line but has no dot`);
      if (hasDot) sawDot = true;
    }
    if (!sawDot) bad.push('no size showed the dot (is there a Next exercise in the seed?)');
    assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
  });
}

// Folding or unfolding the Duo mid-session (item 31): the same route, the same card at the top, sheets and timers carry on.
if (standalone) {
  test('layout: resizing 466x678 → 626x890 → 890x626 → 466x678 keeps the route, scroll spot, sheet, focus and rest timer', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const CHAIN = [[626, 890], [890, 626], [466, 678]];
    const bad = [];
    const errs0 = browser.errors.length;
    // 1. Today, scrolled so the Food card is at the top
    await browser.viewport(466, 678, true);
    await browser.open('today', seed());
    const topOfFood = "(() => { const e = document.querySelector('[data-test-top]'); return e ? Math.round(e.getBoundingClientRect().top) : null; })()";
    await browser.eval("(() => { const e = document.querySelector('[data-food-card]'); const bar = document.querySelector('.navbar'); window.scrollBy({ top: e.getBoundingClientRect().top - (bar ? bar.getBoundingClientRect().bottom : 0) - 4, behavior: 'instant' }); })()");
    await wait(400);
    // the card the reader sees first (the Food card here); it has to stay put through every size
    assert(await browser.eval("import('./js/ui/anchor.js').then((m) => { const a = m.pickAnchor(); if (a) a.el.setAttribute('data-test-top', ''); return !!a && !!a.el.closest('[data-food-card]') || (a && a.el.matches('[data-food-card]')); })"), 'the top card at the start should be the Food card');
    const before = await browser.eval(topOfFood);
    for (const [w, h] of CHAIN) {
      await browser.viewport(w, h, true);
      await wait(500);
      const route = await browser.eval('location.hash');
      const now = await browser.eval(topOfFood);
      if (route !== '#/today') bad.push(`today: route became ${route} at ${w}x${h}`);
      if (now == null || Math.abs(now - before) > 16) bad.push(`today: the top card moved from ${before}px to ${now}px from the top at ${w}x${h}`);
    }
    // 2. the player mid-rest
    await browser.viewport(466, 678, true);
    await browser.open('play', seed({ active: true }));
    await browser.eval("document.querySelector('[data-done]').click()"); // finishing a set starts the rest
    await wait(1500);
    const left0 = await browser.eval("document.querySelector('[data-restclock]') ? 1 : 0");
    if (!left0) bad.push('player: the rest screen did not show');
    const rest0 = await browser.eval("import('./js/timer.js').then((m) => m.restInfo().left)");
    for (const [w, h] of CHAIN) {
      await browser.viewport(w, h, true);
      await wait(600);
      const info = await browser.eval("import('./js/timer.js').then((m) => { const r = m.restInfo(); return r ? { left: r.left, paused: r.paused } : null; })");
      if (!info || info.paused || !(info.left < rest0) || info.left <= 0) bad.push(`player: the rest timer stopped or reset at ${w}x${h}: ${JSON.stringify(info)} (was ${rest0})`);
      if (!(await browser.eval("location.hash.startsWith('#/play')"))) bad.push(`player: left the player at ${w}x${h}`);
      if (!(await browser.eval("!!document.querySelector('[data-restclock]')"))) bad.push(`player: the rest screen vanished at ${w}x${h}`);
    }
    // 3. the Log weight sheet, with its field focused
    await browser.viewport(466, 678, true);
    await browser.open('today', seed());
    await browser.eval("document.querySelector('[data-log]').click()");
    await wait(800);
    const focusOf = "(() => { const a = document.activeElement; return a && a.closest && a.closest('dialog.sheet') ? (a.tagName + (a.name || a.id || '')) : null; })()";
    const f0 = await browser.eval(focusOf);
    for (const [w, h] of CHAIN) {
      await browser.viewport(w, h, true);
      await wait(500);
      if (!(await browser.eval("!!document.querySelector('dialog.sheet[open]')"))) { bad.push(`sheet: closed at ${w}x${h}`); break; }
      const fits = await browser.eval("(() => { const r = document.querySelector('dialog.sheet[open]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; })()");
      if (!fits) bad.push(`sheet: does not fit the screen at ${w}x${h}`);
      if (f0 && (await browser.eval(focusOf)) !== f0) bad.push(`sheet: the focused field lost focus at ${w}x${h}`);
    }
    const errs = browser.errors.slice(errs0).filter((e) => !/Failed to load resource|net::ERR/.test(e));
    if (errs.length) bad.push(`console errors: ${errs.slice(0, 3).join(' | ')}`);
    assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
  });
}

// WebKit has no CSS scroll anchoring, so anchor.js alone must keep the card in place: switch Chromium's off and chase the same
// element through fold → unfold → rotate → fold on each screen. A height-only resize (the keyboard) must not move the page.
if (standalone) {
  test('layout: the same card stays put through a fold round trip without browser scroll anchoring, and the keyboard does not scroll', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const CHAIN = [[626, 890], [890, 626], [466, 678]];
    const bad = [];
    const topOf = "(() => { const e = document.querySelector('[data-test-top]'); return e ? Math.round(e.getBoundingClientRect().top) : null; })()";
    const noAnchoring = "(() => { const s = document.createElement('style'); s.textContent = 'html, body, * { overflow-anchor: none !important }'; document.head.append(s); })()";
    for (const route of ['today', 'body', 'score', 'trends']) {
      await browser.viewport(466, 678, true);
      await browser.open(route, seed());
      await browser.eval(noAnchoring);
      // The seeded Trends page fits at 626x890 with nothing to scroll; pad it with extra cards, like a longer history would,, so the card it follows can stay put.
      if (route === 'trends') await browser.eval("(() => { for (let i = 0; i < 8; i++) { const d = document.createElement('div'); d.className = 'card'; d.style.height = '240px'; document.querySelector('#main section').append(d); } })()");
      // scroll about 45% down (25% on Score, whose wide page is much shorter, so the card has to stay reachable); on Today, to a card that lands in the right column when wide
      const picked = await browser.eval(`(async () => {
        const bar = document.querySelector('.navbar'); const inset = bar ? bar.getBoundingClientRect().bottom : 0;
        let target = ${route === 'today' ? "document.querySelector('.slot[data-o=\"6\"]')" : 'null'};
        if (!target) window.scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) * ${route === 'score' ? 0.25 : 0.45}, behavior: 'instant' });
        else window.scrollBy({ top: target.getBoundingClientRect().top - inset - 4, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, 500));
        const a = (await import('./js/ui/anchor.js')).pickAnchor();
        if (a) a.el.setAttribute('data-test-top', '');
        return !!a;
      })()`);
      if (!picked) { bad.push(`${route}: found no card to follow`); continue; }
      const before = await browser.eval(topOf);
      for (const [w, h] of CHAIN) {
        await browser.viewport(w, h, true);
        await wait(700);
        const now = await browser.eval(topOf);
        if (now == null || Math.abs(now - before) > 16) bad.push(`${route}: the card went from ${before}px to ${now}px at ${w}x${h} (${await browser.eval("(() => { const e = document.querySelector('[data-test-top]'); return e.tagName + '.' + e.className + ' ' + (e.textContent || '').trim().slice(0, 30) + ' y=' + Math.round(scrollY) + '/' + (document.documentElement.scrollHeight - innerHeight); })()")})`);
      }
    }
    // keyboard: only the height changes, with a field focused
    await browser.viewport(390, 844, true);
    await browser.open('library', seed());
    await browser.eval("document.querySelector('[data-q]').focus({ preventScroll: true })");
    const y0 = await browser.eval('Math.round(scrollY)');
    for (const h of [508, 844]) {
      await browser.viewport(390, h, true);
      await wait(500);
      const y = await browser.eval('Math.round(scrollY)');
      if (y !== y0) bad.push(`keyboard: scrollY went from ${y0} to ${y} at 390x${h}`);
    }
    assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
  });
}

// Scrolling by hand right after an unfold must stick (no snap-back from the pending restores) and become the new anchor.
if (standalone) {
  for (const delay of [150, 450]) {
    test(`layout: scrolling by hand ${delay} ms after unfolding sticks and is what a fold back keeps`, async () => {
      if (skipReason()) return;
      browser = browser || await launch();
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const bad = [];
      const topOf = "(() => { const e = document.querySelector('[data-test-top]'); return e ? Math.round(e.getBoundingClientRect().top) : null; })()";
      await browser.viewport(466, 678, true);
      await browser.open('today', seed());
      await browser.eval("(() => { const s = document.createElement('style'); s.textContent = 'html, body, * { overflow-anchor: none !important }'; document.head.append(s); })()");
      await browser.eval("window.scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) * 0.2, behavior: 'instant' })");
      await wait(600);
      await browser.viewport(890, 626, true);
      await wait(delay);
      await browser.eval("(() => { window.dispatchEvent(new WheelEvent('wheel', { deltaY: 450 })); window.scrollBy({ top: 450, behavior: 'instant' }); })()");
      await wait(60);
      const y0 = await browser.eval('Math.round(scrollY)');
      await wait(1000);
      const y1 = await browser.eval('Math.round(scrollY)');
      if (Math.abs(y1 - y0) > 2) bad.push(`scrollY went from ${y0} to ${y1} after the reader scrolled`);
      await browser.eval("import('./js/ui/anchor.js').then((m) => { const a = m.pickAnchor(); if (a) a.el.setAttribute('data-test-top', ''); })");
      const before = await browser.eval(topOf);
      await browser.viewport(466, 678, true);
      await wait(800);
      const now = await browser.eval(topOf);
      if (before == null || now == null || Math.abs(now - before) > 16) bad.push(`the top card went from ${before}px to ${now}px after folding back`);
      assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
    });
  }
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
      await browser.eval("document.querySelector('.tour-card [data-next]').click()");
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
      if (!m.empty && (m.two || /^(Food has its own tab|Settings and profile)$/.test(m.t))) { // Today and Train, plus the Food tab and avatar steps; other one-column screens keep the phone behaviour (tested above)
        const [cl, ct, cr, cb] = m.card; const [sl, st, sr, sb] = m.spot;
        const hit = cl < sr && cr > sl && ct < sb && cb > st;
        checked++;
        if (hit) bad.push(`step ${i + 1} "${m.t}": card (${[cl, ct, cr, cb].map(Math.round)}) covers the spotlight (${[sl, st, sr, sb].map(Math.round)})`);
        if ((st < 0 || sb > m.vh)) bad.push(`step ${i + 1} "${m.t}": spotlight is off-screen`);
      }
      await browser.eval("document.querySelector('.tour-card [data-next]').click()");
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

// Two-step sign-in sheets: 320/375/390 phones, the Duo folded-upright and unfolded sizes, and the wide sideways screen.
const MFA_SIZES = [[320, 568], [375, 667], [390, 844], [466, 678], [626, 890], [890, 626]];
if (standalone) {
  test('layout: two-step sign-in sheets fit, stay phone-width and centred, and do not clip', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const found = new Map();
    const note = noteTo(found);
    const probe = `(() => {
      const d = [...document.querySelectorAll('dialog.sheet[open]')].pop(); if (!d) return null;
      const r = d.getBoundingClientRect(); const body = d.querySelector('.sheet-body');
      const lines = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); return new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round((q.top + q.bottom) / 2 / 6))).size; };
      const kids = [...d.querySelectorAll('.sheet-body *')].filter((e) => e.offsetParent !== null);
      const btn = d.querySelector('[data-passwords]');
      return { left: r.left, right: r.right, w: r.width, vw: innerWidth, title: d.querySelector('h2').textContent,
        out: kids.some((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && (q.left < r.left - 0.5 || q.right > r.right + 0.5); }),
        hscroll: body.scrollWidth > body.clientWidth + 0.5, btnLines: btn ? lines(btn) : 0, btnH: btn ? btn.getBoundingClientRect().height : 0,
        keyCut: [...d.querySelectorAll('.mfa-key')].some((e) => e.scrollWidth > e.clientWidth + 0.5),
        splitGroups: [...d.querySelectorAll('.mfa-g')].filter((e) => lines(e) > 1).length,
        keyRows: new Set([...d.querySelectorAll('.mfa-g')].map((e) => Math.round(e.getBoundingClientRect().top / 4))).size,
        keyPerRow: (() => { const t = {}; d.querySelectorAll('.mfa-g').forEach((e) => { const k = Math.round(e.getBoundingClientRect().top / 4); t[k] = (t[k] || 0) + 1; }); return Object.values(t); })(),
        h2Lines: lines(d.querySelector('h2')),
        hyphenEnds: (() => { let n = 0; const w = document.createTreeWalker(d, NodeFilter.SHOW_TEXT); let nd; while ((nd = w.nextNode())) { const t = nd.textContent; for (let i = 0; i < t.length - 1; i++) { if (t[i] !== '-' || t[i + 1] === ' ') continue; const a = document.createRange(); a.setStart(nd, i); a.setEnd(nd, i + 1); const b = document.createRange(); b.setStart(nd, i + 1); b.setEnd(nd, i + 2); const ra = a.getClientRects()[0]; const rb = b.getClientRects()[0]; if (ra && rb && rb.top > ra.bottom - 2) n++; } } return n; })(),
        input: (() => { const i = d.querySelector('input[name=code]'); return i ? { mode: i.inputMode, ac: i.autocomplete } : null; })() };
    })()`;
    for (const [w, h] of MFA_SIZES) {
      const at = `${w}x${h}`;
      await browser.viewport(w, h, true);
      await browser.open('settings', seed(), 'window.__mfaOn = false;');
      // turning it on
      await browser.eval("document.querySelector('[data-mfa-row]').click()"); await wait(900);
      await browser.eval("document.querySelector('dialog.sheet[open] details').open = true"); await wait(200);
      let r = await browser.eval(probe);
      if (!r || r.title !== 'Two‑step sign‑in') { note(`the turn-on sheet did not open: ${JSON.stringify(r)}`, at); continue; }
      if (r.out || r.hscroll) note('the turn-on sheet clips or scrolls sideways', at);
      if (r.btnLines !== 1 || r.btnH < 44) note(`Add to Passwords wraps or is small (${r.btnLines} lines, ${r.btnH}px)`, at);
      if (r.keyCut) note('the setup key is cut off', at);
      if (r.splitGroups) note(`${r.splitGroups} setup-key group(s) split across two lines`, at);
      if (r.keyRows !== 2 || r.keyPerRow.some((n) => n !== 4)) note(`the setup key is not two even rows of 4 groups (${JSON.stringify(r.keyPerRow)})`, at);
      if (r.h2Lines > 1) note(`the sheet title wraps to ${r.h2Lines} lines`, at);
      if (r.hyphenEnds) note('a line of text ends in a hyphen', at);
      if (!r.input || r.input.mode !== 'numeric' || r.input.ac !== 'one-time-code') note('the code box lacks numeric / one-time-code', at);
      if (r.w > 561 || Math.abs((r.left + r.right) / 2 - r.vw / 2) > 1) note(`the sheet is not phone-width and centred (${Math.round(r.w)} wide, left ${Math.round(r.left)})`, at);
      if (shots) await browser.screenshot(`${shots}/mfa-enroll-${w}x${h}.png`);
      // turning it on with the stub code: when the sheet closes, focus returns to the row and its ring must not be clipped by the group
      if (w === 320 || w === 390) {
        await browser.eval("(() => { const i = document.querySelector('dialog.sheet[open] input[name=code]'); i.focus(); i.value = '123456'; i.dispatchEvent(new Event('input', { bubbles: true })); })()"); await wait(1200);
        const ring = await browser.eval(`(() => {
          const row = document.querySelector('[data-mfa-row]'); const g = row && row.closest('.group'); if (!g) return null;
          row.focus({ focusVisible: true });
          const cs = getComputedStyle(row); const off = parseFloat(cs.outlineOffset) || 0; const ow = parseFloat(cs.outlineWidth) || 0;
          const q = row.getBoundingClientRect(); const gr = g.getBoundingClientRect(); const e = Math.max(0, off) + (ow > 0 ? ow : 0);
          return { off, inside: q.left - e >= gr.left - 0.5 && q.right + e <= gr.right + 0.5 && q.top - e >= gr.top - 0.5 && q.bottom + e <= gr.bottom + 0.5 || off <= 0 };
        })()`);
        if (!ring) note('no Privacy & security group around the two-step row', at);
        else if (!ring.inside) note(`the focus ring on the two-step row sits outside its group (offset ${ring.off}px)`, at);
      }
      // the sign-in code sheet
      await browser.eval("document.querySelectorAll('dialog.sheet').forEach((d) => d.remove())");
      await browser.eval("import('/js/mfa-ui.js').then((m) => { m.promptSignInCode({ code: 'auth/multi-factor-auth-required' }).catch(() => {}); })"); await wait(900);
      r = await browser.eval(probe);
      if (!r || r.title !== 'Enter your code') { note(`the sign-in code sheet did not open: ${JSON.stringify(r)}`, at); continue; }
      if (r.out || r.hscroll) note('the sign-in code sheet clips or scrolls sideways', at);
      if (r.h2Lines > 1) note(`the code sheet title wraps to ${r.h2Lines} lines`, at);
      if (r.hyphenEnds) note('a line of text ends in a hyphen (code sheet)', at);
      // turn-off sheet
      await browser.eval("document.querySelectorAll('dialog.sheet').forEach((d) => d.remove())");
      await browser.open('settings', seed(), 'window.__mfaOn = true;');
      await browser.eval("document.querySelector('[data-mfa-row]').click()"); await wait(700);
      const off = await browser.eval(probe);
      if (!off || off.title !== 'Two‑step sign‑in') note(`the turn-off sheet did not open: ${JSON.stringify(off)}`, at);
      else {
        if (off.h2Lines > 1) note(`the turn-off sheet title wraps to ${off.h2Lines} lines`, at);
        if (off.hyphenEnds) note('a line of text ends in a hyphen (turn-off sheet)', at);
      }
      if (r.w > 561 || Math.abs((r.left + r.right) / 2 - r.vw / 2) > 1) note('the code sheet is not phone-width and centred', at);
      if (shots) await browser.screenshot(`${shots}/mfa-code-${w}x${h}.png`);
    }
    // Privacy & security notes: no single word alone on the last line, and the two-step note stays short
    const noteProbe = `(() => [...document.querySelectorAll('[data-privacy] .g-text small')].filter((e) => e.offsetParent !== null).map((e) => {
      const rg = document.createRange(); rg.selectNodeContents(e);
      const rows = {}; [...rg.getClientRects()].filter((q) => q.width > 0).forEach((q) => { const k = Math.round((q.top + q.bottom) / 2 / 6); rows[k] = (rows[k] || 0) + q.width; });
      const lines = Object.keys(rows).map(Number).sort((a, b) => a - b);
      let lastWords = 99;
      if (lines.length > 1) {
        const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let nd; let words = 0;
        while ((nd = w.nextNode())) { const t = nd.textContent; for (let i = 0; i < t.length; i++) { if (/\\s/.test(t[i])) continue; const a = document.createRange(); a.setStart(nd, i); a.setEnd(nd, i + 1); const q = a.getClientRects()[0]; if (q && Math.round((q.top + q.bottom) / 2 / 6) === lines[lines.length - 1] && (i === 0 || /\\s/.test(t[i - 1]))) words++; } }
        lastWords = words;
      }
      return { text: e.textContent, n: lines.length, lastWords, mfa: e.hasAttribute('data-mfa-note') };
    }))()`;
    for (const [w, h] of [...MFA_SIZES, [932, 430]]) {
      const at = `${w}x${h}`;
      await browser.viewport(w, h, true);
      await browser.open('settings', seed(), 'window.__mfaOn = false;');
      const notes = await browser.eval(noteProbe);
      for (const n of notes || []) {
        if (n.lastWords < 2) note(`"${n.text}" leaves a single word alone on its last line`, at);
        if (n.mfa && w === 320 && n.n > 2) note(`the two-step note takes ${n.n} lines`, at);
      }
    }
    await browser.dropInit();
    assert(found.size === 0, report(found));
  });
}

if (standalone) {
  test('layout: mission celebrations wait until the card is scrolled into view, and play inside it', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(390, 844, true);
    await browser.open('today', seed());
    const cele = "import('/js/state.js').then((m) => Object.values(m.state.settings.missions_cele || {})[0] || 0)";
    const top = await browser.eval("document.querySelector('[data-missions]').getBoundingClientRect().top");
    assert(top > 844, `the missions card should start below the fold for this test (top ${top})`);
    assert((await browser.eval(cele)) === 0, 'nothing is recorded as played while the card is off screen');
    assert(!(await browser.eval("!!document.querySelector('.ms-glow')")), 'no glow while the card is off screen');
    // closing the app now must not lose the celebration: nothing counts as seen until the card has been on screen
    await new Promise((r) => setTimeout(r, 1800));
    const seenJs = "import('/js/state.js').then((m) => Object.values(m.state.settings.missions_seen || {}).flat().length)";
    assert((await browser.eval(seenJs)) === 0, 'missions are not marked seen while the card is off screen');
    await browser.eval("window.__card = null; document.querySelector('[data-missions]').scrollIntoView({ block: 'center', behavior: 'instant' })");
    let glow = false;
    for (let i = 0; i < 60 && !glow; i++) {
      await new Promise((r) => setTimeout(r, 10));
      glow = await browser.eval("(() => { const g = document.querySelector('[data-missions] .ms-glow'); if (g) window.__card = g.closest('[data-missions]'); return !!g; })()");
    }
    assert(glow, 'the glow is drawn inside the card once it is scrolled into view');
    // Firestore echoes every settings write back as a snapshot (the fixture does not), which re-renders Today unless it is skipped
    // same shape as the WATCH handler in app.js: { ...toPatch(rows), loaded: { ...state.loaded, settings: true } }
    const echo = "import('/js/state.js').then((m) => m.state.set({ settings: { ...m.state.settings, updated_at: new Date().toISOString() }, loaded: { ...m.state.loaded, settings: true } }))";
    await browser.eval(echo);
    // what the user sees: a bit later the glow is still attached to the live card and visible
    await new Promise((r) => setTimeout(r, 100));
    const live = await browser.eval(`(() => {
      const g = document.querySelector('.ms-glow'); const c = document.querySelector('[data-missions]');
      return { connected: !!g && g.isConnected, inside: !!g && c.contains(g), sameCard: c === window.__card, opacity: g ? Number(getComputedStyle(g).opacity) : 0 };
    })()`);
    assert(live.connected && live.inside, `the glow is on the live card (${JSON.stringify(live)})`);
    assert(live.sameCard, 'recording the celebration must not replace the card while it plays');
    assert(live.opacity > 0.3, `the glow is visible (opacity ${live.opacity})`);
    assert((await browser.eval(cele)) >= 1, 'recorded as played once it plays');
    // once and only once, and the missions count as seen after it ends (that save echoes back too)
    await new Promise((r) => setTimeout(r, 1400));
    await browser.eval(echo);
    await new Promise((r) => setTimeout(r, 2200));
    assert((await browser.eval("document.querySelectorAll('.ms-glow').length")) === 0, 'the glow is gone after the effect and does not replay');
    assert((await browser.eval(seenJs)) > 0, 'missions are marked seen after the effect');
    assert((await browser.eval(cele)) === 1, 'tier 1 played exactly once');
  });
}

// v0.15.19: the quick-log + and its sheet fit at every size, and the + shows on tab roots only.
if (standalone) {
  test('layout: quick-log +: 44pt, in the title row, not covered; the sheet has seven one-line rows and is centered', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const found = new Map();
    const note = (msg, at) => found.set(msg, [...(found.get(msg) || []), at]);
    for (const [w, h] of [[320, 568], [390, 844], [430, 932], [466, 678], [626, 890], [890, 626]]) {
      const at = `${w}x${h}`;
      await browser.viewport(w, h, true);
      await browser.open('today', seed());
      await wait(300);
      const fab = await browser.eval(`(() => { const f = document.getElementById('quicklog'); if (!f) return null;
        const r = f.getBoundingClientRect(), row = f.closest('.large-title'), rr = row && row.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { on: f.classList.contains('on'), label: f.getAttribute('aria-label'), w: r.width, h: r.height, right: window.innerWidth - r.right,
          inRow: !!row && r.left >= rr.left - 0.5 && r.right <= rr.right + 0.5 && r.top >= rr.top - 0.5 && r.bottom <= rr.bottom + 0.5,
          hit: top === f || f.contains(top) }; })()`);
      if (!fab) { note('no #quicklog button', at); continue; }
      if (!fab.on) note('+ is not showing on Today', at);
      if (fab.label !== 'Quick log') note(`label is "${fab.label}"`, at);
      if (fab.w < 43.5 || fab.h < 43.5) note(`+ is ${fab.w}x${fab.h}, wanted at least 44x44`, at);
      if (fab.right < 8) note(`+ is ${fab.right}px from the right edge`, at);
      if (!fab.inRow) note('+ is not inside the large-title row', at);
      if (!fab.hit) note('+ is covered by something else at its center', at);
      // roots only: Settings is a pushed screen, the player is full screen
      for (const route of ['settings', 'play']) {
        await browser.open(route, seed({ active: route === 'play' }));
        await wait(200);
        if (await browser.eval("document.getElementById('quicklog').classList.contains('on')")) note(`+ shows on ${route}`, at);
      }
      await browser.open('today', seed());
      await wait(300);
      await browser.eval("document.getElementById('quicklog').click()");
      await wait(500);
      const s = await browser.eval(`(() => { const d = document.querySelector('dialog.sheet[open]'); if (!d) return null;
        const r = d.getBoundingClientRect(), rows = [...d.querySelectorAll('.ql-row')];
        return { left: r.left, right: window.innerWidth - r.right, width: r.width, top: r.top, vw: window.innerWidth,
          fabHidden: !document.getElementById('quicklog').classList.contains('on'),
          rows: rows.map((b) => { const sp = b.querySelector('span'), rg = document.createRange(); rg.selectNodeContents(sp);
            return { t: sp.textContent, h: b.getBoundingClientRect().height, lines: new Set([...rg.getClientRects()].map((q) => Math.round(q.top / 6))).size, clip: sp.scrollWidth > sp.clientWidth + 1 }; }) }; })()`);
      if (!s) { note('the sheet did not open', at); continue; }
      if (s.rows.length !== 7) note(`sheet has ${s.rows.length} rows`, at);
      for (const r of s.rows) if (r.lines !== 1 || r.clip || r.h < 44) note(`row "${r.t}": ${r.lines} lines, clipped ${r.clip}, ${r.h}px tall`, at);
      if (Math.abs(s.left - s.right) > 1.5) note(`sheet not centered (${s.left} vs ${s.right})`, at);
      if (s.width > 640.5 || (w >= 560 && h > 500 && s.width > 440.5)) note(`sheet is ${s.width}px wide`, at);
      if (s.top < 0) note('sheet runs off the top', at);
      if (!s.fabHidden) note('+ still showing under the sheet', at);
      await browser.eval("document.querySelector('dialog.sheet[open]').dispatchEvent(new Event('cancel', { cancelable: true }))");
      await wait(500);
    }
    assert(found.size === 0, `\n        ${[...found].map(([m, at]) => `${m}  [${at.join(' ')}]`).join('\n        ')}`);
  });
}

// v0.15.19 round 2: the + on every root at rest, the title row on one line, and toasts clear of the + and the tab bar.
const ROOTS = ['today', 'train', 'food', 'body', 'score'];
const SIX = [[320, 568], [390, 844], [430, 932], [466, 678], [626, 890], [890, 626]];
if (standalone) {
  test('layout: quick-log + at rest: on all 5 roots, it is the top hit at its center and nothing in main sits under it', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const bad = [];
    for (const [w, h] of SIX) for (const route of ROOTS) {
      await browser.viewport(w, h, true);
      await browser.open(route, seed());
      await new Promise((r) => setTimeout(r, 300));
      const r = await browser.eval(`(() => { const f = document.getElementById('quicklog'); if (!f || !f.classList.contains('on')) return { missing: true };
        const b = f.getBoundingClientRect(); const hits = document.elementsFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return { first: hits[0] === f || f.contains(hits[0]), mainAbove: hits.slice(0, hits.indexOf(f) < 0 ? hits.length : hits.indexOf(f)).some((e) => e.closest('main') && !f.contains(e)) }; })()`);
      if (r.missing || !r.first || r.mainAbove) bad.push(`${route} ${w}x${h} ${JSON.stringify(r)}`);
    }
    assert(bad.length === 0, bad.join('; '));
  });

  test('layout: title row stays one line at 320 and 375 on every root, with the longest greeting; + and avatar are 44pt and on screen', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const bad = [];
    for (const w of [320, 375]) for (const route of ROOTS) {
      await browser.viewport(w, 667, true);
      await browser.open(route, seed(), 'Date.prototype.getHours = function () { return 14; };'); // "Good afternoon"
      await new Promise((r) => setTimeout(r, 300));
      const r = await browser.eval(`(() => { const l = document.querySelector('#main .large-title'); if (!l) return { none: true };
        const h1 = l.querySelector('h1'), a = document.querySelector('#main .avatar-btn'), f = document.getElementById('quicklog');
        const hr = h1.getBoundingClientRect(), fr = f.getBoundingClientRect(), ar = a.getBoundingClientRect(), lh = parseFloat(getComputedStyle(h1).lineHeight);
        return { oneLine: hr.height <= lh * 1.5 && h1.scrollWidth <= h1.clientWidth + 0.5, fs: parseFloat(getComputedStyle(h1).fontSize), text: h1.textContent,
          sizes: [fr.width, fr.height, ar.width, ar.height], onScreen: fr.left >= 0 && ar.right <= innerWidth + 0.5 && (hr.right <= fr.left + 0.5 || hr.top >= fr.bottom - 0.5), noOverlap: fr.right <= ar.left + 0.5 }; })()`);
      if (r.none || !r.oneLine || r.fs < 24 || r.sizes.some((n) => n < 43.5) || !r.onScreen || !r.noOverlap) bad.push(`${route} ${w} ${JSON.stringify(r)}`);
    }
    assert(bad.length === 0, bad.join('; '));
  });

  test('layout: a toast, plain or with Undo, never overlaps the + or the tab bar (320x568, 390x844)', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const bad = [];
    for (const [w, h] of [[320, 568], [390, 844]]) for (const undo of [false, true]) {
      await browser.viewport(w, h, true);
      await browser.open('today', seed());
      await new Promise((r) => setTimeout(r, 300));
      const r = await browser.eval(`import('/js/ui.js').then(async (m) => {
        m.toast('Deleted Chicken breast, 6 oz and some more words to run long', 20000, ${undo ? "{ action: { label: 'Undo', onClick() {} } }" : '{}'});
        await new Promise((r) => setTimeout(r, 500));
        const t = document.querySelector('.toast').getBoundingClientRect(), f = document.getElementById('quicklog').getBoundingClientRect();
        const tb = (document.querySelector('.tabbar') || document.querySelector('nav')).getBoundingClientRect();
        const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        return { plus: hit(t, f), tabs: hit(t, tb), inside: t.left >= 0 && t.right <= innerWidth };
      })`);
      if (r.plus || r.tabs || !r.inside) bad.push(`${w}x${h} undo=${undo} ${JSON.stringify(r)}`);
    }
    assert(bad.length === 0, bad.join('; '));
  });
}

if (standalone) {
test('layout: the Recovery row puts the recovery card under the title bar (tap and cold load, 390x844 and 890x626)', async () => {
  if (skipReason()) return;
  browser = browser || await launch();
  const top = "(() => { const c = document.querySelector('[data-recovery-card]'); return c ? Math.round(c.getBoundingClientRect().top) : null; })()";
  for (const [w, h] of [[390, 844], [890, 626]]) {
    await browser.viewport(w, h, true);
    await browser.open('body', seed());
    await browser.eval("document.querySelector('[data-recovery-link]').scrollIntoView()");
    await new Promise((r) => setTimeout(r, 150));
    await browser.eval("document.querySelector('[data-recovery-link]').click()");
    await new Promise((r) => setTimeout(r, 1000));
    const tapped = await browser.eval(top);
    assert(tapped !== null && tapped >= 40 && tapped <= 200, `Recovery card top after tapping the row at ${w}x${h}: ${tapped}`);
    await browser.open('train/recovery', seed());
    await new Promise((r) => setTimeout(r, 600));
    const cold = await browser.eval(top);
    assert(cold !== null && cold >= 40 && cold <= 200, `Recovery card top on a cold load at ${w}x${h}: ${cold}`);
  }
});

test('layout: at 320 the weigh-in meta and the Recovery subtitle keep each dot-separated part on one line, and no line starts with a dot', async () => {
  if (skipReason()) return;
  browser = browser || await launch();
  await browser.viewport(320, 568, true);
  const data = seed();
  data.weights.forEach((w, i) => { w.source = i % 2 ? 'withings' : 'manual'; });
  await browser.open('body', data);
  const r = await browser.eval(`(() => {
    const bad = [];
    const check = (el, label) => {
      for (const part of el.querySelectorAll('.nw')) {
        const rg = document.createRange(); rg.selectNodeContents(part);
        if (new Set([...rg.getClientRects()].map((q) => Math.round(q.top / 4))).size > 1) bad.push(label + ' part wraps: ' + part.textContent);
      }
      // every dot is a leading ::before on its part; the part that starts a line must have it clipped away, so no line starts or ends with a dot
      const inner = el.querySelector('.dots-in'); if (!inner) { bad.push(label + ' has no .dots-in'); return; }
      const outer = el.getBoundingClientRect(), parts = [...inner.children];
      let lineTop = null;
      for (const part of parts) {
        const q = part.getBoundingClientRect(), dotW = parseFloat(getComputedStyle(part, '::before').width) || 0;
        const startsLine = lineTop === null || q.top - lineTop > 4;
        lineTop = startsLine ? q.top : lineTop;
        if (startsLine && q.left + dotW > outer.left + 1) bad.push(label + ' a line starts with a visible dot: ' + part.textContent);
        if (!startsLine && q.left + dotW <= outer.left + 1) bad.push(label + ' dot hidden mid-line: ' + part.textContent);
      }
    };
    document.querySelectorAll('[data-weigh-ins] li small').forEach((s) => check(s, 'weigh-in'));
    const rec = document.querySelector('[data-recovery-link] .small'); if (rec) check(rec, 'recovery');
    return { bad, rows: document.querySelectorAll('[data-weigh-ins] li small').length, rec: !!rec };
  })()`);
  assert(r.rows > 0 && r.rec, `Body rendered weigh-ins and the Recovery row: ${JSON.stringify(r)}`);
  assert(r.bad.length === 0, `wrap problems at 320: ${r.bad.join('; ')}`);
});
}

// v0.15.22: Food and Body are two columns at 890x626 (and 932x430), one column with the phone reading order everywhere narrower.
if (standalone) {
  test('layout: Food and Body split into two columns at >= 840 wide, and stay one column in the same order below it', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const bad = [];
    const probe = `(() => {
      const cols = document.querySelector('.food-cols, .body-cols');
      const kids = cols ? [...cols.querySelectorAll(':scope > .col')] : [];
      const lefts = kids.map((k) => Math.round(k.getBoundingClientRect().left));
      const items = [...(cols ? cols.querySelectorAll('.col > *') : [])].map((e) => e.textContent.trim().slice(0, 12));
      return { n: kids.length, lefts, order: items.join('|'), over: document.documentElement.scrollWidth - innerWidth, display: cols ? getComputedStyle(cols).display : '' };
    })()`;
    for (const route of ['food', 'body']) {
      const orders = [];
      for (const [w, h] of [[890, 626], [932, 430], [626, 890], [466, 678], [390, 844], [320, 568]]) {
        await browser.viewport(w, h, true);
        await browser.open(route, seed());
        const r = await browser.eval(probe);
        if (r.over > 1) bad.push(`${route} ${w}x${h}: overflows by ${r.over}px`);
        if (w >= 840) {
          if (r.n < 3 || new Set(r.lefts).size < 2) bad.push(`${route} ${w}x${h}: expected two columns, got lefts ${r.lefts}`);
        } else {
          if (r.display !== 'contents') bad.push(`${route} ${w}x${h}: expected one column, wrapper display is ${r.display}`);
          orders.push(r.order);
        }
      }
      if (new Set(orders).size > 1) bad.push(`${route}: card order differs between phone sizes`);
    }
    assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
  });
}

if (standalone) {
  test('layout: Score pillar captions ("Not tracked") stay on one line at 320 to 430 and on Duo with large text', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    for (const [w, h, ts] of [[320, 568], [375, 667], [390, 844], [430, 932], [466, 700, 1.35], [626, 890, 1.35], [890, 626, 1.35], [390, 844, 1.35]]) {
      await browser.viewport(w, h, true);
      await browser.open('score', seed());
      const bad = await browser.eval(`(() => {
        const grid = document.querySelector('.pillar-grid'); if (!grid) return 'no pillar grid';
        ${ts ? `document.documentElement.style.setProperty('--ts', '${ts}');` : ''}
        const first = grid.querySelector('.pillar');
        const off = first.cloneNode(true); off.classList.add('off'); off.querySelector('small').textContent = 'Not tracked'; grid.appendChild(off); // an untracked pillar, whatever the fixture has
        return [...grid.querySelectorAll('.pillar small')].map((el) => { const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.3;
          return el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().height > lh * 1.5 ? el.textContent + ' h=' + el.getBoundingClientRect().height : null; }).filter(Boolean).join(', ');
      })()`);
      assert(!bad, `${w}px ts=${ts || 1}: ${bad}`);
    }
  });
}

if (standalone) {
  test('layout: Score pillar rings have a visible track, an unclipped glow, and settle on their final offsets', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const bad = [];
    for (const dark of [false, true]) for (const [w, h, ts] of [[320, 568], [390, 844], [890, 626], [390, 844, 1.35]]) {
      await browser.viewport(w, h, dark);
      await browser.open('score', seed());
      if (ts) await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`);
      await browser.eval(`document.querySelector('.pillar-grid')?.scrollIntoView({ block: 'center' })`);
      await new Promise((r) => setTimeout(r, 1400));
      const r = await browser.eval(`(() => {
        const grid = document.querySelector('.pillar-grid'); if (!grid) return { err: 'no pillar grid' };
        const out = { issues: [], hold: grid.classList.contains('sc-hold') };
        for (const t of grid.querySelectorAll('.pillar')) {
          const ring = t.querySelector('.pillar-ring'); if (!ring) { out.issues.push('no .pillar-ring'); continue; }
          const bg = getComputedStyle(ring).backgroundColor;
          if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') out.issues.push('ring bg ' + bg);
          if (getComputedStyle(ring.querySelector('.sc-track')).stroke === getComputedStyle(t).backgroundColor) out.issues.push('track matches tile');
          const arc = ring.querySelector('.sc-arc');
          if (parseFloat(getComputedStyle(arc).strokeDashoffset) !== parseFloat(arc.style.getPropertyValue('--off'))) out.issues.push('offset ' + getComputedStyle(arc).strokeDashoffset + ' vs ' + arc.style.getPropertyValue('--off'));
        }
        for (const s of document.querySelectorAll('svg.sc-hero')) if (getComputedStyle(s).overflow !== 'visible') out.issues.push('svg.sc-hero overflow ' + getComputedStyle(s).overflow);
        return out;
      })()`);
      const at = `${dark ? 'dark' : 'light'} ${w}x${h} ts=${ts || 1}`;
      if (!r.err && w !== 320) { // the tapped (open) tile is a surface-2 tile, so its track must step up
        await browser.eval(`document.querySelectorAll('.pillar')[3]?.click()`);
        await new Promise((r2) => setTimeout(r2, 300));
        const open = await browser.eval(`(() => { const t = document.querySelector('.pillar[aria-expanded="true"]'); if (!t) return 'no open pillar';
          const tr = t.querySelector('.sc-track'); return tr && getComputedStyle(tr).stroke === getComputedStyle(t).backgroundColor ? 'open track matches tile' : ''; })()`);
        if (open) bad.push(`${at}: ${open}`);
      }
      if (r.err) bad.push(`${at}: ${r.err}`);
      else { if (r.hold) bad.push(`${at}: pillar grid still sc-hold`); for (const i of r.issues) bad.push(`${at}: ${i}`); }
    }
    assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
  });
}

test('layout: close the browser', async () => {
  if (browser) await browser.close();
  browser = null;
});

if (standalone) {
  const { runAll, tests } = await import('./harness.js');
  const shard = (arg('shard') || '').split('/').map(Number); // --shard=2/4 → every fourth test, starting at the second
  if (shard.length === 2) {
    const only = arg('only'); const keep = tests.filter((t, i) => only ? (t.name.includes(only) || t.name === 'layout: close the browser') : i % shard[1] === shard[0] - 1 || t.name === 'layout: close the browser');
    tests.splice(0, tests.length, ...keep);
  }
  const { fail } = await runAll();
  process.exit(fail ? 1 : 0);
}
