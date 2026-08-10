/**
 * What must be true of the generated scene data, checked from disk.
 *
 *   node --test tests/data/scene/
 *
 * The generator already refuses to write output that violates any of this. This
 * file checks the same properties against the files that are actually committed,
 * which is a different question: it catches a hand edit, a partial regeneration,
 * and a payload that drifted from the manifest describing it.
 *
 * Every test here reports how many things it compared. A gate in this repository
 * once reported "0 values compared" and exited zero because its keys did not
 * match what it was comparing, and it had been passing for the wrong reason for
 * some time. Counting is cheap and it is the difference between a gate and a
 * decoration.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SCENE_DIR, importTs, strings } from "./_support.mjs";

const manifestPath = join(SCENE_DIR, "manifest.json");
assert.ok(
  existsSync(manifestPath),
  "src/data/scene/manifest.json does not exist. Run npm run build:scene-data; there is no fallback and no checked-in stand-in.",
);

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const captionFile = JSON.parse(readFileSync(join(SCENE_DIR, "captions.json"), "utf-8"));
const digest = JSON.parse(readFileSync(join(SCENE_DIR, "build-digest.json"), "utf-8"));
const schema = JSON.parse(readFileSync(join(ROOT, "src/data/schema/scene.manifest.schema.json"), "utf-8"));

const truth = await importTs("src/components/scene/types/truth.ts");
const scene = await importTs("src/data/schema/scene.ts");

const payloadOf = (id) => readFileSync(join(SCENE_DIR, "payload", `${id}.bin`));

// ---------------------------------------------------------------------------
// A validator that refuses to under-check
// ---------------------------------------------------------------------------

const KNOWN = new Set([
  "$schema", "$id", "$ref", "$defs", "title", "description",
  "type", "const", "enum", "required", "properties", "additionalProperties",
  "items", "minItems", "maxItems", "minLength", "minimum", "maximum", "pattern", "format",
]);

const typeOf = (v) => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
};
const typeMatches = (want, actual) => want === actual || (want === "number" && actual === "integer");

function validate(node, value, path, root) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (!KNOWN.has(key)) {
      throw new Error(
        `this validator does not implement the JSON Schema keyword "${key}" (at ${path}). ` +
          `Implement it rather than letting this file report a pass it did not earn.`,
      );
    }
  }
  if (node.$ref) {
    const target = root.$defs?.[node.$ref.replace("#/$defs/", "")];
    if (!target) return [`${path}: ${node.$ref} does not resolve`];
    return validate(target, value, path, root);
  }
  if (node.type) {
    const wanted = Array.isArray(node.type) ? node.type : [node.type];
    const actual = typeOf(value);
    if (!wanted.some((w) => typeMatches(w, actual))) {
      return [`${path}: expected ${wanted.join(" or ")}, got ${actual}`];
    }
  }
  if ("const" in node && value !== node.const) out.push(`${path}: expected ${JSON.stringify(node.const)}`);
  if (node.enum && !node.enum.includes(value)) out.push(`${path}: ${JSON.stringify(value)} not in ${JSON.stringify(node.enum)}`);
  if (typeof value === "string") {
    if (node.minLength !== undefined && value.length < node.minLength) out.push(`${path}: shorter than ${node.minLength}`);
    if (node.pattern && !new RegExp(node.pattern).test(value)) out.push(`${path}: ${JSON.stringify(value)} fails /${node.pattern}/`);
    if (node.format === "date-time" && Number.isNaN(Date.parse(value))) out.push(`${path}: not a date-time`);
    if (node.format === "uri" && !/^[a-z][a-z0-9+.-]*:/i.test(value)) out.push(`${path}: not a URI`);
  }
  if (typeof value === "number") {
    if (node.minimum !== undefined && value < node.minimum) out.push(`${path}: below ${node.minimum}`);
    if (node.maximum !== undefined && value > node.maximum) out.push(`${path}: above ${node.maximum}`);
  }
  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems) out.push(`${path}: ${value.length} items, minimum ${node.minItems}`);
    if (node.maxItems !== undefined && value.length > node.maxItems) out.push(`${path}: ${value.length} items, maximum ${node.maxItems}`);
    if (node.items) value.forEach((v, i) => out.push(...validate(node.items, v, `${path}[${i}]`, root)));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const required of node.required ?? []) {
      if (!(required in value)) out.push(`${path}: missing required property "${required}"`);
    }
    for (const [k, v] of Object.entries(value)) {
      const sub = node.properties?.[k];
      if (sub) out.push(...validate(sub, v, `${path}.${k}`, root));
      else if (node.additionalProperties === false) out.push(`${path}.${k}: not in the schema`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

describe("the generated scene manifest", () => {
  test("validates against src/data/schema/scene.manifest.schema.json", () => {
    const problems = validate(schema, manifest, "manifest", schema);
    assert.deepEqual(problems, [], `${problems.length} violation(s):\n  ${problems.join("\n  ")}`);
    assert.ok(manifest.cases.length >= 5, "fewer cases than there are states");
  });

  test("every case satisfies the frozen truth contract", () => {
    let compared = 0;
    for (const c of manifest.cases) {
      const verdict = truth.violatesTruthMode(c);
      assert.equal(verdict, null, verdict ?? "");
      compared += 1;
    }
    assert.ok(compared >= 5, `checked ${compared} cases; a check that compared nothing is not a check`);
  });

  test("all five states are bound, and every case names a state", () => {
    for (const state of truth.INSTRUMENT_STATES) {
      const bound = scene.sceneCasesForState(manifest, state);
      assert.ok(bound.length > 0, `no case is bound to the state "${state}"`);
    }
    assert.equal(new Set(manifest.cases.map((c) => c.id)).size, manifest.cases.length, "two cases share an id");
  });

  test("no generated file carries an absolute local path", () => {
    let compared = 0;
    for (const [name, file] of [
      ["manifest.json", manifest],
      ["captions.json", captionFile],
      ["build-digest.json", digest],
    ]) {
      for (const [path, value] of strings(file)) {
        compared += 1;
        assert.equal(
          truth.leaksLocalPath(value),
          false,
          `${name} at ${path} carries a local path: ${JSON.stringify(value)}`,
        );
      }
    }
    // The binary headers carry a case id and array names, and nothing else. Read
    // them as text anyway: a path can only leak from a place nobody looked.
    for (const c of manifest.cases) {
      const text = payloadOf(c.id).toString("latin1");
      compared += 1;
      assert.equal(truth.leaksLocalPath(text), false, `payload/${c.id}.bin carries a local path`);
    }
    assert.ok(compared > 200, `swept ${compared} strings, which is fewer than this manifest holds`);
  });

  test("no public string carries an internal identifier", () => {
    const raw = JSON.parse(readFileSync(join(ROOT, "src/data/banned-terms.json"), "utf-8"));
    const terms = Array.isArray(raw) ? raw : (raw.terms ?? Object.keys(raw));
    const sorted = [...new Set(terms)].filter(Boolean).sort((a, b) => b.length - a.length);
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![\\w-])(${sorted.map(escape).join("|")})(?![\\w-])`, "g");

    // The matcher has to be shown working, or a silently empty term list would
    // make this test pass on any input at all.
    assert.ok(sorted.length > 100, `the ban list holds ${sorted.length} terms`);
    assert.ok([...`a banned ${sorted[sorted.length - 1]} appears here`.matchAll(re)].length > 0, "the matcher does not match a term from its own list");

    let compared = 0;
    for (const file of [manifest, captionFile]) {
      for (const [path, value] of strings(file)) {
        compared += 1;
        const hits = [...value.matchAll(re)].map((m) => m[1]);
        assert.deepEqual(hits, [], `${path} carries ${hits.join(", ")}`);
      }
    }
    assert.ok(compared > 200, `swept ${compared} strings`);
  });
});

describe("payloads and the manifest describe each other", () => {
  test("every payload decodes, and its case id matches its filename", () => {
    let compared = 0;
    for (const c of manifest.cases) {
      const payload = scene.decodeScenePayload(payloadOf(c.id));
      assert.equal(payload.caseId, c.id);
      assert.equal(payload.formatVersion, scene.SCENE_PAYLOAD_FORMAT_VERSION);
      compared += 1;
    }
    assert.equal(compared, manifest.cases.length);
  });

  test("a payload with the wrong magic throws rather than rendering something else", () => {
    const bytes = Buffer.from(payloadOf(manifest.cases[0].id));
    bytes.write("XXXX", 0, "ascii");
    assert.throws(() => scene.decodeScenePayload(bytes), /magic/);
  });

  test("contentHash is the sha256 of the payload on disk", () => {
    let compared = 0;
    for (const c of manifest.cases) {
      const observed = createHash("sha256").update(payloadOf(c.id)).digest("hex");
      assert.equal(observed, c.contentHash, `case ${c.id} has a stale contentHash; a changed artifact would not invalidate a cached still`);
      compared += 1;
      assert.equal(digest.cases[c.id].contentHash, c.contentHash, `the build digest disagrees with the manifest about ${c.id}`);
    }
    assert.equal(compared, manifest.cases.length);
  });

  test("every encoding names an array the payload holds, and every array is drawn", () => {
    let encodings = 0;
    let arrays = 0;
    for (const c of manifest.cases) {
      const payload = scene.decodeScenePayload(payloadOf(c.id));
      const drawn = new Set();
      for (const e of c.encodings) {
        encodings += 1;
        assert.ok(
          payload.arrays.has(e.quantity),
          `case ${c.id} encoding ${e.visualProperty} names the quantity "${e.quantity}", which is not in its payload`,
        );
        drawn.add(e.quantity);
        assert.ok(scene.sceneEncodingFor(c, e.visualProperty), "the lookup helper cannot find a declared encoding");
      }
      for (const name of payload.arrays.keys()) {
        arrays += 1;
        if (name.startsWith("drawIndex.")) continue;
        assert.ok(drawn.has(name), `case ${c.id} ships the array "${name}" and no encoding names it`);
      }
    }
    assert.ok(encodings > 40, `compared ${encodings} encodings`);
    assert.ok(arrays > 40, `compared ${arrays} arrays`);
  });

  test("a declared downsample matches the selection index actually shipped", () => {
    let compared = 0;
    for (const c of manifest.cases) {
      const payload = scene.decodeScenePayload(payloadOf(c.id));
      for (const e of c.encodings) {
        if (!e.downsample) continue;
        compared += 1;
        const d = e.downsample;
        assert.ok(d.outputCount > 0 && d.outputCount <= d.inputCount, `case ${c.id}: ${d.inputCount} into ${d.outputCount}`);
        assert.equal(typeof d.seed, "number");
        assert.ok(d.method.includes("no randomness"), `case ${c.id}: the method does not say whether it is random`);
        const indices = [...payload.arrays.keys()].filter((n) => n.endsWith(".low"));
        assert.equal(indices.length, 1, `case ${c.id} declares a downsample and ships ${indices.length} low-tier selections`);
        const low = payload.i32(indices[0]);
        assert.equal(low[0], 0, "the first record is not kept");
        assert.ok(low[low.length - 1] > low[0], "the selection does not advance");
        // The selection indexes records of one kind and an encoding may count a
        // whole multiple of them, so the decimation ratio is what has to agree
        // rather than the length. The population the selection was drawn from is
        // its own last index plus one, because the last record is always kept.
        const population = low[low.length - 1] + 1;
        assert.ok(
          Math.abs(population / low.length - d.inputCount / d.outputCount) < 1e-9,
          `case ${c.id} encoding ${e.visualProperty}: the manifest declares ${d.inputCount} into ${d.outputCount} ` +
            `and the shipped selection takes ${low.length} of ${population}`,
        );
      }
    }
    assert.ok(compared > 10, `compared ${compared} downsample records`);
  });

  test("payload files and manifest cases are the same set", () => {
    const onDisk = readdirSync(join(SCENE_DIR, "payload")).filter((f) => f.endsWith(".bin")).map((f) => f.replace(/\.bin$/, "")).sort();
    assert.deepEqual(onDisk, manifest.cases.map((c) => c.id).sort(), "a payload with no case, or a case with no payload");
  });
});

describe("captions and geometry read the same record", () => {
  test("every case has a caption", () => {
    for (const c of manifest.cases) {
      const caption = captionFile.captions[c.id];
      assert.ok(caption, `case ${c.id} has no caption`);
      assert.ok(caption.text.length > 60, `case ${c.id}'s caption is ${caption.text.length} characters`);
    }
    assert.equal(Object.keys(captionFile.captions).length, manifest.cases.length);
  });

  test("no caption states a step count beside a figure that draws a different one", () => {
    // The public training run is described by two rows of the same frozen
    // ledger with different lengths. A figure that draws 401 points under a
    // caption reading "400 steps" is the quiet contradiction this whole
    // manifest exists to prevent, so the disagreement travels with the number.
    const caption = captionFile.captions["run-boundary-series"];
    const payload = scene.decodeScenePayload(payloadOf("run-boundary-series"));
    const drawn = payload.i32("steps").length;
    assert.equal(caption.values.drawnPoints, drawn, "the caption's point count is not the number of points shipped");
    assert.notEqual(caption.values.declaredStepCount, drawn, "the two records agree now; this test and the caveat need rewriting");
    assert.ok(caption.text.includes(String(drawn)), "the caption does not state how many points the figure draws");
    assert.ok(
      /does not assert which record is right/.test(caption.text),
      "the caption states both counts and does not say the site declines to choose between them",
    );
    const runCase = manifest.cases.find((c) => c.id === "run-boundary-series");
    assert.ok(/disagree/.test(runCase.caveat), "the caveat does not carry the disagreement");
  });

  test("caption numbers come from the arrays the geometry reads", () => {
    let compared = 0;
    const check = (caseId, key, actual) => {
      const value = captionFile.captions[caseId].values[key];
      assert.equal(value, actual, `${caseId}: the caption says ${key} is ${value} and the payload holds ${actual}`);
      compared += 1;
    };
    const selection = scene.decodeScenePayload(payloadOf("selection-advantages"));
    check("selection-advantages", "rolloutCount", selection.f32("advantage").length);
    check("selection-advantages", "zeroAdvantageCount", [...selection.f32("advantage")].filter((v) => v === 0).length);
    check("selection-advantages", "stepCount", new Set(selection.i32("step_index")).size);

    const update = scene.decodeScenePayload(payloadOf("update-step"));
    check("update-step", "stepCount", update.f32("grad_norm_clipped").length);

    const scorer = scene.decodeScenePayload(payloadOf("scorer-score-tree"));
    check("scorer-score-tree", "leafCount", scorer.i32("scores.leafCount")[0]);
    check("scorer-score-tree", "abstainedRolloutCount", [...scorer.i32("scores.leaf.abstained")].filter(Boolean).length);
    check("scorer-score-tree", "scoredRolloutCount", [...scorer.f32("scores.leaf.value")].filter(Number.isFinite).length);

    const run = scene.decodeScenePayload(payloadOf("run-boundary-series"));
    check("run-boundary-series", "transitionMidpoint", run.f32("transition.midpoint")[0]);
    check("run-boundary-series", "drawnPoints", run.f32("series.written").length);

    assert.ok(compared >= 9, `compared ${compared} caption numbers against the payload`);
  });

  test("the schematic case carries no numbers at all", () => {
    const schematic = manifest.cases.filter((c) => c.truthMode === "schematic");
    assert.ok(schematic.length > 0, "no state is schematic; the response state has no artifact and must be");
    for (const c of schematic) {
      assert.equal(c.encodings.length, 0);
      const payload = scene.decodeScenePayload(payloadOf(c.id));
      assert.equal(payload.arrays.size, 0, `schematic case ${c.id} ships ${payload.arrays.size} arrays of numbers`);
    }
  });
});

describe("the build digest", () => {
  test("records a hash for every source and every case", () => {
    for (const key of ["run-series", "grader-cards", "intervention"]) {
      assert.match(digest.sources[key].sha256, /^[0-9a-f]{64}$/);
      const observed = createHash("sha256").update(readFileSync(join(ROOT, digest.sources[key].path))).digest("hex");
      assert.equal(observed, digest.sources[key].sha256, `${digest.sources[key].path} has changed since the scene data was generated`);
    }
    assert.match(digest.runRecord.sha256, /^[0-9a-f]{64}$/);
    assert.match(digest.manifestDigest, /^[0-9a-f]{64}$/);
    const contract = createHash("sha256").update(readFileSync(join(ROOT, digest.truthContract.path))).digest("hex");
    assert.equal(contract, digest.truthContract.sha256, "the truth contract has changed since the scene data was generated");
    assert.equal(Object.keys(digest.cases).length, manifest.cases.length);
  });
});
