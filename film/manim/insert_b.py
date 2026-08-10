"""Insert B: the deformation. Shot 6a of the explainer film, 10 seconds.

The v3 thesis in one construction. The objective your run actually optimized is
not the objective you wrote; it is the one you wrote plus a deformation, and the
deformation is a thing you can measure and then invert.

THE RULE THAT MAKES IT HONEST: the before never leaves the frame. Displace, do
not replace. The written curve stays drawn, ghosted, through every beat in which
the realized curve exists. That is the same rule the act-one intervention panel
follows, and repeating it across the film and the site is what makes them one
object rather than two artifacts about the same subject.

NO NUMBER APPEARS HERE AND NONE SHOULD. GROUND-TRUTH.md C-43: the run's `written`
and `realized` series differ by a mean of 0.0007 across 401 steps, so there is no
measured instance of this gap anywhere in the repository. This insert is a
geometric claim about the SHAPE of the relation between two objectives and it
claims no measurement at all, which is exactly why D-23 admitted a second
renderer for it. Putting a number in it would turn a construction into an
assertion, and there is nothing behind the assertion.

ORIENTATION. At 16:9 and 1:1 the behaviour axis runs across the frame and the
objective rises from it. At 9:16 the whole construction turns: behaviour runs
down the frame and the objective extends to the right. That is the same choice
FILM.md §3 makes for shot 7's traces, and it is why this insert is rendered once
per aspect ratio rather than resized from the wide one. Every position goes
through point(), so the two orientations are one construction and not two.
"""

from __future__ import annotations

import math

from manim import (
    Arrow,
    Create,
    FadeIn,
    FadeOut,
    Line,
    Polygon,
    ValueTracker,
    VGroup,
    always_redraw,
)

import filmlib as fl
import tokens as tk

SAMPLES = 190
ARROWS = 23

# The shape, in normalised behaviour coordinates u in [-1, 1] and a value in
# [0, 1] of the available depth. Nothing here is a pixel, so one set of numbers
# describes the construction at every aspect ratio.
SHAPE_WIDTH = 0.395


def written_shape(u: float) -> float:
    """The objective as written. Smooth, symmetric, unremarkable."""
    return math.exp(-((u / SHAPE_WIDTH) ** 2))


def pressure(u: float) -> float:
    """Optimization pressure along the axis. Uneven, which is the entire point."""
    return (
        0.62 * math.exp(-(((u + 0.447) / 0.217) ** 2))
        + 1.00 * math.exp(-(((u - 0.217) / 0.263) ** 2))
        + 0.40 * math.exp(-(((u - 0.737) / 0.171) ** 2))
    )


class Geometry:
    """Where the axis is and which way the objective grows, for this ratio."""

    def __init__(self) -> None:
        box = fl.layout()
        self.box = box
        self.vertical = box.vertical
        if self.vertical:
            # Behaviour runs down the frame; the objective extends to the right.
            self.t_from = box.top - 40
            self.t_to = box.bottom + 90
            self.axis = box.left + 150
            self.depth = box.right - self.axis - 30
            self.label_at = (self.axis, box.bottom + 26)
        else:
            # Behaviour runs across the frame; the objective rises from the axis.
            self.t_from = box.left + 40
            self.t_to = box.right - 40
            # 236px below the axis is the arrow field plus the axis label plus
            # air. Anything less and the arrows collide with the label, which is
            # what the first render did.
            self.axis = box.bottom + 236
            self.depth = box.top - self.axis - 30
            self.label_at = (0.0, self.axis - 200)
        self.amplitude = 0.60 * self.depth
        self.lift = 0.42 * self.depth

    def point(self, u: float, value: float) -> list[float]:
        """Normalised behaviour u in [-1, 1] and a value in output pixels."""
        t = (u + 1) / 2
        along = self.t_from + t * (self.t_to - self.t_from)
        across = self.axis + value
        return (
            [fl.px(across), fl.px(along), 0]
            if self.vertical
            else [fl.px(along), fl.px(across), 0]
        )

    def arrow_ends(self, u: float, length: float) -> tuple[list[float], list[float]]:
        """A pressure arrow: starts off the far side of the axis, points at it."""
        gap = 46
        start = self.point(u, -(gap + length))
        end = self.point(u, -gap)
        return start, end

    def written(self, u: float) -> float:
        return self.amplitude * written_shape(u)

    def difference(self, u: float) -> float:
        """What optimization added. Zero where nothing pushed."""
        return self.lift * pressure(u)


def curve(g: Geometry, f, colour: str, opacity: float = 1.0, width: float = 5.0) -> VGroup:
    points = [g.point(-1 + 2 * i / SAMPLES, f(-1 + 2 * i / SAMPLES)) for i in range(SAMPLES + 1)]
    path = Line(points[0], points[1])
    path.set_points_as_corners(points)
    path.set_stroke(colour, width=width, opacity=opacity)
    return VGroup(path)


def band(g: Geometry, f_low, f_high, colour: str, opacity: float) -> Polygon:
    lower = [g.point(-1 + 2 * i / SAMPLES, f_low(-1 + 2 * i / SAMPLES)) for i in range(SAMPLES + 1)]
    upper = [
        g.point(-1 + 2 * i / SAMPLES, f_high(-1 + 2 * i / SAMPLES))
        for i in range(SAMPLES, -1, -1)
    ]
    poly = Polygon(*(lower + upper))
    poly.set_stroke(width=0)
    poly.set_fill(colour, opacity=opacity)
    return poly


class InsertB(fl.InsertScene):
    def construct(self) -> None:
        g = Geometry()

        axis = Line(g.point(-1, 0), g.point(1, 0))
        axis.set_stroke(tk.LINE_STRONG, width=2)
        axis_label = fl.label(fl.copy("labels.behaviour"), tk.INK_3)
        axis_label.move_to([fl.px(g.label_at[0]), fl.px(g.label_at[1]), 0])

        # Beat 1, 2.0s. The objective you wrote.
        written_curve = curve(g, g.written, tk.WRITTEN)
        self.play(FadeIn(axis, run_time=0.3), FadeIn(axis_label, run_time=0.3))
        self.play(Create(written_curve, run_time=1.7))

        # Beat 2, 2.5s. Pressure applies, unevenly, and the curve gives way.
        # The written curve stays drawn behind it at reduced opacity: the before
        # never leaves the frame.
        field = VGroup()
        for i in range(ARROWS):
            u = -1 + 2 * i / (ARROWS - 1)
            start, end = g.arrow_ends(u, 20 + 78 * pressure(u))
            arrow = Arrow(
                start=start,
                end=end,
                buff=0,
                stroke_width=3,
                max_tip_length_to_length_ratio=0.34,
            )
            arrow.set_color(tk.CONTROL)
            field.add(arrow)

        ghost = curve(g, g.written, tk.WRITTEN, opacity=0.32)
        alpha = ValueTracker(0.0)
        moving = always_redraw(
            lambda: curve(
                g,
                lambda u: g.written(u) + alpha.get_value() * g.difference(u),
                tk.WRITTEN if alpha.get_value() < 0.5 else tk.REALIZED,
            )
        )
        self.add(ghost, moving)
        self.remove(written_curve)
        self.play(FadeIn(field, lag_ratio=0.05, run_time=0.7))
        self.play(alpha.animate.set_value(1.0), run_time=1.8)

        # Beat 3, 2.0s. It settles, and the gap between the two is a thing with
        # an area rather than a rhetorical point.
        realized_curve = curve(g, lambda u: g.written(u) + g.difference(u), tk.REALIZED)
        gap = band(g, g.written, lambda u: g.written(u) + g.difference(u), tk.REALIZED, 0.16)
        self.remove(moving)
        self.add(realized_curve)
        self.play(FadeIn(gap, run_time=0.6), FadeOut(field, run_time=0.6))
        self.wait(1.4, frozen_frame=False)

        # Beat 4, 2.0s. The deformation lifts off both curves and stands alone.
        # It is not a description of the gap. It is the gap, as an object.
        field_curve = curve(g, g.difference, tk.REALIZED)
        field_band = band(g, lambda u: 0.0, g.difference, tk.REALIZED, 0.16)
        field_label = fl.label(fl.copy("labels.difference"), tk.INK_3)
        field_label.move_to([fl.px(g.label_at[0]), fl.px(g.label_at[1]), 0])
        self.play(
            FadeOut(gap, run_time=0.5),
            FadeOut(realized_curve, run_time=0.5),
            FadeOut(ghost, run_time=0.5),
            FadeOut(axis_label, run_time=0.5),
        )
        self.play(
            FadeIn(field_band, run_time=0.6),
            Create(field_curve, run_time=0.9),
            FadeIn(field_label, run_time=0.6),
        )
        self.wait(0.4, frozen_frame=False)

        # Beat 5, 1.5s. It inverts, applies backward, and the written objective
        # comes back. Measurable, and therefore invertible.
        back = ValueTracker(1.0)
        recovering = always_redraw(
            lambda: curve(
                g,
                lambda u: g.written(u) + back.get_value() * g.difference(u),
                tk.REALIZED if back.get_value() > 0.5 else tk.WRITTEN,
            )
        )
        self.play(
            FadeOut(field_band, run_time=0.4),
            FadeOut(field_curve, run_time=0.4),
            FadeOut(field_label, run_time=0.4),
            FadeIn(axis_label, run_time=0.4),
        )
        self.add(recovering)
        self.play(back.animate.set_value(0.0), run_time=0.9)
        self.wait(0.2, frozen_frame=False)
