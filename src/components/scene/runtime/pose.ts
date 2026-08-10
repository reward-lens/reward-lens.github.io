/**
 * Poses, and the arithmetic that moves between them.
 *
 * A pose is data. Nothing in this file imports Three, touches the DOM or holds
 * a renderer object, which is what lets the state machine be tested in Node and
 * lets the DOM controls read the same numbers the renderer draws. INTERFACES.md
 * §4 froze the shape; this file adds only the interpolation.
 *
 * WHY EVERY SCRUBBED VALUE IS LINEAR. A scrubbed value with an eased curve
 * feels like lag when the reader scrolls backward: the value keeps easing
 * toward where the scroll used to be going. Backward scroll has to be as
 * immediate as forward scroll, so `mixPose` and the camera path are linear in
 * the scroll parameter and there is no spring anywhere on this path. Springs
 * are for local interaction, where the input is a discrete event rather than a
 * position, and they live in the controls.
 */

/** One persistent assembly's placement and weight in the current state. */
export interface AssemblyPose {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  /** 0 hides it entirely. Interpolated, so an assembly fades rather than pops. */
  opacity: number;
  /**
   * How much of the reader's attention this assembly is being given, 0 to 1.
   * Consumed as an emissive or rim weight by whatever draws it. Separate from
   * opacity because a de-emphasised assembly stays legible and a hidden one
   * does not.
   */
  emphasis: number;
  /**
   * How far this assembly has resolved from its schematic arrangement into its
   * measured one, 0 to 1. The one value that must never be faked: an assembly
   * with no measured case behind it holds 0 here for the whole movement.
   */
  dataMix: number;
}

export const IDENTITY_POSE: AssemblyPose = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  opacity: 0,
  emphasis: 0,
  dataMix: 0,
};

/** A pose written with only the fields that differ from the identity. */
export type PosePatch = Partial<AssemblyPose>;

export function pose(patch: PosePatch): AssemblyPose {
  return { ...IDENTITY_POSE, ...patch };
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerp3 = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

/**
 * Interpolate by known property, never by blending two opaque objects.
 *
 * Rotation is interpolated per Euler component rather than through a
 * quaternion. That is only correct while no pose in `states.ts` rotates by more
 * than a right angle on more than one axis at a time, which is asserted in the
 * runtime tests rather than left as a comment: an assembly that needs a real
 * orientation change gets a quaternion path and the test will say so.
 */
export function mixPose(a: AssemblyPose, b: AssemblyPose, t: number): AssemblyPose {
  const k = clamp01(t);
  return {
    position: lerp3(a.position, b.position, k),
    rotation: lerp3(a.rotation, b.rotation, k),
    scale: lerp3(a.scale, b.scale, k),
    opacity: lerp(a.opacity, b.opacity, k),
    emphasis: lerp(a.emphasis, b.emphasis, k),
    dataMix: lerp(a.dataMix, b.dataMix, k),
  };
}

export function mixPoseMaps(
  a: Readonly<Record<string, AssemblyPose>>,
  b: Readonly<Record<string, AssemblyPose>>,
  t: number,
): Record<string, AssemblyPose> {
  const out: Record<string, AssemblyPose> = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out[key] = mixPose(a[key] ?? IDENTITY_POSE, b[key] ?? IDENTITY_POSE, t);
  }
  return out;
}

/** Where the camera is, what it looks at, and how it is exposed. */
export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  /**
   * Field of view in degrees. 26 is the hero's and is the one thing the first
   * attempt got right; the movement narrows it slightly and never widens it,
   * because a widening lens is the tell of a game camera.
   */
  fov: number;
  /** Multiplier on the theme's authored exposure. Small corrections only. */
  exposure: number;
}

export function mixCamera(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const k = clamp01(t);
  return {
    position: lerp3(a.position, b.position, k),
    target: lerp3(a.target, b.target, k),
    fov: lerp(a.fov, b.fov, k),
    exposure: lerp(a.exposure, b.exposure, k),
  };
}

/**
 * Sample a Catmull-Rom spline through the given points.
 *
 * The camera moves on a curve rather than on straight segments between poses,
 * so passing through a keyframe does not produce a visible corner. Written out
 * rather than taken from `THREE.CatmullRomCurve3` for one reason that matters:
 * the DOM controls and the runtime tests read the camera path to assert that an
 * intermediate scroll position produces an intermediate pose, and neither of
 * them may pull the renderer in to do it.
 *
 * The ends are handled by duplicating the first and last control points, which
 * is the standard clamped form: the curve starts and ends exactly on them
 * rather than overshooting, and an overshoot at progress 0 would put the camera
 * behind the source on arrival.
 */
export function catmullRom(
  points: readonly (readonly [number, number, number])[],
  t: number,
): [number, number, number] {
  if (points.length === 0) return [0, 0, 0];
  if (points.length === 1) return [...points[0]] as [number, number, number];

  const k = clamp01(t);
  const segments = points.length - 1;
  const scaled = k * segments;
  // The last point has to be reachable, so the final segment keeps index
  // segments - 1 and takes local = 1 rather than rolling over to a segment that
  // does not exist.
  const index = Math.min(Math.floor(scaled), segments - 1);
  const local = scaled - index;

  const at = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))];
  const p0 = at(index - 1);
  const p1 = at(index);
  const p2 = at(index + 1);
  const p3 = at(index + 2);

  const axis = (i: 0 | 1 | 2) => {
    const a = p0[i];
    const b = p1[i];
    const c = p2[i];
    const d = p3[i];
    const t2 = local * local;
    const t3 = t2 * local;
    return (
      0.5 *
      (2 * b +
        (-a + c) * local +
        (2 * a - 5 * b + 4 * c - d) * t2 +
        (-a + 3 * b - 3 * c + d) * t3)
    );
  };

  return [axis(0), axis(1), axis(2)];
}
