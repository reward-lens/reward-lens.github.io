/**
 * The five-state machine, the camera path and the pose interpolation.
 *
 * These run in Node with no browser and no GPU, which is the reason the state
 * machine is data in the first place. Every assertion here describes something
 * a reader would notice and a screenshot would not catch: a state that snaps
 * instead of interpolating, a pose that does not come back when the reader
 * scrolls up, a camera that corners at a keyframe, or an object with no
 * measurement behind it acquiring a data mix because somebody filled in a
 * table.
 *
 * Run with `node --test tests/scene/`.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { loadTs, closeLoader } from "../materials/load.mjs";

const states = await loadTs("src/components/scene/runtime/states.ts");
const poseModule = await loadTs("src/components/scene/runtime/pose.ts");
const bridgeModule = await loadTs("src/components/scene/runtime/bridge.ts");
const truth = await loadTs("src/components/scene/types/truth.ts");
const manifest = JSON.parse(
  await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../../../src/data/scene/manifest.json", import.meta.url), "utf8"),
  ),
);

after(() => closeLoader());

const { STATE_DEFS, STATE_ORDER, ASSEMBLY_CASE, ALL_CASES, instrumentPoseAt, globalProgress } =
  states;

const objectOf = (visualProperty) => {
  const dot = visualProperty.indexOf(".");
  return dot < 0 ? visualProperty : visualProperty.slice(0, dot);
};

/** Every position a reader can stop at, sampled densely enough to catch a gap. */
function* everyPosition(steps = 40) {
  for (const id of STATE_ORDER) {
    for (let i = 0; i <= steps; i += 1) yield [id, i / steps];
  }
}

test("the five states are the frozen ones, in order, and each has a definition", () => {
  assert.deepEqual([...STATE_ORDER], [...truth.INSTRUMENT_STATES]);
  for (const id of STATE_ORDER) {
    assert.ok(STATE_DEFS[id], `no definition for state "${id}"`);
    assert.equal(STATE_DEFS[id].id, id);
    assert.ok(
      STATE_DEFS[id].cases.length > 0,
      `state "${id}" names no case, so its source plate would have nothing to state`,
    );
  }
});

test("every case the movement can reach exists in the generated manifest, and none is orphaned", () => {
  const generated = new Set(manifest.cases.map((c) => c.id));
  for (const id of ALL_CASES) {
    assert.ok(
      generated.has(id),
      `state table names case "${id}" and scripts/build_scene_data.mjs does not generate it`,
    );
  }
  for (const c of manifest.cases) {
    assert.ok(
      ALL_CASES.includes(c.id),
      `the generator produces case "${c.id}" and no state can show it, so a record ships that ` +
        `nothing on the site can reach`,
    );
    assert.equal(
      STATE_DEFS[c.state].cases.includes(c.id),
      true,
      `case "${c.id}" declares state "${c.state}" and that state's case list does not contain it`,
    );
  }
});

test("every object the manifest draws has a pose, and every posed object is declared", () => {
  const drawn = new Set();
  for (const c of manifest.cases) for (const e of c.encodings) drawn.add(objectOf(e.visualProperty));

  const posed = new Set();
  for (const id of STATE_ORDER) for (const key of Object.keys(STATE_DEFS[id].assemblies)) posed.add(key);

  for (const object of drawn) {
    assert.ok(
      ASSEMBLY_CASE[object] !== undefined,
      `the manifest draws "${object}" and runtime/states.ts does not declare which case it reads`,
    );
    assert.ok(posed.has(object), `the manifest draws "${object}" and no state poses it`);
  }
  for (const object of posed) {
    assert.ok(
      ASSEMBLY_CASE[object] !== undefined,
      `a state poses "${object}" and ASSEMBLY_CASE does not declare it`,
    );
  }
});

test("an object with no measured case never acquires a data mix, anywhere in the movement", () => {
  const unmeasured = Object.entries(ASSEMBLY_CASE)
    .filter(([, caseId]) => caseId === null)
    .map(([object]) => object);
  assert.ok(
    unmeasured.length > 0,
    "the response state is schematic by design, so at least one object must be declared unmeasured",
  );

  for (const [id, local] of everyPosition()) {
    const { assemblies } = instrumentPoseAt(id, local);
    for (const object of unmeasured) {
      const pose = assemblies[object];
      if (!pose) continue;
      assert.equal(
        pose.dataMix,
        0,
        `"${object}" has no measured case and its data mix is ${pose.dataMix} at ${id} ${local}. ` +
          `The response state's content is the negative; a construction that mixes toward measured ` +
          `geometry is the invention EVIDENCE-VERDICTS.md §7 forbids.`,
      );
    }
  }
});

test("an intermediate position is interpolated, not snapped to either keyframe", () => {
  const here = instrumentPoseAt("selection", 0);
  const half = instrumentPoseAt("selection", 0.5);
  const there = instrumentPoseAt("update", 0);

  // The camera has actually moved, and is between the two, on every axis that
  // differs between the endpoints.
  for (const axis of [0, 1, 2]) {
    const a = here.camera.position[axis];
    const b = there.camera.position[axis];
    if (Math.abs(a - b) < 1e-6) continue;
    const mid = half.camera.position[axis];
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    assert.ok(
      mid > lo && mid < hi,
      `camera axis ${axis} at the midpoint is ${mid}, outside the endpoints ${lo}..${hi}: the ` +
        `movement is snapping rather than interpolating`,
    );
  }

  // An assembly whose opacity differs between the two states is strictly
  // between them at the midpoint.
  const a = here.assemblies.RolloutRay;
  const b = there.assemblies.RolloutRay;
  const m = half.assemblies.RolloutRay;
  assert.notEqual(a.opacity, b.opacity, "the fixture for this assertion needs two differing poses");
  assert.ok(
    m.opacity > Math.min(a.opacity, b.opacity) && m.opacity < Math.max(a.opacity, b.opacity),
    `RolloutRay opacity at the midpoint is ${m.opacity}, not between ${a.opacity} and ${b.opacity}`,
  );
});

test("scrolling back returns every object to the pose it held", () => {
  const forward = [];
  for (const [id, local] of everyPosition(20)) forward.push([id, local, instrumentPoseAt(id, local)]);

  const backward = [...forward].reverse();
  for (const [id, local, expected] of backward) {
    const again = instrumentPoseAt(id, local);
    assert.deepEqual(
      again.camera,
      expected.camera,
      `the camera at ${id} ${local} differs on the way back up, so the path carries history`,
    );
    assert.deepEqual(
      again.assemblies,
      expected.assemblies,
      `an assembly at ${id} ${local} differs on the way back up`,
    );
  }
});

test("the camera path is continuous: no sample corners against its neighbour", () => {
  const samples = [];
  const steps = 400;
  for (let i = 0; i <= steps; i += 1) {
    const p = i / steps;
    const span = STATE_ORDER.length - 1;
    const scaled = p * span;
    const index = Math.min(Math.floor(scaled), span - 1);
    samples.push(instrumentPoseAt(STATE_ORDER[index], scaled - index).camera.position);
  }

  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const steps2 = samples.slice(1).map((p, i) => distance(samples[i], p));
  const mean = steps2.reduce((a, b) => a + b, 0) / steps2.length;
  for (let i = 0; i < steps2.length; i += 1) {
    assert.ok(
      steps2[i] < mean * 6,
      `the camera jumps ${steps2[i].toFixed(4)} units between samples ${i} and ${i + 1}, against a ` +
        `mean step of ${mean.toFixed(4)}: that is a corner in the path, not a curve`,
    );
  }
});

test("the lens never opens past the hero's field of view", () => {
  for (const [id, local] of everyPosition()) {
    const { camera } = instrumentPoseAt(id, local);
    assert.ok(
      camera.fov <= 26 + 1e-9,
      `field of view is ${camera.fov} at ${id} ${local}. 26 is the hero's and is the difference ` +
        `between an instrument and a game camera; the movement narrows and never widens.`,
    );
    assert.ok(camera.fov >= 20, `field of view is ${camera.fov} at ${id} ${local}, implausibly long`);
  }
});

test("exposure is declared and constant, so nothing fights the pipeline for it", () => {
  const levels = new Set();
  for (const [id, local] of everyPosition()) levels.add(instrumentPoseAt(id, local).camera.exposure);
  assert.deepEqual(
    [...levels],
    [1],
    "a state declares an exposure other than 1.00. The render pipeline authors exposure per theme " +
      "against measured surface levels; a second writer would drift from it silently.",
  );
});

test("global progress runs 0 to 1 and never goes backwards while the reader goes forwards", () => {
  let previous = -1;
  for (const [id, local] of everyPosition(25)) {
    const p = globalProgress(id, local);
    assert.ok(p >= 0 && p <= 1, `progress ${p} outside 0..1 at ${id} ${local}`);
    assert.ok(p >= previous - 1e-12, `progress fell from ${previous} to ${p} at ${id} ${local}`);
    previous = p;
  }
  assert.equal(globalProgress(STATE_ORDER[0], 0), 0);
  assert.equal(globalProgress(STATE_ORDER[STATE_ORDER.length - 1], 1), 1);
});

test("the spline passes exactly through its control points", () => {
  const points = [
    [0, 0, 0],
    [1, 2, 3],
    [4, 1, 2],
  ];
  assert.deepEqual(poseModule.catmullRom(points, 0), [0, 0, 0]);
  assert.deepEqual(poseModule.catmullRom(points, 1), [4, 1, 2]);
  const mid = poseModule.catmullRom(points, 0.5);
  assert.ok(mid.every(Number.isFinite));
});

test("euler interpolation is valid here: no pose turns far enough to need a quaternion", () => {
  // pose.ts interpolates rotation per component, which is only correct while no
  // assembly rotates by more than a right angle on more than one axis between
  // two states. This is that promise, checked rather than commented.
  const quarter = Math.PI / 2;
  for (let i = 0; i < STATE_ORDER.length - 1; i += 1) {
    const here = STATE_DEFS[STATE_ORDER[i]].assemblies;
    const there = STATE_DEFS[STATE_ORDER[i + 1]].assemblies;
    for (const key of Object.keys(here)) {
      const b = there[key];
      if (!b) continue;
      const turning = here[key].rotation
        .map((v, axis) => Math.abs(v - b.rotation[axis]))
        .filter((d) => d > quarter);
      assert.ok(
        turning.length <= 1,
        `"${key}" turns more than a right angle on ${turning.length} axes between ` +
          `${STATE_ORDER[i]} and ${STATE_ORDER[i + 1]}; per-component euler interpolation will ` +
          `gimbal through a wrong orientation. Give it a quaternion path.`,
      );
    }
  }
});

test("the bridge clamps, reconciles and notifies, and holds nothing but data", () => {
  const bridge = bridgeModule.createBridge();
  const seen = [];
  const stop = bridge.subscribe((s) => seen.push(s));
  assert.equal(seen.length, 1, "subscribing delivers the current state immediately");

  bridge.setState({ localProgress: 5 });
  assert.equal(bridge.read().localProgress, 1, "progress above 1 is clamped, not wrapped");
  bridge.setState({ localProgress: -3 });
  assert.equal(bridge.read().localProgress, 0);

  const before = seen.length;
  bridge.setState({ localProgress: 0 });
  assert.equal(seen.length, before, "a set that changes nothing must not notify");

  stop();
  bridge.setState({ localProgress: 0.5 });
  assert.equal(seen.length, before, "unsubscribing stops delivery");

  for (const value of Object.values(bridge.read())) {
    const kind = typeof value;
    assert.ok(
      value === null || kind === "string" || kind === "number" || kind === "boolean",
      `the bridge holds a ${kind}. It may hold ids, numbers and flags only: a renderer object in ` +
        `a global store outlives every unmount and no test can read it without a GPU.`,
    );
  }
});

test("the bridge refuses a case the active state cannot show", () => {
  const bridge = bridgeModule.createBridge();
  bridge.setState({ activeState: "selection", activeCase: "run-boundary-series" });
  assert.equal(
    bridge.read().activeCase,
    STATE_DEFS.selection.cases[0],
    "a case from another state was accepted, so the source plate could describe a subject the " +
      "scene is not drawing",
  );
});

test("crossing into a state takes that state's own default case", () => {
  const bridge = bridgeModule.createBridge();
  bridge.setState({ activeState: "scorer", activeCase: "scorer-attribution-patching" });
  assert.equal(bridge.read().activeCase, "scorer-attribution-patching");
  bridge.setState({ activeState: "update" });
  assert.equal(bridge.read().activeCase, "update-step");
});
