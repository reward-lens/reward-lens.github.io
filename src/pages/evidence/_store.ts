/**
 * The evidence store, read at build time, with the three shapes a naive reader
 * gets wrong handled once here rather than in five pages.
 *
 * Underscore-prefixed, so Astro leaves it out of the routing manifest.
 *
 * WHAT THE STORE ACTUALLY LOOKS LIKE (GROUND-TRUTH.md C-24,
 * components/evidence-record.md "Data and state space"):
 *
 *   1. Nested values are wrapped in sentinel envelopes. A map is
 *      `{"__map__": {...}}` and a list is `{"__seq__": [...]}`. Those are
 *      literal keys in the JSON. `unwrap` removes them; nothing renders them.
 *   2. `uncertainty` is PRESENT and NULL-VALUED on all 27 adjudication
 *      records: ci_low, ci_high, ci_level, n, n_effective and seed_spread are
 *      null and `method` is the string "none". That renders as
 *      copy.yaml:ui.no_value, never as blank and never as zero.
 *   3. `trust` is an INTEGER (2 on every record). It is the 0-based rung index
 *      of the library's TrustLevel enum, and the rung NAME is what a reader
 *      and a screen reader get. The names come from the generated
 *      refusals.json, never from a literal here.
 *
 * A NOTE ON src/data/evidence-records.json. P1 emits it with `trust: "2"`,
 * the raw integer as a string, where provenance-chip expects the rung name
 * ("registered"): the chip renders `trust 2` and picks up no --trust-* colour,
 * because it keys its swatch off `data-trust="registered"`. `chipRecord()`
 * below overrides that field at the point of use so this packet's chips are
 * right; the generated file is P1's to fix.
 */
import refusals from "@data/refusals.json";
import { ui } from "../../copy";

/* -------------------------------------------------------------------------
   Reading the store
   ------------------------------------------------------------------------- */

const storeFiles = import.meta.glob<string>(
  "../../data/claims-store/*.jsonl",
  { eager: true, query: "?raw", import: "default" },
);

const storeText = storeFiles["../../data/claims-store/evidence.jsonl"];
if (!storeText) {
  throw new Error(
    "evidence/_store.ts: src/data/claims-store/evidence.jsonl is missing. " +
      "The 27 record pages are generated from it; there is no fallback.",
  );
}

export interface Cost {
  gpu_seconds: number;
  tokens: number;
  wall_seconds: number;
}

export interface StoreRecord {
  id: string;
  observable: string;
  observable_version: string;
  subject: {
    signals: unknown[];
    dataset: unknown;
    readout: unknown;
    frame: unknown;
    interventions: unknown[];
    extra: Record<string, string>;
  };
  value: unknown;
  uncertainty: Record<string, number | string | null>;
  gauge: string | null;
  calibration: unknown;
  trust: number;
  provenance: {
    git_sha: string;
    config_hash: string | null;
    seeds: unknown[];
    cost: Cost;
    oracle_calls: unknown[];
    parents: string[];
    study: string;
    extra: Record<string, string>;
  };
  created_at: string;
}

export const records: StoreRecord[] = storeText
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as StoreRecord);

export const bareId = (id: string): string => id.replace("ev:", "");
export const recordHref = (id: string): string => `/evidence/${bareId(id)}/`;

/* -------------------------------------------------------------------------
   The sentinel envelopes
   ------------------------------------------------------------------------- */

type Envelope = { __map__?: Record<string, unknown>; __seq__?: unknown[] };

/** Strip one layer of `{"__map__": …}` / `{"__seq__": […]}`, recursively. */
export const unwrap = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(unwrap);
  if (value && typeof value === "object") {
    const env = value as Envelope;
    if ("__map__" in env) return unwrap(env.__map__ ?? {});
    if ("__seq__" in env) return unwrap(env.__seq__ ?? []);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        unwrap(v),
      ]),
    );
  }
  return value;
};

/** Every leaf key path in a record, so a page can assert it dropped nothing. */
export const leafPaths = (value: unknown, prefix = ""): string[] => {
  if (Array.isArray(value)) {
    if (value.length === 0) return [prefix];
    return value.flatMap((v, i) => leafPaths(v, `${prefix}[${i}]`));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return [prefix];
    return entries.flatMap(([k, v]) =>
      leafPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix];
};

/* -------------------------------------------------------------------------
   The trust rung
   ------------------------------------------------------------------------- */

const rungNames = new Map<number, string>(
  refusals.trustLadder.map((l) => [l.rung, l.name]),
);

/** The store's integer rung as the word the ladder gives it. */
export const trustName = (trust: number, who: string): string => {
  const name = rungNames.get(trust);
  if (!name) {
    throw new Error(
      `${who}: trust rung ${trust} is not one of the library's ` +
        `${refusals.trustLadder.length} (${refusals.trustLadder
          .map((l) => `${l.rung} ${l.name}`)
          .join(", ")}). ` +
        `src/data/refusals.json is the source; the integer is never rendered.`,
    );
  }
  return name;
};

/* -------------------------------------------------------------------------
   Formatting
   ------------------------------------------------------------------------- */

/** A number as the record states it, never re-rounded past four figures. */
export const num = (n: number): string => {
  if (Number.isInteger(n)) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-3 || a >= 1e4)) return n.toExponential(3);
  return String(Number(n.toPrecision(4)));
};

/** A scalar for display. `null` is the absence the copy has a word for. */
export const scalar = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return ui.no_value;
  if (typeof v === "number") return num(v);
  if (typeof v === "boolean") return String(v);
  return String(v);
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "19 July 2026", from the record's own ISO timestamp. */
export const longDate = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export const isoDay = (iso: string): string => iso.slice(0, 10);

/* -------------------------------------------------------------------------
   The index, and the override every provenance chip on this packet's pages
   passes so the panel states a rung rather than an integer.
   ------------------------------------------------------------------------- */

const byId = new Map(records.map((r) => [r.id, r]));

export const storeRecord = (id: string): StoreRecord | undefined => byId.get(id);

export const chipRecord = (
  id: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => {
  const rec = byId.get(id);
  return {
    ...(rec ? { trust: trustName(rec.trust, "evidence/_store") } : {}),
    ...extra,
  };
};
