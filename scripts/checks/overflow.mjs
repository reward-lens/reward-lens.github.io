// Gate 19 · Responsive geometry
//
// document.documentElement.scrollWidth must not exceed the viewport at 320,
// 360, 390, 768, 1024, 1440 and 1920. This is one of the two gates the previous
// site did not have at all.
//
// **It uses a real browser viewport through Playwright, never
// `chrome --headless --window-size`.** HANDOFF.md trap 1: the latter does not
// establish a mobile layout viewport. It lays out at desktop width and crops,
// which looks exactly like horizontal overflow and is not, and it cost three
// iterations of fixing a mobile bug that did not exist. A specimen that
// measured correct at 390px appeared clipped under --window-size=390.
//
// When it fails it names the widest element it can find, because "the page
// overflows by 40px" is not actionable and "this table is 40px wider than its
// container" is. The usual cause is min-width: auto on a flex or grid child,
// not a missing max-width (trap 2).
//
// Usage:  node scripts/checks/overflow.mjs [--sample]

import { DIST, serveDist, gateRoutes, distPages, routeOf, isRedirectStub, recordVacuity, launchBrowser } from "./_lib.mjs";

const WIDTHS = [320, 360, 390, 768, 1024, 1440, 1920];
const SAMPLE = process.argv.includes("--sample");

const { routes: sampled, absent } = gateRoutes(DIST);
const routes = (SAMPLE ? sampled : distPages(DIST).map((f) => routeOf(f, DIST))).filter(
  (r) => !isRedirectStub(r, DIST),
);

if (routes.length === 0) {
  console.error("FAIL overflow: no built routes. Run npm run build first.");
  process.exit(1);
}
if (absent.length) {
  console.warn(
    `\nWARN gate 19 is partially vacuous: ${absent.length} specified route(s) are not built:\n  ${absent.join("\n  ")}`,
  );
  recordVacuity(19, `${absent.length} specified route(s) not built: ${absent.join(", ")}`);
}

const server = await serveDist(DIST);
const { browser, engine } = await launchBrowser();
console.log(`browser: ${engine}`);

let failures = 0;
let measurements = 0;

for (const theme of ["dark", "light"]) {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme: theme,
      deviceScaleFactor: 1,
    });
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem("theme", t);
      } catch {}
      document.documentElement.setAttribute("data-theme", t);
    }, theme);
    const page = await ctx.newPage();

    for (const route of routes) {
      await page.goto(server.origin + route, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const r = await page.evaluate((vw) => {
        const doc = document.documentElement;
        if (doc.scrollWidth <= vw) return { ok: true, scrollWidth: doc.scrollWidth };
        // Name the culprit. The widest element whose right edge is past the
        // viewport and whose parent's is not, which is the one that broke out.
        let worst = null;
        for (const el of document.querySelectorAll("*")) {
          const b = el.getBoundingClientRect();
          const right = b.right + window.scrollX;
          if (right <= vw + 0.5) continue;
          if (!worst || right > worst.right) {
            worst = {
              right,
              tag: el.tagName.toLowerCase(),
              cls: (el.className?.baseVal ?? el.className ?? "").toString().slice(0, 60),
              width: Math.round(b.width),
            };
          }
        }
        return { ok: false, scrollWidth: doc.scrollWidth, worst };
      }, width);

      measurements += 1;
      if (!r.ok) {
        failures += 1;
        console.error(
          `FAIL ${route} at ${width}px (${theme}): scrollWidth ${r.scrollWidth} > ${width}` +
            (r.worst
              ? `\n     widest overflowing element: <${r.worst.tag} class="${r.worst.cls}"> ${r.worst.width}px wide, right edge at ${Math.round(r.worst.right)}` +
                `\n     Usually min-width: auto on a flex or grid child, not a missing max-width. Wide content scrolls inside its own overflow-x: auto container.`
              : ""),
        );
      }
    }
    await ctx.close();
  }
}

await browser.close();
await server.close();

console.log(
  `\noverflow: ${measurements} measurements (${routes.length} routes x ${WIDTHS.length} widths x 2 themes), ${failures} failures`,
);
process.exit(failures > 0 ? 1 : 0);
