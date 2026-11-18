"""Build the three plants side by side and render review stills.

Run from design/pocket-lab:
  $B --background --factory-startup --python source/_demo_plants.py
Optional env: PLANTS_ONLY=front|close to render one still.
"""
import sys, os, time
sys.path.insert(0, os.path.join(os.getcwd(), "source"))
import lib, plants
from mathutils import Vector

t0 = time.time()
lib.reset()
C = lib.collection("PLANTS_DEMO")
slab = lib.rbox((3.3, 1.6, .06), bevel=.02, loc=(-.05, .15, -.03)).obj("_ground", "CERAMIC_Pale", C)
# a shelf for the trailing plant: top at z .80, front face 0.15 m in front of the pot
shelf = lib.rbox((.62, .44, .80), bevel=.012, loc=(1.05, .07, .40)).obj("_shelf", "CERAMIC_Pale", C)

floor = plants.floor_plant("FloorPlant", (-.8, .05, 0), C)
desk = plants.desk_plant("DeskPlant", (.25, -.2, 0), C)
trail = plants.trailing_plant("TrailPlant", (1.05, 0, .80), C)
for nm, objs in (("floor", floor), ("desk", desk), ("trailing", trail)):
    st = lib.stats(objs)
    print(f"[stats] {nm}: objects={st['objects']} triangles={st['triangles']} names={[o.name for o in objs]}")
print(f"[time] build {time.time() - t0:.1f}s")

only = os.environ.get("PLANTS_ONLY", "")
if only in ("", "front"):
    lib.render_preview(os.path.join(lib.PREVIEWS, "plants-front.png"), [slab, shelf] + floor + desk + trail,
                       direction=(.55, -.82, .42), size=(1400, 900), samples=64, margin=1.0)
if only in ("", "close"):
    disc = lib.cyl(.85, .04, z0=-.04, segments=64, bevel=.01).transform(loc=(-.8, .05, 0)).obj("_ground_close", "CERAMIC_Pale", C)
    lib.render_preview(os.path.join(lib.PREVIEWS, "plants-close.png"), [disc] + floor,
                       direction=(.2, -1, .25), size=(1000, 1100), samples=64, margin=.95)
if only in ("", "detail"):
    lib.render_preview(os.path.join(lib.PREVIEWS, "plants-desk.png"), desk, direction=(.45, -1, .45), size=(900, 900), samples=48, margin=.9)
    lib.render_preview(os.path.join(lib.PREVIEWS, "plants-trailing.png"), [shelf] + trail, direction=(.35, -1, .2), size=(900, 1100), samples=48, margin=.8)
print(f"[time] total {time.time() - t0:.1f}s")
