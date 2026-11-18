/**
 * External seams, replaceable in tests: the network calls to Plaid and
 * Google, and the clock. Production code always goes through these, so the
 * Workers-runtime tests can run the real routes against a fake Plaid server,
 * a locally signed Google ID token and a locally generated webhook key.
 */
import { createPlaidClient, parsePlaidEnv, type PlaidClient } from "./plaid/index.ts";
import type { AppEnv } from "./env.ts";
import type { PlaidWebhookJwk } from "./plaid/webhook-verify.ts";

export interface Deps {
  /** fetch used for every Plaid API call. */
  plaidFetch: typeof fetch;
  /** fetch used for Google's JWKS (ID-token signing keys). */
  googleFetch: typeof fetch;
  /** Current time in ms. */
  now: () => number;
  /** Plaid webhook verification key by kid (tests inject a locally generated ES256 key). */
  plaidWebhookKey: (env: AppEnv, kid: string) => Promise<PlaidWebhookJwk>;
}

const defaults: Deps = {
  plaidFetch: (input, init) => fetch(input, init),
  googleFetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  plaidWebhookKey: async (env, kid) => (await plaidFor(env).call("/webhook_verification_key/get", { key_id: kid })).key,
};

export const deps: Deps = { ...defaults };

/** Test helper: override some seams; returns a function that restores the defaults. */
export function setDeps(overrides: Partial<Deps>): () => void {
  Object.assign(deps, overrides);
  return () => Object.assign(deps, defaults);
}

export const nowIso = () => new Date(deps.now()).toISOString();

export function plaidFor(env: AppEnv): PlaidClient {
  return createPlaidClient({
    clientId: env.PLAID_CLIENT_ID,
    secret: env.PLAID_SECRET,
    env: parsePlaidEnv(env.PLAID_ENV),
    fetch: (input, init) => deps.plaidFetch(input, init),
  });
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}
