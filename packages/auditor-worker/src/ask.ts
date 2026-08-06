/**
 * The two-step /ask pipeline — the truthfulness architecture:
 *
 *   1. SELECT  — the model sees the question + roster + catalog (no amounts!)
 *                and must pick exactly ONE fact tool (or `refuse`).
 *   2. COMPUTE — code executes that one tool against decrypted events
 *                (facts.ts). This is the only place amounts exist.
 *   3. PHRASE  — the model, as Maude McLedger, voices the computed fact.
 *
 * The model can neither choose what to reveal beyond one tool's scope nor
 * invent a number: step 1 sees no amounts, step 3 sees only the one fact.
 *
 * Runs on OpenAI through QA's CF AI Gateway (same setup as the SCF Review
 * worker — Bri's work Claude license is OAuth-only, no Anthropic API keys).
 * The compat endpoint doesn't proxy /v1/responses; the provider passthrough
 * at …/openai does, so we derive it from OPENAI_BASE_URL like SCF does.
 */
import OpenAI from "openai";

import { catalogSummary } from "./catalog";
import { executeFact, type FactContext, type FactResult } from "./facts";
import { MAUDE_SYSTEM, selectionSystem } from "./persona";

const DEFAULT_MODEL = "gpt-5.5";
const MAX_OUTPUT_TOKENS = 16_000; // reasoning + text; answers are 2–4 sentences

export interface AskEnv {
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL?: string;
  CF_AIG_TOKEN?: string;
  OPENAI_MODEL?: string;
}

export interface AskOutcome {
  answer: string;
  tool: string;
  args: Record<string, unknown>;
  fact: FactResult;
}

/** CF AI Gateway: …/compat → provider passthrough …/openai (serves /v1/responses). */
function passthroughUrl(compatUrl?: string): string | undefined {
  if (!compatUrl) return undefined;
  return compatUrl.replace(/\/compat\/?$/, "/openai");
}

type FunctionTool = OpenAI.Responses.FunctionTool;

const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): FunctionTool => ({
  type: "function",
  name,
  description,
  strict: false, // optional params allowed; real validation lives in executeFact
  parameters: { type: "object", properties, required, additionalProperties: false },
});

const FACT_TOOLS: FunctionTool[] = [
  tool(
    "purchases_of_player",
    "One player's confidential purchases in one round, optionally limited to one shop: amounts and exact-price item matches. Use for 'what did X buy (at Y) this round'.",
    {
      player: { type: "string", description: "Player name from the roster" },
      round: { type: "integer", description: "Round number (1-based)" },
      shop: { type: "string", description: "Optional shop id or label to filter by" },
    },
    ["player", "round"],
  ),
  tool(
    "who_bought_item",
    "Which players paid exactly one catalog item's price at its shop — in one round, or across all rounds if omitted. Use for 'did anyone buy the tooth sharpener'.",
    {
      item: { type: "string", description: "Item id or label from the catalog" },
      round: { type: "integer", description: "Optional round number; omit for all rounds" },
    },
    ["item"],
  ),
  tool(
    "biggest_purchase",
    "The most expensive single purchase in one round — at one shop, or across the whole village if shop is omitted — and who made it. Use for 'whose purchase was the biggest'.",
    {
      round: { type: "integer", description: "Round number (1-based)" },
      shop: { type: "string", description: "Optional shop id or label" },
    },
    ["round"],
  ),
  tool(
    "shops_visited",
    "Which shops one player visited (with visit counts) in one round — without revealing amounts. Use for 'did X shop at both the Blacksmith and the Chapel', or to audit the two-shops-a-day rule.",
    {
      player: { type: "string", description: "Player name from the roster" },
      round: { type: "integer", description: "Round number (1-based)" },
    },
    ["player", "round"],
  ),
  tool(
    "total_spent",
    "One player's total spending (all payments) in one round. Use for 'how much did X spend'.",
    {
      player: { type: "string", description: "Player name from the roster" },
      round: { type: "integer", description: "Round number (1-based)" },
    },
    ["player", "round"],
  ),
  tool(
    "paid_at_least",
    "Yes/no: did one player make any single payment of at least N XLM to one shop in one round? Use for threshold questions that shouldn't reveal the exact amount.",
    {
      player: { type: "string", description: "Player name from the roster" },
      shop: { type: "string", description: "Shop id or label" },
      min_xlm: { type: "number", description: "Threshold in XLM" },
      round: { type: "integer", description: "Round number (1-based)" },
    },
    ["player", "shop", "min_xlm", "round"],
  ),
  tool(
    "refuse",
    "Refuse the question: it needs more than one narrow fact, enumerates the ledger, or is unanswerable from the available tools.",
    { reason: { type: "string", description: "One short sentence: why the office declines" } },
    ["reason"],
  ),
];

export async function answerQuestion(
  env: AskEnv,
  ctx: FactContext,
  question: string,
  asker: string,
): Promise<AskOutcome> {
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: passthroughUrl(env.OPENAI_BASE_URL),
    defaultHeaders: env.CF_AIG_TOKEN
      ? { "cf-aig-authorization": `Bearer ${env.CF_AIG_TOKEN}` }
      : undefined,
  });
  const model = env.OPENAI_MODEL || DEFAULT_MODEL;

  // Step 1 — pick exactly one fact tool. No amounts are in this prompt.
  const roster = ctx.players
    .map((p) => `- ${p.name} (seat ${p.seat}${p.alive ? "" : ", eliminated"})`)
    .join("\n");
  const selection = await client.responses.create({
    model,
    instructions: selectionSystem({
      currentRound: ctx.currentRound,
      roster,
      catalog: catalogSummary(),
    }),
    input: `Asker: ${asker}\nQuestion: ${question}`,
    tools: FACT_TOOLS,
    tool_choice: "required",
    parallel_tool_calls: false,
    max_output_tokens: MAX_OUTPUT_TOKENS,
  });

  const call = selection.output.find(
    (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call",
  );
  const toolName = call?.name ?? "refuse";
  const args = call
    ? safeParseArgs(call.arguments)
    : { reason: "the question could not be parsed" };

  // Step 2 — code computes the one fact (the only place amounts exist).
  const fact: FactResult =
    toolName === "refuse"
      ? { refused: true, reason: String(args.reason ?? "out of scope") }
      : executeFact(ctx, toolName, args);

  // Step 3 — Maude phrases the fact, and nothing but the fact.
  const phrasing = await client.responses.create({
    model,
    instructions: MAUDE_SYSTEM,
    input: [
      `Round ${ctx.currentRound}. ${asker} asks you, before the whole table:`,
      `"${question}"`,
      "",
      "FACT (the complete truth available for this answer):",
      JSON.stringify(fact, null, 2),
    ].join("\n"),
    max_output_tokens: MAX_OUTPUT_TOKENS,
  });

  const answer = phrasing.output_text?.trim();
  return { answer: answer || flatAnswer(fact), tool: toolName, args, fact };
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return { reason: "the question could not be parsed" };
}

/** Persona-free fallback if the phrasing call yields no text. */
function flatAnswer(fact: FactResult): string {
  if (fact.refused) return `The Auditor declines: ${String(fact.reason)}.`;
  if (fact.error) return `The Auditor consults the register: ${String(fact.error)}.`;
  return `The Auditor reads from the ledger: ${JSON.stringify(fact)}`;
}
