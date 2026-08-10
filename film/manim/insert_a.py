"""Insert A: one number, spread flat. Shot 4a of the explainer film, 8 seconds.

The credit-assignment problem, which everyone in this field knows abstractly and
almost nobody has seen. One episode is a long sequence of positions. One episode
gets one scalar. Every position in it is trained against that same scalar.

The visual argument is the flatness, and the counter is what gives the flatness
its scale, so the counter has to be real.

WHAT THE COUNTER READS, AND WHY IT IS NOT A TOKEN COUNT.
data/run-series.json carries perEpisode.meanCompletionCharacters, 401 values,
one per training step, from the public rollout table
(reward-lens-assay/experiments/x5_threshold/aisi_lengths.npz). That table records
completion length in CHARACTERS and publishes no token field. Its own note says
so. Deriving tokens from characters would be a number with no measurement behind
it, so this insert counts characters.

WHAT THE SCALAR DELIBERATELY DOES NOT SAY.
The descending mark carries no digits. The run's reward is a per-rollout pass
predicate and the file records only its per-step mean over 64 rollouts, so no
single episode's scalar is recorded anywhere. Asserting one would be inventing a
measurement to decorate an argument that does not need it: what the insert
claims is that every position receives the SAME number, which is a statement
about identity across positions and not about magnitude. The two episodes'
scalars differ in height because different episodes get different scalars, and
that is the whole of what the height means.

LAYOUT. Every position below is derived from filmlib.layout(), which knows the
aspect ratio being rendered and where Remotion's caption band starts in it. The
strip stays horizontal in all three formats: it is a sequence running off both
edges, and turning it vertical at 9:16 would be a different construction rather
than the same one composed differently. What changes per format is the vertical
rhythm and the bar geometry, which is what there is more or less of.
"""

from __future__ import annotations

import json
from pathlib import Path

from manim import FadeIn, FadeOut, Rectangle, ReplacementTransform, Square, VGroup

import filmlib as fl
import tokens as tk

SITE = Path(__file__).resolve().parent.parent.parent
SERIES = json.loads((SITE / "src" / "data" / "run-series.json").read_text())

STEPS = SERIES["steps"]
CHARACTERS = SERIES["perEpisode"]["meanCompletionCharacters"]

# Two steps, the first and the last the table records. They sit either side of
# the fitted transition, which is why their lengths differ as much as they do.
FIRST, LAST = 0, len(STEPS) - 1

TICK_W = 6
TICK_PITCH = 11
TICK_REST_H = 14
STAMP_H_1 = 84
STAMP_H_2 = 30


class Geometry:
    """Where everything sits, for the aspect ratio being rendered."""

    def __init__(self) -> None:
        box = fl.layout()
        self.box = box
        # The strip runs off both edges of frame by construction, at every ratio.
        self.strip_half = box.width / 2 + 160
        self.strip_y = box.top - 90
        self.counter_y = self.strip_y - 116
        self.sublabel_y = self.counter_y - 46
        self.bar_label_y = box.bottom + 16
        self.baseline_y = self.bar_label_y + 40
        self.bar_w = {"wide": 160, "square": 120, "tall": 200}[box.name]
        self.bar_x = {"wide": 200, "square": 150, "tall": 230}[box.name]
        # The taller bar stops clear of the readout line rather than running into
        # it, and it stops being a bar past about five and a half times its own
        # width. At 9:16 the available height is 1,270px against a 200px bar,
        # which renders as a rule rather than as a histogram.
        self.bar_max_h = min((self.sublabel_y - 46) - self.baseline_y, 5.5 * self.bar_w)
        # Scaled against the taller of the two bars actually drawn, so the pair
        # fills the frame and their ratio is what the eye compares. Scaling
        # against the series maximum would leave both bars small to reserve room
        # for a step neither of them is.
        self.per_character = self.bar_max_h / max(CHARACTERS[FIRST], CHARACTERS[LAST])


def strip(g: Geometry, colour: str, height_px: float, width_px: float = TICK_W) -> VGroup:
    """A trajectory, drawn as one small rectangle per position.

    The strip is wider than the frame on both sides. A viewer sees a window onto
    a sequence that continues past the edge, which is the honest picture: the
    counter states the real length and the drawing does not pretend to show
    every one of them.
    """
    ticks = VGroup()
    x = -g.strip_half
    while x <= g.strip_half:
        tick = Rectangle(width=fl.px(width_px), height=fl.px(height_px))
        tick.set_stroke(width=0)
        tick.set_fill(colour, opacity=1.0)
        tick.move_to([fl.px(x), fl.px(g.strip_y), 0])
        ticks.add(tick)
        x += TICK_PITCH
    return ticks


def counter(g: Geometry, count: int, step: int) -> VGroup:
    value = fl.sized_text(f"{count:,}", fl.role_cap_px("mono-lg"), font=fl.FONT_MONO)
    value.set_color(tk.INK)
    value.move_to([0, fl.px(g.counter_y), 0])
    caption = fl.label(
        f"{fl.copy('labels.mean_completion_characters')}  .  {fl.copy('labels.step')} {step}",
        tk.INK_3,
    )
    caption.move_to([0, fl.px(g.sublabel_y), 0])
    return VGroup(value, caption)


def bar(g: Geometry, count: int, x_px: float) -> Rectangle:
    height = count * g.per_character
    rect = Rectangle(width=fl.px(g.bar_w), height=fl.px(height))
    rect.set_stroke(width=0)
    rect.set_fill(tk.BEAM, opacity=1.0)
    rect.move_to([fl.px(x_px), fl.px(g.baseline_y + height / 2), 0])
    return rect


class InsertA(fl.InsertScene):
    def construct(self) -> None:
        g = Geometry()
        first_count = round(CHARACTERS[FIRST])
        last_count = round(CHARACTERS[LAST])

        # Beat 1, 1.5s. The trajectory arrives and the counter reads its length.
        ticks = strip(g, tk.INK_3, TICK_REST_H)
        readout = counter(g, first_count, STEPS[FIRST])
        self.play(FadeIn(ticks, lag_ratio=0.004, run_time=1.0))
        self.play(FadeIn(readout, run_time=0.5))

        # Beat 2, 1.5s. One scalar, arriving from outside the episode.
        scalar = Square(side_length=fl.px(40))
        scalar.set_stroke(width=0)
        scalar.set_fill(tk.BEAM, opacity=1.0)
        scalar.move_to([0, fl.px(g.box.top + 60), 0])
        self.play(FadeIn(scalar, run_time=0.35))
        self.play(
            scalar.animate.move_to([0, fl.px(g.strip_y + STAMP_H_1 / 2 + 34), 0]),
            run_time=1.15,
        )

        # Beat 3, 2.5s. It stamps onto every position at once. Hold on that.
        stamped = strip(g, tk.BEAM, STAMP_H_1)
        self.play(
            ReplacementTransform(ticks, stamped, run_time=0.6),
            scalar.animate.set_opacity(0).scale(0.2),
        )
        self.wait(1.9, frozen_frame=False)

        # Beat 4, 1.5s. The episode compresses to what the optimizer sees of it:
        # one value, and the count of positions carrying it.
        #
        # The compression is a stretch of the strip itself rather than a
        # transform into a new shape. A ReplacementTransform from 200-odd
        # rectangles into one rectangle spends its middle second as a smear,
        # which reads as a rendering fault rather than as a compression.
        #
        # The gaps close first. Compressing a picket straight to bar width leaves
        # a sub-pixel stripe pattern whose average luminance is well under the
        # beam's, so the block reads grey through the whole move and then snaps
        # white. Closing the gaps first keeps one colour on screen throughout.
        first_bar = bar(g, first_count, -g.bar_x)
        first_bar_label = fl.label(f"{fl.copy('labels.step')} {STEPS[FIRST]}", tk.INK_3)
        first_bar_label.move_to([fl.px(-g.bar_x), fl.px(g.bar_label_y), 0])
        solid = strip(g, tk.BEAM, STAMP_H_1, width_px=TICK_PITCH)
        self.play(ReplacementTransform(stamped, solid, run_time=0.25))
        self.play(
            solid.animate.stretch_to_fit_width(first_bar.width)
            .stretch_to_fit_height(first_bar.height)
            .move_to(first_bar.get_center()),
            FadeOut(readout, run_time=0.45),
            run_time=0.85,
        )
        self.add(first_bar)
        self.remove(solid)
        self.play(FadeIn(first_bar_label, run_time=0.4))

        # Beat 5, 1.0s. A second episode, a different scalar, the same flatness.
        second = strip(g, tk.INK_3, TICK_REST_H)
        second_readout = counter(g, last_count, STEPS[LAST])
        self.play(
            FadeIn(second, run_time=0.35),
            FadeIn(second_readout, run_time=0.35),
        )
        second_stamped = strip(g, tk.BEAM, STAMP_H_2)
        self.play(ReplacementTransform(second, second_stamped, run_time=0.2))
        second_solid = strip(g, tk.BEAM, STAMP_H_2, width_px=TICK_PITCH)
        self.play(ReplacementTransform(second_stamped, second_solid, run_time=0.1))
        second_bar = bar(g, last_count, g.bar_x)
        second_bar_label = fl.label(f"{fl.copy('labels.step')} {STEPS[LAST]}", tk.INK_3)
        second_bar_label.move_to([fl.px(g.bar_x), fl.px(g.bar_label_y), 0])
        self.play(
            second_solid.animate.stretch_to_fit_width(second_bar.width)
            .stretch_to_fit_height(second_bar.height)
            .move_to(second_bar.get_center()),
            FadeIn(second_bar_label, run_time=0.25),
            run_time=0.25,
        )
        self.add(second_bar)
        self.remove(second_solid)
        self.wait(0.1, frozen_frame=False)
