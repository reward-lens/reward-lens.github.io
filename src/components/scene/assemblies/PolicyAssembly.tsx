/**
 * The policy response, and the reason it is the emptiest station on the bench.
 *
 * Two planes, before and after. Two channels between them, one predicted and
 * one residual. Both channels are empty, and that is the finding rather than an
 * unfinished state.
 *
 * ------------------------------------------------------------------------
 * THIS STATE HAS ZERO ENCODINGS AND IT IS SUPPOSED TO
 * ------------------------------------------------------------------------
 *
 * The manifest declares `response-unresolved` as `truthMode: "schematic"` with
 * an empty `encodings` array, and `types/truth.ts` makes that structural rather
 * than descriptive: `violatesTruthMode` rejects a schematic case that carries
 * any quantitative encoding, and the generator and the site build both run it.
 * So this file cannot give a plane a width from a number even if a later hand
 * wanted to.
 *
 * `EVIDENCE-VERDICTS.md` §7 says why. Nothing is persisted: the policy response
 * and reconciliation computation lives entirely in acceptance tests. The
 * 200-step verdict is "closed", and the closure is carried by sampling noise
 * from two batches of eight rollouts, with the test's own detection floor
 * hundreds of thousands of times the first-order prediction it is arbitrating.
 * Neither verdict could have failed meaningfully.
 *
 * So the two channels are drawn as what they are: two empty tracks with
 * nothing in them, between two planes that are identical to each other. A
 * reader who looks for a difference between the before plane and the after
 * plane will not find one, because none was measured. That is the state.
 *
 * WHAT WAS TEMPTING AND IS REFUSED. Any of the following would have filled this
 * station and every one of them would have been a manufactured movement: a
 * displacement between the planes proportional to anything; a residual channel
 * with a bar in it; a detection floor drawn as a band, which would need the
 * 665,862 or the 854,374 that the ledger itself calls a conflation; a
 * `u_MC` share drawn as an arc, which is 99.9999999999% of composed variance
 * and not the 100.0% it is usually written as. The site may state any of those
 * in prose with its attribution. None of them may be this geometry.
 */
import type { ScenePalette } from "../core/palette";
import type { SceneTier } from "../runtime/tier";
import { useSurface, BEVEL, BEVEL_SEGMENTS } from "../materials";
import { bevelledBox, type AssemblyBounds } from "../geometry/profiles";
import { useLight } from "./light";
import { STATIONS } from "./stations";

interface Props {
  palette: ScenePalette;
  tier: SceneTier;
  emphasis: number;
  castShadow: boolean;
}

/** The two planes straddle the station, close enough to read as a pair. */
const BEFORE_X = STATIONS.policyPlanes - 0.19;
const AFTER_X = STATIONS.policyPlanes + 0.19;

/** The two channels run between them, at two depths, and stay empty. */
const PREDICTED_Z = 0.13;
const RESIDUAL_Z = -0.13;

export const POLICY_BOUNDS: AssemblyBounds = {
  name: "PolicyAssembly",
  origin: [STATIONS.policyPlanes, 0, 0],
  extent: [0.62, 0.7, 0.42],
  attachments: {
    before: [BEFORE_X, 0, 0],
    after: [AFTER_X, 0, 0],
    predicted: [STATIONS.policyPlanes, 0, PREDICTED_Z],
    residual: [STATIONS.policyPlanes, 0, RESIDUAL_Z],
  },
};

export function PolicyAssembly({ palette, tier, emphasis, castShadow }: Props) {
  const anodized = useSurface({ surface: "anodized", tier });
  const detectorFace = useSurface({ surface: "detectorFace", tier });
  const marking = useSurface({ surface: "paintedMarking", tier });

  /**
   * The channels are lit as `bounded`, not as a result.
   *
   * `--state-bounded` is this site's colour for a limit rather than a value,
   * and a channel with nothing in it is exactly a limit: the instrument
   * reached here and could not resolve. Using the beam colour would say the
   * channel is carrying something.
   */
  const channelLight = useLight("bounded", palette, undefined, emphasis * 0.6);

  return (
    <group name="PolicyAssembly">
      {/* The two planes. Identical geometry, identical material, identical
          height. The eye is meant to compare them and find nothing. */}
      {[
        { name: "PolicyPlaneBefore", x: BEFORE_X },
        { name: "PolicyPlaneAfter", x: AFTER_X },
      ].map((plane) => (
        <group key={plane.name} name={plane.name}>
          <mesh
            name={`${plane.name}Frame`}
            geometry={bevelledBox(0.05, 0.58, 0.42, BEVEL.plate)}
            material={anodized}
            position={[plane.x, 0, 0]}
            castShadow={castShadow}
            receiveShadow
          />
          <mesh
            name={`${plane.name}Face`}
            geometry={bevelledBox(0.012, 0.46, 0.32, BEVEL.marking, BEVEL_SEGMENTS.secondary)}
            material={detectorFace}
            position={[plane.x + 0.031, 0, 0]}
          />
        </group>
      ))}

      {/* The two channels: a rail each, and nothing running in either. They are
          drawn as empty guides rather than left out, because a channel that is
          absent says the question was not asked and a channel that is empty
          says it was asked and did not resolve. */}
      {[
        { name: "PredictedChannel", z: PREDICTED_Z },
        { name: "ResidualChannel", z: RESIDUAL_Z },
      ].map((channel) => (
        <mesh
          key={channel.name}
          name={channel.name}
          geometry={bevelledBox(AFTER_X - BEFORE_X, 0.012, 0.05, BEVEL.marking, BEVEL_SEGMENTS.secondary)}
          material={channelLight}
          position={[STATIONS.policyPlanes, -0.26, channel.z]}
        />
      ))}

      {/* One label bar, the same as every other station has. The station is not
          drawn as broken, because it is not: it ran and returned nothing. */}
      <mesh
        name="PolicyLabel"
        geometry={bevelledBox(0.04, 0.005, 0.14, BEVEL.marking, BEVEL_SEGMENTS.secondary)}
        material={marking}
        position={[STATIONS.policyPlanes, -0.34, 0.21]}
        rotation={[Math.PI / 2, 0, 0]}
      />
    </group>
  );
}
