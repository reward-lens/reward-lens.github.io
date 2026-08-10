/**
 * The markdown twin of every API reference group page: /docs/api/<group>.md
 *
 * Rendered from src/data/api/*.json at build time and never written to disk as
 * markdown, which is the property the library keeps for the pages it generates
 * and this site reproduces. The twin is the same interleaving the HTML page
 * shows: the ported prose, and one block per symbol with its signature and its
 * docstring, in the library's own words.
 */
import type { APIRoute, GetStaticPaths } from "astro";
import indexMeta from "../../../data/api/index.json";
import catalogue from "../../../data/catalogue.json";

const groupFiles = import.meta.glob("../../../data/api/*.json", { eager: true });
const proseFiles = import.meta.glob("../../../data/api/_prose/*.json", {
  eager: true,
});

export const getStaticPaths: GetStaticPaths = () =>
  indexMeta.groups.map((g: any) => ({ params: { group: g.group } }));

const symbolBlock = (sym: any): string => {
  const out: string[] = [];
  out.push(`## ${sym.name}`, "");
  out.push(`\`${sym.path}\`${sym.kind ? ` · ${sym.kind}` : ""}`, "");
  if (sym.signature) out.push("```python", sym.signature, "```", "");
  if (sym.text) out.push(sym.text.trim(), "");
  for (const p of sym.params ?? [])
    out.push(
      `- \`${p.name}\`${p.annotation ? `: ${p.annotation}` : ""}${
        p.default != null ? ` = ${p.default}` : ""
      }${p.description ? `: ${p.description}` : ""}`,
    );
  if ((sym.params ?? []).length) out.push("");
  for (const e of sym.members?.enum_members ?? [])
    out.push(`- \`${e.name}\`${e.value != null ? ` = ${e.value}` : ""}`);
  if ((sym.members?.enum_members ?? []).length) out.push("");
  if (sym.source?.url) out.push(`Source: ${sym.source.url}`, "");
  return out.join("\n");
};

export const GET: APIRoute = ({ params }) => {
  const group = params.group as string;
  const symData: any = (groupFiles[`../../../data/api/${group}.json`] as any).default;
  const proseData: any = (proseFiles[`../../../data/api/_prose/${group}.json`] as any)
    .default;

  const parts: string[] = [
    "---",
    `title: ${JSON.stringify(symData.title)}`,
    `libraryVersion: ${JSON.stringify(catalogue.provenance.libraryVersion)}`,
    `generatedBy: "scripts/build_api_ref.py"`,
    "---",
    "",
    `# ${symData.title}`,
    "",
  ];

  for (const seg of proseData.segments) {
    if (seg.type === "prose") parts.push(seg.markdown.trim(), "");
    else if (seg.type === "symbol") {
      const sym = symData.symbols[seg.path];
      if (sym) parts.push(symbolBlock(sym));
    }
  }

  return new Response(parts.join("\n"), {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
};
