// P4 · the precomputed state space, in bytes, per interactive.
//
// DESIGN.md requires every interactive to declare its state count and byte
// cost, and components/intervention-panel.md criterion 9 puts a 40 KB ceiling
// on one of them. Measured from BUILT OUTPUT rather than from the source, and
// gzipped as well as raw, because the raw number is what the build carries and
// the gzipped one is what the reader downloads.
import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const routes = ["see/run", "see/reward-model", "see/grader"];
const hooks = [
  ["timeline-scrubber", /<script type="application\/json"[^>]*data-scrubber-state[^>]*>([\s\S]*?)<\/script>/],
  ["intervention-panel", /<script type="application\/json"[^>]*data-ip-state[^>]*>([\s\S]*?)<\/script>/],
];

// act-grader-cards holds no inlined JSON at all: both access states are RENDERED
// server-side and the script only hides one of them, which is what makes the
// no-JavaScript path the better exhibit. Its precomputed state space is
// therefore DOM rather than data, so it is measured as the bytes of the state
// that is hidden on load, which is what the page carries for the sake of the
// interaction and would not carry otherwise.
const domHooks = [
  ["act-grader-cards, hidden access state", /<section[^>]*data-access-state="log_only"[\s\S]*?<\/section>/],
];

for (const route of routes) {
  const file = join(ROOT, "dist", route, "index.html");
  if (!existsSync(file)) {
    console.log(`${route}: not built`);
    continue;
  }
  const html = readFileSync(file, "utf-8");
  const pageBytes = Buffer.byteLength(html);
  console.log(`/${route}/  page ${pageBytes.toLocaleString("en-GB")} B raw, ` +
    `${gzipSync(html).length.toLocaleString("en-GB")} B gzipped`);
  for (const [name, re] of hooks) {
    const m = html.match(re);
    if (!m) continue;
    const raw = Buffer.byteLength(m[1]);
    const gz = gzipSync(Buffer.from(m[1])).length;
    console.log(
      `        ${name}: ${raw.toLocaleString("en-GB")} B raw, ` +
        `${gz.toLocaleString("en-GB")} B gzipped`,
    );
  }
  for (const [name, re] of domHooks) {
    const m = html.match(re);
    if (!m) continue;
    const raw = Buffer.byteLength(m[0]);
    const gz = gzipSync(Buffer.from(m[0])).length;
    console.log(
      `        ${name}: ${raw.toLocaleString("en-GB")} B raw, ` +
        `${gz.toLocaleString("en-GB")} B gzipped`,
    );
  }
}
