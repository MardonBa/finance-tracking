/**
 * The model client for the assistant: Claude through the official Anthropic SDK
 * (decision 006 addendum, 2026-11-18: moved from Gemini's free tier).
 *
 * The harness only sees `ModelClient.create`, so tests install a scripted fake
 * with `setModelClientForTests` and never reach the network. API errors are
 * mapped to two classes the harness and route understand:
 *   ModelRateLimitError  429: back off until `retryAfterMs`
 *   ModelError           anything else; `kind: "credits"` when the API credit balance is used up
 */
import Anthropic from "@anthropic-ai/sdk";

export type ModelRequest = Anthropic.MessageCreateParamsNonStreaming;
export type ModelResponse = Anthropic.Message;

export interface ModelClient {
  create(request: ModelRequest): Promise<ModelResponse>;
}

export class ModelRateLimitError extends Error {
  readonly retryAfterMs: number | null;
  constructor(message: string, retryAfterMs: number | null) {
    super(message);
    this.name = "ModelRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class ModelError extends Error {
  readonly status: number;
  /** "credits": the Claude API credit balance is used up; "config": key or model problem; "unavailable": anything else. */
  readonly kind: "credits" | "config" | "unavailable";
  constructor(message: string, status: number, kind: ModelError["kind"] = "unavailable") {
    super(message);
    this.name = "ModelError";
    this.status = status;
    this.kind = kind;
  }
}

/** `retry-after` header (seconds, or an HTTP date) → milliseconds. */
export function parseRetryAfter(value: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!value) return null;
  const s = Number(value);
  if (Number.isFinite(s) && s >= 0) return Math.ceil(s * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

/** Map an SDK error onto ModelRateLimitError / ModelError (never echoes the request or key). */
export function mapApiError(e: unknown): Error {
  if (e instanceof Anthropic.RateLimitError) {
    return new ModelRateLimitError("Claude API rate limit", parseRetryAfter(e.headers?.get("retry-after")));
  }
  if (e instanceof Anthropic.APIError) {
    const status = e.status ?? 502;
    const message = (e.message ?? "").slice(0, 300);
    if (/credit balance/i.test(message)) return new ModelError("The Claude API credit balance is used up.", 402, "credits");
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError || e instanceof Anthropic.NotFoundError) {
      return new ModelError(`Claude API error ${status}: ${message}`, status, "config");
    }
    return new ModelError(`Claude API error ${status}: ${message}`, status);
  }
  return e instanceof Error ? e : new Error(String(e));
}

export function createClaudeClient(apiKey: string, fetchFn?: typeof fetch): ModelClient {
  // Explicit base URL and no env-based auth: the Worker talks to the Claude API with this key only.
  // No SDK retries (it would wait out a 429's retry-after inside the request); we retry an
  // overload or network blip once ourselves, and a 429 becomes our own cooldown (harness.ts).
  const sdk = new Anthropic({ apiKey, authToken: null, baseURL: "https://api.anthropic.com", maxRetries: 0, ...(fetchFn ? { fetch: fetchFn } : {}) });
  const retryable = (e: unknown) =>
    e instanceof Anthropic.APIConnectionError || (e instanceof Anthropic.APIError && !(e instanceof Anthropic.RateLimitError) && (e.status ?? 0) >= 500);
  return {
    async create(request) {
      if (!apiKey) throw new ModelError("ANTHROPIC_API_KEY is not set", 500, "config");
      for (let attempt = 0; ; attempt++) {
        try {
          return await sdk.messages.create(request);
        } catch (e) {
          if (attempt === 0 && retryable(e)) continue;
          throw mapApiError(e);
        }
      }
    },
  };
}

let testClient: ModelClient | null = null;

/** Tests only: replace the real client (null restores it). */
export function setModelClientForTests(client: ModelClient | null): void {
  testClient = client;
}

export function modelClient(apiKey: string): ModelClient {
  return testClient ?? createClaudeClient(apiKey);
}
