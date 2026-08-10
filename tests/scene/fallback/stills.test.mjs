/**
 * The generated stills, checked against the record they came from.
 *
 * These are the assertions that do not need a browser: that every case in the
 * scene manifest has a still, that no still says something its case's truth
 * mode forbids, that every drawn coordinate is inside the space the generator
 * documents, and that a rebuild is byte identical. The browser half is
 * `paths.test.mjs` beside this file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf-8"));

const manifest = read("src/data/scene/manifest.json");
const captions = read("src/data/scene/captions.json");
const index = read("src/data/scene/stills/index.json");
const lock = read("src/data/scene/stills/lock.json");

test("every case in the scene manifest has a still", () => {
  const missing = manifest.cases.map((c) => c.id).filter((id) => !index.stills[id]);
  assert.deepEqual(
    missing,
    [],
    "a case with no still is a state a reader without WebGL never sees, which is the " +
      "one failure the fallback exists to prevent",
  );
  assert.equal(Object.keys(index.stills).length, manifest.cases.length);
});

test("the five frozen states are all present, in scroll order", () => {
  assert.deepEqual(
    index.states.map((s) => s.id),
    ["scorer", "selection", "update", "response", "run-boundary"],
  );
  for (const state of index.states) {
    assert.ok(state.cases.includes(state.defaultCase), `${state.id} default is not one of its cases`);
    for (const id of state.cases) {
      assert.equal(index.stills[id].state, state.id);
    }
  }
});

test("a still's truth mode, plate and caption are the manifest's, not a second copy", () => {
  for (const c of manifest.cases) {
    const s = index.stills[c.id];
    assert.equal(s.truthMode, c.truthMode, `${c.id} truth mode`);
    assert.equal(s.plateKind, c.plateKind, `${c.id} plate kind`);
    assert.equal(s.publicLabel, c.publicLabel, `${c.id} public label`);
    assert.equal(s.contentHash, c.contentHash, `${c.id} content hash`);
    assert.equal(s.caption, captions.captions[c.id].text, `${c.id} caption`);
  }
});

test("a schematic case draws no quantity, and a measured one draws several", () => {
  for (const s of Object.values(index.stills)) {
    const quantitative = s.marks.filter((m) =>
      ["ribbon", "trace", "rays", "marks", "ticks", "bar", "gate"].includes(m.kind),
    );
    if (s.truthMode === "schematic") {
      assert.equal(
        quantitative.length,
        0,
        `${s.caseId} is schematic and draws ${quantitative.length} quantitative mark(s). ` +
          `A construction that looks measured is the single failure the truth contract exists to prevent.`,
      );
      assert.deepEqual(s.readout, [], `${s.caseId} is schematic and states a readout`);
    } else {
      assert.ok(quantitative.length > 0, `${s.caseId} is ${s.truthMode} and draws nothing`);
      assert.ok(s.readout.length > 0, `${s.caseId} is ${s.truthMode} and states no readout`);
      assert.ok(s.sourcePath, `${s.caseId} is ${s.truthMode} and names no source`);
    }
  }
});

test("every drawn coordinate is inside the space the generator documents", () => {
  const inUnit = (v, what) =>
    assert.ok(
      typeof v === "number" && v >= -0.0001 && v <= 1.0001,
      `${what} is ${v}, outside 0..1. Nothing is clamped at generation, so a value out here means ` +
        `the manifest's declared domain and the payload came from different runs.`,
    );
  for (const s of Object.values(index.stills)) {
    for (const m of s.marks) {
      if (m.points) {
        for (const [i, p] of m.points.entries()) {
          inUnit(p[0], `${s.caseId} ${m.kind}[${i}].x`);
          inUnit(p[1], `${s.caseId} ${m.kind}[${i}].y`);
          if (m.kind === "ribbon") inUnit(p[2], `${s.caseId} ribbon[${i}].halfWidth`);
        }
      }
      for (const key of ["y", "y0", "y1", "x0", "x1"]) {
        if (m[key] !== undefined) inUnit(m[key], `${s.caseId} ${m.kind}.${key}`);
      }
      if (m.kind === "ticks") {
        assert.ok(m.lit <= m.count, `${s.caseId} lights ${m.lit} of ${m.count} ticks`);
      }
    }
  }
});

test("a downsampled still says so, with the method and both counts", () => {
  for (const s of Object.values(index.stills)) {
    if (!s.drawn) continue;
    assert.ok(s.drawn.outputCount <= s.drawn.inputCount, `${s.caseId} draws more than it has`);
    assert.match(s.drawn.method, /uniform stride/, `${s.caseId} does not state its method`);
    const budget = Math.max(...Object.values(index.budget));
    assert.ok(s.drawn.outputCount <= budget, `${s.caseId} exceeds every declared budget`);
  }
});

test("no still carries a local filesystem path", () => {
  // The same rule scripts/checks/paths.mjs enforces over dist/, applied to the
  // generated source so a bad still never reaches a build at all.
  const text = JSON.stringify(index);
  for (const re of [/\/home\//, /\/Users\//, /file:\/\//, /\.claude\/worktrees/]) {
    assert.equal(re.test(text), false, `the still index matches ${re}`);
  }
});

test("the lock records what the stills were generated from", () => {
  assert.equal(lock.manifestDigest, read("src/data/scene/build-digest.json").manifestDigest);
  for (const c of manifest.cases) {
    assert.equal(lock.cases[c.id], c.contentHash, `${c.id} is locked to a different hash`);
  }
  for (const path of Object.keys(lock.composition)) {
    assert.ok(existsSync(join(ROOT, path)), `${path} is locked and absent`);
  }
});

test("regenerating is byte identical, and --check says so", () => {
  const before = readFileSync(join(ROOT, "src/data/scene/stills/index.json"));
  const out = execFileSync("node", ["scripts/dev/build-scene-stills.mjs", "--check"], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  assert.match(out, /up to date/);
  assert.deepEqual(
    readFileSync(join(ROOT, "src/data/scene/stills/index.json")),
    before,
    "--check wrote to the file it was asked to check",
  );
});
