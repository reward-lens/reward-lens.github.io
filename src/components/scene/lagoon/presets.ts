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
    padding: 1.14,
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

export const LAGOON_LIGHTS = {
  light: {
    ambient: .06,
    key: 2.8,
    fill: .25,
    task: 3.2,
    gallery: 3.4,
    environment: .64,
    exposure: 1.06,
    bulbGlow: .5,
    beamGlow: .85,
    beamWidth: .22,
    background: "#c9dcd9",
  },
  dark: {
    ambient: .025,
    key: .45,
    fill: .09,
    task: 9,
    gallery: 8,
    environment: .17,
    exposure: .98,
    bulbGlow: .9,
    beamGlow: 1,
    beamWidth: .26,
    background: "#090d0e",
  },
} as const satisfies Record<LagoonTheme, {
  ambient: number; key: number; fill: number; task: number; gallery: number; environment: number; exposure: number;
  bulbGlow: number; beamGlow: number; beamWidth: number; background: string;
}>;

/** Real lamp positions exported with the articulated rig, in Three/glTF space. */
export const LAGOON_PRACTICALS = {
  TASK_LIGHT_BENCH_LEFT: [-2.4428742, 2.7682798, -1.47],
  TASK_LIGHT_BENCH_RIGHT: [2.4428742, 2.7682798, -1.47],
  TASK_LIGHT_UPPER_LEFT: [-2.95228369, 5.41245128, -2.18],
  TASK_LIGHT_UPPER_RIGHT: [3.61228369, 5.41245128, -2.18],
  GALLERY_LIGHT_LEFT: [-2.75, 6.6315996, -2.0119858],
  GALLERY_LIGHT_CENTER: [0, 6.6315996, -2.375],
  GALLERY_LIGHT_RIGHT: [2.75, 6.6315996, -2.0119858],
} as const;

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
