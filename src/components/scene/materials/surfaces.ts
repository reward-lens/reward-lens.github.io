/**
 * Every surface the bench is made of, and the only place a material is built.
 *
 * A mesh names a physical surface class and gets back a shared, memoized
 * material. No component constructs a `meshStandardMaterial` inline any more.
 * The reason is not tidiness: it is that the whole scene's look is a small set
 * of decisions about how five or six real finishes take light, and those
 * decisions are unreviewable when they are spread across fifteen JSX
 * attributes in eight files. Here they are one table a reviewer can read in a
 * minute and one place a measurement can land.
 *
 * ------------------------------------------------------------------------
 * THE CORRECTION THIS FILE EXISTS TO MAKE
 * ------------------------------------------------------------------------
 *
 * The first lit version of the room put every material between metalness 0.12
 * and 0.22, and `Room.tsx` recorded the reasoning honestly: the rail was tried
 * at 0.72, measured 19 of 255 against a target band of 48 to 72, and was
 * dropped back to a near-dielectric. **The measurement was right and the
 * conclusion was backwards.**
 *
 * A metal is dark when there is nothing for it to reflect. That is not a defect
 * in the metal, it is the definition of a metal: metalness 1 means the diffuse
 * term is gone and every photon leaving the surface arrived from somewhere else
 * in the room. With no environment map in the repository, "somewhere else in
 * the room" was one directional light and a hemisphere, so the rail returned a
 * single highlight and black. Lowering metalness restored a diffuse term and
 * with it a predictable grey, which is exactly why it worked and exactly why it
 * was wrong: anodized aluminium at metalness 0.15 is grey plastic, and grey
 * plastic is what the render showed.
 *
 * So the metals are back at 1.0, where the material model says they belong, and
 * the luminance target is the render pipeline's job to hit with an environment
 * rather than this module's job to fake with a slider. **As of this commit that
 * environment does not exist yet**, so the numbers below were authored against
 * the stand-in rig in `design/dossier/build/scene-materials/study/`, which
 * implements the same contract `INTERFACES.md` §2 gives the render pipeline
 * builder. Each value says what measured it. They are re-measurable the day
 * `useAuthoredEnvironment` lands, and the study rig is checked in so that the
 * re-measurement is a re-run rather than a rebuild.
 *
 * ------------------------------------------------------------------------
 * WHY A TINT IS TWO TOKENS AND NOT ONE
 * ------------------------------------------------------------------------
 *
 * A black anodized mount is black in both themes. The page's tokens are not:
 * `--surface-2` is #1d2220 in the dark theme and #eff4f2 in the light one,
 * because the token system encodes *contrast roles*, not pigments. Tinting a
 * housing with a single token name would therefore repaint the hardware white
 * when the reader flips the theme, which is the "inverted rather than authored"
 * failure the light theme was specifically built to avoid.
 * `InstrumentScene.tsx` already states the intent: light mode is the same bench
 * under an inspection lamp. The same bench has the same paint.
 *
 * So each surface names the token that plays its physical role in each theme,
 * the room's own surfaces (floor, wall) keep following the theme by passing an
 * explicit `tint`, and the objects standing on them do not. Every colour still
 * comes from `readPalette()`; none is a hex literal.
 *
 * A consequence worth stating rather than hiding: `anodized` and `railTop`
 * name the same two tokens, so they are the same colour in both themes and are
 * separated only by roughness and clearcoat. That is the principle `Room.tsx`
 * already states and it is the correct one, and it is literally true of the
 * hardware: a rail's ground top face and its anodized sides are the same alloy
 * with the same dye, and what tells them apart is that one of them was ground
 * flat afterwards.
 */
import {
  Color,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Material,
} from "three";
import { readPalette, readTheme, type ScenePalette, type SceneTokenName } from "../core/palette";
import type { SceneTier } from "../runtime/tier";
import { applyVariation, NO_VARIATION, type VariationProfile } from "./variation";

/**
 * Every physical surface class the bench contains. A mesh names one of these.
 * There is no other way to get a material.
 */
export type SurfaceName =
  | "anodized" // housings and mounts: dark satin metal, slightly soft highlight
  | "machined" // bare aluminium: brighter, tool marks along one axis
  | "blackOxide" // fasteners and hardware: darker and rougher than the housings
  | "railTop" // the one low-roughness anodized face, specular line along its length
  | "opticalGlass" // transmissive, high tier only, small element count
  | "paintedMarking" // silkscreen and etched labels: matte, no specular life
  | "detectorFace"; // rough dielectric with a faint sheen

export interface SurfaceRequest {
  surface: SurfaceName;
  /** Semantic token name, resolved through `core/palette.ts`. Never a hex literal. */
  tint?: SceneTokenName;
  /** Session tier. Governs transmission, clearcoat and roughness-map presence. */
  tier: SceneTier;
}

type Theme = "dark" | "light";

/** A token per theme, so a physical object keeps its colour when the page flips. */
interface ThemedTint {
  dark: SceneTokenName;
  light: SceneTokenName;
}

interface SurfaceSpec {
  tint: ThemedTint;
  metalness: number;
  roughness: number;
  /** Multiplier on the environment's contribution. The pipeline scales globally. */
  envMapIntensity: number;
  variation: VariationProfile;
  /** Anodizing is a thin transparent oxide over metal, so it gets a weak second lobe. */
  clearcoat?: number;
  clearcoatRoughness?: number;
  /** Stretches the specular lobe along the machining direction. High tier only. */
  anisotropy?: number;
  anisotropyRotation?: number;
  sheen?: number;
  sheenRoughness?: number;
  sheenTint?: ThemedTint;
  transmission?: number;
  thickness?: number;
  ior?: number;
  dispersion?: number;
  attenuationDistance?: number;
  attenuationTint?: ThemedTint;
  /** What a mid or low tier gets instead, when the full spec is too expensive. */
  reduced?: {
    roughness?: number;
    transparent?: boolean;
    opacity?: number;
  };
}

/**
 * THE MATERIAL TABLE.
 *
 * FINAL VALUES, and where each came from. Measured on the study prop at
 * `design/dossier/build/scene-materials/`, dark theme, AgX, exposure 1.0.
 *
 * | surface          | metal | rough | what set the roughness                  |
 * |------------------|-------|-------|-----------------------------------------|
 * | `anodized`       |  1.0  | 0.44  | study rig, shoots 1-8; reads 49 and 76  |
 * | `machined`       |  1.0  | 0.31  | study rig, shoot 2; reads 166           |
 * | `blackOxide`     |  1.0  | 0.54  | reference 02, the socket head            |
 * | `railTop`        |  1.0  | 0.24  | study rig; 0.20 below `anodized` on      |
 * |                  |       |       | purpose, so it reads as a line          |
 * | `opticalGlass`   |  0    | 0.03  | polished glass, not measured            |
 * | `paintedMarking` |  0    | 0.82  | reference 16, the silkscreen; reads 195 |
 * | `detectorFace`   |  0    | 0.62  | study rig, reference 17                 |
 *
 * Every one of these is provisional in one specific sense, stated once here
 * rather than seven times below: they were balanced against `study/rig.ts`'s
 * stand-in environment, not against `useAuthoredEnvironment`, which did not
 * exist when they were set. Re-measure on the day it lands.
 *
 * Roughness and metalness are the two numbers that decide whether this room
 * reads as an instrument, so each one below carries what set it. "Study rig"
 * means it was measured on the prop in
 * `design/dossier/build/scene-materials/study/` against the stand-in
 * environment; those are the values that must be re-measured against
 * `useAuthoredEnvironment` when it lands. "Reference" means it was matched
 * against the photographs in `design/dossier/build/scene-materials/reference/`
 * with the render and the photograph at the same size on screen.
 */
const SPECS: Record<SurfaceName, SurfaceSpec> = {
  /**
   * Type II black anodize over bead-blasted 6061. The workhorse: mount bodies,
   * collimator housings, post holders, anything the bench is mostly made of.
   *
   * metalness 1.0  the material model's value for a metal. Restored from 0.15;
   *                see the header. Not measured, decided, and the decision is
   *                that a metal is a metal.
   * roughness 0.44 study rig, shoots 1 to 5. Started at INTERFACES' midpoint of
   *                0.42. At 0.35 the strip light reflected as a readable
   *                rectangle, which is what a polished part does; at 0.52 the
   *                highlight spread until the part had no edge left. 0.44 holds
   *                a soft elongated highlight that still has a top and a
   *                bottom, which is what reference 16 shows on the mount body.
   * tint           `--line-strong`, NOT `--surface-2`, and this was the single
   *                largest correction the study made. On shoot 1 the rail
   *                measured 3.4 of 255 against a target band of 48 to 72, which
   *                is darker than the room behind it. The cause is that for a
   *                metal the colour is F0, the specular reflectance, and
   *                `--surface-2` is F0 0.015: a 1.5% mirror returns 1.5% of
   *                whatever the environment gives it, and no environment fixes
   *                that. Black anodize is a dyed porous oxide over aluminium
   *                and its total reflectance is 4 to 6 percent, not 1.5, so the
   *                token has to be one that lands there. `--line-strong` is
   *                F0 0.062. Measured on the final frame, dark theme, exposure
   *                1.0, operator AgX: the mount body's lit face reads 49.3 of
   *                255 and the lens barrel 75.8, against `SCENE.md`'s target
   *                band of 48 to 72. That band is reached from an environment
   *                alone, which is the whole claim.
   * clearcoat 0.32 the oxide layer. It is what puts a second, tighter highlight
   *                inside the broad one, and it is the difference between
   *                "dark metal" and "anodized dark metal" in the side-by-side.
   */
  anodized: {
    tint: { dark: "--line-strong", light: "--ink-2" },
    metalness: 1.0,
    roughness: 0.44,
    envMapIntensity: 1.0,
    clearcoat: 0.32,
    clearcoatRoughness: 0.3,
    variation: { scale: [7, 7, 7], grain: 0.19, wear: 0.13, patina: 0.05, bump: 0.005 },
  },

  /**
   * Bare or clear-anodized aluminium, turned or milled: posts, shafts, exposed
   * threads, the bore of a holder, a set screw's flat.
   *
   * metalness 1.0  as above.
   * roughness 0.31 study rig, just above INTERFACES' 0.22 to 0.32. Below 0.22 it
   *                becomes a mirror and starts reporting the stand-in
   *                environment's rectangles as objects, which is the failure
   *                mode to avoid on a surface this bright.
   * tint --ink     bare aluminium's specular reflectance is around 0.92, near
   *                white. `--ink` is #e2e7e5 in the dark theme and the palette
   *                has nothing brighter that is not the beam itself.
   * anisotropy 0.55 high tier only. Aligned with the same axis the grain is
   *                stretched along, so the two agree instead of fighting.
   *
   * The grain frequency was 64 per unit on shoot 1 and the post came back as
   * television static: at the bench camera's 121 pixels per world unit the
   * finest octave was under two pixels wide, and a derivative bump amplifies
   * exactly what is already aliasing. See the frequency rule in `variation.ts`.
   */
  machined: {
    tint: { dark: "--ink", light: "--surface-4" },
    metalness: 1.0,
    roughness: 0.31,
    envMapIntensity: 1.0,
    anisotropy: 0.55,
    anisotropyRotation: 0,
    variation: { scale: [2.5, 11, 11], grain: 0.14, wear: 0.08, patina: 0.04, bump: 0.0027 },
    reduced: { roughness: 0.32 },
  },

  /**
   * Black oxide steel: cap screws, set screws, spring plungers, anything that
   * has to be harder than aluminium.
   *
   * metalness 1.0  it is steel.
   * roughness 0.54 reference. The photographs are unambiguous that hardware is
   *                the dullest thing in a bench photograph: a cap screw head
   *                surrounded by anodized aluminium carries no highlight of its
   *                own and reads as a dark disc with a lit rim. 0.54 is where
   *                that happened on the study prop.
   * tint           `--surface-3` / `--ink`, both below the anodized housings in
   *                their own theme. Black oxide is a conversion coating on
   *                steel and is genuinely darker than a dyed oxide on
   *                aluminium; reference 02 shows the socket head as the one
   *                thing with no highlight of its own.
   */
  blackOxide: {
    tint: { dark: "--surface-3", light: "--ink" },
    metalness: 1.0,
    roughness: 0.54,
    envMapIntensity: 0.9,
    variation: { scale: [14, 14, 14], grain: 0.18, wear: 0.09, patina: 0.06, bump: 0.0029 },
  },

  /**
   * The rail's top face, and the only low-roughness anodized surface in the
   * room.
   *
   * roughness 0.24 study rig, and it is deliberately far below `anodized`'s
   *                0.42 rather than a little below it. The composition depends
   *                on one specular line running the length of the bench; a
   *                surface half a step rougher than its neighbours produces a
   *                slightly brighter smear, not a line. The gap has to be
   *                large enough to read as a different finish, because on a
   *                real rail it is one: the top is ground flat after anodizing
   *                and the sides are not.
   * clearcoat 0.45 tighter and stronger than the housings', which is what makes
   *                the line a line.
   */
  railTop: {
    tint: { dark: "--line-strong", light: "--ink-2" },
    metalness: 1.0,
    roughness: 0.24,
    envMapIntensity: 1.15,
    clearcoat: 0.45,
    clearcoatRoughness: 0.16,
    variation: { scale: [1.8, 9, 9], grain: 0.085, wear: 0.06, patina: 0.03, bump: 0.0022 },
    reduced: { roughness: 0.28 },
  },

  /**
   * The lens element. High tier only, and there are two of them in the whole
   * scene.
   *
   * The installed three@0.185.1 exposes `transmission`, `thickness`, `ior`,
   * `dispersion`, `attenuationDistance` and `attenuationColor` on
   * `MeshPhysicalMaterial`; all six are verified present by
   * `tests/scene/materials/three-api.test.mjs` rather than assumed.
   *
   * roughness 0.03 polished glass. The variation on this surface is 0.012 peak
   *                to peak and is there only to stop the highlight banding, not
   *                to suggest wear. A scratched lens is a different claim.
   * ior 1.52       N-BK7 is 1.5168. 1.52 is that, rounded.
   * dispersion 0.35 exaggerated. Real crown glass at a 0.5 unit element is
   *                sub-pixel here, which `SCENE.md` §4.2 already measured for
   *                the prism and is equally true of the lens. Stated as a
   *                choice rather than left to look like a constant.
   * thickness 0.34 world units, matching `LENS_ELEMENT_PROFILE`'s sag times two.
   */
  opticalGlass: {
    tint: { dark: "--ink", light: "--surface-1" },
    metalness: 0,
    roughness: 0.03,
    envMapIntensity: 1.0,
    transmission: 1.0,
    thickness: 0.34,
    ior: 1.52,
    dispersion: 0.35,
    attenuationDistance: 3.0,
    attenuationTint: { dark: "--comp-2", light: "--comp-2" },
    variation: { scale: [9, 9, 9], grain: 0.014, wear: 0.009, patina: 0, bump: 0.0004 },
    reduced: { roughness: 0.06, transparent: true, opacity: 0.4 },
  },

  /**
   * Laser-engraved or silkscreened markings: the scale on a rail, a part
   * number, an aperture label.
   *
   * metalness 0    it is oxide or ink, not metal.
   * roughness 0.82 reference. The photographs show markings as the one thing on
   *                a bench with no specular life at all; they stay the same
   *                brightness as the housing rolls under the light, which is
   *                what makes them read as printed rather than as inlaid.
   * The colour is a near-white token in both themes, because a white marking on
   * a black housing is white whichever way the page is going. It shares `--ink`
   * with `machined` in the dark theme and that is fine: one is a dielectric at
   * roughness 0.82 and the other is a metal at 0.26, so they are separated by
   * how they take light, which is the rule.
   */
  paintedMarking: {
    tint: { dark: "--ink", light: "--surface-2" },
    metalness: 0,
    roughness: 0.82,
    envMapIntensity: 0.7,
    variation: { scale: [18, 18, 18], grain: 0.13, wear: 0.07, patina: 0, bump: 0.0022 },
  },

  /**
   * The detector's sensitive face: a rough dielectric with a faint forward
   * sheen, the way a ground glass screen or an absorbing coating behaves.
   *
   * roughness 0.62 study rig.
   * sheen 0.3      `MeshPhysicalMaterial.sheen`, present in the installed
   *                version. It is what puts a pale rim on the face at grazing
   *                incidence and stops it reading as matte paint. High and mid
   *                tiers only; the low tier drops to a plain standard material.
   *
   * Unlike the metals, this material's colour is an albedo rather than an F0,
   * so `--ink-3` is read as "this face reflects about a fifth of what lands on
   * it", which is what a ground glass or an absorbing coating does. It is the
   * one surface that names the same token in both themes and still lands in
   * tolerance, because `--ink-3` is a mid grey either way.
   */
  detectorFace: {
    tint: { dark: "--ink-3", light: "--ink-3" },
    metalness: 0,
    roughness: 0.62,
    envMapIntensity: 0.85,
    sheen: 0.3,
    sheenRoughness: 0.85,
    sheenTint: { dark: "--ink-3", light: "--ink-3" },
    variation: { scale: [11, 11, 11], grain: 0.16, wear: 0.08, patina: 0, bump: 0.004 },
  },
};

/**
 * The published table, in the form a reviewer or a test wants it: no closures,
 * no THREE objects, just the numbers. `design/dossier/build/scene-materials/`
 * quotes this and the tests assert against it.
 */
export const SURFACE_TABLE = SPECS;

/* ------------------------------------------------------------------------- *
 * The palette, and the one seam that keeps this testable
 * ------------------------------------------------------------------------- */

let primed: { theme: Theme; palette: ScenePalette } | null = null;

/**
 * Hand this module the palette the scene root has already read.
 *
 * Optional. Without it, `useSurface` reads the document itself on the first
 * request per theme, which is correct but does 24 `getComputedStyle` calls plus
 * a canvas round trip that the scene root has already paid for. With it, the
 * module never touches the DOM, which is also what lets the whole surface table
 * be tested under `node --test` with no browser.
 *
 * Call it again when the theme changes. It does not dispose the previous
 * theme's materials: a mesh may still be holding one for the frame in flight,
 * and disposing a material that is still assigned is a GL error rather than a
 * garbage collection. They are small, they are bounded by the number of
 * surfaces, and `disposeSurfaces` takes all of them.
 */
export function primeSurfaces(palette: ScenePalette, theme: Theme): void {
  primed = { theme, palette };
}

function currentPalette(): { theme: Theme; palette: ScenePalette } {
  if (typeof document === "undefined") {
    if (primed) return primed;
    throw new Error(
      "[scene/materials] useSurface needs a palette and there is no document to read one from. " +
        "Call primeSurfaces(palette, theme) first.",
    );
  }
  const theme = readTheme();
  if (!primed || primed.theme !== theme) {
    primed = { theme, palette: readPalette() };
  }
  return primed;
}

/* ------------------------------------------------------------------------- *
 * The cache
 * ------------------------------------------------------------------------- */

const cache = new Map<string, Material>();

function keyFor(req: SurfaceRequest, theme: Theme): string {
  return `${req.surface}|${req.tint ?? "-"}|${req.tier}|${theme}`;
}

/**
 * Does this tier get the second lobe: clearcoat, anisotropy, sheen,
 * transmission?
 *
 * The split is not about the cost of the parameters, which is a handful of
 * instructions. It is about `MeshPhysicalMaterial` compiling a materially
 * bigger shader than `MeshStandardMaterial` and about the low tier being the
 * tier where a phone is already struggling. High and mid get physical; low and
 * still get standard and lose nothing the composition depends on, because at
 * the low tier there is no post chain to resolve a clearcoat lobe against
 * anyway.
 */
function usesPhysical(tier: SceneTier): boolean {
  return tier === "high" || tier === "mid";
}

/** Transmission is high tier only. It costs a backbuffer copy per frame. */
function usesTransmission(tier: SceneTier): boolean {
  return tier === "high";
}

/** Anisotropy is the one parameter that is genuinely high tier only. */
function usesAnisotropy(tier: SceneTier): boolean {
  return tier === "high";
}

function tokenColor(palette: ScenePalette, token: SceneTokenName): Color {
  const found = palette[token];
  if (!found) {
    throw new Error(`[scene/materials] "${token}" is not a scene token; see core/palette.ts`);
  }
  // A copy, because the palette's Color objects belong to the caller and a
  // material that shares one would repaint the caller's palette if anything
  // ever adjusted it.
  return found.clone();
}

function resolveTint(
  palette: ScenePalette,
  theme: Theme,
  themed: ThemedTint,
  override?: SceneTokenName,
): Color {
  return tokenColor(palette, override ?? themed[theme]);
}

function build(req: SurfaceRequest, palette: ScenePalette, theme: Theme): Material {
  const spec = SPECS[req.surface];
  if (!spec) throw new Error(`[scene/materials] unknown surface "${req.surface}"`);

  const physical = usesPhysical(req.tier);
  const reduced = physical ? undefined : spec.reduced;
  const roughness = reduced?.roughness ?? spec.roughness;

  const common = {
    color: resolveTint(palette, theme, spec.tint, req.tint),
    metalness: spec.metalness,
    roughness,
    envMapIntensity: spec.envMapIntensity,
    // INTERFACES §2 asks for the material dithering flag alongside the post
    // chain's noise, because a near-black room banding in eight-bit output is
    // one of the listed rejection conditions and the two fixes address
    // different halves of it: the material flag dithers the shaded result, the
    // post noise dithers the composed frame.
    dithering: true,
  };

  let material: Material;

  if (physical) {
    const m = new MeshPhysicalMaterial(common);

    if (spec.clearcoat !== undefined) {
      m.clearcoat = spec.clearcoat;
      m.clearcoatRoughness = spec.clearcoatRoughness ?? 0.3;
    }
    if (spec.anisotropy !== undefined && usesAnisotropy(req.tier)) {
      m.anisotropy = spec.anisotropy;
      m.anisotropyRotation = spec.anisotropyRotation ?? 0;
    }
    if (spec.sheen !== undefined) {
      m.sheen = spec.sheen;
      m.sheenRoughness = spec.sheenRoughness ?? 1;
      if (spec.sheenTint) m.sheenColor = resolveTint(palette, theme, spec.sheenTint);
    }
    if (spec.ior !== undefined) m.ior = spec.ior;

    if (spec.transmission !== undefined && usesTransmission(req.tier)) {
      m.transmission = spec.transmission;
      m.thickness = spec.thickness ?? 0;
      // `dispersion` is only read when `transmission` is above zero, so it is
      // set inside this branch rather than beside `ior`. Setting it on an
      // opaque material is not an error and not a warning; it is simply
      // ignored, which is the kind of silence that costs an afternoon.
      if (spec.dispersion !== undefined) m.dispersion = spec.dispersion;
      if (spec.attenuationDistance !== undefined) m.attenuationDistance = spec.attenuationDistance;
      if (spec.attenuationTint) {
        m.attenuationColor = resolveTint(palette, theme, spec.attenuationTint);
      }
    } else if (spec.transmission !== undefined) {
      // Mid tier: no backbuffer, so the element becomes a low-roughness
      // dielectric with alpha. It keeps its Fresnel rim, which is the part of
      // "this is glass" the eye actually reads at 4% of frame, and loses the
      // refraction, which at this size was carrying two pixels of colour.
      m.transparent = spec.reduced?.transparent ?? true;
      m.opacity = spec.reduced?.opacity ?? 0.4;
      m.roughness = spec.reduced?.roughness ?? spec.roughness;
    }

    material = m;
  } else {
    const m = new MeshStandardMaterial(common);
    if (spec.transmission !== undefined) {
      m.transparent = spec.reduced?.transparent ?? true;
      m.opacity = spec.reduced?.opacity ?? 0.4;
    }
    material = m;
  }

  material.name = `surface:${req.surface}:${req.tier}:${theme}`;

  // Every surface, including the polished ones. A constant roughness is the
  // rejection condition "untextured uniform roughness across a whole assembly",
  // and it is also just false about every object this scene draws.
  applyVariation(material, req.tier === "still" ? NO_VARIATION : spec.variation);

  return material;
}

/**
 * Returns a memoized material. Callers must not mutate the result: it is shared
 * across every mesh that asked for the same request.
 *
 * NOT A REACT HOOK, despite the name, which is fixed by `INTERFACES.md` §1. It
 * calls no hook, holds no React state, and is safe to call conditionally, in a
 * loop, or outside a component. It is memoized on a module-level map rather
 * than on a `useMemo` precisely so that two different components asking for
 * `anodized` get the same material object and therefore the same compiled
 * program.
 */
export function useSurface(req: SurfaceRequest): Material {
  const { theme, palette } = currentPalette();
  const key = keyFor(req, theme);
  const hit = cache.get(key);
  if (hit) return hit;
  const made = build(req, palette, theme);
  cache.set(key, made);
  return made;
}

/**
 * Disposes every cached material. Called once by the scene root on unmount.
 *
 * Also drops the primed palette, so a remount after a theme change rebuilds
 * against the theme that is actually current rather than the one that was
 * current when the last canvas died.
 */
export function disposeSurfaces(): void {
  for (const material of cache.values()) material.dispose();
  cache.clear();
  primed = null;
}

/** How many materials are live. For tests and for the debug overlay. */
export function surfaceCacheSize(): number {
  return cache.size;
}
