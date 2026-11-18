#!/usr/bin/env python3
"""Procedural texture set for the pocket-lab homepage scene.

Run from design/pocket-lab:

    python3 source/textures.py

Writes textures/*.png and previews/textures-sheet.png. Every random draw uses a
fixed seed, so reruns reproduce the same files. Scene scale: one tile = 1 m.
Needs numpy, scipy and Pillow only.
"""
import os
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage, special

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEX = os.path.join(ROOT, "textures")
PREV = os.path.join(ROOT, "previews")
FONT_SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
FONT_SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


# ---------------------------------------------------------------- helpers

def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def hexc(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def to8(a):
    return np.clip(np.round(a), 0, 255).astype(np.uint8)


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def freqs(h, w):
    return np.fft.fftfreq(h)[:, None], np.fft.fftfreq(w)[None, :]


def spectral(shape, rng, filt):
    """White noise shaped in the frequency domain: periodic, so it tiles."""
    fy, fx = freqs(*shape)
    a = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal(shape)) * filt(fx, fy)))
    a -= a.mean()
    s = a.std()
    return a / s if s > 0 else a


def fractal(n, rng, gamma=1.0, fmax=0.5):
    def filt(fx, fy):
        f = np.hypot(fx, fy)
        f[0, 0] = 1.0
        g = f ** -gamma * np.exp(-(f / fmax) ** 2)
        g[0, 0] = 0.0
        return g
    return spectral((n, n), rng, filt)


def pblur(a, sigma):
    """Periodic Gaussian blur (wraps at the edges)."""
    fy, fx = freqs(*a.shape[:2])
    g = np.exp(-2.0 * (np.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def height_to_normal(h, strength):
    """Tangent-space normal, OpenGL convention (+Y up = toward image top)."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5   # +rows = down
    n = np.stack([-strength * dx, strength * dy, np.ones_like(h)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def encode_normal(n):
    return to8((n * 0.5 + 0.5) * 255.0)


def downsample(a, ss):
    h, w = a.shape[0] // ss, a.shape[1] // ss
    return a.reshape(h, ss, w, ss, *a.shape[2:]).mean(axis=(1, 3))


def seam_ratio(a):
    """Mean |difference| across the wrap edge over the mean interior step.
    About 1.0 means the seam is no stronger than any other pixel step."""
    a = np.asarray(a, dtype=np.float64)
    ex = np.abs(a[:, 0] - a[:, -1]).mean() / (np.abs(np.diff(a, axis=1)).mean() + 1e-9)
    ey = np.abs(a[0] - a[-1]).mean() / (np.abs(np.diff(a, axis=0)).mean() + 1e-9)
    return ex, ey


def save(img, name, palette=False):
    path = os.path.join(TEX, name)
    if palette:
        img = img.convert("RGB").quantize(256, method=Image.Quantize.MEDIANCUT,
                                          dither=Image.Dither.NONE)
    img.save(path, optimize=True)
    print(f"  {name:26s} {img.size[0]}x{img.size[1]:<5d} {os.path.getsize(path):>8d} B")
    return path


# ------------------------------------------------- 1, 2: brushed aluminium

def brushed_height(n=512, seed=11):
    """Unit-variance height field with streaks running along U (x)."""
    rng = np.random.default_rng(seed)
    fine = spectral((n, n), rng,
                    lambda fx, fy: np.exp(-(fx / 0.0028) ** 2) * np.exp(-(fy / 0.35) ** 2))
    coarse = spectral((n, n), rng,
                      lambda fx, fy: np.exp(-(fx / 0.0022) ** 2) * np.exp(-(fy / 0.02) ** 2))
    scr = np.zeros((n, n))
    for _ in range(70):   # sparse short scratches, wrapped so they tile
        y = rng.integers(0, n)
        x0 = rng.integers(0, n)
        length = int(rng.integers(40, 180))
        xs = (x0 + np.arange(length)) % n
        scr[y, xs] += rng.choice([-1, 1]) * rng.uniform(1.0, 2.2) * np.hanning(length)
    scr = pblur(scr, 0.45)
    h = fine + 0.55 * coarse + 0.9 * scr
    return (h - h.mean()) / h.std()


def make_brushed(h):
    rough = np.clip(0.32 + 0.026 * h, 0.24, 0.42)
    print(f"    roughness min {rough.min():.3f} max {rough.max():.3f} mean {rough.mean():.3f}")
    save(Image.fromarray(to8(rough * 255.0), "L"), "brushed_rough.png")
    nrm = encode_normal(height_to_normal(h, 0.05))
    save(Image.fromarray(nrm, "RGB"), "brushed_normal.png")
    return rough, nrm


# ------------------------------------------------------------- 3: marble

def make_marble(n=1024, seed=21):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n] / n
    warp_a = fractal(n, rng, 2.0, 0.008)    # broad meanders, 1-6 cycles per tile
    warp_b = fractal(n, rng, 1.7, 0.02)
    warp_c = fractal(n, rng, 1.4, 0.05)     # slight irregular edges only
    warp_a2 = fractal(n, rng, 2.0, 0.008)
    warp_b2 = fractal(n, rng, 1.7, 0.02)
    cloud = fractal(n, rng, 1.8, 0.03)
    cloud_f = fractal(n, rng, 1.2, 0.25)
    mask1 = fractal(n, rng, 2.0, 0.006)
    mask2 = fractal(n, rng, 2.0, 0.006)
    thick = fractal(n, rng, 2.0, 0.01)

    # main vein: one meandering line per tile (integer frequencies keep it periodic)
    ph1 = 2 * np.pi * (xx + yy) + 1.4 * warp_a + 0.35 * warp_b + 0.10 * warp_c
    d1 = np.abs(np.sin(ph1 / 2))
    w1 = 0.028 * np.exp(0.5 * thick)
    v1 = 0.70 * np.exp(-(d1 / w1) ** 2) + 0.40 * np.exp(-(d1 / (w1 * 4.0)) ** 2)
    v1 *= 0.45 + 0.55 * smoothstep(-1.2, 0.8, mask1)
    # secondary veins: thinner, fading in and out along their length
    ph2 = 2 * np.pi * (2 * xx - yy) + 1.3 * warp_a2 + 0.4 * warp_b2 + 0.10 * warp_c
    d2 = np.abs(np.sin(ph2 / 2))
    v2 = 0.65 * np.exp(-(d2 / 0.016) ** 2) + 0.35 * np.exp(-(d2 / 0.06) ** 2)
    v2 *= smoothstep(-0.2, 1.1, mask2)

    op = np.clip(0.40 * v1 + 0.26 * v2, 0, 0.45)
    op = pblur(op, 1.4)

    base = hexc("DCE1DF")
    col = base[None, None, :] + (4.0 * cloud + 1.5 * cloud_f)[..., None]
    col += (np.array([-0.8, 0.4, 0.3]) * cloud[..., None])  # faint cool/green drift
    haze = 0.10 * smoothstep(0.4, 2.2, cloud)
    col = lerp(col, np.array([196, 206, 201.0]), haze[..., None])
    vein = np.array([136, 152, 145.0])
    col = lerp(col, vein, op[..., None])
    out = to8(col)
    save(Image.fromarray(out, "RGB"), "marble_base.png", palette=True)
    return out


# ----------------------------------------------- 4, 5: optical breadboard

def make_optical(h_brush, n=512, ss=4):
    N = n * ss
    c = (np.arange(N) + 0.5) / ss
    lx = (c % 64.0) - 32.0
    X, Y = np.meshgrid(lx, lx)
    r = np.hypot(X, Y)
    hb = np.repeat(np.repeat(h_brush, ss, 0), ss, 1)

    base = hexc("C8CED0")
    col = np.empty((N, N, 3))
    col[:] = base
    col += (2.6 * hb)[..., None]
    # faint light rim just outside the chamfer
    rim = (r >= 9.5) & (r < 11.0)
    col[rim] += (8.0 * np.sin(np.pi * (r[rim] - 9.5) / 1.5))[:, None]
    # chamfer: slightly darker, lit from the top-left
    ch = (r >= 7.0) & (r < 9.5)
    t = (r[ch] - 7.0) / 2.5
    shade = 9.0 * (X[ch] + Y[ch]) / (r[ch] * np.sqrt(2.0))
    col[ch] = lerp(np.array([150, 157, 160.0]), np.array([184, 190, 192.0]), t[:, None]) \
        + shade[:, None]
    # tapped core
    core = r < 7.0
    tc = (r[core] / 7.0) ** 2
    col[core] = lerp(np.array([34, 40, 43.0]), hexc("2A3033") + 8, tc[:, None])
    thread = core & (np.abs(r - 5.4) < 0.45)
    col[thread] += 5.0
    out = to8(downsample(col, ss))
    save(Image.fromarray(out, "RGB"), "optical_holes_base.png", palette=True)

    # height in 1x-pixel units: flat top, rounded edge, 45-ish chamfer, deep core
    hgt = np.where(r < 9.8, -0.9 * (9.8 - r), 0.0)
    hgt = np.where(r < 7.0, -2.52 - 4.0 * smoothstep(7.0, 6.5, r), hgt)
    hgt = pblur(hgt, 0.35 * ss)
    dx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * 0.5 * ss
    dy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) * 0.5 * ss
    s = 0.7
    nv = np.stack([-s * dx, s * dy, np.ones_like(hgt)], -1)
    nv /= np.linalg.norm(nv, axis=-1, keepdims=True)
    nv = downsample(nv, ss)
    nb = height_to_normal(h_brush, 0.035)
    nv = nv + np.concatenate([nb[..., :2], np.zeros((n, n, 1))], -1)
    nv /= np.linalg.norm(nv, axis=-1, keepdims=True)
    nrm = encode_normal(nv)
    save(Image.fromarray(nrm, "RGB"), "optical_holes_normal.png")
    return out, nrm


# ------------------------------------------------------------ 6: concrete

def make_concrete(n=512, seed=41):
    rng = np.random.default_rng(seed)
    mott = fractal(n, rng, 1.8, 0.03)
    mid = fractal(n, rng, 1.0, 0.12)
    grain = pblur(rng.standard_normal((n, n)), 0.6)
    grain /= grain.std()
    lum = 4.5 * mott + 2.0 * mid + 2.0 * grain

    def specks(count, sigma, lo, hi):
        imp = np.zeros(n * n)
        idx = rng.integers(0, n * n, count)
        np.add.at(imp, idx, rng.uniform(lo, hi, count))
        return pblur(imp.reshape(n, n), sigma) * (2 * np.pi * sigma ** 2)

    dark = (specks(1800, 0.55, 18, 40) + specks(350, 0.9, 18, 36)
            + specks(40, 1.4, 22, 38))
    light = specks(1200, 0.55, 12, 26) + specks(200, 0.9, 10, 20)
    col = hexc("A9AEAC")[None, None, :] + lum[..., None]
    col -= dark[..., None] * np.array([1.0, 0.96, 0.93])
    col += light[..., None] * np.array([1.0, 1.0, 0.98])
    out = to8(col)
    save(Image.fromarray(out, "RGB"), "concrete_base.png", palette=True)
    return out


# ---------------------------------------------------------- 7: plates atlas

INK = (17, 72, 84)
INK2 = (12, 50, 62)
GOLD = (184, 149, 79)
LENS = (156, 208, 200)
LEAF = (128, 186, 160)
PALEGOLD = (238, 228, 204)
PAPER = (244, 250, 247)


class Pen:
    """Draws in plate units (plate width = 100 units) on a supersampled canvas."""

    def __init__(self, img, ox, oy, k, ss):
        self.img, self.d = img, ImageDraw.Draw(img)
        self.ox, self.oy, self.k, self.ss = ox, oy, k, ss

    def P(self, x, y):
        return (self.ox + x * self.k, self.oy + y * self.k)

    def wpx(self, w):
        return max(1, int(round(w * 2.3 * self.ss)))   # 2.3: bold enough to read from the hero camera

    def line(self, pts, col=INK, w=0.8):
        self.d.line([self.P(*q) for q in pts], fill=col, width=self.wpx(w), joint="curve")

    def dash(self, p0, p1, col=INK, w=0.6, on=2.6, off=1.8):
        p0, p1 = np.array(p0, float), np.array(p1, float)
        L = np.linalg.norm(p1 - p0)
        u = (p1 - p0) / L
        s = 0.0
        while s < L:
            e = min(L, s + on)
            self.line([tuple(p0 + u * s), tuple(p0 + u * e)], col, w)
            s = e + off

    def circ(self, cx, cy, r, col=INK, w=0.8, fill=None):
        a, b = self.P(cx - r, cy - r), self.P(cx + r, cy + r)
        self.d.ellipse([a, b], fill=fill, outline=col, width=self.wpx(w) if col else 0)

    def ell(self, cx, cy, rx, ry, col=INK, w=0.8, fill=None):
        a, b = self.P(cx - rx, cy - ry), self.P(cx + rx, cy + ry)
        self.d.ellipse([a, b], fill=fill, outline=col, width=self.wpx(w) if col else 0)

    def dot(self, cx, cy, r, col):
        self.circ(cx, cy, r, None, 0, fill=col)

    def poly(self, pts, fill=None, col=INK, w=0.8):
        q = [self.P(*p) for p in pts]
        if fill is not None:
            self.d.polygon(q, fill=fill)
        if col is not None:
            self.d.line(q + [q[0]], fill=col, width=self.wpx(w), joint="curve")

    def arc(self, cx, cy, r, a0, a1, col=INK, w=0.8, n=48):
        a = np.radians(np.linspace(a0, a1, n))
        self.line(list(zip(cx + r * np.cos(a), cy + r * np.sin(a))), col, w)

    def chevron(self, p0, p1, at=0.5, size=2.0, col=INK, w=0.8):
        p0, p1 = np.array(p0, float), np.array(p1, float)
        d = (p1 - p0) / np.linalg.norm(p1 - p0)
        tip = p0 + at * (p1 - p0)
        for sgn in (1, -1):
            a = np.radians(152 * sgn)
            rd = np.array([d[0] * np.cos(a) - d[1] * np.sin(a), d[0] * np.sin(a) + d[1] * np.cos(a)])
            self.line([tuple(tip + rd * size), tuple(tip)], col, w)

    def text(self, x, y, s, col=INK2, size=8, path=FONT_SERIF):
        self.d.text(self.P(x, y), s, font=font(path, int(size * self.ss)), fill=col, anchor="mm")

    def field(self, x0, y0, x1, y1, func, col=INK2, circle=False):
        X0, Y0 = (int(round(v)) for v in self.P(x0, y0))
        X1, Y1 = (int(round(v)) for v in self.P(x1, y1))
        w, h = X1 - X0, Y1 - Y0
        U, V = np.meshgrid((np.arange(w) + 0.5) / w * 2 - 1, (np.arange(h) + 0.5) / h * 2 - 1)
        a = np.clip(func(U, V), 0, 1)
        if circle:
            a = a * (U ** 2 + V ** 2 <= 1.0)
        reg = np.asarray(self.img.crop((X0, Y0, X1, Y1))).astype(np.float64)
        out = reg * (1 - a[..., None]) + np.array(col, float) * a[..., None]
        self.img.paste(Image.fromarray(to8(out)), (X0, Y0))


def lens_pts(cx, cy, H, left, right, e, n=40):
    """Lens outline: left/right sagitta (+ convex, - concave), e = half edge thickness."""
    ys = np.linspace(-H, H, n)
    prof = 1 - (ys / H) ** 2
    lx = cx - e - left * prof
    rx = cx + e + right * prof
    return list(zip(lx, cy + ys)) + list(zip(rx[::-1], cy + ys[::-1]))


def ray_end(x0, y0, dx, dy, box=(6, 24, 94, 106)):
    ts = []
    if dx > 0:
        ts.append((box[2] - x0) / dx)
    if dx < 0:
        ts.append((box[0] - x0) / dx)
    if dy > 0:
        ts.append((box[3] - y0) / dy)
    if dy < 0:
        ts.append((box[1] - y0) / dy)
    t = min(ts)
    return (x0 + dx * t, y0 + dy * t)


def axis(p, cy, x0=6, x1=94):
    p.dash((x0, cy), (x1, cy), INK2, 0.45, 4.0, 1.2)


def d_biconvex(p):
    cy, cx, f = 62, 40, 28
    axis(p, cy)
    p.poly(lens_pts(cx, cy, 26, 4.5, 4.5, 1.2), LENS, INK2, 1.1)
    for h in (-20, -13, -6.5, 6.5, 13, 20):
        p.line([(8, cy + h), (cx, cy + h)])
        p.chevron((8, cy + h), (cx, cy + h), 0.45)
        p.line([(cx, cy + h), ray_end(cx, cy + h, f, -h)])
    p.dot(cx + f, cy, 1.7, GOLD)
    p.text(cx + f, cy + 8, "F", GOLD, 7)
    p.dot(cx - f, cy, 1.0, INK2)


def d_biconcave(p):
    cy, cx, f = 62, 48, 24
    axis(p, cy)
    p.poly(lens_pts(cx, cy, 25, -5.0, -5.0, 6.6), LENS, INK2, 1.1)
    for h in (-18, -10, -3.5, 3.5, 10, 18):
        p.line([(8, cy + h), (cx, cy + h)])
        p.chevron((8, cy + h), (cx, cy + h), 0.4)
        p.line([(cx, cy + h), ray_end(cx, cy + h, f, h)])
        p.dash((cx, cy + h), (cx - f, cy), GOLD, 0.5, 1.8, 1.4)
    p.dot(cx - f, cy, 1.7, GOLD)
    p.text(cx - f, cy + 8, "F", GOLD, 7)


def d_prism(p):
    A, B, C = (48, 36), (24, 82), (72, 82)
    p.poly([A, B, C], LENS, INK2, 1.2)
    hit = (A[0] + (B[0] - A[0]) * 0.55, A[1] + (B[1] - A[1]) * 0.55)
    out = (A[0] + (C[0] - A[0]) * 0.52, A[1] + (C[1] - A[1]) * 0.52)
    p.line([(6, 72), hit], INK2, 1.3)
    p.chevron((6, 72), hit, 0.5, 2.2, INK2, 1.0)
    p.line([hit, out], INK, 1.0)
    fan = [(23, 67, 76), (30, 92, 102), (42, 118, 124), (70, 138, 132),
           (120, 148, 112), (160, 150, 92), (184, 149, 79)]
    for i, c in enumerate(fan):
        p.line([out, (91, 52 + i * 5.2)], c, 0.95)
    p.line([(92, 46), (92, 92)], INK2, 1.6)
    for y in np.arange(47, 92, 3.0):
        p.line([(92.5, y), (95, y - 2)], INK2, 0.45)


def d_airy(p):
    cx, cy, R = 50, 56, 29

    def f(U, V):
        r = np.hypot(U, V) * 13.0 + 1e-6
        return 0.92 * ((2 * special.j1(r) / r) ** 2) ** 0.32
    p.field(cx - R, cy - R, cx + R, cy + R, f, INK2, circle=True)
    p.circ(cx, cy, R, INK2, 0.8)
    y0 = 106
    p.line([(14, y0), (86, y0)], INK2, 0.6)
    xs = np.linspace(-1, 1, 240)
    r = np.abs(xs) * 13 + 1e-6
    I = (2 * special.j1(r) / r) ** 2
    p.line([(50 + 34 * x, y0 - 18 * i) for x, i in zip(xs, I)], GOLD, 0.9)
    for z in (3.8317, 7.0156, 10.1735):
        for s in (-1, 1):
            x = 50 + s * 34 * z / 13
            p.line([(x, y0), (x, y0 + 2.2)], INK2, 0.5)


def d_two_source(p):
    def f(U, V):
        X = 50 + U * 36
        Y = 63 + V * 31
        r1 = np.hypot(X - 42, Y - 30)
        r2 = np.hypot(X - 58, Y - 30)
        I = np.cos(np.pi * (r1 - r2) / 3.4) ** 2
        return 0.85 * I * (0.5 + 0.5 * np.exp(-((X - 50) / 30) ** 2))
    p.field(14, 32, 86, 94, f, INK2)
    p.poly([(14, 32), (86, 32), (86, 94), (14, 94)], None, INK2, 0.8)
    for a, b in ((14, 40.8), (43.2, 56.8), (59.2, 86)):
        p.line([(a, 30), (b, 30)], INK2, 1.6)
    p.dot(42, 30, 1.2, GOLD)
    p.dot(58, 30, 1.2, GOLD)
    for y in (20, 23.5, 27):
        p.line([(30, y), (70, y)], INK, 0.55)


def d_fringes(p):
    def f(U, V):
        I = np.cos(np.pi * U * 4.5) ** 2 * np.sinc(U * 1.3) ** 2
        return 0.9 * I ** 0.6
    p.field(16, 30, 84, 74, f, INK2)
    p.poly([(16, 30), (84, 30), (84, 74), (16, 74)], None, INK2, 0.8)
    y0 = 104
    p.line([(16, y0), (84, y0)], INK2, 0.6)
    p.line([(50, y0), (50, 80)], INK2, 0.45)
    xs = np.linspace(-1, 1, 300)
    I = np.cos(np.pi * xs * 4.5) ** 2 * np.sinc(xs * 1.3) ** 2
    env = np.sinc(xs * 1.3) ** 2
    p.line([(50 + 34 * x, y0 - 22 * i) for x, i in zip(xs, I)], INK, 0.9)
    pts = [(50 + 34 * x, y0 - 22 * e) for x, e in zip(xs, env)]
    for i in range(0, len(pts) - 6, 10):
        p.line(pts[i:i + 6], GOLD, 0.6)


def d_newton(p):
    cx, cy, R = 50, 52, 27

    def f(U, V):
        r2 = U ** 2 + V ** 2
        return 0.85 * np.cos(np.pi * 7 * r2) ** 2 * (1 - 0.3 * np.sqrt(r2))
    p.field(cx - R, cy - R, cx + R, cy + R, f, INK2, circle=True)
    p.circ(cx, cy, R, INK2, 0.8)
    xs = np.linspace(22, 78, 60)
    bot = 98 - (xs - 50) ** 2 / 260.0
    p.poly([(22, 88)] + list(zip(xs, bot)) + [(78, 88)], LENS, INK2, 0.9)
    p.poly([(16, 98.6), (84, 98.6), (84, 103), (16, 103)], LENS, INK2, 0.9)
    for x in (34, 50, 66):
        p.dash((x, 81), (x, 87), GOLD, 0.6, 1.4, 1.0)


def d_leaf(p):
    L = 70.0
    base = np.array([36.0, 104.0])
    ang = np.radians(22)
    dvec = np.array([np.sin(ang), -np.cos(ang)])
    nvec = np.array([-dvec[1], dvec[0]])
    s = np.linspace(0, L, 80)
    u = s / L
    w = 17.0 * np.sin(np.pi * u) ** 0.85 * (1 - 0.28 * u) + 1e-3

    def at(si, wi):
        return tuple(base + dvec * si + nvec * wi)
    outline = [at(a, b) for a, b in zip(s, w)] + [at(a, -b) for a, b in zip(s[::-1], w[::-1])]
    p.poly(outline, LEAF, INK, 1.0)
    for i in range(7):
        s0 = L * (0.10 + 0.11 * i)
        s1 = min(L * 0.97, s0 + L * 0.2)
        w1 = np.interp(s1, s, w) * 0.88
        for sg in (1, -1):
            pts = []
            for t in np.linspace(0, 1, 12):
                si = s0 + (s1 - s0) * t
                wi = sg * w1 * np.sin(t * np.pi / 2) ** 0.8
                pts.append(at(si, wi))
            p.line(pts, INK, 0.6)
    p.line([at(-12, 0), at(L * 0.98, 0)], INK2, 1.3)
    y = 116
    p.line([(30, y), (70, y)], GOLD, 0.7)
    for x in np.linspace(30, 70, 5):
        p.line([(x, y - 1.6), (x, y + 1.6)], GOLD, 0.6)


def d_ginkgo(p):
    bx, by = 50, 96
    th = np.radians(np.linspace(-148, -32, 120))
    r = 40 * (1 - 0.30 * np.exp(-((np.degrees(th) + 90) / 5.0) ** 2)) + 0.9 * np.sin(14 * th)
    edge = list(zip(bx + r * np.cos(th), by + r * np.sin(th)))
    p.poly([(bx, by)] + edge, LEAF, INK2, 1.1)
    for a in np.radians(np.linspace(-144, -36, 26)):
        rr = 40 * (1 - 0.30 * np.exp(-((np.degrees(a) + 90) / 5.0) ** 2)) * 0.95
        mid = (bx + 0.5 * rr * np.cos(a), by + 0.5 * rr * np.sin(a))
        for da in (-0.035, 0.035):
            p.line([(bx, by), mid, (bx + rr * np.cos(a + da), by + rr * np.sin(a + da))], INK, 0.45)
    p.line([(bx, by), (bx - 1.5, 106), (bx - 4, 114)], INK2, 1.3)


def d_eye(p):
    cx, cy, R = 54, 62, 27
    p.circ(cx, cy, R, INK2, 1.4, fill=(236, 246, 241))
    p.arc(cx, cy, R - 2.2, -55, 55, GOLD, 0.8)
    p.arc(cx - 13, cy, 17.5, 140, 220, INK2, 1.2)
    p.ell(cx - 17.5, cy, 4.2, 9.0, INK, 0.9, fill=LENS)
    for sg in (1, -1):
        p.line([(cx - 21.5, cy + sg * 7.5), (cx - 21.5, cy + sg * 16.5)], INK2, 1.8)
    for h in (-8, 0, 8):
        p.line([(6, cy + h), (cx - 30, cy + h), (cx - 17.5, cy + h * 0.55), (cx + R - 2.2, cy)], INK, 0.7)
    p.dot(cx + R - 2.2, cy, 1.6, GOLD)
    a1, a2 = np.radians(14), np.radians(30)
    p.line([(cx + R * np.cos(a1), cy + R * np.sin(a1)), (cx + R + 10, cy + 10)], INK2, 1.0)
    p.line([(cx + R * np.cos(a2), cy + R * np.sin(a2)), (cx + R + 8, cy + 19)], INK2, 1.0)


def d_iris(p, seed=5):
    rng = np.random.default_rng(seed)
    cx, cy = 50, 62
    p.circ(cx, cy, 31, INK2, 1.6, fill=(225, 240, 236))
    for a in np.linspace(0, 2 * np.pi, 110, endpoint=False):
        a2 = a + rng.normal(0, 0.03)
        wob = rng.normal(0, 0.05)
        pts = [(cx + r * np.cos(a2 + wob * (r - 11) / 18), cy + r * np.sin(a2 + wob * (r - 11) / 18))
               for r in (11.5, 20, 29)]
        p.line(pts, INK, 0.45)
    th = np.linspace(0, 2 * np.pi, 200)
    rr = 17 + 1.3 * np.sin(12 * th)
    p.line(list(zip(cx + rr * np.cos(th), cy + rr * np.sin(th))), GOLD, 0.9)
    p.circ(cx, cy, 10.5, INK2, 0.6, fill=INK2)
    p.dot(cx - 4, cy - 4, 2.0, (200, 225, 222))


def d_pod(p):
    cx, cy, R, off = 50, 60, 40, 28.5
    hh = np.sqrt(R ** 2 - off ** 2)
    a = np.degrees(np.arcsin(hh / R))
    t = np.radians(np.linspace(-a, a, 40))
    right = list(zip(cx - off + R * np.cos(t), cy + R * np.sin(t)))
    left = list(zip(cx + off - R * np.cos(t), cy - R * np.sin(t)))
    p.poly(right + left, LEAF, INK2, 1.3)
    p.line([(cx, cy - hh + 2), (cx, cy + hh - 2)], INK, 0.55)
    for i, y in enumerate(np.linspace(-hh * 0.68, hh * 0.68, 6)):
        sx = cx + (2.6 if i % 2 else -2.6)
        p.line([(cx, cy + y), (sx, cy + y)], INK, 0.5)
        p.ell(sx + (1.6 if i % 2 else -1.6), cy + y, 3.0, 2.3, GOLD, 0.7, fill=PALEGOLD)
    tip = cy + hh
    p.line([(cx, tip), (cx - 2, tip + 8), (cx - 6, tip + 15)], INK2, 1.2)
    p.poly([(cx, tip - 1), (cx - 8, tip + 3), (cx - 1, tip + 4)], LEAF, INK, 0.6)
    p.poly([(cx, tip - 1), (cx + 8, tip + 3), (cx + 1, tip + 4)], LEAF, INK, 0.6)


def d_planoconvex(p):
    cy, cx, f = 60, 34, 34
    axis(p, cy)
    p.poly(lens_pts(cx, cy, 24, 0.0, 7.0, 1.5), LENS, INK2, 1.1)
    for h in (-18, -9, 9, 18):
        p.line([(8, cy + h), (cx, cy + h)])
        p.chevron((8, cy + h), (cx, cy + h), 0.45)
        p.line([(cx, cy + h), ray_end(cx, cy + h, f, -h)])
    p.dot(cx + f, cy, 1.7, GOLD)
    y = 96
    p.line([(cx, y), (cx + f, y)], GOLD, 0.7)
    p.line([(cx, y - 2.5), (cx, y + 2.5)], GOLD, 0.7)
    p.line([(cx + f, y - 2.5), (cx + f, y + 2.5)], GOLD, 0.7)
    p.text(cx + f / 2, y + 6, "f", GOLD, 7)


def d_diatom(p):
    cx, cy = 50, 62
    p.circ(cx, cy, 31, INK2, 1.5, fill=(230, 243, 238))
    p.circ(cx, cy, 28.5, INK, 0.5)
    for a in np.linspace(0, 2 * np.pi, 16, endpoint=False):
        p.line([(cx + 5 * np.cos(a), cy + 5 * np.sin(a)), (cx + 28.5 * np.cos(a), cy + 28.5 * np.sin(a))],
               INK, 0.5)
    for j in range(7):
        r = 7.5 + 3.3 * j
        n = int(round(2 * np.pi * r / 3.1))
        for a in np.linspace(0, 2 * np.pi, n, endpoint=False) + j * 0.1:
            p.dot(cx + r * np.cos(a), cy + r * np.sin(a), 0.75, INK)
    p.circ(cx, cy, 4.2, GOLD, 0.9)


def d_telescope(p):
    cy = 62
    x1, x2, f1, f2 = 22, 72, 38, 12
    axis(p, cy)
    p.poly(lens_pts(x1, cy, 22, 4.5, 4.5, 1.0), LENS, INK2, 1.1)
    p.poly(lens_pts(x2, cy, 10, 3.0, 3.0, 0.8), LENS, INK2, 1.0)
    fx = x1 + f1
    for h in (-16, -8, 8, 16):
        p.line([(6, cy + h), (x1, cy + h), (fx, cy), (x2, cy - h * f2 / f1), (94, cy - h * f2 / f1)], INK, 0.75)
    p.chevron((6, cy - 16), (x1, cy - 16), 0.5)
    p.dot(fx, cy, 1.6, GOLD)
    p.dash((x1, 90), (x2, 90), GOLD, 0.6, 2.0, 1.2)
    for x in (x1, x2):
        p.line([(x, 87.5), (x, 92.5)], GOLD, 0.6)


def d_mirror(p):
    Cx, cy, R = 30, 62, 52
    a = np.radians(np.linspace(-34, 34, 60))
    arc = list(zip(Cx + R * np.cos(a), cy + R * np.sin(a)))
    for t in np.radians(np.linspace(-32, 32, 15)):
        x, y = Cx + R * np.cos(t), cy + R * np.sin(t)
        p.line([(x, y), (x + 3.0, y - 2.4)], INK2, 0.5)
    axis(p, cy)
    for h in (-24, -16, -8, 8, 16, 24):
        hx = Cx + np.sqrt(R ** 2 - h ** 2)
        nrm = np.array([hx - Cx, h]) / R
        d = np.array([1.0, 0.0])
        rr = d - 2 * d.dot(nrm) * nrm
        p.line([(8, cy + h), (hx, cy + h), ray_end(hx, cy + h, rr[0], rr[1], (40, 24, 94, 106))], INK, 0.7)
        p.chevron((8, cy + h), (hx, cy + h), 0.3)
    p.line(arc, INK2, 1.6)
    p.dot(Cx + R / 2, cy, 1.6, GOLD)
    p.dot(Cx, cy, 1.0, INK2)
    p.text(Cx, cy + 7, "C", INK2, 6)


def d_snell(p):
    p.poly([(22, 50), (78, 50), (78, 76), (22, 76)], LENS, INK2, 1.1)
    hx = 40
    th2 = np.arcsin(np.sin(np.pi / 4) / 1.5)
    ex = hx + 26 * np.tan(th2)
    p.line([(16, 26), (hx, 50), (ex, 76), (ex + 20, 96)], INK, 1.0)
    p.chevron((16, 26), (hx, 50), 0.5, 2.2)
    p.dash((hx, 50), (hx + 26, 76), INK, 0.45, 1.6, 1.2)
    for x, y in ((hx, 50), (ex, 76)):
        p.dash((x, y - 13), (x, y + 13), INK2, 0.45, 1.8, 1.2)
    p.arc(hx, 50, 8, -135, -90, GOLD, 0.8)
    p.arc(hx, 50, 8, 90 - np.degrees(th2), 90, GOLD, 0.8)
    p.arc(ex, 76, 7, 45, 90, GOLD, 0.8)


def d_floral(p):
    cx, cy = 50, 64

    def band(r0, ang, half, thick, n=30):
        t = np.linspace(-1, 1, n)
        a = np.radians(ang + half * t)
        taper = np.cos(t * np.pi / 2) ** 0.7
        ro = r0 + thick / 2 * taper
        ri = r0 - thick / 2 * taper
        return list(zip(cx + ro * np.cos(a), cy + ro * np.sin(a))) + \
            list(zip(cx + ri[::-1] * np.cos(a[::-1]), cy + ri[::-1] * np.sin(a[::-1])))
    p.dot(cx, cy - 37, 1.8, INK2)
    p.poly(band(36, 90, 26, 3.5), LEAF, INK, 0.7)
    for i in range(5):
        p.poly(band(28, -90 + 72 * i, 30, 5.5), LEAF, INK2, 0.9)
    for i in range(5):
        p.poly(band(20.5, -54 + 72 * i, 28, 5.0), PALEGOLD, GOLD, 0.9)
    for i in range(5):
        a = np.radians(-90 + 72 * i)
        x, y = cx + 13.5 * np.cos(a), cy + 13.5 * np.sin(a)
        tx, ty = -np.sin(a) * 1.7, np.cos(a) * 1.7
        p.circ(x + tx, y + ty, 1.7, INK, 0.6, fill=LENS)
        p.circ(x - tx, y - ty, 1.7, INK, 0.6, fill=LENS)
    p.circ(cx, cy, 7, INK2, 1.1, fill=(230, 243, 238))
    for a in np.radians([-90, 30, 150]):
        p.line([(cx, cy), (cx + 7 * np.cos(a), cy + 7 * np.sin(a))], INK2, 0.6)
    for a in np.radians([-30, 90, 210]):
        p.dot(cx + 3.6 * np.cos(a), cy + 3.6 * np.sin(a), 1.0, GOLD)


PANELS = [
    [d_biconvex, d_prism, d_airy, d_leaf, d_eye, d_pod],
    [d_biconcave, d_two_source, d_iris, d_planoconvex, d_ginkgo, d_diatom],
    [d_telescope, d_fringes, d_newton, d_mirror, d_snell, d_floral],
]
ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII",
         "XIII", "XIV", "XV", "XVI", "XVII", "XVIII"]


def make_display_atlas(ss=4):
    P, M, G = 512, 20, 14
    PW, PH = (P - 2 * M - 2 * G) // 3, (P - 2 * M - G) // 2   # 148 x 229
    yy, xx = np.mgrid[0:P, 0:P]
    d = np.hypot((xx + 0.5 - P / 2) / (P / 2), (yy + 0.5 - P / 2) / (P / 2)) / np.sqrt(2)
    t = smoothstep(0.12, 1.0, d) ** 1.3
    bg = to8(lerp(hexc("E3F2EA"), np.array([208, 229, 218.0]), t[..., None]))
    atlas = Image.new("RGB", (3 * P, P))
    for pi, plates in enumerate(PANELS):
        big = Image.fromarray(bg).resize((P * ss, P * ss), Image.BICUBIC)
        dr = ImageDraw.Draw(big)
        for j, fn in enumerate(plates):
            x0 = (M + (j % 3) * (PW + G)) * ss
            y0 = (M + (j // 3) * (PH + G)) * ss
            dr.rectangle([x0, y0, x0 + PW * ss - 1, y0 + PH * ss - 1], fill=PAPER)
            pen = Pen(big, x0, y0, PW * ss / 100.0, ss)
            fn(pen)
            hu = PH / PW * 100
            pen.poly([(0.6, 0.6), (99.4, 0.6), (99.4, hu - 0.6), (0.6, hu - 0.6)], None, INK2, 1.1)
            pen.poly([(3.6, 3.6), (96.4, 3.6), (96.4, hu - 3.6), (3.6, hu - 3.6)], None, INK, 0.45)
            pen.line([(38, 125), (62, 125)], GOLD, 0.7)
            pen.text(50, 133, ROMAN[pi * 6 + j], INK2, 8.5)
            pen.line([(26, 142), (74, 142)], (150, 182, 176), 0.8)
            pen.line([(34, 147), (66, 147)], (150, 182, 176), 0.8)
        atlas.paste(big.resize((P, P), Image.LANCZOS), (pi * P, 0))
    save(atlas, "display_atlas.png", palette=True)
    return atlas


# ------------------------------------------------- 8: specimen (Gray-Scott)

def gray_scott(n=256, steps=6000, seed=51, f=0.0545, k=0.062):
    rng = np.random.default_rng(seed)
    A = np.ones((n, n), np.float32)
    B = np.zeros((n, n), np.float32)
    for _ in range(int(48 * (n / 256) ** 2)):
        y, x = rng.integers(0, n, 2)
        s = int(rng.integers(2, 5))
        ys, xs = np.arange(y - s, y + s) % n, np.arange(x - s, x + s) % n
        B[np.ix_(ys, xs)] = 1.0
        A[np.ix_(ys, xs)] = 0.5
    A += rng.normal(0, 0.02, (n, n)).astype(np.float32)

    def lap(U):
        s = np.roll(U, 1, 0) + np.roll(U, -1, 0)
        e = np.roll(U, 1, 1) + np.roll(U, -1, 1)
        dg = np.roll(s, 1, 1) + np.roll(s, -1, 1)
        return 0.2 * (s + e) + 0.05 * dg - U
    for _ in range(steps):
        abb = A * B * B
        A += lap(A) - abb + f * (1 - A)
        B += 0.5 * lap(B) + abb - (k + f) * B
    return A, B


def make_specimen(n=512, seed=51):
    t0 = time.time()
    _, B = gray_scott(n=n, steps=7000, seed=seed)
    B = ndimage.zoom(B.astype(np.float64), n / B.shape[0], order=3, mode="grid-wrap")
    tn = B / np.percentile(B, 99.5)
    pat = smoothstep(0.40, 0.65, tn)
    print(f"    gray-scott {time.time() - t0:.1f}s, pattern coverage {pat.mean():.2f}")
    yy, xx = np.mgrid[0:n, 0:n]
    rr = np.hypot(xx + 0.5 - n / 2, yy + 0.5 - n / 2) / (n / 2)
    vig = 1 - smoothstep(0.5, 0.97, rr)
    rng = np.random.default_rng(seed + 1)
    var = fractal(n, rng, 2.0, 0.02)
    m = np.clip(0.25 + 0.75 * rr + 0.12 * var, 0, 1)
    col = lerp(hexc("3BA3B5"), hexc("1C4F8A"), m[..., None])
    col = lerp(col, hexc("1C4F8A") * 0.85, (0.25 * pat * (1 - m))[..., None])
    alpha = 0.08 + 0.77 * pat * vig
    rgba = np.dstack([to8(col), to8(alpha * 255)])
    img = Image.fromarray(rgba, "RGBA")
    save(img, "specimen_pattern.png")
    return img


# --------------------------------------------------------- 9: lens print

def make_print(ss=4, seed=61):
    W, H, M = 512, 640, 40
    ys, xs = np.mgrid[0:H * ss, 0:W * ss]
    X, Y = (xs + 0.5) / ss, (ys + 0.5) / ss
    rng = np.random.default_rng(seed)
    mat = np.array([238, 235, 227.0])
    col = np.empty((H * ss, W * ss, 3))
    col[:] = mat
    inner = (X > M) & (X < W - M) & (Y > M) & (Y < H - M)
    bevel = (X > M - 3) & (X < W - M + 3) & (Y > M - 3) & (Y < H - M + 3) & ~inner
    col[bevel] = (249, 247, 241)
    navy = hexc("1B2A4A")
    cx, cy = W / 2, H / 2 - 18
    d = np.hypot((X - cx) / 260, (Y - cy) / 320)
    field = navy + 6.0 * (1 - np.clip(d, 0, 1))[..., None]
    shadow = smoothstep(M + 7, M, Y) * 0.35   # mat casts a soft shadow on the top edge
    field = field * (1 - shadow[..., None])
    col = np.where(inner[..., None], field, col)
    R, off = 96.0, 48.0
    pale = np.array([182, 196, 210.0])
    d1 = np.hypot(X - (cx - off), Y - cy)
    d2 = np.hypot(X - (cx + off), Y - cy)
    c1, c2 = (d1 <= R).astype(float), (d2 <= R).astype(float)
    op = 0.07 * (c1 + c2) + 0.20 * c1 * c2
    op = op + 0.78 * ((np.abs(d1 - R) < 0.6) | (np.abs(d2 - R) < 0.6))
    op = op + 0.55 * ((np.abs(Y - cy) < 0.4) & (np.abs(X - cx) < 170))
    op = op + 0.85 * ((np.hypot(X - (cx - off), Y - cy) < 2.2) | (np.hypot(X - (cx + off), Y - cy) < 2.2))
    op = np.clip(op, 0, 1) * inner
    col = lerp(col, pale, op[..., None])
    out = downsample(col, ss)
    out += rng.normal(0, 0.8, out.shape[:2])[..., None] * (out.mean(-1, keepdims=True) > 150)
    img = Image.fromarray(to8(out), "RGB")
    save(img, "print_lens.png", palette=True)
    return img


# ------------------------------------------------------- 10: oscilloscope

def make_scope(ss=4, seed=81):
    W, H = 512, 384
    rng = np.random.default_rng(seed)

    def mask(draw_fn):
        im = Image.new("L", (W * ss, H * ss), 0)
        draw_fn(ImageDraw.Draw(im))
        return np.asarray(im.resize((W, H), Image.BOX), dtype=np.float64) / 255.0

    def grid(d):
        for i in range(11):
            x = min(max(i * W / 10, 0.6), W - 0.6) * ss
            d.line([(x, 0), (x, H * ss)], fill=255, width=ss)
        for j in range(9):
            y = min(max(j * H / 8, 0.6), H - 0.6) * ss
            d.line([(0, y), (W * ss, y)], fill=255, width=ss)

    def ticks(d):
        for i in range(51):
            x = i * W / 50 * ss
            d.line([(x, (H / 2 - 3) * ss), (x, (H / 2 + 3) * ss)], fill=255, width=ss)
        for j in range(41):
            y = j * H / 40 * ss
            d.line([((W / 2 - 3) * ss, y), ((W / 2 + 3) * ss, y)], fill=255, width=ss)

    t = np.linspace(0, 1, 240)
    sm = np.convolve(rng.normal(0, 0.022, t.size), [0.25, 0.5, 0.25], "same")
    walk = np.cumsum(rng.normal(0, 0.006, t.size))
    walk -= np.linspace(walk[0], walk[-1], t.size)
    ya = 0.10 + 0.05 * t + 0.70 / (1 + np.exp(-(t - 0.42) * 9)) + sm + walk
    yt = 0.06 + 0.62 * (1 - np.exp(-t / 0.12))
    late = t > 0.35
    yt[late] += -0.12 * (t[late] - 0.35) + 0.05 * np.sin(2 * np.pi * (t[late] - 0.35) * 1.6)
    yt += np.convolve(rng.normal(0, 0.008, t.size), [0.25, 0.5, 0.25], "same")

    def trace(y, w):
        pts = [((0.03 + 0.94 * a) * W * ss, (1 - np.clip(b, 0.03, 0.97)) * H * ss) for a, b in zip(t, y)]
        return lambda d: d.line(pts, fill=255, width=int(w * ss), joint="curve")

    g, tk = mask(grid), mask(ticks)
    am, te = mask(trace(ya, 1.7)), mask(trace(yt, 1.4))
    yy, xx = np.mgrid[0:H, 0:W]
    rd = np.hypot((xx - W / 2) / (W / 2), (yy - H / 2) / (H / 2))
    out = hexc("07130F")[None, None, :] / 255 * (1 + 0.4 * (1 - np.clip(rd, 0, 1.4) ** 2 / 2))[..., None]
    gcol = np.array([38, 98, 66]) / 255
    out = out + g[..., None] * 0.5 * gcol + tk[..., None] * 0.6 * gcol
    gf = ndimage.gaussian_filter
    amber = np.array([255, 172, 58]) / 255
    out += amber * (am * 0.95 + gf(am, 2.0) * 0.9 + gf(am, 7.0) * 0.45)[..., None]
    out += np.array([1.0, 0.93, 0.78]) * (np.clip(am - 0.45, 0, 1) * 0.55)[..., None]
    teal = np.array([64, 176, 168]) / 255
    out += teal * (te * 0.55 + gf(te, 2.0) * 0.5 + gf(te, 7.0) * 0.2)[..., None]
    img = Image.fromarray(to8(np.clip(out, 0, 1) * 255), "RGB")
    save(img, "scope_screen.png")
    return img


# ------------------------------------------------------- 11: book spines

def make_books(ss=4, seed=71):
    W = H = 512
    rng = np.random.default_rng(seed)
    cols = [(176, 166, 148), (96, 108, 112), (138, 150, 130), (150, 116, 98),
            (62, 74, 94), (72, 72, 74), (152, 142, 130), (112, 110, 84)]
    x = (np.arange(64 * ss) + 0.5) / (64 * ss)
    prof = 0.80 + 0.24 * np.sin(np.pi * x) ** 0.6
    arr = np.concatenate([np.array(c, float)[None, :] * prof[:, None] for c in cols], 0)
    base = np.repeat(arr[None], H * ss, 0)
    img = Image.fromarray(to8(base), "RGB")
    d = ImageDraw.Draw(img)
    gold = GOLD
    for i, c in enumerate(cols):
        x0, x1 = i * 64 * ss, (i + 1) * 64 * ss
        style = i % 4
        for yb in (20, 26, 486, 492):
            d.rectangle([x0 + 4 * ss, yb * ss, x1 - 4 * ss, (yb + 1.6) * ss], fill=gold)
        ty = int(rng.integers(92, 150))
        th = int(rng.integers(80, 130))
        lab = tuple(int(v * 0.72) for v in c) if style != 1 else (228, 220, 198)
        d.rectangle([x0 + 9 * ss, ty * ss, x1 - 9 * ss, (ty + th) * ss], fill=lab,
                    outline=gold, width=ss)
        ink = gold if style != 1 else (70, 62, 50)
        for k in range(3 if style != 2 else 2):
            yy = ty + th * (0.3 + 0.2 * k)
            half = (14 - 3 * k) if style != 3 else 10
            d.rectangle([x0 + (32 - half) * ss, yy * ss, x0 + (32 + half) * ss, (yy + 2.2) * ss], fill=ink)
        if style in (0, 2):
            for yr in (240, 300, 360):
                d.rectangle([x0, yr * ss, x1, (yr + 3) * ss], fill=tuple(int(v * 0.68) for v in c))
                d.rectangle([x0, (yr + 3) * ss, x1, (yr + 4) * ss], fill=tuple(min(255, int(v * 1.12)) for v in c))
        else:
            d.rectangle([x0 + 14 * ss, 420 * ss, x1 - 14 * ss, 440 * ss], outline=gold, width=ss)
        d.line([(x0, 0), (x0, H * ss)], fill=(30, 30, 30), width=ss)
    out = np.asarray(img.resize((W, H), Image.LANCZOS), dtype=np.float64)
    out += rng.normal(0, 1.6, (H, W))[..., None]
    img = Image.fromarray(to8(out), "RGB")
    save(img, "book_spines.png", palette=True)
    return img


# ------------------------------------------------------- contact sheet

def contact_sheet(items):
    CW, CH, LAB, G, COLS = 300, 300, 22, 10, 5
    rows, cur, used = [], [], 0
    for it in items:
        if used + it[2] > COLS:
            rows.append(cur)
            cur, used = [], 0
        cur.append(it)
        used += it[2]
    rows.append(cur)
    Wd = COLS * CW + (COLS + 1) * G
    Hd = len(rows) * (CH + LAB) + (len(rows) + 1) * G
    sheet = Image.new("RGB", (Wd, Hd), (40, 42, 44))
    fnt = font(FONT_SANS, 13)
    dr = ImageDraw.Draw(sheet)
    for ri, row in enumerate(rows):
        x = G
        y = G + ri * (CH + LAB + G)
        for label, im, span in row:
            cw = span * CW + (span - 1) * G
            if im.mode == "RGBA":
                chk = np.indices(im.size[::-1]).sum(0) // 16 % 2
                bgc = np.where(chk[..., None] == 1, 205, 160).astype(np.uint8) * np.ones(3, np.uint8)
                bg = Image.fromarray(bgc, "RGB")
                bg.paste(im, (0, 0), im)
                im = bg
            im = im.convert("RGB")
            s = min(cw / im.size[0], CH / im.size[1])
            th = im.resize((max(1, int(im.size[0] * s)), max(1, int(im.size[1] * s))), Image.LANCZOS)
            sheet.paste(th, (x + (cw - th.size[0]) // 2, y + (CH - th.size[1]) // 2))
            dr.text((x + 2, y + CH + 4), label, font=fnt, fill=(220, 220, 220))
            x += cw + G
    path = os.path.join(PREV, "textures-sheet.png")
    sheet.save(path, optimize=True)
    print(f"  sheet {sheet.size[0]}x{sheet.size[1]} -> {path}")


def tile2(im):
    im = im.convert("RGBA" if im.mode == "RGBA" else "RGB")
    w, h = im.size
    out = Image.new(im.mode, (2 * w, 2 * h))
    for dx in (0, w):
        for dy in (0, h):
            out.paste(im, (dx, dy))
    return out


def main():
    os.makedirs(TEX, exist_ok=True)
    os.makedirs(PREV, exist_ok=True)
    t0 = time.time()
    h = brushed_height()
    rough, bnrm = make_brushed(h)
    marble = make_marble()
    obase, onrm = make_optical(h)
    conc = make_concrete()
    atlas = make_display_atlas()
    spec = make_specimen()
    prnt = make_print()
    scope = make_scope()
    books = make_books()
    print("  seam ratios (edge step / interior step, ~1 = seamless):")
    for name, a in (("brushed_rough", rough), ("brushed_normal", bnrm[..., 1]),
                    ("marble_base", marble.mean(-1)), ("optical_holes_base", obase.mean(-1)),
                    ("optical_holes_normal", onrm[..., 0]), ("concrete_base", conc.mean(-1))):
        ex, ey = seam_ratio(a)
        print(f"    {name:22s} x {ex:.2f}  y {ey:.2f}")
    L = lambda n: Image.open(os.path.join(TEX, n))
    items = []
    for n in ("brushed_rough", "brushed_normal", "marble_base", "optical_holes_base",
              "optical_holes_normal", "concrete_base"):
        im = L(n + ".png")
        items += [(n, im, 1), (n + " 2x2", tile2(im), 1)]
    items += [("specimen_pattern (on checker)", spec, 1), ("print_lens", prnt, 1),
              ("scope_screen", scope, 1), ("display_atlas", atlas, 3), ("book_spines", books, 1)]
    contact_sheet(items)
    print(f"  done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
