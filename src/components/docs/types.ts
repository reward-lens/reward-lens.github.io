/**
 * The shapes the documentation frame passes around.
 *
 * In a .ts file rather than exported from an .astro frontmatter, because the
 * Astro compiler strips types out of a component script and importing one back
 * across that boundary is a thing that type-checks until it does not.
 */

/** A node of src/data/docs-nav.json, generated from the library's mkdocs nav.
 *
 *  Four inhabited shapes, all four present in the generated file: a leaf with
 *  an href; a group with an href and children; a group with children and no
 *  href, which renders as a non-link title; and a leaf whose href is absolute,
 *  which is external. */
export interface NavItem {
  title: string;
  href?: string;
  children?: NavItem[];
}

/** Astro's getHeadings(), unfiltered. contents-rail keeps depths 2 and 3. */
export interface Heading {
  depth: number;
  slug: string;
  text: string;
}

/** A row of the API reference's own on-this-page list. */
export interface SymbolEntry {
  path: string;
  name: string;
  kind: string;
}

/** One entry of src/data/docs-generated.json: a route the library generates in
 *  memory and never writes to disk, which this site renders from JSON. */
export interface GeneratedRoute {
  source: string;
  href: string;
  title: string;
}
