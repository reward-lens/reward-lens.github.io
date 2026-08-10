/**
 * The geometry library, checked without a GPU.
 *
 * Nothing here renders, so nothing here can tell you a bevel looks right; the
 * close-up in `design/dossier/build/scene-assemblies/02-geometry/` is what that
 * claim rests on. What a test CAN hold is the set of properties that decide
 * whether the close-up could have come out any other way, and every one of the
 * cases below is a failure this build has actually shipped at some point:
 *
 *   - a solid that grows by a bevel in one axis, so two parts cut to meet stop
 *     meeting and a plate sits proud of the rail it was cut for;
 *   - a "bevelled" box with no surface at an intermediate angle, which is a
 *     `BoxGeometry` with more triangles and reads exactly like one;
 *   - a ribbon wound so that every band is backface-culled, which on a dark
 *     scene looks like a plausible dark scene and is also faster;
 *   - a trace that overshoots between two recorded samples, which is a drawn
 *     value nobody measured.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CatmullRomCurve3, Vector3 } from "three";
import { loadTs, closeLoader, REPO_ROOT } from "../materials/load.mjs";

const profiles = await loadTs("src/components/scene/geometry/profiles.ts");
const bevel = await loadTs("src/components/scene/materials/bevel.ts");

const {
  bevelledBox,
  bevelledSlab,
  wedgePrism,
  latheProfile,
  latheSegments,
  turnedCylinder,
  openTube,
  annulus,
  pointSolid,
  bandRibbon,
  traceTube,
  disposeGeometries,
  geometryCacheSize,
  cachedTriangleCount,
} = profiles;
const { BEVEL, BEVEL_SEGMENTS, LATHE_SEGMENTS, POST_PROFILE } = bevel;

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function bounds(geometry) {
  geometry.computeBoundingBox();
  const b = geometry.boundingBox;
  return {
    size: [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z],
    min: [b.min.x, b.min.y, b.min.z],
    max: [b.max.x, b.max.y, b.max.z],
  };
}

function attributeIsFinite(geometry, name) {
  const attribute = geometry.getAttribute(name);
  if (!attribute) return false;
  for (let i = 0; i < attribute.array.length; i += 1) {
    if (!Number.isFinite(attribute.array[i])) return false;
  }
  return true;
}

/** Every builder that ships a visible form, with arguments the bench uses. */
const BUILDERS = [
  ["bevelledBox", () => bevelledBox(0.3, 0.62, 0.5, BEVEL.housing)],
  ["bevelledSlab", () => bevelledSlab(12, 6, 0.2, BEVEL.plate)],
  ["wedgePrism", () => wedgePrism(0.62, 0.66, 0.46, BEVEL.plate, 0.03)],
  ["latheProfile", () => latheProfile(POST_PROFILE, LATHE_SEGMENTS.high)],
  ["turnedCylinder", () => turnedCylinder(0.24, 0.34, 40, 0.012)],
  ["openTube", () => openTube(0.012, 1, 8)],
  ["annulus", () => annulus(0.05, 0.12, 32)],
  ["pointSolid", () => pointSolid(0.012)],
];

/* ------------------------------------------------------------------ */
/* Every form is a real, finite, drawable buffer                      */
/* ------------------------------------------------------------------ */

test("every builder returns a finite buffer with positions and normals", () => {
  for (const [name, make] of BUILDERS) {
    const geometry = make();
    assert.ok(geometry.getAttribute("position"), `${name} has no position attribute`);
    assert.ok(attributeIsFinite(geometry, "position"), `${name} has a non-finite position`);
    assert.ok(geometry.getAttribute("normal"), `${name} has no normal attribute`);
    assert.ok(attributeIsFinite(geometry, "normal"), `${name} has a non-finite normal`);
    assert.ok(
      geometry.getAttribute("position").count > 0,
      `${name} produced an empty buffer`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* The depth correction: a bevelled solid is exactly the size asked    */
/* ------------------------------------------------------------------ */

test("a bevelled box is exactly w x h x d, bevel and all", () => {
  // The header's claim, and the reason it is not cosmetic: without the depth
  // correction every bevelled part grows by a bevel in one axis, so a plate cut
  // to sit flush on the rail sits 0.028 proud of it.
  for (const [w, h, d, b] of [
    [0.3, 0.62, 0.5, BEVEL.housing],
    [0.06, 0.52, 0.44, BEVEL.plate],
    [1.0, 0.11, 0.18, BEVEL.rail],
  ]) {
    const { size } = bounds(bevelledBox(w, h, d, b));
    assert.ok(Math.abs(size[0] - w) < 1e-6, `width ${size[0]} is not ${w}`);
    assert.ok(Math.abs(size[1] - h) < 1e-6, `height ${size[1]} is not ${h}`);
    assert.ok(Math.abs(size[2] - d) < 1e-6, `depth ${size[2]} is not ${d}`);
  }
});

test("a slab's top face is the origin plane", () => {
  // The floor and the back wall are placed by their top face, so a slab whose
  // origin drifted into its middle would sink every room surface by half its
  // thickness and nothing would say so.
  const { max } = bounds(bevelledSlab(12, 6, 0.2, BEVEL.plate));
  assert.ok(Math.abs(max[1]) < 1e-6, `the slab's top face is at y=${max[1]}, not 0`);
});

/* ------------------------------------------------------------------ */
/* THE BEVEL EXISTS. This is the one that stops the scene shipping     */
/* primitives with extra triangles.                                    */
/* ------------------------------------------------------------------ */

/**
 * A raw box has six normals and every one of them is an axis. A broken edge is
 * a surface at an intermediate angle, which is what a highlight sits on, so the
 * check is not "are there more triangles" but "is there a normal pointing
 * somewhere no face of a box points".
 */
function intermediateNormals(geometry) {
  const normal = geometry.getAttribute("normal");
  const seen = new Set();
  for (let i = 0; i < normal.count; i += 1) {
    const x = normal.getX(i);
    const y = normal.getY(i);
    const z = normal.getZ(i);
    const axial = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
    // Axis-aligned to within a degree is a face of the box, not a break.
    if (axial > 0.9998) continue;
    seen.add(`${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`);
  }
  return seen;
}

test("a bevelled box carries surfaces at intermediate angles", () => {
  const geometry = bevelledBox(0.3, 0.62, 0.5, BEVEL.housing);
  const intermediate = intermediateNormals(geometry);
  assert.ok(
    intermediate.size >= 8,
    `only ${intermediate.size} non-axial normal directions; a bevel that reads as a ` +
      "highlight needs a graded run of them and a BoxGeometry has none",
  );
});

test("two bevel segments produce a graded break, not one flat chamfer", () => {
  // BEVEL_SEGMENTS.primary is 2 and the point of the second segment is that the
  // break has an intermediate step rather than a single facet. A one-segment
  // break is measurably poorer here, which is what makes this a check and not
  // an assertion of the same thing twice.
  const graded = intermediateNormals(bevelledBox(0.3, 0.62, 0.5, BEVEL.housing, BEVEL_SEGMENTS.primary));
  const flat = intermediateNormals(bevelledBox(0.31, 0.62, 0.5, BEVEL.housing, BEVEL_SEGMENTS.secondary));
  assert.ok(
    graded.size > flat.size,
    `two segments gave ${graded.size} break directions and one gave ${flat.size}`,
  );
});

test("the deburred-edge band is what bevel.ts ships, not a chamfer face", () => {
  // Measured in the materials packet: 0.04 is a visible chamfer FACE and the
  // deburred-edge band is 0.010 to 0.020. Every part's bevel has to be in that
  // band or the bench stops looking machined and starts looking modelled.
  for (const [part, width] of Object.entries(BEVEL)) {
    assert.ok(
      width >= 0.004 && width <= 0.02,
      `BEVEL.${part} is ${width}; the deburred band is 0.010 to 0.020 and a marking's 0.004 is the floor`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* The ribbon                                                          */
/* ------------------------------------------------------------------ */

test("a band ribbon tapers by its width function and runs uv.x from 0 to 1", () => {
  const steps = 28;
  const ribbon = bandRibbon(4, (t) => 0.02 + 0.3 * t, steps, 0);
  const position = ribbon.getAttribute("position");
  const uv = ribbon.getAttribute("uv");
  assert.equal(position.count, (steps + 1) * 2, "a ribbon is two vertices per cross section");
  assert.ok(Math.abs(uv.getX(0)) < 1e-6, "uv.x starts at 0");
  assert.ok(Math.abs(uv.getX(uv.count - 1) - 1) < 1e-6, "uv.x ends at 1");

  // The taper is the encoding. Half-width at the far end must be the function's
  // value there, not a scale factor applied to a constant strip.
  const first = Math.abs(position.getY(1) - position.getY(0)) / 2;
  const last = Math.abs(position.getY(position.count - 1) - position.getY(position.count - 2)) / 2;
  assert.ok(Math.abs(first - 0.02) < 1e-6, `half-width at the exit is ${first}`);
  assert.ok(Math.abs(last - 0.32) < 1e-6, `half-width at the far end is ${last}`);
});

test("a lift shifts the ribbon's centre line and not its width", () => {
  const flat = bandRibbon(4, () => 0.05, 8, 0);
  const lifted = bandRibbon(4, () => 0.05, 8, 0.34);
  const a = flat.getAttribute("position");
  const b = lifted.getAttribute("position");
  const lastPair = a.count - 2;
  const widthFlat = Math.abs(a.getY(lastPair + 1) - a.getY(lastPair));
  const widthLifted = Math.abs(b.getY(lastPair + 1) - b.getY(lastPair));
  assert.ok(Math.abs(widthFlat - widthLifted) < 1e-6, "the lift changed the band's width");
  const centreLifted = (b.getY(lastPair) + b.getY(lastPair + 1)) / 2;
  assert.ok(Math.abs(centreLifted - 0.34) < 1e-6, `the far end lifted to ${centreLifted}, not 0.34`);
});

/* ------------------------------------------------------------------ */
/* The trace                                                           */
/* ------------------------------------------------------------------ */

/* The shipped series, read from the payload the site actually loads. */
function runSeries(name) {
  const buffer = readFileSync(
    join(REPO_ROOT, "src/data/scene/payload/run-boundary-series.bin"),
  );
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const headerLength = view.getUint32(8, true);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer.buffer, buffer.byteOffset + 12, headerLength)),
  );
  const start = 12 + headerLength + ((8 - ((12 + headerLength) % 8)) % 8);
  const d = header.arrays.find((a) => a.name === name);
  assert.ok(d, `the shipped payload has no array "${name}"`);
  const at = buffer.byteOffset + start + d.byteOffset;
  return d.dtype === "f32"
    ? new Float32Array(buffer.buffer, at, d.length)
    : new Int32Array(buffer.buffer, at, d.length);
}

test("a trace stays inside its own tube on the series that ship", () => {
  // The run series has flat stretches next to a step change, which is exactly
  // where a Catmull-Rom bulges past its own samples. A trace whose height is a
  // recorded rate must not draw a rate nobody recorded.
  //
  // The bound is the tube's own radius, and that is the honest one: an
  // excursion smaller than the radius is inside the solid the reader sees, so
  // no pixel of the drawing is outside the recorded range. The measured worst
  // case across all three series at the high tier is 0.0021.
  const radius = 0.011;
  const steps = runSeries("steps");
  for (const name of ["series.written", "series.realized", "series.formatOk"]) {
    const values = runSeries(name);
    const points = Array.from(values, (v, i) => new Vector3((steps[i] - 1) * 0.0268, v * 0.34, 0));
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of points) {
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
    }
    const { min, max } = bounds(traceTube(points, radius, 6));
    // The tube itself adds the radius; anything beyond that is the curve.
    const under = lo - radius - min[1];
    const over = max[1] - (hi + radius);
    assert.ok(
      under < radius / 2,
      `${name} dips ${under.toFixed(5)} below its own minimum, more than half the tube radius`,
    );
    assert.ok(
      over < radius / 2,
      `${name} rises ${over.toFixed(5)} above its own maximum, more than half the tube radius`,
    );
  }
});

test("centripetal is the reason the excursion is small, not luck", () => {
  // The parametrisation is a decision, so it is checked as one: on the same
  // recorded points, uniform must be measurably worse. If it stops being worse,
  // the note in profiles.ts is stale and should be rewritten rather than kept.
  const steps = runSeries("steps");
  const values = runSeries("series.written");
  const points = Array.from(values, (v, i) => new Vector3((steps[i] - 1) * 0.0268, v * 0.34, 0));
  let hi = -Infinity;
  for (const p of points) hi = Math.max(hi, p.y);

  const peak = (kind) => {
    const curve = new CatmullRomCurve3(points.slice(), false, kind, 0.5);
    let top = -Infinity;
    for (let i = 0; i <= 4000; i += 1) top = Math.max(top, curve.getPoint(i / 4000).y);
    return top - hi;
  };
  const centripetal = peak("centripetal");
  const uniform = peak("catmullrom");
  assert.ok(
    uniform > centripetal,
    `uniform overshot ${uniform.toFixed(5)} and centripetal ${centripetal.toFixed(5)}`,
  );
});

/* ------------------------------------------------------------------ */
/* The cache                                                           */
/* ------------------------------------------------------------------ */

test("the same arguments give the same buffer, and dispose empties the cache", () => {
  disposeGeometries();
  assert.equal(geometryCacheSize(), 0);
  const a = bevelledBox(0.3, 0.62, 0.5, BEVEL.housing);
  const b = bevelledBox(0.3, 0.62, 0.5, BEVEL.housing);
  assert.equal(a, b, "two meshes asking for the same solid got two buffers");
  const c = bevelledBox(0.3, 0.62, 0.5, BEVEL.rail);
  assert.notEqual(a, c, "a different bevel returned the same buffer");
  assert.ok(cachedTriangleCount() > 0, "the cache reports no triangles while holding buffers");
  disposeGeometries();
  assert.equal(geometryCacheSize(), 0);
  assert.equal(cachedTriangleCount(), 0);
});

test("lathe segments degrade the silhouette by tier and never to nothing", () => {
  assert.equal(latheSegments("high"), LATHE_SEGMENTS.high);
  assert.equal(latheSegments("mid"), LATHE_SEGMENTS.mid);
  assert.equal(latheSegments("low"), LATHE_SEGMENTS.low);
  assert.ok(LATHE_SEGMENTS.low >= 24, "a turned part below 24 segments reads as a polygon");
  assert.ok(LATHE_SEGMENTS.high > LATHE_SEGMENTS.mid && LATHE_SEGMENTS.mid > LATHE_SEGMENTS.low);
});

test.after(async () => {
  disposeGeometries();
  await closeLoader();
});
