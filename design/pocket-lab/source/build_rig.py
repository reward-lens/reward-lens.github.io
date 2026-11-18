"""The articulated optical rig: every part of the pocket lab the runtime moves.

Run from design/pocket-lab:
  $B --background --factory-startup --python source/build_rig.py
It builds the rig, saves raw/rig.blend (separate, editable parts), joins
same-material mesh siblings under each node, exports raw/rig.glb and writes
raw/rig-nodes.json (world positions of the required nodes, glTF axes).

Node contract (Blender Z = three Y, Blender -Y = three +Z):
  RIG_ROOT                  identity, parent of everything
  HEAD_CARRIAGE             rides the gantry rail; runtime moves it +-0.28 in X
    FOCUS_LENS              local (0,0,0); runtime lowers it up to 0.18
  SOURCE_ASSEMBLY           emitter housing at STATIONS["EMITTER"]
    SOURCE_SHUTTER          iris at BEAM_ENTRY; runtime scales Z in [0.16, 1]
      SOURCE_ATTACHMENT, SOURCE_OPTICAL_AXIS
  PRISM_ATTACHMENT          BEAM_AFTER_PRISM (no mesh)
  FILTER_SELECTOR           SPECIMEN_FOCUS; runtime turns it about Z +-0.22 rad
    SPECIMEN_ATTACHMENT, SPECIMEN_OPTIC_PLANE
  OPTICAL_COUPLER           beam-splitter cube at DETECTOR_SPLIT
  DETECTOR_ASSEMBLY         housing, yawed OPT["detector_yaw"]
    RECEIVER_TOP_ACTION     face at DETECTOR_TOP; runtime nudges +-0.06 in Z
      RECEIVER_TOP_ATTACHMENT
    RECEIVER_BOTTOM_ACTION  face at DETECTOR_BOTTOM
      RECEIVER_BOTTOM_ATTACHMENT
Meshes are built in world coordinates, then moved into their node's space,
so every pivot is a node and every mesh object sits at its node's origin.
"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector, Matrix
import lib, layout as L

# ------------------------------------------------------------------ materials
lib.SPECS.setdefault("SOURCE_APERTURE", dict(color="#F2C48A", rough=.21, emit=1.6))
lib.SPECS.setdefault("DETECTOR_RECEIVER", dict(color="#A2C6BE", rough=.19, emit=.65))
lib.SPECS.setdefault("DETECTOR_Enamel", dict(color="#1F3F66", rough=.35))
lib.SPECS.setdefault("SPLITTER_Glass", dict(color="#CFE6EE", rough=.04, alpha=.35, double=True))
lib.SPECS.setdefault("SPLITTER_Coating", dict(color="#E3D3AE", metal=.6, rough=.08, alpha=.5, double=True))
lib.SPECS.setdefault("MICRO_Lens_Warm", dict(color="#EBC08C", rough=.1, emit=.5))
lib.SPECS.setdefault("LENS_Coated", dict(color="#22313A", metal=.3, rough=.06))
# rig plates: same rim material name (the runtime tunes it by name), much less glow than the scene default
lib.SPECS["SPECIMEN_Glass_Edge"] = dict(lib.SPECS["SPECIMEN_Glass_Edge"], emit=.04)

AL, ST, BR, CH, RB = "ALUMINIUM_Brushed", "STEEL_Polished", "BRASS_Restrained", "CHARCOAL_Instrument", "RUBBER_Black"

REQUIRED = ["RIG_ROOT", "HEAD_CARRIAGE", "FOCUS_LENS", "SOURCE_ASSEMBLY", "SOURCE_SHUTTER",
            "SOURCE_ATTACHMENT", "SOURCE_OPTICAL_AXIS", "PRISM_ATTACHMENT", "FILTER_SELECTOR",
            "SPECIMEN_ATTACHMENT", "SPECIMEN_OPTIC_PLANE", "OPTICAL_COUPLER", "DETECTOR_ASSEMBLY",
            "RECEIVER_TOP_ACTION", "RECEIVER_BOTTOM_ACTION", "RECEIVER_TOP_ATTACHMENT",
            "RECEIVER_BOTTOM_ATTACHMENT"]

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(os.path.dirname(HERE), "raw")

# ------------------------------------------------------------- geometry kit

def orient(geo, origin, direction):
    """Turn a part built along +Z (from z=0) to run along `direction` from `origin`."""
    q = Vector((0, 0, 1)).rotation_difference(Vector(direction).normalized())
    return geo.transform(matrix=Matrix.Translation(Vector(origin)) @ q.to_matrix().to_4x4())

def ring(r_in, r_out, z0, z1, b=.004, seg=32):
    """A turned ring (annulus with chamfered rims) about Z."""
    b = min(b, (r_out - r_in) * .45, (z1 - z0) * .45)
    prof = [(r_in + b, z0), (r_out - b, z0), (r_out, z0 + b), (r_out, z1 - b), (r_out - b, z1),
            (r_in + b, z1), (r_in, z1 - b), (r_in, z0 + b)]
    return lib.lathe(prof, seg, closed_profile=True)

def turned(profile, seg=32):
    """A solid of revolution about Z from an (r, z) profile, bottom to top."""
    return lib.lathe(profile, seg)

def rod(r, z0, z1, b=.0, seg=24):
    return lib.cyl(r, z1 - z0, bevel=b, segments=seg, z0=z0)

def knurl(r, h, teeth=24, depth=.005, bevel=.004, per=3):
    """A knurled knob or collar: a scalloped outline extruded along Z."""
    n = teeth * per
    poly = [((r - depth * (.5 - .5 * math.cos(teeth * a))) * math.cos(a), (r - depth * (.5 - .5 * math.cos(teeth * a))) * math.sin(a))
            for a in (math.tau * i / n for i in range(n))]
    return lib.prism(poly, 0, h, bevel=bevel, bevel_segments=1)

def screw(r=.012, h=.008, seg=8, socket=True):
    """Socket-head cap screw built on +Z from z=0. Returns (head, socket)."""
    b = r * .3
    head = lib.lathe([(0, 0), (r, 0), (r, h - b), (r - b, h), (0, h)], seg)
    sock = lib.prism(lib.circle(r * .42, 6), h - .0005, h + .0006) if socket else None
    return head, sock

def quad_uv(corners):
    """One quad with 0-1 UVs, corners counter-clockwise from (u0, v0)."""
    g = lib.Geo(); vs = [g.bm.verts.new(Vector(c)) for c in corners]
    f = g.bm.faces.new(vs)
    for l, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))): l[g.uv].uv = uv
    g.bm.normal_update(); return g

# ------------------------------------------------------------------ builder

class Rig:
    def __init__(self, col):
        self.col = col; self.nodes = {}; self.meshes = []; self.n = 0

    def node(self, name, world, parent=None, yaw=0.0, **props):
        o = bpy.data.objects.new(name, None)
        o.empty_display_type = "PLAIN_AXES"; o.empty_display_size = .15
        self.col.objects.link(o)
        Mw = Matrix.Translation(Vector(world)) @ Matrix.Rotation(yaw, 4, "Z")
        if parent is not None:
            o.parent = parent; o.matrix_parent_inverse = Matrix.Identity(4)
            o.matrix_basis = parent.matrix_world.inverted() @ Mw
        else:
            o.matrix_basis = Mw
        bpy.context.view_layer.update()
        for k, v in props.items(): o[k] = v
        self.nodes[name] = o
        return o

    def add(self, geo, name, material, parent):
        """Finish a world-space Geo as a mesh child of `parent` at its origin."""
        self.n += 1
        o = geo.obj(f"{name}_{self.n:03d}", material, col=self.col)
        o.data.transform(parent.matrix_world.inverted())
        o.parent = parent; o.matrix_parent_inverse = Matrix.Identity(4); o.matrix_basis = Matrix.Identity(4)
        self.meshes.append(o)
        return o

    def screw(self, parent, at, axis, r=.012, h=.008, seg=8, mat=ST, name="SCREW", socket=True):
        head, sock = screw(r, h, seg, socket)
        self.add(orient(head, at, axis), name, mat, parent)
        if sock is not None: self.add(orient(sock, at, axis), name + "_SOCKET", CH, parent)

# ============================================================== the build

def build(col=None):
    col = col or lib.collection("RIG")
    R = Rig(col)
    root = R.node("RIG_ROOT", (0, 0, 0), kind="rig root")
    head_carriage(R, root)
    emitter(R, root)
    R.node("PRISM_ATTACHMENT", L.ANCHORS["BEAM_AFTER_PRISM"], root, restAnchor="BEAM_AFTER_PRISM")
    selector(R, root)
    coupler(R, root)
    detector(R, root)
    return R

# --------------------------------------------------------- carriage + scope

def head_carriage(R, root):
    cy = L.GANTRY_Y - L.GANTRY_SECTION[1] / 2 - 0.05          # guide face
    zb = L.GANTRY_BEAM_Z
    X0 = L.MICRO_X
    head = R.node("HEAD_CARRIAGE", (X0, cy, zb), root, axis="Three X", range=[-.28, .28], rest=0.0)
    focus = R.node("FOCUS_LENS", (X0, cy, zb), head, axis="Three Y", range=[-.18, 0.0], rest=0.0)
    beam_top = zb + L.GANTRY_SECTION[0] / 2

    # ---- carriage: bearing blocks on the guide, bolted plate, top saddle
    for sx in (-1, 1):
        x = X0 + sx * .12
        R.add(lib.rbox((.15, .05, .10), .007, 2, loc=(x, cy - .015, zb)), "CARRIAGE_BEARING", ST, head)
        for ex in (-1, 1):
            R.add(lib.rbox((.012, .052, .102), .004, 1, loc=(x + ex * .081, cy - .015, zb)), "CARRIAGE_SEAL", CH, head)
        R.add(rod(.006, 0, .02, seg=8).transform(rot=(0, sx * math.pi / 2, 0)).transform(loc=(x + sx * .087, cy - .02, zb + .02)), "CARRIAGE_NIPPLE", BR, head)
    py0, py1 = cy - .075, cy - .040                         # plate y range
    R.add(lib.rbox((.52, py1 - py0, .445), .012, 2, loc=(X0, (py0 + py1) / 2, zb - .0175)), "CARRIAGE_PLATE", AL, head)
    for x in (-.215, .215):
        for z in (-.17, 0, .17):
            R.screw(head, (X0 + x, py0, zb + z), (0, -1, 0), r=.014, h=.009)
    sad = (X0, (py0 + L.GANTRY_Y + .005) / 2, beam_top + .03)
    R.add(lib.rbox((.40, L.GANTRY_Y + .005 - py0, .03), .008, 2, loc=sad), "CARRIAGE_SADDLE", AL, head)
    for x in (-.15, .15):
        for y in (py0 + .06, L.GANTRY_Y - .04):
            R.screw(head, (X0 + x, y, beam_top + .045), (0, 0, 1), r=.013, h=.008)

    # ---- drive: gearbox and stepper motor on the +X side, cable into the tray
    gx = X0 + .34
    R.add(lib.rbox((.16, .15, .14), .014, 2, loc=(gx, cy - .085, zb)), "DRIVE_GEARBOX", CH, head)
    R.add(lib.rbox((.07, .004, .028), .002, 1, loc=(gx, cy - .162, zb + .02)), "DRIVE_LABEL", BR, head)
    R.add(lib.rbox((.12, .12, .115), .01, 2, loc=(gx, cy - .085, zb + .135)), "DRIVE_MOTOR", CH, head)
    for z in (zb + .078, zb + .19):
        R.add(lib.rbox((.126, .126, .018), .004, 1, loc=(gx, cy - .085, z)), "DRIVE_MOTOR_CAP", AL, head)
    for ox in (-.045, .045):
        for oy in (-.045, .045):
            R.screw(head, (gx + ox, cy - .085 + oy, zb + .199), (0, 0, 1), r=.007, h=.005, seg=8)
    R.add(rod(.016, zb + .199, zb + .225, b=.004, seg=12).transform(loc=(gx, cy - .085, 0)), "DRIVE_GLAND", ST, head)
    tray_y, tray_z = L.GANTRY_Y + .09, beam_top + .045
    cable = lib.catmull([(gx, cy - .085, zb + .22), (gx, cy - .07, zb + .29), (gx + .02, cy + .12, zb + .32),
                         (gx + .06, tray_y - .01, beam_top + .12), (gx + .14, tray_y, tray_z + .01), (gx + .45, tray_y, tray_z)], per=5)
    R.add(lib.tube(cable, .011, n=8), "DRIVE_CABLE", RB, head)

    # ---- mount: Z plate on the carriage, cantilever arm, Z-stage housing (HEAD_CARRIAGE)
    A = Vector((X0, L.MICRO_Y, 0)); Y0 = L.MICRO_Y
    def T(g): return g.transform(loc=A)
    zp0, zp1 = py0 - .03, py0
    R.add(lib.rbox((.24, zp1 - zp0, .86), .008, 2, loc=(X0, (zp0 + zp1) / 2, zb - .22)), "MOUNT_ZPLATE", AL, head)
    R.add(lib.rbox((.10, .012, .78), .003, 1, loc=(X0, zp0 - .006, zb - .23)), "MOUNT_DOVETAIL", CH, head)
    for x in (-.09, .09):
        for z in (-.62, .17):
            R.screw(head, (X0 + x, zp0, zb + z), (0, -1, 0), r=.011, h=.007)
    HS, hz0, hz1 = .32, 5.98, 7.06            # housing section, bottom, top (bellows and gland plate below)
    ay0, ay1 = Y0 - HS / 2 - .02, zp0 - .012
    R.add(lib.rbox((.36, ay1 - ay0, .24), .03, 2, loc=(X0, (ay0 + ay1) / 2, hz1 + .12)), "MOUNT_ARM", AL, head)
    R.add(lib.rbox((.12, ay1 - (Y0 + HS / 2) + .02, .24), .02, 2, loc=(X0, (Y0 + HS / 2 - .02 + ay1) / 2, hz1 - .12)), "MOUNT_GUSSET", AL, head)
    for x in (-.12, .12):
        R.screw(head, (X0 + x, ay1 - .06, hz1 + .24), (0, 0, 1), r=.012, h=.008)
        R.screw(head, (X0 + x, ay0, hz1 + .12), (0, -1, 0), r=.012, h=.008)
    mz = hz1 + .24                              # Z-drive motor on the arm, over the axis
    R.add(lib.rbox((.19, .19, .124), .012, 2, loc=(X0, Y0, mz + .074)), "ZDRIVE_MOTOR", CH, head)
    for z in (mz + .006, mz + .142):
        R.add(lib.rbox((.198, .198, .012), .004, 1, loc=(X0, Y0, z)), "ZDRIVE_CAP", AL, head)
    for ox in (-.07, .07):
        for oy in (-.07, .07):
            R.screw(head, (X0 + ox, Y0 + oy, mz + .148), (0, 0, 1), r=.007, h=.005, seg=6, socket=False)
    R.add(rod(.02, mz + .148, mz + .172, b=.004, seg=12).transform(loc=A), "ZDRIVE_GLAND", ST, head)
    hc = (hz0 + hz1) / 2
    R.add(lib.rbox((HS, HS, hz1 - hz0), .04, 3, loc=(X0, Y0, hc)), "ZSTAGE_HOUSING", AL, head)
    for (fx, fy), rz in (((0, -1), 0.0), ((1, 0), math.pi / 2)):      # T-slots on the faces the camera sees
        R.add(lib.rbox((.07, .012, hz1 - hz0 - .12), .004, 1, loc=(X0 + fx * (HS / 2 + .002), Y0 + fy * (HS / 2 + .002), hc), rot=(0, 0, rz)), "ZSTAGE_TSLOT", CH, head)
        R.add(lib.rbox((.026, .008, hz1 - hz0 - .16), .003, 1, loc=(X0 + fx * (HS / 2 + .008), Y0 + fy * (HS / 2 + .008), hc), rot=(0, 0, rz)), "ZSTAGE_RAIL", ST, head)
        for s in (-1, 1):
            for z in (hz0 + .06, hz1 - .06):
                at = (X0 + fx * HS / 2 + fy * s * -.11, Y0 + fy * HS / 2 + fx * s * .11, z)
                R.screw(head, at, (fx, fy, 0), r=.011, h=.007)
    for k in range(6):                          # bellows band between housing and gland plate
        z = 5.80 + k * .03
        R.add(lib.rbox((.336, .336, .016), .03, 1, loc=(X0, Y0, z + .008)), "ZSTAGE_BELLOWS", RB, head)
        R.add(lib.rbox((.296, .296, .016), .03, 1, loc=(X0, Y0, z + .022)), "ZSTAGE_BELLOWS", RB, head)
    R.add(lib.rbox((.34, .34, .08), .025, 2, loc=(X0, Y0, 5.76)), "ZSTAGE_GLAND", AL, head)
    for x in (-.12, .12):
        R.screw(head, (X0 + x, Y0 - .17, 5.76), (0, -1, 0), r=.01, h=.006, socket=False)
    R.add(T(ring(.132, .162, 5.70, 5.72, b=.004, seg=32)), "ZSTAGE_WIPER", BR, head)

    # ---- FOCUS_LENS: spigot into the housing, body tube, focus knobs, head block, port, nosepiece
    R.add(T(rod(.13, 5.66, 6.10, seg=24)), "TUBE_SPIGOT", ST, focus)
    R.add(T(turned([(0, 4.56), (.17, 4.56), (.17, 5.685), (.16, 5.70), (0, 5.70)], 40)), "TUBE_BODY", AL, focus)
    for z0, h in ((5.56, .07), (4.93, .03), (4.66, .06)):
        R.add(T(ring(.166, .1755, z0, z0 + h, b=.004, seg=40)), "TUBE_BAND", CH, focus)
    R.add(T(ring(.166, .178, 5.40, 5.43, b=.005, seg=40)), "TUBE_RING", BR, focus)
    R.add(T(turned([(0, 5.06), (.18, 5.06), (.2, 5.07), (.207, 5.09), (.207, 5.28), (.2, 5.30), (.18, 5.31), (0, 5.31)], 40)), "FOCUS_COLLAR", AL, focus)
    R.add(T(ring(.204, .211, 5.17, 5.20, b=.003, seg=40)), "FOCUS_COLLAR_BAND", CH, focus)
    o, d = A + Vector((0, 0, 5.18)), (-1, 0, 0)          # coarse/fine focus pair on the -X side
    R.add(orient(turned([(0, .18), (.046, .18), (.046, .225), (.04, .231), (0, .231)], 16), o, d), "FOCUS_BOSS", AL, focus)
    R.add(orient(knurl(.08, .05, teeth=14, depth=.008, bevel=.006, per=2).transform(loc=(0, 0, .231)), o, d), "FOCUS_KNOB_COARSE", CH, focus)
    R.add(orient(rod(.062, .281, .288, b=.002, seg=20), o, d), "FOCUS_KNOB_FACE", BR, focus)
    R.add(orient(knurl(.05, .04, teeth=10, depth=.006, bevel=.005, per=2).transform(loc=(0, 0, .288)), o, d), "FOCUS_KNOB_FINE", CH, focus)
    R.add(orient(rod(.02, .328, .336, b=.003, seg=12), o, d), "FOCUS_KNOB_CAP", ST, focus)
    R.add(T(turned([(0, 4.02), (.185, 4.02), (.215, 4.03), (.24, 4.05), (.25, 4.08), (.25, 4.49), (.242, 4.53),
                    (.215, 4.56), (.18, 4.578), (0, 4.578)], 48)), "HEAD_BLOCK", AL, focus)
    R.add(T(ring(.246, .2555, 4.11, 4.16, b=.004, seg=48)), "HEAD_BAND", CH, focus)
    R.add(T(ring(.246, .254, 4.44, 4.46, b=.003, seg=48)), "HEAD_RING", BR, focus)
    # illuminator port toward the camera (+X, -Y), offset to the viewer's right so |dy| <= .30
    pd, pp = Vector((.7071, -.7071, 0)), Vector((.7071, .7071, 0))
    po = A + pp * .10 + Vector((0, 0, 4.30))
    R.add(orient(ring(.06, .125, .21, .262, b=.008, seg=32), po, pd), "PORT_FLANGE", CH, focus)
    R.add(orient(turned([(0, .10), (.095, .10), (.095, .39), (0, .39)], 32), po, pd), "PORT_TUBE", AL, focus)
    R.add(orient(ring(.093, .0985, .29, .32, b=.003, seg=32), po, pd), "PORT_BAND", CH, focus)
    R.add(orient(ring(.066, .098, .385, .42, b=.007, seg=32), po, pd), "PORT_BEZEL", CH, focus)
    R.add(orient(turned([(0, .392), (.068, .392), (.068, .40), (.05, .41), (.026, .415), (0, .416)], 24), po, pd), "PORT_LENS", "MICRO_Lens_Warm", focus)
    ko, kd = A + Vector((0, 0, 4.30)), Vector((-.7071, .7071, 0))
    R.add(orient(turned([(0, .21), (.042, .21), (.042, .262), (0, .262)], 16), ko, kd), "HEAD_KNOB_BOSS", AL, focus)
    R.add(orient(knurl(.056, .045, teeth=10, depth=.007, bevel=.005, per=2).transform(loc=(0, 0, .262)), ko, kd), "HEAD_KNOB", CH, focus)
    R.add(orient(rod(.02, .307, .313, b=.002, seg=12), ko, kd), "HEAD_KNOB_CAP", ST, focus)
    # inclined nosepiece: local disc axis -Z, objectives splayed al outward; tilting by al makes the +X one vertical,
    # yaw -45 deg leans the disc away from the camera (toward -X, +Y)
    al, rho, La = math.radians(19), .115, .19
    zt = L.MICRO_OBJECTIVE_Z + La
    MT = (Matrix.Translation(Vector((X0, Y0, zt))) @ Matrix.Rotation(math.radians(-45), 4, "Z")
          @ Matrix.Rotation(al, 4, "Y") @ Matrix.Translation(Vector((-rho, 0, 0))))
    R.add(turned([(0, 0), (.172, 0), (.186, .01), (.19, .022), (.19, .044), (.18, .058), (0, .058)], 40).transform(matrix=MT), "TURRET_DISC", AL, focus)
    R.add(ring(.186, .1945, .02, .046, b=.004, seg=40).transform(matrix=MT), "TURRET_GRIP", CH, focus)
    R.add(turned([(0, .058), (.15, .058), (.14, .085), (.122, .13), (.122, .28), (0, .28)], 32).transform(matrix=MT), "TURRET_HUB", AL, focus)
    R.add(ring(.12, .138, .10, .116, b=.003, seg=32).transform(matrix=MT), "TURRET_HUB_BAND", CH, focus)
    M3 = MT.to_3x3()
    def objective(Lo, code, lens):
        return [(turned([(0, -.03), (.054, -.03), (.054, .05), (.047, .056), (.047, Lo - .065), (.04, Lo - .05), (0, Lo - .05)], 24), AL),
                (ring(.03, .058, -.004, .012, b=.003, seg=24), CH),
                (ring(.045, .052, .062, .078, b=.002, seg=24), code),
                (ring(.022, .038, Lo - .052, Lo, b=.005, seg=24), CH),
                (turned([(0, Lo - .05), (.024, Lo - .05), (.024, Lo - .008), (.012, Lo - .004), (0, Lo - .003)], 16), lens)]
    for k, (phi, Lo, code) in enumerate(((0, La, "DETECTOR_Enamel"), (120, .18, BR), (-120, .18, "PETROL_Trim"))):
        f = math.radians(phi)
        base = MT @ Vector((rho * math.cos(f), rho * math.sin(f), 0))
        dirn = (M3 @ Vector((math.sin(al) * math.cos(f), math.sin(al) * math.sin(f), -math.cos(al)))).normalized()
        if k == 0:
            assert (dirn - Vector((0, 0, -1))).length < 1e-6 and (base - Vector((X0, Y0, zt))).length < 1e-6, (dirn, base)
            dirn, base = Vector((0, 0, -1)), Vector((X0, Y0, zt))
        for g, m in objective(Lo, code, "MICRO_Lens_Warm" if k == 0 else "LENS_Coated"):
            R.add(orient(g, base, dirn), "OBJECTIVE" if k == 0 else "TURRET_OBJECTIVE", m, focus)
    obj_z = L.MICRO_OBJECTIVE_Z                 # slim ring light round the active tip
    torus = lib.lathe([(.052 + .006 * math.cos(t), obj_z + .014 + .006 * math.sin(t)) for t in (math.tau * i / 8 for i in range(8))], 24, closed_profile=True)
    R.add(T(torus), "RINGLIGHT", "APRICOT_Task_Light", focus)

# ------------------------------------------------------------------ emitter

def emitter(R, root):
    E = Vector(L.STATIONS["EMITTER"]); BE = Vector(L.ANCHORS["BEAM_ENTRY"])
    src = R.node("SOURCE_ASSEMBLY", E, root, restAnchor="EMITTER")
    y, zb = E.y, E.z
    hx0, hx1 = E.x - .20, BE.x - .14          # housing x range (-4.25, -3.99)
    hc = Vector(((hx0 + hx1) / 2, y, zb + .01))
    R.add(lib.rbox((hx1 - hx0, .28, .25), .035, 3, loc=hc), "SOURCE_HOUSING", "PETROL_Trim", src)
    for i in range(6):
        R.add(lib.rbox((.012, .25, .05), .004, 1, loc=(hx0 + .03 + i * .04, y, hc.z + .145)), "SOURCE_FIN_TOP", "PETROL_Trim", src)
    for sy in (-1, 1):
        for k in range(5):
            R.add(lib.rbox((.21, .03, .01), .003, 1, loc=(hc.x, y + sy * .152, hc.z - .085 + k * .042)), "SOURCE_FIN_SIDE", "PETROL_Trim", src)
    # front: bezel plate, brass lens ring, ribbed barrel, front brass ring
    R.add(lib.rbox((.02, .22, .21), .006, 2, loc=(hx1 + .005, y, zb)), "SOURCE_BEZEL", CH, src)
    for sy in (-1, 1):
        for sz in (-1, 1):
            R.screw(src, (hx1 + .015, y + sy * .085, zb + sz * .08), (1, 0, 0), r=.008, h=.005, seg=8)
    ax = (1, 0, 0); o = Vector((hx1 + .014, y, zb))
    R.add(orient(ring(.058, .09, 0, .022, b=.006, seg=32), o, ax), "SOURCE_LENS_RING", BR, src)
    bx0, bx1 = hx1 + .03, BE.x - .022
    R.add(orient(turned([(0, 0), (.068, 0), (.068, bx1 - bx0), (0, bx1 - bx0)], 32), Vector((bx0, y, zb)), ax), "SOURCE_BARREL", CH, src)
    for k in range(3):
        R.add(orient(ring(.066, .0735, .015 + k * .022, .023 + k * .022, b=.002, seg=32), Vector((bx0, y, zb)), ax), "SOURCE_BARREL_RIB", CH, src)
    R.add(orient(ring(.056, .086, 0, .034, b=.006, seg=32), Vector((BE.x - .022, y, zb)), ax), "SOURCE_FRONT_RING", BR, src)
    R.add(orient(rod(.06, 0, .004, seg=24), Vector((BE.x - .012, y, zb)), ax), "SOURCE_IRIS_BACKING", CH, src)
    # shutter: aperture disc (face exactly at BEAM_ENTRY) behind six iris blades
    sh = R.node("SOURCE_SHUTTER", BE, src, semantic="source iris opening", range=[.16, 1.0], rest=1.0)
    R.node("SOURCE_ATTACHMENT", BE, sh); R.node("SOURCE_OPTICAL_AXIS", BE, sh)
    R.add(orient(rod(.052, -.006, 0, seg=32), BE, ax), "SHUTTER_APERTURE", "SOURCE_APERTURE", sh)
    a_in, r_out = .028, .062
    half = math.acos(a_in / r_out)
    for i in range(6):
        th = math.tau * i / 6 + .2
        arc = [(r_out * math.cos(th + t), r_out * math.sin(th + t)) for t in (-half + 2 * half * k / 10 for k in range(11))]
        blade = lib.prism(arc, 0, .0012)
        x0 = .0003 + i * .0016
        R.add(orient(blade.transform(loc=(0, 0, x0)), BE, ax), "SHUTTER_BLADE", CH, sh)
    # post feet to the table top
    R.add(lib.rbox((.24, .10, .02), .005, 2, loc=(hc.x, y, hc.z - .135)), "SOURCE_SADDLE", CH, src)
    z_post_top = hc.z - .145
    for x in (hx0 + .04, hx1 - .04):
        R.add(rod(.018, L.BENCH_TOP + .17, z_post_top, seg=20).transform(loc=(x, y, 0)), "SOURCE_POST", ST, src)
        R.add(rod(.027, L.BENCH_TOP + .02, L.BENCH_TOP + .19, b=.004, seg=20).transform(loc=(x, y, 0)), "SOURCE_POST_HOLDER", CH, src)
        R.add(orient(knurl(.011, .024, teeth=8, depth=.002, bevel=.002), Vector((x, y - .025, L.BENCH_TOP + .15)), (0, -1, 0)), "SOURCE_THUMBSCREW", BR, src)
        R.add(lib.rbox((.07, .17, .02), .005, 2, loc=(x, y, L.BENCH_TOP + .01)), "SOURCE_FOOT", CH, src)
        for sy in (-1, 1):
            R.screw(src, (x, y + sy * .062, L.BENCH_TOP + .02), (0, 0, 1), r=.011, h=.007)
    # fibre input on the -X side, its cable laid down onto the table
    fo = Vector((hx0, y, zb)); mx = (-1, 0, 0)
    R.add(lib.rbox((.012, .06, .06), .003, 1, loc=(hx0 - .006, y, zb)), "SOURCE_FIBRE_FLANGE", CH, src)
    R.add(orient(rod(.016, .01, .05, seg=16), fo, mx), "SOURCE_FIBRE_PORT", ST, src)
    R.add(orient(lib.prism(lib.circle(.022, 6, math.pi / 6), .022, .034, bevel=.002), fo, mx), "SOURCE_FIBRE_NUT", BR, src)
    R.add(orient(turned([(0, .05), (.014, .05), (.012, .07), (.008, .085), (0, .085)], 12), fo, mx), "SOURCE_FIBRE_BOOT", RB, src)
    path = lib.catmull([(hx0 - .08, y, zb), (hx0 - .11, y + .01, zb - .04), (hx0 - .115, y + .05, zb - .22), (hx0 - .08, y + .13, L.BENCH_TOP + .12),
                        (hx0 - .01, y + .2, L.BENCH_TOP + .007), (hx0 + .1, y + .3, L.BENCH_TOP + .007), (hx0 + .16, y + .48, L.BENCH_TOP + .007)], per=5)
    R.add(lib.tube(path, .0065, n=8), "SOURCE_FIBRE", "PETROL_Deep", src)

# ---------------------------------------------------------------- specimens

def selector(R, root):
    S = Vector(L.ANCHORS["SPECIMEN_FOCUS"])
    sel = R.node("FILTER_SELECTOR", S, root, axis="Three Y rotation", rangeRadians=[-.22, .22], rest=0.0)
    R.node("SPECIMEN_ATTACHMENT", S, sel); R.node("SPECIMEN_OPTIC_PLANE", S, sel)
    zb = S.z - .45                                       # plate bottoms
    P = Vector((S.x, S.y, 0))
    R.add(turned([(0, zb - .026), (.244, zb - .026), (.25, zb - .02), (.252, zb - .008), (.246, zb), (0, zb)], 48).transform(loc=P), "SELECTOR_TURNTABLE", CH, sel)
    R.add(ring(.236, .2535, zb - .02, zb - .004, b=.003, seg=48).transform(loc=P), "SELECTOR_TURNTABLE_RIM", BR, sel)
    R.add(rod(.03, zb, zb + .01, b=.003, seg=20).transform(loc=P), "SELECTOR_HUB", ST, sel)
    for k in range(12):                                   # index marks on the rim
        a = math.tau * k / 12
        R.add(lib.rbox((.012, .003, .01), .001, 1, loc=(S.x + .2545 * math.cos(a), S.y + .2545 * math.sin(a), zb - .012), rot=(0, 0, a + math.pi / 2)), "SELECTOR_TICK", ST, sel)
    H, Dp, T = .55, .50, .06
    rim_path = [(0, u, v) for u, v in lib.rrect(Dp - .024, H - .024, .03, 3)]
    for i in range(5):
        dx = (i - 2) * .09; yaw = (i - 2) * .05
        M = Matrix.Translation(Vector((S.x + dx, S.y, zb + H / 2))) @ Matrix.Rotation(yaw, 4, "Z")
        R.add(lib.rbox((.026, Dp - .03, H - .03), .005, 2).transform(matrix=M), "PLATE_GLASS", "SPECIMEN_Glass", sel)
        rim = lib.sweep(rim_path, lib.rrect(.010, .03, .004, 1), closed_path=True, up=(1, 0, 0))
        R.add(rim.transform(matrix=M), "PLATE_RIM", "SPECIMEN_Glass_Edge", sel)
        pu, pv = (Dp - .06) / 2, (H - .06) / 2
        R.add(quad_uv([(0, -pu, -pv), (0, pu, -pv), (0, pu, pv), (0, -pu, pv)]).transform(matrix=M), "PLATE_PATTERN", "SPECIMEN_Pattern", sel)
        R.add(lib.rbox((.076, .42, .03), .006, 2, loc=(0, 0, -H / 2 + .015)).transform(matrix=M), "PLATE_HOLDER", CH, sel)
        for sy in (-1, 1):
            R.add(rod(.008, 0, .006, b=.002, seg=10).transform(rot=(0, math.pi / 2, 0)).transform(loc=(.038, sy * .17, -H / 2 + .015)).transform(matrix=M), "PLATE_HOLDER_SCREW", ST, sel)

# ------------------------------------------------------------------ coupler

def coupler(R, root):
    K = Vector(L.ANCHORS["DETECTOR_SPLIT"])
    cp = R.node("OPTICAL_COUPLER", K, root, restAnchor="DETECTOR_SPLIT")
    c = .15
    R.add(lib.rbox((c, c, c), .004, 1, loc=K), "COUPLER_CUBE", "SPLITTER_Glass", cp)
    R.add(lib.rbox((.003, c * math.sqrt(2) - .012, c - .008), .001, 1, loc=K, rot=(0, 0, math.pi / 4)), "COUPLER_HALF_MIRROR", "SPLITTER_Coating", cp)
    for sz in (-1, 1):
        R.add(lib.rbox((.20, .20, .024), .006, 2, loc=K + Vector((0, 0, sz * (c / 2 + .012)))), "COUPLER_CAGE_PLATE", CH, cp)
        for sx in (-1, 1):
            for sy in (-1, 1):
                R.screw(cp, K + Vector((sx * .085, sy * .085, sz * (c / 2 + .024))), (0, 0, sz), r=.009, h=.005, seg=8)
    for sx in (-1, 1):
        for sy in (-1, 1):
            R.add(rod(.009, K.z - c / 2, K.z + c / 2, seg=12).transform(loc=(K.x + sx * .088, K.y + sy * .088, 0)), "COUPLER_ROD", ST, cp)
    top = K.z + c / 2 + .024
    R.add(knurl(.024, .022, teeth=12, depth=.003, bevel=.003).transform(loc=(K.x, K.y, top)), "COUPLER_KNOB", BR, cp)
    # aperture rings on the beam faces
    for sx in (-1, 1):
        R.add(orient(ring(.052, .062, 0, .006, b=.002, seg=28), K + Vector((sx * (c / 2), 0, 0)), (sx, 0, 0)), "COUPLER_APERTURE", BR, cp)
    bottom = K.z - c / 2 - .024
    z_tab = L.BENCH_TOP
    R.add(rod(.019, z_tab + .25, bottom, seg=20).transform(loc=(K.x, K.y, 0)), "COUPLER_POST", ST, cp)
    R.add(ring(.018, .032, z_tab + .25, z_tab + .285, b=.004, seg=24).transform(loc=(K.x, K.y, 0)), "COUPLER_POST_COLLAR", CH, cp)
    R.screw(cp, (K.x + .032, K.y, z_tab + .268), (1, 0, 0), r=.008, h=.006, seg=8)
    R.add(rod(.03, z_tab + .022, z_tab + .26, b=.004, seg=24).transform(loc=(K.x, K.y, 0)), "COUPLER_POST_HOLDER", CH, cp)
    R.add(orient(knurl(.012, .026, teeth=8, depth=.002, bevel=.002), Vector((K.x, K.y - .028, z_tab + .2)), (0, -1, 0)), "COUPLER_THUMBSCREW", BR, cp)
    R.add(lib.rbox((.24, .14, .022), .006, 2, loc=(K.x, K.y, z_tab + .011)), "COUPLER_BASE", CH, cp)
    for sx in (-1, 1):
        R.add(rod(.017, z_tab + .022, z_tab + .025, seg=14).transform(loc=(K.x + sx * .088, K.y, 0)), "COUPLER_WASHER", ST, cp)
        R.screw(cp, (K.x + sx * .088, K.y, z_tab + .025), (0, 0, 1), r=.011, h=.007)

# ----------------------------------------------------------------- detector

def detector(R, root):
    dx, dy = L.OPT["detector"]; yaw = L.OPT["detector_yaw"]
    Dc = Vector((dx, dy, L.BEAM_Z))
    det = R.node("DETECTOR_ASSEMBLY", Dc, root, yaw=yaw)
    MD = det.matrix_world.copy(); MDi = MD.inverted()
    def W(g): return g.transform(matrix=MD)            # detector-local -> world
    top_l = MDi @ Vector(L.ANCHORS["DETECTOR_TOP"]); bot_l = MDi @ Vector(L.ANCHORS["DETECTOR_BOTTOM"])
    px, fy = top_l.x, top_l.y                            # ports' x and face plane (local)
    cx, cyb = px + .03, -.048                            # enclosure centre (local x, y)
    yf = fy + .163                                       # front panel face (local y)
    z0, z1 = -.49, .50
    R.add(W(lib.rbox((.50, .18 - (yf + .022), z1 - z0), .045, 3, loc=(cx, (yf + .022 + .18) / 2, (z0 + z1) / 2))), "DETECTOR_BODY", "DETECTOR_Enamel", det)
    R.add(W(lib.rbox((.46, .024, z1 - z0 - .04), .009, 2, loc=(cx, yf + .012, (z0 + z1) / 2))), "DETECTOR_FRONT_PANEL", "DETECTOR_Enamel", det)
    R.add(W(lib.rbox((.012, .30, .66), .006, 2, loc=(cx + .25, cyb, 0))), "DETECTOR_SIDE_PANEL", "DETECTOR_Enamel", det)
    R.add(W(lib.rbox((.47, .40, .024), .008, 2, loc=(cx, cyb + .015, z1 + .008))), "DETECTOR_LID", AL, det)
    for sx in (-1, 1):
        for sz in (-1, 1):
            R.screw(det, MD @ Vector((cx + sx * .2, yf, sz * .445)), MD.to_3x3() @ Vector((0, -1, 0)), r=.011, h=.007)
            R.screw(det, MD @ Vector((cx + .256, cyb + sx * .13, sz * .3)), MD.to_3x3() @ Vector((1, 0, 0)), r=.009, h=.005, seg=8)
            R.screw(det, MD @ Vector((cx + sx * .2, cyb + .015 + sz * .165, z1 + .02)), (0, 0, 1), r=.01, h=.006, seg=8)
    for k in range(5):                                   # vent slots on the side panel
        R.add(W(lib.rbox((.006, .2, .014), .003, 1, loc=(cx + .257, cyb, -.12 + k * .06))), "DETECTOR_VENT", CH, det)
    R.add(W(lib.rbox((.004, .09, .03), .0015, 1, loc=(cx + .258, cyb, .2))), "DETECTOR_BADGE", BR, det)
    for sx in (-1, 1):                                   # rear connectors
        R.add(W(orient(rod(.026, 0, .03, b=.004, seg=16), Vector((cx + sx * .12, .18, .25)), (0, 1, 0))), "DETECTOR_CONNECTOR", ST, det)
        R.add(W(orient(rod(.015, .03, .036, seg=12), Vector((cx + sx * .12, .18, .25)), (0, 1, 0))), "DETECTOR_CONNECTOR_PIN", CH, det)
    # status window between the ports
    R.add(W(lib.rbox((.17, .012, .07), .008, 2, loc=(px, yf - .004, .005))), "DETECTOR_STATUS_FRAME", CH, det)
    R.add(W(lib.rbox((.14, .004, .045), .003, 1, loc=(px, yf - .011, .005))), "DETECTOR_STATUS_GLASS", "LENS_Coated", det)
    R.add(W(lib.rbox((.085, .003, .01), .001, 1, loc=(px - .018, yf - .0135, .0))), "DETECTOR_STATUS_BAR", "DETECTOR_RECEIVER", det)
    R.add(W(orient(rod(.006, 0, .003, seg=10), Vector((px + .05, yf - .013, .012)), (0, -1, 0))), "DETECTOR_STATUS_LED", "APRICOT_Task_Light", det)
    # dark mounting plates behind the ports (the ports travel +-0.06 over them)
    for pz in (top_l.z, bot_l.z):
        pr = lib.prism(lib.rrect(.30, .30, .05, 4), 0, .01, bevel=.003)
        R.add(W(pr.transform(rot=(math.pi / 2, 0, 0)).transform(loc=(px, yf, pz))), "DETECTOR_PORT_PLATE", CH, det)
    # stand: flange, column with brass collar, base plate on the table
    zt = L.BENCH_TOP - L.BEAM_Z
    R.add(W(rod(.12, z0 - .02, z0 + .002, b=.005, seg=32).transform(loc=(cx, cyb, 0))), "DETECTOR_FLANGE", AL, det)
    R.add(W(rod(.065, zt + .03, z0 - .02, seg=28).transform(loc=(cx, cyb, 0))), "DETECTOR_COLUMN", CH, det)
    R.add(W(ring(.063, .073, zt + .06, zt + .075, b=.003, seg=28).transform(loc=(cx, cyb, 0))), "DETECTOR_COLUMN_COLLAR", BR, det)
    R.add(W(lib.rbox((.36, .30, .03), .008, 2, loc=(cx, cyb, zt + .015))), "DETECTOR_BASE", CH, det)
    for sx in (-1, 1):
        for sy in (-1, 1):
            R.screw(det, MD @ Vector((cx + sx * .14, cyb + sy * .11, zt + .03)), (0, 0, 1), r=.011, h=.007)
    # receivers: each port is a child of its action node, face at the anchor
    for side, loc_l in (("TOP", top_l), ("BOTTOM", bot_l)):
        world = MD @ loc_l
        act = R.node(f"RECEIVER_{side}_ACTION", world, det, yaw=yaw, axis="Three Y", range=[-.06, .06], rest=0.0)
        R.node(f"RECEIVER_{side}_ATTACHMENT", world, act, yaw=yaw)
        MP = MD @ Matrix.Translation(loc_l) @ Matrix.Rotation(math.pi / 2, 4, "X")   # port +Z -> local -Y
        def P(g): return g.transform(matrix=MP)
        R.add(P(ring(.088, .125, -.165, -.004, b=.008, seg=32)), f"RECEIVER_{side}_RIM", CH, act)
        R.add(P(ring(.084, .118, -.006, .018, b=.006, seg=32)), f"RECEIVER_{side}_BRASS", BR, act)
        R.add(P(turned([(0, -.03), (.089, -.03), (.089, -.006), (.07, -.004), (0, -.004)], 32)), f"RECEIVER_{side}_LENS", "LENS_Coated", act)
        R.add(P(turned([(0, -.012), (.068, -.012), (.068, -.003), (.062, 0), (0, 0)], 32)), f"RECEIVER_{side}_FACE", "DETECTOR_RECEIVER", act)
        for k in range(3):
            a = math.tau * k / 3 + .5
            R.screw(act, MP @ Vector((.101 * math.cos(a), .101 * math.sin(a), .018)), MP.to_3x3() @ Vector((0, 0, 1)), r=.007, h=.004, seg=8)

# ---------------------------------------------------------------- finishing

def join_by_parent_material(R):
    """Join direct mesh siblings that share a material, keeping every node."""
    groups = {}
    for o in R.meshes:
        if o.name not in bpy.data.objects: continue
        groups.setdefault((o.parent.name, o.data.materials[0].name), []).append(o)
    out = []
    for (pname, mname), objs in groups.items():
        if len(objs) > 1:
            bpy.ops.object.select_all(action="DESELECT")
            for o in objs: o.select_set(True)
            bpy.context.view_layer.objects.active = objs[0]
            bpy.ops.object.join()
        o = objs[0]; o.name = f"{pname}_{mname}"; o.data.name = o.name
        out.append(o)
    return out

def tally(R, top=28):
    t = {}
    for o in R.meshes:
        k = o.name.rsplit("_", 1)[0]
        t[k] = t.get(k, 0) + sum(len(p.vertices) - 2 for p in o.data.polygons)
    print("PARTS", " ".join(f"{k}:{v}" for k, v in sorted(t.items(), key=lambda kv: -kv[1])[:top]))

def clearance(R):
    """Head envelope: max |dy| in z 3.9..5.4, x reach below the arm, lowest objective at full focus travel."""
    bpy.context.view_layer.update()
    X0, Y0 = L.MICRO_X, L.MICRO_Y
    dy, xs, zmin = 0.0, [], 99.0
    for o in R.meshes:
        pn = o.parent.name
        if pn not in ("HEAD_CARRIAGE", "FOCUS_LENS"): continue
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            for dz in ((0.0, -.18) if pn == "FOCUS_LENS" else (0.0,)):
                z = w.z + dz
                if 3.9 <= z <= 5.4: dy = max(dy, abs(w.y - Y0))
                if z < 6.8: xs.append(w.x - X0)
                if pn == "FOCUS_LENS": zmin = min(zmin, z)
    print("CLEARANCE", dict(max_dy_3p9_5p4=round(dy, 4), x_reach=(round(min(xs), 3), round(max(xs), 3)), focus_zmin_at_m018=round(zmin, 4)))

def node_positions(R):
    bpy.context.view_layer.update()
    out = {}
    for n in REQUIRED:
        p = R.nodes[n].matrix_world.translation
        out[n] = [round(p.x, 5), round(p.z, 5), round(-p.y, 5)]
    return out

def main():
    lib.reset()
    col = lib.collection("RIG")
    R = build(col)
    missing = [n for n in REQUIRED if n not in R.nodes]
    assert not missing, missing
    tris = lib.stats(R.meshes)
    tally(R); clearance(R)
    os.makedirs(RAW, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(RAW, "rig.blend"))
    joined = join_by_parent_material(R)
    lib.export_glb(os.path.join(RAW, "rig.glb"), objects=[R.nodes["RIG_ROOT"]] + list(R.nodes.values()) + joined, vertex_colors=False)
    nodes = node_positions(R)
    with open(os.path.join(RAW, "rig-nodes.json"), "w") as f:
        json.dump({"axes": "glTF (x, z, -y) from Blender", "nodes": nodes}, f, indent=1)
    print("RIG_STATS", tris, "objects after join", len(joined))
    for n, p in nodes.items(): print("NODE", n, p)

if __name__ == "__main__":
    main()
