/**
 * The pipeline's measurement surface, published on `window.__pipeline`.
 *
 * WHY THIS EXISTS AT ALL. Every number in this pipeline was supposed to be
 * measured rather than chosen, and the previous attempt shows what happens
 * otherwise: an exposure of 3.4 with a comment claiming it was measured, against
 * a scene whose lighting was broken in a way no exposure could fix. Measuring
 * properly means changing one variable and reading the result, and rebuilding
 * the site once per candidate takes long enough that it quietly turns back into
 * guessing. So the renderer's controls are reachable from a live page, and
 * `scripts/dev/scene-sweep.mjs` walks a whole operator-by-exposure grid against
 * one page load.
 *
 * It also answers the questions a reviewer will actually ask, which are not
 * about numbers: is there an environment, how much did it cost, how many
 * hemisphere lights are in the scene, which passes are in this tier's chain.
 * Those are all things that were previously only checkable by reading the source
 * and believing it.
 *
 * `window.__scene` is the scene core's handle and is left alone. This is a
 * second, narrower one, and both can be mounted at once.
 */
import type { ToneMapOperator } from "./tonemap";

export interface EnvironmentReport {
  intensity: number;
  /** Wall-clock cost of one prefilter. */
  ms: number;
  bytes: number;
  emitters: number;
}

export interface RenderHandleConfig {
  tier: string;
  theme: "dark" | "light";
  operator: ToneMapOperator;
  exposure: number;
  environment: EnvironmentReport | null;
  passes: string[];
  /** Names of every light in the scene, so their absence can be asserted. */
  describeLights?: () => string[];
  setExposure: (v: number) => void;
  setToneMapping: (op: ToneMapOperator) => void;
  setEnvironmentIntensity: (v: number) => void;
  setPass: (name: string, enabled: boolean) => boolean;
  setDither: (codes: number) => void;
}

export interface FrameReport {
  count: number;
  /** Milliseconds between consecutive frames. */
  p50: number;
  p95: number;
  max: number;
}

/**
 * A ring of frame timestamps.
 *
 * Fixed size and preallocated, because the thing being measured is frame time
 * and a profiler that allocates during the loop is measuring itself. 600 is the
 * scripted scroll's length in SCENE.md §8, so one full run fits without wrapping.
 */
const RING = 600;
const stamps = new Float64Array(RING);
let written = 0;

export function recordFrame(now: number): void {
  stamps[written % RING] = now;
  written += 1;
}

export function resetFrames(): void {
  written = 0;
}

function frameReport(): FrameReport | null {
  const count = Math.min(written, RING);
  if (count < 3) return null;

  // Consecutive deltas, in the order they were written. Only the unwrapped
  // portion is used, so a partial run reports on what it actually saw.
  const deltas: number[] = [];
  for (let i = 1; i < count; i += 1) {
    const d = stamps[i] - stamps[i - 1];
    // A negative delta means the ring wrapped between these two entries, and a
    // multi-second one means the tab was backgrounded. Neither is a frame.
    if (d > 0 && d < 1000) deltas.push(d);
  }
  if (deltas.length === 0) return null;

  deltas.sort((a, b) => a - b);
  const at = (q: number) => deltas[Math.min(deltas.length - 1, Math.floor(q * deltas.length))];
  return {
    count: deltas.length,
    p50: at(0.5),
    p95: at(0.95),
    max: deltas[deltas.length - 1],
  };
}

export interface RenderHandle {
  read: () => {
    tier: string;
    theme: "dark" | "light";
    operator: ToneMapOperator;
    exposure: number;
    environment: EnvironmentReport | null;
    environmentPresent: boolean;
    passes: string[];
    lights: string[];
    frames: FrameReport | null;
  };
  setExposure: (v: number) => void;
  setToneMapping: (op: ToneMapOperator) => void;
  setEnvironmentIntensity: (v: number) => void;
  setPass: (name: string, enabled: boolean) => boolean;
  setDither: (codes: number) => void;
  resetFrames: () => void;
}

declare global {
  interface Window {
    __pipeline?: RenderHandle;
  }
}

/** Publishes the handle and returns the teardown, for an effect to return. */
export function publishRenderHandle(config: RenderHandleConfig): () => void {
  if (typeof window === "undefined") return () => {};

  window.__pipeline = {
    read: () => ({
      tier: config.tier,
      theme: config.theme,
      operator: config.operator,
      exposure: config.exposure,
      environment: config.environment,
      environmentPresent: config.environment !== null,
      passes: config.passes,
      lights: config.describeLights ? config.describeLights() : [],
      frames: frameReport(),
    }),
    setExposure: config.setExposure,
    setToneMapping: config.setToneMapping,
    setEnvironmentIntensity: config.setEnvironmentIntensity,
    setPass: config.setPass,
    setDither: config.setDither,
    resetFrames,
  };

  return () => {
    delete window.__pipeline;
  };
}
