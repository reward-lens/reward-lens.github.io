import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { ACESFilmicToneMapping, AdditiveBlending, AgXToneMapping, Box3, BoxGeometry, BufferGeometry, CanvasTexture, Color, DirectionalLight, Group, HemisphereLight, InstancedMesh, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, NeutralToneMapping, Object3D, PCFShadowMap, PerspectiveCamera, PMREMGenerator, PlaneGeometry, SphereGeometry, Sprite, SpriteMaterial, Texture, Vector3 } from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { enableBakedAo, makeLamp, setLabAoDirect, updateLabLamps, updateLabLines, type LabLamp } from "./lamps";
import { tuneRoomMaterial, type ThemeBinding } from "./materials";
import { makeLabComposer, type LabComposer } from "./post";
import { ATTACHMENT_NAMES, disposeOpticalPath, makeOpticalPath, updateOpticalPath, type AttachmentName } from "./beam";
import { makeStudioScene } from "./studio";
import type { LagoonTheme, InstrumentStage } from "../rebuild/instrument-data";
import { loadLagoonAssetData, type LagoonAnchors, type LagoonBounds } from "./anchors";
import { PulseCadence } from "./cadence.mjs";
import { LAGOON_BEAM, LAGOON_BLOOM, LAGOON_LIGHTS, LAGOON_PRACTICALS, LAGOON_PRESETS, LAGOON_QUALITY, LAGOON_SOFFITS, LAGOON_TONE_MAPPING, lagoonView } from "./presets";
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

const TONE_MAPPINGS = { neutral: NeutralToneMapping, agx: AgXToneMapping, aces: ACESFilmicToneMapping } as const;

/**
 * Fit the key's orthographic shadow camera to the room's world bounds as seen
 * from the light, so the 2048 map spends its texels on the room only.
 */
function fitKeyShadow(key: DirectionalLight, room: Object3D) {
  const box = new Box3().setFromObject(room);
  if (box.isEmpty()) return;
  key.parent?.updateMatrixWorld(true);
  const shadowCamera = key.shadow.camera;
  shadowCamera.position.setFromMatrixPosition(key.matrixWorld);
  shadowCamera.lookAt(new Vector3().setFromMatrixPosition(key.target.matrixWorld));
  shadowCamera.updateMatrixWorld(true);
  const local = new Box3();
  for (let i = 0; i < 8; i++) {
    local.expandByPoint(new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(shadowCamera.matrixWorldInverse));
  }
  const margin = .25;
  Object.assign(shadowCamera, {
    left: local.min.x - margin, right: local.max.x + margin, bottom: local.min.y - margin, top: local.max.y + margin,
    near: Math.max(.1, -local.max.z - margin), far: -local.min.z + margin,
  });
  shadowCamera.updateProjectionMatrix();
}
interface Props {
  stage: InstrumentStage; theme: LagoonTheme; capture: boolean; assetUrl: string;
  running: boolean; paused?: boolean; reducedMotion?: boolean; revision: number; lifecycleSignal: AbortSignal;
  onReady(metrics: LagoonRenderMetrics): void;
  onFrame(metrics: Partial<LagoonRenderMetrics>): void;
  /** Known asset failures return to the poster owner without a React throw. */
  onError?(error: unknown): void;
}
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

/** A soft radial falloff shared by every glow sprite. */
function makeGlowTexture() {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const fade = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  fade.addColorStop(0, "rgba(255,255,255,.8)"); fade.addColorStop(.3, "rgba(255,255,255,.15)"); fade.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = fade; context.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

/** Small or flush parts whose shadows cannot be seen from the hero camera stay out of the key's shadow pass. */
const QUIET_CASTERS = /^(MARBLE_Floor|BRASS_|RUBBER_|PLANT_Leaf|BOOK_|GLASS_|LENS_|SOIL_|POT_|PRINT_|SCREEN_|DISPLAY_)/;
/** Rig parts that animate almost constantly but cast no visible shadow; leaving them out lets the shadow map rest. */
const QUIET_RIG = /^(SOURCE_SHUTTER|FILTER_SELECTOR|RECEIVER_TOP_ACTION|RECEIVER_BOTTOM_ACTION)$/;
const RIG_ROOTS = ["HEAD_CARRIAGE", "FOCUS_LENS", "SOURCE_SHUTTER", "FILTER_SELECTOR", "RECEIVER_TOP_ACTION", "RECEIVER_BOTTOM_ACTION"] as const;
type RigRoot = typeof RIG_ROOTS[number];
interface RestTransform { position: Vector3; rotation: Vector3; scale: Vector3; }

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
  // The bulb is HDR (see bulbRadiance): tone mapping rolls it to a warm
  // white and, in the full tier, it is bright enough to bloom.
  const bulb = new Mesh(new SphereGeometry(.048, 12, 8), new MeshBasicMaterial({ color: "#ffe0ad" }));
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
  // 2048 texels over a frustum fitted to the room (fitKeyShadow). PCFShadowMap
  // is three's soft Vogel-disk filter since r180 (PCFSoftShadowMap now only
  // warns and falls back to it); radius sets the penumbra in texels.
  key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -5, near: .5, far: 28 }); key.shadow.bias = -.0001; key.shadow.normalBias = .016; key.shadow.radius = 4;
  // Cool fill: sky/ground bounce plus a shadowless directional from the
  // right, the side opposite the key.
  const fill = new HemisphereLight("#cfe7ee", "#1b383f", .34);
  const fillDirect = new DirectionalLight("#d4e8f0", .55); fillDirect.position.set(9, 6.5, 8); fillDirect.target.position.set(0, 2.8, -.5);
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
  // Gallery soffit downlights, placed from SOFFIT_LIGHT_n anchors when the
  // room or rig carries them; hidden and dark otherwise.
  const soffitCone = { outer: .8, inner: .3, direction: [0, -1, 0] } as const;
  const soffits = LAGOON_SOFFITS.map(() => {
    const practical = makePractical([0, -50, 0], 3.4, soffitCone, glowMap);
    practical.bulb.visible = practical.glow.visible = false;
    return practical;
  });
  group.add(key, key.target, fill, fillDirect, fillDirect.target);
  for (const practical of [...task, ...gallery, ...soffits]) group.add(practical.bulb, practical.glow);
  return { group, key, fill, fillDirect, task, gallery, soffits };
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
  // Each modeled lamp's aim, exported from Blender with its anchor; a lamp the
  // sidecar does not describe keeps its preset cone.
  const practicalAims = useRef<Partial<Record<string, Vector3>>>({});
  const restTransforms = useRef(new Map<Object3D, RestTransform>());
  const nextActionTimer = useRef<number | null>(null);
  const renderEligibility = useRef({ running, paused, reducedMotion });
  renderEligibility.current = { running, paused, reducedMotion };
  const captureAt = useRef<number | null>(null); const captureResolver = useRef<(() => void) | null>(null);
  const activeFrames = useRef(0); const restFrames = useRef(0); const endpoints = useRef<Record<string, [number, number, number]>>({});
  const lightRig = useMemo(makeLightRig, []);
  const path = useMemo(() => anchors ? makeOpticalPath(anchors) : null, [anchors]);
  const lamps = useMemo(() => [...lightRig.task, ...lightRig.gallery, ...lightRig.soffits].map(practical => practical.lamp).concat(path?.receivers ?? []), [lightRig, path]);
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
  const themeMaterials = useRef<ThemeBinding[]>([]);
  const scrollingUntil = useRef(0);
  const throttleTimer = useRef<number | null>(null);
  /** Carriage and focus the key's shadow map was last drawn for (NaN: draw on the next frame). */
  const shadowPose = useRef([NaN, NaN]);
  const shadowDrawnLastFrame = useRef(false);
  const shadowPending = useRef(false);
  const soffitAnchors = useRef<Array<Object3D | undefined>>([]);
  // Review switches: tone-mapping comparison and bloom tuning (dev and test
  // capture only); `?lab-bloom=off` (any build) and LAGOON_BLOOM.enabled
  // turn the bloom pass off.
  const review = useMemo(() => import.meta.env.DEV || import.meta.env.PUBLIC_INSTRUMENT_CAPTURE === "test" ? new URLSearchParams(location.search) : new URLSearchParams(), []);
  const bloomQuery = useMemo(() => new URLSearchParams(location.search).get("lab-bloom"), []);
  const bloomActive = LAGOON_BLOOM.enabled && bloomQuery !== "off" && quality === "full" && (!capture || bloomQuery === "on");
  const composer = useRef<LabComposer | null>(null);
  const [composerVersion, setComposerVersion] = useState(0);
  const pageColor = useMemo(() => new Color(), []);
  const reportedFailure = useRef(false); const onErrorRef = useRef(onError); onErrorRef.current = onError;
  const reportFailure = useCallback((error: unknown) => {
    if (reportedFailure.current) return;
    reportedFailure.current = true;
    onErrorRef.current?.(error);
  }, []);
  useEffect(() => () => { if (path) disposeOpticalPath(path); }, [path]);
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
    reportedFailure.current = false; ready.current = false; painted.current = false; compiled.current = false; pulsePending.current = false; cadence.current.reset(); themeMaterials.current = []; shadowPose.current.fill(NaN); shadowPending.current = false; soffitAnchors.current = []; practicalAims.current = {}; setQuality("full");
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
        // Development only: add another GLB (same-origin path) to the room,
        // e.g. to compile-check the baked-AO patch against a COLOR_0 export.
        const extra = import.meta.env.DEV ? new URLSearchParams(location.search).get("lab-extra") : null;
        if (extra && /^\/[\w./-]+\.glb$/.test(extra)) {
          const response = await fetch(extra, { signal: controller.signal });
          if (!response.ok) throw new Error(`Laboratory extra returned ${response.status}`);
          const piece = await loader.parseAsync(await response.arrayBuffer(), "/lagoon/");
          piece.scene.name = "DEV_EXTRA_GLB";
          const at = (new URLSearchParams(location.search).get("lab-extra-at") ?? "").split(",").map(Number);
          if (at.length === 3 && at.every(Number.isFinite)) piece.scene.position.set(at[0], at[1], at[2]);
          loaded.add(piece.scene);
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
        soffitAnchors.current = [];
        for (const name of LAGOON_SOFFITS) soffitAnchors.current.push(loaded.getObjectByName(name) ?? undefined);
        performance.mark("lagoon:model-decoded");
        signature.current = meshSignature(loaded, data.anchors);
        loaded.traverse(child => { if (child instanceof Mesh) {
          const materialName = ((Array.isArray(child.material) ? child.material[0] : child.material)?.name ?? "").replace(/\.\d+/g, "");
          let quiet = QUIET_CASTERS.test(materialName);
          for (let parent: Object3D | null = child; parent && !quiet; parent = parent.parent) quiet = QUIET_RIG.test(parent.name);
          child.castShadow = !quiet; child.receiveShadow = true;
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
            // COLOR_0 on a room mesh is baked AO, not albedo.
            if (material instanceof MeshStandardMaterial) enableBakedAo(material, child.geometry);
            const binding = tuneRoomMaterial(material);
            if (binding && !themeMaterials.current.some(entry => entry.material === binding.material)) themeMaterials.current.push(binding);
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
        practicalAims.current = Object.fromEntries(Object.entries(data.practicals).map(([name, practical]) => [name, new Vector3(...practical.direction).normalize()]));
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
    if (!asset) return;
    fitKeyShadow(lightRig.key, asset);
    gl.shadowMap.needsUpdate = true; invalidate();
  }, [asset, gl, invalidate, lightRig]);

  // Full-tier post-processing. Created before the compile effect below so
  // programs compile against its target; disposed on unmount, on a tier or
  // capture change, and while the lost context still owns its handles.
  useEffect(() => {
    if (!bloomActive) return;
    let alive = true; let restoreFrame = 0;
    const lab = makeLabComposer(gl, scene, camera); composer.current = lab;
    const lost = () => { if (composer.current === lab) composer.current = null; lab.dispose(); };
    const restored = () => { restoreFrame = requestAnimationFrame(() => { if (alive) setComposerVersion(version => version + 1); }); };
    gl.domElement.addEventListener("webglcontextlost", lost);
    gl.domElement.addEventListener("webglcontextrestored", restored);
    invalidate();
    return () => {
      alive = false; cancelAnimationFrame(restoreFrame);
      gl.domElement.removeEventListener("webglcontextlost", lost); gl.domElement.removeEventListener("webglcontextrestored", restored);
      if (composer.current === lab) composer.current = null;
      lab.dispose();
    };
  }, [bloomActive, camera, composerVersion, gl, invalidate, scene]);

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
    const tone = review.get("lab-tone");
    gl.toneMapping = TONE_MAPPINGS[tone === "neutral" || tone === "agx" || tone === "aces" ? tone : LAGOON_TONE_MAPPING];
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
      // Programs depend on the target: drawn into the composer's linear
      // target they skip in-material tone mapping and sRGB encoding.
      const lab = bloomActive ? composer.current : null;
      const previousTarget = gl.getRenderTarget();
      if (lab) { lab.sync(size.width, size.height, dpr); gl.setRenderTarget(lab.target); }
      const compiling = gl.compileAsync(scene, camera);
      gl.setRenderTarget(previousTarget);
      void compiling.then(() => {
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
  }, [anchors, asset, bloomActive, camera, capture, composerVersion, environmentVersion, gl, invalidate, quality, reportFailure, review, running, scene, size.height, size.width]);

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

  useEffect(() => {
    if (capture) return;
    const scrolled = () => { scrollingUntil.current = performance.now() + 180; };
    window.addEventListener("scroll", scrolled, { passive: true });
    return () => { window.removeEventListener("scroll", scrolled); if (throttleTimer.current !== null) window.clearTimeout(throttleTimer.current); throttleTimer.current = null; };
  }, [capture]);

  useFrame(() => {
    // Switch the shared page field with the HTML theme so its text keeps full
    // contrast. Set before the readiness guard: the canvas is opaque, so a
    // frame drawn while the room is still loading would otherwise clear to
    // Three's default black and show through the poster's side gutters.
    gl.setClearColor(LAGOON_LIGHTS[theme].background, 1);
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
    // Physical light, exposure and reflections relight together.
    scene.environmentIntensity = mix(day.environment, night.environment) * (variant && (artPass === "A" || artPass === "D") ? 1.8 : 1);
    gl.toneMappingExposure = mix(day.exposure, night.exposure);
    lightRig.key.color.set(day.keyColor).lerp(new Color(night.keyColor), t); lightRig.key.intensity = mix(day.key, night.key);
    lightRig.fill.color.set(day.fillSky).lerp(new Color(night.fillSky), t); lightRig.fill.groundColor.set(day.fillGround).lerp(new Color(night.fillGround), t); lightRig.fill.intensity = mix(day.fill, night.fill);
    lightRig.fillDirect.color.set(day.fillDirectColor).lerp(new Color(night.fillDirectColor), t); lightRig.fillDirect.intensity = mix(day.fillDirect, night.fillDirect);
    setLabAoDirect(mix(day.aoDirect, night.aoDirect));
    const bulbRadiance = mix(day.bulbRadiance, night.bulbRadiance);
    // Exact exported lamp anchors take precedence over their documented world
    // rest positions. The target stays on the local bench/gallery surface,
    // giving modeled emitters a visible, bounded practical pool.
    const anchorPractical = (name: keyof typeof LAGOON_PRACTICALS, practical: Practical) => {
      const anchor = practicalAnchors.current[name];
      practical.lamp.position.copy(anchor ? anchor.getWorldPosition(new Vector3()) : new Vector3(...LAGOON_PRACTICALS[name]));
      practical.bulb.position.copy(practical.lamp.position); practical.glow.position.copy(practical.lamp.position);
      const aim = practicalAims.current[name]; if (aim) practical.lamp.direction.copy(aim);
    };
    anchorPractical("TASK_LIGHT_BENCH_LEFT", lightRig.task[0]); anchorPractical("TASK_LIGHT_BENCH_RIGHT", lightRig.task[1]);
    anchorPractical("TASK_LIGHT_UPPER_LEFT", lightRig.task[2]); anchorPractical("TASK_LIGHT_UPPER_RIGHT", lightRig.task[3]);
    anchorPractical("GALLERY_LIGHT_LEFT", lightRig.gallery[0]); anchorPractical("GALLERY_LIGHT_CENTER", lightRig.gallery[1]); anchorPractical("GALLERY_LIGHT_RIGHT", lightRig.gallery[2]);
    lightRig.task.forEach(({ lamp, bulb, glow }) => { lamp.intensity = mix(day.task, night.task); (bulb.material as MeshBasicMaterial).color.set("#ffe0ad").lerp(new Color("#ffc46e"), t).multiplyScalar(bulbRadiance); glow.material.opacity = mix(day.bulbGlow, night.bulbGlow); });
    lightRig.gallery.forEach(({ lamp, bulb, glow }) => { lamp.intensity = mix(day.gallery, night.gallery); (bulb.material as MeshBasicMaterial).color.set("#ffe0ad").lerp(new Color("#ffc46e"), t).multiplyScalar(bulbRadiance); glow.material.opacity = mix(day.bulbGlow, night.bulbGlow); });
    lightRig.soffits.forEach(({ lamp, bulb, glow }, index) => {
      const anchor = soffitAnchors.current[index];
      bulb.visible = glow.visible = !!anchor;
      if (!anchor) { lamp.intensity = 0; return; }
      anchor.getWorldPosition(lamp.position); bulb.position.copy(lamp.position); glow.position.copy(lamp.position);
      lamp.intensity = mix(day.soffit, night.soffit);
      (bulb.material as MeshBasicMaterial).color.set("#ffe6c2").lerp(new Color("#ffcf8f"), t).multiplyScalar(bulbRadiance); glow.material.opacity = mix(day.bulbGlow, night.bulbGlow) * .8;
    });
    // Glowing families brighten at night; metals and glass keep reflecting
    // the studio when the room goes dark, so the gantry and instruments read.
    themeMaterials.current.forEach(({ material, emissive, env }) => {
      if (emissive) material.emissiveIntensity = mix(emissive[0], emissive[1]);
      if (env) material.envMapIntensity = mix(env[0], env[1]);
    });
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
    // The key's shadow map depends on the rig's pose alone (its frustum is fitted
    // to the room, not the view), and only the carriage and focus cast shadows
    // that move visibly, so parallax and the shutter, filter and receiver
    // animations never redraw it. During continuous motion it follows at half
    // rate and always lands on the final pose. Never clear a pending update
    // before Three has rendered it.
    if (quality === "full") {
      const last = shadowPose.current;
      const changed = frame.carriage !== last[0] || frame.focus !== last[1];
      if (changed || shadowPending.current) {
        if (capture || !changed || !shadowDrawnLastFrame.current) {
          last[0] = frame.carriage; last[1] = frame.focus; gl.shadowMap.needsUpdate = true;
          shadowDrawnLastFrame.current = true; shadowPending.current = false;
        } else { shadowDrawnLastFrame.current = false; shadowPending.current = true; }
      } else shadowDrawnLastFrame.current = false;
    }
    if (path) {
      // The beam reads its per-frame inputs from a reused record (beam.ts).
      const input = path.input;
      input.beamOff = beamOff; input.stage = stage; input.camera = camera; input.height = size.height * gl.getPixelRatio(); input.now = now;
      input.capture = capture ? sampledCapture ?? 0 : null; input.still = reducedMotion; input.tier = quality;
      input.glow = queries.get("lab-glow") !== "off" && artPass !== "A" && artPass !== "B"; input.skirt = variant && artPass === "C" ? 2 : 1;
      endpoints.current = updateOpticalPath(path, anchors, attachments.current, asset, frame);
    }
    updateLabLamps(lamps, camera);
    if (path) updateLabLines(path.light.segments, path.light.starts, path.light.color, LAGOON_BEAM.lineRange, path.light.pulse, camera);
    if ((frame.moving || shadowPending.current) && !capture) {
      // While the page scrolls, the moving room draws at half rate so the
      // browser's own scrolling keeps the GPU. The motion clock is absolute,
      // so a skipped frame never makes anything jump.
      if (now < scrollingUntil.current) {
        if (throttleTimer.current === null) throttleTimer.current = window.setTimeout(() => { throttleTimer.current = null; if (renderEligibility.current.running) invalidate(); }, 28);
      } else invalidate();
    }
    else if (!capture && running && !paused && !reducedMotion && frame.nextWakeAt !== null && nextActionTimer.current === null) {
      nextActionTimer.current = window.setTimeout(() => {
        nextActionTimer.current = null;
        const current = renderEligibility.current;
        if (current.running && !current.paused && !current.reducedMotion && !lifecycleSignal.aborted) invalidate();
      }, Math.max(0, frame.nextWakeAt - performance.now()));
    }
  });

  // Priority 1: R3F skips its own render while this subscriber exists, so
  // every path draws here. The full tier composes scene, bloom and output;
  // other tiers, capture and the frames before the room compiles render
  // directly, exactly as before.
  useFrame((state, delta) => {
    const lab = composer.current;
    if (lab && bloomActive && compiled.current && asset?.visible) {
      const t = motionFrame.current.theme, day = LAGOON_BLOOM.light, night = LAGOON_BLOOM.dark;
      const mix = (a: number, b: number) => a + (b - a) * t;
      const threshold = Number(review.get("lab-bloom-threshold")), strength = Number(review.get("lab-bloom-strength"));
      lab.bloom.threshold = Number.isFinite(threshold) && threshold > 0 ? threshold : mix(day.threshold, night.threshold);
      lab.bloom.strength = Number.isFinite(strength) && strength > 0 ? strength : mix(day.strength, night.strength);
      lab.bloom.radius = mix(day.radius, night.radius);
      lab.sync(state.size.width, state.size.height, state.gl.getPixelRatio());
      lab.render(pageColor.set(LAGOON_LIGHTS[theme].background), delta);
    } else gl.render(scene, camera);
  }, 1);

  return <>
    <primitive object={lightRig.group} />
    {asset && <><PlinthContact /><primitive object={asset} /></>}
    {anchors && asset && <CameraRig anchors={anchors} asset={asset} framing={framing} pose={pose} />}
    {path && <primitive object={path.object} />}
    {occlusionFixture && <primitive object={occlusionFixture} />}
  </>;
}
