/**
 * gerald-auditor — HTTP front door for Maude McLedger.
 *
 * Thin auth + routing; all game logic lives in the GameRoom Durable Object
 * (one per game id). Every route is GM-token-gated except GET /graph, which
 * serves the public (amount-free) payment graph for the spectator screen.
 *
 *   POST /games/:id/new            {players: [{name, address}], force?}
 *   POST /games/:id/round/start
 *   POST /games/:id/eliminate      {player}
 *   POST /games/:id/ask            {question, asker?}
 *   POST /games/:id/resolve-night
 *   GET  /games/:id/graph          (public)
 *   GET  /games/:id/state
 */
import { GameRoom } from "./game";
import type { Env } from "./env";

export { GameRoom };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });

function authorized(req: Request, env: Env): boolean {
  const header = req.headers.get("authorization") ?? "";
  return env.GM_TOKEN.length > 0 && header === `Bearer ${env.GM_TOKEN}`;
}

async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // CORS preflight for the GM dashboard's authenticated browser requests.
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/" || url.pathname === "") {
      return json({
        service: "gerald-auditor",
        auditor: "Maude McLedger, Auditor of the Order",
        motto: "One seal per moon.",
        endpoints: ["/games/:id/{new,round/start,eliminate,ask,resolve-night,graph,state}"],
      });
    }

    const m = /^\/games\/([A-Za-z0-9_-]{1,64})\/(.+?)\/?$/.exec(url.pathname);
    if (!m) return json({ error: "not found" }, 404);
    const [, gameId, action] = m;

    const isPublic = action === "graph" && req.method === "GET";
    if (!isPublic && !authorized(req, env)) {
      return json({ error: "the Order requires credentials (GM bearer token)" }, 401);
    }

    const room = env.GAMES.getByName(gameId!);
    try {
      switch (`${req.method} ${action}`) {
        case "POST new": {
          const body = await bodyOf(req);
          return json(
            await room.newGame(
              body.players as { name: string; address: string }[],
              body.force === true,
            ),
          );
        }
        case "POST round/start":
          return json(await room.startRound());
        case "POST eliminate": {
          const body = await bodyOf(req);
          return json(await room.eliminate(String(body.player ?? "")));
        }
        case "POST ask": {
          const body = await bodyOf(req);
          return json(
            await room.ask(
              String(body.question ?? ""),
              body.asker === undefined ? undefined : String(body.asker),
            ),
          );
        }
        case "POST resolve-night":
          return json(await room.resolveNight());
        case "GET graph":
          return json(await room.graphView());
        case "GET state":
          return json(await room.getState());
        default:
          return json({ error: `no route: ${req.method} ${action}` }, 404);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: message }, 400);
    }
  },
} satisfies ExportedHandler<Env>;
