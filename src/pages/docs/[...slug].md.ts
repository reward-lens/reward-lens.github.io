/**
 * The markdown twin of every corpus page: /docs/<slug>.md
 *
 * A meaningful fraction of this audience hands a documentation page to a
 * language model, and what it should get is the source, not a scrape of the
 * rendered DOM with a sidebar in it.
 *
 * Generated at build time and never written into the repository, which is the
 * property the library keeps for its own generated pages and this site
 * reproduces (assay/docs/hooks.py:1-11): no committed second copy to go stale,
 * and no ninety machine-written files in anybody's diff.
 *
 * What it serves is the ported body with the site's front matter re-emitted as
 * a short header, so a reader who pastes the file still knows which library
 * version it describes and where in the library it came from. The MDX imports
 * the port adds for callouts and figures are stripped, because they are an
 * artifact of this site's renderer and mean nothing outside it.
 */
import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";

export const getStaticPaths: GetStaticPaths = async () => {
  const entries = await getCollection("docs");
  return entries.map((entry) => ({
    params: { slug: entry.id },
    props: { entry },
  }));
};

export const GET: APIRoute = ({ props }) => {
  const entry = (props as any).entry;
  const data = entry.data;

  const body = String(entry.body ?? "")
    // The two component imports port_docs.py writes into an .mdx page.
    .replace(/^import\s+\w+\s+from\s+"@components\/[^"]+";\s*$/gm, "")
    .replace(/^\s*\n/, "");

  const header = [
    "---",
    `title: ${JSON.stringify(data.title)}`,
    `description: ${JSON.stringify(data.description)}`,
    `libraryVersion: ${JSON.stringify(data.libraryVersion)}`,
    `source: ${JSON.stringify(data.source)}`,
    "---",
    "",
  ].join("\n");

  return new Response(header + body, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
};
