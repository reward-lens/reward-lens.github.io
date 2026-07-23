// OG image renderer for reward-lens.
//
// Renders 1200x630 social cards to public/og/ with Playwright driving system
// Chrome at deviceScaleFactor 1. Deterministic and re-runnable: same inputs
// always produce the same pixels (fixed fonts loaded from disk via file://,
// no network, no animation, title size chosen by a fixed measure-and-step fit).
//
// Outputs:
//   default.png                 the site tagline
//   campaign.png                the scored-ledger headline
//   campaign-<id>.png           one per card in src/data/cards.json
//
// Run:  node scripts/og_render.mjs

import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE = join(__dirname, "..");
const OUT = join(SITE, "public/og");
mkdirSync(OUT, { recursive: true });

// ---- fonts (loaded from disk, no network) --------------------------------
const fontUrl = (rel) => pathToFileURL(join(SITE, "node_modules", rel)).href;
const SERIF = fontUrl(
  "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2",
);
const MONO400 = fontUrl(
  "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2",
);
const MONO500 = fontUrl(
  "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2",
);

// ---- brand palette (dark surface) ----------------------------------------
const BG = "#0C1017";
const INK = "#E6E9F0";
const INK2 = "#9AA3B5";
const AMBER = "#E8A33D";
const VERDICT_COLOR = {
  confirmed: "#67D9B4",
  refuted: "#EF9285",
  mixed: "#E0B153",
  inconclusive: "#8FB4E3",
};

// ---- the mark, inline SVG (light ink + amber peak on dark) ----------------
const MARK = `<svg width="72" height="72" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <circle cx="16" cy="16" r="11" stroke="${INK}"/>
    <path d="M6 18.5 L12.4 18.5" stroke="${INK}"/>
    <path d="M19.6 18.5 L26 18.5" stroke="${INK}"/>
    <path d="M12.4 18.5 L16 10.5 L19.6 18.5" stroke="${AMBER}"/>
  </g>
</svg>`;

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// A subtitle line is optional (used by card cards: "id · verdict").
function pageHtml({ title, subId, subVerdict }) {
  const subtitle =
    subId && subVerdict
      ? `<div class="sub"><span class="sub-id">${esc(subId)}</span><span class="dot">·</span><span class="sub-verdict" style="color:${
          VERDICT_COLOR[subVerdict] || INK2
        }">${esc(subVerdict)}</span></div>`
      : "";

  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'Instrument Serif';src:url('${SERIF}') format('woff2');font-weight:400;font-style:normal;font-display:block}
@font-face{font-family:'Plex Mono';src:url('${MONO400}') format('woff2');font-weight:400;font-style:normal;font-display:block}
@font-face{font-family:'Plex Mono';src:url('${MONO500}') format('woff2');font-weight:500;font-style:normal;font-display:block}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:630px}
.card{width:1200px;height:630px;background:${BG};color:${INK};
  display:flex;flex-direction:column;justify-content:space-between;
  padding:72px 80px;position:relative;overflow:hidden}
.card::after{content:"";position:absolute;left:0;right:0;bottom:0;height:6px;background:${AMBER}}
.lockup{display:flex;align-items:center;gap:20px}
.lockup .name{font-family:'Plex Mono';font-weight:500;font-size:34px;letter-spacing:-0.01em;color:${INK}}
.body{display:flex;flex-direction:column;gap:22px;max-width:1040px}
.title{font-family:'Instrument Serif';font-weight:400;color:${INK};
  line-height:1.08;letter-spacing:0.005em}
.sub{font-family:'Plex Mono';font-weight:400;font-size:24px;display:flex;align-items:center;gap:14px;color:${INK2}}
.sub .dot{color:${INK2};opacity:.6}
.sub-id{color:${INK2}}
.foot{font-family:'Plex Mono';font-weight:400;font-size:22px;color:${INK2};letter-spacing:0.02em}
</style></head><body>
<div class="card">
  <div class="lockup">${MARK}<span class="name">reward-lens</span></div>
  <div class="body">
    <div class="title" id="title">${esc(title)}</div>
    ${subtitle}
  </div>
  <div class="foot">reward-lens.github.io</div>
</div>
</body></html>`;
}

// Deterministic title fit: start at 78px, step down by 2px until the title
// occupies at most 3 lines (or a 34px floor is hit). Same input -> same size.
async function fitTitle(page) {
  await page.evaluate(() => {
    const el = document.getElementById("title");
    const maxLines = 3;
    let size = 78;
    const fits = () => {
      el.style.fontSize = size + "px";
      const lh = size * 1.08;
      return el.scrollHeight <= Math.round(lh * maxLines) + 1;
    };
    while (size > 34 && !fits()) size -= 2;
    el.style.fontSize = size + "px";
  });
}

async function render(page, spec, filename) {
  await page.setContent(pageHtml(spec), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await fitTitle(page);
  await page.evaluate(() => document.fonts.ready);
  const card = await page.$(".card");
  await card.screenshot({ path: join(OUT, filename) });
}

async function main() {
  const cards = JSON.parse(
    readFileSync(join(SITE, "src/data/cards.json"), "utf8"),
  );

  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });

  const jobs = [
    {
      file: "default.png",
      spec: { title: "The instrument for looking inside reward models" },
    },
    {
      file: "campaign.png",
      spec: {
        title:
          "The scored ledger: 53 frozen hypotheses, 16 confirmed, 21 refuted, 8 kills fired",
      },
    },
    ...cards.map((c) => ({
      file: `campaign-${c.id}.png`,
      spec: { title: c.title, subId: c.id, subVerdict: c.verdict },
    })),
  ];

  for (const j of jobs) {
    await render(page, j.spec, j.file);
    console.log("rendered", j.file);
  }

  await browser.close();
  console.log(`\ndone: ${jobs.length} OG images -> ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
