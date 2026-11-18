/**
 * Scripted stand-in for Claude. Tests NEVER call the real API (it costs
 * credits): each step sees the request the harness built and returns the
 * response Claude would, or throws (e.g. a 429).
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelClient, ModelRequest, ModelResponse } from "../../src/ai/claude.ts";

export type Step = (request: ModelRequest) => ModelResponse;

export interface FakeClaude extends ModelClient {
  requests: { model: string; body: ModelRequest }[];
}

export function fakeClaude(steps: Step[]): FakeClaude {
  const requests: FakeClaude["requests"] = [];
  let i = 0;
  return {
    requests,
    async create(request) {
      // Deep copy: the harness keeps appending to `messages` after the call.
      requests.push({ model: request.model, body: structuredClone(request) });
      const step = steps[Math.min(i++, steps.length - 1)];
      if (!step) throw new Error("fake Claude has no scripted response");
      return step(request);
    },
  };
}

let ids = 0;

export function reply(content: Anthropic.ContentBlock[], model = "claude-haiku-5-5"): ModelResponse {
  const stop = content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
  return {
    id: `msg_${++ids}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as ModelResponse;
}

export const textBlock = (t: string) => ({ type: "text", text: t, citations: null }) as Anthropic.TextBlock;
export const toolUse = (name: string, input: unknown) => ({ type: "tool_use", id: `toolu_${++ids}`, name, input }) as Anthropic.ToolUseBlock;
/** A thinking block, as Claude returns with adaptive thinking; it must go back unchanged. */
export const thinking = () => ({ type: "thinking", thinking: "", signature: "sig" }) as Anthropic.ThinkingBlock;

export const text = (t: string): Step => () => reply([textBlock(t)]);
export const calls = (...uses: { name: string; args: unknown }[]): Step => () => reply([thinking(), ...uses.map((u) => toolUse(u.name, u.args))]);

/** The tool results (parsed) the harness sent in the last message of a request. */
export function lastToolResponses(request: ModelRequest): Record<string, unknown>[] {
  const last = request.messages[request.messages.length - 1];
  if (!last || typeof last.content === "string") return [];
  return (last.content as { type: string; content?: unknown }[])
    .filter((b) => b.type === "tool_result")
    .map((b) => JSON.parse(typeof b.content === "string" ? b.content : "{}") as Record<string, unknown>);
}

/** The plain text of a message (string content or its text blocks). */
export function messageText(m: Anthropic.MessageParam | undefined): string {
  if (!m) return "";
  if (typeof m.content === "string") return m.content;
  return m.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}
