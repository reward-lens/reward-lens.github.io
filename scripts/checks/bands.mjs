// Gate 22 · Figure data binding
//
// A rendered band width, bar height or trace point that disagrees with its
// source JSON. Four component contracts name this gate:
//
//   figure-frame.md:147     band widths in the SVG room, within one rendered pixel
//   data-table.md:159       micro-bar widths match their percentage, within one pixel
//   intervention-panel.md:173  every rendered rank, value and percentage matches its source
//   before-after.md:174     bar lengths match their source values, within one pixel
//
// The failure this catches is a figure that looks right. A bar drawn at 62%
// beside a number that says 58% is invisible to every reviewer and obvious to
// nobody, and it is the single defect that would most damage a site whose
// argument is that its numbers resolve.
//
// THE CONTRACT, so the packets that render figures can bind to it. Any element
// whose geometry encodes a value carries:
//
//   data-bound-value   the numeric value it draws
//   data-bound-scale   the value that maps to 100% of the measured axis
//   data-bound-axis    "width" | "height"  (default "width")
//   data-bound-source  where the value came from, e.g.
//                      "data/decomposition.json#components[2].magnitude"
//
// The gate measures the element's rendered box against its parent's content
// box, computes the implied value, and fails when it is more than one rendered
// pixel from data-bound-value. It also re-reads data-bound-source and fails if
// the source no longer holds that value, which catches a figure that is
// internally consistent and describing last week's data.
//
// Usage:  node scripts/checks/bands.mjs [url]

import { join } from "node:path";
import { DIST, ROOT, serveDist, gateRoutes, isRedirectStub, readJson, skip, launchBrowser } from "./_lib.mjs";

const server = await serveDist(DIST);
const explicit = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
const { routes } = gateRoutes(DIST);
const targets = explicit ? [explicit] : routes.filter((r) => !isRedirectStub(r, DIST));

const { browser, engine } = await launchBrowser();
console.log(`browser: ${engine}`);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

let bound = 0;
let failures = 0;
const routesWithFigures = [];

for (const route of targets) {
  const url = explicit ? route : server.origin + route;
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);

  const measured = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("[data-bound-value]")) {
      const axis = el.dataset.boundAxis === "height" ? "height" : "width";
      const box = el.getBoundingClientRect();
      const parent = el.parentElement?.getBoundingClientRect();
      if (!parent) continue;
      const span = axis === "height" ? parent.height : parent.width;
      const drawn = axis === "height" ? box.height : box.width;
      out.push({
        value: Number(el.dataset.boundValue),
        scale: Number(el.dataset.boundScale ?? 1),
        source: el.dataset.boundSource ?? null,
        axis,
        drawnPx: drawn,
        spanPx: span,
        label: el.getAttribute("aria-label") ?? el.tagName.toLowerCase(),
      });
    }
    return out;
  });

  if (measured.length) routesWithFigures.push(`${route} (${measured.length})`);

  for (const m of measured) {
    bound += 1;
    if (!Number.isFinite(m.value) || !Number.isFinite(m.scale) || m.scale === 0 || m.spanPx === 0) {
      console.error(`FAIL ${route}: ${m.label} carries data-bound-value="${m.value}" with an unusable scale or container.`);
      failures += 1;
      continue;
    }
    const expectedPx = (m.value / m.scale) * m.spanPx;
    const deltaPx = Math.abs(expectedPx - m.drawnPx);
    if (deltaPx > 1) {
      console.error(
        `FAIL ${route}: ${m.label} draws ${m.drawnPx.toFixed(2)}px where its value ${m.value} of ${m.scale} implies ${expectedPx.toFixed(2)}px. Off by ${deltaPx.toFixed(2)}px, limit 1.`,
      );
      failures += 1;
      continue;
    }
    if (m.source) {
      const [file, accessor] = m.source.split("#");
      const doc = readJson(join(ROOT, file.startsWith("src/") ? file : join("src", file)));
      if (!doc) {
        console.error(`FAIL ${route}: ${m.label} cites ${m.source} and that file does not exist.`);
        failures += 1;
        continue;
      }
      const actual = accessor
        .replace(/\[(\d+)\]/g, ".$1")
        .split(".")
        .filter(Boolean)
        .reduce((acc, k) => (acc == null ? acc : acc[k]), doc);
      if (actual == null || Math.abs(Number(actual) - m.value) > 1e-9) {
        console.error(
          `FAIL ${route}: ${m.label} draws ${m.value} and its source ${m.source} now holds ${JSON.stringify(actual)}. The figure is internally consistent and describing stale data.`,
        );
        failures += 1;
      }
    }
  }
}

await browser.close();
await server.close();

if (bound === 0) {
  skip(
    22,
    `no element on any built route carries data-bound-value. Packets P3 (the SVG room), P4 (the three interactives) and P6 (the log figures) bind their figures to it. The contract is in this file's header. Until one lands there is no geometry to check and a pass would be a pass nobody earned.`,
  );
}

console.log(
  `\nbands: ${targets.length} route(s), ${bound} data-bound element(s) measured on ${routesWithFigures.length} route(s), ${failures} failures`,
);
if (routesWithFigures.length) console.log(`bands: ${routesWithFigures.join(", ")}`);
process.exit(failures > 0 ? 1 : 0);
