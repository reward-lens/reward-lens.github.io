/**
 * Where the light enters the account.
 *
 * The source is not "the truth" and the beam is not "the objective". What
 * travels down this bench is influence: whatever the training process actually
 * propagated from a score into a changed policy. The housing is drawn as a real
 * collimator on a post in a post holder because the visitor has to believe the
 * object before they will follow what it does.
 *
 * THE BEAM IS GEOMETRY, NOT A GLOW. It is a thin open tube with an emissive
 * material plus a wider, very faint sheath for the spill. Drawing it as a
 * bloom-only artifact makes it vanish at the low tier, where bloom is off, and
 * the beam is the one element that may never disappear.
 *
 * NO MATERIAL IS BUILT HERE. The housing, the collar and the mount come from
 * `materials/surfaces.ts`; the beam and its sheath come from `./light.ts`,
 * which is where the things that ARE light live. This file used to construct
 * four `meshStandardMaterial`s inline at metalness 0.18 to 0.20, which is the
 * value the grey render was made of.
 */
import { useMemo } from "react";
import type { ScenePalette } from "../core/palette";
import { BENCH } from "../core/layout";
import type { SceneTier } from "../runtime/tier";
import {
  useSurface,
  BEVEL,
  POST_PROFILE,
  POST_HOLDER_PROFILE,
} from "../materials";
import {
  annulus,
  bevelledBox,
  collarRing,
  latheProfile,
  latheSegments,
  openTube,
  turnedCylinder,
  type AssemblyBounds,
} from "../geometry/profiles";
import { useLight } from "./light";
import { RAIL_TOP_Y } from "./Room";

interface Props {
  palette: ScenePalette;
  tier: SceneTier;
  /** Where the beam terminates on this leg. */
  toX: number;
  castShadow: boolean;
  /** The faint outer sheath is the first thing to drop on a weak GPU. */
  spill: boolean;
}

/** The housing's axis station, and the aperture the beam actually leaves from. */
const HOUSING_X = BENCH.sourceX + 0.24;
const APERTURE_X = BENCH.sourceX + 0.705;

export const SOURCE_BOUNDS: AssemblyBounds = {
  name: "SourceAssembly",
  origin: [HOUSING_X, 0, 0],
  extent: [1.1, 0.7, 0.7],
  attachments: {
    aperture: [APERTURE_X, 0, 0],
    postFoot: [HOUSING_X, RAIL_TOP_Y, 0],
  },
};

export function SourceAssembly({ palette, tier, toX, castShadow, spill }: Props) {
  const length = toX - APERTURE_X;
  const midX = APERTURE_X + length / 2;
  const segments = latheSegments(tier);

  const anodized = useSurface({ surface: "anodized", tier });
  const machined = useSurface({ surface: "machined", tier });
  const blackOxide = useSurface({ surface: "blackOxide", tier });
  const marking = useSurface({ surface: "paintedMarking", tier });
  const core = useLight("core", palette);
  const sheath = useLight("sheath", palette);

  /**
   * The post's own scale, solved rather than typed.
   *
   * `POST_PROFILE` is authored 0.985 units tall so that a scale factor reads as
   * a length in world units. The post has to carry the housing's underside from
   * the rail's top face, and both of those are published constants, so the
   * factor is the distance between them and not a number anyone chose.
   */
  const postScaleY = useMemo(() => {
    const foot = RAIL_TOP_Y + 0.05;
    const head = -0.22;
    return (head - foot) / 0.985;
  }, []);

  return (
    <group name="SourceAssembly">
      {/* The post holder: the sleeve that clamps to the rail. It is what
          actually touches the bench, and without it the post looks glued on. */}
      <mesh
        name="SourcePostHolder"
        geometry={latheProfile(POST_HOLDER_PROFILE, segments)}
        material={anodized}
        position={[HOUSING_X, RAIL_TOP_Y, 0]}
        castShadow={castShadow}
        receiveShadow
      />

      {/* The post. Anodized, for the reason `Mounts.tsx` records at length:
          measured on the shipped environment a bare-aluminium post reads 217 of
          255 with its finish washed off, and a bench post is black anodized. */}
      <mesh
        name="SourcePost"
        geometry={latheProfile(POST_PROFILE, segments)}
        material={anodized}
        position={[HOUSING_X, RAIL_TOP_Y + 0.05, 0]}
        scale={[1, postScaleY, 1]}
        castShadow={castShadow}
      />

      {/* The set screw that clamps the post in the holder. Black oxide, because
          hardware is harder than aluminium and reads darker than it. */}
      <mesh
        name="SourceSetScrew"
        geometry={latheProfile(
          [
            [0, 0],
            [0.03, 0],
            [0.03, 0.048],
            [0.024, 0.056],
            [0, 0.056],
          ],
          Math.max(16, Math.round(segments / 2)),
        )}
        material={blackOxide}
        position={[HOUSING_X + 0.128, RAIL_TOP_Y + 0.2, 0]}
        rotation={[0, 0, -Math.PI / 2]}
      />

      {/* The mount block bridging post to housing. */}
      <mesh
        name="SourceMount"
        geometry={bevelledBox(0.2, 0.16, 0.24, BEVEL.housing)}
        material={anodized}
        position={[HOUSING_X, -0.26, 0]}
        castShadow={castShadow}
        receiveShadow
      />

      {/* The collimator housing. Turned, lying on the axis, with both rims
          broken so the light finds an edge at each end of it. */}
      <mesh
        name="SourceHousing"
        geometry={turnedCylinder(0.3, 0.92, segments, 0.012)}
        material={anodized}
        position={[HOUSING_X, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow={castShadow}
        receiveShadow
      />

      {/* A focus collar. One ring, the only ornament on the housing, and it
          catches the key across its rounded shoulder. */}
      <mesh
        name="SourceCollar"
        geometry={collarRing(0.315, 0.028, 12, Math.max(24, segments))}
        material={machined}
        position={[BENCH.sourceX + 0.52, 0, 0]}
        rotation={[0, Math.PI / 2, 0]}
        castShadow={castShadow}
      />

      {/* A label bar on the housing's upper face: matte, no specular life. */}
      <mesh
        name="SourceLabel"
        geometry={bevelledBox(0.22, 0.004, 0.05, BEVEL.marking, 1)}
        material={marking}
        position={[HOUSING_X - 0.06, 0.3, 0.04]}
      />

      {/* The aperture stop: a machined annulus recessed in the housing's face,
          with the lit disc inside it. The stop is what gives the bright disc an
          edge; without it the light looks painted on the front of a tube. */}
      <mesh
        name="SourceApertureStop"
        geometry={annulus(0.085, 0.16, segments)}
        material={machined}
        position={[APERTURE_X - 0.004, 0, 0]}
        rotation={[0, Math.PI / 2, 0]}
      />
      <mesh
        name="SourceAperture"
        geometry={annulus(0, 0.085, segments)}
        material={core}
        position={[APERTURE_X, 0, 0]}
        rotation={[0, Math.PI / 2, 0]}
      />

      {/* The beam core, from the aperture rather than from the housing's
          centre. The old version started it at the housing's axis station, so
          the first half-unit of beam was inside the collimator. */}
      <mesh
        name="IncidentBeam"
        geometry={openTube(0.028, Math.abs(length), 12)}
        material={core}
        position={[midX, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
      />

      {spill && (
        <mesh
          name="BeamSpill"
          geometry={openTube(0.11, Math.abs(length), 12)}
          material={sheath}
          position={[midX, 0, 0]}
          rotation={[0, 0, Math.PI / 2]}
        />
      )}
    </group>
  );
}
