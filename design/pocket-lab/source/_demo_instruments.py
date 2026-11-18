"""Build the bench, cabinets and static optics on a floor slab, check budgets
and clearances, and render previews/bench-*.png. Run from design/pocket-lab:
  $B --background --factory-startup --python source/_demo_instruments.py
"""
import sys, os, math
sys.path.insert(0, os.path.join(os.getcwd(), "source"))
import bpy
import lib, layout, instruments
from mathutils import Vector

PREV = os.path.join(os.getcwd(), "previews")

def preview_holes(pitch=.125, radius=.011):
    """Preview only: a procedural hole grid on OPTICAL_TABLE_Top when its
    texture is missing, so UV scale and orientation can be judged."""
    m = lib.mat("OPTICAL_TABLE_Top"); nt = m.node_tree
    if any(n.type == "TEX_IMAGE" for n in nt.nodes): return False
    N, L = nt.nodes, nt.links; b = N["Principled BSDF"]
    tc = N.new("ShaderNodeTexCoord"); sep = N.new("ShaderNodeSeparateXYZ"); L.new(tc.outputs["UV"], sep.inputs[0])
    def cell(sock):
        a = N.new("ShaderNodeMath"); a.operation = "DIVIDE"; a.inputs[1].default_value = pitch; L.new(sock, a.inputs[0])
        f = N.new("ShaderNodeMath"); f.operation = "FRACT"; L.new(a.outputs[0], f.inputs[0])
        s = N.new("ShaderNodeMath"); s.operation = "SUBTRACT"; s.inputs[1].default_value = .5; L.new(f.outputs[0], s.inputs[0])
        return s.outputs[0]
    comb = N.new("ShaderNodeCombineXYZ"); L.new(cell(sep.outputs["X"]), comb.inputs[0]); L.new(cell(sep.outputs["Y"]), comb.inputs[1])
    ln = N.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"; L.new(comb.outputs[0], ln.inputs[0])
    lt = N.new("ShaderNodeMath"); lt.operation = "LESS_THAN"; lt.inputs[1].default_value = radius / pitch; L.new(ln.outputs["Value"], lt.inputs[0])
    mix = N.new("ShaderNodeMix"); mix.data_type = "RGBA"
    L.new(lt.outputs[0], mix.inputs[0]); mix.inputs[6].default_value = b.inputs["Base Color"].default_value[:]; mix.inputs[7].default_value = (.02, .025, .028, 1)
    L.new(mix.outputs[2], b.inputs["Base Color"])
    inv = N.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1; L.new(lt.outputs[0], inv.inputs[1])
    L.new(inv.outputs[0], b.inputs["Metallic"])
    return True

def shoot(path, center, direction, radius, fov=30, size=(1400, 900), samples=40):
    sc = lib.setup_cycles(samples)
    c = Vector(center); d = Vector(direction).normalized()
    dist = radius / math.sin(math.radians(fov) / 2)
    cd = bpy.data.cameras.new("_cam"); cd.lens_unit = "FOV"; cd.angle = math.radians(fov)
    cam = bpy.data.objects.new("_cam", cd); sc.collection.objects.link(cam)
    cam.location = c + d * dist; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler(); sc.camera = cam
    extra = [cam]
    for nm, off, energy, sz, colr in (("_key", (-.6, -.7, .9), 900, 3.0, (1, .96, .9)), ("_fill", (.9, -.4, .3), 250, 4.0, (.85, .93, 1)), ("_rim", (.2, .9, .8), 300, 2.0, (1, 1, 1))):
        ld = bpy.data.lights.new(nm, "AREA"); ld.energy = energy * (radius / 2) ** 2; ld.size = sz * radius / 2; ld.color = colr
        lo = bpy.data.objects.new(nm, ld); sc.collection.objects.link(lo)
        lo.location = c + Vector(off).normalized() * dist * .8
        lo.rotation_euler = (c - lo.location).to_track_quat("-Z", "Y").to_euler(); extra.append(lo)
    if sc.world is None: sc.world = bpy.data.worlds.new("World")
    w = sc.world; w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    if bg: bg.inputs["Color"].default_value = lib.srgb("#C9DCD9"); bg.inputs["Strength"].default_value = .7
    sc.render.resolution_x, sc.render.resolution_y = size; sc.render.resolution_percentage = 100
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"
    sc.render.image_settings.file_format = "PNG"; sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in extra: bpy.data.objects.remove(o, do_unlink=True)

def world_verts(o):
    dg = bpy.context.evaluated_depsgraph_get(); me = o.evaluated_get(dg).to_mesh()
    vs = [o.matrix_world @ v.co for v in me.vertices]; o.evaluated_get(dg).to_mesh_clear(); return vs

lib.reset()
C = lib.collection("BENCH")
bench = instruments.optical_bench(C)
optics = instruments.bench_optics(C)
floor = lib.rbox((11.0, 7.0, .3), bevel=.03, loc=(-.6, -.4, layout.FLOOR - .15)).obj("_floor", "CERAMIC_Pale", C)
print("holes preview:", preview_holes())
sb, so = lib.stats(bench), lib.stats(optics)
print("BENCH", sb, "OPTICS", so)
for o in bench + optics: print(f"  {o.name:22s} tris {lib.stats([o])['triangles']:6d} mats {[m.name for m in o.data.materials]}")
# bays: no cabinet vertex strictly inside any free volume
cab = bpy.data.objects["BENCH_Cabinets"]; cv = world_verts(cab)
for b in instruments.bench_bays():
    c, s = Vector(b["center"]), Vector(b["size"])
    inside = sum(1 for v in cv if all(abs(v[i] - c[i]) < s[i] / 2 - .002 for i in range(3)))
    print("  bay", b["name"], tuple(round(x, 3) for x in b["center"]), tuple(round(x, 3) for x in b["size"]), "intruding verts", inside)
# optical axis: only glass may be hit
dg = bpy.context.evaluated_depsgraph_get(); org = Vector((-3.70, layout.OPTICS_Y, layout.BEAM_Z)); hits = []
while True:
    ok, loc, nrm, idx, ob, mw = bpy.context.scene.ray_cast(dg, org, Vector((1, 0, 0)), distance=3.10 - org.x)
    if not ok: break
    mi = ob.data.polygons[idx].material_index if idx < len(ob.data.polygons) else 0
    hits.append((ob.name, ob.material_slots[mi].name, round(loc.x, 3))); org = loc + Vector((1e-4, 0, 0))
print("AXIS non-glass hits:", [h for h in hits if "glass" not in h[1].lower()] or "none", "| glass hits", len(hits))
# feet on the table and clear zones
zones = [("emitter", -4.30, -3.70, lambda v: abs(v.y - layout.OPTICS_Y) < .35), ("plates", -.20, .70, lambda v: abs(v.y - layout.OPTICS_Y) < .35 and v.z > layout.BEAM_Z - .45 + .06),
         ("splitter", 1.20, 1.70, lambda v: abs(v.y - layout.OPTICS_Y) < .35), ("detector", 2.0, 3.0, lambda v: v.y < -.2)]
for o in optics:
    vs = world_verts(o); zmin = min(v.z for v in vs)
    bad = [n for n, a, b_, f in zones if any(a <= v.x <= b_ and v.z > layout.BENCH_TOP + .001 and f(v) for v in vs)]
    print(f"  {o.name:22s} zmin {zmin:.4f} zone clashes {bad or 'none'}")
shoot(os.path.join(PREV, "bench-front.png"), (-.6, -.25, 1.75), (.55, -.82, .42), 4.3)
shoot(os.path.join(PREV, "bench-optics.png"), (-.9, -.85, 2.72), (.28, -.88, .36), 2.35)
shoot(os.path.join(PREV, "bench-cabinets.png"), (1.15, -1.25, 1.35), (.5, -.84, .2), 2.0)
shoot(os.path.join(PREV, "bench-detail.png"), (1.05, .62, 2.75), (.45, -.8, .45), .95, size=(1200, 800))
print("DONE")
