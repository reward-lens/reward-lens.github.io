"""Assemble whatever modules exist and render review stills (no export)."""
import sys, os, time, math, importlib
sys.path.insert(0, os.path.join(os.getcwd(), "source"))
import lib, layout, arch, dressing
t = time.time(); lib.reset()
C = lib.collection("ROOM")
objs, soffit, st = arch.build(C)
d_objs, gal_lights, spots, shelves = dressing.build(C); objs += d_objs
print("ROOM", lib.stats(objs), round(time.time() - t, 2))
tag = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith(".py") else "room"
lib.render_preview(os.path.join(os.getcwd(), "previews", f"{tag}-hero.png"), objs, direction=(.53, -.80, .30), size=(1300, 900), samples=48, fov=28, margin=1.0)
lib.render_preview(os.path.join(os.getcwd(), "previews", f"{tag}-back.png"), [o for o in objs if o.name.startswith(("DRESS_", "ARCH_GALLERY", "ARCH_WALL"))], direction=(.15, -.95, .18), size=(1300, 800), samples=48, fov=24, margin=.82)
print("DONE", round(time.time() - t, 2))
