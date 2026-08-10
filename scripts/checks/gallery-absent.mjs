// Build assertion · dist/gallery/ must not exist
//
// Not numbered, because it is not checking a property of the site. It is
// checking that a build-time tool did not ship.
//
// D-33: F2 needed a route rendering every component in every state so it could
// be screenshotted and scanned, and found by probing that Astro's underscore
// prefix removes a page from the routing manifest rather than only from dist/,
// so the dev server 404s it too. A gallery you cannot load cannot be verified.
// It is therefore a real route at /gallery/ and it ships today.
//
// That is a problem with teeth. Every number on it is a fixture. Gate 5
// requires every numeric token in rendered HTML to resolve to an evidence
// record and gate 7 sweeps for banned identifiers, so a gallery of fixtures is
// precisely the page that should fail both, and it is also the page a search
// engine would index as the site's component documentation.
//
// The gallery body lives in src/components/base/gallery.astro. The route is
// src/pages/gallery/[...rest].astro, whose getStaticPaths returns [] unless
// PUBLIC_GALLERY=1. import.meta.env is inlined at build time, so a production
// build prunes the route rather than emitting an empty directory, and the
// gallery stays loadable for every packet screenshotting components against it.
//
// Deleting the page file was the fix this check's first version named, and it
// was the wrong one: it takes the gallery away from the packets building
// against it, which is the one thing D-33 says not to do.
//
// Rejected: "Q1 deletes it before launch." That is exactly the shape of promise
// the previous site's review log is full of, with four defects marked fixed and
// live in production right now. A build-time check cannot forget.
//
// Usage:  node scripts/checks/gallery-absent.mjs [dist]

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DIST } from "./_lib.mjs";

const dist = process.argv[2] ?? DIST;

if (!existsSync(dist)) {
  console.error(`FAIL gallery-absent: ${dist} does not exist. Run npm run build first.`);
  process.exit(1);
}

const gallery = join(dist, "gallery");
if (existsSync(gallery)) {
  const contents = readdirSync(gallery);
  console.error(`FAIL dist/gallery/ exists and must not (D-33).`);
  console.error(`     ${contents.length} file(s): ${contents.join(", ")}`);
  console.error(
    `     Every number on that route is a fixture, so it is the page gates 5 and 7 should fail on,\n` +
      `     and the page a search engine would index as the site's component documentation.\n` +
      (process.env.PUBLIC_GALLERY
        ? `     Cause: PUBLIC_GALLERY=${process.env.PUBLIC_GALLERY} was set for this build.\n` +
          `     That flag is for screenshotting components locally. A production build must not set it.`
        : `     PUBLIC_GALLERY is not set, so the route should have been pruned and was not.\n` +
          `     Check src/pages/gallery/[...rest].astro: getStaticPaths must return [] unless\n` +
          `     import.meta.env.PUBLIC_GALLERY is set, and it must read import.meta.env rather than\n` +
          `     process.env, because only the former is inlined at build time.`),
  );
  process.exit(1);
}

console.log("gallery-absent: dist/gallery/ does not exist");
process.exit(0);
