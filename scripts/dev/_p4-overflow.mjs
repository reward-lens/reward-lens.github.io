import { chromium } from "playwright";

const url = process.argv[2];
const width = Number(process.argv[3] ?? 1440);
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/google-chrome' });
const page = await browser.newPage({ viewport: { width, height: 900 } });
await page.goto(url, { waitUntil: "networkidle" });
const bad = await page.evaluate((w) => {
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.right > w + 1 || r.left < -1) {
      out.push({
        tag: el.tagName,
        cls: (el.getAttribute("class") || "").slice(0, 70),
        left: Math.round(r.left),
        right: Math.round(r.right),
        w: Math.round(r.width),
      });
    }
  }
  return out.slice(0, 25);
}, width);
console.log(JSON.stringify(bad, null, 1));
await browser.close();
