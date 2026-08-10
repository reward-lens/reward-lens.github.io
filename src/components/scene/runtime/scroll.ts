/**
 * The scroll binding: where the reader is, expressed as one number.
 *
 * WHAT THIS DOES NOT DO, and the list is the design. No wheel handler. No touch
 * handler. No `scroll` listener. No scroll-snap. No pinned document. No forced
 * viewport height. Scrolling behaves exactly as the browser makes it behave,
 * and this file only reads the result. The narrative column is ordinary
 * document flow and the visual region is `position: sticky`, both of which are
 * CSS, so a reader with scripting off gets the same layout and the same words.
 *
 * WHICH ARTICLE IS ACTIVE IS NOT DECIDED HERE. `home/story/instrument-story`
 * already runs an IntersectionObserver over the five articles, marks one, and
 * publishes it on `data-instrument-state` plus an `instrumentstate` event. This
 * consumes that. Running a second observer over the same elements would give
 * the page two opinions about where the reader is, and they would disagree at
 * exactly the boundaries where it matters.
 *
 * LOCAL PROGRESS IS MEASURED ONCE PER FRAME, FROM CACHED GEOMETRY. The article
 * offsets are read on bind and again on resize, never inside the frame loop, so
 * no frame reads layout at all: the per-frame work is `window.scrollY`
 * arithmetic. That is what keeps this off the critical path and out of the
 * read-then-write pattern that forces synchronous layout.
 *
 * THE MAPPING IS LINEAR AND THERE IS NO SMOOTHING. A scrubbed value with easing
 * or damping lags the reader on the way back up, and backward scroll that feels
 * delayed is the single most common way a scroll-bound scene reads as broken.
 * Springs exist in this build, in the controls, where the input is a discrete
 * event rather than a position.
 *
 * REDUCED MOTION TAKES A DIFFERENT PATH, NOT A SLOWER ONE. No frame loop is
 * ever started. Progress steps to the start of each state as the reader crosses
 * into it, from the story's own event, and nothing animates between.
 */
import type { InstrumentStateId } from "../types/truth";
import { INSTRUMENT_STATES } from "../types/truth";
import type { SceneBridge } from "./bridge";

const isStateId = (v: string): v is InstrumentStateId =>
  (INSTRUMENT_STATES as readonly string[]).includes(v);

export interface ScrollBinding {
  /** Recompute the cached article geometry. Called on resize; exported for tests. */
  measure(): void;
  stop(): void;
}

interface Article {
  id: InstrumentStateId;
  /** Distance from the document origin to the article's top, in CSS pixels. */
  top: number;
  height: number;
}

export interface BindOptions {
  /**
   * The reader's eye line as a fraction of the viewport. 0.5 is the middle,
   * which is where the story's own observer band already is: its rootMargin is
   * -45% top and bottom, so the band it marks on is the middle tenth. Using a
   * different line here would make the active article and the progress through
   * it describe two different places on the screen.
   */
  eyeLine?: number;
  reducedMotion?: boolean;
}

export function bindScroll(
  root: HTMLElement,
  bridge: SceneBridge,
  options: BindOptions = {},
): ScrollBinding {
  const eyeLine = options.eyeLine ?? 0.5;
  const reduced =
    options.reducedMotion ??
    (typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));

  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>("[data-instrument-state]"),
  ).filter((el) => isStateId(el.dataset.instrumentState ?? ""));

  let articles: Article[] = [];
  const measure = () => {
    articles = nodes.map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        id: el.dataset.instrumentState as InstrumentStateId,
        top: rect.top + window.scrollY,
        height: Math.max(1, rect.height),
      };
    });
  };

  /**
   * Seed from what the document already says.
   *
   * A URL with a fragment lands the reader inside the movement before anything
   * hydrates, and starting at state one there would be a visible jump from a
   * pose that was never correct. The story publishes the active state on the
   * document element as soon as its observer runs, so the opening read is that
   * value and not an assumption.
   */
  const currentStateFromDom = (): InstrumentStateId => {
    const published =
      document.documentElement.dataset.instrumentState ?? root.dataset.activeState ?? "";
    return isStateId(published) ? published : bridge.read().activeState;
  };

  const onStoryState = (event: Event) => {
    const detail = (event as CustomEvent<{ state?: string }>).detail;
    const id = detail?.state ?? "";
    if (!isStateId(id)) return;
    // The article changed, so its geometry may have too: a state that was
    // below the fold can have grown since bind time on a font swap.
    bridge.setState({ activeState: id, localProgress: reduced ? 0 : localProgressFor(id) });
  };

  const localProgressFor = (id: InstrumentStateId): number => {
    const article = articles.find((a) => a.id === id);
    if (!article) return 0;
    const eye = window.scrollY + window.innerHeight * eyeLine;
    return (eye - article.top) / article.height;
  };

  let frame = 0;
  let running = false;

  const tick = () => {
    frame = 0;
    if (!running) return;
    const id = bridge.read().activeState;
    // One write per frame, and it is a store write rather than a DOM write.
    // The bridge clamps, so a reader sitting above the first article or below
    // the last gets the endpoint pose rather than an extrapolated one.
    bridge.setState({ localProgress: localProgressFor(id) });
    schedule();
  };

  const schedule = () => {
    if (frame || !running) return;
    frame = requestAnimationFrame(tick);
  };

  /**
   * The frame loop runs only while the movement is on screen. Below the fold
   * and above it, the last pose holds, which is also what the renderer's own
   * lifecycle does with the render loop.
   */
  const visibility =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          (entries) => {
            const onScreen = entries.some((e) => e.isIntersecting);
            if (onScreen === running) return;
            running = onScreen;
            if (running) schedule();
          },
          { rootMargin: "20% 0px 20% 0px" },
        );

  const onResize = () => {
    measure();
    if (!running) bridge.setState({ localProgress: localProgressFor(bridge.read().activeState) });
  };

  measure();
  bridge.setState({
    activeState: currentStateFromDom(),
    localProgress: reduced ? 0 : localProgressFor(currentStateFromDom()),
  });

  document.addEventListener("instrumentstate", onStoryState);
  window.addEventListener("resize", onResize, { passive: true });

  if (!reduced) {
    if (visibility) visibility.observe(root);
    else {
      running = true;
      schedule();
    }
  }

  return {
    measure,
    stop() {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      visibility?.disconnect();
      document.removeEventListener("instrumentstate", onStoryState);
      window.removeEventListener("resize", onResize);
    },
  };
}
