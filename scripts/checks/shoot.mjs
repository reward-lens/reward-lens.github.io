// Screenshot pages of a built site for visual review.
// Usage: node scripts/checks/shoot.mjs <dist-dir> <outdir> <path...>
// Shoots each path at 1440 and 360 wide, both themes.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const [dist, outdir, ...paths] = process.argv.slice(2);
const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = join(dist, p);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(dist, p, "index.html");
  }
  try {
    const body = await readFile(file);
    res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
});
for (const theme of ["dark", "light"]) {
  for (const width of [1440, 360]) {
    const ctx = await browser.newContext({
      viewport: { width, height: 960 },
      deviceScaleFactor: 1,
    });
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem("theme", t);
      } catch {}
    }, theme);
    const page = await ctx.newPage();
    for (const path of paths) {
      const slug = path.replaceAll("/", "_") || "home";
      await page.goto(`http://localhost:${port}${path}`, {
        waitUntil: "networkidle",
      });
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${outdir}/${slug}.${theme}.${width}.png`,
        fullPage: true,
      });
    }
    await ctx.close();
  }
}
await browser.close();
server.close();
console.log("done");
