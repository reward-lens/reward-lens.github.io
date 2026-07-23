#!/usr/bin/env python
"""Compute the lens-demo artifacts with the library itself, on this box.

Per-token reward maps come from the library's own gated instrument
(DenseRewardExtractor.dense_rewards: first differences of the prefix-score
curve, pinned EXPLORATORY by construction). The demo model is the smallest
real fleet model. Nothing here is mocked; the output JSON embeds its own
provenance block and the site renders the trust level it actually has.

    /home/suhail-nadaf/final-reward/.venv/bin/python scripts/build_demo_artifacts.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

SITE = Path(__file__).resolve().parent.parent
OUT = SITE / "src" / "data" / "demos" / "lens-demo.json"
MODEL_HF = "Skywork/Skywork-Reward-V2-Qwen3-0.6B"
AXES = ["helpfulness", "verbosity", "sycophancy", "correctness", "formatting"]
SEED = 0
MAX_TOKENS = 150


def pick_item(items: list) -> dict:
    """Shortest pair in the axis, for strip legibility."""

    def length(it) -> int:
        d = as_dict(it)
        return len(d["prompt"]) + len(d["chosen"]) + len(d["rejected"])

    return as_dict(min(items, key=length))


def as_dict(item) -> dict:
    def text_of(x) -> str:
        if isinstance(x, str):
            return x
        return getattr(x, "text", None) or str(x)

    if isinstance(item, dict):
        src = item
    else:
        src = {k: getattr(item, k, "") for k in ("prompt", "chosen", "rejected", "axis")}
    return {
        "prompt": text_of(src.get("prompt", "")),
        "chosen": text_of(src.get("chosen", "")),
        "rejected": text_of(src.get("rejected", "")),
        "axis": str(src.get("axis", "")),
    }


def main() -> None:
    t0 = time.time()
    import torch

    torch.manual_seed(SEED)
    np.random.seed(SEED)

    import reward_lens
    from reward_lens.data.builtin.diagnostic_v3 import load_diagnostic_v3
    from reward_lens.data.schema import DataView
    from reward_lens.signals.dense import DenseRewardExtractor
    from reward_lens.signals.loaders import load_signal

    sig = load_signal(MODEL_HF, allow_download=True)
    dense = DenseRewardExtractor(sig)
    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(MODEL_HF)

    suite = load_diagnostic_v3()
    pairs_out = []
    for axis in AXES:
        item = pick_item(list(suite[axis].items))
        sides = {}
        skip = False
        for side in ("chosen", "rejected"):
            single = {"prompt": item["prompt"], "response": item[side]}
            view = DataView([single])
            score_ev = sig.score(view)
            score = float(np.asarray(score_ev.value.values).reshape(-1)[0])
            dense_ev = dense.dense_rewards(view)
            curve = np.asarray(dense_ev.value.curves[0], dtype=np.float64)
            # The dense map telescopes back to the outcome score; a mismatch
            # means the demo would misrepresent the instrument. Hard failure.
            total = float(curve.sum())
            if abs(total - score) > 1e-2 * max(1.0, abs(score)):
                print(
                    f"ASSERTION FAILED: {axis}/{side} dense map sums to "
                    f"{total}, score is {score}",
                    file=sys.stderr,
                )
                sys.exit(1)

            tok = sig.tokenize(single)
            ids = list(tok.input_ids)
            if len(ids) != len(curve):
                print(
                    f"ASSERTION FAILED: {axis}/{side} token count "
                    f"{len(ids)} != curve length {len(curve)}",
                    file=sys.stderr,
                )
                sys.exit(1)
            if len(ids) > MAX_TOKENS:
                skip = True
                break
            pieces = [
                tokenizer.decode([i], skip_special_tokens=False) for i in ids
            ]
            # Locate where the response begins in the templated text so the
            # UI can de-emphasize the prompt region.
            text = getattr(tok, "text", None)
            response_start_tok = 0
            offsets = list(getattr(tok, "token_offsets", []) or [])
            if text and item[side] and offsets:
                pos = text.find(item[side][:24])
                if pos >= 0:
                    for t_index, (a, b) in enumerate(offsets):
                        if b > pos:
                            response_start_tok = t_index
                            break
            sides[side] = {
                "text": item[side],
                "score": score,
                "tokens": [
                    {"t": piece, "v": round(float(v), 5)}
                    for piece, v in zip(pieces, curve)
                ],
                "response_start": response_start_tok,
                "trust": str(dense_ev.trust.name),
                "gauge": str(getattr(dense_ev.gauge, "value", dense_ev.gauge)),
                "observable": "signals.dense.dense_rewards",
            }
        if skip or len(sides) != 2:
            print(f"note: axis {axis} skipped (over {MAX_TOKENS} tokens)")
            continue
        pairs_out.append(
            {
                "id": axis,
                "axis": axis,
                "prompt": item["prompt"],
                "chosen": sides["chosen"],
                "rejected": sides["rejected"],
                "gap": sides["chosen"]["score"] - sides["rejected"]["score"],
            }
        )

    if len(pairs_out) < 4:
        print(
            f"ASSERTION FAILED: only {len(pairs_out)} usable pairs; need 4+",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=SITE,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except Exception:
        commit = "uncommitted"

    out = {
        "provenance": {
            "model_hf": MODEL_HF,
            "model_fingerprint": str(sig.meta.fingerprint),
            "adapter": sig.meta.adapter,
            "instrument": "reward_lens.signals.dense.DenseRewardExtractor.dense_rewards",
            "method": "differential_prefix_attribution",
            "library_version": reward_lens.__version__,
            "dataset": "reward_lens.data.builtin.diagnostic_v3",
            "axes": [p["axis"] for p in pairs_out],
            "device": "cpu",
            "seed": SEED,
            "wall_seconds": round(time.time() - t0, 1),
            "script_commit": commit,
        },
        "pairs": pairs_out,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(
        f"wrote {OUT.relative_to(SITE)}: {len(pairs_out)} pairs, "
        f"{time.time() - t0:.0f}s"
    )


if __name__ == "__main__":
    main()
