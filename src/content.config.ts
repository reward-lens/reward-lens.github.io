import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// The ported docs corpus. `source` records the original path in the library
// repo (docs/content/...) so every page can be traced to what it was ported
// from; the redirect map is generated from the same correspondence.
const docs = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/docs" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    section: z.string(),
    order: z.number().default(0),
    source: z.string(),
  }),
});

// Dated record of real events only (releases, campaign results). Entries are
// data with optional links; nothing speculative ships here.
const log = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/log" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    type: z.enum(["release", "results", "site", "paper"]),
    links: z
      .array(z.object({ label: z.string(), href: z.string() }))
      .default([]),
  }),
});

export const collections = { docs, log };
