/**
 * Deployed game-token addresses + network config, written by
 * scripts/deploy-stack.ts, plus the Auditor worker (Maude McLedger).
 */
import deploymentJson from "../../../../config/deployment.testnet.json";
import { ChainClient, IndexerClient } from "@ctd/sdk";

export interface Deployment {
  network: string;
  rpcUrl: string;
  networkPassphrase: string;
  token: string;
  verifier: string;
  auditor: string;
  auditorId: number;
  underlying: string;
  deployedAtLedger: number;
  /** Durable event mirror — keeps history reachable past RPC retention. */
  indexerUrl?: string;
}

export const DEPLOYMENT: Deployment = deploymentJson;

export const FRIENDBOT_URL = "https://friendbot.stellar.org";

/** Maude's front door. Override for local dev via localStorage "gerald:auditor-url". */
export const AUDITOR_URL =
  (typeof localStorage !== "undefined" && localStorage.getItem("gerald:auditor-url")) ||
  "https://gerald-auditor.briana-761.workers.dev";

export function chainClient(d: Deployment = DEPLOYMENT): ChainClient {
  return new ChainClient({
    rpcUrl: d.rpcUrl,
    networkPassphrase: d.networkPassphrase,
    contracts: { token: d.token, verifier: d.verifier, auditor: d.auditor },
  });
}

/** Durable event mirror, or undefined when not configured (RPC-only mode). */
export function indexerClient(d: Deployment = DEPLOYMENT): IndexerClient | undefined {
  return d.indexerUrl ? new IndexerClient({ baseUrl: d.indexerUrl }) : undefined;
}
