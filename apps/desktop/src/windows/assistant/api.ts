/**
 * Assistant API calls (§16). The conversation is sent whole on every turn and
 * kept only in the window's memory; the backend stores none of it.
 */
import type { ActionPreview } from "@ft/core";
import { ApiError, call, type ActionResponse } from "../../api/client.ts";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ExplainRequest {
  query: string;
  params: unknown;
  figureId?: string;
  label?: string;
}

export type Citation =
  | { kind: "figure"; query: string; params: unknown; figureId: string; cents: number; label: string | null }
  | { kind: "chart"; query: string; params: unknown };

export interface Proposal {
  id: string;
  action: string;
  input: unknown;
  preview: ActionPreview;
}

export interface Part {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  thoughtSignature?: string;
}

export interface SentRecord {
  systemPrompt: string;
  tools: { count: number; read: string[]; write: string[]; declarationChars: number };
  generationConfig?: unknown;
  requests: { model: string; newContents: { role: "user" | "model"; parts: Part[] }[]; toolConfig?: unknown }[];
}

export interface ChatResponse {
  text: string;
  proposals: Proposal[];
  citations: Record<string, Citation>;
  nextTag: number;
  rounds: number;
  model: string;
  sent: SentRecord;
  usage: { promptTokens: number; outputTokens: number };
}

export interface BuiltInPrompt {
  id: string;
  label: string;
}

export interface ActionLogEntry {
  id: string;
  actionName: string;
  summary: string;
  source: "user" | "ai";
  appliedAt: string;
  undoneAt: string | null;
}

/** The assistant is rate-limited (ours or Gemini's free tier) until `retryAt`. */
export class RateLimitedError extends Error {
  readonly retryAt: string;
  readonly scope: "minute" | "day";
  constructor(message: string, retryAt: string, scope: "minute" | "day") {
    super(message);
    this.name = "RateLimitedError";
    this.retryAt = retryAt;
    this.scope = scope;
  }
}

export async function chat(
  token: string,
  body: { messages: ChatMessage[]; promptId?: string; explain?: ExplainRequest; firstTag: number },
): Promise<ChatResponse> {
  try {
    return await call<ChatResponse>("/ai/chat", token, { method: "POST", body: JSON.stringify(body) });
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) {
      let parsed: { message?: string; retryAt?: string; scope?: "minute" | "day" } = {};
      try {
        parsed = JSON.parse(e.message) as typeof parsed;
      } catch {
        /* not JSON */
      }
      throw new RateLimitedError(parsed.message ?? "Rate limited", parsed.retryAt ?? new Date(Date.now() + 60_000).toISOString(), parsed.scope ?? "minute");
    }
    throw e;
  }
}

export async function builtInPrompts(token: string): Promise<BuiltInPrompt[]> {
  return (await call<{ prompts: BuiltInPrompt[] }>("/ai/prompts", token)).prompts;
}

/** Approve a proposal: the normal action route, marked as coming from the assistant (action log). */
export function approveProposal(token: string, p: Pick<Proposal, "action" | "input">): Promise<ActionResponse> {
  return call(`/a/${encodeURIComponent(p.action)}?source=ai`, token, { method: "POST", body: JSON.stringify(p.input) });
}

export async function actionLog(token: string, limit = 30): Promise<ActionLogEntry[]> {
  return (await call<{ actions: ActionLogEntry[] }>(`/actions?limit=${limit}`, token)).actions;
}

export function undoLogged(token: string, logId: string): Promise<{ undone: string }> {
  return call(`/actions/${encodeURIComponent(logId)}/undo`, token, { method: "POST" });
}
