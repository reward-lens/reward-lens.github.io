/**
 * The terminology lock, shown failing.
 *
 *   node --test tests/regression/terms-gate.test.mjs
 *
 * Five gates in this repository have passed or failed for the wrong reason, and
 * every one of them was found by someone building against the gate rather than
 * reading it. One reported "0 values compared" and exited 0. One had no `.mjs`
 * in its extension list and scanned zero files. One stripped Python comments
 * with `line.split("#")[0]`, deleting every hex literal before looking for hex
 * literals. The common shape is a gate nobody ever watched fail.
 *
 * So this file does not test that the gate passes. It builds a synthetic `dist`
 * that the gate certifies clean, then plants one violation class at a time and
 * asserts three things each time: the exit code is 1, the failure names the rule
 * that was supposed to catch it, and the reported line number is the line the
 * violation was planted on. The last of those is the one that matters most: a
 * gate that reports the wrong line sends the next builder to the wrong place,
 * and nothing else in the run would say so.
 *
 * It also asserts the ALLOWANCES, in the same way and for the same reason. A
 * route allowance is a hole in a gate. An allowance that is wider than it was
 * written to be is indistinguishable from a gate that works, until something
 * ships through the hole. So `/log/` and `/evidence/<id>/` are given the
 * historical vocabulary and must stay green, `/evidence/` the index is given the
 * same strings and must fail (D-40), and a redirect stub whose whole content is
 * the old `/campaign/` URL must stay green (D-26).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE = join(ROOT, "scripts", "checks", "terms.mjs");

/** A page the lock has nothing to say about. `BODY` is where a probe goes. */
const page = (title, body) =>
  [
    "<!DOCTYPE html>",
    '<html lang="en"><head>',
    `<title>${title}</title>`,
    '<meta name="description" content="Instruments for reward models.">',
    "</head><body>",
    "<main>",
    body, // line 7, 1-based, on every fixture page
    "</main>",
    "</body></html>",
  ].join("\n");

const PLANT_LINE = 7;

let dist;

function write(route, html) {
  const dir = route === "/" ? dist : join(dist, route.replace(/^\/|\/$/g, ""));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
}

/** The clean baseline, rebuilt before every case so a plant cannot leak. */
function baseline() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  write("/", page("reward-lens", "<p>Take a reward score apart and follow it.</p>"));
  write("/start/", page("Start", "<p>Install the package and load a model.</p>"));
  write("/atlas/", page("Atlas", "<p>Ninety-five instruments, by what they measure.</p>"));
  // The archive keeps the vocabulary it was recorded in.
  write(
    "/log/",
    page("Research log", "<p>The v2 campaign registered a prediction; the kill criterion fired and the card was adjudicated. rho = 0.256.</p>"),
  );
  write("/log/cards/err-rb2/", page("A card", "<p>campaign.adjudication.ERR-RB2 was adjudicated refuted.</p>"));
  // D-40: the record keeps the store's keys, the index does not.
  write("/evidence/a34316feccee3beaed93c05ce5888567/", page("A record", "<p>campaign.adjudication.ADJ-AVP</p>"));
  write("/evidence/", page("Evidence", "<p>Every number resolves to a source.</p>"));
  // D-26: a redirect is the old URL, still working, not advertised.
  write(
    "/campaign/",
    '<!DOCTYPE html>\n<html><head>\n<meta http-equiv="refresh" content="0;url=/log/">\n<link rel="canonical" href="/log/">\n</head><body>\n<a href="/log/">Redirecting from /campaign/ to the research log</a>\n</body></html>',
  );
}

function run(extraArgs = []) {
  const r = spawnSync(process.execPath, [GATE, dist, ...extraArgs], { encoding: "utf-8" });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

before(() => {
  dist = mkdtempSync(join(tmpdir(), "terms-gate-"));
});
after(() => {
  rmSync(dist, { recursive: true, force: true });
});

describe("the lock certifies its own baseline", () => {
  test("a clean dist passes, and says how much it looked at", () => {
    baseline();
    const { code, out } = run();
    assert.equal(code, 0, `expected green, got:\n${out}`);
    assert.match(out, /7 of 8 built pages scanned \(1 redirect stubs skipped\)/);
    assert.match(out, /self-test green/);
  });

  test("an empty dist fails rather than reporting a clean sheet", () => {
    rmSync(dist, { recursive: true, force: true });
    mkdirSync(dist, { recursive: true });
    const { code, out } = run();
    assert.equal(code, 1);
    assert.match(out, /no built pages/);
    assert.match(out, /reads built output, not source/);
  });

  test("every rule fires on its own probe", () => {
    const r = spawnSync(process.execPath, [GATE, "--self-test"], { encoding: "utf-8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /every one fires on its probe and none over-matches/);
  });
});

import { CLASSES } from "./terms-gate.classes.mjs";


describe("each violation class fails the gate, for its own reason, at its own line", () => {
  for (const [name, body, ruleId, expected] of CLASSES) {
    test(name, () => {
      baseline();
      write("/start/", page("Start", body));
      const { code, out } = run();
      assert.equal(code, 1, `planted "${name}" and the gate stayed green:\n${out}`);
      assert.match(out, new RegExp(`term "${ruleId}"`), `wrong rule fired for "${name}":\n${out}`);
      assert.match(
        out,
        new RegExp(`start[\\\\/]index\\.html:${PLANT_LINE}:`),
        `"${name}" was not reported at the line it was planted on:\n${out}`,
      );
      assert.ok(out.includes(expected), `the reported string did not contain ${JSON.stringify(expected)}:\n${out}`);

      // and reverting puts it back
      baseline();
      const after = run();
      assert.equal(after.code, 0, `the gate did not go green again after "${name}":\n${after.out}`);
    });
  }
});

describe("the allowances are exactly as wide as they were written to be", () => {
  test("a banned phrase in an aria-label is caught, not only in text", () => {
    baseline();
    write("/start/", page("Start", '<a href="/log/" aria-label="Read act one">More</a>'));
    const { code, out } = run();
    assert.equal(code, 1);
    assert.match(out, /term "act-numbering"/);
    assert.match(out, /@aria-label/);
  });

  test("a banned phrase in the description meta is caught", () => {
    baseline();
    write(
      "/start/",
      page("Start", "<p>Nothing to see.</p>").replace(
        'content="Instruments for reward models."',
        'content="The campaign ledger, the Atlas, the docs, the science."',
      ),
    );
    const { code, out } = run();
    assert.equal(code, 1);
    assert.match(out, /term "four-part-inventory"/);
    assert.match(out, /@meta description/);
  });

  test("a phrase split by a tag is still one phrase", () => {
    baseline();
    write("/start/", page("Start", "<p>Read <em>act</em> one.</p>"));
    const { code } = run();
    assert.equal(code, 1);
  });

  test("D-40: the store's keys pass on a record and fail on the index", () => {
    baseline();
    const before = run();
    assert.equal(before.code, 0, before.out);

    write("/evidence/", page("Evidence", "<p>campaign.adjudication.ADJ-AVP</p>"));
    const { code, out } = run();
    assert.equal(code, 1, "the evidence index inherited the record's allowance");
    assert.match(out, /term "campaign-machine-key"/);
    assert.match(out, /evidence[\\/]index\.html/);
  });

  test("D-26: a redirect stub is not scanned, and dropping the refresh exposes it", () => {
    baseline();
    const before = run();
    assert.equal(before.code, 0, before.out);

    write("/campaign/", page("Campaign", "<p>The campaign is what this site is.</p>"));
    const { code, out } = run();
    assert.equal(code, 1, "a real page under /campaign/ was treated as a redirect");
    assert.match(out, /term "campaign-prose"/);
  });

  test("the log keeps its vocabulary and the homepage does not", () => {
    baseline();
    const before = run();
    assert.equal(before.code, 0, before.out);

    write("/", page("reward-lens", "<p>The kill criterion fired and the card was adjudicated.</p>"));
    const { code, out } = run();
    assert.equal(code, 1);
    assert.match(out, /term "kill-criterion"/);
    assert.match(out, /term "adjudicated"/);
    assert.doesNotMatch(out, /log[\\/]index\.html/);
  });

  test("v2 campaign is allowed where campaign is not", () => {
    baseline();
    write("/start/", page("Start", "<p>The v2 campaign is archived under the research log.</p>"));
    assert.equal(run().code, 0);

    write("/start/", page("Start", "<p>The campaign is archived under the research log.</p>"));
    assert.equal(run().code, 1);
  });

  test("a licensing context is what makes a constrained word legal", () => {
    baseline();
    write("/start/", page("Start", "<p>Causal patching says which components carry the score.</p>"));
    assert.equal(run().code, 0, "naming the intervention did not license the word");

    write("/start/", page("Start", "<p>The strongest causal head sits at layer 0.</p>"));
    assert.equal(run().code, 1, "the word passed with no intervention named");
  });
});
