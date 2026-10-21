/** Renderer-callback cadence is a CPU proxy, never a GPU or thermal metric. */
export const PULSE_DURATION_MS = 350;
export const NOMINAL_HZ = 60;
const MIN_INTERVALS = 4;
const BAD_P75_MS = 42;

export class PulseCadence {
  #active = false; #startedAt = null; #lastAt = null; #completedAt = null; #intervals = []; #missed = 0; #badWindows = 0; #stepdowns = 0;
  start(at) { this.#active = true; this.#startedAt = at; this.#lastAt = null; this.#completedAt = null; this.#intervals = []; this.#missed = 0; }
  reset() { this.#active = false; this.#startedAt = null; this.#lastAt = null; this.#completedAt = null; this.#intervals = []; this.#missed = 0; }
  snapshot(tier) {
    return { source: "renderer callback interval CPU proxy; not GPU timing", tier, startedAt: this.#startedAt, completedAt: this.#completedAt, nominalHz: NOMINAL_HZ, callbackIntervalsMs: [...this.#intervals], callbackCount: this.#intervals.length + (this.#lastAt === null ? 0 : 1), missedIntervals: this.#missed, badWindows: this.#badWindows, stepdowns: this.#stepdowns };
  }
  observe(at, tier) {
    const idle = () => ({ completed: false, interrupted: false, bad: false, action: "none", snapshot: this.snapshot(tier) });
    if (!this.#active || this.#startedAt === null) return idle();
    if (this.#lastAt !== null) {
      const interval = at - this.#lastAt;
      if (!(interval > 0)) { this.reset(); return { ...idle(), interrupted: true }; }
      this.#intervals.push(interval);
      if (interval > 1000 / NOMINAL_HZ * 1.5) this.#missed += Math.max(1, Math.floor(interval / (1000 / NOMINAL_HZ)) - 1);
    }
    this.#lastAt = at;
    if (at - this.#startedAt < PULSE_DURATION_MS) return idle();
    this.#completedAt = at;
    const sorted = [...this.#intervals].sort((a, b) => a - b);
    const p75 = sorted.length >= MIN_INTERVALS ? sorted[Math.ceil(sorted.length * .75) - 1] : sorted.at(-1) ?? 0;
    const bad = p75 >= BAD_P75_MS;
    this.#badWindows = bad ? this.#badWindows + 1 : Math.max(0, this.#badWindows - 1);
    let action = "none";
    if (this.#badWindows >= 3) { action = this.#stepdowns < 2 ? "stepdown" : "fallback"; if (action === "stepdown") this.#stepdowns += 1; this.#badWindows = 0; }
    const snapshot = this.snapshot(tier);
    this.#active = false;
    return { completed: true, interrupted: false, bad, action, snapshot };
  }
}
