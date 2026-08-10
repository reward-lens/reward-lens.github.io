#!/usr/bin/env node
/**
 * The scene's truth manifest, generated from the artifacts themselves.
 *
 *   node scripts/build_scene_data.mjs          # generate
 *   node scripts/build_scene_data.mjs --check  # regenerate and compare, write nothing
 *
 * WHAT THIS FILE IS FOR. Every number the optical room draws arrives through
 * here, with the artifact it came from, the arithmetic that turned it into a
 * length, and the sentence printed beside it. A caption and its geometry read
 * the same array in the same file, so the two cannot drift apart without this
 * script noticing. `design/scene/EVIDENCE-VERDICTS.md` is the binding ruling on
 * which artifacts are allowed to become geometry at all; this is its executable
 * half.
 *
 * THE RULE THAT DOES THE WORK. A case is either `schematic`, which asserts
 * nothing and may carry no quantitative encoding, or it is measured against a
 * named artifact that exists on disk. There is no third state and there is no
 * fallback: if a required source is missing, generation stops. A scene showing
 * invented numbers on a site whose argument is provenance would be the worst
 * defect this build could ship, so the failure is loud and the build does not
 * continue past it.
 *
 * `violatesTruthMode()` and `leaksLocalPath()` are not reimplemented here. The
 * frozen contract at src/components/scene/types/truth.ts is compiled and
 * imported, and both functions are probed against known-bad input on every run
 * before any case is checked (see `loadTruthContract`). A gate that passes
 * because it compared nothing is the failure mode this build is organised
 * against, so this one proves it can fail every time it runs.
 *
 * OUTPUT
 *   src/data/scene/manifest.json       the typed manifest, one entry per case
 *   src/data/scene/captions.json       generated prose, one entry per case
 *   src/data/scene/build-digest.json   source hashes and the reproducibility digest
 *   src/data/scene/payload/<id>.bin    the versioned binary payload for that case
 *
 * ENVIRONMENT
 *   SCENE_DATA_ASSAY_ROOT   where the sibling instrument checkout lives.
 *                           Defaults to a search upward from this repository.
 *   SCENE_DATA_SITE_DATA    where the site's generated JSON lives.
 *                           Defaults to <site>/src/data.
 *   SOURCE_DATE_EPOCH       fixes `generatedAt`, for a byte-identical rebuild.
 *   SCENE_DATA_INJECT       a deliberate corruption, so a gate can be shown
 *                           failing. Never set in a normal build. One of:
 *                           schematic-encoding | local-path | banned-term |
 *                           undeclared-array | broken-truth-gate
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, "..");

/** Bumped when the payload layout changes, so a stale still is detectable. */
const MANIFEST_VERSION = 1;
/** The binary container's own version, independent of the manifest's. */
const PAYLOAD_FORMAT_VERSION = 1;
const PAYLOAD_MAGIC = "RLS1";

/** The five states, in scroll order. Checked against the frozen contract. */
const STATES = ["scorer", "selection", "update", "response", "run-boundary"];

// ---------------------------------------------------------------------------
// Failure
// ---------------------------------------------------------------------------

/**
 * Every refusal in this file is one of these. It carries the reason a reader
 * can act on rather than a stack trace: which artifact, where it was looked
 * for, and what the alternative would have been.
 */
class SceneDataError extends Error {
  constructor(message) {
    super(message);
    this.name = "SceneDataError";
  }
}

const fail = (message) => {
  throw new SceneDataError(message);
};

/**
 * A source that must exist. There is deliberately no `orElse`.
 *
 * The whole point of the manifest is that a case in a measured mode is backed
 * by a file. Returning demo data here, or an empty array, or the last good
 * value, would produce a scene that looks identical and means nothing.
 */
function requireSource(path, description, remedy) {
  if (!existsSync(path)) {
    fail(
      `missing required source: ${description}\n` +
        `  looked for: ${path}\n` +
        `  ${remedy}\n` +
        `  This case is generated in a measured mode and there is no synthetic fallback. ` +
        `Generation stops here rather than drawing geometry with nothing behind it.`,
    );
  }
  return path;
}

// ---------------------------------------------------------------------------
// Where the artifacts live
// ---------------------------------------------------------------------------

/**
 * The sibling instrument checkout, found by walking up rather than typed in.
 *
 * A hard-coded home directory in a generator is how five of this site's data
 * files came to carry an absolute local path in their output. The search runs
 * from this repository upward, so it resolves identically from the main
 * checkout and from a worktree several levels below it.
 */
function findInstrumentRoot() {
  const override = process.env.SCENE_DATA_ASSAY_ROOT;
  if (override) return resolve(override);
  let dir = SITE;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, "reward-lens-assay");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  fail(
    `could not locate the sibling instrument checkout (a directory named reward-lens-assay)\n` +
      `  searched upward from: ${SITE}\n` +
      `  Set SCENE_DATA_ASSAY_ROOT to its path. The 200-step run record lives inside it and ` +
      `three of the ten cases are measured against that record.`,
  );
}

/**
 * Repository-relative citation for a path inside the instrument checkout.
 *
 * `run-series.json` and `EVIDENCE-VERDICTS.md` both cite these as
 * `reward-lens-assay/...`, while `grader-cards.json` prefixes the enclosing
 * directory as well. The shorter form is used here because it is the one the
 * ruling itself uses, and because the longer one names a directory that exists
 * on one machine.
 */
function citeInstrument(instrumentRoot, absolutePath) {
  const rel = absolutePath.slice(instrumentRoot.length).replace(/^[/\\]/, "");
  return `reward-lens-assay/${rel.split("\\").join("/")}`;
}

// ---------------------------------------------------------------------------
// The frozen truth contract, compiled and probed
// ---------------------------------------------------------------------------

/**
 * Compile src/components/scene/types/truth.ts and import what it exports.
 *
 * The alternative was to restate `violatesTruthMode` here in JavaScript, and
 * two copies of a rule is one copy of a rule plus a place for them to disagree.
 * The contract file is frozen and this script is its only executable reader.
 */
async function loadTruthContract() {
  const file = requireSource(
    join(SITE, "src/components/scene/types/truth.ts"),
    "the frozen scene truth contract",
    "It is checked in at src/components/scene/types/truth.ts and is not generated.",
  );
  let ts;
  try {
    ts = (await import("typescript")).default;
  } catch {
    fail(
      `the TypeScript compiler is not resolvable from ${SITE}\n` +
        `  It is a devDependency of this package and this script compiles the frozen ` +
        `truth contract with it rather than restating the rule in JavaScript.\n` +
        `  Run npm install.`,
    );
  }
  const source = readFileSync(file, "utf-8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const url = `data:text/javascript;base64,${Buffer.from(compiled, "utf-8").toString("base64")}`;
  const mod = await import(url);

  for (const name of ["violatesTruthMode", "leaksLocalPath", "INSTRUMENT_STATES"]) {
    if (!(name in mod)) {
      fail(
        `the truth contract compiled but does not export ${name}\n` +
          `  src/components/scene/types/truth.ts has changed shape. This script enforces ` +
          `that file's rules and cannot proceed without them.`,
      );
    }
  }
  if (
    mod.INSTRUMENT_STATES.length !== STATES.length ||
    mod.INSTRUMENT_STATES.some((s, i) => s !== STATES[i])
  ) {
    fail(
      `the contract's state list is ${JSON.stringify(mod.INSTRUMENT_STATES)} and this ` +
        `generator was written against ${JSON.stringify(STATES)}. A state was added or ` +
        `renamed; the case inventory has to answer for it before the build continues.`,
    );
  }
  return mod;
}

/** A well-formed case, used only to prove the gate answers `null` on a good one. */
const PROBE_GOOD = {
  id: "probe-good",
  state: "selection",
  plateKind: "PROBE",
  publicLabel: "probe",
  truthMode: "measured",
  subject: "probe",
  source: { repositoryPath: "src/data/probe.json" },
  scope: "probe",
  caveat: "probe",
  encodings: [
    {
      visualProperty: "Probe.length",
      quantity: "probe",
      transform: "probe",
      unit: null,
      domain: null,
      clamp: false,
    },
  ],
  contentHash: "0".repeat(64),
};

/**
 * Prove the gate can fail, on every run, before it is trusted with real cases.
 *
 * Gate 4 in this repository once reported "0 values compared" and exited zero,
 * because its keys did not match the thing it was comparing. It passed for a
 * reason unrelated to the property it claimed to check. These probes are the
 * answer to that: known-bad input goes in and a refusal has to come out, or
 * this script stops before it writes anything.
 */
function probeTruthGate(truth, injectBrokenGate) {
  const gate = injectBrokenGate ? () => null : truth.violatesTruthMode;
  const results = [];

  const mustFail = (label, subject) => {
    const verdict = gate(subject);
    if (!verdict) {
      fail(
        `the truth gate did not refuse a case it must refuse: ${label}\n` +
          `  violatesTruthMode() returned null for input the contract forbids. The gate is ` +
          `not capable of failing, so nothing it passes means anything. Generation stops.`,
      );
    }
    results.push(`${label}: refused`);
  };

  mustFail("a schematic case carrying a quantitative encoding", {
    ...PROBE_GOOD,
    id: "probe-schematic-with-encoding",
    state: "response",
    truthMode: "schematic",
  });
  mustFail("a measured case declaring no encoding", {
    ...PROBE_GOOD,
    id: "probe-measured-no-encoding",
    encodings: [],
  });
  mustFail("a measured case naming no source", {
    ...PROBE_GOOD,
    id: "probe-measured-no-source",
    source: {},
  });

  const good = gate(PROBE_GOOD);
  if (good !== null) {
    fail(
      `the truth gate refused a well-formed case: ${good}\n` +
        `  A gate that refuses everything is as useless as one that refuses nothing.`,
    );
  }
  results.push("a well-formed measured case: accepted");

  for (const leak of ["/home/someone/checkout/x.json", "/Users/someone/x.json", "file:///tmp/x", ".claude/worktrees/a/b"]) {
    if (!truth.leaksLocalPath(leak)) {
      fail(`leaksLocalPath() did not flag ${JSON.stringify(leak)}. The path gate cannot fail.`);
    }
  }
  for (const clean of ["src/data/run-series.json", "reward-lens-assay/PREDICTIONS.md", "https://reward-lens.github.io/"]) {
    if (truth.leaksLocalPath(clean)) {
      fail(`leaksLocalPath() flagged ${JSON.stringify(clean)}, which is repository-relative.`);
    }
  }
  results.push("path gate: 4 leaks flagged, 3 repository-relative paths passed");
  return results;
}

// ---------------------------------------------------------------------------
// The binary payload
// ---------------------------------------------------------------------------

const DTYPE_BYTES = { f32: 4, i32: 4 };
const ALIGNMENT = 8;
const align = (n) => n + ((ALIGNMENT - (n % ALIGNMENT)) % ALIGNMENT);

/**
 * One case's arrays, in one self-describing little-endian file.
 *
 *   0..3    magic "RLS1"
 *   4..7    uint32  payload format version
 *   8..11   uint32  header length in bytes
 *   12..    header JSON, then zero padding to an 8-byte boundary
 *   then    the arrays, in header order, each starting on an 8-byte boundary
 *
 * The header names every array, its element type and its length, so a reader
 * never needs a table of offsets compiled into it. That is the difference from
 * the layout the old scene design specified: that one hard-coded six bands and
 * four hundred steps into the format itself, and the truthful data does not
 * have that shape.
 *
 * No timestamp, no path and no machine detail goes into the file, which is why
 * two runs over unchanged sources produce identical bytes.
 */
function encodePayload(caseId, arrays) {
  const descriptors = [];
  let cursor = 0;
  for (const a of arrays) {
    if (!(a.dtype in DTYPE_BYTES)) fail(`unknown dtype ${a.dtype} on array ${a.name}`);
    const byteLength = a.values.length * DTYPE_BYTES[a.dtype];
    descriptors.push({
      name: a.name,
      dtype: a.dtype,
      length: a.values.length,
      byteOffset: cursor,
      byteLength,
    });
    cursor = align(cursor + byteLength);
  }
  const header = JSON.stringify({ caseId, arrays: descriptors });
  const headerBytes = Buffer.from(header, "utf-8");
  const dataStart = align(12 + headerBytes.length);
  const total = dataStart + cursor;

  const buffer = Buffer.alloc(total);
  buffer.write(PAYLOAD_MAGIC, 0, "ascii");
  buffer.writeUInt32LE(PAYLOAD_FORMAT_VERSION, 4);
  buffer.writeUInt32LE(headerBytes.length, 8);
  headerBytes.copy(buffer, 12);

  for (let i = 0; i < arrays.length; i += 1) {
    const { dtype, values } = arrays[i];
    const at = dataStart + descriptors[i].byteOffset;
    for (let j = 0; j < values.length; j += 1) {
      if (dtype === "f32") buffer.writeFloatLE(Math.fround(values[j]), at + j * 4);
      else buffer.writeInt32LE(values[j] | 0, at + j * 4);
    }
  }
  return buffer;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// ---------------------------------------------------------------------------
// Small helpers used by the adapters
// ---------------------------------------------------------------------------

const readJson = (path) => JSON.parse(readFileSync(path, "utf-8"));

const readJsonl = (path) =>
  readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));

/** Thousands separators without depending on the host's locale data. */
function group(n) {
  const [whole, frac] = String(n).split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const parts = [];
  for (let i = digits.length; i > 0; i -= 3) parts.unshift(digits.slice(Math.max(0, i - 3), i));
  return sign + parts.join(",") + (frac ? `.${frac}` : "");
}

/** The recorded extent of a set of values, as the domain an encoding assumes. */
function extent(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  return [round6(lo), round6(hi)];
}

/** Six places, so a domain in the manifest reads as a number rather than as float noise. */
const round6 = (v) => Number(v.toFixed(6));

/** An artifact's own field key, turned into something a caption can say aloud. */
const humanKey = (key) => key.replace(/_/g, " ");

/**
 * Deterministic decimation: uniform stride with the first and last record kept.
 *
 * There is no seed here and the `seed` recorded in the manifest is zero, which
 * the method string says in full. A random subsample of an ordered series is
 * the wrong instrument: it produces irregular spacing, which reads as noise the
 * run does not have, and on 401 points it would change the apparent shape of a
 * transition. Stride is reproducible by inspection, which is the property the
 * downsample record is actually for.
 */
function stride(count, target) {
  if (target >= count) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (target - 1);
  const out = [];
  for (let i = 0; i < target; i += 1) out.push(Math.round(i * step));
  out[out.length - 1] = count - 1;
  return [...new Set(out)];
}

/**
 * The tier ladder, written once.
 *
 * `runtime/tier.ts` caps a low-tier session at 101 timeline points and a
 * high-tier one at 401, which is exactly the recorded series at strides of four
 * and one. The counts below are read from that file's own profile table rather
 * than chosen here.
 */
function downsampleRecord(inputCount, ladder, unit) {
  const parts = ladder.map(([tier, n]) => `${tier} ${group(n)}`);
  return {
    method:
      `uniform stride over the recorded ${unit}, first and last kept, no randomness; ` +
      `the seed below is zero and unused, and is recorded only because the contract has ` +
      `a field for it. Drawn ${unit} by tier: ${parts.join(", ")}. The counts below are ` +
      `the most reduced tier.`,
    seed: 0,
    inputCount,
    outputCount: ladder[ladder.length - 1][1],
  };
}

// ---------------------------------------------------------------------------
// Adapter: the 200-step run record
// ---------------------------------------------------------------------------

/**
 * The recorded GRPO run, read from its two shards.
 *
 * Everything this returns is a stored column. The negatives are asserted rather
 * than assumed, because three of the captions below state them as fact: if a
 * future record does carry per-token advantage, the prose beside the geometry
 * would be wrong, and the build should stop rather than print it.
 */
function readRunRecord(instrumentRoot) {
  const runDir = requireSource(
    join(
      instrumentRoot,
      "tests/fixtures/grpo_run/long/runs/run_f77bf75940ab982bbc35407af99cc094",
    ),
    "the 200-step run record",
    "It is a checked-in fixture of the instrument repository, in two shards of 100 steps.",
  );
  const manifest = readJson(requireSource(join(runDir, "manifest.json"), "the run record's manifest", "It sits beside the shards."));
  const run = readJson(requireSource(join(runDir, "run.json"), "the run's component record", "It sits beside the shards."));

  const partitions = manifest.partitions.map((p) => p.name);
  const table = (name) =>
    partitions.flatMap((p) =>
      readJsonl(
        requireSource(
          join(runDir, "steps", p, `${name}.jsonl`),
          `the run record's ${name} table for shard ${p}`,
          "Both shards are required; a half-read record would draw half a run.",
        ),
      ),
    );

  const steps = table("steps");
  const groups = table("groups");
  const trajectories = table("trajectories");
  const turns = table("turns");

  const expected = manifest.counts;
  const seen = {
    steps: steps.length,
    groups: groups.length,
    trajectories: trajectories.length,
    turns: turns.length,
  };
  for (const key of Object.keys(expected)) {
    if (expected[key] !== seen[key]) {
      fail(
        `the run record's manifest declares ${expected[key]} ${key} and the shards hold ${seen[key]}.\n` +
          `  A partially read record produces a scene that is missing a run it claims to draw.`,
      );
    }
  }

  // The stored payload column, parsed once per row.
  const stepPayload = steps.map((s) => JSON.parse(s.payload));
  const groupPayload = groups.map((g) => JSON.parse(g.payload));
  const trajPayload = trajectories.map((t) => JSON.parse(t.payload));

  // The negatives the captions state. Each is a claim about this record, so
  // each is checked against this record.
  const assertNegative = (condition, message) => {
    if (!condition) {
      fail(
        `${message}\n` +
          `  A caption in this manifest states this as a fact about the record. The record no ` +
          `longer supports it, so the sentence and the geometry beside it have to be revisited ` +
          `before either ships.`,
      );
    }
  };
  assertNegative(
    trajectories.every((t) => typeof t.advantage === "number"),
    "some rollouts carry no advantage; the selection state is built on the advantage column being complete.",
  );
  assertNegative(
    trajPayload.every((p) => p.advantage_tokens === null),
    "some rollouts now carry a per-token advantage. The captions say no per-position quantity exists in this record.",
  );
  assertNegative(
    trajectories.every((t) => t.n_tokens === 0),
    "some rollouts now carry a token count. The captions say the recorded token count is zero throughout.",
  );
  assertNegative(
    turns.every((t) => t.step_score === null && t.step_advantage === null),
    "some turns now carry a per-turn score or advantage. The captions say the turn table holds neither.",
  );
  assertNegative(
    trajectories.every((t) => t.n_turns === 2),
    "the trajectories are no longer two turns long. The immediate-credit scope depends on it.",
  );

  const leafNames = new Set(trajPayload.map((p) => p.scores?.fields?.name));
  if (leafNames.size !== 1) {
    fail(
      `the score tree now has ${leafNames.size} distinct leaves (${[...leafNames].join(", ")}).\n` +
        `  The scorer case says this run has exactly one, and draws one band for that reason.`,
    );
  }

  const graderName = run.components?.GRADER?.name ?? null;
  if (!graderName) fail("the run record names no grader component; the scorer case cites it by name.");

  return {
    runDir,
    manifest,
    graderName,
    estimator: run.components?.ESTIMATOR?.name ?? null,
    lossType: run.lineage?.extra?.config?.loss_type ?? null,
    numGenerations: run.lineage?.extra?.config?.num_generations ?? null,
    steps,
    stepPayload,
    groups,
    groupPayload,
    trajectories,
    trajPayload,
    turnCount: turns.length,
    leafName: [...leafNames][0],
  };
}

// ---------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------

/**
 * Human names for the audited graders.
 *
 * The cards carry entrypoint names, which are accurate and unreadable on a
 * source plate. The map is asserted against the cards' own key set below, so a
 * fifth card fails the build instead of arriving on the plate as `verl_gsm8k`.
 */
const GRADER_NAMES = {
  is_equiv: "MATH equivalence checker",
  swebench: "SWE-bench test-report grader",
  verl_gsm8k: "GSM8K answer grader",
  verl_search_r1: "Open-domain QA exact-match grader",
};

function scorerScoreTreeCase(record, instrumentRoot) {
  const { trajectories, trajPayload, stepPayload, steps } = record;
  const leafValue = trajPayload.map((p) => {
    const v = p.scores.fields.value;
    return v === null || v === undefined ? Number.NaN : v;
  });
  const abstained = trajPayload.map((p) => (p.scores.fields.abstained ? 1 : 0));
  const leafMean = stepPayload.map((p) => p.optimizer.extra[`rewards/${record.leafName}/mean`]);
  const leafStd = stepPayload.map((p) => p.optimizer.extra[`rewards/${record.leafName}/std`]);
  if (leafMean.some((v) => typeof v !== "number") || leafStd.some((v) => typeof v !== "number")) {
    fail(`the run record no longer logs rewards/${record.leafName}/mean and /std on every step.`);
  }

  const stepCount = steps.length;
  const trajCount = trajectories.length;
  const abstainedCount = abstained.reduce((a, b) => a + b, 0);
  const scored = leafValue.filter((v) => Number.isFinite(v));
  const stepLadder = [["high", stepCount], ["mid", Math.ceil(stepCount / 2)], ["low", Math.ceil(stepCount / 4)]];
  const rolloutLadder = stepLadder.map(([t, n]) => [t, n * (trajCount / stepCount)]);

  const arrays = [
    { name: "scores.leafCount", dtype: "i32", values: [1] },
    { name: "scores.leaf.value", dtype: "f32", values: leafValue },
    { name: "scores.leaf.abstained", dtype: "i32", values: abstained },
    { name: `rewards/${record.leafName}/mean`, dtype: "f32", values: leafMean },
    { name: `rewards/${record.leafName}/std`, dtype: "f32", values: leafStd },
    { name: "drawIndex.step.mid", dtype: "i32", values: stride(stepCount, stepLadder[1][1]) },
    { name: "drawIndex.step.low", dtype: "i32", values: stride(stepCount, stepLadder[2][1]) },
  ];

  const encodings = [
    {
      visualProperty: "ScoreBand.count",
      quantity: "scores.leafCount",
      transform:
        "one spectral band per leaf of the score tree. The tree on this run has one leaf, so the count is one and the spectrum is one band wide.",
      unit: null,
      domain: [1, 1],
      clamp: false,
    },
    {
      visualProperty: "ScoreBand.axialOffset",
      quantity: `rewards/${record.leafName}/mean`,
      transform:
        "the band's displacement along the detector face is a linear map from the recorded per-step mean of the leaf onto the face's height, using the domain below as the endpoints. No offset is applied and no value is clamped.",
      unit: "reward",
      domain: extent(leafMean),
      clamp: false,
      downsample: downsampleRecord(stepCount, stepLadder, "steps"),
    },
    {
      visualProperty: "ScoreBand.angularWidth",
      quantity: `rewards/${record.leafName}/std`,
      transform:
        "the band's angular width is a linear map from the recorded per-step standard deviation of the leaf across the 8 rollouts of that step, with zero mapping to zero width. Width is a spread and never a magnitude.",
      unit: "reward",
      domain: extent(leafStd),
      clamp: false,
      downsample: downsampleRecord(stepCount, stepLadder, "steps"),
    },
    {
      visualProperty: "ScorePoint.radialPosition",
      quantity: "scores.leaf.value",
      transform:
        "one point per rollout, placed along the band by a linear map from the leaf's recorded value onto the band's length using the domain below. A rollout whose leaf is absent carries a non-finite value and is not placed.",
      unit: "reward",
      domain: extent(leafValue),
      clamp: false,
      downsample: downsampleRecord(trajCount, rolloutLadder, "rollouts"),
    },
    {
      visualProperty: "ScorePoint.absent",
      quantity: "scores.leaf.abstained",
      transform:
        "one where the grader abstained on that rollout and the leaf carries no value, zero otherwise. An absent point is drawn as a gap in the band rather than as a value at zero.",
      unit: null,
      domain: [0, 1],
      clamp: false,
      downsample: downsampleRecord(trajCount, rolloutLadder, "rollouts"),
    },
  ];

  const caption = {
    text:
      `The score tree on this run has one leaf, named ${record.leafName}. ` +
      `${group(scored.length)} of ${group(trajCount)} rollouts carry a value between ${round6(Math.min(...scored))} and ${round6(Math.max(...scored))}; ` +
      `on the other ${group(abstainedCount)} the grader abstained and the leaf holds nothing. ` +
      `One leaf is not a decomposition, and the spectrum here has one band for that reason.`,
    values: {
      leafCount: 1,
      leafName: record.leafName,
      rolloutCount: trajCount,
      scoredRolloutCount: scored.length,
      abstainedRolloutCount: abstainedCount,
      leafValueMin: round6(Math.min(...scored)),
      leafValueMax: round6(Math.max(...scored)),
    },
  };

  return {
    arrays,
    caption,
    case: {
      id: "scorer-score-tree",
      state: "scorer",
      plateKind: "RECORDED SCORE TREE",
      publicLabel: `Reference GRPO run, one grader leaf, ${group(trajCount)} rollouts`,
      truthMode: "measured",
      subject:
        `A ${group(record.steps.length)}-step GRPO run on a tiny test policy, scored by a single length reward function and recorded turn by turn.`,
      source: {
        repositoryPath: citeInstrument(instrumentRoot, record.runDir),
        artifact: "the run record's step, group and trajectory tables, in two shards of 100 steps",
      },
      scope:
        `${group(record.steps.length)} recorded steps, 2 groups of 4 rollouts each, ${group(trajCount)} rollouts in total. ` +
        `One grader, called once for the whole batch. Immediate update credit only: the trajectories are two turns long and the record holds no tool call.`,
      caveat:
        `This run's score tree has exactly one leaf, so the spectrum here shows what a decomposition looks like when there is nothing to decompose. ` +
        `It establishes nothing about how a reward built from several components divides between them. ` +
        `On ${group(abstainedCount)} of the ${group(trajCount)} rollouts the grader abstained, and an abstention is an absent value rather than a low score.`,
      encodings,
    },
  };
}

function verifierCases(cards, siteDataDir) {
  const keys = cards.cards.map((c) => c.key);
  const named = Object.keys(GRADER_NAMES);
  if (keys.length !== named.length || keys.some((k) => !(k in GRADER_NAMES))) {
    fail(
      `the verifier audit holds ${keys.length} cards (${keys.join(", ")}) and this generator has ` +
        `human names for ${named.join(", ")}.\n` +
        `  A card with no name would reach the source plate as its entrypoint identifier. Name it ` +
        `in GRADER_NAMES rather than letting the plate print a function name.`,
    );
  }

  return cards.cards.map((card) => {
    const full = card.access.full;
    const logOnly = card.access.log_only;
    const hasMetamorphic = card.metamorphicApplicablePairs > 0;
    const slug = card.key.replace(/_/g, "-");

    const arrays = [
      { name: "competentMutants", dtype: "i32", values: [card.competentMutants] },
      { name: "killedMutants", dtype: "i32", values: [card.killedMutants] },
      { name: "access.full.readCount", dtype: "i32", values: [full.readCount] },
      { name: "access.full.refusedCount", dtype: "i32", values: [full.refusedCount] },
      { name: "access.log_only.readCount", dtype: "i32", values: [logOnly.readCount] },
      { name: "access.log_only.refusedCount", dtype: "i32", values: [logOnly.refusedCount] },
    ];
    const encodings = [
      {
        visualProperty: "MutantRow.tickCount",
        quantity: "competentMutants",
        transform:
          "one tick along the detector face per competent mutant. A mutant is competent when it changed the grader's behaviour on at least one input, so the row's length is the population that could have been caught.",
        unit: null,
        domain: [0, card.competentMutants],
        clamp: false,
      },
      {
        visualProperty: "MutantRow.litTickCount",
        quantity: "killedMutants",
        transform:
          "the first killedMutants ticks of the row are lit and the rest stay dark. Ticks are not reordered, so an empty row reads as an empty row rather than as a short one.",
        unit: null,
        domain: [0, card.competentMutants],
        clamp: false,
      },
      {
        visualProperty: "AccessGateFull.readCount",
        quantity: "access.full.readCount",
        transform:
          "the number of card fields that returned a reading with full access to the grader, drawn as that many filled cells in the upper gate.",
        unit: null,
        domain: [0, full.readCount + full.refusedCount],
        clamp: false,
      },
      {
        visualProperty: "AccessGateFull.refusedCount",
        quantity: "access.full.refusedCount",
        transform:
          "the number of card fields that refused with full access, drawn as that many struck cells in the upper gate. A refusal is drawn, never omitted.",
        unit: null,
        domain: [0, full.readCount + full.refusedCount],
        clamp: false,
      },
      {
        visualProperty: "AccessGateLogOnly.readCount",
        quantity: "access.log_only.readCount",
        transform:
          "the same count for a reader who has only the training log, drawn as filled cells in the lower gate.",
        unit: null,
        domain: [0, logOnly.readCount + logOnly.refusedCount],
        clamp: false,
      },
      {
        visualProperty: "AccessGateLogOnly.refusedCount",
        quantity: "access.log_only.refusedCount",
        transform:
          "the same refusal count for a log-only reader, drawn as struck cells in the lower gate. The difference between the two gates is the point of the pair.",
        unit: null,
        domain: [0, logOnly.readCount + logOnly.refusedCount],
        clamp: false,
      },
    ];

    if (hasMetamorphic) {
      arrays.push(
        { name: "metamorphicViolations", dtype: "i32", values: [card.metamorphicViolations] },
        { name: "metamorphicApplicablePairs", dtype: "i32", values: [card.metamorphicApplicablePairs] },
      );
      encodings.push(
        {
          visualProperty: "MetamorphicBar.violationCount",
          quantity: "metamorphicViolations",
          transform:
            "the filled length of a bar whose full length is metamorphicApplicablePairs. Both numbers are drawn, so the bar cannot be read as a rate without its denominator.",
          unit: null,
          domain: [0, card.metamorphicApplicablePairs],
          clamp: false,
        },
        {
          visualProperty: "MetamorphicBar.pairCount",
          quantity: "metamorphicApplicablePairs",
          transform:
            "the full length of the bar, in applicable pairs. This card's own denominator; no other count of pairs is used with these violations.",
          unit: null,
          domain: [0, card.metamorphicApplicablePairs],
          clamp: false,
        },
      );
    }

    const killPhrase =
      card.killedMutants === 0
        ? `Zero of ${card.competentMutants} is an absence of detection on this one subject. It is not a population estimate and it is not a general defect rate for verifiers.`
        : `${card.killedMutants} of ${card.competentMutants} is a reading on this one subject and this one corpus. It is not a population estimate.`;

    const metamorphicPhrase = hasMetamorphic
      ? ` Metamorphic violations are counted against this card's own denominator of ${group(card.metamorphicApplicablePairs)} applicable pairs; a differently defined count of the same name exists elsewhere and is not mixed with this one.`
      : ` No metamorphic relation applied to this subject, so no violation bar is drawn.`;

    return {
      arrays,
      caption: {
        text:
          `${GRADER_NAMES[card.key]}: ${group(card.killedMutants)} of ${group(card.competentMutants)} competent mutants killed over ${group(card.graderCalls)} grader calls on ${card.subject.corpus}. ` +
          `A reader with full access to this grader gets ${full.readCount} of its ${full.readCount + full.refusedCount} card fields; a reader with only the training log gets ${logOnly.readCount}.`,
        values: {
          killedMutants: card.killedMutants,
          competentMutants: card.competentMutants,
          graderCalls: card.graderCalls,
          fullRead: full.readCount,
          fullFields: full.readCount + full.refusedCount,
          logOnlyRead: logOnly.readCount,
          ...(hasMetamorphic
            ? {
                metamorphicViolations: card.metamorphicViolations,
                metamorphicApplicablePairs: card.metamorphicApplicablePairs,
              }
            : {}),
        },
      },
      case: {
        id: `scorer-verifier-${slug}`,
        state: "scorer",
        plateKind: "VERIFIER AUDIT",
        publicLabel: `${GRADER_NAMES[card.key]}, ${card.subject.corpus}, ${card.competentMutants} mutations`,
        truthMode: "measured",
        subject: `${card.subject.name}, entry point ${card.subject.entrypoint}, ${card.sourceLines} source lines`,
        source: {
          repositoryPath: "src/data/grader-cards.json",
          artifact: `the audit card for ${card.key}, with its full-access and log-only readings`,
        },
        scope: `${card.competentMutants} competent mutants over ${group(card.graderCalls)} grader calls on ${card.subject.corpus}. The card is read twice, once with full access to the grader and once with only the training log.`,
        caveat: `${killPhrase}${metamorphicPhrase}`,
        encodings,
      },
    };
  });
}

function attributionCase(intervention) {
  const dims = intervention.dimensions;
  const componentCount = dims[0].components.length;
  if (dims.some((d) => d.components.length !== componentCount)) {
    fail("the intervention fixture's dimensions no longer carry the same component count; the ladder assumes a rectangle.");
  }

  const flat = dims.flatMap((d) => d.components);
  const arrays = [
    { name: "spearmanRho", dtype: "f32", values: dims.map((d) => d.spearmanRho) },
    { name: "pairCount", dtype: "i32", values: dims.map((d) => d.pairCount) },
    { name: "attributionRank", dtype: "i32", values: flat.map((c) => c.attributionRank) },
    { name: "patchRank", dtype: "i32", values: flat.map((c) => c.patchRank) },
    { name: "attributionValue", dtype: "f32", values: flat.map((c) => c.attributionValue) },
    { name: "patchFractionOfMargin", dtype: "f32", values: flat.map((c) => c.patchFractionOfMargin) },
    { name: "nullThreshold", dtype: "f32", values: [intervention.nullThreshold.value] },
  ];
  const ladder = [
    ["high", flat.length],
    ["mid", dims.length * Math.ceil(componentCount / 2)],
    ["low", dims.length * Math.ceil(componentCount / 4)],
  ];
  arrays.push(
    { name: "drawIndex.component.mid", dtype: "i32", values: stride(componentCount, Math.ceil(componentCount / 2)) },
    { name: "drawIndex.component.low", dtype: "i32", values: stride(componentCount, Math.ceil(componentCount / 4)) },
  );

  const down = downsampleRecord(flat.length, ladder, "components");
  const rhoMean = intervention.headline.meanRho;
  const largest = flat.reduce((a, b) => (Math.abs(b.patchFractionOfMargin) > Math.abs(a.patchFractionOfMargin) ? b : a));

  const encodings = [
    {
      visualProperty: "RankLadder.attributionPosition",
      quantity: "attributionRank",
      transform:
        `the component's position on the left rail, as rank 1 at the top through rank ${componentCount} at the bottom, evenly spaced. Ranks are drawn as ranks; the underlying magnitudes drive opacity instead.`,
      unit: null,
      domain: [1, componentCount],
      clamp: false,
      downsample: down,
    },
    {
      visualProperty: "RankLadder.patchPosition",
      quantity: "patchRank",
      transform:
        `the same component's position on the right rail, from the patching localizer's own ranking, on the same scale. The link between the two rails is the disagreement.`,
      unit: null,
      domain: [1, componentCount],
      clamp: false,
      downsample: down,
    },
    {
      visualProperty: "RankLink.opacity",
      quantity: "attributionValue",
      transform:
        "the link's opacity is the component's attribution magnitude divided by the largest magnitude in the same dimension, so opacity is a within-dimension share and never a cross-model comparison.",
      unit: null,
      domain: extent(flat.map((c) => c.attributionValue)),
      clamp: false,
      downsample: down,
    },
    {
      visualProperty: "RankLink.width",
      quantity: "patchFractionOfMargin",
      transform:
        `the link's width is a linear map from the patching effect expressed as a fraction of the pair margin, over the domain below. The largest recorded movement is ${round6(largest.patchFractionOfMargin)} of the margin and it is drawn at full width rather than clamped, because a truncated outlier would hide the result.`,
      unit: null,
      domain: extent(flat.map((c) => c.patchFractionOfMargin)),
      clamp: false,
      downsample: down,
    },
    {
      visualProperty: "DisagreementArc.signedExtent",
      quantity: "spearmanRho",
      transform:
        "one arc per dimension, its signed extent a linear map from the recorded rank correlation between the two localizers over the full correlation range. Negative arcs open downward, so a disagreement is legible as a direction.",
      unit: null,
      domain: [-1, 1],
      clamp: false,
    },
    {
      visualProperty: "DimensionRow.sampleCount",
      quantity: "pairCount",
      transform: "the number of preference pairs behind that dimension's correlation, drawn as that many tick marks on the row's gutter.",
      unit: null,
      domain: extent(dims.map((d) => d.pairCount)),
      clamp: false,
    },
    {
      visualProperty: "NullBand.halfWidth",
      quantity: "nullThreshold",
      transform:
        "a band centred on zero effect, its half width the recorded null threshold in the same units as the patching fraction. A movement inside the band is drawn inside the band.",
      unit: null,
      domain: [0, intervention.nullThreshold.value],
      clamp: false,
    },
  ];

  return {
    arrays,
    caption: {
      text:
        `Two ways of asking which part of a reward model produced a score, on the same ${dims.length} dimensions and the same ${componentCount} components. ` +
        `Their rank correlation averages ${rhoMean} across the dimensions, and on ${humanKey(intervention.headline.sharpestDimension)} it reaches ${intervention.headline.sharpestRho}. ` +
        `The largest single patching movement is ${largest.patchFractionOfMargin.toFixed(2)} times the pair margin, and it is drawn at that size rather than clamped.`,
      values: {
        dimensionCount: dims.length,
        componentCount,
        meanRho: rhoMean,
        sharpestDimension: humanKey(intervention.headline.sharpestDimension),
        sharpestRho: intervention.headline.sharpestRho,
        largestPatchFractionOfMargin: largest.patchFractionOfMargin,
        pairsPerDimension: dims[0].pairCount,
      },
    },
    case: {
      id: "scorer-attribution-patching",
      state: "scorer",
      plateKind: "INTERVENTION FIXTURE",
      publicLabel: `${intervention.meta.subject.split("/").pop()}, ${dims.length} dimensions, ${componentCount} components, two localizers`,
      truthMode: "measured",
      subject: `${intervention.meta.subject}, attribution rank against activation-patching rank, ${dims[0].pairCount} preference pairs per dimension`,
      source: {
        repositoryPath: "src/data/intervention.json",
        artifact: "the per-component attribution and patching table, both ranks on every component of every dimension",
      },
      scope: `${dims.length} dimensions, ${dims[0].pairCount} pairs each, patching in ${intervention.meta.patchingMode} mode, null threshold ${intervention.nullThreshold.value}.`,
      caveat:
        `The attributed set holds ${intervention.meta.attributedComponentCount} components and the patched set holds ${intervention.meta.patchedComponentCount}; the ${intervention.meta.unpatchedComponents.join(" and ")} is attributed and not patched, and the ${componentCount} drawn here are the ones both localizers cover. ` +
        `This is a disagreement measured on one reward model. On another model in the same fixture the same correlation is near zero, which is why it is not stated as a general result about attribution.`,
      encodings,
    },
  };
}

function selectionCase(record, instrumentRoot) {
  const { trajectories, groups, steps } = record;
  const stepCount = steps.length;
  const trajCount = trajectories.length;

  const groupOrderByStep = new Map();
  for (const g of groups) {
    if (!groupOrderByStep.has(g.step_index)) groupOrderByStep.set(g.step_index, []);
    groupOrderByStep.get(g.step_index).push(g.group_id);
  }
  const groupOrdinal = trajectories.map((t) => {
    const order = groupOrderByStep.get(t.step_index) ?? [];
    const at = order.indexOf(t.group_id);
    if (at < 0) fail(`rollout ${t.trajectory_id} names a group that its own step does not record.`);
    return at;
  });

  const advantage = trajectories.map((t) => t.advantage);
  const zeroCount = advantage.filter((a) => a === 0).length;
  const abstained = record.trajPayload.map((p) => Boolean(p.scores.fields.abstained));
  const abstainedCount = abstained.filter(Boolean).length;
  const abstainedZeroCount = abstained.filter((flag, i) => flag && advantage[i] === 0).length;
  if (abstainedZeroCount !== abstainedCount) {
    fail(
      `${abstainedCount - abstainedZeroCount} rollouts abstained and still carry a non-zero advantage.\n` +
        `  The caption says an abstention is forced to zero, which is this estimator's own stated rule. ` +
        `The record no longer agrees with it, so the sentence has to be rewritten before it ships.`,
    );
  }
  const perStep = trajCount / stepCount;

  const stepLadder = [["high", stepCount], ["mid", Math.ceil(stepCount / 2)], ["low", Math.ceil(stepCount / 4)]];
  const rolloutLadder = stepLadder.map(([t, n]) => [t, n * perStep]);
  const rolloutDown = downsampleRecord(trajCount, rolloutLadder, "rollouts");

  const arrays = [
    { name: "advantage", dtype: "f32", values: advantage },
    { name: "step_index", dtype: "i32", values: trajectories.map((t) => t.step_index) },
    { name: "group_ordinal", dtype: "i32", values: groupOrdinal },
    { name: "group.mean", dtype: "f32", values: groups.map((g) => g.mean) },
    { name: "group.std", dtype: "f32", values: groups.map((g) => g.std) },
    { name: "group.k", dtype: "i32", values: groups.map((g) => g.k) },
    { name: "drawIndex.step.mid", dtype: "i32", values: stride(stepCount, stepLadder[1][1]) },
    { name: "drawIndex.step.low", dtype: "i32", values: stride(stepCount, stepLadder[2][1]) },
  ];

  const encodings = [
    {
      visualProperty: "RolloutRay.lateralOffset",
      quantity: "advantage",
      transform:
        "the ray's signed displacement from the optical axis is a linear map from the rollout's recorded advantage onto the fan's half height, using the domain below as the endpoints and zero mapping to the axis. Sign is preserved and nothing is clamped: the domain is the record's own extent.",
      unit: null,
      domain: extent(advantage),
      clamp: false,
      downsample: rolloutDown,
    },
    {
      visualProperty: "RolloutRay.stepOrdinal",
      quantity: "step_index",
      transform:
        "which recorded step the ray belongs to, used to place it in depth. Read from the record rather than inferred from position in the file, so a reordered shard cannot silently renumber the run.",
      unit: null,
      domain: [0, stepCount - 1],
      clamp: false,
      downsample: rolloutDown,
    },
    {
      visualProperty: "RolloutRay.groupOrdinal",
      quantity: "group_ordinal",
      transform:
        `which of that step's groups the rollout came from, in the order the record lists them, used to split the fan into ${groups.length / stepCount} bundles per step. Not derived from a fixed rollout count per group.`,
      unit: null,
      domain: [0, groups.length / stepCount - 1],
      clamp: false,
      downsample: rolloutDown,
    },
    {
      visualProperty: "GroupBracket.centre",
      quantity: "group.mean",
      transform:
        "the bracket's centre line is a linear map from the group's recorded mean score onto the same axis the rays are placed on. The advantage a ray carries is that ray's score measured against this line.",
      unit: "reward",
      domain: extent(groups.map((g) => g.mean)),
      clamp: false,
      downsample: downsampleRecord(groups.length, stepLadder.map(([t, n]) => [t, n * (groups.length / stepCount)]), "groups"),
    },
    {
      visualProperty: "GroupBracket.halfSpan",
      quantity: "group.std",
      transform:
        "the bracket's half span is a linear map from the group's recorded score standard deviation, which is the same quantity the estimator divides by. A group with no spread draws no bracket, which is what a degenerate group looks like.",
      unit: "reward",
      domain: extent(groups.map((g) => g.std)),
      clamp: false,
      downsample: downsampleRecord(groups.length, stepLadder.map(([t, n]) => [t, n * (groups.length / stepCount)]), "groups"),
    },
    {
      visualProperty: "GroupBracket.rayCount",
      quantity: "group.k",
      transform: "how many rays the bracket spans, read from the group's recorded size rather than assumed constant.",
      unit: null,
      domain: extent(groups.map((g) => g.k)),
      clamp: false,
    },
  ];

  return {
    arrays,
    caption: {
      text:
        `Each ray is one rollout and its offset is that rollout's recorded advantage, the value the estimator actually applied. ` +
        `Across ${group(stepCount)} steps the ${group(trajCount)} advantages run from ${round6(Math.min(...advantage))} to ${round6(Math.max(...advantage))}. ` +
        `${group(zeroCount)} of them are exactly zero, and ${group(abstainedZeroCount)} of those are rollouts the grader abstained on, which this estimator forces to zero rather than dropping.`,
      values: {
        stepCount,
        rolloutCount: trajCount,
        rolloutsPerStep: perStep,
        groupsPerStep: groups.length / stepCount,
        advantageMin: round6(Math.min(...advantage)),
        advantageMax: round6(Math.max(...advantage)),
        zeroAdvantageCount: zeroCount,
        abstainedCount,
      },
    },
    case: {
      id: "selection-advantages",
      state: "selection",
      plateKind: "RECORDED SELECTION",
      publicLabel: `Reference GRPO step, ${perStep} rollouts in ${groups.length / stepCount} groups, real advantages`,
      truthMode: "measured",
      subject: `The same ${group(stepCount)}-step GRPO run, read at the rollout level: every advantage the estimator computed and the record stored.`,
      source: {
        repositoryPath: citeInstrument(instrumentRoot, record.runDir),
        artifact: "the trajectory table's advantage column and the group table's mean and standard deviation",
      },
      scope:
        `${group(trajCount)} rollouts across ${group(stepCount)} recorded steps. Advantage here is the group-centred, group-standard-deviation-normalised value this estimator computes, not a general definition of advantage.`,
      caveat:
        `Nothing here is per token. The per-token advantage column is empty on all ${group(trajCount)} rollouts and the recorded token count is zero throughout, so this record supports no per-position geometry and none is drawn. ` +
        `${group(zeroCount)} rays sit on the axis because zero is what was recorded for them, which for ${group(abstainedZeroCount)} of them means the grader abstained rather than that the rollout was average.`,
      encodings,
    },
  };
}

function updateCase(record, instrumentRoot) {
  const { steps, stepPayload } = record;
  const gradNorm = steps.map((s) => s.grad_norm_clipped);
  if (gradNorm.some((v) => typeof v !== "number")) {
    fail("some recorded steps carry no clipped gradient norm; the update state's vector length is that column.");
  }
  const entropy = stepPayload.map((p) => p.optimizer.entropy);
  const reward = stepPayload.map((p) => p.optimizer.extra.reward);
  const rewardStd = stepPayload.map((p) => p.optimizer.extra.reward_std);
  const perStep = steps.map((s) => s.n_trajectories);
  const stepCount = steps.length;
  const ladder = [["high", stepCount], ["mid", Math.ceil(stepCount / 2)], ["low", Math.ceil(stepCount / 4)]];
  const down = downsampleRecord(stepCount, ladder, "steps");

  const arrays = [
    { name: "grad_norm_clipped", dtype: "f32", values: gradNorm },
    { name: "entropy", dtype: "f32", values: entropy },
    { name: "reward", dtype: "f32", values: reward },
    { name: "reward_std", dtype: "f32", values: rewardStd },
    { name: "n_trajectories", dtype: "i32", values: perStep },
    { name: "drawIndex.step.mid", dtype: "i32", values: stride(stepCount, ladder[1][1]) },
    { name: "drawIndex.step.low", dtype: "i32", values: stride(stepCount, ladder[2][1]) },
  ];

  const encodings = [
    {
      visualProperty: "UpdateVector.length",
      quantity: "grad_norm_clipped",
      transform:
        "the length of the single vector leaving the update stage is a linear map from the step's recorded clipped gradient norm over the domain below. It is the size of the step the optimizer took, not the size of any one rollout's contribution.",
      unit: null,
      domain: extent(gradNorm),
      clamp: false,
      downsample: down,
    },
    {
      visualProperty: "UpdateVector.contributorCount",
      quantity: "n_trajectories",
      transform:
        "how many rollouts entered that step, read from the step record. It sets how many incoming rays converge on the vector and nothing else; their individual contributions are not recorded.",
      unit: null,
      domain: extent(perStep),
      clamp: false,
      downsample: down,
    },
    {
      visualProperty: "EntropyTrace.y",
      quantity: "entropy",
      transform:
        "a trace whose height is a linear map from the recorded policy entropy over the domain below. The domain is narrow on this run and the trace is close to flat, which is the measurement rather than a rendering choice.",
      unit: "nats",
      domain: extent(entropy),
      clamp: false,
      downsample: down,
    },
    {
      visualProperty: "RewardTrace.y",
      quantity: "reward",
      transform: "a trace whose height is a linear map from the step's recorded mean reward over the domain below.",
      unit: "reward",
      domain: extent(reward),
      clamp: false,
      downsample: down,
    },
    {
      visualProperty: "RewardTrace.bandHalfWidth",
      quantity: "reward_std",
      transform:
        "the half width of the band around the reward trace is a linear map from the step's recorded reward standard deviation, on the same scale as the trace's own axis, so the band and the line are readable together.",
      unit: "reward",
      domain: extent(rewardStd),
      clamp: false,
      downsample: down,
    },
  ];

  return {
    arrays,
    caption: {
      text:
        `Across ${group(stepCount)} recorded steps the clipped gradient norm runs from ${round6(Math.min(...gradNorm))} to ${round6(Math.max(...gradNorm))}, ` +
        `on batches of ${perStep[0]} rollouts each. ` +
        `What the record does not hold is any per rollout gradient, so how much of that norm survived cancellation between the eight rollouts is not drawable from it.`,
      values: {
        stepCount,
        rolloutsPerStep: perStep[0],
        gradNormMin: round6(Math.min(...gradNorm)),
        gradNormMax: round6(Math.max(...gradNorm)),
        rewardMin: round6(Math.min(...reward)),
        rewardMax: round6(Math.max(...reward)),
      },
    },
    case: {
      id: "update-step",
      state: "update",
      plateKind: "RECORDED UPDATE",
      publicLabel: `Reference GRPO step, ${perStep[0]} rollouts, immediate credit`,
      truthMode: "measured",
      subject: `The same GRPO run at the optimizer step: the clipped gradient norm, the policy entropy, and the batch reward with its spread, as the trainer logged them.`,
      source: {
        repositoryPath: citeInstrument(instrumentRoot, record.runDir),
        artifact: "the step table and its optimizer payload",
      },
      scope: `${group(stepCount)} recorded optimizer steps, one update per step, ${perStep[0]} rollouts per update. Immediate update credit only, never long-run causal credit: the trajectories are two turns long and there is no tool call in the record.`,
      caveat:
        `No per-rollout gradient is stored anywhere in this record, so the share of gradient mass that cancels within a step cannot be drawn from it. ` +
        `The project reports residual figures for immediate credit from a separate experiment; those exist as prose and as test assertions with no persisted array behind them, so they are stated in the text and are not encoded in any geometry here.`,
      encodings,
    },
  };
}

function responseCase() {
  return {
    arrays: [],
    caption: {
      text:
        `Nothing was measured here. The reconciliation this state would have illustrated does close on the 200-step run, and the closure is carried by the sampling noise of two batches of eight rollouts. ` +
        `On the worst feature-run pair the test's own detection floor is 3.760 against a first-order prediction of 5.647e-06, a ratio of 665,862; the median ratio over the six pairs is 854,374. ` +
        `Monte Carlo uncertainty is effectively all of the composed variance, and five of the nine uncertainty terms were computed while four are named absent. ` +
        `Neither verdict could have failed meaningfully, and that is the result this state shows.`,
      values: {},
    },
    case: {
      id: "response-unresolved",
      state: "response",
      plateKind: "NO MEASUREMENT",
      publicLabel: "Policy response, nothing recorded",
      truthMode: "schematic",
      subject:
        "How the policy moves in response to an update. This project has not measured it at a scale where the answer could have come out either way, and this construction says so rather than standing in for it.",
      source: {
        repositoryPath: "reward-lens-assay/FINDINGS.md",
        artifact:
          "the project's own findings record, which states the detection floor, declines the flattering verdict, and names the four budget terms it could not compute",
      },
      scope:
        "A construction. It carries no recorded quantity, no run, and no number from any measurement. Nothing in it may be read off.",
      caveat:
        "The negative is the content. A response geometry drawn here would be an invention, and three times in this build's history a central visual claim turned out to have no measured instance behind it. " +
        "The figures in the caption come from the project's own reconciliation report and are prose: they are stated, cited, and never encoded as a width, a count or a distance.",
      encodings: [],
    },
  };
}

function runBoundaryCase(series) {
  const steps = series.steps;
  const drawnPoints = steps.length;
  const declared = series.meta.stepCount;
  const disagreement = series.meta.stepCountDisagreement;
  if (!disagreement) {
    fail(
      "run-series.json no longer carries meta.stepCountDisagreement.\n" +
        "  The caption below states that two records of this run disagree on its length. Without the " +
        "artifact's own note the sentence is unsourced, and a figure that draws one count while its " +
        "caption states another is the contradiction this manifest exists to prevent.",
    );
  }
  for (const key of ["written", "realized", "formatOk"]) {
    if (series.series[key].length !== drawnPoints) {
      fail(`run-series.json's ${key} holds ${series.series[key].length} values against ${drawnPoints} step indices.`);
    }
  }

  const detectors = series.detectors;
  const promoted = detectors.filter((d) => d.shipped);
  if (promoted.length !== 1) {
    fail(
      `${promoted.length} detectors are marked as shipped in run-series.json and the caption names one.\n` +
        `  Which signal the site promotes is a claim, and it is read from the artifact rather than chosen here.`,
    );
  }
  const shipped = promoted[0];
  const earliest = detectors
    .filter((d) => typeof d.alarmStep === "number")
    .reduce((a, b) => (b.alarmStep < a.alarmStep ? b : a));

  const ladder = [["high", drawnPoints], ["mid", Math.ceil(drawnPoints / 2)], ["low", Math.ceil(drawnPoints / 4)]];
  const down = downsampleRecord(drawnPoints, ladder, "steps");

  const arrays = [
    { name: "steps", dtype: "i32", values: steps },
    { name: "series.written", dtype: "f32", values: series.series.written },
    { name: "series.realized", dtype: "f32", values: series.series.realized },
    { name: "series.formatOk", dtype: "f32", values: series.series.formatOk },
    { name: "perEpisode.meanCompletionCharacters", dtype: "f32", values: series.perEpisode.meanCompletionCharacters },
    { name: "transition.midpoint", dtype: "f32", values: [series.transition.midpoint] },
    { name: "transition.width1090", dtype: "f32", values: [series.transition.width1090] },
    { name: "detectors.alarmStep", dtype: "f32", values: detectors.map((d) => (d.alarmStep === null ? Number.NaN : d.alarmStep)) },
    { name: "detectors.surrogateRate", dtype: "f32", values: detectors.map((d) => (d.surrogateRate === null ? Number.NaN : d.surrogateRate)) },
    { name: "detectors.shipped", dtype: "i32", values: detectors.map((d) => (d.shipped ? 1 : 0)) },
    { name: "drawIndex.series.mid", dtype: "i32", values: stride(drawnPoints, ladder[1][1]) },
    { name: "drawIndex.series.low", dtype: "i32", values: stride(drawnPoints, ladder[2][1]) },
  ];

  const encodings = [
    {
      visualProperty: "Trace.x",
      quantity: "steps",
      transform:
        "position along the time axis, a linear map from the step index recorded on each rollout onto the rail's length. The index is the one the published table carries on every row; it is not reconstructed from file ordering.",
      unit: "training steps",
      domain: [steps[0], steps[steps.length - 1]],
      clamp: false,
      downsample: down,
    },
    {
      visualProperty: "Trace.written.y",
      quantity: "series.written",
      transform:
        "height of the first trace, a linear map from the per-step mean of the labelled pass column over the 64 rollouts recorded at that step, with the unit interval mapped to the trace field's height.",
      unit: null,
      domain: [0, 1],
      clamp: false,
      downsample: down,
    },
    {
      visualProperty: "Trace.realized.y",
      quantity: "series.realized",
      transform: "height of the second trace, the same per-step mean over the same 64 rollouts of the realized-objective column, on the same axis as the first.",
      unit: null,
      domain: [0, 1],
      clamp: false,
      downsample: down,
    },
    {
      visualProperty: "Trace.formatOk.y",
      quantity: "series.formatOk",
      transform: "height of the third trace, the per-step mean of the format-compliance column, on the same axis.",
      unit: null,
      domain: [0, 1],
      clamp: false,
      downsample: down,
    },
    {
      visualProperty: "EpisodeInsert.height",
      quantity: "perEpisode.meanCompletionCharacters",
      transform:
        "the height of the length insert, a linear map from the per-step mean completion length in characters over the domain below. Characters, because the published table records no token count and converting one into the other would be a number with no measurement behind it.",
      unit: "characters",
      domain: extent(series.perEpisode.meanCompletionCharacters),
      clamp: false,
      downsample: down,
    },
    {
      visualProperty: "TransitionBand.centreStep",
      quantity: "transition.midpoint",
      transform: `the centre of the transition band, placed on the time axis by the same map as Trace.x, from the recorded midpoint of the logistic fit to the labelled series.`,
      unit: "training steps",
      domain: [steps[0], steps[steps.length - 1]],
      clamp: false,
    },
    {
      visualProperty: "TransitionBand.widthSteps",
      quantity: "transition.width1090",
      transform:
        "the band's full width in steps, from the recorded ten-to-ninety width of the same fit, converted to world units by the same steps-per-unit factor as Trace.x. The band is an extent and is never drawn as a line.",
      unit: "training steps",
      domain: [0, steps[steps.length - 1] - steps[0]],
      clamp: false,
    },
    {
      visualProperty: "DetectorMarker.step",
      quantity: "detectors.alarmStep",
      transform:
        "one marker per detector, at the step it alarmed, placed by the same map as Trace.x. Detectors stay in the evaluation order the artifact lists them in and are never sorted by how early they fired. A detector with no alarm step carries a non-finite value and draws no marker.",
      unit: "training steps",
      domain: [steps[0], steps[steps.length - 1]],
      clamp: false,
    },
    {
      visualProperty: "DetectorMarker.surrogateRate",
      quantity: "detectors.surrogateRate",
      transform:
        "the marker's dimness, a linear map from the detector's false-alarm rate on order-destroyed surrogates of the same series, over the unit interval. The earliest marker is the dimmest, which is the result.",
      unit: null,
      domain: [0, 1],
      clamp: false,
    },
    {
      visualProperty: "DetectorMarker.promoted",
      quantity: "detectors.shipped",
      transform: "one for the single detector the study promoted, zero for the ones it rejected. The rejected markers are drawn, not omitted.",
      unit: null,
      domain: [0, 1],
      clamp: false,
    },
  ];

  return {
    arrays,
    caption: {
      text:
        `${group(series.meta.rolloutCount)} labelled rollouts, ${series.meta.rolloutsPerStep} at each of ${group(drawnPoints)} recorded step indices. ` +
        `The labelled series crosses its midpoint at step ${series.transition.midpoint} with a ten-to-ninety width of ${series.transition.width1090} steps. ` +
        `The promoted signal alarms at step ${shipped.alarmStep} and fires on ${Math.round(shipped.surrogateRate * 1000) / 10}% of in-control surrogates. The signal recorded as "${earliest.label}" alarms earlier, at step ${earliest.alarmStep}, and fires on ${Math.round(earliest.surrogateRate * 1000) / 10}%, which is why it was rejected. ` +
        `The figure draws ${group(drawnPoints)} points. The frozen ledger states ${group(declared)} steps for this run and the published rollout table carries ${group(drawnPoints)} distinct step indices; the site states the lower number and does not assert which record is right.`,
      values: {
        rolloutCount: series.meta.rolloutCount,
        rolloutsPerStep: series.meta.rolloutsPerStep,
        drawnPoints,
        declaredStepCount: declared,
        transitionMidpoint: series.transition.midpoint,
        transitionWidth: series.transition.width1090,
        promotedAlarmStep: shipped.alarmStep,
        promotedSurrogateRate: shipped.surrogateRate,
        earliestAlarmStep: earliest.alarmStep,
        earliestSurrogateRate: earliest.surrogateRate,
      },
    },
    case: {
      id: "run-boundary-series",
      state: "run-boundary",
      plateKind: "PUBLIC TRAINING SERIES",
      publicLabel: `Public reward-hacking run, ${group(series.meta.rolloutCount)} labelled rollouts, one scalar-series warning result`,
      truthMode: "measured",
      subject: `${series.meta.subject}, a published reward-hacking training run, read one rollout at a time and averaged within each recorded step.`,
      source: {
        repositoryPath: "src/data/run-series.json",
        artifact: "the per-step means of the published rollout table, with the fitted transition and the four evaluated detectors",
      },
      scope:
        `${group(series.meta.rolloutCount)} rollouts, ${series.meta.rolloutsPerStep} at every recorded step index, one run, one model, one seed. ` +
        `The detector rows come from the study's frozen prediction ledger because the published table carries no optimizer telemetry and the gradient comparator cannot be recomputed from it.`,
      caveat:
        `Two records of this same run disagree on its length: the frozen ledger says ${group(declared)} steps and the published rollout table carries ${group(drawnPoints)} distinct step indices. The figure draws ${group(drawnPoints)} points and the site does not assert which record is right. ` +
        `The earliest alarm here is not the best detector: the signal that fires first is the one the study rejected, at a surrogate false-alarm rate of ${Math.round(earliest.surrogateRate * 1000) / 10}%. One run does not establish a detection rate.`,
      encodings,
    },
  };
}

// ---------------------------------------------------------------------------
// Checks over the assembled manifest
// ---------------------------------------------------------------------------

/**
 * Word-boundary matching, built the same way gate 7 builds it.
 *
 * The list is generated from the registries into src/data/banned-terms.json;
 * a hand-written copy here would be a list of the identifiers somebody
 * remembered.
 */
function bannedTermMatcher(siteDataDir) {
  const path = requireSource(
    join(siteDataDir, "banned-terms.json"),
    "the generated list of internal identifiers",
    "It is generated from the registries. This check refuses to hand-write a substitute.",
  );
  const raw = readJson(path);
  const terms = Array.isArray(raw) ? raw : (raw.terms ?? Object.keys(raw));
  const sorted = [...new Set(terms)].filter(Boolean).sort((a, b) => b.length - a.length);
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\w-])(${sorted.map(escape).join("|")})(?![\\w-])`, "g");
  return { termCount: sorted.length, find: (text) => [...text.matchAll(re)].map((m) => m[1]) };
}

/** Every string a case carries, with the field it sits in. */
function* caseStrings(entry) {
  const c = entry.case;
  yield ["id", c.id];
  yield ["plateKind", c.plateKind];
  yield ["publicLabel", c.publicLabel];
  yield ["subject", c.subject];
  yield ["scope", c.scope];
  yield ["caveat", c.caveat];
  for (const [k, v] of Object.entries(c.source)) yield [`source.${k}`, v];
  for (const e of c.encodings) {
    yield [`encoding.${e.visualProperty}.visualProperty`, e.visualProperty];
    yield [`encoding.${e.visualProperty}.quantity`, e.quantity];
    yield [`encoding.${e.visualProperty}.transform`, e.transform];
    if (e.unit) yield [`encoding.${e.visualProperty}.unit`, e.unit];
    if (e.downsample) yield [`encoding.${e.visualProperty}.downsample.method`, e.downsample.method];
  }
  yield ["caption.text", entry.caption.text];
  for (const [k, v] of Object.entries(entry.caption.values)) {
    if (typeof v === "string") yield [`caption.values.${k}`, v];
  }
}

/**
 * Everything that must be true of the assembled manifest before it is written.
 *
 * Each check returns the number of things it compared, and a check that
 * compared nothing is itself a failure. Gate 4 in this repository once reported
 * "0 values compared" and exited zero; the count is here so that cannot happen
 * quietly.
 */
function checkManifest(entries, truth, matcher) {
  const problems = [];
  const counts = {};
  const bump = (k, n = 1) => {
    counts[k] = (counts[k] ?? 0) + n;
  };

  const seen = new Set();
  for (const entry of entries) {
    const c = entry.case;
    if (seen.has(c.id)) problems.push(`two cases share the id "${c.id}"`);
    seen.add(c.id);
    if (!STATES.includes(c.state)) problems.push(`case "${c.id}" names the state "${c.state}", which is not one of the five`);
    bump("cases");

    const verdict = truth.violatesTruthMode(c);
    if (verdict) problems.push(verdict);
    bump("truthMode");

    for (const [field, value] of caseStrings(entry)) {
      bump("strings");
      if (typeof value !== "string" || value.trim().length === 0) {
        problems.push(`case "${c.id}" field ${field} is empty`);
        continue;
      }
      if (truth.leaksLocalPath(value)) {
        problems.push(`case "${c.id}" field ${field} carries a local path: ${JSON.stringify(value)}`);
      }
      bump("pathChecks");
      const hits = matcher.find(value);
      if (hits.length > 0) {
        problems.push(
          `case "${c.id}" field ${field} carries the internal identifier(s) ${[...new Set(hits)].join(", ")}. ` +
            `Public replacements are in the decisions record under D-05.`,
        );
      }
      bump("bannedChecks");
    }

    // Encodings and arrays must account for each other in both directions.
    const arrayNames = new Set(entry.arrays.map((a) => a.name));
    const drawn = new Set();
    for (const e of c.encodings) {
      bump("encodings");
      if (!arrayNames.has(e.quantity)) {
        problems.push(
          `case "${c.id}" encoding ${e.visualProperty} names the quantity "${e.quantity}", which is not an array in its payload. ` +
            `An encoding that names nothing is a claim with no record behind it.`,
        );
      }
      drawn.add(e.quantity);
      if (e.domain !== null) {
        if (!Array.isArray(e.domain) || e.domain.length !== 2 || e.domain.some((v) => !Number.isFinite(v))) {
          problems.push(`case "${c.id}" encoding ${e.visualProperty} has a malformed domain`);
        } else if (e.domain[0] > e.domain[1]) {
          problems.push(`case "${c.id}" encoding ${e.visualProperty} has an inverted domain`);
        }
      }
      if (typeof e.clamp !== "boolean") problems.push(`case "${c.id}" encoding ${e.visualProperty} does not say whether it clamps`);
      if (e.unit !== null && typeof e.unit !== "string") problems.push(`case "${c.id}" encoding ${e.visualProperty} has a malformed unit`);
      if (e.transform.length < 40) {
        problems.push(
          `case "${c.id}" encoding ${e.visualProperty} states its transform in ${e.transform.length} characters. ` +
            `The transform has to be complete enough to reproduce the arithmetic.`,
        );
      }
      if (e.downsample) {
        bump("downsamples");
        const d = e.downsample;
        if (!(d.outputCount > 0 && d.outputCount <= d.inputCount)) {
          problems.push(`case "${c.id}" encoding ${e.visualProperty} declares a downsample of ${d.inputCount} into ${d.outputCount}`);
        }
        if (typeof d.seed !== "number") problems.push(`case "${c.id}" encoding ${e.visualProperty} records no downsample seed`);
        if (!d.method || d.method.length < 40) problems.push(`case "${c.id}" encoding ${e.visualProperty} does not state its downsample method`);
      }
    }
    for (const name of arrayNames) {
      bump("arrays");
      if (name.startsWith("drawIndex.")) continue;
      if (!drawn.has(name)) {
        problems.push(
          `case "${c.id}" ships the array "${name}" and no encoding names it. ` +
            `An array nothing draws is a number in the bundle that no reviewer has to account for.`,
        );
      }
    }

    // A schematic case ships no numbers at all, not merely no encodings.
    if (c.truthMode === "schematic" && entry.arrays.length > 0) {
      problems.push(`case "${c.id}" is schematic and ships ${entry.arrays.length} array(s) of numbers`);
    }
  }

  for (const state of STATES) {
    if (!entries.some((e) => e.case.state === state)) problems.push(`no case is bound to the state "${state}"`);
    bump("states");
  }

  for (const [key, min] of [["cases", 1], ["encodings", 1], ["strings", 1], ["arrays", 1], ["states", 5], ["downsamples", 1]]) {
    if ((counts[key] ?? 0) < min) {
      problems.push(
        `the manifest check compared ${counts[key] ?? 0} ${key} and expected at least ${min}. ` +
          `A gate that compared nothing is not a gate.`,
      );
    }
  }
  return { problems, counts };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function stableStringify(value) {
  return `${JSON.stringify(value, null, 1)}\n`;
}

async function build(options) {
  const outDir = options.outDir;
  const siteDataDir = options.siteDataDir;
  const instrumentRoot = findInstrumentRoot();
  const truth = await loadTruthContract();
  const probes = probeTruthGate(truth, options.inject === "broken-truth-gate");

  const sourcePaths = {
    "run-series": requireSource(
      join(siteDataDir, "run-series.json"),
      "the public training series",
      "It is generated by scripts/build_data.py from the published rollout table.",
    ),
    "grader-cards": requireSource(
      join(siteDataDir, "grader-cards.json"),
      "the verifier audit cards",
      "They are generated by scripts/build_grader_cards.py from the audit's own card files.",
    ),
    intervention: requireSource(
      join(siteDataDir, "intervention.json"),
      "the attribution against patching fixture",
      "It is generated by scripts/build_intervention.py from the per-pair tables.",
    ),
  };

  const record = readRunRecord(instrumentRoot);
  const series = readJson(sourcePaths["run-series"]);
  const cards = readJson(sourcePaths["grader-cards"]);
  const intervention = readJson(sourcePaths.intervention);

  const entries = [
    scorerScoreTreeCase(record, instrumentRoot),
    ...verifierCases(cards, siteDataDir),
    attributionCase(intervention),
    selectionCase(record, instrumentRoot),
    updateCase(record, instrumentRoot),
    responseCase(),
    runBoundaryCase(series),
  ];

  // The corruption hooks. They exist so each gate can be shown refusing real
  // output rather than only a probe, and they are refused unless asked for.
  if (options.inject === "schematic-encoding") {
    const target = entries.find((e) => e.case.truthMode === "schematic");
    target.case.encodings.push({
      visualProperty: "ResponseArc.displacement",
      quantity: "policy_movement",
      transform: "a deliberately injected quantitative encoding on a construction that measured nothing",
      unit: "logit",
      domain: [0, 1],
      clamp: false,
    });
  }
  if (options.inject === "local-path") {
    entries[0].case.source.repositoryPath = `/home/someone/checkout/${entries[0].case.id}.json`;
  }
  if (options.inject === "banned-term") {
    entries[0].case.publicLabel = `${entries[0].case.publicLabel}, X1`;
  }
  if (options.inject === "undeclared-array") {
    entries[entries.length - 1].arrays.push({ name: "series.hackRate", dtype: "f32", values: series.series.hackRate });
  }

  const matcher = bannedTermMatcher(siteDataDir);
  const { problems, counts } = checkManifest(entries, truth, matcher);
  if (problems.length > 0) {
    fail(
      `${problems.length} truth violation(s); nothing was written.\n  ` +
        problems.join("\n  ") +
        `\n  Compared: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}.`,
    );
  }

  const payloads = new Map();
  for (const entry of entries) {
    const bytes = encodePayload(entry.case.id, entry.arrays);
    entry.case.contentHash = sha256(bytes);
    payloads.set(entry.case.id, bytes);
  }

  const generatedAt = process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
    : new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const manifest = {
    version: MANIFEST_VERSION,
    generatedBy: "scripts/build_scene_data.mjs",
    generatedAt,
    cases: entries.map((e) => e.case),
  };
  const captions = {
    note:
      "Generated beside the geometry, from the same arrays. A caption and the figure under it read one record, so the two cannot drift apart without the generator noticing. `values` holds the numbers the sentence uses, so a component can bind one without retyping it.",
    generatedBy: "scripts/build_scene_data.mjs",
    captions: Object.fromEntries(entries.map((e) => [e.case.id, e.caption])),
  };

  // The digest is what a determinism check compares. `generatedAt` is the one
  // field a clock touches and it is excluded here on purpose; everything a
  // reader sees is inside the digest.
  const digestInput = stableStringify({ ...manifest, generatedAt: "" }) + stableStringify(captions);
  const buildDigest = {
    note:
      "Content hashes for cache invalidation and for proving a rebuild is byte-identical. `manifestDigest` covers the manifest with its timestamp blanked and the captions in full, so two runs over unchanged sources agree. A changed source hash invalidates the cases listed beside it.",
    manifestVersion: MANIFEST_VERSION,
    payloadFormatVersion: PAYLOAD_FORMAT_VERSION,
    manifestDigest: sha256(Buffer.from(digestInput, "utf-8")),
    sources: Object.fromEntries(
      Object.entries(sourcePaths).map(([k, p]) => [k, { path: `src/data/${k}.json`, sha256: sha256(readFileSync(p)) }]),
    ),
    runRecord: {
      path: citeInstrument(instrumentRoot, record.runDir),
      sha256: hashDirectory(record.runDir),
      counts: record.manifest.counts,
    },
    truthContract: {
      path: "src/components/scene/types/truth.ts",
      sha256: sha256(readFileSync(join(SITE, "src/components/scene/types/truth.ts"))),
    },
    cases: Object.fromEntries(
      entries.map((e) => [
        e.case.id,
        { contentHash: e.case.contentHash, payloadBytes: payloads.get(e.case.id).length, arrays: e.arrays.length, encodings: e.case.encodings.length },
      ]),
    ),
  };

  return { manifest, captions, buildDigest, payloads, entries, probes, counts, outDir };
}

/** A stable hash over a directory of files, by sorted relative path. */
function hashDirectory(root) {
  const hash = createHash("sha256");
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, rel);
      else {
        hash.update(rel);
        hash.update(readFileSync(full));
      }
    }
  };
  walk(root, "");
  return hash.digest("hex");
}

function writeOutput(result) {
  const { outDir } = result;
  const payloadDir = join(outDir, "payload");
  if (existsSync(payloadDir)) rmSync(payloadDir, { recursive: true, force: true });
  mkdirSync(payloadDir, { recursive: true });
  writeFileSync(join(outDir, "manifest.json"), stableStringify(result.manifest));
  writeFileSync(join(outDir, "captions.json"), stableStringify(result.captions));
  writeFileSync(join(outDir, "build-digest.json"), stableStringify(result.buildDigest));
  for (const [id, bytes] of result.payloads) writeFileSync(join(payloadDir, `${id}.bin`), bytes);
}

function compareOutput(result) {
  const { outDir } = result;
  const drift = [];
  const compare = (name, produced) => {
    const path = join(outDir, name);
    if (!existsSync(path)) return drift.push(`${name} has never been generated`);
    const onDisk = readFileSync(path);
    if (!onDisk.equals(Buffer.isBuffer(produced) ? produced : Buffer.from(produced, "utf-8"))) drift.push(`${name} differs`);
  };
  compare("manifest.json", stableStringify({ ...result.manifest, generatedAt: readGeneratedAt(outDir) ?? result.manifest.generatedAt }));
  compare("captions.json", stableStringify(result.captions));
  for (const [id, bytes] of result.payloads) compare(join("payload", `${id}.bin`), bytes);
  return drift;
}

function readGeneratedAt(outDir) {
  const path = join(outDir, "manifest.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")).generatedAt;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    check: false,
    quiet: false,
    outDir: join(SITE, "src/data/scene"),
    siteDataDir: process.env.SCENE_DATA_SITE_DATA ? resolve(process.env.SCENE_DATA_SITE_DATA) : join(SITE, "src/data"),
    inject: process.env.SCENE_DATA_INJECT ?? null,
  };
  for (const arg of argv) {
    if (arg === "--check") options.check = true;
    else if (arg === "--quiet") options.quiet = true;
    else if (arg.startsWith("--out=")) options.outDir = resolve(arg.slice("--out=".length));
    else fail(`unknown argument ${arg}. Usage: node scripts/build_scene_data.mjs [--check] [--out=DIR] [--quiet]`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await build(options);

  if (options.check) {
    const drift = compareOutput(result);
    if (drift.length > 0) {
      console.error(
        `FAIL scene data is out of date with its sources:\n  ${drift.join("\n  ")}\n  Run npm run build:scene-data.`,
      );
      process.exit(1);
    }
    if (!options.quiet) console.log(`scene data is current: ${result.manifest.cases.length} cases, ${result.payloads.size} payloads`);
    return;
  }

  mkdirSync(options.outDir, { recursive: true });
  writeOutput(result);

  if (options.quiet) return;
  for (const line of result.probes) console.log(`  truth gate probe  ${line}`);
  console.log(
    `  checked ${Object.entries(result.counts).map(([k, v]) => `${v} ${k}`).join(", ")}`,
  );
  const rows = result.entries.map((e) => ({
    id: e.case.id,
    state: e.case.state,
    mode: e.case.truthMode,
    enc: e.case.encodings.length,
    bytes: result.payloads.get(e.case.id).length,
  }));
  const width = (key) => Math.max(...rows.map((r) => String(r[key]).length), key.length);
  const w = { id: width("id"), state: width("state"), mode: width("mode") };
  console.log(`\n  ${"id".padEnd(w.id)}  ${"state".padEnd(w.state)}  ${"mode".padEnd(w.mode)}  enc  bytes`);
  for (const r of rows) {
    console.log(
      `  ${r.id.padEnd(w.id)}  ${r.state.padEnd(w.state)}  ${r.mode.padEnd(w.mode)}  ${String(r.enc).padStart(3)}  ${String(r.bytes).padStart(6)}`,
    );
  }
  const total = rows.reduce((a, r) => a + r.bytes, 0);
  console.log(`\n  ${rows.length} cases, ${total} payload bytes, digest ${result.buildDigest.manifestDigest.slice(0, 16)}`);
}

main().catch((error) => {
  if (error instanceof SceneDataError) {
    console.error(`FAIL build_scene_data: ${error.message}`);
    process.exit(1);
  }
  throw error;
});
