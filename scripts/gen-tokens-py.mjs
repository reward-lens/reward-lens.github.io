// Usage: node scripts/gen-tokens-py.mjs [--check]
//
// Reads design/tokens.css and writes film/manim/tokens.py: a plain Python
// module of hex strings and font names, so no colour is ever typed into a
// Manim scene. DECISIONS.md D-23: every colour in film/** resolves to
// tokens.css through this script.
//
// Colours are computed from the OKLCH values, which are the ones the design
// reasons in, rather than scraped from the hex comments beside them. The hex
// comments are then used as a cross-check and any disagreement is printed, so
// this script is also the audit of the token file's own stated hexes.
//
// --check exits non-zero if the emitted file would differ from the one on
// disk, which is the drift gate: a token changes, the film changes with it.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "design", "tokens.css");
const OUT_DIR = join(ROOT, "film", "manim");
const OUT = join(OUT_DIR, "tokens.py");

// --- OKLCH to sRGB -----------------------------------------------------------

const srgbGamma = (c) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

const clamp01 = (x) => Math.min(1, Math.max(0, x));

function oklchToHex(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.round(clamp01(srgbGamma(v)) * 255));

  return "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
}

// --- parse -------------------------------------------------------------------

const css = readFileSync(SOURCE, "utf-8");

/** Pull one brace-delimited block whose selector line matches `needle`. */
function block(needle) {
  const at = css.indexOf(needle);
  if (at === -1) throw new Error(`tokens.css: no block matching ${needle}`);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`tokens.css: unterminated block at ${needle}`);
}

const DECL = /--([a-z0-9-]+)\s*:\s*([^;]+);(?:[^\n]*?\/\*([^*]*)\*\/)?/gi;
const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i;
const RGBA = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;
const HEXV = /^#[0-9a-f]{3,8}$/i;

const mismatches = [];

/** name -> {hex, alpha} for every colour declaration in a block. */
function colours(source, label) {
  const found = new Map();
  for (const m of source.matchAll(DECL)) {
    const name = m[1];
    const value = m[2].trim();
    const comment = (m[3] ?? "").trim();

    let hex = null;
    let alpha = null;

    const ok = value.match(OKLCH);
    const rgba = value.match(RGBA);

    if (ok) {
      hex = oklchToHex(Number(ok[1]), Number(ok[2]), Number(ok[3]));
      const stated = comment.match(/#[0-9a-f]{6}/i);
      if (stated && stated[0].toLowerCase() !== hex) {
        mismatches.push(`${label} --${name}: stated ${stated[0]}, computed ${hex}`);
      }
    } else if (rgba) {
      hex =
        "#" +
        [rgba[1], rgba[2], rgba[3]]
          .map((v) => Number(v).toString(16).padStart(2, "0"))
          .join("");
      alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
    } else if (HEXV.test(value)) {
      hex = value.toLowerCase();
    } else {
      continue; // not a colour
    }

    found.set(name, { hex, alpha });
  }
  return found;
}

const dark = colours(block(':root,\n:root[data-theme="dark"]'), "dark");
const light = colours(block(':root[data-theme="light"] {'), "light");

// Font families: the first quoted name is the one a renderer can install.
const rootBlock = block(":root {");
const fonts = new Map();
for (const m of rootBlock.matchAll(/--(font-[a-z]+)\s*:\s*"([^"]+)"/g)) {
  fonts.set(m[1], m[2]);
}

// --- emit --------------------------------------------------------------------

const constName = (name) => name.toUpperCase().replaceAll("-", "_");

const lines = [];
lines.push('"""reward-lens design tokens, for Manim.');
lines.push("");
lines.push("GENERATED. Do not edit. Run `npm run tokens:py` after changing");
lines.push("design/tokens.css. Every colour in film/** comes from here, which is");
lines.push("what stops a scene and the site from drifting apart.");
lines.push("");
lines.push("Dark theme values are the bare constants because the film is dark.");
lines.push('Light theme values carry a LIGHT_ prefix.');
lines.push('"""');
lines.push("");
lines.push("from __future__ import annotations");
lines.push("");
lines.push("# --- type ---------------------------------------------------------------");
for (const [name, family] of fonts) {
  lines.push(`${constName(name)} = ${JSON.stringify(family)}`);
}
lines.push("");
lines.push("# --- dark theme ---------------------------------------------------------");
for (const [name, { hex, alpha }] of dark) {
  lines.push(`${constName(name)} = ${JSON.stringify(hex)}`);
  if (alpha !== null && alpha !== 1) {
    lines.push(`${constName(name)}_ALPHA = ${alpha}`);
  }
}
lines.push("");
lines.push("# --- light theme --------------------------------------------------------");
for (const [name, { hex, alpha }] of light) {
  lines.push(`LIGHT_${constName(name)} = ${JSON.stringify(hex)}`);
  if (alpha !== null && alpha !== 1) {
    lines.push(`LIGHT_${constName(name)}_ALPHA = ${alpha}`);
  }
}

// Ordered sequences, because position carries identity in this palette and a
// scene that indexes into the wrong order says the wrong thing (DESIGN.md §5.4).
const seq = (prefix, count) =>
  Array.from({ length: count }, (_, i) => `${constName(prefix)}_${i + 1}`);

lines.push("");
lines.push("# --- ordered sequences ---------------------------------------------------");
lines.push("# The component order is the order the library returns. Do not sort it.");
lines.push(`COMPONENTS = [${seq("comp", 6).join(", ")}]`);
lines.push(`LIGHT_COMPONENTS = [${seq("comp", 6).map((n) => "LIGHT_" + n).join(", ")}]`);
lines.push("# The trust ladder reads as increasing confidence, in this order only.");
lines.push(`TRUST = [${seq("trust", 4).join(", ")}]`);
lines.push(`LIGHT_TRUST = [${seq("trust", 4).map((n) => "LIGHT_" + n).join(", ")}]`);
lines.push("");
lines.push("SURFACES = [GROUND, SURFACE_1, SURFACE_2, SURFACE_3, SURFACE_4]");
lines.push(
  "LIGHT_SURFACES = [LIGHT_GROUND, LIGHT_SURFACE_1, LIGHT_SURFACE_2, LIGHT_SURFACE_3, LIGHT_SURFACE_4]",
);
lines.push("");

const out = lines.join("\n");

if (mismatches.length) {
  console.warn("tokens.css hex comments that disagree with their OKLCH value:");
  for (const m of mismatches) console.warn("  " + m);
}

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf-8") : "";
  if (current !== out) {
    console.error("film/manim/tokens.py is stale. Run `npm run tokens:py`.");
    process.exit(1);
  }
  console.log(`tokens.py: up to date, ${dark.size} dark and ${light.size} light colours`);
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, out);
  console.log(
    `wrote film/manim/tokens.py: ${dark.size} dark colours, ${light.size} light colours, ${fonts.size} families`,
  );
}
