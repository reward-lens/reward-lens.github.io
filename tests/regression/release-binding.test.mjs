import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "@mdx-js/mdx";
import { bindInstallDownloads, CHECKSUMS, expectedChecksums, FILES, RELEASE_URL,
  validateManifest, verifyGithub, verifyGithubRelease, verifyPypi } from "../../scripts/release-binding.mjs";
import { assertReleaseCopy } from "../../scripts/checks/release-copy.mjs";

const manifest = {
  schema: "reward-lens.release-artifacts/1", version: "3.1.0",
  repository: "reward-lens/reward-lens", workflow: ".github/workflows/ci.yml",
  event: "push", source_sha: "a".repeat(40), source_tree: "b".repeat(40),
  ci_run_id: 42, sha256: Object.fromEntries(FILES.map((name, i) => [name, String(i + 1).repeat(64)])),
};
const files = FILES.map((filename) => ({ filename, digests: { sha256: manifest.sha256[filename] }, yanked: false }));
const info = { version: "3.1.0", project_urls: {
  Homepage: "https://github.com/reward-lens/reward-lens",
  Documentation: "https://reward-lens.github.io",
} };

test("the qualified source, tree, run and both distribution hashes bind", () => {
  assert.equal(validateManifest(manifest), manifest);
  assert.equal(verifyPypi({ info, releases: { "3.1.0": files } }, { info, urls: files }, manifest).length, 2);
  assert.doesNotThrow(() => verifyGithub({ id: 42, conclusion: "success", event: "push",
    head_branch: "main", head_sha: manifest.source_sha,
    repository: { full_name: manifest.repository }, path: manifest.workflow },
  { sha: manifest.source_sha, tree: { sha: manifest.source_tree } }, manifest));
});
test("manifest identity and hashes reject drift", () => {
  for (const changed of [
    { version: "3.0.0" }, { event: "workflow_dispatch" }, { source_sha: "short" },
    { ci_run_id: 0 }, { sha256: { [FILES[0]]: "f".repeat(64) } },
  ]) assert.throws(() => validateManifest({ ...manifest, ...changed }));
});
test("public metadata, digest, run and tree reject drift", () => {
  assert.throws(() => verifyPypi({ info: { version: "3.0.0" } }, { info, urls: files }, manifest));
  assert.throws(() => verifyPypi({ info, releases: { "3.1.0": files } },
    { info, urls: [{ ...files[0], digests: { sha256: "f".repeat(64) } }, files[1]] }, manifest));
  const run = { id: 42, conclusion: "success", event: "push", head_branch: "main", head_sha: manifest.source_sha,
    repository: { full_name: manifest.repository }, path: manifest.workflow };
  const commit = { sha: manifest.source_sha, tree: { sha: manifest.source_tree } };
  assert.doesNotThrow(() => verifyGithub({ ...run, path: `${manifest.workflow}@main` }, commit, manifest));
  for (const changed of [
    { path: ".github/workflows/other.yml" },
    { path: `${manifest.workflow}@release` },
    { head_branch: "release" },
  ]) assert.throws(() => verifyGithub({ ...run, ...changed }, commit, manifest));
  assert.throws(() => verifyGithub({ ...run, conclusion: "failure" },
    commit, manifest));
  assert.throws(() => verifyGithub(run,
    { sha: manifest.source_sha, tree: { sha: "c".repeat(40) } }, manifest));
});

const officialAsset = (name) => ({ name, state: "uploaded", size: 1,
  browser_download_url: `https://github.com/reward-lens/reward-lens/releases/download/v3.1.0/${name}` });
const githubRelease = { tag_name: "v3.1.0", html_url: RELEASE_URL, draft: false, prerelease: false,
  assets: [...FILES, CHECKSUMS].map(officialAsset) };
const installDoc = "libraryVersion: 3.0.0\n{/* reward-lens-release-downloads:start */}\nPending\n{/* reward-lens-release-downloads:end */}\n";

test("official download links and checksum lines derive only from qualified hashes", () => {
  assert.equal(Object.keys(verifyGithubRelease(githubRelease)).length, 3);
  assert.equal(expectedChecksums(manifest), [...FILES].sort().map((name) =>
    `${manifest.sha256[name]}  ${name}\n`).join(""));
  const generated = bindInstallDownloads(installDoc, manifest, githubRelease);
  for (const name of FILES) {
    assert.ok(generated.includes(officialAsset(name).browser_download_url));
    assert.ok(generated.includes(manifest.sha256[name]));
  }
  assert.ok(generated.includes(officialAsset(CHECKSUMS).browser_download_url));
  assert.equal(bindInstallDownloads(generated, manifest, githubRelease), generated);
});

test("generated release-download MDX compiles", async () => {
  await assert.doesNotReject(() => compile(bindInstallDownloads(installDoc, manifest, githubRelease)));
});

test("release asset identity and malformed download sections refuse generation", () => {
  for (const changed of [
    { draft: true }, { prerelease: true }, { tag_name: "v3.0.0" },
    { assets: githubRelease.assets.filter((asset) => asset.name !== CHECKSUMS) },
    { assets: [...githubRelease.assets, officialAsset(CHECKSUMS)] },
    { assets: githubRelease.assets.map((asset) => asset.name === FILES[0] ?
      { ...asset, browser_download_url: "https://example.invalid/wheel" } : asset) },
  ]) assert.throws(() => verifyGithubRelease({ ...githubRelease, ...changed }));
  assert.throws(() => bindInstallDownloads("no markers", manifest, githubRelease));
  assert.throws(() => bindInstallDownloads(installDoc + installDoc, manifest, githubRelease));
});

const strip = 'pip install reward-lens <span class="install-strip__number">3.1.0</span>';
const productGuide = "https://github.com/reward-lens/reward-lens/blob/v3.1.0/README.md";
const downloadLinks = [...FILES, CHECKSUMS].map((name) => officialAsset(name).browser_download_url).join(" ");
const downloadHashes = FILES.map((name) => manifest.sha256[name]).join(" ");
const releaseCopy = {
  release: { latest: "3.1.0", unpublished: null,
    artifactBinding: { sourceSha: "a".repeat(40), sha256: manifest.sha256 } },
  home: strip,
  start: `${strip}<section data-release-start>Python 3.11 or newer reward-lens init --example code-reward ./demo reward-lens audit ./demo --offline <a href="${productGuide}">3.1.0 product guide</a></section><section data-historical-example>Captured 3.0.0 library example</section>`,
  install: `Describes library 3.1.0, the current release. Python 3.11 or newer python -m pip install reward-lens==3.1.0 reward-lens init --example code-reward ./demo reward-lens audit ./demo --offline https://pypi.org/project/reward-lens/3.1.0/ ${RELEASE_URL} ${downloadLinks} ${downloadHashes} <a href="${productGuide}">3.1.0 product guide</a>`,
  gettingStarted: 'The 3.0.0 library examples are versioned. /docs/getting-started/install/',
};

test("current install and historical transcript have separate visible contracts", () => {
  assert.doesNotThrow(() => assertReleaseCopy(releaseCopy));
  const highlightedInstall = releaseCopy.install
    .replace("reward-lens==3.1.0", "<span>reward-lens==</span><span>3.1.0</span>")
    .replace("reward-lens init --example code-reward ./demo",
      "<span>reward-lens</span><span> init --example code-reward ./demo</span>")
    .replace("reward-lens audit ./demo --offline",
      "<span>reward-lens audit</span><span> ./demo --offline</span>");
  assert.doesNotThrow(() => assertReleaseCopy({ ...releaseCopy, install: highlightedInstall }));
  for (const changed of [
    { start: releaseCopy.start.replace("data-release-start", "data-old-start") },
    { start: releaseCopy.start.replace("Captured 3.0.0 library example", "Unlabelled output 3.0.0") },
    { start: releaseCopy.start.replace("reward-lens audit ./demo --offline", "reward-lens audit ./demo") },
    { start: releaseCopy.start.replace(productGuide, "/docs/getting-started/") },
    { install: releaseCopy.install.replace("Python 3.11", "Python 3.10") },
    { install: releaseCopy.install + " nothing compiled" },
    { install: releaseCopy.install + " reward-lens[dev]" },
    { install: releaseCopy.install.replace(productGuide, "/docs/getting-started/") },
    { install: releaseCopy.install.replace(officialAsset(FILES[0]).browser_download_url, "missing-wheel-link") },
    { install: releaseCopy.install.replace(manifest.sha256[FILES[1]], "missing-sdist-hash") },
    { install: releaseCopy.install.replace(officialAsset(CHECKSUMS).browser_download_url, "missing-checksums") },
    { install: releaseCopy.install.replace("reward-lens audit ./demo --offline", "reward-lens audit ./demo") },
    { gettingStarted: releaseCopy.gettingStarted.replace("3.0.0 library", "current library") },
  ]) assert.throws(() => assertReleaseCopy({ ...releaseCopy, ...changed }));
});
