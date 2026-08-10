// The preview-image generator. Owned by P2 per D-32, because gate 13 checks
// "a preview image whose text is not from copy.yaml", and a generator and the
// gate that checks it belong to one owner or the gate is written against a
// generator nobody is holding to it.
//
// What was wrong with it, and why nothing caught any of it:
//
//   1. It loaded @fontsource/instrument-serif from node_modules. F1 removed
//      that package (D-12 drops Instrument Serif; the four faces are
//      self-hosted in public/fonts/ at 76,436 bytes). The generator would have
//      thrown on its first run.
//   2. It hardcoded eight v1 colours: BG "#0C1017", AMBER "#E8A33D", INK,
//      INK2 and four verdict hues. None is in tokens.css.
//   3. Its `campaign.png` title typed five numbers into a string.
//   4. `default.png` carried "The instrument for looking inside reward models",
//      which is not the shipped headline and never was.
//
// None of that failed anything, because this file is in neither `npm run build`
// nor CI. That is the defect: one of the 29 images has been advertising a
// headline the project rejected for as long as the images have existed.
//
// Now: every colour resolves to src/styles/tokens.css, every face is a
// self-hosted woff2, every string comes from design/copy.yaml or from generated
// data, and each image records where its text came from in public/og/
// manifest.json, which gate 13 reads.
//
// On verdict colour: there is no verdict token in the new palette. D-30 records
// that the six v1 data colours have no counterpart by design, because the
// palette spends colour only on data, and that they degrade to chrome rather
// than to a guessed hue. A wrong data colour would be a lie and grey is merely
// plain. So a card's verdict renders in --ink-2.
//
// Run:  node scripts/og_render.mjs [--check]

import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { createHash } from "node:crypto";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(SITE, "public/og");
const CHECK = process.argv.includes("--check");
mkdirSync(OUT, { recursive: true });

// ---- the palette, read from tokens.css ------------------------------------
//
// tokens.css states each colour as OKLCH with the hex in a trailing comment.
// scripts/gen-tokens-py.mjs recomputes every hex from its OKLCH source and
// warns on any disagreement; F1 ran it and found zero. So the comments are an
// audited source and this reads them rather than reimplementing the colour
// maths. film/manim/tokens.py is the same values through that generator, and
// the two are cross-checked below: a disagreement means one of them is stale
// and the images should not be rendered from either.

const tokensCss = readFileSync(join(SITE, "src/styles/tokens.css"), "utf-8");

function tokenHex(name) {
  // The dark block is first in the file; the light overrides come later inside
  // a media query. Take the first declaration, which is the dark theme.
  const re = new RegExp(`--${name}\\s*:\\s*([^;]+);\\s*(?:/\\*\\s*(#[0-9a-fA-F]{6}))?`);
  const m = tokensCss.match(re);
  if (!m) throw new Error(`og_render: --${name} is not in src/styles/tokens.css`);
  const direct = m[1].trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(direct)) return direct.toLowerCase();
  if (!m[2]) throw new Error(`og_render: --${name} has no hex beside its OKLCH value`);
  return m[2].toLowerCase();
}

const T = {
  ground: tokenHex("ground"),
  surface2: tokenHex("surface-2"),
  line: tokenHex("line"),
  lineStrong: tokenHex("line-strong"),
  ink: tokenHex("ink"),
  ink2: tokenHex("ink-2"),
  beam: tokenHex("beam"),
};

// Cross-check against the generated Manim module, which is the same tokens
// through a different path. If these disagree one of them is stale.
const pyPath = join(SITE, "film/manim/tokens.py");
if (existsSync(pyPath)) {
  const py = readFileSync(pyPath, "utf-8");
  const pyHex = (n) => py.match(new RegExp(`^${n} = "(#[0-9a-f]{6})"`, "m"))?.[1];
  const pairs = [["GROUND", T.ground], ["INK", T.ink], ["INK_2", T.ink2], ["BEAM", T.beam]];
  for (const [name, hex] of pairs) {
    const got = pyHex(name);
    if (got && got !== hex) {
      throw new Error(
        `og_render: tokens.css says ${hex} and film/manim/tokens.py says ${got} for ${name}. Run npm run tokens:py.`,
      );
    }
  }
}

// ---- fonts, self-hosted, no network ---------------------------------------
//
// Embedded as data: URIs rather than referenced by file://. page.setContent
// gives the document an about:blank origin, and Chrome refuses to load a
// file:// subresource from one, silently: the @font-face never resolves, the
// text falls back to the platform serif, and the card still renders. That is
// how the old generator produced 29 cards in the wrong typeface without
// failing. A data: URI has no origin to be blocked by, and the render throws
// if a face is missing rather than substituting one.
const FACES = {
  sans600: "ibm-plex-sans-latin-600-normal.woff2",
  mono400: "ibm-plex-mono-latin-400-normal.woff2",
  mono500: "ibm-plex-mono-latin-500-normal.woff2",
};
const fontUrl = (f) => {
  const p = join(SITE, "public/fonts", f);
  if (!existsSync(p)) {
    throw new Error(`og_render: public/fonts/${f} is missing. Fonts are self-hosted (C-14).`);
  }
  return `data:font/woff2;base64,${readFileSync(p).toString("base64")}`;
};

// ---- text sources ----------------------------------------------------------
const copy = parse(readFileSync(join(SITE, "design/copy.yaml"), "utf-8"));
const cards = JSON.parse(readFileSync(join(SITE, "src/data/cards.json"), "utf8"));

const siteHost = new URL(copy.urls.site).host;

// ---- the mark, drawn from tokens ------------------------------------------
//
// public/brand/mark-dark.svg still carries the v1 hexes (#E6E9F0, #E8A33D).
// That file is not P2's, and this does not read it: the mark here is drawn from
// the token palette so the card cannot inherit a stale colour.
const MARK = `<svg width="64" height="64" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <circle cx="16" cy="16" r="11" stroke="${T.ink}"/>
    <path d="M6 18.5 L12.4 18.5" stroke="${T.ink}"/>
    <path d="M19.6 18.5 L26 18.5" stroke="${T.ink}"/>
    <path d="M12.4 18.5 L16 10.5 L19.6 18.5" stroke="${T.beam}"/>
  </g>
</svg>`;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function pageHtml({ title, subId, subVerdict }) {
  const subtitle =
    subId && subVerdict
      ? `<div class="sub"><span>${esc(subId)}</span><span class="dot">·</span><span>${esc(subVerdict)}</span></div>`
      : "";

  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'Plex Sans';src:url('${fontUrl(FACES.sans600)}') format('woff2');font-weight:600;font-display:block}
@font-face{font-family:'Plex Mono';src:url('${fontUrl(FACES.mono400)}') format('woff2');font-weight:400;font-display:block}
@font-face{font-family:'Plex Mono';src:url('${fontUrl(FACES.mono500)}') format('woff2');font-weight:500;font-display:block}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:630px}
.card{width:1200px;height:630px;background:${T.ground};color:${T.ink};
  display:flex;flex-direction:column;justify-content:space-between;
  padding:72px 80px;position:relative;overflow:hidden}
.card::after{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;background:${T.beam}}
.lockup{display:flex;align-items:center;gap:18px}
.lockup .name{font-family:'Plex Mono';font-weight:500;font-size:32px;letter-spacing:-0.01em;color:${T.ink}}
.body{display:flex;flex-direction:column;gap:22px;max-width:1040px}
.title{font-family:'Plex Sans';font-weight:600;color:${T.ink};line-height:1.1;letter-spacing:-0.022em}
.sub{font-family:'Plex Mono';font-weight:400;font-size:24px;display:flex;align-items:center;gap:14px;color:${T.ink2}}
.sub .dot{color:${T.line_strong ?? T.lineStrong}}
.foot{font-family:'Plex Mono';font-weight:400;font-size:21px;color:${T.ink2};letter-spacing:0.02em}
</style></head><body>
<div class="card">
  <div class="lockup">${MARK}<span class="name">${esc(copy.meta.site_name)}</span></div>
  <div class="body">
    <div class="title" id="title">${esc(title)}</div>
    ${subtitle}
  </div>
  <div class="foot">${esc(siteHost)}</div>
</div>
</body></html>`;
}

// Deterministic title fit: start at 72px, step down by 2px until the title
// occupies at most 3 lines or a 34px floor is hit. Same input, same size.
async function fitTitle(page) {
  await page.evaluate(() => {
    const el = document.getElementById("title");
    let size = 72;
    const fits = () => {
      el.style.fontSize = size + "px";
      return el.scrollHeight <= Math.round(size * 1.1 * 3) + 1;
    };
    while (size > 34 && !fits()) size -= 2;
    el.style.fontSize = size + "px";
  });
}

async function render(page, spec, filename) {
  await page.setContent(pageHtml(spec), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  // Assert the faces actually loaded. A silent fallback to the platform serif
  // is exactly what produced 29 cards nobody looked at.
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight}`),
  );
  // Only the faces the card actually renders. A face nobody uses is never
  // fetched, so asserting it would fail on a card that is entirely correct.
  for (const want of ["Plex Sans 600", "Plex Mono 400", "Plex Mono 500"]) {
    if (!loaded.includes(want)) {
      throw new Error(
        `og_render: ${want} did not load. Loaded: ${loaded.join(", ") || "(none)"}. ` +
          `The card would render in the platform fallback face.`,
      );
    }
  }
  await fitTitle(page);
  await page.evaluate(() => document.fonts.ready);
  const card = await page.$(".card");
  const buf = await card.screenshot();
  if (!CHECK) writeFileSync(join(OUT, filename), buf);
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

// ---- the jobs, each carrying where its text came from ----------------------

const headline = `${copy.home.hero.headline_a} ${copy.home.hero.headline_b}`;

const jobs = [
  {
    file: "default.png",
    spec: { title: headline },
    text: headline,
    source: "design/copy.yaml:home.hero.headline_a + home.hero.headline_b",
  },
  {
    file: "campaign.png",
    spec: { title: copy.meta.tagline },
    text: copy.meta.tagline,
    source: "design/copy.yaml:meta.tagline",
    note:
      "ESCALATION, C-18: copy.yaml has no top-level key for /log/, so this route's own preview text does not exist and a packet may not invent one. The site tagline is a real published string and stands in until the build lead writes the /log/ copy. The previous text typed five numbers into a sentence, which rule 2 forbids outright.",
  },
  ...cards.map((c) => ({
    file: `campaign-${c.id}.png`,
    spec: { title: c.title, subId: c.id, subVerdict: c.verdict },
    text: c.title,
    source: `src/data/cards.json#${c.id}.title`,
  })),
];

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});

const manifest = { _what_this_is:
  "Written by scripts/og_render.mjs. Gate 13 reads it to assert that every preview image's text resolves to a live string in design/copy.yaml or to a field in generated data. An image whose recorded text no longer matches its source is an image advertising something the site stopped saying.",
  generatedAt: new Date().toISOString(),
  palette: T,
  images: {},
};

for (const j of jobs) {
  const sha = await render(page, j.spec, j.file);
  manifest.images[j.file] = { text: j.text, source: j.source, sha256_16: sha, ...(j.note ? { note: j.note } : {}) };
  console.log(`${CHECK ? "checked " : "rendered"} ${j.file}  ${sha}  <- ${j.source}`);
}

await browser.close();

if (!CHECK) {
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

const onDisk = readdirSync(OUT).filter((f) => f.endsWith(".png"));
const orphans = onDisk.filter((f) => !manifest.images[f]);
if (orphans.length) {
  console.warn(`\n${orphans.length} PNG(s) in public/og/ that this generator does not produce: ${orphans.join(", ")}`);
}
console.log(`\ndone: ${jobs.length} OG images -> ${OUT}  (${onDisk.length} PNGs on disk)`);
