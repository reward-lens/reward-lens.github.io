/**
 * Frame time over a scripted scroll, per pass configuration.
 *
 * SCENE.md §8 sets the budget as 60fps sustained at 1440p measured with
 * `performance.now()` deltas over a 600-frame scripted scroll, and until now
 * nothing in the repository measured it. This does.
 *
 * WHY IT TOGGLES PASSES INSTEAD OF BOOTING EACH TIER. The tier is decided once
 * at mount by `runtime/tier.ts` from hardware hints and there is no override,
 * which is correct for shipping and useless for profiling: measuring the low
 * tier would otherwise mean owning the detector, which belongs to the scene
 * core. So the chain is reconfigured on a live page instead, and each row below
 * says which real tier it stands in for. The rows are configurations, not tiers,
 * and the difference is stated rather than papered over:
 *
 *   full          the high tier exactly
 *   no-dof        the mid tier's chain, at the high tier's pixel ratio
 *   render-only   the low tier's work, still paying for the composer's buffers
 *
 * The per-pass rows underneath are A/B against `full`, which is the only honest
 * way to price a pass: the passes share bandwidth, so their individual costs do
 * not add up to the total and should not be reported as if they did.
 *
 * Usage: node scripts/dev/scene-frametime.mjs [url] [--theme=dark] [--frames=600]
 */
import { chromium } from "playwright";

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flag = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=").slice(1).join("=") : d;
};

const URL = positional[0] ?? "http://localhost:4478/";
const THEME = flag("theme", "dark");
const FRAMES = Number(flag("frames", "600"));

/** Each row: a label, the passes to switch off, and the tier it stands for. */
const CONFIGS = [
  { label: "full", off: [], stands_for: "high tier, as shipped" },
  { label: "no-dof", off: ["BokehPass"], stands_for: "mid tier chain" },
  {
    label: "render-only",
    off: ["GTAOPass", "UnrealBloomPass", "BokehPass", "OutputPass", "FXAAPass", "ShaderPass"],
    stands_for: "low tier work",
  },
  { label: "minus-ao", off: ["GTAOPass"], stands_for: "A/B: the cost of ambient occlusion" },
  { label: "minus-bloom", off: ["UnrealBloomPass"], stands_for: "A/B: the cost of bloom" },
];

const browser = await chromium.launch({
  executablePath: "/opt/google/chrome/google-chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), THEME);
await page.waitForFunction(
  () => document.documentElement.getAttribute("data-scene-ready") === "true",
  { timeout: 20000 },
);

const state = await page.evaluate(() => (window.__pipeline ? window.__pipeline.read() : null));
if (!state) {
  console.error("scene-frametime: window.__pipeline is absent; the render pipeline did not mount.");
  await browser.close();
  process.exit(1);
}

console.log(`\n  tier ${state.tier}, theme ${state.theme}, operator ${state.operator}`);
console.log(`  passes: ${state.passes.join(" -> ") || "no composer"}`);
console.log(`\n  ${FRAMES}-frame scripted scroll, wall time between frames\n`);
console.log("  configuration    p50 ms   p95 ms   max ms   frames   stands for");

/**
 * One scripted scroll.
 *
 * Driven from inside the page on `requestAnimationFrame` rather than by
 * Playwright's mouse wheel, because the wheel goes through the compositor and
 * what is being measured is the render loop. The scroll is a fixed ramp so
 * every configuration sees the same camera path and the same amount of the
 * scene, which is what makes the rows comparable.
 */
async function measure() {
  await page.evaluate(() => window.__pipeline.resetFrames());
  await page.evaluate(async (frames) => {
    const top = document.documentElement.scrollHeight - window.innerHeight;
    await new Promise((resolve) => {
      let i = 0;
      const step = () => {
        window.scrollTo(0, (top * i) / frames);
        i += 1;
        if (i <= frames) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }, FRAMES);
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.evaluate(() => window.__pipeline.read().frames);
}

for (const config of CONFIGS) {
  const applied = await page.evaluate((cfg) => {
    for (const name of cfg.all) window.__pipeline.setPass(name, true);
    return cfg.off.map((name) => window.__pipeline.setPass(name, false));
  }, { off: config.off, all: state.passes });

  if (config.off.length && !applied.some(Boolean)) {
    console.log(`  ${config.label.padEnd(15)} (not in this tier's chain)`);
    continue;
  }

  const f = await measure();
  if (!f) {
    console.log(`  ${config.label.padEnd(15)} (no frames recorded)`);
    continue;
  }
  console.log(
    `  ${config.label.padEnd(15)} ${f.p50.toFixed(2).padStart(6)}  ${f.p95
      .toFixed(2)
      .padStart(7)}  ${f.max.toFixed(2).padStart(7)}   ${String(f.count).padStart(6)}   ${config.stands_for}`,
  );
}

// Leave the page as it was found.
await page.evaluate((names) => {
  for (const name of names) window.__pipeline.setPass(name, true);
}, state.passes);

const env = state.environment;
console.log(
  `\n  environment: ${
    env ? `${env.emitters} emitters, ${(env.bytes / 1048576).toFixed(2)} MB, ${env.ms.toFixed(1)} ms to prefilter` : "ABSENT"
  }`,
);
console.log("");
await browser.close();
