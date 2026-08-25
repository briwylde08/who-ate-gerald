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
