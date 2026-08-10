// Build assertion · no local filesystem path may ship
//
// Not a numbered gate, because it checks a property of the machine that built
// the site rather than a property of the site. Three grader-card subjects
// rendered "/home/suhail-nadaf/final-reward/assay-recon/frameworks/swebench/..."
// into public HTML: a person's name and a directory layout no reader has, in
// place of a locator a reader could follow.
//
// scripts/pubpath.py is the fix, and it runs inside the generators. This is the
// independent backstop, and it is deliberately not the same mechanism: it reads
// the written bytes rather than the payload, so it also catches a generator that
// was never wired to pubpath, a file edited by hand, and anything a template
// interpolated into dist/ that never passed through a generator at all.
//
// Scope is src/data/ (what is committed) and dist/ (what is served). dist/ is
// skipped when absent so this runs before a build as well as after; the build
// pipeline runs it again afterwards.
//
// Usage:  node scripts/checks/paths.mjs [--verbose]

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { ROOT, DIST } from "./_lib.mjs";

const VERBOSE = process.argv.includes("--verbose");

const DATA = join(ROOT, "src", "data");

// Binary payloads carry no prose and would produce noise, not findings.
const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".ico",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp4", ".webm", ".mov", ".zip", ".gz", ".pdf", ".wasm",
]);

// Pagefind's index is generated binary-ish chunkery under dist/; nothing in it
// is authored, and it mirrors text this check already reads at its source.
const SKIP_DIR = new Set(["pagefind", "node_modules", ".git"]);

// What must never appear. Each carries the reason it is banned, because a
// failure message that only prints a regex tells the next person nothing.
const BANNED = [
  {
    name: "home directory path",
    re: /\/(?:home|Users|root)\/[A-Za-z0-9._-]+\//g,
    why: "names a person and a directory layout no reader has",
  },
  {
    name: "file:// URL",
    re: /file:\/\//g,
    why: "resolves only on the machine that built the site",
  },
  {
    name: "worktree path",
    re: /\.claude\/worktrees\/[A-Za-z0-9._-]+/g,
    why: "ships the name of a local build branch",
  },
];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name)) continue;
      yield* walk(join(dir, entry.name));
    } else if (entry.isFile()) {
      if (SKIP_EXT.has(extname(entry.name).toLowerCase())) continue;
      yield join(dir, entry.name);
    }
  }
}

const roots = [
  { label: "src/data", path: DATA },
  { label: "dist", path: DIST },
].filter((r) => {
  if (existsSync(r.path) && statSync(r.path).isDirectory()) return true;
  if (r.label === "dist") {
    if (VERBOSE) console.log(`paths: dist/ absent, skipping (run after a build to cover it)`);
    return false;
  }
  console.error(`paths: ${r.label} does not exist at ${r.path}`);
  process.exit(1);
});

const findings = [];
let scanned = 0;

for (const root of roots) {
  for (const file of walk(root.path)) {
    scanned += 1;
    let text;
    try {
      text = readFileSync(file, "utf-8");
    } catch {
      continue; // unreadable as text; the extension filter already took the binaries
    }
    for (const banned of BANNED) {
      banned.re.lastIndex = 0;
      const seen = new Set();
      for (const match of text.matchAll(banned.re)) {
        if (seen.has(match[0])) continue;
        seen.add(match[0]);
        // The line number, so the finding is actionable without a second grep.
        const line = text.slice(0, match.index).split("\n").length;
        findings.push({
          file: relative(ROOT, file),
          line,
          kind: banned.name,
          why: banned.why,
          text: match[0],
        });
      }
    }
  }
}

if (findings.length > 0) {
  console.error(`paths: ${findings.length} local path(s) in generated or built output\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.text}`);
    console.error(`      ${f.kind}: ${f.why}`);
  }
  console.error(
    `\nThese are generated files. Fix the generator, never the JSON: add a rule to\n` +
      `scripts/pubpath.py saying what the public form of this path is, then regenerate.`,
  );
  process.exit(1);
}

console.log(
  `paths: no local paths in ${scanned} file(s) across ${roots.map((r) => r.label).join(" and ")}`,
);
