// The ratchet: a list that may shrink and must not grow.
//
// D-29 decided gate 14 lands in CI immediately, failing, against a ratchet
// rather than an allow-list, and said the shape is borrowed from the library's
// own `assay/docs/gen_catalogue.py` so the site does not invent a second idiom
// for the same problem. This is that shape, in JavaScript:
//
//   - a plain text file, one signature per line, sorted
//   - a hand-maintained comment header carrying the argument for why the
//     current entries are there, which `--record` preserves rather than
//     overwriting (gen_catalogue.py:_existing_header, and it learned that the
//     hard way: an earlier --write-ledger deleted the reasoning every time)
//   - a new finding that is not in the file fails the build, naming it
//   - a recorded finding that no longer occurs is printed as deletable
//   - `--record` rewrites the file from the current findings
//
// The difference from an allow-list is the whole point. An allow-list is
// permanent by default, and it is how the previous site ended up with a perfect
// accessibility score nobody was re-checking. A ratchet expires by
// construction, because the only permitted direction is down, and Q1 cannot
// sign off while one is non-empty.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

export function readRatchet(path) {
  if (!existsSync(path)) return { header: "", entries: new Set(), meta: new Map() };
  const lines = readFileSync(path, "utf-8").split("\n");
  const header = [];
  const entries = new Set();
  const meta = new Map();
  let inHeader = true;
  for (const line of lines) {
    if (inHeader && (line.startsWith("#") || line.trim() === "")) {
      if (line.startsWith("#")) header.push(line);
      continue;
    }
    inHeader = false;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // packet | date | source | signature...
    const parts = trimmed.split("|").map((s) => s.trim());
    const signature = parts.slice(3).join(" | ");
    entries.add(signature);
    meta.set(signature, { packet: parts[0], date: parts[1], source: parts[2] });
  }
  return { header: header.join("\n"), entries, meta };
}

/**
 * @returns {{ ok: boolean, added: string[], closed: string[], lines: string[] }}
 */
export function checkRatchet(path, observed, { name, howToFix }) {
  const { entries, meta } = readRatchet(path);
  const seen = new Set(observed);
  const added = [...seen].filter((s) => !entries.has(s)).sort();
  const closed = [...entries].filter((s) => !seen.has(s)).sort();

  const lines = [];
  if (added.length) {
    lines.push(
      `\nFAIL ${name}: ${added.length} finding(s) not in the ratchet ${path}.`,
      `The ratchet may shrink and must not grow. ${howToFix}`,
      "",
    );
    for (const a of added) lines.push(`  NEW  ${a}`);
  }
  if (closed.length) {
    lines.push(
      `\n${closed.length} ratchet entr${closed.length === 1 ? "y is" : "ies are"} no longer observed and can be deleted:`,
    );
    for (const c of closed) {
      const m = meta.get(c);
      lines.push(`  CLOSED  ${c}${m?.packet ? `   (recorded for ${m.packet})` : ""}`);
    }
  }
  return { ok: added.length === 0, added, closed, lines, size: entries.size };
}

export function writeRatchet(path, observed, { header, packet = "unassigned", source = "unknown" }) {
  const existing = readRatchet(path);
  const head = existing.header || header;
  const today = new Date().toLocaleDateString("en-CA");
  const body = [...new Set(observed)]
    .sort()
    .map((sig) => {
      const m = existing.meta.get(sig);
      return `${m?.packet ?? packet} | ${m?.date ?? today} | ${m?.source ?? source} | ${sig}`;
    })
    .join("\n");
  writeFileSync(path, `${head}\n\n${body}\n`);
  return observed.length;
}
