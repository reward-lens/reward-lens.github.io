/**
 * Gate 7, the banned-identifier gate, shown failing. C-56.
 *
 *   node --test tests/regression/banned-gate.test.mjs
 *
 * D-40 rules that `/evidence/<id>/` may carry the store's own keys and that
 * `/evidence/` the index may not. Gate 6 implements that; gate 7 never did, so
 * every one of the 27 record pages failed it on `H-avp`, `K-err` and their
 * siblings, which are the record's own field values. This file is the proof
 * that the clause added to `scripts/checks/banned.mjs` is the clause D-40
 * describes and not a wider one.
 *
 * An allowance is a hole in a gate, and a hole that is wider than it was
 * written to be is indistinguishable from a working gate until something ships
 * through it. So every case below plants THE SAME STRING in two places and
 * asserts opposite outcomes: red on the index, green on the record. A gate that
 * had been "fixed" with a `/evidence/` prefix would pass the record case and
 * fail this file on the index case, which is the mistake D-40's correction of
 * 2026-08-08 records somebody already making once.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE = join(ROOT, "scripts", "checks", "banned.mjs");

/** Three families from D-05's table, enough to exercise the word boundary. */
const TERMS = ["H-avp", "K-err", "ADJ-AVP", "W4.4", "S12", "R2"];

const page = (title, body) =>
  [
    "<!DOCTYPE html>",
    '<html lang="en"><head>',
    `<title>${title}</title>`,
    "</head><body>",
    "<main>",
    body,
    "</main>",
    "</body></html>",
  ].join("\n");

let dist;
let termsFile;

function write(route, html) {
  const dir = route === "/" ? dist : join(dist, route.replace(/^\/|\/$/g, ""));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
}

/** A real 32-hex store id, taken from the built site rather than invented. */
const RECORD_ID = "a34457e83cd4eec10d080804a2533e82";

function baseline() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  write("/", page("reward-lens", "<p>Take a reward score apart and follow it.</p>"));
  write("/evidence/", page("Evidence", "<p>Every number resolves to a source.</p>"));
  write(`/evidence/${RECORD_ID}/`, page("A record", "<p>A reading and its provenance.</p>"));
  write("/atlas/", page("Atlas", "<p>Ninety-five instruments, by what they measure.</p>"));
  write("/log/", page("Research log", "<p>The v2 campaign, kept whole.</p>"));
}

function run() {
  const r = spawnSync(process.execPath, [GATE, dist], {
    encoding: "utf-8",
    env: { ...process.env, BANNED_TERMS: termsFile },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("gate 7 · banned identifiers", () => {
  before(() => {
    dist = mkdtempSync(join(tmpdir(), "banned-gate-"));
    termsFile = join(dist, "..", `banned-terms-${process.pid}.json`);
    writeFileSync(termsFile, JSON.stringify({ terms: TERMS }));
  });

  after(() => {
    rmSync(dist, { recursive: true, force: true });
    rmSync(termsFile, { force: true });
  });

  test("a clean dist passes, and says how much it looked at", () => {
    baseline();
    const { code, out } = run();
    assert.equal(code, 0, out);
    assert.match(out, /banned: \d+ terms, \d+ of \d+ pages swept/);
    assert.match(out, /allowances applied:/);
  });

  test("an empty dist fails rather than reporting a clean sheet", () => {
    rmSync(dist, { recursive: true, force: true });
    mkdirSync(dist, { recursive: true });
    const { code, out } = run();
    assert.equal(code, 1, out);
    assert.match(out, /no built pages under/);
    baseline();
  });

  // The two demonstrations C-56 asks for, one string at a time.
  for (const term of ["H-avp", "K-err", "ADJ-AVP"]) {
    test(`D-40: "${term}" fails on the /evidence/ index`, () => {
      baseline();
      write("/evidence/", page("Evidence", `<p>${term} refuted</p>`));
      const { code, out } = run();
      assert.equal(code, 1, out);
      assert.match(out, new RegExp(`FAIL banned identifier "${term}"`));
      assert.match(out, /\/evidence\//);
    });

    test(`D-40: "${term}" passes on an /evidence/<32-hex>/ record`, () => {
      baseline();
      write(`/evidence/${RECORD_ID}/`, page("A record", `<p>${term} refuted</p>`));
      const { code, out } = run();
      assert.equal(code, 0, out);
    });
  }

  test("the allowance is anchored: a deeper path under a record is still swept", () => {
    baseline();
    write(`/evidence/${RECORD_ID}/raw/`, page("Raw", "<p>H-avp refuted</p>"));
    const { code, out } = run();
    assert.equal(code, 1, out);
    assert.match(out, /FAIL banned identifier "H-avp"/);
  });

  test("the allowance is a hex id, not any slug under /evidence/", () => {
    baseline();
    write("/evidence/the-localization-adjudication/", page("Slug", "<p>H-avp refuted</p>"));
    const { code, out } = run();
    assert.equal(code, 1, out);
    assert.match(out, /FAIL banned identifier "H-avp"/);
  });

  test("the allowance reports how many routes it covered", () => {
    baseline();
    const { out } = run();
    assert.match(out, /\/\^\\\/evidence\\\/\[0-9a-f\]\{32\}\\\/\$\/=1/);
  });

  test("an allowance that matches nothing says so", () => {
    baseline();
    rmSync(join(dist, "evidence", RECORD_ID), { recursive: true, force: true });
    const { out } = run();
    assert.match(out, /NOTE banned: the allowance .*evidence.* matched 0 of/);
  });

  // -------------------------------------------------------------------------
  // The R2 collision. Same string, same page, opposite outcomes.
  // -------------------------------------------------------------------------
  //
  // `R2` is prediction R2 in the registry and R², the coefficient of
  // determination, in the run bundle's expected output on /see/run/. The gate
  // flagged the statistic. The allowance that fixed it is shaped rather than
  // named, so these cases are the width of the hole: everything that is not a
  // labelled row in a fixed-width numeric block still fails, including on the
  // very page the allowance was written for.

  /** The block verbatim from dist/see/run/, three rows of it. */
  const FIT_TABLE =
    "<pre><code>                       this fit    frozen ledger\n" +
    "transition midpoint    106.9368    106.0000\n" +
    "10-to-90 width          23.9823     23.9000\n" +
    "R2                      0.99555     0.99600\n" +
    "</code></pre>";

  test("R2 labelling a row of numbers in a verbatim block is not an identifier", () => {
    baseline();
    write("/see/run/", page("The run", FIT_TABLE));
    const { code, out } = run();
    assert.equal(code, 0, out);
    assert.match(out, /context allowance "R2 as a coefficient of determination[^"]*" covered 1 hit/);
  });

  test("R2 in prose on the same page still fails", () => {
    baseline();
    write(
      "/see/run/",
      page("The run", `${FIT_TABLE}<p>Prediction R2 was registered before the run.</p>`),
    );
    const { code, out } = run();
    assert.equal(code, 1, out);
    assert.match(out, /FAIL banned identifier "R2" on 1 route\(s\): \/see\/run\//);
    // And the statistic in the same file is still allowed, so the failure is
    // the sentence and not the table.
    assert.match(out, /context allowance "R2 as a coefficient of determination[^"]*" covered 1 hit/);
  });

  test("R2 inside a verbatim block but next to a word still fails", () => {
    baseline();
    write("/see/run/", page("The run", "<pre><code>R2 was the registered prediction\n</code></pre>"));
    const { code, out } = run();
    assert.equal(code, 1, out);
    assert.match(out, /FAIL banned identifier "R2"/);
  });

  test("R2 shaped like a row label but outside a verbatim block still fails", () => {
    baseline();
    write("/see/run/", page("The run", "<p>R2   0.99555 stated in running text.</p>"));
    const { code, out } = run();
    assert.equal(code, 1, out);
    assert.match(out, /FAIL banned identifier "R2"/);
  });

  test("the allowance is for R2 alone: R1, R3 and R4 collide with nothing", () => {
    baseline();
    write("/see/run/", page("The run", FIT_TABLE.replace("R2", "R4")));
    const { code, out } = run();
    // R4 is not in this fixture's term list, so widen it for one run.
    assert.equal(code, 0, out);
    const wide = join(dist, "..", `banned-terms-wide-${process.pid}.json`);
    writeFileSync(wide, JSON.stringify({ terms: [...TERMS, "R4"] }));
    const r = spawnSync(process.execPath, [GATE, dist], {
      encoding: "utf-8",
      env: { ...process.env, BANNED_TERMS: wide },
    });
    rmSync(wide, { force: true });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(`${r.stdout}${r.stderr}`, /FAIL banned identifier "R4"/);
  });

  test("a context allowance that covers nothing says so", () => {
    baseline();
    const { out } = run();
    assert.match(out, /NOTE banned: the context allowance "R2 as a coefficient[^"]*" covered 0 hits/);
  });

  test("/log/ keeps the identifiers and / does not", () => {
    baseline();
    write("/log/", page("Research log", "<p>ADJ-AVP was adjudicated refuted.</p>"));
    assert.equal(run().code, 0);
    write("/", page("reward-lens", "<p>ADJ-AVP was adjudicated refuted.</p>"));
    const { code, out } = run();
    assert.equal(code, 1, out);
    assert.match(out, /FAIL banned identifier "ADJ-AVP" on 1 route\(s\): \//);
  });
});

// ---------------------------------------------------------------------------
// The /docs/ allowance: reward_lens 3.0.0's published vocabulary
// ---------------------------------------------------------------------------
//
// /docs/ documents the shipped library, which publishes its science, theorem
// and instrument codes as names a user types: `s06_topology` is an import path,
// `A1` is printed beside `KUI` in the API reference, `C2` is printed beside
// `heritability`. Those are permitted under /docs/ and nowhere else.
//
// THE ALLOWANCE READS THE FAMILY MAP, NOT THE SHAPE OF THE STRING, and that is
// what these cases are for. `E20` and `A1` are both a capital letter and a
// number; a regex over the shape permits both, and one of them is an erratum
// nobody can resolve. So every case below plants a string under /docs/ and the
// only thing separating a pass from a fail is which family the map puts it in.
describe("gate 7 · the /docs/ published-vocabulary allowance", () => {
  /* Deliberately overlapping shapes. `A1` and `E3` are indistinguishable by
     pattern; `E3` is in two families and `E20` in one, and only the map says so.
     `Z9` is in the term list and in no family at all. */
  const FAMILIES = {
    science: ["S6", "s06_topology"],
    theorem: ["T11"],
    instrument: ["A1", "C2", "E3"],
    errata: ["E3", "E20"],
    "campaign card": ["TOPO-HODGE"],
    prediction: ["R3"],
    "work package": ["W4.4"],
  };
  const ALL = [...new Set(Object.values(FAMILIES).flat()), "Z9"];

  let d;
  let tf;

  const w = (route, html) => {
    const dir = route === "/" ? d : join(d, route.replace(/^\/|\/$/g, ""));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), html);
  };

  const go = (termsFile = tf) => {
    const r = spawnSync(process.execPath, [GATE, d], {
      encoding: "utf-8",
      env: { ...process.env, BANNED_TERMS: termsFile },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  const clean = () => {
    rmSync(d, { recursive: true, force: true });
    mkdirSync(d, { recursive: true });
    w("/", page("reward-lens", "<p>Take a reward score apart and follow it.</p>"));
  };

  before(() => {
    d = mkdtempSync(join(tmpdir(), "banned-docs-"));
    tf = join(d, "..", `banned-docs-terms-${process.pid}.json`);
    writeFileSync(tf, JSON.stringify({ terms: ALL, families: FAMILIES }));
  });

  after(() => {
    rmSync(d, { recursive: true, force: true });
    rmSync(tf, { force: true });
  });

  // The pair that is the whole ruling: same string, two routes, two outcomes.
  for (const [term, family] of [
    ["S6", "science"],
    ["s06_topology", "science"],
    ["T11", "theorem"],
    ["A1", "instrument"],
    ["C2", "instrument"],
  ]) {
    test(`a published ${family} id, "${term}", passes under /docs/`, () => {
      clean();
      w("/docs/api/measure/", page("Reference", `<p>The observable is ${term}.</p>`));
      const { code, out } = go();
      assert.equal(code, 0, out);
      assert.match(out, /context allowance "reward_lens 3\.0\.0's published[^"]*" covered 1 hit/);
    });

    test(`the same "${term}" fails on a route that is not /docs/`, () => {
      clean();
      w("/about/", page("About", `<p>The observable is ${term}.</p>`));
      const { code, out } = go();
      assert.equal(code, 1, out);
      assert.match(out, new RegExp(`FAIL banned identifier "${term}" on 1 route\\(s\\): /about/`));
      // And nothing was absorbed on the way past.
      assert.match(out, /context allowance "reward_lens 3\.0\.0's published[^"]*" covered 0 hit/);
    });
  }

  // The point of keying on family rather than shape. Each of these looks exactly
  // like a permitted id and none of them is one.
  for (const [term, why] of [
    ["E20", "an erratum, and it is shaped like the E-series instruments"],
    ["TOPO-HODGE", "a campaign card"],
    ["R3", "a prediction, shaped like nothing a reader can resolve"],
    ["W4.4", "a work package"],
  ]) {
    test(`"${term}" is ${why}, so it fails under /docs/ too`, () => {
      clean();
      w("/docs/caveats/", page("Caveats", `<p>See ${term} for the detail.</p>`));
      const { code, out } = go();
      assert.equal(code, 1, out);
      assert.match(out, new RegExp(`FAIL banned identifier "${term}"`));
      assert.match(out, /context allowance "reward_lens 3\.0\.0's published[^"]*" covered 0 hit/);
    });
  }

  test("a term in two families, one permitted and one not, is not permitted", () => {
    clean();
    // E3 is an instrument AND an erratum, the collision the gate's header opens
    // with. The map does not settle which one a reader is looking at, so the ban
    // stands. This is the case a shape rule gets wrong in the dangerous
    // direction, because E3 is spelled exactly like the instruments E1 to E6.
    w("/docs/api/measure/", page("Reference", "<p>The estimator is E3.</p>"));
    const { code, out } = go();
    assert.equal(code, 1, out);
    assert.match(out, /FAIL banned identifier "E3" on 1 route\(s\): \/docs\/api\/measure\//);
    assert.match(out, /context allowance "reward_lens 3\.0\.0's published[^"]*" covered 0 hit/);
  });

  test("a term the family map does not classify is not permitted", () => {
    clean();
    w("/docs/api/measure/", page("Reference", "<p>The quantity is Z9.</p>"));
    const { code, out } = go();
    assert.equal(code, 1, out);
    assert.match(out, /FAIL banned identifier "Z9"/);
  });

  test("the allowance is /docs/ and not a page whose name merely starts with it", () => {
    clean();
    w("/docsy/", page("Docsy", "<p>The observable is A1.</p>"));
    const { code, out } = go();
    assert.equal(code, 1, out);
    assert.match(out, /FAIL banned identifier "A1" on 1 route\(s\): \/docsy\//);
  });

  test("the allowance reports the hits and routes it covered", () => {
    clean();
    w("/docs/api/measure/", page("Reference", "<p>A1 and C2.</p>"));
    w("/docs/sciences/", page("Sciences", "<p>T11 and S6.</p>"));
    const { code, out } = go();
    assert.equal(code, 0, out);
    assert.match(
      out,
      /context allowance "reward_lens 3\.0\.0's published[^"]*" covered 4 hit\(s\) on 2 route\(s\)/,
    );
  });

  test("an allowance that covers nothing says so", () => {
    clean();
    const { out } = go();
    assert.match(
      out,
      /NOTE banned: the context allowance "reward_lens 3\.0\.0's published[^"]*" covered 0 hits/,
    );
  });

  test("without a family map the allowance is inert, and says why", () => {
    clean();
    w("/docs/api/measure/", page("Reference", "<p>The observable is A1.</p>"));
    const bare = join(d, "..", `banned-docs-nofam-${process.pid}.json`);
    writeFileSync(bare, JSON.stringify({ terms: ALL }));
    const { code, out } = go(bare);
    rmSync(bare, { force: true });
    assert.equal(code, 1, out);
    assert.match(out, /carries no "families" map/);
    assert.match(out, /FAIL banned identifier "A1"/);
  });
});
