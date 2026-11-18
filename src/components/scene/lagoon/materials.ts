import { Material, MeshPhysicalMaterial, MeshStandardMaterial } from "three";
import { installLabLamps } from "./lamps";

/**
 * Runtime finishing for the room's material families.
 *
 * The exported room keeps its authored base colours and maps; this table only
 * sets how each family answers light: how metallic and rough it is, how
 * strongly it reflects the studio environment, how see-through its glass is,
 * and which families glow. Keys are material-name prefixes after Blender's
 * ".001" suffix is removed. The longest matching prefix wins, so
 * SPECIMEN_Glass_Edge never falls into SPECIMEN_Glass and the current
 * CERAMIC_Pale_*_AO variants still read as CERAMIC_Pale.
 */
export interface MaterialFinish {
  metalness?: number;
  roughness?: number;
  envMapIntensity?: number;
  /** Authored colour override, sRGB. */
  color?: string;
  /** Roughness used instead of `roughness` when the material carries a manufactured roughness map. */
  mappedRoughness?: number;
  /** Rendered as thin, see-through glass: reflections and edges, no transmission pass. */
  glass?: { opacity: number; color?: string; ior?: number };
  /** Theme-driven glow. Intensities are emissiveIntensity by day and by night. */
  emissive?: { color: string; day: number; night: number };
  clearcoat?: { value: number; roughness: number };
  /** envMapIntensity multiplier at night: the room's light drops, its metal and glass still catch the studio. */
  nightEnv?: number;
}

export const MATERIAL_FINISHES: Readonly<Record<string, MaterialFinish>> = {
  // Architecture
  MARBLE_Floor: { metalness: 0, roughness: .2, envMapIntensity: .55, clearcoat: { value: .35, roughness: .12 } },
  CERAMIC_Pale: { color: "#b8c4c0", metalness: 0, roughness: .31, envMapIntensity: .26 },
  CERAMIC_Pale_OPTICAL_BENCH: { color: "#b8c4c0", metalness: 0, roughness: .31, envMapIntensity: .3, mappedRoughness: .6 },
  PETROL_Painted: { metalness: .035, roughness: .52, envMapIntensity: .38 },
  PETROL_Trim: { metalness: .05, roughness: .4, envMapIntensity: .5 },
  PETROL_Deep: { metalness: .03, roughness: .6, envMapIntensity: .3 },
  // Metals: the studio's strip boxes draw their long highlights here.
  ALUMINIUM_Brushed: { metalness: .9, roughness: .26, envMapIntensity: 1.2, nightEnv: 2 },
  STEEL_Polished: { metalness: 1, roughness: .09, envMapIntensity: 1.35, nightEnv: 2.2 },
  BRASS_Restrained: { metalness: .88, roughness: .24, envMapIntensity: 1.1, nightEnv: 1.8 },
  CHARCOAL_Instrument: { metalness: .64, roughness: .23, envMapIntensity: .92, nightEnv: 2.2 },
  OPTICAL_TABLE_Top: { metalness: .55, roughness: .34, envMapIntensity: .85, nightEnv: 1.6 },
  SPLITTER_HalfMirror: { metalness: .92, roughness: .05, envMapIntensity: 1.5, nightEnv: 1.6 },
  // Soft goods and props
  RUBBER_Black: { metalness: 0, roughness: .86, envMapIntensity: .2 },
  TEAL_Upholstery: { metalness: 0, roughness: .78, envMapIntensity: .24 },
  POT_Concrete: { metalness: 0, roughness: .9, envMapIntensity: .2 },
  POT_Ceramic: { metalness: 0, roughness: .34, envMapIntensity: .45, clearcoat: { value: .4, roughness: .2 } },
  SOIL_Dark: { metalness: 0, roughness: 1, envMapIntensity: .1 },
  PLANT_Leaf: { metalness: 0, roughness: .55, envMapIntensity: .35 },
  PLANT_Stem: { metalness: 0, roughness: .7, envMapIntensity: .25 },
  BOOK_: { metalness: 0, roughness: .72, envMapIntensity: .24 },
  PRINT_Art: { metalness: 0, roughness: .62, envMapIntensity: .3 },
  // Instruments
  SPECIMEN_Pattern: { metalness: 0, roughness: .48, envMapIntensity: .35 },
  SOURCE_APERTURE: { roughness: .3, envMapIntensity: .8 },
  DETECTOR_RECEIVER: { roughness: .3, envMapIntensity: .8 },
  DETECTOR_Enamel: { metalness: .08, roughness: .28, envMapIntensity: .6, clearcoat: { value: .6, roughness: .1 }, nightEnv: 1.8 },
  LENS_Coated: { metalness: .2, roughness: .05, envMapIntensity: 1.6, nightEnv: 1.6 },
  // Glass and liquid
  GLASS_Clear: { metalness: 0, roughness: .04, envMapIntensity: 2.2, glass: { opacity: .22, ior: 1.5 }, nightEnv: 1.5 },
  PRISM_Glass: { metalness: 0, roughness: .035, envMapIntensity: 2.4, glass: { opacity: .46, color: "#d6f0ea", ior: 1.5 }, nightEnv: 1.5 },
  SPECIMEN_Glass: { roughness: .16, glass: { opacity: .34 } },
  SPECIMEN_Glass_Edge: { roughness: .06, envMapIntensity: 1.8 },
  SPLITTER_Glass: { metalness: 0, roughness: .03, envMapIntensity: 2.2, glass: { opacity: .38, ior: 1.5 } },
  FILTER_Glass: { metalness: 0, roughness: .05, envMapIntensity: 1.8, glass: { opacity: .42 } },
  LIQUID_Teal: { metalness: 0, roughness: .05, envMapIntensity: 1.6, glass: { opacity: .58, ior: 1.33 } },
  // Emissive families: brighter at night, collected for the theme blend.
  APRICOT_Task_Light: { roughness: .26, emissive: { color: "#e8a965", day: 1.1, night: 2.6 } },
  DISPLAY_Lightbox: { roughness: .4, envMapIntensity: .3, emissive: { color: "#f6efe0", day: .55, night: 1.5 } },
  SCREEN_Display: { metalness: 0, roughness: .12, envMapIntensity: .7, emissive: { color: "#bfe6df", day: .5, night: 1.3 } },
};

const PREFIXES = Object.keys(MATERIAL_FINISHES).sort((a, b) => b.length - a.length);

/** Blender appends ".001"; the receiver binding appends "_TOP"/"_BOTTOM" after it. */
export function materialFamily(name: string): string | null {
  const base = name.replace(/\.\d+/g, "");
  return PREFIXES.find(prefix => base.startsWith(prefix)) ?? null;
}

/** Day and night values the scene blends with the theme: emissiveIntensity and envMapIntensity. */
export interface ThemeBinding { material: MeshStandardMaterial; emissive: readonly [number, number] | null; env: readonly [number, number] | null; }

/**
 * Apply the family finish and install the shared lamp/AO shader patch.
 * Returns the theme binding when the family glows or brightens its reflections at night.
 */
export function tuneRoomMaterial(material: Material): ThemeBinding | null {
  if (!(material instanceof MeshStandardMaterial)) return null;
  const family = materialFamily(material.name);
  const finish = family ? MATERIAL_FINISHES[family] : undefined;
  if (finish?.color) material.color.set(finish.color);
  if (finish?.metalness !== undefined) material.metalness = finish.metalness;
  if (finish?.roughness !== undefined) material.roughness = finish.roughness;
  if (finish?.envMapIntensity !== undefined) material.envMapIntensity = finish.envMapIntensity;
  if (finish?.clearcoat && material instanceof MeshPhysicalMaterial) { material.clearcoat = finish.clearcoat.value; material.clearcoatRoughness = finish.clearcoat.roughness; }
  // Glass reads through its reflections and edges rather than a transmission
  // pass. That pass redrew the whole room every frame and doubled the
  // programs to link before the first frame.
  const physical = material as MeshStandardMaterial & { transmission?: number };
  const transmissive = Number(physical.transmission ?? 0) > 0;
  if (transmissive) physical.transmission = 0;
  if (finish?.glass) {
    if (finish.glass.color) material.color.set(finish.glass.color);
    material.opacity = transmissive || material.transparent ? Math.min(finish.glass.opacity, material.opacity) : finish.glass.opacity;
    material.transparent = true; material.depthWrite = false;
    if (material instanceof MeshPhysicalMaterial) { if (finish.glass.ior) material.ior = finish.glass.ior; material.specularIntensity = 1; }
  } else if (transmissive) {
    material.roughness = Math.min(material.roughness, .08); material.envMapIntensity = Math.max(material.envMapIntensity, 1.8);
    material.opacity = .42; material.transparent = true; material.depthWrite = false;
  }
  // Exported manufacture maps contain the absolute roughness response. They
  // must not be multiplied by a second family roughness value.
  if (material.roughnessMap) material.roughness = finish?.mappedRoughness ?? 1;
  let binding: ThemeBinding | null = null;
  if (finish?.emissive) {
    if (material.emissive.getHex() === 0 || !material.emissiveMap) material.emissive.set(finish.emissive.color);
    material.emissiveIntensity = finish.emissive.day;
  }
  if (finish?.emissive || finish?.nightEnv) {
    binding = {
      material,
      emissive: finish.emissive ? [finish.emissive.day, finish.emissive.night] : null,
      env: finish.nightEnv ? [material.envMapIntensity, material.envMapIntensity * finish.nightEnv] : null,
    };
  }
  installLabLamps(material);
  material.needsUpdate = true;
  return binding;
}
