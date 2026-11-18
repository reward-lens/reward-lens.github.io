"""Pocket-lab furniture: service trolley, lab stool, articulated desk lamp and
wall sconce, modelled procedurally with lib.py builders.

Every item is built in a local frame (origin on the floor or mounting point,
the item's front facing -Y), its parts are grouped by material, and each
material group is finished into ONE object named f"{name}_{Tag}".
"""
import math

import bmesh
from mathutils import Matrix, Vector

import lib

TAU = math.tau

# The inside of the lamp shades: warm white enamel, so the lit interior reads
# against the charcoal shell. Added from this module as API.md allows.
lib.SPECS.setdefault("ENAMEL_Shade_Inner", dict(color="#EDE5D3", rough=.40))

TAGS = {
    "STEEL_Polished": "Steel", "ALUMINIUM_Brushed": "Trays", "BRASS_Restrained": "Brass",
    "RUBBER_Black": "Rubber", "TEAL_Upholstery": "Cushion", "CHARCOAL_Instrument": "Charcoal",
    "ENAMEL_Shade_Inner": "ShadeInner", "APRICOT_Task_Light": "Bulb",
}


# ------------------------------------------------------------------ helpers

class Parts:
    """Geos grouped by material, finished into one object per material."""

    def __init__(self):
        self.groups = {}

    def add(self, material, *geos):
        for g in geos:
            if material in self.groups: self.groups[material].merge(g)
            else: self.groups[material] = g
        return self

    def build(self, name, col, loc=(0, 0, 0), yaw=0.0, scale=1.0):
        objs = []
        for m, g in self.groups.items():
            g.transform(loc=loc, rot=(0, 0, yaw), scale=scale)
            objs.append(g.obj(f"{name}_{TAGS.get(m, m)}", m, col))
        self.groups = {}
        return objs


def place(geo, p0, axis):
    """Move a geo built about +Z at the origin so +Z runs along `axis` from p0."""
    q = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized())
    return geo.transform(matrix=Matrix.Translation(Vector(p0)) @ q.to_matrix().to_4x4())


def rod(p0, p1, r, n=10, cap=True):
    return lib.tube([Vector(p0), Vector(p1)], r, n=n, cap=cap)


def dome(r, h, seg=8):
    """A domed fastener head / cap standing on z=0."""
    return lib.lathe([(0, 0), (r, 0), (r, h * .4), (r * .7, h * .85), (0, h)], seg)


def ring(r_in, r_out, z0, z1, ch=0.0, seg=16):
    """An open-bore collar (inner face omitted: it is always hidden on a tube)."""
    c = min(ch, (z1 - z0) * .4, (r_out - r_in) * .8)
    prof = [(r_in, z0), (r_out - c, z0), (r_out, z0 + c), (r_out, z1 - c), (r_out - c, z1), (r_in, z1)]
    return lib.lathe(prof, seg)


def hull(points):
    """Convex hull of 2D points, counter-clockwise."""
    P = sorted(set((round(x, 7), round(y, 7)) for x, y in points))
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in P:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(P):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def xz_plate(outline_xz, y0, y1, bevel=0.0, bevel_segments=1):
    """Extrude a CCW outline drawn in the XZ plane across Y from y0 to y1."""
    return lib.prism(outline_xz, -y1, -y0, bevel, bevel_segments).transform(rot=(math.pi / 2, 0, 0))


def orient_radial(geo, outward=True):
    """Flip an open lathe surface (built about +Z) so its normals face away from
    (outward) or toward the axis. Single-sided runtime materials need this."""
    bm = geo.bm; bm.normal_update(); s = 0.0
    for f in bm.faces:
        c = f.calc_center_median()
        s += (f.normal.x * c.x + f.normal.y * c.y) * f.calc_area()
    if (s < 0) == outward:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces)); bm.normal_update()
    return geo


def to_world(p, origin, yaw, scale=1.0):
    c, s = math.cos(yaw), math.sin(yaw); x, y, z = (Vector(p) * scale)
    return Vector((origin[0] + c * x - s * y, origin[1] + s * x + c * y, origin[2] + z))


def dir_world(d, yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    return Vector((c * d[0] - s * d[1], s * d[0] + c * d[1], d[2])).normalized()


# ------------------------------------------------------------------ trolley

def _tray(tl, tw, rc, s, rim_h, t, rb, corner_seg=5):
    """A stainless sheet tray: flat floor (top surface at z=s), straight walls
    and an outward rolled bead rim, all following a rounded rectangle."""
    base = lib.rrect(tl, tw, rc, corner_seg)
    wo, wi = -rb, -rb - t
    zc = s + rim_h - rb
    prof = [(-.026, s - t), (wo - .006, s - t), (wo - .0015, s - t + .0015), (wo, s - t + .006)]
    a0, a1 = -math.pi / 2, math.pi + math.acos(t / rb)          # the bead curls under to the inner wall
    for i in range(11):
        a = a0 + (a1 - a0) * i / 10
        prof.append((-rb + rb * math.cos(a), zc + rb * math.sin(a)))
    prof += [(wi, s + .007), (wi - .002, s + .0015), (wi - .007, s), (-.026, s)]
    secs = [[(x, y, z) for x, y in lib.offset_polygon(base, d)] for d, z in prof]
    return lib.loft(secs, closed_sections=True, cap=True)


def _swivel_castor(P, at, trail_dir, R_w=.048, w_w=.022):
    """A brass swivel plate castor with a rubber wheel on a brass hub. `at` is the
    swivel axis on the floor (local), `trail_dir` the angle the wheel trails in.
    Returns the z of the top-plate surface (where the post stands)."""
    gap, pl_t, trail = .004, .004, .028
    z_crown0 = 2 * R_w + .007; crown_t = .006
    z_bear0 = z_crown0 + crown_t; bear_h = .014
    z_plate0 = z_bear0 + bear_h; plate_t = .006
    brass, steel, rubber = [], [], []
    # top plate with four domed bolt heads
    brass.append(lib.rbox((.058, .058, plate_t), bevel=.0022, segments=1, loc=(0, 0, z_plate0 + plate_t / 2)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            steel.append(dome(.0042, .0032, 6).transform(loc=(sx * .02, sy * .02, z_plate0 + plate_t)))
    # swivel bearing: two raceways with a ball-race bulge
    zb = z_bear0
    brass.append(lib.lathe([(0, zb), (.0195, zb), (.0232, zb + .002), (.0245, zb + .0055), (.0215, zb + .007),
                            (.0245, zb + .0085), (.0232, zb + .012), (.0195, zb + bear_h), (0, zb + bear_h)], 16))
    # fork: crown plate and two side legs tapering to the axle
    fy = w_w / 2 + gap
    brass.append(lib.rbox((.052, 2 * (fy + pl_t), crown_t), bevel=.0022, segments=1, loc=(trail * .25, 0, z_crown0 + crown_t / 2)))
    leg = hull([(-.017, z_crown0 - .012), (.022, z_crown0 - .012), (-.017, z_crown0 + .001), (.022, z_crown0 + .001)]
               + [(trail + .0125 * math.cos(a), R_w + .0125 * math.sin(a)) for a in [TAU * i / 14 for i in range(14)]])
    for sgn in (-1, 1):
        y0, y1 = (fy, fy + pl_t) if sgn > 0 else (-fy - pl_t, -fy)
        brass.append(xz_plate(leg, y0, y1, bevel=.0013, bevel_segments=1))
    # axle with domed nuts
    ya = fy + pl_t
    steel.append(rod((trail, -ya - .001, R_w), (trail, ya + .001, R_w), .0042, n=8))
    for sgn in (-1, 1):
        steel.append(place(dome(.0068, .0042, 8), (trail, sgn * (ya + .0008), R_w), (0, sgn, 0)))
    # wheel: rubber tyre seated on a dished brass hub
    hw = w_w / 2
    tyre = lib.lathe([(.030, -hw + .0015), (.040, -hw), (.045, -hw + .0015), (.0475, -hw + .0055), (R_w, -.0015),
                      (R_w, .0015), (.0475, hw - .0055), (.045, hw - .0015), (.040, hw), (.030, hw - .0015)],
                     24, closed_profile=True)
    rubber.append(place(tyre, (trail, 0, R_w), (0, 1, 0)))
    hub = lib.lathe([(0, -.0135), (.0115, -.0135), (.0135, -.0115), (.0255, -.0098), (.0305, -.0085),
                     (.0305, .0085), (.0255, .0098), (.0135, .0115), (.0115, .0135), (0, .0135)], 16)
    brass.append(place(hub, (trail, 0, R_w), (0, 1, 0)))
    for mat, geos in (("BRASS_Restrained", brass), ("STEEL_Polished", steel), ("RUBBER_Black", rubber)):
        for g in geos:
            g.transform(loc=(at[0], at[1], 0), rot=(0, 0, trail_dir))
            P.add(mat, g)
    return z_plate0 + plate_t


def trolley(name, center_xy, floor_z, yaw, col, size=(0.95, 0.52), height=1.0, handle_ends=(-1,)):
    """A two-tier stainless service trolley.

    size: (length along local X, width along local Y); everything, castors and
    handle included, stays inside it, rotated by `yaw` about the centre.
    height: floor to the top of the upper tray's rim; the push handle rises
    about 0.12 above the upper tray at each end in `handle_ends` (-1: local -X, +1: +X).
    Returns dict(objects, top_z, shelf_z): the two tray surfaces props sit on.
    """
    L, W = size
    P = Parts()
    margin, rc, r_post = .006, .034, .016
    tl, tw = L - 2 * margin, W - 2 * margin
    px, py = tl / 2 - rc, tw / 2 - rc                      # posts stand in the trays' corner-arc centres
    rim_h, t_sheet, rb = .03, .006, .008
    s_top = height - rim_h
    s_shelf = max(.24, .27 * height)

    # castors: wheels trail inward along the length, each swivelled a little differently
    jitter = {(-1, -1): .22, (-1, 1): -.30, (1, -1): .12, (1, 1): -.18}
    zb = 0.0
    for sx in (-1, 1):
        for sy in (-1, 1):
            zb = _swivel_castor(P, (sx * px, sy * py), (0.0 if sx < 0 else math.pi) + jitter[(sx, sy)])

    steel, alu, rubber = [], [], []
    # trays with under-floor stiffening channels
    for s in (s_top, s_shelf):
        alu.append(_tray(tl, tw, rc, s, rim_h, t_sheet, rb))
        for sx in (-1, 1):
            alu.append(lib.rbox((.03, tw - 2 * rc - .05, .011), bevel=.003, segments=1, loc=(sx * tl * .27, 0, s - t_sheet - .0055)))
        for sx in (-1, 1):
            for sy in (-1, 1):
                steel.append(ring(r_post - .0005, .0215, s - t_sheet - .016, s - t_sheet, ch=.003, seg=12).transform(loc=(sx * px, sy * py, 0)))
    # posts: handle ends are one continuous bent tube, the others end in domed caps
    z_h, rbend = s_top + .125, .05
    for sx in (-1, 1):
        x = sx * px
        if sx in handle_ends:
            path = [Vector((x, -py, zb)), Vector((x, -py, z_h - rbend))]
            path += [Vector((x, -py + rbend + rbend * math.cos(a), z_h - rbend + rbend * math.sin(a)))
                     for a in [math.pi - (math.pi / 2) * i / 8 for i in range(1, 9)]]
            path += [Vector((x, py - rbend + rbend * math.cos(a), z_h - rbend + rbend * math.sin(a)))
                     for a in [(math.pi / 2) - (math.pi / 2) * i / 8 for i in range(0, 9)]]
            path.append(Vector((x, py, zb)))
            steel.append(lib.tube(path, r_post, n=14))
        else:
            z_end = s_top + rim_h + .014
            for sy in (-1, 1):
                steel.append(rod((x, sy * py, zb), (x, sy * py, z_end), r_post, n=14, cap=False))
                steel.append(dome(.0178, .013, 14).transform(loc=(x, sy * py, z_end - .002)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * px, sy * py
            steel.append(ring(r_post - .0005, .0195, zb, zb + .012, ch=.003, seg=14).transform(loc=(x, y, 0)))
            z0 = zb + .03
            rubber.append(lib.lathe([(r_post - .0005, z0), (.024, z0), (.0285, z0 + .004), (.0298, z0 + .013),
                                     (.0285, z0 + .022), (.024, z0 + .026), (r_post - .0005, z0 + .026)], 16).transform(loc=(x, y, 0)))
    P.add("STEEL_Polished", *steel).add("ALUMINIUM_Brushed", *alu).add("RUBBER_Black", *rubber)
    objs = P.build(name, col, loc=(center_xy[0], center_xy[1], floor_z), yaw=yaw)
    return dict(objects=objs, top_z=floor_z + s_top, shelf_z=floor_z + s_shelf)


# --------------------------------------------------------------------- stool

def _twin_castor(P, at, z_top_ref, trail_dir, k):
    """A twin-wheel office castor: two rubber wheels either side of a charcoal
    body with an arched hood, a swivel disc and a short chrome stem. Returns the
    z where the arm-tip boss starts."""
    rw, ww, gap, trail = .030 * k, .0155 * k, .009 * k, .021 * k
    hw = ww / 2
    charcoal, rubber, steel = [], [], []
    wheel = [(0, -hw * .75), (rw * .5, -hw), (rw - .0035 * k, -hw), (rw, -hw + .004 * k),
             (rw, hw - .004 * k), (rw - .0035 * k, hw), (rw * .5, hw), (0, hw * .75)]
    for sgn in (-1, 1):
        rubber.append(place(lib.lathe(wheel, 12), (trail, sgn * (gap / 2 + hw + .0008 * k), rw), (0, 1, 0)))
    z_body = 2 * rw + .006 * k
    body = hull([(-.012 * k, z_body - .016 * k), (.012 * k, z_body - .016 * k), (-.012 * k, z_body), (.012 * k, z_body)]
                + [(trail + rw * .5 * math.cos(a), rw + rw * .5 * math.sin(a)) for a in [TAU * i / 10 for i in range(10)]])
    charcoal.append(xz_plate(body, -gap / 2, gap / 2, bevel=.0015 * k))
    rh = rw + .0048 * k
    arc_pts = [Vector((trail + rh * math.cos(a), 0, rw + rh * math.sin(a))) for a in [math.radians(28 + (172 - 28) * i / 6) for i in range(7)]]
    hood_w = 2 * ww + gap + .006 * k
    charcoal.append(lib.sweep(arc_pts, lib.rrect(hood_w, .0034 * k, .0016 * k, 2)))
    charcoal.append(lib.lathe([(0, z_body), (.0125 * k, z_body), (.0132 * k, z_body + .0025 * k), (.0125 * k, z_body + .005 * k), (0, z_body + .005 * k)], 12))
    z_stem0 = z_body + .005 * k
    steel.append(lib.lathe([(.0055 * k, z_stem0 - .001), (.0055 * k, z_stem0 + .004 * k)], 8))
    for mat, geos in (("CHARCOAL_Instrument", charcoal), ("RUBBER_Black", rubber), ("STEEL_Polished", steel)):
        for g in geos:
            g.transform(loc=(at[0], at[1], 0), rot=(0, 0, trail_dir))
            P.add(mat, g)
    return z_stem0 + .003 * k


def stool(name, center_xy, floor_z, seat_top_z, radius, col, foot_ring=None, yaw=0.0):
    """A height-adjustable lab stool: upholstered cushion with a piping welt on a
    charcoal seat pan and control housing, chrome gas-lift column with a brass
    collar, optional chrome foot ring, five-star polished base, twin-wheel castors.
    Seat crown at seat_top_z; castor wheels touch floor_z. foot_ring=None adds one
    when the seat is 0.85 or more above the floor. Returns the list of objects."""
    R = radius; k = R / .32; H = seat_top_z - floor_z
    if foot_ring is None: foot_ring = H >= .85
    P = Parts()
    steel, charcoal, brass, teal = [], [], [], []

    # base: castors, arm-tip bosses, tapered arms, hub
    Rb = .93 * R
    arm_angles = [math.radians(90 + 72 * i) for i in range(5)]
    swivel = [.35, -.55, .2, -.25, .6]
    z_boss0 = 0.0
    for i, a in enumerate(arm_angles):
        tip = (Rb * math.cos(a), Rb * math.sin(a))
        z_boss0 = _twin_castor(P, tip, 0, a + swivel[i], k)
    boss_h = .03 * k
    z_tip = z_boss0 + .016 * k
    z_root = z_tip + .05 * k
    for a in arm_angles:
        c, s = math.cos(a), math.sin(a)
        steel.append(lib.lathe([(0, z_boss0), (.0135 * k, z_boss0), (.0158 * k, z_boss0 + .003 * k), (.016 * k, z_boss0 + boss_h - .008 * k),
                                (.0145 * k, z_boss0 + boss_h - .0025 * k), (.009 * k, z_boss0 + boss_h - .0003 * k), (0, z_boss0 + boss_h)], 12).transform(loc=(Rb * c, Rb * s, 0)))
        path = []
        for j in range(8):
            t = j / 7
            r = .02 * k + (Rb - .02 * k) * t
            path.append(Vector((r * c, r * s, z_tip + (z_root - z_tip) * (1 - t) ** 1.6)))
        scales = [1.0 - .42 * (j / 7) for j in range(8)]
        steel.append(lib.sweep(path, lib.rrect(.046 * k, .03 * k, .011 * k, 2), scales=scales))
    zh0 = z_root - .026 * k
    hub_top = zh0 + .066 * k
    steel.append(lib.lathe([(0, zh0), (.046 * k, zh0), (.0515 * k, zh0 + .005 * k), (.053 * k, zh0 + .03 * k),
                            (.048 * k, zh0 + .046 * k), (.040 * k, zh0 + .058 * k), (.037 * k, hub_top), (0, hub_top)], 24))

    # seat stack, top down
    ct = .36 * R
    cb = H - ct
    pan_t = .014 * k
    house_h = .032 * k
    z_house0 = cb - pan_t - house_h
    collar_h = .056 * k
    z_col0 = z_house0 - collar_h
    z_ring = .42 * H
    z_split = max(z_ring + .07 * k, .46 * H) if foot_ring else .5 * (hub_top + z_col0)
    r_low, r_up = .032 * k, .023 * k
    # gas lift: lower sleeve with a rolled lip, wiper seal, slim piston rod
    steel.append(lib.lathe([(r_low - .003 * k, hub_top - .01 * k), (r_low, hub_top - .01 * k), (r_low, z_split - .004 * k),
                            (r_low - .002 * k, z_split), (r_up + .002 * k, z_split)], 24))
    charcoal.append(ring(r_up - .0005, r_up + .0045 * k, z_split - .001, z_split + .006 * k, ch=.0015 * k, seg=20))
    steel.append(lib.lathe([(r_up, z_split), (r_up, z_col0 + .002)], 20))
    # brass collar with two machined grooves
    c0, c1 = z_col0, z_house0 + .002
    rc_ = .039 * k
    gz = [c0 + (c1 - c0) * f for f in (.38, .62)]
    prof = [(r_up - .0005, c0), (rc_ - .003 * k, c0), (rc_, c0 + .003 * k)]
    for g in gz:
        prof += [(rc_, g - .0022 * k), (rc_ - .0018 * k, g), (rc_, g + .0022 * k)]
    prof += [(rc_, c1 - .003 * k), (rc_ - .006 * k, c1), (.012 * k, c1)]
    brass.append(lib.lathe(prof, 24))
    # control housing, lever with a paddle, seat pan
    charcoal.append(lib.rbox((.17 * k, .15 * k, house_h), bevel=.007 * k, segments=2, loc=(0, 0, z_house0 + house_h / 2)))
    lz = z_house0 + house_h * .45
    lever = [Vector((.07 * k, .03 * k, lz)), Vector((.13 * k, .055 * k, lz - .004 * k)), Vector((.185 * k, .07 * k, lz - .018 * k))]
    steel.append(lib.tube(lib.catmull(lever, per=4), .0045 * k, n=8))
    charcoal.append(lib.rbox((.042 * k, .024 * k, .011 * k), bevel=.005 * k, segments=2, loc=(.195 * k, .073 * k, lz - .022 * k), rot=(0, -.35, .35)))
    Rp = R - .02 * k
    charcoal.append(lib.lathe([(0, cb - pan_t), (Rp - .022 * k, cb - pan_t), (Rp - .006 * k, cb - pan_t * .7),
                               (Rp, cb - pan_t * .3), (Rp - .002 * k, cb), (0, cb)], 40))
    # cushion: bellied side band, pinched top seam carrying a piping welt, domed top
    seam = H - .028 * k
    teal.append(lib.lathe([(0, cb), (R - .035 * k, cb), (R - .014 * k, cb + .003 * k), (R - .004 * k, cb + .013 * k),
                           (R - .0005 * k, cb + .03 * k), (R, cb + .055 * k), (R - .0012 * k, seam - .007 * k),
                           (R - .0045 * k, seam), (R - .003 * k, seam + .005 * k), (R - .009 * k, H - .013 * k),
                           (R - .02 * k, H - .0055 * k), (R - .04 * k, H - .002 * k), (R - .07 * k, H - .0006 * k),
                           (0, H)], 40))
    teal.append(lib.tube([Vector((math.cos(a) * (R - .0035 * k), math.sin(a) * (R - .0035 * k), seam)) for a in [TAU * i / 40 for i in range(40)]],
                         .0055 * k, n=6, cap=False, closed_path=True))
    # foot ring on three spokes from a clamp collar
    if foot_ring:
        Rf = .64 * R
        steel.append(lib.tube([Vector((math.cos(a) * Rf, math.sin(a) * Rf, z_ring)) for a in [TAU * i / 36 for i in range(36)]],
                              .0105 * k, n=8, cap=False, closed_path=True))
        steel.append(ring(r_low - .0005, .043 * k, z_ring - .018 * k, z_ring + .018 * k, ch=.005 * k, seg=20))
        for i in range(3):
            a = math.radians(54 + 120 * i)
            c, s = math.cos(a), math.sin(a)
            steel.append(rod((c * .04 * k, s * .04 * k, z_ring), (c * (Rf - .006 * k), s * (Rf - .006 * k), z_ring), .0065 * k, n=8))
    P.add("STEEL_Polished", *steel).add("CHARCOAL_Instrument", *charcoal).add("BRASS_Restrained", *brass).add("TEAL_Upholstery", *teal)
    return P.build(name, col, loc=(center_xy[0], center_xy[1], floor_z), yaw=yaw)


# --------------------------------------------------------------- lamp parts

SHADE_OUT = [(0, -.006), (.010, -.0055), (.017, -.003), (.0215, .002), (.0235, .010), (.024, .030), (.027, .040),
             (.034, .053), (.044, .072), (.053, .092), (.059, .108), (.0625, .119), (.064, .125)]
SHADE_IN = [(.0615, .125), (.0595, .118), (.056, .107), (.050, .091), (.041, .072), (.031, .054), (.0225, .040),
            (.0205, .033), (0, .032)]
SHADE_LIP = .1255


def _shade(P, B, d, s=1.0, seg=28, bead_n=6):
    """A bell shade, back at B, opening along unit d: charcoal shell, enamel
    liner, brass neck collar and lip bead, an emissive bulb disc. Returns the
    opening centre."""
    def S(prof): return [(r * s, z * s) for r, z in prof]
    out = orient_radial(lib.lathe(S(SHADE_OUT), seg), outward=True)
    liner = orient_radial(lib.lathe(S(SHADE_IN), seg), outward=False)
    rb = .0029 * s
    bead = lib.lathe([(.0632 * s + rb * math.cos(a), SHADE_LIP * s + rb * math.sin(a)) for a in [TAU * i / bead_n for i in range(bead_n)]],
                     seg, closed_profile=True)
    collar = lib.lathe(S([(.0238, .013), (.0262, .013), (.0272, .0155), (.0272, .0305), (.0262, .033), (.0238, .033)]), seg)
    bulb = lib.lathe(S([(0, .096), (.040, .096), (.0435, .0985), (.041, .1015), (.030, .1045), (0, .1058)]), seg)
    for mat, g in (("CHARCOAL_Instrument", out), ("ENAMEL_Shade_Inner", liner), ("BRASS_Restrained", bead),
                   ("BRASS_Restrained", collar), ("APRICOT_Task_Light", bulb)):
        P.add(mat, place(g, B, d))
    return Vector(B) + Vector(d) * SHADE_LIP * s


def _knuckle(P, c, r, length, knob=False, seg=14):
    """A hinge barrel along X at c with domed pin nuts; knob adds a charcoal
    tension knob on the +X side."""
    h = length / 2; e = min(.002, r * .2)
    barrel = lib.lathe([(0, -h), (r - e, -h), (r, -h + e), (r, h - e), (r - e, h), (0, h)], seg)
    P.add("BRASS_Restrained", place(barrel, c, (1, 0, 0)))
    for sgn in (-1, 1):
        if knob and sgn > 0:
            kb = lib.lathe([(0, 0), (r * 1.05, 0), (r * 1.15, r * .25), (r * 1.15, r * .75), (r * 1.0, r * .95), (0, r)], seg)
            P.add("CHARCOAL_Instrument", place(kb, Vector(c) + Vector((h - .0005, 0, 0)), (1, 0, 0)))
        else:
            P.add("BRASS_Restrained", place(dome(r * .55, r * .3, 10), Vector(c) + Vector((sgn * (h - .0005), 0, 0)), (sgn, 0, 0)))


def desk_lamp(name, base_xyz, yaw, col, scale=1.0, tilt_deg=40.0):
    """An articulated brass desk lamp, ~0.55 tall at scale 1: weighted round base
    with a switch, lower arm with a tension spring, upper arm, three hinge
    knuckles, and a charcoal bell shade aimed along local -Y, tilt_deg below the
    horizontal. Returns dict(objects, aperture, direction): the world centre of
    the shade opening and the unit aim (for the runtime's spot light)."""
    P = Parts()
    K0, K1, K2 = Vector((0, 0, .062)), Vector((0, .07, .38)), Vector((0, -.10, .52))
    # base and turret in one turned piece, a charcoal switch at the front
    P.add("BRASS_Restrained", lib.lathe([(0, 0), (.0725, 0), (.0762, .0025), (.0775, .009), (.0762, .0155), (.0728, .0185),
                                         (.060, .0208), (.043, .0228), (.033, .027), (.026, .032), (.0165, .035),
                                         (.0112, .038), (.0095, .042), (.0095, K0.z - .008), (0, K0.z - .008)], 26))
    P.add("CHARCOAL_Instrument", lib.cyl(.0068, .0062, bevel=.002, segments=12, z0=.0195).transform(loc=(0, -.052, 0)))
    # arms, knuckles
    P.add("BRASS_Restrained", rod(K0, K1, .0062, n=10), rod(K1, K2, .0055, n=10))
    _knuckle(P, K0, .0105, .026)
    _knuckle(P, K1, .0098, .024, knob=True)
    _knuckle(P, K2, .009, .022)
    # tension spring beside the lower arm, hooked to two brass tabs
    ax = (K1 - K0).normalized(); e2 = Vector((0, -ax.z, ax.y)); xo = .0135
    t0, t1, turns, per = .12, .52, 15, 6
    helix = []
    for i in range(turns * per + 1):
        f = i / (turns * per); th = TAU * turns * f
        p = K0.lerp(K1, t0 + (t1 - t0) * f) + Vector((xo, 0, 0))
        helix.append(p + Vector((1, 0, 0)) * (.0038 * math.cos(th)) + e2 * (.0038 * math.sin(th)))
    P.add("STEEL_Polished", lib.tube(helix, .0012, n=4))
    for t in (t0 - .015, t1 + .015):
        p = K0.lerp(K1, t)
        P.add("BRASS_Restrained", rod(p, p + Vector((xo + .002, 0, 0)), .0026, n=8))
    # shade hanging off the head knuckle
    a = math.radians(tilt_deg)
    d = Vector((0, -math.cos(a), -math.sin(a)))
    B = K2 + d * .025                               # the shade swivels on a short stem along its axis
    P.add("BRASS_Restrained", rod(K2, B + d * .008, .0045, n=8))
    ap = _shade(P, B, d, 1.0, seg=28)
    objs = P.build(name, col, loc=base_xyz, yaw=yaw, scale=scale)
    return dict(objects=objs, aperture=tuple(to_world(ap, base_xyz, yaw, scale)), direction=tuple(dir_world(d, yaw)))


def wall_sconce(name, wall_xyz, outward_normal_xy, col, tilt_deg=70.0):
    """A small brass wall light: round back rose with two screws, a short swan-neck
    arm, a hinge knuckle and a charcoal shade pointing down and slightly out
    (tilt_deg below horizontal). wall_xyz is the mounting point ON the wall
    surface. Returns dict(objects, aperture, direction) like desk_lamp."""
    nx, ny = outward_normal_xy
    yaw = math.atan2(nx, -ny)                       # local -Y becomes the outward normal
    P = Parts()
    rose = lib.lathe([(0, 0), (.037, 0), (.039, .0035), (.036, .0085), (.026, .0115), (.012, .0125), (0, .0128)], 16)
    P.add("BRASS_Restrained", place(rose, (0, 0, 0), (0, -1, 0)))
    for sx in (-1, 1):
        P.add("STEEL_Polished", place(dome(.0032, .0022, 6), (sx * .027, -.0106, 0), (0, -1, 0)))
    arm = lib.catmull([Vector((0, -.008, 0)), Vector((0, -.05, 0)), Vector((0, -.09, .01)), Vector((0, -.105, .04))], per=4)
    P.add("BRASS_Restrained", lib.tube(arm, .0052, n=8))
    K = Vector((0, -.105, .045))
    _knuckle(P, K, .0078, .019, seg=10)
    a = math.radians(tilt_deg)
    d = Vector((0, -math.cos(a), -math.sin(a)))
    s = .78
    B = K + d * .02
    P.add("BRASS_Restrained", rod(K, B + d * .008, .0038, n=6))
    ap = _shade(P, B, d, s, seg=16, bead_n=4)
    objs = P.build(name, col, loc=wall_xyz, yaw=yaw)
    return dict(objects=objs, aperture=tuple(to_world(ap, wall_xyz, yaw)), direction=tuple(dir_world(d, yaw)))
