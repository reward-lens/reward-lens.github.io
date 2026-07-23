// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

export default defineConfig({
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
    rehypePlugins: [[rehypeKatex, { strict: false }]],
    shikiConfig: {
      themes: { light: "github-light-high-contrast", dark: "github-dark-high-contrast" },
      defaultColor: "light",
    },
  },
});
