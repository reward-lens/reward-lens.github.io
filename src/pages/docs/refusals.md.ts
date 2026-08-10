/**
 * The markdown twin of the refusal reference: /docs/refusals.md
 *
 * The page a reader is most likely to hand to a language model, because they
 * hit a refusal, do not know what it means, and want the whole reference in
 * one paste rather than seventeen scrolls.
 *
 * Rendered from src/data/refusals.json at build time and never written to disk
 * as markdown, which is how the library treats its own generated refusals page
 * and the property this site reproduces.
 */
import type { APIRoute } from "astro";
import refusals from "../../data/refusals.json";
import { copy } from "../../copy";

export const GET: APIRoute = () => {
  const c = copy.refusals as Record<string, any>;
  const sorted = refusals.reasons.filter((r) => r.remedy !== null);

  const parts: string[] = [
    "---",
    `title: ${JSON.stringify(c.heading)}`,
    `libraryVersion: ${JSON.stringify(refusals.provenance.libraryVersion)}`,
    `generatedBy: ${JSON.stringify(refusals.provenance.generatedBy)}`,
    "---",
    "",
    `# ${c.heading}`,
    "",
    c.intro.trim(),
    "",
    c.remedy_rule.trim(),
    "",
    `## ${c.answerable_heading}`,
    "",
    c.answerable_intro.trim(),
    "",
    ...sorted.map(
      (r) =>
        `- \`${r.name}\`: answerable ${r.remedy!.answerableLabel}. Remedy: ${r.remedy!.remedy}.`,
    ),
    "",
    c.answerable_note.trim(),
    "",
  ];

  for (const r of refusals.reasons) {
    parts.push(`## ${r.name}`, "", r.meaning.trim(), "", r.whatToDo.trim(), "");
  }

  return new Response(parts.join("\n"), {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
};
