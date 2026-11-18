"""Architecture: plinth, curved shell wall, gallery, railings, stair, soffit lights.

Every mesh is in world coordinates. Large receivers (plinth top, wall face,
gallery) carry dense, even topology so the per-vertex AO bake can show soft
contact shadows. Semantic anchors are created by build_room.py, not here.
"""
import math
from mathutils import Vector
import bmesh
import lib
import layout as L

# ------------------------------------------------------------------ helpers

def _ccw(poly):
    a = sum(poly[i - 1][0] * poly[i][1] - poly[i][0] * poly[i - 1][1] for i in range(len(poly)))
    return poly if a > 0 else poly[::-1]

def _face_down(g):
    """Make an open strip's faces point down (for soffits)."""
    g.bm.normal_update()
    if sum(f.normal.z * f.calc_area() for f in g.bm.faces) > 0:
        bmesh.ops.reverse_faces(g.bm, faces=g.bm.faces)
    return g

def _ell(rx, ry, z, n):
    cx, cy = L.PLINTH_C
    return [(cx + rx * math.cos(math.tau * i / n), cy + ry * math.sin(math.tau * i / n), z) for i in range(n)]

# ------------------------------------------------------------------- plinth

def plinth(col):
    """Elliptical marble block: dense concentric top rings, a quarter-round
    arris, a straight side and a small chamfer at the foot."""
    rx, ry = L.PLINTH_R; n = 224; arr = .12; top = L.FLOOR
    secs = []
    K = 30
    for k in range(K + 1):
        s = .015 + .985 * k / K
        secs.append(_ell((rx - arr) * s, (ry - arr) * s, top, n))
    for i in range(1, 6):
        a = math.pi / 2 * i / 5
        secs.append(_ell(rx - arr + arr * math.sin(a), ry - arr + arr * math.sin(a), top - arr * (1 - math.cos(a)), n))
    secs.append(_ell(rx, ry, .06, n))
    secs.append(_ell(rx - .05, ry - .05, 0.0, n))
    g = lib.loft(secs, closed_sections=True, cap=True)
    g.uv_box(4.0)
    return [g.obj("ARCH_PLINTH", "MARBLE_Floor", col)]

# --------------------------------------------------------------------- wall

def wall(col):
    """The curved shell: dense inner face, rounded top, plain outer face,
    plus a lighter cap trim along the crown and skirting at both floors."""
    n, rows = 168, 60
    t_right, t_left = L.WALL_T1, L.WALL_T0
    z0 = L.FLOOR - .03
    secs, crown = [], []
    for i in range(n + 1):
        t = t_right + (t_left - t_right) * i / n
        top = L.wall_top(t) - .05
        ix, iy = L.wall_inner(t); ox, oy = L.wall_inner(t, -L.WALL_THICK)
        ring = [(ix, iy, z0 + (top - z0) * r / rows) for r in range(rows + 1)]
        for k in range(1, 6):
            a = math.pi * k / 6; u = (1 - math.cos(a)) / 2
            ring.append((ix + (ox - ix) * u, iy + (oy - iy) * u, top + .04 * math.sin(a)))
        ring += [(ox, oy, z0 + (top - z0) * r / 10) for r in range(10, -1, -1)]
        secs.append(ring)
        crown.append(Vector(((ix + ox) / 2, (iy + oy) / 2, top + .035)))
    g = lib.loft(secs, closed_sections=True, cap=True)
    g.uv_box(3.0)
    out = [g.obj("ARCH_WALL", "PETROL_Painted", col)]
    cap = lib.sweep(crown, lib.rrect(L.WALL_THICK + .06, .075, .03, 3), up=(0, 0, 1))
    out.append(cap.obj("ARCH_WALL_CAP", "PETROL_Trim", col))
    # skirting: lower floor along the whole inner face, gallery floor along its span
    def skirt(t_a, t_b, z, name):
        path = [Vector((*L.wall_inner(t_a + (t_b - t_a) * i / 120, .012), z + .065)) for i in range(121)]
        return lib.sweep(path, lib.rrect(.026, .13, .006, 2)).obj(name, "CERAMIC_Pale", col)
    out.append(skirt(t_right, t_left, L.FLOOR, "ARCH_SKIRT_LOWER"))
    out.append(skirt(L.GALLERY_T_END, L.GALLERY_T_START, L.GALLERY_TOP, "ARCH_SKIRT_UPPER"))
    return out

# ------------------------------------------------------------------ gallery

def gallery(col):
    ts, back, front = L.gallery_samples(110)
    g = lib.slab([(x, y, 0) for x, y in back], [(x, y, 0) for x, y in front], L.GALLERY_TOP, L.GALLERY_T, rows=11, nose=.07, nose_segments=3)
    g.uv_box(4.0)
    out = [g.obj("ARCH_GALLERY", "MARBLE_Floor", col)]
    # a slim brushed band under the nose: the slab reads as a built floor
    band = []
    for b, f in zip(back, front):
        d = Vector((b[0] - f[0], b[1] - f[1], 0)).normalized()
        band.append(Vector((f[0], f[1], 0)) + d * .02 + Vector((0, 0, L.GALLERY_TOP - L.GALLERY_T + .01)))
    out.append(lib.sweep(band, lib.rrect(.05, .03, .008, 2)).obj("ARCH_GALLERY_BAND", "ALUMINIUM_Brushed", col))
    return out

def soffit_lights(col):
    """Recessed downlights under the gallery's front zone; returns objects and
    {name: (x, y, z)} anchors for the runtime's practical lights."""
    ring_g, disc_g, anchors = [], [], {}
    for i, x in enumerate((-2.60, -1.00, .60, 2.20)):
        t = math.acos(max(-1, min(1, x / L.GALLERY_FRONT_R[0])))
        fx, fy = L.gallery_front(t)
        y = fy + .34; z = L.GALLERY_TOP - L.GALLERY_T
        ring_g.append(lib.lathe([(.075, z - .012), (.09, z - .006), (.09, z + .002), (.06, z + .002), (.055, z - .01)], 32).transform(loc=(x, y, 0)))
        disc_g.append(lib.cyl(.056, .01, segments=32, z0=z - .016).transform(loc=(x, y, 0)))
        anchors[f"SOFFIT_LIGHT_{i + 1}"] = (x, y, z - .03)
    ring = ring_g[0].merge(*ring_g[1:]); disc = disc_g[0].merge(*disc_g[1:])
    return [ring.obj("ARCH_SOFFIT_RINGS", "STEEL_Polished", col), disc.obj("ARCH_SOFFIT_LAMPS", "APRICOT_Task_Light", col)], anchors

# -------------------------------------------------------------------- stair

class Stair:
    def __init__(self):
        self.pts, self.Ls = L.stair_line(240)
        self.N = L.STAIR_RISERS; self.R = L.STAIR_RISE; self.W = L.STAIR_W
        self.g = self.Ls / (self.N - 1)

    def frame(self, s):
        p, d, n = L.stair_frame(min(max(s, 0), self.Ls), self.pts)
        if s < 0: p = (p[0] + d[0] * s, p[1] + d[1] * s)
        if s > self.Ls: p = (p[0] + d[0] * (s - self.Ls), p[1] + d[1] * (s - self.Ls))
        return p, d, n

    def edge(self, s, side, off=0.0, z=0.0):
        """Point on the stair's inner (side=+1) or wall (side=-1) edge, `off`
        metres further out (negative: in toward the walking line)."""
        p, d, n = self.frame(s); o = side * (self.W / 2 + off)
        return Vector((p[0] + n[0] * o, p[1] + n[1] * o, z))

    def nosing_z(self, s):
        return L.FLOOR + self.R * (1 + s / self.g)

    def tread_top(self, s):
        k = max(0, min(self.N - 2, int(s // self.g)))
        return L.FLOOR + (k + 1) * self.R

def stair(col):
    st = Stair(); out = []
    nose = .04; T = .055
    treads, risers = [], []
    for k in range(st.N - 1):
        s0, s1 = k * st.g, (k + 1) * st.g
        ztop = L.FLOOR + (k + 1) * st.R
        m = 5
        outer = [st.edge(s0 - nose + (s1 - s0 + nose) * i / m, -1) for i in range(m + 1)]
        inner = [st.edge(s0 - nose + (s1 - s0 + nose) * i / m, +1) for i in range(m + 1)]
        poly = _ccw([(p.x, p.y) for p in outer + inner[::-1]])
        treads.append(lib.prism(poly, ztop - T, ztop, bevel=.016, bevel_segments=2))
        rpoly = _ccw([(p.x, p.y) for p in (st.edge(s0, -1, -.005), st.edge(s0 + .035, -1, -.005), st.edge(s0 + .035, +1, -.005), st.edge(s0, +1, -.005))])
        risers.append(lib.prism(rpoly, L.FLOOR + k * st.R, ztop - T + .002))
    out.append(treads[0].merge(*treads[1:]).uv_box(2.0).obj("ARCH_STAIR_TREADS", "MARBLE_Floor", col))
    out.append(risers[0].merge(*risers[1:]).uv_box(2.0).obj("ARCH_STAIR_RISERS", "CERAMIC_Pale", col))
    # stringers: sloped curved bands that close each side; their top edge runs
    # parallel to the nosing line, rounded, and the inner one meets the floor.
    S = 110; s_a, s_b = -nose - .02, st.Ls
    soffit_rows = []
    for side, name, thick in ((+1, "ARCH_STAIR_STRINGER_INNER", .075), (-1, "ARCH_STAIR_STRINGER_WALL", .07)):
        secs = []
        for i in range(S + 1):
            s = s_a + (s_b - s_a) * i / S
            top = min(st.nosing_z(max(s, 0)) + .075, L.GALLERY_TOP + .02)
            if s < 0: top = L.FLOOR + st.R + .075
            bot = max(L.FLOOR, st.nosing_z(max(s, 0)) - .46)
            a = st.edge(s, side, -.004); b = st.edge(s, side, thick)
            mid = (a + b) / 2
            ring = [Vector((a.x, a.y, bot)), Vector((b.x, b.y, bot)), Vector((b.x, b.y, top - .03))]
            for j in range(1, 4):
                ang = math.pi * j / 4
                q = mid + (b - mid) * math.cos(ang)
                ring.append(Vector((q.x, q.y, top - .03 + .03 * math.sin(ang))))
            ring.append(Vector((a.x, a.y, top - .03)))
            secs.append(ring)
            if side == +1: soffit_rows.append((s, bot))
        out.append(lib.loft(secs, closed_sections=True, cap=True).uv_box(2.0).obj(name, "MARBLE_Floor" if side > 0 else "CERAMIC_Pale", col))
    secs = []
    for s, bot in soffit_rows:
        secs.append([st.edge(s, +1, -.004 - (st.W - .01) * j / 6, bot + .001) for j in range(7)])
    out.append(_face_down(lib.loft(secs, closed_sections=False, cap=False)).uv_box(2.0).obj("ARCH_STAIR_SOFFIT", "CERAMIC_Pale", col))
    return out, st

# ----------------------------------------------------------------- railings

def _posts(points, z_base, z_tops, steel, brass):
    for p, zb, zt in zip(points, z_base, z_tops):
        steel.append(lib.cyl(.021, zt - zb - .02, segments=14, z0=zb).transform(loc=(p.x, p.y, 0)))
        brass.append(lib.lathe([(0, zb), (.042, zb), (.044, zb + .012), (.036, zb + .05), (.024, zb + .062), (0, zb + .062)], 18).transform(loc=(p.x, p.y, 0)))
        brass.append(lib.lathe([(0, zt - .06), (.024, zt - .06), (.031, zt - .045), (.031, zt - .025), (0, zt - .025)], 16).transform(loc=(p.x, p.y, 0)))

def railings(col, st):
    """One continuous handrail: along the gallery front from the left end,
    round the landing corner and down the stair's inner edge; a second rail
    along the stair's wall side. Steel posts with brass collars."""
    steel, brass = [], []
    ts, back, front = L.gallery_samples(220)
    inset = .10
    gal = []
    for b, f in zip(back, front):
        d = Vector((b[0] - f[0], b[1] - f[1], 0)).normalized()
        gal.append(Vector((f[0], f[1], 0)) + d * inset)
    # left return along the gallery's end face to the wall
    b0, f0 = Vector((*back[0], 0)), Vector((*front[0], 0))
    across = (b0 - f0).normalized(); along = Vector((-across.y, across.x, 0))
    if along.x < 0: along = -along
    ret = [b0 - across * .08 + along * inset, f0 + across * (inset + .05) + along * inset]
    top = L.GALLERY_TOP + L.RAIL_H
    gal_path = lib.resample(ret + gal[1:], .04)
    # stair inner rail, top to bottom, joined to the gallery rail's end
    ss = [st.Ls - (st.Ls + .02) * i / 90 for i in range(91)]
    stair_in = [st.edge(s, +1, -.09, st.nosing_z(max(s, 0)) + L.RAIL_H) for s in ss]
    join = [Vector((p.x, p.y, top)) for p in gal_path] + stair_in
    path = lib.catmull(lib.resample(join, .08), per=3)
    steel.append(lib.tube(path, .028, n=16))
    # mid rail on the gallery run only
    steel.append(lib.tube([Vector((p.x, p.y, L.GALLERY_TOP + .47)) for p in gal_path], .011, n=10))
    # gallery posts, evenly spaced; skip where a gantry leg stands
    glen = lib.path_length(gal_path); count = max(2, round(glen / .62))
    pts = []
    for i in range(count + 1):
        p, _ = lib.point_at(gal_path, glen * i / count)
        if any(abs(p.x - gx) < .32 and abs(p.y - L.GANTRY_Y) < .45 for gx in L.GANTRY_X): continue
        pts.append(p)
    _posts(pts, [L.GALLERY_TOP] * len(pts), [top] * len(pts), steel, brass)
    # stair posts: inner edge on every tread, wall edge on every other tread
    for side, every in ((+1, 1), (-1, 2)):
        sp = [k * st.g + st.g * .55 for k in range(0, st.N - 1, every)]
        pp = [st.edge(s, side, -.09) for s in sp]
        _posts(pp, [st.tread_top(s) for s in sp], [st.nosing_z(s) + L.RAIL_H for s in sp], steel, brass)
    # wall-side rail with end returns
    ws = [-.02 + (st.Ls - .1) * i / 80 for i in range(81)]
    wall_rail = [st.edge(s, -1, -.09, st.nosing_z(max(s, 0)) + L.RAIL_H) for s in ws]
    steel.append(lib.tube(wall_rail, .026, n=14))
    # newel at the stair foot (both sides) and at the landing corner
    for p, zb, zt in ((st.edge(.12, +1, -.09), st.tread_top(.12), st.nosing_z(.12) + L.RAIL_H), (st.edge(.12, -1, -.09), st.tread_top(.12), st.nosing_z(.12) + L.RAIL_H)):
        steel.append(lib.cyl(.03, zt - zb, segments=16, z0=zb).transform(loc=(p.x, p.y, 0)))
    s_obj = steel[0].merge(*steel[1:]).obj("ARCH_RAIL_STEEL", "STEEL_Polished", col)
    b_obj = brass[0].merge(*brass[1:]).obj("ARCH_RAIL_BRASS", "BRASS_Restrained", col)
    return [s_obj, b_obj]

# ---------------------------------------------------------------------- all

def build(col):
    """Build all architecture into `col`; returns (objects, practical anchors, stair)."""
    objs = []
    objs += plinth(col)
    objs += wall(col)
    objs += gallery(col)
    lights, anchors = soffit_lights(col); objs += lights
    s_objs, st = stair(col); objs += s_objs
    objs += railings(col, st)
    return objs, anchors, st
