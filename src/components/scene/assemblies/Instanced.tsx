/**
 * Repeated elements, drawn once.
 *
 * The rail has twelve graduations, the run timeline has twenty, the selection
 * stage draws eight rollout rays and the score band carries one point per
 * recorded rollout in the step. Every one of those is the same buffer and the
 * same material at a different transform, which is the definition of an
 * instanced draw, and the budget this packet is held to is under 120 draw
 * calls at the high tier. Twelve ticks as twelve meshes is 12 of those 120
 * spent on a graduation.
 *
 * WHY A COMPONENT AND NOT A HOOK. The instance matrices have to be written
 * after React has created the `InstancedMesh` and before the first frame is
 * drawn, and rewritten whenever the placements change. That is a layout effect
 * on a ref, and wrapping it means an assembly says what it wants drawn rather
 * than how to upload a matrix.
 *
 * THE TRAP THIS FILE ALREADY CONTAINS THE FIX FOR. An `InstancedMesh` whose
 * `instanceMatrix` is written without setting `needsUpdate` renders every
 * instance at the identity transform, which is one object at the origin. On a
 * dark scene that looks exactly like "the instances did not mount", so the next
 * move is usually to go looking in the wrong place. It is set here, once. The
 * bounding sphere is recomputed for the same class of reason: a stale one
 * frustum-culls the whole batch the moment the camera moves off the origin.
 */
import { useLayoutEffect, useRef } from "react";
import {
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type InstancedMesh,
  type Material,
} from "three";

/** One instance's transform. Rotation is Euler XYZ in radians. */
export interface Placement {
  position: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  scale?: readonly [number, number, number] | number;
  /** Per-instance colour. Only read when the caller passes `colored`. */
  color?: Color;
}

interface Props {
  name: string;
  geometry: BufferGeometry;
  material: Material;
  placements: readonly Placement[];
  castShadow?: boolean;
  receiveShadow?: boolean;
  /**
   * Enables the per-instance colour attribute.
   *
   * Off by default and it matters: `instanceColor` multiplies the material's
   * own colour, so switching it on without setting every instance's colour
   * paints those instances black rather than leaving them alone. The attribute
   * is therefore allocated filled with white.
   */
  colored?: boolean;
  /** Set when the placements change every frame. Off, the upload is one-shot. */
  dynamic?: boolean;
}

const SCRATCH_MATRIX = new Matrix4();
const SCRATCH_POSITION = new Vector3();
const SCRATCH_QUATERNION = new Quaternion();
const SCRATCH_SCALE = new Vector3();
const SCRATCH_EULER = new Euler();
const NO_ROTATION = [0, 0, 0] as const;

export function Instanced({
  name,
  geometry,
  material,
  placements,
  castShadow = false,
  receiveShadow = false,
  colored = false,
  dynamic = false,
}: Props) {
  const ref = useRef<InstancedMesh>(null);

  /**
   * A capacity that never falls below one.
   *
   * React keys the object on `args`, so a batch allocated at zero and later
   * filled is recreated rather than updated, and assemblies do render a
   * genuinely empty set in some states. The floor is here; the count actually
   * drawn is set in the effect.
   */
  const capacity = Math.max(1, placements.length);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;

    mesh.count = placements.length;
    if (dynamic) mesh.instanceMatrix.setUsage(DynamicDrawUsage);

    if (colored && !mesh.instanceColor) {
      mesh.instanceColor = new InstancedBufferAttribute(
        new Float32Array(mesh.instanceMatrix.count * 3).fill(1),
        3,
      );
    }

    for (let i = 0; i < placements.length; i += 1) {
      const p = placements[i];
      SCRATCH_POSITION.set(p.position[0], p.position[1], p.position[2]);
      const r = p.rotation ?? NO_ROTATION;
      SCRATCH_EULER.set(r[0], r[1], r[2], "XYZ");
      SCRATCH_QUATERNION.setFromEuler(SCRATCH_EULER);
      const s = p.scale ?? 1;
      if (typeof s === "number") SCRATCH_SCALE.set(s, s, s);
      else SCRATCH_SCALE.set(s[0], s[1], s[2]);
      SCRATCH_MATRIX.compose(SCRATCH_POSITION, SCRATCH_QUATERNION, SCRATCH_SCALE);
      mesh.setMatrixAt(i, SCRATCH_MATRIX);
      if (colored && p.color) mesh.setColorAt(i, p.color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [placements, colored, dynamic]);

  return (
    <instancedMesh
      ref={ref}
      name={name}
      args={[geometry, material, capacity]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      /**
       * Culling is off because the bounding sphere of an instanced batch is
       * computed from the instance matrices, and a batch whose placements are
       * driven by a scroll value has a sphere that is correct one frame and
       * stale the next. The batches here are small and the cost of drawing an
       * off-screen one is a vertex shader that discards; the cost of culling a
       * visible one is the object disappearing.
       */
      frustumCulled={false}
    />
  );
}

/** A colour object per instance, built once. For callers that pass `colored`. */
export function instanceColors(count: number, of: (i: number) => Color): Color[] {
  return Array.from({ length: count }, (_, i) => of(i));
}
