/**
 * A single-page probe, used to establish what this host can and cannot measure
 * before the full sweep runs. Prints the WebGL adapter, the scene's own handle,
 * and one frame window's draw calls and triangles.
 *
 * Usage: node tests/perf/probe.mjs [route]
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DIST, serveDist, launchBrowser } from "../../scripts/checks/_lib.mjs";
import { INSTRUMENT, isSoftware } from "./instrument.mjs";

const route = process.argv[2] ?? "/";

const server = await serveDist(DIST);
const { browser, engine } = await launchBrowser();
console.log(`browser: ${engine}`);
console.log(`origin:  ${server.origin}`);

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript(INSTRUMENT);

// THE WRONG-WORKTREE TRAP. `astro preview --port N` binds a different port when
// N is taken and prints the real one, and a previous packet measured another
// worktree's site: a real page, correctly rendered, of the wrong branch. This
// serves from DIST directly on an ephemeral port, and then proves it by hashing
// what the server returned against what is on disk here.
const html = await (await fetch(server.origin + route)).text();
const served = createHash("md5").update(html).digest("hex");
const onDisk = createHash("md5")
  .update(readFileSync(join(DIST, route === "/" ? "index.html" : route.replace(/^\/|\/$/g, "") + "/index.html")))
  .digest("hex");
console.log(`md5 served=${served} disk=${onDisk} ${served === onDisk ? "MATCH" : "MISMATCH"}`);
if (served !== onDisk) {
  console.error("probe: the served bytes are not this worktree's dist/. Refusing to measure.");
  process.exit(1);
}

await page.goto(server.origin + route, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
const ready = await page
  .waitForFunction(() => document.documentElement.dataset.sceneReady === "true", { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
console.log(`scene ready: ${ready}`);

const adapters = await page.evaluate(() => window.__perf.contexts);
console.log(`webgl contexts: ${adapters.length}`);
for (const a of adapters) {
  console.log(`  ${a.type} ${a.width}x${a.height} antialias=${a.antialias}`);
  console.log(`    renderer: ${a.renderer}`);
  console.log(`    vendor:   ${a.vendor}`);
  console.log(`    SOFTWARE RASTERISER: ${isSoftware(a.renderer)}`);
}

const pipeline = await page.evaluate(() => (window.__pipeline ? window.__pipeline.read() : null));
console.log(`pipeline: ${pipeline ? JSON.stringify({ tier: pipeline.tier, theme: pipeline.theme, operator: pipeline.operator, passes: pipeline.passes, env: pipeline.environment }, null, 2) : "ABSENT"}`);

// One frame window, so draw calls read per frame rather than per session.
await page.evaluate(() => window.__perfReset());
await page.waitForTimeout(3000);
const counts = await page.evaluate(() => ({
  drawCalls: window.__perf.drawCalls,
  triangles: window.__perf.triangles,
  points: window.__perf.points,
  lines: window.__perf.lines,
  frames: window.__perf.frames,
  textureBytes: window.__perf.textureBytes,
  renderbufferBytes: window.__perf.renderbufferBytes,
  bufferBytes: window.__perf.bufferBytes,
  unknownFormats: window.__perf.unknownFormats,
  textureCount: window.__perf.textures.length,
}));
console.log(`over ${counts.frames} frames in 3s:`);
console.log(`  draw calls/frame: ${counts.frames ? (counts.drawCalls / counts.frames).toFixed(1) : "n/a"}  (${counts.drawCalls} total)`);
console.log(`  triangles/frame:  ${counts.frames ? Math.round(counts.triangles / counts.frames).toLocaleString() : "n/a"}`);
console.log(`  points/frame:     ${counts.frames ? Math.round(counts.points / counts.frames).toLocaleString() : "n/a"}`);
console.log(`  lines/frame:      ${counts.frames ? Math.round(counts.lines / counts.frames).toLocaleString() : "n/a"}`);
console.log(`  texture bytes:    ${counts.textureBytes.toLocaleString()} (${counts.textureCount} allocations)`);
console.log(`  renderbuffer:     ${counts.renderbufferBytes.toLocaleString()}`);
console.log(`  buffer (geom):    ${counts.bufferBytes.toLocaleString()}`);
console.log(`  unknown formats:  ${JSON.stringify(counts.unknownFormats)}`);

await browser.close();
await server.close();
