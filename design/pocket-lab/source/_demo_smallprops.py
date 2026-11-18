"""Demo for smallprops: a labelled grid of every prop and a shelf vignette.

Run from design/pocket-lab:
  $B --background --factory-startup --python source/_demo_smallprops.py -- [grid] [shelf] [closeA] [closeB] [closeC]
(no arguments: grid and shelf). Prints a STAT line per item and fails on a budget breach.
"""
import sys, os
sys.path.insert(0, os.path.join(os.getcwd(), "source"))
import math
import lib, smallprops as sp

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
todo = set(argv) or {"grid", "shelf"}

lib.reset()
C = lib.collection("SMALLPROPS_DEMO")
rows = {"A": [], "B": [], "C": []}
budget_fail = []

def item(row, label, objs, budget=None, per=1):
    tris = lib.stats(objs)["triangles"]
    each = tris / per
    flag = "" if budget is None or each <= budget else "  OVER"
    print(f"STAT {label:28s} tris={tris:5d} per={each:7.1f} budget={budget} objects={len(objs)}{flag}")
    if flag: budget_fail.append(label)
    rows[row] += objs
    return objs

def slab(name, x0, x1, y0, y1):
    g = lib.rbox((x1 - x0, y1 - y0, .03), bevel=.008, segments=2, loc=((x0 + x1) / 2, (y0 + y1) / 2, -.015))
    return g.obj(name, "CERAMIC_Pale", col=C)

# Row A: canisters and glassware (y = 0)
y = 0.0
item("A", "canister style0 default", sp.lens_canister("CAN_0", (-1.12, y, 0), C, r=.09, h=.22, style=0), 1500)
item("A", "canister style0 small", sp.lens_canister("CAN_0b", (-.90, y, 0), C, r=.065, h=.15, style=0, yaw=.6), 1500)
item("A", "canister style1 zoom", sp.lens_canister("CAN_1", (-.72, y, 0), C, r=.065, h=.21, style=1), 1500)
item("A", "canister style2 hood", sp.lens_canister("CAN_2", (-.52, y, 0), C, r=.075, h=.17, style=2), 1500)
item("A", "canister style3 tube", sp.lens_canister("CAN_3", (-.35, y, 0), C, r=.045, h=.24, style=3), 1500)
for i, nm in enumerate(("JAR_a", "JAR_b", "JAR_c")):
    item("A", f"jar {nm}", sp.jar(nm, (-.20 + .15 * i, y, 0), C), 1200)
item("A", "flask", sp.flask("FLASK", (.30, y, 0), C), 1200)
rows["A"].append(slab("SLAB_A", -1.28, .48, -.17, .17))

# Row B: single books, stack, cup, notebook, curios (y = .42)
y = .42
item("B", "book standing", sp.book("BOOK_s", (-1.12, y, 0), 0, C), 300)
item("B", "book standing slate", sp.book("BOOK_s2", (-1.05, y, 0), .15, C, size=(.035, .18, .25), cover="BOOK_Cover_Slate"), 300)
item("B", "book lying", sp.book("BOOK_l", (-.82, y, 0), .3, C, size=(.04, .2, .27), cover="BOOK_Cover_Rust", lying=True), 300)
item("B", "book stack x3", sp.book_stack("STACK", (-.50, y, 0), -.2, C, count=3, seed=2), 300, per=3)
item("B", "pencil cup", sp.pencil_cup("CUP", (-.24, y, 0), C), 2000)
item("B", "notebook", sp.notebook("NOTE", (-.05, y, 0), .25, C), 400)
item("B", "gauge", sp.brass_instrument("GAUGE", (.16, y, 0), C, kind=0), 3000)
item("B", "telescope", sp.brass_instrument("SCOPE", (.36, y, 0), C, kind=1, yaw=-.4), 3000)
rows["B"].append(slab("SLAB_B", -1.28, .48, .25, .60))

# Row C: book row and binder row (y = .86)
y = .86
br = sp.book_row("ROW", (-1.22, y, 0), 0, .66, C, seed=4)
nb = len([1 for o in br for p in o.data.polygons]) and None
item("C", "book_row .66 m", br, None)
item("C", "binder single", sp.binder_row("BIND1", (-.48, y, 0), 0, .082, C, seed=1), 400)
item("C", "binder_row .52 m", sp.binder_row("BINDERS", (-.36, y, 0), 0, .52, C, seed=3), None)
rows["C"].append(slab("SLAB_C", -1.28, .48, .68, 1.05))

# Shelf vignette, far from the grid
X, Y = 6.0, 0.0
shelf = [lib.rbox((1.6, .34, .03), bevel=.006, loc=(X, Y, -.015)).obj("SHELF_board", "PETROL_Trim", col=C),
         lib.rbox((1.64, .02, .48), bevel=.004, loc=(X, Y + .18, .22)).obj("SHELF_back", "PETROL_Painted", col=C),
         lib.rbox((.03, .36, .48), bevel=.006, loc=(X - .815, Y + .0, .22)).obj("SHELF_end_l", "PETROL_Trim", col=C),
         lib.rbox((.03, .36, .48), bevel=.006, loc=(X + .815, Y + .0, .22)).obj("SHELF_end_r", "PETROL_Trim", col=C)]
shelf += sp.book_row("SH_ROW", (X - .79, Y + .02, 0), 0, .56, C, seed=11)
shelf += sp.book_stack("SH_STACK", (X - .08, Y - .01, 0), .12, C, count=3, seed=5)
shelf += sp.lens_canister("SH_CAN1", (X + .14, Y - .04, 0), C, r=.06, h=.14, style=0)
shelf += sp.lens_canister("SH_CAN2", (X + .27, Y + .02, 0), C, r=.055, h=.19, style=1)
shelf += sp.lens_canister("SH_CAN3", (X + .38, Y - .05, 0), C, r=.04, h=.22, style=3)
shelf += sp.jar("SH_JAR", (X + .49, Y + .03, 0), C, r=.05, h=.12)
shelf += sp.flask("SH_FLASK", (X + .60, Y - .03, 0), C, h=.18)
shelf += sp.brass_instrument("SH_GAUGE", (X + .73, Y + .02, 0), C, kind=0, yaw=-.15)

P = lib.PREVIEWS
grid = rows["A"] + rows["B"] + rows["C"]
if "grid" in todo:
    lib.render_preview(os.path.join(P, "smallprops-grid.png"), objects=grid, direction=(.55, -.82, .42), size=(1600, 1000), samples=48, margin=1.0)
if "shelf" in todo:
    lib.render_preview(os.path.join(P, "smallprops-shelf.png"), objects=shelf, direction=(.32, -.9, .30), size=(1600, 800), samples=48, margin=.95)
for k in ("A", "B", "C"):
    if f"close{k}" in todo:
        lib.render_preview(os.path.join(P, f"smallprops-close{k}.png"), objects=rows[k], direction=(.45, -.85, .38), size=(1600, 700), samples=48, margin=.92)
print("SUMMARY budgets", "FAIL " + ",".join(budget_fail) if budget_fail else "OK")
