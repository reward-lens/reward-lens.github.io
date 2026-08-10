/**
 * The material system's public surface.
 *
 * Assemblies import from here and nowhere deeper. `variation.ts` and the spec
 * table are exported for the tests and for the study rig; a mesh needs
 * `useSurface` and the bevel numbers and nothing else.
 */
export {
  useSurface,
  disposeSurfaces,
  primeSurfaces,
  surfaceCacheSize,
  SURFACE_TABLE,
  type SurfaceName,
  type SurfaceRequest,
} from "./surfaces";

export {
  BEVEL,
  BEVEL_SEGMENTS,
  BEVEL_SMOOTH_ANGLE_DEG,
  LATHE_SEGMENTS,
  POST_PROFILE,
  POST_HOLDER_PROFILE,
  LENS_BARREL_PROFILE,
  RETAINING_RING_PROFILE,
  LENS_ELEMENT_PROFILE,
  type BevelPart,
  type LatheProfile,
} from "./bevel";

export {
  applyVariation,
  PATCHED_CHUNKS,
  VARIATION_SOURCE,
  NO_VARIATION,
  type VariationProfile,
} from "./variation";
