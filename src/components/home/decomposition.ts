/**
 * The hero's dispersion, read from generated data.
 *
 * DECISIONS.md D-37 binds the first viewport to the Hodge decomposition of one
 * grader's comparison flow: three orthogonal parts that sum to exactly 1.0.
 * GROUND-TRUTH.md C-7 rules that the band count is the data's and a hand-set
 * count in the SVG is a build failure, so nothing here counts, pads or drops.
 *
 * THREE THINGS THIS FILE REFUSES TO DO.
 *
 * 1. It never floors, clamps or drops a band. The harmonic part measures
 *    2.4e-31 and renders at its real width, which is zero. A component
 *    measured and found absent is a finding. Dropping it, or nudging it up to
 *    a visible hairline so the figure looks balanced, would be the figure
 *    lying about its own data in the most expensive position on the site.
 *    copy.yaml:home.decomposition.zero_band_note exists for exactly this band.
 *
 * 2. It never writes a label. Band identity arrives from the data; the public
 *    string for it arrives from copy.yaml:home.decomposition.*. A label this
 *    file cannot resolve is a build failure naming the key, not a fallback.
 *
 * 3. It never invents a magnitude. If src/data/decomposition.json is absent,
 *    the room still renders (the bench is geometry, not data) and the fan is
 *    empty. An empty fan says nothing; a fan with made-up widths would say
 *    something false.
 */
import { copy } from "../../copy";
import { HERO_Y } from "./hero-geometry";

export interface RawBand {
  index: number;
  componentToken: string;
  /**
   * The decomposition's own name for this part: `gradient`, `curl`, `harmonic`.
   * It is an identifier, not a string to show a reader, and it is what keys
   * copy.yaml:home.decomposition.*.
   *
   * THIS FIELD IS `part` AND IT HAS ALWAYS BEEN `part`.
   * This file previously declared it as `label` and read `band.label`, which is
   * undefined against every version of the generated file, so `partKey()` threw
   * on `undefined.trim()` and the homepage did not build. It went unnoticed
   * because `src/data/decomposition.json` did not exist when this component was
   * written: `rawDecomposition()` returned null, the fan rendered empty, and
   * nothing reached this line. `scripts/build_data.py:479` emits `part`.
   */
  part: string;
  magnitude: number;
  share: number;
  /**
   * Degrees from the fan's CENTRE, signed, derived from share by the generator.
   * `build_data.py:483` writes `(centre - 0.5) * fanDegrees`, so the bands tile
   * the whole symmetric fan from `-fanDegrees/2` to `+fanDegrees/2` in order.
   */
  exitAngle: number;
  angularWidth: number;
  /** The generator's own statement that a band is below its arithmetic's floor. */
  belowFloat64Epsilon: boolean;
}

/**
 * Declared against the file `scripts/build_data.py` actually writes, checked
 * key by key against `src/data/decomposition.json`. The three keys this file
 * used to declare and the generator has never emitted (`label` on a band,
 * `quantity`, `excluded`) are gone rather than made optional: an optional field
 * that is never present is a second name for a field that does not exist.
 */
export interface RawDecomposition {
  note: string;
  excludesNote: string;
  subject: string;
  quantityStoreLabel: string;
  unit: string;
  fanDegrees: number;
  angleRule: string;
  bands: RawBand[];
  evidenceId: string;
  observable: string;
  trust?: string | null;
  trustRung?: number | null;
  provenance: {
    generatedBy: string;
    sourceCommit: string | null;
    createdAt: string | null;
  };
}

interface DecompositionCopy {
  zero_band_note: string;
  caption: string;
  scope: string;
  [partKey: string]: string;
}

const decompositionCopy = (copy.home as Record<string, unknown>)
  .decomposition as DecompositionCopy;

/* -------------------------------------------------------------------------
   Loading. Same mechanism as src/components/base/data.ts: a Vite glob, so a
   file that does not exist is simply absent from the map rather than a path
   that resolves one way in dev and another in build.
   ------------------------------------------------------------------------- */

const dataModules = import.meta.glob<{ default: unknown }>(
  "../../data/*.json",
  { eager: true },
);

export const rawDecomposition = (): RawDecomposition | null => {
  const mod = dataModules["../../data/decomposition.json"];
  return mod ? (mod.default as RawDecomposition) : null;
};

/* -------------------------------------------------------------------------
   Labels.
   ------------------------------------------------------------------------- */

/** `Gradient flow` and `gradient` both key on `gradient`. */
const partKey = (label: string): string =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const RESERVED = new Set(["zero_band_note", "caption", "scope"]);

const labelFor = (band: RawBand): string => {
  if (typeof band.part !== "string" || band.part.length === 0) {
    throw new Error(
      `hero decomposition: band ${band.index} of src/data/decomposition.json ` +
        `carries no \`part\`, so there is nothing to key copy.yaml on. ` +
        `scripts/build_data.py:479 emits it; the generated file and this ` +
        `component have come apart and that is for the build lead.`,
    );
  }
  const key = partKey(band.part);
  const found = RESERVED.has(key) ? undefined : decompositionCopy[key];
  if (typeof found === "string" && found.length > 0) return found.trim();
  throw new Error(
    `hero decomposition: band ${band.index} is part "${band.part}" and ` +
      `copy.yaml:home.decomposition.${key} does not exist. ` +
      `HANDOFF.md §8 rule 1: a string that is not in copy.yaml is an escalation, ` +
      `not a writing task. Either the generator's part name changed or the key ` +
      `is missing; both are for the build lead.`,
  );
};

/* -------------------------------------------------------------------------
   Geometry. One direction only.

   Symmetric fanning is physically wrong for a dispersing element and reads as
   a generic starburst, so every band opens upward from the axis. Angles are
   the data's; the only rendering choice is how far up the widest one reaches,
   and that is HERO_Y.fanExtent.

   The mapping is tan-proportional rather than angle-proportional, so a band's
   extent on the detector plane is where a ray at that angle actually lands
   rather than where a small-angle approximation would put it.

   HOW THE SYMMETRIC FAN IS FOLDED TO ONE SIDE, AND WHY NOT WITH abs().
   The generator tiles the bands end to end across a fan centred on the axis:
   `exitAngle` is signed and runs from -fanDegrees/2 to +fanDegrees/2
   (build_data.py:483). Turning that into a one-sided fan is a SHIFT of half the
   fan, which slides the whole tiling up and preserves it.

   This file previously took `Math.abs(exitAngle)`, which REFLECTS the tiling
   about the axis instead, and reflection is not order-preserving. Measured on
   the shipped data, every one of the three bands then ended at exactly the same
   12 degrees: gradient drew [-6.86, 12] with a third of its width BELOW an axis
   the composition reserves for the rail and the version row, curl drew
   [6.86, 12] nested INSIDE gradient rather than beside it, and the part
   measured at zero landed on the outer edge of both. Band width stopped being
   share, which is the one thing this figure encodes, and the legend bars beside
   it went on encoding share correctly, so the picture disagreed with its own
   key. The fold also halved the fan: the widest ray reached tan(12) rather than
   tan(24) of the scale, so the drawn spread was 61px against the 128px of
   HERO_Y.fanExtent that the text safe zones are tuned against.
   ------------------------------------------------------------------------- */

const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);

export interface Band {
  index: number;
  token: string;
  label: string;
  share: number;
  magnitude: number;
  /** Detector-plane offsets from the axis, in CSS px. Negative is up. */
  nearY: number;
  farY: number;
  /** The band's own drawn extent. Zero when the component measured zero. */
  extent: number;
  labelY: number;
  isZero: boolean;
}

export interface Decomposition {
  raw: RawDecomposition;
  bands: Band[];
  /** The widest reach of the fan, in CSS px above the axis. */
  fanTop: number;
  /** Rendered by the figure whenever any band drew at zero width. */
  zeroNote: string | null;
  caption: string;
  scope: string | null;
  /** Placeholders in the copy that no file in this repository can fill. */
  unresolved: string[];
}

/**
 * A band is drawn at zero width when its extent rounds away at device scale.
 * This is a statement about the *rendering*, not a threshold applied to the
 * data: the polygon is emitted at its true extent either way, and this only
 * decides whether the zero-band note appears beside it.
 */
const SUB_PIXEL = 0.5;

const fillCopy = (
  template: string,
  values: Record<string, string>,
  unresolved: string[],
): string =>
  template.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (whole, key: string) => {
    if (key in values) return values[key];
    if (!unresolved.includes(key)) unresolved.push(key);
    return whole;
  });

export const decomposition = (): Decomposition | null => {
  /**
   * THE SUBJECT WAS WITHDRAWN, SO THIS RETURNS NOTHING.
   *
   * D-37 bound the first viewport to the Hodge decomposition of one grader's
   * comparison energy, and the band the whole figure existed to show was the
   * intransitive one. That claim did not survive: the later analysis found
   * zero cyclic triples in 186,378 triangles, 10,000 of 10,000 sampled
   * tournaments acyclic, and the measured value sitting on the encoding floor.
   *
   * The copy block it read is gone from copy.yaml, which is what makes this an
   * absence rather than an opinion: there is no public sentence left for a
   * band to carry. Returning null here rather than deleting the module keeps
   * the generator, the schema and the geometry intact for the corrected
   * version under the historical log, and keeps the hero rendering its room
   * with no data-bound bands until the live scene replaces it.
   */
  if (!decompositionCopy) return null;

  const raw = rawDecomposition();
  if (!raw) return null;

  const scale = HERO_Y.fanExtent / tan(raw.fanDegrees);
  /* The shift that folds the generator's symmetric fan onto one side. */
  const toOneSide = raw.fanDegrees / 2;

  const bands: Band[] = raw.bands.map((b) => {
    const centre = b.exitAngle + toOneSide;
    const near = centre - b.angularWidth / 2;
    const far = centre + b.angularWidth / 2;
    const nearY = -tan(near) * scale;
    const farY = -tan(far) * scale;
    const extent = Math.abs(farY - nearY);
    return {
      index: b.index,
      token: b.componentToken,
      label: labelFor(b),
      share: b.share,
      magnitude: b.magnitude,
      nearY,
      farY,
      extent,
      labelY: (nearY + farY) / 2,
      isZero: extent < SUB_PIXEL,
    };
  });

  const fanTop = bands.reduce((m, b) => Math.min(m, b.farY, b.nearY), 0);
  const unresolved: string[] = [];

  // The caption's own percentage is the curl band's share, read back from the
  // same array the figure draws, so the sentence and the picture cannot come
  // apart. It is not a second copy of the number.
  const curl = bands.find((b) => partKey(b.label) === partKey(decompositionCopy.curl ?? ""))
    ?? bands.find((b) => b.index === 1);
  const values: Record<string, string> = {};
  if (curl) values.curl_percent = `${(curl.share * 100).toFixed(1)}%`;

  const caption = fillCopy(decompositionCopy.caption, values, unresolved).trim();
  const scopeFilled = fillCopy(decompositionCopy.scope, values, unresolved).trim();
  const scopeHasHole = /\{\{/.test(scopeFilled);

  return {
    raw,
    bands,
    fanTop,
    zeroNote: bands.some((b) => b.isZero)
      ? decompositionCopy.zero_band_note.trim()
      : null,
    caption,
    // A line with a visible {{placeholder}} in it is worse than no line. The
    // hole is reported instead of rendered.
    scope: scopeHasHole ? null : scopeFilled,
    unresolved,
  };
};
