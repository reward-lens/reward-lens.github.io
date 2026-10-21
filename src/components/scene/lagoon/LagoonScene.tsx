import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { ACESFilmicToneMapping, AdditiveBlending, Box3, BoxGeometry, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, InstancedMesh, Matrix4, Quaternion, Material, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PCFShadowMap, PerspectiveCamera, PMREMGenerator, PlaneGeometry, SphereGeometry, Sprite, SpriteMaterial, Texture, Vector3, type Camera } from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { installLabLamps, makeLamp, updateLabLamps, type LabLamp } from "./lamps";
import { makeStudioScene } from "./studio";
import type { LagoonTheme, InstrumentStage } from "../rebuild/instrument-data";
import { loadLagoonAssetData, type LagoonAnchors, type LagoonBounds } from "./anchors";
import { PulseCadence } from "./cadence.mjs";
import { LAGOON_LIGHTS, LAGOON_PRACTICALS, LAGOON_PRESETS, LAGOON_QUALITY, lagoonView } from "./presets";
import { LabMotion } from "./motion.mjs";

export interface LagoonRenderMetrics {
  drawCalls: number; triangles: number; frames: number; signature: string;
  anchors: Array<{ id: string; normalized: [number, number] }>;
  compiledAt: number; paintedAt: number;
  framing: { x: number; y: number; width: number; height: number };
  cadence?: CadenceSnapshot;
  pulseCompletedAt?: number;
  cameraPosition?: number[];
  themeProgress?: number;
  introProgress?: number;
  opticalStrength?: number;
  opticalPhase?: number;
  opticalTravel?: number;
  motionPhase?: string;
  motionAction?: string;
  motionPose?: Record<string, number>;
  nextWakeAt?: number | null;
  activeFrames?: number;
  restFrames?: number;
  endpoints?: Record<string, [number, number, number]>;
  motionSettled?: boolean;
}
type CadenceTier = "full" | "reduced" | "compact";
interface CadenceSnapshot { source: string; tier: CadenceTier; startedAt: number | null; completedAt: number | null; nominalHz: number; callbackIntervalsMs: number[]; callbackCount: number; missedIntervals: number; badWindows: number; stepdowns: number; }
export interface MaterialBaseline { transmission?: number; thickness?: number; opacity: number; transparent: boolean; depthWrite: boolean; }
type MeshoptModule = { MeshoptDecoder: Parameters<GLTFLoader["setMeshoptDecoder"]>[0] };
const MESHOPT_DECODER_URL = "/lagoon/meshopt_decoder.module.js";

/**
 * Vite serves public assets but rejects them as source-module imports in DEV.
 * Development therefore imports the exact fetched public decoder bytes through
 * a temporary blob URL. Production keeps the direct public module request.
 */
export async function loadMeshoptDecoder(signal?: AbortSignal): Promise<MeshoptModule> {
  if (!import.meta.env.DEV) return import(/* @vite-ignore */ MESHOPT_DECODER_URL) as Promise<MeshoptModule>;
  const response = await fetch(MESHOPT_DECODER_URL, { signal, cache: "force-cache" });
  if (!response.ok) throw new Error(`Laboratory decoder returned ${response.status}`);
  const source = await response.text();
  if (signal?.aborted) throw signal.reason ?? new DOMException("Decoder request aborted", "AbortError");
  const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    const module = await import(/* @vite-ignore */ blobUrl) as MeshoptModule;
    if (!module.MeshoptDecoder) throw new Error("Laboratory decoder module did not export MeshoptDecoder");
    return module;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/** Lower tiers only simplify originally transmissive glass, never painted architecture. */
export function applyMaterialQuality(material: Material & { transmission?: number; thickness?: number }, baseline: MaterialBaseline, quality: CadenceTier) {
  if (quality === "full" || !(baseline.transmission && baseline.transmission > 0)) {
    if (baseline.transmission !== undefined) material.transmission = baseline.transmission;
    if (baseline.thickness !== undefined) material.thickness = baseline.thickness;
    material.opacity = baseline.opacity; material.transparent = baseline.transparent; material.depthWrite = baseline.depthWrite;
  } else {
    material.transmission = 0; if (material.thickness !== undefined) material.thickness = 0;
    material.opacity = .46; material.transparent = true; material.depthWrite = false;
  }
  material.needsUpdate = true;
}

/** Runtime finishing keeps the authored palette but gives each material family a readable response. */
function tuneRoomMaterial(material: Material) {
  if (!(material instanceof MeshStandardMaterial)) return;
  const name = material.name;
  if (/CERAMIC_Pale/.test(name)) material.color.set("#b8c4c0");
  if (/ALUMINIUM_Brushed/.test(name)) { material.metalness = .86; material.roughness = .24; material.envMapIntensity = 1.18; }
  else if (/CHARCOAL_Instrument/.test(name)) { material.metalness = .64; material.roughness = .23; material.envMapIntensity = .92; }
  else if (/BRASS_Restrained/.test(name)) { material.metalness = .84; material.roughness = .25; material.envMapIntensity = 1.05; }
  else if (/PETROL_Painted/.test(name)) { material.metalness = .035; material.roughness = .52; material.envMapIntensity = .38; }
  else if (/CERAMIC_Pale/.test(name)) { material.metalness = 0; material.roughness = .31; material.envMapIntensity = .26; }
  else if (/APRICOT_Task_Light/.test(name)) { material.emissive.set("#e8a965"); material.emissiveIntensity = 1.1; material.roughness = .26; }
  // Glass reads through its reflections and edges rather than a transmission
  // pass. That pass redrew the whole room every frame and doubled the
  // programs to link before the first frame.
  const glass = material as MeshStandardMaterial & { transmission?: number };
  const transmissive = Number(glass.transmission ?? 0) > 0;
  if (transmissive) glass.transmission = 0;
  if (/PRISM_Glass/.test(name)) {
    material.color.set("#d6f0ea"); material.metalness = 0; material.roughness = .035; material.envMapIntensity = 2.4;
    material.opacity = .46; material.transparent = true; material.depthWrite = false;
    if (material instanceof MeshPhysicalMaterial) { material.ior = 1.5; material.specularIntensity = 1; }
  } else if (transmissive) {
    material.roughness = Math.min(material.roughness, .08); material.envMapIntensity = 1.8;
    material.opacity = .42; material.transparent = true; material.depthWrite = false;
  }
  if (/SPECIMEN_Glass(?!_Edge)/.test(name)) { material.opacity = Math.min(.34, material.opacity); material.transparent = true; material.depthWrite = false; material.roughness = .16; }
  // Exported manufacture maps contain the absolute roughness response. They
  // must not be multiplied by a second family roughness value.
  if(material.roughnessMap)material.roughness=/CERAMIC_Pale_OPTICAL_BENCH/.test(name) ? .60 : 1;
  installLabLamps(material);
  material.needsUpdate = true;
}
interface Props {
  stage: InstrumentStage; theme: LagoonTheme; capture: boolean; assetUrl: string;
  running: boolean; paused?: boolean; reducedMotion?: boolean; revision: number; lifecycleSignal: AbortSignal;
  onReady(metrics: LagoonRenderMetrics): void;
  onFrame(metrics: Partial<LagoonRenderMetrics>): void;
  /** Known asset failures return to the poster owner without a React throw. */
  onError?(error: unknown): void;
}
const SEGMENTS = [
  ["BEAM_ENTRY", "BEAM_AFTER_PRISM"], ["BEAM_AFTER_PRISM", "SPECIMEN_FOCUS"],
  ["SPECIMEN_FOCUS", "DETECTOR_SPLIT"], ["DETECTOR_SPLIT", "DETECTOR_TOP"], ["DETECTOR_SPLIT", "DETECTOR_BOTTOM"],
] as const;

function disposeObject(object: Object3D) {
  const geometries = new Set<BufferGeometry>(); const materials = new Set<Material>(); const textures = new Set<Texture>();
  object.traverse(child => {
    if (!(child instanceof Mesh) && !(child instanceof Sprite)) return;
    if (child instanceof Mesh) geometries.add(child.geometry);
    if (child instanceof InstancedMesh) child.dispose();
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
  });
  geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose());
}

function disposeParsedAsset(gltf: GLTF) {
  disposeObject(gltf.scene);
  // A malformed material can leave a decoded embedded image unattached to a
  // mesh. Release parser-owned textures too; disposal is idempotent for the
  // texture instances also reached through the scene materials.
  void gltf.parser.getDependencies("texture").then((textures: Texture[]) => textures.forEach(texture => texture.dispose())).catch(() => {});
}

const TEXTURE_SLOTS = [
  { source: "baseColorTexture", target: "map", pbr: true },
  { source: "metallicRoughnessTexture", target: "metalnessMap", pbr: true },
  { source: "normalTexture", target: "normalMap", pbr: false },
  { source: "occlusionTexture", target: "aoMap", pbr: false },
  { source: "emissiveTexture", target: "emissiveMap", pbr: false },
] as const;

function hasDecodedImage(texture: Texture) {
  const image = texture.image as { width?: unknown; height?: unknown; naturalWidth?: unknown; naturalHeight?: unknown } | undefined;
  if (!image) return false;
  const width = typeof image.width === "number" ? image.width : image.naturalWidth;
  const height = typeof image.height === "number" ? image.height : image.naturalHeight;
  return typeof width === "number" && width > 0 && typeof height === "number" && height > 0;
}

/**
 * GLTFLoader resolves before an omitted material slot becomes visible in the
 * render. Verify every declared embedded texture and its semantic material
 * slot before the scene can report a valid frame.
 */
export async function assertDecodedTextures(gltf: GLTF): Promise<void> {
  const textures = gltf.parser.json.textures ?? [];
  await Promise.all(textures.map(async (_texture: unknown, index: number) => {
    const texture = await gltf.parser.getDependency("texture", index) as Texture;
    if (!(texture instanceof Texture) || !hasDecodedImage(texture)) throw new Error(`Lagoon texture ${index} did not decode to an image`);
  }));
  const definitions = gltf.parser.json.materials ?? [];
  const used = new Set<Material>();
  gltf.scene.traverse(child => {
    if (child instanceof Mesh) for (const material of Array.isArray(child.material) ? child.material : [child.material]) used.add(material);
  });
  for (const material of used) {
    const index = gltf.parser.associations.get(material)?.materials;
    if (!Number.isInteger(index)) continue;
    const definition = definitions[index as number] as { pbrMetallicRoughness?: Record<string, { index?: unknown }> } & Record<string, { index?: unknown }> | undefined;
    if (!definition) continue;
    for (const { source, target, pbr } of TEXTURE_SLOTS) {
      const texture = (pbr ? definition.pbrMetallicRoughness : definition)?.[source];
      if (texture?.index === undefined) continue;
      if (!((material as Material & Record<string, unknown>)[target] instanceof Texture)) {
        throw new Error(`Lagoon material ${index} lost its ${source} (${target})`);
      }
    }
  }
}

/** This hashes the delivered geometry and world transforms, independent of lighting and UI state. */
function meshSignature(object: Object3D, anchors: LagoonAnchors) {
  let hash = 2166136261;
  const add = (value: number) => { hash ^= value; hash = Math.imul(hash, 16777619); };
  object.updateMatrixWorld(true);
  object.traverse(child => {
    for (const char of child.name) add(char.charCodeAt(0));
    child.matrixWorld.elements.forEach(value => add(Math.round(value * 1e5)));
    if (child instanceof Mesh) {
      const positions = child.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) { add(Math.round(positions.getX(i) * 1e5)); add(Math.round(positions.getY(i) * 1e5)); add(Math.round(positions.getZ(i) * 1e5)); }
    }
  });
  for (const name of Object.keys(anchors).sort()) { for (const char of name) add(char.charCodeAt(0)); anchors[name].forEach(value => add(Math.round(value * 1e5))); }
  return `geometry-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

interface OpticalPath {
  object: Group; core: InstancedMesh; halo: InstancedMesh; ribbons: Mesh[]; ribbonMaterial: MeshBasicMaterial;
  traveller: Mesh; receivers: LabLamp[]; catches: Mesh[]; glows: Sprite[]; arrivals: number[];
}

/** A soft radial falloff shared by every glow sprite. */
function makeGlowTexture() {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const fade = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  fade.addColorStop(0, "rgba(255,255,255,.8)"); fade.addColorStop(.3, "rgba(255,255,255,.15)"); fade.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = fade; context.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

/**
 * A cross-beam falloff for the light's own glow: a bright centre and a long
 * soft shoulder, so the beam reads as light in air rather than a lit tube.
 */
function makeRibbonTexture() {
  const canvas = document.createElement("canvas"); canvas.width = 4; canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const fade = context.createLinearGradient(0, 0, 0, 128);
  for (const [stop, alpha] of [[0, 0], [.2, .03], [.36, .12], [.45, .42], [.5, 1], [.55, .42], [.64, .12], [.8, .03], [1, 0]] as const) fade.addColorStop(stop, `rgba(255,255,255,${alpha})`);
  context.fillStyle = fade; context.fillRect(0, 0, 4, 128);
  return new CanvasTexture(canvas);
}

const ribbonAxis = new Vector3(), ribbonAcross = new Vector3(), ribbonNormal = new Vector3(), ribbonView = new Vector3(), ribbonBasis = new Matrix4();
/** Lay a ribbon along a segment, turned to face the camera about its own axis. */
function orientRibbon(mesh: Mesh, from: Vector3, to: Vector3, camera: Camera, width: number) {
  ribbonAxis.subVectors(to, from); const length = Math.max(.0001, ribbonAxis.length()); ribbonAxis.divideScalar(length);
  mesh.position.addVectors(from, to).multiplyScalar(.5);
  ribbonView.setFromMatrixPosition(camera.matrixWorld).sub(mesh.position).normalize();
  ribbonAcross.crossVectors(ribbonAxis, ribbonView); if (ribbonAcross.lengthSq() < 1e-8) ribbonAcross.set(0, 1, 0); ribbonAcross.normalize();
  ribbonNormal.crossVectors(ribbonAxis, ribbonAcross);
  mesh.quaternion.setFromRotationMatrix(ribbonBasis.makeBasis(ribbonAxis, ribbonAcross, ribbonNormal));
  mesh.scale.set(length, width, 1);
}

function makeOpticalPath(anchors: LagoonAnchors): OpticalPath {
  const object = new Group(); object.name = "ILLUSTRATIVE_OPTICAL_PATH";
  // The fine core belongs to Three's opaque transmission input so the hero
  // prism can refract it. Its energy is color-scaled; alpha would exclude it
  // from that input and the prism's depth would erase the interior signal.
  const core = new InstancedMesh(new CylinderGeometry(.015, .015, 1, 8), new MeshBasicMaterial({ color: "#fff7e2", toneMapped: false, depthWrite: false }), SEGMENTS.length);
  const halo = new InstancedMesh(new CylinderGeometry(.035, .035, 1, 8), new MeshBasicMaterial({ color: "#ffaf50", transparent: true, opacity: .12, blending: AdditiveBlending, toneMapped: false, depthWrite: false }), SEGMENTS.length);
  core.name = "OPTICAL_CORE"; halo.name = "OPTICAL_HALO";
  // Depth testing stays enabled: solid mounts and housings occlude the path.
  core.renderOrder = 4; halo.renderOrder = 3;
  SEGMENTS.forEach(([from, to], index) => {
    const a = new Vector3(...anchors[from]), b = new Vector3(...anchors[to]);
    const direction = b.clone().sub(a), length = direction.length();
    const transform = new Matrix4().compose(a.add(b).multiplyScalar(.5), new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()), new Vector3(1, length, 1));
    core.setMatrixAt(index, transform); halo.setMatrixAt(index, transform);
  });
  core.instanceMatrix.needsUpdate = halo.instanceMatrix.needsUpdate = true;
  object.add(core, halo);
  const ribbonMaterial = new MeshBasicMaterial({ map: makeRibbonTexture(), color: "#ffb45a", transparent: true, opacity: 0, blending: AdditiveBlending, toneMapped: false, depthWrite: false, side: DoubleSide });
  const ribbons = SEGMENTS.map(() => {
    const ribbon = new Mesh(new PlaneGeometry(1, 1), ribbonMaterial);
    ribbon.name = "OPTICAL_GLOW"; ribbon.renderOrder = 3; ribbon.frustumCulled = false;
    object.add(ribbon); return ribbon;
  });
  const traveller = new Mesh(new CylinderGeometry(.014, .014, .22, 8), new MeshBasicMaterial({ color: "#fff7df", toneMapped: false, depthWrite: false }));
  traveller.name = "TRAVELLING_OPTICAL_EXCITATION"; traveller.visible = false; object.add(traveller);
  const receivers: LabLamp[] = [], catches: Mesh[] = [], glows: Sprite[] = [];
  const glowMap = makeGlowTexture();
  for (const name of ["BEAM_ENTRY", "BEAM_AFTER_PRISM", "SPECIMEN_FOCUS", "DETECTOR_TOP", "DETECTOR_BOTTOM"]) {
    const lamp = makeLamp(anchors[name], "#ffd08b", 1.8);
    // The source is just outside the aperture and catches illuminate its lip.
    lamp.position.z += .045; receivers.push(lamp);
    const catchLight = new Mesh(new SphereGeometry(.036, 12, 8), new MeshBasicMaterial({ color: "#fff1cc", transparent: true, blending: AdditiveBlending, toneMapped: false, depthWrite: false }));
    catchLight.position.copy(lamp.position); catchLight.name = `RECEIVER_${name}`; object.add(catchLight); catches.push(catchLight);
    const glow = new Sprite(new SpriteMaterial({ map: glowMap, color: "#ffd29a", transparent: true, opacity: 0, blending: AdditiveBlending, toneMapped: false, depthWrite: false }));
    glow.position.copy(lamp.position); glow.scale.setScalar(.20); glow.name = `SOURCE_GLOW_${name}`;
    object.add(glow); glows.push(glow);
  }
  return { object, core, halo, ribbons, ribbonMaterial, traveller, receivers, catches, glows, arrivals: [0,.5,.75,1,1] };
}

const ATTACHMENT_NAMES = ["SOURCE_ATTACHMENT", "PRISM_ATTACHMENT", "SPECIMEN_ATTACHMENT", "RECEIVER_TOP_ATTACHMENT", "RECEIVER_BOTTOM_ATTACHMENT"] as const;
const RIG_ROOTS = ["HEAD_CARRIAGE", "FOCUS_LENS", "SOURCE_SHUTTER", "FILTER_SELECTOR", "RECEIVER_TOP_ACTION", "RECEIVER_BOTTOM_ACTION"] as const;
type AttachmentName = typeof ATTACHMENT_NAMES[number];
type RigRoot = typeof RIG_ROOTS[number];
interface RestTransform { position: Vector3; rotation: Vector3; scale: Vector3; }

function updateSegment(mesh: InstancedMesh, index: number, from: Vector3, to: Vector3) {
  const direction = to.clone().sub(from); const length = Math.max(.0001, direction.length());
  mesh.setMatrixAt(index, new Matrix4().compose(from.clone().add(to).multiplyScalar(.5), new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()), new Vector3(1, length, 1)));
}

/** Dynamic endpoints use articulated world positions; the static map remains an immutable rest reference. */
function updateOpticalPath(path: OpticalPath, anchors: LagoonAnchors, attachments: Partial<Record<AttachmentName, Object3D>>, travel: number, active: boolean, camera: Camera, ribbonWidth: number) {
  const point = (attachment: AttachmentName, anchor: string) => {
    const object = attachments[attachment];
    return object ? object.getWorldPosition(new Vector3()) : new Vector3(...anchors[anchor]);
  };
  const points = [
    point("SOURCE_ATTACHMENT", "BEAM_ENTRY"), point("PRISM_ATTACHMENT", "BEAM_AFTER_PRISM"), point("SPECIMEN_ATTACHMENT", "SPECIMEN_FOCUS"),
    new Vector3(...anchors.DETECTOR_SPLIT), point("RECEIVER_TOP_ATTACHMENT", "DETECTOR_TOP"), point("RECEIVER_BOTTOM_ATTACHMENT", "DETECTOR_BOTTOM"),
  ];
  updateSegment(path.core, 0, points[0], points[1]); updateSegment(path.halo, 0, points[0], points[1]);
  updateSegment(path.core, 1, points[1], points[2]); updateSegment(path.halo, 1, points[1], points[2]);
  updateSegment(path.core, 2, points[2], points[3]); updateSegment(path.halo, 2, points[2], points[3]);
  updateSegment(path.core, 3, points[3], points[4]); updateSegment(path.halo, 3, points[3], points[4]);
  updateSegment(path.core, 4, points[3], points[5]); updateSegment(path.halo, 4, points[3], points[5]);
  path.core.instanceMatrix.needsUpdate = path.halo.instanceMatrix.needsUpdate = true;
  const spans: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 4], [3, 5]];
  spans.forEach(([from, to], index) => orientRibbon(path.ribbons[index], points[from], points[to], camera, ribbonWidth));
  const catchPoints = [points[0], points[1], points[2], points[4], points[5]];
  path.receivers.forEach((light, index) => { light.position.copy(catchPoints[index]); light.position.z += .045; });
  path.catches.forEach((catchLight, index) => catchLight.position.copy(path.receivers[index].position));
  path.glows.forEach((glow, index) => glow.position.copy(path.receivers[index].position));
  const route = [points[0], points[1], points[2], points[3], points[4]];
  const lengths = route.slice(1).map((value, index) => value.distanceTo(route[index])); const total = lengths.reduce((sum, value) => sum + value, 0);
  const prefix = [0]; lengths.forEach(length=>prefix.push(prefix.at(-1)!+length));
  const lowerLength=prefix[3]+points[3].distanceTo(points[5]);
  path.arrivals=[0,prefix[1]/total,prefix[2]/total,1,lowerLength/total];
  let remaining = Math.max(0, Math.min(1, travel)) * total; let index = 0;
  while (index < lengths.length - 1 && remaining > lengths[index]) { remaining -= lengths[index]; index += 1; }
  const along = lengths[index] ? remaining / lengths[index] : 0;
  path.traveller.position.copy(route[index]).lerp(route[index + 1], along);
  path.traveller.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), route[index + 1].clone().sub(route[index]).normalize());
  path.traveller.visible = active && travel > 0 && travel < 1;
  const named: Array<[string, Vector3]> = [["BEAM_ENTRY", points[0]], ["BEAM_AFTER_PRISM", points[1]], ["SPECIMEN_FOCUS", points[2]], ["DETECTOR_SPLIT", points[3]], ["DETECTOR_TOP", points[4]], ["DETECTOR_BOTTOM", points[5]]];
  return Object.fromEntries(named.map(([name, value]) => [name, value.toArray() as [number, number, number]]));
}

/** A neutral contact footprint; cast shadows provide the instrument contacts. */
function PlinthContact() {
  const mesh = useMemo(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d")!;
    const gradient = context.createRadialGradient(64, 64, 25, 64, 64, 64);
    gradient.addColorStop(0, "rgba(8,22,22,.45)"); gradient.addColorStop(.65, "rgba(8,22,22,.18)"); gradient.addColorStop(1, "rgba(8,22,22,0)");
    context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
    const plane = new Mesh(new PlaneGeometry(10.2, 6.2), new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false, toneMapped: false, opacity: .45 }));
    plane.rotation.x = -Math.PI / 2; plane.position.set(0, -.025, 0);
    return plane;
  }, []);
  useEffect(() => () => disposeObject(mesh), [mesh]);
  return <primitive object={mesh} />;
}

function projectedAnchors(anchors: LagoonAnchors, camera: Object3D): LagoonRenderMetrics["anchors"] {
  return Object.entries(anchors).map(([id, point]) => {
    const p = new Vector3(...point).project(camera as never);
    return { id, normalized: [(p.x + 1) / 2, (1 - p.y) / 2] as [number, number] };
  });
}

interface CameraPose { target: Vector3; offset: Vector3; position: Vector3; }
function CameraRig({ anchors, asset, framing, pose }: { anchors: LagoonAnchors; asset: Object3D; framing: { current: LagoonRenderMetrics["framing"] }; pose: { current: CameraPose | null } }) {
  const { camera, size, invalidate } = useThree();
  const preset = LAGOON_PRESETS[lagoonView(window.innerWidth)];
  useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const target = new Vector3(...anchors[preset.targetAnchor]);
    const direction = new Vector3(...preset.position).normalize();
    const study = new URLSearchParams(location.search).get("lab-study");
    // The second composition study is a lower lens, not a different room.
    if (import.meta.env.PUBLIC_INSTRUMENT_CAPTURE === "test" && study === "low") direction.set(5.5, 3.2, 19).normalize();
    const vertices: Vector3[] = []; asset.updateMatrixWorld(true);
    asset.traverse(child => {
      if (!(child instanceof Mesh)) return;
      const positions = child.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) vertices.push(new Vector3().fromBufferAttribute(positions, i).applyMatrix4(child.matrixWorld));
    });
    // A fixed eye and canonical art frame preserve perspective through resize.
    // Fitting by moving the eye at every aspect changes overlap and prevents a
    // responsive poster from matching the first live frame.
    const canonicalAspect = lagoonView(window.innerWidth) === "mobile" ? 1.15 : 1.18;
    const tangent = Math.tan(32 * Math.PI / 360), aspect = canonicalAspect;
    camera.fov = 32; camera.aspect = aspect; camera.zoom = 1; camera.position.copy(target).addScaledVector(direction, 30); camera.lookAt(target); camera.updateMatrixWorld(true);
    let distance = 0;
    for (const vertex of vertices) {
      const point = vertex.clone().applyMatrix4(camera.matrixWorldInverse);
      distance = Math.max(distance, 30 + point.z + Math.max(Math.abs(point.x) / (tangent * aspect), Math.abs(point.y) / tangent) * preset.padding);
    }
    camera.position.copy(target).addScaledVector(direction, distance); camera.lookAt(target); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
    // Center in the canonical camera, independent of the canvas aspect.
    const projected = new Box3();
    for (let iteration = 0; iteration < 3; iteration++) {
      projected.makeEmpty(); vertices.forEach(vertex => projected.expandByPoint(vertex.clone().project(camera)));
      const center = projected.getCenter(new Vector3());
      const shift = new Vector3(center.x * tangent * aspect * distance, center.y * tangent * distance, 0).applyQuaternion(camera.quaternion);
      camera.position.add(shift); target.add(shift); camera.lookAt(target); camera.updateMatrixWorld(true);
    }
    const viewportAspect = size.width / size.height;
    camera.aspect = viewportAspect;
    camera.fov = 2 * Math.atan(tangent * Math.max(1, canonicalAspect / viewportAspect)) * 180 / Math.PI;
    camera.updateProjectionMatrix();
    // Capture this same contain frame, including its authored breathing room.
    const width = Math.min(size.width, size.height * canonicalAspect);
    const height = width / canonicalAspect;
    framing.current = { x: (size.width - width) / 2, y: (size.height - height) / 2, width, height };
    pose.current = { target, offset: camera.position.clone().sub(target), position: camera.position.clone() };
    invalidate();
  }, [anchors, asset, camera, framing, invalidate, pose, preset, size.height, size.width]);
  return null;
}

const PRACTICAL_NAMES = Object.keys(LAGOON_PRACTICALS) as Array<keyof typeof LAGOON_PRACTICALS>;

interface Practical { lamp: LabLamp; bulb: Mesh; glow: Sprite; }

function makePractical(position: readonly number[], range: number, cone: { outer: number; inner: number; direction: readonly number[] }, glowMap: Texture): Practical {
  // Each modeled lamp throws a warm cone onto its shelf, frame or bench and
  // the wall beside it. The lamps share the key's shadow/contact ownership
  // and do not add shadow-map passes.
  const lamp = makeLamp(position, "#ffc47c", range, cone);
  const bulb = new Mesh(new SphereGeometry(.048, 12, 8), new MeshBasicMaterial({ color: "#ffe0ad", toneMapped: false }));
  bulb.position.copy(lamp.position); bulb.name = "PRACTICAL_EMITTER";
  const glow = new Sprite(new SpriteMaterial({ map: glowMap, color: "#ffc98a", transparent: true, opacity: 0, blending: AdditiveBlending, toneMapped: false, depthWrite: false }));
  glow.position.copy(lamp.position); glow.scale.setScalar(.42); glow.name = "PRACTICAL_GLOW";
  return { lamp, bulb, glow };
}

function makeLightRig() {
  const group = new Group(); group.name = "PHOTOGRAPHIC_LIGHT_RIG";
  // The directional key owns moving carriage shadows. Area panels shape the
  // aluminum and prism reflections, while local spots give every modeled lamp
  // an economical nearby pool rather than an isolated emissive dot.
  const key = new DirectionalLight("#fff6e7", 4.4); key.position.set(-6.5, 10, 7.5); key.target.position.set(.35, 3.1, -.35); key.castShadow = true;
  key.shadow.mapSize.set(1536, 1536); Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -5, near: .5, far: 28 }); key.shadow.bias = -.00018; key.shadow.normalBias = .022; key.shadow.radius = 3.5;
  const fill = new HemisphereLight("#c7e5eb", "#16323a", .42);
  // The area panels that shaped reflections now live in the studio
  // environment (studio.ts); the room's lamps are evaluated in lamps.ts.
  const glowMap = makeGlowTexture();
  const desk = { outer: 1.1, inner: .42, direction: [0, -1, .5] } as const;
  const picture = { outer: 1.2, inner: .5, direction: [0, -1, -.3] } as const;
  const task = [
    makePractical(LAGOON_PRACTICALS.TASK_LIGHT_BENCH_LEFT, 2.1, desk, glowMap),
    makePractical(LAGOON_PRACTICALS.TASK_LIGHT_BENCH_RIGHT, 2.1, desk, glowMap),
    makePractical(LAGOON_PRACTICALS.TASK_LIGHT_UPPER_LEFT, 2.1, desk, glowMap),
    makePractical(LAGOON_PRACTICALS.TASK_LIGHT_UPPER_RIGHT, 2.1, desk, glowMap),
  ];
  const gallery = [
    makePractical(LAGOON_PRACTICALS.GALLERY_LIGHT_LEFT, 2.3, picture, glowMap),
    makePractical(LAGOON_PRACTICALS.GALLERY_LIGHT_CENTER, 2.3, picture, glowMap),
    makePractical(LAGOON_PRACTICALS.GALLERY_LIGHT_RIGHT, 2.3, picture, glowMap),
  ];
  group.add(key, key.target, fill);
  for (const practical of [...task, ...gallery]) group.add(practical.bulb, practical.glow);
  return { group, key, fill, task, gallery };
}

export function LagoonScene({ stage, theme, capture, assetUrl, running, paused = false, reducedMotion = false, revision, lifecycleSignal, onReady, onFrame, onError }: Props) {
  const { gl, scene, camera, size, invalidate } = useThree();
  const [asset, setAsset] = useState<Object3D | null>(null);
  const [anchors, setAnchors] = useState<LagoonAnchors | null>(null);
  const [bounds, setBounds] = useState<LagoonBounds | null>(null);
  const [quality, setQuality] = useState<CadenceTier>("full");
  const [environmentVersion, setEnvironmentVersion] = useState(0);
  const ready = useRef(false); const afterCompile = useRef(0); const compiledAt = useRef(0); const compiled = useRef(false);
  const painted = useRef(false);
  const framing = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const signature = useRef(""); const pulseUntil = useRef(0); const pulsePending = useRef(false); const previousStage = useRef(stage);
  const pose = useRef<CameraPose | null>(null);
  const motion = useRef(new LabMotion(theme === "dark"));
  const rigRoots = useRef<Partial<Record<RigRoot, Object3D>>>({});
  const attachments = useRef<Partial<Record<AttachmentName, Object3D>>>({});
  const practicalAnchors = useRef<Partial<Record<keyof typeof LAGOON_PRACTICALS, Object3D>>>({});
  const restTransforms = useRef(new Map<Object3D, RestTransform>());
  const nextActionTimer = useRef<number | null>(null);
  const renderEligibility = useRef({ running, paused, reducedMotion });
  renderEligibility.current = { running, paused, reducedMotion };
  const captureAt = useRef<number | null>(null); const captureResolver = useRef<(() => void) | null>(null);
  const activeFrames = useRef(0); const restFrames = useRef(0); const endpoints = useRef<Record<string, [number, number, number]>>({});
  const lightRig = useMemo(makeLightRig, []);
  const path = useMemo(() => anchors ? makeOpticalPath(anchors) : null, [anchors]);
  const lamps = useMemo(() => [...lightRig.task, ...lightRig.gallery].map(practical => practical.lamp).concat(path?.receivers ?? []), [lightRig, path]);
  const queries = useMemo(() => import.meta.env.PUBLIC_INSTRUMENT_CAPTURE === "test" ? new URLSearchParams(location.search) : new URLSearchParams(), []);
  const occlusionFixture = useMemo(() => {
    if (!anchors || queries.get("lab-occluder") !== "1") return null;
    const mount = new Mesh(new BoxGeometry(.20, .38, .24), new MeshStandardMaterial({ color: "#31585b", roughness: .45, metalness: .3 }));
    mount.name = "DEPTH_OCCLUDING_MOUNT";
    mount.position.copy(new Vector3(...anchors.BEAM_AFTER_PRISM).add(new Vector3(...anchors.SPECIMEN_FOCUS)).multiplyScalar(.5));
    mount.castShadow = mount.receiveShadow = true;
    return mount;
  }, [anchors, queries]);
  const artPass = queries.get("lab-pass");
  const variant = queries.get("lab-variant") === "alternate";
  const beamOff = queries.get("lab-beam") === "off" || artPass === "A" || artPass === "B";
  const motionFrame = useRef({ theme: theme === "dark" ? 1 : 0, intro: 1, shutter: 1, stagePulse: 0, carriage: 0, focus: 0, filter: 0, optical: .32, travel: 0, receiverTop: 0, receiverBottom: 0, phase: "rest", action: "rest", nextWakeAt: null as number | null, moving: false });
  const cadence = useRef(new PulseCadence());
  const environmentReady = useRef(false);
  const materialBaseline = useRef(new Map<Material, MaterialBaseline>());
  const warmMaterials = useRef<MeshStandardMaterial[]>([]);
  const reportedFailure = useRef(false); const onErrorRef = useRef(onError); onErrorRef.current = onError;
  const reportFailure = useCallback((error: unknown) => {
    if (reportedFailure.current) return;
    reportedFailure.current = true;
    onErrorRef.current?.(error);
  }, []);
  useEffect(() => () => { if (path) disposeObject(path.object); }, [path]);
  useEffect(() => () => { if (nextActionTimer.current !== null) window.clearTimeout(nextActionTimer.current); }, []);
  useEffect(() => () => { if (occlusionFixture) disposeObject(occlusionFixture); }, [occlusionFixture]);
  useEffect(() => () => { lightRig.key.shadow.dispose(); disposeObject(lightRig.group); }, [lightRig]);
  useEffect(() => {
    // Readiness belongs to a visible revision. Once the apparatus has painted,
    // a new revision must relight from its displayed values, even while that
    // revision is waiting for its three matching frames.
    motion.current.relight(theme === "dark", performance.now(), capture || !painted.current);
    invalidate();
  }, [theme, capture, invalidate]);
  useEffect(() => {
    const now = performance.now();
    if ((paused || reducedMotion) && nextActionTimer.current !== null) {
      window.clearTimeout(nextActionTimer.current);
      nextActionTimer.current = null;
    }
    motion.current.setReducedMotion(reducedMotion, now); motion.current.setPaused(paused, now); invalidate();
  }, [invalidate, paused, reducedMotion]);
  useLayoutEffect(() => {
    ready.current = false; afterCompile.current = 0; invalidate();
  }, [revision, stage, theme, invalidate]);
  useEffect(() => {
    if (!capture && running && previousStage.current !== stage) { motion.current.select(performance.now(), stage); cadence.current.start(performance.now()); }
    if(capture||running)previousStage.current = stage; invalidate();
  }, [stage, capture, running, invalidate]);
  useEffect(() => {
    if (!running) { motion.current.suspend(performance.now()); cadence.current.reset(); if (nextActionTimer.current !== null) window.clearTimeout(nextActionTimer.current); nextActionTimer.current = null; return; }
    motion.current.awaken(performance.now());
    const hero = gl.domElement.closest("[data-hero]");
    if (!hero || capture || !matchMedia("(pointer: fine)").matches || lagoonView(innerWidth) !== "desktop") return;
    const pointer = (event: Event) => {
      const p = event as PointerEvent; if (p.pointerType === "touch") return;
      const box = hero.getBoundingClientRect();
      motion.current.pointer((p.clientX - box.left) / box.width * 2 - 1, (p.clientY - box.top) / box.height * 2 - 1); invalidate();
    };
    const leave = () => { motion.current.pointer(0, 0); invalidate(); };
    hero.addEventListener("pointermove", pointer, { passive: true }); hero.addEventListener("pointerleave", leave);
    return () => { hero.removeEventListener("pointermove", pointer); hero.removeEventListener("pointerleave", leave); };
  }, [capture, gl, invalidate, running, size.width]);

  useEffect(() => {
    if (!capture) return;
    const host = window as Window & { __pocketCapture?: { renderAt(milliseconds: number): Promise<void> } };
    host.__pocketCapture = {
      renderAt(milliseconds) {
        return new Promise(resolve => { captureAt.current = Math.max(0, milliseconds); captureResolver.current = resolve; invalidate(); });
      },
    };
    return () => { if (host.__pocketCapture) delete host.__pocketCapture; captureResolver.current?.(); captureResolver.current = null; };
  }, [capture, invalidate]);

  useEffect(() => {
    if (lifecycleSignal.aborted) return;
    let alive = true; let loaded: Object3D | null = null; let parsed: GLTF | null = null; let isolatedRig: GLTF | null = null;
    const controller = new AbortController();
    const abortRequests = () => controller.abort();
    // React's passive effect can otherwise run after pagehide during a fast
    // navigation. Abort the mount signal synchronously and before WebKit tears
    // down the outgoing document's origin, so no new asset fetch can begin.
    const abortOnPageExit = (event: PageTransitionEvent) => { if (!event.persisted) abortRequests(); };
    lifecycleSignal.addEventListener("abort", abortRequests, { once: true });
    window.addEventListener("pagehide", abortOnPageExit, { capture: true });
    if (lifecycleSignal.aborted) { abortRequests(); return () => { lifecycleSignal.removeEventListener("abort", abortRequests); window.removeEventListener("pagehide", abortOnPageExit, { capture: true }); }; }
    reportedFailure.current = false; ready.current = false; painted.current = false; compiled.current = false; pulsePending.current = false; cadence.current.reset(); warmMaterials.current = []; setQuality("full");
    setAsset(null); setAnchors(null); setBounds(null);
    const decoder = loadMeshoptDecoder(controller.signal);
    const bytes = fetch(assetUrl, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error(`Laboratory asset returned ${response.status}`);
      return response.arrayBuffer();
    });
    // This furnished room requires its mechanism. Failed articulation returns
    // to the matching fallback rather than displaying unsupported floating optics.
    const rigBytes = fetch("/lagoon/rig.glb", { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error(`Laboratory rig returned ${response.status}`);
      return response.arrayBuffer();
    });
    performance.mark("lagoon:model-request");
    Promise.all([decoder, bytes, loadLagoonAssetData(controller.signal), rigBytes])
      .then(async ([module, buffer, data, rigBuffer]) => {
        if (!alive || controller.signal.aborted) return;
        const loader = new GLTFLoader().setMeshoptDecoder(module.MeshoptDecoder);
        const gltf = await loader.parseAsync(buffer, "/lagoon/");
        parsed = gltf;
        loaded = gltf.scene;
        if (!alive || controller.signal.aborted) { disposeParsedAsset(gltf); return; }
        await assertDecodedTextures(gltf);
        if (!alive || controller.signal.aborted) { disposeParsedAsset(gltf); return; }
        if (rigBuffer) {
          try {
            const rig = await loader.parseAsync(rigBuffer, "/lagoon/");
            isolatedRig = rig;
            if (!alive || controller.signal.aborted) { disposeParsedAsset(rig); disposeParsedAsset(gltf); return; }
            await assertDecodedTextures(rig);
            rig.scene.name = "ARTICULATED_LAB_RIG";
            loaded.add(rig.scene);
            isolatedRig = null;
          } catch (error) {
            throw error;
          }
        }
        loaded.updateMatrixWorld(true);
        const manufacture=new Map<string,MeshStandardMaterial>();
        loaded.traverse(child=>{if(child instanceof Mesh)for(const material of Array.isArray(child.material)?child.material:[child.material])if(material instanceof MeshStandardMaterial&&material.roughnessMap)manufacture.set(material.name.split('.')[0],material);});
        loaded.traverse(child=>{if(child instanceof Mesh)for(const material of Array.isArray(child.material)?child.material:[child.material])if(material instanceof MeshStandardMaterial&&!material.roughnessMap){const template=manufacture.get(material.name.split('.')[0]);if(template){material.roughnessMap=template.roughnessMap;material.normalMap=template.normalMap;material.normalScale.copy(template.normalScale);}}});
        rigRoots.current = {}; attachments.current = {}; restTransforms.current.clear();
        for (const name of RIG_ROOTS) {
          const object = loaded.getObjectByName(name);
          if (object) { rigRoots.current[name] = object; restTransforms.current.set(object, { position: object.position.clone(), rotation: new Vector3(object.rotation.x, object.rotation.y, object.rotation.z), scale: object.scale.clone() }); }
        }
        for (const name of ATTACHMENT_NAMES) {
          const object = loaded.getObjectByName(name);
          if (object) attachments.current[name] = object;
        }
        practicalAnchors.current = {};
        for (const name of PRACTICAL_NAMES) {
          const object = loaded.getObjectByName(name);
          if (object) practicalAnchors.current[name] = object;
        }
        performance.mark("lagoon:model-decoded");
        signature.current = meshSignature(loaded, data.anchors);
        loaded.traverse(child => { if (child instanceof Mesh) { child.castShadow = true; child.receiveShadow = true;
          const bindReceiver = (material: Material) => {
            if (!/DETECTOR_RECEIVER/.test(material.name)) return material;
            let parent: Object3D | null = child;
            while (parent && !/RECEIVER_(TOP|BOTTOM)_ACTION/.test(parent.name)) parent = parent.parent;
            const side = parent?.name.includes("TOP") ? "TOP" : "BOTTOM";
            const bound = material.clone(); bound.name = `${material.name}_${side}`;
            return bound;
          };
          child.material = Array.isArray(child.material) ? child.material.map(bindReceiver) : bindReceiver(child.material);
          if (/SPECIMEN/.test(child.name)) child.renderOrder = 5;
          else if (/PRISM/.test(child.name)) child.renderOrder = 4;
          for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
            tuneRoomMaterial(material);
            if (material instanceof MeshStandardMaterial && /APRICOT_Task_Light/.test(material.name) && !warmMaterials.current.includes(material)) warmMaterials.current.push(material);
            if ("aoMapIntensity" in material) material.aoMapIntensity = .55;
            if (artPass === "A" && material instanceof MeshStandardMaterial) { material.color.set("#b5bab8"); material.metalness = 0; material.roughness = .6; material.emissiveIntensity = 0; if ("transmission" in material) material.transmission = 0; }
            if (variant && artPass === "B" && material instanceof MeshStandardMaterial && material.metalness > .5) material.roughness = .44;
            if (material instanceof MeshStandardMaterial && /SOURCE_APERTURE|DETECTOR_RECEIVER/.test(material.name)) material.emissiveIntensity = 0;
            if (material.transparent) material.forceSinglePass = true;
            if ("transmission" in material && Number(material.transmission) > 0) material.depthWrite = true;
          } } });
        // Hidden until its programs are linked. A demand frame drawn first
        // would compile every material synchronously and block on each link.
        loaded.visible = false;
        setAnchors(data.anchors); setBounds(data.bounds); setAsset(loaded); invalidate();
      })
      .catch(error => {
        if(isolatedRig){disposeParsedAsset(isolatedRig);isolatedRig=null;}
        if (!alive || controller.signal.aborted) return;
        if (parsed) { disposeParsedAsset(parsed); parsed = null; loaded = null; }
        else if (loaded) { disposeObject(loaded); loaded = null; }
        reportFailure(error);
      });
    return () => {
      alive = false;
      lifecycleSignal.removeEventListener("abort", abortRequests);
      window.removeEventListener("pagehide", abortOnPageExit, { capture: true });
      abortRequests();
      if (parsed) disposeParsedAsset(parsed); else if (loaded) disposeObject(loaded);
    };
  }, [assetUrl, invalidate, lifecycleSignal, reportFailure]);

  // Stepdowns change renderer work on the existing GLTF root. They never
  // select another asset or re-enter the loader.
  useEffect(() => {
    if (!asset) return;
    const touched = new Set<Material>();
    asset.traverse(child => {
      if (!(child instanceof Mesh)) return;
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        touched.add(material);
        const physical = material as Material & { transmission?: number; thickness?: number };
        if (!materialBaseline.current.has(material)) materialBaseline.current.set(material, { transmission: physical.transmission, thickness: physical.thickness, opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite });
        applyMaterialQuality(physical, materialBaseline.current.get(material)!, quality);
      }
    });
    return () => {
      for (const material of touched) {
        const physical = material as Material & { transmission?: number; thickness?: number };
        const baseline = materialBaseline.current.get(material); if (!baseline) continue;
        if (baseline.transmission !== undefined) physical.transmission = baseline.transmission;
        if (baseline.thickness !== undefined) physical.thickness = baseline.thickness;
        material.opacity = baseline.opacity; material.transparent = baseline.transparent; material.depthWrite = baseline.depthWrite;
        material.needsUpdate = true;
      }
    };
  }, [asset, quality]);

  useEffect(() => {
    let alive = true; let environment: ReturnType<PMREMGenerator["fromScene"]> | null = null; let restoreFrame = 0;
    const regenerate = () => {
      try {
        const pmrem = new PMREMGenerator(gl); const room = makeStudioScene();
        // Three keeps renderer-state caches across the canvas lifetime. Reset
        // them after restoration, then use the same PMREM path as first paint.
        gl.resetState();
        const next = pmrem.fromScene(room, .04); room.userData.dispose?.(); pmrem.dispose();
        environment = next; scene.environment = next.texture;
        environmentReady.current = true; setEnvironmentVersion(version => version + 1); invalidate();
      } catch (error) { if (alive) reportFailure(error); }
    };
    regenerate();
    // RenderTarget textures are invalid after a context restore even though the
    // React effect dependencies are unchanged. Rebuild once per restore, not
    // per stage or theme, before the owner's revision reaches valid frames.
    const lost = () => {
      environmentReady.current = false;
      if (scene.environment === environment?.texture) scene.environment = null;
      // Dispose while the original context still owns these GL handles. Calling
      // dispose after restoration would issue deletes against the new context.
      environment?.dispose(); environment = null;
    };
    const restored = () => {
      environmentReady.current = false; if (scene.environment === environment?.texture) scene.environment = null;
      // Do not issue PMREM draw calls during the restore event itself. At the
      // next frame the browser has rebuilt the context state; valid-frame
      // readiness remains gated until regenerate increments environmentVersion.
      restoreFrame = requestAnimationFrame(() => { if (alive) regenerate(); });
    };
    gl.domElement.addEventListener("webglcontextlost", lost);
    gl.domElement.addEventListener("webglcontextrestored", restored);
    return () => { alive = false; cancelAnimationFrame(restoreFrame); gl.domElement.removeEventListener("webglcontextlost", lost); gl.domElement.removeEventListener("webglcontextrestored", restored); if (scene.environment === environment?.texture) scene.environment = null; environment?.dispose(); };
  }, [gl, invalidate, reportFailure, scene]);

  useEffect(() => {
    if (!running) { pulseUntil.current = 0; pulsePending.current = false; cadence.current.reset(); return; }
    let valid = true;
    gl.toneMapping = ACESFilmicToneMapping;
    // Clear directly in the renderer's output colour space. A scene background
    // would pass through the scene exposure and expose a rectangular field.
    scene.background = null;
    gl.transmissionResolutionScale = quality === "full" ? .5 : quality === "reduced" ? .35 : .25;
    gl.shadowMap.enabled = quality === "full"; gl.shadowMap.type = PCFShadowMap; gl.shadowMap.autoUpdate = false; gl.shadowMap.needsUpdate = quality === "full";
    const compactAsset = assetUrl.includes("lab-compact") || lagoonView(window.innerWidth) === "mobile";
    const baselineQuality = compactAsset ? LAGOON_QUALITY.compact : LAGOON_QUALITY.standard;
    const cap = quality === "full" ? baselineQuality.dprCap : quality === "reduced" ? Math.min(baselineQuality.dprCap, compactAsset ? .9 : 1.1) : Math.min(baselineQuality.dprCap, compactAsset ? .7 : .85);
    const pixels = quality === "full" ? baselineQuality.pixelCap : quality === "reduced" ? (compactAsset ? 450_000 : 1_000_000) : (compactAsset ? 300_000 : 650_000);
    const dpr = Math.min(window.devicePixelRatio || 1, cap, Math.sqrt(pixels / Math.max(1, size.width * size.height)));
    gl.setPixelRatio(dpr);
    ready.current = false; afterCompile.current = 0; compiled.current = false;
    if (asset && anchors && environmentReady.current) {
      void gl.compileAsync(scene, camera).then(() => {
        if (!valid) return;
        asset.visible = true;
        compiled.current = true; compiledAt.current = performance.now();
        performance.mark("lagoon:compile-complete");
        pulseUntil.current = 0; invalidate();
      }).catch(error => { if (valid) reportFailure(error); });
    }
    invalidate();
    return () => { valid = false; };
  // Theme and selection only change uniforms. Compiling again for those updates
  // blocks their finite relight on a software adapter and is unnecessary for
  // the already prepared programs. Latest-revision readiness resets separately.
  }, [anchors, asset, camera, capture, environmentVersion, gl, invalidate, quality, reportFailure, running, scene, size.height, size.width]);

  // Observe the completed main render, including shadow/transmission passes.
  // useFrame runs before Three renders and would report the preceding frame.
  useEffect(() => {
    const previous = scene.onAfterRender;
    scene.onAfterRender = () => {
      if (!running || !asset || !anchors || !bounds || !compiled.current) return;
      const info = gl.info.render;
      if (!ready.current) {
        afterCompile.current += 1;
        if (afterCompile.current < 3) { invalidate(); return; }
        const renderError = gl.getContext().getError();
        if (renderError !== gl.getContext().NO_ERROR) {
          compiled.current = false;
          reportFailure(new Error(`Laboratory WebGL frame failed (${renderError})`));
          return;
        }
        ready.current = true;
        painted.current = true;
        performance.mark("lagoon:valid-frame");
        if (!capture && !motion.current.introPlayed) { motion.current.introduce(performance.now()); invalidate(); }
        onReady({ drawCalls: info.calls, triangles: info.triangles, frames: info.frame, signature: signature.current, framing: framing.current, anchors: projectedAnchors(anchors, camera), compiledAt: compiledAt.current, paintedAt: performance.now(), cadence: cadence.current.snapshot(quality) });
      }
      const sampled = capture ? null : cadence.current.observe(performance.now(), quality);
      if (sampled?.completed) {
        performance.mark("lagoon:pulse-complete");
        if (sampled.action === "stepdown") {
          performance.mark("lagoon:quality-stepdown");
          setQuality(current => current === "full" ? "reduced" : "compact");
        } else if (sampled.action === "fallback") {
          performance.mark("lagoon:cadence-fallback");
          reportFailure(new Error(`Lagoon cadence stayed slow after two local stepdowns (${sampled.snapshot.callbackIntervalsMs.join(",")}ms renderer-callback CPU proxy)`));
        }
      }
      onFrame({ drawCalls: info.calls, triangles: info.triangles, frames: info.frame, anchors: projectedAnchors(anchors, camera), cameraPosition: camera.position.toArray(), themeProgress: motionFrame.current.theme, introProgress: motionFrame.current.intro, opticalStrength: beamOff ? 0 : motionFrame.current.optical * motionFrame.current.shutter, opticalPhase: motionFrame.current.travel, opticalTravel: motionFrame.current.travel, motionPhase: motionFrame.current.phase, motionAction: motionFrame.current.action, motionPose: { carriage: motionFrame.current.carriage, focus: motionFrame.current.focus, filter: motionFrame.current.filter, shutter: motionFrame.current.shutter, receiverTop: motionFrame.current.receiverTop, receiverBottom: motionFrame.current.receiverBottom }, nextWakeAt: motionFrame.current.nextWakeAt, activeFrames: activeFrames.current, restFrames: restFrames.current, endpoints: endpoints.current, motionSettled: !motionFrame.current.moving, cadence: (sampled?.snapshot ?? cadence.current.snapshot(quality)), pulseCompletedAt: sampled?.completed ? sampled.snapshot.completedAt ?? undefined : undefined });
      if (captureResolver.current) { const resolve = captureResolver.current; captureResolver.current = null; resolve(); }
    };
    return () => { scene.onAfterRender = previous; };
  }, [anchors, asset, bounds, camera, capture, gl, invalidate, onFrame, onReady, quality, reportFailure, running, scene]);

  useFrame(() => {
    if (!running || !asset || !anchors || !bounds) return;
    const now = performance.now();
    const sampledCapture = captureAt.current;
    const frame = capture && sampledCapture === null
      ? { ...LabMotion.sampleCycle(0, stage), yaw: queries.get("lab-pose") === "left" ? -.035 : queries.get("lab-pose") === "right" ? .035 : 0, theme: theme === "dark" ? 1 : 0, moving: false }
      : capture ? { ...LabMotion.sampleCycle(sampledCapture ?? 0, stage), theme: theme === "dark" ? 1 : 0 }
      : motion.current.advance(now);
    motionFrame.current = frame;
    if (frame.moving) activeFrames.current += 1; else restFrames.current += 1;
    if (pose.current) {
      const { target, offset } = pose.current;
      const rotated = offset.clone().applyAxisAngle(new Vector3(0, 1, 0), frame.yaw);
      const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      rotated.applyAxisAngle(right, frame.pitch);
      camera.position.copy(target).add(rotated); camera.lookAt(target); camera.updateMatrixWorld(true);
    }
    const t = frame.theme, day = LAGOON_LIGHTS.light, night = LAGOON_LIGHTS.dark;
    const mix = (a: number, b: number) => a + (b - a) * t;
    // Switch the shared page field with the HTML theme so its text keeps full
    // contrast. Physical light, exposure and reflections still relight together.
    const background = new Color(LAGOON_LIGHTS[theme].background);
    gl.setClearColor(background, 1);
    scene.environmentIntensity = mix(day.environment, night.environment) * (variant && (artPass === "A" || artPass === "D") ? 1.8 : 1);
    gl.toneMappingExposure = mix(day.exposure, night.exposure);
    lightRig.key.color.set("#fff1dc").lerp(new Color("#c6dbe5"), t); lightRig.key.intensity = mix(day.key, night.key);
    lightRig.fill.color.set("#c7e5eb").lerp(new Color("#284653"), t); lightRig.fill.groundColor.set("#16323a").lerp(new Color("#071013"), t); lightRig.fill.intensity = mix(day.fill, night.fill);
    // Exact exported lamp anchors take precedence over their documented world
    // rest positions. The target stays on the local bench/gallery surface,
    // giving modeled emitters a visible, bounded practical pool.
    const anchorPractical = (name: keyof typeof LAGOON_PRACTICALS, practical: Practical) => {
      const anchor = practicalAnchors.current[name];
      practical.lamp.position.copy(anchor ? anchor.getWorldPosition(new Vector3()) : new Vector3(...LAGOON_PRACTICALS[name]));
      practical.bulb.position.copy(practical.lamp.position); practical.glow.position.copy(practical.lamp.position);
    };
    anchorPractical("TASK_LIGHT_BENCH_LEFT", lightRig.task[0]); anchorPractical("TASK_LIGHT_BENCH_RIGHT", lightRig.task[1]);
    anchorPractical("TASK_LIGHT_UPPER_LEFT", lightRig.task[2]); anchorPractical("TASK_LIGHT_UPPER_RIGHT", lightRig.task[3]);
    anchorPractical("GALLERY_LIGHT_LEFT", lightRig.gallery[0]); anchorPractical("GALLERY_LIGHT_CENTER", lightRig.gallery[1]); anchorPractical("GALLERY_LIGHT_RIGHT", lightRig.gallery[2]);
    lightRig.task.forEach(({ lamp, bulb, glow }) => { lamp.intensity = mix(day.task, night.task); (bulb.material as MeshBasicMaterial).color.set("#ffe0ad").lerp(new Color("#ffc46e"), t); glow.material.opacity = mix(day.bulbGlow, night.bulbGlow); });
    lightRig.gallery.forEach(({ lamp, bulb, glow }) => { lamp.intensity = mix(day.gallery, night.gallery); (bulb.material as MeshBasicMaterial).color.set("#ffe0ad").lerp(new Color("#ffc46e"), t); glow.material.opacity = mix(day.bulbGlow, night.bulbGlow); });
    warmMaterials.current.forEach(material => { material.emissiveIntensity = mix(1.1, 2.35); });
    // The first rest frame also needs its architectural shadow. Never clear a
    // pending shadow update before Three has rendered it.
    if (quality === "full" && frame.moving) gl.shadowMap.needsUpdate = true;
    const transform = (name: RigRoot, change: (object: Object3D, rest: RestTransform) => void) => {
      const object = rigRoots.current[name]; const rest = object && restTransforms.current.get(object);
      if (object && rest) change(object, rest);
    };
    transform("HEAD_CARRIAGE", (object, rest) => { object.position.copy(rest.position); object.position.x += frame.carriage * .28; });
    transform("FOCUS_LENS", (object, rest) => { object.position.copy(rest.position); object.position.y += frame.focus * .18; });
    transform("SOURCE_SHUTTER", (object, rest) => { object.scale.copy(rest.scale); object.scale.y *= .16 + frame.shutter * .84; });
    transform("FILTER_SELECTOR", (object, rest) => { object.rotation.set(rest.rotation.x, rest.rotation.y + frame.filter * .22, rest.rotation.z); });
    transform("RECEIVER_TOP_ACTION", (object, rest) => { object.position.copy(rest.position); object.position.y += frame.receiverTop * .06; });
    transform("RECEIVER_BOTTOM_ACTION", (object, rest) => { object.position.copy(rest.position); object.position.y -= frame.receiverBottom * .06; });
    asset.updateMatrixWorld(true);
    if (quality === "full" && frame.moving) gl.shadowMap.needsUpdate = true;
    if (path) {
      endpoints.current = updateOpticalPath(path, anchors, attachments.current, frame.travel, frame.optical > .05 && !beamOff, camera, mix(day.beamWidth, night.beamWidth));
      const strength = beamOff ? 0 : frame.shutter * frame.optical;
      path.core.visible = path.halo.visible = strength > 0;
      path.ribbons.forEach(ribbon => { ribbon.visible = strength > 0; });
      path.ribbonMaterial.opacity = mix(day.beamGlow, night.beamGlow) * strength * (1 + .3 * frame.stagePulse);
      path.traveller.visible = path.traveller.visible && strength > .05;
      (path.traveller.material as MeshBasicMaterial).color.set("#fff7df").multiplyScalar(strength);
      (path.core.material as MeshBasicMaterial).color.set("#fff0d0").multiplyScalar(strength);
      (path.halo.material as MeshBasicMaterial).opacity = mix(.065, .16) * strength * (1 + .25 * frame.stagePulse) * (variant && artPass === "C" ? 2 : 1);
      const station = stage === "reward" ? 0 : stage === "pressure" ? 1 : stage === "update" ? 2 : stage === "response" ? 3 : -1;
      path.receivers.forEach((light, index) => {
        const arrival = index < 3 ? Math.max(0, Math.min(1, (frame.travel-path.arrivals[index]+.025)/.08)) : index === 3 ? frame.receiverTop : frame.receiverBottom;
        light.intensity = strength * mix(.65, 1.4) * arrival * (index === station ? 1.45 + frame.stagePulse : 1);
      });
      path.catches.forEach((catchLight, index) => { const passing=Math.max(0,1-Math.abs(frame.travel-path.arrivals[index])/.11); (catchLight.material as MeshBasicMaterial).opacity = strength * (.1+.85*passing); });
      // A source-only finishing glow above an emission threshold. No wall or
      // HTML pixels enter a bloom compositor, and the beam remains readable off.
      const glowThreshold = Math.max(0, Math.min(1, (strength * mix(1.5, 3) - 1.2) / 1.8));
      path.glows.forEach(glow => { glow.material.opacity = queries.get("lab-glow") === "off" || artPass === "A" || artPass === "B" ? 0 : glowThreshold * mix(.12, .28); });
      asset.traverse(child => { if (child instanceof Mesh) for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        if (!(material instanceof MeshStandardMaterial)) continue;
        if (/SOURCE_APERTURE/.test(material.name)) material.emissiveIntensity = strength * mix(1.5, 3);
        if (/DETECTOR_RECEIVER/.test(material.name)) {
          const arrival = /_TOP$/.test(material.name) ? frame.receiverTop : frame.receiverBottom;
          material.emissiveIntensity = strength * mix(.9, 2.4) * (.12 + arrival) * (stage === "response" ? 1 + .35 * frame.stagePulse : 1);
        }
      } });
    }
    updateLabLamps(lamps, camera);
    if (frame.moving && !capture) invalidate();
    else if (!capture && running && !paused && !reducedMotion && frame.nextWakeAt !== null && nextActionTimer.current === null) {
      nextActionTimer.current = window.setTimeout(() => {
        nextActionTimer.current = null;
        const current = renderEligibility.current;
        if (current.running && !current.paused && !current.reducedMotion && !lifecycleSignal.aborted) invalidate();
      }, Math.max(0, frame.nextWakeAt - performance.now()));
    }
  });

  return <>
    <primitive object={lightRig.group} />
    {asset && <><PlinthContact /><primitive object={asset} /></>}
    {anchors && asset && <CameraRig anchors={anchors} asset={asset} framing={framing} pose={pose} />}
    {path && <primitive object={path.object} />}
    {occlusionFixture && <primitive object={occlusionFixture} />}
  </>;
}
