import type { LagoonTheme } from "../rebuild/instrument-data";

export type LagoonView = "desktop" | "tablet" | "mobile";

/**
 * Capture and browser rendering deliberately share this small authored table.
 * The GLB is camera-agnostic; these values are the reviewed views of it.
 */
export const LAGOON_PRESETS = {
  desktop: {
    position: [10.4, 5.2, 16.4],
    targetAnchor: "CAMERA_DESKTOP_TARGET",
    pointerDegrees: 2,
    padding: 1.0,
  },
  tablet: {
    position: [10.4, 5.2, 16.4],
    targetAnchor: "CAMERA_DESKTOP_TARGET",
    pointerDegrees: 0,
    padding: 1.14,
  },
  mobile: {
    position: [3.1, 5.3, 20.8],
    targetAnchor: "CAMERA_MOBILE_TARGET",
    pointerDegrees: 0,
    padding: 1.10,
  },
} as const satisfies Record<LagoonView, {
  position: readonly [number, number, number];
  targetAnchor: string;
  pointerDegrees: number;
  padding: number;
}>;

/**
 * Day is a soft studio product shot: a slightly warm key from upper front
 * left, a cooler fill from the right, the studio environment carrying the
 * metal. Night is a lab after hours: the key becomes a dim cool moonlight
 * and the practicals, soffits and glowing panels carry the room.
 *
 * Intensities are three's physical units. `bulbRadiance` is the HDR
 * radiance of the visible bulbs, above the bloom threshold on purpose.
 * `aoDirect` is how much baked AO darkens direct light.
 */
export const LAGOON_LIGHTS = {
  light: {
    ambient: .06,
    key: 3.1,
    keyColor: "#fff0dc",
    fill: .34,
    fillSky: "#cfe7ee",
    fillGround: "#1b383f",
    fillDirect: .55,
    fillDirectColor: "#d4e8f0",
    task: 3.2,
    gallery: 3.4,
    soffit: 2.4,
    environment: .78,
    exposure: 1.0,
    bulbGlow: .5,
    bulbRadiance: 3.2,
    beamGlow: .85,
    beamWidth: .22,
    aoDirect: .35,
    background: "#c9dcd9",
  },
  dark: {
    ambient: .025,
    key: .7,
    keyColor: "#a9c2e0",
    fill: .18,
    fillSky: "#2d5266",
    fillGround: "#081216",
    fillDirect: .2,
    fillDirectColor: "#7b9cbc",
    task: 8.5,
    gallery: 6,
    soffit: 7,
    environment: .34,
    exposure: 1.05,
    bulbGlow: .9,
    bulbRadiance: 9,
    beamGlow: 1,
    beamWidth: .26,
    aoDirect: .55,
    background: "#090d0e",
  },
} as const satisfies Record<LagoonTheme, {
  ambient: number; key: number; keyColor: string; fill: number; fillSky: string; fillGround: string; fillDirect: number; fillDirectColor: string;
  task: number; gallery: number; soffit: number; environment: number; exposure: number;
  bulbGlow: number; bulbRadiance: number; beamGlow: number; beamWidth: number; aoDirect: number; background: string;
}>;

/**
 * Display transform. Khronos PBR Neutral keeps authored base colours (teal
 * petrol, marble white, brass gold) closest to the reference; see
 * design/pocket-lab/state/runtime-lighting.md for the comparison.
 * A `?lab-tone=neutral|agx|aces` query overrides it for review.
 */
export const LAGOON_TONE_MAPPING: "neutral" | "agx" | "aces" = "neutral";

/**
 * Bloom for the "full" tier only. The threshold is HDR luminance before tone
 * mapping: lit marble and the page-coloured clear stay below it, bulbs and
 * emissive panels go above it. `?lab-bloom=off` disables the pass.
 */
export const LAGOON_BLOOM = {
  enabled: true,
  light: { threshold: 2.4, strength: .24, radius: .35 },
  dark: { threshold: 2.0, strength: .38, radius: .3 },
} as const;

/**
 * The optical beam (beam.ts). The core, the travelling pulse, the glints and
 * the flares emit at `gain` times their colour so they clear the bloom
 * threshold; the skirt, motes, dispersion fan and bench pool stay below it.
 */
export const LAGOON_BEAM = {
  gain: 3.6,
  light: { skirt: .2, motes: .8, fan: .2, pool: .22, line: .42, pulseLight: 1.6 },
  dark: { skirt: .3, motes: 1.1, fan: .24, pool: .26, line: 1.1, pulseLight: 2.2 },
  /** Reach of the beam's line light (m). */
  lineRange: 1.1,
  motes: { full: 96, reduced: 48, compact: 0 },
} as const;

/** Rest positions of the modeled lamps, in Three/glTF space, as exported with the room (anchors.json `practicals` also carries their aims). */
export const LAGOON_PRACTICALS = {
  TASK_LIGHT_BENCH_LEFT: [-1.85404, 2.97961, -2.75403],
  TASK_LIGHT_BENCH_RIGHT: [1.72279, 2.97961, -2.77848],
  TASK_LIGHT_UPPER_LEFT: [-4.04141, 5.59326, -1.80277],
  TASK_LIGHT_UPPER_RIGHT: [1.01503, 5.59326, -2.75358],
  GALLERY_LIGHT_LEFT: [-2.57167, 7.015, -2.75688],
  GALLERY_LIGHT_CENTER: [0, 7.015, -3.1],
  GALLERY_LIGHT_RIGHT: [2.57167, 7.015, -2.75688],
} as const;

/** Downlights under the gallery. They have no rest positions: a room without them leaves the slots dark. */
export const LAGOON_SOFFITS = ["SOFFIT_LIGHT_1", "SOFFIT_LIGHT_2", "SOFFIT_LIGHT_3", "SOFFIT_LIGHT_4"] as const;

export const LAGOON_MATERIALS = {
  beam: "#f4b866",
  beamDim: "#b98643",
  contact: "#183f48",
} as const;

/** Drawing-buffer caps, shared with capture/profiling without changing CSS size. */
export const LAGOON_QUALITY = {
  standard: { pixelCap: 1_500_000, dprCap: 1.5 },
  compact: { pixelCap: 750_000, dprCap: 1.25 },
} as const;

export function lagoonView(width: number): LagoonView {
  return width <= 768 ? "mobile" : width <= 1100 ? "tablet" : "desktop";
}
