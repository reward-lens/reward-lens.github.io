// Usage: node scripts/lint-tokens.mjs [--all]
//
// The token discipline, checked. Written by F1 while the contrast table was in
// front of it. P2 owns scripts/checks/ and should wire this in as a gate; it
// exits non-zero on its own so it can be called directly.
//
// Rules, and why each one exists:
//
//  1. --ink-3 is permitted on --ground and --surface-1 only. On --surface-2 it
//     is 4.29:1 and on --surface-3 it is 3.67:1, which is AA-large and not
//     AA-body (DESIGN.md §5.3). Use --ink-2 there.
//  2. --line-control is the only rule that meets 3:1 (3.02 on ground) and is
//     therefore the only one permitted on a focusable boundary. --line (1.41)
//     and --line-strong (2.11) are decorative and structural.
//  3. No colour literal outside the token file. Colour on this site is data.
//  4. No bare font-size, line-height or letter-spacing. A type role is a class
//     (DECISIONS.md D-28), and the CSS `font` shorthand drops letter-spacing.
//  5. No duration literal. The four --dur tokens collapse under reduced motion
//     and a literal does not.
//  6. A length literal inside @media is allowed, because a media query may not
//     contain var(), but only with the --bp token named in a comment on the
//     same line, AND only when the length equals that token's value, or equals
//     it minus one pixel for a max-width query.
//
//     The second half was added by P2 for gate 15, per C-21. As F1 wrote it the
//     rule checked only that a comment naming a token was present, so
//     `/* --bp-lg */` beside a 47.5rem length passed identically to the correct
//     comment. nav-shell.astro:250 writes 47.4375rem beside /* --bp-md */,
//     where --bp-md is 47.5rem: that is the ordinary one-pixel-below max-width
//     companion to a min-width query and is right. But without the value check
//     the rule buys a *labelled* literal rather than a *checked* one, which is
//     not what D-31 paid for.
//  7. src/styles/compat-v1.css is temporary. While anything still references a
//     name it defines, this prints what.
//
// Rules 1 and 2 are heuristics over a stylesheet, not a rendered page: a
// component here is one file with one surface, so a --ink-3 in a file that
// paints itself --surface-2 is the shape the real defect takes. Escape a true
// false positive with `/* ink3-ok: reason */` on the same line.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALL = process.argv.includes("--all");
// Gate mode, used by scripts/checks/drift.mjs. Scans src/, scripts/ and film/
// with no OWNED subset, so every finding is a failure. Kept in this file rather
// than duplicated into a second linter: one set of rules, two entry points.
const GATE = process.argv.includes("--gate");
const ROOTS = GATE ? ["src", "scripts", "film"] : ["src", "film"];

// Files a packet has rebuilt on the new token vocabulary. A finding in one of
// these fails. A finding anywhere else under src/ is a file no packet has
// reached yet: it is reported and does not fail.
//
// ADD YOUR FILES HERE WHEN YOUR PACKET LANDS. When every file under src/ is
// listed, delete the list and fail on everything. film/** is new, so all of it
// is owned from the start.
const OWNED = new Set([
  "src/copy.ts",
  "src/layouts/Base.astro",
  "src/styles/global.css",
  "src/styles/type.css",
  "src/styles/fonts.css",
  "src/styles/print.css",
  "src/styles/compat-v1.css",
  "src/components/nav-shell.astro",
  "src/components/site-footer.astro",
  "src/components/skip-link.astro",
  "src/components/theme-toggle.astro",
  // P5, the documentation frame and everything under /docs/.
  "src/layouts/Docs.astro",
  "src/styles/docs-legacy.css",
  "src/components/Callout.astro",
  "src/components/PrevNext.astro",
  "src/components/docs/docs-sidebar.astro",
  "src/components/docs/nav-tree.astro",
  "src/components/docs/contents-rail.astro",
  "src/components/docs/search-overlay.astro",
  "src/components/docs/copy-page.astro",
  "src/components/docs/types.ts",
  "src/pages/docs/index.astro",
  "src/pages/docs/refusals.astro",
  "src/pages/docs/[...slug].astro",
  "src/pages/docs/api/index.astro",
  "src/pages/docs/api/[group].astro",
]);

// In gate mode there is no OWNED subset. Every finding fails, and the legacy
// files that are not yet rewritten are held by the ratchet in
// scripts/checks/ratchet-tokens.txt, which may shrink and must not grow.
const isOwned = (rel) => GATE || OWNED.has(rel) || rel.startsWith("film/");

// The two token files state the values; they are the only places a literal may
// appear. film/manim/tokens.py is generated from src/styles/tokens.css by
// scripts/gen-tokens-py.mjs and never edited by hand.
const EXEMPT = new Set(["src/styles/tokens.css", "film/manim/tokens.py"]);

// .mjs was missing, and it is the extension every file under scripts/ uses. In
// gate mode the roots include scripts/**, so without it gate 15 reported that
// it had scanned a tree it had not opened a single file of. Found by
// demonstrating the gate failing: the deliberate defect did not fail it.
const EXTS = [".css", ".astro", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".py"];
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (EXTS.some((e) => p.endsWith(e))) files.push(p);
  }
};
for (const d of ROOTS) {
  if (existsSync(join(ROOT, d))) walk(join(ROOT, d));
}

// The --bp-* token values, read from the token file, for rule 6's value check.
const BP = new Map();
{
  const tokens = readFileSync(join(ROOT, "src/styles/tokens.css"), "utf-8");
  for (const m of tokens.matchAll(/--(bp-[a-z]+)\s*:\s*([\d.]+)rem/g)) {
    BP.set(m[1], Number(m[2]));
  }
}
const ONE_PX_REM = 1 / 16;

// The `&` in the lookbehind is not decoration. `&#9888;` is the HTML entity for
// a warning triangle, and a test asserting that a refusal card does NOT contain
// one was being reported as a colour literal, because #9888 is four hex digits.
// An entity is never a colour.
const COLOUR_LITERAL =
  /(?<![\w&-])(#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\s*\()/;
const TYPE_PROP = /(?<![\w-])(font-size|line-height|letter-spacing)\s*:\s*([^;]+)/;
const DURATION_LITERAL =
  /(?<![\w-])(transition-duration|animation-duration|transition|animation|transition-delay|animation-delay)\s*:\s*[^;]*?(?<![\w.-])\d+(?:\.\d+)?m?s\b/;
const LENGTH_IN_MEDIA = /@media[^{]*?(?<![\w.-])\d+(?:\.\d+)?(px|rem|em)\b/;
// --bg-raised is the v1 alias for --surface-2, so a legacy file that paints
// with it is painting a surface --ink-3 is not permitted on.
const SURFACE_PAINT =
  /background(?:-color)?\s*:\s*[^;]*var\(--(surface-[234]|bg-raised)\b/;
const INK3 = /var\(--ink-3\b/;
const FOCUSABLE_SELECTOR =
  /(^|[\s,>+~])(a|button|summary|input|select|textarea|details|\[tabindex|\.[a-z0-9_-]*(?:btn|button|toggle|control|link|field|input)[a-z0-9_-]*)\b|:focus/i;
const WEAK_RULE = /border[^;:]*:\s*[^;]*var\(--(line|line-strong)\)|outline\s*:\s*[^;]*var\(--(line|line-strong)\)/;

const problems = [];
const legacyProblems = [];
const compatUsers = [];

// The names compat-v1.css keeps alive, read from the file itself.
const compatPath = join(ROOT, "src/styles/compat-v1.css");
const compatNames = existsSync(compatPath)
  ? [...readFileSync(compatPath, "utf-8").matchAll(/^\s{2}--([a-z0-9-]+)\s*:/gm)].map(
      (m) => m[1],
    )
  : [];
const COMPAT = compatNames.length
  ? new RegExp(`var\\(--(${compatNames.join("|")})\\)`)
  : null;

for (const file of files) {
  const rel = relative(ROOT, file);
  if (EXEMPT.has(rel)) continue;
  const text = readFileSync(file, "utf-8");
  const lines = text.split("\n");
  const sink = isOwned(rel) ? problems : legacyProblems;

  // Rules 1 and 2 need file-level context.
  const paintsRaisedSurface = SURFACE_PAINT.test(text);

  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    const code = line.split("/*")[0];
    const bare = line.trim();
    if (bare.startsWith("*") || bare.startsWith("//")) return;

    if (COMPAT && COMPAT.test(code)) {
      compatUsers.push(`${at}  ${bare}`);
    }

    if (INK3.test(code) && paintsRaisedSurface && !/ink3-ok:/.test(line)) {
      sink.push(
        `${at}  rule 1: --ink-3 in a file that paints --surface-2 or above. 4.29:1 is AA-large, not AA-body. Use --ink-2.\n      ${bare}`,
      );
    }

    if (WEAK_RULE.test(code) && FOCUSABLE_SELECTOR.test(nearestSelector(lines, i))) {
      sink.push(
        `${at}  rule 2: a focusable boundary drawn with --line or --line-strong. Only --line-control meets 3:1.\n      ${bare}`,
      );
    }

    if (COLOUR_LITERAL.test(code) && !/currentColor|transparent/i.test(code)) {
      sink.push(`${at}  rule 3: colour literal.\n      ${bare}`);
    }

    // Rule 4 is scoped to src/**, as D-28 and the gate-15 brief both state it:
    // "a bare font-size, line-height or letter-spacing literal anywhere in
    // src/** is a drift failure". The reason is the mechanism, not the file
    // count: type is applied by role class, and the role classes exist only in
    // the site's own document. scripts/og_render.mjs renders a 1200x630 social
    // card in a standalone Playwright document that loads no site stylesheet,
    // so there is no class for it to apply. Colour, duration and the @media
    // rules are NOT scoped and do run there.
    const type = code.match(TYPE_PROP);
    if (
      rel.startsWith("src/") &&
      type &&
      !type[2].includes("var(") &&
      !/inherit|normal|unset|revert/.test(type[2])
    ) {
      sink.push(`${at}  rule 4: bare ${type[1]}. Apply a type role class.\n      ${bare}`);
    }

    if (DURATION_LITERAL.test(code)) {
      sink.push(`${at}  rule 5: duration literal. Use --dur-1 to --dur-4.\n      ${bare}`);
    }

    if (LENGTH_IN_MEDIA.test(code)) {
      const named = line.match(/--(bp-[a-z]+)/);
      if (!named) {
        sink.push(
          `${at}  rule 6: length in @media without the --bp token named in a comment on the same line.\n      ${bare}`,
        );
      } else {
        // C-21: the comment must name the token the length actually is.
        const token = named[1];
        const want = BP.get(token);
        const lengths = [...line.matchAll(/(?<![\w.-])([\d.]+)rem/g)].map((m) => Number(m[1]));
        const isMax = /max-width/.test(line);
        const ok =
          want === undefined ||
          lengths.length === 0 ||
          lengths.some(
            (v) =>
              Math.abs(v - want) < 1e-9 ||
              (isMax && Math.abs(v - (want - ONE_PX_REM)) < 1e-9),
          );
        if (!ok) {
          sink.push(
            `${at}  rule 6: @media length ${lengths.join(", ")}rem does not equal --${token} (${want}rem)` +
              `${isMax ? ` or ${want - ONE_PX_REM}rem, its one-pixel-below max-width companion` : ""}.` +
              ` The comment labels the literal; it does not check it (C-21).\n      ${bare}`,
          );
        }
      }
    }
  });
}

/** Walk backwards to the selector that opened the current declaration block. */
function nearestSelector(lines, i) {
  for (let j = i; j >= 0 && i - j < 40; j -= 1) {
    if (lines[j].includes("{")) return lines[j];
  }
  return "";
}

const report = (title, list) => {
  if (!list.length) return;
  console.log(`\n${title} (${list.length})`);
  for (const p of list) console.log("  " + p);
};

// Gate mode hands the findings to drift.mjs, which reconciles them against the
// ratchet. It prints nothing itself and exits 0: the gate decides.
if (GATE) {
  console.log(JSON.stringify({ files: files.length, findings: problems, compatUsers }));
  process.exit(0);
}

report("FAIL", problems);
if (ALL) {
  report("legacy, pending wave 1, not failed", legacyProblems);
  report(
    "still on the v1 token names, so src/styles/compat-v1.css cannot be deleted yet",
    compatUsers,
  );
} else if (legacyProblems.length || compatUsers.length) {
  console.log(
    `\n${legacyProblems.length} finding(s) in files a wave-1 packet still owns, and ${compatUsers.length} reference(s) to the v1 token names. Run with --all to list them.`,
  );
}

console.log(
  `\nlint-tokens: ${files.length} files, ${problems.length} failing finding(s).`,
);
process.exit(problems.length ? 1 : 0);
