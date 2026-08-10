/**
 * The bench's coordinate system, derived from the hand-authored room.
 *
 * `hero-geometry.ts` states where the source, the dispersing element and the
 * detector sit as fractions of the room's width. Those fractions are the
 * contract the three fidelities agree on, so this file converts them into world
 * units rather than choosing new positions. Gate 20 asks the still, the SVG and
 * the live scene to land within 8px of each other on the beam axis, the prism
 * centroid and the detector x; that is only achievable if all three read
 * `HERO_X`, which is why nothing here is a fresh number.
 *
 * The optical axis is y = 0. Up is positive. The room is 12 units wide because
 * that puts the bench's parts at a scale where a 0.04-unit bevel is a visible
 * machined edge at the hero camera's field of view, and nothing more principled
 * than that.
 */
import { HERO_X } from "../../home/hero-geometry";

/** Half the room's width in world units. The source sits on the left edge. */
export const ROOM_HALF_WIDTH = 6;

/** Convert a `HERO_X` fraction (0 at the left screen edge, 1 at the detector). */
export function xFromFraction(fraction: number): number {
  return -ROOM_HALF_WIDTH + fraction * (ROOM_HALF_WIDTH * 2);
}

export const BENCH = {
  sourceX: xFromFraction(HERO_X.source),
  prismX: xFromFraction(HERO_X.prism),
  detectorX: xFromFraction(HERO_X.detector),
  /** The rail's top face, below the axis. Mirrors HERO_Y.rail's proportion. */
  railY: -0.92,
  railDepth: 0.55,
  /**
   * Low, and this number is doing composition work rather than describing a
   * room. The camera sits close to the optical axis, so a floor near the rail
   * fills the bottom third of the frame and reads as a lit grey band across the
   * hero rather than as a surface receding from the viewer. Dropping it puts
   * its far edge below the visible frame, leaving only the pool of light near
   * the source, which is what tells the eye where the light comes from.
   */
  floorY: -5.4,
  backWallZ: -3.2,
} as const;

/**
 * The landmarks the fallback and the canvas are compared on.
 *
 * Exported as data rather than read off the meshes, so the comparison test can
 * run without a GPU and so a geometry change that moves a landmark shows up as
 * a diff in this file rather than as a silent drift in a screenshot.
 */
export const LANDMARKS = {
  sourceAperture: [BENCH.sourceX, 0, 0],
  dispersingElement: [BENCH.prismX, 0, 0],
  detectorPlane: [BENCH.detectorX, 0, 0],
  opticalAxis: [0, 0, 0],
} as const satisfies Record<string, readonly [number, number, number]>;

export type LandmarkName = keyof typeof LANDMARKS;
