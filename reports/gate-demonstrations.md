# Every gate, seen to fail

**A gate nobody has ever seen fail is a gate nobody knows works.** The previous site's
accessibility check existed as a script no workflow invoked, and that is how a perfect score
becomes a claim nobody is re-checking. So each of the twenty-four gates, plus the two unnumbered
assertions, was made to fail on purpose: the defect it exists to catch was introduced, the gate was
run, its output recorded, the defect reverted, and the gate run again.

Run on 2026-08-08 by packet P2, against `dist/` built from commit `605e18f`, Node v20.19.5,
system Chrome 141 through Playwright 1.61.1.

**Two gates did not fail the first time, and both were bugs in the gate.** That is the entire
argument for doing this. They are entries 15a and 24 below and both are recorded with the bug and
the fix rather than quietly corrected.

---

## Contents

| # | Gate | Defect introduced | Failed? |
|---|---|---|---|
| [++](#gate--the-gate-list) | The gate list | a gate's step deleted from `deploy.yml` | yes |
| [1](#gate-1--type-check) | Type check | a type error in a `src/` component | yes |
| [2](#gate-2--build) | Build | the redirect map read from a data file that does not exist | yes, second attempt |
| [+](#gate--gallery-absence) | Gallery absence | none needed, then `PUBLIC_GALLERY=1` | yes, twice |
| [3](#gate-3--data-derivation) | Data derivation | none needed: it fails today | yes, natively |
| [4](#gate-4--regression-values) | Regression values | two pinned values perturbed | yes |
| [5](#gate-5--provenance-sweep) | Provenance sweep | an unbound number on a swept route | yes |
| [6](#gate-6--terminology-lock) | Terminology lock | "sixteen reasons" reintroduced | yes |
| [7](#gate-7--banned-identifiers) | Banned identifiers | `ADJ-AVP` and `W4.4` in rendered HTML | yes |
| [8](#gate-8--claims-gate) | Claims gate | a claim's evidence id perturbed | yes |
| [9a](#gate-9a--copy-bans-the-parse-arm) | Copy bans, parse | C-12's unquoted colon reintroduced | yes |
| [9b](#gate-9b--copy-bans-the-em-dash-arm) | Copy bans, em dash | an em dash as a sentence connective | yes |
| [10](#gate-10--links-internal) | Links, internal | a link to an unbuilt route | yes |
| [11](#gate-11--links-external) | Links, external | a URL that 200s at the wrong destination | yes |
| [12](#gate-12--redirects) | Redirects | a page shadowing a redirect at the old path | yes |
| [13a](#gate-13a--metadata-the-title-arm) | Metadata, title | a page's `<title>` removed | yes |
| [13b](#gate-13b--metadata-the-preview-text-arm) | Metadata, preview text | a preview image advertising a rejected headline | yes |
| [13c](#gate-13c--metadata-the-third-party-arm) | Metadata, third party | a CDN `<script src>` in built output | yes |
| [14](#gate-14--accessibility) | Accessibility | a new contrast violation, not on the ratchet | yes |
| [15a](#gate-15a--token-drift-the-colour-arm) | Token drift, colour | a colour literal in `scripts/checks/` | **no, then yes** |
| [15b](#gate-15b--token-drift-the-c-21-arm) | Token drift, C-21 | a `@media` length labelled with the wrong token | yes |
| [16](#gate-16--performance-budgets) | Performance budgets | 60KB added to the font payload | yes |
| [17](#gate-17--frame-budget) | Frame budget | a 400ms long task on scroll | yes |
| [18](#gate-18--no-scene-build) | No-scene build | gate 14's ratchet emptied | yes |
| [19](#gate-19--responsive-geometry) | Responsive geometry | a 2400px unwrapped element | yes |
| [20](#gate-20--hero-fidelity) | Hero fidelity | two fidelities 378px apart | yes |
| [21](#gate-21--hero-luminance) | Hero luminance | a lit headline zone and a brighter link | yes |
| [22](#gate-22--figure-data-binding) | Figure data binding | a bar drawn at 45% while bound to 62% | yes |
| [23](#gate-23--visual-baseline) | Visual baseline | letter-spacing changed on one route | yes |
| [24](#gate-24--film-provenance) | Film provenance | a colour literal in `film/` | **no, then yes** |
| [25](#gate-25--public-claims) | Public claims | a slug, a value, a status and an identifier | yes, four arms |
| [+](#assertion--no-local-path-ships) | No local path ships | a home path, a `file://` and a worktree path | yes, three rules |

Twenty-eight entries for twenty-five gates and three assertions: gates 9 and 13 are demonstrated
once per arm, because their arms fail for different reasons and one arm passing tells you nothing
about the other.

---

## Gate ++ · The gate list

**Defect.** Deleted the seven lines of gate 11's step from `.github/workflows/deploy.yml`.

```
FAIL gate 11 (Links, external) is in QA.md §1 and has no step in deploy.yml.
     A gate that is not in the workflow does not exist.

verify-gate-list: 26 rows in QA.md §1, 25 gate steps in deploy.yml, 10 infrastructure steps, 1 failures
```

**Revert.** `git checkout -- .github/workflows/deploy.yml`. Exit 0, 26 and 26.

The other direction is checked too and is harder to see: a step present in the workflow with no row
in the table fails identically, and so does a step whose `run:` differs from the command the table
states. That last one is the case a count-only reconciliation misses, and it is the shape a gate
takes after somebody renames a file.

---

## Gate 1 · Type check

**Defect.** A new component assigning a string to a `number`.

```
src/components/_p2-typecheck-demo.astro:2:7 - error ts(2322): Type 'string' is not assignable to type 'number'.
- 1 error
```

**Revert.** Deleted the file. Exit 0.

---

## Gate 2 · Build

**First attempt did not fail**, and the reason is worth recording: an underscore-prefixed page is
removed from Astro's routing manifest, so a component only that page imports is never evaluated and
a broken import in it does not break the build. Same property D-33 records for `_gallery.astro`.

**Defect, second attempt.** Pointed `astro.config.mjs`'s redirect map at
`src/data/cards-that-do-not-exist.json`. P2 owns that file, so the demonstration needed no other
packet's.

```
[vite] (ssr) Error when evaluating SSR module .../astro.config.mjs:
ENOENT: no such file or directory, open '.../src/data/cards-that-do-not-exist.json'
```

**Revert.** `git checkout -- astro.config.mjs`. Exit 0.

---

## Gate + · Gallery absence

**Demonstrated twice: once when it was failing on merit, and again after the build lead resolved
it.** Both runs are kept, because the second is the one that shows the assertion still has teeth.

**First run, at the time of the packet.** No defect needed: the route shipped, so the assertion
failed, which is the point of D-33's "mechanical rather than a promise".

```
FAIL dist/gallery/ exists and must not (D-33).
     1 file(s): index.html
```

P2 named the fix as deleting `src/pages/gallery.astro`, and **that was the wrong fix**. It takes the
gallery away from the four packets screenshotting components against it, which is the one thing D-33
says not to do. The build lead resolved it differently: the route is now
`src/pages/gallery/[...rest].astro` whose `getStaticPaths` returns `[]` unless `PUBLIC_GALLERY=1`.
`import.meta.env` is inlined at build time, so a production build prunes the route rather than
emitting an empty directory, and the gallery stays loadable in development.

**Second run, against that resolution.** Both directions verified on `main`:

```
$ npm run build && node scripts/checks/gallery-absent.mjs
gallery-absent: dist/gallery/ does not exist                        exit 0

$ PUBLIC_GALLERY=1 npm run build && node scripts/checks/gallery-absent.mjs
FAIL dist/gallery/ exists and must not (D-33).                       exit 1
     Cause: PUBLIC_GALLERY=1 was set for this build.
     That flag is for screenshotting components locally. A production build must not set it.
```

So the assertion passes on merit rather than because the thing it checks for became unreachable, and
it still fires the moment the route reaches `dist/` by any route.

**The failure message was corrected in the same pass**, and it is worth recording why. It still read
"Fix: delete `src/pages/gallery.astro`", naming a file that no longer exists. A gate whose failure
message sends the next reader hunting for a deleted file is a gate that costs more than it saves at
exactly the moment it fires. It now diagnoses the two distinct causes separately: the flag was set
for a production build, or the flag is unset and the route was not pruned, in which case the likely
error is `getStaticPaths` reading `process.env` instead of `import.meta.env`, because only the
latter is inlined at build time.

---

## Gate 3 · Data derivation

**No defect needed. This gate fails today**, in two different ways depending on the interpreter,
and neither is P2's to fix.

With the CI interpreter (bare `python3`, which is what `deploy.yml` runs):

```
File ".../scripts/build_data.py", line 589, in main
    from reward_lens.core.store import EvidenceStore
ModuleNotFoundError: No module named 'reward_lens'
```

With the assay venv, which does have the library:

```
File ".../reward_lens/core/evidence.py", line 323, in _decode_dataclass
    raise PayloadTypeUnregistered(
reward_lens.core.evidence.PayloadTypeUnregistered: payload type
'campaign.payloads.TablePayload' is not registered, so decoding it would return a plain dict
carrying its fields. Import the module that defines it, or decorate it with @register_payload.
```

The gate is wired exactly as `QA.md` §1 states. `scripts/build_*` is packet P1's and P2 must not
touch it. Escalated.

---

## Gate 4 · Regression values

**Defect.** In the fixture regression file, `ledger.rows` 53 → 52 and `cards.total` 27 → 26.

```
FAIL ledger.rows: derived 53, known-values.json says 52
FAIL cards.total: derived 27, known-values.json says 26
known-values: 21 values compared, 2 failures
```

**Revert.** Re-recorded from the derivations. Exit 0.

Run against its real path the gate skips loudly, because `tests/regression/known-values.json` does
not exist yet: P1 creates `tests/` from nothing and migrates 26 assertion sites across three files
(C-2, C-4). `KNOWN_VALUES` points it at a fixture so it could be demonstrated without writing into
P1's directory.

### Gate 4, again, on 2026-08-11 · the derivations that did not resolve

P1's file landed and the gate ran for real. It compared 16 of its 21 derivations and printed the
other five as a warning on every run: `ledger.kill_ids`, `theorems.total`,
`campaign.hypotheses.total`, `provenance.files`, `redirects.entries`. Four of the five were pinned
all along, under the generator that produced them, and the aliases now say so. The fifth is not
pinned and now says that too, by name.

**Defect, the ordinary arm.** Three newly-resolved pinned values perturbed at once: `K-forensic`
deleted from `build_data.kill_ids`, `port_docs.redirects` 117 → 116, and `T14` deleted from
`build_data.theorem_statuses`, that last one exercising the counting alias rather than a scalar.

```
FAIL ledger.kill_ids: derived ["K-avp","K-err","K-forensic","K-kui","K-meta","K-transfer","K-vce","K-verif"],
known-values.json says ["K-avp","K-err","K-kui","K-meta","K-transfer","K-vce","K-verif"] at build_data.kill_ids
FAIL redirects.entries: derived 117, known-values.json says 116 at port_docs.redirects
FAIL theorems.total: derived 14, known-values.json says 13 at entries of build_data.theorem_statuses
```

**Defect, the arm that did not exist before.** An unresolved derivation used to be a `console.warn`
and exit 0, which is how five of them sat unchecked in a green gate. Removing `build_data.kill_ids`
from the pinned file entirely:

```
FAIL ledger.kill_ids: this script derives it and .../tests/regression/known-values.json does not
pin it, under any alias. Add the value to the pinned file, or add ledger.kill_ids to UNPINNABLE
with the reason. A derivation compared against nothing is not a check.
```

**And the other direction.** `UNPINNABLE` names `provenance.files`; adding a `provenance.files`
entry to the pinned file makes the declaration stale, and a stale exemption fails rather than
lingering:

```
FAIL provenance.files is declared UNPINNABLE and it now resolves. The declaration is stale:
delete it. It said: 191, the length of src/data/provenance.json's copy manifest. ...
```

**Revert.** Restored the pinned file from HEAD each time.
`known-values: 20 of 21 derivations compared, 1 declared unpinnable, 0 unresolved, 0 failures`.

**One thing the counting alias does not see, recorded rather than glossed.** Renaming `T14` to
`T14X` in the pinned table leaves the count at 14 and this gate says nothing. That is correct for a
count and it is not a hole: `known-values.test.mjs` compares the whole table exactly against
`tests/regression/observed/build_data.json` and fails on the rename. The two checks are different
questions and the counting alias is only used where the pinned artifact is an enumeration.

**Why `provenance.files` cannot be pinned from here.** It derives cleanly, 191, the length of
`src/data/provenance.json`'s copy manifest. `known-values.json` is one half of a pair: the other is
`tests/regression/observed/<generator>.json`, which the generator writes, and
`known-values.test.mjs` asserts the two agree **in both directions** — a key here that no generator
recorded fails, and a key a generator recorded that nobody signed off on fails too. So the value
cannot be added to the pinned file alone, and typing it into the observed half would be the
generator confirming itself with an extra step, which is the exact defect D-08 moved these values
out of the generators to prevent. `scripts/build_data.py` records 41 measurements and none of them
is this one; it needs one line there, `measured.record("provenance_files", ...)`, plus a regenerated
observed file. That file is P1's. Until then the gate names the quantity and says out loud that it
is compared against nothing.

---

## Gate 5 · Provenance sweep

**Defect.** `<p>Recovery gap 0.418 on the canonical model.</p>` added to `/about/`, a route not on
the ratchet.

```
FAIL /about/: 1+ unbound numeric(s)
    0.418   in "Recovery gap 0.418 on the canonical model."
```

**Revert.** Removed the paragraph. Exit 0.

---

## Gate 6 · Terminology lock

**Defect.** `<p>There are sixteen reasons a reading can be refused.</p>` on `/about/`. This is C-10
exactly: the kernel page is one amendment behind, the enum has seventeen, and two library tests pin
it.

```
FAIL terminology lock: The refusal enum has seventeen members. The kernel page is one amendment
behind (E48 added QUANTITY_UNDEFINED after E30 added RECORD_INCOMPLETE), and two library tests pin
seventeen.
  canonical: seventeen reasons
  citation:  GROUND-TRUTH.md C-10; reading.py:33 and :62-95; test_w1_kernel.py:470
  /about/  "sixteen reasons"
```

**Revert.** Removed the paragraph. The gate still exits 1, on a pre-existing hit it found on its
first run: `/docs/contributing/` says "556 tests", and a test count is banned as a credibility
signal by GROUND-TRUTH §8. That is a real finding for P5, not a leftover from the demonstration.

---

## Gate 7 · Banned identifiers

**Defect.** `<p>See the ADJ-AVP card and work package W4.4.</p>` on `/about/`.

Run against a twelve-term fixture, because P1 generates the real ~620-term list from the registries
and this gate refuses to hand-write a substitute. Twelve terms were enough:

```
FAIL banned identifier "ADJ-AVP" on 5 route(s): /about/, /docs/caveats/, /evidence/a34457e8.../, /evidence/, /
FAIL banned identifier "T9" on 5 route(s): /docs/cli/, /docs/how-to/freeze-and-run-a-study/, /docs/sciences/, ...
FAIL banned identifier "CAL-TRANSFER" on 4 route(s): ...
FAIL banned identifier "S12" on 4 route(s): ...
FAIL banned identifier "TOPO-HODGE" on 4 route(s): ...
FAIL banned identifier "META-LEDGER" on 3 route(s): ...
FAIL banned identifier "H-avp" on 2 route(s): ...
FAIL banned identifier "K-avp" on 2 route(s): ...
FAIL banned identifier "W4.4" on 1 route(s): /about/
banned: 12 terms, 161 of 162 pages swept, 8 distinct terms found, 70 hits
```

**Revert.** Removed the paragraph. 69 hits remain, all pre-existing, from 12 of the roughly 620
terms. Against its real path the gate skips, because `src/data/banned-terms.json` does not exist.

### Gate 7, again, on 2026-08-11 · `R2` is two things

The generated list landed, 399 terms, and the gate flagged `R2` on `/see/run/`. It was right about
the string and wrong about the thing. `/see/run/` prints the run bundle's expected output verbatim,
and one of its rows is labelled `R2`:

```
                       this fit    frozen ledger
transition midpoint    106.9368    106.0000
10-to-90 width          23.9823     23.9000
R2                      0.99555     0.99600
```

That is R², ASCII-folded because the block is literal stdout. The registry's `R2` is one of the four
predictions R1 to R4. Taking `R2` off the generated list would stop the collision and let prediction
R2 onto every other page in the site, so the allowance is shaped instead: inside a `<pre>` or
`<code>`, at the start of its line, with a number next on that line. Both conditions, or it fails.

**Demonstration, the one the fix has to survive.** `<p>Prediction R2 was registered before the run
and refuted after it.</p>` planted in `dist/see/run/index.html`, the same page, alongside the table:

```
FAIL banned identifier "R2" on 1 route(s): /see/run/
banned: context allowance "R2 as a coefficient of determination, labelling a row of numbers"
covered 1 hit(s) on 1 route(s): /see/run/
```

Both lines are from the same run. The sentence fails and the table row is allowed, on one page, for
one string.

**Two adversarial shapes, because an allowance is only as good as what it refuses.**
`<pre><code>R2 was the registered prediction</code></pre>` (verbatim block, but next to a word) and
`<p>R2   0.99555 stated in running text.</p>` (row-shaped, but not verbatim). Both fail, and the
allowance's covered count stays at 1, so neither was absorbed.

**Revert.** Restored the built page. `banned: 399 terms, 152 of 208 pages swept, 75 distinct terms
found, 206 hits`, one hit fewer than before the fix and the same 206 the site had minus the
statistic. The other 206 are pre-existing and belong to the docs and log packets.

Seven cases are in `tests/regression/banned-gate.test.mjs` now, including `R1`, `R3` and `R4` given
the identical table treatment and still failing, because the allowance is per collision and not per
family.

### And the ledger the tests were overwriting

`recordVacuity` writes `reports/vacuous-gates.json`, keyed by gate number, beside the repository
rather than beside the dist that was scanned. This gate takes a dist as `argv[2]`, and its own
regression test runs it against a five-page temporary one. So `node --test
tests/regression/banned-gate.test.mjs` filed the fixture's numbers as the site's, and the entry
committed on `build/scene-core` read:

```
"7": { "reason": "2 of 5 pages were not swept ... /log/=1, /specs/=0, /demos/=0,
       /^\\/evidence\\/[0-9a-f]{32}\\/$/=1." }
```

Five pages. The site has 208. That is a measurement of a temporary directory sitting in the one file
this document tells a reader to check before believing a green run. Gate 7 now records only when it
swept the real `DIST`, and the entry reads `56 of 208`. **Every gate that accepts a dist argument
and calls `recordVacuity` has the same defect**; the general fix belongs in `_lib.mjs`, which is not
this packet's file.

### Gate 7, a third time, on 2026-08-11 · the docs corpus was two problems

Gate 7 stood at 75 distinct identifiers over 128 route-hits, effectively all under `/docs/`, and had
been written off for the whole build as vocabulary concentrated in the ported docs. Sorted by the
family `banned-terms.json` puts each identifier in, it is two problems that the aggregate hides:

| family | route-hits | what they are |
|---|---|---|
| instrument | 44 | reward_lens 3.0.0's published names |
| theorem | 36 | reward_lens 3.0.0's published names |
| science | 31 | reward_lens 3.0.0's published names |
| errata | 9 | unresolvable citations |
| campaign card | 5 | unresolvable citations |
| prediction | 3 | unresolvable citations |

**111 of them are the shipped library's own interface.** `studies/s06_topology/` is an import path.
`/docs/api/measure/` prints `A1 Knowledge-Utilization Index` beside the `KUI` class.
`/docs/instruments/heritability/` says `reward_lens.measure.indices.heritability is C2`. A reader
who cannot resolve `C2` cannot call the function, which is the opposite of D-05's complaint. The
allowance for them is **route-scoped and family-verified**: `/docs/` only, and only the `science`,
`theorem` and `instrument` families, read off the generated map rather than inferred from the shape
of the string.

**Demonstration 1, the one the ruling is.** The same sentence, two routes. Planted in
`dist/about/index.html`:

```
FAIL banned: 2 finding(s) not in the ratchet .../scripts/checks/ratchet-banned.txt.
FAIL banned identifier "C2" on 1 route(s): /about/
FAIL banned identifier "S6" on 1 route(s): /about/
banned: context allowance "reward_lens 3.0.0's published science, theorem and instrument codes,
under /docs/" covered 182 hit(s) on 26 route(s)
```

Exit 1. The identical `<p>Science S6 and instrument C2 named on a docs page.</p>` in
`dist/docs/caveats/index.html` instead:

```
banned: 399 terms, 152 of 208 pages swept, 8 distinct terms found, 14 hits
banned: context allowance "reward_lens 3.0.0's published science, theorem and instrument codes,
under /docs/" covered 184 hit(s) on 27 route(s)
```

Exit 0, and the covered count rises by exactly the two hits and the one route. On `/about/` it does
not move at all, so neither string was absorbed on the way to failing.

**Demonstration 2, which is why the allowance reads the family map and not the shape.** Three
identifiers planted under `/docs/caveats/`, the route that just passed:

```
FAIL banned identifier "E20" on 1 route(s): /docs/caveats/
FAIL banned identifier "E3" on 1 route(s): /docs/caveats/
FAIL banned identifier "META-LEDGER" on 1 route(s): /docs/caveats/
banned: context allowance "reward_lens 3.0.0's published science, theorem and instrument codes,
under /docs/" covered 182 hit(s) on 26 route(s)
```

Exit 1, and the covered count is unchanged at 182. `E20` is an erratum and `META-LEDGER` a campaign
card, and neither is published vocabulary. **`E3` is the case that decides the implementation**: it
is in the instrument family and the errata family at once, one of the six spellings D-05's opening
paragraph names as the collision. A regex over the shape, `/^[STEFACD]\d+$/` or anything like it,
permits all three, because `E20` and `E3` are spelled exactly like the E-series instruments. The map
is the authority, and where the map does not settle the question the ban stands.

**Demonstration 3, the allowance covering nothing.** Against a two-page dist with no `/docs/` on it:

```
NOTE banned: the context allowance "reward_lens 3.0.0's published science, theorem and instrument
codes, under /docs/" covered 0 hits on this run. Either the collision it was written for is gone,
or it stopped matching.
```

And with the `families` map deleted from the terms file, against the real dist:

```
NOTE banned: .../no-families.json carries no "families" map, so the /docs/ published-vocabulary
allowance is inert on this run and every identifier is held to the ban. The family map is that
allowance's only authority; there is nothing to verify a term against without it.
FAIL banned: 111 finding(s) not in the ratchet ...
banned: 399 terms, 152 of 208 pages swept, 70 distinct terms found, 196 hits
```

Exactly the 111 route-hits the allowance covers come back, which is the allowance measuring itself.
Losing the map fails closed and says why, twice.

### The 17 that were left, and the 9 that are not this repository's to fix

Eight were authored docs prose citing things a reader cannot look up, and they were rewritten into
what they refer to: five `E19` citations became the archived two-fine-tunes cosine measurement they
all point at, and two card codes in `/docs/caveats/` became link text that says where the link goes.
The ninth was a content defect as well: `/docs/sciences/` told a reader that S6's intransitivity
bound "has its first measurement", and that measurement is withdrawn.

**Nine are in the shipped library's own docstrings and no honest edit here removes them.**
`/docs/api/` is generated by `scripts/build_api_ref.py`, which runs griffe over the clean source and
renders docstrings verbatim, so `Per-axis reward signal-to-noise ratio (E16).` on `/docs/api/measure/`
is the first line of `PromptSNR.__doc__` and is what `help(PromptSNR)` prints for anyone who
installed the package. Editing the site's copy would make the reference disagree with the library
and the next generator run would revert it. C-10, which gates 5 and 9 both already carry at this
exact route: the site does not silently correct the prose of a page it ports.

They are still defects and the fix is a docstring change upstream, so they are a **ratchet** and not
a wider allowance. The difference is the whole point: an allowance permits the class forever and
would swallow the `(E20)` that the next release's docstrings introduce. `scripts/checks/ratchet-banned.txt`
holds nine lines, each naming the library file whose docstring owns the identifier.

**Demonstration 4, the ratchet in both directions.** One entry deleted and one invented entry added:

```
FAIL banned: 1 finding(s) not in the ratchet .../scripts/checks/ratchet-banned.txt.
  CLOSED  /docs/api/studies/ | E44   (recorded for qual/docs-vocab)
FAIL banned identifier "E16" on 1 route(s): /docs/api/measure/
banned: 9 hit(s) on the ratchet ..., 1 not on it
```

Exit 1. The deleted entry's hit fails again, so the nine are genuinely still in the output and the
ratchet is what holds them rather than an allowance that stopped looking. The invented entry prints
as `CLOSED`, which is how a line that has been fixed upstream announces that it can be deleted.

The comparison is skipped when the gate is pointed at a dist other than the canonical one, so the
five-page fixture in `tests/regression/banned-gate.test.mjs` is never measured against the site's
recorded debt. That is the same category error the vacuity note above records somebody making once
already.

**Gate 7 now exits 0**: 75 distinct terms and 128 route-hits become 0 unrecorded and 9 recorded.
Twenty cases in `tests/regression/banned-gate.test.mjs` fix the allowance's width.

---

## Gate 8 · Claims gate

**Defect.** Rewrote `53` to `54` throughout `site-claims.md`, which perturbs an evidence id as well
as the numbers.

```
[FAIL] ev:54fb272fd011c8ca07a4959f554341ab metrics.real_probe_balanced_acc: evidence id not in the store
[FAIL] ev:54fb272fd011c8ca07a4959f554341ab metrics.delta_r_per_steer: evidence id not in the store
```

**Revert.** `git checkout -- site-claims.md`. Exit 0.

The gate runs against `reward-lens==2.0.1`, pinned deliberately. It predates the work the site
describes and the pin moves as a reviewed change when 3.0.0 ships.

---

## Gate 9a · Copy bans, the parse arm

**Defect.** Reintroduced C-12's exact syntax error into `design/copy.yaml`: an unquoted scalar
containing a colon followed by a space.

```
FAIL copy.yaml does not parse. Gate 9 checks nothing until it does.
  .../design/copy.yaml
  Nested mappings are not allowed in compact mappings at line 16, column 11:

    broken: The site name. Decent, and v2-scoped: static model only.
            ^

copy.yaml is the single source of every string on the site. C-12 records two fatal syntax
errors that survived because everything that touched this file grepped it as text.
```

The gate stops there and checks nothing else, which is the order C-12 requires.

**Revert.** `git checkout -- design/copy.yaml`.

---

## Gate 9b · Copy bans, the em dash arm

**Defect.** `<p>The reading is bounded — and the bound is stated.</p>` on `/about/`.

```
FAIL em dash as prose punctuation in /about/   "The reading is bounded — and the bound is stated."
copy_grep: 162 pages scanned, 22 em dash(es) accepted as table null markers, 4 failures
```

The same run accepted **22** em dashes as null markers, so the exception is live and narrow at the
same time.

**One thing the exception's wording did not anticipate, recorded rather than worked around.**
`QA.md` §6.9 says the gate "skips cells whose entire content is the character". The accessible way
to write a null marker is

```html
<span aria-hidden="true">—</span><span class="visually-hidden">not measured</span>
```

so the cell's raw text is `— not measured`, and a literal reading of the rule rejects the correct
implementation and accepts only the inaccessible one. The first version of this gate did exactly
that: it reported all 22 genuine null markers in the component gallery as prose punctuation. The
visually-hidden span is the dash's accessible equivalent, not prose, so it is removed before the
test and whatever is left still has to be exactly the character. A cell with any other visible
content still fails.

**Revert.** Removed the paragraph. The gate still exits 1 on three pre-existing hits. See the
completion note: the ported library corpus uses "robust" in its technical sense three times, and
the declared adjudication covers only the exact phrase `the sign is robust`.

---

## Gate 10 · Links, internal

**Defect.** `<a href="/see/run/">the run</a>` on `/about/`, pointing at a route no packet has built.

```
FAIL broken internal ref /see/run/ (first seen in dist/404.html)
links: 162 pages scanned, 38 broken internal refs, 287 distinct external URLs
```

**Revert.** Removed the anchor. The gate still exits 1 on 38 broken internal refs, and the split
matters:

- **10 pre-existing.** `/see/`, `/see/run/`, `/see/reward-model/`, `/see/grader/`, `/start/`,
  `/limits/`, `/docs/api/`, `/docs/refusals/` and `/collaborate/` are linked from the navigation and
  the 404 page and are not built by any packet yet, plus one missing figure video on `/gallery/`.
- **28 introduced by the redirect mechanism** this packet added. `/campaign/<card>/` now redirects
  to `/log/cards/<card>/` for all 27 cards, and `/campaign/method/` to `/log/method/`, and P6 has
  not built those destinations. The redirects are correct and their targets do not exist yet.

---

## Gate 11 · Links, external

**Defect.** Changed the expected destination for `copy.yaml:urls.repo` to a repository that is not
the one the URL resolves to, so the URL returns 200 and lands somewhere other than expected. This
is C-5's shape exactly, and it is the case a status-only check cannot see.

```
FAIL copy.yaml:urls.repo  https://github.com/reward-lens/reward-lens
     status 200 but resolved to https://github.com/reward-lens/reward-lens
     expected              https://github.com/reward-lens/some-other-repository
```

**Revert.** `git checkout -- scripts/checks/external-expectations.json`.

**The gate still exits 1, on three things, and that is correct.** See the completion note for the
live status of all four published URLs, two of which have changed since C-5 was written.

---

## Gate 12 · Redirects

**Defect.** Overwrote `dist/campaign/chi-drift/index.html` with a page, which is exactly the
condition C-3 describes: the old path resolves, and it serves content instead of moving the reader.

```
FAIL /campaign/chi-drift/ resolves but is not a redirect. A page file is shadowing the redirect,
so the old URL serves stale content instead of moving the reader to /log/cards/chi-drift/.
```

**Revert.** Rebuilt. `30/30 old paths resolve as redirects to their stated destination`, exit 0.

The old check asserted that each **destination** exists, which is why 30 same-origin URLs about to
404 were invisible while it was green.

---

## Gate 13a · Metadata, the title arm

**Defect.** Stripped the `<title>` from `/about/`.

```
FAIL /about/: missing title
```

**Revert.** Rebuilt.

---

## Gate 13b · Metadata, the preview-text arm

**Defect.** Set `default.png`'s recorded text back to `The instrument for looking inside reward
models`, the headline the previous generator had been advertising for months and which the project
never adopted.

```
FAIL og/default.png: the image carries text its source no longer says.
      image:  "The instrument for looking inside reward models"
      source: "You wrote a reward function. Your policy optimized something else."  (design/copy.yaml:home.hero.headline_a + home.hero.headline_b)
      Re-run: node scripts/og_render.mjs
```

**Revert.** `node scripts/og_render.mjs`. Exit 0, 29 preview images whose text still matches its
source.

---

## Gate 13c · Metadata, the third-party arm

**Defect.** Added `<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js">` to
`/about/`. That is the CDN the library's own documentation build loads, so it is a realistic
mistake rather than an invented one (C-9).

```
FAIL third-party origin cdn.jsdelivr.net loaded as a sub-resource on 1 route(s): /about/.
D-21: the site loads nothing from a third party.
```

**Revert.** Removed the tag. Exit 0, zero third-party origins across 162 pages.

Only sub-resource loads count. An `<a href>` to GitHub is a link, not a request, and 741 of them are
fine.

---

## Gate 14 · Accessibility

**Defect.** A paragraph on `/about/` with `color:#4a4f4d` on `background:#3a3f3d`, which is about
1.2:1.

```
  NEW  dark  | /about/ | color-contrast | #main > p
  NEW  light | /about/ | color-contrast | #main > p

axe: 24 page scans across 12 route(s) in two themes, 9 serious or critical violation(s),
589 on the ratchet, 2 new
```

**Revert.** Removed the paragraph. Exit 0, 0 new.

The ratchet's other direction was demonstrated as part of gate 18, which empties it and watches all
589 recorded violations come back as `NEW`.

---

## Gate 15a · Token drift, the colour arm

**The gate did not fail on the first attempt, and the bug was real.**

**Defect.** Appended `const DEMO_COLOUR = "#E8A33D";` to `scripts/checks/gallery-absent.mjs`. That
is the v1 amber, a colour that is not in `tokens.css`.

**First run: exit 0.** `scripts/lint-tokens.mjs` walks files matching
`[".css", ".astro", ".tsx", ".ts", ".jsx", ".js", ".py"]`. **`.mjs` was not in the list**, and every
file under `scripts/` uses it. Gate 15 was reporting that it had scanned a tree it had not opened a
single file of.

**Fix.** Added `.mjs` to the extension list. The scan went from 80 files to 110. Two consequential
findings followed immediately:

- `src/components/base/base.test.mjs` was reported for a colour literal in
  `assert.ok(!/⚠|&#9888;/.test(card))`. `&#9888;` is the HTML entity for a warning triangle, in a
  test asserting that a refusal card does **not** contain one, and `#9888` is four hex digits. The
  colour rule now requires that the `#` is not preceded by `&`. An entity is never a colour.
- Rule 4 fired four times on `scripts/og_render.mjs`, which sets `font-size` in the inline CSS of a
  1200x630 social card. Rule 4 is scoped to `src/**` by D-28 and by the gate-15 brief, and the
  reason is the mechanism rather than the file count: type is applied by role class, and the role
  classes exist only in the site's own document. The OG card is rendered in a standalone Playwright
  document that loads no site stylesheet. Rule 4 is now scoped as written. Colour, duration and the
  `@media` rules are not scoped and do run there.

**Second run, with the fix:**

```
  NEW  scripts/checks/gallery-absent.mjs | rule 3 | const DEMO_COLOUR = "#E8A33D";

drift: 110 files scanned across src/, scripts/ and film/; 189 finding(s); 146 on the ratchet; 1 new
```

**Revert.** `git checkout -- scripts/checks/gallery-absent.mjs`. Exit 0, 0 new.

---

## Gate 15b · Token drift, the C-21 arm

**Defect.** Changed `nav-shell.astro:250` from `@media (max-width: 47.4375rem) /* --bp-md */` to
`/* --bp-lg */`. The comment still names a token, so the rule as F1 built it passes. The value is
now nothing like the token it names.

```
  NEW  src/components/nav-shell.astro | rule 6 | @media (max-width: 47.4375rem) /* --bp-lg */
```

with the message:

```
rule 6: @media length 47.4375rem does not equal --bp-lg (64rem) or 63.9375rem, its one-pixel-below
max-width companion. The comment labels the literal; it does not check it (C-21).
```

**Revert.** `git checkout -- src/components/nav-shell.astro`. Exit 0.

The correct value passes: `47.4375rem` is `--bp-md` (`47.5rem`) minus one pixel, which is the
ordinary `max-width` companion to a `min-width` query, and the rule accepts exactly that and nothing
looser.

---

## Gate 16 · Performance budgets

**Defect.** Added a 60,000-byte file to `dist/fonts/`, which is how a font regression actually
happens: somebody adds a face.

```
FAIL site fonts total 136,436 bytes over the 98,304 budget (§19)
```

**Revert.** Deleted it. Exit 0, `4 files, 76,436 bytes`, which reproduces C-14's corrected figure
exactly.

---

## Gate 17 · Frame budget

**Defect.** A scroll listener burning 400ms of main thread.

```
FAIL long task 402.0ms over the 50ms limit (self)
FAIL long task 73.0ms over the 50ms limit (self)
```

**Revert.** Removed the script.

**The first version of this gate measured the wrong quantity, and the demonstration is what showed
it.** It took the interval between `requestAnimationFrame` callbacks and compared it to the 16.6ms
budget. On a healthy 60Hz page the interval **is** the display cadence, 16.667ms, so the reverted
page still reported `p50 16.70ms, p95 17.30ms` and failed. Every page fails that check by
construction, including a perfect one.

The budget is 16.6ms of frame **work**, not frame interval. The gate now reads
`long-animation-frame`, which is the main thread's actual rendering work for the frame, and reports
the interval alongside without asserting on it except at the two-frame mark, where an interval that
high means frames are being dropped. Against the current homepage:

```
  frame work (long-animation-frame):  p50 3.20ms   p95 118.10ms   max 132.00ms   over 41 frames
  frame interval (display cadence):   p50 16.70ms  p95 17.30ms    max 17.90ms
FAIL p95 frame work 118.10ms over the 16.6ms budget at tier B
```

That failure is real and it is P3's and P4's: the v1 homepage does 118ms of main-thread work in its
95th-percentile animation frame under a 4x CPU throttle.

---

## Gate 18 · No-scene build

**Defect.** Moved `scripts/checks/ratchet-a11y.txt` aside, so gate 14 sees all 589 recorded
violations as new, inside the scene-disabled build.

```
gate 18: building with PUBLIC_SCENE=off into dist-noscene/
gate 18: the scene-disabled build, gate 14
  NEW  light | /docs/training-loops/tilt-susceptibility/ | color-contrast | .rl-chip--works > .rl-chip__k
axe: 264 page scans across 132 route(s) in two themes, 589 serious or critical violation(s),
0 on the ratchet, 589 new
```

**Revert.** Moved the ratchet back.

```
  LCP 1124ms (budget 2000ms, 4x CPU throttle, 1.6Mbps), CLS 0.0000 (budget 0.05)
budgets: 0 failures
gate 18: PUBLIC_SCENE=off passes gates 14 and 16
```

**`PUBLIC_SCENE=off` passes gates 14 and 16 today.** QA.md §2.4 item 3 is met, on the current build.

---

## Gate 19 · Responsive geometry

**Defect.** A `<div style="width:2400px">` on `/about/`.

```
FAIL /about/ at 320px (dark): scrollWidth 2400 > 320
     widest overflowing element: <div class=""> 2400px wide, right edge at 2400
     Usually min-width: auto on a flex or grid child, not a missing max-width. Wide content scrolls
     inside its own overflow-x: auto container.
overflow: 168 measurements (12 routes x 7 widths x 2 themes), 16 failures
```

**Revert.** Removed the div. 2 failures remain on the sampled routes, 154 over all 132.

The gate uses a real Playwright viewport, never `chrome --headless --window-size`, which does not
establish a mobile layout viewport and produces false clipping. That is HANDOFF trap 1 and it cost
three iterations during design.

---

## Gate 20 · Hero fidelity

The homepage has no fidelity landmarks yet, so the gate skips loudly. Demonstrated against a fixture
carrying an SVG room and a composed still whose landmarks disagree.

```
FAIL 390px: svg and still disagree on the beam axis by 378.0px (limit 8)
FAIL 390px: svg and still disagree on the prism centroid by 378.0px (limit 8)
FAIL 768px: svg and still disagree on the beam axis by 264.6px (limit 8)
...
```

**Revert.** Restored the built homepage:

```
SKIP gate 20: no fidelity on the homepage exposes composition landmarks. Absent: svg, still, scene.
Packet P3 builds the SVG room and packet S1 the scene and the stills (D-24).
The contract is in this file's header.
```

A third assertion was demonstrated implicitly: a fidelity that is present and exposes no landmarks
**fails** rather than being skipped, because that is the case where the gate would otherwise compare
two things and report three.

---

## Gate 21 · Hero luminance

Demonstrated against a fixture with a lit rectangle behind the headline zone and a white link
brighter than the install strip. Both arms fired:

```
FAIL dark 1440x900 progress 0.00: headline-zone mean linear luminance 0.5087 > 0.08.
     Move the light, do not add a scrim.
FAIL dark 1440x900 progress 0.00: headline-zone p95 pixel luminance 0.6606 > 0.16
FAIL dark 1440x900 progress 0.00: subhead-zone p95 pixel luminance 0.7220 > 0.16
```

and the brightness ranking, printed as numbers rather than a verdict:

```
dark 1440x900 brightness ranking, first viewport:
  0.8856  a.brightlink
  0.0197  install strip   <- the strip
FAIL dark 1440x900: the install strip is not the brightest element in the first viewport.
Brightest is a.brightlink at 0.8856 against the strip's 0.0197.
```

**Revert.** Restored the built homepage and the real zones path:

```
SKIP gate 21: src/components/home/hero-zones.json does not exist. Packet P3 owns the three
hero-zone rectangles; the scene's luminance clamp and this gate both consume them.
```

The third arm, C-15's, measures the install strip's border against the **rendered pixels**
immediately outside it at every sampled scroll position, and fails below 3:1. It could not be
demonstrated failing on a fixture without also demonstrating the trivial case, because the current
build has no room behind the strip: on flat `--ground` the border is 3.02 and holds. It is written
and it is live; it becomes checkable the moment P3's room lands, which is exactly when 3.02 stops
being the number at the strip's actual edge.

---

## Gate 22 · Figure data binding

**Defect.** A bar drawn 180px wide inside a 400px track, carrying `data-bound-value="0.62"`, so its
geometry says 45% and its binding says 62%.

```
FAIL /: component 1 draws 180.00px where its value 0.62 of 1 implies 248.00px.
Off by 68.00px, limit 1.
```

**Revert.** Restored the built homepage:

```
SKIP gate 22: no element on any built route carries data-bound-value. Packets P3 (the SVG room),
P4 (the three interactives) and P6 (the log figures) bind their figures to it.
```

---

## Gate 23 · Visual baseline

**Defect.** Froze a 48-image baseline over the sampled routes, then set `letter-spacing: 1.4px` on
`/about/`'s body.

```
FAIL /about/ at 390 (dark): 100.00% of pixels changed, limit 0.4%  (the page changed size: 390,1987 -> 390,2076)
FAIL /about/ at 1440 (dark): 100.00% of pixels changed, limit 0.4%  (the page changed size: 1440,1475 -> 1440,1505)
FAIL /about/ at 390 (light): 100.00% of pixels changed, limit 0.4%
FAIL /about/ at 1440 (light): 100.00% of pixels changed, limit 0.4%
```

**Revert.** Removed the style. `48 comparison(s), 0 failures`. Then the demonstration baseline was
deleted, because the real one is frozen after wave 1 merges: a baseline taken today would freeze
work in progress.

---

## Gate 24 · Film provenance

**The gate did not fail on the first attempt, and the bug was real.**

**Defect.** `film/manim/demo_scene.py` containing `BEAM = "#fcfaf4"`.

**First run: exit 0.** The colour arm stripped comments with
`line.split("#")[0]`. `#` opens a Python comment **and** opens a hex colour, so every hex literal in
a `.py` file was removed before the colour rule saw the line. On a gate whose entire first arm is
"no colour literal in `film/**`", and whose one existing file is Python, that is the gate not
working at all.

**Fix.** Strip `#` comments only when the `#` is not the start of a hex literal:
`line.replace(/(^|\s)#(?![0-9a-fA-F]{3,8}\b).*$/, "$1")`.

**Second run, with the fix:**

```
FAIL film/manim/demo_scene.py:1 colour literal in film/. Import it from film/manim/tokens.py.
```

**Revert.** Deleted the file. Exit 0.

The second arm, numbers in captions against the evidence store, ran clean throughout: 14 caption
numbers across 31 caption sources checked against 623 derived values. The gate is partially vacuous
until packet S2 lands a caption track; that is recorded in `reports/vacuous-gates.json`.

---

## Gate 25 · Public claims

Not demonstrated by P2, because it did not exist yet: it is the only numbered gate that reached the
integration branch without ever having been seen to fail. Run on 2026-08-11 against `dist/` built
from `a6f2281`, Node v20.19.5, 208 pages.

**It is not vacuous.** All ten conditions compare something, and the gate already fails a condition
whose count is zero, which is the lesson of gate 4 built in from the start:

```
claims  1:    142 rendered claim slugs resolved
claims  2:    129 generated claims validated
claims  3:     14 numbers displayed inside a claim, checked against it
claims  4:     68 values compared against their source plate
claims  5:    132 signs and units compared against their source
claims  6:    189 outcome words compared against the store
claims  7:    142 public disclosures swept for internal identifiers
claims  8:      4 version and install statements checked
claims  9:    358 pages swept for a retired public value
claims 10:      3 declared retirements checked against the generated set
```

**One of those counts is covering for an arm that is 98.6% blind, and that is this packet's
headline finding.** It is written up in full under
[condition 4](#gate-25-condition-4--the-arm-that-reads-dist-covers-2-of-139-values) below.

**Defect, condition 1.** `data-claim="measured-chi-drift-a-claim-nobody-wrote"` on
`/log/cards/chi-drift/`.

```
FAIL claims 1: /log/cards/chi-drift/ renders claim "measured-chi-drift-a-claim-nobody-wrote",
which does not resolve against src/data/claims/ (129 claims). A claim slug that does not resolve
is a statement with no source.
```

**Defect, condition 6.** The same card's `data-claim-status="supported"` changed to `"refuted"`.
That is C-43's shape: the outcome word and the record it came from disagree, and both look correct
alone.

```
FAIL claims 6: /log/cards/chi-drift/ renders measured-chi-drift-chi-bon-spearman with status
"refuted" and the claim states "supported".
```

**Defect, condition 4.** On `/log/cards/fact-kui/`, `data-claim-value` moved from
`0.15152288168283162` to `0.25152288168283162`.

```
FAIL claims 4: /log/cards/fact-kui/ renders measured-fact-kui-kui-gap as "0.25152288168283162"
and the claim states "0.15152288168283162". The value in prose and the value in its claim disagree.
```

**Defect, condition 7.** ` Card ADJ-AVP.` appended to the text of a rendered disclosure span.

```
FAIL claims 7: /log/cards/fact-kui/ shows the internal identifier "ADJ-AVP" in a normal public
disclosure for measured-fact-kui-kui-gap-fleet-median. D-05: a stranger meets a finding before an
identifier.
```

**Revert.** Restored the three built pages from copies taken before the plants.
`claims: 208 pages, 142 claim instances rendered, 142 public disclosures swept, 0 retired value(s)
deferred, 0 failures.`

### Gate 25, condition 4 · the arm that reads dist/ covers 2 of 139 values

Condition 4 has two arms. One compares each generated claim against its source plate; that is where
all **68** of the printed comparisons come from. The other is the one the condition is named for,
"the value in prose equals the value in its figure and in its source plate", and it reads built
HTML. It pairs a claim with a value like this:

```js
const CLAIM_VALUE_ATTR = /data-claim="([^"]*)"[\s\S]{0,400}?data-claim-value="([^"]*)"/g;
```

The site's provenance chip puts `data-claim` on the wrapping `<span class="prov">` and
`data-claim-value` on the `<button>` inside it, and between them sit the button's `id`,
`aria-expanded`, `aria-describedby` and `aria-label`. Measured over the whole build:

```
data-claim-value attributes in dist: 139
chars from the end of the nearest preceding data-claim= to it: min 396  median 461  max 514
inside the gate's 400-char window: 2 of 139
pages forming at least one pair: /log/cards/fact-kui/, /log/cards/meta-ledger/
```

**Two.** The window is 400 and the real distance is never below 396, so the arm catches the two
pages whose `aria-label` happens to be shortest and nothing else. The demonstration above is the
proof it is live at all, and it had to be staged on one of those two pages; the same perturbation on
`/log/cards/chi-drift/` produces no failure, which is how this was found.

Nothing about the summary line says so. It prints `claims 4: 68`, the other arm's number, so an arm
covering 1.4% of the site is invisible behind a healthy count. This is the same defect as gate 4's
"0 values compared", one level down: **a count that aggregates two arms cannot show that one of them
is empty.**

Not fixed here. `scripts/checks/claims-public.mjs` is not this packet's file, and the fix is a
judgment its owner should make rather than a widened constant: pairing the two attributes by element
rather than by character distance is the durable version, `textNodes()` already carries the ancestor
chain that would do it, and counting the two arms separately is what would have made this visible
without anybody measuring.

---

## Assertion + · No local path ships

Never demonstrated, and it is in `npm run check` rather than in `deploy.yml`, so nothing in CI runs
it. Run on 2026-08-11, 655 files: 242 under `src/data/` and 413 under `dist/`.

**Defect.** One paragraph on `/about/` in built output carrying all three banned shapes, the first
of them the string this assertion's own header records having shipped into three grader cards:

```html
<p>Rendered from /home/suhail-nadaf/final-reward/assay-recon/frameworks/swebench/harness.py,
see file:///srv/build/report.html, built in .claude/worktrees/gates.</p>
```

```
paths: 3 local path(s) in generated or built output

  dist/about/index.html:32  /home/suhail-nadaf/
      home directory path: names a person and a directory layout no reader has
  dist/about/index.html:32  file://
      file:// URL: resolves only on the machine that built the site
  dist/about/index.html:32  .claude/worktrees/gates.
      worktree path: ships the name of a local build branch

These are generated files. Fix the generator, never the JSON: add a rule to
scripts/pubpath.py saying what the public form of this path is, then regenerate.
```

All three rules fire independently and each names its own reason. **Revert.** Restored the page.
`paths: no local paths in 655 file(s) across src/data and dist`, exit 0.

**Not vacuous, and its one soft edge is visible rather than silent.** `dist/` is skipped when
absent, which is what lets it run before a build as well as after, and the summary line names the
roots it actually read, so a run that covered only `src/data` says `across src/data` and not
`across src/data and dist`. The skip itself is only printed under `--verbose`; the summary line is
the thing that gives it away.

---

## What the demonstrations cost and what they bought

Twenty-six demonstrations. **Two gates were broken and passing**, and both were broken in the same
way: a scan that reported having covered a tree it had not read. Gate 15 was skipping every `.mjs`
file in `scripts/`, and gate 24 was deleting every hex colour in a `.py` file before looking for hex
colours. Neither would have been found by reading the code, because both read correctly. Both were
found in under a minute by introducing the defect the gate exists to catch.

A third, gate 17, was measuring the wrong quantity and failing every page including a correct one,
which is the other way a gate becomes useless: not by never firing, but by always firing.

## The 2026-08-11 pass, and the fourth shape

Two more gates had never been seen to fail, and one assertion. Gate 25 fires on four of its ten
conditions and gate 4 now fires on four arms including two that did not exist this morning. Nothing
was found broken outright.

**But condition 4 of gate 25 is the fourth shape, and it is the worst of the four so far.** Gate 15
scanned no files. Gate 24 deleted what it was looking for. Gate 17 always fired. Condition 4 does
none of those: it works, it fires, its count is 68, and the arm that reads built HTML covers **2 of
139** rendered values because a character-distance heuristic is 400 and the real distance is never
below 396. The count that would have exposed it is aggregated with a healthy sibling arm, so there
is nothing to notice.

The rule that follows: **count each arm separately, or the count is not evidence.** A gate whose
summary line adds two arms together can have an empty one and still read as a working gate, and no
amount of staring at the number will show it. The way this was found was the way all four were
found: introduce the defect, and watch which page fails.

## Demonstration 27, and the fifth shape: a gate a formatter had been hiding a route from

**Gate 9** (`claims-public.mjs`, retired public values) fires on `\b0\.256\b` outside its allowed
routes. It has been green for the entire build. It should not have been.

`/see/reward-model/` renders the correction trail: the correlation this project published, the value
that superseded it, and the recomputation from the fixture. So it renders `0.256`, on a route that
was not in `allowedRoutes`, and the gate said nothing for the whole build.

The reason is not in the gate. The page ran both quoted correlations through `rho()`, which pads to
six decimal places, so what reached the HTML was `-0.256000`. **`\b0\.256\b` does not match inside
`-0.256000`**, because `6` is a word character and the trailing boundary never occurs. The gate was
green because the number was being printed with three digits of precision the source document never
claimed. Correcting the precision — `BUILD_NOTES.md:44` writes `-0.256`, and rendering it as
`-0.256000` invents digits beside a citation to the line that lacks them — is what made the route
visible.

The route is then legitimate on the merits, and the rule's own `why` already said so: the value "may
appear where the correction is the subject and nowhere else". That block is captioned "the published
correlation, and the correction to it", states in prose that the project corrected itself against its
own fixtures, and labels the number "published, then deprecated" in a table beside its successor,
each row carrying its own citation. It is the strongest corrected context on the site. So
`/see/reward-model/` was added to `allowedRoutes` with that reasoning recorded in the data file, and
the note about the formatter recorded beside it.

**Demonstrated failing** by planting `The rank correlation is 0.256 on this bank.` into
`dist/limits/index.html`, a route with no allowance:

```
FAIL claims 9: /limits/ renders the retired value "0.256" (deprecated-cost). ...
  Allowed only under /log/, /see/reward-model/.
claims: 208 pages, 142 claim instances rendered, 142 public disclosures swept, 1 failures.
```

Reverted; back to `0 failures`.

**The fifth shape.** The four before it were properties of the gate: it scanned nothing, it deleted
what it sought, it always fired, its count aggregated an empty arm. This one is a property of the
*rendering*. The gate was correct, its pattern was correct, its allowance list was correct given what
it could see — and a formatting decision three files away meant the thing it was looking for was
never spelled the way it was looking for it. Nothing in the gate, the data file or the output could
have revealed that; the only evidence was a number on a page with more digits than its source.

The rule that follows: **a pattern anchored on word boundaries is only as good as the formatting it
meets.** When a gate matches a literal value, something must also check that the value is rendered
the way the source states it, or the gate is testing the formatter rather than the content.

## Demonstration 28: the fourth shape, measured and repaired

The entry above reported condition 4 of gate 25 as covering "2 of 139". That was generous. Measured
directly over the build, the distance from a `data-claim-value` back to its owning `data-claim` is
**never below 438** — median 514, maximum 582, across all 139. The window was 400. It paired
**zero**.

The two attributes were never on the same element. `data-claim` is on the wrapping
`<span class="prov">`; `data-claim-value` is on the `<button class="prov__trigger">` inside it, and
between them the chip writes an `id`, an `aria-expanded`, an `aria-describedby` and an `aria-label`
that restates the value, its subject and its trust level. Pairing them by character distance was
guessing how much markup fits between two things, and the guess was wrong from the first render.

Two checks were dead, not one. The value-against-claim comparison, and the cross-route consistency
check that fails when one claim renders as two different numbers — both read the same pairing, so
both compared nothing while the gate printed a healthy total.

**Repaired structurally.** A `data-claim-value` belongs to the nearest preceding `data-claim` unless
that element already closed, which a `</span>` between them proves. Containment is the relationship
that actually holds and it does not care how long the ARIA gets. Pairing went **0 → 139 of 139**,
and every one of the 139 agrees with its claim, so nothing was hidden behind the dead check.

**Demonstrated failing**, both arms, by planting `data-claim-value="-0.42"` on `/log/`:

```
FAIL claims 4: /log/ renders measured-err-rb2-err-auroc-delta-qwen8b as "-0.42" and the
  claim states "-0.0009738428193937221". The value in prose and the value in its claim disagree.
FAIL claims 4: measured-err-rb2-err-auroc-delta-qwen8b renders as more than one value across
  the site: "-0.0009738428193937221" on /log/, /log/cards/err-rb2/ and "-0.42" on /log/.
```

**And the guard demonstrated against the original bug.** Condition 4's rendered arm now states its
own count instead of only feeding a total, and fails when that count is zero while
`data-claim-value` attributes exist. Reintroducing the 400-character window:

```
claims 4: 0 rendered value(s) paired to an owning claim, of 139 data-claim-value attribute(s).
FAIL claims 4: ... paired NONE of them ... An arm at zero is an absent check, not a passing one.
exit 1
```

Restored: `139 of 139`, exit 0.

That is the rule from the previous entry turned into code. **Count each arm separately, and make an
empty arm fail.** Had that guard existed when condition 4 was written, the defect would have been
caught by its first run instead of surviving the entire build behind a sibling's number.

## Demonstration 29, and the sixth shape: a gate reading input that was never on the page

**Gate 5** (`provenance.mjs`) reported three unbound numerals on `/start/`, and no reader can see any
of them. The context it printed for all three ended in a bare `if"`, which is what sent someone
looking.

`/start/` renders a copy-to-clipboard button whose `data-code` attribute holds the example grader:

```
<button ... data-code="def grade(answer: str, gold: str) -> float:
```

`textNodes` in `_lib.mjs` scanned attributes as `[^>]*?`, which ends a tag at the **first `>` in the
source**, including one inside a quoted value. Python's `->` closed the tag thirty characters in, and
the whole function body after it was emitted as a text node. Gate 5 then tokenised `1.0`, `0.5` and
`0.0` out of a clipboard attribute and failed the build on them. The trailing `if"` was the
attribute's own closing quote, arriving in the text stream with everything else.

**Demonstrated** by restoring the old attribute scan in `_lib.mjs` and re-running:

```
FAIL /start/: 3+ unbound numeric(s)
    1.0   in "float:
    """One point for an answer that matches the gold answer once trimmed."""
    if"
    0.5   in "float:
    """One point for an answer that matches the gold answer once trimmed."""
    if"
    0.0   in "float:
    """One point for an answer that matches the gold answer once trimmed."""
    if"

provenance: 208 pages. 2419 numeric(s) bound to a provenance chip, 727 matched a permanent pattern,
144 matched a context allowance, 367 ported from the library's own reference, 1427 absorbed by the
route ratchet, 3 unbound and failing.
```

Restored; back to `0 unbound and failing`.

Measured before changing anything, by running both tokenisers over all 208 built pages and diffing
the text streams: **one page changes, one phantom node disappears, and no node appears anywhere**.
That is the whole blast radius, and it is why the fix could be made without re-litigating any other
gate's numbers.

**The sixth shape.** The five before it were ways a gate could fail to see what is there: it scanned
nothing, it deleted what it sought, it always fired, it aggregated an empty arm, or the thing it
sought was spelled differently than it looked for. This one is the mirror image: the gate saw
something that **was never on the page**. Its three failures were real failures of a real check
against input that no reader, no screen reader and no printer would ever receive.

It matters more than three numerals because `textNodes` is what **every gate in this directory**
reads through. Any banned identifier, claim value or vocabulary term that happened to sit after a `>`
inside an attribute was being judged on all of them at once, and the only reason the damage was three
numerals today is that exactly one page in the build currently puts a raw `>` inside an attribute
value.

The rule that follows: **a gate's own input needs a test, not just its logic.** Every check here
trusts one forty-line function to say what the page says, and nothing was comparing that function's
output to the page.

## Demonstration 30: six context allowances, each shown permitting and refusing the same digits

Gate 5's `patterns` match a token and nothing else, which is right for a four-digit year and wrong
for a version: `^3\.0$` would exempt a measured 3.0 anywhere on the site forever. Six allowances now
carry a `permits()` predicate over the surrounding text, the ancestor chain and the route, the shape
gate 7 already uses.

**Permitting**, printed on every run, per allowance rather than as a total:

```
provenance: context allowance "a published release version, verified against src/data/release.json" covered 95 numeral(s) on 91 route(s)
provenance: context allowance "the minimum Python version, named by the word Python" covered 8 numeral(s) on 6 route(s)
provenance: context allowance "a figure or section label, which is an ordinal and not a reading" covered 14 numeral(s) on 8 route(s)
provenance: context allowance "an arXiv identifier inside a link to arxiv.org" covered 1 numeral(s) on 1 route(s)
provenance: context allowance "a definitional baseline in a data table's reference row" covered 1 numeral(s) on 1 route(s)
provenance: context allowance "prose ported verbatim from the library's quantity registry, on /collaborate/" covered 25 numeral(s) on 1 route(s)
```

**Refusing.** Six measurements were planted into `dist/`, one of the shape of each allowance, plus a
paired positive control carrying the **same digits** as the first:

```
FAIL /collaborate/: 1+ unbound numeric(s)
    0.9137   in "PLANTED, prose the registry does not contain: the instrument reports 0.9137 across eleven "
FAIL /limits/: 5+ unbound numeric(s)
    3.10   in "PLANTED PAIR ONE, a measurement: the ratio is 3.10 on this bank."
    3.0   in "PLANTED, a measurement shaped like a version: the gauge reads 3.0 at the second threshold."
    3.2   in "PLANTED, a measurement shaped like a figure label: the response rose 3.2 points."
    2604.26130   in "PLANTED, a measurement shaped like an arXiv id: the index is 2604.26130 across the fleet."
    0.5   in "PLANTED, a baseline outside a reference row: chance-adjusted agreement is 0.5 here."

provenance: ... 145 matched a context allowance, ... 6 unbound and failing.
```

The pair is the demonstration. `Python 3.10 or newer.` was planted on the same page and **permitted**,
which is why the Python allowance reads 9 rather than 8 on that run and lists `/limits/` among its
routes. `the ratio is 3.10 on this bank.` was **refused**. Identical digits, opposite verdicts, and
the only difference is the word before them.

Planted, run, reverted; back to `0 unbound and failing`.

**Two of the six do not trust the page at all.** The release allowance checks the dotted run against
`src/data/release.json`, so `3.0` fails even beside the word release, because no release is named
that. The registry allowance requires the rendered text node to actually occur in the generated
quantity and instrument catalogue, so a sentence typed into `/collaborate/` fails on `/collaborate/`.
Their authority is a file the build wrote, not a shape someone typed, and each prints a NOTE if that
file ever comes back empty.

## Demonstration 31: the zero-coverage NOTE on all six

Demonstration 28's rule was to count each arm separately and make an empty one visible. Gate 5 takes
a dist as `argv[2]`, so a one-page fixture with no version, figure, preprint, table or registry
prose in it exercises every allowance at zero:

```
NOTE provenance: the context allowance "a published release version, verified against src/data/release.json" covered 0 numerals on this run. Either the collision it was written for is gone, or it stopped matching.
NOTE provenance: the context allowance "the minimum Python version, named by the word Python" covered 0 numerals on this run. Either the collision it was written for is gone, or it stopped matching.
NOTE provenance: the context allowance "a figure or section label, which is an ordinal and not a reading" covered 0 numerals on this run. Either the collision it was written for is gone, or it stopped matching.
NOTE provenance: the context allowance "an arXiv identifier inside a link to arxiv.org" covered 0 numerals on this run. Either the collision it was written for is gone, or it stopped matching.
NOTE provenance: the context allowance "a definitional baseline in a data table's reference row" covered 0 numerals on this run. Either the collision it was written for is gone, or it stopped matching.
NOTE provenance: the context allowance "prose ported verbatim from the library's quantity registry, on /collaborate/" covered 0 numerals on this run. Either the collision it was written for is gone, or it stopped matching.
```

The fixture dist has no ratcheted route, so `recordVacuity` does not fire and the site's ledger is
not overwritten by a fixture's numbers, which is the trap recorded at the foot of `banned.mjs`.

## Demonstration 32: /limits/ was passing on the size of its numbers

Eight numerals on `/limits/` were unbound. The rest of the page was passing for a reason worth
stating: **a bare single digit matches a permanent pattern**, so a table of counts was escaping the
sweep by being small. Twelve of the fourteen area rows are single digits. That is not the sweep
working.

Every count on the page now cites `src/data/atlas.json` through `act-source`, at D-35's weaker grade
and for D-35's stated reason: these are counts of a registry rather than readings of a run, the
archive holds no evidence record for "how many instruments exist", and no `ev:` id was minted.

**Demonstrated failing** by stripping the citation off one bound value in `dist/`, which returns it
to exactly what it was before this packet:

```
FAIL /limits/: 1+ unbound numeric(s)
    86   in "86"
```

Reverted; back to `0 unbound and failing`.

All 37 cells are bound, not only the four that were failing. A column where `10` carries a citation
and `9` does not reads as though the `9` were sourced differently, and `/see/reward-model/` already
ships 307 such citations, so this is the site's convention rather than a new weight.

**What moved, and it should be read as a correction rather than progress.** The allowances sit with
`patterns`, before the route ratchet, because both answer "this is not a claim about the world" and
the ratchet answers "nobody has bound this yet". 101 version strings and figure labels on ratcheted
routes therefore left the deferred count: **1528 to 1427**. Those numerals were never claims, and
counting them as debt overstated what P5 and P6 still owe. Nothing on a ratcheted route was bound,
exempted wholesale or otherwise touched.
