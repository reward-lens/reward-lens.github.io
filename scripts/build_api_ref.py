#!/usr/bin/env python3
"""Build-time API reference pipeline for the reward-lens website.

Replaces the 14 mkdocstrings-driven reference pages with statically-extracted
symbol documentation. griffe parses the *clean* source at the pinned commit
(no import, no torch, no GPU), and we emit one JSON per reference group plus a
prose-segment map that records where each symbol renders inside the authored
prose.

Outputs (all under site/src/data/api/):
  <group>.json          symbols for a group (core, stats, ... , legacy)
  _prose/<group>.json   ordered prose/symbol segments for the group's page
  index.json            group index metadata (for the reference landing page)

Run:  /home/suhail-nadaf/final-reward/.venv/bin/python scripts/build_api_ref.py
"""

from __future__ import annotations

import json
import os
import posixpath
import re
import sys
from collections import OrderedDict

import griffe
from griffe import DocstringSectionKind as K

# --------------------------------------------------------------------------- #
# Paths and constants
# --------------------------------------------------------------------------- #

CLEAN = "/home/suhail-nadaf/final-reward/reward-lens--github/reward-lens-clean"
SRC = os.path.join(CLEAN, "src")
REFDIR = os.path.join(CLEAN, "docs/content/reference")

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(SITE, "src/data/api")
PROSE_OUT = os.path.join(OUT, "_prose")

# The change detector's recording half. See tests/regression/observe.py.
sys.path.insert(0, os.path.join(SITE, "tests", "regression"))
from observe import Observations  # noqa: E402

PIN = "bceb2986ab54a9fcd8d39e3550f4b089e90cd7d6"
BLOB = f"https://github.com/reward-lens/reward-lens/blob/{PIN}"

# The 13 symbol groups mirror the 13 reference *.md pages (index handled apart).
GROUPS = [
    "core", "stats", "signals", "data", "measure", "interventions", "geometry",
    "concepts", "organisms", "dynamics-loops", "studies", "artifacts-operate",
    "legacy",
]

# v1 lazy accessor mapping, read from reward_lens/__init__.py _LAZY. These
# top-level names resolve to their defining modules; documented under Legacy.
LAZY = OrderedDict([
    ("RewardModel", "reward_lens.model"),
    ("ActivationCache", "reward_lens.model"),
    ("BatchedActivationCache", "reward_lens.model"),
    ("RewardLens", "reward_lens.lens"),
    ("reward_lens_plot", "reward_lens.lens"),
    ("ComponentAttribution", "reward_lens.attribution"),
    ("ActivationPatcher", "reward_lens.patching"),
    ("PathPatcher", "reward_lens.path_patching"),
    ("PathPatchResult", "reward_lens.path_patching"),
    ("DistortionAnalyzer", "reward_lens.distortion"),
    ("DistortionReport", "reward_lens.distortion"),
    ("DivergenceAwarePatching", "reward_lens.divergence_patching"),
    ("DivergenceAwarePatchingResult", "reward_lens.divergence_patching"),
    ("MisalignmentCascadeDetector", "reward_lens.cascade"),
    ("CascadeReport", "reward_lens.cascade"),
    ("RewardConflictAnalyzer", "reward_lens.conflict"),
    ("ConflictReport", "reward_lens.conflict"),
    ("quick_conflict_check", "reward_lens.conflict"),
    ("ConceptExtractor", "reward_lens.concepts"),
    ("ConceptAlignmentReport", "reward_lens.concepts"),
    ("quick_concept_analysis", "reward_lens.concepts"),
])
# Named in legacy prose but not in _LAZY; folded into the legacy group too.
LEGACY_EXTRA = [
    ("SAETrainer", "reward_lens.sae"),
]

# --------------------------------------------------------------------------- #
# Markdown preprocessing (math delimiters + relative doc-link rewriting)
# --------------------------------------------------------------------------- #

_LINK_RE = re.compile(r"\]\(([^)\s]+)\)")


def conv_math(text: str) -> str:
    """Convert LaTeX \\(..\\) and \\[..\\] to $..$ / $$..$$ for remark-math."""
    if not text:
        return text
    text = text.replace("\\[", "$$").replace("\\]", "$$")
    text = text.replace("\\(", "$").replace("\\)", "$")
    return text


def _rewrite_target(target: str) -> str | None:
    anchor = ""
    if "#" in target:
        target, frag = target.split("#", 1)
        anchor = "#" + frag
    if not target.endswith(".md"):
        return None
    resolved = posixpath.normpath(posixpath.join("reference", target))
    if resolved.endswith("/index.md"):
        resolved = resolved[: -len("/index.md")]
    elif resolved == "index.md":
        resolved = ""
    elif resolved.endswith(".md"):
        resolved = resolved[:-3]
        if resolved.endswith("/index"):
            resolved = resolved[: -len("/index")]
    url = "/docs/" + resolved + "/" if resolved else "/docs/"
    return url + anchor


def rewrite_links(text: str) -> str:
    if not text:
        return text

    def repl(m: re.Match) -> str:
        new = _rewrite_target(m.group(1))
        return "](" + new + ")" if new else m.group(0)

    return _LINK_RE.sub(repl, text)


def prep(text: str) -> str:
    """Full markdown preprocessing applied to every rendered md chunk."""
    return rewrite_links(conv_math(text or ""))


# --------------------------------------------------------------------------- #
# griffe helpers
# --------------------------------------------------------------------------- #

PKG = griffe.load(
    "reward_lens",
    search_paths=[SRC],
    docstring_parser="google",
    allow_inspection=False,
)


def resolve(path: str):
    obj = PKG
    for part in path.split(".")[1:]:
        if not hasattr(obj, "members") or part not in obj.members:
            return None
        obj = obj.members[part]
    return obj


def rel_source(obj):
    """Return {file, start, end, url} for an object, or None if no location."""
    fp = getattr(obj, "filepath", None)
    start = getattr(obj, "lineno", None)
    if fp is None or not start:
        return None
    fp = str(fp)
    marker = os.sep + "src" + os.sep
    idx = fp.find(marker)
    rel = "src/" + fp[idx + len(marker):].replace(os.sep, "/") if idx >= 0 else fp
    end = getattr(obj, "endlineno", None) or start
    url = f"{BLOB}/{rel}#L{start}"
    if end and end != start:
        url += f"-L{end}"
    return {"file": rel, "start": start, "end": end, "url": url}


def ann_str(annotation):
    if annotation is None:
        return None
    s = str(annotation)
    # A whole-string forward reference ("Foo | Bar") displays cleaner unquoted.
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ("'", '"') and s[0] not in s[1:-1]:
        s = s[1:-1]
    return s


def _fmt_param(p) -> str:
    s = p.name
    if p.annotation is not None:
        s += ": " + ann_str(p.annotation)
    if p.default is not None:
        s += " = " + str(p.default)
    return s


def build_signature(func, name: str) -> str:
    """Reconstruct a call signature string from griffe parameters (no faking)."""
    params = [p for p in func.parameters if p.name not in ("self", "cls")]
    tokens: list[str] = []
    inserted_star = False
    for i, p in enumerate(params):
        kind = p.kind.value
        if kind == "positional-only":
            tokens.append(_fmt_param(p))
            nxt = params[i + 1].kind.value if i + 1 < len(params) else None
            if nxt != "positional-only":
                tokens.append("/")
        elif kind == "positional or keyword":
            tokens.append(_fmt_param(p))
        elif kind == "variadic positional":
            tokens.append("*" + _fmt_param(p))
            inserted_star = True
        elif kind == "keyword-only":
            if not inserted_star:
                tokens.append("*")
                inserted_star = True
            tokens.append(_fmt_param(p))
        elif kind == "variadic keyword":
            tokens.append("**" + _fmt_param(p))
    ret = ""
    if getattr(func, "returns", None) is not None:
        ret = " -> " + ann_str(func.returns)
    oneline = f"{name}(" + ", ".join(tokens) + ")" + ret
    if len(oneline) <= 88 or not tokens:
        return oneline
    body = ",\n".join("    " + t for t in tokens)
    return f"{name}(\n{body}\n)" + ret


def first_text(obj) -> str | None:
    if not obj.docstring:
        return None
    for s in obj.docstring.parsed:
        if s.kind == K.text:
            return prep(s.value)
    return None


def parse_docstring(obj) -> dict:
    """Extract text / parameters / returns / raises / examples / admonitions."""
    out = {
        "text": None, "params": [], "returns": [], "raises": [],
        "examples": [], "admonitions": [], "attributes_doc": [],
    }
    if not obj.docstring:
        return out
    for s in obj.docstring.parsed:
        if s.kind == K.text:
            out["text"] = prep(s.value)
        elif s.kind == K.parameters:
            for p in s.value:
                out["params"].append({
                    "name": p.name,
                    "annotation": ann_str(p.annotation),
                    "default": None if p.default is None else str(p.default),
                    "description": prep(p.description or ""),
                })
        elif s.kind == K.returns:
            for r in s.value:
                out["returns"].append({
                    "name": getattr(r, "name", None) or None,
                    "annotation": ann_str(r.annotation),
                    "description": prep(r.description or ""),
                })
        elif s.kind == K.raises:
            for r in s.value:
                out["raises"].append({
                    "annotation": ann_str(r.annotation),
                    "description": prep(r.description or ""),
                })
        elif s.kind == K.attributes:
            for a in s.value:
                out["attributes_doc"].append({
                    "name": a.name,
                    "annotation": ann_str(a.annotation),
                    "description": prep(a.description or ""),
                })
        elif s.kind == K.examples:
            # value is a list of (kind, text) tuples in griffe
            for item in s.value:
                txt = item[1] if isinstance(item, (list, tuple)) and len(item) > 1 else str(item)
                out["examples"].append(txt)
        elif s.kind == K.admonition:
            title = getattr(s, "title", None)
            val = s.value
            contents = getattr(val, "contents", None)
            if contents is None:
                contents = str(val)
            out["admonitions"].append({
                "title": title or getattr(val, "kind", "note"),
                "text": prep(contents),
            })
    return out


def is_enum(cls) -> bool:
    return any("Enum" in str(b) for b in getattr(cls, "bases", []))


def member_detail(m) -> dict:
    """Detail for a method member of a class."""
    return {
        "name": m.name,
        "kind": m.kind.value,
        "signature": build_signature(m, m.name),
        "text": first_text(m),
        "source": rel_source(m),
    }


def is_dataclass(cls) -> bool:
    return any("dataclass" in str(d.value) for d in getattr(cls, "decorators", []))


def class_members(cls, doc_attrs: dict) -> dict:
    """Split a class's public members into fields / properties / methods / enum.

    Data attributes are surfaced as "fields" only where they are genuinely API:
    every declared field of a dataclass, and, on a plain class, attributes that
    are pure annotated declarations (e.g. a Protocol contract). Internal
    instance assignments on ordinary classes are left out of the surface.
    """
    is_dc, is_en = is_dataclass(cls), is_enum(cls)
    fields, properties, methods, enum_members = [], [], [], []
    for name, m in cls.members.items():
        if name.startswith("_"):
            continue
        labels = set(getattr(m, "labels", set()) or set())
        if m.kind.value == "attribute":
            annotation = ann_str(getattr(m, "annotation", None))
            value = str(m.value) if getattr(m, "value", None) is not None else None
            entry = {
                "name": name,
                "annotation": annotation,
                "value": value,
                "description": doc_attrs.get(name, ""),
            }
            if "property" in labels:
                if m.docstring:
                    entry["description"] = first_text(m) or entry["description"]
                properties.append(entry)
            elif is_en:
                enum_members.append(entry)
            elif is_dc:
                fields.append(entry)
            elif annotation is not None and value is None:
                fields.append(entry)
        elif m.kind.value in ("function", "method"):
            methods.append(member_detail(m))
    return {
        "fields": fields,
        "properties": properties,
        "methods": methods,
        "enum_members": enum_members,
    }


def extract_symbol(path: str, display_name: str | None = None) -> dict:
    obj = resolve(path)
    if obj is None:
        return {
            "path": path,
            "name": display_name or path.rsplit(".", 1)[-1],
            "kind": "unresolved",
            "poor": True,
            "poor_reason": "unresolved",
        }
    # Follow aliases to the real object for accurate source / members.
    if getattr(obj, "is_alias", False):
        try:
            obj = obj.final_target
        except Exception:
            pass
    name = display_name or obj.name
    kind = obj.kind.value
    ds = parse_docstring(obj)
    doc = {"attributes_doc": {a["name"]: a["description"] for a in ds["attributes_doc"]}}
    sym = {
        "path": path,
        "name": name,
        "kind": kind,
        "text": ds["text"],
        "params": ds["params"],
        "returns": ds["returns"],
        "raises": ds["raises"],
        "examples": ds["examples"],
        "admonitions": ds["admonitions"],
        "source": rel_source(obj),
        "signature": None,
        "bases": None,
        "decorators": None,
        "members": None,
        "attribute": None,
        "poor": False,
    }

    if kind in ("function", "method"):
        sym["signature"] = build_signature(obj, name)
    elif kind == "attribute":
        sym["attribute"] = {
            "annotation": ann_str(getattr(obj, "annotation", None)),
            "value": (str(obj.value) if getattr(obj, "value", None) is not None else None),
        }
    elif kind == "class":
        sym["bases"] = [str(b) for b in getattr(obj, "bases", [])]
        sym["decorators"] = [str(d.value) for d in getattr(obj, "decorators", [])]
        sym["is_enum"] = is_enum(obj)
        members = class_members(obj, doc["attributes_doc"])
        sym["members"] = members
        # A hand-written __init__ (real source line) gives an accurate
        # constructor signature; synthesized dataclass __init__ (lineno 0) does
        # not carry field defaults, so we rely on the fields table instead.
        init = obj.members.get("__init__")
        if init is not None and getattr(init, "lineno", 0):
            params = [p for p in init.parameters if p.name not in ("self", "cls")]
            if params:
                sym["signature"] = build_signature(init, name)

    # Poor-output flag: no docstring text and nothing structured to show.
    has_body = bool(
        sym["text"] or sym["params"] or sym["returns"]
        or (sym["members"] and any(sym["members"].values()))
        or (sym["attribute"] and (sym["attribute"]["value"] or sym["attribute"]["annotation"]))
    )
    if not sym["text"]:
        sym["poor"] = True
        sym["poor_reason"] = "no docstring text" + ("" if has_body else "; sparse")
    return sym


# --------------------------------------------------------------------------- #
# Reference-page parsing (prose segments + directive order)
# --------------------------------------------------------------------------- #

DIRECTIVE_RE = re.compile(r"^:::\s+(\S+)\s*$")


def parse_reference_page(md_path: str):
    """Return (title, segments, directive_paths) for a symbol reference page.

    Segments are {'type':'prose','markdown':...} or {'type':'symbol','path':...}
    in document order. Directive option blocks (indented) are dropped.
    """
    lines = open(md_path, encoding="utf-8").read().split("\n")
    title = None
    segments = []
    directives = []
    buf: list[str] = []
    i = 0
    n = len(lines)

    def flush():
        if buf:
            text = "\n".join(buf).strip("\n")
            if text.strip():
                segments.append({"type": "prose", "markdown": prep(text)})
            buf.clear()

    while i < n:
        line = lines[i]
        if title is None:
            m = re.match(r"^#\s+(.*\S)\s*$", line)
            if m:
                title = m.group(1)
                i += 1  # page header is rendered separately; drop the H1
                continue
        dm = DIRECTIVE_RE.match(line)
        if dm:
            flush()
            path = dm.group(1)
            directives.append(path)
            segments.append({"type": "symbol", "path": path})
            i += 1
            # Skip the directive's indented options block (and blank lines
            # that belong to it) until the next non-indented content line.
            while i < n:
                nxt = lines[i]
                if nxt.strip() == "" or nxt[:1] in (" ", "\t"):
                    i += 1
                    continue
                break
            continue
        buf.append(line)
        i += 1
    flush()
    return title or os.path.basename(md_path), segments, directives


def parse_index_page(md_path: str):
    """Parse index.md: intro prose + a grid-cards block of group links."""
    raw = open(md_path, encoding="utf-8").read()
    title_m = re.search(r"^#\s+(.*\S)\s*$", raw, re.M)
    title = title_m.group(1) if title_m else "API reference"
    # Split intro (before the grid) from the card block.
    div_idx = raw.find('<div class="grid cards"')
    intro = raw[:div_idx] if div_idx >= 0 else raw
    # Drop the leading H1 from the intro (rendered as the page header instead).
    intro = re.sub(r"^#\s+.*\n", "", intro, count=1)
    card_block = raw[div_idx:] if div_idx >= 0 else ""

    cards = []
    # Each card: -   __[Title](href.md)__  then indented description lines.
    card_re = re.compile(r"-\s+__\[([^\]]+)\]\(([^)]+)\)__\s*\n(.*?)(?=\n-\s+__|\n</div>)",
                         re.S)
    for m in card_re.finditer(card_block):
        ctitle = m.group(1).strip()
        href = _rewrite_target(m.group(2)) or m.group(2)
        desc = " ".join(l.strip() for l in m.group(3).strip().split("\n") if l.strip())
        cards.append({"title": ctitle, "href": href, "description": prep(desc)})

    segments = [{"type": "prose", "markdown": prep(intro.strip())},
                {"type": "cards", "cards": cards}]
    return title, segments


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PROSE_OUT, exist_ok=True)

    all_directives = []
    covered_paths = set()
    poor = []
    per_group_counts = OrderedDict()
    index_meta = []

    # --- index page -------------------------------------------------------- #
    idx_title, idx_segments = parse_index_page(os.path.join(REFDIR, "index.md"))
    json.dump(
        {"group": "index", "title": idx_title, "segments": idx_segments},
        open(os.path.join(PROSE_OUT, "index.json"), "w"), indent=2,
    )

    # --- 13 symbol groups -------------------------------------------------- #
    for group in GROUPS:
        md_path = os.path.join(REFDIR, group + ".md")
        title, segments, directives = parse_reference_page(md_path)
        all_directives.extend(directives)

        # Order of symbols: first appearance in the page, then legacy extras.
        ordered_paths = list(OrderedDict.fromkeys(directives))
        symbols = OrderedDict()
        for path in ordered_paths:
            sym = extract_symbol(path)
            symbols[path] = sym
            covered_paths.add(path)
            if sym.get("poor"):
                poor.append((group, path, sym.get("poor_reason", "")))

        # Legacy group: append the lazy v1 accessor names + prose-named extras.
        if group == "legacy":
            # A short factual divider before the lazy accessor catalogue.
            segments.append({
                "type": "prose",
                "markdown": (
                    "## The lazy top-level names\n\n"
                    "These are the 1.0 symbols in the package's `_LAZY` map. Each "
                    "is reachable from the top level (`from reward_lens import "
                    "RewardModel`) and under the explicit `reward_lens.legacy` "
                    "namespace; both resolve to the defining module named below on "
                    "first access."
                ),
            })
            lazy_items = list(LAZY.items()) + LEGACY_EXTRA
            for name, mod in lazy_items:
                full = f"{mod}.{name}"
                if full in symbols:
                    continue
                sym = extract_symbol(full, display_name=name)
                if name in LAZY:  # a true top-level lazy accessor name
                    sym["lazy_via"] = f"reward_lens.{name}"
                symbols[full] = sym
                covered_paths.add(full)
                ordered_paths.append(full)
                segments.append({"type": "symbol", "path": full})
                if sym.get("poor"):
                    poor.append((group, full, sym.get("poor_reason", "")))

        # Write group symbol JSON + prose segment JSON.
        json.dump(
            {
                "group": group,
                "title": title,
                "order": ordered_paths,
                "symbols": symbols,
            },
            open(os.path.join(OUT, group + ".json"), "w"), indent=2,
        )
        json.dump(
            {"group": group, "title": title, "segments": segments},
            open(os.path.join(PROSE_OUT, group + ".json"), "w"), indent=2,
        )

        per_group_counts[group] = {
            "directives": len(directives),
            "symbols": len(symbols),
        }
        index_meta.append({
            "group": group, "title": title, "symbols": len(symbols),
            "href": f"/docs/reference/{group}/",
        })

    # --- index metadata for the landing page ------------------------------- #
    json.dump(
        {"title": idx_title, "groups": index_meta},
        open(os.path.join(OUT, "index.json"), "w"), indent=2,
    )

    # --- invariants + report ----------------------------------------------- #
    directive_set = set(all_directives)
    missing = directive_set - covered_paths
    print("=" * 60)
    print("reward-lens API reference build")
    print("=" * 60)
    print(f"directives found in 14 pages : {len(all_directives)}")
    print(f"unique directive paths       : {len(directive_set)}")
    print(f"directive paths covered      : {len(directive_set & covered_paths)}")
    print(f"total symbols rendered       : {len(covered_paths)}")
    print("-" * 60)
    print(f"{'group':22} {'directives':>10} {'symbols':>8}")
    for g, c in per_group_counts.items():
        print(f"{g:22} {c['directives']:>10} {c['symbols']:>8}")
    print("-" * 60)
    if poor:
        print(f"symbols with poor griffe output ({len(poor)}):")
        for g, p, why in poor:
            print(f"  [{g}] {p}  ({why})")
    else:
        print("no symbols with poor griffe output")
    print("-" * 60)

    # Structural: every directive the prose names must resolve to a symbol.
    # This one carries no measurement and it stays, because an unresolved
    # directive renders a reference page with a hole in it.
    assert not missing, f"UNCOVERED directives: {sorted(missing)}"

    # The directive count was `assert len(all_directives) == 152`. It measures
    # the size of the v2 reference corpus, so DECISIONS.md D-04 moves it the
    # moment the pipeline repoints at the assay tree. Recorded, and compared by
    # tests/regression/known-values.test.mjs after generation.
    obs = Observations("build_api_ref", "scripts/build_api_ref.py")
    obs.record("directives", len(all_directives))
    obs.record("unique_directive_paths", len(directive_set))
    obs.record("symbols_rendered", len(covered_paths))
    obs.record("groups", len(index_meta))
    obs.record("symbols_by_group", {g: c["symbols"] for g, c in sorted(per_group_counts.items())})
    obs.record("poor_griffe_output", len(poor))
    obs.record("source_tree", "/".join(CLEAN.rstrip("/").split("/")[-1:]))
    obs.write()
    print(f"all directives resolved; {len(obs.values)} measurements recorded to {obs.path()}")
    print("compare them: node --test tests/regression/known-values.test.mjs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
