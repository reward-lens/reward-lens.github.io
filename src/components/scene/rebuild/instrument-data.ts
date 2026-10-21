/** The public state contract for the decorative lagoon apparatus. */
export const INSTRUMENT_STAGES = ["reward", "pressure", "update", "response", "comparison"] as const;

export type InstrumentStage = (typeof INSTRUMENT_STAGES)[number];
export type InstrumentStatus = "poster" | "preparing" | "ready" | "active" | "suspended" | "fallback";
export type LagoonTheme = "dark" | "light";

export interface InstrumentStageCopy {
  label: string;
  short: string;
  detector: string;
  scope: string;
  missing: string;
  remedy: string;
  href: string;
  entryId?: string;
  /** Preserved bridge state for the established instrument/report surface. */
  bridgeState: "scorer" | "selection" | "response" | "run-boundary";
}

/**
 * These descriptions are controls for a report-facing interface. The room is
 * an optical illustration, never a chart or a substitute for a measurement.
 */
export const STAGE_COPY: Record<InstrumentStage, InstrumentStageCopy> = {
  reward: {
    label: "Reward",
    short: "Finding in code-reward-v1",
    detector: "The grader reads a test file the response can edit.",
    scope: "Bundled example · validity.writable_then_read",
    missing: "The finding is about evaluator validity, not a measured policy outcome.",
    remedy: "Inspect the error and protect the outcome check before comparing versions.",
    href: "/report/?record=code-reward-v1&entry=validity.writable_then_read",
    entryId: "validity.writable_then_read",
    bridgeState: "scorer",
  },
  pressure: {
    label: "Pressure",
    short: "Selection pressure",
    detector: "This record does not measure which responses training selected.",
    scope: "Missing measurement · trace.instrument_absent",
    missing: "No training trace, grouping record, or applied update weight belongs to this case.",
    remedy: "Attach grouping, normalization, selection, and applied-update records to measure pressure.",
    href: "/report/?record=code-reward-v1&entry=trace.instrument_absent",
    entryId: "trace.instrument_absent",
    bridgeState: "selection",
  },
  update: {
    label: "Update",
    short: "Applied update",
    detector: "This case has no measured parameter update.",
    scope: "Missing update · run and checkpoint records needed",
    missing: "An absent update record is not a zero update. This case audits a grader on a fixed response bank.",
    remedy: "Attach the named run, applied weights, and before/after checkpoints to inspect an update.",
    href: "/examples/code-reward/#next",
    bridgeState: "response",
  },
  response: {
    label: "Response",
    short: "Policy response",
    detector: "No policy change has been measured for this case.",
    scope: "Missing policy measurement · controlled comparison pending",
    missing: "The absent update is not zero, and no policy response or useful-task outcome is recorded.",
    remedy: "Measure a named applied update against an independent outcome check.",
    href: "/examples/code-reward/#next",
    bridgeState: "response",
  },
  comparison: {
    label: "Comparison",
    short: "Illustrative comparison path",
    detector: "A candidate needs the same response bank and an independent outcome check.",
    scope: "Illustrative procedure · no candidate result is shown",
    missing: "This interface does not calculate or display a new empirical result.",
    remedy: "Choose the comparison scope, then record both outcome and useful-task cost.",
    href: "/#compare",
    bridgeState: "run-boundary",
  },
};

export const DEFAULT_STAGE: InstrumentStage = "reward";
export const REPORT_HREF = "/report/?record=code-reward-v1&entry=validity.writable_then_read";

export function isInstrumentStage(value: string | null | undefined): value is InstrumentStage {
  return Boolean(value && INSTRUMENT_STAGES.includes(value as InstrumentStage));
}

export const isLoopback = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

export function posterHref(theme: LagoonTheme, mobile: boolean, width = 1440): string {
  const form = mobile ? "mobile" : "desktop";
  return `/lagoon/poster-${theme}-${form}-${width}.webp`;
}
