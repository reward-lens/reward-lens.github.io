/**
 * Where the scene's GPU bytes actually go.
 *
 * The open question this answers: GPU memory measures around 90 MB against a
 * 48 MB cap, and the cap was written for a scene with no post chain. Deciding
 * whether the cap is wrong or the chain is too expensive needs the bytes broken
 * out by what allocated them, not one total. So every texture and renderbuffer
 * allocation is recorded with its dimensions and internal format, and then
 * attributed: the drawing buffer, the post chain's ping-pong targets, the
 * ambient-occlusion targets, bloom's mip pyramid, the environment, or scene
 * material maps.
 *
 * Attribution is by SIZE AND FORMAT against the viewport, not by name, because
 * WebGL does not carry names across the call boundary. Each rule is stated in
 * `attribute()` and the unattributed remainder is reported rather than absorbed,
 * so the total is never made to add up by rounding something into a bucket.
 *
 * Usage: node tests/perf/gpu-memory.mjs [--width=1440] [--height=900] [--dpr=1]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, DIST, serveDist, launchBrowser } from "../../scripts/checks/_lib.mjs";
import { INSTRUMENT, isSoftware } from "./instrument.mjs";

const flag = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? Number(hit.split("=")[1]) : d;
};
const W = flag("width", 1440);
const H = flag("height", 900);
const DPR = flag("dpr", 1);

const FORMAT_NAMES = {
  6407: "RGB", 6408: "RGBA", 32849: "RGB8", 32856: "RGBA8", 35907: "SRGB8_ALPHA8",
  34842: "RGBA16F", 34836: "RGBA32F", 34843: "RGB16F", 34837: "RGB32F",
  33189: "DEPTH_COMPONENT16", 33190: "DEPTH_COMPONENT24", 33191: "DEPTH_COMPONENT32F",
  35056: "DEPTH24_STENCIL8", 36012: "DEPTH_COMPONENT32F",
  33321: "R8", 33323: "RG8", 33325: "R16F", 33327: "RG16F",
};
const fname = (f) => FORMAT_NAMES[f] ?? `0x${Number(f).toString(16)}`;

const server = await serveDist(DIST);
const { browser, engine } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const page = await ctx.newPage();
await page.addInitScript(INSTRUMENT);
await page.goto(server.origin + "/", { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page
  .waitForFunction(() => document.documentElement.dataset.sceneReady === "true", { timeout: 30000 })
  .catch(() => {});
// Let the chain settle: bloom builds its pyramid and AO its targets on the
// first rendered frame, so reading before a frame has run undercounts.
await page.waitForTimeout(6000);

const raw = await page.evaluate(() => ({
  textures: window.__perf.textures,
  renderbuffers: window.__perf.renderbuffers,
  bufferBytes: window.__perf.bufferBytes,
  contexts: window.__perfContexts(),
  unknownFormats: window.__perf.unknownFormats,
  dpr: window.devicePixelRatio,
  // THE DEFAULT FRAMEBUFFER IS NOT IN THE TOTAL ABOVE. It is allocated by the
  // browser at context creation, not through texImage2D or renderbufferStorage,
  // so no wrapper can see it. It still occupies GPU memory, and when the context
  // was created with antialias it occupies SAMPLES times as much. Reading the
  // granted attributes and the sample count is the only way to price it, so the
  // report can say what it excludes instead of quietly excluding it.
  defaultFramebuffer: (() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    if (!gl) return null;
    const attrs = gl.getContextAttributes ? gl.getContextAttributes() : {};
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
      samples: gl.getParameter(gl.SAMPLES),
      antialiasRequested: !!attrs.antialias,
      alpha: !!attrs.alpha,
      depth: !!attrs.depth,
      stencil: !!attrs.stencil,
    };
  })(),
  canvas: (() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { css: [Math.round(r.width), Math.round(r.height)], buffer: [c.width, c.height] };
  })(),
  pipeline: window.__pipeline ? window.__pipeline.read() : null,
}));

await browser.close();
await server.close();

// The composer's buffers are sized from the CSS box times a per-tier pixel-ratio
// ceiling, which is not the canvas's own drawing buffer and not W*DPR either. So
// "full resolution" is taken from the allocations themselves: the largest
// footprint that more than one allocation shares is the chain's working size.
// Deriving it from the canvas instead was wrong by six pixels at 390x844 and
// silently relabelled every composer target as a bloom mip.
const footprints = new Map();
for (const a of [...raw.textures, ...raw.renderbuffers]) {
  const k = `${a.w}x${a.h}`;
  footprints.set(k, (footprints.get(k) ?? 0) + 1);
}
let bufW = raw.canvas ? raw.canvas.buffer[0] : W * DPR;
let bufH = raw.canvas ? raw.canvas.buffer[1] : H * DPR;
// By allocation COUNT, not by area. The composer's working size is the one many
// targets share (twelve of them here); the 1024x1024 shadow map is larger in
// area at a phone viewport and is shared by exactly two, so an area rule picks
// the shadow map and mislabels the entire chain.
let bestCount = 0;
let bestArea = 0;
for (const [k, n] of footprints) {
  const [w, h] = k.split("x").map(Number);
  if (w < 64 || h < 64) continue;
  if (n > bestCount || (n === bestCount && w * h > bestArea)) {
    bestCount = n;
    bestArea = w * h;
    bufW = w;
    bufH = h;
  }
}

/**
 * Which subsystem an allocation belongs to.
 *
 * The rules are size-and-format rules against the drawing buffer, and each says
 * why it identifies what it identifies. Anything no rule claims is reported as
 * unattributed; it is never folded into the nearest bucket to make a total look
 * tidy.
 */
const attribute = (a) => {
  const full = Math.abs(a.w - bufW) <= 2 && Math.abs(a.h - bufH) <= 2;
  const half = Math.abs(a.w - bufW / 2) <= 2 && Math.abs(a.h - bufH / 2) <= 2;
  const f = fname(a.format);

  // The environment is the one allocation whose size is authored rather than
  // derived from the viewport: 384x512 equirectangular, half float.
  if (a.w === 384 && a.h === 512) return "environment (authored 384x512 RGBA16F)";
  // PMREM's own working targets are cube-derived and small in one axis.
  if (a.w <= 512 && a.h <= 512 && /16F/.test(f) && !full && !half) return "environment prefilter (PMREM)";
  // Depth at the drawing buffer's size is the render pass's depth attachment.
  if (/DEPTH/.test(f)) return full ? "depth (full res)" : `depth (${a.w}x${a.h})`;
  // Half-float at full resolution is the working-space colour buffer: the
  // composer's read/write pair and AO's own colour targets are all this.
  if (full && /RGBA16F/.test(f)) return "full-res RGBA16F target (composer ping-pong / AO)";
  if (full && /RGBA8|SRGB8/.test(f)) return "full-res RGBA8 target";
  // Bloom's pyramid halves each level, so its levels are the descending chain.
  if (!full && /16F/.test(f) && a.w < bufW && a.w >= 16) return `bloom mip ${a.w}x${a.h}`;
  // Shadow maps are square powers of two carrying depth or a packed depth.
  if (a.w === a.h && (a.w & (a.w - 1)) === 0 && a.w >= 256) return `shadow map ${a.w}x${a.h}`;
  return `unattributed ${a.w}x${a.h} ${f}`;
};

/**
 * The part of the total that does not scale with the viewport: the authored
 * environment and its prefilter chain, the shadow map and its depth, and the
 * handful of 1x1 and 64x64 defaults three allocates regardless. Separating it
 * is what makes a bytes-per-pixel figure meaningful, and it is why the same
 * build can measure 99.66 MB and 64.94 MB at once without either being wrong.
 */
const FIXED_ESTIMATE = (b) => {
  let n = 0;
  for (const [k, v] of b) {
    if (/environment|shadow map|unattributed (1x1|5x5|64x64)/.test(k)) n += v.bytes;
    if (/^depth \(1024x1024\)/.test(k)) n += v.bytes;
  }
  return n;
};

const all = [
  ...raw.textures.map((t) => ({ ...t, kind: "texture" })),
  ...raw.renderbuffers.map((r) => ({ ...r, kind: "renderbuffer" })),
];
const buckets = new Map();
for (const a of all) {
  const key = attribute(a);
  const b = buckets.get(key) ?? { bytes: 0, count: 0, examples: [] };
  b.bytes += a.bytes;
  b.count += 1;
  if (b.examples.length < 3) b.examples.push(`${a.w}x${a.h} ${fname(a.format)}${a.levels ? ` x${a.levels} levels` : ""}`);
  buckets.set(key, b);
}

const textureBytes = raw.textures.reduce((n, t) => n + t.bytes, 0);
const rbBytes = raw.renderbuffers.reduce((n, r) => n + r.bytes, 0);
const total = textureBytes + rbBytes + raw.bufferBytes;

const MB = (n) => (n / 1048576).toFixed(2);
console.log(`\nGPU memory, accounted by wrapping the WebGL allocation calls.`);
console.log(`browser ${engine}; adapter ${raw.contexts[0]?.renderer ?? "unknown"}`);
console.log(`software rasteriser: ${isSoftware(raw.contexts[0]?.renderer)} (byte counts are unaffected by this; timings are not)`);
console.log(`viewport ${W}x${H} at dpr ${raw.dpr}; drawing buffer ${bufW}x${bufH}`);
console.log(`webgl contexts on the page: ${raw.contexts.length}`);
console.log(`tier ${raw.pipeline?.tier}; passes ${raw.pipeline?.passes?.join(" -> ")}\n`);

const rows = [...buckets.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
console.log(`  bytes      MB      n   what`);
for (const [k, v] of rows) {
  console.log(`  ${String(v.bytes).padStart(10)}  ${MB(v.bytes).padStart(6)}  ${String(v.count).padStart(3)}   ${k}   [${v.examples.join("; ")}]`);
}
console.log(`\n  textures      ${String(textureBytes).padStart(10)}  ${MB(textureBytes)} MB`);
console.log(`  renderbuffers ${String(rbBytes).padStart(10)}  ${MB(rbBytes)} MB`);
console.log(`  geometry      ${String(raw.bufferBytes).padStart(10)}  ${MB(raw.bufferBytes)} MB`);
console.log(`  TOTAL         ${String(total).padStart(10)}  ${MB(total)} MB`);
console.log(`\n  unknown internal formats charged at 4 bytes/texel: ${JSON.stringify(raw.unknownFormats)}`);

// The allocation list in the order the page made the calls. This is the actual
// evidence; the buckets above are a reading of it and can be re-derived.
console.log(`\n  allocations, in call order:`);
for (const a of all) {
  console.log(
    `    ${String(a.bytes).padStart(9)}  ${a.kind === "renderbuffer" ? "RB " : "TEX"} ${String(a.w).padStart(4)}x${String(a.h).padEnd(4)} ${fname(a.format).padEnd(17)}${a.levels ? ` ${a.levels} levels` : ""}`,
  );
}

const perPixel = (total - FIXED_ESTIMATE(buckets)) / (bufW * bufH);
console.log(
  `\n  chain cost per drawing-buffer pixel: ${perPixel.toFixed(1)} bytes/px at ${bufW}x${bufH}`,
);

const fb = raw.defaultFramebuffer;
let fbBytes = 0;
if (fb) {
  // colour + depth/stencil per sample, then the single-sample resolve target
  // the driver keeps to present from.
  const perSample = 4 + (fb.depth ? 4 : 0);
  fbBytes = fb.width * fb.height * (perSample * Math.max(1, fb.samples) + 4);
  console.log(
    `\n  default framebuffer (NOT in the total above; the browser allocates it):\n` +
      `    ${fb.width}x${fb.height}, antialias requested ${fb.antialiasRequested}, SAMPLES ${fb.samples}, depth ${fb.depth}, alpha ${fb.alpha}\n` +
      `    approximately ${fbBytes.toLocaleString()} bytes (${MB(fbBytes)} MB) at ${perSample} bytes/px/sample plus a resolve target\n` +
      `    with SAMPLES 1 it would be ${(fb.width * fb.height * (perSample + 4)).toLocaleString()} bytes (${MB(fb.width * fb.height * (perSample + 4))} MB)`,
  );
  console.log(`  TOTAL INCLUDING the default framebuffer: ${MB(total + fbBytes)} MB`);
}

mkdirSync(join(ROOT, "design/dossier/build/perf"), { recursive: true });
const tag = `${W}x${H}@${DPR}x`;
writeFileSync(
  join(ROOT, `design/dossier/build/perf/gpu-memory-${tag}.json`),
  JSON.stringify(
    {
      _method:
        "Every WebGL texture/renderbuffer/buffer allocation call is wrapped from an init script injected before page scripts (tests/perf/instrument.mjs); bytes are computed from the internal format and dimensions, with texStorage2D charged across its whole mip chain. No scene source is modified. Byte counts do not depend on the rasteriser, so they are valid on this host; the adapter is recorded so that is checkable.",
      _host: { engine, adapter: raw.contexts[0]?.renderer ?? null, softwareRasteriser: isSoftware(raw.contexts[0]?.renderer) },
      viewport: { width: W, height: H, dpr: raw.dpr },
      drawingBuffer: { width: bufW, height: bufH },
      canvas: raw.canvas,
      defaultFramebuffer: fb ? { ...fb, approxBytes: fbBytes } : null,
      webglContexts: raw.contexts.length,
      contexts: raw.contexts,
      tier: raw.pipeline?.tier ?? null,
      passes: raw.pipeline?.passes ?? null,
      environment: raw.pipeline?.environment ?? null,
      buckets: Object.fromEntries(rows.map(([k, v]) => [k, { bytes: v.bytes, count: v.count, examples: v.examples }])),
      totals: {
        textureBytes,
        renderbufferBytes: rbBytes,
        geometryBytes: raw.bufferBytes,
        totalBytes: total,
        viewportIndependentBytes: FIXED_ESTIMATE(buckets),
        bytesPerDrawingBufferPixel: Number(perPixel.toFixed(2)),
      },
      unknownFormats: raw.unknownFormats,
      allocations: all.map((a) => ({ kind: a.kind, w: a.w, h: a.h, format: fname(a.format), bytes: a.bytes, levels: a.levels ?? 1 })),
    },
    null,
    2,
  ) + "\n",
);
console.log(`\nwritten: design/dossier/build/perf/gpu-memory-${tag}.json`);
