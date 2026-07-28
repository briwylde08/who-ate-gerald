/**
 * Point the SDK's prover at the native-ESM bb.js served from /vendor/bb
 * (copied there from node_modules by scripts/vendor-bb.mjs). bb.js resolves
 * its wasm Web Worker relative to import.meta.url, so it must run from an
 * intact directory the bundler never touches.
 *
 * The import is built with `new Function` so neither Vite's import analysis
 * nor Rollup ever sees an `import()` expression: even with `@vite-ignore`,
 * the dev server rewrites same-origin dynamic imports with an `?import`
 * query and then refuses to serve /public files through the transform
 * pipeline ("can only be referenced via HTML tags"). A truly native import
 * fetches the file as a plain static asset.
 */
import { setUltraHonkBackendLoader } from "@ctd/sdk";

const BB_URL = "/vendor/bb/index.js";

type BbModule = { UltraHonkBackend: never };

const nativeImport = new Function("url", "return import(url)") as (
  url: string,
) => Promise<BbModule>;

let registered = false;

/** Idempotent; call before any proving. Browser-only. */
export function ensureBrowserBackend(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;
  setUltraHonkBackendLoader(async () => {
    const mod = await nativeImport(BB_URL);
    return mod.UltraHonkBackend;
  });
}
