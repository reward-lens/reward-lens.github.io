/**
 * What makes a public claim valid, in one module.
 *
 * Plain .mjs on purpose, and for the same reason as
 * src/components/base/guards.mjs: the generator, the Astro components and
 * `node --test` all import THIS file, so a passing test is a statement about
 * the build rather than about a copy of the rules. A second copy of the
 * per-type requirements living in the gate is how the gate and the generator
 * end up disagreeing about what a claim is.
 *
 * Every function here throws. A claim that does not validate is a build
 * failure, never a rendered placeholder.
 */

export const CLAIM_TYPES = Object.freeze([
  "definition",
  "software-capability",
  "fixture-qualification",
  "measured-result",
  "derived-result",
  "interpretation",
  "open-hypothesis",
  "limitation",
]);

export const CLAIM_STATUSES = Object.freeze([
  "supported",
  "refuted",
  "inconclusive",
  "unrun",
]);

/**
 * The store's outcome word to this layer's status word.
 *
 * `confirmed` to `supported` is the only rename, and it is a rename rather
 * than a judgment: the ledger's `confirmed` means the registered prediction
 * held. `mixed`, which cards.json carries on 7 of 27 cards, is ABSENT on
 * purpose. Mapping it to any of the four would be interchanging two outcomes,
 * which is the failure this table exists to make impossible.
 */
export const OUTCOME_TO_STATUS = Object.freeze({
  confirmed: "supported",
  refuted: "refuted",
  inconclusive: "inconclusive",
  unrun: "unrun",
});

/** The reverse, so a check can go from a rendered word back to its source. */
export const STATUS_TO_OUTCOME = Object.freeze(
  Object.fromEntries(Object.entries(OUTCOME_TO_STATUS).map(([k, v]) => [v, k])),
);

/**
 * An `inconclusive` outcome whose reason says the study never executed is
 * `unrun`, not `inconclusive`.
 *
 * RULING, build lead, 2026-08-11. These are different facts and the site has
 * to keep them apart: an inconclusive result is evidence that did not decide;
 * an unrun study is an absence of evidence. Collapsing them makes the project
 * look like it tested more than it did. The store carries one word for both,
 * so the mapping reads the REASON and never the label.
 *
 * All 16 inconclusive rows in the ledger fall into these two classes, and both
 * are stated execution failures rather than ambiguous results. The key is the
 * text before the first colon in `inconclusive_reason`, quoted verbatim:
 *
 *   missing intermediate     "the arc that produces it has not run or its
 *                             shard was not merged"                11 of 16
 *   resolve_subjects failed  "PermissionError(13, 'Permission denied')"
 *                                                                   5 of 16
 *
 * A class that is not in this table is NOT quietly treated as inconclusive.
 * The adapter fails on it, because an unrecognised reason is one nobody has
 * read, and this is the table where reading it gets recorded.
 *
 * The `public` string is what a disclosure shows. The raw reason cannot be
 * shown: every one of them names a store key.
 */
export const INCONCLUSIVE_REASON_CLASSES = Object.freeze({
  "missing intermediate": Object.freeze({
    status: "unrun",
    public:
      "The study returned no value because an input it needs was not produced by the run that was supposed to produce it",
  }),
  "resolve_subjects failed": Object.freeze({
    status: "unrun",
    public:
      "The study returned no value because its registered subject could not be read when the study ran",
  }),
});

/**
 * The class of an inconclusive reason, or null when nobody has read this one.
 * Returning null is the signal to fail, never the signal to fall back.
 */
export function reasonClassOf(reason) {
  const key = String(reason ?? "").split(":")[0].trim();
  const found = INCONCLUSIVE_REASON_CLASSES[key];
  return found ? { key, ...found } : null;
}

/**
 * The public status for one source outcome, applying the ruling above.
 *
 * Used by the adapter to set a status and by the gate to check one, so the two
 * cannot drift into disagreeing about which word a study earned.
 */
export function statusForOutcome(outcome, reason) {
  if (outcome !== "inconclusive") return OUTCOME_TO_STATUS[outcome];
  const klass = reasonClassOf(reason);
  return klass ? klass.status : OUTCOME_TO_STATUS.inconclusive;
}

/**
 * A machine identifier, as it would appear in prose.
 *
 * Four shapes, and the first is the one this whole layer exists for:
 *   campaign.adjudication.ADJ-AVP   a dotted observable path
 *   ev:844ad06a...                  an evidence id
 *   study:campaign-topo-hodge@v1    a study id
 *   spec:c8ac36e7...                a content hash
 * Plus the registry families: H-avp, K-err, E30, S16, T12, W4.4, X1, A1.
 */
export const MACHINE_ID_PATTERNS = Object.freeze([
  { name: "dotted observable path", re: /\b[a-z][a-z0-9_]*(?:\.[A-Za-z0-9_-]+){2,}\b/ },
  { name: "evidence id", re: /\bev:[0-9a-f]{8,}\b/ },
  { name: "store-scheme id", re: /\b(?:study|spec|ds|verifier|code):[0-9a-z]/ },
  { name: "registry identifier", re: /(?<![\w-])(?:[HKE]-[a-z][a-z0-9-]*|[EWSTXA]\d+(?:\.\d+)?)(?![\w-])/ },
]);

/** The first machine identifier in a string, or null. */
export function findMachineId(text) {
  if (typeof text !== "string") return null;
  for (const { name, re } of MACHINE_ID_PATTERNS) {
    const m = text.match(re);
    if (m) return { kind: name, match: m[0] };
  }
  return null;
}

/**
 * An absolute local path. Acceptance: nothing generated here carries one, so a
 * claim file is the same bytes on this machine and on a runner.
 */
export const ABSOLUTE_PATH_RE = /(?:^|[\s"'(=])(?:\/home\/|\/Users\/|\/tmp\/|[A-Za-z]:\\)/;

/** HANDOFF.md §8 rule 6. A null marker in a table cell is not prose. */
export const EM_DASH_RE = /—/;

const REQUIRED_ALWAYS = [
  "slug",
  "label",
  "statement",
  "type",
  "scope",
  "limitation",
  "humanSource",
  "immutableIds",
  "contentHash",
];

/**
 * The per-type requirements, straight from the type's own definition.
 *
 * `needs` are fields that must be present and non-empty. `forbids` are fields
 * a claim of this type must NOT carry, which is how `interpretation` and
 * `open-hypothesis` are prevented from inheriting the visual certainty of a
 * measured result: they cannot carry a quantity, so no renderer can give them
 * one.
 */
export const TYPE_RULES = Object.freeze({
  definition: {
    needs: [],
    oneOf: [["sourceUrl", "artifact"]],
    forbids: ["quantity", "status"],
    why: "a definition needs a source or a canonical project contract",
  },
  "software-capability": {
    needs: ["artifact", "sourceUrl"],
    forbids: [],
    why: "a capability claim needs a released API (artifact) and a working example (sourceUrl)",
  },
  "fixture-qualification": {
    needs: ["subject", "comparator"],
    forbids: [],
    why: "a fixture qualification needs the exact fixture (subject) and the acceptance check (comparator)",
  },
  "measured-result": {
    needs: ["subject", "quantity", "comparator", "humanSource"],
    forbids: [],
    why: "a measured result needs subject, quantity, unit, comparator, scope, source and limitation",
  },
  "derived-result": {
    needs: ["subject", "quantity", "comparator", "humanSource", "artifact"],
    forbids: [],
    why: "a derived result needs everything a measured result needs plus the transform, which is the artifact field",
  },
  interpretation: {
    needs: [],
    forbids: ["quantity"],
    why: "an interpretation must not inherit the visual certainty of a measured result, so it carries no quantity",
  },
  "open-hypothesis": {
    needs: [],
    forbids: ["quantity"],
    why: "an open hypothesis states no measurement, so it carries no quantity",
  },
  limitation: {
    needs: [],
    forbids: ["quantity", "status"],
    why: "a limitation states what is not established and carries no measurement",
  },
});

/**
 * The marker an open hypothesis's statement must begin with.
 *
 * "Future or conditional language only" is not checkable as a grammar. It is
 * checkable as a required frame, and a frame is stronger: a reader meets the
 * conditional before the sentence rather than having to infer it from a mood.
 */
export const OPEN_HYPOTHESIS_PREFIX = "Registered prediction, not resolved:";

const isBlank = (v) =>
  v === undefined ||
  v === null ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0);

export const PROSE_FIELDS = Object.freeze([
  "label",
  "statement",
  "scope",
  "limitation",
  "humanSource",
  "subject",
  "comparator",
]);

/**
 * Validate one claim. Returns an array of problem strings; empty means valid.
 * Never throws, so a generator can report every problem in one pass rather
 * than one per run.
 */
export function claimProblems(claim, where = "claim") {
  const p = [];
  const at = (field) => `${where}${claim && claim.slug ? ` (${claim.slug})` : ""}: ${field}`;

  if (!claim || typeof claim !== "object") return [`${where}: not an object`];

  for (const field of REQUIRED_ALWAYS) {
    if (isBlank(claim[field])) {
      p.push(at(`required field "${field}" is missing or empty`));
    }
  }

  if (claim.type && !CLAIM_TYPES.includes(claim.type)) {
    p.push(at(`type "${claim.type}" is not one of ${CLAIM_TYPES.join(", ")}`));
  }
  if (claim.status !== undefined && !CLAIM_STATUSES.includes(claim.status)) {
    p.push(
      at(
        `status "${claim.status}" is not one of ${CLAIM_STATUSES.join(", ")}. ` +
          `The store's own words are ${Object.keys(OUTCOME_TO_STATUS).join(", ")}; ` +
          `"mixed" has no member here on purpose and must not be folded into one.`,
      ),
    );
  }
  if (claim.slug !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(claim.slug))) {
    p.push(at(`slug "${claim.slug}" is not a lowercase hyphenated identifier`));
  }

  const rule = TYPE_RULES[claim.type];
  if (rule) {
    for (const field of rule.needs) {
      if (isBlank(claim[field])) {
        p.push(at(`type "${claim.type}" requires "${field}": ${rule.why}`));
      }
    }
    for (const group of rule.oneOf ?? []) {
      if (group.every((f) => isBlank(claim[f]))) {
        p.push(at(`type "${claim.type}" requires one of ${group.join(" or ")}: ${rule.why}`));
      }
    }
    for (const field of rule.forbids ?? []) {
      if (!isBlank(claim[field])) {
        p.push(at(`type "${claim.type}" must not carry "${field}": ${rule.why}`));
      }
    }
  }

  if (claim.quantity) {
    const q = claim.quantity;
    if (isBlank(q.name)) p.push(at(`quantity.name is missing`));
    if (q.value === undefined || q.value === null || q.value === "") {
      p.push(at(`quantity.value is missing`));
    }
    if (!("unit" in q)) {
      p.push(
        at(
          `quantity.unit is absent. A unit-free quantity states null explicitly; ` +
            `an absent key is an unanswered question.`,
        ),
      );
    }
    if (typeof q.value === "number" && !Number.isFinite(q.value)) {
      p.push(at(`quantity.value is not finite`));
    }
  }

  if (claim.type === "open-hypothesis" && typeof claim.statement === "string") {
    if (!claim.statement.startsWith(OPEN_HYPOTHESIS_PREFIX)) {
      p.push(
        at(
          `an open hypothesis's statement must begin with "${OPEN_HYPOTHESIS_PREFIX}", ` +
            `so a reader meets the conditional before the sentence.`,
        ),
      );
    }
  }

  // Every field a normal disclosure can render, not only humanSource. The
  // whole point of the layer is that a visitor never has to decode
  // `campaign.adjudication.ADJ-AVP`, and a machine id smuggled into `scope`
  // reaches the same reader by the same route.
  for (const field of PROSE_FIELDS) {
    const v = claim[field];
    if (typeof v !== "string") continue;
    const machine = findMachineId(v);
    if (machine) {
      p.push(
        at(
          `${field} carries a ${machine.kind} ("${machine.match}"). It is prose a reader ` +
            `does not decode; machine ids go in immutableIds and are never shown in a normal disclosure.`,
        ),
      );
    }
    if (EM_DASH_RE.test(v)) p.push(at(`${field} contains an em dash (HANDOFF.md §8 rule 6)`));
  }

  for (const [k, v] of Object.entries(claim)) {
    if (typeof v === "string" && ABSOLUTE_PATH_RE.test(v)) {
      p.push(at(`${k} carries an absolute local path, which does not reproduce off this machine`));
    }
  }

  if (Array.isArray(claim.immutableIds)) {
    for (const id of claim.immutableIds) {
      if (typeof id !== "string" || id.trim() === "") {
        p.push(at(`immutableIds carries an empty entry`));
      }
    }
  }

  return p;
}

/** Throw on the first invalid claim, naming every problem it has. */
export function requireValidClaim(claim, where = "claim") {
  const p = claimProblems(claim, where);
  if (p.length) {
    throw new Error(
      `Invalid public claim.\n  ${p.join("\n  ")}\n` +
        `  Claims are generated by scripts/build_claims.mjs. Fix the adapter or its source, ` +
        `never the generated file.`,
    );
  }
  return claim;
}

/**
 * The technical provenance string the secondary affordance copies.
 *
 * One place, so the disclosure, the gate and the tests agree on exactly what
 * the button puts on the clipboard.
 */
export function technicalProvenance(claim) {
  const lines = [`claim: ${claim.slug}`, `type: ${claim.type}`];
  if (claim.status) lines.push(`status: ${claim.status}`);
  if (claim.quantity) {
    lines.push(
      `quantity: ${claim.quantity.name} = ${claim.quantity.value}` +
        (claim.quantity.unit ? ` ${claim.quantity.unit}` : ""),
    );
  }
  for (const id of claim.immutableIds) lines.push(`id: ${id}`);
  lines.push(`contentHash: ${claim.contentHash}`);
  return lines.join("\n");
}

/**
 * The fields a NORMAL disclosure may render as text. Anything outside this set
 * is either chrome or technical provenance, and technical provenance is never
 * in the normal state.
 */
export const PUBLIC_DISCLOSURE_FIELDS = Object.freeze([
  "humanSource",
  "scope",
  "limitation",
]);
