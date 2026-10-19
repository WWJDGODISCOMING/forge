#!/usr/bin/env node
// Makes the iPhone app's artwork masters in assets/ from the Forge icon (icons/icon-512.png), then
// `npx capacitor-assets generate --ios` turns them into the sizes Xcode wants (npm run native:assets).
//   assets/icon-only.png   1024×1024, no transparency (the App Store icon must be opaque)
//   assets/splash.png      2732×2732, #040B0E with the Forge mark centred (also used in light mode: no white flash)
// The repo only has the icon at 512 px, so the 1024 master is that artwork enlarged (Lanczos). Swap in a native
// 1024 px export of the same artwork at assets/icon-only.png and re-run `npm run native:assets` for a sharper one.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'icons', 'icon-512.png');
const OUT = join(ROOT, 'assets');
const BG = { r: 4, g: 11, b: 14 }; // #040B0E

await mkdir(OUT, { recursive: true });
const icon = await sharp(SRC).resize(1024, 1024, { kernel: 'lanczos3' }).flatten({ background: BG }).png().toBuffer();
await sharp(icon).toFile(join(OUT, 'icon-only.png'));

// The artwork's own background is a hair lighter than #040B0E, so its edge would show as a faint square on the splash:
// fade the mark out with a soft circular mask so it dissolves into the launch colour.
const fade = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720"><defs><radialGradient id="g"><stop offset="0.84" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient></defs><rect width="720" height="720" fill="url(#g)"/></svg>');
const art = await sharp(SRC).resize(720, 720, { kernel: 'lanczos3' }).flatten({ background: BG }).removeAlpha().png().toBuffer();
const alpha = await sharp(fade).greyscale().extractChannel(0).raw().toBuffer();
const mark = await sharp(art).joinChannel(alpha, { raw: { width: 720, height: 720, channels: 1 } }).png().toBuffer();
const splash = await sharp({ create: { width: 2732, height: 2732, channels: 3, background: BG } })
  .composite([{ input: mark, gravity: 'centre' }]).png().toBuffer();
await sharp(splash).toFile(join(OUT, 'splash.png'));
await sharp(splash).toFile(join(OUT, 'splash-dark.png'));
console.log('assets/icon-only.png, splash.png, splash-dark.png written');
