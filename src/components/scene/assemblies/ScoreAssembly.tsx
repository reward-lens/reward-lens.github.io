/**
 * The scorer: where influence entering the bench is separated into what the
 * grader actually rewarded.
 *
 * An input plate defines the beam, a dispersing element separates it, and what
 * leaves is a band per score component. The band travels the length of the
 * bench to the readout at the detector plane, because the thing being separated
 * here is the same thing the update state later integrates, and putting them in
 * one optical path is the only drawing of that which is true.
 *
 * ------------------------------------------------------------------------
 * THERE IS ONE BAND, AND THAT IS THE RESULT
 * ------------------------------------------------------------------------
 *
 * `SCENE.md` §2 draws six bands, and six is what a spectrum wants to be. The
 * recorded run has `scores.leafCount` of **1**: a single grader leaf named
 * `length_reward`. So one band leaves the element, and the empty fan where five
 * more would be is the honest content of this state rather than a gap in it.
 *
 * The temptation to draw six is exactly the temptation `EVIDENCE-VERDICTS.md`
 * exists to refuse. There IS a six-component decomposition on this site, and it
 * has no per-item artifact: the reward composition counterfactual is prose in a
 * build record, its 25% and its 2,118 sign reversals exist in two table cells,
 * and the verdict is that **no scene band, ray, width or count may encode it**.
 * A six-band fan here would be that encoding, dressed as a spectrum.
 *
 * WHAT THE BAND'S GEOMETRY MEANS, and every one of these is declared in the
 * manifest's `encodings` for `scorer-score-tree` rather than decided here:
 *
 *   axial offset   `rewards/length_reward/mean` over 200 steps. The band leaves
 *                  the element deflected by the mean score, so the whole fan
 *                  rides up as the grader's mean rises.
 *   angular width  `rewards/length_reward/std`. The band opens out by the
 *                  spread, so a step where the eight rollouts agreed is a
 *                  narrow band and a step where they did not is a wide one.
 *   point position `scores.leaf.value`, 1,600 recorded leaf values placed
 *                  across the band's width at the radius their value gives.
 *   point absent   `scores.leaf.abstained`. An abstention is a gap in the row,
 *                  not a point at zero, because the grader returning nothing
 *                  and the grader returning zero are different events.
 */
import { useEffect, useMemo } from "react";
import type { ScenePalette } from "../core/palette";
import type { SceneTier } from "../runtime/tier";
import { useSurface, BEVEL, BEVEL_SEGMENTS } from "../materials";
import {
  annulus,
  bandRibbon,
  bevelledBox,
  pointSolid,
  wedgePrism,
  type AssemblyBounds,
} from "../geometry/profiles";
import { useLight } from "./light";
import { Instanced, type Placement } from "./Instanced";
import { STATIONS } from "./stations";
import { column, extent, normalise, readPayload, scalar } from "./payload";

/**
 * Eight rollouts per recorded step, everywhere in this record.
 *
 * Asserted rather than assumed: `n_trajectories` is 8 on all 200 steps and
 * `group.k` is 4 on all 400 groups. It is named here because three assemblies
 * index a flattened 1,600 by it and a silent 8 in an index expression is the
 * kind of constant that survives the record changing under it.
 */
const ROLLOUTS_PER_STEP = 8;

interface Props {
  palette: ScenePalette;
  tier: SceneTier;
  /** Which recorded step the instrument is set to. Clamped to the record. */
  step: number;
  /** 0 when another state is the subject, 1 when this one is. */
  emphasis: number;
  castShadow: boolean;
}

/** The element's own size. A wedge this tall is 4% of frame at the hero camera. */
const WEDGE = { width: 0.62, height: 0.66, depth: 0.46 };

/** Where the band starts, leaves and lands. */
const EXIT_X = STATIONS.dispersing + WEDGE.width / 2;
const BAND_LENGTH = STATIONS.detector - 0.22 - EXIT_X;

export const SCORE_BOUNDS: AssemblyBounds = {
  name: "ScoreAssembly",
  origin: [STATIONS.dispersing, 0, 0],
  extent: [STATIONS.detector - STATIONS.inputPlate, 1.2, 0.6],
  attachments: {
    entrance: [STATIONS.inputPlate, 0, 0],
    exit: [EXIT_X, 0, 0],
    /** What a DOM readout aligns to. The only anchor this packet publishes. */
    readout: [STATIONS.detector - 0.2, 0, 0.02],
  },
};

export function ScoreAssembly({ palette, tier, step, emphasis, castShadow }: Props) {
  const payload = readPayload("scorer-score-tree");

  const anodized = useSurface({ surface: "anodized", tier });
  const machined = useSurface({ surface: "machined", tier });
  const marking = useSurface({ surface: "paintedMarking", tier });
  const detectorFace = useSurface({ surface: "detectorFace", tier });
  const glass = useSurface({ surface: "opticalGlass", tier });

  const bandLight = useLight("band", palette, "--comp-1", emphasis);
  const pointLight = useLight("band", palette, "--comp-2", emphasis);
  const core = useLight("core", palette);

  /**
   * The band's shape at this step, read off the record.
   *
   * `leafCount` is asserted rather than assumed: the geometry below draws one
   * band, and if a future record has more leaves this throws instead of
   * silently drawing the first one and captioning it as all of them.
   */
  const band = useMemo(() => {
    const leafCount = scalar(payload, "scores.leafCount");
    if (leafCount !== 1) {
      throw new Error(
        `[scene/score] the record has ${leafCount} grader leaves and this assembly draws one band per leaf. ` +
          "Widen the fan deliberately rather than letting one band stand for several.",
      );
    }
    const means = column(payload, "rewards/length_reward/mean");
    const stds = column(payload, "rewards/length_reward/std");
    const at = Math.max(0, Math.min(means.length - 1, Math.round(step)));

    /**
     * The two transforms, and both are stated in the manifest.
     *
     * `mean` runs 1.014 to 1.623 across the record and `std` runs 0.068 to
     * 0.837. Neither is normalised against a constant chosen here: the domain
     * is the record's own range, so a band at the record's widest step is the
     * widest band the instrument can draw and the reader is not looking at a
     * value clamped against a number nobody wrote down.
     */
    const meanDomain = extent(means);
    const stdDomain = extent(stds);
    const axialOffset = 0.06 + 0.34 * normalise(means[at], meanDomain);
    const halfWidthAtExit = 0.02 + 0.06 * normalise(stds[at], stdDomain);
    const halfWidthAtDetector = 0.07 + 0.34 * normalise(stds[at], stdDomain);

    return {
      leafCount,
      axialOffset,
      halfWidthAtExit,
      halfWidthAtDetector,
      step: at,
    };
  }, [payload, step]);

  /**
   * The ribbon. Built per step, because its width IS the step's spread and a
   * cached buffer would be a band that stopped meaning anything.
   */
  const ribbon = useMemo(
    () =>
      bandRibbon(
        BAND_LENGTH,
        (t) => band.halfWidthAtExit + (band.halfWidthAtDetector - band.halfWidthAtExit) * t,
        tier === "low" ? 12 : 28,
        band.axialOffset,
      ),
    [band, tier],
  );

  /**
   * And freed when it is replaced, which is the half `bandRibbon` cannot do.
   *
   * Every other buffer on this bench comes out of `geometry/profiles.ts`, which
   * caches on its arguments and hands the whole cache to `disposeGeometries()`
   * on unmount. A ribbon cannot join that cache: its shape is a function of a
   * step, so keying it would be keying on 200 distinct widths and the cache
   * would become the leak instead of the fix. So it is built uncached, and the
   * consequence is that nothing else in the tree owns it. The scroll binding
   * that will drive `step` walks 200 recorded steps; without this, that walk is
   * 200 abandoned vertex buffers on the GPU by the end of one read.
   *
   * The cleanup runs after the replacement has been committed, so the mesh is
   * already pointing at the new buffer when the old one goes.
   */
  useEffect(() => () => ribbon.dispose(), [ribbon]);

  /**
   * This step's eight recorded leaf values, where the band lands.
   *
   * ------------------------------------------------------------------------
   * THE FIRST VERSION OF THIS DREW AN ENCODING NOBODY DECLARED
   * ------------------------------------------------------------------------
   *
   * It placed all 1,600 leaf values along the band's length, spaced by step
   * ordinal. Shot at 1440, that read as a dense white hatch inside the band and
   * looked like a texture, which was the visible half of the problem. The other
   * half is worse and was not visible: putting a point's AXIAL position at its
   * step ordinal is a second encoding, and the manifest declares exactly two
   * for a score point, `radialPosition <- scores.leaf.value` and
   * `absent <- scores.leaf.abstained`. Axial position was not among them. A
   * reader would have been looking at a length that meant time, on a
   * construction whose caption says nothing about time.
   *
   * So the points are the eight rollouts of the step the instrument is set to,
   * placed across the band's width at the radius their value gives, all at the
   * readout end where the band lands. Eight points a reader can count, each one
   * a recorded number, and no claim about the axis they sit on.
   *
   * An abstention is a gap rather than a point at the bottom of the range. One
   * eighth of the record's leaf values are abstentions, and a point at the
   * baseline would say the grader scored that rollout lowest when what it did
   * was decline to score it.
   */
  const points = useMemo<Placement[]>(() => {
    const values = column(payload, "scores.leaf.value");
    const abstained = column(payload, "scores.leaf.abstained");
    const domain = extent(values);
    const base = band.step * ROLLOUTS_PER_STEP;
    const out: Placement[] = [];
    for (let k = 0; k < ROLLOUTS_PER_STEP; k += 1) {
      const j = base + k;
      if (j >= values.length) continue;
      if (abstained[j] === 1) continue;
      const radial = normalise(values[j], domain);
      out.push({
        position: [
          EXIT_X + BAND_LENGTH - 0.02,
          band.axialOffset + (radial * 2 - 1) * band.halfWidthAtDetector,
          0,
        ] as const,
      });
    }
    return out;
  }, [payload, band]);

  return (
    <group name="ScoreAssembly">
      {/* The entrance aperture. A plate with a stop in it, standing between the
          source and the element, so the beam that enters the glass has been
          defined by something rather than merely arriving. */}
      <mesh
        name="InputPlate"
        geometry={bevelledBox(0.06, 0.52, 0.44, BEVEL.plate)}
        material={anodized}
        position={[STATIONS.inputPlate, 0, 0]}
        castShadow={castShadow}
        receiveShadow
      />
      <mesh
        name="InputStop"
        geometry={annulus(0.05, 0.12, 32)}
        material={machined}
        position={[STATIONS.inputPlate + 0.032, 0, 0]}
        rotation={[0, Math.PI / 2, 0]}
      />
      <mesh
        name="InputPlateLabel"
        geometry={bevelledBox(0.04, 0.005, 0.13, BEVEL.marking, BEVEL_SEGMENTS.secondary)}
        material={marking}
        position={[STATIONS.inputPlate, -0.19, 0.222]}
        rotation={[Math.PI / 2, 0, 0]}
      />

      {/* The mount the element sits in: a kinematic base with the wedge on it.
          Without the base the prism is a floating solid, which is the one thing
          the whole bench exists to stop this scene being. */}
      <mesh
        name="DispersingMount"
        geometry={bevelledBox(0.46, 0.1, 0.5, BEVEL.plate)}
        material={anodized}
        position={[STATIONS.dispersing, -0.4, 0]}
        castShadow={castShadow}
        receiveShadow
      />

      {/* The dispersing element itself. Transmissive at the high tier, a
          low-roughness dielectric with a Fresnel rim below it: at 4% of frame
          the refraction was carrying two pixels of colour and the rim is the
          part of "this is glass" the eye actually reads. */}
      <mesh
        name="DispersingElement"
        geometry={wedgePrism(WEDGE.width, WEDGE.height, WEDGE.depth, BEVEL.plate, 0.03)}
        material={glass}
        position={[STATIONS.dispersing, -0.02, 0]}
        castShadow={castShadow}
      />

      {/* The band. One, because the record has one grader leaf. */}
      <mesh
        name="ScoreBand"
        geometry={ribbon}
        material={bandLight}
        position={[EXIT_X, 0, 0]}
      />

      {/* The recorded leaf values, one instanced batch. */}
      <Instanced
        name="ScorePoints"
        geometry={pointSolid(0.012)}
        material={pointLight}
        placements={points}
      />

      {/* The readout: a detector can with its sensitive face toward the band,
          and a target ring on that face which is what the DOM readout lines up
          with. The anchor is published in SCORE_BOUNDS rather than measured off
          the mesh by whoever needs it. */}
      <mesh
        name="ReadoutCan"
        geometry={bevelledBox(0.3, 0.62, 0.5, BEVEL.housing)}
        material={anodized}
        position={[STATIONS.detector, 0.06, 0]}
        castShadow={castShadow}
        receiveShadow
      />
      <mesh
        name="ReadoutFace"
        geometry={bevelledBox(0.03, 0.52, 0.4, BEVEL.marking, BEVEL_SEGMENTS.secondary)}
        material={detectorFace}
        position={[STATIONS.detector - 0.165, 0.06, 0]}
      />
      <mesh
        name="ReadoutAnchor"
        geometry={annulus(0.05, 0.062, 28)}
        material={core}
        position={[STATIONS.detector - 0.148, band.axialOffset, 0]}
        rotation={[0, -Math.PI / 2, 0]}
      />
      <mesh
        name="ReadoutLabel"
        geometry={bevelledBox(0.005, 0.05, 0.2, BEVEL.marking, BEVEL_SEGMENTS.secondary)}
        material={marking}
        position={[STATIONS.detector - 0.168, -0.19, 0]}
      />
    </group>
  );
}
