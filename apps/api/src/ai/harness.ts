/**
 * The assistant's turn (§16): the client sends the whole conversation (it is
 * never stored here), we run a short Claude tool-use loop over the registry
 * tools, and return the answer, any proposals (NOT applied), the figures it
 * cited and exactly what was sent to Claude.
 */
import { ZodError, z } from "zod";
import { ActionError, queryRegistry, type ActionPreview, type Account } from "@ft/core";
import type { AppEnv } from "../env.ts";
import { getDb, loadSlices } from "../db/data.ts";
import { NotFound, previewAction, runQuery, todayFor } from "../routes/registry.ts";
import type Anthropic from "@anthropic-ai/sdk";
import { ModelRateLimitError, modelClient, type ModelRequest, type ModelResponse } from "./claude.ts";
import { accountLabels, forModel, scrubString, type AccountLabels } from "./privacy.ts";
import { builtInPrompt, systemPrompt } from "./prompts.ts";
import { checkBudget, cooldownFrom, cooldownUntil, limitsFor, recordRequest, setCooldown, type Blocked } from "./rateLimit.ts";
import { declarations, readToolName, tools, type Tool } from "./tools.ts";
import { linkUntaggedAmounts } from "./citations.ts";

/** At most this many rounds of tool calls per turn (cost and Worker time). */
export const MAX_TOOL_ROUNDS = 6;
/** Figures per tool result that get a citation tag. */
const MAX_FIGURES_PER_RESULT = 60;

/** Code default; wrangler.toml sets AI_MODEL. Haiku: cheap, fast, good at picking tools. */
export const DEFAULT_MODEL = "claude-haiku-5-5";
/** Room for adaptive thinking plus the answer (non-streaming, so it stays well under SDK timeouts). */
export const MAX_TOKENS = 16_000;
const EFFORTS = ["low", "medium", "high"] as const;

export const chatRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(8000) }))
    .min(1)
    .max(40)
    .refine((m) => m[m.length - 1]!.role === "user", "The last message must be from the user"),
  /** A built-in prompt id for the last message: its tool guidance is sent with it. */
  promptId: z.string().max(40).optional(),
  /** "Explain this" (design.md §7): the figure the user clicked, sent with the last message. */
  explain: z
    .object({ query: z.string().max(80), params: z.unknown(), figureId: z.string().max(200).optional(), label: z.string().max(200).optional() })
    .optional(),
  /** First citation number to use, so tags stay unique across the conversation. */
  firstTag: z.number().int().min(1).max(100_000).default(1),
});
export type ChatRequest = z.input<typeof chatRequestSchema>;

export type Citation =
  | { kind: "figure"; query: string; params: unknown; figureId: string; cents: number; label: string | null }
  | { kind: "chart"; query: string; params: unknown };

export interface Proposal {
  id: string;
  action: string;
  input: unknown;
  preview: ActionPreview;
}

export interface SentRequest {
  model: string;
  /** Messages added since the previous request (each request also re-sends everything before). */
  newMessages: Anthropic.MessageParam[];
  toolChoice: ModelRequest["tool_choice"];
}

export interface ChatResponse {
  text: string;
  proposals: Proposal[];
  citations: Record<string, Citation>;
  nextTag: number;
  rounds: number;
  model: string;
  sent: {
    systemPrompt: string;
    tools: { count: number; read: string[]; write: string[]; declarationChars: number };
    settings: { maxTokens: number; effort: string | null };
    requests: SentRequest[];
  };
  usage: { promptTokens: number; outputTokens: number };
}

export class RateLimited extends Error {
  readonly blocked: Blocked;
  constructor(blocked: Blocked) {
    super(`Rate limited until ${blocked.retryAt}`);
    this.blocked = blocked;
    this.name = "RateLimited";
  }
}

function errorText(e: unknown): string {
  if (e instanceof ZodError) return `Invalid input: ${e.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`;
  if (e instanceof ActionError || e instanceof NotFound) return e.message;
  console.error(e);
  return "The tool failed.";
}

interface TurnState {
  env: AppEnv;
  labels: AccountLabels;
  nextTag: number;
  tags: Map<string, Citation>;
  proposals: Proposal[];
}

/** Models sometimes send a free-form object as a JSON string: decode those before validating. */
export function decodeJsonStrings(v: unknown): unknown {
  if (typeof v === "string") {
    const t = v.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try {
        return JSON.parse(t);
      } catch {
        return v;
      }
    }
    return v;
  }
  if (Array.isArray(v)) return v.map(decodeJsonStrings);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decodeJsonStrings(x)]));
  return v;
}

function parseArgs<T>(schema: z.ZodType<T>, args: unknown): T {
  // Prefer the decoded form (an `unknown` field would otherwise accept the string as is);
  // fall back to the raw args when decoding breaks a legitimately JSON-looking string.
  const decoded = schema.safeParse(decodeJsonStrings(args));
  if (decoded.success) return decoded.data;
  const raw = schema.safeParse(args);
  if (raw.success) return raw.data;
  throw decoded.error;
}

async function runTool(state: TurnState, tool: Tool | undefined, call: Anthropic.ToolUseBlock): Promise<Record<string, unknown>> {
  if (!tool) return { error: `There is no tool named "${call.name}".` };
  const args = call.input ?? {};
  try {
    if (tool.kind === "read") {
      const params = parseArgs(tool.query.params, args);
      const result = await runQuery(state.env, tool.query.name, params);
      const chart = `C${state.nextTag++}`;
      state.tags.set(chart, { kind: "chart", query: tool.query.name, params });
      const figures: Record<string, { figure: string; cents: number; label?: string }> = {};
      for (const [figureId, f] of Object.entries(result.figures).slice(0, MAX_FIGURES_PER_RESULT)) {
        const tag = `F${state.nextTag++}`;
        const label = f.label ? scrubString(f.label, state.labels) : null;
        state.tags.set(tag, { kind: "figure", query: tool.query.name, params, figureId, cents: f.cents, label });
        figures[tag] = { figure: figureId, cents: f.cents, ...(label ? { label } : {}) };
      }
      return { chart, figures, value: forModel(result.value, state.labels) };
    }
    const input = parseArgs(tool.action.input, args);
    const preview = await previewAction(state.env, tool.action.name, input);
    const proposal: Proposal = { id: crypto.randomUUID(), action: tool.action.name, input, preview };
    state.proposals.push(proposal);
    return {
      status: "PROPOSED. Nothing has changed: the user will approve or reject this in the app.",
      proposalId: proposal.id,
      summary: scrubString(preview.summary, state.labels),
      changes: preview.changes.map((c) => ({
        label: scrubString(c.label, state.labels),
        before: c.before === null ? null : scrubString(c.before, state.labels),
        after: c.after === null ? null : scrubString(c.after, state.labels),
      })),
    };
  } catch (e) {
    return { error: errorText(e) };
  }
}

/** One Claude request with our budget and the provider's 429 cooldown. */
async function generate(env: AppEnv, request: ModelRequest, nowMs: () => number): Promise<ModelResponse> {
  const db = env.DB;
  const cooled = await cooldownUntil(db, request.model, nowMs());
  if (cooled) throw new RateLimited({ source: "provider", scope: "minute", retryAt: cooled });
  const ours = await checkBudget(db, nowMs(), limitsFor(env));
  if (ours) throw new RateLimited(ours);
  await recordRequest(db, nowMs());
  try {
    return await modelClient(env.ANTHROPIC_API_KEY).create(request);
  } catch (e) {
    if (!(e instanceof ModelRateLimitError)) throw e;
    const until = cooldownFrom(nowMs(), e.retryAfterMs, false);
    await setCooldown(db, request.model, until);
    throw new RateLimited({ source: "provider", scope: "minute", retryAt: until });
  }
}

/** Guidance for "Explain this": read the same query the chart used, then the transactions behind the figure. */
export function explainGuidance(e: NonNullable<z.infer<typeof chatRequestSchema>["explain"]>): string {
  const tool = queryRegistry.get(e.query) ? readToolName(e.query) : null;
  const params = JSON.stringify(e.params ?? {});
  if (!tool) return "The user clicked Explain on a chart; answer from the read tools.";
  return [
    `The user clicked "Explain" on ${e.label ? `"${e.label}"` : "a number"} in the app.`,
    `First call ${tool} with exactly these params: ${params}.`,
    e.figureId
      ? `The number is its figure "${e.figureId}". To see the transactions behind it, call q__transactions__drillDown with {"query": "${e.query}", "params": ${params}, "figure": "${e.figureId}"}.`
      : "",
    "Explain in 2–4 sentences what drives this number and how it compares with usual, citing figures.",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function runChat(env: AppEnv, rawRequest: unknown, nowMs: () => number = Date.now): Promise<ChatResponse> {
  const req = chatRequestSchema.parse(rawRequest);
  const today = todayFor(env, nowMs());
  const { accounts } = await loadSlices(getDb(env.DB), ["accounts"]);
  const state: TurnState = { env, labels: accountLabels(accounts as Account[]), nextTag: req.firstTag, tags: new Map(), proposals: [] };

  const guidance = builtInPrompt(req.promptId)?.guidance ?? (req.explain ? explainGuidance(req.explain) : undefined);
  const messages: Anthropic.MessageParam[] = req.messages.map((m, i) => {
    const isLast = i === req.messages.length - 1;
    const text = isLast && guidance ? `${m.text}\n\n(How to answer this built-in question: ${guidance})` : m.text;
    return { role: m.role, content: text };
  });

  const system = systemPrompt(today);
  const decls = declarations();
  const model = env.AI_MODEL || DEFAULT_MODEL;
  const effort = (EFFORTS as readonly string[]).includes(env.AI_EFFORT ?? "") ? (env.AI_EFFORT as (typeof EFFORTS)[number]) : null;
  const sent: ChatResponse["sent"] = {
    systemPrompt: system,
    tools: {
      count: decls.length,
      read: tools().tools.filter((t) => t.kind === "read").map((t) => t.name),
      write: tools().tools.filter((t) => t.kind === "write").map((t) => t.name),
      declarationChars: JSON.stringify(decls).length,
    },
    settings: { maxTokens: MAX_TOKENS, effort },
    requests: [],
  };
  const usage = { promptTokens: 0, outputTokens: 0 };
  let sentUpTo = 0;
  let text = "";
  let rounds = 0;

  for (let call = 0; call <= MAX_TOOL_ROUNDS; call++) {
    // The last allowed request may not call tools, so the model has to answer.
    const toolChoice: ModelRequest["tool_choice"] = call === MAX_TOOL_ROUNDS ? { type: "none" } : { type: "auto" };
    const request: ModelRequest = {
      model,
      max_tokens: MAX_TOKENS,
      // Tools + system prompt are the same every request: one cache breakpoint covers both,
      // and the top-level breakpoint caches the growing conversation between tool rounds.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      cache_control: { type: "ephemeral" },
      tools: decls,
      tool_choice: toolChoice,
      messages,
      ...(effort ? { output_config: { effort } } : {}),
    };
    sent.requests.push({ model, newMessages: structuredClone(messages.slice(sentUpTo)), toolChoice });
    sentUpTo = messages.length;
    const response = await generate(env, request, nowMs);
    sent.requests[sent.requests.length - 1]!.model = response.model || model;
    usage.promptTokens += (response.usage?.input_tokens ?? 0) + (response.usage?.cache_read_input_tokens ?? 0) + (response.usage?.cache_creation_input_tokens ?? 0);
    usage.outputTokens += response.usage?.output_tokens ?? 0;

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0 || call === MAX_TOOL_ROUNDS || response.stop_reason !== "tool_use") {
      text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      if (!text) {
        text =
          response.stop_reason === "refusal"
            ? "I can't help with that one. Try asking it differently."
            : response.stop_reason === "max_tokens"
              ? "That answer ran too long. Try a narrower question."
              : "I couldn't come up with an answer. Try rephrasing the question.";
      }
      break;
    }
    rounds++;
    // The assistant turn goes back exactly as received (thinking blocks included).
    messages.push({ role: "assistant", content: response.content as Anthropic.ContentBlockParam[] });
    const byName = tools().byName;
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const result = await runTool(state, byName.get(tu.name), tu);
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result), ...("error" in result ? { is_error: true } : {}) });
    }
    // All results of one round go back in a single user message.
    messages.push({ role: "user", content: results });
  }
  text = linkUntaggedAmounts(text, state.tags);
  const cited: Record<string, Citation> = {};
  for (const m of text.matchAll(/\[([FC]\d+(?:\s*,\s*[FC]\d+)*)\]/g)) {
    for (const tag of m[1]!.split(/\s*,\s*/)) {
      const c = state.tags.get(tag);
      if (c) cited[tag] = c;
    }
  }
  return { text, proposals: state.proposals, citations: cited, nextTag: state.nextTag, rounds, model: sent.requests.at(-1)?.model ?? model, sent, usage };
}

