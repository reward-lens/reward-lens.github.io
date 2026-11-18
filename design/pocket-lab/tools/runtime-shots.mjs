// Usage: node design/pocket-lab/tools/runtime-shots.mjs <label> [query]
// Screenshots the hero in light and dark at 1440x900 @1.5x and reports console errors.
// LAB_CLIP=x,y,w,h (CSS px) also writes runtime-<label>-<theme>-clip.png, a close-up of that region.
import { chromium } from "playwright";
const [label = "probe", query = ""] = process.argv.slice(2);
const base = process.env.LAB_URL ?? "http://127.0.0.1:4420/";
const browser = await chromium.launch({ headless: true, channel: "chromium", args: ["--use-gl=angle", "--use-angle=gl-egl", "--ignore-gpu-blocklist", "--enable-gpu"] });
let failures = 0;
for (const theme of (process.env.LAB_THEMES ?? "light,dark").split(",")) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  await context.addInitScript(t => { try { localStorage.setItem("theme", t); } catch {} }, theme);
  const page = await context.newPage();
  const errors = [], warnings = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); if (m.type() === "warning") warnings.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(base + query, { waitUntil: "load" });
  let status = "timeout";
  try {
    await page.waitForFunction(() => document.querySelector("[data-instrument]")?.dataset.status === "active", null, { timeout: 90000 });
    status = "active";
  } catch { status = await page.evaluate(() => document.querySelector("[data-instrument]")?.dataset.status ?? "missing"); }
  await page.waitForTimeout(Number(process.env.LAB_SETTLE ?? 2500));
  const out = `design/pocket-lab/previews/runtime-${label}-${theme}.png`;
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1440, height: 900 } });
  if (process.env.LAB_CLIP) {
    const [x, y, width, height] = process.env.LAB_CLIP.split(",").map(Number);
    await page.screenshot({ path: out.replace(/\.png$/, "-clip.png"), clip: { x, y, width, height } });
  }
  if (status !== "active" || errors.length) failures++;
  console.log(JSON.stringify({ theme, status, out, errors: errors.slice(0, 8), warnings: warnings.filter(w => !/DevTools|Download the React/.test(w)).slice(0, 6) }));
  await context.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
