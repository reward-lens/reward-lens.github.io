// Meta and OG audit: every page carries a title, description, canonical, and
// OG image; the sitemap exists and robots.txt references it; Pagefind's index
// is present.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
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

let failures = 0;
for (const page of pages) {
  if (page.includes("dev-components")) continue;
  const html = readFileSync(page, "utf-8");
  const misses = [];
  if (!/<title>[^<]+<\/title>/.test(html)) misses.push("title");
  if (!/<meta name="description" content="[^"]+"/.test(html))
    misses.push("description");
  if (!/<link rel="canonical" href="[^"]+"/.test(html)) misses.push("canonical");
  if (!/<meta property="og:image" content="[^"]+"/.test(html))
    misses.push("og:image");
  const og = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (og) {
    const rel = og[1].replace("https://reward-lens.github.io", "");
    if (!existsSync(join(dist, rel))) misses.push(`og image file ${rel}`);
  }
  if (misses.length) {
    console.error(`FAIL ${page}: missing ${misses.join(", ")}`);
    failures += 1;
  }
}

if (!existsSync(join(dist, "sitemap-index.xml"))) {
  console.error("FAIL sitemap-index.xml missing");
  failures += 1;
}
const robots = join(dist, "robots.txt");
if (!existsSync(robots) || !readFileSync(robots, "utf-8").includes("Sitemap:")) {
  console.error("FAIL robots.txt missing or lacks Sitemap line");
  failures += 1;
}
if (!existsSync(join(dist, "pagefind", "pagefind.js"))) {
  console.error("FAIL pagefind index missing (run pagefind after astro build)");
  failures += 1;
}

console.log(`meta_audit: ${pages.length} pages audited, ${failures} failures`);
process.exit(failures > 0 ? 1 : 0);
