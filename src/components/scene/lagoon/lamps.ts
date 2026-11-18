import { Color, Matrix4, MeshStandardMaterial, Vector2, Vector3, Vector4, type BufferGeometry, type Camera } from "three";

/**
 * Local lamps evaluated in one shader loop.
 *
 * The room's practicals and beam catches were twelve PointLights. Three
 * unrolls every light into every lit program, so each of the room's twenty-odd
 * programs carried twelve copies of the point-light BRDF, and on Mesa the
 * first visible frame spent seconds linking them. Here the same lamps run
 * through Three's own RE_Direct in a non-unrolled loop over uniform arrays:
 * the same physical response (inverse-square falloff with a cutoff, diffuse
 * and specular), a cone for the desk and gallery lamps, and one small block of
 * shader code however many lamps the room has.
 *
 * Positions and directions are uploaded in view space each frame, because the
 * lighting chunk works in view space. Lamps cast no shadows, as before.
 *
 * Sixteen slots: seven modelled practicals, four gallery soffit downlights and
 * five optical receivers. A slot whose anchor is missing stays dark.
 *
 * The beam itself is a line light: up to five segments (the main axis and the
 * two branches into the detector) light whatever lies near them, falling off
 * roughly as one over distance, the way a glowing tube does, and evaluated at
 * the closest point of each segment. The travelling pulse brightens the light
 * around its own arc length, so its glow moves along the bench with it.
 * Fragments outside the beam's bounding sphere skip the segment loop.
 *
 * The same patch reads baked ambient occlusion. The detailed room carries AO
 * in COLOR_0 (linear grey, not albedo). Where a mesh has it, the material is
 * flagged with LAB_BAKED_AO: the value darkens indirect diffuse at full
 * strength, as three's aoMap does, and direct diffuse at `labAoDirect`, so
 * contact creases stay legible under the key without blackening lit faces.
 * Reflections take only `labAoSpecular` of it. Per-vertex occlusion is too
 * coarse for a sharp reflection: a long beam has vertices only at its ends,
 * often inside the joint it meets, and their near-zero value would darken the
 * whole face. That is what turned the aluminium gantry charcoal at night.
 */
export const LAB_LAMP_COUNT = 16;
export const LAB_LINE_COUNT = 5;

export interface LabLamp {
  /** World position. */
  position: Vector3;
  /** World direction the cone points along; ignored when the lamp is omnidirectional. */
  direction: Vector3;
  color: Color;
  intensity: number;
  range: number;
  /** Cosines of the outer and inner cone angles; [-1, -1] is omnidirectional. */
  cone: Vector2;
}

export function makeLamp(position: readonly number[], color: string, range: number, cone?: { outer: number; inner: number; direction: readonly number[] }): LabLamp {
  return {
    position: new Vector3(position[0], position[1], position[2]),
    direction: cone ? new Vector3(...cone.direction).normalize() : new Vector3(0, -1, 0),
    color: new Color(color),
    intensity: 0,
    range,
    cone: cone ? new Vector2(Math.cos(cone.outer), Math.cos(cone.inner)) : new Vector2(-1, -1),
  };
}

const uniforms = {
  labLampPosition: { value: Array.from({ length: LAB_LAMP_COUNT }, () => new Vector3()) },
  labLampDirection: { value: Array.from({ length: LAB_LAMP_COUNT }, () => new Vector3(0, -1, 0)) },
  labLampColor: { value: Array.from({ length: LAB_LAMP_COUNT }, () => new Color(0, 0, 0)) },
  labLampRange: { value: Array.from({ length: LAB_LAMP_COUNT }, () => 1) },
  labLampCone: { value: Array.from({ length: LAB_LAMP_COUNT }, () => new Vector2(-1, -1)) },
  labAoDirect: { value: .35 },
  /** Lit slots are packed first; the loop stops at this count. */
  labLampCount: { value: 0 },
  labLineCount: { value: 0 },
  labAoSpecular: { value: .3 },
  labLineA: { value: Array.from({ length: LAB_LINE_COUNT }, () => new Vector3()) },
  labLineB: { value: Array.from({ length: LAB_LINE_COUNT }, () => new Vector3()) },
  labLineColor: { value: new Color(0, 0, 0) },
  labLineRange: { value: 1 },
  /** Arc length of the path at each segment's start (m). */
  labLineStart: { value: Array.from({ length: LAB_LINE_COUNT }, () => 0) },
  /** Pulse centre (arc length, m), inverse half-width (1/m) and peak gain over the steady light. */
  labLinePulse: { value: new Vector3(0, 1, 0) },
  /** View-space centre and radius of the sphere that holds every lit fragment. */
  labLineBounds: { value: new Vector4(0, 0, 0, 0) },
};

/** How strongly baked AO darkens direct diffuse light (indirect diffuse always takes it in full). */
export function setLabAoDirect(value: number) { uniforms.labAoDirect.value = value; }

const declarations = /* glsl */ `
#define LAB_LAMPS ${LAB_LAMP_COUNT}
uniform vec3 labLampPosition[ LAB_LAMPS ];
uniform vec3 labLampDirection[ LAB_LAMPS ];
uniform vec3 labLampColor[ LAB_LAMPS ];
uniform float labLampRange[ LAB_LAMPS ];
uniform vec2 labLampCone[ LAB_LAMPS ];
uniform float labAoDirect;
uniform float labAoSpecular;
uniform int labLampCount;
uniform int labLineCount;
#define LAB_LINES ${LAB_LINE_COUNT}
uniform vec3 labLineA[ LAB_LINES ];
uniform vec3 labLineB[ LAB_LINES ];
uniform vec3 labLineColor;
uniform float labLineRange;
uniform float labLineStart[ LAB_LINES ];
uniform vec3 labLinePulse;
uniform vec4 labLineBounds;
#ifdef LAB_BAKED_AO
varying float vLabAo;
#endif
`;

const vertexDeclarations = /* glsl */ `
#ifdef LAB_BAKED_AO
attribute vec3 color;
varying float vLabAo;
#endif
`;

const vertexAo = /* glsl */ `
#ifdef LAB_BAKED_AO
vLabAo = color.r;
#endif
`;

/** After three's own aomap chunk: geometry vectors and material are still in scope. */
const fragmentAo = /* glsl */ `
#ifdef LAB_BAKED_AO
float labAo = clamp( vLabAo, 0.0, 1.0 );
reflectedLight.indirectDiffuse *= labAo;
#if defined( USE_ENVMAP ) && defined( STANDARD )
reflectedLight.indirectSpecular *= mix( 1.0, computeSpecularOcclusion( saturate( dot( geometryNormal, geometryViewDir ) ), labAo, material.roughness ), labAoSpecular );
#endif
reflectedLight.directDiffuse *= mix( 1.0, labAo, labAoDirect );
#endif
`;

const loop = /* glsl */ `
for ( int i = 0; i < LAB_LAMPS; i ++ ) {
  if ( i >= labLampCount ) break;
  vec3 labToLamp = labLampPosition[ i ] - geometryPosition;
  float labDistance = length( labToLamp );
  if ( labDistance >= labLampRange[ i ] || dot( labLampColor[ i ], vec3( 1.0 ) ) <= 0.0 ) continue;
  IncidentLight labLight;
  labLight.direction = labToLamp / labDistance;
  float labCone = labLampCone[ i ].x < -0.5 ? 1.0 : getSpotAttenuation( labLampCone[ i ].x, labLampCone[ i ].y, dot( labLampDirection[ i ], - labLight.direction ) );
  labLight.color = labLampColor[ i ] * labCone * getDistanceAttenuation( labDistance, labLampRange[ i ], 2.0 );
  labLight.visible = true;
  RE_Direct( labLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
}
// The segment loop runs to a uniform count so the compiler keeps one copy of
// the lighting code instead of unrolling five: unrolled, it added a third to
// the room's shader link time on a cold load.
if ( labLineCount > 0 && distance( geometryPosition, labLineBounds.xyz ) < labLineBounds.w ) {
  for ( int i = 0; i < labLineCount; i ++ ) {
    vec3 labAB = labLineB[ i ] - labLineA[ i ];
    float labLength2 = dot( labAB, labAB );
    if ( labLength2 < 1e-6 ) continue;
    float labT = clamp( dot( geometryPosition - labLineA[ i ], labAB ) / labLength2, 0.0, 1.0 );
    vec3 labClosest = labLineA[ i ] + labAB * labT;
    vec3 labToLine = labClosest - geometryPosition;
    float labLineDistance = length( labToLine );
    if ( labLineDistance >= labLineRange ) continue;
    float labWindow = 1.0 - labLineDistance / labLineRange;
    IncidentLight labLight;
    labLight.direction = labToLine / max( labLineDistance, 1e-4 );
    // About 1/d, as from a glowing tube; the offset keeps the mounts the beam passes through from clipping white.
    float labPulse = ( labLineStart[ i ] + sqrt( labLength2 ) * labT - labLinePulse.x ) * labLinePulse.y;
    labLight.color = labLineColor * ( labWindow * labWindow / ( labLineDistance + 0.12 ) ) * ( 1.0 + labLinePulse.z * exp( - labPulse * labPulse ) );
    labLight.visible = true;
    RE_Direct( labLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  }
}
`;

/**
 * Mark a room material whose geometry carries baked AO in its colour
 * attribute. The attribute stops being albedo: vertexColors goes off and the
 * patch reads it through its own varying.
 */
export function enableBakedAo(material: MeshStandardMaterial, geometry: BufferGeometry) {
  if (!geometry.getAttribute("color")) return false;
  material.vertexColors = false;
  material.userData.labBakedAo = true;
  material.defines = { ...material.defines, LAB_BAKED_AO: "" };
  material.needsUpdate = true;
  return true;
}

/** Patch a room material. Patched materials share one uniform block and two program keys (with and without baked AO). */
export function installLabLamps(material: MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${vertexDeclarations}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${vertexAo}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <lights_pars_begin>", `#include <lights_pars_begin>\n${declarations}`)
      .replace("#include <lights_fragment_maps>", `${loop}\n#include <lights_fragment_maps>`)
      .replace("#include <aomap_fragment>", `#include <aomap_fragment>\n${fragmentAo}`);
  };
  material.customProgramCacheKey = () => material.userData.labBakedAo ? "lab-lamps-v7-ao" : "lab-lamps-v7";
  material.needsUpdate = true;
}

const view = new Matrix4();
const scratch = new Vector3();

/** Upload the lamps for this frame, lit ones packed first; dark slots cost the shader nothing. */
export function updateLabLamps(lamps: readonly LabLamp[], camera: Camera) {
  view.copy(camera.matrixWorldInverse);
  let slot = 0;
  for (let i = 0; i < Math.min(lamps.length, LAB_LAMP_COUNT); i++) {
    const lamp = lamps[i];
    if (!lamp || lamp.intensity <= 0) continue;
    uniforms.labLampPosition.value[slot].copy(lamp.position).applyMatrix4(view);
    uniforms.labLampDirection.value[slot].copy(scratch.copy(lamp.direction).transformDirection(view));
    uniforms.labLampColor.value[slot].copy(lamp.color).multiplyScalar(lamp.intensity);
    uniforms.labLampRange.value[slot] = lamp.range;
    uniforms.labLampCone.value[slot].copy(lamp.cone);
    slot++;
  }
  for (let i = slot; i < LAB_LAMP_COUNT; i++) uniforms.labLampColor.value[i].setRGB(0, 0, 0);
  uniforms.labLampCount.value = slot;
}

const centre = new Vector3();

/**
 * Upload the beam's segments as one line light. Segments come in world space
 * and go up in view space; a black colour switches the light off.
 */
export function updateLabLines(segments: ReadonlyArray<readonly [Vector3, Vector3]>, starts: ArrayLike<number>, color: Color, range: number, pulse: { at: number; width: number; gain: number }, camera: Camera) {
  view.copy(camera.matrixWorldInverse);
  const a = uniforms.labLineA.value, b = uniforms.labLineB.value;
  centre.set(0, 0, 0); let used = 0;
  for (let i = 0; i < LAB_LINE_COUNT; i++) {
    const segment = segments[i];
    if (!segment) { a[i].set(0, 0, 0); b[i].set(0, 0, 0); continue; }
    a[i].copy(segment[0]).applyMatrix4(view); b[i].copy(segment[1]).applyMatrix4(view);
    centre.add(a[i]).add(b[i]); used += 2;
  }
  if (used) centre.multiplyScalar(1 / used);
  let radius = 0;
  for (let i = 0; i < LAB_LINE_COUNT; i++) if (segments[i]) radius = Math.max(radius, centre.distanceTo(a[i]), centre.distanceTo(b[i]));
  uniforms.labLineBounds.value.set(centre.x, centre.y, centre.z, used ? radius + range : 0);
  uniforms.labLineColor.value.copy(color);
  uniforms.labLineCount.value = color.r + color.g + color.b > 0 ? Math.min(LAB_LINE_COUNT, segments.length) : 0;
  uniforms.labLineRange.value = range;
  for (let i = 0; i < LAB_LINE_COUNT; i++) uniforms.labLineStart.value[i] = starts[i] ?? 0;
  uniforms.labLinePulse.value.set(pulse.at, 1 / Math.max(.01, pulse.width), pulse.gain);
}
