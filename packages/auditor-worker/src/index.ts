/**
 * gerald-auditor — HTTP front door for Maude McLedger and the game itself.
 *
 * Thin auth + routing; all game logic lives in the GameRoom Durable Object
 * (one per game id). Three access tiers:
 *
 *   GM (bearer token):   POST new · deal · round/start · eliminate · ask
 *                        (console) · resolve-day    GET state · god-view
 *   Player (signature):  POST p/role · p/ask · p/vote · p/night-pick
 *                        — body: {address, signature, ...} where signature is
 *                        Freighter's SEP-53 signMessage over the fixed
 *                        per-game auth message (see auth.ts)
 *   Public (open):       GET graph · public
 */
import { GameRoom } from "./game";
import { verifyPlayerSignature } from "./auth";
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

function gmAuthorized(req: Request, env: Env): boolean {
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

    // CORS preflight for the app's authenticated browser requests.
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/" || url.pathname === "") {
      return json({
        service: "gerald-auditor",
        auditor: "Maude McLedger, Auditor of the Order (the village calls her the fortune teller)",
        motto: "One seal per villager per day.",
        endpoints: [
          "GM:     /games/:id/{new,deal,round/start,eliminate,ask,resolve-day,state,god-view}",
          "player: /games/:id/p/{role,ask,vote,night-pick}",
          "public: /games/:id/{graph,public}",
        ],
      });
    }

    const m = /^\/games\/([A-Za-z0-9_-]{1,64})\/(.+?)\/?$/.exec(url.pathname);
    if (!m) return json({ error: "not found" }, 404);
    const [, gameId, action] = m;

    const isPublic = (action === "graph" || action === "public") && req.method === "GET";
    const isPlayer = action!.startsWith("p/") && req.method === "POST";

    const room = env.GAMES.getByName(gameId!);
    try {
      // ---- player tier: identity proven by signature, then role-checked in the DO
      if (isPlayer) {
        const body = await bodyOf(req);
        const address = String(body.address ?? "");
        const signature = String(body.signature ?? "");
        if (!verifyPlayerSignature(gameId!, address, signature)) {
          return json({ error: "the village record-keeper does not recognize that signature" }, 401);
        }
        switch (action) {
          case "p/join":
            return json(
              await room.join(address, String(body.name ?? ""), String(body.character ?? "")),
            );
          case "p/ready":
            return json(await room.setReady(address, body.ready !== false));
          case "p/done":
            return json(await room.declareDone(address));
          case "p/chat":
            return json(await room.chat(address, String(body.text ?? "")));
          case "p/disclose":
            return json(await room.discloseOne(address, String(body.txHash ?? "")));
          case "p/role":
            return json(await room.myRole(address));
          case "p/character":
            return json(await room.claimCharacter(address, String(body.character ?? "")));
          case "p/ask":
            return json(await room.ask(String(body.question ?? ""), address));
          case "p/vote":
            return json(await room.vote(address, String(body.target ?? "")));
          case "p/night-pick":
            return json(await room.nightPick(address, String(body.target ?? "")));
          case "p/notes":
            return json({ notes: await room.notesFor(address) });
          default:
            return json({ error: `no player route: ${action}` }, 404);
        }
      }

      // ---- public tier
      if (isPublic) {
        return json(action === "graph" ? await room.graphView() : await room.publicView());
      }

      // ---- GM tier
      if (!gmAuthorized(req, env)) {
        return json({ error: "the Order requires credentials (GM bearer token)" }, 401);
      }
      const body = req.method === "POST" ? await bodyOf(req) : {};
      switch (`${req.method} ${action}`) {
        case "POST new":
          return json(
            await room.newGame(
              body.players as { name: string; address: string }[],
              body.force === true,
            ),
          );
        case "POST deal":
          return json(await room.deal(body.force === true));
        case "POST round/start":
        case "POST day/start":
          return json(await room.startDay());
        case "POST eliminate":
          return json(await room.eliminate(String(body.player ?? "")));
        case "POST ask":
          return json(
            await room.gmAsk(
              String(body.question ?? ""),
              body.asker === undefined ? undefined : String(body.asker),
            ),
          );
        case "POST resolve-day":
        case "POST resolve-night": // v1 alias
          return json(await room.resolveDay());
        case "GET god-view":
          return json(await room.godView());
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
