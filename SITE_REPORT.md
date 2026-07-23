# Site build report

The reward-lens website: an Astro 5 static site in this repository, deployed
to GitHub Pages by Actions, serving at https://reward-lens.github.io/ once
launched. 133 pages: home, the campaign section (index, method, 27 cards),
the Atlas (index, 10 models), 73 ported docs pages plus a generated
14-page API reference, science, log, about, 404.

## Launch runbook

Commands typed by you, in order. Nothing has been pushed anywhere yet.

```sh
# 1. Authenticate gh (it was logged out on this box)
gh auth login

# 2. Create the org user-site repo and push the site
gh repo create reward-lens/reward-lens.github.io --public \
  --description "The reward-lens website: the scored ledger, the Atlas, the docs, the science."
cd /home/suhail-nadaf/final-reward/reward-lens--github/site
git remote add origin git@github.com:reward-lens/reward-lens.github.io.git
git push -u origin main

# 3. Set Pages source to GitHub Actions (the one manual click, or this call)
gh api -X POST repos/reward-lens/reward-lens.github.io/pages \
  -f build_type=workflow || true
# If that errors, click: repo Settings -> Pages -> Source -> GitHub Actions.

# 4. Watch the deploy finish
gh run watch --repo reward-lens/reward-lens.github.io

# 5. Flip the old docs site to redirect stubs (branch is ready, not merged)
cd /home/suhail-nadaf/final-reward/reward-lens--github/reward-lens-clean
git merge docs-redirect
git push neworg main

# 6. Verify in a browser
#    https://reward-lens.github.io/
#    https://reward-lens.github.io/campaign/
#    https://reward-lens.github.io/campaign/chi-drift/
#    https://reward-lens.github.io/atlas/skywork-v2-qwen3-8b/
#    https://reward-lens.github.io/docs/how-to/attribute-a-score/
#    https://reward-lens.github.io/reward-lens/how-to/attribute-a-score/  (redirects)
```

Rebuilding from a fresh clone: `npm ci && npm run build`, then
`npm run check` (the claims gate needs `pip install reward-lens==2.0.1` or
the project venv). Data refresh from the campaign store:
`/home/suhail-nadaf/final-reward/.venv/bin/python scripts/build_data.py`;
demo artifacts: `scripts/build_demo_artifacts.py`; docs re-port:
`scripts/port_docs.py`; OG images: `node scripts/og_render.mjs`.

## Stack

- Node v20.19.5 (system), npm 10.8.2, lockfile committed.
- Astro 5.18.2, static output, trailingSlash always, directory build format.
  npm resolved Astro 6 on install day; pinned back to 5 because the brief
  fixes Astro 5 and its APIs are the known quantity.
- React 19 islands (four: ledger strip, token strip, hypothesis board, audit
  walkthrough), @astrojs/mdx, @astrojs/sitemap, Tailwind 4 via @tailwindcss/vite
  with every value token-backed, KaTeX at build time, Shiki dual themes
  (github-light-high-contrast / github-dark-high-contrast, chosen for AA
  token contrast on the site's code surfaces), Pagefind search, @fontsource
  self-hosted fonts (Instrument Serif, IBM Plex Sans/Serif/Mono, latin
  subsets, two weights per family).
- Python pipeline runs with the project venv (reward-lens editable install,
  which points at the campaign worktree, so EvidenceStore readonly=True is
  available and used).
- PNG optimization: optipng -o2 (lossless; oxipng is not installed here).
- Playwright drives the system Chrome (/usr/bin/google-chrome); no browser
  download was needed.

## Decisions the brief delegated

- Headline: "See what the reward model actually learned." Chosen over "The
  instrument for looking inside reward models" because the sub-line is the
  README's canonical tagline and already carries "tools ... for reward
  models"; the imperative headline adds an outcome instead of repeating the
  category, and it pairs with the lens demo band that sits one scroll below.
- Logo: direction B, the lens trace (circle crossed by a scan line stepping
  into an amber peak). Judged against the grid at
  /tmp/claude-1000/-home-suhail-nadaf-final-reward/22429700-312e-4180-bcf6-7aa95fbad11d/scratchpad/brand/selection-grid.png:
  B is the only mark crisp and unambiguous at 16 px, it reads as a signal
  seen through an instrument (the closest answer to "does this say
  measurement of reward"), and it works one-color. A (the r-hat) has the
  strongest concept, the estimator confession, but its typeset italic r
  collapses at favicon size; it is the runner-up if you want to overrule.
  C reads as a keyboard glyph. Wordmark: mark plus "reward-lens" in IBM
  Plex Mono converted to paths; the amber element is the trace peak.
- Campaign masthead, method title, atlas intro, science intro, about opener,
  404 line: the brief's candidates, used as written.
- The lens demo uses the library's own gated instrument
  (DenseRewardExtractor.dense_rewards, first differences of the prefix-score
  curve) on the real Skywork-Reward-V2-Qwen3-0.6B, computed on CPU in 18s;
  the tiny-trunk fallback was not needed. Five diagnostic_v3 pairs, one per
  axis (helpfulness, verbosity, sycophancy, correctness, formatting), chosen
  as the shortest pair per axis for strip legibility. The formatting pair is
  kept even though the model scores the rejected completion higher; the demo
  copy names the miss.
- The layer readout explorer (9.6, the stretch goal) was cut, and no stub of
  it appears anywhere on the site.
- Dense-data interactives use a single-tab-stop keyboard model (arrow keys
  move the active mark/token, Enter opens, Escape clears) instead of dozens
  of sub-24px tab stops; the full data always also renders as a
  visually-hidden table, and the hypothesis board carries the same rows with
  full-size controls.
- The CLI excerpt under the install strip is verbatim `reward-lens --help`
  output captured from the installed CLI, whole lines only. It appears on
  the homepage and docs portal; the footer keeps just the install line (a
  full terminal block in a footer read as noise, the one deliberate
  deviation from 9.7's three placements).
- OG images (29) render via Playwright from an HTML template: dark surface,
  the mark, Instrument Serif titles; per-card images carry the card id and
  verdict word.

## Source-versus-brief discrepancies (source wins; brief appendix noted)

- GPU seconds summed from the store's cost fields: 16,074.1, not 16,158.
  The method page cites the computed value and says how it was computed.
- Distinct observables in the store: 82, not 84.
- Docs corpus: 88 markdown files (74 authored pages + 14
  mkdocstrings reference pages the generated API reference replaces); 73
  pages ported (index.md is superseded by the docs portal).
- Per-arc dollar figures ($4.24 / $3.19) exist in no store record; the
  method page names the largest arcs by GPU-seconds computed from the store
  (model:skywork-v2-llama31-8b 3,862s; model:skywork-v2-qwen3-8b 2,910s)
  beside the close_summary total spend.
- HF repo ids appear in neither the store nor the shipped card HTMLs; the
  only recorded source is the frozen campaign worktree's campaign/config.py
  Seat table, which the pipeline parses. Flagged here because the brief
  said "from the store fingerprints or card HTMLs"; neither carries them.
- The works ledger file holds three tables (65 features + 3 gate firings +
  7 v1 failure-class regressions); the failure-class table on the method
  page uses the file's own rows, with evidence ids, rather than the brief's
  reconstruction.
- The arXiv citation (2604.26130) resolves publicly; the README citation
  block is reused verbatim on /about/.

## Inherited inconsistencies (flagged, not fixed; outside site scope)

- pyproject.toml URLs and docs/mkdocs.yml site_url still point at the
  personal suhailnadaf509 account and readthedocs.
- GitHub Releases still shows v1.0.0 as latest even though v2.0.1 tags
  exist and 2.0.1 is on PyPI.
- The org repo has only main public; the campaign branch is not public, so
  the method page's reproduction block says the campaign harness accompanies
  a future release (verified via git ls-remote at build time, 2026-07-23).

## The data pipeline

scripts/build_data.py is the only bridge from campaign-results/ to the
repo. It asserts before writing: 53 hypotheses at 16/21/16; 27 cards at
4/8/7/8; exactly the 8 expected kill ids; headline observed values
spot-checked against RESULTS.md to 1e-4; 10 fleet models; 62 campaign PNGs;
48 docs SVGs; 65 works-ledger feature rows at 45/4/7/9; 27 spec hashes in
the freeze manifest. Every vendored file is recorded in
src/data/provenance.json (source path, sha256, bytes, extraction date,
pipeline commit). The evidence store itself is never committed; the claims
mini-store (the 27 adjudication records, verbatim JSONL) is, so the claims
gate runs on real evidence everywhere including CI.

Fleet route: the store opened with EvidenceStore(path, readonly=True) and
cards rebuilt natively via reward_lens.artifacts.card.build_card; the
shipped card HTMLs were not scraped. Headline scalars per model come from
the campaign.index.table payloads, each displayed with its evidence id and
its actual trust level (exploratory, and the Atlas says why).

## The gates (all green at head)

- scripts/checks/data_assertions.mjs: committed-data invariants, store-free.
- astro check: types, zero errors.
- scripts/checks/links.mjs: 133 pages, zero broken internal refs.
- scripts/checks/copy_grep.mjs: em dashes, hype vocabulary, placeholder
  text, katex-error over rendered HTML: zero. Documented exemption: pages
  under /docs/reference/ are excluded from the dash and vocabulary checks
  only, because they quote library docstrings verbatim; they are still
  checked for TODO, lorem, coming-soon, and katex-error.
- scripts/checks/redirects.mjs: 88 old-to-new mappings, every target exists.
- scripts/checks/meta_audit.mjs: title, description, canonical, og:image
  (file exists) on every page; sitemap + robots.txt + Pagefind index.
- scripts/checks/claims_gate.sh: 25 claims in site-claims.md verified
  against the adjudication records (also passes with the PyPI 2.0.1 wheel,
  which is what CI installs).
- scripts/checks/axe.mjs: zero serious or critical violations across 13
  representative pages, both themes.
- Lighthouse (system Chrome, mobile emulation) on the four named pages:
  home 98/100/100/100, campaign index 98/100/100/100, chi-drift card
  100/100/100/100, docs concepts page 99/100/100/100
  (performance/accessibility/best-practices/SEO); CLS 0 on all four;
  homepage total weight 196 KiB; homepage JS 61.4 KB gzip (budget 75).
- No page scrolls horizontally at 360 px (checked programmatically across
  14 representative pages).

## Palette validation record (dataviz validator, --pairs all)

Status set, dark on #0C1017: confirmed #009A75, refuted #AB4238, mixed
#BB8805, inconclusive #4675AF.

```
[PASS] Lightness band       all 4 inside L 0.48-0.67
[PASS] Chroma floor         all 4 >= 0.1
[PASS] CVD separation       worst all-pairs #bb8805/#009a75 dE 9.3 (protan), tritan 7.4
[PASS] Normal-vision floor  worst all-pairs #4675af/#009a75 dE 16.5
[PASS] Contrast vs surface  all 4 >= 3:1
```

Status set, light on #FAFAF7: confirmed #007A55, refuted #92261F, mixed
#AE7900, inconclusive #3C6AA4.

```
[PASS] Lightness band       all 4 inside L 0.43-0.77
[PASS] Chroma floor         all 4 >= 0.1
[PASS] CVD separation       worst all-pairs #92261f/#007a55 dE 8.2 (deutan), tritan 2.8
[PASS] Normal-vision floor  worst all-pairs #3c6aa4/#007a55 dE 15.4
[PASS] Contrast vs surface  all 4 >= 3:1
```

The brief asked for inconclusive as neutral gray; the validator's chroma
floor rules out a true gray in a validated categorical set, so inconclusive
carries a quiet slate tint at the minimum passing chroma. Glyph and word
always accompany status colors. Validation ran in all-pairs mode (stricter
than the default) because the ledger strip interleaves outcomes arbitrarily.
The diverging ramp for signed token attribution reuses the docs palette
lineage: chosen #2A78D6/#5598E7, rejected #E34948/#F0716F, neutral
midpoints, intensity capped at 45% so ink text keeps AA on token tints.

## Analytics

None ship. A commented hook sits in src/layouts/Base.astro's head slot
region; if wanted later, a privacy-respecting option (Plausible or
GoatCounter, self-hosted or EU-hosted) is a user decision.

## Component inventory added beyond Appendix G

CliExcerpt (verbatim CLI help block) and SectionNavTree (internal recursive
helper for the docs sidebar). Both follow the contract rules; recorded here
per the "add it to the list first" rule in CONTRACTS.md.
