/**
 * Reading the generated scene data.
 *
 * `scripts/build_scene_data.mjs` writes four things into `src/data/scene/`:
 * the manifest, the captions, a build digest, and one binary payload per case.
 * This module is the only sanctioned way to open the binary half. It exists so
 * that no component ever computes a byte offset, and so that the layout can
 * change behind one version number rather than behind a dozen call sites.
 *
 * WHAT A CONSUMER DOES.
 *
 *   import manifest from "../../data/scene/manifest.json";
 *   import url from "../../data/scene/payload/selection-advantages.bin?url";
 *   const payload = decodeScenePayload(await (await fetch(url)).arrayBuffer());
 *   const advantage = payload.f32("advantage");
 *
 * The array names are the names the source artifact uses, and every one of them
 * is named by an encoding in the same case's manifest entry. That is enforced at
 * generation in both directions: an encoding may not name an array that is not
 * in the payload, and a payload may not carry an array that no encoding draws.
 * So `manifest` answers what a number means and this module answers what it is,
 * and neither can be extended without the other noticing.
 *
 * THERE IS NO FALLBACK PATH HERE. A payload whose magic does not match, or whose
 * version this build does not know, throws. A scene that quietly rendered
 * something else would be showing invented geometry on a site whose entire
 * argument is provenance.
 */
import type {
  InstrumentStateId,
  SceneCase,
  SceneEncoding,
  SceneManifest,
} from "../../components/scene/types/truth";
import type { SceneTier } from "../../components/scene/runtime/tier";

/** ASCII tag in the first four bytes of every payload. */
export const SCENE_PAYLOAD_MAGIC = "RLS1";

/**
 * The binary container's version, which is not the manifest's.
 *
 * The manifest version changes when the case inventory or the meaning of a
 * field changes. This one changes only when the bytes are laid out differently,
 * which is the thing a cached still would be wrong about.
 */
export const SCENE_PAYLOAD_FORMAT_VERSION = 1;

/** Where a case's payload sits, relative to `src/data/scene/`. */
export function scenePayloadPath(caseId: string): string {
  return `payload/${caseId}.bin`;
}

export type SceneArrayType = "f32" | "i32";

/** One array's entry in the payload header. Offsets are relative to the data section. */
export interface SceneArrayDescriptor {
  name: string;
  dtype: SceneArrayType;
  length: number;
  byteOffset: number;
  byteLength: number;
}

export interface ScenePayload {
  caseId: string;
  formatVersion: number;
  descriptors: SceneArrayDescriptor[];
  /** Every array, by the name the source artifact gives the quantity. */
  arrays: Map<string, Float32Array | Int32Array>;
  /** A float array, or a throw naming what was actually in the payload. */
  f32(name: string): Float32Array;
  /** An integer array, or a throw naming what was actually in the payload. */
  i32(name: string): Int32Array;
}

const decoder = new TextDecoder();

/**
 * Decode one case's payload.
 *
 *   0..3    magic "RLS1"
 *   4..7    uint32  format version
 *   8..11   uint32  header length in bytes
 *   12..    header JSON, zero padded to an 8-byte boundary
 *   then    the arrays in header order, each on an 8-byte boundary
 *
 * The 8-byte alignment is what lets the typed arrays be views onto the original
 * buffer rather than copies of it, which matters at the tier where a payload is
 * decoded on the frame budget rather than ahead of it.
 */
export function decodeScenePayload(input: ArrayBuffer | Uint8Array): ScenePayload {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const buffer = bytes.buffer;
  const base = bytes.byteOffset;
  if (bytes.byteLength < 12) {
    throw new Error(`scene payload is ${bytes.byteLength} bytes; the header alone is 12`);
  }
  const view = new DataView(buffer, base, bytes.byteLength);
  const magic = decoder.decode(bytes.subarray(0, 4));
  if (magic !== SCENE_PAYLOAD_MAGIC) {
    throw new Error(
      `scene payload magic is ${JSON.stringify(magic)} and not ${JSON.stringify(SCENE_PAYLOAD_MAGIC)}. ` +
        `This is not a payload written by scripts/build_scene_data.mjs, and there is no fallback: ` +
        `a scene that rendered something else here would be drawing geometry with nothing behind it.`,
    );
  }
  const formatVersion = view.getUint32(4, true);
  if (formatVersion !== SCENE_PAYLOAD_FORMAT_VERSION) {
    throw new Error(
      `scene payload is format version ${formatVersion} and this build reads ${SCENE_PAYLOAD_FORMAT_VERSION}. ` +
        `Regenerate with npm run build:scene-data.`,
    );
  }
  const headerLength = view.getUint32(8, true);
  const header = JSON.parse(decoder.decode(bytes.subarray(12, 12 + headerLength))) as {
    caseId: string;
    arrays: SceneArrayDescriptor[];
  };
  const dataStart = align8(12 + headerLength);

  const arrays = new Map<string, Float32Array | Int32Array>();
  for (const d of header.arrays) {
    const at = base + dataStart + d.byteOffset;
    arrays.set(
      d.name,
      d.dtype === "f32" ? new Float32Array(buffer, at, d.length) : new Int32Array(buffer, at, d.length),
    );
  }

  const take = (name: string): Float32Array | Int32Array => {
    const found = arrays.get(name);
    if (!found) {
      throw new Error(
        `scene payload ${header.caseId} has no array named ${JSON.stringify(name)}. It carries: ` +
          `${[...arrays.keys()].join(", ")}`,
      );
    }
    return found;
  };

  return {
    caseId: header.caseId,
    formatVersion,
    descriptors: header.arrays,
    arrays,
    f32(name) {
      const found = take(name);
      if (!(found instanceof Float32Array)) throw new Error(`${name} in ${header.caseId} is an integer array`);
      return found;
    },
    i32(name) {
      const found = take(name);
      if (!(found instanceof Int32Array)) throw new Error(`${name} in ${header.caseId} is a float array`);
      return found;
    },
  };
}

const align8 = (n: number): number => n + ((8 - (n % 8)) % 8);

/**
 * The subset of records a tier draws, or null when the tier draws all of them.
 *
 * The selection is a uniform stride with the first and last record kept, chosen
 * at generation and shipped rather than recomputed here, so the still, the SVG
 * fallback and the live canvas all decimate identically. `SceneEncoding.
 * downsample` on the encoding that reads the array records the method, the
 * input count and the output count.
 */
export function sceneDrawIndex(
  payload: ScenePayload,
  family: "step" | "series" | "component",
  tier: SceneTier,
): Int32Array | null {
  if (tier === "high" || tier === "still") return null;
  const name = `drawIndex.${family}.${tier}`;
  const found = payload.arrays.get(name);
  return found instanceof Int32Array ? found : null;
}

/** The case with this id, or a throw. Components address cases by id, never by index. */
export function sceneCaseById(manifest: SceneManifest, id: string): SceneCase {
  const found = manifest.cases.find((c) => c.id === id);
  if (!found) {
    throw new Error(`no scene case with the id ${JSON.stringify(id)}. The manifest holds: ${manifest.cases.map((c) => c.id).join(", ")}`);
  }
  return found;
}

/** Every case bound to a state, in manifest order. */
export function sceneCasesForState(manifest: SceneManifest, state: InstrumentStateId): SceneCase[] {
  return manifest.cases.filter((c) => c.state === state);
}

/**
 * The encoding that drives one visual property, or a throw.
 *
 * A component asking for a property nobody declared is the case this catches:
 * it means a number reached the geometry without passing through the manifest,
 * which is the one thing the manifest exists to make difficult.
 */
export function sceneEncodingFor(sceneCase: SceneCase, visualProperty: string): SceneEncoding {
  const found = sceneCase.encodings.find((e) => e.visualProperty === visualProperty);
  if (!found) {
    throw new Error(
      `case ${sceneCase.id} declares no encoding for ${JSON.stringify(visualProperty)}. ` +
        `It declares: ${sceneCase.encodings.map((e) => e.visualProperty).join(", ") || "nothing, because it is schematic"}`,
    );
  }
  return found;
}

/**
 * Map a recorded value onto the unit interval using the encoding's own domain.
 *
 * This is the one arithmetic helper here, and it is deliberately the only one.
 * Every transform in the manifest is written as a linear map from a stated
 * domain onto a stated visual property, so the shared part is this and the
 * remainder is the geometry's own scale. `clamp` is obeyed rather than assumed:
 * an encoding that says it does not clamp returns values outside the interval,
 * which is how the largest patching movement stays the size it was measured at.
 */
export function sceneNormalize(encoding: SceneEncoding, value: number): number {
  const domain = encoding.domain;
  if (!domain) return value;
  const [lo, hi] = domain;
  const span = hi - lo;
  const t = span === 0 ? 0 : (value - lo) / span;
  if (!encoding.clamp) return t;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** The generated caption for a case, keyed by case id, as captions.json holds them. */
export interface SceneCaption {
  text: string;
  /** The numbers the sentence uses, so a component can bind one without retyping it. */
  values: Record<string, number | string>;
}

export interface SceneCaptionFile {
  note: string;
  generatedBy: string;
  captions: Record<string, SceneCaption>;
}
