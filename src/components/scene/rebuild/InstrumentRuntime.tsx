import { Component, createElement, type ReactNode, useEffect, useLayoutEffect } from "react";
import { createRoot, extend, useThree, type RootStore } from "@react-three/fiber";
import { AmbientLight, DirectionalLight, HemisphereLight, PointLight } from "three";
import type { InstrumentStage, LagoonTheme } from "./instrument-data";
import { LagoonScene, type LagoonRenderMetrics } from "../lagoon/LagoonScene";

// `createRoot` has no Canvas component to populate the catalogue. Register only
// the lights emitted by LagoonScene so this deferred module remains granular.
extend({ AmbientLight, HemisphereLight, DirectionalLight, PointLight });

export interface InstrumentRuntimeProps {
  stage: InstrumentStage;
  theme: LagoonTheme;
  capture: boolean;
  assetUrl: string;
  running: boolean;
  paused: boolean;
  reducedMotion: boolean;
  revision: number;
  lifecycleSignal: AbortSignal;
  onReady(metrics: LagoonRenderMetrics): void;
  onFrame(metrics: Pick<LagoonRenderMetrics, "drawCalls" | "triangles" | "frames">): void;
  onFailure(error: unknown): void;
  onContextRestored(): void;
}

export interface RuntimeMount {
  render(props: InstrumentRuntimeProps): void;
  unmount(): void;
}

function ContextGuard({ onFailure, onContextRestored }: Pick<InstrumentRuntimeProps, "onFailure" | "onContextRestored">) {
  const gl = useThree(state => state.gl);

  useEffect(() => {
    const lost = (event: Event) => {
      event.preventDefault();
      onFailure(event);
    };
    const restored = () => onContextRestored();
    gl.domElement.addEventListener("webglcontextlost", lost);
    gl.domElement.addEventListener("webglcontextrestored", restored);
    return () => {
      gl.domElement.removeEventListener("webglcontextlost", lost);
      gl.domElement.removeEventListener("webglcontextrestored", restored);
    };
  }, [gl, onContextRestored, onFailure]);

  return null;
}

class SceneErrorBoundary extends Component<{ onFailure(error: unknown): void; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onFailure(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function RuntimeTree(props: InstrumentRuntimeProps) {
  const setFrameloop = useThree(state => state.setFrameloop);

  useLayoutEffect(() => {
    // This method also resets R3F's clock correctly when demand resumes.
    setFrameloop(props.running ? "demand" : "never");
  }, [props.running, props.paused, setFrameloop]);

  return createElement(
    SceneErrorBoundary,
    { onFailure: props.onFailure },
    createElement(ContextGuard, { onFailure: props.onFailure, onContextRestored: props.onContextRestored }),
    createElement(LagoonScene, { ...props, onError: props.onFailure }),
  );
}

/**
 * Deferred direct R3F root. This avoids the React DOM client wrapper while retaining one
 * persistent R3F renderer and canvas for all stage and theme updates.
 */
export async function mountRuntime(container: HTMLElement): Promise<RuntimeMount> {
  const canvas = document.createElement("canvas");
  canvas.className = "instrument-runtime__canvas";
  canvas.setAttribute("aria-hidden", "true");
  container.replaceChildren(canvas);

  const root = createRoot(canvas);
  try {
    await root.configure({
      orthographic: false,
      dpr: [1, 1.5],
      frameloop: "never",
      camera: { near: 0.1, far: 100, fov: 32, position: [8.2, 7.15, 17.2] },
      gl: {
        antialias: true,
        alpha: false,
        powerPreference: "low-power",
        failIfMajorPerformanceCaveat: true,
      },
    });
  } catch (error) {
    root.unmount();
    canvas.remove();
    throw error;
  }

  let dead = false;
  let store: RootStore | null = null;
  const resize = () => {
    if (dead || !store) return;
    const { width, height } = container.getBoundingClientRect();
    if (width > 0 && height > 0) store.getState().setSize(width, height);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  return {
    render(props) {
      if (dead) return;
      store = root.render(createElement(RuntimeTree, props));
      resize();
    },
    unmount() {
      if (dead) return;
      dead = true;
      resizeObserver.disconnect();
      root.unmount();
      canvas.remove();
    },
  };
}
