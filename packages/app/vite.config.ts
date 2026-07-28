import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * bb.js proves UltraHonk in the browser with wasm multithreading →
 * SharedArrayBuffer → the document must be cross-origin isolated.
 * COEP `credentialless` (not `require-corp`) keeps fetch() to the Soroban RPC
 * and the auditor worker working without those endpoints sending CORP
 * headers. The same headers must be served on /vendor/bb/* — in dev Vite
 * applies server.headers to every response, so one block covers both;
 * production hosting must replicate this.
 */
const crossOriginIsolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export default defineConfig({
  plugins: [react()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  optimizeDeps: {
    // bb.js is never bundled (loaded as native ESM from /vendor/bb — see
    // src/lib/bb-loader.ts); the noir packages load their own wasm relative to
    // import.meta.url, which esbuild prebundling breaks.
    exclude: ["@aztec/bb.js", "@noir-lang/noir_js", "@noir-lang/noirc_abi", "@noir-lang/acvm_js"],
  },
  build: {
    target: "es2022",
    rollupOptions: {
      // Only the SDK's Node-side default loader references the bare specifier;
      // the browser overrides it before any proving happens.
      external: ["@aztec/bb.js"],
    },
  },
});
