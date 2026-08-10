/**
 * The reason a surface stops looking like computer graphics.
 *
 * A material with one roughness number is perfectly uniform, and nothing
 * manufactured is perfectly uniform. Bead blasting leaves a grain, anodizing
 * leaves a thickness variation, handling leaves a broad polish where fingers go
 * and a broad dullness where they do not. None of that is visible as texture at
 * this camera distance; all of it is visible as a highlight that changes shape
 * along a part instead of sitting there as one even sheet. That difference is
 * most of what separates a render of a mount from a grey box the size of a
 * mount.
 *
 * WHY THIS IS SHADER CODE AND NOT A TEXTURE. The obvious implementation is a
 * generated roughness map. It was rejected for one concrete reason: a map is
 * addressed by UV, and the geometry that consumes these materials is being
 * written by a different builder against `geometry/profiles.ts`. A bevelled box
 * and a lathed barrel do not agree on what a UV means, and a per-face 0..1 UV
 * makes the grain on a 12-unit rail sixty times coarser than the grain on a
 * 0.2-unit screw head, which is exactly backwards. World position is
 * unambiguous, needs no UV channel, needs no texture memory, and gives the rail
 * and the screw the same physical grain size because the grain is defined in
 * the room's units rather than in the mesh's parameterisation.
 *
 * WHAT IT COSTS. Two octaves of value noise plus one broad octave, about
 * twenty-four hash evaluations per fragment, and the normal perturbation reuses
 * the height already computed via screen-space derivatives rather than sampling
 * the field three more times. There is no texture fetch and no texture upload.
 *
 * THE UPGRADE HAZARD, AND WHY THIS FAILS SOFT. The injection works by string
 * replacement against three's own shader chunks. `begin_vertex`,
 * `roughnessmap_fragment`, `metalnessmap_fragment` and `normal_fragment_maps`
 * are all present in the pinned three@0.185.1 and have been stable for years,
 * but a rename in some future version would turn a silent no-op into a silent
 * flat surface. So every replacement is checked, a missed marker warns loudly,
 * and `tests/scene/materials/chunks.test.mjs` asserts against the installed
 * package that all four markers still exist. A three upgrade that breaks this
 * fails a test rather than shipping a flat render.
 */
import type { Material } from "three";
import { Vector3, Vector4 } from "three";

/** How the field is shaped on one surface class. All lengths are world units. */
export interface VariationProfile {
  /**
   * Noise frequency per world unit, per axis. Equal components give an
   * isotropic grain, as bead blasting does. Unequal components stretch the
   * field along the low-frequency axis, which is how machining marks read: a
   * turned or milled face has its marks running one way and the specular
   * breaks up across them, not along them.
   *
   * THE FREQUENCY CEILING, which the first version of this file broke on every
   * surface. At the hero camera one world unit is 121 pixels. The field's
   * finest octave is 2.7 times `scale`, and a derivative bump amplifies
   * whatever is already close to the sampling rate, so a feature narrower than
   * about four pixels does not read as a finish, it reads as static. That puts
   * the ceiling at
   *
   *     scale <= 121 / (2.7 * 4) ~= 11 per world unit
   *
   * and the useful range at roughly 2 to 11. The first set ran from 23 to 64
   * and the study's first shoot came back with the aluminium post covered in
   * television snow. Anything above 11 needs a reason and a shoot.
   */
  scale: [number, number, number];
  /** Peak-to-peak roughness swing from the fine grain. */
  grain: number;
  /** Peak-to-peak roughness swing from the broad handling term. */
  wear: number;
  /** Peak-to-peak metalness swing. Small: this is oxide and contamination. */
  patina: number;
  /**
   * Height amplitude for the derivative bump, in the same arbitrary units the
   * surface gradient uses. Above about 0.02 the surface starts to read as
   * hammered rather than as blasted.
   */
  bump: number;
}

export const NO_VARIATION: VariationProfile = {
  scale: [1, 1, 1],
  grain: 0,
  wear: 0,
  patina: 0,
  bump: 0,
};

/**
 * Value noise, and the surface-gradient bump that reuses it.
 *
 * The hash is the standard fract-multiply construction. It is not a good
 * random number generator and does not need to be: it needs to be stable
 * across a frame, cheap, and free of an axis-aligned pattern at the
 * frequencies used here, and it is all three.
 */
const NOISE_GLSL = /* glsl */ `
varying vec3 vRlWorld;
uniform vec3 uRlScale;
uniform vec4 uRlAmp;   // x grain, y wear, z patina, w bump

float rlHash( vec3 p ) {
  p = fract( p * 0.3183099 + vec3( 0.1, 0.2, 0.3 ) );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}

float rlNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( rlHash( i + vec3( 0.0, 0.0, 0.0 ) ), rlHash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ),
         mix( rlHash( i + vec3( 0.0, 1.0, 0.0 ) ), rlHash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),
    mix( mix( rlHash( i + vec3( 0.0, 0.0, 1.0 ) ), rlHash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ),
         mix( rlHash( i + vec3( 0.0, 1.0, 1.0 ) ), rlHash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ),
    f.z );
}
`;

/** Declared in the vertex shader too, so the varying has a definition on both sides. */
const VERTEX_PARS_GLSL = /* glsl */ `
varying vec3 vRlWorld;
`;

/**
 * World position, computed the way three computes it, including the instancing
 * and batching matrices. The calibration ticks along the rail are instanced, so
 * reading `modelMatrix` alone would give every tick the same field and they
 * would all carry an identical grain in a row, which is the one arrangement the
 * eye picks out instantly.
 */
const VERTEX_BODY_GLSL = /* glsl */ `
vec4 rlWorld = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  rlWorld = batchingMatrix * rlWorld;
#endif
#ifdef USE_INSTANCING
  rlWorld = instanceMatrix * rlWorld;
#endif
vRlWorld = ( modelMatrix * rlWorld ).xyz;
`;

/**
 * The roughness term, the footprint fade, and where the height for the bump is
 * born.
 *
 * `rlHeight` is declared here and consumed three chunks later by the normal
 * perturbation. That is legal because both injections land in the same function
 * body, and it is deliberate: the bump costs nothing extra because the height
 * it needs has already been paid for by the roughness.
 *
 * THE FOOTPRINT FADE, AND THE SHOOT THAT FORCED IT. A texture gets this for
 * free from its mip chain; a procedural field has to do it by hand, and the
 * first version did not. Shoot 6 put the prop at the bench camera's scale and
 * the breadboard came back looking like crumpled foil: at grazing incidence a
 * pixel covers many cycles of the field, the two noise samples a pixel apart
 * are uncorrelated, and a derivative bump turns that into a shimmering mess
 * that would also crawl under any camera move. `rlFp` is how much of the field
 * one pixel spans, and once that approaches a cycle the fine octave and the
 * bump are faded out.
 *
 * The variance the fade removes is put back as roughness rather than simply
 * dropped. A surface whose micro-normals stop varying is a surface that has
 * become smoother, and letting a distant part of the same rail read as
 * polished while the near part reads as blasted is a worse artefact than the
 * shimmer. The 0.35 factor is not derived; it is what matched the near and far
 * ends of the rail on shoot 7.
 *
 * The broad octave is deliberately not faded. It runs at 0.17 of the base
 * frequency, so it is still well inside the sampling rate at any distance this
 * scene renders, and it is the term carrying the large-scale handling that
 * should survive all the way out.
 */
const ROUGHNESS_GLSL = /* glsl */ `
vec3 rlP = vRlWorld * uRlScale;
float rlFp = max( length( dFdx( rlP ) ), length( dFdy( rlP ) ) );
float rlFade = 1.0 - smoothstep( 0.22, 0.70, rlFp );
float rlFine = rlNoise( rlP ) * 0.62 + rlNoise( rlP * 2.7 ) * 0.38;
float rlBroad = rlNoise( rlP * 0.17 );
float rlHeight = ( rlFine - 0.5 ) * uRlAmp.w * rlFade;
roughnessFactor = clamp(
  roughnessFactor
    + ( rlFine - 0.5 ) * uRlAmp.x * rlFade
    + ( rlBroad - 0.5 ) * uRlAmp.y
    + ( 1.0 - rlFade ) * uRlAmp.x * 0.35,
  0.012, 1.0 );
`;

/**
 * Metalness moves too, and only just.
 *
 * A metal that is 1.0 everywhere is a metal with no oxide and no fingerprints
 * on it. The swing here is a few percent and it is tied to the broad term
 * rather than the fine one, because contamination is a large-scale event and
 * grain is a small-scale one.
 */
const METALNESS_GLSL = /* glsl */ `
metalnessFactor = clamp( metalnessFactor - ( rlBroad - 0.5 ) * uRlAmp.z, 0.0, 1.0 );
`;

/**
 * Surface-gradient bump mapping, from the height already computed.
 *
 * This is three's own `perturbNormalArb` written out rather than called,
 * because that helper only exists when `USE_BUMPMAP` is defined and defining it
 * would require a bump texture we do not have. The construction is Morten
 * Mikkelsen's: build the surface gradient from the screen-space derivatives of
 * the height and of the view position, and rotate the normal against it.
 *
 * It runs after `normal_fragment_maps` so it composes on top of a normal map if
 * one is ever added, and it leaves `nonPerturbedNormal` alone, which is what
 * the clearcoat layer and the IBL occlusion term read.
 */
const NORMAL_GLSL = /* glsl */ `
#if defined( RL_BUMP )
{
  vec3 rlSurf = - vViewPosition;
  vec3 rlSigmaX = dFdx( rlSurf );
  vec3 rlSigmaY = dFdy( rlSurf );
  float rlDhdx = dFdx( rlHeight );
  float rlDhdy = dFdy( rlHeight );
  vec3 rlR1 = cross( rlSigmaY, normal );
  vec3 rlR2 = cross( normal, rlSigmaX );
  float rlDet = dot( rlSigmaX, rlR1 );
  vec3 rlGrad = sign( rlDet ) * ( rlDhdx * rlR1 + rlDhdy * rlR2 );
  normal = normalize( abs( rlDet ) * normal - rlGrad );
}
#endif
`;

/** The four chunk markers this module patches. Asserted by a test. */
export const PATCHED_CHUNKS = [
  "#include <begin_vertex>",
  "#include <roughnessmap_fragment>",
  "#include <metalnessmap_fragment>",
  "#include <normal_fragment_maps>",
] as const;

/**
 * Program cache key.
 *
 * Every material this module touches receives the identical injected source
 * and differs only in its uniform values, so they may all share one compiled
 * program. Without an explicit key three would key on the material's own
 * parameters and could hand a patched material a program compiled for an
 * unpatched one. The version suffix exists so that editing the GLSL above
 * invalidates the key rather than reusing a stale program in a warm session.
 */
const CACHE_KEY = "rl-surface-variation-1";

function replaceOnce(source: string, marker: string, addition: string, where: string): string {
  if (!source.includes(marker)) {
    console.warn(
      `[scene/materials] three's "${marker}" chunk is missing from the ${where} shader; ` +
        `surface variation is disabled and this surface will render at constant roughness. ` +
        `The pinned three@0.185.1 has it, so this means the dependency moved.`,
    );
    return source;
  }
  return source.replace(marker, `${marker}\n${addition}`);
}

/**
 * Attach the variation field to a material.
 *
 * Mutates the material once, at construction, before any caller can see it.
 * `useSurface` calls this and then hands out a frozen-by-convention instance;
 * nothing calls it on a material that is already in use.
 */
export function applyVariation(material: Material, profile: VariationProfile): void {
  if (profile.grain === 0 && profile.wear === 0 && profile.patina === 0 && profile.bump === 0) {
    return;
  }

  const scale = new Vector3(...profile.scale);
  const amp = new Vector4(profile.grain, profile.wear, profile.patina, profile.bump);

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRlScale = { value: scale };
    shader.uniforms.uRlAmp = { value: amp };

    let vert = shader.vertexShader;
    vert = `${VERTEX_PARS_GLSL}\n${vert}`;
    vert = replaceOnce(vert, "#include <begin_vertex>", VERTEX_BODY_GLSL, "vertex");
    shader.vertexShader = vert;

    let frag = shader.fragmentShader;
    if (profile.bump > 0) frag = `#define RL_BUMP\n${frag}`;
    frag = `${NOISE_GLSL}\n${frag}`;
    frag = replaceOnce(frag, "#include <roughnessmap_fragment>", ROUGHNESS_GLSL, "fragment");
    frag = replaceOnce(frag, "#include <metalnessmap_fragment>", METALNESS_GLSL, "fragment");
    frag = replaceOnce(frag, "#include <normal_fragment_maps>", NORMAL_GLSL, "fragment");
    shader.fragmentShader = frag;
  };

  material.customProgramCacheKey = () =>
    `${CACHE_KEY}|${profile.bump > 0 ? "bump" : "flat"}`;
}

/**
 * The GLSL, exposed so a test can read it without a GPU.
 *
 * A test that only checked `onBeforeCompile !== undefined` would pass on a
 * function that does nothing. The suite compiles nothing, so it reads the
 * source it would have compiled and asserts the terms are present.
 */
export const VARIATION_SOURCE = {
  noise: NOISE_GLSL,
  vertexPars: VERTEX_PARS_GLSL,
  vertexBody: VERTEX_BODY_GLSL,
  roughness: ROUGHNESS_GLSL,
  metalness: METALNESS_GLSL,
  normal: NORMAL_GLSL,
} as const;
