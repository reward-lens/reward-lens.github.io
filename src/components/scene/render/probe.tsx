/**
 * The test that decides whether the environment is real.
 *
 * A prefiltered environment either exists and is being sampled, or it does not
 * and the scene looks slightly different for reasons nobody can name. The
 * difference is unambiguous on exactly one object: a sphere at metalness 1.0.
 * Such a surface has no diffuse term at all, so every photon it returns came
 * from `scene.environment` or from the specular lobe of an analytic light. With
 * no environment it is black with one hot spot; with one it is a mirror of the
 * room. Nothing else in this scene isolates that, because every shipped
 * material is dark, rough, and partly dielectric, so a missing environment on
 * one of those reads as "a bit flat" rather than as a failure.
 *
 * Four spheres, not one: three metals across the roughness range the material
 * set uses, and one dielectric beside them. The ladder is what shows the
 * prefilter is working rather than just the base mip, because roughness selects
 * the mip and a broken prefilter chain shows up as three identical spheres.
 *
 * Behind `?render-probe=1` and behind a dynamic import, so the shipped bundle
 * carries the query check and nothing else. Deleting it would mean the next
 * person to touch the lighting has no way to answer the first question they
 * will have.
 */
import { MeshStandardMaterial } from "three";
import { useMemo } from "react";
import type { ScenePalette } from "../core/palette";

export function shouldMountProbe(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("render-probe");
}

const LADDER = [
  { x: -2.6, metalness: 1.0, roughness: 0.1, label: "m1-r010" },
  { x: -0.9, metalness: 1.0, roughness: 0.3, label: "m1-r030" },
  { x: 0.8, metalness: 1.0, roughness: 0.5, label: "m1-r050" },
  { x: 2.5, metalness: 0.0, roughness: 0.3, label: "m0-r030" },
] as const;

export default function RenderProbe({ palette }: { palette: ScenePalette }) {
  const materials = useMemo(
    () =>
      LADDER.map(
        (s) =>
          new MeshStandardMaterial({
            // The housings' own tint, so the probe is reporting on the surface
            // class the bench actually uses rather than on a white ball.
            color: palette["--surface-3"],
            metalness: s.metalness,
            roughness: s.roughness,
          }),
      ),
    [palette],
  );

  return (
    <group name="RenderProbe">
      {LADDER.map((s, i) => (
        <mesh key={s.label} name={`probe-${s.label}`} position={[s.x, 0.55, 6.2]} material={materials[i]}>
          <sphereGeometry args={[0.7, 48, 32]} />
        </mesh>
      ))}
    </group>
  );
}
