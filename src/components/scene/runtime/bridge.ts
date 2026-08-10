/**
 * The one bridge between the DOM controls and the renderer.
 *
 * INTERFACES.md §4 froze this shape. Two rules are what the shape is for, and
 * both are enforced here rather than asked for:
 *
 *   1. **No Three object is ever put in this store.** The store holds ids,
 *      numbers and flags. A material, a mesh or a camera in a global store is a
 *      leak that survives every unmount and an object graph that no test can
 *      read without a GPU. Everything the renderer needs is derivable from
 *      `states.ts` given the values here.
 *   2. **No high-frequency frame value is serialized into the URL.** The state
 *      that survives a reload is the reader's declared intent: which subject
 *      they chose, what they isolated, whether they paused motion. Scroll
 *      position is the browser's job and `localProgress` is a frame value; a
 *      history entry per frame is a broken back button and a URL nobody can
 *      share.
 *
 * WHY SUBSCRIBERS ARE CALLED SYNCHRONOUSLY. The scroll binding already
 * schedules at most one `setState` per frame, so a second layer of batching
 * here would delay the renderer by a frame and make backward scroll feel late,
 * which is the one thing the movement may not do. Controls fire at human rate
 * and cost nothing.
 */
import type { InstrumentStateId } from "../types/truth";
import type { SceneTier } from "./tier";
import { defaultCase, STATE_DEFS } from "./states";

export interface InstrumentUiState {
  activeState: InstrumentStateId;
  /** 0 to 1 within the active state. Clamped. */
  localProgress: number;
  activeCase: string;
  isolatedObject: string | null;
  disabledScoreComponent: string | null;
  tracedRollout: string | null;
  motionPaused: boolean;
  tier: SceneTier;
}

export interface SceneBridge {
  setState(next: Partial<InstrumentUiState>): void;
  subscribe(fn: (s: InstrumentUiState) => void): () => void;
  read(): InstrumentUiState;
}

export const INITIAL_STATE: InstrumentUiState = {
  activeState: "scorer",
  localProgress: 0,
  activeCase: defaultCase("scorer"),
  isolatedObject: null,
  disabledScoreComponent: null,
  tracedRollout: null,
  motionPaused: false,
  tier: "still",
};

const clamp01 = (v: number) => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0);

/**
 * Publish the reader-visible part of the state on `<html>`, and no more.
 *
 * Every attribute written here changes at human rate, so a style recalculation
 * per change is free. `localProgress` is deliberately absent: it changes every
 * frame, and an attribute write per frame is a forced recalculation per frame
 * for a value only the renderer and the gate read. They read it through
 * `read()`.
 */
function publish(state: InstrumentUiState): void {
  if (typeof document === "undefined") return;
  const d = document.documentElement.dataset;
  d.instrumentCase = state.activeCase;
  if (state.isolatedObject) d.instrumentIsolated = state.isolatedObject;
  else delete d.instrumentIsolated;
  if (state.tracedRollout) d.instrumentTraced = state.tracedRollout;
  else delete d.instrumentTraced;
  if (state.disabledScoreComponent) d.instrumentScoreOff = state.disabledScoreComponent;
  else delete d.instrumentScoreOff;
  if (state.motionPaused) d.instrumentPaused = "true";
  else delete d.instrumentPaused;
}

/**
 * Reject a case that the active state cannot show.
 *
 * A control that sets a case belonging to another state would leave the source
 * plate describing a subject the scene is not drawing, which is precisely the
 * drift the truth contract exists to prevent. The state's own case list wins
 * and the change is dropped.
 */
function reconcileCase(next: InstrumentUiState, previous: InstrumentUiState): string {
  const allowed = STATE_DEFS[next.activeState].cases;
  if (allowed.includes(next.activeCase)) return next.activeCase;
  // The state changed and the case did not follow: take the new state's
  // default. This is the ordinary path on every scroll across a boundary.
  if (next.activeState !== previous.activeState) return defaultCase(next.activeState);
  return defaultCase(next.activeState);
}

export function createBridge(initial: Partial<InstrumentUiState> = {}): SceneBridge {
  let state: InstrumentUiState = { ...INITIAL_STATE, ...initial };
  state.localProgress = clamp01(state.localProgress);
  state.activeCase = reconcileCase(state, state);
  const subscribers = new Set<(s: InstrumentUiState) => void>();

  const bridge: SceneBridge = {
    read: () => state,
    subscribe(fn) {
      subscribers.add(fn);
      fn(state);
      return () => {
        subscribers.delete(fn);
      };
    },
    setState(next) {
      const previous = state;
      const merged: InstrumentUiState = { ...previous, ...next };
      merged.localProgress = clamp01(merged.localProgress);
      merged.activeCase = reconcileCase(merged, previous);

      // Nothing changed: no notification, no attribute write, no frame cost.
      let changed = false;
      for (const key of Object.keys(merged) as (keyof InstrumentUiState)[]) {
        if (merged[key] !== previous[key]) {
          changed = true;
          break;
        }
      }
      if (!changed) return;

      state = merged;

      // The attribute surface only moves when something other than progress
      // did, so a frame-rate progress update costs no style work.
      const structural =
        merged.activeCase !== previous.activeCase ||
        merged.isolatedObject !== previous.isolatedObject ||
        merged.tracedRollout !== previous.tracedRollout ||
        merged.disabledScoreComponent !== previous.disabledScoreComponent ||
        merged.motionPaused !== previous.motionPaused;
      if (structural) publish(merged);

      for (const fn of subscribers) fn(state);
    },
  };

  publish(state);
  return bridge;
}

declare global {
  interface Window {
    __instrument?: SceneBridge;
  }
}

let singleton: SceneBridge | null = null;

/**
 * The document's bridge.
 *
 * One per document, because there is one canvas per document. It is put on
 * `window.__instrument` so the runtime gate can read the state the scene is
 * actually in rather than inferring it from pixels, which is the failure the
 * "encode the current state only in canvas pixels" rule names.
 */
export function getBridge(): SceneBridge {
  if (typeof window === "undefined") return createBridge();
  if (window.__instrument) return window.__instrument;
  singleton = singleton ?? createBridge();
  window.__instrument = singleton;
  return singleton;
}
