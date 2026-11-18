import { ACESFilmicToneMapping, AgXToneMapping, Color, HalfFloatType, NeutralToneMapping, NoBlending, ShaderMaterial, UniformsUtils, Vector2, WebGLRenderTarget, type Camera, type Scene, type ToneMapping, type WebGLRenderer } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { FullScreenQuad, Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * The "full" tier's photographic finish: the scene renders into a
 * four-sample half-float target, a bloom pass lifts only what is brighter
 * than the theme's threshold (bulbs, emissive panels, the beam), and
 * OutputPass applies the renderer's tone mapping and sRGB encoding once.
 *
 * Only the scene pass is multisampled. Its samples are resolved once and
 * copied into a single-sampled buffer that bloom and output work in. When the
 * composer's own buffers carried the samples, bloom blended back into a
 * multisampled target and every later read resolved it again; on an
 * integrated GPU that made antialiasing cost 6.4 of 15.3 ms a frame (Intel
 * Raptor Lake graphics, 1080p). Post-process antialiasing was cheaper but
 * broke the sub-pixel railings into dots, so the samples stay.
 *
 * Rendering into a target moves tone mapping from the materials to the
 * output pass, and that pass would tone-map the cleared background as well.
 * The canvas sits opaque on the page colour, so the clear colour is solved
 * backwards through the same operator: whatever the exposure, the pixels
 * outside the room leave the output pass as the page colour.
 */

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];
/** GLSL mat3 * vec3 with column vectors, exactly as three's shader chunk declares them. */
const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
  m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
  m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const ACES_IN: Mat3 = [[.59719, .07600, .02840], [.35458, .90834, .13383], [.04823, .01566, .83777]];
const ACES_OUT: Mat3 = [[1.60475, -.10208, -.00327], [-.53108, 1.10813, -.07276], [-.07367, -.00605, 1.07602]];
function aces(color: Vec3, exposure: number): Vec3 {
  const v = mul(ACES_IN, color.map(c => c * exposure / .6) as Vec3);
  const fit = v.map(x => (x * (x + .0245786) - .000090537) / (x * (.983729 * x + .4329510) + .238081)) as Vec3;
  return mul(ACES_OUT, fit).map(clamp01) as Vec3;
}

const REC2020_TO_SRGB: Mat3 = [[1.6605, -.1246, -.0182], [-.5876, 1.1329, -.1006], [-.0728, -.0083, 1.1187]];
const SRGB_TO_REC2020: Mat3 = [[.6274, .0691, .0164], [.3293, .9195, .0880], [.0433, .0113, .8956]];
const AGX_INSET: Mat3 = [[.856627153315983, .137318972929847, .11189821299995], [.0951212405381588, .761241990602591, .0767994186031903], [.0482516061458583, .101439036467562, .811302368396859]];
const AGX_OUTSET: Mat3 = [[1.1271005818144368, -.1413297634984383, -.14132976349843826], [-.11060664309660323, 1.157823702216272, -.11060664309660294], [-.016493938717834573, -.016493938717834257, 1.2519364065950405]];
function agx(color: Vec3, exposure: number): Vec3 {
  const minEv = -12.47393, maxEv = 4.026069;
  let v = mul(AGX_INSET, mul(SRGB_TO_REC2020, color.map(c => c * exposure) as Vec3));
  v = v.map(x => clamp01((Math.log2(Math.max(x, 1e-10)) - minEv) / (maxEv - minEv))) as Vec3;
  v = v.map(x => { const x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + .4298 * x2 + .1191 * x - .00232; }) as Vec3;
  v = mul(AGX_OUTSET, v).map(x => Math.pow(Math.max(0, x), 2.2)) as Vec3;
  return mul(REC2020_TO_SRGB, v).map(clamp01) as Vec3;
}

function neutral(color: Vec3, exposure: number): Vec3 {
  const start = .8 - .04, desaturation = .15;
  let c = color.map(x => x * exposure) as Vec3;
  const x = Math.min(c[0], c[1], c[2]);
  const offset = x < .08 ? x - 6.25 * x * x : .04;
  c = c.map(v => v - offset) as Vec3;
  const peak = Math.max(c[0], c[1], c[2]);
  if (peak < start) return c;
  const d = 1 - start, newPeak = 1 - d * d / (peak + d - start);
  c = c.map(v => v * newPeak / peak) as Vec3;
  const g = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return c.map(v => v + (newPeak - v) * g) as Vec3;
}

function operator(toneMapping: ToneMapping): ((color: Vec3, exposure: number) => Vec3) | null {
  return toneMapping === NeutralToneMapping ? neutral : toneMapping === AgXToneMapping ? agx : toneMapping === ACESFilmicToneMapping ? aces : null;
}

/** Linear working-space colour that the output pass maps to `display` (an sRGB colour). */
export function untoneMappedClear(display: Color, toneMapping: ToneMapping, exposure: number, out = new Color()): Color {
  const target: Vec3 = [display.r, display.g, display.b]; // Color stores linear working-space values.
  const f = operator(toneMapping);
  if (!f) return out.setRGB(target[0] / exposure, target[1] / exposure, target[2] / exposure);
  // Damped Newton with a numerical Jacobian; the operators are smooth and
  // monotone over display colours, so a handful of steps reach float precision.
  let x: Vec3 = [...target];
  for (let iteration = 0; iteration < 24; iteration++) {
    const y = f(x, exposure);
    const r: Vec3 = [target[0] - y[0], target[1] - y[1], target[2] - y[2]];
    if (Math.max(Math.abs(r[0]), Math.abs(r[1]), Math.abs(r[2])) < 1e-7) break;
    const h = 1e-5, J: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let j = 0; j < 3; j++) {
      const probe: Vec3 = [...x]; probe[j] += h;
      const yp = f(probe, exposure);
      for (let i = 0; i < 3; i++) J[i][j] = (yp[i] - y[i]) / h;
    }
    const det = J[0][0] * (J[1][1] * J[2][2] - J[1][2] * J[2][1]) - J[0][1] * (J[1][0] * J[2][2] - J[1][2] * J[2][0]) + J[0][2] * (J[1][0] * J[2][1] - J[1][1] * J[2][0]);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;
    const solve = (col: number) => { const m = J.map(row => [...row]) as Mat3; for (let i = 0; i < 3; i++) m[i][col] = r[i]; return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])) / det; };
    x = [Math.max(0, x[0] + solve(0)), Math.max(0, x[1] + solve(1)), Math.max(0, x[2] + solve(2))];
  }
  return out.setRGB(x[0], x[1], x[2]);
}

export interface LabComposer {
  bloom: UnrealBloomPass;
  /** Renders scene, bloom and output to the canvas with the page colour preserved outside the room. */
  render(page: Color, delta: number): void;
  /** Matches the drawing buffer; cheap when nothing changed. */
  sync(width: number, height: number, pixelRatio: number): void;
  dispose(): void;
  /** The target the scene is drawn into, for compiling programs with matching parameters. */
  readonly target: WebGLRenderTarget;
}

/**
 * Draws the scene into its own multisampled target, cleared to the solved
 * page colour, and copies the resolved image into the composer's read buffer.
 */
class MultisampleScenePass extends Pass {
  readonly target: WebGLRenderTarget;
  readonly clearColor = new Color();
  readonly #scene: Scene;
  readonly #camera: Camera;
  readonly #copy: FullScreenQuad;
  readonly #material: ShaderMaterial;

  constructor(scene: Scene, camera: Camera, samples: number) {
    super();
    this.#scene = scene; this.#camera = camera;
    this.target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples });
    this.target.texture.name = "LabComposer.scene";
    this.#material = new ShaderMaterial({ uniforms: UniformsUtils.clone(CopyShader.uniforms), vertexShader: CopyShader.vertexShader, fragmentShader: CopyShader.fragmentShader, blending: NoBlending, depthTest: false, depthWrite: false });
    this.#copy = new FullScreenQuad(this.#material);
    this.needsSwap = false;
  }

  setSize(width: number, height: number) { this.target.setSize(width, height); }

  render(renderer: WebGLRenderer, _writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget) {
    // setClearColor encodes for the target bound at call time, so bind first.
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(this.clearColor, 1);
    renderer.clear(true, true, true);
    // Three resolves the samples into target.texture as this render ends.
    renderer.render(this.#scene, this.#camera);
    this.#material.uniforms.tDiffuse.value = this.target.texture;
    renderer.setRenderTarget(readBuffer);
    this.#copy.render(renderer);
  }

  dispose() { this.target.dispose(); this.#material.dispose(); this.#copy.dispose(); }
}

export function makeLabComposer(gl: WebGLRenderer, scene: Scene, camera: Camera, samples = 4): LabComposer {
  const composer = new EffectComposer(gl, new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 0, depthBuffer: false }));
  const scenePass = new MultisampleScenePass(scene, camera, samples);
  const bloom = new UnrealBloomPass(new Vector2(1, 1), .5, .5, 1);
  const output = new OutputPass();
  composer.addPass(scenePass); composer.addPass(bloom); composer.addPass(output);
  let clearKey = "";
  let width = 0, height = 0, ratio = 0, disposed = false;
  return {
    bloom,
    render(page, delta) {
      const key = `${page.getHexString()}|${gl.toneMapping}|${gl.toneMappingExposure.toFixed(5)}`;
      if (key !== clearKey) { untoneMappedClear(page, gl.toneMapping, gl.toneMappingExposure, scenePass.clearColor); clearKey = key; }
      const previousAlpha = gl.getClearAlpha();
      composer.render(delta);
      gl.setRenderTarget(null);
      gl.setClearColor(page, previousAlpha);
    },
    sync(nextWidth, nextHeight, nextRatio) {
      if (nextWidth === width && nextHeight === height && nextRatio === ratio) return;
      width = nextWidth; height = nextHeight; ratio = nextRatio;
      composer.setPixelRatio(ratio); composer.setSize(width, height);
    },
    get target() { return scenePass.target; },
    dispose() { if (disposed) return; disposed = true; scenePass.dispose(); bloom.dispose(); output.dispose(); composer.dispose(); },
  };
}
