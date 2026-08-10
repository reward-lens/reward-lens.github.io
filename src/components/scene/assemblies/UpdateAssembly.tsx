/**
 * The update: where eight displaced paths become one direction.
 *
 * An integrating lens in a barrel on the rail, eight contribution vectors
 * converging on it, one resultant beam leaving it, and beside all of that a
 * second path that does not go through the lens at all.
 *
 * ------------------------------------------------------------------------
 * WHAT THE REFERENCE PATH IS, AND WHAT IT IS NOT ALLOWED TO SAY
 * ------------------------------------------------------------------------
 *
 * The second path is the full-gradient reference: the comparison the library's
 * immediate-credit instrument makes, drawn as a separate channel because it is
 * a separate computation rather than a stage of this one.
 *
 * It carries NO measured quantity, and that restraint is deliberate.
 * `EVIDENCE-VERDICTS.md` §6 puts the immediate-credit residual table in the
 * prose-only column: float64 2.704e-16, float32 1.126e-07, bfloat16 1.56e-03,
 * a real SGD step at 4.938e-09, over eight rollouts and 107 trained positions,
 * all of it asserted in tests with no per-rollout gradient array persisted
 * anywhere. So the reference path is apparatus, like the rail and the ticks:
 * it is a physical channel with a length and a position and no encoding. Its
 * numbers belong in DOM prose beside the canvas, typed and sourced, and a
 * reader who wants the residual gets it in text where it can carry its own
 * limitation.
 *
 * Drawing the residual as a gap between two beams would be exactly the failure
 * the verdicts file exists to prevent, and it would be a persuasive one,
 * because a visible gap between a predicted and an achieved path reads as a
 * measurement even when the caption says otherwise.
 *
 * ------------------------------------------------------------------------
 * WHAT IS MEASURED HERE
 * ------------------------------------------------------------------------
 *
 *   resultant length     `grad_norm_clipped`, 200 recorded optimizer steps,
 *                        0.2533 to 0.4419 across the record.
 *   contributor count    `n_trajectories`, which is 8 on every step, and is
 *                        read rather than typed so eight vectors and eight
 *                        rollouts cannot drift apart.
 *
 * `entropy` is in the payload and is NOT drawn. It is 11.9294 on all 200 steps
 * and its whole spread across the record is 5.7e-6, which on a value of 11.93
 * is the last bit of a float32 rather than a trend. A trace of it would be a
 * straight line that a reader would take for a measurement of stability, and
 * the honest reading is that this fixture does not vary it. Recorded here
 * rather than quietly omitted, and held by a test at the fourth decimal, which
 * is the precision this sentence quotes.
 */
import { useMemo } from "react";
import type { ScenePalette } from "../core/palette";
import type { SceneTier } from "../runtime/tier";
import {
  useSurface,
  BEVEL,
  BEVEL_SEGMENTS,
  LENS_BARREL_PROFILE,
  LENS_ELEMENT_PROFILE,
  RETAINING_RING_PROFILE,
} from "../materials";
import {
  bevelledBox,
  latheProfile,
  latheSegments,
  openTube,
  type AssemblyBounds,
} from "../geometry/profiles";
import { useLight } from "./light";
import { Instanced, type Placement } from "./Instanced";
import { SELECTION_BOUNDS, SELECTION_ENVELOPE } from "./SelectionAssembly";
import { STATIONS } from "./stations";
import { column, extent, normalise, readPayload } from "./payload";

interface Props {
  palette: ScenePalette;
  tier: SceneTier;
  step: number;
  emphasis: number;
  castShadow: boolean;
}

/**
 * Where the eight contributions arrive, and where they start.
 *
 * The start is READ FROM THE SELECTION STAGE rather than chosen here. It used
 * to be `STATIONS.modulator + 0.28`, which is upstream of where the rollout
 * rays actually stopped, so the two sets of lines overlapped for a quarter of
 * the bench and read as one scribble. `SELECTION_BOUNDS.attachments.exit` is
 * the published seam and this is what publishing it was for: the rays end
 * there, the contributions begin there, and if either stage moves the other
 * follows instead of drifting.
 */
const CONVERGE_AT = STATIONS.integrating;
const VECTOR_FROM = SELECTION_BOUNDS.attachments.exit[0];

/** The reference channel sits behind the optical axis, out of the beam. */
const REFERENCE_Z = -0.3;

export const UPDATE_BOUNDS: AssemblyBounds = {
  name: "UpdateAssembly",
  origin: [STATIONS.integrating, 0, 0],
  extent: [STATIONS.policyPlanes - STATIONS.modulator, 0.9, 0.8],
  attachments: {
    /** Where the contributions begin. The same point the rays end at. */
    entrance: [VECTOR_FROM, 0, 0],
    lens: [STATIONS.integrating, 0, 0],
    resultant: [STATIONS.integrating + 0.24, 0, 0],
    reference: [STATIONS.integrating, 0, REFERENCE_Z],
  },
};

export function UpdateAssembly({ palette, tier, step, emphasis, castShadow }: Props) {
  const payload = readPayload("update-step");
  const segments = latheSegments(tier);

  const anodized = useSurface({ surface: "anodized", tier });
  const machined = useSurface({ surface: "machined", tier });
  const marking = useSurface({ surface: "paintedMarking", tier });
  const glass = useSurface({ surface: "opticalGlass", tier });

  const vectorLight = useLight("ray", palette, undefined, emphasis);
  const resultantLight = useLight("core", palette, undefined, emphasis);
  const referenceLight = useLight("reference", palette, undefined, emphasis);

  const update = useMemo(() => {
    const gradNorm = column(payload, "grad_norm_clipped");
    const contributors = column(payload, "n_trajectories");
    const at = Math.max(0, Math.min(gradNorm.length - 1, Math.round(step)));

    /**
     * The resultant's length, over the record's own range.
     *
     * `grad_norm_clipped` runs 0.2533 to 0.4419, which is a 74% swing on a
     * quantity that never approaches zero, so a length proportional to the raw
     * value would be a beam that is always about the same length and never
     * says anything. The domain is the record's own extent and the floor is
     * stated: the shortest recorded step still draws a beam, because a step
     * whose update was small is not a step that had no update.
     */
    const domain = extent(gradNorm);
    const length = 0.5 + 1.05 * normalise(gradNorm[at], domain);

    return {
      step: at,
      contributors: contributors[at],
      gradNorm: gradNorm[at],
      length,
    };
  }, [payload, step]);

  /**
   * The contribution vectors, one per recorded trajectory.
   *
   * They converge on the lens rather than running parallel into it, which is
   * the whole difference between "eight things happened" and "eight things were
   * summed". Their fan is the room's, not a measurement: what the record gives
   * is how many there are, and eight is what is drawn. The fan's height is the
   * selection stage's own envelope, so the contributions open to exactly the
   * band the rays arrived in and the two stages read as one path.
   *
   * THE ROTATION IS DERIVED, NOT GUESSED, and the version this replaces was
   * neither. It read `Math.PI / 2 - Math.atan2(y, run)`, which mirrors the
   * direction in x and so drew each vector running from the lens outward to
   * the fan instead of from the fan inward to the lens. A cylinder is
   * symmetric about its centre, so the two produce the same pixels and the
   * error was invisible: the picture agreed with the comment for a reason the
   * code did not. It is written out here so the next person to move a station
   * is changing arithmetic they can check.
   *
   *   The tube is authored along +Y. R_z(t) sends (0,1,0) to (-sin t, cos t).
   *   The direction wanted is (run, -y) normalised, so -sin t = run / L and
   *   cos t = -y / L, which is t = atan2(-run, -y).
   *
   * Depth is held constant along a vector rather than converging in three
   * axes: a rotation about z cannot produce a z component, so a vector whose
   * endpoints differed in depth would be drawn at a length its ends do not
   * have. Each contribution sits at its own depth and converges in height.
   */
  const vectors = useMemo<Placement[]>(() => {
    const count = update.contributors;
    const run = CONVERGE_AT - VECTOR_FROM;
    return Array.from({ length: count }, (_, i) => {
      const spread = count <= 1 ? 0 : (i / (count - 1)) * 2 - 1;
      const y = spread * SELECTION_ENVELOPE;
      const z = Math.sin((i / count) * Math.PI * 2) * 0.08;
      const length = Math.hypot(run, y);
      return {
        position: [VECTOR_FROM + run / 2, y / 2, z],
        rotation: [0, 0, Math.atan2(-run, -y)],
        scale: [1, length, 1],
      } satisfies Placement;
    });
  }, [update]);

  return (
    <group name="UpdateAssembly">
      {/* The barrel, the retaining ring and the element: the one place on this
          bench where the lathe profiles are used for what they are for. */}
      <group
        name="IntegratingLens"
        position={[CONVERGE_AT, 0, 0]}
        rotation={[0, 0, -Math.PI / 2]}
      >
        <mesh
          name="LensBarrel"
          geometry={latheProfile(LENS_BARREL_PROFILE, segments)}
          material={anodized}
          castShadow={castShadow}
          receiveShadow
        />
        <mesh
          name="LensRetainingRing"
          geometry={latheProfile(RETAINING_RING_PROFILE, segments)}
          material={machined}
          position={[0, 0.196, 0]}
        />
        <mesh
          name="LensElement"
          geometry={latheProfile(LENS_ELEMENT_PROFILE, segments)}
          material={glass}
          position={[0, 0.1, 0]}
        />
      </group>

      {/* The cell the barrel is clamped in, and its label. */}
      <mesh
        name="LensCell"
        geometry={bevelledBox(0.16, 0.5, 0.44, BEVEL.housing)}
        material={anodized}
        position={[CONVERGE_AT - 0.16, 0, 0]}
        castShadow={castShadow}
        receiveShadow
      />
      <mesh
        name="LensCellLabel"
        geometry={bevelledBox(0.04, 0.005, 0.15, BEVEL.marking, BEVEL_SEGMENTS.secondary)}
        material={marking}
        position={[CONVERGE_AT - 0.16, -0.2, 0.222]}
        rotation={[Math.PI / 2, 0, 0]}
      />

      {/* Eight contributions, converging. */}
      <Instanced
        name="ContributionVectors"
        geometry={openTube(0.009, 1, 8)}
        material={vectorLight}
        placements={vectors}
      />

      {/* The resultant: one beam, its length the recorded clipped gradient
          norm at this step. */}
      <mesh
        name="ResultantBeam"
        geometry={openTube(0.026, 1, 12)}
        material={resultantLight}
        position={[CONVERGE_AT + 0.24 + update.length / 2, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        scale={[1, update.length, 1]}
      />

      {/* The full-gradient reference path, behind the axis. Apparatus: a
          channel with a rail block at each end and a beam between them, and no
          quantity anywhere on it. See the header. */}
      <mesh
        name="ReferenceBlockIn"
        geometry={bevelledBox(0.08, 0.22, 0.16, BEVEL.plate)}
        material={anodized}
        position={[VECTOR_FROM + 0.1, -0.02, REFERENCE_Z]}
        castShadow={castShadow}
      />
      <mesh
        name="ReferenceBlockOut"
        geometry={bevelledBox(0.08, 0.22, 0.16, BEVEL.plate)}
        material={anodized}
        position={[CONVERGE_AT + 0.6, -0.02, REFERENCE_Z]}
        castShadow={castShadow}
      />
      <mesh
        name="ReferencePath"
        geometry={openTube(0.014, CONVERGE_AT + 0.6 - (VECTOR_FROM + 0.1), 8)}
        material={referenceLight}
        position={[(VECTOR_FROM + 0.1 + CONVERGE_AT + 0.6) / 2, -0.02, REFERENCE_Z]}
        rotation={[0, 0, Math.PI / 2]}
      />
    </group>
  );
}
