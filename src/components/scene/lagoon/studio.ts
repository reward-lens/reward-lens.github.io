import { BackSide, BoxGeometry, Color, DataTexture, DoubleSide, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, RGBAFormat, Scene, type Material } from "three";

/**
 * The reflection environment: a product-photography studio built from
 * geometry and prefiltered once with PMREM.
 *
 * A large overhead softbox lays the broad top highlight on the bench, the
 * gallery and the plinth rim. Two tall strip boxes, left and right, draw the
 * long vertical highlights that make brushed aluminium, chrome and brass read
 * as shaped metal rather than grey. A warm card low in front lifts the
 * cabinet fronts and gives brass its gold, and a thin cool rim strip high
 * behind separates the gantry from the wall. Everything else is a dark-teal
 * surround, so the highlights have edges to stand against and reflections
 * carry the room's colour.
 *
 * Panel radiance is in linear units well above 1, so it survives PMREM
 * filtering as a highlight. Panels use a feathered mask so the highlights
 * have the soft falloff of a diffused box, not the hard edge of a card.
 */
function featheredMask(size = 64) {
  const data = new Uint8Array(size * size * 4);
  const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size, v = (y + .5) / size;
    const edge = smooth(0, .22, Math.min(u, 1 - u)) * smooth(0, .22, Math.min(v, 1 - v));
    // A softbox is slightly hotter in its middle than at its diffuser's rim.
    const r2 = (u - .5) ** 2 + (v - .5) ** 2;
    const value = Math.round(255 * edge * (.8 + .2 * Math.max(0, 1 - r2 * 4)));
    const i = (y * size + x) * 4; data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.magFilter = texture.minFilter = LinearFilter; texture.needsUpdate = true;
  return texture;
}

export function makeStudioScene(): Scene {
  const scene = new Scene();
  const owned: Array<{ geometry: BoxGeometry | PlaneGeometry; material: Material }> = [];
  const add = (mesh: Mesh) => { scene.add(mesh); owned.push({ geometry: mesh.geometry as BoxGeometry | PlaneGeometry, material: mesh.material as Material }); return mesh; };
  const mask = featheredMask();

  // Teal surround (mid value so brushed metal still reads as bright
  // silver between highlights) and a warmer studio floor.
  add(new Mesh(new BoxGeometry(34, 20, 34), new MeshBasicMaterial({ color: new Color("#6f8f90"), side: BackSide }))).position.set(0, 7, 0);
  const ground = add(new Mesh(new PlaneGeometry(34, 34), new MeshBasicMaterial({ color: new Color("#7a837e") })));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -2.9;

  const panel = (width: number, height: number, color: string, radiance: number, position: [number, number, number], target: [number, number, number]) => {
    const material = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(radiance), map: mask, side: DoubleSide });
    const mesh = add(new Mesh(new PlaneGeometry(width, height), material));
    // lookAt turns the plane's +Z face toward the room.
    mesh.position.set(...position); mesh.lookAt(...target);
    return mesh;
  };
  // Large overhead softbox, a little forward of the room so top surfaces
  // facing the camera catch it.
  panel(17, 10, "#f6fafa", 7, [0.5, 13.5, 3.5], [0.3, 2.5, -0.5]);
  // Tall strip boxes: the long vertical highlights on the gantry legs and
  // the turned instrument bodies. The left one is the key side, a shade warm.
  panel(2.8, 14, "#fff3e2", 13, [-12.5, 6.5, 6], [0, 3, 0]);
  panel(2.8, 14, "#eef6f8", 11, [13, 6.5, 4], [0, 3, 0]);
  // Warm card low in front: lifts the cabinet fronts, golds the brass.
  panel(18, 2.6, "#ffd9b0", 2.6, [0, 0.9, 13.5], [0.15, 2.4, 0.5]);
  // Thin cool rim strip high behind the room.
  panel(12, 1.4, "#cfe6ee", 5, [0, 11, -13], [0, 3.5, 0]);

  scene.userData.dispose = () => { owned.forEach(({ geometry, material }) => { geometry.dispose(); material.dispose(); }); mask.dispose(); };
  return scene;
}
