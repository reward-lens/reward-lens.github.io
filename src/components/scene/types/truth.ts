/**
 * The scene truth contract.
 *
 * This file is the reason the instrument cannot lie by accident. Every numeric
 * property of the scene's geometry, and every caption written beside it, comes
 * through a `SceneCase` declared here. A band width, a ray angle, a marker
 * position and the sentence under them read the same record, so a visual claim
 * and its stated source cannot drift apart without the build noticing.
 *
 * THE RULE THAT MATTERS. `truthMode` is not a label for the caption. It decides
 * what geometry is allowed to exist. A `schematic` case may not carry a
 * quantitative width, count or distance, because a construction that looks
 * measured is the one failure mode this whole contract exists to prevent. The
 * generator enforces that; see scripts/build_scene_data.mjs.
 *
 * WHY ENCODINGS ARE DECLARED RATHER THAN APPLIED INLINE. A number becomes a
 * length somewhere. If that happens inside a mesh component, the transform is
 * invisible to review and the caption is written by hand next to it. Declaring
 * it here means one reviewer can read every quantity the room draws, with its
 * unit, its domain and whether it was clamped, without opening a shader.
 */

/**
 * What kind of claim the geometry makes.
 *
 * `schematic`  an explanatory construction. Asserts no measurement. May not
 *              carry quantitative encodings.
 * `measured`   the geometry is a recorded quantity from a named artifact.
 * `derived`    a stated transform of a recorded quantity. `transform` says which.
 * `bounded`    a detection or a limit, not a point value. Renders as an extent,
 *              never as a position.
 */
export type SceneTruthMode = "schematic" | "measured" | "derived" | "bounded";

/** The five states of the instrument story, in scroll order. */
export type InstrumentStateId =
  | "scorer"
  | "selection"
  | "update"
  | "response"
  | "run-boundary";

export const INSTRUMENT_STATES: readonly InstrumentStateId[] = [
  "scorer",
  "selection",
  "update",
  "response",
  "run-boundary",
] as const;

/**
 * One quantity, and the single place it becomes a visual property.
 *
 * `visualProperty` names the geometry it drives, in the renderer's own
 * vocabulary, so a reviewer can find it. `transform` is prose and must describe
 * the arithmetic completely enough to reproduce it.
 */
export interface SceneEncoding {
  /** e.g. "RolloutRay.length", "ScoreBand.angularWidth". */
  visualProperty: string;
  /** The quantity's name as the source artifact calls it. */
  quantity: string;
  /** The arithmetic from quantity to visual property, stated in full. */
  transform: string;
  /** The quantity's unit, or null when it is a pure count or a share. */
  unit: string | null;
  /** The input domain the transform assumes, or null when it is unbounded. */
  domain: [number, number] | null;
  /** True when a value outside `domain` is pinned to its edge rather than dropped. */
  clamp: boolean;
  /** Present only when the case draws fewer records than the source holds. */
  downsample?: {
    method: string;
    seed: number;
    inputCount: number;
    outputCount: number;
  };
}

/** Where a case's numbers actually come from. A case with none does not build. */
export interface SceneSource {
  /** Repository-relative path. Never absolute: an absolute path leaks a machine. */
  repositoryPath?: string;
  publicUrl?: string;
  commit?: string;
  artifact?: string;
}

/**
 * One subject, shown in one state.
 *
 * `publicLabel` is what the source plate says, and it is prose. An internal
 * identifier may not appear in it; the banned-term gate walks built output for
 * exactly this.
 */
export interface SceneCase {
  /** Stable slug. Components import by this, never by array index. */
  id: string;
  /** The state this case can be shown in. */
  state: InstrumentStateId;
  /** The source plate's first line, e.g. "RECORDED UPDATE". */
  plateKind: string;
  /** The source plate's second line: the subject, in human words. */
  publicLabel: string;
  truthMode: SceneTruthMode;
  /** What was measured, in enough detail to identify the run or model. */
  subject: string;
  source: SceneSource;
  /** The conditions under which the reading holds. */
  scope: string;
  /** What this case does NOT establish. Rendered, not decorative. */
  caveat: string;
  encodings: SceneEncoding[];
  /** sha256 of the payload this case describes, for cache invalidation. */
  contentHash: string;
}

/** The generated bundle the site imports. */
export interface SceneManifest {
  /** Bumped when the payload layout changes, so a stale still is detectable. */
  version: number;
  generatedBy: string;
  generatedAt: string;
  cases: SceneCase[];
}

/**
 * A schematic case may not carry a quantitative encoding. This is the check the
 * generator runs and the site build repeats, rather than a comment asking
 * politely.
 */
export function violatesTruthMode(c: SceneCase): string | null {
  if (c.truthMode === "schematic" && c.encodings.length > 0) {
    return `case "${c.id}" is schematic and declares ${c.encodings.length} quantitative encoding(s); a construction may not carry measured geometry`;
  }
  if (c.truthMode !== "schematic" && c.encodings.length === 0) {
    return `case "${c.id}" is "${c.truthMode}" and declares no encoding; a measured case must say which quantity became which visual property`;
  }
  if (c.truthMode !== "schematic" && !c.source.repositoryPath && !c.source.publicUrl) {
    return `case "${c.id}" is "${c.truthMode}" and names no source`;
  }
  return null;
}

/** No built artifact may carry a local path. Checked here and again in CI. */
export function leaksLocalPath(value: string): boolean {
  return /\/home\/|\/Users\/|file:\/\/|\.claude\/worktrees/.test(value);
}
