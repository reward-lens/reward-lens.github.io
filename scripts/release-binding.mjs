/** Public release identity shared by the finalizer and the Pages gate. */
export const VERSION = "3.1.0";
export const REPOSITORY = "reward-lens/reward-lens";
export const WORKFLOW = ".github/workflows/ci.yml";
export const FILES = [
  "reward_lens-3.1.0-py3-none-any.whl",
  "reward_lens-3.1.0.tar.gz",
];
export const CHECKSUMS = "SHA256SUMS";
export const RELEASE_URL = `https://github.com/${REPOSITORY}/releases/tag/v${VERSION}`;
const DOWNLOAD_BASE = `https://github.com/${REPOSITORY}/releases/download/v${VERSION}/`;
const DOWNLOAD_START = "{/* reward-lens-release-downloads:start */}";
const DOWNLOAD_END = "{/* reward-lens-release-downloads:end */}";
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("release artifact manifest must be an object");
  }
  for (const [key, expected] of Object.entries({
    schema: "reward-lens.release-artifacts/1",
    version: VERSION,
    repository: REPOSITORY,
    workflow: WORKFLOW,
    event: "push",
  })) {
    if (manifest[key] !== expected) throw new Error(`manifest ${key} must be ${expected}`);
  }
  if (!SHA40.test(manifest.source_sha ?? "")) throw new Error("manifest source_sha is not a full SHA");
  if (!SHA40.test(manifest.source_tree ?? "")) throw new Error("manifest source_tree is not a full SHA");
  if (!Number.isSafeInteger(manifest.ci_run_id) || manifest.ci_run_id <= 0) {
    throw new Error("manifest ci_run_id must be a positive integer");
  }
  if (!manifest.sha256 || Object.keys(manifest.sha256).sort().join("\n") !== [...FILES].sort().join("\n")) {
    throw new Error("manifest must contain exactly the wheel and source archive hashes");
  }
  for (const filename of FILES) {
    if (!SHA256.test(manifest.sha256[filename])) throw new Error(`invalid SHA-256 for ${filename}`);
  }
  return manifest;
}

export function verifyPypi(index, release, manifest) {
  if (index.info?.version !== VERSION || release.info?.version !== VERSION) {
    throw new Error(`PyPI latest and version metadata must both be ${VERSION}`);
  }
  const canonical = {
    Homepage: `https://github.com/${REPOSITORY}`,
    Documentation: "https://reward-lens.github.io",
  };
  for (const [name, url] of Object.entries(canonical)) {
    if (release.info?.project_urls?.[name] !== url) {
      throw new Error(`PyPI ${name} URL is not ${url}`);
    }
  }
  const files = release.urls ?? [];
  if (files.length !== FILES.length || files.map((file) => file.filename).sort().join("\n") !== [...FILES].sort().join("\n")) {
    throw new Error("PyPI version must contain exactly the two expected distributions");
  }
  for (const file of files) {
    if (file.yanked || file.digests?.sha256 !== manifest.sha256[file.filename]) {
      throw new Error(`PyPI digest/yank mismatch for ${file.filename}`);
    }
  }
  const indexFiles = index.releases?.[VERSION] ?? [];
  if (indexFiles.length !== FILES.length ||
      indexFiles.map((file) => file.filename).sort().join("\n") !== [...FILES].sort().join("\n")) {
    throw new Error("PyPI index does not contain exactly the expected distributions");
  }
  for (const file of files) {
    const matched = indexFiles.find((other) => other.filename === file.filename);
    if (matched?.digests?.sha256 !== manifest.sha256[file.filename]) {
      throw new Error(`PyPI index digest mismatch for ${file.filename}`);
    }
  }
  return files;
}

export function verifyGithub(run, commit, manifest) {
  const expectedPath = run.path === WORKFLOW || run.path === `${WORKFLOW}@main`;
  if (run.id !== manifest.ci_run_id || run.conclusion !== "success" || run.event !== "push" ||
      run.head_branch !== "main" || run.head_sha !== manifest.source_sha ||
      run.repository?.full_name !== REPOSITORY || !expectedPath) {
    throw new Error("public GitHub workflow run does not bind the manifest source");
  }
  if (commit.sha !== manifest.source_sha || commit.tree?.sha !== manifest.source_tree) {
    throw new Error("public GitHub commit/tree does not bind the manifest source");
  }
}

export function verifyGithubRelease(release) {
  if (!release || release.tag_name !== `v${VERSION}` || release.html_url !== RELEASE_URL ||
      release.draft !== false || release.prerelease !== false || !Array.isArray(release.assets)) {
    throw new Error("official GitHub Release identity or publication state is invalid");
  }
  const required = [...FILES, CHECKSUMS];
  for (const name of required) {
    const matching = release.assets.filter((asset) => asset.name === name);
    if (matching.length !== 1 || matching[0].browser_download_url !== `${DOWNLOAD_BASE}${name}` ||
        matching[0].state !== "uploaded" || !Number.isSafeInteger(matching[0].size) || matching[0].size <= 0) {
      throw new Error(`official GitHub Release asset is missing or untrusted: ${name}`);
    }
  }
  return Object.fromEntries(required.map((name) => [name, `${DOWNLOAD_BASE}${name}`]));
}

export function expectedChecksums(manifest) {
  return [...FILES].sort().map((name) => `${manifest.sha256[name]}  ${name}\n`).join("");
}

export function renderReleaseDownloads(manifest, release) {
  const assets = verifyGithubRelease(release);
  return `${DOWNLOAD_START}\n## Verified 3.1.0 downloads\n\n` +
    `The [PyPI version](https://pypi.org/project/reward-lens/${VERSION}/) and ` +
    `[official GitHub Release](${RELEASE_URL}) contain the qualified 3.1.0 artifacts.\n\n` +
    [...FILES].map((name) => `- [${name}](${assets[name]}): SHA-256 \`${manifest.sha256[name]}\``).join("\n") +
    `\n\n[Download SHA256SUMS](${assets[CHECKSUMS]}) to check both files.\n${DOWNLOAD_END}`;
}

export function bindInstallDownloads(install, manifest, release) {
  const start = install.indexOf(DOWNLOAD_START);
  const end = install.indexOf(DOWNLOAD_END);
  if (start < 0 || end <= start || install.indexOf(DOWNLOAD_START, start + 1) >= 0 ||
      install.indexOf(DOWNLOAD_END, end + 1) >= 0) {
    throw new Error("installation guide release-download marker pair is missing or duplicated");
  }
  return install.slice(0, start) + renderReleaseDownloads(manifest, release) +
    install.slice(end + DOWNLOAD_END.length);
}
