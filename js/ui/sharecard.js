// Share image for the workout summary: drawn on-device into a canvas (1080×1350), shared as a PNG with
// the system share sheet where it's supported, otherwise downloaded. Nothing leaves the phone unless you
// share it.

import { bodyMapStandalone } from './bodymap.js';
import { isNative } from '../native/bridge.js';
import { shareNative } from '../native/share.js';

/** No-break spaces after "→" and before a trailing unit, so "→ 212 lb" never splits. Pure; exported for tests. */
export const glue = (text) => String(text).replace(/ → /g, ' →\u00a0').replace(/ (lb|kg|reps|s)(?=$|[\s,.)])/g, '\u00a0$1');

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
 * card: { number, date, label, time, sets, volume, unit, prs: [{ name, what }] (or label strings), muscles: {muscle: 0..1},
 *         level: { level, name }, streak, xp }
 * Resolves to a PNG Blob.
 */
export async function renderShareCard(card) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  // Background: deep navy with an cyan glow rising from the bottom.
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
  if (card.label) {
    ctx.fillStyle = '#9AA1AB';
    ctx.font = `600 38px ${FONT}`;
    ctx.fillText(card.label, 72, 308);
  }

  // Stats: 2 × 2 tiles.
  const tiles = [['Time', card.time], ['Sets', String(card.sets)], ['Volume', `${card.volume} ${card.unit}`], ['Records', `🏆 ${card.prs.length}`]];
  tiles.forEach(([k, v], i) => {
    const x = 72 + (i % 2) * 476;
    const y = 360 + Math.floor(i / 2) * 170;
    roundRect(ctx, x, y, 460, 150, 32);
    ctx.fillStyle = i === 3 && card.prs.length ? 'rgba(198,255,61,.14)' : '#172430';
    ctx.fill();
    ctx.fillStyle = '#9AA1AB';
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(k.toUpperCase(), x + 32, y + 52);
    ctx.fillStyle = i === 3 && card.prs.length ? '#C6FF3D' : '#DADDE4';
    ctx.font = `900 60px ${FONT}`;
    ctx.fillText(v, x + 32, y + 120);
  });

  // Muscles worked.
  try {
    const img = await loadSvg(bodyMapStandalone(card.muscles));
    ctx.drawImage(img, 120, 715, 420, 420);
  } catch { /* map is optional */ }
  ctx.fillStyle = '#9AA1AB';
  ctx.font = `700 28px ${FONT}`;
  ctx.fillText('MUSCLES WORKED', 160, 1160);

  // PRs, level, streak.
  let y = 760;
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
export async function shareImage(blob, name = 'forge-workout.png') {
  if (isNative()) return (await shareNative(blob, name, 'My Forge workout')) === 'cancelled' ? 'cancelled' : 'shared';
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: 'My Forge workout' });
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
