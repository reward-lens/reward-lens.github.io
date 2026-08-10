#!/usr/bin/env python
"""Vendor campaign artifacts into the site repo as typed JSON plus optimized images.

This script is the only bridge between the campaign evidence on local disk and
the site. It is idempotent, and records a provenance manifest for every
vendored file. Run it with the project venv:

    /home/suhail-nadaf/final-reward/.venv/bin/python scripts/build_data.py

The site build itself (npm run build) never reads outside the repo; CI re-checks
the committed outputs with scripts/checks/data_assertions.mjs.

WHAT THIS SCRIPT NO LONGER DOES. It used to carry the answers: three tables of
expected values and twenty-one `check(n == <literal>)` calls. A pipeline that
confirms numbers already written into it is a second copy of the same numbers,
and the copy is edited in the same commit as the code that produces it, so it
can never disagree. DECISIONS.md D-08.

Every measurement is now `measured.record(...)`ed and written to
tests/regression/observed/build_data.json, and the value that was true when a
human last looked lives in tests/regression/known-values.json.
`node --test tests/regression/known-values.test.mjs` compares them after
generation and fails naming the key, the expected value and the observed one.

`check()` survives for structural invariants, which carry no measurement: this
file exists, this figure is in the summary, the parsed kill notes cover exactly
the kills the ledger found. Those fail on a broken run rather than on a changed
one, so they belong here.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
FINAL = Path("/home/suhail-nadaf/final-reward")
CAMPAIGN = FINAL / "campaign-results"
CAMPAIGN_SRC = FINAL / "reward-lens--github" / "reward-lens-campaign"
CAMPAIGN_CONFIG = CAMPAIGN_SRC / "campaign" / "config.py"
DATA = SITE / "src" / "data"
PUB_FIG = SITE / "public" / "figures"

# The change detector's recording half. See tests/regression/observe.py.
sys.path.insert(0, str(SITE / "tests" / "regression"))
from observe import Observations  # noqa: E402

# Local-path redaction, applied in write_json. See scripts/pubpath.py.
sys.path.insert(0, str(SITE / "scripts"))
from pubpath import redact  # noqa: E402

# EXPECTED_KILLS, EXPECTED_VERDICTS and EXPECTED_HEADLINES used to sit here.
# All three are in tests/regression/known-values.json now, under
# build_data.kill_ids, build_data.card_verdicts and build_data.headlines. The
# generator reads none of them: it records what it found and the test says
# whether that is still what a human signed off on.

# The fleet the site publishes a model card for. This is a selection, not a
# measurement: it says which of the campaign's subjects the site surfaces.
FLEET = [
    "skywork-v2-qwen3-0.6b",
    "skywork-v2-qwen3-1.7b",
    "skywork-v2-qwen3-4b",
    "skywork-v2-qwen3-8b",
    "skywork-v2-llama31-8b",
    "skywork-v01",
    "skywork-v02",
    "armorm",
    "tulu-rm",
    "grm-gemma2-2b",
]

SCIENCE_NAMES = {
    "S1": "Ground truth and calibration",
    "S2": "Gauge and the scalar bottleneck",
    "S3": "Reward thermodynamics",
    "S4": "Reward field theory",
    "S5": "Capacity theory of bias",
    "S6": "Preference topology",
    "S7": "Reward embryology and pretraining origins",
    "S8": "The knowledge-reward gap",
    "S9": "Do verifiers verify",
    "S10": "Decompiling and the legibility frontier",
    "S11": "Values, pluralism and paradigm physiology",
    "S12": "Hackability forecasting and certified prevention",
    "S13": "The recorder, coupling, robustness, kinship and weak-to-strong",
    "S14": "Thermodynamic phase structure",
    "S15": "Trajectory forensics and the economics of grading",
    "S16": "Certified robustness, attack surface and eval-awareness",
}


def fail(msg: str) -> None:
    print(f"ASSERTION FAILED: {msg}", file=sys.stderr)
    sys.exit(1)


def check(cond: bool, msg: str) -> None:
    if not cond:
        fail(msg)


#: Set on the child when this script re-executes itself, so a target
#: interpreter that turns out not to carry the library fails rather than
#: hunting for a third one.
_BOOTSTRAP_FLAG = "REWARD_LENS_SITE_BOOTSTRAPPED"


def require_library() -> None:
    """Run under an interpreter that can import the library, or fail the build.

    Gate 3 is `python scripts/build_data.py`. The fleet section reads the
    campaign evidence store through `reward_lens.core.store`, so an
    interpreter without the library produces no fleet at all, and the failure
    it produces (`ModuleNotFoundError: reward_lens`, three quarters of the way
    through a long run) names the symptom rather than the cause.

    THE PROPERTY THAT MATTERS IS THAT A MISSING LIBRARY FAILS THE BUILD. This
    is the same rule `build_catalogue.py` carries and for the same reason: the
    site renders the library's own output rather than a transcription of it,
    so there is nothing to fall back to. Finding the interpreter is a
    convenience on top of that rule, never a substitute for it.

    Order: whatever is already running, then `$REWARD_LENS_PYTHON` (the name
    `claims_gate.sh` already uses), then the assay venv named in
    HANDOFF.md §2. Each candidate is probed with a real import before this
    process is replaced, so a venv missing the library is skipped rather than
    inherited.
    """
    if importlib.util.find_spec("reward_lens") is not None:
        return
    if os.environ.get(_BOOTSTRAP_FLAG):
        fail(
            "re-executed under an interpreter that cannot import reward_lens either. "
            "Stopping rather than searching for a third one."
        )
    candidates = [
        os.environ.get("REWARD_LENS_PYTHON"),
        str(FINAL / ".venv-assay" / "bin" / "python"),
    ]
    for candidate in candidates:
        if not candidate or not Path(candidate).exists():
            continue
        probe = subprocess.run(
            [candidate, "-c", "import reward_lens"],
            capture_output=True,
        )
        if probe.returncode != 0:
            continue
        environment = dict(os.environ, **{_BOOTSTRAP_FLAG: "1"})
        os.execve(candidate, [candidate, *sys.argv], environment)  # does not return
    fail(
        f"cannot import reward_lens under {sys.executable}, and no interpreter that can "
        f"was found.\n"
        f"  The fleet section reads the campaign evidence store through the library, so "
        f"there is nothing here to render and there is no committed fallback.\n"
        f"  Tried, in order: $REWARD_LENS_PYTHON, then "
        f"{FINAL / '.venv-assay' / 'bin' / 'python'}.\n"
        f"  Run it with one of them, or set REWARD_LENS_PYTHON."
    )


def trust_rung_names() -> dict[int, str]:
    """Rung integer to rung word, read out of the library rather than typed.

    Two mappings exist and they run in opposite directions. The library's
    `TrustLevel` is rung to name; `src/components/base/data.ts`'s `trustRung`
    is name to index. Components render and colour a trust level BY NAME, so
    every generated file carries the word, and the integer beside it for
    anything comparing rungs.

    Imported here rather than at module scope because `require_library` may
    replace this process before anything can be imported.
    """
    from reward_lens.core.types import TrustLevel  # noqa: PLC0415

    return {int(level.value): level.name.lower() for level in TrustLevel}


def register_campaign_payloads() -> None:
    """Import the payload types the campaign store's records are typed with.

    Without this the store raises `PayloadTypeUnregistered` on the first
    `campaign.payloads.TablePayload` it decodes, which is `build_card`'s first
    call. The library raises rather than degrading to a plain dict on purpose,
    and that guarantee is worth more than the convenience: a `Blind[T]` whose
    type is unregistered would decode to a mapping carrying the very label the
    type exists to keep out of a detector's reach.

    The decorator that registers them runs at import time, so importing the
    module IS the registration. The path this used to insert was `FINAL`,
    which is where `campaign/` has not lived since the repositories were split
    into `reward-lens--github/`, so the import silently never happened.
    """
    check(
        (CAMPAIGN_SRC / "campaign" / "payloads.py").exists(),
        f"{CAMPAIGN_SRC / 'campaign' / 'payloads.py'} is missing, so the campaign store's "
        f"records cannot be decoded as the types they were written as.",
    )
    sys.path.insert(0, str(CAMPAIGN_SRC))
    import campaign.payloads  # noqa: F401,E402 - imported for its registration side effect


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def unwrap(value):
    """Unwrap the store's __map__/__seq__ JSON payload encoding."""
    if isinstance(value, dict):
        if "__map__" in value:
            return {k: unwrap(v) for k, v in value["__map__"].items()}
        if "__seq__" in value:
            return [unwrap(v) for v in value["__seq__"]]
        return {k: unwrap(v) for k, v in value.items()}
    if isinstance(value, list):
        return [unwrap(v) for v in value]
    return value


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Local paths are redacted here rather than at each field that records one,
    # so a field added later is covered without anybody remembering to. See
    # scripts/pubpath.py for the substitution table and why it raises rather
    # than dropping an unrecognised root.
    obj = redact(obj, where=path.name)
    path.write_text(json.dumps(obj, indent=1, sort_keys=False) + "\n", encoding="utf-8")


class Provenance:
    """Provenance manifest: source path, sha256, size, extraction date, commit."""

    def __init__(self, manifest_path: Path):
        self.path = manifest_path
        self.prior = {}
        if manifest_path.exists():
            self.prior = {e["output"]: e for e in load_json(manifest_path)["files"]}
        self.entries = []
        try:
            self.commit = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=SITE,
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip()
        except Exception:
            self.commit = "uncommitted"

    def record(self, source: Path, output: Path) -> None:
        digest = sha256(source)
        rel_out = str(output.relative_to(SITE))
        prior = self.prior.get(rel_out)
        extracted = (
            prior["extracted"]
            if prior and prior["sha256"] == digest
            else date.today().isoformat()
        )
        self.entries.append(
            {
                "output": rel_out,
                "source": str(source),
                "sha256": digest,
                "bytes": source.stat().st_size,
                "extracted": extracted,
                "pipeline_commit": self.commit,
            }
        )

    def write(self) -> None:
        self.entries.sort(key=lambda e: e["output"])
        write_json(self.path, {"files": self.entries})


# ---------------------------------------------------------------------------
# The homepage decomposition
# ---------------------------------------------------------------------------

#: The evidence record the hero's bands come from. DECISIONS.md D-37.
#: One grader's comparison flow, split into three orthogonal parts by the
#: combinatorial Hodge decomposition. NOT a reward score's components: P1's
#: retrieval established that nothing in this repository decomposes one, and
#: D-37 chose real data at the site's own evidential standard over a
#: closer-sounding quantity measured on a 2.4-million-parameter testing model.
#:
#: CORRECTED 2026-08-08 per D-37's own correction. This was bound to
#: `campaign.result.TOPO-HODGE`, `ev:fa30cdb6d1f8e6ce6fe521c41a959b64`, which
#: is real upstream and is FILTERED OUT of the site's evidence store: the
#: vendoring below keeps observables beginning `campaign.adjudication.` and
#: nothing else, so `resolveEvidence()` would have failed the build the moment
#: the hero rendered its chip. The adjudication record carries the identical
#: masses and is the record holding the registered prediction and the confirmed
#: verdict, which is the provenance the hero is actually claiming.
DECOMPOSITION_OBSERVABLE = "campaign.adjudication.TOPO-HODGE"
DECOMPOSITION_EVIDENCE_ID = "ev:844ad06a5aeb1d89c21c13c19a28cbd2"

#: The upstream payload record, same decomposition, richer. It carries the
#: per-dataset splits and their tournament counts, which the adjudication
#: record does not, and it is not in the site's evidence store. Every number
#: taken from it therefore carries a D-35 citation and a null evidence id
#: rather than an id that resolves to nothing.
DECOMPOSITION_PAYLOAD_OBSERVABLE = "campaign.result.TOPO-HODGE"
DECOMPOSITION_PAYLOAD_EVIDENCE_ID = "ev:fa30cdb6d1f8e6ce6fe521c41a959b64"

#: The three parts, in the order `hodge.py` derives them: the flow is projected
#: onto the gradient space first, the remainder onto the curl space, and what
#: survives both is harmonic. Position carries identity, so this order is the
#: derivation's and not a presentation choice.
DECOMPOSITION_PARTS = ("gradient", "curl", "harmonic")

#: `intransitive_mass` is in the same record and is NOT a fourth part. It is
#: `curl + harmonic` (hodge.py:441-442, "Reported only beside its two parts,
#: never instead of them"), so a band for it double-counts the whole
#: intransitive half of the flow.
DECOMPOSITION_DERIVED_ROWS = ("intransitive_mass",)

#: float64 machine epsilon. The masses sum to 1.0, so a mass below this is
#: smaller than the precision of the arithmetic that produced it: it is a
#: measured absence rather than a measured small number. Not a display
#: threshold and not a guess about pixels.
FLOAT64_EPS = 2.220446049250313e-16

#: `hodge.py:96`. The relative tolerance the decomposition's own structural
#: self-checks use, quoted so the closure claim in this file carries the number
#: it was certified against.
HODGE_STRUCTURAL_TOL = 1e-8


def build_decomposition(measured: Observations) -> dict:
    """The bands the homepage room disperses into.

    DESIGN.md section 11 state 1: "one collimated beam enters a dispersing
    element and leaves as bands whose widths are the real component
    magnitudes". What is dispersed here is one grader's comparison energy, and
    the parts are the three orthogonal subspaces a flow on a comparison graph
    decomposes into: the part that corresponds to a consistent scalar ordering,
    the part that circulates around triangles, and the part that wraps a hole
    in the comparison design.

    THE BAND COUNT IS WHATEVER THE DECOMPOSITION CONTAINS. `tokens.css:228`
    defines six component colours "because a decomposition shows at most six at
    once"; this decomposition has three, so three render and `--comp-4` through
    `--comp-6` stay unused. GROUND-TRUTH.md C-7. A hand-set count in the SVG is
    the thing that must not happen, in either direction: padding to six is the
    same defect as truncating to two.

    NO LABELS ARE EMITTED. Each band carries `part`, one of the three keys
    above. The build lead binds the display strings, because the figure no
    longer asserts what the old alt text said and naming it is a copy decision
    (HANDOFF.md rule 1).

    THE EXIT ANGLE IS DERIVED, and the rule is stated in the file rather than
    hidden in a renderer. Bands are laid end to end across the fan in the
    derivation's order; each band's angle is the centre of its own share.

    WHAT THAT DOES AT 2.4e-31, which is the case that matters here. Every
    division is by the measured total, never by a band's own share, so a band
    of any magnitude down to and including exactly zero yields a finite angle
    and the fan cannot collapse. The harmonic band's share is 2.4e-31, so its
    `angularWidth` is 5.8e-30 degrees and its `exitAngle` sits at the outer
    edge of the fan, where the cumulative share has already reached 1. Nothing
    is floored, clamped, rounded away or dropped: the values are emitted at
    full float64 precision, and `belowFloat64Epsilon` says in the data that the
    band is smaller than the arithmetic that produced it can resolve. That is
    what makes it renderable as a labelled absence rather than as a sliver.
    """
    path = CAMPAIGN / "runs" / "campaign" / "evidence.jsonl"
    record = None
    payload_record = None
    payload_line = None
    with path.open("r", encoding="utf-8") as fh:
        for number, line in enumerate(fh, start=1):
            line = line.strip()
            if not line:
                continue
            env = json.loads(line)
            if env.get("id") == DECOMPOSITION_EVIDENCE_ID:
                record = env
            elif env.get("id") == DECOMPOSITION_PAYLOAD_EVIDENCE_ID:
                payload_record = env
                payload_line = number
    check(
        record is not None,
        f"{DECOMPOSITION_EVIDENCE_ID} is not in the store, so the hero has no decomposition "
        f"to disperse and there is no placeholder for one",
    )
    check(
        record["observable"] == DECOMPOSITION_OBSERVABLE,
        f"{DECOMPOSITION_EVIDENCE_ID} is {record['observable']}, not "
        f"{DECOMPOSITION_OBSERVABLE}; D-37 binds the hero to the latter",
    )
    check(
        payload_record is not None,
        f"{DECOMPOSITION_PAYLOAD_EVIDENCE_ID} is not in the store, so the per-dataset splits "
        f"cannot be read and the scope line loses its count",
    )
    check(
        payload_record["observable"] == DECOMPOSITION_PAYLOAD_OBSERVABLE,
        f"{DECOMPOSITION_PAYLOAD_EVIDENCE_ID} is {payload_record['observable']}, not "
        f"{DECOMPOSITION_PAYLOAD_OBSERVABLE}",
    )

    rows = {
        str(name): float(value)
        for name, value in unwrap(record["value"])["metrics"].items()
    }
    fields = unwrap(payload_record["value"])["fields"]
    payload_rows = {str(name): float(value) for name, value in fields["rows"]}
    # The two records are the same measurement written down twice, so they have
    # to agree. This is the check that would have caught the mis-binding it is
    # being added alongside: an adjudication record whose metrics had drifted
    # from the payload it adjudicates is a decomposition nobody can trace.
    disagree = sorted(
        name
        for name in set(rows) & set(payload_rows)
        if rows[name] != payload_rows[name]
    )
    check(
        not disagree,
        f"the adjudication record and the payload record disagree on {disagree}. They are one "
        f"measurement recorded twice and the hero cannot render both.",
    )

    # Structural: the record must carry every part and the derived row the
    # bands deliberately exclude. Both are invariants of a Hodge result, so
    # they hold for any correct one and carry no measurement.
    missing = [p for p in DECOMPOSITION_PARTS if f"{p}_mass" not in rows]
    check(not missing, f"the record carries no {missing} mass, so it is not a Hodge split")
    check(
        all(k in rows for k in DECOMPOSITION_DERIVED_ROWS),
        f"the record carries no {DECOMPOSITION_DERIVED_ROWS}, which this file must exclude "
        f"by name rather than by assuming it is absent",
    )

    masses = [rows[f"{part}_mass"] for part in DECOMPOSITION_PARTS]
    total = sum(masses)
    check(total > 0, "the decomposition sums to zero, so no band has a width")
    # The parts are a partition of the flow's energy, so they sum to one. This
    # is the property that makes them bands rather than five numbers beside
    # each other, and it is checked against the library's own tolerance rather
    # than one invented here.
    check(
        abs(total - 1.0) <= HODGE_STRUCTURAL_TOL,
        f"the three masses sum to {total!r}, not 1. A decomposition whose parts do not close "
        f"is not a decomposition and must not be rendered as one.",
    )
    # The derived row must equal the two parts it is made of, or the exclusion
    # below is hiding a disagreement rather than a duplicate.
    intransitive = rows["intransitive_mass"]
    check(
        abs(intransitive - (rows["curl_mass"] + rows["harmonic_mass"])) <= HODGE_STRUCTURAL_TOL,
        f"intransitive_mass {intransitive!r} is not curl + harmonic; excluding it as a "
        f"duplicate would then be dropping a number rather than avoiding a double count",
    )

    #: The full angular spread of the fan, in degrees. A rendering constant and
    #: the only one: it sets how wide the fan opens, never how the bands sit
    #: inside it, which is entirely the data's.
    fan_degrees = 24.0

    bands = []
    cumulative = 0.0
    for index, part in enumerate(DECOMPOSITION_PARTS):
        magnitude = rows[f"{part}_mass"]
        share = magnitude / total
        centre = cumulative + share / 2
        cumulative += share
        bands.append(
            {
                "index": index,
                "part": part,
                "componentToken": f"--comp-{index + 1}",
                "magnitude": magnitude,
                "share": share,
                "exitAngle": (centre - 0.5) * fan_degrees,
                "angularWidth": share * fan_degrees,
                # True where the band is smaller than float64 can resolve
                # against a total of 1. It is not zero and it is not small: it
                # is below the precision of its own arithmetic, which is why it
                # renders as a labelled absence rather than as a thin band.
                "belowFloat64Epsilon": share < FLOAT64_EPS,
            }
        )

    measured.record("decomposition_bands", len(bands))
    measured.record("decomposition_parts", [b["part"] for b in bands])
    measured.record("decomposition_masses", masses)
    measured.record("decomposition_total", total)
    measured.record(
        "decomposition_bands_below_epsilon",
        sum(1 for b in bands if b["belowFloat64Epsilon"]),
    )

    meta = fields.get("meta") or {}
    per_dataset = meta.get("per_dataset") or {}

    # copy.yaml:home.figure.decomposition.scope reads "{{tournament_count}}
    # tournaments each", which is one number over two datasets. Derived here
    # and only when they agree, so the page never has to assert that they do.
    # If they diverge the field goes null and the scope line loses its number
    # rather than quietly reporting one dataset's count as both.
    counts = {int(split["n_tournaments"]) for split in per_dataset.values() if "n_tournaments" in split}
    tournaments_each = counts.pop() if len(counts) == 1 else None

    return {
        "note": (
            "Three bands, and the count is the decomposition's rather than the renderer's. "
            "tokens.css defines six component colours because a decomposition shows at most six "
            "at once; this one has three, so --comp-4 through --comp-6 stay unused. Padding to "
            "six would be the same defect as a hand-set count."
        ),
        "excludesNote": (
            "The record also carries intransitive_mass, which is NOT a fourth part: it is "
            "curl + harmonic, and hodge.py:441-442 says it is 'reported only beside its two "
            "parts, never instead of them'. A band for it would double-count the whole "
            "intransitive half of the flow. It is carried below as a derived total, outside "
            "`bands`, so nothing can render it as one."
        ),
        "subject": "one grader's comparison flow over two public preference datasets",
        # The record's own label for itself. It contains a campaign card id,
        # which data/banned-terms.json bans from rendered text, so this is a
        # store-only field: it identifies the record in a provenance panel and
        # it is not the figure's caption. The caption is a copy decision.
        "quantityStoreLabel": str(fields.get("name")),
        "unit": "1 [share of total comparison energy]",
        "fanDegrees": fan_degrees,
        "angleRule": (
            "Bands are laid end to end across the fan in the order the decomposition derives "
            "them. exitAngle is the centre of each band's own share measured from the fan's "
            "axis, and angularWidth is its share of the fan. Every division is by the measured "
            "total and never by a band's own share, so a band of any magnitude down to and "
            "including exactly zero yields a finite angle and the fan cannot collapse. The "
            "harmonic band's share is 2.4e-31: its angularWidth is 5.8e-30 degrees and its "
            "exitAngle sits at the fan's outer edge. Nothing is floored, clamped or dropped, "
            "the values are emitted at full float64 precision, and belowFloat64Epsilon marks "
            "the band as smaller than the arithmetic that produced it can resolve."
        ),
        "bands": bands,
        "derivedTotals": {
            "note": (
                "Reported by the record and deliberately not a band. See excludesNote."
            ),
            "intransitiveMass": intransitive,
        },
        "closure": {
            "note": (
                "Closure is a precondition of these numbers existing, not a residual reported "
                "beside them. hodge.py:558-566 asserts orthogonality, reconstruction and that "
                "the masses sum to 1 before returning, and hodge_split escalates a sparse solve "
                "to a dense one rather than returning a decomposition it cannot certify. So "
                "there is no conservation error to render here: a split that did not close "
                "would have raised instead of reaching this file."
            ),
            "structuralTolerance": HODGE_STRUCTURAL_TOL,
            "toleranceSource": "reward_lens/measure/composition/hodge.py:96",
            "massesSumTo": total,
            "assertedBy": "reward_lens/measure/composition/hodge.py:558-566",
        },
        "perDataset": {
            "note": (
                "TWO DECOMPOSITIONS, NOT SIX PARTS. nectar and ultrafeedback are separate "
                "subjects, each with its own three-way split, and concatenating them to reach "
                "six bands would be inventing a decomposition nobody measured. Held outside "
                "`bands` so a renderer cannot reach them as ones."
            ),
            # Everything under perDataset comes from the payload record, which
            # the site's evidence store does not carry, so DECISIONS.md D-35
            # applies exactly as it does on the run: no id is minted, and the
            # document and line take its place. A reader opens the campaign
            # store at that line and reads the same numbers.
            "evidenceId": None,
            "source": {
                "document": "campaign-results/runs/campaign/evidence.jsonl",
                "line": payload_line,
            },
            "observable": payload_record["observable"],
            "tournamentsEach": tournaments_each,
            "datasetCount": len(per_dataset),
            "datasets": {
                name: {
                    "masses": {
                        part: split[f"{part}_mass"]
                        for part in DECOMPOSITION_PARTS
                        if f"{part}_mass" in split
                    },
                    "tournaments": split.get("n_tournaments"),
                    "edges": split.get("n_edges"),
                }
                for name, split in sorted(per_dataset.items())
            },
        },
        "evidenceId": record["id"],
        "observable": record["observable"],
        # The rung WORD, for the same reason evidence-records.json carries the
        # word: a component renders a trust level by name and colours it by
        # name, and "2" is neither.
        "trust": trust_rung_names().get(int(record["trust"])) if record.get("trust") is not None else None,
        "trustRung": int(record["trust"]) if record.get("trust") is not None else None,
        "provenance": {
            "generatedBy": "scripts/build_data.py",
            "sourceCommit": (record.get("provenance") or {}).get("git_sha"),
            "createdAt": record.get("created_at"),
        },
    }


# ---------------------------------------------------------------------------
# The run series
# ---------------------------------------------------------------------------

#: The public per-rollout table, cached on disk by the library's own X5
#: experiment. 25,664 rows, one per rollout, with the step index on each.
AISI_ROLLOUTS = (
    FINAL
    / "reward-lens--github"
    / "reward-lens-assay"
    / "experiments"
    / "x5_threshold"
    / "aisi_lengths.npz"
)
#: The frozen prediction ledger. Rows R3 and R4 are the registered predictions
#: resolved on this run, and they carry the detector numbers.
PREDICTIONS = FINAL / "reward-lens--github" / "reward-lens-assay" / "PREDICTIONS.md"


def _predictions_row(text: str, row_id: str) -> tuple[str, int]:
    """One row of the frozen prediction ledger, with the line it is on.

    Parsed rather than transcribed: the same shape as the kill notes above,
    which read their sentences out of RESULTS.md instead of carrying a copy.
    A row that does not parse fails the build, because a detector table
    assembled from a half-matched regex is worse than none."""
    for number, line in enumerate(text.splitlines(), start=1):
        if line.startswith(f"| {row_id} |"):
            return line, number
    fail(f"{PREDICTIONS} has no row {row_id}; the run's registered predictions cannot be read")


def _one(pattern: str, text: str, what: str) -> str:
    found = re.findall(pattern, text)
    check(len(found) == 1, f"{what}: {len(found)} matches in the prediction row, expected exactly 1")
    return found[0]


def build_run_series(measured: Observations, prov: Provenance) -> tuple[dict, Path]:
    """Act two's run, from the public rollout table and the frozen ledger.

    WHAT IS DERIVED AND WHAT IS PARSED, because they are not the same thing.

    The step index, the rollout count and all three per-step series are
    computed from `aisi_lengths.npz`, which is the public per-rollout table the
    library's X5 experiment cached: 25,664 rows, 64 per step. Nothing about
    them is transcribed.

    The detector rows are parsed out of PREDICTIONS.md rows R3 and R4. They
    cannot be computed here and it is not for want of looking:
    `experiments/i5_variance_derivative.py:8` opens with the finding that "the
    campaign evidence store contains no series this experiment can run on",
    and R3 records that "the published rollout table carries no optimiser
    telemetry, so the gradient-norm comparator cannot be computed". The frozen
    ledger is the record of that resolution, so it is the source, and each
    number carries the document and line it came from.

    THE STEP COUNT IS NOT RESOLVED HERE. DECISIONS.md D-03: the site says 400
    and discloses that two records say 400 and 401.
    """
    import numpy as np  # noqa: PLC0415 - only this section needs it

    check(
        AISI_ROLLOUTS.exists(),
        f"{AISI_ROLLOUTS} is missing, so act two has no run. There is no synthetic fallback.",
    )
    table = np.load(AISI_ROLLOUTS)
    step = table["step"]
    steps = [int(s) for s in np.unique(step)]
    per_step = {s: step == s for s in steps}

    def rate(column: str) -> list[float]:
        values = table[column]
        return [round(float(values[per_step[s]].mean()), 6) for s in steps]

    def mean_of(column: str) -> list[float]:
        values = table[column]
        return [round(float(values[per_step[s]].mean()), 3) for s in steps]

    counts = {int((step == s).sum()) for s in steps}
    check(len(counts) == 1, f"the rollout table has uneven steps: {sorted(counts)}")

    text = PREDICTIONS.read_text(encoding="utf-8")
    r4, r4_line = _predictions_row(text, "R4")
    r3, r3_line = _predictions_row(text, "R3")

    midpoint = float(_one(r"transition midpoint step ([0-9.]+)", r4, "transition midpoint"))
    width = float(_one(r"10-90 width ([0-9.]+) steps", r4, "10-90 width"))
    r2 = float(_one(r"at R2 ([0-9]+\.[0-9]+)", r4, "logistic fit R2"))

    cite = lambda line: {"document": "reward-lens-assay/PREDICTIONS.md", "line": line}

    detectors = [
        {
            "key": "variance_level",
            "label": "Within-group reward variance, level",
            "alarmStep": int(_one(r"alarms earlier still, at step ([0-9]+)", r4, "level alarm")),
            "leadWidths": float(_one(r"at step [0-9]+ for \+([0-9.]+) widths", r4, "level lead")),
            "surrogateRate": float(_one(r"fires on ([0-9.]+)% of order-destroyed", r4, "level surrogates")) / 100,
            "surrogateRateFromTrainerLog": None,
            "shipped": False,
            "comparatorLagSteps": None,
            "discardedReason": (
                "It alarms earliest and it fires on three fifths of order-destroyed in-control "
                "surrogates from the same series. A lead that fires on two thirds of surrogates "
                "is not a detection."
            ),
            "evidenceId": None,
            "source": cite(r4_line),
        },
        {
            "key": "gradient_norm_cusum",
            "label": "Gradient norm under a cumulative-sum alarm",
            "alarmStep": None,
            "leadWidths": None,
            "surrogateRate": float(_one(r"gradient norm under CUSUM at ([0-9.]+)%", r4, "cusum surrogates")) / 100,
            "surrogateRateFromTrainerLog": None,
            "shipped": False,
            "comparatorLagSteps": None,
            "discardedReason": (
                "Same failure as the variance level, worse: it fires on more than two thirds of "
                "the surrogates."
            ),
            "evidenceId": None,
            "source": cite(r4_line),
        },
        {
            "key": "variance_derivative",
            "label": "Within-group reward variance, derivative",
            "alarmStep": int(_one(r"derivative alarms at step ([0-9]+)", r4, "derivative alarm")),
            "leadWidths": float(_one(r"a lead of \*\*\+([0-9.]+) widths", r4, "derivative lead")),
            "surrogateRate": float(_one(r"derivative fires on ([0-9.]+)%", r4, "derivative surrogates")) / 100,
            "surrogateRateFromTrainerLog": float(
                _one(r"or ([0-9.]+)% using the trainer log", r4, "derivative surrogates, trainer log")
            ) / 100,
            "shipped": True,
            "comparatorLagSteps": None,
            "discardedReason": None,
            "evidenceId": None,
            "source": cite(r4_line),
        },
        {
            "key": "gradient_norm_peak",
            "label": "Gradient-norm peak, the registered comparator",
            "alarmStep": int(_one(r"gradient-norm peak arrives at step ([0-9]+)", r4, "peak step")),
            "leadWidths": -float(_one(r"a lead of -([0-9.]+) widths", r4, "peak lead")),
            "surrogateRate": None,
            "surrogateRateFromTrainerLog": None,
            "shipped": False,
            # GROUND-TRUTH.md C-42. This number existed only inside the prose
            # below, so `/see/run/` part 4 would have rendered it by computing
            # `alarmStep - transition.midpointStep`, and gate 5 fails a derived
            # number correctly: it resolves to no record. It is parsed out of
            # the same ledger row as every other detector number instead.
            "comparatorLagSteps": int(
                _one(r"which is ([0-9]+) steps after the midpoint", r4, "comparator lag")
            ),
            "discardedReason": "It lags the labelled midpoint by 27 steps.",
            "evidenceId": None,
            "source": cite(r4_line),
        },
    ]
    check(
        sum(1 for d in detectors if d["shipped"]) == 1,
        "exactly one detector may be the shipped one",
    )
    # A structural invariant, not a measurement: the ledger states the lag AND
    # states the two steps it is the difference of, so the row has to agree
    # with itself. This fails on a row that has drifted internally, which is
    # the one way a parsed lag could be right in isolation and wrong in place.
    lag = next(d for d in detectors if d["key"] == "gradient_norm_peak")
    check(
        lag["alarmStep"] - midpoint == lag["comparatorLagSteps"],
        f"the ledger row says the comparator peaks at step {lag['alarmStep']}, that the "
        f"midpoint is {midpoint}, and that the lag is {lag['comparatorLagSteps']} steps. "
        f"Those three cannot all be true.",
    )

    stated_steps = int(_one(r"seed2`, ([0-9]+) steps,", r4, "R4 step count"))
    other_steps = int(_one(r"rollouts over ([0-9]+) steps", r3, "R3 step count"))
    stated_rollouts = int(_one(r"([0-9,]+) labelled rollouts", r4, "R4 rollout count").replace(",", ""))
    check(
        stated_rollouts == int(step.size),
        f"the ledger says {stated_rollouts} rollouts and the table has {step.size}",
    )
    # DECISIONS.md D-03's default, enforced where the values are read and
    # stated as the rule rather than as the pair. Two records disagreeing is
    # the known condition and it is disclosed; a THIRD value is an escalation,
    # so the generator stops rather than picking one or averaging. No literal:
    # the two current values are in tests/regression/known-values.json, which
    # is where a change to either of them gets noticed.
    check(
        len({stated_steps, other_steps}) <= 2,
        f"three or more records now describe this run's length: "
        f"{sorted({stated_steps, other_steps})}. DECISIONS.md D-03 covers two. "
        f"Stop and ask. Do not average.",
    )

    measured.record("run_steps_observed", len(steps))
    measured.record("run_step_labels", [steps[0], steps[-1]])
    measured.record("run_rollouts", int(step.size))
    measured.record("run_rollouts_per_step", counts.pop())
    measured.record("run_step_count_stated", stated_steps)
    measured.record("run_step_count_other", other_steps)
    measured.record("run_transition", {"midpoint": midpoint, "width1090": width, "r2": r2})
    measured.record("run_detectors", len(detectors))
    measured.record("run_total_completion_characters", int(table["length"].sum()))

    return (
        {
            "meta": {
                "subject": "ai-safety-institute/reward-hacking-olmo3.1-32b-kl0.0-seed2",
                "rolloutCount": int(step.size),
                # D-03. The site states 400. It does not resolve the disagreement.
                "stepCount": min(stated_steps, other_steps),
                "rolloutsPerStep": int(np.bincount(step).max()),
                "stepCountDisagreement": {
                    "values": sorted({stated_steps, other_steps}),
                    "note": (
                        "Two rows of the same frozen ledger describe this run with different "
                        "step counts. The public rollout table carries "
                        f"{len(steps)} distinct step indices, labelled "
                        f"{steps[0]} through {steps[-1]}. The site states the lower value and "
                        "does not assert which record is right."
                    ),
                    "evidenceId": None,
                    "source": [cite(r4_line), cite(r3_line)],
                },
            },
            "steps": steps,
            "seriesNote": (
                "Every series is the per-step mean of one column of the public rollout table, "
                "over the 64 rollouts recorded at that step. hackRate and written are the same "
                "column under two names: `passed` is both the labelled outcome the transition is "
                "fitted to and the predicate as the benchmark writes it. The dataset also "
                "publishes `reward_hacked` and `actually_solved`, which would be the more direct "
                "pair; neither is in the cached table, so neither is used here."
            ),
            "series": {
                # `passed`, whose first and last steps are 0.015625 and 0.984375,
                # which is the ledger's "hack rate 0.016 to 0.984" exactly.
                "hackRate": rate("passed"),
                "written": rate("passed"),
                # `training_passed` = passed AND thinking_format_ok: what the
                # trainer actually rewarded, which is not what the task asked.
                "realized": rate("training_passed"),
                "formatOk": rate("thinking_format_ok"),
            },
            "perEpisode": {
                "note": (
                    "What the film's insert needs, per step. The public table records completion "
                    "length in CHARACTERS and carries no token count, so there is no token count "
                    "here: deriving one from characters would be a number with no measurement "
                    "behind it."
                ),
                "meanCompletionCharacters": mean_of("length"),
                "meanReasoningCharacters": mean_of("reasoning_length"),
                "totalCompletionCharacters": int(table["length"].sum()),
            },
            "detectors": detectors,
            "transition": {
                "midpoint": midpoint,
                "width1090": width,
                "r2": r2,
                "evidenceId": None,
                "source": cite(r4_line),
            },
            "companion": {
                "statement": "Lambda moves before the labelled hack rate",
                "lagWidths": -float(_one(r"lags by ([0-9.]+) transition widths", r3, "companion lag")),
                "signRobust": True,
                "magnitudeRobust": False,
                "evidenceId": None,
                "source": cite(r3_line),
            },
            "frozenAnalysisDefect": {
                "registeredValue": 3.97,
                "correctedValue": -0.93,
                "explanation": (
                    "The frozen path standardises the series against a mean the post-transition "
                    "regime raised, so the accumulator crosses a threshold defined partly by the "
                    "future. A detector that uses the future to define normal cannot measure a "
                    "lead time, and it will report one. The detector-free comparison was added "
                    "after the freeze and is labelled as not preregistered."
                ),
                "declined": True,
                "source": {"document": "reward-lens-assay/PREDICTIONS.md", "line": 136},
            },
            "provenance": {
                "generatedBy": "scripts/build_data.py",
                "sourceCommit": prov.commit,
                "generatedAt": date.today().isoformat() + "T00:00:00Z",
                "rolloutTable": "reward-lens-assay/experiments/x5_threshold/aisi_lengths.npz",
                "ledger": "reward-lens-assay/PREDICTIONS.md",
            },
        },
        AISI_ROLLOUTS,
    )


def main() -> None:
    prov = Provenance(DATA / "provenance.json")
    measured = Observations("build_data", "scripts/build_data.py")

    # ---- load sources -------------------------------------------------------
    close_summary = load_json(CAMPAIGN / "runs" / "campaign" / "close_summary.json")
    scoreboard = load_json(CAMPAIGN / "runs" / "campaign" / "scoreboard.json")
    manifest = load_json(CAMPAIGN / "specs" / "frozen" / "manifest.json")
    probabilities = load_json(CAMPAIGN / "specs" / "frozen" / "probabilities.json")
    captions = load_json(CAMPAIGN / "figures" / "captions.json")

    evidence_path = CAMPAIGN / "runs" / "campaign" / "evidence.jsonl"
    adjudications: dict[str, dict] = {}
    adjudication_lines: dict[str, str] = {}
    gpu_seconds_total = 0.0
    gpu_seconds_by_arc: dict[str, float] = {}
    n_records = 0
    with evidence_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            n_records += 1
            env = json.loads(line)
            cost = (env.get("provenance") or {}).get("cost") or {}
            gs = float(cost.get("gpu_seconds") or 0.0)
            gpu_seconds_total += gs
            extra = (env.get("provenance") or {}).get("extra") or {}
            arc = extra.get("arc") or "unknown"
            gpu_seconds_by_arc[arc] = gpu_seconds_by_arc.get(arc, 0.0) + gs
            obs = env.get("observable", "")
            if obs.startswith("campaign.adjudication."):
                card = obs.removeprefix("campaign.adjudication.")
                adjudications[card] = env
                adjudication_lines[card] = line
    measured.record("evidence_store_records", n_records)
    measured.record("adjudication_records", len(adjudications))

    # ---- specs --------------------------------------------------------------
    specs: dict[str, dict] = {}
    for card, env in adjudications.items():
        spec_name = env["subject"]["extra"]["spec"]
        spec_path = CAMPAIGN / "specs" / "frozen" / f"{spec_name}.json"
        check(spec_path.exists(), f"missing frozen spec {spec_path}")
        specs[card] = load_json(spec_path)
        specs[card]["_file"] = spec_path

    # ---- registered probabilities ------------------------------------------
    prob_by_key = {
        (d["card"], d["hypothesis"]): d["prob"] for d in probabilities["directional"]
    }
    interval_keys = {
        (d["card"], d["hypothesis"]) for d in probabilities["intervals"]
    }

    # ---- ledger.json (8.1) --------------------------------------------------
    card_order = [
        s.split("study:campaign-")[1].split("@")[0] for s in manifest["study_ids"]
    ]
    spec_to_card = {
        specs[card]["spec"]["id"].removeprefix("campaign-"): card for card in specs
    }
    ordered_cards = [spec_to_card[s] for s in card_order]
    # Structural: the study order must cover every adjudicated card exactly
    # once. True of any correct freeze, and it carries no measurement.
    check(
        sorted(ordered_cards) == sorted(adjudications),
        "the frozen study order does not cover the adjudicated cards exactly once",
    )
    measured.record("ordered_cards", len(ordered_cards))

    ledger = []
    for card in ordered_cards:
        spec = specs[card]["spec"]
        adj = unwrap(adjudications[card]["value"])
        outcomes = adj.get("outcomes") or {}
        metrics = adj.get("metrics") or {}
        killed_by = adj.get("killed_by") or []
        reason = adj.get("reason") or None
        for hyp in spec["hypotheses"]:
            hid = hyp["id"]
            pred = hyp["prediction"]
            outcome = outcomes.get(hid, "inconclusive")
            observed = metrics.get(pred["metric"])
            ledger.append(
                {
                    "card": card,
                    "slug": card.lower(),
                    "hypothesis_id": hid,
                    "statement": hyp["statement"],
                    "metric": pred["metric"],
                    "comparator": pred["comparator"],
                    "threshold": pred["threshold"],
                    "registered_prob": prob_by_key.get((card, hid)),
                    "interval_prediction": (card, hid) in interval_keys
                    or None,
                    "observed": observed if outcome != "inconclusive" else None,
                    "outcome": outcome,
                    "kill_id": killed_by[0] if killed_by else None,
                    "inconclusive_reason": reason if outcome == "inconclusive" else None,
                    "science": spec["science"],
                }
            )

    counts = {"confirmed": 0, "refuted": 0, "inconclusive": 0}
    for row in ledger:
        counts[row["outcome"]] += 1
    measured.record("ledger_rows", len(ledger))
    measured.record("ledger_outcomes", counts)
    kills = {row["kill_id"] for row in ledger if row["kill_id"]}
    measured.record("kill_ids", sorted(kills))

    # Every adjudicated headline value the ledger carries, keyed CARD/metric.
    # The generator does not choose which of these matter; known-values.json
    # names the ten the site quotes and the test compares those.
    measured.record(
        "headlines",
        {
            f"{r['card']}/{r['metric']}": r["observed"]
            for r in ledger
            if r["observed"] is not None
        },
    )

    write_json(DATA / "ledger.json", ledger)
    prov.record(evidence_path, DATA / "ledger.json")

    # ---- kill explanation sentences, verbatim from RESULTS.md ---------------
    results_md = (CAMPAIGN / "RESULTS.md").read_text(encoding="utf-8")
    kill_notes: dict[str, str] = {}
    for m in re.finditer(
        r"- Kill (K-[a-z]+) FIRED on `[^`]+`.*?\)\: (.+)$", results_md, re.M
    ):
        kill_notes[m.group(1)] = m.group(2).strip()
    # Structural: the prose in RESULTS.md must explain exactly the kills the
    # ledger fired. Derived on both sides, so it holds for any campaign.
    check(
        set(kill_notes) == kills,
        f"kill notes parsed for {sorted(kill_notes)} but the ledger fired {sorted(kills)}",
    )

    # ---- cards.json (8.2) ---------------------------------------------------
    verdicts = dict(close_summary["cards"])
    verdicts["META-LEDGER"] = close_summary["meta"]
    measured.record("card_verdicts", dict(sorted(verdicts.items())))
    by_verdict = {"confirmed": 0, "refuted": 0, "mixed": 0, "inconclusive": 0}
    for v in verdicts.values():
        by_verdict[v] += 1
    measured.record("card_verdict_distribution", by_verdict)

    power = {p["card"]: p for p in manifest["power_acceptances"]}
    figure_names = set(close_summary["figures"])

    cards = []
    for card in ordered_cards:
        spec = specs[card]["spec"]
        adj = unwrap(adjudications[card]["value"])
        outcomes = adj.get("outcomes") or {}
        metrics = adj.get("metrics") or {}
        science_raw = spec["science"]
        m = re.match(r"S0*([1-9]\d*)", science_raw or "")
        s_id = f"S{m.group(1)}" if m else None
        slug = card.lower()
        fig = f"card-{slug}"
        check(fig in figure_names, f"figure {fig} not in close_summary figures")
        hyps = []
        for hyp in spec["hypotheses"]:
            pred = hyp["prediction"]
            hyps.append(
                {
                    "id": hyp["id"],
                    "statement": hyp["statement"],
                    "metric": pred["metric"],
                    "comparator": pred["comparator"],
                    "threshold": pred["threshold"],
                    "ci_excludes": pred.get("ci_excludes"),
                    "registered_prob": prob_by_key.get((card, hyp["id"])),
                    "interval_prediction": (card, hyp["id"]) in interval_keys or None,
                    "observed": metrics.get(pred["metric"])
                    if outcomes.get(hyp["id"])
                    else None,
                    "outcome": outcomes.get(hyp["id"], "inconclusive"),
                    "scoreboard_row": hyp.get("scoreboard_row"),
                }
            )
        pa = power.get(card)
        cards.append(
            {
                "id": slug,
                "card": card,
                "title": spec["title"],
                "science": s_id,
                "science_name": SCIENCE_NAMES.get(s_id) if s_id else None,
                "science_raw": science_raw,
                "verdict": verdicts[card],
                "kill_fired": (adj.get("killed_by") or [None])[0],
                "kill_note": kill_notes.get((adj.get("killed_by") or [None])[0] or ""),
                "kill_criteria": spec.get("kill_criteria", []),
                "hypotheses": hyps,
                "adjudication_ev": adjudications[card]["id"],
                "adjudicated_at": adjudications[card]["created_at"],
                "frozen_at": specs[card]["frozen_at"],
                "spec_hash": specs[card]["spec_hash"],
                "spec_file": specs[card]["_file"].name,
                "study_id": specs[card]["study_id"],
                "figure": fig,
                "caption": captions.get(fig),
                "power_acceptance": {
                    "power": pa["power"],
                    "mde": pa["mde"],
                    "note": pa["note"],
                }
                if pa
                else None,
                "inconclusive_reason": adj.get("reason") or None
                if verdicts[card] == "inconclusive"
                else None,
                "companion_metrics": {
                    k: v
                    for k, v in metrics.items()
                    if k not in {h["metric"] for h in hyps}
                },
                "subjects": spec.get("subjects", {}),
            }
        )
    measured.record("cards", len(cards))
    measured.record("power_acceptances", len(power))
    write_json(DATA / "cards.json", cards)
    prov.record(evidence_path, DATA / "cards.json")

    # ---- theorems.json (8.3) ------------------------------------------------
    statuses = {t["id"]: t["status"] for t in scoreboard.values()}
    measured.record("theorem_statuses", dict(sorted(statuses.items())))
    measured.record(
        "theorem_status_distribution",
        {s: sum(1 for v in statuses.values() if v == s) for s in sorted(set(statuses.values()))},
    )
    theorems = []
    for t in scoreboard.values():
        card_slug = None
        for study in t.get("studies", []):
            name = study.split("study:campaign-")[1].split("@")[0]
            card_slug = spec_to_card[name].lower()
        theorems.append({**t, "card": card_slug})
    write_json(DATA / "theorems.json", theorems)
    prov.record(
        CAMPAIGN / "runs" / "campaign" / "scoreboard.json", DATA / "theorems.json"
    )

    # ---- campaign.json: totals for stat rows and the method page -----------
    largest_arcs = sorted(
        (
            (arc, secs)
            for arc, secs in gpu_seconds_by_arc.items()
            if arc not in {"reporting", "unknown"}
        ),
        key=lambda kv: -kv[1],
    )[:5]
    campaign_summary = {
        # Totals derived from the rows themselves. These were literal 53 and 27
        # typed into the generator and rendered on the site as stat rows, which
        # is the same defect as an assertion and worse, because the number
        # reaches a reader rather than a build log.
        "hypotheses": {"total": len(ledger), **counts},
        "cards": {"total": len(cards), **by_verdict},
        "kills_fired": sorted(kills),
        "spend_usd": close_summary["spend_total_usd"],
        "gpu_seconds": round(gpu_seconds_total, 1),
        "gpu_seconds_by_arc": [
            {"arc": arc, "gpu_seconds": round(secs, 1)} for arc, secs in largest_arcs
        ],
        "works_ledger": close_summary["works_ledger"],
        "merge_report": close_summary["merge_report"],
        "claims": close_summary["claims"],
        "scorecards_installed": close_summary["scorecards_installed"],
        "freeze": {
            "frozen_at": manifest["created_at"],
            "git_sha": manifest["git_sha"],
            "tag": manifest["tag"],
            "code_tree_hash": manifest["code_tree_hash"],
            "n_specs": len(manifest["spec_hashes"]),
        },
        # "19 of 27 frozen cards adjudicated against the merged evidence
        # store" (campaign-results/RESULTS.md:5). A card is inconclusive
        # exactly when it was not adjudicated this run, and RESULTS.md:263-276
        # names those eight one at a time. Derived rather than typed as 19.
        "adjudicated_cards": len(cards) - by_verdict["inconclusive"],
        "store_records": n_records,
    }
    measured.record("spend_usd", campaign_summary["spend_usd"])
    measured.record("adjudicated_cards", campaign_summary["adjudicated_cards"])
    measured.record("manifest_spec_hashes", len(manifest["spec_hashes"]))
    write_json(DATA / "campaign.json", campaign_summary)
    prov.record(
        CAMPAIGN / "runs" / "campaign" / "close_summary.json", DATA / "campaign.json"
    )

    # ---- vendored specs, manifest, probabilities ---------------------------
    for card in ordered_cards:
        src = specs[card]["_file"]
        out = DATA / "specs" / src.name
        payload = {k: v for k, v in specs[card].items() if k != "_file"}
        write_json(out, payload)
        prov.record(src, out)
    for name in ("manifest.json", "probabilities.json"):
        src = CAMPAIGN / "specs" / "frozen" / name
        out = DATA / "specs" / name
        shutil.copyfile(src, out)
        prov.record(src, out)

    # The frozen specs also ship as viewable files on the site itself.
    pub_specs = SITE / "public" / "specs"
    pub_specs.mkdir(parents=True, exist_ok=True)
    for card in ordered_cards:
        src = specs[card]["_file"]
        dst = pub_specs / src.name
        shutil.copyfile(src, dst)
        prov.record(src, dst)
    for name in ("manifest.json", "probabilities.json"):
        src = CAMPAIGN / "specs" / "frozen" / name
        dst = pub_specs / name
        shutil.copyfile(src, dst)
        prov.record(src, dst)

    # ---- walkthrough cost excerpt: the priciest single record ---------------
    best = None
    with evidence_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            env = json.loads(line)
            gs = float(
                ((env.get("provenance") or {}).get("cost") or {}).get("gpu_seconds")
                or 0.0
            )
            if best is None or gs > best[0]:
                best = (gs, env)
    check(best is not None, "the evidence store has no records, so there is nothing to excerpt")
    # The `> 0` this used to assert is the measurement, not the invariant: a
    # zero here means the store carries no metered record and the excerpt is
    # empty, which the change detector reports with the number that produced it.
    measured.record("walkthrough_max_gpu_seconds", round(best[0], 4))
    env = best[1]
    value = env.get("value")
    value_type = (
        value.get("__type__", "payload") if isinstance(value, dict) else type(value).__name__
    )
    write_json(
        DATA / "walkthrough-cost-record.json",
        {
            "id": env["id"],
            "observable": env["observable"],
            "subject": env["subject"],
            "value": f"<{value_type} elided>",
            "trust": env["trust"],
            "provenance": {
                "git_sha": env["provenance"]["git_sha"],
                "cost": env["provenance"]["cost"],
                "study": env["provenance"].get("study"),
                "extra": env["provenance"].get("extra"),
            },
            "created_at": env["created_at"],
        },
    )
    prov.record(evidence_path, DATA / "walkthrough-cost-record.json")

    # ---- claims mini-store (8.5) -------------------------------------------
    store_dir = DATA / "claims-store"
    store_dir.mkdir(parents=True, exist_ok=True)
    with (store_dir / "evidence.jsonl").open("w", encoding="utf-8") as fh:
        for card in ordered_cards:
            fh.write(adjudication_lines[card] + "\n")
    prov.record(evidence_path, store_dir / "evidence.jsonl")

    # ---- resolvable evidence: the records the site cites as receipts -------
    # Every adjudication record ships whole and gets its own page, so an
    # evidence id printed as a receipt on campaign pages resolves for a
    # visitor. Ids outside this set (payload captures) are labeled as
    # store-only where they appear.
    resolvable = {}
    for card in ordered_cards:
        env = adjudications[card]
        resolvable[env["id"]] = {
            "card": card,
            "slug": card.lower(),
            "observable": env["observable"],
        }
    write_json(DATA / "evidence-index.json", resolvable)
    prov.record(evidence_path, DATA / "evidence-index.json")

    # ---- evidence-records.json ---------------------------------------------
    # GROUND-TRUTH.md C-25: src/components/base/data.ts:181 declares a loader
    # for this file and the file does not exist, so evidenceRecords() returns
    # {} on every call. The index carries a stub (card, slug, observable); the
    # provenance panel wants what the record itself says. Emitted here so the
    # loader has something to load and a panel opened on any cited id shows the
    # value, its trust rung and the commit that produced it.
    #
    # Nothing is composed. A field the record does not carry renders no row.
    #
    # `trust` IS THE RUNG WORD, NOT THE INTEGER. The store writes the rung as an
    # integer and this file used to emit `str(...)` of it, so every
    # provenance-chip on the site would have rendered "trust 2" with no
    # `--trust-*` colour, which P6 found and worked around per page. The two
    # mappings run in opposite directions and both exist: the library's
    # `TrustLevel` is rung -> name, and `data.ts`'s `trustRung` is name ->
    # index. Components read a name, so a name is what ships, and `trustRung`
    # carries the integer beside it for anything that wants to compare rungs.
    # The mapping is read out of the library rather than typed here.
    rung_names = trust_rung_names()
    records = {}
    for card in ordered_cards:
        env = adjudications[card]
        adj = unwrap(env["value"])
        metrics = adj.get("metrics") or {}
        prov_block = env.get("provenance") or {}
        rung = env.get("trust")
        rung = int(rung) if isinstance(rung, (int, float, str)) and str(rung).isdigit() else None
        check(
            rung is None or rung in rung_names,
            f"{env['id']} carries trust rung {rung!r}, which is not one of "
            f"{sorted(rung_names)}. A rung outside the ladder has no name to render.",
        )
        records[env["id"]] = {
            "value": adj.get("verdict") or verdicts.get(card),
            "trust": rung_names.get(rung),
            "trustRung": rung,
            "subject": (env.get("subject") or {}).get("extra", {}).get("spec"),
            "source": env["observable"],
            "commit": prov_block.get("git_sha"),
            "href": f"/evidence/{env['id'].removeprefix('ev:')}/",
            "stats": {k: v for k, v in sorted(metrics.items()) if isinstance(v, (int, float))},
        }
    write_json(DATA / "evidence-records.json", records)
    prov.record(evidence_path, DATA / "evidence-records.json")
    measured.record("evidence_records", len(records))
    # GROUND-TRUTH.md C-41. Two stores carry this metric with opposite signs.
    # The site renders the shipped campaign store's value; the disagreement is
    # disclosed in known-values.json and resolved nowhere, per D-03. Recorded
    # so a change to the value the site ships fails the change detector, which
    # is the one way the disclosure could go stale without anybody noticing.
    avp = (records.get("ev:a34457e83cd4eec10d080804a2533e82") or {}).get("stats") or {}
    check(
        "real8b_avp_spearman" in avp,
        "the localization adjudication no longer carries real8b_avp_spearman, so the "
        "disagreement recorded in known-values.json describes a metric that is gone",
    )
    measured.record("real8b_avp_spearman", avp["real8b_avp_spearman"])

    # ---- decomposition.json -------------------------------------------------
    # DECISIONS.md D-37. The first subject this ran on was per-category
    # RewardBench-2 accuracy, which is five accuracies on five slices whose sum
    # has no referent, feeding a figure that asserts composition. It was
    # withdrawn. The generator was kept subject-agnostic for exactly this, and
    # the ruling pointed it at a decomposition that genuinely closes.
    write_json(DATA / "decomposition.json", build_decomposition(measured))
    prov.record(evidence_path, DATA / "decomposition.json")

    # ---- run-series.json ----------------------------------------------------
    run_series, run_source = build_run_series(measured, prov)
    write_json(DATA / "run-series.json", run_series)
    prov.record(run_source, DATA / "run-series.json")

    # ---- fleet (8.4) --------------------------------------------------------
    register_campaign_payloads()
    from reward_lens.core.store import EvidenceStore  # noqa: E402
    from reward_lens.artifacts.card import build_card  # noqa: E402

    store = EvidenceStore(CAMPAIGN / "runs" / "campaign", readonly=True)
    hf_ids = {}
    config_text = CAMPAIGN_CONFIG.read_text(encoding="utf-8")
    for m in re.finditer(
        r"Seat\(\s*\"([A-Za-z0-9._-]+)\",\s*\"([^\"]+)\"", config_text
    ):
        hf_ids[m.group(1)] = m.group(2)
    for key in FLEET:
        check(key in hf_ids, f"no HF id parsed from campaign config for {key}")

    # ---- the name the store already gave each record ------------------------
    #
    # THE SITE WAS THROWING THIS AWAY, AND IT IS THE WHOLE REPAIR TO /atlas/.
    #
    # A card entry carries `observable`, which is a store key: campaign.w_r,
    # campaign.subspace, campaign.bias.battery and eighteen siblings. Rendering
    # the key is what put 1,231 machine identifiers on ten public pages, and
    # D-40 refuses the atlas the record's allowance because a catalogue is
    # exactly where the ban does its work.
    #
    # But the store is not only holding a key. Thirteen of the twenty-one
    # payload types carry a `name` written at record time, and it is a sentence
    # a person wrote: "armorm reward direction", "skywork-v02 dla ranking
    # (rb2-patch-40)", "emb-lora step 1332 loadings". The card builder does not
    # copy it out, so it never reached src/data and the site had nothing to
    # render but the key. This reads it back, by evidence id, from the same
    # store the card came from.
    #
    # EIGHT KEYS HAVE NO NAME, and that is a fact about the store rather than a
    # gap to paper over: ScoreBank, CaptureManifest, Heartbeat, FeatureMatrix,
    # PatchGridResult, ScorecardAUCs and CheckpointManifestPayload have no
    # `name` field at all. They get `None` here and the site is required to say
    # so rather than invent one. `campaign.scores` alone is 968 of the 1,231.
    def payload_name(value: object) -> str | None:
        """The `name` a payload carries, or None. Never a fallback to the key."""
        name = getattr(value, "name", None)
        if name is None and isinstance(value, dict):
            name = value.get("name")
        if not isinstance(name, str):
            return None
        name = name.strip()
        return name or None

    fleet_index = []
    for key in FLEET:
        card_obj = json.loads(build_card(key, store).to_json())
        names_by_id = {
            ev.id: payload_name(ev.value) for ev in store.find(signal=key, latest=False)
        }
        for entry in card_obj["entries"]:
            entry["name"] = names_by_id.get(entry["evidence_id"])
        # The coverage of this lookup is detected on the site side rather than
        # here. `measured.record` would be the natural home, and it was tried:
        # it adds ten keys to tests/regression/known-values.json, which is P1's
        # file, and a merge conflict in a shared file is an ownership defect.
        # `scripts/build_atlas.mjs --check` regenerates the named and unnamed
        # counts from these files and fails on any drift, which is the same
        # tripwire in a file this packet owns.
        check(card_obj["entries"], f"fleet card for {key} has no entries")
        headline = []
        for ev in store.find(observable="campaign.index.table", signal=key, latest=False):
            # The store decodes this as `campaign.payloads.TablePayload`, which
            # is a dataclass and not a mapping. It used to arrive as a plain
            # dict only because the payload module was never imported, so the
            # codec had nothing to decode it into; registering the types (see
            # register_campaign_payloads) is what makes `.rows` real. A
            # `getattr` fallback covers the dict form so this reads a store
            # written either way rather than silently emitting empty tables.
            table = ev.value
            get = (
                (lambda field, default: table.get(field, default))
                if isinstance(table, dict)
                else (lambda field, default: getattr(table, field, default))
            )
            rows = get("rows", None) or []
            meta = get("meta", None) or {}
            headline.append(
                {
                    "name": get("name", None),
                    "meta": meta,
                    "rows": [
                        {"metric": r[0], "value": r[1]}
                        for r in rows
                        if isinstance(r, (list, tuple)) and len(r) == 2
                    ],
                    "evidence_id": ev.id,
                    "trust": ev.trust.name
                    if hasattr(ev.trust, "name")
                    else str(ev.trust),
                    "gauge": str(getattr(ev.gauge, "value", ev.gauge)),
                }
            )
        model = {
            "slug": key,
            "hf_id": hf_ids.get(key),
            "total_gpu_seconds": card_obj["total_gpu_seconds"],
            "n_entries": len(card_obj["entries"]),
            "headline": headline,
            "entries": card_obj["entries"],
        }
        write_json(DATA / "fleet" / f"{key}.json", model)
        prov.record(evidence_path, DATA / "fleet" / f"{key}.json")
        fleet_index.append(
            {
                "slug": key,
                "hf_id": hf_ids.get(key),
                "n_entries": len(card_obj["entries"]),
                "total_gpu_seconds": card_obj["total_gpu_seconds"],
                "n_headline_slices": len(headline),
            }
        )
    # This used to read `check(len(fleet_index) == 10, ...)`, which is
    # tautological: the loop above walks FLEET and appends once per entry, so
    # the assertion could only ever fail by editing the list six lines up. It
    # is recorded instead, where an edit to FLEET is exactly what it detects.
    measured.record("fleet_models", len(fleet_index))
    write_json(DATA / "fleet" / "index.json", fleet_index)
    prov.record(evidence_path, DATA / "fleet" / "index.json")

    # ---- works ledger -------------------------------------------------------
    wl_path = FINAL / "WORKS_LEDGER.md"
    wl_rows = []
    for line in wl_path.read_text(encoding="utf-8").splitlines():
        if not line.startswith("|") or line.startswith("|---") or line.startswith("| feature"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) != 8:
            continue
        wl_rows.append(
            {
                "feature": cells[0],
                "subsystem": cells[1],
                "exercised_by": cells[2],
                "substrate": cells[3],
                "hardware": cells[4],
                "status": cells[5],
                "evidence_id": cells[6] if cells[6] != "-" else None,
                "note": cells[7] or None,
            }
        )
    # The file carries three tables: the feature rows, the gate firings, and
    # the v1 failure-class regression rows (the method page's sharpest table).
    features = [r for r in wl_rows if r["subsystem"] not in ("gate", "v1 regression")]
    gates = [r for r in wl_rows if r["subsystem"] == "gate"]
    failure_classes = [r for r in wl_rows if r["subsystem"] == "v1 regression"]
    measured.record("works_ledger_features", len(features))
    measured.record("works_ledger_gate_firings", len(gates))
    measured.record("works_ledger_failure_classes", len(failure_classes))
    wl_counts: dict[str, int] = {}
    for r in features:
        key = "PASS" if r["status"] in ("PASS", "PASS-DEGRADED") else r["status"]
        wl_counts[key] = wl_counts.get(key, 0) + 1
    measured.record("works_ledger_status_counts", dict(sorted(wl_counts.items())))
    write_json(
        DATA / "works-ledger.json",
        {"features": features, "gate_firings": gates, "failure_classes": failure_classes},
    )
    prov.record(wl_path, DATA / "works-ledger.json")

    # ---- captions -----------------------------------------------------------
    write_json(DATA / "captions.json", captions)
    prov.record(CAMPAIGN / "figures" / "captions.json", DATA / "captions.json")

    # ---- figures: lossless copy + optipng ----------------------------------
    fig_out = PUB_FIG / "campaign"
    fig_out.mkdir(parents=True, exist_ok=True)
    pngs = sorted((CAMPAIGN / "figures").glob("*.png"))
    measured.record("campaign_pngs", len(pngs))
    for src in pngs:
        dst = fig_out / src.name
        if not dst.exists() or sha_changed(prov, src, dst):
            shutil.copyfile(src, dst)
            subprocess.run(
                ["optipng", "-quiet", "-o2", str(dst)],
                check=True,
            )
        prov.record(src, dst)

    docs_figs = (
        FINAL
        / "reward-lens--github"
        / "reward-lens-clean"
        / "docs"
        / "content"
        / "assets"
        / "figures"
    )
    svg_out = PUB_FIG / "docs"
    svg_out.mkdir(parents=True, exist_ok=True)
    svgs = sorted(docs_figs.glob("*.svg"))
    measured.record("docs_svgs", len(svgs))
    for src in svgs:
        dst = svg_out / src.name
        shutil.copyfile(src, dst)
        prov.record(src, dst)

    measured.record("gpu_seconds_total", round(gpu_seconds_total, 1))
    prov.write()

    measured.write()
    print("build_data: structural invariants held")
    print(f"  ledger: {len(ledger)} rows ({counts})")
    print(f"  cards: {len(cards)} ({by_verdict}); kills: {sorted(kills)}")
    print(f"  gpu_seconds total: {gpu_seconds_total:.1f}")
    print(f"  largest arcs by gpu-seconds: {largest_arcs[:3]}")
    print(f"  fleet: {len(fleet_index)} models")
    print(f"  figures: {len(pngs)} campaign PNGs, {len(svgs)} docs SVGs")
    print(f"  {len(measured.values)} measurements recorded to {measured.path()}")
    print("  compare them: node --test tests/regression/known-values.test.mjs")


def sha_changed(prov: Provenance, src: Path, dst: Path) -> bool:
    rel = str(dst.relative_to(SITE))
    prior = prov.prior.get(rel)
    return not prior or prior["sha256"] != sha256(src)


if __name__ == "__main__":
    require_library()
    main()
