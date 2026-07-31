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
  OPENAI_API_KEY: string;
  /** CF AI Gateway compat URL (QA's gateway — same as SCF Review). */
  OPENAI_BASE_URL?: string;
  /** Optional gateway auth (cf-aig-authorization). */
  CF_AIG_TOKEN?: string;
  GM_TOKEN: string;
}
