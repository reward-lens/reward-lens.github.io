#!/usr/bin/env node
/**
 * The claim adapter.
 *
 *   node scripts/build_claims.mjs [--check]
 *
 * Reads the evidence store and the generated site data, and emits one JSON
 * file per public claim into src/data/claims/. Nothing here is hand-written
 * and nothing downstream types a public number into a component: a component
 * imports a claim by slug, and the slug resolves or the build fails.
 *
 * THREE RULES THIS FILE IS BUILT AROUND.
 *
 * 1. It fails loudly on a missing required field. Every emitted claim goes
 *    through src/lib/claims/validate.mjs, which is the same module the site
 *    and the gate import, so there is one definition of a valid claim.
 *
 * 2. It never silently rewrites a source string. Where a source sentence
 *    carries a machine identifier it cannot go in a public disclosure, so the
 *    adapter falls back to the next source and RECORDS the substitution in
 *    _manifest.json. Two sentences in the campaign data are in that position
 *    today. Editing them here would hide a defect in the data; dropping them
 *    without a record would hide it in the adapter.
 *
 * 3. It states an absence rather than guessing a value. 39 of the 80 metrics
 *    in the store carry no registered comparator, and no unit source exists
 *    for any campaign metric: quantities.json has 190 quantities and the
 *    intersection with the 53 ledger metric names is EMPTY, measured, not
 *    assumed. So `unit` is null and `comparator` says none was registered,
 *    and a claim with no registered comparator is never given a status.
 *
 * --check exits non-zero if the emitted files differ from what is on disk,
 * which is how CI notices a generated file edited by hand.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import {
  claimProblems,
  OUTCOME_TO_STATUS,
  OPEN_HYPOTHESIS_PREFIX,
  INCONCLUSIVE_REASON_CLASSES,
  reasonClassOf,
  statusForOutcome,
  findMachineId,
} from "../src/lib/claims/validate.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "data", "claims");
const CHECK = process.argv.includes("--check");

const read = (p) => readFileSync(join(ROOT, p), "utf-8");
const json = (p) => JSON.parse(read(p));

/* -------------------------------------------------------------------------
   The store's serialisation sentinels.
   The campaign store writes {"__map__": …} and {"__seq__": …} so a mapping
   with non-string keys survives JSON. C-24 records them reaching a rendered
   page literally; they are unwrapped once, here.
   ------------------------------------------------------------------------- */

const unwrap = (v) => {
  if (v && typeof v === "object") {
    if ("__map__" in v) return unwrap(v.__map__);
    if ("__seq__" in v) return unwrap(v.__seq__);
    if (Array.isArray(v)) return v.map(unwrap);
    const out = {};
    for (const k of Object.keys(v)) out[k] = unwrap(v[k]);
    return out;
  }
  return v;
};

/* -------------------------------------------------------------------------
   Sources
   ------------------------------------------------------------------------- */

const storeLines = read("src/data/claims-store/evidence.jsonl").trim().split("\n");
const store = storeLines.map((l) => unwrap(JSON.parse(l)));
const cards = json("src/data/cards.json");
const ledger = json("src/data/ledger.json");
const evidenceIndex = json("src/data/evidence-index.json");
const evidenceRecords = json("src/data/evidence-records.json");
const release = json("src/data/release.json");
const refusals = json("src/data/refusals.json");
const graderCards = json("src/data/grader-cards.json");
const decomposition = json("src/data/decomposition.json");
const copy = parseYaml(read("design/copy.yaml"));

const cardByKey = new Map(cards.map((c) => [c.card, c]));
const recordById = new Map(store.map((r) => [r.id, r]));

/* -------------------------------------------------------------------------
   Small helpers
   ------------------------------------------------------------------------- */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-07-19T18:15:57Z" to "19 July 2026". Fixed table, so no locale. */
const dateWords = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** A sentence, guaranteed to end in one full stop. */
const sentence = (s) => {
  const t = tidy(s);
  if (!t) return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

const substitutions = [];

/**
 * The first candidate string that is real prose a reader does not decode.
 *
 * A source sentence carrying a machine identifier is skipped and the skip is
 * recorded, never rewritten. `where` names the claim so the manifest entry is
 * actionable upstream.
 */
const firstPublicProse = (candidates, where) => {
  for (const { text, from } of candidates) {
    const t = tidy(text);
    if (!t) continue;
    const machine = findMachineId(t);
    if (machine) {
      substitutions.push({
        where,
        skipped: from,
        reason: `carries a ${machine.kind} ("${machine.match}")`,
        text: t.slice(0, 160),
      });
      continue;
    }
    return { text: t, from };
  }
  return null;
};

/* -------------------------------------------------------------------------
   The prose the adapter composes.

   Every template below is a sentence FRAME; every noun in it comes from the
   data. copy.yaml carries no key for any of these, which is recorded in
   _ui.json and reported by the gate for as long as the fallback is live.
   ------------------------------------------------------------------------- */

const trustNameFor = (evidenceId) => {
  const rec = evidenceRecords[evidenceId];
  if (!rec || !rec.trust) return null;
  return rec.trust;
};

// `rungLicense` used to live here and fed limitationFor. It is gone rather
// than left unused: what a rung licenses is the claim's warrant, and the only
// slot it was reaching was the one that states the claim's limits.

const humanSourceFor = (card, evidenceId) => {
  const when = dateWords(card.adjudicated_at);
  const trust = trustNameFor(evidenceId);
  if (!card.title || !when || !trust) return null;
  return sentence(
    `The frozen study "${card.title}", adjudicated on ${when} at the ${trust} level of the project's evidence ladder`,
  );
};

/** What was measured. One study carries no subject rows and says so. */
const subjectFor = (card) => {
  const s = card.subjects ?? {};
  const parts = [];
  if ((s.signals ?? []).length) parts.push(s.signals.join(" and "));
  if ((s.organisms ?? []).length) parts.push(s.organisms.join(" and "));
  // Five studies name datasets and no signal or organism. Composing
  // "on , over nectar-tournaments" from an empty first clause put a comma
  // where a noun should be, on the sentence that tells a reader what the
  // measurement ranges over.
  if (!parts.length && (s.datasets ?? []).length) return s.datasets.join(" and ");
  const over = (s.datasets ?? []).length ? `, over ${s.datasets.join(" and ")}` : "";
  if (!parts.length && !over) {
    // META-LEDGER carries no subject rows: the study is about the campaign's
    // own bookkeeping rather than about a model. Stated, not padded.
    return "the campaign's own record, rather than a model or a dataset";
  }
  return `${parts.join(", ")}${over}`;
};

/** What it ranges over, and therefore what it does not. */
const scopeFor = (card) =>
  sentence(`One frozen study, adjudicated once, on ${subjectFor(card)}`);

/**
 * What this claim does NOT establish.
 *
 * The first version of this function fell back to the trust rung's own
 * `licenses` string, and 62 of 129 claims took that fallback. So the sentence
 * a reader met under "what this does not establish" was
 * `Licenses "we predicted this in advance, and here is the outcome." The
 * freeze is the warrant.` That is a statement of what the claim DOES warrant,
 * rendered in the one slot on the panel reserved for the opposite, which is a
 * worse failure than an empty field: it reads as a limitation and says the
 * reverse of one.
 *
 * The limit every claim here genuinely carries is the same one, and it is not
 * boilerplate: each is one frozen study, adjudicated once, on named subjects.
 * That sentence is composed from the study's own subjects, so it names what
 * the result does not reach past. The study's power note is appended where it
 * exists, because that is a real second limit and it is the study's own words.
 */
const limitationFor = (card, evidenceId, where, { registered = true } = {}) => {
  // `scope` already opens "One frozen study, adjudicated once, on ...", and
  // the two sentences render one under the other. This one says only what the
  // scope implies and does not restate it.
  const base = sentence(
    `It does not establish that the same holds on another subject, another dataset or another run`,
  );
  const unregistered = registered
    ? null
    : sentence(
        `Nothing was registered against this value in advance, so it is a supporting ` +
          `measurement rather than a tested one`,
      );
  const power = firstPublicProse(
    [{ text: card.power_acceptance?.note, from: "cards.json power_acceptance.note" }],
    where,
  );
  return [base, unregistered, power ? sentence(power.text) : null].filter(Boolean).join(" ");
};

const comparatorFor = (op, threshold) =>
  op !== undefined && op !== null && threshold !== undefined && threshold !== null
    ? `${op} ${threshold}`
    : null;

/** The stated absence, in one place so the gate can recognise it. */
export const NO_COMPARATOR = "none registered";

const uncertaintyFor = (metrics, name) => {
  const lo = metrics[`${name}_ci_low`];
  const hi = metrics[`${name}_ci_high`];
  if (typeof lo === "number" && typeof hi === "number") {
    return `confidence interval ${lo} to ${hi}`;
  }
  return undefined;
};

/* -------------------------------------------------------------------------
   Claim construction
   ------------------------------------------------------------------------- */

/** The record's own route, as the generated records state it. */
const recordUrl = (evidenceId) => evidenceRecords[evidenceId]?.href ?? undefined;

const claims = [];
const byEvidenceId = {};
const byEvidenceField = {};
const defaultForEvidenceId = {};
const problems = [];

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      if (value[k] === undefined) continue;
      out[k] = canonical(value[k]);
    }
    return out;
  }
  return value;
};

/**
 * Readings the build lead has withdrawn, read from the same file the gate
 * reads so the two cannot disagree about which numbers are dead.
 *
 * A retired claim is emitted as a `limitation`. That is not cosmetic: the type
 * rules forbid a limitation from carrying a quantity or a status, so there is
 * no renderer anywhere on the site that can give it the authority of a
 * measured result. Deleting the claim instead would be worse, because the
 * withdrawal is the content: the number is in the store, adjudicated
 * `confirmed`, and a reader who finds it there is owed the correction.
 */
const retiredFile = json("scripts/checks/retired-values.json");
const retiredClaims = new Map((retiredFile.retiredClaims ?? []).map((r) => [r.slug, r]));
const correctedClaims = new Map((retiredFile.correctedClaims ?? []).map((r) => [r.slug, r]));
const retirementsApplied = [];

const applyRetirement = (claim) => {
  const retired = retiredClaims.get(claim.slug);
  if (retired) {
    retirementsApplied.push({ slug: claim.slug, kind: "retired", citation: retired.citation });
    return {
      ...claim,
      type: "limitation",
      status: undefined,
      quantity: undefined,
      comparator: undefined,
      statement: sentence(retired.correction),
      limitation: sentence(retired.why),
    };
  }
  const corrected = correctedClaims.get(claim.slug);
  if (corrected) {
    retirementsApplied.push({ slug: claim.slug, kind: "corrected", citation: corrected.citation });
    return {
      ...claim,
      limitation: [claim.limitation, sentence(corrected.correction)].filter(Boolean).join(" "),
    };
  }
  return claim;
};

const emit = (input, where) => {
  const claim = applyRetirement(input);
  const withoutHash = canonical({ ...claim, contentHash: undefined });
  const hash = createHash("sha256").update(JSON.stringify(withoutHash)).digest("hex").slice(0, 32);
  const full = canonical({ ...claim, contentHash: hash });
  const p = claimProblems(full, where);
  if (p.length) {
    problems.push(...p);
    return null;
  }
  claims.push(full);
  return full;
};

/** Attach a claim to the evidence record it came from. */
const link = (evidenceId, slug, { isDefault = false, field = null } = {}) => {
  if (!evidenceId) return;
  (byEvidenceId[evidenceId] ??= []).push(slug);
  if (isDefault) defaultForEvidenceId[evidenceId] = slug;
  // A chip binds `field="metrics.<name>"`. Both the dotted form and the bare
  // name are recorded, so a chip resolves whichever way its caller wrote it.
  if (field) {
    const m = (byEvidenceField[evidenceId] ??= {});
    m[field] = slug;
    m[`metrics.${field}`] = slug;
    // A confidence-interval endpoint is not a quantity of its own: it IS the
    // uncertainty of the metric it belongs to, and the claim for that metric
    // states the interval. Chips bind the endpoints directly on four routes,
    // so they alias onto the parent rather than being left unresolvable or
    // given a claim of their own that would double-count the measurement.
    for (const end of ["_ci_low", "_ci_high"]) {
      m[`${field}${end}`] = slug;
      m[`metrics.${field}${end}`] = slug;
    }
  }
};

/* --- 1. measured results, one per (study, metric) ------------------------ */

let metricsWithoutComparator = 0;
let metricTotal = 0;

for (const record of store) {
  const v = record.value ?? {};
  const card = cardByKey.get(v.card);
  if (!card) {
    problems.push(`evidence.jsonl: record ${record.id} names study ${v.card}, which cards.json does not carry`);
    continue;
  }
  const metrics = v.metrics ?? {};
  const thresholds = v.thresholds ?? {};
  const comparators = v.comparators ?? {};
  const killThresholds = v.kill_thresholds ?? {};
  const killComparators = v.kill_comparators ?? {};
  const outcomes = v.outcomes ?? {};

  // metric name -> the hypothesis or kill that registered a prediction on it
  const registered = new Map();
  for (const h of card.hypotheses ?? []) {
    if (h.metric) registered.set(h.metric, { kind: "hypothesis", id: h.id, statement: h.statement });
  }
  for (const k of card.kill_criteria ?? []) {
    if (k.metric && !registered.has(k.metric)) {
      registered.set(k.metric, { kind: "kill", id: k.id, statement: null });
    }
  }

  const cardSlug = card.id ?? slugify(card.card);
  const human = humanSourceFor(card, record.id);
  const scope = scopeFor(card);

  for (const name of Object.keys(metrics).sort()) {
    metricTotal += 1;
    const value = metrics[name];
    if (typeof value !== "number") continue;
    // The interval endpoints are the uncertainty of another metric, not
    // metrics in their own right. Folding them in would triple the claim set
    // with rows nothing binds.
    if (/_ci_(low|high)$/.test(name)) continue;

    const reg = registered.get(name);
    const slug = `measured-${cardSlug}-${slugify(name)}`;
    const where = `measured-result ${slug}`;

    let comparator = null;
    let status;
    const ids = [record.id, record.observable, card.study_id, card.spec_hash].filter(Boolean);

    if (reg?.kind === "hypothesis") {
      comparator = comparatorFor(comparators[reg.id], thresholds[reg.id]);
      const outcome = outcomes[reg.id];
      // statusForOutcome, not OUTCOME_TO_STATUS: an `inconclusive` outcome
      // whose reason says the arc never ran is `unrun`, and the rule reads the
      // reason rather than the store's one word for both.
      if (outcome) {
        const hyp = (card.hypotheses ?? []).find((h) => h.id === reg.id);
        status = statusForOutcome(
          outcome,
          hyp?.inconclusive_reason ?? card.inconclusive_reason,
        );
      }
      ids.push(reg.id);
    } else if (reg?.kind === "kill") {
      comparator = comparatorFor(killComparators[reg.id], killThresholds[reg.id]);
      ids.push(reg.id);
    }
    if (!comparator) {
      comparator = NO_COMPARATOR;
      metricsWithoutComparator += 1;
      // A number nothing was predicted about does not get an outcome word.
      status = undefined;
    }

    const statement = reg?.statement
      ? sentence(reg.statement)
      : sentence(
          `A supporting measurement from the frozen study "${card.title}", with no prediction registered against it in advance`,
        );

    const limitation = limitationFor(card, record.id, where, {
      registered: comparator !== NO_COMPARATOR,
    });
    const claim = emit(
      {
        slug,
        label: card.title,
        statement,
        type: "measured-result",
        status,
        subject: subjectFor(card),
        quantity: {
          name,
          value,
          // No unit source exists for a campaign metric. Measured: the 53
          // ledger metric names and the 190 quantity ids in quantities.json
          // do not intersect at all. null is the honest value; a unit read
          // off the metric's own name would be a guess.
          unit: null,
          uncertainty: uncertaintyFor(metrics, name),
        },
        comparator,
        scope,
        limitation,
        humanSource: human,
        sourceUrl: recordUrl(record.id),
        immutableIds: ids,
      },
      where,
    );
    if (claim) link(record.id, slug, { field: name });
  }

  /* --- 2. the study's own adjudication, as an interpretation ------------- */

  const held = Object.values(outcomes).filter((o) => o === "confirmed").length;
  const notHeld = Object.values(outcomes).filter((o) => o === "refuted").length;
  const open = Object.values(outcomes).filter((o) => o === "inconclusive").length;
  const counted = [
    held ? `${held} held` : null,
    notHeld ? `${notHeld} did not` : null,
    open ? `${open} returned no value` : null,
  ].filter(Boolean);

  const verdictSentence = sentence(
    `The frozen study "${card.title}" was adjudicated ${card.verdict}` +
      (counted.length
        ? `, over ${Object.keys(outcomes).length} registered predictions of which ${counted.join(", ")}`
        : ""),
  );
  const interpSlug = `study-${cardSlug}`;
  const interpWhere = `interpretation ${interpSlug}`;
  const reading = firstPublicProse(
    [{ text: card.kill_note, from: "cards.json kill_note" }],
    interpWhere,
  );

  const interp = emit(
    {
      slug: interpSlug,
      label: card.title,
      statement: reading ? `${verdictSentence} ${sentence(reading.text)}` : verdictSentence,
      type: "interpretation",
      // Two rules meet here.
      //
      // cards.json carries a fifth verdict, `mixed`, on 7 of 27 studies. The
      // status enum has no member for it and it is NOT folded into the
      // nearest word: an interpretation with no status renders as one.
      //
      // And a study adjudicated `inconclusive` because it never executed is
      // `unrun`. All 8 such studies have every hypothesis inconclusive under a
      // recognised execution-failure reason, so the card inherits the reading
      // from its own rows rather than being asserted separately.
      status: statusForOutcome(card.verdict, card.inconclusive_reason),
      subject: subjectFor(card),
      scope: scopeFor(card),
      limitation: limitationFor(card, record.id, interpWhere),
      humanSource: humanSourceFor(card, record.id),
      sourceUrl: recordUrl(record.id),
      immutableIds: [record.id, record.observable, card.study_id, card.spec_hash].filter(Boolean),
    },
    interpWhere,
  );
  if (interp) link(record.id, interpSlug, { isDefault: true });
}

/* --- 3. open hypotheses: registered, and no value came back -------------- */

for (const row of ledger) {
  if (row.observed !== null && row.observed !== undefined) continue;
  const card = cardByKey.get(row.card);
  if (!card) continue;
  const evidenceId = card.adjudication_ev;
  const slug = `open-${row.slug}-${slugify(row.metric)}`;
  const where = `open-hypothesis ${slug}`;

  // The reason class carries BOTH the public wording and the status. One
  // table, in validate.mjs, so the gate checks exactly what the adapter set.
  const klass = reasonClassOf(row.inconclusive_reason);
  if (!klass) {
    problems.push(
      `${where}: inconclusive reason class ` +
        `"${String(row.inconclusive_reason ?? "").split(":")[0]}" is not in ` +
        `INCONCLUSIVE_REASON_CLASSES. The raw reason names a store key and cannot go in a ` +
        `disclosure, and an unread reason must not default to "inconclusive": add the class ` +
        `to src/lib/claims/validate.mjs, where the status it earns is decided too. ` +
        `Recognised classes: ${Object.keys(INCONCLUSIVE_REASON_CLASSES).join(", ")}.`,
    );
    continue;
  }

  const claim = emit(
    {
      slug,
      label: card.title,
      statement: `${OPEN_HYPOTHESIS_PREFIX} ${sentence(row.statement)}`,
      type: "open-hypothesis",
      status: statusForOutcome(row.outcome, row.inconclusive_reason),
      subject: subjectFor(card),
      comparator: comparatorFor(row.comparator, row.threshold) ?? NO_COMPARATOR,
      scope: scopeFor(card),
      limitation: sentence(klass.public),
      humanSource: humanSourceFor(card, evidenceId),
      sourceUrl: recordUrl(evidenceId),
      immutableIds: [evidenceId, row.hypothesis_id, card.study_id].filter(Boolean),
    },
    where,
  );
  if (claim) link(evidenceId, slug);
}

/* --- 4. derived results: the decomposition's three parts ----------------- */

{
  const d = decomposition;
  const evidenceId = d.evidenceId;
  const card = cardByKey.get("TOPO-HODGE");
  const human = card ? humanSourceFor(card, evidenceId) : null;
  for (const band of d.bands ?? []) {
    const slug = `derived-decomposition-${slugify(band.part)}`;
    const where = `derived-result ${slug}`;
    const claim = emit(
      {
        slug,
        label: card ? card.title : "Comparison flow decomposition",
        statement: sentence(
          `The ${band.part} part carries ${band.share} of the measured total, on ${d.subject}`,
        ),
        type: "derived-result",
        subject: sentence(d.subject),
        quantity: {
          name: `${band.part} mass`,
          value: band.share,
          // The one place a unit IS stated by the source.
          unit: d.unit,
          scale: "share of the measured total",
        },
        comparator: `the three parts sum to ${d.closure.massesSumTo}`,
        scope: sentence(
          `${d.perDataset.datasetCount} public preference datasets, ${d.perDataset.tournamentsEach} tournaments each, one grader`,
        ),
        limitation: sentence(
          band.belowFloat64Epsilon
            ? `This part measures smaller than the arithmetic that produced it can resolve, so it is reported as a measured absence rather than as a magnitude`
            : `The parts are shares of one grader's measured total and do not transfer to another grader or another corpus`,
        ),
        humanSource: human,
        // The transform, which is what makes this derived rather than measured.
        artifact: d.closure.assertedBy,
        sourceUrl: recordUrl(evidenceId),
        immutableIds: [evidenceId, d.observable, card?.study_id].filter(Boolean),
      },
      where,
    );
    if (claim) link(evidenceId, slug);
  }
}

/* --- 5. definitions: the four rungs, and the refusal contract ------------ */

for (const level of copy.trust_ladder?.levels ?? []) {
  const slug = `rung-${slugify(level.name)}`;
  const claim = emit(
    {
      slug,
      label: level.name,
      statement: sentence(level.definition),
      type: "definition",
      scope: sentence(tidy(copy.trust_ladder.computed_note)),
      limitation: sentence(tidy(copy.trust_ladder.limits_intro)),
      humanSource: sentence(tidy(copy.trust_ladder.source_note)),
      artifact: "design/copy.yaml trust_ladder",
      immutableIds: [`copy.yaml:trust_ladder.levels.${level.name}`],
    },
    `definition rung-${level.name}`,
  );
  if (!claim) continue;
}

{
  const slug = "refusal-contract";
  emit(
    {
      slug,
      label: tidy(copy.refusals.heading),
      statement: sentence(tidy(copy.refusals.intro)),
      type: "definition",
      scope: sentence(
        `The ${refusals.counts.reasons} reasons the library can decline a reading, of which ${refusals.counts.sorted} are sorted by where the remedy is answerable`,
      ),
      limitation: sentence(tidy(copy.refusals.remedy_rule)),
      humanSource: sentence(
        `The refusal enum in the released library, read at build time rather than restated here`,
      ),
      artifact: "src/data/refusals.json",
      sourceUrl: "/docs/refusals/",
      immutableIds: ["copy.yaml:refusals", "src/data/refusals.json"],
    },
    "definition refusal-contract",
  );
}

/* --- 6. software capability: what the install command actually gets ------ */

{
  const latest = release.latest;
  const uploaded = release.releases?.find((r) => r.version === latest)?.uploadedAt;
  const when = uploaded ? dateWords(uploaded) : null;
  emit(
    {
      slug: "install-current-release",
      label: tidy(copy.install.command),
      statement: sentence(
        `Running the install command gets version ${latest} from the package index` +
          (when ? `, which was published on ${when}` : ""),
      ),
      type: "software-capability",
      scope: sentence(tidy(copy.install.python_note)),
      limitation: sentence(tidy(copy.limits.early_note)),
      humanSource: sentence(
        `The package index itself, read by the release generator at build time and never from the project's own version file`,
      ),
      artifact: tidy(copy.install.command),
      sourceUrl: copy.urls.pypi,
      immutableIds: ["src/data/release.json", `reward-lens==${latest}`],
    },
    "software-capability install-current-release",
  );
}

/* --- 7. fixture qualifications: the grader cards ------------------------- */

for (const gc of graderCards.cards ?? []) {
  const slug = `grader-${slugify(gc.key)}`;
  const where = `fixture-qualification ${slug}`;
  emit(
    {
      slug,
      label: gc.displayName,
      statement: sentence(
        `A scoring program was run against a fixed corpus and ${gc.killedMutants} of ${gc.competentMutants} competent mutants were caught`,
      ),
      type: "fixture-qualification",
      // The exact fixture.
      subject: sentence(`${gc.subject.name}, entry point ${gc.subject.entrypoint}, over ${gc.subject.corpus}`),
      // The acceptance check.
      comparator: `mutation score ${gc.mutationScore} over ${gc.competentMutants} competent mutants`,
      scope: sentence(`${gc.graderCalls} grader calls on one corpus, at the ${gc.trust} level`),
      limitation: sentence(
        `A mutation score is a statement about this checker on this corpus, and it does not transfer to another corpus or another checker`,
      ),
      humanSource: sentence(
        `The released grader card for this scoring program, regenerated from the release artifacts rather than restated`,
      ),
      artifact: gc.subject.source,
      immutableIds: [gc.evidenceId, gc.fingerprint].filter(Boolean),
    },
    where,
  );
}

/* --- 8. limitations: what the project states it is not claiming ---------- */

(copy.limits?.not_claiming ?? []).forEach((item, i) => {
  const slug = `not-claiming-${i + 1}`;
  emit(
    {
      slug,
      label: tidy(item.title),
      statement: sentence(tidy(item.body)),
      type: "limitation",
      scope: sentence(tidy(copy.limits.not_claiming_heading)),
      limitation: sentence(tidy(item.title)),
      humanSource: sentence(
        `The project's own statement of what it is not claiming, carried on the limits page`,
      ),
      sourceUrl: "/limits/",
      immutableIds: [`copy.yaml:limits.not_claiming[${i}]`],
    },
    `limitation ${slug}`,
  );
});

(copy.trust_ladder?.limits ?? []).forEach((item, i) => {
  const slug = `ladder-limit-${i + 1}`;
  emit(
    {
      slug,
      label: tidy(item.title),
      statement: sentence(tidy(item.body)),
      type: "limitation",
      scope: sentence(tidy(copy.trust_ladder.limits_heading)),
      limitation: sentence(tidy(item.title)),
      humanSource: sentence(tidy(copy.trust_ladder.source_note)),
      sourceUrl: "/limits/",
      immutableIds: [`copy.yaml:trust_ladder.limits[${i}]`],
    },
    `limitation ${slug}`,
  );
});

/* -------------------------------------------------------------------------
   Write, or fail
   ------------------------------------------------------------------------- */

if (problems.length) {
  console.error(`FAIL build_claims: ${problems.length} problem(s).`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const counts = {};
for (const c of claims) counts[c.type] = (counts[c.type] ?? 0) + 1;

/**
 * The disclosure's own labels.
 *
 * copy.yaml has `ui.provenance_open` and no key for anything else a public
 * disclosure needs. HANDOFF.md §8 rule 1 forbids a build agent from inventing
 * a user-facing string and §9 says to raise it once; this is the raise, in a
 * form that costs nothing to redeem. The requested wording lives here, the
 * loader prefers copy.yaml the moment the key exists, and the gate keeps the
 * debt visible in reports/vacuous-gates.json until then.
 */
const ui = {
  pendingCopyKeys: [
    { key: "ui.claim_technical_copy", text: "Copy technical provenance" },
    { key: "ui.claim_technical_copied", text: "Copied" },
    { key: "ui.claim_technical_unavailable", text: "select to copy" },
  ],
  labels: {
    provenance_open: tidy(copy.ui.provenance_open),
    provenance_record_link: tidy(copy.ui.provenance_record_link),
  },
};

const manifest = {
  generatedBy: "scripts/build_claims.mjs",
  sources: [
    { file: "src/data/claims-store/evidence.jsonl", records: store.length },
    { file: "src/data/cards.json", records: cards.length },
    { file: "src/data/ledger.json", records: ledger.length },
    { file: "src/data/grader-cards.json", records: (graderCards.cards ?? []).length },
    { file: "src/data/decomposition.json", records: (decomposition.bands ?? []).length },
    { file: "src/data/release.json", records: (release.releases ?? []).length },
    { file: "design/copy.yaml", records: (copy.limits?.not_claiming ?? []).length + (copy.trust_ladder?.levels ?? []).length },
  ],
  counts,
  byEvidenceId: Object.fromEntries(
    Object.entries(byEvidenceId).map(([k, v]) => [k, [...v].sort()]),
  ),
  byEvidenceField,
  defaultForEvidenceId,
  outcomeMapping: OUTCOME_TO_STATUS,
  // The finding, kept where a reader of the data meets it.
  unmappedOutcomes: (() => {
    const seen = new Map();
    for (const c of cards) {
      if (!OUTCOME_TO_STATUS[c.verdict]) {
        if (!seen.has(c.verdict)) seen.set(c.verdict, []);
        seen.get(c.verdict).push(c.card);
      }
    }
    return [...seen].map(([outcome, list]) => ({ outcome, cards: list.sort() }));
  })(),
  metricAccounting: {
    metricsInStore: metricTotal,
    withoutRegisteredComparator: metricsWithoutComparator,
    comparatorAbsenceWord: NO_COMPARATOR,
    unitSource:
      "none. The 53 ledger metric names and the 190 quantity ids in quantities.json do not intersect, so every campaign quantity states unit null.",
  },
  proseSubstitutions: substitutions,
  // Which readings the build lead has withdrawn, and what the adapter did
  // about each. The gate re-reads scripts/checks/retired-values.json and
  // asserts this list against it, so a retirement deleted from one file and
  // not the other fails rather than quietly un-retiring a claim.
  retirements: retirementsApplied.sort((a, b) => a.slug.localeCompare(b.slug)),
};

const files = new Map();
for (const c of claims) files.set(`${c.slug}.json`, JSON.stringify(c, null, 1) + "\n");
files.set("_manifest.json", JSON.stringify(canonical(manifest), null, 1) + "\n");
files.set("_ui.json", JSON.stringify(canonical(ui), null, 1) + "\n");

const existing = existsSync(OUT) ? readdirSync(OUT).filter((f) => f.endsWith(".json")) : [];
const drift = [];
for (const [name, body] of files) {
  const path = join(OUT, name);
  if (!existsSync(path) || readFileSync(path, "utf-8") !== body) drift.push(name);
}
for (const name of existing) if (!files.has(name)) drift.push(`${name} (orphaned)`);

if (CHECK) {
  if (drift.length) {
    console.error(
      `FAIL build_claims --check: ${drift.length} generated file(s) differ from the adapter's output:\n  ` +
        drift.slice(0, 12).join("\n  ") +
        `\n  Run \`npm run build:claims\`. Never edit a file under src/data/claims/ by hand.`,
    );
    process.exit(1);
  }
  console.log(`build_claims --check: ${files.size} file(s) match the adapter's output.`);
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
for (const name of existing) if (!files.has(name)) rmSync(join(OUT, name));
for (const [name, body] of files) writeFileSync(join(OUT, name), body);

console.log(
  `build_claims: ${claims.length} claims written to src/data/claims/ ` +
    `(${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}).`,
);
console.log(
  `  ${metricsWithoutComparator} of ${metricTotal} store metrics carry no registered comparator and are given no status.`,
);
if (manifest.unmappedOutcomes.length) {
  for (const u of manifest.unmappedOutcomes) {
    console.log(
      `  outcome "${u.outcome}" has no status member and was left without one on ${u.cards.length} study/studies: ${u.cards.join(", ")}`,
    );
  }
}
for (const s of substitutions) {
  console.log(`  substituted: ${s.where} skipped ${s.skipped}, which ${s.reason}`);
}
