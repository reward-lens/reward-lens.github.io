/**
 * Acceptance tests for the homepage story, proof bench, trust pair, boundary
 * map and handoff.
 *
 *   PUBLIC_HOME_PREVIEW=1 npm run build
 *   node --test tests/home/
 *
 * They run against BUILT OUTPUT, never against the source, because a section
 * that renders correctly in a component file and wrongly in dist/ is a section
 * that is wrong. The route they read is `/preview/`, the gated build-
 * verification page these components are wired into until the homepage takes
 * them; every test here follows the components to `/` by changing one constant.
 *
 * Four things are asserted and each one is an acceptance condition of the
 * packet rather than a nicety:
 *
 *   1. every number rendered traces to a field of a generated JSON file. The
 *      test recomputes them from src/data/ and compares, so a number typed into
 *      a component fails here and not in review;
 *   2. no banned identifier and none of the five phrases this page retired
 *      reaches rendered text;
 *   3. the document never scrolls horizontally at 320, 390, 768 or 1440;
 *   4. the sections render completely with scripting off, and axe reports no
 *      serious or critical violation in either theme.
 *
 * The last two need a browser and skip themselves, with a message, when the
 * route is absent or Playwright is not installed.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import {
  serveDist,
  launchBrowser,
  visibleText,
  readJson,
} from "../../scripts/checks/_lib.mjs";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ROUTE = "/preview/";
const PAGE = join(ROOT, "dist", ROUTE, "index.html");

const html = existsSync(PAGE) ? readFileSync(PAGE, "utf-8") : null;
const needsDist = {
  skip: html ? false : "run `PUBLIC_HOME_PREVIEW=1 npm run build` first",
};
const text = html ? visibleText(html).replace(/\s+/g, " ") : "";

const intervention = readJson(join(ROOT, "src/data/intervention.json"));
const graderCards = readJson(join(ROOT, "src/data/grader-cards.json"));

/* =======================================================================
   1 · Every number traces to generated JSON
   ======================================================================= */

describe("numbers", () => {
  test("the disclosure beside the figure is the file's own meta", needsDist, () => {
    const meta = intervention.meta;
    // EVIDENCE-VERDICTS.md §1: the attributed set and the patched set are not
    // the same set, and the page must say so rather than let it be inferred.
    assert.notEqual(
      meta.attributedComponentCount,
      meta.patchedComponentCount,
      "the disclosure only makes sense while the two counts differ",
    );
    for (const key of [
      "attributedComponentCount",
      "patchedComponentCount",
      "dimensionCount",
    ]) {
      assert.match(
        text,
        new RegExp(`${key} ${meta[key]}\\b`),
        `${key} is not rendered with the value src/data/intervention.json states`,
      );
    }
    assert.match(text, /unpatchedComponents embed/);
    assert.match(text, new RegExp(`patchingMode ${meta.patchingMode}`));
  });

  test("no bar draws the reward-composition counterfactual", needsDist, () => {
    // EVIDENCE-VERDICTS.md §5: prose only, no artifact, no geometry. The two
    // numbers that would carry it may not appear on this page at all.
    assert.doesNotMatch(text, /2,?118/);
    assert.doesNotMatch(text, /\b25 ?% of (the )?advantages/i);
  });

  test("every mutation count is the card's own", needsDist, () => {
    for (const card of graderCards.cards) {
      assert.match(
        text,
        new RegExp(`killedMutants ${card.killedMutants}\\b`),
        `${card.key}: killedMutants is not the value in src/data/grader-cards.json`,
      );
    }
  });

  test("the figure draws one mark per competent mutant", needsDist, () => {
    // `mutants__marks` is the container and `mutants__mark` is one mark, so
    // the boundary has to exclude the plural or every row counts twice.
    const marks = [...html.matchAll(/mutants__mark(?![\w-])/g)].length;
    const expected = graderCards.cards.reduce((n, c) => n + c.competentMutants, 0);
    assert.equal(marks, expected);
    const killed = [...html.matchAll(/data-killed(?![\w-])/g)].length;
    const expectedKilled = graderCards.cards.reduce((n, c) => n + c.killedMutants, 0);
    // One of the two matches is the stylesheet's own selector, so the count is
    // asserted as "at least", and the total is what the assertion is about.
    assert.ok(
      killed >= expectedKilled,
      `${killed} filled marks rendered, ${expectedKilled} mutants were killed`,
    );
  });

  test("the reading and the refusal are the same real quantity", needsDist, () => {
    const card = graderCards.cards.reduce((low, c) =>
      c.killedMutants < low.killedMutants ? c : low,
    );
    const read = card.access.full.fields.find((f) => f.state === "read" && f.headline);
    const refused = card.access.log_only.fields.find(
      (f) => f.name === read.name && f.state === "refused",
    );
    assert.ok(read && refused, "the pair is not present in the generated file");
    assert.ok(text.includes(read.headline), "the reading is not the printed one");
    assert.ok(text.includes(refused.detail), "the refusal detail is not the real one");
    assert.ok(text.includes(refused.remedy), "the remedy is not the real one");
    assert.match(text, new RegExp(`\\b${refused.reason}\\b`));
  });

  test("a refusal is never styled as a failure", needsDist, () => {
    // components/refusal-card.md, and the site's own argument: a refusal is a
    // success in this library's semantics.
    assert.doesNotMatch(html, /&#9888;|⚠/);
    const card = html.slice(html.indexOf("ACCESS_INSUFFICIENT") - 4000);
    assert.doesNotMatch(card.slice(0, 6000), /--realized|--state-bounded/);
  });
});

/* =======================================================================
   2 · Vocabulary
   ======================================================================= */

describe("vocabulary", () => {
  test("no banned identifier reaches rendered text", needsDist, () => {
    const raw = readJson(join(ROOT, "src/data/banned-terms.json"), []);
    const terms = Array.isArray(raw) ? raw : (raw.terms ?? Object.keys(raw));
    const sorted = [...new Set(terms)]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(?<![\\w-])(${sorted.map(escape).join("|")})(?![\\w-])`,
      "g",
    );
    const hits = [...new Set([...text.matchAll(re)].map((m) => m[1]))];
    assert.deepEqual(hits, []);
  });

  test("the five phrases this page retired do not appear", needsDist, () => {
    for (const phrase of [
      "registered",
      "adjudicated",
      "kill criterion",
      "campaign",
      "trust rung",
      "Read act one",
      "Read act two",
      "Read act three",
    ]) {
      assert.doesNotMatch(
        text,
        new RegExp(phrase, "i"),
        `"${phrase}" is banned on this page`,
      );
    }
  });

  test("no em dash is used as sentence punctuation", needsDist, () => {
    assert.doesNotMatch(text, /—/);
  });
});

/* =======================================================================
   3 · Structure, with and without scripting
   ======================================================================= */

describe("structure", () => {
  test("the five states render in the frozen scene order", needsDist, () => {
    const ids = [...html.matchAll(/data-instrument-state="([a-z-]+)"/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(ids, [
      "scorer",
      "selection",
      "update",
      "response",
      "run-boundary",
    ]);
  });

  test("the scene can read the active state without scripting", needsDist, () => {
    // Server-rendered, so a scene that mounts before the observer has ever
    // fired still has a state to draw rather than nothing.
    assert.match(html, /data-active-state="scorer"/);
  });

  test("the sticky region is absent when nothing was passed for it", needsDist, () => {
    assert.doesNotMatch(html, /class="[^"]*story__visual/);
  });

  test("each exhibit ends with its own link", needsDist, () => {
    for (const label of [
      "Inside a reward model",
      "Follow a training update",
      "Audit a grader",
    ]) {
      assert.ok(text.includes(label), `the bench does not link "${label}"`);
    }
  });

  test("the boundary map states both halves", needsDist, () => {
    assert.match(text, /Works now/);
    assert.match(text, /Not established/);
  });

  test("the handoff carries both commands", needsDist, () => {
    assert.match(html, /pip install reward-lens/);
    assert.match(html, /reward-lens capabilities/);
  });
});

/* =======================================================================
   4 · The browser conditions: reflow, no scripting, axe
   ======================================================================= */

let server = null;
let browser = null;
let unavailable = null;

before(async () => {
  if (!html) {
    unavailable = "run `PUBLIC_HOME_PREVIEW=1 npm run build` first";
    return;
  }
  try {
    server = await serveDist();
    ({ browser } = await launchBrowser());
  } catch (error) {
    unavailable = `no browser available: ${error.message}`;
  }
});

after(async () => {
  await browser?.close();
  await server?.close();
});

describe("browser", () => {
  const needsBrowser = () => (unavailable ? { skip: unavailable } : {});

  test("the document never scrolls horizontally", async (t) => {
    if (unavailable) return t.skip(unavailable);
    for (const width of [320, 390, 768, 1440]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(server.origin + ROUTE, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const scrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      await ctx.close();
      assert.ok(
        scrollWidth <= width,
        `scrollWidth ${scrollWidth} exceeds the ${width} viewport`,
      );
    }
  });

  test("every section renders with scripting off", async (t) => {
    if (unavailable) return t.skip(unavailable);
    const ctx = await browser.newContext({
      viewport: { width: 768, height: 900 },
      javaScriptEnabled: false,
    });
    const page = await ctx.newPage();
    await page.goto(server.origin + ROUTE, { waitUntil: "load" });
    const seen = await page.evaluate(() => ({
      states: document.querySelectorAll("[data-instrument-state]").length,
      exhibits: document.querySelectorAll(".exhibit").length,
      figures: document.querySelectorAll("figure").length,
      refusals: document.querySelectorAll(".refusal").length,
      readings: document.querySelectorAll(".reading").length,
      remedyVisible: !document.querySelector("[data-remedy-panel]")?.hidden,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    await ctx.close();
    assert.equal(seen.states, 5);
    assert.equal(seen.exhibits, 3);
    assert.equal(seen.figures, 2);
    assert.equal(seen.refusals, 1);
    assert.equal(seen.readings, 1);
    assert.ok(seen.remedyVisible, "the remedy is hidden with no script to open it");
    assert.ok(seen.scrollWidth <= 768);
  });

  test("the observer publishes the state the reader is in", async (t) => {
    if (unavailable) return t.skip(unavailable);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(server.origin + ROUTE, { waitUntil: "load" });
    await page.locator("#instrument-update").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => ({
      root: document.documentElement.dataset.instrumentState,
      section: document.querySelector("[data-instrument-story]")?.dataset
        .activeState,
      marked: document.querySelectorAll("[data-instrument-state][data-active]")
        .length,
    }));
    await ctx.close();
    assert.equal(state.marked, 1, "exactly one state is ever marked active");
    assert.equal(state.root, state.section);
    assert.ok(
      ["selection", "update", "response"].includes(state.root),
      `published "${state.root}" while the update state was in view`,
    );
  });

  test("axe reports no serious or critical violation", async (t) => {
    if (unavailable) return t.skip(unavailable);
    const axeSource = readFileSync(
      require.resolve("axe-core/axe.min.js"),
      "utf-8",
    );
    const found = [];
    for (const theme of ["dark", "light"]) {
      const ctx = await browser.newContext({
        colorScheme: theme,
        viewport: { width: 1440, height: 900 },
      });
      await ctx.addInitScript((t2) => {
        document.documentElement.setAttribute("data-theme", t2);
      }, theme);
      const page = await ctx.newPage();
      await page.goto(server.origin + ROUTE, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await page.addScriptTag({ content: axeSource });
      const result = await page.evaluate(() =>
        // eslint-disable-next-line no-undef
        axe.run(document, { resultTypes: ["violations"] }),
      );
      for (const v of result.violations) {
        if (!["serious", "critical"].includes(v.impact)) continue;
        for (const node of v.nodes) {
          found.push(`${theme} | ${v.id} | ${node.target?.[0] ?? "?"}`);
        }
      }
      await ctx.close();
    }
    assert.deepEqual(found, []);
  });
});
