import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

import {
  copy,
  detector,
  graderCards,
  interventionSubject,
  mutationSubject,
  readable,
  run,
} from "./lib/data";

// All three figure films are laid out at the width their figure frame displays
// them at, so a 12px label is a 12px label in a figure, and rendered at 1.5x for
// a dense screen. One shape for all three: they sit in the same component on
// three pages and a reader meets them as a set.
export const FIGURE_WIDTH = 800;
export const FIGURE_HEIGHT = 450;

export const RUN_FIGURE_FRAMES = 300; // 10s at 30fps

const FPS = 30;
const ease = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const permutation = (n: number, seed: number) => {
  const next = rng(seed);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
};

/**
 * The figure film on /see/run/ §5, and the highest-value piece of motion in the
 * build. It shows one thing: a detector alarming confidently on data whose
 * order has been destroyed.
 *
 * The subject is the variance level, which is the detector with the LONGEST
 * lead (+1.504 widths) and the one a reader would pick if lead time were the
 * only criterion. It fires on 60.7% of order-destroyed in-control surrogates
 * drawn from this same series, which is why it did not ship. Both numbers are
 * read from run-series.json; nothing here is typed in.
 *
 * The scramble is a real permutation of the real array, seeded so the render is
 * deterministic. It is the procedure the surrogate rate was measured with, not
 * a picture of it.
 */
export const RUN_FIGURE_WIDTH = FIGURE_WIDTH;
export const RUN_FIGURE_HEIGHT = FIGURE_HEIGHT;

export const RunFigureFilm: React.FC = () => {
  const frame = useCurrentFrame();
  const width = RUN_FIGURE_WIDTH;
  const height = RUN_FIGURE_HEIGHT;
  const pad = { l: 52, r: 26, t: 44, b: 62 };

  const subject = detector("variance_level");
  const values = run.series.written;
  const steps = run.steps;
  const first = steps[0];
  const last = steps[steps.length - 1];

  const x = (step: number) => pad.l + ((step - first) / (last - first)) * (width - pad.l - pad.r);
  const y = (value: number) =>
    height - pad.b - value * (height - pad.b - pad.t);

  // Beat 1: the real series. Beat 2: the order is destroyed. Beat 3: the same
  // detector runs on it and alarms. Beat 4: the rate, held.
  const draw = ease(interpolate(frame, [4, FPS * 2.0], [0, 1], { extrapolateRight: "clamp" }));
  const scramble = ease(
    interpolate(frame, [FPS * 2.4, FPS * 4.2], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const refire = ease(
    interpolate(frame, [FPS * 4.8, FPS * 6.0], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const readout = ease(
    interpolate(frame, [FPS * 6.4, FPS * 7.4], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  // A loop that snaps is a loop a reader notices. This one returns to its own
  // first frame over the last half second.
  const loop = interpolate(frame, [RUN_FIGURE_FRAMES - 15, RUN_FIGURE_FRAMES - 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const order = permutation(values.length, 2026);
  const line = (series: number[], upto: number) => {
    const shown = Math.max(2, Math.round(series.length * upto));
    return series
      .slice(0, shown)
      .map((v, i) => `${i === 0 ? "M" : "L"}${x(steps[i]).toFixed(2)},${y(v).toFixed(2)}`)
      .join(" ");
  };

  // Displace, do not replace. The real series stays drawn, dimmed, under the
  // scrambled one. The site's intervention panel follows the same rule and so
  // does insert B, and a viewer who has seen it twice reads it the third time
  // without being told.
  const scrambledValues = order.map((i) => values[i]);
  const realOpacity = 1 - 0.5 * scramble;

  // The false alarm lands where the surrogate's own excursion is, which is not
  // where the real series alarms. It is drawn in --alarm rather than in a
  // hedged colour, because the entire lesson is that a false alarm looks
  // exactly as confident as a true one.
  const falseStep = steps[Math.round(values.length * 0.31)];

  return (
    <AbsoluteFill className="film">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="stage">
        <line
          x1={pad.l}
          y1={height - pad.b}
          x2={width - pad.r}
          y2={height - pad.b}
          style={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
        />
        <path
          d={line(values, draw)}
          style={{ fill: "none", stroke: "var(--realized)", strokeWidth: 2.4, opacity: realOpacity * loop }}
        />
        {scramble > 0 ? (
          <path
            d={line(scrambledValues, scramble)}
            style={{ fill: "none", stroke: "var(--control)", strokeWidth: 0.8, opacity: 0.5 * loop }}
          />
        ) : null}

        <g style={{ opacity: (1 - scramble) * loop }}>
          <line
            x1={x(subject.alarmStep as number)}
            y1={height - pad.b}
            x2={x(subject.alarmStep as number)}
            y2={pad.t}
            style={{ stroke: "var(--alarm)", strokeWidth: 1.2 }}
          />
          <text
            className="type-mono-sm"
            x={x(subject.alarmStep as number) + 6}
            y={pad.t - 10}
            style={{ fill: "var(--alarm)" }}
          >
            {copy("labels.step")} {subject.alarmStep}
          </text>
        </g>

        <g style={{ opacity: refire * loop }}>
          <line
            x1={x(falseStep)}
            y1={height - pad.b}
            x2={x(falseStep)}
            y2={pad.t}
            style={{ stroke: "var(--alarm)", strokeWidth: 1.2 }}
          />
          <text
            className="type-mono-sm"
            x={x(falseStep) + 6}
            y={pad.t - 10}
            style={{ fill: "var(--alarm)" }}
          >
            {copy("labels.alarm_again")}
          </text>
        </g>

        <text className="type-mono-sm" x={pad.l} y={22} style={{ fill: "var(--ink-2)" }}>
          {scramble > 0.5 ? copy("figure_run.scrambled") : copy("figure_run.real")}
        </text>

        <text className="type-mono-sm" x={pad.l} y={height - 30} style={{ fill: "var(--ink-3)" }}>
          {subject.label}
        </text>
        {/* The 60.7% is NOT drawn in frame. copy.yaml:film.figure_run carries
            three strings and no fourth, and "fires on 60.7% of order-destroyed
            surrogates" was a sentence this packet composed. The rate belongs in
            the figure's own caption on the page, which is where
            components/figure-frame.md puts the scope and where it can carry its
            provenance chip. The film shows the behaviour; the caption states the
            number. */}
        <g style={{ opacity: readout * loop }}>
          <text className="type-mono-sm" x={pad.l} y={height - 12} style={{ fill: "var(--ink)" }}>
            {copy("figure_run.fires_anyway")}
          </text>
        </g>
      </svg>
    </AbsoluteFill>
  );
};

// -----------------------------------------------------------------------------
// THE OTHER TWO FIGURE FILMS, WHICH HAD NO DATA UNTIL P1's SECOND ROUND.
//
// Both were specified in brief §5.5 and both were stated as blocked rather than
// half-built, because a figure whose numbers are invented is worse than a figure
// that does not exist. src/data/intervention.json and src/data/grader-cards.json
// have since landed and every value below is read out of them at render time.
//
// NEITHER FILM DRAWS A DIGIT IT COMPOSED, and neither draws a rate. That is the
// same rule the run figure follows for its 60.7%, and for the same reason: a
// number in frame cannot carry a provenance chip, and the figure frame's own
// caption can. The film shows the behaviour; the caption states the number.
// Everything in frame is either a position, a mark, or a string read from the
// generated file: a component id, a dimension key, a card's display name.
//
// THE STRINGS THESE TWO WOULD LIKE AND DO NOT HAVE. copy.yaml:film carries
// labels, insert_a, insert_b and figure_run, written before either of these
// existed, so there is no key for "attribution" or "patching" and none for what
// a mutant mark means. Rather than compose four words, each figure is built so
// its construction and its frame's title carry the reading, and render.mjs
// prints a standing notice naming exactly which keys are wanted. HANDOFF.md §8
// rule 1 is not suspended for a label.
// -----------------------------------------------------------------------------

export const REWARD_FIGURE_FRAMES = 240; // 8s at 30fps

/**
 * The figure film on /see/reward-model/ §3, per brief §5.5: two ranked lists,
 * attribution and patching, with the same component connected across them, and
 * the lines cross.
 *
 * WHAT MAKES IT WORTH EIGHT SECONDS RATHER THAN A STATIC CHART, in the brief's
 * own words: a negative rank correlation genuinely looks like a tangle, and the
 * tangle FORMING is more legible than the tangle formed. So the two columns
 * arrive in order, one after the other, and the connectors draw last.
 *
 * THE TWO TRACED COMPONENTS ARE THE FINDING AND THEY ARE NOT CHOSEN BY EYE.
 * They are the dimension's own `topAttributionComponent` and `topPatchComponent`
 * fields. On this model those are `mlp_L31`, which attribution ranks first on
 * ALL twelve dimensions, and `mlp_L0`, which patching ranks first on all twelve.
 * Their two connectors run corner to corner in opposite directions.
 *
 * NOTHING IS CLAMPED, and nothing here could be: rank is a position on an axis
 * of exactly 64 slots, so the component attribution puts first and patching puts
 * last is drawn at the bottom of the right column rather than compressed toward
 * the middle. The movement figures the panel renders reach 771% of the margin on
 * one dimension and build_intervention.py's docstring is explicit that an axis
 * clipped at 100% would hide the most surprising values in the set. This film
 * draws no movement axis at all, so it inherits the rule by not having the axis.
 */
export const RewardModelFigureFilm: React.FC = () => {
  const frame = useCurrentFrame();
  const width = FIGURE_WIDTH;
  const height = FIGURE_HEIGHT;

  const subject = interventionSubject();
  const components = subject.components;
  const n = components.length;

  const colL = 268;
  const colR = 532;
  const tick = 34;
  const top = 64;
  const bottom = height - 42;
  const rankY = (rank: number) => top + ((rank - 1) / (n - 1)) * (bottom - top);

  const columns = ease(interpolate(frame, [4, FPS * 1.7], [0, 1], { extrapolateRight: "clamp" }));
  const patched = ease(
    interpolate(frame, [FPS * 2.0, FPS * 3.5], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const tangle = ease(
    interpolate(frame, [FPS * 3.7, FPS * 6.1], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const traced = ease(
    interpolate(frame, [FPS * 6.2, FPS * 7.1], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const loop = interpolate(frame, [REWARD_FIGURE_FRAMES - 15, REWARD_FIGURE_FRAMES - 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // A per-item entrance, so a column arrives in rank order rather than all at
  // once. The stagger is a fraction of the whole reveal, which keeps the beat
  // the same length however many components the file carries.
  const staggered = (progress: number, index: number) =>
    Math.max(0, Math.min(1, progress * (n + 12) - index));

  const isTraced = (id: string) =>
    id === subject.topAttributionComponent || id === subject.topPatchComponent;

  return (
    <AbsoluteFill className="film">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="stage">
        <text className="type-mono-sm" x={40} y={26} style={{ fill: "var(--ink-3)", opacity: loop }}>
          {readable(subject.key)}
        </text>

        {/* The two rank axes. Rank 1 at the top of each, so "higher" means what
            it looks like it means and a reader never has to invert an axis. The
            spine is what separates "a column of ranks" from "the ends of some
            lines", and without it the figure reads as a single tangle rather
            than as two orderings that disagree. */}
        <line
          x1={colL}
          y1={top - 12}
          x2={colL}
          y2={bottom + 12}
          style={{ stroke: "var(--line)", strokeWidth: 1, opacity: columns * loop }}
        />
        <line
          x1={colR}
          y1={top - 12}
          x2={colR}
          y2={bottom + 12}
          style={{ stroke: "var(--line)", strokeWidth: 1, opacity: patched * loop }}
        />
        {components.map((component) => {
          const lit = staggered(columns, component.attributionRank - 1);
          return (
            <line
              key={`a${component.id}`}
              x1={colL - tick}
              y1={rankY(component.attributionRank)}
              x2={colL}
              y2={rankY(component.attributionRank)}
              style={{
                stroke: isTraced(component.id) ? "var(--ink)" : "var(--ink-3)",
                strokeWidth: isTraced(component.id) ? 2.2 : 1.4,
                opacity: lit * loop,
              }}
            />
          );
        })}
        {components.map((component) => {
          const lit = staggered(patched, component.patchRank - 1);
          return (
            <line
              key={`p${component.id}`}
              x1={colR}
              y1={rankY(component.patchRank)}
              x2={colR + tick}
              y2={rankY(component.patchRank)}
              style={{
                stroke: isTraced(component.id) ? "var(--ink)" : "var(--ink-3)",
                strokeWidth: isTraced(component.id) ? 2.2 : 1.4,
                opacity: lit * loop,
              }}
            />
          );
        })}

        {/* The tangle. Emphasis is by value and weight, never by hue: the two
            traced connectors are the same colour as everything else and simply
            at full strength, because colour on this site is only ever data and
            "the one I want you to look at" is not data. */}
        {components.map((component, index) => {
          const grow = staggered(tangle, index);
          if (grow <= 0) return null;
          const y1 = rankY(component.attributionRank);
          const y2 = rankY(component.patchRank);
          const x2 = colL + (colR - colL) * grow;
          const highlighted = isTraced(component.id);
          return (
            <line
              key={`c${component.id}`}
              x1={colL}
              y1={y1}
              x2={x2}
              y2={y1 + (y2 - y1) * grow}
              style={{
                stroke: "var(--ink)",
                strokeWidth: highlighted ? 1.6 + 1.1 * traced : 0.7,
                // The tangle dims when the two traced components are picked out,
                // and it does NOT dim away. Under reduced motion the poster is the
                // whole figure, so a resting tangle at 0.16 left a reader with the
                // two lines that swap and none of the sixty-two that also disagree,
                // which is most of the finding.
                opacity: (highlighted ? 0.34 + 0.66 * traced : 0.3 - 0.06 * traced) * loop,
              }}
            />
          );
        })}

        {/* Both labels sit on the attribution column, so a reader picks a name
            up on the left and follows one line to find where patching put it.
            Labelling both ends would say the same thing twice and cover the
            crossing, which is the one thing in frame worth seeing. */}
        {[subject.topAttributionComponent, subject.topPatchComponent].map((id) => {
          const component = components.find((c) => c.id === id);
          if (!component) return null;
          return (
            <text
              key={`l${id}`}
              className="type-mono-sm"
              x={colL - tick - 10}
              y={rankY(component.attributionRank) + 4}
              textAnchor="end"
              style={{ fill: "var(--ink)", opacity: Math.min(columns, 1) * loop }}
            >
              {id}
            </text>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

export const GRADER_FIGURE_FRAMES = 240; // 8s at 30fps

/**
 * The figure film on /see/grader/ §4, per brief §5.5: sixty mutations applied to
 * the equivalence checker, and its benchmark's gold answer pairs failing to
 * notice any of them.
 *
 * THE CONSTRUCTION. The gold corpus is drawn once as a band and then never moves
 * again. Sixty mutants land on the row above it, one at a time, and every one of
 * them stays lit, because a mutant is killed when the pairs disagree with the
 * original and none of them did. The band holding perfectly still for eight
 * seconds is the whole argument, and it is an argument that only motion can make:
 * a static chart of sixty identical marks is sixty identical marks.
 *
 * THE COMPARISON IS IN THE SAME FRAME AND IT IS NOT OPTIONAL. see-grader.md §4b
 * requires that a reader cannot see the zero without seeing what makes it
 * meaningful, so the other three subjects run the same instrument beneath, and
 * their killed mutants go dark. Two of sixty, twenty-four of sixty, twenty-six
 * of sixty. Without them a score of zero reads as a broken harness.
 *
 * NEITHER THE SUBJECT NOR THE ORDER IS TYPED IN. The subject is whichever card
 * has the fewest killed mutants, and the comparison rows are the rest in file
 * order.
 *
 * WHAT THIS FIGURE DOES NOT DRAW, and it is deliberate: the log-only access
 * state. That is section 4a's material and it belongs to `grader-card`, not to
 * the mutation figure that brief §5.5 and see-grader.md §4b both put in this
 * slot. Stated because the specification's version of it is wrong in a way that
 * would survive being drawn: `components/grader-card.md` and `see-grader.md` §3
 * both say log-only drops EVERY card to zero readings, and the bundle says
 * 0, 0, 1, 1. GROUND-TRUTH.md C-46 has it right and copy.yaml is already fixed.
 * Nothing in film/** asserts either version.
 */
export const GraderFigureFilm: React.FC = () => {
  const frame = useCurrentFrame();
  const width = FIGURE_WIDTH;
  const height = FIGURE_HEIGHT;

  const subject = mutationSubject();
  const others = graderCards.filter((card) => card.key !== subject.key);
  const mutants = subject.competentMutants;

  const markW = 7;
  const rowX0 = 40;
  const rowX1 = width - 40;
  const markX = (index: number, count: number, x0: number, x1: number) =>
    x0 + (index / (count - 1)) * (x1 - x0 - markW);

  const band = ease(interpolate(frame, [4, FPS * 0.9], [0, 1], { extrapolateRight: "clamp" }));
  const applied = interpolate(frame, [FPS * 1.0, FPS * 4.0], [0, mutants], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const comparison = ease(
    interpolate(frame, [FPS * 4.4, FPS * 6.4], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const loop = interpolate(frame, [GRADER_FIGURE_FRAMES - 15, GRADER_FIGURE_FRAMES - 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // The gold corpus, as one mark per pair. Its width is read off the corpus
  // string's own count rather than assumed, so a re-run against a different
  // corpus draws a different band.
  const pairs = Number(subject.subject.corpus.match(/(\d+)\s+rollouts/)?.[1] ?? 0);
  if (!pairs) throw new Error(`no rollout count in corpus string "${subject.subject.corpus}"`);

  const rowY = 118;
  const bandY = 168;

  return (
    <AbsoluteFill className="film">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="stage">
        <text className="type-mono-sm" x={rowX0} y={26} style={{ fill: "var(--ink-2)", opacity: loop }}>
          {subject.displayName}
        </text>

        {/* Sixty mutants, landing one at a time. Every one of them stays. */}
        {Array.from({ length: mutants }, (_, i) => {
          const lit = Math.max(0, Math.min(1, applied - i));
          if (lit <= 0) return null;
          return (
            <rect
              key={`m${i}`}
              x={markX(i, mutants, rowX0, rowX1)}
              y={rowY - 9 - 5 * (1 - lit)}
              width={markW}
              height={18 + 10 * (1 - lit)}
              style={{ fill: "var(--ink)", opacity: lit * loop }}
            />
          );
        })}

        {/* The corpus, drawn once and then held. It does not move again, and
            that is the finding rather than a rendering economy. */}
        <g style={{ opacity: band * loop }}>
          {Array.from({ length: pairs }, (_, i) => (
            <rect
              key={`g${i}`}
              x={rowX0 + (i / (pairs - 1)) * (rowX1 - rowX0 - 1.6)}
              y={bandY}
              width={1.6}
              height={26}
              style={{ fill: "var(--ink-3)" }}
            />
          ))}
          <text className="type-mono-sm" x={rowX0} y={bandY + 48} style={{ fill: "var(--ink-3)" }}>
            {subject.subject.corpus}
          </text>
        </g>

        {/* The same instrument on the other three, so the zero above has a
            scale. A killed mutant drops to the line colour rather than
            disappearing: the mutant was still generated, and a gap that is empty
            reads as one that was never filled. */}
        {others.map((card, row) => {
          const y = 268 + row * 56;
          const reveal = Math.max(0, Math.min(1, comparison * 3.4 - row));
          return (
            <g key={card.key} style={{ opacity: reveal * loop }}>
              {Array.from({ length: card.competentMutants }, (_, i) => (
                <rect
                  key={`${card.key}${i}`}
                  x={markX(i, card.competentMutants, rowX0, rowX1 - 250)}
                  y={y}
                  width={markW}
                  height={14}
                  style={{
                    fill: i < card.killedMutants ? "var(--line-strong)" : "var(--ink)",
                    opacity: i < card.killedMutants ? 1 : 0.62,
                  }}
                />
              ))}
              <text
                className="type-mono-sm"
                x={rowX1}
                y={y + 12}
                textAnchor="end"
                style={{ fill: "var(--ink-3)" }}
              >
                {card.displayName}
              </text>
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
