#!/usr/bin/env python
"""Act three's four grader cards, in both access states, from the release bundle.

    python scripts/build_grader_cards.py     ->  src/data/grader-cards.json

NOT `cards.json`. That file is the 27-row campaign ledger and has nothing to do
with graders. `pages/see-grader.md:48` cites "`data/cards.json` and the four
grader cards" and the second half of that sentence had no file behind it. This
is the second half.

WHAT A GRADER CARD IS. Thirteen fields about one scoring program, each either a
reading or a refusal carrying its reason, the input that was missing, and a
remedy naming what somebody would have to record to fill it.
`components/grader-card.md` renders refusals as the substantial rows and
readings as single lines, in library order, because a refused field carries
strictly more information than a read one.

THREE SOURCES, JOINED, AND ANY DISAGREEMENT FAILS THE BUILD.

    experiments/x1_release/cards/*.txt        eight rendered cards. The FIELD
                                              ORDER and the per-field body live
                                              only here; the structured records
                                              carry read and refused as two
                                              separate lists, which loses the
                                              interleaving the component needs.
    experiments/x1_release/refusals/*.json    reason, detail, remedy, bound and
                                              the instrument, structured, for
                                              the full-access refusals.
    experiments/x1_release/evidence/*.jsonl   the `x1.card.<key>` and
                                              `x1.bare_excepts.<key>` records:
                                              counts, mutation score, the
                                              handler census, the evidence id.

Parsing a rendered artifact is the weaker half of that, so it is checked rather
than trusted: the parsed read and refused sets must equal the record's own, the
parsed reason for every full-access refusal must equal the structured one, and
the parsed remedy must be the structured one. A mismatch means the bundle and
its record have drifted apart, which is worth failing on.

THE LOG-ONLY STATE IS NOT UNIFORM, AND THE SPECIFICATION SAYS IT IS.
`components/grader-card.md:79` and its acceptance criterion 2 say log-only
access yields "zero readings, thirteen refusals" ON EVERY CARD. The bundle says
otherwise on two of four:

    is_equiv         0 read, 13 refused
    swebench         0 read, 13 refused
    verl_gsm8k       1 read, 12 refused
    verl_search_r1   1 read, 12 refused

Verified twice, in the rendered cards' own summary lines and in the
`log_only_read` field of each `x1.card.*` record. The surviving field on both
is `exploit-family accounting`, which is the one thing countable from a log
alone. The repository wins (HANDOFF.md §9), so this emits what the bundle
contains, records the counts in the change detector, and the contradiction is
reported rather than smoothed.

No count in this file is asserted. Everything measured is recorded to
tests/regression/observed/build_grader_cards.json and compared afterwards
against tests/regression/known-values.json. DECISIONS.md D-08.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
FINAL = Path("/home/suhail-nadaf/final-reward")
ASSAY = FINAL / "reward-lens--github" / "reward-lens-assay"
RELEASE = ASSAY / "experiments" / "x1_release"
DATA = SITE / "src" / "data"

#: The rendered card indents a field name to column 2 and its body to column
#: 29, and wraps nothing: every continuation line is one complete logical line.
BODY_COLUMN = 29
#: The metadata block above the summary line uses a narrower key column than
#: the field rows do. Reading it at BODY_COLUMN silently produces a key with
#: half the value glued to it, which parses without error and yields nothing.
METADATA_COLUMN = 17

sys.path.insert(0, str(SITE / "tests" / "regression"))
from observe import Observations  # noqa: E402

# Local-path redaction, applied before the payload is written. scripts/pubpath.py.
sys.path.insert(0, str(SITE / "scripts"))
from pubpath import redact  # noqa: E402


def fail(message: str) -> None:
    print(f"build_grader_cards: {message}", file=sys.stderr)
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


def unwrap(value):
    """Unwrap the store's __map__/__seq__ payload encoding."""
    if isinstance(value, dict):
        if "__map__" in value:
            return {k: unwrap(v) for k, v in value["__map__"].items()}
        if "__seq__" in value:
            return [unwrap(v) for v in value["__seq__"]]
        return {k: unwrap(v) for k, v in value.items()}
    if isinstance(value, list):
        return [unwrap(v) for v in value]
    return value


def parse_card(path: Path) -> dict:
    """One rendered card: its header, its summary counts and its thirteen fields.

    The field order is the reason this parse exists at all. The structured
    record carries `read_fields` and `refused_fields` as two lists, and the
    component renders them interleaved in the order the library returned them,
    because sorting readings above refusals is what inverts the act.
    """
    lines = path.read_text(encoding="utf-8").splitlines()

    header: dict[str, list[str]] = {}
    for line in lines:
        if not line.startswith("#"):
            break
        stripped = line[1:].strip()
        if not stripped:
            continue
        key, _, value = stripped.partition("  ")
        header.setdefault(key.strip(), []).append(value.strip())

    title = next((line for line in lines if line.startswith("GRADER CARD")), None)
    check(title is not None, f"{path.name} has no GRADER CARD line")
    display = title.removeprefix("GRADER CARD").strip()

    meta: dict[str, str] = {}
    summary_index = None
    for index, line in enumerate(lines):
        if re.match(r"^  (\d+) of (\d+) fields read and (\d+) refused\.", line):
            summary_index = index
            break
        if line.startswith("  ") and len(line) > 2 and line[2] != " " and index > 8:
            key = line[2:METADATA_COLUMN].rstrip()
            body = line[METADATA_COLUMN:].strip() if len(line) > METADATA_COLUMN else ""
            if key and body:
                meta.setdefault(key, body)
    check(summary_index is not None, f"{path.name} has no 'N of M fields read' line")

    counts = re.match(r"^  (\d+) of (\d+) fields read and (\d+) refused\.\s*(.*)$", lines[summary_index])
    read_count, field_count, refused_count = (int(counts.group(n)) for n in (1, 2, 3))
    summary_sentence = counts.group(4).strip()

    fields = []
    current = None
    for line in lines[summary_index + 1 :]:
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip(" "))
        if indent == 2:
            name = line[2:BODY_COLUMN].rstrip()
            if not name:
                continue
            if name.startswith(str(read_count)) or " field(s) withheld" in line:
                break
            current = {"name": name, "head": line[BODY_COLUMN:].strip(), "body": []}
            fields.append(current)
        elif indent >= BODY_COLUMN and current is not None:
            current["body"].append(line.strip())

    parsed = []
    for field in fields:
        head = field["head"]
        if head.startswith("REFUSED"):
            reason = head.removeprefix("REFUSED").strip()
            check(reason, f"{path.name}: {field['name']} is refused with no reason")
            bound = None
            remedy = None
            detail = []
            for line in field["body"]:
                if line.startswith("Remedy: "):
                    remedy = line.removeprefix("Remedy: ").strip()
                elif line.startswith("Bound: "):
                    bound = float(line.removeprefix("Bound: ").strip())
                else:
                    detail.append(line)
            check(
                bool(remedy and remedy.strip()),
                f"{path.name}: {field['name']} refuses with an empty remedy. A refusal without a "
                f"remedy is not a refusal, and the component fails the build on it.",
            )
            parsed.append(
                {
                    "name": field["name"],
                    "state": "refused",
                    "reason": reason,
                    "detail": " ".join(detail) or None,
                    "remedy": remedy,
                    "bound": bound,
                    "headline": None,
                    "trust": None,
                    "supporting": [],
                }
            )
        else:
            trust = None
            headline = head
            trailing = re.search(r"\s*\[([a-z ]+)\]$", head)
            if trailing:
                trust = trailing.group(1)
                headline = head[: trailing.start()].strip()
            parsed.append(
                {
                    "name": field["name"],
                    "state": "read",
                    "reason": None,
                    "detail": None,
                    "remedy": None,
                    "bound": None,
                    "headline": headline,
                    "trust": trust,
                    "supporting": field["body"],
                }
            )

    check(
        len(parsed) == field_count,
        f"{path.name} says {field_count} fields and {len(parsed)} parsed",
    )
    check(
        sum(1 for f in parsed if f["state"] == "read") == read_count
        and sum(1 for f in parsed if f["state"] == "refused") == refused_count,
        f"{path.name}: the parsed states do not match its own summary line",
    )
    return {
        "header": header,
        "display": display,
        "meta": meta,
        "readCount": read_count,
        "fieldCount": field_count,
        "refusedCount": refused_count,
        "summarySentence": summary_sentence,
        "fields": parsed,
    }


def number(pattern: str, text: str, what: str, cast=int):
    found = re.findall(pattern, text or "")
    check(len(found) == 1, f"{what}: {len(found)} matches, expected exactly 1, in {text!r}")
    return cast(found[0].replace(",", ""))


def build(measured: Observations) -> dict:
    records = [
        json.loads(line)
        for line in (RELEASE / "evidence" / "evidence.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    by_observable = {record["observable"]: record for record in records}
    keys = sorted(
        obs.removeprefix("x1.card.") for obs in by_observable if obs.startswith("x1.card.")
    )
    check(keys, "the release bundle carries no x1.card.* record")
    measured.record("subjects", keys)

    sources = []
    cards = []
    field_orders = set()
    for key in keys:
        full = parse_card(RELEASE / "cards" / f"{key}.txt")
        log_only = parse_card(RELEASE / "cards" / f"{key}-log-only.txt")
        record = by_observable[f"x1.card.{key}"]
        summary = unwrap(record["value"])
        handlers_record = by_observable[f"x1.bare_excepts.{key}"]
        handlers = unwrap(handlers_record["value"])
        structured = json.loads((RELEASE / "refusals" / f"{key}.json").read_text(encoding="utf-8"))

        for path in (
            RELEASE / "cards" / f"{key}.txt",
            RELEASE / "cards" / f"{key}-log-only.txt",
            RELEASE / "refusals" / f"{key}.json",
        ):
            sources.append({"document": str(path.relative_to(FINAL)), "sha256": sha256(path)})

        # ---- the three sources have to agree --------------------------------
        check(
            full["fieldCount"] == summary["n_fields"],
            f"{key}: the card renders {full['fieldCount']} fields and its record says {summary['n_fields']}",
        )
        check(
            full["readCount"] == summary["n_read"] and full["refusedCount"] == summary["n_refused"],
            f"{key}: the card says {full['readCount']}/{full['refusedCount']} and its record says "
            f"{summary['n_read']}/{summary['n_refused']}",
        )
        check(
            log_only["readCount"] == summary["log_only_read"]
            and log_only["refusedCount"] == summary["log_only_refused"],
            f"{key}: the log-only card says {log_only['readCount']}/{log_only['refusedCount']} and "
            f"its record says {summary['log_only_read']}/{summary['log_only_refused']}",
        )
        check(
            [f["name"] for f in full["fields"] if f["state"] == "read"] == summary["read_fields"],
            f"{key}: the read fields parsed out of the card are not the record's read fields",
        )
        check(
            [f["name"] for f in full["fields"] if f["state"] == "refused"] == summary["refused_fields"],
            f"{key}: the refused fields parsed out of the card are not the record's refused fields",
        )
        check(
            [f["name"] for f in log_only["fields"]] == [f["name"] for f in full["fields"]],
            f"{key}: the two access states render the thirteen fields in different orders",
        )
        field_orders.add(tuple(f["name"] for f in full["fields"]))

        structured_by_field = {entry["field"]: entry for entry in structured}
        for field in full["fields"]:
            if field["state"] != "refused":
                continue
            entry = structured_by_field.get(field["name"])
            check(entry is not None, f"{key}: {field['name']} refuses in the card and not in the refusal record")
            check(
                entry["reason"] == field["reason"],
                f"{key}: {field['name']} refuses as {field['reason']} in the card and "
                f"{entry['reason']} in the record",
            )
            check(
                entry["remedy"].strip().lower().startswith(field["remedy"][:24].strip().lower())
                or field["remedy"].lower().startswith(entry["remedy"][:24].strip().lower()),
                f"{key}: {field['name']}'s remedy differs between the card and the record",
            )
            field["instrument"] = entry.get("instrument")
            field["quantity"] = entry.get("quantity")
        for field in full["fields"]:
            field.setdefault("instrument", None)
            field.setdefault("quantity", None)
        for field in log_only["fields"]:
            field.setdefault("instrument", None)
            field.setdefault("quantity", None)

        # ---- the numbers the act quotes -------------------------------------
        mutants = next(f for f in full["fields"] if f["name"] == "surviving mutants")
        mutation_line = next(line for line in mutants["supporting"] if line.startswith("mutation score"))
        mutation_score = number(r"mutation score ([0-9.]+)", mutation_line, f"{key} mutation score", float)
        competent = number(r"over (\d+) competent", mutation_line, f"{key} competent mutants")
        check(
            abs(mutation_score - summary["fields"]["surviving_mutants"]["mutation_score"]) < 5e-4,
            f"{key}: the card renders mutation score {mutation_score} and its record carries "
            f"{summary['fields']['surviving_mutants']['mutation_score']}",
        )

        metamorphic = next(f for f in full["fields"] if f["name"] == "metamorphic violations")
        metamorphic_line = next(line for line in metamorphic["supporting"] if "applicable rollout-relation pairs" in line)
        violations = number(r"^(\d+) violations", metamorphic_line, f"{key} metamorphic violations")
        applicable = number(r"over (\d+) applicable", metamorphic_line, f"{key} applicable pairs")
        rate = summary["fields"]["metamorphic_violations"]["violation_rate"]
        if isinstance(rate, (int, float)):
            check(
                abs(violations / applicable - rate) < 1e-9,
                f"{key}: {violations}/{applicable} is not the recorded rate {rate}",
            )
        else:
            check(
                applicable == 0,
                f"{key}: the record carries no violation rate and the card says {applicable} "
                f"applicable pairs, so the rate is defined and should be there",
            )
            rate = None

        substrate, _, phase = (full["meta"].get("substrate") or "").partition("phase")
        check(
            bool(substrate.strip()) and bool(phase.strip()),
            f"{key}: the card's substrate line did not parse, so the metadata block's column "
            f"has moved and every field read from it is silently empty",
        )
        check(
            bool(full["meta"].get("lowest reading")),
            f"{key}: the card's lowest-reading trust did not parse",
        )
        cards.append(
            {
                "key": key,
                "displayName": full["display"],
                "subject": {
                    "name": full["header"]["#"][0] if "#" in full["header"] else summary["subject"],
                    "kind": summary["kind"],
                    "source": (full["header"].get("source") or [None])[0],
                    "entrypoint": (full["header"].get("entry") or [None])[0],
                    "corpus": (full["header"].get("corpus") or [None])[0],
                    "notes": full["header"].get("note") or [],
                },
                "fingerprint": summary["fingerprint"],
                "substrate": substrate.strip() or None,
                "phase": phase.strip() or None,
                "trust": summary["card_trust"],
                "lowestReadingTrust": full["meta"].get("lowest reading"),
                "evidenceId": record["id"],
                "graderCalls": summary["grader_calls"],
                "mutationScore": mutation_score,
                "competentMutants": competent,
                "survivedMutants": int(summary["fields"]["surviving_mutants"]["survived"]),
                "killedMutants": int(summary["fields"]["surviving_mutants"]["killed"]),
                "bareHandlerCount": handlers["n_bare_excepts"],
                "bareHandlers": [
                    {"line": h["line"], "function": h["function"], "returns": h["returns"]}
                    for h in handlers["handlers"]
                ],
                "sourceLines": handlers["source_lines"],
                "bareHandlerEvidenceId": handlers_record["id"],
                "metamorphicViolations": violations,
                "metamorphicApplicablePairs": applicable,
                "metamorphicViolationRate": rate,
                "sensitiveFields": summary["sensitive_fields"],
                "access": {
                    "full": {
                        "readCount": full["readCount"],
                        "refusedCount": full["refusedCount"],
                        "summarySentence": full["summarySentence"],
                        "fields": full["fields"],
                    },
                    "log_only": {
                        "readCount": log_only["readCount"],
                        "refusedCount": log_only["refusedCount"],
                        "summarySentence": log_only["summarySentence"],
                        "fields": log_only["fields"],
                    },
                },
            }
        )

    check(
        len(field_orders) == 1,
        f"the four cards render their thirteen fields in {len(field_orders)} different orders, "
        f"so there is no single library order for the component to follow",
    )
    field_order = list(next(iter(field_orders)))

    def totals(state: str) -> dict:
        reasons: dict[str, int] = {}
        for card in cards:
            for field in card["access"][state]["fields"]:
                if field["state"] == "refused":
                    reasons[field["reason"]] = reasons.get(field["reason"], 0) + 1
        return {
            "fields": sum(len(card["access"][state]["fields"]) for card in cards),
            "read": sum(card["access"][state]["readCount"] for card in cards),
            "refused": sum(card["access"][state]["refusedCount"] for card in cards),
            "byReason": dict(sorted(reasons.items())),
        }

    full_totals, log_totals = totals("full"), totals("log_only")
    measured.record("field_order", field_order)
    measured.record("fields_per_card", len(field_order))
    measured.record("full_access_totals", {k: v for k, v in full_totals.items() if k != "byReason"})
    measured.record("full_access_by_reason", full_totals["byReason"])
    measured.record("log_only_totals", {k: v for k, v in log_totals.items() if k != "byReason"})
    measured.record("log_only_by_reason", log_totals["byReason"])
    measured.record(
        "log_only_read_per_card", {card["key"]: card["access"]["log_only"]["readCount"] for card in cards}
    )
    measured.record(
        "log_only_surviving_fields",
        sorted(
            {
                field["name"]
                for card in cards
                for field in card["access"]["log_only"]["fields"]
                if field["state"] == "read"
            }
        ),
    )
    measured.record("mutation_scores", {card["key"]: card["mutationScore"] for card in cards})
    measured.record("killed_mutants", {card["key"]: card["killedMutants"] for card in cards})
    measured.record("bare_handlers", {card["key"]: card["bareHandlerCount"] for card in cards})
    measured.record("source_lines", {card["key"]: card["sourceLines"] for card in cards})
    measured.record(
        "metamorphic_violations", {card["key"]: card["metamorphicViolations"] for card in cards}
    )
    measured.record(
        "metamorphic_applicable_pairs",
        {card["key"]: card["metamorphicApplicablePairs"] for card in cards},
    )

    return {
        "meta": {
            "subjectCount": len(cards),
            "fieldsPerCard": len(field_order),
            "fieldOrder": field_order,
            "accessStates": ["full", "log_only"],
            "fullAccess": full_totals,
            "logOnlyAccess": log_totals,
            "derivedFrom": sources,
        },
        "cards": cards,
    }


def main() -> None:
    measured = Observations("build_grader_cards", "scripts/build_grader_cards.py")
    payload = build(measured)
    out = DATA / "grader-cards.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    # Three subjects are vendored third-party checkouts, and the card header
    # records where they were read from: an absolute path on this machine, which
    # rendered into public HTML. scripts/pubpath.py rewrites it to the path as it
    # reads inside the upstream project, which is the form a reader can look up.
    payload = redact(payload, where=out.name)
    out.write_text(json.dumps(payload, indent=1, sort_keys=False) + "\n", encoding="utf-8")
    measured.write()

    print(f"build_grader_cards: {out.name}, {out.stat().st_size:,} bytes")
    print(
        f"  {payload['meta']['subjectCount']} subjects x {payload['meta']['fieldsPerCard']} fields "
        f"x 2 access states = "
        f"{payload['meta']['fullAccess']['fields'] + payload['meta']['logOnlyAccess']['fields']} "
        f"field renderings"
    )
    print(f"  full access  {payload['meta']['fullAccess']['read']} read, "
          f"{payload['meta']['fullAccess']['refused']} refused {payload['meta']['fullAccess']['byReason']}")
    print(f"  log only     {payload['meta']['logOnlyAccess']['read']} read, "
          f"{payload['meta']['logOnlyAccess']['refused']} refused {payload['meta']['logOnlyAccess']['byReason']}")
    for card in payload["cards"]:
        print(
            f"  {card['key']:16s} full {card['access']['full']['readCount']:2d}/"
            f"{card['access']['full']['refusedCount']:2d}   log-only "
            f"{card['access']['log_only']['readCount']:2d}/{card['access']['log_only']['refusedCount']:2d}"
            f"   mutation {card['mutationScore']:.3f}   bare handlers {card['bareHandlerCount']}"
            f"   metamorphic {card['metamorphicViolations']}/{card['metamorphicApplicablePairs']}"
        )
    print(f"  {len(measured.values)} measurements recorded to {measured.path()}")


if __name__ == "__main__":
    main()
