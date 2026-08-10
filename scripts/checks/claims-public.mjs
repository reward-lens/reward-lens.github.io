// Gate 25 · Public claims
//
// The sibling of gate 5. Gate 5 asks whether a rendered number resolves to an
// evidence record at all. This asks the next question, which is the one a
// reader actually has: does the STATEMENT around the number say what its
// source says, at the grade of certainty its type licenses.
//
// It walks RENDERED HTML in dist/, never source, and it checks nine things.
// Each is numbered here and each failure message names its number, because a
// gate with one failure mode is a gate you cannot demonstrate.
//
//   1  every public claim slug rendered on the site resolves
//   2  every measured or derived claim has source, subject, scope, limitation
//   3  every number displayed inside a claim comes through that claim
//   4  the value in prose equals the value in its figure and in its source plate
//   5  sign and unit match the source
//   6  supported / refuted / inconclusive / unrun are never interchanged
//   7  no campaign internal identifier in a normal public disclosure
//   8  the package version and install status are current
//   9  a retired public value does not reappear outside its allowed routes
//
// Why this is not folded into gate 5. Gate 5's unit is a numeral and its
// answer is yes or no. Six of the nine below are about agreement between two
// places that both look correct in isolation, which is the failure mode
// C-24, C-35, C-43 and D-39 all turned out to be. A gate that can only ask
// "is this bound" cannot ask "do these two agree".
//
// Usage:  node scripts/checks/claims-public.mjs [dist] [--verbose]

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DIST, ROOT, distPages, routeOf, textNodes, visibleText, readJson, recordVacuity } from "./_lib.mjs";
import {
  claimProblems,
  findMachineId,
  STATUS_TO_OUTCOME,
  OUTCOME_TO_STATUS,
  statusForOutcome,
  reasonClassOf,
  PROSE_FIELDS,
} from "../../src/lib/claims/validate.mjs";

const dist = process.argv[2]?.startsWith("--") ? DIST : (process.argv[2] ?? DIST);
const VERBOSE = process.argv.includes("--verbose");

const failures = [];
const notes = [];
const fail = (n, message) => failures.push(`FAIL claims ${n}: ${message}`);

/**
 * What each condition actually compared.
 *
 * Five gates in this repository have passed or failed for the wrong reason and
 * every one was found by somebody building against them. Gate 4 reported
 * "0 values compared" and exited 0 (C-49). Gate 15 had no `.mjs` in its
 * extension list and scanned zero files. A condition here that compares
 * nothing is the same defect, and the only way it announces itself is if the
 * gate is required to say what it looked at.
 *
 * So every condition counts its comparisons, the counts are printed on every
 * run, and a condition whose count is zero FAILS. `expectZero` is for the two
 * conditions that legitimately have nothing to compare on a clean site: it
 * still prints, and it still has to be declared here rather than passing by
 * omission.
 */
const compared = {};
const CONDITIONS = {
  1: { what: "rendered claim slugs resolved", expectZero: false },
  2: { what: "generated claims validated", expectZero: false },
  3: { what: "numbers displayed inside a claim, checked against it", expectZero: false },
  4: { what: "values compared against their source plate", expectZero: false },
  5: { what: "signs and units compared against their source", expectZero: false },
  6: { what: "outcome words compared against the store", expectZero: false },
  7: { what: "public disclosures swept for internal identifiers", expectZero: false },
  8: { what: "version and install statements checked", expectZero: false },
  9: { what: "pages swept for a retired public value", expectZero: false },
  10: { what: "declared retirements checked against the generated set", expectZero: false },
};
const count = (n, k = 1) => {
  compared[n] = (compared[n] ?? 0) + k;
};

/* -------------------------------------------------------------------------
   Sources. Everything here is generated; nothing is restated.
   ------------------------------------------------------------------------- */

const CLAIM_DIR = join(ROOT, "src", "data", "claims");
if (!existsSync(CLAIM_DIR)) {
  console.error(
    `FAIL claims: src/data/claims/ does not exist. Run \`npm run build:claims\`. ` +
      `This gate will not hand-write a substitute claim set: a hand-written claim is ` +
      `a claim nobody generated from the store.`,
  );
  process.exit(1);
}

const claims = new Map();
for (const name of readdirSync(CLAIM_DIR).filter((f) => f.endsWith(".json"))) {
  if (name.startsWith("_")) continue;
  claims.set(name.slice(0, -5), JSON.parse(readFileSync(join(CLAIM_DIR, name), "utf-8")));
}
const manifest = readJson(join(CLAIM_DIR, "_manifest.json"), null);
if (!manifest) {
  console.error(`FAIL claims: src/data/claims/_manifest.json is missing. Run \`npm run build:claims\`.`);
  process.exit(1);
}

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

const store = readFileSync(join(ROOT, "src", "data", "claims-store", "evidence.jsonl"), "utf-8")
  .trim()
  .split("\n")
  .map((l) => unwrap(JSON.parse(l)));
const storeById = new Map(store.map((r) => [r.id, r]));
const cards = readJson(join(ROOT, "src", "data", "cards.json"), []);
const cardByKey = new Map(cards.map((c) => [c.card, c]));
const ledger = readJson(join(ROOT, "src", "data", "ledger.json"), []);
const release = readJson(join(ROOT, "src", "data", "release.json"), null);
const decomposition = readJson(join(ROOT, "src", "data", "decomposition.json"), null);
const quantities = readJson(join(ROOT, "src", "data", "quantities.json"), { quantities: [] });
const bannedTerms = (() => {
  const raw = readJson(join(ROOT, "src", "data", "banned-terms.json"), null);
  if (!raw) return [];
  return Array.isArray(raw) ? raw : (raw.terms ?? Object.keys(raw));
})();
const retired = readJson(join(ROOT, "scripts", "checks", "retired-values.json"), { values: [] });

const pages = distPages(dist);
if (pages.length === 0) {
  console.error(`FAIL claims: no built pages under ${dist}. Run npm run build first.`);
  process.exit(1);
}

/* -------------------------------------------------------------------------
   2 · the generated set itself
   ------------------------------------------------------------------------- */

for (const [slug, claim] of claims) {
  count(2);
  for (const problem of claimProblems(claim, `src/data/claims/${slug}.json`)) {
    fail(2, problem);
  }
  if (claim.type === "measured-result" || claim.type === "derived-result") {
    for (const field of ["humanSource", "subject", "scope", "limitation"]) {
      if (!claim[field] || String(claim[field]).trim() === "") {
        fail(
          2,
          `${slug} is a ${claim.type} with no ${field}. A measured or derived result states ` +
            `where it came from, what it measured, what it ranges over and what it does not establish, ` +
            `or it is a number with a citation rather than a claim.`,
        );
      }
    }
  }
}

/* -------------------------------------------------------------------------
   10 · retired readings stay retired
   scripts/checks/retired-values.json is read by the ADAPTER as well as by this
   gate, so the two cannot disagree about which readings are dead. This half
   checks that the adapter actually applied what the file says, because a
   retirement that is declared and not applied is the worst of both: the file
   reads as though the correction shipped.
   ------------------------------------------------------------------------- */

for (const entry of retired.retiredClaims ?? []) {
  count(10);
  const claim = claims.get(entry.slug);
  if (!claim) {
    fail(
      10,
      `retired-values.json retires "${entry.slug}" and no such claim is generated. ` +
        `A retirement of a claim that does not exist is a rule nothing enforces.`,
    );
    continue;
  }
  if (claim.type !== "limitation") {
    fail(
      10,
      `${entry.slug} is retired and is generated as type "${claim.type}". A retired reading ` +
        `is a limitation, because the type rules forbid a limitation from carrying a quantity ` +
        `or a status and that is what stops a renderer giving it the authority it lost. ${entry.citation}`,
    );
  }
  if (claim.quantity || claim.status) {
    fail(
      10,
      `${entry.slug} is retired and still carries ${claim.quantity ? "a quantity" : ""}` +
        `${claim.quantity && claim.status ? " and " : ""}${claim.status ? `status "${claim.status}"` : ""}. ` +
        `The store adjudicates it confirmed, so left alone the outcome mapping renders it supported.`,
    );
  }
}
for (const entry of retired.correctedClaims ?? []) {
  count(10);
  const claim = claims.get(entry.slug);
  if (!claim) {
    fail(10, `retired-values.json corrects "${entry.slug}" and no such claim is generated.`);
    continue;
  }
  if (!String(claim.limitation ?? "").includes(entry.correction.slice(0, 40))) {
    fail(
      10,
      `${entry.slug} is on the corrected list and its limitation does not carry the correction. ` +
        `The measurement is real and the reading placed on it is not, so the number keeps its ` +
        `claim and the claim carries the withdrawal. ${entry.citation}`,
    );
  }
}

/* -------------------------------------------------------------------------
   4, 5, 6 · the claim against its own source
   ------------------------------------------------------------------------- */

/** The metric value the store itself carries, for a claim generated from one. */
const sourceValueFor = (claim) => {
  if (!claim.quantity) return null;
  const evidenceId = claim.immutableIds.find((i) => i.startsWith("ev:"));
  if (claim.type === "derived-result" && decomposition) {
    const part = claim.quantity.name.replace(/ mass$/, "");
    const band = (decomposition.bands ?? []).find((b) => b.part === part);
    if (band) return { value: band.share, unit: decomposition.unit, from: "src/data/decomposition.json" };
    return null;
  }
  const record = evidenceId ? storeById.get(evidenceId) : null;
  if (!record) return null;
  const metrics = record.value?.metrics ?? {};
  if (!(claim.quantity.name in metrics)) return null;
  return {
    value: metrics[claim.quantity.name],
    // The store states no unit for a campaign metric. Recorded, not guessed.
    unit: null,
    from: "src/data/claims-store/evidence.jsonl",
  };
};

const ledgerByCardMetric = new Map();
for (const row of ledger) ledgerByCardMetric.set(`${row.card}::${row.metric}`, row);

for (const [slug, claim] of claims) {
  const source = sourceValueFor(claim);

  if (claim.quantity && source) {
    count(4);
    count(5, 2);
    // 4 · the source plate. The prose arm of this is below, against dist/.
    if (source.value !== claim.quantity.value) {
      fail(
        4,
        `${slug} states ${claim.quantity.name} = ${claim.quantity.value} and ` +
          `${source.from} states ${source.value}. A claim and its source plate disagree.`,
      );
    }
    // 5 · sign, which is the half of a disagreement that changes the conclusion.
    const sign = (n) => (typeof n === "number" ? Math.sign(n) : NaN);
    if (sign(source.value) !== sign(claim.quantity.value)) {
      fail(
        5,
        `${slug} states ${claim.quantity.name} with sign ${sign(claim.quantity.value)} and ` +
          `${source.from} states sign ${sign(source.value)}. C-41 records two values for one ` +
          `quantity that were opposite in sign and supported opposite conclusions.`,
      );
    }
    // 5 · unit.
    const claimUnit = claim.quantity.unit ?? null;
    const sourceUnit = source.unit ?? null;
    if (claimUnit !== sourceUnit) {
      fail(
        5,
        `${slug} states unit ${JSON.stringify(claimUnit)} for ${claim.quantity.name} and ` +
          `${source.from} states ${JSON.stringify(sourceUnit)}.`,
      );
    }
  }

  // 6 · the outcome word.
  //
  // The comparison runs FORWARD, from the source outcome through the same
  // rule the adapter used, rather than backward from the rendered word. Going
  // backward, `unrun` would have to be un-mapped to `inconclusive` and the
  // check would be asserting the inverse of a rule that is deliberately not
  // one-to-one: `inconclusive` in the store becomes `unrun` in public when the
  // reason says the study never executed, and both words exist.
  if (claim.status) {
    const cardKey = claim.immutableIds
      .map((i) => (i.startsWith("ev:") ? storeById.get(i)?.value?.card : null))
      .find(Boolean);
    const card = cardKey ? cardByKey.get(cardKey) : null;
    const row = claim.quantity ? ledgerByCardMetric.get(`${cardKey}::${claim.quantity.name}`) : null;
    const openRow = claim.type === "open-hypothesis"
      ? ledger.find((r) => claim.immutableIds.includes(r.hypothesis_id) && r.card === cardKey)
      : null;
    const source = row ?? openRow;
    const sourceOutcome = source ? source.outcome : claim.type === "interpretation" ? card?.verdict : null;
    const sourceReason = source
      ? (source.inconclusive_reason ?? card?.inconclusive_reason)
      : card?.inconclusive_reason;
    if (sourceOutcome) count(6);
    const expectedStatus = sourceOutcome ? statusForOutcome(sourceOutcome, sourceReason) : null;
    if (sourceOutcome && expectedStatus !== claim.status) {
      fail(
        6,
        `${slug} renders status "${claim.status}". The source says "${sourceOutcome}"` +
          (sourceOutcome === "inconclusive"
            ? ` with reason class "${reasonClassOf(sourceReason)?.key ?? "unrecognised"}"`
            : "") +
          `, which earns "${expectedStatus ?? "no status"}". supported, refuted, inconclusive and ` +
          `unrun are never interchanged: confirmed becomes supported, and an inconclusive outcome ` +
          `whose reason says the study never executed becomes unrun rather than inconclusive.`,
      );
    }
  }

  // 6 · an inconclusive outcome nobody has read must not have taken a word.
  if (claim.status === "inconclusive") {
    fail(
      6,
      `${slug} renders status "inconclusive". Every inconclusive outcome in this store is an ` +
        `execution failure and reads as "unrun", so an "inconclusive" here means a reason class ` +
        `reached the public layer without anyone deciding which of the two facts it is.`,
    );
  }

  // 6 · a verdict with no member must not have been folded into the nearest one.
  if (claim.type === "interpretation") {
    const cardKey = claim.immutableIds
      .map((i) => (i.startsWith("ev:") ? storeById.get(i)?.value?.card : null))
      .find(Boolean);
    const card = cardKey ? cardByKey.get(cardKey) : null;
    if (card && !OUTCOME_TO_STATUS[card.verdict]) count(6);
    if (card && !OUTCOME_TO_STATUS[card.verdict] && claim.status) {
      fail(
        6,
        `${slug} carries status "${claim.status}" while its study was adjudicated ` +
          `"${card.verdict}", which has no status member. An outcome with no member is left ` +
          `without one; it is never folded into the nearest word.`,
      );
    }
  }
}

// 5 · the premise behind every null unit. If the registries ever start naming
// campaign metrics, `unit: null` stops being the honest value and starts being
// a stale one, and nothing else would say so.
{
  const qids = new Set((quantities.quantities ?? []).map((q) => q.id));
  const metricNames = new Set(ledger.map((r) => r.metric).filter(Boolean));
  const overlap = [...metricNames].filter((m) => qids.has(m));
  if (overlap.length) {
    fail(
      5,
      `${overlap.length} campaign metric name(s) now appear in the quantity registry ` +
        `(${overlap.slice(0, 4).join(", ")}). Every claim generated from the store states ` +
        `unit null because the two sets did not intersect. They do now, so the units are ` +
        `derivable and null has become a stale answer rather than an honest one.`,
    );
  }
}

/* -------------------------------------------------------------------------
   The rendered site
   ------------------------------------------------------------------------- */

const CLAIM_ATTR = /data-claim="([^"]*)"/g;
const CLAIM_STATUS_ATTR = /data-claim="([^"]*)"[^>]*data-claim-status="([^"]*)"/g;

/**
 * CONDITION 4 PAIRED BY CHARACTER DISTANCE AND MATCHED NOTHING FOR THE WHOLE
 * BUILD. This is how, and why the replacement is structural.
 *
 * It used to read:
 *
 *     /data-claim="([^"]*)"[\s\S]{0,400}?data-claim-value="([^"]*)"/g
 *
 * The two attributes are not on the same element. `data-claim` sits on the
 * wrapping `<span class="prov">` and `data-claim-value` on the
 * `<button class="prov__trigger">` inside it, and between them the chip emits
 * an `id`, an `aria-expanded`, an `aria-describedby` and a full `aria-label`
 * restating the value, its subject and its trust level. Measured over this
 * build: **139 `data-claim-value` attributes, and the distance from the owning
 * `data-claim` is never below 438** — median 514, maximum 582. So the window of
 * 400 paired **zero** of 139. Not a thin sample: none.
 *
 * The gate still printed a healthy count, because condition 4 has a second arm
 * that reads the generated claims directly, and the two arms were summed. A
 * dead arm plus a live arm reads exactly like one working gate.
 *
 * So: pair by CONTAINMENT, which is the relationship that actually holds, and
 * never by proximity, which is a guess about how much markup fits between two
 * things. A `data-claim-value` belongs to the nearest preceding `data-claim`
 * unless that element already closed, which a `</span>` between them proves.
 * That is exact for this markup and it does not care how long the ARIA gets.
 */
const CLAIM_VALUE_ONLY = /data-claim-value="([^"]*)"/g;
const CLAIM_OWNER = /data-claim="([^"]*)"/g;

function claimValuePairs(html) {
  const owners = [...html.matchAll(CLAIM_OWNER)].map((m) => ({ at: m.index, slug: m[1] }));
  const pairs = [];
  for (const m of html.matchAll(CLAIM_VALUE_ONLY)) {
    let owner = null;
    for (const o of owners) {
      if (o.at < m.index) owner = o;
      else break;
    }
    if (!owner) continue;
    // The owning element must still be open where the value sits. A closing
    // `</span>` in between means the value belongs to something else, and
    // guessing would be worse than skipping it.
    if (html.slice(owner.at, m.index).includes("</span>")) continue;
    pairs.push({ slug: owner.slug, value: m[1] });
  }
  return pairs;
}
const DISCLOSURE = /<span\b[^>]*\bdata-claim-disclosure\b[^>]*>([\s\S]*?)<\/span>\s*<\/span>/g;
const NUMERIC = /(?<![\w.-])[+-]?\d[\d,]*(?:\.\d+)?(?:e[+-]?\d+)?/gi;

const renderedValues = new Map(); // slug -> Map(value -> routes)
let claimInstances = 0;
let disclosuresSwept = 0;
/* Condition 4's rendered-HTML arm, counted on its own. It is summed with the
   generated-claims arm in the gate's own tally, and that summing is what let it
   sit at zero unnoticed for the whole build. An arm that reports only into a
   total cannot be seen to be empty. */
let renderedPairs = 0;

const sorted = [...new Set(bannedTerms)].filter(Boolean).sort((a, b) => b.length - a.length);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BANNED_RE = sorted.length
  ? new RegExp(`(?<![\\w-])(${sorted.map(escape).join("|")})(?![\\w-])`, "g")
  : null;

for (const file of pages) {
  const route = routeOf(file, dist);
  const html = readFileSync(file, "utf-8");
  if (!html.includes("data-claim")) continue;

  // 1 · every rendered slug resolves.
  for (const m of html.matchAll(CLAIM_ATTR)) {
    claimInstances += 1;
    count(1);
    if (!claims.has(m[1])) {
      fail(
        1,
        `${route} renders claim "${m[1]}", which does not resolve against src/data/claims/ ` +
          `(${claims.size} claims). A claim slug that does not resolve is a statement with no source.`,
      );
    }
  }

  // 4 · prose against the claim. Every place the same claim is rendered has to
  // show the same number, and that number has to be the claim's own.
  for (const { slug, value } of claimValuePairs(html)) {
    const claim = claims.get(slug);
    if (!claim) continue;
    renderedPairs += 1;
    if (!renderedValues.has(slug)) renderedValues.set(slug, new Map());
    const seen = renderedValues.get(slug);
    if (!seen.has(value)) seen.set(value, new Set());
    seen.get(value).add(route);
    count(4);
    if (claim.quantity && String(claim.quantity.value) !== value) {
      fail(
        4,
        `${route} renders ${slug} as "${value}" and the claim states ` +
          `"${claim.quantity.value}". The value in prose and the value in its claim disagree.`,
      );
    }
  }

  // 6 · a rendered status word is the claim's own.
  for (const m of html.matchAll(CLAIM_STATUS_ATTR)) {
    const [, slug, status] = m;
    const claim = claims.get(slug);
    if (claim) count(6);
    if (claim && claim.status !== status) {
      fail(
        6,
        `${route} renders ${slug} with status "${status}" and the claim states ` +
          `"${claim.status ?? "none"}".`,
      );
    }
  }

  // 3 and 7 · what the normal disclosure actually contains.
  for (const m of html.matchAll(DISCLOSURE)) {
    disclosuresSwept += 1;
    count(7);
    const inner = m[1];
    const owner = html.slice(0, m.index).match(/data-claim="([^"]*)"(?![\s\S]*data-claim=")/);
    const slug = owner ? owner[1] : null;
    const claim = slug ? claims.get(slug) : null;
    const text = visibleText(inner);

    // 7 · no machine identifier, by shape and by the generated ban list.
    const machine = findMachineId(text);
    if (machine) {
      fail(
        7,
        `${route} shows a ${machine.kind} ("${machine.match}") in a normal public disclosure` +
          (slug ? ` for ${slug}` : "") +
          `. Machine ids belong behind the technical affordance, which carries them as an ` +
          `attribute and never as text.`,
      );
    }
    if (BANNED_RE) {
      BANNED_RE.lastIndex = 0;
      const banned = BANNED_RE.exec(text);
      if (banned) {
        fail(
          7,
          `${route} shows the internal identifier "${banned[1]}" in a normal public disclosure` +
            (slug ? ` for ${slug}` : "") +
            `. D-05: a stranger meets a finding before an identifier.`,
        );
      }
    }

    // 3 · every number in the disclosure came through the claim.
    if (claim) {
      const body = JSON.stringify(claim);
      for (const raw of text.match(NUMERIC) ?? []) {
        const token = raw.trim();
        if (token.length < 2) continue;
        count(3);
        if (body.includes(token)) continue;
        fail(
          3,
          `${route} shows "${token}" inside the disclosure for ${slug}, and that number is ` +
            `nowhere in the claim. Every number a disclosure displays comes through the ` +
            `generated claim, or the disclosure is asserting something the claim does not.`,
        );
      }
    }
  }
}

// 4 · the figure arm. One claim rendered as two different numbers is the
// disagreement between prose and figure that this condition exists for.
for (const [slug, seen] of renderedValues) {
  if (seen.size > 1) {
    const shown = [...seen]
      .map(([v, routes]) => `"${v}" on ${[...routes].sort().join(", ")}`)
      .join(" and ");
    fail(
      4,
      `${slug} renders as more than one value across the site: ${shown}. The value in prose, ` +
        `the value in its figure and the value in its source plate are one value.`,
    );
  }
}

/* -------------------------------------------------------------------------
   8 · the package version and the install status
   ------------------------------------------------------------------------- */

const cmp = (a, b) => {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
};

count(8);
if (!release) {
  fail(8, `src/data/release.json is missing, so the install status cannot be checked at all.`);
} else {
  count(8, 3);
  const newest = [...(release.releases ?? [])].sort((a, b) =>
    String(a.uploadedAt).localeCompare(String(b.uploadedAt)),
  ).at(-1);
  if (!newest) {
    fail(8, `src/data/release.json carries no releases, so there is no published version to check.`);
  } else if (release.latest !== newest.version) {
    fail(
      8,
      `release.json states latest "${release.latest}" while the newest upload on the index is ` +
        `"${newest.version}" (${newest.uploadedAt}). The install strip would tell a reader they ` +
        `get a version they do not get.`,
    );
  }
  if (release.unpublished !== null) {
    fail(
      8,
      `release.json states an unpublished version "${release.unpublished}". Every string that ` +
        `follows from it says the version described here has not been released, and 3.0.0 has ` +
        `been on the package index since 2026-08-07. Regenerate with \`npm run gen:release\`.`,
    );
  }
  if (release.latest && cmp(release.latest, "3.0.0") < 0) {
    fail(
      8,
      `release.json states latest "${release.latest}". 3.0.0 is on the package index and ` +
        `\`pip install reward-lens\` gets it, so any lower value is stale.`,
    );
  }

  // The rendered arm: a version stated on a page that is not the one the index
  // serves. Two routes are out of scope and both structurally rather than by
  // allowance: /docs/reference/ is the library's own docstrings rendered
  // verbatim, which gate 5 and gate 9 already exempt for the same reason, and
  // /gallery/ is a fixture surface that D-33 gates out of a production build.
  const VERSION_IN_TEXT = /\breward-lens[=@ ]{0,3}(\d+\.\d+\.\d+)\b|\binstalls\s+(\d+\.\d+\.\d+)\b/g;
  const staleRatchet = new Map((retired.staleVersions ?? []).map((s) => [s.route, s]));
  const staleSeen = new Set();
  for (const file of pages) {
    const route = routeOf(file, dist);
    if (route.startsWith("/docs/reference/") || route.startsWith("/gallery/")) continue;
    const text = visibleText(readFileSync(file, "utf-8"));
    for (const m of text.matchAll(VERSION_IN_TEXT)) {
      const v = m[1] ?? m[2];
      if (!v || cmp(v, release.latest) >= 0) continue;
      const deferred = staleRatchet.get(route);
      if (deferred) {
        staleSeen.add(route);
        continue;
      }
      fail(
        8,
        `${route} states version ${v} for reward-lens. The package index serves ` +
          `${release.latest}, and \`pip install reward-lens\` gets it. Any sentence saying the ` +
          `library is unreleased, or that the install gets an older version, is now false.`,
      );
    }
  }
  if (staleSeen.size) {
    const list = [...staleSeen]
      .map((r) => `${r} (${staleRatchet.get(r).packet}, ${staleRatchet.get(r).source})`)
      .join(", ");
    recordVacuity(
      25,
      `${staleSeen.size} route(s) state a superseded version and were absorbed by the stale-version ` +
        `ratchet rather than failed: ${list}. The ratchet may shrink and must not grow.`,
    );
    notes.push(`${staleSeen.size} stale version statement(s) DEFERRED, not passing: ${list}.`);
  }
  for (const [route] of staleRatchet) {
    if (!staleSeen.has(route)) {
      notes.push(
        `retired-values.json defers a stale version on ${route} and no stale version is rendered ` +
          `there. Delete the entry.`,
      );
    }
  }
}

/* -------------------------------------------------------------------------
   9 · retired values
   ------------------------------------------------------------------------- */

let deferredHits = 0;
const deferredSeen = new Set();
for (const entry of retired.values ?? []) {
  const re = new RegExp(entry.pattern, "g");
  const deferred = new Map((entry.deferredRoutes ?? []).map((d) => [d.route, d]));
  for (const file of pages) {
    const route = routeOf(file, dist);
    if ((entry.allowedRoutes ?? []).some((p) => route.startsWith(p))) continue;
    const text = visibleText(readFileSync(file, "utf-8"));
    re.lastIndex = 0;
    count(9);
    const hits = text.match(re);
    if (!hits) continue;
    const d = deferred.get(route);
    if (d) {
      deferredHits += hits.length;
      deferredSeen.add(`${entry.id}@${route}`);
      continue;
    }
    fail(
      9,
      `${route} renders the retired value "${hits[0]}" (${entry.id}). ${entry.why} ` +
        `Allowed only under ${(entry.allowedRoutes ?? []).join(", ") || "no route"}. ` +
        `Citation: ${entry.citation}`,
    );
  }
  // A ratchet entry nobody needs is a ratchet entry that should be deleted.
  for (const [route, d] of deferred) {
    if (!deferredSeen.has(`${entry.id}@${route}`)) {
      notes.push(
        `retired-values.json defers ${entry.id} on ${route} for ${d.packet}, and the value is ` +
          `no longer rendered there. Delete the entry.`,
      );
    }
  }
}

if (deferredHits > 0) {
  const list = (retired.values ?? [])
    .flatMap((e) => (e.deferredRoutes ?? []).map((d) => `${e.id} on ${d.route} (${d.packet})`))
    .join(", ");
  recordVacuity(
    25,
    `${deferredHits} occurrence(s) of a retired public value were absorbed by the ratchet and not ` +
      `failed: ${list}. The ratchet may shrink and must not grow.`,
  );
  notes.push(
    `${deferredHits} occurrence(s) of a retired value are DEFERRED, not passing: ${list}.`,
  );
}

/* -------------------------------------------------------------------------
   The pending copy keys, which are a debt rather than a failure
   ------------------------------------------------------------------------- */

{
  const ui = readJson(join(CLAIM_DIR, "_ui.json"), { pendingCopyKeys: [] });
  const copyRaw = existsSync(join(ROOT, "design", "copy.yaml"))
    ? readFileSync(join(ROOT, "design", "copy.yaml"), "utf-8")
    : "";
  const pending = (ui.pendingCopyKeys ?? []).filter(
    ({ key }) => !new RegExp(`^\\s*${key.replace(/^ui\./, "")}\\s*:`, "m").test(copyRaw),
  );
  if (pending.length) {
    recordVacuity(
      25,
      `${pending.length} disclosure label(s) are still falling back to the adapter's own wording ` +
        `because copy.yaml has no key for them: ${pending.map((p) => p.key).join(", ")}. ` +
        `HANDOFF.md §8 rule 1 says a build agent does not invent a user-facing string; this is ` +
        `the raise, and the loader picks copy.yaml up the moment the key exists.`,
    );
    notes.push(
      `${pending.length} disclosure label(s) awaiting a copy.yaml key: ` +
        pending.map((p) => `${p.key} = ${JSON.stringify(p.text)}`).join(", "),
    );
  }
}

/* -------------------------------------------------------------------------
   Report
   ------------------------------------------------------------------------- */

for (const line of failures) console.error(line);
for (const line of notes) console.log(`\nnote: ${line}`);

/* -------------------------------------------------------------------------
   What each condition compared, and the refusal to pass on nothing
   ------------------------------------------------------------------------- */

const vacuous = [];
console.log("");
for (const n of Object.keys(CONDITIONS).sort((x, y) => Number(x) - Number(y))) {
  const seen = compared[n] ?? 0;
  console.log(`claims ${String(n).padStart(2)}: ${String(seen).padStart(6)} ${CONDITIONS[n].what}`);
  if (seen === 0 && !CONDITIONS[n].expectZero) vacuous.push(n);
}
for (const n of vacuous) {
  console.error(
    `FAIL claims ${n}: 0 ${CONDITIONS[n].what}. The condition ran and looked at nothing, which ` +
      `is not a pass. Gate 4 reported "0 values compared" and exited 0 on a key namespace ` +
      `mismatch (C-49) and gate 15 scanned zero files because its extension list had no ".mjs".`,
  );
}
if (vacuous.length) {
  recordVacuity(
    25,
    `condition(s) ${vacuous.join(", ")} compared nothing on this run and the gate failed rather ` +
      `than reporting a pass it did not earn.`,
  );
}

if (claimInstances === 0) {
  // Same trap as gates 4, 15 and 24: a check that reports success while
  // looking at nothing. C-38 and C-49 are both this shape.
  console.error(
    `\nFAIL claims: ${pages.length} built pages and NOT ONE renders a claim. This gate ` +
      `would otherwise report a pass it did not earn.`,
  );
  process.exit(1);
}

const byType = {};
for (const c of claims.values()) byType[c.type] = (byType[c.type] ?? 0) + 1;

console.log(
  `\nclaims: ${claims.size} generated claims (${Object.entries(byType)
    .sort()
    .map(([k, v]) => `${v} ${k}`)
    .join(", ")}).`,
);
console.log(
  `claims: ${pages.length} pages, ${claimInstances} claim instances rendered, ` +
    `${disclosuresSwept} public disclosures swept, ${deferredHits} retired value(s) deferred, ` +
    `${failures.length} failures.`,
);
/* Condition 4's two arms, reported apart. The rendered-HTML arm paired zero of
   139 values for the whole build behind a summed total, so it states its own
   number now and refuses to pass while empty. */
const valueAttrs = pages.reduce(
  (n, f) => n + (readFileSync(f, "utf-8").match(/data-claim-value="/g) || []).length,
  0,
);
console.log(
  `claims 4: ${renderedPairs} rendered value(s) paired to an owning claim, ` +
    `of ${valueAttrs} data-claim-value attribute(s) in the build.`,
);
if (valueAttrs > 0 && renderedPairs === 0) {
  console.error(
    `\nFAIL claims 4: the build renders ${valueAttrs} data-claim-value attribute(s) and this ` +
      `check paired NONE of them to an owning claim, so the arm that compares a rendered number ` +
      `against its claim compared nothing. It reported a healthy count anyway, because its total ` +
      `is summed with the arm that reads the generated claims. An arm at zero is an absent check, ` +
      `not a passing one.\n`,
  );
  process.exit(1);
}
if (VERBOSE) {
  for (const [slug, seen] of [...renderedValues].sort()) {
    console.log(`  ${slug}: ${[...seen.keys()].join(" | ")}`);
  }
}
process.exit(failures.length > 0 || vacuous.length > 0 ? 1 : 0);
