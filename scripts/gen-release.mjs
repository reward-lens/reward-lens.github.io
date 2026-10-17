#!/usr/bin/env node
/** Finalize the site's release row only after public 3.1.0 artifacts exist. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bindInstallDownloads, CHECKSUMS, expectedChecksums, FILES, REPOSITORY, VERSION,
  validateManifest, verifyGithub, verifyGithubRelease, verifyPypi } from "./release-binding.mjs";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(SITE, "src/data/release.json");
const INSTALL_DOC = join(SITE, "src/content/docs/getting-started/install.mdx");
const DEFAULT_MANIFEST = join(SITE, "release/RELEASE_ARTIFACTS.json");
const CANONICAL = { repo: `https://github.com/${REPOSITORY}`, docs: "https://reward-lens.github.io" };
const INDEX = "https://pypi.org/pypi/reward-lens/json";
const VERSION_INDEX = `https://pypi.org/pypi/reward-lens/${VERSION}/json`;
const argv = process.argv.slice(2);
const manifestFlag = argv.indexOf("--manifest");
if (manifestFlag >= 0 && (!argv[manifestFlag + 1] || argv[manifestFlag + 1].startsWith("--"))) {
  throw new Error("--manifest requires a path");
}
const manifestPath = manifestFlag < 0 ? DEFAULT_MANIFEST : resolve(argv[manifestFlag + 1]);
const check = argv.includes("--check");
if (argv.some((arg, i) => arg.startsWith("--") && arg !== "--check" && arg !== "--manifest") ||
    (manifestFlag >= 0 && argv.length !== (check ? 3 : 2)) ||
    (manifestFlag < 0 && argv.length !== (check ? 1 : 0))) {
  throw new Error("usage: node scripts/gen-release.mjs [--check] [--manifest PATH]");
}

async function fetchResponse(url) {
  const headers = { accept: "application/json" };
  if (new URL(url).hostname === "api.github.com" && process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response;
}
async function fetchJson(url) { return (await fetchResponse(url)).json(); }
function stable(value) {
  const { fetchedAt, ...rest } = value;
  return JSON.stringify(rest);
}
function compare(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

async function main() {
  if (!existsSync(manifestPath)) throw new Error(`missing CI release artifact manifest: ${manifestPath}`);
  const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  const [index, published] = await Promise.all([fetchJson(INDEX), fetchJson(VERSION_INDEX)]);
  const files = verifyPypi(index, published, manifest);
  const [run, commit, githubRelease] = await Promise.all([
    fetchJson(`https://api.github.com/repos/${REPOSITORY}/actions/runs/${manifest.ci_run_id}`),
    fetchJson(`https://api.github.com/repos/${REPOSITORY}/git/commits/${manifest.source_sha}`),
    fetchJson(`https://api.github.com/repos/${REPOSITORY}/releases/tags/v${VERSION}`),
  ]);
  verifyGithub(run, commit, manifest);
  const githubAssets = verifyGithubRelease(githubRelease);
  for (const file of files) {
    if (new URL(file.url).origin !== "https://files.pythonhosted.org") {
      throw new Error(`unexpected PyPI file host for ${file.filename}`);
    }
    const bytes = new Uint8Array(await (await fetchResponse(file.url)).arrayBuffer());
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== manifest.sha256[file.filename]) throw new Error(`downloaded file hash mismatch for ${file.filename}`);
  }
  for (const name of [...FILES, CHECKSUMS]) {
    const bytes = new Uint8Array(await (await fetchResponse(githubAssets[name])).arrayBuffer());
    const matchingAsset = githubRelease.assets.find((asset) => asset.name === name);
    if (bytes.length !== matchingAsset.size) throw new Error(`GitHub Release asset size mismatch for ${name}`);
    if (name === CHECKSUMS) {
      if (Buffer.from(bytes).toString("utf8") !== expectedChecksums(manifest)) {
        throw new Error("GitHub Release SHA256SUMS does not match the qualified artifact manifest");
      }
    } else if (createHash("sha256").update(bytes).digest("hex") !== manifest.sha256[name]) {
      throw new Error(`GitHub Release asset hash mismatch for ${name}`);
    }
  }
  const releases = Object.entries(index.releases ?? {})
    .filter(([version, versionFiles]) => /^\d+\.\d+\.\d+$/.test(version) && versionFiles.length > 0)
    .map(([version, versionFiles]) => ({
      version,
      uploadedAt: versionFiles.map((file) => file.upload_time_iso_8601).sort()[0]
        .replace(/(\.\d{3})\d*Z$/, "$1Z"),
    }))
    .sort((a, b) => compare(a.version, b.version));
  const release = {
    latest: VERSION,
    unpublished: null,
    unpublishedIsAhead: false,
    requiresPython: published.info.requires_python ?? "",
    releases,
    urls: {
      publishedHomepage: CANONICAL.repo,
      publishedDocumentation: CANONICAL.docs,
      canonicalRepo: CANONICAL.repo,
      canonicalDocs: CANONICAL.docs,
      publishedUrlsAreStale: false,
    },
    changelogUrl: `${CANONICAL.repo}/blob/main/CHANGELOG.md`,
    artifactBinding: {
      repository: REPOSITORY,
      sourceSha: manifest.source_sha,
      sourceTree: manifest.source_tree,
      ciRunId: manifest.ci_run_id,
      sha256: Object.fromEntries(FILES.map((filename) => [filename, manifest.sha256[filename]])),
    },
    fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z"),
  };
  const install = readFileSync(INSTALL_DOC, "utf8");
  if (!/^libraryVersion: (3\.0\.0|3\.1\.0)$/m.test(install)) {
    throw new Error("installation documentation has an unexpected libraryVersion");
  }
  const expectedInstall = bindInstallDownloads(
    install.replace(/^libraryVersion: (3\.0\.0|3\.1\.0)$/m, "libraryVersion: 3.1.0"),
    manifest, githubRelease,
  );
  if (check) {
    if (!existsSync(OUT) || stable(JSON.parse(readFileSync(OUT, "utf8"))) !== stable(release)) {
      throw new Error("src/data/release.json is not bound to the current public 3.1.0 release");
    }
    if (install !== expectedInstall) {
      throw new Error("installation documentation downloads, hashes, or version are not bound to 3.1.0");
    }
    console.log(`release binding verified: ${VERSION} at ${manifest.source_sha}, CI ${manifest.ci_run_id}`);
    return;
  }
  const temporary = `${OUT}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify(release, null, 1) + "\n");
  renameSync(temporary, OUT);
  writeFileSync(INSTALL_DOC, expectedInstall);
  console.log(`finalized ${OUT}: ${VERSION} at ${manifest.source_sha}, CI ${manifest.ci_run_id}`);
}
main().catch((error) => { console.error(`gen-release: ${error.message}`); process.exitCode = 1; });
