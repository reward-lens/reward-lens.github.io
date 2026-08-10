/**
 * The room's own light, captured once as a prefiltered environment.
 *
 * WHY THIS FILE IS THE MOST IMPORTANT ONE IN THE SCENE. A physically based
 * metal is almost entirely a mirror: `MeshStandardMaterial` at metalness 1 has
 * essentially no diffuse response, so its colour is whatever it reflects. With
 * `scene.environment` unset there is nothing to reflect except the analytic
 * lights, and an analytic light contributes a single specular lobe, so the
 * surface returns one hot spot on black. That is what the first render did, and
 * the response was to slide metalness down to 0.12-0.22 until the diffuse term
 * came back, which turns anodized aluminium into grey plastic. The fix is never
 * to make the metal less metal. It is to give it something to reflect.
 *
 * WHY IT IS AUTHORED AND NOT DOWNLOADED. This room is near black with one
 * bright source. A studio HDRI is a bright room with a large white softbox and
 * a visible horizon, and dropping one in here lights the bench from everywhere
 * at once, which is precisely the flat look the composition is built to avoid.
 * It would also import someone else's window frames into our reflections. So
 * the environment is a handful of emissive rectangles placed where this
 * composition wants a highlight, and nothing else.
 *
 * HOW THE PLACEMENT IS DERIVED, because "put a light up and to the left" is not
 * a method. A reflection is a mirror bounce, so the emitter has to sit where the
 * reflected view ray lands, not where a lamp would look right in a photograph of
 * the set. Worked for the rail, which is the surface that has to read as
 * machined: the camera is at (1.05, 1.35, 15.05) and the rail top is at
 * y = -0.92 with normal +y, so the view direction is (-1.05, -2.27, -15.05) and
 * reflecting it about +y gives (-1.05, +2.27, -15.05). That ray leaves almost
 * horizontally toward the back of the room, tilted up by only
 * atan(2.27/15.1) = 8.5 degrees. So the emitter that puts a specular line down
 * the length of the rail is a wide, shallow band centred 8 degrees above the
 * optical axis and wrapped around the back, and `key-streak` below is exactly
 * that. Put it overhead where intuition says and the rail stays black.
 *
 * Authoring is therefore in ANGLES from the origin rather than in world
 * positions, because angle is the only thing a reflection responds to. Distance
 * is a constant that only sets how a flat quad's angular size is computed.
 *
 * THE EMITTERS DO NOT USE THE DEPTH BUFFER, and this is a correction rather
 * than a preference. Placing every emitter on one sphere of radius 14 puts
 * overlapping ones at very nearly the same distance from the cube camera: the
 * key panel at elevation 64 sits 14.00 units out and the ceiling cap's plane is
 * 14.02 units out along that same direction. Two coplanar-to-within-a-fiftieth
 * surfaces z-fight, and the fight is per-face and per-mip, so it shows up as a
 * flickering blotch in the reflection of anything smooth and is very hard to
 * read back to its cause. Depth is switched off entirely and the paint order is
 * stated instead: an emitter later in the recipe's list paints over an earlier
 * one. That is deterministic, resolution-independent, and it also makes the
 * recipe readable as a stack, dimmest and broadest at the bottom.
 *
 * `renderOrder` carries the list index because three sorts OPAQUE draws
 * front-to-back by depth, not by insertion, so insertion order alone would be
 * decided by the same distances that were the problem.
 */
import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import {
  BackSide,
  Color,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  PlaneGeometry,
  Scene,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { readPalette, type ScenePalette, type SceneTokenName } from "../core/palette";
import { BOUNCE_TOKEN, SOURCE_TOKEN } from "./light-roles";

const DEG = Math.PI / 180;

/**
 * The sphere the emitters are placed on. Nothing in the room is near it, so it
 * behaves as the sky: only the direction to each emitter matters.
 */
const RADIUS = 14;

/**
 * PMREM cube edge. 128 rather than the 256 default. The generator allocates
 * `3 * max(cubeSize, 112)` by `4 * cubeSize` RGBA half-float
 * (`PMREMGenerator.js:290`), so 256 costs 6.29 MB of the scene's 48 MB GPU
 * budget and 128 costs 1.57 MB. The base mip is only sampled by near-mirror
 * surfaces, and the smoothest thing in this room is the rail top; everything
 * else reads from a blurred mip where the source resolution cannot be
 * recovered. Both sizes were rendered and compared; the log records the
 * difference found.
 */
const ENV_SIZE = 128;

/**
 * A small extra blur before the roughness prefilter, in radians. The emitters
 * are hard-edged quads and without this a low-roughness surface reflects a
 * visible rectangle with a stair-stepped border.
 */
const ENV_BLUR = 0.035;

/**
 * An emissive shape on the environment sphere.
 *
 * `azimuth` is degrees about the vertical axis with 0 pointing at the back wall
 * (-z) and positive turning toward +x, which is the direction the beam travels.
 * `elevation` is degrees above the optical axis. Both match how the room is
 * described everywhere else, so an emitter's numbers can be read against the
 * bench without a transform in the reader's head.
 */
type Emitter =
  | {
      kind: "band";
      id: string;
      /** Centre of the band, degrees above the optical axis. */
      elevation: number;
      /** Angular thickness of the band in degrees. */
      thickness: number;
      /** Centre of the arc. */
      azimuth: number;
      /** Arc width in degrees. */
      span: number;
      token: SceneTokenName;
      gain: number;
    }
  | {
      kind: "panel";
      id: string;
      azimuth: number;
      elevation: number;
      /** Angular size in degrees, measured at the panel's centre. */
      width: number;
      height: number;
      token: SceneTokenName;
      gain: number;
    }
  | {
      kind: "cap";
      id: string;
      /** true for the ceiling, false for the floor bounce. */
      up: boolean;
      token: SceneTokenName;
      gain: number;
    };

interface Recipe {
  /** Everything the emitters do not cover. The room's own darkness. */
  backgroundToken: SceneTokenName;
  backgroundGain: number;
  /** Painted in order. Later entries cover earlier ones. */
  emitters: Emitter[];
}

/**
 * The dark room.
 *
 * Total emitted energy is deliberately low. This environment is not the fill:
 * it is the thing that gives metal an identity, and a bright uniform sphere
 * would be a flat ambient wearing a different hat, which INTERFACES.md rejects
 * for the same reason it rejects the hemisphere light. Every emitter below is
 * either the source itself, something the source is lighting, or the floor
 * bounce, and each one has a job in the frame.
 *
 * Read the list bottom-up to see the frame: the key panel and the source are
 * the last things painted, so nothing dilutes them.
 */
const DARK: Recipe = {
  backgroundToken: "--ground",
  backgroundGain: 0.4,
  emitters: [
    /**
     * The camera side. Kept at a level that is barely a number because this is
     * the one emitter that flattens the image if it grows: it lights exactly
     * the surfaces already facing the viewer, which is where all the form is.
     * Painted first because it is the broadest and the dimmest.
     */
    { kind: "panel", id: "front-fill", azimuth: 180, elevation: 6, width: 130, height: 70, token: SOURCE_TOKEN.dark, gain: 0.16 },
    /** Ceiling. Almost nothing: enough that up-facing metal is not pure black. */
    { kind: "cap", id: "ceiling", up: true, token: "--surface-2", gain: 0.02 },
    /**
     * The bounce. A real one: it comes from below, it is tinted with the floor's
     * own colour, and it lifts undersides only. This is the fill, and it
     * replaces the hemisphere light rather than sitting alongside it.
     */
    { kind: "cap", id: "floor-bounce", up: false, token: BOUNCE_TOKEN.dark, gain: 0.16 },
    /**
     * The specular line down the rail, and the reason this file has a
     * derivation in its header. Shallow, wide and wrapped around the back.
     */
    /**
     * Narrower and brighter than the first version, which is the same trade a
     * photographer makes with a strip box: solid angle sets how much ambient the
     * emitter adds to every surface in the room, and radiance sets how bright
     * the highlight is. The first pass had this at 7 degrees thick and 260 wide
     * at gain 0.6, and the ambient it contributed lifted the back wall, which
     * has to stay the darkest thing in the frame. Half the solid angle at
     * two and a half times the radiance is a brighter streak and less wash.
     */
    { kind: "band", id: "key-streak", elevation: 8, thickness: 4, azimuth: 0, span: 210, token: SOURCE_TOKEN.dark, gain: 0.16 },
    /**
     * The source, seen by everything facing it. This is what puts a warm edge on
     * the left of each housing and a bright spot in the cylindrical ones, and it
     * is the reflection that says the light in this room comes from off to the
     * left rather than from the renderer's defaults.
     */
    { kind: "panel", id: "beam-origin", azimuth: -90, elevation: 2, width: 20, height: 15, token: SOURCE_TOKEN.dark, gain: 1.2 },
    /**
     * Agrees with the analytic key at (-3.2, 8.6, 2.2), whose direction is 65.7
     * degrees up and 125 degrees round to the left. The two have to point the
     * same way or the specular highlight and the diffuse shading disagree and
     * the object reads as composited rather than lit.
     */
    { kind: "panel", id: "key-panel", azimuth: -125, elevation: 64, width: 26, height: 22, token: SOURCE_TOKEN.dark, gain: 0.75 },
  ],
};

/**
 * The light room. Not the dark one inverted.
 *
 * The same bench under an inspection lamp: the whole sphere carries light, so
 * metal reflects a bright room and reads bright, and the key still wins because
 * it is brighter than its surroundings rather than because everything else is
 * black. The emitter geometry is identical, which is what keeps a highlight in
 * the same place on the same edge when the reader flips the toggle.
 */
const LIGHT: Recipe = {
  backgroundToken: "--surface-2",
  backgroundGain: 0.75,
  emitters: [
    /**
     * Every angle below is the same as the dark room's. Only the gains and the
     * tokens change, which is what keeps a highlight on the same edge when the
     * reader flips the toggle: a room whose specular moves is a room that was
     * re-lit rather than re-exposed, and the two themes are meant to be one
     * bench under two lamps.
     *
     * The tokens go through `SOURCE_TOKEN` rather than naming `--beam`, and that
     * indirection is load-bearing here rather than tidy. In the light theme
     * `--beam` is redefined as the darkest ink, so an emitter written against it
     * would emit at a linear 0.03 and the bright room would come out black. See
     * `light-roles.ts`.
     */
    { kind: "panel", id: "front-fill", azimuth: 180, elevation: 6, width: 130, height: 70, token: "--surface-1", gain: 0.6 },
    { kind: "cap", id: "ceiling", up: true, token: "--surface-1", gain: 1.15 },
    { kind: "cap", id: "floor-bounce", up: false, token: BOUNCE_TOKEN.light, gain: 0.55 },
    /**
     * The gains are all higher than the dark room's, and the ones that matter
     * are higher by more than the background is. An emitter only reads as a
     * highlight if it beats its surroundings, and in a bright room the
     * surroundings are already at 0.6 to 1.1, so a streak at the dark room's 1.5
     * would be invisible.
     */
    { kind: "band", id: "key-streak", elevation: 8, thickness: 4, azimuth: 0, span: 210, token: SOURCE_TOKEN.light, gain: 2.4 },
    { kind: "panel", id: "beam-origin", azimuth: -90, elevation: 2, width: 20, height: 15, token: SOURCE_TOKEN.light, gain: 2.0 },
    { kind: "panel", id: "key-panel", azimuth: -125, elevation: 64, width: 26, height: 22, token: SOURCE_TOKEN.light, gain: 4.2 },
  ],
};

const RECIPES: Record<"dark" | "light", Recipe> = { dark: DARK, light: LIGHT };

/**
 * How hard the environment drives the materials, per theme.
 *
 * Separate from the gains above on purpose. The gains set the SHAPE of the
 * environment, which is what decides where a highlight lands and is the same
 * decision in both themes; this scales the whole sphere, which is a level and
 * belongs with the exposure. Changing a gain moves a highlight, changing this
 * moves the room.
 */
export const ENVIRONMENT_INTENSITY: Record<"dark" | "light", number> = {
  dark: 2.0,
  light: 0.72,
};

/**
 * Emitter colour in the working space.
 *
 * `palette` already holds linear-space colours, because `readPalette` resolves
 * through a canvas and hands the bytes to `Color.setStyle`, which applies the
 * sRGB decode while `ColorManagement.enabled` is true, and it defaults to true
 * in three r152 and later (`ColorManagement.js:21`). Multiplying by a gain above
 * 1 is therefore a real HDR emitter, and the PMREM target is half-float, so it
 * survives the capture instead of clipping at white the way an 8-bit cube would.
 */
function emitterColor(palette: ScenePalette, token: SceneTokenName, gain: number): Color {
  return palette[token].clone().multiplyScalar(gain);
}

/**
 * The material every emitter uses. Unlit, untone-mapped, and outside the depth
 * buffer for the reason in the file header.
 */
function emitterMaterial(color: Color, side: typeof DoubleSide | typeof BackSide): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    side,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
  });
}

/** A quad at (azimuth, elevation), facing the origin, sized in degrees. */
function makePanel(e: Extract<Emitter, { kind: "panel" }>, palette: ScenePalette): Mesh {
  const w = 2 * RADIUS * Math.tan((e.width / 2) * DEG);
  const h = 2 * RADIUS * Math.tan((e.height / 2) * DEG);
  const mesh = new Mesh(
    new PlaneGeometry(w, h),
    emitterMaterial(emitterColor(palette, e.token, e.gain), DoubleSide),
  );
  const a = e.azimuth * DEG;
  const el = e.elevation * DEG;
  mesh.position.set(
    RADIUS * Math.cos(el) * Math.sin(a),
    RADIUS * Math.sin(el),
    -RADIUS * Math.cos(el) * Math.cos(a),
  );
  mesh.lookAt(0, 0, 0);
  return mesh;
}

/**
 * A band of constant elevation, as an open cylinder seen from inside.
 *
 * A flat quad cannot do this job. A band 260 degrees wide is most of the way
 * around the room, and a plane that wide placed at one distance is nowhere near
 * constant elevation at its ends, so the rail's specular line would bow away
 * from the rail toward the edges of frame. The cylinder is the shape the
 * reflection actually wants.
 *
 * THE AZIMUTH CONVERSION IS NOT A SHIFT, IT IS A REFLECTION. Three sweeps its
 * cylinder from +z, taking `theta` to `(sin t, ., cos t)`; the scene measures
 * azimuth from -z toward +x, taking `a` to `(sin a, ., -cos a)`. Equating the
 * two gives `t = 180 - a`, which reverses the direction of travel as well as
 * offsetting it, so the arc's start is `180 - (a + span/2)`. Writing it as
 * `a - span/2 + 180` happens to give the same answer at azimuth 0, which is
 * where both recipes put this band, so the error would have sat here invisibly
 * until the first band that is not centred on the back wall.
 */
function makeBand(e: Extract<Emitter, { kind: "band" }>, palette: ScenePalette): Mesh {
  const y0 = RADIUS * Math.tan((e.elevation - e.thickness / 2) * DEG);
  const y1 = RADIUS * Math.tan((e.elevation + e.thickness / 2) * DEG);
  const thetaStart = (180 - (e.azimuth + e.span / 2)) * DEG;
  const mesh = new Mesh(
    new CylinderGeometry(RADIUS, RADIUS, y1 - y0, 96, 1, true, thetaStart, e.span * DEG),
    emitterMaterial(emitterColor(palette, e.token, e.gain), BackSide),
  );
  mesh.position.y = (y0 + y1) / 2;
  return mesh;
}

/** The floor bounce or the ceiling, as a horizontal plane covering its pole. */
function makeCap(e: Extract<Emitter, { kind: "cap" }>, palette: ScenePalette): Mesh {
  const mesh = new Mesh(
    new PlaneGeometry(RADIUS * 3.5, RADIUS * 3.5),
    emitterMaterial(emitterColor(palette, e.token, e.gain), DoubleSide),
  );
  mesh.rotation.x = e.up ? Math.PI / 2 : -Math.PI / 2;
  mesh.position.y = e.up ? RADIUS * 0.9 : -RADIUS * 0.9;
  return mesh;
}

export interface EnvironmentBuild {
  target: WebGLRenderTarget;
  /** Wall-clock cost of one prefilter, measured at build time. */
  ms: number;
  /** GPU bytes the prefiltered texture holds. */
  bytes: number;
  emitters: number;
  size: number;
}

/**
 * Render the emitters into a cube and prefilter it.
 *
 * The generator is disposed immediately: it holds compiled shaders and scratch
 * targets that are worth keeping only if environments are rebuilt often, and
 * this one is rebuilt exactly when the reader flips the theme.
 */
export function buildEnvironment(
  gl: WebGLRenderer,
  theme: "dark" | "light",
  palette: ScenePalette,
  size: number = ENV_SIZE,
): EnvironmentBuild {
  const started = performance.now();
  const recipe = RECIPES[theme];

  const envScene = new Scene();
  envScene.background = emitterColor(palette, recipe.backgroundToken, recipe.backgroundGain);
  recipe.emitters.forEach((e, index) => {
    const mesh =
      e.kind === "panel"
        ? makePanel(e, palette)
        : e.kind === "band"
          ? makeBand(e, palette)
          : makeCap(e, palette);
    mesh.name = e.id;
    mesh.renderOrder = index;
    envScene.add(mesh);
  });

  const pmrem = new PMREMGenerator(gl);
  const target = pmrem.fromScene(envScene, ENV_BLUR, 0.1, 100, { size });
  pmrem.dispose();

  // The emitters exist only to be photographed. Nothing keeps a reference.
  for (const child of envScene.children) {
    const mesh = child as Mesh;
    mesh.geometry?.dispose();
    (mesh.material as MeshBasicMaterial)?.dispose();
  }
  envScene.clear();

  return {
    target,
    ms: performance.now() - started,
    // 3*max(size,112) by 4*size, RGBA, half-float: two bytes a channel.
    bytes: 3 * Math.max(size, 112) * 4 * size * 4 * 2,
    emitters: recipe.emitters.length,
    size,
  };
}

/** Published for the measurement tools, which report the environment's cost. */
export let lastEnvironmentBuild: Omit<EnvironmentBuild, "target"> | null = null;

/**
 * The authored environment, prefiltered.
 *
 * Built in a memo rather than in an effect because the frozen signature returns
 * a `Texture` and not a nullable one, so it has to exist on the first render
 * that asks for it. That is safe here: `gl` is present for the whole life of
 * any component inside the canvas, and the build is one render of six quads
 * plus a prefilter.
 */
export function useAuthoredEnvironment(theme: "dark" | "light"): Texture {
  const gl = useThree((state) => state.gl);

  const build = useMemo(() => {
    const built = buildEnvironment(gl, theme, readPalette());
    lastEnvironmentBuild = {
      ms: built.ms,
      bytes: built.bytes,
      emitters: built.emitters,
      size: built.size,
    };
    return built;
  }, [gl, theme]);

  useEffect(() => () => build.target.dispose(), [build]);

  return build.target.texture;
}
