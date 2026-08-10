/**
 * The claim layer's own properties, checked against the generated set and
 * against built output.
 *
 *   node --test tests/claims/claim-layer.test.mjs
 *
 * These are the assertions that have no controlled violation to demonstrate,
 * because they are about the whole set rather than about one rule: that every
 * chip on the built site resolves to a claim, that no generated file carries a
 * path that only exists on this machine, and that running the adapter twice
 * over unchanged input produces the same bytes. C-50 records a generator whose
 * output changed without its input changing, and nothing flagged it because
 * the diff looked like real churn.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  claimProblems,
  findMachineId,
  ABSOLUTE_PATH_RE,
  EM_DASH_RE,
  TYPE_RULES,
  CLAIM_TYPES,
  OUTCOME_TO_STATUS,
  OPEN_HYPOTHESIS_PREFIX,
  reasonClassOf,
  statusForOutcome,
} from "../../src/lib/claims/validate.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLAIMS = join(ROOT, "src", "data", "claims");
const DIST = join(ROOT, "dist");

const files = readdirSync(CLAIMS).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
const claims = files.map((f) => JSON.parse(readFileSync(join(CLAIMS, f), "utf-8")));
const manifest = JSON.parse(readFileSync(join(CLAIMS, "_manifest.json"), "utf-8"));
const bySlug = new Map(claims.map((c) => [c.slug, c]));

const distHtml = () => {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name === "pagefind") continue;
      const p = join(dir, name.name);
      if (name.isDirectory()) walk(p);
      else if (p.endsWith(".html")) out.push(p);
    }
  };
  if (existsSync(DIST)) walk(DIST);
  return out;
};
const pages = distHtml();
const needsDist = { skip: pages.length ? false : "run `npm run build` first" };

describe("the generated claim set", () => {
  test("there is one, and it is not empty", () => {
    assert.ok(claims.length > 0, "no claims were generated");
  });

  test("every claim validates under the same module the adapter uses", () => {
    const problems = claims.flatMap((c) => claimProblems(c, `src/data/claims/${c.slug}.json`));
    assert.deepEqual(problems, []);
  });

  test("every type in the union is exercised, so no rule is untested by accident", () => {
    const seen = new Set(claims.map((c) => c.type));
    const missing = CLAIM_TYPES.filter((t) => !seen.has(t));
    assert.deepEqual(
      missing,
      [],
      `no claim is generated for ${missing.join(", ")}, so the rules for those types have never run`,
    );
  });

  test("a claim that carries no quantity cannot render as a measured one", () => {
    for (const c of claims) {
      const forbids = TYPE_RULES[c.type]?.forbids ?? [];
      for (const field of forbids) {
        assert.equal(
          c[field],
          undefined,
          `${c.slug} is a ${c.type} and carries ${field}: ${TYPE_RULES[c.type].why}`,
        );
      }
    }
  });

  test("an open hypothesis is framed as one before its sentence starts", () => {
    for (const c of claims.filter((x) => x.type === "open-hypothesis")) {
      assert.ok(
        c.statement.startsWith(OPEN_HYPOTHESIS_PREFIX),
        `${c.slug} states a hypothesis as an assertion`,
      );
      assert.equal(c.quantity, undefined);
    }
  });

  test("no status was invented for an outcome the store has no word for", () => {
    // cards.json carries `mixed` on 7 of 27 studies and the status union has
    // no member for it. Folding it into the nearest word is the exact failure
    // "never interchanged" names.
    const cards = JSON.parse(readFileSync(join(ROOT, "src", "data", "cards.json"), "utf-8"));
    const unmapped = cards.filter((c) => !OUTCOME_TO_STATUS[c.verdict]).map((c) => c.id);
    assert.ok(unmapped.length > 0, "the fixture this test is about has gone away");
    for (const id of unmapped) {
      const claim = bySlug.get(`study-${id}`);
      if (!claim) continue;
      assert.equal(
        claim.status,
        undefined,
        `study-${id} was adjudicated with a verdict that has no status member and got one anyway`,
      );
    }
  });

  test("an unrun study is never labelled inconclusive", () => {
    // RULING, build lead, 2026-08-11. All 16 inconclusive outcomes in the
    // ledger are execution failures, and `unrun` had zero instances site-wide
    // before it. The two words name different facts and the site keeps them
    // apart.
    const ledger = JSON.parse(readFileSync(join(ROOT, "src", "data", "ledger.json"), "utf-8"));
    const inconclusive = ledger.filter((r) => r.outcome === "inconclusive");
    assert.ok(inconclusive.length > 0, "the fixture this test is about has gone away");
    for (const row of inconclusive) {
      const klass = reasonClassOf(row.inconclusive_reason);
      assert.ok(
        klass,
        `${row.card}/${row.hypothesis_id} has an inconclusive reason nobody has read: ` +
          `${row.inconclusive_reason}`,
      );
      assert.equal(statusForOutcome(row.outcome, row.inconclusive_reason), klass.status);
    }
    assert.equal(
      claims.filter((c) => c.status === "inconclusive").length,
      0,
      "a claim reads inconclusive while every inconclusive outcome in the store is an execution failure",
    );
    assert.ok(
      claims.filter((c) => c.status === "unrun").length > 0,
      "nothing reads unrun, so the ruling was not applied",
    );
  });

  test("no generated file carries an absolute local path", () => {
    for (const f of readdirSync(CLAIMS).filter((x) => x.endsWith(".json"))) {
      const body = readFileSync(join(CLAIMS, f), "utf-8");
      assert.equal(
        ABSOLUTE_PATH_RE.test(body),
        false,
        `${f} carries a path that does not exist off this machine`,
      );
    }
  });

  test("no prose field carries an em dash", () => {
    for (const c of claims) {
      for (const field of ["label", "statement", "scope", "limitation", "humanSource"]) {
        assert.equal(EM_DASH_RE.test(String(c[field] ?? "")), false, `${c.slug}.${field}`);
      }
    }
  });

  test("no humanSource, scope or limitation carries a machine identifier", () => {
    for (const c of claims) {
      for (const field of ["humanSource", "scope", "limitation"]) {
        const hit = findMachineId(String(c[field] ?? ""));
        assert.equal(hit, null, `${c.slug}.${field} carries ${hit?.match}`);
      }
    }
  });

  test("the adapter is deterministic over unchanged input", () => {
    // C-50: a generator whose output changes without its input changing
    // defeats the premise of every regression detector downstream, and the
    // diff looks like real churn.
    const before = files.map((f) => readFileSync(join(CLAIMS, f), "utf-8"));
    execFileSync(process.execPath, [join(ROOT, "scripts", "build_claims.mjs")], {
      cwd: ROOT,
      stdio: "ignore",
    });
    const after = files.map((f) => readFileSync(join(CLAIMS, f), "utf-8"));
    assert.deepEqual(after, before);
  });

  test("the content hash covers the content", () => {
    const seen = new Map();
    for (const c of claims) {
      assert.match(c.contentHash, /^[0-9a-f]{32}$/, `${c.slug} has no content hash`);
      const clash = seen.get(c.contentHash);
      assert.equal(
        clash,
        undefined,
        `${c.slug} and ${clash} hash identically, so the hash is not covering their difference`,
      );
      seen.set(c.contentHash, c.slug);
    }
  });
});

describe("the disclosure, against built output", () => {
  test("every provenance chip on the site resolves to a claim", needsDist, () => {
    const unresolved = [];
    let bound = 0;
    for (const file of pages) {
      const html = readFileSync(file, "utf-8");
      for (const m of html.matchAll(/data-claim="([^"]*)"/g)) {
        bound += 1;
        if (!bySlug.has(m[1])) unresolved.push(`${file}: ${m[1]}`);
      }
    }
    assert.ok(bound > 0, "no chip on the built site is bound to a claim");
    assert.deepEqual(unresolved, []);
  });

  test("the machine ids leave only through the copy affordance", needsDist, () => {
    // The payload is an attribute. A text node would put it in visibleText(),
    // which is what gate 7 reads, and this whole layer exists so a visitor
    // never has to decode one.
    let buttons = 0;
    for (const file of pages) {
      const html = readFileSync(file, "utf-8");
      for (const m of html.matchAll(/<button[^>]*class="prov__tech[^"]*"[^>]*>([\s\S]*?)<\/button>/g)) {
        buttons += 1;
        const label = m[1].replace(/<[^>]+>/g, "").trim();
        assert.equal(
          findMachineId(label),
          null,
          `the technical affordance's own label carries a machine id: ${label}`,
        );
        assert.match(m[0], /data-claim-technical="/, "the payload is not on the element");
      }
    }
    assert.ok(buttons > 0, "no technical affordance rendered, so this proves nothing");
  });

  test("no page outside the record route shows an observable in a disclosure", needsDist, () => {
    const offenders = [];
    for (const file of pages) {
      const html = readFileSync(file, "utf-8");
      for (const m of html.matchAll(
        /<span\b[^>]*\bdata-claim-disclosure\b[^>]*>([\s\S]*?)<\/span>\s*<\/span>/g,
      )) {
        const text = m[1].replace(/<[^>]+>/g, " ");
        const hit = findMachineId(text);
        if (hit) offenders.push(`${file}: ${hit.match}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  test("the manifest's evidence index covers every record the site can reach", () => {
    const index = JSON.parse(
      readFileSync(join(ROOT, "src", "data", "evidence-index.json"), "utf-8"),
    );
    const uncovered = Object.keys(index).filter((id) => !manifest.defaultForEvidenceId[id]);
    assert.deepEqual(
      uncovered,
      [],
      `${uncovered.length} evidence record(s) have no claim, so a chip bound to one would fail the build`,
    );
  });
});
