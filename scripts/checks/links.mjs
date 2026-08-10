// Internal link checker over the built site. Zero broken internal links or
// assets allowed; external URLs are collected and printed for manual review.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2] ?? "dist";
const pages = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".html")) pages.push(p);
  }
};
walk(dist);

const externals = new Set();
let failures = 0;
const seenMissing = new Set();

for (const page of pages) {
  if (page.includes("dev-components")) continue; // build-time review page, removed before launch
  const html = readFileSync(page, "utf-8");
  const refs = [...html.matchAll(/(?:href|src|srcset)="([^"]+)"/g)].map(
    (m) => m[1],
  );
  for (let ref of refs) {
    if (
      ref.startsWith("http://") ||
      ref.startsWith("https://") ||
      ref.startsWith("mailto:")
    ) {
      externals.add(ref.split("#")[0]);
      continue;
    }
    if (ref.startsWith("#") || ref.startsWith("data:")) continue;
    ref = ref.split("#")[0].split("?")[0];
    if (!ref) continue;
    if (!ref.startsWith("/")) continue; // relative refs are not used
    // C-42: `existsSync(file)` is true for a bare DIRECTORY, so any route whose
    // directory exists for some other reason passed while serving nothing.
    // `/see/` was green with no dist/see/index.html the moment P4 built
    // /see/run/, and every unbuilt route family passes the same way. It is the
    // same shape as the redirect gate asserting that destinations exist instead
    // of that sources resolve (C-3): a check confirming a path is present
    // rather than that a reader gets a page.
    //
    // A reference resolves only if it reaches a FILE. A directory resolves
    // through its index.html and through nothing else.
    const file = join(dist, decodeURIComponent(ref));
    const isFile = (p) => existsSync(p) && statSync(p).isFile();
    const ok = isFile(file) || isFile(join(file, "index.html")) || isFile(file + ".html");
    if (!ok) {
      const key = ref;
      if (!seenMissing.has(key)) {
        const why =
          existsSync(file) && statSync(file).isDirectory()
            ? ` (dist${ref} is a directory with no index.html, so it serves nothing)`
            : "";
        console.error(`FAIL broken internal ref ${ref}${why} (first seen in ${page})`);
        seenMissing.add(key);
        failures += 1;
      }
    }
  }
}

console.log(
  `links: ${pages.length} pages scanned, ${seenMissing.size} broken internal refs, ${externals.size} distinct external URLs`,
);
if (process.env.PRINT_EXTERNALS) {
  for (const u of [...externals].sort()) console.log("  external:", u);
}
process.exit(failures > 0 ? 1 : 0);
