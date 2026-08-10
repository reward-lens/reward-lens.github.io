/**
 * Grounding for the tier that has no shadow map.
 *
 * INTERFACES.md §2 makes grounding mandatory and offers two ways to get it:
 * ambient occlusion from the post chain, or a contact shadow under each
 * assembly. The high and mid tiers take the first, because `GTAOPass` is in
 * their chain and real occlusion in the joins is better than anything painted.
 * The low tier has neither a shadow map nor a composer, and without something
 * here the bench floats in front of the floor with no indication it is resting
 * on it, which is the single most damaging thing that can happen to an object
 * that is supposed to read as a real instrument.
 *
 * So this is the cheap version, and it is honest about being cheap: a soft dark
 * ellipse on the floor under the bench, generated rather than downloaded. One
 * 128x128 single-channel texture, two triangles, no lights, no second pass.
 *
 * WHY IT IS A GENERATED TEXTURE AND NOT A GRADIENT SHADER. It is sampled by a
 * `MeshBasicMaterial` with no lighting at all, so the alternative would be a
 * custom shader material, which costs a program compile and a uniform block to
 * save 16 KB of GPU memory. The texture is built once at mount from a 2D canvas
 * with a radial gradient, which is the same mechanism `core/palette.ts` uses to
 * resolve tokens, so the file introduces no new technique.
 *
 * The falloff is squared rather than linear because a real contact shadow is
 * darkest where the gap is smallest and opens up quickly; a linear ramp reads as
 * a painted smudge.
 */
import { useEffect, useMemo } from "react";
import { CanvasTexture, DoubleSide, SRGBColorSpace } from "three";
import type { ScenePalette } from "../core/palette";
import { BENCH, ROOM_HALF_WIDTH } from "../core/layout";

/** One radial falloff, alpha only. */
function buildFalloff(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const image = ctx.createImageData(size, size);
  const half = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const d = Math.min(1, Math.hypot(dx, dy));
      // 1 at the centre, 0 at the rim, with the knee near the object.
      const a = (1 - d) * (1 - d);
      const i = (y * size + x) * 4;
      image.data[i] = 0;
      image.data[i + 1] = 0;
      image.data[i + 2] = 0;
      image.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Where the shadows go, in bench coordinates.
 *
 * Read from `layout.ts` rather than typed, so a geometry change that moves the
 * rail moves its shadow. The long one is the rail; the round one is the source
 * assembly, which is the only assembly mounted so far and the only one with a
 * post reaching the rail.
 */
const PATCHES = [
  { id: "rail", x: 0, z: 0, w: ROOM_HALF_WIDTH * 2 + 1.6, d: 2.6, opacity: 0.55 },
  { id: "source", x: BENCH.sourceX + 0.24, z: 0, w: 2.2, d: 2.2, opacity: 0.42 },
] as const;

export function ContactShadow({ palette }: { palette: ScenePalette }) {
  const texture = useMemo(() => buildFalloff(), []);
  useEffect(() => () => texture?.dispose(), [texture]);

  if (!texture) return null;

  return (
    <group name="ContactShadow">
      {PATCHES.map((p) => (
        <mesh
          key={p.id}
          name={`ContactShadow-${p.id}`}
          // A hair above the floor, so it never z-fights with it.
          position={[p.x, BENCH.floorY + 0.02, p.z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[p.w, p.d]} />
          {/*
            Multiplied into the floor rather than drawn over it, so the shadow
            darkens whatever the floor happens to be doing there instead of
            laying a flat grey patch across the pool of light. `depthWrite` is
            off because it is a decal: it must never occlude anything.
          */}
          <meshBasicMaterial
            map={texture}
            color={palette["--ground"]}
            transparent
            opacity={p.opacity}
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}
