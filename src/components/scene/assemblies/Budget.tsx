/**
 * What the bench actually costs, read off the renderer rather than counted in
 * the source.
 *
 * The budget this packet is held to is under 120 draw calls and 300k visible
 * triangles at the high tier, under 70 and 160k at mid. Both are properties of
 * a drawn frame and neither is derivable from the JSX: an instanced batch is
 * one call whatever its count, a frustum-culled mesh is none, a post chain adds
 * a call per pass, and a geometry's triangle count is a property of the buffer
 * the builder produced rather than of the arguments it was given.
 *
 * So this reads `renderer.info` after a frame and publishes it. Two things it
 * reports honestly rather than flatteringly:
 *
 *   - The calls include the post chain's passes. A number that excluded them
 *     would be a number for a frame nobody renders.
 *   - `triangles` is what was SUBMITTED, which on a scene with no culling on
 *     the instanced batches is the whole bench. That is the conservative
 *     reading and it is the one a budget wants.
 *
 * THE FIRST VERSION OF THIS REPORTED ONE CALL AND ONE TRIANGLE AT THE TWO
 * TIERS THAT HAVE A POST CHAIN, and it was believed for a few minutes because
 * the low tier, which has no chain, reported 74 and 19,328 and looked like the
 * expensive one. `WebGLRenderer.info` resets itself at the start of every
 * `render()` unless `autoReset` is turned off, and every pass of a composer is
 * a `render()`. So a synchronous read after the chain has run reports the last
 * full-screen quad and nothing else: one call, two triangles, which is a true
 * statement about a pass and a false one about a frame.
 *
 * The reporter therefore turns `autoReset` off, resets once, lets a fixed
 * number of animation frames go by, reads, and divides. It is asynchronous for
 * that reason. It also returns the frame count it divided by, so a caller can
 * ask for one frame and for ten and check the two agree, which is the only
 * defence against the number being an artifact of how long it waited.
 *
 * THE HOST HAS NO GPU AND NO TIMING HERE IS USABLE. Chrome falls back to
 * software and the p50 frame time is about 832 ms, so this deliberately reports
 * counts and not milliseconds. Cost ORDERING survives software rendering;
 * absolute frame budget does not, and reporting one as met would be the same
 * class of error as the AO comparison that was published before its toggle was
 * checked.
 */
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import type { Mesh } from "three";
import { geometryCacheSize, cachedTriangleCount } from "../geometry/profiles";
import { surfaceCacheSize } from "../materials";
import { lightCacheSize } from "./light";

export interface BudgetReport {
  tier: string;
  /** Draw calls per frame, post chain included, averaged over `frames`. */
  calls: number;
  /** Triangles submitted per frame, averaged over `frames`. */
  triangles: number;
  /** How many animation frames the two counts above were divided by. */
  frames: number;
  /** Objects in the tree, by kind, so a regression can be attributed. */
  meshes: number;
  instancedBatches: number;
  /** Instances across every batch: what the batches would have cost as meshes. */
  instances: number;
  /** How many distinct buffers, materials and emissive materials are live. */
  geometries: number;
  surfaces: number;
  lights: number;
  /** Triangles across every cached buffer, whether or not it is drawn. */
  cachedTriangles: number;
  /** Every named object on the bench, so a missing assembly is visible. */
  names: string[];
}

/**
 * What a shadow pass costs, measured by removing it.
 *
 * A draw call count that cannot be attributed is a number nobody can act on:
 * the bench's own meshes, the shadow map passes and the post chain all land in
 * the same total, and only the first of the three belongs to this packet. So
 * the reporter can turn the shadow map off and be measured again.
 *
 * IT RETURNS WHAT IT READ BACK, NOT WHAT IT SET. This build has already
 * published one A/B whose toggle did nothing while unrelated state made the
 * frames differ, so a toggle that reports its own intent is worthless. The
 * caller gets `enabled` as the renderer reports it afterwards and the number of
 * lights whose `castShadow` actually changed.
 */
export interface ShadowToggleResult {
  enabled: boolean;
  lightsChanged: number;
}

declare global {
  interface Window {
    __assemblies?: (frames?: number) => Promise<BudgetReport>;
    __assembliesShadows?: (enabled: boolean) => ShadowToggleResult;
  }
}

/** Resolves after `count` animation frames have been presented. */
function afterFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let left = count;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export function Budget({ tier }: { tier: string }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    window.__assemblies = async (frames = 8) => {
      const info = gl.info;
      const previousAutoReset = info.autoReset;
      info.autoReset = false;
      info.reset();
      await afterFrames(frames);
      const calls = info.render.calls / frames;
      const triangles = info.render.triangles / frames;
      info.autoReset = previousAutoReset;
      info.reset();

      let meshes = 0;
      let instancedBatches = 0;
      let instances = 0;
      const names: string[] = [];
      scene.traverse((object) => {
        const asMesh = object as Mesh & { isInstancedMesh?: boolean; count?: number };
        if (!asMesh.isMesh) return;
        if (asMesh.isInstancedMesh) {
          instancedBatches += 1;
          instances += asMesh.count ?? 0;
        } else {
          meshes += 1;
        }
        if (object.name) names.push(object.name);
      });
      return {
        tier,
        calls,
        triangles,
        frames,
        meshes,
        instancedBatches,
        instances,
        geometries: geometryCacheSize(),
        surfaces: surfaceCacheSize(),
        lights: lightCacheSize(),
        cachedTriangles: cachedTriangleCount(),
        names: names.sort(),
      };
    };
    /**
     * Remembered per light, because the first version of this restored more
     * than it removed. Turning every shadow-capable light back ON is not a
     * restore: the rig has two and only one of them casts, so the "restored"
     * reading came back at 456 calls against an original 333 and would have
     * been published as a regression that the measurement itself caused.
     */
    const wasCasting = new WeakMap<object, boolean>();

    window.__assembliesShadows = (enabled: boolean) => {
      gl.shadowMap.enabled = enabled;
      gl.shadowMap.needsUpdate = true;
      let lightsChanged = 0;
      scene.traverse((object) => {
        const light = object as { isLight?: boolean; castShadow?: boolean; shadow?: unknown };
        if (!light.isLight || !light.shadow) return;
        if (!wasCasting.has(object)) wasCasting.set(object, light.castShadow === true);
        const next = enabled ? wasCasting.get(object) === true : false;
        if (light.castShadow !== next) lightsChanged += 1;
        light.castShadow = next;
      });
      return { enabled: gl.shadowMap.enabled, lightsChanged };
    };

    return () => {
      delete window.__assemblies;
      delete window.__assembliesShadows;
    };
  }, [gl, scene, tier]);

  return null;
}
