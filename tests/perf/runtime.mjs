/**
 * The CPU-side and behavioural measurements, and the ones that separate this
 * host's real numbers from its meaningless ones.
 *
 * THE POINT OF THE WEBGL-DECLINED RUN, AND WHAT IT TURNED OUT TO SHOW. Total
 * blocking time on the homepage measures around 18 seconds here, and that
 * number is worthless as it stands because the adapter is SwiftShader and
 * almost all of it is software rasterisation.
 *
 * The intention was to subtract the rasteriser by declining WebGL and be left
 * with the cost of parsing and running the same JavaScript. That is not what
 * happens, and saying so matters more than the tidy story: with WebGL declined
 * the tier resolves to `still`, and the still tier never imports the scene
 * chunk at all. So the declined run is not the same JavaScript minus a GPU, it
 * is a different and much smaller program. `scriptBytes` below records which
 * scripts each run actually fetched, so the two rows cannot be read as a
 * subtraction they do not support.
 *
 * What it does establish, and this is worth more than the subtraction would
 * have been: the fallback path is genuinely free. No canvas, no context, no
 * scene bytes, no blocking time.
 *
 * Covers: the WebGL-declined fallback, the low and still tiers, whether the
 * scene keeps working when it is off screen, memory across a route navigation,
 * and interaction latency on the one control the homepage has.
 *
 * Usage: node tests/perf/runtime.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, DIST, serveDist, launchBrowser } from "../../scripts/checks/_lib.mjs";
import { INSTRUMENT, isSoftware } from "./instrument.mjs";

const SETTLE = 12000;

/** Make getContext return null for WebGL, which is what a blocked browser does. */
const DECLINE_WEBGL = `(() => {
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (/webgl/i.test(String(type))) return null;
    return gc.call(this, type, attrs);
  };
})()`;

const server = await serveDist(DIST);
const { browser, engine } = await launchBrowser();

const VITALS = `() => new Promise((resolve) => {
  const out = { fcp: 0, lcp: 0, cls: 0, tbt: 0, longTasks: 0, longestTask: 0 };
  try { for (const e of performance.getEntriesByType("paint")) if (e.name === "first-contentful-paint") out.fcp = e.startTime; } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) out.lcp = Math.max(out.lcp, e.startTime); }).observe({ type: "largest-contentful-paint", buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) out.cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { out.longTasks += 1; out.tbt += Math.max(0, e.duration - 50); out.longestTask = Math.max(out.longestTask, e.duration); } }).observe({ type: "longtask", buffered: true }); } catch (e) {}
  setTimeout(() => resolve(out), 700);
})`;

async function load(opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    deviceScaleFactor: opts.dpr ?? 1,
    ...(opts.mobile ? { isMobile: true, hasTouch: true } : {}),
    ...(opts.reducedMotion ? { reducedMotion: "reduce" } : {}),
  });
  const page = await ctx.newPage();
  if (opts.declineWebGL) await page.addInitScript(DECLINE_WEBGL);
  // The mid tier cannot be reached by viewport alone: detectTier() takes it when
  // deviceMemory and hardwareConcurrency are present but not both high. Those
  // come from the browser, so they are overridden here rather than left
  // unmeasured, and the override is recorded in the row.
  if (opts.hints) {
    await page.addInitScript(`(() => {
      Object.defineProperty(navigator, "deviceMemory", { get: () => ${opts.hints.deviceMemory}, configurable: true });
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => ${opts.hints.hardwareConcurrency}, configurable: true });
    })()`);
  }
  await page.addInitScript(INSTRUMENT);
  // Which scripts this run actually fetched. Without it the WebGL-declined row
  // reads as "the same page, minus a GPU", which it is not.
  const scripts = [];
  page.on("response", (res) => {
    if (/\.(js|mjs)$/.test(res.url())) scripts.push(res.url().replace(server.origin, ""));
  });
  await page.goto(server.origin + (opts.route ?? "/"), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page
    .waitForFunction(() => document.documentElement.dataset.sceneReady === "true", { timeout: opts.declineWebGL ? 4000 : 30000 })
    .catch(() => {});
  await page.waitForTimeout(opts.settle ?? SETTLE);
  return { ctx, page, scripts };
}

/**
 * Draw calls and triangles PER FRAME, over a window that starts from zero.
 *
 * Dividing the session totals by the session's frame count is wrong and was
 * wrong here first: `frames` counts every requestAnimationFrame callback from
 * the moment the page loads, including the ones React runs before the scene
 * exists, so the divisor is inflated and the answer came out at 30.1 draws per
 * frame against a true 99. Resetting and sampling a known window is the only
 * way the ratio means anything.
 */
async function perFrame(page, ms = 4000) {
  const ok = await page.evaluate(() => typeof window.__perfReset === "function");
  if (!ok) return { drawCallsPerFrame: null, trianglesPerFrame: null, framesSampled: 0 };
  await page.evaluate(() => window.__perfReset());
  await page.waitForTimeout(ms);
  return page.evaluate(() => {
    const f = window.__perf.frames;
    return {
      framesSampled: f,
      drawCallsPerFrame: f ? window.__perf.drawCalls / f : null,
      trianglesPerFrame: f ? window.__perf.triangles / f : null,
      framesPerSecond: f / 4,
    };
  });
}

const state = (page) =>
  page.evaluate(() => ({
    tier: document.documentElement.getAttribute("data-scene-tier"),
    sceneReady: document.documentElement.dataset.sceneReady ?? null,
    canvasPresent: !!document.querySelector("canvas"),
    // An astro-island is display:contents and generates no box, which is how a
    // scene that never hydrates measures beautifully and is broken. Asking the
    // island for a rect would always give 0x0, so the CANVAS's rect is what says
    // whether anything was actually laid out.
    canvasRect: (() => {
      const c = document.querySelector("canvas");
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), buffer: [c.width, c.height] };
    })(),
    islandHydrated: [...document.querySelectorAll("astro-island")].map((i) => ({
      component: i.getAttribute("opts") ?? "",
      client: i.getAttribute("client"),
      ssr: i.hasAttribute("ssr"),
      childElements: i.children.length,
    })),
    fallbackVisible: !!document.querySelector("[data-scene-fallback], .scene-fallback, [data-scene-still]"),
    contexts: window.__perfContexts ? window.__perfContexts().length : 0,
    liveContexts: window.__perfContexts ? window.__perfContexts().filter((c) => c.lost === false).length : 0,
    pipeline: window.__pipeline ? window.__pipeline.read() : null,
    gpuBytes:
      window.__perf.textures.reduce((n, t) => n + t.bytes, 0) +
      window.__perf.renderbuffers.reduce((n, r) => n + r.bytes, 0),
  }));

const results = {};

// --- 1. as shipped, and with WebGL declined --------------------------------
for (const [name, opts] of [
  ["shipped", {}],
  ["webgl-declined", { declineWebGL: true }],
]) {
  const { ctx, page, scripts } = await load(opts);
  results[name] = { ...(await state(page)), vitals: await page.evaluate(`(${VITALS})()`), ...(await perFrame(page)), scriptsFetched: scripts };
  await ctx.close();
}

// --- 2. tiers, driven through the signals tier.ts actually reads ------------
// detectTier() reads prefers-reduced-motion, WebGL presence, pointer coarseness
// and innerWidth. Emulating those is the only override there is: the tier is
// decided once at mount from hardware hints and nothing exposes a setter, which
// is right for shipping and is why each row below says how it was induced.
for (const [name, opts] of [
  ["tier-mid-hints", { hints: { deviceMemory: 8, hardwareConcurrency: 6 } }],
  ["tier-low-hints", { hints: { deviceMemory: 4, hardwareConcurrency: 4 } }],
  ["tier-low-phone", { mobile: true, viewport: { width: 390, height: 844 }, dpr: 2 }],
  ["tier-still-reduced-motion", { reducedMotion: true }],
]) {
  const { ctx, page, scripts } = await load(opts);
  results[name] = { ...(await state(page)), vitals: await page.evaluate(`(${VITALS})()`), ...(await perFrame(page)), scriptsFetched: scripts, _induced: opts };
  await ctx.close();
}

// --- 3. does the scene keep working off screen ------------------------------
{
  const { ctx, page } = await load({});
  const idle = await page.evaluate(async () => {
    const sample = async (ms) => {
      const before = window.__perf.frames;
      await new Promise((r) => setTimeout(r, ms));
      return window.__perf.frames - before;
    };
    const onScreen = await sample(4000);
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 1500));
    const scrolledAway = await sample(4000);
    return { onScreen, scrolledAway, seconds: 4 };
  });
  // A hidden tab is throttled by the browser regardless, so this is asked of
  // the page's own visibility handling rather than of Chrome's throttling.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
    Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hidden = await page.evaluate(async () => {
    const before = window.__perf.frames;
    await new Promise((r) => setTimeout(r, 4000));
    return window.__perf.frames - before;
  });
  results["offscreen-idle"] = { ...idle, framesWhenHidden: hidden };
  await ctx.close();
}

// --- 4. memory across a route navigation ------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const client = await ctx.newCDPSession(page);
  await page.addInitScript(INSTRUMENT);
  const heap = async () => {
    const m = await client.send("Runtime.getHeapUsage").catch(() => null);
    const js = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : null)).catch(() => null);
    return { cdpUsed: m ? m.usedSize : null, jsHeap: js };
  };
  await page.goto(server.origin + "/", { waitUntil: "load" });
  await page.waitForTimeout(SETTLE);
  const onHome = { ...(await heap()), gpuBytes: await page.evaluate(() => window.__perf.textures.reduce((n, t) => n + t.bytes, 0) + window.__perf.renderbuffers.reduce((n, r) => n + r.bytes, 0)) };
  await page.goto(server.origin + "/log/", { waitUntil: "load" });
  await page.waitForTimeout(4000);
  const onLog = await heap();
  await page.goto(server.origin + "/", { waitUntil: "load" });
  await page.waitForTimeout(SETTLE);
  const backHome = { ...(await heap()), gpuBytes: await page.evaluate(() => window.__perf.textures.reduce((n, t) => n + t.bytes, 0) + window.__perf.renderbuffers.reduce((n, r) => n + r.bytes, 0)) };
  results["memory-navigation"] = {
    _note:
      "This is a static multi-page site, so each navigation is a full document teardown and nothing can leak across one in the way a single-page app leaks. The figures are recorded to show that, not because a leak was expected.",
    onHome,
    onLog,
    backHome,
  };
  await ctx.close();
}

// --- 5. interaction latency on the one control the homepage has -------------
{
  const { ctx, page } = await load({});
  const inp = await page.evaluate(async () => {
    const btn = document.querySelector("[data-theme-toggle]");
    if (!btn) return null;
    const samples = [];
    for (let i = 0; i < 6; i += 1) {
      const t0 = performance.now();
      btn.click();
      // Next paint, not next task: interaction latency is measured to the frame
      // the user sees, so it is two rAFs plus the message queue behind them.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));
      samples.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 700));
    }
    samples.sort((a, b) => a - b);
    return { samples: samples.map((s) => Math.round(s)), p50: Math.round(samples[3]), max: Math.round(samples[5]) };
  });
  results["inp-theme-toggle"] = {
    _control: "[data-theme-toggle], the only interactive control on the built homepage on this branch",
    _caveat:
      "Toggling the theme rebuilds the post chain, so this number contains the software rasteriser and needs real hardware. It is recorded because the DOM half of it does not.",
    ...(inp ?? { unavailable: true }),
  };
  await ctx.close();
}

await browser.close();
await server.close();

const adapter = results.shipped.pipeline ? null : null;
const MB = (n) => (n / 1048576).toFixed(2);

console.log(`\nruntime, browser ${engine}\n`);
console.log(`  run                        tier    canvas   live ctx   draws/f  tris/f    GPU MB   TBT ms   longest   LCP ms   fps`);
for (const k of ["shipped", "tier-mid-hints", "tier-low-hints", "tier-low-phone", "webgl-declined", "tier-still-reduced-motion"]) {
  const r = results[k];
  console.log(
    `  ${k.padEnd(26)} ${String(r.tier).padEnd(7)} ${String(r.canvasPresent).padEnd(8)} ${String(r.liveContexts).padStart(8)}   ` +
      `${r.drawCallsPerFrame === null ? "    n/a" : r.drawCallsPerFrame.toFixed(1).padStart(7)}  ${r.trianglesPerFrame === null ? "   n/a" : Math.round(r.trianglesPerFrame).toString().padStart(6)}  ` +
      `${MB(r.gpuBytes).padStart(8)}  ${Math.round(r.vitals.tbt).toString().padStart(7)}  ${Math.round(r.vitals.longestTask).toString().padStart(7)}  ${Math.round(r.vitals.lcp).toString().padStart(7)}  ${(r.framesPerSecond ?? 0).toFixed(2).padStart(5)}`,
  );
}

const shipped = results.shipped.vitals.tbt;
const declined = results["webgl-declined"].vitals.tbt;
const sceneChunk = (r) => r.scriptsFetched.some((u) => /InstrumentScene/.test(u));
console.log(
  `\n  THE SPLIT, AND WHAT IT IS NOT. Total blocking time is ${Math.round(shipped)}ms with WebGL and ${Math.round(declined)}ms without.\n` +
    `  That is NOT the rasteriser's share, because the two runs did not run the same program:\n` +
    `    scene chunk fetched, shipped run:         ${sceneChunk(results.shipped)}\n` +
    `    scene chunk fetched, WebGL-declined run:  ${sceneChunk(results["webgl-declined"])}\n` +
    `  With WebGL declined the tier resolves to ${results["webgl-declined"].tier} and the scene is never imported, so the\n` +
    `  declined row prices the FALLBACK, not the scene without a GPU. The scene's own CPU cost,\n` +
    `  separated from software rasterisation, could not be measured on this host and needs a GPU.`,
);
console.log(`\n  offscreen: ${JSON.stringify(results["offscreen-idle"])}`);
console.log(`  memory:    home ${MB(results["memory-navigation"].onHome.cdpUsed ?? 0)} MB heap -> /log/ ${MB(results["memory-navigation"].onLog.cdpUsed ?? 0)} MB -> home ${MB(results["memory-navigation"].backHome.cdpUsed ?? 0)} MB`);
console.log(`  theme toggle: ${JSON.stringify(results["inp-theme-toggle"].samples ?? "unavailable")} ms, p50 ${results["inp-theme-toggle"].p50 ?? "n/a"}`);

mkdirSync(join(ROOT, "design/dossier/build/perf"), { recursive: true });
writeFileSync(
  join(ROOT, "design/dossier/build/perf/runtime.json"),
  JSON.stringify(
    {
      _method:
        "Each row is a fresh browser context against this worktree's dist/ on an ephemeral port. WebGL is declined by returning null from getContext, which is what a browser with WebGL blocked does. Tiers are induced through the signals runtime/tier.ts reads (reduced motion, coarse pointer, innerWidth), because the tier is decided once at mount and nothing exposes a setter.",
      _trustworthy:
        "Counts (draw calls, triangles, contexts), byte accounting (GPU bytes, heap), the presence or absence of a canvas and a fallback, LCP and CLS, and the WEBGL-DECLINED total blocking time. These do not depend on the rasteriser.",
      _needsRealHardware:
        "Every total blocking time and long-task figure from a run WITH WebGL, the theme-toggle latency, and any frame time. The adapter here is SwiftShader.",
      engine,
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(`\nwritten: design/dossier/build/perf/runtime.json`);
