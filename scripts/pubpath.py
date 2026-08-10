"""Turn local filesystem paths into public-facing ones, before they are written.

Every file under src/data/ is generated, committed, and read at build time into
rendered HTML. Several generators record where they read something from, and the
honest answer on this machine is an absolute path under /home/suhail-nadaf. That
answer is worse than useless in public: it names a person, it names a directory
layout nobody else has, and it cannot be checked by a reader. Three grader-card
subjects shipped exactly that string.

The fix belongs here rather than at each field, because the failure is not that
one field was written carelessly. It is that any field carrying a path will leak
one. `redact()` therefore runs over the whole payload in write_json, so a field
added next year is covered without anybody remembering this file exists.

WHAT THE TRANSFORM IS

Ordered prefix substitutions over every string, longest and most specific first.
Deterministic by construction: no clock, no cwd, no environment, no git. The same
payload produces the same bytes on any machine and in any worktree.

    <final>/assay-recon/frameworks/<project>/  ->  (removed)
        A vendored third-party checkout. Dropping the checkout AND the project
        directory leaves the path as it reads inside the upstream project, which
        is the form a reader can look up:
            .../frameworks/swebench/swebench/harness/grading.py
                -> swebench/harness/grading.py
            .../frameworks/verl/verl/utils/reward_score/gsm8k.py
                -> verl/utils/reward_score/gsm8k.py
        The subject strings already carry the project name and version in their
        parenthetical ("swebench 4.1.0, sha256 ..."), so nothing is lost.

    <final>/reward-lens--github/reward-lens-{assay,clean}/  ->  reward-lens/
        Two local checkouts of one public repository. They must not produce two
        different public strings for the same file.

    <final>/reward-lens--github/site/[.claude/worktrees/<name>/]  ->  site/
        The site checkout, and any worktree of it. The optional worktree segment
        is why this rule exists at all: without it the same build run from
        .claude/worktrees/w0-release and from the canonical checkout would emit
        different data, and the branch name would ship.

    <final>/  ->  (removed)
        Everything else under the working root keeps its shape relative to it:
            <final>/campaign-results/figures/hump.dark.png
                -> campaign-results/figures/hump.dark.png

A `file://` scheme is stripped first so a URL-shaped path is redacted like a path.

WHAT IT REFUSES TO DO

If a string still holds a home-directory path after all rules run, this raises
rather than emitting it or quietly dropping it. A path outside the known roots is
a generator reading somewhere new, and the person to decide what its public form
should be is the one making that change, not this module guessing. scripts/checks/
paths.mjs is the independent backstop over the written files and dist/.
"""

from __future__ import annotations

import re
from pathlib import Path

#: The working root every known source lives under. Same literal the generators
#: already carry as FINAL; repeated rather than imported so this module has no
#: dependency on which generator loaded it.
FINAL = "/home/suhail-nadaf/final-reward"

_F = re.escape(FINAL)

#: (pattern, replacement), applied in order. Order is load-bearing: the generic
#: `<final>/` rule last would otherwise swallow every specific one above it.
_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(rf"{_F}/assay-recon/frameworks/[^/\s]+/"), ""),
    (re.compile(rf"{_F}/reward-lens--github/reward-lens-(?:assay|clean|release)/"), "reward-lens/"),
    (
        re.compile(rf"{_F}/reward-lens--github/site/(?:\.claude/worktrees/[^/\s]+/)?"),
        "site/",
    ),
    (re.compile(rf"{_F}/"), ""),
)

#: What must never survive into a generated file. Checked after the rules run.
_LOCAL = re.compile(r"(?:file://|/home/|/Users/|/root/)")


class LocalPathLeak(RuntimeError):
    """A string held a local path no rule in _RULES knows how to publish."""


def redact_text(text: str, *, where: str = "") -> str:
    """Apply the substitutions to one string. Raises if a local path survives."""
    out = text.replace("file://", "")
    for pattern, replacement in _RULES:
        out = pattern.sub(replacement, out)
    if _LOCAL.search(out):
        raise LocalPathLeak(
            f"a local filesystem path would have been written into generated site data"
            f"{f' at {where}' if where else ''}:\n"
            f"  {text}\n"
            f"  after redaction: {out}\n"
            f"No rule in scripts/pubpath.py covers this root. Add one that states what "
            f"the public form of this path is; do not delete the field, and do not "
            f"widen the check."
        )
    return out


def redact(node, *, where: str = "$"):
    """Recursively redact every string in a JSON-shaped value. Keys included:
    a dict keyed by absolute path leaks exactly as much as a value holding one."""
    if isinstance(node, str):
        return redact_text(node, where=where)
    if isinstance(node, list):
        return [redact(v, where=f"{where}[{i}]") for i, v in enumerate(node)]
    if isinstance(node, dict):
        return {
            redact_text(k, where=f"{where}.{k}") if isinstance(k, str) else k: redact(
                v, where=f"{where}.{k}"
            )
            for k, v in node.items()
        }
    return node
