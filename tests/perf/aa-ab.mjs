/**
 * Does the high tier's multisampling do anything?
 *
 * `chain.ts` says in its own comment that it does not: "A composer renders into
 * its own targets, so the WebGL context's antialias flag stops doing anything
 * and every edge staircases." `InstrumentScene.tsx` nonetheless creates the
 * context with `antialias: tier === "high"`, and the browser grants it 4x MSAA
 * on the default framebuffer. Multisampling antialiases GEOMETRY EDGES, and the
 * only geometry ever drawn into the default framebuffer is the composer's final
 * full-screen quad, whose only edges are the edges of the screen.
 *
 * That is an argument, and this packet does not ship arguments. So the flag is
 * flipped and both sides are measured.
 *
 * HOW THE TOGGLE IS APPLIED, AND WHY IT IS VERIFIED. A previous builder in this
 * repository published a fake ambient-occlusion A/B because the toggle was keyed
 * on `constructor.name` and the minifier had renamed the class: the switch did
 * nothing, unrelated state made the frames differ, and it read as evidence. So
 * this one is applied at the WebGL boundary (getContext's attributes, before any
 * page script runs) and then PROVED to have taken effect by reading SAMPLES back
 * off the live context. If SAMPLES does not differ between the two runs, the
 * comparison is refused rather than reported.
 *
 * Usage: node tests/perf/aa-ab.mjs [--width=1440] [--height=900] [--dpr=1]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, DIST, serveDist, launchBrowser, pixelDiff } from "../../scripts/checks/_lib.mjs";
import { INSTRUMENT, isSoftware } from "./instrument.mjs";

const flag = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? Number(hit.split("=")[1]) : d;
};
const W = flag("width", 1440);
const H = flag("height", 900);
const DPR = flag("dpr", 1);

const FORCE_OFF = `(() => {
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (/webgl/i.test(String(type)) && attrs && typeof attrs === "object") {
      attrs = Object.assign({}, attrs, { antialias: false });
    }
    return gc.call(this, type, attrs);
  };
})()`;

const server = await serveDist(DIST);
const { browser, engine } = await launchBrowser();

async function run(forceOff) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  const page = await ctx.newPage();
  // Order matters: the force runs first so the instrument records the attributes
  // the page will actually get, not the ones it asked for.
  if (forceOff) await page.addInitScript(FORCE_OFF);
  await page.addInitScript(INSTRUMENT);
  await page.goto(server.origin + "/", { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page
    .waitForFunction(() => document.documentElement.dataset.sceneReady === "true", { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(6000);

  const state = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const gl = c ? c.getContext("webgl2") ?? c.getContext("webgl") : null;
    let samples = null;
    let granted = null;
    if (gl) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      samples = gl.getParameter(gl.SAMPLES);
      granted = gl.getContextAttributes().antialias;
    }
    const t = window.__perf.textures.reduce((n, x) => n + x.bytes, 0);
    const r = window.__perf.renderbuffers.reduce((n, x) => n + x.bytes, 0);
    return {
      samples,
      granted,
      drawingBuffer: c ? [c.width, c.height] : null,
      allocatedBytes: t + r,
      adapter: window.__perf.contexts.map((x) => x.renderer)[0] ?? null,
      tier: window.__pipeline ? window.__pipeline.read().tier : null,
    };
  });

  // The hero only; the rest of the page is DOM and cannot differ.
  //
  // Taken as a clipped page screenshot rather than an element screenshot,
  // because an element screenshot waits for the element to be "stable" and the
  // canvas is repainting every frame, so on this host it never settles and the
  // call times out at twelve seconds.
  const box = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, innerWidth), height: Math.min(r.height, innerHeight) };
  });
  // At device pixel ratio 2 the clip is 2880x1680 and the software rasteriser
  // cannot produce it inside Playwright's timeout, so the pixel arm is skippable
  // and its absence is reported rather than silently returning an empty buffer.
  const shot =
    process.argv.includes("--no-pixels") || !box
      ? null
      : await page.screenshot({ clip: box, animations: "disabled", timeout: 120000 });
  return { page, ctx, state, shot };
}

const on = await run(false);
const off = await run(true);

console.log(`\nmultisampling A/B at ${W}x${H} dpr ${DPR}`);
console.log(`browser ${engine}; adapter ${on.state.adapter}`);
console.log(`software rasteriser: ${isSoftware(on.state.adapter)}`);
console.log(`tier ${on.state.tier}\n`);
console.log(`  as shipped:      antialias granted ${on.state.granted}, SAMPLES ${on.state.samples}, buffer ${on.state.drawingBuffer?.join("x")}`);
console.log(`  forced off:      antialias granted ${off.state.granted}, SAMPLES ${off.state.samples}, buffer ${off.state.drawingBuffer?.join("x")}`);

// The proof the switch is real. Without it this is two page loads and a story.
const toggleTook = on.state.samples !== off.state.samples;
console.log(`\n  TOGGLE VERIFIED: ${toggleTook} (SAMPLES ${on.state.samples} -> ${off.state.samples})`);
if (!toggleTook) {
  console.error(
    `  REFUSING TO REPORT A COMPARISON. SAMPLES did not change, so whatever differs between\n` +
      `  these two runs is not multisampling. This is the failure mode the ambient-occlusion\n` +
      `  A/B in this repository shipped as evidence.`,
  );
  await browser.close();
  await server.close();
  process.exit(1);
}

let diff = null;
let pct = null;
if (on.shot && off.shot) {
  diff = await pixelDiff(on.page, on.shot, off.shot, 8);
  pct = diff.total ? (diff.changed / diff.total) * 100 : 0;
  console.log(
    `\n  pixels differing by more than 8/255 on any channel: ${diff.changed.toLocaleString()} of ${diff.total.toLocaleString()} (${pct.toFixed(4)}%)` +
      (diff.sizeMismatch ? `  SIZE MISMATCH ${JSON.stringify(diff.a)} vs ${JSON.stringify(diff.b)}` : ""),
  );
} else {
  console.log(`\n  pixel arm SKIPPED (--no-pixels). Only the byte arithmetic below is reported for this configuration.`);
}

const fbBytes = (s) => {
  const [w, h] = on.state.drawingBuffer ?? [W * DPR, H * DPR];
  return w * h * (8 * Math.max(1, s) + 4);
};
const saving = fbBytes(on.state.samples) - fbBytes(off.state.samples);
console.log(
  `\n  default framebuffer: ${fbBytes(on.state.samples).toLocaleString()} bytes at SAMPLES ${on.state.samples},` +
    ` ${fbBytes(off.state.samples).toLocaleString()} at SAMPLES ${off.state.samples}` +
    `\n  saving: ${saving.toLocaleString()} bytes (${(saving / 1048576).toFixed(2)} MB)`,
);
console.log(
  `  allocations through the WebGL API are unchanged either way: ${on.state.allocatedBytes.toLocaleString()} vs ${off.state.allocatedBytes.toLocaleString()}`,
);

mkdirSync(join(ROOT, "design/dossier/build/perf"), { recursive: true });
writeFileSync(
  join(ROOT, `design/dossier/build/perf/aa-ab-${W}x${H}@${DPR}x.json`),
  JSON.stringify(
    {
      _method:
        "The context's antialias attribute is forced false at getContext, before any page script runs, so no scene source is modified. The toggle is proved to have taken effect by reading gl.SAMPLES off the live context in both runs; the comparison is refused if SAMPLES does not change. Pixels are compared on the canvas element only.",
      _hostCaveat:
        "The pixel comparison is valid on this host: whether two renderings differ is a question about output, not about speed. Any TIMING here would not be, because the adapter is a software rasteriser.",
      viewport: { width: W, height: H, dpr: DPR },
      adapter: on.state.adapter,
      softwareRasteriser: isSoftware(on.state.adapter),
      tier: on.state.tier,
      shipped: on.state,
      forcedOff: off.state,
      toggleVerified: toggleTook,
      pixelArmRan: !!diff,
      pixelsDiffering: diff ? diff.changed : null,
      pixelsTotal: diff ? diff.total : null,
      pixelsDifferingPercent: diff ? Number(pct.toFixed(4)) : null,
      defaultFramebufferBytes: { shipped: fbBytes(on.state.samples), forcedOff: fbBytes(off.state.samples), saving },
    },
    null,
    2,
  ) + "\n",
);
console.log(`\nwritten: design/dossier/build/perf/aa-ab-${W}x${H}@${DPR}x.json`);

await browser.close();
await server.close();
