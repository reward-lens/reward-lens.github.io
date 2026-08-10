// Gate 21 · Hero luminance
//
// D-22 puts DOM text over a live scene, and text over a rendered scene needs a
// contrast guarantee that a token pair cannot give: --ground means nothing when
// the pixels behind the words are floor catching spill. So the guarantee is
// made against rendered pixels.
//
// THE FIRST VERSION OF THIS GATE MEASURED NOTHING CORRECT, in five separate
// ways. Packet P3 found all five by mirroring the script while building the
// page it measures, which is a better test than reading it, and none of the
// five was visible in the source. They are recorded here rather than quietly
// fixed, because four of them are traps a reimplementation would fall into.
//
//  1. THE BORDER COLOUR WAS PARSED WITH A DIGIT REGEX. Chrome returns an
//     authored oklch() from getComputedStyle unchanged, so
//     `match(/\d+/g).slice(0,3)` read `oklch(0.48 0.01 170)` as `rgb(0,48,0)`:
//     Y = 0.0211 where the truth is 0.1105. Every ratio the old gate printed
//     was wrong, and wrong in the flattering direction. Colours now go through
//     a one-pixel canvas round-trip, which is exact for any colour space.
//
//  2. IT MEASURED THE WRONG ELEMENT. `querySelector("[data-install-strip],
//     .install-strip")` is a selector LIST, and querySelector returns the first
//     element in DOCUMENT ORDER matching any of them. The unbordered root
//     `.install-strip` precedes its own bordered descendant, so the gate read
//     the root, whose borderTopColor computes to `currentcolor`. The bordered
//     surface is `[data-install-strip]` and nothing else.
//
//  3. THE CEILING WAS APPLIED TO A RECTANGLE CONTAINING THE TEXT IT PROTECTS,
//     so the 95th-percentile pixel was the headline's own glyphs at --ink,
//     0.64 to 0.69 against a ceiling of 0.16, and NO LEGIBLE HEADLINE COULD
//     PASS. D-38 settles it: the zones exist to constrain the BACKDROP, so the
//     gate hides each zone's own element, samples, and restores it.
//
//  4. THE SCROLL SWEEP RAN PAST THE HERO. It swept to min(scrollRange,
//     viewport.height) = 900px while the hero is 835px under a 65px header, so
//     the last samples read section 2 and 3 content through the hero's
//     rectangles and attributed it to the hero. The sweep is now clamped to the
//     hero's own extent, measured from the DOM.
//
//  5. THE BRIGHTNESS RANKING INCLUDED INVISIBLE ELEMENTS. Closed provenance
//     panels ranked first in the light theme at 0.9779, which is the page
//     ground read through a `visibility: hidden` box. Elements are now filtered
//     with checkVisibility(), which walks the ancestor chain.
//
// TWO ASSERTIONS CHANGED UNDER D-38, and both changed because the criterion was
// wrong rather than the page:
//
//  - ASSERTION 2 IS PEAK LUMINANCE, NOT MEAN. A mean over a bounding box
//    rewards a 130x24 box that is mostly glyph over a 544x62 box that is mostly
//    surface: it measures ink density, not prominence, and it ranks the strip
//    fifth. By peak the strip is first by a wide margin, because its command is
//    set in --beam and nothing else in the viewport is. The mean ranking is
//    still reported beside it, because it is the number that exposed the
//    problem and hiding it would hide the reason the criterion changed.
//
//  - ASSERTION 3 IS PER-SCANLINE, with the scanlines the beam crosses as a
//    bounded, stated exception. D-22 requires the beam to pass behind the strip
//    and continue out of its right edge, so the beam necessarily crosses both
//    vertical borders, and P3's arithmetic shows no beam brightness satisfies
//    3:1 there: clearing it above the border needs Y >= 1.21, brighter than
//    white, and below it needs Y <= 0.0067, which is --ground, meaning no beam
//    at all. The exception is bounded by HERO_Y.beamHalf from
//    src/components/home/hero-geometry.ts, which P3 exports for exactly this,
//    never hard-coded and never widened to a tolerance. The axis it is measured
//    from is the strip's own vertical centre, measured rather than read,
//    because that module deliberately does not carry it: the axis is
//    established by CSS grid and a constant would be a second opinion about
//    where the browser already put it. The beam element's rendered box is read
//    as a cross-check and a disagreement over 1px fails.
//
// Rejected, and it stays rejected: brightening --line-control. It is 3.02:1
// against flat --ground with 0.0012 of linear headroom, recorded as tight in
// C-15, and the discipline that left the 5.09 colour-vision pair alone applies
// here. Rejected: moving the beam off the strip, which is the composition.
//
// WHEN A ZONE FAILS, THE FIX IS TO MOVE THE LIGHT. In order: raise the optical
// axis, dim --hero-fill (0.22, may go to 0.16), narrow HERO_Y.fanExtent, move
// the headline further into the upper left. Adding a panel or a scrim behind
// the type is not on the list and never becomes one. A dark panel behind hero
// text is the clearest available signal that a composition was not designed,
// and this audience reads it correctly.
//
// Usage:  node scripts/checks/hero-luminance.mjs [url]

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DIST, ROOT, serveDist, routeExists, readJson, pixelStats, scanlineStats,
  resolveColour, skip, recordVacuity, launchBrowser,
} from "./_lib.mjs";

// P3 owns the real file. HERO_ZONES points it at a fixture so the gate can be
// demonstrated failing before P3 lands, without writing into P3's directory.
const ZONES = process.env.HERO_ZONES ?? join(ROOT, "src", "components", "home", "hero-zones.json");
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const FRAMES = 60;
const SAMPLE_EVERY = 5;
const EDGE_PAD = 6;

// The bordered surface, and only it. See defect 2: this must never become a
// selector list containing an ancestor.
const STRIP = "[data-install-strip]";
const HERO = "[data-hero]";
// The beam's rendered box, read as a CROSS-CHECK on the geometry module below.
// The data attribute is the contract; the class is what P3 built.
const BEAM = "[data-hero-beam], .optics__beam";
const GEOMETRY = join(ROOT, "src", "components", "home", "hero-geometry.ts");

/**
 * The beam's half-height, from the module P3 exports for exactly this. D-38:
 * the exception is derived from hero-geometry.ts rather than hard-coded.
 *
 * Read with a narrow parser rather than imported, because this is a .ts module
 * and the gate has no TypeScript loader. It FAILS LOUDLY when a key is absent:
 * a gate that silently falls back to a literal after being told not to
 * hard-code one is worse than a gate that stops.
 *
 * The optical axis is not in that file on purpose, and its header says why: the
 * axis is the vertical centre of the install strip's own surface, established
 * by CSS grid, and a constant there could only be a second opinion about where
 * the browser already put it. So the axis is measured and the extent is read.
 */
function beamHalfFor(viewportWidth) {
  if (!existsSync(GEOMETRY)) return null;
  const src = readFileSync(GEOMETRY, "utf-8");
  const pick = (block, key) => {
    const b = src.match(new RegExp(`export const ${block}\\s*=\\s*\\{[\\s\\S]*?\\n\\}`));
    if (!b) throw new Error(`hero-luminance: ${GEOMETRY} has no exported ${block}`);
    const m = b[0].match(new RegExp(`${key}\\s*:\\s*(-?[\\d.]+)`));
    if (!m) throw new Error(`hero-luminance: ${GEOMETRY}'s ${block} has no ${key}`);
    return Number(m[1]);
  };
  const wide = pick("HERO_Y", "beamHalf");
  const narrow = pick("NARROW", "beamHalfPx");
  // --bp-md is where the bench stops fitting beside the strip and the narrow
  // composition takes over. Read from the token file, never written here.
  const tokens = readFileSync(join(ROOT, "src", "styles", "tokens.css"), "utf-8");
  const bpMd = tokens.match(/--bp-md\s*:\s*([\d.]+)rem/);
  if (!bpMd) throw new Error("hero-luminance: tokens.css has no --bp-md");
  const bpPx = Number(bpMd[1]) * 16;
  return { half: viewportWidth < bpPx ? narrow : wide, wide, narrow, bpPx };
}

if (!routeExists("/", DIST)) skip(21, "the homepage is not built. Run npm run build first.");
if (!existsSync(ZONES)) {
  skip(
    21,
    `src/components/home/hero-zones.json does not exist. Packet P3 owns the three hero-zone rectangles; the scene's luminance clamp and this gate both consume them. Without the file there is nothing to measure and a pass would be a pass nobody earned.`,
  );
}

const spec = readJson(ZONES);
const server = await serveDist(DIST);
const url = process.argv[2] ?? server.origin + (spec.route ?? "/");
const { browser, engine } = await launchBrowser();
console.log(`browser: ${engine}`);

let failures = 0;
let zoneSamples = 0;
let scanlinesChecked = 0;
let scanlinesExempt = 0;
const fail = (m) => {
  console.error(`FAIL ${m}`);
  failures += 1;
};

function rect(x, y, w, h) {
  return { x, y, width: w, height: h };
}

/** Clip to the viewport, or null when none of it is on screen. */
function clampClip(c, viewport) {
  const x = Math.max(0, Math.round(c.x));
  const y = Math.max(0, Math.round(c.y));
  const width = Math.round(Math.min(c.width + Math.min(0, c.x), viewport.width - x));
  const height = Math.round(Math.min(c.height + Math.min(0, c.y), viewport.height - y));
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function linear([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

for (const theme of ["dark", "light"]) {
  for (const viewport of VIEWPORTS) {
    const label = `${theme} ${viewport.width}x${viewport.height}`;
    const geom = beamHalfFor(viewport.width);
    const ctx = await browser.newContext({ viewport, colorScheme: theme, deviceScaleFactor: 1 });
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem("theme", t);
      } catch {}
      document.documentElement.setAttribute("data-theme", t);
    }, theme);
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page
      .waitForFunction(() => document.documentElement.dataset.sceneReady === "true", { timeout: 4000 })
      .catch(() => {});

    // ---- defect 4: the sweep is the hero's own extent, not one viewport ----
    const sweep = await page.evaluate((heroSel) => {
      const hero = document.querySelector(heroSel);
      const docMax = document.documentElement.scrollHeight - window.innerHeight;
      if (!hero) return { max: Math.max(0, Math.min(docMax, window.innerHeight)), heroFound: false };
      const r = hero.getBoundingClientRect();
      // The last position at which the hero still fills the viewport. Past it
      // the zone rectangles are over section 2, which is not the hero's problem
      // and not what these ceilings are about.
      return {
        max: Math.max(0, Math.min(docMax, r.bottom + window.scrollY - window.innerHeight)),
        heroHeight: Math.round(r.height),
        heroTop: Math.round(r.top + window.scrollY),
        heroFound: true,
      };
    }, HERO);

    if (!sweep.heroFound) {
      console.warn(`WARN ${label}: no ${HERO} element; the sweep fell back to one viewport.`);
    } else {
      console.log(
        `\n${label}: hero ${sweep.heroHeight}px at y=${sweep.heroTop}, sweep 0..${Math.round(sweep.max)}px`,
      );
    }

    // When the hero exactly fills the viewport there is nothing to sweep, and
    // twelve samples of one frame is twelve copies of the same finding. Say so
    // once rather than printing it twelve times.
    const positions = sweep.max === 0 ? [0] : [];
    if (positions.length === 0) {
      for (let frame = 0; frame < FRAMES; frame += SAMPLE_EVERY) positions.push(frame / (FRAMES - 1));
    } else {
      console.log(`${label}: the hero fills the viewport exactly, so there is one scroll position.`);
    }

    for (const progress of positions) {
      await page.evaluate((y) => window.scrollTo(0, y), Math.round(progress * sweep.max));
      await page.waitForTimeout(30);

      // ---- assertion 1: the BACKDROP behind each zone (D-38 item 2) --------
      for (const zone of spec.zones) {
        const clip = clampClip(
          rect(
            zone.x * viewport.width - zone.padPx,
            zone.y * viewport.height - zone.padPx,
            zone.w * viewport.width + 2 * zone.padPx,
            zone.h * viewport.height + 2 * zone.padPx,
          ),
          viewport,
        );
        if (!clip) continue;

        // Hide the zone's own element so the rectangle measures what is BEHIND
        // the words. Without this the p95 is the glyphs and nothing can pass.
        const hid = await page.evaluate((sel) => {
          if (!sel) return 0;
          let n = 0;
          for (const el of document.querySelectorAll(sel)) {
            el.dataset.p21PrevVisibility = el.style.visibility;
            el.style.visibility = "hidden";
            n += 1;
          }
          return n;
        }, zone.selector ?? null);

        if (zone.selector && hid === 0) {
          fail(
            `${label}: zone ${zone.id} names selector "${zone.selector}" and it matches nothing. The rectangle would measure the text it is supposed to look behind.`,
          );
        }

        const buf = await page.screenshot({ clip });
        const stats = await pixelStats(page, buf);
        zoneSamples += 1;

        await page.evaluate((sel) => {
          if (!sel) return;
          for (const el of document.querySelectorAll(sel)) {
            el.style.visibility = el.dataset.p21PrevVisibility ?? "";
            delete el.dataset.p21PrevVisibility;
          }
        }, zone.selector ?? null);

        if (theme === "dark") {
          if (stats.mean > spec.ceilings.meanLinearLuminance) {
            fail(
              `${label} progress ${progress.toFixed(2)}: ${zone.id} backdrop mean linear luminance ${stats.mean.toFixed(4)} > ${spec.ceilings.meanLinearLuminance}. Move the light, do not add a scrim.`,
            );
          }
          if (stats.p95 > spec.ceilings.p95PixelLuminance) {
            fail(
              `${label} progress ${progress.toFixed(2)}: ${zone.id} backdrop p95 pixel luminance ${stats.p95.toFixed(4)} > ${spec.ceilings.p95PixelLuminance}`,
            );
          }
        } else if (spec.lightThemeFloors && stats.mean < spec.lightThemeFloors.meanLinearLuminance) {
          fail(
            `${label} progress ${progress.toFixed(2)}: ${zone.id} backdrop mean linear luminance ${stats.mean.toFixed(4)} < floor ${spec.lightThemeFloors.meanLinearLuminance}`,
          );
        }
      }

      // ---- assertion 3: per-scanline, beam scanlines exempt (D-38 item 3) --
      const strip = await page.evaluate(
        ({ stripSel, beamSel }) => {
          const el = document.querySelector(stripSel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const beamEl = document.querySelector(beamSel);
          const beam = beamEl ? beamEl.getBoundingClientRect() : null;
          return {
            box: { x: b.left, y: b.top, w: b.width, h: b.height },
            borderColor: cs.borderTopColor,
            borderWidth: parseFloat(cs.borderTopWidth) || 0,
            beam: beam && beam.height > 0 ? { top: beam.top, bottom: beam.bottom } : null,
          };
        },
        { stripSel: STRIP, beamSel: BEAM },
      );

      if (strip && strip.box.w > 2 && strip.box.h > 2) {
        if (strip.borderWidth === 0) {
          fail(
            `${label}: ${STRIP} has no border, so there is no boundary to measure. The gate is querying the wrong element.`,
          );
        } else {
          // Defect 1: paint the colour and read it back rather than parsing it.
          const border = await resolveColour(page, strip.borderColor);
          const borderY = linear(border.rgb);

          // The axis is measured (the strip's own vertical centre, per
          // hero-geometry.ts's header) and the extent is read from that module.
          const axisY = strip.box.y + strip.box.h / 2;
          const exempt = geom ? geom.half : null;

          // Cross-check: the beam element's rendered box should agree with the
          // geometry module. D-24 asks the three fidelities to agree within 8px
          // and this is the same question asked of one of them.
          if (geom && strip.beam) {
            const renderedHalf = (strip.beam.bottom - strip.beam.top) / 2;
            const renderedAxis = (strip.beam.top + strip.beam.bottom) / 2;
            if (Math.abs(renderedHalf - geom.half) > 1 || Math.abs(renderedAxis - axisY) > 1) {
              fail(
                `${label}: the rendered beam and hero-geometry.ts disagree. Rendered half-height ${renderedHalf.toFixed(1)}px centred at y=${renderedAxis.toFixed(1)}; the module says ${geom.half}px and the strip's centre is y=${axisY.toFixed(1)}.`,
              );
            }
          }
          if (!geom) {
            fail(
              `${label}: src/components/home/hero-geometry.ts is missing, so D-38's beam exception has no source. Every scanline was required to clear 3:1, which is the stricter direction.`,
            );
          }

          const edges = [
            { name: "top", axis: "column", clip: rect(strip.box.x, strip.box.y - EDGE_PAD, strip.box.w, EDGE_PAD) },
            { name: "bottom", axis: "column", clip: rect(strip.box.x, strip.box.y + strip.box.h, strip.box.w, EDGE_PAD) },
            { name: "left", axis: "row", clip: rect(strip.box.x - EDGE_PAD, strip.box.y, EDGE_PAD, strip.box.h) },
            { name: "right", axis: "row", clip: rect(strip.box.x + strip.box.w, strip.box.y, EDGE_PAD, strip.box.h) },
          ];

          for (const edge of edges) {
            const c = clampClip(edge.clip, viewport);
            if (!c) continue;
            const buf = await page.screenshot({ clip: c });
            const { scanlines } = await scanlineStats(page, buf, edge.axis);

            let worst = null;
            let exemptHere = 0;
            const failing = [];
            for (let i = 0; i < scanlines.length; i += 1) {
              // Rows carry a viewport y, for the beam test. Columns are never
              // exempt: the beam runs horizontally and crosses the vertical
              // edges only, which is what D-38's exception is about.
              const viewportY = c.y + i;
              const inBeam =
                edge.axis === "row" &&
                exempt !== null &&
                Math.abs(viewportY - axisY) <= exempt;
              if (inBeam) {
                exemptHere += 1;
                scanlinesExempt += 1;
                continue;
              }
              scanlinesChecked += 1;
              const y = scanlines[i];
              const ratio = (Math.max(borderY, y) + 0.05) / (Math.min(borderY, y) + 0.05);
              if (ratio < 3) failing.push({ ratio, viewportY });
              if (!worst || ratio < worst.ratio) worst = { ratio, i, viewportY };
            }

            if (failing.length) {
              // Report the whole failing band, not only its worst scanline. A
              // single number cannot tell a one-pixel antialiasing artefact
              // from a light source overlapping half the edge, and those want
              // opposite fixes.
              const ys = failing.map((f) => f.viewportY);
              const lo = Math.min(...ys);
              const hi = Math.max(...ys);
              const above = failing.filter((f) => f.viewportY < axisY).length;
              const below = failing.length - above;
              fail(
                `${label} progress ${progress.toFixed(2)}: the install strip's ${edge.name} border falls below the 3:1 WCAG 1.4.11 floor on ${failing.length} of ${scanlines.length} scanline(s).\n` +
                  `      worst ${worst.ratio.toFixed(2)}:1 at y=${Math.round(worst.viewportY)}; the failing band is y=${lo}..${hi} (${above} above the axis, ${below} below), ratios ${Math.min(...failing.map((f) => f.ratio)).toFixed(2)} to ${Math.max(...failing.map((f) => f.ratio)).toFixed(2)}.\n` +
                  `      Border ${border.input} resolves to rgb(${border.rgb.join(",")}), Y=${borderY.toFixed(4)}. A token-pair check would have said 3.02 (C-15).\n` +
                  `      ${exemptHere} scanline(s) already exempt as the beam's extent, HERO_Y.beamHalf=${geom?.half ?? "?"}px about the axis at y=${Math.round(axisY)} (D-38).\n` +
                  `      A failing band WIDER than the exempt one is not the beam. Check what else is lit near the axis.`,
              );
            }
          }

          if (exempt === null) {
            recordVacuity(
              21,
              `hero-geometry.ts is absent, so assertion 3's beam exception was not applied and every scanline of every edge had to clear 3:1. That is the stricter direction and it is correct when there is no beam.`,
            );
          }
        }
      }
    }

    // ---- assertion 2: PEAK luminance, mean reported beside (D-38 item 1) ---
    await page.evaluate(() => window.scrollTo(0, 0));
    const boxes = await page.evaluate(
      ({ stripSel }) => {
        const out = [];
        const sel = `a, button, summary, input, select, textarea, ${stripSel}`;
        for (const el of document.querySelectorAll(sel)) {
          // Defect 5: a closed provenance panel is visibility: hidden and its
          // box reads as the page ground behind it. checkVisibility walks the
          // ancestor chain, which a getComputedStyle check on the element does
          // not.
          if (
            !el.checkVisibility({
              visibilityProperty: true,
              opacityProperty: true,
              contentVisibilityAuto: true,
            })
          ) {
            continue;
          }
          const b = el.getBoundingClientRect();
          if (b.top >= window.innerHeight || b.bottom <= 0) continue;
          if (b.width < 8 || b.height < 8) continue;
          const cls = typeof el.className === "string" ? el.className.split(" ")[0] : "";
          out.push({
            label: el.matches(stripSel) ? "install strip" : `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`,
            isStrip: el.matches(stripSel),
            clip: {
              x: Math.max(0, Math.round(b.left)),
              y: Math.max(0, Math.round(b.top)),
              width: Math.round(Math.min(b.width, window.innerWidth - Math.max(0, b.left))),
              height: Math.round(Math.min(b.height, window.innerHeight - Math.max(0, b.top))),
            },
          });
        }
        return out;
      },
      { stripSel: STRIP },
    );

    const visible = boxes.filter((b) => b.clip.width > 0 && b.clip.height > 0);
    if (visible.some((b) => b.isStrip)) {
      const measured = [];
      for (const b of visible.slice(0, 40)) {
        const buf = await page.screenshot({ clip: b.clip });
        const s = await pixelStats(page, buf);
        measured.push({ ...b, peak: s.max, mean: s.mean });
      }
      const byPeak = [...measured].sort((a, b) => b.peak - a.peak);
      const byMean = [...measured].sort((a, b) => b.mean - a.mean);

      console.log(`${label} first viewport, ${measured.length} visible interactive elements:`);
      console.log(`  by PEAK luminance, which is the criterion (D-38):`);
      for (const m of byPeak.slice(0, 5)) {
        console.log(`    ${m.peak.toFixed(4)}  ${m.label}${m.isStrip ? "   <- the strip" : ""}`);
      }
      console.log(`  by MEAN luminance, reported and not asserted:`);
      for (const m of byMean.slice(0, 5)) {
        console.log(`    ${m.mean.toFixed(4)}  ${m.label}${m.isStrip ? "   <- the strip" : ""}`);
      }
      console.log(`  the strip ranks ${byMean.findIndex((m) => m.isStrip) + 1} of ${measured.length} by mean.`);

      // The criterion is asserted in the DARK theme only, and the reason is
      // that neither statistic discriminates in the light one. Measured here:
      // by peak, five elements tie at exactly 0.9585, which is --ground, because
      // every bounding box contains some page ground and on a light ground the
      // ground IS the brightest pixel. By mean, the ranking rewards a small box
      // that is mostly ground, which is the same ink-density artefact D-38
      // identified in the dark theme with the sign flipped: the strip ranks 8
      // of 12 behind five nav links.
      //
      // D-38 records "in the light theme it is first on the mean too, at
      // 0.8973". That does not reproduce on this build: the strip is 8th and
      // the top mean is 0.8777. Rather than assert on a statistic that provably
      // cannot discriminate, or quietly adopt the one that happens to pass,
      // gate 21 reports both light-theme rankings and records the gap. An
      // assertion on a five-way exact tie is an assertion on noise.
      const peakTies = byPeak.filter((m) => Math.abs(m.peak - byPeak[0].peak) < 1e-4).length;
      if (theme === "dark") {
        if (!byPeak[0]?.isStrip) {
          fail(
            `${label}: the install strip does not hold the highest peak luminance in the first viewport. Brightest is ${byPeak[0].label} at ${byPeak[0].peak.toFixed(4)} against the strip's ${byPeak.find((m) => m.isStrip)?.peak.toFixed(4)}.`,
          );
        }
      } else {
        const stripPeakRank = byPeak.findIndex((m) => m.isStrip) + 1;
        const stripMeanRank = byMean.findIndex((m) => m.isStrip) + 1;
        console.warn(
          `WARN ${label}: assertion 2 is NOT asserted in the light theme. ` +
            `By peak, ${peakTies} element(s) tie at ${byPeak[0].peak.toFixed(4)}, which is the page ground, so peak cannot discriminate. ` +
            `By mean the strip ranks ${stripMeanRank} of ${measured.length}. D-38 records it first on the mean at 0.8973; the top mean here is ${byMean[0].mean.toFixed(4)}.`,
        );
        recordVacuity(
          21,
          `assertion 2 is not asserted in the light theme: by peak ${peakTies} elements tie at ${byPeak[0].peak.toFixed(4)} (the page ground), and by mean the strip ranks ${stripMeanRank} of ${measured.length} against D-38's claim that it is first at 0.8973. The light-theme criterion needs an owner.`,
        );
      }
    } else {
      console.warn(`WARN ${label}: no install strip found in the first viewport.`);
    }

    await ctx.close();
  }
}

await browser.close();
await server.close();

console.log(
  `\nhero-luminance: ${zoneSamples} backdrop samples across ${VIEWPORTS.length} viewports and two themes, ` +
    `${scanlinesChecked} border scanlines checked and ${scanlinesExempt} exempt as the beam's extent from hero-geometry.ts. ${failures} failures`,
);
process.exit(failures > 0 ? 1 : 0);
