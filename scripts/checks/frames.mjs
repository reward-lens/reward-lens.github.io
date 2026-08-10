// Gate 17 · Frame budget
//
// A long task over 50ms, a p95 frame over 16.6ms at tier B, or an 8%
// regression against the recorded baseline.
//
// Measured over a 600-frame scripted scroll of the homepage, because that is
// where the scene is and because scroll is the one interaction every reader
// performs. Tier B is the middle capability tier from SCENE.md; it is emulated
// here with a 4x CPU throttle, which is the closest a headless run gets to a
// mid-tier machine and is stated so nobody reads the number as a desktop
// figure.
//
// The regression arm needs a baseline, and a baseline recorded on a different
// machine is noise. reports/frame-baseline.json records the machine it was
// taken on; when the recorded machine and the current one disagree the
// regression arm is skipped and says so, and the absolute arms still run. A
// regression check that silently compares across machines is worse than no
// regression check, because it fires at random and people learn to rerun it.
//
// Usage:
//   node scripts/checks/frames.mjs
//   node scripts/checks/frames.mjs --record

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { cpus, arch, platform } from "node:os";
import { DIST, ROOT, serveDist, routeExists, readJson, skip, recordVacuity, launchBrowser } from "./_lib.mjs";

const BASELINE = join(ROOT, "reports", "frame-baseline.json");
const RECORD = process.argv.includes("--record");
const FRAMES = 600;
const P95_BUDGET_MS = 16.6;
const LONG_TASK_MS = 50;
const REGRESSION = 0.08;

if (!routeExists("/", DIST)) skip(17, "the homepage is not built. Run npm run build first.");

const machine = `${platform()}-${arch()}-${cpus().length}cpu-${cpus()[0]?.model ?? "unknown"}`;

const server = await serveDist(DIST);
const { browser, engine } = await launchBrowser();
console.log(`browser: ${engine}`);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const client = await ctx.newCDPSession(page);
await client.send("Emulation.setCPUThrottlingRate", { rate: 4 }); // tier B

await page.goto(server.origin + "/", { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page
  .waitForFunction(() => document.documentElement.dataset.sceneReady === "true", { timeout: 5000 })
  .catch(() => {});

/**
 * WHICH ADAPTER IS DRAWING THIS.
 *
 * Every arm below is a timing, and a timing is only a frame budget if a GPU
 * produced it. Headless Chrome on a machine with no usable GPU falls back to
 * SwiftShader, and this page then renders at under one frame a second: p50
 * frame work 130ms, p95 477ms, a hundred long tasks around 900ms each. None of
 * that is the site. Asserting against it produces a gate that fails forever for
 * an environmental reason, and a gate that fails forever is one people learn to
 * disable — which costs more than the gate was ever worth.
 *
 * So the adapter is read first and the timing arms only bind when it is real.
 * On a software rasteriser the numbers are still printed, clearly labelled, and
 * the arms are recorded as VACUOUS: not passed, did not run. The counts and
 * byte figures that do survive a software rasteriser are measured elsewhere
 * (tests/perf/), because they belong in a different gate from timings.
 */
const adapter = await page.evaluate(() => {
  try {
    const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
    if (!gl) return { renderer: null, reason: "no WebGL context" };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { renderer: String(renderer) };
  } catch (e) {
    return { renderer: null, reason: String(e) };
  }
});
/**
 * FRAMES_ASSUME_GPU is a test hook, and it only ever makes this gate STRICTER.
 *
 * The timing arms below cannot be demonstrated failing on a host without a GPU,
 * because the software-rasteriser guard correctly disarms them, and an arm
 * nobody has ever seen fail is not evidence that it can. Setting this forces the
 * guard off so the arms bind and can be shown firing. It is never set in CI, and
 * if it were the only consequence would be a gate that asserts where it would
 * otherwise abstain, which is the safe direction to be wrong in.
 */
const ASSUME_GPU = process.env.FRAMES_ASSUME_GPU === "1";
const SOFTWARE =
  !ASSUME_GPU && /swiftshader|llvmpipe|software|mesa offscreen|microsoft basic/i.test(adapter.renderer ?? "");
console.log(`adapter: ${adapter.renderer ?? `unavailable (${adapter.reason})`}`);
if (ASSUME_GPU) console.log(`FRAMES_ASSUME_GPU=1: the software-rasteriser guard is forced off for this run.`);

const measurement = await page.evaluate(async (frames) => {
  const longTasks = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) longTasks.push({ duration: e.duration, name: e.name });
    }).observe({ type: "longtask", buffered: true });
  } catch {}

  // The budget is 16.6ms of FRAME TIME, and the interval between two
  // requestAnimationFrame callbacks is not that. On a healthy 60Hz page the
  // interval is the display cadence, 16.667ms, so a p95 interval is above 16.6
  // by construction and every page fails a check that reads it as frame time.
  // The first version of this gate did exactly that and reported the v1
  // homepage at p50 16.70ms, which is vsync and not jank.
  //
  // long-animation-frame gives the main thread's actual rendering work for the
  // frame, which is the quantity the budget is about. The interval is still
  // recorded, because a p95 interval far above the cadence means dropped
  // frames and is worth seeing.
  const loaf = [];
  let loafSupported = false;
  try {
    if (PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) {
      loafSupported = true;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) loaf.push(e.duration);
      }).observe({ type: "long-animation-frame", buffered: true });
    }
  } catch {}

  const durations = [];
  const range = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  let last = performance.now();

  await new Promise((resolve) => {
    let i = 0;
    const step = () => {
      const now = performance.now();
      durations.push(now - last);
      last = now;
      window.scrollTo(0, Math.round((i / frames) * range));
      i += 1;
      if (i > frames) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  durations.shift(); // the first interval measures the setup, not a frame
  const q = (arr, p) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };
  return {
    frames: durations.length,
    intervalP50: q(durations, 0.5),
    intervalP95: q(durations, 0.95),
    intervalMax: q(durations, 1),
    loafSupported,
    loafFrames: loaf.length,
    workP50: q(loaf, 0.5),
    workP95: q(loaf, 0.95),
    workMax: q(loaf, 1),
    longTasks: longTasks.filter((t) => t.duration > 50),
  };
}, FRAMES);

await browser.close();
await server.close();

let failures = 0;
const fail = (m) => {
  console.error(`FAIL ${m}`);
  failures += 1;
};

console.log(
  `frames: ${measurement.frames} frames at 1440x900, 4x CPU throttle (tier B).\n` +
    `  frame work (long-animation-frame):  p50 ${measurement.workP50.toFixed(2)}ms   p95 ${measurement.workP95.toFixed(2)}ms   max ${measurement.workMax.toFixed(2)}ms   over ${measurement.loafFrames} frames\n` +
    `  frame interval (display cadence):   p50 ${measurement.intervalP50.toFixed(2)}ms   p95 ${measurement.intervalP95.toFixed(2)}ms   max ${measurement.intervalMax.toFixed(2)}ms`,
);

/**
 * A SECOND ARITHMETIC GUARANTEE, IN THE ARM THAT REPLACED THE FIRST.
 *
 * This file already documents one: an earlier version compared a
 * requestAnimationFrame INTERVAL against a frame-WORK budget, so 16.667ms of
 * vsync failed a 16.6ms budget and every route failed. long-animation-frame was
 * brought in to fix it, and it brought its own version of the same mistake.
 *
 * The platform only emits a long-animation-frame entry for a frame whose
 * duration exceeds 50ms. The distribution is therefore left-truncated at 50: no
 * entry below it can exist. So `p95 of loaf > 16.6` is true whenever the array
 * is non-empty and false only when it is empty, whatever the page does. It is
 * not a percentile of frame work, it is "did any frame exceed 50ms" wearing a
 * percentile's clothes — and the long-task arm below already asserts that. Worse,
 * it PRINTS "p95 frame work 476.90ms" and that reads as a p95 over all frames,
 * when it is the 95th percentile of the six worst frames in six hundred.
 *
 * The repair keeps long-animation-frame, which is the right instrument, and
 * states what it actually bounds: the SHARE of frames that are long. That is a
 * quantity the platform can express and the budget can be written against. The
 * distribution is still printed, labelled as being over long frames only.
 */
// FRAMES_LONG_SHARE_BUDGET is the second of two test hooks, and like
// FRAMES_ASSUME_GPU it can only tighten this gate. It exists so the arm below
// can be demonstrated firing: this host produces about 1% long frames over the
// scripted scroll, under the shipped 5%, and there is no way to induce more
// without changing the page being measured.
const LONG_FRAME_SHARE = Number(process.env.FRAMES_LONG_SHARE_BUDGET ?? 0.05);
const longFrameShare = measurement.frames ? measurement.loafFrames / measurement.frames : 0;
console.log(
  `  long frames: ${measurement.loafFrames} of ${measurement.frames} (${(longFrameShare * 100).toFixed(1)}%), budget ${LONG_FRAME_SHARE * 100}%.\n` +
    `  The frame-work percentiles above are over LONG FRAMES ONLY: long-animation-frame does not emit an\n` +
    `  entry below ${LONG_TASK_MS}ms, so that distribution starts at ${LONG_TASK_MS} by construction and its p95 cannot be compared to ${P95_BUDGET_MS}.`,
);

if (SOFTWARE) {
  console.warn(
    `\nWARN the adapter is a software rasteriser (${adapter.renderer}).\n` +
      `  Every timing arm of this gate is VACUOUS on this host: frame work, frame interval, long tasks and the\n` +
      `  regression arm all measure SwiftShader, not the site. The numbers above are printed for the record and\n` +
      `  must not be reported as a frame budget met or missed. Run this on hardware with a real GPU.`,
  );
  recordVacuity(
    17,
    `the adapter is a software rasteriser (${adapter.renderer}); every timing arm was measured and none was asserted. Frame budgets are unverified on this host.`,
  );
} else {
  if (!measurement.loafSupported) {
    console.warn(
      `WARN this browser does not report long-animation-frame, so frame WORK could not be measured and the long-frame arm did not run. The long-task arm still did.`,
    );
    recordVacuity(17, "long-animation-frame is unavailable in this browser; the long-frame-share arm did not run.");
  } else if (longFrameShare > LONG_FRAME_SHARE) {
    fail(
      `${measurement.loafFrames} of ${measurement.frames} frames exceeded ${LONG_TASK_MS}ms (${(longFrameShare * 100).toFixed(1)}%), over the ${LONG_FRAME_SHARE * 100}% budget at tier B. Worst frame ${measurement.workMax.toFixed(1)}ms.`,
    );
  }
  // The interval is reported, never asserted against 16.6. On a healthy 60Hz page
  // the interval IS 16.667ms, so asserting it fails every page by construction.
  if (measurement.intervalP95 > 33) {
    fail(
      `p95 frame interval ${measurement.intervalP95.toFixed(2)}ms, more than two display frames. Frames are being dropped.`,
    );
  }
  for (const t of measurement.longTasks) {
    fail(`long task ${t.duration.toFixed(1)}ms over the ${LONG_TASK_MS}ms limit (${t.name})`);
  }
}

if (RECORD && SOFTWARE) {
  console.error(
    `\nFAIL refusing to record a baseline from a software rasteriser (${adapter.renderer}).\n` +
      `  A baseline is what every future run is compared against. Recording SwiftShader's frame times would\n` +
      `  make the regression arm compare noise to noise forever, and it would look like a real baseline in the\n` +
      `  file. Record it on hardware with a GPU.`,
  );
  process.exit(1);
}

if (RECORD) {
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        _what_this_is:
          "Gate 17's frame baseline. The regression arm compares against this and is skipped when the machine differs, because a frame time recorded on another machine is noise and a regression check that fires at random is one people learn to rerun.",
        machine,
        recordedAt: new Date().toISOString(),
        workP50: measurement.workP50,
        workP95: measurement.workP95,
        intervalP95: measurement.intervalP95,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`frames: recorded the baseline for ${machine}`);
  process.exit(failures > 0 ? 1 : 0);
}

const baseline = readJson(BASELINE);
if (SOFTWARE) {
  console.warn(
    `WARN the regression arm did not run: a baseline recorded against a software rasteriser would compare noise to noise.`,
  );
} else if (!baseline) {
  console.warn(
    `WARN no frame baseline at reports/frame-baseline.json, so the 8% regression arm did not run. Record one with --record.`,
  );
  recordVacuity(17, "no frame baseline recorded, so the 8% regression arm did not run.");
} else if (baseline.machine !== machine) {
  console.warn(
    `WARN the frame baseline was recorded on a different machine, so the regression arm did not run.\n` +
      `  baseline: ${baseline.machine}\n  current:  ${machine}`,
  );
  recordVacuity(17, `the frame baseline is from another machine (${baseline.machine}); the regression arm did not run.`);
} else {
  const base = baseline.workP95 || 0;
  const delta = base ? (measurement.workP95 - base) / base : 0;
  console.log(`frames: p95 frame work moved ${(delta * 100).toFixed(1)}% against the baseline of ${base.toFixed(2)}ms`);
  if (delta > REGRESSION) {
    fail(`p95 regressed ${(delta * 100).toFixed(1)}%, over the ${REGRESSION * 100}% limit`);
  }
}

console.log(`\nframes: ${failures} failures`);
process.exit(failures > 0 ? 1 : 0);
