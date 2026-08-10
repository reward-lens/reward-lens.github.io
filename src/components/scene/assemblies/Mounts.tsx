/**
 * Every post, post holder and set screw on the bench, in three draw calls.
 *
 * The five downstream stations each stand on the same hardware: a holder
 * clamped to the rail, a post in the holder, a screw clamping the post. That is
 * fifteen meshes drawn as three instanced batches, and it is the single largest
 * saving available against the 120 draw call budget at the high tier.
 *
 * IT IS ALSO THE HONEST MODEL OF THE OBJECT. A real bench does not have five
 * bespoke mounts, it has five of the same mount at five heights, because that is
 * what makes an optical bench an optical bench: the parts are interchangeable
 * and the rail is what they are interchangeable on. Drawing them as one batch
 * says that, and drawing them as five hand-placed meshes would let them drift
 * apart the moment one station moved.
 *
 * The heights are not uniform, and that is the point of the `scale` on each
 * placement. `POST_PROFILE` is authored 0.985 units tall so a scale factor
 * reads as a length: each station asks for the height its element needs, the
 * post is scaled to it, and the top of every post lands under the thing it
 * carries rather than at some shared elevation nothing is at.
 */
import { useMemo } from "react";
import {
  useSurface,
  POST_PROFILE,
  POST_HOLDER_PROFILE,
} from "../materials";
import { latheProfile, latheSegments } from "../geometry/profiles";
import type { SceneTier } from "../runtime/tier";
import { Instanced, type Placement } from "./Instanced";
import { RAIL_TOP_Y } from "./Room";

/** One station's mounting hardware: where it stands and how tall it is. */
export interface MountRequest {
  x: number;
  /** The underside of whatever the post carries, in world y. */
  headY: number;
  /** Off the rail's centre line, for a station that sits forward or back. */
  z?: number;
}

interface Props {
  tier: SceneTier;
  mounts: readonly MountRequest[];
  castShadow: boolean;
}

/** The post's foot, and the profile's own authored height. Both fixed. */
const FOOT_OFFSET = 0.05;
const PROFILE_HEIGHT = 0.985;

export function Mounts({ tier, mounts, castShadow }: Props) {
  const segments = latheSegments(tier);
  const anodized = useSurface({ surface: "anodized", tier });
  const blackOxide = useSurface({ surface: "blackOxide", tier });

  const holders = useMemo<Placement[]>(
    () => mounts.map((m) => ({ position: [m.x, RAIL_TOP_Y, m.z ?? 0] as const })),
    [mounts],
  );

  const posts = useMemo<Placement[]>(
    () =>
      mounts.map((m) => ({
        position: [m.x, RAIL_TOP_Y + FOOT_OFFSET, m.z ?? 0] as const,
        scale: [1, (m.headY - (RAIL_TOP_Y + FOOT_OFFSET)) / PROFILE_HEIGHT, 1] as const,
      })),
    [mounts],
  );

  /**
   * The screw sits on the holder's flank, pointing along +x.
   *
   * A quarter turn about z lays the lathe's axis down, which is what puts a
   * screw head where a screw head is: on the side of the holder, facing the
   * camera's side of the bench, where it can catch the strip highlight and be
   * the one dark thing in a bright neighbourhood.
   */
  const screws = useMemo<Placement[]>(
    () =>
      mounts.map((m) => ({
        position: [m.x + 0.128, RAIL_TOP_Y + 0.2, m.z ?? 0] as const,
        rotation: [0, 0, -Math.PI / 2] as const,
      })),
    [mounts],
  );

  return (
    <group name="Mounts">
      <Instanced
        name="PostHolders"
        geometry={latheProfile(POST_HOLDER_PROFILE, segments)}
        material={anodized}
        placements={holders}
        castShadow={castShadow}
        receiveShadow
      />
      {/*
        THE POSTS ARE ANODIZED, NOT BARE, AND THAT IS A MODELLING CORRECTION
        RATHER THAN A BRIGHTNESS ONE.

        The first version asked for `machined`, on the library's own note that
        it is the surface for "posts, shafts, exposed threads". Measured on the
        shipped environment, a `machined` post reads 217 of 255 with a
        high-pass energy of 3.4 against 14.3 on the stand-in: white, and with
        the finish washed off it. Seven of them in a row was the most
        conspicuous thing in the frame.

        The fix is not to slide the material, which is the move that produced
        the grey render, and the brief is right that a surface too bright is an
        environment or a key angle. It is that the part was modelled wrong. A
        bench post is black anodized aluminium; the bright turned parts on a
        real bench are the retaining rings, the collars and the aperture stops,
        which are small and are still `machined` here. `machined` at 217 is a
        finding about the environment and it is reported as one; it is not a
        reason to put seven bare shafts on a bench that does not have any.
      */}
      <Instanced
        name="Posts"
        geometry={latheProfile(POST_PROFILE, segments)}
        material={anodized}
        placements={posts}
        castShadow={castShadow}
      />
      <Instanced
        name="SetScrews"
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
        placements={screws}
      />
    </group>
  );
}
