"""Shared modelling kit for the reward-lens pocket laboratory.

Blender units are metres, Z is up and the room faces -Y: the camera stands in
front of the room at negative Y, looking toward +Y. Blender (x, y, z) exports
to glTF/Three as (x, z, -y).

Everything is built with bmesh rather than operators, so a full room builds in
seconds and every mesh carries UVs in metres for tiling textures. The pieces:

    Geo                 a bmesh wrapper: transform, merge, smooth, uv, obj()
    rbox, cyl, lathe    rounded boxes and surfaces of revolution
    loft, sweep, tube   skin point loops; sweep a 2D profile along a 3D path
    prism, slab         extrude a 2D outline; a grid-topology slab between curves
    leaf                a folded, curled leaf blade
    mat                 the shared material library (names are the runtime's contract)
    bake_vertex_ao      Cycles AO into a per-vertex colour layer named "AO"
    render_preview      a quick Cycles GPU still of some objects, for review
    export_glb          glTF binary export with the AO layer as COLOR_0

Conventions: room meshes are built in world coordinates with their object at
the origin, so a module's numbers are the room's numbers. Every builder returns
a Geo; call .obj(name, material) to turn it into a scene object.
"""
import bpy, bmesh, math, os, random
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
DESIGN = os.path.dirname(HERE)
TEXTURES = os.path.join(DESIGN, "textures")
RAW = os.path.join(DESIGN, "raw")
PREVIEWS = os.path.join(DESIGN, "previews")
TAU = math.tau

# --------------------------------------------------------------------- scene

def reset():
    """Empty the file: objects, meshes, materials, images, collections."""
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves,
                  bpy.data.lights, bpy.data.cameras, bpy.data.node_groups):
        for item in list(block): block.remove(item)
    for c in list(bpy.data.collections): bpy.data.collections.remove(c)
    if bpy.context.scene.world is None:
        bpy.context.scene.world = bpy.data.worlds.new("World")
    _MATERIALS.clear()

def collection(name):
    """Get or create a collection linked under the scene root."""
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c

def empty(name, loc, col=None, parent=None, kind="PLAIN_AXES", size=.2):
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = kind; o.empty_display_size = size
    o.location = Vector(loc)
    (col or bpy.context.scene.collection).objects.link(o)
    if parent is not None: o.parent = parent
    return o

# ------------------------------------------------------------------ colours

def srgb(h):
    """sRGB hex to a linear RGBA tuple."""
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in c) + (1.0,)

# ---------------------------------------------------------------- materials
#
# The runtime finds materials by these names, so they are a contract. Values
# are sRGB hex, PBR metal/rough, optional emission and alpha. A texture entry
# names files in design/pocket-lab/textures; missing files are skipped so a
# module can be previewed before the texture set exists.

SPECS = {
    # architecture
    "MARBLE_Floor":        dict(color="#D9DEDC", rough=.30, tex=dict(base="marble_base.png")),
    "CERAMIC_Pale":        dict(color="#C9D2CF", rough=.42),
    "PETROL_Painted":      dict(color="#245967", rough=.62),
    "PETROL_Trim":         dict(color="#2F6B78", rough=.50),
    "PETROL_Deep":         dict(color="#17434C", rough=.70),
    # metals
    "ALUMINIUM_Brushed":   dict(color="#C3CACC", metal=1, rough=.34, tex=dict(rough="brushed_rough.png", normal="brushed_normal.png", normal_strength=.35)),
    "STEEL_Polished":      dict(color="#DDE2E4", metal=1, rough=.13),
    "BRASS_Restrained":    dict(color="#CFAA62", metal=1, rough=.28),
    "CHARCOAL_Instrument": dict(color="#1B2124", metal=.45, rough=.32),
    "OPTICAL_TABLE_Top":   dict(color="#C8CED0", metal=1, rough=.38, tex=dict(base="optical_holes_base.png", rough="brushed_rough.png", normal="optical_holes_normal.png", normal_strength=.6)),
    # soft goods and props
    "RUBBER_Black":        dict(color="#141719", rough=.78),
    "TEAL_Upholstery":     dict(color="#2A6E78", rough=.58),
    "POT_Concrete":        dict(color="#A9AEAC", rough=.86, tex=dict(base="concrete_base.png")),
    "POT_Ceramic":         dict(color="#E8EBE9", rough=.34),
    "SOIL_Dark":           dict(color="#2E261E", rough=.95),
    "PLANT_Leaf":          dict(color="#4C6B38", rough=.52, double=True),
    "PLANT_Leaf_Light":    dict(color="#6E8A4A", rough=.52, double=True),
    "PLANT_Leaf_Dark":     dict(color="#34502A", rough=.55, double=True),
    "PLANT_Stem":          dict(color="#5B4B36", rough=.8),
    "BOOK_Cover_Teal":     dict(color="#2B6873", rough=.6),
    "BOOK_Cover_Ochre":    dict(color="#B88C4C", rough=.62),
    "BOOK_Cover_Cream":    dict(color="#E2DCCC", rough=.6),
    "BOOK_Cover_Slate":    dict(color="#4B5662", rough=.6),
    "BOOK_Cover_Rust":     dict(color="#9A5A3E", rough=.62),
    "BOOK_Paper":          dict(color="#EEE9DB", rough=.7),
    "GLASS_Clear":         dict(color="#DCEDEA", rough=.06, alpha=.28, double=True),
    # light and imagery
    "APRICOT_Task_Light":  dict(color="#F2C48A", rough=.3, emit=3.0),
    "DISPLAY_Lightbox":    dict(color="#E4F1EA", rough=.4, emit=1.0, tex=dict(base="display_atlas.png", emit="display_atlas.png")),
    "PRINT_Art":           dict(color="#FFFFFF", rough=.55, tex=dict(base="print_lens.png")),
    # optics
    "PRISM_Glass":         dict(color="#CFEDE6", rough=.04, alpha=.42, double=True),
    "SPECIMEN_Glass":      dict(color="#BFE3DA", rough=.08, alpha=.30, double=True),
    "SPECIMEN_Glass_Edge": dict(color="#A9D6CC", rough=.12, emit=.15),
    "SPECIMEN_Pattern":    dict(color="#FFFFFF", rough=.15, alpha=.9, double=True, tex=dict(base="specimen_pattern.png", alpha="specimen_pattern.png")),
}
_MATERIALS = {}

def _image(name, non_color=False):
    path = os.path.join(TEXTURES, name)
    if not os.path.exists(path): return None
    img = bpy.data.images.get(name) or bpy.data.images.load(path, check_existing=True)
    if non_color: img.colorspace_settings.name = "Non-Color"
    return img

def mat(name):
    """The shared material called `name`, created from SPECS on first use."""
    if name in _MATERIALS: return _MATERIALS[name]
    if name not in SPECS: raise KeyError(f"unknown material {name}; add it to lib.SPECS")
    s = SPECS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    b = nodes["Principled BSDF"]
    col = srgb(s["color"])
    b.inputs["Base Color"].default_value = col; m.diffuse_color = col
    b.inputs["Metallic"].default_value = s.get("metal", 0)
    b.inputs["Roughness"].default_value = s.get("rough", .5)
    if s.get("emit"):
        b.inputs["Emission Color"].default_value = col
        b.inputs["Emission Strength"].default_value = s["emit"]
    if s.get("alpha", 1) < 1:
        b.inputs["Alpha"].default_value = s["alpha"]
        m.surface_render_method = "BLENDED"
    m.use_backface_culling = not s.get("double", False)
    t = s.get("tex", {})
    if t.get("base") and (img := _image(t["base"])):
        n = nodes.new("ShaderNodeTexImage"); n.image = img
        links.new(n.outputs["Color"], b.inputs["Base Color"])
        if t.get("emit"): links.new(n.outputs["Color"], b.inputs["Emission Color"])
        if t.get("alpha"): links.new(n.outputs["Alpha"], b.inputs["Alpha"])
    if t.get("rough") and (img := _image(t["rough"], True)):
        n = nodes.new("ShaderNodeTexImage"); n.image = img
        links.new(n.outputs["Color"], b.inputs["Roughness"])
    if t.get("normal") and (img := _image(t["normal"], True)):
        n = nodes.new("ShaderNodeTexImage"); n.image = img
        nm = nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = t.get("normal_strength", .5)
        links.new(n.outputs["Color"], nm.inputs["Color"]); links.new(nm.outputs["Normal"], b.inputs["Normal"])
    _MATERIALS[name] = m
    return m

# ---------------------------------------------------------------------- Geo

def _matrix(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    if isinstance(scale, (int, float)): scale = (scale, scale, scale)
    return Matrix.LocRotScale(Vector(loc), Euler(rot).to_quaternion(), Vector(scale))

class Geo:
    """A bmesh under construction. Methods return self so calls chain."""
    def __init__(self, bm=None):
        self.bm = bm or bmesh.new()
        self.uv = self.bm.loops.layers.uv.verify()

    def transform(self, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), matrix=None):
        m = matrix if matrix is not None else _matrix(loc, rot, scale)
        bmesh.ops.transform(self.bm, matrix=m, verts=self.bm.verts)
        if m.determinant() < 0: bmesh.ops.reverse_faces(self.bm, faces=self.bm.faces)
        self.bm.normal_update(); return self

    def merge(self, *others):
        """Append other Geos (consumed) into this one, UVs included."""
        for other in others:
            tmp = bpy.data.meshes.new("_merge"); other.bm.to_mesh(tmp); other.bm.free()
            self.bm.from_mesh(tmp); bpy.data.meshes.remove(tmp)
        self.uv = self.bm.loops.layers.uv.verify(); return self

    def copy(self):
        return Geo(self.bm.copy())

    def weld(self, dist=1e-5):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=dist); return self

    def fix_normals(self):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces); return self

    def smooth(self, angle=60.0):
        """Smooth shading with sharp edges where faces meet beyond `angle` degrees."""
        lim = math.radians(angle); self.bm.normal_update()
        for f in self.bm.faces: f.smooth = True
        for e in self.bm.edges:
            if len(e.link_faces) == 2:
                e.smooth = e.link_faces[0].normal.angle(e.link_faces[1].normal, 0) <= lim
            else:
                e.smooth = False
        return self

    def flat(self):
        for f in self.bm.faces: f.smooth = False
        return self

    def uv_box(self, scale=1.0, offset=(0, 0, 0)):
        """Box-project UVs in metres (divided by `scale`), by each face's dominant axis."""
        o = Vector(offset)
        for f in self.bm.faces:
            n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                c = l.vert.co + o
                u, v = ((c.y, c.z), (c.x, c.z), (c.x, c.y))[ax]
                if (ax == 0 and n.x < 0) or (ax == 1 and n.y > 0): u = -u
                l[self.uv].uv = (u / scale, v / scale)
        return self

    def subdivide(self, cuts=1):
        bmesh.ops.subdivide_edges(self.bm, edges=self.bm.edges, cuts=cuts, use_grid_fill=True); return self

    def triangulate(self):
        bmesh.ops.triangulate(self.bm, faces=self.bm.faces, quad_method="BEAUTY", ngon_method="BEAUTY"); return self

    def obj(self, name, material, col=None, parent=None, origin=None, wn=True):
        """Finish into a scene object with one material. origin: pivot point
        (world). wn adds a face-area Weighted Normal modifier so large flat
        faces stay flat beside rounded bevels instead of shading like pillows."""
        me = bpy.data.meshes.new(name)
        if origin is not None:
            bmesh.ops.translate(self.bm, vec=-Vector(origin), verts=self.bm.verts)
        self.bm.to_mesh(me); self.bm.free()
        me.materials.append(mat(material) if isinstance(material, str) else material)
        o = bpy.data.objects.new(name, me)
        (col or bpy.context.scene.collection).objects.link(o)
        if wn:
            m = o.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL"); m.mode = "FACE_AREA"; m.weight = 100; m.keep_sharp = True
        if origin is not None: o.location = Vector(origin)
        if parent is not None:
            o.parent = parent; o.matrix_parent_inverse = parent.matrix_world.inverted()
        return o

    @property
    def verts(self): return len(self.bm.verts)

# --------------------------------------------------------------- 2D shapes

def circle(r, n=24, a0=0.0):
    return [(r * math.cos(a0 + TAU * i / n), r * math.sin(a0 + TAU * i / n)) for i in range(n)]

def rrect(w, h, r, seg=4):
    """A rounded rectangle centred on the origin, counter-clockwise."""
    r = min(r, w / 2 - 1e-4, h / 2 - 1e-4)
    if r <= 1e-4: return [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    pts = []
    for cx, cy, a in ((w / 2 - r, -h / 2 + r, -math.pi / 2), (w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, math.pi / 2), (-w / 2 + r, -h / 2 + r, math.pi)):
        for i in range(seg + 1):
            t = a + (math.pi / 2) * i / seg
            pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    return pts

def offset_polygon(poly, d):
    """Offset a closed CCW polygon outward by d (negative: inward), mitred."""
    n = len(poly); out = []
    for i in range(n):
        p0, p1, p2 = Vector(poly[i - 1]), Vector(poly[i]), Vector(poly[(i + 1) % n])
        e0 = (p1 - p0).normalized(); e1 = (p2 - p1).normalized()
        n0 = Vector((e0.y, -e0.x)); n1 = Vector((e1.y, -e1.x))
        m = (n0 + n1); m = m.normalized() if m.length > 1e-6 else n0
        s = 1 / max(.25, m.dot(n0))
        q = p1 + m * d * s; out.append((q.x, q.y))
    return out

# -------------------------------------------------------------------- paths

def arc(center, r, a0, a1, n, z=None):
    """Points on a circle (or ellipse with r=(rx, ry)) from angle a0 to a1, inclusive."""
    rx, ry = (r, r) if isinstance(r, (int, float)) else r
    cz = center[2] if len(center) > 2 else 0.0
    return [Vector((center[0] + rx * math.cos(a0 + (a1 - a0) * i / n), center[1] + ry * math.sin(a0 + (a1 - a0) * i / n), cz if z is None else z)) for i in range(n + 1)]

def catmull(points, per=8, closed=False):
    """A Catmull-Rom curve through `points` (3D), `per` samples per span."""
    P = [Vector(p) for p in points]; out = []
    spans = len(P) if closed else len(P) - 1
    for i in range(spans):
        p0 = P[(i - 1) % len(P)] if closed or i > 0 else P[0]
        p1 = P[i % len(P)]; p2 = P[(i + 1) % len(P)]
        p3 = P[(i + 2) % len(P)] if closed or i + 2 < len(P) else P[-1]
        for k in range(per):
            t = k / per; t2 = t * t; t3 = t2 * t
            out.append(.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed: out.append(P[-1].copy())
    return out

def path_length(path):
    return sum((Vector(path[i]) - Vector(path[i - 1])).length for i in range(1, len(path)))

def resample(path, step):
    """Resample a polyline to roughly uniform spacing `step`."""
    P = [Vector(p) for p in path]; L = path_length(P)
    n = max(1, round(L / step)); out = []; seg = 0; acc = 0.0
    lens = [(P[i + 1] - P[i]).length for i in range(len(P) - 1)]
    for k in range(n + 1):
        target = L * k / n
        while seg < len(lens) - 1 and acc + lens[seg] < target: acc += lens[seg]; seg += 1
        t = 0 if lens[seg] == 0 else min(1, max(0, (target - acc) / lens[seg]))
        out.append(P[seg].lerp(P[seg + 1], t))
    return out

def point_at(path, s):
    """Point and unit tangent at arc length s along a polyline."""
    P = [Vector(p) for p in path]; acc = 0.0
    for i in range(len(P) - 1):
        d = (P[i + 1] - P[i]).length
        if acc + d >= s or i == len(P) - 2:
            t = 0 if d == 0 else min(1, max(0, (s - acc) / d))
            return P[i].lerp(P[i + 1], t), (P[i + 1] - P[i]).normalized()
        acc += d

# ------------------------------------------------------------------ builders

def loft(sections, closed_sections=True, closed_loop=False, cap=True, smooth=60.0):
    """Skin point loops into quads. All sections have the same point count.

    closed_sections: each section is a closed ring (a tube); else an open strip.
    closed_loop: the last section joins the first (a full revolution).
    cap: fill the end sections of a closed-section, open-loop loft.
    UVs: u along each section, v along the loft, both in metres.
    """
    g = Geo(); bm = g.bm; uv = g.uv
    S = [[Vector(p) for p in s] for s in sections]
    n, k = len(S), len(S[0])
    V = [[bm.verts.new(p) for p in s] for s in S]
    U = []
    for s in S:
        acc = [0.0]
        for j in range(1, k): acc.append(acc[-1] + (s[j] - s[j - 1]).length)
        acc.append(acc[-1] + (s[0] - s[-1]).length)
        U.append(acc)
    W = [0.0]
    for i in range(1, n + (1 if closed_loop else 0)):
        a, b = S[i - 1], S[i % n]
        W.append(W[-1] + sum((b[j] - a[j]).length for j in range(k)) / k)
    for i in range(n if closed_loop else n - 1):
        i2 = (i + 1) % n
        for j in range(k if closed_sections else k - 1):
            j2 = (j + 1) % k
            quad = [V[i][j], V[i2][j], V[i2][j2], V[i][j2]]
            try: f = bm.faces.new(quad)
            except ValueError: continue
            for l, (uu, vv) in zip(f.loops, ((U[i][j], W[i]), (U[i2][j], W[i + 1]), (U[i2][j + 1], W[i + 1]), (U[i][j + 1], W[i]))):
                l[uv].uv = (uu, vv)
    caps = []
    if cap and closed_sections and not closed_loop:
        for ring in (V[0], V[-1]):
            try: caps.append(bm.faces.new(ring))
            except ValueError: pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    caps = [f for f in caps if f.is_valid]
    if caps:
        caps = bmesh.ops.triangulate(bm, faces=caps, quad_method="BEAUTY", ngon_method="BEAUTY")["faces"]
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _box_uv_faces([f for f in caps if f.is_valid], uv)
    if smooth: g.smooth(smooth)
    return g

def _box_uv_faces(faces, uv, scale=1.0):
    for f in faces:
        n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            c = l.vert.co; u, v = ((c.y, c.z), (c.x, c.z), (c.x, c.y))[ax]
            l[uv].uv = (u / scale, v / scale)

def lathe(profile, segments=32, smooth=60.0, angle=TAU, closed_profile=False):
    """Revolve a (radius, z) profile about Z. List the profile bottom to top;
    radius 0 at an end closes it to a pole. A full turn is a closed loop."""
    full = abs(angle - TAU) < 1e-6
    count = segments if full else segments + 1
    sections = []
    for i in range(count):
        a = angle * i / segments; c, s = math.cos(a), math.sin(a)
        sections.append([(r * c, r * s, z) for r, z in profile])
    return loft(sections, closed_sections=closed_profile, closed_loop=full, cap=False, smooth=smooth)

def cyl(r, h, bevel=0.0, segments=24, z0=0.0, smooth=60.0):
    """A solid cylinder from z0 to z0+h with optionally rounded rims."""
    b = min(bevel, r * .45, h * .45)
    if b <= 0: prof = [(0, z0), (r, z0), (r, z0 + h), (0, z0 + h)]
    else:
        prof = [(0, z0)]
        for i in range(4): t = -math.pi / 2 + (math.pi / 2) * i / 3; prof.append((r - b + b * math.cos(t), z0 + b + b * math.sin(t)))
        for i in range(4): t = (math.pi / 2) * i / 3; prof.append((r - b + b * math.cos(t), z0 + h - b + b * math.sin(t)))
        prof.append((0, z0 + h))
    return lathe(prof, segments, smooth)

def rbox(size, bevel=0.02, segments=2, loc=(0, 0, 0), rot=(0, 0, 0), uv_scale=1.0):
    """A box of `size` (x, y, z) centred at loc, edges rounded by `bevel`."""
    g = Geo(); bm = g.bm
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    b = min(bevel, min(size) * .45)
    if b > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=b, offset_type="OFFSET", segments=segments, profile=.5, affect="EDGES", clamp_overlap=True)
    g.uv_box(uv_scale).smooth(60.0)
    return g.transform(loc, rot)

def sweep(path, profile, closed_path=False, up=(0, 0, 1), cap=True, smooth=60.0, twist=0.0, scales=None):
    """Sweep a 2D profile [(x, y)] along a 3D path. Profile x runs along the
    path's side (binormal), profile y along its up-normal. Frames are parallel-
    transported from `up`, so a horizontal path keeps profile y vertical."""
    P = [Vector(p) for p in path]; m = len(P)
    T = []
    for i in range(m):
        a = P[i - 1] if (closed_path or i > 0) else P[i]
        b = P[(i + 1) % m] if (closed_path or i < m - 1) else P[i]
        t = b - a; T.append(t.normalized() if t.length > 1e-9 else Vector((1, 0, 0)))
    U = Vector(up); N = U - T[0] * U.dot(T[0])
    N = N.normalized() if N.length > 1e-6 else T[0].orthogonal().normalized()
    frames = []
    for i in range(m):
        if i:
            N = T[i - 1].rotation_difference(T[i]) @ N
            N = (N - T[i] * N.dot(T[i])).normalized()
        B = T[i].cross(N)
        if twist:
            a = twist * i / max(1, m - 1); N2 = N * math.cos(a) + B * math.sin(a); B = T[i].cross(N2); Nf = N2
        else: Nf = N
        frames.append((Nf, B))
    secs = []
    for i in range(m):
        Nf, B = frames[i]; s = scales[i] if scales else 1.0
        secs.append([P[i] + B * (x * s) + Nf * (y * s) for x, y in profile])
    return loft(secs, closed_sections=True, closed_loop=closed_path, cap=cap, smooth=smooth)

def tube(path, r, n=12, cap=True, closed_path=False, smooth=60.0):
    return sweep(path, circle(r, n), closed_path=closed_path, cap=cap, smooth=smooth)

def prism(poly, z0, z1, bevel=0.0, bevel_segments=2):
    """Extrude a closed CCW 2D outline from z0 to z1; a positive bevel rounds
    the top and bottom rims (the outline is the outer silhouette)."""
    b = min(bevel, (z1 - z0) * .45)
    if b <= 0:
        secs = [[(x, y, z0) for x, y in poly], [(x, y, z1) for x, y in poly]]
    else:
        secs = []
        for i in range(bevel_segments + 1):
            t = math.pi / 2 * i / bevel_segments
            secs.append([(x, y, z0 + b - b * math.cos(t)) for x, y in offset_polygon(poly, -b + b * math.sin(t))])
        for i in range(bevel_segments + 1):
            t = math.pi / 2 * i / bevel_segments
            secs.append([(x, y, z1 - b + b * math.sin(t)) for x, y in offset_polygon(poly, -b * (1 - math.cos(t)))])
    return loft(secs, closed_sections=True, cap=True, smooth=60.0)

def slab(back, front, z_top, thickness, rows=6, nose=.05, nose_segments=3):
    """A walkable slab between two polylines of equal point count (back edge,
    front edge), with grid topology for vertex AO and a rounded front nose.
    Each cross-section runs back -> front along the top, rounds the nose,
    returns along the underside and closes up the back face."""
    secs = []
    r = min(nose, thickness * .5)
    for b, f in zip(back, front):
        b = Vector(b); f = Vector(f); d = f - b; d.z = 0
        d = d.normalized() if d.length > 1e-6 else Vector((0, -1, 0))
        end = f - d * r
        ring = [Vector((p.x, p.y, z_top)) for p in (b.lerp(end, i / rows) for i in range(rows + 1))]
        for i in range(1, nose_segments + 1):
            t = math.pi / 2 * (1 - i / nose_segments)
            q = end + d * (r * math.cos(t)); ring.append(Vector((q.x, q.y, z_top - r + r * math.sin(t))))
        for i in range(nose_segments + 1):
            t = -math.pi / 2 * i / nose_segments
            q = end + d * (r * math.cos(t)); ring.append(Vector((q.x, q.y, z_top - thickness + r + r * math.sin(t))))
        ring += [Vector((p.x, p.y, z_top - thickness)) for p in (b.lerp(end, i / rows) for i in range(rows - 1, -1, -1))]
        secs.append(ring)
    return loft(secs, closed_sections=True, cap=True, smooth=60.0)

def leaf(length, width, fold=.35, curl=.25, twist=0.0, segs=6):
    """A leaf blade along +X from the origin (the petiole end), width in Y,
    folded along the midrib and curled downward. Double-sided material."""
    g = Geo(); bm = g.bm; uv = g.uv
    rows = []
    for i in range(segs + 1):
        t = i / segs
        w = width * .5 * (math.sin(math.pi * min(1, t * 1.08)) ** .75) * (1 - .15 * t)
        x = length * t; zc = -curl * length * t * t
        ring = []
        for j, s in enumerate((-1, 0, 1)):
            y = s * w; z = zc + abs(s) * w * fold
            ang = twist * t; yy = y * math.cos(ang) - (z - zc) * math.sin(ang); zz = zc + y * math.sin(ang) + (z - zc) * math.cos(ang)
            ring.append(bm.verts.new((x, yy, zz)))
        rows.append(ring)
    for i in range(segs):
        for j in range(2):
            q = [rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]]
            try: f = bm.faces.new(q)
            except ValueError: continue
            for l in f.loops: l[uv].uv = (l.vert.co.x / length, (l.vert.co.y / width) + .5)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-7)
    for f in bm.faces: f.smooth = True
    for e in bm.edges: e.smooth = True
    return g

# ------------------------------------------------------------ baking, render

def setup_cycles(samples=64):
    sc = bpy.context.scene; sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind; prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == kind]
            if gpus:
                for d in prefs.devices: d.use = d.type == kind
                sc.cycles.device = "GPU"; break
        except Exception:
            continue
    sc.cycles.samples = samples
    return sc

def bake_vertex_ao(objects, samples=128, distance=.9):
    """Bake Cycles ambient occlusion into each object's "AO" colour layer
    (point domain, linear grey). The layer exports as COLOR_0; the runtime
    reads it as occlusion, never as albedo."""
    sc = setup_cycles(samples)
    sc.world.light_settings.distance = distance
    sc.render.bake.target = "VERTEX_COLORS"
    meshes = [o for o in objects if o.type == "MESH" and len(o.data.vertices)]
    for o in meshes:
        me = o.data
        a = me.color_attributes.get("AO") or me.color_attributes.new("AO", "BYTE_COLOR", "POINT")
        me.color_attributes.active_color = a; me.attributes.active_color = a
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
    return meshes

def world_bounds(objects):
    lo = Vector((1e9, 1e9, 1e9)); hi = -lo
    for o in objects:
        if o.type not in {"MESH", "CURVE"}: continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi

def render_preview(path, objects=None, direction=(.55, -.82, .42), size=(1100, 800), samples=48, fov=30.0, background="#C9DCD9", margin=1.08, lamps=True):
    """Render a quick Cycles GPU still of `objects` (default: every mesh),
    framed from `direction`, to `path`. Temporary camera and lights are
    removed afterwards so they never reach an export."""
    sc = setup_cycles(samples)
    objs = objects or [o for o in sc.objects if o.type == "MESH"]
    hidden = [o for o in sc.objects if o.type == "MESH" and o not in objs and not o.hide_render]
    for o in hidden: o.hide_render = True
    lo, hi = world_bounds(objs); c = (lo + hi) / 2; rad = max(.05, (hi - lo).length / 2)
    d = Vector(direction).normalized(); dist = rad / math.sin(math.radians(fov) / 2) * margin
    cam_data = bpy.data.cameras.new("_preview_cam"); cam_data.lens_unit = "FOV"; cam_data.angle = math.radians(fov)
    cam = bpy.data.objects.new("_preview_cam", cam_data); sc.collection.objects.link(cam)
    cam.location = c + d * dist; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    extra = []
    if lamps:
        for name, off, energy, size_, colr in (("_key", (-.6, -.7, .9), 900, 3.0, (1, .96, .9)), ("_fill", (.9, -.4, .3), 250, 4.0, (.85, .93, 1)), ("_rim", (.2, .9, .8), 300, 2.0, (1, 1, 1))):
            ld = bpy.data.lights.new(name, "AREA"); ld.energy = energy * (rad / 2) ** 2; ld.size = size_ * rad / 2; ld.color = colr
            lo_ = bpy.data.objects.new(name, ld); sc.collection.objects.link(lo_)
            lo_.location = c + Vector(off).normalized() * dist * .8
            lo_.rotation_euler = (c - lo_.location).to_track_quat("-Z", "Y").to_euler(); extra.append(lo_)
    w = sc.world; w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    if bg: bg.inputs["Color"].default_value = srgb(background); bg.inputs["Strength"].default_value = .7
    sc.render.resolution_x, sc.render.resolution_y = size; sc.render.resolution_percentage = 100
    sc.render.film_transparent = False; sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"
    sc.render.image_settings.file_format = "PNG"; sc.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    for o in extra: bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    for o in hidden: o.hide_render = False
    return path

def export_glb(path, objects=None, vertex_colors=True):
    """Export to GLB. With `objects`, only those (and their children) go out."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    if objects is not None:
        for o in objects: o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=objects is not None,
        export_yup=True, export_cameras=False, export_lights=False, export_apply=True,
        export_materials="EXPORT", export_extras=True, export_tangents=False,
        export_vertex_color="NAME" if vertex_colors else "NONE", export_vertex_color_name="AO",
        export_all_vertex_colors=False, export_image_format="AUTO",
    )
    return path

def stats(objects=None):
    objs = objects or [o for o in bpy.context.scene.objects if o.type == "MESH"]
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == "MESH")
    return {"objects": len(objs), "triangles": tris}
