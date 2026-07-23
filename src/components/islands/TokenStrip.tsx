import { useState } from "react";
import "./TokenStrip.css";

// The lens demo: real per-token reward maps from the library's gated dense
// instrument, on the smallest fleet model. Colors are the validated diverging
// ramp; text stays in ink tokens; exact values live in the tooltip and the
// hidden table.

interface Token {
  t: string;
  v: number;
}
interface Side {
  text: string;
  score: number;
  tokens: Token[];
  response_start: number;
  trust: string;
  observable: string;
}
export interface DemoPair {
  id: string;
  axis: string;
  prompt: string;
  chosen: Side;
  rejected: Side;
  gap: number;
}
export interface DemoData {
  provenance: {
    model_hf: string;
    instrument: string;
    library_version: string;
    method: string;
  };
  pairs: DemoPair[];
}

const fmt = (n: number) => Number(n.toPrecision(3)).toString();

export default function TokenStrip({ demo }: { demo: DemoData }) {
  const [pairId, setPairId] = useState(demo.pairs[0].id);
  const [side, setSide] = useState<"chosen" | "rejected">("chosen");
  const [tip, setTip] = useState<{ i: number; v: number } | null>(null);

  const pair = demo.pairs.find((p) => p.id === pairId) ?? demo.pairs[0];
  const active = pair[side];
  const vmax = Math.max(...active.tokens.map((t) => Math.abs(t.v)), 1e-9);

  return (
    <div className="tokenstrip">
      <div className="ts-controls" role="group" aria-label="Demo pair">
        {demo.pairs.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`ts-chip${p.id === pairId ? " ts-chip-active" : ""}`}
            onClick={() => {
              setPairId(p.id);
              setTip(null);
            }}
          >
            {p.axis}
          </button>
        ))}
      </div>

      <p className="ts-prompt">
        <span className="ts-label">prompt</span> {pair.prompt}
      </p>

      <div className="ts-controls" role="group" aria-label="Completion">
        <button
          type="button"
          className={`ts-chip${side === "chosen" ? " ts-chip-active" : ""}`}
          onClick={() => {
            setSide("chosen");
            setTip(null);
          }}
        >
          chosen · r = {fmt(pair.chosen.score)}
        </button>
        <button
          type="button"
          className={`ts-chip${side === "rejected" ? " ts-chip-active" : ""}`}
          onClick={() => {
            setSide("rejected");
            setTip(null);
          }}
        >
          rejected · r = {fmt(pair.rejected.score)}
        </button>
      </div>

      <div className="ts-strip" aria-label="Per-token reward contributions">
        {active.tokens.map((tok, i) => {
          const mag = Math.min(Math.abs(tok.v) / vmax, 1);
          const pct = Math.round(mag * 62);
          const color = tok.v >= 0 ? "var(--pos)" : "var(--neg)";
          const inPrompt = i < active.response_start;
          return (
            <button
              key={i}
              type="button"
              className={`ts-tok${inPrompt ? " ts-tok-prompt" : ""}`}
              style={{
                background: `color-mix(in oklab, ${color} ${pct}%, transparent)`,
              }}
              aria-label={`token ${JSON.stringify(tok.t)}: ${fmt(tok.v)}`}
              onMouseEnter={() => setTip({ i, v: tok.v })}
              onFocus={() => setTip({ i, v: tok.v })}
              onMouseLeave={() => setTip(null)}
              onBlur={() => setTip(null)}
            >
              {tok.t.replace(/\n/g, "⏎") || "·"}
            </button>
          );
        })}
      </div>

      <p className="ts-readout" role="status">
        {tip
          ? `token ${JSON.stringify(active.tokens[tip.i].t)} carries ${fmt(tip.v)} of the score`
          : pair.gap >= 0
            ? `score gap: the model prefers the chosen completion by ${fmt(pair.gap)}`
            : `score gap: the model prefers the rejected completion by ${fmt(-pair.gap)}, a real miss it makes on this pair`}
      </p>

      <p className="ts-provenance">
        {demo.provenance.model_hf} · {active.observable} (first differences of
        the prefix-score curve) · trust{" "}
        <span className="ts-trust" title="EXPLORATORY">
          E
        </span>{" "}
        by construction: dense maps stay exploratory until certified against
        labeled error spans
      </p>

      <table className="visually-hidden">
        <caption>
          Per-token reward contributions for the {side} completion of the{" "}
          {pair.axis} pair.
        </caption>
        <thead>
          <tr>
            <th>Token</th>
            <th>Contribution</th>
          </tr>
        </thead>
        <tbody>
          {active.tokens.map((tok, i) => (
            <tr key={i}>
              <td>{tok.t}</td>
              <td>{fmt(tok.v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
