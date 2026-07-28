/**
 * Vendor @aztec/bb.js's browser build into packages/game/public/vendor/bb.
 *
 * bb.js spawns its wasm Web Worker via
 *   new Worker(new URL('./main.worker.js', import.meta.url), { type: 'module' })
 * so it must be served as an intact directory at a stable public path and
 * loaded as native ESM (see packages/game/src/lib/bb-loader.ts) — a bundler
 * would move index.js into a hashed chunk whose sibling worker doesn't exist,
 * and proving would hang forever.
 */
import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

function findBrowserDir() {
  const candidates = [];
  try {
    const require = createRequire(import.meta.url);
    candidates.push(join(dirname(require.resolve("@aztec/bb.js/package.json")), "dest", "browser"));
  } catch {
    // exports map may hide package.json; fall through to the hoisted path
  }
  candidates.push(join(repoRoot, "node_modules", "@aztec", "bb.js", "dest", "browser"));
  candidates.push(
    join(repoRoot, "packages", "ctd-sdk", "node_modules", "@aztec", "bb.js", "dest", "browser"),
  );
  return candidates.find((d) => existsSync(join(d, "index.js")));
}

const srcDir = findBrowserDir();
if (!srcDir) {
  throw new Error("could not locate @aztec/bb.js dest/browser under node_modules — run npm install first");
}

const destDir = join(repoRoot, "packages", "game", "public", "vendor", "bb");
await mkdir(destDir, { recursive: true });
await cp(srcDir, destDir, { recursive: true });

const files = await readdir(destDir);
console.log("vendored @aztec/bb.js browser build");
console.log(`  from ${srcDir}`);
console.log(`  to   ${destDir}`);
console.log(`  files: ${files.join(", ")}`);
