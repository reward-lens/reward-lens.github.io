/**
 * The site's strings, loaded once from design/copy.yaml.
 *
 * F1 owns this file. It exists because the shell needs navigation labels and
 * HANDOFF.md §8 rule 1 forbids typing a string that is not in copy.yaml.
 * Every packet should import from here rather than parse the file again; two
 * loaders is the same drift as two screenshot harnesses.
 *
 * Placeholder resolution: copy.yaml writes `{{urls.repo}}` for a value that
 * lives elsewhere in the same document. Those are resolved here. `{{version}}`
 * and its siblings are rendered from generated data and are deliberately left
 * alone, because a path that does not exist in this document is not this
 * file's to fill in.
 */
import { parse } from "yaml";
// Inlined by Vite at build time rather than read from disk at render time: the
// SSR bundle does not sit where this source file sits, so a path relative to
// import.meta.url resolves into dist/ and finds nothing.
import source from "../design/copy.yaml?raw";

const raw = parse(source) as Record<string, unknown>;

const lookup = (path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      raw,
    );

const PLACEHOLDER = /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi;

const resolve = <T>(value: T): T => {
  if (typeof value === "string") {
    return value.replace(PLACEHOLDER, (whole, path: string) => {
      const found = lookup(path);
      return typeof found === "string" ? found : whole;
    }) as unknown as T;
  }
  if (Array.isArray(value)) return value.map(resolve) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        resolve(v),
      ]),
    ) as T;
  }
  return value;
};

export interface NavItem {
  label: string;
  href: string;
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
}

export interface Nav {
  primary: NavItem[];
  home_aria: string;
  primary_aria: string;
  footer_aria: string;
  footer_groups: NavGroup[];
}

export interface Copy {
  meta: { site_name: string; tagline: string; author: string; licence: string };
  urls: Record<string, string>;
  nav: Nav;
  ui: Record<string, string>;
  footer: { privacy: string; built_note: string; licence_note: string };
  [key: string]: unknown;
}

export const copy = resolve(raw) as Copy;
export const nav = copy.nav;
export const ui = copy.ui;
export const urls = copy.urls;
