/**
 * build_corrections · the archive's corrections, as data.
 *
 *   node scripts/build_corrections.mjs           write src/data/log-corrections.json
 *   node scripts/build_corrections.mjs --check   fail on drift
 *
 * WHY THIS EXISTS.
 *
 * `design/CHECKPOINT.md` states the problem exactly: "The dead intransitivity
 * claim comes out of the adapter as `status: supported`. The store says
 * `verdict: confirmed`, so the mapping promotes it... The evidence store will
 * not tell you a claim is dead." A correction has to be data that outranks the
 * store's verdict, and until now the site had none: every generated file it
 * holds carries `0.2139761313773256` with `outcome: confirmed`, and the only
 * place the refutation existed was prose in `EVIDENCE-VERDICTS.md`.
 *
 * So this reads the machine-readable artifact the refutation actually produced
 * and emits the fields the archive needs to print the correction. Nothing is
 * transcribed. If the experiment's evidence is not on this machine the script
 * fails rather than emitting a number somebody typed.
 *
 * WHAT THE CORRECTION IS. The v2 campaign reported an intransitive mass of
 * 0.214 as a share of comparison energy and called it confirmed. The later
 * analysis found zero cyclic triples in 186,378 triangles, every one of 10,000
 * sampled tournaments acyclic, and the measured value sitting on the closed-form
 * floor that a perfectly transitive tournament of that shape produces anyway.
 * The linear algebra was right and the shipped number was right. The reading was
 * wrong, and the frozen threshold could not have failed on that design.
 *
 * WHAT THIS DOES NOT DO. It does not retract the card. A frozen prediction is
 * not amendable after the data is seen, which is the whole point of freezing
 * one, and the experiment's own findings say so. What is owed is a published
 * correction, and this is the data behind it.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "src", "data");
const OUT = join(DATA, "log-corrections.json");

// The experiment lives in the library's own repository, beside this one. The
// depth from here is not fixed: a git worktree puts this file three levels
// deeper than the primary checkout does, so the directory is searched for
// rather than counted to. Counting is how a generator works on one machine and
// fails on the next.
const RELATIVE = join("reward-lens-assay", "experiments", "x7_intransitivity");
const EXPERIMENT = (() => {
  let dir = ROOT;
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, RELATIVE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(ROOT, RELATIVE);
})();
const EVIDENCE = join(EXPERIMENT, "evidence", "evidence.jsonl");
const MANIFEST = join(EXPERIMENT, "manifest.json");

const read = (p) => JSON.parse(readFileSync(p, "utf-8"));

/** The store's typed-map sentinel, one layer at a time. */
const unwrap = (v) => {
  if (Array.isArray(v)) return v.map(unwrap);
  if (v && typeof v === "object") {
    if ("__map__" in v) return unwrap(v.__map__ ?? {});
    if ("__seq__" in v) return unwrap(v.__seq__ ?? []);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrap(x)]));
  }
  return v;
};

if (!existsSync(EVIDENCE)) {
  console.error(
    `FAIL build_corrections: ${EVIDENCE} does not exist.\n` +
      `The archive's correction of the intransitive-mass claim is generated ` +
      `from that experiment's own evidence and there is no fallback: typing ` +
      `the numbers here would make the correction exactly the kind of ` +
      `unsourced claim it is correcting. Check out reward-lens-assay beside ` +
      `this repository, on the branch that carries experiments/.`,
  );
  process.exit(1);
}

const byObservable = new Map();
for (const line of readFileSync(EVIDENCE, "utf-8").split("\n")) {
  if (!line.trim()) continue;
  const rec = JSON.parse(line);
  byObservable.set(rec.observable, { id: rec.id, value: unwrap(rec.value) });
}

const need = (observable, ...fields) => {
  const rec = byObservable.get(observable);
  if (!rec) {
    console.error(
      `FAIL build_corrections: the experiment's evidence has no record for ` +
        `"${observable}". It has: ${[...byObservable.keys()].join(", ")}.`,
    );
    process.exit(1);
  }
  for (const f of fields) {
    if (rec.value[f] === undefined) {
      console.error(
        `FAIL build_corrections: record ${rec.id} (${observable}) has no field ` +
          `"${f}". Its fields are: ${Object.keys(rec.value).join(", ")}.`,
      );
      process.exit(1);
    }
  }
  return rec;
};

const census = need(
  "x7.cyclic_census",
  "n_triangles",
  "n_tournaments",
  "n_acyclic",
  "n_cyclic",
  "n_comparisons_reproduced_by_a_scalar",
);
const floor = need(
  "x7.design_floor",
  "floor",
  "observed",
  "observed_minus_floor",
  "registered_threshold",
  "registered_comparator",
  "registered_outcome",
  "every_minimiser_is_acyclic",
);
const bounds = need(
  "x7.exact_bounds",
  "every_minimum_is_the_closed_form",
  "every_minimiser_is_transitive",
);

const manifest = existsSync(MANIFEST) ? read(MANIFEST) : null;

const corrections = [
  {
    // The archive card this corrects, by its own slug, so the card page can
    // find it without anything being matched on a title.
    card: "topo-hodge",
    // The verdict the store still carries, stated rather than edited: the card
    // is not retracted and the store is not rewritten.
    storedVerdict: floor.value.registered_outcome,
    storedValue: floor.value.observed,
    threshold: floor.value.registered_threshold,
    comparator: floor.value.registered_comparator,
    // What the later analysis found.
    triangles: census.value.n_triangles,
    cyclicTriples: census.value.n_cyclic,
    tournaments: census.value.n_tournaments,
    acyclicTournaments: census.value.n_acyclic,
    comparisonsAScalarReproduces: census.value.n_comparisons_reproduced_by_a_scalar,
    floor: floor.value.floor,
    observedMinusFloor: floor.value.observed_minus_floor,
    everyMinimiserIsAcyclic: floor.value.every_minimiser_is_acyclic,
    everyMinimumIsTheClosedForm: bounds.value.every_minimum_is_the_closed_form,
    everyMinimiserIsTransitive: bounds.value.every_minimiser_is_transitive,
    evidence: {
      census: census.id,
      floor: floor.id,
      bounds: bounds.id,
    },
    source: {
      experiment: "reward-lens-assay/experiments/x7_intransitivity",
      evidence: "evidence/evidence.jsonl",
      gitSha: manifest?.git_sha ?? null,
      // Published where a reader can reach it, which is the test
      // EVIDENCE-VERDICTS.md sets for a source.
      published: "reward-lens/docs/content/findings.md",
    },
  },
];

const serialised = `${JSON.stringify({ corrections }, null, 1)}\n`;

if (process.argv.includes("--check")) {
  const onDisk = existsSync(OUT) ? readFileSync(OUT, "utf-8") : null;
  if (onDisk !== serialised) {
    console.error(
      `FAIL build_corrections --check: src/data/log-corrections.json is not ` +
        `what the generator would write from the experiment's evidence today.`,
    );
    process.exit(1);
  }
  console.log(
    `build_corrections --check: matches. ${corrections.length} correction(s).`,
  );
  process.exit(0);
}

writeFileSync(OUT, serialised);
const c = corrections[0];
console.log(
  `build_corrections: wrote src/data/log-corrections.json. ` +
    `${c.cyclicTriples} cyclic triples in ${c.triangles} triangles, ` +
    `${c.acyclicTournaments} of ${c.tournaments} tournaments acyclic, ` +
    `observed minus floor ${c.observedMinusFloor}.`,
);
