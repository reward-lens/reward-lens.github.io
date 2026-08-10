/** Types for guards.mjs, which is plain ESM so `node --test` can run it. */
export declare const FROZEN_REFUSAL_REASONS: readonly string[];
export declare const VERSION_RE: RegExp;
export declare const CALLOUT_VARIANTS: readonly string[];

export declare const requireRemedy: (remedy: string, quantity: string) => string;
export declare const requireRefusalReason: (
  reason: string,
  quantity: string,
  known?: readonly string[],
) => string;
export declare const requireVersion: (
  value: string,
  who: string,
  prop: string,
) => string;
export declare const versionDirection: (
  describes: string,
  released: string,
  published?: readonly string[],
) => "none" | "behind" | "unpublished";
export declare const requireColumnKeys: <R extends Record<string, unknown>>(
  caption: string,
  columns: { key: string }[],
  rows: R[],
) => R[];
export declare const requireCalloutVariant: (
  variant: string,
  label: string,
) => string;
export declare const requireTrustRung: (
  level: string,
  levels: readonly string[],
  who: string,
) => number;
