// Gate 12 · Redirects
//
// The old check validated the 88-entry map by asserting each DESTINATION
// exists. That confirms the destination is present. It does not serve the
// source, and it is why 31 same-origin URLs about to 404 were invisible while
// this gate was green (C-3). D-26 strengthens it: for every entry, assert the
// **old** path resolves in dist/ and that it points at its stated destination.
//
// Two maps, and they are not the same kind of thing:
//
//   A. astro.config.mjs `redirects` — the four migrated families, SAME ORIGIN
//      on this site. These must resolve here. Read by importing the config, so
//      the map has one source rather than a copy.
//
//   B. src/data/redirects.json — 88 old MkDocs paths, all under /reward-lens/,
//      which is a DIFFERENT origin path served by the old Pages deployment.
//      This site cannot serve them and asserting they resolve here would be
//      asserting something false. For map B the destination-exists check is the
//      correct check, and it is labelled as such rather than left to look like
//      the same assurance.
//
// Usage:  node scripts/checks/redirects.mjs [dist]

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DIST, ROOT, readJson, recordVacuity } from "./_lib.mjs";

const dist = process.argv[2] ?? DIST;

const config = (await import(pathToFileURL(join(ROOT, "astro.config.mjs")).href)).default;
const sameOrigin = config.redirects ?? {};
const legacy = readJson(join(ROOT, "src", "data", "redirects.json"), {});

let failures = 0;

// ---------------------------------------------------------------------------
// Map A: the old path must resolve, and point where it says
// ---------------------------------------------------------------------------

const REFRESH = /<meta\s+http-equiv=["']refresh["']\s+content=["']\s*\d+\s*;\s*url=([^"']+)["']/i;
const CANONICAL = /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i;

let resolved = 0;
let destMissing = 0;
const entriesA = Object.entries(sameOrigin);

for (const [oldPath, target] of entriesA) {
  const dest = typeof target === "string" ? target : target.destination;
  const file = join(dist, oldPath.replace(/^\//, ""), "index.html");

  if (!existsSync(file)) {
    console.error(`FAIL ${oldPath} does not resolve in dist/. Nothing is served at the old path.`);
    failures += 1;
    continue;
  }
  const html = readFileSync(file, "utf-8");
  const refresh = html.match(REFRESH);
  if (!refresh) {
    console.error(
      `FAIL ${oldPath} resolves but is not a redirect. A page file is shadowing the redirect, so the old URL serves stale content instead of moving the reader to ${dest}.`,
    );
    failures += 1;
    continue;
  }
  if (refresh[1] !== dest) {
    console.error(`FAIL ${oldPath} redirects to ${refresh[1]}, not to its stated destination ${dest}`);
    failures += 1;
    continue;
  }
  const canonical = html.match(CANONICAL);
  if (!canonical || !canonical[1].endsWith(dest)) {
    console.error(
      `FAIL ${oldPath} redirects to ${dest} but its canonical link is ${canonical?.[1] ?? "absent"}`,
    );
    failures += 1;
    continue;
  }
  resolved += 1;

  // The destination is a wave-1 packet's page. Its absence is reported, not
  // failed, because the redirect mechanism is correct either way and the pages
  // belong to P6.
  if (!existsSync(join(dist, dest.replace(/^\//, ""), "index.html"))) destMissing += 1;
}

// ---------------------------------------------------------------------------
// Map B: destination-exists, and labelled as the weaker assurance it is
// ---------------------------------------------------------------------------

let legacyFailures = 0;
const entriesB = Object.entries(legacy);
for (const [oldPath, newPath] of entriesB) {
  if (!existsSync(join(dist, newPath, "index.html"))) {
    console.error(`FAIL legacy redirect destination missing: ${oldPath} -> ${newPath}`);
    legacyFailures += 1;
    failures += 1;
  }
}

if (destMissing) {
  recordVacuity(
    12,
    `${destMissing} of ${entriesA.length} same-origin redirect destinations do not exist in dist/ yet. The redirect resolves and points at the right place; the page it points at is packet P6's (/log/**, /atlas/).`,
  );
}

console.log(
  `\nredirects: map A (same origin, D-26) ${resolved}/${entriesA.length} old paths resolve as redirects to their stated destination` +
    (destMissing ? `; ${destMissing} destination(s) not built yet (P6)` : ""),
);
console.log(
  `redirects: map B (src/data/redirects.json) ${entriesB.length} entries, destination-exists only. ` +
    `Those old paths are under /reward-lens/, a different origin served by the old deployment, so this site cannot resolve them (C-3).`,
);
console.log(`redirects: ${failures} failures`);
process.exit(failures > 0 ? 1 : 0);
