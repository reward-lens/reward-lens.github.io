/**
 * The renderer reads the stylesheet's colours, it does not keep its own.
 *
 * There is exactly one palette on this site and it is `design/tokens.css`. A
 * second copy inside a shader is how a light theme ends up half-authored, so
 * the room resolves its colours from the live document instead.
 *
 * WHY THE CONVERSION GOES THROUGH A CANVAS, which is not the obvious way and is
 * the only one that works. Reading a custom property gives back its *text*, not
 * a colour: `--beam` comes out as the literal "oklch(0.985 0.008 95)". The
 * apparent fix, setting that as an element's `color` and reading the computed
 * value back, does not help either: Chrome supports OKLCH natively and so the
 * computed `color` is *still* "oklch(0.985 0.008 95)", in that space.
 *
 * That mattered more than it sounds. `THREE.Color.setStyle` does not throw on a
 * string it cannot parse, it warns and leaves the colour untouched, and a fresh
 * `new Color()` is white. So every material in the room silently took white
 * instead of near-black graphite, and the first render came back as a blown-out
 * grey box that would have failed the hero's luminance contract outright. A
 * try/catch around the parse caught nothing, because nothing was thrown.
 *
 * A 2D canvas is the fix: `fillStyle` accepts any colour the browser accepts,
 * and `getImageData` hands back sRGB bytes. The browser stays the single
 * authority on what a token means, this file learns nothing about colour
 * spaces, and a token rewritten in some future space keeps working.
 */
import { Color } from "three";

/** The semantic roles the room draws with. Names match tokens.css. */
export const SCENE_TOKENS = [
  "--ground",
  "--surface-1",
  "--surface-2",
  "--surface-3",
  "--surface-4",
  "--line",
  "--line-strong",
  "--ink",
  "--ink-2",
  "--ink-3",
  "--beam",
  "--comp-1",
  "--comp-2",
  "--comp-3",
  "--comp-4",
  "--comp-5",
  "--comp-6",
  "--written",
  "--realized",
  "--alarm",
  "--comparator",
  "--control",
  "--state-refusal",
  "--state-bounded",
] as const;

export type SceneTokenName = (typeof SCENE_TOKENS)[number];
export type ScenePalette = Record<SceneTokenName, Color>;

/**
 * Resolve every scene token against the document's current theme.
 *
 * The probe element exists only to make the cascade apply: a custom property
 * has to be read from somewhere in the tree that the theme actually reaches.
 * The colour conversion itself happens in the canvas.
 */
export function readPalette(host: HTMLElement = document.body): ScenePalette {
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;inset-block-start:0;inset-inline-start:0;inline-size:0;block-size:0;opacity:0;pointer-events:none";
  host.appendChild(probe);

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const out = {} as ScenePalette;
  try {
    for (const token of SCENE_TOKENS) {
      probe.style.color = `var(${token})`;
      const specified = getComputedStyle(probe).color;
      out[token] = toColor(ctx, specified);
    }
  } finally {
    probe.remove();
  }
  return out;
}

/**
 * Paint the colour and read the pixel back.
 *
 * `fillStyle` silently keeps its previous value when handed something it
 * cannot parse, which is the same failure mode as `setStyle` and would be just
 * as invisible. So the canvas is cleared to a colour no token uses and the
 * result is compared against it: if the paint did not take, we know, and we say
 * so rather than rendering a plausible wrong room.
 */
function toColor(ctx: CanvasRenderingContext2D | null, value: string): Color {
  const color = new Color();
  if (!ctx) {
    color.setStyle("rgb(255,0,255)");
    return color;
  }
  const SENTINEL = "rgb(255,0,255)";
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = SENTINEL;
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = SENTINEL;
  ctx.fillStyle = value;
  if (ctx.fillStyle === SENTINEL && value !== SENTINEL) {
    // The browser declined the value. Leave the sentinel visible.
    console.warn(`[scene] could not resolve colour: ${value}`);
  }
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  // setStyle applies the sRGB to linear-working-space conversion for us, which
  // is what makes the lit result match the flat DOM colour beside it.
  color.setStyle(`rgb(${r},${g},${b})`);
  return color;
}

/** The document's active theme, for exposure and tone-mapping decisions. */
export function readTheme(): "dark" | "light" {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
