import { BackSide, BoxGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, Scene, type Material } from "three";

/**
 * The reflection environment: a dim studio with a few soft panels.
 *
 * It replaces three RectAreaLights. Their job was to shape the aluminium and
 * glass reflections and lay a soft wash over the room; a prefiltered
 * environment does both from the same directions for the cost of the image
 * lookups every lit material already makes, with no light-specific code in
 * any program. The panels sit where the old lights sat relative to the room.
 *
 * Panel radiance is in linear units above 1, so it survives PMREM filtering
 * as a highlight rather than flattening into the walls.
 */
export function makeStudioScene(): Scene {
  const scene = new Scene();
  const owned: Array<{ geometry: BoxGeometry | PlaneGeometry; material: Material }> = [];
  const add = (mesh: Mesh) => { scene.add(mesh); owned.push({ geometry: mesh.geometry as BoxGeometry | PlaneGeometry, material: mesh.material as Material }); return mesh; };

  // The room: dark petrol walls and a slightly warmer floor, so reflections
  // in the chrome carry the room's own colour rather than neutral grey.
  const walls = new MeshBasicMaterial({ color: new Color("#87999a"), side: BackSide });
  add(new Mesh(new BoxGeometry(30, 18, 30), walls)).position.set(0, 6, 0);
  const floor = new MeshBasicMaterial({ color: new Color("#9a9a8f") });
  const ground = add(new Mesh(new PlaneGeometry(30, 30), floor));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -2.9;

  const panel = (width: number, height: number, color: string, radiance: number, position: [number, number, number], target: [number, number, number]) => {
    const material = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(radiance), side: DoubleSide });
    const mesh = add(new Mesh(new PlaneGeometry(width, height), material));
    // lookAt turns the plane's +Z face toward the room.
    mesh.position.set(...position); mesh.lookAt(...target);
    return mesh;
  };
  // Overhead front softbox, the old "top" strip: the long highlight along the
  // gantry and the bench edge.
  panel(14, 3.2, "#f4fbfb", 14, [-1.5, 11.5, 7.5], [0.3, 3.2, -0.5]);
  // Key-side tall strip, warm, from the same side as the directional key.
  panel(3.2, 11, "#fff1dc", 10, [-12, 6, 6], [0, 3, 0]);
  // Cool rim from back right, the old rim panel: separates the stair and the
  // right of the gantry from the wall.
  panel(2, 10, "#b9d9e2", 9, [13, 6, -7], [0.4, 3.1, 0.1]);
  // Low front bounce, the old bench panel: lifts the cabinet fronts.
  panel(16, 2.4, "#d9f1ed", 3.5, [0, 1.2, 13], [0.15, 2.8, 0.55]);

  scene.userData.dispose = () => owned.forEach(({ geometry, material }) => { geometry.dispose(); material.dispose(); });
  return scene;
}
