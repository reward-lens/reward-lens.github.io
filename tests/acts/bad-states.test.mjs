/**
 * Packet P4's driven tests for the rule that is the point of the packet.
 *
 *   node --test tests/acts/
 *
 * THE RULE. The reader must be able to reach a state that is bad for the
 * project, and the interface must not punish them for it. An interactive where
 * every path leads to a favourable result is an advertisement with sliders, and
 * this audience has seen many.
 *
 * WHAT A TEST HERE ASSERTS. What RENDERS in that state, never that the state
 * exists. A test that clicks a control and then asserts the control is checked
 * has tested the browser. Each test below drives the interface into the state
 * and then reads the number the reader would read.
 *
 * | act | the state that is bad for the project |
 * |-----|---------------------------------------|
 * | one | attribution's first pick, patched, moves the score by 0.0000% |
 * | two | the longest-lead detector shows its 60.7% surrogate false-alarm rate in the same viewport |
 * | three | the access toggle at log-only leaves 0, 0, 1 and 1 fields read |
 *
 * ACT THREE'S EXPECTED STATE IS THE CORRECTED ONE (C-46), AND IT IS THE POINT.
 * The earlier form of this file asserted "zero readings and thirteen refusals on
 * every card", which is what the contract and the copy both said. It is wrong.
 * Two cards drop to zero and thirteen; the two environment graders keep exactly
 * one, the single field countable from a log alone. A test that asserted the
 * slogan would have failed against correct data and been "fixed" by loosening
 * it, so it asserts the four cards' real counts by name.
 *
 * ACT ONE'S DATA FILE IS src/data/intervention.json. The earlier form of this
 * file waited on `src/data/attribution-patching.json`, which was never the
 * name, and described the finding as "on 6 of 12 dimensions a TOP-5 attribution
 * component moves the score by under 2%". The emitted data is stronger: the top
 * attribution component is the SAME component on all twelve dimensions, and on
 * three of them it patches to exactly zero.
 *
 * These run against BUILT OUTPUT served by `astro preview`, per HANDOFF.md §7:
 * a fix is verified against built output, never against a diff.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.P4_PORT ?? 4399);
const BASE = `http://localhost:${PORT}`;
const CHROME = "/opt/google/chrome/google-chrome";

const distPage = (route) => join(ROOT, "dist", route, "index.html");
const built = existsSync(distPage("see/run"));
const needsDist = { skip: built ? false : "run `npm run build` first" };

const readData = (name) =>
  JSON.parse(readFileSync(join(ROOT, "src", "data", name), "utf-8"));

let browser = null;
let server = null;

const startServer = () =>
  new Promise((resolve, reject) => {
    // Detached, so `kill(-pid)` in `after` takes the whole group down. Killing
    // only the npx wrapper leaves the node server holding the port and the test
    // process alive, which reads as a hung suite rather than a leaked child.
    server = spawn("npx", ["astro", "preview", "--port", String(PORT)], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
    });
    server.unref();
    const done = setTimeout(() => reject(new Error("preview did not start")), 30000);
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/see/run/`);
        if (r.ok) {
          clearInterval(poll);
          clearTimeout(done);
          resolve();
        }
      } catch {
        /* not up yet */
      }
    }, 500);
  });

before(async () => {
  if (!built) return;
  const { chromium } = await import("playwright");
  await startServer();
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});

after(async () => {
  await browser?.close();
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
});

const open = async (route, viewport = { width: 1440, height: 900 }) => {
  const page = await browser.newPage({ viewport });
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  return page;
};

/* =======================================================================
   Act one · attribution's first pick, patched, moving nothing
   ======================================================================= */

describe("act one: patching the top-ranked attribution component", () => {
  test("the movement renders under the null threshold, with the hint", needsDist, async () => {
    const page = await open("/see/reward-model/");

    // The row a reader picks precisely because it looks best: rank one in the
    // attribution list, which is the first row of that list by construction.
    const top = page.locator("[data-attribution-rank] button").first();
    const picked = await top.getAttribute("data-component");
    await top.click();

    // WHAT RENDERS. Not that a class changed: the number the reader reads.
    const movement = await page.locator("[data-score-movement]").innerText();
    const magnitude = Math.abs(parseFloat(movement.replace(/[^0-9.-]/g, "")));
    const threshold = readData("intervention.json").nullThreshold.value * 100;
    assert.ok(
      magnitude < threshold,
      `${picked} is attribution's first pick and patching it moved the score ` +
        `by ${movement}, which is not the state this act is about`,
    );

    const hint = page.locator("[data-null-state-hint]");
    assert.equal(await hint.isVisible(), true, "the null-state hint did not render");
    assert.ok((await hint.innerText()).trim().length > 0);

    // The hint is informational, never an error, and carries no warning styling.
    const cls = (await hint.getAttribute("class")) ?? "";
    assert.ok(!/error|warn|alert|danger/i.test(cls));

    // And the interface does not punish the reader for reaching it: both ranks
    // stay legible and the row stays selected rather than resetting.
    assert.equal(await top.getAttribute("aria-pressed"), "true");
    await page.close();
  });

  test("the original score marker does not move when a component is patched", needsDist, async () => {
    const page = await open("/see/reward-model/");
    const marker = page.locator("[data-original-score]");
    const before = await marker.boundingBox();
    await page.locator("[data-attribution-rank] button").first().click();
    const after = await marker.boundingBox();
    assert.deepEqual(
      { x: after.x, width: after.width },
      { x: before.x, width: before.width },
      "the original score marker moved. Displace, do not replace: a panel that " +
        "animates the bar from old to new has shown the reader a transition and " +
        "left them with one number.",
    );
    await page.close();
  });

  test("attribution's first pick is patching's last, and the page says so", needsDist, async () => {
    const page = await open("/see/reward-model/");
    const panel = page.locator("[data-intervention-panel]");
    const dimension = await panel.getAttribute("data-dimension");

    const raw = readData("intervention.json");
    const dim = raw.dimensions.find((d) => d.key === dimension);
    assert.ok(dim, `the panel opened on "${dimension}", which is not in the data`);

    const top = dim.components.find((c) => c.attributionRank === 1);
    assert.equal(
      top.id,
      dim.topAttributionComponent,
      "the generator's topAttributionComponent disagrees with its own ranks",
    );

    // The rendered row, not the file: the reader must be able to read the two
    // ranks off the page without opening anything.
    const first = panel.locator("[data-attribution-rank] button").first();
    assert.match(await first.innerText(), /\b1\b/);
    assert.match(await first.innerText(), new RegExp(top.id));

    const partner = panel.locator(`[data-patch-rank] button[data-component="${top.id}"]`);
    if ((await partner.count()) === 0) {
      // It is not in patching's head at all, which is the sharper finding. The
      // rail says which rank it did reach rather than dropping the connector.
      const rail = await panel.locator(".ip__rail").innerText();
      assert.match(
        rail,
        new RegExp(`${top.id}[\\s\\S]{0,40}${top.patchRank}`),
        `${top.id} has no endpoint in the patch head and the rail does not ` +
          `carry its real rank of ${top.patchRank}`,
      );
    }
    await page.close();
  });

  test("the 771% movement is in the data unclamped, and the axis is not capped", needsDist, () => {
    const raw = readData("intervention.json");
    const all = raw.dimensions.flatMap((d) =>
      d.components.map((c) => ({ d: d.key, id: c.id, f: c.patchFractionOfMargin })),
    );
    const max = all.reduce((a, b) => (b.f > a.f ? b : a));
    assert.ok(
      max.f > 1,
      "the movement axis is not bounded by 100%, and clipping it hides the " +
        "most surprising value in the set",
    );
    // A change detector on the largest value the study produced, so a later
    // pass that quietly clamps or rescales it fails here rather than shipping.
    assert.equal(max.d, "formatting");
    assert.equal(max.id, "mlp_L0");
    assert.equal(Number(max.f.toFixed(4)), 7.7106);
  });

  test("every rendered movement matches its source to the digit", needsDist, async () => {
    const page = await open("/see/reward-model/");
    const dimension = await page.locator("[data-intervention-panel]").getAttribute("data-dimension");
    const dim = readData("intervention.json").dimensions.find((d) => d.key === dimension);

    // textContent, not innerText: the complete table sits inside a closed
    // <details>, and innerText returns "" for every row of it, which collapses
    // sixty-four keys into one and reads as a missing table. The rows are in
    // the DOM and that is what the no-JavaScript path needs.
    //
    // And the VALUE is the citation trigger's text, not the cell's, because
    // every cell also holds the closed citation panel: reading the cell whole
    // returns the number with its document path welded to the end. That is the
    // component working; a test that reads the wrong node is the test failing.
    const rendered = await page.evaluate(() => {
      const out = {};
      for (const row of document.querySelectorAll(".ip__table tbody tr")) {
        const cells = [...row.querySelectorAll("th, td")];
        const text = (c) => (c.querySelector("[data-provenance]") ?? c).textContent.trim();
        out[text(cells[0])] = text(cells[3]);
      }
      return out;
    });

    assert.equal(
      Object.keys(rendered).length,
      dim.components.length,
      "the table does not carry every component the study measured",
    );
    for (const c of dim.components) {
      assert.equal(
        rendered[c.id],
        `${(c.patchFractionOfMargin * 100).toFixed(4)}%`,
        `${c.id}'s rendered movement does not match its source value`,
      );
    }
    await page.close();
  });
});

/* =======================================================================
   Act two · the longest-lead detector, and its false-alarm rate
   ======================================================================= */

describe("act two: selecting the longest-lead detector", () => {
  test("its surrogate false-alarm rate renders on the control itself", needsDist, async () => {
    const page = await open("/see/run/");

    // The longest lead in the study is the variance level's, and it is the row
    // a reader picks precisely because it looks best.
    const row = page.locator('[data-detectors] label[for$="variance_level"]');
    await row.click();

    const checked = await page
      .locator('[data-detector-input][value="variance_level"]')
      .isChecked();
    assert.equal(checked, true, "the row a reader clicked did not select");

    // What renders: the rate is inside the same row, not in a caption further
    // down. A reader who picks the most impressive detector reads its
    // false-alarm rate in the same gesture.
    const cells = page.locator("[data-detectors] .ts__cell--rate");
    const text = (await cells.nth(0).innerText()).replace(/\s+/g, " ");
    const rate = readData("run-series.json").detectors.find(
      (d) => d.key === "variance_level",
    ).surrogateRate;
    assert.match(
      text,
      new RegExp(`${(rate * 100).toFixed(1)}\\s?%`),
      `the variance level's row does not render its surrogate rate. Got: ${text}`,
    );

    await page.close();
  });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(
      `the rate is in the same viewport as the control at ${viewport.width}x${viewport.height}`,
      needsDist,
      async () => {
        const page = await open("/see/run/", viewport);
        const label = page.locator('[data-detectors] label[for$="variance_level"]');
        await label.scrollIntoViewIfNeeded();
        await label.click();

        const control = await label.boundingBox();
        const rate = await page
          .locator("[data-detectors] .ts__cell--rate")
          .nth(0)
          .boundingBox();

        assert.ok(control && rate, "the control or its rate did not render");

        // Acceptance criterion 2 of components/timeline-scrubber.md: the rate is
        // displayed in the same viewport, without scrolling. The strongest form
        // of that is the two boxes sharing a scanline, which is what putting
        // both numbers on one control buys.
        const overlap =
          Math.min(control.y + control.height, rate.y + rate.height) -
          Math.max(control.y, rate.y);
        assert.ok(
          overlap > 0,
          `the rate is not on the same row as the control it belongs to ` +
            `(control y ${control.y}, rate y ${rate.y})`,
        );
        assert.ok(
          rate.y >= 0 && rate.y + rate.height <= viewport.height,
          `the rate is outside the viewport the reader clicked in`,
        );
        await page.close();
      },
    );
  }

  test("the table is in the study's order, never sorted by lead", needsDist, () => {
    const html = readFileSync(distPage("see/run"), "utf-8");
    const order = [...html.matchAll(/<input[^>]*\bvalue="([a-z_]+)"[^>]*\bdata-detector-input/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(
      order,
      readData("run-series.json").detectors.map((d) => d.key),
      "the detector rows are not in the order the study evaluated them. " +
        "Sorting by lead descending puts the worthless detector first with no " +
        "counterweight (components/timeline-scrubber.md, Usage).",
    );
  });

  test("the comparator's lag is read from the data, never derived", needsDist, () => {
    // C-42: the value 27 used to exist only inside a prose string, and a page
    // computing it from `133 - 106.0` produces a number the rendered HTML
    // cannot resolve. P1 emits it; this fails if it is ever recomputed.
    const comparator = readData("run-series.json").detectors.find(
      (d) => d.key === "gradient_norm_peak",
    );
    assert.equal(typeof comparator.comparatorLagSteps, "number");
    const html = readFileSync(distPage("see/run"), "utf-8");
    assert.ok(
      !html.includes("{{comparator_lag_steps}}"),
      "the result sentence still carries its placeholder",
    );
  });

  test("moving the handle keeps every readout number inside its citation", needsDist, async () => {
    const page = await open("/see/run/");
    const range = page.locator("[data-range]");
    await range.focus();
    for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowRight");

    const bare = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("[data-readout-row] .ts__ro-value")) {
        const hasCitation = !!el.querySelector("[data-provenance]");
        const isNull = !!el.querySelector("[aria-hidden='true']");
        if (!hasCitation && !isNull) out.push(el.textContent.trim());
      }
      return out;
    });
    assert.deepEqual(
      bare,
      [],
      "the scripted path replaced a readout value and dropped its citation",
    );
    await page.close();
  });
});

/* =======================================================================
   Act three · the access toggle at log only
   ======================================================================= */

describe("act three: the access toggle at log only", () => {
  test("the cards keep 0, 0, 1 and 1 readings, and every refusal has a remedy", needsDist, async () => {
    const page = await open("/see/grader/");
    await page.locator("[data-access-control]").selectOption("log_only");

    const state = page.locator('[data-access-state="log_only"]');
    assert.equal(await state.isVisible(), true, "the log-only state did not show");
    assert.equal(
      await page.locator('[data-access-state="full"]').isVisible(),
      false,
      "both access states are showing on the scripted path",
    );

    const expected = readData("grader-cards.json").cards;
    const cards = state.locator("[data-grader-card]");
    assert.equal(
      await cards.count(),
      expected.length,
      "the four subjects did not all render at log-only access",
    );

    // WHAT RENDERS, per card, by name. Not "every card drops to zero": that is
    // the sentence C-46 corrected, and asserting it would fail against correct
    // data and get loosened by whoever went to fix it.
    for (let i = 0; i < expected.length; i += 1) {
      const card = cards.nth(i);
      const want = expected[i].access.log_only;
      assert.equal(
        await card.locator("[data-field-kind='reading']").count(),
        want.readCount,
        `${expected[i].key} rendered the wrong number of readings at log-only ` +
          `access. The four are 0, 0, 1, 1: two drop to nothing and the two ` +
          `environment graders keep the one field countable from a log alone.`,
      );
      assert.equal(
        await card.locator("[data-field-kind='refusal']").count(),
        want.refusedCount,
        `${expected[i].key} rendered the wrong number of refusals`,
      );
      // A refusal without a remedy is not a refusal.
      assert.equal(
        await card.locator("[data-refusal-remedy]").count(),
        want.refusedCount,
        `${expected[i].key} rendered a refusal with no remedy`,
      );
    }

    // Two of the four keep exactly one, and it is the same field on both. That
    // is the fact the corrected claim buys and the slogan threw away.
    const kept = expected.filter((c) => c.access.log_only.readCount === 1);
    assert.equal(kept.length, 2);
    const names = new Set(
      kept.map(
        (c) => c.access.log_only.fields.find((f) => f.state === "read").name,
      ),
    );
    assert.equal(names.size, 1, "the two survivors are not the same field");
    await page.close();
  });

  test("the emptied card is not punished: every refusal keeps its detail and remedy", needsDist, async () => {
    const page = await open("/see/grader/");
    await page.locator("[data-access-control]").selectOption("log_only");
    const card = page
      .locator('[data-access-state="log_only"] [data-grader-card]')
      .first();

    const rows = card.locator("[data-field-kind='refusal']");
    const n = await rows.count();
    assert.equal(n, 13, "the first card did not refuse all thirteen");
    for (let i = 0; i < n; i += 1) {
      const text = (await rows.nth(i).innerText()).trim();
      assert.ok(
        text.length > 40,
        `a refused field rendered as an empty cell, a dash or an n/a. A ` +
          `refusal is not a missing value; it is a reading with a reason and a ` +
          `remedy. Got: "${text}"`,
      );
    }
    await page.close();
  });

  test("both access states render with scripting off, complete", needsDist, () => {
    // The contract's No JavaScript row, and it is arguably the better exhibit:
    // both states visible at once instead of one at a time.
    const html = readFileSync(distPage("see/grader"), "utf-8");
    for (const state of ["full", "log_only"]) {
      assert.ok(
        html.includes(`data-access-state="${state}"`),
        `the ${state} access state is not in the built HTML`,
      );
    }
    const readings = (html.match(/data-field-kind="reading"/g) ?? []).length;
    const refusals = (html.match(/data-field-kind="refusal"/g) ?? []).length;
    const cards = readData("grader-cards.json");
    const want = ["full", "log_only"].reduce(
      (acc, s) => ({
        read: acc.read + cards.cards.reduce((n, c) => n + c.access[s].readCount, 0),
        refused: acc.refused + cards.cards.reduce((n, c) => n + c.access[s].refusedCount, 0),
      }),
      { read: 0, refused: 0 },
    );
    assert.equal(readings, want.read, "a reading is missing from the built HTML");
    assert.equal(refusals, want.refused, "a refusal is missing from the built HTML");
  });

  test("no refusal is styled as an error, in either access state", needsDist, () => {
    const html = readFileSync(distPage("see/grader"), "utf-8");
    assert.ok(!/role="alert"/.test(html), "a refusal announced as an alert");
    assert.ok(!/⚠|&#9888;/.test(html), "a warning glyph reached the page");
    assert.ok(
      !/class="[^"]*\b(error|danger|warning)\b/.test(html),
      "an error class reached a page whose subject is that a refusal is a reading",
    );
  });

  test("the refusal list is flat, seventeen, never grouped into invented classes", needsDist, () => {
    // D-09: the library sorts exactly three of the seventeen by where the
    // remedy is answerable and assigns the other fourteen to no group.
    // Inventing fourteen classifications would be the site asserting a taxonomy
    // its own subject does not hold.
    const html = readFileSync(distPage("see/grader"), "utf-8");
    assert.ok(
      !/data-refusal-group=/.test(html),
      "a refusal carried a group attribute on a page that must not assign one",
    );
    const list = html.slice(html.indexOf("data-refusal-list"));
    const items = (list.match(/class="rl__item"/g) ?? []).length;
    const reasons = readData("refusals.json");
    assert.equal(items, reasons.counts.reasons);
    assert.equal(items, 17);
    // The full class, or `rl__remedy-label` matches too and every one of the
    // three counts twice.
    const remedies = (
      list.slice(0, list.indexOf("</section>")).match(/class="rl__remedy type/g) ?? []
    ).length;
    assert.equal(
      remedies,
      reasons.counts.sorted,
      "the number of reasons carrying a remedy mapping is not the three the " +
        "library actually sorts",
    );
  });
});

/* =======================================================================
   Part 6, on every act
   ======================================================================= */

describe("every act ends with a runnable path", () => {
  const bundles = readData("bundles.json").bundles;
  for (const bundle of bundles) {
    const route = bundle.route.replace(/^\/|\/$/g, "");
    test(`${bundle.route} states a command and its expected output`, needsDist, () => {
      const html = readFileSync(distPage(route), "utf-8");
      assert.ok(html.includes("data-bundle-panel"), "no bundle panel on the route");
      assert.ok(html.includes(bundle.sha256), "the panel does not carry the full hash");
      assert.ok(
        html.includes(bundle.expectedOutput.split("\n")[0]),
        "the panel does not state the expected output",
      );
      assert.ok(
        html.includes(`href="${bundle.href}"`),
        "the panel does not link the artifact",
      );
      // The most credible thing on the panel, and it is negative on all three.
      assert.equal(bundle.reproducedBy, null);
      assert.ok(html.includes("No independent reproduction recorded."));
    });

    test(`${bundle.route}'s artifact is on disk at the size the manifest states`, needsDist, () => {
      const file = join(ROOT, "public", bundle.href.replace(/^\//, ""));
      assert.ok(existsSync(file), `public${bundle.href} does not exist`);
      assert.equal(
        readFileSync(file).length,
        bundle.sizeBytes,
        "D-08: derived from the artifact, never asserted",
      );
    });
  }
});

/* =======================================================================
   The parts, on every act
   ======================================================================= */

describe("the six-part structure", () => {
  for (const route of ["see/run", "see/reward-model", "see/grader"]) {
    test(`${route} renders six parts, in order, none empty`, needsDist, () => {
      const html = readFileSync(distPage(route), "utf-8");
      const parts = [...html.matchAll(/data-part="(\d)"/g)].map((m) => m[1]);
      assert.deepEqual(parts, ["1", "2", "3", "4", "5", "6"]);
    });

    test(`${route} has exactly one h1, and it is part 1`, needsDist, () => {
      const html = readFileSync(distPage(route), "utf-8");
      const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
      assert.equal((main.match(/<h1[\s>]/g) ?? []).length, 1);
      const levels = [...main.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
      assert.equal(levels[0], 1, "the page does not open at level one");
      for (let i = 1; i < levels.length; i += 1) {
        assert.ok(
          levels[i] - levels[i - 1] <= 1,
          `the outline skips from h${levels[i - 1]} to h${levels[i]}`,
        );
      }
    });

    test(`${route} uses no page-header`, needsDist, () => {
      // components/page-header.md acceptance 8: no route renders both a
      // page-header and an act-section part 1. Part 1's question is the header.
      const html = readFileSync(distPage(route), "utf-8");
      assert.ok(!/data-page-header/.test(html));
    });

    test(`${route}: part 5 occupies at least as much space as part 4`, needsDist, async () => {
      // pages/see-run.md:125, see-reward-model.md:188 and see-grader.md:184.
      // MEASURED, not judged, at every width, because the temptation to
      // compress part 5 is exactly the failure that acceptance guards against.
      for (const width of [390, 768, 1440]) {
        const page = await open(`/${route}/`, { width, height: 900 });
        const [four, five] = await page.evaluate(() =>
          ["4", "5"].map((n) =>
            Math.round(
              document.querySelector(`[data-part="${n}"]`).getBoundingClientRect().height,
            ),
          ),
        );
        assert.ok(
          five >= four,
          `${route} at ${width}: part 5 is ${five}px against part 4's ${four}px. ` +
            `If part 4 overtakes, part 5 grows; part 4 does not shrink.`,
        );
        await page.close();
      }
    });
  }
});
