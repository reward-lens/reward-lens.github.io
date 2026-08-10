#!/usr/bin/env node
/**
 * Emit src/data/release.json: what `pip install reward-lens` actually gets
 * today, and what exists in this tree that a user cannot get yet.
 *
 *   node scripts/gen-release.mjs
 *   node scripts/gen-release.mjs --check      # fail if the committed file is stale
 *
 * TWO SOURCES, AND NEITHER OF THEM IS A TAG.
 *
 *   latest        the package index, and nothing else. Only the index says
 *                 what a user gets. Never pyproject.toml, never __version__.
 *                 DECISIONS.md D-01.
 *   unpublished   the working tree's own version, from the library's
 *                 pyproject.toml, when it differs from `latest`. This is the
 *                 question "what does this tree claim to be", which is exactly
 *                 what the version row's second clause means.
 *
 * The build brief says to query "the package index and the repository tags".
 * That is wrong in both directions and it is the single most likely source of
 * a silently wrong version row (GROUND-TRUTH.md C-17). While 3.0.0 was still
 * held back, the two kinds of tag failed in opposite directions:
 *
 *   remote tags   newest was v2.0.1. A generator reading them concludes there
 *                 is nothing unpublished, sets `unpublished` to null, and the
 *                 version row quietly loses its second clause while the site
 *                 describes 3.0.0 throughout.
 *   local tags    v3.0.0 existed on one machine. CI would then disagree with a
 *                 laptop about what the site says.
 *
 * So this file consults no tags at all, local or remote. The rule outlived the
 * situation that motivated it, and deliberately: 3.0.0 went to the index on
 * 2026-08-07, `unpublished` is null again because the tree and the index agree,
 * and that null is now DERIVED rather than a tag's accident. The next version
 * to be worked on before it ships puts this back in the state above, so nothing
 * here is provisional.
 *
 * IF THE FETCH FAILS, THE BUILD FAILS. There is no cached fallback and no
 * committed default. A stale version on the install strip is exactly the
 * dishonesty this component exists to prevent, and it would be invisible: the
 * page still renders, with a number that was true last month.
 *
 * The field is `unpublished`. Not `rc`, not `preRelease`: 3.0.0 stopped being
 * a release candidate at commit 2e75a0d and calling it one would be the site
 * asserting something the repository stopped saying. DECISIONS.md D-25.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, "..");
const OUT = join(SITE, "src/data/release.json");

const INDEX_URL = "https://pypi.org/pypi/reward-lens/json";
const TIMEOUT_MS = 20_000;

/**
 * The library working tree. `unpublished` is its version, so this is the
 * one place a version may be read from pyproject.toml. The assay branch is
 * the live one; `main` is behind (HANDOFF.md §3).
 */
const LIBRARY_PYPROJECT =
  process.env.REWARD_LENS_PYPROJECT ??
  "/home/suhail-nadaf/final-reward/reward-lens--github/reward-lens-assay/pyproject.toml";

/** copy.yaml:urls. The site's own canonical set, for the staleness comparison. */
const CANONICAL = {
  repo: "https://github.com/reward-lens/reward-lens",
  docs: "https://reward-lens.github.io",
};

const die = (message) => {
  console.error(`gen-release: ${message}`);
  process.exit(1);
};

/** The three dotted integers the release schema defines a version as. */
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+([a-z]+[0-9]+)?$/;

const compare = (a, b) => {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
};

async function fetchIndex() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(INDEX_URL, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
  } catch (error) {
    die(
      `could not reach ${INDEX_URL} (${error.message}). The build fails here on ` +
        `purpose. src/data/release.json has no cached fallback, because a version ` +
        `number on the install strip that was true last month is precisely the ` +
        `dishonesty the install strip exists to prevent.`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    die(`${INDEX_URL} returned ${response.status} ${response.statusText}.`);
  }
  return response.json();
}

/** The library working tree's own version. Never the source of `latest`. */
function workingTreeVersion() {
  if (!existsSync(LIBRARY_PYPROJECT)) {
    die(
      `${LIBRARY_PYPROJECT} does not exist, so this build cannot say what the ` +
        `working tree claims to be. Set REWARD_LENS_PYPROJECT, or point it at the ` +
        `library checkout. Not derivable from a tag: GROUND-TRUTH.md C-17.`,
    );
  }
  const text = readFileSync(LIBRARY_PYPROJECT, "utf-8");
  const match = text.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
  if (!match) die(`no version found in ${LIBRARY_PYPROJECT}`);
  if (!VERSION_RE.test(match[1])) {
    die(`${LIBRARY_PYPROJECT} declares version "${match[1]}", which the release schema rejects`);
  }
  return match[1];
}

async function build() {
  const index = await fetchIndex();
  const info = index.info ?? {};
  const latest = info.version;
  if (!latest || !VERSION_RE.test(latest)) {
    die(`the package index reports version "${latest}", which is not a version`);
  }

  const tree = workingTreeVersion();
  const unpublished = tree === latest ? null : tree;

  const published = info.project_urls ?? {};
  const publishedHomepage = published.Homepage ?? info.home_page ?? "";
  const publishedDocumentation = published.Documentation ?? info.docs_url ?? "";

  const releases = Object.entries(index.releases ?? {})
    .filter(([version, files]) => VERSION_RE.test(version) && files.length > 0)
    .map(([version, files]) => ({
      version,
      uploadedAt: files
        .map((f) => f.upload_time_iso_8601)
        .sort()[0]
        .replace(/(\.\d{3})\d*Z$/, "$1Z"),
    }))
    .sort((a, b) => compare(a.version, b.version));

  return {
    latest,
    unpublished,
    // Derived by comparing the two versions, never asserted. False when the
    // index has caught up, which is also when `unpublished` is null.
    unpublishedIsAhead: unpublished !== null && compare(unpublished, latest) > 0,
    requiresPython: info.requires_python ?? "",
    releases,
    urls: {
      publishedHomepage,
      publishedDocumentation,
      canonicalRepo: CANONICAL.repo,
      canonicalDocs: CANONICAL.docs,
      // Recorded, not fixed. The wrong metadata was on the published 2.0.1
      // artifact; assay/pyproject.toml already carried the canonical set, so
      // publishing 3.0.0 corrected it without the site acting, and this now
      // reads false. GROUND-TRUTH.md C-9. Kept because it is a derived
      // comparison, not an assertion: when it is true the site does not link
      // the index page as documentation.
      publishedUrlsAreStale:
        publishedHomepage !== CANONICAL.repo || publishedDocumentation !== CANONICAL.docs,
    },
    changelogUrl: `${CANONICAL.repo}/blob/main/CHANGELOG.md`,
    fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z"),
  };
}

const serialize = (value) => JSON.stringify(value, null, 1) + "\n";

/** Everything but `fetchedAt`, which moves on every run by design. */
const withoutTimestamp = (value) => {
  const { fetchedAt, ...rest } = value;
  return JSON.stringify(rest);
};

const release = await build();

if (process.argv.includes("--check")) {
  if (!existsSync(OUT)) die(`${OUT} does not exist. Run node scripts/gen-release.mjs.`);
  const committed = JSON.parse(readFileSync(OUT, "utf-8"));
  if (withoutTimestamp(committed) !== withoutTimestamp(release)) {
    die(
      `src/data/release.json disagrees with the package index.\n` +
        `  committed: latest ${committed.latest}, unpublished ${committed.unpublished}\n` +
        `  index now: latest ${release.latest}, unpublished ${release.unpublished}\n` +
        `Regenerate it: node scripts/gen-release.mjs`,
    );
  }
  console.log(
    `gen-release --check: release.json matches the index ` +
      `(installs ${release.latest}${release.unpublished ? `, ${release.unpublished} not published` : ""})`,
  );
  process.exit(0);
}

writeFileSync(OUT, serialize(release), "utf-8");
console.log(
  `gen-release: wrote ${OUT}\n` +
    `  latest        ${release.latest}   (package index)\n` +
    `  unpublished   ${release.unpublished ?? "null"}   (${LIBRARY_PYPROJECT.split("/").slice(-2).join("/")})\n` +
    `  ahead         ${release.unpublishedIsAhead}\n` +
    `  index URLs stale: ${release.urls.publishedUrlsAreStale}` +
    (release.urls.publishedUrlsAreStale
      ? `\n    Homepage      ${release.urls.publishedHomepage}\n` +
        `    Documentation ${release.urls.publishedDocumentation}\n` +
        `    Reported, not fixed. Publishing 3.0.0 corrects both (GROUND-TRUTH.md C-9).`
      : ""),
);
