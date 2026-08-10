/**
 * Build-time data access and validation for the base components.
 *
 * Everything here runs in the frontmatter of an .astro component, which means
 * it runs once at build time on the server. A `throw` here is a build failure,
 * which is what most of these functions are for: several contracts specify
 * that a missing or unresolvable value must fail the build rather than render
 * a placeholder.
 *
 * WHERE THE DATA LIVES. The contracts say `data/release.json`. In this
 * repository generated JSON lives at `src/data/`, which `BUILD-PLAN.md` §2
 * assigns to packet P1 ("all generated JSON", `src/data/**`). So
 * `data/release.json` in a contract resolves to `src/data/release.json` here.
 * None of the files these loaders want exist yet; P1 generates them in wave 1.
 *
 * Files are reached through `import.meta.glob`, not `node:fs`. A glob is
 * resolved by Vite at transform time, so a file that does not exist is simply
 * absent from the map rather than a path that resolves differently in dev and
 * in build. `src/copy.ts` reaches `design/copy.yaml` the same way and for the
 * same reason.
 */
import { copy } from "../../copy";
import {
  FROZEN_REFUSAL_REASONS,
  requireRefusalReason as guardRefusalReason,
  requireTrustRung,
  requireVersion as guardVersion,
  VERSION_RE as GUARD_VERSION_RE,
} from "./guards.mjs";

// One import surface for the components; one testable module for the guards.
export {
  requireRemedy,
  requireColumnKeys,
  requireCalloutVariant,
  versionDirection,
  CALLOUT_VARIANTS,
} from "./guards.mjs";

/* -------------------------------------------------------------------------
   The generated files, as they are today: absent.
   ------------------------------------------------------------------------- */

const dataModules = import.meta.glob<{ default: unknown }>("../../data/*.json", {
  eager: true,
});

const dataFile = <T>(name: string): T | null => {
  const mod = dataModules[`../../data/${name}`];
  return mod ? (mod.default as T) : null;
};

/* -------------------------------------------------------------------------
   release.json  ·  schemas/release.schema.json
   Consumed by install-strip and version-chip. The schema's own description:
   "If this file is missing the build fails: the install strip must never
   render a placeholder version."
   ------------------------------------------------------------------------- */

export interface Release {
  latest: string;
  /**
   * The version tagged in the repository and not on the package index.
   * RENAMED from `rc` at build time, with the schema's pattern widened to
   * `^[0-9]+\.[0-9]+\.[0-9]+([a-z]+[0-9]+)?$` so that a bare `3.0.0`
   * validates: DECISIONS.md D-25 removed the rc marker at commit 2e75a0d, and
   * the old pattern rejected the only value this field will ever hold.
   */
  unpublished: string | null;
  unpublishedIsAhead?: boolean;
  requiresPython: string;
  releases: { version: string; uploadedAt: string }[];
  urls: Record<string, string | boolean>;
  changelogUrl?: string;
  fetchedAt: string;
}

export const releaseOrNull = (): Release | null =>
  dataFile<Release>("release.json");

export const requireRelease = (who: string): Release => {
  const r = releaseOrNull();
  if (!r) {
    throw new Error(
      `${who}: src/data/release.json is missing. The version it states comes from ` +
        `the package index and there is no placeholder for it (components/install-strip.md ` +
        `"Version row", components/version-chip.md "Data and state space"). ` +
        `Packet P1 generates this file; until it exists, pass the value explicitly.`,
    );
  }
  return r;
};

/** A version string as the release schema defines one: three dotted integers. */
export const VERSION_RE = GUARD_VERSION_RE;
export const requireVersion = guardVersion;

/* -------------------------------------------------------------------------
   The refusal reason enum
   Seventeen members. GROUND-TRUTH.md C-10 lists them from
   reward_lens/core/reading.py:33, pinned by two acceptance tests. When P1
   generates src/data/refusals.json the enum is read from there instead, so
   the site tracks the library rather than this list.
   ------------------------------------------------------------------------- */

export type RefusalReason = string;

interface RefusalsFile {
  reasons: { name: string }[] | string[];
}

export const refusalReasons = (): readonly string[] => {
  const file = dataFile<RefusalsFile>("refusals.json");
  if (!file) return FROZEN_REFUSAL_REASONS;
  return file.reasons.map((r) => (typeof r === "string" ? r : r.name));
};

export const requireRefusalReason = (reason: string, quantity: string): string =>
  guardRefusalReason(reason, quantity, refusalReasons());

/* -------------------------------------------------------------------------
   The trust ladder
   The four names are the library's and they come from copy.yaml, never from a
   component (components/trust-badge.md acceptance criterion 6).
   ------------------------------------------------------------------------- */

interface TrustLadderCopy {
  levels: { name: string; definition: string; licenses: string }[];
  unoccupied_note: string;
}

export const trustLadder = copy.trust_ladder as unknown as TrustLadderCopy;
export const trustLevels: readonly string[] = trustLadder.levels.map((l) => l.name);
export type TrustLevel = string;

/** 1-based rung index, which is what maps a level onto --trust-1 … --trust-4. */
export const trustRung = (level: string, who: string): number =>
  requireTrustRung(level, trustLevels, who);

/* -------------------------------------------------------------------------
   Evidence
   `data/evidence-index.json` exists today and maps an id onto a record stub.
   An id that does not resolve is a build failure
   (components/provenance-chip.md, properties table and criterion 2).

   The panel wants more than the index carries: the value, its uncertainty, the
   trust level, the subject and the generating commit. Those live in the
   evidence record itself, which P1 generates. Until then a caller may pass the
   record in. Nothing here invents a field: a field that is absent renders no
   row at all.
   ------------------------------------------------------------------------- */

export interface EvidenceStub {
  card?: string;
  slug?: string;
  observable?: string;
}

export interface EvidenceRecord extends EvidenceStub {
  /** The formatted value, as the record states it. Never re-rounded here. */
  value?: string;
  /** "± 0.004", "± not characterised". From the record, never composed here. */
  uncertainty?: string;
  trust?: string;
  subject?: string;
  source?: string;
  commit?: string;
  href?: string;
  /**
   * Extra rows, label to value, rendered in the panel and nowhere else. This is
   * where a refusal's `statistics` goes: components/refusal-card.md puts them
   * "in the provenance panel, not on the card face".
   */
  stats?: Record<string, string | number>;
}

const evidenceIndex = (): Record<string, EvidenceStub> =>
  dataFile<Record<string, EvidenceStub>>("evidence-index.json") ?? {};

const evidenceRecords = (): Record<string, EvidenceRecord> =>
  dataFile<Record<string, EvidenceRecord>>("evidence-records.json") ?? {};

export const resolveEvidence = (
  id: string,
  who: string,
  override: EvidenceRecord = {},
): EvidenceRecord => {
  const index = evidenceIndex();
  const stub = index[id];
  if (!stub) {
    throw new Error(
      `${who}: evidenceId "${id}" does not resolve against src/data/evidence-index.json ` +
        `(${Object.keys(index).length} ids). ` +
        `components/provenance-chip.md acceptance criterion 2: an evidenceId that does not ` +
        `resolve fails the build, naming the page and the id.`,
    );
  }
  return { ...stub, ...evidenceRecords()[id], ...override };
};

/* -------------------------------------------------------------------------
   data-table shapes.
   They live here rather than in the .astro file because the Astro compiler
   does not parse a leading-pipe union in component frontmatter, and because
   the gallery fixtures need them without importing a component.
   ------------------------------------------------------------------------- */

export interface Column {
  key: string;
  label: string;
  align?: "start" | "end";
  kind?: "text" | "number" | "percent-bar" | "state";
}

export interface CellObject {
  value: string | number | null;
  display?: string;
  evidenceId?: string | null;
  record?: EvidenceRecord;
}

export type Cell = string | number | null | CellObject;

export type Row = Record<string, Cell>;

/* -------------------------------------------------------------------------
   Copy sections these components read.
   ------------------------------------------------------------------------- */

export interface InstallCopy {
  command: string;
  aria: string;
  copy_label: string;
  copied_label: string;
  copied_announce: string;
  copy_unavailable: string;
  version_prefix: string;
  prerelease_suffix: string;
  version_aria: string;
  python_note: string;
}

export interface RefusalCopy {
  card_labels: {
    quantity: string;
    reason: string;
    missing: string;
    remedy: string;
    bound: string;
  };
  /** "refusal reason:". The chip's accessible name, not its visible label. */
  reason_aria_prefix: string;
  /**
   * The plain-language outcome beside a reason chip. The card derives which
   * one it is from the reading itself; it is never passed in, because the
   * greyscale acceptance criterion depends on this string being right.
   */
  state_labels: {
    evidence: string;
    refusal: string;
    bounded: string;
  };
}

export const install = copy.install as unknown as InstallCopy;
export const refusalCopy = copy.refusals as unknown as RefusalCopy;

/**
 * copy.yaml writes `{{released_version}}` and its siblings for values that are
 * not in the document. `src/copy.ts` deliberately leaves those alone, because
 * a path that does not exist in copy.yaml is not that file's to fill in. This
 * fills them from generated data at the point of use.
 */
export const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (whole, key: string) =>
    key in values ? values[key] : whole,
  );

/**
 * A DOM id that is unique on its page.
 *
 * Every base component derived its ids from its own content: the refusal card
 * from the quantity name, the install strip from size and version, the chip
 from its evidence id and field, the code block from its language and byte
 * count. Each of those is stable, greppable and reads well in the markup, and
 * each of them collides the moment a page renders the same content twice.
 *
 * That is not a tidiness problem. `/see/grader/` renders eight refusal cards
 * for the same quantity across four subjects and two access states, so eight
 * disclosure buttons carried `aria-controls="refusal-coverage-remedy"` and
 * `getElementById` handed all eight the first card's panel. The homepage
 * renders two install strips at the same size and version, so the second
 * strip's copy confirmation was announced into the first strip's live region,
 * off-screen from the control the reader had just pressed. Cross-wired
 * `aria-controls`, `aria-labelledby` and `aria-live` are the failure mode, and
 * none of it is visible in a screenshot.
 *
 * The first use of a stem on a page keeps that stem exactly, so every id that
 * was already unique is unchanged and still greppable; the second and later
 * uses get a numeric suffix. Keyed by pathname, so the count resets per page
 * rather than drifting across a 207-route build.
 */
const idsSeen = new Map<string, number>();
export const uniqueId = (stem: string, page: string): string => {
  const key = `${page}\u0000${stem}`;
  const n = (idsSeen.get(key) ?? 0) + 1;
  idsSeen.set(key, n);
  return n === 1 ? stem : `${stem}-${n}`;
};
