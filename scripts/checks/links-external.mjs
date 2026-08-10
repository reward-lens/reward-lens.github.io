// Gate 11 · Links, external
//
// A status-only check is not enough, and C-5 is the reason. Re-checked live:
//
//   https://reward-lens.github.io/reward-lens/     404   the v3 README and mkdocs.yml:15
//   https://reward-lens.readthedocs.io             404   `Documentation` on PyPI
//   https://github.com/suhailnadaf509/reward-lens  200   `Homepage` on PyPI
//
// Two of those fail on status. The third **passes on status while being the
// wrong destination**: it is a personal fork, published as the project's
// homepage. A gate that only looks for a 2xx never sees it. So gate 11 carries
// an expected-destination assertion, and the destination is compared after
// redirects are followed, because that is where a wrong destination hides.
//
// **This gate fails on day one, on purpose, on URLs the project itself
// publishes.** That is the correct behaviour and it is not a broken gate. D-06
// says the site must not link them and the failure is the record that they are
// still published wrongly elsewhere. Do not allow-list them to make this green.
//
// C-23 adds a fourth that nobody has ever checked: copy.yaml:urls.preprint.
//
// Usage:
//   node scripts/checks/links-external.mjs          copy.yaml:urls + published-elsewhere
//   node scripts/checks/links-external.mjs --all    also every external URL in dist/

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DIST, ROOT, distPages, routeOf, readJson, parseCopy, leafStrings } from "./_lib.mjs";

const ALL = process.argv.includes("--all");
const expectations = readJson(join(ROOT, "scripts", "checks", "external-expectations.json"));
const copy = await parseCopy();

const TIMEOUT_MS = 20_000;

/** Follow redirects by hand so the final URL is observable, not just the status. */
async function resolve(url) {
  let current = url;
  const chain = [];
  for (let hop = 0; hop < 8; hop += 1) {
    let res;
    try {
      res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { "user-agent": "reward-lens-site-gate-11" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      return { status: 0, final: current, chain, error: e.message };
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = new URL(res.headers.get("location"), current).href;
      chain.push(`${res.status} -> ${next}`);
      current = next;
      continue;
    }
    return { status: res.status, final: current, chain };
  }
  return { status: 0, final: current, chain, error: "too many redirects" };
}

const norm = (u) => u.replace(/\/+$/, "").toLowerCase();

let failures = 0;
const results = [];

// ---------------------------------------------------------------------------
// 1. Every URL in copy.yaml:urls, with its expected destination
// ---------------------------------------------------------------------------

const urls = leafStrings(copy.urls ?? {});
for (const [key, url] of Object.entries(urls)) {
  const expect = expectations.expected[key];
  const r = await resolve(url);
  const ok2xx = r.status >= 200 && r.status < 300;
  const destOk = !expect || norm(r.final) === norm(expect);
  results.push({ scope: `copy.yaml:urls.${key}`, url, ...r, expect });

  if (!ok2xx) {
    console.error(`FAIL copy.yaml:urls.${key}  ${url}`);
    console.error(`     status ${r.status || "network error"}${r.error ? `  (${r.error})` : ""}`);
    failures += 1;
  } else if (!destOk) {
    console.error(`FAIL copy.yaml:urls.${key}  ${url}`);
    console.error(`     status ${r.status} but resolved to ${r.final}`);
    console.error(`     expected              ${expect}`);
    if (r.chain.length) console.error(`     chain: ${r.chain.join(" | ")}`);
    failures += 1;
  } else if (!expect) {
    console.warn(
      `WARN copy.yaml:urls.${key} has no expected destination in external-expectations.json. Status-only.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. The URLs the project publishes elsewhere. These are expected to fail.
// ---------------------------------------------------------------------------

console.log(`\nURLs the project publishes elsewhere (D-06, C-5, C-23):`);
for (const entry of expectations.published_elsewhere) {
  const r = await resolve(entry.url);
  const ok2xx = r.status >= 200 && r.status < 300;
  const destOk = !entry.should_be || norm(r.final) === norm(entry.should_be);
  results.push({ scope: `published:${entry.published_as}`, url: entry.url, ...r });

  const verdict = !ok2xx ? "DEAD" : !destOk ? "WRONG DESTINATION" : "ok";
  console.log(`  ${String(r.status).padStart(3)}  ${verdict.padEnd(18)}  ${entry.url}`);
  console.log(`       published as ${entry.published_as}, at ${entry.published_at}`);
  if (verdict !== "ok") {
    console.error(
      `FAIL ${entry.url}: ${verdict}. ${entry.why}` +
        (entry.should_be ? `  Correct destination: ${entry.should_be}.` : ""),
    );
    failures += 1;
  }
}

// ---------------------------------------------------------------------------
// 3. The forbidden URLs must not appear in built output. No network needed.
// ---------------------------------------------------------------------------

const forbidden = expectations.published_elsewhere
  .filter((e) => e.must_not_be_linked)
  .map((e) => e.url);
let linkedForbidden = 0;
for (const file of distPages(DIST)) {
  const html = readFileSync(file, "utf-8");
  for (const url of forbidden) {
    if (html.includes(url)) {
      console.error(`FAIL ${routeOf(file)} links a forbidden URL: ${url}`);
      linkedForbidden += 1;
      failures += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Optionally every external URL in built output
// ---------------------------------------------------------------------------

let sweptExternals = 0;
if (ALL) {
  const externals = new Set();
  for (const file of distPages(DIST)) {
    const html = readFileSync(file, "utf-8");
    for (const m of html.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)) {
      const u = m[1].split("#")[0];
      if (u.startsWith("http://www.w3.org/")) continue; // SVG and XML namespaces
      externals.add(u);
    }
  }
  sweptExternals = externals.size;
  console.log(`\nSweeping ${externals.size} distinct external URLs from built output.`);
  const list = [...externals];
  const CONCURRENCY = 8;
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = await Promise.all(list.slice(i, i + CONCURRENCY).map(async (u) => [u, await resolve(u)]));
    for (const [u, r] of batch) {
      if (r.status < 200 || r.status >= 400) {
        console.error(`FAIL external ${u}: status ${r.status || "network error"}`);
        failures += 1;
      }
    }
  }
}

console.log(
  `\nlinks-external: ${Object.keys(urls).length} copy.yaml URLs, ${expectations.published_elsewhere.length} published-elsewhere URLs, ` +
    `${linkedForbidden} forbidden URLs linked in dist, ${sweptExternals} swept from output, ${failures} failures`,
);
process.exit(failures > 0 ? 1 : 0);
