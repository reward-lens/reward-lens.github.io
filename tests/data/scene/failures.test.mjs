/**
 * The refusals. What this generator does not do is the point of it.
 *
 *   node --test tests/data/scene/failures.test.mjs
 *
 * Each test runs the real script in a child process against real inputs and
 * asserts three things: that it exits non-zero, that its message names the
 * problem in words a reader can act on, and that it wrote nothing. The last one
 * matters most. A generator that half-writes on the way to failing leaves a
 * manifest describing cases whose payloads never arrived, and the next build
 * that succeeds for an unrelated reason will look like it fixed something.
 *
 * Five gates in this build have passed or failed for the wrong reason, one of
 * them by comparing zero values and exiting zero. This file is the evidence
 * that these gates are capable of failing, produced every time the suite runs
 * rather than asserted once in a handoff.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ROOT, runGenerator, scratch } from "./_support.mjs";

/** Run into a scratch directory, expect a refusal, and check nothing was written. */
function expectRefusal({ label, env = {}, matches }) {
  const out = scratch(label);
  const result = runGenerator({ args: [`--out=${out}`], env });
  assert.notEqual(result.status, 0, `the generator exited ${result.status} on ${label}; it was supposed to refuse.\n${result.output}`);
  for (const pattern of matches) {
    assert.match(result.output, pattern, `the refusal message does not explain ${pattern}:\n${result.output}`);
  }
  assert.deepEqual(
    readdirSync(out),
    [],
    `${label} refused and still wrote ${readdirSync(out).join(", ")} into the output directory`,
  );
  rmSync(out, { recursive: true, force: true });
  return result;
}

describe("a missing source fails the build and never falls back", () => {
  test("the run record is gone", () => {
    const empty = scratch("no-instrument");
    const result = expectRefusal({
      label: "missing-run-record",
      env: { SCENE_DATA_ASSAY_ROOT: empty },
      matches: [/missing required source/, /200-step run record/, /no synthetic fallback/],
    });
    assert.doesNotMatch(result.output, /cases,.*payload bytes/, "the generator printed a build summary while refusing");
    rmSync(empty, { recursive: true, force: true });
  });

  test("one of the site's generated tables is gone", () => {
    // A real copy of src/data with one file removed, rather than a flag that
    // pretends a file is missing. The absence has to be the same absence a
    // broken checkout would produce.
    const partial = scratch("partial-site-data");
    for (const name of ["run-series.json", "grader-cards.json", "banned-terms.json"]) {
      copyFileSync(join(ROOT, "src/data", name), join(partial, name));
    }
    expectRefusal({
      label: "missing-intervention",
      env: { SCENE_DATA_SITE_DATA: partial },
      matches: [/missing required source/, /attribution against patching/, /build_intervention\.py/],
    });
    rmSync(partial, { recursive: true, force: true });
  });

  test("the ban list is gone, and the check refuses to hand-write one", () => {
    const partial = scratch("no-ban-list");
    for (const name of ["run-series.json", "grader-cards.json", "intervention.json"]) {
      copyFileSync(join(ROOT, "src/data", name), join(partial, name));
    }
    expectRefusal({
      label: "missing-ban-list",
      env: { SCENE_DATA_SITE_DATA: partial },
      matches: [/internal identifiers/, /refuses to hand-write a substitute/],
    });
    rmSync(partial, { recursive: true, force: true });
  });
});

describe("the truth gates refuse real output, not only a probe", () => {
  test("a schematic case carrying a quantitative encoding", () => {
    expectRefusal({
      label: "schematic-encoding",
      env: { SCENE_DATA_INJECT: "schematic-encoding" },
      matches: [
        /is schematic and declares 1 quantitative encoding/,
        /a construction may not carry measured geometry/,
        /nothing was written/,
      ],
    });
  });

  test("an absolute local path in a generated field", () => {
    expectRefusal({
      label: "local-path",
      env: { SCENE_DATA_INJECT: "local-path" },
      matches: [/carries a local path/, /source\.repositoryPath/],
    });
  });

  test("an internal identifier in a public label", () => {
    expectRefusal({
      label: "banned-term",
      env: { SCENE_DATA_INJECT: "banned-term" },
      matches: [/publicLabel carries the internal identifier/, /D-05/],
    });
  });

  test("an array in the payload that no encoding accounts for", () => {
    expectRefusal({
      label: "undeclared-array",
      env: { SCENE_DATA_INJECT: "undeclared-array" },
      matches: [/no encoding names it/, /series\.hackRate/],
    });
  });

  test("the truth gate itself, blinded", () => {
    // If violatesTruthMode ever stops refusing what it is supposed to refuse,
    // every case in the manifest would pass for no reason. The probe that runs
    // before every build is what catches that, and this is the proof the probe
    // works: the gate is replaced with one that approves everything, and the
    // build stops before it reads a single artifact.
    expectRefusal({
      label: "broken-gate",
      env: { SCENE_DATA_INJECT: "broken-truth-gate" },
      matches: [/did not refuse a case it must refuse/, /not capable of failing/],
    });
  });
});

describe("the generator rejects what it cannot understand", () => {
  test("an unknown argument", () => {
    const result = runGenerator({ args: ["--danger"] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /unknown argument --danger/);
  });
});
