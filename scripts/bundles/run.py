"""Regenerate act two's series from the labelled rollout table in this bundle.

Run from the directory this file is in:

    python reproduce.py

Reads `aisi_lengths.npz`, `run-series.json` and `PREDICTIONS-R3-R4.txt`, all of
which are in this bundle. Needs numpy, which reading an `.npz` needs anyway. No
GPU, no model, no network.

WHAT REGENERATES AND WHAT DOES NOT, STATED BEFORE YOU RUN IT.

The per-step series regenerate exactly: the step index, the rollout count, the
rollouts per step and all four rates are recomputed from the table and compared
against the shipped `run-series.json` element by element.

The transition fit regenerates independently. A four-parameter logistic is
fitted to the per-step hack rate by grid descent, and its midpoint, 10-to-90
width and R2 are printed beside the frozen ledger's. They are two fits, not one
number checked twice, and the printed difference is the honest measure of how
much the fit's own conventions matter.

THE DETECTOR ALARMS DO NOT REGENERATE FROM THIS TABLE, AND NOTHING HERE
PRETENDS THEY DO. The table carries `length`, `reasoning_length`,
`training_passed`, `passed`, `thinking_format_ok` and `step`. It carries no
reward and no group index, so a within-group reward variance cannot be formed
from it, and the gradient-norm comparator needs optimiser telemetry the public
table does not publish. Row R3, in this bundle, records exactly that. The alarm
steps come from the frozen ledger row and are printed with it.
"""

import json
import math

import numpy as np

WIDTH_10_90 = 2.0 * math.log(9.0)


def logistic(x, low, high, midpoint, scale):
    return low + (high - low) / (1.0 + np.exp(-(x - midpoint) / scale))


def fit(x, y):
    """Grid descent on (midpoint, scale) with low and high solved in closed form.

    Deterministic and dependency-free by construction: no optimiser, no seed,
    no starting point anybody has to agree on. Coarse to fine, five passes.
    """
    best = None
    midpoints = np.linspace(x.min(), x.max(), 200)
    scales = np.linspace(0.5, (x.max() - x.min()) / 4.0, 200)
    for _ in range(5):
        for midpoint in midpoints:
            shape = 1.0 / (1.0 + np.exp(np.clip(-(x - midpoint) / scales[:, None], -700, 700)))
            for index in range(shape.shape[0]):
                s = shape[index]
                design = np.stack([np.ones_like(s), s], axis=1)
                coefficients, *_ = np.linalg.lstsq(design, y, rcond=None)
                residual = float(((design @ coefficients - y) ** 2).sum())
                if best is None or residual < best[0]:
                    best = (residual, midpoint, scales[index], coefficients)
        _, midpoint, scale, _ = best
        span_m = (midpoints[-1] - midpoints[0]) / 8.0
        span_s = (scales[-1] - scales[0]) / 8.0
        midpoints = np.linspace(midpoint - span_m, midpoint + span_m, 60)
        scales = np.linspace(max(scales[0], scale - span_s), scale + span_s, 60)
    residual, midpoint, scale, coefficients = best
    low, high = float(coefficients[0]), float(coefficients[0] + coefficients[1])
    r2 = 1.0 - residual / float(((y - y.mean()) ** 2).sum())
    return low, high, float(midpoint), float(scale), r2


def main():
    table = np.load("aisi_lengths.npz")
    shipped = json.load(open("run-series.json", encoding="utf-8"))

    step = table["step"]
    steps = np.unique(step)
    masks = {int(s): step == s for s in steps}

    def rate(column):
        values = table[column]
        return [round(float(values[masks[int(s)]].mean()), 6) for s in steps]

    series = {
        "hackRate": rate("passed"),
        "written": rate("passed"),
        "realized": rate("training_passed"),
        "formatOk": rate("thinking_format_ok"),
    }

    print(f"rollouts in the table       {step.size}")
    print(f"rollouts in run-series.json {shipped['meta']['rolloutCount']}")
    print(f"distinct step indices       {len(steps)}  ({steps.min()} to {steps.max()})")
    print(f"rollouts per step           {int(np.bincount(step).max())}")
    print(f"step count the site states  {shipped['meta']['stepCount']}")
    print()
    for name, values in sorted(series.items()):
        same = values == shipped["series"][name]
        print(f"series {name:10s} {len(values):4d} points   matches run-series.json: {str(same).lower()}")

    y = np.asarray(series["hackRate"], dtype=float)
    x = steps.astype(float)
    low, high, midpoint, scale, r2 = fit(x, y)
    frozen = shipped["transition"]
    print()
    print("                       this fit    frozen ledger")
    print(f"transition midpoint    {midpoint:8.4f}    {frozen['midpoint']:8.4f}")
    print(f"10-to-90 width         {scale * WIDTH_10_90:8.4f}    {frozen['width1090']:8.4f}")
    print(f"R2                     {r2:8.5f}    {frozen['r2']:8.5f}")
    print(f"floor and ceiling      {low:.4f} to {high:.4f}")
    print()
    print("detector alarms, from the frozen ledger row in this bundle, not refitted here")
    for detector in shipped["detectors"]:
        alarm = "no alarm" if detector["alarmStep"] is None else f"step {detector['alarmStep']}"
        lead = "" if detector["leadWidths"] is None else f"  lead {detector['leadWidths']:+.3f} widths"
        shipped_mark = "  <- shipped" if detector["shipped"] else ""
        print(f"  {detector['key']:22s} {alarm:10s}{lead}{shipped_mark}")


if __name__ == "__main__":
    main()
