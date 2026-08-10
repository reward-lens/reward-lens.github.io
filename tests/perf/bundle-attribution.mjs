/**
 * How much of the 1.19 MB scene chunk is three.js, how much is React Three
 * Fiber, and how much is the scene's own code.
 *
 * The shipped chunk carries no sourcemap, so the split cannot be read off the
 * build. It is measured instead by bundling each dependency on its own with the
 * same bundler, the same minifier and the same target as the site build, and
 * gzipping the result. Each row is therefore "what this dependency costs when
 * bundled the way the site bundles", which is the question the byte budget in
 * SCENE.md is asking.
 *
 * WHAT THE ROWS ARE NOT. They are not a partition of the chunk and they do not
 * add up to it: three and R3F share nothing, but the scene imports only part of
 * three and tree-shaking removes the rest, so `three, whole` is an upper bound
 * rather than a contribution. The row that answers the budget question is
 * `three, as the scene imports it`, which pulls exactly the specifiers the scene
 * source names. Both are reported, because the gap between them is the value the
 * tier system and the addon imports are buying.
 *
 * Usage: node tests/perf/bundle-attribution.mjs
 */
import { build } from "vite";
import { mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { ROOT, DIST } from "../../scripts/checks/_lib.mjs";

const WORK = join(ROOT, ".astro", "bundle-attribution");
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

/** Which three specifiers the scene source actually imports. */
const sceneSrc = walk(join(ROOT, "src", "components", "scene")).filter((f) => /\.tsx?$/.test(f));
const threeNamed = new Set();
const threeAddons = new Set();
for (const f of sceneSrc) {
  const text = readFileSync(f, "utf-8");
  for (const m of text.matchAll(/import\s+(type\s+)?\{([^}]+)\}\s+from\s+"three"/g)) {
    if (m[1]) continue; // `import type { ... } from "three"` is erased entirely
    for (const part of m[2].split(",")) {
      // `import { type ToneMapping }` is erased at compile time and is not in
      // three's runtime exports, so bundling it as a value fails the whole row.
      // The first version of this stripped the word "type" and kept the name,
      // which turned a type-only import into a missing-export error.
      if (/\btype\b/.test(part)) continue;
      const name = part.trim();
      if (name) threeNamed.add(name);
    }
  }
  for (const m of text.matchAll(/from\s+"(three\/addons\/[^"]+)"/g)) threeAddons.add(m[1]);
}

const ENTRIES = {
  "three, whole": `import * as THREE from "three"; console.log(THREE);`,
  "three, as the scene imports it": `import { ${[...threeNamed].join(", ")} } from "three";\n${[...threeAddons]
    .map((a, i) => `import * as A${i} from "${a}";`)
    .join("\n")}\nconsole.log(${[...threeNamed].join(", ")}${threeAddons.size ? ", " + [...threeAddons].map((_, i) => `A${i}`).join(", ") : ""});`,
  "@react-three/fiber, with three": `import * as F from "@react-three/fiber"; console.log(F);`,
  "@react-three/fiber, three external": `import * as F from "@react-three/fiber"; console.log(F);`,
  "react + react-dom": `import * as R from "react"; import * as D from "react-dom/client"; console.log(R, D);`,
};

const rows = [];
for (const [label, code] of Object.entries(ENTRIES)) {
  const dir = join(WORK, label.replace(/[^a-z0-9]+/gi, "-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "entry.js"), code);
  try {
    await build({
      root: dir,
      logLevel: "error",
      build: {
        outDir: join(dir, "out"),
        // Externalising react keeps the three and R3F rows from carrying a copy
        // of it, which is how the site builds them too: react is its own chunk.
        rollupOptions: {
          input: join(dir, "entry.js"),
          external: [
            ...(label.startsWith("react") ? [] : ["react", "react-dom", "react-dom/client", "react/jsx-runtime"]),
            // The "three external" row isolates R3F's own code: R3F depends on
            // three, so bundling it whole charges three's bytes to R3F and the
            // two rows would double-count the same 185 KB.
            ...(label.includes("three external") ? ["three"] : []),
          ],
          output: { entryFileNames: "b.js", inlineDynamicImports: true },
        },
        minify: "esbuild",
        target: "es2022",
        write: true,
      },
    });
    const f = join(dir, "out", "b.js");
    const raw = readFileSync(f);
    rows.push({ label, raw: raw.length, gzip: gzipSync(raw).length });
  } catch (e) {
    rows.push({ label, error: String(e).split("\n")[0] });
  }
}

const shipped = walk(DIST).find((f) => /_astro\/InstrumentScene\..*\.js$/.test(f));
const shippedRaw = shipped ? statSync(shipped).size : 0;
const shippedGz = shipped ? gzipSync(readFileSync(shipped)).length : 0;

const kb = (n) => (n / 1024).toFixed(1);
console.log(`\nscene bundle attribution, measured by bundling each dependency the way the site bundles it\n`);
console.log(`  what                                         raw KB    gzip KB`);
for (const r of rows) {
  if (r.error) console.log(`  ${r.label.padEnd(42)} ERROR ${r.error}`);
  else console.log(`  ${r.label.padEnd(42)} ${kb(r.raw).padStart(8)} ${kb(r.gzip).padStart(10)}`);
}
console.log(`  ${"the shipped chunk, for comparison".padEnd(42)} ${kb(shippedRaw).padStart(8)} ${kb(shippedGz).padStart(10)}`);
console.log(
  `\n  three specifiers the scene imports (${threeNamed.size}): ${[...threeNamed].sort().join(", ")}`,
);
console.log(`  three addons the scene imports (${threeAddons.size}): ${[...threeAddons].sort().join(", ")}`);
console.log(
  `\n  These rows are upper bounds per dependency, not a partition of the chunk: the scene imports part of\n` +
    `  three and tree-shaking drops the rest, so they do not add up to the shipped figure and must not be\n` +
    `  presented as if they did.`,
);

mkdirSync(join(ROOT, "design/dossier/build/perf"), { recursive: true });
writeFileSync(
  join(ROOT, "design/dossier/build/perf/bundle-attribution.json"),
  JSON.stringify(
    {
      _method:
        "Each dependency is bundled alone with the same Vite and esbuild the site build uses, at the same target, with react external where the site keeps it in its own chunk. Sizes are the emitted bundle, raw and gzipped. The scene's three imports are read out of src/components/scene/**.ts(x) rather than guessed.",
      _notAPartition:
        "These are per-dependency upper bounds. The scene imports a subset of three and tree-shaking removes the rest, so the rows do not sum to the shipped chunk.",
      rows,
      shipped: { file: shipped ? shipped.replace(ROOT + "/", "") : null, raw: shippedRaw, gzip: shippedGz },
      threeSpecifiers: [...threeNamed].sort(),
      threeAddons: [...threeAddons].sort(),
    },
    null,
    2,
  ) + "\n",
);
rmSync(WORK, { recursive: true, force: true });
console.log(`\nwritten: design/dossier/build/perf/bundle-attribution.json`);
