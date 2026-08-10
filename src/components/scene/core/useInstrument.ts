/**
 * How the renderer reads the reader's state.
 *
 * The rule this file exists to keep: the bridge is read inside the frame loop,
 * never subscribed to with React state. `localProgress` changes every frame,
 * and a `useState` on it would re-render the whole scene graph sixty times a
 * second to move a camera by a tenth of a unit. Reading a plain object in
 * `useFrame` costs nothing and is exactly as current.
 *
 * React state is used for the low-frequency half, the values that change when
 * the reader presses something, because those genuinely should re-render the
 * component that draws them.
 */
import { useEffect, useState } from "react";
import { getBridge, type InstrumentUiState } from "../runtime/bridge";
import { instrumentPoseAt } from "../runtime/states";
import type { AssemblyPose, CameraPose } from "../runtime/pose";

export interface InstrumentFrame {
  camera: CameraPose;
  assemblies: Record<string, AssemblyPose>;
  progress: number;
  state: InstrumentUiState;
}

/**
 * The instrument's pose right now. Call it from inside `useFrame`.
 *
 * Allocates a fresh object per call, which is the honest trade: the pose maps
 * are small, the alternative is a mutable singleton that two assemblies can
 * read at different points in the same frame and disagree about, and that class
 * of bug does not announce itself.
 */
export function readInstrumentFrame(): InstrumentFrame {
  const state = getBridge().read();
  const { camera, assemblies, progress } = instrumentPoseAt(
    state.activeState,
    state.localProgress,
  );
  return { camera, assemblies, progress, state };
}

/** One assembly's pose right now, or the identity when this state has none. */
export function readAssemblyPose(name: string): AssemblyPose | undefined {
  return readInstrumentFrame().assemblies[name];
}

/**
 * The part of the state that changes at human rate.
 *
 * Subscribing re-renders, so this deliberately does not expose
 * `localProgress`: a component that wants it reads the frame instead.
 */
export function useInstrumentSelection(): Omit<InstrumentUiState, "localProgress"> {
  const bridge = getBridge();
  const [value, setValue] = useState(() => {
    const { localProgress: _ignored, ...rest } = bridge.read();
    return rest;
  });

  useEffect(() => {
    return bridge.subscribe((next) => {
      setValue((previous) => {
        if (
          previous.activeState === next.activeState &&
          previous.activeCase === next.activeCase &&
          previous.isolatedObject === next.isolatedObject &&
          previous.tracedRollout === next.tracedRollout &&
          previous.disabledScoreComponent === next.disabledScoreComponent &&
          previous.motionPaused === next.motionPaused &&
          previous.tier === next.tier
        ) {
          return previous;
        }
        const { localProgress: _ignored, ...rest } = next;
        return rest;
      });
    });
  }, [bridge]);

  return value;
}
