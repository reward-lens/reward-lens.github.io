// Shared machinery for the twenty-four gates.
//
// Three things live here because getting them inconsistent is how a gate ends
// up green for the wrong reason:
//
//  1. `skip()`. Several gates target routes that no packet has built yet. A
//     gate that finds nothing and exits 0 is indistinguishable from a gate that
//     checked everything and found nothing. `skip()` prints a warning, records
//     the reason in reports/vacuous-gates.json, and exits 0 loudly. Read that
//     file before believing a green run.
//  2. `serveDist()`. The browser gates need an origin. astro preview boots the
//     whole toolchain; this is forty lines and serves the same bytes CI
//     uploads, with the trailingSlash: "always" directory resolution the site
//     is configured for.
//  3. `pixelStats()` / `pixelDiff()`. Gates 21 and 23 need real pixels. There
//     is no PNG decoder in the dependency tree and adding one for two gates is
//     not worth it, so the screenshot goes back into the browser and is decoded
//     by createImageBitmap into an OffscreenCanvas. Same pixels, no dependency.

import { readdirSync, readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { join, dirname, relative, extname } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DIST = process.env.DIST_DIR ?? join(ROOT, "dist");

// ---------------------------------------------------------------------------
// Vacuity ledger
// ---------------------------------------------------------------------------

const LEDGER = join(ROOT, "reports", "vacuous-gates.json");

/**
 * Exit 0, but on the record. A gate that cannot run yet is not a gate that
 * passed, and the difference has to survive into the build log and into a file
 * a human can read after the fact.
 */
export function skip(gate, reason) {
  console.warn(`\nSKIP gate ${gate}: ${reason}`);
  console.warn(
    `  This gate is VACUOUS on this run. It did not pass; it did not run.`,
  );
  recordVacuity(gate, reason);
  process.exit(0);
}

/** Record a partial vacuity: the gate ran, but part of its surface was absent. */
export function recordVacuity(gate, reason) {
  mkdirSync(dirname(LEDGER), { recursive: true });
  let ledger = {};
  if (existsSync(LEDGER)) {
    try {
      ledger = JSON.parse(readFileSync(LEDGER, "utf-8"));
    } catch {
      ledger = {};
    }
  }
  ledger[String(gate)] = { reason, at: new Date().toISOString() };
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// dist walking
// ---------------------------------------------------------------------------

/** Every built HTML page, absolute paths, with pagefind's own output skipped. */
export function distPages(dist = DIST, { skipPagefind = true } = {}) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skipPagefind && name === "pagefind") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".html")) out.push(p);
    }
  };
  if (!existsSync(dist)) return out;
  walk(dist);
  return out;
}

/** "/docs/concepts/x/" for dist/docs/concepts/x/index.html. */
export function routeOf(file, dist = DIST) {
  const rel = relative(dist, file).split("\\").join("/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return "/" + rel.slice(0, -"index.html".length);
  return "/" + rel;
}

export function routeExists(route, dist = DIST) {
  const rel = route.replace(/^\//, "");
  return (
    existsSync(join(dist, rel, "index.html")) ||
    existsSync(join(dist, rel)) ||
    existsSync(join(dist, rel.replace(/\/$/, "") + ".html"))
  );
}

/** Split a route list into the ones that are built and the ones that are not. */
export function partitionRoutes(routes, dist = DIST) {
  const present = [];
  const absent = [];
  for (const r of routes) (routeExists(r, dist) ? present : absent).push(r);
  return { present, absent };
}

/**
 * The routes the design names, in the order a reader meets them. The browser
 * gates are too slow to run on all 162 built pages at seven widths in two
 * themes, so they run on this set plus one sample per built family.
 *
 * Routes that do not exist yet are RETURNED SEPARATELY, never silently dropped.
 * A gate that quietly checks eleven routes because the other five are not built
 * is a gate reporting a pass it did not earn.
 */
export const SPEC_ROUTES = [
  "/",
  "/see/",
  "/see/run/",
  "/see/reward-model/",
  "/see/grader/",
  "/start/",
  "/docs/",
  "/docs/refusals/",
  "/docs/reference/",
  "/atlas/",
  "/limits/",
  "/log/",
  "/log/method/",
  "/evidence/",
  "/about/",
  "/collaborate/",
  "/404.html",
];

/** One built route per top-level family, so a gate covers what exists today. */
export function familySamples(dist = DIST) {
  const seen = new Map();
  for (const file of distPages(dist)) {
    const route = routeOf(file, dist);
    if (route === "/") continue;
    const family = "/" + route.split("/").filter(Boolean)[0] + "/";
    if (!seen.has(family)) seen.set(family, route);
  }
  return [...seen.values()];
}

/**
 * A meta-refresh stub, not a page. Detected by reading the file rather than by
 * loading it: navigating to one fires its refresh mid-run and interrupts the
 * NEXT navigation, which surfaces as a confusing error about a route that is
 * fine.
 */
export function isRedirectStub(route, dist = DIST) {
  const file = join(dist, route.replace(/^\//, ""), "index.html");
  const alt = join(dist, route.replace(/^\//, ""));
  const p = existsSync(file) ? file : existsSync(alt) && !statSync(alt).isDirectory() ? alt : null;
  if (!p) return false;
  return /<meta\s+http-equiv=["']refresh["']/i.test(readFileSync(p, "utf-8"));
}

/** SPEC_ROUTES that exist, plus family samples, deduplicated, redirects removed. */
export function gateRoutes(dist = DIST) {
  const { present, absent } = partitionRoutes(SPEC_ROUTES, dist);
  const routes = [...new Set([...present, ...familySamples(dist)])]
    .filter((r) => !isRedirectStub(r, dist))
    .sort();
  return { routes, absent };
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

/**
 * Text nodes with their enclosing element chain, so a gate can ask whether a
 * match sits inside a provenance chip or a table cell. Regex, not a parser:
 * the built output is Astro's own serialisation, it is well formed, and adding
 * a parser dependency for this is not worth the supply chain.
 *
 * THE ATTRIBUTE SCAN IS QUOTE-AWARE, AND IT HAS TO BE. The attribute run used
 * to be `[^>]*?`, which ends a tag at the FIRST `>` in the source — including
 * one inside a quoted attribute value. `/start/` renders
 *
 *     <button data-code="def grade(answer: str, gold: str) -> float: ...">
 *
 * and the `>` of Python's `->` closed the tag 30 characters in. Everything
 * after it, the whole function body, was emitted as a TEXT NODE: gate 5 read
 * `1.0`, `0.5` and `0.0` out of a copy-to-clipboard attribute and reported
 * three unbound numerals on a page that renders none of them, in a `<pre>` the
 * gate would have skipped anyway. The attribute's own closing quote and the
 * attributes after it came with them, which is why the reported context ended
 * in a bare `if"`.
 *
 * Every gate in this directory reads its text through this function, so the
 * spill was not gate 5's: it was three phantom numerals, and any banned term,
 * claim value or vocabulary hit that a `>` inside an attribute happened to
 * precede, on every gate at once. Alternating over quoted runs before falling
 * back to a single non-`>` character keeps the scan linear and ends the tag at
 * the first `>` that is really outside a value.
 */
export function textNodes(html) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  const nodes = [];
  const stack = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  const VOID = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "source", "track", "wbr",
  ]);
  let m;
  while ((m = re.exec(stripped))) {
    if (m[5] !== undefined) {
      const text = decodeEntities(m[5]);
      if (text.trim()) nodes.push({ text, ancestors: [...stack] });
      continue;
    }
    const [, closing, tag, attrs, selfClose] = m;
    const name = tag.toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].tag === name) {
          stack.length = i;
          break;
        }
      }
    } else if (!selfClose && !VOID.has(name)) {
      stack.push({ tag: name, attrs: attrs || "" });
    }
  }
  return nodes;
}

export function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** All visible text on a page, tags flattened to single spaces. */
export function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ");
}

// ---------------------------------------------------------------------------
// A static server over dist/, matching the site's trailingSlash: "always"
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".bin": "application/octet-stream",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export async function serveDist(dir = DIST) {
  const server = createServer((req, res) => {
    let path = decodeURIComponent((req.url ?? "/").split("?")[0].split("#")[0]);
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
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

// ---------------------------------------------------------------------------
// One way to get a browser
// ---------------------------------------------------------------------------

/**
 * System Chrome where it exists, Playwright's bundled Chromium otherwise.
 * Every browser gate goes through this, so a CI runner without system Chrome
 * fails over instead of failing, and a developer machine without the bundled
 * download does the same in the other direction. Which one ran is printed,
 * because a rendering difference between the two is a real explanation for a
 * pixel gate disagreeing between CI and a laptop.
 */
export async function launchBrowser() {
  const { chromium } = await import("playwright");
  try {
    const b = await chromium.launch({ channel: "chrome" });
    return { browser: b, engine: "system chrome" };
  } catch {
    const b = await chromium.launch();
    return { browser: b, engine: "bundled chromium" };
  }
}

// ---------------------------------------------------------------------------
// Pixels, decoded in the browser rather than by a new dependency
// ---------------------------------------------------------------------------

const DECODE = `async (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}`;

const SRGB_TO_LINEAR = `(c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }`;

/**
 * Mean and 95th-percentile relative luminance of a PNG buffer, computed on
 * linearised sRGB per WCAG's own definition rather than on the gamma-encoded
 * bytes. Gate 21's ceilings are stated in linear luminance.
 */
export async function pixelStats(page, buffer) {
  return page.evaluate(
    async ({ b64, decodeSrc, linSrc }) => {
      const decode = eval(`(${decodeSrc})`);
      const lin = eval(`(${linSrc})`);
      const img = await decode(b64);
      const d = img.data;
      const lums = new Float64Array(d.length / 4);
      let sum = 0;
      for (let i = 0, j = 0; i < d.length; i += 4, j += 1) {
        const l = 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
        lums[j] = l;
        sum += l;
      }
      const sorted = Array.from(lums).sort((a, b) => a - b);
      const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
      return {
        width: img.width,
        height: img.height,
        mean: sum / lums.length,
        p95: at(0.95),
        max: sorted[sorted.length - 1],
      };
    },
    { b64: buffer.toString("base64"), decodeSrc: DECODE, linSrc: SRGB_TO_LINEAR },
  );
}

/**
 * Mean linear luminance of every scanline of a PNG, as an array.
 *
 * `axis: "row"` returns one value per y, which is what a VERTICAL edge needs;
 * `axis: "column"` returns one per x, for a horizontal edge. D-38 makes gate
 * 21's border assertion per-scanline, because the beam crosses the strip's two
 * vertical borders by construction and a statistic over a whole edge either
 * hides that or condemns the composition.
 */
export async function scanlineStats(page, buffer, axis = "row") {
  return page.evaluate(
    async ({ b64, decodeSrc, linSrc, axis }) => {
      const decode = eval(`(${decodeSrc})`);
      const lin = eval(`(${linSrc})`);
      const img = await decode(b64);
      const { data: d, width: w, height: h } = img;
      const at = (x, y) => {
        const i = (y * w + x) * 4;
        return 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
      };
      const out = [];
      if (axis === "row") {
        for (let y = 0; y < h; y += 1) {
          let s = 0;
          for (let x = 0; x < w; x += 1) s += at(x, y);
          out.push(s / w);
        }
      } else {
        for (let x = 0; x < w; x += 1) {
          let s = 0;
          for (let y = 0; y < h; y += 1) s += at(x, y);
          out.push(s / h);
        }
      }
      return { width: w, height: h, scanlines: out };
    },
    { b64: buffer.toString("base64"), decodeSrc: DECODE, linSrc: SRGB_TO_LINEAR, axis },
  );
}

/**
 * Resolve any CSS colour string to sRGB bytes by painting it.
 *
 * `getComputedStyle` returns an authored `oklch()` unchanged in Chrome, and the
 * obvious `match(/\d+/g).slice(0,3)` reads `oklch(0.48 0.01 170)` as
 * `rgb(0, 48, 0)`. That is Y = 0.0211 where the true value is 0.1105, so every
 * contrast ratio computed from it was wrong, and wrong in the flattering
 * direction. Painting one pixel and reading it back is exact for any colour
 * space the browser can parse, including ones that do not exist yet.
 */
export async function resolveColour(page, cssColour) {
  return page.evaluate((c) => {
    const cv = document.createElement("canvas");
    cv.width = 1;
    cv.height = 1;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { rgb: [r, g, b], alpha: a / 255, input: c };
  }, cssColour);
}

/** Fraction of pixels differing by more than `tolerance` on any channel. */
export async function pixelDiff(page, aBuf, bBuf, tolerance = 8) {
  return page.evaluate(
    async ({ a, b, decodeSrc, tolerance }) => {
      const decode = eval(`(${decodeSrc})`);
      const [ia, ib] = await Promise.all([decode(a), decode(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) {
        return { changed: 1, total: 1, sizeMismatch: true, a: [ia.width, ia.height], b: [ib.width, ib.height] };
      }
      let changed = 0;
      const da = ia.data;
      const db = ib.data;
      for (let i = 0; i < da.length; i += 4) {
        if (
          Math.abs(da[i] - db[i]) > tolerance ||
          Math.abs(da[i + 1] - db[i + 1]) > tolerance ||
          Math.abs(da[i + 2] - db[i + 2]) > tolerance
        ) {
          changed += 1;
        }
      }
      return { changed, total: da.length / 4, sizeMismatch: false };
    },
    { a: aBuf.toString("base64"), b: bBuf.toString("base64"), decodeSrc: DECODE, tolerance },
  );
}

/** WCAG contrast ratio between two [r,g,b] triples in 0..255. */
export function contrastRatio(rgb1, rgb2) {
  const lum = ([r, g, b]) => {
    const f = (c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [a, b] = [lum(rgb1), lum(rgb2)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

// ---------------------------------------------------------------------------
// copy.yaml
// ---------------------------------------------------------------------------

export const COPY_PATH = join(ROOT, "design", "copy.yaml");

/**
 * Parse copy.yaml or throw. Gate 9 calls this FIRST and fails on the throw:
 * C-12 records two fatal syntax errors that survived because everything that
 * touched the file grepped it as text.
 */
export async function parseCopy(path = COPY_PATH) {
  const { parse } = await import("yaml");
  return parse(readFileSync(path, "utf-8"));
}

/** Every leaf string in a parsed document, keyed by dotted path. */
export function leafStrings(node, prefix = "", out = {}) {
  if (typeof node === "string") {
    out[prefix] = node;
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => leafStrings(v, `${prefix}[${i}]`, out));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      leafStrings(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export function fail(list, summary) {
  for (const line of list) console.error(line);
  console.log(summary);
  process.exit(list.length ? 1 : 0);
}

export function readJson(p, fallback = null) {
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, "utf-8"));
}
