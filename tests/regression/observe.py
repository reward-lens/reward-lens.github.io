"""The recording half of the change detector.

A generator computes. It does not carry the answers. Every count, total and
headline value a generator used to assert against an inline literal is now
*recorded* here instead, and `tests/regression/known-values.json` holds the
value that was true when a human last looked. `known-values.test.mjs` compares
the two after generation and fails loudly on any difference.

The distinction is the whole point (DECISIONS.md D-08). Inside a generator a
constant makes the pipeline confirm itself: the code that produces the number
and the code that checks it are the same edit. Outside it, in a test that runs
after generation, the same constant is a tripwire.

What stays in the generator: structural invariants that carry no measurement.
"this spec file exists", "the parsed kill notes cover exactly the kills the
ledger found", "every ported page appears in the navigation". Those are true of
any correct corpus and they fail on a broken run rather than on a changed one.

What moves here: anything of the form `n == <literal>`.

Usage:

    from observe import Observations
    obs = Observations("build_data")
    obs.record("evidence_store_records", n_records)
    ...
    obs.write()

The output lands at `tests/regression/observed/<generator>.json` and is
committed, because CI does not have the campaign store and re-checks the
committed projections rather than regenerating them.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
OBSERVED = HERE / "observed"


class Observations:
    """One generator's measurements, written once at the end of its run."""

    def __init__(self, generator: str, source: str) -> None:
        self.generator = generator
        self.source = source
        self.values: dict[str, Any] = {}

    def record(self, key: str, value: Any) -> Any:
        """Record one measurement and return it, so a call can wrap an expression."""
        if key in self.values:
            raise KeyError(
                f"{self.generator}: '{key}' recorded twice. Two measurements sharing a "
                f"key means one of them is invisible to the change detector."
            )
        self.values[key] = value
        return value

    def path(self) -> Path:
        return OBSERVED / f"{self.generator}.json"

    def write(self) -> Path:
        """Write the observation file. No timestamp: a change detector's diff
        should show a changed measurement and nothing else."""
        OBSERVED.mkdir(parents=True, exist_ok=True)
        out = self.path()
        out.write_text(
            json.dumps(
                {
                    "generator": self.generator,
                    "source": self.source,
                    "values": self.values,
                },
                indent=1,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        return out
