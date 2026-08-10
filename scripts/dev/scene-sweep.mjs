/**
 * Sweep the room's exposure, and now its tone mapping operator, in one page load.
 *
 * Tuning a lit scene by rebuilding the site once per candidate value is slow
 * enough that it encourages guessing, which is how the original intensities got
 * written. The scene publishes its renderer on `window.__scene`, so the whole
 * sweep runs against a single live page and reports the band each value lands in.
 *
 * EXTENDED for the render pipeline: the operator is now a second axis. Three's
 * ACES, AgX and Khronos-neutral curves behave very differently on a near-black
 * room with one bright beam, and the choice between them cannot be made from the
 * numbers alone, so `--shots` writes a frame per cell to be looked at. The
 * numbers say which cells are in band; the eye picks between the cells that are.
 *
 * The pipeline's own handle (`window.__pipeline`) is preferred when present
 * because it can switch the operator and the environment intensity as well;
 * `window.__scene` remains the fallback so this still runs against a build
 * without the pipeline.
 *
 * Usage:
 *   node scripts/dev/scene-sweep.mjs [url] [exposures] [--ops=aces,agx,neutral]
 *                                    [--shots=DIR] [--theme=dark|light] [--env=1.0]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { pixelStats } from "../checks/_lib.mjs";

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flag = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=").slice(1).join("=") : d;
};

const URL = positional[0] ?? "http://localhost:4399/";
const VALUES = (positional[1] ?? "1.2,1.6,2.0,2.4,2.8,3.2").split(",").map(Number);
const OPS = flag("ops", "").split(",").filter(Boolean);
const SHOTS = flag("shots", "");
const THEME = flag("theme", "dark");
const ENV = flag("env", "");

/**
 * Sample boxes, in viewport pixels at 1440x900.
 *
 * THESE ARE NOW THE SAME BOXES `scene-levels.mjs` USES, AND THEY WERE NOT.
 * This file carried its own set, and its `rail-top` box sampled y 606 to 616
 * while the rail renders at about y 630, so it was reading the dark wall just
 * above the rail and reporting it as the rail. Two tools measuring the same
 * three surfaces disagreed by twenty-five levels, and the one with the wrong
 * boxes is the one that gets used for tuning, so every value it produced was
 * pulling the lighting the wrong way. Sampling geometry belongs in one place.
 */
const PATCHES = [
  { id: "back-wall", clip: { x: 1040, y: 240, width: 260, height: 110 }, lo: 20, hi: 32 },
  /**
   * The rail's two faces, measured apart, because the difference between them is
   * the reading that says "machined bar" rather than "light band". A horizontal
   * face takes the key at cosine 0.94; a vertical one takes it at 0.04 and is lit
   * almost entirely by the environment. In reference photography that gap is
   * large. Measured here at row resolution: the rail occupies y 628 to 666, its
   * top face and channel y 630 to 638, its side face a flat y 642 to 662.
   *
   * `rail-top` deliberately no longer starts at 626. It did, and rows 626 to 628
   * are the dark wall above the rail, so the patch averaged two surfaces and
   * reported the result as the rail.
   */
  { id: "rail-top", clip: { x: 620, y: 630, width: 300, height: 7 }, lo: 48, hi: 72 },
  { id: "rail-side", clip: { x: 620, y: 644, width: 300, height: 18 }, lo: 20, hi: 44 },
  { id: "floor", clip: { x: 560, y: 745, width: 320, height: 70 }, lo: 48, hi: 72 },
];

if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/opt/google/chrome/google-chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), THEME);
await page.waitForFunction(
  () => document.documentElement.getAttribute("data-scene-ready") === "true",
  { timeout: 20000 },
);

const handles = await page.evaluate(() => ({
  pipeline: Boolean(window.__pipeline),
  scene: Boolean(window.__scene),
}));
if (!handles.pipeline && !handles.scene) {
  console.error("scene-sweep: neither window.__pipeline nor window.__scene mounted.");
  await browser.close();
  process.exit(1);
}
if (!handles.pipeline && OPS.length) {
  console.error("scene-sweep: --ops needs window.__pipeline, which this build does not publish.");
  await browser.close();
  process.exit(1);
}

if (ENV && handles.pipeline) {
  await page.evaluate((v) => window.__pipeline.setEnvironmentIntensity(v), Number(ENV));
}

/**
 * `--dither=0` is how the banding evidence is produced. The dither is the last
 * pass and the only thing standing between the dark falloff and visible contour
 * lines, so switching it off on a live page gives a before and after of the same
 * frame, rather than a before from a different build.
 */
const DITHER = flag("dither", "");
if (DITHER && handles.pipeline) {
  await page.evaluate((v) => window.__pipeline.setDither(v), Number(DITHER));
}

/**
 * `--off=GTAOPass` switches a pass off on the live page, which is how the
 * grounding evidence is produced: the same frame with and without ambient
 * occlusion, rather than two builds that differ in more than one thing.
 */
const OFF = flag("off", "").split(",").filter(Boolean);
for (const name of OFF) {
  const ok = await page.evaluate((n) => window.__pipeline.setPass(n, false), name);
  if (!ok) console.log(`  (no pass named ${name} in this tier's chain)`);
}

if (handles.pipeline) {
  const s = await page.evaluate(() => window.__pipeline.read());
  const env = s.environment;
  console.log(
    `\n  tier ${s.tier}, operator ${s.operator}, environment ` +
      (env
        ? `present: ${env.emitters} emitters, ${(env.bytes / 1048576).toFixed(2)} MB, ${env.ms.toFixed(1)} ms, intensity ${env.intensity}`
        : "ABSENT"),
  );
  console.log(`  lights: ${s.lights.join(", ") || "none"}`);
  console.log(`  passes: ${s.passes.join(" -> ") || "no composer"}`);
  const hemi = s.lights.filter((n) => n.startsWith("HemisphereLight")).length;
  if (hemi > 0) console.log(`  *** ${hemi} hemisphere light(s) present; INTERFACES.md §2 forbids them`);
}

/** One row of patch readings at the renderer's current settings. */
async function readRow() {
  const row = [];
  for (const p of PATCHES) {
    const buf = await page.screenshot({ clip: p.clip });
    const s = await pixelStats(page, buf);
    const enc = Math.round(Math.pow(s.mean, 1 / 2.2) * 255);
    row.push({ enc, ok: enc >= p.lo && enc <= p.hi });
  }
  return row;
}

for (const op of OPS.length ? OPS : [null]) {
  if (op) await page.evaluate((o) => window.__pipeline.setToneMapping(o), op);
  console.log(`\n${op ? `  operator: ${op}` : ""}`);
  console.log("\n exposure   " + PATCHES.map((p) => `${p.id}(${p.lo}-${p.hi})`).join("   ") + "\n");

  for (const v of VALUES) {
    await page.evaluate((x) => {
      if (window.__pipeline) window.__pipeline.setExposure(x);
      else window.__scene.setExposure(x);
    }, v);
    await page.waitForTimeout(350);

    const row = await readRow();
    const cells = row.map((r) => `${String(r.enc).padStart(3)}${r.ok ? " *" : "  "}`).join("        ");
    console.log(`  ${v.toFixed(2).padStart(5)}        ${cells}`);

    if (SHOTS) {
      const name = `${op ?? "current"}-e${v.toFixed(2)}-${THEME}.png`;
      await page.screenshot({
        path: `${SHOTS}/${name}`,
        clip: { x: 0, y: 0, width: 1440, height: 900 },
      });
    }
  }
}

// Landmarks, which is the other half of what the handle exists for.
if (handles.scene) {
  const lm = await page.evaluate(() => window.__scene.landmarks());
  console.log(
    `\n  landmarks: beamAxis ${lm.beamAxis.toFixed(1)}px, prismCentroid [${lm.prismCentroid
      .map((n) => n.toFixed(1))
      .join(", ")}]`,
  );
}
console.log("  (* = inside the target band)\n");
await browser.close();
