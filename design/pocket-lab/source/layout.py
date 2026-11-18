"""The pocket laboratory's plan and section: every shared dimension lives here.

Blender metres, Z up, the room faces -Y (camera at front-right, +X -Y +Z).
No vertical stylisation: these are final world heights, so round things stay
round. Modules place their pieces from these numbers; `check()` proves the
big volumes do not collide (the old room's stair ran through the bench).

Plan, front to back: the plinth's open floor; the optical bench (optics line
along its front); the alcove under the gallery with the lower back wall; the
curved shell wall. The stair climbs the right wall from the front-right floor
and turns left onto the gallery's right end. The gantry stands on the gallery.
"""
import math

# ------------------------------------------------------------------ levels
FLOOR = 0.50            # plinth top
BENCH_TOP = 2.30        # optical table top surface
BENCH_SLAB = 0.14       # table top thickness
BEAM_Z = 2.95           # optical axis height
GALLERY_TOP = 4.25      # mezzanine walking surface
GALLERY_T = 0.28        # mezzanine slab thickness (fascia)
RAIL_H = 1.00           # guard rail height above a walking surface
STOOL_SEAT = FLOOR + 0.95

# ------------------------------------------------------------------ plinth
PLINTH_C = (0.0, 0.40)
PLINTH_R = (6.30, 3.75)  # semi-axes x, y

def plinth_edge_y(x, front=True):
    rx, ry = PLINTH_R
    if abs(x) >= rx: return PLINTH_C[1]
    d = ry * math.sqrt(1 - (x / rx) ** 2)
    return PLINTH_C[1] - d if front else PLINTH_C[1] + d

def on_plinth(x, y, margin=0.0):
    rx, ry = PLINTH_R[0] - margin, PLINTH_R[1] - margin
    return ((x - PLINTH_C[0]) / rx) ** 2 + ((y - PLINTH_C[1]) / ry) ** 2 <= 1.0

# -------------------------------------------------------------------- wall
# The shell is an elliptical U. Angles are measured from +X, counter-
# clockwise in plan: pi/2 is the back centre, pi the left return, and the
# right return continues forward past 0 to WALL_T1 (negative).
WALL_C = (0.0, 0.40)
WALL_R = (5.45, 2.85)    # inner face semi-axes
WALL_THICK = 0.26
WALL_T0 = math.pi + 0.06  # left end (slightly forward of the side)
WALL_T1 = -0.30           # right end, forward along the stair
WALL_TOP_BACK = 7.75      # top of wall at the back centre (the gantry crown rises past it)
WALL_TOP_LEFT = 5.20      # top at the left end
WALL_TOP_RIGHT = 4.60     # top at the right (stair) end: low, so it never reads as a pillar

def wall_inner(t, inset=0.0):
    """Point on the wall's inner face at angle t; inset moves into the room."""
    return (WALL_C[0] + (WALL_R[0] - inset) * math.cos(t), WALL_C[1] + (WALL_R[1] - inset) * math.sin(t))

def wall_normal(t):
    """Unit normal of the inner face at t, pointing into the room."""
    nx, ny = -math.cos(t) / WALL_R[0], -math.sin(t) / WALL_R[1]
    L = math.hypot(nx, ny); return (nx / L, ny / L)

def wall_top(t):
    """Height of the wall's top edge: a dome-like crown, flat at the back,
    falling smoothly to each return (lower on the stair side, so the wall
    beside the stair never reads as a pillar)."""
    u = (t - WALL_T1) / (WALL_T0 - WALL_T1)          # 0 at right end, 1 at left end
    uc = (math.pi / 2 - WALL_T1) / (WALL_T0 - WALL_T1)
    if u <= uc: end, k = WALL_TOP_RIGHT, u / uc
    else: end, k = WALL_TOP_LEFT, (1 - u) / (1 - uc)
    return end + (WALL_TOP_BACK - end) * math.sin(math.pi / 2 * max(0.0, min(1.0, k))) ** 1.5

def wall_angle_at_y(y, right=True):
    s = max(-1.0, min(1.0, (y - WALL_C[1]) / WALL_R[1]))
    a = math.asin(s)
    return a if right else math.pi - a

# ----------------------------------------------------------------- gallery
# Crescent between the wall's inner face (back) and an inner ellipse (front),
# from the left return to GALLERY_T_END, where the stair lands on its end face.
GALLERY_FRONT_R = (4.70, 1.00)
GALLERY_T_START = math.pi - 0.02
GALLERY_T_END = 0.80

def gallery_back(t):
    return wall_inner(t, -0.03)          # tucked 3 cm into the wall

def gallery_front(t):
    return (WALL_C[0] + GALLERY_FRONT_R[0] * math.cos(t), WALL_C[1] + GALLERY_FRONT_R[1] * math.sin(t))

def gallery_samples(n=72):
    ts = [GALLERY_T_START + (GALLERY_T_END - GALLERY_T_START) * i / n for i in range(n + 1)]
    return ts, [gallery_back(t) for t in ts], [gallery_front(t) for t in ts]

# ------------------------------------------------------------------- bench
BENCH_X = (-4.30, 3.10)    # optical table extent
BENCH_Y = (-1.45, 0.95)    # front edge, back edge (deep: optics at the front, microscope stage at the back)
BENCH_CORNER_R = 0.22      # rounded plan corners
CABINET_SETBACK = 0.14     # cabinet faces sit behind the table edge
OPTICS_Y = -0.85           # optical axis line in plan

# ------------------------------------------------------------------- stair
STAIR_W = 1.15
STAIR_RISERS = 15
STAIR_RISE = (GALLERY_TOP - FLOOR) / STAIR_RISERS
# Walking line, bottom to top: along the right wall, turning left onto the
# gallery's end face at GALLERY_T_END.
STAIR_WAYPOINTS = [(4.00, -1.45), (4.55, -0.45), (4.60, 0.55), (4.08, 1.50), (3.55, 1.80)]

# ------------------------------------------------------------------ gantry
GANTRY_X = (-3.35, 2.95)   # leg centres (right leg clear of the stair well)
GANTRY_Y = 1.50            # plane of the portal (on the gallery, behind the rail); with the
                           # .44 section the carriage guide face stays at y 1.23
GANTRY_BEAM_Z = 7.45       # crossbeam centre height
GANTRY_SECTION = (0.40, 0.44)   # beam/leg section width x depth (m): as bold as the reference
GANTRY_CORNER_R = 0.90
MICRO_X = 0.25             # microscope rest x
MICRO_Y = 0.83             # barrel axis y (cantilevered forward of the beam)
MICRO_OBJECTIVE_Z = 3.65   # objective tip

# ------------------------------------------------------------------- optics
OPT = dict(
    emitter=(-4.05, OPTICS_Y), beam_entry=-3.85,
    prism=-2.40, after_prism=-2.05,
    grating=-1.30,
    specimen=0.25,
    splitter=1.45,
    detector=(2.55, -0.72), detector_yaw=math.radians(-20),   # housing centre, rotation about Z
    receiver_top=(2.30, -1.12, 3.30), receiver_bottom=(2.30, -1.12, 2.62),
)

ANCHORS = {
    "BEAM_ENTRY":        (OPT["beam_entry"], OPTICS_Y, BEAM_Z),
    "BEAM_AFTER_PRISM":  (OPT["after_prism"], OPTICS_Y, BEAM_Z),
    "SPECIMEN_FOCUS":    (OPT["specimen"], OPTICS_Y, BEAM_Z),
    "DETECTOR_SPLIT":    (OPT["splitter"], OPTICS_Y, BEAM_Z),
    "DETECTOR_TOP":      OPT["receiver_top"],
    "DETECTOR_BOTTOM":   OPT["receiver_bottom"],
    "CAMERA_DESKTOP_TARGET": (0.40, 0.80, 3.90),
    "CAMERA_MOBILE_TARGET":  (0.10, 0.80, 3.80),
}

# Semantic station roots the runtime and validator expect by name.
STATIONS = {
    "EMITTER": (OPT["emitter"][0], OPTICS_Y, BEAM_Z),
    "PRISM": (OPT["prism"], OPTICS_Y, BEAM_Z),
    "GRATING": (OPT["grating"], OPTICS_Y, BEAM_Z),
    "SPECIMEN_STACK": (OPT["specimen"], OPTICS_Y, BEAM_Z),
    "MICROSCOPE": (MICRO_X, MICRO_Y, 7.10),
}

# --------------------------------------------------------------- furniture
TROLLEY = dict(center=(-3.20, -2.05), size=(0.95, 0.52), yaw=math.radians(8))
FLOOR_PLANT = (-4.30, -1.55)
STOOL_LOWER = (-1.10, -2.30)
STOOL_UPPER = (1.45, 2.15)        # on the gallery, behind the railing

# ------------------------------------------------------------------- utils

def stair_line(samples=120):
    """Dense walking line with arc length; returns [(x, y)], total length."""
    pts = _catmull2(STAIR_WAYPOINTS, samples // (len(STAIR_WAYPOINTS) - 1))
    L = sum(math.dist(pts[i], pts[i - 1]) for i in range(1, len(pts)))
    return pts, L

def _catmull2(P, per):
    out = []
    for i in range(len(P) - 1):
        p0 = P[i - 1] if i > 0 else P[0]; p1 = P[i]; p2 = P[i + 1]; p3 = P[i + 2] if i + 2 < len(P) else P[-1]
        for k in range(per):
            t = k / per; t2 = t * t; t3 = t2 * t
            out.append(tuple(.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in range(2)))
    out.append(P[-1]); return out

def stair_frame(s, pts=None):
    """Walking-line point, unit direction and left normal at arc length s."""
    if pts is None: pts, _ = stair_line()
    acc = 0.0
    for i in range(1, len(pts)):
        d = math.dist(pts[i], pts[i - 1])
        if acc + d >= s or i == len(pts) - 1:
            t = 0 if d == 0 else min(1, max(0, (s - acc) / d))
            p = (pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t)
            dx, dy = (pts[i][0] - pts[i - 1][0]) / d, (pts[i][1] - pts[i - 1][1]) / d
            return p, (dx, dy), (-dy, dx)
        acc += d

def wall_inner_x_at(y):
    """Inner-face x on the right wall at plan y (None beyond the wall's ends)."""
    t = wall_angle_at_y(y, right=True)
    if t < WALL_T1: return None
    return wall_inner(t)[0]

def check(verbose=True):
    """Clearances between the big volumes. Returns a list of problems."""
    problems = []
    pts, L = stair_line()
    worst_wall = 9.0; worst_bench = 9.0
    for k in range(0, 101):
        s = L * k / 100; p, d, n = stair_frame(s, pts)
        outer = (p[0] - n[0] * STAIR_W / 2, p[1] - n[1] * STAIR_W / 2)
        inner = (p[0] + n[0] * STAIR_W / 2, p[1] + n[1] * STAIR_W / 2)
        wx = wall_inner_x_at(outer[1])
        if wx is not None: worst_wall = min(worst_wall, wx - outer[0])
        for q in (inner, outer, p):
            if not on_plinth(q[0], q[1], 0.15): problems.append(f"stair point {q} off plinth")
            if BENCH_X[0] - .05 < q[0] < BENCH_X[1] + .05 and BENCH_Y[0] - .05 < q[1] < BENCH_Y[1] + .05:
                problems.append(f"stair point {tuple(round(v,2) for v in q)} inside bench")
        worst_bench = min(worst_bench, inner[0] - BENCH_X[1]) if inner[1] < BENCH_Y[1] else worst_bench
    if worst_wall < 0.02: problems.append(f"stair outer edge within {worst_wall:.3f} m of wall")
    # gallery end face must sit at the stair's top
    top, d, n = stair_frame(L, pts)
    gb, gf = gallery_back(GALLERY_T_END), gallery_front(GALLERY_T_END)
    mid = ((gb[0] + gf[0]) / 2, (gb[1] + gf[1]) / 2)
    landing_gap = math.dist(top, mid)
    if landing_gap > 0.45: problems.append(f"stair top {top} is {landing_gap:.2f} m from gallery end face centre {mid}")
    # trolley and plant fully on the plinth
    cx, cy = TROLLEY["center"]; w, dd = TROLLEY["size"]
    for sx in (-1, 1):
        for sy in (-1, 1):
            if not on_plinth(cx + sx * w / 2, cy + sy * dd / 2, 0.20): problems.append("trolley corner near/off plinth edge")
    if not on_plinth(*FLOOR_PLANT, 0.45): problems.append("floor plant near/off plinth edge")
    if not on_plinth(*STOOL_LOWER, 0.45): problems.append("stool near/off plinth edge")
    # bench corners on the plinth
    for x in BENCH_X:
        for y in BENCH_Y:
            if not on_plinth(x, y, 0.2): problems.append(f"bench corner {(x, y)} near/off plinth")
    # gantry feet on the gallery
    for gx in GANTRY_X:
        t = math.acos(max(-1, min(1, gx / GALLERY_FRONT_R[0]))) if gx >= 0 else math.acos(max(-1, min(1, gx / GALLERY_FRONT_R[0])))
        fy = gallery_front(t)[1]; by = gallery_back(math.acos(max(-1, min(1, gx / (WALL_R[0] + .03)))))[1]
        if not (fy + 0.22 < GANTRY_Y < by - 0.22): problems.append(f"gantry foot at x={gx} not on gallery (front {fy:.2f}, back {by:.2f})")
    if verbose:
        print(f"stair length {L:.2f} m, going {L / (STAIR_RISERS - 1):.3f} m, rise {STAIR_RISE:.3f} m, pitch {math.degrees(math.atan(STAIR_RISE / (L / (STAIR_RISERS - 1)))):.1f} deg")
        print(f"stair-wall min clearance {worst_wall:.3f} m; stair inner edge to bench end {worst_bench:.3f} m; landing gap {landing_gap:.3f} m")
        print("problems:", problems or "none")
    return problems

if __name__ == "__main__":
    check()
