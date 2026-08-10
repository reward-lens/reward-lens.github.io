/**
 * The run boundary: a timeline rail across the front of the bench, with the
 * public training run drawn along it.
 *
 * This is not a station in the beam. The other four are things that happen to
 * one quantity in order; this is the axis they happen along, so it is a second
 * rail in front of the optical one, running most of the bench's length, with
 * graduations of its own and three traces lying on it.
 *
 * ------------------------------------------------------------------------
 * WHAT IS DRAWN, AND THE TWO DISCLOSURES THAT TRAVEL WITH IT
 * ------------------------------------------------------------------------
 *
 * `src/data/run-series.json` is complete: 25,664 labelled rollouts, 64 a step,
 * and every series array is length **401**. `meta.stepCount` is **400**. Two
 * rows of the same frozen ledger describe this run with different step counts
 * and the site does not assert which record is right. So this rail draws 401
 * points and nothing here says four hundred; a figure that drew 401 and
 * captioned 400 is the quiet contradiction `EVIDENCE-VERDICTS.md` §2 exists to
 * prevent.
 *
 * The step alignment is read off the `step` column of the publisher's own file
 * and the generator asserts every step has an equal rollout count. It was NOT
 * reconstructed from file ordering, and the reconstruction disclaimer that
 * appears in the commission must not be written here.
 *
 * ------------------------------------------------------------------------
 * THE MARKERS, AND THE ONE THAT IS THE POINT
 * ------------------------------------------------------------------------
 *
 * Four detectors are on file and all four are drawn, in the study's own
 * evaluation order and never sorted by lead:
 *
 *   `variance_level`          alarm step  70, surrogate rate 0.607, rejected
 *   `gradient_norm_cusum`     alarm step  null, surrogate rate 0.693, rejected
 *   variance-derivative       alarm step  90, surrogate rate 0.243, promoted
 *   gradient-norm comparator  alarm step 133, surrogate rate null
 *
 * The earliest alarm is at step 70 and it is a REJECTED signal at a 60.7%
 * surrogate rate. The one the site promotes alarms twenty steps later. Drawing
 * only the promoted marker would make the instrument look better than it is, so
 * all four are drawn and the rejected ones are drawn as refusals: blue, in
 * `--state-refusal`, never red, because a refusal on this site is a decision
 * and not a failure. The detector whose alarm step is null has no marker on the
 * rail at all, which is the only honest position for a signal that never fired,
 * and its absence is a gap a reader can see.
 *
 * The transition band is `transition.midpoint` 106 with `transition.width1090`
 * 23.9, drawn as an extent rather than as a line, because it is a width.
 */
import { useEffect, useMemo } from "react";
import { Vector3 } from "three";
import type { ScenePalette } from "../core/palette";
import type { SceneTier } from "../runtime/tier";
import { BENCH } from "../core/layout";
import { useSurface, BEVEL, BEVEL_SEGMENTS } from "../materials";
import { bevelledBox, traceTube, type AssemblyBounds } from "../geometry/profiles";
import { useLight, type LightRole } from "./light";
import { Instanced, type Placement } from "./Instanced";
import { TIMELINE } from "./stations";
import { column, drawIndices, extent, normalise, readPayload } from "./payload";

interface Props {
  palette: ScenePalette;
  tier: SceneTier;
  emphasis: number;
  castShadow: boolean;
}

/** The rail's own graduations. Twenty, at the same pitch as the optical rail's. */
const TIMELINE_TICKS = 20;

/** How tall a series may draw above the timeline rail. */
const TRACE_HEIGHT = 0.34;

/**
 * Where a series sits when its value is zero, and why it is not on the rail.
 *
 * THE FIRST VERSION PUT IT AT 0.06 AND BURIED THE MOST IMPORTANT ZERO IN THE
 * RECORD. The timeline rail's top face is at `TIMELINE.y + 0.066` and is 0.12
 * deep, the trace tube's radius is 0.011, and the traces run down the rail's
 * own centre line in z. A trace at value zero was therefore drawn inside the
 * rail in all three axes and did not appear at all.
 *
 * `series.realized` is zero for the opening stretch of this run: not one of
 * the 64 rollouts a step reached the realized objective until the transition.
 * That flat zero, and its length, is the finding the run boundary state exists
 * to show, and it was invisible while the two series that were not zero were
 * drawn plainly above it. A reader saw two traces where the record has three
 * and would have had no way to know which one was missing.
 *
 * 0.092 clears the rail's top face by 0.026 and the transition band that lies
 * on it by 0.019, so a zero reads as a trace at its floor rather than as an
 * absent trace.
 */
const TRACE_BASE = 0.092;

const TIMELINE_LENGTH = TIMELINE.toX - TIMELINE.fromX;

export const RUN_BOUNDS: AssemblyBounds = {
  name: "RunAssembly",
  origin: [(TIMELINE.fromX + TIMELINE.toX) / 2, TIMELINE.y, TIMELINE.z],
  extent: [TIMELINE_LENGTH, 0.5, 0.3],
  attachments: {
    start: [TIMELINE.fromX, TIMELINE.y, TIMELINE.z],
    end: [TIMELINE.toX, TIMELINE.y, TIMELINE.z],
  },
};

export function RunAssembly({ palette, tier, emphasis, castShadow }: Props) {
  const payload = readPayload("run-boundary-series");

  const anodized = useSurface({ surface: "anodized", tier });
  const railTop = useSurface({ surface: "railTop", tier });
  const marking = useSurface({ surface: "paintedMarking", tier });

  const written = useLight("traceWritten", palette, undefined, emphasis);
  const realized = useLight("traceRealized", palette, undefined, emphasis);
  const formatOk = useLight("traceFormat", palette, undefined, emphasis);
  const transition = useLight("bounded", palette, undefined, emphasis * 0.5);

  /**
   * The three series, as curves in the timeline rail's own space.
   *
   * All three share one y domain, which is [0, 1], because all three are rates
   * and normalising each against its own range would make a series that never
   * left 0.97 look like one that swung from nothing to everything. `formatOk`
   * runs 0.5625 to 1 and the other two run the full range; drawn against a
   * common axis, that difference is the readable thing.
   */
  const traces = useMemo(() => {
    const steps = column(payload, "steps");
    const indices = drawIndices(payload, "series", tier, steps.length);
    const xDomain = extent(steps);

    const build = (name: string) => {
      const values = column(payload, name);
      const points: Vector3[] = [];
      for (let i = 0; i < indices.length; i += 1) {
        const j = indices[i];
        points.push(
          new Vector3(
            TIMELINE.fromX + normalise(steps[j], xDomain) * TIMELINE_LENGTH,
            TIMELINE.y + TRACE_BASE + values[j] * TRACE_HEIGHT,
            TIMELINE.z,
          ),
        );
      }
      return traceTube(points, 0.011, tier === "low" ? 4 : 6);
    };

    return {
      written: build("series.written"),
      realized: build("series.realized"),
      formatOk: build("series.formatOk"),
      xDomain,
      pointCount: indices.length,
      recordLength: steps.length,
    };
  }, [payload, tier]);

  /**
   * The three trace buffers are freed when the tier changes and on unmount.
   *
   * `traceTube` is uncached for the same reason `bandRibbon` is: its shape is a
   * function of 401 recorded values, so there is no argument list to key it on.
   * Three tubes at 401 points each is the largest single allocation this
   * packet makes, and a tier change rebuilds all three.
   */
  useEffect(
    () => () => {
      traces.written.dispose();
      traces.realized.dispose();
      traces.formatOk.dispose();
    },
    [traces],
  );

  /** Step number to a position on the rail. The one transform this file makes. */
  const xAtStep = useMemo(() => {
    const [lo, hi] = traces.xDomain;
    return (step: number) => TIMELINE.fromX + ((step - lo) / (hi - lo)) * TIMELINE_LENGTH;
  }, [traces]);

  /**
   * The four detectors, in the study's evaluation order.
   *
   * A detector whose alarm step is not finite is skipped: `detectors.alarmStep`
   * is `[70, NaN, 90, 133]` and the NaN is `gradient_norm_cusum`, which never
   * alarmed. A marker at step zero, or at the left end, or at the mean, would
   * all be a position for a thing that has none.
   */
  const detectors = useMemo(() => {
    const alarmStep = column(payload, "detectors.alarmStep");
    const shipped = column(payload, "detectors.shipped");
    const promoted: Placement[] = [];
    const refused: Placement[] = [];
    for (let i = 0; i < alarmStep.length; i += 1) {
      if (!Number.isFinite(alarmStep[i])) continue;
      const placement: Placement = {
        position: [xAtStep(alarmStep[i]), TIMELINE.y + 0.24, TIMELINE.z + 0.05],
      };
      (shipped[i] === 1 ? promoted : refused).push(placement);
    }
    return { promoted, refused, total: alarmStep.length };
  }, [payload, xAtStep]);

  /** The transition, as an extent. `width1090` is a width, so it is drawn as one. */
  const band = useMemo(() => {
    const midpoint = column(payload, "transition.midpoint")[0];
    const width = column(payload, "transition.width1090")[0];
    const left = xAtStep(midpoint - width / 2);
    const right = xAtStep(midpoint + width / 2);
    return { centre: (left + right) / 2, width: Math.max(0.01, right - left) };
  }, [payload, xAtStep]);

  const ticks = useMemo<Placement[]>(() => {
    const gap = TIMELINE_LENGTH / (TIMELINE_TICKS + 1);
    return Array.from({ length: TIMELINE_TICKS }, (_, i) => ({
      position: [TIMELINE.fromX + gap * (i + 1), TIMELINE.y + 0.036, TIMELINE.z - 0.03] as const,
    }));
  }, []);

  return (
    <group name="RunAssembly">
      {/* The timeline rail. The same section as the optical rail at a third the
          depth, so it reads as the same hardware rather than as a graphic. */}
      <mesh
        name="TimelineRail"
        geometry={bevelledBox(TIMELINE_LENGTH, 0.11, 0.18, BEVEL.rail)}
        material={anodized}
        position={[(TIMELINE.fromX + TIMELINE.toX) / 2, TIMELINE.y, TIMELINE.z]}
        castShadow={castShadow}
        receiveShadow
      />
      <mesh
        name="TimelineRailTop"
        geometry={bevelledBox(TIMELINE_LENGTH, 0.022, 0.12, BEVEL.rail)}
        material={railTop}
        position={[(TIMELINE.fromX + TIMELINE.toX) / 2, TIMELINE.y + 0.055, TIMELINE.z]}
        receiveShadow
      />
      <Instanced
        name="TimelineTicks"
        geometry={bevelledBox(0.01, 0.006, 0.06, BEVEL.marking, BEVEL_SEGMENTS.secondary)}
        material={marking}
        placements={ticks}
      />

      {/* The transition, drawn as the extent it is. */}
      <mesh
        name="TransitionBand"
        geometry={bevelledBox(band.width, 0.006, 0.14, BEVEL.marking, BEVEL_SEGMENTS.secondary)}
        material={transition}
        position={[band.centre, TIMELINE.y + 0.07, TIMELINE.z]}
      />

      {/* The three recorded series. Not emissive: they are data, and making
          them glow would put them in the beam's register. */}
      <mesh name="TraceWritten" geometry={traces.written} material={written} />
      <mesh name="TraceRealized" geometry={traces.realized} material={realized} />
      <mesh name="TraceFormatOk" geometry={traces.formatOk} material={formatOk} />

      {/* The detectors. The promoted one and the rejected ones are different
          draws, and the one that never alarmed has no marker. */}
      <DetectorMarkers
        name="DetectorPromoted"
        role="control"
        palette={palette}
        emphasis={emphasis}
        placements={detectors.promoted}
      />
      <DetectorMarkers
        name="DetectorRefused"
        role="refusal"
        palette={palette}
        emphasis={emphasis}
        placements={detectors.refused}
      />
    </group>
  );
}

/**
 * One class of detector marker.
 *
 * Split into its own component so the two classes are two draws with two
 * materials, rather than one batch with a per-instance colour. That matters
 * here beyond tidiness: a per-instance colour would let a promoted and a
 * rejected marker be the same object with a different tint, and these are
 * different results.
 */
function DetectorMarkers({
  name,
  role,
  palette,
  emphasis,
  placements,
}: {
  name: string;
  role: LightRole;
  palette: ScenePalette;
  emphasis: number;
  placements: readonly Placement[];
}) {
  const material = useLight(role, palette, undefined, emphasis);
  return (
    <Instanced
      name={name}
      geometry={bevelledBox(0.014, 0.14, 0.04, BEVEL.marking, BEVEL_SEGMENTS.secondary)}
      material={material}
      placements={placements}
    />
  );
}

/** Kept honest by a test: the timeline never draws outside the room. */
export const TIMELINE_EXTENT = {
  fromX: TIMELINE.fromX,
  toX: TIMELINE.toX,
  z: TIMELINE.z,
  railY: BENCH.railY,
} as const;
