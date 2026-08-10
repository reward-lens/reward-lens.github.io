/**
 * Every arm of gates 16 and 17, shown failing on a violation built for it.
 *
 * WHY THIS EXISTS. Six gates in this repository have passed or failed for the
 * wrong reason. Gate 16 reported "scene: absent" against a build containing a
 * 1.19 MB scene chunk, and wrote that into the vacuity ledger as a fact. Gate 17
 * compared a frame interval against a frame-work budget and failed every route
 * by arithmetic, and the arm that replaced it compared a left-truncated
 * distribution's p95 against 16.6 and failed whenever any entry existed. In all
 * three the gate was green or red for reasons unrelated to the site.
 *
 * The common thread is that nobody had watched the arm fire on a violation it
 * was written to catch. So each arm below gets a dist/ of its own with exactly
 * one thing wrong with it, the real gate is run against that dist/ through the
 * DIST_DIR hook _lib.mjs already provides, and the message it produced is
 * recorded verbatim. An arm that does not fire here is reported as UNPROVEN, not
 * quietly skipped.
 *
 * The copies are hardlink farms, so eight of them cost a few megabytes rather
 * than two hundred, and only the violated file is ever replaced with a real one.
 *
 * Usage: node tests/perf/gate-violations.mjs
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { ROOT, DIST } from "../../scripts/checks/_lib.mjs";

const WORK = join(ROOT, ".astro", "gate-violations");
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const walk = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const sceneChunk = walk(DIST).find((f) => /_astro\/InstrumentScene\..*\.js$/.test(f));

/** A dist/ that is this one, with `mutate` applied to the copy. */
function variant(name, mutate) {
  const dir = join(WORK, name);
  // cp -al: hardlinks, so a 26 MB dist costs kilobytes per variant. Any file the
  // mutation writes is replaced outright, which breaks the link rather than
  // editing the original through it.
  execFileSync("cp", ["-al", DIST, dir]);
  mutate(dir);
  return dir;
}

/**
 * Both streams, whatever the exit code.
 *
 * execFileSync returns stdout on success and throws with both on failure, so a
 * gate that WARNS on stderr and exits 0 comes back looking silent. That is what
 * happened to the software-rasteriser arm on the first run of this file: the
 * warning fired, the arm worked, and this harness reported it UNPROVEN because
 * it had thrown the stream away.
 */
const runGate = (script, dir, env = {}, argv = []) => {
  const r = spawnSync("node", [script, ...argv], {
    cwd: ROOT,
    env: { ...process.env, DIST_DIR: dir, ...env },
    encoding: "utf-8",
    timeout: 900000,
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
};

const cases = [];

// --- gate 16 ---------------------------------------------------------------

cases.push({
  gate: 16,
  arm: "site fonts over budget",
  expect: /site fonts total .* over the .* budget/,
  dir: variant("fonts", (d) => {
    mkdirSync(join(d, "fonts"), { recursive: true });
    // 96 KB is the budget and the build sits at 76,436, so one 32 KB face is
    // enough to cross it and small enough that nothing else changes.
    writeFileSync(join(d, "fonts", "violation-face.woff2"), Buffer.alloc(32 * 1024, 7));
  }),
});

cases.push({
  gate: 16,
  arm: "scene over the 400 KB budget",
  expect: /scene total .* over the .* budget/,
  dir: variant("scene-fat", (d) => {
    const f = join(d, "_astro", sceneChunk.split("/").pop());
    // Random bytes, because the budget is measured after gzip and a run of
    // zeroes would compress to nothing and prove the opposite of the point.
    const pad = Buffer.alloc(600 * 1024);
    for (let i = 0; i < pad.length; i += 1) pad[i] = (Math.random() * 256) | 0;
    writeFileSync(f, Buffer.concat([readFileSync(sceneChunk), Buffer.from("\n//"), pad]));
  }),
});

cases.push({
  gate: 16,
  arm: "scene source present but no scene chunk in the build",
  expect: /src\/components\/scene exists but no built chunk contains/,
  dir: variant("scene-gone", (d) => {
    // This is the failure the old detector could not express: it would have
    // reported "scene: absent" and recorded a vacuity saying so.
    for (const f of walk(join(d, "_astro"))) {
      if (/\.js$/.test(f)) {
        const t = readFileSync(f, "utf-8");
        if (/WebGLRenderer|THREE\.WebGL|BufferGeometry/.test(t)) rmSync(f);
      }
    }
  }),
});

cases.push({
  gate: 16,
  arm: "homepage first visit over 900 KB",
  expect: /homepage first visit .* over the .* budget/,
  dir: variant("home-fat", (d) => {
    const pad = Buffer.alloc(900 * 1024);
    for (let i = 0; i < pad.length; i += 1) pad[i] = (Math.random() * 256) | 0;
    writeFileSync(join(d, "_astro", "violation.chunk.js"), pad);
    const idx = join(d, "index.html");
    writeFileSync(idx, readFileSync(idx, "utf-8").replace("</head>", `<script type="module" src="/_astro/violation.chunk.js"></script></head>`));
  }),
});

cases.push({
  gate: 16,
  arm: "documentation page over the 40 KB JS budget",
  expect: /documentation page .* ships .* bytes JS, over the/,
  dir: variant("docs-fat", (d) => {
    const pad = Buffer.alloc(80 * 1024);
    for (let i = 0; i < pad.length; i += 1) pad[i] = (Math.random() * 256) | 0;
    writeFileSync(join(d, "_astro", "violation.docs.js"), pad);
    const page = walk(join(d, "docs")).find((f) => f.endsWith("index.html"));
    writeFileSync(page, readFileSync(page, "utf-8").replace("</head>", `<script type="module" src="/_astro/violation.docs.js"></script></head>`));
  }),
});

cases.push({
  gate: 16,
  arm: "KaTeX fonts back in the build are reported and recorded, not silently absorbed",
  expect: /fonts, KaTeX: 1 files/,
  dir: variant("katex-back", (d) => {
    writeFileSync(join(d, "_astro", "KaTeX_Main-Bold.violation.woff2"), Buffer.alloc(64 * 1024, 3));
  }),
});

// --- gate 17 ---------------------------------------------------------------
// The timing arms are disarmed on this host by the software-rasteriser guard,
// which is correct and is exactly why they need forcing to be demonstrated.

cases.push({
  gate: 17,
  arm: "software rasteriser disarms the timing arms and records a vacuity",
  expect: /the adapter is a software rasteriser/,
  dir: DIST,
  expectCode: 0,
});

cases.push({
  gate: 17,
  arm: "long-task arm, guard forced off",
  expect: /long task .* over the 50ms limit/,
  dir: DIST,
  env: { FRAMES_ASSUME_GPU: "1" },
});

cases.push({
  gate: 17,
  arm: "long-frame-share arm, guard forced off and the share budget tightened",
  // This host produces about 1% long frames over the scripted scroll, under the
  // 5% budget, and there is no way to induce more without changing the page. So
  // the budget is tightened instead, which exercises the same comparison and the
  // same message. Like FRAMES_ASSUME_GPU this hook can only make the gate
  // stricter than it ships.
  expect: /frames exceeded 50ms .* over the .*% budget at tier B/,
  dir: DIST,
  env: { FRAMES_ASSUME_GPU: "1", FRAMES_LONG_SHARE_BUDGET: "0.001" },
});

cases.push({
  gate: 17,
  arm: "refuses to record a baseline from a software rasteriser",
  expect: /refusing to record a baseline from a software rasteriser/,
  dir: DIST,
  argv: ["--record"],
});

// ---------------------------------------------------------------------------

const results = [];
for (const c of cases) {
  const script = c.gate === 16 ? "scripts/checks/budgets.mjs" : "scripts/checks/frames.mjs";
  const r = runGate(script, c.dir, c.env ?? {}, c.argv ?? []);

  const matched = c.expect.test(r.out);
  const wantCode = c.expectCode ?? 1;
  const line = (r.out.split("\n").find((l) => c.expect.test(l)) ?? "").trim();
  results.push({
    gate: c.gate,
    arm: c.arm,
    fired: matched,
    exitCode: r.code,
    exitCodeExpected: wantCode,
    exitCodeAsExpected: r.code === wantCode,
    message: line,
  });
  console.log(
    `${matched ? "PROVEN " : "UNPROVEN"} gate ${c.gate}  ${c.arm}\n` +
      `         exit ${r.code} (expected ${wantCode})\n` +
      `         ${line || "(no line matched the expected pattern)"}\n`,
  );
}

const unproven = results.filter((r) => !r.fired);
console.log(`\n${results.length - unproven.length} of ${results.length} arms demonstrated firing.`);
if (unproven.length) {
  console.log(`UNPROVEN: ${unproven.map((r) => `gate ${r.gate} ${r.arm}`).join("; ")}`);
}

mkdirSync(join(ROOT, "design/dossier/build/perf"), { recursive: true });
writeFileSync(
  join(ROOT, "design/dossier/build/perf/gate-violations.json"),
  JSON.stringify(
    {
      _method:
        "Each arm gets a hardlink copy of dist/ with exactly one violation injected, and the real gate is run against it through the DIST_DIR hook in scripts/checks/_lib.mjs. The message recorded is the line the gate actually printed. Gate 17's timing arms are disarmed on this host by the software-rasteriser guard, so they are forced on with FRAMES_ASSUME_GPU=1, which only ever makes that gate stricter.",
      _host: "no GPU; Chrome falls back to SwiftShader. Gate 17's numbers are not device measurements.",
      proven: results.filter((r) => r.fired).length,
      total: results.length,
      results,
    },
    null,
    2,
  ) + "\n",
);
rmSync(WORK, { recursive: true, force: true });
console.log(`\nwritten: design/dossier/build/perf/gate-violations.json`);
process.exit(unproven.length ? 1 : 0);
