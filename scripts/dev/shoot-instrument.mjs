// Capture the instrument movement: three widths in both themes, one frame per
// state, and one frame between each adjacent pair.
//
// `scripts/dev/shoot.mjs` photographs a whole page and cannot stop partway
// through a scroll-bound movement, which is where every interesting failure of
// this packet lives: a pose that snaps at a boundary, an assembly that vanishes
// between two states, a sticky column that clips its own controls. So this
// walks the movement and shoots the positions between the keyframes as well as
// the keyframes.
//
// It waits on `data-scene-ready` rather than on `networkidle`. A page with a
// live render loop never goes network-idle within the default timeout, and the
// shared shoot script times out on this route for exactly that reason.
//
// Usage: node scripts/dev/shoot-instrument.mjs <url> <label> [--widths=390,768,1440]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [url, label = "scene-controls"] = process.argv.slice(2);
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `=${d}`).split("=").pop();
const widths = arg("widths", "390,768,1440").split(",").map(Number);
const out = `design/dossier/build/${label}`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/opt/google/chrome/google-chrome",
  args: ["--no-sandbox"],
});

let failed = false;

for (const theme of ["dark", "light"]) {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: theme,
      // Freezing motion and waiting for the scene are mutually exclusive: a
      // reader who asked for less motion is served the composed still and no
      // canvas mounts at all, so `data-scene-ready` could never appear.
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.evaluate(() => document.fonts.ready);
    await page
      .waitForSelector('html[data-scene-ready="true"]', { timeout: 15000 })
      .catch(() => console.warn(`  ${width} ${theme}: scene not ready, shot the still`));
    await page.waitForTimeout(600);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const ok = scrollWidth <= width;
    if (!ok) failed = true;
    console.log(`${label} ${width} ${theme}: scrollWidth=${scrollWidth} ${ok ? "OK" : "*** OVERFLOW ***"}`);

    await page.screenshot({ path: `${out}/${width}-${theme}.png`, fullPage: true });

    // The five states and the four positions between them. A reader can stop
    // anywhere, so the between frames are the ones worth opening.
    const stops = await page.evaluate(() => {
      const story = document.querySelector("[data-instrument-story]");
      if (!story) return [];
      const names = [...story.querySelectorAll("[data-instrument-state]")].map(
        (el) => el.dataset.instrumentState,
      );
      const between = [];
      for (let i = 0; i < names.length - 1; i += 1) between.push(`${names[i]}~${names[i + 1]}`);
      return [...names, ...between];
    });

    for (const name of stops) {
      /*
        The scroll target is measured immediately before the scroll, never from
        a list computed up front. On a long page the islands below the fold
        hydrate as the page scrolls and every precomputed offset goes stale: the
        first run of this script against the homepage photographed the selection
        state and the instrument reported it was still in the scorer, because
        the page had grown underneath the number.
      */
      await page.evaluate(async (wanted) => {
        const story = document.querySelector("[data-instrument-story]");
        const articles = [...story.querySelectorAll("[data-instrument-state]")];
        const centre = (el) => {
          const r = el.getBoundingClientRect();
          return r.top + window.scrollY + r.height / 2 - window.innerHeight / 2;
        };
        const target = () => {
          const [a, b] = wanted.split("~");
          const first = articles.find((el) => el.dataset.instrumentState === a);
          if (!b) return centre(first);
          const second = articles.find((el) => el.dataset.instrumentState === b);
          return (centre(first) + centre(second)) / 2;
        };
        /*
          Walk to the target rather than jumping to it.

          The story's observer keeps whichever states are in its band and lets
          the earliest win, so a single long jump past two boundaries can leave
          the state it started in still marked: on the homepage this
          photographed the selection state while the instrument reported the
          scorer. A reader scrolls; the harness should too. The intermediate
          poses are the point of these frames anyway.
        */
        const from = window.scrollY;
        const to = target();
        const steps = 12;
        for (let i = 1; i <= steps; i += 1) {
          window.scrollTo(0, from + ((to - from) * i) / steps);
          await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 24)));
        }
        window.scrollTo(0, target());
      }, name);
      await page.waitForTimeout(450);
      const read = await page.evaluate(() => {
        const s = window.__instrument?.read?.();
        const p = window.__scene?.pose?.();
        return s && p
          ? `${s.activeState} local=${s.localProgress.toFixed(2)} progress=${p.progress.toFixed(3)} cam=${p.cameraPosition.map((v) => v.toFixed(2)).join(",")}`
          : "no instrument state";
      });
      console.log(`  ${width} ${theme} ${name}: ${read}`);
      await page.screenshot({ path: `${out}/${width}-${theme}-${name}.png` });
    }

    await context.close();
  }
}

await browser.close();
if (failed) process.exit(1);
