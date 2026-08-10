/**
 * GALLERY FIXTURES. NOT SHIPPING DATA.
 *
 * Every value here is quoted from a frozen document, so nothing in it is
 * invented and nothing in it could be mistaken for a generated number:
 *
 *   - the release pair is GROUND-TRUTH.md C-1 (the index serves 2.0.1, the
 *     repository is tagged 3.0.0 and has not been uploaded)
 *   - the provenance record is the anatomy block in
 *     design/components/provenance-chip.md, verbatim
 *   - the refusal is the anatomy block in design/components/refusal-card.md
 *   - the detector table is the anatomy block in design/components/data-table.md
 *   - the snippet and its output are the anatomy block in
 *     design/components/code-block.md
 *   - every callout label and body is a real key in design/copy.yaml
 *
 * P1 generates the real files in wave 1. When it does, the gallery should read
 * from them and this file should shrink to nothing.
 */
import type { Release, EvidenceRecord, Column, Row } from "./data";

/**
 * GROUND-TRUTH.md C-1: the index serves 2.0.1 and the repository is tagged
 * 3.0.0, which has not been uploaded.
 *
 * NOTE FOR P1: the field is `unpublished`, renamed from `rc`, and its pattern
 * in design/schemas/release.schema.json is now
 * ^[0-9]+\.[0-9]+\.[0-9]+([a-z]+[0-9]+)?$. The old pattern required an
 * rc|a|b suffix and rejected the bare 3.0.0 that DECISIONS.md D-25 left this
 * field holding. `unpublishedIsAhead` was `rcIsAhead`.
 */
export const release: Release = {
  latest: "2.0.1",
  unpublished: "3.0.0",
  unpublishedIsAhead: true,
  requiresPython: ">=3.10",
  releases: [
    { version: "2.0.0", uploadedAt: "2026-07-10T00:00:00Z" },
    { version: "2.0.1", uploadedAt: "2026-07-22T00:00:00Z" },
  ],
  urls: {
    publishedHomepage: "https://pypi.org/project/reward-lens/",
    publishedDocumentation: "https://pypi.org/project/reward-lens/",
    canonicalRepo: "https://github.com/reward-lens/reward-lens",
    canonicalDocs: "https://reward-lens.github.io/docs/",
    publishedUrlsAreStale: true,
  },
  changelogUrl: "https://github.com/reward-lens/reward-lens/blob/main/CHANGELOG.md",
  fetchedAt: "2026-08-06T00:00:00Z",
};

/** A real id from src/data/evidence-index.json, so resolution is exercised. */
export const evidenceId = "ev:6bf316c059230ff4ff99b118b1664631";

/** design/components/provenance-chip.md, the anatomy block. */
export const record: EvidenceRecord = {
  observable: "attribution vs patching, mean Spearman",
  value: "−0.170885",
  trust: "exploratory",
  uncertainty: "± not characterised",
  subject: "Skywork-Reward-Llama-3.1-8B-v0.2, 12 dims",
  source: "fixtures/e_parity/golden.json",
  commit: "9c7a458",
  href: "/evidence/",
};

/** design/components/refusal-card.md, the anatomy block. */
export const boundedRefusal = {
  quantity: "exploit-family accounting",
  reason: "ABOVE_LOD_BELOW_LOQ",
  detail:
    "f2 = 0: no family in this log of 259 finds appears exactly twice, so f1²/(2f2) is undefined. f1 = 1 over 4 families found.",
  bound: "0.0",
  remedy:
    "Collect about 259 more finds under the same search and re-run the accounting.",
};

/**
 * The plain refusal direction, at the same density. The reason is a member of
 * the seventeen (GROUND-TRUTH.md C-10) and the remedy is written as an
 * instruction, which is the property the contract requires of every one.
 *
 * Neither refusal carries a state string any more: the card derives it from
 * whether a bound is present, out of copy.yaml:refusals.state_labels.
 */
export const plainRefusal = {
  quantity: "causal share of the preference",
  reason: "ACCESS_INSUFFICIENT",
  detail:
    "The reading needs backward access to the scoring head and the wrapper exposes forward scores only.",
  remedy:
    "Re-run with a local checkpoint, or record the gradient of the score with respect to the residual stream and attach it to the run.",
};

/** design/components/data-table.md, the anatomy block, in evaluation order. */
export const detectorColumns: Column[] = [
  { key: "signal", label: "signal", align: "start", kind: "text" },
  { key: "alarm", label: "alarms at step", align: "end", kind: "number" },
  { key: "lead", label: "lead, in transition widths", align: "end", kind: "number" },
  { key: "surrogates", label: "fires on surrogates", align: "end", kind: "percent-bar" },
];

export const detectorRows: Row[] = [
  { signal: "variance level", alarm: 70, lead: "+1.504", surrogates: { value: 60.7, display: "60.7%" } },
  { signal: "gradient norm, CUSUM", alarm: null, lead: null, surrogates: { value: 69.3, display: "69.3%" } },
  { signal: "variance derivative", alarm: 90, lead: "+0.668", surrogates: { value: 24.3, display: "24.3%" } },
  { signal: "gradient-norm peak", alarm: 133, lead: "−1.129", surrogates: null },
  { signal: "labelled transition", alarm: "106.0", lead: 0, surrogates: null },
];

/** design/components/code-block.md, the anatomy block. */
export const snippet = `from reward_lens.measure.card import CardInputs, card_plan
from reward_lens.verifier import ListCorpus, Rollout

plan = card_plan(CardInputs(
    verifier=VerifierUnderTest(Path("grade.py")),
))
print(plan.render())`;

export const snippetOutput = "2 of 13 fields would read; 11 would refuse.";

/** A poster that exists in this repository, so the film state renders. */
export const filmPoster = "/figures/campaign/cal-transfer.dark.png";

/**
 * The same rows with one numeric cell carrying an evidence id, which is what
 * components/data-table.md says every numeric cell does: "every numeric cell
 * carries its evidence id, rendering as a provenance-chip target." It is in the
 * gallery because a chip inside a horizontally scrolling table is the case that
 * exposes whether the panel is clipped.
 */
export const chippedDetectorRows: Row[] = detectorRows.map((row, i) =>
  i === 0
    ? { ...row, lead: { value: "+1.504", evidenceId, record } }
    : row,
);
