// node design/pocket-lab/tools/tris-by-material.mjs <file.glb>: triangles per material (meshopt-aware)
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const by = new Map(); let total = 0;
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const n = prim.getIndices() ? prim.getIndices().getCount() / 3 : prim.getAttribute("POSITION").getCount() / 3;
  const m = (prim.getMaterial()?.getName() ?? "?").replace(/\.\d+$/, ""); by.set(m, (by.get(m) ?? 0) + n); total += n;
}
console.log("total", total);
for (const [m, n] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(String(n).padStart(7), (100 * n / total).toFixed(1).padStart(5) + "%", m);
