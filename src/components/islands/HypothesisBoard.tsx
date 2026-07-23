import { useEffect, useMemo, useState } from "react";
import "./HypothesisBoard.css";

// The 53-row hypothesis table: sortable, filterable, deep-linkable. The server
// renders the full table in registry order; hydration adds the controls.

export interface BoardRow {
  card: string;
  slug: string;
  hypothesis_id: string;
  statement: string;
  metric: string;
  comparator: string;
  threshold: number;
  registered_prob: number | null;
  observed: number | null;
  outcome: "confirmed" | "refuted" | "inconclusive";
  kill_id: string | null;
  science: string;
}

type OutcomeFilter = "all" | "confirmed" | "refuted" | "inconclusive" | "kills";
type SortKey = "registry" | "card" | "outcome" | "observed";

const GLYPH: Record<string, string> = {
  confirmed: "✓",
  refuted: "✕",
  inconclusive: "○",
};

function fmt(n: number | null): string {
  if (n === null) return "–";
  if (Number.isInteger(n)) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-3 || a >= 1e4)) return n.toExponential(2);
  return String(Number(n.toPrecision(4)));
}

function readParams(): { outcome: OutcomeFilter; card: string; sort: SortKey } {
  if (typeof window === "undefined")
    return { outcome: "all", card: "", sort: "registry" };
  const p = new URLSearchParams(window.location.search);
  const outcome = (p.get("outcome") as OutcomeFilter) || "all";
  return {
    outcome: ["all", "confirmed", "refuted", "inconclusive", "kills"].includes(
      outcome,
    )
      ? outcome
      : "all",
    card: p.get("card") ?? "",
    sort: (p.get("sort") as SortKey) || "registry",
  };
}

export default function HypothesisBoard({ rows }: { rows: BoardRow[] }) {
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [card, setCard] = useState("");
  const [sort, setSort] = useState<SortKey>("registry");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const init = readParams();
    setOutcome(init.outcome);
    setCard(init.card);
    setSort(init.sort);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const p = new URLSearchParams();
    if (outcome !== "all") p.set("outcome", outcome);
    if (card) p.set("card", card);
    if (sort !== "registry") p.set("sort", sort);
    const qs = p.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `?${qs}` : window.location.pathname,
    );
  }, [outcome, card, sort, hydrated]);

  const cardIds = useMemo(
    () => [...new Set(rows.map((r) => r.card))],
    [rows],
  );

  const filtered = useMemo(() => {
    let out = rows.filter((r) => {
      if (outcome === "kills" && !r.kill_id) return false;
      if (
        outcome !== "all" &&
        outcome !== "kills" &&
        r.outcome !== outcome
      )
        return false;
      if (card && r.card !== card) return false;
      return true;
    });
    if (sort !== "registry") {
      out = [...out].sort((a, b) => {
        if (sort === "card") return a.card.localeCompare(b.card);
        if (sort === "outcome") return a.outcome.localeCompare(b.outcome);
        return (b.observed ?? -Infinity) - (a.observed ?? -Infinity);
      });
    }
    return out;
  }, [rows, outcome, card, sort]);

  const counts = useMemo(() => {
    const c = { confirmed: 0, refuted: 0, inconclusive: 0, kills: 0 };
    for (const r of rows) {
      c[r.outcome] += 1;
    }
    c.kills = new Set(rows.filter((r) => r.kill_id).map((r) => r.card)).size;
    return c;
  }, [rows]);

  const filters: { key: OutcomeFilter; label: string }[] = [
    { key: "all", label: `all ${rows.length}` },
    { key: "confirmed", label: `confirmed ${counts.confirmed}` },
    { key: "refuted", label: `refuted ${counts.refuted}` },
    { key: "inconclusive", label: `inconclusive ${counts.inconclusive}` },
    { key: "kills", label: `kills ${counts.kills}` },
  ];

  return (
    <div className="hboard">
      <div className="hboard-filters" role="group" aria-label="Filter by outcome">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`hboard-chip${outcome === f.key ? " hboard-chip-active" : ""}`}
            aria-pressed={outcome === f.key}
            onClick={() => setOutcome(f.key)}
          >
            {f.label}
          </button>
        ))}
        <label className="hboard-select">
          <span className="visually-hidden">Filter by card</span>
          <select value={card} onChange={(e) => setCard(e.target.value)}>
            <option value="">every card</option>
            {cardIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="scroll-x">
        <table className="hboard-table">
          <thead>
            <tr>
              <th>
                <button
                  type="button"
                  className="hboard-sort"
                  onClick={() => setSort(sort === "card" ? "registry" : "card")}
                  aria-label="Sort by card"
                >
                  Card{sort === "card" ? " ↓" : ""}
                </button>
              </th>
              <th>Hypothesis</th>
              <th>Registered prediction</th>
              <th>
                <button
                  type="button"
                  className="hboard-sort"
                  onClick={() =>
                    setSort(sort === "observed" ? "registry" : "observed")
                  }
                  aria-label="Sort by observed value"
                >
                  Observed{sort === "observed" ? " ↓" : ""}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="hboard-sort"
                  onClick={() =>
                    setSort(sort === "outcome" ? "registry" : "outcome")
                  }
                  aria-label="Sort by outcome"
                >
                  Outcome{sort === "outcome" ? " ↓" : ""}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={`${r.card}-${r.hypothesis_id}`}>
                <td className="hboard-card">
                  <a href={`/campaign/${r.slug}/`}>{r.card}</a>
                  <span className="hboard-hyp">{r.hypothesis_id}</span>
                </td>
                <td className="hboard-statement">{r.statement}</td>
                <td className="hboard-pred">
                  <code>
                    {r.metric} {r.comparator} {fmt(r.threshold)}
                  </code>
                  {r.registered_prob !== null && (
                    <span className="hboard-prob">p {r.registered_prob}</span>
                  )}
                </td>
                <td className="hboard-obs">
                  <code>{fmt(r.observed)}</code>
                </td>
                <td className={`hboard-outcome hboard-${r.outcome}`}>
                  <span aria-hidden="true">{GLYPH[r.outcome]}</span>{" "}
                  {r.outcome}
                  {r.kill_id && (
                    <span className="hboard-kill">{r.kill_id} fired</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="hboard-empty">
                  No hypotheses match these filters.{" "}
                  <button
                    type="button"
                    className="hboard-clear"
                    onClick={() => {
                      setOutcome("all");
                      setCard("");
                    }}
                  >
                    Clear filters.
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
