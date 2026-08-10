#!/usr/bin/env node
/**
 * The composed stills, generated from the scene's own manifest and payloads.
 *
 * WHAT THIS PRODUCES AND WHY IT IS GENERATED RATHER THAN DRAWN.
 * `src/data/scene/stills/index.json` holds, for every case in the scene
 * manifest, the geometry the fallback draws, normalised into the room's own
 * coordinates. The fallback component turns that into an SVG. Nothing about a
 * case's shape is written by hand anywhere, so a still cannot say something the
 * record does not, and a changed record changes the still on the next run.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not screenshot a GPU. SCENE.md §9
 * describes rendering the stills through `headless-gl`, and that is not
 * available here: this machine has no GPU, `headless-gl` is not in the
 * dependency tree, and the packet may not add one. It would also be the wrong
 * artifact today, because the live room does not yet draw the dispersing
 * element, the fan or the five states, so a capture would bake an unfinished
 * room into the one path that has to look finished.
 *
 * So the still is a VECTOR still in the same composition. D-24's ladder is
 * about fidelity of rendering, not about a different picture: the still reads
 * `hero-geometry.ts` for where the bench sits exactly as the hand-authored room
 * and the live scene do, and this file supplies only what the room cannot know,
 * which is what was measured. That is also why gate 20 can hold the three to
 * 8px: there is one composition and three renderers of it, and this one is
 * resolution independent, weighs a few kilobytes, and needs no second request
 * on a slow connection.
 *
 * THE COORDINATE SPACE, stated once.
 *   x  0 at the dispersing element's exit face, 1 at the detector plane.
 *   y  0 on the optical axis, 1 at the top of the fan's extent. Upward only,
 *      because D-22 gives the half below the axis to the rail and the readout.
 *   A signed quantity declares `zeroAt` in (0,1): where its own zero sits in
 *      that span. Nothing is clamped silently; a value outside a declared
 *      domain fails generation.
 *
 * THERE IS NO SYNTHETIC PATH. A missing manifest, a missing caption, a missing
 * payload, an array a case names and the payload does not carry: each throws
 * and names what was absent. A fallback that invented a shape would be the one
 * failure this site cannot survive, because the fallback is the copy of the
 * argument that a reader on a bad machine actually sees.
 *
 * Usage:
 *   node scripts/dev/build-scene-stills.mjs           write
 *   node scripts/dev/build-scene-stills.mjs --check   fail if what is on disk
 *                                                     is not what this run makes
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCENE = join(ROOT, "src", "data", "scene");
const OUT_DIR = join(SCENE, "stills");
const OUT_INDEX = join(OUT_DIR, "index.json");
const OUT_LOCK = join(OUT_DIR, "lock.json");

const CHECK = process.argv.includes("--check");

/**
 * The modules that decide where the bench sits.
 *
 * Their bytes are hashed into the lock rather than parsed. The still does not
 * read a number out of them, the COMPONENT does, at render time, from the same
 * import the hand-authored room uses. Hashing them here means a composition
 * change is still a reason to regenerate and to re-run gate 20, which is the
 * only way the three fidelities can be held together by a build rather than by
 * someone remembering.
 */
const COMPOSITION_MODULES = [
  "src/components/home/hero-geometry.ts",
  "src/components/scene/core/layout.ts",
  "src/components/scene/types/truth.ts",
];

/**
 * The still's own drawing budget, recorded in the output beside the counts it
 * actually produced.
 *
 * It is a ceiling on marks, not a target: a case with fewer records than the
 * ceiling draws all of them and says so. The three numbers are the still's
 * tier, in the same sense `runtime/tier.ts` gives the canvas one, and they are
 * here rather than there because a vector still is bounded by how much markup a
 * slow connection should carry rather than by a frame budget.
 */
const BUDGET = {
  /** One ray is one rollout. Above this the fan stops being readable and the
      inline SVG stops being cheap, which are the two things the still is for. */
  rays: 128,
  /** A series over recorded steps, whether drawn as a line or as a ribbon. */
  series: 101,
  /** Discrete marks: one per dimension, per detector, or per mutant. */
  discrete: 64,
};

// ---------------------------------------------------------------------------
// Reading, with no fallback anywhere in it
// ---------------------------------------------------------------------------

function must(path, why) {
  const p = join(ROOT, path);
  if (!existsSync(p)) {
    throw new Error(
      `build-scene-stills: ${path} is absent, and it is ${why}.\n` +
        `  There is no synthetic still. Run npm run build:scene-data first.`,
    );
  }
  return p;
}

const manifest = JSON.parse(readFileSync(must("src/data/scene/manifest.json", "the case inventory"), "utf-8"));
const captions = JSON.parse(readFileSync(must("src/data/scene/captions.json", "the sentence under every still"), "utf-8"));
const digest = JSON.parse(readFileSync(must("src/data/scene/build-digest.json", "the hash a stale still is detected by"), "utf-8"));

/**
 * Decode one payload. The layout is `src/data/schema/scene.ts`'s, and this is a
 * second reader of it rather than a shared one because that file is TypeScript
 * and this is a build script on Node 20, which cannot import it. The magic and
 * the version are checked for exactly that reason: two readers of one format
 * drift silently otherwise, and the check turns that into a throw.
 */
function readPayload(caseId) {
  const bytes = readFileSync(must(`src/data/scene/payload/${caseId}.bin`, `case "${caseId}"'s measured arrays`));
  const magic = bytes.subarray(0, 4).toString("ascii");
  if (magic !== "RLS1") {
    throw new Error(`build-scene-stills: ${caseId}.bin has magic ${JSON.stringify(magic)}, not "RLS1"`);
  }
  const formatVersion = bytes.readUInt32LE(4);
  if (formatVersion !== digest.payloadFormatVersion) {
    throw new Error(
      `build-scene-stills: ${caseId}.bin is payload format ${formatVersion} and the digest states ` +
        `${digest.payloadFormatVersion}. Regenerate the scene data before the stills.`,
    );
  }
  const headerLength = bytes.readUInt32LE(8);
  const header = JSON.parse(bytes.subarray(12, 12 + headerLength).toString("utf-8"));
  const dataStart = align8(12 + headerLength);
  const arrays = new Map();
  for (const d of header.arrays) {
    const start = dataStart + d.byteOffset;
    const slice = bytes.subarray(start, start + d.byteLength);
    const copy = new Uint8Array(slice); // aligned copy; the file offset is not
    arrays.set(
      d.name,
      d.dtype === "f32" ? new Float32Array(copy.buffer) : new Int32Array(copy.buffer),
    );
  }
  return {
    caseId,
    arrays,
    get(name) {
      const a = arrays.get(name);
      if (!a) {
        throw new Error(
          `build-scene-stills: case "${caseId}" needs array ${JSON.stringify(name)} and the payload carries ` +
            `[${[...arrays.keys()].join(", ")}]. The manifest and the payload disagree; regenerate both.`,
        );
      }
      return a;
    },
    has: (name) => arrays.has(name),
  };
}

const align8 = (n) => (n % 8 === 0 ? n : n + (8 - (n % 8)));

// ---------------------------------------------------------------------------
// Numbers into the room's coordinates
// ---------------------------------------------------------------------------

/** Fixed precision everywhere, so two runs produce byte-identical output. */
const q = (v) => Number(v.toFixed(5));

/**
 * Map a value through a declared domain onto 0..1.
 *
 * A value outside the domain THROWS rather than clamping, because every one of
 * these domains was written by the generator that produced the array from the
 * array's own extent. A value outside it means the manifest and the payload
 * came from different runs, and silently pinning it to an edge would draw a
 * shape that no record supports.
 */
function unit(value, domain, what) {
  const [lo, hi] = domain;
  /* A NON-FINITE VALUE IS AN ABSENT MEASUREMENT AND NEVER A COORDINATE.
     Both comparisons below are false for NaN, so without this line a NaN
     walked straight through the range check and came out of `toFixed` as the
     string "NaN", which `Number` turned back into NaN and `JSON.stringify`
     wrote as `null`. `detectors.alarmStep` carries a NaN for the one detector
     that never alarmed, and the still therefore had a detector marker at a
     null position: an absent reading rendered as a place on the run. Caught by
     the coordinate-range test, which is the reason it exists. */
  if (!Number.isFinite(value)) {
    throw new Error(
      `build-scene-stills: ${what} is ${value}, which is an absent value rather than a quantity. ` +
        `A case that can hold one has to say so and skip it, not map it onto the room.`,
    );
  }
  if (hi === lo) return 0.5;
  if (value < lo - 1e-6 || value > hi + 1e-6) {
    throw new Error(
      `build-scene-stills: ${what} is ${value}, outside its declared domain [${lo}, ${hi}]. ` +
        `Nothing is clamped here. Regenerate the scene data so the manifest states the domain the payload has.`,
    );
  }
  return (value - lo) / (hi - lo);
}

/** Uniform stride, first and last kept, no randomness. The manifest's method. */
function stride(length, budget) {
  if (length <= budget) return Array.from({ length }, (_, i) => i);
  const out = [];
  for (let i = 0; i < budget; i += 1) {
    out.push(Math.round((i * (length - 1)) / (budget - 1)));
  }
  return [...new Set(out)];
}

const STRIDE_METHOD =
  "uniform stride over the recorded values, first and last kept, no randomness";

/** The encoding a case declares for a quantity, or a throw naming the case. */
function encodingFor(c, quantity) {
  const e = c.encodings.find((x) => x.quantity === quantity);
  if (!e) {
    throw new Error(
      `build-scene-stills: case "${c.id}" draws ${JSON.stringify(quantity)} and declares no encoding for it. ` +
        `Every quantity a still draws has to be declared in the manifest, which is what makes the ` +
        `transform reviewable without opening this file.`,
    );
  }
  if (!e.domain) {
    throw new Error(
      `build-scene-stills: case "${c.id}"'s encoding of ${JSON.stringify(quantity)} declares no domain, ` +
        `so there is no stated range to map it onto.`,
    );
  }
  return e;
}

// ---------------------------------------------------------------------------
// The seven readouts, one per plate kind
//
// Each returns { marks, readout, note }. `marks` is what is drawn in the fan;
// `readout` is the DOM key beside it, which is where a screen reader and a
// no-JavaScript reader get the same information the geometry carries.
// ---------------------------------------------------------------------------

const BUILDERS = {
  /**
   * One band per leaf of the score tree, its centre the recorded mean and its
   * half-width the recorded standard deviation, along the run.
   */
  "RECORDED SCORE TREE"(c, p, cap) {
    const meanE = encodingFor(c, "rewards/length_reward/mean");
    const stdE = encodingFor(c, "rewards/length_reward/std");
    const mean = p.get("rewards/length_reward/mean");
    const std = p.get("rewards/length_reward/std");
    const idx = stride(mean.length, BUDGET.series);
    const points = idx.map((i) => [
      q(i / (mean.length - 1)),
      // The band sits in the upper two thirds of the fan, so its own spread has
      // somewhere to go without leaving the room.
      q(0.22 + 0.62 * unit(mean[i], meanE.domain, `${c.id} mean[${i}]`)),
      q(0.16 * unit(std[i], stdE.domain, `${c.id} std[${i}]`)),
    ]);
    return {
      marks: [{ kind: "ribbon", token: "--comp-1", label: cap.values.leafName, points }],
      readout: [
        { label: "leaves", value: String(cap.values.leafCount) },
        { label: cap.values.leafName, value: `${cap.values.leafValueMin} to ${cap.values.leafValueMax}` },
        { label: "abstained", value: `${cap.values.abstainedRolloutCount} of ${cap.values.rolloutCount}` },
      ],
      drawn: { method: STRIDE_METHOD, inputCount: mean.length, outputCount: points.length },
    };
  },

  /**
   * The mutation audit as a scale on the detector: one tick per competent
   * mutant, lit where the grader killed it. The count is the reading, so the
   * ticks are drawn at their real number and never rounded to a nicer one.
   */
  "VERIFIER AUDIT"(c, p, cap) {
    const competent = p.get("competentMutants")[0];
    const killed = p.get("killedMutants")[0];
    encodingFor(c, "competentMutants");
    encodingFor(c, "killedMutants");
    if (competent > BUDGET.discrete) {
      // 60 against a budget of 64. Stated rather than assumed, so a larger
      // audit fails here instead of silently drawing a different number.
      throw new Error(
        `build-scene-stills: case "${c.id}" has ${competent} competent mutants and the still's tick ` +
          `budget is ${BUDGET.discrete}. The tick count IS the reading, so it may not be downsampled. Raise the budget.`,
      );
    }
    const fullRead = p.get("access.full.readCount")[0];
    const fullRefused = p.get("access.full.refusedCount")[0];
    const logRead = p.get("access.log_only.readCount")[0];
    const logRefused = p.get("access.log_only.refusedCount")[0];
    const marks = [
      { kind: "ticks", token: "--beam", count: competent, lit: killed, label: "killed" },
      {
        kind: "gate",
        label: "full",
        read: fullRead,
        refused: fullRefused,
        total: fullRead + fullRefused,
      },
      {
        kind: "gate",
        label: "log only",
        read: logRead,
        refused: logRefused,
        total: logRead + logRefused,
      },
    ];
    const readout = [
      { label: "killed", value: `${killed} of ${competent}` },
      { label: "grader calls", value: String(cap.values.graderCalls) },
      { label: "read, full access", value: `${fullRead} of ${fullRead + fullRefused}` },
      { label: "read, training log only", value: `${logRead} of ${logRead + logRefused}` },
    ];
    if (p.has("metamorphicViolations")) {
      const v = p.get("metamorphicViolations")[0];
      const pairs = p.get("metamorphicApplicablePairs")[0];
      encodingFor(c, "metamorphicViolations");
      marks.push({ kind: "bar", token: "--state-bounded", label: "violations", value: v, total: pairs });
      readout.push({ label: "metamorphic violations", value: `${v} of ${pairs}` });
    }
    return { marks, readout, drawn: null };
  },

  /**
   * Twelve dimensions, each a mark at its own rank correlation. Signed, so the
   * zero line is drawn and declared rather than implied by where the marks
   * happen to fall.
   */
  "INTERVENTION FIXTURE"(c, p, cap) {
    const rhoE = encodingFor(c, "spearmanRho");
    const rho = p.get("spearmanRho");
    const nullE = encodingFor(c, "nullThreshold");
    const threshold = p.get("nullThreshold")[0];
    const zeroAt = unit(0, rhoE.domain, `${c.id} zero`);
    const points = Array.from(rho, (v, i) => [
      q((i + 0.5) / rho.length),
      q(unit(v, rhoE.domain, `${c.id} rho[${i}]`)),
    ]);
    const halfBand = q(Math.abs(unit(threshold, rhoE.domain, `${c.id} null`) - zeroAt));
    return {
      marks: [
        { kind: "zero", token: "--line-strong", y: q(zeroAt), label: "no agreement" },
        { kind: "band", token: "--line", y0: q(zeroAt - halfBand), y1: q(zeroAt + halfBand), label: "null" },
        { kind: "marks", token: "--comp-1", points, label: "dimensions" },
      ],
      readout: [
        { label: "dimensions", value: String(cap.values.dimensionCount) },
        { label: "components", value: String(cap.values.componentCount) },
        { label: "mean rank correlation", value: String(cap.values.meanRho) },
        { label: cap.values.sharpestDimension, value: String(cap.values.sharpestRho) },
      ],
      drawn: null,
      // The declared null half-width is 0.02 on a domain of two, which is under
      // a pixel at the fan's extent. It is drawn anyway rather than dropped:
      // a band too thin to see is a true statement about the threshold.
      note: `null threshold ${nullE.domain[1]}`,
    };
  },

  /**
   * One ray per rollout, its offset the advantage the estimator applied. The
   * zero line is drawn because 220 of these rollouts are exactly zero and a fan
   * with no stated zero would read as if none of them were.
   */
  "RECORDED SELECTION"(c, p, cap) {
    const advE = encodingFor(c, "advantage");
    const stepE = encodingFor(c, "step_index");
    const adv = p.get("advantage");
    const step = p.get("step_index");
    const idx = stride(adv.length, BUDGET.rays);
    const zeroAt = unit(0, advE.domain, `${c.id} zero`);
    const points = idx.map((i) => [
      q(unit(step[i], stepE.domain, `${c.id} step[${i}]`)),
      q(unit(adv[i], advE.domain, `${c.id} advantage[${i}]`)),
    ]);
    return {
      marks: [
        { kind: "zero", token: "--line-strong", y: q(zeroAt), label: "zero advantage" },
        { kind: "rays", token: "--comp-2", points, label: "rollouts" },
      ],
      readout: [
        { label: "rollouts", value: String(cap.values.rolloutCount) },
        { label: "advantage", value: `${cap.values.advantageMin} to ${cap.values.advantageMax}` },
        { label: "exactly zero", value: String(cap.values.zeroAdvantageCount) },
        { label: "abstained", value: String(cap.values.abstainedCount) },
      ],
      drawn: { method: STRIDE_METHOD, inputCount: adv.length, outputCount: points.length },
    };
  },

  /**
   * The update's clipped gradient norm over the run, with the reward it came
   * from drawn as a band of its own recorded spread beneath it.
   */
  "RECORDED UPDATE"(c, p, cap) {
    const gradE = encodingFor(c, "grad_norm_clipped");
    const rewE = encodingFor(c, "reward");
    const stdE = encodingFor(c, "reward_std");
    const grad = p.get("grad_norm_clipped");
    const reward = p.get("reward");
    const std = p.get("reward_std");
    const idx = stride(grad.length, BUDGET.series);
    const trace = idx.map((i) => [
      q(i / (grad.length - 1)),
      q(0.5 + 0.46 * unit(grad[i], gradE.domain, `${c.id} grad[${i}]`)),
    ]);
    const ribbon = idx.map((i) => [
      q(i / (grad.length - 1)),
      q(0.06 + 0.3 * unit(reward[i], rewE.domain, `${c.id} reward[${i}]`)),
      q(0.05 * unit(std[i], stdE.domain, `${c.id} reward_std[${i}]`)),
    ]);
    return {
      marks: [
        { kind: "ribbon", token: "--comp-3", label: "reward", points: ribbon },
        { kind: "trace", token: "--comp-2", label: "clipped gradient norm", points: trace },
      ],
      readout: [
        { label: "steps", value: String(cap.values.stepCount) },
        { label: "rollouts per step", value: String(cap.values.rolloutsPerStep) },
        { label: "clipped gradient norm", value: `${cap.values.gradNormMin} to ${cap.values.gradNormMax}` },
      ],
      drawn: { method: STRIDE_METHOD, inputCount: grad.length, outputCount: trace.length },
    };
  },

  /**
   * Nothing was measured. The fan is drawn empty and says so.
   *
   * This is the one case where an empty figure is the correct figure, and it is
   * why `truthMode: "schematic"` carries no encodings: the contract forbids a
   * construction from carrying a magnitude, so there is nothing here to draw
   * and inventing something would be exactly the failure the contract exists
   * to prevent.
   */
  "NO MEASUREMENT"(c) {
    if (c.encodings.length > 0) {
      throw new Error(
        `build-scene-stills: case "${c.id}" is on the no-measurement plate and declares ` +
          `${c.encodings.length} encoding(s). One of the two is wrong.`,
      );
    }
    return {
      marks: [{ kind: "absent", token: "--line-strong" }],
      readout: [],
      drawn: null,
    };
  },

  /**
   * The public series: three labelled rates over the recorded steps, the
   * transition band they cross, and the detectors that alarmed on them.
   */
  "PUBLIC TRAINING SERIES"(c, p, cap) {
    const stepsE = encodingFor(c, "steps");
    const steps = p.get("steps");
    const idx = stride(steps.length, BUDGET.series);
    const x = (i) => q(unit(steps[i], stepsE.domain, `${c.id} step[${i}]`));

    const series = [
      ["series.written", "--written", "written"],
      ["series.realized", "--realized", "realized"],
      ["series.formatOk", "--comp-2", "format ok"],
    ];
    const marks = [];

    const mid = p.get("transition.midpoint")[0];
    const width = p.get("transition.width1090")[0];
    encodingFor(c, "transition.midpoint");
    encodingFor(c, "transition.width1090");
    marks.push({
      kind: "xband",
      token: "--line",
      x0: q(unit(Math.max(stepsE.domain[0], mid - width / 2), stepsE.domain, `${c.id} band start`)),
      x1: q(unit(Math.min(stepsE.domain[1], mid + width / 2), stepsE.domain, `${c.id} band end`)),
      label: "transition",
    });

    for (const [name, token, label] of series) {
      const e = encodingFor(c, name);
      const a = p.get(name);
      marks.push({
        kind: "trace",
        token,
        label,
        points: idx.map((i) => [x(i), q(0.06 + 0.88 * unit(a[i], e.domain, `${c.id} ${name}[${i}]`))]),
      });
    }

    const alarmE = encodingFor(c, "detectors.alarmStep");
    const rateE = encodingFor(c, "detectors.surrogateRate");
    const alarm = p.get("detectors.alarmStep");
    const rate = p.get("detectors.surrogateRate");
    const shipped = p.get("detectors.shipped");

    /* A DETECTOR THAT NEVER ALARMED HAS NO PLACE ON THE RUN.
       This record carries a NaN alarm step for one of the four and a NaN
       surrogate rate for another. Both are absent readings. A mark drawn for
       either would be a position asserted about a detector that has none, so
       they are not drawn, and the count of them is stated in the readout: an
       absence that is not reported is an absence nobody can see. */
    const drawable = [];
    let absent = 0;
    for (let i = 0; i < alarm.length; i += 1) {
      if (!Number.isFinite(alarm[i]) || !Number.isFinite(rate[i])) {
        absent += 1;
        continue;
      }
      drawable.push([
        q(unit(alarm[i], alarmE.domain, `${c.id} alarm[${i}]`)),
        q(0.06 + 0.88 * unit(rate[i], rateE.domain, `${c.id} rate[${i}]`)),
        shipped[i] === 1 ? 1 : 0,
      ]);
    }
    marks.push({ kind: "marks", token: "--alarm", label: "detectors", points: drawable });

    return {
      marks,
      readout: [
        { label: "labelled rollouts", value: String(cap.values.rolloutCount) },
        { label: "drawn points", value: String(idx.length) },
        { label: "transition midpoint", value: `step ${cap.values.transitionMidpoint}` },
        { label: "promoted signal alarms", value: `step ${cap.values.promotedAlarmStep}` },
        { label: "fires on in-control surrogates", value: `${(cap.values.promotedSurrogateRate * 100).toFixed(1)}%` },
        { label: "detectors drawn", value: `${drawable.length} of ${alarm.length}` },
        ...(absent
          ? [{ label: "no alarm or rate recorded", value: `${absent} of ${alarm.length}` }]
          : []),
      ],
      drawn: { method: STRIDE_METHOD, inputCount: steps.length, outputCount: idx.length },
    };
  },
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const sha = (s) => createHash("sha256").update(s).digest("hex");

function build() {
  const stills = {};
  for (const c of manifest.cases) {
    const builder = BUILDERS[c.plateKind];
    if (!builder) {
      throw new Error(
        `build-scene-stills: case "${c.id}" is on plate kind ${JSON.stringify(c.plateKind)} and no builder ` +
          `draws it. A case with no still is a state a reader without WebGL never sees, so this is fatal ` +
          `rather than skipped. Builders: ${Object.keys(BUILDERS).map((k) => JSON.stringify(k)).join(", ")}.`,
      );
    }
    const cap = captions.captions[c.id];
    if (!cap) {
      throw new Error(
        `build-scene-stills: case "${c.id}" has no caption in captions.json. Every still states what it ` +
          `shows in words as well as in geometry; there is no unlabelled still.`,
      );
    }
    const recorded = digest.cases[c.id];
    if (!recorded || recorded.contentHash !== c.contentHash) {
      throw new Error(
        `build-scene-stills: case "${c.id}"'s content hash disagrees between the manifest and the build ` +
          `digest. The scene data is half regenerated; run npm run build:scene-data.`,
      );
    }

    const built = builder(c, readPayload(c.id), cap);
    stills[c.id] = {
      caseId: c.id,
      state: c.state,
      plateKind: c.plateKind,
      publicLabel: c.publicLabel,
      truthMode: c.truthMode,
      contentHash: c.contentHash,
      caption: cap.text,
      scope: c.scope,
      caveat: c.caveat,
      sourcePath: c.source.repositoryPath ?? c.source.publicUrl ?? null,
      sourceArtifact: c.source.artifact ?? null,
      drawn: built.drawn ?? null,
      note: built.note ?? null,
      readout: built.readout,
      marks: built.marks,
    };
  }

  // States in the frozen order, each with its cases in manifest order. The
  // first case of a state is the one a still shows before anyone chooses.
  const order = [];
  for (const c of manifest.cases) if (!order.includes(c.state)) order.push(c.state);
  const states = order.map((id) => {
    const cases = manifest.cases.filter((c) => c.state === id).map((c) => c.id);
    return { id, defaultCase: cases[0], cases };
  });

  const index = {
    version: 1,
    generatedBy: "scripts/dev/build-scene-stills.mjs",
    manifestVersion: manifest.version,
    payloadFormatVersion: digest.payloadFormatVersion,
    manifestDigest: digest.manifestDigest,
    budget: BUDGET,
    note:
      "Geometry for the composed stills, normalised into the room's own coordinates: x runs 0 at the " +
      "dispersing element's exit face to 1 at the detector plane, y runs 0 on the optical axis to 1 at " +
      "the top of the fan's extent. Where the bench sits is not here; the component reads that from " +
      "hero-geometry.ts, which is the same module the hand-authored room and the live scene read, and " +
      "is what lets gate 20 hold the three fidelities to 8px.",
    states,
    stills,
  };

  const lock = {
    note:
      "What the stills on disk were generated from. `npm run build:scene-stills -- --check` recomputes " +
      "these and fails when one has moved, so a changed upstream artifact cannot leave a stale still " +
      "in the one path a reader without WebGL actually sees.",
    manifestDigest: digest.manifestDigest,
    payloadFormatVersion: digest.payloadFormatVersion,
    composition: Object.fromEntries(
      COMPOSITION_MODULES.map((p) => [p, sha(readFileSync(must(p, "part of the room's composition"), "utf-8"))]),
    ),
    cases: Object.fromEntries(manifest.cases.map((c) => [c.id, c.contentHash])),
    indexDigest: sha(JSON.stringify(index)),
  };

  return { index, lock };
}

const { index, lock } = build();
const indexText = JSON.stringify(index, null, 1) + "\n";
const lockText = JSON.stringify(lock, null, 1) + "\n";

if (CHECK) {
  const problems = [];
  for (const [path, want] of [
    [OUT_INDEX, indexText],
    [OUT_LOCK, lockText],
  ]) {
    if (!existsSync(path)) {
      problems.push(`${path.slice(ROOT.length + 1)} is absent`);
      continue;
    }
    const have = readFileSync(path, "utf-8");
    if (have !== want) problems.push(`${path.slice(ROOT.length + 1)} is stale`);
  }
  if (problems.length) {
    // Say WHICH input moved. "Stale" alone sends the next person to diff a
    // 200KB generated file by eye.
    const onDisk = existsSync(OUT_LOCK) ? JSON.parse(readFileSync(OUT_LOCK, "utf-8")) : null;
    const moved = [];
    if (onDisk) {
      if (onDisk.manifestDigest !== lock.manifestDigest) moved.push("the scene manifest");
      for (const [p, h] of Object.entries(lock.composition)) {
        if (onDisk.composition?.[p] !== h) moved.push(p);
      }
      for (const [id, h] of Object.entries(lock.cases)) {
        if (onDisk.cases?.[id] !== h) moved.push(`case ${id}`);
      }
    }
    console.error(
      `FAIL scene stills: ${problems.join("; ")}.\n` +
        (moved.length ? `  Moved since the stills were written: ${moved.join(", ")}.\n` : "") +
        `  Run: npm run build:scene-stills\n`,
    );
    process.exit(1);
  }
  console.log(
    `scene stills: ${Object.keys(index.stills).length} case(s) across ${index.states.length} state(s), up to date`,
  );
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_INDEX, indexText);
writeFileSync(OUT_LOCK, lockText);
console.log(
  `scene stills: wrote ${Object.keys(index.stills).length} case(s) across ${index.states.length} state(s)\n` +
    `  ${OUT_INDEX.slice(ROOT.length + 1)}  ${indexText.length} bytes\n` +
    `  ${OUT_LOCK.slice(ROOT.length + 1)}  index digest ${lock.indexDigest.slice(0, 12)}`,
);
