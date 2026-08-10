// A still out of every shot, so the film gets looked at rather than reported on.
//
//   node film/scripts/contact-sheet.mjs [composition-id]
//
// Writes one PNG per shot into film/out/contact/, taken at 55% through each
// shot, which is past its entrance and before its exit. HANDOFF.md §7 is the
// rule this exists to serve: a fix is verified against rendered output, never
// against a diff and never against its own report.

import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

import { buildTimeline } from "../remotion/lib/timeline.mjs";

const FILM = dirname(dirname(fileURLToPath(import.meta.url)));
const SITE = dirname(FILM);
const id = process.argv[2] ?? "film-wide";

const manifest = JSON.parse(readFileSync(join(FILM, "manim", "out", "manifest.json"), "utf-8"));
const timeline = buildTimeline(
  JSON.parse(readFileSync(join(SITE, "src", "data", "run-series.json"), "utf-8")),
  manifest,
  JSON.parse(readFileSync(join(FILM, "out", "copy.json"), "utf-8")),
);

const out = join(FILM, "out", "contact", id);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const serveUrl = await bundle({
  entryPoint: join(FILM, "remotion", "index.ts"),
  publicDir: join(FILM, "public"),
  onProgress: () => undefined,
});
const composition = await selectComposition({ serveUrl, id, inputProps: {} });

let n = 0;
for (const shot of timeline.shots) {
  const frame = shot.from + Math.round(shot.frames * 0.55);
  n += 1;
  const output = join(out, `${String(n).padStart(2, "0")}-${shot.id}.png`);
  await renderStill({
    composition,
    serveUrl,
    output,
    frame,
    imageFormat: "png",
    scale: 2,
    inputProps: {},
  });
  console.log(`${output}  frame ${frame}`);
}
