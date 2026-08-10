/**
 * The demonstration routes: public vocabulary, and the adverse state on each.
 *
 *   node --test tests/acts/
 *
 * WHAT THIS FILE IS FOR, AND HOW IT DIFFERS FROM bad-states.test.mjs. That file
 * drives the three instruments into the state that is bad for the project and
 * reads the number a reader would read. This one asserts the two things that
 * file cannot: that no page under `/see/` speaks the archive's vocabulary, and
 * that each route's own adverse disclosure is ON THE PAGE beside the result it
 * bounds rather than somewhere further down.
 *
 * THE SERVER IDENTITY CHECK IS NOT PARANOIA. `astro preview --port N` binds a
 * DIFFERENT port when N is taken and prints the one it got. Several worktrees
 * run at once. A suite that fetches a port another worktree holds passes
 * against a real, correctly rendered site of the wrong branch, and nothing
 * downstream catches it. So `before` reads a marker out of THIS checkout's
 * `dist/` and asserts the served page carries the same one; if it does not, the
 * whole driven suite fails immediately rather than reporting green.
 *
 * The static assertions need no server and run from `dist/` directly, which is
 * also what makes them the ones to trust.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.SEE_ROUTES_PORT ?? 4407);
const BASE = `http://localhost:${PORT}`;
const CHROME = "/opt/google/chrome/google-chrome";

const ROUTES = ["see", "see/reward-model", "see/run", "see/grader"];
const distPage = (route) => join(ROOT, "dist", route, "index.html");
const built = ROUTES.every((r) => existsSync(distPage(r)));
const needsDist = { skip: built ? false : "run `npm run build` first" };

const html = (route) => readFileSync(distPage(route), "utf-8");
const readData = (name) =>
  JSON.parse(readFileSync(join(ROOT, "src", "data", name), "utf-8"));

/* =======================================================================
   Static · the vocabulary, read off built output
   ======================================================================= */

describe("the demonstration routes speak no archive vocabulary", () => {
  /* Each entry is a term this dispatch bans from `/see/**` and the public form
     that replaces it. `registered` catches `preregistered` on purpose. */
  const BANNED = [
    ["registered", "frozen before the data, or named in advance"],
    ["adjudicat", "resolved, supported, refuted, or inconclusive"],
    ["kill criterion", "the result contradicted the prediction"],
    ["campaign", "research log, and only under /log/"],
    ["act one", "the route's own name"],
    ["act two", "the route's own name"],
    ["act three", "the route's own name"],
  ];

  for (const route of ROUTES) {
    for (const [term, instead] of BANNED) {
      test(`/${route}/ contains no "${term}"`, needsDist, () => {
        const source = html(route);
        const at = source.toLowerCase().indexOf(term.toLowerCase());
        assert.equal(
          at,
          -1,
          `"${term}" is in dist/${route}/index.html at byte ${at}. Use: ${instead}. ` +
            `Context: ${JSON.stringify(source.slice(Math.max(0, at - 120), at + 120))}`,
        );
      });
    }

    test(`/${route}/ ships no unfilled placeholder`, needsDist, () => {
      const source = html(route);
      const hit = source.match(/\{\{\s*[a-z0-9_.]+\s*\}\}/i);
      assert.equal(
        hit,
        null,
        `dist/${route}/index.html renders a literal ${hit?.[0]}. A copy string ` +
          `reached HTML with a placeholder the route did not bind. act-prose ` +
          `leaves an unbound key visible on purpose, so this is a missing bind ` +
          `and not a rendering bug.`,
      );
    });
  }
});

/* =======================================================================
   Static · every route's adverse disclosure is where it bounds something
   ======================================================================= */

describe("each route carries its own adverse state", () => {
  test("/see/reward-model/ shows a top attribution component moving under the null threshold", needsDist, () => {
    const data = readData("intervention.json");
    const threshold = data.nullThreshold.value;
    const topOf = (d) =>
      d.components.find((c) => c.id === d.topAttributionComponent) ??
      [...d.components].sort((a, b) => a.attributionRank - b.attributionRank)[0];

    /* The rule the route applies: the FIRST dimension in the generator's order
       where the reader can reach the adverse state in one gesture, not the one
       that looks worst. */
    const opening = data.dimensions.find(
      (d) => Math.abs(topOf(d).patchFractionOfMargin) < threshold,
    );
    assert.ok(
      opening,
      "no dimension has a top attribution component moving less than the null " +
        "threshold, so the panel cannot open on the adverse state and this " +
        "route's argument has nothing behind it.",
    );

    const moved = `${(topOf(opening).patchFractionOfMargin * 100).toFixed(4)}%`;
    const source = html("see/reward-model");
    assert.ok(
      source.includes(moved),
      `the movement ${moved} on ${opening.key}/${topOf(opening).id} is not on ` +
        `the page. It is the number a reader reaches by clicking the highest ` +
        `attribution bar, and it is the whole demonstration.`,
    );
  });

  test("/see/reward-model/ prints the largest movement without clamping it", needsDist, () => {
    const data = readData("intervention.json");
    const topOf = (d) =>
      d.components.find((c) => c.id === d.topAttributionComponent) ??
      [...d.components].sort((a, b) => a.attributionRank - b.attributionRank)[0];
    const largest = data.dimensions
      .map((d) => Math.abs(topOf(d).patchFractionOfMargin))
      .reduce((a, b) => Math.max(a, b), 0);
    assert.ok(largest > 1, "the set no longer contains a movement above 100%");

    const rendered = `${(largest * 100).toFixed(4)}%`;
    assert.ok(
      html("see/reward-model").includes(rendered),
      `${rendered} is not on the page. The largest movement in the set is over ` +
        `seven times the margin it moves and it is not clamped to 100%: a ` +
        `bounded axis would hide the strongest evidence that the two rankings ` +
        `are measuring different things.`,
    );
  });

  test("/see/reward-model/ discloses that the two rankings cover different component sets", needsDist, () => {
    const meta = readData("intervention.json").meta;
    assert.notEqual(
      meta.attributedComponentCount,
      meta.patchedComponentCount,
      "the counts now agree, so the disclosure describes a difference that is " +
        "not there. Remove it together with this test.",
    );
    const source = html("see/reward-model");
    for (const needle of [
      String(meta.attributedComponentCount),
      String(meta.patchedComponentCount),
      ...meta.unpatchedComponents,
    ]) {
      assert.ok(
        source.includes(needle),
        `"${needle}" is not on the page. EVIDENCE-VERDICTS.md section 1 makes ` +
          `this disclosure mandatory: the correlation is taken over the smaller ` +
          `set and a reader must not have to infer that.`,
      );
    }
  });

  test("/see/reward-model/ carries the second model, so the page is not read as attribution being wrong", needsDist, () => {
    const source = html("see/reward-model");
    assert.ok(
      source.includes("+0.047465"),
      "the second model's rank correlation is not on the page. Twelve " +
        "negative-leaning correlations on one model read as a verdict against " +
        "attribution; a near-zero relationship on another model is what refuses " +
        "that reading, and the route may not drop it.",
    );
    assert.ok(
      source.includes("fixtures/e_parity/golden.json"),
      "the second model's value renders without the fixture it was read from. " +
        "Every number on this site resolves to something a reader can open.",
    );
  });

  test("/see/reward-model/ keeps the correction trail, deprecated value included", needsDist, () => {
    const correction = readData("intervention.json").headline.correction;
    const source = html("see/reward-model");
    assert.ok(
      source.includes(String(correction.deprecatedRho)),
      "the superseded correlation is not on the page. The project corrected " +
        "itself against its own fixtures and both values belong here.",
    );
    assert.ok(
      source.includes(String(correction.supersedingRhoAsQuoted)),
      "the superseding value as quoted is not on the page.",
    );
  });

  test("/see/run/ never captions the ledger's step count against the plotted series", needsDist, () => {
    const data = readData("run-series.json");
    assert.notEqual(
      data.meta.stepCount,
      data.steps.length,
      "the ledger's step count now equals the plotted length, so the " +
        "disagreement note states a difference that is not there.",
    );

    const source = html("see/run");
    /* Both numbers are on the page and the page says they disagree. What must
       never happen is the lower one standing alone as the length of the run. */
    assert.ok(
      source.includes(String(data.meta.stepCount)),
      "the ledger's step count is missing entirely.",
    );
    assert.ok(
      source.includes(String(data.steps.length)),
      `the plotted length ${data.steps.length} is not on the page. The ` +
        `instrument draws every index in the rollout table and the reader is ` +
        `told the ledger's lower figure, which is the quiet contradiction the ` +
        `disagreement note exists to prevent.`,
    );
    assert.ok(
      /lower of two records/i.test(source),
      "nothing on the page marks the ledger's step count as the lower of two " +
        "disagreeing records.",
    );
  });

  test("/see/run/ shows the rejected signals' false-alarm rates, not only the kept one", needsDist, () => {
    const detectors = readData("run-series.json").detectors;
    const source = html("see/run");
    for (const d of detectors) {
      if (d.surrogateRate === null) continue;
      const shown = `${(d.surrogateRate * 100).toFixed(1)}%`;
      assert.ok(
        source.includes(shown),
        `${d.key}'s surrogate false-alarm rate ${shown} is not on the page. ` +
          `The signal that leads by most is the one that was thrown away, and a ` +
          `page showing leads without rates is an advertisement.`,
      );
    }

    /* THE ROW ORDER IS THE STUDY'S OWN. Sorted by lead it puts the worthless
       detector first with no counterweight, which is the one arrangement this
       control must never take.

       Read off the radio values rather than the labels. Two detectors share a
       label stem ("Within-group reward variance, level" and ", derivative"),
       and the comparator's label is translated at the route boundary, so
       neither the stem nor the stored string identifies a row. The key does,
       it is never translated, and it is the value a reader's selection
       actually submits. */
    const order = [...source.matchAll(/<input[^>]*value="([a-z_]+)"/g)]
      .map((m) => m[1])
      .filter((v) => detectors.some((d) => d.key === v));
    assert.deepEqual(
      order,
      detectors.map((d) => d.key),
      "the detector rows are not in the study's evaluation order. Never sort " +
        "this table by lead.",
    );
  });

  test("/see/run/ does not recycle the withdrawn lead as a positive", needsDist, () => {
    const defect = readData("run-series.json").frozenAnalysisDefect;
    const source = html("see/run");
    assert.ok(
      source.includes(String(defect.correctedValue)),
      "the corrected value is not on the page.",
    );
    assert.ok(
      source.includes(String(defect.declined)),
      "the page does not state that the flattering value was declined.",
    );
  });

  test("/see/grader/ reaches 0, 0, 1, 1 fields read at log-only access", needsDist, () => {
    const cards = readData("grader-cards.json").cards;
    const counts = cards.map((c) => c.access.log_only.readCount);
    assert.deepEqual(
      counts,
      [0, 0, 1, 1],
      "the log-only read counts changed. This route is built to the corrected " +
        "claim, not to the slogan that every card drops to zero: two drop to " +
        "zero and two keep exactly one, the single field countable from a log.",
    );
    const source = html("see/grader");
    for (const c of cards) {
      assert.ok(
        source.includes(c.displayName),
        `${c.key} is not named on the page. The source program is never hidden ` +
          `behind a generic card illustration.`,
      );
      assert.ok(
        source.includes(c.subject.source),
        `${c.key}'s source program is not identified on the page.`,
      );
    }
  });

  test("/see/grader/ states the denominator beside the mutation score", needsDist, () => {
    const cards = readData("grader-cards.json").cards;
    const killed = cards.map((c) => c.killedMutants);
    assert.deepEqual(
      killed,
      [0, 2, 24, 26],
      "the kill counts changed. Zero on one subject is a finding only because " +
        "the same instrument kills a substantial fraction on the other three.",
    );
    const source = html("see/grader");
    for (const c of cards) {
      assert.ok(
        source.includes(String(c.competentMutants)),
        `${c.key}'s competent-mutant denominator is not on the page. A score of ` +
          `zero without its denominator is not a measurement.`,
      );
    }
    assert.ok(
      /not a defect rate for verifiers in general/i.test(source),
      "the page does not say what a mutation score of zero is NOT. It is an " +
        "absence of detection on one checker, not a population estimate.",
    );
  });

  test("/see/grader/ keeps the call count and the corpus count apart", needsDist, () => {
    const cards = readData("grader-cards.json").cards;
    const source = html("see/grader");
    for (const c of cards) {
      assert.equal(c.graderCalls, 2400, `${c.key}'s call count changed`);
      assert.ok(
        source.includes(String(c.graderCalls)),
        `${c.key}'s grader call count is not on the page.`,
      );
      assert.ok(
        source.includes(c.subject.corpus),
        `${c.key}'s corpus line is not on the page. The gold-answer-pair count ` +
          `lives there and is not the call count.`,
      );
    }
  });

  test("/see/grader/ cites no ledger row that disagrees with the card", needsDist, () => {
    const source = html("see/grader");
    /* The assay ledger reports 259 of 461 surviving mutants on the equivalence
       checker with 27 of 38 branches, against the card's 60 competent mutants.
       These are different measurements under one name. The site uses the card's
       numbers and does not cite the ledger's, and it does not average them. */
    for (const wrong of ["461", "of 38 branches"]) {
      assert.ok(
        !source.includes(wrong),
        `"${wrong}" is on the page. It comes from a ledger row measuring ` +
          `something else under the same name, and mixing the two is the one ` +
          `thing this disagreement must not produce.`,
      );
    }
  });

  test("/see/ says plainly that no subject carries the whole chain", needsDist, () => {
    const source = html("see");
    assert.ok(
      /no subject here carries the whole chain/i.test(source),
      "the summary page does not say that its three studies are separate " +
        "subjects. Without it the page implies an integrated demonstration " +
        "that does not exist.",
    );
    assert.ok(
      !/adj-avp|meta-ledger|kill_note/i.test(source),
      "the summary page is reading the archive's card store again.",
    );
  });

  test("/see/ links to the three routes by their public names", needsDist, () => {
    const source = html("see");
    for (const href of ["/see/reward-model/", "/see/run/", "/see/grader/"]) {
      assert.ok(source.includes(`href="${href}"`), `${href} is not linked from /see/.`);
    }
    assert.ok(
      !/Read act (one|two|three)/i.test(source),
      "a link is labelled with an internal chapter name.",
    );
  });
});

/* =======================================================================
   Driven · the adverse state reached the way a reader reaches it
   ======================================================================= */

let browser = null;
let server = null;

const startServer = () =>
  new Promise((resolve, reject) => {
    server = spawn("npx", ["astro", "preview", "--port", String(PORT)], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
    });
    server.unref();
    const giveUp = setTimeout(() => reject(new Error("preview did not start")), 30000);
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/see/run/`);
        if (r.ok) {
          clearInterval(poll);
          clearTimeout(giveUp);
          resolve();
        }
      } catch {
        /* not up yet */
      }
    }, 500);
  });

/**
 * THE ONE TRAP THAT PRODUCES EVIDENCE LOOKING ENTIRELY CORRECT. If another
 * worktree already holds this port, `astro preview` binds elsewhere and the
 * fetch above answers from that worktree's build: a real page, correctly
 * rendered, of the wrong branch. So the served page has to prove it is this
 * checkout's, and the proof is a string only this checkout's dist contains.
 */
const assertServingThisCheckout = async () => {
  const served = await (await fetch(`${BASE}/see/reward-model/`)).text();
  const marker = "the planted-key calibration case";
  assert.ok(
    served.includes(marker),
    `the server on port ${PORT} is not serving this checkout. It answered ` +
      `/see/reward-model/ without "${marker}", which this branch's dist/ ` +
      `contains. astro preview binds a different port when the one asked for ` +
      `is taken, and another worktree is holding it. Re-run with ` +
      `SEE_ROUTES_PORT set to a free port.`,
  );
};

before(async () => {
  if (!built) return;
  const { chromium } = await import("playwright");
  await startServer();
  await assertServingThisCheckout();
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

describe("driven: the adverse state, reached the way a reader reaches it", () => {
  test("run: the longest apparent lead shows its false-alarm rate in the same viewport", needsDist, async () => {
    const detectors = readData("run-series.json").detectors;
    const worst = detectors
      .filter((d) => d.leadWidths !== null)
      .reduce((a, b) => (b.leadWidths > a.leadWidths ? b : a));
    assert.equal(worst.shipped, false, "the longest-lead signal is now the shipped one");

    const page = await open("/see/run/");
    const radio = page.locator(`input[type=radio][value="${worst.key}"]`);
    await radio.check();
    await radio.scrollIntoViewIfNeeded();

    /* The selector is a CSS grid, so a "row" is three sibling cells and not an
       element. Read the name cell the radio sits in and the two cells after
       it, which are the lead and the false-alarm rate. */
    const cells = await radio.evaluate((input) => {
      const name = input.closest(".ts__cell--name");
      const lead = name?.nextElementSibling;
      const rate = lead?.nextElementSibling;
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, text: el.textContent.replace(/\s+/g, " ").trim() };
      };
      return name && lead && rate
        ? { name: box(name), lead: box(lead), rate: box(rate), viewport: window.innerHeight }
        : null;
    });
    assert.ok(cells, "the detector selector is not the three-cell row this reads");

    const shown = `${(worst.surrogateRate * 100).toFixed(1)}%`;
    assert.ok(
      cells.rate.text.includes(shown),
      `the cell beside the longest lead does not carry ${shown}. Lead and ` +
        `false-alarm rate sit on the same control precisely so that picking ` +
        `the most impressive-looking signal shows what it costs. It reads ` +
        `"${cells.rate.text}".`,
    );

    /* Same row, and both on screen. A rate a reader has to go looking for is a
       footnote, and the point of this control is that it is not one. */
    assert.ok(
      Math.abs(cells.name.top - cells.rate.top) < 4,
      `the name and the rate are on different rows: ${cells.name.top} against ` +
        `${cells.rate.top}.`,
    );
    for (const [what, cell] of Object.entries({ lead: cells.lead, rate: cells.rate })) {
      assert.ok(
        cell.top >= 0 && cell.bottom <= cells.viewport,
        `the ${what} cell spans ${cell.top} to ${cell.bottom} in a ` +
          `${cells.viewport}px viewport, so it is not readable beside the row ` +
          `the reader just selected.`,
      );
    }
    await page.close();
  });

  test("grader: the log-only state renders 0, 0, 1, 1 with refusals styled blue", needsDist, async () => {
    const page = await open("/see/grader/");
    await page.locator("select[data-access-control]").selectOption("log_only");
    await page.waitForTimeout(120);

    const visible = page.locator("[data-access-state='log_only']");
    const counts = [];
    for (const card of await visible.locator("[data-grader-card]").all()) {
      counts.push(await card.locator("[data-field-kind='reading']").count());
    }
    assert.deepEqual(counts, [0, 0, 1, 1], "the log-only state is not the measured one");

    /* A refusal is a success in this library's semantics. Blue, never red, and
       the check is on the computed colour rather than on a class name, because
       a class can be renamed and the register is what matters. */
    const refusal = visible.locator(".refusal").first();
    const colours = await refusal.evaluate((el) => {
      const seen = [];
      for (const n of [el, ...el.querySelectorAll("*")]) {
        const s = getComputedStyle(n);
        seen.push(s.color, s.borderInlineStartColor, s.backgroundColor);
      }
      return seen;
    });
    const rgb = (v) => (v.match(/\d+/g) ?? []).map(Number);
    for (const c of colours) {
      const [r, g, b, a = 1] = rgb(c);
      if (a === 0 || r === undefined) continue;
      const red = r > 130 && r > g * 1.6 && r > b * 1.6;
      assert.ok(
        !red,
        `a refusal renders ${c}, which reads as an error. A refusal is the ` +
          `instrument declining to produce a number it cannot justify, and ` +
          `styling it as a failure inverts the argument of the whole route.`,
      );
    }
    await page.close();
  });

  test("reward-model: the planted-key case sits in part 5, not part 4", needsDist, async () => {
    const page = await open("/see/reward-model/");
    const inPart = async (n, needle) =>
      (await page.locator(`#part-${n}`).innerText()).includes(needle);

    assert.ok(
      await inPart(5, "planted-key calibration case"),
      "the planted-key case is not in part 5. It bounds what the rank " +
        "disagreement establishes, which makes it a limitation.",
    );
    assert.ok(
      !(await inPart(4, "planted-key calibration case")),
      "the planted-key case is still in part 4, where it reads as the route's " +
        "identity rather than as a bound on it.",
    );
    assert.ok(
      await inPart(4, "+0.047465"),
      "the second model is not in part 4, where it refuses the reading that " +
        "part 4 otherwise invites.",
    );
    await page.close();
  });
});
