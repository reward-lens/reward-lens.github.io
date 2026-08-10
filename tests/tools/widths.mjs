// scrollWidth <= viewport at the four widths the packet is accepted at.
// `npm run shoot` asserts three of them; 320 is not one of its sizes and it is
// where an unbreakable token first wins, so it is checked here.
import { chromium } from "playwright";

const WIDTHS = [320, 390, 768, 1440];
const browser = await chromium.launch({
  executablePath: "/opt/google/chrome/google-chrome",
});
let failed = 0;
for (const url of process.argv.slice(2)) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(url, { waitUntil: "networkidle" });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    const ok = sw <= width;
    if (!ok) failed += 1;
    console.log(`${ok ? "OK  " : "FAIL"} ${url} @${width}: scrollWidth=${sw}`);
    await page.close();
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
