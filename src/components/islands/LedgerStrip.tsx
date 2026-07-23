import { useEffect, useRef, useState } from "react";
import "./LedgerStrip.css";

// One mark per adjudicated hypothesis, in frozen-registry order. The strip is
// the site's one orchestrated animation: a single left-to-right draw on first
// view, instant everywhere else. Colors come from the status tokens; kills
// carry a notch cut into the mark.

export interface StripRow {
  card: string;
  slug: string;
  h: string;
  statement: string;
  metric: string;
  comparator: string;
  threshold: number;
  prob: number | null;
  observed: number | null;
  outcome: "confirmed" | "refuted" | "inconclusive";
  kill: string | null;
}

const OUTCOME_COLOR: Record<StripRow["outcome"], string> = {
  confirmed: "var(--ok)",
  refuted: "var(--bad)",
  inconclusive: "var(--none)",
};

const OUTCOME_GLYPH: Record<StripRow["outcome"], string> = {
  confirmed: "✓",
  refuted: "✕",
  inconclusive: "○",
};

function fmt(n: number | null): string {
  if (n === null) return "not measured";
  if (Number.isInteger(n)) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-3 || a >= 1e4)) return n.toExponential(2);
  return String(Number(n.toPrecision(4)));
}

export default function LedgerStrip({
  rows,
  animate = true,
}: {
  rows: StripRow[];
  animate?: boolean;
}) {
  const [drawn, setDrawn] = useState(false);
  const [tip, setTip] = useState<{ row: StripRow; x: number } | null>(null);
  const [focusCard, setFocusCard] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let seen = false;
    try {
      seen = sessionStorage.getItem("ledger-drawn") === "1";
      sessionStorage.setItem("ledger-drawn", "1");
    } catch {
      /* private mode: animate anyway */
    }
    if (animate && !reduced && !seen) setDrawn(true);
    const applyHash = () => {
      const h = window.location.hash.replace("#", "");
      setFocusCard(rows.some((r) => r.slug === h) ? h : null);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [animate, rows]);

  const show = (row: StripRow, el: HTMLElement) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wb = wrap.getBoundingClientRect();
    const eb = el.getBoundingClientRect();
    setTip({ row, x: eb.left - wb.left + eb.width / 2 });
  };

  return (
    <div className={`ledger-strip${drawn ? " ledger-animate" : ""}`} ref={wrapRef}>
      <div className="ledger-marks" role="list" aria-label="53 adjudicated hypotheses">
        {rows.map((row, i) => {
          const dim = focusCard !== null && row.slug !== focusCard;
          return (
            <a
              role="listitem"
              key={`${row.card}-${row.h}`}
              href={`/campaign/${row.slug}/`}
              className={`ledger-mark${row.kill ? " ledger-kill" : ""}${dim ? " ledger-dim" : ""}`}
              style={
                {
                  background: OUTCOME_COLOR[row.outcome],
                  animationDelay: `${(i * 900) / rows.length}ms`,
                } as React.CSSProperties
              }
              aria-label={`${row.card} ${row.h}: ${row.outcome}${row.kill ? `, ${row.kill} fired` : ""}. ${row.metric} ${row.comparator} ${fmt(row.threshold)}, observed ${fmt(row.observed)}.`}
              onMouseEnter={(e) => show(row, e.currentTarget)}
              onFocus={(e) => show(row, e.currentTarget)}
              onMouseLeave={() => setTip(null)}
              onBlur={() => setTip(null)}
            />
          );
        })}
      </div>

      {tip && (
        <div
          className="ledger-tip"
          role="status"
          style={{ left: `${tip.x}px` }}
        >
          <span className="ledger-tip-head">
            {tip.row.card} · {tip.row.h}
          </span>
          <span className="ledger-tip-line">
            registered {tip.row.metric} {tip.row.comparator}{" "}
            {fmt(tip.row.threshold)}
            {tip.row.prob !== null ? ` at p ${tip.row.prob}` : ""}
          </span>
          <span className="ledger-tip-line">
            observed {fmt(tip.row.observed)} ·{" "}
            {OUTCOME_GLYPH[tip.row.outcome]} {tip.row.outcome}
            {tip.row.kill ? ` · ${tip.row.kill} fired` : ""}
          </span>
        </div>
      )}

      <table className="visually-hidden">
        <caption>
          The 53 adjudicated hypotheses: card, hypothesis, registered
          prediction, observed value, outcome.
        </caption>
        <thead>
          <tr>
            <th>Card</th>
            <th>Hypothesis</th>
            <th>Registered</th>
            <th>Observed</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`t-${row.card}-${row.h}`}>
              <td>{row.card}</td>
              <td>{row.h}</td>
              <td>
                {row.metric} {row.comparator} {fmt(row.threshold)}
              </td>
              <td>{fmt(row.observed)}</td>
              <td>
                {row.outcome}
                {row.kill ? `, ${row.kill} fired` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
