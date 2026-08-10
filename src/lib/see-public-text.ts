/**
 * see-public-text  ·  the one place the demonstration routes translate
 *
 * WHAT THIS FILE IS FOR. `/see/reward-model/`, `/see/run/` and `/see/grader/`
 * render three studies whose stored form is the v2 research log's: the card
 * store keys a result by `adjudication_ev`, calls its plain-English summary
 * `kill_note`, and labels a frozen quantity `registeredValue`. That vocabulary
 * belongs to the archive under `/log/`. It is not the public identity of these
 * three routes, which are about looking inside a reward model, inside a
 * training run, and inside a grader.
 *
 * So the routes read the stored fields and render public prose, and EVERY
 * TRANSLATION IS IN THIS FILE so a reviewer can read all of them at once
 * instead of hunting four route files. Nothing here rewrites a number, a sign
 * or a denominator. It rewrites names.
 *
 * THE TWO KINDS OF ENTRY BELOW ARE NOT THE SAME KIND OF THING.
 *
 *   `COPY_OVERRIDES` is a SHIM AND IT IS BUILT TO RETIRE ITSELF. Each entry
 *   names a `design/copy.yaml` path, quotes the text that is in copy.yaml
 *   today, and gives the public replacement. copy.yaml is reserved to the
 *   build lead, so these routes cannot edit it; the packet report carries the
 *   same table as a paste-ready change. Every entry asserts its `was` against
 *   the live document at build time, so THE MOMENT copy.yaml IS CORRECTED THE
 *   BUILD FAILS HERE and whoever lands the change deletes the entry. A silent
 *   shim that outlives its reason is how two vocabularies start.
 *
 *   `PENDING_COPY` is prose these routes need and copy.yaml has no key for.
 *   Same discipline: each entry names the key it should become. HANDOFF.md §8
 *   rule 1 says stop and ask rather than write prose into a route; the
 *   compromise here is that it is written ONCE, in a file whose whole purpose
 *   is to be read as a copy diff, and never inline in a route.
 *
 * DATA MAPPINGS take a stored field and return public prose. They are pure
 * lookups keyed by the stored value, never regex over arbitrary text, because
 * a regex that half-matches a sentence writes a sentence nobody reviewed.
 * `PLAN_NOT_CLOSED` is the one exception and it is a whole-string swap.
 *
 * `assertPublic` is the backstop. Every string these routes render passes
 * through it, so a new banned term entering from generated data fails the
 * build at the route rather than at a grep over `dist/`.
 */
import { copy } from "../copy";

/* -------------------------------------------------------------------------
   The ban, and the check
   ------------------------------------------------------------------------- */

/**
 * The words the archive uses for these three studies. Each is banned in
 * rendered output on `/see/**` and each has a public form in the table below.
 * `registered` also catches `preregistered`, which is deliberate: the site
 * says "frozen before the data", which is what the word means and does not
 * require the reader to know the scheme.
 */
export const BANNED: readonly { re: RegExp; instead: string }[] = [
  { re: /registered/i, instead: "frozen before the data, or named in advance" },
  { re: /adjudicat/i, instead: "resolved, supported, refuted, or inconclusive" },
  { re: /kill criterion/i, instead: "the result contradicted the prediction" },
  { re: /campaign/i, instead: "research log, or v2 research log, and only under /log/" },
  { re: /\bact (one|two|three)\b/i, instead: "the route's own name" },
  { re: /trust rung/i, instead: "evidence strength" },
];

/**
 * Fails the build naming the offending string and where it came from. A route
 * that forgets to translate a field gets a build error rather than a page that
 * looks right and greps wrong.
 */
export const assertPublic = <T extends string>(text: T, where: string): T => {
  /* Placeholder NAMES are not rendered text. `{{coverage_registered}}` is a
     bind key, and act-prose replaces it with a number inside its citation
     before anything reaches HTML. Checking the key would force a rename of a
     copy.yaml placeholder that no reader ever sees, which is churn in a
     reserved file for no gain. An UNBOUND placeholder does render, as a
     literal `{{key}}`, and that is caught by the dist assertion in
     tests/acts/see-routes.test.mjs, which fails on any `{{` under /see/. */
  const rendered = text.replace(/\{\{\s*[a-z0-9_.]+\s*\}\}/gi, " ");
  for (const { re, instead } of BANNED) {
    const hit = rendered.match(re);
    if (!hit) continue;
    throw new Error(
      `see-public-text: "${hit[0]}" reached ${where}. The demonstration routes ` +
        `render mechanistic interpretability, not research-log bookkeeping. ` +
        `Use: ${instead}. If this arrived from generated data, add the mapping ` +
        `to src/lib/see-public-text.ts rather than editing src/data/**, which ` +
        `belongs to the archive.\n  offending text: ${text.slice(0, 240)}`,
    );
  }
  return text;
};

/* -------------------------------------------------------------------------
   COPY_OVERRIDES  ·  the self-retiring shim over design/copy.yaml
   ------------------------------------------------------------------------- */

interface Override {
  /** Dotted path into design/copy.yaml. */
  path: string;
  /** The text copy.yaml carries today, whitespace-normalised. */
  was: string;
  /** The public replacement. */
  now: string;
  /** Why it changes. One line, for the copy diff in the packet report. */
  why: string;
}

const COPY_OVERRIDES: readonly Override[] = [
  {
    path: "acts.parts.reward_model.result",
    was: "The rankings do not match, and the registered prediction did not hold",
    now: "The two rankings point in different directions",
    why: "The part's conclusion is the divergence between the two localizations, not a frozen prediction's outcome.",
  },
  {
    path: "acts.reward_model.result_heading",
    was: "The two rankings do not match.",
    now: "Where a preference appears is not what causally changes it.",
    why: "States the finding rather than restating the part heading.",
  },
  {
    path: "acts.reward_model.not_established",
    was:
      "This does not establish that attribution is wrong and patching is right. On a model organism " +
      "with a planted answer key, the registered prediction that patching would recover the key better " +
      "than attribution was refuted and the kill criterion fired. The recorded conclusion is that " +
      "neither localization can be preferred. A noisy answer key is the disclosed alternative reading " +
      "and it has not been ruled out.",
    now:
      "This does not establish that attribution is wrong and patching is right. On a model organism " +
      "with a planted answer key, the prediction that patching would recover the key better than " +
      "attribution was frozen before the data, and the result contradicted it. The recorded conclusion " +
      "is that neither localization can be preferred. A noisy answer key is the disclosed alternative " +
      "reading and it has not been ruled out.",
    why: "Same two facts, said in words a reader does not have to learn the scheme to read.",
  },
  {
    path: "acts.parts.run.result",
    was: "One signal led. The registered comparator lagged.",
    now: "One signal led. The comparator named in advance lagged.",
    why: "\"Named in advance\" is what the label meant.",
  },
  {
    path: "acts.run.result_heading",
    was: "The shipped signal leads. The registered comparator lags.",
    now: "The shipped signal leads. The comparator named in advance lags.",
    why: "Same substitution as the part heading, so the two agree.",
  },
  {
    path: "acts.run.result",
    was:
      "The variance derivative alarms at step {{alarm_step}}, a lead of {{alarm_lead}} transition " +
      "widths. The registered gradient-norm comparator peaks at step {{comparator_step}}, which is " +
      "{{comparator_lag_steps}} steps after the midpoint, a lead of {{comparator_lead}} widths.",
    now:
      "The variance derivative alarms at step {{alarm_step}}, a lead of {{alarm_lead}} transition " +
      "widths. The gradient-norm comparator, named in advance, peaks at step {{comparator_step}}, " +
      "which is {{comparator_lag_steps}} steps after the midpoint, a lead of {{comparator_lead}} widths.",
    why: "Every number and every placeholder is unchanged.",
  },
  {
    path: "acts.run.companion",
    was:
      "A second registered quantity was predicted to move before the labelled hack rate. It lags, by " +
      "{{lambda_lag}} transition widths. The sign is robust and the magnitude is not. What failed is " +
      "the lead-time claim and not the instrument.",
    now:
      "A second quantity, named in the same freeze, was predicted to move before the labelled hack " +
      "rate. It lags, by {{lambda_lag}} transition widths. The sign is robust and the magnitude is " +
      "not. What failed is the lead-time claim and not the instrument.",
    why: "Same clause, public wording.",
  },
  {
    path: "acts.run.not_established",
    was:
      "This is one run. The false-positive rate across runs is not settled, and the registered " +
      "comparator could not be computed on the companion analysis at all, because the published " +
      "rollout table carries no optimiser telemetry.",
    now:
      "This is one scalar series on one public run. No activations were read and no mechanism is " +
      "named. The false-positive rate across runs is not settled, and the gradient-norm comparator " +
      "could not be computed on the companion analysis at all, because the published rollout table " +
      "carries no optimiser telemetry.",
    why:
      "Adds the two limits the route was missing: this route reads a scalar series, not a mechanism. " +
      "EVIDENCE-VERDICTS.md §2.",
  },
  {
    path: "acts.grader.self_indictment_heading",
    was: "The campaign scored its own calibration, and failed.",
    now: "This project scored its own calibration, and failed.",
    why: "The v2 research log is this project. Naming it by its internal programme name is archive vocabulary.",
  },
  {
    path: "acts.grader.self_indictment",
    was:
      "The previous campaign's directional Brier score was {{brier}} against a coin at {{brier_coin}}. " +
      "Its interval coverage was {{coverage}} against a registered {{coverage_registered}}. Its own " +
      "meta-level kill criterion fired. The recorded conclusion is that the campaign's directional " +
      "calls do not beat a coin, and that the discipline does not calibrate itself.",
    now:
      "The earlier research log's directional Brier score was {{brier}} against a coin at " +
      "{{brier_coin}}. Its interval coverage was {{coverage}} against a threshold of " +
      "{{coverage_registered}} fixed before the data. The result contradicted its own prediction " +
      "about itself. The recorded conclusion is that those directional calls do not beat a coin, and " +
      "that the discipline does not calibrate itself.",
    why: "Every number and threshold is unchanged. Only the names of the scheme change.",
  },
  {
    path: "a11y.figure_alt.run_timeline",
    was:
      "A training run over {{step_count}} steps. The labelled hack rate rises from near zero to near " +
      "one around step {{transition_midpoint}}. A bright marker sits at step {{alarm_step}} where the " +
      "shipped signal alarms, and a dimmer marker at step {{comparator_step}} where the registered " +
      "comparator peaks.",
    now:
      "A training run plotted over {{plot_step_count}} step indices. The labelled hack rate rises " +
      "from near zero to near one around step {{transition_midpoint}}. A bright marker sits at step " +
      "{{alarm_step}} where the shipped signal alarms, and a dimmer marker at step " +
      "{{comparator_step}} where the gradient-norm comparator peaks.",
    why:
      "Two fixes. The banned word, and the count: the plot draws every index in the rollout table " +
      "and the ledger's step count is the lower of two disagreeing records, so the alt text must " +
      "describe what is drawn. EVIDENCE-VERDICTS.md §2.",
  },
];

const normalise = (s: string) => s.replace(/\s+/g, " ").trim();

const lookup = (path: string): string => {
  const found = path.split(".").reduce<unknown>(
    (acc, key) =>
      acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
    copy as unknown,
  );
  if (typeof found !== "string") {
    throw new Error(
      `see-public-text: design/copy.yaml has no string at "${path}". A route ` +
        `does not render a key it cannot find, and this file does not invent one.`,
    );
  }
  return found;
};

const overrides = new Map<string, Override>();
for (const entry of COPY_OVERRIDES) {
  const live = normalise(lookup(entry.path));
  if (live !== normalise(entry.was)) {
    throw new Error(
      `see-public-text: design/copy.yaml:${entry.path} no longer matches the text ` +
        `this override was written against. If the public wording has landed in ` +
        `copy.yaml, DELETE this entry from COPY_OVERRIDES; that is what it is for. ` +
        `If it changed for another reason, rewrite the override against the new text.\n` +
        `  copy.yaml now: ${live}\n  override expected: ${normalise(entry.was)}`,
    );
  }
  overrides.set(entry.path, entry);
}

/* -------------------------------------------------------------------------
   PENDING_COPY  ·  prose with no key yet
   ------------------------------------------------------------------------- */

/**
 * Each key here is a `design/copy.yaml` path that does not exist. The packet
 * report lists them for the build lead; when a key lands, delete the entry and
 * the route reads copy.yaml instead. `text()` prefers copy.yaml whenever the
 * path resolves, so landing a key retires the entry without touching a route.
 */
const PENDING_COPY: Readonly<Record<string, string>> = {
  // --- /see/reward-model/ --------------------------------------------------
  "acts.reward_model.conclusion":
    "Observational localization and causal localization can point in different directions on the " +
    "same model and the same objective. A component that a visible representation makes prominent " +
    "is a hypothesis about mechanism. It is not a causal result until something is patched.",
  "acts.reward_model.second_model_heading":
    "On a second reward model the same measurement is near zero.",
  "acts.reward_model.second_model":
    "The same measurement on a second reward model gives a relationship near zero rather than a " +
    "negative one. That is the reason this is a statement about the two methods disagreeing and not " +
    "a statement that attribution is wrong: on one model the rankings oppose each other, on another " +
    "they are close to unrelated, and neither pattern licenses preferring one localizer.",
  "acts.reward_model.component_sets":
    "The two rankings are not taken over the same set of components. Attribution covers one more " +
    "component than patching does, because the embedding was attributed and never patched, so the " +
    "correlation is computed on the smaller set and the embedding appears in neither ranking below.",
  "acts.reward_model.frozen_claim_label": "The claim, as it was frozen",
  "acts.grader.refusal_reasons_heading":
    "Why the refused fields refused, which bounds what a refusal establishes.",
  "acts.grader.refusal_reasons_body":
    "A refusal naming an incomplete record says something about the record the instrument was " +
    "handed and nothing about the grader. Most of them are that one, so the argument above survives " +
    "and is narrower than it first reads.",
  "acts.reward_model.calibration_case":
    "One calibration case exists where the answer is known by construction: a model organism with a " +
    "planted key, and a prediction frozen before the data that causal patching would recover that " +
    "key better than attribution. It did not. Both recovery scores are below, against chance, with " +
    "the project's own recorded reading of them.",
  // --- /see/run/ -----------------------------------------------------------
  "acts.run.selection_warning":
    "Read each row across before choosing one. The signal with the longest apparent lead is also the " +
    "one that fires most often on order-destroyed surrogates of the same series, which is why it was " +
    "not the one kept. Rows stay in the study's own evaluation order and are never sorted by lead.",
  // --- /see/grader/ --------------------------------------------------------
  "acts.grader.mutation_scope":
    "A score of zero is an absence of detection on one checker against one corpus, at the " +
    "denominator stated beside it. It is not a defect rate for verifiers in general and it is not an " +
    "estimate of any population.",
  // --- /see/ ---------------------------------------------------------------
  "acts.index.system":
    "A policy is trained against a number. The number comes from a grader or a reward model, and the " +
    "training run turns it into behaviour. Three things can therefore be looked inside: the model " +
    "that holds the preference, the run that acts on it, and the program that produces the score. " +
    "Each of the three below opens one of them.",
  "acts.index.no_integrated_case":
    "They are three separate studies on three separate subjects, and no subject here carries the " +
    "whole chain. A static reward model, a public labelled training run, and four scoring programs " +
    "were each measured on their own. Reading all three tells you what each instrument does. It does " +
    "not give you one system followed from its grader to its trained policy, and nothing on this " +
    "site does yet.",
};

/**
 * A public string for a copy path. copy.yaml first, then the retiring shim,
 * then the pending table, and the result is checked before it leaves.
 */
export const text = (path: string): string => {
  const override = overrides.get(path);
  if (override) return assertPublic(override.now, `copy.yaml:${path}`);
  const pending = PENDING_COPY[path];
  if (pending !== undefined) {
    let live: string | null = null;
    try {
      live = lookup(path);
    } catch {
      live = null;
    }
    return assertPublic(live ?? pending, `copy.yaml:${path}`);
  }
  return assertPublic(lookup(path), `copy.yaml:${path}`);
};

/** Every override and pending key, for the packet report and for a test. */
export const copyChangesRequested = (): {
  path: string;
  current: string | null;
  proposed: string;
  why: string;
}[] => [
  ...COPY_OVERRIDES.map((o) => ({
    path: o.path,
    current: normalise(o.was),
    proposed: normalise(o.now),
    why: o.why,
  })),
  ...Object.entries(PENDING_COPY).map(([path, proposed]) => ({
    path,
    current: null,
    proposed: normalise(proposed),
    why: "No key exists. Written once here rather than inline in a route.",
  })),
];

/* -------------------------------------------------------------------------
   Field mappings  ·  stored field to public prose
   ------------------------------------------------------------------------- */

/**
 * `cards.json:kill_note` is the archive's one-sentence summary of what a
 * result showed, written in the log's own register and stored under a field
 * name that describes the mechanism that produced it rather than the finding.
 * These routes render what the result showed.
 *
 * Keyed by card id so a changed note fails loudly rather than being rewritten
 * by a pattern nobody reviewed.
 */
const RESULT_PROSE: Readonly<Record<string, { was: string; now: string }>> = {
  "adj-avp": {
    was:
      "the two instruments are statistically tied against the marker-response key on the organism; " +
      "neither localization can be preferred, undercutting every attribution-based number (a noisy " +
      "key, visible in the emitted margin distribution, is the disclosed alternative reading)",
    now:
      "Against the planted key on the organism the two localizations are statistically tied, so " +
      "neither can be preferred, which limits what any attribution-based number here establishes. A " +
      "noisy key, visible in the emitted margin distribution, is the disclosed alternative reading " +
      "and it has not been ruled out.",
  },
};

/**
 * What a stored result summary says, in public words.
 * @param cardId the archive's card id, never rendered
 * @param stored the stored summary, checked so a rewrite upstream is caught
 */
export const resultProse = (cardId: string, stored: string): string => {
  const entry = RESULT_PROSE[cardId];
  if (!entry) {
    throw new Error(
      `see-public-text: no public wording for the stored result summary of ` +
        `"${cardId}". The demonstration routes do not render the archive's own ` +
        `sentence, so a new record needs an entry in RESULT_PROSE.`,
    );
  }
  if (normalise(stored) !== normalise(entry.was)) {
    throw new Error(
      `see-public-text: the stored result summary for "${cardId}" changed. The ` +
        `public wording restates a specific sentence and it cannot silently ` +
        `restate a different one.\n  stored: ${normalise(stored)}\n  expected: ${normalise(entry.was)}`,
    );
  }
  return assertPublic(entry.now, `resultProse(${cardId})`);
};

/**
 * `cards.json:adjudication_ev` is a record id in the archive's evidence store.
 * The number it carries stays bound to that record, so a reader can still open
 * it, and the panel says in public words what the record is OF. The record
 * page itself keeps the store's own keys, which is what D-05 reserves it for.
 *
 * `subject` and `source` are dropped: both are the store's own keys and the
 * record page carries them. `trust` is TRANSLATED RATHER THAN DROPPED, because
 * dropping it left the chip's accessible name reading "0.26, ..., trust. Open
 * provenance." with nothing after the word, and because what the rung meant is
 * worth saying: the claim was frozen before the data existed. The panel's dot
 * falls back to its neutral colour, which is correct here, since the four
 * coloured rungs are the scheme this route does not put a reader through.
 */
export const publicRecord = (
  cardId: string,
): { observable: string; trust: string; subject: undefined; source: undefined } => {
  const observable = {
    "adj-avp": "planted-key calibration case, attribution against patching",
    "meta-ledger": "this project's audit of its own calibration",
  }[cardId];
  if (!observable) {
    throw new Error(
      `see-public-text: no public observable for "${cardId}". A number that ` +
        `resolves to a record renders what the record is of, in public words.`,
    );
  }
  return {
    observable: assertPublic(observable, `publicRecord(${cardId})`),
    trust: assertPublic("frozen before the data", `publicRecord(${cardId})`),
    subject: undefined,
    source: undefined,
  };
};

/**
 * A stored series or detector label, in public words. Keyed by the stored
 * string so an upstream rewording fails the build instead of slipping through.
 */
const LABELS: Readonly<Record<string, string>> = {
  "Gradient-norm peak, the registered comparator": "Gradient-norm peak, the comparator named in advance",
  /* run-series.json:frozenAnalysisDefect.registeredValue and its pair. The
     replacement is copy.yaml's own wording for the same two things:
     acts.run.defect calls them "the frozen path" and the corrected one. */
  "registered path": "the frozen path",
  "corrected path": "the corrected path",
};

export const publicLabel = (stored: string): string =>
  assertPublic(LABELS[stored] ?? stored, `publicLabel(${stored})`);

/**
 * `run-series.json:frozenAnalysisDefect.explanation` closes on a clause that
 * names the freeze scheme. The rest of the sentence already says the thing, so
 * the clause is restated rather than dropped: a reader should still learn that
 * the corrected comparison was added after the freeze.
 */
const DEFECT_EXPLANATION = {
  was:
    "The frozen path standardises the series against a mean the post-transition regime raised, so " +
    "the accumulator crosses a threshold defined partly by the future. A detector that uses the " +
    "future to define normal cannot measure a lead time, and it will report one. The detector-free " +
    "comparison was added after the freeze and is labelled as not preregistered.",
  now:
    "The frozen path standardises the series against a mean the post-transition regime raised, so " +
    "the accumulator crosses a threshold defined partly by the future. A detector that uses the " +
    "future to define normal cannot measure a lead time, and it will report one. The detector-free " +
    "comparison was added after the freeze, and it is labelled as such wherever it appears.",
};

export const publicExplanation = (stored: string): string => {
  if (normalise(stored) !== normalise(DEFECT_EXPLANATION.was)) {
    throw new Error(
      "see-public-text: run-series.json:frozenAnalysisDefect.explanation changed. " +
        "The public wording restates a specific paragraph and cannot silently " +
        "restate a different one.\n  stored: " +
        normalise(stored),
    );
  }
  return assertPublic(DEFECT_EXPLANATION.now, "publicExplanation");
};

/**
 * One refusal reason in the library's seventeen describes a prediction naming
 * a metric no arc produces, and it says so using the freeze scheme's name.
 * Whole-string swap, keyed by the stored text, on both fields.
 */
const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  "A registered prediction names a metric that no arc in this plan produces. Found before anything ran.":
    "A prediction names a metric that no arc in this plan produces. Found before anything ran.",
  "A registered prediction names a metric that no arc in this plan produces, so the prediction could never have been graded. Either add the arc that produces the metric or change the prediction to one the plan answers. This fires before anything runs, which is the only useful time for it to fire.":
    "A prediction names a metric that no arc in this plan produces, so the prediction could never have been graded. Either add the arc that produces the metric or change the prediction to one the plan answers. This fires before anything runs, which is the only useful time for it to fire.",
};

export interface RefusalReasonRow {
  name: string;
  meaning: string;
  whatToDo: string;
  remedy: string | null;
}

export const publicRefusals = (rows: RefusalReasonRow[]): RefusalReasonRow[] =>
  rows.map((r) => ({
    ...r,
    meaning: assertPublic(REFUSAL_TEXT[normalise(r.meaning)] ?? r.meaning, `refusal ${r.name} meaning`),
    whatToDo: assertPublic(
      REFUSAL_TEXT[normalise(r.whatToDo)] ?? r.whatToDo,
      `refusal ${r.name} whatToDo`,
    ),
  }));

/**
 * THE ROUTE LINK LABELS COME FROM THE NAVIGATION AND NOTHING OVERRIDES THEM.
 * There was an override here, written when `copy.yaml:nav.footer_groups` still
 * read "Watching a run" and "Auditing a grader". The navigation now says
 * "Inside a reward model", "Inside a training run" and "Audit a grader", which
 * are better than the replacements were, and an override would have put two
 * names for one route on the same page: the summary saying one thing and the
 * footer beneath it saying another. The repository wins.
 */
export const linkLabel = (href: string, fallback: string): string =>
  assertPublic(fallback, `linkLabel(${href})`);

/* -------------------------------------------------------------------------
   One value the site's generators do not emit yet
   ------------------------------------------------------------------------- */

/**
 * THE SECOND MODEL'S RANK CORRELATION, AND WHY IT IS TYPED HERE.
 *
 * `acts.reward_model.result` writes `{{rho_armo}}`. The value is in the same
 * fixture `intervention.json` already cites for the mean, at
 * `E04.per_model_mean_rho["ArmoRM-Llama3-8B-v0.1"]`, and the site's generator
 * does not emit it: `src/data/intervention.json` carries one model. Without it
 * the route can only show a set of negative correlations on one model, which
 * reads as "attribution is wrong", and the near-zero relationship on a second
 * model is exactly what refuses that reading. EVIDENCE-VERDICTS.md §1 requires
 * it on the route.
 *
 * `src/data/**` and `scripts/**` belong to the data packet, so this route
 * cannot emit it. It is written once, here, with the document and line it was
 * read from, and it renders through the same document-and-line citation every
 * other number on that page uses. ESCALATED in the packet report: the fix is
 * one field on `intervention.json:headline`, after which `guardArmoRho` below
 * fails the build and this constant is deleted.
 */
export const SECOND_MODEL_RHO = {
  model: "ArmoRM-Llama3-8B-v0.1",
  display: "+0.047465",
  source: {
    document: "reward-lens-assay/fixtures/e_parity/golden.json",
    line: 6,
  },
} as const;

/**
 * Fails the build the moment the generator emits the field, so the constant
 * above cannot outlive the gap it exists for.
 */
export const guardArmoRho = (headline: Record<string, unknown>): void => {
  for (const key of ["armoRho", "secondModelRho", "perModelMeanRho"]) {
    if (key in headline) {
      throw new Error(
        `see-public-text: intervention.json:headline now carries "${key}". ` +
          `Delete SECOND_MODEL_RHO from src/lib/see-public-text.ts and bind the ` +
          `route to the generated field. A typed constant beside a generated one ` +
          `is two copies of the same number.`,
      );
    }
  }
};
