/**
 * One transfer curve for the whole site, and an exposure per theme.
 *
 * WHAT WAS WRONG BEFORE, AND IT WAS TWO THINGS AT ONCE. The dark theme ran ACES
 * at exposure 3.4 and the light theme ran `NoToneMapping` at 1.15. Two different
 * transfer functions means a material balanced in one theme is wrong in the
 * other by construction, so no single set of roughness values could ever satisfy
 * both, and the exposure was a rescue for the brightness the missing environment
 * had cost. ACES at 3.4 puts the entire mid range into the shoulder, where the
 * curve desaturates toward white: the room was grey because of the transfer
 * curve as much as because of the materials. Exposure is a small correction
 * around 1.0. If a scene needs 3.4, the lighting is wrong, and it was.
 *
 * WHY AGX. All three candidates were rendered on the real scene at matched
 * exposure and looked at; the comparison sheet is in
 * `design/dossier/build/scene-render/`. On a near-black room with one bright
 * beam they behave very differently, and the differences are all in the two
 * places this composition lives:
 *
 *   ACES filmic  crushes the low end hard, so the back wall and the shadowed
 *                housing faces collapse into one another and the room loses the
 *                separation the whole composition depends on, and its shoulder
 *                pushes the beam and the aperture toward white, which is the
 *                desaturation that made the first render grey.
 *   Neutral      holds the mid range honestly and is the closest to the raw
 *                values, but it rolls off late, so the beam clips to a flat
 *                white core with a hard edge instead of falling off.
 *   AgX          keeps the shadows separated, and its long, gentle shoulder is
 *                the one that holds hue into the highlight, so the beam stays
 *                the warm `--beam` colour at its centre rather than going white.
 *                It was designed for exactly this case: a dark frame with a
 *                small very bright source.
 *
 * AgX costs contrast in the mid range, which is a real price and is paid back
 * in the light rig rather than by bending the curve.
 */
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  NeutralToneMapping,
  type ToneMapping,
} from "three";

export type ToneMapOperator = "aces" | "agx" | "neutral";

export const TONE_MAP_OPERATORS: Record<ToneMapOperator, ToneMapping> = {
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
  neutral: NeutralToneMapping,
};

/**
 * The operator, and it is the same one in both themes. This is the property
 * INTERFACES.md §2 calls non-negotiable, and it is what lets the material
 * library hold one set of values instead of two.
 */
export const TONE_MAP: ToneMapOperator = "agx";

/**
 * Exposure, authored per theme, measured against the surface bands SCENE.md
 * sets: rail and floor 48-72 of 255, back wall 20-32, against a `--ground` of
 * 6-8. Swept with `scripts/dev/scene-sweep.mjs`, which walks the value on a
 * live page and reports which patches land in band.
 *
 * Both sit near 1.0 because the light rig carries the level now. The light
 * theme runs slightly hotter because its environment is a bright room and the
 * hero's text contract runs the other way there: gate 21 wants a mean linear
 * luminance at or above 0.82 behind the headline, not below 0.08.
 */
export const EXPOSURE: Record<"dark" | "light", number> = {
  dark: 1.0,
  light: 1.12,
};
