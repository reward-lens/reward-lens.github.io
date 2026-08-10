/**
 * Packet F2's acceptance tests.
 *
 *   node --test src/components/base/base.test.mjs
 *
 * Node's own test runner, no dependency and no package.json change: P1 owns
 * scripts/** and P2 owns scripts/checks/**, so this lives inside F2's own path
 * and either of them can lift it into the gate list without moving code.
 *
 * Two kinds of test here, deliberately:
 *
 *  - the guards, imported from guards.mjs, which is the same module the .astro
 *    components call, so a passing test is a statement about the build and not
 *    about a copy of it;
 *  - assertions over BUILT OUTPUT in dist/, because HANDOFF.md §7 is explicit
 *    that a fix is verified against built output and never against a diff. The
 *    dist tests skip themselves with a message when dist/gallery is absent.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FROZEN_REFUSAL_REASONS,
  requireRemedy,
  requireRefusalReason,
  requireVersion,
  versionDirection,
  requireColumnKeys,
  requireCalloutVariant,
  requireTrustRung,
} from "./guards.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const GALLERY = join(ROOT, "dist/gallery/index.html");
const html = existsSync(GALLERY) ? readFileSync(GALLERY, "utf-8") : null;
const needsDist = { skip: html ? false : "run `npm run build` first" };

/* =======================================================================
   install-strip
   ======================================================================= */

describe("install-strip", () => {
  test("copies exactly `pip install reward-lens`", needsDist, () => {
    const found = [...html.matchAll(/data-command="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(found.length > 0, "no install strip in the built gallery");
    for (const command of found) {
      // Acceptance criterion 1: no leading prompt, no trailing whitespace.
      assert.equal(command, "pip install reward-lens");
      assert.equal(command, command.trim());
      assert.ok(!command.includes("$"), "the prompt glyph is in the copied string");
      assert.ok(!command.includes("\\n"), "the copied string carries a newline");
    }
  });

  test("the $ prompt is a separate aria-hidden node, not part of the command", needsDist, () => {
    assert.match(
      html,
      /<span class="install-strip__prompt"[^>]*aria-hidden="true"[^>]*>\$<\/span>/,
    );
  });

  test("the polite live region lives outside the button", needsDist, () => {
    // The strip is the button. A live region inside it would be part of the
    // control's accessible name.
    const strip = html.slice(html.indexOf("data-install-strip"));
    const button = strip.slice(0, strip.indexOf("</div>"));
    assert.ok(!button.includes('aria-live="polite"'));
    assert.ok(html.includes('aria-live="polite"'));
  });
});

/* =======================================================================
   refusal-card
   ======================================================================= */

describe("refusal-card", () => {
  test("an empty remedy fails the build naming the quantity", () => {
    for (const empty of ["", "   ", "\n\t ", undefined, null]) {
      assert.throws(
        () => requireRemedy(empty, "exploit-family accounting"),
        (e) => {
          assert.match(e.message, /exploit-family accounting/);
          assert.match(e.message, /remedy/);
          return true;
        },
        `remedy ${JSON.stringify(empty)} should have failed`,
      );
    }
  });

  test("a non-empty remedy passes through unchanged", () => {
    assert.equal(requireRemedy("Collect more finds.", "q"), "Collect more finds.");
  });

  test("the reason enum has seventeen members, not sixteen", () => {
    // GROUND-TRUTH.md C-10. the-kernel.md:168 says sixteen and is one
    // amendment behind; the enum and its two acceptance tests say seventeen.
    assert.equal(FROZEN_REFUSAL_REASONS.length, 17);
    assert.ok(FROZEN_REFUSAL_REASONS.includes("QUANTITY_UNDEFINED"));
    assert.ok(FROZEN_REFUSAL_REASONS.includes("RECORD_INCOMPLETE"));
    assert.equal(new Set(FROZEN_REFUSAL_REASONS).size, 17);
  });

  test("a reason outside the enum fails the build naming both", () => {
    assert.throws(
      () => requireRefusalReason("NOT_A_REASON", "exploit-family accounting"),
      (e) => {
        assert.match(e.message, /NOT_A_REASON/);
        assert.match(e.message, /exploit-family accounting/);
        return true;
      },
    );
    assert.equal(
      requireRefusalReason("ABOVE_LOD_BELOW_LOQ", "q"),
      "ABOVE_LOD_BELOW_LOQ",
    );
  });

  test("a refusal is never rendered as an error", needsDist, () => {
    // The register check, in the built output: blue and bounded, never red,
    // never a warning role, never a triangle.
    const cards = html.match(/<article class="refusal[\s\S]*?<\/article>/g) ?? [];
    assert.ok(cards.length >= 2, "no refusal cards in the built gallery");
    for (const card of cards) {
      assert.ok(!/role="alert"/.test(card));
      assert.ok(!/\bwarning\b|\bdanger\b|\berror\b/i.test(card));
      assert.ok(!/⚠|&#9888;/.test(card));
    }
  });

  test("the reason chip says it is a refusal, and the state string is derived", needsDist, () => {
    // refusals.reason_aria_prefix, so the chip reads "refusal reason: X" and
    // not "reason: X", which loses that this is a refusal at all.
    assert.match(html, /aria-label="refusal reason: ABOVE_LOD_BELOW_LOQ"/);
    assert.match(html, /aria-label="refusal reason: ACCESS_INSUFFICIENT"/);
    assert.ok(!/aria-label="reason: /.test(html));
    // refusals.state_labels, derived from the bound rather than passed in.
    const states = html.match(/<span class="refusal__state[^>]*>([^<]*)</g) ?? [];
    assert.ok(states.length >= 4, "a refusal card rendered without a state string");
    assert.match(html, /<span class="refusal__state[^>]*>detected, not quantifiable</);
    assert.match(html, /<span class="refusal__state[^>]*>declined</);
  });

  test("the remedy is present at full density, never behind a disclosure", needsDist, () => {
    const full = html.match(/<article class="refusal refusal--full[\s\S]*?<\/article>/g) ?? [];
    assert.ok(full.length >= 2);
    for (const card of full) {
      assert.ok(!card.includes("data-remedy-toggle"), "full density collapsed its remedy");
      assert.ok(card.includes("data-remedy-panel"));
    }
  });
});

/* =======================================================================
   version-chip
   ======================================================================= */

describe("version-chip", () => {
  test("the direction is derived, never passed", () => {
    const published = ["2.0.0", "2.0.1"];
    assert.equal(versionDirection("2.0.1", "2.0.1", published), "none");
    assert.equal(versionDirection("2.0.0", "2.0.1", published), "behind");
    assert.equal(versionDirection("3.0.0", "2.0.1", published), "unpublished");
  });

  test("an invalid version string fails the build", () => {
    for (const bad of ["3.0.0rc1", "v3.0.0", "3.0", "", "latest"]) {
      assert.throws(() => requireVersion(bad, "version-chip", "describes"));
    }
    assert.equal(requireVersion("3.0.0", "version-chip", "describes"), "3.0.0");
  });

  test("describes === released emits zero DOM nodes", needsDist, () => {
    const m = html.match(/<div id="version-chip-silent"[^>]*>([\s\S]*?)<\/div>/);
    assert.ok(m, "the silent marker is missing from the built gallery");
    assert.equal(m[1], "", "the chip emitted a node when the versions match");
  });

  test("the link and the direction word come from the chip's own keys", needsDist, () => {
    // ui.migration_link, derived rather than passed as a label.
    assert.match(html, /<a class="version-chip__link"[^>]*>Migration notes ›<\/a>/);
    // ui.version_unpublished_word in the inline form's hidden expansion. It
    // holds the same words as install.prerelease_suffix today and is a
    // separate key on purpose: the strip states a package fact and the chip
    // states a page fact, and they are allowed to diverge (criterion 7).
    assert.match(
      html,
      /<span class="visually-hidden"[^>]*>Describes library 3\.0\.0, not yet published<\/span>/,
    );
  });

  test("no live region anywhere in the component's output", needsDist, () => {
    const chips = html.match(/<div class="version-chip[\s\S]*?<\/div>/g) ?? [];
    assert.ok(chips.length >= 2);
    for (const chip of chips) {
      assert.ok(!/aria-live|role="status"|role="alert"/.test(chip));
    }
  });
});

/* =======================================================================
   data-table
   ======================================================================= */

describe("data-table", () => {
  test("a row missing a declared column key fails the build naming both", () => {
    const columns = [{ key: "signal" }, { key: "alarm" }];
    assert.throws(
      () => requireColumnKeys("Detectors", columns, [{ signal: "variance level" }]),
      (e) => {
        assert.match(e.message, /alarm/);
        assert.match(e.message, /row 0/);
        assert.match(e.message, /Detectors/);
        return true;
      },
    );
  });

  test("a null cell is present, not missing", () => {
    const columns = [{ key: "signal" }, { key: "alarm" }];
    assert.doesNotThrow(() =>
      requireColumnKeys("Detectors", columns, [{ signal: "a", alarm: null }]),
    );
  });

  test("row order in the built HTML is the source's order", needsDist, () => {
    const order = [
      "variance level",
      "gradient norm, CUSUM",
      "variance derivative",
      "gradient-norm peak",
      "labelled transition",
    ];
    const table = html.slice(html.indexOf('class="dt__scroll"'));
    const at = order.map((s) => table.indexOf(`> ${s} `));
    for (const i of at) assert.ok(i > 0, "a source row is missing from the output");
    for (let i = 1; i < at.length; i += 1) {
      assert.ok(at[i] > at[i - 1], `${order[i]} rendered before ${order[i - 1]}`);
    }
  });

  test("every scroll container is a named, keyboard-reachable group", needsDist, () => {
    // role="group" and never role="region". A region is a landmark, and a page
    // with several tables would emit several identically named landmarks.
    const regions = html.match(/<div class="dt__scroll"[^>]*>/g) ?? [];
    assert.ok(regions.length >= 4);
    for (const r of regions) {
      assert.match(r, /role="group"/);
      assert.ok(!/role="region"/.test(r), "the scroll container is a landmark");
      assert.match(r, /tabindex="0"/);
      assert.match(r, /aria-labelledby="/);
    }
  });

  test("the reference row carries its hidden prefix from copy.yaml", needsDist, () => {
    assert.match(html, /<span class="visually-hidden"[^>]*>\s*reference:\s*<\/span>/);
  });

  test("there is no sortable affordance anywhere", needsDist, () => {
    assert.ok(!/aria-sort|sortable|data-sort/.test(html));
  });
});

/* =======================================================================
   code-block
   ======================================================================= */

describe("code-block", () => {
  test("the copy payload is the code and nothing else", needsDist, () => {
    const found = [...html.matchAll(/data-cb-copy data-code="([^"]*)"/g)].map(
      (m) => m[1],
    );
    assert.ok(found.length > 0, "no copyable code block in the built gallery");
    for (const raw of found) {
      const code = raw
        .replaceAll("&#34;", '"')
        .replaceAll("&quot;", '"')
        .replaceAll("&#10;", "\n")
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">");
      assert.ok(!code.includes("no GPU"), "an annotation leaked into the copy payload");
      assert.ok(!/^\s*\$ /m.test(code), "a shell prompt leaked into the copy payload");
      assert.equal(code, code.trimEnd(), "the copy payload has trailing whitespace");
      assert.ok(!/^\s*\d+\s{2,}/m.test(code), "line numbers leaked into the copy payload");
    }
  });

  test("the scroll container is a named, keyboard-reachable group", needsDist, () => {
    // Corrected from role="region": thirty blocks on a documentation page
    // would be thirty identically named landmarks and an axe landmark-unique
    // failure. group keeps the name and the keyboard scrolling.
    const regions = html.match(/<div class="cb__scroll"[^>]*>/g) ?? [];
    assert.ok(regions.length >= 3);
    for (const r of regions) {
      assert.match(r, /role="group"/);
      assert.ok(!/role="region"/.test(r), "the scroll container is a landmark");
      assert.match(r, /tabindex="0"/);
      assert.match(r, /aria-label="Code, /);
    }
  });

  test("the copy pair and the output label are the block's own, not the strip's", needsDist, () => {
    // ui.code_output_label, not ui.expected_output.
    assert.match(html, /class="cb__output-label[^>]*>Output</);
    const buttons = html.match(/<button[^>]*data-cb-copy[^>]*>/g) ?? [];
    assert.ok(buttons.length >= 2);
    for (const b of buttons) {
      // ui.code_copied_label. The install strip's announcement names the
      // install command and is not this component's to borrow.
      assert.match(b, /data-announce="copied"/);
      assert.ok(!/Install command/.test(b));
    }
  });
});

/* =======================================================================
   callout and trust-badge
   ======================================================================= */

describe("callout", () => {
  test("a variant outside the three fails the build naming the value", () => {
    for (const bad of ["warning", "danger", "tip", "info"]) {
      assert.throws(
        () => requireCalloutVariant(bad, "Where is the remedy answerable"),
        (e) => {
          assert.match(e.message, new RegExp(bad));
          return true;
        },
      );
    }
    for (const good of ["note", "scope", "aside"]) {
      assert.equal(requireCalloutVariant(good, "l"), good);
    }
  });

  test("no role=alert or role=note in the built output", needsDist, () => {
    assert.ok(!/role="alert"/.test(html));
    assert.ok(!/role="note"/.test(html));
  });

  test("every callout is an <aside> with a labelled relationship", needsDist, () => {
    const callouts = html.match(/<aside class="callout[^"]*"[^>]*>/g) ?? [];
    assert.equal(callouts.length, 3);
    for (const c of callouts) assert.match(c, /aria-labelledby="/);
  });
});

describe("trust-badge", () => {
  const levels = ["exploratory", "calibrated", "registered", "adjudicated"];

  test("a level outside the four fails the build naming the value", () => {
    assert.throws(
      () => requireTrustRung("gold", levels, "trust-badge"),
      (e) => {
        assert.match(e.message, /gold/);
        return true;
      },
    );
  });

  test("the rung index is monotone in the ladder order", () => {
    assert.deepEqual(
      levels.map((l) => requireTrustRung(l, levels, "trust-badge")),
      [1, 2, 3, 4],
    );
  });

  test("the ladder renders four rungs in order, fourth unoccupied", needsDist, () => {
    const at = levels.map((l) => html.indexOf(`>${l}</span>`));
    for (const i of at) assert.ok(i > 0, "a rung is missing");
    for (let i = 1; i < at.length; i += 1) assert.ok(at[i] > at[i - 1]);
    assert.match(html, /trust-badge--unoccupied/);
    // The hollow dot is not the only carrier of "empty".
    assert.match(html, /Nothing in this repository has reached this rung/);
  });

  test("the level is text, never a title attribute", needsDist, () => {
    const badges = html.match(/<span class="trust-badge[^"]*"[^>]*>/g) ?? [];
    assert.ok(badges.length >= 9);
    for (const b of badges) assert.ok(!/title=/.test(b));
  });
});

/* =======================================================================
   figure-frame
   ======================================================================= */

describe("figure-frame", () => {
  test("the figure prefix and the film transport come from copy.yaml", needsDist, () => {
    // ui.figure_prefix, uppercased by the mono-label role rather than in text.
    const ids = html.match(/<span class="ff__id"[^>]*>([^<]*)</g) ?? [];
    assert.ok(ids.length >= 4, "the gallery lost a figure frame");
    for (const id of ids) assert.match(id, />Fig\. \d/);
    // ui.film_play at rest: the film is server-rendered paused and never
    // autoplays, so the control names the action it is about to take.
    const toggle = html.match(/<button[^>]*data-film-toggle[^>]*>[^<]*/);
    assert.ok(toggle, "the film has no transport control");
    assert.match(toggle[0], /aria-pressed="false"/);
    assert.match(toggle[0], /data-play="Play"/);
    assert.match(toggle[0], /data-pause="Pause"/);
    assert.match(toggle[0], />\s*Play\s*$/);
  });

  test("the record link is the short copy key, not the panel heading", needsDist, () => {
    assert.match(html, /<a class="ff__link[^>]*>\s*Open the record ›/);
  });
});

/* =======================================================================
   provenance-chip
   ======================================================================= */

describe("provenance-chip", () => {
  test("the trigger is a button with aria-expanded and a description", needsDist, () => {
    const triggers = html.match(/<button type="button" class="prov__trigger"[^>]*>/g) ?? [];
    assert.ok(triggers.length >= 3);
    for (const t of triggers) {
      assert.match(t, /aria-expanded="false"/);
      assert.match(t, /aria-describedby="/);
      assert.match(t, /aria-label="/);
      assert.match(t, /data-provenance/);
    }
  });

  test("the panel is a non-modal dialog with an accessible name", needsDist, () => {
    const panels = html.match(/<span class="prov__panel"[^>]*>/g) ?? [];
    assert.ok(panels.length >= 3);
    for (const p of panels) {
      assert.match(p, /role="dialog"/);
      assert.match(p, /aria-modal="false"/);
      assert.match(p, /aria-labelledby="|aria-label="/);
      assert.match(p, /data-provenance-panel/);
    }
  });

  test("the trust level is announced as a word", needsDist, () => {
    assert.match(html, /trust exploratory\. Open provenance\./);
  });

  test("the accessible name is ui.provenance_aria, filled from the record", needsDist, () => {
    assert.match(
      html,
      /aria-label="−0\.171, attribution vs patching, mean Spearman, trust exploratory\. Open provenance\."/,
    );
    // ui.provenance_record_link on the link; ui.provenance_open stays the
    // panel's own name and is not the link's text.
    assert.match(html, /<a class="prov__link[^>]*>\s*Open the record ›/);
    assert.ok(!/>\s*Where this number came from ›/.test(html));
  });
});

/* =======================================================================
   provenance-chip, driven in a browser
   -----------------------------------------------------------------------
   The two defects below were both invisible to every static assertion above
   and to the gallery screenshots, and both of them were live on the built
   site. Neither can be caught by reading HTML, so this block drives the
   BUILT output in a real browser instead.

     1. A mouse click opened the panel and closed it in the same gesture.
        pointerdown moved focus, focusin opened, and the click handler then
        read the attribute focusin had just written and toggled it off. Hover
        and the keyboard both worked, which is why nothing caught it.
     2. A CLOSED panel was `visibility: hidden`, which keeps a box in layout.
        An absolutely positioned box at `inline-size: max-content` on a chip
        near the right edge added up to --measure-command (544px) to
        document.scrollWidth. Gate 19 fails on every page carrying a chip.

   Skips itself, loudly, when dist/ or a browser is missing. It never passes
   vacuously: every assertion here failed before the fix.
   ======================================================================= */

const WIDTHS = [320, 360, 390, 768, 1024, 1440, 1920];
const TRIGGER = "#prov-ev6bf316c059230ff4ff99b118b1664631-metricsmeanspearman";
const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".xml": "application/xml",
  ".txt": "text/plain", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

// Read in the page. The panel is "open" only if it is painted AND it is really
// the element under its own centre: opacity alone would pass a panel sitting
// behind something, and data-open alone would pass one that never rendered.
const PANEL_STATE = (triggerId) => {
  const trigger = document.getElementById(triggerId);
  const root = trigger.closest("[data-prov]");
  const panel = root.querySelector(".prov__panel");
  const cs = getComputedStyle(panel);
  const r = panel.getBoundingClientRect();
  const hit = r.width > 0 && r.height > 0
    ? document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
    : null;
  const t = trigger.getBoundingClientRect();
  return {
    dataOpen: root.hasAttribute("data-open"),
    ariaExpanded: trigger.getAttribute("aria-expanded"),
    display: cs.display,
    opacity: +(+cs.opacity).toFixed(3),
    painted: cs.display !== "none" && cs.visibility !== "hidden" && +cs.opacity > 0.5 && r.width > 0,
    hitInside: !!(hit && panel.contains(hit)),
    coversTrigger: r.width > 0 && !(r.right <= t.left || r.left >= t.right || r.bottom <= t.top || r.top >= t.bottom),
  };
};

// The right-edge case, built rather than found: the gallery's chipped cell is
// the third column of four, so nothing on it sits against the right edge, and
// the right edge is where a max-content panel costs 544px. A clone keeps its
// data-astro-cid, so it is styled by exactly the rules under test.
const INJECT_RIGHT_EDGE = () => {
  const src = document.querySelector("[data-prov]");
  if (!src) return "no chip";
  const flow = document.createElement("div");
  flow.style.cssText = "display:flex;justify-content:flex-end;width:100%;";
  flow.appendChild(src.cloneNode(true));
  (document.querySelector("main") ?? document.body).appendChild(flow);
  const lastCell = document.querySelector(".dt__scroll tbody tr:last-child td:last-child");
  if (lastCell) lastCell.appendChild(src.cloneNode(true));
  return "ok";
};

describe("provenance-chip · driven against built output", () => {
  let server = null;
  let browser = null;
  let origin = "";
  let unavailable = html ? null : "run `npm run build` first";

  before(async () => {
    if (unavailable) return;
    server = createServer((req, res) => {
      const path = decodeURIComponent((req.url ?? "/").split("?")[0].split("#")[0]);
      let file = join(ROOT, "dist", path);
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
      if (!existsSync(file) && existsSync(file + ".html")) file += ".html";
      if (!existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(readFileSync(file));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    origin = `http://127.0.0.1:${server.address().port}`;
    try {
      const { chromium } = await import("playwright");
      // System Chrome where it exists, the bundled build otherwise: the same
      // order scripts/checks/_lib.mjs uses, so a disagreement between this and
      // a gate is never the browser.
      try {
        browser = await chromium.launch({ channel: "chrome" });
      } catch {
        browser = await chromium.launch();
      }
    } catch (e) {
      unavailable = `no browser available: ${e.message}`;
    }
  });

  after(async () => {
    await browser?.close();
    if (server) await new Promise((r) => server.close(r));
  });

  const page = async (opts = {}) => {
    const ctx = await browser.newContext({
      viewport: { width: opts.width ?? 1440, height: 900 },
      colorScheme: opts.theme ?? "dark",
      deviceScaleFactor: 1,
      hasTouch: !!opts.touch,
      isMobile: !!opts.touch,
    });
    await ctx.addInitScript((t) => {
      try { localStorage.setItem("theme", t); } catch {}
      document.documentElement.setAttribute("data-theme", t);
    }, opts.theme ?? "dark");
    const p = await ctx.newPage();
    await p.goto(`${origin}/gallery/`, { waitUntil: "networkidle" });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(150);
    return { ctx, p };
  };

  test("DEFECT 1 · a mouse click opens the panel and it stays open", async (t) => {
    if (unavailable) return t.skip(unavailable);
    const { ctx, p } = await page();
    const chip = p.locator(TRIGGER);
    await chip.scrollIntoViewIfNeeded();
    await p.waitForTimeout(100);
    await chip.click();

    // 100ms is inside the 220ms hover delay, so if the panel is open here it
    // is the CLICK that opened it and not the pointer resting on the number.
    // Before the fix this read dataOpen: false, every time, on every page.
    await p.waitForTimeout(100);
    const early = await p.evaluate(PANEL_STATE, TRIGGER.slice(1));
    assert.equal(early.dataOpen, true, "the click did not open the panel");
    assert.equal(early.ariaExpanded, "true", "aria-expanded did not follow the click");

    await p.waitForTimeout(400);
    const open = await p.evaluate(PANEL_STATE, TRIGGER.slice(1));
    assert.equal(open.painted, true, `the panel never painted: ${JSON.stringify(open)}`);
    assert.equal(open.hitInside, true, "the panel is not the element under its own centre");
    assert.equal(open.coversTrigger, false, "the panel covers the number it describes");

    // A second click is a real toggle, and a third reopens: the sense of the
    // toggle was inverted by the defect, not merely delayed by it.
    await chip.click();
    await p.waitForTimeout(400);
    assert.equal((await p.evaluate(PANEL_STATE, TRIGGER.slice(1))).painted, false, "a second click did not close");
    await chip.click();
    await p.waitForTimeout(400);
    assert.equal((await p.evaluate(PANEL_STATE, TRIGGER.slice(1))).painted, true, "a third click did not reopen");

    // Tap outside closes (criterion 4).
    await p.mouse.move(4, 4);
    await p.mouse.down();
    await p.mouse.up();
    await p.waitForTimeout(400);
    assert.equal((await p.evaluate(PANEL_STATE, TRIGGER.slice(1))).painted, false, "clicking away did not close");
    await ctx.close();
  });

  test("DEFECT 1 · a tap opens the panel on touch", async (t) => {
    if (unavailable) return t.skip(unavailable);
    for (const width of [390, 1024]) {
      const { ctx, p } = await page({ width, touch: true });
      await p.locator(TRIGGER).tap();
      await p.waitForTimeout(450);
      const s = await p.evaluate(PANEL_STATE, TRIGGER.slice(1));
      assert.equal(s.painted, true, `tap at ${width} did not open the panel: ${JSON.stringify(s)}`);
      assert.equal(s.coversTrigger, false, `the panel covers the number at ${width}`);
      await p.touchscreen.tap(4, 4);
      await p.waitForTimeout(450);
      assert.equal((await p.evaluate(PANEL_STATE, TRIGGER.slice(1))).painted, false, `tapping outside at ${width} did not close`);
      await ctx.close();
    }
  });

  test("DEFECT 1 · the fix did not cost the keyboard its no-delay open", async (t) => {
    if (unavailable) return t.skip(unavailable);
    // The obvious wrong repair is to delete the focusin handler, which stops
    // the two handlers fighting by dropping the clause the contract's
    // accessibility section is built on (§6.5: tooltips delay on hover, never
    // on focus). Measured in the same task as the focus call, so a timer of
    // any length between them fails.
    const { ctx, p } = await page();
    const sync = await p.evaluate((sel) => {
      const trigger = document.querySelector(sel);
      trigger.focus();
      const root = trigger.closest("[data-prov]");
      return {
        dataOpen: root.hasAttribute("data-open"),
        aria: trigger.getAttribute("aria-expanded"),
        display: getComputedStyle(root.querySelector(".prov__panel")).display,
      };
    }, TRIGGER);
    assert.equal(sync.dataOpen, true, "focus did not open the panel in the same task");
    assert.equal(sync.aria, "true");
    assert.notEqual(sync.display, "none", "the panel was still display:none one task after focus");

    // And hover still waits 220ms rather than opening on arrival.
    const { ctx: c2, p: p2 } = await page();
    const chip = p2.locator(TRIGGER);
    await chip.scrollIntoViewIfNeeded();
    await p2.waitForTimeout(100);
    await chip.hover();
    await p2.waitForTimeout(120);
    assert.equal((await p2.evaluate(PANEL_STATE, TRIGGER.slice(1))).dataOpen, false, "hover opened before the 220ms delay");
    await p2.waitForTimeout(400);
    assert.equal((await p2.evaluate(PANEL_STATE, TRIGGER.slice(1))).painted, true, "hover never opened the panel");
    await ctx.close();
    await c2.close();
  });

  test("DEFECT 2 · a closed panel costs nothing, and scrollWidth never exceeds the viewport", async (t) => {
    if (unavailable) return t.skip(unavailable);
    const failures = [];
    for (const theme of ["dark", "light"]) {
      for (const width of WIDTHS) {
        const { ctx, p } = await page({ width, theme });
        await p.evaluate(INJECT_RIGHT_EDGE);
        await p.waitForTimeout(80);
        const m = await p.evaluate(() => {
          const closed = [...document.querySelectorAll(".prov__panel")].filter(
            (el) => !el.closest("[data-prov]").hasAttribute("data-open"),
          );
          const withABox = closed.filter((el) => {
            const b = el.getBoundingClientRect();
            return b.width > 0 || b.height > 0;
          }).length;
          return {
            scrollWidth: document.documentElement.scrollWidth,
            viewport: document.documentElement.clientWidth,
            closed: closed.length,
            withABox,
          };
        });
        if (m.scrollWidth > m.viewport) {
          failures.push(`${theme} ${width}: scrollWidth ${m.scrollWidth} > ${m.viewport}`);
        }
        if (m.withABox > 0) {
          failures.push(`${theme} ${width}: ${m.withABox} of ${m.closed} closed panels still occupy layout`);
        }
        assert.ok(m.closed >= 3, "the gallery lost its chips, so this test proves nothing");
        await ctx.close();
      }
    }
    assert.deepEqual(failures, [], `\n  ${failures.join("\n  ")}\n`);
  });

  test("DEFECT 3 · the printed endnote is readable, not a blank 544px block", async (t) => {
    if (unavailable) return t.skip(unavailable);
    // print.css forces the panel to display:block and position:static so it
    // prints as a numbered endnote. It never touched opacity, because opacity
    // is this component's, so the endnote reserved the paper and printed
    // nothing on it. Criterion 6: the printed page is self-sufficient.
    const { ctx, p } = await page({ width: 1024, theme: "light" });
    await p.emulateMedia({ media: "print" });
    await p.waitForTimeout(150);
    const printed = await p.evaluate(() => {
      const el = document.querySelector(".prov__panel");
      const cs = getComputedStyle(el);
      return {
        display: cs.display,
        visibility: cs.visibility,
        opacity: +cs.opacity,
        height: Math.round(el.getBoundingClientRect().height),
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
      };
    });
    assert.notEqual(printed.display, "none", "the panel does not render in print");
    assert.notEqual(printed.visibility, "hidden", "the printed panel is invisible");
    assert.equal(printed.opacity, 1, "the printed panel is transparent");
    assert.ok(printed.height > 0, "the printed panel has no height");
    assert.match(printed.text, /attribution vs patching/, "the endnote carries no record text");
    await ctx.close();
  });
});
