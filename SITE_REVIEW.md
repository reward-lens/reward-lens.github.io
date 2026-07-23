# Adversarial review log

Round-by-round record of the fresh-context panel. A round closes when every
launch-blocking and credibility-damaging finding is fixed; the gauntlet ends
when a complete fresh panel returns zero findings in those two classes.

## Round 1: convened 2026-07-24

Panel: truth auditor, design critic, copy auditor, accessibility and
performance auditor, fresh-eyes researcher. Findings below as reported;
severity classes: launch-blocking / credibility-damaging / polish.

### Findings and resolutions

Truth auditor: every re-derived number traced at full precision (receipts,
walkthrough artifacts, card pages, method sums, atlas values, provenance
hashes). Four findings.
- T9 called a "standing theorem" on home and science; scoreboard.json says
  candidate_law (credibility-damaging). FIXED: both now say candidate law.
- Walkthrough step 1 presented registered_probability as a spec-file field;
  it lives in probabilities.json (polish). FIXED: fragment now shows the two
  sources separately, label names both files.
- Same model shows different GPU-second totals across pages, both
  defensible aggregations (polish). FIXED: atlas ledes now name the
  grouping and point at the method page's per-arc totals.
- Log's "first public release" ignored PyPI 1.0.0 of 2026-04-12 (polish).
  FIXED: 1.0.0 added as a real entry; the 07-08 entry retitled.

Design critic: no AI-default aesthetics, signature atoms internally
consistent, both themes designed, mobile works. One launch-blocking, six
credibility-damaging, ten polish.
- Trust-ladder docs page rendered the four rungs as one run-on word: the
  corpus's rl-chip markup shipped without its stylesheet (launch-blocking).
  FIXED: styles ported (src/styles/docs-legacy.css), colors from the same
  palette pipeline as the shipped diagrams.
- Homepage trust-rung letters were amber, violating the amber-is-never-
  status rule. FIXED: neutral ink.
- Filter chips were pills; pills are reserved for status chips. FIXED: card
  radius. Verdict and kill pills stay, sanctioned by the token spec.
- Method and science prose ran at 84ch. FIXED: 68ch.
- Homepage band headings dropped below the 40px display floor at small
  widths. FIXED: floored at 2.5rem.
- Empty "kui inputs" tables on every atlas model page. FIXED: empty
  headline tables are skipped (also flagged by the copy auditor).
- Atlas full observable table now collapsible (the brief's curation rule),
  plain-value receipt chips height-matched, sticky first column verified.
- ACCEPTED, with reasons: the campaign figures' internal palette (confirmed
  drawn blue) and the docs diagrams' trust colors differ from the site's
  status set; both are shipped scientific artifacts the brief forbids
  recoloring, and each carries its own legend. The light theme's warm paper
  is the brief's own value. STYLE-RMB's figure is the honest adjudication
  artifact of an inconclusive card. Atlas model pages keep utilitarian sans
  titles (data sheets), section indexes keep display serif.

Copy auditor: no em dashes, no hype vocabulary, no meta-commentary,
refutations genuinely lead. Findings:
- Empty kui tables (fixed above).
- "The first pre-registered audit of reward models" broadened the brief's
  claim by dropping "white-box" (credibility-damaging). FIXED: restored.
- "a fifth" vs "21 percent" for the same value on one page. FIXED: unified.
- "rigorous ... end to end" and "live fire exercise" flagged as register
  risks: KEPT, they are the brief's own mandated claim wording and the
  project's own framing; recorded here as considered.

Accessibility and performance auditor: Lighthouse 98-100/100/100/100 with
CLS 0 on all four named pages, axe clean both themes, keyboard paths all
operable, reduced motion honored, search works. Findings:
- Color tokens were gated behind the JS-set data-theme attribute with no
  CSS fallback: a no-JS visitor got an unthemed page, invisible wordmark,
  and a blank ledger strip (launch-blocking). FIXED: light tokens on bare
  :root, dark under prefers-color-scheme, the attribute overriding both;
  wordmark and toggle follow the same pattern; verified no-JS under both
  OS schemes and manual-override precedence.
- Sort buttons lost their focus ring to all:inherit (credibility-damaging).
  FIXED: explicit focus-visible outline.
- Theme toggle and footer links under mobile touch-target minimums
  (polish). FIXED: 44px at mobile widths.
- Duplicate region names on data tables (moderate). FIXED: per-table
  labels.

Fresh-eyes researcher: 60-second read matched the intended claims; verdict
"substantive, not a mockup"; would install; would cite as methodology.
Findings:
- Atlas pages for dot-named models served a directory listing
  (launch-blocking as reported). DIAGNOSED: an artifact of the `npx serve`
  preview server's extension inference; `astro preview` and GitHub Pages
  serve the pages correctly. Runbook verification now uses the 0.6b page
  URL so this is confirmed live at launch.
- Evidence ids printed as receipts did not resolve anywhere, while the
  atlas promised "the evidence id resolves each one" (credibility-damaging,
  the round's sharpest finding). FIXED: /evidence/ now serves all 27
  adjudication records whole, evidence chips link resolvable ids, card
  provenance lines link their record, and the atlas wording now says
  exactly what resolves and what stays store-only.
- "Live data" phrasing on the lens demo oversold (polish). FIXED: "real,
  precomputed data."
- Undefined atlas metrics (credibility-damaging). FIXED: column headers
  link the instrument docs; the index library is linked for the rest.
- Considered, kept: the repeated kill-criterion sentence is doctrine, used
  uniformly on the eight kill cards; "first real-model confirmation" and
  n=2 framing judged accurate and already qualified in place; the
  campaign's 70% execution rate is disclosed on the homepage lede, the
  campaign index honesty note, and the method page.

Round 1 closed with all launch-blocking and credibility-damaging findings
fixed or diagnosed as tooling artifacts. Round 2 convened on the rebuilt
site to confirm.
