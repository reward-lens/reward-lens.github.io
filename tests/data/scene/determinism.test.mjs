/**
 * Two runs over unchanged sources produce the same bytes.
 *
 *   node --test tests/data/scene/determinism.test.mjs
 *
 * This is what makes a content hash worth having. If a rebuild moved a byte for
 * a reason unrelated to the data, every cached still would be invalidated on
 * every build and the hash would stop meaning "the artifact changed". It is also
 * the cheapest way to catch a generator that has picked up a dependency on
 * iteration order, on a random seed, or on the clock.
 *
 * `generatedAt` is the one field a clock touches. It is compared separately and
 * deliberately excluded from the digest, and `SOURCE_DATE_EPOCH` fixes it when a
 * byte-identical manifest is wanted as well as a byte-identical payload.
 */
import { test, describe, after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { SCENE_DIR, runGenerator, scratch } from "./_support.mjs";

const first = scratch("determinism-a");
const second = scratch("determinism-b");

/** Every file under a directory, by relative path, with its sha256. */
function fingerprint(dir) {
  const out = new Map();
  const walk = (at, prefix) => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, rel);
      else out.set(rel, createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  };
  walk(dir, "");
  return out;
}

describe("generation is deterministic", () => {
  before(() => {
    for (const out of [first, second]) {
      const result = runGenerator({ args: [`--out=${out}`, "--quiet"] });
      assert.equal(result.status, 0, result.output);
    }
  });

  after(() => {
    for (const out of [first, second]) rmSync(out, { recursive: true, force: true });
  });

  test("every payload is byte identical across two runs", () => {
    const a = fingerprint(join(first, "payload"));
    const b = fingerprint(join(second, "payload"));
    assert.ok(a.size >= 5, `the first run wrote ${a.size} payloads`);
    assert.deepEqual([...a.keys()], [...b.keys()], "the two runs wrote different sets of payloads");
    for (const [name, hash] of a) {
      assert.equal(b.get(name), hash, `payload/${name} differs between two runs of the same generator`);
    }
  });

  test("the captions and the digest are byte identical across two runs", () => {
    for (const name of ["captions.json", "build-digest.json"]) {
      assert.equal(
        readFileSync(join(first, name), "utf-8"),
        readFileSync(join(second, name), "utf-8"),
        `${name} differs between two runs`,
      );
    }
  });

  test("the manifest differs only in its timestamp", () => {
    const a = JSON.parse(readFileSync(join(first, "manifest.json"), "utf-8"));
    const b = JSON.parse(readFileSync(join(second, "manifest.json"), "utf-8"));
    assert.deepEqual({ ...a, generatedAt: "" }, { ...b, generatedAt: "" });
    assert.match(a.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  test("SOURCE_DATE_EPOCH makes the manifest byte identical too", () => {
    const a = scratch("determinism-epoch-a");
    const b = scratch("determinism-epoch-b");
    for (const out of [a, b]) {
      const result = runGenerator({ args: [`--out=${out}`, "--quiet"], env: { SOURCE_DATE_EPOCH: "1000000000" } });
      assert.equal(result.status, 0, result.output);
    }
    assert.equal(readFileSync(join(a, "manifest.json"), "utf-8"), readFileSync(join(b, "manifest.json"), "utf-8"));
    for (const out of [a, b]) rmSync(out, { recursive: true, force: true });
  });

  test("the rebuild matches what is committed", () => {
    const committed = fingerprint(join(SCENE_DIR, "payload"));
    const rebuilt = fingerprint(join(first, "payload"));
    assert.deepEqual(
      [...rebuilt].sort(),
      [...committed].sort(),
      "the committed scene data is not what this tree's sources produce. Run npm run build:scene-data.",
    );
  });

  test("--check exits zero against the committed output and is capable of failing", () => {
    const current = runGenerator({ args: ["--check", "--quiet"] });
    assert.equal(current.status, 0, current.output);

    // The same mode, pointed at a directory that has never been generated, has
    // to report drift. Without this the test above proves only that --check
    // exits zero, which it would also do if it compared nothing.
    const empty = scratch("check-empty");
    const stale = runGenerator({ args: ["--check", `--out=${empty}`] });
    assert.notEqual(stale.status, 0, "--check passed against a directory with no scene data in it");
    assert.match(stale.output, /out of date with its sources/);
    rmSync(empty, { recursive: true, force: true });
  });
});
