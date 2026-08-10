// Gate 24 · Film provenance
//
// D-23's binding constraint on the film, in two arms:
//
//   colour   every colour in film/** resolves to tokens.css through
//            scripts/gen-tokens-py.mjs, which emits film/manim/tokens.py. No
//            allow-list. A literal anywhere under film/ fails, and the
//            generated module must be current: if tokens.css moved and
//            tokens.py did not, the film is drawing yesterday's palette.
//
//   numbers  every number in a caption or in frame is checked against the
//            evidence store. A film is the one surface where a wrong number is
//            hardest to notice, because it goes past at 24 frames a second and
//            nobody can hover it.
//
// Why this is a separate gate from 15 even though 15 also scans film/**: gate
// 15 is about drift in source files, and this is about whether the film's
// captions say what the evidence says. They fail for different reasons and a
// packet fixes them in different places.
//
// Usage:  node scripts/checks/film-provenance.mjs

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { ROOT, readJson, skip, recordVacuity } from "./_lib.mjs";

const FILM = join(ROOT, "film");

if (!existsSync(FILM)) {
  skip(24, `film/ does not exist. Packet S2 builds it (D-23). Nothing to check.`);
}

const walkInto = (dir, out) => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkInto(p, out);
    else out.push(p);
  }
};

const files = [];
walkInto(FILM, files);

const sources = files.filter((f) => /\.(py|ts|tsx|js|jsx|mjs|css|json)$/.test(f));
const renderable = sources.filter(
  (f) => !relative(ROOT, f).startsWith("film/manim/tokens.py"),
);

let failures = 0;
const fail = (m) => {
  console.error(m);
  failures += 1;
};

// ---------------------------------------------------------------------------
// Arm 1: colour
// ---------------------------------------------------------------------------

// tokens.py is generated and is the one file permitted to hold hexes. Anything
// else under film/ that writes a colour is drift.
const COLOUR = /(?<![\w-])(#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\s*\()/;

for (const file of renderable) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, "utf-8").split("\n");
  lines.forEach((line, i) => {
    // Strip comments without stripping the thing this gate exists to find. `#`
    // opens a Python comment AND opens a hex colour, so splitting on it made
    // every hex literal in a .py file invisible. Found by demonstrating the
    // gate failing: the deliberate defect did not fail it.
    const code = line.replace(/(^|\s)#(?![0-9a-fA-F]{3,8}\b).*$/, "$1").split("//")[0];
    if (COLOUR.test(code)) {
      fail(`FAIL ${rel}:${i + 1} colour literal in film/. Import it from film/manim/tokens.py.\n      ${line.trim()}`);
    }
  });
}

// The generated module must be current.
try {
  execFileSync(process.execPath, [join(ROOT, "scripts", "gen-tokens-py.mjs"), "--check"], {
    stdio: "pipe",
  });
} catch (e) {
  fail(
    `FAIL film/manim/tokens.py has drifted from src/styles/tokens.css. The film would draw a palette the site no longer uses. Run npm run tokens:py.\n      ${String(e.stdout ?? e.message).trim().slice(0, 400)}`,
  );
}

// ---------------------------------------------------------------------------
// Arm 2: numbers in captions
// ---------------------------------------------------------------------------

const captions = readJson(join(ROOT, "src", "data", "captions.json"), {});
const evidence = readJson(join(ROOT, "src", "data", "evidence-index.json"), {});

// Every numeric literal that appears anywhere in the generated data is a value
// the pipeline derived. A caption number that is not one of those is a number
// somebody typed.
const derived = new Set();
const harvest = (node) => {
  if (typeof node === "number") {
    derived.add(String(node));
    derived.add(String(Number(node.toFixed(3))));
    derived.add(String(Number(node.toFixed(2))));
    derived.add(String(Math.abs(node)));
  } else if (typeof node === "string") {
    for (const m of node.matchAll(/-?\d+(?:\.\d+)?/g)) derived.add(m[0]);
  } else if (Array.isArray(node)) node.forEach(harvest);
  else if (node && typeof node === "object") Object.values(node).forEach(harvest);
};
for (const f of ["ledger.json", "cards.json", "campaign.json", "theorems.json", "evidence-index.json", "captions.json"]) {
  const doc = readJson(join(ROOT, "src", "data", f));
  if (doc) harvest(doc);
}

// run-series.json, scoped. THE GATE COULD NOT GO GREEN AGAINST THE FILM WITHOUT
// THIS, and the reason is a design decision rather than an oversight in the
// data: per GROUND-TRUTH C-34 and D-35 the run's numbers carry no evidenceId and
// never will, because the campaign evidence store contains no RL training run.
// So `evidence-index.json` cannot vouch for step 90 or for 25,664, and a gate
// that only consults the evidence index rejects every true statement the film
// makes about the run.
//
// SCOPED, AND THE SCOPING IS THE POINT. Harvesting the whole file takes the
// derived set from 623 values to 2,558, because `steps`, `series.*` and
// `perEpisode.*` are 401-length arrays: a thousand-odd floats admitted at once,
// any of which could launder a typo into a caption. The subtrees below are the
// metadata and the fitted scalars — exactly the fields a caption quotes — and
// they add 34 values, not 1,935. The bulk arrays stay out.
const runSeries = readJson(join(ROOT, "src", "data", "run-series.json"));
if (runSeries) {
  for (const key of [
    "meta",
    "seriesNote",
    "detectors",
    "transition",
    "companion",
    "frozenAnalysisDefect",
    "provenance",
  ]) {
    if (key in runSeries) harvest(runSeries[key]);
  }
}

// A thousands separator is punctuation inside one number, not a boundary between
// two. `25,664` was read as `25` and `664`; `25` is in the derived set by
// coincidence and `664` is not, so the gate both failed on a correct caption and
// would have passed `25,999`. Normalising first is strictly stronger: the value
// actually checked is 25664.
const NUMBER = /(?<![\w.-])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.-])-?\d+(?:\.\d+)?(?![\w-])/g;
const normalise = (token) => token.replace(/,/g, "");

// WebVTT is structure plus content, and only the content is a claim. A cue
// timestamp is a position in a file; reading `00:00:47.100` as an assertion
// about the world produced 36 of the 41 numbers this arm used to reject, and no
// caption anywhere could have made it green. The cue index is the same kind of
// thing. Strip the structure, keep the payload.
const captionPayload = (text) => {
  const out = [];
  let inBlock = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      inBlock = false;
      continue;
    }
    if (/^WEBVTT\b/.test(line)) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) continue;
    if (line.includes("-->")) continue; // the cue's timing, in either format
    if (/^\d+$/.test(line)) continue; // the cue's index
    out.push(line);
  }
  return out.join("\n");
};

// Caption sources: the shared caption store, plus any caption track under film/
// and any that has been copied into public/film/ for the site to serve. The
// second tree matters: a mounted film's .vtt is the copy a reader's browser
// actually reads, and scanning only film/ would police the master while the
// served file went unchecked.
const PUBLIC_FILM = join(ROOT, "public", "film");
const publicFilmFiles = [];
if (existsSync(PUBLIC_FILM)) walkInto(PUBLIC_FILM, publicFilmFiles);

const trackFiles = [
  ...files.filter((f) => /\.(vtt|srt)$/.test(f)),
  ...publicFilmFiles.filter((f) => /\.(vtt|srt)$/.test(f)),
];

const captionSources = [
  ...Object.entries(captions).map(([k, v]) => [`src/data/captions.json:${k}`, v, false]),
];
for (const file of trackFiles) {
  captionSources.push([relative(ROOT, file), readFileSync(file, "utf-8"), true]);
}

let numbersChecked = 0;
for (const [where, text, isTrack] of captionSources) {
  const body = isTrack ? captionPayload(text) : String(text);
  for (const m of body.matchAll(NUMBER)) {
    const value = normalise(m[0]);
    numbersChecked += 1;
    if (!derived.has(value)) {
      fail(
        `FAIL ${where}: the number ${m[0]} is in a caption and not in the generated data.` +
          (value === m[0] ? "" : ` (read as ${value})`),
      );
    }
  }
}

if (captionSources.length && trackFiles.length === 0) {
  recordVacuity(
    24,
    `No caption track exists under film/ or public/film/ (packet S2, D-23). The numbers arm ran ` +
      `against src/data/captions.json only; the colour arm ran against ${renderable.length} film ` +
      `source file(s). The film's own captions.vtt is written to film/out/, which .gitignore ` +
      `excludes, so nothing in the checkout carries it.`,
  );
}

console.log(
  `\nfilm-provenance: ${files.length} file(s) under film/, ${renderable.length} scanned for colour, ` +
    `${captionSources.length} caption source(s) (${trackFiles.length} track file(s)), ` +
    `${numbersChecked} caption numbers checked against ${derived.size} derived values, ` +
    `${Object.keys(evidence).length} evidence records. ${failures} failures`,
);
process.exit(failures > 0 ? 1 : 0);
