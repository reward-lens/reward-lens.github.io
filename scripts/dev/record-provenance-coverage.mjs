// Usage: node scripts/dev/record-provenance-coverage.mjs [dist]
// Writes reports/provenance-coverage.json.
//
// WHY THIS EXISTS, AND WHY IT TRANSCRIBES RATHER THAN COUNTS.
//
// `pages/evidence.md` §3 requires the coverage section's numbers to come from
// gate 5's own sweep, and states the acceptance criterion as a prohibition:
// "if gate 5 and this section can disagree, this section is wrong". A second
// tokeniser on the page would be a second count, and two counts of the same
// thing disagree the first time either one changes.
//
// So this runs gate 5 unmodified and parses the summary line it prints. Every
// number in the artifact is a number gate 5 itself computed and printed; this
// file adds none and derives none. If gate 5's summary line ever changes shape
// this throws rather than guessing, because a recorder that silently records
// nothing is exactly the failure C-38 and C-49 describe.
//
// THE ONE THING IT CANNOT FIX, STATED. Gate 5 sweeps dist/, and /evidence/ is
// in dist/, so the artifact always describes the build BEFORE the one that
// renders it. Run it after a build, commit it, rebuild, and run it again: the
// numbers converge once the digits stop changing. `reports/` is where the gates
// already write their own findings (_lib.mjs recordVacuity writes
// reports/vacuous-gates.json), which is why the artifact lives there rather
// than in src/data/**, which holds P1's generated data.
//
// This is a tool, not a gate: D-27 puts tools in scripts/dev/ and gates in
// scripts/checks/. It does not modify gate 5, which is packet P2's file.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE = join(ROOT, "scripts", "checks", "provenance.mjs");
const OUT = join(ROOT, "reports", "provenance-coverage.json");
const dist = process.argv[2] ?? join(ROOT, "dist");

// Gate 5 exits 1 when anything is unbound, which is a real finding and not a
// reason to record nothing. stdout is captured either way.
let stdout = "";
try {
  stdout = execFileSync("node", [GATE, dist], { encoding: "utf-8" });
} catch (e) {
  stdout = e.stdout ?? "";
  if (!stdout) throw e;
}

// The exact shape of provenance.mjs:150-153. Anchored on its own wording so a
// rewritten summary fails loudly here instead of recording stale numbers.
const SUMMARY =
  /provenance: (\d+) pages\. (\d+) numeric\(s\) bound to a provenance chip, (\d+) matched a permanent pattern, (\d+) matched a context allowance, (\d+) ported from the library's own reference, (\d+) absorbed by the route ratchet, (\d+) unbound and failing\./;
const m = stdout.match(SUMMARY);
if (!m) {
  throw new Error(
    "record-provenance-coverage: gate 5 printed no summary line in the shape " +
      "this recorder parses. Its numbers are the only source for /evidence/ " +
      "section 3, so recording a guess is worse than failing. Re-read " +
      "scripts/checks/provenance.mjs and update the regex here.\n\n" +
      stdout,
  );
}

const [, pages, bound, allowed, byContext, ported, ratcheted, unbound] = m.map(Number);
const artifact = {
  _what_this_is:
    "Gate 5's own sweep, transcribed from the summary line scripts/checks/provenance.mjs prints. Nothing here is counted by this file. /evidence/ section 3 renders these numbers and nothing else, so the page cannot disagree with the gate; it can only be one build behind it, which `sweptPages` and `recordedAt` make visible. Regenerate with: node scripts/dev/record-provenance-coverage.mjs",
  _the_total_is_numerals_not_distinct_values:
    "`numerals` counts numeric TOKENS in rendered text, which is what gate 5 measures and what it fails the build on. It is not a count of distinct values. copy.yaml:evidence.coverage_body used to say 'distinct numbers', which does not describe this figure; escalated by packet P6 and RESOLVED 2026-08-11 by the build lead, who changed the copy to say what is counted rather than changing what is counted.",
  _ported_is_exempt_not_covered:
    "`ported` numerals are on /docs/api/**, generated verbatim from the library's docstrings by scripts/build_api_ref.py. The site does not edit a page it ports (C-10) and cannot bind the library's numbers to this archive's evidence store, so they are exempt. They are counted and published rather than skipped: gate 5 used to `continue` over the whole route, which took them out of the DENOMINATOR too, so the coverage ratio quietly improved by removing pages instead of binding numbers.",
  _ratcheted_is_not_covered:
    "`ratcheted` numerals are on routes gate 5 defers entirely. They are neither bound nor exempt: they are unchecked. Any surface publishing `bound` without publishing this beside it is quoting a coverage figure over a site with whole route families removed.",
  _context_allowances_are_exempt_not_covered:
    "`allowedByContext` numerals matched one of gate 5's context allowances: a published release version, the minimum Python version, a figure or section label, an arXiv identifier, a data table's reference-row baseline, or prose ported verbatim from the library's quantity registry. Like `allowedByPattern` these are exempt because they are not claims about the world, and unlike it the exemption is decided by the numeral's surroundings rather than its digits, so a measurement of the same shape still fails. Gate 5 prints the hits and routes each one covered on every run, and says so when one covers nothing.",
  sweptPages: pages,
  numerals: bound + allowed + byContext + ported + ratcheted + unbound,
  bound,
  allowedByPattern: allowed,
  allowedByContext: byContext,
  portedReference: ported,
  ratcheted,
  unbound,
  recordedAt: new Date().toISOString(),
  gate: "scripts/checks/provenance.mjs",
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(
  `recorded gate 5: ${artifact.numerals} numerals over ${pages} pages ` +
    `(${bound} bound, ${allowed} pattern, ${byContext} context, ${ported} ported, ` +
    `${ratcheted} ratcheted, ${unbound} unbound)`,
);
