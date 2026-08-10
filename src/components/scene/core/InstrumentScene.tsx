/**
 * The instrument, as one React Three Fiber island.
 *
 * One canvas, one WebGL context, one render loop, for the whole page. Anything
 * that needs to draw goes into this tree; nothing else on the site is allowed
 * to create a context, because browsers cap them per document at a number the
 * homepage would otherwise reach.
 *
 * WHAT THIS COMPONENT REFUSES TO DO. It holds no page copy, no headings, no
 * links and no result data typed by hand. Text belongs in the DOM where it can
 * be read, selected, translated and announced; numbers arrive through the scene
 * manifest. A canvas that owns prose is a canvas that has taken the argument
 * away from everyone who cannot see it.
 *
 * FIRST PAINT IS NOT THIS COMPONENT. The hand-authored room renders in the
 * document immediately and this mounts over it once it has drawn a frame. That
 * ordering is the reason the first viewport contains the argument even on a
 * connection that never finishes loading the scene.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { readPalette, readTheme, type ScenePalette } from "./palette";
import { profileFor, publishTier, type SceneTier } from "../runtime/tier";
import { useReadyFlag, useSceneLifecycle } from "./useSceneLifecycle";
import { BENCH } from "./layout";
import { Room } from "../assemblies/Room";
import { SourceAssembly } from "../assemblies/SourceAssembly";
import { SceneHandle } from "./SceneHandle";
import { InstrumentCamera } from "./InstrumentCamera";
import { RenderPipeline } from "../render/pipeline";
import { disposeSurfaces } from "../materials";
import { disposeGeometries } from "../geometry/profiles";
import { disposeLights } from "../assemblies/light";
import { disposePayloads } from "../assemblies/payload";
import { Downstream } from "../assemblies/Downstream";

interface Props {
  tier: SceneTier;
  motionPaused: boolean;
  /** Raised when the context is lost or the renderer cannot start. */
  onFailure: () => void;
}

/**
 * Drives the loop and announces readiness.
 *
 * `invalidate` is not used: the room is continuously lit and its camera moves
 * with the scroll, so an on-demand loop would spend more on scheduling than it
 * saves. It is stopped outright instead, which is cheaper than both.
 */
function Loop({ onFrame }: { onFrame: () => void }) {
  useFrame(() => onFrame());
  return null;
}

/**
 * Frees the three shared caches when the canvas goes away.
 *
 * The material library, the geometry library and the emissive materials are all
 * memoized on module-level maps rather than on component state, which is what
 * lets two assemblies asking for `anodized` get the same compiled program. The
 * cost of that decision is that nothing in React's tree owns them, so nothing
 * in React's tree frees them: without this the buffers and programs survive the
 * canvas and a reader who toggles reduced motion twice accumulates two full
 * scenes of GPU memory.
 *
 * Ordered after the tree unmounts, which is what a cleanup in an effect with no
 * dependencies gives. Disposing a material still assigned to a live mesh is a
 * GL error rather than a garbage collection.
 */
function ResourceLifetime() {
  useEffect(
    () => () => {
      disposeSurfaces();
      disposeGeometries();
      disposeLights();
      disposePayloads();
    },
    [],
  );
  return null;
}

/** Reports context loss up to the DOM so the fallback can take over. */
function ContextGuard({ onFailure }: { onFailure: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const onLost = (event: Event) => {
      event.preventDefault();
      document.documentElement.removeAttribute("data-scene-ready");
      onFailure();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    return () => canvas.removeEventListener("webglcontextlost", onLost);
  }, [gl, onFailure]);
  return null;
}

function SceneContents({
  palette,
  tier,
  theme,
  onFrame,
  onFailure,
}: {
  palette: ScenePalette;
  tier: SceneTier;
  theme: "dark" | "light";
  onFrame: () => void;
  onFailure: () => void;
}) {
  const profile = profileFor(tier);
  const shadows = profile.shadowMapSize > 0;

  return (
    <>
      <Loop onFrame={onFrame} />
      {/*
        Colour management, tone mapping, exposure, the prefiltered environment,
        the light rig and the post chain. INTERFACES.md §2; owned by
        `render/pipeline.tsx`. Mounted above every assembly.
      */}
      <RenderPipeline tier={tier} theme={theme} />
      {/*
        The camera path. Mounted above the assemblies so the pose it writes is
        the one they are drawn against in the same frame, and driven entirely
        from `runtime/states.ts`, which is data.
      */}
      <InstrumentCamera />
      <SceneHandle />
      <ContextGuard onFailure={onFailure} />
      <ResourceLifetime />
      <Room palette={palette} tier={tier} receiveShadow={shadows} />
      <SourceAssembly
        palette={palette}
        tier={tier}
        toX={BENCH.prismX}
        castShadow={shadows}
        spill={tier !== "low"}
      />
      {/*
        THE BOUNDARY IS HERE AND NOWHERE HIGHER. The downstream stations read
        generated payloads over the network and therefore suspend. A boundary
        that also contained `RenderPipeline` would stop the loop from mounting,
        so no frame would be drawn, so `data-scene-ready` would never be set,
        so the canvas would never fade in over the hand-authored room and gate
        26 would time out. The room and the source draw on the first frame
        whatever the network is doing; the stations arrive when their arrays do.
      */}
      <Suspense fallback={null}>
        <Downstream palette={palette} tier={tier} castShadow={shadows} />
      </Suspense>
    </>
  );
}

export default function InstrumentScene({ tier, motionPaused, onFailure }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { shouldRender } = useSceneLifecycle(hostRef, { motionPaused });
  const onFrame = useReadyFlag();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [palette, setPalette] = useState<ScenePalette | null>(null);
  const profile = profileFor(tier);

  useEffect(() => {
    publishTier(tier);
  }, [tier]);

  /**
   * The palette is re-read whenever the theme attribute changes, because the
   * toggle swaps a data attribute rather than reloading, and a room that keeps
   * its dark colours on a light page is the exact "inverted rather than
   * authored" failure the design forbids.
   */
  useEffect(() => {
    const sync = () => {
      setTheme(readTheme());
      setPalette(readPalette());
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    media?.addEventListener("change", sync);
    return () => {
      observer.disconnect();
      media?.removeEventListener("change", sync);
    };
  }, []);

  const camera = useMemo(
    () => ({
      // A narrow field of view. This is most of what separates an analytical
      // instrument from a game camera: long lens, little perspective
      // distortion, parts that stay parallel.
      fov: 26,
      // The distance is solved, not composed. The hand-authored room places the
      // dispersing element at 62% of the viewport's width, and the scene has to
      // agree with it inside 8px, so the twelve world units between the source
      // and the detector must span exactly the canvas's width:
      //   d * tan(fov/2) * aspect = 6
      // At fov 26 and a 1440x840 box that is d = 15.16. The camera keeps its
      // slight three-quarter offset for depth; only its distance is fixed.
      position: [1.05, 1.35, 15.05] as [number, number, number],
      /* The clip planes have to cover where `InstrumentCamera` can put the eye,
         not just where this default puts it. On a frame narrower than the room
         was composed for it slides back by the aspect ratio to keep the bench
         in view — about 56 units at 390 wide — so a far plane of 60 clipped the
         far half of the scene at exactly the viewport that most needed it.

         `near` goes up with it. Nothing is within 8 units of the eye at any
         pose, and 1/120 spends the depth buffer's precision on the range the
         scene actually occupies instead of on the 0.1 to 1 shell in front of it,
         where nothing is ever drawn. */
      near: 1,
      far: 120,
    }),
    [],
  );

  return (
    <div ref={hostRef} className="instrument-scene" data-scene-host>
      {palette && (
        <Canvas
          frameloop={shouldRender ? "always" : "never"}
          dpr={[1, profile.pixelRatio]}
          shadows={profile.shadowMapSize > 0}
          camera={camera}
          gl={{
            antialias: tier === "high",
            alpha: true,
            powerPreference: tier === "high" ? "high-performance" : "default",
          }}
        >
          <Suspense fallback={null}>
            <SceneContents
              palette={palette}
              tier={tier}
              theme={theme}
              onFrame={onFrame}
              onFailure={onFailure}
            />
          </Suspense>
        </Canvas>
      )}
    </div>
  );
}
