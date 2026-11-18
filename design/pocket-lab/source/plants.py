"""Procedural plants for the pocket laboratory.

    floor_plant      an olive-like floor bush in a speckled concrete cylinder
    desk_plant       a small eucalyptus-like desk plant in a white glazed pot on a saucer
    trailing_plant   a pothos whose vines spill over a shelf edge and hang down

Each builder takes the pot base centre `loc` on its supporting surface, builds
in world coordinates (objects at the origin) and returns its objects: the pot,
the soil, the stems and one leaf object per leaf material. Everything is
deterministic for a given seed.

Leaves and stems are accumulated as raw vertex lists (Buf) and turned into one
mesh per material at the end, so a 450-leaf bush costs a handful of objects.
"""
import bpy, bmesh, math, random
from mathutils import Vector, Matrix
import lib

TAU = math.tau
UP = Vector((0.0, 0.0, 1.0))
FRONT = Vector((0.0, -1.0, 0.0))
LEAF_MATS = ("PLANT_Leaf", "PLANT_Leaf_Light", "PLANT_Leaf_Dark")
LEAVES_FLOOR = 470          # target leaf count of the floor bush (spacing adapts to the branch run)


# ------------------------------------------------------------------ buffers

class Buf:
    """Raw vertices, faces and per-loop UVs, finished into a lib.Geo in one
    step (Geo.merge round-trips a mesh per part, too slow for 450 leaves)."""
    def __init__(self):
        self.v, self.f, self.uv = [], [], []

    def verts(self, pts):
        i0 = len(self.v); self.v.extend((p[0], p[1], p[2]) for p in pts); return i0

    def face(self, idx, uvs):
        self.f.append(tuple(idx)); self.uv.append(uvs)

    @property
    def tris(self): return sum(len(f) - 2 for f in self.f)

    def geo(self, smooth=True):
        me = bpy.data.meshes.new("_buf")
        me.from_pydata(self.v, [], self.f)
        lay = me.uv_layers.new(name="UVMap")
        lay.data.foreach_set("uv", [c for fu in self.uv for u in fu for c in u])
        bm = bmesh.new(); bm.from_mesh(me); bpy.data.meshes.remove(me)
        for f in bm.faces: f.smooth = smooth
        return lib.Geo(bm)


def _finish(bufs, name, col):
    """One object per non-empty material buffer."""
    out = []
    suffix = {"PLANT_Leaf": "Leaves", "PLANT_Leaf_Light": "Leaves_Light", "PLANT_Leaf_Dark": "Leaves_Dark",
              "PLANT_Stem": "Stems", "SOIL_Dark": "Soil"}
    for m, b in bufs.items():
        if b.f: out.append(b.geo().obj(f"{name}_{suffix.get(m, m)}", m, col, wn=False))
    return out


# -------------------------------------------------------------- frames, paths

def _perp(t):
    a = Vector((1.0, 0.0, 0.0)) if abs(t.x) < .9 else Vector((0.0, 1.0, 0.0))
    return (a - t * a.dot(t)).normalized()


def _frames(P):
    """Unit tangents and parallel-transported normals along a polyline."""
    m = len(P); T = []
    for i in range(m):
        d = P[min(m - 1, i + 1)] - P[max(0, i - 1)]
        T.append(d.normalized() if d.length > 1e-9 else (T[-1] if T else UP.copy()))
    N = [_perp(T[0])]
    for i in range(1, m):
        n = T[i - 1].rotation_difference(T[i]) @ N[-1]
        n = n - T[i] * n.dot(T[i])
        N.append(n.normalized() if n.length > 1e-9 else _perp(T[i]))
    return T, N


def _arclen(P):
    s = [0.0]
    for i in range(1, len(P)): s.append(s[-1] + (P[i] - P[i - 1]).length)
    return s


def _at(P, s):
    p, t = lib.point_at(P, s); return Vector(p), Vector(t).normalized()


def _grow(rng, p0, d0, length, step, wander, up=0.0, out=0.0, droop=0.0, axis=None):
    """A wandering growth path: low-frequency noise plus phototropism (up),
    a push away from the plant axis (out) and gravity on long shoots (droop)."""
    n = max(2, int(round(length / step))); st = length / n
    p = Vector(p0); d = Vector(d0).normalized(); pts = [p.copy()]
    w = Vector((0.0, 0.0, 0.0))
    for i in range(n):
        w = w * .55 + Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))) * wander
        bias = UP * up
        if axis is not None and out:
            r = p - axis; r.z = 0
            if r.length > 1e-6: bias = bias + r.normalized() * out
        bias = bias - UP * (droop * (i + 1) / n)
        d = (d + w + bias).normalized()
        p = p + d * st; pts.append(p.copy())
    return pts


def _smooth(pts, step=.025):
    return [Vector(p) for p in lib.resample(lib.catmull(pts, per=5), step)]


def _side(t, phi, bias=None, k=0.0):
    """A unit vector perpendicular to t at azimuth phi, optionally pulled toward bias."""
    n1 = _perp(t); n2 = t.cross(n1)
    s = n1 * math.cos(phi) + n2 * math.sin(phi)
    if bias is not None and k:
        s = s + bias * k; s = s - t * s.dot(t)
        if s.length < 1e-6: s = n1
    return s.normalized()


def _radial(p, axis):
    r = Vector((p.x - axis.x, p.y - axis.y, 0.0))
    return r.normalized() if r.length > 1e-6 else Vector((1.0, 0.0, 0.0))


# -------------------------------------------------------------- primitives

def tube_into(buf, P, radii, n, cap=True, wobble=0.0, rng=None):
    """A tapered tube along P with one ring per point; outward-facing quads,
    a pointed end cap. wobble roughens the bark (a fraction of the radius)."""
    P = [Vector(p) for p in P]; T, N = _frames(P); S = _arclen(P)
    ph = [rng.uniform(0, TAU) for _ in range(2)] if (wobble and rng) else (0.0, 0.0)
    rings = []
    for i, p in enumerate(P):
        B = T[i].cross(N[i]); ring = []
        for j in range(n):
            a = TAU * j / n; r = radii[i]
            if wobble:
                r *= 1 + wobble * (.6 * math.sin(3 * a + ph[0] + 9 * S[i]) + .4 * math.sin(5 * a + ph[1] - 14 * S[i]))
            ring.append(p + (N[i] * math.cos(a) + B * math.sin(a)) * r)
        rings.append(buf.verts(ring))
    for i in range(len(P) - 1):
        a, b = rings[i], rings[i + 1]
        for j in range(n):
            j2 = (j + 1) % n; u0, u1 = j / n, (j + 1) / n
            buf.face((a + j, a + j2, b + j2, b + j), ((u0, S[i]), (u1, S[i]), (u1, S[i + 1]), (u0, S[i + 1])))
    if cap:
        tip = buf.verts([P[-1] + T[-1] * radii[-1] * .8]); a = rings[-1]
        for j in range(n):
            buf.face((a + j, a + (j + 1) % n, tip), ((j / n, S[-1]), ((j + 1) / n, S[-1]), ((j + .5) / n, S[-1] + radii[-1])))


def taper(P, r0, r1, power=.85):
    S = _arclen(P); L = S[-1] or 1.0
    return [r0 + (r1 - r0) * (s / L) ** power for s in S]


def _width(shape, t):
    if shape == "lance": return math.sin(math.pi * t ** .85) ** .75     # olive, willow: cuneate base, long point
    if shape == "ovate": return math.sin(math.pi * t ** .66) ** .62     # broadest near the base, acute tip
    return math.sin(math.pi * t)


ROWS = {"lance": (0.0, .1, .24, .4, .57, .74, .89),
        "ovate": (0.0, .1, .27, .47, .67, .85),
        "heart": (0.0, .05, .12, .21, .32, .44, .57, .7, .82, .92)}


def _heart(t):
    """Pothos half-width: rounded basal lobes, broad shoulders, drawn-out tip."""
    if t <= .24: return .5 + .5 * math.sin(math.pi / 2 * t / .24)
    return math.cos(math.pi / 2 * (t - .24) / .76) ** .9


def blade_into(buf, M, L, W, shape="lance", cols=(-1.0, 0.0, 1.0), fold=.4, cup=0.0, rise=.1, curl=.3,
               bend=0.0, twist=0.0, pet=0.0, pet_w=.003, lobe=0.0):
    """A leaf blade in frame M: x along the blade from the petiole end, y across,
    z the upper face. The blade is V-folded along the midrib (fold), cupped
    (cup), rises then droops along its length (rise, curl), swings sideways
    (bend) and twists about the midrib (twist). pet adds a flat petiole strip."""
    tot = pet + L
    def put(x, s, w, t):
        zc = L * (rise * t - curl * t * t)
        y0 = s * w; dz = fold * abs(s) * w + cup * s * s * w
        a = twist * t; ca, sa = math.cos(a), math.sin(a)
        y = y0 * ca - dz * sa + bend * L * t * t; z = zc + y0 * sa + dz * ca
        return M @ Vector((x, y, z))
    rows, rv = [], []
    if pet > 0:
        rows.append([M @ Vector((0.0, s * pet_w * .5, 0.0)) for s in cols]); rv.append(0.0)
    for i, t in enumerate(ROWS[shape]):
        w = max(W * .5 * (_heart(t) if shape == "heart" else _width(shape, t)), pet_w * .5)
        rows.append([put(pet + L * t - lobe * L * abs(s) ** .7 * (1 - t) ** 3, s, w, t) for s in cols])
        rv.append((pet + L * t) / tot)
    idx = [buf.verts(r) for r in rows]
    tip = buf.verts([put(pet + L, 0.0, 0.0, 1.0)])
    nc = len(cols); uv = [c * .5 + .5 for c in cols]
    for k in range(len(rows) - 1):
        a, b = idx[k], idx[k + 1]
        for c in range(nc - 1):
            buf.face((a + c, b + c, b + c + 1, a + c + 1),
                     ((rv[k], uv[c]), (rv[k + 1], uv[c]), (rv[k + 1], uv[c + 1]), (rv[k], uv[c + 1])))
    a = idx[-1]
    for c in range(nc - 1):
        buf.face((a + c, tip, a + c + 1), ((rv[-1], uv[c]), (1.0, .5), (rv[-1], uv[c + 1])))


def leaf_frame(p, d, face, roll=0.0):
    """A matrix whose x is the blade direction d and whose z is as close to
    `face` as d allows, rolled about d."""
    d = Vector(d).normalized(); face = Vector(face)
    n = face - d * face.dot(d)
    n = n.normalized() if n.length > 1e-6 else _perp(d)
    y = n.cross(d)
    if roll:
        c, s = math.cos(roll), math.sin(roll)
        y, n = y * c + n * s, n * c - y * s
    return Matrix(((d.x, y.x, n.x, p[0]), (d.y, y.y, n.y, p[1]), (d.z, y.z, n.z, p[2]), (0, 0, 0, 1)))


def _pick(rng, light=0.0):
    r = rng.random() + light
    return "PLANT_Leaf_Dark" if r < .3 else ("PLANT_Leaf" if r < .8 else "PLANT_Leaf_Light")


# --------------------------------------------------------------------- pots

def _arc2(cx, cz, r, a0, a1, n):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cz + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def pot_profile(Rb, Rt, H, wall, lip, soil_depth, foot=None, recess=.008):
    """Lathe profile of a pot: recessed underside, rounded heel, straight
    tapered wall, a rolled lip proud of the wall, the inner wall down to
    below the soil line. Returns (profile, inner radius at the soil, soil z)."""
    rc = foot or min(.012, H * .08)
    pr = [(0.0, recess), (Rb - rc - .022, recess), (Rb - rc - .012, 0.0)]
    pr += _arc2(Rb - rc, rc, rc, -90, 0, 4)[1:]
    zt = H - 2.3 * lip
    for f in (.35, .7, 1.0):
        z = rc + (zt - rc) * f; pr.append((Rb + (Rt - Rb) * (z / H), z))
    cx = Rt - .6 * lip
    pr += _arc2(cx, H - lip, lip, -55, 90, 7)
    Ri = Rt - wall; ri = min(.006, wall * .3)
    pr += _arc2(Ri + ri, H - ri, ri, 90, 180, 3)[0:]
    sz = H - soil_depth
    pr += [(Ri - wall * .04, H - min(.05, soil_depth * .7)), (Ri - wall * .08, sz - .015)]
    return pr, Ri - wall * .07, sz


def _soil(rng, buf, c, r, z, mound=.008, n=40, rough=.003):
    """A gently mounded, uneven soil disc whose rim tucks into the pot wall."""
    rings = (.22, .45, .66, .84, .95, 1.0)
    ph = [rng.uniform(0, TAU) for _ in range(3)]
    ctr = buf.verts([(c.x, c.y, z + mound)])
    idx = []
    for f in rings:
        ring = []
        for j in range(n):
            a = TAU * j / n
            h = mound * (1 - f * f) + rough * (.5 * math.sin(3 * a + ph[0] + 6 * f) + .3 * math.sin(7 * a + ph[1] - 11 * f)
                                               + .2 * math.sin(13 * a + ph[2] + 19 * f)) * min(1.0, 3 * (1 - f) + .2)
            h += rng.uniform(-.35, .35) * rough if f < 1 else 0
            ring.append((c.x + r * f * math.cos(a), c.y + r * f * math.sin(a), z + h))
        idx.append(buf.verts(ring))
    uv = lambda f, a: (.5 + .5 * f * math.cos(a), .5 + .5 * f * math.sin(a))
    for j in range(n):
        a0, a1 = TAU * j / n, TAU * (j + 1) / n
        buf.face((ctr, idx[0] + j, idx[0] + (j + 1) % n), ((.5, .5), uv(rings[0], a0), uv(rings[0], a1)))
    for k in range(len(rings) - 1):
        a, b = idx[k], idx[k + 1]
        for j in range(n):
            j2 = (j + 1) % n; a0, a1 = TAU * j / n, TAU * (j + 1) / n
            buf.face((a + j, b + j, b + j2, a + j2), (uv(rings[k], a0), uv(rings[k + 1], a0), uv(rings[k + 1], a1), uv(rings[k], a1)))


def _lathe_obj(profile, segments, O, name, material, col):
    return lib.lathe(profile, segments=segments, smooth=50).transform(loc=O).obj(name, material, col)


# ------------------------------------------------------------- floor plant

def _olive_structure(rng, O, soil_z, k):
    """Branches (dicts) of an olive-like multi-stem bush: a short trunk, 4-5
    main stems in a vase, secondaries that turn outward and twigs on those."""
    br = []
    lean = Vector((rng.gauss(0, .06), rng.gauss(0, .06), 1.0)).normalized()
    base = O + Vector((0, 0, soil_z - .05))
    trunk = _smooth(_grow(rng, base, lean, .17 * k, .05, .025), .03)
    br.append(dict(P=trunk, r0=.028, r1=.021, n=10, lvl=0, wob=.07))
    top = trunk[-1]; tdir = (trunk[-1] - trunk[-2]).normalized()
    nm = rng.choice((5, 5, 6)); a0 = rng.uniform(0, TAU)
    for i in range(nm):
        az = a0 + TAU * i / nm + rng.gauss(0, .2)
        tilt = .12 if i == 0 else rng.uniform(.46, .78)
        d = Vector((math.sin(tilt) * math.cos(az), math.sin(tilt) * math.sin(az), math.cos(tilt)))
        L = (.9 if i == 0 else rng.uniform(.62, .84)) * k
        P = _smooth(_grow(rng, top - tdir * .03, d, L, .08, .06, up=.045, out=.01, axis=O), .035)
        L = _arclen(P)[-1]
        br.append(dict(P=P, r0=.016 if i else .018, r1=.003, n=7, lvl=1, leaf_from=.26 * L, wob=.04))
        ns = rng.randint(4, 6); phi = rng.uniform(0, TAU)
        for j in range(ns):
            f = .2 + .72 * (j + rng.uniform(.25, .75)) / ns
            p, t = _at(P, f * L)
            phi += math.pi + rng.gauss(0, .55)
            S = _side(t, phi, _radial(p, O), .9)
            beta = rng.uniform(.6, 1.0)
            d2 = t * math.cos(beta) + S * math.sin(beta)
            Lc = rng.uniform(.28, .44) * k * (1.25 - .65 * f)
            Pc = _smooth(_grow(rng, p - d2 * .006, d2, Lc, .06, .08, up=.05, out=.02, droop=.03 + .09 * (1 - f), axis=O), .03)
            Lc = _arclen(Pc)[-1]
            rp = .016 + (.003 - .016) * f ** .85
            br.append(dict(P=Pc, r0=min(.008, rp * .78), r1=.002, n=5, lvl=2, leaf_from=.06 * Lc))
            for _ in range(rng.choice((1, 1, 2, 2))):
                f2 = rng.uniform(.3, .8); q, t2 = _at(Pc, f2 * Lc)
                S2 = _side(t2, rng.uniform(0, TAU), _radial(q, O) + UP * .3, .6)
                b2 = rng.uniform(.6, 1.0); d3 = t2 * math.cos(b2) + S2 * math.sin(b2)
                Lt = rng.uniform(.08, .17) * k
                Pt = _smooth(_grow(rng, q - d3 * .003, d3, Lt, .04, .08, up=.06, droop=.04), .028)
                br.append(dict(P=Pt, r0=.0034, r1=.0015, n=4, lvl=3, leaf_from=0.0))
    return br


def _fit_width(br, O, half_width, z0):
    """Scale branch points horizontally about the plant axis so the canopy's
    widest stem reaches half_width (the trunk barely moves)."""
    pts = [p for b in br[1:] for p in b["P"]]
    r = sorted(math.hypot(p.x - O.x, p.y - O.y) for p in pts)
    rmax = r[int(len(r) * .985)]
    f = half_width / max(.05, rmax)
    for b in br:
        for p in b["P"]:
            w = max(0.0, min(1.0, (p.z - z0) / .25))
            g = 1 + (f - 1) * w
            p.x = O.x + (p.x - O.x) * g; p.y = O.y + (p.y - O.y) * g


def _olive_leaves(rng, b, O, top_z, out, sp=.027):
    """Alternate lanceolate leaves along the outer part of a branch, splayed
    up and out, older ones drooping, a small terminal tuft at the tip."""
    P = b["P"]; L = _arclen(P)[-1]; s = b["leaf_from"] + rng.uniform(0, .02)
    phi = rng.uniform(0, TAU); rad = taper(P, b["r0"], b["r1"])
    def one(p, t, phi, youth, alpha_scale=1.0, size=1.0):
        rd = _radial(p, O)
        S = _side(t, phi)
        alpha = (.32 + .5 * youth) * alpha_scale + rng.gauss(0, .1)
        d = t * math.cos(alpha) + S * math.sin(alpha)
        d.z -= rng.uniform(.0, .3) * youth
        Ll = rng.uniform(.09, .15) * (.62 + .38 * youth) * size
        Wl = Ll * rng.uniform(.26, .33)
        face = UP + rd * .35 + S * .25
        hz = max(0.0, min(1.0, (p.z - O.z) / max(.1, top_z - O.z)))
        M = leaf_frame(p + S * .002, d, face, rng.gauss(0, .3))
        out.append((M, Ll, Wl, dict(shape="lance", fold=rng.uniform(.28, .5), rise=.08, curl=rng.uniform(.1, .32) * (.4 + .6 * youth),
                                    bend=rng.gauss(0, .07), twist=rng.gauss(0, .3), pet=.007, pet_w=.0028),
                    _pick(rng, .25 * (1 - youth) + .15 * hz - .1)))
    while s < L - .014:
        p, t = _at(P, s)
        youth = min(1.0, (L - s) / .17)
        phi += math.pi + rng.gauss(0, .45)
        one(p, t, phi, youth)
        s += sp * rng.uniform(.8, 1.2)
    p, t = _at(P, L - .004)
    one(p, t, phi + 1.3, 0.05, .3, .75); one(p, t, phi + 1.3 + math.pi, 0.1, .5, .65)


def floor_plant(name, loc, col, height=1.55, seed=7):
    """An olive-like floor bush, `height` m tall overall, in a speckled
    concrete cylinder (r .27, h .55). loc is the pot base centre."""
    rng = random.Random(seed); O = Vector(loc)
    R, H = .27, .55
    prof, r_soil, soil_z = pot_profile(R - .006, R, H, wall=.028, lip=.015, soil_depth=.05)
    pot = lib.lathe(prof, segments=56, smooth=50).transform(loc=O)
    soil = Buf(); _soil(rng, soil, O, r_soil + .002, O.z + soil_z, mound=.014, n=48, rough=.006)
    objs = [pot.obj(f"{name}_Pot", "POT_Concrete", col)]
    # two passes: size the structure so the canopy top lands at `height`
    k = (height - H) / 1.0
    for _ in range(2):
        r2 = random.Random(seed * 7919 + 1)
        br = _olive_structure(r2, O, soil_z, k)
        _fit_width(br, O, .5, O.z + soil_z + .16)
        leaves = []
        top = max(p.z for b in br for p in b["P"]) + .06
        leafy = [b for b in br if b["lvl"] >= 1]
        run = sum(max(0.0, _arclen(b["P"])[-1] - b["leaf_from"] - .014) for b in leafy)
        sp = run / max(60, LEAVES_FLOOR - 2 * len(leafy))
        for b in leafy: _olive_leaves(r2, b, O, top, leaves, sp)
        reach = max(p.z for b in br for p in b["P"]) + .07 - O.z
        k *= (height - H) / max(.2, reach - H)
    bufs = {m: Buf() for m in ("PLANT_Stem",) + LEAF_MATS}
    for b in br:
        tube_into(bufs["PLANT_Stem"], b["P"], taper(b["P"], b["r0"], b["r1"]), b["n"], cap=b["lvl"] > 0,
                  wobble=b.get("wob", 0.0), rng=r2)
    for M, Ll, Wl, kw, m in leaves:
        blade_into(bufs[m], M, Ll, Wl, **kw)
    objs.append(soil.geo().obj(f"{name}_Soil", "SOIL_Dark", col, wn=False))
    objs += _finish(bufs, name, col)
    print(f"[plants] {name}: {len(br)} branches, {len(leaves)} leaves")
    return objs


# -------------------------------------------------------------- desk plant

def desk_plant(name, loc, col, height=.55, seed=3):
    """A small bushy eucalyptus-like plant (opposite pairs of ovate leaves on
    slender arching stems) in a white glazed pot on a saucer."""
    rng = random.Random(seed); O = Vector(loc)
    sau = [(0.0, .0065), (.108, .0065), (.116, 0.0)] + _arc2(.128, .006, .006, -90, -5, 3) + \
          [(.1355, .016)] + _arc2(.1325, .0185, .003, 0, 180, 4) + [(.1275, .011)] + _arc2(.121, .0115, .004, -10, -90, 2)[1:] + [(0.0, .0075)]
    sau = [p for i, p in enumerate(sau) if i == 0 or (abs(p[0] - sau[i - 1][0]) + abs(p[1] - sau[i - 1][1])) > 1e-5]
    H = .155
    prof, r_soil, soil_z = pot_profile(.104, .118, H, wall=.011, lip=.0055, soil_depth=.022, foot=.008, recess=.005)
    pot = lib.lathe(prof, segments=36, smooth=50).transform(loc=O + Vector((0, 0, .0075)))
    pot.merge(lib.lathe(sau, segments=36, smooth=50).transform(loc=O))
    objs = [pot.obj(f"{name}_Pot", "POT_Ceramic", col)]
    sz = O.z + .0075 + soil_z
    soil = Buf(); _soil(rng, soil, O, r_soil + .0015, sz, mound=.006, n=36, rough=.0025)
    objs.append(soil.geo().obj(f"{name}_Soil", "SOIL_Dark", col, wn=False))
    bufs = {m: Buf() for m in ("PLANT_Stem",) + LEAF_MATS}
    hf = O.z + height - sz
    nst = 10; br = []
    for i in range(nst):
        a = i * 2.39996 + rng.uniform(-.3, .3); rr = .012 + .05 * math.sqrt((i + .5) / nst)
        base = O + Vector((rr * math.cos(a), rr * math.sin(a), sz - O.z - .015))
        rd = _radial(base, O)
        tilt = .08 + .55 * (rr / .062) + rng.gauss(0, .07)
        d = rd * math.sin(tilt) + UP * math.cos(tilt)
        L = hf * rng.uniform(.78, 1.0) * (1.08 - .3 * rr / .062)
        P = _smooth(_grow(rng, base, d, L, .05, .07, up=.035, out=.02, droop=.03 * (rr / .062), axis=O), .034)
        br.append((P, .0036, .0012, 0.14))
        for _ in range(rng.choice((0, 0, 1, 1, 2))):
            Lp = _arclen(P)[-1]; f = rng.uniform(.35, .65); q, t = _at(P, f * Lp)
            S = _side(t, rng.uniform(0, TAU), _radial(q, O) + UP * .2, .8)
            bb = rng.uniform(.5, .8); d2 = t * math.cos(bb) + S * math.sin(bb)
            Pc = _smooth(_grow(rng, q - d2 * .003, d2, (1 - f) * Lp * rng.uniform(.45, .7), .04, .07, up=.04, droop=.02), .03)
            br.append((Pc, .0024, .0011, 0.05))
    nleaf = 0
    for P, r0, r1, lf in br:
        tube_into(bufs["PLANT_Stem"], P, taper(P, r0, r1), 5 if r0 > .003 else 4, cap=True)
        L = _arclen(P)[-1]; s = lf * L + rng.uniform(0, .015); phi = rng.uniform(0, TAU)
        while s < L - .008:
            p, t = _at(P, s); youth = min(1.0, (L - s) / .12)
            phi += math.pi / 2 + rng.gauss(0, .2)
            for side in (0.0, math.pi):
                S = _side(t, phi + side + rng.gauss(0, .12))
                al = (.45 + .65 * youth) + rng.gauss(0, .12)
                d = t * math.cos(al) + S * math.sin(al); d.z -= .25 * youth * rng.random()
                Ll = rng.uniform(.042, .064) * (.45 + .55 * youth); Wl = Ll * rng.uniform(.5, .6)
                M = leaf_frame(p + S * .0015, d, UP + _radial(p, O) * .3 + S * .2, rng.gauss(0, .25))
                blade_into(bufs[_pick(rng, .3 * (1 - youth) - .05)], M, Ll, Wl, shape="ovate", fold=rng.uniform(.25, .4),
                           rise=.1, curl=rng.uniform(.15, .35) * (.4 + .6 * youth), bend=rng.gauss(0, .06),
                           twist=rng.gauss(0, .25), pet=.004, pet_w=.0022)
                nleaf += 1
            s += rng.uniform(.033, .04)
        p, t = _at(P, L - .002)
        M = leaf_frame(p, t, UP + _radial(p, O) * .3, rng.gauss(0, .4))
        blade_into(bufs["PLANT_Leaf_Light"], M, .02, .011, shape="ovate", fold=.5, curl=.05, pet=.002); nleaf += 1
    objs += _finish(bufs, name, col)
    print(f"[plants] {name}: {len(br)} stems, {nleaf} leaves")
    return objs


# ---------------------------------------------------------- trailing plant

def trailing_plant(name, loc, col, seed=5):
    """A pothos in a small white pot: a crown of upright leaves and vines that
    run forward over the shelf edge (0.15 m in front of loc, -Y) and hang
    0.4-0.6 m below it, leaves turned to face the room."""
    rng = random.Random(seed); O = Vector(loc)
    H = .118
    prof, r_soil, soil_z = pot_profile(.074, .088, H, wall=.009, lip=.005, soil_depth=.016, foot=.007, recess=.005)
    objs = [_lathe_obj(prof, 36, O, f"{name}_Pot", "POT_Ceramic", col)]
    sz = O.z + soil_z
    soil = Buf(); _soil(rng, soil, O, r_soil + .0015, sz, mound=.006, n=32, rough=.0025)
    objs.append(soil.geo().obj(f"{name}_Soil", "SOIL_Dark", col, wn=False))
    bufs = {m: Buf() for m in LEAF_MATS}
    vine = bufs["PLANT_Leaf_Dark"]
    edge_y = O.y - .15
    nleaf = 0

    def pothos_leaf(p, Pd, plen, D, face, size, light=0.0):
        nonlocal nleaf
        q = p + Pd * plen
        mid = (p + q) * .5 + UP * plen * .12
        tube_into(vine, [p, mid, q], (.0019, .0017, .0014), 4, cap=False)
        Ll = size; Wl = Ll * rng.uniform(.76, .84)
        M = leaf_frame(q - Vector(D).normalized() * .002, D, face, rng.gauss(0, .2))
        blade_into(bufs[_pick(rng, light)], M, Ll, Wl, shape="heart", cols=(-1.0, -.5, 0.0, .5, 1.0),
                   fold=rng.uniform(.22, .32), cup=rng.uniform(-.34, -.18), rise=.08, curl=rng.uniform(.16, .36),
                   bend=rng.gauss(0, .08), twist=rng.gauss(0, .22), lobe=.13)
        nleaf += 1

    # hanging vines: x offset at the edge, drop below the edge
    hang = [(-.19, .5), (-.08, .36), (.0, .6), (.1, .44), (.21, .54)]
    rng.shuffle(hang)
    for ox, drop in hang:
        ox += rng.uniform(-.02, .02); drop *= rng.uniform(.92, 1.08)
        sx, sy = rng.uniform(-.03, .03), rng.uniform(-.035, .0)
        rim = .088
        ctrl = [Vector((sx, sy, soil_z - .01)), Vector((sx * .6 + ox * .2, -.05, H + .028)),
                Vector((ox * .45, -rim - .008, H + .012)), Vector((ox * .75, -.128, .028)),
                Vector((ox * .95, -.1545, .0055)), Vector((ox + rng.uniform(-.02, .02), -.172, -.07)),
                Vector((ox + rng.uniform(-.05, .05), rng.uniform(-.2, -.18), -drop * .5)),
                Vector((ox + rng.uniform(-.07, .07), rng.uniform(-.23, -.19), -drop * .86))]
        tipd = Vector((rng.uniform(-.5, .5), -1.0, .6)).normalized()
        ctrl.append(ctrl[-1] + Vector((0, 0, -drop * .1)) + tipd * .035)
        P = _smooth([O + c for c in ctrl], .028)
        tube_into(vine, P, taper(P, .0034, .0021), 5, cap=True)
        L = _arclen(P)[-1]; s = .11 + rng.uniform(0, .03); side = rng.choice((-1, 1))
        while s < L - .02:
            p, t = _at(P, s); youth = min(1.0, (L - s) / .25)
            side = -side
            size = rng.uniform(.055, .1) * (.5 + .5 * youth)
            if t.z < -.55:      # hanging: the leaf stands off the vine and faces the room, each at its own yaw
                yaw = rng.gauss(0, .45) + side * .35
                S = Vector((side, 0, 0))
                fr = Vector((math.sin(yaw), -math.cos(yaw), 0.0))
                Pd = (S * .5 + fr * .75 + UP * rng.uniform(.15, .45)).normalized()
                D = (-UP * rng.uniform(.5, .85) + fr * rng.uniform(.3, .6) + S * rng.uniform(.15, .45)).normalized()
                face = fr + UP * rng.uniform(.2, .6) + S * .15
            else:               # on the rim and shelf: leaves lie up and out
                S = t.cross(UP); S = (S.normalized() if S.length > 1e-4 else Vector((1, 0, 0))) * side
                Pd = (S * .6 + UP * .55 + FRONT * .2).normalized()
                D = (S * .55 + t * .45 + FRONT * .25 + UP * .05).normalized()
                face = UP + FRONT * .35
            pothos_leaf(p + S * .002, Pd, rng.uniform(.022, .038), D, face, size, .25 * (1 - youth) - .14)
            s += rng.uniform(.058, .078)

    # crown: short stalks arching out of the soil, leaves turned up and out
    ncrown = 9
    for i in range(ncrown):
        a = i * 2.39996 + rng.uniform(-.3, .3) + 4.2; rr = rng.uniform(.005, .05)
        p0 = O + Vector((rr * math.cos(a), rr * math.sin(a), soil_z - .01))
        rd = _radial(p0, O); rd = (rd + FRONT * .35).normalized()
        hgt = rng.uniform(.05, .13); out = rng.uniform(.03, .08)
        P = _smooth([p0, p0 + UP * hgt * .6 + rd * out * .2, p0 + UP * hgt + rd * out], .015)
        tube_into(vine, P, taper(P, .0026, .0018), 4, cap=False)
        q, t = _at(P, _arclen(P)[-1])
        D = (rd * .75 + UP * .35 + t * .2).normalized()
        M_face = UP * .8 + rd * .35 + FRONT * .2
        pothos_leaf(q, t, .004, D, M_face, rng.uniform(.075, .1), .05)
    objs += _finish(bufs, name, col)
    print(f"[plants] {name}: {len(hang)} vines, {nleaf} leaves")
    return objs
