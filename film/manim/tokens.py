"""reward-lens design tokens, for Manim.

GENERATED. Do not edit. Run `npm run tokens:py` after changing
design/tokens.css. Every colour in film/** comes from here, which is
what stops a scene and the site from drifting apart.

Dark theme values are the bare constants because the film is dark.
Light theme values carry a LIGHT_ prefix.
"""

from __future__ import annotations

# --- type ---------------------------------------------------------------
FONT_SANS = "IBM Plex Sans"
FONT_MONO = "IBM Plex Mono"

# --- dark theme ---------------------------------------------------------
GROUND = "#080b0a"
SURFACE_1 = "#121615"
SURFACE_2 = "#1d2220"
SURFACE_3 = "#292e2c"
SURFACE_4 = "#363c3a"
GROUND_HEX = "#080b0a"
SURFACE_1_HEX = "#121615"
SURFACE_2_HEX = "#1d2220"
SURFACE_3_HEX = "#292e2c"
SURFACE_4_HEX = "#363c3a"
LINE = "#282d2b"
LINE_STRONG = "#414845"
LINE_CONTROL = "#585f5d"
INK = "#e2e7e5"
INK_2 = "#a3a9a7"
INK_3 = "#7f8582"
BEAM = "#fcfaf4"
BEAM_WASH = "#fcfaf4"
BEAM_WASH_ALPHA = 0.1
COMP_1 = "#4baeed"
COMP_2 = "#49d9b9"
COMP_3 = "#f3d350"
COMP_4 = "#eb725b"
COMP_5 = "#d090e3"
COMP_6 = "#5e9f50"
TRUST_1 = "#6e7773"
TRUST_2 = "#6fa3a8"
TRUST_3 = "#6bcae1"
TRUST_4 = "#6ff0ff"
STATE_EVIDENCE = "#e2e7e5"
STATE_REFUSAL = "#74b4cd"
STATE_BOUNDED = "#e0b861"
WRITTEN = "#7cc1e9"
REALIZED = "#ed7761"
ALARM = "#fcfaf4"
COMPARATOR = "#8aa298"
CONTROL = "#7f8582"
FOCUS = "#6bcae1"
SELECTION_BG = "#6bcae1"
SELECTION_BG_ALPHA = 0.26
SELECTION_FG = "#e2e7e5"
CARET = "#fcfaf4"
SCROLLBAR_TRACK = "#121615"
SCROLLBAR_THUMB = "#363c3a"
CODE_BG = "#121615"
CODE_INLINE_BG = "#292e2c"

# --- light theme --------------------------------------------------------
LIGHT_GROUND = "#f8fbfa"
LIGHT_SURFACE_1 = "#fdfffe"
LIGHT_SURFACE_2 = "#eff4f2"
LIGHT_SURFACE_3 = "#e6ebe9"
LIGHT_SURFACE_4 = "#dadfdd"
LIGHT_GROUND_HEX = "#f8fbfa"
LIGHT_SURFACE_1_HEX = "#fdfffe"
LIGHT_SURFACE_2_HEX = "#eff4f2"
LIGHT_SURFACE_3_HEX = "#e6ebe9"
LIGHT_SURFACE_4_HEX = "#dadfdd"
LIGHT_LINE = "#d4d9d7"
LIGHT_LINE_STRONG = "#b2b9b6"
LIGHT_LINE_CONTROL = "#7f8985"
LIGHT_INK = "#1a201d"
LIGHT_INK_2 = "#4f5854"
LIGHT_INK_3 = "#67706c"
LIGHT_BEAM = "#2d3532"
LIGHT_BEAM_WASH = "#1a201d"
LIGHT_BEAM_WASH_ALPHA = 0.06
LIGHT_COMP_1 = "#0070b5"
LIGHT_COMP_2 = "#259780"
LIGHT_COMP_3 = "#a87600"
LIGHT_COMP_4 = "#c4422c"
LIGHT_COMP_5 = "#883e9d"
LIGHT_COMP_6 = "#316a23"
LIGHT_TRUST_1 = "#858f8b"
LIGHT_TRUST_2 = "#487e8b"
LIGHT_TRUST_3 = "#006583"
LIGHT_TRUST_4 = "#004978"
LIGHT_STATE_EVIDENCE = "#1a201d"
LIGHT_STATE_REFUSAL = "#116d8a"
LIGHT_STATE_BOUNDED = "#8d5e00"
LIGHT_WRITTEN = "#006c98"
LIGHT_REALIZED = "#bf3d27"
LIGHT_ALARM = "#4d1f00"
LIGHT_COMPARATOR = "#6f807a"
LIGHT_CONTROL = "#818a86"
LIGHT_FOCUS = "#006583"
LIGHT_SELECTION_BG = "#006583"
LIGHT_SELECTION_BG_ALPHA = 0.18
LIGHT_SELECTION_FG = "#1a201d"
LIGHT_CARET = "#1a201d"
LIGHT_SCROLLBAR_TRACK = "#eff4f2"
LIGHT_SCROLLBAR_THUMB = "#b2b9b6"
LIGHT_CODE_BG = "#eff4f2"
LIGHT_CODE_INLINE_BG = "#e6ebe9"

# --- ordered sequences ---------------------------------------------------
# The component order is the order the library returns. Do not sort it.
COMPONENTS = [COMP_1, COMP_2, COMP_3, COMP_4, COMP_5, COMP_6]
LIGHT_COMPONENTS = [LIGHT_COMP_1, LIGHT_COMP_2, LIGHT_COMP_3, LIGHT_COMP_4, LIGHT_COMP_5, LIGHT_COMP_6]
# The trust ladder reads as increasing confidence, in this order only.
TRUST = [TRUST_1, TRUST_2, TRUST_3, TRUST_4]
LIGHT_TRUST = [LIGHT_TRUST_1, LIGHT_TRUST_2, LIGHT_TRUST_3, LIGHT_TRUST_4]

SURFACES = [GROUND, SURFACE_1, SURFACE_2, SURFACE_3, SURFACE_4]
LIGHT_SURFACES = [LIGHT_GROUND, LIGHT_SURFACE_1, LIGHT_SURFACE_2, LIGHT_SURFACE_3, LIGHT_SURFACE_4]
