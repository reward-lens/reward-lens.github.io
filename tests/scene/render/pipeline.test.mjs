/**
 * What the render pipeline must not lose.
 *
 * These are source assertions, not renders. They exist because every one of them
 * describes a regression that is invisible in review: a hemisphere light added
 * back as "just a bit of fill", an exposure crept up to rescue brightness, the
 * two themes drifting onto different operators, or the environment quietly
 * dropped from a tier to save a texture. Each of those looks like a small
 * change in a diff and each of them undoes the packet.
 *
 * Run with `node --test tests/scene/render/`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const rig = read("src/components/scene/lighting/rig.tsx");
const tonemap = read("src/components/scene/render/tonemap.ts");
const environment = read("src/components/scene/render/environment.ts");
const pipeline = read("src/components/scene/render/pipeline.tsx");
const chain = read("src/components/scene/post/chain.ts");
const scene = read("src/components/scene/core/InstrumentScene.tsx");

test("no hemisphere light anywhere in the scene", () => {
  // Usage, not mention: `rig.tsx` explains at length why the hemisphere light was
  // removed, and a test that cannot tell an element from a paragraph about one
  // would force that explanation to be deleted to stay green.
  const used = /<\s*hemisphereLight|new\s+HemisphereLight|<\s*ambientLight|new\s+AmbientLight/;
  for (const [name, source] of Object.entries({ rig, pipeline, scene })) {
    assert.ok(
      !used.test(source),
      `${name} mounts a hemisphere or ambient light. INTERFACES.md §2 and §7 reject either as ` +
        `the primary fill: they add light with no position and no falloff, which removes the ` +
        `shaping the composition depends on. The ambient term is the prefiltered environment.`,
    );
  }
});

test("exposure is a small correction and never a brightness rescue", () => {
  const block = tonemap.match(/EXPOSURE[^=]*=\s*\{([^}]*)\}/);
  assert.ok(block, "EXPOSURE table not found in tonemap.ts");
  const values = [...block[1].matchAll(/(dark|light)\s*:\s*([\d.]+)/g)];
  assert.equal(values.length, 2, "both themes must declare an exposure");
  for (const [, theme, value] of values) {
    assert.ok(
      Number(value) <= 1.5,
      `${theme} exposure is ${value}; INTERFACES.md §7 rejects an exposure above about 1.5 ` +
        `used as a brightness rescue. If the scene needs more, the lighting is wrong.`,
    );
  }
});

test("both themes use the same tone mapping operator", () => {
  // One operator, chosen once. Two would mean no material can be right in both.
  const declared = tonemap.match(/export const TONE_MAP:\s*ToneMapOperator\s*=\s*"(\w+)"/);
  assert.ok(declared, "TONE_MAP must be a single declared operator");
  assert.ok(
    ["aces", "agx", "neutral"].includes(declared[1]),
    `unknown operator ${declared[1]}`,
  );
  // And the pipeline must not branch the operator on the theme.
  assert.ok(
    !/toneMapping\s*=\s*theme\s*===/.test(pipeline),
    "the operator must not depend on the theme; only the exposure does",
  );
});

test("the environment is built and bound, and no tier drops it", () => {
  assert.ok(/new PMREMGenerator/.test(environment), "the environment must be prefiltered");
  assert.ok(/fromScene\(/.test(environment), "the environment is authored, not downloaded");
  assert.ok(
    !/\.hdr|\.exr|RGBELoader|EXRLoader/.test(environment),
    "no downloaded HDRI: a generic studio environment does not belong to this room",
  );
  assert.ok(
    /scene\.environment\s*=\s*texture/.test(pipeline),
    "the prefiltered texture must be assigned to scene.environment",
  );
  // The binding sits outside every tier branch, so no tier can drop it.
  assert.ok(
    !/tier[^\n]*environment\s*=|environment\s*=\s*tier/.test(pipeline),
    "the environment must not be conditional on the tier",
  );
});

test("light colour is a per-theme role, never the --beam token directly", () => {
  // --beam is near-white in dark and the darkest ink in light. A light coloured
  // with it emits at 0.03 in the light theme and no intensity recovers that.
  assert.ok(
    !/color=\{palette\["--beam"\]\}/.test(rig),
    "rig lights must resolve colour through SOURCE_TOKEN, not the --beam token",
  );
  assert.ok(/SOURCE_TOKEN\[theme\]/.test(rig), "rig must use the per-theme source role");
});

test("the key's shadow frustum is fitted, not the default cube", () => {
  assert.ok(
    /shadow-camera-left=\{frustum\.left\}/.test(rig),
    "the shadow camera must take a fitted frustum; the default is a 10x10x500 box",
  );
  assert.ok(
    /shadow-normalBias/.test(rig),
    "normal bias is what removes acne without peter-panning; it must be set",
  );
});

test("the post chain has grounding, and bloom only reaches real light sources", () => {
  assert.ok(/GTAOPass/.test(chain), "ambient occlusion is mandatory: without it the bench floats");
  const threshold = chain.match(/threshold:\s*([\d.]+)/);
  assert.ok(threshold, "bloom threshold must be declared");
  assert.ok(
    Number(threshold[1]) >= 0.8,
    `bloom threshold ${threshold[1]} is low enough to catch lit surfaces; the room's ` +
      `surfaces sit near 0.05 linear and only the beam and the aperture may bloom`,
  );
});

test("antialiasing is re-established explicitly after the composer takes over", () => {
  // A composer renders into its own targets, so the context's antialias flag
  // stops applying and every edge staircases.
  assert.ok(/FXAAPass/.test(chain), "the chain must restore antialiasing explicitly");
  const outputAt = chain.indexOf("new OutputPass()");
  const fxaaAt = chain.indexOf("new FXAAPass()");
  assert.ok(outputAt > 0 && fxaaAt > outputAt, "FXAA needs sRGB input and must follow OutputPass");
});

test("the dither is the last pass, after the encode", () => {
  const fxaaAt = chain.indexOf("new FXAAPass()");
  const ditherAt = chain.indexOf("new ShaderPass(DitherShader)");
  assert.ok(ditherAt > fxaaAt, "the dither must be last: it breaks the final quantization step");
});

test("the composer does not double-apply the tone curve", () => {
  // Three forces NoToneMapping whenever the render target is not null, so
  // OutputPass applies the curve exactly once and reads it off the renderer.
  // The renderer's tone mapping must therefore stay SET.
  assert.ok(
    /gl\.toneMapping = TONE_MAP_OPERATORS/.test(pipeline),
    "the renderer's tone mapping is OutputPass's configuration and must be set",
  );
  assert.ok(
    !/ToneMappingPass|new ToneMapping/.test(chain),
    "no second tone mapping pass: OutputPass already applies the curve",
  );
});

test("the camera keeps its 26 degree field of view", () => {
  assert.ok(
    /fov:\s*26\b/.test(scene),
    "fov 26 is the long lens that makes this an instrument; 75 is the untouched-scene default",
  );
});
