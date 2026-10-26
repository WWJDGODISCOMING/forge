// Share image for the workout summary: drawn on-device into a canvas (1080×1350), shared as a PNG with
// the system share sheet where it's supported, otherwise downloaded. Nothing leaves the phone unless you
// share it.

import { bodyMapStandalone } from './bodymap.js';
import { isNative } from '../native/bridge.js';
import { shareNative } from '../native/share.js';

/** No-break spaces after "→" and before a trailing unit, so "→ 212 lb" never splits. Pure; exported for tests. */
export const glue = (text) => String(text).replace(/ → /g, ' →\u00a0').replace(/ (lb|kg|reps|s)(?=$|[\s,.)])/g, '\u00a0$1');

/**
 * Fit one line of text into `max` px on the canvas: shrink the font from `size` down to `min`, then cut with "…".
 * Leaves ctx.font set to the size it used. `keep` characters at the end are never cut (e.g. "· 45 min · 12 sets").
 * Exported for tests (any ctx with font + measureText works).
 */
export function fitText(ctx, text, max, { weight = 700, size = 30, min = 20, family = FONT, keep = 0 } = {}) {
  const s = String(text);
  let px = size;
  for (; px >= min; px -= 2) {
    ctx.font = `${weight} ${px}px ${family}`;
    if (ctx.measureText(s).width <= max) return s;
  }
  ctx.font = `${weight} ${min}px ${family}`;
  const tail = keep ? s.slice(-keep) : '';
  let head = keep ? s.slice(0, -keep) : s;
  while (head.length > 1 && ctx.measureText(`${head}…${tail}`).width > max) head = head.slice(0, -1);
  return `${head.trimEnd()}…${tail}`;
}

const W = 1080;
const H = 1350;
const FONT = '-apple-system, "SF Pro Display", system-ui, "Segoe UI", Roboto, sans-serif';

function loadSvg(svg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * card: { number, date, label, time, sets, volume, unit, totals: [{ label, value, delta }], prs: [{ name, what }] (or label strings), muscles: {muscle: 0..1},
 *         level: { level, name }, streak, xp }
 * Resolves to a PNG Blob.
 */
export async function renderShareCard(card) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  // Background: deep navy with a cyan glow rising from the bottom.
  ctx.fillStyle = '#040B0E';
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H + 120, 40, W / 2, H + 120, 900);
  g.addColorStop(0, '#3EC8F055');
  g.addColorStop(0.5, '#3EC8F014');
  g.addColorStop(1, '#040B0E00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#3EC8F0';
  ctx.font = `900 40px ${FONT}`;
  ctx.fillText('FORGE', 72, 110);
  ctx.fillStyle = '#9AA1AB';
  ctx.font = `600 32px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(card.date, W - 72, 110);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#DADDE4';
  ctx.font = `900 112px ${FONT}`;
  ctx.fillText(`Workout #${card.number}`, 72, 250);
  ctx.fillStyle = '#9AA1AB';
  // Label · time · sets, kept inside the 936 px between the margins: shrinks, then the label is cut (time and sets stay).
  const rest = [card.time, `${card.sets} sets`].filter(Boolean).join(' · ');
  ctx.fillText(fitText(ctx, card.label ? `${card.label} · ${rest}` : rest, W - 144, { weight: 600, size: 38, min: 26, keep: rest.length + 3 }), 72, 308);

  // Stats: up to 2 × 2 tiles (calories, volume, reps, hold time) with the change vs last time; Time and Sets sit in the subtitle.
  const tiles = (card.totals && card.totals.length ? card.totals : [{ label: 'Volume', value: `${card.volume} ${card.unit}`, delta: '' }]).slice(0, 4);
  tiles.forEach((t, i) => {
    const x = 72 + (i % 2) * 476;
    const y = 340 + Math.floor(i / 2) * 180;
    roundRect(ctx, x, y, 460, 164, 32);
    ctx.fillStyle = '#172430';
    ctx.fill();
    ctx.fillStyle = '#9AA1AB';
    const inner = 460 - 64; // tile width minus its padding
    ctx.fillText(fitText(ctx, t.label.toUpperCase(), inner, { weight: 700, size: 28, min: 20 }), x + 32, y + 46);
    ctx.fillStyle = '#DADDE4';
    ctx.fillText(fitText(ctx, t.value, inner, { weight: 900, size: 54, min: 30 }), x + 32, y + 108);
    if (t.delta) {
      ctx.fillStyle = t.delta.startsWith('+') ? '#C6FF3D' : '#9AA1AB';
      ctx.fillText(fitText(ctx, t.delta, inner, { weight: 700, size: 26, min: 18 }), x + 32, y + 144);
    }
  });

  // Muscles worked.
  try {
    const img = await loadSvg(bodyMapStandalone(card.muscles));
    ctx.drawImage(img, 120, 730, 420, 420);
  } catch { /* map is optional */ }
  ctx.fillStyle = '#9AA1AB';
  ctx.font = `700 28px ${FONT}`;
  ctx.fillText('MUSCLES WORKED', 160, 1160);

  // PRs, level, streak.
  let y = 770;
  ctx.font = `800 34px ${FONT}`;
  ctx.fillStyle = '#C6FF3D';
  // Each PR: the exercise (white) over what you beat (gold), each wrapped to the column, never cut mid-word.
  const wrap = (text, max, lines = 2) => {
    const out = [];
    let line = '';
    // Split on plain spaces only; "→ 12" and the final "212 lb" are glued with no-break spaces, so neither a
    // number nor its unit ever sits alone on a line.
    for (const word of glue(text).split(/ +/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= max || !line) line = next;
      else { out.push(line); line = word; }
    }
    if (line) out.push(line);
    if (out.length > lines) {
      out.length = lines;
      let last = out[lines - 1];
      while (ctx.measureText(`${last}…`).width > max && last.includes(' ')) last = last.slice(0, last.lastIndexOf(' '));
      out[lines - 1] = `${last}…`;
    }
    return out;
  };
  // 4+ records: a slightly smaller font and one line each, so three fit before "+N more".
  const tight = card.prs.length >= 4;
  const prs = card.prs.map((p) => (typeof p === 'string' ? { name: '', what: p } : p));
  let shown = 0;
  for (const p of prs) {
    if (y > 960) break; // leave room for the level
    if (p.name) {
      ctx.font = `700 28px ${FONT}`;
      ctx.fillStyle = '#DADDE4';
      for (const l of wrap(p.name, 460, 1)) { ctx.fillText(l, 580, y); y += 36; }
    }
    ctx.font = `800 ${tight ? 28 : 32}px ${FONT}`;
    ctx.fillStyle = '#C6FF3D';
    for (const l of wrap(`🏆 ${p.what}`, 460, tight ? 1 : 2)) { ctx.fillText(l, 580, y); y += tight ? 34 : 40; }
    y += tight ? 12 : 18;
    shown++;
  }
  if (shown < prs.length) {
    ctx.font = `700 28px ${FONT}`;
    ctx.fillStyle = '#9AA1AB';
    ctx.fillText(`+${prs.length - shown} more record${prs.length - shown === 1 ? '' : 's'}`, 580, y);
    y += 40;
  }
  y = Math.max(y + 20, 1000);
  ctx.fillStyle = '#9AA1AB';
  ctx.font = `700 28px ${FONT}`;
  ctx.fillText(`LEVEL ${card.level.level}`, 580, y);
  ctx.fillStyle = '#3EC8F0';
  ctx.font = `900 48px ${FONT}`;
  ctx.fillText(card.level.name, 580, y + 56);
  if (card.streak > 0) {
    ctx.fillStyle = '#DADDE4';
    ctx.font = `800 36px ${FONT}`;
    ctx.fillText(`🔥 ${card.streak}-week streak`, 580, y + 120);
  }
  ctx.fillStyle = '#5c6570';
  ctx.font = `600 26px ${FONT}`;
  ctx.fillText(`+${card.xp} XP`, 72, H - 64);

  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

/** Share the PNG with the system share sheet, or download it where sharing files isn't supported. */
export async function shareImage(blob, name = 'forge-workout.png', title = 'My Forge workout') {
  if (isNative()) return (await shareNative(blob, name, title)) === 'cancelled' ? 'cancelled' : 'shared';
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title });
    return 'shared';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}

/** The share image: 1080×1350, drawn on this phone. */
export async function renderRecapImage(rc, weightText, range, rowText) {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#040B0E';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#3EC8F0';
  ctx.font = `900 40px ${FONT}`;
  ctx.fillText('FORGE', 72, 110);
  ctx.fillStyle = '#9AA1AB';
  ctx.font = `600 32px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(range, W - 72, 110);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#DADDE4';
  ctx.font = `900 96px ${FONT}`;
  ctx.fillText('My week', 72, 240);
  const lines = rc.quiet ? [['Status', 'A quiet week']] : [
    ...(weightText ? [['Weight trend', weightText]] : []),
    ...rc.rows.map((x) => [x.label, rowText(x)]),
    ['Personal records', String(rc.prs || 0)],
  ];
  let y = 340;
  for (const [k, v] of lines.slice(0, 7)) {
    ctx.fillStyle = '#172430';
    ctx.fillRect(72, y - 52, W - 144, 100);
    ctx.fillStyle = '#9AA1AB';
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(k, 100, y + 8);
    ctx.fillStyle = '#DADDE4';
    ctx.font = `800 36px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(v, W - 100, y + 10);
    ctx.textAlign = 'left';
    y += 116;
  }
  ctx.fillStyle = '#C6FF3D';
  ctx.font = `800 32px ${FONT}`;
  ctx.fillText('FOCUS FOR THIS WEEK', 72, 1170);
  ctx.fillStyle = '#DADDE4';
  ctx.font = `700 34px ${FONT}`;
  let line = '';
  let ty = 1220;
  for (const word of rc.tip.text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > W - 144 && line) { ctx.fillText(line, 72, ty); ty += 46; line = word; } else line = next;
  }
  if (line) ctx.fillText(line, 72, ty);
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}
