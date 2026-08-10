/**
 * The scene's half of the fidelity contract, published on `window.__scene`.
 *
 * Gate 20 compares three renderings of the same room, the hand-authored SVG,
 * the build-time still and this, and fails when they disagree by more than 8px
 * on the beam axis or the dispersing element's centroid. The SVG exposes those
 * through `data-landmark` attributes it can measure with a bounding rectangle.
 * A canvas has no such thing, so it has to project the points itself and hand
 * back viewport pixels in the same units.
 *
 * `fidelity.mjs` treats a fidelity that is present and exposes no landmarks as
 * a FAILURE rather than skipping it, which is the right way round: the
 * alternative is a gate that silently compares two things and reports three.
 *
 * The renderer is exposed alongside because the room's exposure is tuned
 * against measured surface levels, and being able to sweep it in a live page
 * beats rebuilding the site once per candidate value.
 */
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { BENCH, LANDMARKS } from "./layout";
import { readInstrumentFrame } from "./useInstrument";

/**
 * What the instrument's state actually is, in numbers, for the runtime gate.
 *
 * The scene contract's rule is that the current state may not be encoded only
 * in canvas pixels. A gate that tried to prove the camera interpolated by
 * diffing two screenshots would be reading the one surface where a change and a
 * coincidence are indistinguishable, and this repository has already published
 * one fake A/B for exactly that reason. So the pose is readable.
 */
export interface ScenePoseReadout {
  activeState: string;
  localProgress: number;
  /** The single scroll parameter across all five states. */
  progress: number;
  /** The pose the path asks for, before pointer parallax. */
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  fov: number;
  /** Where the camera actually is, parallax included. */
  cameraActual: [number, number, number];
  /** Every assembly the current position places, by name. */
  assemblies: Record<string, { opacity: number; emphasis: number; dataMix: number }>;
}

declare global {
  interface Window {
    __scene?: {
      landmarks: () => { beamAxis: number; prismCentroid: [number, number] };
      setExposure: (v: number) => void;
      getExposure: () => number;
      pose: () => ScenePoseReadout;
    };
  }
}

export function SceneHandle() {
  const { camera, gl, size } = useThree();

  useEffect(() => {
    /**
     * Project a world point to viewport pixels.
     *
     * The canvas is full-bleed and its own box is offset from the page origin,
     * so the projection is completed against `getBoundingClientRect` rather
     * than against the drawing-buffer size. Using the buffer would be wrong by
     * exactly the device pixel ratio on any screen where that is not 1, and
     * the tolerance is 8px, so it would pass on a laptop and fail on a phone.
     */
    const project = (world: readonly [number, number, number]): [number, number] => {
      const v = new Vector3(world[0], world[1], world[2]).project(camera);
      const rect = gl.domElement.getBoundingClientRect();
      return [
        rect.left + ((v.x + 1) / 2) * rect.width,
        rect.top + ((1 - v.y) / 2) * rect.height,
      ];
    };

    window.__scene = {
      landmarks: () => {
        const axis = project(LANDMARKS.opticalAxis);
        const prism = project([BENCH.prismX, 0, 0]);
        return { beamAxis: axis[1], prismCentroid: prism };
      },
      setExposure: (v: number) => {
        gl.toneMappingExposure = v;
      },
      getExposure: () => gl.toneMappingExposure,
      pose: () => {
        const frame = readInstrumentFrame();
        const assemblies: ScenePoseReadout["assemblies"] = {};
        for (const [name, p] of Object.entries(frame.assemblies)) {
          assemblies[name] = { opacity: p.opacity, emphasis: p.emphasis, dataMix: p.dataMix };
        }
        return {
          activeState: frame.state.activeState,
          localProgress: frame.state.localProgress,
          progress: frame.progress,
          cameraPosition: frame.camera.position,
          cameraTarget: frame.camera.target,
          fov: frame.camera.fov,
          cameraActual: [camera.position.x, camera.position.y, camera.position.z],
          assemblies,
        };
      },
    };

    return () => {
      delete window.__scene;
    };
  }, [camera, gl, size]);

  return null;
}
