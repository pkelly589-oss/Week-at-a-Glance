// Turns a week snapshot into the PNG the TRMNL X shows: the shared e-ink
// markup (shared/view.js) is drawn by headless Chrome at 1872 × 1404, then
// reduced to 16 greys, which is what the panel can show.
//
// Requirements doc: E-ink display > Rendering rules; Architecture.
// TRMNL X image limits: PNG or JPEG, 1872 × 1404, at most 750,000 bytes.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { einkDocument, EINK_W, EINK_H } from '../shared/view.js';

export const MAX_BYTES = 750_000;

// The fonts are inlined into the page so the picture never depends on what the
// server has installed. Atkinson Hyperlegible was designed for legibility,
// which suits a display read in passing from a couple of metres away.
const require = createRequire(import.meta.url);
let fontCss;
function fonts() {
  if (fontCss) return fontCss;
  const face = (weight) => {
    const file = require.resolve(`@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-${weight}-normal.woff2`);
    const data = readFileSync(file).toString('base64');
    return `@font-face{font-family:'Atkinson Hyperlegible';font-weight:${weight};font-style:normal;` +
      `src:url(data:font/woff2;base64,${data}) format('woff2');}`;
  };
  fontCss = face(400) + face(700);
  return fontCss;
}

// Chrome comes from @sparticuz/chromium in the cloud. Locally (tests, the
// emulator) set CHROME_PATH to any installed Chrome or Chromium instead.
async function launch() {
  const { default: puppeteer } = await import('puppeteer-core');
  if (process.env.CHROME_PATH) {
    return puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-sandbox'] });
  }
  const { default: chromium } = await import('@sparticuz/chromium');
  return puppeteer.launch({ executablePath: await chromium.executablePath(), headless: true, args: chromium.args });
}

export async function renderPng(snapshot, { today } = {}) {
  const html = einkDocument(snapshot, { fontCss: fonts(), today });
  const browser = await launch();
  let shot;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: EINK_W, height: EINK_H, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    // The page trims overflowing days once the fonts are in (view.js).
    await page.waitForSelector('body[data-ready="1"]', { timeout: 15_000 });
    shot = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: EINK_W, height: EINK_H } });
  } finally {
    await browser.close();
  }
  return toEinkPng(Buffer.from(shot));
}

// 16 greys, no dithering (dithering speckles small text on e-ink).
export async function toEinkPng(png) {
  const out = await sharp(png)
    .resize(EINK_W, EINK_H, { fit: 'fill' })
    .greyscale()
    .png({ palette: true, colours: 16, dither: 0, compressionLevel: 9 })
    .toBuffer();
  if (out.length > MAX_BYTES) throw new Error(`E-ink image is ${out.length} bytes; the TRMNL X limit is ${MAX_BYTES}`);
  return out;
}
