import { Color, Matrix4, MeshStandardMaterial, Vector2, Vector3, type Camera } from "three";

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
 */
export const LAB_LAMP_COUNT = 12;

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
};

const declarations = /* glsl */ `
#define LAB_LAMPS ${LAB_LAMP_COUNT}
uniform vec3 labLampPosition[ LAB_LAMPS ];
uniform vec3 labLampDirection[ LAB_LAMPS ];
uniform vec3 labLampColor[ LAB_LAMPS ];
uniform float labLampRange[ LAB_LAMPS ];
uniform vec2 labLampCone[ LAB_LAMPS ];
`;

const loop = /* glsl */ `
for ( int i = 0; i < LAB_LAMPS; i ++ ) {
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
`;

/** Patch a room material. All patched materials share one program key and one uniform block. */
export function installLabLamps(material: MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <lights_pars_begin>", `#include <lights_pars_begin>\n${declarations}`)
      .replace("#include <lights_fragment_maps>", `${loop}\n#include <lights_fragment_maps>`);
  };
  material.customProgramCacheKey = () => "lab-lamps-v1";
  material.needsUpdate = true;
}

const view = new Matrix4();
const scratch = new Vector3();

/** Upload the lamps for this frame. Unused slots stay dark. */
export function updateLabLamps(lamps: readonly LabLamp[], camera: Camera) {
  view.copy(camera.matrixWorldInverse);
  for (let i = 0; i < LAB_LAMP_COUNT; i++) {
    const lamp = lamps[i];
    if (!lamp) { uniforms.labLampColor.value[i].setRGB(0, 0, 0); continue; }
    uniforms.labLampPosition.value[i].copy(lamp.position).applyMatrix4(view);
    uniforms.labLampDirection.value[i].copy(scratch.copy(lamp.direction).transformDirection(view));
    uniforms.labLampColor.value[i].copy(lamp.color).multiplyScalar(lamp.intensity);
    uniforms.labLampRange.value[i] = lamp.range;
    uniforms.labLampCone.value[i].copy(lamp.cone);
  }
}
