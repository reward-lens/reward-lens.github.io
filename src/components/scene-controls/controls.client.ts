/**
 * The controls, wired once.
 *
 * THE CANVAS IS NOT THE HIT-TESTING SURFACE. It is `pointer-events: none` and
 * nothing here raycasts into it. Every control below is a native `button`,
 * `input` or radio group in the document, so it is focusable, announced,
 * translatable and operable before the renderer exists and after it fails.
 *
 * WHAT EACH CONTROL IS FOR. Not one of them exists to demonstrate that the
 * scene is interactive. The legend isolates one named part of the explanation.
 * The subject selector changes which recorded case the state is showing, and
 * the source plate follows it. The score-component control performs a real
 * recomputation over the recorded run and states its result, including when
 * that result is a negative. Tracing a rollout picks one exact recorded rollout
 * out of the fan and says what the record holds about it and where the record
 * stops.
 *
 * KEYBOARD AND POINTER PRODUCE THE SAME SELECTED ID, because they call the same
 * function with the same `data-scene-object`. Hover and focus both preview an
 * isolation; a click or `Enter` pins it; `Escape` clears both. There is no
 * hover-only affordance anywhere here, and nothing is conveyed by colour,
 * depth or motion alone: an isolated part is named in the legend's own text and
 * marked with `aria-pressed`.
 */
import { getBridge, type InstrumentUiState } from "../scene/runtime/bridge";
import { bindScroll } from "../scene/runtime/scroll";
import { detectTier } from "../scene/runtime/tier";

const SELECTOR = {
  root: "[data-scene-controls]",
  story: "[data-instrument-story]",
  legendButton: "[data-scene-object]",
  caseBlock: "[data-scene-case]",
  subject: "[data-scene-subject]",
  scoreToggle: "[data-scene-score-toggle]",
  scoreSummary: "[data-scene-score-summary]",
  traceButton: "[data-scene-trace-step]",
  traceClear: "[data-scene-trace-clear]",
  traceRow: "[data-scene-trace-row]",
  traceEmpty: "[data-scene-trace-empty]",
  pause: "[data-scene-pause]",
} as const;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

let mounted = false;

export function mountSceneControls(): void {
  if (typeof document === "undefined") return;
  /* One binding per document. Two panels on one page would otherwise attach
     two sets of listeners to the same buttons and toggle the pinned isolation
     twice per click, which reads as a control that does nothing. */
  if (mounted) return;
  const roots = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR.root));
  if (roots.length === 0) return;
  mounted = true;

  const bridge = getBridge();
  const reduced = reducedMotion();

  /**
   * The tier is the renderer's decision and this republishes it into the
   * bridge so a control can reason about it without importing the renderer.
   * `detectTier` is pure and cheap; the island calls it too and both get the
   * same answer, because it reads only the browser.
   */
  bridge.setState({ tier: detectTier(), motionPaused: reduced });

  const story = document.querySelector<HTMLElement>(SELECTOR.story);
  if (story) bindScroll(story, bridge, { reducedMotion: reduced });

  /* ---------------------------------------------------------------------
     Isolation. One pinned value and one preview, and the scene shows the
     preview when there is one. Two separate variables rather than a stack,
     because a stack of hovers is how a legend ends up isolating whatever the
     pointer happened to leave last.
  --------------------------------------------------------------------- */
  let pinned: string | null = null;

  const apply = (preview: string | null) => {
    bridge.setState({ isolatedObject: preview ?? pinned });
  };

  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(SELECTOR.legendButton),
  );

  /**
   * Paint the pinned state onto the buttons.
   *
   * This is separate from `render` and called directly by the click handler,
   * because pinning is not always a change to the bridge: clicking the entry
   * the pointer is already previewing leaves `isolatedObject` at the same
   * value, the bridge correctly declines to notify, and `aria-pressed` would
   * have stayed false while the entry was pinned. Measured in a browser, not
   * reasoned about: the first run of the probe reported an isolated object and
   * an unpressed button at the same time.
   */
  const paintPressed = () => {
    for (const button of buttons) {
      button.setAttribute(
        "aria-pressed",
        button.dataset.sceneObject === pinned ? "true" : "false",
      );
    }
  };

  for (const button of buttons) {
    const object = button.dataset.sceneObject ?? "";
    if (!object) continue;

    // Pointer and keyboard are the same call. This is the parity the contract
    // asks for, and writing it as one function is the only way it stays true.
    button.addEventListener("pointerenter", () => apply(object));
    button.addEventListener("focus", () => apply(object));
    button.addEventListener("pointerleave", () => apply(null));
    button.addEventListener("blur", () => apply(null));
    button.addEventListener("click", () => {
      pinned = pinned === object ? null : object;
      paintPressed();
      apply(pinned);
    });
  }

  /* Escape clears isolation from anywhere, including from inside a control,
     which is where a keyboard reader will be when they want it cleared. */
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const state = bridge.read();
    if (!state.isolatedObject && !state.tracedRollout) return;
    pinned = null;
    paintPressed();
    bridge.setState({ isolatedObject: null, tracedRollout: null });
  });

  /* ---------------------------------------------------------------------
     The subject selector. A native radio group, so the roving focus, the
     arrow keys and the announcement are the platform's.
  --------------------------------------------------------------------- */
  for (const input of Array.from(
    document.querySelectorAll<HTMLInputElement>(SELECTOR.subject),
  )) {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      /*
        The state travels with the case. The bridge refuses a case the active
        state cannot show, which is the right rule and it turned this control
        into a no-op the first time it was driven: focusing a radio scrolls it
        into view, the observer can publish the neighbouring state on the way,
        and the change then arrived against a state that does not own the case.
        Asking for a subject is asking for the state that holds it.
      */
      const state = input.dataset.sceneSubjectState;
      bridge.setState(
        state
          ? { activeState: state as InstrumentUiState["activeState"], activeCase: input.value }
          : { activeCase: input.value },
      );
    });
  }

  /* ---------------------------------------------------------------------
     The score-component control. Unchecking it removes the only leaf this
     run's score tree has, and both the encoded state and the summary beside
     it change to the result of that removal.
  --------------------------------------------------------------------- */
  for (const input of Array.from(
    document.querySelectorAll<HTMLInputElement>(SELECTOR.scoreToggle),
  )) {
    const component = input.dataset.sceneScoreToggle ?? "";
    input.addEventListener("change", () => {
      bridge.setState({ disabledScoreComponent: input.checked ? null : component });
    });
  }

  /* ---------------------------------------------------------------------
     Trace one rollout. Steps through the recorded step's own rollouts in the
     order the record lists them, so pressing it twice never lands on the same
     one and never lands on one that is not in the record.
  --------------------------------------------------------------------- */
  const traceRows = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR.traceRow));
  const traceIds = traceRows.map((row) => row.dataset.sceneTraceRow ?? "").filter(Boolean);

  const setTrace = (id: string | null) => {
    bridge.setState({ tracedRollout: id });
  };

  for (const button of Array.from(
    document.querySelectorAll<HTMLButtonElement>(SELECTOR.traceButton),
  )) {
    button.addEventListener("click", () => {
      if (traceIds.length === 0) return;
      const current = bridge.read().tracedRollout;
      const at = current ? traceIds.indexOf(current) : -1;
      setTrace(traceIds[(at + 1) % traceIds.length]);
    });
  }
  for (const button of Array.from(
    document.querySelectorAll<HTMLButtonElement>(SELECTOR.traceClear),
  )) {
    button.addEventListener("click", () => setTrace(null));
  }

  /* ---------------------------------------------------------------------
     Pause motion. Persistent, and it reaches the render loop through the
     event the island already listens for, so it works whether or not this
     module and the island hydrated in the same order.
  --------------------------------------------------------------------- */
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>(SELECTOR.pause))) {
    button.addEventListener("click", () => {
      const paused = !bridge.read().motionPaused;
      bridge.setState({ motionPaused: paused });
      document.dispatchEvent(new CustomEvent("rl:motion-pause", { detail: { paused } }));
    });
  }

  /* ---------------------------------------------------------------------
     Rendering. One subscription, and it does nothing unless a value it draws
     actually changed: `localProgress` arrives every frame and must not cost a
     DOM write.
  --------------------------------------------------------------------- */
  let last: Partial<InstrumentUiState> = {};

  bridge.subscribe((state) => {
    if (
      state.activeState === last.activeState &&
      state.activeCase === last.activeCase &&
      state.isolatedObject === last.isolatedObject &&
      state.tracedRollout === last.tracedRollout &&
      state.disabledScoreComponent === last.disabledScoreComponent &&
      state.motionPaused === last.motionPaused
    ) {
      return;
    }
    const previousCase = last.activeCase;
    last = { ...state };
    render(state, previousCase !== undefined && previousCase !== state.activeCase);
  });

  function render(state: InstrumentUiState, caseChanged = false): void {

    // Blocks that belong to a case: the source plate and the legend. Hidden
    // rather than removed, so the whole set is in the document for a reader
    // with no scripting and the change is one attribute.
    for (const block of Array.from(document.querySelectorAll<HTMLElement>(SELECTOR.caseBlock))) {
      block.hidden = block.dataset.sceneCase !== state.activeCase;
    }

    /*
      The panel is taller than its column on a short screen, so it scrolls
      inside itself. Swapping the case swaps content of a different height
      underneath whatever offset the panel was left at, and the 1440 capture
      caught the result: a viewport clipped in half and a caption starting
      mid-sentence. The offset belongs to the subject, so it resets with it,
      and only with it: a reader who scrolled the panel themselves while
      reading one subject keeps their place.
    */
    if (caseChanged) {
      for (const panel of roots) panel.scrollTop = 0;
    }

    for (const button of buttons) {
      const object = button.dataset.sceneObject ?? "";
      const isolated = state.isolatedObject === object;
      button.setAttribute("aria-pressed", pinned === object ? "true" : "false");
      button.dataset.isolated = isolated ? "true" : "false";
    }

    // The subject selector follows the state, so scrolling into a state whose
    // case differs from the checked radio does not leave the two disagreeing.
    for (const input of Array.from(
      document.querySelectorAll<HTMLInputElement>(SELECTOR.subject),
    )) {
      input.checked = input.value === state.activeCase;
    }

    for (const row of traceRows) {
      row.hidden = row.dataset.sceneTraceRow !== state.tracedRollout;
    }
    for (const empty of Array.from(document.querySelectorAll<HTMLElement>(SELECTOR.traceEmpty))) {
      empty.hidden = Boolean(state.tracedRollout);
    }
    for (const button of Array.from(
      document.querySelectorAll<HTMLButtonElement>(SELECTOR.traceClear),
    )) {
      button.hidden = !state.tracedRollout;
    }

    for (const summary of Array.from(
      document.querySelectorAll<HTMLElement>(SELECTOR.scoreSummary),
    )) {
      const wants = summary.dataset.sceneScoreSummary === "off" ? "off" : "on";
      const isOff = Boolean(state.disabledScoreComponent);
      summary.hidden = wants !== (isOff ? "off" : "on");
    }

    for (const button of Array.from(
      document.querySelectorAll<HTMLButtonElement>(SELECTOR.pause),
    )) {
      const paused = state.motionPaused;
      button.setAttribute("aria-pressed", paused ? "true" : "false");
      const label = paused ? button.dataset.labelResume : button.dataset.labelPause;
      const text = button.querySelector<HTMLElement>("[data-scene-pause-label]");
      if (label && text) text.textContent = label;
    }
  }

  // Draw once from the state the bridge already holds, so a page that arrives
  // at a fragment inside the movement is correct before the first frame.
  render(bridge.read());
}

mountSceneControls();
