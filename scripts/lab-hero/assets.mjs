// Optimise the pocket-lab room and rig for delivery.
//
// Input: design/pocket-lab/raw/{lab.glb, rig.glb, anchors.json}, written by
// Blender from design/pocket-lab/source (see design/pocket-lab/README.md).
// Output: public/lagoon/{lab.glb, lab-compact.glb, rig.glb, anchors.json}
// and design/pocket-lab/optimized/report.json.
//
// The room is static: it is flattened and joined per material (every room
// mesh carries the baked AO layer, so they join), textures go to WebP, and
// geometry is meshopt-compressed. Semantic anchors are rebuilt as named
// empties at their authored world positions so the runtime can find them.
// The rig keeps every pivot: it is deduplicated, welded and compressed, never
// flattened or joined across nodes.
import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { cloneDocument, compactPrimitive, dedup, flatten, join, meshopt, prune, weld, simplifyPrimitive, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { readFile, writeFile, mkdir, copyFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const at = (p) => resolve(root, p);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const RAW = "design/pocket-lab/raw", OPT = "design/pocket-lab/optimized", PUB = "public/lagoon";

const STATIC = ["LAB_ROOT", "PLINTH", "CURVED_WALL", "UPPER_GALLERY", "RIGHT_STAIRS", "GANTRY", "MICROSCOPE", "OPTICAL_BENCH", "EMITTER", "PRISM", "GRATING", "SPECIMEN_STACK", "DETECTOR_TOP", "DETECTOR_BOTTOM", "BEAM_ENTRY", "BEAM_AFTER_PRISM", "SPECIMEN_FOCUS", "DETECTOR_SPLIT", "CAMERA_DESKTOP_TARGET", "CAMERA_MOBILE_TARGET"];
const RIG_REQUIRED = ["RIG_ROOT", "HEAD_CARRIAGE", "FOCUS_LENS", "SOURCE_SHUTTER", "FILTER_SELECTOR", "SOURCE_ATTACHMENT", "PRISM_ATTACHMENT", "SPECIMEN_ATTACHMENT", "OPTICAL_COUPLER", "RECEIVER_TOP_ACTION", "RECEIVER_BOTTOM_ACTION", "RECEIVER_TOP_ATTACHMENT", "RECEIVER_BOTTOM_ATTACHMENT"];
// Each rig attachment must sit exactly on the static anchor the beam uses at rest.
const RIG_REST = { SOURCE_ATTACHMENT: "BEAM_ENTRY", PRISM_ATTACHMENT: "BEAM_AFTER_PRISM", SPECIMEN_ATTACHMENT: "SPECIMEN_FOCUS", OPTICAL_COUPLER: "DETECTOR_SPLIT", RECEIVER_TOP_ATTACHMENT: "DETECTOR_TOP", RECEIVER_BOTTOM_ATTACHMENT: "DETECTOR_BOTTOM" };

async function io() {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
}

function measure(doc) {
  let triangles = 0, primitives = 0; const errors = [];
  for (const node of doc.getRoot().listNodes()) for (const p of node.getMesh()?.listPrimitives() ?? []) {
    primitives++;
    const pos = p.getAttribute("POSITION");
    if (!pos || !p.getMaterial()) errors.push(`${node.getName()}: missing position/material`);
    if (p.getMode() === 4) triangles += (p.getIndices()?.getCount() ?? pos?.getCount() ?? 0) / 3;
  }
  const bounds = getBounds(doc.getRoot().listScenes()[0]);
  if ([...bounds.min, ...bounds.max].some((v) => !Number.isFinite(v))) errors.push("non-finite bounds");
  return { triangles, primitives, materials: doc.getRoot().listMaterials().length, textures: doc.getRoot().listTextures().length, bounds, errors };
}

// Untextured materials sample no texture, so their (metre-scale, float) UVs are dead weight.
function stripUnusedUVs(doc) {
  const textured = (m) => !!m && [m.getBaseColorTexture(), m.getNormalTexture(), m.getMetallicRoughnessTexture(), m.getEmissiveTexture(), m.getOcclusionTexture()].some(Boolean);
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives())
    if (!textured(p.getMaterial())) for (const s of p.listSemantics()) if (s.startsWith("TEXCOORD")) p.setAttribute(s, null);
}

// The baked AO (COLOR_0) carries Cycles sampling noise, which looks dirty and
// defeats meshopt's delta coding. Relax it over the mesh graph, then snap it
// to `levels` steps and store one normalized byte per channel.
function conditionAO(doc, iterations = 2, levels = 64) {
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const color = p.getAttribute("COLOR_0"), indices = p.getIndices();
    if (!color || !indices) continue;
    const n = color.getCount(), size = color.getElementSize(), src = color.getArray();
    const scale = src instanceof Uint16Array ? 65535 : src instanceof Uint8Array ? 255 : 1;
    let ao = new Float32Array(n);
    for (let i = 0; i < n; i++) ao[i] = src[i * size] / scale;
    const ix = indices.getArray(), sum = new Float32Array(n), cnt = new Float32Array(n);
    for (let it = 0; it < iterations; it++) {
      sum.fill(0); cnt.fill(0);
      for (let t = 0; t < ix.length; t += 3) {
        const a = ix[t], b = ix[t + 1], c = ix[t + 2];
        sum[a] += ao[b] + ao[c]; sum[b] += ao[a] + ao[c]; sum[c] += ao[a] + ao[b];
        cnt[a] += 2; cnt[b] += 2; cnt[c] += 2;
      }
      const next = new Float32Array(n);
      for (let i = 0; i < n; i++) next[i] = cnt[i] ? .5 * ao[i] + .5 * sum[i] / cnt[i] : ao[i];
      ao = next;
    }
    const out = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const v = Math.round(Math.round(Math.min(1, Math.max(0, ao[i])) * (levels - 1)) / (levels - 1) * 255);
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
    }
    color.setType("VEC4").setArray(out).setNormalized(true);
  }
}

// Small hardware (screws, rings, knobs, castors, canister bands) carries most of
// the vertex count but is sub-pixel at the hero distance. AO-grid surfaces
// (floor, walls, gallery and stair) are never simplified: their vertices hold
// the baked contact shadows.
const AO_GRID = /^(MARBLE_Floor|PETROL_|CERAMIC_Pale)/;
const HARDWARE = /^(STEEL_|CHARCOAL_|BRASS_|RUBBER_|ALUMINIUM_|LENS_|WOOD_|BOOK_|TEAL_Upholstery|POT_|SOIL_|PLANT_Stem|ENAMEL_)/;
function simplifyWhere(doc, test, ratio, error) {
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const name = p.getMaterial()?.getName() ?? "";
    if (!AO_GRID.test(name) && test(name) && p.getIndices()) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: true });
  }
}

// The floor, walls, gallery and bench are tessellated into a fine grid only so
// the baked occlusion has vertices to live on. In the browser that grid cost
// more than anything else under multisampling: every pixel on a grid edge is
// shaded once per triangle. Simplifying with the occlusion (and the normal) as
// weighted attributes collapses the evenly lit stretches into large triangles
// and keeps vertices where the occlusion changes, such as contact shadows.
// Positions may move by at most `error` metres; borders stay locked.
function simplifyAoGrid(doc, ratio, error, aoWeight, normalWeight) {
  const stats = { before: 0, after: 0 };
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const name = p.getMaterial()?.getName() ?? "";
    const indices = p.getIndices(), position = p.getAttribute("POSITION"), color = p.getAttribute("COLOR_0"), normal = p.getAttribute("NORMAL");
    if (!AO_GRID.test(name) || !indices || !position || !color) continue;
    const count = position.getCount(), positions = new Float32Array(count * 3), attributes = new Float32Array(count * 4);
    const el = [];
    for (let i = 0; i < count; i++) {
      position.getElement(i, el); positions.set(el.slice(0, 3), i * 3);
      color.getElement(i, el); attributes[i * 4] = el[0];
      if (normal) { normal.getElement(i, el); attributes[i * 4 + 1] = el[0]; attributes[i * 4 + 2] = el[1]; attributes[i * 4 + 3] = el[2]; }
    }
    const source = new Uint32Array(indices.getArray());
    const [result] = MeshoptSimplifier.simplifyWithAttributes(source, positions, 3, attributes, 4, [aoWeight, normalWeight, normalWeight, normalWeight], null, Math.floor(source.length * ratio / 3) * 3, error, ["LockBorder", "ErrorAbsolute"]);
    stats.before += source.length / 3; stats.after += result.length / 3;
    indices.setArray(count > 65535 ? result : new Uint16Array(result));
    compactPrimitive(p);
  }
  return stats;
}

function namedNodes(doc) {
  return Object.fromEntries(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
}

async function compressTextures(doc) {
  // Colour data tolerates lossy WebP; normals, roughness and occlusion stay lossless.
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: "webp", quality: 86, slots: /^(baseColorTexture|emissiveTexture)$/ }),
    textureCompress({ encoder: sharp, targetFormat: "webp", lossless: true, slots: /^(?!baseColorTexture|emissiveTexture).*$/ }),
  );
}

async function write(io_, doc, path) {
  const bytes = await io_.writeBinary(doc);
  await writeFile(at(path), bytes);
  return { path, bytes: bytes.byteLength, gzipBytes: gzipSync(bytes).length, sha256: sha(bytes) };
}

async function main() {
  const IO = await io();
  await mkdir(at(OPT), { recursive: true }); await mkdir(at(PUB), { recursive: true });
  const authored = JSON.parse(await readFile(at(`${RAW}/anchors.json`), "utf8"));
  const anchors = authored.anchors;
  const practicals = authored.practicals ?? {};
  for (const name of [...STATIC, ...Object.keys(practicals)]) if (!anchors[name] && name !== "LAB_ROOT") throw new Error(`raw/anchors.json lacks ${name}`);

  // ---- room
  const raw = await IO.read(at(`${RAW}/lab.glb`));
  const rawStats = measure(raw);
  if (rawStats.errors.length) throw new Error(rawStats.errors.join("\n"));
  const base = cloneDocument(raw);
  await base.transform(dedup(), flatten({ cleanup: false }));
  stripUnusedUVs(base);
  // Static geometry joins per material; blended glass stays separately sortable.
  await base.transform(join({ cleanup: false, filter: (n) => (n.getMesh()?.listPrimitives() ?? []).every((p) => p.getMaterial()?.getAlphaMode() !== "BLEND") }));
  await base.transform(prune({ keepLeaves: false, keepAttributes: true, keepExtras: false }), weld());
  conditionAO(base);
  const scene = base.getRoot().listScenes()[0];
  for (const n of base.getRoot().listNodes()) if (anchors[n.getName()] || n.getName() === "LAB_ROOT") n.setName(`ART_${n.getName()}`);
  const labRoot = base.createNode("LAB_ROOT"); scene.addChild(labRoot);
  for (const [name, point] of Object.entries(anchors)) labRoot.addChild(base.createNode(name).setTranslation(point).setExtras({ semanticAnchor: true }));
  await compressTextures(base);
  const compact = cloneDocument(base);
  console.log("ao grid, compact", simplifyAoGrid(compact, .1, .01, 1, .3));
  simplifyWhere(compact, (name) => HARDWARE.test(name), .25, .004);
  simplifyWhere(compact, (name) => !HARDWARE.test(name), .5, .002);
  const standard = cloneDocument(base);
  console.log("ao grid, standard", simplifyAoGrid(standard, .1, .008, 1.5, .4));
  // Screws, fittings, trim and leaves are a pixel or two across from the hero
  // camera. Their triangles are what made multisampling expensive, so they
  // simplify until the error cap (about 6 mm across a joined material, a
  // fraction of a pixel at the hero framing) rather than stopping at half.
  simplifyWhere(standard, (name) => HARDWARE.test(name), .2, .0006);
  simplifyWhere(standard, (name) => /^PLANT_Leaf/.test(name), .4, .0006);
  await standard.transform(meshopt({ encoder: MeshoptEncoder, level: "high", quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8 }));
  await compact.transform(meshopt({ encoder: MeshoptEncoder, level: "high", quantizePosition: 14, quantizeNormal: 8, quantizeColor: 8 }));
  const outStandard = await write(IO, standard, `${OPT}/lab.glb`);
  const outCompact = await write(IO, compact, `${OPT}/lab-compact.glb`);

  // ---- rig
  const rigRaw = await IO.read(at(`${RAW}/rig.glb`));
  const nodes = namedNodes(rigRaw); const rigErrors = [];
  for (const name of RIG_REQUIRED) if (!nodes[name]) rigErrors.push(`rig: missing ${name}`);
  const descends = (a, b) => { const s = [...a.listChildren()]; while (s.length) { const x = s.pop(); if (x === b) return true; s.push(...x.listChildren()); } return false; };
  if (nodes.HEAD_CARRIAGE && nodes.FOCUS_LENS && !descends(nodes.HEAD_CARRIAGE, nodes.FOCUS_LENS)) rigErrors.push("rig: FOCUS_LENS must descend from HEAD_CARRIAGE");
  for (const [node, anchor] of Object.entries(RIG_REST)) {
    const p = nodes[node]?.getWorldTranslation(); const q = anchors[anchor];
    if (!p || p.some((v, i) => Math.abs(v - q[i]) > .002)) rigErrors.push(`rig: ${node} ${p?.map((v) => v.toFixed(3))} is not at ${anchor} ${q.map((v) => v.toFixed(3))}`);
  }
  for (const m of ["SOURCE_APERTURE", "DETECTOR_RECEIVER"]) if (!rigRaw.getRoot().listMaterials().some((x) => x.getName() === m)) rigErrors.push(`rig: missing material ${m}`);
  if (rigErrors.length) throw new Error(rigErrors.join("\n"));
  const rig = cloneDocument(rigRaw);
  stripUnusedUVs(rig);
  await rig.transform(dedup(), prune({ keepLeaves: true, keepAttributes: false, keepExtras: true }), weld());
  // The rig's knurling, screws and chamfers are sub-pixel from the hero camera:
  // simplify each part in its own space within 1.5 mm, keeping every node.
  { let before = 0, after = 0;
    for (const mesh of rig.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
      const indices = p.getIndices(), position = p.getAttribute("POSITION");
      if (!indices || !position || p.getMaterial()?.getAlphaMode() === "BLEND") continue;
      const source = new Uint32Array(indices.getArray()), positions = new Float32Array(position.getCount() * 3), el = [];
      for (let i = 0; i < position.getCount(); i++) { position.getElement(i, el); positions.set(el.slice(0, 3), i * 3); }
      const [result] = MeshoptSimplifier.simplify(source, positions, 3, Math.floor(source.length * .3 / 3) * 3, .0015, ["LockBorder", "ErrorAbsolute"]);
      before += source.length / 3; after += result.length / 3;
      indices.setArray(position.getCount() > 65535 ? result : new Uint16Array(result)); compactPrimitive(p);
    }
    console.log("rig simplified", { before, after }); }
  await compressTextures(rig);
  await rig.transform(meshopt({ encoder: MeshoptEncoder, level: "high", quantizePosition: 16, quantizeNormal: 12 }));
  const outRig = await write(IO, rig, `${OPT}/rig.glb`);
  const rigWorld = Object.fromEntries(RIG_REQUIRED.map((n) => [n, nodes[n].getWorldTranslation()]));

  // ---- publish
  for (const [from, to] of [[outStandard.path, "lab.glb"], [outCompact.path, "lab-compact.glb"], [outRig.path, "rig.glb"]]) await copyFile(at(from), at(`${PUB}/${to}`));
  await copyFile(at("node_modules/three/examples/jsm/libs/meshopt_decoder.module.js"), at(`${PUB}/meshopt_decoder.module.js`));
  const sidecar = {
    version: 3, coordinateSystem: "gltf-y-up", requiredNodes: STATIC, anchors, bounds: rawStats.bounds,
    assets: { standard: { url: "/lagoon/lab.glb", sha256: outStandard.sha256 }, compact: { url: "/lagoon/lab-compact.glb", sha256: outCompact.sha256 }, rig: { url: "/lagoon/rig.glb", sha256: outRig.sha256 } },
    articulated: { roots: ["HEAD_CARRIAGE", "FOCUS_LENS", "SOURCE_SHUTTER", "FILTER_SELECTOR", "RECEIVER_TOP_ACTION", "RECEIVER_BOTTOM_ACTION"], attachments: Object.keys(RIG_REST).filter((n) => n !== "OPTICAL_COUPLER"), coupler: { node: "OPTICAL_COUPLER", world: rigWorld.OPTICAL_COUPLER, staticAnchor: "DETECTOR_SPLIT" }, sourceMaterial: "SOURCE_APERTURE", receiverMaterial: "DETECTOR_RECEIVER" },
    practicals,
  };
  await writeFile(at(`${PUB}/anchors.json`), JSON.stringify(sidecar, null, 2) + "\n");
  const report = { generatedAt: new Date().toISOString(), raw: { bytes: (await stat(at(`${RAW}/lab.glb`))).size, ...rawStats }, standard: { ...outStandard, ...measure(standard) }, compact: { ...outCompact, ...measure(compact) }, rig: { ...outRig, ...measure(rig), world: rigWorld } };
  await writeFile(at(`${OPT}/report.json`), JSON.stringify(report, null, 2) + "\n");
  const brief = (r) => ({ bytes: r.bytes, gzip: r.gzipBytes, triangles: r.triangles, primitives: r.primitives, materials: r.materials, textures: r.textures });
  console.log(JSON.stringify({ standard: brief(report.standard), compact: brief(report.compact), rig: brief(report.rig) }, null, 1));
}

await main();
