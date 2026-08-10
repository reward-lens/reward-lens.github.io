/**
 * The materials for the things that ARE light, as opposed to the things light
 * lands on.
 *
 * `materials/surfaces.ts` owns every surface: anodized, machined, glass,
 * marking, detector face. It deliberately has no entry for a beam, and it
 * should not: a beam is not a finish, it has no roughness, it does not take
 * light because it is the light. What it needs is a colour and an emission, and
 * a `MeshStandardMaterial` at metalness 0 would only add a lighting calculation
 * whose result is thrown away.
 *
 * So the beams, the bands, the rollout rays and the run traces are
 * `MeshBasicMaterial`, and they are built HERE rather than inline in six
 * components, for exactly the reason the surface library exists: the decision
 * about how bright the beam is relative to the bands relative to the traces is
 * one decision, and it is unreviewable spread across six files.
 *
 * COLOUR IS ONLY EVER DATA. Every role below names a token, and the tokens it
 * names are the ones the DOM uses for the same quantity. `--written` and
 * `--realized` are the two series' colours everywhere else on this site; a
 * refusal is `--state-refusal`, which is blue, and there is no red in this
 * module because red would mean "bad" rather than mean anything.
 *
 * TONE MAPPING, AND WHY `toneMapped: false` IS NOT THE PROTECTION IT LOOKS
 * LIKE. `INTERFACES.md` §2 records the measurement: once a composer exists, a
 * full-screen pass cannot know which material made a pixel, so the flag stops
 * protecting the beam. It is still set on the emissive roles, because at the
 * low tier there is no composer and there the flag is real. It is not relied on
 * at the tiers that have one; the roles are authored bright enough to survive
 * AgX at exposure 1.0 instead.
 */
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  NormalBlending,
  type Material,
} from "three";
import { readTheme, type ScenePalette, type SceneTokenName } from "../core/palette";

type Theme = "dark" | "light";

/**
 * What a piece of light in this scene can be.
 *
 * Each role is a physical thing on the bench, not a style: the core is the
 * collimated beam, the sheath is the spill around it, a band is dispersed
 * light, a ray is one rollout's path, a trace is a recorded series drawn as a
 * wire, and a marker is a lit indicator.
 *
 * THREE ROLES WERE REMOVED FROM THIS LIST AND THE REASON MATTERS MORE THAN THE
 * TIDINESS. `bandFaint`, `alarm` and `comparator` were declared, built and
 * drawn by nothing. `bandFaint` was superseded by the emphasis scale, which
 * dims a band by multiplying its opacity rather than by naming a second role
 * for the same object. The other two are the trap: this scene draws detector
 * markers as `control` when a signal was promoted and `refusal` when it was
 * rejected, because a rejected detector is a decision and not a failure, and
 * `alarm` sitting in the vocabulary is precisely the thing the next hand would
 * reach for when drawing an alarm. `tests/scene/assemblies/bench.test.mjs`
 * asserts every remaining role is used by an assembly, so this list cannot
 * quietly grow a fourth.
 */
export type LightRole =
  | "core"
  | "sheath"
  | "band"
  | "ray"
  | "rayIdle"
  | "reference"
  | "traceWritten"
  | "traceRealized"
  | "traceFormat"
  | "control"
  | "refusal"
  | "bounded";

interface RoleSpec {
  token: SceneTokenName;
  /** Multiplier on the token's colour. Above 1 is an emitter, below 1 is dim. */
  gain: number;
  opacity: number;
  /**
   * Additive is right for light crossing light, wrong for a wire over a wire.
   *
   * IN THE DARK THEME ONLY. See `blendingFor` below: this flag was shipped as
   * though it were universal and the light theme paid for it.
   */
  additive: boolean;
  /** A ribbon is seen from both sides. A culled band is an invisible band. */
  doubleSide: boolean;
  depthWrite: boolean;
}

/**
 * ADDITIVE BLENDING IS A DARK-THEME CONSTRUCTION, AND IT WAS SHIPPED AS IF IT
 * WERE UNIVERSAL.
 *
 * Measured on the built page at 1440, light theme, before this correction: the
 * score band's greatest departure from the ground was 10 of 255 and carried no
 * hue at all, the eight rollout rays were absent, the reference path was
 * absent, and all three run traces were absent. Everything drawn with an
 * additive role had vanished. The cause is arithmetic rather than authoring:
 * adding light to a ground already at 205 of 255 saturates it, and the light
 * theme is exactly where `--beam` stops being the brightest role and becomes
 * the darkest ink (#2d3532 against #fcfaf4 in the dark theme).
 *
 * THE CORRECTION IS THE BLENDING AND NOT THE OPACITY, and that distinction is
 * the whole reason this is a defensible change rather than a slider. Additive
 * at alpha over black contributes alpha*C. Normal blending at the same alpha
 * over white departs from the ground by alpha*(white - C). Same alpha, same
 * contrast magnitude, opposite sign, which is what an authored light theme is
 * supposed to be. Not one role's opacity moves.
 *
 * What is genuinely lost is stated rather than papered over: in the light
 * theme two crossing rays no longer brighten each other, so a crossing is no
 * longer readable as a crossing. Accumulation is a property of adding light
 * and there is no honest normal-blended equivalent of it.
 */
function blendingFor(spec: RoleSpec, theme: Theme): typeof AdditiveBlending | typeof NormalBlending {
  return spec.additive && theme === "dark" ? AdditiveBlending : NormalBlending;
}

/**
 * THE LIGHT TABLE.
 *
 * The gains are ratios to each other, and the ratio that matters most is the
 * first two: the sheath is 6% of the core, because the spill around a real
 * collimated beam in a dusty room is a faint halo and anything above about a
 * tenth reads as fog. `SCENE.md` §3 puts the volumetric term at 0.06 for the
 * same reason and this agrees with it rather than adding a second opinion.
 *
 * The traces are NOT emissive and their gain is 1.0. `SCENE.md` §4.5 is
 * explicit and correct: they are data, and making them glow would put them in
 * the same visual register as the beam, which is the light. A reader who sees a
 * trace glowing has been told it is a source.
 */
const ROLES: Record<LightRole, RoleSpec> = {
  /** The collimated beam. The brightest thing in the room, by design. */
  core: { token: "--beam", gain: 1.0, opacity: 1, additive: false, doubleSide: false, depthWrite: true },
  /** The halo. Faint, additive, and never writes depth or it cuts a hole. */
  sheath: { token: "--beam", gain: 1.0, opacity: 0.055, additive: true, doubleSide: false, depthWrite: false },
  /** Dispersed light leaving the element. Additive so crossings brighten. */
  band: { token: "--comp-1", gain: 1.0, opacity: 0.3, additive: true, doubleSide: true, depthWrite: false },
  /** One rollout's path through the selection stage. */
  ray: { token: "--beam", gain: 1.0, opacity: 0.85, additive: true, doubleSide: false, depthWrite: false },
  /** A rollout that is present but not being followed. */
  rayIdle: { token: "--ink-3", gain: 1.0, opacity: 0.4, additive: true, doubleSide: false, depthWrite: false },
  /** The full-gradient reference path: present, deliberately not the subject. */
  reference: { token: "--control", gain: 1.0, opacity: 0.55, additive: true, doubleSide: false, depthWrite: false },
  traceWritten: { token: "--written", gain: 1.0, opacity: 1, additive: false, doubleSide: false, depthWrite: true },
  traceRealized: { token: "--realized", gain: 1.0, opacity: 1, additive: false, doubleSide: false, depthWrite: true },
  traceFormat: { token: "--ink-3", gain: 1.0, opacity: 0.75, additive: false, doubleSide: false, depthWrite: true },
  control: { token: "--control", gain: 1.0, opacity: 1, additive: false, doubleSide: true, depthWrite: true },
  /** Blue. A refusal is not a failure and this site never draws it as one. */
  refusal: { token: "--state-refusal", gain: 1.0, opacity: 1, additive: false, doubleSide: true, depthWrite: true },
  bounded: { token: "--state-bounded", gain: 1.0, opacity: 1, additive: false, doubleSide: true, depthWrite: true },
};

/** The published table, for the tests. No THREE objects, just the numbers. */
export const LIGHT_TABLE = ROLES;

const cache = new Map<string, Material>();

/**
 * The theme this module builds against.
 *
 * Read from the document, in the shape `materials/surfaces.ts` reads it, so a
 * theme flip reaches the emissive materials by the same route it reaches the
 * surfaces. `primeLights` is the seam for a caller that has no document.
 */
let primedTheme: Theme | null = null;

/** Hands this module a theme, for a test or a still with no document. */
export function primeLights(theme: Theme): void {
  primedTheme = theme;
}

function currentTheme(): Theme {
  if (typeof document === "undefined") {
    if (primedTheme) return primedTheme;
    throw new Error(
      "[scene/light] useLight needs a theme and there is no document to read one from. " +
        "Call primeLights(theme) first.",
    );
  }
  return readTheme();
}

/**
 * A memoized emissive material for one role.
 *
 * `tint` overrides the role's token, which is how the six component colours
 * reach the bands without six roles. Callers must not mutate the result.
 *
 * THE KEY CARRIES THE THEME, AND IT DID NOT USED TO. Before this, the key was
 * role, token and opacity: three things none of which change when the reader
 * flips the theme. `--beam` is #fcfaf4 in the dark theme and #2d3532 in the
 * light one, so a toggled page kept every beam, band, ray and trace at the
 * colour of the theme it was first mounted in, while every surface beside them
 * moved. It never showed up in a shoot because a shoot loads the page once per
 * theme and a fresh load has an empty cache. It shows up for a reader with a
 * toggle, which is every reader.
 */
export function useLight(
  role: LightRole,
  palette: ScenePalette,
  tint?: SceneTokenName,
  opacityScale = 1,
): Material {
  const spec = ROLES[role];
  const token = tint ?? spec.token;
  const theme = currentTheme();
  const key = `${role}|${token}|${opacityScale.toFixed(3)}|${theme}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const base = palette[token];
  if (!base) throw new Error(`[scene/light] "${token}" is not a scene token; see core/palette.ts`);
  const color = base.clone().multiplyScalar(spec.gain) as Color;
  const opacity = Math.min(1, spec.opacity * opacityScale);
  const blending = blendingFor(spec, theme);

  const material = new MeshBasicMaterial({
    color,
    toneMapped: false,
    transparent: opacity < 1 || blending === AdditiveBlending,
    opacity,
    depthWrite: spec.depthWrite && opacity >= 1,
    blending,
    side: spec.doubleSide ? DoubleSide : undefined,
  });
  material.name = `light:${role}:${token}:${theme}`;
  cache.set(key, material);
  return material;
}

/** Disposes every cached emissive material. Called by the scene root. */
export function disposeLights(): void {
  for (const material of cache.values()) material.dispose();
  cache.clear();
  primedTheme = null;
}

/** How many emissive materials are live. For the tests and the budget. */
export function lightCacheSize(): number {
  return cache.size;
}
