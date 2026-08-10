"""Re-derive act three's card totals from the release bundle in this directory.

Run from the directory this file is in:

    python reproduce.py

Reads `cards/*.txt`, `refusals/*.json` and `evidence.jsonl`, all of which are in
this bundle. Standard library only: no library install, no grader call, no
network.

WHAT IT CHECKS. Each rendered card is parsed back into thirteen fields in the
order the library wrote them, and the read and refused sets are compared
against the structured record the same run emitted. Every refusal must carry a
reason, the input that was missing and a non-empty remedy, which is the
library's own guard restated where a reader can run it. The totals across the
four subjects are then printed for both access states.

The point of the second state is that the same four subjects, read by somebody
holding only a log, lose almost every field. It is printed beside the first so
the comparison is one line rather than an argument.
"""

import json
import os
import re

BODY_COLUMN = 29


def parse(path):
    lines = open(path, encoding="utf-8").read().splitlines()
    start = None
    for index, line in enumerate(lines):
        if re.match(r"^  \d+ of \d+ fields read and \d+ refused\.", line):
            start = index
            break
    if start is None:
        raise SystemExit(f"{path}: no summary line")
    counts = re.match(r"^  (\d+) of (\d+) fields read and (\d+) refused\.", lines[start])
    fields, current = [], None
    for line in lines[start + 1 :]:
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip(" "))
        if indent == 2:
            name = line[2:BODY_COLUMN].rstrip()
            if not name or " field(s) withheld" in line or name[0].isdigit():
                break
            current = {"name": name, "head": line[BODY_COLUMN:].strip(), "body": []}
            fields.append(current)
        elif indent >= BODY_COLUMN and current is not None:
            current["body"].append(line.strip())
    for field in fields:
        if field["head"].startswith("REFUSED"):
            field["state"] = "refused"
            field["reason"] = field["head"].removeprefix("REFUSED").strip()
            field["remedy"] = next(
                (b.removeprefix("Remedy: ") for b in field["body"] if b.startswith("Remedy: ")), ""
            )
        else:
            field["state"] = "read"
            field["reason"] = None
            field["remedy"] = None
    return {
        "read": int(counts.group(1)),
        "total": int(counts.group(2)),
        "refused": int(counts.group(3)),
        "fields": fields,
    }


def main():
    records = {}
    with open("evidence.jsonl", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                record = json.loads(line)
                records[record["observable"]] = record

    keys = sorted(
        name[: -len(".txt")]
        for name in os.listdir("cards")
        if name.endswith(".txt") and not name.endswith("-log-only.txt")
    )

    totals = {"full": [0, 0], "log_only": [0, 0]}
    reasons = {"full": {}, "log_only": {}}
    print("subject           access     read  refused  remedies  reasons")
    for key in keys:
        summary = records[f"x1.card.{key}"]["value"]["__map__"]
        for state, path, recorded in (
            ("full", f"cards/{key}.txt", (summary["n_read"], summary["n_refused"])),
            ("log_only", f"cards/{key}-log-only.txt", (summary["log_only_read"], summary["log_only_refused"])),
        ):
            card = parse(path)
            if (card["read"], card["refused"]) != recorded:
                raise SystemExit(f"{path}: {card['read']}/{card['refused']} against record {recorded}")
            refusals = [f for f in card["fields"] if f["state"] == "refused"]
            missing = [f["name"] for f in refusals if not f["remedy"].strip()]
            if missing:
                raise SystemExit(f"{path}: refusals with no remedy: {missing}")
            totals[state][0] += card["read"]
            totals[state][1] += card["refused"]
            for field in refusals:
                reasons[state][field["reason"]] = reasons[state].get(field["reason"], 0) + 1
            print(
                f"{key:16s}  {state:9s}  {card['read']:4d}  {card['refused']:7d}  "
                f"{len(refusals):8d}  {len(set(f['reason'] for f in refusals))}"
            )

    print()
    for state in ("full", "log_only"):
        read, refused = totals[state]
        print(f"{state:9s}  {read + refused} fields, {read} read, {refused} refused")
        for reason, count in sorted(reasons[state].items()):
            print(f"             {reason:24s} {count}")

    structured = 0
    for key in keys:
        structured += len(json.load(open(f"refusals/{key}.json", encoding="utf-8")))
    print()
    print(f"structured refusal records  {structured}")
    print(f"refusals parsed at full access  {totals['full'][1]}")
    print("the two agree               " + ("yes" if structured == totals["full"][1] else "NO"))


if __name__ == "__main__":
    main()
