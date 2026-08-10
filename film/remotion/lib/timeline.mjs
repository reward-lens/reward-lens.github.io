// The shot list, the caption track, and the arithmetic that turns them into
// frames. One module, two consumers: the Remotion compositions import it and
// burn the captions, and scripts/render.mjs imports it and writes the .vtt.
// A caption that drifts between the burned track and the sidecar is the exact
// defect FILM.md §6 item 4 asks to be checked for, so there is one source.
//
// It takes its data rather than importing it, because webpack and Node disagree
// about how to import JSON and the disagreement is not worth carrying.

export const FPS = 30;

// -----------------------------------------------------------------------------
// WHERE THIS DEPARTS FROM design/film/FILM.md §2, AND WHY. Three departures,
// all reported rather than absorbed.
//
// 1. FILM.md's twelve shots total 91 seconds. DECISIONS.md D-23 then adds two
//    Manim inserts of 8 and 10 seconds. 91 + 18 is 109, and the brief's envelope
//    is sixty to ninety. Something had to give.
//
//    FILM.md §2 nominates shots 3 and 10 as the first cuts. Shot 10 is the one
//    that keeps 8 and 9 from reading as a triumph, and the film is required to
//    end on a refusal rather than on a detection, so cutting it inverts the
//    film's own argument. What is genuinely redundant is SHOT 4, "the estimator
//    turns scores into training weight": insert A sits at 4a and shows exactly
//    that, in a construction rather than in a gesture. Shot 4 is the cut, and
//    every remaining shot is trimmed by one or two seconds.
//
// 2. Shot 3's on-screen text in FILM.md reads "24,000 rollouts".
//    data/run-series.json meta.rolloutCount is 25,664. The caption reads the
//    file.
//
// 3. Shot 7 in FILM.md is two traces, --written and --realized, separating,
//    held on the gap. THAT GAP DOES NOT EXIST IN THIS RUN. run-series.json's
//    `written` is the `passed` column and `realized` is `training_passed`; over
//    401 steps their mean absolute difference is 0.0007 and their maximum is
//    0.0312, at step 2. Drawing them as two things pulling apart would be a
//    claim the data refuses. What this run does show, and shows dramatically,
//    is the labelled transition itself: the rate goes from near zero to near one
//    around a fitted midpoint of 106.0. Shot 7 draws that, from the real array,
//    and the written-versus-realized thesis is carried by insert B, which is a
//    conceptual construction and claims no measurement. That division is what
//    D-23 set the two renderers up to do.
// -----------------------------------------------------------------------------

const seconds = (s) => Math.round(s * FPS);

/**
 * @param {object} data  the parsed src/data/run-series.json
 * @param {object} manim the frame manifest written by scripts/render.mjs
 * @param {object} film  copy.yaml's `film` subtree
 */
export function buildTimeline(data, manim, film) {
  const copy = (path) => {
    let node = film;
    for (const part of path.split(".")) {
      if (typeof node !== "object" || node === null || !(part in node)) {
        throw new Error(`copy.yaml:film.${path} does not exist`);
      }
      node = node[part];
    }
    if (typeof node !== "string") throw new Error(`copy.yaml:film.${path} is not a string`);
    return node;
  };
  const rollouts = data.meta.rolloutCount;
  const byKey = Object.fromEntries(data.detectors.map((d) => [d.key, d]));
  const shipped = byKey.variance_derivative;
  const comparator = byKey.gradient_norm_peak;
  const earliest = byKey.variance_level;
  const cusum = byKey.gradient_norm_cusum;

  const percent = (x) => `${(x * 100).toFixed(1)}%`;

  const shots = [
    {
      id: "typed",
      kind: "typed",
      frames: seconds(4),
      captions: [{ at: 0.9, text: "you write this" }],
    },
    {
      id: "beam",
      kind: "beam",
      frames: seconds(5),
      captions: [{ at: 1.0, text: "it scores what the policy produces" }],
    },
    {
      id: "rollouts",
      kind: "rollouts",
      frames: seconds(6),
      value: rollouts,
      captions: [
        { at: 1.2, text: `${rollouts.toLocaleString("en-US")} rollouts, one number each` },
      ],
    },
    {
      id: "insert-a",
      kind: "insert",
      insert: "insertA",
      frames: manim.insertA.frames,
      captions: [
        { at: 0.1, text: copy("insert_a.one_episode") },
        { at: 1.6, text: copy("insert_a.one_reward") },
        // ESCALATED, AND BOUND ANYWAY. copy.yaml:film.insert_a.every_token
        // reads "every TOKEN gets the same number". It burns over a counter
        // that reads "3,058 · MEAN COMPLETION CHARACTERS · STEP 1", because the
        // public rollout table records characters and publishes no token field,
        // and run-series.json's own perEpisode.note says deriving one "would be
        // a number with no measurement behind it". The frame therefore names a
        // unit the data does not carry.
        //
        // It is bound rather than overridden because copy is the build lead's
        // under §7.7 and this is a one-word edit that needs no code change.
        // scripts/render.mjs prints a notice on every render until it is ruled
        // on, so it cannot be shipped by being forgotten.
        { at: 3.1, text: copy("insert_a.every_token") },
        { at: 7.4, text: copy("insert_a.signal_learned") },
      ],
    },
    {
      id: "policy",
      kind: "policy",
      frames: seconds(6),
      captions: [{ at: 0.9, text: "the policy moves" }],
    },
    {
      id: "behaviour",
      kind: "behaviour",
      frames: seconds(7),
      captions: [{ at: 1.4, text: "something grows that nobody asked for" }],
    },
    {
      id: "insert-b",
      kind: "insert",
      insert: "insertB",
      frames: manim.insertB.frames,
      captions: [
        { at: 0.2, text: copy("insert_b.written") },
        { at: 4.6, text: copy("insert_b.realized") },
        { at: 7.1, text: copy("insert_b.measurable") },
        { at: 8.5, text: copy("insert_b.invertible") },
      ],
    },
    {
      id: "transition",
      kind: "transition",
      frames: seconds(9),
      captions: [
        { at: 0.8, text: "the run has a labelled transition" },
        {
          at: 4.6,
          text: `the rate crosses its fitted midpoint at step ${data.transition.midpoint}`,
        },
      ],
    },
    {
      id: "alarm",
      kind: "alarm",
      frames: seconds(6),
      value: shipped.alarmStep,
      captions: [
        { at: 1.0, text: `an instrument marks where it became visible, step ${shipped.alarmStep}` },
      ],
    },
    {
      id: "comparator",
      kind: "comparator",
      frames: seconds(5),
      value: comparator.alarmStep,
      captions: [
        { at: 0.8, text: `the standard comparator arrives at step ${comparator.alarmStep}` },
      ],
    },
    {
      id: "surrogates",
      kind: "surrogates",
      frames: seconds(7),
      // "two earlier signals" would overclaim. The variance level alarms at step
      // 70, earlier than the shipped signal; the cumulative-sum detector's
      // alarmStep is null in the file, so nothing records that it was earlier at
      // all. What IS recorded for both is that they were discarded and why.
      captions: [
        { at: 0.8, text: `two other signals were discarded` },
        {
          at: 3.4,
          text: `they fire on ${percent(earliest.surrogateRate)} and ${percent(
            cusum.surrogateRate,
          )} of order-destroyed surrogates`,
        },
      ],
    },
    {
      id: "reading",
      kind: "reading",
      frames: seconds(8),
      captions: [
        { at: 0.9, text: "one reading is evidence" },
        { at: 4.2, text: "another is a refusal" },
      ],
    },
    {
      id: "remedy",
      kind: "remedy",
      frames: seconds(5),
      captions: [{ at: 0.8, text: "and the refusal names what is missing" }],
    },
  ];

  // Placing the shots returns new objects rather than writing `from` onto the
  // literals above. TypeScript infers this module's shape from those literals,
  // so a field that only ever appears by mutation is a field the compositions
  // cannot see: `shot.from` was a type error in Root.tsx that nothing ran, because
  // Remotion transpiles without checking.
  let cursor = 0;
  const placed = shots.map((shot) => {
    const from = cursor;
    cursor += shot.frames;
    return { ...shot, from };
  });
  return { shots: placed, frames: cursor, fps: FPS };
}

/** Every caption in the film, flattened to absolute frames. */
export function captionTrack(timeline) {
  const cues = [];
  for (const shot of timeline.shots) {
    shot.captions.forEach((caption, i) => {
      const from = shot.from + Math.round(caption.at * FPS);
      const nextInShot = shot.captions[i + 1];
      const until = nextInShot
        ? shot.from + Math.round(nextInShot.at * FPS)
        : shot.from + shot.frames;
      cues.push({ from, until, text: caption.text, shot: shot.id });
    });
  }
  return cues;
}

const stamp = (frames) => {
  const total = frames / FPS;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s
    .toFixed(3)
    .padStart(6, "0")}`;
};

/** WebVTT, from the same cue list the burned track renders. */
export function toVtt(timeline) {
  const lines = ["WEBVTT", ""];
  captionTrack(timeline).forEach((cue, i) => {
    lines.push(String(i + 1));
    lines.push(`${stamp(cue.from)} --> ${stamp(cue.until)}`);
    lines.push(cue.text);
    lines.push("");
  });
  return lines.join("\n");
}
