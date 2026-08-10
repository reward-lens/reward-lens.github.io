// The one command. `npm run film` from the site root, or `npm run render` from
// film/, and everything below happens with no manual step anywhere in the chain:
//
//   1. a Python environment with Manim, created if it is not there
//   2. the site's four woff2 faces decompressed so Pango can read them
//   3. both Manim inserts rendered to transparent PNG sequences, and a manifest
//      written so the Remotion timeline knows exactly how many frames each has
//   4. the Remotion bundle
//   5. three aspect ratios of the film, each composed for its frame
//   6. the poster stills, and the caption sidecar
//   7. the figure films
//
// Flags:
//   --only=film-wide,figure-run   render a subset
//   --skip-manim                  reuse the PNG sequences already on disk
//
// Everything lands in film/out/, which is ignored. Nothing is written outside
// film/, and nothing is installed system-wide.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { buildTimeline, toVtt } from "../remotion/lib/timeline.mjs";

// @remotion/bundler and @remotion/renderer are imported DYNAMICALLY, below the
// bootstrap. A static import is resolved before the first line of this file
// runs, so on a machine with no film/node_modules the script died on the import
// and the install step it carries never executed. Verified by deleting
// node_modules, .venv, .fonts and out and running `npm run film`, which is the
// only way to find this.

const FILM = dirname(dirname(fileURLToPath(import.meta.url)));
const SITE = dirname(FILM);
const OUT = join(FILM, "out");
const MANIM_OUT = join(FILM, "manim", "out");
const PUBLIC = join(FILM, "public");

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",") : null;
const skipManim = args.includes("--skip-manim");
const wanted = (id) => !only || only.includes(id);

const say = (...parts) => console.log("film:", ...parts);

const sh = (cmd, cmdArgs, options = {}) => {
  const result = spawnSync(cmd, cmdArgs, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${cmdArgs.join(" ")} exited ${result.status}`);
  }
};

// -----------------------------------------------------------------------------
// 1. The two toolchains, bootstrapped if absent.
// -----------------------------------------------------------------------------

const VENV = join(FILM, ".venv");
const PY = join(VENV, "bin", "python");

if (!existsSync(join(FILM, "node_modules"))) {
  say("installing the Remotion toolchain");
  sh("npm", ["install", "--no-audit", "--no-fund"], { cwd: FILM });
}

if (!existsSync(PY)) {
  say("creating film/.venv and installing Manim");
  sh("python3", ["-m", "venv", VENV]);
  sh(PY, ["-m", "pip", "install", "--quiet", "--upgrade", "pip"]);
  sh(PY, ["-m", "pip", "install", "--quiet", "manim==0.19.0", "fonttools", "brotli"]);
}

// -----------------------------------------------------------------------------
// 2 and 3. Fonts, then the inserts.
//
// The counts are read back off disk rather than computed from the run times.
// Manim rounds each animation up to a whole frame, so an eight-second insert is
// 254 frames and not 240, and a timeline that assumed 240 would drop the last
// fourteen frames of the construction without failing.
// -----------------------------------------------------------------------------

const INSERTS = [
  { key: "insertA", file: "insert_a.py", scene: "InsertA", dir: "insert_a", prefix: "InsertA" },
  { key: "insertB", file: "insert_b.py", scene: "InsertB", dir: "insert_b", prefix: "InsertB" },
];

// One render per aspect ratio, at that ratio's OUTPUT resolution, so the insert
// is placed at 100% width with no resampling and its type is the same size as
// the type Remotion draws in the same frame. Resizing one 16:9 raster into all
// three is the cropped-from-the-wide-one outcome §5.6 exists to prevent, and it
// is visible: a viewer sees two sizes of the same type role.
const FORMATS = [
  { name: "wide", w: 1920, h: 1080 },
  { name: "square", w: 1080, h: 1080 },
  { name: "tall", w: 1080, h: 1920 },
];

// Every composition is laid out at half its output size and rendered at this
// scale, so the film uses the site's type roles literally: a 17px body in the
// composition is a 34px band in a 1920-wide frame, which is what a 17px body
// looks like on a 1920-wide screen. Named once because Manim has to agree with
// it, and a second copy of the number is how the two renderers drift.
const FILM_SCALE = 2;

// The film's in-frame strings, extracted from the single frozen document before
// anything renders. Manim reads this file with the standard library and Remotion
// imports it, so there is one source and two consumers rather than a YAML parser
// in a Python process and another in a webpack bundle.
mkdirSync(OUT, { recursive: true });
const { parse } = await import("yaml");
const copyDocument = parse(readFileSync(join(SITE, "design", "copy.yaml"), "utf-8"));
if (!copyDocument.film) {
  throw new Error("design/copy.yaml has no `film` key. Every string in the film comes from it.");
}
writeFileSync(join(OUT, "copy.json"), JSON.stringify(copyDocument.film, null, 2) + "\n");

// The type scale, extracted from the same tokens.css that remotion/theme.css
// imports, so no font size is typed into the film. Remotion gets these through
// the stylesheet; Manim cannot read CSS, so it reads this file instead. One
// source, two consumers, exactly as for the copy above.
//
// WHY THIS EXISTS AT ALL. filmlib.sized_text sizes type by CAP HEIGHT, which is
// the right API because it is exact for any face. The two constants that fed it
// were the token font sizes doubled, so a role documented as `--type-mono-label`
// (11px) was being built with a 22px cap height, which is the cap height of a
// 31.5px font. Every Manim label rendered 1.43x larger than the same role drawn
// by Remotion in the next shot: measured 22px against 17px on a rendered still.
// A font size is not a cap height, and the conversion between them belongs to
// the face. See filmlib.cap_ratio.
const REM = 16;
const typeCss = readFileSync(join(SITE, "src", "styles", "tokens.css"), "utf-8");
const typeSizes = {};
for (const line of typeCss.split("\n")) {
  const match = line.match(/--type-([a-z0-9-]+)-size:\s*([0-9.]+)rem;(?:\s*\/\*\s*(\d+)px)?/);
  if (!match) continue; // clamp() roles are responsive and the film uses none of them
  const [, role, rem, stated] = match;
  const px = Number(rem) * REM;
  // The trailing comment is the token file's own statement of the same value.
  // Checking them against each other costs nothing and catches a root font size
  // that is not 16px, which would make every one of these silently wrong.
  if (stated !== undefined && Number(stated) !== px) {
    throw new Error(
      `tokens.css: --type-${role}-size is ${rem}rem, which is ${px}px at a ${REM}px root, ` +
        `but its own comment says ${stated}px.`,
    );
  }
  typeSizes[role] = px;
}
writeFileSync(
  join(OUT, "type.json"),
  JSON.stringify({ scale: FILM_SCALE, rootPx: REM, sizes: typeSizes }, null, 2) + "\n",
);

const countFrames = (format, dir) => {
  const path = join(MANIM_OUT, format, "images", dir);
  if (!existsSync(path)) return 0;
  return readdirSync(path).filter((n) => n.endsWith(".png")).length;
};

if (!skipManim) {
  sh(PY, [join(FILM, "scripts", "fonts.py")]);
  rmSync(MANIM_OUT, { recursive: true, force: true });
  for (const format of FORMATS) {
    for (const insert of INSERTS) {
      say(`rendering ${insert.scene} at ${format.name} ${format.w}x${format.h}`);
      sh(
        PY,
        [
          "-m",
          "manim",
          "render",
          "-r",
          `${format.w},${format.h}`,
          "--fps",
          "30",
          "-t",
          "--format=png",
          "--media_dir",
          join("out", format.name),
          insert.file,
          insert.scene,
        ],
        { cwd: join(FILM, "manim"), env: { ...process.env, PYTHONPATH: join(FILM, "manim") } },
      );
    }
  }
}

// The frame counts are read back off disk rather than computed from the run
// times. Manim rounds each animation up to a whole frame, so an eight-second
// insert is 255 frames and not 240, and a timeline that assumed 240 would drop
// the last fifteen frames of the construction without failing.
//
// The three formats play identical animations, so their counts agree; the
// timeline takes the longest and the Insert component clamps, so a future
// per-format beat change cannot make one aspect ratio a different length from
// another.
const manifest = {};
for (const insert of INSERTS) {
  const perFormat = {};
  for (const format of FORMATS) {
    const frames = countFrames(format.name, insert.dir);
    if (frames === 0) {
      throw new Error(
        `no frames for ${insert.scene} at ${format.name}. Run without --skip-manim.`,
      );
    }
    perFormat[format.name] = {
      frames,
      path: `${format.name}/images/${insert.dir}`,
      prefix: insert.prefix,
    };
  }
  manifest[insert.key] = {
    frames: Math.max(...FORMATS.map((f) => perFormat[f.name].frames)),
    formats: perFormat,
  };
}
writeFileSync(join(MANIM_OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
say(
  "inserts:",
  INSERTS.map(
    (i) =>
      `${i.scene} ` +
      FORMATS.map((f) => `${f.name} ${manifest[i.key].formats[f.name].frames}f`).join(" / "),
  ).join(", "),
);

// The PNG sequences are served to the browser through Remotion's public dir. A
// symlink rather than a copy: the sequences are 500-odd 1920x1080 rasters and
// copying them once per render is a minute of disk for nothing.
mkdirSync(PUBLIC, { recursive: true });
const link = join(PUBLIC, "inserts");
rmSync(link, { recursive: true, force: true });
symlinkSync(relative(PUBLIC, MANIM_OUT), link, "dir");

// -----------------------------------------------------------------------------
// 4. The bundle.
// -----------------------------------------------------------------------------

const { bundle } = await import("@remotion/bundler");
const { renderMedia, renderStill, selectComposition } = await import("@remotion/renderer");

say("bundling");
const serveUrl = await bundle({
  entryPoint: join(FILM, "remotion", "index.ts"),
  publicDir: PUBLIC,
  onProgress: () => undefined,
});

// -----------------------------------------------------------------------------
// 5 to 7. The renders.
//
// Every composition is laid out at half its output size and rendered at scale 2.
// That is what lets the film use the site's own type roles literally: a 17px
// body in the composition is a 34px band in a 1920-wide frame, which is what a
// 17px body looks like on a 1920-wide screen.
// -----------------------------------------------------------------------------

const timeline = buildTimeline(
  JSON.parse(readFileSync(join(SITE, "src", "data", "run-series.json"), "utf-8")),
  manifest,
  copyDocument.film,
);

// The poster is shot 7 at the end of its reveal, with the fitted midpoint drawn.
const posterShot = timeline.shots.find((s) => s.id === "transition");
const posterFrame = posterShot.from + posterShot.frames - 4;

// Every figure film is laid out at the width it is displayed at, so its 12px
// labels are 12px labels in a figure frame, and rendered at 1.5x for a dense
// screen. The budget is 400,000 bytes each, counted against the act page it sits
// on, which is what crf is tuned against. Brief §5.7: one that pushes a page
// over gets shortened, not exempted.
const FIGURE = { codec: "vp9", crf: 44, scale: 1.5 };

const TARGETS = [
  { id: "film-wide", out: "film/reward-lens-wide.mp4", codec: "h264", crf: 22, scale: FILM_SCALE, poster: "film/poster-wide.webp", posterFrame },
  { id: "film-square", out: "film/reward-lens-square.mp4", codec: "h264", crf: 22, scale: FILM_SCALE, poster: "film/poster-square.webp", posterFrame },
  { id: "film-tall", out: "film/reward-lens-tall.mp4", codec: "h264", crf: 22, scale: FILM_SCALE, poster: "film/poster-tall.webp", posterFrame },
  // The poster frame of each figure film is the moment its own construction is
  // complete and held, which is the frame a reader sees before pressing play and
  // the one that renders under reduced motion. It is not the last frame: all
  // three fade out over their final half second so the loop does not snap.
  { id: "figure-run", out: "figure/see-run.webm", ...FIGURE, poster: "figure/see-run.webp", posterFrame: 200 },
  { id: "figure-reward-model", out: "figure/see-reward-model.webm", ...FIGURE, poster: "figure/see-reward-model.webp", posterFrame: 215 },
  { id: "figure-grader", out: "figure/see-grader.webm", ...FIGURE, poster: "figure/see-grader.webp", posterFrame: 205 },
];

const bytes = (path) => statSync(path).size;
const results = [];

for (const target of TARGETS) {
  if (!wanted(target.id)) continue;
  const composition = await selectComposition({ serveUrl, id: target.id, inputProps: {} });
  const outPath = join(OUT, target.out);
  mkdirSync(dirname(outPath), { recursive: true });
  say(`rendering ${target.id}`);
  await renderMedia({
    composition,
    serveUrl,
    codec: target.codec,
    crf: target.crf,
    scale: target.scale,
    outputLocation: outPath,
    inputProps: {},
    // No audio track at all, rather than a silent one. The film is silent by
    // default and if narration is ever added it is recorded by a person, not
    // synthesised. A file that claims to be silent and carries an empty AAC
    // stream is a small thing to be caught being loose about, on a site whose
    // pitch is that its claims check out.
    muted: true,
    enforceAudioTrack: false,
    onProgress: () => undefined,
  });
  const posterPath = join(OUT, target.poster);
  await renderStill({
    composition,
    serveUrl,
    output: posterPath,
    frame: target.posterFrame,
    imageFormat: "webp",
    scale: target.scale,
    inputProps: {},
  });
  results.push({
    id: target.id,
    film: [target.out, bytes(outPath)],
    poster: [target.poster, bytes(posterPath)],
  });
}

// -----------------------------------------------------------------------------
// The caption sidecar, from the same cue list the burned track renders.
// -----------------------------------------------------------------------------

const vttPath = join(OUT, "film", "captions.vtt");
mkdirSync(dirname(vttPath), { recursive: true });
writeFileSync(vttPath, toVtt(timeline));

// -----------------------------------------------------------------------------
// The report. Sizes are the acceptance criterion for the figure films, so they
// are printed rather than left for someone to go and measure.
// -----------------------------------------------------------------------------

const FIGURE_BUDGET = 400_000;

console.log("");
say(`length ${(timeline.frames / timeline.fps).toFixed(2)}s, ${timeline.frames} frames at ${timeline.fps}fps`);
say(`captions ${toVtt(timeline).split("\n\n").length - 1} cues -> ${relative(SITE, vttPath)}`);
console.log("");
const over = [];
for (const result of results) {
  const [film, filmBytes] = result.film;
  const [poster, posterBytes] = result.poster;
  const isFigure = result.id.startsWith("figure-");
  // A figure film and its poster BOTH land on the act page, so the pair is what
  // the page's budget pays for. Counting the film alone would understate it by
  // the size of the still every reader downloads first.
  const total = filmBytes + posterBytes;
  const budget = isFigure ? ` (${total} with poster, budget ${FIGURE_BUDGET})` : "";
  if (isFigure && total > FIGURE_BUDGET) over.push([result.id, total]);
  console.log(
    `  ${result.id.padEnd(19)} ${film.padEnd(30)} ${String(filmBytes).padStart(9)} bytes${budget}`,
  );
  console.log(`  ${"".padEnd(19)} ${poster.padEnd(30)} ${String(posterBytes).padStart(9)} bytes`);
}

// Brief §5.7: a figure film that pushes its page over budget gets SHORTENED, not
// exempted. So this fails the render rather than printing a number somebody has
// to notice. There is no allow-list and no flag to pass.
if (over.length) {
  console.log("");
  for (const [id, total] of over) {
    say(`OVER BUDGET: ${id} is ${total} bytes against ${FIGURE_BUDGET}.`);
  }
  say("Shorten it or raise its crf. Do not exempt it.");
  process.exitCode = 1;
}

// One open escalation, printed on every render so it cannot ship by being
// forgotten. It is a one-word copy edit and needs no code change, which is the
// point of binding the caption rather than overriding it.
if (/\btokens?\b/i.test(copyDocument.film.insert_a.every_token)) {
  console.log("");
  say("OPEN: copy.yaml:film.insert_a.every_token names a unit the data does not carry.");
  console.log(`    reads    "${copyDocument.film.insert_a.every_token}"`);
  console.log(
    '    over     the insert A counter, which reads "MEAN COMPLETION CHARACTERS . STEP 1"',
  );
  console.log(
    "    because  the public rollout table records characters and publishes no token field;",
  );
  console.log(
    "             run-series.json perEpisode.note says deriving one would be a number with",
  );
  console.log("             no measurement behind it.");
  console.log("    fix      one word in copy.yaml, then re-render. No code change.");
}

// The second open escalation, and the same mechanism: printed on every render so
// it cannot ship by being forgotten, and needing no code change when it is ruled
// on. copy.yaml:film was written when the film had two inserts and one figure
// film. It has no key for anything the other two figure films would say, so both
// are built to carry their reading in the construction and in their frame's own
// title instead of composing four words here. If the build lead would rather
// they were labelled, these are the keys, and the code that would consume them
// is one <text> element each.
const WANTED_COPY = [
  ["film.figure_reward_model.attribution", "the left column of /see/reward-model/'s figure film"],
  ["film.figure_reward_model.patching", "the right column of the same figure"],
  ["film.figure_grader.survived", "what a lit mark means on /see/grader/'s figure film"],
  ["film.figure_grader.killed", "what a dark one means"],
];
const missing = WANTED_COPY.filter(([path]) => {
  const parts = path.split(".").slice(1);
  let node = copyDocument.film;
  for (const part of parts) {
    if (typeof node !== "object" || node === null || !(part in node)) return true;
    node = node[part];
  }
  return false;
});
if (missing.length) {
  console.log("");
  say("OPEN: two figure films are unlabelled because no copy key names their axes.");
  for (const [path, where] of missing) {
    console.log(`    ${path.padEnd(42)} ${where}`);
  }
  console.log(
    "    Both render and both are legible: each column and each mark is identified by the",
  );
  console.log(
    "    component id, card name and corpus read out of the generated file, and the figure",
  );
  console.log(
    "    frame's own title says which ranking is which. Nothing in frame was composed here.",
  );
}
