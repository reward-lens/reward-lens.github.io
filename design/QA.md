# Acceptance

Testable. Per section. **A fix is verified against built output, never against a diff and never
against a report.** The previous attempt has four defects marked fixed in its review log that are
live in the shipped output right now, which is what that rule exists to prevent.

---

## 1. The gate list

Every one of these runs in `.github/workflows/deploy.yml`. There are no local-only gates.
A check named `verify-gate-list` parses the workflow and fails if the set of steps and this list
disagree **in either direction**: a gate missing from the workflow is a defect, and a workflow step
nobody documented is equally a defect.

**Twenty-four, not nineteen.** This table listed nineteen when it was frozen. The build brief §10
adds five (20 to 24) and one unnumbered build assertion, and `verify-gate-list` compares this table
against the workflow on the number, the name **and the command**, so all of them have to be here or
the check cannot do its job. The five new rows and the two unnumbered ones were added by packet P2
when it built the gates. Nothing else in this file was changed, and the commands in column three are
now written exactly as the workflow runs them, because a command with an ellipsis in it is not a
command a check can compare.

| # | Gate | Command | Fails on |
|---|---|---|---|
| ++ | The gate list | `node scripts/checks/verify-gate-list.mjs` | this table and `deploy.yml` disagreeing on a gate's number, name or command, in either direction |
| 1 | Type check | `npx astro check` | any type error |
| 2 | Build | `npm run build` | any build error, including a failed library import in the catalogue generator |
| + | Gallery absence | `node scripts/checks/gallery-absent.mjs` | `dist/gallery/` existing at all. Not numbered: it is a build assertion, and it is why the route cannot survive to launch by being forgotten (D-33) |
| 3 | Data derivation | `python scripts/build_data.py` | a generator that cannot derive a value it is asked for |
| 4 | Regression values | `node scripts/checks/known-values.mjs` | a derived value differing from `tests/regression/known-values.json` |
| 5 | Provenance sweep | `node scripts/checks/provenance.mjs` | a numeric token in rendered HTML bound to neither an evidence id nor the allow-list |
| 6 | Terminology lock | `node scripts/checks/terms.mjs` | a forbidden synonym in rendered HTML |
| 7 | Banned identifiers | `node scripts/checks/banned.mjs` | any of ~620 internal identifiers in rendered HTML outside `/log/` and bundles |
| 8 | Claims gate | `bash scripts/checks/claims_gate.sh` | a tagged claim disagreeing with the evidence store |
| 9 | Copy bans | `node scripts/checks/copy_grep.mjs` | **a `copy.yaml` that does not parse**, then an em dash in prose, a hype word, a leaked-intent phrase, a `.katex-error` node |
| 10 | Links, internal | `node scripts/checks/links.mjs` | a dead internal link |
| 11 | Links, external | `node scripts/checks/links-external.mjs` | a non-2xx on any URL in `copy.yaml:urls`, **or a 2xx that resolves to the wrong destination** |
| 12 | Redirects | `node scripts/checks/redirects.mjs` | an **old** path that does not resolve in `dist/`, or resolves somewhere other than its stated destination |
| 13 | Metadata and previews | `node scripts/checks/meta_audit.mjs` | a page with no title, description or preview image; a preview image whose text is not from `copy.yaml`; any third-party origin in built output |
| 14 | **Accessibility** | `node scripts/checks/axe.mjs` | any WCAG 2.2 AA violation, on every route, **against a ratchet file that may shrink and must not grow** |
| 15 | Token drift | `node scripts/checks/drift.mjs` | a colour, size, spacing value, radius or duration outside `tokens.css`, in `src/`, `scripts/` or `film/` |
| 16 | Performance budgets | `node scripts/checks/budgets.mjs` | any budget in `DESIGN.md` §19 exceeded |
| 17 | Frame budget | `node scripts/checks/frames.mjs` | a long task over 50ms, p95 frame over 16.6ms at tier B, or an 8% regression |
| 18 | No-scene build | `bash scripts/checks/no-scene-build.sh` | gates 14 and 16 failing on the `PUBLIC_SCENE=off` build |
| 19 | Responsive geometry | `node scripts/checks/overflow.mjs` | `document.documentElement.scrollWidth > viewport` at 320, 360, 390, 768, 1024, 1440, 1920 |
| **20** | **Hero fidelity** | `node scripts/checks/fidelity.mjs` | the three fidelities disagreeing by more than 8px on beam axis or prism centroid |
| **21** | **Hero luminance** | `node scripts/checks/hero-luminance.mjs` | a safe zone over its ceiling, the install strip not the brightest element, or **the strip's border under 3:1 against the rendered pixels immediately outside it** |
| **22** | **Figure data binding** | `node scripts/checks/bands.mjs` | a rendered band width, bar height or trace point disagreeing with its source JSON |
| **23** | **Visual baseline** | `node scripts/checks/visual-diff.mjs` | more than 0.4% changed pixels on a route the change did not touch |
| **24** | **Film provenance** | `node scripts/checks/film-provenance.mjs` | a colour in `film/**` outside `tokens.css`, or a number in a caption or frame outside the evidence store |
| **25** | **Public claims** | `npm run check:claims-public` | a rendered claim that does not resolve, a value disagreeing with its source plate, an outcome word interchanged, or a campaign identifier in a public disclosure |

**Gate 14 and gate 19 are the two the previous site did not have.** The accessibility scan existed
as a script that no workflow invoked. The overflow check did not exist.

**Six gates carry a refinement a straightforward implementation would miss**, and each is recorded
where its script can be read beside it: gate 9 parses `copy.yaml` before checking any content (C-12);
gate 11 asserts a destination and not only a status (C-5); gate 12 asserts the **old** path resolves
(C-3); gate 14 lands failing with a shrinking ratchet rather than an allow-list (D-29); gate 15
promotes `scripts/lint-tokens.mjs` rather than adding a second linter, and checks that a `@media`
length equals the token its comment names (C-21); gate 21 measures real rendered pixels rather than a
token pair (C-15).

**Gate 19 uses a real browser viewport via Playwright, not `chrome --headless --window-size`.** The
latter does not establish a mobile layout viewport and produces false clipping; this was confirmed
during design work when a specimen that measured correct at 390px appeared clipped under
`--window-size=390`. Recorded here so the build team does not rediscover it.

**The claims gate pins the library version whose evidence semantics it enforces.** It currently
installs `reward-lens==2.0.1`, which predates the work this site describes. When 3.0.0 ships the pin
moves, and the pin bump is a reviewed change, never a floating `latest`.

---

## 2. Per-section acceptance

### 2.1 The install strip

1. Clicking anywhere on the strip copies exactly `pip install reward-lens`, with no leading prompt
   glyph and no trailing whitespace. Verified by test.
2. The version shown matches the latest released version at build time, verified against the package
   index by gate 11.
3. Tab reaches it once. Enter and Space both copy. The focus ring is visible in both themes.
4. A screen reader announces the action and the confirmation. The live region is outside the button.
5. At 360px nothing overflows and the command does not wrap.
6. With JavaScript disabled the command is still selectable text and the version row still renders.
7. If `data/release.json` is missing, the build fails. It does not render a placeholder.

### 2.2 Every figure

1. Carries a visible number, a caption stating what it shows and what data produced it, the
   generating commit, and a trust chip.
2. Is legible frozen. A screenshot of it, pasted into a slide, still reads.
3. Has real alternative text describing what it shows, not a repeat of the caption.
4. Complex figures additionally carry a long description or a data table.
5. Offers both the underlying data and the code that made it.
6. Uses no colour that is not in `tokens.css`, and encodes nothing by hue alone.

### 2.3 The three interactives

1. Each is fully keyboard operable and announces its state as text.
2. The timeline scrubber is a slider with a real value: arrow keys step one training step, page keys
   step ten, Home and End go to the ends.
3. **Each has a reachable state that is bad for the project**, and reaching it is not punished by
   the interface. Verified by a test that drives to that state and asserts what renders:
   - act one: a highly attributed component that, patched, moves the score by less than 2%
   - act two: selecting the longest-lead detector shows its surrogate false-alarm rate in the same view
   - act three: the access toggle produces the per-card read counts in `data/grader-cards.json`,
     which are 0, 0, 1 and 1 rather than zero on all four (C-46)
4. Every state is precomputed. The state count and its byte cost are stated in the page file.
5. With JavaScript disabled, each renders its default state as a static figure with its caption.

### 2.4 The scene

1. First paint does not wait on it. The hero headline is readable before any shader compiles.
2. Its failure never breaks a page.
3. `PUBLIC_SCENE=off` produces a site that passes gates 14 and 16 and that a designer would ship.
4. Under `prefers-reduced-motion`, one composed still renders and the five SVG figures carry the
   narrative. Nothing that carried information is lost.
5. If `scene-data.bin` is missing or its magic does not match, the build fails. It never renders
   synthetic data.
6. Disabling the scene and reading the page loses no information. Verified manually.

---

## 3. Accessibility

- WCAG 2.2 AA across every route, by gate 14, plus a manual keyboard and screen-reader pass on the
  three act pages and one documentation page before launch.
- Focus is always visible and focus order always follows visual order.
- Text zoom to 200% with no loss of content or function. 400% is tested and what breaks is reported
  in `reports/zoom-400.md` rather than fixed silently.
- Colour never carries meaning alone.
- `--ink-3` appears only on `--ground` and `--surface-1`. Lint rule, gate 15.
- Every interactive element has rest, hover, focus-visible, active and disabled states specified.
- A print stylesheet exists and a printed act page is readable and carries its provenance.

---

## 4. What success looks like

Beyond the checklist, so the build team knows what it is optimising for.

1. A researcher who has never heard of the project can say, after thirty seconds, what it does and
   what it refuses to claim.
2. A practitioner gets from the homepage to a running install and a first real output in under ten
   minutes without asking anyone.
3. Somebody can send one link with a two-sentence message and not need to explain the project.
4. A skeptical reader looking for overclaiming finds the limitations before they find a problem.
5. Nobody looking at the homepage asks whether it was generated.
6. Every number can be traced to a record, by a stranger, in under a minute.

Only the last is mechanically checkable, which is why §1 spends so long on it.

---

## 5. Rules for the build

1. **A fix is verified against built output.** Re-render and re-check. Never accept a claim that
   something is fixed.
2. **No build agent invents a value.** If a needed token, string or contract does not exist, stop and
   ask. Eight invented spacing values is how a site stops looking designed.
3. **Numbers are never typed into a component.** They render from generated JSON.
4. **A component that reads a field not in its schema is a build failure.**
5. **Two work packets never own the same file.**

---

## 6. The eight audits, run and published

### 6.1 The generic test

Three strongest screens, and what would have to change for each to be a different product's site.

| Screen | What would have to change |
|---|---|
| Homepage hero | The scene is a dispersing element whose six band widths are this project's measured component magnitudes, loaded from a binary this project generates. To reuse it you would need a product whose central object is a scalar resolving into named parts. The install strip's version row exists because this project's released version is behind its documented one. Neither transfers. |
| Act two, the detector table | The columns are lead time in transition widths and surrogate false-alarm rate. A product without a preregistered comparator and an order-destroyed null has neither column. The row that is highlighted is not the best one on the first column. |
| Act three, the grader card | The component's content is mostly absence: refused fields with reasons and remedies. No other product produces a page of refusals, because no other product has a `Refusal` type that cannot be constructed without a remedy. |

**Verdict: pass.** The answer is not "the words" in any of the three.

### 6.2 The anti-pattern sweep

Full §6.1 list checked line by line. Five entries are present and defended in `DESIGN.md` §22: dark
ground, near-black-with-a-bright-element, the margin column, mono micro-labels, and a bright cyan at
the top of the trust ladder. Every other entry is absent.

The hype list, banned in `copy.yaml` and enforced by gate 9: seamless, seamlessly, leverage, unlock,
empower, supercharge, cutting-edge, revolutionary, game-changing, robust, comprehensive, powerful,
effortlessly, in seconds, at scale, next-generation, best-in-class, transform, elevate, journey,
delve, tapestry, landscape (figurative), realm, "it's not just X, it's Y", "whether you're a X or a
Y", "in today's world", "in the era of", "as AI becomes".

**Verdict: pass with five defended entries.**

### 6.3 The overclaim sweep

Every claim in `copy.yaml` checked against `GROUND-TRUTH.md`. Three were rewritten:

1. The homepage run section originally read "the shipped signal alarms sixteen steps before the
   transition." Rewritten to state the lead in transition widths with the comparator named, because
   a lead in raw steps is not comparable across runs and the library says so explicitly.
2. The first-result section originally said the two localization methods "tied." Rewritten per
   `DECISIONS.md` D-14: the registered prediction was refuted, the kill fired, and neither can be
   preferred because the answer key's noise is a live alternative.
3. The grader section originally said the checker "cannot detect any error." Rewritten to the
   measured claim: 60 of 60 mutants survive against 240 real gold answer pairs, with the
   other-subjects comparison attached so the instrument is not read as broken.

**Verdict: pass after three rewrites.**

### 6.4 The vocabulary sweep

`copy.yaml` searched for every banned identifier family. **Zero hits.** The four terms that survive
(`the kernel`, `the sciences`, `the gates`, `the wedge`) are each glossed at first use.

**Verdict: pass.**

### 6.5 The stranger test

Written as a reinforcement-learning researcher who has never seen this project.

- **Three seconds:** "Something about reward functions not matching what the model actually learns.
  Dark, technical, and there is a real diagram rather than a stock illustration."
- **Thirty seconds:** "This reads reward models and watches training runs, and it says when it
  cannot. There is a correlation of about −0.17 between two ways of localizing a preference, which
  means the cheap method and the expensive method disagree. I can install it right now, and what I
  install is a version behind what I am reading about."
- **Three minutes:** "Three exhibits. One reward model where two methods disagree and the tie-break
  went against the author. One training run where a signal leads by 0.67 transition widths and two
  better-looking signals were thrown out because they fire on scrambled data. One grader audit where
  a standard maths checker survives all 60 mutations. Every number opens a record."
- **The full demonstration:** "The refusals are the product. And the campaign's own calibration
  failed its own test, which is on the site."

The thirty-second answer contains "reads reward models and watches training runs, and it says when
it cannot." **Verdict: pass.**

### 6.6 The skeptic test

The three most damaging things a hostile reviewer would say:

1. **"This is one person's project with n=1 on every claim, and no external reproduction."** True and
   unfixable by design work. Answered on `/limits/` in the first paragraph, and by the
   reproduction-status line on every act page reading "No independent reproduction recorded."
   Fixable only by somebody reproducing it, which is what `/collaborate/` asks for specifically.
2. **"The site's own honesty is a marketing position."** The real risk named in the commission's
   Appendix K. Answered structurally rather than rhetorically: the limitations appear once, in one
   place, in plain language, and then the site gets on with showing work. `/limits/` is a page, not a
   theme. The self-indictment sits inside act three where it is evidence, not on the homepage where
   it would be a pitch.
3. **"The headline result is a negative correlation whose own adjudication was inconclusive, so you
   are leading with something you cannot interpret."** Fair. Answered by stating exactly that on the
   act page, including both AUCs and the disclosed alternative reading, and by not putting a
   confident interpretation on the homepage.

### 6.7 The degradation test

The homepage with `PUBLIC_SCENE=off`: headline, subhead, install strip, five SVG figures in the five
scene slots, and every section's content intact. It is a site direction B would have been, which is
a site worth shipping. **Verdict: pass.** The design does not depend on the scene, which is the
condition under which the scene was adopted.

### 6.8 The completeness test

Three sections picked at random and built mentally from the specification alone. Holes found and
filled:

1. **Homepage §4, the code block.** The specification said "ten to fifteen runnable lines" without
   saying which. Filled: the `card_plan` example from the README, which is generated, verified to
   run, and produces the "2 of 13 fields would read" output that the adjacent copy quotes.
2. **Act two's scrubber, keyboard step size.** Arrow-key behaviour was stated but the announced
   string was not. Filled in the component contract: the live region announces
   "Step {n} of 400. Hack rate {x}. Monitor: {fired|not fired}."
3. **The provenance panel on a touch device.** Hover and focus were specified; tap was not. Filled:
   tap opens, tap outside closes, and the panel is positioned by a collision-aware placement that
   never covers the number it describes.

### 6.9 The drift test

No number in `copy.yaml` that is not either a `{{token}}` bound to generated data or an allow-listed
literal with a reason. No term in `copy.yaml` outside the terminology lock.

**Two word-sense adjudications, declared rather than silently coded around.** Both were found by
running the copy bans against this specification itself, which is the discipline §15 of `DESIGN.md`
requires and which caught 26 genuine violations in the design documents.

1. **"robust" is on the hype list and has a technical sense.** `copy.yaml:acts.run.companion` reads
   "The sign is robust and the magnitude is not," which is the project's own phrasing for a
   statistical property and not a marketing adjective. Gate 9 allow-lists the exact phrase
   `the sign is robust`, not the bare word. A build agent that finds "robust" elsewhere should
   assume it is the banned sense.
2. **An em dash used as a null marker in a table cell is a data convention, not prose punctuation.**
   Twelve remain in this specification, all in table cells or ASCII diagrams meaning "no value"
   (a detector that does not alarm has no lead time). Gate 9 matches em dashes in prose text nodes
   and skips cells whose entire content is the character. The ban is on the em dash as a sentence
   connective, which is what makes writing read as generated, and there are zero of those.

**One exception, declared.** The trust-ladder licensing sentences and the three limits are carried
in `copy.yaml` as literal prose rather than generated, because they exist only as authored
documentation prose and have no machine-readable source. They carry their `file:line` citation next
to them in `GROUND-TRUTH.md` §5A.2 and §5A.6, and a check asserts the strings still match the
documentation source. See `DECISIONS.md` D-11.
