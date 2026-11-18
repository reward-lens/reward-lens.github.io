// Byte breakdown of a GLB: decoded attribute bytes by semantic, and encoded texture bytes.
// node design/pocket-lab/tools/glb-bytes.mjs <file.glb>
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const sem = {}; let untexturedUV = 0, verts = 0;
for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
  const m = p.getMaterial(); const textured = m && (m.getBaseColorTexture() || m.getNormalTexture() || m.getMetallicRoughnessTexture() || m.getEmissiveTexture() || m.getOcclusionTexture());
  verts += p.getAttribute("POSITION").getCount();
  for (const s of p.listSemantics()) { const a = p.getAttribute(s); const b = a.getCount() * a.getElementSize() * a.getComponentSize(); sem[s] = (sem[s] ?? 0) + b; if (s.startsWith("TEXCOORD") && !textured) untexturedUV += b; }
  const i = p.getIndices(); if (i) sem.INDICES = (sem.INDICES ?? 0) + i.getCount() * i.getComponentSize();
}
console.log("vertices", verts, "decoded attribute bytes", Object.fromEntries(Object.entries(sem).map(([k, v]) => [k, v])), "untextured UV bytes", untexturedUV);
for (const t of doc.getRoot().listTextures()) console.log("texture", t.getName() || t.getURI(), t.getMimeType(), t.getImage()?.byteLength, t.getSize()?.join("x"));
