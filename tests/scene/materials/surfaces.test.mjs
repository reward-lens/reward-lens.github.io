/**
 * The material system, exercised without a GPU.
 *
 * Nothing here renders. What it can check is everything that decides how the
 * render will come out: that the metals are metals, that the tiers hand out the
 * material they claim to, that two meshes asking for the same surface get the
 * same object, that a disposed cache is actually empty, and that no surface
 * ships a single constant roughness.
 *
 * The palette is built from the hex comments in `src/styles/tokens.css`, which
 * makes two claims at once: that the table's tint choices behave the way the
 * header says they do, and that those hex comments are still true. The second
 * claim is checked against a real browser in `palette-parse.test.mjs`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Color, MeshPhysicalMaterial, MeshStandardMaterial } from "three";
import { loadTs, closeLoader, REPO_ROOT } from "./load.mjs";

const surfaces = await loadTs("src/components/scene/materials/surfaces.ts");
const paletteMod = await loadTs("src/components/scene/core/palette.ts");
const { useSurface, disposeSurfaces, primeSurfaces, surfaceCacheSize, SURFACE_TABLE } = surfaces;
const { SCENE_TOKENS } = paletteMod;

const NAMES = Object.keys(SURFACE_TABLE);

/* ------------------------------------------------------------------ */
/* The palette, read off the stylesheet's own hex comments             */
/* ------------------------------------------------------------------ */

function readThemeHexes() {
  const css = readFileSync(join(REPO_ROOT, "src/styles/tokens.css"), "utf8").split("\n");
  const declaration = /^\s*(--[a-z0-9-]+):\s*oklch\([^)]*\);\s*\/\*\s*(#[0-9a-fA-F]{6})/;
  // The light theme's values live below the dark theme's in one file. The
  // boundary is the light block's own `--ground`, which is the first token
  // redefined there.
  const boundary = css.findIndex((line) => /--ground:\s*oklch\(0\.985/.test(line));
  assert.ok(boundary > 0, "could not find the light theme block in tokens.css");
  const dark = {};
  const light = {};
  css.forEach((line, i) => {
    const m = declaration.exec(line);
    if (!m) return;
    (i < boundary ? dark : light)[m[1]] = m[2];
  });
  return { dark, light };
}

const HEXES = readThemeHexes();

function paletteFor(theme) {
  const out = {};
  for (const token of SCENE_TOKENS) {
    const hex = HEXES[theme][token];
    // Tokens with no hex comment are not used by the surface table; they get a
    // recognisable magenta so that a table entry silently reaching for one
    // shows up as a failure rather than as a plausible grey.
    out[token] = new Color(hex ?? "#ff00ff");
  }
  return out;
}

function prime(theme) {
  disposeSurfaces();
  primeSurfaces(paletteFor(theme), theme);
}

/** sRGB relative luminance of a linear-working-space three Color. */
function luminance(color) {
  const { r, g, b } = color;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/* ------------------------------------------------------------------ */
/* The correction: metals are metals                                   */
/* ------------------------------------------------------------------ */

test("every metal is at metalness 1.0, not compensating for a missing environment", () => {
  for (const name of ["anodized", "machined", "blackOxide", "railTop"]) {
    assert.equal(
      SURFACE_TABLE[name].metalness,
      1.0,
      `${name} is at metalness ${SURFACE_TABLE[name].metalness}; a metalness below 1 chosen to ` +
        `recover brightness is exactly the defect this module was written to reverse`,
    );
  }
});

test("every dielectric is at metalness 0", () => {
  for (const name of ["opticalGlass", "paintedMarking", "detectorFace"]) {
    assert.equal(SURFACE_TABLE[name].metalness, 0);
  }
});

test("roughness stays inside the bands INTERFACES §1 declares", () => {
  const bands = {
    anodized: [0.35, 0.5],
    machined: [0.22, 0.32],
    blackOxide: [0.4, 0.6],
    railTop: [0.1, 0.35],
    opticalGlass: [0.0, 0.05],
    paintedMarking: [0.7, 0.9],
    detectorFace: [0.5, 0.7],
  };
  for (const [name, [lo, hi]] of Object.entries(bands)) {
    const r = SURFACE_TABLE[name].roughness;
    assert.ok(r >= lo && r <= hi, `${name} roughness ${r} is outside ${lo}..${hi}`);
  }
});

test("the rail's top face is distinctly smoother than the housings, not marginally", () => {
  const gap = SURFACE_TABLE.anodized.roughness - SURFACE_TABLE.railTop.roughness;
  assert.ok(gap >= 0.12, `railTop is only ${gap.toFixed(3)} smoother than anodized; that reads as a smear, not a line`);
});

/* ------------------------------------------------------------------ */
/* No surface holds a single constant roughness                        */
/* ------------------------------------------------------------------ */

test("every surface declares a non-zero roughness variation", () => {
  for (const name of NAMES) {
    const v = SURFACE_TABLE[name].variation;
    assert.ok(v.grain > 0, `${name} has no fine grain`);
    assert.ok(v.wear > 0, `${name} has no broad wear term`);
  }
});

test("every built material carries the variation injection", () => {
  prime("dark");
  for (const name of NAMES) {
    const m = useSurface({ surface: name, tier: "high" });
    assert.equal(typeof m.onBeforeCompile, "function", `${name} has no variation`);
    assert.equal(typeof m.customProgramCacheKey, "function", `${name} would share a stale program`);
  }
});

test("the injected source actually modifies roughnessFactor and the normal", async () => {
  const { VARIATION_SOURCE } = await loadTs("src/components/scene/materials/variation.ts");
  assert.match(VARIATION_SOURCE.roughness, /roughnessFactor = clamp\(/);
  assert.match(VARIATION_SOURCE.metalness, /metalnessFactor = clamp\(/);
  assert.match(VARIATION_SOURCE.normal, /normal = normalize\(/);
  assert.match(VARIATION_SOURCE.vertexBody, /vRlWorld = \( modelMatrix \* rlWorld \)\.xyz;/);
  // Instanced meshes must not all sample the same point in the field.
  assert.match(VARIATION_SOURCE.vertexBody, /USE_INSTANCING/);
  assert.match(VARIATION_SOURCE.vertexBody, /USE_BATCHING/);
});

test("the injection runs and produces a shader that differs from the stock one", () => {
  prime("dark");
  const m = useSurface({ surface: "anodized", tier: "high" });
  const shader = {
    uniforms: {},
    vertexShader: "#include <begin_vertex>\n",
    fragmentShader:
      "#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_maps>\n",
  };
  m.onBeforeCompile(shader);
  assert.ok(shader.uniforms.uRlScale, "no scale uniform was added");
  assert.ok(shader.uniforms.uRlAmp, "no amplitude uniform was added");
  assert.match(shader.vertexShader, /varying vec3 vRlWorld;/);
  assert.match(shader.fragmentShader, /float rlFine =/);
  assert.match(shader.fragmentShader, /roughnessFactor = clamp\(/);
  assert.match(shader.fragmentShader, /#define RL_BUMP/);
});

test("the still tier gets no variation, because it draws no canvas", () => {
  prime("dark");
  const m = useSurface({ surface: "anodized", tier: "still" });
  assert.equal(m.onBeforeCompile, MeshStandardMaterial.prototype.onBeforeCompile);
});

/* ------------------------------------------------------------------ */
/* Tiers                                                               */
/* ------------------------------------------------------------------ */

test("high and mid get a physical material, low and still get a standard one", () => {
  prime("dark");
  for (const tier of ["high", "mid"]) {
    assert.ok(
      useSurface({ surface: "anodized", tier }) instanceof MeshPhysicalMaterial,
      `${tier} did not get a physical material`,
    );
  }
  for (const tier of ["low", "still"]) {
    const m = useSurface({ surface: "anodized", tier });
    assert.ok(m instanceof MeshStandardMaterial, `${tier} did not get a standard material`);
    assert.ok(!(m instanceof MeshPhysicalMaterial), `${tier} got a physical material`);
  }
});

test("transmission is high tier only and the lower tiers fall back rather than vanish", () => {
  prime("dark");
  const high = useSurface({ surface: "opticalGlass", tier: "high" });
  assert.equal(high.transmission, 1.0);
  assert.equal(high.ior, 1.52);
  assert.ok(high.dispersion > 0, "dispersion is not set on the high tier lens");
  assert.equal(high.thickness, 0.34);

  const mid = useSurface({ surface: "opticalGlass", tier: "mid" });
  assert.equal(mid.transmission, 0, "mid tier is paying for a backbuffer copy");
  assert.equal(mid.transparent, true);
  assert.ok(mid.opacity < 1);

  const low = useSurface({ surface: "opticalGlass", tier: "low" });
  assert.ok(low instanceof MeshStandardMaterial);
  assert.equal(low.transparent, true);
});

test("clearcoat is on the anodized finishes at high and mid, and gone at low", () => {
  prime("dark");
  assert.ok(useSurface({ surface: "anodized", tier: "high" }).clearcoat > 0);
  assert.ok(useSurface({ surface: "anodized", tier: "mid" }).clearcoat > 0);
  assert.ok(useSurface({ surface: "railTop", tier: "high" }).clearcoat > 0);
  const low = useSurface({ surface: "anodized", tier: "low" });
  assert.equal(low.clearcoat, undefined, "a standard material should not carry a clearcoat");
});

test("anisotropy is high tier only", () => {
  prime("dark");
  assert.ok(useSurface({ surface: "machined", tier: "high" }).anisotropy > 0);
  assert.equal(useSurface({ surface: "machined", tier: "mid" }).anisotropy, 0);
});

test("sheen is on the detector face where a physical material exists", () => {
  prime("dark");
  assert.ok(useSurface({ surface: "detectorFace", tier: "high" }).sheen > 0);
  assert.equal(useSurface({ surface: "detectorFace", tier: "low" }).sheen, undefined);
});

test("every material has dithering on, against banding in a near-black room", () => {
  prime("dark");
  for (const name of NAMES) {
    for (const tier of ["high", "mid", "low"]) {
      assert.equal(useSurface({ surface: name, tier }).dithering, true, `${name}/${tier}`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Memoization and disposal                                            */
/* ------------------------------------------------------------------ */

test("the same request returns the identical object", () => {
  prime("dark");
  const a = useSurface({ surface: "anodized", tier: "high" });
  const b = useSurface({ surface: "anodized", tier: "high" });
  assert.equal(a, b);
});

test("a different tier, tint or surface returns a different object", () => {
  prime("dark");
  const base = useSurface({ surface: "anodized", tier: "high" });
  assert.notEqual(base, useSurface({ surface: "anodized", tier: "mid" }));
  assert.notEqual(base, useSurface({ surface: "anodized", tier: "high", tint: "--comp-1" }));
  assert.notEqual(base, useSurface({ surface: "machined", tier: "high" }));
});

test("the cache holds one entry per distinct request and no more", () => {
  prime("dark");
  assert.equal(surfaceCacheSize(), 0);
  useSurface({ surface: "anodized", tier: "high" });
  useSurface({ surface: "anodized", tier: "high" });
  useSurface({ surface: "anodized", tier: "high" });
  assert.equal(surfaceCacheSize(), 1);
  useSurface({ surface: "railTop", tier: "high" });
  assert.equal(surfaceCacheSize(), 2);
});

test("disposeSurfaces disposes every material and empties the cache", () => {
  prime("dark");
  const disposed = [];
  for (const name of NAMES) {
    const m = useSurface({ surface: name, tier: "high" });
    m.addEventListener("dispose", () => disposed.push(name));
  }
  assert.equal(surfaceCacheSize(), NAMES.length);
  disposeSurfaces();
  assert.equal(surfaceCacheSize(), 0);
  assert.deepEqual(disposed.sort(), [...NAMES].sort());
});

test("a request after disposal rebuilds rather than returning a dead material", () => {
  prime("dark");
  const before = useSurface({ surface: "anodized", tier: "high" });
  disposeSurfaces();
  primeSurfaces(paletteFor("dark"), "dark");
  const after = useSurface({ surface: "anodized", tier: "high" });
  assert.notEqual(before, after);
});

/* ------------------------------------------------------------------ */
/* Colour: from tokens, and stable across the theme                    */
/* ------------------------------------------------------------------ */

test("a tint override is honoured and comes from the palette", () => {
  prime("dark");
  const palette = paletteFor("dark");
  const m = useSurface({ surface: "anodized", tier: "high", tint: "--comp-4" });
  assert.equal(m.color.getHexString(), palette["--comp-4"].getHexString());
});

test("a material's colour is a copy, so mutating it cannot repaint the palette", () => {
  prime("dark");
  const palette = paletteFor("dark");
  const before = palette["--surface-2"].getHexString();
  const m = useSurface({ surface: "anodized", tier: "high" });
  assert.notEqual(m.color, palette["--surface-2"]);
  m.color.setRGB(1, 0, 0);
  assert.equal(paletteFor("dark")["--surface-2"].getHexString(), before);
});

test("an unknown token is refused rather than silently rendered white", () => {
  prime("dark");
  assert.throws(
    () => useSurface({ surface: "anodized", tier: "high", tint: "--not-a-token" }),
    /not a scene token/,
  );
});

test("a physical object keeps its colour when the page theme flips", () => {
  // The failure this guards is the housings turning white in the light theme
  // because `--surface-2` is a contrast role rather than a pigment. The
  // tolerance is a ratio, not a difference, because a near-white surface and a
  // near-black one cannot share an absolute tolerance. 2.3 is set by
  // `detectorFace`, whose closest available light-theme token is 2.15 away;
  // every other surface is inside 1.8.
  const TOLERANCE = 2.3;
  const measured = {};
  for (const theme of ["dark", "light"]) {
    prime(theme);
    for (const name of NAMES) {
      const m = useSurface({ surface: name, tier: "high" });
      (measured[name] ??= {})[theme] = luminance(m.color);
    }
  }
  for (const name of NAMES) {
    const { dark, light } = measured[name];
    const ratio = Math.max(dark, light) / Math.max(Math.min(dark, light), 1e-6);
    assert.ok(
      ratio <= TOLERANCE,
      `${name} changes luminance by ${ratio.toFixed(2)}x between themes ` +
        `(dark ${dark.toFixed(4)}, light ${light.toFixed(4)}); the bench does not repaint itself`,
    );
  }
});

test("the surface table names only real scene tokens", () => {
  for (const name of NAMES) {
    const spec = SURFACE_TABLE[name];
    for (const themed of [spec.tint, spec.sheenTint, spec.attenuationTint]) {
      if (!themed) continue;
      for (const theme of ["dark", "light"]) {
        assert.ok(
          SCENE_TOKENS.includes(themed[theme]),
          `${name} names "${themed[theme]}", which core/palette.ts does not resolve`,
        );
      }
    }
  }
});

/* ------------------------------------------------------------------ */
/* No hex literals anywhere in the module                              */
/* ------------------------------------------------------------------ */

test("the material module contains no colour literal and never calls setStyle", () => {
  const files = ["surfaces.ts", "variation.ts", "bevel.ts", "index.ts"];
  for (const file of files) {
    const src = readFileSync(join(REPO_ROOT, "src/components/scene/materials", file), "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments carry documented hexes
      .replace(/\/\/.*$/gm, "");
    assert.equal(
      /#[0-9a-fA-F]{6}\b/.test(code),
      false,
      `${file} contains a hex colour literal outside a comment`,
    );
    assert.equal(/setStyle\s*\(/.test(code), false, `${file} calls setStyle`);
    assert.equal(/new Color\s*\(\s*["'#0-9]/.test(code), false, `${file} builds a Color from a literal`);
  }
});

test.after(() => closeLoader());
