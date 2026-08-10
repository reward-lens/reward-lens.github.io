/**
 * The five states of the instrument, as data.
 *
 * THIS FILE IS THE WHOLE CAMERA PATH AND THE WHOLE POSE TABLE. No component
 * chooses where the camera goes, because a camera move written inside a mesh
 * component is invisible to review and impossible to test without a GPU.
 * Everything here is plain numbers, so `tests/scene/runtime/` can assert that
 * an intermediate scroll position produces an intermediate pose, that reverse
 * scroll returns an assembly to the pose it held, and that no assembly with no
 * measurement behind it ever carries a non-zero `dataMix`.
 *
 * THE CAMERA IS PART OF THE ARGUMENT, WHICH IS WHY THERE IS NO ORBIT CONTROL.
 * The order of the five states is the order the training signal actually passes
 * through, and the camera walks the bench in that order: it starts where the
 * score is made, moves out along the fan to where the optimizer reads it,
 * settles on the update, then finds it has nowhere to go for the fourth state
 * and says so by retreating, and finally rises to look down the whole rail,
 * which is the only view in which a run reads as a length of time.
 *
 * The field of view narrows and never widens. 26 is the hero's, is correct, and
 * is the most visible difference between an instrument and a game camera; a
 * lens that opens up mid-movement undoes it in one frame.
 *
 * Exposure is declared per state because INTERFACES.md §4 puts it here rather
 * than in a component, and it is 1.00 in all five on purpose. The render
 * pipeline authors exposure per theme, 1.00 dark and 1.12 light, against
 * measured surface levels. A movement that also scaled it would be a second
 * opinion about the same value, and the two would drift the first time either
 * was retuned. If a state ever needs its own level, this is where it goes.
 */
import { BENCH } from "../core/layout";
import { INSTRUMENT_STATES, type InstrumentStateId } from "../types/truth";
import {
  catmullRom,
  clamp01,
  mixCamera,
  mixPoseMaps,
  pose,
  type AssemblyPose,
  type CameraPose,
} from "./pose";

/**
 * One state's authored definition.
 *
 * `cases` lists the manifest case ids this state can show, in the order a
 * subject selector offers them. The first is the default. A state whose cases
 * do not all exist in the generated manifest fails the runtime test, so a case
 * that is renamed by the generator cannot silently leave a control pointing at
 * nothing.
 */
export interface InstrumentStateDef {
  id: InstrumentStateId;
  camera: CameraPose;
  /** Assembly key to pose. A key absent here is at the identity: invisible. */
  assemblies: Record<string, AssemblyPose>;
  cases: readonly string[];
}

/**
 * Every scene object the movement can place, with the manifest encoding that
 * gives it its numbers.
 *
 * The keys are the object names the generated manifest already uses on the left
 * of every `visualProperty`, so this table and `src/data/scene/manifest.json`
 * cannot come apart without the runtime test naming the object that drifted.
 * `null` means the object carries no measured encoding, which is true of
 * exactly one of them.
 */
export const ASSEMBLY_CASE: Readonly<Record<string, string | null>> = {
  ScoreBand: "scorer-score-tree",
  ScorePoint: "scorer-score-tree",
  MutantRow: "scorer-verifier-is-equiv",
  AccessGateFull: "scorer-verifier-is-equiv",
  AccessGateLogOnly: "scorer-verifier-is-equiv",
  MetamorphicBar: "scorer-verifier-is-equiv",
  RankLadder: "scorer-attribution-patching",
  RankLink: "scorer-attribution-patching",
  DisagreementArc: "scorer-attribution-patching",
  DimensionRow: "scorer-attribution-patching",
  NullBand: "scorer-attribution-patching",
  RolloutRay: "selection-advantages",
  GroupBracket: "selection-advantages",
  UpdateVector: "update-step",
  EntropyTrace: "update-step",
  RewardTrace: "update-step",
  /**
   * The one object with no measurement behind it, and the reason the field
   * exists. `response-unresolved` is a schematic case: the generator refuses to
   * let it carry a quantitative encoding, so this object holds `dataMix` 0 for
   * the whole movement and the runtime test asserts it never rises.
   */
  ResidualGap: null,
  Trace: "run-boundary-series",
  EpisodeInsert: "run-boundary-series",
  TransitionBand: "run-boundary-series",
  DetectorMarker: "run-boundary-series",
};

/**
 * The five camera keyframes.
 *
 * Distances are solved against the bench rather than composed: the hero's
 * camera sits at z 15.05 because twelve world units have to span the canvas at
 * fov 26, and every position below keeps the same relationship to whatever part
 * of the bench it is framing. `BENCH.prismX` is 1.44 and `BENCH.detectorX` is
 * 6, so a camera that wants the fan in frame sits between them, not past them.
 */
const STATES: readonly InstrumentStateDef[] = [
  {
    // What made the number. The camera holds the hero's own framing so the
    // first state of the movement is continuous with the first viewport, then
    // eases a little toward the dispersing element as the reader reads.
    id: "scorer",
    camera: {
      position: [1.05, 1.35, 15.05],
      target: [0, 0, 0],
      fov: 26,
      exposure: 1,
    },
    assemblies: {
      ScoreBand: pose({ opacity: 1, emphasis: 1, dataMix: 1, position: [BENCH.prismX, 0, 0] }),
      ScorePoint: pose({ opacity: 0.85, emphasis: 0.5, dataMix: 1, position: [BENCH.prismX, 0, 0] }),
      RankLadder: pose({ opacity: 0.4, emphasis: 0.2, dataMix: 1, position: [BENCH.detectorX, 0, -0.4] }),
      RankLink: pose({ opacity: 0.3, emphasis: 0.15, dataMix: 1, position: [BENCH.detectorX, 0, -0.4] }),
      DisagreementArc: pose({ opacity: 0.3, emphasis: 0.15, dataMix: 1, position: [BENCH.detectorX, 0, -0.4] }),
      DimensionRow: pose({ opacity: 0.3, emphasis: 0.15, dataMix: 1, position: [BENCH.detectorX, 0, -0.4] }),
      NullBand: pose({ opacity: 0.3, emphasis: 0.15, dataMix: 1, position: [BENCH.detectorX, 0, -0.4] }),
      MutantRow: pose({ opacity: 0.35, emphasis: 0.2, dataMix: 1, position: [BENCH.sourceX + 0.9, 0, 0.6] }),
      AccessGateFull: pose({ opacity: 0.35, emphasis: 0.2, dataMix: 1, position: [BENCH.sourceX + 0.9, 0, 0.6] }),
      AccessGateLogOnly: pose({ opacity: 0.35, emphasis: 0.2, dataMix: 1, position: [BENCH.sourceX + 0.9, 0, 0.6] }),
      MetamorphicBar: pose({ opacity: 0.35, emphasis: 0.2, dataMix: 1, position: [BENCH.sourceX + 0.9, 0, 0.6] }),
    },
    cases: [
      "scorer-score-tree",
      "scorer-verifier-is-equiv",
      "scorer-verifier-swebench",
      "scorer-verifier-verl-gsm8k",
      "scorer-verifier-verl-search-r1",
      "scorer-attribution-patching",
    ],
  },
  {
    // What the optimizer actually saw. The camera moves out past the dispersing
    // element into the fan, where the individual rollouts are separable, and
    // drops slightly so the rays cross the frame rather than converging at it.
    id: "selection",
    camera: {
      position: [2.6, 1.0, 12.4],
      target: [1.9, 0, 0],
      fov: 25,
      exposure: 1,
    },
    assemblies: {
      ScoreBand: pose({ opacity: 0.28, emphasis: 0.1, dataMix: 1, position: [BENCH.prismX, 0, 0] }),
      ScorePoint: pose({ opacity: 0.2, emphasis: 0.05, dataMix: 1, position: [BENCH.prismX, 0, 0] }),
      RolloutRay: pose({ opacity: 1, emphasis: 1, dataMix: 1, position: [BENCH.prismX, 0, 0] }),
      GroupBracket: pose({ opacity: 0.9, emphasis: 0.7, dataMix: 1, position: [BENCH.prismX, 0, 0] }),
    },
    cases: ["selection-advantages"],
  },
  {
    // Where the update came from. Closer, and the frame tightens onto the
    // detector end where the rays are summed into one direction.
    id: "update",
    camera: {
      position: [4.1, 0.7, 10.6],
      target: [3.6, 0, -0.3],
      fov: 24,
      exposure: 1,
    },
    assemblies: {
      RolloutRay: pose({ opacity: 0.55, emphasis: 0.3, dataMix: 1, position: [BENCH.prismX, 0, 0] }),
      GroupBracket: pose({ opacity: 0.3, emphasis: 0.1, dataMix: 1, position: [BENCH.prismX, 0, 0] }),
      UpdateVector: pose({ opacity: 1, emphasis: 1, dataMix: 1, position: [BENCH.detectorX - 0.6, 0, 0] }),
      EntropyTrace: pose({ opacity: 0.8, emphasis: 0.4, dataMix: 1, position: [BENCH.detectorX - 0.6, 0.5, -0.5] }),
      RewardTrace: pose({ opacity: 0.8, emphasis: 0.4, dataMix: 1, position: [BENCH.detectorX - 0.6, -0.5, -0.5] }),
    },
    cases: ["update-step"],
  },
  {
    // What the policy became. There is nothing measured to approach, so the
    // camera retreats to the widest, most level view in the movement and holds
    // it. The emptiness is the content: the only object placed here carries a
    // permanent dataMix of 0 and the plate says why.
    id: "response",
    camera: {
      position: [2.2, 1.6, 16.2],
      target: [1.2, 0, -0.6],
      fov: 26,
      exposure: 1,
    },
    assemblies: {
      UpdateVector: pose({ opacity: 0.35, emphasis: 0.1, dataMix: 1, position: [BENCH.detectorX - 0.6, 0, 0] }),
      ResidualGap: pose({ opacity: 0.9, emphasis: 0.8, dataMix: 0, position: [BENCH.detectorX + 0.4, 0, -1.1] }),
    },
    cases: ["response-unresolved"],
  },
  {
    // What can be seen while the run is still changeable. The camera rises and
    // yaws to look down the length of the rail, which is the only view in which
    // 401 recorded steps read as a duration rather than as a stack.
    id: "run-boundary",
    camera: {
      position: [-1.4, 3.4, 13.2],
      target: [0.4, 0.2, -1.4],
      fov: 26,
      exposure: 1,
    },
    assemblies: {
      ResidualGap: pose({ opacity: 0.2, emphasis: 0.05, dataMix: 0, position: [BENCH.detectorX + 0.4, 0, -1.1] }),
      Trace: pose({ opacity: 1, emphasis: 1, dataMix: 1, position: [0, 0.2, -1.2] }),
      EpisodeInsert: pose({ opacity: 0.7, emphasis: 0.3, dataMix: 1, position: [0, -0.6, -1.2] }),
      TransitionBand: pose({ opacity: 0.85, emphasis: 0.6, dataMix: 1, position: [0, 0.2, -1.2] }),
      DetectorMarker: pose({ opacity: 1, emphasis: 0.9, dataMix: 1, position: [0, 0.2, -1.2] }),
    },
    cases: ["run-boundary-series"],
  },
];

export const STATE_DEFS: Readonly<Record<InstrumentStateId, InstrumentStateDef>> =
  Object.fromEntries(STATES.map((s) => [s.id, s])) as Record<
    InstrumentStateId,
    InstrumentStateDef
  >;

export const STATE_ORDER: readonly InstrumentStateId[] = INSTRUMENT_STATES;

export function stateIndex(id: InstrumentStateId): number {
  const i = STATE_ORDER.indexOf(id);
  return i < 0 ? 0 : i;
}

/** The default case a state shows before any subject selector is touched. */
export function defaultCase(id: InstrumentStateId): string {
  return STATE_DEFS[id].cases[0];
}

/** Every case the movement can reach, in state order. Used by the gate. */
export const ALL_CASES: readonly string[] = STATES.flatMap((s) => s.cases);

/**
 * The one continuous scroll parameter, 0 at the top of the first state and 1 at
 * the bottom of the last.
 *
 * Local progress is per state and is what the observer measures; this collapses
 * it into the single number the camera path is sampled by, so that the path is
 * a curve through five points rather than four independent blends that corner
 * at every keyframe.
 */
export function globalProgress(active: InstrumentStateId, local: number): number {
  const span = STATE_ORDER.length - 1;
  return clamp01((stateIndex(active) + clamp01(local)) / span);
}

const CAMERA_POSITIONS = STATES.map((s) => s.camera.position);
const CAMERA_TARGETS = STATES.map((s) => s.camera.target);

/**
 * The instrument's placement at any position in the movement, keyframe or not.
 *
 * A reader can stop anywhere, so this is defined everywhere and is continuous.
 * The camera rides the spline; the assemblies interpolate linearly between the
 * state they are in and the one after it, because an assembly's opacity easing
 * on a curve is exactly the value that feels late when the reader scrolls back.
 *
 * At the last state there is no state after it, so the poses hold. That is a
 * hold and not a snap: `mixPoseMaps` against the same map is the identity.
 */
export function instrumentPoseAt(
  active: InstrumentStateId,
  local: number,
): { camera: CameraPose; assemblies: Record<string, AssemblyPose>; progress: number } {
  const k = clamp01(local);
  const i = stateIndex(active);
  const next = STATES[Math.min(i + 1, STATES.length - 1)];
  const here = STATES[i];
  const progress = globalProgress(active, k);

  // Position and target come off the spline; fov and exposure are linear
  // between the two states, which is what a lens actually does.
  const scalar = mixCamera(here.camera, next.camera, k);
  const camera: CameraPose = {
    position: catmullRom(CAMERA_POSITIONS, progress),
    target: catmullRom(CAMERA_TARGETS, progress),
    fov: scalar.fov,
    exposure: scalar.exposure,
  };

  return {
    camera,
    assemblies: mixPoseMaps(here.assemblies, next.assemblies, k),
    progress,
  };
}
