// The six fallback paths, driven in a real browser and photographed.
//
// Usage:
//   node tests/scene/fallback/_shoot.mjs               dist/ and dist-noscene/
//   node tests/scene/fallback/_shoot.mjs --paths=no-js
//
// WHY THIS EXISTS BESIDE scripts/dev/shoot.mjs. That harness photographs a page
// at widths and themes. Each of these is a different BROWSER, not a different
// width: scripting off, WebGL absent, motion refused, a phone, a throttled
// link, and a build with no island in it. Four of the six cannot be reached by
// setting an attribute on a page that has already loaded.
//
// THREE TRAPS THIS FILE IS BUILT AROUND, all of them recorded in this
// repository after they cost someone a day:
//
//  1. `chrome --headless --window-size=390` does not establish a mobile layout
//     viewport. It lays out at desktop width and crops, which looks exactly
//     like horizontal overflow and is not. Every context here declares a real
//     `viewport` and asserts `scrollWidth <= width`.
//  2. A harness that requests reduced motion and then waits for a signal
//     reduced motion suppresses will hang. Nothing here waits for
//     `data-scene-ready` on a path where the canvas never mounts, and which
//     paths those are is stated in the table below rather than inferred.
//  3. `astro preview --port N` silently binds a different port when N is
//     taken, and six worktrees are live. Nothing here runs a preview server: it
//     serves this worktree's own dist/ over an ephemeral port from an in
//     process server and prints the md5 of the index.html it served, so a
//     capture of another branch's site is impossible rather than unlikely.

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CHROME = "/opt/google/chrome/google-chrome";
const OUT = join(ROOT, "design", "dossier", "build", "fallback");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".bin": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
};

async function serve(dir) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let file = join(dir, path);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file) && existsSync(file + ".html")) file += ".html";
    if (!existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

/**
 * WebGL removed, the way `runtime/tier.ts` actually probes for it.
 *
 * `--disable-gpu` is not this: Chrome falls back to SwiftShader and
 * `getContext("webgl2")` still returns a context, so a shoot with that flag
 * photographs the canvas path and reports the no-WebGL one. The probe creates a
 * context and releases it, so overriding `getContext` for the two webgl ids is
 * the exact surface the decision is made on.
 */
const KILL_WEBGL = `
  const real = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (id, ...rest) {
    if (id === "webgl" || id === "webgl2" || id === "experimental-webgl") return null;
    return real.call(this, id, ...rest);
  };
`;

/**
 * The six paths.
 *
 * `waitsForScene` is stated per path rather than derived, because getting it
 * wrong is trap 2 and the symptom is a hang rather than a wrong picture.
 */
const PATHS = {
  "reduced-motion": {
    dist: "dist",
    context: { reducedMotion: "reduce" },
    waitsForScene: false,
    why: "prefers-reduced-motion: reduce. tier.ts resolves 'still' and the canvas never mounts.",
  },
  "no-webgl": {
    dist: "dist",
    context: { reducedMotion: "no-preference" },
    init: KILL_WEBGL,
    waitsForScene: false,
    why: "getContext returns null for every webgl id, which is what detectWebGL probes.",
  },
  "no-js": {
    dist: "dist",
    context: { javaScriptEnabled: false, reducedMotion: "no-preference" },
    waitsForScene: false,
    /* The one path that also walks the five states, because this is where the
       claim is hardest: with scripting off the state machine is `:checked ~`
       and a native radio group, and either it advances or the fallback is a
       single frozen picture calling itself five states. */
    states: true,
    why: "scripting disabled. The state machine is radio inputs and CSS; nothing publishes a tier.",
  },
  mobile: {
    dist: "dist",
    widths: [390],
    context: {
      reducedMotion: "no-preference",
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
      viewportHeight: 844,
    },
    waitsForScene: false,
    why: "a real mobile layout viewport with touch. tier.ts gives a coarse narrow pointer the low tier.",
  },
  /* The same phone with no WebGL, which is what this packet owns. The row
     above records what the canvas currently does at 390 and it is not a
     fallback result: on a light-theme phone the live room paints a flat grey
     slab over the whole hero. That belongs to the scene packet; it is captured
     here because a shoot that only photographed the paths that work would be
     the reason nobody found it. */
  "mobile-still": {
    dist: "dist",
    widths: [390],
    context: {
      reducedMotion: "no-preference",
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
      viewportHeight: 844,
    },
    init: KILL_WEBGL,
    waitsForScene: false,
    why: "a real phone viewport with no WebGL: the authored narrow composition, labels in the DOM.",
  },
  "slow-link": {
    dist: "dist",
    widths: [1440],
    context: { reducedMotion: "no-preference" },
    throttle: { downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8, latency: 400 },
    waitsForScene: false,
    why: "400kbps with 400ms of latency. The still is inline and costs no request.",
  },
  "kill-switch": {
    dist: "dist-noscene",
    context: { reducedMotion: "no-preference" },
    waitsForScene: false,
    why: "PUBLIC_SCENE=off. The island is not in the build at all.",
  },
};

const arg = (k, d) =>
  (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").pop();
const only = arg("paths", "").split(",").filter(Boolean);
const defaultWidths = arg("widths", "390,768,1440").split(",").map(Number);

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const servers = new Map();
const rows = [];
let failed = false;

for (const [name, spec] of Object.entries(PATHS)) {
  if (only.length && !only.includes(name)) continue;
  const distDir = join(ROOT, spec.dist);
  if (!existsSync(join(distDir, "index.html"))) {
    console.error(`SKIP ${name}: ${spec.dist}/index.html is absent. Build it first.`);
    failed = true;
    continue;
  }
  if (!servers.has(spec.dist)) servers.set(spec.dist, await serve(distDir));
  const server = servers.get(spec.dist);
  const md5 = createHash("md5").update(readFileSync(join(distDir, "index.html"))).digest("hex");
  console.log(`\n${name}  ·  ${spec.why}\n  serving ${spec.dist}/ at ${server.origin}, index.html md5 ${md5}`);

  for (const theme of ["dark", "light"]) {
    for (const width of spec.widths ?? defaultWidths) {
      const { viewportHeight = 900, ...ctxOpts } = spec.context ?? {};
      const ctx = await browser.newContext({
        viewport: { width, height: viewportHeight },
        deviceScaleFactor: 1,
        colorScheme: theme,
        ...ctxOpts,
      });
      if (spec.init) await ctx.addInitScript(spec.init);
      const page = await ctx.newPage();
      if (spec.throttle) {
        const cdp = await ctx.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.emulateNetworkConditions", { offline: false, ...spec.throttle });
      }
      await page.goto(server.origin + "/", { waitUntil: "load" });
      if (spec.waitsForScene) {
        await page
          .waitForSelector('html[data-scene-ready="true"]', { timeout: 12000 })
          .catch(() => console.warn(`  ${name} ${width} ${theme}: scene never became ready`));
      }
      /* FONTS FIRST, AND THIS IS NOT A DETAIL.
         Every measurement in the first four shoots was of the pre-webfont
         layout. The fallback face is narrower, so the public training series'
         caption came out two lines shorter and its readout measured 662 to 838
         against a room ending at 900: comfortably inside, and wrong. With the
         real face it runs past 900 and the source line is cut in half. The
         crop that showed it and the rectangle that denied it were of the same
         page a second apart. scripts/dev/shoot.mjs has awaited this since it
         was written; this harness did not. */
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(spec.throttle ? 2500 : 1200);

      const state = await page.evaluate(() => {
        const layer = document.querySelector("[data-scene-still-layer]");
        const visible = layer ? getComputedStyle(layer).visibility === "visible" : false;
        /* Painted, asked of the browser rather than reconstructed from rules.
           `getClientRects()` is empty for anything a `display: none` ancestor
           suppresses, and `visibility` covers the rest. An earlier version of
           this probe walked up to `[data-case]` and `[data-state]`, which the
           still's own <figure> also carries, so it measured the figure instead
           of its wrapper and reported every case as shown at once. */
        const painted = (n) =>
          n.getClientRects().length > 0 && getComputedStyle(n).visibility === "visible";
        const shown = layer
          ? [...layer.querySelectorAll("[data-scene-still]")].filter(painted)
          : [];
        const schematic = document.querySelector('[data-hero-optics] [data-truth-mode="schematic"]');
        return {
          scrollWidth: document.documentElement.scrollWidth,
          vh: window.innerHeight,
          heroBottom: Math.round(
            document.querySelector("[data-hero]")?.getBoundingClientRect().bottom ?? 0,
          ),
          layerPresent: !!layer,
          layerVisible: visible,
          shownCases: shown.map((n) => n.getAttribute("data-case")),
          shownText: shown.map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 90)),
          schematicOpacity: schematic ? getComputedStyle(schematic).opacity : null,
          /* WHAT SITS ON WHAT.
             The still's chrome lands on the floor beside three things the hero
             already puts there, and a capture at 1440 showed the state controls
             printed straight through the headline because they were positioned
             from the layer's top edge rather than from the axis. Reading the
             rectangles is how that becomes a number instead of an opinion. */
          boxes: Object.fromEntries(
            [
              ["headline", "[data-hero-zone='headline']"],
              ["subhead", "[data-hero-zone='subhead']"],
              /* The strip's own root spans grid rows 2 to 4 and row 3 is `1fr`,
                 so its rect reaches the bottom of the hero and is mostly empty.
                 Measuring it reported an overlap at every width and in every
                 path, which is the shape of a false positive: the two parts
                 that are actually drawn are the surface and the version row. */
              ["strip-root", ".install-strip"],
              ["strip-surface", ".install-strip__surface"],
              ["strip-version", ".install-strip__version"],
              ["secondary", ".hero__secondary"],
              ["controls", "[data-still-controls]"],
            ].flatMap(([name, sel]) => {
              const el = document.querySelector(sel);
              if (!el || el.getClientRects().length === 0) return [];
              const b = el.getBoundingClientRect();
              return [[name, [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]]];
            }),
          ),
          readoutBox: (() => {
            /* `getClientRects()` is non-empty for a `visibility: hidden`
               element, because it is still laid out. Only the scorer state's
               cases carry `display: none`; the other four are hidden by their
               state's visibility, so four readouts answer this query and
               `.find` returned the first in DOM order rather than the one on
               screen. Every measurement of the run-boundary readout was
               actually a measurement of the selection readout. */
            const r = [...document.querySelectorAll("[data-still-readout]")].find(
              (n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility === "visible",
            );
            if (!r) return null;
            const b = r.getBoundingClientRect();
            return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)];
          })(),
          tier: document.documentElement.getAttribute("data-scene-tier"),
          ready: document.documentElement.getAttribute("data-scene-ready"),
          canvases: document.querySelectorAll("canvas").length,
          installCommand: (document.querySelector("[data-install-command], .install-strip") ?? {}).textContent
            ? (document.querySelector("[data-install-command], .install-strip").textContent ?? "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 60)
            : null,
        };
      });

      const overflow = state.scrollWidth > width;
      if (overflow) failed = true;

      /* The still's chrome may not sit on the hero's type. Overlap is measured
         rather than eyeballed, because the eyeballing already failed once: the
         controls printed through the headline in every capture of the first
         shoot and the run reported no problem at all. */
      const hit = (a, b) =>
        a && b && a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
      const collisions = [];
      for (const zone of ["headline", "subhead", "strip-surface", "strip-version", "secondary"]) {
        if (hit(state.boxes.controls, state.boxes[zone])) collisions.push(`controls/${zone}`);
        if (hit(state.readoutBox, state.boxes[zone])) collisions.push(`readout/${zone}`);
      }
      if (hit(state.boxes.controls, state.readoutBox)) collisions.push("controls/readout");
      /* The hero is `overflow: hidden`, so anything past its bottom edge is
         not merely below the fold, it is deleted. The scorer case fits and the
         run-boundary case does not: its key has seven rows and its caption
         nine lines, and only walking the states found it. */
      for (const [what, box] of [["controls", state.boxes.controls], ["readout", state.readoutBox]]) {
        if (box && state.heroBottom && box[3] > state.heroBottom) {
          collisions.push(`${what} past the room's bottom by ${box[3] - state.heroBottom}px`);
        }
      }
      if (collisions.length) failed = true;
      if (process.env.BOXES) {
        console.log(`      vh=${state.vh} heroBottom=${state.heroBottom} boxes ${JSON.stringify({ ...state.boxes, readout: state.readoutBox })}`);
      }
      const file = join(OUT, `${name}-${width}-${theme}.png`);
      await page.screenshot({ path: file });
      rows.push({ name, width, theme, ...state, overflow });

      /* Walk the states by clicking their labels, which is what a reader does.
         With scripting disabled this exercises the native radio group and the
         sibling combinator and nothing else, so a capture that changes is the
         proof that the five states advance without script. */
      if (spec.states && width === 1440) {
        const seen = [];
        for (const id of ["selection", "update", "response", "run-boundary"]) {
          await page.click(`label[for="rl-still-state-${id}"]`);
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(160);
          const walked = await page.evaluate(() => {
            const shown = [...document.querySelectorAll("[data-scene-still]")].filter(
              (n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility === "visible",
            );
            const r = [...document.querySelectorAll("[data-still-readout]")].find(
              (n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility === "visible",
            );
            /* The deepest painted descendant, not the container. A grid child
               that overflows its own row track sits outside the container's
               rectangle, and that is exactly how the source line ran past the
               bottom of the room while this check reported nothing. */
            const deepest = r
              ? Math.max(
                  ...[...r.querySelectorAll("*")]
                    .filter((n) => n.getClientRects().length > 0)
                    .map((n) => n.getBoundingClientRect().bottom),
                  r.getBoundingClientRect().bottom,
                )
              : 0;
            const hero = document.querySelector("[data-hero]");
            return {
              cases: shown.map((n) => n.getAttribute("data-case")),
              bottom: Math.round(deepest),
              heroBottom: Math.round(hero?.getBoundingClientRect().bottom ?? 0),
            };
          });
          const shown = walked.cases;
          seen.push(`${id}:${shown.join("+") || "-"}`);
          /* Each state's readout is a different height. The scorer case fits
             and says nothing about the run-boundary case, whose key has seven
             rows and whose caption is nine lines. */
          if (walked.bottom > walked.heroBottom) {
            failed = true;
            console.error(
              `        *** ${id}: the readout runs ${walked.bottom - walked.heroBottom}px past the room's bottom ***`,
            );
          }
          await page.screenshot({ path: join(OUT, `${name}-state-${id}-${width}-${theme}.png`) });
        }
        console.log(`        states walked: ${seen.join("  ")}`);
        const wrong = seen.filter((s) => {
          const [id, cases] = s.split(":");
          return !cases.startsWith(id === "run-boundary" ? "run-boundary" : id);
        });
        if (wrong.length) {
          failed = true;
          console.error(`        *** a state showed the wrong case: ${wrong.join(", ")} ***`);
        }
      }
      console.log(
        `  ${String(width).padStart(4)} ${theme.padEnd(5)}  scrollWidth=${state.scrollWidth}` +
          `${overflow ? " *** OVERFLOW ***" : ""}  layer=${state.layerVisible ? "visible" : "hidden"}` +
          `  case=${state.shownCases.join("+") || "-"}  tier=${state.tier ?? "-"}` +
          `  canvases=${state.canvases}  schematic-opacity=${state.schematicOpacity ?? "-"}` +
          (collisions.length ? `  *** OVERLAP: ${collisions.join(", ")} ***` : ""),
      );
      await ctx.close();
    }
  }
}

await browser.close();
for (const s of servers.values()) await s.close();

console.log(`\n${rows.length} capture(s) in design/dossier/build/fallback/`);
process.exit(failed ? 1 : 0);
