import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";

import { copy, detector, readable, reason, run } from "./lib/data";
import { Stage, useStage } from "./lib/stage";

const FPS = 30;
const ease = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

/** Deterministic, so the film renders identically on every machine. */
const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const shuffled = <T,>(input: T[], seed: number): T[] => {
  const next = rng(seed);
  const out = input.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// -----------------------------------------------------------------------------
// The plot the last four shots share. Shots 7 to 10 are one continuous figure:
// the trace is drawn once and then marked, so a viewer never has to re-read the
// axes. Vertical at 9:16, horizontal otherwise, per FILM.md §3.
// -----------------------------------------------------------------------------

type Plot = {
  /** Position along the step axis, in the coordinate that axis runs in. */
  along: (step: number) => number;
  /** Position across the value axis. */
  across: (value: number) => number;
  point: (step: number, value: number) => { x: number; y: number };
  path: (values: number[], upto?: number) => string;
  axisFrom: { x: number; y: number };
  axisTo: { x: number; y: number };
  /** The rule a marker draws at one step, from the zero end toward the far end. */
  marker: (step: number) => { x1: number; y1: number; x2: number; y2: number };
};

const usePlot = (stage: Stage): Plot => {
  const inset = stage.kind === "wide" ? 96 : 64;
  const steps = run.steps;
  const first = steps[0];
  const last = steps[steps.length - 1];
  const vertical = stage.vertical;

  // The step axis runs down the frame at 9:16 and across it otherwise, so the
  // trace is read the way the format is read. Everything else is one mapping.
  const a0 = vertical ? stage.top + inset : stage.left + inset;
  const a1 = vertical ? stage.bottom - inset : stage.right - inset;
  const v0 = vertical ? stage.left + 52 : stage.bottom - 54;
  // At 16:9 the marker labels sit ABOVE the plot, outside it, which is why 54px
  // of margin is enough. At 9:16 they sit at the far end of the value axis, and
  // 52px was not a lane, it was the trace: after the transition the series is at
  // value 1, which is exactly where a right-anchored label lands, so "step 133"
  // was drawn through the trace it was labelling. The value axis is the SHORT
  // axis at 9:16 and the step axis carries the drama, so paying value range for
  // a clear label lane is the cheap side of that trade.
  //
  // 110 and not more. The longest label is 8 mono-sm characters at 58px, inset
  // 26px from the frame's own padding, so 84px is the requirement and the rest
  // is slack. The lane has to exist in shot 7 as well, where nothing uses it:
  // shots 7 to 10 are ONE figure that is drawn once and then marked, and a plot
  // that changed width when the first marker arrived would make a reader re-read
  // the axes, which is the whole thing the shared figure exists to avoid.
  const v1 = vertical ? stage.right - 110 : stage.top + 54;

  const along = (step: number) => a0 + ((step - first) / (last - first)) * (a1 - a0);
  const across = (value: number) => v0 + value * (v1 - v0);
  const point = (step: number, value: number) =>
    vertical ? { x: across(value), y: along(step) } : { x: along(step), y: across(value) };

  return {
    along,
    across,
    point,
    path: (values, upto = 1) => {
      const n = Math.max(2, Math.round(values.length * upto));
      return values
        .slice(0, n)
        .map((v, i) => {
          const p = point(steps[i], v);
          return `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
        })
        .join(" ");
    },
    axisFrom: vertical ? { x: v0, y: a0 } : { x: a0, y: v0 },
    axisTo: vertical ? { x: v0, y: a1 } : { x: a1, y: v0 },
    marker: (step) => {
      const at = along(step);
      const near = across(0);
      const far = across(1);
      return vertical
        ? { x1: near - 14, y1: at, x2: far + 8, y2: at }
        : { x1: at, y1: near + 14, x2: at, y2: far - 8 };
    },
  };
};

const Svg: React.FC<{ stage: Stage; children: React.ReactNode }> = ({ stage, children }) => (
  <svg
    className="stage"
    viewBox={`0 0 ${stage.width} ${stage.height}`}
    width={stage.width}
    height={stage.height}
  >
    {children}
  </svg>
);

const Mono: React.FC<{
  x: number;
  y: number;
  role?: string;
  colour?: string;
  anchor?: "start" | "middle" | "end";
  opacity?: number;
  children: React.ReactNode;
}> = ({ x, y, role = "type-mono-sm", colour = "var(--ink-3)", anchor = "middle", opacity = 1, children }) => (
  <text
    className={role}
    x={x}
    y={y}
    textAnchor={anchor}
    style={{ fill: colour, opacity }}
    dominantBaseline="middle"
  >
    {children}
  </text>
);

// -----------------------------------------------------------------------------
// Shot 1. A reward function is typed. Mono, --beam, on --ground.
//
// The function is the one this run's series actually records. run-series.json's
// seriesNote states that `passed` is "both the labelled outcome the transition
// is fitted to and the predicate as the benchmark writes it", and the per-step
// means are exact multiples of 1/64 over 64 rollouts, which is what a binary
// predicate averaged over a group looks like. So this is a restatement of the
// file, not an invention placed on top of it.
// -----------------------------------------------------------------------------

// THE JUSTIFICATION, so the next reader does not have to re-derive it.
// This is a restatement of the file, not an invention placed on top of it.
// run-series.json's seriesNote says `passed` is "both the labelled outcome the
// transition is fitted to and the predicate as the benchmark writes it", and
// every per-step value in `written` is an exact multiple of 1/64 over the 64
// rollouts recorded at that step, which is what a binary predicate averaged
// over a group looks like. A 0-or-1 pass predicate is therefore what the file
// describes. It is not a quotation of anyone's source, and it carries no number.
const CODE = ["def reward(rollout):", "    return 1.0 if rollout.passed else 0.0"];

export const Typed: React.FC = () => {
  const stage = useStage();
  const frame = useCurrentFrame();
  const total = CODE.join("\n").length;
  const typed = Math.round(interpolate(frame, [8, 8 + FPS * 1.8], [0, total], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));
  // One blink, then it stops. A cursor that keeps blinking is a screensaver.
  const blink = frame > 8 + FPS * 1.8 && frame < 8 + FPS * 2.6 ? (Math.floor(frame / 9) % 2 === 0 ? 1 : 0) : frame <= 8 + FPS * 1.8 ? 1 : 0;

  let remaining = typed;
  const lines = CODE.map((line) => {
    const take = Math.max(0, Math.min(line.length, remaining));
    remaining -= line.length + 1;
    return line.slice(0, take);
  });

  return (
    <div
      className="stage"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        paddingLeft: stage.left,
        paddingRight: stage.left,
        paddingBottom: stage.height - stage.bottom,
      }}
    >
      <div>
        {lines.map((line, i) => (
          <div
            key={i}
            className="type-mono-lg"
            style={{ color: "var(--beam)", whiteSpace: "pre", paddingBottom: "var(--space-3)" }}
          >
            {line}
            {i === lines.length - 1 ? (
              <span style={{ opacity: blink }}>_</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// Shot 2. The function's output becomes a single beam entering frame.
// -----------------------------------------------------------------------------

export const Beam: React.FC = () => {
  const stage = useStage();
  const frame = useCurrentFrame();
  const t = ease(interpolate(frame, [4, FPS * 2.6], [0, 1], { extrapolateRight: "clamp" }));
  const from = stage.vertical ? { x: stage.cx, y: stage.top } : { x: stage.left - 20, y: stage.cy };
  const to = { x: stage.cx, y: stage.cy };
  const head = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  const landed = ease(interpolate(frame, [FPS * 2.6, FPS * 3.6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));

  return (
    <Svg stage={stage}>
      <line
        x1={from.x}
        y1={from.y}
        x2={head.x}
        y2={head.y}
        style={{ stroke: "var(--beam)", strokeWidth: 2 }}
      />
      <rect
        x={to.x - 26}
        y={to.y - 26}
        width={52}
        height={52}
        rx={3}
        style={{ fill: "var(--surface-2)", stroke: "var(--line-strong)", strokeWidth: 1 }}
      />
      <rect
        x={to.x - 26}
        y={to.y + 26 - 52 * landed}
        width={52}
        height={52 * landed}
        rx={3}
        style={{ fill: "var(--beam)", opacity: 0.9 }}
      />
    </Svg>
  );
};

// -----------------------------------------------------------------------------
// Shot 3. The beam meets rollouts: rays fan out, each scored, forming a density.
// The count is meta.rolloutCount. FILM.md §2 says 24,000; the file says 25,664.
// -----------------------------------------------------------------------------

const RAYS = 128;

export const Rollouts: React.FC = () => {
  const stage = useStage();
  const frame = useCurrentFrame();
  const t = ease(interpolate(frame, [6, FPS * 2.8], [0, 1], { extrapolateRight: "clamp" }));
  const next = rng(11);
  const spread = (stage.bottom - stage.top) * 0.36;
  const origin = stage.vertical
    ? { x: stage.cx, y: stage.top + 40 }
    : { x: stage.left + 40, y: stage.cy };
  const reach = stage.vertical ? stage.bottom - 70 : stage.right - 70;

  const rays = Array.from({ length: RAYS }, (_, i) => {
    const u = next();
    const v = next();
    const offset = (u + v - 1) * spread;
    return { offset, delay: i / RAYS };
  });

  return (
    <Svg stage={stage}>
      {rays.map((ray, i) => {
        const local = ease((t - ray.delay * 0.35) / 0.65);
        if (local <= 0) return null;
        const end = stage.vertical
          ? { x: origin.x + ray.offset, y: origin.y + (reach - origin.y) * local }
          : { x: origin.x + (reach - origin.x) * local, y: origin.y + ray.offset };
        return (
          <line
            key={i}
            x1={origin.x}
            y1={origin.y}
            x2={end.x}
            y2={end.y}
            style={{ stroke: "var(--ink-3)", strokeWidth: 1, opacity: 0.55 }}
          />
        );
      })}
      {rays.map((ray, i) => {
        const local = ease((t - ray.delay * 0.35) / 0.65);
        if (local < 0.98) return null;
        const end = stage.vertical
          ? { x: origin.x + ray.offset, y: reach }
          : { x: reach, y: origin.y + ray.offset };
        return (
          <rect
            key={`d${i}`}
            x={end.x - 2}
            y={end.y - 2}
            width={4}
            height={4}
            style={{ fill: "var(--beam)", opacity: 0.85 }}
          />
        );
      })}
    </Svg>
  );
};

// -----------------------------------------------------------------------------
// Shot 5. The policy moves: a distribution shifts across a step axis.
// -----------------------------------------------------------------------------

export const Policy: React.FC = () => {
  const stage = useStage();
  const frame = useCurrentFrame();
  const t = ease(interpolate(frame, [8, FPS * 4.4], [0, 1], { extrapolateRight: "clamp" }));
  const x0 = stage.left + 60;
  const x1 = stage.right - 60;
  const base = stage.bottom - 60;
  const height = (stage.bottom - stage.top) * 0.52;

  const bump = (shift: number, opacity: number) => {
    const pts: string[] = [];
    for (let i = 0; i <= 120; i += 1) {
      const u = i / 120;
      const x = x0 + u * (x1 - x0);
      const centre = 0.22 + shift * 0.5;
      const v = Math.exp(-Math.pow((u - centre) / 0.12, 2));
      pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)},${(base - v * height).toFixed(2)}`);
    }
    return (
      <path
        d={pts.join(" ")}
        style={{ fill: "none", stroke: "var(--ink-2)", strokeWidth: 2, opacity }}
      />
    );
  };

  return (
    <Svg stage={stage}>
      <line x1={x0} y1={base} x2={x1} y2={base} style={{ stroke: "var(--line-strong)", strokeWidth: 1 }} />
      {bump(0, 0.22)}
      {bump(t, 1)}
      <Mono x={(x0 + x1) / 2} y={base + 26}>
        {copy("labels.training_step")}
      </Mono>
    </Svg>
  );
};

// -----------------------------------------------------------------------------
// Shot 6. A behaviour grows. One band widens against the others, un-labelled.
// Every band is neutral: naming it here would give away what shot 7 shows.
// -----------------------------------------------------------------------------

export const Behaviour: React.FC = () => {
  const stage = useStage();
  const frame = useCurrentFrame();
  const t = ease(interpolate(frame, [10, FPS * 5], [0, 1], { extrapolateRight: "clamp" }));
  const bands = 6;
  const grown = 3;
  const span = stage.bottom - stage.top - 40;
  const slot = span / bands;
  const x0 = stage.left + 40;
  const x1 = stage.right - 40;

  return (
    <Svg stage={stage}>
      {Array.from({ length: bands }, (_, i) => {
        const isGrowing = i === grown;
        const h = slot * (isGrowing ? 0.18 + 0.62 * t : 0.18);
        const y = stage.top + 20 + slot * i + (slot - h) / 2;
        return (
          <rect
            key={i}
            x={x0}
            y={y}
            width={x1 - x0}
            height={h}
            style={{ fill: "var(--ink-3)", opacity: isGrowing ? 0.42 + 0.5 * t : 0.42 }}
          />
        );
      })}
    </Svg>
  );
};

// -----------------------------------------------------------------------------
// Shots 7 to 10. One figure, marked four times.
// -----------------------------------------------------------------------------

const TraceFigure: React.FC<{
  reveal: number;
  markers: { step: number; colour: string; label: string; strength: number }[];
  surrogates: number;
  midpoint: number;
}> = ({ reveal, markers, surrogates, midpoint }) => {
  const stage = useStage();
  const plot = usePlot(stage);
  const values = run.series.written;

  return (
    <Svg stage={stage}>
      <line
        x1={plot.axisFrom.x}
        y1={plot.axisFrom.y}
        x2={plot.axisTo.x}
        y2={plot.axisTo.y}
        style={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
      />
      {/* Four, thin and dim. Seven at full weight buried the real trace under a
          wall of grey, which turned the shot from "these also fire" into "this
          figure is broken". */}
      {Array.from({ length: surrogates }, (_, i) => (
        <path
          key={`s${i}`}
          d={plot.path(shuffled(values, 101 + i * 7))}
          style={{ fill: "none", stroke: "var(--control)", strokeWidth: 0.7, opacity: 0.16 }}
        />
      ))}
      <path
        d={plot.path(values, reveal)}
        style={{ fill: "none", stroke: "var(--realized)", strokeWidth: 2.5 }}
      />
      {/* The fitted midpoint labels itself BELOW the axis and every alarm labels
          itself above it. Steps 90, 106 and 133 are within 11% of each other on
          a 401-step axis, so three labels on one line is three labels on top of
          each other, which is what the first render did. */}
      {midpoint > 0 ? (
        <g style={{ opacity: midpoint }}>
          <line
            {...plot.marker(run.transition.midpoint)}
            style={{ stroke: "var(--written)", strokeWidth: 1, strokeDasharray: "3 4" }}
          />
          <Mono
            x={stage.vertical ? stage.left + 30 : plot.along(run.transition.midpoint)}
            y={stage.vertical ? plot.along(run.transition.midpoint) + 16 : plot.across(0) + 30}
            colour="var(--written)"
            anchor={stage.vertical ? "start" : "middle"}
          >
            {copy("labels.step")} {run.transition.midpoint}
          </Mono>
        </g>
      ) : null}
      {markers.map((marker, i) => {
        if (marker.strength <= 0) return null;
        const line = plot.marker(marker.step);
        // The marker drops from the axis toward the far edge, so it reads as
        // something arriving at a step rather than as a gridline.
        const drop = interpolate(marker.strength, [0, 1], [0.4, 1]);
        // The tier exists because at 16:9 all three labels share one y and steps
        // 70, 90 and 133 are within 16% of each other on a 401-step axis, so
        // without it they are three labels in one place.
        //
        // AT 9:16 IT DOES THE OPPOSITE AND IT SHIPPED THAT WAY. There each label
        // already sits at its own marker's position on the step axis, 33px apart,
        // and subtracting a growing tier pulls the later ones back UP toward the
        // earlier ones: it closed the gap between "step 70" and "step 90" from 33px
        // to 13px and drove the second label straight through the first one's rule.
        // Visible only in the tall contact sheet, and invisible in the arithmetic,
        // because the same expression is correct in the format it was written for.
        const tier = stage.vertical ? 0 : i * 20;
        return (
          <g key={marker.label} style={{ opacity: marker.strength }}>
            <line
              x1={line.x1}
              y1={line.y1}
              x2={line.x1 + (line.x2 - line.x1) * drop}
              y2={line.y1 + (line.y2 - line.y1) * drop}
              style={{ stroke: marker.colour, strokeWidth: 1.5 }}
            />
            <Mono
              x={stage.vertical ? stage.right - 26 : line.x2}
              y={stage.vertical ? line.y1 - 14 - tier : plot.across(1) - 22 - tier}
              colour={marker.colour}
              anchor={stage.vertical ? "end" : "middle"}
            >
              {marker.label}
            </Mono>
          </g>
        );
      })}
    </Svg>
  );
};

export const Transition: React.FC = () => {
  const frame = useCurrentFrame();
  const reveal = ease(interpolate(frame, [6, FPS * 5.2], [0, 1], { extrapolateRight: "clamp" }));
  const midpoint = ease(interpolate(frame, [FPS * 5.2, FPS * 6.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  return <TraceFigure reveal={reveal} markers={[]} surrogates={0} midpoint={midpoint} />;
};

export const Alarm: React.FC = () => {
  const frame = useCurrentFrame();
  const shipped = detector("variance_derivative");
  const strength = ease(interpolate(frame, [6, FPS * 1.6], [0, 1], { extrapolateRight: "clamp" }));
  return (
    <TraceFigure
      reveal={1}
      surrogates={0}
      midpoint={1}
      markers={[
        {
          step: shipped.alarmStep as number,
          colour: "var(--alarm)",
          label: `${copy("labels.step")} ${shipped.alarmStep}`,
          strength,
        },
      ]}
    />
  );
};

export const Comparator: React.FC = () => {
  const frame = useCurrentFrame();
  const shipped = detector("variance_derivative");
  const registered = detector("gradient_norm_peak");
  const strength = ease(interpolate(frame, [4, FPS * 1.4], [0, 1], { extrapolateRight: "clamp" }));
  return (
    <TraceFigure
      reveal={1}
      surrogates={0}
      midpoint={1}
      markers={[
        { step: shipped.alarmStep as number, colour: "var(--alarm)", label: `${copy("labels.step")} ${shipped.alarmStep}`, strength: 1 },
        {
          step: registered.alarmStep as number,
          colour: "var(--comparator)",
          label: `${copy("labels.step")} ${registered.alarmStep}`,
          strength,
        },
      ]}
    />
  );
};

// FILM.md §2 shot 10 asks for "two other markers ... earlier still". Only one of
// the two discarded early detectors has an alarm step in the file: the variance
// level alarms at 70, and the cumulative-sum detector's alarmStep is null. So
// one marker is drawn at its step and the other is not drawn at all, and the
// caption carries both surrogate rates, which are the numbers that matter.
export const Surrogates: React.FC = () => {
  const frame = useCurrentFrame();
  const shipped = detector("variance_derivative");
  const registered = detector("gradient_norm_peak");
  const earliest = detector("variance_level");
  const early = ease(interpolate(frame, [4, FPS], [0, 1], { extrapolateRight: "clamp" }));
  const surrogates = Math.round(interpolate(frame, [FPS * 1.6, FPS * 3.6], [0, 3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const dim = interpolate(frame, [FPS * 1.6, FPS * 3.2], [1, 0.35], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <TraceFigure
      reveal={1}
      surrogates={surrogates}
      midpoint={0}
      markers={[
        { step: earliest.alarmStep as number, colour: "var(--control)", label: `${copy("labels.step")} ${earliest.alarmStep}`, strength: early },
        { step: shipped.alarmStep as number, colour: "var(--alarm)", label: `${copy("labels.step")} ${shipped.alarmStep}`, strength: dim },
        { step: registered.alarmStep as number, colour: "var(--comparator)", label: `${copy("labels.step")} ${registered.alarmStep}`, strength: dim },
      ]}
    />
  );
};

// -----------------------------------------------------------------------------
// Shots 11 and 12. One reading is evidence, another is a refusal, and the
// refusal names what is missing. The reason and its remedy come from
// refusals.json, generated from the library's own enum.
// -----------------------------------------------------------------------------

const INCOMPLETE = "RECORD_INCOMPLETE";

export const Reading: React.FC = () => {
  const stage = useStage();
  const frame = useCurrentFrame();
  const r = reason(INCOMPLETE);
  const a = ease(interpolate(frame, [6, FPS * 2.2], [0, 1], { extrapolateRight: "clamp" }));
  const b = ease(interpolate(frame, [FPS * 3.4, FPS * 5.2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const rowA = stage.cy - 44;
  const rowB = stage.cy + 44;
  const x0 = stage.left + 30;
  const x1 = stage.right - 30;
  const chip = 62;
  const stopAt = x0 + (x1 - x0) * 0.5;

  return (
    <Svg stage={stage}>
      <line
        x1={x0}
        y1={rowA}
        x2={x0 + (x1 - chip - x0) * a}
        y2={rowA}
        style={{ stroke: "var(--beam)", strokeWidth: 2 }}
      />
      <g style={{ opacity: a >= 1 ? 1 : 0 }}>
        <rect
          x={x1 - chip}
          y={rowA - 15}
          width={chip}
          height={30}
          rx={2}
          style={{ fill: "var(--surface-2)", stroke: "var(--line-strong)", strokeWidth: 1 }}
        />
        <Mono x={x1 - chip / 2} y={rowA} colour="var(--state-evidence)">
          {copy("labels.value")}
        </Mono>
      </g>

      <line
        x1={x0}
        y1={rowB}
        x2={x0 + (stopAt - x0) * b}
        y2={rowB}
        style={{ stroke: "var(--state-refusal)", strokeWidth: 2 }}
      />
      <g style={{ opacity: b >= 1 ? 1 : 0 }}>
        <line
          x1={stopAt}
          y1={rowB - 17}
          x2={stopAt}
          y2={rowB + 17}
          style={{ stroke: "var(--state-refusal)", strokeWidth: 2 }}
        />
        <Mono x={stopAt + 14} y={rowB} colour="var(--state-refusal)" anchor="start">
          {readable(r.name)}
        </Mono>
      </g>
    </Svg>
  );
};

export const Remedy: React.FC = () => {
  const stage = useStage();
  const frame = useCurrentFrame();
  const r = reason(INCOMPLETE);
  const t = ease(interpolate(frame, [6, FPS * 1.8], [0, 1], { extrapolateRight: "clamp" }));
  const x0 = stage.left + 30;
  const stopAt = x0 + (stage.right - 30 - x0) * 0.5;
  const rowB = stage.cy - 22;

  // The remedy resolves directly beneath the reason and aligned to it, on the
  // same left edge, because a refusal and its remedy are one object. A refusal
  // card on the site sets them the same way and opens the remedy at full
  // density, per components/refusal-card.md.
  return (
    <Svg stage={stage}>
      <line x1={x0} y1={rowB} x2={stopAt} y2={rowB} style={{ stroke: "var(--state-refusal)", strokeWidth: 2 }} />
      <line x1={stopAt} y1={rowB - 17} x2={stopAt} y2={rowB + 17} style={{ stroke: "var(--state-refusal)", strokeWidth: 2 }} />
      <Mono x={stopAt + 14} y={rowB} colour="var(--state-refusal)" anchor="start">
        {readable(r.name)}
      </Mono>
      <g style={{ opacity: t }}>
        <line
          x1={stopAt + 14}
          y1={rowB + 20}
          x2={stopAt + 14 + 26 * t}
          y2={rowB + 20}
          style={{ stroke: "var(--state-refusal)", strokeWidth: 1 }}
        />
        <Mono x={stopAt + 14} y={rowB + 42} colour="var(--ink)" anchor="start">
          {r.remedy?.remedy}
        </Mono>
      </g>
    </Svg>
  );
};

// -----------------------------------------------------------------------------
// The Manim inserts, composited as image sequences. Nothing is re-coloured and
// nothing is re-typed: the PNGs are 1920x1080 and the composition is 960x540 at
// scale 2, so they land at exactly 1:1.
// -----------------------------------------------------------------------------

export const Insert: React.FC<{
  formats: Record<string, { frames: number; path: string; prefix: string }>;
}> = ({ formats }) => {
  const stage = useStage();
  const frame = useCurrentFrame();
  // Each aspect ratio has its own render of the insert, at that ratio's own
  // output resolution and with its own layout, so it fills the frame edge to
  // edge with no resampling: 1920 into 960 at scale 2, and 1080 into 540 at
  // scale 2. That is what makes a 22px label in the insert the same 11 CSS
  // pixels as --type-mono-label everywhere Remotion draws it, in all three.
  //
  // The earlier version placed one 16:9 raster in every frame. It was 0.883 in
  // wide and 0.5625 in square and tall, so a viewer saw two sizes of the same
  // type role in one frame. That is the cropped-from-the-wide-one outcome
  // FILM.md §3 exists to prevent, and it was visible at full size.
  const chosen = formats[stage.kind];
  if (!chosen) throw new Error(`no insert render for the ${stage.kind} format`);
  const index = Math.max(0, Math.min(chosen.frames - 1, frame));
  const src = staticFile(
    `inserts/${chosen.path}/${chosen.prefix}${String(index).padStart(4, "0")}.png`,
  );
  return (
    <div className="stage">
      <Img
        src={src}
        style={{ position: "absolute", inset: 0, width: stage.width, height: stage.height }}
      />
    </div>
  );
};

export const SHOT_COMPONENTS: Record<string, React.FC> = {
  typed: Typed,
  beam: Beam,
  rollouts: Rollouts,
  policy: Policy,
  behaviour: Behaviour,
  transition: Transition,
  alarm: Alarm,
  comparator: Comparator,
  surrogates: Surrogates,
  reading: Reading,
  remedy: Remedy,
};
