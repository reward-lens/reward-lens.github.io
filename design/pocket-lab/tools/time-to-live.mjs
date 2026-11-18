// node design/pocket-lab/tools/time-to-live.mjs <base-url> [runs]
// Cold loads of the homepage in a GPU-backed headless Chromium: milliseconds from
// navigation to the live room (data-status=active), and the bytes of /lagoon/ assets.
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:4410/"; const runs = Number(process.argv[3] ?? 3);
// LAB_GPU=intel runs on the integrated GPU through Mesa (what a browser on this laptop uses).
const env = { ...process.env, ...(process.env.LAB_GPU === "intel" ? { __EGL_VENDOR_LIBRARY_FILENAMES: "/usr/share/glvnd/egl_vendor.d/50_mesa.json" } : {}) };
const browser = await chromium.launch({ headless: true, channel: "chromium", env, args: ["--use-gl=angle", "--use-angle=gl-egl", "--ignore-gpu-blocklist", "--enable-gpu"] });
const rows = [];
for (let i = 0; i < runs; i++) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage(); let lagoonBytes = 0;
  page.on("response", async (r) => { if (r.url().includes("/lagoon/")) { try { lagoonBytes += (await r.body()).length; } catch {} } });
  const t0 = Date.now();
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("[data-instrument]")?.dataset.status === "active", null, { timeout: 120000 });
  const ms = Date.now() - t0;
  const longTasks = await page.evaluate(() => performance.getEntriesByType("longtask")?.length ?? null);
  rows.push({ run: i + 1, msToLive: ms, lagoonBytes, longTasks });
  await context.close();
}
console.log(JSON.stringify(rows));
await browser.close();
