// Headless layout check (v0.15.7). Boots the real app in Chromium with a synthetic account and fails when a chip, pill,
// button or label wraps or clips, a tap target is under 44 px, or content runs off-screen or under the tab bar.
// Skips (loudly) when no Chrome/Chromium is installed. GitHub's ubuntu runners have one, so CI runs it.
//   LAYOUT_ROUTES=today,body node tests/layout.test.js   → only those screens
//   LAYOUT_SHOTS=/tmp/shots                              → also save a PNG of every render
import { test, assert, eq } from './harness.js';
import { skipReason, launch } from './layout/browser.js';
import { detect } from './layout/detect.js';
import { seed, WORKOUT_DAY, REST_DAY } from './layout/seed.js';
const DAYS = [WORKOUT_DAY, REST_DAY]; // Today differs by day type, so its column checks run on a workout day and on a rest day
const onDay = (at) => ({ now: new Date(at).getTime() });

const SIZES = [[320, 568], [375, 667], [390, 844], [440, 956]];
const shortLand0 = (w, h) => w >= 600 && h <= 500;
const SAFE_BOTTOM = 21; // the home indicator in landscape
const WIDE = [[466, 678], [678, 466], [844, 390], [874, 402], [932, 430], [626, 890], [890, 626]]; // 844x390, 874x402 and 932x430 are current iPhones sideways
const ROUTES = ['play', 'live', 'today', 'train', 'body', 'program', 'score', 'trends', 'timer', 'history', 'settings', 'apple', 'food', 'awards', 'locations', 'library'];
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

// Each route is checked in groups of sizes (not all ~18 renders in one test) so the shards can balance and a hang names its group.
const CHUNK = 5;
const chunks = (list) => Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) => list.slice(i * CHUNK, i * CHUNK + CHUNK));

for (const route of standalone ? ROUTES : []) {
  if (only && !only.includes(route)) continue;
  const groups = chunks(CASES);
  groups.forEach((group, gi) => test(`layout: ${route} has no wraps, clips, small tap targets or overflow (sizes ${gi + 1}/${groups.length})`, async () => {
    if (skipReason()) { console.log('      (skipped: ' + skipReason() + ')'); return; }
    browser = browser || await launch();
    const found = new Map();
    for (const c of group) {
      await browser.viewport(c.w, c.h, c.dark);
      await browser.open(route, seed({ long: c.long, over: c.over, active: route === 'play', program: route === 'program', comp: route === 'body', pro: route === 'food' && !c.long && !c.over }));
      const cls = await browser.eval('window.__cls || 0'); // before any text-size change
      if (c.ts) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${c.ts}')`); await new Promise((r) => setTimeout(r, 300)); }
      const probs = await browser.eval(`(${detect})(${JSON.stringify({ largeText: !!c.ts })})`);
      if (await browser.eval("!!document.querySelector('#main .skeleton')")) probs.push(`screen never finished drawing (still the loading skeleton). Page errors: ${browser.errors.slice(-3).join(' | ') || 'none'}`);
      if (shots) await browser.screenshot(`${shots}/${route}-${c.w}x${c.h}-${c.dark ? 'dark' : 'light'}${c.long ? '-long' : ''}${c.ts ? '-text' : ''}.png`);
      if (shots) {
        await browser.eval("window.scrollTo({ top: 1e6, behavior: 'instant' })");
        await browser.screenshot(`${shots}/${route}-${c.w}x${c.h}-${c.dark ? 'dark' : 'light'}${c.long ? '-long' : ''}${c.ts ? '-text' : ''}-bottom.png`);
      }
      if (cls > 0.02) probs.push(`layout shift ${cls.toFixed(3)} on first render (moved: ${(await browser.eval('(window.__shifts || []).join(" | ")')).slice(0, 300)})`); // names the node that moved, so a flaky CI hit points at the real cause
      for (const p of probs) found.set(p, [...(found.get(p) || []), `${c.w}${c.dark ? "d" : "l"}${c.long ? "L" : ""}${c.over ? "O" : ""}${c.ts ? "T" : ""}`]);
    }
    assert(found.size === 0, `\n        ${[...found].map(([p, at]) => `${p}  [${at.join(' ')}]`).join('\n        ')}`);
  }));
}

// Library by muscle group (v0.16.81, #238): sticky, collapsible section headers and the Train preview's muscle labels. Phone dark and
// light, the four iPhone Duo sizes, and a small phone at 160% text. No overflow, headers whole and 44px+, the sticky header never
// covers a row it isn't heading, collapsing sets aria-expanded and hides the list, and the Train preview shows its group labels.
const MG_SIZES = [[390, 844, true, 1], [390, 844, false, 1], [466, 678, true, 1], [678, 466, false, 1], [626, 890, true, 1], [890, 626, false, 1], [320, 568, true, 1.6]];
const MG_PROBE = `(() => {
  const heads = [...document.querySelectorAll('.mg-h')];
  const btns = heads.map((h) => h.querySelector('.mg-btn'));
  const clipped = btns.filter((b) => b.scrollWidth > b.clientWidth + 1).length;
  const small = btns.filter((b) => b.getBoundingClientRect().height < 43.5).length;
  const rows = [...document.querySelectorAll('.mg-list:not([hidden]) li')];
  // at rest (not scrolled) no header may overlap a row of another section, nor a row overlap its own header
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const covered = heads.filter((h) => rows.some((li) => hit(h.getBoundingClientRect(), li.getBoundingClientRect()))).length;
  const sticky = heads.every((h) => getComputedStyle(h).position === 'sticky');
  const t = document.querySelector('#main h1'), nb = document.querySelector('[data-new]');
  const titleUnderBtn = t && nb ? (() => { const a = t.getBoundingClientRect(), b = nb.getBoundingClientRect(); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; })() : false;
  return { titleUnderBtn, n: heads.length, expanded: btns.map((b) => b.getAttribute('aria-expanded')), clipped, small, covered, sticky,
    page: document.documentElement.scrollWidth > innerWidth + 1, h1: document.querySelector('#main h1')?.tagName };
})()`;
for (const [w, h, dark, ts] of standalone && (!only || only.includes('library') || only.includes('train')) ? MG_SIZES : []) {
  const tag = `${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? '-text160' : ''}`;
  test(`layout: library groups: sticky headers, collapse and Train labels fit at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, dark);
    await browser.open('library', seed({}));
    if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
    const open = await browser.eval(MG_PROBE);
    if (shots) await browser.screenshot(`${shots}/library-groups-expanded-${tag}.png`);
    assert(open.n >= 3, `${open.n} group headers`);
    assert(open.expanded.every((x) => x === 'true'), 'sections start open');
    assert(!open.titleUnderBtn, 'the Exercises title runs under + Custom');
    assert(open.clipped === 0 && open.small === 0 && open.covered === 0 && open.sticky && !open.page, `expanded: ${JSON.stringify(open)}`);
    // scrolled into the second section: the stuck header sits below the nav bar and above its rows
    await browser.eval("document.querySelectorAll('.mg')[1].scrollIntoView({ block: 'start' })");
    await new Promise((r) => setTimeout(r, 250));
    const stuck = await browser.eval(`(() => { const s = document.querySelectorAll('.mg')[1]; const hb = s.querySelector('.mg-h').getBoundingClientRect(); const r0 = s.querySelector('li').getBoundingClientRect(); const nav = document.querySelector('.navbar').getBoundingClientRect(); return { gap: r0.top - hb.bottom, below: hb.top - nav.bottom }; })()`);
    assert(stuck.gap >= -1 && stuck.below >= -1, `sticky header overlaps: ${JSON.stringify(stuck)}`);
    await browser.eval('scrollBy(0, 80)'); // further in, so the header is really stuck (rows now slide under the glass)
    await new Promise((r) => setTimeout(r, 250));
    if (shots) await browser.screenshot(`${shots}/library-groups-stuck-${tag}.png`);
    // stuck, the header is the same glass as the nav and tab bars (a blur, not a flat --bg band) with a hairline
    const glass = await browser.eval(`(() => { const h = document.querySelectorAll('.mg')[1].querySelector('.mg-h'); const cs = getComputedStyle(h); const bf = cs.backdropFilter || cs.webkitBackdropFilter; return { stuck: h.classList.contains('stuck'), bf, shadow: cs.boxShadow, y: Math.round(scrollY), doc: document.documentElement.scrollHeight, ih: innerHeight, sen: Math.round(h.parentElement.querySelector('.mg-sentinel').getBoundingClientRect().top), io: typeof IntersectionObserver }; })()`);
    assert(glass.stuck && glass.bf && glass.bf !== 'none' && glass.shadow !== 'none', `stuck header is not glass: ${JSON.stringify(glass)}`);
    // collapse the first two: aria-expanded flips, lists hide, the choice is remembered, nothing overflows
    await browser.eval("window.scrollTo({ top: 0, behavior: 'instant' }); document.querySelectorAll('[data-toggle]')[0].click(); document.querySelectorAll('[data-toggle]')[1].click()");
    await new Promise((r) => setTimeout(r, 900));
    const shut = await browser.eval(MG_PROBE);
    if (shots) await browser.screenshot(`${shots}/library-groups-collapsed-${tag}.png`);
    assert(shut.expanded[0] === 'false' && shut.expanded[1] === 'false' && shut.expanded[2] === 'true', `collapsed: ${JSON.stringify(shut.expanded)}`);
    assert(shut.clipped === 0 && shut.small === 0 && shut.covered === 0 && !shut.page, `collapsed: ${JSON.stringify(shut)}`);
    assert(await browser.eval("document.querySelectorAll('.mg-list')[0].hidden && localStorage.getItem('forge.library.collapsed').includes('chest')"), 'collapse did not hide the list or was not remembered');
    await browser.eval("document.querySelectorAll('[data-toggle]')[0].click()");
    await new Promise((r) => setTimeout(r, 900));
    assert(await browser.eval("document.querySelector('[data-toggle]').getAttribute('aria-expanded') === 'true' && !document.querySelector('.mg-list').hidden"), 'the section did not reopen');
    // Train preview
    await browser.open('train', seed({}));
    if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
    await browser.eval("document.querySelector('.pv-list')?.scrollIntoView({ block: 'start' })");
    await new Promise((r) => setTimeout(r, 250));
    if (shots) await browser.screenshot(`${shots}/train-groups-${tag}.png`);
    const tr = await browser.eval(`(() => ({ labels: [...document.querySelectorAll('.pv-mg-h')].map((e) => e.textContent), over: [...document.querySelectorAll('.pv-mg-h')].filter((e) => e.scrollWidth > e.clientWidth + 1).length, page: document.documentElement.scrollWidth > innerWidth + 1 }))()`);
    assert(tr.labels.length >= 1 && tr.over === 0 && !tr.page, `Train preview labels: ${JSON.stringify(tr)}`);
    assert(await browser.eval("[...document.querySelectorAll('.pv-mg')].every((li) => li.getAttribute('role') === 'none')"), 'Train label rows must be role=none so they are not counted as plan items');
  });
}

// Goal date (v0.16.62): the "Goal date plan" sheet in its four states (on pace, behind, tight date, burn at the floor), the
// "Plan for <date>" button on Body, and Settings with the date fields open and a note showing. Phone dark and light, small
// phone at 160% text, and both Duo sizes. Nothing may overflow sideways, the button is 44px or more, nothing is clipped.
const GD_SIZES = [[390, 844, true, 1], [390, 844, false, 1], [320, 568, true, 1.6], [678, 466, true, 1], [626, 890, true, 1]];
const GD_STATES = {
  ok: { goalDay: '2027-06-01', burn: 2300, actualKgPerWeek: -0.5, weekKg: -0.5, label: 'Ahead' },
  behind: { goalDay: '2027-02-01', burn: 2300, actualKgPerWeek: -0.02, weekKg: 0, label: 'Behind' },
  tight: { goalDay: '2026-11-02', burn: 2300, actualKgPerWeek: -0.3, weekKg: -0.3, label: null },
  floor: { goalDay: '2027-06-01', burn: 1500, actualKgPerWeek: -0.1, weekKg: -0.1, label: null },
};
const GD_OPEN = (st) => `(async () => {
  const g = await import('./js/nutrition/goaldate.js'); const u = await import('./js/screens/goaldate-ui.js');
  const o = ${JSON.stringify(st)};
  document.querySelectorAll('dialog.sheet').forEach((d) => d.remove());
  u.openGoalDateSheet(g.goalDatePlan({ trendKg: 87, goalKg: 80, goalDay: o.goalDay, today: '2026-10-12', burn: o.burn, ceiling: 1500, sex: 'male', actualKgPerWeek: o.actualKgPerWeek, weekKg: o.weekKg }));
})()`;
const GD_PROBE = `(() => {
  const d = [...document.querySelectorAll('dialog.sheet[open]')].pop(); if (!d) return null;
  const clip = (e) => !e || e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > innerWidth + 1 || e.getBoundingClientRect().left < -1;
  const legend = d.querySelector('.legend'), status = d.querySelector('[data-goal-date-status]');
  return { title: d.querySelector('h2').textContent, over: d.scrollWidth > d.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1,
    legend: !!legend && !clip(legend), status: !!status && !clip(status), statusText: status ? status.textContent : '', text: d.querySelector('[data-goal-date-sheet]').textContent,
    noroom: !!d.querySelector('[data-goal-date-noroom]'), unreal: !!d.querySelector('[data-goal-date-unreal]') };
})()`;
for (const [w, h, dark, ts] of standalone && (!only || only.includes('goaldate') || only.includes('body') || only.includes('settings')) ? GD_SIZES : []) {
  const tag = `${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? '-text160' : ''}`;
  const setTs = async () => { if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); } };
  test(`layout: goal date: the plan sheet, Body button and Settings fields fit at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, dark);
    await browser.open('body', seed({ comp: true }));
    await setTs();
    const btn = await browser.eval("(() => { const b = document.querySelector('[data-goal-date-open]'); if (!b) return null; const r = b.getBoundingClientRect(); return { h: Math.round(r.height), off: r.right > innerWidth + 1 || r.left < -1, text: b.textContent.trim(), card: !!b.closest('[data-goalpath]'), clipped: b.scrollWidth > b.clientWidth + 1 }; })()");
    if (shots) { await browser.eval("document.querySelector('[data-goal-date-open]')?.scrollIntoView({ block: 'center' })"); await new Promise((r) => setTimeout(r, 200)); await browser.screenshot(`${shots}/goaldate-body-button-${tag}.png`); }
    assert(btn, 'Body has no Plan button with Goal date on');
    assert(/^Plan for /.test(btn.text) && btn.card, `button reads "${btn.text}" inside the Goal path card`);
    assert(btn.h >= 44, `Plan button is ${btn.h}px tall`);
    assert(!btn.off && !btn.clipped, 'Plan button runs off the screen or is clipped');
    for (const [name, st] of Object.entries(GD_STATES)) {
      await browser.eval(GD_OPEN(st));
      await new Promise((r) => setTimeout(r, 700));
      const r = await browser.eval(GD_PROBE);
      if (shots) await browser.screenshot(`${shots}/goaldate-sheet-${name}-${tag}.png`);
      assert(r, `${name}: the sheet did not open`);
      assert(r.title === 'Goal date plan', `${name}: sheet is titled "${r.title}"`);
      assert(!r.over, `${name}: the sheet overflows sideways`);
      assert(r.legend && r.status, `${name}: legend or status is clipped (legend ${r.legend}, status ${r.status})`);
      if (st.label) assert(r.statusText.startsWith(st.label), `${name}: status reads "${r.statusText.slice(0, 30)}"`);
      if (name === 'tight') assert(r.unreal && !r.noroom, 'tight: the tight-date notice shows');
      if (name === 'floor') assert(r.noroom && !/0\.0 lb/.test(r.text), 'floor: the calm no-room notice shows and never says 0.0');
    }
    await browser.eval("document.querySelectorAll('dialog.sheet').forEach((d) => d.remove())");

    // Settings: fields open, with the "pick a date" note showing
    await browser.viewport(w, h, dark);
    const data = seed();
    data.settings[0].goal_date = '';
    await browser.open('settings', data);
    await setTs();
    await browser.eval("document.querySelector('[data-goal-date-fields]').scrollIntoView({ block: 'center' })");
    await new Promise((r) => setTimeout(r, 200));
    const s = await browser.eval("(() => { const f = document.querySelector('[data-goal-date-fields]'); const n = f.querySelector('[data-goal-date-note]'); const nr = n.getBoundingClientRect(); const bad = [...f.querySelectorAll('input')].filter((i) => i.getBoundingClientRect().right > innerWidth + 1 || i.scrollWidth > i.clientWidth + 1 && i.type !== 'date').length; return { shown: !f.hidden, note: n.textContent, noteOff: nr.right > innerWidth + 1 || n.scrollWidth > n.clientWidth + 1, bad, over: document.documentElement.scrollWidth > innerWidth + 1, inputs: [...f.querySelectorAll('input')].map((i) => Math.round(i.getBoundingClientRect().height)) }; })()");
    if (shots) await browser.screenshot(`${shots}/goaldate-settings-${tag}.png`);
    assert(s.shown && s.note === 'Pick a date to see your plan.', `Settings note reads "${s.note}"`);
    assert(!s.noteOff && !s.bad && !s.over, 'Settings fields or note overflow or are clipped');
    assert(s.inputs.every((x) => x >= 44), `Settings inputs are ${s.inputs.join('/')}px tall`);
  });
}

// Recovered live workout (v0.16.91, #254): the Keep / Discard sheet, its Discard confirm, and the sign-out "End and save your walk?" sheet.
// Phone dark and light, small phone at 160% text, both Duo sizes folded and unfolded. Nothing overflows sideways, every button is 44px or
// more and on screen, Keep is the focused first choice, and the confirm uses the "42-min ... won't be saved" words.
const ST_SIZES = [[390, 844, 1], [320, 568, 1.6], [466, 678, 1], [678, 466, 1], [626, 890, 1], [890, 626, 1]];
const ST_OPEN = (which) => `(async () => {
  document.querySelectorAll('dialog.sheet').forEach((d) => d.remove());
  if (${JSON.stringify(which)} === 'signout') { const [u, so] = await Promise.all([import('./js/ui.js'), import('./js/signout.js')]); u.confirmSheet(so.liveSignOutAsk('walk')); }
  else { const m = await import('./js/native/stray-prompt.js'); m.openStraySheet({ elapsed: 42 * 60000 }, { keep() {}, drop() {} }); }
})()`;
const ST_PROBE = `(() => {
  const d = [...document.querySelectorAll('dialog.sheet[open]')].pop(); if (!d) return null;
  const btns = [...d.querySelectorAll('.sheet-body button')];
  const r = btns.map((b) => b.getBoundingClientRect());
  return { text: d.querySelector('.sheet-body').textContent, n: btns.length, minH: Math.round(Math.min(...r.map((x) => x.height))), minW: Math.round(Math.min(...r.map((x) => x.width))),
    off: r.some((x) => x.right > innerWidth + 1 || x.left < -1 || x.bottom > innerHeight + 1 || x.top < -1) || btns.some((b) => b.scrollWidth > b.clientWidth + 1),
    over: d.scrollWidth > d.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1, focus: !!document.activeElement && document.activeElement.hasAttribute('data-keep') };
})()`;
for (const [w, h, ts] of standalone && (!only || only.includes('stray') || only.includes('live')) ? ST_SIZES : []) {
  test(`layout: recovered workout sheets (Keep / Discard, confirm, sign-out) fit at ${w}x${h}${ts !== 1 ? ' text160' : ''}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    for (const dark of [true, false]) {
      const tag = `${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? '-text160' : ''}`;
      await browser.viewport(w, h, dark);
      await browser.open('today', seed());
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
      const check = async (name, probe) => {
        await new Promise((r) => setTimeout(r, 700));
        const r = await browser.eval(ST_PROBE);
        if (shots) await browser.screenshot(`${shots}/stray-${name}-${tag}.png`);
        assert(r, `${tag} ${name}: the sheet did not open`);
        assert(!r.over && !r.off, `${tag} ${name}: a button runs off the screen or the sheet overflows`);
        assert(r.minH >= 44 && r.minW >= 44, `${tag} ${name}: a button is ${r.minW}x${r.minH}px`);
        if (probe) probe(r);
      };
      await browser.eval(ST_OPEN('stray'));
      await check('keep-discard', (r) => { assert(r.n === 2 && r.focus, `${tag}: Keep must be the focused first choice (${r.n} buttons, focus ${r.focus})`); assert(/42 min/.test(r.text), 'shows the minutes'); });
      await browser.eval("document.querySelector('dialog.sheet[open] [data-drop]').click()");
      await check('discard-confirm', (r) => assert(/Discard this 42-min workout\? It won.t be saved to Forge or Apple Health\./.test(r.text) && r.n === 2, `${tag}: confirm reads "${r.text.slice(0, 80)}"`));
      await browser.eval(ST_OPEN('signout'));
      await check('signout', (r) => assert(/End and save/.test(r.text), `${tag}: sign-out sheet reads "${r.text.slice(0, 60)}"`));
      await browser.eval("document.querySelectorAll('dialog.sheet').forEach((d) => d.remove())");
    }
  });
}

// Reminders (v0.16.77): the Settings section with switches on (time rows, Quiet hours From/To, "Turn all reminders off") and the
// web Today card with its dismiss button. Phone dark and light, small phone at 160% text, both Duo sizes. Switch rows, time inputs
// and the dismiss button are 44px or more, no row runs past its card, From/To wrap cleanly, and Hide removes the card.
const RM_SIZES = [[390, 844, true, 1], [390, 844, false, 1], [320, 568, true, 1.6], [626, 890, true, 1], [678, 466, true, 1]];
const rmSeed = () => {
  const d = seed();
  d.settings[0].reminders = {
    weigh: { on: true, time: '06:00' }, steps: { on: true, time: '07:00' }, protein: { on: true, time: '08:00' },
    food: { on: true, time: '09:00' }, workout: { on: true, time: '10:00' },
    quiet: { on: true, from: '22:00', to: '07:00' },
  };
  return d;
};
for (const [w, h, dark, ts] of standalone && (!only || only.includes('settings') || only.includes('today') || only.includes('reminders')) ? RM_SIZES : []) {
  const tag = `${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? '-text160' : ''}`;
  test(`layout: reminders: the Settings section and the Today card fit at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, dark);
    await browser.open('settings', rmSeed());
    await setTs(ts);
    await browser.eval("document.querySelector('[data-rm-quiet]')?.scrollIntoView({ block: 'center' })");
    await new Promise((r) => setTimeout(r, 250));
    if (shots) await browser.screenshot(`${shots}/reminders-settings-${tag}.png`);
    const s = await browser.eval(`(() => {
      const root = document.querySelector('[data-reminders]'); if (!root) return null;
      const g = root.getBoundingClientRect(), h = (e) => Math.round(e.getBoundingClientRect().height);
      const rows = [...root.querySelectorAll('.rm-row')];
      const over = rows.filter((r) => { const q = r.getBoundingClientRect(); return r.scrollWidth > r.clientWidth + 1 || q.right > g.right + 1 || q.left < g.left - 1; }).length;
      const kids = [...root.querySelectorAll('.rm-time > *')].filter((e) => e.closest('.rm-time').offsetParent && e.getBoundingClientRect().right > g.right + 1).length;
      const from = root.querySelector('[name=rm-quiet-from]'), to = root.querySelector('[name=rm-quiet-to]');
      const fq = from.getBoundingClientRect(), tq = to.getBoundingClientRect();
      const off = root.querySelector('[data-rm-off]');
      return {
        switches: [...root.querySelectorAll('.rm-top')].map(h), times: [...root.querySelectorAll('.rm-time input')].filter((i) => i.offsetParent).map(h),
        over, kids, off: off && !off.hidden ? h(off) : 0, page: document.documentElement.scrollWidth > innerWidth + 1,
        pairOk: fq.right <= g.right + 1 && tq.right <= g.right + 1 && (tq.left >= fq.right - 1 || tq.top >= fq.bottom - 1), // side by side, or wrapped under
        shown: root.querySelectorAll('.rm-time:not([hidden])').length,
      };
    })()`);
    assert(s, 'Settings has no Reminders section');
    assert(s.shown === 6, `${s.shown} time rows showing (5 reminders + quiet hours expected)`);
    assert(s.switches.length === 6 && s.switches.every((x) => x >= 44), `switch rows are ${s.switches.join('/')}px tall`);
    assert(s.times.length === 7 && s.times.every((x) => x >= 44), `time inputs are ${s.times.join('/')}px tall`);
    assert(s.off >= 44, `Turn all reminders off is ${s.off}px tall`);
    assert(s.over === 0 && s.kids === 0 && !s.page, `${s.over} rows and ${s.kids} fields run past the card, page overflow ${s.page}`);
    assert(s.pairOk, 'Quiet hours From/To do not wrap cleanly');

    await browser.open('today', rmSeed());
    await setTs(ts);
    await browser.eval("document.querySelector('[data-reminder-card]')?.scrollIntoView({ block: 'center' })");
    await new Promise((r) => setTimeout(r, 250));
    if (shots) await browser.screenshot(`${shots}/reminders-banner-${tag}.png`);
    const b = await browser.eval(`(() => {
      const cards = [...document.querySelectorAll('[data-reminder-card]')]; if (!cards.length) return null;
      const x = cards[0].querySelector('[data-dismiss]').getBoundingClientRect(), c = cards[0].getBoundingClientRect();
      return { n: cards.length, kind: cards[0].dataset.reminderCard, bw: Math.round(x.width), bh: Math.round(x.height), over: cards.some((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > innerWidth + 1) || document.documentElement.scrollWidth > innerWidth + 1, inside: x.right <= c.right + 1 && x.left >= c.left - 1 };
    })()`);
    assert(b, 'no reminder card on Today although several reminders are past their time and not done');
    assert(b.bw >= 44 && b.bh >= 44, `dismiss button is ${b.bw}x${b.bh}px`);
    assert(!b.over && b.inside, 'the reminder card or its button runs off the screen');
    await browser.eval("document.querySelector('[data-reminder-card] [data-dismiss]').click()");
    await new Promise((r) => setTimeout(r, 250));
    const after = await browser.eval(`[...document.querySelectorAll('[data-reminder-card]')].map((e) => e.dataset.reminderCard)`);
    assert(!after.includes(b.kind), `Hide did not remove the ${b.kind} card`); // (a third due card may take its place: the list shows two)
  });
}

// Protein helper (v0.16.73): the "N g protein to go" card, scrolled into view in the `screens` artifact at the phone, a small
// phone at 160% text, and both Duo sizes. Rows 44px or more and inside the card, a 44px hide button, no sideways overflow,
// names wrap at spaces (no word broken mid-way), and the card is gone after Hide and when over target.
const PRO_PROBE = `(() => {
  const card = document.querySelector('[data-pro-help]'); if (!card) return null;
  const c = card.getBoundingClientRect(), rows = [...card.querySelectorAll('.pro-row')], x = card.querySelector('.pro-dismiss').getBoundingClientRect();
  const inside = (r) => r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1;
  let broken = [];
  for (const b of card.querySelectorAll('.pro-text b')) {
    const s = document.createElement('span'); s.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:' + getComputedStyle(b).font;
    document.body.appendChild(s);
    for (const w of b.textContent.split(/\\s+/)) { s.textContent = w; if (s.getBoundingClientRect().width > b.clientWidth + 1) broken.push(w); }
    s.remove();
  }
  return { rows: rows.length, minH: Math.min(...rows.map((r) => Math.round(r.getBoundingClientRect().height))), outside: rows.filter((r) => !inside(r.getBoundingClientRect())).length,
    xW: Math.round(x.width), xH: Math.round(x.height), over: document.documentElement.scrollWidth > innerWidth + 1 || card.scrollWidth > card.clientWidth + 1, broken, left: card.querySelector('.label').textContent };
})()`;
for (const [w, h, ts] of standalone && (!only || only.includes('food')) ? [[390, 844, 1], [320, 568, 1.6], [626, 890, 1], [678, 466, 1]] : []) {
  const tag = `${w}x${h}${ts !== 1 ? '-text160' : ''}`;
  test(`layout: food: the protein helper card fits at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, true);
    await browser.open('food', seed({ pro: true }));
    if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
    await browser.eval("document.querySelector('[data-pro-help]')?.scrollIntoView({ block: 'center' })");
    await new Promise((r) => setTimeout(r, 250));
    if (shots) await browser.screenshot(`${shots}/food-prohelp-${tag}.png`);
    const r = await browser.eval(PRO_PROBE);
    assert(r, 'the protein card does not show with the pro seed');
    assert(/^\d+ g protein to go$/.test(r.left), `card title reads "${r.left}"`);
    assert(r.rows >= 3 && r.rows <= 4, `${r.rows} ideas`);
    assert(r.minH >= 44, `an idea row is ${r.minH}px tall`);
    assert(r.outside === 0, `${r.outside} rows poke out of the card`);
    assert(r.xW >= 44 && r.xH >= 44, `Hide button is ${r.xW}x${r.xH}`);
    assert(!r.over, 'the card overflows sideways');
    assert(r.broken.length === 0, `words too long for their line (would break mid-word): ${r.broken.join(', ')}`);
    await browser.eval("document.querySelector('[data-pro-dismiss]').click()");
    await new Promise((r2) => setTimeout(r2, 300));
    assert(await browser.eval("!document.querySelector('[data-pro-help]')"), 'the card is still there after Hide');
  });
}
test('layout: food: the protein helper card is gone when over target', async () => {
  if (!standalone || (only && !only.includes('food')) || skipReason()) return;
  browser = browser || await launch();
  await browser.viewport(390, 844, true);
  await browser.open('food', seed({ over: true }));
  assert(await browser.eval("!document.querySelector('[data-pro-help]')"), 'card shows even though protein is over target');
});

// Favorite meals (v0.16.75): the row at the top of Log food and the review sheet, at the phone, a small phone at 160% text and both Duo sizes.
const FAV_PROBE = `(() => {
  const dlg = document.querySelector('dialog.sheet'); if (!dlg) return null;
  const box = dlg.getBoundingClientRect();
  const row = dlg.querySelector('[data-favs]'); if (!row || row.hidden) return { none: true };
  const cards = [...row.querySelectorAll('.fav-card')];
  const small = [...row.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5; }).length;
  const first = cards[0].getBoundingClientRect();
  return { cards: cards.length, recent: row.querySelectorAll('.fav-card.recent').length, small, firstInside: first.left >= box.left - 0.5 && first.right <= box.right + 0.5, rowW: row.getBoundingClientRect().width, boxW: box.width,
    head: row.querySelector('.fav-head').textContent, bad: cards.filter((c) => c.scrollWidth > c.clientWidth + 1).length, pageOver: document.documentElement.scrollWidth > innerWidth + 1 };
})()`;
const REVIEW_PROBE = `(() => {
  const dlg = document.querySelector('dialog.sheet'); if (!dlg) return null;
  const body = dlg.querySelector('.sheet-body'); const box = body.getBoundingClientRect();
  const items = [...dlg.querySelectorAll('.fav-item')];
  const out = items.flatMap((li) => [...li.querySelectorAll('button')]).filter((b) => { const r = b.getBoundingClientRect(); return r.left < box.left - 0.5 || r.right > box.right + 0.5; }).length;
  const small = [...dlg.querySelectorAll('.fav-item button, [data-log], [data-save]')].filter((b) => { const r = b.getBoundingClientRect(); return b.offsetParent && (r.height < 43.5 || r.width < 43.5); }).length;
  const wide = [...body.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > box.right + 0.5).slice(0, 4).map((e) => e.tagName + '.' + e.className + ':' + Math.round(e.getBoundingClientRect().right - box.right)); return { items: items.length, out, small, wide, sw: body.scrollWidth, cw: body.clientWidth, over: body.scrollWidth > body.clientWidth + 1, logLines: Math.round(dlg.querySelector('[data-log]').getBoundingClientRect().height / 20) };
})()`;
for (const [w, h, ts] of standalone && (!only || only.includes('food')) ? [[390, 844, 1], [320, 568, 1.6], [626, 890, 1], [678, 466, 1]] : []) {
  const tag = `${w}x${h}${ts !== 1 ? '-text160' : ''}`;
  test(`layout: food: favorite meals row and review sheet fit at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, true);
    await browser.open('food', seed({ fav: true }));
    if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
    await browser.eval("document.querySelector('[data-log-food]').click()");
    await new Promise((r) => setTimeout(r, 900));
    if (shots) await browser.screenshot(`${shots}/food-favs-${tag}.png`);
    const r = await browser.eval(FAV_PROBE);
    assert(r && !r.none, 'no favorites row in Log food');
    assert(r.head === 'Favorite meals', `heading reads "${r.head}"`);
    assert(r.cards === 3 && r.recent === 1, `${r.cards} cards, ${r.recent} recent (want 2 favorites and last night's dinner)`);
    assert(r.small === 0, `${r.small} favorite buttons under 44x44`);
    assert(r.firstInside && r.bad === 0 && !r.pageOver, `row overflows: ${JSON.stringify(r)}`);
    // typing a search hides the row so the results have the room
    await browser.eval("(() => { const q = document.querySelector('dialog.sheet [name=q]'); q.value = 'oat'; q.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await new Promise((r2) => setTimeout(r2, 300));
    assert(await browser.eval("document.querySelector('dialog.sheet [data-favs]').hidden"), 'the row stays while searching');
    await browser.eval("(() => { const q = document.querySelector('dialog.sheet [name=q]'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await new Promise((r2) => setTimeout(r2, 300));
    // the dots open the review sheet
    await browser.eval("document.querySelector('[data-fav-edit=\"0\"]').click()");
    await new Promise((r2) => setTimeout(r2, 1000));
    if (shots) await browser.screenshot(`${shots}/food-favreview-${tag}.png`);
    const v = await browser.eval(REVIEW_PROBE);
    assert(v && v.items === 3, `review sheet shows ${v && v.items} foods`);
    assert(v.out === 0 && !v.over, `review controls poke out of the sheet: ${JSON.stringify(v)}`);
    assert(v.small === 0, `${v.small} review buttons under 44x44`);
    // swap view
    await browser.eval("document.querySelector('[data-swap=\"1\"]').click()");
    await new Promise((r2) => setTimeout(r2, 400));
    if (shots) await browser.screenshot(`${shots}/food-favswap-${tag}.png`);
    assert(await browser.eval("!!document.querySelector('dialog.sheet [data-results] [data-k]')"), 'swap list is empty');
  });
}

// Quick add (v0.16.79): Calories, Protein, Carbs and Fat fields fit the sheet and keep 44px targets.
for (const [w, h, ts] of standalone && (!only || only.includes('food')) ? [[390, 844, 1], [320, 568, 1.6], [466, 678, 1], [678, 466, 1], [626, 890, 1]] : []) {
  const tag = `${w}x${h}${ts !== 1 ? '-text160' : ''}`;
  test(`layout: food: quick add fields fit at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, true);
    await browser.open('food', seed());
    if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
    await browser.eval("document.querySelector('[data-log-food]').click()");
    await new Promise((r) => setTimeout(r, 900));
    await browser.eval("document.querySelector('dialog.sheet [data-quick-toggle]').click()");
    await new Promise((r) => setTimeout(r, 400));
    if (shots) await browser.screenshot(`${shots}/food-quickadd-${tag}.png`);
    const r = await browser.eval(`(() => {
      const dlg = document.querySelector('dialog.sheet'); const q = dlg.querySelector('[data-quick]'); const box = dlg.getBoundingClientRect();
      const ins = [...q.querySelectorAll('input')];
      return { names: ins.map((i) => i.name).join(), modes: ins.map((i) => i.inputMode).join(),
        out: ins.filter((i) => { const b = i.getBoundingClientRect(); return b.left < box.left - 0.5 || b.right > box.right + 0.5; }).length,
        small: ins.filter((i) => i.getBoundingClientRect().height < 43.5).length,
        pageOver: document.documentElement.scrollWidth > innerWidth + 1 };
    })()`);
    assert(r.names === 'kcal,p,c,f', `quick add fields: ${r.names}`);
    assert(r.modes === 'numeric,decimal,decimal,decimal', `keypads: ${r.modes}`);
    assert(r.out === 0 && r.small === 0 && !r.pageOver, `quick add layout: ${JSON.stringify(r)}`);
  });
}

// Weekly recap (v0.16.74): the Today card (the clock is pinned to a Monday) and its detail sheet at the phone, a small phone at
// 160% text, and both Duo sizes. Card and sheet rows stay inside their boxes, tap targets 44px or more, no sideways overflow.
// The fixture week (Mon Oct 5 to Sun Oct 11) gets food logged, protein under target and calories under the limit, so the
// longest row ("2,100 kcal · limit ..." style) is rendered and checked too.
const recapSeed = () => {
  const d = seed();
  const base = d.food_logs[0];
  for (let n = 5; n <= 9; n++) {
    const day = `2026-10-${String(n).padStart(2, '0')}`;
    d.food_logs.push({ ...base, id: `rf${n}`, day, kcal: 1900, protein_g: 100, logged_at: `${day}T12:00:00.000Z` });
  }
  return d;
};
const RECAP_SIZES = [[390, 844, 1], [320, 568, 1.6], [626, 890, 1], [678, 466, 1]];
const setTs = async (ts) => { if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); } };
for (const [w, h, ts] of standalone && (!only || only.includes('today')) ? RECAP_SIZES : []) {
  const tag = `${w}x${h}${ts !== 1 ? '-text160' : ''}`;
  test(`layout: today: the weekly recap card and sheet fit at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, true);
    await browser.open('today', recapSeed());
    await setTs(ts);
    await browser.eval("document.querySelector('[data-recap-card]')?.scrollIntoView({ block: 'center' })");
    await new Promise((r) => setTimeout(r, 250));
    if (shots) await browser.screenshot(`${shots}/today-recap-${tag}.png`);
    const c = await browser.eval("(() => { const e = document.querySelector('[data-recap-card]'); if (!e) return null; const r = e.getBoundingClientRect(); return { h: Math.round(r.height), over: document.documentElement.scrollWidth > innerWidth + 1 || e.scrollWidth > e.clientWidth + 1, label: e.getAttribute('aria-label') }; })()");
    assert(c, 'the recap card does not show on a Monday with last week logged');
    assert(c.h >= 44 && !c.over, `recap card is ${c.h}px tall or overflows (${c.over})`);
    assert(/recap/i.test(c.label), 'the card has a VoiceOver label');
    await browser.eval("document.querySelector('[data-recap-card]').click()");
    await new Promise((r) => setTimeout(r, 700));
    if (shots) await browser.screenshot(`${shots}/today-recap-sheet-${tag}.png`);
    const s = await browser.eval(`(() => {
      const b = document.querySelector('[data-recap]'); if (!b) return null;
      const bb = b.getBoundingClientRect();
      const rows = [...b.querySelectorAll('[data-recap-row]')];
      const keys = rows.map((r) => r.dataset.recapRow);
      const out = rows.filter((r) => r.scrollWidth > r.clientWidth + 1 || r.getBoundingClientRect().right > bb.right + 1 || r.getBoundingClientRect().left < bb.left - 1).length;
      // a value may drop under its label, but never break inside a word or a number
      const split = [];
      for (const v of b.querySelectorAll('[data-recap-row] > b')) {
        const t = v.firstChild; if (!t) continue;
        const re = /\\S+/g; let m;
        while ((m = re.exec(t.textContent))) { const g = document.createRange(); g.setStart(t, m.index); g.setEnd(t, m.index + m[0].length); if (g.getClientRects().length > 1) split.push(m[0]); }
      }
      const btns = [...b.querySelectorAll('.recap-actions .btn')].map((x) => Math.round(x.getBoundingClientRect().height));
      return { keys, out, split, btns, over: document.documentElement.scrollWidth > innerWidth + 1, tip: !!b.querySelector('[data-recap-tip]') };
    })()`);
    assert(s && s.tip, 'the recap sheet did not open with a tip');
    for (const k of ['workouts', 'protein', 'calories']) assert(s.keys.includes(k), `the ${k} row is missing from the recap sheet (${s.keys.join(',')})`);
    assert(s.out === 0 && !s.over, `${s.out} recap rows overflow, page overflow ${s.over}`);
    assert(s.split.length === 0, `recap values break inside a word or number: ${s.split.join(' ')}`);
    assert(s.btns.length === 2 && s.btns.every((x) => x >= 44), `recap buttons are ${s.btns.join('/')}px tall`);
  });
}

// Past recaps (Progress → Weekly recaps): at least two past weeks are seeded, rows are tap targets, a tap opens that week.
for (const [w, h, ts] of standalone && (!only || only.includes('recaps')) ? RECAP_SIZES : []) {
  const tag = `${w}x${h}${ts !== 1 ? '-text160' : ''}`;
  test(`layout: recaps: the past weeks list fits at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, true);
    await browser.open('recaps', recapSeed());
    await setTs(ts);
    if (shots) await browser.screenshot(`${shots}/recaps-list-${tag}.png`);
    const l = await browser.eval("(() => { const rows = [...document.querySelectorAll('[data-recap-open]')]; return { n: rows.length, hs: rows.map((r) => Math.round(r.getBoundingClientRect().height)), over: document.documentElement.scrollWidth > innerWidth + 1 || rows.some((r) => r.scrollWidth > r.clientWidth + 1), first: rows[0] && rows[0].dataset.recapOpen, label: rows[0] && rows[0].getAttribute('aria-label') }; })()");
    assert(l.n >= 2, `only ${l.n} past weeks listed`);
    assert(l.hs.every((x) => x >= 44), `a recap row is ${Math.min(...l.hs)}px tall`);
    assert(!l.over, 'the recaps list overflows sideways');
    assert(/recap/i.test(l.label), 'rows have a VoiceOver label');
    await browser.eval("document.querySelector('[data-recap-open]').click()");
    await new Promise((r) => setTimeout(r, 700));
    const o = await browser.eval("(() => { const b = document.querySelector('[data-recap]'); return b ? { range: b.querySelector('.label').textContent } : null; })()");
    assert(o && /Oct 5/.test(o.range), `tapping the newest row did not open last week's sheet (${o && o.range})`);
  });
}
test('layout: recaps: the empty state fits at 390x844', async () => {
  if (!standalone || (only && !only.includes('recaps')) || skipReason()) return;
  browser = browser || await launch();
  await browser.viewport(390, 844, true);
  const d = seed({ empty: true });
  await browser.open('recaps', d);
  if (shots) await browser.screenshot(`${shots}/recaps-empty-390x844.png`);
  const e = await browser.eval("(() => ({ list: !!document.querySelector('[data-recap-list]'), text: document.querySelector('#main .card .muted')?.textContent || '', over: document.documentElement.scrollWidth > innerWidth + 1 }))()");
  assert(!e.list && /first recap/i.test(e.text) && !e.over, `empty state wrong: ${JSON.stringify(e)}`);
});
test('layout: progress: the Weekly recaps row is in the Progress rows', async () => {
  if (!standalone || (only && !only.includes('recaps')) || skipReason()) return;
  browser = browser || await launch();
  await browser.viewport(390, 844, true);
  await browser.open('score', seed());
  const r = await browser.eval("(() => { const a = document.querySelector('[data-progress-rows] a[href=\"#/recaps\"]'); return a ? Math.round(a.getBoundingClientRect().height) : null; })()");
  assert(r && r >= 44, `the Weekly recaps row is missing or ${r}px tall`);
});

// Apple Health card inside the iPhone app (v0.16.90): a stubbed native shell, three states: connected with a workout read,
// connected with a failed workout read, and rows from another phone with no stamp here (the one-tap prompt).
// Phone dark and light, small phone at 160% text, both Duo sizes. No overflow, no clipped text, every button 44px or more.
const AH_SIZES = [[390, 844, true, 1], [390, 844, false, 1], [320, 568, true, 1.6], [466, 678, true, 1], [678, 466, false, 1], [626, 890, true, 1], [890, 626, false, 1]];
const AH_STATES = {
  stamp: { last: true, read: true, fail: false },
  failed: { last: true, read: true, fail: true },
  prompt: { last: false, read: false, fail: false },
};
const AH_SET = (st) => `(async () => {
  const uid = 'u1'; const now = Date.now();
  for (const k of ['forge.healthkit.last.' + uid, 'forge.healthkit.workouts.' + uid, 'forge.healthkit.workoutsFailedAt.' + uid]) localStorage.removeItem(k);
  const a = await import('./js/native/autoread.js');
  const o = ${JSON.stringify(st)};
  if (o.last) localStorage.setItem(a.nativeReadKey(uid), String(now - 20 * 60000));
  if (o.read) localStorage.setItem(a.workoutsKey(uid), String(now - 7 * 60000));
  if (o.fail) localStorage.setItem(a.workoutsFailedKey(uid), String(now - 60000));
  const m = await import('./js/screens/apple.js');
  m.renderApple(document.getElementById('main'));
})()`;
const AH_PROBE = `(() => {
  const c = document.querySelector('[data-native-health]'); if (!c) return null;
  const vw = innerWidth;
  const btns = [...c.querySelectorAll('button')].map((b) => ({ t: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height), off: b.getBoundingClientRect().right > vw + 1 || b.getBoundingClientRect().left < -1 || b.scrollWidth > b.clientWidth + 1 }));
  const clipped = [...c.querySelectorAll('p, div, span, b')].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > vw + 1).length;
  return { text: c.textContent, btns, clipped, page: document.documentElement.scrollWidth > vw + 1, read: !!c.querySelector('[data-workout-read]'), check: !!c.querySelector('[data-check-workouts]'), prompt: !!c.querySelector('[data-native-reconnect]') };
})()`;
for (const [w, h, dark, ts] of standalone && (!only || only.includes('apple')) ? AH_SIZES : []) {
  const tag = `${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? '-text160' : ''}`;
  test(`layout: apple: the iPhone app card (connected, failed read, reconnect prompt) fits at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, dark);
    // the stub has no Health plugin, so any automatic read fails quietly; each state is written to storage and the card redrawn afterwards
    await browser.open('apple', seed(), "window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => false };");
    if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
    for (const [name, st] of Object.entries(AH_STATES)) {
      await browser.eval(AH_SET(st));
      await new Promise((r) => setTimeout(r, 300));
      await browser.eval("document.querySelector('[data-native-health]')?.scrollIntoView({ block: 'start' })");
      await new Promise((r) => setTimeout(r, 200));
      const r = await browser.eval(AH_PROBE);
      if (shots) await browser.screenshot(`${shots}/apple-native-${name}-${tag}.png`);
      assert(r, `${name}: the native Apple Health card is missing`);
      assert(!r.page && r.clipped === 0, `${name}: overflow (page ${r.page}, ${r.clipped} clipped)`);
      assert(r.btns.every((b) => b.h >= 44 && !b.off), `${name}: buttons ${JSON.stringify(r.btns)}`);
      if (name === 'stamp') assert(r.read && r.check && /Last workout read: 7 min ago/.test(r.text) && !/trying again/.test(r.text) && !r.prompt, `stamp: ${r.text.slice(0, 200)}`);
      if (name === 'failed') assert(r.read && /trying again soon/.test(r.text) && !r.prompt, `failed: ${r.text.slice(0, 200)}`);
      if (name === 'prompt') assert(r.prompt && !r.read && !r.check && /isn’t reading automatically on this iPhone/.test(r.text) && r.btns.some((b) => b.t === 'Turn Apple Health back on'), `prompt: ${r.text.slice(0, 200)}`);
    }
  });
}

// Program: the Change start date sheet, at the phone and Duo sizes (this also feeds the `screens` artifact)
for (const [w, h] of standalone && (!only || only.includes('program')) ? [[390, 844], [466, 678], [678, 466], [626, 890], [890, 626]] : []) {
  test(`layout: program: the Change start date sheet fits at ${w}x${h}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, true);
    await browser.open('program', seed({ program: true }));
    await browser.eval("document.querySelector('[data-program-start]').click()");
    await new Promise((r) => setTimeout(r, 600));
    const r = await browser.eval("(() => { const d = [...document.querySelectorAll('dialog.sheet[open]')].pop(); if (!d) return null; const b = d.querySelector('[data-yes]').getBoundingClientRect(); return { over: d.scrollWidth > d.clientWidth + 1, yes: Math.round(b.height), off: b.right > innerWidth + 1 }; })()");
    if (shots && r) await browser.screenshot(`${shots}/program-sheet-${w}x${h}.png`);
    assert(r, 'the sheet did not open');
    assert(!r.over && !r.off, 'the sheet overflows sideways');
    assert(r.yes >= 44, `Change date button is ${r.yes}px tall`);
  });
}

// Withings Connected card (v0.16.78, #220): the Last weigh-in / Arrived in / Notifications stats stay inside the card, with and
// without an arrival time (the long "waiting for your next weigh-in" text), at 320 with large text, the phone and both Duo sizes.
const WS_SIZES = [[320, 568, 1], [320, 568, 1.6], [390, 844, 1], [466, 678, 1], [678, 466, 1]];
for (const [w, h, ts] of standalone && (!only || only.includes('withings')) ? WS_SIZES : []) {
  const tag = `${w}x${h}${ts !== 1 ? '-text' : ''}`;
  test(`layout: withings: the Connected card stats sit inside the card at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, true);
    for (const waiting of [true, false]) {
      const data = seed();
      data.integrations.push({ id: 'withings', connected: true, needs_reconnect: false, scopes: 'user.info,user.metrics,user.activity', model: 'Body+', subscription_ok: true, last_weigh_in_at: new Date(Date.parse(WORKOUT_DAY) - 7200000).toISOString(), last_latency_s: waiting ? null : 95, last_sync_at: new Date(Date.parse(WORKOUT_DAY) - 3600000).toISOString() });
      await browser.open('withings', data);
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
      await browser.eval("document.querySelector('[data-wd-stats]')?.scrollIntoView({ block: 'center' })");
      await new Promise((r) => setTimeout(r, 200));
      if (shots) await browser.screenshot(`${shots}/withings-stats-${waiting ? 'waiting-' : ''}${tag}.png`);
      const r = await browser.eval(`(() => {
        const g = document.querySelector('[data-wd-stats]'); if (!g) return null;
        const c = g.closest('.card').getBoundingClientRect(), cells = [...g.children];
        const out = cells.filter((e) => [e, ...e.children].some((k) => { const q = k.getBoundingClientRect(); return q.right > c.right + 1 || q.left < c.left - 1 || k.scrollWidth > k.clientWidth + 1; })).length;
        return { n: cells.length, out, card: c.right <= innerWidth + 1 && c.left >= -1, page: document.documentElement.scrollWidth > innerWidth + 1 };
      })()`);
      assert(r && r.n === 3, 'the Connected card has no three stats');
      assert(r.out === 0 && r.card && !r.page, `a stat runs past the card (waiting ${waiting}): ${JSON.stringify(r)}`);
    }
  });
}

// Empty states (v0.16.85, #235): a brand-new account on Score, Trends, Withings (not connected, and connected with no data).
// Art shown, one 44px+ action, no overflow or clipping, no empty rings; phone, both Duo postures folded and unfolded, 320 at 1.6 text.
const ES_SIZES = [[390, 844, true, 1], [390, 844, false, 1], [466, 678, true, 1], [678, 466, false, 1], [626, 890, true, 1], [890, 626, false, 1], [320, 568, true, 1.6]];
for (const [route, variant] of [['score', 'plain'], ['trends', 'plain'], ['withings', 'off'], ['withings', 'on']]) {
  test(`layout: empty state on ${route}${variant === 'plain' ? '' : ' ' + variant} fits at every size`, async () => {
    if (!standalone || (only && !only.includes(route)) || skipReason()) return;
    browser = browser || await launch();
    const found = [];
    for (const [w, h, dark, ts] of ES_SIZES) {
      await browser.viewport(w, h, dark);
      const data = seed({ empty: true });
      if (variant === 'on') data.integrations.push({ id: 'withings', connected: true, needs_reconnect: false, scopes: 'user.info,user.metrics,user.activity', model: 'Body+', subscription_ok: true });
      await browser.open(route, data);
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
      const tag = `${route}-empty${variant === 'plain' ? '' : '-' + variant}-${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? '-text' : ''}`;
      if (shots) await browser.screenshot(`${shots}/${tag}.png`);
      const r = await browser.eval(`(() => {
        const e = document.querySelector('#main .empty-state'); if (!e) return { none: true };
        const q = e.getBoundingClientRect();
        const btn = e.querySelector('.btn');
        return { art: !!e.querySelector('.es-art svg'), clip: q.right > innerWidth + 1 || q.left < -1 || document.documentElement.scrollWidth > innerWidth + 1,
          small: btn ? btn.getBoundingClientRect().height < 43.5 : false, rings: document.querySelectorAll('#main .pillar-grid').length };
      })()`);
      const probs = await browser.eval(`(${detect})(${JSON.stringify({ largeText: ts !== 1 })})`);
      if (r.none || !r.art) found.push(`${tag}: no illustrated empty state`);
      else if (r.clip || r.small || r.rings || probs.length) found.push(`${tag}: ${JSON.stringify(r)} ${probs.join(' | ')}`);
    }
    assert(found.length === 0, '\n        ' + found.join('\n        '));
  });
}

// Data-screen sweep (v0.16.86, #236): Score, Trends, Weekly, Report, a metric page and Progress photos, with data, at the phone
// (dark and light), all four Duo sizes and 320 at 1.6 text. No sideways overflow, clipped label, wrapped chip, element outside the
// screen, or tap target under 44px; and on the unfolded Duo no single column wider than 560px.
const DS_SIZES = [[390, 844, true, 1], [390, 844, false, 1], [466, 678, true, 1], [678, 466, false, 1], [626, 890, true, 1], [890, 626, false, 1], [320, 568, true, 1.6], [320, 568, true, 1]];
const DS_ROUTES = ['score', 'trends', 'weekly', 'report', 'metric/weight_kg', 'photos'];
for (const route of DS_ROUTES) {
  const base = route.split('/')[0];
  test(`layout: data screens: ${route} fits at every size`, async () => {
    if (!standalone || (only && !only.includes(base) && !only.includes('datascreens')) || skipReason()) return;
    browser = browser || await launch();
    const found = [];
    for (const [w, h, dark, ts] of DS_SIZES) {
      await browser.viewport(w, h, dark);
      await browser.open(route, seed({}));
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
      const tag = `${route.replace('/', '-')}-${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? '-text160' : ''}`;
      if (shots) await browser.screenshot(`${shots}/${tag}.png`);
      const probs = await browser.eval(`(${detect})(${JSON.stringify({ largeText: ts !== 1 })})`);
      const wide = await browser.eval(`(() => {
        const out = [];
        for (const e of document.querySelectorAll('#main > *, #main .card')) {
          const r = e.getBoundingClientRect();
          if (r.width < 1) continue;
          if (innerWidth >= 600 && r.width > 560 && e.matches('.card') && !e.closest('[data-layout-ok]')) out.push('wide ' + e.className + ' ' + Math.round(r.width));
          const p = e.closest('.card') && e.closest('.card') !== e ? e.closest('.card').getBoundingClientRect() : null;
          if (p && (r.right > p.right + 1 || r.left < p.left - 1)) out.push('outside card: ' + e.className);
        }
        return out;
      })()`);
      const vo = await browser.eval(`[...document.querySelectorAll('#main svg')].filter((v) => !v.closest('[aria-hidden=true], [aria-label], button, a[href]') && !v.getAttribute('aria-hidden') && !(v.getAttribute('role') === 'img' && (v.getAttribute('aria-label') || '').trim())).map((v) => 'chart without a spoken summary: ' + v.getAttribute('class'))`);
      wide.push(...vo);
      // Titles and chart axes (round 2): an h1 wider than its row or past the screen, a header button on top of the h1, an axis
      // label starting left of its SVG or touching another label.
      const heads = await browser.eval(`(() => {
        const out = [], ov = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        for (const h of document.querySelectorAll('#main h1')) {
          const q = h.getBoundingClientRect(), p = h.parentElement.getBoundingClientRect();
          if (q.right > innerWidth + 1 || q.left < -1 || q.right > p.right + 1 || h.scrollWidth > h.clientWidth + 1) out.push('title runs past its row or the screen: ' + h.textContent.trim());
          for (const b of h.parentElement.querySelectorAll('button, a, .btn')) if (!h.contains(b) && ov(q, b.getBoundingClientRect())) out.push('button over the title: ' + b.textContent.trim());
        }
        for (const s of document.querySelectorAll('#main svg text.axis')) {
          const sv = s.ownerSVGElement.getBoundingClientRect(), q = s.getBoundingClientRect();
          if (q.left < sv.left - 0.5 || q.right > sv.right + 0.5) out.push('axis label outside its chart: ' + s.textContent);
          for (const o of s.ownerSVGElement.querySelectorAll('text.axis')) if (o !== s && ov(q, o.getBoundingClientRect())) out.push('axis labels overlap: ' + s.textContent + ' / ' + o.textContent);
        }
        return [...new Set(out)];
      })()`);
      wide.push(...heads);
      if (probs.length || wide.length) found.push(`${tag}: ${probs.concat(wide).join(' | ')}`);
    }
    assert(found.length === 0, '\n        ' + found.join('\n        '));
  });
}

// Withings steps (v0.16.70): the calm "Reconnect to add steps" note (connected, stored scopes lack user.activity) and a
// Past days page whose steps came from Withings. Visible, unclipped, the reconnect button 44px or taller.
for (const [w, h, ts] of standalone && (!only || only.includes('withings') || only.includes('days')) ? [[390, 844, 1], [320, 568, 1.6], [678, 466, 1]] : []) {
  const tag = `${w}x${h}${ts !== 1 ? '-text' : ''}`;
  test(`layout: withings: the Reconnect to add steps note and "from Withings" fit at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, true);
    const data = seed();
    data.integrations.push({ id: 'withings', connected: true, needs_reconnect: false, scopes: 'user.info,user.metrics', model: 'Body+', last_sync_at: new Date(Date.parse(WORKOUT_DAY) - 3600000).toISOString() });
    await browser.open('withings', data);
    if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
    const n = await browser.eval("(() => { const p = document.querySelector('[data-steps-note]'); if (!p) return null; const b = p.querySelector('[data-connect]'); const q = b.getBoundingClientRect(), r = p.getBoundingClientRect(); return { text: p.textContent.trim(), btn: Math.round(q.height), off: r.right > innerWidth + 1 || r.left < -1 || q.right > innerWidth + 1, clipped: p.scrollWidth > p.clientWidth + 1 || b.scrollWidth > b.clientWidth + 1, shown: r.width > 0 && r.height > 0, over: document.documentElement.scrollWidth > innerWidth + 1 }; })()");
    if (shots) await browser.screenshot(`${shots}/withings-steps-note-${tag}.png`);
    assert(n && n.shown, 'the steps note is not shown');
    assert(/Reconnect to add steps/.test(n.text), `note reads "${n.text}"`);
    assert(n.btn >= 44, `Reconnect to add steps is ${n.btn}px tall`);
    assert(!n.off && !n.clipped && !n.over, `the note is clipped or off screen: ${JSON.stringify(n)}`);

    const d2 = seed();
    d2.health_daily.forEach((r) => { r.steps_source = 'withings'; r.apple_steps = 6000; });
    await browser.open('days/2026-10-11', d2);
    if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
    const s = await browser.eval("(() => ({ has: /from Withings/.test(document.querySelector('#main').innerText), over: document.documentElement.scrollWidth > innerWidth + 1 }))()");
    if (shots) await browser.screenshot(`${shots}/days-from-withings-${tag}.png`);
    assert(s.has, '"from Withings" is not on the Past days page');
    assert(!s.over, 'the Past days page overflows sideways');
  });
}

/** Poll the page until `selector` exists; fail with a clear message instead of a TypeError on null. */
async function waitForEl(selector, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await browser.eval(`!!document.querySelector(${JSON.stringify(selector)})`).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${what} (${selector}) never showed up within ${ms} ms`);
}

// Live workout: the running screen (Run shows distance and pace) and the paused look, at the phone and Duo sizes
for (const [w, h] of standalone && (!only || only.includes('live')) ? [[390, 844], [466, 678], [678, 466], [626, 890], [890, 626]] : []) {
  for (const dark of [true, false]) {
    test(`layout: live: the running screen fits at ${w}x${h} ${dark ? 'dark' : 'light'}`, async () => {
      if (skipReason()) return;
      browser = browser || await launch();
      await browser.viewport(w, h, dark);
      await browser.open('live', seed(), "localStorage.removeItem('forge.live');");
      await waitForEl('[data-kind=run]', 5000, 'the workout picker');
      await browser.eval("document.querySelector('[data-kind=run]').click(); document.querySelector('[data-start]').click()");
      await waitForEl('[data-pause]', 8000, 'the running screen (after the 3-2-1)');
      await browser.eval("document.querySelector('[data-pause]').click()");
      await new Promise((r) => setTimeout(r, 400));
      const r = await browser.eval("(() => { const b = document.querySelector('[data-pause]').getBoundingClientRect(); const e = document.querySelector('[data-end]').getBoundingClientRect(); const wide = [...document.querySelectorAll('.live-tv')].filter((n) => n.scrollWidth > n.clientWidth).length; const wrapped = [...document.querySelectorAll('.live-tl')].filter((n) => n.scrollWidth > n.clientWidth).length; return { over: document.documentElement.scrollWidth > innerWidth + 1, tall: (() => { const l = document.querySelector('.live'); return l.scrollHeight > l.clientHeight + 1 || document.documentElement.scrollHeight > innerHeight + 1; })(), bottom: Math.round(Math.max(b.bottom, e.bottom)), h: innerHeight, pause: Math.round(b.height), end: Math.round(e.height), wide, wrapped, tiles: document.querySelectorAll('.live-tile').length }; })()");
      if (shots) await browser.screenshot(`${shots}/live-running-${w}x${h}-${dark ? 'dark' : 'light'}.png`);
      await browser.eval("localStorage.removeItem('forge.live')");
      assert(r && !r.over, 'the live screen overflows sideways');
      assert(r.pause >= 44 && r.end >= 44, `Pause ${r.pause}px / End ${r.end}px tall`);
      assert(r.tiles === 5, `expected 5 tiles for a run, got ${r.tiles}`);
      assert(r.bottom <= r.h, `Pause/End bottom at ${r.bottom}px, below the ${r.h}px screen`);
      assert(!r.tall, 'the running screen scrolls: it must fit one screen');
      assert(r.wide === 0, `${r.wide} tile value(s) wider than their tile`);
      assert(r.wrapped === 0, `${r.wrapped} tile label(s) cut off`);
    });
  }
}

// Live workout sheets (v0.16.59): "End this workout?" with its "Yes, discard it" step, and "A live workout is running" when
// Start workout is tapped mid-session. Phone, both Duo postures folded and unfolded, and large text; copy and buttons must fit.
const LIVE_SEED = (ms) => `(() => { const n = Date.now(); localStorage.setItem('forge.live', JSON.stringify({ session: { id: 'live_shot', kind: 'walk', started_at: n - ${ms}, ended_at: null, pauses: [], pausedAt: null }, metrics: {} })); })();`;
const SHEET_PROBE = "(() => { const d = [...document.querySelectorAll('dialog.sheet[open]')].pop(); if (!d) return null; const bs = [...d.querySelectorAll('.stack button')].filter((b) => b.offsetParent); const r = d.getBoundingClientRect(); return { over: d.scrollWidth > d.clientWidth + 1, off: bs.some((b) => b.getBoundingClientRect().right > innerWidth + 1 || b.getBoundingClientRect().left < -1), short: bs.filter((b) => b.getBoundingClientRect().height < 44).length, clipped: bs.filter((b) => b.scrollWidth > b.clientWidth + 1).length, n: bs.length, top: Math.round(r.top), h: innerHeight }; })()";
for (const [w, h, ts] of standalone && (!only || only.includes('live')) ? [[390, 844, 1], [390, 844, 1.35], [466, 678, 1], [678, 466, 1], [626, 890, 1], [890, 626, 1]] : []) {
  const tag = `${w}x${h}${ts !== 1 ? '-text' : ''}`;
  test(`layout: live: the End sheet and its discard step fit at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, true);
    await browser.open('live', seed(), LIVE_SEED(125000));
    if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
    await waitForEl('[data-end]', 5000, 'the End button');
    await browser.eval("document.querySelector('[data-end]').click()");
    await waitForEl('dialog.sheet[open]', 5000, 'the End sheet');
    await new Promise((r) => setTimeout(r, 700));
    const a =await browser.eval(SHEET_PROBE);
    if (shots) await browser.screenshot(`${shots}/live-end-sheet-${tag}.png`);
    assert(a && a.n === 3, `End sheet: expected End and save / Discard / Keep going, got ${a && a.n}`);
    await browser.eval("document.querySelector('dialog.sheet[open] [data-discard]').click()");
    await new Promise((r) => setTimeout(r, 300));
    const b = await browser.eval(SHEET_PROBE);
    if (shots) await browser.screenshot(`${shots}/live-discard-sheet-${tag}.png`);
    assert(b && b.n === 2 && await browser.eval("!!document.querySelector('dialog.sheet[open] [data-sure]')"), 'the discard step asks inside the same sheet');
    for (const [name, r] of [['End', a], ['Discard', b]]) {
      assert(!r.over && !r.off, `${name} sheet overflows sideways`);
      assert(r.short === 0, `${name} sheet has ${r.short} button(s) under 44px`);
      assert(r.clipped === 0, `${name} sheet has ${r.clipped} clipped button label(s)`);
      assert(r.top >= 0, `${name} sheet is taller than the screen`);
    }
    await browser.eval("localStorage.removeItem('forge.live')");
  });

  test(`layout: live: the "A live workout is running" sheet fits at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, true);
    await browser.open('train', seed(), LIVE_SEED(125000));
    if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
    const hasStart = await browser.eval("!!document.querySelector('main [data-start], #main [data-start]')");
    assert(hasStart, 'Train has no Start workout button in this seed');
    await browser.eval("document.querySelector('#main [data-start]').click()");
    await waitForEl('dialog.sheet[open]', 5000, 'the live-workout sheet');
    await new Promise((r) => setTimeout(r, 700));
    const r = await browser.eval(SHEET_PROBE);
    if (shots) await browser.screenshot(`${shots}/live-blocked-start-sheet-${tag}.png`);
    assert(r && r.n === 3, `expected Open / Save it and start / Not now, got ${r && r.n}`);
    assert(await browser.eval("document.querySelector('dialog.sheet[open] [data-endit]').textContent.includes('Save it and start')"), 'a workout of a minute or more says it is saved');
    assert(!r.over && !r.off, 'the sheet overflows sideways');
    assert(r.short === 0, `${r.short} button(s) under 44px`);
    assert(r.clipped === 0, `${r.clipped} clipped button label(s)`);
    await browser.eval("localStorage.removeItem('forge.live')");
  });
}

// Cold start on #/live with no workout running: the picker, never the big timer (and nothing from a finished leftover).
test('layout: live: a cold #/live with no workout shows the picker, not the timer; a finished leftover is dropped', async () => {
  if (!standalone || (only && !only.includes('live')) || skipReason()) return;
  browser = browser || await launch();
  await browser.viewport(390, 844, true);
  await browser.open('live', seed(), "localStorage.setItem('forge.live', JSON.stringify({ session: { id: 'live_old', kind: 'walk', started_at: 1, ended_at: 9, pauses: [], pausedAt: null }, metrics: {} }));");
  const r = await browser.eval("({ picker: !!document.querySelector('[data-start]'), clock: !!document.querySelector('[data-clock]'), left: localStorage.getItem('forge.live'), css: getComputedStyle(document.querySelector('.live')).position })");
  assert(r.picker && !r.clock, 'the picker is shown, not the running timer');
  assert(r.left === null, 'the finished leftover was removed');
  assert(r.css === 'fixed', 'the live styles are loaded when the screen is drawn');
});

// Rest screen: #/play mid-rest (8 s left of 90, so the urgent pulse is on), phone and Duo sizes, dark and light.
// The seeded rest is saved the way the timer saves it; Date.now is frozen so the 8 s stay put for the render.
const REST_SEED = "(() => { const n = Date.now(); Date.now = () => n; localStorage.setItem('forge.rest', JSON.stringify({ end: n + 8000, total: 90, label: 'REST', next: { name: 'Push-up', detail: '2 x 10' }, pausedLeft: null })); })();";
for (const [w, h] of standalone && (!only || only.includes('rest')) ? [[390, 844], [466, 678], [678, 466], [626, 890], [890, 626]] : []) {
  for (const dark of [true, false]) {
    test(`layout: rest: the rest ring fits and reads at ${w}x${h} ${dark ? 'dark' : 'light'}`, async () => {
      if (skipReason()) return;
      browser = browser || await launch();
      await browser.viewport(w, h, dark);
      await browser.open('play', seed({ active: true, effort: true }), REST_SEED);
      const r = await browser.eval(`(() => {
        const ring = document.querySelector('.rest-ring'); if (!ring) return null;
        const fg = ring.querySelector('.ring-fg');
        const px = (c) => { const k = document.createElement('canvas').getContext('2d'); k.fillStyle = '#000'; k.fillStyle = c; k.fillRect(0, 0, 1, 1); return k.getImageData(0, 0, 1, 1).data; };
        const lum = (d) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(d[0]) + 0.7152 * f(d[1]) + 0.0722 * f(d[2]); };
        const a = lum(px(getComputedStyle(ring.querySelector('.rg-a')).stopColor)), b = lum(px(getComputedStyle(document.body).backgroundColor));
        const sv = ring.querySelector('svg');
        return { urgent: ring.classList.contains('is-urgent'), stroke: getComputedStyle(fg).stroke, svgFilter: getComputedStyle(sv).filter, fgFilter: getComputedStyle(fg).filter,
          contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), over: document.documentElement.scrollWidth > innerWidth + 1, btn: Math.round(document.querySelector('[data-skiprest]').getBoundingClientRect().height),
          skipBottom: Math.round(document.querySelector('[data-skiprest]').getBoundingClientRect().bottom), nextTop: (() => { const n = document.querySelector('.next-card'); return n ? Math.round(n.getBoundingClientRect().top) : null; })(), nextBottom: (() => { const n = document.querySelector('.next-card'); return n ? Math.round(n.getBoundingClientRect().bottom) : null; })(), vh: innerHeight };
      })()`);
      if (shots && r) await browser.screenshot(`${shots}/rest-${w}x${h}-${dark ? 'dark' : 'light'}.png`);
      await browser.eval("localStorage.removeItem('forge.rest')");
      assert(r, 'the rest screen did not draw');
      assert(r.urgent, 'the ring is not in its urgent (last 10 s) state');
      assert(r.stroke.includes('url('), `ring stroke is ${r.stroke}, not the gradient`);
      assert(r.svgFilter.includes('drop-shadow') && r.fgFilter === 'none', 'the glow must be on the svg, not the circle');
      assert(r.contrast >= 3, `lightest gradient stop is ${r.contrast.toFixed(2)}:1 against the background (needs 3:1)`);
      assert(!r.over && r.btn >= 44, 'the rest screen overflows sideways or the Skip button is under 44 px');
      assert(r.skipBottom <= r.vh, `Skip rest bottom at ${r.skipBottom}px, below the ${r.vh}px screen`);
      assert(r.nextTop !== null && r.nextTop < r.vh, `the Up next card top is at ${r.nextTop}px, off the ${r.vh}px screen`);
    });
  }
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
    const cases = [[320, 568, true, 1], [320, 568, false, 1], [320, 568, true, 1.35], [390, 844, true, 1], [390, 844, false, 1], [390, 844, true, 1.35], [466, 678, true, 1], [678, 466, true, 1], [626, 890, false, 1], [890, 626, true, 1]];
    for (const [w, h, dark, ts] of cases) {
      await browser.viewport(w, h, dark);
      await browser.open('play', seed({ active: true, effort: true }));
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
      await browser.eval("document.querySelector('[data-done]').click()");
      await new Promise((r) => setTimeout(r, 1200));
      const got = await browser.eval("(() => { const b = document.querySelector('.pl-effort'); if (!b) return null; const r = b.getBoundingClientRect(); const p = b.querySelector('p'); const btns = [...b.querySelectorAll('button')].map((x) => { const q = x.getBoundingClientRect(); return { h: q.height, w: q.width, wrap: x.scrollWidth > x.clientWidth + 1 }; }); return { bottom: r.bottom, vh: innerHeight, vw: innerWidth, left: r.left, right: r.right, pWrap: p.getBoundingClientRect().height > parseFloat(getComputedStyle(p).fontSize) * 1.3 * 2.2, pOver: p.scrollWidth > p.clientWidth + 1, n: btns.length, small: btns.filter((x) => x.h < 44 || x.w < 40).length, wrapped: btns.filter((x) => x.wrap).length }; })()");
      const tag = `${w}x${h}${dark ? 'd' : 'l'}${ts !== 1 ? 'T' : ''}`;
      assert(got, `prompt did not show at ${tag}`);
      assert(got.n === 6 && got.small === 0 && got.wrapped === 0, `buttons ${JSON.stringify(got)} at ${tag}`);
      assert(!got.pWrap && !got.pOver, `question wraps at ${tag}: ${JSON.stringify(got)}`);
      assert(got.left >= 0 && got.right <= got.vw + 1 && Math.abs(got.bottom - got.vh) <= 1, `prompt off-screen at ${tag}: ${JSON.stringify(got)}`);
    }
  });
  test('layout: onboarding buttons never overlap each other or the content on short screens (every step, 44px targets)', async () => {
    if (skipReason()) { console.log('      (skipped: ' + skipReason() + ')'); return; }
    browser = browser || await launch();
    const probe = `(() => {
      const bar = document.querySelector('.onboard .sticky-actions'); if (!bar) return null;
      const bs = [...bar.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
      const hit = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
      let btnOverlap = 0; for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (hit(bs[i], bs[j])) btnOverlap++;
      window.scrollTo({ top: 1e6, behavior: 'instant' });
      const br = bar.getBoundingClientRect();
      const content = [...document.querySelectorAll('.onboard form input, .onboard form select, .onboard form label, .onboard form .chip, .onboard form p, .onboard form h2')].filter((e) => !bar.contains(e) && e.offsetParent && e.getBoundingClientRect().height > 0);
      const covered = content.filter((e) => hit(e.getBoundingClientRect(), br)).map((e) => e.tagName + '.' + e.className).slice(0, 3);
      return { n: bs.length, small: bs.filter((q) => q.height < 43.5 || q.width < 43.5).length, btnOverlap, covered, off: bs.filter((q) => q.left < 0 || q.right > innerWidth + 0.5 || q.bottom > innerHeight + 0.5).length };
    })()`;
    for (const [w, h, dark] of [[320, 568, true], [375, 667, true], [375, 667, false], [390, 844, true], [466, 678, true], [678, 466, true], [844, 390, true], [626, 890, false], [890, 626, true]]) {
      await browser.viewport(w, h, dark);
      await browser.open('profile', seed());
      for (let step = 0; step < 4; step++) {
        const got = await browser.eval(probe);
        const tag = `${w}x${h}${dark ? 'd' : 'l'} step ${step + 1}`;
        assert(got && got.n >= 1, `onboarding actions missing at ${tag}`);
        assert(got.small === 0 && got.btnOverlap === 0 && got.off === 0 && got.covered.length === 0, `onboarding buttons at ${tag}: ${JSON.stringify(got)}`);
        if (step < 3) { await browser.eval("window.scrollTo({ top: 0, behavior: 'instant' }); document.querySelector('.onboard button[type=submit]').click()"); await new Promise((r) => setTimeout(r, 400)); }
      }
    }
  });
  test('layout: History Reps left row fits at 320 and 390, normal and large text, every button 44px', async () => {
    if (skipReason()) { console.log('      (skipped: ' + skipReason() + ')'); return; }
    browser = browser || await launch();
    for (const [w, h] of [[320, 568], [390, 844]]) for (const ts of [1, 1.35]) {
      await browser.viewport(w, h, true);
      await browser.open('history', seed());
      await browser.eval("(() => { const r = document.querySelector('li[data-w]') || document.querySelector('li.tap[data-w]'); if (r) r.click(); })()");
      await new Promise((r) => setTimeout(r, 600));
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
      const got = await browser.eval("(() => { const row = document.querySelector('.effort-row'); if (!row) return null; const bs = [...row.querySelectorAll('button')].map((b) => b.getBoundingClientRect()); return { n: bs.length, small: bs.filter((q) => q.height < 43.5 || q.width < 43.5).length, right: Math.max(...bs.map((q) => q.right)), left: Math.min(...bs.map((q) => q.left)), vw: innerWidth }; })()");
      assert(got, `Reps left row missing at ${w} ts${ts}`);
      assert(got.n === 5 && got.small === 0 && got.right <= got.vw - 8 && got.left >= 0, `Reps left row at ${w} ts${ts}: ${JSON.stringify(got)}`);
    }
  });
  test('layout: Rate every set on: the six In the tank buttons sit fully visible above Done set, never under it', async () => {
    if (skipReason()) { console.log('      (skipped: ' + skipReason() + ')'); return; }
    browser = browser || await launch();
    for (const [w, h, ts] of [[375, 667, 1], [390, 844, 1], [466, 678, 1], [626, 890, 1], [390, 844, 1.35], [320, 568, 1]]) {
      await browser.viewport(w, h, true);
      await browser.open('play', seed({ active: true }), "localStorage.setItem('forge.rateSets', '1');");
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
      const got = await browser.eval("(() => { const bs = [...document.querySelectorAll('.pl-rir button')].map((b) => b.getBoundingClientRect()); const d = document.querySelector('.pl-done'); if (!d) return null; const dr = d.getBoundingClientRect(); return { n: bs.length, small: bs.filter((q) => q.height < 43.5 || q.width < 43.5).length, hidden: bs.filter((q) => q.top < 0 || q.bottom > innerHeight + 0.5 || q.left < 0 || q.right > innerWidth + 0.5).length, overlap: bs.filter((q) => q.bottom > dr.top + 0.5 && q.top < dr.bottom - 0.5).length, doneBottom: dr.bottom, vh: innerHeight }; })()");
      const tag = `${w}x${h}${ts !== 1 ? 'T' : ''}`;
      assert(got && got.n === 6, `rating row missing at ${tag}: ${JSON.stringify(got)}`);
      assert(got.small === 0 && got.hidden === 0 && got.overlap === 0 && got.doneBottom <= got.vh + 0.5, `rating row at ${tag}: ${JSON.stringify(got)}`);
    }
  });
  test('layout: player set list: Add set is always in view above the dock; short screens show every set as a one-row chip', async () => {
    if (skipReason()) { console.log('      (skipped: ' + skipReason() + ')'); return; }
    browser = browser || await launch();
    const probe = "(() => { const a = document.querySelector('[data-addset]'), d = document.querySelector('.pl-dock'); if (!a || !d) return null; const r = a.getBoundingClientRect(), dr = d.getBoundingClientRect(); const rows = [...document.querySelectorAll('[data-setrow]')].map((e) => { const q = e.getBoundingClientRect(); return { t: Math.round(q.top), l: q.left, r: q.right, h: q.height, w: q.width }; }); return { add: { t: r.top, b: r.bottom, l: r.left, r: r.right, h: r.height }, dockTop: dr.top, rows, vw: innerWidth, vh: innerHeight, lines: [...document.querySelectorAll('.pl-set')].filter((e) => e.getBoundingClientRect().height > 60).length }; })()";
    for (const [w, h] of [[390, 844], [375, 667], [626, 890]]) {
      await browser.viewport(w, h, true);
      await browser.open('play', seed({ active: true }));
      const g = await browser.eval(probe);
      const at = `${w}x${h}`;
      assert(g && g.rows.length >= 2, `set rows missing at ${at}`);
      assert(g.add.t >= 0 && g.add.b <= g.vh + 0.5 && g.add.l >= 0 && g.add.r <= g.vw + 0.5, `Add set is outside the viewport at ${at}: ${JSON.stringify(g.add)}`);
      assert(g.add.b <= g.dockTop + 0.5, `Add set sits under the Done set bar at ${at}: ${Math.round(g.add.b)} > ${Math.round(g.dockTop)}`);
    }
    for (const [w, h] of [[678, 466], [932, 430], [844, 390]]) {
      await browser.viewport(w, h, true);
      await browser.open('play', seed({ active: true }));
      const g = await browser.eval(probe);
      const at = `${w}x${h}`;
      assert(g && g.rows.length >= 2, `set rows missing at ${at}`);
      assert(g.lines === 0, `a set chip wraps at ${at}`);
      assert(new Set(g.rows.map((x) => x.t)).size === 1, `the set chips are not in one row at ${at}: ${JSON.stringify(g.rows)}`);
      assert(g.rows.every((x) => x.w > 0 && x.l >= 0 && x.r <= g.vw + 0.5 && x.h >= 43.5), `a set chip is hidden or too small at ${at}: ${JSON.stringify(g.rows)}`);
    }
  });
  // Rest timer per exercise (v0.16.65): the chip in its longest saved state on a warm-up set of a superset (Superset tag,
  // Warm-up tag and chip share one row), and the picker sheet with the switch on and off.
  const RP_SIZES = [[390, 844, true, 1], [390, 844, false, 1], [320, 568, true, 1.6], [678, 466, true, 1], [626, 890, true, 1], [932, 430, true, 1]];
  for (const [w, h, dark, ts] of !only || only.includes('rest') || only.includes('play') ? RP_SIZES : []) {
    const tag = `${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? '-text160' : ''}`;
    test(`layout: rest timer chip and picker fit at ${tag}`, async () => {
      if (skipReason()) { console.log('      (skipped: ' + skipReason() + ')'); return; }
      browser = browser || await launch();
      await browser.viewport(w, h, dark);
      const data = seed({ active: true });
      const act = data.workouts.find((x) => x.status === 'active');
      act.exercises[0].superset = 'A'; act.exercises[1].superset = 'A';
      act.exercises[0].sets.unshift({ ...act.exercises[0].sets[0], warmup: true });
      data.settings[0].rest_prefs = { db_bench_press: { on: true, warm: 30, work: 90 } };
      await browser.open('play', data);
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const chip = await browser.eval(`(() => {
        const c = document.querySelector('[data-rest-chip]'); if (!c) return null;
        const r = c.getBoundingClientRect(), row = c.parentElement.getBoundingClientRect(), s = c.querySelector('span');
        const lh = parseFloat(getComputedStyle(s).lineHeight) || parseFloat(getComputedStyle(s).fontSize) * 1.3;
        const tags = [...c.parentElement.querySelectorAll('.tag')].map((t) => { const q = t.getBoundingClientRect(); return { text: t.textContent, l: q.left, r: q.right, t: q.top, b: q.bottom }; });
        return { text: s.textContent, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom, lines: Math.round(s.getBoundingClientRect().height / lh), font: getComputedStyle(c).fontWeight, size: parseFloat(getComputedStyle(c).fontSize), tags, rowH: row.height, vw: innerWidth, vh: innerHeight };
      })()`);
      if (shots) await browser.screenshot(`${shots}/rest-chip-${tag}.png`);
      assert(chip, 'the Rest timer chip is missing');
      assert(chip.text === 'Rest 0:30 · 1:30', `chip reads "${chip.text}"`);
      assert(chip.tags.length === 2 && chip.tags.every((t) => t.l >= 0 && t.r <= chip.vw + 0.5 && t.b - t.t < 40 && (t.r <= chip.l + 0.5 || t.b <= chip.t + 0.5)), `the Superset and Warm-up tags are pushed off, squeezed or overlapped by the chip: ${JSON.stringify(chip.tags)}`);
      assert(chip.h >= 43.5, `chip is ${chip.h}px tall`);
      assert(chip.lines === 1, `chip text wraps to ${chip.lines} lines`);
      assert(chip.l >= 0 && chip.r <= chip.vw + 0.5 && chip.t >= 0 && chip.b <= chip.vh, `chip is outside the viewport: ${JSON.stringify(chip)}`);
      assert(chip.font === '700' && chip.size >= 12, `chip font is ${chip.font} at ${chip.size}px (the font shorthand was dropped?)`);

      for (const on of [true, false]) {
        await browser.eval('document.querySelector("[data-rest-chip]").click()');
        await wait(900);
        if (!on) { await browser.eval('(() => { const s = document.querySelector("dialog.sheet[open] [data-on]"); s.checked = false; s.dispatchEvent(new Event("change")); })()'); await wait(300); }
        const sh = await browser.eval(`(() => {
          const d = document.querySelector('dialog.sheet[open]'); if (!d) return null;
          const b = d.querySelector('.sheet-body'), save = d.querySelector('[data-save]').getBoundingClientRect(), dr = d.getBoundingClientRect();
          const wheels = [...d.querySelectorAll('.rest-wheel')].map((e) => {
            const q = e.getBoundingClientRect(), sel = e.querySelector('li[data-sel="true"]'), sr = sel && sel.getBoundingClientRect();
            return { vis: q.width > 0 && q.height > 0, in: q.left >= 0 && q.right <= innerWidth + 0.5 && q.top >= 0 && q.bottom <= innerHeight + 0.5, off: sr ? Math.abs((sr.top + sr.height / 2) - (q.top + q.height / 2)) : 999, band: (() => { const bx = e.parentElement, cs = getComputedStyle(bx, '::before'), br = bx.getBoundingClientRect(); return Math.abs((parseFloat(cs.top) + parseFloat(cs.marginTop) + parseFloat(cs.height) / 2) - br.height / 2); })(), sel: sel ? sel.textContent : null };
          });
          return { wheels, sheetScroll: b.scrollHeight - b.clientHeight, saveIn: save.bottom <= innerHeight + 0.5 && save.top >= 0 && save.right <= innerWidth + 0.5, saveH: save.height, top: dr.top, over: d.scrollWidth > d.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1 };
        })()`);
        if (shots) await browser.screenshot(`${shots}/rest-picker-${on ? 'on' : 'off'}-${tag}.png`);
        const at = `switch ${on ? 'on' : 'off'}`;
        assert(sh, `${at}: the picker did not open`);
        assert(!sh.over, `${at}: the picker overflows sideways`);
        assert(sh.saveIn && sh.saveH >= 43.5, `${at}: Save is cut off or small (${JSON.stringify(sh)})`);
        assert(sh.sheetScroll <= 1, `${at}: the sheet has to scroll by ${sh.sheetScroll}px`);
        if (on) {
          assert(sh.wheels.length === 2 && sh.wheels.every((x) => x.vis && x.in), `${at}: a wheel is hidden or off screen: ${JSON.stringify(sh.wheels)}`);
          assert(sh.wheels[0].sel === '0:30' && sh.wheels[1].sel === '1:30', `${at}: wheels start at ${sh.wheels.map((x) => x.sel)}`);
          assert(sh.wheels.every((x) => x.off <= 2 && x.band <= 1), `${at}: the selected row is off the highlight band: ${JSON.stringify(sh.wheels)}`);
        } else {
          assert(sh.wheels.every((x) => !x.vis), `${at}: the wheels still show with the switch off`);
        }
        await browser.eval('document.querySelector("dialog.sheet[open] [data-close]").click()');
        await wait(700);
      }
    });
  }
  // History + Replace chips (v0.16.66): both are big tap targets that stay on screen, and the History sheet fits.
  for (const [w, h, dark, ts] of !only || only.includes('play') ? RP_SIZES : []) {
    const tag = `${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? '-text160' : ''}`;
    test(`layout: history and replace chips fit at ${tag}`, async () => {
      if (skipReason()) { console.log('      (skipped: ' + skipReason() + ')'); return; }
      browser = browser || await launch();
      await browser.viewport(w, h, dark);
      await browser.open('play', seed({ active: true }));
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
      const chips = await browser.eval(`(() => {
        const hit = (c) => { const q = getComputedStyle(c, '::before'); return parseFloat(q.height) || 0; };
        const box = (e) => { const q = e.getBoundingClientRect(); return { l: q.left, r: q.right, t: q.top, b: q.bottom }; };
        const others = ['.pl-name', '.pl-setlabel', '[data-hero]'].map((s) => ({ s, ...box(document.querySelector(s)) }));
        const reach = ['[data-r="1"]', '[data-r="-1"]'].map((s) => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: 'center' }); const q = box(e); const at = document.elementFromPoint((q.l + q.r) / 2, (q.t + q.b) / 2); return { s, ok: q.b <= innerHeight + 0.5 && (at === e || e.contains(at)) }; });
        window.scrollTo(0, 0); document.querySelectorAll('*').forEach((n) => { if (n.scrollTop) n.scrollTop = 0; });
        return ['[data-hist-chip]', '[data-replace-chip]'].map((s) => { const c = document.querySelector(s); if (!c) return null; const r = c.getBoundingClientRect(); return { h: r.height, hit: hit(c), l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight, lines: c.querySelector('span').getClientRects().length, hits: others.filter((o) => r.left < o.r && r.right > o.l && r.top < o.b && r.bottom > o.t).map((o) => o.s), reach }; });
      })()`);
      if (shots) await browser.screenshot(`${shots}/history-chips-${tag}.png`);
      assert(chips.every(Boolean), 'the History or Replace chip is missing');
      assert(chips.every((c) => c.hit >= 43.5 && c.l >= 0 && c.r <= c.vw + 0.5 && c.lines === 1), `a chip's tap area is small, off screen or wraps: ${JSON.stringify(chips)}`);
      assert(chips.every((c) => c.hits.length === 0), `a chip overlaps ${JSON.stringify(chips.map((c) => c.hits))}`);
      assert(chips[0].reach.every((x) => x && x.ok), `a stepper is covered or below the screen: ${JSON.stringify(chips[0].reach)}`);
      await browser.eval('document.querySelector("[data-hist-chip]").click()');
      await new Promise((r) => setTimeout(r, 900));
      const sh = await browser.eval(`(() => {
        const d = document.querySelector('dialog.sheet[open]'); if (!d) return null;
        const top = d.querySelector('.hx-top'), date = top && top.querySelector('b').getBoundingClientRect(), best = top && top.querySelector('.hx-best').getBoundingClientRect();
        const sum = d.querySelector('[data-hx-sum]');
        return { text: d.innerText.length > 0, over: d.scrollWidth > d.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1, line: !!d.querySelector('.hx-line'), sum: sum ? sum.textContent : '', sameRow: !!top && Math.abs((date.top + date.bottom) / 2 - (best.top + best.bottom) / 2) < 12 };
      })()`);
      if (shots) await browser.screenshot(`${shots}/history-sheet-${tag}.png`);
      assert(sh && sh.text && !sh.over, `the History sheet did not open or overflows sideways: ${JSON.stringify(sh)}`);
      assert(sh.line && /^Best estimated max .* up .* since /.test(sh.sum), `the History trend line or summary is missing: ${JSON.stringify(sh)}`);
      assert(sh.sameRow, 'the date and Best are not on one row');
    });
  }
  // Recommend more / less (v0.16.72): the control on the workout summary, and the Settings list that shows and resets it.
  const PREF_SIZES = [[390, 844, true, 1], [390, 844, false, 1], [320, 568, true, 1.6], [466, 678, true, 1], [678, 466, true, 1], [626, 890, false, 1], [890, 626, true, 1]];
  for (const [w, h, dark, ts] of !only || only.includes('prefs') || only.includes('summary') || only.includes('settings') ? PREF_SIZES : []) {
    const tag = `${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? '-text160' : ''}`;
    test(`layout: Recommend more / less on the summary and in Settings fit at ${tag}`, async () => {
      if (skipReason()) { console.log('      (skipped: ' + skipReason() + ')'); return; }
      browser = browser || await launch();
      await browser.viewport(w, h, dark);
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const data = seed();
      data.settings[0].exercise_prefs = { pushup: 'less', db_bench_press: 'more' };
      const wid = data.workouts.find((x) => x.status === 'done').id;
      await browser.open(`summary/${wid}`, data);
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await wait(300); }
      await wait(600);
      const sum = await browser.eval(`(() => {
        const groups = [...document.querySelectorAll('.sum-list .xpref')];
        const bad = [];
        if (groups[0]) groups[0].scrollIntoView({ block: 'center' });
        const gr = groups[0] && groups[0].getBoundingClientRect();
        if (gr && (gr.top < 0 || gr.bottom > innerHeight + 0.5)) bad.push('first control not in view ' + Math.round(gr.top) + '-' + Math.round(gr.bottom));
        for (const g of groups) for (const b of g.querySelectorAll('.xpref-b')) {
          const r = b.getBoundingClientRect();
          if (r.height < 43.5) bad.push('small ' + r.height);
          if (r.left < 0 || r.right > innerWidth + 0.5) bad.push('off screen ' + Math.round(r.left) + '-' + Math.round(r.right));
          if (!b.getAttribute('aria-pressed')) bad.push('no aria-pressed');
        }
        for (const li of document.querySelectorAll('.sum-list li')) {
          const lr = li.getBoundingClientRect();
          if (li.scrollWidth > li.clientWidth + 0.5) bad.push('row overflows ' + li.scrollWidth + '>' + li.clientWidth);
          for (const el of li.querySelectorAll('.vs, .xpref-b')) {
            const r = el.getBoundingClientRect();
            if (r.left < lr.left - 0.5 || r.right > lr.right + 0.5) bad.push(el.className + ' outside its row ' + Math.round(r.left) + '-' + Math.round(r.right) + ' vs ' + Math.round(lr.left) + '-' + Math.round(lr.right));
          }
          const vs = li.querySelector('.vs');
          if (vs && vs.scrollWidth > vs.clientWidth + 0.5) bad.push('badge text clipped');
        }
        return { n: groups.length, bad, over: document.documentElement.scrollWidth > innerWidth + 1 };
      })()`);
      await wait(200);
      if (shots) await browser.screenshot(`${shots}/pref-summary-${tag}.png`);
      assert(sum.n > 0, 'the summary has no Recommend more / less controls');
      assert(sum.bad.length === 0 && !sum.over, `the Recommend control is small, clipped or overflows: ${JSON.stringify(sum)}`);
      // The first exercise starts on More. Less replaces it (they are exclusive), Less again clears it, More sets it again.
      const state = await browser.eval(`(() => {
        const g = document.querySelector('.sum-list .xpref'); const p = () => [...g.querySelectorAll('[data-pref]')].map((b) => b.getAttribute('aria-pressed')).join();
        const out = [p()];
        g.querySelector('[data-pref="less"]').click(); out.push(p());
        g.querySelector('[data-pref="less"]').click(); out.push(p());
        g.querySelector('[data-pref="more"]').click(); out.push(p());
        return out;
      })()`);
      eq(state[0], 'true,false', 'starts on More');
      eq(state[1], 'false,true', 'Less replaces More');
      eq(state[2], 'false,false', 'tapping Less again clears it');
      eq(state[3], 'true,false', 'More again');

      await browser.open('settings', data);
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await wait(300); }
      await wait(400);
      const row = await browser.eval(`(() => { const b = document.querySelector('[data-exercise-prefs]'); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { h: r.height, sub: document.querySelector('[data-exercise-prefs-sub]').textContent }; })()`);
      assert(row && row.h >= 43.5 && /1 more · 1 less/.test(row.sub), `the Settings row is missing or wrong: ${JSON.stringify(row)}`);
      await browser.eval('document.querySelector("[data-exercise-prefs]").click()');
      await wait(900);
      const sh = await browser.eval(`(() => {
        const d = document.querySelector('dialog.sheet[open]'); if (!d) return null;
        const resets = [...d.querySelectorAll('[data-reset]')].map((b) => { const r = b.getBoundingClientRect(); return { h: r.height, in: r.right <= innerWidth + 0.5 && r.left >= 0 }; });
        const names = [...d.querySelectorAll('.xpref-list li > div')].map((n) => {
          const b = n.querySelector('b'); const range = document.createRange(); range.selectNodeContents(b);
          const word = Math.max(...b.textContent.split(/\\s+/).map((t) => { const c = document.createElement('span'); c.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:' + getComputedStyle(b).font; c.textContent = t; document.body.appendChild(c); const w = c.getBoundingClientRect().width; c.remove(); return w; }));
          return { w: n.getBoundingClientRect().width, word, lines: b.getClientRects().length };
        });
        return { rows: d.querySelectorAll('.xpref-list li').length, names, resets, over: d.scrollWidth > d.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1, all: !!d.querySelector('[data-reset-all]') };
      })()`);
      if (shots) await browser.screenshot(`${shots}/pref-settings-${tag}.png`);
      assert(sh && sh.rows === 2 && sh.all && !sh.over, `the preferences sheet is wrong: ${JSON.stringify(sh)}`);
      assert(sh.resets.every((r) => r.h >= 43.5 && r.in), `a Reset button is small or off screen: ${JSON.stringify(sh.resets)}`);
      assert(sh.names.every((n) => n.w + 0.5 >= n.word), `an exercise name is narrower than its longest word (would break mid-word): ${JSON.stringify(sh.names)}`);
      await browser.eval('document.querySelector("dialog.sheet[open] [data-reset]").click()');
      await wait(300);
      const left = await browser.eval('document.querySelectorAll("dialog.sheet[open] .xpref-list li").length');
      eq(left, 1, 'Reset removes one preference');
    });
  }
  for (const [w, h, dark, ts] of !only || only.includes('prefs') || only.includes('history') ? PREF_SIZES.slice(0, 5) : []) {
    const tag = `${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? '-text160' : ''}`;
    for (const done of [true, false]) {
      test(`layout: Recommend more / less in the History sheet (${done ? 'has history' : 'not done yet'}) fits at ${tag}`, async () => {
        if (skipReason()) { console.log('      (skipped: ' + skipReason() + ')'); return; }
        browser = browser || await launch();
        await browser.viewport(w, h, dark);
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const data = seed({ active: true });
        if (!done) data.workouts = data.workouts.filter((x) => x.status !== 'done');
        await browser.open('play', data);
        if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await wait(300); }
        await wait(400);
        assert(await browser.eval('!!document.querySelector("[data-hist-chip]")'), 'no History chip on the player');
        await browser.eval('document.querySelector("[data-hist-chip]").click()');
        await wait(900);
        const sh = await browser.eval(`(() => {
          const d = document.querySelector('dialog.sheet[open]'); if (!d) return null;
          const g = d.querySelector('.xpref'); if (!g) return { noControl: true };
          g.scrollIntoView({ block: 'nearest' });
          const gr = g.getBoundingClientRect(), chart = d.querySelector('.hx-chart'), cr = chart && chart.getBoundingClientRect();
          const btns = [...g.querySelectorAll('.xpref-b')].map((b) => { const r = b.getBoundingClientRect(); return { h: r.height, ok: r.left >= 0 && r.right <= innerWidth + 0.5 }; });
          return { hasChart: !!chart, btns, inView: gr.top >= 0 && gr.bottom <= innerHeight + 0.5, overlap: !!cr && gr.bottom > cr.top + 0.5 && gr.top < cr.bottom - 0.5, over: d.scrollWidth > d.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1, chart: !!chart };
        })()`);
        if (shots) await browser.screenshot(`${shots}/pref-history-${done ? 'done' : 'new'}-${tag}.png`);
        assert(sh && !sh.noControl, `the History sheet has no Recommend control: ${JSON.stringify(sh)}`);
        assert(sh.btns.length === 2 && sh.btns.every((b) => b.h >= 43.5 && b.ok), `History chips small or off screen: ${JSON.stringify(sh.btns)}`);
        assert(sh.hasChart === done, `History chart ${sh.hasChart} but has-history is ${done}`);
        assert(sh.inView && !sh.over && !sh.overlap, `History control hidden, overflowing or overlapping the chart: ${JSON.stringify(sh)}`);
      });
    }
  }
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
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (sel) => browser.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const openBuilder = async (w, h, ts, dark = true) => {
    await browser.viewport(w, h, dark);
    await browser.open('food', seed());
    if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await wait(300); }
    await click('[data-log-food]');
    await wait(700);
  };
  const enterChipotle = async () => { await click('[data-restaurant]'); await wait(900); await click('[data-chain="chipotle"]'); await wait(900); };
  const inView = `(r) => r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5`;

  test('layout: Restaurant builder: rows and the + never move when you add items, nothing clips, Add stays on screen', async () => {
    if (skipReason()) { console.log('      (skipped: ' + skipReason() + ')'); return; }
    browser = browser || await launch();
    for (const [w, h, ts] of [[320, 568, 1], [390, 844, 1], [390, 844, 1.35], [466, 678, 1], [626, 890, 1], [890, 626, 1]]) {
      const tag = `${w}x${h}${ts !== 1 ? 'T' : ''}`;
      await openBuilder(w, h, ts);
      // Log food: Restaurant and Quick add share a row, each on one line
      const alt = await browser.eval("[...document.querySelectorAll('.food-alt > .btn')].map((b) => ({ h: b.getBoundingClientRect().height, lines: Math.round(b.getBoundingClientRect().height / parseFloat(getComputedStyle(b).lineHeight || 20)) }))");
      assert(alt.length === 2 && alt.every((b) => b.h < 64 * Math.max(1, ts)), `Restaurant / Quick add buttons wrap at ${tag}: ${JSON.stringify(alt)}`);
      if (shots) await browser.screenshot(`${shots}/restaurant-log-${tag}.png`);
      await enterChipotle();
      const rects = () => browser.eval("[...document.querySelectorAll('[data-item]')].map((li) => { const r = li.getBoundingClientRect(), p = li.querySelector('[data-plus]').getBoundingClientRect(); return { id: li.dataset.item, h: r.height, top: li.offsetTop, plusX: p.x, plusW: p.width }; })");
      const before = await rects();
      assert(before.length >= 20, `builder did not open at ${tag}`);
      for (const id of ['tortilla', 'pollo', 'white-rice', 'black-beans', 'cheese']) { await browser.eval(`document.querySelector('[data-item="${id}"] [data-plus]').click()`); await wait(120); }
      await browser.eval("document.querySelector('[data-item=\"pollo\"] [data-plus]').click()"); // 1 → 1½ in a half group
      await browser.eval("document.querySelector('[data-item=\"white-rice\"] [data-minus]').click()"); // 1 → ½
      await wait(500);
      const after = await rects();
      const moved = after.filter((a, i) => Math.abs(a.h - before[i].h) > 0.5 || Math.abs(a.plusX - before[i].plusX) > 0.5 || Math.abs(a.top - before[i].top) > 0.5 || a.plusW < 43.5);
      assert(!moved.length, `rows moved or shrank after adding items at ${tag}: ${JSON.stringify(moved.slice(0, 3))} (before ${JSON.stringify(before.find((b) => b.id === moved[0]?.id))})`);
      assert(after.every((a) => a.h < 104 * Math.max(1, ts)), `a row grew tall at ${tag}: ${Math.max(...after.map((a) => a.h))}px`);
      const kcal = await browser.eval("document.querySelector('[data-tick=rest-kcal]').textContent");
      assert(kcal === '935',`tally shows "${kcal}" at ${tag}`);
      const behind = (v) => browser.eval(`["main", "nav", "navbar"].forEach((id) => { const e = document.getElementById(id); if (e) e.style.visibility = "${v}"; })`);
      await behind("hidden");
      const probs = (await browser.eval(`(${detect})(${JSON.stringify({ largeText: ts !== 1 })})`)).filter((p) => !/overlap.*(Add ·|Log to)/.test(p)); // rows scrolling under the sticky dock are not an overlap
      await behind("");
      assert(!probs.length, `builder problems at ${tag}: ${probs.join(' | ')}`);
      const add = await browser.eval(`(${inView})(document.querySelector('[data-add]').getBoundingClientRect())`);
      assert(add, `Add button is not fully on screen at ${tag}`);
      if (shots) await browser.screenshot(`${shots}/restaurant-builder-${tag}.png`);
      // Step 2: the meal choice, name and Favorite are on the same screen as the Log button
      await click('[data-add]');
      await wait(500);
      const conf = await browser.eval(`(() => { const ok = ${inView}; const dlg = document.querySelector('dialog.sheet[open]'); const chips = [...dlg.querySelectorAll('[data-meal]')]; const log = dlg.querySelector('[data-log]'); return { chips: chips.length, chipsIn: chips.every((c) => ok(c.getBoundingClientRect())), small: chips.filter((c) => c.getBoundingClientRect().height < 43.5).length, logIn: !!log && ok(log.getBoundingClientRect()), name: !!document.querySelector('[name=oname]'), fav: !!document.querySelector('[name=fav]'), text: log ? log.textContent : '' }; })()`);
      assert(conf.chips === 4 && conf.chipsIn && conf.small === 0 && conf.logIn && conf.name && conf.fav, `confirm step at ${tag}: ${JSON.stringify(conf)}`);
      await behind("hidden");
      const probs2 = await browser.eval(`(${detect})(${JSON.stringify({ largeText: ts !== 1 })})`);
      await behind("");
      assert(!probs2.length, `confirm problems at ${tag}: ${probs2.join(' | ')}`);
      if (shots) await browser.screenshot(`${shots}/restaurant-confirm-${tag}.png`);
    }
  });

  test('layout: Restaurant builder: one tap on each of the 8 example items reads 1,085 in the tally and on Add; ½ is a second choice', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await openBuilder(390, 844, 1);
    await enterChipotle();
    for (const id of ['tortilla', 'pollo', 'brown-rice', 'pinto-beans', 'cheese', 'cilantro-lime', 'tomato-salsa', 'red-salsa']) { await browser.eval(`document.querySelector('[data-item="${id}"] [data-plus]').click()`); await wait(60); }
    await wait(400);
    const got = await browser.eval("({ tally: document.querySelector('[data-tick=rest-kcal]').textContent, add: document.querySelector('[data-add]').textContent, qty: document.querySelector('[data-item=\"pollo\"] [data-qty]').textContent })");
    assert(got.tally === '1,085' && got.add.includes('1,085'), `after one tap each: ${JSON.stringify(got)}`);
    assert(got.qty === '1', `first tap is a full portion, got "${got.qty}"`);
    await browser.eval("document.querySelector('[data-item=\"pollo\"] [data-minus]').click()");
    await wait(300);
    assert((await browser.eval("document.querySelector('[data-item=\"pollo\"] [data-qty]').textContent")) === 'Half', '− from 1 gives Half');
  });

  test('layout: wide screens claim their width on the first paint: no layout shift at Duo and sideways-iPhone sizes', async () => {
    if (skipReason()) { console.log('      (skipped: ' + skipReason() + ')'); return; }
    browser = browser || await launch();
    const bad = [];
    for (const [w, h] of [[844, 390], [874, 402], [890, 626], [932, 430]]) for (const route of ['play', 'today', 'train', 'body']) {
      await browser.viewport(w, h, true);
      await browser.open(route, seed({ active: route === 'play' }));
      const cls = await browser.eval('window.__cls || 0');
      if (cls > 0.02) bad.push(`${route} ${cls.toFixed(3)} @${w}x${h}`);
    }
    assert(!bad.length, `layout shift on first render: ${bad.join(', ')}`);
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
  test('layout: Ask Forge: the Food and Today buttons, the sheet and its answer fit at every size, with big tap targets', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const found = new Map();
    const note = (msg, at) => found.set(msg, [...(found.get(msg) || []), at]);
    for (const c of SIZES.concat(WIDE).map(([w, h]) => ({ w, h, dark: true })).concat([{ w: 375, h: 667, dark: false }])) {
      await browser.viewport(c.w, c.h, c.dark);
      const at = `${c.w}x${c.h}${c.dark ? 'd' : 'l'}`;
      for (const route of ['today', 'food']) {
        await browser.open(route, seed());
        const h = await browser.eval("(() => { const b = document.querySelector('[data-ask-forge]'); return b ? b.getBoundingClientRect().height : 0; })()");
        if (h < 44) note(`${route}: Ask Forge button is ${Math.round(h)}px tall`, at);
        if (shots) await browser.screenshot(`${shots}/ask-${route}-${c.w}x${c.h}-${c.dark ? 'dark' : 'light'}.png`);
      }
      await browser.eval("document.querySelector('[data-ask-forge]').click()");
      await wait(450);
      await browser.eval("(() => { const f = document.querySelector('dialog.sheet form.ask-form'); f.q.value = 'Is a bowl of oatmeal okay?'; f.requestSubmit(); })()");
      await wait(900);
      const behind = (v) => browser.eval(`['main', 'nav', 'navbar'].forEach((id) => { const e = document.getElementById(id); if (e) e.style.visibility = '${v}'; })`);
      await behind('hidden');
      const probs = await browser.eval(`(${detect})(${JSON.stringify({ largeText: false })})`);
      await behind('');
      for (const pr of probs) note(`sheet: ${pr}`, at);
      const r = await browser.eval(`(() => { const d = document.querySelector('dialog.sheet'); const a = d && d.querySelector('[data-ask-answer]'); const bs = a ? [...a.querySelectorAll('[data-log]')].map((b) => b.getBoundingClientRect().height) : []; return { open: !!d, answer: !!a, buttons: bs, wide: d ? d.scrollWidth > d.clientWidth + 1 : false }; })()`);
      if (!r.open || !r.answer) note('no answer card', at);
      if (r.buttons.length !== 2 || r.buttons.some((x) => x < 44)) note(`Log buttons: ${JSON.stringify(r.buttons)}`, at);
      if (r.wide) note('sheet scrolls sideways', at);
      if (shots) await browser.screenshot(`${shots}/ask-sheet-${c.w}x${c.h}-${c.dark ? 'dark' : 'light'}.png`);
    }
    assert(found.size === 0, `Ask Forge layout: ${[...found].map(([m, w]) => `${m} @ ${w.join(',')}`).join(' | ')}`);
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
    const SHARDS = 6; // cost-balanced (see the bin-packing below); each test is also capped, so a hang is named
    const runs = Array.from({ length: SHARDS }, (_, i) => new Promise((resolve) => {
      const p = spawn(process.execPath, [new URL(import.meta.url).pathname, `--shard=${i + 1}/${SHARDS}`], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
      const timer = setTimeout(() => {
        p.kill('SIGKILL');
        const started = out.split('\n').filter((l) => l.includes('▶'));
        out += `\nshard ${i + 1} timed out after 14 min. Last test started: ${started.length ? started[started.length - 1].trim() : '(none)'}`;
      }, 840000); // under the 20 minute job cap in tests.yml (the sweep grew to ~9 min on slow runners)
      const t0 = Date.now();
      p.on('close', (status) => { clearTimeout(timer); console.log(`      shard ${i + 1}/${SHARDS} done in ${Math.round((Date.now() - t0) / 1000)}s`); resolve({ status, out }); });
    }));
    const results = await Promise.all(runs);
    const bad = results.filter((r) => r.status !== 0);
    assert(!bad.length, '\n' + bad.map((r) => r.out.split('\n').filter((l) => !l.includes('✓') && !(l.includes('▶') && !l.includes('Last test started'))).join('\n')).join('\n'));
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
        const lines = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); const c = [...rg.getClientRects()].filter((q) => q.width > 0).map((q) => [(q.top + q.bottom) / 2, q.height]).sort((x, y) => x[0] - y[0]); if (!c.length) return 0; const hh = Math.max(...c.map((q) => q[1])); return c.filter((q, i) => i === 0 || q[0] - c[i - 1][0] > hh * 0.6).length; };
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
        const lines = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); const c = [...rg.getClientRects()].filter((q) => q.width > 0).map((q) => [(q.top + q.bottom) / 2, q.height]).sort((x, y) => x[0] - y[0]); if (!c.length) return 0; const hh = Math.max(...c.map((q) => q[1])); return c.filter((q, i) => i === 0 || q[0] - c[i - 1][0] > hh * 0.6).length; };
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
      if (r.baseline && !(w <= 320 && ts !== 1)) add('stat values are not on one baseline'); // v0.16.86: at 320 with large text the third stat drops to a second row (the card is only 256px wide)
      if (r.wrapSwitch && !(w <= 320 && ts !== 1)) add('switch label wraps'); // v0.16.86: "Weekly training sets" wraps to two lines at 320 with large text (full words kept; row stays 44px)
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
        const slots = [...document.querySelectorAll('#main .slot')].map((e) => { const c = e.firstElementChild, q = c && c.getBoundingClientRect(); return { o: Number(e.dataset.o), coach: !!(c && c.matches('[data-coach-card]')), coachMin: c ? parseFloat(getComputedStyle(c).minHeight) : 0, col: e.parentElement.classList.contains('col-a') ? 'a' : e.parentElement.classList.contains('col-b') ? 'b' : '', t: q && q.height > 1 ? q.top + scrollY : null }; });
        const done = document.querySelector('#main [data-done-label]'), dq = done && done.getBoundingClientRect();
        const ch = document.querySelector('#main svg.chart'), cq = ch && ch.getBoundingClientRect(), card = ch && ch.closest('.card'), cdq = card && card.getBoundingClientRect();
        const ordered = [...document.querySelectorAll('#main *')].filter((e) => getComputedStyle(e).order !== '0').length;
        const axis = document.querySelector('#main svg.chart .axis'), ax = axis && parseFloat(getComputedStyle(axis).fontSize) * (cq.width / ch.viewBox.baseVal.width);
        const dm = document.querySelector('#main [data-demo]'), st = document.querySelector('#main .pl-steppers'), top = (e) => e ? e.getBoundingClientRect().top : null;
        const dom = a && b ? !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
        const h1 = document.querySelector('#main h1'), tabs = [...document.querySelectorAll('#nav a')].map((e) => e.getBoundingClientRect().height);
        const rows = [...document.querySelectorAll('#main .set-nav [data-pane]')], lastRow = rows.length ? rows[rows.length - 1].getBoundingClientRect() : null;
        return { h1: h1 && { fs: parseFloat(getComputedStyle(h1).fontSize), h: h1.getBoundingClientRect().height }, tabH: tabs, lastRowB: lastRow && lastRow.bottom, tabTop: document.getElementById('nav').getBoundingClientRect().top, scrollH: document.documentElement.scrollHeight, demoTop: top(dm), stepTop: top(st), dom: dom, ordered: ordered, doneBox: dq && { t: dq.top, b: dq.bottom }, chart: cq && { w: cq.width, ar: cq.width / cq.height, vb: ch.viewBox.baseVal.width / ch.viewBox.baseVal.height }, card: cdq && { w: cdq.width }, axisPx: ax, vh: innerHeight, slots: slots, trainCols: (() => { const q = (c) => { const e = document.querySelector('#main .train-cols > .col-' + c); if (!e) return null; const last = [...e.children].filter((k) => k.getBoundingClientRect().height > 1).pop(); return last ? last.getBoundingClientRect().bottom + scrollY : null; }; return { a: q('a'), b: q('b') }; })(), wrap: wrap, main: r(document.getElementById('main')), tab: r(document.getElementById('nav')), a: r(a), b: r(b), out: out.slice(0, 4), vw: innerWidth };
      })()`);
      if (route !== 'play' && (Math.abs(m.tab.l) > 1 || Math.abs(m.tab.r - m.vw) > 1)) bad.push(`${at}: tab bar ${Math.round(m.tab.l)}-${Math.round(m.tab.r)} is not full width (${m.vw})`);
      const cols = route === 'today' || route === 'train' || route === 'body' || route === 'food' || route === 'score' || route === 'play' || route === 'settings';
      if (!cols && route !== 'body' && m.main.r - m.main.l > 560 + 1) bad.push(`${at}: ${route} stretched to ${Math.round(m.main.r - m.main.l)}px, should stay a 560px column`);
      if (w === 390 && !inset) base = new Set(m.wrap);
      const fresh = m.wrap.filter((x) => !base.has(x));
      if (fresh.length) bad.push(`${at}: ${fresh.join(', ')}`);
      if (m.out.length) bad.push(`${at}: sits inside the inset: ${m.out.join(', ')}`);
      if (route === 'today' && m.slots.length) { // Ask Coach: first card, original size (same as main: a 48px one-line row), never enlarged
        const first = m.slots.find((x) => x.t != null);
        if (!first || !first.coach) bad.push(`${at}: Ask Coach is not the first card on Today`);
        else if (first.coachMin !== 48) bad.push(`${at}: Ask Coach min-height is ${first.coachMin}, should stay 48`);
        if (w >= 840 && first && first.col !== 'a') bad.push(`${at}: Ask Coach should sit at the top of the first column`);
      }
      if (route === 'train' && w >= 840 && m.trainCols.a != null && m.trainCols.b != null && Math.abs(m.trainCols.a - m.trainCols.b) > 400) bad.push(`${at}: Train columns end ${Math.round(m.trainCols.a)} and ${Math.round(m.trainCols.b)}, more than 400px apart`);
      if (route === 'today') { // reading order (VoiceOver, Tab) must match the screen: DOM order = visual order on a phone, and the right column per card on two columns
        const shown = m.slots.filter((x) => x.t != null);
        if (w < 840 && m.slots.map((x) => x.o).join() !== '1,2,3,4,5,6,7,8,9,10') bad.push(`${at}: Today's cards are not in phone order in the DOM: ${m.slots.map((x) => x.o)}`);
        if (w < 840) for (let i = 1; i < shown.length; i++) if (shown[i].t < shown[i - 1].t - 1) bad.push(`${at}: Today card ${shown[i].o} sits above card ${shown[i - 1].o} on screen but after it in the DOM`);
        if (w >= 840) for (const x of m.slots) if (x.col !== (x.o === 1 ? 'a' : 'b') && !([3, 4, 5, 6, 9, 10].includes(x.o) && x.col)) // 3, 4, 5, 6, 9 and 10 (rings, missions, food, weight, readiness, insights) go on the shorter side
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
      if (route === 'body' || route === 'play' || route === 'train') { // reading order is the screen order: left column first in the DOM, and no CSS order anywhere
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
        const lines = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); const c = [...rg.getClientRects()].filter((q) => q.width > 0).map((q) => [(q.top + q.bottom) / 2, q.height]).sort((x, y) => x[0] - y[0]); if (!c.length) return 0; const hh = Math.max(...c.map((q) => q[1])); return c.filter((q, i) => i === 0 || q[0] - c[i - 1][0] > hh * 0.6).length; };
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
      const lines = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); const c = [...rg.getClientRects()].filter((q) => q.width > 0).map((q) => [(q.top + q.bottom) / 2, q.height]).sort((x, y) => x[0] - y[0]); if (!c.length) return 0; const hh = Math.max(...c.map((q) => q[1])); return c.filter((q, i) => i === 0 || q[0] - c[i - 1][0] > hh * 0.6).length; };
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
      const lines = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); const c = [...rg.getClientRects()].filter((q) => q.width > 0).map((q) => [(q.top + q.bottom) / 2, q.height]).sort((x, y) => x[0] - y[0]); if (!c.length) return 0; const hh = Math.max(...c.map((q) => q[1])); return c.filter((q, i) => i === 0 || q[0] - c[i - 1][0] > hh * 0.6).length; };
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

if (standalone) {
  test('layout: Food Plan, recipe sheet and Food preferences: no wraps, clips or overflow at 320, 390 and both Duo sizes, light and dark, Large Text', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const found = new Map();
    const note = (msg, at) => found.set(msg, [...(found.get(msg) || []), at]);
    const sheetCheck = `(() => { const d = document.querySelector('dialog.sheet'); if (!d) return null; const b = d.querySelector('.sheet-body'); const r = d.getBoundingClientRect(); const bad = [...d.querySelectorAll('button, .chip span, .seg span, .btn')].filter((e) => e.offsetParent && (e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > innerWidth + 1)).map((e) => e.textContent.trim().slice(0, 24)); return { over: b.scrollWidth - b.clientWidth, right: r.right - innerWidth, bad }; })()`;
    for (const [w, h] of [[320, 568], [390, 844], [466, 678], [626, 890]]) {
      for (const dark of [true, false]) {
        for (const ts of [1, 1.35]) {
          const at = `${w}${dark ? 'd' : 'l'}${ts !== 1 ? 'T' : ''}`;
          await browser.viewport(w, h, dark);
          const prefsSeed = { diets: ['low_histamine', 'pregnancy_safe'], avoid: ['tomatoes', 'spicy foods'], leftovers: 'freeze', cooking: 'batch', snacks: 2 };
          const setLarge = async () => { if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await wait(300); } };
          // first run: the setup card shows and the days stay hidden
          await browser.open('food', seed({}));
          await setLarge();
          await browser.eval("document.querySelector('input[name=food-view][value=plan]').click()"); await wait(500);
          if (!(await browser.eval("!!document.querySelector('[data-plan] [data-setup] [data-prefs]') && !document.querySelector('[data-plan] .plan-meal')"))) note('setup card missing or days shown before setup', at);
          for (const p of await browser.eval(`(${detect})(${JSON.stringify({ largeText: ts !== 1 })})`)) note(`Plan setup: ${p}`, at);
          await browser.open('food', seed({ mealPrefs: prefsSeed }));
          await setLarge();
          await browser.eval("document.querySelector('input[name=food-view][value=plan]').click()"); await wait(500);
          if (!(await browser.eval("!!document.querySelector('[data-plan] .plan-meal [data-log]')"))) { note('Plan view did not draw', at); continue; }
          if (!(await browser.eval("document.querySelector('[data-plan-foot]')?.textContent.includes('Not medical advice')"))) note('plan footer missing', at);
          const behind = (v) => browser.eval(`["main", "nav", "navbar"].forEach((id) => { const e = document.getElementById(id); if (e) e.style.visibility = "${v}"; })`);
      await behind("hidden");
      const probs = (await browser.eval(`(${detect})(${JSON.stringify({ largeText: ts !== 1 })})`)).filter((p) => !/overlap.*(Add ·|Log to)/.test(p)); // rows scrolling under the sticky dock are not an overlap
      await behind("");
          for (const p of probs) note(`Plan: ${p}`, at);
          await browser.eval("document.querySelector('.plan-open').click()"); await wait(700);
          let r = await browser.eval(sheetCheck);
          if (!r) note('recipe sheet did not open', at);
          else { if (r.over > 1 || r.right > 1) note('recipe sheet overflows sideways', at); for (const b of r.bad) note(`recipe sheet clips "${b}"`, at); }
          await browser.eval("document.querySelector('dialog.sheet [data-close]').click()"); await wait(600);
          for (const [sel, name] of [['[data-prefs]', 'Food preferences'], ['[data-open-grocery]', 'Grocery list'], ['[data-open-prep]', 'Sunday prep']]) {
            if (!(await browser.eval(`!!document.querySelector('${sel}')`))) { if (sel !== '[data-open-prep]') note(`${name} row missing`, at); continue; }
            await browser.eval(`document.querySelector('${sel}').click()`); await wait(700);
            r = await browser.eval(sheetCheck);
            if (!r) note(`${name} did not open`, at);
            else { if (r.over > 1 || r.right > 1) note(`${name} overflows sideways`, at); for (const b of r.bad) note(`${name} clips "${b}"`, at); }
            await browser.eval("document.querySelector('dialog.sheet [data-close]').click()"); await wait(600);
          }
          await browser.eval("document.querySelectorAll('.plan-dayb')[6].click()"); await wait(300);
          for (const p of await browser.eval(`(${detect})(${JSON.stringify({ largeText: ts !== 1 })})`)) note(`Plan Sunday: ${p}`, at);
        }
      }
    }
    assert(found.size === 0, `\n        ${[...found].map(([p, at]) => `${p}  [${at.join(' ')}]`).join('\n        ')}`);
  });
}

// v0.16.41: the Why card needs plan notes and stalled lifts to show up, so give Train both and render it collapsed and open.
if (standalone && (!only || only.includes('train'))) {
  test('layout: Train Why card: header 64px or less, nothing clips at text size 1.3, DOM order is screen order on a phone, columns balanced', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const bad = [];
    for (const c of [{ w: 390, h: 844, ts: 1 }, { w: 890, h: 626, ts: 1 }, { w: 390, h: 844, ts: 1.3 }]) {
      const at = `${c.w}x${c.h}${c.ts !== 1 ? ` text ${c.ts}` : ''}`;
      await browser.viewport(c.w, c.h, true);
      await browser.open('train', seed({ why: true }));
      if (c.ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${c.ts}')`); await wait(300); }
      for (const open of [false, true]) {
        if (open) { await browser.eval("document.querySelector('[data-why-toggle]').click()"); await wait(300); }
        const m = await browser.eval(`(() => {
          const card = document.querySelector('[data-why-card]'); if (!card) return null;
          const h = card.querySelector('[data-why-toggle]'), body = card.querySelector('[data-why-body]'), hr = h.getBoundingClientRect();
          const kids = [...h.querySelectorAll('.why-text > *')].map((e) => e.getBoundingClientRect());
          const clip = [...h.querySelectorAll('.why-text > *')].some((e) => e.scrollWidth > e.clientWidth + 1) || kids.some((k) => k.bottom > hr.bottom + 0.5 || k.top < hr.top - 0.5);
          const overlap = kids.length > 1 && kids[0].bottom > kids[1].top + 1;
          const dom = ['[data-recovery-card]', '.resume, .preview', '[data-why-card]', '[data-program]', '.tools', '[data-train-history]'].map((s) => document.querySelector('#main ' + s)).filter(Boolean);
          const tops = dom.map((e) => e.getBoundingClientRect().top);
          const inDom = dom.every((e, i) => !i || !!(dom[i - 1].compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING));
          const ordered = [...document.querySelectorAll('#main *')].filter((e) => getComputedStyle(e).order !== '0').length;
          return { h: hr.height, expanded: h.getAttribute('aria-expanded'), hidden: body.hidden, body: body.children.length, clip, overlap, tops, inDom, ordered, over: document.documentElement.scrollWidth - innerWidth };
        })()`);
        const what = `${at} ${open ? 'open' : 'collapsed'}`;
        if (!m) { bad.push(`${what}: no Why card (seed has no notes or stalled lifts)`); continue; }
        if (m.expanded !== String(open) || m.hidden === open) bad.push(`${what}: aria-expanded ${m.expanded} and hidden ${m.hidden} disagree`);
        if (open && !m.body) bad.push(`${what}: the body is empty`);
        if (c.ts === 1 && m.h > 64) bad.push(`${what}: header is ${Math.round(m.h)}px tall, should be 64 or less`);
        if (m.clip || m.overlap) bad.push(`${what}: header text clips or overlaps`);
        if (m.over > 1) bad.push(`${what}: scrolls sideways`);
        if (m.ordered) bad.push(`${what}: ${m.ordered} elements use CSS order`);
        if (c.w < 840 && !m.inDom) bad.push(`${what}: Train's cards are not in phone order in the DOM`);
        if (c.w < 840 && m.tops.some((t, i) => i && t < m.tops[i - 1] - 1)) bad.push(`${what}: a card sits above the one before it in the DOM: ${m.tops.map(Math.round)}`);
        if (c.w >= 840 && !open) { // balanced as drawn; opening the card is the reader's choice
          const cols = await browser.eval("(() => { const q = (s) => { const e = document.querySelector('#main .train-cols > ' + s); const l = e && [...e.children].pop(); return l ? l.getBoundingClientRect().bottom + scrollY : null; }; return [q('.col-a'), q('.col-b')]; })()");
          if (cols[0] == null || cols[1] == null || Math.abs(cols[0] - cols[1]) > 400) bad.push(`${what}: Train columns end ${cols.map(Math.round)}, more than 400px apart`);
        }
        if (shots) await browser.screenshot(`${shots}/train-why-${open ? 'open' : 'collapsed'}-${c.w}x${c.h}${c.ts !== 1 ? '-text' : ''}.png`);
      }
    }
    assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
  });
}

// v0.16.42: the demo preview must show Swap and Replace without scrolling, and the side panel must clear the status bar.
if (standalone && (!only || only.includes('train'))) {
  test('layout: Train demo preview: Swap and Replace are in view when it opens (phone sheet and side panel)', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const bad = [];
    for (const c of [{ w: 390, h: 844, dark: true }, { w: 466, h: 678, dark: false }, { w: 626, h: 890, dark: false }, { w: 890, h: 626, dark: true }]) {
      const at = `${c.w}x${c.h}`;
      await browser.viewport(c.w, c.h, c.dark, { motion: true }); // Reduce Motion off: the sheet opens at the medium detent
      await browser.open('train', seed());
      await browser.eval("document.documentElement.style.setProperty('--safe-bottom', '34px')");
      const opened = await browser.eval("(() => { const h = document.querySelector('[data-preview]'); if (!h) return false; h.click(); return true; })()");
      if (!opened) { bad.push(`${at}: no tappable exercise row on Train`); continue; }
      await wait(900);
      const m = await browser.eval(`(() => {
        const d = document.querySelector('dialog.demo-sheet'); if (!d) return null;
        const r = (s) => { const e = d.querySelector(s); return e && e.getBoundingClientRect(); };
        const sw = r('[data-a="swap"]'), rp = r('[data-a="replace"]'), head = r('.sheet-head');
        return { sw: sw && [sw.top, sw.bottom], rp: rp && [rp.top, rp.bottom], headTop: head && head.top, vh: innerHeight, safeBottom: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom')) || 0, safe: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top')) || 0 };
      })()`);
      if (!m) { bad.push(`${at}: the preview did not open`); continue; }
      if (!m.sw || !m.rp) { bad.push(`${at}: Swap or Replace missing`); continue; }
      if (Math.max(m.sw[1], m.rp[1]) > m.vh - m.safeBottom) bad.push(`${at}: Swap/Replace sit below the visible area (bottom ${Math.round(Math.max(m.sw[1], m.rp[1]))} of ${m.vh - m.safeBottom})`);
      if (c.w >= 600 && m.headTop < m.safe - 1) bad.push(`${at}: side panel header (${Math.round(m.headTop)}) is under the status bar (${m.safe})`);
      if (shots) await browser.screenshot(`${shots}/train-preview-${at}.png`);
    }
    assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
  });
}

if (standalone && (!only || only.includes('train'))) {
  const GYM_SEED = (extra = {}) => { const d = seed(extra); d.profile[0].protectJoints = ['knee', 'lower_back']; d.settings[0].last_location_id = 'l1'; return d; };
  const gwait = (ms) => new Promise((r) => setTimeout(r, ms));
  const read = `(async () => { const { state } = await import('/js/state.js'); return { loc: state.settings.last_location_id, joints: state.profile.protectJoints, chip: (document.querySelector('[data-gym]') || {}).textContent, ex: [...document.querySelectorAll('.pv-ex')].map((e) => e.textContent.trim().slice(0, 40)).join('|'), toasts: document.querySelectorAll('.toast').length, wLoc: (state.workouts.find((w) => w.status === 'active') || {}).location_id || null }; })()`;
  const pick = (id) => browser.eval(`document.querySelector('dialog.sheet [data-gym-id="${id}"]').click()`);
  const openPicker = async () => { await browser.eval("document.querySelector('[data-gym]').click()"); await gwait(900); };

  test('layout: every tour target on the Train route is drawn by Train', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const { TOUR_STEPS } = await import('../js/tour/steps.js');
    await browser.viewport(390, 844, true, { motion: true });
    await browser.open('train', seed());
    const bad = [];
    for (const st of TOUR_STEPS.filter((x) => x.route === 'train' && x.target)) {
      const ok = await browser.eval(`!!document.querySelector(${JSON.stringify(st.target)})`);
      if (!ok) bad.push(`${st.id}: ${st.target} is not on Train`);
    }
    assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
  });

  test('layout: Train gym chip switches gyms, asks mid-workout, and the Resume card toggles joints', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const bad = [];
    for (const [w, h] of [[390, 844], [466, 678]]) {
      const at = `${w}x${h}`;
      await browser.viewport(w, h, true, { motion: true }); // Reduce Motion off
      // 1. idle: open the picker, switch, then pick the current gym
      await browser.open('train', GYM_SEED(), 'window.__LIVE = true;');
      const before = await browser.eval(read);
      await openPicker();
      const rows = await browser.eval(`[...document.querySelectorAll('dialog.sheet [data-gym-id]')].map((b) => b.dataset.gymId + ':' + b.getAttribute('aria-checked') + ':' + b.textContent.trim())`);
      if (!rows || rows.join() !== 'l1:true:Home gym,l2:false:Travel') bad.push(`${at}: picker rows were ${JSON.stringify(rows)}`);
      await pick('l2');
      await gwait(900);
      const after = await browser.eval(read);
      if (after.loc !== 'l2') bad.push(`${at}: last_location_id is ${after.loc}, not l2`);
      if (after.chip === before.chip) bad.push(`${at}: chip text did not change (${after.chip})`);
      if (after.ex === before.ex) bad.push(`${at}: the exercise list did not change`);
      if (JSON.stringify(after.joints) !== JSON.stringify(['knee', 'lower_back'])) bad.push(`${at}: joints changed to ${JSON.stringify(after.joints)}`);
      await browser.eval("document.querySelectorAll('.toast').forEach((t) => t.remove())");
      await openPicker();
      await pick('l2');
      await gwait(700);
      const same = await browser.eval(read);
      if (same.loc !== 'l2' || same.toasts !== 0) bad.push(`${at}: picking the current gym wrote or toasted (${same.loc}, ${same.toasts} toasts)`);

      // 2. workout in progress: confirm first; Cancel and Escape keep the gym; Switch gym switches
      await browser.open('train', GYM_SEED({ active: true }), 'window.__LIVE = true;');
      const tag = await browser.eval("(() => { const c = document.querySelector('.card.resume'); return c ? c.tagName : null; })()");
      if (tag !== 'DIV') bad.push(`${at}: the Resume card is a ${tag}, not a plain card`);
      for (const how of ['cancel', 'escape']) {
        await openPicker();
        await pick('l2');
        await gwait(900);
        const asked = await browser.eval("/Switch gym\\?/.test((document.querySelector('dialog.sheet') || {}).textContent || '')");
        if (!asked) bad.push(`${at}: no "Switch gym?" question`);
        if (how === 'cancel') await browser.eval("document.querySelector('dialog.sheet [data-no]').click()");
        else await browser.eval("(() => { const d = document.querySelector('dialog.sheet'); d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); d.dispatchEvent(new Event('cancel', { cancelable: false })); if (d.isConnected) d.close(); })()");
        await gwait(900);
        const kept = await browser.eval(read);
        if (kept.loc !== 'l1') bad.push(`${at}: ${how} still switched to ${kept.loc}`);
      }
      await openPicker();
      await pick('l2');
      await gwait(900);
      await browser.eval("document.querySelector('dialog.sheet [data-yes]').click()");
      await gwait(900);
      const sw = await browser.eval(read);
      if (sw.loc !== 'l2') bad.push(`${at}: "Switch gym" left the gym at ${sw.loc}`);
      if (sw.wLoc !== 'l1') bad.push(`${at}: the workout in progress moved to ${sw.wLoc}`);

      // 3. Resume card: tap Knees, keep both switches and the note
      await browser.open('train', GYM_SEED({ active: true }), 'window.__LIVE = true;');
      await browser.eval(`document.querySelector('.card.resume [data-protect="knee"]').click()`);
      await gwait(900);
      const rc = await browser.eval(`(async () => { const { state } = await import('/js/state.js'); const c = document.querySelector('.card.resume'); return { joints: state.profile.protectJoints, pills: c ? c.querySelectorAll('[data-protect]').length : 0, note: c ? /Changes apply to your next plan/.test(c.textContent) : false, anchor: !!(c && c.closest('a')) }; })()`);
      if (rc.pills !== 2) bad.push(`${at}: Resume card has ${rc.pills} switches after a tap`);
      if (!rc.note) bad.push(`${at}: Resume card lost its "Changes apply to your next plan" line`);
      if (rc.anchor) bad.push(`${at}: the Resume card is inside a link`);
      if (JSON.stringify(rc.joints) !== JSON.stringify(['lower_back'])) bad.push(`${at}: tapping Knees saved ${JSON.stringify(rc.joints)}`);
      if (shots) await browser.screenshot(`${shots}/train-gym-${at}.png`);
    }
    assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
  });

  test('layout: Scan and Create food sheets open from Log food, fit, and are shot for review', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const bad = [];
    for (const [w, h] of [[390, 844], [466, 678]]) {
      await browser.viewport(w, h, true);
      for (const [name, open] of [['scan', "document.querySelector('[data-scan-btn]').click()"], ['create', "document.querySelector('[data-create]').click()"]]) {
        await browser.open('food', seed({ over: true }));
        await browser.eval("document.querySelector('[data-log-food]').click()"); await wait(900);
        await browser.eval(open); await wait(900);
        const r = await browser.eval("(() => { const d = [...document.querySelectorAll('dialog.sheet[open]')].pop(); if (!d) return null; return { over: d.scrollWidth > d.clientWidth + 1 }; })()");
        if (!r) { bad.push(`${name} ${w}x${h}: sheet did not open`); continue; }
        if (r.over) bad.push(`${name} ${w}x${h}: sheet overflows sideways`);
        if (shots) await browser.screenshot(`${shots}/food-${name}-${w}x${h}.png`);
      }
    }
    assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
  });

  test('layout: Body profile shows the Last week marker, line and since-line, unclipped, and is shot for review', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const bad = [];
    const cases = [[320, 568, true, 1], [320, 568, true, 1.3], [320, 568, true, 1.6], [390, 844, true, 1], [390, 844, false, 1], [390, 844, true, 1.3], [390, 844, true, 1.6], [466, 678, true, 1], [678, 466, true, 1], [626, 890, false, 1], [890, 626, true, 1]].map((c) => [...c, true]);
    // Last week in a different cell from You (the cases above have both in one cell, last week above the dot)
    for (const c of [[320, 568, true, 1], [320, 568, true, 1.6], [390, 844, true, 1.3], [390, 844, false, 1.6], [678, 466, true, 1]]) cases.push([...c, 'far']);
    for (const [w, h, dark, ts, comp] of cases) {
      await browser.viewport(w, h, dark);
      await browser.open('body', seed({ comp }));
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await wait(300); }
      await browser.eval("document.querySelector('[data-bodyprofile] .bp-grid') && document.querySelector('[data-bodyprofile] .bp-grid').scrollIntoView({ block: 'center', behavior: 'instant' })"); await wait(300);
      const tag = `${w}x${h}${dark ? 'd' : 'l'}${ts !== 1 ? `T${ts}` : ''}${comp === 'far' ? ' far' : ''}`;
      const r = await browser.eval(`(() => {
        const card = document.querySelector('[data-bodyprofile]'); if (!card) return null;
        const b = card.querySelector('[data-bp-last]');
        const you = card.querySelector('.bp-now');
        if (!b || !you) return { marker: !!b, you: !!you };
        const lab = b.querySelector('span'); const ring = b.querySelector('i');
        const q = (e) => e.getBoundingClientRect(); const l = q(lab); const c = q(card); const y = q(you); const g = q(ring);
        const a = card.querySelector('[data-bp-arrow] line');
        const apart = Math.hypot((y.left + y.right) / 2 - (g.left + g.right) / 2, (y.top + y.bottom) / 2 - (g.top + g.bottom) / 2);
        let clipped = false;
        for (let e = lab.parentElement; e && e !== card; e = e.parentElement) {
          if (getComputedStyle(e).overflow === 'visible') continue;
          const k = q(e); if (l.left < k.left - 0.5 || l.right > k.right + 0.5 || l.top < k.top - 0.5) clipped = true;
        }
        let linePx = 0; let headHitsRing = false;
        if (a) {
          const s = a.ownerSVGElement; const sr = q(s); const vb = s.viewBox.baseVal;
          const px = (x, y) => [sr.left + x / vb.width * sr.width, sr.top + y / vb.height * sr.height];
          const [p1, p2] = [px(a.x1.baseVal.value, a.y1.baseVal.value), px(a.x2.baseVal.value, a.y2.baseVal.value)];
          linePx = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
          const pl = s.querySelector('polyline');
          for (let i = 0; i < pl.points.numberOfItems; i++) {
            const pt = pl.points.getItem(i); const [hx, hy] = px(pt.x, pt.y);
            if (hx >= g.left && hx <= g.right && hy >= g.top && hy <= g.bottom) headHitsRing = true;
          }
        }
        const yl = card.querySelector('.bp-you'); const yb = yl ? q(yl) : null;
        const hit = (p, k) => !(p.right <= k.left || p.left >= k.right || p.bottom <= k.top || p.top >= k.bottom);
        const youHidesLabel = !!yb && hit(y, yb);
        const overlaps = [];
        if (yb) {
          if (hit(g, yb)) overlaps.push('ring');
          if (hit(l, yb)) overlaps.push('Last week pill');
          const cellEl = card.querySelector('.bp-cell.r' + yl.dataset.row + '.c' + yl.dataset.col); const ce = cellEl ? q(cellEl) : null;
          // inside its own cell, except where the cell is smaller than the label (1.6 text, or 1.3 on a 320 screen): there it may spill into the next cell, never off the grid
          const gb = q(card.querySelector('.bp-gridbox'));
          const spillOk = (${ts} >= 1.6 || (${ts} >= 1.3 && innerWidth <= 320)) && yb.left >= gb.left - 0.5 && yb.right <= gb.right + 0.5 && yb.top >= gb.top - 0.5 && yb.bottom <= gb.bottom + 0.5;
          if (!ce || (!spillOk && (yb.left < ce.left - 0.5 || yb.right > ce.right + 0.5 || yb.top < ce.top - 0.5 || yb.bottom > ce.bottom + 0.5))) overlaps.push('outside its cell');
          // the label ignores taps in the app, so let it be hit-tested here to prove nothing is drawn over it
          yl.style.pointerEvents = 'auto';
          const top = document.elementFromPoint((yb.left + yb.right) / 2, (yb.top + yb.bottom) / 2);
          yl.style.pointerEvents = '';
          if (top !== yl) overlaps.push('covered by ' + (top ? top.tagName + '.' + top.className : 'nothing'));
          if (getComputedStyle(yl).pointerEvents !== 'none') overlaps.push('label takes taps');
          const gx = (g.left + g.right) / 2; const gy = (g.top + g.bottom) / 2;
          const dx = (yb.left + yb.right) / 2 - gx; const dy = (yb.top + yb.bottom) / 2 - gy; const dd = Math.hypot(dx, dy) || 1;
          const tapEl = document.elementFromPoint(gx + dx / dd * 15, gy + dy / dd * 15);
          if (!tapEl || tapEl.closest('[data-bp-last]') !== b) overlaps.push('Last week tap area stolen by ' + (tapEl ? tapEl.tagName + '.' + tapEl.className : 'nothing'));
          if (yb.left < 0 || yb.right > innerWidth) overlaps.push('off screen');
          for (const tr of card.querySelectorAll('.bp-trail')) if (hit(q(tr), yb)) overlaps.push('trail dot');
          if (a) {
            const s2 = a.ownerSVGElement; const sr2 = q(s2); const vb2 = s2.viewBox.baseVal;
            const px2 = (x, y2) => [sr2.left + x / vb2.width * sr2.width, sr2.top + y2 / vb2.height * sr2.height];
            const [p1, p2] = [px2(a.x1.baseVal.value, a.y1.baseVal.value), px2(a.x2.baseVal.value, a.y2.baseVal.value)];
            const inside = (x, y2) => x > yb.left && x < yb.right && y2 > yb.top && y2 < yb.bottom;
            for (let i = 0; i <= 60; i++) if (inside(p1[0] + (p2[0] - p1[0]) * i / 60, p1[1] + (p2[1] - p1[1]) * i / 60)) { overlaps.push('arrow line'); break; }
            const pl2 = s2.querySelector('polyline');
            for (let i = 0; i < pl2.points.numberOfItems; i++) { const pt = pl2.points.getItem(i); const [hx, hy] = px2(pt.x, pt.y); if (inside(hx, hy)) { overlaps.push('arrow head'); break; } }
          }
        }
        return { marker: true, you: true, youHidesLabel, overlaps, placed: yl && yl.dataset.placed, since: !!card.querySelector('[data-bp-since]'), line: !!a, linePx, headHitsRing,
          labelOk: l.left >= 0 && l.right <= innerWidth && l.left >= c.left - 0.5 && l.right <= c.right + 0.5 && !clipped,
          labelWrap: l.height > parseFloat(getComputedStyle(lab).fontSize) * 2, apart };
      })()`);
      if (!r || !r.marker || !r.you) { bad.push(`${tag}: marker or You dot missing ${JSON.stringify(r)}`); continue; }
      if (!r.since) bad.push(`${tag}: since-line missing`);
      if (!r.line || r.linePx < 14) bad.push(`${tag}: the drawn line between the two dots is missing or under 14px ${JSON.stringify(r)}`);
      if (r.headHitsRing) bad.push(`${tag}: the arrowhead overlaps the Last week ring ${JSON.stringify(r)}`);
      if (!r.labelOk || r.labelWrap) bad.push(`${tag}: the Last week label is clipped or wraps ${JSON.stringify(r)}`);
      if (r.youHidesLabel) bad.push(`${tag}: the You dot covers its You label ${JSON.stringify(r)}`);
      if (r.overlaps.length) bad.push(`${tag}: the You label is hidden or crowded: ${r.overlaps.join(', ')} ${JSON.stringify(r)}`);
      if (r.apart < 16) bad.push(`${tag}: the ring hides under You (${Math.round(r.apart)}px apart)`);
      if (shots) await browser.screenshot(`${shots}/body-${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? `-text${Math.round(ts * 100)}` : ''}${comp === 'far' ? '-far' : ''}-bodyprofile.png`);
    }
    assert(bad.length === 0, `\n        ${bad.join('\n        ')}`);
  });
}

// Workout summary (v0.16.63): the Time/Sets/Records row, the Calories/Volume/Reps/Hold tiles with "vs last", and one line per set.
// Seeds a finished workout (weighted with a PR, per-arm, timed and bodyweight moves, a 5-digit volume, 1:05 long) and an earlier one with
// the same label. Cases: compare (earlier calories also an estimate), mixed (earlier calories from the Watch: no calories change shown),
// first (no earlier workout). Nothing may overflow, clip or wrap (values stay on one line).
const SUM_SIZES = [[390, 844, true, 1], [390, 844, false, 1], [320, 568, true, 1.6], [678, 466, true, 1], [626, 890, true, 1]];
function summarySeed(kind) {
  const data = seed();
  const now = new Date(WORKOUT_DAY).getTime();
  const rec = (id, extra) => ({ id, user_id: 'u1', created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(), source: 'manual', deleted: false, ...extra });
  const set = (reps, kg) => ({ warmup: false, done: true, reps, weight_kg: kg, plan_reps: reps, plan_weight_kg: kg });
  const moves = (k) => [
    { exercise_id: 'db_bench_press', role: 'main', superset: null, sets: Array.from({ length: 5 }, () => set(12, 100 + k)) }, // 5 x 12 x ~220 lb = 5-digit volume
    { exercise_id: 'db_one_arm_row', role: 'accessory', superset: null, sets: [set(10, 30 + k), set(10, 30 + k)] }, // per arm: both sides count
    { exercise_id: 'plank', role: 'accessory', superset: null, sets: [set(45 + k, null)] }, // timed
    { exercise_id: 'pushup', role: 'accessory', superset: null, sets: [set(15 + k, null)] }, // bodyweight
  ];
  const t = now - 3600000;
  data.workouts.push(rec('sumnow', { status: 'done', label: 'Upper body', day_type: 'upper', started_at: new Date(t).toISOString(), finished_at: new Date(t + 3900000).toISOString(), duration_ms: 3900000, location_id: 'l1',
    prs: [{ exercise_id: 'db_bench_press', label: 'Dumbbell Bench Press: 220 lb x 12', prev: 210 }], exercises: moves(0) }));
  if (kind !== 'first') {
    const p = now - 7 * 86400000;
    data.workouts.push(rec('sumprev', { status: 'done', label: 'Upper body', day_type: 'upper', started_at: new Date(p).toISOString(), finished_at: new Date(p + 3000000).toISOString(), duration_ms: 3000000, location_id: 'l1',
      ...(kind === 'mixed' ? { kcal: 410, kcal_source: 'apple_watch' } : { kcal: 300, kcal_source: 'estimate' }), prs: [], exercises: moves(-5) }));
  }
  return data;
}
const SUM_PROBE = `(() => {
  const vw = innerWidth;
  const q = (s) => [...document.querySelectorAll(s)];
  const off = (e) => { const r = e.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1; };
  const clipped = (e) => e.scrollWidth > e.clientWidth + 1;
  const wraps = (e) => e.getBoundingClientRect().height > parseFloat(getComputedStyle(e).fontSize) * 1.9;
  const bad = [];
  for (const sel of ['.sum-stats.three', '.sum-totals']) {
    const box = document.querySelector(sel);
    if (!box) { bad.push(sel + ' is missing'); continue; }
    if (off(box) || clipped(box)) bad.push(sel + ' overflows');
    for (const tile of box.children) {
      if (off(tile) || clipped(tile)) bad.push(sel + ' tile "' + tile.textContent.trim().slice(0, 24) + '" overflows or clips');
      for (const v of tile.querySelectorAll('b')) if (wraps(v) || clipped(v)) bad.push(sel + ' value "' + v.textContent.trim() + '" wraps or clips');
      for (const s of tile.querySelectorAll('span, em')) if (off(s) || clipped(s)) bad.push(sel + ' text "' + s.textContent.trim() + '" clips');
    }
  }
  const lines = q('.sum-list small.muted');
  for (const l of lines) if (off(l) || clipped(l)) bad.push('set lines clip: ' + l.textContent.slice(0, 30));
  const tiles = q('.sum-totals > div').map((d) => ({ label: d.children[0].textContent.trim(), value: d.querySelector('b').textContent.trim(), em: d.querySelector('em') ? d.querySelector('em').textContent.trim() : '' }));
  const main = document.querySelector('#main');
  return { bad, over: document.documentElement.scrollWidth > vw + 1, tiles, three: q('.sum-stats.three > div').map((d) => d.textContent.trim()),
    sets: lines.map((l) => l.innerText.split('\\n')), kcalMentions: (main.innerText.match(/kcal/g) || []).length };
})()`;
for (const [w, h, dark, ts] of standalone && (!only || only.includes('summary')) ? SUM_SIZES : []) {
  const tag = `${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? '-text160' : ''}`;
  test(`layout: summary: stats row, totals tiles and set lines fit at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    for (const kind of ['compare', ...(w === 390 && dark ? ['mixed', 'first'] : [])]) {
      await browser.viewport(w, h, dark);
      await browser.open('summary/sumnow', summarySeed(kind));
      if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
      const r = await browser.eval(SUM_PROBE);
      if (shots) await browser.screenshot(`${shots}/summary-${kind}-${tag}.png`);
      assert(!r.over, `${kind}: the page scrolls sideways`);
      assert(r.bad.length === 0, `${kind}: ${r.bad.join('; ')}`);
      assert(r.three.length === 3 && /^Time/.test(r.three[0]) && /^Sets/.test(r.three[1]) && /^Records/.test(r.three[2]), `${kind}: stats row reads ${JSON.stringify(r.three)}`);
      assert(/1:05/.test(r.three[0]), `${kind}: time reads ${r.three[0]}`);
      const by = Object.fromEntries(r.tiles.map((t) => [t.label.split(' ')[0], t]));
      assert(r.tiles.length === 4, `${kind}: ${r.tiles.length} totals tiles`);
      assert(/^Calories · est\.$/.test(r.tiles[0].label) && /kcal$/.test(r.tiles[0].value), `${kind}: calories tile reads ${JSON.stringify(r.tiles[0])}`);
      assert(r.kcalMentions === 1, `${kind}: calories appear ${r.kcalMentions} times`);
      assert(/^1\d,\d{3} lb$/.test(by.Volume.value), `${kind}: volume reads ${by.Volume.value}`);
      assert(r.sets[0][0] === '12 reps x 220.5 lb' && r.sets.some((l) => l[0] === '45 s') && r.sets.some((l) => l[0] === '15 reps'), `${kind}: set lines read ${JSON.stringify(r.sets)}`);
      if (kind === 'first') assert(r.tiles.every((t) => t.em === 'First time'), `${kind}: tiles read ${JSON.stringify(r.tiles)}`);
      if (kind === 'compare') assert(r.tiles.every((t) => /vs last$/.test(t.em)), `${kind}: tiles read ${JSON.stringify(r.tiles)}`);
      if (kind === 'mixed') assert(r.tiles[0].em === '' && r.tiles.slice(1).every((t) => /vs last$/.test(t.em)), `${kind}: calories must show no change against a Watch number, got ${JSON.stringify(r.tiles)}`);
    }
  });
}

// Apple Health write-back UI (v0.16.84, #242): History Recent rows and the workout detail sheet show the duration, the summary shows
// "Not sent — turn on" / "Saved to Apple Health" / the estimated-weight note, and the first finish asks "Save workouts to Apple Health?".
// The native bridge is stubbed (a fake ForgeWorkouts plugin). Turn-on button 44px+, nothing overflows or truncates, a Recent row at 320 / 160% included.
const HW_SIZES = [[390, 844, true, 1], [390, 844, false, 1], [320, 568, true, 1.6], [626, 890, true, 1], [678, 466, true, 1]];
const HW_NATIVE = "window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: (n) => n === 'ForgeWorkouts', Plugins: { ForgeWorkouts: {} } };";
function hwSeed(kind) {
  const data = summarySeed('first');
  const w = data.workouts.find((x) => x.id === 'sumnow');
  if (kind === 'saved') { data.settings[0].health_write_workouts = true; w.health_write = 'saved'; }
  if (kind === 'estimate') { data.settings[0].health_write_workouts = true; w.health_write = 'saved'; w.kcal = 280; w.kcal_source = 'estimate'; w.kcal_weight_estimated = true; data.weights = []; data.profile[0].weightKg = null; }
  return data;
}
// + Log a workout (#253): the History button and the one sheet fit, with 44pt targets, at every size (and 320 at text 1.6).
const LW_SIZES = [[390, 844, true, 1], [390, 844, false, 1], [466, 678, true, 1], [678, 466, true, 1], [626, 890, false, 1], [890, 626, true, 1], [320, 568, true, 1.6]];
for (const [w, h, dark, ts] of standalone && (!only || only.includes('history') || only.includes('logworkout')) ? LW_SIZES : []) {
  const tag = `${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? '-text160' : ''}`;
  test(`layout: + Log a workout button and sheet fit at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, dark);
    await browser.open('history', seed({ long: true }));
    if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
    const b = await browser.eval(`(() => { const e = document.querySelector('[data-log-workout]'); if (!e) return null; const r = e.getBoundingClientRect(); return { h: r.height, l: r.left, r: r.right, vw: innerWidth, over: document.documentElement.scrollWidth > innerWidth + 1, txt: e.textContent }; })()`);
    if (shots) await browser.screenshot(`${shots}/log-workout-button-${tag}.png`);
    assert(b && /Log a workout/.test(b.txt), 'History has no + Log a workout button');
    assert(b.h >= 43.5 && b.l >= 0 && b.r <= b.vw + 0.5 && !b.over, `the button is small, off screen or the page scrolls sideways: ${JSON.stringify(b)}`);
    await browser.eval("document.querySelector('[data-log-workout]').click()");
    await new Promise((r) => setTimeout(r, 900));
    const s = await browser.eval(`(() => {
      const d = document.querySelector('dialog.sheet[open]'); if (!d) return null;
      const box = d.getBoundingClientRect(), bad = [];
      for (const e of d.querySelectorAll('input:not([type=checkbox]), select, button[type=submit]')) {
        if (e.closest('[hidden]')) continue;
        const r = e.getBoundingClientRect();
        if (r.right > box.right + 1 || r.left < box.left - 1) bad.push('off the sheet: ' + (e.name || e.type));
        if (r.height < 43.5) bad.push('short: ' + (e.name || e.type) + ' ' + r.height);
      }
      return { bad, over: d.scrollWidth > d.clientWidth + 1, names: [...d.querySelectorAll('[name]')].map((e) => e.name) };
    })()`);
    if (shots) await browser.screenshot(`${shots}/log-workout-sheet-${tag}.png`);
    assert(s, 'the Log a workout sheet did not open');
    assert(s.bad.length === 0 && !s.over, `the sheet overflows or has small targets: ${JSON.stringify(s)}`);
    for (const n of ['activity', 'day', 'time', 'min', 'kcal', 'hr', 'notes']) assert(s.names.includes(n), `the sheet has no ${n} field`);
  });
}
const HW_PROBE = `(() => {
  const vw = innerWidth;
  const clipped = (e) => e.scrollWidth > e.clientWidth + 1;
  const off = (e) => { const r = e.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1; };
  const bad = [];
  if (document.documentElement.scrollWidth > vw + 1) bad.push('the page scrolls sideways');
  for (const e of document.querySelectorAll('#main li.tap, #main li.tap small, #main li.tap b, [data-kcal], [data-kcal] *, dialog.sheet small, dialog.sheet p')) if (clipped(e) || off(e)) bad.push('clips or overflows: ' + e.tagName + ' "' + e.textContent.trim().slice(0, 40) + '"');
  const btn = document.querySelector('[data-health-on]');
  return { bad, btn: btn ? btn.getBoundingClientRect().height : null, btnOff: btn ? off(btn) : false, recent: [...document.querySelectorAll('#main li.tap small')].map((e) => e.textContent), kcal: (document.querySelector('[data-kcal]') || {}).innerText || '',
    sheetText: (document.querySelector('dialog.sheet') || {}).innerText || '' };
})()`;
for (const [w, h, dark, ts] of standalone && (!only || only.includes('history') || only.includes('summary') || only.includes('healthwrite')) ? HW_SIZES : []) {
  const tag = `${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? '-text160' : ''}`;
  const zoom = async () => { if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); } };
  test(`layout: health write-back: History duration and detail line fit at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, dark);
    await browser.open('history', seed({ long: true }));
    await zoom();
    const r = await browser.eval(HW_PROBE);
    if (shots) await browser.screenshot(`${shots}/history-duration-${tag}.png`);
    assert(r.bad.length === 0, r.bad.join('; '));
    assert(r.recent.some((t) => / · 45 min/.test(t)), `Recent rows show no duration: ${JSON.stringify(r.recent)}`);
    await browser.eval("document.querySelector('#main li.tap[data-w]').click()");
    await new Promise((r2) => setTimeout(r2, 700));
    const d = await browser.eval(HW_PROBE);
    if (shots) await browser.screenshot(`${shots}/history-detail-duration-${tag}.png`);
    assert(/45 min/.test(d.sheetText), `detail sheet shows no duration: ${d.sheetText.slice(0, 120)}`);
    assert(d.bad.length === 0, d.bad.join('; '));
  });
  test(`layout: health write-back: summary status line and turn-on button fit at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, dark);
    for (const kind of ['off', 'saved', 'estimate']) {
      await browser.open('summary/sumnow', hwSeed(kind), HW_NATIVE);
      await zoom();
      const r = await browser.eval(HW_PROBE);
      if (shots) await browser.screenshot(`${shots}/summary-health-${kind}-${tag}.png`);
      assert(r.bad.length === 0, `${kind}: ${r.bad.join('; ')}`);
      if (kind === 'off') {
        assert(/Not sent — turn on/.test(r.kcal), `${kind}: status reads ${JSON.stringify(r.kcal)}`);
        assert(r.btn !== null && r.btn >= 43.5 && !r.btnOff, `${kind}: turn-on button is ${r.btn}px tall (off-screen: ${r.btnOff})`);
      } else assert(/Saved to Apple Health/.test(r.kcal), `${kind}: status reads ${JSON.stringify(r.kcal)}`);
      if (kind === 'estimate') assert(/Calories use an estimated weight/.test(r.kcal), `${kind}: no estimate note: ${JSON.stringify(r.kcal)}`);
    }
  });
  test(`layout: health write-back: first-finish "Save workouts to Apple Health?" sheet fits at ${tag}`, async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    await browser.viewport(w, h, dark);
    await browser.open('summary/sumnow', hwSeed('off'), HW_NATIVE);
    await zoom();
    await browser.eval("(async () => { const [o, m] = await Promise.all([import('./js/screens/overlays.js'), import('./js/native/workouts-health.js')]); o.offerHealth(m, { id: 'sumnow' }); })()");
    await new Promise((r2) => setTimeout(r2, 800));
    const r = await browser.eval(HW_PROBE);
    if (shots) await browser.screenshot(`${shots}/health-prompt-${tag}.png`);
    assert(/Save workouts to Apple Health\?/.test(r.sheetText), `the prompt did not open: ${r.sheetText.slice(0, 80)}`);
    const btns = await browser.eval("[...document.querySelectorAll('dialog.sheet [data-yes], dialog.sheet [data-no]')].map((b) => b.getBoundingClientRect().height)");
    assert(btns.length === 2 && btns.every((x) => x >= 43.5), `prompt buttons are ${JSON.stringify(btns)}px tall`);
    assert(r.bad.length === 0, r.bad.join('; '));
  });
}

// Progress photo camera (v0.16.76, #227). The viewfinder opens over the modal Progress photos sheet with a stubbed camera
// (a canvas stream). Real mouse taps, so a viewfinder that sits under the modal's top layer would fail here: the shutter
// must work, the photo must land in its pose row, the sheet must stay open, no overlay may be left and Save must still work.
// Then the screen is rendered (X + long title + 10s Timer + Last time, and the countdown at 10) at five sizes.
const VF_ON = standalone && (!only || only.includes('viewfinder'));
const VF_SIZES = [[390, 844, 1], [320, 568, 1.6], [466, 678, 1], [678, 466, 1], [626, 890, 1]];
const VF_STUB = (timer) => `(async () => {
  window.Capacitor = { isNativePlatform: () => true };
  localStorage.setItem('forge.photoTimer', '${timer}');
  const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480;
  const g = cv.getContext('2d'); let n = 0;
  setInterval(() => { g.fillStyle = '#2a4a5a'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#e8b04a'; g.fillRect(260 + (n++ % 40), 80, 120, 320); }, 40);
  navigator.mediaDevices.getUserMedia = async () => cv.captureStream(25);
  window.__ghost = cv.toDataURL('image/png');
  window.__saved = [];
  const m = await import('./js/photos/capture.js');
  m.openCapture({ store: { save: async (r) => { window.__saved.push(r.pose); }, setNote: async () => {} }, sessions: [] });
})()`;
const vfWait = async (expr, ms = 6000) => {
  for (let t = 0; t < ms; t += 100) { if (await browser.eval(expr)) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
};
const vfTap = async (sel) => {
  const p = await browser.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  assert(p, `${sel} not found`);
  for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
};
const vfBoot = async (w, h, dark, ts, timer) => {
  browser = browser || await launch();
  await browser.viewport(w, h, dark);
  await browser.open('today', seed());
  if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
  await browser.eval(VF_STUB(timer));
  await new Promise((r) => setTimeout(r, 800)); // the sheet settles
};
const VF_READY = "(() => { const v = document.querySelector('.vf video'); const s = document.querySelector('.vf [data-shoot]'); return !!(v && v.videoWidth && s && s.getAttribute('aria-disabled') === 'false'); })()";
for (const timer of VF_ON ? [0, 3] : []) {
  test(`layout: camera shutter${timer ? ` with a ${timer}s timer` : ''} saves into the pose row, keeps the sheet open and leaves nothing behind`, async () => {
    if (skipReason()) return;
    await vfBoot(390, 844, true, 1, timer);
    await vfTap('[data-pose="front"] [data-cam]');
    assert(await vfWait(VF_READY), `camera never became ready. Page errors: ${browser.errors.slice(-3).join(' | ') || 'none'}`);
    const top = await browser.eval("(() => { const s = document.querySelector('.vf [data-shoot]').getBoundingClientRect(); const e = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2); return !!(e && e.closest('.vf')); })()");
    assert(top, 'the shutter is not the top-most thing at its own position (the viewfinder sits under the modal sheet layer)');
    await vfTap('[data-shoot]');
    if (timer) {
      assert(await browser.eval("document.querySelector('.vf-count') && !document.querySelector('.vf-count').hidden && document.querySelector('.vf-count').textContent === '3'"), 'countdown does not start at 3');
    }
    assert(await vfWait("!document.querySelector('.vf')", timer ? 8000 : 5000), 'the viewfinder never closed after the shutter');
    assert(await browser.eval("!!document.querySelector('dialog.sheet[open]')"), 'the Progress photos sheet closed when the shutter was tapped');
    assert(await vfWait("!!document.querySelector('[data-pose=\"front\"] .pc-img')"), 'no photo landed in the Front row');
    assert(await browser.eval("!document.querySelector('[data-save]').disabled"), 'Save photos is still disabled');
    await vfTap('[data-save]');
    assert(await vfWait("window.__saved.length === 1 && window.__saved[0] === 'front'"), `Save photos did nothing after the shot (saved: ${await browser.eval('JSON.stringify(window.__saved)')})`);
    assert(await vfWait("!document.querySelector('dialog.sheet[open]')"), 'the sheet did not close after Save');
  });
}

for (const [w, h, ts] of VF_ON ? VF_SIZES : []) {
  const tag = `${w}x${h}${ts !== 1 ? '-text160' : ''}`;
  test(`layout: camera screen fits at ${tag} (top bar, countdown, shutter)`, async () => {
    if (skipReason()) return;
    await vfBoot(w, h, true, ts, 10);
    await browser.eval(`(async () => { const m = await import('./js/photos/viewfinder.js'); window.__vf = m.openViewfinder({ label: 'Front, relaxed, arms at your sides', ghostUrl: window.__ghost }); })()`);
    assert(await vfWait(VF_READY), `camera never became ready. Page errors: ${browser.errors.slice(-3).join(' | ') || 'none'}`);
    await vfTap('[data-shoot]'); // timer 10: the countdown shows 10
    assert(await vfWait("document.querySelector('.vf-count') && document.querySelector('.vf-count').textContent === '10'"), 'countdown did not show 10');
    if (shots) await browser.screenshot(`${shots}/vf-${tag}.png`);
    const r = await browser.eval(`(() => {
      const R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
      const inside = (b) => b.l >= -0.5 && b.r <= innerWidth + 0.5 && b.t >= -0.5 && b.b <= innerHeight + 0.5;
      const topmost = (e) => { const b = R(e); const x = document.elementFromPoint(b.l + b.w / 2, b.t + b.h / 2); return !!(x && e.contains(x)); };
      const bar = [...document.querySelectorAll('.vf-top > *')].filter((e) => e.getClientRects().length);
      const btns = [...document.querySelectorAll('.vf-top .vf-btn')];
      const title = document.querySelector('.vf-title');
      const hit = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
      const bad = [];
      const boxes = bar.map(R);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i], boxes[j])) bad.push(bar[i].className + ' overlaps ' + bar[j].className);
      const shutter = document.querySelector('.vf-shutter'), flip = document.querySelector('[data-flip]'), count = document.querySelector('.vf-count');
      const rg = document.createRange(); rg.selectNodeContents(count); const nb = rg.getBoundingClientRect();
      const bottomPad = parseFloat(getComputedStyle(document.querySelector('.vf-bottom')).paddingBottom);
      return {
        bar: bar.map((e) => e.className + ':' + e.textContent.trim().slice(0, 12)), btnSmall: btns.map((e) => R(e)).filter((b) => b.h < 44 || b.w < 44).length,
        btnOff: btns.filter((e) => !inside(R(e))).length, btnHidden: btns.filter((e) => !topmost(e)).length, overlaps: bad, titleInside: inside(R(title)), titleW: R(title).w,
        titleEllipsis: getComputedStyle(title).textOverflow === 'ellipsis' && getComputedStyle(title).overflow === 'hidden',
        pillText: [...document.querySelectorAll('.vf-pill')].map((e) => e.textContent.trim()), pillClipped: [...document.querySelectorAll('.vf-pill')].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
        shutterBox: R(shutter), shutterInside: inside(R(shutter)), shutterAboveSafe: R(shutter).b <= innerHeight - bottomPad + 0.5, shutterTop: topmost(shutter),
        flipBox: R(flip), flipInside: inside(R(flip)), flipTop: topmost(flip), flipAboveSafe: R(flip).b <= innerHeight - bottomPad + 0.5, bottomPad,
        countInside: nb.left >= 0 && nb.right <= innerWidth && nb.top >= 0 && nb.bottom <= innerHeight, countBox: [nb.left, nb.right, nb.top, nb.bottom].map(Math.round),
        over: document.documentElement.scrollWidth > innerWidth + 1,
      };
    })()`);
    assert(r.bar.length === 4, `top bar has ${r.bar.length} items: ${r.bar.join(' | ')}`);
    assert(r.pillText.join() === '10s,Last time', `pills read ${r.pillText.join()}`);
    assert(r.btnSmall === 0, `${r.btnSmall} top-bar buttons are under 44px`);
    assert(r.btnOff === 0 && r.btnHidden === 0, `top-bar buttons off-screen (${r.btnOff}) or covered (${r.btnHidden})`);
    assert(r.overlaps.length === 0, `top bar overlaps: ${r.overlaps.join('; ')}`);
    assert(r.titleInside && r.titleW > 20 && r.titleEllipsis , `title is not contained: width ${r.titleW}, ellipsis ${r.titleEllipsis}`);
    assert(!r.pillClipped, 'a pill label is clipped');
    assert(r.shutterInside && r.shutterAboveSafe && r.shutterTop && r.shutterBox.w >= 44, `shutter is clipped, covered or under the safe area: ${JSON.stringify(r.shutterBox)} pad ${r.bottomPad}`);
    assert(r.flipInside && r.flipAboveSafe && r.flipTop && r.flipBox.w >= 44 && r.flipBox.h >= 44, `flip is clipped, covered or too small: ${JSON.stringify(r.flipBox)}`);
    assert(r.countInside, `countdown number runs outside the screen: ${r.countBox}`);
    assert(!r.over, 'the camera screen scrolls sideways');
    await vfTap('.vf [data-close]');
    assert(await vfWait("!document.querySelector('.vf')"), 'Cancel did not close the camera');
    assert(await browser.eval("!!document.querySelector('dialog.sheet[open]')"), 'the sheet closed with the camera');
  });
}

test('layout: close the browser', async () => {
  // close() is bounded, but never let teardown fail a shard: warn and continue.
  const b = browser;
  browser = null;
  if (b) {
    let timer;
    const guard = new Promise((r) => { timer = setTimeout(() => { console.warn('  ! teardown: browser.close() passed its bound; continuing'); r(); }, 8000); timer.unref(); });
    try { await Promise.race([b.close(), guard]); } catch (e) { console.warn(`  ! teardown: ${e.message}`); }
    clearTimeout(timer);
  }
});

if (standalone) {
  const { runAll, tests } = await import('./harness.js');
  const CLOSE = 'layout: close the browser';
  // Runs once, after every test below is registered (a test registered later would escape the split, the cap and the ▶ marker).
  const applyShard = () => {
  tests.push(...tests.splice(tests.findIndex((t) => t.name === CLOSE), 1)); // closing the browser is always last
  if (arg('grep')) { // --grep=goal date → only tests whose name contains it (plus closing the browser)
    const keep = tests.filter((t) => t.name.includes(arg('grep')) || t.name === 'layout: close the browser');
    tests.splice(0, tests.length, ...keep);
  }
  const shard = (arg('shard') || '').split('/').map(Number); // --shard=2/6 → the second of six cost-balanced groups
  if (shard.length === 2) {
    const only = arg('only');
    if (only) {
      const keep = tests.filter((t) => t.name.includes(only) || t.name === CLOSE);
      tests.splice(0, tests.length, ...keep);
    } else {
      // Bin-pack by estimated cost (renders): a route group costs its size count, anything else ~3. Every shard computes the same split.
      const cost = (t) => { const m = /\(sizes (\d+)\/(\d+)\)/.exec(t.name); return m ? (Number(m[1]) < Number(m[2]) ? CHUNK : CASES.length - CHUNK * (Number(m[2]) - 1)) : /Body profile shows/.test(t.name) ? 9 : /Train Switch/.test(t.name) ? 12 : /Past days/.test(t.name) ? 10 : 3; };
      const bins = Array.from({ length: shard[1] }, () => ({ load: 0, names: new Set() }));
      tests.filter((t) => t.name !== CLOSE).map((t, i) => ({ t, i, c: cost(t) })).sort((a, b) => b.c - a.c || a.i - b.i).forEach(({ t, c }) => {
        const bin = bins.reduce((lo, b) => (b.load < lo.load ? b : lo));
        bin.load += c; bin.names.add(t);
      });
      const mine = bins[shard[0] - 1].names;
      const keep = tests.filter((t) => mine.has(t) || t.name === CLOSE);
      tests.splice(0, tests.length, ...keep);
    }
    // Cap each test and say which one hung (a stuck Chromium used to take the whole shard down with a silent SIGKILL).
    const PER_TEST_MS = Number(process.env.LAYOUT_TEST_MS) || 300000; // the slowest single test (the Change toast probes) needs ~3 minutes; the shard cap is 9
    for (const t of tests) {
      const fn = t.fn;
      t.fn = async () => {
        console.log(`  ▶ ${t.name}`);
        let timer;
        const t0 = Date.now();
        try {
          await Promise.race([fn(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`HUNG: "${t.name}" took over ${PER_TEST_MS / 1000}s`)), PER_TEST_MS); })]);
        } finally { clearTimeout(timer); console.log(`    (${Math.round((Date.now() - t0) / 1000)}s)`); }
      };
    }
  }
  if (tests.at(-1).name !== CLOSE) throw new Error(`"${CLOSE}" must be the last test, found "${tests.at(-1).name}"`);
  Object.freeze(tests); // a test() registered after the split now throws instead of silently running in every shard
  };
  test('layout: Train Switch: the card head, chips, Switch sheet steps and scratch builder fit at every size', async () => {
    if (skipReason()) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const found = new Map();
    const note = (msg, at) => found.set(msg, [...(found.get(msg) || []), at]);
    const saved = [
      { id: 'sw1', name: 'Push day', items: [{ exercise_id: 'db_bench_press', sets: 3, reps_lo: 8, reps_hi: 10 }, { exercise_id: 'pushup', sets: 2, reps_lo: 10, reps_hi: 12 }] },
      { id: 'sw2', name: 'Pull day', items: [{ exercise_id: 'db_bent_row', sets: 3, reps_lo: 8, reps_hi: 10 }] },
      { id: 'sw3', name: 'A forty character workout name here!!', items: [{ exercise_id: 'pushup', sets: 3, reps_lo: 10, reps_hi: 12 }] },
    ];
    const sizes = [[390, 844, true, 1], [390, 844, false, 1], [320, 568, true, 1.6], [678, 466, true, 1], [626, 890, true, 1], [932, 430, true, 1]];
    const sh = "document.querySelector('dialog.sheet ";
    for (const [w, h, dark, ts] of sizes) {
      await browser.viewport(w, h, dark);
      for (const variant of ['two', 'one-long']) {
        const data = seed({ long: variant === 'one-long' });
        data.settings[0].saved_workouts = saved;
        if (variant === 'one-long') data.locations = data.locations.slice(0, 1);
        await browser.open('train', data);
        if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await wait(300); }
        const at = `${w}x${h}${dark ? 'd' : 'l'}${ts !== 1 ? 't' : ''} ${variant}`;
        const shot = async (name) => { if (shots) await browser.screenshot(`${shots}/switch-${name}-${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? '-text' : ''}-${variant}.png`); };
        const card = async (label) => {
          const r = await browser.eval(`(() => {
            const hd = document.querySelector('.pv-head'); if (!hd) return null;
            const t = hd.querySelector('.big-title').getBoundingClientRect();
            const bs = [...hd.querySelectorAll('[data-switch],[data-change]')]; const rects = bs.map((b) => b.getBoundingClientRect());
            const lines = (b) => { const tops = new Set(); for (const n of b.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { const g = document.createRange(); g.selectNodeContents(n); [...g.getClientRects()].forEach((q) => tops.add(Math.round(q.top / 4))); } return tops.size; };
            const chips = [...document.querySelectorAll('.pv-ctl .pv-chip')].map((c) => { const q = c.getBoundingClientRect(); return { h: q.height, clip: c.scrollWidth > c.clientWidth + 1, right: q.right, dis: c.disabled, len: !!c.closest('.pv-len') }; });
            return { overlap: rects.some((q) => t.right > q.left + 1 && t.left < q.right && t.bottom > q.top + 1 && t.top < q.bottom), wrap: bs.some((b) => lines(b) > 1), btnH: Math.min(...rects.map((q) => q.height)), chips, scrollW: document.documentElement.scrollWidth, innerW: innerWidth };
          })()`);
          if (!r) { note(`${label}: no card head`, at); return null; }
          if (r.overlap) note(`${label}: the title overlaps Switch/Change`, at);
          if (r.wrap) note(`${label}: Switch or Change wraps`, at);
          if (r.btnH < 44) note(`${label}: Switch/Change is ${r.btnH}px tall`, at);
          if (!r.chips.length) note(`${label}: no chips`, at);
          if (r.chips.some((c) => c.h < 44)) note(`${label}: a chip is under 44px tall`, at);
          if (r.chips.some((c) => c.clip || c.right > r.innerW + 1)) note(`${label}: a chip clips or runs off-screen`, at);
          if (r.scrollW > r.innerW + 1) note(`${label}: horizontal overflow`, at);
          return r;
        };
        const tap = async (...sels) => {
          for (const sel of sels) {
            const ok = await browser.eval('(() => { const e = document.querySelector(' + JSON.stringify(sel) + '); if (!e) return false; e.click(); return true; })()');
            if (!ok) note('missing ' + sel + ' (sheet: ' + (await browser.eval("(document.querySelector('dialog.sheet h2') || {}).textContent")) + ')', at);
            await wait(450);
          }
        };
        const sheet = async (label, taps, primary) => {
          if (taps) await tap(...taps);
          if (!(await browser.eval("!!document.querySelector('dialog.sheet[open]')"))) { note(`${label}: sheet is not open`, at); return; }
          await browser.eval("['main', 'nav', 'navbar'].forEach((id) => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; })");
          for (const pr of await browser.eval(`(${detect})(${JSON.stringify({ largeText: ts !== 1 })})`)) note(`${label}: ${pr}`, at);
          if (primary) {
            const reach = await browser.eval(`(() => { const b = document.querySelector('dialog.sheet ${primary}'); if (!b) return null; b.scrollIntoView({ block: 'nearest' }); const q = b.getBoundingClientRect(); return { inView: q.top >= 0 && q.bottom <= innerHeight + 1, h: q.height }; })()`);
            if (!reach) note(`${label}: no ${primary} button`, at);
            else if (!reach.inView || reach.h < 44) note(`${label}: ${primary} is not reachable (${JSON.stringify(reach)})`, at);
          }
          if (await browser.eval('document.documentElement.scrollWidth > innerWidth + 1')) note(`${label}: horizontal overflow`, at);
          await shot(label);
          await browser.eval("['main', 'nav', 'navbar'].forEach((id) => { const e = document.getElementById(id); if (e) e.style.visibility = ''; })");
        };
        const showCard = async () => {
          await browser.eval("(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); const hd = document.querySelector('.pv-head'); if (hd) hd.scrollIntoView({ block: 'center' }); })()");
          await wait(300);
        };
        const c1 = await card('card');
        if (c1 && variant === 'one-long' && c1.chips.some((c) => !c.len)) note('card: the location chip shows with one place', at);
        if (c1 && variant === 'two' && !c1.chips.some((c) => !c.len)) note('card: no location chip with two places', at);
        await showCard();
        await shot('card');
        await sheet('home', ['[data-switch]'], null);
        await sheet('muscles', ['dialog.sheet [data-o=muscles]'], '[data-build]');
        await browser.eval("['chest', 'arms', 'back', 'legs'].forEach((k) => { const b = document.querySelector('dialog.sheet input[value=' + k + ']'); b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); })");
        await sheet('muscles4', null, '[data-build]');
        const chipH = await browser.eval("[...document.querySelectorAll('dialog.sheet .chip')].map((c) => c.getBoundingClientRect().height)");
        if (chipH.some((x) => x < 44)) note('muscles: a muscle chip is under 44px', at);
        await sheet('saved', ['dialog.sheet [data-back]', 'dialog.sheet [data-o=saved]'], '.saved-go');
        await sheet('name', ['dialog.sheet [data-back]', 'dialog.sheet [data-o=save-now]'], '[data-save]');
        // start the 40-character saved workout: the card keeps its title clear of the buttons and the length chips go quiet
        await tap('dialog.sheet [data-back]', 'dialog.sheet [data-o=saved]', 'dialog.sheet [data-use="sw3"]');
        await wait(300);
        await card('fixed card');
        const lens = await browser.eval("[...document.querySelectorAll('.pv-len .pv-chip')].map((c) => c.disabled)");
        if (!lens.length || lens.some((d) => !d)) note('fixed card: the length chips are not disabled for a saved workout', at);
        await showCard();
        await shot('fixed');
        // scratch builder with three rows, one timed
        await tap('[data-switch]', 'dialog.sheet [data-o=scratch]');
        await browser.eval("document.querySelectorAll('.toast').forEach((t) => t.remove())");
        for (const [id, q] of [[null, 'squat'], ['pushup', 'push-up'], ['plank', 'plank']]) {
          await tap('dialog.sheet [data-add]');
          await browser.eval(`(() => { const i = document.querySelector('dialog.sheet [data-q]'); if (i) { i.value = '${q}'; i.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
          await wait(300);
          await tap(id ? `dialog.sheet li[data-id="${id}"]` : 'dialog.sheet [data-list] li[data-id]');
        }
        const rows = await browser.eval("document.querySelectorAll('dialog.sheet .scratch-row').length");
        if (rows !== 3) note(`scratch: expected 3 rows, found ${rows}`, at);
        const btns = await browser.eval("[...document.querySelectorAll('dialog.sheet .scratch-step .icon-btn')].map((b) => { const q = b.getBoundingClientRect(); return Math.min(q.width, q.height); })");
        if (btns.some((x) => x < 44)) note('scratch: a stepper button is under 44px', at);
        const sr = await browser.eval(`[...document.querySelectorAll('dialog.sheet .scratch-row')].map((row) => {
          const nm = row.querySelector('.scratch-name'); const rm = nm.querySelector('.icon-btn').getBoundingClientRect(); const b0 = nm.querySelector('b').getBoundingClientRect();
          const rq = row.getBoundingClientRect();
          const grps = [...row.querySelectorAll('.scratch-step .scratch-grp')].map((g) => { const t = [...g.querySelectorAll('.icon-btn, b')].map((e) => { const q = e.getBoundingClientRect(); return q.top + q.height / 2; }); return Math.max(...t) - Math.min(...t); });
          return { grpSpread: Math.max(...grps), rmOff: Math.abs(rm.top + rm.height / 2 - (b0.top + b0.height / 2)), h: rq.height, single: b0.height < 30 * ${ts} };
        })`);
        const inRow = await browser.eval("[...document.querySelectorAll('dialog.sheet .scratch-row')].every((row) => { const r = row.getBoundingClientRect(); return [...row.querySelectorAll('.scratch-step .icon-btn')].every((b) => { const q = b.getBoundingClientRect(); return q.left >= r.left - 0.5 && q.right <= r.right + 0.5; }); })");
        if (!inRow) note('scratch: a stepper button sits outside its row', at);
        if (sr.some((x) => x.grpSpread > 4)) note('scratch: a − / value / + trio is split across lines', at);
        if (sr.some((x) => x.single && x.rmOff > 24)) note('scratch: the remove button is not on the name line', at);
        if (ts === 1 && w === 390 && sr.some((x) => x.h > 3 * 44 + 48)) note('scratch: a row is taller than 3 x 44px plus gaps', at);
        await sheet('scratch', null, '[data-use]');
      }
    }
    assert(found.size === 0, `\n        ${[...found].map(([p, at]) => `${p}  [${at.join(' ')}]`).join('\n        ')}`);
  });
  test('layout: Past days list and day detail fit at phone, 320 large text and Duo sizes', async () => {
    if (skipReason() || (only && !only.includes('days'))) return;
    browser = browser || await launch();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const found = new Map();
    const note = (msg, at) => found.set(msg, [...(found.get(msg) || []), at]);
    const sizes = [[390, 844, true, 1], [390, 844, false, 1], [320, 568, true, 1.6], [466, 678, true, 1], [678, 466, true, 1], [626, 890, true, 1], [890, 626, false, 1]];
    const views = [['awards', 'strip'], ['days', 'list'], ['days/2026-10-10', 'full'], ['days/2026-10-07', 'partial'], ['days/2026-08-01', 'empty'], ['days/2026-10-12', 'today']];
    for (const [w, h, dark, ts] of sizes) {
      await browser.viewport(w, h, dark);
      for (const [route, name] of views) {
        const data = seed({});
        if (name === 'full') { // 8 entries across meals, so the Food card is tested long
          const base = data.food_logs[0];
          ['breakfast', 'breakfast', 'lunch', 'lunch', 'dinner', 'snack', 'snack', 'snack'].forEach((meal, k) => data.food_logs.push({ ...base, id: `dd${k}`, day: '2026-10-10', meal, name: k === 2 ? 'Chicken burrito bowl with extra black beans and rice' : `Entry ${k + 1}`, kcal: 150 + k * 40, servings: k % 3 ? 1 : 1.5, logged_at: new Date(`2026-10-10T${String(7 + k).padStart(2, '0')}:00:00`).toISOString() }));
        }
        await browser.open(route, data);
        if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await wait(300); }
        const at = `${w}x${h}${dark ? 'd' : 'l'}${ts !== 1 ? 't' : ''} ${name}`;
        if (name === 'strip') await browser.eval("document.querySelector('.ms-week').scrollIntoView({ block: 'center' })");
        const probs = await browser.eval(`(${detect})(${JSON.stringify({ largeText: ts !== 1 })})`);
        for (const p of name === 'strip' ? probs.filter((x) => /ms-week|ms-dot|ms-past/.test(x)) : probs) note(p, at); // the badge grid below the strip is not part of this change
        const chk = await browser.eval(`(() => {
          const words = [];
          document.querySelectorAll('.dd-title h2').forEach((h) => { const n = h.firstChild; const re = /\\S+/g; let m; while ((m = re.exec(n.textContent))) { const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length); words.push([...new Set([...rg.getClientRects()].map((q) => Math.round(q.top / 4)))].length); } });
          const dots = [...document.querySelectorAll('.dd-link .ms-dot i')].map((i) => { const q = i.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; });
          const rowTops = {}; document.querySelectorAll('.ms-week .ms-dot a').forEach((a) => { const t = Math.round(a.getBoundingClientRect().top); rowTops[t] = (rowTops[t] || 0) + 1; });
          return { split: words.filter((n) => n > 1).length, dots, states: ['all', 'some', 'none'].filter((s) => document.querySelector('.dd-link .ms-dot.' + s)), rows: Object.values(rowTops), food: document.querySelectorAll('.dd-item').length, foodRing: document.querySelectorAll('.dd-food .ms-ring, .dd-food .ms-check').length };
        })()`);
        if (chk.split) note('a word in the day title is split across lines', at);
        if (name === 'list') {
          if (!chk.dots.length || chk.dots.some(([dw, dh]) => dw !== 22 || dh !== 22)) note(`list status dots are not all 22x22: ${JSON.stringify(chk.dots.slice(0, 3))}`, at);
          if (chk.states.length < 2) note(`list shows only these dot states: ${chk.states}`, at);
        }
        if (name === 'strip' && !(chk.rows.length === 1 || (chk.rows.length === 2 && chk.rows[0] >= chk.rows[1] && chk.rows[0] - chk.rows[1] <= 1))) note(`week strip rows are unbalanced: ${chk.rows}`, at);
        if (name === 'full' && chk.food < 8) note(`food entries shown: ${chk.food}`, at);
        if (chk.foodRing) note('Food card has a mission ring or check', at);
        const r = await browser.eval(`(() => ({
          rows: document.querySelectorAll('.dd-row').length, links: document.querySelectorAll('.dd-link').length, strip: document.querySelectorAll('.ms-dot a').length,
          small: [...document.querySelectorAll('.dd-arrow:not(.off), .dd-link, .ms-dot a, .ms-past, .dd-today')].filter((e) => { const q = e.getBoundingClientRect(); return q.height < 44 || (!e.classList.contains('dd-link') && q.width < 44); }).length,
          text: document.querySelector('#main').textContent, scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
        }))()`);
        if (r.scrollW > r.innerW + 1) note('horizontal overflow', at);
        if (r.small) note(`${r.small} tap target(s) under 44px`, at);
        if (name === 'strip' && r.strip !== 7) note(`week strip links: ${r.strip}`, at);
        if (name === 'list' && r.links < 5) note(`past days rows: ${r.links}`, at);
        if (['full', 'partial', 'today'].includes(name) && r.rows < 2) note(`day rows: ${r.rows}`, at);
        if (name === 'empty' && !r.text.includes('Nothing logged')) note('empty day does not say Nothing logged', at);
        if (shots) await browser.screenshot(`${shots}/days-${name}-${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? '-text' : ''}.png`);
      }
    }
    assert(found.size === 0, `\n        ${[...found].map(([p, at]) => `${p}  [${at.join(' ')}]`).join('\n        ')}`);
  });
  // Loading skeletons (v0.16.82, #233). The slow-data fixture (window.__HOLD) keeps every snapshot back, so each screen is
  // checked in its loading state: a busy status region, no shimmer (Reduce Motion), nothing overflowing, nothing tappable. Then
  // the data lands and the page's first block must not move more than 8px, nor the column change width.
  const SK_ROUTES = ['today', 'trends', 'weekly', 'score', 'progress', 'history', 'photos', 'body', 'awards', 'report', 'withings', 'library', 'coach'];
  const SK_SIZES = [[390, 844, true, 1], [390, 844, false, 1], [466, 678, true, 1], [678, 466, false, 1], [626, 890, true, 1], [890, 626, false, 1], [320, 568, true, 1.6]];
  for (const route of SK_ROUTES) {
    if (only && !only.includes(route)) continue;
    test(`layout: ${route}: the loading skeleton fits, is busy and static, and does not jump when data lands`, async () => {
      if (skipReason()) return;
      browser = browser || await launch();
      const found = [];
      for (const [w, h, dark, ts] of SK_SIZES) {
        const tag = `${w}x${h}-${dark ? 'dark' : 'light'}${ts !== 1 ? '-text160' : ''}`;
        await browser.viewport(w, h, dark);
        await browser.open(route, seed({ comp: route === 'body' }), 'window.__HOLD = true;', { loading: true });
        if (ts !== 1) { await browser.eval(`document.documentElement.style.setProperty('--ts', '${ts}')`); await new Promise((r) => setTimeout(r, 300)); }
        const probe = `(() => { const m = document.querySelector('#main'); if (!m) return { skel: false, top: -1, width: 0 }; const s = m.querySelector('.skel-screen'); const f = m.firstElementChild; const r = f ? f.getBoundingClientRect() : null;
          return { skel: !!s, busy: s ? s.getAttribute('aria-busy') : null, role: s ? s.getAttribute('role') : null, anim: s ? getComputedStyle(s.querySelector('.skeleton')).animationName : '', taps: m.querySelectorAll('a, button, input').length,
            top: r ? Math.round(r.top) : -1, width: m.getBoundingClientRect().width, page: document.documentElement.scrollWidth > innerWidth + 1, over: s ? [...s.querySelectorAll('.skeleton')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length : 0 }; })()`;
        for (let i = 0; i < 30 && !(await browser.eval("!!document.querySelector('#main .skel-screen')")); i++) await new Promise((r) => setTimeout(r, 100));
        const a = await browser.eval(probe);
        if (shots) await browser.screenshot(`${shots}/skeleton-${route}-${tag}.png`);
        if (!a.skel) found.push(`${tag}: no skeleton while loading`);
        else {
          if (a.busy !== 'true' || a.role !== 'status') found.push(`${tag}: skeleton is not a busy status region (${a.busy}/${a.role})`);
          if (a.anim !== 'none') found.push(`${tag}: skeleton still shimmers under Reduce Motion (${a.anim})`);
          if (a.taps) found.push(`${tag}: skeleton holds ${a.taps} tappable element(s)`);
          if (a.page || a.over) found.push(`${tag}: skeleton overflows`);
        }
        await browser.eval('window.__HOLD = false; (window.__held || []).forEach((f) => f())');
        for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 100)); if (await browser.eval("!document.querySelector('#main .skeleton') && document.querySelector('#main').children.length > 0")) break; }
        await new Promise((r) => setTimeout(r, 500));
        const b = await browser.eval(probe);
        if (b.skel) found.push(`${tag}: skeleton never gave way to the screen`);
        else if (route !== 'progress' && a.skel) {
          if (Math.abs(b.top - a.top) > 8) found.push(`${tag}: first block jumped ${b.top - a.top}px when data landed`);
          if (Math.abs(b.width - a.width) > 8) found.push(`${tag}: width changed ${a.width} to ${b.width} when data landed`);
        }
      }
      assert(found.length === 0, `\n        ${found.join('\n        ')}`);
    });
  }
  applyShard();
  const { fail } = await runAll();
  process.exit(fail ? 1 : 0);
}
