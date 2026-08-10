import { chromium } from "playwright";
const url = process.argv[2];
const browser = await chromium.launch({
  executablePath: "/opt/google/chrome/google-chrome",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: "networkidle" });
const out = await page.evaluate(() => {
  const d = document.querySelector(".src");
  const s = d?.querySelector("summary");
  const p = d?.querySelector(".src__panel");
  const cs = (el) => (el ? getComputedStyle(el) : null);
  return {
    ua: navigator.userAgent,
    details: cs(d)?.display,
    summary: cs(s)?.display,
    panel: cs(p)?.display,
    detailsRect: d?.getBoundingClientRect().toJSON(),
    summaryRect: s?.getBoundingClientRect().toJSON(),
    panelRect: p?.getBoundingClientRect().toJSON(),
    open: d?.hasAttribute("open"),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
