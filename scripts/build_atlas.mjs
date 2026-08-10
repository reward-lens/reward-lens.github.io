/**
 * build_atlas · the public-vocabulary layer over the registry and the archive.
 *
 *   node scripts/build_atlas.mjs           write src/data/atlas.json
 *   node scripts/build_atlas.mjs --check   fail if what is on disk is not what
 *                                          this script would write today
 *
 * WHY THIS EXISTS AT ALL.
 *
 * Two generated files reach /atlas/. `catalogue.json` is the library's own
 * instrument registry, and `fleet/*.json` is a per-subject card built from the
 * v2 campaign's evidence store. Both are faithful to their sources and both
 * carry strings the site may not render: the registry has two series titles and
 * two instrument names that trip the terminology lock, and the fleet cards are
 * keyed by store observables, which is where 1,231 of the site's machine
 * identifiers came from.
 *
 * The repair belongs here rather than in the markup. A page that rewrites a
 * string on the way to the DOM has hidden the rewrite; a generator that emits
 * the substitution as data can publish it, and the page does.
 *
 * WHAT THIS SCRIPT WILL NOT DO.
 *
 * It does not invent a name for a record the store did not name. 1,092 of the
 * 1,231 fleet records have no `name` field, 968 of them ScoreBanks, and the
 * honest rendering of those is a count by payload kind and not a humanised
 * spelling of their key. Turning `campaign.w_r` into "w r" would pass the gate
 * and tell a reader nothing, which is the failure the gate is a proxy for.
 *
 * It does not read the campaign store. `scripts/build_data.py` does that, once,
 * under the assay venv, and commits the result. This script reads only files
 * already in `src/data/`, so it runs anywhere with node and nothing else.
 *
 * THE SELF-CHECK. Everything this script emits as a rendered string is run
 * against the forbidden rules in `scripts/checks/terms.json` before it is
 * written. A generator that emits a banned string and leaves the gate to catch
 * it three steps later has moved the failure away from its cause. Constrained
 * rules are NOT checked here: they are satisfied by the context a page puts
 * around the string, which is a property of the page and not of the data.
 * Demonstrated failing in tests/regression/atlas-data.test.mjs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "src", "data");
const OUT = join(DATA, "atlas.json");

const read = (p) => JSON.parse(readFileSync(p, "utf-8"));

// ---------------------------------------------------------------------------
// The substitutions, and why each one is not an invention
// ---------------------------------------------------------------------------
//
// Four registry strings trip the terminology lock. Each is replaced by the
// canonical form the lock itself carries in `scripts/checks/terms.json`, or by
// the registry's own word for the thing, and never by a phrase written here for
// the occasion. `rule` names the lock rule; `source` names where the
// replacement word comes from. Both travel into atlas.json and both are
// rendered on the page, so the reader sees that a name was changed, sees the
// registry's own name, and can check the package.
//
// These are candidates for `copy.yaml`, and the packet log names the keys. They
// are here rather than there because `design/copy.yaml` is reserved, and a
// registry string with no key behind it is exactly the case the page file has
// to handle anyway: the registry can add a name tomorrow.
const SUBSTITUTIONS = [
  {
    scope: "series",
    key: "A",
    field: "title",
    from: "Signal metrology: the grader as a measurement device",
    to: "Signal validity: the grader as a measurement device",
    rule: "metrology",
    source: "terms.json rule `metrology`, canonical form, first half; the second half is `calibration`, which is itself a constrained word and would trade one rule for another",
  },
  {
    scope: "series",
    key: "L",
    field: "title",
    from: "Reference materials and label metrology",
    to: "Reference materials and label validity",
    rule: "metrology",
    source: "terms.json rule `metrology`, canonical form, first half; the second half is `calibration`, which is itself a constrained word and would trade one rule for another",
  },
  {
    scope: "instrument",
    key: "J6",
    field: "name",
    from: "The forecast calibration ledger",
    to: "The forecast calibration record, scored against the library's own forecasts",
    rule: "ledger",
    source:
      "terms.json rule `ledger`, canonical form; the qualifier is the registry's own headline for J6",
  },
  {
    scope: "instrument",
    key: "M11",
    field: "name",
    from: "Rung disagreement, published",
    to: "Estimator disagreement, published",
    rule: "trust-rung",
    source: "catalogue.json, the registry's own word for a step of a ladder is `estimator`",
  },
  {
    scope: "area",
    key: "Ground truth and calibration",
    field: "name",
    from: "Ground truth and calibration",
    to: "Reference materials and calibration",
    rule: "ground-truth-from-a-grader",
    source:
      "the registry's own series L is `Reference materials and label metrology`; `reference material` is what the constrained calibration rule asks to be named, and it is what this area's own instruments are",
  },
  // The three archive card titles the explorer may not print as written. The
  // record page keeps every one of them whole, because D-40 allows the store's
  // own words there and the record is the route a reader reaches by having
  // already followed a number down from a finding. The INDEX is a browsable
  // surface, and D-40's correction of 2026-08-08 is explicit that it inherits
  // no exemption by proximity.
  //
  // Every replacement word is taken from the same card's own fields, not
  // written for the occasion, and `source` says which field.
  {
    scope: "card",
    key: "adj-avp",
    field: "title",
    from: "Attribution versus patching, adjudicated against planted ground truth",
    to: "Attribution versus patching, resolved against planted ground truth",
    rule: "adjudicated",
    source: "terms.json rule `adjudicated`, canonical form, first word; the card's own verdict is refuted, which is one of the four",
  },
  {
    scope: "card",
    key: "cal-transfer",
    field: "title",
    from: "Instrument calibration transfers from CPU toy trunks to a real 0.6B trunk",
    to: "Instrument calibration transfers from a CPU organism to a real 0.6B trunk",
    rule: "calibrated-without-a-regime",
    source:
      "the card's own hypothesis statement, which reads `the CPU-organism AUCs`; the regime is what the constrained rule asks to be named and the card names it",
  },
  {
    scope: "card",
    key: "meta-ledger",
    field: "title",
    from: "The campaign scores its own calibration",
    to: "The v2 campaign scores its own calibration against a coin",
    rule: "campaign-prose",
    source:
      "terms.json rule `campaign-prose` allows `v2 campaign`; `against a coin` is the card's own hypothesis statement, `beat a coin`, and it is also what the constrained calibration rule asks for",
  },
  {
    scope: "instrument",
    key: "M11",
    field: "headline",
    from: "When two rungs of the same ladder disagree on the same data, that difference is the cheap method's transfer uncertainty. It becomes a `Transfer` row and it composes into the calibration chain. Nobody publishes this.",
    to: "When two estimators of the same quantity disagree on the same data, that difference is the cheap method's transfer uncertainty. It becomes a `Transfer` row and it composes into the calibration chain, measured against the same corpus. Nobody publishes this.",
    rule: "trust-rung",
    source: "catalogue.json, the registry's own word for a step of a ladder is `estimator`",
  },
];

/** Applied by exact match. A registry string that has drifted fails loudly. */
function substitute(scope, key, field, value, applied) {
  const rule = SUBSTITUTIONS.find(
    (s) => s.scope === scope && s.key === key && s.field === field,
  );
  if (!rule) return { value, substituted: null };
  if (rule.from !== value) {
    throw new Error(
      `build_atlas: the substitution for ${scope} ${key}.${field} no longer ` +
        `matches the registry.\n  expected: ${JSON.stringify(rule.from)}\n  ` +
        `found:    ${JSON.stringify(value)}\nThe registry string changed. ` +
        `Re-read it, decide whether it still trips terms.json rule ` +
        `"${rule.rule}", and update or delete the entry. This does not fall ` +
        `back to the registry string: a silent fallback is how a banned name ` +
        `returns to a public page without anybody editing a page.`,
    );
  }
  applied.add(`${scope}:${key}:${field}`);
  return { value: rule.to, substituted: rule };
}

// ---------------------------------------------------------------------------
// Access, normalised
// ---------------------------------------------------------------------------
//
// `accessMin` is 73 free-text variants across 95 instruments and three of them
// quote instrument identifiers D-05 bans, so the raw string is not renderable
// and not filterable. The channel tokens in it are: they are a closed
// vocabulary the registry writes in capitals, they are what a reader actually
// has or does not have, and they are extracted rather than transcribed.
//
// An instrument whose accessMin names no channel gets an empty list. It is not
// given a bucket of its own, because "unstated" is a label and there is no key
// for one; it simply matches no access filter, and the full list is the
// default view.
const CHANNEL = /\b([A-Z][A-Z_]{2,})\b/g;
// The capitalised words in accessMin that are not access channels.
const NOT_A_CHANNEL = new Set(["AISI", "PRM", "KL_"]);

function accessChannels(accessMin) {
  if (!accessMin) return [];
  const out = new Set();
  for (const m of accessMin.matchAll(CHANNEL)) {
    const token = m[1].replace(/_$/, "");
    if (NOT_A_CHANNEL.has(m[1]) || NOT_A_CHANNEL.has(token)) continue;
    out.add(token);
  }
  return [...out].sort();
}

/**
 * The first ladder step that states a cost, or null. Mostly null.
 *
 * A cost is free text and three of them are written in terms of another
 * instrument: "none beyond N1's n grader calls", "none beyond A2's crossed
 * design". `N1` and `A2` are instrument identifiers D-05 bans, and rendering
 * them put two of them on /atlas/ the first time this column was built. A cost
 * that names an identifier is dropped rather than edited: rewriting somebody's
 * cost estimate is a claim about the cost, and dropping it is not.
 */
function firstCost(ladder) {
  for (const step of ladder ?? []) {
    if (typeof step.cost !== "string" || !step.cost.trim()) continue;
    const cost = step.cost.trim();
    if (carriesAnIdentifier(cost)) return null;
    return cost;
  }
  return null;
}

/** The family a quantity belongs to: `grader.effective_group_size` -> `grader`. */
const family = (quantity) => String(quantity).split(".")[0];

// ---------------------------------------------------------------------------
// Names the store wrote that the atlas still may not render
// ---------------------------------------------------------------------------
//
// The store named 139 of its 1,231 records and some of those names are built
// out of the campaign's own card identifiers: "cal-transfer organism cpu
// rho=0.60", "emb-lora step 1332 loadings", "adjavp organism". D-05 bans those
// families from rendered HTML outside /log/, and D-40 refused the atlas the
// record's allowance on the grounds that a catalogue is exactly where the ban
// does its work.
//
// Gate 7 would not catch these, because its match is case-sensitive and the
// store writes them in lower case. Passing a gate on the case of a letter is
// not the same as obeying the decision the gate implements, so this is checked
// case-insensitively here and the name is withheld rather than rendered.
//
// A withheld name is COUNTED and the count reaches the page. A record whose
// name cannot be shown still exists, and a summary that quietly lost it would
// be the archive editing itself.
const BANNED = (() => {
  const raw = read(join(DATA, "banned-terms.json"));
  const terms = Array.isArray(raw) ? raw : (raw.terms ?? Object.keys(raw));
  const sorted = [...new Set(terms)].filter(Boolean).sort((a, b) => b.length - a.length);
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The hyphen is optional on match. The store writes `adjavp organism` and
  // `dla ranking (adjavp-organism)` for the identifier D-05 lists as `ADJ-AVP`,
  // and an identifier does not stop being one when its hyphen is dropped. This
  // is the same reasoning `/evidence/`'s index already applies when it splits an
  // observable segment on hyphens before testing each part.
  const loosen = (s) => escape(s).replace(/-/g, "[-_ ]?");
  return new RegExp(`(?<![\\w-])(${sorted.map(loosen).join("|")})(?![\\w-])`, "i");
})();

const carriesAnIdentifier = (s) => typeof s === "string" && BANNED.test(s);

// The forbidden half of the terminology lock, compiled once, for strings that
// come out of a build ledger rather than out of a registry. A feature name like
// "kill criterion fired (clean negative-result report)" is a true description of
// what the ledger recorded and it is still the campaign's apparatus vocabulary,
// so it is withheld and counted rather than reworded: rewording somebody's
// diagnostic is a claim about what they diagnosed.
//
// Only `forbidden` is used. A constrained rule is satisfied by the context the
// page puts around a string, and this cannot see that context.
const LOCK = (() => {
  const terms = read(join(ROOT, "scripts", "checks", "terms.json"));
  return terms.forbidden.map((r) => new RegExp(r.pattern, "i"));
})();

const tripsTheLock = (s) => typeof s === "string" && LOCK.some((re) => re.test(s));

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/** One row per area: how many instruments in it are implemented, how many open. */
function atlasAreas(instruments) {
  const m = new Map();
  for (const i of instruments) {
    if (!m.has(i.series)) m.set(i.series, { area: i.series, implemented: 0, open: 0 });
    const row = m.get(i.series);
    if (i.implemented) row.implemented += 1;
    else row.open += 1;
  }
  return [...m.values()];
}

function build() {
  const catalogue = read(join(DATA, "catalogue.json"));
  const fleetIndex = read(join(DATA, "fleet", "index.json"));
  const applied = new Set();

  const seriesTitle = new Map();
  for (const s of catalogue.series) {
    const { value } = substitute("series", s.letter, "title", s.title, applied);
    seriesTitle.set(s.letter, value);
  }

  const instruments = catalogue.instruments.map((i) => {
    const name = substitute("instrument", i.id, "name", i.name, applied).value;
    const headline = substitute(
      "instrument",
      i.id,
      "headline",
      i.headline,
      applied,
    ).value;
    return {
      // No `id`. The series letter and instrument number are the worst instance
      // of the banned-identifier problem on the old site, and the atlas renders
      // neither. The slug is the name, lowercased and hyphenated, so a row is
      // addressable without an identifier.
      slug: name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
      name,
      headline,
      series: seriesTitle.get(i.series),
      seriesSlug: `s${i.series.toLowerCase()}`,
      // "implemented" and "open" are the two words copy.yaml carries. The
      // registry's third state is a null status, which is `open`: specified and
      // not built.
      implemented: i.status === "built",
      measures: [...new Set((i.quantities ?? []).map(family))].sort(),
      objects: [...(i.substrates ?? [])].sort(),
      phases: [...(i.phases ?? [])].sort(),
      access: accessChannels(i.accessMin),
      cost: firstCost(i.ladder),
      steps: (i.ladder ?? []).length,
    };
  });

  // Facets, counted from the rows rather than declared. A facet value with a
  // count of zero cannot exist, which is the property that keeps a filter from
  // offering an empty view.
  const facet = (pick) => {
    const counts = new Map();
    for (const row of instruments) {
      for (const v of [].concat(pick(row))) {
        if (v === null || v === undefined || v === "") continue;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
    }
    return [...counts]
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .map(([value, count]) => ({ value, count }));
  };

  // -------------------------------------------------------------------------
  // The subjects, summarised rather than dumped
  // -------------------------------------------------------------------------
  //
  // The per-model card used to render one row per stored record: 1,231 rows
  // whose first column was a store key, whose second was a payload class name,
  // and whose remaining three columns held the same value in every single row
  // on the site. Every one of the 1,231 is EXPLORATORY, on the invariant gauge,
  // uncalibrated, with no interval and no readout. A table of that is not a
  // table, and the reader's question it answers badly is "what is in here".
  //
  // So it is counted by payload kind, and the records the store named are
  // listed under their kind, and the four constant facts are stated once as
  // facts about the whole card rather than repeated 299 times.
  const subjects = fleetIndex.map((m) => {
    const card = read(join(DATA, "fleet", `${m.slug}.json`));
    const kinds = new Map();
    const strengths = new Set();
    const gauges = new Set();
    let calibrated = 0;
    let intervals = 0;
    let readouts = 0;
    let withheld = 0;
    for (const e of card.entries) {
      const kind = e.value_repr;
      if (!kinds.has(kind))
        kinds.set(kind, { kind, count: 0, names: [], withheld: 0 });
      const bucket = kinds.get(kind);
      bucket.count += 1;
      if (e.name) {
        if (carriesAnIdentifier(e.name)) {
          bucket.withheld += 1;
          withheld += 1;
        } else {
          // The store prefixes almost every name with the subject it was
          // measured on, and the subject is the page. Dropped by exact prefix
          // match only, so a name that does not start with the slug is left
          // exactly as the store wrote it.
          const label = e.name.startsWith(`${card.slug} `)
            ? e.name.slice(card.slug.length + 1)
            : e.name;
          if (!bucket.names.includes(label)) bucket.names.push(label);
        }
      }
      strengths.add(String(e.trust).toLowerCase());
      gauges.add(String(e.gauge));
      if (e.calibrated) calibrated += 1;
      if (e.ci && e.ci[0] !== null) intervals += 1;
      if (e.readout) readouts += 1;
    }
    const named = card.entries.filter((e) => e.name).length;
    return {
      slug: card.slug,
      hfId: card.hf_id,
      gpuSeconds: card.total_gpu_seconds,
      records: card.entries.length,
      named,
      unnamed: card.entries.length - named,
      withheld,
      kinds: [...kinds.values()]
        .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
        .map((k) => ({ ...k, names: k.names.sort() })),
      // Rendered as one sentence about the card, never as a column. `uniform`
      // is true only when the whole card agrees; a card that stops being
      // uniform makes this false and the page says the mixed thing instead.
      uniform: {
        strength: strengths.size === 1 ? [...strengths][0] : null,
        gauge: gauges.size === 1 ? [...gauges][0] : null,
        calibrated,
        intervals,
        readouts,
      },
      headline: card.headline
        .filter((h) => h.rows.length > 0)
        .map((h) => ({
          name: h.name,
          rows: h.rows,
          evidenceId: h.evidence_id,
          trust: String(h.trust).toLowerCase(),
          gauge: h.gauge,
        })),
    };
  });

  // -------------------------------------------------------------------------
  // The archive cards, as /evidence/ and /limits/ may name them
  // -------------------------------------------------------------------------
  const cardsRaw = read(join(DATA, "cards.json"));
  // The archive's own filing areas, with the one that trips the lock rendered
  // in the registry's vocabulary. `science_name` is null on two cards and the
  // site invents nothing for those.
  const areaNames = Object.fromEntries(
    [...new Set(cardsRaw.map((c) => c.science_name).filter(Boolean))].map((name) => [
      name,
      substitute("area", name, "name", name, applied).value,
    ]),
  );
  const cards = cardsRaw.map((c) => ({
    slug: c.id,
    title: substitute("card", c.id, "title", c.title, applied).value,
    verdict: c.verdict,
    evidenceId: c.adjudication_ev,
    // What it was measured on, which is the facet a reader actually remembers.
    // Signals are the reward models, datasets are the corpora. The science
    // taxonomy is deliberately NOT carried here: `S1`-`S16` are banned
    // identifiers and two of their names trip the terminology lock on their own
    // ("Ground truth and calibration"), so an index built on them would need a
    // substitution for a label that answers "how did the author file this"
    // rather than anything a reader is looking for.
    // Signals are the reward models the record was measured on, which is what
    // `subject.signals` means in the store itself. Datasets are the fallback
    // for the two cards that name no signal, so a row is never empty while a
    // subject exists.
    subject:
      (c.subjects?.signals ?? []).length > 0
        ? c.subjects.signals
        : (c.subjects?.datasets ?? []),
    hypotheses: c.hypotheses.length,
    outcomes: c.hypotheses.map((h) => h.outcome),
  }));

  // -------------------------------------------------------------------------
  // The capability boundary, for /limits/
  // -------------------------------------------------------------------------
  //
  // `works-ledger.json` is the only file on the site that separates the states
  // /limits/ has to keep apart. It records, per capability: whether the code
  // ran, whether it ran on real hardware, whether it was excused, and whether
  // it was never run at all. Collapsing those to "working" and "not working" is
  // the thing /limits/ exists not to do.
  //
  // STATUS WORDS ARE THE LEDGER'S OWN. PASS, PASS-DEGRADED, FAIL, EXCUSED and
  // NOT-RUN are values in the data, not labels written here, which is why they
  // can be rendered under HANDOFF.md §8 rule 1 when a state name invented for
  // the occasion could not be.
  //
  // NOTES ARE NOT CARRIED. Every `note` is a build diagnostic and most of them
  // quote a card identifier or a store key: "VALUES-CONTEST: missing
  // intermediate: no intermediate 'campaign.scores' for roster_key='armorm'".
  // The same is true of `exercised_by`, which is a list of card ids. A feature
  // NAME that carries an identifier is withheld and counted, exactly as a
  // record name is.
  const worksLedger = read(join(DATA, "works-ledger.json"));
  const capabilityRows = Object.entries(worksLedger).flatMap(([group, rows]) =>
    rows.map((r) => ({ ...r, group })),
  );
  const byStatus = new Map();
  let withheldFeatures = 0;
  for (const r of capabilityRows) {
    if (!byStatus.has(r.status))
      byStatus.set(r.status, { status: r.status, count: 0, onRealHardware: 0, features: [] });
    const bucket = byStatus.get(r.status);
    bucket.count += 1;
    // "-" and "cpu" are in the ledger's own hardware column. A capability
    // exercised on a GPU is a different claim from one exercised on a CPU stub,
    // and /limits/ is the page where that difference is the content.
    if (r.hardware && r.hardware !== "-" && r.hardware !== "cpu") bucket.onRealHardware += 1;
    if (carriesAnIdentifier(r.feature) || tripsTheLock(r.feature)) withheldFeatures += 1;
    else if (!bucket.features.includes(r.feature)) bucket.features.push(r.feature);
  }
  const capabilities = {
    total: capabilityRows.length,
    withheldFeatures,
    byStatus: [...byStatus.values()]
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status))
      .map((b) => ({ ...b, features: b.features.sort() })),
    subsystems: [
      ...capabilityRows
        .reduce((m, r) => m.set(r.subsystem, (m.get(r.subsystem) ?? 0) + 1), new Map())
        .entries(),
    ]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([subsystem, count]) => ({ subsystem, count })),
  };

  // The claim states, counted from the cards rather than from prose about them.
  const claimStates = [
    ...cards.reduce((m, c) => m.set(c.verdict, (m.get(c.verdict) ?? 0) + 1), new Map()).entries(),
  ]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([verdict, count]) => ({ verdict, count }));

  // What it measures, with the implemented and open split per area, for the
  // /limits/ table. The area titles are the substituted ones, so /limits/ gets
  // the repair /atlas/ got rather than reaching past it into catalogue.json.
  const areas = atlasAreas(instruments);

  const unused = SUBSTITUTIONS.filter(
    (s) => !applied.has(`${s.scope}:${s.key}:${s.field}`),
  );
  if (unused.length) {
    throw new Error(
      `build_atlas: ${unused.length} substitution(s) matched no registry ` +
        `entry: ${unused.map((s) => `${s.scope} ${s.key}.${s.field}`).join(", ")}. ` +
        `A substitution nobody applies is a substitution nobody has shown ` +
        `works. Delete it or fix its key.`,
    );
  }

  return {
    _note:
      "Generated by scripts/build_atlas.mjs from src/data/catalogue.json and " +
      "src/data/fleet/*.json. Do not edit. `npm run build:atlas:check` fails " +
      "if this file is not what the generator would write today.",
    counts: {
      instruments: instruments.length,
      implemented: instruments.filter((i) => i.implemented).length,
      open: instruments.filter((i) => !i.implemented).length,
      subjects: subjects.length,
      records: subjects.reduce((n, s) => n + s.records, 0),
      namedRecords: subjects.reduce((n, s) => n + s.named, 0),
      withheldNames: subjects.reduce((n, s) => n + s.withheld, 0),
      cards: cards.length,
    },
    facets: {
      measures: facet((r) => r.series),
      objects: facet((r) => r.objects),
      access: facet((r) => r.access),
      phases: facet((r) => r.phases),
    },
    substitutions: SUBSTITUTIONS,
    areaNames,
    capabilities,
    claimStates,
    areas,
    cards,
    instruments,
    subjects,
  };
}

// ---------------------------------------------------------------------------
// The self-check
// ---------------------------------------------------------------------------

/** Every string this file will render, with a path so a failure is findable. */
function* renderedStrings(atlas) {
  for (const [i, s] of atlas.substitutions.entries()) {
    yield [`substitutions[${i}].to`, s.to];
    // `.from` is quoted deliberately: it is the registry's own name, shown
    // beside the replacement so the change is visible. It is a quotation of a
    // banned string and it is not checked here; the PAGE is what has to keep it
    // out of rendered text, and it does that by not rendering it.
  }
  for (const [i, a] of atlas.areas.entries()) yield [`areas[${i}].area`, a.area];
  for (const [k, v] of Object.entries(atlas.areaNames)) yield [`areaNames.${k}`, v];
  for (const [i, b] of atlas.capabilities.byStatus.entries()) {
    yield [`capabilities.byStatus[${i}].status`, b.status];
    for (const [j, f] of b.features.entries())
      yield [`capabilities.byStatus[${i}].features[${j}]`, f];
  }
  for (const [i, s2] of atlas.capabilities.subsystems.entries())
    yield [`capabilities.subsystems[${i}].subsystem`, s2.subsystem];
  for (const [i, c] of atlas.claimStates.entries())
    yield [`claimStates[${i}].verdict`, c.verdict];
  for (const [i, c] of atlas.cards.entries()) {
    yield [`cards[${i}].title`, c.title];
    for (const [j, sub] of c.subject.entries())
      yield [`cards[${i}].subject[${j}]`, sub];
  }
  for (const [i, r] of atlas.instruments.entries()) {
    yield [`instruments[${i}].name`, r.name];
    yield [`instruments[${i}].headline`, r.headline];
    yield [`instruments[${i}].series`, r.series];
    if (r.cost) yield [`instruments[${i}].cost`, r.cost];
  }
  for (const [i, s] of atlas.subjects.entries()) {
    yield [`subjects[${i}].slug`, s.slug];
    for (const [j, k] of s.kinds.entries()) {
      yield [`subjects[${i}].kinds[${j}].kind`, k.kind];
      for (const [n, name] of k.names.entries())
        yield [`subjects[${i}].kinds[${j}].names[${n}]`, name];
    }
    for (const [j, h] of s.headline.entries()) {
      yield [`subjects[${i}].headline[${j}].name`, h.name];
      for (const [n, row] of h.rows.entries())
        yield [`subjects[${i}].headline[${j}].rows[${n}].metric`, row.metric];
    }
  }
}

function selfCheck(atlas) {
  const terms = read(join(ROOT, "scripts", "checks", "terms.json"));
  const rules = terms.forbidden.map((r) => ({
    id: r.id,
    re: new RegExp(r.pattern, "gi"),
    canonical: r.canonical,
  }));
  const failures = [];
  for (const [path, value] of renderedStrings(atlas)) {
    if (typeof value !== "string") continue;
    for (const rule of rules) {
      rule.re.lastIndex = 0;
      const m = rule.re.exec(value);
      if (m) failures.push({ path, rule: rule.id, match: m[0], canonical: rule.canonical });
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------

const check = process.argv.includes("--check");
let atlas;
try {
  atlas = build();
} catch (err) {
  console.error(`FAIL ${err.message}`);
  process.exit(1);
}

const failures = selfCheck(atlas);
for (const f of failures) {
  console.error(
    `FAIL build_atlas: ${f.path} carries "${f.match}", which terms.json rule ` +
      `"${f.rule}" forbids in rendered HTML. Canonical: ${f.canonical}`,
  );
}
if (failures.length) {
  console.error(
    `\nFAIL build_atlas: ${failures.length} emitted string(s) would fail gate 6 ` +
      `on /atlas/. Nothing was written.`,
  );
  process.exit(1);
}

const serialised = `${JSON.stringify(atlas, null, 1)}\n`;

if (check) {
  let onDisk = null;
  try {
    onDisk = readFileSync(OUT, "utf-8");
  } catch {
    console.error(`FAIL build_atlas --check: ${OUT} does not exist. Run npm run build:atlas.`);
    process.exit(1);
  }
  if (onDisk !== serialised) {
    console.error(
      `FAIL build_atlas --check: src/data/atlas.json is not what the generator ` +
        `would write from src/data/catalogue.json and src/data/fleet/*.json ` +
        `today. Either a source file changed and this one was not regenerated, ` +
        `or this one was edited by hand. Run npm run build:atlas.`,
    );
    process.exit(1);
  }
  console.log(
    `build_atlas --check: src/data/atlas.json matches. ${atlas.counts.instruments} ` +
      `instruments, ${atlas.counts.subjects} subjects, ${atlas.counts.records} records, ` +
      `${atlas.counts.namedRecords} of them named by the store, ` +
      `${atlas.substitutions.length} substitutions, ${failures.length} banned strings.`,
  );
  process.exit(0);
}

writeFileSync(OUT, serialised);
console.log(
  `build_atlas: wrote src/data/atlas.json. ${atlas.counts.instruments} instruments ` +
    `(${atlas.counts.implemented} implemented, ${atlas.counts.open} open), ` +
    `${atlas.counts.subjects} subjects, ${atlas.counts.records} archived records, ` +
    `${atlas.counts.namedRecords} named by the store, ` +
    `${atlas.counts.records - atlas.counts.namedRecords} not.`,
);
for (const s of atlas.substitutions) {
  console.log(`build_atlas: ${s.scope} ${s.key}.${s.field} rendered as "${s.to}" (${s.rule})`);
}
