/**
 * Which token is "the light" in each theme, and which is "the bounce".
 *
 * THIS FILE EXISTS BECAUSE `--beam` INVERTS AND A LIGHT SOURCE MUST NOT. In the
 * dark theme `--beam` is `oklch(0.985 0.008 95)`, very nearly white, and it is
 * the correct colour for every emitter in the room. In the light theme
 * `tokens.css:342` redefines it as `oklch(0.320 0.012 170)` with the comment
 * "the brightest role becomes the darkest ink", because on paper the beam is
 * drawn as a dark line rather than as a glow.
 *
 * That is right for the DOM and catastrophic for the renderer. A `DirectionalLight`
 * coloured `--beam` in the light theme emits at a linear 0.03, so multiplying its
 * intensity does almost nothing and the room stays black no matter how hard the
 * rig is driven. The previous rig had exactly this bug and hid it: its light
 * theme was carried almost entirely by a hemisphere light tinted `--surface-3`,
 * which in the light theme is near-white, so the key was contributing nearly
 * nothing while appearing to be the key. Removing the hemisphere light exposed
 * it.
 *
 * So light colour is a ROLE resolved per theme, not a token used directly.
 * Everything that emits reads `SOURCE_TOKEN`; everything that bounces reads
 * `BOUNCE_TOKEN`. Both the analytic rig and the authored environment resolve
 * through here, which is also what keeps a highlight the same colour in the two
 * places that have to agree about it.
 */
import type { SceneTokenName } from "../core/palette";

/** The emitting surface: near-white in both themes, by different names. */
export const SOURCE_TOKEN: Record<"dark" | "light", SceneTokenName> = {
  dark: "--beam",
  light: "--surface-1",
};

/**
 * The floor, seen as a light. Dark theme: the bench's own graphite, so the
 * bounce is the dim green-grey a dark floor actually returns. Light theme: a
 * step down from the brightest surface, so the bounce reads as light coming off
 * a pale bench rather than as a second key.
 */
export const BOUNCE_TOKEN: Record<"dark" | "light", SceneTokenName> = {
  dark: "--surface-1",
  light: "--surface-3",
};
