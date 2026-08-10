/**
 * The selection stage: where a score becomes an advantage.
 *
 * Three objects, in the order the quantity passes through them. A grouping slit
 * with two apertures, because GRPO does not compare a rollout to a baseline, it
 * compares it to the other members of its group, and the group is the whole
 * mechanism. An advantage modulator, which is the element that displaces each
 * path by what the algorithm actually computed. And eight rollout rays, which
 * are the eight recorded trajectories of one step.
 *
 * ------------------------------------------------------------------------
 * EIGHT RAYS, AND WHY THAT IS ENOUGH
 * ------------------------------------------------------------------------
 *
 * `EVIDENCE-VERDICTS.md` §4 is unambiguous about what this record does and does
 * not hold. `advantage` on trajectories is real and fully populated, zero nulls
 * in 800 checked, and step 0's eight values are on file. `advantage_tokens` is
 * null on all 1,600, `n_tokens` is 0 on all of them, and the per-turn
 * `step_advantage` is null. So there is no token-level advantage in this record
 * and no per-position geometry can be derived from it. A "107 trained
 * positions" visual is not available, and the version of this stage that drew
 * one would have been the fourth time in this build's history a central visual
 * turned out to have no measured instance behind it.
 *
 * Eight real signed advantages per step, 200 steps deep, is what there is. The
 * eight rays are those eight values. They are drawn at their real sign and
 * magnitude, they sum to zero within each group because that is what the
 * normalisation does, and the reader can count them.
 *
 * THE GROUP BRACKETS ARE THE BASELINE MADE VISIBLE. `group.mean` is where the
 * bracket sits and `group.std` is how far it opens: the two numbers a rollout's
 * advantage is computed against. Drawing them beside the rays is what stops the
 * displacement looking like a property of the rollout rather than a comparison.
 */
import { useMemo } from "react";
import type { ScenePalette } from "../core/palette";
import type { SceneTier } from "../runtime/tier";
import { useSurface, BEVEL, BEVEL_SEGMENTS } from "../materials";
import {
  annulus,
  bevelledBox,
  openTube,
  turnedCylinder,
  type AssemblyBounds,
} from "../geometry/profiles";
import { useLight } from "./light";
import { Instanced, type Placement } from "./Instanced";
import { STATIONS } from "./stations";
import { column, extent, normalise, readPayload } from "./payload";

interface Props {
  palette: ScenePalette;
  tier: SceneTier;
  /** Which recorded step's eight rollouts are on the bench. */
  step: number;
  emphasis: number;
  /** One rollout followed through the instrument, or null. Index within the step. */
  traced: number | null;
  castShadow: boolean;
}

/** Eight rollouts a step, in two groups of four. Both asserted below. */
const ROLLOUTS_PER_STEP = 8;
const GROUPS_PER_STEP = 2;

/**
 * Where the rays run: out of the slit, through the modulator, and no further.
 *
 * THE FIRST VERSION RAN THEM TO `STATIONS.integrating - 0.34`, WHICH IS PAST
 * WHERE THE UPDATE'S CONTRIBUTION VECTORS BEGIN. Shot at 1440 the two sets
 * overlapped for a quarter of the bench and, being the same weight and the
 * same near-white, read as one grey scribble between the modulator and the
 * lens: eight rollouts and eight contributions in the same pixels, with no
 * seam an eye could find. They are different claims. The rollout rays are
 * eight recorded advantages; the contribution vectors are apparatus with no
 * quantity on them at all, and a reader who cannot tell where one ends has
 * been shown a measurement that reaches further than it does.
 *
 * So the rays stop just clear of the modulator's exit face, which is also the
 * last element in this stage, and `SELECTION_BOUNDS.attachments.exit` is where
 * they stop. `UpdateAssembly` reads that attachment rather than choosing its
 * own start, which is what the published bounds are for.
 */
const RAY_FROM = STATIONS.groupingSlit + 0.06;
const RAY_TO = STATIONS.modulator + 0.26;

/**
 * The largest displacement a ray may take, in world units.
 *
 * Set by the room rather than by the data: half the optical axis's clear height
 * above the rail, so the most extreme recorded advantage puts a ray at the edge
 * of the space the bench actually has and nothing is ever drawn outside it. The
 * recorded range is symmetric, -1.4916 to +1.4937, so a symmetric envelope is
 * the honest one.
 */
const MAX_OFFSET = 0.42;

/**
 * The vertical envelope the eight rays occupy, published for the update stage.
 *
 * It is room geometry and not a measurement, which is why it can be shared: the
 * update's contribution fan opens to the same height the rays arrive at, so the
 * two stages read as one path rather than as two drawings at different scales.
 * Nothing downstream may treat it as a quantity.
 */
export const SELECTION_ENVELOPE = MAX_OFFSET;

export const SELECTION_BOUNDS: AssemblyBounds = {
  name: "SelectionAssembly",
  origin: [STATIONS.groupingSlit, 0, 0],
  extent: [RAY_TO - STATIONS.groupingSlit, 1.0, 0.5],
  attachments: {
    slit: [STATIONS.groupingSlit, 0, 0],
    modulator: [STATIONS.modulator, 0, 0],
    exit: [RAY_TO, 0, 0],
  },
};

export function SelectionAssembly({
  palette,
  tier,
  step,
  emphasis,
  traced,
  castShadow,
}: Props) {
  const payload = readPayload("selection-advantages");

  const anodized = useSurface({ surface: "anodized", tier });
  const machined = useSurface({ surface: "machined", tier });
  const marking = useSurface({ surface: "paintedMarking", tier });
  const glass = useSurface({ surface: "opticalGlass", tier });

  const rayLight = useLight("ray", palette, undefined, emphasis);
  const idleLight = useLight("rayIdle", palette, undefined, emphasis);
  const bracketLight = useLight("control", palette, undefined, emphasis);

  /**
   * This step's eight advantages, their groups, and the two brackets.
   *
   * `step_index` and `group_ordinal` are read rather than assumed: the payload
   * is 1,600 trajectories flattened in step order and it would be tempting to
   * slice it at `step * 8`. That is true of this record and it is true only
   * because the generator wrote it that way, so the slice is taken and then
   * checked against the recorded step index. A silent mis-slice would draw
   * eight real advantages from the wrong step, which is the worst class of
   * error this scene can make: entirely truthful numbers, entirely wrong claim.
   */
  const selection = useMemo(() => {
    const advantage = column(payload, "advantage");
    const stepIndex = column(payload, "step_index");
    const groupOrdinal = column(payload, "group_ordinal");
    const groupMean = column(payload, "group.mean");
    const groupStd = column(payload, "group.std");
    const groupK = column(payload, "group.k");

    const stepCount = advantage.length / ROLLOUTS_PER_STEP;
    const at = Math.max(0, Math.min(stepCount - 1, Math.round(step)));
    const base = at * ROLLOUTS_PER_STEP;

    if (stepIndex[base] !== at) {
      throw new Error(
        `[scene/selection] trajectory ${base} reports step ${stepIndex[base]} and the instrument is on step ${at}. ` +
          "The payload is not flat in step order and this assembly assumed it was.",
      );
    }

    const domain = extent(advantage);
    const symmetric = Math.max(Math.abs(domain[0]), Math.abs(domain[1])) || 1;

    const rollouts = Array.from({ length: ROLLOUTS_PER_STEP }, (_, k) => {
      const j = base + k;
      return {
        index: k,
        advantage: advantage[j],
        group: groupOrdinal[j],
        /** The one encoding: signed advantage over the record's own envelope. */
        offset: (advantage[j] / symmetric) * MAX_OFFSET,
      };
    });

    const groupBase = at * GROUPS_PER_STEP;
    const meanDomain = extent(groupMean);
    const brackets = Array.from({ length: GROUPS_PER_STEP }, (_, g) => {
      const j = groupBase + g;
      return {
        ordinal: g,
        centre: (normalise(groupMean[j], meanDomain) * 2 - 1) * MAX_OFFSET * 0.55,
        halfSpan: (groupStd[j] / symmetric) * MAX_OFFSET,
        rayCount: groupK[j],
      };
    });

    const declaredK = brackets.reduce((sum, b) => sum + b.rayCount, 0);
    if (declaredK !== ROLLOUTS_PER_STEP) {
      throw new Error(
        `[scene/selection] the two groups declare ${declaredK} rollouts and eight rays are drawn`,
      );
    }

    return { rollouts, brackets, step: at, symmetric };
  }, [payload, step]);

  /**
   * The rays. One instanced batch per emphasis class, so a traced rollout is a
   * different draw from the seven it is being compared to rather than a
   * different colour smuggled into one.
   *
   * A ray's length is the axial run and its offset is the advantage; the tube
   * is unit length and scaled, which is what lets eight rays be one buffer.
   */
  const rayLength = RAY_TO - RAY_FROM;
  const rays = useMemo(() => {
    const lit: Placement[] = [];
    const idle: Placement[] = [];
    for (const r of selection.rollouts) {
      const placement: Placement = {
        position: [RAY_FROM + rayLength / 2, r.offset, groupZ(r.group)],
        rotation: [0, 0, Math.PI / 2],
        scale: [1, rayLength, 1],
      };
      if (traced === null || traced === r.index) lit.push(placement);
      else idle.push(placement);
    }
    return { lit, idle };
  }, [selection, traced, rayLength]);

  /**
   * The brackets: two pairs of jaws at the group's mean, opened by its spread.
   *
   * Instanced as four marks rather than drawn as a shape, because a bracket is
   * two marks and an extent, and drawing it as a filled span would make the
   * standard deviation look like a region something was measured inside.
   */
  const brackets = useMemo<Placement[]>(() => {
    const out: Placement[] = [];
    for (const b of selection.brackets) {
      for (const sign of [-1, 1]) {
        out.push({
          position: [
            STATIONS.modulator + 0.2,
            b.centre + sign * b.halfSpan,
            groupZ(b.ordinal),
          ],
        });
      }
    }
    return out;
  }, [selection]);

  return (
    <group name="SelectionAssembly">
      {/* The grouping slit. Two apertures in one plate, because the record has
          two groups of four and the group is what the advantage is computed
          against. A single slit here would draw eight independent rollouts,
          which is the wrong algorithm. */}
      <mesh
        name="GroupingSlitBody"
        geometry={bevelledBox(0.07, 0.72, 0.46, BEVEL.plate)}
        material={anodized}
        position={[STATIONS.groupingSlit, 0, 0]}
        castShadow={castShadow}
        receiveShadow
      />
      {[0, 1].map((g) => (
        <mesh
          key={g}
          name={`GroupAperture${g}`}
          geometry={annulus(0.038, 0.075, 28)}
          material={machined}
          position={[STATIONS.groupingSlit + 0.04, 0, groupZ(g)]}
          rotation={[0, Math.PI / 2, 0]}
        />
      ))}
      <mesh
        name="GroupingSlitLabel"
        geometry={bevelledBox(0.04, 0.005, 0.14, BEVEL.marking, BEVEL_SEGMENTS.secondary)}
        material={marking}
        position={[STATIONS.groupingSlit, -0.3, 0.232]}
        rotation={[Math.PI / 2, 0, 0]}
      />

      {/* The advantage modulator: a barrel with an element in it, and the one
          station on the bench whose job is to displace rather than to pass. */}
      <mesh
        name="ModulatorBarrel"
        geometry={turnedCylinder(0.24, 0.34, tier === "low" ? 24 : 40, 0.012)}
        material={anodized}
        position={[STATIONS.modulator, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow={castShadow}
        receiveShadow
      />
      <mesh
        name="ModulatorElement"
        geometry={annulus(0, 0.2, tier === "low" ? 24 : 40)}
        material={glass}
        position={[STATIONS.modulator + 0.171, 0, 0]}
        rotation={[0, Math.PI / 2, 0]}
      />

      {/* The eight recorded rollouts. */}
      <Instanced
        name="RolloutRays"
        geometry={openTube(0.012, 1, 8)}
        material={rayLight}
        placements={rays.lit}
      />
      <Instanced
        name="RolloutRaysIdle"
        geometry={openTube(0.009, 1, 8)}
        material={idleLight}
        placements={rays.idle}
      />

      {/* The two group brackets: mean, and the spread the advantage is against. */}
      <Instanced
        name="GroupBrackets"
        geometry={bevelledBox(0.1, 0.008, 0.06, BEVEL.marking, BEVEL_SEGMENTS.secondary)}
        material={bracketLight}
        placements={brackets}
      />
    </group>
  );
}

/**
 * The two groups are separated in depth, not in height.
 *
 * Height is the advantage. If the groups were separated vertically as well, a
 * reader could not tell a group offset from an advantage, and the two things
 * that must stay distinguishable in this state would be on the same axis. So
 * the groups sit at two depths and the advantage owns y alone.
 */
function groupZ(group: number): number {
  return group === 0 ? -0.09 : 0.09;
}
