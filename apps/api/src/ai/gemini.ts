/**
 * Minimal Gemini REST client (generateContent with function calling) used
 * from the Worker with `fetch`. No SDK: the request is a plain JSON body,
 * which is also exactly what the "What was sent" view shows.
 *
 * Tests never reach Google: they install a fake with `setGeminiClientForTests`
 * (or pass a fake `fetch` to `createGeminiRestClient`).
 */
import type { GeminiSchema } from "./schema.ts";

export interface FunctionCall {
  name: string;
  args?: Record<string, unknown>;
}

export interface Part {
  text?: string;
  functionCall?: FunctionCall;
  functionResponse?: { name: string; response: Record<string, unknown> };
  /** Gemini 2.5 thinking models attach this to function calls; it must be sent back unchanged. */
  thoughtSignature?: string;
  thought?: boolean;
}

export interface Content {
  role: "user" | "model";
  parts: Part[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: GeminiSchema;
}

export interface GenerateRequest {
  systemInstruction: { parts: { text: string }[] };
  contents: Content[];
  tools: { functionDeclarations: FunctionDeclaration[] }[];
  toolConfig?: { functionCallingConfig: { mode: "AUTO" | "ANY" | "NONE" } };
  generationConfig?: { temperature?: number; maxOutputTokens?: number };
}

export interface GenerateResponse {
  candidates?: { content?: Content; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}

/** Gemini said "too many requests" (free-tier quota). `retryAfterMs` comes from RetryInfo.retryDelay. */
export class GeminiRateLimitError extends Error {
  readonly retryAfterMs: number | null;
  readonly perDay: boolean;
  constructor(message: string, retryAfterMs: number | null, perDay: boolean) {
    super(message);
    this.name = "GeminiRateLimitError";
    this.retryAfterMs = retryAfterMs;
    this.perDay = perDay;
  }
}

export class GeminiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

export interface GeminiClient {
  generate(model: string, request: GenerateRequest): Promise<GenerateResponse>;
}

/** "37s" / "1.5s" / "120ms" → milliseconds. */
export function parseRetryDelay(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Math.ceil(m[2] === "ms" ? n : m[2] === "m" ? n * 60_000 : n * 1000);
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { "@type"?: string; retryDelay?: string; violations?: { quotaId?: string; quotaMetric?: string }[] }[];
  };
}

/** Read a 429 body: when to retry, and whether it was the daily quota. */
export function parseRateLimit(body: GoogleErrorBody): { retryAfterMs: number | null; perDay: boolean } {
  const details = body.error?.details ?? [];
  const retry = details.find((d) => d["@type"]?.endsWith("RetryInfo"))?.retryDelay;
  const quotaIds = details.flatMap((d) => d.violations ?? []).map((v) => `${v.quotaId ?? ""} ${v.quotaMetric ?? ""}`);
  return { retryAfterMs: parseRetryDelay(retry), perDay: quotaIds.some((q) => /PerDay/i.test(q)) };
}

export function createGeminiRestClient(apiKey: string, fetchFn: typeof fetch = fetch): GeminiClient {
  return {
    async generate(model, request) {
      if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not set", 500);
      const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(request),
      });
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = {};
      }
      if (res.status === 429) {
        const { retryAfterMs, perDay } = parseRateLimit(body as GoogleErrorBody);
        throw new GeminiRateLimitError((body as GoogleErrorBody).error?.message ?? "Gemini rate limit", retryAfterMs, perDay);
      }
      if (!res.ok) {
        // Never echo the request (it holds the key in a header only, but keep errors short anyway).
        throw new GeminiError(`Gemini error ${res.status}: ${((body as GoogleErrorBody).error?.message ?? res.statusText).slice(0, 300)}`, res.status);
      }
      return body as GenerateResponse;
    },
  };
}

let testClient: GeminiClient | null = null;

/** Tests only: replace the real client (null restores it). */
export function setGeminiClientForTests(client: GeminiClient | null): void {
  testClient = client;
}

export function geminiClient(apiKey: string): GeminiClient {
  return testClient ?? createGeminiRestClient(apiKey);
}
