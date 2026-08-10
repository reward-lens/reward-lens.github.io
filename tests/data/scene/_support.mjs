/**
 * Shared machinery for the scene data tests.
 *
 * Two things live here. The first is a loader that compiles a TypeScript module
 * and imports it, so these tests exercise the real `violatesTruthMode` and the
 * real payload decoder rather than JavaScript restatements of them. Two copies
 * of a rule is one copy of a rule plus a place for them to disagree, and these
 * tests exist to catch disagreement rather than to add one.
 *
 * The second is a runner for the generator, because most of what is worth
 * asserting about a build script is what it refuses. Every failure test below
 * runs the real script in a child process and reads its exit status and its
 * message, which is the only way to be sure the refusal reaches the build.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "../../..");
export const SCENE_DIR = join(ROOT, "src/data/scene");
export const GENERATOR = join(ROOT, "scripts/build_scene_data.mjs");

/** Compile one TypeScript module and import it. No type checking, no bundler. */
export async function importTs(relativePath) {
  const ts = (await import("typescript")).default;
  const source = readFileSync(join(ROOT, relativePath), "utf-8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled, "utf-8").toString("base64")}`);
}

/** Run the generator and hand back everything a caller might assert on. */
export function runGenerator({ args = [], env = {} } = {}) {
  const result = spawnSync(process.execPath, [GENERATOR, ...args], {
    cwd: ROOT,
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

export const scratch = (label) => mkdtempSync(join(tmpdir(), `scene-data-${label}-`));

/** Every string anywhere in a JSON value, with the path it sits at. */
export function* strings(value, path = "") {
  if (typeof value === "string") yield [path, value];
  else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) yield* strings(value[i], `${path}[${i}]`);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) yield* strings(v, path ? `${path}.${k}` : k);
  }
}
