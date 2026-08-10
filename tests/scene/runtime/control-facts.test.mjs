/**
 * What the controls say, checked against the record and against the ruling.
 *
 * The score-component control and the rollout trace both display numbers. The
 * only way a displayed number goes wrong quietly is for the arithmetic behind
 * it to drift while the sentence around it stays the same, so the arithmetic is
 * checked here against values verified by hand outside the generator:
 * `design/scene/EVIDENCE-VERDICTS.md` §4 records step 0's eight signed
 * advantages, and the generated caption records the score tree's own counts.
 *
 * The last test in this file is the one that matters most. It asserts the
 * absence of a number: the reward-composition counterfactual, which §5 rules
 * has no per-item artifact anywhere and may not become a control's displayed
 * result.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs, closeLoader } from "../materials/load.mjs";

const facts = await loadTs("src/components/scene-controls/facts.ts");
const objects = await loadTs("src/components/scene-controls/objects.ts");

after(() => closeLoader());

test("the score-component control reads this run's real counts", () => {
  const f = facts.scoreComponentFacts();
  assert.equal(f.leafCount, 1, "the recorded run's score tree has exactly one leaf");
  assert.equal(f.leafName, "length_reward");
  assert.equal(f.rolloutCount, 1600);
  assert.equal(f.scoredRolloutCount, 1400);
  assert.equal(f.abstainedRolloutCount, 200);
  assert.equal(
    f.reinforcedCount + f.discouragedCount + f.onAxisCount,
    f.rolloutCount,
    "the three advantage classes must partition the rollouts",
  );
  assert.equal(f.onAxisCount, 220, "220 recorded advantages are exactly zero");
});

test("the traced rollouts are the recorded step's own eight, with the verified values", () => {
  const rows = facts.tracedRollouts(0);
  assert.equal(rows.length, 8, "the recorded step holds eight rollouts in two groups");

  // EVIDENCE-VERDICTS.md §4: step 0's eight signed values are on file. These
  // are them, to six places, in the record's own order.
  const expected = [1.058574, -0.132322, -0.926253, 0, -1.427123, 0.259477, 0.259477, 0.90817];
  rows.forEach((row, i) => {
    assert.ok(
      Math.abs(row.advantage - expected[i]) < 1e-5,
      `rollout ${i} advantage is ${row.advantage}, and the fixture's verified value is ${expected[i]}`,
    );
  });

  assert.deepEqual(
    rows.map((r) => r.id),
    ["s000-g0-r0", "s000-g0-r1", "s000-g0-r2", "s000-g0-r3", "s000-g1-r0", "s000-g1-r1", "s000-g1-r2", "s000-g1-r3"],
    "the ids must come from the record's step, group and position, not from an array index",
  );
  for (const row of rows) {
    assert.equal(row.groupSize, 4, "each recorded group holds four rollouts");
    assert.ok(Number.isFinite(row.groupMean) && Number.isFinite(row.groupStd));
  }
});

test("the trace ids are unique and stable", () => {
  const rows = facts.tracedRollouts(0);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.equal(facts.rolloutId(0, 1, 3), "s000-g1-r3");
  assert.equal(facts.rolloutId(199, 0, 0), "s199-g0-r0");
});

test("every object the manifest draws has a label a reader can use", () => {
  for (const object of objects.allManifestObjects()) {
    const label = objects.labelFor(object);
    assert.ok(label.label.length > 0 && label.gloss.length > 0, `"${object}" has an empty label`);
    assert.notEqual(
      label.label,
      object,
      `"${object}" is labelled with its own identifier; the legend prints prose and the ` +
        `identifier travels in a data attribute`,
    );
  }
});

test("a legend is derived from the case's own encodings", () => {
  const legend = objects.legendFor("selection-advantages");
  assert.deepEqual(
    legend.map((e) => e.object),
    ["RolloutRay", "GroupBracket"],
    "the legend must list exactly the objects that case's encodings drive, in declaration order",
  );
  assert.ok(legend[0].quantities.includes("advantage"));
});

test("the score control's rendered output states the record's result and encodes no counterfactual", () => {
  const source = readFileSync(
    new URL("../../../src/components/scene-controls/score-toggle.astro", import.meta.url),
    "utf8",
  );

  // The banned pair, in every form the build has previously written them.
  for (const forbidden of [/\b2,?118\b/, /\b2118\b/]) {
    assert.ok(
      !forbidden.test(source),
      "the score-component control renders the reward-composition counterfactual's sign-reversal " +
        "count. EVIDENCE-VERDICTS.md §5: that result has no per-item artifact in either published " +
        "repository, so it may be stated in prose with its limitation and may not become a " +
        "control's displayed result.",
    );
  }
  assert.ok(
    /no per-rollout record of it ships with\s*\n?\s*this site/.test(source.replace(/\s+/g, " ")) ||
      /No per-rollout record of it ships with this site/.test(source.replace(/\s+/g, " ")),
    "the control must state the counterfactual's limitation where it mentions it",
  );
  assert.ok(
    /scoreComponentFacts\(\)/.test(source),
    "the control must take its numbers from the generated record rather than from typed literals",
  );
});
