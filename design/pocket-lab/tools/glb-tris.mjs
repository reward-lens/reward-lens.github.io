// Triangles per node-name group in a GLB: node design/pocket-lab/tools/glb-tris.mjs <file.glb> [depth]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]); const depth = +(process.argv[3] ?? 2);
const g = {};
for (const n of doc.getRoot().listNodes()) { const m = n.getMesh(); if (!m) continue;
  let t = 0; for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3;
  const k = n.getName().split("_").slice(0, depth).join("_").replace(/[0-9]+$/, "#"); g[k] = (g[k] ?? 0) + t; }
const rows = Object.entries(g).sort((a, b) => b[1] - a[1]); let total = 0; for (const [, t] of rows) total += t;
console.log("total", total); for (const [k, t] of rows.slice(0, 40)) console.log(String(Math.round(t)).padStart(7), k);
