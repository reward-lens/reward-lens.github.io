// Which elements actually widen the document at a given viewport.
//
// Reporting every box wider than the viewport is useless: a <pre> inside its own
// `overflow-x: auto` container is supposed to be wider, and it is the majority of
// the hits. This walks up from each wide box and only reports it when no ancestor
// between it and <body> clips or scrolls, which is the definition of a box that
// pushes the page.
import { chromium } from "playwright";

const url = process.argv[2];
const w = Number(process.argv[3] ?? 390);
const browser = await chromium.launch({
  executablePath: "/opt/google/chrome/google-chrome",
});
const page = await browser.newPage({ viewport: { width: w, height: 900 } });
await page.goto(url, { waitUntil: "networkidle" });
const report = await page.evaluate((vw) => {
  const contained = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(o.overflowX)) return true;
    }
    return false;
  };
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.right <= vw + 0.5) continue;
    if (contained(el)) continue;
    out.push({
      tag: el.tagName,
      cls: String(el.className).slice(0, 50),
      w: Math.round(r.width),
      right: Math.round(r.right),
      text: (el.textContent ?? "").trim().slice(0, 44),
    });
  }
  return { scrollWidth: document.documentElement.scrollWidth, out: out.slice(0, 12) };
}, w);
console.log(JSON.stringify(report, null, 1));
await browser.close();
