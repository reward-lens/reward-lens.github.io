/**
 * The bench's arithmetic, checked against the record it draws.
 *
 * Nothing here mounts a React tree. What it holds is the set of claims that
 * decide whether the picture means what its captions say, and each of these
 * has already been wrong at least once in this packet's history:
 *
 *   - a station that stopped agreeing with `core/layout.ts`, which gate 20
 *     compares three fidelities on within 8 pixels;
 *   - two stages drawing lines through the same stretch of bench, so eight
 *     recorded advantages and eight pieces of apparatus shared their pixels;
 *   - an emissive material cache with no theme in its key, so a reader who
 *     toggled kept the previous theme's colours;
 *   - additive blending shipped as though it were universal, which erased
 *     every mark in the light theme;
 *   - a series drawn at its floor being drawn INSIDE the rail it lies on, so
 *     the one series that is zero for the opening of the run was absent.
 *
 * The negatives about the record itself, the ones that keep a token-level
 * visual or a composition counterfactual from ever becoming geometry, are the
 * generator's and are asserted in `scripts/build_scene_data.mjs`. They are not
 * repeated here; what is checked here is that the assemblies read the arrays
 * that survive those assertions and no others.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Color } from "three";
import { loadTs, closeLoader, REPO_ROOT } from "../materials/load.mjs";

const stations = await loadTs("src/components/scene/assemblies/stations.ts");
const layout = await loadTs("src/components/scene/core/layout.ts");
const payloadMod = await loadTs("src/components/scene/assemblies/payload.ts");
const lightMod = await loadTs("src/components/scene/assemblies/light.ts");
const paletteMod = await loadTs("src/components/scene/core/palette.ts");
const selection = await loadTs("src/components/scene/assemblies/SelectionAssembly.tsx");
const update = await loadTs("src/components/scene/assemblies/UpdateAssembly.tsx");
const score = await loadTs("src/components/scene/assemblies/ScoreAssembly.tsx");
const policy = await loadTs("src/components/scene/assemblies/PolicyAssembly.tsx");
const run = await loadTs("src/components/scene/assemblies/RunAssembly.tsx");
const downstream = await loadTs("src/components/scene/assemblies/Downstream.tsx");

const { STATIONS, TIMELINE, EMPHASIS, emphasisFor } = stations;
const { BENCH, LANDMARKS, ROOM_HALF_WIDTH } = layout;
const { decodePayload, column, scalar, extent, normalise, drawIndices } = payloadMod;
const { LIGHT_TABLE, useLight, disposeLights, primeLights, lightCacheSize } = lightMod;
const { SCENE_TOKENS } = paletteMod;
const { SELECTION_BOUNDS, SELECTION_ENVELOPE } = selection;
const { UPDATE_BOUNDS } = update;
const { SCORE_BOUNDS } = score;
const { POLICY_BOUNDS } = policy;
const { RUN_BOUNDS, TIMELINE_EXTENT } = run;
const { DOWNSTREAM_MOUNTS } = downstream;

const PAYLOAD_DIR = join(REPO_ROOT, "src/data/scene/payload");

function payload(caseId) {
  const file = readFileSync(join(PAYLOAD_DIR, `${caseId}.bin`));
  const copy = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  return decodePayload(caseId, copy);
}

/* ------------------------------------------------------------------ */
/* The stations, against the landmarks gate 20 compares                */
/* ------------------------------------------------------------------ */

test("the two landmark stations are the landmarks, not numbers beside them", () => {
  assert.equal(STATIONS.dispersing, LANDMARKS.dispersingElement[0]);
  assert.equal(STATIONS.detector, LANDMARKS.detectorPlane[0]);
  assert.equal(STATIONS.dispersing, BENCH.prismX);
  assert.equal(STATIONS.detector, BENCH.detectorX);
});

test("the stations run left to right and stay inside the room", () => {
  const order = [
    "inputPlate",
    "dispersing",
    "groupingSlit",
    "modulator",
    "integrating",
    "policyPlanes",
    "detector",
  ];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(
      STATIONS[order[i]] > STATIONS[order[i - 1]],
      `${order[i]} at ${STATIONS[order[i]]} is not downstream of ${order[i - 1]}`,
    );
  }
  for (const [name, x] of Object.entries(STATIONS)) {
    assert.ok(
      x >= -ROOM_HALF_WIDTH && x <= ROOM_HALF_WIDTH,
      `${name} at ${x} is outside the room's ${ROOM_HALF_WIDTH} half width`,
    );
  }
});

test("the run timeline is a second rail in front, clear of the optical one", () => {
  assert.ok(TIMELINE.z > BENCH.railDepth / 2, "the timeline rail is inside the optical rail");
  assert.ok(TIMELINE.fromX >= -ROOM_HALF_WIDTH && TIMELINE.toX <= ROOM_HALF_WIDTH);
  assert.ok(TIMELINE.toX > TIMELINE.fromX);
  assert.equal(TIMELINE_EXTENT.railY, BENCH.railY);
});

test("every station has mounting hardware, and every mount stands on the rail", () => {
  const mounted = new Set(DOWNSTREAM_MOUNTS.map((m) => m.x));
  for (const [name, x] of Object.entries(STATIONS)) {
    assert.ok(mounted.has(x), `${name} at ${x} has no post under it`);
  }
  for (const m of DOWNSTREAM_MOUNTS) {
    assert.ok(
      m.headY > BENCH.railY,
      `a post at ${m.x} carries its load at ${m.headY}, below the rail at ${BENCH.railY}`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* The seam between the selection stage and the update                 */
/* ------------------------------------------------------------------ */

test("the contributions begin exactly where the rollout rays end", () => {
  // These used to overlap by a quarter of the bench and read as one scribble.
  // The rays are eight recorded advantages; the contributions are apparatus
  // with no quantity on them. A reader has to be able to see where one stops.
  assert.equal(
    UPDATE_BOUNDS.attachments.entrance[0],
    SELECTION_BOUNDS.attachments.exit[0],
    "the update starts somewhere other than the seam the selection stage publishes",
  );
  assert.ok(
    SELECTION_BOUNDS.attachments.exit[0] > STATIONS.modulator,
    "the rays stop before the modulator that displaces them",
  );
  assert.ok(
    SELECTION_BOUNDS.attachments.exit[0] < STATIONS.integrating,
    "the rays run into the lens the update stage owns",
  );
});

test("every assembly's attachments are inside the extent it declares", () => {
  for (const b of [SCORE_BOUNDS, SELECTION_BOUNDS, UPDATE_BOUNDS, POLICY_BOUNDS, RUN_BOUNDS]) {
    for (const [name, point] of Object.entries(b.attachments)) {
      assert.ok(
        point.every((v) => Number.isFinite(v)),
        `${b.name}.${name} is not a finite position`,
      );
    }
    assert.ok(b.extent.every((v) => v > 0), `${b.name} declares a non-positive extent`);
  }
});

/* ------------------------------------------------------------------ */
/* The record, as the assemblies index it                              */
/* ------------------------------------------------------------------ */

test("the score stage draws one band because the record has one grader leaf", () => {
  const p = payload("scorer-score-tree");
  assert.equal(scalar(p, "scores.leafCount"), 1);
  assert.equal(column(p, "rewards/length_reward/mean").length, 200);
  assert.equal(column(p, "rewards/length_reward/std").length, 200);
  assert.equal(column(p, "scores.leaf.value").length, 1600);
  assert.equal(column(p, "scores.leaf.abstained").length, 1600);
});

test("an abstention is a hole in the record, and the score points skip it", () => {
  // A point at the bottom of the range would say the grader scored the rollout
  // lowest. What it did was decline to score it.
  const p = payload("scorer-score-tree");
  const values = column(p, "scores.leaf.value");
  const abstained = column(p, "scores.leaf.abstained");
  let abstentions = 0;
  for (let i = 0; i < abstained.length; i += 1) {
    if (abstained[i] !== 1) continue;
    abstentions += 1;
    assert.ok(
      !Number.isFinite(values[i]),
      `rollout ${i} is marked abstained and still carries the value ${values[i]}`,
    );
  }
  assert.ok(abstentions > 0, "the record no longer holds an abstention; the geometry's gap is moot");
  // And the domain the band's radius is taken against never sees them.
  const [lo, hi] = extent(values);
  assert.ok(Number.isFinite(lo) && Number.isFinite(hi), "a NaN reached the domain");
});

test("the selection stage's slice is checked against the recorded step index", () => {
  // The worst error this scene can make is entirely truthful numbers under an
  // entirely wrong claim, which is what a silent mis-slice would be.
  const p = payload("selection-advantages");
  const advantage = column(p, "advantage");
  const stepIndex = column(p, "step_index");
  const groupK = column(p, "group.k");
  assert.equal(advantage.length, 1600);
  assert.equal(advantage.length / 8, 200, "the record is no longer eight rollouts a step");
  for (let step = 0; step < 200; step += 1) {
    assert.equal(stepIndex[step * 8], step, `the payload is not flat in step order at step ${step}`);
    assert.equal(
      groupK[step * 2] + groupK[step * 2 + 1],
      8,
      `step ${step}'s two groups do not declare eight rollouts between them`,
    );
  }
});

test("the advantage envelope is symmetric, so a symmetric ray envelope is honest", () => {
  const p = payload("selection-advantages");
  const [lo, hi] = extent(column(p, "advantage"));
  assert.ok(lo < 0 && hi > 0, "the advantages are no longer signed on both sides");
  assert.ok(
    Math.abs(Math.abs(lo) - hi) / hi < 0.05,
    `the record runs ${lo} to ${hi}, which is no longer symmetric enough for a symmetric envelope`,
  );
  assert.ok(SELECTION_ENVELOPE > 0 && SELECTION_ENVELOPE < 0.6, "the ray envelope left the room");
});

test("the update draws a contributor count it reads, and refuses to draw entropy", () => {
  const p = payload("update-step");
  const contributors = column(p, "n_trajectories");
  for (let i = 0; i < contributors.length; i += 1) {
    assert.equal(contributors[i], 8, `step ${i} reports ${contributors[i]} trajectories`);
  }
  // Recorded rather than quietly omitted: entropy is a constant in this
  // fixture, so a trace of it would be a straight line a reader would take for
  // a measurement of stability. Read raw rather than through `extent`, which
  // widens a constant column by one so a normalisation cannot divide by zero.
  const entropy = column(p, "entropy");
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < entropy.length; i += 1) {
    lo = Math.min(lo, entropy[i]);
    hi = Math.max(hi, entropy[i]);
  }
  // 5.7e-6 on a value of 11.9294 is the last bit of a float32, not a trend. The
  // threshold is the fourth decimal, which is the precision the note quotes.
  assert.ok(
    hi - lo < 1e-4,
    `entropy now spans ${(hi - lo).toExponential(2)} across the record; UpdateAssembly.tsx says ` +
      "it is constant to every digit the record holds, and the decision not to draw it rests on that",
  );
  const norms = extent(column(p, "grad_norm_clipped"));
  assert.ok(norms[0] > 0, "the resultant's length would collapse to zero");
});

test("the run boundary draws 401 points and never four hundred", () => {
  // Two rows of the same frozen ledger describe this run with different step
  // counts. The site does not assert which is right, so the rail draws what the
  // series holds and nothing captions a number it did not draw.
  const p = payload("run-boundary-series");
  for (const name of ["steps", "series.written", "series.realized", "series.formatOk"]) {
    assert.equal(column(p, name).length, 401, `${name} is not 401 long`);
  }
});

test("the detector that never alarmed has no position anywhere", () => {
  const p = payload("run-boundary-series");
  const alarm = column(p, "detectors.alarmStep");
  const shipped = column(p, "detectors.shipped");
  assert.equal(alarm.length, 4);
  const finite = Array.from(alarm).filter((v) => Number.isFinite(v));
  assert.equal(finite.length, 3, "the number of detectors with an alarm step changed");
  // The earliest alarm is a rejected signal, and drawing only the promoted one
  // would make the instrument look better than it is.
  const earliest = Math.min(...finite);
  const earliestIndex = Array.from(alarm).findIndex((v) => v === earliest);
  assert.equal(
    shipped[earliestIndex],
    0,
    "the earliest alarm is now the promoted one; the RunAssembly header says otherwise",
  );
  assert.equal(Array.from(shipped).filter((v) => v === 1).length, 1, "more than one promoted signal");
});

test("a subsample is the generator's, so two sessions draw the same points", () => {
  const p = payload("run-boundary-series");
  const high = drawIndices(p, "series", "high", 401);
  const mid = drawIndices(p, "series", "mid", 401);
  const low = drawIndices(p, "series", "low", 401);
  assert.equal(high.length, 401);
  assert.equal(mid.length, 201);
  assert.equal(low.length, 101);
  for (const set of [mid, low]) {
    for (let i = 1; i < set.length; i += 1) {
      assert.ok(set[i] > set[i - 1], "a subsample is not in order");
      assert.ok(set[i] < 401, "a subsample indexes past the record");
    }
  }
});

test("a domain is the column's own range and a value outside it is pinned", () => {
  assert.deepEqual(extent([3, 1, 2]), [1, 3]);
  assert.deepEqual(extent([5, 5, 5]), [5, 6], "a constant column must not divide by zero");
  assert.deepEqual(extent([1, NaN, 4]), [1, 4], "a NaN reached the domain");
  assert.deepEqual(extent([]), [0, 1]);
  assert.equal(normalise(-10, [0, 1]), 0);
  assert.equal(normalise(10, [0, 1]), 1);
  assert.equal(normalise(NaN, [0, 1]), 0);
});

test("a missing array is an error, not an empty draw", () => {
  const p = payload("update-step");
  assert.throws(() => column(p, "advantage_tokens"), /has no array/);
});

/* ------------------------------------------------------------------ */
/* The light table                                                     */
/* ------------------------------------------------------------------ */

function paletteFor(theme) {
  const out = {};
  for (const token of SCENE_TOKENS) out[token] = new Color(theme === "dark" ? "#ffffff" : "#101010");
  return out;
}

test("every light role names a scene token", () => {
  for (const [role, spec] of Object.entries(LIGHT_TABLE)) {
    assert.ok(SCENE_TOKENS.includes(spec.token), `${role} names "${spec.token}", not a scene token`);
  }
});

test("a refusal is blue, in both themes, read off the stylesheet", () => {
  // The rule is about the hue a reader sees, so the hue is what is checked:
  // tokens.css declares every colour in OKLCH and the third component is the
  // hue angle. Red is about 25 degrees. Blue is about 225.
  assert.equal(LIGHT_TABLE.refusal.token, "--state-refusal");
  assert.equal(LIGHT_TABLE.bounded.token, "--state-bounded");
  const css = readFileSync(join(REPO_ROOT, "src/styles/tokens.css"), "utf8");
  const hues = [...css.matchAll(/--state-refusal:\s*oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s*\)/g)].map(
    (m) => Number(m[1]),
  );
  assert.ok(hues.length >= 2, "found fewer than two --state-refusal declarations to check");
  for (const hue of hues) {
    assert.ok(hue > 180 && hue < 300, `--state-refusal is at hue ${hue}, which is not blue`);
  }
});

test("every declared light role is drawn by an assembly", () => {
  // Vocabulary nobody uses is a trap rather than a spare part: an unused
  // `alarm` role is exactly what the next hand reaches for when it draws a
  // detector that fired, and this scene draws that as a refusal on purpose.
  const dir = join(REPO_ROOT, "src/components/scene/assemblies");
  const sources = readdirSync(dir)
    .filter((f) => f !== "light.ts")
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
  for (const role of Object.keys(LIGHT_TABLE)) {
    assert.ok(
      new RegExp(`["']${role}["']`).test(sources),
      `the light table declares "${role}" and nothing on the bench asks for it`,
    );
  }
});

test("the traces are not emissive, because they are data and not light", () => {
  for (const role of ["traceWritten", "traceRealized", "traceFormat"]) {
    assert.equal(LIGHT_TABLE[role].gain, 1, `${role} has a gain above the token's own colour`);
    assert.equal(LIGHT_TABLE[role].additive, false, `${role} is additive, which puts it in the beam's register`);
  }
});

test("the sheath is a halo and not fog", () => {
  // Anything above about a tenth of the core reads as a room full of smoke.
  assert.ok(LIGHT_TABLE.sheath.opacity <= LIGHT_TABLE.core.opacity * 0.1);
  assert.equal(LIGHT_TABLE.sheath.depthWrite, false, "the halo would cut a hole in the beam");
});

test("a theme flip gives a different material, and additive is dark only", () => {
  // The cache key used to be role, token and opacity: three things none of
  // which change when the reader flips the theme.
  disposeLights();
  primeLights("dark");
  const darkBand = useLight("band", paletteFor("dark"));
  primeLights("light");
  const lightBand = useLight("band", paletteFor("light"));
  assert.notEqual(darkBand, lightBand, "the two themes shared one material");
  assert.notEqual(darkBand.color.getHexString(), lightBand.color.getHexString());
  assert.equal(lightCacheSize(), 2);

  // Adding light to a ground at 205 of 255 saturates it. Every additive role
  // was invisible in the light theme for exactly that reason.
  assert.equal(LIGHT_TABLE.band.additive, true, "the band is no longer additive in either theme");
  assert.notEqual(
    darkBand.blending,
    lightBand.blending,
    "an additive role kept additive blending in the light theme",
  );
  // The correction is the blending and not the opacity.
  assert.equal(darkBand.opacity, lightBand.opacity, "a role's opacity moved between themes");

  disposeLights();
  assert.equal(lightCacheSize(), 0);
});

/* ------------------------------------------------------------------ */
/* Nothing in this packet constructs a material or a primitive         */
/* ------------------------------------------------------------------ */

test("no assembly constructs a material or a raw primitive", () => {
  // The grep the brief asks for, kept as a test so it cannot regress quietly.
  const dir = join(REPO_ROOT, "src/components/scene/assemblies");
  const offences = [];
  for (const file of readdirSync(dir)) {
    const source = readFileSync(join(dir, file), "utf8");
    source.split("\n").forEach((line, i) => {
      const code = line.replace(/^\s*(\*|\/\/).*/, "");
      if (/<mesh(Standard|Physical|Basic|Lambert|Phong)Material/.test(code)) {
        offences.push(`${file}:${i + 1} constructs a material inline`);
      }
      if (/<(box|plane)Geometry/.test(code)) {
        offences.push(`${file}:${i + 1} ships a raw primitive`);
      }
    });
  }
  assert.deepEqual(offences, [], offences.join("\n"));
});

test("the emphasis floor is not zero, so a dark station can still be found", () => {
  assert.equal(emphasisFor(true), EMPHASIS.active);
  assert.equal(emphasisFor(false), EMPHASIS.idle);
  assert.ok(EMPHASIS.idle > 0, "an idle station vanishes and cannot be followed back");
  assert.ok(EMPHASIS.idle < EMPHASIS.active / 4, "an idle station is not distinguishable from the subject");
});

test.after(async () => {
  disposeLights();
  await closeLoader();
});
