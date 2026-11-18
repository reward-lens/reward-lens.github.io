"""Optical bench, its cabinetry and the static optics of the pocket laboratory.

    optical_bench(col) -> [Object]   table top, edge band, cabinet run, back legs
    bench_bays()       -> [dict]     free interior volumes of the open bays, for dressing
    bench_optics(col)  -> [Object]   prism, grating, pin platform, lens mounts,
                                     microscope specimen pedestal, oscilloscope

Everything is built in world coordinates from layout. The emitter, the specimen
plates, the beam splitter and the detector belong to another rig and are not
modelled here; the static optics keep clear of their volumes and nothing but
glass crosses the optical axis (y = OPTICS_Y, z = BEAM_Z).
"""
import math
from collections import defaultdict

import bmesh
from mathutils import Vector, Matrix

import lib
import layout

PI, TAU = math.pi, math.tau
X0, X1 = layout.BENCH_X
Y0, Y1 = layout.BENCH_Y
TOP = layout.BENCH_TOP
UNDER = TOP - layout.BENCH_SLAB
FLOOR = layout.FLOOR
R = layout.BENCH_CORNER_R
CX, CY = (X0 + X1) / 2, (Y0 + Y1) / 2
HA, HB = (X1 - X0) / 2 - R, (Y1 - Y0) / 2 - R      # corner-centre half extents
AY, AZ = layout.OPTICS_Y, layout.BEAM_Z
SEG = 8                                            # segments per rounded plan corner
ARRIS = .03                                        # top arris radius of the edge band

CH, ST, AL, BR, RB = "CHARCOAL_Instrument", "STEEL_Polished", "ALUMINIUM_Brushed", "BRASS_Restrained", "RUBBER_Black"
PP, PT, PD = "PETROL_Painted", "PETROL_Trim", "PETROL_Deep"

lib.SPECS.setdefault("SCREEN_Display", dict(color="#FFFFFF", emit=1.2, tex=dict(base="scope_screen.png", emit="scope_screen.png")))

# ------------------------------------------------------------------ helpers

def _build(name, parts, col, origin=None):
    """One object from {material: [Geo, ...]}, one material slot per key."""
    mats = [m for m, gs in parts.items() if gs]
    g = lib.Geo()
    for i, m in enumerate(mats):
        for geo in parts[m]:
            for f in geo.bm.faces: f.material_index = i
        g.merge(*parts[m])
    o = g.obj(name, mats[0], col, origin=origin)
    for m in mats[1:]: o.data.materials.append(lib.mat(m))
    return o

def _box(x0, x1, y0, y1, z0, z1, bevel=.004, seg=2):
    return lib.rbox((x1 - x0, y1 - y0, z1 - z0), bevel=bevel, segments=seg, loc=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))

def _orient(g, p0, d):
    """Turn a +Z-built part to point along d, base at p0."""
    q = Vector((0, 0, 1)).rotation_difference(Vector(d).normalized())
    return g.transform(matrix=Matrix.Translation(Vector(p0)) @ q.to_matrix().to_4x4())

def _rod(r, p0, p1, bevel=0.0, seg=16):
    p0, p1 = Vector(p0), Vector(p1)
    return _orient(lib.cyl(r, (p1 - p0).length, bevel, seg), p0, p1 - p0)

def _knob(r, h, flutes=9, depth=.86):
    """A fluted (knurled) knob along +Z from 0 to h."""
    poly = []
    for i in range(2 * flutes):
        rr = r * (1 if i % 2 == 0 else depth); a = PI * i / flutes
        poly.append((rr * math.cos(a), rr * math.sin(a)))
    return lib.prism(poly, 0, h, bevel=min(.003, h * .2, r * .15))

def _finish(g, bevel=0.0, angle=50.0):
    """Round the hard edges (dihedral above `angle`) of a hand-built solid."""
    bm = g.bm; bm.normal_update()
    if bevel > 0:
        lim = math.radians(angle)
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > lim]
        if edges:
            bmesh.ops.bevel(bm, geom=edges, offset=bevel, offset_type="OFFSET", segments=2, profile=.5, affect="EDGES", clamp_overlap=True)
        bm.normal_update()
    return g.uv_box().smooth(45.0)

def _ring_plate(outer, inner, z0, z1, bevel=0.0):
    """A plate with a hole: outer and inner CCW loops of equal length."""
    g = lib.Geo(); bm = g.bm; n = len(outer)
    L = [[bm.verts.new((x, y, z)) for x, y in loop] for loop, z in ((outer, z1), (inner, z1), (inner, z0), (outer, z0))]
    for i in range(n):
        j = (i + 1) % n
        for a in range(4):
            b = (a + 1) % 4
            bm.faces.new((L[a][i], L[a][j], L[b][j], L[b][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(g, bevel)

def _ray_hit(poly, a):
    d = (math.cos(a), math.sin(a)); best = None
    for i in range(len(poly)):
        p, q = poly[i], poly[(i + 1) % len(poly)]
        e = (q[0] - p[0], q[1] - p[1])
        det = -d[0] * e[1] + e[0] * d[1]
        if abs(det) < 1e-12: continue
        t = (-p[0] * e[1] + e[0] * p[1]) / det
        s = (d[0] * p[1] - d[1] * p[0]) / det
        if t > 0 and -1e-9 <= s <= 1 + 1e-9 and (best is None or t < best): best = t
    return (d[0] * best, d[1] * best)

def _plate_with_hole(cx, cy, w, h, r, hole_r, z0, z1, bevel=.004, n=32):
    """Rounded-rectangle plate with a round central aperture."""
    rr = lib.rrect(w, h, r, 4)
    angs = sorted({round(math.atan2(y, x) % TAU, 5) for x, y in rr} | {round(TAU * i / n, 5) for i in range(n)})
    angs = [a for k, a in enumerate(angs) if k == 0 or a - angs[k - 1] > 1e-3]
    outer = [(cx + p[0], cy + p[1]) for p in (_ray_hit(rr, a) for a in angs)]
    inner = [(cx + hole_r * math.cos(a), cy + hole_r * math.sin(a)) for a in angs]
    return _ring_plate(outer, inner, z0, z1, bevel)

def _plate(cx, cy, w, h, r, z0, z1, bevel=.004):
    return lib.prism([(cx + u, cy + v) for u, v in lib.rrect(w, h, r, 4)], z0, z1, bevel=bevel)

# ------------------------------------------------------------- table slab
_CORNERS = ((1, -1, -PI / 2), (1, 1, 0.0), (-1, 1, PI / 2), (-1, -1, PI))

def _plan_ring(off, z):
    """The table outline offset by `off` (negative: inward), at height z."""
    pts = []
    for sx, sy, a0 in _CORNERS:
        cx, cy = CX + sx * HA, CY + sy * HB
        for k in range(SEG + 1):
            t = a0 + PI / 2 * k / SEG
            pts.append((cx + (R + off) * math.cos(t), cy + (R + off) * math.sin(t), z))
    return pts

def _table_top(step=.15):
    """Flat top inside the arris, gridded (~step m) so per-vertex AO has room;
    UVs are world metres on X/Y, so the hole texture runs along the axes."""
    r = R - ARRIS
    nx = max(1, round(2 * HA / step)); ny = max(1, round(2 * HB / step))
    xs = [-HA - r] + [-HA + 2 * HA * i / nx for i in range(nx + 1)] + [HA + r]
    ys = [-HB - r] + [-HB + 2 * HB * j / ny for j in range(ny + 1)] + [HB + r]
    g = lib.Geo(); bm = g.bm; V = {}
    def v(x, y):
        k = (round(x, 5), round(y, 5))
        if k not in V: V[k] = bm.verts.new((CX + x, CY + y, TOP))
        return V[k]
    I, J = len(xs) - 1, len(ys) - 1
    for i in range(I):
        for j in range(J):
            if i in (0, I - 1) and j in (0, J - 1): continue
            bm.faces.new((v(xs[i], ys[j]), v(xs[i + 1], ys[j]), v(xs[i + 1], ys[j + 1]), v(xs[i], ys[j + 1])))
    for sx, sy, a0 in _CORNERS:
        c = (sx * HA, sy * HB)
        arc = [(c[0] + r * math.cos(a0 + PI / 2 * k / SEG), c[1] + r * math.sin(a0 + PI / 2 * k / SEG)) for k in range(SEG + 1)]
        for k in range(SEG):
            bm.faces.new((v(*c), v(*arc[k]), v(*arc[k + 1])))
    bm.normal_update()
    return g.uv_box().smooth(10)

def _outward(g):
    """Flip an open lofted band so its largest side face points away from the table centre."""
    bm = g.bm; bm.normal_update()
    f = max(bm.faces, key=lambda f: math.hypot(f.normal.x, f.normal.y) * f.calc_area())
    c = f.calc_center_median()
    if f.normal.x * (c.x - CX) + f.normal.y * (c.y - CY) < 0:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces)); bm.normal_update()
    return g

def _edge_band():
    """Aluminium band with a rounded top arris, then a recessed dark shadow line and the underside."""
    prof = [(-ARRIS + ARRIS * math.cos(t), -ARRIS + ARRIS * math.sin(t)) for t in (PI / 2 * (1 - k / 6) for k in range(7))]
    rb, zb = .006, -.112
    prof += [(-rb + rb * math.cos(t), zb + rb * math.sin(t)) for t in (-PI / 2 * k / 3 for k in range(1, 4))]
    band = _outward(lib.loft([_plan_ring(x, TOP + y) for x, y in prof], closed_sections=True, closed_loop=False, cap=False, smooth=40))
    dprof = [(-.006, -.118), (-.017, -.118), (-.017, -.14), (-.09, -.14)]
    dark = _outward(lib.loft([_plan_ring(x, TOP + y) for x, y in dprof], closed_sections=True, closed_loop=False, cap=False, smooth=40))
    under = lib.Geo(); ring = [under.bm.verts.new(p) for p in reversed(_plan_ring(-.09, UNDER))]
    under.bm.faces.new(ring); under.uv_box()
    return band, dark.merge(under)

# ---------------------------------------------------------------- cabinets
FACE_Y = Y0 + layout.CABINET_SETBACK          # face-frame front plane
BACK_Y = Y0 + 1.0                             # cabinets fill the front 1.0 m of the table depth
CAB_X0, CAB_X1 = X0 + layout.CABINET_SETBACK, X1 - layout.CABINET_SETBACK
TOE_H, TOE_IN = .09, .065
RAIL_B, RAIL_T, STILE, MID, FRAME_T = .06, .075, .055, .042, .03
PANEL, BACK_T, SHELF_T, REVEAL = .025, .02, .03, .005
Z_IN0 = FLOOR + TOE_H + RAIL_B                # opening bottom = bay floor
Z_IN1 = UNDER - RAIL_T                        # opening top = bay ceiling
KINDS = "DODODODOD"                           # D drawer unit, O open bay
DRAWER_W = .66
RATIOS = {3: (.28, .33, .39), 2: (.43, .57)}

def _modules():
    W = CAB_X1 - CAB_X0
    nd, no = KINDS.count("D"), KINDS.count("O")
    wo = (W - STILE * (len(KINDS) + 1) - nd * DRAWER_W) / no
    x = CAB_X0 + STILE; out = []
    for i, k in enumerate(KINDS):
        w = DRAWER_W if k == "D" else wo
        out.append(dict(kind=k, i=i, x0=x, x1=x + w)); x += w + STILE
    return out

def _shelf_z():
    z0 = Z_IN0 + (Z_IN1 - Z_IN0 - SHELF_T) / 2
    return z0, z0 + SHELF_T

def bench_bays():
    """Free interior volume of every open bay compartment (floor and shelf level):
    [dict(center=(x, y, z), size=(w, d, h), name=...)]; the bottom face is the
    surface props stand on."""
    s0, s1 = _shelf_z()
    y0, y1 = FACE_Y + .02, BACK_Y - BACK_T - .005
    out = []
    for m in _modules():
        if m["kind"] != "O": continue
        x0, x1 = m["x0"] + .004, m["x1"] - .004
        for level, (z0, z1) in (("floor", (Z_IN0, s0)), ("shelf", (s1, Z_IN1))):
            out.append(dict(center=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), size=(x1 - x0, y1 - y0, z1 - z0), name=f"bay{m['i']}_{level}"))
    return out

def _bar_handle(P, xc, y_face, zc, L):
    """Brass bar pull on two standoffs with roses, projecting toward -Y."""
    yb = y_face - .034
    P[BR].append(_rod(.0105, (xc - L / 2, yb, zc), (xc + L / 2, yb, zc), bevel=.005, seg=16))
    for s in (-1, 1):
        xs = xc + s * (L / 2 - .03)
        P[BR].append(_rod(.0068, (xs, y_face + .002, zc), (xs, yb, zc), seg=10))
        P[BR].append(_rod(.0125, (xs, y_face + .002, zc), (xs, y_face - .0045, zc), bevel=.0018, seg=16))

def _cabinets(P):
    mods = _modules()
    zb, zt, yf, yb = FLOOR + TOE_H, UNDER - .001, FACE_Y, BACK_Y
    # recessed toe-kick plinth
    P[PD].append(_box(CAB_X0 + TOE_IN, CAB_X1 - TOE_IN, yf + TOE_IN, yb - .03, FLOOR, zb + .01, bevel=.004))
    # carcass: end panels, bottom, ceiling, back, dividers
    for x0, x1 in ((CAB_X0, CAB_X0 + PANEL), (CAB_X1 - PANEL, CAB_X1)):
        P[PP].append(_box(x0, x1, yf + FRAME_T - .002, yb, zb, zt, bevel=.005))
    P[PP].append(_box(CAB_X0 + PANEL - .002, CAB_X1 - PANEL + .002, yf + FRAME_T - .004, yb - BACK_T + .002, Z_IN0 - .03, Z_IN0, bevel=.003))
    P[PP].append(_box(CAB_X0 + PANEL - .002, CAB_X1 - PANEL + .002, yf + FRAME_T - .004, yb - BACK_T + .002, Z_IN1, Z_IN1 + .03, bevel=.003))
    P[PD].append(_box(CAB_X0 + PANEL - .002, CAB_X1 - PANEL + .002, yb - BACK_T, yb - .002, zb, zt, bevel=.003))
    for m in mods[1:]:
        xc = m["x0"] - STILE / 2
        P[PP].append(_box(xc - PANEL / 2, xc + PANEL / 2, yf + FRAME_T - .004, yb - BACK_T + .002, Z_IN0 - .002, Z_IN1 + .002, bevel=.003))
    # face frame: full-width rails, stiles between them
    P[PT].append(_box(CAB_X0, CAB_X1, yf, yf + FRAME_T, zb, Z_IN0, bevel=.005))
    P[PT].append(_box(CAB_X0, CAB_X1, yf, yf + FRAME_T, Z_IN1, zt, bevel=.005))
    for xs in [m["x0"] for m in mods] + [mods[-1]["x1"] + STILE]:
        P[PT].append(_box(xs - STILE, xs, yf, yf + FRAME_T, Z_IN0, Z_IN1, bevel=.005))
    # framed end panels: applied stiles and rails on each outer side
    for side in (-1, 1):
        xo = CAB_X1 if side > 0 else CAB_X0
        xa, xb = (xo - .002, xo + .012) if side > 0 else (xo - .012, xo + .002)
        P[PT].append(_box(xa, xb, yf, yf + .07, zb, zt, bevel=.004))
        P[PT].append(_box(xa, xb, yb - .07, yb, zb, zt, bevel=.004))
        P[PT].append(_box(xa, xb, yf + .07, yb - .07, zb, Z_IN0, bevel=.004))
        P[PT].append(_box(xa, xb, yf + .07, yb - .07, Z_IN1, zt, bevel=.004))
    s0, s1 = _shelf_z()
    nd = 0
    for m in mods:
        x0, x1 = m["x0"], m["x1"]
        if m["kind"] == "O":                      # open bay: one shelf, left empty for props
            P[PP].append(_box(x0 - STILE / 2 + PANEL / 2, x1 + STILE / 2 - PANEL / 2, yf + .02, yb - BACK_T + .001, s0, s1, bevel=.004))
            continue
        n = 3 if nd % 2 == 0 else 2; nd += 1
        avail = Z_IN1 - Z_IN0 - (n - 1) * MID
        z = Z_IN1
        for k, ratio in enumerate(RATIOS[n]):
            h = avail * ratio; zd = z - h
            P[PP].append(_box(x0 + REVEAL, x1 - REVEAL, yf + .004, yf + .028, zd + REVEAL, z - REVEAL, bevel=.007))
            _bar_handle(P, (x0 + x1) / 2, yf + .004, z - min(.12, h * .42), .30)
            if k < n - 1:
                P[PT].append(_box(x0, x1, yf + .002, yf + FRAME_T, zd - MID, zd, bevel=.004))
            z = zd - MID

def _legs(P):
    """Steel legs with levelling feet carry the open back of the table."""
    ly = Y1 - .30
    xs = [X0 + .40 + (X1 - X0 - .80) * i / 3 for i in range(4)]
    for x in xs:
        P[RB].append(lib.lathe([(0, FLOOR), (.052, FLOOR), (.055, FLOOR + .008), (.048, FLOOR + .02), (0, FLOOR + .022)], segments=18).transform(loc=(x, ly, 0)))
        P[ST].append(lib.cyl(.014, .06, segments=12, z0=FLOOR + .018).transform(loc=(x, ly, 0)))
        P[CH].append(lib.prism(lib.circle(.032, 6), FLOOR + .05, FLOOR + .072, bevel=.003).transform(loc=(x, ly, 0)))
        P[CH].append(lib.cyl(.06, .05, bevel=.006, segments=20, z0=FLOOR + .072).transform(loc=(x, ly, 0)))
        P[ST].append(lib.cyl(.05, UNDER - .02 - (FLOOR + .11), bevel=.004, segments=20, z0=FLOOR + .11).transform(loc=(x, ly, 0)))
        P[CH].append(lib.cyl(.06, .04, bevel=.005, segments=20, z0=UNDER - .055).transform(loc=(x, ly, 0)))
        P[CH].append(_box(x - .095, x + .095, ly - .095, ly + .095, UNDER - .018, UNDER, bevel=.004))
    zs = FLOOR + .45
    P[ST].append(_rod(.024, (xs[0], ly, zs), (xs[-1], ly, zs), bevel=.004, seg=16))
    for x in (xs[0], xs[-1]):
        P[ST].append(_rod(.024, (x, ly, zs), (x, BACK_Y, zs), bevel=.004, seg=16))

def optical_bench(col):
    """The optical table (top, edge band, shadow line), the cabinet run under its
    front metre and the steel legs at the back. Returns the objects."""
    top = _table_top().obj("BENCH_Top", "OPTICAL_TABLE_Top", col)
    band, dark = _edge_band()
    edge = _build("BENCH_Edge", {AL: [band], RB: [dark]}, col)
    P = defaultdict(list); _cabinets(P)
    cab = _build("BENCH_Cabinets", P, col)
    L = defaultdict(list); _legs(L)
    legs = _build("BENCH_Legs", L, col)
    return [top, edge, cab, legs]

# ------------------------------------------------------------------ optics

def _post_stack(P, x, y, z_top, holder_h=.20, post_r=.019, holder_r=.032, screw=(.55, -.82)):
    """Slotted base plate, post holder with clamp collar and thumbscrew, and a
    steel post from the holder up to z_top. The holder stands at (x, y)."""
    z0 = TOP
    pc = y - .03
    outer = [(x + u, pc + v) for u, v in lib.rrect(.12, .22, .028, 4)]
    sy = pc - .062
    slot = [(x + u, sy + v) for u, v in lib.rrect(.024, .075, .0118, 4)]
    P[CH].append(_ring_plate(outer, slot, z0, z0 + .016, bevel=.003))
    P[ST].append(lib.cyl(.019, .003, segments=12, z0=z0 + .016).transform(loc=(x, sy, 0)))
    P[ST].append(lib.cyl(.0135, .012, bevel=.003, segments=10, z0=z0 + .019).transform(loc=(x, sy, 0)))
    h0 = z0 + .016; h1 = h0 + holder_h; hr = holder_r
    P[CH].append(lib.lathe([(0, h0), (hr + .014, h0), (hr + .014, h0 + .007), (hr + .011, h0 + .011), (hr + .002, h0 + .014), (hr, h0 + .018),
                            (hr, h1 - .005), (hr - .002, h1 - .001), (hr - .006, h1), (0, h1)], segments=18).transform(loc=(x, y, 0)))
    za, zb = h1 - .055, h1 - .018
    P[CH].append(lib.lathe([(hr - .001, za), (hr + .005, za), (hr + .008, za + .003), (hr + .008, zb - .003), (hr + .005, zb), (hr - .001, zb)], segments=18).transform(loc=(x, y, 0)))
    d = Vector((screw[0], screw[1], 0)).normalized(); c = Vector((x, y, (za + zb) / 2))
    P[ST].append(_rod(.0045, c + d * (hr + .004), c + d * (hr + .026), seg=10))
    P[CH].append(_orient(_knob(.0145, .016), c + d * (hr + .022), d))
    P[ST].append(lib.cyl(post_r, z_top - (h1 - .01), bevel=.003, segments=14, z0=h1 - .01).transform(loc=(x, y, 0)))
    return h1

def _lens_mount(P, x):
    """Ring lens holder with a glass element, on a post holder at (x, OPTICS_Y)."""
    ro, ri, t = .092, .066, .03
    stem_top = AZ - ro
    post_top = stem_top - .03
    _post_stack(P, x, AY, post_top + .006, holder_h=.22)
    P[CH].append(_box(x - .02, x + .02, AY - .028, AY + .028, post_top - .004, stem_top + .012, bevel=.005))
    prof = [(ri, -t / 2 + .005), (ri + .005, -t / 2), (ro - .007, -t / 2), (ro, -t / 2 + .007), (ro, t / 2 - .007), (ro - .007, t / 2), (ri + .005, t / 2), (ri, t / 2 - .005)]
    P[CH].append(lib.lathe(prof, segments=28, closed_profile=True).transform(rot=(0, PI / 2, 0)).transform(loc=(x, AY, AZ)))
    rl, tc, te = ri + .003, .026, .008
    half = [(rl * k / 6, te / 2 + (tc - te) / 2 * (1 - (k / 6) ** 2)) for k in range(7)]
    lens = [(r, -z) for r, z in half] + [(r, z) for r, z in reversed(half)]
    P["GLASS_Clear"].append(lib.lathe(lens, segments=18).transform(rot=(0, PI / 2, 0)).transform(loc=(x, AY, AZ)))
    P[CH].append(_knob(.0095, .016).transform(loc=(x, AY, AZ + ro - .004)))
    P[ST].append(lib.cyl(.004, .004, segments=10, z0=AZ + ro + .011).transform(loc=(x, AY, 0)))

def _prism(col):
    """Equilateral glass prism (refracting edge along Y) on a kinematic platform."""
    px = layout.OPT["prism"]
    s, d, fr = .50, .30, .012
    Rc = s / math.sqrt(3)
    poly, mids = [], []
    for k in range(3):
        phi = PI / 2 + TAU * k / 3
        vx, vy = Rc * math.cos(phi), Rc * math.sin(phi)
        cx, cy = vx - 2 * fr * math.cos(phi), vy - 2 * fr * math.sin(phi)
        for i in range(5):
            a = phi - PI / 3 + (2 * PI / 3) * i / 4
            poly.append((cx + fr * math.cos(a), cy + fr * math.sin(a)))
        mids.append((cx + fr * math.cos(phi), cy + fr * math.sin(phi)))
    glass = lib.prism(poly, -d / 2, d / 2, bevel=.005).transform(rot=(PI / 2, 0, 0)).transform(loc=(px, AY, AZ))
    edges = []
    for mx, my in mids:
        p = (px + mx * .997, 0, AZ + my * .997)
        edges.append(_rod(.0034, (p[0], AY - d / 2 + .003, p[2]), (p[0], AY + d / 2 - .003, p[2]), seg=8))
    rim = lib.offset_polygon(poly, -.0016)
    for sy in (-1, 1):
        y = AY + sy * (d / 2 - .0016)
        edges.append(lib.tube([(px + u, y, AZ + v) for u, v in rim], .0034, n=6, closed_path=True))
    o_glass = _build("OPTIC_Prism", {"PRISM_Glass": [glass], "SPECIMEN_Glass_Edge": edges}, col, origin=(px, AY, AZ))
    # kinematic platform: top plate, lower plate, three adjusters, post boss
    P = defaultdict(list)
    zpb = AZ - Rc / 2
    P[CH].append(_plate(px, AY, .30, .34, .02, zpb - .022, zpb, bevel=.004))
    P[CH].append(_plate(px, AY, .30, .34, .02, zpb - .054, zpb - .031, bevel=.004))
    for u, v in ((-.115, -.135), (.115, -.135), (.115, .135)):
        P[ST].append(lib.cyl(.005, .07, segments=10, z0=zpb - .08).transform(loc=(px + u, AY + v, 0)))
        P[CH].append(_knob(.02, .022).transform(loc=(px + u, AY + v, zpb - .082)))
    for u, v in ((-.115, .135),):
        P[ST].append(lib.cyl(.009, .012, bevel=.003, segments=14, z0=zpb - .042).transform(loc=(px + u, AY + v, 0)))
    P[CH].append(lib.cyl(.034, .032, bevel=.004, segments=24, z0=zpb - .085).transform(loc=(px, AY, 0)))
    _post_stack(P, px, AY, zpb - .08, holder_h=.20)
    o_mount = _build("OPTIC_Prism_Mount", P, col)
    return [o_glass, o_mount]

def _grating(col):
    """~40 vertical aluminium slats in a dark frame across the beam, a 6 cm
    clear band left open along the axis, on a post holder."""
    gx = layout.OPT["grating"]
    W, H, D, bar = .38, .55, .08, .034
    M = Matrix(((0, 0, 1, gx), (1, 0, 0, AY), (0, 1, 0, AZ), (0, 0, 0, 1)))   # local (u, v, w) -> world (y, z, x)
    P = defaultdict(list)
    P[CH].append(_ring_plate(lib.rrect(W, H, .018, 3), lib.rrect(W - 2 * bar, H - 2 * bar, .006, 3), -D / 2, D / 2, bevel=.004).transform(matrix=M))
    iw, ih = W / 2 - bar, H / 2 - bar
    band = .03
    for sz in (-1, 1):
        z0, z1 = (AZ + band, AZ + band + .01) if sz > 0 else (AZ - band - .01, AZ - band)
        P[CH].append(_box(gx - .015, gx + .015, AY - iw - .004, AY + iw + .004, z0, z1, bevel=.002))
    n = 40; pitch = 2 * iw / n
    for i in range(n):
        y = AY - iw + pitch * (i + .5)
        for z0, z1 in ((AZ - ih - .004, AZ - band - .009), (AZ + band + .009, AZ + ih + .004)):
            P[AL].append(_box(gx - .011, gx + .011, y - .0017, y + .0017, z0, z1, bevel=0))
    for su in (-1, 1):
        for sv in (-1, 1):
            P[ST].append(_rod(.0075, (gx + D / 2 - .001, AY + su * (W / 2 - bar / 2), AZ + sv * (H / 2 - bar / 2)),
                              (gx + D / 2 + .003, AY + su * (W / 2 - bar / 2), AZ + sv * (H / 2 - bar / 2)), bevel=.0015, seg=12))
    zf = AZ - H / 2
    P[CH].append(_box(gx - .032, gx + .032, AY - .06, AY + .06, zf - .03, zf + .006, bevel=.005))
    _post_stack(P, gx, AY, zf - .026, holder_h=.20)
    return [_build("OPTIC_Grating", P, col, origin=(gx, AY, AZ))]

def _pin_platform(col):
    """Dark plate on standoffs with a 2 x 8 grid of brass pins; the moving
    specimen plates stand above it."""
    px = layout.OPT["specimen"]
    zt = AZ - .45
    P = defaultdict(list)
    P[CH].append(_plate(px, AY, .98, .58, .03, TOP, TOP + .02, bevel=.004))
    for su in (-1, 1):
        for sv in (-1, 1):
            P[ST].append(lib.cyl(.022, zt - .035 - (TOP + .02) + .004, bevel=.003, segments=20, z0=TOP + .018).transform(loc=(px + su * .40, AY + sv * .20, 0)))
    P[CH].append(_plate(px, AY, .90, .50, .025, zt - .035, zt, bevel=.005))
    for i in range(8):
        for j in (-1, 1):
            x, y = px - .35 + .10 * i, AY + j * .10
            P[ST].append(lib.prism(lib.circle(.015, 6), zt, zt + .009).transform(loc=(x, y, 0)))
            P[BR].append(lib.cyl(.0075, .045, bevel=.003, segments=8, z0=zt + .006).transform(loc=(x, y, 0)))
    return [_build("OPTIC_PinPlatform", P, col, origin=(px, AY, zt))]

def _pedestal(col):
    """Specimen pedestal under the microscope: illuminator column, XY stage
    (top at z 3.25) with knobs, a glass slide and an emissive ring under it."""
    px, py, zs = layout.MICRO_X, layout.MICRO_Y, 3.25
    P = defaultdict(list)
    P[CH].append(_plate(px, py - .05, .36, .24, .03, TOP, TOP + .035, bevel=.006))
    z0 = TOP + .03
    P[CH].append(lib.lathe([(0, z0), (.072, z0), (.075, z0 + .004), (.075, z0 + .15), (.071, z0 + .158), (.052, z0 + .166), (.047, z0 + .17), (0, z0 + .17)], segments=22).transform(loc=(px, py, 0)))
    P[ST].append(lib.cyl(.04, 3.07 - (z0 + .16), bevel=.003, segments=20, z0=z0 + .16).transform(loc=(px, py, 0)))
    P[CH].append(lib.cyl(.056, .05, bevel=.006, segments=22, z0=3.05).transform(loc=(px, py, 0)))
    for s in (-1, 1):
        P[ST].append(_rod(.006, (px + s * .05, py, 3.075), (px + s * .082, py, 3.075), seg=10))
        P[CH].append(_orient(_knob(.028, .022, 14), (px + s * .074, py, 3.075), (s, 0, 0)))
    P[CH].append(_box(px - .10, px + .10, py - .09, py + .09, 3.095, 3.152, bevel=.006))
    P[CH].append(_plate_with_hole(px, py, .36, .27, .02, .05, 3.15, 3.185, bevel=.004))
    for s in (-1, 1):
        P[ST].append(_box(px - .16, px + .16, py + s * .11 - .007, py + s * .11 + .007, 3.183, 3.207, bevel=.002))
    P[CH].append(_plate_with_hole(px, py, .32, .25, .018, .046, 3.205, zs, bevel=.004))
    kx, ky = px + .15, py - .10
    P[ST].append(lib.cyl(.0055, .14, segments=10, z0=3.012).transform(loc=(kx, ky, 0)))
    P[CH].append(_knob(.024, .02).transform(loc=(kx, ky, 3.07)))
    P[CH].append(_knob(.018, .02).transform(loc=(kx, ky, 3.035)))
    P[ST].append(lib.cyl(.026, .006, bevel=.002, segments=20, z0=3.144).transform(loc=(kx, ky, 0)))
    P["SPECIMEN_Glass"].append(_box(px - .11, px + .11, py - .0375, py + .0375, zs, zs + .006, bevel=.0015))
    for s in (-1, 1):
        P[ST].append(_box(px + s * .09 - .045, px + s * .09 + .045, py - .03, py - .016, zs + .006, zs + .0095, bevel=.0012))
        P[ST].append(lib.cyl(.009, .008, bevel=.002, segments=14, z0=zs).transform(loc=(px + s * .132, py - .023, 0)))
    ring = [(.036 + .006 * math.cos(a), zs - .012 + .006 * math.sin(a)) for a in (TAU * i / 10 for i in range(10))]
    P["APRICOT_Task_Light"].append(lib.lathe(ring, segments=22, closed_profile=True).transform(loc=(px, py, 0)))
    return [_build("OPTIC_Pedestal", P, col, origin=(px, py, zs))]

def _scope(col):
    """Bench oscilloscope at the back right, its screen turned toward (-0.3, -1)."""
    W, D, H, FT = .44, .30, .25, .012
    yaw = math.atan2(-1, -.3) + PI / 2
    loc = (1.9, .55, TOP)
    yF = -D / 2 + .012                       # front panel plane (local)
    P = defaultdict(list)
    P[CH].append(_box(-W / 2, W / 2, yF, D / 2, FT, FT + H, bevel=.02, seg=3))
    zc = FT + H / 2
    flip = lambda yy, cz: Matrix(((1, 0, 0, 0), (0, 0, 1, yy), (0, 1, 0, cz), (0, 0, 0, 1)))   # plate XY -> XZ, thickness -> +Y
    P[RB].append(_ring_plate(lib.rrect(W + .014, H + .014, .03, 4), lib.rrect(W - .022, H - .022, .016, 4), 0, .03, bevel=.004).transform(matrix=flip(-D / 2, zc)))
    sx0, sx1, sz0, sz1 = -W / 2 + .03, -W / 2 + .03 + .245, FT + .064, FT + .064 + .158
    scx, scz = (sx0 + sx1) / 2, (sz0 + sz1) / 2
    bez = _ring_plate(lib.rrect(sx1 - sx0 + .018, sz1 - sz0 + .018, .008, 3), lib.rrect(sx1 - sx0, sz1 - sz0, .003, 3), 0, .007, bevel=.0015)
    P[CH].append(bez.transform(matrix=Matrix.Translation((scx, 0, 0)) @ flip(yF - .006, scz)))
    for i in range(5):
        kx = sx0 + .026 + (sx1 - sx0 - .052) * i / 4
        P[AL].append(_box(kx - .017, kx + .017, yF - .006, yF + .002, FT + .03, FT + .046, bevel=.003))
    for kx, kz, kr in ((.105, .205, .021), (.165, .205, .016), (.105, .148, .016), (.165, .148, .021), (.135, .098, .013)):
        P[CH].append(_knob(kr, .018).transform(rot=(PI / 2, 0, 0)).transform(loc=(kx, yF + .001, FT + kz)))
        P[ST].append(lib.cyl(kr * .42, .003, segments=12).transform(rot=(PI / 2, 0, 0)).transform(loc=(kx, yF - .016, FT + kz)))
    for kx in (.095, .14, .185):
        P[ST].append(lib.cyl(.0085, .016, bevel=.002, segments=14).transform(rot=(PI / 2, 0, 0)).transform(loc=(kx, yF + .001, FT + .045)))
        P[ST].append(lib.cyl(.0115, .005, bevel=.0015, segments=14).transform(rot=(PI / 2, 0, 0)).transform(loc=(kx, yF + .001, FT + .045)))
        P[CH].append(lib.cyl(.0045, .002, segments=10).transform(rot=(PI / 2, 0, 0)).transform(loc=(kx, yF - .0145, FT + .045)))
    for i in range(7):
        yy = -.075 + .028 * i
        P[RB].append(_box(W / 2 - .003, W / 2 + .001, yy - .0045, yy + .0045, FT + .07, FT + .19, bevel=.002))
    for s in (-1, 1):
        P[CH].append(_box(s * .16 - .016, s * .16 + .016, -.022, .022, FT + H - .006, FT + H + .03, bevel=.007))
    P[RB].append(_rod(.011, (-.162, 0, FT + H + .021), (.162, 0, FT + H + .021), bevel=.004, seg=14))
    for su in (-1, 1):
        for sv in (-1, 1):
            P[RB].append(lib.cyl(.02, FT + .002, bevel=.003, segments=16).transform(loc=(su * .18, sv * .11, 0)))
    for gs in P.values():
        for g in gs: g.transform(rot=(0, 0, yaw)).transform(loc=loc)
    body = _build("BENCH_Scope", P, col, origin=loc)
    scr = lib.Geo(); bm = scr.bm; ys = yF - .0015
    vs = [bm.verts.new(p) for p in ((sx0, ys, sz0), (sx1, ys, sz0), (sx1, ys, sz1), (sx0, ys, sz1))]
    f = bm.faces.new(vs)
    for l, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))): l[scr.uv].uv = uv
    scr.transform(rot=(0, 0, yaw)).transform(loc=loc)
    import bpy
    bpy.context.view_layer.update()
    screen = scr.obj("BENCH_Scope_Screen", "SCREEN_Display", col, parent=body, wn=False)
    return [body, screen]

def bench_optics(col):
    """Static optics on the axis plus the microscope pedestal and the scope."""
    P = defaultdict(list)
    for x in (-3.25, -.55, .95): _lens_mount(P, x)
    lenses = _build("OPTIC_LensMounts", P, col)
    return _prism(col) + _grating(col) + _pin_platform(col) + [lenses] + _pedestal(col) + _scope(col)
