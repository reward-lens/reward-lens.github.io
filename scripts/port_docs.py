#!/usr/bin/env python3
"""Mechanical port of the MkDocs docs corpus into Astro content collections.

Run:  /home/suhail-nadaf/final-reward/.venv/bin/python scripts/port_docs.py

Idempotent: wipes and regenerates src/content/docs/ on every run, and rewrites
src/data/docs-nav.json and src/data/redirects.json. No prose is rewritten; only
delimiters, admonition/figure wrappers, links, and icon tokens are transformed.
Everything else passes through byte-identical.
"""
import os
import re
import json
import shutil
import glob as globmod

import yaml

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
LIB = "/home/suhail-nadaf/final-reward/reward-lens--github/reward-lens-clean/docs"
CONTENT = os.path.join(LIB, "content")
MKDOCS = os.path.join(LIB, "mkdocs.yml")
SITE = "/home/suhail-nadaf/final-reward/reward-lens--github/site"
DST = os.path.join(SITE, "src", "content", "docs")
DATA = os.path.join(SITE, "src", "data")

# Pages we do NOT port: the 14 reference/*.md (replaced by an API pipeline) and
# index.md (replaced by a portal page). Redirects still cover all of them.
def is_reference(rel):
    return rel.startswith("reference/")

def is_root_index(rel):
    return rel == "index.md"

# ---------------------------------------------------------------------------
# Diagnostics collected across the run
# ---------------------------------------------------------------------------
admon_types_seen = {}
attr_tokens_stripped = {}   # token -> set(files)
brace_escapes = []          # (file, note)
katex_hand_fixes = []       # documented post-edit fixes

# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------
def navpath(rel):
    """content-root-relative md path -> path segment used in /docs/<seg>/ (index collapses to its dir)."""
    p = rel[:-3] if rel.endswith(".md") else rel
    if os.path.basename(p) == "index":
        p = os.path.dirname(p)
    return p  # '' for the root index

def url_docs(rel):
    """Nav/link URL for a content-root-relative md path. Root index -> /docs/."""
    seg = navpath(rel)
    return "/docs/" + (seg + "/" if seg else "")

def redirect_new(rel):
    """New-site URL for the redirect map. Root index -> / (homepage), else /docs/<seg>/."""
    if is_root_index(rel):
        return "/"
    seg = navpath(rel)
    return "/docs/" + (seg + "/" if seg else "")

def redirect_old(rel):
    """Old MkDocs directory-style URL: page.md -> /reward-lens/page/, section/index.md -> /reward-lens/section/."""
    seg = navpath(rel)
    return "/reward-lens/" + (seg + "/" if seg else "")

def resolve_link(url, filedir):
    """Convert a relative .md link (target of [text](url)) to an absolute /docs/ URL.
    filedir is the current file's dir relative to content (e.g. 'instruments' or '')."""
    if url.startswith(("http://", "https://", "mailto:", "//", "#")):
        return url
    if ".md" not in url:
        return url  # svg image paths, etc. — leave unchanged
    anchor = ""
    if "#" in url:
        url, anchor = url.split("#", 1)
        anchor = "#" + anchor
    if not url.endswith(".md"):
        return url + anchor  # not actually an .md target
    # Resolve relative to the file's directory, within content root.
    joined = os.path.normpath(os.path.join(filedir, url)) if filedir else os.path.normpath(url)
    joined = joined.replace(os.sep, "/")
    if joined.startswith("../"):
        # Escapes the content root (repo README etc.) — leave unchanged.
        return url + anchor
    return url_docs(joined) + anchor

# ---------------------------------------------------------------------------
# Attribute-value escaping for JSX (alt=, title=)
# ---------------------------------------------------------------------------
def esc_attr(s):
    s = s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
    s = s.replace("{", "&#123;")
    return s

# ---------------------------------------------------------------------------
# Admonition type mapping
# ---------------------------------------------------------------------------
TYPE_MAP = {
    "note": "note", "info": "info", "tip": "tip",
    "warning": "warn",
    "important": "important", "danger": "important", "caution": "important",
}
def map_admon(t):
    return TYPE_MAP.get(t, "note")

# ---------------------------------------------------------------------------
# Inline code splitting (respects backtick runs)
# ---------------------------------------------------------------------------
def split_code(line):
    """Split a line into [(is_code, text), ...] honoring backtick-run inline code."""
    parts = []
    i = 0
    n = len(line)
    while i < n:
        m = re.compile(r"`+").search(line, i)
        if not m:
            parts.append((False, line[i:]))
            break
        op, oe = m.start(), m.end()
        run = oe - op
        # find a closing run of exactly `run` backticks
        j = oe
        close = -1
        while j <= n:
            c = line.find("`" * run, j)
            if c == -1:
                break
            before = line[c - 1] if c > 0 else ""
            after = line[c + run] if c + run < n else ""
            if before != "`" and after != "`":
                close = c
                break
            j = c + run
        if close == -1:
            # unterminated — treat rest as prose
            parts.append((False, line[i:]))
            break
        if op > i:
            parts.append((False, line[i:op]))
        parts.append((True, line[op:close + run]))
        i = close + run
    return parts

# ---------------------------------------------------------------------------
# Link + icon conversion (whole-line; safe because link/icon syntax never
# appears inside inline code in this corpus, verified).
# ---------------------------------------------------------------------------
def convert_links_icons(line, filedir, thisfile):
    def link_repl(m):
        text, url = m.group(1), m.group(2)
        return "[%s](%s)" % (text, resolve_link(url, filedir))
    line = re.sub(r"\[([^\]]*)\]\(([^)]+)\)", link_repl, line)

    def note_attr(tok):
        attr_tokens_stripped.setdefault(tok, set()).add(thisfile)

    # material icon tokens
    for m in re.findall(r":material-[a-z0-9-]+:", line):
        note_attr(m)
    line = re.sub(r":material-[a-z0-9-]+:", "", line)
    # attr_list annotations
    for pat, tok in ((r"\{\s*\.lg\s*\}", "{ .lg }"),
                     (r"\{\s*\.annotate\s*\}", "{ .annotate }")):
        if re.search(pat, line):
            note_attr(tok)
        line = re.sub(pat, "", line)
    for m in re.findall(r"\{\s*\.md-button[^}]*\}", line):
        note_attr(m.strip())
    line = re.sub(r"\{\s*\.md-button[^}]*\}", "", line)
    return line

def convert_math_delims(line):
    """Replace math delimiters outside inline code."""
    out = []
    for is_code, text in split_code(line):
        if is_code:
            out.append(text)
        else:
            text = text.replace("\\[", "$$").replace("\\]", "$$")
            text = text.replace("\\(", "$").replace("\\)", "$")
            out.append(text)
    return "".join(out)

# ---------------------------------------------------------------------------
# Structural pass: admonitions and figures
# ---------------------------------------------------------------------------
IMG_LIGHT = re.compile(r"^!\[(?P<alt>.*?)\]\((?P<path>[^)]*?)-light\.svg#only-light\)(?:\s*\{[^}]*\})?\s*$")
IMG_DARK = re.compile(r"^!\[(?P<alt>.*?)\]\((?P<path>[^)]*?)-dark\.svg#only-dark\)(?:\s*\{[^}]*\})?\s*$")
ADMON = re.compile(r'^(?P<indent>\s*)!!! (?P<type>\w+)(?:\s+"(?P<title>[^"]*)")?\s*$')

def structural(lines, thisfile):
    used_callout = False
    used_figure = False
    out = []
    i = 0
    n = len(lines)
    in_fence = False
    while i < n:
        line = lines[i]
        # fence tracking (verbatim inside)
        if re.match(r"^ *```", line):
            out.append(line)
            in_fence = not in_fence
            i += 1
            continue
        if in_fence:
            out.append(line)
            i += 1
            continue

        # figure pair
        ml = IMG_LIGHT.match(line)
        if ml and i + 1 < n:
            md = IMG_DARK.match(lines[i + 1])
            if md:
                base = os.path.basename(ml.group("path"))
                alt = ml.group("alt")
                out.append(
                    '<ThemedFigure light="/figures/docs/%s-light.svg" '
                    'dark="/figures/docs/%s-dark.svg" alt="%s" />'
                    % (base, base, esc_attr(alt))
                )
                used_figure = True
                i += 2
                # optional trailing /// caption ... /// block
                k = i
                while k < n and lines[k].strip() == "":
                    k += 1
                if k < n and lines[k].strip() == "/// caption":
                    cap = []
                    k += 1
                    while k < n and lines[k].strip() != "///":
                        cap.append(lines[k])
                        k += 1
                    if k < n:  # skip closing ///
                        k += 1
                    out.append("")
                    out.extend(cap)
                    out.append("")
                    i = k
                continue

        # admonition
        ma = ADMON.match(line)
        if ma:
            base_indent = len(ma.group("indent"))
            atype = ma.group("type")
            title = ma.group("title")
            admon_types_seen[atype] = admon_types_seen.get(atype, 0) + 1
            body = []
            j = i + 1
            while j < n:
                bl = lines[j]
                if bl.strip() == "":
                    body.append(bl)
                    j += 1
                    continue
                ind = len(bl) - len(bl.lstrip(" "))
                if ind >= base_indent + 4:
                    body.append(bl)
                    j += 1
                    continue
                break
            while body and body[-1].strip() == "":
                body.pop()
            deind = []
            for bl in body:
                if bl.strip() == "":
                    deind.append("")
                else:
                    deind.append(bl[base_indent + 4:] if len(bl) >= base_indent + 4 else bl.lstrip(" "))
            tag = '<Callout type="%s"' % map_admon(atype)
            if title is not None:
                tag += ' title="%s"' % esc_attr(title)
            tag += ">"
            out.append(tag)
            out.append("")
            out.extend(deind)
            out.append("")
            out.append("</Callout>")
            used_callout = True
            i = j
            continue

        # standalone caption block (defensive; normally consumed with a figure)
        if line.strip() == "/// caption":
            cap = []
            j = i + 1
            while j < n and lines[j].strip() != "///":
                cap.append(lines[j])
                j += 1
            if j < n:
                j += 1
            out.append("")
            out.extend(cap)
            out.append("")
            i = j
            continue

        out.append(line)
        i += 1
    return out, used_callout, used_figure

# ---------------------------------------------------------------------------
# Inline pass: math delimiters, links, icons — fence/inline-code/display-math aware
# ---------------------------------------------------------------------------
def inline_pass(lines, filedir, thisfile, is_mdx):
    out = []
    in_fence = False
    in_disp = False
    for line in lines:
        if re.match(r"^ *```", line):
            out.append(line)
            in_fence = not in_fence
            continue
        if in_fence:
            out.append(line)
            continue
        if in_disp:
            if re.match(r"^\s*\\\]\s*$", line):
                out.append("$$")
                in_disp = False
            else:
                out.append(line)  # LaTeX body verbatim
            continue
        if re.match(r"^\s*\\\[\s*$", line):
            out.append("$$")
            in_disp = True
            continue
        # normal prose line
        line = convert_links_icons(line, filedir, thisfile)
        line = convert_math_delims(line)
        if is_mdx:
            # self-close void HTML elements so MDX/JSX parses raw HTML blocks
            line = re.sub(r"<br\s*/?>", "<br />", line)
            line = re.sub(r"<hr\s*/?>", "<hr />", line)
        out.append(line)
    return out

# ---------------------------------------------------------------------------
# Frontmatter extraction
# ---------------------------------------------------------------------------
def plain_text(s):
    s = re.sub(r"`([^`]*)`", r"\1", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"__([^_]+)__", r"\1", s)
    s = re.sub(r"\*([^*]+)\*", r"\1", s)
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)
    s = s.replace("\\(", "").replace("\\)", "").replace("\\[", "").replace("\\]", "")
    s = re.sub(r"\s+", " ", s).strip()
    return s

def truncate160(s):
    if len(s) <= 160:
        return s
    cut = s[:160]
    if " " in cut:
        cut = cut[:cut.rfind(" ")]
    return cut.rstrip()

STRUCT_START = ("<", "!", "#", "|", ">", "```", "~~~", "///", ":", "-   :material")

def extract_title_desc(lines):
    # H1: first level-1 ATX heading outside a fence
    title = None
    h1_idx = None
    in_fence = False
    for idx, line in enumerate(lines):
        if re.match(r"^ *```", line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if re.match(r"^# \S", line):
            title = line[2:].strip()
            h1_idx = idx
            break
    # description: first prose paragraph after the H1
    desc = ""
    if h1_idx is not None:
        j = h1_idx + 1
        n = len(lines)
        # skip blanks / structural blocks / figures / admonitions
        while j < n:
            s = lines[j].strip()
            if s == "":
                j += 1
                continue
            if s.startswith(("<", "![", "!!!", "///", "#", "|", ">", "```", "~~~")):
                # skip this structural line/block until a blank line
                while j < n and lines[j].strip() != "":
                    j += 1
                continue
            break
        para = []
        while j < n and lines[j].strip() != "":
            para.append(lines[j].strip())
            j += 1
        desc = truncate160(plain_text(" ".join(para)))
    return title, desc

# ---------------------------------------------------------------------------
# YAML frontmatter emit
# ---------------------------------------------------------------------------
def emit_frontmatter(d):
    body = yaml.safe_dump(d, sort_keys=False, allow_unicode=True, width=100000,
                          default_flow_style=False)
    return "---\n" + body + "---\n"

# ---------------------------------------------------------------------------
# Nav parsing (permissive loader — ignore mkdocs python tags)
# ---------------------------------------------------------------------------
class NavLoader(yaml.SafeLoader):
    pass
NavLoader.add_multi_constructor("tag:yaml.org,2002:python/name:", lambda l, s, n: None)
NavLoader.add_multi_constructor("tag:yaml.org,2002:python/object/apply:", lambda l, s, n: None)

def load_nav():
    with open(MKDOCS, encoding="utf-8") as f:
        data = yaml.load(f, Loader=NavLoader)
    return data["nav"]

page_order = {}      # content-rel md path -> global nav position
_order_counter = [0]

def record_order(rel):
    if rel not in page_order:
        page_order[rel] = _order_counter[0]
    _order_counter[0] += 1

def h1_title(rel):
    try:
        for line in open(os.path.join(CONTENT, rel), encoding="utf-8"):
            if line.startswith("# "):
                return line[2:].strip()
    except OSError:
        pass
    return rel

def build_nav_nodes(items):
    nodes = []
    for it in items:
        if isinstance(it, str):
            record_order(it)
            nodes.append({"title": h1_title(it), "href": url_docs(it)})
        elif isinstance(it, dict):
            (k, v), = it.items()
            if isinstance(v, str):
                if v.startswith("http"):
                    nodes.append({"title": k, "href": v})
                else:
                    record_order(v)
                    nodes.append({"title": k, "href": url_docs(v)})
            elif isinstance(v, list):
                node = {"title": k}
                rest = v
                if v and isinstance(v[0], str):
                    record_order(v[0])
                    node["href"] = url_docs(v[0])
                    rest = v[1:]
                children = build_nav_nodes(rest)
                if children:
                    node["children"] = children
                nodes.append(node)
    return nodes

def flat_hrefs(nodes, acc):
    for nd in nodes:
        if "href" in nd:
            acc.append(nd["href"])
        if "children" in nd:
            flat_hrefs(nd["children"], acc)

# ---------------------------------------------------------------------------
# KaTeX targeted post-edit rules (applied to already-converted line stream).
# Populated only if the build turns up katex-error nodes; kept here so re-runs
# preserve any hand fix. Currently empty — no systematic KaTeX defect found.
# ---------------------------------------------------------------------------
def katex_postfix(lines, rel):
    return lines

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def section_of(rel):
    d = os.path.dirname(rel)
    return d.split("/")[0] if d else "root"

def main():
    # Nav + order
    nav = load_nav()
    nav_nodes = build_nav_nodes(nav)

    # Files
    all_files = sorted(
        os.path.relpath(p, CONTENT).replace(os.sep, "/")
        for p in globmod.glob(os.path.join(CONTENT, "**", "*.md"), recursive=True)
    )
    ported = [f for f in all_files if not is_reference(f) and not is_root_index(f)]

    # Wipe + regenerate content/docs
    if os.path.isdir(DST):
        shutil.rmtree(DST)
    os.makedirs(DST, exist_ok=True)

    for rel in ported:
        raw = open(os.path.join(CONTENT, rel), encoding="utf-8").read()
        lines = raw.split("\n")
        # trailing newline handling: split on '\n' keeps a final '' if file ends with \n
        title, desc = extract_title_desc(lines)
        assert title, "no H1 in %s" % rel

        body_lines, used_callout, used_figure = structural(lines, rel)
        is_mdx = used_callout or used_figure
        filedir = os.path.dirname(rel)
        body_lines = inline_pass(body_lines, filedir, rel, is_mdx)
        body_lines = katex_postfix(body_lines, rel)

        # MDX stray-brace guard: escape any '{' in prose (outside code/math) that
        # would otherwise start a JSX expression.
        if is_mdx:
            body_lines = escape_stray_braces(body_lines, rel)

        fm = {
            "title": title,
            "description": desc,
            "section": section_of(rel),
            "order": page_order[rel],
            "source": "docs/content/" + rel,
        }
        header = emit_frontmatter(fm)
        imports = []
        if used_callout:
            imports.append('import Callout from "@components/Callout.astro";')
        if used_figure:
            imports.append('import ThemedFigure from "@components/ThemedFigure.astro";')

        body = "\n".join(body_lines)
        if is_mdx:
            out_text = header + "\n".join(imports) + "\n\n" + body.lstrip("\n")
        else:
            out_text = header + "\n" + body.lstrip("\n")
        if not out_text.endswith("\n"):
            out_text += "\n"

        ext = ".mdx" if is_mdx else ".md"
        dst_path = os.path.join(DST, rel[:-3] + ext)
        os.makedirs(os.path.dirname(dst_path), exist_ok=True)
        with open(dst_path, "w", encoding="utf-8") as f:
            f.write(out_text)

    # docs-nav.json
    with open(os.path.join(DATA, "docs-nav.json"), "w", encoding="utf-8") as f:
        json.dump(nav_nodes, f, indent=2, ensure_ascii=False)
        f.write("\n")

    # redirects.json — every page (ported + reference + index)
    redirects = {}
    for rel in all_files:
        redirects[redirect_old(rel)] = redirect_new(rel)
    with open(os.path.join(DATA, "redirects.json"), "w", encoding="utf-8") as f:
        json.dump(redirects, f, indent=2, ensure_ascii=False)
        f.write("\n")

    # ------------------------------------------------------------------
    # Assertions + report
    # ------------------------------------------------------------------
    hrefs = []
    flat_hrefs(nav_nodes, hrefs)
    n_ported = len(ported)
    n_nav = len(hrefs)
    n_redirects = len(redirects)

    print("ported files:      %d" % n_ported)
    print("docs-nav hrefs:    %d" % n_nav)
    print("redirects:         %d" % n_redirects)
    print("admonition types:  %s" % dict(sorted(admon_types_seen.items())))
    print("attr tokens stripped:")
    for tok, files in sorted(attr_tokens_stripped.items()):
        print("   %-28s in %s" % (tok, ", ".join(sorted(files))))
    if brace_escapes:
        print("stray-brace escapes:")
        for f, note in brace_escapes:
            print("   %s: %s" % (f, note))
    else:
        print("stray-brace escapes: none")

    # every ported page URL must be reachable in the nav (prev/next depends on it)
    href_set = set(hrefs)
    for rel in ported:
        assert url_docs(rel) in href_set, "ported page not in nav: %s -> %s" % (rel, url_docs(rel))

    assert n_ported == 73, "expected 73 ported, got %d" % n_ported
    assert n_nav == 89, "expected 89 docs-nav hrefs, got %d" % n_nav
    assert n_redirects == 88, "expected 88 redirects, got %d" % n_redirects
    print("\nALL ASSERTIONS PASSED")


def escape_stray_braces(lines, rel):
    """Escape a literal '{' in .mdx prose (outside fenced code, inline code, and
    math spans) so MDX does not read it as a JS expression. Rare in this corpus."""
    out = []
    in_fence = False
    in_disp = False
    for line in lines:
        if re.match(r"^ *```", line):
            out.append(line); in_fence = not in_fence; continue
        if in_fence:
            out.append(line); continue
        if in_disp:
            if line.strip() == "$$":
                in_disp = False
            out.append(line); continue
        if line.strip() == "$$":
            in_disp = True
            out.append(line); continue
        # walk: protect inline code (`...`) and inline math ($...$ / $$...$$)
        res = []
        i = 0
        n = len(line)
        while i < n:
            c = line[i]
            if c == "`":
                m = re.compile(r"`+").match(line, i)
                run = m.end() - m.start()
                close = line.find("`" * run, m.end())
                if close == -1:
                    res.append(line[i:]); i = n; continue
                res.append(line[i:close + run]); i = close + run; continue
            if c == "$":
                # $$...$$ or $...$
                if line.startswith("$$", i):
                    close = line.find("$$", i + 2)
                    if close != -1:
                        res.append(line[i:close + 2]); i = close + 2; continue
                else:
                    close = line.find("$", i + 1)
                    if close != -1:
                        res.append(line[i:close + 1]); i = close + 1; continue
                res.append(c); i += 1; continue
            if c == "{":
                res.append("&#123;")
                brace_escapes.append((rel, "escaped '{' in prose"))
                i += 1
                continue
            res.append(c); i += 1
        out.append("".join(res))
    return out


if __name__ == "__main__":
    main()
