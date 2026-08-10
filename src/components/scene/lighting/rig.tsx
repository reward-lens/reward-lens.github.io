/**
 * The light rig. One source, shaped.
 *
 * WHAT WAS REMOVED AND WHY. The previous rig's primary fill was a
 * `hemisphereLight`. A hemisphere adds sky-coloured light to every up-facing
 * normal and ground-coloured light to every down-facing one, everywhere in the
 * room at once, with no position and no falloff. It is the fastest way to make a
 * dark scene visible and it removes, in one prop, every bit of shaping that
 * makes an object legible: two faces at different angles to the real source end
 * up separated by the hemisphere's gradient rather than by the source, so the
 * form flattens and the bench reads as an illustration of itself. It is gone.
 * The ambient term is now the environment, which is the same idea done properly:
 * it has direction, it is tinted by what is actually in the room, and the bounce
 * comes from below because that is where the floor is.
 *
 * WHAT THE RIG IS. A shadow-casting key, two rectangular area lights for the
 * soft strip highlights that make anodized metal read as metal, the spill pool
 * that says where the source is, and a floor bounce. Nothing here is a "fill
 * level"; every light is an object in the room.
 */
import { useEffect, useMemo, useRef } from "react";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import type { DirectionalLight, RectAreaLight } from "three";
import type { ScenePalette } from "../core/palette";
import type { SceneTier } from "../runtime/tier";
import { profileFor } from "../runtime/tier";
import { BENCH } from "../core/layout";
import { fitShadowFrustum, SHADOW_BIAS } from "./shadow";
import { BOUNCE_TOKEN, SOURCE_TOKEN } from "../render/light-roles";

/**
 * The key's position. Unchanged from the rig this replaces, because it was the
 * one thing about the old lighting that was composed rather than defaulted: up
 * and to the left, on the source's side, so the housings' lit faces are the ones
 * turned toward where the beam comes from.
 */
const KEY_POSITION: readonly [number, number, number] = [-3.2, 9.2, 0.35];

/**
 * WHY THE KEY MOVED, AND IT IS THE ONE GEOMETRIC DECISION IN THIS FILE.
 *
 * It was at (-3.2, 8.6, 2.2), which is up, left and well in front of the bench.
 * A directional light is infinitely far away, so it has no falloff: every
 * surface with the same normal receives exactly the same irradiance no matter
 * where it is in the room. The back wall's normal is +z, so with the key at
 * z = 2.2 the wall received `cos = 2.2/9.44 = 0.233` of the key, uniformly,
 * across all 40 units of it. Measured, that put the wall at 47 of 255 against a
 * target of 20-32, and it looked worse than it measured: a large, even, grey
 * field filling the top two thirds of the hero with the headline sitting on it.
 * That is the flat grey box this whole packet exists to remove, reintroduced by
 * a light position.
 *
 * Pulling the key back to z = 0.35 takes the wall's cosine to 0.036, a sixth of
 * what it was, while the floor's rises slightly from 0.911 to 0.944 because the
 * key is now more nearly overhead. So the surface that has to be dark loses most
 * of its light and the surfaces that have to be bright lose none: the ratio the
 * targets ask for falls out of the geometry rather than out of a fudge factor.
 *
 * What it costs is the front faces, which now get almost nothing from the key.
 * That is paid for deliberately by the area lights and the environment, and it
 * is the more photographic arrangement anyway: a top-and-slightly-behind key
 * defines the top edges and the form, and the faces turned toward the viewer are
 * filled by soft local sources. A key aimed at the front of an object from the
 * camera's side is the flat lighting of a snapshot.
 */

/**
 * The area lights have to have their uniform library initialized before any of
 * them is used, and the failure mode when you forget is silence: the light
 * mounts, no warning appears, and the material simply looks flat, which is
 * indistinguishable from a light that is too dim. Called once at module scope
 * rather than per mount because the library is global state and initializing it
 * twice is wasted work.
 *
 * Guarded for the server: this module is imported by a component that only ever
 * renders inside a canvas, but Astro still evaluates the module graph during the
 * build, and the library touches `DataTexture` at call time.
 */
let uniformsReady = false;
function ensureRectAreaLights() {
  if (uniformsReady || typeof window === "undefined") return;
  RectAreaLightUniformsLib.init();
  uniformsReady = true;
}

interface Props {
  palette: ScenePalette;
  tier: SceneTier;
  theme: "dark" | "light";
}

export function LightRig({ palette, tier, theme }: Props) {
  ensureRectAreaLights();

  const profile = profileFor(tier);
  const shadows = profile.shadowMapSize > 0;
  const light = theme === "light";

  /**
   * The frustum is derived from the bench and the key's position, so it is
   * recomputed only when the key moves rather than being a set of literals that
   * a later geometry change can invalidate without anyone noticing.
   */
  const frustum = useMemo(() => fitShadowFrustum(KEY_POSITION), []);

  const keyRef = useRef<DirectionalLight>(null);
  const strip = useRef<RectAreaLight>(null);
  const raking = useRef<RectAreaLight>(null);
  const bounce = useRef<RectAreaLight>(null);

  /**
   * Area lights are aimed by orientation, not by a target object, so each one
   * is pointed at what it is supposed to light. Done in an effect because
   * `lookAt` needs the light to have its final position first, and doing it as
   * a prop would fight React on every re-render.
   */
  useEffect(() => {
    strip.current?.lookAt(0, BENCH.railY, 0);
    raking.current?.lookAt(BENCH.prismX, 0, 0);
    bounce.current?.lookAt(0, 0.4, 0);
  });

  return (
    <>
      {/*
        The key. A directional light, which is the correct object for a source
        far enough away that its rays are parallel across a 14-unit bench, and
        the only one of the three light types here that can cast the shadow the
        composition needs. SCENE.md measured a RectAreaLight key at 4.6-5.2ms,
        four times the cost of the entire dispersion segment, and it cannot cast
        a shadow at all, so it is not the key: it is the strip highlight below.
      */}
      <directionalLight
        ref={keyRef}
        name="KeyLight"
        position={KEY_POSITION}
        intensity={light ? 12.0 : 6.3}
        color={palette[SOURCE_TOKEN[theme]]}
        castShadow={shadows}
        shadow-mapSize-width={profile.shadowMapSize || 512}
        shadow-mapSize-height={profile.shadowMapSize || 512}
        shadow-camera-left={frustum.left}
        shadow-camera-right={frustum.right}
        shadow-camera-top={frustum.top}
        shadow-camera-bottom={frustum.bottom}
        shadow-camera-near={frustum.near}
        shadow-camera-far={frustum.far}
        shadow-bias={SHADOW_BIAS.bias}
        shadow-normalBias={SHADOW_BIAS.normalBias}
      />

      {/*
        The strip highlight, and this is the light that makes the metal read as
        metal. A long, narrow panel above the rail running along its length: an
        anodized face returns it as a soft-edged line rather than as the point
        an ordinary light gives, and that line with its gradual falloff at each
        end is the single most recognizable signature of a real machined surface
        under a real softbox. The environment carries the same streak for the
        specular reflection; this one carries the near-field falloff along the
        bench that an infinitely distant environment cannot.

        Dropped below the high tier. It is the expensive light and it is the one
        whose absence the environment most nearly covers.
      */}
      {tier === "high" && (
        <rectAreaLight
          ref={strip}
          name="StripHighlight"
          /**
           * Directly over the rail and aimed straight down, which is a
           * correction against measurement rather than a preference. The first
           * version of this light sat forward of the bench at z = 3.0 and was
           * 13 by 1.1 units. A rect area light's power is
           * `intensity * width * height * PI`, so that panel was emitting about
           * 61 units, and being tilted back it put most of it on the back wall:
           * measured, the wall came out at 61 of 255 against a 20-32 target,
           * brighter than the rail despite having an eighth of the albedo. Area
           * is the term that gets away from you here, not intensity.
           *
           * Narrow, over the rail, pointing down: the streak lands on the one
           * surface it is for, and the wall never sees it.
           */
          position={[-0.6, 2.6, 1.05]}
          width={9}
          height={0.28}
          intensity={light ? 1.3 : 0.85}
          color={palette[SOURCE_TOKEN[theme]]}
        />
      )}

      {/*
        A second, much smaller panel raking across the bench from the source
        side, so the housings have a highlight on the axis the strip above them
        cannot reach. Kept at mid because it is a fifth of the strip's area and
        it is what stops the cylindrical housings reading as flat discs.
      */}
      {tier !== "low" && (
        <rectAreaLight
          ref={raking}
          name="RakingHighlight"
          /**
           * Aimed at the source housing, not across the room. The first version
           * sat at the far left and looked at the dispersing element, which put
           * its axis straight down the length of the bench and its pool on the
           * far right of the back wall: that ellipse was the largest single
           * error in the first lit frame. A raking light is a local light. It is
           * now close to the housing it rakes, and small enough that its solid
           * angle at the back wall is negligible.
           */
          position={[BENCH.sourceX - 0.9, 1.05, 2.4]}
          width={1.2}
          height={1.0}
          intensity={light ? 4.2 : 3.2}
          color={palette[SOURCE_TOKEN[theme]]}
        />
      )}

      {/*
        The bounce, as a real object: a panel lying on the floor under the bench
        facing up, tinted with the floor's own colour. This is what the
        hemisphere light was standing in for, and the difference is that it is
        local. It lifts the undersides of the housings and the rail's lower edge
        where the floor is actually catching the pool of light, and it does
        nothing at the far end of the room where the floor is dark, which is the
        variation the hemisphere flattened out.
      */}
      {tier !== "low" && (
        <rectAreaLight
          ref={bounce}
          name="FloorBounce"
          position={[BENCH.sourceX + 2.2, BENCH.floorY + 0.05, 0.8]}
          width={6}
          height={3.2}
          intensity={light ? 0.42 : 0.26}
          color={palette[BOUNCE_TOKEN[theme]]}
        />
      )}

      {/*
        The pool on the floor, kept from the rig this replaces because its
        reasoning holds: a directional light is infinitely far away and lights a
        40x24 floor identically, so the floor reads as one flat slab with a hard
        horizon, which is a wall lying down. A point light with quadratic decay
        just off the bench gives the floor a falloff that says where the light is
        coming from. Its intensity is far lower than before because it is no
        longer also standing in for the missing indirect light.
      */}
      <pointLight
        name="BeamSpill"
        position={[-3.4, 0.35, 0.5]}
        intensity={light ? 9 : 48}
        distance={16.0}
        decay={2}
        color={palette[SOURCE_TOKEN[theme]]}
      />
    </>
  );
}
