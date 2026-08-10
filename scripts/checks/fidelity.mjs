// Gate 20 · Hero fidelity
//
// D-24: one composition, three fidelities, agreeing within 8px on the beam
// axis, the prism centroid and the detector x. The SVG room ships in wave 1 and
// renders at frame one; the composed still is an upgrade over it; the live
// scene is an upgrade over that. D-17 adopted the scene conditionally and the
// condition was that the site is finished without it. That condition now
// applies to the composition rather than to the technology, which is why the
// three have to agree: if the shader spike misses budget and S1 is cut, the SVG
// room ships and the hero is still the hero.
//
// THE CONTRACT THIS GATE MEASURES, so each packet can build to it rather than
// guess. Each fidelity exposes landmarks in viewport pixels, by either of two
// mechanisms:
//
//   BY RECT     an element carrying data-landmark="beam-axis",
//               "prism-centroid" or "detector-plane", anywhere inside the
//               fidelity's root. Measured with getBoundingClientRect, centre
//               point. The SVG room and the vector still both do this.
//   BY FRACTION [data-fidelity="still"] carries data-beam-axis="<y>" and
//               data-prism-centroid="<x>,<y>" as fractions of its own box. A
//               raster still has no elements to measure, so this is the
//               mechanism a headless-gl still would meet, and it is checked
//               against the rects when a still supplies both.
//   BY PROJECTION
//               window.__scene.landmarks() returns
//               { beamAxis: y, prismCentroid: [x, y] } in viewport pixels, and
//               MAY also return detectorX. A canvas has no rects to read, so it
//               projects the points itself.
//
// A fidelity that is absent is reported as absent. A fidelity that is present
// and exposes no landmarks FAILS, because that is the case where the gate would
// otherwise quietly compare two things and call it three.
//
// THE THIRD LANDMARK IS OPTIONAL PER FIDELITY AND THE ABSENCE IS PRINTED.
// D-24 names the detector x and nothing exposed it, so the composition's
// right-hand end was the one part of it no gate read. The SVG room and the
// still expose it now. `window.__scene.landmarks()` does not yet, and that is
// reported by name on every run rather than passed over: a gate that compares
// two of three landmarks and prints "pass" is the failure mode this file's
// header has warned about since it was written.
//
// Usage:  node scripts/checks/fidelity.mjs [url]

import { DIST, serveDist, routeExists, skip, recordVacuity, launchBrowser } from "./_lib.mjs";

const TOLERANCE_PX = 8;
const WIDTHS = [390, 768, 1024, 1440, 1920];

/** The landmarks compared, in the order D-24 names them. */
const LANDMARKS = [
  { key: "beamAxis", label: "beam axis", axis: "y" },
  { key: "prismCentroid", label: "prism centroid", axis: "xy" },
  { key: "detectorX", label: "detector x", axis: "x" },
];

if (!routeExists("/", DIST)) {
  skip(20, "the homepage is not built. Run npm run build first.");
}

const server = await serveDist(DIST);
const url = process.argv[2] ?? server.origin + "/";
const { browser, engine } = await launchBrowser();
console.log(`browser: ${engine}`);

let failures = 0;
let compared = 0;
const absentAt = new Set();
const missingLandmark = new Set();
/** The three deltas, per pair, at every width, for the handoff to quote. */
const worst = new Map();

for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  // The scene sets this when it is ready. Absent is fine; it means one fewer
  // fidelity to compare, and that is reported rather than passed over.
  await page
    .waitForFunction(() => document.documentElement.dataset.sceneReady === "true", { timeout: 4000 })
    .catch(() => {});

  const landmarks = await page.evaluate(() => {
    /** Centre of a [data-landmark] element's rect, or null. */
    const byRect = (root, name) => {
      const el = root.querySelector(`[data-landmark="${name}"]`);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return [b.left + b.width / 2, b.top + b.height / 2];
    };

    const read = (root) => {
      const axis = byRect(root, "beam-axis");
      const prism = byRect(root, "prism-centroid");
      const detector = byRect(root, "detector-plane");
      if (!axis || !prism) return null;
      return {
        beamAxis: axis[1],
        prismCentroid: prism,
        detectorX: detector ? detector[0] : undefined,
      };
    };

    const out = {};

    const svgRoot = document.querySelector('[data-fidelity="svg"]');
    if (svgRoot) out.svg = read(svgRoot) ?? { incomplete: true };

    const stillRoot = document.querySelector('[data-fidelity="still"]');
    if (stillRoot) {
      const b = stillRoot.getBoundingClientRect();
      const ay = stillRoot.dataset.beamAxis;
      const pc = stillRoot.dataset.prismCentroid;
      const declared =
        ay != null && pc != null
          ? {
              beamAxis: b.top + Number(ay) * b.height,
              prismCentroid: [
                b.left + Number(pc.split(",")[0]) * b.width,
                b.top + Number(pc.split(",")[1]) * b.height,
              ],
            }
          : null;
      const drawn = read(stillRoot);
      out.still = drawn ?? declared ?? { incomplete: true };
      // A still that says one thing and draws another is a still whose
      // generator and whose component have come apart. Both are reported here
      // rather than silently preferring one.
      if (drawn && declared) {
        out.stillSelfCheck = {
          beamAxis: Math.abs(drawn.beamAxis - declared.beamAxis),
          prismCentroid: Math.hypot(
            drawn.prismCentroid[0] - declared.prismCentroid[0],
            drawn.prismCentroid[1] - declared.prismCentroid[1],
          ),
        };
      }
    }

    if (window.__scene?.landmarks) {
      const l = window.__scene.landmarks();
      out.scene = l
        ? { beamAxis: l.beamAxis, prismCentroid: l.prismCentroid, detectorX: l.detectorX }
        : { incomplete: true };
    }
    return out;
  });

  const selfCheck = landmarks.stillSelfCheck;
  delete landmarks.stillSelfCheck;

  if (selfCheck) {
    console.log(
      `  ${width}px  still, drawn vs declared: beam axis ${selfCheck.beamAxis.toFixed(1)}px, ` +
        `prism centroid ${selfCheck.prismCentroid.toFixed(1)}px`,
    );
    for (const [name, delta] of Object.entries(selfCheck)) {
      if (delta > TOLERANCE_PX) {
        console.error(
          `FAIL ${width}px: the still DRAWS its ${name} ${delta.toFixed(1)}px from where it DECLARES it ` +
            `(limit ${TOLERANCE_PX}). The generated geometry and the component have come apart.`,
        );
        failures += 1;
      }
    }
  }

  const present = Object.entries(landmarks);
  for (const [name, l] of present) {
    if (l.incomplete) {
      console.error(
        `FAIL ${width}px: the ${name} fidelity is present and exposes no landmarks. ` +
          `Without them the gate compares two fidelities and reports three.`,
      );
      failures += 1;
    }
  }
  const usable = present.filter(([, l]) => !l.incomplete);
  for (const name of ["svg", "still", "scene"]) {
    if (!usable.some(([n]) => n === name)) absentAt.add(name);
  }
  for (const [name, l] of usable) {
    for (const { key, label } of LANDMARKS) {
      if (l[key] === undefined || l[key] === null) missingLandmark.add(`${name}: ${label}`);
    }
  }

  const delta = (a, b, key) => {
    if (a[key] === undefined || b[key] === undefined || a[key] === null || b[key] === null) {
      return null;
    }
    if (key === "prismCentroid") {
      return Math.hypot(a[key][0] - b[key][0], a[key][1] - b[key][1]);
    }
    return Math.abs(a[key] - b[key]);
  };

  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      const [na, a] = usable[i];
      const [nb, b] = usable[j];
      compared += 1;
      const line = [];
      for (const { key, label } of LANDMARKS) {
        const d = delta(a, b, key);
        if (d === null) {
          line.push(`${label} not exposed by both`);
          continue;
        }
        const pair = `${na} vs ${nb}`;
        // -1 rather than 0, so a pair that agrees exactly is still recorded.
        // A summary table that omits its zeros is a table that only ever shows
        // the failures, and 0.0px across five widths is the result this gate
        // exists to produce.
        const prev = worst.get(`${pair}|${label}`) ?? -1;
        if (d > prev) worst.set(`${pair}|${label}`, d);
        if (d > TOLERANCE_PX) {
          console.error(
            `FAIL ${width}px: ${na} and ${nb} disagree on the ${label} by ${d.toFixed(1)}px (limit ${TOLERANCE_PX})`,
          );
          failures += 1;
        } else {
          line.push(`${label} ${d.toFixed(1)}px`);
        }
      }
      if (line.length) console.log(`  ${width}px  ${na} vs ${nb}: ${line.join(", ")}`);
    }
  }
  await ctx.close();
}

await browser.close();
await server.close();

if (compared === 0) {
  skip(
    20,
    `no fidelity on the homepage exposes composition landmarks. Absent: ${[...absentAt].join(", ")}. ` +
      `Packet P3 builds the SVG room and the fallback packet the still (D-24). The contract is in this file's header.`,
  );
}

console.log(`\nworst delta over ${WIDTHS.length} widths, tolerance ${TOLERANCE_PX}px:`);
for (const [key, d] of [...worst.entries()].sort()) {
  const [pair, label] = key.split("|");
  console.log(`  ${pair.padEnd(18)} ${label.padEnd(16)} ${d.toFixed(1)}px`);
}

if (missingLandmark.size) {
  // Partial coverage is recorded, not swallowed. `reports/vacuous-gates.json`
  // is the file to read before believing a green run.
  const reason = `these fidelity/landmark pairs are not exposed and were not compared: ${[...missingLandmark].sort().join("; ")}`;
  console.warn(`\nfidelity: ${reason}`);
  recordVacuity(20, reason);
}

console.log(
  `\nfidelity: ${compared} pairwise comparison(s) across ${WIDTHS.length} widths, ` +
    `${LANDMARKS.length} landmarks each, ${failures} failures` +
    (absentAt.size ? `\nfidelity: absent at one or more widths: ${[...absentAt].join(", ")}` : ""),
);
process.exit(failures > 0 ? 1 : 0);
