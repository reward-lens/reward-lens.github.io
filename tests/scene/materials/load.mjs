/**
 * Load a TypeScript module under `node --test`.
 *
 * The material system is TypeScript and the test runner is Node 20, which
 * cannot import a `.ts` file. The repository has no TypeScript test runner and
 * `package.json` is the integrator's file, so nothing may be added to it. Vite
 * is already installed as Astro's bundler, and its `ssrLoadModule` transpiles
 * and resolves exactly the way the site's own build does, which is the point:
 * these tests exercise the module through the same transform that ships it,
 * not through a second toolchain that could disagree with it.
 *
 * `configFile: false` matters. Without it Vite finds `astro.config.mjs`, loads
 * the Astro plugin, and the plugin tries to build a site.
 */
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");

let server = null;

export async function loadTs(relativePath) {
  if (!server) {
    server = await createServer({
      configFile: false,
      root: REPO_ROOT,
      logLevel: "error",
      server: { middlewareMode: true, hmr: false, watch: null },
      appType: "custom",
      // Nothing here is bundled, only transformed, so the dependency scan buys
      // nothing. Left on, it walks every `.html` under `design/` looking for
      // entry points and then prints a page of esbuild teardown errors when the
      // server closes mid-scan, which reads like a test failure and is not one.
      optimizeDeps: { noDiscovery: true, include: [] },
    });
  }
  return server.ssrLoadModule(resolve(REPO_ROOT, relativePath));
}

export async function closeLoader() {
  if (server) {
    await server.close();
    server = null;
  }
}
