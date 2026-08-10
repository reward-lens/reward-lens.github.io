// Gate 5 · Provenance sweep
//
// D-20 and the site's one rule that is not decorative: every number rendered
// anywhere resolves to an evidence record. This walks the RENDERED HTML in
// dist/, not the source, and tokenises every text node for numerics. Every
// match must be inside a provenance chip or in the allow-list with a stated
// reason.
//
// The previous site's gate covered 25 curated claims while the site rendered
// 161 pages. A curated list of claims is a list of the claims somebody
// remembered. This covers everything rendered.
//
// Four exemptions are STRUCTURAL rather than allow-listed, because they are not
// claims at all:
//
//   - text inside [data-provenance] and its panel: that is the pass condition
//   - <code>, <pre>, <kbd>, <samp>: source code and command output, quoted
//   - /docs/api/**: the library's own docstrings, rendered verbatim by
//     scripts/build_api_ref.py running griffe over the package. Same exemption
//     gate 9 carries, same reason: those numbers are the library's, and the
//     site does not silently edit a page it ports (C-10).
//
//     THIS WAS WRITTEN AS /docs/reference/** AND MATCHED NOTHING. P5 moved the
//     reference to /docs/api/ and gate 9 moved with it (copy_grep.mjs:37);
//     this gate did not, so its one structural exemption had been dead code
//     since the rename. Found by the docs-vocabulary packet.
//
//     It is also no longer a `continue` over the whole page. Skipping the page
//     took its numerals out of the TOTAL as well as out of the failures, so the
//     denominator on /evidence/ silently shrank by every number on an exempt
//     route. They are counted and reported as their own class now, because an
//     exemption a reader cannot see the size of is indistinguishable from a
//     number nobody looked at.
//   - the built 404 page's search UI, which renders no claims
//
// Everything else needs an entry in scripts/checks/number-allowlist.json with a
// reason. The `routes` section of that file is a ratchet, not a permanent
// exemption: each entry carries the packet that will bind its numbers and the
// date it was recorded, and it may shrink and must not grow.
//
// Usage:  node scripts/checks/provenance.mjs [dist] [--verbose]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DIST, ROOT, distPages, routeOf, textNodes, readJson, recordVacuity } from "./_lib.mjs";

const dist = process.argv[2]?.startsWith("--") ? DIST : (process.argv[2] ?? DIST);
const VERBOSE = process.argv.includes("--verbose");
const allow = readJson(join(ROOT, "scripts", "checks", "number-allowlist.json"), {
  patterns: [],
  exact: [],
  routes: [],
});

const CODEISH = new Set(["code", "pre", "kbd", "samp", "script", "style"]);
const BOUND_ATTR = /\bdata-provenance\b/;

// A numeric token: a run of digits, optionally with separators, decimals, a
// sign, a percent or a unit suffix. Deliberately greedy about what counts as a
// number, because the failure mode this gate exists to prevent is a number
// nobody noticed was typed in.
const NUMERIC = /(?<![\w.-])[+-]?\d[\d,]*(?:\.\d+)?(?:\s?%|×|x)?(?![\w-])/g;

const patterns = allow.patterns.map((p) => ({ ...p, re: new RegExp(p.pattern) }));
const exact = new Set(allow.exact.map((e) => e.value));
const routeAllow = new Map(allow.routes.map((r) => [r.route, r]));

// ---------------------------------------------------------------------------
// Context allowances: numerals whose exemption is a fact about their
// SURROUNDINGS, which a permanent pattern cannot see
// ---------------------------------------------------------------------------
//
// `patterns` above match the token and nothing else. That is the right shape
// for a four-digit year and the wrong shape for everything below, because
// `^3\.0$` would exempt a measured 3.0 anywhere on the site forever, and the
// thing that makes `3.0.0` not a measurement is the release beside it rather
// than the digits.
//
// So these carry a `permits({ text, index, token, ancestors, route })`
// predicate, the same shape gate 7 uses (banned.mjs CONTEXT_ALLOWANCES), each
// counts the hits it covered and the routes they were on, and each says so
// loudly when that count is zero. An allowance nobody can see the size of is
// the same problem as a number nobody looked at.
//
// Two of them do not trust the page at all: they verify the value against
// GENERATED data, so the allowance's authority is a file the build wrote and
// not a shape someone typed. That is deliberate, and it is what stops the
// version allowance from becoming "any decimal near the word release".
//
// WHERE THEY SIT IN THE ORDER: with `patterns`, before the route ratchet. Both
// answer "this is not a claim about the world", and both are permanent. The
// ratchet answers something entirely different — "nobody has bound this yet" —
// and a numeral that is not a claim was never the ratchet's to defer.
const release = readJson(join(ROOT, "src", "data", "release.json"), {});
const quantities = readJson(join(ROOT, "src", "data", "quantities.json"), { quantities: [] });
const catalogue = readJson(join(ROOT, "src", "data", "catalogue.json"), { instruments: [] });

/** Every version string gen-release.mjs says was actually published. */
const RELEASES = new Set(
  [release.latest, ...(release.releases ?? []).map((r) => r.version)].filter(Boolean),
);
/** ">=3.10" -> "3.10". The floor the package metadata declares, not a typed number. */
const PYTHON_MIN = (release.requiresPython ?? "").match(/(\d+\.\d+)/)?.[1] ?? null;

/**
 * The registry prose corpus: the library's own definitions, interpretations and
 * instrument headlines, as scripts/build_catalogue.py emitted them from
 * reward-lens/spec/QUANTITIES.json and the shipped source.
 */
const REGISTRY = (() => {
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const out = [];
  for (const q of quantities.quantities ?? []) {
    for (const k of ["definition", "interpretation"]) if (q[k]) out.push(norm(q[k]));
  }
  for (const i of catalogue.instruments ?? []) {
    for (const k of ["headline", "definition", "interpretation"]) if (i[k]) out.push(norm(i[k]));
  }
  return out;
})();

/** The whole dotted-numeric run the token sits inside: "0" of "3.0.0" -> "3.0.0". */
const dottedRun = (text, index) => {
  let s = index;
  while (s > 0 && /[\d.]/.test(text[s - 1])) s -= 1;
  let e = index;
  while (e < text.length && /[\d.]/.test(text[e])) e += 1;
  return text.slice(s, e).replace(/^\.+|\.+$/g, "");
};
const before = (text, index, n) => text.slice(Math.max(0, index - n), index);

const CONTEXT_ALLOWANCES = [
  {
    // "Describes library 3.0.0, the current release." A version is an address
    // for a copy of the software, not a measurement of anything, and it has no
    // uncertainty to report. Narrow twice over: the numeral must be part of a
    // THREE-component dotted run, which no measurement on this site is written
    // as, and that run must be a version release.json says was published. A
    // typed "3.0" fails, because its run is "3.0" and no release is named that.
    name: "a published release version, verified against src/data/release.json",
    permits: ({ text, index }) => RELEASES.has(dottedRun(text, index)),
  },
  {
    // "Python 3.10 or newer." The interpreter floor, which is a compatibility
    // statement about the package and not a reading. Value verified against
    // release.json's requiresPython AND the word Python required immediately
    // before it, because "3.10" on its own is a perfectly plausible ratio and
    // this allowance must not cover one.
    name: "the minimum Python version, named by the word Python",
    permits: ({ text, index }) =>
      PYTHON_MIN !== null &&
      dottedRun(text, index) === PYTHON_MIN &&
      /\bPython\s*$/i.test(before(text, index, 12)),
  },
  {
    // "Fig. 3.2 ·", "section 3.0.1 names it". An ordinal that labels a figure
    // or a section of a document. It counts things in a document's structure,
    // so it resolves by looking at the document rather than at the world, and
    // the label word has to be immediately before the numeral.
    name: "a figure or section label, which is an ordinal and not a reading",
    permits: ({ text, index }) => /(?:\bfig\.|\bfigure|\bsections?|§)\s*$/i.test(before(text, index, 12)),
  },
  {
    // "https://arxiv.org/abs/2604.26130". An address. The digits are a
    // preprint's identifier and the yyMM.nnnnn shape is arXiv's, not a
    // quantity's, and the URL it belongs to has to be right there.
    name: "an arXiv identifier inside a link to arxiv.org",
    permits: ({ text, index }) =>
      /arxiv\.org\/abs\/$/i.test(before(text, index, 24)) &&
      /^\d{4}\.\d{4,5}$/.test(dottedRun(text, index)),
  },
  {
    // The `chance` row of a data table. data-table.astro marks it
    // `dt__tr--reference` and its own comment says "a baseline, not a result";
    // /see/reward-model/ says the same at the point it declares the constant:
    // "Chance is a definitional constant, not a measurement". 0.5 is what
    // chance IS on that scale, so there is no record it could resolve to.
    // Structural: it reads the row's class, not the number.
    name: "a definitional baseline in a data table's reference row",
    permits: ({ ancestors }) => ancestors.some((a) => /\bdt__tr--reference\b/.test(a.attrs)),
  },
  {
    // /collaborate/ renders the library's quantity registry: `definition` and
    // `interpretation` off src/data/quantities.json and instrument headlines
    // off src/data/catalogue.json, both generated by build_catalogue.py from
    // the library's spec. collaborate.astro will not edit a sentence of it and
    // says why ("a page that quietly rewrites a definition is worse than one
    // that shows less of it"), so these numbers cannot be bound without
    // rewriting the library's prose. C-10, the same rule and the same reason
    // the gate already carries for /docs/api/.
    //
    // NOT a route exemption. The rendered text node must actually occur in the
    // generated registry, so the authority is the generator's output: a
    // sentence typed into this page fails even on this route.
    name: "prose ported verbatim from the library's quantity registry, on /collaborate/",
    permits: ({ text, route }) => {
      if (route !== "/collaborate/") return false;
      const t = text.replace(/\s+/g, " ").trim();
      return t.length > 0 && REGISTRY.some((r) => r.includes(t));
    },
  },
];

// Each allowance's authority is a generated file. Without one it permits
// nothing, which is the safe direction, but it must not do that quietly: a
// generator that stopped writing release.json would otherwise read as a pile of
// new unbound numerals with no hint of the cause. Same property gate 7 states
// for its family map.
if (RELEASES.size === 0) {
  console.error(
    `NOTE provenance: src/data/release.json names no published version, so the release-version ` +
      `allowance is inert on this run. That file is its only authority.`,
  );
}
if (REGISTRY.length === 0) {
  console.error(
    `NOTE provenance: src/data/quantities.json and src/data/catalogue.json carry no registry ` +
      `prose, so the ported-registry allowance is inert on this run and every numeral in a ` +
      `/collaborate/ definition is held to the gate.`,
  );
}

const routeAllowed = (route) => {
  for (const [prefix, entry] of routeAllow) {
    if (prefix.endsWith("**") ? route.startsWith(prefix.slice(0, -2)) : route === prefix) {
      return entry;
    }
  }
  return null;
};

const pages = distPages(dist);
if (pages.length === 0) {
  console.error(`FAIL provenance: no built pages under ${dist}. Run npm run build first.`);
  process.exit(1);
}

let unbound = 0;
let bound = 0;
let allowed = 0;
// Counted apart from `allowed` on purpose. A numeral matched by a permanent
// pattern is a numeral that is not a claim. A numeral absorbed by a route entry
// is an unbound number on a page nobody has rebuilt yet, and reporting the two
// as one figure is how a gate reads as passing when it is deferring.
let ratcheted = 0;
let portedCount = 0;
let allowedByContext = 0;
const byRoute = new Map();
const usedRoutes = new Set();
const usedPatterns = new Set();
// Per allowance, not summed: an allowance that has stopped matching is
// invisible inside a total, which is how a gate keeps a dead exemption.
const contextHits = new Map(CONTEXT_ALLOWANCES.map((a) => [a.name, { hits: 0, routes: new Set() }]));

for (const file of pages) {
  const route = routeOf(file, dist);
  /* Ported: the library's own reference. Counted as its own class rather than
     skipped, so it stays in the denominator. See the header. */
  const ported = route.startsWith("/docs/api/");

  const html = readFileSync(file, "utf-8");
  const routeEntry = routeAllowed(route);

  for (const node of textNodes(html)) {
    if (node.ancestors.some((a) => CODEISH.has(a.tag))) continue;
    const inChip = node.ancestors.some((a) => BOUND_ATTR.test(a.attrs));

    for (const m of node.text.matchAll(NUMERIC)) {
      const raw = m[0];
      const token = raw.trim();
      // Where the digits start, past any sign, so a context allowance reading
      // backwards from the numeral sees "Python " and not "Python -".
      const at = m.index + (/^[+-]/.test(raw) ? 1 : 0);
      if (inChip) {
        bound += 1;
        continue;
      }
      if (ported) {
        portedCount += 1;
        continue;
      }
      if (exact.has(token)) {
        allowed += 1;
        continue;
      }
      const pat = patterns.find((p) => p.re.test(token));
      if (pat) {
        allowed += 1;
        usedPatterns.add(pat.pattern);
        continue;
      }
      const ctx = CONTEXT_ALLOWANCES.find((a) =>
        a.permits({ text: node.text, index: at, token, ancestors: node.ancestors, route }),
      );
      if (ctx) {
        const seen = contextHits.get(ctx.name);
        seen.hits += 1;
        seen.routes.add(route);
        allowedByContext += 1;
        continue;
      }
      if (routeEntry) {
        ratcheted += 1;
        usedRoutes.add(routeEntry.route);
        continue;
      }
      unbound += 1;
      if (!byRoute.has(route)) byRoute.set(route, []);
      if (byRoute.get(route).length < 6) {
        byRoute.get(route).push(`${token}   in "${node.text.trim().slice(0, 90)}"`);
      }
    }
  }
}

for (const [route, hits] of [...byRoute].sort()) {
  console.error(`FAIL ${route}: ${hits.length}+ unbound numeric(s)`);
  for (const h of hits) console.error(`    ${h}`);
}

const staleRoutes = allow.routes.filter((r) => !usedRoutes.has(r.route));
if (staleRoutes.length) {
  console.log(
    `\n${staleRoutes.length} allow-list route entr${staleRoutes.length === 1 ? "y is" : "ies are"} no longer needed and can be deleted:`,
  );
  for (const r of staleRoutes) console.log(`  ${r.route}   (recorded for ${r.packet})`);
}
if (VERBOSE) {
  const stalePatterns = patterns.filter((p) => !usedPatterns.has(p.pattern));
  for (const p of stalePatterns) console.log(`  unused pattern: ${p.pattern}`);
}

// An allowance that covers nothing is an allowance nobody has shown to work.
// It does not fail the build, because a site could legitimately stop rendering
// the thing it was written for, but it is stated, so a rename or a generator
// change cannot quietly retire one and leave its numerals to some other class.
for (const [name, { hits }] of contextHits) {
  if (hits === 0) {
    console.error(
      `NOTE provenance: the context allowance "${name}" covered 0 numerals on this run. ` +
        `Either the collision it was written for is gone, or it stopped matching.`,
    );
  }
}

if (ratcheted > 0) {
  recordVacuity(
    5,
    `${ratcheted} unbound numeral(s) across ${allow.routes.length} route(s) were absorbed by the ratchet and not checked: ${allow.routes.map((r) => `${r.route} (${r.packet})`).join(", ")}`,
  );
}

console.log(
  `\nprovenance: ${pages.length} pages. ${bound} numeric(s) bound to a provenance chip, ` +
    `${allowed} matched a permanent pattern, ${allowedByContext} matched a context allowance, ` +
    `${portedCount} ported from the library's own reference, ` +
    `${ratcheted} absorbed by the route ratchet, ${unbound} unbound and failing.`,
);
for (const [name, { hits, routes }] of contextHits) {
  console.log(
    `provenance: context allowance "${name}" covered ${hits} numeral(s) on ${routes.size} route(s)` +
      (routes.size ? `: ${[...routes].slice(0, 5).join(", ")}${routes.size > 5 ? " ..." : ""}` : ""),
  );
}
if (ratcheted > 0) {
  console.log(
    `provenance: ${ratcheted} of ${bound + allowed + allowedByContext + portedCount + ratcheted + unbound} numerals on this site are still unbound and deferred, not checked. ` +
      `${allow.routes.length} route(s) on the ratchet: ${allow.routes.map((r) => `${r.route} (${r.packet})`).join(", ")}.`,
  );
  console.log(
    `provenance: this gate is largely DEFERRED today, not passing. Q1 cannot sign off while the ratchet is non-empty.`,
  );
}
process.exit(unbound > 0 ? 1 : 0);
