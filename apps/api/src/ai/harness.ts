/**
 * The assistant's turn (§16): the client sends the whole conversation (it is
 * never stored here), we run a short Gemini function-calling loop over the
 * registry tools, and return the answer, any proposals (NOT applied), the
 * figures it cited and exactly what was sent to Gemini.
 */
import { ZodError, z } from "zod";
import { ActionError, type ActionPreview, type Account } from "@ft/core";
import type { AppEnv } from "../env.ts";
import { getDb, loadSlices } from "../db/data.ts";
import { NotFound, previewAction, runQuery, todayFor } from "../routes/registry.ts";
import { GeminiRateLimitError, geminiClient, type Content, type FunctionCall, type GenerateRequest, type Part } from "./gemini.ts";
import { accountLabels, forModel, scrubString, type AccountLabels } from "./privacy.ts";
import { builtInPrompt, systemPrompt } from "./prompts.ts";
import { checkBudget, cooldownFrom, cooldownUntil, limitsFor, recordRequest, setCooldown, type Blocked } from "./rateLimit.ts";
import { declarations, tools, type Tool } from "./tools.ts";

/** At most this many rounds of tool calls per turn (Worker CPU and free-tier requests). */
export const MAX_TOOL_ROUNDS = 6;
/** Figures per tool result that get a citation tag. */
const MAX_FIGURES_PER_RESULT = 60;

export const DEFAULT_MODEL = "gemini-2.5-flash";
export const DEFAULT_FALLBACK_MODEL = "gemini-2.5-flash-lite";

export const chatRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(8000) }))
    .min(1)
    .max(40)
    .refine((m) => m[m.length - 1]!.role === "user", "The last message must be from the user"),
  /** A built-in prompt id for the last message: its tool guidance is sent with it. */
  promptId: z.string().max(40).optional(),
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
  /** Contents added since the previous request (each request also re-sends everything before). */
  newContents: Content[];
  toolConfig: GenerateRequest["toolConfig"];
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
    generationConfig: GenerateRequest["generationConfig"];
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

async function runTool(state: TurnState, tool: Tool | undefined, call: FunctionCall): Promise<Record<string, unknown>> {
  if (!tool) return { error: `There is no tool named "${call.name}".` };
  const args = call.args ?? {};
  try {
    if (tool.kind === "read") {
      const params = tool.query.params.parse(args);
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
    const input = tool.action.input.parse(args);
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

/** One Gemini request with our budget, Google's 429s and the fallback model. */
async function generate(env: AppEnv, request: GenerateRequest, nowMs: () => number) {
  const db = env.DB;
  const primary = env.GEMINI_MODEL || DEFAULT_MODEL;
  const fallback = env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;
  const client = geminiClient(env.GEMINI_API_KEY);
  const limits = limitsFor(env);
  let lastBlock: Blocked | null = null;
  for (const model of primary === fallback ? [primary] : [primary, fallback]) {
    const cooled = await cooldownUntil(db, model, nowMs());
    if (cooled) {
      lastBlock = { source: "gemini", scope: "minute", retryAt: cooled };
      continue;
    }
    const ours = await checkBudget(db, nowMs(), limits);
    if (ours) throw new RateLimited(ours);
    await recordRequest(db, nowMs());
    try {
      return { model, response: await client.generate(model, request) };
    } catch (e) {
      if (!(e instanceof GeminiRateLimitError)) throw e;
      const until = cooldownFrom(nowMs(), e.retryAfterMs, e.perDay);
      await setCooldown(db, model, until);
      lastBlock = { source: "gemini", scope: e.perDay ? "day" : "minute", retryAt: until };
    }
  }
  throw new RateLimited(lastBlock!);
}

export async function runChat(env: AppEnv, rawRequest: unknown, nowMs: () => number = Date.now): Promise<ChatResponse> {
  const req = chatRequestSchema.parse(rawRequest);
  const today = todayFor(env, nowMs());
  const { accounts } = await loadSlices(getDb(env.DB), ["accounts"]);
  const state: TurnState = { env, labels: accountLabels(accounts as Account[]), nextTag: req.firstTag, tags: new Map(), proposals: [] };

  const guidance = builtInPrompt(req.promptId)?.guidance;
  const contents: Content[] = req.messages.map((m, i) => {
    const isLast = i === req.messages.length - 1;
    const text = isLast && guidance ? `${m.text}\n\n(How to answer this built-in question: ${guidance})` : m.text;
    return { role: m.role === "assistant" ? "model" : "user", parts: [{ text }] };
  });

  const system = systemPrompt(today);
  const decls = declarations();
  const generationConfig = { temperature: 0.2 };
  const sent: ChatResponse["sent"] = {
    systemPrompt: system,
    tools: {
      count: decls.length,
      read: tools().tools.filter((t) => t.kind === "read").map((t) => t.name),
      write: tools().tools.filter((t) => t.kind === "write").map((t) => t.name),
      declarationChars: JSON.stringify(decls).length,
    },
    generationConfig,
    requests: [],
  };
  const usage = { promptTokens: 0, outputTokens: 0 };
  let sentUpTo = 0;
  let text = "";
  let model = env.GEMINI_MODEL || DEFAULT_MODEL;
  let rounds = 0;

  for (let call = 0; call <= MAX_TOOL_ROUNDS; call++) {
    // The last allowed request may not call tools, so the model has to answer.
    const toolConfig = { functionCallingConfig: { mode: call === MAX_TOOL_ROUNDS ? "NONE" : "AUTO" } } as const;
    const request: GenerateRequest = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      tools: [{ functionDeclarations: decls }],
      toolConfig,
      generationConfig,
    };
    sent.requests.push({ model: "", newContents: structuredClone(contents.slice(sentUpTo)), toolConfig });
    sentUpTo = contents.length;
    const result = await generate(env, request, nowMs);
    model = result.model;
    sent.requests[sent.requests.length - 1]!.model = model;
    usage.promptTokens += result.response.usageMetadata?.promptTokenCount ?? 0;
    usage.outputTokens += result.response.usageMetadata?.candidatesTokenCount ?? 0;

    const content = result.response.candidates?.[0]?.content;
    const parts: Part[] = content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
    if (calls.length === 0 || call === MAX_TOOL_ROUNDS) {
      text = parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join("")
        .trim();
      if (!text) {
        const reason = result.response.promptFeedback?.blockReason ?? result.response.candidates?.[0]?.finishReason;
        text = reason ? `I couldn't answer that (${reason}). Try rephrasing the question.` : "I couldn't come up with an answer. Try rephrasing the question.";
      }
      break;
    }
    rounds++;
    contents.push({ role: "model", parts });
    const byName = tools().byName;
    const responses: Part[] = [];
    for (const fc of calls) {
      const response = await runTool(state, byName.get(fc.name), fc);
      responses.push({ functionResponse: { name: fc.name, response } });
    }
    contents.push({ role: "user", parts: responses });
  }

  const cited: Record<string, Citation> = {};
  for (const m of text.matchAll(/\[([FC]\d+(?:\s*,\s*[FC]\d+)*)\]/g)) {
    for (const tag of m[1]!.split(/\s*,\s*/)) {
      const c = state.tags.get(tag);
      if (c) cited[tag] = c;
    }
  }
  return { text, proposals: state.proposals, citations: cited, nextTag: state.nextTag, rounds, model, sent, usage };
}
