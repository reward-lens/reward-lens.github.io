/**
 * The laboratory has one time authority. It returns pose channels instead of
 * mutating Three objects so a stage interruption can begin from the pose that
 * is actually on screen. `nextWakeAt` lets demand rendering sleep at rest.
 */
export function damp(value, target, seconds, rate = 9, tolerance = .00015) {
  const next = value + (target - value) * (1 - Math.exp(-rate * Math.min(.05, Math.max(0, seconds))));
  return Math.abs(next - target) < tolerance ? target : next;
}

export function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

const ACTION_MS = 5_200;
const INTRO_MS = 3_000;
const REST_MS = 2_400;
const STAGE_MS = 1_550;

function actionPose(progress, action, stage) {
  const p = Math.max(0, Math.min(1, progress));
  const prepare = smoothstep(Math.min(1, p / .25));
  const inspect = smoothstep(Math.max(0, Math.min(1, (p - .20) / .48)));
  const resolveTop = smoothstep(Math.max(0, Math.min(1, (p - .77) / .10)));
  const resolveBottom = smoothstep(Math.max(0, Math.min(1, (p - .82) / .10)));
  const restore = smoothstep(Math.max(0, Math.min(1, (p - .86) / .14)));
  const stageWeight = action === "stage" ? 1 : 0;
  const sign = stage === "comparison" ? -1 : 1;
  return {
    carriage: sign * prepare * (1 - restore) * (stageWeight && stage !== "reward" ? .82 : 1),
    focus: -inspect * (1 - restore) * (stage === "update" ? 1 : .82),
    filter: (stage === "pressure" ? .92 : stage === "comparison" ? -.72 : .34) * inspect * (1 - restore),
    // Rest and poster frame are open. Preparation visibly closes the iris,
    // then inspection reopens it before the travelling excitation is allowed.
    shutter: Math.max(0, Math.min(1, 1 - .88 * prepare * (1 - inspect))),
    optical: .32 + .68 * inspect * (1 - restore),
    travel: inspect === 0 ? 0 : Math.max(0, Math.min(1, (p - .36) / .42)),
    receiverTop: resolveTop * (1-restore) * (stage === "response" || stage === "comparison" ? 1 : .55),
    receiverBottom: resolveBottom * (1-restore) * (stage === "response" ? 1 : .5),
  };
}

export class LabMotion {
  yaw = 0; pitch = 0; targetYaw = 0; targetPitch = 0;
  theme = 0; targetTheme = 0; themeFrom = 0; themeStarted = null;
  introPlayed = false; lastAt = null; paused = false; pausedAt = null; reducedMotion = false;
  action = "rest"; stage = "reward"; actionStarted = null; nextWakeAt = null;
  #heldFrame = null;
  #lastFrame = null;
  #stageFrom = null;
  #suspendedAt = null;

  constructor(dark = false) { this.theme = this.targetTheme = this.themeFrom = dark ? 1 : 0; }
  pointer(x, y) {
    if (this.reducedMotion) { this.targetYaw = this.targetPitch = 0; return; }
    this.targetYaw = Math.max(-1, Math.min(1, x)) * Math.PI / 90;
    this.targetPitch = Math.max(-1, Math.min(1, y)) * Math.PI / 180;
  }
  relight(dark, now, immediate = false) {
    this.themeFrom = this.theme; this.targetTheme = dark ? 1 : 0;
    this.themeStarted = immediate ? null : this.#suspendedAt ?? now;
    if (immediate) this.theme = this.targetTheme;
  }
  introduce(now) {
    if (this.introPlayed || this.reducedMotion) return;
    this.introPlayed = true; this.action = "intro"; this.actionStarted = now; this.nextWakeAt = null;
  }
  select(now, stage = this.stage) { this.#stageFrom = this.#lastFrame ? {...this.#lastFrame} : null; this.stage = stage; this.action = "stage"; this.actionStarted = this.paused ? this.pausedAt ?? now : now; this.nextWakeAt = null; }
  setReducedMotion(value, now) {
    this.reducedMotion = value;
    if (value) { this.action = "rest"; this.actionStarted = null; this.nextWakeAt = null; this.targetYaw = this.targetPitch = 0; }
    else if (!this.paused && this.introPlayed) this.nextWakeAt = now + REST_MS;
  }
  setPaused(value, now) {
    if (value === this.paused) return;
    if (value && this.#suspendedAt !== null) { this.awaken(now); this.suspend(now); }
    this.paused = value;
    if (value) { this.#heldFrame = this.advance(now, true); this.pausedAt = now; this.lastAt = null; }
    else {
      const heldFor = this.pausedAt === null ? 0 : Math.max(0, now - this.pausedAt);
      if (this.actionStarted !== null) this.actionStarted += heldFor;
      if (this.nextWakeAt !== null) this.nextWakeAt += heldFor;
      if (this.#suspendedAt !== null) this.#suspendedAt = now;
      this.pausedAt = null; this.lastAt = now;
      if (!this.reducedMotion && this.action === "rest" && this.nextWakeAt === null) this.nextWakeAt = now + REST_MS;
    }
  }
  suspend(now = this.lastAt ?? 0) { if (this.#suspendedAt === null) this.#suspendedAt = now; this.lastAt = null; }
  awaken(now) {
    if (this.#suspendedAt !== null) {
      const hiddenFor = Math.max(0,now-this.#suspendedAt);
      // A user pause already owns its elapsed-time shift; never apply it twice.
      if (!this.paused) {
        if(this.actionStarted!==null)this.actionStarted+=hiddenFor;
        if(this.nextWakeAt!==null)this.nextWakeAt+=hiddenFor;
      }
      if(this.themeStarted!==null)this.themeStarted+=hiddenFor;
      this.#suspendedAt=null;
    }
    this.lastAt=now;
  }
  pause(now) {
    // Retain the old direct API for lifecycle callers while a real UI pause
    // supplies an explicit timestamp and therefore freezes the displayed mix.
    if (now === undefined) { this.theme = this.targetTheme; this.themeStarted = null; this.setPaused(true, this.lastAt ?? 0); return; }
    this.setPaused(true, now);
  }
  resume(now = 0) { this.setPaused(false, now); }
  #restPose() { return { carriage: 0, focus: 0, filter: 0, shutter: 1, optical: .32, travel: 0, receiverTop: 0, receiverBottom: 0 }; }
  static sampleCycle(milliseconds, stage = "reward") {
    // Poster-matched rest is the first 2.4 seconds. The following 5.2 second
    // span is the same recurring inspection action used by the live clock.
    const within = ((milliseconds % (REST_MS + ACTION_MS)) + REST_MS + ACTION_MS) % (REST_MS + ACTION_MS);
    const active = within >= REST_MS;
    const progress = active ? (within - REST_MS) / ACTION_MS : 1;
    const pose = active ? actionPose(progress, "inspection", stage) : { carriage: 0, focus: 0, filter: 0, shutter: 1, optical: .32, travel: 0, receiverTop: 0, receiverBottom: 0 };
    return { ...pose, yaw: 0, pitch: 0, theme: 0, intro: 1, stagePulse: 0, phase: active ? "inspection" : "rest", action: active ? "inspection" : "rest", stage, nextWakeAt: active ? null : REST_MS - within, paused: false, reducedMotion: false, moving: active };
  }
  advance(now, freeze = false) {
    if (this.paused && !freeze) {
      const held = this.#heldFrame ?? this.advance(now, true);
      let relighting = false;
      if (this.themeStarted !== null) { const t = Math.min(1, Math.max(0,(now-this.themeStarted)/760)); this.theme = this.themeFrom+(this.targetTheme-this.themeFrom)*smoothstep(t); relighting=t<1; if(t===1)this.themeStarted=null; }
      return {...held,theme:this.theme,moving:relighting};
    }
    const dt = this.lastAt === null ? 1 / 60 : Math.min(.05, Math.max(0, (now - this.lastAt) / 1000));
    if (!freeze) this.lastAt = now;
    this.yaw = damp(this.yaw, this.targetYaw, dt); this.pitch = damp(this.pitch, this.targetPitch, dt);
    if (this.themeStarted !== null) {
      const t = Math.min(1, Math.max(0, (now - this.themeStarted) / 760));
      this.theme = this.themeFrom + (this.targetTheme - this.themeFrom) * smoothstep(t);
      if (t === 1 && !freeze) { this.theme = this.targetTheme; this.themeStarted = null; }
    }
    if (!freeze && !this.reducedMotion && this.action === "rest" && this.nextWakeAt !== null && now >= this.nextWakeAt) {
      this.action = "inspection"; this.actionStarted = now; this.nextWakeAt = null;
    }
    let pose = this.#restPose(); let progress = 1;
    const duration = this.action === "intro" ? INTRO_MS : this.action === "stage" ? STAGE_MS : ACTION_MS;
    if (this.action !== "rest" && this.actionStarted !== null) {
      progress = Math.max(0, Math.min(1, (now - this.actionStarted) / duration));
      pose = actionPose(progress, this.action, this.stage);
      if (this.action === "stage" && this.#stageFrom && !freeze) {
        const blend = smoothstep(Math.min(1,(now-this.actionStarted)/240));
        for (const key of Object.keys(pose)) pose[key] = this.#stageFrom[key] + (pose[key]-this.#stageFrom[key])*blend;
      }
      if (progress === 1 && !freeze) { pose = this.#restPose(); this.action = "rest"; this.actionStarted = null; if (!this.reducedMotion) this.nextWakeAt = now + REST_MS; }
    }
    const moving = !this.paused && (this.yaw !== this.targetYaw || this.pitch !== this.targetPitch || this.themeStarted !== null || this.action !== "rest");
    const frame = { ...pose, yaw: this.yaw, pitch: this.pitch, theme: this.theme, intro: this.introPlayed && this.action === "intro" ? progress : 1, stagePulse: this.action === "stage" ? Math.sin(Math.PI * progress) : 0, phase: this.action, action: this.action, stage: this.stage, nextWakeAt: this.nextWakeAt, paused: this.paused, reducedMotion: this.reducedMotion, moving };
    if (freeze) this.#heldFrame = frame;
    this.#lastFrame = frame;
    return frame;
  }
}
