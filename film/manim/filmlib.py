"""Shared layout, type and copy for the two Manim inserts.

Both inserts render **once per aspect ratio**, at that ratio's output resolution,
and are composited into the Remotion timeline at 100% width. That is what makes
them composed for their frame rather than cropped from the wide one, and it is
what keeps a 12px label in the insert the same size as a 12px label Remotion
draws in the same frame.

The arithmetic that makes both true at once:

  format   composition   render scale   output       insert width
  wide     960x540       2              1920x1080    1920, so 1:1
  square   540x540       2              1080x1080    1080, so 1:1
  tall     540x960       2              1080x1920    1080, so 1:1

Everything here is stated in **output pixels** and converted through px(), which
reads Manim's config rather than a constant, so the same number means the same
number of pixels at every resolution. A 22px label is 22 device pixels in all
three, which is 11 CSS pixels, which is --type-mono-label.

No colour is defined here. Every colour comes from tokens.py, which
scripts/gen-tokens-py.mjs generates from design/tokens.css. No string is defined
here either: every word comes from film/out/copy.json, which render.mjs extracts
from design/copy.yaml.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import manimpango
from manim import Scene, Text, config

FILM = Path(__file__).resolve().parent.parent

# The two families, by the name Pango reports for the site's own font files.
# film/scripts/fonts.py decompresses public/fonts/*.woff2 and prints these.
FONT_SANS = "IBM Plex Sans"
FONT_MONO = "IBM Plex Mono"

_FONT_DIR = FILM / ".fonts"


def _load_fonts() -> None:
    """Register the site's own faces with Pango for this process only.

    FONTCONFIG_FILE is the obvious mechanism and it does not work here: Pango
    reads the font map once, and manim reads it at import. Registering the files
    directly is process-scoped, leaves the machine's font configuration alone,
    and fails loudly if the bootstrap has not run.
    """
    faces = sorted(_FONT_DIR.glob("*.ttf"))
    if not faces:
        raise RuntimeError(
            f"no faces in {_FONT_DIR}. Run film/scripts/fonts.py first, or use "
            "`npm run film`, which runs it for you."
        )
    for face in faces:
        if not manimpango.register_font(str(face)):
            raise RuntimeError(f"Pango refused {face}")


_load_fonts()


def _fit_frame_to_raster() -> None:
    """Make Manim's visible frame the shape of the raster it is rendering into.

    THE TRAP, and it is silent. `-r 1080,1920` changes the raster and does NOT
    change the frame: config.frame_width stays at 14.222 units and frame_height
    at 8, so Manim fits a 16:9 region into the new raster and letterboxes it. The
    9:16 render came out as a 16:9 composition shrunk to 31.6% and centred in a
    sea of transparency, and the 1:1 render at 56.25%. Nothing warns, nothing
    fails, and the frames look plausible until you measure the ink bounding box:
    1920x1080 filled x 92..1828, and 1080x1920 filled x 384..668.

    Pinning frame_height at 8 and deriving frame_width from the raster's own
    aspect makes the scale uniform at pixel_height/8 in both axes, which is what
    makes px() mean one output pixel at every resolution.

    It runs at import of this module, which is before the Scene builds its
    camera, which is the only window in which it takes effect.
    """
    config.frame_height = 8.0
    config.frame_width = 8.0 * config.pixel_width / config.pixel_height


_fit_frame_to_raster()


# --- copy ------------------------------------------------------------------
# HANDOFF.md §8 rule 1: no string that is not in copy.yaml. render.mjs extracts
# the film subtree to JSON before Manim runs, so there is one document and two
# consumers rather than two documents.

_COPY_PATH = FILM / "out" / "copy.json"
_copy_cache: dict | None = None


def copy(path: str) -> str:
    """A string from copy.yaml's `film` subtree, by dotted path."""
    global _copy_cache
    if _copy_cache is None:
        if not _COPY_PATH.is_file():
            raise RuntimeError(
                f"{_COPY_PATH} does not exist. It is written by "
                "film/scripts/render.mjs from design/copy.yaml before Manim runs."
            )
        _copy_cache = json.loads(_COPY_PATH.read_text())
    node = _copy_cache
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            raise KeyError(f"copy.yaml:film.{path} does not exist")
        node = node[part]
    if not isinstance(node, str):
        raise KeyError(f"copy.yaml:film.{path} is not a string")
    return node


# --- geometry --------------------------------------------------------------

# The caption band Remotion burns into the bottom of each format, in output
# pixels. These are film/remotion/lib/stage.ts's captionBand and pad, doubled,
# because every composition is laid out at half size and rendered at scale 2.
# An insert that draws into this band cannot be captioned.
_BANDS = {"wide": (184, 112), "square": (208, 80), "tall": (264, 80)}


@dataclass(frozen=True)
class Layout:
    """The usable drawing area for this render's aspect ratio, in output pixels
    measured from the frame centre, with +y up the way Manim measures it."""

    name: str
    width: float
    height: float
    top: float
    bottom: float
    left: float
    right: float

    @property
    def span_y(self) -> float:
        return self.top - self.bottom

    @property
    def span_x(self) -> float:
        return self.right - self.left

    @property
    def vertical(self) -> bool:
        """9:16 reads down the frame. Shot 7's traces do the same thing."""
        return self.name == "tall"


def layout() -> Layout:
    width = float(config.pixel_width)
    height = float(config.pixel_height)
    ratio = width / height
    name = "wide" if ratio > 1.05 else "tall" if ratio < 0.95 else "square"
    band, pad = _BANDS[name]
    return Layout(
        name=name,
        width=width,
        height=height,
        top=height / 2 - pad * 0.4,
        bottom=-height / 2 + band,
        left=-width / 2 + pad / 2,
        right=width / 2 - pad / 2,
    )


def px(n: float) -> float:
    """Output pixels to Manim units, at whatever resolution is being rendered.

    Manim's frame is 8 units tall at every resolution, so the conversion is a
    property of the render rather than a constant. Reading it from config is the
    single line that lets one layout serve three aspect ratios.
    """
    return n * (config.frame_height / config.pixel_height)


# --- type ------------------------------------------------------------------
# No font size is written here. render.mjs extracts the type scale from the same
# src/styles/tokens.css that remotion/theme.css imports, and writes it beside the
# copy. Remotion gets these sizes through the stylesheet; Manim cannot read CSS,
# so it reads that file.
#
# THE CONVERSION, WHICH IS THE WHOLE POINT OF THIS BLOCK. A CSS font size is not
# a cap height, and sized_text() below builds to a cap height. Going from one to
# the other is a property of the FACE, not a constant: cap_height / units_per_em,
# read out of the same .ttf Pango is rendering with.
#
#   --type-mono-label   11 CSS px  x scale 2  = 22 output px of FONT SIZE
#                                             = 22 x 0.698 = 15.4 px of CAP HEIGHT
#
# The two constants that used to live here were 22 and 30, the token sizes
# doubled, and they were passed to sized_text as cap heights. So every label in
# both inserts rendered at the cap height of a 31.5px font instead of an 11px
# one: 1.43x too large, measured as 22px against Remotion's 17px for the same
# role on the same still. It is the residual half of the type mismatch that
# brief §5.7 asks to be checked for at 1:1, and the per-format work closed the
# other half.

_TYPE_PATH = FILM / "out" / "type.json"
_type_cache: dict | None = None


def _type_scale() -> dict:
    global _type_cache
    if _type_cache is None:
        if not _TYPE_PATH.is_file():
            raise RuntimeError(
                f"{_TYPE_PATH} does not exist. It is written by "
                "film/scripts/render.mjs from src/styles/tokens.css before Manim runs."
            )
        _type_cache = json.loads(_TYPE_PATH.read_text())
    return _type_cache


def cap_ratio(font: str) -> float:
    """cap height over em, read from the face itself rather than assumed.

    Both families ship the same 0.698, and reading it means a face swap cannot
    silently resize every label in the film.
    """
    from fontTools.ttLib import TTFont

    stem = "mono" if font == FONT_MONO else "sans"
    faces = sorted(_FONT_DIR.glob(f"*{stem}*400*.ttf"))
    if not faces:
        raise RuntimeError(f"no 400-weight {stem} face in {_FONT_DIR}")
    face = TTFont(str(faces[0]))
    cap = getattr(face["OS/2"], "sCapHeight", None)
    if not cap:
        raise RuntimeError(f"{faces[0]} declares no cap height")
    return cap / face["head"].unitsPerEm


def role_cap_px(role: str, font: str = FONT_MONO) -> float:
    """The cap height, in output pixels, of a tokens.css type role in this film."""
    scale = _type_scale()
    if role not in scale["sizes"]:
        raise KeyError(f"tokens.css has no --type-{role}-size")
    return scale["sizes"][role] * scale["scale"] * cap_ratio(font)


_CAP_REFERENCE = "H"
_NOMINAL = 48.0


def sized_text(body: str, height_px: float, font: str = FONT_MONO, **kwargs) -> Text:
    """A Text whose cap height is `height_px` output pixels.

    Manim's font_size is not a pixel size, and the relation depends on the face.
    Measuring a reference glyph from the same face at the same nominal size and
    scaling by the ratio makes the result exact for any font we load, rather
    than correct for the one it was tuned against.
    """
    reference = Text(_CAP_REFERENCE, font=font, font_size=_NOMINAL)
    target = Text(body, font=font, font_size=_NOMINAL, **kwargs)
    target.scale(px(height_px) / reference.height)
    return target


def label(body: str, colour: str, height_px: float | None = None) -> Text:
    """A caps metadata label, tracked wide, the way --type-mono-label is set."""
    if height_px is None:
        height_px = role_cap_px("mono-label")
    text = sized_text(body.upper(), height_px, font=FONT_MONO)
    text.set_color(colour)
    # --type-mono-label-track is 0.09em. Manim has no tracking, so it is applied
    # as a per-glyph advance on the assembled line. The em it is a fraction of is
    # the font size, which is the cap height back-converted through the face.
    tracking = px(height_px / cap_ratio(FONT_MONO) * 0.09)
    for i in range(1, len(text)):
        text[i].shift([tracking * i, 0, 0])
    text.move_to([0, 0, 0])
    return text


class InsertScene(Scene):
    """Both inserts share the transparent ground and the frame rate.

    Both are driven from film/scripts/render.mjs as
    `manim -r W,H --fps 30 -t --format=png`, once per aspect ratio, so the
    resolution, the transparency and the rate are on the command line rather
    than in a config file nobody reads.
    """
