/**
 * VillagerWallet — the game's orchestration over @ctd/sdk, ported from Axe &
 * Ember's EmberWallet (narrator layer dropped; phases callback kept for
 * spinners). Freighter signs every transaction; the confidential spending key
 * is derived from a deterministic message signature, so it is re-derivable on
 * any device — no secret lives only in this browser.
 */
import { Address, scValToNative } from "@stellar/stellar-sdk";
import {
  type ChainClient,
  type OnChainAccount,
  type KeyPair,
  type CircuitProver,
  type AccountState,
  deriveKeys,
  addressToField,
  toHex32,
  fromHex,
  StateEngine,
  LocalStorageStore,
  proverFromArtifact,
  buildRegisterWitness,
  buildTransferWitness,
  submitRegister,
  submitDeposit,
  submitMerge,
  submitTransfer,
  hybridFetchEvents,
  deriveEphemeralRE,
  proveSenderDisclosure,
  type TransferEvent,
  type DisclosureRequest,
  type DisclosureBundle,
} from "@ctd/sdk";
import registerCircuit from "@ctd/sdk/circuits/register.json";
import transferCircuit from "@ctd/sdk/circuits/transfer.json";
import discloseSenderCircuit from "@ctd/disclosure/artifacts/disclose_sender.json";

import {
  DEPLOYMENT,
  FRIENDBOT_URL,
  chainClient,
  indexerClient,
  type Deployment,
} from "./deployment";
import { ensureBrowserBackend } from "./bb-loader";
import { connectFreighter, keyDerivationMessage, skFromSignature, type MessageSigner } from "./freighter";

type CircuitName = "register" | "transfer" | "disclose_sender";

const CIRCUITS: Record<CircuitName, { bytecode: string } & Record<string, unknown>> = {
  register: registerCircuit as never,
  transfer: transferCircuit as never,
  disclose_sender: discloseSenderCircuit as never,
};

export type TxPhase = "proving" | "submitting";
export type OnPhase = (phase: TxPhase) => void;

export interface VillagerBalances {
  /** Public XLM balance (stroops) — visible to everyone, including the werebear. */
  publicXlm: bigint;
  /** Hidden spendable budget (stroops of wrapped XLM). */
  spendable: bigint;
  /** Hidden funds received but not yet collected (merge). */
  receiving: bigint;
  registered: boolean;
}

export class VillagerWallet {
  private provers = new Map<CircuitName, CircuitProver>();

  private constructor(
    readonly address: string,
    private deployment: Deployment,
    private signer: MessageSigner,
    private keys: KeyPair,
    private client: ChainClient,
    private engine: StateEngine,
  ) {}

  /**
   * Connect Freighter. The derived confidential sk is cached per
   * (token, address) to skip the signature popup on later visits.
   */
  static async connect(deployment: Deployment = DEPLOYMENT): Promise<VillagerWallet> {
    ensureBrowserBackend();
    const signer = await connectFreighter();
    const address = signer.publicKey;

    const tokenId = deployment.token;
    const addrF = addressToField(tokenId);
    const skKey = `gerald:sk:${tokenId}:${address}`;
    let sk: bigint;
    const stored = localStorage.getItem(skKey);
    if (stored) {
      sk = fromHex(stored);
    } else {
      const signature = await signer.signMessage(
        keyDerivationMessage(deployment.networkPassphrase, tokenId),
      );
      sk = await skFromSignature(signature);
      localStorage.setItem(skKey, toHex32(sk));
    }
    const keys = deriveKeys(sk, addrF);

    const client = chainClient(deployment);
    const engine = new StateEngine({
      client,
      store: new LocalStorageStore(`gerald:state:${deployment.token}:`),
      keys,
      address,
      fromLedger: deployment.deployedAtLedger,
      indexer: indexerClient(deployment),
    });
    return new VillagerWallet(address, deployment, signer, keys, client, engine);
  }

  private prover(name: CircuitName): CircuitProver {
    let p = this.provers.get(name);
    if (!p) {
      p = proverFromArtifact(CIRCUITS[name]);
      this.provers.set(name, p);
    }
    return p;
  }

  /** Fund the account via friendbot — only if it doesn't exist yet. */
  async fund(): Promise<void> {
    try {
      await this.client.server.getAccount(this.address);
      return; // already on the ledger
    } catch {
      /* not found — fall through to the faucet */
    }
    const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(this.address)}`);
    if (!res.ok && res.status !== 400) {
      throw new Error(`friendbot failed: ${res.status}`);
    }
  }

  /** On-chain confidential account, or null if not yet registered. */
  async account(): Promise<OnChainAccount | null> {
    return this.client.confidentialBalance(this.address);
  }

  /** Public (visible) XLM balance in stroops, via the underlying SAC. */
  async publicBalance(): Promise<bigint> {
    try {
      const v = await this.client.simulate(this.deployment.underlying, "balance", [
        new Address(this.address).toScVal(),
      ]);
      return scValToNative(v) as bigint;
    } catch (e) {
      // A never-funded account has no ledger entry yet — its balance is zero,
      // not an error (provisioning's friendbot step will create it).
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("account entry is missing") || msg.includes("Error(Contract, #6)")) {
        return 0n;
      }
      throw e;
    }
  }

  /** Everything the UI needs in one read. */
  async balances(): Promise<VillagerBalances> {
    const [publicXlm, state] = await Promise.all([this.publicBalance(), this.engine.sync()]);
    return {
      publicXlm,
      spendable: state.spendable.v,
      receiving: state.receiving.v,
      registered: state.registered,
    };
  }

  /** Bind keys to the hidden ledger (one ZK proof, one transaction). */
  async register(onPhase?: OnPhase): Promise<string> {
    const w = buildRegisterWitness(this.keys);
    onPhase?.("proving");
    const { proof } = await this.prover("register").prove(w.inputs);
    onPhase?.("submitting");
    const r = await submitRegister(
      this.client,
      this.signer,
      this.address,
      this.deployment.auditorId,
      w,
      proof,
    );
    return r.hash;
  }

  /** Public coins → hidden receiving balance (amount is public going in). */
  async deposit(amount: bigint): Promise<string> {
    const r = await submitDeposit(this.client, this.signer, this.address, this.address, amount);
    return r.hash;
  }

  /** Collect received funds into the spendable balance (no proof). */
  async merge(): Promise<string> {
    const r = await submitMerge(this.client, this.signer, this.address);
    await this.engine.sync();
    return r.hash;
  }

  /** Hidden-amount transfer to a registered recipient (shop or chapel). */
  async transfer(to: string, amount: bigint, onPhase?: OnPhase): Promise<string> {
    const recipient = await this.client.confidentialBalance(to);
    if (!recipient) throw new Error("recipient is not registered");
    const [kAudR, kAudS] = await Promise.all([
      this.client.auditorKey(recipient.auditorId),
      this.client.auditorKey(this.deployment.auditorId),
    ]);

    const s = await this.engine.sync();
    if (s.spendable.v < amount) {
      throw new Error(`insufficient spendable budget (${s.spendable.v} stroops)`);
    }

    const w = buildTransferWitness({
      keys: this.keys,
      v: s.spendable.v,
      r: s.spendable.r,
      amount,
      pvkB: recipient.viewingPublicKey,
      kAudR,
      kAudS,
    });
    onPhase?.("proving");
    const { proof } = await this.prover("transfer").prove(w.inputs);
    onPhase?.("submitting");
    const r = await submitTransfer(this.client, this.signer, this.address, to, w, proof);
    await this.engine.setSpendable(w.next);
    return r.hash;
  }

  /** Resolve one of this wallet's sent transfers by transaction hash. */
  async findSentByHash(txHash: string): Promise<TransferEvent | null> {
    const { events } = await hybridFetchEvents(this.client, indexerClient(this.deployment), {
      fromLedger: this.deployment.deployedAtLedger,
    });
    return (
      events.find(
        (e): e is TransferEvent =>
          e.type === "transfer" && e.from === this.address && e.txHash === txHash,
      ) ?? null
    );
  }

  /**
   * Trial defense: prove to the GM's verifier that one specific sent transfer
   * paid exactly its amount — off-chain, nothing else revealed.
   */
  async discloseSent(
    event: TransferEvent,
    request: DisclosureRequest,
    onPhase?: OnPhase,
  ): Promise<DisclosureBundle> {
    const recipient = await this.client.confidentialBalance(event.to);
    if (!recipient) throw new Error("transfer recipient is not registered");
    const rEScalar = deriveEphemeralRE(this.keys.vk, event.sigma);
    onPhase?.("proving");
    const bundle = await proveSenderDisclosure({
      keys: this.keys,
      rEScalar,
      event,
      pvkB: recipient.viewingPublicKey,
      request,
      prover: this.prover("disclose_sender"),
    });
    return bundle;
  }

  /** Sign an arbitrary auth message with Freighter (SEP-53), raw bytes. */
  async signAuthMessage(message: string): Promise<Uint8Array> {
    return this.signer.signMessage(message);
  }

  /** Current local state without a network sync. */
  async localState(): Promise<AccountState> {
    return this.engine.current();
  }

  async destroy(): Promise<void> {
    await Promise.all([...this.provers.values()].map((p) => p.destroy()));
    this.provers.clear();
  }
}
