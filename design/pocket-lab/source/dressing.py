"""Built-in dressing: display cases, the gallery counter, the lower back wall
(door, framed print, curved shelves with brackets). Props that stand on these
surfaces are placed by build_room.py from the surfaces returned here.

Wall-mounted pieces are modelled in a local frame and moved onto the curved
wall by `wall_matrix(t, z)`: local X runs along the wall to the right, local
+Y points INTO the wall, Z is up, so a piece's front faces local -Y (the
room), the same convention as the whole scene.
"""
import math
from mathutils import Vector, Matrix
import lib
import layout as L

def wall_matrix(t, z, inset=0.0):
    nx, ny = L.wall_normal(t)                 # into the room
    tx, ty = -ny, nx                          # along the wall, to the right at the back
    if tx < 0 and abs(t - math.pi / 2) < math.pi / 2: tx, ty = -tx, -ty
    px, py = L.wall_inner(t, inset)
    return Matrix(((tx, -nx, 0, px), (ty, -ny, 0, py), (0, 0, 1, z), (0, 0, 0, 1)))

def wall_point(t, z, along=0.0, out=0.0):
    """World point near the wall: `out` metres into the room, `along` to the right."""
    m = wall_matrix(t, z)
    return m @ Vector((along, -out, 0))

def t_at_x(x):
    return math.acos(max(-1.0, min(1.0, x / L.WALL_R[0])))

def _quad(w, h, uv=(0, 1, 0, 1), y=0.0):
    """A plane in local XZ facing -Y, w x h, centred, with explicit UVs."""
    g = lib.Geo(); bm = g.bm
    vs = [bm.verts.new(p) for p in ((-w / 2, y, -h / 2), (w / 2, y, -h / 2), (w / 2, y, h / 2), (-w / 2, y, h / 2))]
    f = bm.faces.new(vs)
    u0, u1, v0, v1 = uv
    for l, (u, v) in zip(f.loops, ((u0, v0), (u1, v0), (u1, v1), (u0, v1))): l[g.uv].uv = (u, v)
    bm.normal_update()
    if f.normal.y > 0: f.normal_flip()
    return g

# ------------------------------------------------------------ display cases

CASES = [(-0.50, 0), (0.0, 1), (0.50, 2)]      # (angle offset from the back centre, atlas panel)
CASE_W, CASE_H, CASE_Z = 1.32, 1.62, 6.36

def display_cases(col):
    """Three framed light-boxes set into the upper wall, each with a recessed,
    backlit diagram panel behind mullions and glass, a light bar and a sill.
    Returns (objects, {GALLERY_LIGHT_*: (pos, dir)})."""
    parts = {k: [] for k in ("frame", "recess", "panel", "mullion", "bar", "strip", "glass", "sill", "bead")}
    anchors = {}
    fw, depth = .085, .235       # frame runs back 4.5 cm into the wall, covering the curvature gap at its ends
    iw, ih = CASE_W - 2 * fw, CASE_H - 2 * fw
    for (dt, panel), name in zip(CASES, ("GALLERY_LIGHT_LEFT", "GALLERY_LIGHT_CENTER", "GALLERY_LIGHT_RIGHT")):
        t = math.pi / 2 - dt
        # the whole case stands 6 cm proud of the wall so the lit panel sits in
        # front of the wall surface (the wall has no opening behind it)
        M = wall_matrix(t, CASE_Z) @ Matrix.Translation((0, -.06, 0))
        F = []
        # outer frame: four rounded members, protruding .13 from the wall
        F.append(lib.rbox((CASE_W, depth, fw), .018, 3, loc=(0, -.13 + depth / 2, CASE_H / 2 - fw / 2)))
        F.append(lib.rbox((CASE_W, depth, fw), .018, 3, loc=(0, -.13 + depth / 2, -CASE_H / 2 + fw / 2)))
        F.append(lib.rbox((fw, depth, CASE_H - 2 * fw + .01), .018, 3, loc=(-CASE_W / 2 + fw / 2, -.13 + depth / 2, 0)))
        F.append(lib.rbox((fw, depth, CASE_H - 2 * fw + .01), .018, 3, loc=(CASE_W / 2 - fw / 2, -.13 + depth / 2, 0)))
        parts["frame"] += [g.transform(matrix=M) for g in F]
        # a thin brass bead just inside the frame's front face
        B = [lib.rbox((iw + .01, .012, .012), .004, 1, loc=(0, -.128, z)) for z in (ih / 2 - .003, -ih / 2 + .003)]
        B += [lib.rbox((.012, .012, ih), .004, 1, loc=(x, -.128, 0)) for x in (-iw / 2 + .003, iw / 2 - .003)]
        parts["bead"] += [g.transform(matrix=M) for g in B]
        # recess walls (deep petrol), the backlit panel at the back
        R = [lib.rbox((iw, .14, .01), 0, 1, loc=(0, -.03, z)) for z in (ih / 2 - .005, -ih / 2 + .005)]
        R += [lib.rbox((.01, .14, ih), 0, 1, loc=(x, -.03, 0)) for x in (-iw / 2 + .005, iw / 2 - .005)]
        parts["recess"] += [g.transform(matrix=M) for g in R]
        parts["panel"].append(_quad(iw, ih, (panel / 3, (panel + 1) / 3, 0, 1), y=.035).transform(matrix=M))
        # mullions: 3 x 2 panes
        Mu = [lib.rbox((.022, .03, ih), .006, 1, loc=(x, .005, 0)) for x in (-iw / 6, iw / 6)]
        Mu.append(lib.rbox((iw, .03, .022), .006, 1, loc=(0, .005, 0)))
        parts["mullion"] += [g.transform(matrix=M) for g in Mu]
        # light bar inside the head of the frame, warm strip facing down
        parts["bar"].append(lib.rbox((iw - .08, .06, .05), .012, 2, loc=(0, -.08, ih / 2 - .035)).transform(matrix=M))
        parts["strip"].append(lib.rbox((iw - .14, .025, .008), .003, 1, loc=(0, -.085, ih / 2 - .062)).transform(matrix=M))
        parts["glass"].append(_quad(iw, ih, y=-.112).transform(matrix=M))
        parts["sill"].append(lib.rbox((CASE_W + .12, .2, .045), .012, 2, loc=(0, -.09, -CASE_H / 2 - .03)).transform(matrix=M))
        p = M @ Vector((0, -.09, ih / 2 - .07))
        d = (M.to_3x3() @ Vector((0, -.35, -1))).normalized()
        anchors[name] = (tuple(p), tuple(d))
    mats = dict(frame="CERAMIC_Pale", recess="PETROL_Deep", panel="DISPLAY_Lightbox", mullion="ALUMINIUM_Brushed",
                bar="CHARCOAL_Instrument", strip="APRICOT_Task_Light", glass="GLASS_Clear", sill="MARBLE_Floor", bead="BRASS_Restrained")
    out = []
    for k, gs in parts.items():
        g = gs[0].merge(*gs[1:]) if len(gs) > 1 else gs[0]
        out.append(g.obj("DRESS_CASE_" + k.upper(), mats[k], col, wn=k not in ("panel", "glass")))
    return out, anchors

# ----------------------------------------------------------- gallery counter

COUNTER_T = (L.GALLERY_T_END + .28, math.pi - .2)
COUNTER_DEPTH, COUNTER_H = .48, .92

def gallery_counter(col):
    """A curved built-in counter along the gallery wall: pale body with door
    seams, a recessed dark toe-kick and a marble top. Returns objects and a
    list of surface spots [(x, y, z, t)] along the top, left to right."""
    n = 90; t0, t1 = COUNTER_T
    z0 = L.GALLERY_TOP; top = z0 + COUNTER_H
    body, kick, path = [], [], []
    for i in range(n + 1):
        t = t1 + (t0 - t1) * i / n          # left -> right
        a = Vector((*L.wall_inner(t, -.02), 0)); b = Vector((*L.wall_inner(t, COUNTER_DEPTH - .03), 0)); k = Vector((*L.wall_inner(t, COUNTER_DEPTH - .1), 0))
        body.append([Vector((a.x, a.y, z0 + .1)), Vector((b.x, b.y, z0 + .1)), Vector((b.x, b.y, top - .05)), Vector((a.x, a.y, top - .05))])
        kick.append([Vector((a.x, a.y, z0)), Vector((k.x, k.y, z0)), Vector((k.x, k.y, z0 + .1)), Vector((a.x, a.y, z0 + .1))])
        path.append(Vector((*L.wall_inner(t, COUNTER_DEPTH / 2 - .01), top - .025)))
    out = [lib.loft(body, cap=True).uv_box(2).obj("DRESS_COUNTER_BODY", "CERAMIC_Pale", col),
           lib.loft(kick, cap=True).uv_box(2).obj("DRESS_COUNTER_KICK", "PETROL_Deep", col),
           lib.sweep(path, lib.rrect(COUNTER_DEPTH + .05, .05, .018, 3)).uv_box(3).obj("DRESS_COUNTER_TOP", "MARBLE_Floor", col)]
    # door seams and small brass knobs every ~.55 m
    seams, knobs = [], []
    span = lib.path_length(path); count = max(2, round(span / .55))
    for i in range(1, count):
        p, tg = lib.point_at(path, span * i / count)
        t = math.atan2((p.y - L.WALL_C[1]) / L.WALL_R[1], (p.x - L.WALL_C[0]) / L.WALL_R[0])
        f = Vector((*L.wall_inner(t, COUNTER_DEPTH - .028), 0))
        seams.append(lib.rbox((.006, .012, COUNTER_H - .22), 0, 1, loc=(f.x, f.y, z0 + .1 + (COUNTER_H - .22) / 2 + .02), rot=(0, 0, math.atan2(tg.y, tg.x))))
        for side in (-1, 1):
            q = f + Vector((tg.x, tg.y, 0)) * side * .07
            knobs.append(lib.lathe([(0, 0), (.014, 0), (.016, .01), (.012, .022), (0, .024)], 12).transform(loc=(q.x, q.y, top - .2), rot=(math.pi / 2, 0, math.atan2(tg.y, tg.x))))
    out.append(seams[0].merge(*seams[1:]).obj("DRESS_COUNTER_SEAMS", "PETROL_Deep", col))
    out.append(knobs[0].merge(*knobs[1:]).obj("DRESS_COUNTER_KNOBS", "BRASS_Restrained", col))
    spots = []
    for i in range(41):
        p, tg = lib.point_at(path, span * i / 40)
        spots.append((p.x, p.y, top, math.atan2(tg.y, tg.x)))
    return out, spots

# ----------------------------------------------------------- lower back wall

DOOR_X, PRINT_X = -0.85, 0.80
SHELVES = [  # (x_left, x_right, z) along the lower back wall, behind the bench
    (-3.55, -1.55, 2.62), (-3.45, -1.70, 3.28),
    (1.55, 3.05, 2.62), (1.65, 2.95, 3.28),
]
SHELF_DEPTH = .30

def lower_wall(col):
    """Door with architrave and panels, a framed print, curved wall shelves on
    brass brackets. Returns objects and shelf surfaces [(x0, x1, z, t0, t1)]."""
    out = []
    # door
    t = t_at_x(DOOR_X)
    M = wall_matrix(t, L.FLOOR)
    W, H = .98, 2.28
    arch = [lib.rbox((.09, .06, H + .09), .012, 2, loc=(x, -.03, (H + .09) / 2)) for x in (-W / 2 - .045, W / 2 + .045)]
    arch.append(lib.rbox((W + .18, .06, .09), .012, 2, loc=(0, -.03, H + .045)))
    out.append(arch[0].merge(*arch[1:]).transform(matrix=M).obj("DRESS_DOOR_ARCHITRAVE", "CERAMIC_Pale", col))
    leaf = lib.rbox((W - .02, .05, H - .01), .008, 2, loc=(0, .0, H / 2))
    panels = [lib.rbox((W - .26, .02, .8), .01, 2, loc=(0, -.03, z)) for z in (.62, 1.62)]
    out.append(leaf.merge(*panels).transform(matrix=M).obj("DRESS_DOOR_LEAF", "CERAMIC_Pale", col))
    hw = [lib.cyl(.032, .012, segments=20).transform(loc=(W / 2 - .1, -.03, 1.08), rot=(math.pi / 2, 0, 0)),
          lib.tube([(W / 2 - .1, -.04, 1.08), (W / 2 - .1, -.085, 1.08), (W / 2 - .24, -.09, 1.07)], .011, n=10)]
    hw += [lib.cyl(.014, .1, segments=12, z0=z).transform(loc=(-W / 2 + .01, -.03, 0)) for z in (.3, 1.1, 1.9)]
    out.append(hw[0].merge(*hw[1:]).transform(matrix=M).obj("DRESS_DOOR_BRASS", "BRASS_Restrained", col))
    # framed print (texture includes the mat), thin dark frame, glass
    M = wall_matrix(t_at_x(PRINT_X), 2.55)
    pw, ph = .66, .825
    fr = [lib.rbox((pw + .07, .045, .035), .008, 2, loc=(0, -.022, z)) for z in (ph / 2 + .0175, -ph / 2 - .0175)]
    fr += [lib.rbox((.035, .045, ph), .008, 2, loc=(x, -.022, 0)) for x in (-pw / 2 - .0175, pw / 2 + .0175)]
    out.append(fr[0].merge(*fr[1:]).transform(matrix=M).obj("DRESS_PRINT_FRAME", "CHARCOAL_Instrument", col))
    out.append(_quad(pw, ph, y=-.01).transform(matrix=M).obj("DRESS_PRINT_ART", "PRINT_Art", col, wn=False))
    # shelves: curved marble boards following the wall, brass brackets
    boards, brackets, surfaces = [], [], []
    for x0, x1, z in SHELVES:
        ta, tb = math.acos(x1 / L.WALL_R[0]), math.acos(x0 / L.WALL_R[0])
        path = [Vector((*L.wall_inner(tb + (ta - tb) * i / 40, SHELF_DEPTH / 2), z)) for i in range(41)]
        boards.append(lib.sweep(path, lib.rrect(SHELF_DEPTH, .042, .012, 2)))
        span = lib.path_length(path); nb = max(2, round(span / .7) + 1)
        for i in range(nb):
            tt = tb + (ta - tb) * (.08 + .84 * i / (nb - 1))
            Mb = wall_matrix(tt, z - .021)
            br = lib.rbox((.022, SHELF_DEPTH * .8, .022), .005, 1, loc=(0, -SHELF_DEPTH * .4, -.011))
            br.merge(lib.rbox((.022, .022, .16), .005, 1, loc=(0, -.011, -.08)))
            br.merge(lib.tube([(0, -.02, -.15), (0, -SHELF_DEPTH * .62, -.02)], .007, n=8))
            brackets.append(br.transform(matrix=Mb))
        surfaces.append((x0, x1, z + .021, tb, ta))
    out.append(boards[0].merge(*boards[1:]).uv_box(2).obj("DRESS_SHELF_BOARDS", "MARBLE_Floor", col))
    out.append(brackets[0].merge(*brackets[1:]).obj("DRESS_SHELF_BRACKETS", "BRASS_Restrained", col))
    return out, surfaces

def build(col):
    objs = []
    cases, gallery_lights = display_cases(col); objs += cases
    counter, spots = gallery_counter(col); objs += counter
    wall_objs, shelves = lower_wall(col); objs += wall_objs
    return objs, gallery_lights, spots, shelves
