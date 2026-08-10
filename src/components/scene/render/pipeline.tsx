/**
 * Everything that decides what a lit surface turns into on screen.
 *
 * Mounted once inside the Canvas, above every assembly. It owns colour
 * management, the transfer curve, the exposure, the prefiltered environment,
 * the light rig, the grounding and the post chain, and nothing else in the tree
 * touches any of them. That concentration is the point: the previous render was
 * grey because those six things were decided in four different files by four
 * different arguments, and the two that mattered most, the environment and the
 * curve, were not decided at all.
 *
 * WHAT MOUNTS WHERE, AND WHY THE ORDER IN THE TREE IS NOT ARBITRARY. The
 * environment binding runs before the light rig, because the rig's intensities
 * were authored against a room that already has indirect light and mounting
 * them without it produces the too-dark scene that invites another exposure
 * rescue. The post chain is last, because its `useFrame` takes priority over
 * R3F's own render and it must see a complete tree.
 */
import { useEffect, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { ColorManagement, SRGBColorSpace, type Material } from "three";
import { readPalette } from "../core/palette";
import { profileFor, type SceneTier } from "../runtime/tier";
import { ENVIRONMENT_INTENSITY, lastEnvironmentBuild, useAuthoredEnvironment } from "./environment";
import { EXPOSURE, TONE_MAP, TONE_MAP_OPERATORS, type ToneMapOperator } from "./tonemap";
import { publishRenderHandle, recordFrame } from "./handle";
import { ContactShadow } from "./contact";
import { LightRig } from "../lighting/rig";
import { hasPostChain, PostChain } from "../post/PostChain";
import type { PostChain as PostChainApi } from "../post/chain";

export interface PipelineConfig {
  tier: SceneTier;
  theme: "dark" | "light";
}

/**
 * Colour management, the operator and the exposure.
 *
 * Set in an effect inside the tree, not in `onCreated`. `onCreated` fires once,
 * React Three Fiber re-applies renderer properties from the `gl` prop on later
 * renders, and the theme toggle swaps an attribute without reloading, so a
 * one-shot callback cannot follow it. That was measured the hard way on the
 * previous attempt: an exposure written in `onCreated` was present in the built
 * bundle and made no difference to a single pixel.
 *
 * `ColorManagement.enabled` and `outputColorSpace` are already what R3F sets,
 * and they are written here anyway. They are the two properties whose being
 * wrong looks exactly like a material problem, and a reader tracking down a
 * washed-out render should find them stated rather than have to know which
 * library's defaults were in force.
 */
function ColourPipeline({ theme, operator }: { theme: "dark" | "light"; operator: ToneMapOperator }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    ColorManagement.enabled = true;
    gl.outputColorSpace = SRGBColorSpace;
    gl.toneMapping = TONE_MAP_OPERATORS[operator];
    gl.toneMappingExposure = EXPOSURE[theme];
  }, [gl, theme, operator]);
  return null;
}

/**
 * The environment, bound to the scene.
 *
 * `scene.environment` is the assignment that makes every `MeshStandardMaterial`
 * in the tree sample the prefiltered cube, and `scene.environmentIntensity`
 * (three r163 and later, `Scene.js:95`) scales it without rebuilding the
 * texture. `scene.background` is deliberately left alone: the canvas composites
 * over the hand-authored room in the document, so painting the environment
 * behind the bench would replace the page with a grey box.
 */
function EnvironmentBinding({ theme }: { theme: "dark" | "light" }) {
  const scene = useThree((s) => s.scene);
  const texture = useAuthoredEnvironment(theme);

  useEffect(() => {
    scene.environment = texture;
    scene.environmentIntensity = ENVIRONMENT_INTENSITY[theme];
    return () => {
      scene.environment = null;
    };
  }, [scene, texture, theme]);

  return null;
}

/**
 * Three's own per-material dither, for the tier that has no composer.
 *
 * The composer path dithers in a pass at the very end, which is the only place
 * it works, and this flag is useless there: it would add its noise to a
 * half-float buffer that then goes through the tone curve and another
 * quantization. The low tier draws straight to the 8-bit canvas from inside the
 * shading pass, so for it this flag IS the dither, and the dark floor pool at
 * the low tier bands exactly as badly as anywhere else.
 *
 * Traversed every frame rather than once, because the flag has to reach
 * materials that mount after this component and the assemblies stream in. The
 * scene is about twenty meshes at this tier and the loop exits on the first
 * `WeakSet` hit, so the cost is unmeasurable against a frame that is entirely
 * GPU-bound.
 */
function MaterialDithering() {
  const scene = useThree((s) => s.scene);
  const seen = useMemo(() => new WeakSet<Material>(), []);
  useFrame(() => {
    scene.traverse((object) => {
      const material = (object as { material?: Material | Material[] }).material;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) {
        if (seen.has(m)) continue;
        seen.add(m);
        if (m.dithering) continue;
        m.dithering = true;
        m.needsUpdate = true;
      }
    });
  });
  return null;
}

/** Wall frame intervals, collected for the tier budget. */
function FrameClock() {
  useFrame(() => recordFrame(performance.now()));
  return null;
}

/**
 * The probe ladder, only when the URL asks for it.
 *
 * Dynamically imported, so what the shipped chunk carries is one
 * `URLSearchParams` check and a promise that is never created. The probe's own
 * module, its four materials and its sphere geometry are a separate chunk that
 * only a person who typed `?render-probe=1` ever fetches.
 */
function ProbeSlot({ enabled }: { enabled: boolean }) {
  const [Probe, setProbe] = useState<React.ComponentType<{ palette: ReturnType<typeof readPalette> }> | null>(
    null,
  );
  const palette = useMemo(() => (enabled ? readPalette() : null), [enabled]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void import("./probe").then((m) => {
      if (live) setProbe(() => m.default);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  if (!enabled || !Probe || !palette) return null;
  return <Probe palette={palette} />;
}

export function RenderPipeline({ tier, theme }: PipelineConfig) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const profile = profileFor(tier);

  /**
   * Read here rather than taken as a prop, because the frozen signature in
   * INTERFACES.md §2 is `{ tier, theme }` and widening it would be a local edit
   * to a file the integrator owns. `readPalette` resolves against the live
   * document, so keying the memo on the theme is exactly right: the theme
   * attribute is the only thing that changes what a token means.
   */
  const palette = useMemo(() => readPalette(), [theme]);

  const [operator, setOperator] = useState<ToneMapOperator>(TONE_MAP);
  const [chain, setChain] = useState<PostChainApi | null>(null);
  const [probe] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).has("render-probe");
  });

  useEffect(() => {
    return publishRenderHandle({
      tier,
      theme,
      operator,
      exposure: EXPOSURE[theme],
      environment: lastEnvironmentBuild
        ? { intensity: ENVIRONMENT_INTENSITY[theme], ...lastEnvironmentBuild }
        : null,
      passes: chain?.passNames ?? [],
      /**
       * Named rather than counted, so the acceptance check that the hemisphere
       * light is gone reads the running scene instead of trusting a diff. A
       * light removed from a component but left in a memo somewhere would still
       * show up here.
       */
      describeLights: () => {
        const names: string[] = [];
        scene.traverse((object) => {
          if ((object as { isLight?: boolean }).isLight) {
            names.push(`${object.type}${object.name ? `:${object.name}` : ""}`);
          }
        });
        return names.sort();
      },
      setExposure: (v) => {
        gl.toneMappingExposure = v;
      },
      setToneMapping: (op) => {
        // Through state rather than straight onto the renderer, so that the
        // effect that owns the property is the one that writes it and a later
        // theme change cannot quietly put the previous operator back.
        setOperator(op);
      },
      setEnvironmentIntensity: (v) => {
        scene.environmentIntensity = v;
      },
      setPass: (name, enabled) => chain?.setPass(name, enabled) ?? false,
      setDither: (codes) => chain?.setDitherAmount(codes),
    });
  }, [gl, scene, tier, theme, operator, chain]);

  return (
    <>
      <ColourPipeline theme={theme} operator={operator} />
      <EnvironmentBinding theme={theme} />
      <LightRig palette={palette} tier={tier} theme={theme} />
      {profile.shadowMapSize === 0 && <ContactShadow palette={palette} />}
      {profile.shadowMapSize === 0 && <MaterialDithering />}
      <FrameClock />
      <ProbeSlot enabled={probe} />
      {hasPostChain(tier) && <PostChain tier={tier} theme={theme} onChain={setChain} />}
    </>
  );
}

/** The other half of the frozen contract in INTERFACES.md §2, re-exported here
 *  so a consumer needs one import path rather than two. */
export { useAuthoredEnvironment } from "./environment";
export type { ToneMapOperator } from "./tonemap";
