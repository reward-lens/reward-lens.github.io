"""Build the static pocket laboratory: architecture, dressing, bench and
optics, gantry frame, furniture, plants and props; bake per-vertex AO; export
raw/lab.glb and raw/anchors.json (glTF coordinates).

    cd design/pocket-lab
    $BLENDER --background --factory-startup --python source/build_room.py -- [--no-bake] [--preview TAG]

The articulated mechanism is built separately by source/build_rig.py.
"""
import sys, os, json, math, time, random, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import lib, layout as L, arch, dressing

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
BAKE = "--no-bake" not in ARGS
PREVIEW = ARGS[ARGS.index("--preview") + 1] if "--preview" in ARGS else None
SKIP = set(ARGS[ARGS.index("--skip") + 1].split(",")) if "--skip" in ARGS else set()
NO_EXPORT = "--no-export" in ARGS
T0 = time.time()

def log(*a): print("[room]", f"{time.time() - T0:6.1f}s", *a, flush=True)

def optional(name):
    if name in SKIP: log(f"module {name} skipped"); return None
    try: return importlib.import_module(name)
    except Exception as e:
        log(f"module {name} unavailable: {e.__class__.__name__}: {e}"); return None

def gltf(p): return [round(p[0], 5), round(p[2], 5), round(-p[1], 5)]

lib.reset()
ROOM = lib.collection("ROOM")
objs = []
practicals = {}   # name -> dict(position, direction, kind) in Blender coords

a_objs, soffit, stair = arch.build(ROOM); objs += a_objs
for k, p in soffit.items(): practicals[k] = dict(position=p, direction=(0, 0, -1), kind="soffit")
d_objs, case_lights, spots, shelves = dressing.build(ROOM); objs += d_objs
for k, (p, d) in case_lights.items(): practicals[k] = dict(position=p, direction=d, kind="case")
log("architecture + dressing", lib.stats(objs))

gantry = optional("gantry")
if gantry: objs += gantry.gantry_frame(ROOM); log("gantry frame")
inst = optional("instruments")
bays = []
if inst:
    objs += inst.optical_bench(ROOM); objs += inst.bench_optics(ROOM)
    try: bays = inst.bench_bays()
    except Exception as e: log("bench_bays failed", e)
    log("bench + optics", lib.stats(objs))

# ------------------------------------------------------------------ props
plants = optional("plants"); furn = optional("furniture"); sp = optional("smallprops")
rng = random.Random(1811)

def spot(i):
    x, y, z, yaw = spots[max(0, min(len(spots) - 1, i))]
    return (x, y, z), yaw

def shelf_point(si, f, out=.15):
    """Point on shelf si at fraction f (0 left .. 1 right), `out` m from the wall."""
    x0, x1, z, tb, ta = shelves[si]
    t = tb + (ta - tb) * f
    p = L.wall_inner(t, out)
    n = L.wall_normal(t); yaw = math.atan2(n[0], -n[1])   # local -Y faces the room
    return (p[0], p[1], z), yaw

def add(result):
    global objs
    if result is None: return
    if isinstance(result, dict): objs += result.get("objects", [])
    elif isinstance(result, (list, tuple)): objs += list(result)
    else: objs.append(result)

def lamp(name, base, yaw, scale=1.0):
    if not furn: return
    r = furn.desk_lamp("DESK_" + name, base, yaw, ROOM, scale=scale)
    add(r)
    practicals[name] = dict(position=tuple(r["aperture"]), direction=tuple(r["direction"]), kind="desk")

if furn:
    tr = furn.trolley("TROLLEY", L.TROLLEY["center"], L.FLOOR, L.TROLLEY["yaw"], ROOM, size=L.TROLLEY["size"])
    add(tr)
    add(furn.stool("STOOL_LOWER", L.STOOL_LOWER, L.FLOOR, L.STOOL_SEAT, .32, ROOM))
    add(furn.stool("STOOL_UPPER", L.STOOL_UPPER, L.GALLERY_TOP, L.GALLERY_TOP + .75, .26, ROOM))
    # gallery counter lamps and lower shelf lamps
    p, yaw = spot(7); lamp("TASK_LIGHT_UPPER_LEFT", p, yaw)
    p, yaw = spot(33); lamp("TASK_LIGHT_UPPER_RIGHT", p, yaw)
    p, yaw = shelf_point(0, .82); lamp("TASK_LIGHT_BENCH_LEFT", p, yaw, .8)
    p, yaw = shelf_point(2, .16); lamp("TASK_LIGHT_BENCH_RIGHT", p, yaw, .8)
    if sp:
        cx, cy = L.TROLLEY["center"]; yaw = L.TROLLEY["yaw"]
        c, s = math.cos(yaw), math.sin(yaw)
        def on_trolley(dx, dy, z): return (cx + dx * c - dy * s, cy + dx * s + dy * c, z)
        for i, dx in enumerate((-.3, -.1)): add(sp.lens_canister(f"TROLLEY_CAN_{i}", on_trolley(dx, 0, tr["top_z"]), ROOM, r=.085, h=.2 + .04 * i, style=i))
        add(sp.book_stack("TROLLEY_BOOKS", on_trolley(.22, 0, tr["top_z"]), yaw + .1, ROOM, count=2, seed=4))
        for i, dx in enumerate((-.28, -.06, .16)): add(sp.lens_canister(f"TROLLEY_LOW_{i}", on_trolley(dx, 0, tr["shelf_z"]), ROOM, r=.08, h=.22 + .03 * (i % 2), style=(i + 2) % 4))

if plants:
    add(plants.floor_plant("FLOOR_PLANT", (*L.FLOOR_PLANT, L.FLOOR), ROOM, seed=7))
    p, yaw = spot(3); add(plants.desk_plant("GALLERY_PLANT", p, ROOM, seed=3))
    p, yaw = spot(39); add(plants.desk_plant("GALLERY_PLANT_R", p, ROOM, height=.45, seed=11))
    p, yaw = shelf_point(1, .1, .14); add(plants.trailing_plant("SHELF_TRAILER", p, ROOM, seed=5))

if sp:
    # gallery counter, left to right
    p, yaw = spot(10); add(sp.book_stack("GAL_BOOKS_A", p, yaw + .2, ROOM, count=3, seed=1))
    p, yaw = spot(12); add(sp.book_row("GAL_ROW_A", p, yaw, .42, ROOM, seed=2))
    for k, i in enumerate((16, 17, 18, 19)):
        p, yaw = spot(i); add(sp.lens_canister(f"GAL_CAN_{k}", p, ROOM, r=.075 + .01 * (k % 2), h=.18 + .05 * (k % 3), style=k % 4, yaw=yaw))
    p, yaw = spot(22); add(sp.brass_instrument("GAL_GAUGE", p, ROOM, kind=0, yaw=yaw))
    for k, i in enumerate((25, 26, 28)):
        p, yaw = spot(i); add(sp.lens_canister(f"GAL_CAN_R{k}", p, ROOM, r=.08, h=.2 + .04 * k, style=(k + 1) % 4, yaw=yaw))
    p, yaw = spot(30); add(sp.jar("GAL_JAR", p, ROOM))
    p, yaw = spot(36); add(sp.book_row("GAL_ROW_B", p, yaw, .36, ROOM, seed=6))
    # lower shelves
    for si, items in enumerate((
        [("canister", .12), ("canister", .22), ("canister", .32), ("books", .45), ("jar", .64)],
        [("books", .30), ("flask", .55), ("canister", .70), ("canister", .80), ("gauge", .92)],
        [("canister", .38), ("canister", .48), ("flask", .62), ("books", .72)],
        [("books", .06), ("canister", .40), ("canister", .52), ("canister", .64), ("telescope", .84)],
    )):
        for k, (kind, f) in enumerate(items):
            p, yaw = shelf_point(si, f)
            nm = f"SHELF_{si}_{k}"
            if kind == "canister": add(sp.lens_canister(nm, p, ROOM, r=.07 + .015 * (k % 2), h=.16 + .06 * ((k + si) % 3), style=(k + si) % 4, yaw=yaw))
            elif kind == "books": add(sp.book_row(nm, p, yaw, .34, ROOM, heights=(.2, .27), seed=si * 7 + k))
            elif kind == "jar": add(sp.jar(nm, p, ROOM))
            elif kind == "flask": add(sp.flask(nm, p, ROOM))
            elif kind == "gauge": add(sp.brass_instrument(nm, p, ROOM, kind=0, yaw=yaw))
            elif kind == "telescope": add(sp.brass_instrument(nm, p, ROOM, kind=1, yaw=yaw))
    # bench extras: pencil cup, notebook, stacked books at the right end
    add(sp.pencil_cup("BENCH_PENCILS", (2.80, .55, L.BENCH_TOP), ROOM))
    add(sp.notebook("BENCH_NOTEBOOK", (2.45, .62, L.BENCH_TOP), -.25, ROOM))
    # a stack of large folios on the floor at the bench's right front corner
    fb = sp.book_stack("FLOOR_BOOKS", (3.02, -1.92, L.FLOOR), .38, ROOM, count=4, seed=9)
    for o in fb: o.scale = (1.75, 1.75, 1.75)
    add(fb)
    # open bays under the bench
    for i, b in enumerate(bays):
        (x, y, z), (w, d, h) = b["center"], b["size"]
        if h < .2 or w < .25: continue
        x0 = x - w / 2 + .03; zb = z - h / 2
        if i % 2 == 0: add(sp.book_row(f"BAY_BOOKS_{i}", (x0, y, zb), 0.0, w * .62, ROOM, heights=(min(.3, h * .8), min(.36, h * .92)), seed=20 + i))
        else: add(sp.binder_row(f"BAY_BINDERS_{i}", (x0, y, zb), 0.0, w * .55, ROOM, height=min(.34, h * .9), seed=30 + i))
        if w > .6: add(sp.lens_canister(f"BAY_CAN_{i}", (x + w / 2 - .14, y, zb), ROOM, r=.07, h=min(.2, h * .7), style=i % 4))
log("props", lib.stats(objs))

# ----------------------------------------------------------- semantic nodes
pts, Ls = L.stair_line(); mid = L.stair_frame(Ls / 2, pts)[0]
semantic = {
    "PLINTH": (0, L.PLINTH_C[1], L.FLOOR / 2), "CURVED_WALL": (0, L.WALL_C[1] + L.WALL_R[1], 4.0),
    "UPPER_GALLERY": (0, 2.4, L.GALLERY_TOP), "RIGHT_STAIRS": (mid[0], mid[1], (L.FLOOR + L.GALLERY_TOP) / 2),
    "GANTRY": (sum(L.GANTRY_X) / 2, L.GANTRY_Y, L.GANTRY_BEAM_Z), "OPTICAL_BENCH": (sum(L.BENCH_X) / 2, sum(L.BENCH_Y) / 2, L.BENCH_TOP),
    **L.STATIONS, **L.ANCHORS,
}
anchors = {k: gltf(v) for k, v in semantic.items()}
for k, v in practicals.items(): anchors[k] = gltf(v["position"])
ANCH = lib.collection("ANCHORS")
for k, v in semantic.items(): lib.empty(k, v, ANCH)
for k, v in practicals.items(): lib.empty(k, v["position"], ANCH)

static = [o for o in objs if o.type == "MESH"]
log("static total", lib.stats(static))
os.makedirs(lib.RAW, exist_ok=True)
if not NO_EXPORT: bpy.ops.wm.save_as_mainfile(filepath=os.path.join(lib.RAW, "lab.blend"))
if BAKE:
    lib.bake_vertex_ao(static, samples=96, distance=.85)
    log("AO baked")
if PREVIEW:
    lib.render_preview(os.path.join(lib.PREVIEWS, f"{PREVIEW}-hero.png"), static, direction=(.53, -.80, .30), size=(1400, 980), samples=64, fov=28, margin=.98)
    log("preview rendered")
if NO_EXPORT: print("ROOM_BUILD_COMPLETE (no export)"); sys.exit(0)
lib.export_glb(os.path.join(lib.RAW, "lab.glb"), static + list(ANCH.objects), vertex_colors=BAKE)
side = {"version": 3, "coordinateSystem": "gltf-y-up", "anchors": anchors,
        "practicals": {k: {"position": gltf(v["position"]), "direction": gltf(v["direction"]), "kind": v["kind"]} for k, v in practicals.items()}}
with open(os.path.join(lib.RAW, "anchors.json"), "w") as f: json.dump(side, f, indent=2)
log("exported", os.path.getsize(os.path.join(lib.RAW, "lab.glb")), "bytes;", len(practicals), "practicals")
print("ROOM_BUILD_COMPLETE")
