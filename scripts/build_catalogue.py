#!/usr/bin/env python
"""Read the live reward_lens 3.0.0 registry and emit the catalogue data the site renders.

    /home/suhail-nadaf/final-reward/.venv-assay/bin/python scripts/build_catalogue.py

Outputs, all under src/data/:

    catalogue.json      the instruments, by series, with the ladder and the envelope
    quantities.json     the quantity registry, with each one's estimator ladder
    refusals.json       the seventeen refusal reasons, and the three-way remedy sort
    open-targets.json   the registered quantities nobody has built an estimator for
    banned-terms.json   every internal identifier, for the terminology gate

THIS IMPORTS THE LIBRARY. It does not read a vendored copy and it does not
transcribe a document. `docs/gen_catalogue.py` in the assay tree is the same
idea for the library's own documentation, and this calls the same functions it
calls: `read_registry()` for the snapshot and `_would_close()` for the roadmap
line. Sharing the reader rather than reimplementing it is the point: a page
cannot say the catalogue holds 89 instruments while the catalogue holds 95.

IF THE LIBRARY WILL NOT IMPORT, THE BUILD FAILS. That is the property the
MkDocs build already has and it is the one that matters. A site that falls back
to a committed copy of the catalogue is a site that can describe a library
nobody can install.

TWO VENVS, AND THE WRONG ONE IS A REAL TRAP (HANDOFF.md §2):

    .venv-assay   reward_lens 3.0.0, editable, pointing at the assay working
                  tree, whose live branch is `assay` and not `main`. Use this.
    .venv         reward_lens 2.0.0. Gives a v2 catalogue that looks fine.

This script refuses to run under anything below 3.0.0 rather than emitting a
plausible wrong answer.

No count in this file is asserted. Everything measured is recorded to
tests/regression/observed/build_catalogue.json and compared afterwards against
tests/regression/known-values.json. DECISIONS.md D-08.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
FINAL = Path("/home/suhail-nadaf/final-reward")
ASSAY = FINAL / "reward-lens--github" / "reward-lens-assay"
CAMPAIGN_SRC = FINAL / "reward-lens--github" / "reward-lens-campaign"
CAMPAIGN_RESULTS = FINAL / "campaign-results"
DATA = SITE / "src" / "data"

# The library's own catalogue reader. Same file the MkDocs build runs.
sys.path.insert(0, str(ASSAY / "docs"))
# The change detector's recording half. See tests/regression/observe.py.
sys.path.insert(0, str(SITE / "tests" / "regression"))
from observe import Observations  # noqa: E402

# Local-path redaction, applied in write_json. See scripts/pubpath.py.
sys.path.insert(0, str(SITE / "scripts"))
from pubpath import redact  # noqa: E402

MIN_VERSION = (3, 0, 0)


def die(message: str) -> None:
    print(f"build_catalogue: {message}", file=sys.stderr)
    sys.exit(1)


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # provenance.librarySource and provenance.quantitySource are absolute paths
    # on this machine. scripts/pubpath.py turns them into their public form.
    obj = redact(obj, where=path.name)
    path.write_text(json.dumps(obj, indent=1, sort_keys=False) + "\n", encoding="utf-8")


def require_library():
    """Import the library, or fail the build saying exactly which one it found."""
    try:
        import reward_lens
    except Exception as exc:  # noqa: BLE001 - the message is the whole point
        die(
            f"cannot import reward_lens ({type(exc).__name__}: {exc}).\n"
            f"  The catalogue, the quantity registry and the refusal reference are rendered "
            f"from the code rather than transcribed, so this build has nothing to render and "
            f"there is no fallback.\n"
            f"  Run it with the assay venv:\n"
            f"    /home/suhail-nadaf/final-reward/.venv-assay/bin/python scripts/build_catalogue.py"
        )
    version = getattr(reward_lens, "__version__", "0")
    parts = tuple(int(n) for n in re.findall(r"\d+", version)[:3])
    if parts < MIN_VERSION:
        die(
            f"reward_lens {version} is importable and it is not the library this site "
            f"describes.\n"
            f"  Found: {reward_lens.__file__}\n"
            f"  The 2.x catalogue would render without complaint and be wrong in every count. "
            f"Use /home/suhail-nadaf/final-reward/.venv-assay/bin/python."
        )
    return reward_lens, version


# ---------------------------------------------------------------------------
# The catalogue and the quantity registry
# ---------------------------------------------------------------------------

_OPEN = ("OPEN", "open", "", None)


def text(value) -> str | None:
    """A prose field, with the catalogue's bare ``OPEN`` rendered as the absence it is."""
    if value in _OPEN:
        return None
    return " ".join(str(value).split())


def as_list(value) -> list[str]:
    """A list field. SPEC-ERRATA E14: six instruments store `quantities` as the bare
    string ``OPEN``, and iterating that yields four single characters that resolve to
    nothing. The library's own loader normalises this and so does this."""
    if value is None or isinstance(value, str):
        return []
    if isinstance(value, dict):
        return [str(k) for k in value]
    return [str(v) for v in value]


def build_catalogue(gen, view) -> dict:
    instruments = []
    for inst in sorted(view.instruments, key=lambda i: (i.id[0], int(re.sub(r"\D", "", i.id) or 0))):
        row = view.rows[inst.id]
        ladder_rows = row.get("ladder") if isinstance(row.get("ladder"), list) else []
        instruments.append(
            {
                "id": inst.id,
                "series": inst.id[0],
                "name": inst.name,
                "headline": text(row.get("headline")),
                "quantities": list(inst.quantities),
                "headlineQuantity": inst.headline_quantity or None,
                "accessMin": text(row.get("access_min")),
                "substrates": sorted(s.name for s in inst.substrates),
                "phases": [p.name for p in sorted(inst.phases, key=list(type(next(iter(inst.phases)))).index)]
                if inst.phases
                else [],
                "invarianceGroup": text(row.get("invariance_group")),
                "wedge": bool(inst.wedge),
                "status": text(inst.status),
                "workPackage": inst.work_package or None,
                "envelope": {
                    "requires": as_list(row.get("envelope_requires")),
                    "measuredBy": row.get("envelope_measured_by")
                    if isinstance(row.get("envelope_measured_by"), dict)
                    else {},
                    "unconditionalJustification": text(
                        row.get("envelope_unconditional_justification")
                    ),
                },
                "ladder": [
                    {
                        "rung": int(r.get("rung", 0)),
                        "estimator": text(r.get("estimator")),
                        "access": text(r.get("access")),
                        "bias": text(r.get("bias")),
                        "cost": text(r.get("cost")),
                    }
                    for r in ladder_rows
                ],
                "baselines": as_list(row.get("baselines")),
                "killCondition": text(row.get("kill_condition")),
                "says": text(row.get("says")),
                "priorArt": as_list(row.get("prior_art")),
            }
        )

    series = [
        {
            "letter": letter,
            "title": title,
            "instruments": [i["id"] for i in instruments if i["series"] == letter],
        }
        for letter, title in gen.SERIES.items()
    ]
    return {
        "counts": {
            "instruments": len(instruments),
            "wedge": sum(1 for i in instruments if i["wedge"]),
            "series": len(series),
            "scheduled": sum(1 for i in instruments if i["workPackage"]),
        },
        "series": series,
        "instruments": instruments,
        "provenance": provenance(view),
    }


def build_quantities(view) -> dict:
    quantities = []
    for qid, q in sorted(view.quantities.items()):
        rungs = view.ladders.get(qid) or []
        quantities.append(
            {
                "id": qid,
                "definition": text(q.definition),
                "unit": text(q.unit),
                "support": text(q.support),
                "invariance": text(getattr(q.invariance, "name", q.invariance)),
                "interpretation": text(q.interpretation),
                "wedge": bool(q.wedge),
                # `EstimatorEntry.impl` is the estimator's registered id and it
                # is the stable name. The fallback used to be `str(e)`, the
                # dataclass repr, which is TWO defects at once: it carries
                # `frozenset` fields whose repr order is hash-randomised, so
                # the emitted file differed between two runs over an unchanged
                # registry, and it spells internal enums (`<Component.RECORD:
                # 8>`) into src/data/. A derived artifact that does not
                # reproduce is not derived from anything a reader can check.
                "estimators": [
                    {
                        "name": text(getattr(e, "impl", None)) or repr(type(e).__name__),
                        "access": text(getattr(getattr(e, "access", None), "name", None)),
                    }
                    for e in rungs
                ],
                "open": qid in set(view.open_quantities),
            }
        )
    return {
        "counts": {
            "quantities": len(quantities),
            "wedge": sum(1 for q in quantities if q["wedge"]),
            "open": sum(1 for q in quantities if q["open"]),
            "estimators": view.n_estimators,
        },
        "quantities": quantities,
        "provenance": provenance(view),
    }


def build_open_targets(gen, view) -> dict:
    """Section 4.2: a quantity with no estimator is an open research target, and the
    library's docs build names it as one rather than treating it as a bug. The site
    publishes the same list, for the same reason."""
    targets = []
    for qid in sorted(view.open_quantities):
        owners = [i for i in view.instruments if qid in i.quantities]
        targets.append(
            {
                "quantity": qid,
                "wouldClose": gen._would_close(view, qid),
                "instrument": owners[0].id if owners else None,
                "instrumentName": owners[0].name if owners else None,
                "workPackage": (owners[0].work_package or None) if owners else None,
                "claimed": bool(owners),
            }
        )
    return {
        "counts": {
            "open": len(targets),
            "claimedByAnInstrument": sum(1 for t in targets if t["claimed"]),
            "unclaimed": sum(1 for t in targets if not t["claimed"]),
        },
        "targets": targets,
        "provenance": provenance(view),
    }


def build_refusals(gen, view) -> dict:
    """The seventeen reasons, from the enum and from REASON_MEANING, plus the
    library's own three-way sort.

    D-09: the remedy mapping exists for three of seventeen and nowhere else. There is
    no code structure assigning a group to the other fourteen, so this emits three and
    the page renders a callout rather than inventing a taxonomy the library does not
    hold. `remedy` is null on the other fourteen and that is the honest value."""
    from reward_lens.core.reading import REASON_MEANING, RefusalReason
    from reward_lens.core.types import TrustLevel

    declared = {r.name for r in RefusalReason}
    documented = set(gen.WHAT_TO_DO)
    if declared != documented:
        die(
            f"RefusalReason and the library's own remedy table disagree: "
            f"{sorted(declared ^ documented)}. A refusal without a remedy is a tool that "
            f"looks broken instead of a tool that looks honest."
        )

    # The three the library sorts, quoted from docs/gen_catalogue.py's own table.
    REMEDY = {
        "ACCESS_INSUFFICIENT": {
            "remedy": "get more access, or drop a rung and accept its stated bias",
            "answerable": "here",
            "answerableLabel": "where you are standing",
        },
        "RECORD_INCOMPLETE": {
            "remedy": "write the field and run again",
            "answerable": "upstream",
            "answerableLabel": "upstream, where the record was produced",
        },
        "QUANTITY_UNDEFINED": {
            "remedy": "ask the question that does apply",
            "answerable": "nowhere",
            "answerableLabel": "nowhere",
        },
    }

    reasons = [
        {
            "name": r.name,
            "meaning": " ".join(REASON_MEANING[r].split()),
            "whatToDo": " ".join(gen.WHAT_TO_DO[r.name].split()),
            "remedy": REMEDY.get(r.name),
        }
        for r in RefusalReason
    ]
    return {
        "counts": {
            "reasons": len(reasons),
            "sorted": sum(1 for r in reasons if r["remedy"]),
            "unsorted": sum(1 for r in reasons if not r["remedy"]),
        },
        "reasons": reasons,
        "remedySort": {
            "question": "where is the remedy answerable?",
            "note": (
                "The mapping exists for three reasons and for no others. The library assigns no "
                "group to the other fourteen, so neither does this file."
            ),
            "locations": ["here", "upstream", "nowhere"],
        },
        "trustLadder": [
            {"rung": level.value, "name": level.name.lower()} for level in TrustLevel
        ],
        "provenance": provenance(view),
    }


def provenance(view) -> dict:
    import reward_lens

    return {
        "generatedBy": "scripts/build_catalogue.py",
        "libraryVersion": reward_lens.__version__,
        "librarySource": str(Path(reward_lens.__file__).resolve().parent),
        "quantitySource": str(view.source),
        "skippedModules": [name for name, _ in view.skipped_modules],
    }


# ---------------------------------------------------------------------------
# The banned terms
# ---------------------------------------------------------------------------

#: One entry per family: where the identifiers live and how to recognise one.
#: DECISIONS.md D-05: this file is built by reading the registries, never by hand,
#: because a hand-kept ban list goes stale on the first identifier somebody adds.
BANNED_SOURCES = [
    # No instrument entry here: a regex over CATALOGUE.json matches every `E23`
    # and `K7` its own prose cites, which are errata and ladder rungs wearing an
    # instrument's shape. The loader's ids are the authority and they are added
    # below.
    ("work package", [ASSAY / "BUILD_STATE.md"], r"\bW[0-9]+\.[0-9]+\b"),
    ("experiment", [ASSAY / "BUILD_STATE.md"], r"\bX[0-9]{1,2}\b"),
    ("errata", [ASSAY / "SPEC-ERRATA.md"], r"\bE[0-9]{1,2}\b"),
    ("prediction", [ASSAY / "PREDICTIONS.md"], r"\b[PR][0-9]{1,2}\b"),
    ("science", [ASSAY / "src" / "reward_lens" / "studies" / "scoreboard.py"], r"\bS[0-9]{1,2}\b"),
    ("theorem", [ASSAY / "src" / "reward_lens" / "studies" / "scoreboard.py"], r"\bT[0-9]{1,2}\b"),
]


def build_banned_terms(view) -> dict:
    """Every internal identifier, parsed from the registries that define them.

    HANDOFF.md §8 rule 3: an internal identifier in user-facing text is a rejection.
    P2 consumes this; this generates it. The gate that reads this file must exempt
    the file itself, and `/log/` and `/evidence/` where a frozen record's own id is
    the content rather than jargon."""
    families: dict[str, set[str]] = {}

    def add(family: str, terms) -> None:
        families.setdefault(family, set()).update(terms)

    for family, paths, pattern in BANNED_SOURCES:
        found: set[str] = set()
        for path in paths:
            if not path.exists():
                die(f"{path} does not exist, so the {family} identifiers cannot be read")
            found |= set(re.findall(pattern, path.read_text(encoding="utf-8")))
        add(family, found)

    # Instrument ids come from the loader as well as the file, so a catalogue entry
    # the regex misses is still banned.
    add("instrument", (i.id for i in view.instruments))

    # TWO FAMILIES THIS USED TO ADD AND MUST NOT, and the reason is that they
    # are public vocabulary rather than jargon.
    #
    #   quantity ids     all 190. /atlas/ IS a catalogue of quantities, so a
    #                    gate banning them bans the route.
    #   refusal reasons  all 17. /docs/refusals/ IS the page about those
    #                    seventeen, and /start/ cannot render a real refusal
    #                    card without two of them.
    #
    # Neither family is in DECISIONS.md D-05's table (lines 109 to 124), which
    # is the list this file is supposed to be a mechanical reading of. They
    # were added here on the argument that a dotted address is an internal
    # address, which is true of where the name POINTS and not of the name: the
    # site prints `ABOVE_LOD_BELOW_LOQ` on a refusal card on purpose, because
    # that string is what a reader greps for. D-05's own replacement table
    # keeps the four trust levels verbatim for the same reason.
    #
    # Reported rather than silently widened in the other direction too: D-05
    # names three further families this generator does not read, because they
    # are literal lists rather than registries (phase, wave and tier labels;
    # agent role names; internal document filenames). Adding them would be
    # typing a ban list, which is the thing D-05 forbids.

    # The campaign's own registries: hypotheses, kill criteria and card ids. The
    # frozen specs are the authority, because a card that ran is in them whether or
    # not registry.py still names it.
    hyp: set[str] = set()
    kill: set[str] = set()
    cards: set[str] = set()
    spec_dir = CAMPAIGN_RESULTS / "specs" / "frozen"
    registry = CAMPAIGN_SRC / "campaign" / "registry.py"
    if not spec_dir.is_dir():
        die(f"{spec_dir} does not exist, so the campaign identifiers cannot be read")
    for path in sorted(spec_dir.glob("*.json")):
        blob = json.loads(path.read_text(encoding="utf-8"))
        spec = blob.get("spec")
        # The directory also holds manifest.json and probabilities.json, which
        # are the freeze itself rather than a frozen card.
        if not isinstance(spec, dict) or "id" not in spec:
            continue
        cards.add(str(spec["id"]).removeprefix("campaign-").upper())
        for h in spec.get("hypotheses", []):
            hyp.add(h["id"])
        kill |= {str(k.get("id", k)) for k in spec.get("kill_criteria", []) if isinstance(k, dict)}
    if registry.exists():
        text_ = registry.read_text(encoding="utf-8")
        hyp |= set(re.findall(r"\bH-[A-Za-z0-9_]+\b", text_))
        kill |= set(re.findall(r"\bK-[A-Za-z0-9_]+\b", text_))
    add("hypothesis", hyp)
    add("kill criterion", kill)
    add("campaign card", cards)

    # Science ids in both the bare and the slugged form the study directories use.
    sciences: set[str] = set()
    studies = ASSAY / "studies"
    if not studies.is_dir():
        die(f"{studies} does not exist, so the science identifiers cannot be read")
    for entry in studies.iterdir():
        if entry.is_dir() and re.match(r"^s\d\d_", entry.name):
            sciences.add(entry.name)
            sciences.add(f"S{int(entry.name[1:3])}")
            sciences.add(entry.name[:3].upper())
    add("science", sciences)

    # The project's own names for itself and its build phases. These are not in any
    # registry: they are in the file names, and they are exactly the words that leak.
    add(
        "project codename",
        {"ASSAY", "CALIPER", "BUILD_STATE", "SPEC-ERRATA", "WORKS_LEDGER", "SCOREBOARD"},
    )

    terms = sorted({t for members in families.values() for t in members})
    return {
        "note": (
            "Every internal identifier this project uses, parsed from the registries that "
            "define them. An identifier in user-facing text is a build failure "
            "(HANDOFF.md rule 3). Public replacements are in DECISIONS.md D-05. This file is "
            "generated; editing it by hand puts it one commit behind the next identifier."
        ),
        "counts": {
            "total": len(terms),
            "byFamily": {k: len(v) for k, v in sorted(families.items())},
        },
        "families": {k: sorted(v) for k, v in sorted(families.items())},
        "terms": terms,
    }


def main() -> None:
    library, version = require_library()
    import gen_catalogue as gen

    try:
        view = gen.read_registry()
    except gen.LintFailure as exc:
        die(f"the registry will not read:\n{exc}")

    measured = Observations("build_catalogue", "scripts/build_catalogue.py")
    measured.record("library_version", version)

    catalogue = build_catalogue(gen, view)
    quantities = build_quantities(view)
    open_targets = build_open_targets(gen, view)
    refusals = build_refusals(gen, view)
    banned = build_banned_terms(view)

    write_json(DATA / "catalogue.json", catalogue)
    write_json(DATA / "quantities.json", quantities)
    write_json(DATA / "open-targets.json", open_targets)
    write_json(DATA / "refusals.json", refusals)
    write_json(DATA / "banned-terms.json", banned)

    measured.record("instruments", catalogue["counts"]["instruments"])
    measured.record("wedge_instruments", catalogue["counts"]["wedge"])
    measured.record("series", catalogue["counts"]["series"])
    measured.record("quantities", quantities["counts"]["quantities"])
    measured.record("wedge_quantities", quantities["counts"]["wedge"])
    measured.record("open_quantities", quantities["counts"]["open"])
    measured.record("estimators", quantities["counts"]["estimators"])
    measured.record("refusal_reasons", refusals["counts"]["reasons"])
    measured.record("refusal_reason_names", [r["name"] for r in refusals["reasons"]])
    measured.record("refusal_reasons_sorted_by_remedy", refusals["counts"]["sorted"])
    measured.record("trust_levels", len(refusals["trustLadder"]))
    measured.record("banned_terms", banned["counts"]["total"])
    measured.record("banned_terms_by_family", banned["counts"]["byFamily"])
    measured.write()

    print(f"build_catalogue: reward_lens {version} at {Path(library.__file__).parent}")
    print(f"  catalogue.json    {catalogue['counts']['instruments']} instruments in "
          f"{catalogue['counts']['series']} series, {catalogue['counts']['wedge']} wedge")
    print(f"  quantities.json   {quantities['counts']['quantities']} quantities, "
          f"{quantities['counts']['estimators']} registered estimators")
    print(f"  open-targets.json {open_targets['counts']['open']} open, "
          f"{open_targets['counts']['unclaimed']} claimed by no instrument")
    print(f"  refusals.json     {refusals['counts']['reasons']} reasons, "
          f"{refusals['counts']['sorted']} sorted by where the remedy is answerable")
    print(f"  banned-terms.json {banned['counts']['total']} terms: "
          f"{banned['counts']['byFamily']}")
    if view.skipped_modules:
        print(f"  {len(view.skipped_modules)} module(s) skipped for a missing optional extra:")
        for name, detail in view.skipped_modules:
            print(f"    {name}  ({detail})")
        print("    Their quantities read as open. That is a property of this environment, "
              "not of the library.")
    print(f"  {len(measured.values)} measurements recorded to {measured.path()}")


if __name__ == "__main__":
    main()
