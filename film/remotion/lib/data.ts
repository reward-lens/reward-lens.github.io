// Every number the film renders comes from here, which is the same generated
// file the site renders from. There is no second copy and no literal.
//
// One thing to know before writing a caption against this file, from
// GROUND-TRUTH.md C-34 and DECISIONS.md D-35: the run's numbers have NO evidence
// record. The campaign evidence store contains no RL training run at all, so
// every one of these carries `source: {document, line}` instead of an
// `evidenceId`, and no id is ever minted for one.

import series from "../../../src/data/run-series.json";
import refusals from "../../../src/data/refusals.json";
import interventionData from "../../../src/data/intervention.json";
import graderCardsData from "../../../src/data/grader-cards.json";
import filmCopy from "../../out/copy.json";

export type Detector = {
  key: string;
  label: string;
  alarmStep: number | null;
  leadWidths: number | null;
  surrogateRate: number | null;
  shipped: boolean;
  discardedReason: string | null;
};

export const run = series as unknown as {
  meta: {
    subject: string;
    rolloutCount: number;
    stepCount: number;
    rolloutsPerStep: number;
  };
  steps: number[];
  series: {
    hackRate: number[];
    written: number[];
    realized: number[];
    formatOk: number[];
  };
  perEpisode: {
    meanCompletionCharacters: number[];
    totalCompletionCharacters: number;
  };
  detectors: Detector[];
  transition: { midpoint: number; width1090: number; r2: number };
};

export const detector = (key: string): Detector => {
  const found = run.detectors.find((d) => d.key === key);
  if (!found) throw new Error(`no detector ${key} in run-series.json`);
  return found;
};

export const reasons = (refusals as unknown as {
  reasons: {
    name: string;
    meaning: string;
    remedy: { remedy: string | null } | null;
  }[];
}).reasons;

export const reason = (name: string) => {
  const found = reasons.find((r) => r.name === name);
  if (!found) throw new Error(`no refusal reason ${name} in refusals.json`);
  return found;
};

/** A refusal reason is public vocabulary only after it is lowercased and spaced. */
export const readable = (name: string) => name.toLowerCase().replace(/_/g, " ");

// -----------------------------------------------------------------------------
// Act one's intervention data, and act three's grader cards. Both landed after
// the first pass of this packet shipped, which is why two of the three figure
// films were stated as blocked rather than half-built.
// -----------------------------------------------------------------------------

export type Component = {
  id: string;
  type: string;
  attributionValue: number;
  patchEffect: number;
  patchFractionOfMargin: number;
  patchFractionOfMarginSigned: number;
  attributionRank: number;
  patchRank: number;
};

export const intervention = interventionData as unknown as {
  headline: { meanRho: number; sharpestDimension: string; sharpestRho: number };
  meta: { subject: string; dimensionCount: number; patchedComponentCount: number };
  nullThreshold: { value: number };
  dimensions: {
    key: string;
    spearmanRho: number;
    topAttributionComponent: string;
    topPatchComponent: string;
    components: Component[];
  }[];
};

/**
 * The dimension the figure draws, chosen by the data rather than by taste.
 *
 * The rule: the dimension on which the two rankings disagree most about the
 * component attribution puts first, measured as that component's patch rank.
 * Ties go to file order, which makes the choice deterministic across renders.
 *
 * On this model it selects `confidence`, where the top attribution component is
 * `mlp_L31` at patch rank 64 of 64 with a patch effect of exactly zero. Two
 * other dimensions tie at 64, and `mlp_L31` is the top attribution component on
 * ALL twelve, which is why the figure names the components rather than the
 * dimension: the tangle is not a property of the dimension it happens to draw.
 */
export const interventionSubject = () => {
  let best = intervention.dimensions[0];
  let bestRank = -1;
  for (const dimension of intervention.dimensions) {
    const top = dimension.components.find((c) => c.id === dimension.topAttributionComponent);
    if (!top) throw new Error(`${dimension.key} names a top component it does not carry`);
    if (top.patchRank > bestRank) {
      bestRank = top.patchRank;
      best = dimension;
    }
  }
  return best;
};

export type GraderCard = {
  key: string;
  displayName: string;
  subject: { corpus: string };
  mutationScore: number;
  competentMutants: number;
  survivedMutants: number;
  killedMutants: number;
};

export const graderCards = (graderCardsData as unknown as { cards: GraderCard[] }).cards;

/**
 * The mutation figure's subject: the card whose mutants all survived.
 *
 * Derived as the minimum kill count rather than named, so the figure follows the
 * data if a re-run ever kills one. It selects `is_equiv`, at 0 of 60.
 */
export const mutationSubject = () =>
  graderCards.reduce((a, b) => (b.killedMutants < a.killedMutants ? b : a));

/**
 * A string from copy.yaml's `film` subtree, by dotted path.
 *
 * HANDOFF.md §8 rule 1: no string that is not in copy.yaml. film/out/copy.json
 * is extracted from the frozen document by scripts/render.mjs before anything
 * renders, and the Manim inserts read the same file, so the two renderers cannot
 * disagree about a word. It throws rather than falling back, because a silent
 * fallback is how a composed string gets into a frame.
 */
export const copy = (path: string): string => {
  let node: unknown = filmCopy;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) {
      throw new Error(`copy.yaml:film.${path} does not exist`);
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "string") throw new Error(`copy.yaml:film.${path} is not a string`);
  return node;
};
