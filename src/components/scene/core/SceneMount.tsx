/**
 * The decision to draw, made in the browser, before anything heavy loads.
 *
 * This component is deliberately tiny and imports nothing from Three. It runs,
 * decides whether this session gets a live room, and only then pulls the
 * renderer in. A browser that cannot draw, or a reader who has asked for less
 * motion, therefore never downloads the scene at all rather than downloading it
 * and declining to use it.
 *
 * FAILURE IS A STATE, NOT AN EXCEPTION. Context loss, a renderer that will not
 * start, and a chunk that will not load all end in the same place: the
 * hand-authored room stays visible and nothing about the page is broken. The
 * canvas is an enhancement over a complete document, in the order those words
 * are usually claimed and rarely built.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { detectTier, publishTier, type SceneTier } from "../runtime/tier";

const InstrumentScene = lazy(() => import("./InstrumentScene"));

export default function SceneMount() {
  const [tier, setTier] = useState<SceneTier | null>(null);
  const [failed, setFailed] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);

  useEffect(() => {
    const decided = detectTier();
    publishTier(decided);
    setTier(decided);
  }, []);

  /**
   * The pause control lives in the DOM, outside this island, so it works before
   * hydration and for a reader who never gets the canvas. This listens for it
   * rather than owning it.
   */
  useEffect(() => {
    const onToggle = (event: Event) => {
      const detail = (event as CustomEvent<{ paused: boolean }>).detail;
      setMotionPaused(Boolean(detail?.paused));
    };
    document.addEventListener("rl:motion-pause", onToggle);
    return () => document.removeEventListener("rl:motion-pause", onToggle);
  }, []);

  useEffect(() => {
    if (failed) document.documentElement.setAttribute("data-scene-failed", "true");
    else document.documentElement.removeAttribute("data-scene-failed");
  }, [failed]);

  // "still" means this session is served the authored composition, which is
  // already in the document. Nothing further to do.
  if (tier === null || tier === "still" || failed) return null;

  return (
    <Suspense fallback={null}>
      <InstrumentScene tier={tier} motionPaused={motionPaused} onFailure={() => setFailed(true)} />
    </Suspense>
  );
}
