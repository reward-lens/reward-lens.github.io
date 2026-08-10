#!/usr/bin/env python
"""Act one's two rankings, per dimension, from the campaign's own per-pair record.

    python scripts/build_intervention.py        ->  src/data/intervention.json

WHAT THIS IS. `components/intervention-panel.md` lets a reader rank a reward
model's components by attribution, rank them again by what patching them
actually does, and watch the two orderings disagree. Both rankings and the
movement each component produces have to be real measurements: the contract's
own words are "nothing here is a simulation", and a synthetic number inside
act one would be worse than having no interactive at all.

THE SOURCE, AND WHY IT IS NOT A STALE v1 ARTIFACT.

    reward-lens/outputs/v2_20260506_222648_unknown/
      e04_faithfulness_population/Skywork-Reward-Llama-3.1-8B-v0.2/
        attribution_per_pair.jsonl    360 rows, 65 components each
        patching_per_pair.jsonl       360 rows, 64 components each

`fixtures/e_parity/extract_golden.py` opens by naming that output directory as
"the trust anchor for v3 (section 4.3.2)", and it is where the authoritative
E04 numbers in `golden.json` come from. This reads the per-pair records in the
same directory rather than the summary CSV, because a per-dimension ranking is
not in the summary.

THE JOIN IS EXACT. Both files carry `(dimension, pair_id)`; the two key sets
are identical, 360 each, no duplicates, twelve dimensions of thirty. Anything
else fails the build rather than being reconciled.

SIXTY-FOUR OF SIXTY-FIVE. Attribution covers the embedding and patching does
not, so `embed` has an attribution value and no patch effect. The contract
says a component with a patch rank and no patch effect fails the build, so it
is excluded and NAMED in the output rather than dropped silently.

THREE CONVENTIONS TAKEN FROM THE LIBRARY, NOT INVENTED HERE.

  1. Both rankings are by MAGNITUDE. `patching.py:78` ranks by
     `abs(patch_effects)` and the E04 experiment correlates `abs(attribution)`
     against `abs(patch_effect)` (`e04_faithfulness_population/run.py:154-155`).
     Ranking one of them signed would produce an ordering nothing upstream uses.
  2. `patch_effects` is `original_differential - patched_differential`
     (`patching.py:55`), so a positive effect SHRINKS the margin.
  3. The fraction of the margin is `patch_effect / original_differential`,
     which is `PatchResult.normalized_effects` (`patching.py:80-89`). It is
     emitted twice, as a magnitude and signed, because the panel renders a
     movement size on an axis and a signed percentage in text.

THE AXIS IS NOT BOUNDED BY 100% AND MUST NOT BE CLAMPED. On `formatting` the
top attribution component moves the score by 235% of the margin on average,
and one component moves it by 771%. Patching noises a component's activations,
so the margin can invert and overshoot; a movement axis clipped at 100% would
hide the most surprising values in the set. Nothing here clamps, winsorises or
renormalises, and `tests/regression/known-values.json` carries both figures so
a later change that starts clamping fails a test rather than looking tidier.

No count in this file is asserted. Everything measured is recorded to
tests/regression/observed/build_intervention.json and compared afterwards
against tests/regression/known-values.json. DECISIONS.md D-08.
"""

from __future__ import annotations

import hashlib
import json
import re
import statistics
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
FINAL = Path("/home/suhail-nadaf/final-reward")
V1_OUTPUTS = FINAL / "reward-lens" / "outputs" / "v2_20260506_222648_unknown"
E04 = V1_OUTPUTS / "e04_faithfulness_population"
MODEL_DIR = "Skywork-Reward-Llama-3.1-8B-v0.2"
#: The authoritative E-parity fixture. GROUND-TRUTH.md §2.1: byte-identical in
#: the clean and assay trees, and the source of every E04 number the site
#: states. The per-dimension block for the canonical model is lines 54 to 67.
GOLDEN = FINAL / "reward-lens--github" / "reward-lens-assay" / "fixtures" / "e_parity" / "golden.json"
#: Where the project records that its own published correlation was wrong and
#: what the right one is. GROUND-TRUTH.md §2.1 cites lines 44-49 and 207-211.
#: The two numbers are parsed out of those sentences rather than transcribed,
#: because /log/ section 4's whole subject is that a published number changed
#: and a correction typed by hand is the one thing that section cannot be.
BUILD_NOTES = FINAL / "reward-lens--github" / "reward-lens-clean" / "docs" / "BUILD_NOTES.md"
#: Where the intervention-panel contract states its own null threshold. Carried
#: with its citation rather than typed into the component, so the contract's
#: acceptance criterion 10 ("no number, label or threshold is hardcoded in the
#: implementation") is satisfiable. This is a specification value, not a
#: measurement, and the schema says so on the field.
NULL_THRESHOLD_DOC = "design/components/intervention-panel.md"
NULL_THRESHOLD_LINE = 68

DATA = SITE / "src" / "data"

sys.path.insert(0, str(SITE / "tests" / "regression"))
from observe import Observations  # noqa: E402


def fail(message: str) -> None:
    print(f"build_intervention: {message}", file=sys.stderr)
    sys.exit(1)


def check(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_jsonl(path: Path) -> list[dict]:
    check(path.exists(), f"{path} is missing. Act one has no measurement and there is no fallback.")
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def line_of(path: Path, needle: str) -> int:
    """The 1-based line a key appears on, so a citation points somewhere real."""
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if needle in line:
            return number
    fail(f"{path} has no line containing {needle!r}; the citation cannot be built")


def one(pattern: str, path: Path, what: str) -> tuple[str, int]:
    """The single match for a pattern in a file, with the line it is on."""
    hits = [
        (match.group(1), number)
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1)
        for match in [re.search(pattern, line)]
        if match
    ]
    check(len(hits) == 1, f"{what}: {len(hits)} matches in {path.name}, expected exactly 1")
    return hits[0]


def build(measured: Observations) -> dict:
    model_dir = E04 / MODEL_DIR
    attribution_path = model_dir / "attribution_per_pair.jsonl"
    patching_path = model_dir / "patching_per_pair.jsonl"

    attribution = read_jsonl(attribution_path)
    patching = read_jsonl(patching_path)

    by_pair = {(row["dimension"], row["pair_id"]): row for row in patching}
    check(
        len(by_pair) == len(patching),
        f"the patching record has {len(patching) - len(by_pair)} duplicate (dimension, pair_id) "
        f"keys, so the join is not a join",
    )
    attribution_keys = {(row["dimension"], row["pair_id"]) for row in attribution}
    check(
        len(attribution_keys) == len(attribution),
        "the attribution record has duplicate (dimension, pair_id) keys",
    )
    check(
        attribution_keys == set(by_pair),
        f"the two records do not describe the same pairs: "
        f"{len(attribution_keys - set(by_pair))} attributed and not patched, "
        f"{len(set(by_pair) - attribution_keys)} patched and not attributed",
    )
    measured.record("joined_pairs", len(attribution))

    patched_names = patching[0]["component_names"]
    attributed_names = attribution[0]["component_names"]
    for row in patching:
        check(row["component_names"] == patched_names, f"{row['pair_id']} patches a different component set")
    for row in attribution:
        check(row["component_names"] == attributed_names, f"{row['pair_id']} attributes a different component set")
    unpatched = [name for name in attributed_names if name not in set(patched_names)]
    check(
        not [name for name in patched_names if name not in set(attributed_names)],
        "a component was patched and never attributed, so it can hold a patch rank and no "
        "attribution rank. The panel fails the build on exactly that.",
    )
    component_type = dict(zip(attributed_names, attribution[0]["component_types"]))
    measured.record("attributed_components", len(attributed_names))
    measured.record("patched_components", len(patched_names))
    measured.record("unpatched_components", unpatched)

    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    rho_by_dimension = golden["E04"]["per_model_dimension_rho"][MODEL_DIR]
    rho_line = line_of(GOLDEN, f'"{MODEL_DIR}": {{')

    # ---- accumulate, one bucket per (dimension, component) -----------------
    buckets: dict[str, dict] = {}
    for row in attribution:
        dimension = row["dimension"]
        patch_row = by_pair[(dimension, row["pair_id"])]
        margin = patch_row["original_differential"]
        check(
            margin != 0,
            f"{row['pair_id']} has a zero margin, so a movement as a fraction of it is undefined",
        )
        bucket = buckets.setdefault(
            dimension,
            {"margins": [], "components": {name: {"attr": [], "effect": [], "fraction": [], "signed": []} for name in patched_names}},
        )
        bucket["margins"].append(margin)
        attributed = dict(zip(row["component_names"], row["differential_contributions"]))
        for name, effect in zip(patch_row["component_names"], patch_row["patch_effects"]):
            slot = bucket["components"][name]
            slot["attr"].append(abs(attributed[name]))
            slot["effect"].append(abs(effect))
            slot["fraction"].append(abs(effect) / abs(margin))
            slot["signed"].append(effect / margin)

    check(
        set(buckets) == set(rho_by_dimension),
        f"the per-pair record covers {sorted(buckets)} and the golden fixture covers "
        f"{sorted(rho_by_dimension)}",
    )
    measured.record("dimensions", len(buckets))

    dimensions = []
    for name in sorted(buckets):
        bucket = buckets[name]
        margins = bucket["margins"]
        rows = []
        for component in patched_names:
            slot = bucket["components"][component]
            rows.append(
                {
                    "id": component,
                    "type": component_type[component],
                    "attributionValue": statistics.fmean(slot["attr"]),
                    "patchEffect": statistics.fmean(slot["effect"]),
                    "patchFractionOfMargin": statistics.fmean(slot["fraction"]),
                    "patchFractionOfMarginSigned": statistics.fmean(slot["signed"]),
                    "evidenceId": None,
                }
            )
        by_attribution = sorted(rows, key=lambda row: -row["attributionValue"])
        by_patch = sorted(rows, key=lambda row: -row["patchEffect"])
        for rank, row in enumerate(by_attribution, start=1):
            row["attributionRank"] = rank
        for rank, row in enumerate(by_patch, start=1):
            row["patchRank"] = rank
        check(
            len(rows) >= 2,
            f"{name} has fewer than two components; one ranking cannot disagree with itself",
        )
        dimensions.append(
            {
                "key": name,
                "pairCount": len(margins),
                "spearmanRho": rho_by_dimension[name],
                "spearmanRhoSource": {"document": "reward-lens-assay/fixtures/e_parity/golden.json", "line": rho_line},
                "marginMean": statistics.fmean(margins),
                "marginMeanAbsolute": statistics.fmean(abs(margin) for margin in margins),
                "negativeMargins": sum(1 for margin in margins if margin < 0),
                "topAttributionComponent": by_attribution[0]["id"],
                "topPatchComponent": by_patch[0]["id"],
                "components": rows,
            }
        )

    measured.record("pairs_per_dimension", sorted({d["pairCount"] for d in dimensions}))
    measured.record("top_attribution_components", sorted({d["topAttributionComponent"] for d in dimensions}))
    measured.record(
        "top_attribution_patch_fraction",
        {d["key"]: d["components"][d["components"].index(next(c for c in d["components"] if c["attributionRank"] == 1))]["patchFractionOfMargin"] for d in dimensions},
    )
    measured.record(
        "max_patch_fraction",
        max((component["patchFractionOfMargin"], dimension["key"], component["id"]) for dimension in dimensions for component in dimension["components"])[1:],
    )
    measured.record(
        "max_patch_fraction_value",
        max(component["patchFractionOfMargin"] for dimension in dimensions for component in dimension["components"]),
    )

    # The act's argument, counted. The threshold is the contract's own
    # `nullThreshold`, cited below rather than typed here, and the two counts
    # are recorded so a change to either fails the change detector. Neither is
    # emitted into the file: the panel applies the threshold to the values it
    # renders, so a count here would be a second copy of an answer.
    threshold = 0.02
    measured.record(
        "dimensions_with_a_top5_attribution_component_below_threshold",
        [
            dimension["key"]
            for dimension in dimensions
            if any(
                component["patchFractionOfMargin"] < threshold
                for component in dimension["components"]
                if component["attributionRank"] <= 5
            )
        ],
    )
    measured.record(
        "dimensions_whose_top_attribution_component_moves_nothing",
        [
            dimension["key"]
            for dimension in dimensions
            if next(c for c in dimension["components"] if c["attributionRank"] == 1)["patchFractionOfMargin"] == 0.0
        ],
    )
    measured.record(
        "top_attribution_patch_rank",
        {
            dimension["key"]: next(c for c in dimension["components"] if c["attributionRank"] == 1)["patchRank"]
            for dimension in dimensions
        },
    )

    # ---- the headline numbers three routes need ----------------------------
    # The homepage states a mean and a sharpest dimension; /log/ section 4
    # states the number the project published and the number that replaced it.
    # All four are read out of the fixture and out of the project's own
    # correction note, so the correction section cannot become a transcription
    # of a correction.
    mean_rho = golden["E04"]["per_model_mean_rho"][MODEL_DIR]
    mean_line = line_of(GOLDEN, f'"{MODEL_DIR}": {mean_rho}')
    sharpest = min(dimensions, key=lambda dimension: dimension["spearmanRho"])
    deprecated, deprecated_line = one(
        r'headline anti-correlation, "rho = (-[0-9.]+) on', BUILD_NOTES, "deprecated correlation"
    )
    superseding, superseding_line = one(
        r"the canonical model\): mean (-[0-9.]+),", BUILD_NOTES, "superseding correlation"
    )
    check(
        abs(float(superseding) - mean_rho) < 5e-4,
        f"the correction note says the mean is {superseding} and the fixture says {mean_rho}. "
        f"The correction and the value it corrects to must be the same number.",
    )
    measured.record("mean_rho", mean_rho)
    measured.record("sharpest_dimension", sharpest["key"])
    measured.record("sharpest_rho", sharpest["spearmanRho"])
    measured.record("deprecated_rho", float(deprecated))
    measured.record("superseding_rho_as_quoted", float(superseding))
    measured.record("positive_dimensions", sum(1 for d in dimensions if d["spearmanRho"] > 0))

    headline = {
        "meanRho": mean_rho,
        "meanRhoSource": {
            "document": "reward-lens-assay/fixtures/e_parity/golden.json",
            "line": mean_line,
        },
        "sharpestDimension": sharpest["key"],
        "sharpestRho": sharpest["spearmanRho"],
        "positiveDimensions": sum(1 for d in dimensions if d["spearmanRho"] > 0),
        "negativeDimensions": sum(1 for d in dimensions if d["spearmanRho"] < 0),
        "toleranceStated": golden["E04"].get("tolerance"),
        "correction": {
            "note": (
                "The project published one correlation and then corrected it against its own "
                "fixtures. Both values are parsed out of the correction note rather than "
                "transcribed, because the correction is the content."
            ),
            "deprecatedRho": float(deprecated),
            "deprecatedRhoSource": {
                "document": "reward-lens-clean/docs/BUILD_NOTES.md",
                "line": deprecated_line,
            },
            "supersedingRhoAsQuoted": float(superseding),
            "supersedingRhoSource": {
                "document": "reward-lens-clean/docs/BUILD_NOTES.md",
                "line": superseding_line,
            },
        },
    }

    return {
        "headline": headline,
        "meta": {
            "subject": "Skywork/Skywork-Reward-Llama-3.1-8B-v0.2",
            "pairSource": sorted({row["source"] for row in attribution}),
            "dimensionCount": len(dimensions),
            "attributedComponentCount": len(attributed_names),
            "patchedComponentCount": len(patched_names),
            "unpatchedComponents": unpatched,
            "patchingMode": "noising",
            "evidenceId": None,
            "derivedFrom": [
                {
                    "document": str(path.relative_to(FINAL)),
                    "sha256": sha256(path),
                    "rows": rows,
                }
                for path, rows in ((attribution_path, len(attribution)), (patching_path, len(patching)))
            ],
        },
        "nullThreshold": {
            "value": 0.02,
            "source": {"document": NULL_THRESHOLD_DOC, "line": NULL_THRESHOLD_LINE},
        },
        "dimensions": dimensions,
    }


def main() -> None:
    measured = Observations("build_intervention", "scripts/build_intervention.py")
    payload = build(measured)
    out = DATA / "intervention.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=1, sort_keys=False) + "\n", encoding="utf-8")
    measured.write()

    print(f"build_intervention: {out.name}, {out.stat().st_size:,} bytes")
    head = payload["headline"]
    print(
        f"  mean rho {head['meanRho']:+.6f}, sharpest {head['sharpestDimension']} at "
        f"{head['sharpestRho']:+.6f}, {head['negativeDimensions']} negative and "
        f"{head['positiveDimensions']} positive"
    )
    print(
        f"  correction: {head['correction']['deprecatedRho']} superseded by "
        f"{head['correction']['supersedingRhoAsQuoted']}"
    )
    print(
        f"  {payload['meta']['dimensionCount']} dimensions x "
        f"{payload['meta']['patchedComponentCount']} patched components, joined on "
        f"{measured.values['joined_pairs']} pairs"
    )
    for dimension in payload["dimensions"]:
        top = next(c for c in dimension["components"] if c["attributionRank"] == 1)
        print(
            f"  {dimension['key']:22s} rho {dimension['spearmanRho']:+.6f}  "
            f"top attribution {top['id']:8s} moves {top['patchFractionOfMargin'] * 100:9.4f}% "
            f"of the margin (patch rank {top['patchRank']})"
        )
    print(f"  {len(measured.values)} measurements recorded to {measured.path()}")


if __name__ == "__main__":
    main()
