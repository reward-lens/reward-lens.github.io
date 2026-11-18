// node design/pocket-lab/tools/shots-viewport.mjs <label> <width>x<height> [query]
// Full-page-viewport screenshots of the hero in light and dark at one viewport size.
import { chromium } from "playwright";
const [label = "vp", size = "390x844", query = ""] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
const base = process.env.LAB_URL ?? "http://127.0.0.1:4430/";
const browser = await chromium.launch({ headless: true, channel: "chromium", args: ["--use-gl=angle", "--use-angle=gl-egl", "--ignore-gpu-blocklist", "--enable-gpu"] });
for (const theme of (process.env.LAB_THEMES ?? "light,dark").split(",")) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: Number(process.env.LAB_DPR ?? 2), isMobile: width < 768, hasTouch: width < 768 });
  await context.addInitScript(t => { try { localStorage.setItem("theme", t); } catch {} }, theme);
  const page = await context.newPage(); const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(base + query, { waitUntil: "load" });
  let status = "timeout";
  try { await page.waitForFunction(() => document.querySelector("[data-instrument]")?.dataset.status === "active", null, { timeout: 90000 }); status = "active"; }
  catch { status = await page.evaluate(() => document.querySelector("[data-instrument]")?.dataset.status ?? "missing"); }
  await page.waitForTimeout(Number(process.env.LAB_SETTLE ?? 2500));
  const out = `design/pocket-lab/previews/vp-${label}-${theme}.png`;
  await page.screenshot({ path: out });
  console.log(JSON.stringify({ theme, status, out, errors: errors.slice(0, 5) }));
  await context.close();
}
await browser.close();
