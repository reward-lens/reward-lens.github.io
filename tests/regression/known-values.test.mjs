/**
 * The change detector.
 *
 *   node --test tests/regression/known-values.test.mjs
 *
 * Runs AFTER generation. The generators record what they measured to
 * tests/regression/observed/<generator>.json; tests/regression/known-values.json
 * holds what was true when a human last looked. This compares them.
 *
 * Twenty-six measurements used to be asserted inside the generators
 * themselves, twenty-one as `check(n == <literal>)` in build_data.py, two as
 * bare `assert` in build_api_ref.py and three in port_docs.py. There the
 * constant and the code that produces it are the same edit, so the pipeline
 * confirms itself. Here the same constant is a tripwire. DECISIONS.md D-08.
 *
 * Three failure modes, all of them deliberate:
 *
 *   1. A value moved.        The test names the key, the expected and the
 *                            observed. A human decides whether the change is
 *                            real and updates known-values.json with the
 *                            reason in the commit message.
 *   2. A value is missing.   Something is recorded that nobody has signed off
 *                            on. It goes in known-values.json.
 *   3. The file is absent.   The generator has not run in this tree.
 *
 * What must never happen is the fourth: a generator edited so that this file
 * becomes true again.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const known = JSON.parse(readFileSync(join(HERE, "known-values.json"), "utf-8"));

/** Keys of known-values.json that describe the file rather than a generator. */
const META = new Set([
  "header",
  "howToUse",
  "movedFrom",
  "tolerance",
  "spotChecks",
]);

/**
 * Maps the generator deliberately records a superset of. `headlines` holds
 * every ledger row with an observed value; known-values names the ten the
 * site quotes. A key here is compared as a subset; every other map is
 * compared exactly, so a card disappearing from `card_verdicts` fails.
 */
const SPOT_CHECKS = new Set(known.spotChecks ?? ["build_data.headlines"]);

/**
 * The tolerance for one leaf, taken from the nearest ancestor that names one.
 * `build_data.headlines` covers `build_data.headlines.CHI-DRIFT/...`, which is
 * what the generator's own `abs(got - expected) < 1e-4` did.
 */
const tolerance = (path) => {
  const byKey = known.tolerance?.byKey ?? {};
  for (let p = path; p; p = p.includes(".") ? p.slice(0, p.lastIndexOf(".")) : "") {
    if (p in byKey) return byKey[p];
  }
  return known.tolerance?.default ?? 0;
};

const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Every difference between expected and observed, as readable lines. */
function diff(path, expected, observed, subset) {
  if (typeof expected === "number" && typeof observed === "number") {
    const tol = tolerance(path);
    return Math.abs(expected - observed) <= tol
      ? []
      : [`${path}: expected ${expected}, observed ${observed} (tolerance ${tol})`];
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(observed)) {
      return [`${path}: expected a list of ${expected.length}, observed ${typeof observed}`];
    }
    const missing = expected.filter((v) => !observed.includes(v));
    const extra = subset ? [] : observed.filter((v) => !expected.includes(v));
    const out = [];
    if (missing.length) out.push(`${path}: no longer present: ${JSON.stringify(missing)}`);
    if (extra.length) out.push(`${path}: newly present: ${JSON.stringify(extra)}`);
    return out;
  }
  if (isPlainObject(expected)) {
    if (!isPlainObject(observed)) {
      return [`${path}: expected an object, observed ${JSON.stringify(observed)}`];
    }
    const out = [];
    for (const [k, v] of Object.entries(expected)) {
      if (!(k in observed)) {
        out.push(`${path}.${k}: expected ${JSON.stringify(v)}, no longer recorded`);
        continue;
      }
      out.push(...diff(`${path}.${k}`, v, observed[k], subset));
    }
    if (!subset) {
      for (const k of Object.keys(observed)) {
        if (!(k in expected)) {
          out.push(`${path}.${k}: newly recorded as ${JSON.stringify(observed[k])}`);
        }
      }
    }
    return out;
  }
  return expected === observed
    ? []
    : [`${path}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(observed)}`];
}

const generators = Object.keys(known).filter((k) => !META.has(k));

describe("known values: the generators still measure what they measured", () => {
  test("known-values.json says what it is", () => {
    assert.match(
      known.header,
      /change detector, not a source/,
      "the header states in one sentence what this file is; do not remove it",
    );
    assert.ok(generators.length > 0, "known-values.json names no generator");
  });

  for (const generator of generators) {
    const section = known[generator];
    const observedPath = join(HERE, "observed", `${generator}.json`);

    describe(generator, () => {
      test("the generator recorded its measurements", () => {
        assert.ok(
          existsSync(observedPath),
          `tests/regression/observed/${generator}.json is missing. ` +
            `Run the generator; this test compares against what it recorded, ` +
            `not against anything it asserted.`,
        );
      });

      if (!existsSync(observedPath)) return;
      const observed = JSON.parse(readFileSync(observedPath, "utf-8")).values;

      for (const [key, expected] of Object.entries(section)) {
        // `note` and `<key>Note` carry the reasoning a bare number cannot.
        if (key === "note" || key.endsWith("Note")) continue;

        test(key, () => {
          assert.ok(
            key in observed,
            `${generator}.${key} is in known-values.json and the generator did not record it. ` +
              `Either the measurement was dropped or the key was renamed.`,
          );
          const path = `${generator}.${key}`;
          const problems = diff(path, expected, observed[key], SPOT_CHECKS.has(path));
          assert.deepEqual(
            problems,
            [],
            `${problems.length} value(s) moved:\n  ${problems.join("\n  ")}\n\n` +
              `A human looks at this. If the change is real, update ` +
              `tests/regression/known-values.json and put the reason in the commit ` +
              `message. Never edit a generator to make this file true again.`,
          );
        });
      }

      test("nothing was recorded that nobody has signed off on", () => {
        const signedOff = new Set(
          Object.keys(section).filter((k) => k !== "note" && !k.endsWith("Note")),
        );
        const unsigned = Object.keys(observed).filter((k) => !signedOff.has(k));
        assert.deepEqual(
          unsigned,
          [],
          `${generator} recorded ${unsigned.length} measurement(s) with no entry in ` +
            `known-values.json: ${unsigned.join(", ")}. A recorded number nobody has ` +
            `checked is not a tripwire. Add each one with the value you verified.`,
        );
      });
    });
  }
});
