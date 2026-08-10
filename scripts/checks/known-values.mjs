// Gate 4 · Regression values
//
// D-08: the generators compute, they do not carry the answers. The 26 literal
// assertion sites across build_data.py, build_api_ref.py and port_docs.py move
// to tests/regression/known-values.json (P1 owns that migration), and this gate
// is what makes the moved file load-bearing. The split is deliberate:
//
//   this script          knows HOW to derive each quantity from src/data/**
//   known-values.json    holds WHAT each one currently is
//
// A constant inside the generator makes the pipeline confirm itself. The same
// constant out here, in a check that fails loudly, is a tripwire. When a value
// changes, this fails, a human looks, and the file is updated with the reason
// in the commit message.
//
// Usage:  node scripts/checks/known-values.mjs [--record]

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { ROOT, readJson, skip } from "./_lib.mjs";

// P1 creates tests/ from nothing. KNOWN_VALUES points this at a fixture so the
// gate can be demonstrated failing without writing into P1's directory.
const FILE = process.env.KNOWN_VALUES ?? join(ROOT, "tests", "regression", "known-values.json");
const RECORD = process.argv.includes("--record");

const data = (p) => readJson(join(ROOT, "src", "data", p));

/**
 * Every derivable quantity, by name. Adding a name here without adding it to
 * known-values.json is not a failure: an unrecorded derivation is reported so
 * the file can be extended deliberately rather than by a script rewriting it.
 */
const DERIVATIONS = {
  "ledger.rows": () => data("ledger.json").length,
  "ledger.confirmed": () => data("ledger.json").filter((r) => r.outcome === "confirmed").length,
  "ledger.refuted": () => data("ledger.json").filter((r) => r.outcome === "refuted").length,
  "ledger.inconclusive": () => data("ledger.json").filter((r) => r.outcome === "inconclusive").length,
  // Returned as a sorted list, not a joined string, because the pinned value is
  // a list. Joining first made the comparison depend on Array.prototype
  // .toString happening to use a comma, and printed a string against a list in
  // the failure message.
  "ledger.kill_ids": () =>
    [...new Set(data("ledger.json").map((r) => r.kill_id).filter(Boolean))].sort(),
  "cards.total": () => data("cards.json").length,
  "cards.confirmed": () => data("cards.json").filter((c) => c.verdict === "confirmed").length,
  "cards.refuted": () => data("cards.json").filter((c) => c.verdict === "refuted").length,
  "cards.mixed": () => data("cards.json").filter((c) => c.verdict === "mixed").length,
  "cards.inconclusive": () => data("cards.json").filter((c) => c.verdict === "inconclusive").length,
  "cards.power_acceptances": () => data("cards.json").filter((c) => c.power_acceptance).length,
  "theorems.total": () => data("theorems.json").length,
  "theorems.open": () => data("theorems.json").filter((t) => t.status === "open").length,
  "campaign.spend_usd": () => data("campaign.json").spend_usd,
  "campaign.hypotheses.total": () => data("campaign.json").hypotheses.total,
  "campaign.cards.total": () => data("campaign.json").cards.total,
  "fleet.rows": () => data("fleet/index.json").length,
  "provenance.files": () => data("provenance.json").files.length,
  "evidence.records": () => Object.keys(data("evidence-index.json") ?? {}).length,
  "redirects.entries": () => Object.keys(data("redirects.json") ?? {}).length,
  "docs_nav.hrefs": () => {
    const nav = data("docs-nav.json");
    let n = 0;
    const walk = (x) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") {
        if (typeof x.href === "string") n += 1;
        Object.values(x).forEach(walk);
      }
    };
    walk(nav);
    return n;
  },
};

if (!existsSync(FILE)) {
  if (RECORD) {
    const out = {};
    for (const [name, fn] of Object.entries(DERIVATIONS)) {
      try {
        out[name] = fn();
      } catch (e) {
        out[name] = null;
      }
    }
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(
      FILE,
      JSON.stringify(
        {
          _what_this_is:
            "A change detector, not a source. Every value here is derived by scripts/checks/known-values.mjs from src/data/**. When one changes, gate 4 fails, a human looks, and this file is updated with the reason recorded in the commit. Nothing reads it at build time.",
          ...out,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`known-values: recorded ${Object.keys(out).length} values to ${FILE}`);
    process.exit(0);
  }
  skip(
    4,
    `tests/regression/known-values.json does not exist. Packet P1 creates tests/ from nothing and migrates the 26 assertion sites (C-2, C-4). Until it lands, no derived value is pinned. Regenerate a local copy with: node scripts/checks/known-values.mjs --record`,
  );
}


/**
 * WHY THIS TABLE EXISTS, AND WHY IT IS EXPLICIT RATHER THAN CLEVER.
 *
 * The pinned file groups values under the generator that produced them, in
 * snake_case, and sometimes nests a distribution one level deeper:
 * `build_data.ledger_outcomes.confirmed`. The derivations below are named for
 * what they mean, in dotted form: `ledger.confirmed`. The two namespaces never
 * overlapped, so **every lookup missed, `compared` stayed at 0, and the gate
 * printed "0 values compared, 0 failures" and exited 0** for the whole build.
 * That is the defect the ledger recorded as gate 4 and it was still live.
 *
 * A fuzzy leaf-name match resolved 3 of 21 and would have silently left the
 * other 18 unchecked while looking fixed, which is the same failure wearing a
 * better disguise. So the mapping is written out. An entry that stops
 * resolving is a loud failure below, not a quiet skip.
 *
 * TWO ENTRY SHAPES, BOTH EXPLICIT.
 *
 *   "name": "a.dotted.path"                compare against the pinned value
 *   "name": { path: "...", count: true }   compare against how many entries
 *                                          the pinned collection at that path
 *                                          has
 *
 * The second exists for one case and is written out for it rather than
 * inferred: `theorems.total` counts the theorems, and what the file pins is the
 * table of them, `build_data.theorem_statuses`, whose size IS that count. That
 * is comparing against a pinned value, not inventing one. `count` on anything
 * that is not an object or a list is a failure below, not a coercion.
 */
const ALIASES = {
  "ledger.rows": "build_data.ledger_rows",
  "ledger.confirmed": "build_data.ledger_outcomes.confirmed",
  "ledger.refuted": "build_data.ledger_outcomes.refuted",
  "ledger.inconclusive": "build_data.ledger_outcomes.inconclusive",
  // The eight kill ids, pinned as a list of eight.
  "ledger.kill_ids": "build_data.kill_ids",
  "cards.total": "build_data.cards",
  "cards.confirmed": "build_data.card_verdict_distribution.confirmed",
  "cards.refuted": "build_data.card_verdict_distribution.refuted",
  "cards.mixed": "build_data.card_verdict_distribution.mixed",
  "cards.inconclusive": "build_data.card_verdict_distribution.inconclusive",
  "cards.power_acceptances": "build_data.power_acceptances",
  "theorems.open": "build_data.theorem_status_distribution.open",
  // No scalar pins the theorem count, and the table that enumerates them does.
  // `theorem_statuses` has one entry per theorem, T1 to T14, so its size is the
  // count; `theorem_status_distribution` sums to the same 14 but only by
  // arithmetic over three numbers, which is a weaker thing to compare against.
  "theorems.total": { path: "build_data.theorem_statuses", count: true },
  "campaign.spend_usd": "build_data.spend_usd",
  // campaign.json's own count of the hypotheses, against the ledger's row
  // count, because THE LEDGER ROWS ARE THE HYPOTHESES: campaign.json carries
  // {total 53, confirmed 16, refuted 21, inconclusive 16} and build_data pins
  // ledger_rows 53 with exactly that outcome split. Two generators' files must
  // agree here, so pointing both at one pin is the check, not a shortcut. Same
  // shape as `cards.total` and `campaign.cards.total`, which have both aliased
  // to `build_data.cards` since this table was written.
  "campaign.hypotheses.total": "build_data.ledger_rows",
  "campaign.cards.total": "build_data.cards",
  "fleet.rows": "build_data.fleet_models",
  "evidence.records": "build_data.evidence_records",
  // port_docs writes the redirect map; src/data/redirects.json is that map.
  "redirects.entries": "port_docs.redirects",
  "docs_nav.hrefs": "port_docs.docs_nav_hrefs",
};

/**
 * DERIVATIONS THAT CANNOT BE PINNED, WITH THE REASON, AND THE REASON IS NOT
 * "we could not find it".
 *
 * known-values.json is one half of a pair. The other half is
 * tests/regression/observed/<generator>.json, which the generator writes, and
 * tests/regression/known-values.test.mjs asserts the two agree IN BOTH
 * DIRECTIONS: a key here that the generator did not record fails with "the
 * measurement was dropped or the key was renamed", and a key the generator
 * recorded that nobody signed off on fails too.
 *
 * So a value cannot be added to known-values.json alone. Writing it into the
 * observed half by hand is worse than leaving it out: the observed half's whole
 * job is to be what a generator measured, and a number typed into it is the
 * generator confirming itself with an extra step.
 *
 * An entry here is a live claim, not an excuse. If the value ever DOES appear
 * in the pinned file, this table is stale and the run below says so and fails.
 */
const UNPINNABLE = {
  "provenance.files":
    "191, the length of src/data/provenance.json's copy manifest. " +
    "scripts/build_data.py builds that manifest (its `Provenance` object) and " +
    "records 41 measurements, none of them its length: `campaign_pngs` (62) and " +
    "`docs_svgs` (48) cover two of the manifest's seven output directories and " +
    "110 of its 191 rows. Pinning it needs one line in the generator, " +
    "`measured.record(\"provenance_files\", ...)`, and a regenerated " +
    "tests/regression/observed/build_data.json; scripts/build_data.py belongs to " +
    "P1 and this packet does not own it. Until then this quantity is derived on " +
    "every run and compared to nothing.",
};

/** Resolve a dotted path against the pinned file. */
const pinned = (root, path) =>
  path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), root);

const expected = readJson(FILE);
const failures = [];
const unresolved = [];
let compared = 0;

const size = (v) => (Array.isArray(v) ? v.length : Object.keys(v).length);

/**
 * What the pinned file says this derivation should be, and where that came
 * from. `undefined` means the alias did not resolve, which is a failure and
 * never a skip.
 */
function pinnedFor(name) {
  const alias = ALIASES[name] ?? name;
  if (typeof alias === "string") {
    const want = pinned(expected, alias);
    return want === undefined ? undefined : { want, where: alias };
  }
  const at = pinned(expected, alias.path);
  if (at === undefined) return undefined;
  if (!alias.count) throw new Error(`alias for ${name} has no shape this script understands`);
  if (at === null || typeof at !== "object") {
    failures.push(
      `FAIL ${name}: the alias counts the entries of ${alias.path}, and that pins ` +
        `${JSON.stringify(at)}, which has no entries to count.`,
    );
    return null;
  }
  return { want: size(at), where: `entries of ${alias.path}` };
}

for (const [name, fn] of Object.entries(DERIVATIONS)) {
  const resolved = pinnedFor(name);
  if (resolved === null) continue; // already failed, with its own message
  if (resolved === undefined) {
    unresolved.push(name);
    continue;
  }
  const { want, where } = resolved;
  let actual;
  try {
    actual = fn();
  } catch (e) {
    failures.push(`FAIL ${name}: could not derive (${e.message})`);
    continue;
  }
  compared += 1;
  const same =
    typeof want === "number" && typeof actual === "number"
      ? Math.abs(want - actual) < 1e-9
      : Array.isArray(want) || Array.isArray(actual)
        ? JSON.stringify(want) === JSON.stringify(actual)
        : String(want) === String(actual);
  if (!same) {
    failures.push(
      `FAIL ${name}: derived ${JSON.stringify(actual)}, known-values.json says ` +
        `${JSON.stringify(want)} at ${where}`,
    );
  }
}

/**
 * An unresolved derivation is a failure unless UNPINNABLE says why, and a
 * stale UNPINNABLE entry is a failure too. Both directions, because an
 * exemption nobody rechecks is how a gate goes quiet.
 */
for (const name of unresolved) {
  if (name in UNPINNABLE) continue;
  failures.push(
    `FAIL ${name}: this script derives it and ${FILE} does not pin it, under any ` +
      `alias. Add the value to the pinned file, or add ${name} to UNPINNABLE with ` +
      `the reason. A derivation compared against nothing is not a check.`,
  );
}
for (const [name, why] of Object.entries(UNPINNABLE)) {
  if (!(name in DERIVATIONS)) {
    failures.push(`FAIL UNPINNABLE names ${name}, which is not a derivation this script knows.`);
  } else if (!unresolved.includes(name)) {
    failures.push(
      `FAIL ${name} is declared UNPINNABLE and it now resolves. The declaration is ` +
        `stale: delete it. It said: ${why}`,
    );
  }
}

/**
 * The pinned file is grouped by generator, and this script reads leaves inside
 * those groups. Reporting the group names as "values this script cannot derive"
 * was wrong and it printed eleven of them on every run, four being the file's
 * own header. What is true and worth saying is which groups no derivation
 * reaches at all: known-values.test.mjs checks those against the generators'
 * own observed/ files, and this gate never opens them.
 */
const reached = new Set(
  Object.keys(DERIVATIONS)
    .map((n) => ALIASES[n] ?? n)
    .map((a) => (typeof a === "string" ? a : a.path))
    .map((p) => p.split(".")[0]),
);
const META = new Set(["header", "howToUse", "movedFrom", "tolerance", "spotChecks"]);
const untouched = Object.keys(expected).filter((k) => !META.has(k) && !reached.has(k));

for (const line of failures) console.error(line);
if (Object.keys(UNPINNABLE).length) {
  for (const [name, why] of Object.entries(UNPINNABLE)) {
    if (unresolved.includes(name)) console.warn(`known-values: ${name} is NOT PINNED. ${why}`);
  }
}
if (untouched.length) {
  console.warn(
    `known-values: ${untouched.length} pinned group(s) no derivation here reads, ` +
      `checked instead by known-values.test.mjs against tests/regression/observed/: ` +
      `${untouched.join(", ")}`,
  );
}
/**
 * A GATE THAT COMPARED NOTHING HAS NOT PASSED.
 *
 * This is the whole lesson of gate 4: it reported "0 values compared, 0
 * failures" and exited 0 for the entire build, and a green line with a zero in
 * it reads exactly like a green line with a number in it. Comparing nothing is
 * now a failure in its own right.
 */
if (compared === 0) {
  console.error(
    `FAIL known-values: 0 values compared. ${Object.keys(DERIVATIONS).length} derivations ` +
      `exist and not one resolved against ${FILE}. A change detector that detects nothing ` +
      `is not a passing check, it is an absent one.\n`,
  );
  process.exit(1);
}
const declared = unresolved.filter((n) => n in UNPINNABLE).length;
console.log(
  `known-values: ${compared} of ${Object.keys(DERIVATIONS).length} derivations compared, ` +
    `${declared} declared unpinnable, ${unresolved.length - declared} unresolved, ` +
    `${failures.length} failures`,
);
process.exit(failures.length ? 1 : 0);
