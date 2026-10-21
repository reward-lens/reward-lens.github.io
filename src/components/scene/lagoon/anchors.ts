export type AnchorPoint = readonly [number, number, number];
export type LagoonAnchors = Readonly<Record<string, AnchorPoint>>;
export interface LagoonBounds { min: AnchorPoint; max: AnchorPoint; }
export interface LagoonAssetData { anchors: LagoonAnchors; bounds: LagoonBounds; }

const REQUIRED = [
  "BEAM_ENTRY",
  "BEAM_AFTER_PRISM",
  "SPECIMEN_FOCUS",
  "DETECTOR_SPLIT",
  "DETECTOR_TOP",
  "DETECTOR_BOTTOM",
  "CAMERA_DESKTOP_TARGET",
  "CAMERA_MOBILE_TARGET",
] as const;

export class LagoonAnchorError extends Error {}

function asPoint(value: unknown, key: string): AnchorPoint {
  const candidate = Array.isArray(value) ? value :
    typeof value === "object" && value !== null && "position" in value
      ? (value as { position?: unknown }).position : null;
  if (!Array.isArray(candidate) || candidate.length !== 3 || !candidate.every(Number.isFinite)) {
    throw new LagoonAnchorError(`Invalid lagoon anchor ${key}`);
  }
  return [candidate[0], candidate[1], candidate[2]];
}

/** Accept the artist's compact map and the named-anchor object form. */
export function validateAnchors(value: unknown): LagoonAnchors {
  const raw = typeof value === "object" && value !== null && "anchors" in value
    ? (value as { anchors?: unknown }).anchors : value;
  if (typeof raw !== "object" || raw === null) throw new LagoonAnchorError("anchors.json is not an object");
  const anchors: Record<string, AnchorPoint> = {};
  for (const [key, point] of Object.entries(raw)) anchors[key] = asPoint(point, key);
  for (const key of REQUIRED) if (!anchors[key]) throw new LagoonAnchorError(`anchors.json lacks ${key}`);
  return anchors;
}

function boundsFrom(value: unknown, anchors: LagoonAnchors): LagoonBounds {
  if (typeof value === "object" && value !== null && "bounds" in value) {
    const bounds = (value as { bounds?: unknown }).bounds;
    if (typeof bounds === "object" && bounds !== null && "min" in bounds && "max" in bounds) {
      return { min: asPoint((bounds as { min: unknown }).min, "bounds.min"), max: asPoint((bounds as { max: unknown }).max, "bounds.max") };
    }
  }
  const points = Object.values(anchors);
  return { min: [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])), Math.min(...points.map((p) => p[2]))], max: [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1])), Math.max(...points.map((p) => p[2]))] };
}

export async function loadLagoonAssetData(signal?: AbortSignal): Promise<LagoonAssetData> {
  const response = await fetch("/lagoon/anchors.json", { signal, cache: "force-cache" });
  if (!response.ok) throw new LagoonAnchorError(`anchors.json returned ${response.status}`);
  const json = await response.json();
  const anchors = validateAnchors(json);
  return { anchors, bounds: boundsFrom(json, anchors) };
}
