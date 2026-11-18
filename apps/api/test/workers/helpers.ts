import { env } from "cloudflare:workers";
import { basicFixture } from "@ft/core/fixtures";
import { DATA_KEYS, type Mutation } from "@ft/core";
import { hashAppToken } from "../../src/auth.ts";
import { encryptString } from "../../src/crypto/aes.ts";
import { app } from "../../src/index.ts";
import { getDb, mutationStatements } from "../../src/db/data.ts";
import { appCredentials, plaidItems } from "../../src/db/schema.ts";

export const TOKEN = "test-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export async function addCredential(token = TOKEN, extra: { revokedAt?: string; expiresAt?: string } = {}) {
  await getDb(env.DB)
    .insert(appCredentials)
    .values({
      id: `cred_${token.slice(-6)}`,
      tokenHash: await hashAppToken(token, env.APP_TOKEN_PEPPER),
      label: "test",
      createdAt: "2026-11-01T00:00:00.000Z",
      revokedAt: extra.revokedAt ?? null,
      expiresAt: extra.expiresAt ?? null,
    });
}

/** Load the hand-built @ft/core fixture into D1 through the same mutation path actions use. */
export async function loadBasicFixture() {
  const { data } = basicFixture();
  const db = getDb(env.DB);
  // Items carry backend-only columns that actions may not write; insert them directly.
  for (const item of data.items) {
    await db.insert(plaidItems).values({ ...item, accessTokenEnc: "test-ciphertext", transactionsCursor: null });
  }
  const order = DATA_KEYS.filter((k) => k !== "items");
  const muts = order.flatMap((k) => (data[k] as unknown[]).map((row) => ({ op: "upsert", table: k, row }) as Mutation));
  await db.batch(mutationStatements(db, muts) as never);
  return data;
}

export function request(path: string, init: RequestInit & { token?: string | null; envOverrides?: Partial<typeof env> } = {}) {
  const { token = TOKEN, headers, envOverrides, ...rest } = init;
  return app.request(
    path,
    { ...rest, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", ...headers } },
    envOverrides ? { ...env, ...envOverrides } : env,
  );
}

// ------------------------------------------------------------------ Phase 1 backend helpers

/** Insert a connected item (access token encrypted like production) for a fake Plaid item. */
export async function insertItem(fake: { itemId: string; accessToken: string; institutionId: string; institutionName: string }, id = `item_${fake.itemId}`) {
  await getDb(env.DB)
    .insert(plaidItems)
    .values({
      id,
      plaidItemId: fake.itemId,
      institutionId: fake.institutionId,
      institutionName: fake.institutionName,
      accessTokenEnc: await encryptString(fake.accessToken, env.TOKEN_ENC_KEY),
      transactionsCursor: null,
      status: "ok",
      errorCode: null,
      consentExpiresAt: null,
      lastSuccessfulUpdateAt: null,
      lastSyncedAt: null,
      createdAt: "2026-11-01T00:00:00.000Z",
      transactionsUpdateStatus: null,
      refreshAvailableAt: null,
    });
  return id;
}

export async function rows<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
  return (await env.DB.prepare(sql).bind(...params).all<T>()).results;
}

export async function count(table: string, where = "1 = 1", ...params: unknown[]): Promise<number> {
  return (await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).bind(...params).first<{ n: number }>())!.n;
}
