/**
 * The edge, which is the cheapest thing in this scene and the one that does the
 * most work.
 *
 * A mathematically sharp edge between two faces has zero area. It cannot catch
 * a highlight, because there is no surface at the intermediate angle for a
 * highlight to sit on. What you get instead is a hard boundary between two flat
 * tones, which is the single most reliable signature of untouched primitive
 * geometry. Every real machined part has its edges broken, either as a chamfer
 * cut by the same tool or as a radius left by deburring, and the bright line
 * that runs along that break is how the eye decides an object was made rather
 * than declared.
 *
 * This lives in the material module because the bevel exists for the specular
 * line, and the specular line is a material property. The geometry builder owns
 * `bevelledBox` and `latheProfile`; this file owns the numbers they take, so
 * that a change to how anodizing takes light and a change to how wide its edge
 * is happen in the same place.
 *
 * THE SCALE, AND WHY THESE NUMBERS AND NOT OTHERS. `core/layout.ts` fixes the
 * room at 12 world units wide and `InstrumentScene.tsx` puts the camera at
 * z = 15.05 with a 26 degree field of view. That solves to 11.9 world units
 * across a 1440px canvas, so one world unit is 121 CSS pixels and a bevel of
 * b units is 121 * b pixels wide on the hero still, doubled again on a 2x
 * display before downsampling.
 *
 *   0.004 u = 0.5 px   invisible at 1x, and aliases into a dotted line at 2x
 *   0.012 u = 1.5 px   a bright line. This is what a broken edge looks like
 *   0.020 u = 2.4 px   a line with width. Correct for a large housing face
 *   0.040 u = 4.8 px   a visible chamfer face, not a broken edge
 *
 * `layout.ts` says "a 0.04-unit bevel is a visible machined edge at the hero
 * camera's field of view", and it is right that 0.04 is visible; measured on
 * the study prop it is visible as a *chamfer*, a third face wide enough to read
 * its own tone, which is a different object from a deburred edge. The values
 * below sit in the 0.010 to 0.020 band for that reason and the study renders
 * are the evidence. See design/dossier/build/scene-materials/LOG.md, shoot 4.
 */

/**
 * Bevel width in world units, by the kind of part the edge belongs to.
 *
 * Bigger parts get wider breaks, which is also true of the real hardware: a
 * 50mm mount body is chamfered by half a millimetre and an M4 cap screw is not
 * chamfered at all, it is just turned with a radius under its head.
 */
export const BEVEL = {
  /** Anything not named below. */
  default: 0.014,
  /** Mount bodies, collimator housings, detector cans. The largest faces. */
  housing: 0.018,
  /** The rail. Its top edges carry the specular line the composition needs. */
  rail: 0.012,
  /** Base plates, breadboard tops, detector backing plates. */
  plate: 0.012,
  /** Cap screws, set screws, small hardware. Below this it stops resolving. */
  fastener: 0.005,
  /** Engraved markings and graduations: a hairline break, not a chamfer. */
  marking: 0.004,
} as const;

export type BevelPart = keyof typeof BEVEL;

/**
 * How many facets the break is made of.
 *
 * 1 is a flat 45 degree chamfer and reads as a cut. 2 or 3 approximate a
 * radius, and a radius is what a deburred edge actually is: the highlight
 * gradates across it instead of switching on at one angle, which is why a
 * two-segment break survives the camera moving and a one-segment chamfer
 * flickers as the specular crosses it.
 *
 * The cost is real but small. A bevelled box at 2 segments is 96 triangles
 * against 12 for a raw box; the whole bench is under 40 such boxes.
 */
export const BEVEL_SEGMENTS = {
  /** Housings, mounts, the rail: anything the camera dwells on. */
  primary: 2,
  /** Small hardware and anything below about 0.15 units across. */
  secondary: 1,
} as const;

/**
 * Smoothing angle for the bevelled forms, in degrees.
 *
 * The break must stay a break. Merging normals across it turns the chamfer into
 * a soft roll that spreads the highlight over the whole corner and undoes the
 * point of having one. 32 degrees keeps the facets of a two-segment break
 * merged with each other while leaving them separate from the flat faces.
 */
export const BEVEL_SMOOTH_ANGLE_DEG = 32;

/**
 * A lathe profile, in the form `latheProfile` takes: `[radius, height]` pairs
 * from bottom to top, in world units.
 *
 * Every profile below has its corners broken, because the same argument applies
 * to a turned part as to a milled one: the bright ring around the top of a post
 * is the break at its end face, and a profile that goes straight from the side
 * wall to the end face has no ring.
 */
export type LatheProfile = readonly (readonly [number, number])[];

/**
 * A 12.7mm optical post at bench scale: 0.075 unit radius, one unit tall.
 *
 * The knurl is not modelled as geometry. At 121 px per unit a knurl pitch is a
 * fifth of a pixel, so it would be an aliasing generator; it is carried by the
 * `machined` surface's anisotropic grain instead. What is modelled is the
 * shoulder near the base, because that is a whole-pixel silhouette event and
 * silhouette is the one thing a shader cannot fake.
 */
export const POST_PROFILE: LatheProfile = [
  [0.0, 0.0],
  [0.092, 0.0],
  [0.092, 0.03],
  [0.075, 0.052],
  [0.075, 0.94],
  [0.071, 0.97],
  [0.062, 0.985],
  [0.0, 0.985],
] as const;

/**
 * A post holder: the sleeve the post drops into, with its clamping slot face.
 * Wider than the post, shorter, and it is what actually touches the rail.
 */
export const POST_HOLDER_PROFILE: LatheProfile = [
  [0.0, 0.0],
  [0.135, 0.0],
  [0.135, 0.34],
  [0.128, 0.355],
  [0.082, 0.355],
  [0.082, 0.05],
  [0.0, 0.05],
] as const;

/**
 * A lens mount barrel: the ring that holds the element, with the retaining
 * ring's step cut into its front face.
 *
 * The step matters more than it looks. It is what puts a shadowed annulus
 * between the bright barrel edge and the glass, and without it the glass
 * appears to be glued to the front of a tube.
 */
export const LENS_BARREL_PROFILE: LatheProfile = [
  [0.0, 0.0],
  [0.29, 0.0],
  [0.315, 0.022],
  [0.315, 0.2],
  [0.29, 0.222],
  [0.255, 0.222],
  [0.255, 0.186],
  [0.24, 0.172],
  [0.24, 0.05],
  [0.0, 0.05],
] as const;

/**
 * A retaining ring, threaded in front of the element. Its slots are not
 * modelled for the same reason the knurl is not.
 */
export const RETAINING_RING_PROFILE: LatheProfile = [
  [0.238, 0.0],
  [0.252, 0.0],
  [0.252, 0.026],
  [0.246, 0.034],
  [0.238, 0.034],
] as const;

/**
 * The lens element itself: a plano-convex singlet seen in profile, flat face
 * toward the source. The sag is exaggerated about 1.4x over a real 50mm focal
 * length singlet at this diameter, because at 4% of frame the true sag reads as
 * a flat disc and the object stops being glass.
 */
export const LENS_ELEMENT_PROFILE: LatheProfile = [
  [0.0, 0.0],
  [0.235, 0.0],
  [0.235, 0.018],
  [0.212, 0.041],
  [0.16, 0.062],
  [0.088, 0.075],
  [0.0, 0.079],
] as const;

/**
 * Radial segment count for lathed forms, by tier.
 *
 * A silhouette that polygonises is worse than any material error, so the floor
 * is high: 32 is where a 0.3 unit radius barrel stops showing facets at this
 * camera. The high tier does not need 128; it needs 48 and the budget spent
 * somewhere the eye is actually looking.
 */
export const LATHE_SEGMENTS = {
  high: 48,
  mid: 32,
  low: 24,
  still: 24,
} as const;
