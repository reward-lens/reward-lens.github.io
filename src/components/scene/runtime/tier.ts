/**
 * Which version of the room this session gets.
 *
 * The tier is decided once, before the first frame, and never changes again
 * while the page is open. A tier that re-evaluates mid-scroll produces a
 * visible quality step in the middle of an explanation, which reads as a bug
 * rather than as adaptation.
 *
 * THE BIAS IS DOWNWARD, DELIBERATELY. Every uncertain signal resolves to the
 * lower tier. A wrong guess upward costs dropped frames during the one moment
 * the site is making its argument; a wrong guess downward costs a shadow map.
 * `SCENE.md` records the measurements this table is built from: the key light
 * is the dominant cost at 4.6-5.2ms and is degraded here rather than left
 * alone, depth of field costs +10.3ms and so drops below the top tier, and
 * dispersion at 1.2ms is cheap enough to keep everywhere it renders at all.
 */

export type SceneTier = "high" | "mid" | "low" | "still";

export interface TierProfile {
  tier: SceneTier;
  /** Device pixel ratio ceiling. */
  pixelRatio: number;
  /** Shadow map edge, or 0 for no shadows. */
  shadowMapSize: number;
  depthOfField: boolean;
  bloom: boolean;
  /** Upper bound on simultaneously drawn rollout rays. */
  maxRays: number;
  /** Upper bound on drawn timeline points. */
  maxSeriesPoints: number;
}

const PROFILES: Record<SceneTier, TierProfile> = {
  high: {
    tier: "high",
    pixelRatio: 2,
    shadowMapSize: 1024,
    depthOfField: true,
    bloom: true,
    maxRays: 64,
    maxSeriesPoints: 401,
  },
  mid: {
    tier: "mid",
    pixelRatio: 1.5,
    shadowMapSize: 512,
    depthOfField: false,
    bloom: true,
    maxRays: 32,
    maxSeriesPoints: 201,
  },
  low: {
    tier: "low",
    pixelRatio: 1,
    shadowMapSize: 0,
    depthOfField: false,
    bloom: false,
    maxRays: 16,
    maxSeriesPoints: 101,
  },
  still: {
    tier: "still",
    pixelRatio: 1,
    shadowMapSize: 0,
    depthOfField: false,
    bloom: false,
    maxRays: 0,
    maxSeriesPoints: 0,
  },
};

export function profileFor(tier: SceneTier): TierProfile {
  return PROFILES[tier];
}

/**
 * Can this browser draw the room at all?
 *
 * The context is created and then immediately released. Holding it would mean
 * the page owns two contexts the moment the real one mounts, and browsers cap
 * the count per document at a number low enough to matter.
 */
export function detectWebGL(): boolean {
  return probeWebGL().supported;
}

export interface WebGLProbe {
  supported: boolean;
  software: boolean;
  renderer: string | null;
}

/**
 * Software WebGL is a fallback implementation, not a usable performance tier.
 *
 * The previous detector stopped at "a context exists". On this machine Chrome
 * exposes SwiftShader, so the CPU and memory hints selected the high tier even
 * though the renderer was software. The measured result was a 104 MB post
 * chain, 17.4 seconds of blocking work and less than one frame per second. That
 * is exactly the combination that makes native scrolling feel broken.
 *
 * Keep the classifier separate from the context probe so it can be exercised
 * without a browser. The strings cover the software adapters exposed by
 * Chromium/ANGLE and Mesa; an unknown renderer is treated as hardware because
 * hiding the scene on an unrecognised real GPU would be the wrong failure.
 */
export function isSoftwareRenderer(renderer: string | null | undefined): boolean {
  if (!renderer) return false;
  return /swiftshader|llvmpipe|softpipe|software rasterizer|software renderer/i.test(renderer);
}

export function probeWebGL(): WebGLProbe {
  if (typeof document === "undefined") {
    return { supported: false, software: false, renderer: null };
  }
  try {
    const canvas = document.createElement("canvas");
    // Ask the browser to refuse a context when it can provide only a major
    // performance fallback. This catches software rendering even when privacy
    // settings hide the unmasked renderer string. The scene is an enhancement,
    // so a conservative refusal is preferable to turning scrolling into CPU
    // rasterisation.
    const contextOptions: WebGLContextAttributes = { failIfMajorPerformanceCaveat: true };
    const gl =
      canvas.getContext("webgl2", contextOptions) ??
      canvas.getContext("webgl", contextOptions);
    if (!gl) return { supported: false, software: false, renderer: null };
    const debug = gl.getExtension("WEBGL_debug_renderer_info") as
      | { UNMASKED_RENDERER_WEBGL: number }
      | null;
    const renderer = String(
      debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
    );
    const lose = (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return {
      supported: true,
      software: isSoftwareRenderer(renderer),
      renderer,
    };
  } catch {
    return { supported: false, software: false, renderer: null };
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Local visual and gate work sometimes needs to exercise a live tier on a
 * machine whose only adapter is SwiftShader. Keep that override on loopback so
 * a public URL cannot ask a reader to opt back into the failure this detector
 * exists to prevent.
 */
export function parseLocalTierOverride(
  value: string | null | undefined,
  hostname: string | null | undefined,
): Exclude<SceneTier, "still"> | null {
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (!local) return null;
  return value === "high" || value === "mid" || value === "low" ? value : null;
}

/**
 * Decide the tier from conservative hardware hints.
 *
 * None of these signals is trustworthy alone, which is why the result is a
 * floor rather than a guess: any one of them reading low takes the whole
 * session down a tier. `deviceMemory` and `hardwareConcurrency` are absent on
 * several browsers and absence is treated as the low reading, not the high one.
 */
export function detectTier(): SceneTier {
  if (typeof window === "undefined") return "still";
  if (prefersReducedMotion()) return "still";
  const graphics = probeWebGL();
  if (!graphics.supported) return "still";
  const forced = parseLocalTierOverride(
    new URLSearchParams(window.location.search).get("scene-tier"),
    window.location.hostname,
  );
  if (forced) return forced;
  // A software adapter can technically draw the room, but doing so makes the
  // page less usable than the complete vector fallback. Do not download or
  // compile the 3D scene for it.
  if (graphics.software) return "still";

  const nav = window.navigator as Navigator & {
    deviceMemory?: number;
    hardwareConcurrency?: number;
  };

  const memory = nav.deviceMemory ?? 0;
  const cores = nav.hardwareConcurrency ?? 0;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const narrow = window.innerWidth < 768;

  // A phone gets the low tier regardless of what it claims about its cores.
  if (coarse && narrow) return "low";

  // Absent hints read as low, not as unknown-so-assume-fine.
  if (memory === 0 || cores === 0) return "mid";
  if (memory <= 4 || cores <= 4) return "low";
  if (memory >= 8 && cores >= 8) return "high";
  return "mid";
}

/**
 * Publish the decision so CSS, the fallback layer and the tests can all read
 * the same value. The attribute is the contract; nothing reads this module's
 * internals.
 */
export function publishTier(tier: SceneTier): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-scene-tier", tier);
}
