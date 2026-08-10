/**
 * The key light's shadow camera, fitted to the bench.
 *
 * `DirectionalLightShadow` defaults to `OrthographicCamera(-5, 5, 5, -5, 0.5, 500)`
 * (three r185, `src/lights/DirectionalLightShadow.js:16`). That is a 10x10 box
 * with a 500-unit depth range, and it is wrong here in both directions at once.
 * The bench is 14 units across, so its ends fall outside the frustum and simply
 * stop casting; and the 500-unit depth means the 24-bit depth buffer is spread
 * over a range the scene uses about three percent of, which is what produces
 * acne on gently sloped faces at any bias small enough to keep contact shadows.
 *
 * So the frustum is computed from `layout.ts` rather than typed. It is derived,
 * so a geometry change that moves the bench moves the shadow camera with it and
 * cannot silently clip a shadow off the end of the rail.
 */
import { BENCH, ROOM_HALF_WIDTH } from "../core/layout";

/**
 * The box the shadow camera has to contain, in world units.
 *
 * The floor is deliberately excluded from the vertical extent. It sits at
 * y = -5.4, four and a half units below the rail, and nothing casts onto the far
 * half of it; including it would triple the frustum's height to buy shadow
 * resolution for a surface that receives none. What matters is the volume from
 * just under the rail to just over the tallest housing.
 */
export const SHADOW_VOLUME = {
  minX: -ROOM_HALF_WIDTH - 1.2,
  maxX: ROOM_HALF_WIDTH + 1.2,
  minY: BENCH.railY - 0.6,
  maxY: 2.2,
  minZ: BENCH.backWallZ,
  maxZ: 1.4,
} as const;

export interface ShadowFrustum {
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
}

/**
 * A frustum that contains the bench from any light direction.
 *
 * The bounding SPHERE, not the box, because the box's extent in the light's
 * view depends on the light direction and would have to be recomputed whenever
 * the key moves; the sphere does not, so a pose change cannot introduce a
 * clipped shadow. The cost is the difference between a 14x8x5 box and the
 * sphere around it, which is about a factor of two in area and is worth paying
 * for a frustum that is right by construction.
 */
export function fitShadowFrustum(lightPosition: readonly [number, number, number]): ShadowFrustum {
  const v = SHADOW_VOLUME;
  const cx = (v.minX + v.maxX) / 2;
  const cy = (v.minY + v.maxY) / 2;
  const cz = (v.minZ + v.maxZ) / 2;
  const radius = Math.hypot(v.maxX - cx, v.maxY - cy, v.maxZ - cz);

  const distance = Math.hypot(lightPosition[0] - cx, lightPosition[1] - cy, lightPosition[2] - cz);

  return {
    left: -radius,
    right: radius,
    top: radius,
    bottom: -radius,
    // Tight around the sphere: this is the whole point, because the depth
    // precision the normal bias has to work against is set by far minus near.
    near: Math.max(0.1, distance - radius),
    far: distance + radius,
  };
}

/**
 * Bias, tuned at the hero pose against both failure modes at once.
 *
 * `shadow.bias` is a constant depth offset and it trades acne for
 * peter-panning directly: enough to clear the acne on the floor detaches the
 * housings' contact shadows from their mounts. `shadow.normalBias` offsets
 * along the surface normal instead, which scales with how obliquely the surface
 * faces the light, so it removes acne on the near-tangent floor without moving
 * the shadow of a face that is square to the light. That is why the constant
 * bias is nearly zero here and the normal bias does the work.
 *
 * 0.035 is the smallest normal bias with no acne visible on the floor's pool at
 * 1440p, and the contact shadow under the source mount is still attached at
 * 0.05. Values are in world units and depend on the fitted frustum above; they
 * are not portable to the default one.
 */
export const SHADOW_BIAS = {
  bias: -0.0002,
  normalBias: 0.035,
} as const;
