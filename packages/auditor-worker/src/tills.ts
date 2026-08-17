/**
 * The shopkeepers count their tills — step 5 of a confidential payment,
 * performed for real. A merge folds a shop's receiving balance into its
 * spendable balance: no ZK proof, just a transaction signed by the shop's
 * own key, so the shop's account page on the public ledger finally shows a
 * transaction of its own. (Step 6 — withdraw — DOES need a proof the worker
 * cannot run; the reckoning shows Maude's audited totals instead.)
 *
 * Secrets: SHOP_SECRETS is a JSON object { shopId: S...secret } for the
 * shops in config/shops.testnet.json. A shop missing from it is skipped —
 * the tills that can be counted still are.
 *
 * A merge sweeps the WHOLE receiving balance, not one round's worth, so a
 * dawn that fails to count is self-healing: the next successful count picks
 * up everything the failed one left behind.
 */

import { ChainClient, keypairSigner } from "@ctd/sdk/chain/client";
import { submitMerge } from "@ctd/sdk/chain/contract";

import deploymentRaw from "../../../config/deployment.testnet.json";

const deployment = deploymentRaw as {
  rpcUrl: string;
  networkPassphrase: string;
  token: string;
  verifier: string;
  auditor: string;
};

function chainClient(): ChainClient {
  return new ChainClient({
    rpcUrl: deployment.rpcUrl,
    networkPassphrase: deployment.networkPassphrase,
    contracts: {
      token: deployment.token,
      verifier: deployment.verifier,
      auditor: deployment.auditor,
    },
  });
}

export interface TillCount {
  merged: string[]; // shop ids whose merge landed
  failed: { shop: string; error: string }[];
}

/** Merge the receiving balance of each named till. Never throws. */
export async function countTills(
  tills: { id: string; address: string }[],
  shopSecretsJson: string | undefined,
): Promise<TillCount> {
  const result: TillCount = { merged: [], failed: [] };
  if (tills.length === 0) return result;

  let secrets: Record<string, string>;
  try {
    secrets = JSON.parse(shopSecretsJson ?? "{}") as Record<string, string>;
  } catch {
    return { merged: [], failed: tills.map((t) => ({ shop: t.id, error: "SHOP_SECRETS unreadable" })) };
  }

  const client = chainClient();
  const settled = await Promise.allSettled(
    tills.map(async ({ id, address }) => {
      const secret = secrets[id];
      if (!secret) throw new Error("no key for this till");
      const signer = keypairSigner(secret, deployment.networkPassphrase);
      await submitMerge(client, signer, address);
      return id;
    }),
  );
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") result.merged.push(s.value);
    else result.failed.push({ shop: tills[i].id, error: String(s.reason?.message ?? s.reason) });
  });
  return result;
}
