/** Pure checks for the current install route, shared by Pages and regressions. */
import { CHECKSUMS, FILES, RELEASE_URL, VERSION } from "../release-binding.mjs";

export function assertReleaseCopy({ release, home, start, install, gettingStarted }) {
  const productGuide = "https://github.com/reward-lens/reward-lens/blob/v3.1.0/README.md";
  const installText = install.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, "");
  if (release.latest !== "3.1.0" || release.unpublished !== null || !release.artifactBinding) {
    throw new Error("current release is not bound to published 3.1.0 artifacts");
  }
  for (const [route, html] of [["home", home], ["start", start]]) {
    if (!/pip install reward-lens/.test(html) ||
        !/install-strip__number[^>]*>3\.1\.0</.test(html)) {
      throw new Error(`${route} does not show the public 3.1.0 install version`);
    }
  }
  if (!start.includes("Python 3.11 or newer") ||
      !start.includes("data-release-start") ||
      !start.includes("reward-lens init --example code-reward ./demo") ||
      !start.includes("reward-lens audit ./demo --offline") ||
      !start.includes(productGuide) ||
      !start.includes("data-historical-example") ||
      !start.includes("Captured 3.0.0 library example")) {
    throw new Error("start page does not separate the 3.1.0 audit from the captured 3.0.0 example");
  }
  if (!install.includes("Describes library 3.1.0, the current release.") ||
      !install.includes("Python 3.11 or newer") ||
      !installText.includes("reward-lens==3.1.0") ||
      !installText.includes("reward-lens init --example code-reward ./demo") ||
      !install.includes(productGuide) ||
      /Python 3\.10|nothing compiled|reward-lens\[dev\]|reward-lens\[dict\]/i.test(install)) {
    throw new Error("current install guide disagrees with the 3.1.0 wheel or first audit");
  }
  if (!installText.includes("reward-lens audit ./demo --offline") ||
      !install.includes(`https://pypi.org/project/reward-lens/${VERSION}/`) ||
      !install.includes(RELEASE_URL) ||
      !install.includes(`${RELEASE_URL.replace("/tag/", "/download/")}/${CHECKSUMS}`)) {
    throw new Error("current install guide omits the offline command or official download links");
  }
  for (const name of FILES) {
    if (!/^[0-9a-f]{64}$/.test(release.artifactBinding.sha256?.[name] ?? "") ||
        !install.includes(release.artifactBinding.sha256[name]) ||
        !install.includes(`${RELEASE_URL.replace("/tag/", "/download/")}/${name}`)) {
      throw new Error(`current install guide omits qualified hash or download for ${name}`);
    }
  }
  if (!gettingStarted.includes("3.0.0 library") ||
      !gettingStarted.includes("/docs/getting-started/install/") ||
      /Python 3\.10 or newer/.test(gettingStarted)) {
    throw new Error("versioned getting-started examples look like current install instructions");
  }
}
