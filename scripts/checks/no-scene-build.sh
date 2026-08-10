#!/usr/bin/env bash
# Gate 18 · No-scene build
#
# QA.md §2.4 item 3: PUBLIC_SCENE=off produces a site that passes gates 14 and
# 16 and that a designer would ship. D-18 puts the kill switch in from the first
# commit, and D-17 adopted the scene conditionally on exactly this: the site is
# finished without it.
#
# It builds into a separate directory so the ordinary dist/ is not clobbered
# half way through a CI run, then points gates 14 and 16 at that directory.
# Everything downstream reads DIST_DIR, which is why the gates take it from the
# environment rather than assuming dist/.

set -euo pipefail
cd "$(dirname "$0")/../.."

OUT="dist-noscene"

echo "gate 18: building with PUBLIC_SCENE=off into $OUT/"
PUBLIC_SCENE=off npx astro build --outDir "$OUT"
npx pagefind --site "$OUT" >/dev/null

echo "gate 18: the scene-disabled build, gate 14"
DIST_DIR="$PWD/$OUT" node scripts/checks/axe.mjs

echo "gate 18: the scene-disabled build, gate 16"
DIST_DIR="$PWD/$OUT" node scripts/checks/budgets.mjs

echo "gate 18: PUBLIC_SCENE=off passes gates 14 and 16"
