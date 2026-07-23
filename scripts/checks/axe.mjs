// axe-core over the built site, both themes; serious or critical violations fail.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf-8");

const base = process.argv[2] ?? "http://localhost:4326";
const paths = [
  "/",
  "/campaign/",
  "/campaign/chi-drift/",
  "/campaign/meta-ledger/",
  "/campaign/method/",
  "/atlas/",
  "/atlas/skywork-v2-qwen3-8b/",
  "/docs/",
  "/docs/concepts/reward-direction/",
  "/docs/reference/core/",
  "/science/",
  "/log/",
  "/about/",
];

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
let bad = 0;
for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({
    colorScheme: theme === "dark" ? "dark" : "light",
  });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem("theme", t); } catch {}
  }, theme);
  const page = await ctx.newPage();
  for (const p of paths) {
    await page.goto(base + p, { waitUntil: "networkidle" });
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(() =>
      axe.run(document, { resultTypes: ["violations"] }),
    );
    const serious = result.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact),
    );
    for (const v of serious) {
      bad += 1;
      console.error(
        `AXE ${theme} ${p} [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`,
        v.nodes[0]?.target?.[0] ?? "",
      );
    }
  }
  await ctx.close();
}
await browser.close();
console.log(bad === 0 ? "axe: zero serious or critical violations, both themes" : `axe: ${bad} serious/critical violations`);
process.exit(bad === 0 ? 0 : 1);
