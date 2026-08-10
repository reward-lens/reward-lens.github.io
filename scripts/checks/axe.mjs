// Gate 14 · Accessibility
//
// This gate is failure four from DESIGN.md §14.3. The script existed before
// this packet and was invoked by neither CI nor `npm run check`, which is how a
// perfect accessibility score becomes a claim nobody is re-checking. It now
// runs in the workflow, on every route, in both themes.
//
// **It lands in CI immediately, failing, against a ratchet.** D-29. Wiring the
// real palette exposed six serious contrast violations in five legacy files,
// all the same defect: --ink-3 on a raised surface, which is 4.29:1 on
// --surface-2 and 3.67:1 on --surface-3. The v1 blue-black palette hid them.
// They are real WCAG failures, they are live in production right now, and none
// is F1's to fix: they belong to P4, P5 and P6, all of which rewrite those
// files during wave 1.
//
//   TokenStrip.css:49            P4
//   AuditWalkthrough.css:26      P4
//   PrevNext.astro:67            P4
//   campaign/[card].astro:281    P6
//   docs/reference/[group].astro:551   P5
//
// Rejected: an allow-list, which is permanent by default. Rejected: holding the
// gate out of CI until wave 1 lands, which is a gate nobody has seen fail, on
// the one dimension the previous site was measurably wrong about, for the whole
// duration of the work that would introduce new violations.
//
// The ratchet may shrink and must not grow, and Q1 cannot sign off while it is
// non-empty.
//
// **The number is 589, not six, and that is the headline finding of this gate.**
// D-29's six were measured on the component gallery, which is where wave 0
// could measure. Run against every route in both themes, as QA.md §1 specifies,
// axe reports 589 serious or critical instances. Five of D-29's named files are
// in there; the rest is the legacy documentation corpus, which no packet had
// scanned because nothing was scanning anything. The ratchet records all of
// them with their owning packet, and the only permitted direction is down.
//
// Usage:
//   node scripts/checks/axe.mjs                 EVERY built route, both themes
//   node scripts/checks/axe.mjs --sample        the specified routes only, for speed
//   node scripts/checks/axe.mjs --record        re-record the ratchet

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  DIST, ROOT, serveDist, gateRoutes, distPages, routeOf, isRedirectStub, recordVacuity, launchBrowser, } from "./_lib.mjs";
import { checkRatchet, readRatchet } from "./_ratchet.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf-8");

const RATCHET = join(ROOT, "scripts", "checks", "ratchet-a11y.txt");
const RECORD = process.argv.includes("--record");
// QA.md §1 says "on every route". Sampling is the local convenience, not the default.
const SAMPLE = process.argv.includes("--sample");

const { routes: gateOnly, absent } = gateRoutes(DIST);
const routes = (SAMPLE ? gateOnly : distPages(DIST).map((f) => routeOf(f, DIST))).filter(
  (r) => !isRedirectStub(r, DIST),
);

if (routes.length === 0) {
  console.error("FAIL axe: no built routes. Run npm run build first.");
  process.exit(1);
}
if (absent.length) {
  console.warn(
    `\nWARN gate 14 is partially vacuous: ${absent.length} specified route(s) are not built and were not scanned:\n  ${absent.join("\n  ")}`,
  );
  recordVacuity(
    14,
    `${absent.length} specified route(s) not built and therefore not scanned: ${absent.join(", ")}`,
  );
}

const server = await serveDist(DIST);
const { browser, engine } = await launchBrowser();
console.log(`browser: ${engine}`);

const observed = [];
let scanned = 0;

for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({ colorScheme: theme });
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
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(() =>
      // eslint-disable-next-line no-undef
      axe.run(document, { resultTypes: ["violations"] }),
    );
    scanned += 1;
    for (const v of result.violations) {
      if (!["serious", "critical"].includes(v.impact)) continue;
      for (const node of v.nodes) {
        observed.push(`${theme} | ${route} | ${v.id} | ${node.target?.[0] ?? "?"}`);
      }
    }
  }
  await ctx.close();
}

await browser.close();
await server.close();

const HEADER = `# Gate 14's ratchet: WCAG 2.2 AA violations that exist today and are somebody's to fix.
#
# One line per violation: owning packet | date recorded | source file | theme | route | rule | selector.
#
# D-29: wiring the real palette exposed six serious contrast violations in five
# legacy files, all --ink-3 on a raised surface, which the v1 blue-black palette
# hid. They belong to P4, P5 and P6, which rewrite those files in wave 1.
#
# THIS LIST MAY SHRINK AND MUST NOT GROW. A violation that is not here fails the
# build. Q1 cannot sign off while this file is non-empty.
#
# It is a ratchet and not an allow-list. An allow-list is permanent by default,
# and it is how the previous site ended up with a perfect accessibility score
# nobody was re-checking. A ratchet expires by construction, because the only
# permitted direction is down. The shape is borrowed from the library's own
# assay/docs/gen_catalogue.py rather than invented here.
#
# Re-record after a packet lands:  node scripts/checks/axe.mjs --record`;

// Owner attribution: by selector first, because a component's defect follows it
// onto every route that uses it, and blaming the route is how a shared
// component's violation gets recorded five times under five owners.
const BY_SELECTOR = [
  [/\.ts-|TokenStrip/, "src/components/islands/TokenStrip.css:49", "P4"],
  [/\.aw-|AuditWalkthrough/, "src/components/islands/AuditWalkthrough.css:26", "P4"],
  [/\.pn-/, "src/components/PrevNext.astro:67", "P4"],
  [/\.sym-|\.line > span/, "src/pages/docs/reference/[group].astro:551", "P5"],
  [/\.rl-chip/, "src/styles/docs-legacy.css", "P5"],
  [/\.card-|\.verdict/, "src/pages/campaign/[card].astro:281", "P6"],
];
const BY_ROUTE = [
  [/^\/404/, "src/pages/404.astro:24-36 (the Pagefind Default UI input)", "P5"],
  [/^\/docs\/reference\//, "src/pages/docs/reference/[group].astro", "P5"],
  [/^\/docs\//, "src/pages/docs/[...slug].astro and the ported corpus", "P5"],
  [/^\/campaign\/|^\/log\//, "src/pages/campaign/**", "P6"],
  [/^\/atlas\/|^\/science\/|^\/evidence\/|^\/about/, "src/pages/**", "P6"],
  [/^\/$/, "src/pages/index.astro", "P3"],
];
const hint = (sig) => {
  const [, route = "", , selector = ""] = sig.split(" | ");
  for (const [re, file, packet] of BY_SELECTOR) if (re.test(selector)) return { file, packet };
  for (const [re, file, packet] of BY_ROUTE) if (re.test(route)) return { file, packet };
  return { file: "unknown", packet: "unassigned" };
};

if (RECORD) {
  const existing = readRatchet(RATCHET);
  const today = new Date().toLocaleDateString("en-CA");
  const body = [...new Set(observed)]
    .sort()
    .map((sig) => {
      const m = existing.meta.get(sig);
      const h = hint(sig);
      return `${m?.packet ?? h.packet} | ${m?.date ?? today} | ${m?.source ?? h.file} | ${sig}`;
    })
    .join("\n");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(RATCHET, `${existing.header || HEADER}\n\n${body}\n`);
  console.log(`axe: recorded ${new Set(observed).size} violations to ${RATCHET}`);
  process.exit(0);
}

const result = checkRatchet(RATCHET, observed, {
  name: "accessibility",
  howToFix:
    "A serious or critical WCAG 2.2 AA violation. Fix it; do not record it. Only a violation in a file a wave-1 packet has not reached yet belongs on the ratchet, and it must carry that packet's name.",
});

for (const line of result.lines) console[result.ok ? "log" : "error"](line);

console.log(
  `\naxe: ${scanned} page scans across ${routes.length} route(s) in two themes, ` +
    `${observed.length} serious or critical violation(s), ${result.size} on the ratchet, ${result.added.length} new`,
);
if (result.size > 0) {
  console.log(`axe: the ratchet is non-empty. Q1 cannot sign off while that is true (D-29).`);
}
process.exit(result.ok ? 0 : 1);
