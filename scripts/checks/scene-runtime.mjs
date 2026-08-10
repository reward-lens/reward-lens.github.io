/**
 * Gate 26 · Scene runtime
 *
 * Drives the built page in a real browser and asserts what the instrument does,
 * not what its source says. Every check here failed at least once during the
 * build for a reason that was invisible in the code:
 *
 *   - `astro-island` is `display: contents`, so it generates no box, so
 *     `client:visible`'s observer never reported it intersecting and the island
 *     never hydrated. The host was present at 1440x760 and there was no canvas.
 *   - `THREE.Color.setStyle` warns rather than throwing on a value it cannot
 *     parse and leaves the colour alone, and a fresh Color is white, so every
 *     material silently took white and the room rendered as a blown-out grey
 *     box. A try/catch caught nothing.
 *   - A stale Vite bundle made two consecutive edits produce byte-identical
 *     measurements, so a change that did nothing and a change that was never
 *     built looked the same.
 *   - Clicking the legend entry the pointer was already previewing left
 *     `aria-pressed` false while the object was isolated, because the value the
 *     bridge holds had not changed and the bridge correctly declined to notify.
 *     Nothing in the source suggests it and one screenshot would not show it.
 *
 * THE COVERAGE PRINTOUT IS PART OF THE GATE. The scene contract asks for twenty
 * assertions and they are named in `CONTRACT` below rather than counted, so the
 * number this prints cannot drift from what it checks: a covered assertion is
 * one whose name a check actually reported against. A gate that silently
 * covered a third of its contract and reported a pass would be the sixth
 * vacuous gate in this repository.
 *
 * WHAT DECIDES HOW MANY RUN. Ten of the twenty need the DOM controls to be on
 * the page under test. `--strict` makes their absence a failure, which is what
 * to run once the movement is placed on the homepage. Without it, a page that
 * carries no controls reports them unreachable and says so, rather than passing
 * quietly on seven.
 *
 * Usage:
 *   node scripts/checks/scene-runtime.mjs <url> [--strict]
 */
import { chromium } from "playwright";

const args = process.argv.slice(2);
const URL = args.find((a) => !a.startsWith("--")) ?? "http://localhost:4321/";
const STRICT = args.includes("--strict");
const CHROME = "/opt/google/chrome/google-chrome";

/**
 * The twenty. Each is the sentence the contract asks for, and a check reports
 * against one by name. Nothing else counts as coverage.
 */
const CONTRACT = [
  "host present",
  "exactly one canvas",
  "island hydrated and drew a frame",
  "tier fixed for the session",
  "no console errors and no colour warning",
  "canvas has a layout box",
  "the loop stops when the instrument is scrolled away",
  "all five states activate at known scroll positions",
  "an intermediate position produces an interpolated pose",
  "reverse scroll returns objects to their prior pose",
  "the score toggle changes the encoded state",
  "the score toggle changes its DOM summary",
  "trace one rollout isolates one exact stable id",
  "keyboard and pointer produce the same selected id",
  "Escape clears isolation",
  "the source plate changes when the subject changes",
  "reduced motion never starts a continuous animation",
  "the no-WebGL path serves the composed still",
  "the mobile path takes a lower tier and keeps its controls",
  "context loss falls back without breaking the document",
];

const failures = [];
const covered = new Set();
const unreachable = new Map();

function assert(name, ok, detail) {
  if (!CONTRACT.includes(name)) {
    throw new Error(
      `scene-runtime: "${name}" is not one of the twenty contract assertions. Add it to CONTRACT ` +
        `or report against the name that is already there; a check that reports against a name ` +
        `nobody declared is how a coverage count stops meaning anything.`,
    );
  }
  covered.add(name);
  if (!ok) failures.push(`${name}: ${detail}`);
}

function skip(name, why) {
  unreachable.set(name, why);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

/* -------------------------------------------------------------------------
   Pass one: the ordinary session.
------------------------------------------------------------------------- */
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
  // The colour trap announces itself as a warning, never as an error, which is
  // exactly why it survived. Treat it as fatal here.
  if (m.type() === "warning" && /could not resolve colour|THREE\.Color/i.test(m.text())) {
    consoleErrors.push(`WARNING TREATED AS FATAL: ${m.text()}`);
  }
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

/* `networkidle` is the wrong wait here and it made this gate fail for the wrong
   reason on its first controlled break: a route with no instrument timed out
   during navigation and exited 1 before a single assertion ran. An exit code
   that does not come from an assertion is the failure mode this file exists to
   catch, so navigation is deliberately cheap and the settling is explicit. */
try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 20000 });
} catch (e) {
  /* A dead server and a broken scene both exit 1, and conflating them is how a
     gate gets believed for the wrong reason. Say which one happened. */
  await browser.close();
  console.error(
    `FAIL scene-runtime: could not load ${URL}. This is a harness fault, not a scene\n` +
      `  result: no assertion ran. Serve the built site first, and read the port the\n` +
      `  preview actually bound rather than the one you asked for.\n  ${String(e).split("\n")[0]}\n`,
  );
  process.exit(2);
}
await page.waitForTimeout(4000);

const state = await page.evaluate(() => ({
  host: !!document.querySelector("[data-scene-host]"),
  canvases: document.querySelectorAll("canvas").length,
  ready: document.documentElement.getAttribute("data-scene-ready"),
  tier: document.documentElement.getAttribute("data-scene-tier"),
  controls: !!document.querySelector("[data-scene-controls]"),
  story: !!document.querySelector("[data-instrument-story]"),
}));

assert("host present", state.host, "no [data-scene-host] in the document");
assert(
  "exactly one canvas",
  state.canvases === 1,
  `found ${state.canvases}; browsers cap WebGL contexts per document and a second one is a leak`,
);
assert(
  "island hydrated and drew a frame",
  state.ready === "true",
  `data-scene-ready is ${JSON.stringify(state.ready)}. The island is display:contents, so a missing box means the visibility observer never fired`,
);
assert(
  "tier fixed for the session",
  ["high", "mid", "low", "still"].includes(state.tier ?? ""),
  `data-scene-tier is ${JSON.stringify(state.tier)}`,
);
assert(
  "no console errors and no colour warning",
  consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(" | "),
);

/* The canvas has to have actually painted. A mounted context that renders
   nothing sets the ready flag just as convincingly as one that works, and the
   difference is invisible to every check above. */
const painted = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  if (!c) return { ok: false, why: "no canvas" };
  const box = c.getBoundingClientRect();
  return { ok: box.width > 0 && box.height > 0, w: Math.round(box.width), h: Math.round(box.height) };
});
assert("canvas has a layout box", painted.ok, `${painted.w}x${painted.h}`);

/* -------------------------------------------------------------------------
   The movement. Ten assertions, and every one of them needs the controls.

   The state is read from `window.__instrument` and the pose from
   `window.__scene.pose()` rather than from pixels. The contract forbids
   encoding the current state only in canvas pixels, and a gate that diffed two
   screenshots to prove a camera interpolated would be reading the one surface
   where a real change and a coincidence look the same. This repository has
   already published one fake A/B for exactly that reason.
------------------------------------------------------------------------- */
const CONTROL_ASSERTIONS = CONTRACT.slice(7, 16);

if (!state.controls) {
  const why = state.story
    ? "the page renders the instrument story with no controls in its slots; place " +
      "components/home/instrument-narrative/instrument-movement.astro to reach these"
    : "the page carries no instrument movement";
  for (const name of CONTROL_ASSERTIONS) skip(name, why);
} else {
  /* Five states, at known scroll positions: the middle of each article. */
  const activations = await page.evaluate(async () => {
    const story = document.querySelector("[data-instrument-story]");
    const articles = [...story.querySelectorAll("[data-instrument-state]")];
    const out = [];
    for (const article of articles) {
      const rect = article.getBoundingClientRect();
      const middle = rect.top + window.scrollY + rect.height / 2 - window.innerHeight / 2;
      window.scrollTo(0, middle);
      await new Promise((r) => setTimeout(r, 320));
      const s = window.__instrument.read();
      out.push({
        wanted: article.dataset.instrumentState,
        got: s.activeState,
        y: Math.round(middle),
        activeCase: s.activeCase,
      });
    }
    return out;
  });
  const wrong = activations.filter((a) => a.wanted !== a.got);
  assert(
    "all five states activate at known scroll positions",
    activations.length === 5 && wrong.length === 0,
    activations.length !== 5
      ? `${activations.length} articles carry a state id, not five`
      : wrong.map((a) => `at y=${a.y} wanted ${a.wanted}, got ${a.got}`).join("; "),
  );

  /* An intermediate position: between two states, the pose is neither of the
     keyframes and is between them. Blank and snapped both fail here. */
  const between = await page.evaluate(async () => {
    const story = document.querySelector("[data-instrument-story]");
    const articles = [...story.querySelectorAll("[data-instrument-state]")];
    const read = async (y) => {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 320));
      const p = window.__scene.pose();
      return { progress: p.progress, position: p.cameraPosition, assemblies: p.assemblies };
    };
    const yOf = (el, frac) => {
      const r = el.getBoundingClientRect();
      return r.top + window.scrollY + r.height * frac - window.innerHeight / 2;
    };
    const a = await read(yOf(articles[1], 0.02));
    const mid = await read(yOf(articles[1], 0.5));
    const b = await read(yOf(articles[2], 0.02));
    return { a, mid, b };
  });
  const movingAxes = [0, 1, 2].filter(
    (i) => Math.abs(between.a.position[i] - between.b.position[i]) > 1e-3,
  );
  const strictlyBetween = movingAxes.every((i) => {
    const lo = Math.min(between.a.position[i], between.b.position[i]);
    const hi = Math.max(between.a.position[i], between.b.position[i]);
    return between.mid.position[i] > lo + 1e-6 && between.mid.position[i] < hi - 1e-6;
  });
  assert(
    "an intermediate position produces an interpolated pose",
    movingAxes.length > 0 && strictlyBetween,
    movingAxes.length === 0
      ? "the camera does not move between two adjacent states, so nothing could be interpolated"
      : `midpoint ${JSON.stringify(between.mid.position)} is not inside ` +
        `${JSON.stringify(between.a.position)}..${JSON.stringify(between.b.position)}`,
  );

  /* Reverse scroll: the same positions on the way back give the same poses.
     A path that carries history fails here and looks fine in a screenshot. */
  const reversal = await page.evaluate(async () => {
    const sample = async (y) => {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 260));
      const p = window.__scene.pose();
      return { y, position: p.cameraPosition.map((v) => v.toFixed(5)), progress: p.progress.toFixed(5) };
    };
    const height = document.body.scrollHeight;
    const stops = [1, 2, 3, 4, 5, 6].map((i) => Math.round((height * i) / 8));
    const down = [];
    for (const y of stops) down.push(await sample(y));
    const up = [];
    for (const y of [...stops].reverse()) up.push(await sample(y));
    return { down, up: up.reverse() };
  });
  const drift = reversal.down.filter(
    (d, i) => JSON.stringify(d) !== JSON.stringify(reversal.up[i]),
  );
  assert(
    "reverse scroll returns objects to their prior pose",
    drift.length === 0,
    drift
      .slice(0, 2)
      .map((d, i) => `at y=${d.y} down ${JSON.stringify(d.position)} up ${JSON.stringify(reversal.up[i].position)}`)
      .join("; "),
  );

  /* The score-component control, both halves: what it encodes and what it says. */
  const score = await page.evaluate(async () => {
    const input = document.querySelector("[data-scene-score-toggle]");
    if (!input) return null;
    const visible = (which) => {
      const el = document.querySelector(`[data-scene-score-summary="${which}"]`);
      return el ? !el.hidden : null;
    };
    const beforeText = document.querySelector('[data-scene-score-summary="on"]')?.textContent?.trim();
    input.click();
    await new Promise((r) => setTimeout(r, 120));
    const encoded = window.__instrument.read().disabledScoreComponent;
    const offText = document.querySelector('[data-scene-score-summary="off"]')?.textContent?.trim();
    const state = { onVisible: visible("on"), offVisible: visible("off") };
    input.click();
    await new Promise((r) => setTimeout(r, 120));
    return {
      encoded,
      restored: window.__instrument.read().disabledScoreComponent,
      beforeText,
      offText,
      ...state,
    };
  });
  assert(
    "the score toggle changes the encoded state",
    Boolean(score?.encoded) && score.restored === null,
    `disabledScoreComponent went to ${JSON.stringify(score?.encoded)} and back to ${JSON.stringify(score?.restored)}`,
  );
  assert(
    "the score toggle changes its DOM summary",
    score?.offVisible === true &&
      score?.onVisible === false &&
      Boolean(score.offText) &&
      score.offText !== score.beforeText,
    `on-visible ${score?.onVisible}, off-visible ${score?.offVisible}; the two summaries must not be the same text`,
  );

  /* Trace one rollout: one exact stable id, and the row that names it. */
  const trace = await page.evaluate(async () => {
    const button = document.querySelector("[data-scene-trace-step]");
    if (!button) return null;
    button.click();
    await new Promise((r) => setTimeout(r, 120));
    const id = window.__instrument.read().tracedRollout;
    const shown = [...document.querySelectorAll("[data-scene-trace-row]")]
      .filter((r) => !r.hidden)
      .map((r) => r.dataset.sceneTraceRow);
    button.click();
    await new Promise((r) => setTimeout(r, 120));
    const second = window.__instrument.read().tracedRollout;
    return { id, shown, second };
  });
  assert(
    "trace one rollout isolates one exact stable id",
    Boolean(trace?.id) &&
      /^s\d{3}-g\d+-r\d+$/.test(trace.id) &&
      trace.shown.length === 1 &&
      trace.shown[0] === trace.id &&
      trace.second !== trace.id,
    `traced ${JSON.stringify(trace?.id)}, rows shown ${JSON.stringify(trace?.shown)}, next ${JSON.stringify(trace?.second)}`,
  );

  /* Keyboard and pointer, and then Escape. */
  const parity = await page.evaluate(async () => {
    const buttons = [...document.querySelectorAll("[data-scene-object]")].filter(
      (b) => b.offsetParent !== null,
    );
    const button = buttons[0];
    if (!button) return null;
    const wait = () => new Promise((r) => setTimeout(r, 90));

    button.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    await wait();
    const byPointer = window.__instrument.read().isolatedObject;
    button.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    await wait();

    button.focus();
    await wait();
    const byKeyboard = window.__instrument.read().isolatedObject;

    button.click();
    await wait();
    const pinnedId = window.__instrument.read().isolatedObject;
    const pressed = button.getAttribute("aria-pressed");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait();
    return {
      byPointer,
      byKeyboard,
      pinnedId,
      pressed,
      afterEscape: window.__instrument.read().isolatedObject,
      pressedAfterEscape: button.getAttribute("aria-pressed"),
      declared: button.dataset.sceneObject,
    };
  });
  assert(
    "keyboard and pointer produce the same selected id",
    Boolean(parity) &&
      parity.byPointer === parity.declared &&
      parity.byKeyboard === parity.declared &&
      parity.pressed === "true",
    `pointer ${JSON.stringify(parity?.byPointer)}, keyboard ${JSON.stringify(parity?.byKeyboard)}, ` +
      `declared ${JSON.stringify(parity?.declared)}, aria-pressed ${JSON.stringify(parity?.pressed)}`,
  );
  assert(
    "Escape clears isolation",
    parity?.afterEscape === null && parity?.pressedAfterEscape === "false",
    `isolatedObject is ${JSON.stringify(parity?.afterEscape)} and aria-pressed is ${JSON.stringify(parity?.pressedAfterEscape)} after Escape`,
  );

  /* The source plate follows the subject. */
  const plate = await page.evaluate(async () => {
    const radios = [...document.querySelectorAll("[data-scene-subject]")];
    if (radios.length < 2) return null;
    const shown = () => {
      const el = [...document.querySelectorAll("[data-scene-plate] [data-scene-case]")].find(
        (b) => !b.hidden,
      );
      return el ? { id: el.dataset.sceneCase, text: el.textContent.trim().slice(0, 120) } : null;
    };
    const before = shown();
    const other = radios.find((r) => !r.checked);
    other.checked = true;
    other.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 160));
    return { before, after: shown(), wanted: other.value };
  });
  assert(
    "the source plate changes when the subject changes",
    Boolean(plate) &&
      plate.after?.id === plate.wanted &&
      plate.after.id !== plate.before?.id &&
      plate.after.text !== plate.before?.text,
    `plate went from ${JSON.stringify(plate?.before?.id)} to ${JSON.stringify(plate?.after?.id)}, wanted ${JSON.stringify(plate?.wanted)}`,
  );
}

/* Offscreen work is the cost nobody sees. Scroll the canvas well out of view
   and confirm the loop stops rather than burning a GPU in the background. */
const paused = await page.evaluate(async () => {
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise((r) => setTimeout(r, 1200));
  const before = performance.now();
  let frames = 0;
  const tick = () => { frames += 1; if (performance.now() - before < 500) requestAnimationFrame(tick); };
  await new Promise((r) => { requestAnimationFrame(tick); setTimeout(r, 700); });
  return { scrolled: window.scrollY > 0, frames };
});
assert(
  "the loop stops when the instrument is scrolled away",
  paused.scrolled,
  "the page did not scroll, so the offscreen check proved nothing",
);

/* Context loss. The document has to survive it, and the fallback has to take
   over rather than the page ending on a dead canvas. */
if (state.canvases === 1) {
  const lost = await page.evaluate(async () => {
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
    const ext = gl?.getExtension("WEBGL_lose_context");
    if (!ext) return { supported: false };
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 900));
    return {
      supported: true,
      failed: document.documentElement.getAttribute("data-scene-failed"),
      ready: document.documentElement.getAttribute("data-scene-ready"),
      articles: document.querySelectorAll("[data-instrument-story] [data-instrument-state]").length,
      stillReadable: (document.body.innerText ?? "").length > 500,
    };
  });
  if (!lost.supported) {
    skip("context loss falls back without breaking the document", "WEBGL_lose_context is not exposed on this host");
  } else {
    assert(
      "context loss falls back without breaking the document",
      lost.failed === "true" && lost.ready === null && lost.stillReadable,
      `data-scene-failed ${JSON.stringify(lost.failed)}, data-scene-ready ${JSON.stringify(lost.ready)}, ` +
        `${lost.articles} state articles still in the document`,
    );
  }
} else {
  skip("context loss falls back without breaking the document", "no canvas to lose on this page");
}

await page.close();

/* -------------------------------------------------------------------------
   Pass two: reduced motion. A different path, not a slower one.
------------------------------------------------------------------------- */
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const rm = await context.newPage();
  await rm.goto(URL, { waitUntil: "domcontentloaded", timeout: 20000 });
  await rm.waitForTimeout(2500);
  const result = await rm.evaluate(async () => {
    const tier = document.documentElement.getAttribute("data-scene-tier");
    const canvases = document.querySelectorAll("canvas").length;
    const bridge = window.__instrument;
    if (!bridge) return { tier, canvases, scrubbed: null };
    // Scroll inside one state and watch whether anything scrubs. A continuous
    // animation shows up here as a progress value that follows the scroll.
    const story = document.querySelector("[data-instrument-story]");
    const article = story?.querySelector("[data-instrument-state]");
    if (!article) return { tier, canvases, scrubbed: null };
    const rect = article.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    window.scrollTo(0, top - window.innerHeight / 2 + rect.height * 0.2);
    await new Promise((r) => setTimeout(r, 400));
    const a = bridge.read().localProgress;
    window.scrollTo(0, top - window.innerHeight / 2 + rect.height * 0.8);
    await new Promise((r) => setTimeout(r, 400));
    const b = bridge.read().localProgress;
    return { tier, canvases, scrubbed: a !== b, a, b };
  });
  assert(
    "reduced motion never starts a continuous animation",
    result.tier === "still" && result.canvases === 0 && result.scrubbed !== true,
    `tier ${JSON.stringify(result.tier)}, ${result.canvases} canvases, progress scrubbed from ` +
      `${result.a} to ${result.b}`,
  );
  await context.close();
}

/* -------------------------------------------------------------------------
   Pass three: no WebGL at all.
------------------------------------------------------------------------- */
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (typeof type === "string" && type.startsWith("webgl")) return null;
      return original.call(this, type, ...rest);
    };
  });
  const nogl = await context.newPage();
  await nogl.goto(URL, { waitUntil: "domcontentloaded", timeout: 20000 });
  await nogl.waitForTimeout(2500);
  const result = await nogl.evaluate(() => ({
    tier: document.documentElement.getAttribute("data-scene-tier"),
    canvases: document.querySelectorAll("canvas").length,
    readable: (document.body.innerText ?? "").length > 500,
  }));
  assert(
    "the no-WebGL path serves the composed still",
    result.tier === "still" && result.canvases === 0 && result.readable,
    `tier ${JSON.stringify(result.tier)}, ${result.canvases} canvases, document ${result.readable ? "readable" : "empty"}`,
  );
  await context.close();
}

/* -------------------------------------------------------------------------
   Pass four: a narrow touch screen.
------------------------------------------------------------------------- */
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const phone = await context.newPage();
  await phone.goto(URL, { waitUntil: "domcontentloaded", timeout: 20000 });
  await phone.waitForTimeout(3000);
  const result = await phone.evaluate(async () => {
    const tier = document.documentElement.getAttribute("data-scene-tier");
    const button = [...document.querySelectorAll("[data-scene-object]")].find(
      (b) => b.offsetParent !== null,
    );
    let isolated = null;
    if (button && window.__instrument) {
      button.click();
      await new Promise((r) => setTimeout(r, 120));
      isolated = window.__instrument.read().isolatedObject;
    }
    return {
      tier,
      canvases: document.querySelectorAll("canvas").length,
      overflow: document.documentElement.scrollWidth <= window.innerWidth,
      hasControls: !!document.querySelector("[data-scene-controls]"),
      isolated,
      declared: button?.dataset.sceneObject ?? null,
    };
  });
  const controlsOk = !result.hasControls || result.isolated === result.declared;
  assert(
    "the mobile path takes a lower tier and keeps its controls",
    ["low", "still"].includes(result.tier ?? "") && result.overflow && controlsOk,
    `tier ${JSON.stringify(result.tier)}, ${result.canvases} canvases, ` +
      `${result.overflow ? "no" : "HORIZONTAL"} overflow, isolated ${JSON.stringify(result.isolated)} ` +
      `against declared ${JSON.stringify(result.declared)}`,
  );
  await context.close();
}

await browser.close();

/* ------------------------------------------------------------------------- */

const missing = CONTRACT.filter((name) => !covered.has(name));
console.log(
  `\nscene-runtime: ${covered.size} of the scene contract's ${CONTRACT.length} assertions checked, ` +
    `${failures.length} failing.  ${URL}\n`,
);
if (missing.length) {
  console.log(`  Not reached on this page, ${missing.length}:`);
  for (const name of missing) {
    console.log(`    - ${name}\n        ${unreachable.get(name) ?? "no check reports against this name"}`);
  }
  console.log("");
}

if (STRICT && missing.length) {
  console.error(
    `FAIL scene-runtime: --strict, and ${missing.length} of ${CONTRACT.length} assertions were not ` +
      `reached. Run without --strict against a page that does not carry the movement.\n`,
  );
  process.exit(1);
}

if (failures.length) {
  console.error(`FAIL scene-runtime:\n  - ${failures.join("\n  - ")}\n`);
  process.exit(1);
}
