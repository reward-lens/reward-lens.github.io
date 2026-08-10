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
    // D-04. The version of the library tree the page was ported from, derived
    // by scripts/port_docs.py from the source tree's own pyproject and never
    // typed on a page. Required rather than defaulted: a page without it is a
    // page a reader cannot date, and a silent default would hide a port that
    // ran against a tree with no version in it.
    libraryVersion: z.string(),
    // Older releases this page's own prose still names, if any. It does not
    // change what the page is said to describe; it decides whether the version
    // banner carries the migration link, and it is the machine-readable half
    // of the defect report that goes back upstream.
    staleMarkers: z.array(z.string()).default([]),
  }),
});

export const collections = { docs };
