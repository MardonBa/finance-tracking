/**
 * Fetch-based Plaid client (no SDK at runtime; SDK types only). It:
 *  - can only call endpoints in the read-only allowlist (endpoints.ts),
 *  - refuses Sandbox-only endpoints unless env is "sandbox",
 *  - validates every response against its schema (schemas.ts), in every env,
 *  - never logs request or response bodies (they carry tokens).
 * The same code path serves Sandbox and production.
 */
import { READ_ONLY_ENDPOINTS, SANDBOX_ONLY_ENDPOINTS, type PlaidEndpoint, type PlaidRequest } from "./endpoints.ts";
import { RESPONSE_SCHEMAS, type PlaidResponse } from "./schemas.ts";

export type PlaidEnv = "sandbox" | "production";

export const PLAID_BASE_URLS: Record<PlaidEnv, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

export interface PlaidClientConfig {
  clientId: string;
  secret: string;
  env: PlaidEnv;
  /** Injected for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
}

/** A Plaid API error. Carries only Plaid's codes and messages, never the request. */
export class PlaidApiError extends Error {
  readonly status: number;
  readonly errorType: string | null;
  readonly errorCode: string | null;
  readonly requestId: string | null;
  constructor(status: number, errorType: string | null, errorCode: string | null, requestId: string | null, message: string) {
    super(message);
    this.name = "PlaidApiError";
    this.status = status;
    this.errorType = errorType;
    this.errorCode = errorCode;
    this.requestId = requestId;
  }
}

/** A response that did not match its schema: Plaid's format changed or the data is broken. */
export class PlaidSchemaError extends Error {
  readonly endpoint: string;
  readonly issues: unknown;
  constructor(endpoint: string, issues: unknown) {
    super(`Plaid response from ${endpoint} did not match its schema`);
    this.name = "PlaidSchemaError";
    this.endpoint = endpoint;
    this.issues = issues;
  }
}

const READ_ONLY = new Set<string>(READ_ONLY_ENDPOINTS);
const SANDBOX_ONLY = new Set<string>(SANDBOX_ONLY_ENDPOINTS);

type Body<E extends PlaidEndpoint> = Omit<PlaidRequest<E>, "client_id" | "secret">;

export interface PlaidClient {
  readonly env: PlaidEnv;
  call<E extends PlaidEndpoint>(endpoint: E, body: Body<E>): Promise<PlaidResponse<E>>;
}

export function parsePlaidEnv(value: string | undefined): PlaidEnv {
  if (value === "sandbox" || value === "production") return value;
  throw new Error(`PLAID_ENV must be "sandbox" or "production", got ${JSON.stringify(value)}`);
}

export function createPlaidClient(config: PlaidClientConfig): PlaidClient {
  const env = parsePlaidEnv(config.env);
  const doFetch = config.fetch ?? fetch;
  if (!config.clientId || !config.secret) throw new Error("Plaid client id and secret are required");

  return {
    env,
    async call(endpoint, body) {
      if (SANDBOX_ONLY.has(endpoint)) {
        if (env !== "sandbox") throw new Error(`Refusing Sandbox-only endpoint ${endpoint} in ${env}`);
      } else if (!READ_ONLY.has(endpoint)) {
        throw new Error(`Plaid endpoint ${String(endpoint)} is not on the read-only allowlist`);
      }

      const res = await doFetch(`${PLAID_BASE_URLS[env]}${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json", "plaid-version": "2020-09-14" },
        body: JSON.stringify({ ...body, client_id: config.clientId, secret: config.secret }),
      });
      const json: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const e = (json ?? {}) as Record<string, unknown>;
        const str = (v: unknown) => (typeof v === "string" ? v : null);
        throw new PlaidApiError(
          res.status,
          str(e.error_type),
          str(e.error_code),
          str(e.request_id),
          `Plaid ${endpoint} failed: ${str(e.error_code) ?? res.status} ${str(e.error_message) ?? ""}`.trim(),
        );
      }

      const parsed = RESPONSE_SCHEMAS[endpoint].safeParse(json);
      if (!parsed.success) throw new PlaidSchemaError(endpoint, parsed.error.issues);
      return parsed.data as PlaidResponse<typeof endpoint>;
    },
  };
}
