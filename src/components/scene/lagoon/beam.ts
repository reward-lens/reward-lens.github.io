import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Points, ShaderMaterial, Vector3, type Camera, type Object3D } from "three";
import type { LagoonAnchors } from "./anchors";
import { makeLamp, type LabLamp } from "./lamps";
import { LAGOON_BEAM, LAGOON_LIGHTS } from "./presets";

export const ATTACHMENT_NAMES = ["SOURCE_ATTACHMENT", "PRISM_ATTACHMENT", "SPECIMEN_ATTACHMENT", "RECEIVER_TOP_ATTACHMENT", "RECEIVER_BOTTOM_ATTACHMENT"] as const;
export type AttachmentName = typeof ATTACHMENT_NAMES[number];
type Attachments = Partial<Record<AttachmentName, Object3D>>;

/** Per-frame inputs the scene writes in place, so an update allocates nothing but its return record. */
export interface BeamInput {
  beamOff: boolean; stage: string; camera: Camera | null; height: number; now: number;
  /** Sampled capture time in ms, or null when live. */
  capture: number | null; still: boolean; tier: "full" | "reduced" | "compact"; glow: boolean; skirt: number;
}
interface BeamFrame { travel: number; optical: number; shutter: number; stagePulse: number; receiverTop: number; receiverBottom: number; theme: number; }
type ShaderPoints = Points<BufferGeometry, ShaderMaterial>;
export interface OpticalPath {
  object: Group; receivers: LabLamp[]; arrivals: number[]; input: BeamInput;
  shaft: Mesh<BufferGeometry, ShaderMaterial>; motes: ShaderPoints; sparks: ShaderPoints;
  fan: Mesh<BufferGeometry, MeshBasicMaterial>; pool: Mesh<PlaneGeometry, MeshBasicMaterial>;
  xs: number[]; clock: number; last: number; rigAsset: Object3D | null; rig: MeshStandardMaterial[];
  /** The beam as a line light (lamps.ts): segments, arc length at each start, colour and the travelling pulse. */
  light: { segments: Array<readonly [Vector3, Vector3]>; starts: number[]; color: Color; pulse: { at: number; width: number; gain: number } };
}

const BRANCH = 20, MOTES = 120, SPARKS = 10;
/** Strips of the shaft as [first point, point count]: main axis, top and bottom branches, two grating orders. */
const STRIPS = [[0, 4], [4, BRANCH + 1], [5 + BRANCH, BRANCH + 1], [6 + 2 * BRANCH, 2], [8 + 2 * BRANCH, 2]] as const;
const POINTS = 10 + 2 * BRANCH;
/** Lens mounts on the optical axis (instruments.md); they have no exported anchors. */
const LENSES = [-3.25, -.55, .95];
/** Travel direction into both receiver ports: their faces point along (-0.34, 0, 0.94). */
const INTO_PORT = new Vector3(.34, 0, -.94).normalize();
/** First diffraction orders at 9 degrees. They fan in the vertical plane: from the hero camera a horizontal fan lies on the axis. */
const ORDERS = [new Vector3(1, Math.tan(.157), 0).normalize(), new Vector3(1, -Math.tan(.157), 0).normalize()];
// Sparks: 0 emitter flare, 1 prism, 2-4 lenses, 5 grating, 6 specimen, 7 splitter, 8-9 receiver flares.
const STAGES = ["reward", "pressure", "update", "response"];
const SPARK_SIZE = [.9, .42, .28, .28, .28, .34, .3, .36, .55, .55];
const SPARK_KIND = [2, 1, 1, 1, 1, 1, 1, 1, 2, 2];
/** Lowest tier rank that draws each spark: compact 0, reduced 1, full 2. */
const SPARK_TIER = [0, 1, 2, 2, 2, 1, 1, 1, 0, 0];
const LINE = new Color("#ffc47a"), CORE = new Color("#fff1d8"), SKIRT = new Color("#ffb05a"), EMBER = new Color("#ffd49a"), GLINT = new Color("#fff4e2"), PORT = new Color("#ffd08b");
/** Bench pools in world x, z, half-length, half-width (m) and weight. */
const POOLS = [[-1.2, .85, 2.9, .2, .4], [-3.8, .85, .3, .18, .35], [-2.35, .85, .55, .24, .65], [.25, .85, .55, .24, .65], [1.85, .98, .5, .18, .22], [2.2, 1.08, .24, .14, .18]];

const TAIL = "#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}";
const SHAFT_V = `attribute vec3 aT;attribute vec4 aD;uniform float uWidth;varying vec3 vD;
void main(){vec3 a=normalize(cross(aT,cameraPosition-position));vD=aD.xyw;
gl_Position=projectionMatrix*viewMatrix*vec4(position+a*aD.x*aD.z*uWidth,1.);}`;
// Gaussian core plus a wide soft skirt, a slow shimmer scrolling down the beam and the travelling pulse by arc length.
const SHAFT_F = `uniform vec3 uCore,uSkirt;uniform float uTime,uShimmer,uPulse,uPulseAmp;varying vec3 vD;
void main(){float v=vD.x,s=vD.y,d=(s-uPulse)*5.,p=uPulseAmp*exp(-d*d);
float n=1.+uShimmer*(.6*sin((s-uTime*.35)*9.)+.4*sin((s-uTime*.22)*23.+1.7*sin(s*2.3)));
gl_FragColor=vec4((uCore*exp(-v*v*36.)*(1.+p)+uSkirt*exp(-v*v*4.)*(1.-v*v)*(1.+.6*p))*n*vD.z*smoothstep(0.,.1,s),1.);
${TAIL}`;
const MOTE_V = `uniform vec3 uA,uB;uniform float uTime,uR,uScale,uLevel;varying float vB;
void main(){float k=fract(position.z*7.31),w=.004+.006*k,u=fract(position.x+uTime*w),a=position.z+uTime*w*9.;
vec4 m=viewMatrix*vec4(mix(uA,uB,u)+vec3(0.,sin(a),cos(a))*position.y*uR,1.);gl_Position=projectionMatrix*m;
gl_PointSize=max(1.5,uScale*(.03+.025*k)/-m.z);
vB=uLevel*exp(-position.y*position.y*3.)*smoothstep(0.,.05,u)*smoothstep(1.,.95,u)*(.65+.35*sin(uTime*1.1+position.z*5.));}`;
const MOTE_F = `uniform vec3 uColor;varying float vB;
void main(){vec2 c=gl_PointCoord*2.-1.;float g=max(0.,1.-dot(c,c));gl_FragColor=vec4(uColor*vB*g*g,1.);
${TAIL}`;
const SPARK_V = `attribute vec3 aC;attribute vec2 aS;uniform float uScale;varying vec3 vC;varying float vK;
void main(){vec4 m=viewMatrix*vec4(position,1.);gl_Position=projectionMatrix*m;gl_PointSize=uScale*aS.x/-m.z;vC=aC;vK=aS.y;}`;
// 0 soft glow, 1 four-ray glint, 2 flare with a horizontal streak.
const SPARK_F = `varying vec3 vC;varying float vK;
void main(){vec2 c=gl_PointCoord*2.-1.;float r=dot(c,c),e=max(0.,1.-r),g,x=1.-abs(c.x);
if(vK<.5)g=exp(-r*7.)*e;
else if(vK<1.5)g=exp(-r*30.)+1.2*e*(exp(-abs(c.x)*3.5-c.y*c.y*700.)+exp(-abs(c.y)*3.5-c.x*c.x*700.));
else g=exp(-r*30.)+.3*exp(-r*5.)*e+.8*exp(-c.y*c.y*600.)*x*x;
gl_FragColor=vec4(vC*g,1.);
${TAIL}`;

const uniform = <T>(value: T) => ({ value });
const additive = { transparent: true, blending: AdditiveBlending, depthWrite: false } as const;
function attribute(geometry: BufferGeometry, name: string, count: number, size: number) {
  geometry.setAttribute(name, new BufferAttribute(new Float32Array(count * size), size));
}
function seeded(seed: number) {
  return () => { seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/** A soft warm footprint on the table top under the beam, drawn once into a canvas. */
function makePool() {
  const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 64;
  const context = canvas.getContext("2d")!; context.globalCompositeOperation = "lighter";
  const px = 256 / 7, pz = 64 / 1.2;
  for (const [x, z, sx, sz, a] of POOLS) {
    const fade = context.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const [stop, weight] of [[0, 1], [.4, .5], [.75, .12], [1, 0]]) fade.addColorStop(stop, `rgba(255,255,255,${a * weight})`);
    context.setTransform(sx * px, 0, 0, sz * pz, (x + 4.2) * px, (z - .35) * pz);
    context.fillStyle = fade; context.fillRect(-1, -1, 2, 2);
  }
  const pool = new Mesh(new PlaneGeometry(7, 1.2), new MeshBasicMaterial({ map: new CanvasTexture(canvas), color: "#ffb468", opacity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...additive }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(-.7, 2.303, .95); pool.name = "BENCH_LIGHT";
  return pool;
}

/** A faint red-to-violet fan, ten degrees wide, bending down from the prism clear of the beam's skirt while the beam continues. */
function makeFan() {
  const position: number[] = [], color: number[] = [], index: number[] = [], hue = new Color();
  // Three rings (near, middle, far) per ray; the colour fades to nothing over half a metre.
  for (let j = 0; j <= 8; j++) {
    const angle = -(8 + 1.25 * j) * Math.PI / 180;
    hue.setHSL(.78 * j / 8, 1, .5).multiplyScalar(j % 8 ? 6 : 1.5);
    for (const [radius, weight] of [[.03, 1], [.22, .55], [.5, 0]]) {
      position.push(radius * Math.cos(angle), radius * Math.sin(angle), 0); color.push(hue.r * weight, hue.g * weight, hue.b * weight);
    }
    if (j < 8) for (let k = 0; k < 2; k++) { const v = 3 * j + k; index.push(v, v + 1, v + 3, v + 1, v + 4, v + 3); }
  }
  const geometry = new BufferGeometry(); geometry.setIndex(index);
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(color), 3));
  const fan = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, opacity: 0, ...additive }));
  fan.name = "PRISM_DISPERSION"; fan.renderOrder = 5;
  return fan;
}

export function makeOpticalPath(anchors: LagoonAnchors): OpticalPath {
  const object = new Group(); object.name = "ILLUSTRATIVE_OPTICAL_PATH";
  const shaftGeometry = new BufferGeometry(); const index: number[] = [];
  attribute(shaftGeometry, "position", 2 * POINTS, 3); attribute(shaftGeometry, "aT", 2 * POINTS, 3); attribute(shaftGeometry, "aD", 2 * POINTS, 4);
  for (const [start, count] of STRIPS) for (let i = start; i < start + count - 1; i++) index.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  shaftGeometry.setIndex(index);
  // The shaft stays in the opaque list (additive, no depth write, drawn after
  // the room) so the hero prism's transmission input still carries the beam.
  // Depth testing stays on: solid mounts and housings occlude the path.
  const shaft = new Mesh(shaftGeometry, new ShaderMaterial({
    uniforms: { uWidth: uniform(.1), uCore: uniform(new Color()), uSkirt: uniform(new Color()), uTime: uniform(0), uShimmer: uniform(0), uPulse: uniform(0), uPulseAmp: uniform(0) },
    vertexShader: SHAFT_V, fragmentShader: SHAFT_F, blending: AdditiveBlending, depthWrite: false,
  }));
  shaft.name = "OPTICAL_SHAFT"; shaft.renderOrder = 4;
  const random = seeded(0x5eed), seeds = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES; i++) { seeds[3 * i] = random(); seeds[3 * i + 1] = random() ** .7; seeds[3 * i + 2] = random() * 6.283; }
  const moteGeometry = new BufferGeometry(); moteGeometry.setAttribute("position", new BufferAttribute(seeds, 3));
  const motes = new Points(moteGeometry, new ShaderMaterial({
    uniforms: { uA: uniform(new Vector3()), uB: uniform(new Vector3()), uTime: uniform(0), uR: uniform(.1), uScale: uniform(1), uLevel: uniform(0), uColor: uniform(new Color("#ffe2b0")) },
    vertexShader: MOTE_V, fragmentShader: MOTE_F, ...additive,
  }));
  motes.name = "OPTICAL_MOTES"; motes.renderOrder = 5;
  const sparkGeometry = new BufferGeometry();
  attribute(sparkGeometry, "position", SPARKS, 3); attribute(sparkGeometry, "aC", SPARKS, 3); attribute(sparkGeometry, "aS", SPARKS, 2);
  const sparks = new Points(sparkGeometry, new ShaderMaterial({ uniforms: { uScale: uniform(1) }, vertexShader: SPARK_V, fragmentShader: SPARK_F, ...additive }));
  sparks.name = "OPTICAL_SPARKS"; sparks.renderOrder = 6;
  // Every object here is placed in world space by the shaders or each frame.
  for (const item of [shaft, motes, sparks]) item.frustumCulled = false;
  const fan = makeFan(), pool = makePool();
  object.add(pool, shaft, fan, motes, sparks);
  const receivers = ["BEAM_ENTRY", "BEAM_AFTER_PRISM", "SPECIMEN_FOCUS", "DETECTOR_TOP", "DETECTOR_BOTTOM"].map(name => makeLamp(anchors[name], "#ffd08b", 1.8));
  const xs = [anchors.PRISM[0], ...LENSES, anchors.GRATING[0], anchors.SPECIMEN_FOCUS[0] + .02];
  const input: BeamInput = { beamOff: false, stage: "", camera: null, height: 1, now: 0, capture: null, still: false, tier: "full", glow: true, skirt: 1 };
  // P is shared module state updated in place each frame, so the segments track the live path.
  const light = { segments: [[P[0], P[1]], [P[1], P[2]], [P[2], P[3]], [P[3], P[4]], [P[3], P[5]]] as Array<readonly [Vector3, Vector3]>, starts: [0, 0, 0, 0, 0], color: new Color(0, 0, 0), pulse: { at: 0, width: .35, gain: 0 } };
  return { object, receivers, arrivals: [0, .5, .75, 1, 1], input, shaft, motes, sparks, fan, pool, xs, clock: 0, last: 0, rigAsset: null, rig: [], light };
}

export function disposeOpticalPath(path: OpticalPath) {
  for (const item of [path.shaft, path.motes, path.sparks, path.fan, path.pool]) { item.geometry.dispose(); item.material.dispose(); }
  path.pool.material.map?.dispose();
}

const P = Array.from({ length: 6 }, () => new Vector3()); // entry, after prism, specimen, split, top port, bottom port
const S = [0, 0, 0, 0], SPARK_S = new Float32Array(SPARKS), SPARK_AT = Array.from({ length: SPARKS }, () => new Vector3());
const tangent = new Vector3(), c1 = new Vector3(), c2 = new Vector3(), q = new Vector3(), r = new Vector3(), prev = new Vector3(), view = new Vector3(), tint = new Color();
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const flash = (travel: number, at: number, on: boolean) => on ? Math.exp(-(((travel - at) / .03) ** 2)) : 0;

function live(attachments: Attachments, anchors: LagoonAnchors, name: AttachmentName, anchor: string, out: Vector3) {
  const object = attachments[name];
  return object ? object.getWorldPosition(out) : out.fromArray(anchors[anchor]);
}

/** A point on the main axis (entry to split) at world x; returns its arc length. */
function axis(x: number, out: Vector3) {
  let i = 0; while (i < 2 && x > P[i + 1].x) i++;
  const f = Math.max(0, Math.min(1, (x - P[i].x) / (P[i + 1].x - P[i].x || 1)));
  out.lerpVectors(P[i], P[i + 1], f); return S[i] + f * (S[i + 1] - S[i]);
}

/** Writes both edge vertices of shaft point i: centre, unit tangent, arc length (m), width scale and energy. */
function put(shaft: OpticalPath["shaft"], i: number, p: Vector3, t: Vector3, s: number, w: number, e: number) {
  const { position, aT, aD } = shaft.geometry.attributes;
  for (let k = 0; k < 2; k++) {
    const v = 2 * i + k;
    position.setXYZ(v, p.x, p.y, p.z); aT.setXYZ(v, t.x, t.y, t.z); aD.setXYZW(v, k ? 1 : -1, s, w, e);
  }
}

/** A cubic branch leaving the split along +x and arriving into a port along INTO_PORT; returns its end arc length. */
function branch(shaft: OpticalPath["shaft"], first: number, end: Vector3) {
  const length = P[3].distanceTo(end) * .45;
  c1.copy(P[3]).x += length; c2.copy(end).addScaledVector(INTO_PORT, -length);
  let s = S[3]; prev.copy(P[3]);
  for (let i = 0; i <= BRANCH; i++) {
    const t = i / BRANCH, m = 1 - t;
    q.copy(P[3]).multiplyScalar(m * m * m).addScaledVector(c1, 3 * m * m * t).addScaledVector(c2, 3 * m * t * t).addScaledVector(end, t * t * t);
    tangent.subVectors(c1, P[3]).multiplyScalar(3 * m * m).addScaledVector(r.subVectors(c2, c1), 6 * m * t).addScaledVector(r.subVectors(end, c2), 3 * t * t).normalize();
    s += q.distanceTo(prev); prev.copy(q);
    put(shaft, first + i, q, tangent, s, .8 * (1 - .5 * smooth(.55, 1, t)), .55 + .3 * smooth(0, .35, t));
  }
  return s;
}

/** Dynamic endpoints use articulated world positions; the static map remains an immutable rest reference. */
export function updateOpticalPath(path: OpticalPath, anchors: LagoonAnchors, attachments: Attachments, asset: Object3D, frame: BeamFrame) {
  const { input, shaft, motes, sparks, fan, pool, receivers, arrivals } = path;
  const camera = input.camera!, t = frame.theme;
  live(attachments, anchors, "SOURCE_ATTACHMENT", "BEAM_ENTRY", P[0]); live(attachments, anchors, "PRISM_ATTACHMENT", "BEAM_AFTER_PRISM", P[1]);
  live(attachments, anchors, "SPECIMEN_ATTACHMENT", "SPECIMEN_FOCUS", P[2]); P[3].fromArray(anchors.DETECTOR_SPLIT);
  live(attachments, anchors, "RECEIVER_TOP_ATTACHMENT", "DETECTOR_TOP", P[4]); live(attachments, anchors, "RECEIVER_BOTTOM_ATTACHMENT", "DETECTOR_BOTTOM", P[5]);
  for (let i = 1; i < 4; i++) S[i] = S[i - 1] + P[i].distanceTo(P[i - 1]);
  for (let i = 0; i < 4; i++) put(shaft, i, P[i], tangent.subVectors(P[Math.min(3, i + 1)], P[Math.max(0, i - 1)]).normalize(), S[i], 1, 1);
  const total = branch(shaft, 4, P[4]), lower = branch(shaft, 5 + BRANCH, P[5]);
  const sGrating = axis(path.xs[4], q);
  for (let k = 0; k < 2; k++) {
    put(shaft, 6 + 2 * BRANCH + 2 * k, q, ORDERS[k], sGrating, .3, .22);
    put(shaft, 7 + 2 * BRANCH + 2 * k, r.copy(q).addScaledVector(ORDERS[k], .4), ORDERS[k], sGrating + .4, .55, 0);
  }
  const edges = shaft.geometry.attributes; edges.position.needsUpdate = edges.aT.needsUpdate = edges.aD.needsUpdate = true;
  arrivals[1] = S[1] / total; arrivals[2] = S[2] / total; arrivals[3] = 1; arrivals[4] = lower / total;

  // The beam clock follows rendered frames (clamped, so a rest never jumps it),
  // stands still under reduced motion and is the sampled time in capture.
  if (input.capture !== null) path.clock = input.capture / 1000;
  else if (!input.still) path.clock += Math.min(.05, Math.max(0, (input.now - path.last) / 1000));
  path.last = input.now;
  const strength = input.beamOff ? 0 : frame.shutter * frame.optical, travel = frame.travel;
  // An idle beam still clears the day bloom threshold; it fades out only as the shutter closes.
  const level = strength > 0 ? Math.min(1, strength * 8) * (.7 + .3 * strength) : 0, gain = LAGOON_BEAM.gain;
  const day = LAGOON_BEAM.light, night = LAGOON_BEAM.dark, width = lerp(LAGOON_LIGHTS.light.beamWidth, LAGOON_LIGHTS.dark.beamWidth, t);
  const pulseOn = !input.beamOff && frame.optical > .05 && strength > .05 && travel > 0 && travel < 1;
  const scale = input.height * camera.projectionMatrix.elements[5] * .5;
  shaft.visible = motes.visible = sparks.visible = fan.visible = pool.visible = level > 0;
  const su = shaft.material.uniforms;
  su.uWidth.value = width * .5; su.uTime.value = path.clock; su.uShimmer.value = input.still ? 0 : .1;
  (su.uCore.value as Color).copy(CORE).multiplyScalar(gain * level);
  (su.uSkirt.value as Color).copy(SKIRT).multiplyScalar(lerp(day.skirt, night.skirt, t) * level * input.skirt * (1 + .3 * frame.stagePulse));
  su.uPulse.value = travel * total; su.uPulseAmp.value = pulseOn ? 1.6 * strength / Math.max(level, .1) : 0;
  const mu = motes.material.uniforms, count = LAGOON_BEAM.motes[input.tier];
  (mu.uA.value as Vector3).copy(P[0]); (mu.uB.value as Vector3).copy(P[3]);
  mu.uTime.value = path.clock; mu.uR.value = width * .4; mu.uScale.value = scale; mu.uLevel.value = lerp(day.motes, night.motes, t) * level;
  motes.geometry.setDrawRange(0, count); motes.visible &&= count > 0;
  axis(path.xs[0], fan.position); fan.material.opacity = lerp(day.fan, night.fan, t) * level;
  pool.material.opacity = lerp(day.pool, night.pool, t) * level * (1 + .3 * frame.stagePulse);
  // The beam lights what lies near it; the pulse brightens that light where it travels.
  const light = path.light;
  light.starts[0] = 0; light.starts[1] = S[1]; light.starts[2] = S[2]; light.starts[3] = S[3]; light.starts[4] = S[3];
  light.color.copy(LINE).multiplyScalar(level * lerp(day.line, night.line, t) * (1 + .25 * frame.stagePulse));
  light.pulse.at = travel * total; light.pulse.gain = pulseOn ? lerp(day.pulseLight, night.pulseLight, t) * strength / Math.max(level, .1) : 0;

  // Sparks sit a little toward the camera so the glass and housings they mark do not swallow them.
  SPARK_AT[0].copy(P[0]); SPARK_S[0] = 0;
  for (let i = 1; i < 7; i++) SPARK_S[i] = axis(path.xs[i - 1], SPARK_AT[i]);
  SPARK_AT[7].copy(P[3]); SPARK_S[7] = S[3]; SPARK_AT[8].copy(P[4]); SPARK_S[8] = total; SPARK_AT[9].copy(P[5]); SPARK_S[9] = lower;
  const rank = input.tier === "full" ? 2 : input.tier === "reduced" ? 1 : 0;
  const { position, aC, aS } = sparks.geometry.attributes;
  camera.getWorldPosition(view);
  for (let i = 0; i < SPARKS; i++) {
    const at = SPARK_AT[i], show = input.glow && SPARK_TIER[i] <= rank;
    at.addScaledVector(r.subVectors(view, at).normalize(), i < 8 ? .12 : .06);
    position.setXYZ(i, at.x, at.y, at.z);
    const arrive = flash(travel, SPARK_S[i] / total, pulseOn);
    if (i === 0) tint.copy(EMBER).multiplyScalar(gain * level * (1 + .35 * frame.stagePulse));
    else if (i < 8) tint.copy(GLINT).multiplyScalar(gain * (.45 * level + 1.4 * strength * arrive));
    else tint.copy(PORT).multiplyScalar(gain * strength * (.1 + .9 * (i === 8 ? frame.receiverTop : frame.receiverBottom) + 1.2 * arrive));
    if (!show) tint.setRGB(0, 0, 0);
    aC.setXYZ(i, tint.r, tint.g, tint.b); aS.setXY(i, show ? SPARK_SIZE[i] : 0, SPARK_KIND[i]);
  }
  position.needsUpdate = aC.needsUpdate = aS.needsUpdate = true;
  sparks.material.uniforms.uScale.value = scale;

  // Practical lamps at the stations and ports, as before.
  const station = STAGES.indexOf(input.stage);
  for (let i = 0; i < 5; i++) {
    const light = receivers[i];
    light.position.copy(P[i < 3 ? i : i + 1]); light.position.z += .045;
    const arrival = i < 3 ? Math.max(0, Math.min(1, (travel - arrivals[i] + .025) / .08)) : i === 3 ? frame.receiverTop : frame.receiverBottom;
    light.intensity = strength * lerp(.65, 1.4, t) * arrival * (i === station ? 1.45 + frame.stagePulse : 1);
  }
  if (path.rigAsset !== asset) {
    path.rigAsset = asset; path.rig = [];
    asset.traverse(child => { if (child instanceof Mesh) for (const material of [child.material].flat()) if (material instanceof MeshStandardMaterial && /SOURCE_APERTURE|DETECTOR_RECEIVER/.test(material.name)) path.rig.push(material); });
  }
  for (const material of path.rig) {
    if (/SOURCE_APERTURE/.test(material.name)) { material.emissiveIntensity = strength * lerp(1.5, 3, t); continue; }
    const arrival = /_TOP$/.test(material.name) ? frame.receiverTop : frame.receiverBottom;
    material.emissiveIntensity = strength * lerp(.9, 2.4, t) * (.12 + arrival) * (input.stage === "response" ? 1 + .35 * frame.stagePulse : 1);
  }
  const named: Array<[string, Vector3]> = [["BEAM_ENTRY", P[0]], ["BEAM_AFTER_PRISM", P[1]], ["SPECIMEN_FOCUS", P[2]], ["DETECTOR_SPLIT", P[3]], ["DETECTOR_TOP", P[4]], ["DETECTOR_BOTTOM", P[5]]];
  return Object.fromEntries(named.map(([name, value]) => [name, value.toArray() as [number, number, number]]));
}
