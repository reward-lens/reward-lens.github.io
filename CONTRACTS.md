# Component and data contracts

Single source of truth for the shared component vocabulary. Every builder uses
these exact names and props. If a page needs a component not listed here, it
gets added HERE first, then built once in src/components/.

Design rules that bind every component:

- Colors, fonts, spaces, radii come only from src/styles/tokens.css custom
  properties (or the token-backed Tailwind utilities mapped in global.css).
  No Tailwind default palette classes, no raw hex anywhere in components.
- Status colors (--ok, --bad, --mix, --none) are reserved for verdicts and
  works-ledger states, always paired with a glyph and a word. The amber accent
  is never used for status.
- The display face (Instrument Serif) only at 40px and above, weight 400 only.
- Every interactive element keyboard-operable with visible focus (global
  :focus-visible ring). Touch targets 44px on mobile.
- Data surfaces compact (15px, tight line height); prose surfaces calm
  (66-70ch measure). Never both modes in one container.
- Wide content scrolls inside its own container (.scroll-x); the page never
  scrolls horizontally.
- prefers-reduced-motion disables every animation (global rule exists).

## Data shapes (src/data/)

- ledger.json: LedgerRow[53]: { card, slug, hypothesis_id, statement, metric,
  comparator, threshold, registered_prob|null, interval_prediction|null,
  observed|null, outcome: 'confirmed'|'refuted'|'inconclusive', kill_id|null,
  inconclusive_reason|null, science }
- cards.json: CardEntry[27]: { id (slug), card (ID like "CHI-DRIFT"), title,
  science ("S3"), science_name, verdict, kill_fired|null, kill_criteria[],
  hypotheses[] ({ id, statement, metric, comparator, threshold, ci_excludes,
  registered_prob, interval_prediction, observed, outcome, scoreboard_row }),
  adjudication_ev, adjudicated_at, frozen_at, spec_hash, spec_file, study_id,
  figure (base name), caption, power_acceptance|null ({power, mde, note}),
  inconclusive_reason|null, companion_metrics {}, subjects {} }
- theorems.json: T[14]: { id, title, kind, status, adjudicating_evidence[],
  studies[], science, card|null (slug) }
- campaign.json: totals: { hypotheses{}, cards{}, kills_fired[], spend_usd,
  gpu_seconds, gpu_seconds_by_arc[], works_ledger{}, merge_report{}, claims{},
  freeze{frozen_at, git_sha, tag, n_specs}, adjudicated_cards, store_records }
- fleet/index.json + fleet/<slug>.json: { slug, hf_id, total_gpu_seconds,
  n_entries, headline[] ({name, meta, rows[{metric,value}], evidence_id,
  trust, gauge}), entries[] (build_card rows: {observable, version,
  value_repr, trust, gauge, calibrated, ci, n_effective, readout,
  evidence_id}) }
- captions.json: { figureBaseName: caption }
- specs/campaign-<id>.json: the frozen specs, shipped verbatim.

Figures are served from /figures/campaign/<base>.{light,dark}.png and
/figures/docs/<base>-{light,dark}.svg.

## Components (src/components/)

Astro components unless noted. Props listed exhaustively; slots named.

- PageShell = layouts/Base.astro (exists): props { title, description,
  ogImage? }. Slot: default, plus named slot "head".
- Prose.astro: wrapper applying long-form typography (IBM Plex Serif at
  var(--measure-prose), headings in Plex Sans, h1 optionally display face via
  class). Slot: default.
- EvidenceChip.astro: props { value: string|number, trust: 'E'|'C'|'R'|'A',
  evidenceId?: string, observable?: string, subject?: string,
  ci?: [number|null, number|null]|null, nEffective?: number|null,
  threshold?: string, label?: string }. Renders an inline mono chip:
  formatted value + compact trust badge letter. Hover AND focus open a
  provenance popover (CSS-reveal, content in DOM, chip is a button with
  aria-describedby): observable, subject, CI when present, n_effective,
  evidence id in copyable mono, threshold line when given. Numbers formatted
  to 4 significant digits, full precision in the popover.
- VerdictChip.astro: props { verdict: 'confirmed'|'refuted'|'mixed'|
  'inconclusive', compact?: boolean }. Status color + glyph + word:
  confirmed ✓, refuted ✕, mixed ◐, inconclusive ○. Pill radius.
- KillBadge.astro: props { kill: string }. Renders "K-<name> fired" in the
  refuted color family with a distinct bordered treatment. Mono.
- TrustBadge.astro: props { trust: 'EXPLORATORY'|'CALIBRATED'|'REGISTERED'|
  'ADJUDICATED' | 'E'|'C'|'R'|'A', word?: boolean }. Single-letter badge,
  optional full word. Neutral styling (not status colors): bordered mono.
- ThemedFigure.astro: props { light: string, dark: string, alt: string,
  caption?: string, source?: { href: string, label: string }, width?: number,
  height?: number, loading?: 'eager'|'lazy' }. <picture> with
  prefers-color-scheme source (no-JS correct) plus data-light/data-dark attrs;
  one global inline script (in Base) swaps src on manual theme toggle.
  Figure + figcaption styling; image bordered on raised surface.
- DataTable.astro: props { compact?: boolean, stickyFirst?: boolean }.
  Slot: default (a <table>). Wraps in .scroll-x, styles thead sticky, 15px
  mono-friendly cells, row hover. Sorting NOT included (islands own sorting).
- MicroBar.astro: props { value: number, max: number, color?: 'ok'|'bad'|
  'mix'|'none'|'accent'|'info' }. 2px-high inline bar, recessive.
- Callout.astro: props { type: 'note'|'info'|'warn'|'important'|'tip',
  title?: string }. Slot: default. Quiet bordered aside, info color family,
  never status colors. Types map to small inline SVG glyphs, no emoji.
- CodeBlock.astro: props { filename?: string, lang?: string }. Slot: default
  (pre-rendered code or plain text). Adds header row with filename + copy
  button. For markdown-rendered code, the docs layout adds copy buttons via
  one global script targeting .astro-code.
- InstallStrip.astro: props { center?: boolean }. pip/uv tabs (radio-based,
  no-JS switchable), copy button, quiet terminal styling.
- TerminalExcerpt.astro: props { title?: string }. Slot: default (verbatim
  captured CLI output). Monospace block, no invented content ever.
- StatRow.astro: props { stats: Array<{ value: string, label: string,
  evidenceId?: string, trust?: 'E'|'C'|'R'|'A' }> }. Compact row of evidence
  chips with labels beneath.
- SectionNav.astro: props { items: Array<{ title, href, children?: [...] }>,
  current: string }. Docs sidebar; current-page highlight; collapses to an
  on-page section picker (details/summary) below 900px.
- PrevNext.astro: props { prev?: { title, href }, next?: { title, href } }.
- LogEntry.astro: props { date: Date, type: string, title: string,
  links?: Array<{label, href}> }. One row: date (mono) · type chip · title ·
  links. Transformer-Circuits register: quiet, reverse-chronological.
- PageHeader.astro: props { title: string, eyebrow?: string, lede?: string,
  display?: boolean }. Section opener; display=true sets Instrument Serif at
  clamp(40px+).

## Islands (src/components/islands/, .tsx, React)

Each island must render its full content server-side (Astro renders React SSR;
the no-JS view is the same DOM without interactivity) and hydrate with
client:load or client:visible. Budgets: LedgerStrip < 15KB JS; board < 40KB.

- LedgerStrip.tsx: props { rows: LedgerRow[], animate?: boolean,
  height?: number }. One mark per hypothesis in ledger order, colored by
  outcome, kill rows carry a notch. Draw-in left-to-right over ~1s on first
  view only (sessionStorage), instant under prefers-reduced-motion. Hover and
  focus tooltip: card, hypothesis id, registered comparator+threshold,
  observed, outcome. Click → /campaign/<slug>/. Deep link: #<card-slug>
  highlights that card's marks. Wraps to two rows below 480px; marks >= 6px.
  Visually-hidden table fallback rendered always.
- HypothesisBoard.tsx: props { rows: LedgerRow[] }. Sortable, filterable
  53-row table; filter chips (all | confirmed 16 | refuted 21 |
  inconclusive 16 | kills 8) plus card and science filters; state syncs to
  query params; SSR renders the full table in default order.
- Stepper.tsx: props { steps: Array<{ id, title, body: ReactNode | html }>,
  }. Guided walkthrough shell; back/next; step syncs to ?step=; SSR renders
  all steps stacked (no-JS view), hydrated view shows one at a time.
- TokenStrip.tsx: (lens demo; wave 4) props from demo artifact JSON.

## Layout shells (src/layouts/)

- Base.astro (exists): header/footer/theme/meta.
- Docs.astro: Base + sidebar (SectionNav) + Prose main + PrevNext + on-page
  copy-button script. Props: { title, description, nav, current, prev, next }.
- Campaign.astro: Base + campaign breadcrumb strip. Props: { title,
  description, ogImage? }.
