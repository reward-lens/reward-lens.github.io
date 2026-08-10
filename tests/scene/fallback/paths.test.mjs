/**
 * The six fallback paths, asserted against the built bytes.
 *
 * WHY THIS READS dist/ RATHER THAN DRIVING A BROWSER. The browser half is
 * `_shoot.mjs`, which needs Chrome, a server and about two minutes. This is the
 * half that belongs in `node --test tests/scene/`: it asserts what has to be
 * IN the document for the paths to work at all, which is exactly the set of
 * things a reader with no scripting gets and nothing else can supply later.
 *
 * Every test here skips loudly when dist/ is absent rather than passing. A
 * suite that goes green because it found nothing to check is the failure mode
 * this repository has a ledger for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HOME = join(ROOT, "dist", "index.html");
const NOSCENE = join(ROOT, "dist-noscene", "index.html");

const index = JSON.parse(readFileSync(join(ROOT, "src/data/scene/stills/index.json"), "utf-8"));

const html = existsSync(HOME) ? readFileSync(HOME, "utf-8") : null;
const noscene = existsSync(NOSCENE) ? readFileSync(NOSCENE, "utf-8") : null;

const needsBuild = (t) => {
  if (html) return false;
  t.skip("dist/index.html is absent. Run npm run build first.");
  return true;
};

test("the still layer is in the document, with its three landmarks", (t) => {
  if (needsBuild(t)) return;
  assert.match(html, /data-fidelity="still"/);
  assert.match(html, /data-beam-axis="0\.5"/);
  assert.match(html, /data-prism-centroid="0\.62,0\.5"/);
  for (const name of ["beam-axis", "prism-centroid", "detector-plane"]) {
    // Twice: once in the hand-authored room, once in the still. Both arms of
    // gate 20's comparison are rendered rather than one being computed.
    const hits = html.match(new RegExp(`data-landmark="${name}"`, "g")) ?? [];
    assert.equal(hits.length, 2, `${name} appears ${hits.length} times, expected the SVG's and the still's`);
  }
});

test("no JavaScript: the complete argument is in the served bytes", (t) => {
  if (needsBuild(t)) return;
  // The install command, which is the page's one action.
  assert.match(html, /pip install reward-lens/);
  // Every state's still, its plate, and its caption.
  for (const state of index.states) {
    const s = index.stills[state.defaultCase];
    assert.ok(html.includes(s.plateKind), `${state.id}: the plate kind is not in the document`);
    assert.ok(html.includes(s.publicLabel), `${state.id}: the subject is not in the document`);
    // The caption is long and entity-encoded in places, so a distinctive run of
    // it is the honest check rather than the whole string.
    const probe = s.caption.split(/[.;]/)[0].slice(0, 40);
    assert.ok(html.includes(probe), `${state.id}: the caption is not in the document`);
  }
  // The truth mode, as a word rather than as a border.
  assert.ok(html.includes(">measured<"), "no still states `measured` in text");
  assert.ok(html.includes(">schematic<"), "no still states `schematic` in text");
});

test("no JavaScript: the state machine is inputs and labels, not script", (t) => {
  if (needsBuild(t)) return;
  for (const state of index.states) {
    assert.ok(
      html.includes(`id="rl-still-state-${state.id}"`),
      `${state.id} has no radio, so it cannot be reached without scripting`,
    );
  }
  const scorer = index.states.find((s) => s.id === "scorer");
  for (const id of scorer.cases) {
    assert.ok(html.includes(`id="rl-still-case-${id}"`), `${id} has no radio`);
  }
  // Every radio is named by a label, which is what makes the group announce.
  for (const state of index.states) {
    assert.ok(html.includes(`for="rl-still-state-${state.id}"`), `${state.id} has no label`);
  }
});

test("no information disappears: every drawn quantity is also a row in words", (t) => {
  if (needsBuild(t)) return;
  for (const s of Object.values(index.stills)) {
    if (s.truthMode === "schematic") continue;
    for (const row of s.readout) {
      assert.ok(
        html.includes(row.label) && html.includes(row.value),
        `${s.caseId}: the key row "${row.label} ${row.value}" is not in the document`,
      );
    }
  }
});

test("reduced motion: nothing in the still layer animates", (t) => {
  if (needsBuild(t)) return;
  const dir = join(ROOT, "dist", "_astro");
  const css = readdirSync(dir)
    .filter((f) => f.endsWith(".css"))
    .map((f) => readFileSync(join(dir, f), "utf-8"))
    .join("\n");
  assert.ok(css.includes("still-layer"), "the still layer's stylesheet is not in dist/_astro");

  // Every rule that mentions one of this packet's classes. The only motion the
  // still layer is allowed is one opacity transition, and only while the reader
  // is still in the scene region; a keyframe animation on this layer would run
  // forever for a reader who asked for less motion.
  const own = (css.match(/[^{}]*\{[^{}]*\}/g) ?? []).filter((r) =>
    /\.still-layer|\.still__|\.still\b/.test(r.split("{")[0]),
  );
  assert.ok(own.length > 10, `only ${own.length} still rules found; the selector match is wrong`);
  for (const rule of own) {
    assert.equal(
      /animation\s*:/.test(rule),
      false,
      `a still rule declares an animation: ${rule.slice(0, 90)}`,
    );
    if (!/transition\s*:/.test(rule)) continue;
    assert.ok(
      /transition\s*:\s*none/.test(rule) || /transition[^;}]*opacity/.test(rule),
      `a still rule transitions something other than opacity: ${rule.slice(0, 110)}`,
    );
  }
});

test("the kill switch removes the island from the document", (t) => {
  if (!noscene) {
    t.skip("dist-noscene/index.html is absent. Run PUBLIC_SCENE=off npx astro build --outDir dist-noscene.");
    return;
  }
  assert.equal(/<astro-island/.test(noscene), false, "PUBLIC_SCENE=off still renders an island");
  assert.equal(/SceneMount/.test(noscene), false, "PUBLIC_SCENE=off still references the island's entry");
  // And the still is still there, marked permanent, so the page loses nothing.
  assert.match(noscene, /data-fidelity="still"/);
  assert.match(noscene, /data-scene-off="true"/);
  // The ordinary build is the control: it DOES have the island, so this test
  // can fail rather than being true of both.
  if (html) assert.match(html, /<astro-island/);
});
