/**
 * The /start/ transcript.
 *
 * EVERY STRING IN THIS FILE WAS PRODUCED BY RUNNING THE COMMAND ABOVE IT, in a
 * virtualenv created outside every checkout in this repository and populated by
 * `pip install reward-lens` from the package index. Not from an editable
 * checkout, and not from the assay working tree: a healthy local source tree
 * hides a broken wheel, and that is the exact failure this page would otherwise
 * ship. Two of the environments in this repository are editable or a version
 * behind; neither was used.
 *
 * Captured 2026-08-11 against reward-lens 3.0.0 from the package index, on
 * CPython 3.12.3. Nothing here is transcribed by hand, retyped, reflowed or
 * shortened within a line. Where a capture is an excerpt it is a contiguous run
 * of lines from the top of the real output, never a stitch of two places.
 *
 * If you change a command on the page, re-run it in a fresh wheel-built
 * environment and replace the capture. A page that shows output its command no
 * longer produces is worse than a page that shows no output at all.
 */

/** `python -c "import reward_lens; print(reward_lens.__version__)"` */
export const version = "3.0.0";

/** `reward-lens capabilities --substrate NEURAL_GEN`, the first block of 291 lines. */
export const capabilities = "ACCESS RESOLVED\n  TASK      NONE                         (no task refs in the record and no environment source\n                                         supplied)\n  GRADER    NONE                         (no grader endpoint supplied; --grader would add QUERY once\n                                         probed)\n  POLICY    NONE                         (no weights supplied; --policy would add FORWARD)\n  RECORD    NONE                         (no record supplied; --record points at a run directory)\n  SUBSTRATE NEURAL_GEN                   (declared by the caller)\n  PHASE     PRE_RUN                      (no record supplied, so nothing has been optimised that\n                                         this could be after)\n\nREGIME MEASURED\n  not measured. Every estimator with a non-empty envelope is reported below with\n  its envelope unchecked rather than satisfied; measure the regime to settle them.";

/** The scoring program the rest of the page reads. Saved as grader.py. */
export const graderSource = "def grade(answer: str, gold: str) -> float:\n    \"\"\"One point for an answer that matches the gold answer once trimmed.\"\"\"\n    if answer.strip() == gold.strip():\n        return 1.0\n    if answer.strip().lower() == gold.strip().lower():\n        return 0.5\n    return 0.0";

/** Saved as plan.py. */
export const planSource = "from reward_lens.measure.card import CardInputs, card_plan\n\nplan = card_plan(CardInputs(grader_name=\"grader.py\"))\nprint(plan.render())";

/** `python plan.py`, the header block. Thirteen refusals follow it. */
export const planOutput = "CARD PLAN  grader.py\n  0 of 13 fields would read; 13 would refuse.\n  cost  at least 0 grader calls, no GPU and no model\n  not checked  access\n  not checked  substrate\n  not checked  phase\n  not checked  envelope (regime not measured)\n  not checked  limit of detection";

/**
 * The remedy the first refused field printed. The library prefixes the line
 * with "Remedy: " when it renders a plan; the refusal card supplies that label
 * itself, and carrying both put "Remedy: Remedy:" on the card. Visible in the
 * 1440 capture, invisible in the code. Only the prefix is dropped.
 */
export const planRemedy = "install the optional extra: pip install 'reward-lens[verifier]'. Every other field on this card reads without it.";

/** Saved as read.py, after `pip install 'reward-lens[verifier]'`. */
export const readSource = "from reward_lens.measure.card import CardInputs, grader_card, render_card\nfrom reward_lens.verifier import ListCorpus, Rollout, VerifierUnderTest\n\ncorpus = ListCorpus.of([\n    Rollout(\"r1\", {\"answer\": \"42\", \"gold\": \"42\"}, score=1.0),\n    Rollout(\"r2\", {\"answer\": \"41\", \"gold\": \"42\"}, score=0.0),\n    Rollout(\"r3\", {\"answer\": \" Paris \", \"gold\": \"paris\"}, score=0.5),\n])\n\ncard = grader_card(\n    CardInputs(\n        verifier=VerifierUnderTest(\"grader.py\", entrypoint=\"grade\"),\n        corpus=corpus,\n        grader_name=\"grader.py\",\n        mutation_limit=8,\n    )\n)\nprint(render_card(card))";

/** `python read.py`, the two fields that read. */
export const readOutput = "  2 of 13 fields read and 11 refused. The lowest trust among them is exploratory.\n\n  coverage                   Across 3 rollouts grade has never taken 0% of its branches (0 of 4). Those are behaviours it cannot distinguish.  [exploratory]\n                             a random sample of the same size reaches 0.777 against the corpus's 1.000\n  surviving mutants          Of 8 mutants of grade, 0 survive: 0 ways it could be wrong that no rollout in your corpus would reveal.  [exploratory]\n                             mutation score 1.000 over 8 competent\n                             reproducers withheld. this payload enumerates concrete ways to make the grader wrong. It is written to the store with a sensitive flag, excluded from rendered artifacts unless explicitly requested, and not published without a recorded decision.";

/** The first refused field, as `python plan.py` printed it. */
export const firstRefusal = {
  quantity: "verifier.decision_coverage",
  reason: "ACCESS_INSUFFICIENT",
  detail: "No estimator for verifier.decision_coverage exists on this install, so nothing was computed.",
};
