/**
 * The markdown twin of the API reference landing page: /docs/api.md
 *
 * The index of the thirteen subsystem pages with their symbol counts, so a
 * reader who pastes it can go straight to the one that owns the name they are
 * after rather than fetching thirteen.
 */
import type { APIRoute } from "astro";
import indexMeta from "../../data/api/index.json";
import catalogue from "../../data/catalogue.json";
import proseData from "../../data/api/_prose/index.json";

export const GET: APIRoute = () => {
  const lines: string[] = [
    "---",
    `title: ${JSON.stringify(indexMeta.title)}`,
    `libraryVersion: ${JSON.stringify(catalogue.provenance.libraryVersion)}`,
    `generatedBy: "scripts/build_api_ref.py"`,
    "---",
    "",
    `# ${indexMeta.title}`,
    "",
  ];

  for (const seg of (proseData as any).segments) {
    if (seg.type === "prose") lines.push(seg.markdown.trim(), "");
  }

  for (const g of indexMeta.groups as any[]) {
    lines.push(`- [${g.title}](/docs/api/${g.group}/) (${g.symbols})`);
  }
  lines.push("");

  return new Response(lines.join("\n"), {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
};
