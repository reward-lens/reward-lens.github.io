/**
 * Everything the proof bench renders that is a number, read from generated
 * JSON. No value in this file is typed; every one is a field of
 * `src/data/intervention.json` or `src/data/grader-cards.json`, or an
 * arithmetic function of one that is stated where it happens.
 *
 * WHAT MAY BECOME A PICTURE AND WHAT MAY ONLY BE SAID. design/scene/
 * EVIDENCE-VERDICTS.md is the ruling, and two of its lines govern this bench:
 *
 *   - the attribution-versus-patching set and the verifier mutation audit both
 *     have complete per-item artifacts, so both may become geometry;
 *   - the reward-composition counterfactual has none, so the training exhibit
 *     draws nothing at all. It is prose and a link, deliberately, and the
 *     absence of a figure there is the honest state rather than an omission.
 *
 * The same file requires two disclosures beside the intervention figure: that
 * 65 components were attributed and 64 patched, and that the unpatched one is
 * the embedding. Those are read out of the file's own `meta` and rendered as a
 * record block, in the file's own field names, the way a provenance panel
 * renders a record's `stats`.
 */
import { correlation } from "../correlation";
import type { Correlation } from "../correlation";

const dataModules = import.meta.glob<{ default: unknown }>("../../../data/*.json", {
  eager: true,
});

const dataFile = <T>(name: string): T | null => {
  const mod = dataModules[`../../../data/${name}`];
  return mod ? (mod.default as T) : null;
};

/* -------------------------------------------------------------------------
   How a value is written. The record states the number; this only decides how
   many places of it are shown, and it never re-rounds a value that already
   reads cleanly. Same function the homepage already uses for these two rank
   correlations, so the bench and the page state them identically.
   ------------------------------------------------------------------------- */
export const show = (v: number, places = 6): string => {
  const fixed = v.toFixed(places);
  const trimmed = fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ".0");
  return trimmed.endsWith(".") ? `${trimmed}0` : trimmed;
};

/* =========================================================================
   1 · The reward model. src/data/intervention.json.
   ========================================================================= */

interface InterventionMeta {
  subject: string;
  dimensionCount: number;
  attributedComponentCount: number;
  patchedComponentCount: number;
  unpatchedComponents: string[];
  patchingMode: string;
  pairSource: string[];
}

interface InterventionFile {
  meta: InterventionMeta;
}

export interface RewardModelExhibit {
  correlation: Correlation;
  /** The file's own meta, rendered as a record beside the figure. */
  meta: InterventionMeta;
  /**
   * EVIDENCE-VERDICTS.md §1: the attributed set and the patched set are not
   * the same set, and the site says so rather than letting a reader infer it.
   * True whenever the two counts differ, which is the condition that makes the
   * disclosure necessary, so it is derived rather than asserted.
   */
  setsDiffer: boolean;
  /** The formatted rank correlations, at the precision the record states. */
  meanRho: string;
  sharpestRho: string;
}

export const rewardModel = (): RewardModelExhibit | null => {
  const corr = correlation();
  const file = dataFile<InterventionFile>("intervention.json");
  if (!corr || !file) return null;
  return {
    correlation: corr,
    meta: file.meta,
    setsDiffer:
      file.meta.attributedComponentCount !== file.meta.patchedComponentCount,
    meanRho: show(corr.meanRho),
    sharpestRho: show(corr.sharpestRho),
  };
};

/* =========================================================================
   3 · The grader. src/data/grader-cards.json.
   ========================================================================= */

interface CardField {
  name: string;
  state: "read" | "refused";
  reason: string | null;
  detail: string | null;
  remedy: string | null;
  bound: number | string | null;
  headline: string | null;
  trust: string | null;
  supporting: string[];
}

interface CardAccess {
  readCount: number;
  refusedCount: number;
  summarySentence: string;
  fields: CardField[];
}

interface GraderCard {
  key: string;
  displayName: string;
  subject: {
    name: string;
    kind: string;
    source: string;
    entrypoint: string;
    corpus: string;
  };
  fingerprint: string;
  trust: string;
  graderCalls: number;
  mutationScore: number;
  competentMutants: number;
  survivedMutants: number;
  killedMutants: number;
  access: { full: CardAccess; log_only: CardAccess };
}

interface GraderCardsFile {
  meta: {
    subjectCount: number;
    fieldsPerCard: number;
    accessStates: string[];
    fullAccess: { fields: number; read: number; refused: number };
    logOnlyAccess: { fields: number; read: number; refused: number };
    derivedFrom: { document: string; sha256: string }[];
  };
  cards: GraderCard[];
}

export interface GraderExhibit {
  cards: GraderCard[];
  /**
   * The subject the figure draws. Chosen as the card whose audit killed the
   * fewest mutants, because that is what makes it the subject: the caption
   * beside it is about a checker that noticed none of them. Selecting it by
   * measurement rather than by name means the figure cannot end up captioned
   * about one card and drawn from another.
   */
  primary: GraderCard;
  /** The other three, which are what makes a score of zero a finding. */
  comparators: GraderCard[];
  meta: GraderCardsFile["meta"];
  /** One real reading and one real refusal of the same quantity. */
  receipt: { field: CardField; card: GraderCard; access: string } | null;
  refusal: { field: CardField; card: GraderCard; access: string } | null;
}

export const grader = (): GraderExhibit | null => {
  const file = dataFile<GraderCardsFile>("grader-cards.json");
  if (!file || file.cards.length === 0) return null;

  const primary = file.cards.reduce((lowest, card) =>
    card.killedMutants < lowest.killedMutants ? card : lowest,
  );
  const comparators = file.cards.filter((c) => c.key !== primary.key);

  /* The receipt and the refusal are the SAME quantity on the same subject,
     read at one access level and declined at another. That pairing is the
     whole point: a measured zero and a missing measurement are never allowed
     to look the same, and here they are the same field. */
  const read = primary.access.full.fields.find(
    (f) => f.state === "read" && f.headline,
  );
  const sameFieldRefused = read
    ? primary.access.log_only.fields.find(
        (f) => f.name === read.name && f.state === "refused" && f.remedy,
      )
    : undefined;
  const anyRefused = primary.access.log_only.fields.find(
    (f) => f.state === "refused" && f.remedy && f.reason,
  );
  const refused = sameFieldRefused ?? anyRefused;

  const [fullState, logState] = file.meta.accessStates;

  return {
    cards: file.cards,
    primary,
    comparators,
    meta: file.meta,
    receipt: read ? { field: read, card: primary, access: fullState } : null,
    refusal: refused
      ? { field: refused, card: primary, access: logState }
      : null,
  };
};

/* =========================================================================
   The capability report's command.

   The handoff ends with a command, and copy.yaml carries only the install one.
   This does not type the other: the library prints it inside its own refusal
   remedies, and every one of those remedies ships in grader-cards.json. So the
   command is read back out of the generated data, and it renders only when
   exactly one distinct command is found there. If the library renames it, this
   follows; if it stops naming it, the row disappears rather than going stale.
   ========================================================================= */

const COMMAND = /`(reward-lens [a-z][a-z-]*)`/g;

export const capabilityCommand = (): string | null => {
  const file = dataFile<GraderCardsFile>("grader-cards.json");
  if (!file) return null;
  const found = new Set<string>();
  for (const card of file.cards) {
    for (const access of [card.access.full, card.access.log_only]) {
      for (const field of access.fields) {
        for (const m of (field.remedy ?? "").matchAll(COMMAND)) found.add(m[1]);
      }
    }
  }
  return found.size === 1 ? [...found][0] : null;
};
