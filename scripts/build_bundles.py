#!/usr/bin/env python
"""One reproduction bundle per act, and the manifest the panel reads.

    python scripts/build_bundles.py

    ->  public/bundles/<act>.zip      the artifact a reader downloads
        src/data/bundles.json         its manifest

`components/bundle-panel.md:106` reads a manifest emitted by P1 and there was
no manifest and nothing in `public/`, so part 6 of all three acts had nothing
to render.

WHAT THE PANEL NEEDS AND WHERE EACH FIELD COMES FROM.

    contents        the zip's own name list, read back after writing it
    sizeBytes       the file on disk
    sha256          the file on disk
    commit          `git rev-parse` in this repository
    expectedOutput  THE BUNDLE'S OWN SCRIPT, RUN, WITH ITS STDOUT CAPTURED
    requirements    copy.yaml, by key. Never composed here.
    reproducedBy    null on all three, and that is the true value

`sizeBytes`, `sha256` and `contents` are derived from the artifact rather than
asserted, per D-08 and the panel's own acceptance criterion 1. So is the
expected output: the generator runs `reproduce.py` inside the staged bundle and
records what it printed. Nobody types an expected result, so the promise cannot
rot into a description of what the script used to do.

NO REPRODUCTION IS RECORDED, AND THAT IS THE REAL ANSWER.
`copy.yaml:ui.not_reproduced` reads "No independent reproduction recorded." and
that sentence is true of all three bundles. `reproducedBy` is null and no
generator here can set it: a reproduction is a fact about somebody else's
machine, so it would arrive as a reviewed change to this file and not as
something a build inferred.

THE ZIP IS BYTE-STABLE. Every entry is written with a fixed timestamp and a
fixed mode, in sorted order, so two builds over unchanged inputs produce the
same hash. A manifest whose hash changes on every build is a manifest nobody
can check.

TWO PLACES THE COPY AND THE ARTIFACT DISAGREE, REPORTED AND NOT PAPERED OVER.

  * `acts.run.bundle_requirements` says the bundle "carries the labelled
    rollout table, so the fit and the alarm regenerate end to end from what is
    in it". The fit does. THE ALARM DOES NOT: the table carries `length`,
    `reasoning_length`, `training_passed`, `passed`, `thinking_format_ok` and
    `step`, and no reward and no group index, so a within-group reward variance
    cannot be formed from it. PREDICTIONS.md row R3 says the same thing in the
    library's own words. The bundle therefore carries the two frozen ledger
    rows beside the table, and its script re-fits the transition and prints its
    own fit next to the ledger's rather than claiming the alarm.
  * `acts.grader.bundle_requirements` describes a card RENDERER a reader points
    at their own scoring program. That needs the library installed, which needs
    a network, and it is a different artifact from the release bundle this
    directory contains. This ships the release bundle: the rendered cards, the
    structured refusals and the evidence records, re-derivable with nothing but
    the standard library.

Both are copy decisions and copy belongs to the build lead, so they are
reported rather than resolved here.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
FINAL = Path("/home/suhail-nadaf/final-reward")
ASSAY = FINAL / "reward-lens--github" / "reward-lens-assay"
V1_E04 = (
    FINAL
    / "reward-lens"
    / "outputs"
    / "v2_20260506_222648_unknown"
    / "e04_faithfulness_population"
    / "Skywork-Reward-Llama-3.1-8B-v0.2"
)
RELEASE = ASSAY / "experiments" / "x1_release"
DATA = SITE / "src" / "data"
PUBLIC = SITE / "public" / "bundles"
SCRIPTS = Path(__file__).resolve().parent / "bundles"

#: Every zip entry gets this timestamp and this mode. Two builds over unchanged
#: inputs then produce the same bytes and the same hash.
FIXED_TIME = (1980, 1, 1, 0, 0, 0)
FIXED_MODE = 0o100644

sys.path.insert(0, str(SITE / "tests" / "regression"))
from observe import Observations  # noqa: E402


def fail(message: str) -> None:
    print(f"build_bundles: {message}", file=sys.stderr)
    sys.exit(1)


def check(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def commit() -> str:
    result = subprocess.run(
        ["git", "-C", str(SITE), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
    )
    check(result.returncode == 0, f"git rev-parse failed: {result.stderr.strip()}")
    return result.stdout.strip()


def predictions_rows(*row_ids: str) -> str:
    """The frozen ledger rows a bundle cites, verbatim, with their line numbers."""
    lines = (ASSAY / "PREDICTIONS.md").read_text(encoding="utf-8").splitlines()
    wanted = []
    for row_id in row_ids:
        found = [
            (number, line)
            for number, line in enumerate(lines, start=1)
            if line.startswith(f"| {row_id} |")
        ]
        check(len(found) == 1, f"PREDICTIONS.md has {len(found)} rows {row_id}, expected 1")
        wanted.append(f"PREDICTIONS.md:{found[0][0]}\n{found[0][1]}\n")
    return "\n".join(wanted)


#: act key -> what goes in the bundle. `files` is (name in the zip, path on
#: disk); `generated` is (name in the zip, bytes) for the things assembled here.
BUNDLES = {
    "reward-model": {
        "route": "/see/reward-model/",
        "requirementsKey": "acts.reward_model.bundle_requirements",
        "files": [
            ("attribution_per_pair.jsonl", V1_E04 / "attribution_per_pair.jsonl"),
            ("patching_per_pair.jsonl", V1_E04 / "patching_per_pair.jsonl"),
            ("golden.json", ASSAY / "fixtures" / "e_parity" / "golden.json"),
            ("reproduce.py", SCRIPTS / "reward_model.py"),
        ],
    },
    "run": {
        "route": "/see/run/",
        "requirementsKey": "acts.run.bundle_requirements",
        "files": [
            ("aisi_lengths.npz", ASSAY / "experiments" / "x5_threshold" / "aisi_lengths.npz"),
            ("reproduce.py", SCRIPTS / "run.py"),
        ],
    },
    "grader": {
        "route": "/see/grader/",
        "requirementsKey": "acts.grader.bundle_requirements",
        "files": [("reproduce.py", SCRIPTS / "grader.py")],
        "trees": [("cards", RELEASE / "cards"), ("refusals", RELEASE / "refusals")],
        "extra": [("evidence.jsonl", RELEASE / "evidence" / "evidence.jsonl")],
    },
}


def stage(act: str, spec: dict, into: Path) -> list[tuple[str, Path]]:
    """Lay the bundle out on disk. Returns (name in the zip, staged path)."""
    entries: list[tuple[str, Path]] = []

    def place(name: str, source: Path) -> None:
        check(source.exists(), f"{act}: {source} is missing, so the bundle cannot be assembled")
        target = into / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        entries.append((name, target))

    for name, source in spec.get("files", []):
        place(name, source)
    for name, source in spec.get("extra", []):
        place(name, source)
    for prefix, directory in spec.get("trees", []):
        check(directory.is_dir(), f"{act}: {directory} is not a directory")
        for source in sorted(directory.iterdir()):
            if source.is_file():
                place(f"{prefix}/{source.name}", source)

    if act == "run":
        rows = predictions_rows("R3", "R4")
        target = into / "PREDICTIONS-R3-R4.txt"
        target.write_text(rows, encoding="utf-8")
        entries.append(("PREDICTIONS-R3-R4.txt", target))
        shipped = DATA / "run-series.json"
        check(shipped.exists(), "src/data/run-series.json is missing; run build_data.py first")
        shutil.copyfile(shipped, into / "run-series.json")
        entries.append(("run-series.json", into / "run-series.json"))

    return sorted(entries)


def run_reproduce(act: str, directory: Path) -> str:
    """Run the bundle's own script and capture what it printed."""
    result = subprocess.run(
        [sys.executable, "reproduce.py"],
        cwd=directory,
        capture_output=True,
        text=True,
    )
    check(
        result.returncode == 0,
        f"{act}: reproduce.py exited {result.returncode}. A bundle whose own script does not "
        f"run is a download that asks for trust.\n{result.stderr}",
    )
    output = result.stdout.strip()
    check(
        bool(output),
        f"{act}: reproduce.py printed nothing, so the panel has no expected output and "
        f"the panel fails the build without one",
    )
    return output


def write_zip(entries: list[tuple[str, Path]], target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, path in entries:
            info = zipfile.ZipInfo(name, date_time=FIXED_TIME)
            info.external_attr = FIXED_MODE << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())


def build(measured: Observations) -> dict:
    reference = commit()
    manifests = []
    for act in sorted(BUNDLES):
        spec = BUNDLES[act]
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            entries = stage(act, spec, directory)
            expected = run_reproduce(act, directory)
            archive = PUBLIC / f"{act}.zip"
            write_zip(entries, archive)

        payload = archive.read_bytes()
        with zipfile.ZipFile(archive) as check_archive:
            contents = check_archive.namelist()
            bad = check_archive.testzip()
        check(bad is None, f"{act}: the written archive is corrupt at {bad}")
        check(
            contents == [name for name, _ in entries],
            f"{act}: the archive's name list is not what was staged",
        )
        manifests.append(
            {
                "act": act,
                "route": spec["route"],
                "href": f"/bundles/{act}.zip",
                "filename": f"{act}.zip",
                "format": "zip",
                "contents": contents,
                "sizeBytes": len(payload),
                "sha256": sha256_bytes(payload),
                "commit": reference,
                "command": f"unzip {act}.zip -d {act} && python {act}/reproduce.py",
                "requirementsKey": spec["requirementsKey"],
                "expectedOutput": expected,
                "reproducedBy": None,
            }
        )

    measured.record("bundles", [m["act"] for m in manifests])
    measured.record("bundle_entry_counts", {m["act"]: len(m["contents"]) for m in manifests})
    measured.record("bundle_sizes", {m["act"]: m["sizeBytes"] for m in manifests})
    measured.record("bundle_sha256", {m["act"]: m["sha256"] for m in manifests})
    measured.record(
        "expected_output_lines", {m["act"]: len(m["expectedOutput"].splitlines()) for m in manifests}
    )
    measured.record("reproductions_recorded", sum(1 for m in manifests if m["reproducedBy"]))

    return {"bundles": manifests}


def main() -> None:
    measured = Observations("build_bundles", "scripts/build_bundles.py")
    payload = build(measured)
    out = DATA / "bundles.json"
    out.write_text(json.dumps(payload, indent=1, sort_keys=False) + "\n", encoding="utf-8")
    measured.write()

    print(f"build_bundles: {out.name}, {len(payload['bundles'])} manifests")
    for manifest in payload["bundles"]:
        print(
            f"  {manifest['act']:14s} {manifest['sizeBytes']:>9,} bytes  "
            f"{len(manifest['contents']):2d} files  sha256 {manifest['sha256'][:16]}  "
            f"{len(manifest['expectedOutput'].splitlines())} lines of expected output"
        )
    print(f"  {len(measured.values)} measurements recorded to {measured.path()}")


if __name__ == "__main__":
    main()
