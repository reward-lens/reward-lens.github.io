"""The gantry portal on the gallery: a static brushed-aluminium frame.

Two legs stand on the gallery floor at x = GANTRY_X, rise into curved
corners of radius GANTRY_CORNER_R and meet a crossbeam centred at
GANTRY_BEAM_Z, all in the plane y = GANTRY_Y. The section is a rounded
rectangle (GANTRY_SECTION) with a shallow T-slot groove on the front and back
faces. A linear rail (dark mounting bar, polished steel guide) runs along the
crossbeam's front face; the rig's HEAD_CARRIAGE rides its guide face at
y = GANTRY_Y - depth/2 - 0.05. A cable tray on top carries the cables that
drop down the back of the right corner to a junction box on the right foot.

gantry_frame(col) builds everything in world coordinates and returns the
objects (all named GANTRY_FRAME_*).
"""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
import lib, layout

W, D = layout.GANTRY_SECTION            # width in the portal plane, depth along Y
R = layout.GANTRY_CORNER_R
ZB = layout.GANTRY_BEAM_Z
Y0 = layout.GANTRY_Y
XL = (layout.GANTRY_X[1] - layout.GANTRY_X[0]) / 2   # half span; built about x = 0
XC = (layout.GANTRY_X[1] + layout.GANTRY_X[0]) / 2   # then shifted so the legs land on GANTRY_X
CORNER = 0.03                            # section corner radius
FOOT_T = 0.035 + 0.028                   # base plate + flange plate
Z_LEG0 = layout.GALLERY_TOP + FOOT_T     # where the legs meet the flange
FRONT = Y0 - D / 2                       # crossbeam front face (y)
RAIL_X = XL - R - .09                    # rail half length (stops short of the corner joints)


def section_profile():
    """Rounded-rectangle section with a T-slot groove on both +-Y faces.
    Profile x lies in the portal plane (width W), profile y runs along +Y."""
    a, b, r, g, d = W / 2, D / 2, CORNER, .016, .012
    pts = []
    def corner(cx, cy, a0):
        for i in range(4):
            t = a0 + (math.pi / 2) * i / 3
            pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    corner(a - r, -b + r, -math.pi / 2)
    corner(a - r, b - r, 0)
    pts += [(g, b), (g, b - d), (-g, b - d), (-g, b)]
    corner(-a + r, b - r, math.pi / 2)
    corner(-a + r, -b + r, math.pi)
    pts += [(-g, -b), (-g, -b + d), (g, -b + d), (g, -b)]
    return pts


def arc_xz(cx, cz, r, a0, a1, n):
    return [Vector((cx + r * math.cos(a0 + (a1 - a0) * i / n), 0, cz + r * math.sin(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def centreline(n_arc=14):
    """Portal centreline from the left foot to the right foot (world)."""
    zc = ZB - R
    P = [Vector((-XL, 0, Z_LEG0)), Vector((-XL, 0, (Z_LEG0 + zc) / 2))]
    P += arc_xz(-XL + R, zc, R, math.pi, math.pi / 2, n_arc)
    P += [Vector((0, 0, ZB))]
    P += arc_xz(XL - R, zc, R, math.pi / 2, 0, n_arc)
    P += [Vector((XL, 0, (Z_LEG0 + zc) / 2)), Vector((XL, 0, Z_LEG0))]
    return [Vector((p.x, Y0, p.z)) for p in P]


def screw(r=.012, h=.008, axis=(0, 0, 1), at=(0, 0, 0), seg=10, socket=True):
    """A socket-head cap screw on a surface, its head along `axis`. Returns
    (head Geo, socket Geo or None)."""
    b = r * .3
    head = lib.lathe([(0, 0), (r, 0), (r, h - b), (r - b, h), (0, h)], seg)
    q = Vector((0, 0, 1)).rotation_difference(Vector(axis))
    M = Matrix.Translation(Vector(at)) @ q.to_matrix().to_4x4()
    head.transform(matrix=M)
    sock = None
    if socket:
        sock = lib.prism(lib.circle(r * .42, 6), h - .0005, h + .0006).transform(matrix=M)
    return head, sock


class Parts:
    """Collect Geos per material, then emit one object per material."""
    def __init__(self): self.g = {}
    def add(self, material, geo):
        if geo is None: return
        if material in self.g: self.g[material].merge(geo)
        else: self.g[material] = geo
    def screw(self, mat_head, **kw):
        h, s = screw(**kw); self.add(mat_head, h); self.add("CHARCOAL_Instrument", s)
    def emit(self, prefix, col):
        out = []
        for m, geo in self.g.items():
            out.append(geo.obj(f"{prefix}_{m.split('_')[0]}", m, col=col))
        return out


def gantry_frame(col):
    objs = []
    # ---------------------------------------------------------------- portal
    path = centreline()
    portal = lib.sweep(path, section_profile(), up=(0, 1, 0))
    objs.append(portal.obj("GANTRY_FRAME_PORTAL", "ALUMINIUM_Brushed", col=col))

    P = Parts()          # dark and metal fittings on the portal
    # joint bands where the corners meet the straights: a raised clamp band
    band_path = lib.rrect(W + .014, D + .014, CORNER + .007, 3)
    band_prof = lib.rrect(.012, .06, .004, 2)
    zc = ZB - R
    for sx in (-1, 1):
        # vertical leg joint (horizontal band)
        g = lib.sweep([(x + sx * XL, y + Y0, zc) for x, y in band_path], band_prof, closed_path=True, up=(0, 0, 1))
        P.add("ALUMINIUM_Brushed", g)
        # beam joint (band in the YZ plane): build flat then turn the section into YZ
        g = lib.sweep([(x, y, 0) for x, y in band_path], band_prof, closed_path=True, up=(0, 0, 1))
        g.transform(rot=(0, math.pi / 2, 0)).transform(loc=(sx * (XL - R), Y0, ZB))
        P.add("ALUMINIUM_Brushed", g)
        for zz in (-.09, .09):
            P.screw("STEEL_Polished", r=.011, h=.006, seg=8, axis=(0, -1, 0), at=(sx * XL + zz, FRONT - .007, zc))
            P.screw("STEEL_Polished", r=.011, h=.006, seg=8, axis=(0, -1, 0), at=(sx * (XL - R), FRONT - .007, ZB + zz))

    # ------------------------------------------------------------ foot plates
    for sx in (-1, 1):
        cx, cy = sx * XL, Y0 + .02
        base = lib.prism([(x + cx, y + cy) for x, y in lib.rrect(W + .22, D + .12, .06, 4)], layout.GALLERY_TOP, layout.GALLERY_TOP + .035, bevel=.008)
        P.add("CHARCOAL_Instrument", base)
        flange = lib.prism([(x + cx, y + Y0) for x, y in lib.rrect(W + .12, D + .08, .04, 4)], layout.GALLERY_TOP + .035, Z_LEG0, bevel=.006)
        P.add("ALUMINIUM_Brushed", flange)
        # brass collar hugging the leg base
        cpath = [(x + cx, y + Y0, Z_LEG0 + .045) for x, y in lib.rrect(W + .03, D + .03, CORNER + .015, 4)]
        P.add("BRASS_Restrained", lib.sweep(cpath, lib.rrect(.03, .09, .009, 2), closed_path=True, up=(0, 0, 1)))
        # anchor bolts in the base plate corners, smaller bolts in the flange
        for ox in (-.225, .225):
            for oy in (-.185, .185):
                P.screw("STEEL_Polished", r=.022, h=.016, at=(cx + ox, cy + oy, layout.GALLERY_TOP + .035), seg=10)
                P.add("STEEL_Polished", lib.cyl(.032, .004, segments=12, z0=layout.GALLERY_TOP + .035).transform(loc=(cx + ox, cy + oy, 0)))
        for ox in (-.18, .18):
            for oy in (-.17, .17):
                P.screw("STEEL_Polished", r=.013, h=.009, at=(cx + ox, Y0 + oy, Z_LEG0), seg=10)
        # name plate on the front of each leg
        P.add("BRASS_Restrained", lib.rbox((.15, .006, .055), .002, 1, loc=(cx, FRONT - .003, 5.05)))
        for ox in (-.06, .06):
            P.screw("STEEL_Polished", r=.006, h=.003, axis=(0, -1, 0), at=(cx + ox, FRONT - .006, 5.05), seg=8, socket=False)

    # ------------------------------------------------------------ linear rail
    # mounting bar on the beam's front face, y from FRONT-.03 to FRONT
    P.add("CHARCOAL_Instrument", lib.rbox((2 * RAIL_X, .03, .13), .006, 2, loc=(0, FRONT - .015, ZB)))
    # profiled guide rail: base flange, neck, head; front face at FRONT - .05
    y_base = FRONT - .03
    prof = [(0, -.024), (.006, -.024), (.006, -.018), (.010, -.018), (.010, -.022), (.017, -.022),
            (.020, -.019), (.020, .019), (.017, .022), (.010, .022), (.010, .018), (.006, .018), (.006, .024), (0, .024)]
    guide = lib.sweep([(-RAIL_X + .02, y_base, ZB), (RAIL_X - .02, y_base, ZB)], prof, up=(0, 0, 1))
    # sweep maps profile x to -Y for a +X path: check and mirror if needed
    if sum(v.co.y for v in guide.bm.verts) / max(1, len(guide.bm.verts)) > y_base:
        guide.transform(loc=(0, -y_base, 0)).transform(scale=(1, -1, 1)).transform(loc=(0, y_base, 0))
    P.add("STEEL_Polished", guide)
    # counterbored screws along the guide face, cap screws along the bar
    x = -RAIL_X + .08
    while x < RAIL_X - .05:
        P.add("CHARCOAL_Instrument", lib.cyl(.0065, .0012, segments=10, z0=0).transform(rot=(math.pi / 2, 0, 0)).transform(loc=(x, FRONT - .0498, ZB)))
        x += .12
    x = -RAIL_X + .15
    while x < RAIL_X - .1:
        for zz in (-.047, .047):
            P.screw("STEEL_Polished", r=.010, h=.006, axis=(0, -1, 0), at=(x, FRONT - .03, ZB + zz), seg=8)
        x += .30
    # end stops with rubber bumpers
    for sx in (-1, 1):
        P.add("CHARCOAL_Instrument", lib.rbox((.05, .065, .15), .008, 2, loc=(sx * (RAIL_X + .005), FRONT - .0325, ZB)))
        P.add("RUBBER_Black", lib.cyl(.018, .025, bevel=.006, segments=12).transform(rot=(0, -sx * math.pi / 2, 0)).transform(loc=(sx * (RAIL_X - .02), FRONT - .045, ZB)))
        P.screw("STEEL_Polished", r=.009, h=.005, axis=(0, -1, 0), at=(sx * (RAIL_X + .005), FRONT - .065, ZB + .05), seg=8)
        P.screw("STEEL_Polished", r=.009, h=.005, axis=(0, -1, 0), at=(sx * (RAIL_X + .005), FRONT - .065, ZB - .05), seg=8)

    # ------------------------------------------------------- cable tray, cable
    top = ZB + W / 2
    ty = Y0 + .09
    TX0, TX1 = -RAIL_X, XL - R + .01
    tray_prof = [(-.05, 0), (.05, 0), (.05, .05), (.045, .05), (.045, .006), (-.045, .006), (-.045, .05), (-.05, .05)]
    P.add("CHARCOAL_Instrument", lib.sweep([(TX0, ty, top), (TX1, ty, top)], tray_prof, up=(0, 0, 1)))
    for x in (TX0 - .003, TX1 + .003):   # end caps
        P.add("CHARCOAL_Instrument", lib.rbox((.006, .104, .054), .002, 1, loc=(x, ty, top + .027)))
    for x in (-1.8, -0.6, 0.6, 1.8):     # straps over the cables
        P.add("STEEL_Polished", lib.rbox((.03, .102, .008), .002, 1, loc=(x, ty, top + .05)))
    # two cables lie in the tray, leave its right end and run down the back
    # face of the right corner and leg to a junction box on the foot plate
    back = Y0 + D / 2
    for k, (r, dy, dr) in enumerate(((.016, -.02, -.05), (.011, .02, .05))):
        yb = back + .003 + r
        pts = [Vector((x, ty + dy, top + .006 + r)) for x in (-2.1, -1.0, 0.0, 1.0, 2.0, TX1 - .02)]
        pts.append(Vector((TX1 + .14, (ty + dy + yb) / 2, top + .015)))
        pts.append(Vector((TX1 + .24, yb, top - .07 - dr)))
        pts += [Vector((p.x, yb, p.z)) for p in arc_xz(XL - R, ZB - R, R + dr, 1.05, 0, 7)]
        pts += [Vector((XL + dr, yb, 5.9)), Vector((XL + dr, yb, 4.72)), Vector((XL + dr, back + .085, layout.GALLERY_TOP + .24))]
        P.add("RUBBER_Black", lib.tube(lib.catmull(pts, per=3), r, n=7))
    for z in (6.2, 5.45, 4.75):          # cable straps on the leg's back face
        P.add("STEEL_Polished", lib.rbox((.16, .012, .028), .004, 1, loc=(XL, back + .042, z)))
        for ox in (-.065, .065):
            P.screw("STEEL_Polished", r=.007, h=.004, axis=(0, 1, 0), at=(XL + ox, back + .048, z), seg=8, socket=False)
    for a in (.75, .35):                 # and on the corner
        c, s_ = math.cos(a), math.sin(a)
        p = Vector((XL - R + R * c, back + .042, ZB - R + R * s_))
        P.add("STEEL_Polished", lib.rbox((.028, .012, .16), .004, 1, rot=(0, -a, 0), loc=p))
    # junction box on the right foot plate where the cables end
    jb = Vector((XL, back + .085, layout.GALLERY_TOP + .035 + .08))
    P.add("CHARCOAL_Instrument", lib.rbox((.22, .09, .16), .015, 2, loc=jb))
    for ox in (-.05, .05):
        P.add("STEEL_Polished", lib.cyl(.022, .025, bevel=.004, segments=10, z0=jb.z + .075).transform(loc=(XL + ox, jb.y, 0)))

    objs += P.emit("GANTRY_FRAME", col)
    for o in objs:
        if o.parent is None: o.location.x += XC
    return objs


if __name__ == "__main__":
    import bpy, os
    lib.reset(); C = lib.collection("GANTRY_FRAME")
    o = gantry_frame(C)
    print("GANTRY_FRAME", lib.stats(o))
