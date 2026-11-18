"""Small props for the pocket-lab scene: lens canisters, hardcover books and
rows, lever-arch binders, glassware, a pencil cup, brass curios and a lab
notebook.

Every builder takes `loc` (or `start_xyz`) as the base point on the supporting
surface, builds in world coordinates, joins the parts that share a material
into one object and returns list[Object]; the first object carries the item's
name, the others are named f"{name}_{MATERIAL}". Object origins sit at `loc`.
Faces of a room shelf look toward -Y, so spines and gauge faces point -Y at
yaw 0.
"""
import math, random, zlib
import bmesh
from mathutils import Vector, Matrix
import lib
from lib import Geo, TAU

lib.SPECS.setdefault("LENS_Coated", dict(color="#29264A", metal=.3, rough=.05))
lib.SPECS.setdefault("LIQUID_Teal", dict(color="#2E8A84", rough=.05, alpha=.72))
lib.SPECS.setdefault("WOOD_Pencil", dict(color="#D8B387", rough=.66))
lib.SPECS.setdefault("CONTENTS_Amber", dict(color="#A86F2E", rough=.45))
lib.SPECS.setdefault("CONTENTS_Powder", dict(color="#E4DED0", rough=.9))

COVERS = ("BOOK_Cover_Teal", "BOOK_Cover_Ochre", "BOOK_Cover_Cream", "BOOK_Cover_Slate", "BOOK_Cover_Rust")
BODY, STEEL, BRASS, LENS = "CHARCOAL_Instrument", "STEEL_Polished", "BRASS_Restrained", "LENS_Coated"

# ------------------------------------------------------------------ helpers

class _Parts:
    """Geos keyed by material; parts with the same material merge."""
    def __init__(self): self.g = {}

    def add(self, m, geo):
        if geo is None: return self
        if m in self.g: self.g[m].merge(geo)
        else: self.g[m] = geo
        return self

    def absorb(self, other):
        for m, g in other.g.items(): self.add(m, g)
        other.g = {}; return self

    def transform(self, matrix):
        for g in self.g.values(): g.transform(matrix=matrix)
        return self

    def build(self, name, col, origin):
        out = []
        for i, (m, g) in enumerate(self.g.items()):
            out.append(g.obj(name if i == 0 else f"{name}_{m}", m, col=col, origin=Vector(origin)))
        return out


def _T(x=0.0, y=0.0, z=0.0): return Matrix.Translation(Vector((x, y, z)))
def _Rx(a): return Matrix.Rotation(a, 4, "X")
def _Ry(a): return Matrix.Rotation(a, 4, "Y")
def _Rz(a): return Matrix.Rotation(a, 4, "Z")
def _place(loc, yaw=0.0): return _T(*loc) @ _Rz(yaw)


def _round(pts, radii, n=2):
    """Round the interior corners of a 2D polyline. radii[i] is 0, a radius,
    or (radius, samples); samples 1 gives a chamfer, 2 a three-point fillet."""
    out = [tuple(pts[0])]
    for i in range(1, len(pts) - 1):
        rad = radii[i]; k = n
        if isinstance(rad, tuple): rad, k = rad
        if not rad: out.append(tuple(pts[i])); continue
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[i + 1])
        a, b = p0 - p1, p2 - p1; la, lb = a.length, b.length
        a.normalize(); b.normalize(); ang = a.angle(b)
        if ang < 1e-3 or ang > math.pi - 1e-3: out.append(tuple(pts[i])); continue
        d = min(rad / math.tan(ang / 2), la * .48, lb * .48)
        t0, t1 = p1 + a * d, p1 + b * d
        for j in range(k + 1):
            s = j / k; q = (1 - s) ** 2 * t0 + 2 * (1 - s) * s * p1 + s * s * t1
            out.append((q.x, q.y))
    out.append(tuple(pts[-1]))
    return out


def _orient(g, mode="z"):
    """Flip faces of an open shell so they face +Z ('z') or away from the Z axis ('radial')."""
    bm = g.bm; bm.normal_update(); bad = []
    for f in bm.faces:
        n = f.normal
        if mode == "z": wrong = n.z < 0
        else: c = f.calc_center_median(); wrong = n.x * c.x + n.y * c.y < 0
        if wrong: bad.append(f)
    if bad: bmesh.ops.reverse_faces(bm, faces=bad)
    bm.normal_update(); return g


def _ccw(poly):
    a = sum(poly[i - 1][0] * poly[i][1] - poly[i][0] * poly[i - 1][1] for i in range(len(poly)))
    return list(poly) if a > 0 else list(reversed(poly))


def _lathe(prof, seg, smooth=60.0, orient=None):
    g = lib.lathe(prof, segments=seg, smooth=smooth)
    return _orient(g, orient) if orient else g


def _band(r, e, z0, z1, seg):
    """A proud ring on a cylinder wall of radius r, rounded by its 45-degree flanks."""
    c = min(e, (z1 - z0) * .35)
    return _lathe([(r - .0003, z0), (r + e, z0 + c), (r + e, z1 - c), (r - .0003, z1)], seg, orient="radial")


def _ribbed(r, e, depth, z0, z1, ribs):
    """A knurled grip ring: `ribs` crisp longitudinal ridges standing e proud of radius r."""
    n = ribs * 2; c = min(e, (z1 - z0) * .3)
    def ring(z, rr): return [(rr(i) * math.cos(TAU * i / n), rr(i) * math.sin(TAU * i / n), z) for i in range(n)]
    plain = lambda i: r - .0003
    rib = lambda i: r + e - (depth if i % 2 else 0.0)
    g = lib.loft([ring(z0, plain), ring(z0 + c, rib), ring(z1 - c, rib), ring(z1, plain)], closed_sections=True, cap=False, smooth=0)
    return _orient(g.smooth(25), "radial")


def _strip(path, z0, z1, center=(0.0, 0.0)):
    """A thin vertical ribbon along a 2D path (spine bands, labels), facing away from center."""
    g = Geo(); bm = g.bm
    lo = [bm.verts.new((x, y, z0)) for x, y in path]
    hi = [bm.verts.new((x, y, z1)) for x, y in path]
    for i in range(len(path) - 1):
        f = bm.faces.new((lo[i], lo[i + 1], hi[i + 1], hi[i])); f.normal_update()
        mx = (path[i][0] + path[i + 1][0]) / 2 - center[0]; my = (path[i][1] + path[i + 1][1]) / 2 - center[1]
        if f.normal.x * mx + f.normal.y * my < 0: f.normal_flip()
    return g.uv_box().smooth(60)


def _quad(p0, p1, p2, p3):
    g = Geo(); bm = g.bm
    bm.faces.new([bm.verts.new(p) for p in (p0, p1, p2, p3)])
    return g


def _hash(name): return zlib.crc32(name.encode())

# ---------------------------------------------------------- lens canisters

def _canister(r, h, style):
    P = _Parts(); s = r / .09
    c = .0035 * s; e = .0032 * s; seg = 28; bw = .014 * s
    if style == 3:
        # Plain turned steel tube with charcoal rings and a grooved top.
        g = .0016 * s; zg1, zg2 = .20 * h, .235 * h
        pts = [(0, 0), (r, 0), (r, zg1 - g), (r - g, zg1), (r, zg1 + g), (r, zg2 - g), (r - g, zg2), (r, zg2 + g),
               (r, h), (.78 * r, h), (.76 * r, h - .0025 * s), (.70 * r, h - .0025 * s), (.68 * r, h), (0, h)]
        rad = [0, (c, 2), 0, 0, 0, 0, 0, 0, (c, 2), 0, 0, 0, 0, 0]
        P.add(STEEL, _lathe(_round(pts, rad), seg))
        P.add(BODY, _band(r, e, .07 * h, .07 * h + .02 * s, seg))
        P.add(BODY, _band(r, e, .80 * h, .80 * h + .03 * s, seg))
        return P
    d = .018 * s
    if style == 0:      # short prime: straight barrel, grip between two bands, recessed front element
        rr = r - .15 * r
        pts = [(0, 0), (r, 0), (r, h), (rr, h), (rr, h - d), (0, h - d)]
        rad = [0, (c, 2), (c, 2), (c * .6, 1), 0, 0]
        bands = [(r, .13 * h), (r, .74 * h)]
        knurl = (r, .38 * h, .62 * h, 34)
        lens_r, lens_z, ring = rr, h - d, True
    elif style == 1:    # tall zoom: stepped barrel, wide zoom ring on the front section
        r1 = .84 * r; zs = .40 * h; rr = r - .14 * r
        pts = [(0, 0), (r1, 0), (r1, zs), (r, zs + .35 * (r - r1)), (r, h), (rr, h), (rr, h - d), (0, h - d)]
        rad = [0, (c, 1), (c * .8, 1), (c * .8, 1), (c, 2), (c * .6, 1), 0, 0]
        bands = [(r1, .10 * h), (r, .86 * h)]
        knurl = (r, .52 * h, .80 * h, 30)
        lens_r, lens_z, ring = rr, h - d, False
    else:               # wide hood: slim barrel, flared hood, front element deep inside
        rb = .74 * r; zh = .50 * h; t = .045 * r; rl = .82 * rb; zl = zh + .12 * h
        pts = [(0, 0), (rb, 0), (rb, zh), (rb + .10 * r, zh), (r, h), (r - t, h), (rl, zl), (0, zl)]
        rad = [0, (c, 1), (c * .6, 1), (c * .6, 1), (c, 2), (c * .5, 1), 0, 0]
        bands = [(rb, .04 * h), (rb, .40 * h)]
        knurl = (rb, .14 * h, .35 * h, 30)
        lens_r, lens_z, ring = rl, zl, False
    P.add(BODY, _lathe(_round(pts, rad), seg))
    kr, k0, k1, kn = knurl
    P.add(BODY, _ribbed(kr, .0035 * s, .0018 * s, k0, k1, kn))
    metal = BRASS if style == 2 else STEEL
    for br, z0 in bands: P.add(metal, _band(br, e, z0, z0 + bw, seg))
    gl = lens_r - (.004 * s if ring else 0)
    dz = .0045 * s
    P.add(LENS, _lathe([(0, lens_z + dz), (gl * .55, lens_z + dz * .72), (gl + .0003, lens_z)], seg, orient="z"))
    if ring:
        P.add(metal, _lathe([(gl - .0005, lens_z + .0004), (gl + .0012 * s, lens_z + .0026 * s), (lens_r + .0002, lens_z + .0026 * s)], seg, orient="z"))
    # Index mark: a small polished tab on the front (-Y) of the barrel, so yaw reads.
    zi = (bands[-1][1] + bw + h) / 2 if style == 0 else (bands[0][1] + bw + k0) / 2
    ri = bands[-1][0] if style == 0 else bands[0][0]
    P.add(metal, lib.rbox((.004 * s, .0016 * s, .006 * s), bevel=0, loc=(0, -ri, zi)))
    return P


def lens_canister(name, loc, col, r=0.09, h=0.22, style=0, yaw=0):
    """Camera-lens barrel standing on its base. style 0 short prime, 1 tall zoom,
    2 wide hood (brass bands), 3 plain steel tube. r and h are the bounding
    radius and height; zoom and tube read best with h >= 2.4 r."""
    return _canister(r, h, style % 4).transform(_place(loc, yaw)).build(name, col, loc)

# ------------------------------------------------------------------- books

def _cover_poly(hw, y0, yf, bt, ch, outer_lr, inner_rl):
    """C-shaped cover cross-section (XY): spine at y0, boards to the fore edge yf."""
    poly = list(outer_lr) + [(hw, yf - ch), (hw - ch, yf), (hw - bt, yf)] + list(inner_rl) + \
           [(-(hw - bt), yf), (-hw + ch, yf), (-hw, yf - ch)]
    return _ccw(poly)


def _book_parts(T, D, H, cover, bands=True, label=False):
    """A standing hardcover, base centre at the origin, spine facing -Y."""
    P = _Parts()
    hw, y0, yf = T / 2, -D / 2, D / 2
    bt = min(.0032, max(.0018, T * .07)); bulge = max(T * .2, bt * 2.2); ys = y0 + bulge
    ov = min(.0045, .016 * H); ch = bt * .45; na = 3
    ang = [math.pi * (1 - i / (2 * na)) for i in range(2 * na + 1)]          # pi -> 0
    outer = [(hw * math.cos(a), ys - bulge * math.sin(a)) for a in ang]
    inner = [((hw - bt) * math.cos(a), ys - (bulge - bt) * math.sin(a)) for a in reversed(ang)]
    P.add(cover, lib.prism(_cover_poly(hw, y0, yf, bt, ch, outer, inner), 0, H, bevel=min(.0009, bt * .3), bevel_segments=1))
    # Page block: follows the spine curve, recessed from the board edges, concave fore edge.
    g = .0004; pw = hw - bt - g
    pp = [(pw * math.cos(a), ys - (bulge - bt - g) * math.sin(a)) for a in ang]
    pp += [(pw, yf - ov), (0, yf - ov - min(.003, T * .08)), (-pw, yf - ov)]
    P.add("BOOK_Paper", lib.prism(_ccw(pp), ov, H - ov, bevel=.0006, bevel_segments=1))
    arc = [((hw + .0004) * math.cos(a), ys - (bulge + .0004) * math.sin(a)) for a in ang]
    if bands:
        bh = max(.0018, .008 * H)
        for zb in (.10 * H, .86 * H): P.add(BRASS, _strip(arc, zb, zb + bh, (0, ys)))
    if label:
        mid = [((hw + .0006) * math.cos(a), ys - (bulge + .0006) * math.sin(a)) for a in ang[1:-1]]
        lm = "BOOK_Paper" if cover == "BOOK_Cover_Cream" else "BOOK_Cover_Cream"
        P.add(lm, _strip(mid, .58 * H, .70 * H, (0, ys)))
    return P


def _lying(T, H):
    """Matrix laying a standing book (base centre at origin) flat, front board up."""
    return _T(H / 2, 0, T / 2) @ _Ry(-math.pi / 2)


def book(name, loc, yaw, col, size=(0.05, 0.22, 0.30), cover="BOOK_Cover_Teal", lying=False):
    """size = (thickness, depth, height) standing. Standing: spine faces -Y,
    footprint thickness x depth. lying=True: flat, footprint height (X) x depth (Y)."""
    T, D, H = size
    P = _book_parts(T, D, H, cover)
    m = _place(loc, yaw) @ (_lying(T, H) if lying else Matrix.Identity(4))
    return P.transform(m).build(name, col, loc)


def _pick(rng, prev, pool=COVERS):
    c = rng.choice(pool)
    while c == prev and len(pool) > 1: c = rng.choice(pool)
    return c


def book_row(name, start_xyz, yaw, length, col, heights=(0.24, 0.32), seed=0, lean=True):
    """Standing books along local +X from start_xyz. Spines align on the front
    line y = -0.37*max(heights) (local); start_xyz is on the row's depth
    centre-line. lean=True ends the row with one book leaning on the last."""
    rng = random.Random(seed); hmin, hmax = heights
    dmax = hmax * .74; front = -dmax / 2
    P = _Parts(); x = 0.0; prev = None; last = None
    reserve = .11 if lean else 0.0
    while True:
        T = rng.choice((rng.uniform(.018, .03), rng.uniform(.03, .048), rng.uniform(.045, .064)))
        if x + T > length - reserve: break
        H = rng.uniform(hmin, hmax); D = min(dmax, H * rng.uniform(.68, .76))
        cov = _pick(rng, prev); prev = cov
        b = _book_parts(T, D, H, cov, bands=rng.random() < .7, label=rng.random() < .3)
        b.transform(_T(x + T / 2, front + D / 2 + rng.uniform(0, .006), 0)); P.absorb(b)
        x += T + rng.uniform(.0003, .0016); last = (x, H)
    if lean and last:
        xr, Hp = last
        T = rng.uniform(.026, .045); H = max(rng.uniform(hmin, hmax), Hp * .92); D = min(dmax, H * .72)
        theta = math.radians(rng.uniform(11, 19))
        while theta > math.radians(5):
            bl = xr + min(Hp * math.tan(theta), H * math.sin(theta))
            if bl + T * math.cos(theta) <= length: break
            theta -= math.radians(1.5)
        else:
            bl = None
        if bl is not None:
            cov = _pick(rng, prev)
            b = _book_parts(T, D, H, cov, bands=True)
            b.transform(_T(bl, front + D / 2 + .003, 0) @ _Ry(-theta) @ _T(T / 2, 0, 0)); P.absorb(b)
    return P.transform(_place(start_xyz, yaw)).build(name, col, start_xyz)


def book_stack(name, loc, yaw, col, count=3, seed=0):
    """Books lying flat, largest at the bottom, spines facing -Y, small offsets."""
    rng = random.Random(seed * 7 + 3); P = _Parts(); z = 0.0; prev = None
    base = rng.uniform(.25, .30)
    for i in range(count):
        H = base * (1 - .05 * i) * rng.uniform(.95, 1.02); D = H * rng.uniform(.70, .76)
        T = rng.uniform(.022, .046); cov = _pick(rng, prev); prev = cov
        b = _book_parts(T, D, H, cov, bands=rng.random() < .75)
        b.transform(_T(rng.uniform(-.008, .008), rng.uniform(-.008, .008), z) @ _Rz(rng.uniform(-.06, .06)) @ _lying(T, H))
        P.absorb(b); z += T
    return P.transform(_place(loc, yaw)).build(name, col, loc)

# ----------------------------------------------------------------- binders

def _binder_parts(T, D, H, cover):
    """A lever-arch binder standing, base centre at origin, spine facing -Y."""
    P = _Parts()
    hw, y0, yf = T / 2, -D / 2, D / 2
    bt = .0026; rc = .0075; ri = rc - bt; ch = bt * .45
    def corner(cx, a0, a1, rad, k=2):
        return [(cx + rad * math.cos(a0 + (a1 - a0) * j / k), y0 + rc + rad * math.sin(a0 + (a1 - a0) * j / k)) for j in range(k + 1)]
    outer = corner(-hw + rc, math.pi, 1.5 * math.pi, rc) + corner(hw - rc, 1.5 * math.pi, 2 * math.pi, rc)
    inner = corner(hw - rc, 0, -.5 * math.pi, ri) + corner(-hw + rc, -.5 * math.pi, -math.pi, ri)
    P.add(cover, lib.prism(_cover_poly(hw, y0, yf, bt, ch, outer, inner), 0, H, bevel=.0008, bevel_segments=1))
    fill = (2 * (hw - bt) - .002) * .78
    x0 = -(hw - bt) + .0006
    P.add("BOOK_Paper", lib.rbox((fill, D - bt - .012, H - .014), bevel=.0012, segments=1,
                                  loc=(x0 + fill / 2, y0 + bt + .004 + (D - bt - .012) / 2, H / 2)))
    # Label window high on the spine.
    lw, lh = min(.052, T * .64), .15 * H
    g = lib.prism(lib.rrect(lw, lh, .003, seg=1), 0, .0008).transform(matrix=_T(0, y0, .70 * H) @ _Rx(math.pi / 2))
    P.add("CERAMIC_Pale", g)
    # Finger hole: dark disc inside a polished grommet, low on the spine.
    rh_i, rh_o, zf = .0098, .0128, .16 * H
    m = _T(0, y0, zf) @ _Rx(math.pi / 2)
    P.add(STEEL, _lathe([(rh_i, -.0012), (rh_i + .0008, .0012), (rh_o - .0008, .0012), (rh_o, -.0004)], 14, orient="z").transform(matrix=m))
    P.add("RUBBER_Black", _lathe([(0, .0003), (rh_i + .0004, .0003)], 14, orient="z").transform(matrix=m))
    return P


def binder_row(name, start_xyz, yaw, length, col, height=0.32, seed=0):
    """Lever-arch binders along local +X from start_xyz, spines facing -Y, depth
    0.285*height/0.32 centred on start_xyz's line."""
    rng = random.Random(seed * 13 + 5)
    pal = rng.sample(COVERS, 3); P = _Parts(); x = 0.0
    D = .285 * height / .32; cov = pal[0]; run = 0
    while True:
        T = .08 if rng.random() < .7 else .05
        if x + T > length: break
        if run <= 0: cov = rng.choice(pal); run = rng.randint(2, 4)
        run -= 1
        b = _binder_parts(T, D, height, cov)
        b.transform(_T(x + T / 2, rng.uniform(-.003, .003), 0)); P.absorb(b)
        x += T + rng.uniform(.0008, .0028)
    return P.transform(_place(start_xyz, yaw)).build(name, col, start_xyz)

# --------------------------------------------------------------- glassware

def jar(name, loc, col, r=0.06, h=0.14):
    """Lab jar with a metal screw lid; contents (amber granules, teal liquid or
    pale powder) and lid metal vary with the name."""
    hs = _hash(name); P = _Parts(); seg = 24
    s = r / .06; t = .0032 * s; rn = .80 * r; zsh, zn, hg = .74 * h, .84 * h, h - .004 * s
    c = .006 * s
    pts = [(0, 0), (r, 0), (r, zsh), (rn, zn), (rn, hg), (rn - t, hg), (rn - t, zn), (r - t, zsh + .01 * s), (r - t, t), (0, t)]
    rad = [0, (c, 1), (.016 * s, 2), (.004 * s, 1), 0, 0, 0, (.012 * s, 1), (c * .7, 1), 0]
    P.add("GLASS_Clear", _lathe(_round(pts, rad), seg))
    kind = hs % 3
    cm = ("CONTENTS_Amber", "LIQUID_Teal", "CONTENTS_Powder")[kind]
    fz = h * (.32 + .26 * ((hs >> 4) % 100) / 100)
    ri = r - t - .0003; mound = (.004, 0.0, .009)[kind] * s
    P.add(cm, _lathe(_round([(0, t + .0003), (ri, t + .0003), (ri, fz), (ri * .5, fz + mound), (0, fz + mound)],
                            [0, (c * .6, 1), 0, 0, 0]), seg))
    lm = (STEEL, BRASS)[(hs >> 2) % 2]
    rl = rn + .0032 * s; zl0 = zn + .006 * s; cl = .0028 * s
    P.add(lm, _lathe(_round([(0, zl0), (rl, zl0), (rl, h), (.82 * rl, h), (.80 * rl, h - .0012 * s), (0, h - .0012 * s)],
                            [0, (cl * .5, 1), (cl, 1), 0, 0, 0]), seg))
    return P.transform(_place(loc)).build(name, col, loc)


def flask(name, loc, col, h=0.22):
    """Erlenmeyer flask with a beaded lip and a little teal liquid."""
    P = _Parts(); seg = 24
    rb, rn = .29 * h, .105 * h; zs, zn = .66 * h, .76 * h; t = .012 * h; bead = .012 * h
    rs = rn * 1.25
    pts = [(0, 0), (rb, 0), (rs, zs), (rn, zn), (rn, h - .05 * h), (rn + bead, h - .03 * h), (rn + bead * .6, h),
           (rn - t, h), (rn - t, zn), (rs - t, zs), (rb - t * 1.3, t), (0, t)]
    rad = [0, (.045 * h, 2), (.06 * h, 2), (.03 * h, 1), (.005 * h, 1), (.008 * h, 1), (.006 * h, 1), (.004 * h, 1), 0, 0, (.02 * h, 1), 0]
    P.add("GLASS_Clear", _lathe(_round(pts, rad), seg))
    zf = .27 * h; ia, ib = Vector((rb - t * 1.3, t)), Vector((rs - t, zs))
    rf = ia.x + (ib.x - ia.x) * (zf - ia.y) / (ib.y - ia.y) - .0006
    P.add("LIQUID_Teal", _lathe(_round([(0, t + .0004), (rb - t * 1.3 - .0005, t + .0004), (rf, zf), (0, zf)],
                                      [0, (.016 * h, 1), (.002, 1), 0]), seg))
    return P.transform(_place(loc)).build(name, col, loc)

# -------------------------------------------------------------- pencil cup

def pencil_cup(name, loc, col):
    """Turned charcoal cup (r 0.036, h 0.098) holding seven sharpened pencils in a fan."""
    P = _Parts(); r, h, t = .036, .098, .0032; seg = 32
    g1, g2, gd = .014, .021, .0011
    pts = [(0, 0), (r, 0), (r, g1 - gd), (r - gd, g1), (r, g1 + gd), (r, g2 - gd), (r - gd, g2), (r, g2 + gd),
           (r, h), (r - t, h), (r - t, t), (0, t)]
    rad = [0, (.003, 2), 0, 0, 0, 0, 0, 0, (t * .5, 2), (t * .5, 2), (.003, 1), 0]
    P.add(BODY, _lathe(_round(pts, rad), seg))
    rng = random.Random(_hash(name)); n = 7
    mats = ("BOOK_Cover_Ochre", "BOOK_Cover_Teal", "BOOK_Cover_Ochre", BRASS, "BOOK_Cover_Teal", "BOOK_Cover_Ochre", BRASS)
    R, rg = .0037, .0011
    rin = r - t - R - .0008
    for i in range(n):
        phi = TAU * i / n + rng.uniform(-.25, .25)
        rho = rng.uniform(.006, .011)
        tmax = math.atan((rin - rho) / (h - t))
        th = tmax * rng.uniform(.55, .98)
        L = rng.uniform(.135, .185); Lc, Lg = .016, .0035; Lb = L - Lc - Lg
        d = Vector((math.sin(th) * math.cos(phi), math.sin(th) * math.sin(phi), math.cos(th)))
        m = _T(rho * math.cos(phi), rho * math.sin(phi), t + R * math.sin(th)) @ Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4() @ _Rz(rng.uniform(0, 1))
        P.add(mats[i], _lathe([(0, 0), (R, 0), (R, Lb), (0, Lb)], 6, smooth=45).transform(matrix=m))
        P.add("WOOD_Pencil", _lathe([(0, Lb), (R, Lb), (rg, Lb + Lc), (0, Lb + Lc)], 6, smooth=45).transform(matrix=m))
        P.add(BODY, _lathe([(0, Lb + Lc), (rg, Lb + Lc), (0, L)], 6, smooth=45).transform(matrix=m))
    return P.transform(_place(loc)).build(name, col, loc)

# --------------------------------------------------------- brass curios

def _gauge(P):
    """Pressure gauge on a turned pedestal, face toward -Y. Height ~0.20."""
    seg = 32
    pts = [(0, 0), (.040, 0), (.040, .009), (.031, .012), (.029, .018), (.0075, .018), (.0075, .021), (0, .021)]
    rad = [0, (.002, 2), (.002, 1), (.002, 1), (.0015, 2), (.001, 1), (.0008, 1), 0]
    P.add(BODY, _lathe(_round(pts, rad), seg))
    P.add(STEEL, lib.cyl(.0052, .086, bevel=.001, segments=16, z0=.018))
    P.add(BRASS, _band(.0052, .0022, .026, .034, 16))
    P.add(BRASS, _lathe(_round([(0, .102), (.0078, .102), (.0078, .110), (0, .110)], [0, (.0008, 1), (.0008, 1), 0]), 6, smooth=30))
    P.add(BRASS, lib.cyl(.0042, .010, bevel=.0006, segments=12, z0=.109))
    Rc, zc = .040, .118 + .040
    case = [(0, 0), (Rc - .002, 0), (Rc, .014), (Rc + .0022, .016), (Rc + .0022, .022), (Rc - .0035, .0245), (Rc - .0055, .021), (0, .021)]
    crad = [0, (.003, 2), (.001, 1), (.001, 1), (.0012, 2), (.0012, 1), (.0008, 1), 0]
    zf = .0212; Rf = Rc - .0055
    face = lambda g: g.transform(matrix=_T(0, .012, zc) @ _Rx(math.pi / 2))
    P.add(BRASS, face(_lathe(_round(case, crad), seg)))
    P.add("CERAMIC_Pale", face(_lathe([(0, zf), (Rf, zf)], seg, orient="z")))
    P.add("GLASS_Clear", face(_lathe([(0, zf + .0042), (Rf * .6, zf + .0032), (Rf + .0004, zf + .0012)], seg, orient="z")))
    # Ticks across a 270-degree scale.
    tk = Geo()
    for i in range(21):
        a = math.radians(225 - 270 * i / 20); major = i % 5 == 0
        r0, r1, w = (Rf - .0075 if major else Rf - .005), Rf - .0022, (.0009 if major else .0005)
        ca, sa = math.cos(a), math.sin(a); px, py = -sa * w / 2, ca * w / 2
        tk.merge(_quad((r0 * ca - px, r0 * sa - py, zf + .0002), (r1 * ca - px, r1 * sa - py, zf + .0002),
                       (r1 * ca + px, r1 * sa + py, zf + .0002), (r0 * ca + px, r0 * sa + py, zf + .0002)))
    P.add(BODY, face(_orient(tk, "z")))
    P.add(BODY, face(lib.cyl(.0028, .0016, bevel=.0005, segments=12, z0=zf)))
    a = math.radians(48)
    nd = [(-.0011, -.006), (.0011, -.006), (.00035, .029), (-.00035, .029)]
    nd = [(x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)) for x, y in nd]
    P.add("BOOK_Cover_Rust", face(lib.prism(_ccw(nd), zf + .0012, zf + .0018)))


def _telescope(P):
    """Small brass telescope on a charcoal tripod, pointing along +X, tilted up."""
    seg = 28; zh = .118
    for k in range(3):
        a = math.radians(90 + 120 * k); foot = Vector((.072 * math.cos(a), .072 * math.sin(a), .003))
        top = Vector((.010 * math.cos(a), .010 * math.sin(a), zh - .004))
        P.add(BODY, lib.tube([foot, top], .0026, n=8))
        P.add(BRASS, lib.tube([foot - (top - foot).normalized() * .002, foot + (top - foot).normalized() * .012], .0033, n=8))
    P.add(BODY, _lathe(_round([(0, zh - .010), (.014, zh - .010), (.014, zh), (0, zh)], [0, (.0015, 1), (.0015, 2), 0]), 20))
    P.add(STEEL, lib.cyl(.0035, .014, bevel=.0006, segments=12, z0=zh))
    tilt = math.radians(16); L = .19; zc = zh + .03
    m = _T(0, 0, zc) @ _Ry(math.pi / 2 - tilt) @ _T(0, 0, -.42 * L)
    # profile from the eyepiece end (z=0) to the objective (z=L)
    eye = [(0, 0), (.0068, 0), (.0068, .020), (0, .020)]
    P.add(BODY, _lathe(_round(eye, [0, (.0016, 2), (.0008, 1), 0]), 20).transform(matrix=m))
    draw = [(0, .018), (.0088, .018), (.0088, .052), (0, .052)]
    P.add(STEEL, _lathe(_round(draw, [0, (.0008, 1), (.0006, 1), 0]), 24).transform(matrix=m))
    tube = [(0, .050), (.0125, .050), (.0125, .060), (.0108, .062), (.0108, .140), (.0138, .143), (.0138, L), (.0118, L), (.0118, L - .008), (0, L - .008)]
    trad = [0, (.0015, 2), (.0012, 1), (.0008, 1), (.0008, 1), (.0012, 1), (.0012, 2), (.0006, 1), 0, 0]
    P.add(BRASS, _lathe(_round(tube, trad), seg).transform(matrix=m))
    P.add(STEEL, _band(.0108, .0018, .092, .102, seg).transform(matrix=m))
    P.add(LENS, _lathe([(0, L - .008 + .0035), (.0072, L - .008 + .0026), (.0119, L - .008)], seg, orient="z").transform(matrix=m))
    # cradle: a steel stem from the head into a ring clamp around the tube
    P.add(STEEL, lib.cyl(.0028, zc - zh - .012, bevel=0, segments=10, z0=zh + .012))


def brass_instrument(name, loc, col, kind=0, yaw=0):
    """Shelf curio. kind 0: pressure gauge on a turned stand (face -Y, footprint
    r 0.04, height ~0.20). kind 1: small brass telescope on a tripod (footprint
    r ~0.075, height ~0.20, points +X)."""
    P = _Parts()
    (_gauge if kind % 2 == 0 else _telescope)(P)
    return P.transform(_place(loc, yaw)).build(name, col, loc)

# ---------------------------------------------------------------- notebook

def notebook(name, loc, yaw, col):
    """Closed A5 lab notebook lying flat (0.152 x 0.214 x 0.017), spine on -X,
    with an elastic band and a pale label; cover colour varies with the name."""
    hs = _hash(name); P = _Parts()
    cover = ("BOOK_Cover_Slate", "BOOK_Cover_Teal", "BOOK_Cover_Rust")[hs % 3]
    w, d, t, bt, rc = .150, .214, .017, .0019, .007
    x0, x1, y0, y1 = -w / 2, w / 2, -d / 2, d / 2
    def board_poly(inset=0.0, xs=x0):
        pts = [(xs, y0 + inset)]
        for cx, cy, a0 in ((x1 - inset - rc, y0 + inset + rc, -math.pi / 2), (x1 - inset - rc, y1 - inset - rc, 0)):
            pts += [(cx + rc * math.cos(a0 + math.pi / 4 * j), cy + rc * math.sin(a0 + math.pi / 4 * j)) for j in range(3)]
        pts.append((xs, y1 - inset))
        return _ccw(pts)
    for z0 in (0.0, t - bt):
        P.add(cover, lib.prism(board_poly(), z0, z0 + bt, bevel=.0006, bevel_segments=1))
    # rounded spine: a half-tube joining the boards along -X
    R = t / 2; arc_o = [(x0 + .002 - R * math.sin(math.pi * j / 4), R - R * math.cos(math.pi * j / 4)) for j in range(5)]
    arc_i = [(x0 + .002 - (R - bt) * math.sin(math.pi * j / 4), R - (R - bt) * math.cos(math.pi * j / 4)) for j in range(5)]
    sp = _ccw(arc_o + list(reversed(arc_i)))
    P.add(cover, lib.prism(sp, y0, y1).transform(matrix=_Rx(math.pi / 2)))
    P.add("BOOK_Paper", lib.prism(board_poly(.0022, x0 + .0015), bt, t - bt))
    # elastic band wrapped over both boards near the fore edge
    xb = x1 - .022; e = .0006
    path = [Vector((xb, y, z)) for y, z in reversed(lib.rrect(d + 2 * e, t + 2 * e, .002, seg=2))]
    path = [Vector((xb, p.y, p.z + t / 2)) for p in path]
    P.add("RUBBER_Black", lib.sweep(path, [(-.003, -.0004), (.003, -.0004), (.003, .0004), (-.003, .0004)], closed_path=True))
    lab = lib.prism(lib.rrect(.064, .030, .003, seg=1), t, t + .0005)
    P.add("BOOK_Cover_Cream", lab.transform(matrix=_T(-.008, .042, 0)))
    return P.transform(_place(loc, yaw)).build(name, col, loc)
