"""Preview: gantry frame + rig + stand-ins for the table and gallery floor."""
import sys, os; sys.path.insert(0, os.path.join(os.getcwd(), "source"))
import bpy, math, numpy as np
from mathutils import Vector
import lib, layout as L, gantry, build_rig

lib.reset()
C = lib.collection("RIG_DEMO")
frame = gantry.gantry_frame(C)
R = build_rig.build(C)
print("FRAME", lib.stats(frame), "RIG", lib.stats(R.meshes))
bx, by = L.BENCH_X, L.BENCH_Y
lib.rbox((bx[1] - bx[0], by[1] - by[0], L.BENCH_SLAB), .03, 2, loc=((bx[0] + bx[1]) / 2, (by[0] + by[1]) / 2, L.BENCH_TOP - L.BENCH_SLAB / 2)).obj("DEMO_TABLE", "OPTICAL_TABLE_Top", col=C)
ts, back, front = L.gallery_samples(48)
lib.slab([(x, y, 0) for x, y in back], [(x, y, 0) for x, y in front], L.GALLERY_TOP, L.GALLERY_T).obj("DEMO_GALLERY", "CERAMIC_Pale", col=C)

def shoot(path, center, radius, direction, size, fov=30, samples=40):
    sc = lib.setup_cycles(samples); c = Vector(center); d = Vector(direction).normalized()
    dist = radius / math.sin(math.radians(fov) / 2)
    cd = bpy.data.cameras.new("_cam"); cd.lens_unit = "FOV"; cd.angle = math.radians(fov)
    cam = bpy.data.objects.new("_cam", cd); sc.collection.objects.link(cam)
    cam.location = c + d * dist; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler(); sc.camera = cam
    extra = []
    for name, off, e, sz, colr in (("_key", (-.6, -.7, .9), 900, 3.0, (1, .96, .9)), ("_fill", (.9, -.4, .3), 250, 4.0, (.85, .93, 1)), ("_rim", (.2, .9, .8), 300, 2.0, (1, 1, 1))):
        ld = bpy.data.lights.new(name, "AREA"); ld.energy = e * (radius / 2) ** 2; ld.size = sz * radius / 2; ld.color = colr
        lo = bpy.data.objects.new(name, ld); sc.collection.objects.link(lo)
        lo.location = c + Vector(off).normalized() * dist * .8; lo.rotation_euler = (c - lo.location).to_track_quat("-Z", "Y").to_euler(); extra.append(lo)
    w = sc.world; w.use_nodes = True; bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = lib.srgb("#C9DCD9"); bg.inputs["Strength"].default_value = .7
    sc.render.resolution_x, sc.render.resolution_y = size; sc.render.resolution_percentage = 100
    sc.cycles.use_denoising = True; sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"
    sc.render.image_settings.file_format = "PNG"; sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in extra + [cam]: bpy.data.objects.remove(o, do_unlink=True)
    return path

def tile(path, shots, cols):
    """Render shots [(center, radius, direction)] as tiles and compose a grid."""
    tw, th = 700, 520; imgs = []
    for k, (c, r, d) in enumerate(shots):
        p = path.replace(".png", f"_t{k}.png"); shoot(p, c, r, d, (tw, th)); imgs.append(p)
    rows = (len(imgs) + cols - 1) // cols
    out = np.ones((rows * th, cols * tw, 4), np.float32)
    for k, p in enumerate(imgs):
        im = bpy.data.images.load(p); a = np.array(im.pixels[:], np.float32).reshape(th, tw, 4)
        r_, c_ = rows - 1 - k // cols, k % cols
        out[r_ * th:(r_ + 1) * th, c_ * tw:(c_ + 1) * tw] = a; bpy.data.images.remove(im); os.remove(p)
    img = bpy.data.images.new("_comp", cols * tw, rows * th, alpha=True); img.pixels.foreach_set(out.ravel())
    img.filepath_raw = path; img.file_format = "PNG"; img.save()

PV = os.path.join(os.getcwd(), "previews")
which = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["front", "head", "optics"]
if "front" in which:
    lib.render_preview(os.path.join(PV, "rig-front.png"), direction=(.55, -.82, .42), size=(1400, 1000), samples=40)
if "head" in which:
    X, Y = L.MICRO_X, L.MICRO_Y
    tile(os.path.join(PV, "rig-head.png"), [((X + .1, 1.0, 6.95), .75, (.55, -.82, .30)), ((X, Y, 5.5), 2.45, (.55, -.82, .15)),
                                            ((X + .05, Y - .05, 4.5), .62, (.55, -.82, .20)), ((X - .03, Y + .03, 3.86), .34, (.55, -.82, .12))], 2)
if "optics" in which:
    tile(os.path.join(PV, "rig-optics.png"), [((-4.08, -.8, 2.85), .5, (.55, -.82, .35)), ((.25, -.85, 2.75), .5, (.55, -.82, .35)),
                                              ((1.45, -.85, 2.85), .5, (.55, -.82, .35)), ((2.45, -.8, 2.9), .65, (.25, -.95, .30))], 2)
