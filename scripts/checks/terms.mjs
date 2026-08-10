// Gate 6 · Terminology lock
//
// WHAT THIS GATE IS FOR
//
// The site is being repositioned. It was built around a research campaign with
// registered predictions and adjudicated outcomes; it is becoming a site about
// mechanistic interpretability of optimization. The campaign becomes a
// historical archive under /log/ and stops being the project's public identity.
// This gate is the mechanical part of that: it fails the build when campaign
// vocabulary, internal shorthand or an unlicensed claim word reaches rendered
// HTML outside the routes where it is allowed.
//
// It also carries the older bans it inherited, which are the same kind of rule:
// a phrase that must never reach rendered HTML.
//
//   - a synonym one amendment behind the enum it names (C-10)
//   - software-quality counts used as credibility signals (GROUND-TRUTH §8)
//   - absolute microsecond overhead figures, where the ratio is the only
//     publishable form because there are four absolute figures under four
//     conditions
//   - D-02's deprecated correlation value. That ban was stated in three places
//     and implemented in none (C-55). It is implemented here.
//
// FOUR THINGS THIS GATE DOES THAT A COPY GREP DOES NOT
//
//  1. It walks BUILT OUTPUT. A grep over src/ passes while stale copy survives
//     in dist/, because a string can reach the page from copy.yaml, from a
//     generated JSON file, from a ported markdown page or from a component none
//     of which the grep was pointed at. Only dist/ is what a reader sees.
//
//  2. It reports FILE, LINE and the exact string. Tags are blanked to
//     same-length spaces rather than deleted, so every offset into the masked
//     text is still an offset into the file on disk and the line number is the
//     real one. A gate that reports only a route makes the next builder grep
//     for the phrase themselves.
//
//  3. It reads user-facing ATTRIBUTES as well as text. `aria-label`, `alt`,
//     `title` and the description metas are read by people and by search
//     engines. Text-only extraction is how a banned phrase survives in the one
//     place a sighted reader never looks and a screen reader always does.
//
//  4. It SELF-TESTS on every run. Five gates in this repository have passed or
//     failed for the wrong reason, one of them reporting "0 values compared"
//     while exiting 0 and one scanning zero files because its extension list
//     had no .mjs in it. Every rule here carries a `probe.hit` string it must
//     match and a `probe.miss` string it must not, and the gate refuses to
//     report a pass until every rule has demonstrated it can still fire. A rule
//     that cannot fire is a defect, not a clean sheet.
//
// ALLOWANCES
//
// The literal word `campaign` may appear in the historical log, in redirect
// stubs, in source URLs and in machine records. It may not be the site's public
// abstraction. Allowances are per rule and are stated as route prefixes and
// route patterns in terms.json, never as "skip this file".
//
// Usage:
//   node scripts/checks/terms.mjs [dist]
//   node scripts/checks/terms.mjs --json reports/terms-inventory.json
//   node scripts/checks/terms.mjs --self-test     (rules only, no build needed)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { DIST, ROOT, distPages, routeOf, readJson } from "./_lib.mjs";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] ?? true;
};
const selfTestOnly = argv.includes("--self-test");
const jsonOut = typeof flag("--json") === "string" ? flag("--json") : null;
const positional = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--json");
const dist = positional[0] ?? DIST;

const lock = readJson(join(ROOT, "scripts", "checks", "terms.json"));

// ---------------------------------------------------------------------------
// Rule compilation
// ---------------------------------------------------------------------------

const compile = (r, kind) => ({
  ...r,
  kind,
  re: new RegExp(r.pattern, (r.flags ?? "i").includes("g") ? (r.flags ?? "i") : `${r.flags ?? "i"}g`),
  unlessRe: r.unless ? new RegExp(r.unless, "i") : null,
  requiresRe: r.requires ? new RegExp(r.requires, "i") : null,
  allowRoutes: r.allow?.routes ?? [],
  allowRoutePatterns: (r.allow?.routePatterns ?? []).map((p) => new RegExp(p)),
  scope: r.scope ?? "both",
});

const rules = [
  ...(lock.forbidden ?? []).map((r) => compile(r, "forbidden")),
  ...(lock.constrained ?? []).map((r) => compile(r, "constrained")),
];

if (rules.length === 0) {
  console.error("FAIL terms: terms.json defines no rules. An empty lock is not a lock.");
  process.exit(1);
}

const dupes = rules.map((r) => r.id).filter((id, i, a) => a.indexOf(id) !== i);
if (dupes.length) {
  console.error(`FAIL terms: duplicate rule ids in terms.json: ${[...new Set(dupes)].join(", ")}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The self-test. Runs first, every time, including on a green build.
// ---------------------------------------------------------------------------

/** Does this rule fire on `text`, ignoring route allowances? */
function firesOn(rule, text) {
  rule.re.lastIndex = 0;
  for (const m of text.matchAll(rule.re)) {
    if (!admissible(rule, text, m)) return true;
  }
  return false;
}

/** The two context tests, shared by the self-test and the sweep. */
function admissible(rule, text, m) {
  const window = contextWindow(text, m.index, m[0].length, rule.window ?? 240);
  if (rule.unlessRe && rule.unlessRe.test(window)) return true; // licensed away
  if (rule.requiresRe && rule.requiresRe.test(window)) return true; // licensed by context
  return false;
}

function contextWindow(text, index, length, radius) {
  return text.slice(Math.max(0, index - radius), index + length + radius);
}

function selfTest() {
  const problems = [];
  for (const rule of rules) {
    const probe = rule.probe ?? {};
    if (typeof probe.hit !== "string" || typeof probe.miss !== "string") {
      problems.push(`${rule.id}: no probe.hit / probe.miss. A rule with no probe cannot be shown to fire.`);
      continue;
    }
    if (!firesOn(rule, probe.hit)) {
      problems.push(`${rule.id}: DOES NOT FIRE on its own probe.hit ${JSON.stringify(probe.hit)}. The rule is dead.`);
    }
    if (firesOn(rule, probe.miss)) {
      problems.push(`${rule.id}: fires on its own probe.miss ${JSON.stringify(probe.miss)}. The rule over-matches.`);
    }
  }
  return problems;
}

const selfTestProblems = selfTest();
if (selfTestProblems.length) {
  console.error(`\nFAIL terms self-test: ${selfTestProblems.length} rule(s) cannot do their job.`);
  for (const p of selfTestProblems) console.error(`  ${p}`);
  console.error(
    `\n  A terminology lock whose rules do not fire is the failure mode this project has hit five times.`,
  );
  process.exit(1);
}

if (selfTestOnly) {
  console.log(`terms self-test: ${rules.length} rules, every one fires on its probe and none over-matches.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Masking. Tags become same-length runs of spaces, so an offset into the
// masked text is an offset into the file and the line number is the real one.
// ---------------------------------------------------------------------------

const blank = (s) => s.replace(/[^\n]/g, " ");

function maskHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<script\b[\s\S]*?<\/script>/gi, blank)
    .replace(/<style\b[\s\S]*?<\/style>/gi, blank)
    .replace(/<[^>]*>/g, blank)
    // Whitespace entities become whitespace of the same width. Every rule that
    // spans two words is written with \s+ between them, so a phrase broken by a
    // tag, a newline or an &nbsp; still matches.
    .replace(/&nbsp;|&#160;|&#xa0;/gi, blank);
}

/**
 * User-facing attribute values, with the offset of the value inside the file.
 * href and src are deliberately absent: a URL containing /campaign/ is a
 * redirect that still has to work, not a public phrase.
 */
const ATTR_RE = /\b(alt|title|aria-label|aria-description|aria-roledescription|placeholder)\s*=\s*"([^"]*)"/gi;
const META_RE = /<meta\b[^>]*\b(?:name|property)\s*=\s*"(description|og:description|og:title|twitter:description|twitter:title)"[^>]*>/gi;
const CONTENT_RE = /\bcontent\s*=\s*"([^"]*)"/i;

function attrSpans(html) {
  const spans = [];
  for (const m of html.matchAll(ATTR_RE)) {
    spans.push({ where: `@${m[1]}`, text: m[2], offset: m.index + m[0].indexOf(m[2]) });
  }
  for (const m of html.matchAll(META_RE)) {
    const c = CONTENT_RE.exec(m[0]);
    if (!c) continue;
    spans.push({ where: `@meta ${m[1]}`, text: c[1], offset: m.index + m[0].indexOf(c[1]) });
  }
  return spans;
}

/** 1-based line number of a byte offset, computed once per file. */
function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: offset - starts[lo] + 1 };
  };
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

const pages = distPages(dist);
if (pages.length === 0) {
  console.error(
    `FAIL terms: no built pages under ${dist}. This gate reads built output, not source. Run npm run build first.`,
  );
  process.exit(1);
}

const allowed = (rule, route) =>
  rule.allowRoutes.some((p) => route.startsWith(p)) ||
  rule.allowRoutePatterns.some((re) => re.test(route));

const hits = [];
let swept = 0;
let stubs = 0;
const exemptedPages = new Map();

for (const file of pages) {
  const route = routeOf(file, dist);
  const html = readFileSync(file, "utf-8");

  // A meta-refresh stub is a redirect, not a page. Its whole content is the old
  // URL it preserves, and D-26 keeps those URLs working on purpose.
  if (/<meta\s+http-equiv=["']refresh["']/i.test(html)) {
    stubs += 1;
    continue;
  }
  swept += 1;

  const masked = maskHtml(html);
  const lineOf = lineIndex(html);
  const attrs = attrSpans(html);

  for (const rule of rules) {
    if (allowed(rule, route)) {
      const list = exemptedPages.get(rule.id) ?? new Set();
      list.add(route);
      exemptedPages.set(rule.id, list);
      continue;
    }

    /**
     * TWO INDICES, AND CONFLATING THEM SILENTLY DISABLED HALF THE GATE.
     *
     * `admissible` and `contextWindow` read INTO `text`, so they need an offset
     * local to that string. `lineOf` reads into the whole file, so it needs a
     * file-level one. The attribute path used to pass span-local text with a
     * file-level index, so every constrained term inside an attribute looked at
     * characters past the end of its own span: context came back empty, no
     * licensing phrase could ever be found, and **no constrained word in any
     * attribute could be licensed at all.** The symptom was `"context": ""` on
     * every attribute hit, which reads as "no context nearby" rather than as a
     * bug, which is why it survived.
     */
    const record = (text, localIndex, fileIndex, match, where) => {
      if (admissible(rule, text, { index: localIndex, 0: match })) return;
      const { line, col } = lineOf(fileIndex);
      hits.push({
        rule: rule.id,
        kind: rule.kind,
        route,
        file: file.startsWith(ROOT + "/") ? relative(ROOT, file) : file,
        line,
        col,
        where,
        match,
        context: contextWindow(text, localIndex, match.length, 90).replace(/\s+/g, " ").trim(),
        canonical: rule.canonical,
        why: rule.why,
        citation: rule.citation,
        owner: rule.owner ?? null,
      });
    };

    if (rule.scope !== "attrs") {
      rule.re.lastIndex = 0;
      for (const m of masked.matchAll(rule.re)) record(masked, m.index, m.index, m[0], "text");
    }
    if (rule.scope !== "text") {
      for (const span of attrs) {
        rule.re.lastIndex = 0;
        for (const m of span.text.matchAll(rule.re)) {
          record(span.text, m.index, span.offset + m.index, m[0], span.where);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * A phrase on nearly every route came from the shell, not from a page. Reported
 * as one finding with its route count rather than as 162 findings, because it
 * is one edit, and because a rule that reports 162 rows for a footer link
 * buries the fifteen rows that are somebody's page.
 */
const CHROME_SHARE = 0.8;
const chromeKey = (h) => `${h.rule} ${h.where} ${h.match}`;
const spread = new Map();
for (const h of hits) {
  const k = chromeKey(h);
  if (!spread.has(k)) spread.set(k, new Set());
  spread.get(k).add(h.route);
}
const isChrome = (h) => spread.get(chromeKey(h)).size >= swept * CHROME_SHARE;
for (const h of hits) h.surface = isChrome(h) ? "global chrome" : "page";

const byRule = new Map();
for (const h of hits) {
  if (!byRule.has(h.rule)) byRule.set(h.rule, []);
  byRule.get(h.rule).push(h);
}

const SHOW = Number(process.env.TERMS_SHOW ?? 6);

for (const [id, list] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
  const rule = rules.find((r) => r.id === id);
  const routes = new Set(list.map((h) => h.route));
  const chrome = list.filter((h) => h.surface === "global chrome");
  const page = list.filter((h) => h.surface === "page");
  console.error(`\nFAIL ${rule.kind} term "${id}": ${list.length} hit(s) on ${routes.size} route(s)`);
  console.error(`  why:       ${rule.why}`);
  console.error(`  canonical: ${rule.canonical}`);
  console.error(`  citation:  ${rule.citation}`);
  const fam = new Map();
  for (const h of list) {
    const f = h.route === "/" ? "/ (home)" : "/" + h.route.split("/").filter(Boolean)[0] + "/";
    fam.set(f, (fam.get(f) ?? 0) + 1);
  }
  console.error(
    `  spread:    ${new Set(list.map((h) => h.match)).size} distinct string(s) across ` +
      [...fam].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}=${n}`).join(" "),
  );
  if (chrome.length) {
    const strings = [...new Set(chrome.map((h) => `${h.where} "${h.match}"`))];
    console.error(
      `  GLOBAL CHROME: ${strings.join(", ")} on ${new Set(chrome.map((h) => h.route)).size} of ${swept} routes. One edit, not ${chrome.length}.`,
    );
    console.error(`      first at ${chrome[0].file}:${chrome[0].line}:${chrome[0].col}`);
  }
  for (const h of page.slice(0, SHOW)) {
    console.error(`  ${h.file}:${h.line}:${h.col} ${h.where}  "${h.match}"`);
    console.error(`      …${h.context}…`);
  }
  if (page.length > SHOW) console.error(`  ... and ${page.length - SHOW} more page hits (TERMS_SHOW=${page.length} to see all)`);
}

if (jsonOut) {
  const path = join(ROOT, jsonOut);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dist,
        pagesScanned: swept,
        redirectStubsSkipped: stubs,
        rules: rules.map((r) => ({
          id: r.id,
          kind: r.kind,
          canonical: r.canonical,
          why: r.why,
          citation: r.citation,
          allow: r.allow ?? {},
          exemptedRoutes: [...(exemptedPages.get(r.id) ?? [])].sort(),
        })),
        hits,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`terms: inventory written to ${jsonOut} (${hits.length} hits)`);
}

console.log(
  `\nterms: ${swept} of ${pages.length} built pages scanned (${stubs} redirect stubs skipped) ` +
    `against ${rules.length} rules, self-test green, ${hits.length} hits on ${new Set(hits.map((h) => h.route)).size} routes`,
);
process.exit(hits.length > 0 ? 1 : 0);
