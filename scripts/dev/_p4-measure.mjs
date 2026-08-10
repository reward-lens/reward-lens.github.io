// P4 route pass · part heights, and the measurement the packet is judged on.
//
// pages/see-run.md:125, see-reward-model.md:188 and see-grader.md:184 all end
// part 5 with the same acceptance: it occupies at least as much vertical space
// as part 4, measured rather than judged, because the temptation to compress it
// is exactly the failure that part guards against. This prints the two numbers
// at three widths so the claim in the packet report is a measurement.
import { chromium } from "playwright";

const url = process.argv[2];
const browser = await chromium.launch({
  executablePath: "/opt/google/chrome/google-chrome",
});

for (const width of [390, 768, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const out = await page.evaluate((w) => {
    const parts = {};
    for (const el of document.querySelectorAll("[data-part]")) {
      parts[el.getAttribute("data-part")] = Math.round(el.getBoundingClientRect().height);
    }
    // pages/see-reward-model.md:188 compares part 5 against BLOCK 4a rather
    // than against the whole of part 4, because act one's part 4 is two results
    // and only the first is the one part 5 qualifies.
    const four = document.querySelector('[data-part="4"]');
    const blocks = four ? [...four.querySelectorAll(".act-b")] : [];
    return {
      parts,
      block4a: blocks[0] ? Math.round(blocks[0].getBoundingClientRect().height) : null,
      scrollWidth: document.documentElement.scrollWidth,
      viewport: w,
      pageHeight: Math.round(document.body.scrollHeight),
    };
  }, width);
  const p4 = out.parts["4"] ?? 0;
  const p5 = out.parts["5"] ?? 0;
  console.log(
    `${width}  part4=${p4}px  part5=${p5}px  delta=${p5 - p4 >= 0 ? "+" : ""}${p5 - p4}px  ` +
      `4a=${out.block4a ?? "-"}px  ` +
      `page=${out.pageHeight}px  scrollWidth=${out.scrollWidth}` +
      `${out.scrollWidth > width ? " *** OVERFLOW ***" : ""}`,
  );
  await page.close();
}

await browser.close();
