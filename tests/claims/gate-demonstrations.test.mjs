/**
 * Every condition gate 25 checks, demonstrated failing.
 *
 *   node --test tests/claims/gate-demonstrations.test.mjs
 *
 * WHY THIS IS A TEST AND NOT A TRANSCRIPT. Five gates in this repository have
 * passed or failed for the wrong reason, and every one was found by someone
 * building against them rather than reading them: gate 4 compared zero values
 * and exited 0 (C-49), gate 15 scanned zero files (C-38), gate 24 deleted
 * every hex literal before looking for hex literals (C-38), gate 17 failed
 * every route by arithmetic (C-38), gate 21 applied a ceiling to a rectangle
 * containing the text it protects (D-38). A one-off demonstration proves the
 * gate could fail on the day somebody ran it. This one runs in CI and proves
 * it still can.
 *
 * HOW A VIOLATION IS MADE. Most conditions are about RENDERED output, so each
 * gets a purpose-built page in a temporary dist that the gate is pointed at by
 * argument. Nothing touches the real dist/. The three conditions that are
 * about the generated claim set mutate a real file, capture its bytes first,
 * and write them back; `node scripts/build_claims.mjs --check` then proves the
 * tree is byte-identical to the adapter's output, which is a stronger revert
 * proof than reading the file back.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE = join(ROOT, "scripts", "checks", "claims-public.mjs");
const ADAPTER = join(ROOT, "scripts", "build_claims.mjs");
const CLAIMS = join(ROOT, "src", "data", "claims");
const REAL_DIST = join(ROOT, "dist");

/** Run a node script and return { code, out }. Never throws on a failure. */
const run = (script, args = []) => {
  try {
    const out = execFileSync(process.execPath, [script, ...args], {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

const scratch = mkdtempSync(join(tmpdir(), "claims-demo-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
/** A one-page dist at a chosen route, and the gate's verdict on it. */
const distWith = (route, body) => {
  const dir = join(scratch, `d${(n += 1)}`);
  const at = join(dir, route.replace(/^\/|\/$/g, ""));
  mkdirSync(at, { recursive: true });
  writeFileSync(
    join(at, "index.html"),
    `<!doctype html><html><body><main>${body}</main></body></html>`,
  );
  return run(GATE, [dir]);
};

/**
 * A rendered claim, in the shape provenance-chip.astro emits. Written out
 * rather than imported so a change to the component that silently stopped
 * emitting an attribute shows up here as a test that no longer demonstrates
 * anything, instead of as a test that quietly follows the component.
 */
const chip = ({ slug, type, status, value, disclosure }) =>
  `<span data-prov data-claim="${slug}" data-claim-type="${type}"` +
  (status ? ` data-claim-status="${status}"` : "") +
  ` data-claim-resolution="field">` +
  `<button type="button" class="prov__trigger" data-provenance` +
  (value !== undefined ? ` data-claim-value="${value}"` : "") +
  `>x</button>` +
  `<span class="prov__panel" data-provenance-panel data-claim-disclosure>${disclosure}</span>` +
  `</span>`;

/** Mutate a real file, run the body, and put the bytes back. */
const withMutation = (path, mutate, body) => {
  const original = readFileSync(path, "utf-8");
  try {
    writeFileSync(path, mutate(original));
    return body();
  } finally {
    writeFileSync(path, original);
  }
};

/* =======================================================================
   The conditions
   ======================================================================= */

const messages = [];
const record = (condition, message) => {
  messages.push({ condition, message: message.trim() });
};

describe("gate 25 · every condition fails on a controlled violation", () => {
  test("1 · a claim slug that does not resolve", () => {
    const r = distWith(
      "/demo/",
      chip({
        slug: "measured-no-such-study-no-such-metric",
        type: "measured-result",
        disclosure: "<span>Where it came from.</span>",
      }),
    );
    assert.equal(r.code, 1);
    const line = r.out.split("\n").find((l) => l.startsWith("FAIL claims 1:"));
    assert.ok(line, `no condition-1 failure in:\n${r.out}`);
    assert.match(line, /does not resolve against src\/data\/claims\//);
    record(1, line);
  });

  test("2 · a measured result with no limitation", () => {
    const path = join(CLAIMS, "measured-err-rb2-err-auroc-delta-qwen8b.json");
    const r = withMutation(
      path,
      (s) => {
        const c = JSON.parse(s);
        delete c.limitation;
        return JSON.stringify(c, null, 1) + "\n";
      },
      () => run(GATE, [REAL_DIST]),
    );
    assert.equal(r.code, 1);
    const line = r.out
      .split("\n")
      .find((l) => l.startsWith("FAIL claims 2:") && l.includes("limitation"));
    assert.ok(line, `no condition-2 failure in:\n${r.out}`);
    record(2, line);
  });

  test("3 · a number in a disclosure that is nowhere in its claim", () => {
    const r = distWith(
      "/demo/",
      chip({
        slug: "study-err-rb2",
        type: "interpretation",
        disclosure: "<span>Measured on 41 subjects that nothing in the claim mentions.</span>",
      }),
    );
    assert.equal(r.code, 1);
    const line = r.out.split("\n").find((l) => l.startsWith("FAIL claims 3:"));
    assert.ok(line, `no condition-3 failure in:\n${r.out}`);
    assert.match(line, /nowhere in the claim/);
    record(3, line);
  });

  test("4a · the value in prose disagrees with the claim", () => {
    const r = distWith(
      "/demo/",
      chip({
        slug: "measured-err-rb2-err-auroc-delta-qwen8b",
        type: "measured-result",
        value: "0.42",
        disclosure: "<span>Where it came from.</span>",
      }),
    );
    assert.equal(r.code, 1);
    const line = r.out.split("\n").find((l) => l.startsWith("FAIL claims 4:"));
    assert.ok(line, `no condition-4 failure in:\n${r.out}`);
    assert.match(line, /value in prose and the value in its claim disagree/);
    record("4a", line);
  });

  test("4b · prose and figure show one claim as two values", () => {
    const slug = "measured-err-rb2-err-auroc-delta-qwen8b";
    const real = JSON.parse(readFileSync(join(CLAIMS, `${slug}.json`), "utf-8"));
    const dir = join(scratch, `d${(n += 1)}`);
    for (const [route, value] of [
      ["prose", String(real.quantity.value)],
      ["figure", String(real.quantity.value).slice(0, -1)],
    ]) {
      mkdirSync(join(dir, route), { recursive: true });
      writeFileSync(
        join(dir, route, "index.html"),
        `<!doctype html><html><body><main>${chip({
          slug,
          type: "measured-result",
          value,
          disclosure: "<span>Where it came from.</span>",
        })}</main></body></html>`,
      );
    }
    const r = run(GATE, [dir]);
    assert.equal(r.code, 1);
    const line = r.out
      .split("\n")
      .find((l) => l.startsWith("FAIL claims 4:") && l.includes("more than one value"));
    assert.ok(line, `no condition-4b failure in:\n${r.out}`);
    record("4b", line);
  });

  test("5 · the sign disagrees with the source plate", () => {
    const path = join(CLAIMS, "measured-err-rb2-err-auroc-delta-qwen8b.json");
    const r = withMutation(
      path,
      (s) => {
        const c = JSON.parse(s);
        c.quantity.value = Math.abs(c.quantity.value);
        return JSON.stringify(c, null, 1) + "\n";
      },
      () => run(GATE, [REAL_DIST]),
    );
    assert.equal(r.code, 1);
    const line = r.out.split("\n").find((l) => l.startsWith("FAIL claims 5:"));
    assert.ok(line, `no condition-5 failure in:\n${r.out}`);
    assert.match(line, /sign/);
    record("5 sign", line);
  });

  test("5 · the unit disagrees with the source plate", () => {
    const path = join(CLAIMS, "derived-decomposition-curl.json");
    const r = withMutation(
      path,
      (s) => {
        const c = JSON.parse(s);
        c.quantity.unit = "percent";
        return JSON.stringify(c, null, 1) + "\n";
      },
      () => run(GATE, [REAL_DIST]),
    );
    assert.equal(r.code, 1);
    const line = r.out
      .split("\n")
      .find((l) => l.startsWith("FAIL claims 5:") && l.includes("unit"));
    assert.ok(line, `no condition-5 unit failure in:\n${r.out}`);
    record("5 unit", line);
  });

  test("6a · a refuted result relabelled supported", () => {
    const path = join(CLAIMS, "measured-err-rb2-err-auroc-delta-qwen8b.json");
    const r = withMutation(
      path,
      (s) => s.replace('"status": "refuted"', '"status": "supported"'),
      () => run(GATE, [REAL_DIST]),
    );
    assert.equal(r.code, 1);
    const line = r.out.split("\n").find((l) => l.startsWith("FAIL claims 6:"));
    assert.ok(line, `no condition-6 failure in:\n${r.out}`);
    assert.match(line, /never interchanged/);
    record("6a", line);
  });

  test("6b · a rendered status word that is not the claim's", () => {
    const r = distWith(
      "/demo/",
      chip({
        slug: "measured-err-rb2-err-auroc-delta-qwen8b",
        type: "measured-result",
        status: "inconclusive",
        disclosure: "<span>Where it came from.</span>",
      }),
    );
    assert.equal(r.code, 1);
    const line = r.out
      .split("\n")
      .find((l) => l.startsWith("FAIL claims 6:") && l.includes("renders"));
    assert.ok(line, `no condition-6b failure in:\n${r.out}`);
    record("6b", line);
  });

  test("7 · a campaign identifier inside a normal public disclosure", () => {
    const r = distWith(
      "/demo/",
      chip({
        slug: "study-err-rb2",
        type: "interpretation",
        disclosure: "<span>Taken from campaign.adjudication.ERR-RB2 in the store.</span>",
      }),
    );
    assert.equal(r.code, 1);
    const line = r.out.split("\n").find((l) => l.startsWith("FAIL claims 7:"));
    assert.ok(line, `no condition-7 failure in:\n${r.out}`);
    assert.match(line, /normal public disclosure/);
    record(7, line);
  });

  test("8 · a page telling a reader the install gets a superseded version", () => {
    const r = distWith(
      "/demo/",
      `<p>Install with pip and you get reward-lens 2.0.1.</p>` +
        chip({
          slug: "study-err-rb2",
          type: "interpretation",
          disclosure: "<span>Where it came from.</span>",
        }),
    );
    assert.equal(r.code, 1);
    const line = r.out.split("\n").find((l) => l.startsWith("FAIL claims 8:"));
    assert.ok(line, `no condition-8 failure in:\n${r.out}`);
    assert.match(line, /package index serves/);
    record(8, line);
  });

  test("9 · the deprecated value outside the route that may carry it", () => {
    const r = distWith(
      "/demo/",
      `<p>The measurement came in at 0.256 on that run.</p>` +
        chip({
          slug: "study-err-rb2",
          type: "interpretation",
          disclosure: "<span>Where it came from.</span>",
        }),
    );
    assert.equal(r.code, 1);
    const line = r.out.split("\n").find((l) => l.startsWith("FAIL claims 9:"));
    assert.ok(line, `no condition-9 failure in:\n${r.out}`);
    assert.match(line, /retired value/);
    record("9 (D-02, C-55)", line);
  });

  test("9 · the same value on /log/, which is where the correction lives, does not fire", () => {
    const r = distWith(
      "/log/",
      `<p>The measurement came in at 0.256 on that run, and it was corrected.</p>` +
        chip({
          slug: "study-err-rb2",
          type: "interpretation",
          disclosure: "<span>Where it came from.</span>",
        }),
    );
    // Not `exit 0`. A one-page dist on an exempt route legitimately compares
    // nothing under conditions 3 and 9, and the gate's zero-comparison guard
    // fails it for THAT, which is the guard working. The claim under test is
    // narrower and it is the one D-02 makes: the value is allowed here.
    assert.equal(
      r.out.split("\n").filter((l) => l.includes("renders the retired value")).length,
      0,
      `the allowed route was failed for carrying the value D-02 allows it to carry:\n${r.out}`,
    );
  });

  test("6c · an unrun study relabelled inconclusive", () => {
    // The two words are different facts: an inconclusive result is evidence
    // that did not decide, an unrun study is an absence of evidence. Every
    // inconclusive outcome in this store is an execution failure, so this is
    // the substitution that would make the project look like it tested more
    // than it did.
    const slug = readdirSync(CLAIMS)
      .filter((f) => f.startsWith("open-") && f.endsWith(".json"))
      .map((f) => f.slice(0, -5))[0];
    const path = join(CLAIMS, `${slug}.json`);
    const r = withMutation(
      path,
      (s) => s.replace('"status": "unrun"', '"status": "inconclusive"'),
      () => run(GATE, [REAL_DIST]),
    );
    assert.equal(r.code, 1);
    const line = r.out
      .split("\n")
      .find((l) => l.startsWith("FAIL claims 6:") && l.includes("inconclusive"));
    assert.ok(line, `no condition-6c failure in:\n${r.out}`);
    record("6c", line);
  });

  test("8b · the release record claiming an unpublished version", () => {
    const path = join(ROOT, "src", "data", "release.json");
    const r = withMutation(
      path,
      (s) => {
        const d = JSON.parse(s);
        d.unpublished = "3.1.0";
        d.unpublishedIsAhead = true;
        return JSON.stringify(d, null, 1) + "\n";
      },
      () => run(GATE, [REAL_DIST]),
    );
    assert.equal(r.code, 1);
    const line = r.out
      .split("\n")
      .find((l) => l.startsWith("FAIL claims 8:") && l.includes("unpublished"));
    assert.ok(line, `no condition-8b failure in:\n${r.out}`);
    record("8b", line);
  });

  test("10 · a retired reading that comes back as a measured result", () => {
    const path = join(CLAIMS, "measured-topo-hodge-intransitive-mass.json");
    const r = withMutation(
      path,
      (s) => {
        const c = JSON.parse(s);
        c.type = "measured-result";
        c.status = "supported";
        c.quantity = { name: "intransitive_mass", value: 0.2139761313773256, unit: null };
        c.comparator = "> 0.03";
        return JSON.stringify(c, null, 1) + "\n";
      },
      () => run(GATE, [REAL_DIST]),
    );
    assert.equal(r.code, 1);
    const line = r.out.split("\n").find((l) => l.startsWith("FAIL claims 10:"));
    assert.ok(line, `no condition-10 failure in:\n${r.out}`);
    record(10, line);
  });

  test("vacuity · a dist where nothing renders a claim is not a pass", () => {
    const r = distWith("/demo/", `<p>A page with no claim on it at all.</p>`);
    assert.equal(r.code, 1);
    const line = r.out.split("\n").find((l) => l.includes("NOT ONE renders a claim"));
    assert.ok(line, `the gate passed while looking at nothing:\n${r.out}`);
    record("vacuity", line);
  });

  test("adapter · a required field the generator cannot fill", () => {
    const path = join(ROOT, "scripts", "checks", "retired-values.json");
    const r = withMutation(
      path,
      (s) => {
        const d = JSON.parse(s);
        d.retiredClaims[0].correction = "";
        return JSON.stringify(d, null, 2) + "\n";
      },
      () => run(ADAPTER),
    );
    assert.equal(r.code, 1);
    const line = r.out
      .split("\n")
      .find((l) => l.includes("required field") && l.includes("statement"));
    assert.ok(line, `the generator did not fail loudly:\n${r.out}`);
    record("adapter", line.trim());
  });
});

describe("gate 25 · and it passes on the real thing afterwards", () => {
  test("every mutated file is byte-identical to the adapter's own output", () => {
    const r = run(ADAPTER, ["--check"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /match the adapter's output/);
  });

  test("the gate passes against the real dist", () => {
    const r = run(GATE, [REAL_DIST]);
    assert.equal(r.code, 0, r.out);
  });

  test("and it prints what it deferred rather than counting it as a pass", () => {
    const r = run(GATE, [REAL_DIST]);
    // D-29's rule, and C-58's warning that a ratchet counted in entries does
    // not measure what it defers. Anything absorbed is on the record.
    assert.match(r.out, /DEFERRED, not passing|awaiting a copy\.yaml key/);
  });
});

after(() => {
  if (!process.env.CLAIM_DEMO_LOG) return;
  console.log("\n--- gate 25, every condition and the message it emitted ---");
  for (const m of messages) console.log(`[${m.condition}] ${m.message}`);
});
