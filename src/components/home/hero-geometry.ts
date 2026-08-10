/**
 * The hero room's composition, stated once.
 *
 * DECISIONS.md D-24: one composition, three fidelities. The hand-authored room
 * in this packet, a build-time still, and the live scene must agree within 8px
 * on the beam axis, the prism centroid and the detector x (gate 20). The only
 * way that holds is if all three read the same numbers, so they are here and
 * they are exported. Packet S1 imports this file; it does not re-derive them.
 *
 * WHAT IS A CONSTANT HERE AND WHAT IS NOT.
 * Everything below is a *rendering* constant: where the bench sits in the room
 * and how big its parts are. Not one of them describes a measurement. The
 * measured quantities, the band magnitudes, arrive from
 * `src/data/decomposition.json` and are never written down in this repository.
 *
 * THE VERTICAL AXIS IS NOT IN THIS FILE, ON PURPOSE.
 * The optical axis is the vertical centre of the install strip's own surface,
 * and it is established by CSS grid rather than by arithmetic: the strip sits
 * in an `auto` row and the optics layer is a zero-height box centred on that
 * same row. A number here could only ever be a second opinion about where the
 * browser already put it, and the two would drift the moment the strip's type
 * or padding changed. See hero.astro.
 */

/** Horizontal positions, as a fraction of the optics box's own width. */
export const HERO_X = {
  /** The source. 0 is the left screen edge: the room is full bleed. */
  source: 0,
  /** The dispersing element's centroid. Right of centre, per D-22. */
  prism: 0.62,
  /** The detector plane. 1 is the right gutter, one --page-pad in. */
  detector: 1,
} as const;

/**
 * Vertical extents in CSS pixels, measured from the optical axis.
 * Negative is up. The spectrum fans upward only: below the axis is the rail,
 * the floor and the version row, and D-22 gives that half to the readout.
 */
export const HERO_Y = {
  /** Half the collimated beam's lit height. The core is thinner than this. */
  beamHalf: 11,
  /**
   * The fan's full vertical spread where it meets the detector. This is the
   * one number the text safe-zone contract is tuned with: narrowing it is the
   * third permitted move when a zone reads too bright, ahead of any scrim.
   */
  fanExtent: 128,
  /** The rail, beneath the axis. Twelve engraved ticks sit on it. */
  rail: 104,
  /** Where the floor's lit pool stops. */
  floor: 320,
} as const;

/**
 * Twelve ticks on the rail. D-22 states the count. It is bench furniture and
 * it encodes nothing, which is why it may be written here at all: the band
 * count next door is data and is never written anywhere.
 */
export const RAIL_TICKS = 12;

/** The room's height envelope. D-22: 100svh, floored at 560 and capped at 1080. */
export const ROOM = {
  minPx: 560,
  maxPx: 1080,
} as const;

/** The prism's drawn size in CSS pixels. Fixed, so it never scales anisotropically. */
export const PRISM = {
  wide: { w: 104, h: 92 },
  narrow: { w: 68, h: 60 },
} as const;

/**
 * Below --bp-md the bench does not fit beside the install strip, whose
 * min-content width is 256px and does not go lower. The narrow composition is
 * a closer view rather than a squashed one: no prism, no wedge, and the fan's
 * marks drawn at a fraction of their extent so they clear the subhead. See the
 * note in hero-optics.astro.
 */
export const NARROW = {
  railPx: 96,
  floorPx: 248,
  beamHalfPx: 8,
  /** The arrival marks are scaled together, so a share still reads against a share. */
  fanScale: 0.45,
} as const;

/**
 * The values the CSS consumes, as one object, so the stylesheet reads the same
 * numbers this module exports rather than a second copy of them. Gate 20 asks
 * the three fidelities to agree within 8px on the beam axis, the prism centroid
 * and the detector x; agreeing is easier when there is one place to read.
 *
 * EVERY NAME HERE IS AN INPUT, AND NONE OF THEM IS THE ACTIVE VALUE.
 * This lands on the element's own `style` attribute, and an inline custom
 * property beats every rule in a stylesheet no matter what its media query
 * says. So the wide values are emitted as `--*-wide` beside the `--*-narrow`
 * ones, and hero-optics.astro's stylesheet is what picks between them at
 * --bp-md. The alternative, emitting the wide value under the active name and
 * overriding it in a media query, does not work and did not: `--beam-half`,
 * `--rail-y` and `--floor-y` were all emitted under their active names and all
 * three media-query overrides were dead, so at 390 the beam rendered its
 * 11px wide half-height against NARROW.beamHalfPx's 8, the rail sat at 104px
 * against 96 and the floor at 320px against 248. Measured, not inferred.
 * `--fan-h` was already an input picked by `--fan-draw` and is the one that
 * behaved; this makes the other three work the way that one already did.
 */
export const heroCssVars = (fanPx: number): string =>
  [
    `--prism-x:${(HERO_X.prism * 100).toFixed(4)}%`,
    `--detector-inset:${(1 - HERO_X.detector) * 100}%`,
    `--beam-half-wide:${HERO_Y.beamHalf}px`,
    `--rail-y-wide:${HERO_Y.rail}px`,
    `--floor-y-wide:${HERO_Y.floor}px`,
    `--prism-w:${PRISM.wide.w}px`,
    `--prism-h:${PRISM.wide.h}px`,
    `--fan-h:${fanPx}px`,
    `--rail-y-narrow:${NARROW.railPx}px`,
    `--floor-y-narrow:${NARROW.floorPx}px`,
    `--beam-half-narrow:${NARROW.beamHalfPx}px`,
    `--fan-scale-narrow:${NARROW.fanScale}`,
  ].join(";");
