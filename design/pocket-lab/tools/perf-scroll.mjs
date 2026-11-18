// node design/pocket-lab/tools/perf-scroll.mjs <url> [WxH] [dpr] [theme] [label]
// GPU time of every rendered frame of the hero (EXT_disjoint_timer_query_webgl2
// around each requestAnimationFrame callback) and the page's frame clock, over
// four phases: idle, pointer over the hero, wheel scrolling, idle again.
// LAB_GPU=intel (default) runs Chromium on the integrated GPU through Mesa,
// which is what a browser on this laptop uses; LAB_GPU=nvidia uses the RTX.
import { chromium } from "playwright";
const [url = "http://127.0.0.1:4410/", size = "1440x900", dprArg = "1", theme = "light", label = ""] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
const env = { ...process.env };
if ((process.env.LAB_GPU ?? "intel") === "intel") env.__EGL_VENDOR_LIBRARY_FILENAMES = "/usr/share/glvnd/egl_vendor.d/50_mesa.json";
else env.__EGL_VENDOR_LIBRARY_FILENAMES = "/usr/share/glvnd/egl_vendor.d/10_nvidia.json";
const browser = await chromium.launch({ headless: true, channel: "chromium", env, args: ["--use-gl=angle", "--use-angle=gl-egl", "--ignore-gpu-blocklist", "--enable-gpu", "--disable-gpu-vsync=false"] });
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: Number(dprArg) });
await context.addInitScript(t => { try { localStorage.setItem("theme", t); } catch {} }, theme);
await context.addInitScript(() => {
  const state = window.__perf = { ctxs: [], gl: null, ext: null, renderer: null, pending: [], gpu: [], raf: [], last: 0, active: false, marks: [] };
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (ctx && type === "webgl2" && !state.ctxs.includes(ctx)) state.ctxs.push(ctx);
    return ctx;
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => {
    if (!state.gl || !state.gl.canvas.isConnected) {
      const live = state.ctxs.filter(c => c.canvas.isConnected && !c.isContextLost()).at(-1);
      if (live && live !== state.gl) { state.gl = live; state.ext = live.getExtension("EXT_disjoint_timer_query_webgl2"); state.pending = []; const d = live.getExtension("WEBGL_debug_renderer_info"); state.renderer = d ? live.getParameter(d.UNMASKED_RENDERER_WEBGL) : live.getParameter(live.RENDERER); }
    }
    const { gl, ext } = state; let q = null;
    if (gl && ext && !state.active && !gl.isContextLost()) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); state.active = true; }
    try { cb(t); } finally { if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); state.active = false; state.pending.push({ q, t }); } }
  });
  const tick = (t) => { if (state.last) state.raf.push({ t, dt: t - state.last }); state.last = t; raf(tick); };
  raf(tick);
  setInterval(() => {
    const { gl, ext } = state; if (!gl || !ext) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    state.pending = state.pending.filter(({ q, t }) => {
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return true;
      if (!disjoint) { const ns = gl.getQueryParameter(q, gl.QUERY_RESULT); if (ns > 50000) state.gpu.push({ t, ms: ns / 1e6 }); }
      gl.deleteQuery(q); return false;
    });
  }, 40);
});
const page = await context.newPage();
const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => document.querySelector("[data-instrument]")?.dataset.status === "active", null, { timeout: 120000 });
await page.waitForTimeout(3000);
const mark = (name) => page.evaluate(n => performance.now(), name);
const phases = [];
const wanted = new Set((process.env.LAB_PHASES ?? "idle,pointer,scroll,idle2").split(","));
const run = async (name, fn) => { if (!wanted.has(name)) return; const t0 = await mark(); await fn(); await page.waitForTimeout(300); const t1 = await mark(); phases.push({ name, t0, t1 }); };
const box = await page.locator("[data-instrument]").boundingBox();
const cx = box.x + box.width * .55, cy = box.y + box.height * .5;
await run("idle", () => page.waitForTimeout(4000));
await run("pointer", async () => { for (let i = 0; i < 180; i++) { const a = i / 180 * Math.PI * 4; await page.mouse.move(cx + Math.cos(a) * 220, cy + Math.sin(a) * 120); await page.waitForTimeout(16); } });
await run("scroll", async () => { await page.mouse.move(cx, cy); for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 18); await page.waitForTimeout(16); } for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -18); await page.waitForTimeout(16); } });
await run("idle2", () => page.waitForTimeout(4000));
await page.waitForTimeout(600);
const data = await page.evaluate(() => ({ renderer: window.__perf.renderer, gpu: window.__perf.gpu, raf: window.__perf.raf, timer: !!window.__perf.ext, dpr: devicePixelRatio, canvas: (() => { const c = document.querySelector("[data-instrument] canvas"); return c ? [c.width, c.height] : null; })() }));
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2); };
const out = { label, url, size, dpr: data.dpr, theme, renderer: data.renderer, canvas: data.canvas, timer: data.timer, errors: errors.slice(0, 3), phases: {} };
for (const { name, t0, t1 } of phases) {
  const gpu = data.gpu.filter(g => g.t >= t0 && g.t < t1).map(g => g.ms);
  const raf = data.raf.filter(r => r.t >= t0 && r.t < t1).map(r => r.dt);
  const secs = (t1 - t0) / 1000;
  out.phases[name] = { secs: +secs.toFixed(1), renderedPerSec: +(gpu.length / secs).toFixed(1), gpuP50: pct(gpu, .5), gpuP90: pct(gpu, .9), gpuMax: pct(gpu, 1), rafP50: pct(raf, .5), rafP95: pct(raf, .95), rafMax: pct(raf, 1), slowFrames: raf.filter(x => x > 25).length, frames: raf.length };
}
console.log(JSON.stringify(out));
await browser.close();
