/**
 * The four downstream stations and the run timeline, mounted together.
 *
 * They are one component rather than five siblings in the scene root for two
 * reasons that are both about the boundary around them. First, every one of
 * them reads a generated payload, so they suspend, and the boundary that
 * catches that must not contain the render pipeline: `data-scene-ready` is what
 * fades the canvas in over the hand-authored room and what gate 26 waits for,
 * and a tree that suspends above the pipeline draws no frames and therefore
 * never sets it. Second, their mounting hardware is one instanced batch across
 * all five stations, which cannot be assembled if each station owns its own.
 *
 * WHAT DRIVES THEM, AND WHAT DOES NOT YET. `activeState` and `step` are props
 * with defaults. The DOM controls and the scroll binding that will set them are
 * a different packet's, and this one deliberately does not build them: what it
 * builds is the thing they will drive, with every station present at once and
 * only the light in them changing. A reader at the default sees the scorer
 * state lit and the other four stations standing dark on the same rail, which
 * is what an optical bench looks like when you are using one instrument on it.
 */
import { useMemo } from "react";
import type { ScenePalette } from "../core/palette";
import type { SceneTier } from "../runtime/tier";
import type { InstrumentStateId } from "../types/truth";
import { Mounts, type MountRequest } from "./Mounts";
import { ScoreAssembly } from "./ScoreAssembly";
import { SelectionAssembly } from "./SelectionAssembly";
import { UpdateAssembly } from "./UpdateAssembly";
import { PolicyAssembly } from "./PolicyAssembly";
import { RunAssembly } from "./RunAssembly";
import { STATIONS, emphasisFor } from "./stations";
import { Budget } from "./Budget";

interface Props {
  palette: ScenePalette;
  tier: SceneTier;
  /** Which of the five states is the subject. Everything else stays present. */
  activeState?: InstrumentStateId;
  /** Which recorded optimizer step the instrument is set to, 0 to 199. */
  step?: number;
  /** One rollout followed through the instrument, by index within the step. */
  traced?: number | null;
  castShadow: boolean;
}

/**
 * The height of each station's post, from the underside of what it carries.
 *
 * Written here rather than inside each assembly because the posts are one
 * instanced batch and a batch cannot be assembled from five components that
 * each know only their own height. Each number is the underside of that
 * station's lowest body, so a change to a housing's size is a change in one
 * place and the post follows it.
 */
const MOUNTS: MountRequest[] = [
  { x: STATIONS.inputPlate, headY: -0.26 },
  { x: STATIONS.dispersing, headY: -0.45 },
  { x: STATIONS.groupingSlit, headY: -0.36 },
  { x: STATIONS.modulator, headY: -0.24 },
  { x: STATIONS.integrating, headY: -0.25 },
  { x: STATIONS.policyPlanes, headY: -0.29 },
  { x: STATIONS.detector, headY: -0.25 },
];

export function Downstream({
  palette,
  tier,
  activeState = "scorer",
  step = 0,
  traced = null,
  castShadow,
}: Props) {
  const emphasis = useMemo(
    () => ({
      scorer: emphasisFor(activeState === "scorer"),
      selection: emphasisFor(activeState === "selection"),
      update: emphasisFor(activeState === "update"),
      response: emphasisFor(activeState === "response"),
      runBoundary: emphasisFor(activeState === "run-boundary"),
    }),
    [activeState],
  );

  return (
    <group name="Downstream">
      <Budget tier={tier} />
      <Mounts tier={tier} mounts={MOUNTS} castShadow={castShadow} />
      <ScoreAssembly
        palette={palette}
        tier={tier}
        step={step}
        emphasis={emphasis.scorer}
        castShadow={castShadow}
      />
      <SelectionAssembly
        palette={palette}
        tier={tier}
        step={step}
        emphasis={emphasis.selection}
        traced={traced}
        castShadow={castShadow}
      />
      <UpdateAssembly
        palette={palette}
        tier={tier}
        step={step}
        emphasis={emphasis.update}
        castShadow={castShadow}
      />
      <PolicyAssembly
        palette={palette}
        tier={tier}
        emphasis={emphasis.response}
        castShadow={castShadow}
      />
      <RunAssembly
        palette={palette}
        tier={tier}
        emphasis={emphasis.runBoundary}
        castShadow={castShadow}
      />
    </group>
  );
}

/** The mounting hardware's placements, published for the tests. */
export const DOWNSTREAM_MOUNTS = MOUNTS;
