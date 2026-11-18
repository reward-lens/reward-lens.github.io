// node design/pocket-lab/tools/load-marks.mjs <url>...: cold-load phase marks (model decoded, shaders compiled, first valid frame) on the Intel GPU.
import { chromium } from "playwright";
const env = { ...process.env, __EGL_VENDOR_LIBRARY_FILENAMES: "/usr/share/glvnd/egl_vendor.d/50_mesa.json" };
const b = await chromium.launch({ headless: true, channel: "chromium", env, args: ["--use-gl=angle", "--use-angle=gl-egl", "--ignore-gpu-blocklist", "--enable-gpu"] });
for (const url of process.argv.slice(2)) {
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 }); const p = await c.newPage();
  await p.goto(url); await p.waitForFunction(() => document.querySelector("[data-instrument]")?.dataset.status === "active", null, { timeout: 120000 });
  const marks = await p.evaluate(() => performance.getEntriesByType("mark").filter(m => m.name.startsWith("lagoon")).map(m => `${m.name.replace("lagoon:", "")}=${Math.round(m.startTime)}`));
  console.log(url, marks.join(" "));
  await c.close();
}
await b.close();
