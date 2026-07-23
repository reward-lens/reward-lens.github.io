// Every old docs URL in the redirect map must resolve to a page that exists
// in the built site; a mismatch silently 404s the entire redirect layer.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2] ?? "dist";
const redirects = JSON.parse(
  readFileSync("src/data/redirects.json", "utf-8"),
);

let failures = 0;
const entries = Object.entries(redirects);
for (const [oldPath, newPath] of entries) {
  const target = join(dist, newPath, "index.html");
  if (!existsSync(target)) {
    console.error(`FAIL redirect target missing: ${oldPath} -> ${newPath}`);
    failures += 1;
  }
}
console.log(`redirects: ${entries.length} mappings checked, ${failures} failures`);
process.exit(failures > 0 ? 1 : 0);
