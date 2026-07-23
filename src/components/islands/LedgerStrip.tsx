import { useEffect, useRef, useState } from "react";
import "./LedgerStrip.css";

// One mark per adjudicated hypothesis, in frozen-registry order. The strip is
// the site's one orchestrated animation: a single left-to-right draw on first
// view, instant everywhere else.
//
// Keyboard model: the strip is ONE tab stop. Arrow keys move the active mark,
// Home/End jump, Enter opens the card page. Fifty-three separate 8px tab
// stops would be both unusable and an accessibility failure; the full data
// also lives in the visually-hidden table and on the hypothesis board.

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
  const [active, setActive] = useState<number | null>(null);
  const [tipX, setTipX] = useState(0);
  const [focusCard, setFocusCard] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const marksRef = useRef<HTMLDivElement>(null);

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

  const showAt = (i: number) => {
    setActive(i);
    const wrap = wrapRef.current;
    const mark = marksRef.current?.children[i] as HTMLElement | undefined;
    if (!wrap || !mark) return;
    const wb = wrap.getBoundingClientRect();
    const eb = mark.getBoundingClientRect();
    const x = eb.left - wb.left + eb.width / 2;
    setTipX(Math.min(Math.max(x, 110), wb.width - 110));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const cur = active ?? -1;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      showAt(Math.min(cur + 1, rows.length - 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      showAt(Math.max(cur - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      showAt(0);
    } else if (e.key === "End") {
      e.preventDefault();
      showAt(rows.length - 1);
    } else if (e.key === "Enter" && active !== null) {
      window.location.href = `/campaign/${rows[active].slug}/`;
    } else if (e.key === "Escape") {
      setActive(null);
    }
  };

  const activeRow = active !== null ? rows[active] : null;

  return (
    <div
      className={`ledger-strip${drawn ? " ledger-animate" : ""}`}
      ref={wrapRef}
    >
      <div
        className="ledger-marks"
        ref={marksRef}
        role="group"
        tabIndex={0}
        aria-label={`53 adjudicated hypotheses in registry order: 16 confirmed, 21 refuted, 16 inconclusive, 8 kills fired. Arrow keys move between marks, Enter opens the card. The same data follows as a table.`}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
      >
        {rows.map((row, i) => {
          const dim = focusCard !== null && row.slug !== focusCard;
          return (
            <div
              key={`${row.card}-${row.h}`}
              className={`ledger-mark${row.kill ? " ledger-kill" : ""}${dim ? " ledger-dim" : ""}${active === i ? " ledger-active" : ""}`}
              style={
                {
                  background: OUTCOME_COLOR[row.outcome],
                  animationDelay: `${(i * 900) / rows.length}ms`,
                } as React.CSSProperties
              }
              onMouseEnter={() => showAt(i)}
              onClick={() => {
                window.location.href = `/campaign/${row.slug}/`;
              }}
            />
          );
        })}
      </div>

      {activeRow && (
        <div className="ledger-tip" role="status" style={{ left: `${tipX}px` }}>
          <span className="ledger-tip-head">
            {activeRow.card} · {activeRow.h}
          </span>
          <span className="ledger-tip-line">
            registered {activeRow.metric} {activeRow.comparator}{" "}
            {fmt(activeRow.threshold)}
            {activeRow.prob !== null ? ` at p ${activeRow.prob}` : ""}
          </span>
          <span className="ledger-tip-line">
            observed {fmt(activeRow.observed)} ·{" "}
            {OUTCOME_GLYPH[activeRow.outcome]} {activeRow.outcome}
            {activeRow.kill ? ` · ${activeRow.kill} fired` : ""}
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
              <td>
                <a href={`/campaign/${row.slug}/`}>{row.card}</a>
              </td>
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
