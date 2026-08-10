/**
 * The markdown twin of the documentation landing page: /docs/index.md
 *
 * It carries the page's own four sections and then the whole tree. The tree
 * alone was the first version of this file, and it was the wrong artifact once
 * the page gained its prose: a twin that shares nothing with the page it twins
 * is a second document. The tree stays at the end because it is the useful
 * thing to hand to a language model after the framing, naming every page and
 * its URL so the next fetch is a real page rather than a guess.
 *
 * Same source as the page, so the two cannot disagree: copy.yaml:docs.* for
 * every sentence, src/data/docs-nav.json for every count and every link.
 */
import type { APIRoute } from "astro";
import docsNav from "../../data/docs-nav.json";
import catalogue from "../../data/catalogue.json";
import type { NavItem } from "../../components/docs/types";
import { copy, nav as siteNav } from "../../copy";

const HERE = "/docs/";

export const GET: APIRoute = () => {
  const nav = docsNav as NavItem[];
  const c = copy.docs as Record<string, string>;
  const footerItems = siteNav.footer_groups.flatMap((g) => g.items);
  const labelFor = (href: string) =>
    footerItems.find((i) => i.href === href)?.label ?? href;
  const label = labelFor(HERE);
  const tidy = (s: string) => (s ?? "").replace(/\s+/g, " ").trim();

  const countLeaves = (item: NavItem): number =>
    (item.href && !/^https?:\/\//.test(item.href) ? 1 : 0) +
    (item.children ?? []).reduce((n, ch) => n + countLeaves(ch), 0);

  const lines: string[] = [
    "---",
    `title: ${JSON.stringify(label)}`,
    `libraryVersion: ${JSON.stringify(catalogue.provenance.libraryVersion)}`,
    `generatedBy: "src/pages/docs/index.md.ts, from src/data/docs-nav.json"`,
    "---",
    "",
    `# ${tidy(c.heading)}`,
    "",
    tidy(c.corpus_intro),
    "",
    `## ${tidy(c.start_heading)}`,
    "",
    // Two lines per entry rather than a dash between them: an em dash as a
    // connective is banned site-wide by gate 9, and a hyphen doing the same job
    // is the same sentence with a worse glyph.
    `- [${labelFor("/start/")}](/start/)`,
    `  ${tidy(c.start_install)}`,
    `- [${nav.find((n) => n.href === "/docs/tutorials/")?.title ?? "Tutorials"}](/docs/tutorials/)`,
    `  ${tidy(c.start_tutorial)}`,
    `- [${labelFor("/docs/refusals/")}](/docs/refusals/)`,
    `  ${tidy(c.start_refusals)}`,
    `- [${labelFor("/docs/api/")}](/docs/api/)`,
    `  ${tidy(c.start_api)}`,
    "",
    `## ${tidy(c.shape_heading)}`,
    "",
  ];

  // Same filter as the page: the library's nav opens with `Home: index.md`,
  // which resolves to this route, and a landing page does not list itself.
  for (const item of nav) {
    const href = item.href ?? (item.children ?? []).find((ch) => ch.href)?.href ?? null;
    const pages = countLeaves(item);
    if (!href || pages === 0 || href === HERE) continue;
    lines.push(`- [${item.title}](${href}): ${pages}`);
  }

  lines.push(
    "",
    `## ${tidy(c.conventions_heading)}`,
    "",
    `1. ${tidy(c.convention_version)}`,
    `2. ${tidy(c.convention_markdown)}`,
    `3. ${tidy(c.convention_refusals)} [${labelFor("/docs/refusals/")}](/docs/refusals/)`,
    "",
    `## ${label}`,
    "",
  );

  const walk = (items: NavItem[], depth: number) => {
    for (const item of items) {
      const indent = "  ".repeat(depth);
      lines.push(
        item.href ? `${indent}- [${item.title}](${item.href})` : `${indent}- ${item.title}`,
      );
      if (item.children) walk(item.children, depth + 1);
    }
  };
  walk(nav, 0);
  lines.push("");

  return new Response(lines.join("\n"), {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
};
