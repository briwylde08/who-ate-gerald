/**
 * @stellar/stellar-sdk (XDR encoding) and the SDK's payload builders use
 * Node's Buffer; Vite doesn't shim it. Import this module first.
 */
import { Buffer } from "buffer";

if (typeof (globalThis as { Buffer?: unknown }).Buffer === "undefined") {
  (globalThis as { Buffer: unknown }).Buffer = Buffer;
}
