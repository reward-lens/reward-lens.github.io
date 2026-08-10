/**
 * Every form the bench is built out of, and the only place one is constructed.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE. `INTERFACES.md` §3: no shipped
 * visible form may be a raw `boxGeometry` or `planeGeometry`. A mathematically
 * sharp edge has zero area, so there is no surface at the intermediate angle
 * for a highlight to sit on, and what you get is a hard boundary between two
 * flat tones. That boundary is the most reliable signature of untouched
 * primitive geometry in a renderer, and it is what the previous version of this
 * scene was made of. `materials/bevel.ts` owns the widths; this file owns the
 * builders that take them.
 *
 * WHY THE BUILDERS ARE CACHED. A bevelled box is an `ExtrudeGeometry` plus a
 * creased-normal pass, which is real CPU work compared to a `BoxGeometry`, and
 * the bench draws the same 0.014-bevelled plate at four different stations. The
 * cache is keyed on the arguments, so two meshes asking for the same solid get
 * one buffer and one upload. `disposeGeometries()` takes all of them on
 * unmount, in the same shape `materials/surfaces.ts` disposes its own cache.
 *
 * WHAT IS NOT HERE. Nothing in this file knows a position, a material or a
 * state. It returns buffers. The assemblies place them.
 */
import {
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  OctahedronGeometry,
  RingGeometry,
  Shape,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import {
  BEVEL_SEGMENTS,
  BEVEL_SMOOTH_ANGLE_DEG,
  LATHE_SEGMENTS,
  type LatheProfile,
} from "../materials/bevel";
import type { SceneTier } from "../runtime/tier";

/* ------------------------------------------------------------------------- *
 * The cache
 * ------------------------------------------------------------------------- */

const cache = new Map<string, BufferGeometry>();

function cached(key: string, make: () => BufferGeometry): BufferGeometry {
  const hit = cache.get(key);
  if (hit) return hit;
  const made = make();
  made.name = key;
  cache.set(key, made);
  return made;
}

/** Disposes every cached buffer. Called once by the scene root on unmount. */
export function disposeGeometries(): void {
  for (const geometry of cache.values()) geometry.dispose();
  cache.clear();
}

/** How many buffers are live. For the tests and the budget report. */
export function geometryCacheSize(): number {
  return cache.size;
}

/** Triangles across every cached buffer, which is what the budget counts. */
export function cachedTriangleCount(): number {
  let total = 0;
  for (const geometry of cache.values()) {
    const index = geometry.getIndex();
    const position = geometry.getAttribute("position");
    if (index) total += index.count / 3;
    else if (position) total += position.count / 3;
  }
  return Math.round(total);
}

/* ------------------------------------------------------------------------- *
 * The bevelled solid
 * ------------------------------------------------------------------------- */

/**
 * A bevelled box. There is no un-bevelled box in this scene.
 *
 * Built as an extruded rounded rectangle: `ExtrudeGeometry` with
 * `bevelEnabled` gives the two extrusion caps their break for free, and the
 * rounded `Shape` corners give the four long edges theirs.
 *
 * THE SIZE CORRECTION IS NOT COSMETIC, AND FOR A WHILE IT WAS ONLY A THIRD
 * DONE. The finished solid has to be exactly `w x h x d`, because a plate cut
 * to sit flush on the rail and drawn 0.028 proud of it reads as a gap, and
 * because every attachment point published by an assembly is computed from the
 * arguments rather than measured off the buffer.
 *
 * Both corrections are here and they are different. `ExtrudeGeometry` grows the
 * shape OUTWARD by `bevelSize` in the plane and by `bevelThickness` along the
 * extrusion, at both ends of each. So the depth passed to it is `d - 2b`, and
 * the shape is built at `w - 2b` by `h - 2b`. The first of those was the only
 * one written down for several commits: measured with
 * `tests/scene/geometry/profiles.test.mjs`, `bevelledBox(0.3, 0.62, 0.5, 0.018)`
 * came back 0.336 x 0.656 x 0.500. Every part on the bench was one bevel too
 * big on each of two axes, the depth was right, and the header said all three
 * were. That is why the test asserts the bounding box rather than the argument
 * list.
 *
 * `toCreasedNormals` at 32 degrees is what keeps the break reading as a break.
 * Extrude leaves the bevel facets flat-shaded against each other, so a
 * two-segment break renders as two hard steps rather than one graded line;
 * creasing merges the facets to each other while leaving them separate from the
 * flat faces they sit between. Omitting it is the single most common way a
 * bevel ends up looking worse than no bevel at all.
 *
 * Copied from `design/dossier/build/scene-materials/study/rig.ts`, which is
 * where it was written and measured. The study is not shipped; this is.
 */
export function bevelledBox(
  w: number,
  h: number,
  d: number,
  bevel = 0.014,
  segments: number = BEVEL_SEGMENTS.primary,
): BufferGeometry {
  return cached(`box:${w}:${h}:${d}:${bevel}:${segments}`, () => {
    // A quarter rather than a half: the shape is built at `w - 2b`, so a bevel
    // allowed to reach half the smallest side would leave a shape of no width
    // at all and `ExtrudeGeometry` would hand back degenerate triangles. The
    // bench's thinnest part is a 0.005-wide marking, which lands here.
    const b = Math.min(bevel, w / 4, h / 4, d / 4);
    // The extents of the SHAPE, which the bevel then grows back to w by h.
    const sw = w - b * 2;
    const sh = h - b * 2;
    const r = Math.min(b, sw / 2.05, sh / 2.05);
    const shape = new Shape();
    const hw = sw / 2 - r;
    const hh = sh / 2 - r;
    shape.moveTo(-hw, -sh / 2);
    shape.lineTo(hw, -sh / 2);
    shape.quadraticCurveTo(sw / 2, -sh / 2, sw / 2, -hh);
    shape.lineTo(sw / 2, hh);
    shape.quadraticCurveTo(sw / 2, sh / 2, hw, sh / 2);
    shape.lineTo(-hw, sh / 2);
    shape.quadraticCurveTo(-sw / 2, sh / 2, -sw / 2, hh);
    shape.lineTo(-sw / 2, -hh);
    shape.quadraticCurveTo(-sw / 2, -sh / 2, -hw, -sh / 2);

    const geometry = new ExtrudeGeometry(shape, {
      depth: d - b * 2,
      bevelEnabled: true,
      bevelThickness: b,
      bevelSize: b,
      bevelOffset: 0,
      bevelSegments: segments,
      curveSegments: Math.max(2, segments),
    });
    geometry.translate(0, 0, -(d - b * 2) / 2);
    geometry.computeVertexNormals();
    return toCreasedNormals(geometry, (BEVEL_SMOOTH_ANGLE_DEG * Math.PI) / 180);
  });
}

/**
 * A slab: a bevelled box whose top face is the origin plane.
 *
 * The floor and the back wall are slabs rather than planes, and the reason is
 * the rule above rather than a preference. A `planeGeometry` floor has no near
 * edge, so the one place in the frame where the floor could tell you it is a
 * physical surface instead of a backdrop is the one place it says nothing. The
 * cost is 96 triangles.
 */
export function bevelledSlab(
  w: number,
  d: number,
  thickness: number,
  bevel = 0.014,
): BufferGeometry {
  return cached(`slab:${w}:${d}:${thickness}:${bevel}`, () => {
    const geometry = bevelledBox(w, thickness, d, bevel).clone();
    geometry.translate(0, -thickness / 2, 0);
    return geometry;
  });
}

/**
 * A triangular dispersing element, extruded along its own axis with every edge
 * broken.
 *
 * An equilateral wedge standing on its base, apex up, so a beam entering one
 * inclined face leaves through the other. The corners are rounded by `radius`
 * before extrusion, which is what a real prism's protective chamfer is: an
 * unchamfered glass corner chips, so no optical shop ships one.
 */
export function wedgePrism(
  width: number,
  height: number,
  depth: number,
  bevel = 0.012,
  radius = 0.02,
): BufferGeometry {
  return cached(`wedge:${width}:${height}:${depth}:${bevel}:${radius}`, () => {
    // Inset by the bevel for the same reason `bevelledBox` is: the extrusion
    // grows the shape back out by `bevelSize`, so a wedge authored at its
    // finished size ships one bevel too large in both plane axes.
    const hw = width / 2 - bevel;
    const hh = height / 2 - bevel;
    const points: [number, number][] = [
      [-hw, -hh],
      [hw, -hh],
      [0, hh],
    ];
    const shape = new Shape();
    // Corners walked as "run in along the incoming edge, arc across the
    // corner, run out along the outgoing one". A quadratic through the corner
    // point is the arc; the two lerps are how far back it starts.
    for (let i = 0; i < points.length; i += 1) {
      const prev = points[(i + points.length - 1) % points.length];
      const here = points[i];
      const next = points[(i + 1) % points.length];
      const inAt = lerp2(here, prev, radius);
      const outAt = lerp2(here, next, radius);
      if (i === 0) shape.moveTo(inAt[0], inAt[1]);
      else shape.lineTo(inAt[0], inAt[1]);
      shape.quadraticCurveTo(here[0], here[1], outAt[0], outAt[1]);
    }
    const geometry = new ExtrudeGeometry(shape, {
      depth: depth - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelOffset: 0,
      bevelSegments: BEVEL_SEGMENTS.primary,
      curveSegments: 3,
    });
    geometry.translate(0, 0, -(depth - bevel * 2) / 2);
    geometry.computeVertexNormals();
    return toCreasedNormals(geometry, (BEVEL_SMOOTH_ANGLE_DEG * Math.PI) / 180);
  });
}

function lerp2(from: [number, number], to: [number, number], distance: number): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  const t = Math.min(0.5, distance / length);
  return [from[0] + dx * t, from[1] + dy * t];
}

/* ------------------------------------------------------------------------- *
 * Turned forms
 * ------------------------------------------------------------------------- */

/**
 * A lathed profile, in the form `INTERFACES.md` §3 declares it.
 *
 * `materials/bevel.ts` ships the five profiles the bench needs and every one of
 * them already has its corners broken, for the same reason a milled part does:
 * the bright ring around the top of a post is the break at its end face.
 */
export function latheProfile(
  points: LatheProfile | readonly (readonly [number, number])[],
  segments: number = LATHE_SEGMENTS.high,
): BufferGeometry {
  const key = `lathe:${segments}:${points.map((p) => `${p[0]},${p[1]}`).join(";")}`;
  return cached(key, () =>
    new LatheGeometry(
      points.map(([r, y]) => new Vector2(r, y)),
      segments,
    ),
  );
}

/** Radial segments for a turned form at this tier. Silhouette is not degraded far. */
export function latheSegments(tier: SceneTier): number {
  return LATHE_SEGMENTS[tier];
}

/**
 * A cylindrical body: housings, collars, beam cores.
 *
 * A cylinder is not on the banned list and does not need to be: it has no
 * sharp convex edge along its length, and its two end rims are broken by the
 * `rimBevel` argument, which builds it as a short lathe rather than as a
 * `CylinderGeometry` when a break is asked for.
 */
export function turnedCylinder(
  radius: number,
  length: number,
  segments: number,
  rimBevel = 0.006,
): BufferGeometry {
  return cached(`cyl:${radius}:${length}:${segments}:${rimBevel}`, () => {
    if (rimBevel <= 0) return new CylinderGeometry(radius, radius, length, segments);
    const b = Math.min(rimBevel, radius / 3, length / 3);
    const profile: [number, number][] = [
      [0, 0],
      [radius - b, 0],
      [radius, b],
      [radius, length - b],
      [radius - b, length],
      [0, length],
    ];
    const geometry = new LatheGeometry(
      profile.map(([r, y]) => new Vector2(r, y)),
      segments,
    );
    geometry.translate(0, -length / 2, 0);
    geometry.computeVertexNormals();
    return toCreasedNormals(geometry, (BEVEL_SMOOTH_ANGLE_DEG * Math.PI) / 180);
  });
}

/** An open tube with no end caps: a beam core, a sheath, a light guide. */
export function openTube(radius: number, length: number, segments = 12): BufferGeometry {
  return cached(`tube:${radius}:${length}:${segments}`, () =>
    new CylinderGeometry(radius, radius, length, segments, 1, true),
  );
}

/** A flat annulus: an aperture stop, a retaining face, a readout target ring. */
export function annulus(inner: number, outer: number, segments: number): BufferGeometry {
  return cached(`ring:${inner}:${outer}:${segments}`, () =>
    new RingGeometry(inner, outer, segments),
  );
}

/** A torus, for a knurled collar's rounded shoulder and for marker rings. */
export function collarRing(
  radius: number,
  tube: number,
  radial: number,
  tubular: number,
): BufferGeometry {
  return cached(`torus:${radius}:${tube}:${radial}:${tubular}`, () =>
    new TorusGeometry(radius, tube, radial, tubular),
  );
}

/** A small faceted solid, for an instanced point that has to catch a highlight. */
export function pointSolid(radius: number, detail = 0): BufferGeometry {
  return cached(`oct:${radius}:${detail}`, () => new OctahedronGeometry(radius, detail));
}

/* ------------------------------------------------------------------------- *
 * Light, and the forms it takes
 * ------------------------------------------------------------------------- */

/**
 * A band: a ribbon that leaves a point at an angle and widens along its run.
 *
 * Built vertex by vertex rather than as a `planeGeometry` for the same reason
 * everything else here is: a plane has one quad and cannot taper. This is a
 * strip of `steps + 1` cross sections, each a pair of vertices at a half-width
 * the caller controls, so a band's width along its length is a function and not
 * a scale factor.
 *
 * IT IS DOUBLE SIDED AT THE MATERIAL, AND THAT IS NOT OPTIONAL. `SCENE.md` §8
 * records that the first ribbon geometry in this project wound clockwise and
 * all six bands were silently backface-culled: an invisible spectrum on a dark
 * background looks like a plausible dark scene, and the culled version is about
 * a millisecond cheaper, so it also looks like a performance win. Count the
 * bands on screen before trusting any frame timing.
 *
 * `uv.x` runs 0 to 1 along the band, so a material can fall off along its
 * length without knowing how long it is.
 */
export function bandRibbon(
  length: number,
  halfWidthAt: (t: number) => number,
  steps = 24,
  lift = 0,
): BufferGeometry {
  const geometry = new BufferGeometry();
  const position: number[] = [];
  const uv: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = t * length;
    const half = halfWidthAt(t);
    const y = lift * t;
    position.push(x, y - half, 0, x, y + half, 0);
    uv.push(t, 0, t, 1);
    normal.push(0, 0, 1, 0, 0, 1);
  }
  for (let i = 0; i < steps; i += 1) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}

/**
 * A trace: a tube swept along a smooth curve through recorded points.
 *
 * Used for the run timeline's series, where the curve's y is a measured value.
 * `CatmullRomCurve3` with `centripetal` parametrisation rather than the
 * default: a uniform Catmull-Rom overshoots wherever consecutive samples are
 * far apart, and an overshoot on a trace whose height is a recorded number is a
 * drawn value nobody measured.
 *
 * MEASURED, BECAUSE THE FIRST VERSION OF THIS NOTE CLAIMED MORE THAN IS TRUE.
 * Centripetal reduces the excursion, it does not remove it. On the three
 * shipped series at the high tier the curve leaves the recorded range by at
 * most 0.0021 world units, against a tube radius of 0.011: a fifth of the
 * tube's own radius, so the excursion never leaves the solid the reader sees.
 * Uniform on the same points reaches 0.0039. On a synthetic series with a
 * single-sample step and four times the gradient, centripetal dips 0.0085
 * below its own minimum, which is what the parametrisation buys and what it
 * does not. `tests/scene/geometry/profiles.test.mjs` holds the shipped bound
 * and would fail if a future series were steep enough to break it.
 */
export function traceTube(
  points: readonly Vector3[],
  radius: number,
  radialSegments = 6,
): BufferGeometry {
  const curve = new CatmullRomCurve3(points.slice(), false, "centripetal", 0.5);
  return new TubeGeometry(curve, Math.max(8, points.length - 1), radius, radialSegments, false);
}

/* ------------------------------------------------------------------------- *
 * What an assembly tells its neighbours
 * ------------------------------------------------------------------------- */

/**
 * Every assembly exports its attachment points so a sibling can mount to it.
 * `INTERFACES.md` §3 fixes this shape.
 *
 * The point is that a station's position is published once, by the station, and
 * the next one along reads it. A second assembly that hard-codes where the
 * first one's exit face is will be wrong the first time either moves.
 */
export interface AssemblyBounds {
  name: string;
  origin: readonly [number, number, number];
  extent: readonly [number, number, number];
  attachments: Record<string, readonly [number, number, number]>;
}
