/**
 * When the room is allowed to render.
 *
 * Three independent conditions gate the loop, and all three must hold: the
 * canvas is on screen, the document is visible, and motion has not been paused.
 * Any one of them failing stops the render loop rather than throttling it,
 * because a room nobody is looking at should cost nothing at all.
 *
 * WHY THIS IS NOT INSIDE THE CANVAS COMPONENT. The observer and the visibility
 * listener have to outlive React's reconciliation of the scene graph, and they
 * have to be readable by the tests without mounting WebGL. Keeping them here
 * means the lifecycle can be exercised in a browser that cannot draw at all.
 */
import { useEffect, useRef, useState } from "react";

export type SceneStatus = "loading" | "ready" | "paused" | "failed" | "fallback";

interface Options {
  /** Start rendering slightly before the room scrolls into view. */
  rootMargin?: string;
  motionPaused: boolean;
}

export function useSceneLifecycle(
  hostRef: React.RefObject<HTMLElement | null>,
  { rootMargin = "200px", motionPaused }: Options,
) {
  const [onScreen, setOnScreen] = useState(false);
  const [docVisible, setDocVisible] = useState(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === "undefined") {
      // No observer means no way to know it left; rendering always is the
      // safe reading, since the alternative is a room that never starts.
      setOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setOnScreen(entry.isIntersecting);
      },
      { rootMargin },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [hostRef, rootMargin]);

  useEffect(() => {
    const onVisibility = () => setDocVisible(document.visibilityState === "visible");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const shouldRender = onScreen && docVisible && !motionPaused;
  return { shouldRender, onScreen, docVisible };
}

/**
 * Mark the document ready only after a frame has actually been drawn.
 *
 * The attribute is what the screenshot harness and the functional gate wait
 * on, so setting it when the component mounts would make every scene capture a
 * photograph of an empty canvas. It is set from inside the render loop, on the
 * second frame: the first is when the renderer has a context, the second is
 * when it has drawn with it.
 */
export function useReadyFlag() {
  const frames = useRef(0);
  const announced = useRef(false);

  const onFrame = () => {
    if (announced.current) return;
    frames.current += 1;
    if (frames.current >= 2) {
      announced.current = true;
      document.documentElement.setAttribute("data-scene-ready", "true");
    }
  };

  useEffect(() => {
    return () => {
      document.documentElement.removeAttribute("data-scene-ready");
    };
  }, []);

  return onFrame;
}
