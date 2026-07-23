#!/usr/bin/env python
"""Vendor campaign artifacts into the site repo as typed JSON plus optimized images.

This script is the only bridge between the campaign evidence on local disk and
the site. It is idempotent, asserts the scored-ledger totals before writing,
and records a provenance manifest for every vendored file. Run it with the
project venv:

    /home/suhail-nadaf/final-reward/.venv/bin/python scripts/build_data.py

The site build itself (npm run build) never reads outside the repo; CI re-checks
the committed outputs with scripts/checks/data_assertions.mjs.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
FINAL = Path("/home/suhail-nadaf/final-reward")
CAMPAIGN = FINAL / "campaign-results"
CAMPAIGN_CONFIG = (
    FINAL / "reward-lens--github" / "reward-lens-campaign" / "campaign" / "config.py"
)
DATA = SITE / "src" / "data"
PUB_FIG = SITE / "public" / "figures"

EXPECTED_KILLS = {
    "K-err",
    "K-verif",
    "K-forensic",
    "K-vce",
    "K-kui",
    "K-transfer",
    "K-avp",
    "K-meta",
}

EXPECTED_VERDICTS = {
    "ERR-RB2": "refuted",
    "FORECAST-CAT": "mixed",
    "STYLE-RMB": "inconclusive",
    "PPE-BON": "inconclusive",
    "LADDER": "mixed",
    "CHI-DRIFT": "confirmed",
    "HUMP": "inconclusive",
    "GAUGE-E19": "inconclusive",
    "GAUGE-XFAM": "inconclusive",
    "HACK-FORE": "inconclusive",
    "SURGERY": "mixed",
    "VERIF-PRM": "refuted",
    "JUDGE-VBC": "confirmed",
    "VALUES-CONTEST": "inconclusive",
    "FORENSIC-RECEIPT": "refuted",
    "ATLAS-VCE": "refuted",
    "FACT-KUI": "refuted",
    "CAPACITY-WELCH": "mixed",
    "EVAL-AWARE": "mixed",
    "TOPO-HODGE": "confirmed",
    "EMB-LORA": "mixed",
    "CAL-TRANSFER": "refuted",
    "ADJ-AVP": "refuted",
    "CONF-PARTIAL": "mixed",
    "T3-DECOMP": "confirmed",
    "T3-FIELD": "inconclusive",
    "META-LEDGER": "refuted",
}

# Spot checks against the adjudicated headline values (RESULTS.md / SCOREBOARD.md).
EXPECTED_HEADLINES = {
    ("CHI-DRIFT", "chi_bon_spearman"): 0.964286,
    ("TOPO-HODGE", "intransitive_mass"): 0.213976,
    ("JUDGE-VBC", "verdict_prefix_match_rate"): 1.0,
    ("T3-DECOMP", "real_tacit_fraction"): 0.972287,
    ("CAL-TRANSFER", "max_abs_auc_difference"): 0.418983,
    ("ADJ-AVP", "recovery_gap"): -0.566038,
    ("META-LEDGER", "brier_directional"): 0.26,
    ("SURGERY", "exploit_drift_reduction"): 0.885616,
    ("EVAL-AWARE", "real_probe_balanced_acc"): 0.79325,
    ("ATLAS-VCE", "real_vce"): -0.0698739,
}

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


def main() -> None:
    prov = Provenance(DATA / "provenance.json")

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
    check(n_records == 1363, f"evidence.jsonl has {n_records} records, expected 1363")
    check(
        len(adjudications) == 27,
        f"found {len(adjudications)} adjudication records, expected 27",
    )

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
    check(len(ordered_cards) == 27, "study order does not cover 27 cards")

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
    check(len(ledger) == 53, f"ledger has {len(ledger)} rows, expected 53")
    check(
        counts == {"confirmed": 16, "refuted": 21, "inconclusive": 16},
        f"ledger totals {counts} do not match 16/21/16",
    )
    kills = {row["kill_id"] for row in ledger if row["kill_id"]}
    check(kills == EXPECTED_KILLS, f"kill ids {sorted(kills)} != expected 8")

    for (card, metric), expected in EXPECTED_HEADLINES.items():
        rows = [r for r in ledger if r["card"] == card and r["metric"] == metric]
        check(bool(rows), f"no ledger row for {card}/{metric}")
        got = rows[0]["observed"]
        check(
            got is not None and abs(got - expected) < 1e-4,
            f"{card}/{metric} observed {got} != expected {expected}",
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
    check(
        set(kill_notes) == EXPECTED_KILLS,
        f"kill notes parsed for {sorted(kill_notes)}, expected the 8 kills",
    )

    # ---- cards.json (8.2) ---------------------------------------------------
    verdicts = dict(close_summary["cards"])
    verdicts["META-LEDGER"] = close_summary["meta"]
    check(verdicts == EXPECTED_VERDICTS, "card verdicts do not match expected map")
    by_verdict = {"confirmed": 0, "refuted": 0, "mixed": 0, "inconclusive": 0}
    for v in verdicts.values():
        by_verdict[v] += 1
    check(
        by_verdict == {"confirmed": 4, "refuted": 8, "mixed": 7, "inconclusive": 8},
        f"card verdict distribution {by_verdict} != 4/8/7/8",
    )

    power = {p["card"]: p for p in manifest["power_acceptances"]}
    figure_names = set(close_summary["figures"])

    cards = []
    for card in ordered_cards:
        spec = specs[card]["spec"]
        adj = unwrap(adjudications[card]["value"])
        outcomes = adj.get("outcomes") or {}
        metrics = adj.get("metrics") or {}
        science_raw = spec["science"]
        m = re.match(r"S0*(\d+)", science_raw or "")
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
    check(len(cards) == 27, "cards.json must have 27 entries")
    check(len(power) == 8, f"expected 8 power acceptances, got {len(power)}")
    write_json(DATA / "cards.json", cards)
    prov.record(evidence_path, DATA / "cards.json")

    # ---- theorems.json (8.3) ------------------------------------------------
    statuses = {t["id"]: t["status"] for t in scoreboard.values()}
    check(statuses["T9"] == "confirmed", "T9 must be confirmed")
    check(statuses["T13"] == "refuted", "T13 must be refuted")
    check(
        sum(1 for s in statuses.values() if s == "open") == 12,
        "expected twelve open theorem rows",
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
        "hypotheses": {"total": 53, **counts},
        "cards": {"total": 27, **by_verdict},
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
        "adjudicated_cards": 19,
        "store_records": n_records,
    }
    check(
        abs(campaign_summary["spend_usd"] - 17.725824562737877) < 1e-9,
        "spend total drifted from close_summary",
    )
    check(len(manifest["spec_hashes"]) == 27, "manifest must carry 27 spec hashes")
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
    check(best is not None and best[0] > 0, "no GPU-cost record found for excerpt")
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

    # ---- fleet (8.4) --------------------------------------------------------
    sys.path.insert(0, str(FINAL))
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

    fleet_index = []
    for key in FLEET:
        card_obj = json.loads(build_card(key, store).to_json())
        check(card_obj["entries"], f"fleet card for {key} has no entries")
        headline = []
        for ev in store.find(observable="campaign.index.table", signal=key, latest=False):
            table = ev.value if isinstance(ev.value, dict) else {}
            rows = table.get("rows") or []
            meta = table.get("meta") or {}
            headline.append(
                {
                    "name": table.get("name"),
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
    check(len(fleet_index) == 10, "fleet index must have 10 models")
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
    # The file carries three tables: 65 feature rows, 3 gate firings, and the
    # 7 v1 failure-class regression rows (the method page's sharpest table).
    features = [r for r in wl_rows if r["subsystem"] not in ("gate", "v1 regression")]
    gates = [r for r in wl_rows if r["subsystem"] == "gate"]
    failure_classes = [r for r in wl_rows if r["subsystem"] == "v1 regression"]
    check(
        len(features) == 65,
        f"works ledger has {len(features)} feature rows, expected 65",
    )
    check(len(failure_classes) == 7, "expected 7 v1 failure-class rows")
    wl_counts: dict[str, int] = {}
    for r in features:
        key = "PASS" if r["status"] in ("PASS", "PASS-DEGRADED") else r["status"]
        wl_counts[key] = wl_counts.get(key, 0) + 1
    check(
        wl_counts == {"PASS": 45, "FAIL": 4, "EXCUSED": 7, "NOT-RUN": 9},
        f"works ledger status counts {wl_counts} do not match 45/4/7/9",
    )
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
    check(len(pngs) == 62, f"expected 62 campaign PNGs, found {len(pngs)}")
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
    check(len(svgs) == 48, f"expected 48 docs SVGs, found {len(svgs)}")
    for src in svgs:
        dst = svg_out / src.name
        shutil.copyfile(src, dst)
        prov.record(src, dst)

    prov.write()
    print("build_data: all assertions passed")
    print(f"  ledger: 53 rows ({counts})")
    print(f"  cards: 27 ({by_verdict}); kills: {sorted(kills)}")
    print(f"  gpu_seconds total: {gpu_seconds_total:.1f}")
    print(f"  largest arcs by gpu-seconds: {largest_arcs[:3]}")
    print(f"  fleet: {len(fleet_index)} models")
    print(f"  figures: {len(pngs)} campaign PNGs, {len(svgs)} docs SVGs")


def sha_changed(prov: Provenance, src: Path, dst: Path) -> bool:
    rel = str(dst.relative_to(SITE))
    prior = prov.prior.get(rel)
    return not prior or prior["sha256"] != sha256(src)


if __name__ == "__main__":
    main()
