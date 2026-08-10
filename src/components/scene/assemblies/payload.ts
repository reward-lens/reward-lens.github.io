/**
 * The recorded arrays, read by the geometry that draws them.
 *
 * `SCENE.md` §5's rule is the one that matters and it is kept here: everything
 * the scene shows comes from a file generated at build time, and if the file is
 * missing or its magic does not match, the scene does not render. It does not
 * fall back to synthetic data. A scene showing invented numbers on a site whose
 * thesis is provenance would be the worst single defect this design could ship.
 *
 * `scripts/build_scene_data.mjs` is the generator and it is not this packet's.
 * This module only reads what it wrote. The format is self-describing: a magic,
 * a version, a JSON header naming every array with its dtype, length and byte
 * offset, then the arrays. So a reader never carries a table of offsets, which
 * is the difference from the layout the old scene design specified: that one
 * hard-coded six bands and four hundred steps into the format itself, and the
 * truthful data does not have that shape.
 *
 * ------------------------------------------------------------------------
 * WHY A FETCH AND NOT AN IMPORT
 * ------------------------------------------------------------------------
 *
 * `?url` asks Vite to emit the file as a build asset and hand back its hashed
 * path, which is the only import form that works for an extension Vite does not
 * treat as an asset by default. The alternative, inlining 55 KB of base64 into
 * the scene chunk, would put the payloads on the critical path of a chunk that
 * is already the largest thing the page loads, to save one same-origin request
 * for a file the browser caches immutably.
 *
 * The cost is that the arrays arrive asynchronously, and that is paid with a
 * Suspense boundary around the data-driven assemblies only, never around the
 * whole tree. The room, the source and the render pipeline must draw on the
 * first frame whatever the network is doing, because `data-scene-ready` is what
 * fades the canvas in over the hand-authored room and what gate 26 waits for.
 */
import scoreTreeUrl from "../../../data/scene/payload/scorer-score-tree.bin?url";
import advantagesUrl from "../../../data/scene/payload/selection-advantages.bin?url";
import updateStepUrl from "../../../data/scene/payload/update-step.bin?url";
import runSeriesUrl from "../../../data/scene/payload/run-boundary-series.bin?url";

/** The cases this packet's assemblies bind to. Others exist; these are drawn. */
export type PayloadId =
  | "scorer-score-tree"
  | "selection-advantages"
  | "update-step"
  | "run-boundary-series";

const URLS: Record<PayloadId, string> = {
  "scorer-score-tree": scoreTreeUrl,
  "selection-advantages": advantagesUrl,
  "update-step": updateStepUrl,
  "run-boundary-series": runSeriesUrl,
};

/** "RLS1", little-endian, as the generator writes it. */
const MAGIC = 0x31534c52;
const FORMAT_VERSION = 1;

interface ArrayDescriptor {
  name: string;
  dtype: "f32" | "i32";
  length: number;
  byteOffset: number;
  byteLength: number;
}

/**
 * One case's arrays, keyed by the name the generator gave them, which is the
 * name the manifest's encodings name as their `quantity`.
 *
 * The two are the same string on purpose: an encoding that says
 * `RolloutRay.lateralOffset <- advantage` is checkable against this map, and
 * `tests/scene/assemblies/` does check it.
 */
export interface ScenePayload {
  caseId: string;
  arrays: Record<string, Float32Array | Int32Array>;
}

function decode(caseId: string, bytes: ArrayBuffer): ScenePayload {
  const view = new DataView(bytes);
  if (bytes.byteLength < 12) {
    throw new Error(`[scene/payload] "${caseId}" is ${bytes.byteLength} bytes; it cannot be a payload`);
  }
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error(
      `[scene/payload] "${caseId}" has magic 0x${magic.toString(16)}, not RLS1. ` +
        "The scene does not draw a file it cannot identify.",
    );
  }
  const version = view.getUint32(4, true);
  if (version !== FORMAT_VERSION) {
    throw new Error(
      `[scene/payload] "${caseId}" is payload format ${version} and this reader is ${FORMAT_VERSION}. ` +
        "Rebuild with scripts/build_scene_data.mjs rather than reading it anyway.",
    );
  }
  const headerLength = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 12, headerLength))) as {
    caseId: string;
    arrays: ArrayDescriptor[];
  };
  if (header.caseId !== caseId) {
    throw new Error(
      `[scene/payload] asked for "${caseId}" and the file says it is "${header.caseId}"`,
    );
  }

  // The generator pads the header to an 8-byte boundary and starts every array
  // on one. Recomputing the same alignment here rather than trusting a stored
  // absolute offset is what keeps the two ends honest about the same rule.
  const dataStart = align(12 + headerLength);
  const arrays: Record<string, Float32Array | Int32Array> = {};
  for (const d of header.arrays) {
    const at = dataStart + d.byteOffset;
    arrays[d.name] =
      d.dtype === "f32"
        ? new Float32Array(bytes, at, d.length)
        : new Int32Array(bytes, at, d.length);
  }
  return { caseId, arrays };
}

const ALIGNMENT = 8;
const align = (n: number) => n + ((ALIGNMENT - (n % ALIGNMENT)) % ALIGNMENT);

/* ------------------------------------------------------------------------- *
 * The resource, in the shape Suspense reads
 * ------------------------------------------------------------------------- */

type Entry =
  | { status: "pending"; promise: Promise<void> }
  | { status: "ready"; value: ScenePayload }
  | { status: "failed"; error: Error };

const entries = new Map<PayloadId, Entry>();

/**
 * The payload for a case, or a thrown promise while it is on its way.
 *
 * The classic Suspense resource rather than React 19's `use`, because this is
 * called from inside an R3F tree where the same module is also read by the
 * tests under `node --test`, and a resource that is a plain function works in
 * both. A component that calls this must be inside a `<Suspense>` boundary that
 * does NOT contain the render pipeline; see the note at the top of the file.
 */
export function readPayload(id: PayloadId): ScenePayload {
  const existing = entries.get(id);
  if (existing?.status === "ready") return existing.value;
  if (existing?.status === "failed") throw existing.error;
  if (existing?.status === "pending") throw existing.promise;

  const promise = fetch(URLS[id])
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`[scene/payload] "${id}" fetched ${response.status} from ${URLS[id]}`);
      }
      const value = decode(id, await response.arrayBuffer());
      entries.set(id, { status: "ready", value });
    })
    .catch((error: unknown) => {
      entries.set(id, {
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    });

  entries.set(id, { status: "pending", promise });
  throw promise;
}

/** Hands a decoded payload straight in. For the tests, which have no network. */
export function primePayload(id: PayloadId, value: ScenePayload): void {
  entries.set(id, { status: "ready", value });
}

/** Decodes a buffer without fetching it. For the tests and for a future still. */
export function decodePayload(caseId: string, bytes: ArrayBuffer): ScenePayload {
  return decode(caseId, bytes);
}

/** Drops every cached payload. Called by the scene root on unmount. */
export function disposePayloads(): void {
  entries.clear();
}

/* ------------------------------------------------------------------------- *
 * Reading one array, with the failure stated rather than defaulted
 * ------------------------------------------------------------------------- */

/**
 * One named array, or an error naming what the file does hold.
 *
 * A missing array is a build error rather than an empty draw, for the same
 * reason a bad magic is. The alternative is a band of width zero and a caption
 * that still says what it was supposed to be.
 */
export function column(payload: ScenePayload, name: string): Float32Array | Int32Array {
  const found = payload.arrays[name];
  if (!found) {
    throw new Error(
      `[scene/payload] "${payload.caseId}" has no array "${name}". It has: ` +
        Object.keys(payload.arrays).join(", "),
    );
  }
  return found;
}

/** One scalar, from an array the generator wrote as a length-one column. */
export function scalar(payload: ScenePayload, name: string): number {
  const found = column(payload, name);
  if (found.length < 1) throw new Error(`[scene/payload] "${name}" is empty`);
  return found[0];
}

/**
 * The indices to draw at this tier.
 *
 * The generator ships `drawIndex.<axis>.mid` and `.low` beside every long
 * series: a pre-computed, deterministic subsample, so the low tier draws the
 * same points every session and the same points the still would. Choosing them
 * at runtime would make two sessions disagree about which recorded values they
 * showed, which is a quieter version of inventing them.
 */
export function drawIndices(
  payload: ScenePayload,
  axis: string,
  tier: "high" | "mid" | "low" | "still",
  fullLength: number,
): ArrayLike<number> {
  if (tier === "high") return identity(fullLength);
  const found = payload.arrays[`drawIndex.${axis}.${tier === "still" ? "low" : tier}`];
  return found ?? identity(fullLength);
}

/* ------------------------------------------------------------------------- *
 * The two transforms every encoding goes through
 * ------------------------------------------------------------------------- */

/**
 * A column's own range, so nothing is normalised against a constant.
 *
 * A hard-coded domain is the quiet way a drawn value stops being the recorded
 * one: the record moves, the divisor does not, and the geometry keeps looking
 * plausible. `NaN` is skipped rather than propagated, because one payload
 * genuinely carries one: `detectors.alarmStep` is `[70, NaN, 90, 133]`, and the
 * NaN is the signal whose alarm step is null, which is a real result rather
 * than a hole in the file.
 */
export function extent(values: ArrayLike<number>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return [0, 1];
  return [lo, hi === lo ? lo + 1 : hi];
}

/** Into [0, 1] against a stated domain, clamped at both ends. */
export function normalise(value: number, [lo, hi]: readonly [number, number]): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}

const identities = new Map<number, Int32Array>();
function identity(n: number): Int32Array {
  const hit = identities.get(n);
  if (hit) return hit;
  const made = new Int32Array(n);
  for (let i = 0; i < n; i += 1) made[i] = i;
  identities.set(n, made);
  return made;
}
