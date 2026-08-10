/**
 * The archive's derived views. Underscore-prefixed, so Astro leaves it out of
 * the routing manifest.
 *
 * THE COUNTING RULE THAT MUST NOT BE BROKEN. The 53-row ledger and the 17-row
 * headline set are different counts of different things. They are not summed,
 * not mixed, and no aggregate "N of M predictions held" is published in either
 * form, because the summarising sentence was never preregistered and the
 * ledger itself says so. Each count is exported separately and each page
 * states which one it is showing.
 *
 * THE HEADLINE SET. One directional call per card (the first hypothesis
 * carrying a pre-run probability that is not an interval prediction) plus
 * every interval prediction, keeping only rows with an observed value. That is
 * `brier_hypotheses() + interval_hypotheses()` from the campaign's own
 * registry.py:1374-1407, reproduced against ledger.json, and it returns the
 * same 17 rows in the same order as the vendored figure.
 *
 * THE MARGIN. `margin_to_threshold` is ported from
 * reward-lens-campaign/campaign/reporting/figures.py:172-219 rather than
 * reinvented: a positive margin always means the prediction held, p-valued
 * metrics use log10(threshold/p), and everything else is divided by half the
 * registered interval width when the companions exist, else by |threshold|.
 * The margin is a POSITION on an axis here. It is never rendered as a number,
 * because it resolves to no evidence record; what renders is the observed
 * value and the frozen threshold, and both are in the adjudication record.
 */
import cards from "@data/cards.json";
import ledger from "@data/ledger.json";

export type Outcome = "confirmed" | "refuted" | "inconclusive";

type Card = (typeof cards)[number];
type LedgerRow = (typeof ledger)[number];

export const cardOrder = cards.map((c) => c.card);
export const cardByName = new Map(cards.map((c) => [c.card, c]));

/* ---------------------------------------------------------------------------
   The ledger: 53 rows, in the campaign's own order.
   --------------------------------------------------------------------------- */

export const ledgerRows = ledger;
export const ledgerCounts = {
  total: ledger.length,
  confirmed: ledger.filter((r) => r.outcome === "confirmed").length,
  refuted: ledger.filter((r) => r.outcome === "refuted").length,
  inconclusive: ledger.filter((r) => r.outcome === "inconclusive").length,
};

/* ---------------------------------------------------------------------------
   The headline set: 17 rows, a different count of a different thing.
   --------------------------------------------------------------------------- */

const isPMetric = (metric: string) =>
  metric.endsWith("_p") || metric.endsWith("p_value");

const rawMargin = (comparator: string, threshold: number, value: number) => {
  switch (comparator) {
    case ">":
    case ">=":
      return value - threshold;
    case "<":
    case "<=":
      return threshold - value;
    case "==":
      return -Math.abs(value - threshold);
    case "!=":
      return Math.abs(value - threshold);
    case "abs<":
      return threshold - Math.abs(value);
    case "abs>":
      return Math.abs(value) - threshold;
    default:
      throw new Error(`log/_campaign: unknown comparator ${comparator}`);
  }
};

const marginToThreshold = (
  metric: string,
  comparator: string,
  threshold: number,
  value: number,
  ci: [number, number] | null,
): number => {
  if (isPMetric(metric)) {
    const m = Math.log10(
      Math.max(threshold, 1e-300) / Math.max(value, 1e-300),
    );
    return comparator === ">" || comparator === ">=" ? -m : m;
  }
  const raw = rawMargin(comparator, threshold, value);
  if (ci) {
    const half = (ci[1] - ci[0]) / 2;
    if (Number.isFinite(half) && half > 0) return raw / half;
  }
  const scale = threshold !== 0 ? Math.abs(threshold) : 1;
  return raw / scale;
};

export interface HeadlineRow {
  /** The card's public title. Never the internal identifier. */
  label: string;
  slug: string;
  hypothesis: string;
  metric: string;
  comparator: string;
  threshold: number;
  observed: number;
  outcome: Outcome;
  interval: boolean;
  margin: number;
  ciMargins: [number, number] | null;
  evidenceId: string;
}

const companionCi = (card: Card | undefined, metric: string) => {
  const comp = (card?.companion_metrics ?? {}) as Record<string, number>;
  const lo = comp[`${metric}_ci_low`];
  const hi = comp[`${metric}_ci_high`];
  if (
    typeof lo === "number" &&
    typeof hi === "number" &&
    Number.isFinite(lo) &&
    Number.isFinite(hi) &&
    hi > lo
  ) {
    return [lo, hi] as [number, number];
  }
  return null;
};

const buildHeadlines = (): HeadlineRow[] => {
  const seen = new Set<string>();
  const directional: LedgerRow[] = [];
  for (const r of ledger) {
    if (
      r.registered_prob !== null &&
      r.interval_prediction === null &&
      !seen.has(r.card)
    ) {
      seen.add(r.card);
      directional.push(r);
    }
  }
  const intervals = ledger.filter((r) => r.interval_prediction !== null);

  const picks: { row: LedgerRow; interval: boolean }[] = [
    ...directional.map((row) => ({ row, interval: false })),
    ...intervals.map((row) => ({ row, interval: true })),
  ].filter((p) => p.row.observed !== null);

  picks.sort((a, b) => {
    const ai = cardOrder.indexOf(a.row.card);
    const bi = cardOrder.indexOf(b.row.card);
    if (ai !== bi) return ai - bi;
    return Number(a.interval) - Number(b.interval);
  });

  return picks.map(({ row, interval }) => {
    const card = cardByName.get(row.card);
    const observed = row.observed as number;
    const ci = interval ? null : companionCi(card, row.metric);
    const margin = marginToThreshold(
      row.metric,
      row.comparator,
      row.threshold,
      observed,
      ci,
    );
    let ciMargins: [number, number] | null = null;
    if (ci && !isPMetric(row.metric) && [">", ">=", "<", "<="].includes(row.comparator)) {
      const scale =
        (ci[1] - ci[0]) / 2 > 0
          ? (ci[1] - ci[0]) / 2
          : row.threshold !== 0
            ? Math.abs(row.threshold)
            : 1;
      const ends = ci
        .map((e) => rawMargin(row.comparator, row.threshold, e) / scale)
        .sort((a, b) => a - b);
      ciMargins = [ends[0], ends[1]];
    }
    if (!card) {
      throw new Error(`log/_campaign: no card for ledger row ${row.card}`);
    }
    return {
      label: card.title,
      slug: card.id,
      hypothesis: row.hypothesis_id,
      metric: row.metric,
      comparator: row.comparator,
      threshold: row.threshold,
      observed,
      outcome: row.outcome as Outcome,
      interval,
      margin,
      ciMargins,
      evidenceId: card.adjudication_ev,
    };
  });
};

export const headlineRows = buildHeadlines();
export const headlineCount = headlineRows.length;

/* The display clip, from figures.py:165. A margin beyond it is drawn at the
   edge; the row still carries its observed value and its frozen line in text,
   so nothing is lost to the clip. */
export const HERO_CLIP = 5;

/* ---------------------------------------------------------------------------
   Formatting shared by the archive's pages.
   --------------------------------------------------------------------------- */

export const fmt = (n: number | null | undefined): string | null => {
  if (n === null || n === undefined) return null;
  if (Number.isInteger(n)) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-3 || a >= 1e4)) return n.toExponential(3);
  return String(Number(n.toPrecision(4)));
};

export const day = (iso: string): string => iso.slice(0, 10);
