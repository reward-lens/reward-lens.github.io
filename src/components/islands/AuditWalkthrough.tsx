import { useEffect, useState } from "react";
import "./AuditWalkthrough.css";

// The five-step guided tour of what pre-registration means, each step showing
// a real artifact excerpt. Server-side it renders all five steps stacked (the
// no-JS view); hydration collapses it to one step with back/next controls and
// a ?step= deep link.

export interface WalkStep {
  id: string;
  title: string;
  body: string;
  artifactLabel: string;
  artifact: unknown;
}

export default function AuditWalkthrough({ steps }: { steps: WalkStep[] }) {
  const [active, setActive] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const s = parseInt(p.get("step") ?? "", 10);
    if (!Number.isNaN(s) && s >= 1 && s <= steps.length) setActive(s - 1);
    setHydrated(true);
  }, [steps.length]);

  useEffect(() => {
    if (!hydrated) return;
    const p = new URLSearchParams(window.location.search);
    if (active === 0) p.delete("step");
    else p.set("step", String(active + 1));
    const qs = p.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `?${qs}` : window.location.pathname,
    );
  }, [active, hydrated]);

  return (
    <div className={`walk${hydrated ? " walk-hydrated" : ""}`}>
      {steps.map((step, i) => (
        <section
          key={step.id}
          className="walk-step"
          data-active={!hydrated || i === active ? "true" : "false"}
          aria-label={`Step ${i + 1} of ${steps.length}: ${step.title}`}
        >
          <div className="walk-explain">
            <p className="walk-count">
              step {i + 1} of {steps.length}
            </p>
            <h3 className="walk-title">{step.title}</h3>
            <p className="walk-body">{step.body}</p>
            {hydrated && (
              <div className="walk-controls">
                <button
                  type="button"
                  className="walk-btn"
                  disabled={i === 0}
                  onClick={() => setActive(i - 1)}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="walk-btn walk-btn-next"
                  disabled={i === steps.length - 1}
                  onClick={() => setActive(i + 1)}
                >
                  Next step
                </button>
              </div>
            )}
          </div>
          <div className="walk-artifact">
            <p className="walk-artifact-label">{step.artifactLabel}</p>
            <pre className="walk-json" tabIndex={0} aria-label={step.artifactLabel}>
              <code>{JSON.stringify(step.artifact, null, 1)}</code>
            </pre>
          </div>
        </section>
      ))}
    </div>
  );
}
