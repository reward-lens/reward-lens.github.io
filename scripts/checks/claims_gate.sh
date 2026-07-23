#!/usr/bin/env bash
# The claims gate: the site's own copy is checked against real evidence,
# exactly the way the campaign manuscript was. Nonzero exit fails the build.
set -euo pipefail
cd "$(dirname "$0")/../.."

PYTHON="${REWARD_LENS_PYTHON:-/home/suhail-nadaf/final-reward/.venv/bin/python}"
if ! [ -x "$PYTHON" ]; then
  PYTHON="$(command -v python3)"
fi

REWARD_LENS_STORE_PATH="$(pwd)/src/data/claims-store" \
  "$PYTHON" -m reward_lens.operate.cli claims site-claims.md
