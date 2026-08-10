// verify-gate-list · the gate that checks the gates
//
// D-07: `QA.md` §1 lists them, and a check parses
// `.github/workflows/deploy.yml` and fails if the set of steps and the list
// disagree **in either direction**. A gate that is not in the workflow does not
// exist, and a workflow step nobody documented is equally a defect.
//
// Three assertions, and the third is the one that catches the interesting case:
//
//   1. Every row in QA.md §1 has exactly one workflow step named
//      "Gate <n> · <gate name>".
//   2. Every workflow step named "Gate ..." has a row in QA.md §1. A step whose
//      name does not begin with "Gate" must be in INFRASTRUCTURE below, so
//      adding one is a deliberate two-file act rather than a drive-by.
//   3. **The step's `run:` matches the command the table states.** Without
//      this, a gate can be listed, present in the workflow, and wired to a
//      different script, and every count still reconciles. That is the shape a
//      gate takes when somebody renames a file.
//
// Usage:  node scripts/checks/verify-gate-list.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./_lib.mjs";

const QA = join(ROOT, "design", "QA.md");
const WORKFLOW = join(ROOT, ".github", "workflows", "deploy.yml");

// Steps that are not gates. Checkout, toolchain, dependency install, and the
// Pages publish. Anything else in the workflow must be a gate.
const INFRASTRUCTURE = new Set([
  "Checkout",
  "Set up Node",
  "Set up Python",
  "Install reward-lens for the claims gate",
  "Install site dependencies",
  "Install Playwright browser",
  "Configure GitHub Pages",
  "Upload site artifact",
  "Deploy to GitHub Pages",
  "Publish the gate report",
]);

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

const qa = readFileSync(QA, "utf-8");
const section = qa.split(/^## /m).find((s) => s.startsWith("1. The gate list"));
if (!section) {
  console.error("FAIL design/QA.md has no section '## 1. The gate list'.");
  process.exit(1);
}

const rows = [];
for (const line of section.split("\n")) {
  const m = line.match(/^\|\s*(?:\*\*)?(\d+|\++)(?:\*\*)?\s*\|(.+)\|\s*$/);
  if (!m) continue;
  const cells = m[2].split("|").map((c) => c.trim());
  if (cells.length < 3) continue;
  const strip = (s) => s.replace(/\*\*/g, "").replace(/`/g, "").trim();
  rows.push({ n: m[1], name: strip(cells[0]), command: strip(cells[1]) });
}
if (rows.length === 0) {
  console.error("FAIL design/QA.md §1 has no table rows.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The workflow
// ---------------------------------------------------------------------------

const wf = readFileSync(WORKFLOW, "utf-8");
const steps = [];
{
  const lines = wf.split("\n");
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const nameMatch = lines[i].match(/^\s*-\s+name:\s*(.+?)\s*$/);
    if (nameMatch) {
      if (current) steps.push(current);
      current = { name: nameMatch[1].replace(/^["']|["']$/g, ""), run: null, uses: null, line: i + 1 };
      continue;
    }
    if (!current) continue;
    const run = lines[i].match(/^\s*run:\s*(.*)$/);
    if (run) {
      let cmd = run[1].trim();
      if (cmd === "|" || cmd === ">" || cmd === "|-" || cmd === ">-") {
        const body = [];
        for (let j = i + 1; j < lines.length; j += 1) {
          if (/^\s{10,}\S/.test(lines[j])) body.push(lines[j].trim());
          else break;
        }
        cmd = body.join(" && ");
      }
      current.run = cmd;
    }
    const uses = lines[i].match(/^\s*uses:\s*(.+)$/);
    if (uses) current.uses = uses[1].trim();
  }
  if (current) steps.push(current);
}

const gateSteps = new Map();
const unknownSteps = [];
for (const s of steps) {
  const m = s.name.match(/^Gate\s+(\d+|\++)\s+·\s+(.+)$/);
  if (m) {
    if (gateSteps.has(m[1])) unknownSteps.push(`duplicate step for gate ${m[1]}: "${s.name}"`);
    gateSteps.set(m[1], { ...s, gateName: m[2] });
  } else if (!INFRASTRUCTURE.has(s.name)) {
    unknownSteps.push(
      `undocumented workflow step "${s.name}" at deploy.yml:${s.line}. Every step is either a gate named "Gate N · Name" with a row in QA.md §1, or infrastructure declared in verify-gate-list.mjs.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Reconcile, in both directions
// ---------------------------------------------------------------------------

const norm = (c) =>
  c
    .replace(/\s+/g, " ")
    .replace(/^bash\s+/, "")
    .replace(/^node\s+/, "node ")
    .trim();

let failures = 0;
const fail = (m) => {
  console.error(`FAIL ${m}`);
  failures += 1;
};

for (const row of rows) {
  const step = gateSteps.get(row.n);
  if (!step) {
    fail(
      `gate ${row.n} (${row.name}) is in QA.md §1 and has no step in deploy.yml. A gate that is not in the workflow does not exist.`,
    );
    continue;
  }
  if (step.gateName !== row.name) {
    fail(`gate ${row.n}: QA.md calls it "${row.name}", deploy.yml calls it "${step.gateName}".`);
  }
  if (step.run == null) {
    fail(`gate ${row.n} (${row.name}): the workflow step runs nothing.`);
  } else if (norm(step.run) !== norm(row.command)) {
    fail(
      `gate ${row.n} (${row.name}) is wired to a different command than the table states.\n` +
        `       QA.md:      ${row.command}\n` +
        `       deploy.yml: ${step.run}`,
    );
  }
}

for (const [n, step] of gateSteps) {
  if (!rows.some((r) => r.n === n)) {
    fail(
      `deploy.yml runs a step "Gate ${n} · ${step.gateName}" with no row in QA.md §1. An undocumented workflow step is a defect too.`,
    );
  }
}

for (const u of unknownSteps) fail(u);

console.log(
  `\nverify-gate-list: ${rows.length} rows in QA.md §1, ${gateSteps.size} gate steps in deploy.yml, ` +
    `${steps.length - gateSteps.size} infrastructure steps, ${failures} failures`,
);
process.exit(failures > 0 ? 1 : 0);
