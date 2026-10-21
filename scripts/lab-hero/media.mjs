// Regenerate the pocket-lab hero's posters and fallback clips from the live
// room, so the still a reader sees before WebGL is ready, and the clip a
// software renderer gets, match the lighting the live room renders.
//
// Ported from the lagoon candidate's scripts/pocket-lab/media.mjs. It needs a
// capture build served on loopback:
//
//   PUBLIC_INSTRUMENT_CAPTURE=test npx astro build --outDir dist-capture
//   npx astro preview --outDir dist-capture --host 127.0.0.1 --port 4412
//   node scripts/lab-hero/media.mjs http://127.0.0.1:4412 <work-dir>
//
// It writes public/lagoon/{poster-*.webp,room-*.mp4,fallback.json,posters.json}
// and src/data/lagoon-poster-layout.json. Frames and the receipt go to the
// work directory, outside the repository.
import { chromium } from "playwright";
import sharp from "sharp";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const base = (process.argv[2] ?? "http://127.0.0.1:4412").replace(/\/$/, "");
const work = process.argv[3];
if (!work) throw new Error("Pass a work directory for frames and the receipt");
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const fps = 18, duration = 8;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
await mkdir(work, { recursive: true });

// A hardware context. Software WebGL is what the fallback exists for; it is
// not what the posters should show.
const browser = await chromium.launch({ headless: true, channel: "chromium", args: ["--use-gl=angle", "--use-angle=gl-egl", "--ignore-gpu-blocklist", "--enable-gpu"] });
process.on("uncaughtException", async (error) => { console.error(error); await browser.close(); process.exit(1); });

const manifest = { version: 1, strategy: "one controlled clip from the same live authored room; fallback motion, not interactive 3D", fps, duration, forms: { desktop: {}, mobile: {} } };
const posters = [], receipts = [], layout = {};
const deliveredAnchors = await fetch(`${base}/lagoon/anchors.json`).then((r) => { if (!r.ok) throw new Error("Missing served anchors"); return r.json(); });

for (const form of ["desktop", "mobile"]) for (const theme of ["light", "dark"]) {
  const viewport = form === "desktop" ? { width: 1440, height: 900 } : { width: 760, height: 1350 };
  // Match the scene's own pixel-ratio cap so screenshots are 1:1 with the canvas.
  const deviceScaleFactor = form === "desktop" ? 1.5 : 1.25;
  const context = await browser.newContext({ viewport, deviceScaleFactor, colorScheme: theme });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((theme) => { localStorage.setItem("theme", theme); }, theme);
  await page.goto(`${base}/?lab-capture=1`, { waitUntil: "load" });
  await page.locator("[data-instrument]").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector("[data-instrument]")?.dataset.status === "active" && window.__pocketCapture && window.__lagoon?.framing?.width > 0, null, { timeout: 90000 });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: ".lab-hero__copy,.nav-shell,.lab-hero__feed,.instrument__poster{visibility:hidden!important}" });
  const box = await page.locator("[data-instrument-runtime]").boundingBox();
  const frame = await page.evaluate(() => window.__lagoon.framing);
  const clip = { x: box.x + frame.x, y: box.y + frame.y, width: frame.width, height: frame.height };
  const dir = `${work}/${theme}-${form}`;
  await mkdir(dir, { recursive: true });
  const timeline = [];
  let restPng = null, restMetrics = null;
  for (let index = 0; index < duration * fps; index++) {
    const at = index / fps;
    // The authored 5.2 s inspection plays in 3.2 s, then 4.8 s of genuine
    // rest. Frame zero and the loop boundary are the same supported pose.
    const authoredAt = index === 0 ? 0 : at < 3.2 ? 2400 + at / 3.2 * 5200 : 0;
    let metrics, png;
    if (authoredAt === 0 && restPng) { metrics = restMetrics; png = restPng; }
    else {
      await page.evaluate((ms) => window.__pocketCapture.renderAt(ms), authoredAt);
      metrics = await page.evaluate(() => window.__lagoon);
      png = await page.screenshot({ type: "png", clip });
      if (authoredAt === 0) { restPng = png; restMetrics = metrics; }
    }
    if (index === 0) {
      await writeFile(`${work}/${theme}-${form}.png`, png);
      for (const size of form === "mobile" ? [640, 960] : [960, 1440, 1920]) {
        const file = `poster-${theme}-${form}-${size}.webp`;
        const image = await sharp(png).resize({ width: size }).webp({ quality: 92, effort: 5 }).toBuffer();
        const dimensions = await sharp(image).metadata();
        await writeFile(`public/lagoon/${file}`, image);
        posters.push({ theme, form, width: size, height: dimensions.height, file, sha256: sha(image), bytes: image.length });
      }
      const artWidth = frame.width + 2 * frame.x, artHeight = frame.height + 2 * frame.y;
      const point = metrics.anchors.find((a) => a.id === "BEAM_ENTRY").normalized;
      layout[form] = { aspect: frame.width / frame.height, beam: [(point[0] * artWidth - frame.x) / frame.width, (point[1] * artHeight - frame.y) / frame.height] };
    }
    await writeFile(`${dir}/${String(index).padStart(4, "0")}.png`, png);
    const normalized = metrics.anchors.filter((a) => a.id === "BEAM_ENTRY").map((a) => ({ id: a.id, normalized: [(a.normalized[0] * (frame.width + 2 * frame.x) - frame.x) / frame.width, (a.normalized[1] * (frame.height + 2 * frame.y) - frame.y) / frame.height] }));
    timeline.push({ at, opticalStrength: metrics.opticalStrength, opticalTravel: metrics.opticalTravel, anchors: normalized, phase: metrics.motionPhase });
    if (index % fps === 0) console.log(`${theme} ${form} ${index}/${duration * fps}`);
  }
  const target = `public/lagoon/room-${theme}-${form}.mp4`;
  const encoded = spawnSync(ffmpeg, ["-y", "-v", "error", "-framerate", String(fps), "-i", `${dir}/%04d.png`, "-vf", `scale=${form === "desktop" ? 960 : 720}:-2`, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", target], { encoding: "utf8" });
  if (encoded.status !== 0) throw new Error(encoded.stderr);
  const bytes = await readFile(target);
  manifest.forms[form][theme] = { url: "/" + target.replace("public/", ""), aspect: frame.width / frame.height, duration, bytes: bytes.length, sha256: sha(bytes), frames: timeline, stageTimes: { reward: 0.25, pressure: 0.8, update: 1.6, response: 2.7, comparison: 4.5 } };
  const receipt = await page.evaluate(() => { const c = document.querySelector("[data-instrument-runtime] canvas"), gl = c.getContext("webgl2"), e = gl.getExtension("WEBGL_debug_renderer_info"); return { renderer: gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER), drawingBuffer: [c.width, c.height] }; });
  receipts.push({ form, theme, viewport, deviceScaleFactor, clip, ...receipt, errors });
  console.log(`encoded ${target} ${bytes.length}`);
  await rm(dir, { recursive: true, force: true });
  await context.close();
}
await browser.close();
await writeFile("public/lagoon/fallback.json", JSON.stringify(manifest) + "\n");
await writeFile("src/data/lagoon-poster-layout.json", JSON.stringify(layout, null, 2) + "\n");
await writeFile("public/lagoon/posters.json", JSON.stringify({ version: 2, assets: deliveredAnchors.assets, posters }, null, 2) + "\n");
await writeFile(`${work}/receipt.json`, JSON.stringify({ source: base, renderMode: "hardware ANGLE WebGL2", fps, duration, posters, receipts }, null, 2) + "\n");
console.log("All room media generated.");
