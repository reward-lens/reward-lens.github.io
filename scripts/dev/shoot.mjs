// Usage: node scripts/dev/shoot.mjs <url> <label> [--widths=390,768,1440] [--scene]
// Writes design/dossier/build/<label>/<width>-<theme>.png and prints scrollWidth per width.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [url, label] = process.argv.slice(2);
const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || `=${d}`).split('=').pop();
const widths = arg('widths', '390,768,1440').split(',').map(Number);
const waitScene = process.argv.includes('--scene');
const out = `design/dossier/build/${label}`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/google/chrome/google-chrome',
  args: ['--no-sandbox'],
});

let failed = false;

for (const theme of ['dark', 'light']) {
  for (const width of widths) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: theme,
      // `--scene` and a forced reduced-motion preference are mutually
      // exclusive, and the harness used to request both. Freezing motion is
      // what keeps the visual-diff gate from photographing noise, but the
      // scene treats a reduced-motion reader as one who gets the composed
      // still and never mounts a canvas at all, so `data-scene-ready` could
      // not appear and every --scene shoot silently photographed the fallback
      // while reporting it had waited for the scene.
      reducedMotion: waitScene ? 'no-preference' : 'reduce',
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    await page.evaluate(() => document.fonts.ready);
    if (waitScene) {
      await page.waitForSelector('html[data-scene-ready="true"]', { timeout: 12000 })
        .catch(() => console.warn(`  ${label} ${width} ${theme}: scene not ready, shot the still`));
    }
    await page.waitForTimeout(400);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    const ok = sw <= width;
    if (!ok) failed = true;
    console.log(`${label} ${width} ${theme}: scrollWidth=${sw} ${ok ? 'OK' : '*** OVERFLOW ***'}`);
    await page.screenshot({ path: `${out}/${width}-${theme}.png`, fullPage: true });
    await ctx.close();
  }
}

await browser.close();
if (failed) process.exit(1);
