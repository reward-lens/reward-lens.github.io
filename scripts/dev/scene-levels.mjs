/**
 * Measure the room's lit levels against the targets SCENE.md sets.
 *
 * The scene specification's original light intensities were authored under
 * Three's pre-r165 convention and render the room essentially black now. The
 * correction recorded there does not restate the numbers, on the grounds that
 * guessing a replacement is how the first set got written; it states the
 * TARGET instead, measured off the still:
 *
 *   rail and floor      48 to 72 of 255
 *   back wall           20 to 32 of 255
 *   against a --ground  of 6 to 8
 *
 * So this tool exists to tune against that band rather than by eye. It also
 * reports the hero's text-zone backdrops, because the room is now the thing
 * behind the headline and gate 21 measures rendered pixels: a room bright
 * enough to read can be a room too bright to put words on, and both numbers
 * have to be looked at together.
 *
 * Usage: node scripts/dev/scene-levels.mjs [url]
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pixelStats, ROOT } from "../checks/_lib.mjs";

const URL = process.argv[2] ?? "http://localhost:4399/";
const VIEWPORT = { width: 1440, height: 900 };

/**
 * Sample boxes, in viewport pixels at 1440x900. Each is a patch of one
 * surface, chosen to sit well inside it so a sample never straddles two
 * materials and reports their average as if it were a reading.
 */
const PATCHES = [
  { id: "back-wall", clip: { x: 1040, y: 240, width: 260, height: 110 }, lo: 20, hi: 32 },
  { id: "rail-top", clip: { x: 620, y: 626, width: 300, height: 8 }, lo: 48, hi: 72 },
  { id: "floor", clip: { x: 560, y: 745, width: 320, height: 70 }, lo: 48, hi: 72 },
];

const zones = JSON.parse(
  readFileSync(join(ROOT, "src", "components", "home", "hero-zones.json"), "utf8"),
);

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/google-chrome" });
const page = await browser.newPage({ viewport: VIEWPORT });
await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
await page
  .waitForFunction(() => document.documentElement.getAttribute("data-scene-ready") === "true", {
    timeout: 15000,
  })
  .catch(() => console.log("  (scene never reported ready; measuring whatever is on screen)"));
await page.waitForTimeout(1200);

console.log(`\nSURFACE LEVELS  (target band from SCENE.md's correction)\n`);
const results = [];
for (const p of PATCHES) {
  const buf = await page.screenshot({ clip: p.clip });
  const s = await pixelStats(page, buf);
  // Report in 0-255 encoded terms, which is how the target is written.
  const enc = Math.round(Math.pow(s.mean, 1 / 2.2) * 255);
  const ok = enc >= p.lo && enc <= p.hi;
  results.push({ id: p.id, enc, ok });
  console.log(
    `  ${p.id.padEnd(12)} ${String(enc).padStart(3)} / 255   target ${p.lo}-${p.hi}   ${ok ? "in band" : "OUT OF BAND"}`,
  );
}

console.log(`\nTEXT ZONE BACKDROPS  (gate 21 ceilings: mean ${zones.ceilings.meanLinearLuminance}, p95 ${zones.ceilings.p95PixelLuminance})\n`);
for (const zone of zones.zones) {
  // Hide the zone's own element so the reading is the backdrop, not the glyphs.
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.style.visibility = "hidden";
  }, zone.selector);
  const clip = {
    x: Math.round(zone.x * VIEWPORT.width),
    y: Math.round(zone.y * VIEWPORT.height),
    width: Math.round(zone.w * VIEWPORT.width),
    height: Math.round(zone.h * VIEWPORT.height),
  };
  const buf = await page.screenshot({ clip });
  const s = await pixelStats(page, buf);
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.style.visibility = "";
  }, zone.selector);
  const meanOk = s.mean <= zones.ceilings.meanLinearLuminance;
  const p95Ok = s.p95 <= zones.ceilings.p95PixelLuminance;
  console.log(
    `  ${zone.id.padEnd(15)} mean ${s.mean.toFixed(4)} ${meanOk ? "ok " : "OVER"}   p95 ${s.p95.toFixed(4)} ${p95Ok ? "ok" : "OVER"}`,
  );
}

console.log("");
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
