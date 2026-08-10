/**
 * The scene's objects, in words a reader can use.
 *
 * The legend names parts of the instrument, so it needs prose. The renderer
 * names the same parts `RolloutRay` and `TransitionBand`, which are identifiers
 * and belong in a data attribute rather than on the page: `copy.yaml`'s `ui`
 * block sets that precedent explicitly, for the same reason, on the claim
 * disclosure's technical control.
 *
 * WHERE THESE STRINGS BELONG. In `design/copy.yaml`, under `ui`, which is the
 * frozen owner of every user-facing string on this site. That file is the build
 * lead's and this packet may not edit it, so the labels sit here with the exact
 * keys proposed in the handoff. Moving them is a mechanical change and nothing
 * else reads them.
 *
 * THE LIST IS DERIVED, NOT DECLARED. `objectsForCase` reads the generated
 * manifest and takes the object name off the left of every `visualProperty`, so
 * the legend for a case is exactly the set of objects that case's encodings
 * actually drive. A label missing from the table below fails the build naming
 * the object, which is what stops the legend from quietly listing four of five
 * parts after the generator adds one.
 */
import { caseById, manifest } from "./facts";
import type { SceneCase } from "../scene/types/truth";

export interface SceneObjectLabel {
  /** What the legend button says. */
  label: string;
  /** One clause on what the part is, shown beside the button. */
  gloss: string;
}

const LABELS: Readonly<Record<string, SceneObjectLabel>> = {
  ScoreBand: {
    label: "Score band",
    gloss: "one band per leaf of the score tree, placed at that leaf's mean and widened by its spread",
  },
  ScorePoint: {
    label: "Rollout scores",
    gloss: "one point per rollout at the value the grader returned, or absent where it abstained",
  },
  MutantRow: {
    label: "Mutation row",
    gloss: "one tick per competent mutant, lit where the grader caught it",
  },
  AccessGateFull: {
    label: "Full-access read",
    gloss: "the card fields a reader with full access to the grader can see",
  },
  AccessGateLogOnly: {
    label: "Log-only read",
    gloss: "the same fields for a reader who has only the training log",
  },
  MetamorphicBar: {
    label: "Metamorphic violations",
    gloss: "pairs where an equivalence-preserving rewrite changed the verdict",
  },
  RankLadder: {
    label: "Rank ladder",
    gloss: "each component's place under attribution beside its place under patching",
  },
  RankLink: {
    label: "Rank links",
    gloss: "the line joining one component's two ranks, heavier where they disagree",
  },
  DisagreementArc: {
    label: "Disagreement arc",
    gloss: "the signed distance between the two localizers on one dimension",
  },
  DimensionRow: {
    label: "Dimension rows",
    gloss: "the twelve objective dimensions, in the study's own evaluation order",
  },
  NullBand: {
    label: "Null band",
    gloss: "the threshold below which a patch effect is not distinguished from nothing",
  },
  RolloutRay: {
    label: "Rollout rays",
    gloss: "one ray per rollout, displaced from the axis by the advantage the estimator computed",
  },
  GroupBracket: {
    label: "Group brackets",
    gloss: "the group mean each ray's advantage is measured against",
  },
  UpdateVector: {
    label: "Update vector",
    gloss: "the clipped gradient norm the optimizer applied at this step",
  },
  EntropyTrace: {
    label: "Entropy trace",
    gloss: "the policy entropy the trainer logged, step by step",
  },
  RewardTrace: {
    label: "Reward trace",
    gloss: "the batch reward with its recorded spread",
  },
  ResidualGap: {
    label: "Unaccounted residual",
    gloss: "a construction, carrying no measurement, standing where a policy response would be",
  },
  Trace: {
    label: "Rate traces",
    gloss: "the written, realized and format-valid rates at every recorded step",
  },
  EpisodeInsert: {
    label: "Completion length",
    gloss: "mean completion characters per step, the surface the run drifted along",
  },
  TransitionBand: {
    label: "Transition band",
    gloss: "the fitted midpoint of the behavioural transition and its 10-to-90 width",
  },
  DetectorMarker: {
    label: "Detector alarms",
    gloss: "where each candidate signal alarmed, shipped or discarded",
  },
};

export interface LegendEntry {
  /** The renderer's own name. Lives in a data attribute, never in visible text. */
  object: string;
  label: string;
  gloss: string;
  /** The quantities this object's geometry is driven by, as the artifact names them. */
  quantities: string[];
}

/** The object name on the left of a `visualProperty` such as `RolloutRay.length`. */
export function objectOf(visualProperty: string): string {
  const dot = visualProperty.indexOf(".");
  return dot < 0 ? visualProperty : visualProperty.slice(0, dot);
}

export function labelFor(object: string): SceneObjectLabel {
  const found = LABELS[object];
  if (!found) {
    throw new Error(
      `scene-controls: the scene manifest draws an object named "${object}" and this packet has no ` +
        `label for it, so the legend would either omit a part of the instrument or print an ` +
        `identifier at a reader. Add it to src/components/scene-controls/objects.ts, and to ` +
        `design/copy.yaml:ui when that file next opens.`,
    );
  }
  return found;
}

/**
 * The legend for one case: every object its encodings drive, in the order the
 * generator declared them, with duplicates collapsed.
 */
export function legendFor(caseId: string): LegendEntry[] {
  const sceneCase: SceneCase = caseById(caseId);
  const order: string[] = [];
  const quantities = new Map<string, string[]>();
  for (const encoding of sceneCase.encodings) {
    const object = objectOf(encoding.visualProperty);
    if (!quantities.has(object)) {
      quantities.set(object, []);
      order.push(object);
    }
    const list = quantities.get(object)!;
    if (!list.includes(encoding.quantity)) list.push(encoding.quantity);
  }
  return order.map((object) => ({
    object,
    ...labelFor(object),
    quantities: quantities.get(object) ?? [],
  }));
}

/**
 * Every object the generated manifest can draw. The runtime test compares this
 * against the pose table so neither can gain an object without the other.
 */
export function allManifestObjects(): string[] {
  const found = new Set<string>();
  for (const c of manifest.cases) {
    for (const e of c.encodings) found.add(objectOf(e.visualProperty));
  }
  return [...found].sort();
}
