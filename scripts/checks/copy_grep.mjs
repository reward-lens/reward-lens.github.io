// The copy gate: rendered HTML must be free of em dashes, hype vocabulary,
// placeholder text, and KaTeX render errors.
//
// Documented exemption: pages under /docs/reference/ render the library's own
// docstrings verbatim; em dashes and vocabulary inside quoted source text are
// the library's, not site copy, so those pages are exempt from the dash and
// vocabulary checks (never from katex/TODO/lorem/coming-soon).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2] ?? "dist";
const pages = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "pagefind") continue;
      walk(p);
    } else if (p.endsWith(".html")) pages.push(p);
  }
};
walk(dist);

const BANNED = [
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
  /isn['’]t just/i,
  /\bcoming soon\b/i,
  /\blorem\b/i,
  /\bTODO\b/,
];

const visibleText = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");

let failures = 0;
for (const page of pages) {
  const html = readFileSync(page, "utf-8");
  const isReference = page.includes(`${join("docs", "reference")}`);
  const isDev = page.includes("dev-components");
  const text = visibleText(html);

  if (html.includes("katex-error")) {
    console.error(`FAIL katex-error in ${page}`);
    failures += 1;
  }
  for (const re of [/\bcoming soon\b/i, /\blorem\b/i, /\bTODO\b/]) {
    const m = text.match(re);
    if (m) {
      console.error(`FAIL "${m[0]}" in ${page}`);
      failures += 1;
    }
  }
  if (isReference || isDev) continue;
  if (text.includes("—")) {
    console.error(`FAIL em dash in ${page}`);
    failures += 1;
  }
  for (const re of BANNED) {
    const m = text.match(re);
    if (m) {
      console.error(`FAIL banned vocabulary "${m[0]}" in ${page}`);
      failures += 1;
    }
  }
}

console.log(`copy_grep: ${pages.length} pages scanned, ${failures} failures`);
process.exit(failures > 0 ? 1 : 0);
