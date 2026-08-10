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
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;
    const lose = (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  if (!detectWebGL()) return "still";

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
