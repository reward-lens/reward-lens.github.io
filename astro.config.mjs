// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Redirects for the four migrated route families (D-26)
//
// C-3: there was no redirect mechanism in this repository at all. No
// `redirects` key here, zero meta-refresh files in dist/, no `_redirects`, no
// netlify.toml, no vercel.json. `scripts/checks/redirects.mjs` validated the
// 88-entry map by checking that each DESTINATION exists, which confirms the
// destination is present and does not serve the source. So gate 12 was green
// while 31 same-origin URLs were about to 404.
//
// Those 88 entries are a different problem: they are all under /reward-lens/,
// an origin path served by the old Pages deployment, which is why the runbook
// handles them on another repository. The four families below are same-origin
// on this site and are the ones that had nothing.
//
// Astro emits a meta-refresh page with a canonical link for each, which is what
// a static host can serve. The 27 card slugs are read from the generated data
// rather than typed out, so a card added upstream cannot be forgotten here.
//
// P2 owns this file. Gate 12 asserts the OLD path resolves in dist/ and that it
// points at its stated destination, and it reads this map by importing this
// config, so there is one source and not two.
// ---------------------------------------------------------------------------

const cards = JSON.parse(readFileSync(join(HERE, "src/data/cards.json"), "utf-8"));

export const migratedRoutes = {
  "/campaign/": "/log/",
  "/campaign/method/": "/log/method/",
  "/science/": "/atlas/",
  ...Object.fromEntries(
    cards.map((c) => [`/campaign/${c.id}/`, `/log/cards/${c.id}/`]),
  ),
};

export default defineConfig({
  redirects: migratedRoutes,
  site: "https://reward-lens.github.io",
  output: "static",
  // Directory URLs with trailing slashes so every old MkDocs path has a
  // one-to-one new path; the redirect layer depends on this correspondence.
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [react(), mdx(), sitemap()],
  vite: { plugins: [tailwindcss()] },
  markdown: {
    remarkPlugins: [remarkMath],
    // KaTeX parse failures render a .katex-error node; the check suite greps
    // the built HTML for it and fails the build (scripts/checks/copy_grep.sh).
    //
    // `output: "mathml"` is P5's ruling on C-14 and C-28, and it is one option
    // rather than two changes. KaTeX's default emits BOTH a MathML tree and an
    // HTML tree and relies on its own 30,188-byte stylesheet to hide one of
    // them and to lay the other out from 1,072,948 bytes of its own fonts,
    // fourteen times the site's entire text-face payload and in no budget in
    // DESIGN.md 19. Only two pages imported that stylesheet, so 62 built pages
    // carried the markup and 57 rendered both trees at once, unstyled, live in
    // production. MathML alone needs no stylesheet, no fonts and no script,
    // browsers lay it out themselves, and the accessible tree is the one KaTeX
    // was already emitting for screen readers. The `.katex-error` node this
    // comment is about is unaffected: it is produced by the parser, not by the
    // renderer, and copy_grep still catches it.
    rehypePlugins: [[rehypeKatex, { strict: false, output: "mathml" }]],
    shikiConfig: {
      themes: { light: "github-light-high-contrast", dark: "github-dark-high-contrast" },
      defaultColor: "light",
    },
  },
});
