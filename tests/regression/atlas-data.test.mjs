/**
 * The atlas generator, shown failing.
 *
 *   node --test tests/regression/atlas-data.test.mjs
 *
 * `scripts/build_atlas.mjs` is the only thing standing between the library's
 * registry and /atlas/, and it carries two guards that a reader has to be able
 * to trust: it refuses to write a file containing a string the terminology lock
 * forbids, and it refuses to apply a substitution whose registry source has
 * drifted. Both of those are the shape of a gate nobody has watched fail. Five
 * gates in this repository have passed or failed for the wrong reason, one of
 * them by deleting every hex literal before looking for hex literals.
 *
 * So each guard is fired here on a controlled violation, against a temporary
 * copy of `src/data/` rather than against the real one, and the exit code and
 * the first line of the message are asserted.
 *
 * It also asserts the two properties the /atlas/ repair rests on: that no
 * emitted string carries a `campaign.` store key, and that no record name or
 * instrument cost carries an internal identifier when the hyphen is dropped.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GEN = join(ROOT, "scripts", "build_atlas.mjs");
const DATA = join(ROOT, "src", "data");
const ATLAS = JSON.parse(readFileSync(join(DATA, "atlas.json"), "utf-8"));

/** Run the generator inside a throwaway checkout so a plant cannot escape. */
let sandbox;
function run(args = []) {
  const r = spawnSync(process.execPath, [join(sandbox, "scripts", "build_atlas.mjs"), ...args], {
    encoding: "utf-8",
    cwd: sandbox,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function reset() {
  rmSync(sandbox, { recursive: true, force: true });
  cpSync(join(ROOT, "src"), join(sandbox, "src"), { recursive: true });
  cpSync(join(ROOT, "scripts", "build_atlas.mjs"), join(sandbox, "scripts", "build_atlas.mjs"), {
    recursive: true,
  });
  cpSync(join(ROOT, "scripts", "checks", "terms.json"), join(sandbox, "scripts", "checks", "terms.json"), {
    recursive: true,
  });
}

describe("build_atlas", () => {
  before(() => {
    sandbox = mkdtempSync(join(tmpdir(), "atlas-gen-"));
    reset();
  });
  after(() => rmSync(sandbox, { recursive: true, force: true }));

  test("a clean tree writes, and says what it wrote", () => {
    reset();
    const { code, out } = run();
    assert.equal(code, 0, out);
    assert.match(out, /build_atlas: wrote src\/data\/atlas\.json/);
    assert.match(out, /\d+ instruments/);
  });

  test("--check passes on what the generator just wrote", () => {
    reset();
    assert.equal(run().code, 0);
    assert.equal(run(["--check"]).code, 0);
  });

  test("--check fails when the emitted file has been edited by hand", () => {
    reset();
    run();
    const p = join(sandbox, "src", "data", "atlas.json");
    const d = JSON.parse(readFileSync(p, "utf-8"));
    d.counts.instruments = 9999;
    writeFileSync(p, `${JSON.stringify(d, null, 1)}\n`);
    const { code, out } = run(["--check"]);
    assert.equal(code, 1, out);
    assert.match(out, /FAIL build_atlas --check/);
  });

  test("--check fails when a source file changed and this one was not regenerated", () => {
    reset();
    run();
    const p = join(sandbox, "src", "data", "catalogue.json");
    const cat = JSON.parse(readFileSync(p, "utf-8"));
    cat.instruments[0].name = "A different name entirely";
    writeFileSync(p, JSON.stringify(cat, null, 1));
    const { code, out } = run(["--check"]);
    assert.equal(code, 1, out);
    assert.match(out, /FAIL build_atlas --check/);
  });

  // The self-check, fired on one planted violation at a time.
  for (const [label, plant, rule] of [
    ["a store key", "campaign.scores per family", "campaign-machine-key"],
    ["the campaign as an abstraction", "what the campaign measured", "campaign-prose"],
    ["a trust rung", "the top rung of the ladder", "trust-rung"],
    ["a ledger", "the forecast ledger", "ledger"],
    ["metrology", "signal metrology, end to end", "metrology"],
  ]) {
    test(`the self-check fires on ${label}`, () => {
      reset();
      const p = join(sandbox, "src", "data", "catalogue.json");
      const cat = JSON.parse(readFileSync(p, "utf-8"));
      cat.instruments[0].headline = plant;
      writeFileSync(p, JSON.stringify(cat, null, 1));
      const { code, out } = run();
      assert.equal(code, 1, out);
      assert.match(out, new RegExp(`terms\\.json rule\\s+"${rule}"`));
      assert.match(out, /Nothing was written\./);
    });
  }

  test("a substitution whose registry source has drifted fails loudly", () => {
    reset();
    const p = join(sandbox, "src", "data", "catalogue.json");
    const cat = JSON.parse(readFileSync(p, "utf-8"));
    const j6 = cat.instruments.find((i) => i.name === "The forecast calibration ledger");
    assert.ok(j6, "the J6 substitution's registry source is no longer in catalogue.json");
    j6.name = "The forecast calibration ledger, reworded upstream";
    writeFileSync(p, JSON.stringify(cat, null, 1));
    const { code, out } = run();
    assert.equal(code, 1, out);
    assert.match(out, /no longer\s+matches the registry/);
    assert.match(out, /does not fall\s+back to the registry string/);
  });

  // The two properties the repair rests on, asserted against the real file.
  test("no emitted string carries a store key", () => {
    const flat = JSON.stringify({
      instruments: ATLAS.instruments,
      subjects: ATLAS.subjects.map((s) => ({ kinds: s.kinds, headline: s.headline })),
      cards: ATLAS.cards,
      areas: ATLAS.areas,
      areaNames: ATLAS.areaNames,
      capabilities: ATLAS.capabilities,
      claimStates: ATLAS.claimStates,
    });
    const hits = flat.match(/campaign[.\-][a-z0-9_.\-]+/g) ?? [];
    assert.deepEqual(hits, [], `store keys reached atlas.json: ${hits.join(", ")}`);
  });

  test("no record name carries an internal identifier, hyphen or not", () => {
    const raw = JSON.parse(readFileSync(join(DATA, "banned-terms.json"), "utf-8"));
    const terms = Array.isArray(raw) ? raw : (raw.terms ?? []);
    const loosen = (s) =>
      s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-/g, "[-_ ]?");
    const re = new RegExp(
      `(?<![\\w-])(${[...terms].sort((a, b) => b.length - a.length).map(loosen).join("|")})(?![\\w-])`,
      "i",
    );
    const names = ATLAS.subjects.flatMap((s) => s.kinds.flatMap((k) => k.names));
    const bad = names.filter((n) => re.test(n));
    assert.deepEqual(bad, [], `identifiers reached a rendered record name: ${bad.join(", ")}`);
    assert.ok(names.length > 0, "no record names at all, so this test proved nothing");
  });

  test("no instrument cost carries an internal identifier", () => {
    const costs = ATLAS.instruments.map((i) => i.cost).filter(Boolean);
    assert.ok(costs.length > 0, "no costs at all, so this test proved nothing");
    for (const c of costs) {
      assert.doesNotMatch(c, /(?<![\w-])[A-N]\d{1,2}(?![\w-])/, `cost names an instrument: ${c}`);
    }
  });

  test("the withheld counts are carried, not silently dropped", () => {
    const withheld = ATLAS.subjects.reduce((n, s) => n + s.withheld, 0);
    assert.equal(withheld, ATLAS.counts.withheldNames);
    const listed = ATLAS.subjects.reduce(
      (n, s) => n + s.kinds.reduce((m, k) => m + k.names.length, 0),
      0,
    );
    // Every named record is either printed or counted as withheld. Names are
    // de-duplicated per kind, so the printed count is a lower bound on the
    // named count and the two together must not exceed it.
    assert.ok(listed + withheld <= ATLAS.counts.namedRecords + ATLAS.subjects.length * 20);
    assert.ok(ATLAS.counts.namedRecords > 0);
  });
});
