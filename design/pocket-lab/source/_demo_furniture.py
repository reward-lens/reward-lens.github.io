"""Demo + checks for furniture.py: builds every piece on a pale slab, prints
triangle counts, floor contact and trolley footprint, renders previews.
Run from design/pocket-lab:  $B --background --factory-startup --python source/_demo_furniture.py
Pass `-- quick` to skip the close-ups."""
import sys, os; sys.path.insert(0, os.path.join(os.getcwd(), "source"))
import math
import bpy
from mathutils import Vector
import lib, furniture

QUICK = "quick" in sys.argv
lib.reset()
C = lib.collection("FURNITURE_DEMO")
ground = lib.rbox((5.6, 3.0, .1), bevel=.02, loc=(.75, .25, -.05)).obj("DEMO_Ground", "CERAMIC_Pale", C)
wall = lib.rbox((1.1, .08, 1.5), bevel=.01, loc=(2.75, 1.0, .75)).obj("DEMO_Wall", "PETROL_Painted", C)

T_SIZE, T_YAW = (0.95, 0.52), math.radians(8)
T = furniture.trolley("DEMO_TROLLEY", (-1.05, 0.05), 0.0, T_YAW, C, size=T_SIZE)
S1 = furniture.stool("DEMO_STOOL_L", (0.35, -.05), 0.0, .95, .32, C)
S2 = furniture.stool("DEMO_STOOL_U", (1.2, -.05), 0.0, .75, .26, C)
L1 = furniture.desk_lamp("DEMO_LAMP_A", (1.95, .55, 0), math.radians(20), C)
L2 = furniture.desk_lamp("DEMO_LAMP_B", (2.15, -.25, 0), math.radians(-30), C, scale=.9)
SC = furniture.wall_sconce("DEMO_SCONCE", (2.6, .96, .95), (0, -1), C)


def wverts(objs):
    for o in objs:
        mw = o.matrix_world
        for v in o.data.vertices: yield o, mw @ v.co


def report(label, objs, budget):
    st = lib.stats(objs)
    zmin = min(p.z for _, p in wverts(objs))
    print(f"CHECK {label}: tris={st['triangles']} (budget {budget}) {'OK' if st['triangles'] <= budget else 'OVER'} "
          f"objects={[o.name for o in objs]} zmin={zmin:.5f}")


report("trolley", T["objects"], 14000)
report("stool_floor", S1, 9000)
report("stool_gallery", S2, 9000)
report("lamp", L1["objects"], 5000)
report("sconce", SC["objects"], 2000)
print(f"CHECK trolley top_z={T['top_z']:.4f} shelf_z={T['shelf_z']:.4f}")
# footprint, in the trolley's own frame
c, s = math.cos(-T_YAW), math.sin(-T_YAW); mx = my = 0
for _, p in wverts(T["objects"]):
    x, y = p.x + 1.05, p.y - .05
    mx = max(mx, abs(c * x - s * y)); my = max(my, abs(s * x + c * y))
print(f"CHECK trolley footprint half-extent ({mx:.4f}, {my:.4f}) vs ({T_SIZE[0]/2}, {T_SIZE[1]/2}) "
      f"{'OK' if mx <= T_SIZE[0]/2 and my <= T_SIZE[1]/2 else 'OUTSIDE'}")
for nm, objs in (("stool_floor", S1), ("stool_gallery", S2)):
    rub = [o for o in objs if o.name.endswith("Rubber")]
    print(f"CHECK {nm} wheel zmin={min(p.z for _, p in wverts(rub)):.6f}  seat zmax={max(p.z for _, p in wverts(objs)):.4f}")
rub = [o for o in T["objects"] if o.name.endswith("Rubber")]
print(f"CHECK trolley wheel zmin={min(p.z for _, p in wverts(rub)):.6f}")
for nm, L in (("lamp_A", L1), ("lamp_B", L2), ("sconce", SC)):
    zmax = max(p.z for _, p in wverts(L["objects"]))
    print(f"CHECK {nm} aperture={tuple(round(v, 4) for v in L['aperture'])} dir={tuple(round(v, 3) for v in L['direction'])} zmax={zmax:.4f}")

OUT = os.path.join(lib.PREVIEWS)


def render_focus(path, objs, center, rad, direction, size=(1100, 800), samples=48, fov=30.0):
    """Like lib.render_preview but framed on (center, rad) instead of object bounds."""
    sc = lib.setup_cycles(samples)
    hidden = [o for o in sc.objects if o.type == "MESH" and o not in objs and not o.hide_render]
    for o in hidden: o.hide_render = True
    c = Vector(center); d = Vector(direction).normalized(); dist = rad / math.sin(math.radians(fov) / 2)
    cd = bpy.data.cameras.new("_cam"); cd.lens_unit = "FOV"; cd.angle = math.radians(fov)
    cam = bpy.data.objects.new("_cam", cd); sc.collection.objects.link(cam)
    cam.location = c + d * dist; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler(); sc.camera = cam
    extra = []
    for name, off, energy, size_, colr in (("_key", (-.6, -.7, .9), 900, 3.0, (1, .96, .9)), ("_fill", (.9, -.4, .3), 250, 4.0, (.85, .93, 1)), ("_rim", (.2, .9, .8), 300, 2.0, (1, 1, 1))):
        ld = bpy.data.lights.new(name, "AREA"); ld.energy = energy * (rad / 2) ** 2; ld.size = size_ * rad / 2; ld.color = colr
        lo = bpy.data.objects.new(name, ld); sc.collection.objects.link(lo)
        lo.location = c + Vector(off).normalized() * dist * .8
        lo.rotation_euler = (c - lo.location).to_track_quat("-Z", "Y").to_euler(); extra.append(lo)
    w = sc.world; w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    if bg: bg.inputs["Color"].default_value = lib.srgb("#C9DCD9"); bg.inputs["Strength"].default_value = .7
    sc.render.resolution_x, sc.render.resolution_y = size; sc.render.resolution_percentage = 100
    sc.cycles.use_denoising = True; sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"
    sc.render.image_settings.file_format = "PNG"; sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in extra + [cam]: bpy.data.objects.remove(o, do_unlink=True)
    for o in hidden: o.hide_render = False


everything = [o for o in C.objects if o.type == "MESH"]
lib.render_preview(os.path.join(OUT, "furniture-front.png"), everything, direction=(.55, -.82, .42), size=(1400, 800), samples=48, margin=.92)
if not QUICK:
    tro = T["objects"] + [ground]
    render_focus(os.path.join(OUT, "furniture-trolley.png"), tro, (-1.05, .05, .52), .95, (.5, -.8, .34))
    render_focus(os.path.join(OUT, "furniture-stool.png"), S1 + S2 + [ground], (.78, -.05, .45), .78, (.45, -.85, .3))
    render_focus(os.path.join(OUT, "furniture-lamp.png"), L1["objects"] + L2["objects"] + SC["objects"] + [ground, wall], (2.3, .35, .55), .62, (.6, -.78, .3))
    render_focus(os.path.join(OUT, "furniture-castor.png"), tro, (-.59, -.107, .1), .16, (.55, -.8, .22), size=(900, 700))
    render_focus(os.path.join(OUT, "furniture-stoolbase.png"), S1 + [ground], (.35, -.05, .12), .32, (.5, -.8, .28), size=(900, 700))
print("DEMO DONE")
