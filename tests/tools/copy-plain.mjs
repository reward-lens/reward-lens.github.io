// The copy control must hand over the snippet as plain text, byte for byte:
// no prompt glyph, no line numbers, no gutter annotation, no syntax markup.
// /start/ is the page where that matters most, because its snippets are meant
// to be pasted into a terminal and run.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

// transcript.ts is TypeScript and this Node cannot strip types, so the three
// source strings are read out of it rather than imported. They are string
// literals with no interpolation in them, which is what makes this safe.
const src = readFileSync(new URL("../../src/components/start/transcript.ts", import.meta.url), "utf8");
const exported = (name) => {
  const m = src.match(new RegExp(`export const ${name} = ("(?:[^"\\\\]|\\\\.)*");`));
  if (!m) throw new Error(`transcript.ts has no string export named ${name}`);
  return JSON.parse(m[1]);
};
const transcript = {
  graderSource: exported("graderSource"),
  planSource: exported("planSource"),
  readSource: exported("readSource"),
};

const expected = [
  'python -c "import reward_lens; print(reward_lens.__version__)"',
  "reward-lens capabilities --substrate NEURAL_GEN",
  transcript.graderSource,
  transcript.planSource,
  "pip install 'reward-lens[verifier]'",
  transcript.readSource,
];

const browser = await chromium.launch({
  executablePath: "/opt/google/chrome/google-chrome",
});
const page = await browser.newPage();
await page.goto(process.argv[2], { waitUntil: "load" });
const actual = await page.$$eval("[data-cb-copy]", (bs) => bs.map((b) => b.dataset.code));
await browser.close();

let bad = 0;
for (const [i, want] of expected.entries()) {
  const got = actual[i];
  const ok = got === want;
  if (!ok) bad += 1;
  console.log(`${ok ? "OK  " : "FAIL"} block ${i + 1}`);
  if (!ok) console.log(`  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`);
}
if (actual.length !== expected.length) {
  console.log(`FAIL ${actual.length} copy controls, expected ${expected.length}`);
  bad += 1;
}
console.log(bad === 0 ? "copy-plain: every control hands over the exact source" : "copy-plain: FAILED");
process.exit(bad ? 1 : 0);
