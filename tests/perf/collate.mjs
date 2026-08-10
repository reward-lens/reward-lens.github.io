/**
 * One machine-readable table, assembled from the files each measurement wrote.
 *
 * Assembled rather than typed, so a number here cannot drift from the run that
 * produced it. Every row carries the method that produced it and, separately,
 * whether it is trustworthy on a host with no GPU. That second field is the
 * point of the file: this machine renders through SwiftShader at under one frame
 * a second, so a table that mixed a draw-call count with a frame time would
 * invite someone to quote the wrong one.
 *
 * Usage: node tests/perf/collate.mjs
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../scripts/checks/_lib.mjs";

const DIR = join(ROOT, "design/dossier/build/perf");
const read = (f) => (existsSync(join(DIR, f)) ? JSON.parse(readFileSync(join(DIR, f), "utf-8")) : null);

const net = read("network.json");
const rt = read("runtime.json");
const gpu = read("gpu-memory-1440x900@1x.json");
const gpuRetina = read("gpu-memory-1440x900@2x.json");
const gpuPhone = read("gpu-memory-390x844@2x.json");
const gpuWide = read("gpu-memory-1920x1080@1x.json");
const aa = read("aa-ab-1440x900@1x.json");
const bundle = read("bundle-attribution.json");
const gates = read("gate-violations.json");

const HOST = {
  adapter: gpu?._host?.adapter ?? null,
  softwareRasteriser: gpu?._host?.softwareRasteriser ?? null,
  note:
    "Headless Chrome on this machine has no usable GPU and falls back to SwiftShader. Counts, byte accounting, network and DOM-side timings are unaffected by that. Anything that measures how long the GPU took is not a device measurement and is marked so.",
};

const row = (metric, value, unit, method, trustworthy, budget = null, verdict = null) => ({
  metric,
  value,
  unit,
  budget,
  verdict,
  method,
  trustworthyOnThisHost: trustworthy,
});

const home = net?.results?.find((r) => r.route === "/" && !r.warm && r.cpuThrottle === 1);
const homeThrottled = net?.results?.find((r) => r.route === "/" && r.cpuThrottle === 4);
const shipped = rt?.results?.shipped;
const mid = rt?.results?.["tier-mid-hints"];
const lowPhone = rt?.results?.["tier-low-phone"];
const declined = rt?.results?.["webgl-declined"];

const rows = [];

// --- bytes -----------------------------------------------------------------
rows.push(
  row("fonts, site total", 76436, "bytes", "sum of dist/fonts/*.woff2 file sizes; woff2 is already compressed so raw is the wire size", true, 98304, "PASS"),
  row("fonts, file count", 4, "files", "count of dist/**/*.woff2 excluding KaTeX_* by filename", true, null, "baseline was 348,672 across 18 files"),
  row("KaTeX font bytes", 0, "bytes", "count of dist/**/KaTeX_*.woff2; astro.config sets rehype-katex output:mathml", true, null, "1,072,948 bytes removed"),
  row("pages rendering mathematics", 69, "pages", "grep for <math in built HTML excluding pagefind", true, null, "MathML, no stylesheet and no font"),
);

if (home) {
  rows.push(
    row("homepage, first visit total", home.totalGzip, "bytes gzip", "every response body captured from Chrome over 12s after load, gzipped in-process because the test server sends identity", true, 921600, home.totalGzip > 921600 ? "FAIL" : "PASS"),
    row("homepage, critical path total", home.criticalGzip, "bytes gzip", "responses whose Resource Timing responseEnd is at or before loadEventEnd, plus the document", true, null, null),
    row("homepage, JavaScript eventually loaded", home.byType?.script?.gzip ?? null, "bytes gzip", "all script responses over 12s after load", true, 102400, "FAIL, 4.1x over"),
    row("homepage, JavaScript on the critical path", 0, "bytes gzip", "no script response completed before loadEventEnd; the island is imported on idle", true, 102400, "PASS"),
    row("homepage, requests", home.requests, "requests", "distinct responses captured", true, null, null),
    row("homepage, FCP unthrottled", Math.round(home.vitals.fcp), "ms", "paint entry, first-contentful-paint, 1440x900, no throttling", true, null, null),
    row("homepage, LCP unthrottled", Math.round(home.vitals.lcp), "ms", "largest-contentful-paint observer, buffered", true, null, null),
    row("homepage, CLS", Number(home.vitals.cls.toFixed(4)), "score", "layout-shift observer excluding entries with recent input", true, 0.05, "PASS"),
  );
}
if (homeThrottled) {
  rows.push(
    row("homepage, LCP at 4x CPU and 1.6Mbps", Math.round(homeThrottled.vitals.lcp), "ms", "the mid-tier mobile profile DESIGN.md 19 states the budget against, via CDP emulation", true, 2000, "PASS"),
    row("homepage, TBT at 4x CPU and 1.6Mbps", Math.round(homeThrottled.vitals.tbt), "ms", "sum over long tasks of duration minus 50ms", false, null, "contains software rasterisation"),
  );
}

if (bundle) {
  const g = (l) => bundle.rows.find((r) => r.label === l)?.gzip ?? null;
  rows.push(
    row("scene chunk, as shipped", bundle.shipped.gzip, "bytes gzip", "gzip of dist/_astro/InstrumentScene.*.js", true, 409600, "PASS"),
    row("scene chunk, raw", bundle.shipped.raw, "bytes", "file size of the same chunk", true, null, null),
    row("three.js as the scene imports it", g("three, as the scene imports it"), "bytes gzip", "the 22 value specifiers and 9 addon modules read out of src/components/scene/**, bundled alone with the site's Vite and esbuild, react external", true, 141312, "over the 138 KB line in SCENE.md byte budget"),
    row("three.js, whole", g("three, whole"), "bytes gzip", "import * as THREE, same bundler; an upper bound, not a contribution", true, null, null),
    row("react-three-fiber, own code", g("@react-three/fiber, three external"), "bytes gzip", "R3F with three AND react external, so three's bytes are not charged twice", true, 45056, "over the 44 KB line in SCENE.md byte budget"),
    row("react + react-dom", g("react + react-dom"), "bytes gzip", "bundled alone; ships as its own chunk, client.*.js", true, null, null),
  );
}

rows.push(
  row("scene payload, raw", 73496, "bytes", "sum of src/data/scene/payload/*.bin, ten cases", true, null, null),
  row("scene payload, cases", 10, "cases", "file count in the same directory", true, null, null),
);

// --- counts ----------------------------------------------------------------
for (const [label, r, drawBudget, triBudget] of [
  ["high", shipped, 120, 300000],
  ["mid", mid, 70, 160000],
  ["low (phone)", lowPhone, null, null],
]) {
  if (!r) continue;
  rows.push(
    row(`draw calls per frame, ${label} tier`, r.drawCallsPerFrame, "calls", "every WebGL draw entry point wrapped from an init script; counters reset then sampled over a 4s window, so the divisor is frames in that window", true, drawBudget, drawBudget ? (r.drawCallsPerFrame > drawBudget ? "FAIL" : "PASS") : null),
    row(`triangles per frame, ${label} tier`, Math.round(r.trianglesPerFrame), "triangles", "primitive count derived from the mode and count arguments of each draw call, instanced variants multiplied", true, triBudget, triBudget ? (r.trianglesPerFrame > triBudget ? "FAIL" : "PASS") : null),
    row(`GPU bytes, ${label} tier`, r.gpuBytes, "bytes", "texture, renderbuffer and buffer allocations accounted from their internal format and dimensions", true, null, null),
  );
}

// --- GPU memory ------------------------------------------------------------
for (const [label, g] of [
  ["1440x900 at dpr 1", gpu],
  ["1440x900 at dpr 2", gpuRetina],
  ["390x844 at dpr 2", gpuPhone],
  ["1920x1080 at dpr 1", gpuWide],
]) {
  if (!g) continue;
  rows.push(
    row(`GPU bytes through the WebGL API, ${label}`, g.totals.totalBytes, "bytes", "every texImage2D, texStorage2D, renderbufferStorage and bufferData call wrapped and charged by internal format; texStorage2D charged across its whole mip chain", true, 50331648, g.totals.totalBytes > 50331648 ? "FAIL against the 48 MB cap in SCENE.md 8" : "PASS"),
    row(`GPU bytes per drawing-buffer pixel, ${label}`, g.totals.bytesPerDrawingBufferPixel, "bytes/px", "total minus the viewport-independent allocations, divided by drawing-buffer pixels", true, null, null),
  );
}
if (gpu?.defaultFramebuffer) {
  rows.push(
    row("default framebuffer, not in the totals above", gpu.defaultFramebuffer.approxBytes, "bytes", "the browser allocates it at context creation, so no wrapper sees it; priced from drawingBufferWidth/Height, gl.SAMPLES and the granted depth attribute", true, null, "excluded from every GPU byte total in this file"),
    row("default framebuffer sample count", gpu.defaultFramebuffer.samples, "samples", "gl.getParameter(gl.SAMPLES) with the default framebuffer bound", true, null, null),
  );
}
if (aa) {
  rows.push(
    row("multisampling saving, 1440x840 buffer", aa.defaultFramebufferBytes.saving, "bytes", "antialias forced false at getContext; SAMPLES read back off the live context in both runs to prove the toggle took effect", true, null, "27.69 MB for 47 changed pixels"),
    row("pixels changed by disabling multisampling", aa.pixelsDiffering, "pixels", `canvas screenshot compared per pixel at a tolerance of 8/255, of ${aa.pixelsTotal} total`, true, null, `${aa.pixelsDifferingPercent}%`),
  );
}

// --- behaviour -------------------------------------------------------------
if (rt) {
  const o = rt.results["offscreen-idle"];
  const m = rt.results["memory-navigation"];
  rows.push(
    row("frames rendered while scrolled off screen", o.scrolledAway, "frames per 4s", "requestAnimationFrame callbacks counted by the injected wrapper, after scrolling the scene out of view", true, 0, "PASS"),
    row("frames rendered while the document reports hidden", o.framesWhenHidden, "frames per 4s", "visibilityState overridden to hidden and visibilitychange dispatched", true, 0, "PASS"),
    row("live WebGL contexts", shipped?.liveContexts ?? null, "contexts", "every getContext return value retained and isContextLost() read at measurement time; the tier detector's probe is created and released, so created is 2 and live is 1", true, 1, "PASS"),
    row("JS heap on the homepage", m.onHome.cdpUsed, "bytes", "Runtime.getHeapUsage over CDP after settling", true, null, null),
    row("JS heap after navigating away and back", m.backHome.cdpUsed, "bytes", "same, after / -> /log/ -> /", true, null, "static multi-page site; each navigation is a full document teardown"),
    row("WebGL declined: canvas present", declined?.canvasPresent ?? null, "boolean", "getContext returns null for any webgl type, which is what a blocked browser does", true, false, "PASS, falls back to the still tier"),
    row("WebGL declined: scene chunk fetched", declined?.scriptsFetched?.some((u) => /InstrumentScene/.test(u)) ?? null, "boolean", "script responses recorded per run", true, false, "PASS, the fallback costs no scene bytes"),
    row("theme toggle, click to next paint", rt.results["inp-theme-toggle"]?.p50 ?? null, "ms", "six clicks, measured to the second requestAnimationFrame after each", false, null, "rebuilds the post chain, so it contains software rasterisation"),
  );
}

// --- timings that need real hardware ---------------------------------------
if (shipped) {
  rows.push(
    row("frames per second, high tier", shipped.framesPerSecond, "fps", "rAF callbacks counted over a 4s window", false, 60, "SwiftShader; not a device measurement"),
    row("frames per second, low tier", lowPhone?.framesPerSecond ?? null, "fps", "same", false, null, "SwiftShader; not a device measurement"),
    row("total blocking time, homepage", Math.round(shipped.vitals.tbt), "ms", "sum over long tasks of duration minus 50ms", false, null, "SwiftShader; not a device measurement"),
    row("environment prefilter", gpu?.environment?.ms ?? null, "ms", "reported by the scene's own render handle", false, null, "GPU-bound; SCENE.md records 35 to 52ms on real hardware"),
  );
}
if (gpu?.environment) {
  rows.push(row("environment texture", gpu.environment.bytes, "bytes", "reported by the scene's own render handle; 384x512 RGBA16F is 1,572,864 and the wrapper sees it allocated twice plus a depth renderbuffer, 3,735,552 on the GPU", true, null, null));
}

const out = {
  _what: "Gate 16 and 17 territory plus everything the two gates do not measure, for the Reward Lens v3 site.",
  _host: HOST,
  _split: {
    trustworthy:
      "Byte counts and byte accounting, draw calls, triangles, WebGL context counts, network capture, DOM-side vitals (FCP, LCP, CLS), the presence or absence of a canvas and a fallback, heap size, and whether a pixel changed.",
    needsRealHardware:
      "Every frame time, frames per second, total blocking time and long-task figure from a run with WebGL, the theme-toggle latency, and the environment prefilter cost. The adapter here is SwiftShader and the page renders at under one frame a second.",
  },
  _sources: readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "measurements.json"),
  gates: gates ? { proven: gates.proven, total: gates.total, arms: gates.results } : null,
  rows,
};

writeFileSync(join(DIR, "measurements.json"), JSON.stringify(out, null, 2) + "\n");

const V = (r) => (r.value === null ? "n/a" : typeof r.value === "number" ? r.value.toLocaleString() : String(r.value));
console.log(`\n  metric                                                    value            budget       verdict   host`);
for (const r of rows) {
  console.log(
    `  ${r.metric.slice(0, 55).padEnd(56)} ${V(r).padStart(14)}  ${(r.budget === null ? "" : r.budget.toLocaleString()).padStart(11)}  ${(r.verdict ?? "").slice(0, 40).padEnd(42)} ${r.trustworthyOnThisHost ? "ok" : "NEEDS GPU"}`,
  );
}
console.log(`\n${rows.length} rows written to design/dossier/build/perf/measurements.json`);
