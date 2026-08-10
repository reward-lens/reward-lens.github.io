/**
 * Where the five downstream stations stand on the rail.
 *
 * Every number here is derived from `core/layout.ts` and nothing here is a
 * fresh position. `BENCH.prismX` and `BENCH.detectorX` are two of the three
 * landmarks gate 20 compares the hand-authored room, the still and the live
 * scene on within 8 pixels, so they are read rather than chosen; the stations
 * between them are fractions of the span those two landmarks define, which
 * means a change to `HERO_X` moves the whole bench together instead of leaving
 * five stations behind.
 *
 * WHY THE STATIONS ARE IN THE BEAM AND NOT BESIDE IT. The five states of this
 * instrument are five things that happen to one quantity, in order, and the
 * honest way to draw that is one optical path with five elements in it. The
 * alternative, five separate tableaux that cross-fade, is the construction the
 * brief forbids and it would also be a lie about the subject: the advantage
 * that reaches the update is the advantage the selection produced, and putting
 * them in different pictures says otherwise.
 *
 * So the score band leaves the dispersing element and travels the length of the
 * bench, through the grouping slit, through the advantage modulator, through
 * the integrating lens, past the before-and-after planes, and lands on the
 * detector. Every station is always physically there. What changes between
 * states is which one is lit.
 */
import { BENCH } from "../core/layout";

/** Fraction of the way from the dispersing element to the detector. */
function station(fraction: number): number {
  return BENCH.prismX + fraction * (BENCH.detectorX - BENCH.prismX);
}

export const STATIONS = {
  /**
   * The entrance aperture, upstream of the dispersing element. It is the one
   * station on the source side of the prism, because a dispersing element with
   * nothing defining the beam that enters it is a prism sitting in a room.
   */
  inputPlate: BENCH.prismX - 0.62,
  /** LANDMARK. `LANDMARKS.dispersingElement`. Not chosen here. */
  dispersing: BENCH.prismX,
  /** Where the eight rollouts are separated into their two groups. */
  groupingSlit: station(0.2),
  /** Where each rollout's path is displaced by its recorded advantage. */
  modulator: station(0.33),
  /** Where the eight displaced paths are summed into one update. */
  integrating: station(0.52),
  /** The before-and-after planes, and the two channels between them. */
  policyPlanes: station(0.74),
  /** LANDMARK. `LANDMARKS.detectorPlane`. Not chosen here. */
  detector: BENCH.detectorX,
} as const;

export type StationName = keyof typeof STATIONS;

/**
 * The run timeline's own rail, in front of the optical one.
 *
 * The run boundary is not a station: it is the axis the other four are measured
 * along, so it is drawn as a second rail across the front of the bench rather
 * than as one more thing in the beam. `z` puts it clear of the optical rail's
 * front face and low enough that it never crosses the beam.
 */
export const TIMELINE = {
  z: BENCH.railDepth / 2 + 0.42,
  y: BENCH.railY + 0.02,
  /** Left and right ends, inset from the optical rail so the two read apart. */
  fromX: BENCH.sourceX + 1.1,
  toX: BENCH.detectorX - 0.15,
} as const;

/**
 * How lit a station is in a given state.
 *
 * The hardware does not change: an anodized mount is the same mount whatever
 * the reader is looking at, and dimming it would be a lighting effect standing
 * in for an argument. What changes is the light IN the station, which is the
 * only thing that carries a claim. `idle` is not zero for the same reason the
 * stations are all present: a channel that vanishes cannot be followed back.
 */
export const EMPHASIS = {
  active: 1,
  idle: 0.12,
} as const;

/** The active state's emphasis for one station, in [0, 1]. */
export function emphasisFor(active: boolean): number {
  return active ? EMPHASIS.active : EMPHASIS.idle;
}
