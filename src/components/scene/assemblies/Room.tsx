/**
 * The room the bench stands in: a floor, a back wall, the optical rail and its
 * calibration ticks.
 *
 * Every one of these earns its place by doing work for the light. The floor and
 * the wall exist to catch the spill that tells you where the source is; the rail
 * exists because the assemblies are mounted on it and a part floating in black
 * has no scale; the ticks exist because a rail without graduations is a bar.
 * Nothing here is set dressing, which is the rule the whole scene is built to.
 *
 * MATERIALS ARE SEPARATED BY ROUGHNESS, NOT BY COLOUR. The floor, the wall and
 * the rail are all near the same graphite. What distinguishes them in the
 * render is how they take the key light: the wall is matte and reads as the
 * darkest, the floor is slightly less rough so it carries a soft pool, and the
 * rail's top face is the only ground surface and catches a specular line along
 * its length. That line is what makes the bench read as machined.
 *
 * ------------------------------------------------------------------------
 * WHAT CHANGED HERE, AND THE READING THAT MADE THE OLD VERSION WRONG
 * ------------------------------------------------------------------------
 *
 * This file used to build five `meshStandardMaterial`s inline, at metalness
 * 0.12 to 0.22, and it carried a paragraph explaining why: the rail had been
 * tried at 0.72, measured 19 of 255 against a target band of 48 to 72, and was
 * dropped back to a near-dielectric to recover a predictable grey.
 *
 * The measurement was right and the conclusion was backwards, and
 * `materials/surfaces.ts` now carries the correction in full. A metal is dark
 * when there is nothing for it to reflect; that is not a defect in the metal,
 * it is the definition of one. With no environment map in the repository there
 * was nothing, so lowering metalness restored a diffuse term and with it the
 * grey that shipped. Anodized aluminium at metalness 0.15 is grey plastic.
 *
 * The environment exists now, the material library is built against it, and the
 * room is made of it. No material is constructed in this file, and none may be.
 *
 * MEASURED AFTER THE CONVERSION, dark theme, AgX at exposure 1.00, on the built
 * page at 1440x900 via `scripts/dev/scene-levels.mjs`: see
 * `design/dossier/build/scene-assemblies/LOG.md`. The numbers are recorded
 * there rather than restated here, because a comment is not evidence.
 */
import { useMemo } from "react";
import type { ScenePalette } from "../core/palette";
import { BENCH, ROOM_HALF_WIDTH } from "../core/layout";
import { RAIL_TICKS } from "../../home/hero-geometry";
import { useSurface, BEVEL, BEVEL_SEGMENTS } from "../materials";
import type { SceneTier } from "../runtime/tier";
import { bevelledBox, bevelledSlab, type AssemblyBounds } from "../geometry/profiles";
import { Instanced, type Placement } from "./Instanced";

interface Props {
  palette: ScenePalette;
  tier: SceneTier;
  receiveShadow: boolean;
}

/** The rail's overall length, and the span every station is placed inside. */
export const RAIL_LENGTH = ROOM_HALF_WIDTH * 2 + 1.2;

/** The rail's top face, which is what every assembly's post stands on. */
export const RAIL_TOP_Y = BENCH.railY + 0.11;

/**
 * What the room publishes to the stations that mount on it.
 *
 * `INTERFACES.md` §3 asks every assembly for this, and the room is the one
 * every other assembly attaches to. A station that hard-codes the rail's top
 * face will be 0.11 units into the rail the first time the rail's section
 * changes.
 */
export const ROOM_BOUNDS: AssemblyBounds = {
  name: "Room",
  origin: [0, BENCH.railY, 0],
  extent: [RAIL_LENGTH, 0.22, BENCH.railDepth],
  attachments: {
    railTop: [0, RAIL_TOP_Y, 0],
    railFront: [0, RAIL_TOP_Y, BENCH.railDepth / 2],
    opticalAxis: [0, 0, 0],
  },
};

export function Room({ palette, tier, receiveShadow }: Props) {
  void palette;

  /**
   * The ticks are one instanced draw rather than twelve meshes. Twelve is cheap
   * either way, but the count comes from `RAIL_TICKS` and the run timeline
   * draws its graduations through the same component at a much higher count, so
   * it is written once at the scale it will need.
   */
  const tickPlacements = useMemo<Placement[]>(() => {
    const span = ROOM_HALF_WIDTH * 2;
    const gap = span / (RAIL_TICKS + 1);
    return Array.from({ length: RAIL_TICKS }, (_, i) => ({
      position: [
        -ROOM_HALF_WIDTH + gap * (i + 1),
        RAIL_TOP_Y + 0.006,
        BENCH.railDepth / 2 - 0.06,
      ] as const,
    }));
  }, []);

  /**
   * The floor and the wall are the two surfaces with no right name in the
   * library, and the tint is explicit for both.
   *
   * `paintedMarking` is the closest entry: a dielectric at roughness 0.82 with
   * no specular life, which is what a matte floor and a matte wall are. The
   * name is wrong for the job and the material system builder said so when they
   * suggested it. What makes it work at all is the explicit `tint`: these two
   * surfaces are the ROOM rather than objects standing in it, so unlike the
   * hardware they follow the theme, and passing the token is how a caller says
   * that. See the handoff for whether a `roomSurface` entry would be better;
   * the measurement says it would.
   */
  const floorSurface = useSurface({ surface: "paintedMarking", tint: "--surface-1", tier });
  const wallSurface = useSurface({ surface: "paintedMarking", tint: "--ground", tier });
  const railSurface = useSurface({ surface: "anodized", tier });
  const railTopSurface = useSurface({ surface: "railTop", tier });
  const tickSurface = useSurface({ surface: "paintedMarking", tier });

  return (
    <group name="Room">
      {/* The floor, as a slab rather than a plane. Large enough that its far
          edge is outside the frustum, so the eye never finds where the room
          stops, and thick enough that its near edge has a break to catch. */}
      <mesh
        name="Floor"
        geometry={bevelledSlab(40, 24, 0.6, BEVEL.plate)}
        material={floorSurface}
        position={[0, BENCH.floorY, 0]}
        receiveShadow={receiveShadow}
      />

      {/* The back wall. Matte, and the darkest surface in the room: it is what
          the beam and the housings are read against. Its front face sits at
          `backWallZ`, which is why it is offset by half its own thickness. */}
      <mesh
        name="BackWall"
        geometry={bevelledBox(40, 16, 0.5, BEVEL.plate)}
        material={wallSurface}
        position={[0, 1.4, BENCH.backWallZ - 0.25]}
        receiveShadow={receiveShadow}
      />

      {/* The rail body: anodized on every face the light can reach. */}
      <mesh
        name="OpticalRail"
        geometry={bevelledBox(RAIL_LENGTH, 0.22, BENCH.railDepth, BEVEL.rail)}
        material={railSurface}
        position={[0, BENCH.railY, 0]}
        castShadow={receiveShadow}
        receiveShadow={receiveShadow}
      />

      {/* The rail's ground top face, and the only low-roughness surface in the
          room. It is a separate mesh because it is a separate finish: on a real
          rail the top is ground flat after anodizing and the sides are not, and
          that difference is where the specular line down the bench comes from. */}
      <mesh
        name="RailTopFace"
        geometry={bevelledBox(RAIL_LENGTH, 0.035, BENCH.railDepth - 0.09, BEVEL.rail)}
        material={railTopSurface}
        position={[0, RAIL_TOP_Y - 0.0175, 0]}
        receiveShadow={receiveShadow}
      />

      {/* A recessed channel along the rail's top, so the light finds an edge
          rather than a flat face. This is the cheapest possible evidence of
          manufacture and it does more for the render than a texture would. */}
      <mesh
        name="RailChannel"
        geometry={bevelledBox(RAIL_LENGTH, 0.014, 0.14, BEVEL.marking, BEVEL_SEGMENTS.secondary)}
        material={railSurface}
        position={[0, RAIL_TOP_Y - 0.004, 0]}
      />

      <Instanced
        name="CalibrationTicks"
        geometry={bevelledBox(0.014, 0.008, 0.11, BEVEL.marking, BEVEL_SEGMENTS.secondary)}
        material={tickSurface}
        placements={tickPlacements}
      />
    </group>
  );
}
