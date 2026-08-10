"""Recompute act one's rank correlation and its two orderings from this bundle.

Run from the directory this file is in:

    python reproduce.py

Reads only `attribution_per_pair.jsonl`, `patching_per_pair.jsonl` and
`golden.json`, all of which are in this bundle. Standard library only: no
numpy, no model, no GPU, no network.

WHAT IT CHECKS. The two records are joined on (dimension, pair_id). For each
pair a Spearman rank correlation is taken between the magnitude of each
component's attribution and the magnitude of what patching that component did,
over the 64 components both records carry. Those per-pair correlations are
averaged per dimension, and the result is compared against `golden.json`, the
frozen E-parity fixture. That is the same statistic the experiment computed and
the same one the page states.

It then prints, per dimension, the component attribution ranks first and how
far patching that component actually moved the score, as a fraction of the
pair's own margin. That fraction is not bounded by 1.
"""

import json
import math

TOLERANCE = 0.01  # golden.json's own stated tolerance for E04
MODEL = "Skywork-Reward-Llama-3.1-8B-v0.2"


def rows(name):
    with open(name, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def ranks(values):
    """Average ranks, ties shared, which is what a Spearman needs."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    out = [0.0] * len(values)
    index = 0
    while index < len(order):
        stop = index
        while stop + 1 < len(order) and values[order[stop + 1]] == values[order[index]]:
            stop += 1
        shared = (index + stop) / 2 + 1
        for position in range(index, stop + 1):
            out[order[position]] = shared
        index = stop + 1
    return out


def spearman(xs, ys):
    rx, ry = ranks(xs), ranks(ys)
    mx = sum(rx) / len(rx)
    my = sum(ry) / len(ry)
    numerator = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    denominator = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return numerator / denominator if denominator else float("nan")


def main():
    attribution = rows("attribution_per_pair.jsonl")
    patching = {(r["dimension"], r["pair_id"]): r for r in rows("patching_per_pair.jsonl")}
    golden = json.load(open("golden.json", encoding="utf-8"))["E04"]
    published = golden["per_model_dimension_rho"][MODEL]

    per_dimension = {}
    components = {}
    for record in attribution:
        key = (record["dimension"], record["pair_id"])
        patched = patching[key]
        attributed = dict(zip(record["component_names"], record["differential_contributions"]))
        margin = abs(patched["original_differential"])
        xs, ys = [], []
        for name, effect in zip(patched["component_names"], patched["patch_effects"]):
            xs.append(abs(attributed[name]))
            ys.append(abs(effect))
            slot = components.setdefault(record["dimension"], {}).setdefault(name, [0.0, 0.0, 0])
            slot[0] += abs(attributed[name])
            slot[1] += abs(effect) / margin
            slot[2] += 1
        per_dimension.setdefault(record["dimension"], []).append(spearman(xs, ys))

    print(f"pairs joined                {len(attribution)}")
    print(f"components ranked both ways {len(next(iter(components.values())))}")
    print(f"dimensions                  {len(per_dimension)}")
    print()
    print("dimension              recomputed  published   top attribution  moves")
    worst = 0.0
    for dimension in sorted(per_dimension):
        values = per_dimension[dimension]
        mine = sum(values) / len(values)
        theirs = published[dimension]
        worst = max(worst, abs(mine - theirs))
        table = components[dimension]
        top = max(table, key=lambda name: table[name][0] / table[name][2])
        moves = table[top][1] / table[top][2]
        print(
            f"{dimension:22s} {mine:+.6f}  {theirs:+.6f}   {top:9s}    {moves * 100:9.4f}%"
        )
    print()
    print(f"largest disagreement with the fixture  {worst:.6f}  (tolerance {TOLERANCE})")
    print("within tolerance                       " + ("yes" if worst <= TOLERANCE else "NO"))


if __name__ == "__main__":
    main()
