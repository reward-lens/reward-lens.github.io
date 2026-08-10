/**
 * What the installed three actually exposes.
 *
 * `INTERFACES.md` §6 trap 7 says to verify the Three.js API against the
 * installed version rather than from memory, and this is that verification made
 * executable. Two things are checked, and both of them are things that would
 * otherwise fail silently.
 *
 * ONE: the physical material's parameter names. Assigning an unknown property
 * to a material is not an error in JavaScript and three does not warn on it, so
 * a lens written against a remembered API name renders as a plain opaque
 * dielectric and looks merely disappointing rather than broken.
 *
 * TWO: the shader chunk markers `variation.ts` patches. If three renames a
 * chunk, the string replacement finds nothing, the injection is skipped, and
 * every surface in the room quietly returns to a single constant roughness,
 * which is one of the listed rejection conditions and is invisible in a diff.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ShaderChunk, ShaderLib, MeshPhysicalMaterial } from "three";
import { loadTs, closeLoader, REPO_ROOT } from "./load.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("three is pinned at the version these materials were authored against", () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(pkg.dependencies.three, "^0.185.1");
  // `three/package.json` is not reachable through the package's exports map,
  // so the installed version is read off the file rather than imported.
  const installed = JSON.parse(
    readFileSync(join(REPO_ROOT, "node_modules/three/package.json"), "utf8"),
  );
  assert.equal(installed.version.startsWith("0.185."), true, `installed three is ${installed.version}`);
});

test("MeshPhysicalMaterial exposes every parameter the glass spec names", () => {
  const m = new MeshPhysicalMaterial();
  // Verified against node_modules/three@0.185.1, not from memory. Each of
  // these is read by `surfaces.ts` for `opticalGlass` or by one of the metals.
  const required = [
    "transmission",
    "thickness",
    "ior",
    "dispersion",
    "attenuationDistance",
    "attenuationColor",
    "clearcoat",
    "clearcoatRoughness",
    "anisotropy",
    "anisotropyRotation",
    "sheen",
    "sheenColor",
    "sheenRoughness",
    "specularIntensity",
    "specularColor",
    "envMapIntensity",
    "dithering",
  ];
  for (const name of required) {
    assert.ok(name in m, `MeshPhysicalMaterial has no "${name}" in the installed three`);
  }
  m.dispose();
});

test("physical material defaults are what the spec assumes it is overriding", () => {
  const m = new MeshPhysicalMaterial();
  assert.equal(m.transmission, 0);
  assert.equal(m.dispersion, 0);
  assert.equal(m.clearcoat, 0);
  assert.equal(m.anisotropy, 0);
  assert.equal(m.sheen, 0);
  assert.equal(m.ior, 1.5);
  m.dispose();
});

test("the four shader chunks variation.ts patches all exist", async () => {
  const { PATCHED_CHUNKS } = await loadTs("src/components/scene/materials/variation.ts");
  for (const marker of PATCHED_CHUNKS) {
    const name = marker.replace("#include <", "").replace(">", "");
    assert.ok(name in ShaderChunk, `three no longer ships a "${name}" chunk`);
  }
});

test("the physical shader still includes those chunks, in the order the injection needs", () => {
  const frag = ShaderLib.physical.fragmentShader;
  const rough = frag.indexOf("#include <roughnessmap_fragment>");
  const metal = frag.indexOf("#include <metalnessmap_fragment>");
  const normal = frag.indexOf("#include <normal_fragment_maps>");
  assert.ok(rough >= 0 && metal >= 0 && normal >= 0);
  // The height computed in the roughness injection is read by the normal
  // injection, so roughness must come first and both must be in the same
  // function body.
  assert.ok(rough < metal, "roughnessmap_fragment must precede metalnessmap_fragment");
  assert.ok(metal < normal, "metalnessmap_fragment must precede normal_fragment_maps");
});

test("the chunks the injection targets still declare the variables it modifies", () => {
  assert.match(ShaderChunk.roughnessmap_fragment, /float roughnessFactor = roughness;/);
  assert.match(ShaderChunk.metalnessmap_fragment, /float metalnessFactor = metalness;/);
  assert.match(ShaderChunk.begin_vertex, /vec3 transformed = vec3\( position \);/);
});

test("three still compiles varyings through its own preprocessor defines", () => {
  // `variation.ts` declares `varying vec3 vRlWorld;` on both sides. That only
  // works because three emits `#define varying out` / `#define varying in` into
  // the GLSL3 prefix. If that ever changes to raw `in`/`out`, the declaration
  // becomes a compile error and the whole scene goes black rather than flat.
  const program = readFileSync(
    join(REPO_ROOT, "node_modules/three/src/renderers/webgl/WebGLProgram.js"),
    "utf8",
  );
  assert.ok(program.includes("'#define varying out'"), "vertex varying define is gone");
  assert.ok(program.includes("'#define varying in'"), "fragment varying define is gone");
});

test.after(() => closeLoader());
