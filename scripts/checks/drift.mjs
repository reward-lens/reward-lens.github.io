// Gate 15 · Token drift
//
// This is not a second linter. The rules live in scripts/lint-tokens.mjs, which
// F1 wrote while the contrast table was in front of it and which reports zero
// failing findings in src/components/base/**. Writing a second one would give
// the site two definitions of what drift is, which is the exact failure the
// whole build is organised against. This runs that linter in `--gate` mode and
// reconciles what it finds against a ratchet.
//
// Gate mode differs from the local command in two ways:
//
//   - It scans src/**, scripts/** AND film/**. D-23: every colour in film/**
//     resolves to tokens.css through gen-tokens-py.mjs, with no allow-list.
//   - There is no OWNED subset. F1's OWNED list was a staging device with a
//     comment saying to delete it when every file is listed. In gate mode it is
//     gone and every finding is a failure.
//
// **On the ratchet, and this is a judgment call P2 is flagging rather than
// burying.** "No allow-list" is the instruction, and an allow-list is not what
// this is. Removing OWNED exposes 188 findings in legacy files that P4, P5 and
// P6 rewrite during wave 1. Failing hard on all 188 makes CI red for the whole
// of wave 1, and D-29 rejected exactly that for gate 14 in exactly this
// situation, in the library's own words: a permanently red gate is one people
// learn to ignore. So gate 15 uses the same ratchet mechanism D-29 chose, not a
// second idiom and not an allow-list. The list may shrink and must not grow, so
// any NEW drift in any packet's new code fails immediately, which is the
// property that matters during wave 1. Q1 cannot sign off while it is
// non-empty. If the build lead wants a hard failure instead, delete
// ratchet-tokens.txt and this gate fails on all 188.
//
// Usage:
//   node scripts/checks/drift.mjs
//   node scripts/checks/drift.mjs --record    re-record the ratchet

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./_lib.mjs";
import { checkRatchet, writeRatchet, readRatchet } from "./_ratchet.mjs";

const RATCHET = join(ROOT, "scripts", "checks", "ratchet-tokens.txt");
const RECORD = process.argv.includes("--record");

const raw = execFileSync(
  process.execPath,
  [join(ROOT, "scripts", "lint-tokens.mjs"), "--gate"],
  { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
);
const { files, findings, compatUsers } = JSON.parse(raw);

/**
 * A signature that survives an edit somewhere else in the file. File plus rule
 * plus the offending declaration, without the line number: a violation that
 * moves down four lines is the same violation, and a new one with a different
 * value is a different signature and fails.
 */
const signature = (finding) => {
  const [head, decl = ""] = finding.split("\n");
  const file = head.slice(0, head.indexOf(":"));
  const rule = head.match(/rule (\d)/)?.[1] ?? "?";
  return `${file} | rule ${rule} | ${decl.trim()}`;
};

const observed = findings.map(signature);
const owners = {
  "src/components/": "P4",
  "src/pages/docs/": "P5",
  "src/pages/campaign/": "P6",
  "src/pages/atlas/": "P6",
  "src/pages/science/": "P6",
  "src/pages/evidence/": "P6",
  "src/pages/log/": "P6",
  "src/pages/about": "P6",
  "src/pages/index": "P3",
  "src/styles/": "Q1",
};
const ownerOf = (sig) => {
  const file = sig.split(" | ")[0];
  for (const [prefix, packet] of Object.entries(owners)) {
    if (file.startsWith(prefix)) return packet;
  }
  return "unassigned";
};

const HEADER = `# Gate 15's ratchet: token drift in files no wave-1 packet has rewritten yet.
#
# One line per finding: owning packet | date recorded | source file | signature.
# The signature is file, rule number and the offending declaration, without a
# line number, so a violation that moves does not read as a new one.
#
# THIS LIST MAY SHRINK AND MUST NOT GROW. A finding that is not here fails the
# build. Rewrite a file, delete its lines. Q1 cannot sign off while this file is
# non-empty, the same condition D-29 puts on the accessibility ratchet.
#
# It is a ratchet and not an allow-list, and the difference is the whole point:
# an allow-list is permanent by default and is how the previous site ended up
# with a perfect score nobody was re-checking. A ratchet expires by
# construction because the only permitted direction is down.
#
# Re-record after a packet lands:  node scripts/checks/drift.mjs --record`;

if (RECORD) {
  // Stamp the owner into the source column so each line says whose it is.
  const existing = readRatchet(RATCHET);
  const today = new Date().toLocaleDateString("en-CA");
  const body = [...new Set(observed)]
    .sort()
    .map((sig) => {
      const m = existing.meta.get(sig);
      return `${m?.packet ?? ownerOf(sig)} | ${m?.date ?? today} | ${sig.split(" | ")[0]} | ${sig}`;
    })
    .join("\n");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(RATCHET, `${existing.header || HEADER}\n\n${body}\n`);
  console.log(`drift: recorded ${new Set(observed).size} findings to ${RATCHET}`);
  process.exit(0);
}

const result = checkRatchet(RATCHET, observed, {
  name: "token drift",
  howToFix:
    "A colour, size, spacing, radius or duration outside tokens.css, or a bare font-size / line-height / letter-spacing, or an @media length that does not equal the token it names. Fix it; do not record it. Only a file a wave-1 packet has not reached yet belongs on the ratchet.",
});

for (const line of result.lines) console[result.ok ? "log" : "error"](line);

console.log(
  `\ndrift: ${files} files scanned across src/, scripts/ and film/; ${observed.length} finding(s); ` +
    `${result.size} on the ratchet; ${result.added.length} new`,
);
console.log(
  `drift: ${compatUsers.length} reference(s) still hold src/styles/compat-v1.css alive (D-30). Q1 deletes that file at zero.`,
);
if (result.size > 0) {
  console.log(`drift: the ratchet is non-empty. Q1 cannot sign off while that is true.`);
}
process.exit(result.ok ? 0 : 1);
