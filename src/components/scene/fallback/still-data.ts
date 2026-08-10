/**
 * Reading the generated stills.
 *
 * `scripts/dev/build-scene-stills.mjs` writes `src/data/scene/stills/index.json`
 * from the scene manifest and the binary payloads. This module is the only
 * sanctioned way into it, for the same reason `src/data/schema/scene.ts` is the
 * only sanctioned way into the payloads: no component should compute a
 * coordinate, and the geometry's meaning should be readable in one place.
 *
 * THERE IS NO FALLBACK PATH HERE EITHER. A missing index, an unknown state, a
 * case a state does not own: each throws with the state or the case named. The
 * still is what a reader without WebGL sees, so a still that quietly rendered
 * an empty box would be an argument silently deleted for exactly the readers
 * least able to notice.
 */
import index from "../../../data/scene/stills/index.json";
import type { InstrumentStateId, SceneTruthMode } from "../types/truth";

/**
 * One drawn thing inside the fan.
 *
 * The coordinate space is the generator's, stated once here so a reader of the
 * component does not have to open a build script:
 *
 *   x  0 at the dispersing element's exit face, 1 at the detector plane.
 *   y  0 on the optical axis, 1 at the top of the fan's extent.
 *
 * Upward only, because D-22 gives the half below the axis to the rail and the
 * readout. A signed quantity draws its own zero as a `zero` mark rather than
 * leaving the reader to infer where it fell.
 */
export type StillMark =
  /** A series with a centre and a half-width per point: [x, y, halfWidth]. */
  | { kind: "ribbon"; token: string; label: string; points: [number, number, number][] }
  /** A series: [x, y]. */
  | { kind: "trace"; token: string; label: string; points: [number, number][] }
  /** One line per record, from the element's exit face to [x, y]. */
  | { kind: "rays"; token: string; label: string; points: [number, number][] }
  /** Discrete points: [x, y], with an optional third field the mark's own kind defines. */
  | { kind: "marks"; token: string; label: string; points: number[][] }
  /** A counted scale. The count is the reading and is never downsampled. */
  | { kind: "ticks"; token: string; label: string; count: number; lit: number }
  /** What a reader at one access level got, against what the record holds. */
  | { kind: "gate"; label: string; read: number; refused: number; total: number }
  /** A proportion drawn as a length. */
  | { kind: "bar"; token: string; label: string; value: number; total: number }
  /** A quantity's own zero. */
  | { kind: "zero"; token: string; label: string; y: number }
  /** A horizontal extent: a threshold band. */
  | { kind: "band"; token: string; label: string; y0: number; y1: number }
  /** A vertical extent: a transition band over the run. */
  | { kind: "xband"; token: string; label: string; x0: number; x1: number }
  /** Nothing was measured. Drawn as an empty detector that says so. */
  | { kind: "absent"; token: string };

export interface StillReadoutRow {
  label: string;
  value: string;
}

export interface Still {
  caseId: string;
  state: InstrumentStateId;
  /** The source plate's first line. */
  plateKind: string;
  /** The source plate's second line. Prose, never an internal identifier. */
  publicLabel: string;
  /** Rendered as a word in the caption, per the truth contract. */
  truthMode: SceneTruthMode;
  contentHash: string;
  caption: string;
  scope: string;
  caveat: string;
  sourcePath: string | null;
  sourceArtifact: string | null;
  /** Present when the still draws fewer records than the source holds. */
  drawn: { method: string; inputCount: number; outputCount: number } | null;
  note: string | null;
  readout: StillReadoutRow[];
  marks: StillMark[];
}

export interface StillState {
  id: InstrumentStateId;
  /** What the still shows before a reader chooses. */
  defaultCase: string;
  cases: string[];
}

interface StillIndex {
  version: number;
  generatedBy: string;
  manifestDigest: string;
  budget: Record<string, number>;
  states: StillState[];
  stills: Record<string, Still>;
}

const data = index as unknown as StillIndex;

if (!data?.states?.length) {
  throw new Error(
    "scene stills: src/data/scene/stills/index.json carries no states. Run " +
      "`npm run build:scene-stills`. There is no synthetic still: the fallback is what a reader " +
      "without WebGL sees, and an empty one is the argument deleted for exactly the readers least " +
      "able to notice.",
  );
}

export const stillStates: StillState[] = data.states;
export const stillBudget = data.budget;
export const stillManifestDigest = data.manifestDigest;

/** One case's still, or a throw naming the cases that do exist. */
export function still(caseId: string): Still {
  const s = data.stills[caseId];
  if (!s) {
    throw new Error(
      `scene stills: no still for case ${JSON.stringify(caseId)}. Generated: ` +
        `${Object.keys(data.stills).join(", ")}.`,
    );
  }
  return s;
}

/** Every still a state owns, in manifest order, default first. */
export function stillsForState(state: InstrumentStateId): Still[] {
  const entry = data.states.find((s) => s.id === state);
  if (!entry) {
    throw new Error(
      `scene stills: state ${JSON.stringify(state)} has no stills. States: ` +
        `${data.states.map((s) => s.id).join(", ")}.`,
    );
  }
  return entry.cases.map(still);
}
