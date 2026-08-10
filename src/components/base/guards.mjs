/**
 * The build-failure guards, in plain ESM so `node --test` can run them without
 * a TypeScript loader. `data.ts` re-exports every one of them, so a component
 * imports from one place and the tests exercise the same code the build runs.
 *
 * Several contracts specify a build failure where another design would have
 * put an empty state. Each guard below names the contract it comes from,
 * because a thrown error a reader cannot trace back is only half a gate.
 */

/**
 * The seventeen refusal reasons.
 *
 * GROUND-TRUTH.md C-10, from reward_lens/core/reading.py:33, pinned by
 * tests/acceptance/test_w1_kernel.py:470 and test_w5_docs_catalogue.py:191.
 * The count is seventeen and not sixteen: the kernel documentation page is one
 * amendment behind (E48 added QUANTITY_UNDEFINED after E30 added
 * RECORD_INCOMPLETE), and the site uses the enum rather than the prose.
 *
 * When P1 generates src/data/refusals.json this list stops being consulted.
 */
export const FROZEN_REFUSAL_REASONS = [
  "ACCESS_INSUFFICIENT",
  "RECORD_INCOMPLETE",
  "SUBSTRATE_MISMATCH",
  "PHASE_MISMATCH",
  "ENVELOPE_VIOLATED",
  "BELOW_LOD",
  "ABOVE_LOD_BELOW_LOQ",
  "ESS_BELOW_FLOOR",
  "NO_MATCHED_CONTROL",
  "GAUGE_MISMATCH",
  "UNIT_MISMATCH",
  "REFERENCE_UNCERTIFIED",
  "LABEL_QUALITY_UNKNOWN",
  "PLAN_NOT_CLOSED",
  "BUDGET_EXCEEDED",
  "VOID",
  "QUANTITY_UNDEFINED",
];

/** A version string as design/schemas/release.schema.json defines one. */
export const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;

/**
 * components/refusal-card.md: remedy is required and "if absent, this is a
 * build failure", mirroring the library's own __post_init__ guard. The message
 * names the quantity, which is acceptance criterion 1.
 */
export const requireRemedy = (remedy, quantity) => {
  if (typeof remedy !== "string" || remedy.trim() === "") {
    throw new Error(
      `refusal-card: quantity "${quantity}" has an empty remedy. ` +
        `components/refusal-card.md: remedy is required and "if absent, this is a build ` +
        `failure", mirroring the library's own __post_init__ guard. A refusal with no ` +
        `remedy is a tool that looks broken instead of a tool that looks careful.`,
    );
  }
  return remedy;
};

/**
 * components/refusal-card.md acceptance criterion 2: a chip showing a reason
 * not in the enum fails the build.
 */
export const requireRefusalReason = (reason, quantity, known = FROZEN_REFUSAL_REASONS) => {
  if (!known.includes(reason)) {
    throw new Error(
      `refusal-card: reason "${reason}" on quantity "${quantity}" is not one of the ` +
        `${known.length} members of RefusalReason. ` +
        `components/refusal-card.md acceptance criterion 2.`,
    );
  }
  return reason;
};

/**
 * components/version-chip.md: a describes value that is not a valid version
 * string fails the build.
 */
export const requireVersion = (value, who, prop) => {
  if (typeof value !== "string" || !VERSION_RE.test(value)) {
    throw new Error(
      `${who}: ${prop}="${value}" is not a version string. ` +
        `components/version-chip.md: a describes value that is not a valid version ` +
        `string fails the build.`,
    );
  }
  return value;
};

/**
 * components/version-chip.md: the direction is DERIVED, never passed. A page
 * that can pass the direction in is a page that can pass the wrong one in.
 *
 * `behind`      the index has published this version and moved past it
 * `unpublished` the index has never seen it
 * `none`        it is the release, and the chip renders nothing at all
 */
export const versionDirection = (describes, released, published = []) => {
  if (describes === released) return "none";
  return published.includes(describes) ? "behind" : "unpublished";
};

/**
 * components/data-table.md acceptance criterion 5: a row missing a declared
 * column key fails the build, naming the row and the key. A cell that was not
 * measured is `null`, which is present; only an absent key is an error.
 */
export const requireColumnKeys = (caption, columns, rows) => {
  rows.forEach((row, i) => {
    for (const col of columns) {
      if (!(col.key in row)) {
        throw new Error(
          `data-table "${caption}": row ${i} is missing the declared column key ` +
            `"${col.key}". Row keys present: ${Object.keys(row).join(", ")}. ` +
            `components/data-table.md acceptance criterion 5.`,
        );
      }
    }
  });
  return rows;
};

/**
 * components/callout.md acceptance criterion 1: a variant outside the three
 * fails the build naming the value. There is no warning variant, no danger
 * variant and no tip variant, and the set does not grow.
 */
export const CALLOUT_VARIANTS = ["note", "scope", "aside"];

export const requireCalloutVariant = (variant, label) => {
  if (!CALLOUT_VARIANTS.includes(variant)) {
    throw new Error(
      `callout "${label}": variant "${variant}" is not one of ` +
        `${CALLOUT_VARIANTS.join(", ")}. components/callout.md acceptance criterion 1.`,
    );
  }
  return variant;
};

/**
 * components/trust-badge.md acceptance criterion 1: a level outside the four
 * names fails the build with a message naming the value. Returns the 1-based
 * rung, which is what maps a level onto --trust-1 … --trust-4.
 */
export const requireTrustRung = (level, levels, who) => {
  const i = levels.indexOf(level);
  if (i < 0) {
    throw new Error(
      `${who}: trust level "${level}" is not one of the four the library defines ` +
        `(${levels.join(", ")}). components/trust-badge.md acceptance criterion 1.`,
    );
  }
  return i + 1;
};
