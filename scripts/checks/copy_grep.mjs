// Gate 9 · Copy bans
//
// Order matters, and it is the first thing this file does.
//
// **It parses copy.yaml and fails on a parse error before it checks any
// content.** C-12: the file did not parse at all until wave 0 validated it. Two
// syntax errors, both fatal, both in `_headline_candidates`, and yaml.safe_load
// failed on the whole document. Every packet that loads copy would have failed
// on its first run. A gate that greps copy.yaml as text would have passed both.
// That is the same class of defect as an accessibility check existing as a
// script no workflow invoked: an artifact treated as authoritative that nothing
// had executed.
//
// Then, over both copy.yaml's leaves and the rendered HTML in dist/:
//
//   - an em dash used as sentence punctuation
//   - a hype word
//   - a leaked authoring intent phrase
//   - a .katex-error node
//
// TWO WORD-SENSE EXCEPTIONS, both declared in QA.md §6.9, both implemented
// narrowly. A broad implementation of either reopens the whole ban.
//
//   1. The exact phrase "the sign is robust" is a statistical property, not a
//      marketing adjective. copy.yaml:acts.run.companion reads "The sign is
//      robust and the magnitude is not," which is the project's own phrasing.
//      The allow-list is the phrase and not the bare word: "robust" anywhere
//      else is the banned sense.
//   2. An em dash whose ENTIRE table-cell content is that character is a null
//      marker, a data convention. A detector that does not alarm has no lead
//      time. The ban is on the em dash as a sentence connective, which is what
//      makes writing read as generated.
//
// One standing exemption, inherited and narrowed: pages under /docs/api/
// render the library's own docstrings verbatim.
//
// That route was /docs/reference/ until P5 moved it, because copy.yaml's
// footer names /docs/api/ and copy.yaml is the frozen owner of every
// user-facing string. The path below moved with it. Em dashes and vocabulary inside
// quoted source text are the library's, not site copy, so those pages are
// exempt from the dash and hype checks and never from katex, placeholder or
// leaked-intent. Same reasoning as C-10: the site does not silently correct the
// prose of a page it ports.
//
// copy.yaml's top-level keys beginning with `_` are appendices that no page
// renders: `_headline_candidates` holds twenty rejected headlines with the
// design lead's reasoning beside each. They are scanned for parse validity and
// not for prose bans, because their whole content is authoring intent by
// design.
//
// Usage:  node scripts/checks/copy_grep.mjs [dist]

import { readFileSync } from "node:fs";
import {
  DIST, COPY_PATH, distPages, routeOf, textNodes, visibleText, decodeEntities,
  parseCopy, leafStrings,
} from "./_lib.mjs";

const dist = process.argv[2] ?? DIST;
// Source code and command output. A dash or a word inside quoted source is the
// source's, not the site's prose.
const CODEISH = new Set(["code", "pre", "kbd", "samp"]);

// ---------------------------------------------------------------------------
// 0. Parse copy.yaml. This runs before anything else and a throw is the gate.
// ---------------------------------------------------------------------------

let copy;
try {
  copy = await parseCopy(COPY_PATH);
} catch (e) {
  console.error(`FAIL copy.yaml does not parse. Gate 9 checks nothing until it does.`);
  console.error(`  ${COPY_PATH}`);
  console.error(`  ${e.message.split("\n").slice(0, 6).join("\n  ")}`);
  console.error(
    `\ncopy.yaml is the single source of every string on the site. C-12 records two fatal syntax\n` +
      `errors that survived because everything that touched this file grepped it as text.`,
  );
  process.exit(1);
}
if (!copy || typeof copy !== "object") {
  console.error(`FAIL copy.yaml parsed to ${typeof copy}, not a mapping.`);
  process.exit(1);
}

const leaves = leafStrings(
  Object.fromEntries(Object.entries(copy).filter(([k]) => !k.startsWith("_"))),
);
const topLevelKeys = Object.keys(copy).length;
console.log(
  `copy.yaml parses: ${topLevelKeys} top-level keys, ${Object.keys(leaves).length} leaf strings outside the appendices`,
);

// ---------------------------------------------------------------------------
// The bans
// ---------------------------------------------------------------------------

const HYPE = [
  /\bseamless(ly)?\b/i,
  /\bcutting-edge\b/i,
  /\bstate-of-the-art\b/i,
  /\brevolutionar(y|ies)\b/i,
  /\bblazingly\b/i,
  /\beffortless(ly)?\b/i,
  /\bsupercharge/i,
  /\bdelve\b/i,
  /\bunlock(s|ed|ing)?\b/i,
  /\bleverag(e|es|ed|ing)\b/i,
  /\bcomprehensive(ly)?\b/i,
  /\bgame[- ]chang(er|ing)\b/i,
  /\bpowerful\b/i,
  /\bworld[- ]class\b/i,
  /\bbest[- ]in[- ]class\b/i,
  /\brobust\b/i,
  /isn['’]t just/i,
  /\bnot just .{0,24}\bit['’]s\b/i,
];

// The exception, and it is the exact phrase. QA.md §6.9 item 1.
const ROBUST_EXCEPTION = /the sign is robust/i;

// Every entry here is a phrase that only occurs when the authoring process
// leaks. "language model" is deliberately NOT one: a reward model is a language
// model and the phrase is central domain vocabulary on this site. A ban that
// fires on the subject matter is a ban that gets disabled.
const LEAKED_INTENT = [
  /\bas an AI\b/i,
  /\bI (?:have|'ve) (?:written|created|generated|drafted)\b/i,
  /\bhere(?:'s| is) (?:the|a|your) (?:updated|revised|complete|final)\b/i,
  /\bper (?:the|your) (?:brief|prompt|instructions?|request)\b/i,
  /\bthe (?:design|build) lead\b/i,
  /\bpacket [A-Z]\d\b/,
  /\bwave [0-3]\b/i,
  /\bcopy\.yaml\b/i,
  /\bDESIGN\.md\b/,
  // The filename, case-sensitive, with its extension. "ground truth" and
  // "ground-truth" are ordinary technical vocabulary here: one campaign card is
  // literally "Attribution versus patching, adjudicated against planted ground
  // truth". Banning the bare phrase caught five legitimate uses and no leak.
  /\bGROUND-TRUTH\.md\b/,
  /\bDECISIONS\.md\b/,
  /\bplaceholder\b/i,
  /\bcoming soon\b/i,
  /\blorem\b/i,
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bXXX\b/,
  /\bTBD\b/,
  /\bfill (?:this|these) in\b/i,
  /\bdraft copy\b/i,
];

// Placeholder and leaked-intent apply everywhere, including the reference pages.
const NEVER_EXEMPT = [
  /\bcoming soon\b/i,
  /\blorem\b/i,
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bplaceholder\b/i,
];

const EM_DASH = "—";

let failures = 0;
const report = (msg) => {
  console.error(msg);
  failures += 1;
};

// ---------------------------------------------------------------------------
// 1. copy.yaml's own leaves
// ---------------------------------------------------------------------------

for (const [key, value] of Object.entries(leaves)) {
  if (value.includes(EM_DASH)) {
    report(`FAIL em dash in copy.yaml:${key}   "${value.trim().slice(0, 80)}"`);
  }
  for (const re of HYPE) {
    const m = value.match(re);
    if (!m) continue;
    if (re.source === "\\brobust\\b" && ROBUST_EXCEPTION.test(value)) continue;
    report(`FAIL hype word "${m[0]}" in copy.yaml:${key}`);
  }
  for (const re of LEAKED_INTENT) {
    const m = value.match(re);
    if (m) report(`FAIL leaked authoring intent "${m[0]}" in copy.yaml:${key}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Rendered HTML
// ---------------------------------------------------------------------------

const pages = distPages(dist);
if (pages.length === 0) {
  console.error(`FAIL copy_grep: no built pages under ${dist}. Run npm run build first.`);
  process.exit(1);
}

let nullMarkers = 0;

for (const file of pages) {
  const route = routeOf(file, dist);
  const html = readFileSync(file, "utf-8");
  const isReference = route.startsWith("/docs/api/");
  const text = visibleText(html);

  if (html.includes("katex-error")) {
    report(`FAIL .katex-error node in ${route}`);
  }
  for (const re of NEVER_EXEMPT) {
    const m = text.match(re);
    if (m) report(`FAIL "${m[0]}" in ${route}`);
  }
  for (const re of LEAKED_INTENT) {
    if (NEVER_EXEMPT.some((n) => n.source === re.source)) continue;
    const m = text.match(re);
    if (m) report(`FAIL leaked authoring intent "${m[0]}" in ${route}`);
  }

  if (isReference) continue;

  // The null-marker exception, implemented on the WHOLE CELL and not on the
  // text node. QA.md §6.9 says "skips cells whose entire content is the
  // character", and a cell's content is routinely wrapped: <td><span>—</span>
  // </td>. Testing the text node's immediate parent rejected all 22 genuine
  // null markers in the component gallery, which is a broad implementation of
  // the ban arriving by accident rather than by decision.
  //
  // One refinement the wording did not anticipate. The accessible way to render
  // a null marker is
  //     <span aria-hidden="true">—</span><span class="visually-hidden">not measured</span>
  // so the cell's raw text is "— not measured" and a literal reading of "entire
  // content is that character" rejects the correct implementation and accepts
  // only the inaccessible one. The visually-hidden span is the dash's accessible
  // equivalent, not prose, so it is removed before the test. The exception stays
  // narrow: whatever is left has to be exactly the character, so a cell with any
  // other visible content still fails.
  const withoutNullCells = html.replace(
    /<(t[dh])\b[^>]*>((?:(?!<\/?t[dh]\b)[\s\S])*)<\/\1>/gi,
    (whole, tag, inner) => {
      const visible = inner.replace(
        /<span[^>]*class="[^"]*visually-hidden[^"]*"[^>]*>[\s\S]*?<\/span>/gi,
        "",
      );
      const stripped = decodeEntities(visible.replace(/<[^>]+>/g, "")).trim();
      if (stripped === EM_DASH) {
        nullMarkers += 1;
        return `<${tag}></${tag}>`;
      }
      return whole;
    },
  );

  // Em dashes, node by node, with code and command output out of scope: a dash
  // inside quoted source is the source's, not the site's prose.
  for (const node of textNodes(withoutNullCells)) {
    if (!node.text.includes(EM_DASH)) continue;
    if (node.ancestors.some((a) => CODEISH.has(a.tag))) continue;
    report(
      `FAIL em dash as prose punctuation in ${route}   "${node.text.trim().slice(0, 80)}"`,
    );
  }

  // Hype, over prose only. A function named certify_robustness is an API, and
  // flagging it would make the hype ban an argument about identifiers.
  const prose = textNodes(html)
    .filter((n) => !n.ancestors.some((a) => CODEISH.has(a.tag)))
    .map((n) => n.text)
    .join(" ");
  for (const re of HYPE) {
    const m = prose.match(re);
    if (!m) continue;
    if (re.source === "\\brobust\\b") {
      // The exception is the phrase, not the word. Confirm the phrase is what
      // matched at this position, rather than that the phrase occurs somewhere
      // on a page that also uses the banned sense elsewhere.
      const around = prose.slice(Math.max(0, m.index - 20), m.index + 24);
      if (ROBUST_EXCEPTION.test(around)) continue;
    }
    report(`FAIL hype word "${m[0]}" in ${route}   "${prose.slice(Math.max(0, m.index - 50), m.index + 60).trim()}"`);
  }
}

console.log(
  `copy_grep: ${pages.length} pages scanned, ${nullMarkers} em dash(es) accepted as table null markers, ${failures} failures`,
);
process.exit(failures > 0 ? 1 : 0);
