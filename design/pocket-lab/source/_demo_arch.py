import sys, os, time, math
sys.path.insert(0, os.path.join(os.getcwd(), "source"))
import lib, layout, arch
t = time.time(); lib.reset()
C = lib.collection("ARCH")
objs, anchors, st = arch.build(C)
print("ARCH", lib.stats(objs), round(time.time() - t, 2), anchors)
sz = (1300, 900)
lib.render_preview(os.path.join(os.getcwd(), "previews", "arch-hero.png"), objs, direction=(.53, -.80, .30), size=sz, samples=40, fov=28, margin=1.0)
lib.render_preview(os.path.join(os.getcwd(), "previews", "arch-stair.png"), [o for o in objs if "STAIR" in o.name or "RAIL" in o.name], direction=(-.35, -.9, .35), size=(900, 900), samples=40, fov=30, margin=1.05)
print("DONE", round(time.time() - t, 2))
