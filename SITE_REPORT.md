# Site build report

Working notes kept current through the build; final state summarized at the top
when the build closes.

## Stack and environment

- Node v20.19.5 (system LTS), npm 10.8.2. Lockfile committed.
- Astro 5.18.2 (static output, trailingSlash always, directory build format),
  @astrojs/react 4, @astrojs/mdx 4, @astrojs/sitemap 3, Tailwind CSS 4 via
  @tailwindcss/vite, KaTeX at build time (remark-math + rehype-katex), Shiki
  dual themes (vitesse-light / vitesse-dark), fonts self-hosted via @fontsource.
- Python pipeline runs with /home/suhail-nadaf/final-reward/.venv/bin/python
  (reward-lens 2.0.1 editable install).
- PNG optimization: optipng -o2 (lossless; oxipng is not installed on this box).
- Browsers for checks: system Chrome/Chromium present; Playwright drives the
  system binary where a download is unavailable.

## Decisions the brief delegated

- npm resolved Astro 6 by default on install day; pinned back to Astro 5.18.2
  because the brief fixes Astro 5 and its APIs are the known quantity.
- Status colors: the brief's starter values failed the dataviz palette
  validator on both surfaces. Final validated sets (all-pairs CVD mode, which
  is stricter than the default because the ledger strip interleaves outcomes
  arbitrarily):
  - dark on #0C1017: confirmed #009A75, refuted #AB4238, mixed #BB8805,
    inconclusive #4675AF
  - light on #FAFAF7: confirmed #007A55, refuted #92261F, mixed #AE7900,
    inconclusive #3C6AA4
  The brief asked for inconclusive as neutral gray; the validator's chroma
  floor rules out a true gray in a validated categorical set, so inconclusive
  carries a quiet slate tint. Glyph and word always accompany status colors.
  Full validator transcripts are in the palette validation section below.
- Headline: pending final homepage build; candidates under evaluation.
- Logo: three directions in progress; selection grid and reasoning to follow.

## Source-versus-brief discrepancies found (source wins)

- GPU seconds: summing provenance.cost.gpu_seconds over the merged store gives
  16,074.1, not the 16,158 quoted in the brief's appendix. The site cites the
  computed value.
- Distinct observables in the store: 82, not 84.
- Docs corpus: 88 markdown files under docs/content (74 authored pages plus 14
  mkdocstrings reference pages that the generated API reference replaces), not
  the 73 the brief quotes.
- Per-arc dollar figures ($4.24 / $3.19) exist in no store record; the method
  page names the largest arcs by GPU-seconds computed from the store
  (model:skywork-v2-llama31-8b 3862s, model:skywork-v2-qwen3-8b 2910s) beside
  the close_summary total spend.
- HF repo ids appear in neither the store nor the shipped card HTMLs; the only
  recorded source is the frozen campaign worktree's campaign/config.py Seat
  table. The pipeline parses ids from there and the report flags the
  provenance.

## Inherited inconsistencies (flagged, not fixed; outside site scope)

- pyproject.toml URLs and docs/mkdocs.yml site_url still point at the personal
  suhailnadaf509 account and readthedocs.
- GitHub Releases still shows v1.0.0 as latest even though v2.0.1 tags exist
  and 2.0.1 is on PyPI.

## Data pipeline

scripts/build_data.py vendors everything from campaign-results/ with
assertions: 53 hypotheses at 16/21/16, 27 cards at 4/8/7/8, exactly the 8
expected kill ids, headline observed values spot-checked against RESULTS.md,
10 fleet models, 62 campaign PNGs, 48 docs SVGs. Outputs are committed;
scripts/checks/data_assertions.mjs re-verifies the committed projections in CI
without the store. A claims mini-store (the 27 adjudication records verbatim)
is vendored so the claims gate can run in CI against real evidence.

Fleet route taken: the store opened with the installed library's EvidenceStore
(the clean class never mutates on read; the campaign worktree's readonly flag
is unavailable in the installed version) and cards rebuilt natively via
reward_lens.artifacts.card.build_card, not scraped from the shipped HTML.
Headline scalars per model come from the campaign.index.table payloads (index
table, KUI inputs, hack-family indices), each displayed with its evidence id.

## Palette validation record

### Dark theme, surface #0C1017 (input: confirmed, refuted, mixed, inconclusive)

```
Palette (dark, surface #0C1017, categorical): 4 slots  #009a75,#ab4238,#bb8805,#4675af
[PASS] Lightness band         all 4 inside L 0.48-0.67
[PASS] Chroma floor           all 4 >= 0.1
[PASS] CVD separation         worst all-pairs #bb8805/#009a75 dE 9.3 (protan), tritan 7.4
[PASS] Normal-vision floor    worst all-pairs #4675af/#009a75 dE 16.5 (normal)
[PASS] Contrast vs surface    all 4 >= 3:1
ALL CHECKS PASS
```

### Light theme, surface #FAFAF7

```
Palette (light, surface #FAFAF7, categorical): 4 slots  #007a55,#92261f,#ae7900,#3c6aa4
[PASS] Lightness band         all 4 inside L 0.43-0.77
[PASS] Chroma floor           all 4 >= 0.1
[PASS] CVD separation         worst all-pairs #92261f/#007a55 dE 8.2 (deutan), tritan 2.8
[PASS] Normal-vision floor    worst all-pairs #3c6aa4/#007a55 dE 15.4 (normal)
[PASS] Contrast vs surface    all 4 >= 3:1
ALL CHECKS PASS
```

Diverging ramp for signed token attribution reuses the docs palette lineage:
chosen #2A78D6 / #5598E7, rejected #E34948 / #F0716F, neutral midpoints
#F0EFEC / #2A2B31 (two hues plus neutral mid, per the dataviz rule).

## Launch runbook

To be completed at the end of the build.
