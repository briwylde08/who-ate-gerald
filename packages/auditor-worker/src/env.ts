import type { GameRoom } from "./game";
import type { LobbyRegistry } from "./registry";

export interface Env {
  GAMES: DurableObjectNamespace<GameRoom>;
  LOBBIES: DurableObjectNamespace<LobbyRegistry>;
  /** vars (wrangler.jsonc) */
  INDEXER_URL: string;
  TOKEN_CONTRACT: string;
  OPENAI_MODEL?: string;
  /** wrangler secrets */
  AUDITOR_K: string;
  /** Freeze-proofing deadlines in ms (optional). Defaults: market 5 min,
   *  vote 2 min. Set as wrangler vars to tune demo pacing without a redeploy. */
  MARKET_DEADLINE_MS?: string;
  VOTE_DEADLINE_MS?: string;
  /** JSON { shopId: S...secret } — the shopkeepers' signing keys, for the
   *  dawn till-count (config/local.shops.json is the source). */
  SHOP_SECRETS?: string;
  OPENAI_API_KEY: string;
  /** Cloudflare AI Gateway OpenAI-compat URL. */
  OPENAI_BASE_URL?: string;
  /** Optional gateway auth (cf-aig-authorization). */
  CF_AIG_TOKEN?: string;
  GM_TOKEN: string;
}
