// A static server for THIS worktree's own dist, held open for shoots and probes.
//
// HANDOFF trap 1: `astro preview --port N` silently binds a different port when
// N is taken and prints the real one, and several worktrees run concurrently.
// A packet in this fleet photographed another worktree's site that way. The
// gates' own `serveDist` binds port 0, so there is no port to collide over, and
// this wrapper prints the port it actually got together with the md5 of the
// bytes it will serve for `/`. Check that md5 against `md5sum dist/index.html`
// in this worktree before believing any screenshot taken through it.
//
// Usage: node tests/a11y/serve.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DIST, serveDist } from "../../scripts/checks/_lib.mjs";

const server = await serveDist(DIST);
const md5 = createHash("md5").update(readFileSync(join(DIST, "index.html"))).digest("hex");

console.log(`serving  ${DIST}`);
console.log(`origin   ${server.origin}`);
console.log(`md5(/)   ${md5}`);
