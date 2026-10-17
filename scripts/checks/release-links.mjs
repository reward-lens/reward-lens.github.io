/** Hard Pages gate for current release links and built install/version copy. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertReleaseCopy } from "./release-copy.mjs";

const ROOT = join(fileURLToPath(new URL("../..", import.meta.url)));
const release = JSON.parse(readFileSync(join(ROOT, "src/data/release.json"), "utf8"));
const built = (route) => readFileSync(join(ROOT, "dist", route), "utf8");
assertReleaseCopy({
  release,
  home: built("index.html"),
  start: built("start/index.html"),
  install: built("docs/getting-started/install/index.html"),
  gettingStarted: built("docs/getting-started/index.html"),
});
for (const url of [
  "https://pypi.org/project/reward-lens/3.1.0/",
  "https://github.com/reward-lens/reward-lens/releases/tag/v3.1.0",
  "https://reward-lens.github.io/docs/getting-started/install/",
]) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  if (new URL(response.url).hostname !== new URL(url).hostname) {
    throw new Error(`${url} redirects to unexpected host ${response.url}`);
  }
}
console.log("built install/version rows and public release links verified");
