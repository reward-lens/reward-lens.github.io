// axe on this packet's three routes only, in both themes.
//
// scripts/checks/axe.mjs is the gate and it scans all 178 built routes twice,
// which is minutes. This runs the same engine and the same two themes over the
// three routes this packet owns, so a violation is found while it is still
// cheap to fix. It is not a replacement for the gate.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const browser = await chromium.launch({
  executablePath: "/opt/google/chrome/google-chrome",
});
let bad = 0;
for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({ colorScheme: theme });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("theme", t);
    } catch {}
    document.documentElement.setAttribute("data-theme", t);
  }, theme);
  const page = await ctx.newPage();
  for (const url of process.argv.slice(2)) {
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.addScriptTag({ content: axeSource });
    const res = await page.evaluate(() => axe.run(document, { resultTypes: ["violations"] }));
    const hits = res.violations.filter((v) => ["serious", "critical"].includes(v.impact));
    for (const v of hits) {
      bad += v.nodes.length;
      console.log(`${theme} ${url} ${v.impact} ${v.id}: ${v.nodes.length}`);
      for (const n of v.nodes.slice(0, 3)) console.log(`    ${n.target.join(" ")}`);
    }
    console.log(`${theme} ${url}: ${hits.length} serious/critical rule(s)`);
  }
  await ctx.close();
}
await browser.close();
console.log(bad === 0 ? "axe-routes: clean" : `axe-routes: ${bad} node(s)`);
process.exit(bad ? 1 : 0);
