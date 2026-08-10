import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/opt/google/chrome/google-chrome" });
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
await page.goto(process.argv[2], { waitUntil: "networkidle" });
const r = await page.evaluate(() => {
  const de = document.documentElement;
  const before = de.scrollWidth;
  const secs = [...document.querySelectorAll("main section, main > div > *")];
  const per = [];
  for (const s of secs) {
    const d = s.style.display;
    s.style.display = "none";
    per.push({ id: s.id || s.className, after: de.scrollWidth });
    s.style.display = d;
  }
  return { before, per };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
