/**
 * The post chain, built imperatively and with no React in it.
 *
 * Separated from the component that mounts it for one reason that earns the
 * extra file: the pass order and the two traps below are the part worth
 * reviewing, and they are much harder to see interleaved with hooks. This module
 * takes a renderer, a scene and a camera and returns something with a `render`
 * method. It can be exercised without a canvas component.
 *
 * NO NEW DEPENDENCY, AND NONE IS NEEDED. `@react-three/drei` and the
 * `postprocessing` package are both absent from `package.json`, which the
 * integrator owns, so the first question was which one to ask for. The answer
 * turned out to be neither: `three@0.185.1` ships `EffectComposer`, `RenderPass`,
 * `GTAOPass`, `UnrealBloomPass`, `BokehPass`, `OutputPass`, `FXAAPass` and
 * `ShaderPass` under `three/addons/postprocessing/`, reachable through the
 * package's own `./addons/*` export. Everything here is first-party code from a
 * dependency already installed, so the dependency request is: none.
 *
 * TRAP ONE, DOUBLE TONE MAPPING. The usual advice is that when a composer
 * applies the curve the renderer's own tone mapping must be turned off, and
 * following it here would produce a linear image. Three already solves this and
 * it is worth knowing exactly how. In `WebGLPrograms.js:176-186` a material's
 * tone mapping is forced to `NoToneMapping` unless
 * `currentRenderTarget === null`, so every pass drawing into a composer buffer
 * is automatically linear. `OutputPass` then reads `renderer.toneMapping` and
 * `renderer.toneMappingExposure` off the renderer and applies the curve exactly
 * once. So the renderer's tone mapping stays SET, and setting it is how the pass
 * is configured.
 *
 * The one real consequence is that `toneMapped: false` stops protecting
 * anything. The beam and the source aperture are drawn with it, and through the
 * composer they are tone mapped like every other pixel, because a full-screen
 * pass cannot know which material produced which pixel. That is a reason the
 * operator choice matters rather than a defect: AgX holds the beam's hue into
 * its shoulder instead of pushing it to white. The low tier has no composer, so
 * there those two materials keep their exemption and the beam is fractionally
 * hotter.
 *
 * TRAP TWO, MULTISAMPLING. A composer renders into its own targets, so the WebGL
 * context's `antialias` flag stops doing anything and every edge staircases. The
 * obvious fix is `samples: 4` on the composer's targets, and it does not fit:
 * two half-float RGBA buffers at 1440x900 and pixel ratio 1.5 are 47 MB before
 * multisampling, and 4x turns that into roughly 190 MB against the 48 MB budget
 * in SCENE.md §8. So antialiasing is supersampling from the pixel ratio, which
 * happens inside `RenderPass` and is genuinely first in the chain, plus an
 * `FXAAPass` for what survives the downsample. `SMAAPass` looks better and was
 * rejected on bytes: 50 KB with two embedded base64 lookup textures against an
 * 18 KB post-processing budget, where `FXAAPass` is 738 bytes.
 *
 * PASS ORDER: render, ambient occlusion, bloom, depth of field, tone mapping,
 * antialiasing, dither. The antialiasing sits after tone mapping rather than
 * first because `OutputPass`'s own documentation requires it, in as many words:
 * "If a pass requires sRGB input (e.g. like FXAA), the pass must follow
 * `OutputPass` in the pass chain." FXAA finds edges by perceptual luminance and
 * a linear half-float buffer has none.
 */
import {
  HalfFloatType,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { profileFor, type SceneTier } from "../runtime/tier";
import { DitherShader } from "./dither";

/**
 * Pixel ratio ceiling for the composer's own buffers, per tier.
 *
 * Lower than the canvas's own ceiling, and this is a memory decision rather than
 * a speed one. The chain needs two screen-sized half-float buffers to ping-pong
 * between at eight bytes a pixel, and the canvas backbuffer is a third. At the
 * high tier's pixel ratio of 2 on a 1440x900 canvas that is 124 MB of render
 * target before ambient occlusion or bloom allocate anything. 1.5 keeps the
 * supersample that does most of the antialiasing and cuts the buffers by 44%.
 */
const COMPOSER_PIXEL_RATIO: Record<SceneTier, number> = {
  high: 1.5,
  mid: 1.25,
  low: 1,
  still: 1,
};

/**
 * Bloom, and it is deliberately almost nothing.
 *
 * Over-bloom is the most common amateur tell in a dark scene, so the threshold
 * is set where only actual light sources can reach it. The room's lit surfaces
 * sit at 48 to 72 of 255, which is 0.03 to 0.06 linear; the beam and the source
 * aperture are drawn at `--beam`, which is 0.96 linear. A threshold of 0.86 sits
 * in the enormous gap between those two populations, so no drift in the surface
 * levels can ever make a housing bloom. The light theme takes less because its
 * background is bright and a halo on white reads as a smeared lens.
 */
const BLOOM: Record<"dark" | "light", { strength: number; radius: number; threshold: number }> = {
  dark: { strength: 0.18, radius: 0.5, threshold: 0.86 },
  light: { strength: 0.09, radius: 0.4, threshold: 0.9 },
};

export interface PostChain {
  readonly passNames: string[];
  /** Analytic GPU bytes held by the chain's render targets. */
  readonly bytes: number;
  readonly pixelRatio: number;
  render(): void;
  setSize(width: number, height: number): void;
  /** Returns false when the named pass is not in this tier's chain. */
  setPass(name: string, enabled: boolean): boolean;
  setDitherAmount(codes: number): void;
  dispose(): void;
}

export function hasPostChain(tier: SceneTier): boolean {
  return tier === "high" || tier === "mid";
}

export interface BuildOptions {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  tier: SceneTier;
  theme: "dark" | "light";
  /** Logical (CSS) pixels. */
  width: number;
  height: number;
}

export function buildPostChain(options: BuildOptions): PostChain {
  const { renderer, scene, camera, tier, theme, width, height } = options;
  const profile = profileFor(tier);

  const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const pixelRatio = Math.min(devicePixelRatio, COMPOSER_PIXEL_RATIO[tier]);
  const bufferWidth = Math.max(1, Math.round(width * pixelRatio));
  const bufferHeight = Math.max(1, Math.round(height * pixelRatio));

  /**
   * Half-float, and not for precision snobbery. Bloom thresholds at 0.86 and the
   * beam sits at 0.96, so an eight-bit buffer would clamp both into the same top
   * code and the threshold would stop selecting anything. `colorSpace` is left
   * alone: three treats a render target with no explicit colour space as being
   * in the working space, which is what every pass before `OutputPass` needs.
   */
  const target = new WebGLRenderTarget(bufferWidth, bufferHeight, { type: HalfFloatType });
  target.texture.name = "PostChain.rt";

  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);

/**
   * Passes are registered under names this file assigns.
   *
   * They were keyed on `pass.constructor.name`, which works in dev and silently
   * stops working in the built bundle: the minifier renames the classes, so the
   * chain came back as `jw -> ui -> Ja -> eA` and every `setPass` lookup missed.
   * That is worse than a crash. `setPass` returned false, the profiler reported
   * "not in this tier's chain" for every row, and an A/B that toggled nothing
   * produced two frames that differed anyway, from denoise state and dither, so
   * it looked exactly like real evidence of ambient occlusion working. A build
   * step quietly invalidating a measurement is the failure this whole packet is
   * supposed to be careful about.
   */
  const named = new Map<string, { enabled: boolean }>();
  const add = <T extends { enabled: boolean }>(name: string, pass: T): T => {
    named.set(name, pass);
    composer.addPass(pass as never);
    return pass;
  };

  add("RenderPass", new RenderPass(scene, camera));

  /**
   * Grounding. Without it the bench floats: every part meets the rail with no
   * darkening in the join, so nothing reads as resting on anything.
   *
   * Ground-truth ambient occlusion rather than the older SSAO, because SSAO's
   * bright halo around a silhouette is very visible against a near-black
   * background, and near-black background is most of this frame. The pass runs
   * its own depth and normal prepass, so it costs a second pass over the scene's
   * geometry; at roughly twenty meshes that is cheap, and it is measured.
   *
   * The radius is in world units and the bench is 14 across, so 0.25 is a couple
   * of centimetres at the room's scale: darkening in the joins, not a dirty wash
   * across whole faces.
   */
  const ao = new GTAOPass(scene, camera, bufferWidth, bufferHeight);
  ao.output = GTAOPass.OUTPUT.Default;
  ao.updateGtaoMaterial({
    // Measured by A/B against the same frame, not chosen. At 0.25 the darkening
    // was there in the numbers and invisible on screen: the bench is 14 units
    // across, so 0.25 is a couple of centimetres and the joins it darkens are
    // smaller than the pixels showing them at 1440p. 0.55 puts the occlusion at
    // the scale of the actual gaps, between a mount and the rail it stands on.
    radius: 0.55,
    distanceExponent: 1,
    thickness: 1,
    // Above 1 because the room is near black: occlusion is a multiplier, and
    // multiplying an already dark surface produces no visible change without it.
    scale: 1.6,
    samples: 16,
    screenSpaceRadius: false,
  });
  add("GTAOPass", ao);

  const bloom = BLOOM[theme];
  add(
    "UnrealBloomPass",
    new UnrealBloomPass(
      new Vector2(bufferWidth, bufferHeight),
      bloom.strength,
      bloom.radius,
      bloom.threshold,
    ),
  );

  /**
   * Depth of field, high tier only. SCENE.md measured stock `BokehPass` at
   * +10.3 ms because it renders the scene a second time into a depth target and
   * then takes 41 colour samples per pixel, which is why the mid tier drops it
   * outright rather than degrading it.
   *
   * Focused on the dispersing element, where the composition puts the reader's
   * attention, with an aperture small enough that the result is a softening at
   * the ends of the rail rather than a photographic blur.
   */
  if (profile.depthOfField) {
    add("BokehPass", new BokehPass(scene, camera, { focus: 15, aperture: 0.00012, maxblur: 0.006 }));
  }

  // Tone mapping and the sRGB encode, read off the renderer. Exactly once.
  add("OutputPass", new OutputPass());

  // Antialiasing, after the encode because it needs perceptual luminance.
  add("FXAAPass", new FXAAPass());

  const dither = add("DitherPass", new ShaderPass(DitherShader));

  return {
    passNames: [...named.keys()],

    // Two ping-pong buffers at eight bytes a pixel, plus the AO pass's own
    // normal target and its packed depth-stencil, at four bytes each.
    bytes: bufferWidth * bufferHeight * (8 * 2 + 4 + 4),

    pixelRatio,

    render() {
      composer.render();
    },

    setSize(w, h) {
      // Every pass resizes itself through the composer, FXAA included, whose
      // `resolution` uniform is the inverse of the buffer size and must never be
      // written by hand.
      composer.setSize(w, h);
    },

    setPass(name, enabled) {
      const pass = named.get(name);
      if (!pass) return false;
      pass.enabled = enabled;
      return true;
    },

    setDitherAmount(codes) {
      dither.uniforms.amount.value = codes;
    },

    dispose() {
      composer.dispose();
      target.dispose();
    },
  };
}
