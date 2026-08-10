/**
 * What a reader actually downloads, captured from the network rather than
 * inferred from the HTML.
 *
 * WHY NOT THE STATIC SWEEP. `scripts/checks/budgets.mjs` reads index.html,
 * collects href/src and inline _astro references, and sums them. That misses
 * everything reached through a dynamic import, which on this site is the entire
 * scene: the homepage's island is a 95-byte stub that imports a 3.9 KB mount
 * that lazily imports a 1.2 MB chunk, and none of the three appear as an href.
 * The gate therefore reports the homepage at 57,259 bytes of JavaScript while
 * 430 KB compressed arrives. So this walks the network instead, and reports the
 * critical path and the eventual total separately, because they are different
 * questions and one number cannot answer both.
 *
 * Sizes are Chrome's own `encodedDataLength`, which is bytes on the wire after
 * content-encoding. The test server does not compress, so each response is also
 * gzipped here and both are reported: the wire figure is what this server sent,
 * the gzip figure is what a real host would send.
 *
 * Usage: node tests/perf/network.mjs [--routes=/,/log/,/atlas/]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { ROOT, DIST, serveDist, launchBrowser } from "../../scripts/checks/_lib.mjs";

const flag = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=").slice(1).join("=") : d;
};
const ROUTES = flag("routes", "/,/log/,/atlas/,/docs/,/see/").split(",").filter(Boolean);

const server = await serveDist(DIST);
const { browser, engine } = await launchBrowser();

const typeOf = (url, ct) => {
  if (/\.woff2?$/.test(url)) return "font";
  if (/\.(js|mjs)$/.test(url)) return "script";
  if (/\.css$/.test(url)) return "style";
  if (/\.(png|jpe?g|webp|avif|gif|svg)$/.test(url)) return "image";
  if (/\.(bin|json)$/.test(url)) return "data";
  if (/text\/html/.test(ct ?? "")) return "document";
  return "other";
};

/**
 * One visit.
 *
 * `settle` is how long to keep listening after load. The scene is imported on
 * `requestIdleCallback`, so a capture that stops at the load event records a
 * homepage with no scene on it and reports a number nobody will ever
 * experience.
 */
async function visit({ route, warm, cpuThrottle, netThrottle, settle = 12000 }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const client = await ctx.newCDPSession(page);
  await client.send("Network.enable");
  if (cpuThrottle) await client.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
  if (netThrottle) {
    await client.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: netThrottle.latency,
      downloadThroughput: netThrottle.down,
      uploadThroughput: netThrottle.up,
    });
  }

  const reqs = new Map();
  page.on("response", async (res) => {
    const url = res.url();
    try {
      const body = await res.body();
      const ct = res.headers()["content-type"];
      reqs.set(url.replace(server.origin, ""), {
        url: url.replace(server.origin, ""),
        status: res.status(),
        raw: body.length,
        gzip: gzipSync(body).length,
        type: typeOf(url, ct),
      });
    } catch {}
  });

  if (warm) {
    // A warm cache is a second visit, not a flag. Load once, then again in the
    // same context so the HTTP cache is the one the browser really built.
    await page.goto(server.origin + route, { waitUntil: "load" });
    await page.waitForTimeout(settle);
    reqs.clear();
  }

  await page.goto(server.origin + route, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(settle);

  // WHICH RESOURCES WERE ON THE CRITICAL PATH.
  //
  // The first version of this asked Playwright, by snapshotting the response map
  // at the moment `goto` resolved. That is a race and it lost: `res.body()` is
  // awaited, so responses land in the map after the snapshot, and the homepage
  // reported 0 bytes critical while fifteen resources had already arrived.
  //
  // Resource Timing is asked inside the page instead, after everything has
  // settled, and each entry carries its own responseEnd. Comparing that against
  // loadEventEnd is a comparison between two recorded times rather than between
  // a recorded time and whenever this script happened to look.
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const loadEnd = nav ? nav.loadEventEnd : 0;
    const out = {};
    for (const e of performance.getEntriesByType("resource")) {
      out[new URL(e.name).pathname] = { responseEnd: e.responseEnd, beforeLoad: e.responseEnd <= loadEnd };
    }
    return { loadEnd, resources: out };
  });

  const vitals = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const out = { fcp: 0, lcp: 0, cls: 0, longTasks: [], tbt: 0 };
        try {
          for (const e of performance.getEntriesByType("paint")) {
            if (e.name === "first-contentful-paint") out.fcp = e.startTime;
          }
        } catch {}
        try {
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) out.lcp = Math.max(out.lcp, e.startTime);
          }).observe({ type: "largest-contentful-paint", buffered: true });
        } catch {}
        try {
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) if (!e.hadRecentInput) out.cls += e.value;
          }).observe({ type: "layout-shift", buffered: true });
        } catch {}
        try {
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) {
              out.longTasks.push(Math.round(e.duration));
              // Total blocking time is the excess over 50ms per long task, which
              // is the definition; summing the durations instead inflates it.
              out.tbt += Math.max(0, e.duration - 50);
            }
          }).observe({ type: "longtask", buffered: true });
        } catch {}
        setTimeout(() => resolve(out), 600);
      }),
  );

  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return n ? { domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd, transfer: n.transferSize } : null;
  });

  // The document itself is always critical; Resource Timing does not list it.
  const all = [...reqs.values()].map((r) => ({
    ...r,
    beforeLoad: r.type === "document" ? true : (timing.resources[r.url]?.beforeLoad ?? false),
    responseEnd: timing.resources[r.url]?.responseEnd ?? 0,
  }));
  const critical = all.filter((r) => r.beforeLoad);
  const sum = (list, k) => list.reduce((n, r) => n + r[k], 0);
  const byType = {};
  for (const r of all) {
    byType[r.type] = byType[r.type] ?? { n: 0, raw: 0, gzip: 0 };
    byType[r.type].n += 1;
    byType[r.type].raw += r.raw;
    byType[r.type].gzip += r.gzip;
  }

  const sceneReady = await page.evaluate(() => document.documentElement.dataset.sceneReady === "true");
  await ctx.close();
  return {
    route,
    warm: !!warm,
    cpuThrottle: cpuThrottle ?? 1,
    netThrottle: netThrottle ? "1.6Mbps/150ms" : "unthrottled",
    requests: all.length,
    totalRaw: sum(all, "raw"),
    totalGzip: sum(all, "gzip"),
    criticalRequests: critical.length,
    criticalRaw: sum(critical, "raw"),
    criticalGzip: sum(critical, "gzip"),
    byType,
    vitals: { ...vitals, longTaskCount: vitals.longTasks.length, longTasks: vitals.longTasks.slice(0, 12) },
    nav,
    loadEventEnd: timing.loadEnd,
    sceneReady,
    afterLoad: all
      .filter((r) => !r.beforeLoad)
      .sort((a, b) => b.gzip - a.gzip)
      .map((r) => ({ url: r.url, gzip: r.gzip, raw: r.raw, responseEnd: Math.round(r.responseEnd) })),
    heaviest: all.sort((a, b) => b.gzip - a.gzip).slice(0, 8).map((r) => ({ url: r.url, gzip: r.gzip, raw: r.raw })),
  };
}

// THE WARM-CACHE ROW IS NOT A WARM-CACHE MEASUREMENT ON THIS SERVER.
// serveDist sends `cache-control: no-store` on every response, so a second
// visit re-fetches everything and the "warm" row measures a cold visit with a
// primed connection. Whether that is so is read off the wire rather than
// assumed, and the row is labelled from what the header actually said.
const probe = await fetch(server.origin + "/");
const cacheControl = probe.headers.get("cache-control");
const cachingPossible = !/no-store/i.test(cacheControl ?? "");

const results = [];
for (const route of ROUTES) {
  results.push(await visit({ route }));
}
// The homepage under the conditions §19 states the budget against, and warm.
results.push(await visit({ route: "/", cpuThrottle: 4, netThrottle: { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8 } }));
results.push(await visit({ route: "/", warm: true }));

await browser.close();
await server.close();

const kb = (n) => (n / 1024).toFixed(1);
console.log(`\nnetwork, captured from Chrome (${engine}). Sizes are response bodies; gzip is applied here because the test server does not compress.\n`);
console.log(`  route              cond                 reqs   critical gz   total gz   FCP     LCP     CLS      TBT    scene`);
for (const r of results) {
  const cond = `${r.warm ? "warm" : "cold"} ${r.cpuThrottle}x ${r.netThrottle === "unthrottled" ? "" : r.netThrottle}`.trim();
  console.log(
    `  ${r.route.padEnd(18)} ${cond.padEnd(20)} ${String(r.requests).padStart(4)}   ${kb(r.criticalGzip).padStart(9)} KB ${kb(r.totalGzip).padStart(9)} KB` +
      `  ${Math.round(r.vitals.fcp).toString().padStart(5)}ms ${Math.round(r.vitals.lcp).toString().padStart(5)}ms ${r.vitals.cls.toFixed(4).padStart(7)} ${Math.round(r.vitals.tbt).toString().padStart(6)}ms  ${r.sceneReady}`,
  );
}

const home = results[0];
console.log(`\n  homepage, by type (cold, unthrottled):`);
for (const [t, v] of Object.entries(home.byType).sort((a, b) => b[1].gzip - a[1].gzip)) {
  console.log(`    ${t.padEnd(10)} ${String(v.n).padStart(3)} files   ${kb(v.gzip).padStart(9)} KB gzip   ${kb(v.raw).padStart(9)} KB raw`);
}
console.log(`\n  homepage, heaviest responses:`);
for (const h of home.heaviest) console.log(`    ${kb(h.gzip).padStart(9)} KB gzip  ${kb(h.raw).padStart(9)} KB raw  ${h.url}`);

mkdirSync(join(ROOT, "design/dossier/build/perf"), { recursive: true });
writeFileSync(
  join(ROOT, "design/dossier/build/perf/network.json"),
  JSON.stringify(
    {
      _method:
        "Every response is captured through Playwright's response event and its body measured; gzip is applied in-process because the static test server sends identity. 'critical' is what had arrived by the load event; 'total' includes everything that arrived in the following 12 seconds, which is where the idle-imported scene lands. Nothing here depends on the GPU, so every number in this file holds on this host.",
      _server: "scripts/checks/_lib.mjs serveDist, an ephemeral port on 127.0.0.1 serving this worktree's dist/ directly, so no astro preview port collision can substitute another worktree's site.",
      engine,
      testServerCacheControl: cacheControl,
      warmCacheMeasurable: cachingPossible,
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `\n  CACHING: the test server sends cache-control "${cacheControl}", so a repeat visit ${
    cachingPossible ? "can reuse the cache" : "CANNOT reuse the cache and the warm row above is a cold visit on a primed connection"
  }. Warm-cache behaviour on the real host depends on headers this repository does not set and could not be measured here.`,
);
console.log(`\nwritten: design/dossier/build/perf/network.json`);
