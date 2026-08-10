// Gate 23 · Visual baseline
//
// Fails on more than 0.4% changed pixels on a route the change did not touch.
//
// This exists because visual drift is invisible to the person causing it. An
// agent adjusting a component's padding sees the component it is adjusting and
// does not see the four other routes that use it. Every visual defect found
// during design was invisible in the code and obvious in the picture, and this
// is the mechanical version of looking at the picture.
//
// The baseline is frozen after wave 1 merges: every route, at 390 and 1440, in
// both themes. D-30 records why the compat shim has to survive that long, which
// is exactly this: the baseline has to be frozen against something real, and
// shipping the legacy pages unstyled would make every intermediate build
// unreviewable.
//
// "A route the change did not touch" is the part a naive implementation gets
// wrong. This gate does not know what a change touched, so it reports the diff
// per route and fails on the threshold; the reviewer decides which routes were
// in scope. `--accept <route>` re-baselines one route and records why in the
// baseline manifest, so accepting a change is a written act rather than a
// deleted file.
//
// Usage:
//   node scripts/checks/visual-diff.mjs
//   node scripts/checks/visual-diff.mjs --record            freeze the baseline
//   node scripts/checks/visual-diff.mjs --accept /docs/ "reason"

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DIST, ROOT, serveDist, gateRoutes, distPages, routeOf, isRedirectStub, readJson, skip, launchBrowser } from "./_lib.mjs";
import { pixelDiff } from "./_lib.mjs";

const BASELINE = join(ROOT, "design", "dossier", "baseline");
const MANIFEST = join(BASELINE, "manifest.json");
const THRESHOLD = 0.004; // 0.4%
const WIDTHS = [390, 1440];

const RECORD = process.argv.includes("--record");
const ACCEPT = process.argv.includes("--accept") ? process.argv[process.argv.indexOf("--accept") + 1] : null;
const SAMPLE = process.argv.includes("--sample");

const { routes: sampled } = gateRoutes(DIST);
const routes = (SAMPLE ? sampled : distPages(DIST).map((f) => routeOf(f, DIST))).filter(
  (r) => !isRedirectStub(r, DIST),
);

if (!RECORD && !existsSync(MANIFEST)) {
  skip(
    23,
    `no visual baseline at design/dossier/baseline/. It is frozen after wave 1 merges, per the brief's §6.6: comparing today's half-built routes against each other would freeze a baseline of work in progress. Freeze it with: node scripts/checks/visual-diff.mjs --record`,
  );
}

const key = (route, width, theme) =>
  `${route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "index"}-${width}-${theme}.png`;

const server = await serveDist(DIST);
const { browser, engine } = await launchBrowser();
console.log(`browser: ${engine}`);

const shots = new Map();
for (const theme of ["dark", "light"]) {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme: theme,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem("theme", t);
      } catch {}
      document.documentElement.setAttribute("data-theme", t);
    }, theme);
    const page = await ctx.newPage();
    // Freeze animation so the diff measures drift and not a running transition.
    await page.addStyleTag({
      content: `*,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important}`,
    }).catch(() => {});

    for (const route of routes) {
      await page.goto(server.origin + route, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await page.addStyleTag({
        content: `*,*::before,*::after{animation:none !important;transition:none !important}`,
      });
      shots.set(key(route, width, theme), { route, width, theme, buf: await page.screenshot({ fullPage: true }) });
    }
    await ctx.close();
  }
}

const measurePage = await browser.newPage();
await measurePage.goto("about:blank");

if (RECORD) {
  mkdirSync(BASELINE, { recursive: true });
  for (const [name, s] of shots) writeFileSync(join(BASELINE, name), s.buf);
  writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        _what_this_is:
          "Gate 23's frozen visual baseline. Every route at 390 and 1440 in both themes, animation frozen. A subsequent build that changes more than 0.4% of the pixels on a route it did not touch fails. Re-baselining a route is a written act: use --accept <route> \"<reason>\" so the acceptance carries its reason.",
        frozenAt: new Date().toISOString(),
        routes: routes.length,
        widths: WIDTHS,
        images: shots.size,
        accepted: readJson(MANIFEST)?.accepted ?? [],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`visual-diff: froze ${shots.size} baseline images for ${routes.length} route(s) -> ${BASELINE}`);
  await browser.close();
  await server.close();
  process.exit(0);
}

const manifest = readJson(MANIFEST);
let failures = 0;
let compared = 0;
let missing = 0;
const worst = [];

for (const [name, s] of shots) {
  const file = join(BASELINE, name);
  if (!existsSync(file)) {
    missing += 1;
    console.warn(`WARN ${s.route} at ${s.width} (${s.theme}) is not in the baseline. New route; re-record after review.`);
    continue;
  }
  const d = await pixelDiff(measurePage, readFileSync(file), s.buf, 8);
  compared += 1;
  const fraction = d.changed / d.total;
  worst.push({ route: s.route, width: s.width, theme: s.theme, fraction, sizeMismatch: d.sizeMismatch });
  if (fraction > THRESHOLD) {
    if (ACCEPT && s.route === ACCEPT) {
      writeFileSync(file, s.buf);
      const accepted = manifest.accepted ?? [];
      accepted.push({
        route: s.route,
        width: s.width,
        theme: s.theme,
        changed: Number((fraction * 100).toFixed(3)),
        reason: process.argv[process.argv.indexOf("--accept") + 2] ?? "no reason given",
        at: new Date().toISOString(),
      });
      writeFileSync(MANIFEST, JSON.stringify({ ...manifest, accepted }, null, 2) + "\n");
      console.log(`ACCEPTED ${s.route} at ${s.width} (${s.theme}): ${(fraction * 100).toFixed(2)}% changed`);
      continue;
    }
    failures += 1;
    console.error(
      `FAIL ${s.route} at ${s.width} (${s.theme}): ${(fraction * 100).toFixed(2)}% of pixels changed, limit ${(THRESHOLD * 100).toFixed(1)}%` +
        (d.sizeMismatch ? `  (the page changed size: ${d.a} -> ${d.b})` : ""),
    );
  }
}

const baselineFiles = existsSync(BASELINE) ? readdirSync(BASELINE).filter((f) => f.endsWith(".png")) : [];
const orphaned = baselineFiles.filter((f) => !shots.has(f));
for (const o of orphaned) console.warn(`WARN baseline image ${o} has no route in this build. Route removed?`);

worst.sort((a, b) => b.fraction - a.fraction);
console.log(`\nvisual-diff: largest movements`);
for (const w of worst.slice(0, 5)) {
  console.log(`  ${(w.fraction * 100).toFixed(3)}%  ${w.route} ${w.width} ${w.theme}`);
}

await measurePage.close();
await browser.close();
await server.close();

console.log(
  `\nvisual-diff: ${compared} comparison(s), ${missing} new route(s), ${orphaned.length} orphaned baseline image(s), ${failures} failures`,
);
process.exit(failures > 0 ? 1 : 0);
